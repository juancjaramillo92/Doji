-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Telegram journal trigger
-- ───────────────────────────────────────────────────────────────────────────
-- Fires when the poller mints a row from an entry deal, and asks the trader the
-- four journal questions in Telegram. Separate from 001_trades.sql because it
-- depends on two things that file does not: doji-telegram deployed, and the
-- cron job's secret in Vault.
--
-- Run once, in the SQL editor, after both exist.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The sender ────────────────────────────────────────────────────────────
-- security definer so it runs as the owner: vault.decrypted_secrets is not
-- readable by service_role, which is the role the poller's upsert arrives
-- under. search_path is emptied and every name qualified, so nothing here can
-- be resolved through a schema someone else controls.
--
-- Sends the eight columns the message draws and no others. `to_jsonb(new)`
-- would work and would also hand user_id and the account balance to a function
-- with no use for either.
--
-- ANSWERING followed_sl AND followed_tp AT OPEN RECORDS INTENT, NOT OUTCOME.
-- The message arrives seconds after the fill, before the stop or the target has
-- been anywhere near. The columns only measure respect if the trader actually
-- goes back and edits on the occasions it was not — a missed edit reads as
-- compliance, so those two bars bias upward and nothing in the data shows it.
-- This is the same shape as the null-is-not-no rule the schema already protects:
-- an answer nobody gave must not be counted as an answer.
create or replace function public.trades_telegram_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  -- Lower case, and read from the poller's own cron job rather than guessed:
  -- `select command from cron.job` shows it reads exactly this name. Postgres
  -- compares strings case-sensitively, so the upper-case spelling this file
  -- shipped with matched nothing and every trade went unannounced.
  select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'doji_cron_secret';

  -- An AFTER trigger that raises takes the INSERT down with it, and a missing
  -- secret must never cost the trade its row. The prompt is the expendable half
  -- of this feature; the fill is not.
  if secret is null then
    raise warning 'trades_telegram_open: doji_cron_secret not in Vault — no message sent';
    return null;
  end if;

  perform net.http_post(
    url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-telegram',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-doji-key', secret),
    body    := jsonb_build_object(
      'id',             new.id,
      'direction',      new.direction,
      'entry_price',    new.entry_price,
      'entry_time',     new.entry_time,
      'setup',          new.setup,
      'followed_rules', new.followed_rules,
      'followed_sl',    new.followed_sl,
      'followed_tp',    new.followed_tp),
    -- The poller's job sets the same bound. A cold start plus a read, a write
    -- and a Telegram call can outrun pg_net's default, and a request cut off
    -- mid-flight is a message that never arrives.
    timeout_milliseconds := 20000
  );
  return null;
end $$;

-- ─── The guard ─────────────────────────────────────────────────────────────
-- ONE HOUR, AND IT IS LOAD-BEARING. Without it a restore from backup messages
-- the trader once per row in the file.
--
-- A live fill is seconds old, so the window is enormously generous to the only
-- case it is meant to admit. Everything else fails it:
--
--   · Restore from backup. The procedure in README.md is
--     `insert … on conflict (id) do update`. Rows that exist take the DO UPDATE
--     path, which is not an INSERT and never reaches this trigger at all. Rows
--     that do not exist are real inserts — and carry their historical
--     entry_time, so they fail here.
--   · An email-first row. The Apps Script sends id, direction, fill_time,
--     net_pnl and balance, never entry_time. `null > anything` is NULL, a WHEN
--     clause that is not true does not fire, and the row is silent. Such a
--     trade gets no Telegram prompt ever, which is correct: there was no open
--     event to prompt from.
--   · A ?force=1&hours=200 backfill. Existing ids are updates. Ids the poller
--     never reached before do insert, but with an old entry_time.
--   · The poller's own re-upserts. Only the first write of a position is an
--     INSERT; every one after it inside the 6h write window is an UPDATE. One
--     message per trade, and the mechanism is Postgres's, not a de-dupe check.
create trigger trades_telegram_on_open
  after insert on public.trades
  for each row
  when (new.entry_time > now() - interval '1 hour')
  execute function public.trades_telegram_open();
