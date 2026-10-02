-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 008: whether the two silent writers are still writing
-- ───────────────────────────────────────────────────────────────────────────
-- The poller and the email function report failure to nobody, so either one
-- dying shows only as trades that never arrive. This is a heartbeat rather than
-- an alarm: an alarm cannot fire when the run stops happening at all — an
-- unscheduled job, a renamed function — and last_ok going cold sees both.
--
-- Inert until applied: both writers swallow a failed health write and fold
-- deals exactly as before.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sync_health (
  -- One row per writer.
  id            text primary key,
  constraint sync_health_id_check check (id in ('poller', 'email')),

  -- Moved on success only, so staleness means "not running" as well as
  -- "running and failing".
  last_ok       timestamptz,

  -- Kept after a later success: a writer failing one run in three looks
  -- healthy by last_ok alone.
  last_error    text,
  last_error_at timestamptz,

  constraint sync_health_error_length check (last_error is null
                                        or char_length(last_error) between 1 and 500)
);

-- Seeded, because the writers PATCH: with no row, every heartbeat is a 200
-- that lands nowhere.
insert into public.sync_health (id) values ('poller'), ('email')
  on conflict (id) do nothing;

-- No policy: the writers and Eugenia hold the secret key, and RLS denies the
-- publishable key outright.
alter table public.sync_health enable row level security;
