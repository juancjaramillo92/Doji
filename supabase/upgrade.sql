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

-- The price sense: its job, its mark, and its name in the ledger. The rows go
-- before the constraint, which would refuse them.
select cron.unschedule(jobname) from cron.job where jobname = 'doji-eugenia-price';

drop table if exists public.eugenia_price;

delete from public.dispatch where job = 'eugenia-price';

alter table public.dispatch drop constraint if exists dispatch_job_check;
alter table public.dispatch add constraint dispatch_job_check check (job in (
  'poller', 'eugenia', 'eugenia-spine', 'trade-event', 'gladys'));
