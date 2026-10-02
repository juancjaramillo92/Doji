-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — the eye pass, for when verify.sql says false
-- ───────────────────────────────────────────────────────────────────────────
-- verify.sql asks whether the database matches the files; this answers what it
-- actually holds — TWELVE listings that say which object, which grant, which
-- schedule. Separate because a SQL editor shows only the last statement's
-- result: select one listing and run it. A read here may raise on a database
-- missing an extension or table, which verify.sql has already named.
--
-- Nothing here writes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Tables and views ──────────────────────────────────────────────────────
-- Everything present. Not enumerated: anything here verify.sql did not name is
-- something no file in this repository knows about.
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;

-- ─── Columns ───────────────────────────────────────────────────────────────
-- `pnl` must read is_generated = ALWAYS.
select table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default, is_generated
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- ─── Constraints ───────────────────────────────────────────────────────────
-- The vocabularies no client can bypass. trades_setup_check is the setups'
-- third home, which agree.test.mjs cannot read.
select rel.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and con.contype in ('c', 'p', 'f')
order by rel.relname, con.conname;

-- ─── Indexes ───────────────────────────────────────────────────────────────
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- ─── Row level security ────────────────────────────────────────────────────
-- Every table must show rls_enabled. trades has one policy, the card's three
-- tables a select policy each, and everything else none.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       coalesce(p.polname, '(no policy — correct for eugenia_*)') as policy,
       case when p.polname is null then null else pg_get_expr(p.polqual, p.polrelid) end as using_clause
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- ─── Grants on Eugenia's view ──────────────────────────────────────────────
-- Expect one row: service_role, SELECT. The view is auto-updatable.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'eugenia_trades'
order by grantee, privilege_type;

-- ─── Triggers ──────────────────────────────────────────────────────────────
-- verify.sql names the five on trades. Both of Gladys's must call
-- trades_telegram, and read their WHEN clauses against 002.
select event_object_table as table_name, trigger_name, action_timing, event_manipulation,
       pg_get_triggerdef(t.oid) as definition
from information_schema.triggers ist
join pg_trigger t on t.tgname = ist.trigger_name
where ist.trigger_schema = 'public'
order by event_object_table, trigger_name;

-- ─── Realtime ──────────────────────────────────────────────────────────────
-- `trades` must be listed.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

-- ─── How much of her memory is actually searchable by meaning ──────────────
-- A null embedding is no error: the row is simply never found by meaning.
-- `pending` should fall to zero under ?embed=1 and stay there. Climbing means
-- the key is unset or the vendor is refusing.
select 'eugenia_notes' as table, count(*) filter (where embedding is null) as pending,
       count(*) as rows
  from public.eugenia_notes
union all
select 'eugenia_turns', count(*) filter (where embedding is null), count(*)
  from public.eugenia_turns;

-- ─── Scheduled jobs ────────────────────────────────────────────────────────
-- Against 004_cron.sql: the schedules and the timeouts.
select jobid, jobname, schedule, active, command
from cron.job
order by jobname;

-- ─── Did the last calls actually arrive? ───────────────────────────────────
-- cron's `succeeded` only means the request was queued. This is the function's
-- own answer.
select status_code, content, created
from net._http_response
order by created desc
limit 10;

-- ─── Is anything wrong right now? ──────────────────────────────────────────
-- The three monitors in one grid, adding no definition of its own: 009's
-- failures come from dispatch_failures and 010's from pace_line. sync_health
-- shows the mark and its age, because judging it is healthLine's, in
-- TypeScript, where a scheduled writer and an occasional one are told apart.
-- A dispatch whose report is in flight is absent, as dispatch_failures has it.
select 'sync_health'::text as monitor,
       h.id                as subject,
       (case when h.last_ok is null then 'never marked'
             else 'last ok ' || to_char(h.last_ok at time zone 'America/New_York',
                                        'Dy DD Mon HH24:MI')
                  || ' (' || date_trunc('minute', now() - h.last_ok)::text || ' ago)'
        end)::text         as state,
       /* Dated against the mark rather than the clock, since last_error
          outlives a later success. After the mark means the writer's last
          act was to fail. */
       (coalesce(h.last_error || ' at '
                 || to_char(h.last_error_at at time zone 'America/New_York',
                            'Dy DD Mon HH24:MI')
                 || case
                      when h.last_ok is null then ''
                      when h.last_error_at > h.last_ok then ' — AFTER the mark'
                      else ' ('
                           || date_trunc('minute', h.last_ok - h.last_error_at)::text
                           || ' before the mark)'
                    end,
                 'no failure recorded'))::text as detail
  from public.sync_health h
union all
select 'dispatch', f.job, f.why,
       'request ' || f.id || ', sent '
         || to_char(f.at at time zone 'America/New_York', 'Dy DD Mon HH24:MI')
  from public.dispatch_failures() f
union all
select 'dispatch', '(unsettled rows)', count(*)::text,
       coalesce('oldest ' || to_char((min(d.at)) at time zone 'America/New_York',
                                     'Dy DD Mon HH24:MI'),
                'none outstanding')
  from public.dispatch d
 where not d.settled
union all
select 'pace', '(the briefing)', coalesce(public.pace_line(), 'clear'),
       'read against the paid worker ceiling 010 states'
 order by monitor, subject;
