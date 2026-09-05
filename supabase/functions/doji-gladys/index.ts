// ═══════════════════════════════════════════════════════════════════════════
// GLADYS — the journal bot  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// One function, two callers, told apart by which secret they present:
//
//   x-doji-key                        the two triggers in
//                                     supabase/002_gladys.sql — a position
//                                     opened, post the message; its journal
//                                     answers moved, redraw it.
//   x-telegram-bot-api-secret-token   Telegram — a button was tapped, write the
//                                     column and redraw the message.
//
// One file rather than two functions because the two halves share everything
// that matters — the keyboard, the message, the callback_data grammar — and
// splitting them meant deploying that shared code twice and keeping the copies
// in step. There is no third caller: nothing else knows either secret.
//
// THE FOURTH WRITER, AND IT STAYS INSIDE THE JOURNAL HALF. A tap names its
// column through COLUMNS below, which holds the same four names as Data.OWNED
// in index.html and nothing else. No broker column is reachable from a button,
// so there is nothing to arbitrate with the poller or the email parser. The
// write moves updated_at, and the realtime subscription the app already holds
// re-renders any open tab for free.
//
// A TAP IS SELF-DESCRIBING; A WRITE FROM ANYWHERE ELSE IS NOT. callback_data
// carries the trade, the field and the value, and Telegram's callback carries
// the chat and message ids editMessageText needs — so the tap path holds no
// session state at all and a redeploy in the middle of answering costs nothing.
//
// The app writing the same four columns has none of that, and for as long as
// there was nothing to edit from, journalling a trade in the app left this
// message showing an empty one for good. So the message id is kept, on the row,
// in trades.tg_message_id. It is Gladys's column alone: it is in neither
// Data.OWNED nor COLUMNS below, so nothing can name it from a save or a tap.
//
// Whether a redraw settles the form is decided from neither. It comes from the
// row as it stood BEFORE the write — see staysOpen — which is what lets the
// update trigger and the tap path reach the same answer, so the two redraws a
// tap sets off draw the identical message and the second is a no-op.
//
// SECURITY CONTRACT
//   1. Deployed with verify_jwt = false — Telegram calls it unauthenticated and
//      cannot be taught to present a JWT, so authorisation happens here, in
//      code, before any work begins. Same arrangement as doji-mcp-sync.
//   2. Each half checks its own secret, and an unset secret refuses rather than
//      admits. The trigger presents DOJI_CRON_SECRET, read from Vault — the
//      same secret the poller's cron job carries. Its authority HERE is not
//      nothing: postOpen renders the message from the request body, so a holder
//      of that secret can put arbitrary text into the trader's own thread. It
//      still cannot reach a column, because it never names one.
//   3. The chat is checked as well as the secret. The header proves the caller
//      is Telegram; the chat id proves the tap came from the trader's own
//      thread.
//   4. Nothing from a request reaches the database untranslated. parseCallback
//      whitelists the field and the value, so a write can only ever name one of
//      four columns.
//
// Deploy:   supabase functions deploy doji-gladys --no-verify-jwt
// Register: setWebhook with secret_token = GLADYS_WEBHOOK_SECRET and
//           allowed_updates = ["callback_query"] — a tap is her whole
//           vocabulary, so every other update type is a wake-up for nothing.
// Secrets:  GLADYS_BOT_TOKEN, TELEGRAM_CHAT_ID, GLADYS_WEBHOOK_SECRET,
//           DOJI_CRON_SECRET, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════

// Everything shared lives in _shared/edge.ts — one definition each, for the
// reason that file gives. Every Deno touch goes through env(), so this module
// imports under plain Node and test/fold.test.mjs can reach the pure exports
// below. The Deno.serve at the bottom is guarded for the same reason.
import {
  env, secretMatches, json, telegram, sbHeaders, SB_URL, SB_KEY,
} from "../_shared/edge.ts";

const BOT_TOKEN      = env("GLADYS_BOT_TOKEN");
// Numeric, not an @name. This value is both a sendMessage target and the
// identity a tap's chat id is compared against, and only the numeric form
// satisfies both — an @name posts messages fine and then drops every tap.
//
// Named for the wire rather than for her, because it is the one secret the two
// bots genuinely share: one trader, one chat, a thread each.
const CHAT_ID        = env("TELEGRAM_CHAT_ID");
const WEBHOOK_SECRET = env("GLADYS_WEBHOOK_SECRET");
const CRON_SECRET    = env("DOJI_CRON_SECRET");

