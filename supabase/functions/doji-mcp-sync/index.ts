// ═══════════════════════════════════════════════════════════════════════════
// DOJI — cTrader MCP sync  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// Polls cTrader for deal history, folds deals into positions, and upserts one
// row per position into `trades`.
//
// It writes BROKER-OWNED COLUMNS ONLY. PostgREST's merge-duplicates sets
// exactly the keys present in the payload, so setup, the three discipline
// answers and `deleted` are never named here and therefore cannot be touched.
// That is the whole mechanism protecting the journal — there is no inbox table
// standing between this and the trader's data because none is needed.
//
// `deleted` in particular: a trade the trader removed stays removed. This
// function re-upserts every position in its window on every run, and omitting
// the column is what stops that resurrecting it two minutes later.
//
// SECURITY CONTRACT
//   1. ALLOWED_TOOLS is a hardcoded whitelist holding two read tools.
//      mcpCall() throws on anything else.
//   2. Every request must present DOJI_CRON_SECRET on the x-doji-key header.
//      This function runs with verify_jwt = false, so the platform gateway no
//      longer checks anything — authorisation happens here, in code, before any
//      work begins. See the note at the entry point.
//   3. No value from the HTTP request reaches an MCP call. The body is never
//      read. The only request input consulted is two query flags, both
//      numeric/boolean and both clamped. No code path constructs an order.
//   4. Tokens live only in Deno.env — never logged, never returned, never
//      written to the database.
//
// Deploy:  supabase functions deploy doji-mcp-sync --no-verify-jwt
// Secrets: CTRADER_MCP_TOKEN, DOJI_USER_ID, DOJI_CRON_SECRET, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════

// Everything shared lives in _shared/edge.ts — one definition each, for the
// reason that file gives. Reading Deno through a guard rather than at module
// scope is what lets this file be imported under plain Node without throwing
// before a single assertion runs; test/fold.test.mjs is what uses it.
import {
  env, secretMatches, json, nyClock, nyDate, sbHeaders, SB_URL, SB_KEY,
} from "../_shared/edge.ts";

const MCP_URL   = env("CTRADER_MCP_URL") || "https://mcp.ctrader.com/trading/mcp";
const MCP_TOKEN = env("CTRADER_MCP_TOKEN");

/* ─── Credentials ──────────────────────────────────────────────────────────
   Two DIFFERENT secrets, deliberately, because they answer different questions
   and leak with different consequences.

   DOJI_CRON_SECRET — "may this caller start a poll?". It has no database power
   whatsoever, and against this function that is the whole of it: the worst a
   holder can do is start a read-only poll that was going to run anyway. Two
   other functions check the same secret and it is NOT harmless there — see the
   README — which is why the claim is made about this endpoint rather than about
   the secret.

   SB_SECRET_KEY — "may this function write to the table?". It bypasses
   RLS and never leaves this runtime. It is the reason the split exists: the
   thing scheduled every two minutes must not be the thing that can write.

   The cron job used to carry a legacy service_role JWT, which meant the job
   held full RLS-bypassing access to the entire database. Worse, legacy JWT
   keys cannot be rotated at all — they are tied to the project's JWT secret —
   so any exposure was permanent short of migrating off them. That migration is
   done; sbHeaders in _shared has the header shape and the rest of the account.
   ───────────────────────────────────────────────────────────────────────── */
const CRON_SECRET = env("DOJI_CRON_SECRET");

// `trades.user_id` is NOT NULL and defaults to auth.uid(), which is null under
// the service role — so the owner has to be supplied explicitly here, and in
// doji-email-sync for the same reason.
//
// A missing secret is fatal rather than silently inserting nothing, because a
// poller that reports success and writes no rows is the worst failure shape
// available.
const USER_ID = env("DOJI_USER_ID");

