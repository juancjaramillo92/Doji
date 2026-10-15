-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — the database
-- ───────────────────────────────────────────────────────────────────────────
-- Every table, function, trigger, grant and schedule, as the database should
-- hold them now. SAFE TO RE-RUN IN FULL, and that is how it is applied: paste
-- the whole file into the SQL editor and run it, on a fresh project or on the
-- live one, and the database matches the file. Every statement is `if not
-- exists`, `or replace`, `on conflict do nothing` or guarded by a check.
--
-- verify.sql is how the claim is tested; run it after any change.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ Extensions ════════════════════════════════════════════════════════════

-- Trigram matching for her memory search, and vectors for the search by
-- meaning; both before the tables whose columns and indexes use them.
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ═══ Trades ═════════════════════════════════════════════════════════════

-- One table, four writers: the poller and the email function on the broker
-- side, index.html and doji-gladys on the journal side. The two halves never
-- write the same column, so there is nothing to arbitrate between them.

-- Defined before the table because the trigger below references it. The
-- default covers the INSERT; this moves the column on every UPDATE.
create or replace function public.trades_touch()
returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;

create table if not exists public.trades (
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

  -- The stop and target as the poller first saw them on the open position — a
  -- closed one reports the final stop, which R-04 may have moved — and the
  -- best price it reached, off whole minutes inside the trade. Each written
  -- once under `where <column> is null`. Broker-owned, absent from Data.OWNED.
  planned_sl    numeric,
  planned_tp    numeric,
  best_price    numeric,

  constraint trades_direction_check check (direction in ('BUY', 'SELL')),
  constraint trades_setup_check     check (setup in ('Break & Retest', 'Support & Resistance')),
  -- cTrader reports commission negative; the poller stores the magnitude.
  constraint trades_commission_nonneg check (commission is null or commission >= 0)
);

-- The client's only read: one user's trades, newest day first. The DESC lets
-- the index serve the sort as well as the filter.
create index if not exists trades_user_open_day on public.trades (user_id, open_day desc);

create or replace trigger trades_touch_updated_at
  before update on public.trades
  for each row execute function public.trades_touch();

-- The publishable key is public, so RLS is what stands behind it. The grants
-- below narrow the columns an app session may write.
alter table public.trades enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'trades'
                    and policyname = 'own trades') then
    create policy "own trades" on public.trades
      for all
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- So a fill from the poller appears in an open tab without a reload.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'trades') then
    alter publication supabase_realtime add table public.trades;
  end if;
end $$;

comment on column public.trades.planned_sl is
  'Stop as first seen on the open position, in display price. Written once by '
  'the poller under `where planned_sl is null`; null on every trade that closed '
  'before this column existed.';

comment on column public.trades.planned_tp is
  'Target as first seen on the open position, in display price. Same writer and '
  'the same one-shot rule as planned_sl.';

comment on column public.trades.best_price is
  'Best price the position reached while open — the highest bid on a buy, the '
  'lowest on a sell — from the broker''s minute bars, whole minutes inside the '
  'trade only. Written once by the poller under `where best_price is null`; '
  'null on a trade too short to hold one whole minute.';

-- ═══ What the app may write ═════════════════════════════════════════════

-- The policy on trades decides which ROWS a session may write, not which
-- columns, and Supabase's default privileges grant anon and authenticated
-- everything on a new table by name — so any signed-in session could update
-- net_pnl through PostgREST. This narrows the app to the columns it owns: five,
-- not Data.OWNED's four, because delete and undo write `deleted` directly.
-- agree.test.mjs holds the list against both. To roll back to Supabase's
-- defaults, with RLS still behind them:
--
--     grant insert, update, delete on public.trades to anon, authenticated;

-- SELECT is untouched: the app and realtime read every column. PUBLIC and both
-- roles by name, for eugenia_search's reason.
revoke insert, update, delete on public.trades from public, anon, authenticated;

-- The four journal answers and the soft-delete flag.
grant update (setup, followed_rules, followed_sl, followed_tp, deleted)
  on public.trades to authenticated;

-- No INSERT: every row arrives from a broker writer holding the secret key.
-- No DELETE: a removal is the `deleted` flag, and the history stays.

-- ═══ Gladys ═════════════════════════════════════════════════════════════

-- A position opens: she asks the four journal questions in Telegram. Its
-- answers move from anywhere else: she redraws the message she already sent.
-- One function sends both. Needs doji-gladys deployed and the cron secret in
-- Vault.

-- security definer, because vault.decrypted_secrets is not readable by
-- service_role, the role the poller's upsert arrives under. The search_path is
-- emptied and every name qualified, so nothing resolves through a schema
-- someone else controls.
--
-- Sends the eight columns the message draws and no others; to_jsonb(new)
-- would hand user_id and the balance to a function with no use for either.
--
-- Answering followed_sl and followed_tp at open records intent, not outcome:
-- the message arrives seconds after the fill. A missed later edit reads as
-- compliance, so those two bars lean upward and nothing in the data shows it.
create or replace function public.trades_telegram()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret  text;
  payload jsonb;
  req     bigint;
begin
  -- Lower case: Vault compares names case-sensitively and a miss yields null.
  secret := (select decrypted_secret from vault.decrypted_secrets
              where name = 'doji_cron_secret');

  -- Raising here would fail the write that fired it. The message is the
  -- expendable half; the fill is not.
  if secret is null then
    raise warning 'trades_telegram: doji_cron_secret not in Vault — no message sent';
    return null;
  end if;

  payload := jsonb_build_object(
    'id',             new.id,
    'direction',      new.direction,
    'entry_price',    new.entry_price,
    'entry_time',     new.entry_time,
    'setup',          new.setup,
    'followed_rules', new.followed_rules,
    'followed_sl',    new.followed_sl,
    'followed_tp',    new.followed_tp);

  -- The body says which trigger fired: an update names the message to edit and
  -- the answers as they stood before. doji-gladys decides whether the redraw
  -- settles the form from that before-state, exactly as a tap does, so a tap —
  -- which fires this too — draws the identical message twice and the second
  -- edit is a no-op rather than a fight.
  if tg_op = 'UPDATE' then
    payload := payload || jsonb_build_object(
      'tg_message_id', new.tg_message_id,
      'before', jsonb_build_object(
        'setup',          old.setup,
        'followed_rules', old.followed_rules,
        'followed_sl',    old.followed_sl,
        'followed_tp',    old.followed_tp));
  end if;

  req := net.http_post(
    url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-gladys',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-doji-key', secret),
    body    := payload,
    -- A cold start plus a read, a write and a Telegram call can outrun pg_net's
    -- default; the poller's job sets the same bound.
    timeout_milliseconds := 20000
  );

  -- Recorded in the dispatch ledger, behind its own handler: this runs inside
  -- the write that fired it, and a monitor must never fail the work it watches.
  begin
    insert into public.dispatch (id, job) values (req, 'gladys');
  exception when others then null;
  end;
  return null;
end $$;

