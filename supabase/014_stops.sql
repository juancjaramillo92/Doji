-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 014: every stop and target a position carried, and when
-- ───────────────────────────────────────────────────────────────────────────
-- R-19 is what he does when a high-impact print lands on a position inherited
-- from an earlier session: in profit, the stop to break-even; losing, tighter;
-- the target never moves; never wider. Every half of that is a question about
-- where the stop and target sat AT THE PRINT, and nothing kept that.
--
-- 006 keeps the plan AS FIRST SEEN and refuses every later write on purpose,
-- because a plan that tracked the stop would file R-04's break-even as the plan.
-- A closed position reports only its final stop. So the broker saw every move
-- and this system kept the first and the last. The poller reads the open
-- positions every two minutes already; this is where it writes down a change.
--
-- ONE ROW PER CHANGE, NOT PER POLL. Seven hundred reads a day of a stop that
-- never moves would be seven hundred identical rows; a row is written only when
-- the stop or the target differs from the last one written for that position.
-- So `seen_at` is when the poller first saw a value, up to two minutes after it
-- was set — the same "as first seen" 006 states.
--
-- The broker keeps none of this history once a position is closed, so it
-- exists nowhere else and the weekly backup carries it.
--
-- Safe to re-run: `if not exists`, and grants that are no-ops when held.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.trade_stops (
  id       text        not null,
  seen_at  timestamptz not null default now(),
  -- Display prices, as get_positions serves them; null where the position
  -- carried no order on that side.
  sl       numeric,
  tp       numeric,
  primary key (id, seen_at)
);

-- No user_id and no policy, for sync_health's reason: the poller and Eugenia
-- hold the secret key, and RLS with nothing behind it denies the publishable key.
alter table public.trade_stops enable row level security;
revoke all on public.trade_stops from anon, authenticated;
