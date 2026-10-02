-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 021: the calendar's old key, by name, goes
-- ───────────────────────────────────────────────────────────────────────────
-- 005 keyed a release on (at, name) when she typed the calendar in, and 018
-- replaced that with TradingView's id: every filing upserts `on_conflict=tv_id`,
-- record_actual is a PATCH that cannot insert, and nothing writes by name.
--
-- THE OLD KEY STAYED, AND IT COULD ONLY REFUSE. A filing goes up as one bulk
-- insert per shape, so a single TradingView row whose time and name matched a
-- row she typed long ago, or a second TradingView release under the same title
-- at the same minute, would be refused with every row beside it. The filing
-- runs quarter-hourly and the history door walks back over the weeks she typed,
-- so that refusal would recur on every run: a calendar that stops moving, a
-- release look with nothing to wake on, and a failed `calendar` row as the only
-- sign. One release, one row, is tv_id's job now.
--
-- Safe to re-run: `if exists`.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.eugenia_calendar drop constraint if exists eugenia_calendar_unique;
