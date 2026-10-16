// ═══════════════════════════════════════════════════════════════════════════
// DOJI — cTrader MCP sync  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// Polls cTrader for deal history, folds deals into positions, and upserts one
// row per position into `trades`.
//
// Broker-owned columns only. merge-duplicates sets exactly the keys present,
// so the journal answers and `deleted` are never named and cannot be touched —
// which is also what stops a re-upsert resurrecting a trade he deleted.
//
// SECURITY CONTRACT
//   1. ALLOWED_TOOLS is a hardcoded whitelist of read tools; mcpPost() throws
//      on anything else, and is the only place a tool name becomes a request.
//   2. Every request presents DOJI_CRON_SECRET on x-doji-key. verify_jwt is
//      off, so authorisation is here, before any work.
//   3. No value from the request reaches an MCP call. The body is never read;
//      the query flags are fixed choices except `hours`, which is clamped. No
//      code path constructs an order.
//   4. Tokens live only in Deno.env — never logged, returned or stored.
//
// Deploy:  supabase functions deploy doji-mcp-sync --no-verify-jwt
// Secrets: CTRADER_MCP_TOKEN, DOJI_USER_ID, DOJI_CRON_SECRET, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════

import {
  env, secretMatches, json, marketOpen, nyClock, nyDate, sbHeaders, heartbeat, mcpInit, parseSse,
  SB_URL, SB_KEY, why, CHARTS, type Candle
} from "../_shared/edge.ts";

const MCP_URL   = env("CTRADER_MCP_URL") || "https://mcp.ctrader.com/trading/mcp";
const MCP_TOKEN = env("CTRADER_MCP_TOKEN");

/* ─── Credentials ──────────────────────────────────────────────────────────
   Two secrets, because they answer different questions. DOJI_CRON_SECRET asks
   "may this caller start a poll?" and carries no database power: against this
   function a holder can start a read-only poll or read deals back with ?raw=1.
   (Two other functions take the same secret, where it is not harmless — see
   the README.) SB_SECRET_KEY asks "may this function write?", bypasses RLS and
   never leaves this runtime: the thing scheduled every two minutes is not the
   thing that can write.
   ───────────────────────────────────────────────────────────────────────── */
const CRON_SECRET = env("DOJI_CRON_SECRET");

// auth.uid() is null under the secret key, so the owner is supplied. Missing,
// the function refuses: a poller that reports success and writes nothing is
// the worst failure shape there is.
const USER_ID = env("DOJI_USER_ID");

/* ─── Reading a window out of configuration ────────────────────────────────
   Hours, clamped to cTrader's 720h cap, or null for anything not a positive
   number — `Number("6h")` is NaN, and NaN survives Math.min and reaches
   get_deals as "NaN".
   ───────────────────────────────────────────────────────────────────────── */
const clampHours = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 720) : null;
};

/* An env var is read with nobody watching, so present-and-wrong throws rather
   than quietly becoming the default. Absent means the default. */
function envHours(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const hours = clampHours(raw);
  if (hours === null) throw new Error(`${name} is not a positive number of hours: ${raw}`);
  return hours;
}

/* ─── Write window ─────────────────────────────────────────────────────────
   Which positions get upserted: wider than the cron interval, so a missed run
   heals on the next. Six hours rather than 720, because Postgres does not skip
   no-op updates — each rewrite fires updated_at and a realtime UPDATE, and
   thirty days of positions every two minutes kept every open tab re-rendering.
   Six still survives 180 missed runs.
   ───────────────────────────────────────────────────────────────────────── */
const DEFAULT_LOOKBACK = envHours("LOOKBACK_HOURS", 6);

// `?hours=` for a backfill, clamped. A bad value falls back rather than
// refusing: it arrives on a URL, where the caller sees the typo at once.
export function lookbackFor(url: URL): number {
  return clampHours(url.searchParams.get("hours")) ?? DEFAULT_LOOKBACK;
}

/* ─── Fold window ──────────────────────────────────────────────────────────
   Which deals get READ — a different question. Over the write window alone,
   a long position's close arrives without its entry, the close is taken as
   the entry, and the direction inverts. So deals are read over the write
   window plus MAX_POSITION_HOURS, in the same single call, and a position is
   written only if one of its deals landed inside the write window.

   72h covers a weekend hold. It bounds how long a position may live; raise it
   if that ever stops being true.
   ───────────────────────────────────────────────────────────────────────── */
const MAX_POSITION_HOURS = envHours("MAX_POSITION_HOURS", 72);

export const foldHours = (writeHours: number) =>
  Math.min(writeHours + MAX_POSITION_HOURS, 720);

/* ─── Balance window ───────────────────────────────────────────────────────
   get_balance answers "worth what NOW"; the column asks "worth what after THIS
   fill". Those agree only on a close the poller has just seen, so ten minutes.
   An older close gets no balance: a missing figure is honest, a wrong one is
   permanent. This is also what keeps a ?force=1 backfill off every historical
   balance.
   ───────────────────────────────────────────────────────────────────────── */
