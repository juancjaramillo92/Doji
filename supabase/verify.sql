-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — does the live database still match these files?
-- ───────────────────────────────────────────────────────────────────────────
-- The schema is applied by hand on purpose, which makes schema.sql a claim
-- about the database. This tests the claim. It writes nothing: run the
-- whole file after any manual change and read the `ok` column — all 86 checks.
--
-- One statement, because a SQL editor shows only the last statement's result.
-- The listings that say which object, grant or schedule are diagnose.sql.
-- CI runs it against a fresh build behind stand-ins (test/db), which proves
-- this file and schema.sql agree; only a run here proves the live database does.
--
-- A row may come back false; it must never raise, or every row stops with it.
-- So functions are asked by name or oid, never by written signature, and a
-- table that may be absent is read through query_to_xml behind to_regclass —
-- a query passed as a string is not parsed until it runs. coalesce, because a
-- check that finds nothing yields NULL, and NULL is not false.
-- ═══════════════════════════════════════════════════════════════════════════

select check_name, actual, expected, coalesce(actual = expected, false) as ok
from (values
  ('tables and the view exist',
   (select count(*)::text from information_schema.tables
     where table_schema = 'public'
       and table_name in ('trades','eugenia_turns','eugenia_notes','eugenia_trades',
                          'eugenia_channels')),
   '5'),

  -- Apart from the row above, and counted, so a table missing is a number short.
  ('her sense tables exist',
   (select count(*)::text from information_schema.tables
     where table_schema = 'public'
       and table_name in ('eugenia_runs','eugenia_calendar','eugenia_thesis',
                          'eugenia_loops','eugenia_feedback','eugenia_price')),
   '6'),

  -- The singletons are PATCHed by primary key, so a missing seed row is a 200
  -- that lands nowhere: every rewrite dropped, silently.
  ('the thesis row is seeded',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.eugenia_thesis where id = ''current''',
             false, true, '')))[1]::text
     where to_regclass('public.eugenia_thesis') is not null),
   '1'),

  ('the price mark row is seeded',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.eugenia_price where id = ''current''',
             false, true, '')))[1]::text
     where to_regclass('public.eugenia_price') is not null),
   '1'),

  -- Without it `<%` does not exist and the search cannot be created.
  ('pg_trgm is installed',
   (select count(*)::text from pg_extension where extname = 'pg_trgm'),
   '1'),

  ('pgvector is installed',
   (select count(*)::text from pg_extension where extname = 'vector'),
   '1'),
  ('both memories have an embedding column',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and column_name = 'embedding'
       and table_name in ('eugenia_notes','eugenia_turns')),
   '2'),

  -- A new function carries EXECUTE to PUBLIC until it is revoked.
  ('the search is executable by service_role alone',
   (select count(*)::text from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'eugenia_search'
       and grantee = 'service_role' and privilege_type = 'EXECUTE'),
   '1'),

  /* Every function these files create. Extension-owned functions (pg_depend
     'e') are excluded — pgvector and pg_trgm install over a hundred, meant to
     be callable — and so are trigger functions, which PostgREST cannot call.
     has_function_privilege answers for the role however the grant arrived,
     by name or through PUBLIC. */
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

  /* ─── The journal/broker boundary ────────────────────────────────────────
     Three rows, because they fail differently: no broker column writable,
     the app's five still writable, and no insert or delete at all. */
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

  ('the publishable key can neither insert nor delete a trade',
   (select count(*)::text from unnest(array['INSERT','DELETE']) priv
     where has_table_privilege('anon', 'public.trades', priv)
        or has_table_privilege('authenticated', 'public.trades', priv)),
   '0'),

  -- Without a policy the card reads an empty list and hides itself.
  ('the app can read the three tables its card draws',
   (select count(*)::text from pg_policies
     where schemaname = 'public'
       and tablename in ('eugenia_calendar','eugenia_thesis','eugenia_loops')
       and cmd = 'SELECT'),
   '3'),

  -- Expected zero: catches a policy added to the wrong table.
  ('her notes and turns stay closed to the app',
   (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename in ('eugenia_notes','eugenia_turns')),
   '0'),

  -- pnl states the email-beats-computed rule in the schema.
  ('pnl is a generated column',
   (select is_generated from information_schema.columns
     where table_schema = 'public' and table_name = 'trades' and column_name = 'pnl'),
   'ALWAYS'),

  -- PostgREST drops an unknown key from a merge-duplicates payload, so a
  -- missing column loses every size silently.
  ('trades has its size_oz column',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'trades' and column_name = 'size_oz'),
   'numeric'),

  ('eugenia_trades exposes size_oz',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_trades' and column_name = 'size_oz'),
   '1'),

  -- The view only appends when re-applied, so each later column is asked of
  -- the view as well as the table. net_pnl is what lets her total be honest
  -- where pnl fell back to the folded figure.
  ('eugenia_trades exposes net_pnl',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_trades' and column_name = 'net_pnl'),
   '1'),

  -- §8 tells her each is absent and why.
  ('eugenia_trades hides user_id, balance, commission, computed_pnl',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_trades'
       and column_name in ('user_id','balance','commission','computed_pnl')),
   '0'),

  -- Missing, the plan PATCH is a 400 the poller swallows.
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

  -- Missing, R-04 reads unknown on every trade.
  ('trades has its best_price column',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'trades' and column_name = 'best_price'),
   'numeric'),
  ('eugenia_trades exposes best_price',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_trades' and column_name = 'best_price'),
   '1'),

  ('RLS on trades',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.trades')),
   'true'),
  ('one policy on trades',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.trades')),
   '1'),

  -- RLS with no policy denies the publishable key outright.
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

  -- agree.test.mjs reads schema.sql's insert; only the database knows the
  -- rows are there. A missing one renders at the bottom rung forever.
  ('all five channels are seeded',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.eugenia_channels',
             false, true, '')))[1]::text
     where to_regclass('public.eugenia_channels') is not null),
   '5'),

  -- Read through pg_options_to_table, so `security_invoker = on` is not drift.
  ('eugenia_trades runs with the caller''s rights',
   (select coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'false')::boolean::text
      from pg_class c where c.oid = to_regclass('public.eugenia_trades')),
   'true'),

  -- An invoker's-rights view does not borrow its owner's access.
  ('service_role can select trades directly',
   (select count(*)::text from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'trades'
       and grantee = 'service_role' and privilege_type = 'SELECT'),
   '1'),

  -- Without it standing instructions are evicted by ordinary observations.
  ('eugenia_notes has its kind column',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_notes' and column_name = 'kind'),
   'text'),

  ('eugenia_notes accepts a commitment',
   (select (pg_get_constraintdef(oid) like '%commitment%')::text
      from pg_constraint where conname = 'eugenia_notes_kind_check'),
   'true'),

  -- Without it the read's filter is a 400 and she loses her whole memory.
  ('eugenia_notes has its superseded_by column',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_notes'
       and column_name = 'superseded_by'),
   'bigint'),

  -- The index must carry the read's filter to serve it.
  ('the notes index is partial on live notes',
   (select count(*)::text from pg_indexes
     where schemaname = 'public' and indexname = 'eugenia_notes_kind_id_desc'
       and indexdef ilike '%where (superseded_by IS NULL)%'),
   '1'),

  -- By arity: '3' is right, '2' is the old search without the query vector,
  -- '2,3' an overload of the two, NULL no function. A count of 1 could not
  -- part them.
  ('eugenia_search exists, and takes the query vector',
   (select string_agg(p.pronargs::text, ',' order by p.pronargs)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'eugenia_search'),
   '3'),
  ('both search columns exist',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and column_name = 'search'
       and table_name in ('eugenia_notes', 'eugenia_turns')),
   '2'),

  -- Without them a match is a sequential scan that slows every week.
  ('both search indexes exist',
   (select count(*)::text from pg_indexes
     where schemaname = 'public'
       and indexname in ('eugenia_notes_search', 'eugenia_turns_search')),
   '2'),

  -- A single-table view is auto-updatable.
  ('eugenia_trades is select-only, service_role only',
   (select coalesce(string_agg(distinct grantee || ':' || privilege_type, ',' order by grantee || ':' || privilege_type), 'none')
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'eugenia_trades'
       and grantee in ('anon','authenticated','service_role')),
   'service_role:SELECT'),

  ('the Telegram trigger function calls doji-gladys',
   (select (prosrc like '%doji-gladys%')::text from pg_proc where proname = 'trades_telegram'),
   'true'),

  -- Named, not counted: five is still five when one is renamed and another
  -- added. agree.test.mjs reads this list against the numbered SQL.
  ('exactly the five triggers on trades',
   (select string_agg(tgname, ',' order by tgname) from pg_trigger
     where tgrelid = to_regclass('public.trades') and not tgisinternal),
   'trades_eugenia_closed,trades_eugenia_opened,trades_telegram_on_answer,' ||
   'trades_telegram_on_open,trades_touch_updated_at'),

  -- Without it the redraw trigger's WHEN never passes, silently.
  ('trades carries Gladys''s message id',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'trades' and column_name = 'tg_message_id'),
   'bigint'),

  -- Missing, a fill waits for the five-minute refresh.
  ('trades is published to realtime',
   (select count(*)::text from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'trades'),
   '1'),

  -- agree.test.mjs holds this count against schema.sql. Through query_to_xml,
  -- so a database without pg_cron answers false rather than raising.
  ('seven cron jobs, all active',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from cron.job where active',
             false, true, '')))[1]::text
     where to_regclass('cron.job') is not null),
   '7'),

  -- Vault names compare case-sensitively; the upper-case spelling yields null.
  -- The other three jobs call nothing outside the database.
  ('all four calling jobs read the lower-case Vault secret',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from cron.job where command like ''%''''doji_cron_secret''''%''',
             false, true, '')))[1]::text
     where to_regclass('cron.job') is not null),
   '4'),

  -- The two callers that are trigger functions rather than jobs.
  ('the Telegram trigger function reads the lower-case Vault secret',
   (select (prosrc like '%''doji_cron_secret''%')::text
      from pg_proc where proname = 'trades_telegram'),
   'true'),

  ('the event-spine trigger function reads the lower-case Vault secret',
   (select (prosrc like '%''doji_cron_secret''%')::text
      from pg_proc where proname = 'trades_eugenia_on_event'),
   'true'),

  -- The setups' third home; agree.test.mjs cannot see this one.
  ('both setups are accepted by the constraint',
   (select (pg_get_constraintdef(oid) like '%Break & Retest%'
        and pg_get_constraintdef(oid) like '%Support & Resistance%')::text
      from pg_constraint where conname = 'trades_setup_check'),
   'true'),

  -- ─── Her meters' columns, and her other tables ───────────────────────────
  -- recordRun posts every key in one object, so a missing column refuses the
  -- whole row and the meter goes quiet for every caller.
  ('eugenia_runs counts what the cache cost to fill',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_runs'
       and column_name in ('wrote_1h','wrote_5m')),
   '2'),
  ('eugenia_runs records which model ran',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_runs'
       and column_name = 'model'),
   '1'),
  ('eugenia_runs counts the fetches beside the searches',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_runs'
       and column_name = 'fetches'),
   '1'),

  -- Which of two disagreeing rows is the later one.
  ('the calendar records when it was last written',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_calendar'
       and column_name = 'updated_at'),
   '1'),
  ('and a trigger moves it',
   (select count(*)::text from pg_trigger
     where tgrelid = to_regclass('public.eugenia_calendar')
       and tgname = 'eugenia_calendar_touch_updated_at' and not tgisinternal),
   '1'),

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

  -- The dispatch ledger. No policy on purpose.
  ('RLS on dispatch',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.dispatch')),
   'true'),

  -- Without it R-14 is unknown on every trade.
  ('RLS on calendar_weeks',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.calendar_weeks')),
   'true'),
  ('Forex Factory''s tables are gone',
   (select (to_regclass('public.ff_calendar') is null
        and to_regclass('public.ff_weeks') is null)::text),
   'true'),

  -- Without it R-19 is unknown on every trade.
  ('RLS on trade_stops',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.trade_stops')),
   'true'),

  -- ─── The one table holding a live credential ────────────────────────────
  ('RLS on tradingview_auth',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.tradingview_auth')),
   'true'),
  ('no policy on tradingview_auth',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.tradingview_auth')),
   '0'),

  -- Without it every renewal is a 400 and the sign-in lapses.
  ('tradingview_auth has its renewal lease',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'tradingview_auth'
       and column_name = 'refreshing_until'),
   '1'),

  -- Without either column every filing is refused and the
  -- calendar stops moving.
  ('eugenia_calendar has its TradingView id',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_calendar'
       and column_name = 'tv_id'),
   '1'),

  -- The old key by name. Present, one clash refuses a whole filing, every
  -- quarter hour.
  ('the calendar has no key by name',
   (select count(*)::text from pg_constraint
     where conname = 'eugenia_calendar_unique'),
   '0'),
  ('eugenia_calendar has its series ticker',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_calendar'
       and column_name = 'ticker'),
   '1'),
  -- Without it every filing is refused, and so is every read of the US releases.
  ('eugenia_calendar has its country',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'eugenia_calendar'
       and column_name = 'country'),
   '1'),
  ('neither public role holds a grant on tradingview_auth',
   (select (has_table_privilege('anon', to_regclass('public.tradingview_auth'), 'select')
         or has_table_privilege('authenticated', to_regclass('public.tradingview_auth'), 'select'))::text),
   'false'),

  -- The two Vault names the watchers post with. Misspelled, they yield null and
  -- the watcher falls silent for the same reason a healthy system is.
  ('the watcher can read eugenia_bot_token from Vault',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from vault.decrypted_secrets'
             || ' where name = ''eugenia_bot_token''',
             false, true, '')))[1]::text
     where to_regclass('vault.decrypted_secrets') is not null),
   '1'),
  ('the watcher can read telegram_chat_id from Vault',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from vault.decrypted_secrets'
             || ' where name = ''telegram_chat_id''',
             false, true, '')))[1]::text
     where to_regclass('vault.decrypted_secrets') is not null),
   '1'),

  ('RLS on eugenia_feedback',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_feedback')),
   'true'),
  ('RLS on eugenia_price',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.eugenia_price')),
   'true'),

  -- No policy: only secret-key writers and Eugenia.
  ('RLS on sync_health',
   (select relrowsecurity::text from pg_class where oid = to_regclass('public.sync_health')),
   'true'),
  ('no policy on sync_health',
   (select count(*)::text from pg_policy where polrelid = to_regclass('public.sync_health')),
   '0'),

  ('both sync writers are seeded',
   (select (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.sync_health',
             false, true, '')))[1]::text
     where to_regclass('public.sync_health') is not null),
   '2'),

  -- ─── The three the dashboard card reads, by name ───────────────────────
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

  -- ─── Every index, named ─────────────────────────────────────────────────
  -- A missing index is never an error, only a slower scan. agree.test.mjs
  -- builds the full list from the create index statements.
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

  ('every declared index exists',
   (select coalesce(string_agg(indexname, ',' order by indexname), 'none')
      from pg_indexes where schemaname = 'public' and indexname in (
        'dispatch_job_at','dispatch_unsettled',
        'eugenia_calendar_at','eugenia_calendar_ticker','eugenia_calendar_tv_id','eugenia_loops_open',
        'eugenia_notes_embedding','eugenia_notes_kind_id_desc','eugenia_notes_search',
        'eugenia_notes_trgm','eugenia_runs_at_desc','eugenia_runs_caller_at',
        'eugenia_turns_embedding','eugenia_turns_id_desc','eugenia_turns_search',
        'eugenia_turns_trgm','trades_user_open_day')),
   'dispatch_job_at,dispatch_unsettled,' ||
   'eugenia_calendar_at,eugenia_calendar_ticker,eugenia_calendar_tv_id,eugenia_loops_open,' ||
   'eugenia_notes_embedding,eugenia_notes_kind_id_desc,eugenia_notes_search,' ||
   'eugenia_notes_trgm,eugenia_runs_at_desc,eugenia_runs_caller_at,' ||
   'eugenia_turns_embedding,eugenia_turns_id_desc,eugenia_turns_search,' ||
   'eugenia_turns_trgm,trades_user_open_day'),

  -- A function is resolved when it is called, not when its caller is created:
  -- a watcher missing a helper fails only in cron's own pruned log, which is
  -- the failure the watchers exist to report.
  ('every declared function exists',
   (select coalesce(string_agg(distinct p.proname, ',' order by p.proname), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'dispatch_bad','dispatch_failures','dispatch_repeats','dispatch_watch',
       'eugenia_calendar_touch','eugenia_search','pace_line','pace_watch',
       'tell_him','trades_eugenia_on_event','trades_telegram','trades_touch')),
   'dispatch_bad,dispatch_failures,dispatch_repeats,dispatch_watch,' ||
   'eugenia_calendar_touch,eugenia_search,pace_line,pace_watch,' ||
   'tell_him,trades_eugenia_on_event,trades_telegram,trades_touch')
) as t(check_name, actual, expected);