/* ─── The journal vocabulary ───────────────────────────────────────────────
   Identical to CONFIG.SETUPS in index.html and to the trades_setup_check
   constraint. Three copies of one list across three runtimes with no build step
   between them, and the constraint is the one that cannot be bypassed — a value
   that gets past the check below still has to satisfy Postgres.

   Three copies is what it costs; three copies that can DISAGREE is not, and was
   the actual risk. test/agree.test.mjs reads all three — this export, the app's
   CONFIG.SETUPS out of index.html, and the constraint text out of
   001_trades.sql — and fails when they stop saying the same thing.
   ───────────────────────────────────────────────────────────────────────── */
export const SETUPS: readonly string[] = ['Break & Retest', 'Support & Resistance'];

// callback_data field → column. This map is the entire reason a tap cannot
// disturb broker data: it holds the same four names as Data.OWNED and nothing
// else, and agree.test.mjs is what holds those two lists together rather than
// each being checked against a literal typed into its own test.
export const COLUMNS: Record<string, string> = {
  setup: 'setup',
  rules: 'followed_rules',
  sl:    'followed_sl',
  tp:    'followed_tp',
};

// The journal half of the row, split out because it is the whole input to the
// one decision this file makes twice — whether a redraw settles the form.
export interface Answers {
  setup: string | null;
  followed_rules: boolean | null;
  followed_sl: boolean | null;
  followed_tp: boolean | null;
}

export interface Row extends Answers {
  id: string;
  direction: string;
  entry_price: number;
  entry_time: string;
}

// What a trigger posts. Both extras belong to the update: the message to edit,
// and the answers as they stood before it. An insert has neither, and that
// absence is what tells the two apart.
interface Fired extends Row {
  tg_message_id?: number;
  before?: Answers;
}

export interface Tap {
  id: string;
  // null on [Edit] and [Done], which write nothing. Otherwise the column this
  // tap sets.
  column: string | null;
  value: string | boolean | null;
  // The two write-nothing taps move the form in opposite directions and are
  // otherwise identical, so the action has to be carried rather than inferred.
  action: 'answer' | 'edit' | 'done';
}

/* ─── callback_data ────────────────────────────────────────────────────────
   `PID562780708|setup|Break & Retest` and `PID562780708|sl|1`, with
   `PID562780708|edit` for the reopen. Telegram caps callback_data at 64 bytes;
   the longest this can produce is 39, and a test measures it so a setup name
   added later cannot quietly cross the line.

   THIS IS THE BOUNDARY. Everything arriving here came off the wire, so the
   whitelists live in this function and the callers do no further checking. An
   unrecognised payload returns null rather than throwing: the webhook answers
   Telegram 200 regardless, because a 500 only buys the same bad payload again.
   ───────────────────────────────────────────────────────────────────────── */
export function parseCallback(data: string): Tap | null {
  const parts = data.split('|');
  const id = parts[0];
  if (!/^PID\d+$/.test(id)) return null;

  if (parts.length === 2) {
    if (parts[1] === 'edit') return { id, column: null, value: null, action: 'edit' };
    if (parts[1] === 'done') return { id, column: null, value: null, action: 'done' };
    return null;
  }
  if (parts.length !== 3) return null;

  const column = COLUMNS[parts[1]];
  if (!column) return null;

  if (parts[1] === 'setup') {
    return SETUPS.includes(parts[2]) ? { id, column, value: parts[2], action: 'answer' } : null;
  }
  if (parts[2] !== '0' && parts[2] !== '1') return null;
  return { id, column, value: parts[2] === '1', action: 'answer' };
}

/* ─── Rendering ────────────────────────────────────────────────────────────
   Plain text, no parse_mode. `Break & Retest` carries an ampersand and the
   setups are the one string in here that a person edits, so HTML or Markdown
   framing would buy a bold header at the price of an escaping bug the day a
   setup name gains a character. Nothing here needs weight.
   ───────────────────────────────────────────────────────────────────────── */

