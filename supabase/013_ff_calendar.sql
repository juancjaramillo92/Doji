-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 013: the calendar R-14 is judged against, as Forex Factory rates it
-- ───────────────────────────────────────────────────────────────────────────
-- R-14 stands him aside before a high-impact release, and he defined both
-- halves: high impact is the RED FOLDER on Forex Factory, USD only, and no entry
-- in the thirty minutes before one. Neither half can be read off
-- `eugenia_calendar`, whose impact is Eugenia's own judgement from a search
-- page — the thing she herself asked to be corrected on. So the rule reads the
-- rating he reads, from the export Forex Factory publishes for programs.
--
-- THE EXPORT IS ONE WEEK, SUNDAY TO SATURDAY, AND ONLY EVER THE CURRENT ONE.
-- History exists here only because the nightly pass keeps what it fetched, so
-- every trade before the first fetch is outside what R-14 can see — and a week
-- the fetch missed must say so rather than read as a week with no releases,
-- which would pass every trade in it. That is `ff_weeks`: a week is covered
-- because a fetch of it landed, never because no release was found.
--
-- A FETCH REPLACES ITS WEEK, IN ONE TRANSACTION. Forex Factory moves a release,
-- retitles one and changes its impact inside a week, so a merge would keep the
-- old time beside the new one and R-14 would fail an entry against a print that
-- never happened then. Delete-and-insert through PostgREST is two requests with
-- a window between them; `ff_calendar_replace` is one statement from outside.
--
-- Safe to re-run: `if not exists`, `or replace`, and grants that are no-ops
-- when already held.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ff_calendar (
  at        timestamptz not null,
  country   text        not null,
  title     text        not null,
  -- As Forex Factory writes it: High, Medium, Low, Holiday. Kept whole rather
  -- than filtered to the red folder, because which folder counts is R-14's
  -- decision and belongs where the rule is.
  impact    text        not null,
  forecast  text,
  previous  text,
  primary key (at, country, title)
);

-- The Sunday (New York) each fetched week starts on. Written by the same call
-- that writes the week's events, so the two cannot disagree.
create table if not exists public.ff_weeks (
  week        date        primary key,
  fetched_at  timestamptz not null default now()
);

-- No user_id and no policy, for sync_health's reason: the function holds the
-- secret key, and RLS with nothing behind it denies the publishable key.
alter table public.ff_calendar enable row level security;
alter table public.ff_weeks enable row level security;

-- `events` is what the nightly pass parsed out of the export: an array of
-- { at, country, title, impact, forecast, previous }. An empty array changes
-- nothing — a fetch that parsed to nothing must not empty a week that had rows.
create or replace function public.ff_calendar_replace(events jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  lo timestamptz;
  hi timestamptz;
  n  integer;
begin
  select min((e->>'at')::timestamptz), max((e->>'at')::timestamptz)
    into lo, hi
    from jsonb_array_elements(events) e;
  if lo is null then return 0; end if;

  delete from public.ff_calendar where at between lo and hi;

  insert into public.ff_calendar (at, country, title, impact, forecast, previous)
  select (e->>'at')::timestamptz, e->>'country', e->>'title', e->>'impact',
         nullif(e->>'forecast', ''), nullif(e->>'previous', '')
    from jsonb_array_elements(events) e
  on conflict do nothing;
  get diagnostics n = row_count;

  -- Monday-based date_trunc, shifted a day either side, is the Sunday on or
  -- before `lo` — the day Forex Factory's week begins.
  insert into public.ff_weeks (week, fetched_at)
  values ((date_trunc('week', (lo at time zone 'America/New_York') + interval '1 day')
           - interval '1 day')::date, now())
  on conflict (week) do update set fetched_at = excluded.fetched_at;

  return n;
end;
$$;

-- Both halves of the revoke, for 007's reason: `anon` and `authenticated` hold
-- execute by name from the schema's default privileges, and revoking from
-- PUBLIC alone leaves them holding it.
revoke all on public.ff_calendar, public.ff_weeks from anon, authenticated;
revoke execute on function public.ff_calendar_replace(jsonb) from public, anon, authenticated;
grant execute on function public.ff_calendar_replace(jsonb) to service_role;
