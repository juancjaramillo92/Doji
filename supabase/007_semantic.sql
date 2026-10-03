-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: search by meaning
-- ───────────────────────────────────────────────────────────────────────────
-- Not a memory but the reach into two of them. The windows stay small — every
-- token in one is paid on every request — and search_memory reaches past them.
-- This makes that reach work on meaning: "what did we conclude about the
-- December cut" against "the market has mostly given up on easing" shares no
-- substring, and without it she answers that they never discussed it.
--
-- The lexical arm stays, as the floor rather than a fallback. A vector is worse
-- than trigram where the thing asked for IS the string — a date, a ticker,
-- R-08 — and a row with no embedding never appears in a nearest-neighbour
-- query at all, silently.
--
-- Run once, in the SQL editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists vector;

-- ─── One column per searchable table ───────────────────────────────────────
-- 1536 is a copy of EMBED_DIMS in doji-eugenia: the request asks the vendor for
-- this width and the column must accept it. agree.test.mjs reads both.
--
-- Null is expected: on every older row, and on any whose embedding call failed,
-- since the write stores the turn either way. ?embed=1 fills them; verify.sql
-- counts what is left.
alter table public.eugenia_notes add column if not exists embedding vector(1536);
alter table public.eugenia_turns add column if not exists embedding vector(1536);

-- HNSW needs no training pass over rows that fill in over days. Cosine, to
-- match the query's `<=>`: an index for another operator falls back to a full
-- scan silently.
create index if not exists eugenia_notes_embedding
  on public.eugenia_notes using hnsw (embedding vector_cosine_ops);
create index if not exists eugenia_turns_embedding
  on public.eugenia_turns using hnsw (embedding vector_cosine_ops);

-- ─── The search itself ─────────────────────────────────────────────────────
-- Dropped and recreated, which nothing else here does. The query vector is a new
-- argument, `create or replace` cannot change an argument list, and creating
-- beside the old signature makes an overload: a two-argument call becomes
-- ambiguous, and the new function carries EXECUTE to PUBLIC. So the revoke and
-- grant below are part of this statement, and re-running reapplies all three.
drop function if exists public.eugenia_search(text, int);
drop function if exists public.eugenia_search(text, int, text);

-- `qv` is text and cast inside: PostgREST sends JSON, and pgvector's input is
-- its text form, so text crosses that boundary without relying on a json cast.
create function public.eugenia_search(q text, lim int default 12, qv text default null)
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