// Unanswered is an em dash, never a cross. null is a third state, and a message
// that drew it as "no" would teach the trader the opposite of what the column
// means.
const mark = (v: boolean | null) => v === null ? '—' : v ? '✓' : '✗';

// The New York clock, because that is the day the trade is filed under — shown
// as ET, since "NY" is the name of a session in this app and would read as one.
// The same 21:05 fill that nyDay keeps on its own day would read as tomorrow
// here if this used the UTC stamp.
// hourCycle, not hour12: the latter leaves the cycle to the locale and can
// resolve to h24, so a fill just after midnight ET would read "24:05". Same
// reason nyClock and Eugenia's nyStamp state it.
//
// NAMED FOR CARRYING THE DAY, because the app and Eugenia each have an `nyTime`
// and both return a bare HH:MM. A card can arrive about a fill from earlier, so
// this one needs the date — and a name shared with those two would invite the
// exact edit the first paragraph exists to prevent: the card losing its day,
// with nothing failing and the message still reading like a working time.
const nyDayTime = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

// Exported because two callers decide the redraw from it and they must not
// drift: staysOpen, for a tap, and the update trigger's half, for an answer
// written anywhere else.
export const answered = (row: Answers) =>
  row.setup !== null && row.followed_rules !== null &&
  row.followed_sl !== null && row.followed_tp !== null;

/* Whether the redraw keeps the full keyboard.

   [Edit] opens it and [Done] closes it, both explicitly. An answer is the case
   that has to be decided, and it is decided from the row as it stood BEFORE the
   tap: already complete means the trader is correcting a reopened message and
   it stays open, incomplete means this tap may be the fourth answer, and the
   fourth answer settles it.

   Before-state rather than the keyboard, because that is what the question is
   actually about — did this tap complete the journal, or amend a journal that
   was already complete. An earlier version inferred it from the incoming row
   count and was true on every tap, so the message never settled at all and the
   summary, the [Edit] button and readRow were unreachable in production.
   Exported because it is the decision that was wrong once. */
export const staysOpen = (tap: Tap, before: Row) =>
  tap.action === 'edit' || (tap.action === 'answer' && answered(before));

const yesNo = (id: string, field: string, label: string) => [
  { text: `${label} ✓`, callback_data: `${id}|${field}|1` },
  { text: `${label} ✗`, callback_data: `${id}|${field}|0` },
];

// One shape for both halves: the trigger path posts it, the tap path edits with
// it, and neither decides anything about presentation on its own.
export function renderMessage(row: Row, expanded: boolean) {
  const price = Number(row.entry_price).toFixed(2);

  if (answered(row) && !expanded) {
    // Two lines: the trade, then the verdict. SL and TP abbreviated here only —
    // the form spells them out, the summary is scanned.
    return {
      text: `Logged · ${row.direction} ${price} · ${row.setup}\n` +
            `rules ${mark(row.followed_rules)} · SL ${mark(row.followed_sl)}` +
            ` · TP ${mark(row.followed_tp)}`,
      reply_markup: { inline_keyboard: [[{ text: 'Edit', callback_data: `${row.id}|edit` }]] },
    };
  }

  return {
    text: [
      'Hola Jefe, new fill below',
      '',
      `${row.direction} ${price} · ${nyDayTime(row.entry_time)} ET`,
      '',
      `Setup: ${row.setup ?? '—'}`,
      `Rules: ${mark(row.followed_rules)}`,
      `Stop Loss: ${mark(row.followed_sl)}`,
      `Take Profit: ${mark(row.followed_tp)}`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        SETUPS.map(s => ({ text: s, callback_data: `${row.id}|setup|${s}` })),
        yesNo(row.id, 'rules', 'Rules'),
        yesNo(row.id, 'sl', 'Stop Loss'),
        yesNo(row.id, 'tp', 'Take Profit'),
        // Only once every answer is in. Before that the fourth answer settles
        // the form on its own, and a [Done] that collapsed an unfinished
        // journal would be a button for abandoning it.
        ...(answered(row) ? [[{ text: 'Done', callback_data: `${row.id}|done` }]] : []),
      ],
    },
  };
}