-- ONE HOUR, AND IT IS LOAD-BEARING: without it a restore from backup would
-- message him once per row. A live fill is seconds old; everything else fails:
--   · a restore — existing ids take ON CONFLICT DO UPDATE, which never reaches
--     an insert trigger, and new ones carry their historical entry_time;
--   · an email-first row — it has no entry_time, `null > …` is null, and a
--     WHEN that is not true does not fire. No open event, no prompt;
--   · a ?force=1 backfill — old entry_times;
--   · the poller's re-upserts — only the first write is an INSERT.
-- `create or replace trigger` is atomic: no moment where an insert goes
-- unannounced, as a drop and recreate would leave.
create or replace trigger trades_telegram_on_open
  after insert on public.trades
  for each row
  when (new.entry_time > now() - interval '1 hour')
  execute function public.trades_telegram();

-- The four journal columns only: broker writes and the soft delete change
-- nothing the message says. `is distinct from`, never `<>`, because these are
-- three-state and `<>` is null against an unanswered one, so the first answer
-- to every question would never redraw. No time guard: this edits rather than
-- posts, and a row with no message fails the first clause.
create or replace trigger trades_telegram_on_answer
  after update on public.trades
  for each row
  when (new.tg_message_id is not null
        and (new.setup          is distinct from old.setup
          or new.followed_rules is distinct from old.followed_rules
          or new.followed_sl    is distinct from old.followed_sl
          or new.followed_tp    is distinct from old.followed_tp))
  execute function public.trades_telegram();

-- ═══ Her memory ═════════════════════════════════════════════════════════

-- Her conversation (eugenia_turns), what stays true about him for weeks
-- (eugenia_notes), where he stands on the five channels (eugenia_channels),
-- and a read-only view of his journal (eugenia_trades). Nothing here writes
-- `trades`.

-- ─── Her conversation ──────────────────────────────────────────────────────
-- No user_id and no policy: only the Edge Function reads it, with the secret
-- key. RLS on with no policy denies the publishable key outright.
create table if not exists public.eugenia_turns (
  id         bigserial primary key,
  role       text not null,
  content    text not null,
  created_at timestamptz not null default now(),

  -- The two roles the Messages API accepts, so a bad write fails here rather
  -- than as a 400 from Claude.
  constraint eugenia_turns_role_check check (role in ('user', 'assistant')),

  -- Generated and stored, like trades.pnl: a derived value with no write path
  -- of its own cannot disagree with what it derives from.
  search     tsvector generated always as (to_tsvector('english', content)) stored,

  -- Null on any row whose embedding call failed, since the write stores the
  -- turn either way; ?embed=1 and the nightly sweep fill them.
  embedding  vector(1536)
);

create index if not exists eugenia_turns_id_desc on public.eugenia_turns (id desc);

alter table public.eugenia_turns enable row level security;

-- ─── Her view of the journal ───────────────────────────────────────────────
-- A view rather than the table: it fixes the columns — no user_id, balance or
-- commission — and filters deleted rows.
--
-- security_invoker, because a view's default runs with its OWNER's rights,
-- which makes RLS depend on whoever ran this file. With it the reader's own
-- rights apply: service_role bypasses RLS anyway, and a grant widened by
-- mistake leaks nothing.
--
-- `create or replace view` matches columns by position, so a new column goes
-- on the END of the list or Postgres refuses the statement. That is why the
-- tail is in the order columns were added. Removing or reordering needs a
-- drop, which takes the grants with it.
--
-- net_pnl is here because pnl alone cannot be summed honestly: on a position
-- whose email has not landed pnl is the folded figure, with no swap in it.
create or replace view public.eugenia_trades
  with (security_invoker = true) as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         open_day, setup, followed_rules, followed_sl, followed_tp, size_oz,
         net_pnl, planned_sl, planned_tp, best_price
  from public.trades
  where deleted = false;

-- A single-table view is auto-updatable, so SELECT is stated as the only verb.
revoke all on public.eugenia_trades from anon, authenticated, service_role;
grant select on public.eugenia_trades to service_role;

-- An invoker's-rights view does not borrow its owner's access to `trades`.
-- Supabase's defaults already grant this; stated so a database without them
-- does not lose the journal silently.
grant select on public.trades to service_role;

-- This makes the VIEW read-only, not the key. What keeps her off `trades` is
-- structural: one database read of the journal in her function, no write path,
-- and a test on the query it builds.

-- ─── What stays true about him ─────────────────────────────────────────────
-- Three kinds — a `fact` she noticed, an `instruction` he gave her, and a
-- `commitment` he made — read as separate windows, so twenty ordinary
-- observations can never evict a standing instruction.
--
-- Append-only. A correction is a newer note naming the old one in
-- superseded_by, which keeps the trail and takes the old line out of the read.
create table if not exists public.eugenia_notes (
  id         bigserial primary key,
  note       text not null,
  -- A row written without a kind is an observation, the harmless default.
  kind       text not null default 'fact',
  created_at timestamptz not null default now(),

  -- One sentence. The function truncates at 200 too; this is the limit stated
  -- where it cannot be bypassed.
  constraint eugenia_notes_note_length check (char_length(note) between 1 and 200),
  -- A commitment is read the other way from an instruction: she obeys one and
  -- holds the other against his trades, so it is its own window.
  constraint eugenia_notes_kind_check check (kind in ('fact', 'instruction', 'commitment')),

  superseded_by bigint references public.eugenia_notes(id),

  search     tsvector generated always as (to_tsvector('english', note)) stored,
  embedding  vector(1536)
);

-- Partial, matching the read exactly: a retired note is never selected.
create index if not exists eugenia_notes_kind_id_desc on public.eugenia_notes (kind, id desc)
  where superseded_by is null;

alter table public.eugenia_notes enable row level security;

-- ─── Search over both ──────────────────────────────────────────────────────
-- She is handed twelve turns and twenty notes per kind; everything older is
-- reachable only by search. Widening the windows would pay for the archive on
-- every request. The search function is below, once both arms' indexes exist.
create index if not exists eugenia_notes_search on public.eugenia_notes using gin (search);
create index if not exists eugenia_turns_search on public.eugenia_turns using gin (search);

-- HNSW needs no training pass over rows that fill in over days. Cosine, to
-- match the query's `<=>`: an index for another operator falls back to a full
-- scan silently.
create index if not exists eugenia_notes_embedding
  on public.eugenia_notes using hnsw (embedding vector_cosine_ops);
create index if not exists eugenia_turns_embedding
  on public.eugenia_turns using hnsw (embedding vector_cosine_ops);

-- ─── Where he stands on each channel ───────────────────────────────────────
-- Five rows, never a window, so a busy month cannot crowd one out — and the
-- only place an absence is visible: a channel he has never used is a row
-- saying `unseen`, where in the notes it would be nothing at all.
--
-- The row is the current answer. The trail of how he got there is the turns
-- and the notes, which are already searchable.
create table if not exists public.eugenia_channels (
  -- The id, not the spoken name; prompt.ts holds both.
  channel  text primary key
    constraint eugenia_channels_name_check check (channel in (
      'rates_vs_inflation', 'dollar', 'inflation', 'jobs', 'central_bank_buying')),

  state    text not null default 'unseen'
    constraint eugenia_channels_state_check check (state in (
      'unseen', 'explained', 'used', 'owns')),

  -- One line saying what last moved the rung.
  evidence text
    constraint eugenia_channels_evidence_length
      check (evidence is null or char_length(evidence) between 1 and 200),

  -- A New York civil day written by the function, not now(): now() is UTC and
  -- would file an evening move on tomorrow.
  moved_on date
);

