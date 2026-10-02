-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 010: how much of the worker's clock the briefing is spending
-- ───────────────────────────────────────────────────────────────────────────
-- The cron half answers before it works, so a briefing killed at the wall clock
-- has already handed pg_net a 200: 009 sees a healthy dispatch, ask() never
-- reaches its catch, no apology is sent, and each retry dies the same way. So
-- it is watched from both sides — the pace, a warning while there is still
-- room, and the absence, a briefing the day owed that never arrived. It posts
-- to Telegram itself, for 009's reason.
--
-- Run after 009. Safe to re-run in full. Creates no table: eugenia_runs.ms
-- already holds what it needs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── What there is to say, if anything ─────────────────────────────────────
-- Separate from the sending, and handed its clock, so its verdict can be
-- driven from planted rows.
--
-- It speaks at three-quarters of the 400s paid wall clock: the briefing's
-- ordinary swing is about 77s, so an ordinary heavy morning cannot reach it,
-- and the 100s left is more than one swing — early enough to act on.
--
-- `ms` is a lower bound on the wall clock, which started earlier and stops
-- later, so the largest single row crossing means the invocation did. There is
-- no invocation id to reassemble one with; the cost is lateness, never a false
-- alarm. Seven days, so the window holds a Sunday briefing.
--
-- `since` is when the watcher last spoke, so a run is said once rather than
-- every day it stays in the window. diagnose.sql passes none. Dropped first,
-- because a second argument makes a second function and the old one would
-- leave `pace_line()` ambiguous.
drop function if exists public.pace_line(timestamptz);
create or replace function public.pace_line(now_  timestamptz default now(),
                                            since timestamptz default null)
returns text
language plpgsql
stable
as $$
declare
  -- The paid worker wall clock, stated once; the message quotes it.
  ceiling_ms constant int := 400000;
  speak_at   constant int := ceiling_ms * 3 / 4;

  wd      int  := extract(dow  from now_ at time zone 'America/New_York')::int;
  hour    int  := extract(hour from now_ at time zone 'America/New_York')::int;
  today   date := (now_ at time zone 'America/New_York')::date;
  owed    text;
  worst   public.eugenia_runs;
  lines   text[] := '{}';
begin
  /* ── The absence ──────────────────────────────────────────────────────────
     Judged an hour past the last retry (retryDue's window), when the day can
     no longer produce one; earlier, it would report a briefing still being
     written. agree.test.mjs holds these hours against retryDue. */
  owed := case
            when wd between 1 and 5 and hour >= 12 then 'weekday'
            when wd = 0             and hour >= 21 then 'sunday'
          end;

  -- postBriefing writes this caller only after the briefing was sent.
  if owed is not null and not exists (
       select 1 from public.eugenia_runs
        where caller = owed || ' briefing delivered'
          and (at at time zone 'America/New_York')::date = today) then
    lines := lines || format(
      'No %s briefing landed today, jefe, and the last hour it could still have '
      || 'arrived has passed.',
      case owed when 'sunday' then 'Sunday open' else 'weekday' end);
  end if;

  /* ── The pace ─────────────────────────────────────────────────────────────
     Failed runs count: a turn that died still spent the clock. This
     watcher's own rows carry no `ms`, so they fall out unnamed. */
  worst := (select r from public.eugenia_runs r
             where r.ms is not null
               and r.at > now_ - interval '7 days'
               and (since is null or r.at > since)
             order by r.ms desc
             limit 1);

  -- Each finding carries its own consequence, with no heading over both: one
  -- heading cannot be true of a slow briefing and a missing one.
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
-- The guard is the message rather than the run, or a midnight "checked" would
-- silence the day the briefing failed to arrive. Both outcomes leave a row in
-- eugenia_runs, so a quiet day is told apart from a watcher nobody calls. A
-- message that could not be sent leaves none: the row is the guard, and
-- writing it then would swallow the warning once the Vault name was repaired.
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

  -- The quiet day's one row.
  if said is null and not exists (
       select 1 from public.eugenia_runs
        where caller = 'pace'
          and (at at time zone 'America/New_York')::date = today) then
    insert into public.eugenia_runs (caller, ok, detail) values ('pace', true, 'clear');
  end if;

  return null;
end;
$$;

-- anon and authenticated by name, for 007's reason.
revoke execute on function public.pace_line(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.pace_watch(timestamptz)            from public, anon, authenticated;
