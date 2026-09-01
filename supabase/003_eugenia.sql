-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: what she can see and what she remembers
-- ───────────────────────────────────────────────────────────────────────────
-- Eugenia is the market bot. She reads no trade she can write and owns no
-- column of `trades`, so nothing here touches the journal — this is her own
-- memory and her own read of his, and that is the whole file. Her schedule is
-- in 004_cron.sql with the poller's, because "what runs on a timer" should be
-- one place to look rather than one file per feature.
--
-- Two tables and a view, and they are three because they answer three
-- questions. eugenia_turns is a conversation window that rolls over in a
-- morning; eugenia_notes is what stays true for weeks; eugenia_trades is a read
-- of the journal that stores nothing at all. Nothing ever reads two of them in
-- one query, which is the test that says they are three objects rather than one
-- wearing a discriminator.
--
-- eugenia_notes DOES carry a kind, and that is the same test passing rather
-- than failing: its two kinds share a shape, a lifecycle and a writer, and only
-- their read window differs. Turns and notes share none of those.
--
-- Run once, in the SQL editor, after doji-eugenia is deployed and
-- ANTHROPIC_API_KEY is in the Edge Function secrets. The CREATE TABLEs make the
-- file run-once; on a database that already has them, the README's Deployment
-- section carries the statements to apply on their own — the view and its
-- grants, and eugenia_notes.kind.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Her memory ────────────────────────────────────────────────────────────
-- Without this every question starts from nothing and "what did you mean about
-- the Fed?" cannot be answered.
--
-- No user_id and no RLS policy: nothing but the Edge Function ever reads this,
-- and it holds the service key. RLS is still enabled with no policy at all,
-- which denies the publishable key outright — the app has no business here, and
-- an unprotected table reachable by a public key would be an open log.
create table public.eugenia_turns (
  id         bigserial primary key,
  role       text not null,
  content    text not null,
  created_at timestamptz not null default now(),

  -- The Messages API accepts these two and nothing else. Enforced here so a
  -- malformed write fails at the boundary rather than as a 400 from Claude.
  constraint eugenia_turns_role_check check (role in ('user', 'assistant'))
);

-- The only read there is: the newest few, in id order.
create index eugenia_turns_id_desc on public.eugenia_turns (id desc);

alter table public.eugenia_turns enable row level security;

-- ─── What she may see of the journal ───────────────────────────────────────
-- Read-only, and enforced by the grant below rather than by her good intentions.
--
-- A VIEW rather than the table, for two reasons. It fixes the column list — no
-- user_id, no balance, no commission, none of which she needs to discuss a
-- trade — and it filters `deleted`, so a trade the trader removed stays removed
-- in conversation too. A single-table view is auto-updatable in Postgres, which
-- is exactly why the revoke below is not decoration.
--
-- security_invoker, because a view's default is the OPPOSITE and the difference
-- is invisible until it matters. Without it the view reads `trades` with its
-- OWNER's rights, so what RLS does depends on an attribute of whoever happened
-- to run this file — and the grant below is then the only thing standing
-- between the publishable key and every user's trades. With it the reader's own
-- rights apply: service_role bypasses RLS by definition, so Eugenia sees exactly
-- what she sees today, and a grant widened by mistake leaks nothing.
--
-- OR REPLACE so the view statement can be re-applied on its own — which is what
-- an existing database needs, since the CREATE TABLE above stops the file
-- running twice. That is why the column list is written out rather than
-- `select *`.
--
-- A NEW COLUMN GOES ON THE END, AND NOTHING ELSE MOVES. `create or replace view`
-- may only append: it matches the existing view position by position, so a name
-- inserted mid-list reads as renaming the column that used to sit there and
-- Postgres refuses with `cannot change name of view column`. `size_oz` is last
-- for that reason and not because the order is meaningful — putting it beside
-- the other broker columns, where it belongs by sense, is exactly the tidy that
-- breaks re-application on every database that already has this view.
--
-- Removing or reordering needs a `drop view` first, which also drops the grants
-- below it. Appending never does.
create or replace view public.eugenia_trades
  with (security_invoker = true) as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         open_day, setup, followed_rules, followed_sl, followed_tp, size_oz,
         planned_stop, planned_target
  from public.trades
  where deleted = false;

-- SELECT and nothing else, for the one role that reaches it.
revoke all on public.eugenia_trades from anon, authenticated, service_role;
grant select on public.eugenia_trades to service_role;

-- AND THE SAME GRANT ON THE TABLE UNDERNEATH, which security_invoker is exactly
-- what makes necessary: a definer's-rights view borrows its owner's access to
-- `trades`, an invoker's-rights view does not. Supabase's default privileges
-- already grant this, so it is stated rather than added — a database restored
-- without those defaults would otherwise answer "permission denied for table
-- trades" and Eugenia would lose the journal with no other sign.
grant select on public.trades to service_role;

-- SAY THE LIMIT PLAINLY: this makes the VIEW read-only, not the key. Eugenia
-- holds the service key because she writes eugenia_turns, and that key can
-- still reach `trades` directly. What stops her is structural — her function
-- has exactly one database read of the journal and no write path to it at all,
-- and a test asserts the query it builds. The grant is the second lock, not the
-- only one.