/* ─── Write window ─────────────────────────────────────────────────────────
   Which positions get UPSERT. Wider than the cron interval so a missed run, a
   redeploy or a cold start self-heals on the next pass instead of leaving a
   permanent hole. Upserts are idempotent, so overlap costs nothing.

   SIX HOURS, NOT 720. The wide default rewrote every position from the last
   thirty days on EVERY two-minute run — around forty rows, roughly 28,800
   pointless row-rewrites a day. Postgres does not skip no-op updates, so each
   one fired the updated_at trigger and broadcast a realtime UPDATE, which made
   every open tab reload and re-render around the clock for no change at all.

   Six still tolerates 180 consecutive missed runs, far beyond any outage this
   is meant to survive.
   ───────────────────────────────────────────────────────────────────────── */
const DEFAULT_LOOKBACK = Math.min(Number(env("LOOKBACK_HOURS") || 6), 720);

// Backfills need the wide window without editing a secret and putting it back.
// Read-only and clamped, same as the default. cTrader caps a range at 720h.
export function lookbackFor(url: URL): number {
  const raw = Number(url.searchParams.get("hours"));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 720) : DEFAULT_LOOKBACK;
}

/* ─── Fold window ──────────────────────────────────────────────────────────
   Which deals get READ. Not the same question as which positions get written,
   and conflating the two inverted the direction of every position held longer
   than the write window.

   get_deals over six hours returns a long position's closing deal WITHOUT its
   entry. foldPosition then takes ordered[0] — the close — as the entry, so a
   short reports BUY, and entry_time, entry_price and open_day are overwritten
   with the exit's values. That silently moves the trade's session and can move
   its calendar day. The truncation guard below never fires, because nothing was
   truncated: the entry deal was simply never requested.

   So deals are read over `write window + MAX_POSITION_HOURS` and a position is
   written only if one of its deals landed inside the write window. The 28,800
   pointless rewrites the narrowing was for stay fixed — that was always a write
   problem, and reading wider is the same single MCP call.

   72h covers a position carried over a weekend. Anything held longer still
   slices, so this is a bound on how long a position may live, not a guess at a
   window. Raise it if that ever stops being true.
   ───────────────────────────────────────────────────────────────────────── */
const MAX_POSITION_HOURS = Math.min(Number(env("MAX_POSITION_HOURS") || 72), 720);

export const foldHours = (writeHours: number) =>
  Math.min(writeHours + MAX_POSITION_HOURS, 720);

/* ─── Balance window ───────────────────────────────────────────────────────
   How recent a close must be before get_balance may be recorded against it.

   get_balance answers "what is the account worth NOW". The `balance` column
   asks "what was the account worth immediately after THIS fill". Those are the
   same number only while nothing has happened in between, so the write is
   confined to a close the poller has only just seen. Ten minutes tolerates a
   few missed runs of a two-minute cron without stretching that claim.

   An older close simply gets no balance. A missing figure is honest and the
   next close supplies one; a wrong figure is silent and permanent.

   This is also what keeps ?force=1&hours=200 safe: a backfill folds positions
   that closed days ago, every one of them fails this test, and no historical
   balance is touched.
   ───────────────────────────────────────────────────────────────────────── */
const BALANCE_MAX_AGE_MS = 10 * 60_000;

// The position a freshly-read balance belongs to: the most recent close, and
// only if it is recent enough for "now" to still mean "then". Returns null when
// nothing qualifies, which is also the signal not to call get_balance at all.
//
// Deliberately ONE position rather than all of them. When two close inside the
// same run there is a single balance to hand and only the later close actually
// ended at it; giving both the same figure would overstate the earlier one by
// the later one's P&L.
export function balanceTarget(closes: { id: string; at: number }[], now: number): string | null {
  let best: { id: string; at: number } | null = null;
  for (const c of closes) if (!best || c.at > best.at) best = c;
  return best && now - best.at <= BALANCE_MAX_AGE_MS ? best.id : null;
}

// XAUUSD on this account. An account-specific magic number, so it is
// overridable — a broker or account change would otherwise make this return
// zero deals on every run and report success, which is the failure shape
// hardest to notice.
const SYMBOL_IDS: number[] = (env("SYMBOL_IDS") || "41")
  .split(",").map(s => Number(s.trim())).filter(Number.isFinite);

