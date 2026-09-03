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
//      mcpPost() throws on anything else, and it is the only place a tool name
//      becomes a request.
//   2. Every request must present DOJI_CRON_SECRET on the x-doji-key header.
//      This function runs with verify_jwt = false, so the platform gateway no
//      longer checks anything — authorisation happens here, in code, before any
//      work begins. See the note at the entry point.
//   3. No value from the HTTP request reaches an MCP call. The body is never
//      read. The only request input consulted is three query flags — force,
//      raw and hours — the first two boolean and the third clamped. No code
//      path constructs an order.
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
   whatsoever, and against this function that is nearly the whole of it: a
   holder can start a read-only poll that was going to run anyway, or read the
   deal history back with ?raw=1. Neither writes. Two other functions check the
   same secret and it is NOT harmless there — see the README — which is why the
   claim is made about this endpoint rather than about the secret.

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

/* ─── Reading a window out of configuration ────────────────────────────────
   Hours, clamped to cTrader's 720h cap, or null when the value is not a
   positive number.

   NaN IS THE FAILURE THAT MATTERS. `Number("6h")` is NaN, `Math.min(NaN, 720)`
   is NaN, and a NaN window reaches get_deals as the string "NaN" — a poll that
   asks for nothing and then reports whatever the broker makes of it. The query
   flag was already guarded against exactly this; the two env vars were not, and
   they are the ones a person edits in a dashboard months later.
   ───────────────────────────────────────────────────────────────────────── */
const clampHours = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 720) : null;
};

/* An env var is different from a query flag: nobody is watching when it is
   read, so a value that does not parse must stop the function rather than
   quietly becoming the default. Absent is fine and means the default; PRESENT
   AND WRONG is a configuration error, and a poller running a window nobody
   chose is the shape this file exists to avoid. */
function envHours(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const hours = clampHours(raw);
  if (hours === null) throw new Error(`${name} is not a positive number of hours: ${raw}`);
  return hours;
}

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
const DEFAULT_LOOKBACK = envHours("LOOKBACK_HOURS", 6);

// Backfills need the wide window without editing a secret and putting it back.
// Read-only and clamped, same as the default. cTrader caps a range at 720h, and
// a `?hours=` that is not a positive number falls back rather than refusing —
// it arrives on a URL, where a typo is the caller's to notice immediately.
export function lookbackFor(url: URL): number {
  return clampHours(url.searchParams.get("hours")) ?? DEFAULT_LOOKBACK;
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
const MAX_POSITION_HOURS = envHours("MAX_POSITION_HOURS", 72);

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

/* XAUUSD on this account. An account-specific magic number, so it is
   overridable — a broker or account change would otherwise make this return
   zero deals on every run and report success, which is the failure shape
   hardest to notice.

   POSITIVE INTEGERS, and a value that yields none throws. Filtering on
   Number.isFinite alone let a blank token through: `Number("")` and
   `Number(" ")` are both 0, so `SYMBOL_IDS=","` parsed to [0] — a non-empty
   list that matches no deal, which is precisely the silent zero-trade success
   this constant exists to prevent. Refusing the poll is the smaller wrong: no
   trades appear, and that is visible within minutes.
   ───────────────────────────────────────────────────────────────────────── */
const SYMBOL_IDS: number[] = (() => {
  const raw = env("SYMBOL_IDS") || "41";
  const ids = raw.split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) throw new Error(`SYMBOL_IDS holds no usable symbol id: ${raw}`);
  return ids;
})();

// Explicit: the server defaults to 50 and truncates silently.
const MAX_ROWS = 500;

