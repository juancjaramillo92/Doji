// ═══════════════════════════════════════════════════════════════════════════
// GLADYS — the journal bot  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// One function, three callers, told apart by the secret they present:
//
//   x-doji-key                        its triggers — a position opened, post
//                                     the message; its answers moved, redraw it.
//   x-telegram-bot-api-secret-token   Telegram — a button was tapped, write the
//                                     column and redraw the message.
//   x-laptop-key                      Eugenia's laptop — what waits for its
//                                     journal, and an answer given on it.
//
// One file, because the halves share the keyboard, the message and the
// callback_data grammar. A tap names its column through COLUMNS, the same four
// names as Data.OWNED, so no broker column is reachable from a button. A tap
// carries its whole state in callback_data, so the tap path holds no session.
// An answer written in the app or on the laptop has none of
// that, so the message id is kept on the row, in tg_message_id — on neither
// list, so nothing else can name it.
//
// Whether a redraw settles the form is decided from the row as it stood BEFORE
// the write (staysOpen), so the tap and the trigger it fires draw the same
// message and the second edit is a no-op.
//
// SECURITY CONTRACT
//   1. verify_jwt = false: Telegram cannot present a JWT, so authorisation is
//      here, before any work.
//   2. Each caller checks its own secret; an unset secret refuses. The trigger's
//      DOJI_CRON_SECRET can put text into his thread — postOpen renders the
//      body — but never names a column.
//   3. The chat is checked as well: the header proves Telegram, the chat id
//      proves his thread.
//   4. parseCallback whitelists field and value, so a write names one of four
//      columns.
//
// Deploy:   supabase functions deploy doji-gladys --no-verify-jwt
// Register: setWebhook with secret_token = GLADYS_WEBHOOK_SECRET and
//           allowed_updates = ["callback_query"] — a tap is her whole
//           vocabulary.
// Secrets:  GLADYS_BOT_TOKEN, TELEGRAM_CHAT_ID, GLADYS_WEBHOOK_SECRET,
//           DOJI_CRON_SECRET, SB_SECRET_KEY; GLADYS_LAPTOP_SECRET,
//           optional — unset, the laptop's door is shut
// ═══════════════════════════════════════════════════════════════════════════

import {
  env, secretMatches, json, telegram, sbHeaders, SB_URL, SB_KEY, why
} from "../_shared/edge.ts";

const BOT_TOKEN      = env("GLADYS_BOT_TOKEN");
// Numeric, not an @name: it is both a send target and the identity a tap is
// checked against, and an @name posts fine and drops every tap. The one secret
// the two bots share.
const CHAT_ID        = env("TELEGRAM_CHAT_ID");
const WEBHOOK_SECRET = env("GLADYS_WEBHOOK_SECRET");
const CRON_SECRET    = env("DOJI_CRON_SECRET");
const LAPTOP_SECRET  = env("GLADYS_LAPTOP_SECRET");

/* ─── The journal vocabulary ───────────────────────────────────────────────
   One of four copies — CONFIG.SETUPS, trades_setup_check and the laptop's
   are the others — and agree.test.mjs reads all four.
   ───────────────────────────────────────────────────────────────────────── */
export const SETUPS: readonly string[] = ['Break & Retest', 'Support & Resistance'];

// callback_data field → column: the same four names as Data.OWNED and nothing
// else. agree.test.mjs holds the two lists together.
export const COLUMNS: Record<string, string> = {
  setup: 'setup',
  rules: 'followed_rules',
  sl:    'followed_sl',
  tp:    'followed_tp',
};

// The input to whether a redraw settles the form.
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

// What a trigger posts. Only an update carries the message and the
// before-state, and their absence is what marks an insert.
interface Fired extends Row {
  tg_message_id?: number;
  before?: Answers;
}

export interface Tap {
  id: string;
  // null on [Edit] and [Done], which write nothing.
  column: string | null;
  value: string | boolean | null;
  // Carried, because [Edit] and [Done] differ only in direction.
  action: 'answer' | 'edit' | 'done';
}

/* ─── callback_data ────────────────────────────────────────────────────────
   `PID562780708|setup|Break & Retest`, `PID562780708|sl|1`, `PID562780708|edit`.
   Telegram caps it at 64 bytes; the longest here is 39, and a test measures it.

   The boundary: the whitelists live here. Unrecognised returns null rather than
   throwing, and the webhook answers 200 regardless, since a 500 only buys the
   same payload again.
   ───────────────────────────────────────────────────────────────────────── */