-- Seeded, because a missing row would drop a channel out of her map silently.
insert into public.eugenia_channels (channel) values
  ('rates_vs_inflation'), ('dollar'), ('inflation'), ('jobs'), ('central_bank_buying')
on conflict (channel) do nothing;

alter table public.eugenia_channels enable row level security;

-- ═══ Her senses ═════════════════════════════════════════════════════════

-- Her meters, her calendar, the running story, her open threads, his taps
-- under a briefing, the price mark, trigram search over her memory, the
-- trigger that tells her a position opened or closed, and the three tables the
-- app's card may read.

-- ─── What each call cost ───────────────────────────────────────────────────
-- One row per model call, plus rows for a delivered briefing, the gates'
-- verdicts, the nightly meters and a job that died before its first call. A
-- console line is gone within hours; this is where the meters survive.
-- Instrumentation for him, never read back into her context.
create table if not exists public.eugenia_runs (
  id         bigserial primary key,
  at         timestamptz not null default now(),

  -- The caller's label. Free text, so a new caller needs no migration.
  caller     text not null,
  effort     text,
  rounds     int,

  -- Searches and fetches are counted apart from tokens and from each other:
  -- each bills on its own tariff.
  in_tokens  int,
  cached     int,
  out_tokens int,
  searches   int,
  fetches    int,

  -- What filling the cache cost. A read (`cached`) is a twentieth of the input
  -- rate; a write is 1.25× at five minutes and 2× at an hour, so the two TTLs
  -- are kept apart — their sum is not money.
  wrote_1h   int,
  wrote_5m   int,

  chars      int,

  -- Which model ran, and which answered when `fallbacks` stepped in.
  model      text,
  fell_back  text,

  ms         int,
  ok         boolean not null default true,
  detail     text
);

create index if not exists eugenia_runs_at_desc on public.eugenia_runs (at desc);
create index if not exists eugenia_runs_caller_at on public.eugenia_runs (caller, at desc);

alter table public.eugenia_runs enable row level security;

-- ─── The calendar ──────────────────────────────────────────────────────────
-- What lands and what it printed: the US releases, and from abroad what she
-- reads the dollar through. It compounds: in a year it is how each release ran
-- against expectations. Filed from TradingView; she writes nothing to it.
create table if not exists public.eugenia_calendar (
  id         bigserial primary key,

  -- UTC; everything shown to a person is formatted in New York.
  at         timestamptz not null,

  name       text not null,

  -- Only 'high' counts for his rules, and only at home.
  importance text not null default 'high'
    constraint eugenia_calendar_importance_check check (importance in ('high', 'medium', 'low')),

  -- Text, because a consensus is "0.3%", "175K" or "unchanged at 4.25-4.50%".
  consensus  text,
  prior      text,
  actual     text,

  source     text,

  created_at timestamptz not null default now(),

  -- Which of two disagreeing rows is the later one. Moved by the trigger below
  -- on a change to content only.
  updated_at timestamptz not null default now(),

  -- TradingView's id: one release, one row, whatever it is called. Her older
  -- typed rows carry none.
  tv_id      text,

  -- The series a release belongs to, the same across months.
  ticker     text
);

-- The filing re-upserts every row each quarter hour, so updated_at moves only
-- when the content changed, or it would say when a row was last filed rather
-- than last changed. Compared as jsonb less updated_at, so a column added later
-- is compared without anyone remembering to list it.
create or replace function public.eugenia_calendar_touch()
returns trigger
language plpgsql
as $$ begin
  if to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at' then
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace trigger eugenia_calendar_touch_updated_at
  before update on public.eugenia_calendar
  for each row execute function public.eugenia_calendar_touch();

-- Where a release is from. Every rule that reads one is about the US, and the
-- rest is filed as context, so the rules filter on this. Added after the
-- table, so a fresh build and the live one end with the same column order; the
-- default is the US because every row filed before it was.
alter table public.eugenia_calendar add column if not exists country text not null default 'US';

create index if not exists eugenia_calendar_at on public.eugenia_calendar (at desc);

-- A plain unique index rather than a constraint or a partial one, because
-- PostgREST's `on_conflict=tv_id` must infer it; nulls do not collide.
create unique index if not exists eugenia_calendar_tv_id on public.eugenia_calendar (tv_id);
create index if not exists eugenia_calendar_ticker on public.eugenia_calendar (ticker, at desc);

alter table public.eugenia_calendar enable row level security;

-- ─── The market, read ahead ────────────────────────────────────────────────
-- What doji-tradingview's two long doors last answered, one row per door,
-- rewritten by the quarter-hourly job, so a briefing or a reply reads the
-- market here rather than waiting on TradingView. A cache that never grows,
-- so it is not backed up; the next quarter hour refills it.
create table if not exists public.eugenia_market (
  door    text primary key,
  answer  jsonb not null,
  read_at timestamptz not null default now()
);

alter table public.eugenia_market enable row level security;

-- ─── The running story ─────────────────────────────────────────────────────
-- One row, rewritten nightly: a reading that is only ever current, so not a
-- list. Handed to every briefing, so a morning moves yesterday's story rather
-- than starting from nothing. Every briefing that stated it is in her turns.
create table if not exists public.eugenia_thesis (
  id         text primary key
    constraint eugenia_thesis_singleton check (id = 'current'),

  -- Longer than a note, far shorter than a briefing.
  thesis     text not null
    constraint eugenia_thesis_length check (char_length(thesis) between 1 and 600),

  -- A New York civil day written by the function, for eugenia_channels' reason.
  moved_on   date,
  updated_at timestamptz not null default now()
);

-- Seeded, so the read never has to tell "no row" from "nothing decided".
insert into public.eugenia_thesis (id, thesis) values
  ('current', 'No running thesis yet — this is written by the nightly pass once there is a story to carry.')
on conflict (id) do nothing;

alter table public.eugenia_thesis enable row level security;

-- ─── How she reads him ─────────────────────────────────────────────────────
-- The thesis's twin, about him: one row, rewritten nightly, carrying what the
-- notes add up to once the oldest have rolled out of the twenty she is shown.
-- No app policy: it is about him, and the card shows the market.
create table if not exists public.eugenia_portrait (
  id         text primary key
    constraint eugenia_portrait_singleton check (id = 'current'),

  -- Longer than the thesis, still a paragraph.
  portrait   text not null
    constraint eugenia_portrait_length check (char_length(portrait) between 1 and 800),

  -- A New York civil day written by the function, for eugenia_channels' reason.
  moved_on   date,
  updated_at timestamptz not null default now()
);

-- Seeded, so the PATCH always lands and the read never has to tell "no row"
-- from "nothing decided".
insert into public.eugenia_portrait (id, portrait) values
  ('current', 'No portrait yet — this is written by the nightly pass once there is enough to read.')
