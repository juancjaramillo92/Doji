-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — schema
-- ───────────────────────────────────────────────────────────────────────────
-- One table. Four writers reach it: two Edge Functions on the broker side
-- (doji-mcp-sync, doji-email-sync), and on the journal side index.html and
-- doji-gladys. Journal columns and broker columns never meet, which is why
-- there is nothing here to arbitrate between them. Nothing else exists:
-- `records`, `broker_fills` and `app_state` were dropped when the sync
-- replaced them.
--
-- Run once, in the SQL editor, on a fresh project.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── updated_at ────────────────────────────────────────────────────────────
-- Defined before the table, because the trigger below references it. The
-- column has a default for the INSERT; this is what moves it on every UPDATE,
-- which is what the client's realtime subscription is keyed to.
create or replace function public.trades_touch()
returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;

-- ─── trades ────────────────────────────────────────────────────────────────
create table public.trades (
  -- `PID` + the cTrader position id. The poller and the email parser both mint
  -- it the same way, which is what lands two sources on one row instead of two.
  id            text primary key,

  -- NOT NULL with an auth.uid() default: index.html writes as the signed-in
  -- user and gets it for free, while the Edge Functions run under the service
  -- key, where auth.uid() is null and the owner must be supplied explicitly.
  user_id       uuid not null default auth.uid()
                references auth.users(id) on delete cascade,

  -- ── Broker-owned. doji-mcp-sync and doji-email-sync write these; the client
  --    displays them and never computes them.
  direction     text,
  entry_time    timestamptz,
  fill_time     timestamptz,
  entry_price   numeric,
  exit_price    numeric,
  -- Position size in OUNCES, which is the unit both broker sources state it in:
  -- cTrader sends a volume the poller divides by 100, and the alert email prints
  -- it as `Volume  Oz 4.00`. Stored rather than folded away because it is the
  -- only route to account size — lots are oz / 100 — and because it is what
  -- makes a row reproduce its own P&L: gross is the price move times this.
  --
  -- Written by the poller alone. The email boundary stays at its five columns,
  -- so a position the poller never reached carries no size and never will.
  size_oz       numeric,
  -- Recorded and never displayed. The P&L stored here is already net of it, so
  -- subtracting it anywhere would double-count. Captured because the value
  -- exists only at sync time — a panel that wants it later gets history rather
  -- than starting from the day it was added.
  commission    numeric,
  balance       numeric,
  -- The New York civil day the position OPENED. The filing anchor, so an entry
  -- at 21:05 New York stays on its own day rather than drifting with UTC.
  open_day      date,

  -- Two P&L sources, and they disagree: net_pnl comes from the broker email and
  -- includes swap, computed_pnl is folded from deals and does not.
  net_pnl       numeric,
  computed_pnl  numeric,
  -- Generated, so "the email beats the computed figure" is stated once, in the
  -- schema, rather than reimplemented in every client that reads a P&L.
  pnl           numeric generated always as (coalesce(net_pnl, computed_pnl)) stored,

  -- ── Journal-owned. Written by index.html and doji-gladys, through the same
  --    four names; neither broker writer ever sends them.
  setup         text,
  -- Booleans with three states. null is unanswered, which is NOT the same as
  -- no: every broker fill arrives with all three null, so a blank must never
  -- count as a miss or an entry nobody got round to would permanently depress
  -- every compliance rate it touches.
  followed_rules boolean,
  followed_sl    boolean,
  followed_tp    boolean,

  -- ── Bookkeeping.
  -- Soft delete. It has to be soft: the poller re-upserts every position inside
  -- its window, so a hard delete would be undone within two minutes. The poller
  -- never sends this column, which is what makes the flag survive every later
  -- write.
  deleted       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The Telegram message Gladys posted for this trade, so a journal answer
  -- written anywhere else can redraw it instead of leaving it showing an empty
  -- trade. Hers alone: it is in neither Data.OWNED nor her COLUMNS map, so
  -- nothing can name it from a save or from a tap, and null simply means there
  -- is no message to edit — an email-first row never had one.
  tg_message_id bigint,

  -- Vocabularies enforced here rather than trusted to the client, so an invalid
  -- value cannot arrive from the app, from a hand-edit, or from anywhere else.
  constraint trades_direction_check check (direction in ('BUY', 'SELL')),
  constraint trades_setup_check     check (setup in ('Break & Retest', 'Support & Resistance')),
  -- cTrader reports commission negative; the poller stores the magnitude.
  constraint trades_commission_nonneg check (commission is null or commission >= 0)
);

-- Every read the client makes is one user's trades, newest day first. The
-- descending open_day is deliberate: it matches the order the query asks for,
-- so the index serves the sort as well as the filter.
create index trades_user_open_day on public.trades (user_id, open_day desc);

create trigger trades_touch_updated_at
  before update on public.trades
  for each row execute function public.trades_touch();

-- ─── Access ────────────────────────────────────────────────────────────────
-- One policy for all four verbs. Single-user in practice, but the row is still
-- scoped to its owner rather than left open — the publishable key in
-- index.html is public, and RLS is the only thing standing behind it.
alter table public.trades enable row level security;

create policy "own trades" on public.trades
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Realtime. The client subscribes to changes on this table so a fill arriving
-- from the poller appears without a reload.
alter publication supabase_realtime add table public.trades;
