-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — schema
-- ───────────────────────────────────────────────────────────────────────────
-- One table, four writers: the poller and the email function on the broker
-- side, index.html and doji-gladys on the journal side. The two halves never
-- write the same column, so there is nothing to arbitrate between them.
--
-- Run once, in the SQL editor, on a fresh project.
-- ═══════════════════════════════════════════════════════════════════════════

-- Defined before the table because the trigger below references it. The
-- default covers the INSERT; this moves the column on every UPDATE.
create or replace function public.trades_touch()
returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;

create table public.trades (
  -- `PID` + the cTrader position id. Both broker writers mint it the same way,
  -- which is what lands them on one row.
  id            text primary key,

  -- Defaults to the signed-in user for the app. The Edge Functions run under
  -- the secret key, where auth.uid() is null, and supply it explicitly.
  user_id       uuid not null default auth.uid()
                references auth.users(id) on delete cascade,

  -- ── Broker-owned: written by doji-mcp-sync and doji-email-sync only.
  direction     text,
  entry_time    timestamptz,
  fill_time     timestamptz,
  entry_price   numeric,
  exit_price    numeric,
  -- Ounces, the unit both broker sources state. The only route to account size
  -- (lots = oz / 100), and what lets a row reproduce its own P&L. Poller only:
  -- a position it never reached carries none.
  size_oz       numeric,
  -- Positive magnitude, recorded and never displayed. Both P&L figures are
  -- already net of it, so subtracting it anywhere double-counts.
  commission    numeric,
  balance       numeric,
  -- The New York civil day the position opened: the filing anchor, so a 21:05
  -- entry stays on its own day rather than drifting with UTC.
  open_day      date,

  -- net_pnl is the broker's settled figure and includes swap; computed_pnl is
  -- folded from deals and does not. pnl states which wins, once, here.
  net_pnl       numeric,
  computed_pnl  numeric,
  pnl           numeric generated always as (coalesce(net_pnl, computed_pnl)) stored,

  -- ── Journal-owned: written by index.html and doji-gladys, through the same
  --    four names. Three-state booleans: null is unanswered, not "no", so a
  --    blank never counts as a miss.
  setup         text,
  followed_rules boolean,
  followed_sl    boolean,
  followed_tp    boolean,

  -- ── Bookkeeping. Soft delete, because the poller re-upserts every position
  --    in its window and would undo a hard one. It never sends this column.
  deleted       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The Telegram message Gladys posted for this trade, so an answer written
  -- anywhere can redraw it. Hers alone: in neither Data.OWNED nor her COLUMNS.
  tg_message_id bigint,

  constraint trades_direction_check check (direction in ('BUY', 'SELL')),
  constraint trades_setup_check     check (setup in ('Break & Retest', 'Support & Resistance')),
  -- cTrader reports commission negative; the poller stores the magnitude.
  constraint trades_commission_nonneg check (commission is null or commission >= 0)
);

-- The client's only read: one user's trades, newest day first. The DESC lets
-- the index serve the sort as well as the filter.
create index trades_user_open_day on public.trades (user_id, open_day desc);

create trigger trades_touch_updated_at
  before update on public.trades
  for each row execute function public.trades_touch();

-- The publishable key is public, so RLS is what stands behind it. 011 narrows
-- the columns an app session may write.
alter table public.trades enable row level security;

create policy "own trades" on public.trades
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- So a fill from the poller appears in an open tab without a reload.
alter publication supabase_realtime add table public.trades;
