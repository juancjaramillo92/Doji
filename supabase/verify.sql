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
  -- READ THROUGH query_to_xml, NOT DIRECTLY, and this is the whole reason. A
  -- plain `select count(*) from public.eugenia_thesis` is PARSED with the rest
  -- of the statement, so on a database that never got 005 it does not report a
  -- missing table — it raises 42P01 and takes all fifty-three checks above and
  -- below it with it, and the run then reads as a broken database rather than
  -- as a missing one. That is the same failure the dead `eugenia_search(text,
  -- int)` signature caused, in a second shape. query_to_xml takes its query as
  -- a STRING, so nothing is parsed until it runs, and the to_regclass guard
  -- means it never runs when the table is absent: the row answers NULL, which
  -- is false against its expected value. A seed check has to read the table —
  -- that is what it is for — so this is how it reads it.
  ('the thesis row is seeded',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.eugenia_thesis where id = ''current''',
             false, true, '')))[1]::text
     where to_regclass('public.eugenia_thesis') is not null),
   '1'),

  -- And the price mark, for the same reason and with the same failure: markPrice
  -- PATCHes by primary key, so without the row every reading is dropped, the mark
  -- never advances, and the price sense answers "no mark yet" forever — which is
  -- also what it answers on a genuinely quiet market.
  ('the price mark row is seeded',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.eugenia_price where id = ''current''',
             false, true, '')))[1]::text
     where to_regclass('public.eugenia_price') is not null),
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

  /* ─── The journal/broker boundary, asked of the database ─────────────────
     Until 009 this was a `for` loop in index.html. The policy on `trades`
     decides which ROWS a session may write and says nothing about which
     COLUMNS, so the publishable key could set `net_pnl` or `direction` on any
     row it owns and Postgres would take it.

     Asked as three rows rather than one, because they fail differently and a
     single count could not say which. The first is the guarantee: not one
     broker column is writable. The second is that the app still WORKS — a
     revoke with the grant missing or mistyped leaves a journal nobody can fill
     in, and that failure reads as the app being broken rather than as this file
     being wrong. The third is the pair of verbs the app has never used.

     has_column_privilege for the same reason has_function_privilege is used
     above: it answers for the ROLE however the privilege arrived, by name or
     through PUBLIC. */
  ('no broker column of trades is writable by the publishable key',
   (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'trades'
       and c.column_name not in
           ('setup','followed_rules','followed_sl','followed_tp','deleted')
       and (has_column_privilege('anon', 'public.trades', c.column_name, 'UPDATE')
         or has_column_privilege('authenticated', 'public.trades', c.column_name, 'UPDATE'))),
   '0'),

  ('the five columns the app owns are still writable by it',
   (select count(*)::text from unnest(array
           ['setup','followed_rules','followed_sl','followed_tp','deleted']) col
     where has_column_privilege('authenticated', 'public.trades', col, 'UPDATE')),
   '5'),

  -- Every row here arrives from the poller or the email function, both of which
  -- hold the secret key. The app has never created a trade, and a removal is the
  -- `deleted` flag rather than a row leaving the table.
  ('the publishable key can neither insert nor delete a trade',
   (select count(*)::text from unnest(array['INSERT','DELETE']) priv
     where has_table_privilege('anon', 'public.trades', priv)
        or has_table_privilege('authenticated', 'public.trades', priv)),
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
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.eugenia_channels',
             false, true, '')))[1]::text
     where to_regclass('public.eugenia_channels') is not null),
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
  --
  -- Read through query_to_xml for the reason the seed checks are: `cron.job`
  -- lives in an extension's schema, and on a database where pg_cron is not
  -- installed a direct read raises rather than reporting. That is not the
  -- target database — Supabase always has it — but a row that can only be run
  -- somewhere is a row that cannot answer anywhere else, and this file's whole
  -- job is to be runnable against a database that is wrong.
  ('five cron jobs, all active',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from cron.job where active',
             false, true, '')))[1]::text
     where to_regclass('cron.job') is not null),
   '5'),

  -- THE SECRET NAME, WHICH USED TO BE READ BY EYE AND IS THE FAILURE THIS
  -- SYSTEM HAS HAD TWICE. Postgres compares the Vault name case-sensitively, so
  -- the upper-case spelling matches nothing, yields null and makes the caller
  -- give up without raising anything. Every calling job must name the lower-case
  -- one; purge-cron-history is a DELETE and presents no secret.
  ('all four calling jobs read the lower-case Vault secret',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from cron.job where command like ''%''''doji_cron_secret''''%''',
             false, true, '')))[1]::text
     where to_regclass('cron.job') is not null),
   '4'),
  -- The two callers that are function bodies rather than jobs, so neither can
  -- be counted with them. Gladys's is the one that actually shipped with the
  -- upper-case spelling; the event spine's presents the same secret and had
  -- never been asked. An absent function yields no row and answers null here,
  -- which is a FALSE result rather than a raise.
  ('the Telegram trigger function reads the lower-case Vault secret',
   (select (prosrc like '%''doji_cron_secret''%')::text
      from pg_proc where proname = 'trades_telegram'),
   'true'),

  ('the event-spine trigger function reads the lower-case Vault secret',
   (select (prosrc like '%''doji_cron_secret''%')::text
      from pg_proc where proname = 'trades_eugenia_on_event'),
   'true'),

  -- One of the three places the setups vocabulary lives. test/agree.test.mjs
  -- holds the other two together and cannot see this one.
  ('both setups are accepted by the constraint',
   (select (pg_get_constraintdef(oid) like '%Break & Retest%'
        and pg_get_constraintdef(oid) like '%Support & Resistance%')::text
      from pg_constraint where conname = 'trades_setup_check'),
   'true'),

  -- ─── The six tables 005 adds ─────────────────────────────────────────────
  -- Asked by NAME rather than as a count of tables with RLS on, because five is
  -- still five when one is renamed and another added. Each is `to_regclass`, so
  -- a table that is not there answers NULL and the row reads false rather than
  -- taking the file down.
  --
  -- These carry no user_id and no policy scoped to one, so RLS is the whole of
  -- the answer to the publishable key: on, it denies; off, the table simply
  -- answers whoever opens the page.
  ('RLS on eugenia_runs',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_runs')),
   'true'),
  ('RLS on eugenia_calendar',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_calendar')),
   'true'),
  ('RLS on eugenia_thesis',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_thesis')),
   'true'),
  ('RLS on eugenia_loops',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_loops')),
   'true'),
  ('RLS on eugenia_feedback',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_feedback')),
   'true'),
  ('RLS on eugenia_price',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_price')),
   'true'),

  -- ─── 008, and the one table that is about the system rather than the desk ─
  -- The heartbeat the poller and the email function leave. It holds no user_id
  -- and gets no policy, so RLS denies the publishable key outright; only the two
  -- writers and Eugenia, all holding the secret key, ever touch it.
  ('RLS on sync_health',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.sync_health')),
   'true'),
  ('no policy on sync_health',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.sync_health')),
   '0'),

  -- Both writers seeded, for the reason the thesis and the price mark are: they
  -- PATCH by primary key, so a missing row is a 200 with an empty array and
  -- every heartbeat is dropped — leaving this table reading as two dead writers
  -- when both are running perfectly.
  ('both sync writers are seeded',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.sync_health',
             false, true, '')))[1]::text
     where to_regclass('public.sync_health') is not null),
   '2'),

  -- ─── The three the dashboard card reads ──────────────────────────────────
  -- RLS on with no policy denies outright, which is right for her notes and
  -- wrong for these: the card reads them with the publishable key, so each one
  -- needs its select policy BY NAME. Missing, RLS does its job and the card
  -- silently shows nothing — a failure that looks exactly like a quiet week.
  ('eugenia_calendar has its app read policy',
   (select count(*)::text from pg_policy
     where polrelid = to_regclass('public.eugenia_calendar')
       and polname = 'eugenia_calendar_app_read'),
   '1'),
  ('eugenia_thesis has its app read policy',
   (select count(*)::text from pg_policy
     where polrelid = to_regclass('public.eugenia_thesis')
       and polname = 'eugenia_thesis_app_read'),
   '1'),
  ('eugenia_loops has its app read policy',
   (select count(*)::text from pg_policy
     where polrelid = to_regclass('public.eugenia_loops')
       and polname = 'eugenia_loops_app_read'),
   '1'),

  -- ─── The four indexes the search actually rides on ───────────────────────
  -- Both arms of the hybrid degrade to a sequential scan over the archive
  -- without these, and a sequential scan is CORRECT — it returns the same rows
  -- and simply gets slower every week, which is the shape of failure nothing
  -- ever reports. Named rather than counted, for the reason above.
  ('both trigram indexes exist',
   (select coalesce(string_agg(indexname, ',' order by indexname), 'none')
      from pg_indexes where schemaname = 'public'
       and indexname in ('eugenia_notes_trgm', 'eugenia_turns_trgm')),
   'eugenia_notes_trgm,eugenia_turns_trgm'),
  ('both embedding indexes exist',
   (select coalesce(string_agg(indexname, ',' order by indexname), 'none')
      from pg_indexes where schemaname = 'public'
       and indexname in ('eugenia_notes_embedding', 'eugenia_turns_embedding')),
   'eugenia_notes_embedding,eugenia_turns_embedding'),

  -- ─── And every index the numbered files create ───────────────────────────
  -- Named in full rather than counted, because fourteen is still fourteen when
  -- one is renamed and another added — the same reason the trigger row below
  -- lists its five. An index missing here is never an error: the query returns
  -- the same rows off a sequential scan and simply gets slower as the table
  -- grows, which is the one kind of fault that never announces itself.
  --
  -- agree.test.mjs builds this list out of the `create index` statements and
  -- fails if it disagrees with the string below, so adding an index to the SQL
  -- and not to this row is caught before anyone has to run the file.
  ('every declared index exists',
   (select coalesce(string_agg(indexname, ',' order by indexname), 'none')
      from pg_indexes where schemaname = 'public' and indexname in (
        'eugenia_calendar_at','eugenia_calendar_due','eugenia_loops_open',
        'eugenia_notes_embedding','eugenia_notes_kind_id_desc','eugenia_notes_search',
        'eugenia_notes_trgm','eugenia_runs_at_desc','eugenia_runs_caller_at',
        'eugenia_turns_embedding','eugenia_turns_id_desc','eugenia_turns_search',
        'eugenia_turns_trgm','trades_user_open_day')),
   'eugenia_calendar_at,eugenia_calendar_due,eugenia_loops_open,' ||
   'eugenia_notes_embedding,eugenia_notes_kind_id_desc,eugenia_notes_search,' ||
   'eugenia_notes_trgm,eugenia_runs_at_desc,eugenia_runs_caller_at,' ||
   'eugenia_turns_embedding,eugenia_turns_id_desc,eugenia_turns_search,' ||
   'eugenia_turns_trgm,trades_user_open_day')
) as t(check_name, actual, expected);

