-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 009: what pg_net sent, and what came back
-- ───────────────────────────────────────────────────────────────────────────
-- A worker refused before it starts (a 546) runs no line of the function: no
-- eugenia_runs row, no apology, no heartbeat. The only witness is a row in
-- net._http_response, pruned within hours. So the watcher lives in Postgres and
-- posts to Telegram itself — a monitor that reported through the function it
-- watches would share its failure.
--
-- Run after 008. Safe to re-run in full.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The ledger ────────────────────────────────────────────────────────────
-- The request id net.http_post returns is the only link to the response row,
-- which carries no url. Every dispatch records it here.
create table if not exists public.dispatch (
  -- pg_net's request id, shared with the response row.
  id      bigint primary key,

  -- Named for the job, not the url: several post to one function and differ
  -- by a flag. agree.test.mjs holds this list against the dispatch sites.
  job     text not null,
  constraint dispatch_job_check check (job in (
    'poller', 'eugenia', 'eugenia-spine', 'eugenia-price',
    'trade-event', 'gladys')),

  at      timestamptz not null default now(),

  -- Judged and dealt with, good or bad, so a failure is reported once.
  settled boolean not null default false,

  -- The request id of the report that named this row. A failure settles only
  -- once that report is known to have arrived: pg_net is asynchronous, and a
  -- report lost on the wire would otherwise end the outage's only mention.
  reported_by bigint
);

-- For a database that had the table before the column.
alter table public.dispatch add column if not exists reported_by bigint;

-- The two reads: unsettled oldest-first, partial so it scans only what is
-- pending, and a per-job count over the hour.
create index if not exists dispatch_unsettled
  on public.dispatch (at) where not settled;
create index if not exists dispatch_job_at
  on public.dispatch (job, at desc);

alter table public.dispatch enable row level security;

-- ─── What counts as a failure ──────────────────────────────────────────────
-- One definition, asked by dispatch_failures and by the repeat gate. `not
-- exists` over successes, because a request pg_net never answered has no row
-- to match a failure against. A null timed_out is an unknown outcome, and an
-- unknown outcome is not a success.
create or replace function public.dispatch_bad(req bigint)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from net._http_response r
     where r.id = req
       and not coalesce(r.timed_out, true)
       and r.error_msg is null
       and r.status_code between 200 and 299);
$$;

-- Takes its clock, so its verdict can be driven from planted rows. Both ends of
-- the window are needed: under fifteen minutes a request may still be in
-- flight, and past three hours pg_net has pruned the response, so every row
-- would read "no answer" on the day the watcher itself had stopped.
create or replace function public.dispatch_failures(now_ timestamptz default now())
returns table (id bigint, job text, at timestamptz, why text)
language sql
stable
as $$
  select d.id, d.job, d.at,
         case
           when r.id is null            then 'no answer'
           when r.error_msg is not null then left(r.error_msg, 120)
           when r.timed_out             then 'timed out'
           else 'HTTP ' || r.status_code
         end
    from public.dispatch d
    left join net._http_response r on r.id = d.id
   where not d.settled
     -- A report naming this row is in flight.
     and d.reported_by is null
     and d.at <= now_ - interval '15 minutes'
     and d.at >  now_ - interval '3 hours'
     and public.dispatch_bad(d.id)
   order by d.at;
$$;

-- ─── Which failures are worth a message ────────────────────────────────────
-- A job that comes round on its own is evidence only in quantity: one lost poll
-- heals two minutes later, and reporting each would teach him to ignore the
-- watcher. A one-shot job — the hourly one, the trade event, Gladys — is
-- evidence alone, since what it carried does not come again. Three in an hour
-- rather than three in a row, because consecutiveness cannot be read off rows
-- pg_net prunes.
create or replace function public.dispatch_repeats(job text)
returns boolean
language sql
immutable
as $$
  select job in ('poller', 'eugenia-spine', 'eugenia-price');
$$;

