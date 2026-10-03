-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — everything that runs on a timer
-- ───────────────────────────────────────────────────────────────────────────
-- Seven jobs: the poller, Eugenia's hourly job and her two quarter-hourly
-- senses, the two watchers, and a nightly purge. One file, so "what fires on
-- its own" is one place to look.
--
-- SAFE TO RE-RUN. cron.schedule upserts on the job name, so applying this file
-- makes the database match it.
--
-- No calling job holds database power: each presents the cron secret, read
-- from Vault at call time. Vault names it lower case (doji_cron_secret), the
-- Edge Functions upper case (DOJI_CRON_SECRET), and Postgres compares Vault
-- names case-sensitively — the wrong spelling yields null and the caller gives
-- up without raising anything.
--
-- Every dispatch records pg_net's request id in 009's ledger, so a failed call
-- can be attributed afterwards. The watchers and the purge make none.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The poller ────────────────────────────────────────────────────────────
-- Every two minutes, all week. The market hours are decided in the function:
-- gold trades Sunday 17:00 to Friday 17:00 New York, which in UTC cron would be
-- three jobs, each an hour wrong for half the year. Off-hours calls answer
-- `skipped: market closed` and cost one invocation.
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
      -- A cold start, an MCP session, get_deals, an upsert and sometimes
      -- get_balance can outrun pg_net's default.
      timeout_milliseconds := 20000
    ), 'poller';
  $$
);

-- ─── Eugenia ───────────────────────────────────────────────────────────────
-- Hourly; dueNow() decides which hour owes what — the briefing, its retries,
-- the pulse, the nightly pass — against New York's own clock, for the poller's
-- reason. Most hours find nothing due and make no model call.
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
      -- The function answers before it works, so this only bounds the answer.
      timeout_milliseconds := 300000
    ), 'eugenia';
  $$
);

-- ─── Her event spine ───────────────────────────────────────────────────────
-- Files the calendar and looks at any high-impact release that has landed and
-- not been looked at. A separate job, not a faster hourly one: every hourly
-- schedule tests `hour === n`, so */15 there would run four briefings a morning.
-- Off the hour, clear of the briefing.
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
      timeout_milliseconds := 120000
    ), 'eugenia-spine';
  $$
);

-- ─── Her price sense ───────────────────────────────────────────────────────
-- A move is measured against the mark the previous run left, so the gap
-- between these firings IS the window. Offset from the spine, which writes the
-- calendar this reads to decide whether a print explains the move.
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
      timeout_milliseconds := 120000
    ), 'eugenia-price';
  $$
);

-- ─── The dispatch watcher (009) ────────────────────────────────────────────
-- A worker refused before it starts (a 546) leaves no row and no log of its
-- own; pg_net's response table is the only witness and it is pruned within
-- hours. Every ten minutes; 009 judges at fifteen, so a dispatch is judged on
-- the second sweep after it. It writes no dispatch row of its own: a watcher
-- in the ledger would be judged by the sweep it is part of.
select cron.schedule(
  'doji-dispatch-watch',
  '*/10 * * * *',
  $$ select public.dispatch_watch() $$
);

-- ─── The pace watcher (010) ────────────────────────────────────────────────
-- Warns before a briefing outgrows the worker's wall clock, because once it
-- does the worker is killed with nothing left to report. 010 speaks at most
-- once a New York day and computes the day itself, so the hour does not
-- matter; 37 past keeps it off the briefing's dispatch.
select cron.schedule(
  'doji-pace-watch',
  '37 * * * *',
  $$ select public.pace_watch() $$
);

-- ─── Housekeeping ──────────────────────────────────────────────────────────
-- cron's own history grows ~750 rows a day and records only that the SQL ran,
-- so a week is plenty. Settled ledger rows go after a month.
select cron.schedule(
  'purge-cron-history',
  '0 3 * * *',
  $$
    delete from cron.job_run_details where end_time < now() - interval '7 days';
    delete from public.dispatch where settled and at < now() - interval '30 days';
  $$
);
