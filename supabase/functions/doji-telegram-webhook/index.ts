// ═══════════════════════════════════════════════════════════════════════════
// DOJI — Telegram journal, webhook  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// Telegram calls this when a button on the message is tapped. It writes the one
// column that tap names and redraws the message in place, so a trade is one
// thread entry rather than five.
//
// THE FOURTH WRITER, AND IT STAYS INSIDE THE JOURNAL HALF. The column comes
// from the map in ../_shared/telegram.ts, which holds the same four names as
// Data.OWNED in index.html and nothing else. No broker column is nameable from
// a button, so there is nothing to arbitrate with the poller or the email
// parser. The write moves updated_at, and the realtime subscription the app
// already holds re-renders any open tab for free.
//
// SECURITY CONTRACT
//   1. Deployed with verify_jwt = false, because Telegram calls it
//      unauthenticated and cannot be taught to present a JWT. Authorisation is
//      the X-Telegram-Bot-Api-Secret-Token header, registered with setWebhook
//      and checked here before any work begins.
//   2. The chat is checked as well as the secret. The header proves the caller
//      is Telegram; the chat id proves the tap came from the trader's own
//      thread and not from anyone else who found the bot.
//   3. Nothing from the request reaches the database untranslated. parseCallback
//      whitelists the field and the value, so the PATCH can only ever name one
//      of four columns.
//
// Deploy:   supabase functions deploy doji-telegram-webhook --no-verify-jwt
// Register: setWebhook with secret_token = TELEGRAM_WEBHOOK_SECRET
// Secrets:  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET,
//           SUPABASE_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { parseCallback, renderMessage, secretMatches, type Row } from "../_shared/telegram.ts";

const env = (k: string): string => (globalThis as any).Deno?.env?.get(k) ?? "";

const BOT_TOKEN      = env("TELEGRAM_BOT_TOKEN");
const CHAT_ID        = env("TELEGRAM_CHAT_ID");
const WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET");

const SB_URL = env("SUPABASE_URL");
const SB_KEY = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
// Legacy keys are JWTs and PostgREST accepts them on Authorization: Bearer. The
// new sb_secret_ keys are opaque and belong on apikey only. Same detection as
// doji-mcp-sync, so one code path works before and after legacy keys go.
const IS_JWT = SB_KEY.startsWith("eyJ");

const sbHeaders = (prefer?: string) => {
  const headers: Record<string, string> = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (IS_JWT) headers.Authorization = `Bearer ${SB_KEY}`;
  if (prefer) headers.Prefer = prefer;
  return headers;
};

const tg = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json());

// The columns renderMessage reads, and no more. The id is `PID\d+` — enforced
// by parseCallback before this is reached — so it needs no escaping.
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

  console.error("doji-telegram-webhook: edit refused —", edited.description);
  await tg("sendMessage", { chat_id: chatId, text, reply_markup });
}

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  if (!WEBHOOK_SECRET) {
    console.error("doji-telegram-webhook: TELEGRAM_WEBHOOK_SECRET not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), WEBHOOK_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  // Answering every tap "wrong chat" because CHAT_ID is unset is the failure
  // shape hardest to notice — it looks exactly like a bot nobody is pressing.
  if (!BOT_TOKEN || !CHAT_ID || !SB_KEY) {
    console.error("doji-telegram-webhook: bot token, chat id or Supabase key not set");
    return json({ ok: false, error: "not configured" }, 503);
  }

  // EVERY PATH BELOW ANSWERS 200, INCLUDING THE FAILURES.
  //
  // Telegram redelivers an update it did not get a 2xx for, so a non-200 buys
  // the same tap again — and again. That is worth having when a retry could
  // succeed, and this is not that case: a write that failed leaves the message
  // undrawn, the trader sees no change, and the natural retry is their own
  // second tap. A redelivery loop against a misconfigured deploy fixes nothing
  // and empties the rate limit. The console is where a failure is reported.
  try {
    const cq = (await req.json()).callback_query;
    // Anything else is a /start or a stray message. Acknowledged and dropped.
    if (!cq) return json({ ok: true, ignored: "not a callback_query" });

    // The secret proves the caller is Telegram. This proves the tap came from
    // the trader's own thread — anyone can find a bot and press its buttons if
    // a message ever reaches them.
    if (String(cq.message?.chat?.id) !== CHAT_ID) {
      console.error("doji-telegram-webhook: callback from unexpected chat");
      return json({ ok: true, ignored: "wrong chat" });
    }

    const tap = parseCallback(cq.data ?? "");
    if (!tap) {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return json({ ok: true, ignored: "unrecognised callback_data" });
    }

    // The write comes BEFORE the callback is answered, so the answer can carry
    // the failure. It is one PostgREST call — nowhere near the ~15s Telegram
    // gives before it gives up on the spinner itself — and the alternative is
    // answering "done" to a tap that was not recorded.
    let row: Row;
    try {
      row = tap.column
        ? await writeAnswer(tap.id, tap.column, tap.value as string | boolean)
        : await readRow(tap.id);
    } catch (err) {
      console.error("doji-telegram-webhook:", err instanceof Error ? err.message : err);
      await tg("answerCallbackQuery",
        { callback_query_id: cq.id, text: "Not saved — try again.", show_alert: true });
      return json({ ok: false, error: "write failed" });
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id });

    // [Edit] forces the full keyboard back. Otherwise the form stays as it was
    // drawn: four rows while it is open, one row once it has settled — so a
    // correction to two fields does not need [Edit] pressed twice.
    const expanded = tap.column === null ||
      (cq.message.reply_markup?.inline_keyboard?.length ?? 0) > 1;

    await redraw(row, cq.message.chat.id, cq.message.message_id, expanded);
    return json({ ok: true, id: tap.id, column: tap.column });
  } catch (err) {
    console.error("doji-telegram-webhook:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" });
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
