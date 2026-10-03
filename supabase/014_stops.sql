-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 014: every stop and target a position carried, and when
-- ───────────────────────────────────────────────────────────────────────────
-- R-19 asks where the stop and target sat when a print landed. 006 keeps the
-- plan as first seen and a closed position reports its final stop, so every
-- move between was lost — and the broker keeps none of it after the close.
-- The poller reads open positions every two minutes and writes a row only when
-- either side differs from the last one for that position, so `seen_at` is
-- "as first seen", like 006. The weekly backup carries it.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.trade_stops (
  id       text        not null,
  seen_at  timestamptz not null default now(),
  -- Display prices; null where that side carried no order.
  sl       numeric,
  tp       numeric,
  primary key (id, seen_at)
);

-- No policy: only secret-key readers and writers.
alter table public.trade_stops enable row level security;
revoke all on public.trade_stops from anon, authenticated;
