-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 018: her calendar keyed by TradingView's id
-- ───────────────────────────────────────────────────────────────────────────
-- The calendar is filed for her now, from TradingView, rather than typed in by
-- her off a search page. Most of what went wrong with this table came from the
-- typing: the key was (at, name) over a name the model wrote, so one CPI arrived
-- as five rows under five spellings, and nothing a later turn wrote could tell
-- which of them it meant. TradingView keeps an id for every release, and that is
-- the key a filing upserts on — one release, one row, whatever it is called.
--
-- A UNIQUE INDEX RATHER THAN A CONSTRAINT, and plain rather than partial:
-- PostgREST's `on_conflict=tv_id` needs a unique index it can infer, and the
-- rows she filed before this carry no id. Nulls do not collide.
--
-- WHAT SHE FILED FOR THE DAYS AHEAD IS DELETED, because TradingView's rows for
-- the same releases arrive under different names and every pending print would
-- otherwise be listed twice until it had passed. Only the future, and only rows
-- with no id: what already printed is history, and the series this table exists
-- to grow keeps every one of them.
--
-- Safe to re-run: `if not exists`, and a delete that matches nothing once she
-- no longer files.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.eugenia_calendar add column if not exists tv_id text;

create unique index if not exists eugenia_calendar_tv_id on public.eugenia_calendar (tv_id);

delete from public.eugenia_calendar where tv_id is null and at > now();
