-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 015: what he has committed to, as a third kind of note
-- ───────────────────────────────────────────────────────────────────────────
-- What he told her HE would do — "this week I stop after two losses". Read the
-- other way from an instruction: she obeys an instruction and holds a
-- commitment against his trades, so it is its own kind and its own window. It
-- needs everything a note has, so it is a kind rather than a table.
--
-- Safe to re-run: the constraint is dropped and recreated whole. The (kind,
-- id desc) index serves a third word as it serves two.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.eugenia_notes drop constraint if exists eugenia_notes_kind_check;
alter table public.eugenia_notes add constraint eugenia_notes_kind_check
  check (kind in ('fact', 'instruction', 'commitment'));
