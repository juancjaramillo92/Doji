-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: what wakes her, what she measures, and what compounds
-- ───────────────────────────────────────────────────────────────────────────
-- 003_eugenia.sql gave her a memory. This gives her SENSES and METERS, and the
-- two are the same missing idea seen twice: nothing in this system could wake
-- her except a clock, and nothing could tell her — or anyone — whether any of
-- it was working.
--
-- Six tables, and each answers a question none of the existing ones can:
--
--   eugenia_runs      what a turn cost, DURABLY. ask() has logged tokens and
--                     searches from the start, to a console this repository
--                     already decided is not a place facts survive — the same
--                     reasoning that made postScheduled message Telegram on
--                     failure. A meter nobody can read is not a meter.
--   eugenia_calendar  what lands today, and what it printed when it did. The
--                     event spine reads the first half; the second half is the
--                     only dataset here that is worth more every month it runs,
--                     because it is HER record of a print with HER line on it.
--   eugenia_thesis    the running story, rewritten rather than appended. One
--                     row, because a thesis is not a list.
--   eugenia_loops     what she flagged and what she asked, until it closes.
--   eugenia_feedback  whether a briefing landed, which nothing could say.
--
-- Plus a hybrid search, and the trigger that makes a trade something she finds
-- out about in two minutes rather than tomorrow.
--
-- RUN AFTER 003. Every statement here is idempotent — `create table if not
-- exists`, `create or replace`, `on conflict do nothing` — so this file is safe
-- to re-run in full, which 003 is not. That is deliberate: this is the file
-- that will grow.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── What a turn cost ──────────────────────────────────────────────────────
-- ONE ROW PER MODEL CALL, WRITTEN BY ask() ON ITS WAY OUT.
--
-- Everything this system cannot see is counted where it happens, and that rule
-- was already half-applied: ask() counts tokens because the spend cap on the
-- Anthropic key is a ceiling and not a meter, and postBriefing counts characters
-- because the length target lives in prose past a model call. Both went to
-- console.log — and this repository's own account of pg_net says plainly that
-- nobody reads Edge logs. So the numbers existed and the questions they were
-- collected to answer ("is the briefing drifting long again", "what did last
-- month cost", "how often is fallbacks actually firing") could not be asked.
--
-- APPEND-ONLY AND NEVER READ BY HER. This is not memory; she is not handed it
-- and cannot search it. It is instrumentation, for him and for whoever is
-- debugging — which is why it carries no note, no summary, and no opinion.
--
-- A FAILED TURN IS A ROW TOO. `ok` false with `detail` carrying the error is
-- the only record that a briefing was attempted and died, since the Telegram
-- apology is a message rather than data.
create table if not exists public.eugenia_runs (
  id         bigserial primary key,
  at         timestamptz not null default now(),

  -- The caller, exactly as ask()'s label names it: 'weekday briefing',
  -- 'sunday briefing', 'pulse', 'reply', 'consolidation', 'release look',
  -- 'trade look', 'critic'. Free text on purpose — a check constraint here
  -- would turn adding a caller into a migration.
  caller     text not null,
  effort     text,
  rounds     int,

  -- Counted apart because they bill apart: web search is $10 per 1,000 and
  -- does not appear in the token figures at all.
  in_tokens  int,
  cached     int,
  out_tokens int,
  searches   int,

  -- The briefing's length, which is the one quality target that lives in the
  -- prompt rather than anywhere a test can reach. Null for callers that do not
  -- produce a briefing.
  chars      int,

  -- The model that actually answered, when it was not the one asked for.
  -- `fallbacks: "default"` rescues a decline invisibly; this is where that
  -- becomes a countable fact rather than a line in a log.
  fell_back  text,

  ms         int,
  ok         boolean not null default true,
  detail     text
);

-- The only reads are "recently" and "this caller recently".
create index if not exists eugenia_runs_at_desc on public.eugenia_runs (at desc);
create index if not exists eugenia_runs_caller_at on public.eugenia_runs (caller, at desc);

alter table public.eugenia_runs enable row level security;

-- ─── What lands today, and what it printed ─────────────────────────────────
-- THE EVENT SPINE'S FIRST HALF, AND THE ONLY DATASET THAT COMPOUNDS.
--
-- She has searched the web for the day's calendar every morning since she
-- existed, read it once, and thrown it away. Two things were lost each time.
--
-- The first is a WAKE-UP. A print at 08:30 is knowable at 08:00, so the hour
-- after it is a scheduled look that can be decided from data rather than from a
-- constant — which is what turns a fixed 10:00 pulse into a look at the thing
-- that actually happened. `looked_at` is what makes that fire exactly once.
--
-- The second is HISTORY. `actual` against `consensus` against `prior`, with her
-- own line beside it, is a series no web search can hand back: in a year this
-- says how core CPI has printed against expectations for twelve months AND what
-- she said about each one at the time. It is worth nothing today and a great
-- deal in June, which is the whole argument for starting it now.
--
-- SHE WRITES IT AND NOBODY ELSE DOES. The figures come from her web search, so
-- they are as good as the search was — which is why `source` is recorded and
-- why nothing downstream treats these as broker data. They are her notes about
-- the world, in a shape that can be counted.
create table if not exists public.eugenia_calendar (
  id         bigserial primary key,

  -- When it lands, to the minute, in UTC. The event spine compares this against
  -- now(); everything shown to a person is formatted in New York by the caller,
  -- the same split every other time in this system uses.
  at         timestamptz not null,

  name       text not null,

  -- Only 'high' ever wakes her. The rest are recorded because a briefing that
  -- mentions them is a briefing that had them, and because "what did the week
  -- hold" is a question the archive should be able to answer.
  importance text not null default 'high'
    constraint eugenia_calendar_importance_check check (importance in ('high', 'medium', 'low')),

  -- Text rather than numeric, and deliberately: a consensus is "0.3%", "175K",
  -- "unchanged at 4.25-4.50%". Forcing a number here would either lose the unit
  -- or lose the row.
  consensus  text,
  prior      text,
  actual     text,

  -- Her line about it, written when the actual lands. One sentence, the same
  -- budget a note gets and for the same reason.
  note       text
    constraint eugenia_calendar_note_length
      check (note is null or char_length(note) between 1 and 200),

  source     text,

  -- WHEN THE POST-RELEASE LOOK RAN. Null means it has not, which is exactly the
  -- predicate the spine selects on — so a look fires once per release and a
  -- redeploy, a retry or a second hourly tick cannot repeat it. It is a
  -- timestamp rather than a boolean because "it fired, at 08:47" is the thing
  -- worth knowing when one did not arrive.
  looked_at  timestamptz,

  created_at timestamptz not null default now(),

  -- One row per release per moment. The poller's upsert shape, for the same
  -- reason: she re-reads the calendar every morning and must update rather than
  -- duplicate what she already filed.
  constraint eugenia_calendar_unique unique (at, name)
);

-- The spine's read: high-impact, already landed, not yet looked at.
create index if not exists eugenia_calendar_due
  on public.eugenia_calendar (at) where looked_at is null;
-- The briefing's read, and the app card's: today, in order.
create index if not exists eugenia_calendar_at on public.eugenia_calendar (at desc);

alter table public.eugenia_calendar enable row level security;

-- ─── The running story ─────────────────────────────────────────────────────
-- ONE ROW, REWRITTEN, AND THAT IS THE WHOLE DESIGN.
--
-- Her memory had two timescales and needed three. Turns roll over in a morning;
-- notes are durable facts about HIM. Nothing held what is going on in the
-- MARKET across weeks — so every briefing rebuilt the story from scratch out of
-- a web search, and continuity survived only as long as yesterday stayed inside
-- twelve turns.
--
-- That is why a briefing can read like a feed however good the prose rules are.
-- An analyst carries a thesis — *the market has been trading the December cut
-- since October and the last three prints have chipped at it* — and each morning
-- MOVES it. This is that sentence, and it is handed over with every briefing.
--
-- REWRITTEN RATHER THAN APPENDED, which is the opposite of eugenia_notes and is
-- correct for the opposite reason. A note is a fact that stays true; a thesis is
-- a reading that is only ever current, and a list of superseded readings is an
-- archive of things that are no longer so. The trail is not lost: every briefing
-- that ever stated it is in eugenia_turns and is searchable.
--
-- Same single-row shape as eugenia_channels, and for the same reason — the row
-- IS the current answer, so there is no id to pick and no window to fall out of.
create table if not exists public.eugenia_thesis (
  id         text primary key
    constraint eugenia_thesis_singleton check (id = 'current'),

  -- Deliberately longer than a note and far shorter than a briefing. A thesis
  -- that runs to a paragraph has stopped being a thesis.
  thesis     text not null
    constraint eugenia_thesis_length check (char_length(thesis) between 1 and 600),

  -- The New York civil day it last moved, written by the function for the
  -- reason moved_on is: now() is UTC and an evening rewrite would file on
  -- tomorrow. A thesis that has not moved in a fortnight is itself the finding.
  moved_on   date,
  updated_at timestamptz not null default now()
);

-- Seeded, so the read never has to answer "no row yet" separately from "nothing
-- decided yet". The starting text says exactly what is true on day one.
insert into public.eugenia_thesis (id, thesis) values
  ('current', 'No running thesis yet — this is written by the nightly pass once there is a story to carry.')
on conflict (id) do nothing;

alter table public.eugenia_thesis enable row level security;

-- ─── What she flagged, and what she asked ──────────────────────────────────
-- THE LOOPS SHE OPENS AND COULD NEVER CLOSE.
--
-- Every briefing flags one genuinely odd thing and asks one question, and both
-- were fire-and-forget. The prompt asks her to follow through — *if you flagged
-- something odd and it resolved, say so* — with nothing to follow through
-- WITH: whether Tuesday's oddity ever resolved depended entirely on whether
-- Tuesday was still inside twelve turns.
--
-- The question is worse, because it is the part the prompt calls the most
-- valuable thing in the briefing: his answer is evidence about what he actually
-- understands. He answers three hours later, and nothing joins the answer back
-- to what was asked.
--
-- OPEN UNTIL CLOSED, and closing is a decision the nightly pass makes with the
-- day in front of it — the same argument that put note-writing there. `closed_on`
-- null is the whole read filter, exactly as `superseded_by` is for notes.
create table if not exists public.eugenia_loops (
  id         bigserial primary key,

  -- 'watch' is a fact that did not fit the story and might resolve. 'question'
  -- is one she put to him and has not had back. They are one table because they
  -- share a shape and a lifecycle, and separate values because what closes them
  -- is different: a watch resolves in the world, a question resolves in him.
  kind       text not null
    constraint eugenia_loops_kind_check check (kind in ('watch', 'question')),

  body       text not null
    constraint eugenia_loops_body_length check (char_length(body) between 1 and 200),

  opened_on  date not null,
  closed_on  date,

  -- What actually happened, written when it closes. Null while open.
  resolution text
    constraint eugenia_loops_resolution_length
      check (resolution is null or char_length(resolution) between 1 and 200),

  created_at timestamptz not null default now()
);

-- Partial, matching the read exactly: a closed loop is never selected, so it has
-- no business in the index. Same shape as eugenia_notes_kind_id_desc.
create index if not exists eugenia_loops_open
  on public.eugenia_loops (kind, id desc) where closed_on is null;

alter table public.eugenia_loops enable row level security;

-- ─── Whether it landed ─────────────────────────────────────────────────────
-- THE SIGNAL THAT ONLY EXISTED WHEN HE WAS ANNOYED ENOUGH TO TYPE.
--
-- An instruction note is the only correction channel he has, and it is a good
-- one — but it fires only when something bothers him enough to say so. On every
-- ordinary morning there is no signal at all, which means the nightly pass
-- judges her own output with no evidence about how any of it landed.
--
-- Two buttons under a briefing is the cheapest real evidence available, and the
-- mechanism is already proven in this system: Gladys has drawn an inline
-- keyboard and answered its taps since she shipped.
--
-- IT IS NOT A SCORE AND MUST NOT BECOME ONE. The pass reads it as one input
-- beside the day's turns; a bot optimising a thumbs-up average would start
-- writing briefings that flatter rather than teach, which is the exact failure
-- the prohibitions exist to prevent.
create table if not exists public.eugenia_feedback (
  id         bigserial primary key,

  -- The civil day of the briefing being rated, so a tap arriving at lunchtime
  -- still files against the morning it was about.
  on_day     date not null,

  verdict    text not null
    constraint eugenia_feedback_verdict_check check (verdict in ('good', 'off')),

  created_at timestamptz not null default now(),

  -- ONE VERDICT PER DAY, LAST TAP WINS — handled by the function's upsert. He
  -- may change his mind; two contradictory rows for one briefing would be a
  -- number nobody could read.
  constraint eugenia_feedback_one_a_day unique (on_day)
);

alter table public.eugenia_feedback enable row level security;

-- ─── Search that survives a rephrasing ─────────────────────────────────────
-- FULL TEXT ALONE IS KEYWORD MATCHING WEARING THE WORD "SEARCH".
--
-- `websearch_to_tsquery` finds rows containing the words asked for. Ask "what
-- did we conclude about the December cut" and a turn saying *the market has
-- mostly given up on easing this year* is invisible — same subject, no shared
-- stem. The failure is silent, and the prompt makes it worse by telling her an
-- empty result is trustworthy: *if the search comes back empty, that is an
-- answer worth trusting*. A miss becomes a confident "I have no record of it".
--
-- pg_trgm IS THE HALF THAT NEEDS NO NEW VENDOR. Trigram matching catches the
-- rephrasings, the typos and the half-remembered quotes that stemming cannot,
-- and it does it inside Postgres — no embedding provider, no second AI key, no
-- per-write cost, and nothing to backfill. It is not semantic search and this
-- file does not claim it is; it is the reach that was missing, bought with an
-- extension that ships with the database.
--
-- word_similarity RATHER THAN similarity, AND THE DIFFERENCE IS TOTAL HERE.
-- `similarity()` normalises over the union of both trigram sets, so a six-word
-- question against a fourteen-hundred-character briefing scores near zero
-- however well it matches — every long turn would be unreachable. word_similarity
-- scores the query against the BEST MATCHING EXTENT within the target, which is
-- exactly the shape of this problem: a short query, a long document.
create extension if not exists pg_trgm;

create index if not exists eugenia_notes_trgm
  on public.eugenia_notes using gin (note gin_trgm_ops);
create index if not exists eugenia_turns_trgm
  on public.eugenia_turns using gin (content gin_trgm_ops);

-- THE RETURN TYPE IS UNCHANGED, AND THAT IS LOAD-BEARING. `create or replace
-- function` may not alter a return type; widening it needs a `drop function`,
-- which takes the grants at the bottom of 003 with it. So the hybrid rides
-- inside the existing five columns exactly as `role` rides inside `source`.
--
-- RANKED IN TWO KEYS RATHER THAN ONE FUSED SCORE. ts_rank lands around 0.0-0.1
-- and word_similarity spans 0-1, so adding or maxing them requires a scale
-- factor invented to make the arithmetic come out — a fudge that decides
-- rankings while looking like a formula. Instead: an exact word match outranks
-- a near one, and within each group the stronger score wins. That is a rule a
-- person can predict, and it cannot silently invert when a constant drifts.
--
-- `lexical` is not returned; it only orders. Every row that comes back is a hit
-- either way, and telling her which mechanism found it would be telling her
-- about the plumbing.
create or replace function public.eugenia_search(q text, lim int default 12)
returns table (source text, id bigint, at timestamptz, retired boolean, body text)
language sql
stable
as $$
  select source, id, at, retired, body
  from (
    select 'note' as source, n.id, n.created_at as at,
           n.superseded_by is not null as retired, n.note as body,
           n.search @@ websearch_to_tsquery('english', q) as lexical,
           greatest(
             ts_rank(n.search, websearch_to_tsquery('english', q)),
             word_similarity(q, n.note)
           ) as rank
      from public.eugenia_notes n
     where n.search @@ websearch_to_tsquery('english', q)
        -- The operator rather than the function, so the trigram index is used:
        -- `q <% target` is word_similarity above pg_trgm.word_similarity_threshold.
        or q <% n.note
    union all
    select case when t.role = 'user' then 'him' else 'you' end,
           t.id, t.created_at, false, t.content,
           t.search @@ websearch_to_tsquery('english', q),
           greatest(
             ts_rank(t.search, websearch_to_tsquery('english', q)),
             word_similarity(q, t.content)
           )
      from public.eugenia_turns t
     where t.search @@ websearch_to_tsquery('english', q)
        or q <% t.content
  ) hits
  order by lexical desc, rank desc, at desc
  limit greatest(1, least(coalesce(lim, 25), 25));
$$;

-- Restated because `create or replace` above does not disturb them, and because
-- a reader arriving at this file should not have to open 003 to learn that her
-- memory is not a public endpoint.
revoke execute on function public.eugenia_search(text, int) from public;
grant execute on function public.eugenia_search(text, int) to service_role;

-- ─── The trade she finds out about in two minutes ──────────────────────────
-- THE SECOND HALF OF THE EVENT SPINE, AND THE ONE WITH A LIVE FEED ALREADY.
--
-- doji-mcp-sync writes a position within two minutes of it opening. Nothing
-- told her — so a trade taken at 10:47 reached her the next morning as one row
-- inside a week of JSON, by which time there is nothing useful left to say.
--
-- SHE STILL GIVES NO VERDICT, and this trigger does not change that. What it
-- buys is the one thing that is both factual and his: a high-impact print
-- pending against a position that is actually open. R-14 and R-19 are HIS rules
-- about exactly that situation, and naming the rule at the moment it applies is
-- citation, not advice. The function stays silent when there is nothing pending,
-- which on most days is the answer.
--
-- pg_net, THE CRON SECRET, AND NO DATABASE POWER — the same shape as the two
-- jobs in 004_cron.sql and Gladys's trigger, read from Vault at call time rather
-- than written into the trigger body. The lower-case Vault spelling is not
-- optional: Postgres compares it case-sensitively, a miss yields null, and
-- Gladys's trigger shipped once reading the upper-case name and went quiet
-- without failing anything.
create or replace function public.trades_eugenia_on_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
begin
  -- OPENED is an insert the poller made; CLOSED is fill_time arriving. Both are
  -- facts about the broker's side, and neither can be produced by the app or by
  -- Gladys, whose writes only ever touch the four journal columns.
  if tg_op = 'INSERT' then
    kind := 'opened';
  else
    kind := 'closed';
  end if;

  perform net.http_post(
    url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                  where name = 'doji_cron_secret')),
    body    := jsonb_build_object('trade', new.id, 'event', kind),
    -- Longer than the poller's 20s because this may run a model call, shorter
    -- than the hourly job's 300s because it never runs a briefing. pg_net is
    -- fire-and-forget either way; the bound only has to outlast the work.
    timeout_milliseconds := 60000
  );
  return null;
