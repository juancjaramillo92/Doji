-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — everything that runs on a timer
-- ───────────────────────────────────────────────────────────────────────────
-- Three jobs: the poller every two minutes, Eugenia every hour, and a nightly
-- sweep of pg_cron's own history. One file, because "what fires on its own in
-- this system" should be one place to look rather than one file per feature.
--
-- THE POLLER'S JOB WAS NOT IN THIS REPOSITORY UNTIL NOW, and it is the most
-- load-bearing scheduled thing here — every trade arrives through it. Its
-- timeout, the secret it presents and the fact that it presents one at all were
-- readable only by querying the live database, which is exactly the failure
-- .github/workflows/deploy-functions.yml exists to prevent for the functions: a
-- repository that describes a system while the system runs something else.
--
-- SAFE TO RE-RUN. cron.schedule upserts on the job name, so applying this file
-- replaces whatever is scheduled under these three names with what it says. That
-- is what makes the file the source of truth rather than a description of one —
-- run it and the database matches, rather than reading the database to find out
-- whether it does.
--
-- NEITHER OF THE TWO CALLING JOBS HOLDS DATABASE POWER. Each presents the cron
-- secret, read from Vault at call time rather than written into the job text.
-- An earlier version of the poller's job carried a legacy service_role JWT —
-- full RLS-bypassing access, in a job definition, unrotatable. The third job is
-- the exception and is the reason for the distinction: it is a DELETE, and it
-- reaches nothing outside pg_cron's own history.
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
    );
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
    );
  $$
);

-- ─── Housekeeping ──────────────────────────────────────────────────────────
-- cron.job_run_details grows by 750 rows a day from the poller alone and
-- nothing prunes it on its own. Seven days is longer than any question anyone
-- asks of it — and it is not where a failure is diagnosed anyway, because it
-- records that the SQL ran, not what the function answered. net._http_response
-- is the one that carries the answer, and Supabase prunes that itself.
select cron.schedule(
  'purge-cron-history',
  '0 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);
