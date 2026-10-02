-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 018: her calendar keyed by TradingView's id
-- ───────────────────────────────────────────────────────────────────────────
-- The calendar is filed from TradingView now rather than typed in by her, and
-- keyed on TradingView's id: one release, one row, whatever it is called.
--
-- A plain unique index rather than a constraint or a partial index, because
-- PostgREST's `on_conflict=tv_id` must infer it; her older rows carry no id,
-- and nulls do not collide.
--
-- Her own future rows are deleted, or every pending print would be listed
-- twice under two names. What already printed is history and stays.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.eugenia_calendar add column if not exists tv_id text;

create unique index if not exists eugenia_calendar_tv_id on public.eugenia_calendar (tv_id);

delete from public.eugenia_calendar where tv_id is null and at > now();
