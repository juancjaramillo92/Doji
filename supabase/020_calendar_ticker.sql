-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 020: which series a release belongs to
-- ───────────────────────────────────────────────────────────────────────────
-- TradingView's id names ONE release — this month's core PCE — and nothing ties
-- it to last month's. The `ticker` does: ECONOMICS:USCPCEPIMM is every core PCE
-- month-on-month print there has been. With it, a release that has just landed
-- can be put beside the last twelve of its kind, each with what was expected
-- and what came, which is how she tells a real surprise from a print that has
-- run below expectations for half a year.
--
-- The index is the read that question makes: one series, newest first.
--
-- Rows filed before this carry no ticker until a filing writes them again; the
-- history door re-files every week it walks, so walking it back a year fills
-- the record in.
--
-- Safe to re-run: `if not exists`.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.eugenia_calendar add column if not exists ticker text;

create index if not exists eugenia_calendar_ticker on public.eugenia_calendar (ticker, at desc);
