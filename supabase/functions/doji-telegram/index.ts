// ═══════════════════════════════════════════════════════════════════════════
// DOJI — Telegram journal  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// One function, two callers, told apart by which secret they present:
//
//   x-doji-key                        the after-insert trigger in
//                                     supabase/002_telegram.sql — a position
//                                     opened, post the message.
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
// THE MESSAGE IS THE STATE, WITH ONE EXCEPTION. There is no session table and
// no stored message id, because there is nothing to store: callback_data
// carries the trade, the field and the value, and Telegram's callback carries
// the chat and message ids that editMessageText needs. A tap is
// self-describing, so a redeploy in the middle of answering costs nothing.
//
// The exception is whether a redraw should settle, which comes from the row as
// it stood BEFORE the tap rather than from anything on the message. See
// staysOpen.
//
// SECURITY CONTRACT
//   1. Deployed with verify_jwt = false — Telegram calls it unauthenticated and
//      cannot be taught to present a JWT, so authorisation happens here, in
//      code, before any work begins. Same arrangement as doji-mcp-sync.
//   2. Each half checks its own secret, and an unset secret refuses rather than
//      admits. The trigger presents DOJI_CRON_SECRET — the secret the pg_cron
//      poller job already reads from Vault, whose authority is still only
//      "start work that was going to happen anyway".
//   3. The chat is checked as well as the secret. The header proves the caller
//      is Telegram; the chat id proves the tap came from the trader's own
//      thread.
//   4. Nothing from a request reaches the database untranslated. parseCallback
//      whitelists the field and the value, so a write can only ever name one of
//      four columns.
//
// Deploy:   supabase functions deploy doji-telegram --no-verify-jwt
// Register: setWebhook with secret_token = TELEGRAM_WEBHOOK_SECRET
// Secrets:  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET,
//           DOJI_CRON_SECRET, SUPABASE_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════

// Every Deno touch goes through here, so the module imports under plain Node
// and test/fold.test.mjs can reach the pure exports below. The Deno.serve at
// the bottom is guarded for the same reason.
const env = (k: string): string => (globalThis as any).Deno?.env?.get(k) ?? "";

const BOT_TOKEN      = env("TELEGRAM_BOT_TOKEN");
// Numeric, not an @name. This value is both a sendMessage target and the
// identity a tap's chat id is compared against, and only the numeric form
// satisfies both — an @name posts messages fine and then drops every tap.
const CHAT_ID        = env("TELEGRAM_CHAT_ID");
const WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET");
const CRON_SECRET    = env("DOJI_CRON_SECRET");

const SB_URL = env("SUPABASE_URL");
const SB_KEY = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
// Legacy keys are JWTs and PostgREST accepts them on Authorization: Bearer. The
// new sb_secret_ keys are opaque and belong on apikey only. Same detection as
// doji-mcp-sync, so one code path works before and after legacy keys go.
const IS_JWT = SB_KEY.startsWith("eyJ");

/* ─── The journal vocabulary ───────────────────────────────────────────────
   Identical to CONFIG.SETUPS in index.html and to the trades_setup_check
   constraint. Three copies of one list, and the constraint is the one that
   cannot be bypassed — a value that gets past the check below still has to
   satisfy Postgres.
   ───────────────────────────────────────────────────────────────────────── */
export const SETUPS: readonly string[] = ['Break & Retest', 'Support & Resistance'];

// callback_data field → column. This map is the entire reason a tap cannot
// disturb broker data.
const COLUMNS: Record<string, string> = {
  setup: 'setup',
  rules: 'followed_rules',
  sl:    'followed_sl',
  tp:    'followed_tp',
};

export interface Row {
  id: string;
  direction: string;
  entry_price: number;
  entry_time: string;
  setup: string | null;
  followed_rules: boolean | null;
  followed_sl: boolean | null;
  followed_tp: boolean | null;
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

// The New York clock, because that is the day the trade is filed under. The
// same 21:05 fill that nyDay keeps on its own day would read as tomorrow here
// if this used the UTC stamp.
const nyTime = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));

