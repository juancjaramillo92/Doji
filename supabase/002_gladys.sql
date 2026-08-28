-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Gladys's triggers
-- ───────────────────────────────────────────────────────────────────────────
-- Two events reach her, and one function sends both. A position opens and she
-- asks the trader the four journal questions in Telegram; the answers move
-- afterwards from somewhere that is not Telegram and she redraws the message
-- she already posted. Separate from 001_trades.sql because it depends on two
-- things that file does not: doji-gladys deployed, and the cron job's secret in
-- Vault.
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
create or replace function public.trades_telegram()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret  text;
  payload jsonb;
begin
  -- Lower case, and read from the poller's own cron job rather than guessed:
  -- 004_cron.sql reads exactly this name. Postgres compares it case-sensitively
  -- and a name that matches nothing yields null, so the upper-case spelling
  -- costs every trade its message and raises nothing.
  select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'doji_cron_secret';

  -- An AFTER trigger that raises takes the write down with it, and a missing
  -- secret must never cost the trade its row. The prompt is the expendable half
  -- of this feature; the fill is not.
  if secret is null then
    raise warning 'trades_telegram: doji_cron_secret not in Vault — no message sent';
    return null;
  end if;

  payload := jsonb_build_object(
    'id',             new.id,
    'direction',      new.direction,
    'entry_price',    new.entry_price,
    'entry_time',     new.entry_time,
    'setup',          new.setup,
    'followed_rules', new.followed_rules,
    'followed_sl',    new.followed_sl,
    'followed_tp',    new.followed_tp);

  -- WHICH OF THE TWO THIS IS, SAID BY THE BODY RATHER THAN BY A FLAG. An
  -- update names the message to edit and the four answers AS THEY STOOD; an
  -- insert has neither, because there is no message yet and nothing preceded
  -- the row. doji-gladys reads the absence.
  --
  -- The before-state is not decoration. Whether the redraw settles the form or
  -- leaves it open is decided from it, exactly as a tap decides it — so a tap,
  -- which fires this trigger as well as redrawing itself, produces two
  -- identical messages and Telegram answers the second `message is not
  -- modified`. Deciding it any other way makes the two fight, and the losing
  -- one is a form that shuts under a correction.
  if tg_op = 'UPDATE' then
    payload := payload || jsonb_build_object(
      'tg_message_id', new.tg_message_id,
      'before', jsonb_build_object(
        'setup',          old.setup,
        'followed_rules', old.followed_rules,
        'followed_sl',    old.followed_sl,
        'followed_tp',    old.followed_tp));
  end if;

  perform net.http_post(
    url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-gladys',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-doji-key', secret),
    body    := payload,
    -- The poller's job sets the same bound. A cold start plus a read, a write
    -- and a Telegram call can outrun pg_net's default, and a request cut off
    -- mid-flight is a message that never arrives.
    timeout_milliseconds := 20000
  );
  return null;
end $$;

-- ─── The open guard ────────────────────────────────────────────────────────
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
-- REPLACE rather than CREATE, so this file can be applied to a database that
-- already has it. The URL above changes when the function is renamed, and a
-- file that errors on its last statement leaves the reader guessing whether the
-- statements before it took. `create or replace trigger` is atomic — unlike a
-- drop and recreate, there is no window in which an insert goes unannounced.
create or replace trigger trades_telegram_on_open
  after insert on public.trades
  for each row
  when (new.entry_time > now() - interval '1 hour')
  execute function public.trades_telegram();

-- ─── The answer guard ──────────────────────────────────────────────────────
-- The four journal columns, and nothing else on the row. The poller and the
-- email parser write broker columns on every pass and a soft delete writes
-- `deleted`; none of that changes what the message says, and firing on it would
-- spend a function invocation and a Telegram call to redraw the same words.
--
-- `is distinct from` rather than `<>`, because these columns are three-state and
-- `<>` is NULL against an unanswered one — a WHEN clause that is not true does
-- not fire, so the first answer to any question would be the one redraw that
-- never happened.
--
-- No time guard, and it needs none: this edits a message rather than posting
-- one. A restore from backup takes the DO UPDATE path for every row that
-- exists, and each one is asked to redraw a message to what it already says,
-- which Telegram refuses as `message is not modified`. Rows with no message id
-- fail the first clause outright.
create or replace trigger trades_telegram_on_answer
  after update on public.trades
  for each row
  when (new.tg_message_id is not null
        and (new.setup          is distinct from old.setup
          or new.followed_rules is distinct from old.followed_rules
          or new.followed_sl    is distinct from old.followed_sl
          or new.followed_tp    is distinct from old.followed_tp))
  execute function public.trades_telegram();

-- LAST, AND THE ORDER IS THE POINT. Both triggers above now point at
-- trades_telegram(), so the name the function carried while it only ever
-- announced an open is merely left behind by that repointing — and a function
-- nothing calls reads exactly like one that is still wired up. Dropping it
-- before the triggers moved would fail on the dependency; `if exists` is what
-- makes this a no-op on a database that never had the old name.
drop function if exists public.trades_telegram_open();