// Explicit: the server defaults to 50 and truncates silently.
const MAX_ROWS = 500;

// Both read-only, and both carry readOnlyHint on the server's own tool listing.
// Nothing that amends, closes or creates is reachable from this function.
const ALLOWED_TOOLS = ["get_deals", "get_balance"] as const;
type AllowedTool = typeof ALLOWED_TOOLS[number];

/* ─── MCP transport ────────────────────────────────────────────────────────
   Streamable HTTP. Three things make it fiddlier than a REST call: a session
   must be opened with `initialize` and its Mcp-Session-Id echoed on every later
   call; sessions expire within minutes, so each invocation opens a fresh one
   rather than caching; and responses arrive as Server-Sent Events, so the JSON
   is wrapped in `event: message\ndata: {...}` framing that has to be peeled off.
   ───────────────────────────────────────────────────────────────────────── */
const MCP_HEADERS = {
  "Authorization": `Bearer ${MCP_TOKEN}`,
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
};

// Walks the data: frames from the END BACKWARDS and returns the last one that
// actually parses. Taking the final line unconditionally meant a trailing
// keepalive or a second event surfaced as a SyntaxError inside a generic 500 —
// which pg_cron's net.http_post discards, so it reported to nobody.
export function parseSse(body: string): any {
  const frames = body.split("\n")
    .filter(l => l.startsWith("data:"))
    .map(l => l.slice(5).trim())
    .filter(Boolean);

  for (let i = frames.length - 1; i >= 0; i--) {
    try { return JSON.parse(frames[i]); } catch { /* try the one before */ }
  }
  return JSON.parse(body.trim());   // no SSE framing at all — plain JSON body
}