const answered = (row: Row) =>
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
      `${row.direction} ${price} · ${nyTime(row.entry_time)} NY`,
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

/* ─── Inbound authorisation ────────────────────────────────────────────────
   Length-independent comparison, the same one doji-mcp-sync makes on its own
   header. A plain !== leaks the expected secret's length through timing, which
   is free to avoid.

   Its own copy rather than an import: doji-mcp-sync calls Deno.serve at module
   scope, so importing that file from here would start a second poller inside
   this function.
   ───────────────────────────────────────────────────────────────────────── */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!expected || !presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/* ─── Telegram and PostgREST ───────────────────────────────────────────── */

const tg = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json());

const sbHeaders = (prefer?: string) => {
  const headers: Record<string, string> = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (IS_JWT) headers.Authorization = `Bearer ${SB_KEY}`;
  if (prefer) headers.Prefer = prefer;
  return headers;
};

// The columns renderMessage reads, and no more. The id is `PID\d+` — enforced
// by parseCallback before either of these is reached — so it needs no escaping.
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
// round trip rather than two.
async function writeAnswer(id: string, column: string, value: string | boolean): Promise<Row> {
  const res = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&select=${SELECT}`, {
    method: "PATCH", headers: sbHeaders("return=representation"),
    body: JSON.stringify({ [column]: value }),
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
   than silently doing nothing. */
async function redraw(row: Row, chatId: number, messageId: number, expanded: boolean) {
  const { text, reply_markup } = renderMessage(row, expanded);

  const edited = await tg("editMessageText",
    { chat_id: chatId, message_id: messageId, text, reply_markup });
  if (edited.ok) return;
  if (String(edited.description ?? "").includes("message is not modified")) return;

  console.error("doji-telegram: edit refused —", edited.description);
  await tg("sendMessage", { chat_id: chatId, text, reply_markup });
}

/* ─── The trigger half: a position opened ────────────────────────────────── */

async function postOpen(req: Request): Promise<Response> {
  const row = await req.json() as Row;

  // false: the message opens on the full keyboard. A freshly inserted row has
  // all four answers null anyway, so this is what it would resolve to — but
  // stating it keeps the settled form a thing only a tap can produce.
  const { text, reply_markup } = renderMessage(row, false);

  // Telegram answers 200 with ok:false for a bad chat or a revoked token, so
  // the status alone proves nothing.
  const body = await tg("sendMessage", { chat_id: CHAT_ID, text, reply_markup });
  if (!body.ok) throw new Error(`sendMessage failed: ${body.description ?? "unknown"}`);

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
      console.error("doji-telegram: callback from unexpected chat");
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
      ? await writeAnswer(tap.id, tap.column, tap.value as string | boolean)
      : before;

    // Answered after the write, so a failure reaches the trader as an alert
    // instead of a tap that looked accepted. Two PostgREST calls are nowhere
    // near the ~15s Telegram gives before it abandons the spinner itself.
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    await redraw(row, cq.message.chat.id, cq.message.message_id, staysOpen(tap, before));
    return json({ ok: true, id: tap.id, column: tap.column });
  } catch (err) {
    console.error("doji-telegram:", err instanceof Error ? err.message : err);
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
  const fromTrigger  = req.headers.get("x-doji-key");

  if (!BOT_TOKEN || !CHAT_ID || !WEBHOOK_SECRET || !CRON_SECRET || !SB_KEY) {
    console.error("doji-telegram: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }

  try {
    if (fromTelegram !== null && secretMatches(fromTelegram, WEBHOOK_SECRET)) {
      return await handleTap(req);
    }
    if (fromTrigger !== null && secretMatches(fromTrigger, CRON_SECRET)) {
      return await postOpen(req);
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  } catch (err) {
    // pg_net discards the response, exactly as pg_cron does for the poller, so
    // this line is the only place a trigger-side failure is ever reported. The
    // trade is journalled from the app in the meantime; nothing is lost but the
    // prompt.
    console.error("doji-telegram:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
