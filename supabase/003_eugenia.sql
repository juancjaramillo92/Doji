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
-- running twice. Adding a column is fine; removing or reordering one needs a
-- drop, which is why the column list is written out rather than `select *`.
create or replace view public.eugenia_trades
  with (security_invoker = true) as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         size_oz, open_day, setup, followed_rules, followed_sl, followed_tp
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
