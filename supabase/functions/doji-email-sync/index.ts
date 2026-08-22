// ═══════════════════════════════════════════════════════════════════════════
// DOJI — email fill  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// One caller: the Apps Script in doji_gmail_sync.gs. It reads cTrader's TP/SL
// alerts out of Gmail, parses the fill, and posts the result here. This writes
// it.
//
// THE WRITE IS HERE BECAUSE OF WHERE THE ALTERNATIVE PUT A PASSWORD. Supabase's
// sb_secret_ keys refuse any client whose user agent looks like a browser, and
// Apps Script's does with no way to change it. The obvious alternative is for
// the script to sign in as the trader, which puts the account password in
// Script Properties — but that constraint is about who may write, not about
// where the write happens. Doing it here leaves the parser holding one secret
// whose entire authority is the five columns below, instead of the account.
//
// It also means every write to `trades` that is not the app's now happens in a
// runtime deployed from main, and the "only these columns" guarantee is a
// tested function rather than a loop in a file nobody can run.
//
// EMAIL-OWNED COLUMNS ONLY, and the projection happens here rather than in the
// caller. PostgREST's merge-duplicates sets exactly the keys present in the
// payload, so entry_time, entry_price, exit_price, commission, open_day,
// computed_pnl, setup, the three discipline answers and `deleted` are never
// named and therefore cannot be touched. `balance` is named, and the poller
// yields it: it writes that column only `where balance is null`, because the
// figure here is the one the broker itself printed on the fill.
//
// SECURITY CONTRACT
//   1. Every request must present DOJI_EMAIL_SECRET on the x-doji-key header.
//      Its own secret, not the cron secret the other three share — this is the
//      only one that lives outside the trader's own infrastructure, so it opens
//      the narrowest door there is: five columns of one table.
//   2. The body is read, and it is the only function here that reads one. It is
//      therefore whitelisted, shape-checked and type-checked by emailRow before
//      a single value reaches a request — see the note there.
//   3. user_id is supplied from secrets, never from the body.
//
// Deploy:  supabase functions deploy doji-email-sync --no-verify-jwt
// Secrets: DOJI_EMAIL_SECRET, DOJI_USER_ID, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { env, secretMatches, json, sbHeaders, SB_URL, SB_KEY } from "../_shared/edge.ts";

const EMAIL_SECRET = env("DOJI_EMAIL_SECRET");

// `trades.user_id` is NOT NULL and defaults to auth.uid(), which is null under
// the service role. The email is often the FIRST writer to reach a position the
// poller never folded, so this row may be an INSERT rather than an UPDATE and
// the owner has to be supplied — the same reason doji-mcp-sync needs it.
const USER_ID = env("DOJI_USER_ID");

/* ─── The boundary ─────────────────────────────────────────────────────────
   Everything below arrived over the wire, so nothing above it is trusted.

   The four columns and their shapes, stated once:

     id          `PID` + digits, exactly as foldPosition mints it. Unprefixed,
                 the same position would land on a second row.
     direction   BUY or SELL, and it is the POSITION side. Written by the poller
                 too, so a wrong value here is repaired within two minutes for
                 anything the poller can see and is permanent for anything it
                 cannot.
     fill_time   the closing instant. The app's filing-day fallback for a row
                 with no open_day, so a value that does not parse would move a
                 trade's calendar day rather than fail.
     net_pnl     the broker's settled figure, including swap. The one number
                 nothing else in this system can supply.
     balance     the account after the fill.

   A MISSING VALUE IS DROPPED, NOT SENT AS NULL. merge-duplicates writes exactly
   the keys present, so `direction: null` would erase a correct direction rather
   than leave it alone. That is why this builds a payload rather than filtering
   one — an absent key and a null key mean opposite things here.

   Refusals carry a reason, because the only thing that ever reads them is a log
   in the Apps Script editor and "400" on its own sends you nowhere.
   ───────────────────────────────────────────────────────────────────────── */
export type Fill = { row: Record<string, unknown> } | { error: string };

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export function emailRow(input: unknown, userId: string): Fill {
  if (!input || typeof input !== "object") return { error: "body is not an object" };
  const b = input as Record<string, unknown>;

  if (typeof b.id !== "string" || !/^PID\d+$/.test(b.id)) return { error: "id is not PID<digits>" };
  if (b.direction !== "BUY" && b.direction !== "SELL") return { error: "direction is not BUY or SELL" };
  if (typeof b.fill_time !== "string" || Number.isNaN(Date.parse(b.fill_time))) {
    return { error: "fill_time is not a parseable instant" };
  }

  const row: Record<string, unknown> = {
    id: b.id,
    user_id: userId,
    direction: b.direction,
    fill_time: b.fill_time,
  };

  // Optional, and each refused rather than coerced: a P&L arriving as the
  // string "57.10" would be stored by PostgREST and read back as a number,
  // which is the kind of thing that works until the day it does not.
  for (const k of ["net_pnl", "balance"] as const) {
    if (b[k] === undefined || b[k] === null) continue;
    if (!finite(b[k])) return { error: `${k} is not a finite number` };
    row[k] = b[k];
  }

  return { row };
}

/* Returns the response rather than throwing, because the STATUS is the answer
   the caller needs. Postgres refuses a row for reasons that will never change —
   a user_id that is not a real user, a direction the check constraint rejects —
   and PostgREST reports those as 4xx. Collapsing them into a 500 tells the Apps
   Script to try again, which it then does every minute until the thread ages
   out of the 90-day window and the fill's net_pnl is gone. That is the exact
   failure the three-outcome design exists to prevent, rebuilt one layer down. */
const upsert = (row: Record<string, unknown>) =>
  fetch(`${SB_URL}/rest/v1/trades?on_conflict=id`, {
    method: "POST",
    headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([row]),
  });

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing — the file loads under plain
// Node, where Deno.serve does not exist.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  // AUTHORISATION FIRST, BEFORE THE BODY IS EVEN READ. An unset secret refuses
  // rather than admits, for the same reason it does in the other three.
  if (!EMAIL_SECRET || !USER_ID || !SB_KEY) {
    console.error("doji-email-sync: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-doji-key"), EMAIL_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // THE THREE ANSWERS ARE THE CALLER'S THREE OUTCOMES, and they are different
  // on purpose. 400 says the fill will never be accepted, so the Apps Script
  // labels the thread and it leaves the queue. 5xx says try again, so the
  // thread stays unlabelled and the next run retries it. Collapsing the two is
  // how a momentary Supabase outage used to discard a fill's P&L forever.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "body is not JSON" }, 400);
  }

  const fill = emailRow(body, USER_ID);
  if ("error" in fill) {
    console.error("doji-email-sync: refused —", fill.error);
    return json({ ok: false, error: fill.error }, 400);
  }

  let res: Response;
  try {
    res = await upsert(fill.row);
  } catch (err) {
    // No response at all — DNS, a dropped connection. Always worth retrying.
    console.error("doji-email-sync:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "write unreachable" }, 500);
  }

  if (res.ok) return json({ ok: true, id: fill.row.id });

  const detail = (await res.text()).slice(0, 300);
  if (res.status >= 400 && res.status < 500) {
    console.error(`doji-email-sync: refused by PostgREST (${res.status}) — ${detail}`);
    return json({ ok: false, error: detail }, 400);
  }
  console.error(`doji-email-sync: write failed (${res.status}) — ${detail}`);
  return json({ ok: false, error: "write failed" }, 500);
});
