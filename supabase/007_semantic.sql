-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: finding what she meant, not what she typed
-- ───────────────────────────────────────────────────────────────────────────
-- THIS IS NOT A SIXTH MEMORY. Her memories are LIFETIMES — turns roll over in a
-- morning, notes persist, channels outlive both, the thesis is only ever
-- current, loops close, the calendar compounds. This is the REACH into two of
-- them, and the windows stay exactly as small as they are: twelve turns and
-- twenty notes, because every token in a window is paid on every request.
-- `search_memory` is what reaches past the window, and this makes that reach
-- work on meaning.
--
-- WHAT IT FIXES, CONCRETELY. *"What did we conclude about the December cut"*
-- against a turn that said *"the market has mostly given up on easing this
-- year"*. No shared substrings, so full text finds nothing and trigram finds
-- nothing — and the answer she gives is that you never discussed it, which is
-- worse than saying she cannot find it.
--
-- THE LEXICAL ARM STAYS, AND THAT IS THE LOAD-BEARING DECISION HERE. Two
-- reasons and both matter. A vector is worse than trigram at exact terms — a
-- date, a ticker, `R-08`, a note id — where the thing being asked for IS the
-- string. And a row whose embedding is null simply does not appear in a
-- nearest-neighbour query: no error, no log, half an archive quietly
-- unsearchable. The lexical arm is full coverage over both tables and cannot
-- have that failure, so it is the floor under the semantic one rather than a
-- fallback beside it.
--
-- Run once, in the SQL editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists vector;

-- ─── One column per searchable table ───────────────────────────────────────
-- 1536 IS A COPY. It is stated here and again as EMBED_DIMS in doji-eugenia,
-- because the request has to ask the vendor for this width and the column has
-- to accept it — a disagreement is a 400 on every write, so `agree.test.mjs`
-- reads both. It is text-embedding-3-small's native width; the model is pinned
-- in the function file rather than read from the environment, for the reason
-- stated there.
--
-- NULL IS A REAL AND EXPECTED STATE. Every row written before this ran has one,
-- and so does any row whose embedding call failed — the write path stores the
-- turn either way, because losing what she said to save a vector would be the
-- wrong trade by a wide margin. `?embed=1` fills them in and `verify.sql`
-- counts what is left.
alter table public.eugenia_notes add column if not exists embedding vector(1536);
alter table public.eugenia_turns add column if not exists embedding vector(1536);

-- HNSW rather than IVFFlat: it needs no training pass over existing rows, which
-- matters on a table that starts empty of vectors and fills in over days.
-- Cosine, matching the `<=>` the query below uses — an index built for one
-- operator does not serve another, and the query would fall back to a full scan
-- with nothing saying so.
create index if not exists eugenia_notes_embedding
  on public.eugenia_notes using hnsw (embedding vector_cosine_ops);
create index if not exists eugenia_turns_embedding
  on public.eugenia_turns using hnsw (embedding vector_cosine_ops);

-- ─── The search itself ─────────────────────────────────────────────────────
-- DROPPED AND RECREATED, WHICH THIS REPOSITORY OTHERWISE AVOIDS. 005 replaces
-- this function in place precisely so its grants survive. That is not available
-- here: the query vector is a new argument, `create or replace function` cannot
-- change an argument list, and creating `(text, int, text)` beside `(text, int)`
-- makes an OVERLOAD rather than a replacement. Two things then go wrong at once
-- — a two-argument call matches both and Postgres refuses it as ambiguous, and
-- the new function carries `execute` to PUBLIC by default, which `anon`
-- inherits: a public entry point to her memory with only RLS behind it.
--
-- So the drop is deliberate and the revoke and grant below are part of the
-- statement, not a follow-up. Re-running this file re-applies all three.
drop function if exists public.eugenia_search(text, int);
drop function if exists public.eugenia_search(text, int, text);

-- `qv` IS TEXT AND CAST INSIDE, not declared as a vector. PostgREST sends the
-- body as JSON, and pgvector's input is a text representation — `[0.1,0.2,…]`
-- — so text is the shape that crosses that boundary intact rather than the one
-- that depends on a cast from json existing.
create function public.eugenia_search(q text, lim int default 12, qv text default null)
returns table (source text, id bigint, at timestamptz, retired boolean, body text)
language sql
stable
as $$
  with ask as (
    select websearch_to_tsquery('english', q) as tsq,
           case when qv is null or qv = '' then null else qv::vector(1536) end as vec
  ),

  /* THE LEXICAL ARM — unchanged from what it was, deliberately. Its internal
     order is still `lexical desc` before the score, so a true full-text match
     still beats a trigram-only one; with no query vector the fusion below runs
     over this arm alone and reproduces exactly today's ordering. That is what
     makes this whole file a no-op until an embedding key exists. */
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

  /* THE SEMANTIC ARM — one nearest-neighbour scan per table, which is what the
     HNSW index serves. `order by … limit` rather than a distance threshold: a
     threshold is a number nobody can choose honestly across every phrasing, and
     it is the shape that returns nothing on the day it matters. Ranking is what
     the fusion below wants anyway, so the distances are never compared against
     anything but each other.

     BOTH NULL CHECKS ARE LOAD-BEARING AND NEITHER IS PADDING. A row with no
     embedding must not be ordered by a distance it does not have. And with no
     query vector every distance is null, `order by null` returns whatever the
     scan reaches first, and the LIMIT would then feed arbitrary rows into the
     fusion — a search that got quietly worse the moment the key was unset. */
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

  /* RECIPROCAL RANK FUSION, not a weighted sum of the two scores. ts_rank and
     cosine distance are on unrelated scales — one is a small positive number
     whose size depends on document length, the other is bounded — so any
     weighting of them is a constant somebody guessed, and it would need
     re-guessing the day either arm changed. RRF compares only POSITIONS, so it
     needs no calibration and cannot be thrown off by a scale.

     60 is the constant from the paper this comes from and is not tuned here; it
     flattens the difference between the first few positions, so a row found by
     BOTH arms outweighs one that is merely first in either.

     EACH ARM IS RANKED WHERE IT IS BUILT. A CTE's own `order by` is not carried
     out of it — selecting from sem_notes without ordering by the distance again
     would number the rows in whatever order the scan produced, which is the
     ranking silently replaced by an arbitrary one. */
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
-- THREE LINES, AND THE FIRST TWO ARE NOT THE SAME LINE TWICE. `public` here is
-- the PUBLIC pseudo-role, which every function carries EXECUTE for by default.
-- `anon` and `authenticated` are granted it SEPARATELY and explicitly, by the
-- default privileges Supabase sets on the `public` SCHEMA — two different
-- things spelled the same way, which is why revoking from one leaves the other
-- untouched and reports nothing.
--
-- This was the state of `eugenia_search` from the day 003 created it, because
-- 003 revokes from PUBLIC and stops there and nothing ever asked the database
-- the question. It was not a leak: the function is not `security definer`, so
-- an anon caller executes it as anon and meets RLS on two tables that have no
-- policy for it. It was the stated guarantee being false, and one mistaken
-- policy away from being the other thing. `verify.sql` asks it now, of every
-- callable function in the schema rather than of this one.
--
-- Not a follow-up to the create above: the drop took the old grants with it.
revoke all on function public.eugenia_search(text, int, text) from public;
revoke all on function public.eugenia_search(text, int, text) from anon, authenticated;
grant execute on function public.eugenia_search(text, int, text) to service_role;
