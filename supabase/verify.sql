-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — does the live database still match these files?
-- ───────────────────────────────────────────────────────────────────────────
-- The schema is applied by hand, on purpose: a schema change that lands because
-- a file was committed is the same accident the README argues against for
-- restores. But applying by hand means the numbered files are a CLAIM about the
-- database rather than a description of it, and until this existed there was no
-- way to test the claim. A column added in the dashboard during a repair, a
-- policy dropped and not put back, a cron job edited in place — none of it
-- would show up anywhere.
--
-- So this is the other half of that trade: nothing here writes, and running it
-- is the check. Start with the summary block below — it answers every question
-- in one result set, which is what a SQL editor can actually show you. Ten
-- seconds, and it is worth doing after any manual change and before believing
-- anything in this repository about the database.
--
-- A CI job cannot do this instead. 002, 003 and 004 need pg_net, vault and
-- pg_cron, none of which a plain Postgres container has — so a green pipeline
-- would prove only that 001 parses, which is the least of what can drift.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── One query, and it is the one to run ───────────────────────────────────
-- THE REST OF THIS FILE IS TEN SEPARATE STATEMENTS, and a SQL editor shows the
-- result of the LAST one only — so running the file top to bottom displays the
-- HTTP responses and hides every check above them. Run this block on its own
-- (select it and press Run), read the `ok` column, and go looking below only
-- where it says false.
--
-- Each row is a fact 001-005 asserts, read back out of the catalogs. `expected`
-- is what the files say; `actual` is what the database holds.
-- coalesce, because a check whose subquery finds nothing yields NULL and NULL
-- is not false — a missing table would print a blank `ok` and read as fine.
select check_name, actual, expected, coalesce(actual = expected, false) as ok
from (values
  ('tables and the view exist',
   (select count(*)::text from information_schema.tables
     where table_schema = 'public'
       and table_name in ('trades','eugenia_turns','eugenia_notes','eugenia_trades',
                          'eugenia_channels')),
   '5'),

  -- 005's six. Separate from the row above rather than folded into it, because
  -- a database with 003 and not 005 is a real and expected state — she runs,
  -- every tool that touches one of these answers "that did not save", and the
  -- only sign is a count. Which of the six is missing is in the table listing
  -- further down.
  ('005 tables exist',
   (select count(*)::text from information_schema.tables
     where table_schema = 'public'
       and table_name in ('eugenia_runs','eugenia_calendar','eugenia_thesis',
                          'eugenia_loops','eugenia_feedback','eugenia_price')),
   '6'),

  -- The thesis is a single row seeded by 005, and setThesis PATCHes it by
  -- primary key — so a missing row is a 200 with an empty array and every
  -- rewrite is dropped. The function reports that back to her; nothing reaches
  -- him. Exactly the eugenia_channels seeding failure, in a second place.
  ('the thesis row is seeded',
   (select count(*)::text from public.eugenia_thesis where id = 'current'),
   '1'),

  -- And the price mark, for the same reason and with the same failure: markPrice
  -- PATCHes by primary key, so without the row every reading is dropped, the mark
  -- never advances, and the price sense answers "no mark yet" forever — which is
  -- also what it answers on a genuinely quiet market.
  ('the price mark row is seeded',
   (select count(*)::text from public.eugenia_price where id = 'current'),
   '1'),

  -- Without pg_trgm the `<%` operator does not exist, so eugenia_search fails
  -- to create — and if it were created before the extension were dropped, every
  -- search would error inside her tool loop.
  ('pg_trgm is installed',
   (select count(*)::text from pg_extension where extname = 'pg_trgm'),
   '1'),

  -- 007. Without the extension the column type does not exist and the whole
  -- file refuses; with it and no columns, every write still lands and the
  -- semantic arm is simply never reached.
  ('pgvector is installed',
   (select count(*)::text from pg_extension where extname = 'vector'),
   '1'),
  ('both memories have an embedding column',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and column_name = 'embedding'
       and table_name in ('eugenia_notes','eugenia_turns')),
   '2'),

  -- THE GRANTS THE DROP TOOK WITH IT. 007 drops the two-argument search — it
  -- cannot replace it in place, because the query vector is a new argument —
  -- and a bare `create function` carries EXECUTE to PUBLIC, which anon
  -- inherits. Expected: granted to service_role and to nobody else.
  ('the search is executable by service_role alone',
   (select count(*)::text from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'eugenia_search'
       and grantee = 'service_role' and privilege_type = 'EXECUTE'),
   '1'),
  /* ASKED OF EVERY FUNCTION THIS REPOSITORY CREATES, which is a narrower thing
     than every function in the schema and the difference is a hundred and forty
     of them. `revoke ... from public` revokes the PUBLIC pseudo-role, while
     Supabase's default privileges on the public SCHEMA grant EXECUTE to anon
     and authenticated separately and by name — two things spelled the same way,
     so every function created here has arrived reachable by the publishable key
     and nothing ever asked.

     THREE EXCLUSIONS AND EACH ONE IS THE DIFFERENCE BETWEEN A CHECK AND A
     NUMBER. `pg_depend ... deptype = 'e'` drops everything an EXTENSION owns:
     pgvector installs about a hundred functions into this schema and pg_trgm a
     score more, all of them meant to be executable, and counting them answered
     149 to a row expecting 0 — a check that fires on everything, which is as
     useless as one that fires on nothing. `prorettype <> trigger` drops the
     three trigger functions, since PostgREST cannot call one and the question
     is what a browser can reach. And has_function_privilege rather than
     routine_privileges, because it answers for the ROLE however the privilege
     arrived — by name or through PUBLIC. */
  ('no function of ours is reachable by the publishable key',
   (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype <> 'trigger'::regtype
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
   '0'),

  -- The app's card reads three of her tables and nothing else. No policy is an
  -- empty list rather than an error, so the card hides itself and the reason is
  -- unknowable from the browser.
  ('the app can read the three tables its card draws',
   (select count(*)::text from pg_policies
     where schemaname = 'public'
       and tablename in ('eugenia_calendar','eugenia_thesis','eugenia_loops')
       and cmd = 'SELECT'),
   '3'),

  -- And her memory is still shut to it. This one is expected to be ZERO, and it
  -- is the check that would catch a policy added to the wrong table.
  ('her notes and turns stay closed to the app',
   (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename in ('eugenia_notes','eugenia_turns')),
   '0'),

  -- If pnl is a plain column, the email-beats-computed rule is no longer stated
  -- in the schema and every client is reading a stored value nobody maintains.
  ('pnl is a generated column',
   (select is_generated from information_schema.columns
     where table_schema = 'public' and table_name = 'trades' and column_name = 'pnl'),
   'ALWAYS'),

  -- The poller writes this and nothing else does, so a database that missed the
  -- alter takes every size silently: PostgREST drops an unknown key from a
  -- merge-duplicates payload rather than refusing the row, and the fills keep
  -- landing without one.
  ('trades has its size_oz column',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'trades' and column_name = 'size_oz'),
   'numeric'),

  -- And Eugenia reads the journal through the view, so the column existing on
  -- the table is only half of it.
  ('eugenia_trades exposes size_oz',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_trades' and column_name = 'size_oz'),
   '1'),

  -- 006. The plan write is a PATCH filtered on `planned_sl=is.null`, so without
  -- the columns it is a 400 the poller swallows to keep the deals landing —
  -- every run then reports planned: 0 and nothing else says why.
  ('trades has its plan columns',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'trades'
       and column_name in ('planned_sl','planned_tp')),
   '2'),
  ('eugenia_trades exposes the plan',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_trades'
       and column_name in ('planned_sl','planned_tp')),
   '2'),

  ('RLS on trades',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.trades')),
   'true'),
  ('one policy on trades',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.trades')),
   '1'),

  -- RLS enabled with NO policy is what denies the publishable key outright. A
  -- policy appearing here would turn either table into an open log.
  ('RLS on eugenia_turns',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_turns')),
   'true'),
  ('no policy on eugenia_turns',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.eugenia_turns')),
   '0'),
  ('RLS on eugenia_notes',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_notes')),
   'true'),
  ('no policy on eugenia_notes',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.eugenia_notes')),
   '0'),
  ('RLS on eugenia_channels',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_channels')),
   'true'),
  ('no policy on eugenia_channels',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.eugenia_channels')),
   '0'),

  -- THE SEED IS THE ONE THING agree.test.mjs CANNOT CHECK. It reads the insert
  -- statement in 003 and confirms it names all five; whether those five rows are
  -- actually IN the table is a fact about the database and only this file can
  -- ask. It matters more than it looks: setChannel PATCHes by primary key, so a
  -- missing row is a 200 with an empty array — the move is silently dropped, and
  -- the channel then renders at the bottom rung forever, which is exactly what a
  -- channel he has genuinely never used looks like. Every night, reported to
  -- nobody.
  ('all five channels are seeded',
   (select count(*)::text from public.eugenia_channels),
   '5'),

  -- Without this the view reads `trades` with its owner's rights, and what RLS
  -- does then depends on who ran 003 rather than on who is asking.
  -- Read through pg_options_to_table and cast, so `security_invoker = on` — the
  -- same thing said differently — is not reported as a drift.
  ('eugenia_trades runs with the caller''s rights',
   (select coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'false')::boolean::text
      from pg_class c where c.oid = to_regclass('public.eugenia_trades')),
   'true'),

  -- Which security_invoker makes load-bearing: an invoker's-rights view does
  -- not borrow its owner's access to the table underneath.
  ('service_role can select trades directly',
   (select count(*)::text from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'trades'
       and grantee = 'service_role' and privilege_type = 'SELECT'),
   '1'),

  -- Without this every remember() lands as kind 'fact' by default and standing
  -- instructions are evicted by ordinary observations — silently, and after she
  -- has told him they stuck.
  ('eugenia_notes has its kind column',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_notes' and column_name = 'kind'),
   'text'),

  -- Without this the read's `superseded_by=is.null` filter is a 400 from
  -- PostgREST on every turn, which notesBlock() swallows — so she loses her
  -- whole memory and says nothing about it.
  ('eugenia_notes has its superseded_by column',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_notes'
       and column_name = 'superseded_by'),
   'bigint'),

  -- And the index has to carry the same filter or the read stops using it.
  ('the notes index is partial on live notes',
   (select count(*)::text from pg_indexes
     where schemaname = 'public' and indexname = 'eugenia_notes_kind_id_desc'
       and indexdef ilike '%where (superseded_by IS NULL)%'),
   '1'),

  /* Without these she still answers, and answers as though the archive were
     empty: searchMemory catches the 404 and reports that memory could not be
     searched, which is indistinguishable from a database that is merely down.

     COUNTED BY NAME AND NEVER BY SIGNATURE, and that is the whole lesson of
     this row. A companion check here asked has_function_privilege about
     `public.eugenia_search(text, int)` — the signature 003 created and 007
     deliberately dropped for the three-argument one. A hand-written signature
     that no longer resolves does not fail: it THROWS, 42883, which aborts the
     file, so the eleven checks below this point silently stopped running the
     day 007 was applied and the whole run reported itself as a database fault.

     It is gone rather than corrected. The grant question it asked is answered
     for EVERY function above, by oid, for anon and authenticated — and since
     every role is a member of PUBLIC, a privilege held through PUBLIC shows up
     there too. A copy that can go stale, in a file whose errors are fatal, in
     service of a question already answered, is three reasons to delete it. */
  ('eugenia_search exists',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'eugenia_search'),
   '1'),
  ('both search columns exist',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and column_name = 'search'
       and table_name in ('eugenia_notes', 'eugenia_turns')),
   '2'),

  -- A tsvector match without a GIN index is a sequential scan over the whole
  -- archive, which is correct and gets slower every week.
  ('both search indexes exist',
   (select count(*)::text from pg_indexes
     where schemaname = 'public'
       and indexname in ('eugenia_notes_search', 'eugenia_turns_search')),
   '2'),

  -- A single-table view is auto-updatable, so anything beyond SELECT here makes
  -- her read of the journal a write path.
  ('eugenia_trades is select-only, service_role only',
   (select coalesce(string_agg(distinct grantee || ':' || privilege_type, ',' order by grantee || ':' || privilege_type), 'none')
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'eugenia_trades'
       and grantee in ('anon','authenticated','service_role')),
   'service_role:SELECT'),

  ('the Telegram trigger function calls doji-gladys',
   (select (prosrc like '%doji-gladys%')::text from pg_proc where proname = 'trades_telegram'),
   'true'),
  /* NAMED RATHER THAN COUNTED, and the count is why. This row expected THREE —
     001's touch and 002's two — and 005 added the event spine's two without
     anyone changing it, so the first time it ever ran it reported a correct
     database as wrong. It had never run before that: it sits below the stale
     signature that was aborting the file.

     A count is the wrong shape for this even when its number is right. Five is
     still five if one is renamed and another added, which is precisely the
     drift a trigger suffers — and the two that matter most fail silently, since
     a position opening or closing with nothing telling her is indistinguishable
     from a quiet day. Silence is this path's correct answer most of the time.

     Sorted, so the expected string is stable however Postgres returns them. */
  ('exactly the five triggers on trades',
   (select string_agg(tgname, ',' order by tgname) from pg_trigger
     where tgrelid = to_regclass('public.trades') and not tgisinternal),
   'trades_eugenia_closed,trades_eugenia_opened,trades_telegram_on_answer,' ||
   'trades_telegram_on_open,trades_touch_updated_at'),

  -- Without it Gladys has no message to edit, and a trade journalled in the app
  -- leaves her Telegram message showing an empty one for good. Nothing else
  -- reports its absence: the redraw trigger's WHEN clause requires the column to
  -- be non-null, so a database missing it is simply a database where the second
  -- half of this feature never fires.
  ('trades carries Gladys''s message id',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'trades' and column_name = 'tg_message_id'),
   'bigint'),

  -- Without this a fill never reaches an open tab on its own. The five-minute
  -- refresh still finds it, so the failure is a slow app rather than a broken
  -- one — which is why it goes unnoticed.
  ('trades is published to realtime',
   (select count(*)::text from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'trades'),
   '1'),

  -- FIVE, AND THIS ROW HAS BEEN WRONG BEFORE. It said three while 004 defined
  -- four, so a correct database reported a mismatch and the row that exists to
  -- catch a missing job was the thing that looked broken. Count 004's
  -- cron.schedule calls when this changes.
  ('five cron jobs, all active',
   (select count(*)::text from cron.job where active),
   '5'),

  -- THE SECRET NAME, WHICH USED TO BE READ BY EYE AND IS THE FAILURE THIS
  -- SYSTEM HAS HAD TWICE. Postgres compares the Vault name case-sensitively, so
  -- the upper-case spelling matches nothing, yields null and makes the caller
  -- give up without raising anything. Every calling job must name the lower-case
  -- one; purge-cron-history is a DELETE and presents no secret.
  ('all four calling jobs read the lower-case Vault secret',
   (select count(*)::text from cron.job
     where command like '%''doji_cron_secret''%'),
   '4'),
  -- The third caller, and the one that actually shipped with the upper-case
  -- spelling. It is a function body rather than a job, so it needs its own row.
  ('the Telegram trigger function reads the lower-case Vault secret',
   (select (prosrc like '%''doji_cron_secret''%')::text
      from pg_proc where proname = 'trades_telegram'),
   'true'),

  -- One of the three places the setups vocabulary lives. test/agree.test.mjs
  -- holds the other two together and cannot see this one.
  ('both setups are accepted by the constraint',
   (select (pg_get_constraintdef(oid) like '%Break & Retest%'
        and pg_get_constraintdef(oid) like '%Support & Resistance%')::text
      from pg_constraint where conname = 'trades_setup_check'),
   'true')
) as t(check_name, actual, expected);

