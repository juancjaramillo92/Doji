-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 019: R-14 is judged on TradingView's calendar, and Forex Factory goes
-- ───────────────────────────────────────────────────────────────────────────
-- His decision, recorded as v1.20 of the strategy: one calendar rather than two.
-- High impact is a US release TradingView rates high, and those are already in
-- `eugenia_calendar` under TradingView's id (018) — so R-14 reads them there, and
-- the Forex Factory export, its two tables and the function that replaced its
-- week are dropped.
--
-- WHAT IS KEPT IS THE COVERAGE, under a new name. A week nobody fetched is not
-- a quiet week: a week with no releases stored and a week that was never asked
-- for read the same, and every entry in the second would pass. `ff_weeks` said
-- which weeks a fetch had landed for; `calendar_weeks` says the same of
-- TradingView. A week is written there only by a fetch of that whole week —
-- the nightly pass, or the history door walking back — and only after its
-- releases were written, so a mark can never stand in front of missing rows.
--
-- TradingView's calendar goes back to 2003, where the export only ever held the
-- current week: the history door fills every week he has traded, which Forex
-- Factory could never do.
--
-- No user_id and no policy, for sync_health's reason. Safe to re-run: `if not
-- exists`, `if exists`, and revokes that are no-ops when nothing is held.
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
