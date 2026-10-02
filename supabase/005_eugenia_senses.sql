-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: what wakes her, what she measures, and what compounds
-- ───────────────────────────────────────────────────────────────────────────
-- Her meters (eugenia_runs), her calendar, the running story, her open
-- threads, his taps under a briefing, the price mark, trigram search over her
-- memory, the trigger that tells her a position opened or closed, and the
-- three tables the app's card may read.
--
-- RUN AFTER 003, AND SAFE TO RE-RUN IN FULL: every statement is `if not
-- exists`, `or replace` or `on conflict do nothing`. This is the file that
-- grows. A test asserts it stays re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── What each call cost ───────────────────────────────────────────────────
-- One row per model call, plus rows for a delivered briefing, the gates'
-- verdicts, the nightly meters and a job that died before its first call. A
-- console line is gone within hours; this is where the meters survive.
-- Instrumentation for him, never read back into her context.
create table if not exists public.eugenia_runs (
  id         bigserial primary key,
  at         timestamptz not null default now(),

  -- The caller's label. Free text, so a new caller needs no migration.
  caller     text not null,
  effort     text,
  rounds     int,

  -- Searches and fetches are counted apart from tokens and from each other:
  -- each bills on its own tariff.
  in_tokens  int,
  cached     int,
  out_tokens int,
  searches   int,
  fetches    int,

  -- What filling the cache cost. A read (`cached`) is a tenth of the input
  -- rate; a write is 1.25× at five minutes and 2× at an hour, so the two TTLs
  -- are kept apart — their sum is not money.
  wrote_1h   int,
  wrote_5m   int,

  chars      int,

  -- Which model ran, and which answered when `fallbacks` stepped in.
  model      text,
  fell_back  text,

  ms         int,
  ok         boolean not null default true,
  detail     text
);

-- Columns added after the table existed. Null on older rows means unmeasured,
-- not zero.
alter table public.eugenia_runs add column if not exists fetches int;
alter table public.eugenia_runs add column if not exists wrote_1h int;
alter table public.eugenia_runs add column if not exists wrote_5m int;
alter table public.eugenia_runs add column if not exists model text;

create index if not exists eugenia_runs_at_desc on public.eugenia_runs (at desc);
create index if not exists eugenia_runs_caller_at on public.eugenia_runs (caller, at desc);

alter table public.eugenia_runs enable row level security;

-- ─── The calendar ──────────────────────────────────────────────────────────
-- What lands and what it printed. It wakes her after a high-impact print, and
-- it compounds: in a year it is how each release ran against expectations,
-- with her line beside each one. Filed from TradingView (018); she writes only
-- `note`, and an `actual` TradingView has not yet published.
create table if not exists public.eugenia_calendar (
  id         bigserial primary key,

  -- UTC; everything shown to a person is formatted in New York.
  at         timestamptz not null,

  name       text not null,

  -- Only 'high' wakes her.
  importance text not null default 'high'
    constraint eugenia_calendar_importance_check check (importance in ('high', 'medium', 'low')),

  -- Text, because a consensus is "0.3%", "175K" or "unchanged at 4.25-4.50%".
  consensus  text,
  prior      text,
  actual     text,

  note       text
    constraint eugenia_calendar_note_length
      check (note is null or char_length(note) between 1 and 200),

  source     text,

  -- When the post-release look ran. Stamped before the look, so a look that
  -- fails cannot repeat every quarter hour.
  looked_at  timestamptz,

  created_at timestamptz not null default now(),

  -- Which of two disagreeing rows is the later one. Moved by the trigger below
  -- on a change to content only. One release, one row, is 018's tv_id; the
  -- (at, name) key this carried is 021's to drop.
  updated_at timestamptz not null default now()
);

alter table public.eugenia_calendar add column if not exists updated_at timestamptz not null default now();

-- A mark is not an edit: stamping looked_at must not move updated_at, or the
-- column would say when a row was last handled rather than last changed.
-- Compared as jsonb less the two bookkeeping columns, so a column added later
-- is compared without anyone remembering to list it.
create or replace function public.eugenia_calendar_touch()
returns trigger
language plpgsql
as $$ begin
  if to_jsonb(old) - 'updated_at' - 'looked_at'
     is distinct from to_jsonb(new) - 'updated_at' - 'looked_at' then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists eugenia_calendar_touch_updated_at on public.eugenia_calendar;
create trigger eugenia_calendar_touch_updated_at
  before update on public.eugenia_calendar
  for each row execute function public.eugenia_calendar_touch();

create index if not exists eugenia_calendar_at on public.eugenia_calendar (at desc);

alter table public.eugenia_calendar enable row level security;

-- ─── The running story ─────────────────────────────────────────────────────
-- One row, rewritten nightly: a reading that is only ever current, so not a
-- list. Handed to every briefing, so a morning moves yesterday's story rather
-- than starting from nothing. Every briefing that stated it is in her turns.
create table if not exists public.eugenia_thesis (
  id         text primary key
    constraint eugenia_thesis_singleton check (id = 'current'),

  -- Longer than a note, far shorter than a briefing.
  thesis     text not null
    constraint eugenia_thesis_length check (char_length(thesis) between 1 and 600),

  -- A New York civil day written by the function, for moved_on's reason in 003.
  moved_on   date,
  updated_at timestamptz not null default now()
);

-- Seeded, so the read never has to tell "no row" from "nothing decided".
insert into public.eugenia_thesis (id, thesis) values
  ('current', 'No running thesis yet — this is written by the nightly pass once there is a story to carry.')
on conflict (id) do nothing;

alter table public.eugenia_thesis enable row level security;

