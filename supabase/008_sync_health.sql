-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 008: whether the two silent writers are still writing
-- ───────────────────────────────────────────────────────────────────────────
-- The poller and the email function report failure to nobody. A 500, a refused
-- write or a cut deals page reaches console.error and stops there; pg_net
-- discards the response and nothing reads an Edge log. So the symptom of either
-- one dying is an ABSENCE — trades that never arrive — and an absence is the one
-- thing this system had no way to notice.
--
-- A HEARTBEAT RATHER THAN AN ALARM, and the difference is the whole point. An
-- alarm fires when a run fails, which means it cannot fire when the run stops
-- happening at all: a cron job that was never scheduled, a function that 404s
-- because it was renamed, a deploy that removed it. Those are silent under any
-- failure-triggered scheme and they are exactly the failures worth catching.
-- `last_ok` moves on every successful run, so "nothing has moved in six hours"
-- answers both questions with one column.
--
-- IT MUST BE INERT UNTIL THIS FILE IS APPLIED. Both writers swallow their own
-- failure here, so a database that has not seen 008 gets a 404 on the health
-- write and keeps folding deals exactly as before; Eugenia's read answers
-- nothing and her briefing is unchanged. A monitoring table that can take down
-- the thing it monitors is worse than no table.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sync_health (
  -- One row per writer, named for the writer rather than the channel, so a
  -- reader of this table does not have to know which function reads Gmail.
  id            text primary key,
  constraint sync_health_id_check check (id in ('poller', 'email')),

  -- The last time this writer completed a run. Moved on success only, which is
  -- what makes staleness mean "not running" as well as "running and failing".
  last_ok       timestamptz,

  -- The last failure, kept even after a later success: a writer that fails one
  -- run in three is healthy by last_ok and is not healthy, and this is the only
  -- place that shows.
  last_error    text,
  last_error_at timestamptz,

  constraint sync_health_error_length check (last_error is null
                                        or char_length(last_error) between 1 and 500)
);

-- The two writers, so a PATCH by primary key has a row to land on. Same shape
-- as the thesis and price marks: these functions PATCH rather than upsert, so a
-- missing row is a 200 with an empty array and every heartbeat is dropped
-- silently — which would leave this table reading as two dead writers forever.
insert into public.sync_health (id) values ('poller'), ('email')
  on conflict (id) do nothing;

-- No user_id and no policy: the two writers hold the secret key, and RLS with
-- nothing behind it denies the publishable key outright. The app has no use for
-- this table — Eugenia is the reader, and she reads it with the same key.
alter table public.sync_health enable row level security;