-- ─── The report, and the settle ────────────────────────────────────────────
-- One message per sweep: five losses in ten minutes are one outage. Everything
-- judged is settled, reported or not, or it is said again every ten minutes.
-- The Vault names are lower case here and upper case as Edge secrets, compared
-- case-sensitively; verify.sql asks whether both resolve.
create or replace function public.dispatch_watch(now_ timestamptz default now())
returns int
language plpgsql
as $$
declare
  told  text;
  n     int;
  token text;
  chat  text;
  req   bigint;
begin
  /* ── First, what happened to the last report ──────────────────────────────
     A report that arrived settles its rows; one that failed releases them to
     be said again on this sweep. */
  update public.dispatch d set settled = true
   where not d.settled and d.reported_by is not null
     and exists (select 1 from net._http_response r
                  where r.id = d.reported_by
                    and r.status_code between 200 and 299);

  update public.dispatch d set reported_by = null
   where not d.settled and d.reported_by is not null
     and exists (select 1 from net._http_response r
                  where r.id = d.reported_by
                    and (r.timed_out or r.status_code is null
                         or r.status_code not between 200 and 299));

  -- One set of rows for the message, the mark and the settle.
  create temporary table if not exists _said (id bigint, line text) on commit drop;
  delete from _said;

  insert into _said
  select f.id, format('· %s at %s — %s', f.job,
                      to_char(f.at at time zone 'America/New_York', 'HH24:MI'), f.why)
    from public.dispatch_failures(now_) f
   where not public.dispatch_repeats(f.job)
      /* Counts rows, settled or not, and shares only the predicate with
         dispatch_failures: the step below settles a suppressed failure on
         purpose, so a count of unsettled rows could never reach three. The
         fifteen-minute bound keeps an in-flight poll out of the count. */
      or (select count(*) from public.dispatch d
           where d.job = f.job
             and d.at >  now_ - interval '1 hour'
             and d.at <= now_ - interval '15 minutes'
             and public.dispatch_bad(d.id)) >= 3;

  told := (select string_agg(line, E'\n' order by id) from _said);
  n    := (select count(*) from _said);

  if n > 0 then
    token := (select decrypted_secret from vault.decrypted_secrets
               where name = 'eugenia_bot_token');
    chat  := (select decrypted_secret from vault.decrypted_secrets
               where name = 'telegram_chat_id');

    if token is not null and chat is not null then
      req := net.http_post(
        url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
                     'chat_id', chat,
                     'text', 'Something scheduled never ran, jefe.' || E'\n\n' || told),
        timeout_milliseconds := 20000);

      -- Marked, not settled: the next sweep learns whether it arrived.
      update public.dispatch set reported_by = req
       where id in (select id from _said);
    else
      -- Left unsettled, so repairing the name still delivers the outage.
      raise warning 'dispatch_watch: eugenia_bot_token or telegram_chat_id is not in Vault';
    end if;
  end if;

  /* ── Then everything that needs no message ────────────────────────────────
     A 2xx, and a failure suppressed as one lost poll — the threshold counts
     rows, so settling it cannot hide the third in an hour. */
  update public.dispatch set settled = true
   where not settled and reported_by is null
     and at <= now_ - interval '15 minutes'
     and id not in (select id from _said);

  /* ── And giving up is explicit ────────────────────────────────────────────
     Past three hours pg_net has pruned the response and nothing can be
     adjudicated; a row that can never resolve would be reported forever. */
  update public.dispatch set settled = true
   where not settled and at <= now_ - interval '3 hours';

  return coalesce(n, 0);
end;
$$;

-- anon and authenticated by name, for 007's reason.
revoke execute on function public.dispatch_bad(bigint)            from public, anon, authenticated;
revoke execute on function public.dispatch_failures(timestamptz) from public, anon, authenticated;
revoke execute on function public.dispatch_repeats(text)         from public, anon, authenticated;
revoke execute on function public.dispatch_watch(timestamptz)    from public, anon, authenticated;