on conflict (id) do nothing;

alter table public.eugenia_portrait enable row level security;

-- ─── What the story and the portrait said before ───────────────────────────
-- Both are one row rewritten each night, and the portrait shapes every
-- briefing and reply. A rewrite that loses something true about him is
-- otherwise gone the moment it lands, with nothing to compare it against or
-- put back. So every change keeps the text it replaced, by trigger rather than
-- by the function, which never has to remember. Read by a person; nothing
-- hands it to her.
create table if not exists public.eugenia_rewrites (
  id          bigserial primary key,

  -- Which of the two, named as its table is less the prefix.
  kind        text not null
    constraint eugenia_rewrites_kind_check check (kind in ('thesis', 'portrait')),

  -- The text that was replaced, and the day it had last moved.
  body        text not null,
  moved_on    date,

  replaced_at timestamptz not null default now()
);

alter table public.eugenia_rewrites enable row level security;

-- One function for both, since each table's text column is named as its kind.
-- Compared as jsonb, as eugenia_calendar_touch compares, so neither column is
-- spelled here; a rewrite to the same words keeps nothing.
create or replace function public.eugenia_keep_rewrite()
returns trigger
language plpgsql
as $$
declare
  kind text := replace(tg_table_name, 'eugenia_', '');
begin
  if to_jsonb(old) ->> kind is distinct from to_jsonb(new) ->> kind then
    insert into public.eugenia_rewrites (kind, body, moved_on)
      values (kind, to_jsonb(old) ->> kind, old.moved_on);
  end if;
  return new;
end $$;

create or replace trigger eugenia_thesis_keep
  after update on public.eugenia_thesis
  for each row execute function public.eugenia_keep_rewrite();

create or replace trigger eugenia_portrait_keep
  after update on public.eugenia_portrait
  for each row execute function public.eugenia_keep_rewrite();

-- ─── Her record ────────────────────────────────────────────────────────────
-- Every read she gave, filed by the nightly pass with a verdict on the test
-- she stated — never on where price went. A row per read; she is handed the
-- last thirty days. Filed and judged in one write, so no row is ever open.
create table if not exists public.eugenia_reads (
  id         bigserial primary key,

  -- A New York civil day written by the function, for eugenia_channels' reason.
  given_on   date not null,

  reading    text not null
    constraint eugenia_reads_reading_length check (char_length(reading) between 1 and 300),
  test       text not null
    constraint eugenia_reads_test_length check (char_length(test) between 1 and 300),
  verdict    text not null
    constraint eugenia_reads_verdict_check check (verdict in ('held', 'wrong', 'untested')),
  evidence   text
    constraint eugenia_reads_evidence_length check (char_length(evidence) <= 300),

  created_at timestamptz not null default now()
);

-- What a retry's refiling lands on: the same words on the same day are one
-- read. A plain unique index, for PostgREST's `on_conflict` to infer.
create unique index if not exists eugenia_reads_once on public.eugenia_reads (given_on, reading);

-- How firmly she said it, read off her own words at night, so her record can
-- say whether her firm reads miss as often as her light ones; and on a miss,
-- the one link in the chain she misread, so a miss teaches rather than counts.
-- Added after the table, so a fresh build and the live one end with the same
-- column order; null on every read filed before them. That a lesson rides only
-- on a miss is the function's check: a column check may not name another.
alter table public.eugenia_reads add column if not exists firmness text
  constraint eugenia_reads_firmness_check check (firmness in ('light', 'firm'));
alter table public.eugenia_reads add column if not exists lesson text
  constraint eugenia_reads_lesson_length check (char_length(lesson) between 1 and 200);

-- ─── Her own calls ─────────────────────────────────────────────────────────
-- A paper trade she would take, on his rules, filed before she says it and
-- scored that night on what price did. Unlike a read, a call IS judged by where
-- price went: that is what it is for. The function checks his rules before the
-- insert; the table holds what no insert can get around.
create table if not exists public.eugenia_calls (
  id           bigserial primary key,
  made_at      timestamptz not null default now(),

  -- The next 17:00 New York roll on a weekday: the session the call belongs to.
  expires_at   timestamptz not null,

  direction    text not null
    constraint eugenia_calls_direction_check check (direction in ('buy', 'sell')),
  entry        numeric not null,
  stop         numeric not null,
  target       numeric not null,

  -- What price has to do before the entry is live, in words; the entry is what
  -- is scored.
  condition    text not null
    constraint eugenia_calls_condition_length check (char_length(condition) between 1 and 300),

  -- Null until the pass scores it, and the PATCH is filtered on that.
  outcome      text
    constraint eugenia_calls_outcome_check check (outcome in (
      'won', 'lost', 'scratch', 'open', 'untriggered', 'unread')),
  triggered_at timestamptz,
  closed_at    timestamptz,
  closed_price numeric,
  -- Dollars an ounce, signed: what the call made or lost.
  result       numeric
);

-- One call a session, as he takes one entry a day: a second in the same
-- session meets this and is refused. A plain unique index, so the insert's
-- 409 is the answer.
create unique index if not exists eugenia_calls_once on public.eugenia_calls (expires_at);

alter table public.eugenia_calls enable row level security;

alter table public.eugenia_reads enable row level security;

-- ─── Open threads ──────────────────────────────────────────────────────────
-- An odd thing she flagged (`watch`) or a question she asked him in a
-- conversation (`question`), handed back until the nightly pass closes it.
-- closed_on null is the whole read filter.
create table if not exists public.eugenia_loops (
  id         bigserial primary key,

  kind       text not null
    constraint eugenia_loops_kind_check check (kind in ('watch', 'question')),

  body       text not null
    constraint eugenia_loops_body_length check (char_length(body) between 1 and 200),

  opened_on  date not null,
  closed_on  date,

  -- What it turned out to be, written when it closes.
  resolution text
    constraint eugenia_loops_resolution_length
      check (resolution is null or char_length(resolution) between 1 and 200),

  created_at timestamptz not null default now()
);

-- Partial, matching the read: a closed thread is never selected.
create index if not exists eugenia_loops_open
  on public.eugenia_loops (kind, id desc) where closed_on is null;

alter table public.eugenia_loops enable row level security;

-- ─── His taps under a briefing ─────────────────────────────────────────────
-- One input to the nightly pass, never a score: a bot optimising a thumbs-up
-- writes briefings that flatter rather than teach.
create table if not exists public.eugenia_feedback (
  id         bigserial primary key,

  -- The briefing's day, so a late tap files against the morning it was about.
  on_day     date not null,

  verdict    text not null
    constraint eugenia_feedback_verdict_check check (verdict in ('good', 'off')),

  created_at timestamptz not null default now(),

  -- One verdict a day; the function's upsert makes the last tap win.
  constraint eugenia_feedback_one_a_day unique (on_day)
);

alter table public.eugenia_feedback enable row level security;

-- ─── Search that survives a rephrasing ─────────────────────────────────────
-- Trigram matching catches the typos and half-remembered quotes stemming
-- cannot, inside Postgres.

create index if not exists eugenia_notes_trgm
  on public.eugenia_notes using gin (note gin_trgm_ops);
