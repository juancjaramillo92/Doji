-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — where the trade was AIMED, not only where it ended
-- ───────────────────────────────────────────────────────────────────────────
-- §8 of the strategy says the plan is not recoverable: *where the stop and the
-- target were set at entry* is called unavailable from the broker, and four of
-- its unanswerable questions rest on that sentence.
--
-- It is true of a CLOSED position, which is all this system had ever asked
-- about. `get_deals` reports fills. `get_position_details` on a closed position
-- reports the FINAL stop, so one moved to break-even has overwritten the
-- original everywhere it could be read.
--
-- A LIVE POSITION IS A DIFFERENT QUESTION AND NOBODY HAD ASKED IT. `?tools=1`
-- showed the broker serves `get_positions`, and `?positions=1` showed what it
-- carries:
--
--   { "positionId": 586244103, "tradeSide": "BUY", "volume": 400,
--     "entryPrice": 4402.71, "stopLoss": 4403.24, "takeProfit": 4432.1 }
--
-- The plan, in display prices, on an open trade. The poller runs every two
-- minutes, so it sees almost every position while it is still open — and the
-- FIRST sighting is the one closest to entry.
--
-- TWO COLUMNS, BROKER-OWNED, AND WRITTEN ONCE. `where planned_sl is null` in
-- the UPDATE is the whole arbitration, and it is the pattern `balance` already
-- uses for the same reason: the poller re-reads every open position on every
-- run, R-04 moves the stop to break-even partway through, and a later write
-- would overwrite the plan with the thing the plan is meant to be compared
-- against.
--
-- WHAT THIS IS NOT. It is not the plan at the INSTANT of entry — it is the plan
-- as it stood at the first poll that saw the position, up to two minutes later.
-- For R-04, which moves a stop only after +$20, that gap is immaterial. For a
-- stop moved inside the first two minutes it would be wrong, and nothing here
-- can tell that case apart. Say "as first seen", never "as set".
--
-- AND IT ONLY EVER LOOKS FORWARD. Every trade already in the table closed
-- before this existed and will carry null for good. That is why the strategy's
-- Evaluable column is not changed here: a rule is `journal` when a row can
-- answer it, and today almost no row can.
--
-- Run once, in the SQL editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Broker-owned, like every price on this table. The app never writes them and
-- `Data.OWNED` never names them, which is what keeps a save from touching one.
alter table public.trades add column if not exists planned_sl numeric;
alter table public.trades add column if not exists planned_tp numeric;

comment on column public.trades.planned_sl is
  'Stop as first seen on the open position, in display price. Written once by '
  'the poller under `where planned_sl is null`; null on every trade that closed '
  'before this column existed.';
comment on column public.trades.planned_tp is
  'Target as first seen on the open position, in display price. Same writer and '
  'the same one-shot rule as planned_sl.';

-- ─── And Eugenia may see them ──────────────────────────────────────────────
-- APPENDED, AND NOTHING ELSE MOVES. `create or replace view` matches the
-- existing view position by position, so a name inserted mid-list reads as
-- renaming the column that used to sit there and Postgres refuses with `cannot
-- change name of view column`. The tail of this list is therefore in the order
-- columns were added rather than the order they belong by sense — putting the
-- plan up beside entry_price is exactly the tidy that breaks re-application on
-- every database that already has this view.
--
-- She reads them and cannot write them, the same as every other column here:
-- the grant below is select and nothing else, and she has no write path to
-- `trades` anywhere in her file.
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