/* ─── Telegram and PostgREST ───────────────────────────────────────────── */

// Her token, bound once. Every call below is unchanged by the binding.
const tg = (method: string, body: unknown) => telegram(BOT_TOKEN, method, body);

// The columns renderMessage reads, and no more. The id needs no escaping on
// either path into these: a tap's is `PID\d+`, enforced by parseCallback before
// it gets here, and a trigger's is the row's own primary key.
const SELECT = "id,direction,entry_price,entry_time,setup,followed_rules,followed_sl,followed_tp";

async function readRow(id: string): Promise<Row> {
  const res = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&select=${SELECT}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Read failed (HTTP ${res.status}): ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`No such trade: ${id}`);
  return rows[0];
}

// return=representation, so the write and the read the redraw needs are one
// round trip rather than two. Two writers reach it: a tap's answer, and the
// message id Telegram has just handed back.
async function patchRow(id: string, fields: Record<string, unknown>): Promise<Row> {
  const res = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&select=${SELECT}`, {
    method: "PATCH", headers: sbHeaders("return=representation"),
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`Write failed (HTTP ${res.status}): ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`No such trade: ${id}`);
  return rows[0];
}

/* Redrawing, and the two ways it fails.

   A DOUBLE TAP sends the identical update twice. The second write is the same
   value, so the second edit asks Telegram to replace the message with what it
   already says and gets `400 message is not modified` — which is the correct
   outcome reported as an error. Treating it as fatal would turn a slightly
   twitchy thumb into a 500.

   ANY OTHER EDIT FAILURE falls back to a fresh message. This is also the
   answer if Telegram caps how long a bot may edit its own message: whether or
   not there is such a cap, a stale [Edit] tap produces a new message rather
   than silently doing nothing.

   Which is why this returns that replacement's id, and null when it drew
   nothing new. The id on the row is now pointing at a message that cannot be
   edited, so left alone every later answer would fail against the same dead
   message and post another fresh one beneath it. */
async function redraw(row: Row, chatId: number | string, messageId: number,
                      expanded: boolean): Promise<number | null> {
  const { text, reply_markup } = renderMessage(row, expanded);

  const edited = await tg("editMessageText",
    { chat_id: chatId, message_id: messageId, text, reply_markup });
  if (edited.ok) return null;
  if (String(edited.description ?? "").includes("message is not modified")) return null;

  console.error("doji-gladys: edit refused —", edited.description);
  const sent = await tg("sendMessage", { chat_id: chatId, text, reply_markup });
  return sent.ok ? sent.result.message_id as number : null;
}

/* ─── The trigger half: a position opened, or its answers moved ──────────── */

// Both triggers present the same secret and post the same eight columns, so
// the body is what says which fired: only the update names a message to edit
// and the answers it is replacing.
async function fromTrigger(req: Request): Promise<Response> {
  const fired = await req.json() as Fired;
  const { tg_message_id, before } = fired;

  return before && tg_message_id
    ? await postAnswer(fired, tg_message_id, before)
    : await postOpen(fired);
}

async function postOpen(row: Row): Promise<Response> {
  // false: the message opens on the full keyboard. A freshly inserted row has
  // all four answers null anyway, so this is what it would resolve to — but
  // stating it keeps the settled form a thing only a tap can produce.
  const { text, reply_markup } = renderMessage(row, false);

  // Telegram answers 200 with ok:false for a bad chat or a revoked token, so
  // the status alone proves nothing.
  const body = await tg("sendMessage", { chat_id: CHAT_ID, text, reply_markup });
  if (!body.ok) throw new Error(`sendMessage failed: ${body.description ?? "unknown"}`);

  // Recorded before the trader can possibly have answered anything, because a
  // message nothing can find again is one the app's own writes leave showing an
  // empty trade for good — which is the whole reason the column exists.
  await patchRow(row.id, { tg_message_id: body.result.message_id });

  return json({ ok: true, id: row.id });
}

/* An answer written outside Telegram — the app, or a hand-edit in the SQL
   editor. The message she posted is a snapshot of a row four writers can move,
   and nothing about that write reaches the trader unless it is redrawn.

   Same decision as a tap's, off the same input: the row as it stood before.
   A tap fires this trigger as well as redrawing itself, so both draw the
   identical message and Telegram answers the second `message is not modified`.
   Decide it any other way and the two fight, and the one that loses is a form
   that shuts under a correction. */
