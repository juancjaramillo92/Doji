-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — the eye pass, for when verify.sql says false
-- ───────────────────────────────────────────────────────────────────────────
-- verify.sql answers one question in one grid: does the live database match the
-- numbered files. This is the other half — ten listings that say WHAT the
-- database actually holds, for the moment a check comes back false and the next
-- question is which object, which grant, which schedule.
--
-- THEY LIVE HERE RATHER THAN BELOW THE SUMMARY, AND THAT IS THE WHOLE REASON
-- THIS FILE EXISTS. A SQL editor shows the result of the LAST statement only, so
-- ten listings under the summary meant running verify.sql top to bottom
-- displayed the last ten HTTP responses and threw away every check above them.
-- The summary could not simply be moved to the end either: three of the reads
-- below can RAISE on a database missing the thing they read — `cron.job`
-- without pg_cron, `net._http_response` without pg_net, a public table that was
-- never created — and anything that raises takes every statement after it, so
-- the summary would vanish on exactly the databases it is for. Two files is
-- what makes both statements last in their own.
--
-- So a raise here is not a fault: it is this file reporting an extension or a
-- table that is absent, and the summary next door already named it.
--
-- Nothing here writes.
-- ═══════════════════════════════════════════════════════════════════════════
-- ─── Tables and views ──────────────────────────────────────────────────────
-- Every object the numbered files declare, and nothing else. verify.sql's
-- summary holds the list itself, asserted against those files — this is the eye
-- pass beside it, so anything appearing here that the summary did not name is
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
-- purge-cron-history nightly — five, all active. verify.sql's summary checks the
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