-- ─── Tables and views ──────────────────────────────────────────────────────
-- Expect exactly: trades, eugenia_turns, eugenia_notes, and the eugenia_trades
-- VIEW. `records`, `broker_fills` and `app_state` were dropped; anything else
-- appearing here is something nothing in this repository knows about.
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;

-- ─── Columns ───────────────────────────────────────────────────────────────
-- Against 001_trades.sql. `pnl` must read `is_generated = ALWAYS` — if it is a
-- plain column, the email-beats-computed rule is no longer stated in the schema
-- and every client that reads a P&L is reading a stored value nobody maintains.
select table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default, is_generated
from information_schema.columns
where table_schema = 'public'
  and table_name in ('trades', 'eugenia_turns', 'eugenia_notes')
order by table_name, ordinal_position;

-- ─── Constraints ───────────────────────────────────────────────────────────
-- The vocabularies that cannot be bypassed from any client: direction, setup,
-- the commission sign, the turn roles and the note length. trades_setup_check
-- in particular is one of the three places the setups list lives — the other
-- two are index.html and doji-gladys, and test/agree.test.mjs asserts all three
-- say the same thing. It cannot read the live database, so this is where a
-- constraint edited by hand would be caught.
select rel.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and con.contype in ('c', 'p', 'f')
order by rel.relname, con.conname;