/* EVERY ONE READ-ONLY, AND THE LIST IS THE ONLY THING THAT MAKES THAT TRUE.

   `?tools=1` established what this endpoint actually offers, and the answer
   matters twice. It serves prices — `get_spot_prices` and `get_trendbars` —
   which is what lets Eugenia read the instrument instead of a web page. And it
   serves `create_order`, `close_position`, `amend_position`, `amend_order` and
   `cancel_order`, which are on the same credential.

   SO THIS ARRAY IS WHAT STANDS BETWEEN THIS SYSTEM AND A PLACED TRADE, and it
   should be read that way rather than as configuration. Every name below
   carries `readOnlyHint: true` on the server's own listing; nothing that
   amends, closes or creates appears, and adding one is not a widening of a list
   but a change of what this function is. A test asserts the destructive five
   are absent, because the failure mode of getting this wrong is not a bug
   report.

   The credential is the better place for that guarantee and is not where it
   lives today — if cTrader can issue a read-only token, this array stops being
   load-bearing. Until then it is. */
const ALLOWED_TOOLS = [
  "get_deals", "get_balance", "get_positions", "get_spot_prices", "get_trendbars",
] as const;
type AllowedTool = typeof ALLOWED_TOOLS[number];

// The five this endpoint offers that would place, move or close a trade. Named
// so a test can assert none of them is ever reachable, rather than trusting the
// list above to be read carefully by whoever edits it next.
export const DESTRUCTIVE_TOOLS = [
  "create_order", "close_position", "amend_position", "amend_order", "cancel_order",
] as const;

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

/* The request and nothing else, so the body cTrader sent can be had whole as
   well as unwrapped. mcpCall wants the deals inside it; ?raw=1 wants the frame,
   the envelope and the double-encoded payload exactly as they arrived. Two
   consumers, one statement of what the request is — writing the fetch twice is
   how the two would drift.

   The allow-list check lives here rather than in mcpCall, because here is the
   only place a tool name becomes a request. */
