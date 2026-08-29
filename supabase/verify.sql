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
-- Each row is a fact 001-004 asserts, read back out of the catalogs. `expected`
-- is what the files say; `actual` is what the database holds.
-- coalesce, because a check whose subquery finds nothing yields NULL and NULL
-- is not false — a missing table would print a blank `ok` and read as fine.
select check_name, actual, expected, coalesce(actual = expected, false) as ok
from (values
  ('tables and the view exist',
   (select count(*)::text from information_schema.tables
     where table_schema = 'public'
       and table_name in ('trades','eugenia_turns','eugenia_notes','eugenia_trades')),
   '4'),

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
  ('three triggers on trades',
   (select count(*)::text from pg_trigger
     where tgrelid = to_regclass('public.trades') and not tgisinternal),
   '3'),

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

  ('three cron jobs, all active',
   (select count(*)::text from cron.job where active),
   '3'),

  -- THE SECRET NAME, WHICH USED TO BE READ BY EYE AND IS THE FAILURE THIS
  -- SYSTEM HAS HAD TWICE. Postgres compares the Vault name case-sensitively, so
  -- the upper-case spelling matches nothing, yields null and makes the caller
  -- give up without raising anything. Both calling jobs must name the lower-case
  -- one; the third is a DELETE and presents no secret.
  ('both calling jobs read the lower-case Vault secret',
   (select count(*)::text from cron.job
     where command like '%''doji_cron_secret''%'),
   '2'),
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

-- ─── Scheduled jobs ────────────────────────────────────────────────────────
-- Against 004_cron.sql: doji-mcp-sync every two minutes, doji-eugenia hourly,
-- purge-cron-history nightly — three, all active. The summary block checks the
-- Vault secret name in the two calling jobs; this is where the schedules and
-- the timeouts are read.
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