create index if not exists eugenia_turns_trgm
  on public.eugenia_turns using gin (content gin_trgm_ops);

-- ─── A position opened or closed ───────────────────────────────────────────
-- Tells her within two minutes of the poller seeing it. What she may say is his
-- own rules read back — R-14/R-19 on a print pending against an open position,
-- R-11 on a close that took the day past its limit — and the function decides
-- from data before any model call, so the common case costs nothing.
create or replace function public.trades_eugenia_on_event()
returns trigger
language plpgsql
security definer
-- Emptied and every name qualified, for trades_telegram's reason.
set search_path = ''
as $$
declare
  kind text;
  req  bigint;
begin
  if tg_op = 'INSERT' then
    kind := 'opened';
  else
    kind := 'closed';
  end if;

  req := net.http_post(
    url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                  where name = 'doji_cron_secret')),
    body    := jsonb_build_object('trade', new.id, 'event', kind),
    timeout_milliseconds := 60000
  );

  -- Behind its own handler, for trades_telegram's reason: this runs inside the
  -- write.
  begin
    insert into public.dispatch (id, job) values (req, 'trade-event');
  exception when others then null;
  end;
  return null;
end;
$$;

-- Broker rows only, never a soft-deleted one.
create or replace trigger trades_eugenia_opened
  after insert on public.trades
  for each row
  when (new.id like 'PID%' and new.deleted = false and new.fill_time is null)
  execute function public.trades_eugenia_on_event();

-- On the transition only: the poller re-upserts every two minutes and would
-- fire it on every tick otherwise. `is distinct from`, since `<>` is null
-- against the null it is moving away from.
create or replace trigger trades_eugenia_closed
  after update on public.trades
  for each row
  when (new.id like 'PID%' and new.deleted = false
        and old.fill_time is null and new.fill_time is distinct from null)
  execute function public.trades_eugenia_on_event();

-- ─── What the app may see ──────────────────────────────────────────────────
-- The three tables the dashboard card draws: the calendar, the story, the open
-- threads. Never her notes or turns, which stay denied to the publishable key.
-- They hold no user_id, so `using (true)` for a signed-in session is the honest
-- policy; the grants below keep the verb to SELECT.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'eugenia_calendar'
                    and policyname = 'eugenia_calendar_app_read') then
    create policy eugenia_calendar_app_read on public.eugenia_calendar
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'eugenia_thesis'
                    and policyname = 'eugenia_thesis_app_read') then
    create policy eugenia_thesis_app_read on public.eugenia_thesis
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'eugenia_loops'
                    and policyname = 'eugenia_loops_app_read') then
    create policy eugenia_loops_app_read on public.eugenia_loops
      for select to authenticated using (true);
  end if;
end $$;

grant select on public.eugenia_calendar to authenticated;
grant select on public.eugenia_thesis to authenticated;
grant select on public.eugenia_loops to authenticated;

-- ═══ Searching her memory ═══════════════════════════════════════════════

-- ─── The search itself ─────────────────────────────────────────────────────
-- Notes and turns ranked together, by text and by meaning. websearch_to_tsquery
-- rather than to_tsquery, because the query is model-written and to_tsquery
-- throws on an unbalanced quote. A retired note is returned marked, never
-- hidden. `source` says who a hit is: `note`, `you` (her) or `him`.
--
-- The lexical arm is the floor rather than a fallback: a vector is worse than
-- trigram where the thing asked for IS the string — a date, a ticker, R-08 —
-- and a row with no embedding never appears in a nearest-neighbour query.
--
-- `create or replace` cannot change an argument list, and a second signature
-- beside this one would be an overload: a call becomes ambiguous, and the new
-- function carries EXECUTE to PUBLIC. So the revoke and grant below belong to
-- this statement.

-- `qv` is text and cast inside: PostgREST sends JSON, and pgvector's input is
-- its text form, so text crosses that boundary without relying on a json cast.
create or replace function public.eugenia_search(q text, lim int default 12, qv text default null)
returns table (source text, id bigint, at timestamptz, retired boolean, body text)
language sql
stable
as $$
  with ask as (
    select websearch_to_tsquery('english', q) as tsq,
           case when qv is null or qv = '' then null else qv::vector(1536) end as vec
  ),

  /* The lexical arm. A full-text match outranks a trigram-only one, and with
     no query vector the fusion runs over this arm alone and keeps its order —
     so this file changes nothing until an embedding key exists. */
  lex as (
    select 'note' as src, n.id, n.created_at as at,
           n.superseded_by is not null as retired, n.note as body,
           n.search @@ (select tsq from ask) as exact,
           greatest(ts_rank(n.search, (select tsq from ask)),
                    word_similarity(q, n.note)) as score
      from public.eugenia_notes n
     where n.search @@ (select tsq from ask)
        or q <% n.note
    union all
    select case when t.role = 'user' then 'him' else 'you' end,
           t.id, t.created_at, false, t.content,
           t.search @@ (select tsq from ask),
           greatest(ts_rank(t.search, (select tsq from ask)),
                    word_similarity(q, t.content))
      from public.eugenia_turns t
     where t.search @@ (select tsq from ask)
        or q <% t.content
  ),

  /* The semantic arm: one nearest-neighbour scan per table, which the HNSW
     index serves. A limit rather than a distance threshold, which nobody can
     choose honestly across phrasings; the fusion wants ranks anyway.

     Both null checks are needed. A row with no embedding has no distance to
     order by, and with no query vector every distance is null, so the limit
     would feed arbitrary rows into the fusion. */
  sem_notes as (
    select 'note' as src, n.id, n.created_at as at,
           n.superseded_by is not null as retired, n.note as body,
           n.embedding <=> (select vec from ask) as dist
      from public.eugenia_notes n
     where n.embedding is not null and (select vec from ask) is not null
     order by dist
     limit greatest(1, least(coalesce(lim, 25), 25))
  ),
  sem_turns as (
    select case when t.role = 'user' then 'him' else 'you' end as src,
           t.id, t.created_at as at, false as retired, t.content as body,
           t.embedding <=> (select vec from ask) as dist
      from public.eugenia_turns t
     where t.embedding is not null and (select vec from ask) is not null
     order by dist
     limit greatest(1, least(coalesce(lim, 25), 25))
  ),

  /* Reciprocal rank fusion. ts_rank and cosine distance are on unrelated
     scales, so any weighted sum is a guessed constant; ranks need none. 60 is
     the published constant, untuned: it flattens the top few positions, so a
     row both arms found outweighs one that is first in either.

     Each arm is ranked here, again: a CTE's `order by` is not carried out of
     it, and numbering without it would rank in scan order. */
  ranked as (
    select src, id, at, retired, body,
           row_number() over (order by exact desc, score desc, at desc) as pos
      from lex
    union all
    select src, id, at, retired, body,
           row_number() over (order by dist) as pos
      from sem_notes
    union all
    select src, id, at, retired, body,
           row_number() over (order by dist) as pos
      from sem_turns
  )
  select src, id, at, retired, body
    from ranked
   group by src, id, at, retired, body
   order by sum(1.0 / (60 + pos)) desc, at desc
   limit greatest(1, least(coalesce(lim, 25), 25));
