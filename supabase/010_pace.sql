-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 010: how much of the worker's clock the briefing is spending
-- ───────────────────────────────────────────────────────────────────────────
-- RUN AFTER 009. Every statement is `create or replace` or `drop ... if
-- exists`, so this file is safe to re-run in full. It creates no table: what it
-- needs is already recorded.
--
-- THE NUMBER THIS WATCHES IS THE LAST ONE IN THE SYSTEM THAT NOTHING READS.
-- `eugenia_runs.ms` has been written on every model call and every delivered
-- briefing since 005, and it has been read by nobody. Three unattended days
-- put the briefing at 170.6s, 162.3s and 238.7s against a 400s ceiling — sixty
-- per cent used on an ordinary Wednesday, with the duration swinging two to one
-- on work that looks identical from the outside.
--
-- AND THE CROSSING IS THE ONE FAILURE NOTHING HERE CAN REPORT. Since the cron
-- half began answering before it works, a briefing killed at the wall clock
-- hands pg_net an immediate 200: 009's ledger records a healthy dispatch, and
-- `ask()`'s failure row is never written because the process is gone rather
-- than throwing. `postScheduled`'s catch does not run, so no apology is sent.
-- The 09:00, 10:00 and 11:00 retries redo the same too-long work and die the
-- same way. What reaches him is nothing at all, from three monitors that all
-- read green — which is precisely the Sunday that 009 was built after.
--
-- SO IT IS WATCHED FROM BOTH SIDES. The pace is the leading half: a warning
-- while there is still room, because after the crossing there is nothing to
-- warn with. The absence is the lagging half, and it is what actually closes
-- the hole — a briefing this day owed, past the last hour it could still have
-- arrived, with no row saying it did.
--
-- IT LIVES IN POSTGRES FOR 009'S REASON, NOT AS A CONVENIENCE. The thing that
-- fails is the Edge Function, so a watcher that reported it by asking that same
-- function to send a message would share the failure mode of its subject. This
-- one posts to Telegram directly, off the same two Vault names 009 reads.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── What there is to say, if anything ─────────────────────────────────────
-- SEPARATED FROM THE SENDING FOR THE REASON `healthLine` AND `sweepLine` ARE:
-- a monitor whose verdict cannot be driven from a test against planted rows is
-- a monitor nobody has ever seen fire. It takes its clock as an argument for
-- the same reason `dispatch_failures` does.
--
-- THE CEILING IS THE PAID WALL CLOCK AND THE SHARE IS THE DECISION. The 400s
-- is the platform's, not ours; three-quarters of it is where this speaks, and
-- the argument for that share is the observed spread rather than taste. The
-- briefing's own swing is 77s between its fastest and slowest ordinary day, so
-- a threshold at 300s cannot be reached by an ordinary heavy morning — and the
-- 100s still left when it fires is more than one whole swing, which is what
-- makes the warning early enough to act on rather than a description of a
-- briefing that is already dying.
--
-- `ms` IS A LOWER BOUND ON THE WALL CLOCK AND NEVER AN OVERSTATEMENT. A row
-- measures one model call, or — on the delivered row — everything `postBriefing`
-- did; the worker's clock started earlier, at the request, and stops later. So
-- a row alone crossing the share means the invocation behind it certainly did,
-- and reading the largest row rather than trying to reassemble an invocation
-- costs only lateness, never a false alarm. There is no invocation id to
-- reassemble one with.
--
-- SEVEN DAYS, because the week has to contain a Sunday briefing — the longest
-- and rarest of them, and the one whose absence takes seven days to come round
-- again — and because a window that outlives a repair stops reporting the
-- repair.
--
-- AND A RUN IS SAID ONCE, WHICH THE WINDOW ALONE COULD NOT SAY. The only guard
-- was the day, and a run stays in a seven-day window for seven days — so the
-- first Sunday to cross the share, at 315s, was announced at 17:37 and again
-- at 00:37, and would have been every midnight until the next Sunday: the same
-- sentence eight times, which is how a monitor is taught to be swiped away.
-- `since` is when the watcher last spoke, and a run at or before it has been
-- said. diagnose.sql passes nothing, because it shows the week rather than
-- what is left to say. The absence is untouched — it is about a day, and the
-- day guard is what already says it once.
--
-- A SECOND ARGUMENT IS A SECOND FUNCTION, which is why the drop comes first.
-- `create or replace` cannot change an argument list, so the one-argument
-- version would survive beside this one and `pace_line()` would match both —
-- Postgres refuses that as ambiguous, which is 007's overload arriving here.
drop function if exists public.pace_line(timestamptz);
create or replace function public.pace_line(now_  timestamptz default now(),
                                            since timestamptz default null)
returns text
language plpgsql
stable
as $$
declare
  -- THE PLATFORM'S PAID WORKER WALL CLOCK, and the only place this file states
  -- it. The message quotes this rather than spelling the number out again: two
  -- copies of a ceiling is how a threshold gets moved and the sentence beside it
  -- keeps naming the old one.
  ceiling_ms constant int := 400000;
  speak_at   constant int := ceiling_ms * 3 / 4;

  wd      int  := extract(dow  from now_ at time zone 'America/New_York')::int;
  hour    int  := extract(hour from now_ at time zone 'America/New_York')::int;
  today   date := (now_ at time zone 'America/New_York')::date;
  owed    text;
  worst   public.eugenia_runs;
  lines   text[] := '{}';
