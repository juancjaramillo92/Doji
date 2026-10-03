-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — where the trade was aimed
-- ───────────────────────────────────────────────────────────────────────────
-- The stop and target as the poller first sees them on an OPEN position.
-- A closed position cannot answer this: the broker then reports the final
-- stop, and one moved to break-even has overwritten the original. get_positions
-- carries both in display prices, and the poller runs every two minutes, so
-- it sees almost every position while it is still open.
--
-- Written once: `where planned_sl is null` in the poller's UPDATE is the whole
-- arbitration, as with `balance`, because R-04 moves the stop to break-even and
-- a later write would file that as the plan. "As first seen", never "as set" —
-- up to two minutes separate the entry from the poll. Forward only: every trade
-- that closed before this exists carries null.
--
-- Run once, in the SQL editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Broker-owned and absent from Data.OWNED, so a save cannot touch either.
alter table public.trades add column if not exists planned_sl numeric;
alter table public.trades add column if not exists planned_tp numeric;

comment on column public.trades.planned_sl is
  'Stop as first seen on the open position, in display price. Written once by '
  'the poller under `where planned_sl is null`; null on every trade that closed '
  'before this column existed.';
comment on column public.trades.planned_tp is
  'Target as first seen on the open position, in display price. Same writer and '
  'the same one-shot rule as planned_sl.';

-- ─── And Eugenia may read them ─────────────────────────────────────────────
-- Appended, for 003's reason: `create or replace view` matches by position.
create or replace view public.eugenia_trades
  with (security_invoker = true) as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         open_day, setup, followed_rules, followed_sl, followed_tp, size_oz,
         net_pnl, planned_sl, planned_tp
  from public.trades
  where deleted = false;

revoke all on public.eugenia_trades from anon, authenticated, service_role;
grant select on public.eugenia_trades to service_role;
grant select on public.trades to service_role;