export function parseCallback(data: string): Tap | null {
  const parts = data.split('|');
  const id = parts[0];
  if (!/^PID\d+$/.test(id)) return null;

  if (parts.length === 2) {
    const action = parts[1];
    return action === 'edit' || action === 'done' ? { id, column: null, value: null, action } : null;
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
   Plain text, no parse_mode: `Break & Retest` carries an ampersand, and the
   setups are the one string a person edits.
   ───────────────────────────────────────────────────────────────────────── */

// Unanswered is an em dash: null is a third state, never "no".
const mark = (v: boolean | null) => v === null ? '—' : v ? '✓' : '✗';

// The New York clock, the day the trade is filed under, labelled ET since "NY"
// is a session name here. h23, or midnight can read "24:05". Named for carrying
// the day, unlike doji-eugenia's bare-HH:MM nyTime: a card can be about an
// earlier fill, and must not lose its date.
const nyDayTime = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

// Shared by staysOpen and the trigger's redraw, which must not drift.
export const answered = (row: Answers) =>
  row.setup !== null && row.followed_rules !== null &&
  row.followed_sl !== null && row.followed_tp !== null;

/* Whether the redraw keeps the full keyboard. [Edit] opens and [Done] closes;
   an answer is decided from the row BEFORE the tap — already complete means a
   correction to a reopened form, and it stays open; otherwise this may be the
   fourth answer, which settles it. Never from the keyboard: an open form and a
   reopened one both draw four rows, and reading that was a form that could
   never settle. */
export const staysOpen = (tap: Tap, before: Row) =>
  tap.action === 'edit' || (tap.action === 'answer' && answered(before));

const yesNo = (id: string, field: string, label: string) => [
  { text: `${label} ✓`, callback_data: `${id}|${field}|1` },
  { text: `${label} ✗`, callback_data: `${id}|${field}|0` },
];

// One shape for both halves.
export function renderMessage(row: Row, expanded: boolean) {
  const price = Number(row.entry_price).toFixed(2);

  if (answered(row) && !expanded) {
    // SL and TP abbreviated only here: the summary is scanned.
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
        // Only once complete: before that, [Done] would abandon the journal.
        ...(answered(row) ? [[{ text: 'Done', callback_data: `${row.id}|done` }]] : []),
      ],
    },
  };
}

/* ─── Telegram and PostgREST ───────────────────────────────────────────── */

const tg = (method: string, body: unknown) => telegram(BOT_TOKEN, method, body);

// The columns renderMessage reads. The id needs no escaping: a tap's is
// `PID\d+` by parseCallback, a trigger's the row's own key.
const SELECT = "id,direction,entry_price,entry_time,setup,followed_rules,followed_sl,followed_tp";

async function readRow(id: string): Promise<Row> {
  const res = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&select=${SELECT}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Read failed (HTTP ${res.status}): ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`No such trade: ${id}`);
  return rows[0];
}

// return=representation: the write and the redraw's read in one round trip.
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

/* Redrawing. A double tap writes the same value twice, and the second edit
   comes back `message is not modified` — the correct outcome, not a failure.
   Any other refused edit posts a fresh message, and returns its id so the row
   stops pointing at one that cannot be edited. */
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

// Both triggers present the same secret; the body says which fired.
async function fromTrigger(req: Request): Promise<Response> {
  const fired = await req.json() as Fired;
  const { tg_message_id, before } = fired;

  return before && tg_message_id
    ? await postAnswer(fired, tg_message_id, before)
    : await postOpen(fired);
}

async function postOpen(row: Row): Promise<Response> {
  // Opens on the full keyboard; only a tap produces the settled form.
  const { text, reply_markup } = renderMessage(row, false);

  // Telegram answers 200 with ok:false for a bad chat or a revoked token.
  const body = await tg("sendMessage", { chat_id: CHAT_ID, text, reply_markup });
  if (!body.ok) throw new Error(`sendMessage failed: ${body.description ?? "unknown"}`);

  // Recorded at once, or an answer from anywhere else has no message to redraw.
  await patchRow(row.id, { tg_message_id: body.result.message_id });

  return json({ ok: true, id: row.id });
}

