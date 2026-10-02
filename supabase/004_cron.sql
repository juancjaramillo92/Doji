-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — everything that runs on a timer
-- ───────────────────────────────────────────────────────────────────────────
-- Seven jobs: the poller every two minutes, Eugenia every hour, her two
-- quarter-hourly senses — the event spine and the price mark — the two watchers
-- over what was dispatched and what it cost, and a nightly sweep of pg_cron's
-- own history. One file, because "what fires on its own in this system" should
-- be one place to look rather than one file per feature.
--
-- THE POLLER'S JOB WAS NOT IN THIS REPOSITORY UNTIL NOW, and it is the most
-- load-bearing scheduled thing here — every trade arrives through it. Its
-- timeout, the secret it presents and the fact that it presents one at all were
-- readable only by querying the live database, which is exactly the failure
-- .github/workflows/deploy-functions.yml exists to prevent for the functions: a
-- repository that describes a system while the system runs something else.
--
-- SAFE TO RE-RUN. cron.schedule upserts on the job name, so applying this file
-- replaces whatever is scheduled under these names with what it says. That
-- is what makes the file the source of truth rather than a description of one —
-- run it and the database matches, rather than reading the database to find out
-- whether it does.
--
-- NONE OF THE CALLING JOBS HOLDS DATABASE POWER. Each presents the cron
-- secret, read from Vault at call time rather than written into the job text.
-- An earlier version of the poller's job carried a legacy service_role JWT —
-- full RLS-bypassing access, in a job definition, unrotatable. The housekeeping
-- job is the exception and is the reason for the distinction: it is a DELETE,
-- and it reaches nothing outside pg_cron's own history.
--
-- ONE VALUE, TWO STORES, TWO SPELLINGS, and it is worth knowing before touching
-- either: the Edge Functions read it from their own secrets as
-- DOJI_CRON_SECRET, while the database reads it from Vault as
-- doji_cron_secret. Both jobs and Gladys's trigger use the lower-case Vault
-- name. Postgres compares it case-sensitively and a name matching nothing
-- yields null, so the wrong spelling makes a caller give up without raising
-- anything — it reads like a bot that was never installed.
--
-- Run in the SQL editor, after the functions are deployed and the secret is in
-- Vault. Confirm with the query at the bottom of supabase/verify.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The poller ────────────────────────────────────────────────────────────
-- EVERY TWO MINUTES, ALL WEEK, and the market check is in the function rather
-- than here. Gold trades Sunday 17:00 to Friday 17:00 New York; expressing that
-- in cron takes three jobs, pg_cron schedules in UTC, and every one of them
-- would be an hour wrong whenever New York is on standard time. marketOpen()
-- asks America/New_York for its own clock and returns `skipped: market closed`
-- for the ~1,400 calls a week that fall in the weekend gap, which costs a
-- function invocation and nothing else.
select cron.schedule(
  'doji-mcp-sync',
  '*/2 * * * *',
  $$
    insert into public.dispatch (id, job)
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-mcp-sync',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      -- A cold start plus an MCP session, a get_deals, an upsert and sometimes a
      -- get_balance can outrun pg_net's default, and a request cut off mid-flight
      -- is a poll that wrote nothing. Gladys's trigger sets the same bound.
      timeout_milliseconds := 20000
    ), 'poller';
  $$
);

-- ─── Eugenia ───────────────────────────────────────────────────────────────
-- HOURLY, AND WHICH HOUR OWES WHAT IS DECIDED IN THE FUNCTION. Weekdays at
-- 08:00 and Sunday at 17:00 New York for the briefing, weekdays at 10:00 for
-- the pulse, and 09:00 to 11:00 to retry a briefing that failed. Same reasoning
-- as the poller's: a fixed UTC expression is an hour wrong for half the year
-- and would need editing twice a year forever, and three overlapping schedules
-- cannot be expressed as three jobs without two of them firing at once.
-- dueNow() reads the same nyClock the poller's market check does, and most of
-- these twenty-four calls find nothing due: a clock read, one small query and
-- no model call at all.
select cron.schedule(
  'doji-eugenia',
  '0 * * * *',
  $$
    insert into public.dispatch (id, job)
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      -- A briefing is a dozen web searches and a long generation. The poller's
      -- 20s would cut it off mid-thought; pg_net is fire-and-forget, so this
      -- bound only has to outlast the work.
      timeout_milliseconds := 300000
    ), 'eugenia';
  $$
);

-- ─── Eugenia's event spine ─────────────────────────────────────────────────
-- EVERY QUARTER HOUR, AND IT DOES EXACTLY ONE THING: ask whether a high-impact
-- release she filed this morning has landed and not yet been looked at.
--
-- A SECOND JOB RATHER THAN A FASTER ONE, and the reason is that the four
-- schedules above are hour predicates. briefDue, pulseDue, retryDue and
-- consolidateDue all test `hour === n`, so moving the hourly job to */15 would
-- run four briefings every morning, four pulses every session and four nightly
-- passes. Splitting the event-driven half off leaves every one of those
-- untouched and gives a print a quarter of an hour rather than an hour to reach
-- him — which for a number that moved the market is most of its usefulness.
--
-- OFFSET OFF THE HOUR so it never fires alongside the 08:00 briefing. Nothing
-- would break if it did; it would simply be two model calls at once, one of
-- them about a calendar the other is in the middle of writing.
--
-- Most of these ninety-six calls a day find nothing: one indexed query against
-- a table with a partial index on exactly that predicate, and no model call at
-- all. `looked_at` is what makes a look happen once.
select cron.schedule(
  'doji-eugenia-spine',
  '5,20,35,50 * * * *',
  $$
    insert into public.dispatch (id, job)
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia?release=1',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      -- A look is a search and a short generation, nowhere near a briefing.
      timeout_milliseconds := 120000
    ), 'eugenia-spine';
  $$
);