-- ─── Open threads ──────────────────────────────────────────────────────────
-- An odd thing she flagged (`watch`) or a question she asked him in a
-- conversation (`question`), handed back until the nightly pass closes it.
-- closed_on null is the whole read filter.
create table if not exists public.eugenia_loops (
  id         bigserial primary key,

  kind       text not null
    constraint eugenia_loops_kind_check check (kind in ('watch', 'question')),

  body       text not null
    constraint eugenia_loops_body_length check (char_length(body) between 1 and 200),

  opened_on  date not null,
  closed_on  date,

  -- What it turned out to be, written when it closes.
  resolution text
    constraint eugenia_loops_resolution_length
      check (resolution is null or char_length(resolution) between 1 and 200),

  created_at timestamptz not null default now()
);

-- Partial, matching the read: a closed thread is never selected.
create index if not exists eugenia_loops_open
  on public.eugenia_loops (kind, id desc) where closed_on is null;

alter table public.eugenia_loops enable row level security;

-- ─── His taps under a briefing ─────────────────────────────────────────────
-- One input to the nightly pass, never a score: a bot optimising a thumbs-up
-- writes briefings that flatter rather than teach.
create table if not exists public.eugenia_feedback (
  id         bigserial primary key,

  -- The briefing's day, so a late tap files against the morning it was about.
  on_day     date not null,

  verdict    text not null
    constraint eugenia_feedback_verdict_check check (verdict in ('good', 'off')),

  created_at timestamptz not null default now(),

  -- One verdict a day; the function's upsert makes the last tap win.
  constraint eugenia_feedback_one_a_day unique (on_day)
);

alter table public.eugenia_feedback enable row level security;

-- ─── Search that survives a rephrasing ─────────────────────────────────────
-- Trigram matching catches the typos and half-remembered quotes stemming
-- cannot, inside Postgres. The search function itself is 007's: redefining it
-- here would create an overload beside 007's and reopen it to the public keys.
create extension if not exists pg_trgm;

create index if not exists eugenia_notes_trgm
  on public.eugenia_notes using gin (note gin_trgm_ops);
create index if not exists eugenia_turns_trgm
  on public.eugenia_turns using gin (content gin_trgm_ops);

-- ─── A position opened or closed ───────────────────────────────────────────
-- Tells her within two minutes of the poller seeing it. What she may say is his
-- own rules read back — R-14/R-19 on a print pending against an open position,
-- R-11 on a close that took the day past its limit — and the function decides
-- from data before any model call, so the common case costs nothing.
create or replace function public.trades_eugenia_on_event()
returns trigger
language plpgsql
security definer
-- Emptied and every name qualified, for 002's reason.
set search_path = ''
as $$
declare
  kind text;
  req  bigint;
begin
  if tg_op = 'INSERT' then
    kind := 'opened';
  else
    kind := 'closed';
  end if;

  req := net.http_post(
    url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                  where name = 'doji_cron_secret')),
    body    := jsonb_build_object('trade', new.id, 'event', kind),
    timeout_milliseconds := 60000
  );

  -- Behind its own handler, for 002's reason: this runs inside the write.
  begin
    insert into public.dispatch (id, job) values (req, 'trade-event');
  exception when others then null;
  end;
  return null;
end;
$$;

drop trigger if exists trades_eugenia_opened on public.trades;
drop trigger if exists trades_eugenia_closed on public.trades;

-- Broker rows only, never a soft-deleted one.
create trigger trades_eugenia_opened
  after insert on public.trades
  for each row
  when (new.id like 'PID%' and new.deleted = false and new.fill_time is null)
  execute function public.trades_eugenia_on_event();

-- On the transition only: the poller re-upserts every two minutes and would
-- fire it on every tick otherwise. `is distinct from`, since `<>` is null
-- against the null it is moving away from.
create trigger trades_eugenia_closed
  after update on public.trades
  for each row
  when (new.id like 'PID%' and new.deleted = false
        and old.fill_time is null and new.fill_time is distinct from null)
  execute function public.trades_eugenia_on_event();

-- ─── The mark a move is measured from ──────────────────────────────────────
-- One row, rewritten every quarter hour: `bid` and `at` are the last reading,
-- so a move is a subtraction. `looked_at` moves only when a move was worth
-- waking her for, which keeps a trending afternoon to one message; it is
-- stamped before the look, for the calendar's reason.
create table if not exists public.eugenia_price (
  id        text primary key
    constraint eugenia_price_singleton check (id = 'current'),

  -- A display price; the poller converts out of pipettes before she sees it.
  bid       numeric not null,
  at        timestamptz not null default now(),

  looked_at timestamptz
);

-- Seeded so the first run has a row to PATCH. A zero mark cannot be mistaken
-- for a price: the first look rejects it and writes the real one.
insert into public.eugenia_price (id, bid, at)
  values ('current', 0, now())
  on conflict (id) do nothing;

alter table public.eugenia_price enable row level security;

-- ─── What the app may see ──────────────────────────────────────────────────
-- The three tables the dashboard card draws: the calendar, the story, the open
-- threads. Never her notes or turns, which stay denied to the publishable key.
-- They hold no user_id, so `using (true)` for a signed-in session is the honest
-- policy; the grants below keep the verb to SELECT.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'eugenia_calendar'
                    and policyname = 'eugenia_calendar_app_read') then
    create policy eugenia_calendar_app_read on public.eugenia_calendar
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'eugenia_thesis'
                    and policyname = 'eugenia_thesis_app_read') then
    create policy eugenia_thesis_app_read on public.eugenia_thesis
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'eugenia_loops'
                    and policyname = 'eugenia_loops_app_read') then
    create policy eugenia_loops_app_read on public.eugenia_loops
      for select to authenticated using (true);
  end if;
end $$;

grant select on public.eugenia_calendar to authenticated;
grant select on public.eugenia_thesis to authenticated;
grant select on public.eugenia_loops to authenticated;