async function mcpPost(sid: string, tool: AllowedTool, args: Record<string, unknown>): Promise<string> {
  if (!ALLOWED_TOOLS.includes(tool)) throw new Error(`Tool not permitted: ${tool}`);

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { ...MCP_HEADERS, "Mcp-Session-Id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  // Checked here, so ?raw=1 cannot hand back a 401 body under a 200 and have it
  // read as what the broker sent. mcpInit refuses the same way for the same
  // reason.
  if (!res.ok) throw new Error(`MCP ${tool}: HTTP ${res.status}`);
  return res.text();
}

async function mcpCall(sid: string, tool: AllowedTool, args: Record<string, unknown>) {
  const envelope = parseSse(await mcpPost(sid, tool, args));
  if (envelope.error) throw new Error(`MCP ${tool}: ${envelope.error.message}`);

  // Tool results arrive as a text block whose body is itself a JSON document,
  // so it needs parsing twice.
  const text = envelope?.result?.content?.[0]?.text;
  if (!text) throw new Error(`MCP ${tool}: empty result`);
  return JSON.parse(text);
}

/* ─── Two scales on one endpoint ───────────────────────────────────────────
   ESTABLISHED BY PROBE, NOT BY READING THE DOCUMENTATION, and the two answers
   disagreed — which is the entire reason it was probed.

   `get_spot_prices` serves PIPETTES: bid 441982000 is 4419.82, a hundred
   thousandth of what it prints. `get_positions` serves DISPLAY prices in the
   same account on the same symbol: entryPrice 4402.71 is 4402.71. So one tool
   is scaled and its neighbour is not, and cTrader's own tool descriptions —
   which say "DISPLAY price (not pipettes)" about their INPUTS — say nothing
   about either.

   A briefing opening on a price a hundred thousand times wrong would still be
   four digits and would still look like gold. That is the whole argument for
   naming this constant here, applying it in exactly one place, and never
   letting a second reading of it exist. */
export const PIPETTES = 100_000;
export const fromPipettes = (n: number) => Math.round(n / PIPETTES * 100) / 100;

/* WHERE GOLD IS, AND WHAT IT DID OVERNIGHT — from one call and no arithmetic
   anyone has to redo.

   `sessionClose` is the previous session's close, which for gold is the 17:00
   New York roll — so the overnight move is a subtraction rather than a second
   request for yesterday's bar. That is the whole of the briefing's opening
   line, and it is why this needs no trendbars.

   Pure, and exported, because it is the decision: a scale applied twice or not
   at all is invisible in the output and catastrophic in a briefing. A price
   that will not parse yields null rather than NaN — `NaN` formats as "NaN" and
   would reach him as text, where a null is something the caller must handle. */
export interface Spot {
  bid: number; ask: number; high: number; low: number;
  prev_close: number; change: number; change_pct: number; at: string;
}

export function foldSpot(price: any): Spot | null {
  const at = (k: string) => {
    const n = Number(price?.[k]);
    return Number.isFinite(n) ? fromPipettes(n) : null;
  };
  const bid = at('bid'), ask = at('ask'), prev = at('sessionClose');
  if (bid === null || ask === null) return null;

  // Against the previous close where there is one, and against itself where
  // there is not — a null change is honest, a zero one is a claim that nothing
  // moved.
  const change = prev === null ? null : Math.round((bid - prev) * 100) / 100;

  return {
    bid, ask, high: at('high') ?? bid, low: at('low') ?? bid,
    prev_close: prev as number,
    change: change as number,
    change_pct: change === null || !prev ? (null as any)
      : Math.round(change / prev * 10000) / 100,
    at: new Date(Number(price?.timestamp) || Date.now()).toISOString(),
  };
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

// nyDate takes a Date; every caller here has an epoch, because the deals carry
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
    // The size the position was OPENED at, which is the quantity computed_pnl
    // above is calculated over — closeOz equals it on a closed position and is
    // the wrong number on a partial. Two decimals because the broker states oz
    // to two, and a scale-in weighted-averages to the same precision.
    size_oz:      Math.round(openOz * 100) / 100,
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
  // DOJI_CRON_SECRET must not mean "let everyone in". The other three are here
  // for a different reason — none of them is an authorisation and each would
  // otherwise surface a page or two downstream, as a 401 from cTrader or a
  // Postgres complaint about a user_id that is not a uuid. Naming the problem
  // at the door is the whole point of a 503, and pg_cron discards every answer
  // but this one.
  if (!CRON_SECRET || !MCP_TOKEN || !USER_ID || !SB_KEY) {
    console.error("doji-mcp-sync: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-doji-key"), CRON_SECRET)) {
    // No detail in the body. An unauthorised caller learns only that it failed.
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    // ?force=1 bypasses the schedule for manual runs and backfills.
    // ?raw=1   returns the get_deals body unparsed — see below.
    // ?tools=1 returns what the broker's MCP actually offers — see below.
    // ?hours=N widens the window for one call, clamped to cTrader's 720h cap.
    // None of the four selects a tool or reaches an MCP call with
    // request-supplied data, so the read-only guarantee is untouched.
    const url   = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const raw   = url.searchParams.get("raw") === "1";
    const tools = url.searchParams.get("tools") === "1";
    const posns = url.searchParams.get("positions") === "1";
    // Two flags rather than one string, so the market gate below and the test
    // over it can both enumerate what this entry point reads.
    const market    = url.searchParams.get("market") === "1";
    const marketRaw = url.searchParams.get("market") === "raw";
    // The two read-only flags answer over the weekend too, which is when a
    // suspicious row actually gets looked at. Neither writes, so the market
    // check has nothing to protect here.
    if (!force && !raw && !tools && !posns && !market && !marketRaw && !marketOpen()) {
      return json({ ok: true, skipped: "market closed" });
    }

    const hours    = lookbackFor(url);
    const to       = Date.now();
    const from     = to - hours * 3600_000;               // what gets written
    const foldFrom = to - foldHours(hours) * 3600_000;    // what gets read

    const sid = await mcpInit();

    /* ?tools=1 — WHAT THE BROKER ACTUALLY OFFERS, which is a question this
       repository has had to answer by reading its own allow-list and hoping.

       ALLOWED_TOOLS names the two this function calls. It has never said
       anything about what EXISTS: the poller needs deals and a balance, so
       those are what it asked for, and whether cTrader also serves a quote, a
       symbol list or an open-position feed was never established either way.
       That gap decides real things — whether Eugenia can read a price off the
       broker she already has a connection to, or has to reach for a third-party
       feed and a vendor decision.

       A METHOD, NOT A TOOL CALL, so it goes past mcpPost rather than through
       it: the allow-list guards a tool NAME becoming a request, and `tools/list`
       names none. It writes nothing, calls nothing it discovers, and is safe at
       any hour — the same standing as ?raw=1, and here for the same reason,
       which is that guessing has already cost a day more than once.

       Text rather than JSON, because the SSE framing is part of what a reader
       is checking. */
    if (tools) {
      const listed = await fetch(MCP_URL, {
        method: "POST",
        headers: { ...MCP_HEADERS, "Mcp-Session-Id": sid },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      // Checked for the reason mcpPost checks: a 401 body under a 200 would
      // read as the broker offering nothing at all.
      if (!listed.ok) throw new Error(`MCP tools/list: HTTP ${listed.status}`);
      return new Response(await listed.text(),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    /* ?positions=1 — WHETHER THE PLAN IS RECOVERABLE AFTER ALL.

       §8 of the strategy says flatly that it is not: *where the stop and target
       were set at entry* is called unavailable from the broker, and four
       questions are marked unanswerable because of it — R-02's respect half
       among them. That claim was formed against get_deals and
       get_position_details on a CLOSED position, where the broker reports only
       the final stop, and it is correct about those.

       A LIVE position is a different question, and nothing here had ever asked
       it. `amend_position` takes stopLoss and takeProfit, which says positions
       carry them; whether get_positions SERVES them is what this answers. If it
       does, the trades trigger already fires at the one moment worth sampling —
       and a stop recorded at open is the plan, which would move R-02 and R-08's
       step 4 out of the unanswerable set.

       Raw text for the reason ?raw=1 is raw: the field names and their scale
       are the whole question, and a fold written before seeing them would be
       the guess this repository keeps paying for. */
    if (posns) {
      const body = await mcpPost(sid, "get_positions", {});
      return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    /* ?market=1 — WHAT A PRICE ACTUALLY LOOKS LIKE COMING OUT OF THIS ENDPOINT.

       Also raw, and deliberately not yet folded into anything Eugenia reads.
       cTrader's own tool descriptions say "DISPLAY price (not pipettes)" about
       their INPUTS, which says nothing about what comes back — and the Open API
       has historically served prices scaled by a per-symbol digit count. A
       factor of ten to the fifth in the wrong direction produces a number that
       is still four digits and still looks like gold.

       So the shape is read before the parser is written. Both calls at once,
       because the two answers are only useful together: the spot says where it
       is, the daily bars say what it did overnight, and whether they agree
       about scale is the thing being checked. */
    /* THE RANGE FORM, BECAUSE THE SERVER REFUSED THE ONE ITS OWN DESCRIPTION
       OFFERS. `get_trendbars` documents "(count) → last N bars ending now" as
       valid and answers that shape with `fromTimestamp: must not be null`. The
       description and the implementation disagree, and the implementation is
       the one that has to be satisfied — so bars are asked for by range, which
       is the combination it does accept. Five days back for two daily bars,
       since a weekend is three of them. */
    const barArgs = {
      symbolId: SYMBOL_IDS[0], period: "D_1",
      fromTimestamp: String(to - 5 * 86_400_000),
      toTimestamp: String(to),
    };

    // ?market=raw is the diagnosis, ?market=1 the answer — the same split
    // ?raw=1 makes for the deals, and the reason the scale above was probed
    // before anything folded it.
    if (market || marketRaw) {
      if (marketRaw) {
        const [spot, bars] = await Promise.all([
          mcpPost(sid, "get_spot_prices", { symbolId: SYMBOL_IDS }),
          mcpPost(sid, "get_trendbars", barArgs),
        ]);
        return new Response(`--- get_spot_prices ---\n${spot}\n--- get_trendbars D_1 by range ---\n${bars}`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      const quoted = await mcpCall(sid, "get_spot_prices", { symbolId: SYMBOL_IDS });
      const spot = foldSpot((quoted.prices ?? [])[0]);
      // Said rather than served empty: a price this function could not read is
      // not a price of zero, and a briefing opening on one would be a confident
      // wrong number — the failure this whole endpoint was probed to avoid.
      if (!spot) throw new Error("get_spot_prices returned no readable bid/ask");
      return json({ ok: true, symbol: SYMBOL_IDS[0], ...spot });
    }

    const dealArgs = {
      fromTimestamp: String(foldFrom),
      toTimestamp:   String(to),
      maxRows: MAX_ROWS,
    };

    /* ?raw=1 — WHAT THE BROKER ACTUALLY SENT, which is the question a wrong row
       raises and the one thing nothing else here can answer. A trade with an
       inverted direction or a missing entry price is either a fold this
       function got wrong or a response cTrader shaped differently, and the two
       repairs are opposite: ?force=1&hours=N for the first, a code change for
       the second. Guessing which has already cost a day.

       It writes nothing and reads nothing but the same get_deals the poll was
       about to make, so it is safe to run at any time. Returned as text rather
       than JSON because the SSE framing and the double-encoded payload are
       half of what is being looked at — parsing it away would hide the layer
       the question is usually about. */
    if (raw) {
      const body = await mcpPost(sid, "get_deals", dealArgs);
      return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    const data = await mcpCall(sid, "get_deals", dealArgs);

    /* TRUNCATION IS DATA LOSS, SO IT IS AN ERROR — AND IT IS CHECKED BEFORE
       ANYTHING IS WRITTEN.

       A truncated window can return a position's closing deals without its
       entry, and foldPosition then reads direction off a close and inverts it,
       along with entry_time, entry_price and open_day. This check used to sit
       after the upsert, on the reasoning that the write had already happened
       and nothing was lost by throwing — but that is backwards: the rows it
       would have stopped are exactly the wrong ones, and they are now in the
       table. Refusing to write is what "failing loudly" has to mean here.

       It also used to return `truncated: true` in a 200 body, which
       net.http_post discards — so the one signal that trades were being dropped
       was reported to nobody, forever.

       THE TEST IS OUR OWN CAP, NOT THE VENDOR'S FLAG. A response holding
       maxRows deals is one this function asked to be cut, and a cut page is how
       a position loses its entry deal. `hasMore` means something else — that
       more deals exist beyond the window asked for — which is true of almost
       every run and says nothing about whether this page was truncated. Reading
       it as truncation would hand cTrader the ability to halt the journal by
       changing what a field means, and the halt would be silent, because
       net.http_post discards this response. It is reported instead. */
    const rawDeals = (data.deals ?? []).length;
    if (rawDeals >= MAX_ROWS) {
      throw new Error(
        `get_deals returned ${rawDeals} deals, at the ${MAX_ROWS} cap, over a ` +
        `${foldHours(hours)}h fold window — the page was cut and some positions ` +
        `may be folded without their entry deal. Nothing was written.`);
    }

    const deals: Deal[] = (data.deals ?? [])
      .filter((d: Deal) => d.dealStatus === "FILLED")
      .filter((d: Deal) => SYMBOL_IDS.includes(d.symbolId));

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
      // Reported rather than acted on: it says more deals exist beyond the
      // window, which is true of almost every run.
      has_more: data.hasMore ?? null,
    });
  } catch (err) {
    console.error("doji-mcp-sync:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