begin
  /* ── THE ABSENCE ──────────────────────────────────────────────────────────
     Judged only once the day can no longer produce one. The weekday briefing
     is due at 08:00 and retried at 09:00, 10:00 and 11:00, so a retry that
     started on the hour and ran the whole ceiling still lands before noon;
     Sunday's is due at 17:00 and retried to 20:00, so 21:00 is the same
     bound. Asked any earlier this reports a briefing that is still being
     written, which is the ordinary-day false alarm that gets a monitor
     ignored. */
  owed := case
            when wd between 1 and 5 and hour >= 12 then 'weekday'
            when wd = 0             and hour >= 21 then 'sunday'
          end;

  -- The caller is exactly what postBriefing writes on its way out, and it is
  -- written only after the briefing has been sent — so its absence is the
  -- statement that nothing reached him, not that something went wrong.
  if owed is not null and not exists (
       select 1 from public.eugenia_runs
        where caller = owed || ' briefing delivered'
          and (at at time zone 'America/New_York')::date = today) then
    lines := lines || format(
      'No %s briefing landed today, jefe, and the last hour it could still have '
      || 'arrived has passed.',
      case owed when 'sunday' then 'Sunday open' else 'weekday' end);
  end if;

  /* ── THE PACE ─────────────────────────────────────────────────────────────
     Failed runs count: a turn that died still spent the clock, and the ones
     that spend most of it are exactly the ones worth seeing. Rows this
     watcher writes carry no `ms`, so they fall out of the population here
     rather than needing to be named out of it. */
  worst := (select r from public.eugenia_runs r
             where r.ms is not null
               and r.at > now_ - interval '7 days'
               and (since is null or r.at > since)
             order by r.ms desc
             limit 1);

  /* EACH FINDING CARRIES ITS OWN CONSEQUENCE, and there is no opening line
     over the top of them. One was tried and it could only be true of one case:
     a briefing that never arrived is not "running close to" anything, and a
     message that describes the wrong half of what it found is the first thing
     to teach him not to read it. Two sentences that stand alone need no
     wrapper. */
  if worst.ms >= speak_at then
    lines := lines || format(
      'Longest run in the last seven days: %s, %ss against the worker''s %ss '
      || 'ceiling (%s). Past that it is killed mid-draft — nothing sent, no '
      || 'apology, and nothing else here can see it.',
      worst.caller, round(worst.ms / 1000.0), ceiling_ms / 1000,
      to_char(worst.at at time zone 'America/New_York', 'Dy HH24:MI'));
  end if;

  if cardinality(lines) = 0 then
    return null;
  end if;

  return array_to_string(lines, E'\n\n');
end;
$$;

-- ─── Saying it, at most once a day ─────────────────────────────────────────
-- THE GUARD IS ON THE MESSAGE RATHER THAN ON THE RUN, and the difference is a
-- day where nothing is wrong until noon. A watcher that recorded "checked" at
-- midnight and then refused to speak would be silent on exactly the day the
-- briefing failed to arrive.
--
-- BOTH OUTCOMES, ALWAYS. A meter that records only when it fires reports a
-- watcher that has stopped running as a system with nothing to report, which is
-- the lesson `heartbeat()` learned and the embedding sweep learned again. So a
-- quiet day still leaves one row, and `eugenia_runs` — free text `caller` on
-- purpose — is where it goes rather than a table of its own.
--
-- AND A MESSAGE THAT COULD NOT BE SENT LEAVES NO ROW, which is 009's rule
-- arriving for the same reason. The row IS the guard, so writing one after a
-- Vault name failed to resolve would mark the day as said and swallow the
-- warning for good — repairing the name would then deliver silence. Written
-- only where the post was made; the next hour tries again, and verify.sql is
-- what asks whether both names resolve at all. Found by running it with the
-- name misspelled, which is the only way this half is ever exercised.
create or replace function public.pace_watch(now_ timestamptz default now())
returns text
language plpgsql
as $$
declare
  today date := (now_ at time zone 'America/New_York')::date;
  said  text := public.pace_line(now_, (select max(r.at) from public.eugenia_runs r
                                          where r.caller = 'pace' and not r.ok
                                            and r.at <= now_));
  token text;
  chat  text;
begin
  if said is not null and not exists (
       select 1 from public.eugenia_runs
        where caller = 'pace' and not ok
          and (at at time zone 'America/New_York')::date = today) then

    token := (select decrypted_secret from vault.decrypted_secrets
               where name = 'eugenia_bot_token');
    chat  := (select decrypted_secret from vault.decrypted_secrets
               where name = 'telegram_chat_id');

    if token is not null and chat is not null then
      perform net.http_post(
        url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object('chat_id', chat, 'text', said),
        timeout_milliseconds := 20000);
      insert into public.eugenia_runs (caller, ok, detail) values ('pace', false, said);
      return said;
    end if;

    raise warning 'pace_watch: eugenia_bot_token or telegram_chat_id is not in Vault';
    return null;
  end if;

  -- The quiet day's one row, and the only thing that can tell a watcher with
  -- nothing to say from a watcher nobody is calling.
  if said is null and not exists (
       select 1 from public.eugenia_runs
        where caller = 'pace'
          and (at at time zone 'America/New_York')::date = today) then
    insert into public.eugenia_runs (caller, ok, detail) values ('pace', true, 'clear');
  end if;

  return null;
end;
$$;

-- Reachable by the publishable key otherwise, from the default privileges
-- Supabase grants on the public schema — `revoke ... from public` alone does
-- not take those, which is the mistake 007 exists to have corrected once.
revoke execute on function public.pace_line(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.pace_watch(timestamptz)            from public, anon, authenticated;
