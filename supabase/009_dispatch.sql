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
  settled boolean not null default false,

  -- THE REQUEST ID OF THE MESSAGE THAT NAMED THIS ROW, and a failure is not
  -- settled until that message is known to have ARRIVED. pg_net is
  -- asynchronous, so dispatch_watch cannot learn synchronously whether its own
  -- report went out — and the first one it ever sent did not: the TLS handshake
  -- to Telegram consumed a whole 20-second budget and the connection never
  -- opened. Settling on SEND rather than on delivery means a real outage is
  -- reported once, into a dropped connection, and never mentioned again. That
  -- is the exact silence this table exists to end, reproduced inside the thing
  -- built to end it.
  reported_by bigint
);

-- The table is `if not exists`, so a database that already has it does not get
-- the column from the statement above. This file is one that will grow.
alter table public.dispatch add column if not exists reported_by bigint;

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
     -- A report naming this row is in flight. Saying it again on the next
     -- sweep would be the same outage arriving every ten minutes.
     and d.reported_by is null
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
  req   bigint;
begin
  /* ── FIRST, WHAT HAPPENED TO THE LAST REPORT ──────────────────────────────
     Nothing else may be decided until this is, because a row still waiting on
     a report is neither settled nor sayable. A message that ARRIVED finishes
     its rows; one that timed out, was refused, or never opened a connection
     releases them to be said again on this sweep. */
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

  -- Named once and read three times below, so the message, the mark and the
  -- settle cannot disagree about which rows they are about.
  create temporary table if not exists _said (id bigint, line text) on commit drop;
  delete from _said;

  insert into _said
  select f.id, format('· %s at %s — %s', f.job,
                      to_char(f.at at time zone 'America/New_York', 'HH24:MI'), f.why)
    from public.dispatch_failures(now_) f
   where not public.dispatch_repeats(f.job)
      /* COUNTED OUT OF dispatch_failures ITSELF, because this restated what a
         failed dispatch IS and the restatement was narrower. It tested only
         `no response row` or `a non-2xx status`, so a request that TIMED OUT —
         which has a row, a null status_code and `timed_out` set — counted as
         zero. The three repeating jobs are the poller, the spine and the price
         mark, and a refused or timed-out worker on the poller is the exact
         failure this table was built for: selected by dispatch_failures above,
         gated to silence by a count that could not see it.

         It also counted requests made SECONDS ago, where the outer query
         judges nothing under fifteen minutes old — so an in-flight poll read
         as a failure and pushed a healthy job toward the threshold. Both go
         away by asking the one function that decides this. The hour is the
         quantity window and is the only thing stated twice. */
      or (select count(*) from public.dispatch_failures(now_) g
           where g.job = f.job
             and g.at > now_ - interval '1 hour') >= 3;

  select string_agg(line, E'\n' order by id), count(*) into told, n from _said;

  if n > 0 then
    select decrypted_secret into token from vault.decrypted_secrets
     where name = 'eugenia_bot_token';
    select decrypted_secret into chat  from vault.decrypted_secrets
     where name = 'telegram_chat_id';

    if token is not null and chat is not null then
      req := net.http_post(
        url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
                     'chat_id', chat,
                     'text', 'Something scheduled never ran, jefe.' || E'\n\n' || told),
        timeout_milliseconds := 20000);

      /* MARKED, NOT SETTLED. The next sweep looks this id up and decides; until
         then these rows are out of the way without being finished with. */
      update public.dispatch set reported_by = req
       where id in (select id from _said);
    else
      -- Left unsettled deliberately: a missing Vault name is repaired, and the
      -- outage is then still there to be told about.
      raise warning 'dispatch_watch: eugenia_bot_token or telegram_chat_id is not in Vault';
    end if;
  end if;

  /* ── THEN EVERYTHING THAT NEEDS NO MESSAGE ────────────────────────────────
     A run that answered 2xx is finished with. A failure that was suppressed as
     one lost poll is finished with too — the threshold counts rows rather than
     unsettled ones, so settling it cannot hide the third failure in an hour. */
  update public.dispatch set settled = true
   where not settled and reported_by is null
     and at <= now_ - interval '15 minutes'
     and id not in (select id from _said);

  /* ── AND GIVING UP IS EXPLICIT ────────────────────────────────────────────
     Past three hours nothing can be adjudicated: pg_net has pruned the
     response, so a failure looks the same as a success and a report that never
     landed looks the same as one that did. Retried every ten minutes until
     here, then retired — because a row that can never resolve would otherwise
     be re-reported for the life of the deployment, and the message that cries
     every ten minutes is the one nobody reads. */
  update public.dispatch set settled = true
   where not settled and at <= now_ - interval '3 hours';

  return coalesce(n, 0);
end;
$$;

-- Reachable by the publishable key otherwise, from the default privileges
-- Supabase grants on the public schema — `revoke ... from public` alone does
-- not take those, which is the mistake 007 exists to have corrected once.
revoke execute on function public.dispatch_failures(timestamptz) from public, anon, authenticated;
revoke execute on function public.dispatch_repeats(text)         from public, anon, authenticated;
revoke execute on function public.dispatch_watch(timestamptz)    from public, anon, authenticated;