end;
$$;

drop trigger if exists trades_eugenia_opened on public.trades;
drop trigger if exists trades_eugenia_closed on public.trades;

-- BROKER ROWS ONLY, AND NEVER A SOFT-DELETED ONE. Pre-sync rows carry client
-- ids and would fire on any historical backfill.
create trigger trades_eugenia_opened
  after insert on public.trades
  for each row
  when (new.id like 'PID%' and new.deleted = false and new.fill_time is null)
  execute function public.trades_eugenia_on_event();

-- `is distinct from`, NEVER `<>`, and this is the same three-state trap
-- trades_telegram_on_answer already documents: fill_time is null on every open
-- position, and `old.fill_time <> new.fill_time` is NULL rather than true on the
-- transition that matters — so the one event this trigger exists for would be
-- the one it never fired on. The poller re-upserts every position in its window
-- every two minutes, so without this clause it would fire on every tick forever.
create trigger trades_eugenia_closed
  after update on public.trades
  for each row
  when (new.id like 'PID%' and new.deleted = false
        and old.fill_time is null and new.fill_time is distinct from null)
  execute function public.trades_eugenia_on_event();

-- ═══════════════════════════════════════════════════════════════════════════
-- THE MARK SHE MEASURES A MOVE FROM
-- ───────────────────────────────────────────────────────────────────────────
-- The senses above are both events: a print she filed lands, a position opens.
-- Price itself is neither — it is a level that is always there, and "gold moved"
-- is only a fact against a previous reading. This row is that reading.
--
-- ONE ROW, REWRITTEN EVERY QUARTER HOUR, which is what makes the question
-- answerable in one read: `bid` is where gold was at the last look and `at` is
-- when, so the move is a subtraction and the window is the gap between runs
-- rather than a number anyone has to choose.
--
-- `looked_at` IS A SEPARATE COLUMN BECAUSE IT ANSWERS A DIFFERENT QUESTION.
-- The mark advances on every run; `looked_at` advances only when a move was
-- worth waking her for, and it is what keeps a market that trends all afternoon
-- from producing a message every fifteen minutes about the same story.
--
-- Stamped BEFORE the look, exactly as eugenia_calendar.looked_at is: a look that
-- generates and then fails to write would otherwise re-fire on the next run,
-- each one a billed model call.
create table if not exists public.eugenia_price (
  id        text primary key
    constraint eugenia_price_singleton check (id = 'current'),

  -- Display price, two decimals — the poller folds pipettes out of the quote
  -- before she ever sees it, and this stores what she was shown.
  bid       numeric not null,
  at        timestamptz not null default now(),

  -- Null until the first move worth a message. Nothing seeds it, because "she
  -- has never spoken about a move" is a true thing to say on day one.
  looked_at timestamptz
);

