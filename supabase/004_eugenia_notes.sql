-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: what she remembers
-- ───────────────────────────────────────────────────────────────────────────
-- eugenia_turns is a conversation window — twelve turns, and they roll over in
-- a morning. This is the other kind of memory: a handful of short facts about
-- the trader that stay true for weeks. Without it she can never know in
-- September that he has been working on holding his stop since August.
--
-- No cron change. The hourly job from 003 already calls the function; the
-- function decides whether this hour is a briefing, the 10:00 pulse, or
-- neither, for the same reason briefDue() lives in code rather than in a cron
-- expression.
--
-- Run once, in the SQL editor, after doji-eugenia is deployed.
-- ═══════════════════════════════════════════════════════════════════════════

-- APPEND-ONLY, and read newest-first. Superseding a note means writing a newer
-- one, which is also how a person's memory works — the recent account wins.
-- There is no update path and no delete path in the function, so the only thing
-- she can do to this table is add a sentence to it.
--
-- Same shape and the same reasoning as eugenia_turns: no user_id, because
-- nothing but the Edge Function ever reads this and it holds the service key.
-- RLS enabled with no policy at all denies the publishable key outright — the
-- app has no business here, and an unprotected table reachable by a public key
-- would be an open notebook.
create table public.eugenia_notes (
  id         bigserial primary key,
  note       text not null,
  created_at timestamptz not null default now(),

  -- The function truncates at 200 before writing; this is the same limit stated
  -- where it cannot be bypassed. A note is one sentence — anything longer is a
  -- transcript, and a transcript is what eugenia_turns is already for.
  constraint eugenia_notes_note_length check (char_length(note) between 1 and 200)
);

-- The only read there is: the newest twenty.
create index eugenia_notes_id_desc on public.eugenia_notes (id desc);

alter table public.eugenia_notes enable row level security;

-- SHE IS STILL NOT A WRITER TO `trades`. eugenia_turns and eugenia_notes are
-- her own; the journal stays exactly what 003 made it — one read through
-- eugenia_trades, granted select alone, with no write path to the table
-- anywhere in her function.