-- ─── What she remembers ────────────────────────────────────────────────────
-- eugenia_turns above is a conversation window, and it rolls over in a
-- morning. This is the other kind of memory: a handful of short
-- facts about the trader that stay true for weeks. Without it she can never
-- know in September that he has been working on holding his stop since August.
--
-- TWO KINDS IN ONE TABLE, AND THEY ARE READ SEPARATELY. A `fact` is something
-- she noticed about him; an `instruction` is something he told her — "stop
-- mentioning the ten-year" — and it is the only way he can correct her.
--
-- Same shape and same lifecycle, so one table; different SIZE, so two reads.
-- Notes arrive at a few a week and instructions at a few ever, and a single
-- newest-20 window over both would evict a standing instruction after a month
-- of ordinary observations. Silently, and after she had told him it stuck.
--
-- APPEND-ONLY, and read newest-first. Superseding either means writing a newer
-- one, which is also how a person's memory works — the recent account wins, and
-- it is what lets him change his mind with nothing to delete. There is no
-- update path and no delete path in the function, so the only thing she can do
-- to this table is add a sentence to it.
--
-- Same shape and the same reasoning as eugenia_turns: no user_id, because
-- nothing but the Edge Function ever reads this and it holds the service key.
-- RLS enabled with no policy at all denies the publishable key outright — the
-- app has no business here, and an unprotected table reachable by a public key
-- would be an open notebook.
create table public.eugenia_notes (
  id         bigserial primary key,
  note       text not null,
  -- Defaulted, so a row written before the caller knew about kinds is an
  -- observation rather than a standing rule — the harmless way round.
  kind       text not null default 'fact',
  created_at timestamptz not null default now(),

  -- The function truncates at 200 before writing; this is the same limit stated
  -- where it cannot be bypassed. A note is one sentence — anything longer is a
  -- transcript, and a transcript is what eugenia_turns is already for.
  constraint eugenia_notes_note_length check (char_length(note) between 1 and 200),
  -- The vocabulary, enforced here rather than trusted to the tool schema.
  constraint eugenia_notes_kind_check check (kind in ('fact', 'instruction')),

  -- RETIREMENT, WHICH IS WHAT MAKES THIS A MEMORY RATHER THAN A PILE. Append-only
  -- with a newest-first read cannot correct anything: a note saying he trades the
  -- London open stays visible after he moves to New York, both sit in her context
  -- contradicting each other, and the stale one leaves the window twenty notes
  -- later by accident rather than by decision.
  --
  -- Still no delete path and still append-only. The row stays and names the
  -- newer note that replaced it, which keeps the trail — what she used to
  -- believe, and what changed it — while taking the old line out of the reads
  -- below. That is exactly the pair of properties a search over this table will
  -- need later: findable, and marked as no longer true.
  --
  -- Self-referencing, so the chain is walkable from either end.
  superseded_by bigint references public.eugenia_notes(id)
);

-- Both reads are one kind, newest first, so the kind leads the index. PARTIAL,
-- matching the read exactly: a retired note is never selected, so it has no
-- business in the index either, and this grows with what is current rather than
-- with the archive.
create index eugenia_notes_kind_id_desc on public.eugenia_notes (kind, id desc)
  where superseded_by is null;

alter table public.eugenia_notes enable row level security;

-- ─── Searching what she has already said ───────────────────────────────────
-- The two tables above are append-only and grow without bound, but both reads
-- are a fixed window — twelve turns, twenty notes of each kind. Everything
-- older is still in the table and simply never selected. That is occlusion, not
-- eviction: nothing has ever been lost, and none of it is reachable.
--
-- This is what reaches it. A question like "what did we conclude about the
-- December cut" is answerable from turns written in March, and without this it
-- is answerable only if March happens to be inside the last twelve.
--
-- SEARCHED, NOT LOADED, AND THAT IS THE WHOLE DESIGN. Widening the windows
-- would put the archive in her context, where every token is paid on every
-- request and competes for attention with the briefing itself. The windows stay
-- small; this makes what is outside them addressable on demand, the same shape
-- as get_trades.
--
-- GENERATED AND STORED rather than maintained by a trigger, for the reason
-- `trades.pnl` is: a derived value with a write path of its own is a value that
-- can disagree with what it derives from. There is no write path here at all.
alter table public.eugenia_notes
  add column if not exists search tsvector
  generated always as (to_tsvector('english', note)) stored;

alter table public.eugenia_turns
  add column if not exists search tsvector
  generated always as (to_tsvector('english', content)) stored;

-- GIN, because these are the only queries that will ever run against these
-- columns and a GIN index is what a tsvector `@@` match uses.
create index if not exists eugenia_notes_search on public.eugenia_notes using gin (search);
create index if not exists eugenia_turns_search on public.eugenia_turns using gin (search);