-- Seeded like eugenia_thesis, so the first run has a row to PATCH rather than a
-- missing-row branch that exists for one moment in the life of the database. A
-- zero mark cannot be mistaken for a price: the first look reads it, finds the
-- move absurd against the floor it is measured in, and writes the real one.
insert into public.eugenia_price (id, bid, at)
  values ('current', 0, now())
  on conflict (id) do nothing;

alter table public.eugenia_price enable row level security;

-- ─── What the app may see ──────────────────────────────────────────────────
-- THE ONE PLACE HER WORK AND THE DASHBOARD MEET, AND IT IS DELIBERATELY NARROW.
--
-- index.html and doji-eugenia have shared a database and nothing else: everything
-- she knows has lived in a Telegram thread. Three things are worth putting on
-- the screen he already opens every morning — what lands today, what the story
-- is, and what is still open — and none of them is private to her.
--
-- NOT eugenia_notes AND NOT eugenia_turns, which stay denied to the publishable
-- key exactly as 003 left them. Her notes are her working memory and his audit
-- of them is /notes, in her own thread, where an answer can be asked about.
--
-- A POLICY RATHER THAN A GRANT-ONLY VIEW. These three tables are single-user and
-- hold no user_id — there is nothing to scope a policy BY — so `using (true)`
-- for authenticated is the honest statement of what is true, rather than a
-- security_invoker view standing in front of tables that deny everyone.
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

-- SELECT ONLY, AND SAID RATHER THAN ASSUMED. The policies above decide the rows;
-- these grants decide the verbs. The app has no business writing any of this —
-- every one of these tables has exactly one writer, and she is an Edge Function.
grant select on public.eugenia_calendar to authenticated;
grant select on public.eugenia_thesis to authenticated;
grant select on public.eugenia_loops to authenticated;
