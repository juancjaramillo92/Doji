-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 021: the calendar's old key, by name, goes
-- ───────────────────────────────────────────────────────────────────────────
-- 018 made tv_id the key and nothing writes by name, so 005's (at, name) key
-- could only refuse: one clash with a row she typed long ago fails the whole
-- bulk filing, on every quarter-hourly run.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.eugenia_calendar drop constraint if exists eugenia_calendar_unique;