async function postAnswer(row: Row, messageId: number, before: Answers): Promise<Response> {
  const replaced = await redraw(row, CHAT_ID, messageId, answered(before));
  if (replaced) await patchRow(row.id, { tg_message_id: replaced });

  return json({ ok: true, id: row.id });
}

/* ─── The Telegram half: a button was tapped ─────────────────────────────── */

// EVERY PATH HERE ANSWERS 200, INCLUDING THE FAILURES — which is why the whole
// body is inside one try.
//
// Telegram redelivers an update it did not get a 2xx for, so a non-200 buys the
// same tap again — and again. That is worth having when a retry could succeed,
// and this is not that case: a write that failed leaves the message undrawn,
// the trader sees no change, and the natural retry is their own second tap. A
// redelivery loop against a misconfigured deploy fixes nothing and empties the
// rate limit. The console is where a failure is reported.
async function handleTap(req: Request): Promise<Response> {
  let cq: any;
  try {
    cq = (await req.json()).callback_query;
    // Anything else is a /start or a stray message. Acknowledged and dropped.
    if (!cq) return json({ ok: true, ignored: "not a callback_query" });

    // The secret proves the caller is Telegram. This proves the tap came from
    // the trader's own thread — anyone can find a bot and press its buttons if
    // a message ever reaches them.
    if (String(cq.message?.chat?.id) !== CHAT_ID) {
      console.error("doji-gladys: callback from unexpected chat");
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return json({ ok: true, ignored: "wrong chat" });
    }

    const tap = parseCallback(cq.data ?? "");
    if (!tap) {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return json({ ok: true, ignored: "unrecognised callback_data" });
    }

    // Read before write, because staysOpen needs the row as it was. Two
    // PostgREST calls rather than one, and the reason is worth the round trip:
    // without the before-state the message can never settle.
    const before = await readRow(tap.id);
    const row = tap.column
      ? await patchRow(tap.id, { [tap.column]: tap.value })
      : before;

    // Answered after the write, so a failure reaches the trader as an alert
    // instead of a tap that looked accepted. Two PostgREST calls are nowhere
    // near the ~15s Telegram gives before it abandons the spinner itself.
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    const replaced = await redraw(row, cq.message.chat.id, cq.message.message_id,
                                  staysOpen(tap, before));
    if (replaced) await patchRow(tap.id, { tg_message_id: replaced });
    return json({ ok: true, id: tap.id, column: tap.column });
  } catch (err) {
    console.error("doji-gladys:", err instanceof Error ? err.message : err);
    // Best effort, and guarded: telling the trader the tap failed must not
    // itself turn a 200 into a redelivery loop.
    if (cq?.id) {
      await tg("answerCallbackQuery",
        { callback_query_id: cq.id, text: "Not saved — try again.", show_alert: true })
        .catch(() => {});
    }
    return json({ ok: false, error: "tap failed" });
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing — the file loads under plain
// Node, where Deno.serve does not exist.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  // AUTHORISATION FIRST, BEFORE ANYTHING ELSE, AND THE HEADER ALSO PICKS THE
  // HALF. A caller presenting neither secret is told nothing beyond "no".
  const fromTelegram = req.headers.get("x-telegram-bot-api-secret-token");
  const fromDatabase = req.headers.get("x-doji-key");

  if (!BOT_TOKEN || !CHAT_ID || !WEBHOOK_SECRET || !CRON_SECRET || !SB_KEY) {
    console.error("doji-gladys: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }

  try {
    if (secretMatches(fromTelegram, WEBHOOK_SECRET)) {
      return await handleTap(req);
    }
    if (secretMatches(fromDatabase, CRON_SECRET)) {
      return await fromTrigger(req);
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  } catch (err) {
    // pg_net discards the response, exactly as pg_cron does for the poller, so
    // this line is the only place a trigger-side failure is ever reported. The
    // journal is unharmed either way — the row is written and committed before
    // either trigger runs, and what is lost is a prompt, or a message left
    // saying what it said before.
    console.error("doji-gladys:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