const BALANCE_MAX_AGE_MS = 10 * 60_000;

// The latest close, if recent enough — null also means do not call
// get_balance. One position only: two closes in one run share a single
// balance, and only the later one ended at it.
export function balanceTarget(closes: { id: string; at: number }[], now: number): string | null {
  let best: { id: string; at: number } | null = null;
  for (const c of closes) if (!best || c.at > best.at) best = c;
  return best && now - best.at <= BALANCE_MAX_AGE_MS ? best.id : null;
}

/* XAUUSD on this account, overridable for a broker change. Positive integers
   only, and none throws: `SYMBOL_IDS=","` once parsed to [0], matching no deal
   and reporting success on every run. A refused poll is visible in minutes.
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

/* Every one read-only, and this list is the only thing making that true.
   ?tools=1 showed the endpoint also serves create_order, close_position,
   amend_position, amend_order and cancel_order on the same credential. So this
   array is what stands between this system and a placed trade: every name
   carries readOnlyHint on the broker's listing, and adding one changes what
   this function is. A read-only token would retire it. */
const ALLOWED_TOOLS = [
  "get_deals", "get_balance", "get_positions", "get_spot_prices", "get_trendbars",
] as const;
type AllowedTool = typeof ALLOWED_TOOLS[number];

// Named so a test can assert none is ever reachable.
export const DESTRUCTIVE_TOOLS = [
  "create_order", "close_position", "amend_position", "amend_order", "cancel_order",
] as const;

/* ─── MCP transport ────────────────────────────────────────────────────────
   Handshake and framing are in _shared; the endpoint and token are this
   function's own.
   ───────────────────────────────────────────────────────────────────────── */
const MCP_HEADERS = {
  "Authorization": `Bearer ${MCP_TOKEN}`,
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
};

/* The request alone, so ?raw=1 can have the body whole and mcpCall unwrapped,
   from one statement of the request. The allow-list check is here because
   this is where a tool name becomes a request. */
// The debug doors answer as text, so the SSE framing they are about is visible.
const text = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });

async function mcpPost(session: Record<string, string>, tool: AllowedTool, args: Record<string, unknown>): Promise<string> {
  if (!ALLOWED_TOOLS.includes(tool)) throw new Error(`Tool not permitted: ${tool}`);

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: session,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  // So ?raw=1 cannot pass off a 401 body as what the broker sent.
  if (!res.ok) throw new Error(`MCP ${tool}: HTTP ${res.status}`);
  return res.text();
}

async function mcpCall(session: Record<string, string>, tool: AllowedTool, args: Record<string, unknown>) {
  const envelope = parseSse(await mcpPost(session, tool, args));
  if (envelope.error) throw new Error(`MCP ${tool}: ${envelope.error.message}`);

  // The result is a text block holding a JSON document: parsed twice.
  const text = envelope?.result?.content?.[0]?.text;
  if (!text) throw new Error(`MCP ${tool}: empty result`);
  return JSON.parse(text);
}

/* ─── Two scales on one endpoint ───────────────────────────────────────────
   Established by probe, because the documentation is silent: get_spot_prices
   serves PIPETTES (441982000 is 4419.82) and get_positions serves DISPLAY
   prices, on the same account and symbol. A price a hundred thousand times
   wrong still looks like gold, so the scale is named once and applied in one
   place — the spot read. */
export const PIPETTES = 100_000;
export const fromPipettes = (n: number) => Math.round(n / PIPETTES * 100) / 100;

/* Where gold is and what it did since the roll, from one call. sessionClose
   is the previous session's close — 17:00 New York for gold — so the move is
   a subtraction.

   A price that will not parse is null rather than NaN, and the type admits
   the null so every caller must handle it: forced to `number`, a missing
   sessionClose once opened his briefing "against a previous close of null —
   up 0 since it". */
export interface Spot {
  bid: number; ask: number; high: number; low: number;
  prev_close: number | null; change: number | null; at: string;
}

export function foldSpot(price: any): Spot | null {
  const at = (k: string) => {
    const n = Number(price?.[k]);
    return Number.isFinite(n) ? fromPipettes(n) : null;
  };
  const bid = at('bid'), ask = at('ask'), prev = at('sessionClose');
  if (bid === null || ask === null) return null;

  // Null without a previous close: a zero would claim nothing moved.
  const change = prev === null ? null : Math.round((bid - prev) * 100) / 100;

  return {
    bid, ask, high: at('high') ?? bid, low: at('low') ?? bid,
    prev_close: prev,
    change,
    at: new Date(Number(price?.timestamp) || Date.now()).toISOString(),
  };
}

/* ─── Units ────────────────────────────────────────────────────────────────
   Verified against position 562780708, whose email reported 57.24 gross /
   57.10 net: volume 200 → 2.00 oz, commission -7 → -$0.07. get_balance states
   its own scale (moneyDigits), and the balance write reads that.
   ───────────────────────────────────────────────────────────────────────── */
