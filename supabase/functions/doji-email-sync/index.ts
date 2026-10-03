// ═══════════════════════════════════════════════════════════════════════════
// DOJI — email fill  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// One caller: doji_gmail_sync.gs parses cTrader's TP/SL alerts out of Gmail
// and posts the fill here, and this writes it. The write lives here so the
// secret held in Google's infrastructure opens five columns of one table
// rather than the account: Apps Script cannot use an sb_secret_ key, and the
// alternative was the trader's password in Script Properties.
//
// merge-duplicates sets exactly the keys present, so naming five columns is
// the whole guarantee. `balance` is named and the poller yields it, writing
// only `where balance is null`: this is the figure the broker printed.
//
// SECURITY CONTRACT
//   1. Every request presents DOJI_EMAIL_SECRET on x-doji-key — its own
//      secret, since it is the only one living outside his infrastructure.
//   2. The body is read — the only function here that reads one — so emailRow
//      whitelists and type-checks it before any value reaches a request.
//   3. user_id comes from secrets, never from the body.
//
// Deploy:  supabase functions deploy doji-email-sync --no-verify-jwt
// Secrets: DOJI_EMAIL_SECRET, DOJI_USER_ID, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { env, secretMatches, json, sbHeaders, heartbeat, SB_URL, SB_KEY, why }
  from "../_shared/edge.ts";

const EMAIL_SECRET = env("DOJI_EMAIL_SECRET");

// The email is often the first writer to reach a position, so this may be an
// INSERT, and auth.uid() is null under the secret key: the owner is supplied.
const USER_ID = env("DOJI_USER_ID");

/* ─── The boundary ─────────────────────────────────────────────────────────
   Everything below arrived over the wire. The five columns:

     id          `PID` + digits, as foldPosition mints it, or the position
                 lands on a second row.
     direction   BUY or SELL, the position side. The poller repairs a wrong
                 one within two minutes, for positions it can see.
     fill_time   the closing instant, and the app's filing-day fallback, so an
                 unparseable value would move the trade's day.
     net_pnl     the broker's settled figure, swap included; nothing else here
                 can supply it.
     balance     the account after the fill.

   A missing value is dropped, never sent as null: under merge-duplicates
   `direction: null` erases a correct direction. So this builds a payload
   rather than filtering one. Refusals carry a reason for the Apps Script log.
   ───────────────────────────────────────────────────────────────────────── */
export type Fill = { row: Record<string, unknown> } | { error: string };

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

  // Refused rather than coerced: "57.10" would be stored and read back as a
  // number, until the day it is not.
  for (const k of ["net_pnl", "balance"] as const) {
    if (b[k] === undefined || b[k] === null) continue;
    if (!Number.isFinite(b[k])) return { error: `${k} is not a finite number` };
    row[k] = b[k];
  }

  return { row };
}

/* Returns the response rather than throwing: the status is what the caller
   needs. */
const upsert = (row: Record<string, unknown>) =>
  fetch(`${SB_URL}/rest/v1/trades?on_conflict=id`, {
    method: "POST",
    headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([row]),
  });

/* What Postgres said, as what the Apps Script does about it: 400 out labels the
   thread and it leaves the queue, 500 out leaves it to be retried.

   Permanent is a statement about the ROW. Only 400, 409 and 422 mean Postgres
   examined this row and will never accept it; a 401 from a rotated key, a 429
   or a 5xx says nothing about the fill, and labelling it would discard the only
   settled P&L this system gets. Retrying something permanent costs a thread
   left visibly in the queue, which is the cheap side.

   Exported because it is the joint between the halves: parse.test.mjs holds
   the script's side, and this is the function's. */
const PERMANENT = [400, 409, 422];

export const answerFor = (status: number): 400 | 500 =>
  PERMANENT.includes(status) ? 400 : 500;

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  // Authorisation before the body is read; an unset secret refuses.
  if (!EMAIL_SECRET || !USER_ID || !SB_KEY) {
    console.error("doji-email-sync: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-doji-key"), EMAIL_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  /* Three answers, three outcomes for the caller: 400 never accepted, 5xx try
     again, 200 written. Every 400 discards a fill for ever, so each marks the
     heartbeat — and it is no ordinary-day alarm: only the Apps Script holds
     this secret, so a refused body is its parse and this boundary disagreeing
     about one email. */
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await heartbeat("email", "body is not JSON");
    return json({ ok: false, error: "body is not JSON" }, 400);
  }

  /* A body with no `id` is a probe, never a fill: testSecret() posts `{}` on
     purpose, and parseAlert_ cannot produce a fill without one. Marking it
     would report a healthy sync as broken whenever the diagnostic ran. */
  const fill = emailRow(body, USER_ID);
  if ("error" in fill) {
    console.error("doji-email-sync: refused —", fill.error);
    const probe = !body || typeof body !== "object" || !("id" in body);
    if (!probe) await heartbeat("email", `refused, the fill is lost: ${fill.error}`);
    return json({ ok: false, error: fill.error, probe }, 400);
  }

  let res: Response;
  try {
    res = await upsert(fill.row);
  } catch (err) {
    // No response at all — DNS, a dropped connection. Always worth retrying.
    console.error("doji-email-sync:", why(err));
    await heartbeat("email", err);
    return json({ ok: false, error: "write unreachable" }, 500);
  }

  if (res.ok) {
    // The one trace a run that worked leaves.
    await heartbeat("email");
    return json({ ok: true, id: fill.row.id });
  }

  // A body is not guaranteed, and "" tells the Apps Script log nothing.
  const detail = (await res.text()).slice(0, 300) || `HTTP ${res.status}`;

  const answer = answerFor(res.status);
  console.error(`doji-email-sync: ${answer === 400 ? "refused by PostgREST" : "write failed"}` +
                ` (${res.status}) — ${detail}`);
  await heartbeat("email", `HTTP ${res.status} — ${detail}`);
  return json({ ok: false, error: detail }, answer);
});
