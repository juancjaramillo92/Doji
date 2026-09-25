-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — how far a trade ran in his favour
-- ───────────────────────────────────────────────────────────────────────────
-- R-04 moves the stop to break-even once price has travelled $20 toward the
-- target, and §7 and §10 called it uncheckable for good: how far a trade ran
-- before it turned was "stored nowhere, including at the broker".
--
-- THE BROKER KEEPS IT. `get_trendbars` serves minute bars, and `?bars=raw`
-- showed them a full year back — so the best price a position saw while it
-- was open is recoverable for every trade in the journal, closed or not. That
-- is the one fact R-04 turns on: a loss taken after the trade had already been
-- $20 in his favour is a stop that was not moved.
--
-- ONE COLUMN, BROKER-OWNED, WRITTEN ONCE. The poller fills it newest first, a
-- few trades a poll, under `where best_price is null` — the bars of a closed
-- trade never change, so the filter is what keeps a second writer from ever
-- mattering, the arbitration `balance` and the plan already use.
--
-- WHAT IT IS NOT. Only whole minutes inside the trade are read, so a spike in
-- the first or last minute is missed and the figure can only ever be short of
-- the truth, never past it. A trade too short to hold one whole minute has no
-- figure at all, and stays null rather than reading as one that went nowhere.
--
-- Run once, in the SQL editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Broker-owned, like every price on this table. The app never writes it and
-- `Data.OWNED` never names it, which is what keeps a save from touching one.
alter table public.trades add column if not exists best_price numeric;

comment on column public.trades.best_price is
  'Best price the position reached while open — the highest bid on a buy, the '
  'lowest on a sell — from the broker''s minute bars, whole minutes inside the '
  'trade only. Written once by the poller under `where best_price is null`; '
  'null on a trade too short to hold one whole minute.';

-- ─── And Eugenia may see it ────────────────────────────────────────────────
-- APPENDED, AND NOTHING ELSE MOVES, for 006's reason: `create or replace view`
-- matches the existing view position by position, so the new column goes on
-- the end of the list or Postgres refuses the statement.
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
