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
-- is the check. Read each result against 001–005. Ten seconds, and it is worth
-- doing after any manual change and before believing anything in this
-- repository about the database.
--
-- A CI job cannot do this instead. 002, 003 and 005 need pg_net, vault and
-- pg_cron, none of which a plain Postgres container has — so a green pipeline
-- would prove only that 001 parses, which is the least of what can drift.
-- ═══════════════════════════════════════════════════════════════════════════

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
-- read of the journal a write path — and anon or authenticated appearing at all
-- would expose every user's trades to the publishable key.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'eugenia_trades'
order by grantee, privilege_type;

-- ─── Triggers ──────────────────────────────────────────────────────────────
-- Expect two on trades: trades_touch_updated_at (BEFORE UPDATE) and
-- trades_telegram_on_open (AFTER INSERT). Read the WHEN clause on the second
-- one: `new.entry_time > now() - interval '01:00:00'` is the guard that stops a
-- restore from backup messaging the trader once per row in the file.
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
-- Against 005_cron.sql: doji-mcp-sync every two minutes, doji-eugenia hourly,
-- both active. CHECK THE SECRET NAME IN THE COMMAND TEXT — it must be the
-- lower-case doji_cron_secret. Postgres compares it case-sensitively, and the
-- upper-case spelling matches nothing in Vault and fails silently.
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