-- ─── Indexes ───────────────────────────────────────────────────────────────
-- trades_user_open_day carries the client's only read — one user's trades,
-- newest day first — and the DESC is what lets the index serve the sort as well
-- as the filter. The two id-DESC indexes are Eugenia's only reads.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- ─── Row level security ────────────────────────────────────────────────────
-- All three tables must show rowsecurity = true. `trades` has one policy for
-- all four verbs; the two eugenia_ tables must have NO policy at all, which is
-- what denies the publishable key outright — RLS enabled with a policy nobody
-- noticed would turn either into an open log.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       coalesce(p.polname, '(no policy — correct for eugenia_*)') as policy,
       case when p.polname is null then null else pg_get_expr(p.polqual, p.polrelid) end as using_clause
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- ─── Grants on Eugenia's view ──────────────────────────────────────────────
-- Expect ONE row: service_role, SELECT. A single-table view is auto-updatable
-- in Postgres, so an INSERT/UPDATE/DELETE grant appearing here would make her
-- read of the journal a write path. anon or authenticated appearing at all
-- would hand the publishable key a read of the journal — scoped by RLS, since
-- the view is security_invoker, but a read it has no business having.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'eugenia_trades'
order by grantee, privilege_type;

-- ─── Triggers ──────────────────────────────────────────────────────────────
-- Expect three on trades: trades_touch_updated_at (BEFORE UPDATE),
-- trades_telegram_on_open (AFTER INSERT) and trades_telegram_on_answer
-- (AFTER UPDATE). Read the WHEN clauses on the last two. On the open,
-- `new.entry_time > now() - interval '01:00:00'` is the guard that stops a
-- restore from backup messaging the trader once per row in the file. On the
-- answer, the four journal columns compared with `is distinct from` — `<>` is
-- NULL against an unanswered one, so it would skip the first answer to every
-- question — and `new.tg_message_id is not null`, which is what keeps a row
-- that never had a message silent.
--
-- BOTH MUST NAME trades_telegram. A trigger left pointing at the function's old
-- single-purpose name is a 404 into a void, and pg_net discards the response.
select event_object_table as table_name, trigger_name, action_timing, event_manipulation,
       pg_get_triggerdef(t.oid) as definition
