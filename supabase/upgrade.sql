-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — what a re-run of schema.sql cannot change on the live database
-- ───────────────────────────────────────────────────────────────────────────
-- schema.sql is applied by running all of it again, so it never drops: a drop
-- re-run takes whatever it names. What it stops declaring therefore stays on
-- the live database, and a constraint written inside `create table if not
-- exists` never changes there. These statements bring the live database to
-- what a fresh apply builds. Run the whole file by hand, then schema.sql.
--
-- Every statement is guarded, so a second run changes nothing. test/db applies
-- this file between main's schema.sql and this one and compares the result with
-- a fresh build, which is what proves it.
-- ═══════════════════════════════════════════════════════════════════════════

-- The price sense: its job and its mark.
select cron.unschedule(jobname) from cron.job where jobname = 'doji-eugenia-price';

drop table if exists public.eugenia_price;

-- The release look: the job that woke it, which schema.sql schedules again
-- under the name of what it still does, the mark it stamped on each release,
-- and the line it wrote beside one.
select cron.unschedule(jobname) from cron.job where jobname = 'doji-eugenia-spine';

alter table public.eugenia_calendar drop column if exists looked_at;
alter table public.eugenia_calendar drop column if exists note;

-- Both jobs' names in the ledger. The rows change before the constraint does,
-- which would refuse them.
alter table public.dispatch drop constraint if exists dispatch_job_check;

delete from public.dispatch where job = 'eugenia-price';
update public.dispatch set job = 'eugenia-calendar' where job = 'eugenia-spine';

alter table public.dispatch add constraint dispatch_job_check check (job in (
  'poller', 'eugenia', 'eugenia-calendar', 'trade-event', 'gladys'));

-- The open-trade warning: a print pending beside a position he opened is R-20's,
-- his to weigh, so a trade opening no longer calls her. trades_eugenia_on_event
-- stays, called on a close alone.
drop trigger if exists trades_eugenia_opened on public.trades;

-- The sixth channel, what investors are buying. The constraint written inside
-- `create table if not exists` never changes on the live database; schema.sql
-- seeds the row once it can be accepted.
alter table public.eugenia_channels drop constraint if exists eugenia_channels_name_check;

alter table public.eugenia_channels add constraint eugenia_channels_name_check check (channel in (
  'rates_vs_inflation', 'dollar', 'inflation', 'jobs', 'central_bank_buying',
  'investment_demand'));
