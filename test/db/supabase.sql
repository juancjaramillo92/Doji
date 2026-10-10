-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — what Supabase provides, as far as schema.sql reaches it
-- ───────────────────────────────────────────────────────────────────────────
-- Stand-ins, applied before schema.sql on a throwaway database. Each keeps the
-- name, signature and columns the file uses, and nothing behind them: pg_net
-- records the request instead of sending it, pg_cron stores the job instead of
-- running it, Vault is a table of plain values. Roles are cluster-wide, so
-- they tolerate a second database on the same server.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

-- The three API roles hold everything in public until schema.sql revokes it,
-- which is the default the file's revokes are written against.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create publication supabase_realtime;

-- The caller is whoever `request.jwt.claim.sub` names, as PostgREST sets it.
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);

-- Every request lands in net.sent and is never answered; a test plants the
-- response row it wants judged.
create schema net;
create table net._http_response (
  id           bigint primary key,
  status_code  int,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz not null default now()
);
create sequence net.request_id;
create table net.sent (id bigint primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                              headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare
  req bigint := nextval('net.request_id');
begin
  insert into net.sent values (req, url, headers, body);
  return req;
end $$;

create schema cron;
create table cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null,
  active   boolean not null default true
);
create table cron.job_run_details (
  runid          bigserial primary key,
  jobid          bigint,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);
-- Scheduling a name again replaces the job, as pg_cron does.
create function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
-- By name, as upgrade.sql calls it; pg_cron refuses a name it does not hold.
create function cron.unschedule(job_name text)
returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;
