-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 009: what pg_net sent, and what came back
-- ───────────────────────────────────────────────────────────────────────────
-- RUN AFTER 008. Every statement is `if not exists` or `or replace`, so this
-- file is safe to re-run in full.
--
-- THE FAILURE THIS EXISTS FOR HAS NO ROW ANYWHERE ELSE. A Sunday briefing was
-- dispatched at 17:00, the platform answered 546 WORKER_RESOURCE_LIMIT, and the
-- function never executed a line — so `ask()` wrote nothing, `postScheduled`'s
-- catch never ran, no apology was sent, and `eugenia_runs` recorded a system
-- with nothing to do. The only trace was a row in `net._http_response`, which
-- pg_net prunes within hours and nobody reads. It was found by hand, two hours
-- later, because a person noticed a message had not arrived.
--
-- 008 CATCHES THE OPPOSITE HALF AND CANNOT CATCH THIS ONE. `heartbeat()` is
-- written by a function that RAN; a call refused before the worker existed
-- marks nothing, and staleness only sees it after six hours of a writer that
-- is scheduled every two minutes. Nothing watches the one-shot paths at all.
--
-- SO THE WATCHER LIVES IN POSTGRES, AND THAT IS THE POINT RATHER THAN A
-- CONVENIENCE. The thing that failed is the Edge Function; a monitor that
-- reports a refused worker by asking that same function to send a message
-- shares the failure mode of its subject, which is what 008 says makes a
-- monitor worse than none. This one posts to Telegram directly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The ledger ────────────────────────────────────────────────────────────
-- `net.http_post` RETURNS the request id and all six callers threw it away.
-- That id is the only link between "we sent this" and the row that lands in
-- `net._http_response`, which carries no url and so cannot say what a failed
-- request was for. Capturing it is the whole of the mechanism.
create table if not exists public.dispatch (
  -- pg_net's own request id. Not generated here: this row and the response row
  -- are two halves of one fact and must share a key.
  id      bigint primary key,

  -- The six sites, named for the job rather than the url, because two of them
  -- post to the same function and differ only by a query flag. Constrained so
  -- a seventh caller has to be added here as well as there, and agree.test.mjs
  -- holds this list against the dispatch sites themselves.
  job     text not null,
  constraint dispatch_job_check check (job in (
    'poller', 'eugenia', 'eugenia-spine', 'eugenia-price',
    'trade-event', 'gladys')),

  at      timestamptz not null default now(),

  -- Judged and dealt with. Set for good runs and bad alike, so the table does
  -- not grow an unbounded tail of rows nobody will ever look at again, and so
  -- a failure is reported exactly once.
  settled boolean not null default false
);

-- The only read is "unsettled, oldest first", and the only other is a count
-- per job over the last hour. A partial index on the first keeps the watcher's
-- scan proportional to what is actually pending rather than to the archive.
create index if not exists dispatch_unsettled
  on public.dispatch (at) where not settled;
create index if not exists dispatch_job_at
  on public.dispatch (job, at desc);

alter table public.dispatch enable row level security;

-- ─── What counts as a failure ──────────────────────────────────────────────
-- TWO SHAPES, AND THE SECOND IS THE ONE NOBODY THINKS OF. A response that came
-- back wrong is the obvious half. A request that never got a response at all
-- is pg_net having dropped it — no status code to read, and invisible to any
-- check that joins the two tables and looks at the join.
--
-- IT TAKES ITS CLOCK AS AN ARGUMENT, for the reason `healthLine` and
-- `moveWorth` do: a monitor whose verdict cannot be driven from a test against
-- planted rows is a monitor nobody has ever seen fire.
--
-- THE WINDOW HAS BOTH ENDS, AND THE FAR ONE IS A FALSE-ALARM GUARD. pg_net
-- prunes `net._http_response` within hours, so a dispatch older than that has
-- no response row whether it succeeded or not — and judged by the rule above
-- every one of them reads as "no answer". The watcher runs every ten minutes
-- and judges at fifteen, so nothing reaches three hours in the ordinary case;
-- the bound only matters on the day the watcher itself stopped, which is
-- exactly the day it must not come back with a hundred invented failures.
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
     and d.at <= now_ - interval '15 minutes'
     and d.at >  now_ - interval '3 hours'
     and (r.id is null
          or r.timed_out
          or r.error_msg is not null
          or r.status_code not between 200 and 299)
   order by d.at;
$$;