-- ONE FUNCTION RATHER THAN TWO QUERIES, so the ranking is done across both
-- sources rather than by merging two separately-ranked lists in the Edge
-- Function, which cannot compare their scores. It is also where a vector search
-- would be added later without the function file changing at all.
--
-- websearch_to_tsquery, NOT to_tsquery, and the difference is that this input is
-- written by a model. to_tsquery throws a syntax error on an unbalanced quote or
-- a bare `&`, and a throw inside her tool loop costs the whole answer;
-- websearch_to_tsquery accepts anything a person would type into a search box
-- and yields an empty query rather than an error.
--
-- A RETIRED NOTE IS RETURNED AND MARKED, never hidden. That is the promise
-- superseded_by makes: the row stays findable and says it is no longer true.
-- Hiding it here would make the archive lie by omission, and "what did I used to
-- think" is a question worth being able to answer.
--
-- AND A TURN SAYS WHO SAID IT, which this dropped for as long as it existed.
-- `role` was on the table and was not selected, so every turn came back
-- indistinguishable and the function rendered all of them as her own words —
-- half of every result set was HIS messages handed back to her as things she
-- had said. Silent, fluent, and exactly backwards on the question the tool is
-- most often called to answer.
--
-- FOLDED INTO `source` RATHER THAN ADDED AS A COLUMN, because `create or replace
-- function` may not change a return type: widening the signature needs a `drop
-- function` first, which takes the grants at the bottom of this file with it.
-- `source` is already the column that says what a hit is, and three values say
-- it exactly: `note`, `you`, `him`.
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
  -- Clamped here as well as in the function that calls it: `lim` arrives from
  -- the model through PostgREST, and this is the boundary that Postgres owns.
  order by rank desc, at desc
  limit greatest(1, least(coalesce(lim, 12), 25));
$$;

-- SECURITY INVOKER is the default for a function and is what is wanted, so it
-- is not stated — but EXECUTE granted to PUBLIC IS a default, and that one has
-- to be undone. anon and authenticated inherit from PUBLIC, so leaving it is a
-- public entry point to her memory that only RLS stands behind.
revoke execute on function public.eugenia_search(text, int) from public;
grant execute on function public.eugenia_search(text, int) to service_role;

-- ─── Where he stands on each of the five channels ──────────────────────────
-- THE SAME BUG THIS FILE ALREADY FIXED ONCE, in the other half of her memory.
-- `kind` exists because one newest-20 window over notes and instructions
-- together would evict "stop mentioning the ten-year" after a month of ordinary
-- observations. This is that argument again with a third lifetime: what he
-- UNDERSTANDS is not an observation about Tuesday, it is a durable fact about
-- him, and it was sitting in the bucket that ages out. A note recording that he
-- worked out the dollar link unaided leaves the window twenty notes later and
-- she re-explains something the prompt forbids her to re-explain.
--
-- FIVE ROWS, FOREVER, AND THAT IS THE FEATURE. Not a window and not a list — a
-- census over a fixed set, so it cannot be crowded out by a busy month. It is
-- also the only place in the system where an ABSENCE is legible: a channel he
-- has never once used is a row saying `unseen`, where in eugenia_notes it is
-- simply nothing written down, and nothing is not a thing anyone can notice.
--
-- No id and no history. The row IS the current answer, `evidence` says what
-- last moved it, and the trail of how he got there is the turns and the notes,
-- which are both already searchable. A second append-only table here would be a
-- second archive nobody reads.
create table public.eugenia_channels (
  -- The channel id, not the name she says. prompt.ts holds both and is the only
  -- copy; the constraint below is the same list, enforced where the tool
  -- schema cannot be bypassed.
  channel  text primary key
    constraint eugenia_channels_name_check check (channel in (
      'rates_vs_inflation', 'dollar', 'inflation', 'jobs', 'central_bank_buying')),

  -- The ladder, in order. Defaulted to the bottom rung so a row seeded before
  -- anything is known reads as "never come up", which is true.
  state    text not null default 'unseen'
    constraint eugenia_channels_state_check check (state in (
      'unseen', 'explained', 'used', 'owns')),

  -- One line saying what last moved the rung. Same 200 as a note and for the
  -- same reason: a sentence, not a transcript.
  evidence text
    constraint eugenia_channels_evidence_length
      check (evidence is null or char_length(evidence) between 1 and 200),

  -- A CIVIL DAY IN NEW YORK, written by the function rather than defaulted to
  -- now(). `now()` is UTC, so an evening move would be filed on tomorrow — the
  -- same mistake open_day exists to avoid, in a column read by a person.
  moved_on date
);

-- The five rows exist from the start rather than being created on first write.
-- A channel with no row and a channel he has never used are the same fact, and
-- one of them would be invisible: the read renders what it is given, so a
-- missing row is a channel that silently drops out of her map.
-- Idempotent, so this file stays safe to re-run.
insert into public.eugenia_channels (channel) values
  ('rates_vs_inflation'), ('dollar'), ('inflation'), ('jobs'), ('central_bank_buying')
on conflict (channel) do nothing;

-- Five rows, read whole every turn: no index beyond the primary key, which is
-- what the function's PATCH filters on.
alter table public.eugenia_channels enable row level security;
