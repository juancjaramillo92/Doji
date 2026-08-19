-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Eugenia: conversation history and her schedule
-- ───────────────────────────────────────────────────────────────────────────
-- Eugenia is the market bot. She reads no trade and owns no column of `trades`,
-- so nothing here touches the journal — this is her own memory and her own
-- clock, and that is the whole file.
--
-- Run once, in the SQL editor, after doji-eugenia is deployed and
-- ANTHROPIC_API_KEY is in the Edge Function secrets.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Her memory ────────────────────────────────────────────────────────────
-- Without this every question starts from nothing and "what did you mean about
-- the Fed?" cannot be answered. The function reads the last twelve rows.
--
-- No user_id and no RLS policy: nothing but the Edge Function ever reads this,
-- and it holds the service key. RLS is still enabled with no policy at all,
-- which denies the publishable key outright — the app has no business here, and
-- an unprotected table reachable by a public key would be an open log.
create table public.eugenia_turns (
  id         bigserial primary key,
  role       text not null,
  content    text not null,
  created_at timestamptz not null default now(),

  -- The Messages API accepts these two and nothing else. Enforced here so a
  -- malformed write fails at the boundary rather than as a 400 from Claude.
  constraint eugenia_turns_role_check check (role in ('user', 'assistant'))
);

-- The only read there is: the newest twelve, in id order.
create index eugenia_turns_id_desc on public.eugenia_turns (id desc);

alter table public.eugenia_turns enable row level security;

-- ─── What she may see of the journal ───────────────────────────────────────
-- Read-only, and enforced by the grant below rather than by her good intentions.
--
-- A VIEW rather than the table, for two reasons. It fixes the column list — no
-- user_id, no balance, no commission, none of which she needs to discuss a
-- trade — and it filters `deleted`, so a trade the trader removed stays removed
-- in conversation too. A single-table view is auto-updatable in Postgres, which
-- is exactly why the revoke below is not decoration.
create view public.eugenia_trades as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         open_day, setup, followed_rules, followed_sl, followed_tp
  from public.trades
  where deleted = false;

-- SELECT and nothing else, for the one role that reaches it.
revoke all on public.eugenia_trades from anon, authenticated, service_role;
grant select on public.eugenia_trades to service_role;

-- SAY THE LIMIT PLAINLY: this makes the VIEW read-only, not the key. Eugenia
-- holds the service key because she writes eugenia_turns, and that key can
-- still reach `trades` directly. What stops her is structural — her function
-- has exactly one database read of the journal and no write path to it at all,
-- and a test asserts the query it builds. The grant is the second lock, not the
-- only one.

-- ─── Her clock ─────────────────────────────────────────────────────────────
-- HOURLY, AND THE HOUR IS DECIDED IN THE FUNCTION. Weekdays at 08:00 and Sunday
-- at 17:00 New York; pg_cron schedules in UTC, so any fixed expression is an
-- hour wrong for half the year and would need editing twice a year forever.
-- briefDue() asks America/New_York for its own clock instead, and twenty-three
-- of these twenty-four calls return "not a briefing hour" without spending a
-- token. That is the same trade the poller makes with marketOpen().
--
-- Same secret and same Vault read as the poller's job — lower case, as it is
-- actually stored. Check it against `select command from cron.job` rather than
-- trusting this line: the Telegram trigger shipped with the upper-case spelling
-- and went silently quiet for it.
select cron.schedule(
  'doji-eugenia',
  '0 * * * *',
  $$
    select net.http_post(
      url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-doji-key',   (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'doji_cron_secret')),
      -- A briefing is a dozen web searches and a long generation. The poller's
      -- 20s would cut it off mid-thought; pg_net is fire-and-forget, so this
      -- bound only has to outlast the work.
      timeout_milliseconds := 300000
    );
  $$
);