-- ─── Eugenia's price sense ─────────────────────────────────────────────────
-- THE SECOND QUARTER-HOURLY JOB, AND IT IS A SEPARATE ONE FOR THE REASON THE
-- SPINE IS SEPARATE FROM THE HOURLY: each door does one thing, and a failure in
-- either says which. It is also what makes the fifteen-minute window a fact of
-- the schedule rather than a number chosen in code — the move is measured
-- against the mark the previous run left, so the gap between these firings IS
-- the window.
--
-- OFFSET FROM THE SPINE rather than sharing its minutes. They read the same
-- calendar table for opposite purposes — the spine for a print to look at, this
-- for a print that would explain the move — and running them together would
-- have the price sense deciding "nothing explains this" in the same second the
-- spine is writing what does.
--
-- Most of these calls cost one broker quote and one indexed read: the gates are
-- arithmetic and there is no model call at all unless a move clears them. It
-- answers `market closed` immediately at the weekend, which is the same rule
-- and the same definition the poller keeps.
select cron.schedule(
  'doji-eugenia-price',
  '12,27,42,57 * * * *',
  $$
    insert into public.dispatch (id, job)
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia?move=1',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      -- A quote through the poller, then at most one search and a short
      -- generation. The spine's bound, for the same shape of work.
      timeout_milliseconds := 120000
    ), 'eugenia-price';
  $$
);

-- ─── The watcher over everything above ─────────────────────────────────────
-- EVERY JOB IN THIS FILE CAN BE REFUSED A WORKER AND NOTHING WOULD SAY SO. A
-- 546 comes back before the function exists, so it writes no row, sends no
-- apology and appears in no log of its own; pg_net records it in
-- `net._http_response` and prunes it within hours. That is how a Sunday
-- briefing went missing for two hours before a person noticed.
--
-- TEN MINUTES rather than the hour, because the thing it reports is a message
-- that did not arrive and the value of knowing decays fast. 009's window judges
-- at fifteen, so a dispatch is adjudicated on the second sweep after it and
-- never on the first — which is what keeps a slow-but-fine call from being
-- called a failure.
--
-- It writes no dispatch row of its own. A watcher that watched itself would
-- either report its own success forever or report nothing when it stopped, and
-- the thing that notices THIS job dying is the same thing that notices any of
-- the rest: a message that should have come and did not.
select cron.schedule(
  'doji-dispatch-watch',
  '*/10 * * * *',
  $$ select public.dispatch_watch() $$
);

-- ─── The watcher over the clock the workers run on ─────────────────────────
-- THE HALF NEITHER 008 NOR 009 CAN SEE. Both ask whether something ran; this
-- asks how much of its budget it spent, and it is the only one of the three
-- that can speak before the failure rather than after it. Once a briefing
-- crosses the 400s wall clock the worker is destroyed mid-draft: pg_net already
-- has its 200, `ask()` never reaches its catch, no apology is sent, and all
-- three retries redo the same too-long work. There is nothing left to report
-- with, which is why the warning has to come while there is still room.
--
-- HOURLY, AND THE HOUR IS IRRELEVANT. 010 speaks at most once per New York
-- civil day and works that date out itself, so this needs no UTC expression and
-- is not wrong for half the year. Offset off :00 because that is when the
-- briefing is dispatched, which is the heaviest moment of the hour and the one
-- thing it is watching.
--
-- It writes no dispatch row, for the reason doji-dispatch-watch does not: a
-- watcher in the ledger would be judged by the sweep it is part of.
select cron.schedule(
  'doji-pace-watch',
  '37 * * * *',
  $$ select public.pace_watch() $$
);

-- ─── Housekeeping ──────────────────────────────────────────────────────────
-- cron.job_run_details grows by 750 rows a day from the poller alone and
-- nothing prunes it on its own. Seven days is longer than any question anyone
-- asks of it — and it is not where a failure is diagnosed anyway, because it
-- records that the SQL ran, not what the function answered. net._http_response
-- is the one that carries the answer, and Supabase prunes that itself.
--
-- Two archives, one job. `dispatch` gains a row per poll — seven hundred and
-- twenty a day from the poller alone — so settled rows past a month go the same
-- way cron's own history does. Failures are settled too, so a month is what is
-- readable after the fact rather than forever.
select cron.schedule(
  'purge-cron-history',
  '0 3 * * *',
  $$
    delete from cron.job_run_details where end_time < now() - interval '7 days';
    delete from public.dispatch where settled and at < now() - interval '30 days';
  $$
);
