-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — Gladys's triggers
-- ───────────────────────────────────────────────────────────────────────────
-- A position opens: she asks the four journal questions in Telegram. Its
-- answers move from anywhere else: she redraws the message she already sent.
-- One function sends both. Needs doji-gladys deployed and the cron secret in
-- Vault. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- security definer, because vault.decrypted_secrets is not readable by
-- service_role, the role the poller's upsert arrives under. The search_path is
-- emptied and every name qualified, so nothing resolves through a schema
-- someone else controls.
--
-- Sends the eight columns the message draws and no others; to_jsonb(new)
-- would hand user_id and the balance to a function with no use for either.
--
-- Answering followed_sl and followed_tp at open records intent, not outcome:
-- the message arrives seconds after the fill. A missed later edit reads as
-- compliance, so those two bars lean upward and nothing in the data shows it.
create or replace function public.trades_telegram()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret  text;
  payload jsonb;
  req     bigint;
begin
  -- Lower case: Vault compares names case-sensitively and a miss yields null.
  secret := (select decrypted_secret from vault.decrypted_secrets
              where name = 'doji_cron_secret');

  -- Raising here would fail the write that fired it. The message is the
  -- expendable half; the fill is not.
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

  -- The body says which trigger fired: an update names the message to edit and
  -- the answers as they stood before. doji-gladys decides whether the redraw
  -- settles the form from that before-state, exactly as a tap does, so a tap —
  -- which fires this too — draws the identical message twice and the second
  -- edit is a no-op rather than a fight.
  if tg_op = 'UPDATE' then
    payload := payload || jsonb_build_object(
      'tg_message_id', new.tg_message_id,
      'before', jsonb_build_object(
        'setup',          old.setup,
        'followed_rules', old.followed_rules,
        'followed_sl',    old.followed_sl,
        'followed_tp',    old.followed_tp));
  end if;

  req := net.http_post(
    url     := 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-gladys',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-doji-key', secret),
    body    := payload,
    -- A cold start plus a read, a write and a Telegram call can outrun pg_net's
    -- default; the poller's job sets the same bound.
    timeout_milliseconds := 20000
  );

  -- Recorded in 009's ledger, behind its own handler: this runs inside the
  -- write that fired it, and a monitor must never fail the work it watches.
  begin
    insert into public.dispatch (id, job) values (req, 'gladys');
  exception when others then null;
  end;
  return null;
end $$;

-- ONE HOUR, AND IT IS LOAD-BEARING: without it a restore from backup would
-- message him once per row. A live fill is seconds old; everything else fails:
--   · a restore — existing ids take ON CONFLICT DO UPDATE, which never reaches
--     an insert trigger, and new ones carry their historical entry_time;
--   · an email-first row — it has no entry_time, `null > …` is null, and a
--     WHEN that is not true does not fire. No open event, no prompt;
--   · a ?force=1 backfill — old entry_times;
--   · the poller's re-upserts — only the first write is an INSERT.
-- `create or replace trigger` is atomic: no moment where an insert goes
-- unannounced, as a drop and recreate would leave.
create or replace trigger trades_telegram_on_open
  after insert on public.trades
  for each row
  when (new.entry_time > now() - interval '1 hour')
  execute function public.trades_telegram();

-- The four journal columns only: broker writes and the soft delete change
-- nothing the message says. `is distinct from`, never `<>`, because these are
-- three-state and `<>` is null against an unanswered one, so the first answer
-- to every question would never redraw. No time guard: this edits rather than
-- posts, and a row with no message fails the first clause.
create or replace trigger trades_telegram_on_answer
  after update on public.trades
  for each row
  when (new.tg_message_id is not null
        and (new.setup          is distinct from old.setup
          or new.followed_rules is distinct from old.followed_rules
          or new.followed_sl    is distinct from old.followed_sl
          or new.followed_tp    is distinct from old.followed_tp))
  execute function public.trades_telegram();

-- The function's earlier name, left behind once both triggers point above.
-- Last, because it could not be dropped while a trigger still used it.
drop function if exists public.trades_telegram_open();