export const ozFromVolume = (v: number) => v / 100;
export const usdFromCents = (c: number) => c / 100;

// Deals carry an epoch.
export const nyDay = (ms: number): string => nyDate(new Date(ms));

/* ─── Deal folding ─────────────────────────────────────────────────────────
   A position is the deals sharing a positionId. Sorted by time, the first is
   the entry and anything on the opposite side after it is a close; same-side
   deals are scale-ins, never closes.

   Direction comes from the first deal and nowhere else: get_position_details
   on a closed position is hollow, and its tradeSide is the CLOSING side.
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

  // Closed once closing volume covers everything opened; a partial close
  // leaves the position live.
  const isClosed = closes.length > 0 && closeOz >= openOz - 1e-9;

  // Volume-weighted, so a scaled entry or exit reports one price.
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

/* One column, written once. `<column>=is.null` in the filter is the whole
   arbitration — Postgres evaluates it inside the UPDATE, so there is no read to
   race — and a PATCH rather than an upsert, because merge-duplicates would set
   the column on every later re-upsert. It is how the poller yields `balance`
   and `fill_time` to the email, which owns them, and keeps the plan and
   `best_price` at their first sighting.

   It answers whether it wrote. A PATCH filtered to nothing is a 200 with no
   rows, so only `return=representation` tells a write from a skip; without it
   every count beside this reads 0 for ever, which looks healthy. */
