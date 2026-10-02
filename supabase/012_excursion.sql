-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — how far a trade ran in his favour
-- ───────────────────────────────────────────────────────────────────────────
-- R-04 moves the stop to break-even once price has run $20 toward the target,
-- so a loss taken after that is a stop that was not moved. The broker's minute
-- bars go back a year, so the best price a position saw is recoverable for
-- every trade. The poller fills it newest first under `where best_price is
-- null`; a closed trade's bars never change.
--
-- Whole minutes inside the trade only, so the figure can fall short of the
-- truth but never pass it, and a trade shorter than a minute stays null.
--
-- Run once, in the SQL editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
-- Broker-owned and absent from Data.OWNED.
alter table public.trades add column if not exists best_price numeric;

comment on column public.trades.best_price is
  'Best price the position reached while open — the highest bid on a buy, the '
  'lowest on a sell — from the broker''s minute bars, whole minutes inside the '
  'trade only. Written once by the poller under `where best_price is null`; '
  'null on a trade too short to hold one whole minute.';

-- ─── And Eugenia may read it ───────────────────────────────────────────────
-- Appended, for 003's reason.
create or replace view public.eugenia_trades
  with (security_invoker = true) as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         open_day, setup, followed_rules, followed_sl, followed_tp, size_oz,
         net_pnl, planned_sl, planned_tp, best_price
  from public.trades
  where deleted = false;

revoke all on public.eugenia_trades from anon, authenticated, service_role;
grant select on public.eugenia_trades to service_role;
grant select on public.trades to service_role;