-- ─── Which failures are worth a message ────────────────────────────────────
-- A MONITOR THAT IS WRONG ON AN ORDINARY DAY GETS IGNORED, and here the
-- ordinary day is a single lost poll. The poller runs seven hundred and twenty
-- times a day and the next one is two minutes away, so one refused worker
-- costs nothing and reporting it would put three or four messages a day in
-- front of him about a sync that healed itself before he read them.
--
-- THE SPLIT IS THE SAME ONE `healthLine` ALREADY MAKES, arriving for a second
-- reason: a job that comes round again on its own is evidence only in
-- QUANTITY, and a job that does not is evidence on its own. The hourly job
-- carries the briefing and the nightly pass — a specific hour, gone when it is
-- gone. The trade event has no retry anywhere in this system: it fires on a
-- transition, once, and a refused worker loses an R-11 warning for good. So
-- does Gladys's, which is ONE name for two triggers: the form opened on a fill
-- and the redraw after a tap both fire `trades_telegram()` and both post to the
-- same function, so they are one job and a second name would be a distinction
-- this table cannot act on.
--
-- Three in an hour rather than three in a row: `net._http_response` is the only
-- witness and consecutiveness cannot be read off it once a row is pruned.
create or replace function public.dispatch_repeats(job text)
returns boolean
language sql
immutable
as $$
  select job in ('poller', 'eugenia-spine', 'eugenia-price');
$$;

-- ─── The report, and the settle ────────────────────────────────────────────
-- ONE MESSAGE PER SWEEP rather than one per failure: five losses in the same
-- ten minutes are one outage and reading them as five is how a monitor teaches
-- someone to swipe it away.
--
-- EVERYTHING JUDGED IS SETTLED, including what is not reported and what has no
-- answer to judge. Left unsettled a reported failure is reported again every
-- ten minutes for three hours, and an unjudgeable row is scanned forever.
--
-- IT POSTS TO TELEGRAM ITSELF. `eugenia_bot_token` and `telegram_chat_id` are
-- the third and fourth Vault names that are one value with an Edge secret —
-- lower case here, upper there, and Postgres compares them case-sensitively.
-- verify.sql asks whether both resolve, which is the check CLAUDE.md requires
-- before a name like this is added.
create or replace function public.dispatch_watch(now_ timestamptz default now())
returns int
language plpgsql
as $$
declare
  told  text;
  n     int;
  token text;
  chat  text;
begin
  -- Named once and read twice below, so the report and the settle cannot
  -- disagree about which rows they are about.
  create temporary table if not exists _judged
    (id bigint, job text, at timestamptz, why text) on commit drop;
  delete from _judged;
  insert into _judged select * from public.dispatch_failures(now_);

  select string_agg(format('· %s at %s — %s', f.job,
                           to_char(f.at at time zone 'America/New_York', 'HH24:MI'),
                           f.why), E'\n' order by f.at),
         count(*)
    into told, n
    from _judged f
   where not public.dispatch_repeats(f.job)
      or (select count(*) from public.dispatch d
           left join net._http_response r on r.id = d.id
          where d.job = f.job
            and d.at > now_ - interval '1 hour'
            and (r.id is null or r.status_code not between 200 and 299)) >= 3;

  if n > 0 then
    select decrypted_secret into token from vault.decrypted_secrets
     where name = 'eugenia_bot_token';
    select decrypted_secret into chat  from vault.decrypted_secrets
     where name = 'telegram_chat_id';

    -- A missing secret must not stop the settle below: unsettled rows would be
    -- re-judged every ten minutes forever, and the repair for a missing Vault
    -- name is not a table that grows while nobody is told either way.
    if token is not null and chat is not null then
      perform net.http_post(
        url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
                     'chat_id', chat,
                     'text', 'Something scheduled never ran, jefe.' || E'\n\n' || told),
        timeout_milliseconds := 20000);
    else
      raise warning 'dispatch_watch: eugenia_bot_token or telegram_chat_id is not in Vault';
    end if;
  end if;

  -- Every row old enough to judge, not only the failures: a run that answered
  -- 200 is finished with, and one too old to have a response left is a fact
  -- nobody can recover.
  update public.dispatch set settled = true
   where not settled and at <= now_ - interval '15 minutes';

  return coalesce(n, 0);
end;
$$;

-- Reachable by the publishable key otherwise, from the default privileges
-- Supabase grants on the public schema — `revoke ... from public` alone does
-- not take those, which is the mistake 007 exists to have corrected once.
revoke execute on function public.dispatch_failures(timestamptz) from public, anon, authenticated;
revoke execute on function public.dispatch_repeats(text)         from public, anon, authenticated;
revoke execute on function public.dispatch_watch(timestamptz)    from public, anon, authenticated;
