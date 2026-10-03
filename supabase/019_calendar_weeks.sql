-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 019: R-14 is judged on TradingView's calendar, and Forex Factory goes
-- ───────────────────────────────────────────────────────────────────────────
-- His decision, strategy v1.20: one calendar. R-14 reads high-impact US
-- releases from eugenia_calendar, and the Forex Factory tables go.
--
-- The coverage stays under a new name: a week nobody fetched reads exactly like
-- a quiet week, and every entry in it would pass. A week is marked here only by
-- a fetch of that whole week, after its releases are written, so a mark never
-- stands in front of missing rows. TradingView goes back to 2003, so the
-- history door can fill every week he has traded.
--
-- No policy, for 008's reason. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.calendar_weeks (
  -- The Sunday, New York, the week began on — R-14's `weekOf`.
  week        date        primary key,
  fetched_at  timestamptz not null default now()
);

alter table public.calendar_weeks enable row level security;

-- Both public roles by name, for 007's reason.
revoke all on public.calendar_weeks from anon, authenticated;

drop function if exists public.ff_calendar_replace(jsonb);
drop table if exists public.ff_calendar;
drop table if exists public.ff_weeks;
