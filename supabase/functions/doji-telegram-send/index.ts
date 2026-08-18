// ═══════════════════════════════════════════════════════════════════════════
// DOJI — Telegram journal, send  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// Called by the after-insert trigger in supabase/002_telegram.sql when the
// poller mints a row from an entry deal. Posts one message carrying the four
// journal questions, and stops. There is no second message at close: all four
// answers are asked at open, and a correction goes through the message's own
// Edit button.
//
// It reads nothing and writes nothing. The trigger already has the row and
// sends it in the body, so this function's whole job is Telegram's side of the
// wire. Everything it decides — what the message says, what the buttons carry —
// lives in ../_shared/telegram.ts, where a test can reach it.
//
// SECURITY CONTRACT
//   1. Deployed with verify_jwt = false, so authorisation happens here, in
//      code, before any work begins — the same arrangement as doji-mcp-sync and
//      for the same reason.
//   2. The caller presents DOJI_CRON_SECRET on x-doji-key. That secret already
//      exists, is already read from Vault at call time, and its authority is
//      still only "start work that was going to happen anyway". The service key
//      stays out of the trigger text, which is the whole point.
//   3. TELEGRAM_BOT_TOKEN lives only in Deno.env — never logged, never
//      returned, never written to the database.
//
// Deploy:  supabase functions deploy doji-telegram-send --no-verify-jwt
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DOJI_CRON_SECRET
// ═══════════════════════════════════════════════════════════════════════════
import { renderMessage, secretMatches, type Row } from "../_shared/telegram.ts";

const env = (k: string): string => (globalThis as any).Deno?.env?.get(k) ?? "";

const BOT_TOKEN   = env("TELEGRAM_BOT_TOKEN");
const CHAT_ID     = env("TELEGRAM_CHAT_ID");
const CRON_SECRET = env("DOJI_CRON_SECRET");

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  // AUTHORISATION FIRST, BEFORE ANYTHING ELSE. A missing secret is a hard
  // failure, never an open door.
  if (!CRON_SECRET) {
    console.error("doji-telegram-send: DOJI_CRON_SECRET not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-doji-key"), CRON_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
    if (!CHAT_ID)   throw new Error("TELEGRAM_CHAT_ID not set");

    const row = await req.json() as Row;

    // false: the message opens on the full keyboard. A freshly inserted row has
    // all four answers null anyway, so this is what it would resolve to — but
    // stating it keeps the settled form a thing only the webhook can produce.
    const { text, reply_markup } = renderMessage(row, false);

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, reply_markup }),
    });
    // Telegram answers 200 with ok:false for a bad chat or a revoked token, so
    // the status alone proves nothing.
    const body = await res.json();
    if (!body.ok) throw new Error(`sendMessage failed: ${body.description ?? res.status}`);

    return json({ ok: true, id: row.id });
  } catch (err) {
    // pg_net discards the response, exactly as pg_cron does for the poller, so
    // this line is the only place a failure is ever reported. The trade is
    // journalled from the app in the meantime; nothing is lost but the prompt.
    console.error("doji-telegram-send:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