$$;

-- ─── And who may call it ───────────────────────────────────────────────────
-- The first two revokes are not one line twice. `public` is the PUBLIC
-- pseudo-role; anon and authenticated hold EXECUTE separately, from the
-- default privileges Supabase sets on the public schema, so revoking from
-- PUBLIC alone leaves them able to call it. verify.sql asks this of every
-- callable function.
revoke all on function public.eugenia_search(text, int, text) from public;
revoke all on function public.eugenia_search(text, int, text) from anon, authenticated;
grant execute on function public.eugenia_search(text, int, text) to service_role;

-- ═══ Whether the silent writers are writing ═════════════════════════════

-- The poller and the email function report failure to nobody, so either one
-- dying shows only as trades that never arrive. A heartbeat rather than an
-- alarm: an alarm cannot fire when the run stops happening at all — an
-- unscheduled job, a renamed function — and last_ok going cold sees both. Both
-- writers swallow a failed health write and fold deals exactly as before.

create table if not exists public.sync_health (
  -- One row per writer.
  id            text primary key,
  constraint sync_health_id_check check (id in ('poller', 'email')),

  -- Moved on success only, so staleness means "not running" as well as
  -- "running and failing".
  last_ok       timestamptz,

  -- Kept after a later success: a writer failing one run in three looks
  -- healthy by last_ok alone.
  last_error    text,
  last_error_at timestamptz,

  constraint sync_health_error_length check (last_error is null
                                        or char_length(last_error) between 1 and 500)
);

-- Seeded, because the writers PATCH: with no row, every heartbeat is a 200
-- that lands nowhere.
insert into public.sync_health (id) values ('poller'), ('email')
  on conflict (id) do nothing;

-- No policy: the writers and Eugenia hold the secret key, and RLS denies the
-- publishable key outright.
alter table public.sync_health enable row level security;

-- ═══ What pg_net sent, and what came back ═══════════════════════════════

-- A worker refused before it starts (a 546) runs no line of the function: no
-- eugenia_runs row, no apology, no heartbeat. The only witness is a row in
-- net._http_response, pruned within hours. So the watcher lives in Postgres
-- and posts to Telegram itself — a monitor that reported through the function
-- it watches would share its failure.

-- ─── The ledger ────────────────────────────────────────────────────────────
-- The request id net.http_post returns is the only link to the response row,
-- which carries no url. Every dispatch records it here.
create table if not exists public.dispatch (
  -- pg_net's request id, shared with the response row.
  id      bigint primary key,

  -- Named for the job, not the url: several post to one function and differ
  -- by a flag. agree.test.mjs holds this list against the dispatch sites.
  job     text not null,
  constraint dispatch_job_check check (job in (
    'poller', 'eugenia', 'eugenia-calendar', 'trade-event', 'gladys')),

  at      timestamptz not null default now(),

  -- Judged and dealt with, good or bad, so a failure is reported once.
  settled boolean not null default false,

  -- The request id of the report that named this row. A failure settles only
  -- once that report is known to have arrived: pg_net is asynchronous, and a
  -- report lost on the wire would otherwise end the outage's only mention.
  reported_by bigint
);

-- The two reads: unsettled oldest-first, partial so it scans only what is
-- pending, and a per-job count over the hour.
create index if not exists dispatch_unsettled
  on public.dispatch (at) where not settled;
create index if not exists dispatch_job_at
  on public.dispatch (job, at desc);

alter table public.dispatch enable row level security;

-- ─── What counts as a failure ──────────────────────────────────────────────
-- One definition, asked by dispatch_failures and by the repeat gate. `not
-- exists` over successes, because a request pg_net never answered has no row
-- to match a failure against. A null timed_out is an unknown outcome, and an
-- unknown outcome is not a success.
create or replace function public.dispatch_bad(req bigint)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from net._http_response r
     where r.id = req
       and not coalesce(r.timed_out, true)
       and r.error_msg is null
       and r.status_code between 200 and 299);
$$;

-- Takes its clock, so its verdict can be driven from planted rows. Both ends of
-- the window are needed: under fifteen minutes a request may still be in
-- flight, and past three hours pg_net has pruned the response, so every row
-- would read "no answer" on the day the watcher itself had stopped.
create or replace function public.dispatch_failures(now_ timestamptz default now())
returns table (id bigint, job text, at timestamptz, why text)
language sql
stable
as $$
  select d.id, d.job, d.at,
         case
           when r.id is null            then 'no answer'
           when r.error_msg is not null then left(r.error_msg, 120)
           when r.timed_out             then 'timed out'
           else 'HTTP ' || r.status_code
         end
    from public.dispatch d
    left join net._http_response r on r.id = d.id
   where not d.settled
     -- A report naming this row is in flight.
     and d.reported_by is null
     and d.at <= now_ - interval '15 minutes'
     and d.at >  now_ - interval '3 hours'
     and public.dispatch_bad(d.id)
   order by d.at;
$$;

-- ─── Which failures are worth a message ────────────────────────────────────
-- A job that comes round on its own is evidence only in quantity: one lost poll
-- heals two minutes later, and reporting each would teach him to ignore the
-- watcher. A one-shot job — the hourly one, the trade event, Gladys — is
-- evidence alone, since what it carried does not come again. Three in an hour
-- rather than three in a row, because consecutiveness cannot be read off rows
-- pg_net prunes.
create or replace function public.dispatch_repeats(job text)
returns boolean
language sql
immutable
as $$
  select job in ('poller', 'eugenia-calendar');
$$;

-- ─── Telling him ───────────────────────────────────────────────────────────
-- Both watchers post to Telegram themselves, with the bot token and the chat
-- id from Vault. The request id comes back, or null with a warning where either
-- name does not resolve, so each watcher decides what an unsent report means
-- to it: neither may record as said what was never sent. The Vault names are
-- lower case here and upper case as Edge secrets, compared case-sensitively;
-- verify.sql asks whether both resolve.
create or replace function public.tell_him(message text)
returns bigint
language plpgsql
as $$
declare
  token text := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'eugenia_bot_token');
  chat  text := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'telegram_chat_id');
begin
  if token is null or chat is null then
    raise warning 'tell_him: eugenia_bot_token or telegram_chat_id is not in Vault';
    return null;
  end if;
  return net.http_post(
    url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('chat_id', chat, 'text', message),
    timeout_milliseconds := 20000);
end;
$$;

-- ─── The report, and the settle ────────────────────────────────────────────
-- One message per sweep: five losses in ten minutes are one outage. Everything
-- judged is settled, reported or not, or it is said again every ten minutes.
create or replace function public.dispatch_watch(now_ timestamptz default now())
returns int
language plpgsql
as $$
declare
  told  text;
  n     int;
  req   bigint;