/* An answer written outside Telegram — the app, the laptop or the SQL
   editor. Decided off the before-state, as a tap is, so the redraw a tap's
   own trigger sets off agrees with the tap's and comes back `message is not
   modified`. Decided any
   other way, a reopened form shuts under the correction being made in it. */
async function postAnswer(row: Row, messageId: number, before: Answers): Promise<Response> {
  const replaced = await redraw(row, CHAT_ID, messageId, answered(before));
  if (replaced) await patchRow(row.id, { tg_message_id: replaced });

  return json({ ok: true, id: row.id });
}

/* ─── The Telegram half: a button was tapped ─────────────────────────────── */

// Every path answers 200, failures included. Telegram redelivers anything
// without a 2xx, and a failed write is better retried by his own second tap
// than by a redelivery loop against a broken deploy. The console reports it.
async function handleTap(req: Request): Promise<Response> {
  let cq: any;
  try {
    cq = (await req.json()).callback_query;
    // A /start or a stray message.
    if (!cq) return json({ ok: true, ignored: "not a callback_query" });

    // The secret proves Telegram; this proves his own thread.
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

    // Read before write: staysOpen needs the row as it was.
    const before = await readRow(tap.id);
    const row = tap.column
      ? await patchRow(tap.id, { [tap.column]: tap.value })
      : before;

    // Answered after the write, so a failure reaches him as an alert rather
    // than as a tap that looked accepted.
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    const replaced = await redraw(row, cq.message.chat.id, cq.message.message_id,
                                  staysOpen(tap, before));
    if (replaced) await patchRow(tap.id, { tg_message_id: replaced });
    return json({ ok: true, id: tap.id, column: tap.column });
  } catch (err) {
    console.error("doji-gladys:", why(err));
    // Guarded: reporting the failure must not cause a redelivery loop.
    if (cq?.id) {
      await tg("answerCallbackQuery",
        { callback_query_id: cq.id, text: "Not saved — try again.", show_alert: true })
        .catch(() => {});
    }
    return json({ ok: false, error: "tap failed" });
  }
}

/* ─── The laptop half: he journals beside her face ────────────────────────
   The laptop asks every few minutes what waits, and shows a ring while
   anything does. An answer from it is a tap in a tap's own grammar, so
   parseCallback is the one boundary for both and no other column is reachable.
   The trigger then redraws the Telegram message, as it does for the app.
   ───────────────────────────────────────────────────────────────────────── */

/* A week back, oldest first, so trades are journalled in the order he took
   them. The week is the bound: a trade left unjournalled would otherwise keep
   her ring lit for ever. Newest first under the limit, then reversed. */
const WAITING_DAYS = 7;
const WAITING_MAX = 20;

async function waiting(): Promise<Response> {
  const since = new Date(Date.now() - WAITING_DAYS * 86_400_000).toISOString();
  const res = await fetch(`${SB_URL}/rest/v1/trades?select=${SELECT}&deleted=is.false` +
    `&entry_time=gte.${encodeURIComponent(since)}` +
    `&or=(setup.is.null,followed_rules.is.null,followed_sl.is.null,followed_tp.is.null)` +
    `&order=entry_time.desc&limit=${WAITING_MAX}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Read failed (HTTP ${res.status}): ${await res.text()}`);
  const rows: Row[] = (await res.json()).reverse();
  return json({ ok: true, waiting: rows.length, trade: rows[0] ?? null });
}

// Answers only: [Edit] and [Done] belong to the Telegram form. Answered with
// what waits after it, so the laptop moves on without a second request.
async function laptopAnswer(req: Request): Promise<Response> {
  const tap = parseCallback(String((await req.json().catch(() => null))?.data ?? ""));
  if (!tap || tap.action !== 'answer' || !tap.column) {
    return json({ ok: false, error: "not an answer" }, 400);
  }
  await patchRow(tap.id, { [tap.column]: tap.value });
  return await waiting();
}

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  // Authorisation first, and the header picks the half.
  const fromTelegram = req.headers.get("x-telegram-bot-api-secret-token");
  const fromDatabase = req.headers.get("x-doji-key");
  const fromLaptop   = req.headers.get("x-laptop-key");

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
    if (secretMatches(fromLaptop, LAPTOP_SECRET)) {
      return req.method === "POST" ? await laptopAnswer(req) : await waiting();
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  } catch (err) {
    // pg_net discards the response, so this line is the only report. The
    // journal row is committed before either trigger runs.
    console.error("doji-gladys:", why(err));
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