async function writeOnce(id: string, column: string, value: unknown): Promise<boolean> {
  const res = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&${column}=is.null`, {
    method: "PATCH", headers: sbHeaders("return=representation"),
    body: JSON.stringify({ [column]: value }),
  });
  if (!res.ok) throw new Error(`${column} write failed (HTTP ${res.status}): ${await res.text()}`);
  return ((await res.json()) as unknown[]).length > 0;
}

/* ─── The plan, taken off the position while it is still open ──────────────
   A closed position reports only its final stop; a live one carries both, and
   the poller sees almost every position open. So the first sighting is the
   plan, written once — any later write would file R-04's break-even stop as
   the plan. As first seen, never as set: up to two minutes separate entry from
   poll.

   It never throws the poll away: the deals are written first, and a plan that
   fails is one trade with a null.
   ───────────────────────────────────────────────────────────────────────── */
export interface OpenPlan { id: string; planned_sl?: number; planned_tp?: number }

/* Pure, so the broker's shape can be driven from a test. Display prices:
   fromPipettes here would file a stop at four hundredths of a cent.

   Each side stands alone. Requiring both meant a stop-only entry recorded
   nothing, so a target added later found `planned_sl is null` still true
   after R-04 had moved the stop — and filed break-even as the plan. Nothing
   divides by a missing side; the ratio is arithmetic he runs (§6 step 4).

   A position carrying neither stays in the list: the stop history reads it,
   and both sides pulled is the largest move R-19 can see. */
export function openPlans(positions: any[]): OpenPlan[] {
  return (positions ?? []).flatMap((p: any) => {
    const id = Number(p?.positionId);
    if (!Number.isInteger(id) || id <= 0) return [];

    const side = (k: string) => {
      const n = Number(p?.[k]);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return [{ id: `PID${id}`, planned_sl: side('stopLoss'), planned_tp: side('takeProfit') }];
  });
}

/* ─── A fold missing its entry ─────────────────────────────────────────────
   A position that outlived the fold window closes without its entry deal in
   view: the close is taken as the entry, the direction inverts, and the fold
   reads open. Upserted, that overwrites the right direction and entry the poll
   wrote while the position was live, and the email's direction after it.

   The broker's own list of live positions says what the deals cannot: a fold
   the deals call open that the broker no longer lists has lost its entry. Read
   after the deals, so a position that closes between the two reads is skipped
   for one poll and written whole on the next, never written sliced. Pure, so
   the decision is driven; `live` null is a list that could not be read, and
   then nothing is held back. */
export function sliced(rows: { id: string; exit_price: number | null }[],
                       live: OpenPlan[] | null): string[] {
  if (!live) return [];
  const open = new Set(live.map(p => p.id));
  return rows.filter(r => r.exit_price === null && !open.has(r.id)).map(r => r.id);
}

// One write per column, each on its own filter: a filter cannot arbitrate a
// column it does not name.
async function writePlan(plan: OpenPlan): Promise<number> {
  let wrote = 0;
  for (const col of ["planned_sl", "planned_tp"] as const) {
    if (plan[col] !== undefined && await writeOnce(plan.id, col, plan[col])) wrote++;
  }
  return wrote;
}

/* ─── Every stop and target, as they move ──────────────────────────────────
   R-19 asks where the stop and target sat when a print landed, R-02 whether
   the stop ever moved away from entry, and a closed position reports only its
   last. A row per change, never per poll: a
   position whose latest row matches the broker gets nothing. A side the
   broker stopped carrying is a change, written as null, so a pulled target is
   not read as still resting. Pure; `latest` is newest first. */
export interface StopRow { id: string; sl: number | null; tp: number | null }

export function stopChanges(plans: OpenPlan[], latest: StopRow[]): StopRow[] {
  const last = new Map<string, StopRow>();
  for (const r of latest) if (!last.has(r.id)) last.set(r.id, r);
  // PostgREST serves numeric as a number or a string, by size.
  const eq = (stored: number | null, seen: number | null) =>
    stored == null ? seen == null : Number(stored) === seen;
  return plans.flatMap(p => {
    const now = { id: p.id, sl: p.planned_sl ?? null, tp: p.planned_tp ?? null };
    const was = last.get(p.id);
    return was && eq(was.sl, now.sl) && eq(was.tp, now.tp) ? [] : [now];
  });
}

async function recordStops(plans: OpenPlan[]): Promise<number> {
  if (!plans.length) return 0;
  const ids = plans.map(p => p.id).join(',');
  const res = await fetch(
    `${SB_URL}/rest/v1/trade_stops?select=id,sl,tp&id=in.(${ids})` +
    `&order=seen_at.desc&limit=${plans.length * 20}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Stop read failed (HTTP ${res.status}): ${await res.text()}`);

  const moved = stopChanges(plans, await res.json());
  if (!moved.length) return 0;
  const put = await fetch(`${SB_URL}/rest/v1/trade_stops`, {
    method: "POST", headers: sbHeaders("return=minimal"), body: JSON.stringify(moved),
  });
  if (!put.ok) throw new Error(`Stop write failed (HTTP ${put.status}): ${await put.text()}`);
  return moved.length;
}

/* ─── How far the trade ran in his favour ──────────────────────────────────
   The broker keeps minute bars for a year, so the best price a position saw —
   the one fact R-04 turns on — is recoverable for every trade.

   Only whole minutes inside the trade: an edge bar holds prices from before he
   was in or after he was out. So the figure can miss a spike but never report
   one that did not happen to him, and a trade under a minute stays null.

   Bars are in PIPETTES, like the spot read — the second place fromPipettes
   applies. Pure and exported; barSpan sizes the request, and the filter keeps
   a broker that answers wider than asked from putting an edge bar in. */
export interface Bar { timestamp: number; open: number; high: number; low: number; close: number }
const MINUTE = 60_000;

export function barSpan(entryMs: number, closeMs: number): { from: number; to: number } | null {
  const from = Math.ceil(entryMs / MINUTE) * MINUTE;
  const to = Math.floor(closeMs / MINUTE) * MINUTE;
  return to - from >= MINUTE ? { from, to } : null;
}

export function bestPrice(bars: Bar[], direction: string, entryMs: number, closeMs: number): number | null {
  const span = barSpan(entryMs, closeMs);
  if (!span || (direction !== "BUY" && direction !== "SELL")) return null;
  const inside = (bars ?? []).filter(b => b.timestamp >= span.from && b.timestamp + MINUTE <= span.to);
  if (!inside.length) return null;

  // A bar that will not parse refuses the figure: the dropped bar could hold
  // the extreme, and a short figure is the error this column must not make.
  const side = direction === "BUY" ? inside.map(b => Number(b.high)) : inside.map(b => Number(b.low));
  if (side.some(n => !Number.isFinite(n) || n <= 0)) return null;
  return fromPipettes(direction === "BUY" ? Math.max(...side) : Math.min(...side));
}

/* ─── What one bar read can carry ──────────────────────────────────────────
   get_trendbars counts its answer back from toTimestamp: 100 bars unless
   `count` asks for more, never more than 1000, over a window of 30 days at
   most — its own description, kept in test/fixtures/ctrader-get-trendbars.json.
   Asked without `count`, a window over 100 bars comes back as its newest 100
   and says nothing of the rest. So every read asks for the most, a window is
   split well inside both limits, and an answer holding the most is a cut
   page, thrown rather than trusted. */
export const BAR_MAX = 1000;
export const RANGE_MAX_MS = 30 * 86_400_000;
const WINDOW_BARS = 900;

// Pure, so the splitting is driven. Windows meet at their edges, and a bar
// there comes back twice; both readers below are indifferent to that.
export function barWindows(from: number, to: number, ms: number): { from: number; to: number }[] {
  const span = Math.min(RANGE_MAX_MS, WINDOW_BARS * ms);
  const out: { from: number; to: number }[] = [];
  for (let at = from; at < to; at += span) out.push({ from: at, to: Math.min(at + span, to) });
  return out;
}

async function readTrendbars(session: Record<string, string>, period: string, ms: number,
                             from: number, to: number): Promise<Bar[]> {
  const bars: Bar[] = [];
  for (const w of barWindows(from, to, ms)) {
    const got = await mcpCall(session, "get_trendbars", {
      symbolId: SYMBOL_IDS[0], period, count: BAR_MAX,
      fromTimestamp: String(w.from), toTimestamp: String(w.to),
    });
    const page: Bar[] = got.trendbars ?? [];
    if (page.length >= BAR_MAX) throw new Error(`get_trendbars ${period} answered ${page.length} bars, its most: the window was cut`);
    bars.push(...page);
  }
  return bars;
}

/* ─── The day's bars, for Eugenia's own calls ──────────────────────────────
   She makes paper calls on his rules and they are scored at night on what
   price did, which needs the path, not a quote. She never holds the broker
   token, so the read is a door here, and like every door it takes nothing from
   the request: the window is fixed. Thirty hours reaches a call made just after
   one 17:00 roll from the 22:00 pass after the next, and a Sunday call from
   before the open.

   Display prices, open to close, oldest first. A bar that will not read refuses
   them all, as bestPrice refuses a figure: a dropped bar could hold the stop. */
export const CALL_HOURS = 30;

export function foldCandles(bars: Bar[]): Candle[] | null {
  const out: Candle[] = bars.map(b => ({
    t: Number(b.timestamp), open: Number(b.open), high: Number(b.high),
    low: Number(b.low), close: Number(b.close),
  }));
  if (!out.every(c => Number.isFinite(c.t) &&
                      [c.open, c.high, c.low, c.close].every(n => Number.isFinite(n) && n > 0))) return null;
  // Chunks meet at their edges, so a bar can come back twice.
  const byMinute = new Map(out.map(c => [c.t, c]));
  return [...byMinute.values()].sort((a, b) => a.t - b.t).map(c => ({
    t: c.t, open: fromPipettes(c.open), high: fromPipettes(c.high),
    low: fromPipettes(c.low), close: fromPipettes(c.close),
  }));
}

/* His charts up to `to`, at CHARTS' windows. One chart at a time, each failure
   its own, for ?bars=raw's reason; a chart that will not read is named rather
   than served short, and the rest are still worth having. */
async function readCharts(session: Record<string, string>, to: number, charts: readonly typeof CHARTS[number][] = CHARTS) {
  const out: Record<string, Candle[]> = {};
  const missing: { period: string; error: string }[] = [];
  for (const c of charts) {
    try {
      const candles = foldCandles(await readTrendbars(session, c.period, c.ms, to - c.hours * 3600_000, to));
      if (!candles) throw new Error("a bar that will not read");
      if (!candles.length) throw new Error("no bars");
      out[c.period] = candles;
    } catch (err) {
      missing.push({ period: c.period, error: why(err) });
    }
  }
  return { charts: out, missing };
}

/* ─── His charts at his own entries ────────────────────────────────────────
   For scripts/calibrate.mjs, which folds her map at the minute of each of his
   newest entries and asks whether it had the level he traded. The trades come
   from the table, never the request, so the door still puts nothing a caller
   sends into a broker call. The two level charts and the two bigger ones the
   map reads highs and lows off, and only bars closed by the minute he clicked:
   one that closed after it holds prices he could not have seen, and a map
   drawn from it would find his level by looking ahead. */
const ENTRIES = 20;
const ENTRY_CHARTS = CHARTS.filter(c => ["D_1", "H_4", "H_1", "M_30"].includes(c.period));

async function readEntries(session: Record<string, string>) {
  const res = await fetch(
    `${SB_URL}/rest/v1/trades?select=id,direction,entry_time,entry_price` +
    `&entry_time=not.is.null&entry_price=not.is.null&deleted=is.false&id=like.PID*` +
    `&order=entry_time.desc&limit=${ENTRIES}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Entry read failed (HTTP ${res.status}): ${await res.text()}`);
  const out = [];
  for (const t of await res.json() as { id: string; direction: string; entry_time: string; entry_price: number }[]) {
    const at = Math.floor(Date.parse(t.entry_time) / MINUTE) * MINUTE;
    const { charts, missing } = await readCharts(session, at, ENTRY_CHARTS);
    for (const c of ENTRY_CHARTS) charts[c.period] = charts[c.period]?.filter(b => b.t + c.ms <= at);
    out.push({ ...t, at, charts, missing });
  }
  return out;
}

/* ─── A past session, as she would have seen it ────────────────────────────
   For scripts/replay.mjs, which asks her for the call she would have made on a
   past morning and scores it as the nightly pass does. `?replay=N` is the
   weekday N back, clamped to REPLAY_DAYS as `?hours=` is clamped: the door
   turns it into that day's 08:00 New York, the briefing's hour, so all it puts
   into a broker call is an instant it chose itself. His six charts as they
   stood then, only bars closed by it — one closed after holds prices she could
   not have seen — and the minute bars from then to the 17:00 roll, which the
   call is scored against. Weekdays, not sessions: a holiday serves no bars.
   ───────────────────────────────────────────────────────────────────────── */
export const REPLAY_DAYS = 120;
const REPLAY_FROM = 8, REPLAY_ROLL = 17;

export function replayDays(raw: string | null): number | null {
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= 1 && n <= REPLAY_DAYS ? n : null;
}

/* Midday New York in either season is 16:00 UTC, and eight hours either side
   holds both hours of that civil day once each. */
export function replaySession(n: number, now: number): { at: number; ends: number } {
  const [y, m, d] = nyDate(new Date(now)).split("-").map(Number);
  let noon = Date.UTC(y, m - 1, d, 16);
  for (let left = n; left > 0;) {
    noon -= 86_400_000;
    if (new Date(noon).getUTCDay() % 6) left--;
  }
  const hour = (h: number) => {
    for (let t = noon - 8 * 3600_000; t <= noon + 8 * 3600_000; t += 3600_000) {
      if (nyClock(new Date(t)).hour === h) return t;
    }
    throw new Error(`no ${h}:00 New York on ${nyDate(new Date(noon))}`);
  };
  return { at: hour(REPLAY_FROM), ends: hour(REPLAY_ROLL) };
}

/* The newest closed trades still missing a figure, a few a poll — one path for
   a fresh close and for the year behind it, newest first so a new close never
   queues behind the backlog. Too short to measure is skipped at no broker
   cost; no bars back is asked again next time. `best_price is null` in the
   PATCH writes a figure once, and it is counted on the answer. */
const EXCURSIONS_PER_POLL = 3;

async function fillExcursions(session: Record<string, string>): Promise<number> {
  const res = await fetch(
    `${SB_URL}/rest/v1/trades?select=id,direction,entry_time,fill_time` +
    `&best_price=is.null&exit_price=not.is.null&fill_time=not.is.null` +
    `&entry_time=not.is.null&deleted=is.false&id=like.PID*` +
    `&order=entry_time.desc&limit=50`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Excursion read failed (HTTP ${res.status}): ${await res.text()}`);

  const due = ((await res.json()) as { id: string; direction: string; entry_time: string; fill_time: string }[])
    .map(t => ({ ...t, entry: +new Date(t.entry_time), close: +new Date(t.fill_time) }))
    .filter(t => barSpan(t.entry, t.close))
    .slice(0, EXCURSIONS_PER_POLL);

  let wrote = 0;
  for (const t of due) {
    const span = barSpan(t.entry, t.close) as { from: number; to: number };
    const best = bestPrice(await readTrendbars(session, "M_1", MINUTE, span.from, span.to), t.direction, t.entry, t.close);
    if (best === null) continue;
    if (await writeOnce(t.id, "best_price", best)) wrote++;
  }
  return wrote;
}

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  // Authorisation first. verify_jwt is off because sb_secret_ keys are not
  // JWTs, which moves the check into this file where it can be read. An unset
  // secret refuses; the other three are checked here so a missing one is named
  // at the door rather than as a 401 or a bad uuid downstream.
  if (!CRON_SECRET || !MCP_TOKEN || !USER_ID || !SB_KEY) {
    console.error("doji-mcp-sync: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-doji-key"), CRON_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    // ?force=1 bypasses the schedule; ?hours=N widens one call's window. The
    // read-only probes are described where they answer. None selects a tool
    // or puts request data into an MCP call.
    const url   = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const raw   = url.searchParams.get("raw") === "1";
    const tools = url.searchParams.get("tools") === "1";
    const posns = url.searchParams.get("positions") === "1";
    // Two flags rather than one string, so the gate and its test enumerate them.
    const market    = url.searchParams.get("market") === "1";
    const marketRaw = url.searchParams.get("market") === "raw";
    const bars      = url.searchParams.get("bars") === "raw";
    const day       = url.searchParams.get("bars") === "1";
    const structure = url.searchParams.get("structure") === "1";
    const entries   = url.searchParams.get("entries") === "1";
    const replay    = url.searchParams.has("replay");
    // The read-only probes answer over the weekend, when rows get looked at.
    if (!force && !raw && !tools && !posns && !market && !marketRaw && !bars && !day && !structure &&
        !entries && !replay && !marketOpen()) {
      // A skip is a completed run: unmarked, the heartbeat freezes over the
      // weekend close and reads as a dead sync every Sunday evening.
      await heartbeat("poller");
      return json({ ok: true, skipped: "market closed" });
    }

    const hours    = lookbackFor(url);
    const to       = Date.now();
    const from     = to - hours * 3600_000;               // what gets written
    const foldFrom = to - foldHours(hours) * 3600_000;    // what gets read

    const session = await mcpInit(MCP_URL, MCP_HEADERS, { name: "doji-sync", version: "3" });

    /* ?tools=1 — what the broker offers, rather than what the allow-list
       calls. A method, not a tool call, so it goes past mcpPost: the allow-list
       guards a tool name, and tools/list names none. Writes nothing. Text, so
       the SSE framing is visible. */
    if (tools) {
      const listed = await fetch(MCP_URL, {
        method: "POST",
        headers: session,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      // For mcpPost's reason.
      if (!listed.ok) throw new Error(`MCP tools/list: HTTP ${listed.status}`);
      return text(await listed.text());
    }

    /* ?positions=1 — get_positions raw: whether a live position carries its
       stop and target, and on which scale. The probe that established the
       plan. */
    if (posns) {
      const body = await mcpPost(session, "get_positions", {});
      return text(body);
    }

    /* ?market=1 is the folded quote; ?market=raw the spot and daily bars
       unparsed, which is how the two scales were found. Bars by range: the
       server refuses the `count` form its own description offers. Five days
       back for two daily bars, since a weekend is three. */
    const barArgs = {
      symbolId: SYMBOL_IDS[0], period: "D_1",
      fromTimestamp: String(to - 5 * 86_400_000),
      toTimestamp: String(to),
    };

    if (market || marketRaw) {
      if (marketRaw) {
        const [spot, bars] = await Promise.all([
          mcpPost(session, "get_spot_prices", { symbolId: SYMBOL_IDS }),
          mcpPost(session, "get_trendbars", barArgs),
        ]);
        return text(`--- get_spot_prices ---\n${spot}\n--- get_trendbars D_1 by range ---\n${bars}`);
      }

      const quoted = await mcpCall(session, "get_spot_prices", { symbolId: SYMBOL_IDS });
      const spot = foldSpot((quoted.prices ?? [])[0]);
      // Thrown rather than served empty: an unreadable price is not zero.
      if (!spot) throw new Error("get_spot_prices returned no readable bid/ask");
      return json({ ok: true, symbol: SYMBOL_IDS[0], ...spot });
    }

    /* ?bars=1 — the last CALL_HOURS of minute bars, folded, for scoring her
       calls. Thrown rather than served short when one will not read. */
    if (day) {
      const from = Math.floor((to - CALL_HOURS * 3600_000) / MINUTE) * MINUTE;
      const candles = foldCandles(await readTrendbars(session, "M_1", MINUTE, from, to));
      if (!candles) throw new Error("get_trendbars returned a bar that will not read");
      return json({ ok: true, symbol: SYMBOL_IDS[0], from, bars: candles });
    }

    /* ?structure=1 — his six charts, folded, for Eugenia's map. */
    if (structure) {
      return json({ ok: true, symbol: SYMBOL_IDS[0], at: to, ...await readCharts(session, to) });
    }

    /* ?entries=1 — his level charts at each of his newest entries, for
       scripts/calibrate.mjs. */
    if (entries) {
      return json({ ok: true, symbol: SYMBOL_IDS[0], entries: await readEntries(session) });
    }

    /* ?replay=N — his six charts at 08:00 New York N weekdays back, and that
       session's minute bars, for scripts/replay.mjs. A bad N is refused rather
       than read as a default: a replay of the wrong day scores the wrong call. */
    if (replay) {
      const n = replayDays(url.searchParams.get("replay"));
      if (n === null) return json({ ok: false, error: `replay is a whole number of weekdays, 1 to ${REPLAY_DAYS}` }, 400);
      const { at, ends } = replaySession(n, to);
      const { charts, missing } = await readCharts(session, at);
      for (const c of CHARTS) charts[c.period] = charts[c.period]?.filter(b => b.t + c.ms <= at);
      const candles = foldCandles(await readTrendbars(session, "M_1", MINUTE, at, ends));
      if (!candles) throw new Error("get_trendbars returned a bar that will not read");
      return json({ ok: true, symbol: SYMBOL_IDS[0], at, ends, charts, missing, bars: candles });
    }

    /* ?bars=raw — minute bars at six ages, raw: their shape, their scale, and
       how far back the broker keeps them. Fifteen minutes each, every aged
       window moved to 14:00 UTC Tuesday–Thursday so a weekend cannot read as
       history the broker dropped. */
    if (bars) {
      const ages = [0, 7, 30, 90, 180, 365];
      const windows = ages.map(days => {
        if (!days) return { days, from: to - 15 * 60_000 };
        const d = new Date(to - days * 86_400_000);
        while (![2, 3, 4].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1);
        return { days, from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 14) };
      });
      // One at a time, each failure its own answer: in parallel, one 504 took
      // all six.
      const parts: string[] = [];
      for (const w of windows) {
        const began = Date.now();
        const body = await mcpPost(session, "get_trendbars", {
          symbolId: SYMBOL_IDS[0], period: "M_1",
          fromTimestamp: String(w.from), toTimestamp: String(w.from + 15 * 60_000),
        }).catch((err: unknown) => `FAILED: ${why(err)}`);
        parts.push(`--- get_trendbars M_1, ${w.days} days back, from ` +
          `${new Date(w.from).toISOString()}, ${Date.now() - began} ms ---\n${body}`);
      }
      return text(parts.join("\n"));
    }

    const dealArgs = {
      fromTimestamp: String(foldFrom),
      toTimestamp:   String(to),
      maxRows: MAX_ROWS,
    };

    /* ?raw=1 — the get_deals body as sent. A wrong row is either a fold this
       got wrong or a response shaped differently, and the repairs are opposite
       (?force=1&hours=N, or a code change). Writes nothing. Text, because the
       framing and the double encoding are often what is in question. */
    if (raw) {
      const body = await mcpPost(session, "get_deals", dealArgs);
      return text(body);
    }

    const data = await mcpCall(session, "get_deals", dealArgs);

    /* Truncation is data loss, so it throws before anything is written: a cut
       page can fold a position without its entry and invert it. The test is our
       own cap, not `hasMore`, which means more deals exist beyond the window —
       true of almost every run, and not ours to halt the journal on. */
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

    // Each position folds from its complete deal set; only those that moved in
    // the write window are sent. The last deal rides along: wherever there is
    // an exit price, it is the closing one.
    const moved = [...byPosition.values()]
      .filter(ds => ds.some(d => d.executionTimestamp >= from))
      .map(ds => ({
        row: foldPosition(ds, USER_ID),
        closedAt: Math.max(...ds.map(d => d.executionTimestamp)),
      }));

    // The live positions: what `sliced` judges against, and the plan below.
    // Never fatal — a list that cannot be read holds nothing back.
    let plans: OpenPlan[] | null = null;
    try {
      plans = openPlans((await mcpCall(session, "get_positions", {})).positions ?? []);
    } catch (err) {
      console.error("doji-mcp-sync: positions not read —", why(err));
    }
    const slices = sliced(moved.map(f => f.row), plans);
    const folded = moved.filter(f => !slices.includes(f.row.id));
    const n = await upsert(folded.map(f => f.row));

    /* The close instant, which the email owns: this stamps every close it saw
       that no alert covered, so the email still wins wherever it lands. Only
       positions with an exit price, so the latest deal is the closing one; and
       the close trigger firing on this transition is how she learns a position
       closed. After the upsert, because a PATCH on an id not yet inserted
       matches nothing and reports success. It never takes the poll down: the
       deals are already written. */
    let stamped = 0;
    try {
      for (const f of folded.filter(f => f.row.exit_price !== null)) {
        if (await writeOnce(f.row.id, "fill_time", new Date(f.closedAt).toISOString())) stamped++;
      }
    } catch (err) {
      console.error("doji-mcp-sync: close instant not recorded —",
        why(err));
    }

    // get_balance is the only source of a balance — get_deals carries none —
    // and it answers "now", hence balanceTarget.
    const target = balanceTarget(
      folded.filter(f => f.row.exit_price !== null)
            .map(f => ({ id: f.row.id, at: f.closedAt })), to);

    if (target) {
      const account = await mcpCall(session, "get_balance", {});
      // Scaled by the account's own moneyDigits; absent, the figure would be
      // written 100× out and look plausible.
      if (typeof account.moneyDigits !== "number") {
        throw new Error("get_balance returned no moneyDigits — balance scale unknown");
      }
      await writeOnce(target, "balance", Math.round(account.balance / 10 ** account.moneyDigits * 100) / 100);
    }

    // The plan and the stops: after the upsert and never fatal, for the close
    // instant's reasons.
    let planned = 0, stops = 0;
    try {
      if (plans) {
        // Sequential: a handful of single-row PATCHes. Counted on the answer:
        // steady state is 0, and a filter that stopped filtering reads 1 forever.
        for (const plan of plans) planned += await writePlan(plan);
        stops = await recordStops(plans);
      }
    } catch (err) {
      console.error("doji-mcp-sync: plan not recorded —",
        why(err));
    }

    // Last, being the one step that reads the table; never fatal either.
    let excursions = 0;
    try {
      excursions = await fillExcursions(session);
    } catch (err) {
      console.error("doji-mcp-sync: excursion not recorded —",
        why(err));
    }

    // Marked after every step, so it means the deals landed.
    await heartbeat("poller");
    /* And a slice after it, so the last outcome reads as a failure in her
       briefing while the close is in the write window: the row keeps its entry
       but has no exit until a wide backfill reaches the entry. */
    if (slices.length) {
      await heartbeat("poller", new Error(
        `${slices.join(", ")} closed with the entry outside the ${foldHours(hours)}h ` +
        `fold window, so the close was not written — repair with ?force=1&hours=N ` +
        `wide enough to reach the entry`));
    }

    return json({
      ok: true, window_hours: hours, fold_hours: foldHours(hours),
      deals: deals.length, positions: n, sliced: slices, balance_for: target, planned, stamped, stops, excursions,
      // Reported, not acted on: true of almost every run.
      has_more: data.hasMore ?? null,
    });
  } catch (err) {
    console.error("doji-mcp-sync:", why(err));
    // The only record of a poll that failed at 03:00.
    await heartbeat("poller", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