begin
  /* ── First, what happened to the last report ──────────────────────────────
     A report that arrived settles its rows; one that failed releases them to
     be said again on this sweep. */
  update public.dispatch d set settled = true
   where not d.settled and d.reported_by is not null
     and exists (select 1 from net._http_response r
                  where r.id = d.reported_by
                    and r.status_code between 200 and 299);

  update public.dispatch d set reported_by = null
   where not d.settled and d.reported_by is not null
     and exists (select 1 from net._http_response r
                  where r.id = d.reported_by
                    and (r.timed_out or r.status_code is null
                         or r.status_code not between 200 and 299));

  -- One set of rows for the message, the mark and the settle.
  create temporary table if not exists _said (id bigint, line text) on commit drop;
  delete from _said;

  insert into _said
  select f.id, format('· %s at %s — %s', f.job,
                      to_char(f.at at time zone 'America/New_York', 'HH24:MI'), f.why)
    from public.dispatch_failures(now_) f
   where not public.dispatch_repeats(f.job)
      /* Counts rows, settled or not, and shares only the predicate with
         dispatch_failures: the step below settles a suppressed failure on
         purpose, so a count of unsettled rows could never reach three. The
         fifteen-minute bound keeps an in-flight poll out of the count. */
      or (select count(*) from public.dispatch d
           where d.job = f.job
             and d.at >  now_ - interval '1 hour'
             and d.at <= now_ - interval '15 minutes'
             and public.dispatch_bad(d.id)) >= 3;

  told := (select string_agg(line, E'\n' order by id) from _said);
  n    := (select count(*) from _said);

  if n > 0 then
    req := public.tell_him('Something scheduled never ran, jefe.' || E'\n\n' || told);

    -- Marked, not settled: the next sweep learns whether it arrived. Unsent, it
    -- is left unsettled, so repairing a Vault name still delivers the outage.
    if req is not null then
      update public.dispatch set reported_by = req
       where id in (select id from _said);
    end if;
  end if;

  /* ── Then everything that needs no message ────────────────────────────────
     A 2xx, and a failure suppressed as one lost poll — the threshold counts
     rows, so settling it cannot hide the third in an hour. */
  update public.dispatch set settled = true
   where not settled and reported_by is null
     and at <= now_ - interval '15 minutes'
     and id not in (select id from _said);

  /* ── And giving up is explicit ────────────────────────────────────────────
     Past three hours pg_net has pruned the response and nothing can be
     adjudicated; a row that can never resolve would be reported forever. */
  update public.dispatch set settled = true
   where not settled and at <= now_ - interval '3 hours';

  return coalesce(n, 0);
end;
$$;

-- anon and authenticated by name, for eugenia_search's reason.
revoke execute on function public.dispatch_bad(bigint)            from public, anon, authenticated;
revoke execute on function public.dispatch_failures(timestamptz) from public, anon, authenticated;
revoke execute on function public.dispatch_repeats(text)         from public, anon, authenticated;
revoke execute on function public.dispatch_watch(timestamptz)    from public, anon, authenticated;
revoke execute on function public.tell_him(text)                  from public, anon, authenticated;

-- ═══ How much of the worker's clock the briefing spends ═════════════════

-- The cron half answers before it works, so a briefing killed at the wall
-- clock has already handed pg_net a 200: the ledger sees a healthy dispatch,
-- ask() never reaches its catch, no apology is sent, and each retry dies the
-- same way. So it is watched from both sides — the pace, a warning while there
-- is still room, and the absence, a briefing the day owed that never arrived.
-- It posts to Telegram itself, for the ledger's reason; eugenia_runs.ms already
-- holds what it needs.

-- ─── What there is to say, if anything ─────────────────────────────────────
-- Separate from the sending, and handed its clock, so its verdict can be
-- driven from planted rows.
--
-- It speaks at three-quarters of the 400s paid wall clock: the briefing's
-- ordinary swing is about 77s, so an ordinary heavy morning cannot reach it,
-- and the 100s left is more than one swing — early enough to act on.
--
-- `ms` is a lower bound on the wall clock, which started earlier and stops
-- later, so the largest single row crossing means the invocation did. There is
-- no invocation id to reassemble one with; the cost is lateness, never a false
-- alarm. Seven days, so the window holds a Sunday briefing.
--
-- `since` is when the watcher last spoke, so a run is said once rather than
-- every day it stays in the window. diagnose.sql passes none.
create or replace function public.pace_line(now_  timestamptz default now(),
                                            since timestamptz default null)
returns text
language plpgsql
stable
as $$
declare
  -- The paid worker wall clock, stated once; the message quotes it.
  ceiling_ms constant int := 400000;
  speak_at   constant int := ceiling_ms * 3 / 4;

  wd      int  := extract(dow  from now_ at time zone 'America/New_York')::int;
  hour    int  := extract(hour from now_ at time zone 'America/New_York')::int;
  today   date := (now_ at time zone 'America/New_York')::date;
  owed    text;
  worst   public.eugenia_runs;
  lines   text[] := '{}';
begin
  /* ── The absence ──────────────────────────────────────────────────────────
     Judged an hour past the last retry (retryDue's window), when the day can
     no longer produce one; earlier, it would report a briefing still being
     written. agree.test.mjs holds these hours against retryDue. */
  owed := case
            when wd between 1 and 5 and hour >= 12 then 'weekday'
            when wd = 0             and hour >= 21 then 'sunday'
          end;

  -- postBriefing writes this caller only after the briefing was sent.
  if owed is not null and not exists (
       select 1 from public.eugenia_runs
        where caller = owed || ' briefing delivered'
          and (at at time zone 'America/New_York')::date = today) then
    lines := lines || format(
      'No %s briefing landed today, jefe, and the last hour it could still have '
      || 'arrived has passed.',
      case owed when 'sunday' then 'Sunday open' else 'weekday' end);
  end if;

  /* ── The pace ─────────────────────────────────────────────────────────────
     Failed runs count: a turn that died still spent the clock. This
     watcher's own rows carry no `ms`, so they fall out unnamed. */
  worst := (select r from public.eugenia_runs r
             where r.ms is not null
               and r.at > now_ - interval '7 days'
               and (since is null or r.at > since)
             order by r.ms desc
             limit 1);

  -- Each finding carries its own consequence, with no heading over both: one
  -- heading cannot be true of a slow briefing and a missing one.
  if worst.ms >= speak_at then
    lines := lines || format(
      'Longest run in the last seven days: %s, %ss against the worker''s %ss '
      || 'ceiling (%s). Past that it is killed mid-draft — nothing sent, no '
      || 'apology, and nothing else here can see it.',
      worst.caller, round(worst.ms / 1000.0), ceiling_ms / 1000,
      to_char(worst.at at time zone 'America/New_York', 'Dy HH24:MI'));
  end if;

  if cardinality(lines) = 0 then
    return null;
  end if;

  return array_to_string(lines, E'\n\n');
end;
$$;

-- ─── Saying it, at most once a day ─────────────────────────────────────────
-- The guard is the message rather than the run, or a midnight "checked" would
-- silence the day the briefing failed to arrive. Both outcomes leave a row in
-- eugenia_runs, so a quiet day is told apart from a watcher nobody calls. A
-- message that could not be sent leaves none: the row is the guard, and
-- writing it then would swallow the warning once the Vault name was repaired.
create or replace function public.pace_watch(now_ timestamptz default now())
returns text
language plpgsql
as $$
declare
  today date := (now_ at time zone 'America/New_York')::date;
  said  text := public.pace_line(now_, (select max(r.at) from public.eugenia_runs r
                                          where r.caller = 'pace' and not r.ok
                                            and r.at <= now_));