async function mcpInit(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST", headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2025-06-18", capabilities: {},
        clientInfo: { name: "doji-sync", version: "3" },
      },
    }),
  });
  const sid = res.headers.get("mcp-session-id");
  // Does not echo the response body — it can carry auth detail.
  if (!res.ok || !sid) throw new Error(`MCP initialize failed (HTTP ${res.status})`);

  // The spec requires this notification before normal calls are accepted.
  await fetch(MCP_URL, {
    method: "POST",
    headers: { ...MCP_HEADERS, "Mcp-Session-Id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  });
  return sid;
}

async function mcpCall(sid: string, tool: AllowedTool, args: Record<string, unknown>) {
  // Enforced at the call site, not by the caller's good intentions.
  if (!ALLOWED_TOOLS.includes(tool)) throw new Error(`Tool not permitted: ${tool}`);

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { ...MCP_HEADERS, "Mcp-Session-Id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const envelope = parseSse(await res.text());
  if (envelope.error) throw new Error(`MCP ${tool}: ${envelope.error.message}`);

  // Tool results arrive as a text block whose body is itself a JSON document,
  // so it needs parsing twice.
  const text = envelope?.result?.content?.[0]?.text;
  if (!text) throw new Error(`MCP ${tool}: empty result`);
  return JSON.parse(text);
}

/* ─── Units ────────────────────────────────────────────────────────────────
   Both verified against a real fill (position 562780708) whose broker email
   independently reported 57.24 gross / 57.10 net:
     volume 200    → 2.00 oz    (oz = volume / 100 for metals)
     commission -7 → -$0.07     (cTrader sends hundredths of a dollar)

   get_balance states the same scale as a field rather than leaving it implied:
   moneyDigits reads 2 on this account, and the balance write below honours it
   rather than reusing this constant blind.
   ───────────────────────────────────────────────────────────────────────── */
export const ozFromVolume = (v: number) => v / 100;
export const usdFromCents = (c: number) => c / 100;

// The New York civil day an instant falls on. This is the day a trade is filed
// under, and it is why an entry at 21:05 New York on 30 July stays on 30 July
// instead of drifting to the 31st with the UTC date.
// Takes an epoch, because every caller here has one — the deals carry
// executionTimestamp and nothing else.
export const nyDay = (ms: number): string => nyDate(new Date(ms));

/* ─── Deal folding ─────────────────────────────────────────────────────────
   A position is deals sharing a positionId. Sorted by execution time the first
   is the entry, and anything on the OPPOSITE side after it is a close.

   DIRECTION COMES FROM THE FIRST DEAL AND NOWHERE ELSE.
   get_position_details reports tradeSide on the position object, but for a
   closed position that object is hollow — volume 0, entryPrice 0, commission 0,
   swap 0 — and its tradeSide is the CLOSING side. Position 568161031 sold at
   4292.66 and bought back at 4264.85, and that field says BUY while reporting
   no commission against two deals that each charged 7. Nothing on that object
   can be read for a closed position.

   Same-side deals are scale-ins, not closes. Splitting on side rather than on
   position in the array is what stops an addition being averaged into the exit
   price and tripping the position into a fabricated "closed" state.

   Both rules are covered by test/fold.test.mjs.
   ───────────────────────────────────────────────────────────────────────── */
interface Deal {
  dealId: number; positionId: number; symbolId: number;
  tradeSide: "BUY" | "SELL";
  volume: number; filledVolume: number;
  executionPrice: number; executionTimestamp: number;
  dealStatus: string; commission?: number;
}

const dealOz = (d: Deal) => ozFromVolume(d.filledVolume ?? d.volume);

export function foldPosition(deals: Deal[], userId: string) {
  const ordered = [...deals].sort((a, b) => a.executionTimestamp - b.executionTimestamp);
  const entry   = ordered[0];
  const side    = entry.tradeSide;

  const opens  = ordered.filter(d => d.tradeSide === side);
  const closes = ordered.filter(d => d.tradeSide !== side);

  const openOz  = opens.reduce((s, d) => s + dealOz(d), 0);
  const closeOz = closes.reduce((s, d) => s + dealOz(d), 0);

  // Fully closed only once the closing volume has caught up with everything
  // opened. A partial close leaves the position live and its P&L unresolved,
  // which is the honest state to show.
  const isClosed = closes.length > 0 && closeOz >= openOz - 1e-9;

  // Volume-weighted, so a scaled entry or exit reports one price rather than an
  // arbitrary pick.
  const wavg = (list: Deal[], oz: number) =>
    oz > 0 ? list.reduce((s, d) => s + d.executionPrice * dealOz(d), 0) / oz : null;

  const entryPrice = wavg(opens, openOz) ?? entry.executionPrice;
  const exitPrice  = isClosed ? wavg(closes, closeOz) : null;

  // Negative as cTrader reports it, so the sum below subtracts the cost.
  const commission = usdFromCents(ordered.reduce((s, d) => s + (d.commission ?? 0), 0));

  // Shorts are entered SELL, so profit is entry minus exit. Longs invert.
  let computedPnl: number | null = null;
  if (isClosed && exitPrice !== null) {
    const gross = side === "SELL"
      ? (entryPrice - exitPrice) * openOz
      : (exitPrice - entryPrice) * openOz;
    computedPnl = Math.round((gross + commission) * 100) / 100;
  }

  return {
    // Prefixed to match what the email parser writes, so both sources land on
    // one row. Unprefixed, the same position would mint two.
    id:           `PID${entry.positionId}`,
    user_id:      userId,
    direction:    side,
    entry_time:   new Date(entry.executionTimestamp).toISOString(),
    entry_price:  Math.round(entryPrice * 100) / 100,
    exit_price:   exitPrice === null ? null : Math.round(exitPrice * 100) / 100,
    // Positive magnitude — the sign lives in the label, and this value is
    // recorded rather than ever subtracted: computed_pnl above already includes it.
    commission:   Math.abs(Math.round(commission * 100) / 100),
    computed_pnl: computedPnl,
    open_day:     nyDay(entry.executionTimestamp),
  };
}

/* ─── Writing ──────────────────────────────────────────────────────────── */
async function upsert(rows: Record<string, unknown>[]) {
  if (!rows.length) return 0;

  const res = await fetch(`${SB_URL}/rest/v1/trades?on_conflict=id`, {
    method: "POST",
    headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Upsert failed (HTTP ${res.status}): ${await res.text()}`);
  return rows.length;
}

/* `balance=is.null` in the filter is the entire arbitration rule between this
   and the email parser, and it lives in the URL rather than in a read here. The
   email reports the balance the broker itself printed on the fill; this reports
   the balance a couple of minutes later, so the email's is the better number
   wherever it exists. Postgres evaluates the filter inside the UPDATE, so an
   email landing mid-run cannot lose a race — there is no read to race with.

   A PATCH rather than another column on the upsert: merge-duplicates sets every
   key in the payload unconditionally, so naming `balance` there would overwrite
   the email's figure on each of the re-upserts a position gets for the rest of
   the write window — which is also why no merge-duplicates Prefer is named
   here. It would mean nothing on an update, and reading it here suggests it
   does. */
async function writeBalance(id: string, balance: number) {
  const res = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&balance=is.null`, {
    method: "PATCH", headers: sbHeaders(), body: JSON.stringify({ balance }),
  });
  if (!res.ok) throw new Error(`Balance write failed (HTTP ${res.status}): ${await res.text()}`);
}

/* ─── Market hours ─────────────────────────────────────────────────────────
   Gold trades Sunday 17:00 to Friday 17:00, New York. Polling through the
   ~49-hour weekend close is roughly 1,400 pointless calls a week for data that
   cannot have changed.

   Decided here rather than in the cron expression on purpose: "continuous from
   Sunday evening to Friday evening" takes three cron jobs, pg_cron schedules in
   UTC, and every one of them would be an hour wrong whenever New York is on
   standard time. nyClock asks America/New_York for its own clock instead, which
   is correct all year — the same reading Eugenia's two schedules take, from the
   same definition.
   ───────────────────────────────────────────────────────────────────────── */
export function marketOpen(now = new Date()): boolean {
  const { wd, hour } = nyClock(now);
  if (wd === 6) return false;                 // Saturday
  if (wd === 5 && hour >= 17) return false;   // after the Friday close
  if (wd === 0 && hour < 17) return false;    // before the Sunday open
  return true;
}

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing — the file loads under plain
// Node, where Deno.serve does not exist.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  // AUTHORISATION FIRST, BEFORE ANYTHING ELSE.
  //
  // Deployed with verify_jwt = false, because the new sb_secret_ keys are not
  // JWTs and the platform gateway cannot validate them. That is not a
  // weakening — it moves the check from the gateway into this file, where it is
  // visible in the code being read rather than in a dashboard toggle nobody
  // re-opens.
  //
  // A missing secret is a hard failure, never an open door: an unset
  // DOJI_CRON_SECRET must not mean "let everyone in".
  if (!CRON_SECRET) {
    console.error("doji-mcp-sync: DOJI_CRON_SECRET not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-doji-key"), CRON_SECRET)) {
    // No detail in the body. An unauthorised caller learns only that it failed.
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    if (!MCP_TOKEN) throw new Error("CTRADER_MCP_TOKEN not set");
    if (!USER_ID)   throw new Error("DOJI_USER_ID not set");
    if (!SB_KEY)    throw new Error("no Supabase key available");

    // ?force=1 bypasses the schedule for manual runs and backfills.
    // ?hours=N  widens the window for one call, clamped to cTrader's 720h cap.
    // Neither selects a tool or reaches an MCP call with request-supplied data,
    // so the read-only guarantee is untouched.
    const url   = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    if (!force && !marketOpen()) {
      return json({ ok: true, skipped: "market closed" });
    }

    const hours    = lookbackFor(url);
    const to       = Date.now();
    const from     = to - hours * 3600_000;               // what gets written
    const foldFrom = to - foldHours(hours) * 3600_000;    // what gets read

    const sid  = await mcpInit();
    const data = await mcpCall(sid, "get_deals", {
      fromTimestamp: String(foldFrom),
      toTimestamp:   String(to),
      maxRows: MAX_ROWS,
    });

    const deals: Deal[] = (data.deals ?? [])
      .filter((d: Deal) => d.dealStatus === "FILLED")
      .filter((d: Deal) => !SYMBOL_IDS.length || SYMBOL_IDS.includes(d.symbolId));

    const byPosition = new Map<number, Deal[]>();
    for (const d of deals) {
      if (!byPosition.has(d.positionId)) byPosition.set(d.positionId, []);
      byPosition.get(d.positionId)!.push(d);
    }

    // Every position is folded from its complete deal set, so ordered[0] is
    // always the real entry. Only the ones that actually moved inside the write
    // window are sent, which is what keeps the rewrite volume down.
    //
    // The last deal is carried alongside for the balance write below. A fully
    // closed position cannot end on an opening deal — that volume would still
    // be outstanding and isClosed would be false — so wherever there is an
    // exit_price, the latest deal IS the closing one.
    const folded = [...byPosition.values()]
      .filter(ds => ds.some(d => d.executionTimestamp >= from))
      .map(ds => ({
        row: foldPosition(ds, USER_ID),
        closedAt: Math.max(...ds.map(d => d.executionTimestamp)),
      }));
    const n = await upsert(folded.map(f => f.row));

    // TRUNCATION IS DATA LOSS, SO IT IS AN ERROR, NOT A FIELD.
    //
    // This used to return `truncated: true` in a 200 body. pg_cron invokes the
    // function through net.http_post, which discards the response — so the one
    // signal that trades were being dropped was reported to nobody, forever.
    //
    // It is also worse than losing rows: a truncated window can return a
    // position's closing deals without its entry, and foldPosition then reads
    // direction off a close and inverts it. Failing loudly is the only honest
    // answer. The write above has already happened, so nothing is lost by
    // throwing here — the next run repeats it.
    //
    // TWO signals, because one of them is a vendor field name we do not
    // control. If cTrader renames hasMore, returns has_more, or omits it when
    // truncating, the row-count check still fires. The window named here is the
    // FOLD window, because that is the one that was read.
    //
    // Ahead of the balance write deliberately: a run that may have folded a
    // position without its entry must not then stamp an account balance on it.
    const rawDeals = (data.deals ?? []).length;
    if (data.hasMore === true || rawDeals >= MAX_ROWS) {
      throw new Error(
        `get_deals truncated at maxRows over a ${foldHours(hours)}h fold window ` +
        `(${rawDeals} deals, hasMore=${data.hasMore}) — some positions may be ` +
        `folded without their entry deal. Narrow the window.`);
    }

    // BALANCE REACHES THE TABLE NO OTHER WAY FROM HERE.
    //
    // get_deals carries no balance at all — eleven fields, none of them the
    // account — and get_position_details reports zero for a closed position
    // beside a commission it also reports as zero. get_balance is the only
    // source, and it answers "now" rather than "after that fill", which is why
    // balanceTarget confines it to a close the poller has only just seen.
    const target = balanceTarget(
      folded.filter(f => f.row.exit_price !== null)
            .map(f => ({ id: f.row.id, at: f.closedAt })), to);

    if (target) {
      const account = await mcpCall(sid, "get_balance", {});
      // cTrader scales money by a per-account moneyDigits rather than by a
      // fixed convention. It reads 2 here — the same hundredths as commission
      // and volume — but reading it costs one line and removes the assumption.
      // Absent, the balance would be written 100× out and look plausible.
      if (typeof account.moneyDigits !== "number") {
        throw new Error("get_balance returned no moneyDigits — balance scale unknown");
      }
      await writeBalance(target, Math.round(account.balance / 10 ** account.moneyDigits * 100) / 100);
    }

    return json({
      ok: true, window_hours: hours, fold_hours: foldHours(hours),
      deals: deals.length, positions: n, balance_for: target,
    });
  } catch (err) {
    console.error("doji-mcp-sync:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
