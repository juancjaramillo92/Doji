-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 020: which series a release belongs to
-- ───────────────────────────────────────────────────────────────────────────
-- tv_id names one release; the ticker (ECONOMICS:USCPCEPIMM) names the series,
-- so a print can be set beside the last twelve of its kind — how a real
-- surprise is told from a print that has run below consensus for months. The
-- index is that read. Older rows gain a ticker when the history door re-files
-- their week.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.eugenia_calendar add column if not exists ticker text;

create index if not exists eugenia_calendar_ticker on public.eugenia_calendar (ticker, at desc);