begin
  if said is not null and not exists (
       select 1 from public.eugenia_runs
        where caller = 'pace' and not ok
          and (at at time zone 'America/New_York')::date = today) then

    if public.tell_him(said) is null then
      return null;
    end if;
    insert into public.eugenia_runs (caller, ok, detail) values ('pace', false, said);
    return said;
  end if;

  -- The quiet day's one row.
  if said is null and not exists (
       select 1 from public.eugenia_runs
        where caller = 'pace'
          and (at at time zone 'America/New_York')::date = today) then
    insert into public.eugenia_runs (caller, ok, detail) values ('pace', true, 'clear');
  end if;

  return null;
end;
$$;

-- anon and authenticated by name, for eugenia_search's reason.
revoke execute on function public.pace_line(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.pace_watch(timestamptz)            from public, anon, authenticated;

-- ═══ Every stop and target a position carried ═══════════════════════════

-- R-19 asks where the stop and target sat when a print landed. planned_sl and
-- planned_tp keep the plan as first seen and a closed position reports its
-- final stop, so every move between was lost — and the broker keeps none of
-- it after the close. The poller writes a row only when either side differs
-- from the last one for that position, so `seen_at` is "as first seen".

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

-- ═══ The TradingView sign-in ════════════════════════════════════════════

-- One row, written and read by doji-tradingview alone: the OAuth client, the
-- tokens, and between ?connect=1 and the callback the state and PKCE verifier.
-- A table rather than an Edge secret because the refresh token may rotate on
-- every use and a function cannot rewrite its own secrets. Never in the memory
-- backup: a live refresh token in a workflow artefact is the account.

create table if not exists public.tradingview_auth (
  id                text primary key default 'current' check (id = 'current'),
  client_id         text,
  token_endpoint    text,
  resource          text,
  access_token      text,
  refresh_token     text,
  expires_at        timestamptz,
  pending_state     text,
  pending_verifier  text,

  -- A lease, taken by a PATCH filtered on it being empty or lapsed, so one
  -- renewal runs at a time: a rotating server may revoke a refresh token
  -- presented twice. A lease rather than a flag, so a holder that dies
  -- mid-renewal does not block every renewal after it.
  refreshing_until  timestamptz
);

alter table public.tradingview_auth enable row level security;

-- Both public roles by name, for eugenia_search's reason: a row holding a credential
-- gets two walls, not RLS alone.
revoke all on public.tradingview_auth from anon, authenticated;

-- ═══ Which calendar weeks were fetched whole ════════════════════════════

-- R-14 reads high-impact US releases from eugenia_calendar, and a week nobody
-- fetched reads exactly like a quiet week, in which every entry would pass. A
-- week is marked here only by a fetch of that whole week, after its releases
-- are written, so a mark never stands in front of missing rows.

create table if not exists public.calendar_weeks (
  -- The Sunday, New York, the week began on — R-14's `weekOf`.
  week        date        primary key,
  fetched_at  timestamptz not null default now()
);

alter table public.calendar_weeks enable row level security;

-- Both public roles by name, for eugenia_search's reason.
revoke all on public.calendar_weeks from anon, authenticated;

-- ═══ Everything that runs on a timer ════════════════════════════════════

-- Six jobs: the poller, Eugenia's hourly job and her quarter-hourly calendar,
-- the two watchers, and a nightly purge. No calling job holds database
-- power: each presents the cron secret, read from Vault at call time. Vault
-- names it lower case (doji_cron_secret), the Edge Functions upper case
-- (DOJI_CRON_SECRET), and Postgres compares Vault names case-sensitively — the
-- wrong spelling yields null and the caller gives up without raising anything.
-- Every dispatch records pg_net's request id in the ledger, so a failed call
-- can be attributed afterwards. The watchers and the purge make none.

-- ─── The poller ────────────────────────────────────────────────────────────
-- Every two minutes, all week. The market hours are decided in the function:
-- gold trades Sunday 17:00 to Friday 17:00 New York, which in UTC cron would be
-- three jobs, each an hour wrong for half the year. Off-hours calls answer
-- `skipped: market closed` and cost one invocation.
select cron.schedule(
  'doji-mcp-sync',
  '*/2 * * * *',
  $$
    insert into public.dispatch (id, job)
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-mcp-sync',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      -- A cold start, an MCP session, get_deals, an upsert and sometimes
      -- get_balance can outrun pg_net's default.
      timeout_milliseconds := 20000
    ), 'poller';
  $$
);

-- ─── Eugenia ───────────────────────────────────────────────────────────────
-- Hourly; dueNow() decides which hour owes what — the briefing, its retries,
-- the nightly pass — against New York's own clock, for the poller's reason. Most hours find nothing due and make no model call.
select cron.schedule(
  'doji-eugenia',
  '0 * * * *',
  $$
    insert into public.dispatch (id, job)
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      -- The function answers before it works, so this only bounds the answer.
      timeout_milliseconds := 300000
    ), 'eugenia';
  $$
);

-- ─── Her calendar ──────────────────────────────────────────────────────────
-- Files the calendar, so an actual lands within a quarter hour of printing. A
-- separate job, not a faster hourly one: every hourly schedule tests
-- `hour === n`, so */15 there would run four briefings a morning. Off the hour,
-- clear of the briefing.
select cron.schedule(
  'doji-eugenia-calendar',
  '5,20,35,50 * * * *',
  $$
    insert into public.dispatch (id, job)
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia?calendar=1',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      timeout_milliseconds := 120000
    ), 'eugenia-calendar';
  $$
);

-- ─── The dispatch watcher ──────────────────────────────────────────────────
-- A worker refused before it starts (a 546) leaves no row and no log of its
-- own; pg_net's response table is the only witness and it is pruned within
-- hours. Every ten minutes; it judges at fifteen, so a dispatch is judged on
-- the second sweep after it. It writes no dispatch row of its own: a watcher
-- in the ledger would be judged by the sweep it is part of.
select cron.schedule(
  'doji-dispatch-watch',
  '*/10 * * * *',
  $$ select public.dispatch_watch() $$
);

-- ─── The pace watcher ──────────────────────────────────────────────────────
-- Warns before a briefing outgrows the worker's wall clock, because once it
-- does the worker is killed with nothing left to report. It speaks at most
-- once a New York day and computes the day itself, so the hour does not
-- matter; 37 past keeps it off the briefing's dispatch.
select cron.schedule(
  'doji-pace-watch',
  '37 * * * *',
  $$ select public.pace_watch() $$
);

-- ─── Housekeeping ──────────────────────────────────────────────────────────
-- cron's own history grows ~750 rows a day and records only that the SQL ran,
-- so a week is plenty. Settled ledger rows go after a month.
select cron.schedule(
  'purge-cron-history',
  '0 3 * * *',
  $$
    delete from cron.job_run_details where end_time < now() - interval '7 days';
    delete from public.dispatch where settled and at < now() - interval '30 days';
  $$
);