-- ─── Tables and views ──────────────────────────────────────────────────────
-- Every object the numbered files declare, and nothing else. The summary above
-- holds the list itself, asserted against those files — this is the eye pass
-- beside it, so anything appearing here that the summary did not name is
-- something nothing in this repository knows about. It does not enumerate:
-- a list written out here goes stale on the file that adds a table, and reads
-- as a correct database gone wrong.
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
-- EVERY table listed must show rowsecurity = true, however many there are — the
-- count belongs to the schema and not to this comment, which said "all three"
-- for as long as there were ten. `trades` has one policy for all four verbs;
-- 005 gives the three the dashboard card reads a select-only policy each; and
-- her notes, turns and channels must have NO policy at all, which is what
-- denies the publishable key outright. RLS enabled with a policy nobody noticed
-- would turn any of those three into an open log.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- IF THE GRID ABOVE IS THE ONLY ONE YOU CAN SEE, YOU RAN THE WHOLE FILE.
-- A SQL editor displays the result of the LAST statement, and this is it — so
-- the 61 checks that answer "does the database match the files" ran and were
-- thrown away, and what is on screen instead is the last ten HTTP responses,
-- which answer a different question entirely.
--
-- That 60 is a digit rather than a word because it is COUNTED by a test. It
-- read fifty-seven for two releases while the summary held more, which is this
-- file describing itself wrongly in the one paragraph a person reads when they
-- are already lost.
--
-- Go back to the top and run the summary block ALONE: select from
-- `select check_name, actual, expected, ...` down to
-- `) as t(check_name, actual, expected);`, and press Run. Read the `ok` column.
--
-- The summary is first rather than last on purpose and cannot simply be moved
-- here: the listings between us can raise on a database missing an object, and
-- anything that raises takes every statement after it. First, it always runs.
-- The cost of that ordering is this note.
-- ═══════════════════════════════════════════════════════════════════════════
