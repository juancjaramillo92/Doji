-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: what she can see and what she remembers
-- ───────────────────────────────────────────────────────────────────────────
-- Her conversation (eugenia_turns), what stays true about him for weeks
-- (eugenia_notes), where he stands on the five channels (eugenia_channels),
-- and a read-only view of his journal (eugenia_trades). Nothing here touches
-- `trades`. Her schedule is in 004 with every other job.
--
-- Run once, after doji-eugenia is deployed and ANTHROPIC_API_KEY is set. The
-- CREATE TABLEs make the file run-once; the README's Deployment section has the
-- statements an existing database applies on its own.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Her conversation ──────────────────────────────────────────────────────
-- No user_id and no policy: only the Edge Function reads it, with the secret
-- key. RLS on with no policy denies the publishable key outright.
create table public.eugenia_turns (
  id         bigserial primary key,
  role       text not null,
  content    text not null,
  created_at timestamptz not null default now(),

  -- The two roles the Messages API accepts, so a bad write fails here rather
  -- than as a 400 from Claude.
  constraint eugenia_turns_role_check check (role in ('user', 'assistant'))
);

create index eugenia_turns_id_desc on public.eugenia_turns (id desc);

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
         net_pnl
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
-- Three kinds — a `fact` she noticed, an `instruction` he gave her, and (015) a
-- `commitment` he made — read as separate windows, so twenty ordinary
-- observations can never evict a standing instruction.
--
-- Append-only. A correction is a newer note naming the old one in
-- superseded_by, which keeps the trail and takes the old line out of the read.
create table public.eugenia_notes (
  id         bigserial primary key,
  note       text not null,
  -- A row written without a kind is an observation, the harmless default.
  kind       text not null default 'fact',
  created_at timestamptz not null default now(),

  -- One sentence. The function truncates at 200 too; this is the limit stated
  -- where it cannot be bypassed.
  constraint eugenia_notes_note_length check (char_length(note) between 1 and 200),
  constraint eugenia_notes_kind_check check (kind in ('fact', 'instruction')),

  superseded_by bigint references public.eugenia_notes(id)
);

-- Partial, matching the read exactly: a retired note is never selected.
create index eugenia_notes_kind_id_desc on public.eugenia_notes (kind, id desc)
  where superseded_by is null;

alter table public.eugenia_notes enable row level security;

-- ─── Search over both ──────────────────────────────────────────────────────
-- She is handed twelve turns and twenty notes per kind; everything older is
-- reachable only by search. Widening the windows would pay for the archive on
-- every request.
--
-- Generated and stored, like trades.pnl: a derived value with no write path of
-- its own cannot disagree with what it derives from.
alter table public.eugenia_notes
  add column if not exists search tsvector
  generated always as (to_tsvector('english', note)) stored;

alter table public.eugenia_turns
  add column if not exists search tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists eugenia_notes_search on public.eugenia_notes using gin (search);
create index if not exists eugenia_turns_search on public.eugenia_turns using gin (search);

-- One function ranks both tables together. websearch_to_tsquery rather than
-- to_tsquery, because the query is model-written and to_tsquery throws on an
-- unbalanced quote. A retired note is returned marked, never hidden. `source`
-- says who a hit is: `note`, `you` (her) or `him`.
--
-- 007 replaces this with the hybrid search, and owns it from then on.
create or replace function public.eugenia_search(q text, lim int default 12)
returns table (source text, id bigint, at timestamptz, retired boolean, body text)
language sql
stable
as $$
  select source, id, at, retired, body
  from (
    select 'note' as source, n.id, n.created_at as at,
           n.superseded_by is not null as retired, n.note as body,
           ts_rank(n.search, websearch_to_tsquery('english', q)) as rank
      from public.eugenia_notes n
     where n.search @@ websearch_to_tsquery('english', q)
    union all
    select case when t.role = 'user' then 'him' else 'you' end,
           t.id, t.created_at, false, t.content,
           ts_rank(t.search, websearch_to_tsquery('english', q))
      from public.eugenia_turns t
     where t.search @@ websearch_to_tsquery('english', q)
  ) hits
  -- Clamped here too: `lim` arrives from the model through PostgREST.
  order by rank desc, at desc
  limit greatest(1, least(coalesce(lim, 12), 25));
$$;

revoke execute on function public.eugenia_search(text, int) from public;
grant execute on function public.eugenia_search(text, int) to service_role;

-- ─── Where he stands on each channel ───────────────────────────────────────
-- Five rows, never a window, so a busy month cannot crowd one out — and the
-- only place an absence is visible: a channel he has never used is a row
-- saying `unseen`, where in the notes it would be nothing at all.
--
-- The row is the current answer. The trail of how he got there is the turns
-- and the notes, which are already searchable.
create table public.eugenia_channels (
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