from information_schema.triggers ist
join pg_trigger t on t.tgname = ist.trigger_name
where ist.trigger_schema = 'public'
order by event_object_table, trigger_name;

-- ─── Realtime ──────────────────────────────────────────────────────────────
-- `trades` must be in the publication or a fill arriving from the poller never
-- reaches an open tab on its own. The five-minute refresh would still find it,
-- so the failure is a slow app rather than a broken one — which is why it can
-- go unnoticed.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

-- ─── How much of her memory is actually searchable by meaning ──────────────
-- THE ONE NUMBER THE SUMMARY ABOVE CANNOT BE. A null embedding is not an error
-- and not a missing row: the search still answers, and simply never returns
-- that row from its semantic arm. Every row written before 007 has one, and so
-- does any row whose vendor call failed.
--
-- Expect `pending` to fall to zero as `?embed=1` is called, and to sit at zero
-- afterwards. A number that climbs day after day means the embedding key is
-- unset or the vendor is refusing, and nothing else anywhere will say so.
select 'eugenia_notes' as table, count(*) filter (where embedding is null) as pending,
       count(*) as rows
  from public.eugenia_notes
union all
select 'eugenia_turns', count(*) filter (where embedding is null), count(*)
  from public.eugenia_turns;

-- ─── Scheduled jobs ────────────────────────────────────────────────────────
-- Against 004_cron.sql: doji-mcp-sync every two minutes, doji-eugenia hourly,
-- doji-eugenia-spine at 5,20,35,50 past, doji-eugenia-price at 12,27,42,57 and
-- purge-cron-history nightly — five, all active. The summary block checks the
-- Vault secret name in the calling jobs; this is where the schedules and the
-- timeouts are read.
--
-- The two quarter-hourly jobs are the ones whose absence is silent in a new way.
-- Without the spine every release is still filed by the briefing and none is
-- ever looked at, so the calendar fills up and she never reacts to a print.
-- Without the price job the mark simply stops advancing, which reads from every
-- other surface as a market that has not moved.
select jobid, jobname, schedule, active, command
from cron.job
order by jobname;

-- ─── Did the last calls actually arrive? ───────────────────────────────────
-- The cron reporting `succeeded` proves nothing: net.http_post is asynchronous,
-- so the SQL succeeded in QUEUING the request. This is the function's own
-- answer, and it is the only place a failed poll or a missed briefing is ever
-- reported.
select status_code, content, created
from net._http_response
order by created desc
limit 10;
