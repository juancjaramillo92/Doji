-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 015: what he has committed to, as a third kind of note
-- ───────────────────────────────────────────────────────────────────────────
-- A fact is what she noticed about him and an instruction is what he told her
-- to do. A commitment is neither: it is what he told her HE would do — "this
-- week I stop after two losses" — and it is the half a coach holds him to. It
-- shares everything a note already has: an id to be named by, `superseded_by`
-- to be retired with, the embedding and the search. So it is a kind rather
-- than a table, and the only thing that has to change is the word list.
--
-- ITS OWN KIND, NOT AN INSTRUCTION, because the two are read in opposite
-- directions. An instruction is obeyed by her; a commitment is checked against
-- his trades. Filed together, one window of twenty would hold both and she
-- would be asked to tell them apart from the wording alone.
--
-- Safe to re-run: the constraint is dropped if present and recreated whole, so
-- applying the file makes the database match it. The index is untouched — it
-- is on (kind, id desc) and serves a third word exactly as it serves two.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.eugenia_notes drop constraint if exists eugenia_notes_kind_check;
alter table public.eugenia_notes add constraint eugenia_notes_kind_check
  check (kind in ('fact', 'instruction', 'commitment'));
