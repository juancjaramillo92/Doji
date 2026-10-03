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
  env, secretMatches, json, marketOpen, nyDate, sbHeaders, heartbeat, mcpInit, parseSse,
  SB_URL, SB_KEY,
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

/* `balance=is.null` in the filter is the whole arbitration with the email,
   whose figure — printed by the broker on the fill — is the better one.
   Postgres evaluates it inside the UPDATE, so there is no read to race. A
   PATCH rather than an upsert key, because merge-duplicates would overwrite
   the email's figure on every later re-upsert. */
async function writeBalance(id: string, balance: number) {
  const res = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&balance=is.null`, {
    method: "PATCH", headers: sbHeaders(), body: JSON.stringify({ balance }),
  });
  if (!res.ok) throw new Error(`Balance write failed (HTTP ${res.status}): ${await res.text()}`);
}

/* ─── The plan, taken off the position while it is still open ──────────────
   A closed position reports only its final stop; a live one carries both, and
   the poller sees almost every position open. So the first sighting is the
   plan, and `where planned_sl is null` is the whole arbitration — any later
   write would file R-04's break-even stop as the plan. As first seen, never as
   set: up to two minutes separate entry from poll.

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

/* Answers whether it wrote. A PATCH filtered to nothing is a 200 with no rows,
   so only `return=representation` tells a recorded plan from a skipped one;
   without it this reads 0 for ever, which looks healthy. A test reads for it. */
async function writePlan(plan: OpenPlan): Promise<number> {
  // One PATCH per column on its own filter: a filter cannot arbitrate a
  // column it does not name.
  let wrote = 0;
  for (const col of ["planned_sl", "planned_tp"] as const) {
    const value = plan[col];
    if (value === undefined) continue;

    const res = await fetch(
      `${SB_URL}/rest/v1/trades?id=eq.${plan.id}&${col}=is.null`, {
        method: "PATCH", headers: sbHeaders("return=representation"),
        body: JSON.stringify({ [col]: value }),
      });
    if (!res.ok) throw new Error(`Plan write failed (HTTP ${res.status}): ${await res.text()}`);
    if (((await res.json()) as unknown[]).length > 0) wrote++;
  }
  return wrote;
}

/* ─── Every stop and target, as they move ──────────────────────────────────
   R-19 asks where the stop and target sat when a print landed, and a closed
   position reports only its last. A row per change, never per poll: a
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

/* ─── The close instant ────────────────────────────────────────────────────
   fill_time had one writer, the alert email, so a close with no alert left it
   null for ever and everything reading it as "still open" said so. This sees
   every close within two minutes, and stamps it under `where fill_time is
   null` — the email still wins wherever it lands. The caller passes only
   positions with an exit price, so the latest deal is the closing one.

   Counted on the answer, for writePlan's reason; steady state is 0. The
   trigger this sets off is the point: trades_eugenia_closed fires on exactly
   this transition, and it is how she learns a position closed. */
async function writeFill(id: string, closedAt: number): Promise<boolean> {
  const res = await fetch(
    `${SB_URL}/rest/v1/trades?id=eq.${id}&fill_time=is.null`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({ fill_time: new Date(closedAt).toISOString() }),
    });
  if (!res.ok) throw new Error(`Fill write failed (HTTP ${res.status}): ${await res.text()}`);
  return ((await res.json()) as unknown[]).length > 0;
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
export interface Bar { timestamp: number; high: number; low: number }
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

/* Four hours a request: nothing has established how many bars one answer
   carries, and a page cut short reports a best price low, silently. */
const BAR_CHUNK_MS = 4 * 3600_000;

async function readBars(session: Record<string, string>, from: number, to: number): Promise<Bar[]> {
  const bars: Bar[] = [];
  for (let at = from; at < to; at += BAR_CHUNK_MS) {
    const got = await mcpCall(session, "get_trendbars", {
      symbolId: SYMBOL_IDS[0], period: "M_1",
      fromTimestamp: String(at), toTimestamp: String(Math.min(at + BAR_CHUNK_MS, to) - MINUTE),
    });
    bars.push(...(got.trendbars ?? []));
  }
  return bars;
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
    const best = bestPrice(await readBars(session, span.from, span.to), t.direction, t.entry, t.close);
    if (best === null) continue;
    const patch = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${t.id}&best_price=is.null`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({ best_price: best }),
    });
    if (!patch.ok) throw new Error(`Excursion write failed (HTTP ${patch.status}): ${await patch.text()}`);
    if (((await patch.json()) as unknown[]).length > 0) wrote++;
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
    // The read-only probes answer over the weekend, when rows get looked at.
    if (!force && !raw && !tools && !posns && !market && !marketRaw && !bars && !marketOpen()) {
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
      return new Response(await listed.text(),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    /* ?positions=1 — get_positions raw: whether a live position carries its
       stop and target, and on which scale. The probe that established the
       plan. */
    if (posns) {
      const body = await mcpPost(session, "get_positions", {});
      return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
        return new Response(`--- get_spot_prices ---\n${spot}\n--- get_trendbars D_1 by range ---\n${bars}`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      const quoted = await mcpCall(session, "get_spot_prices", { symbolId: SYMBOL_IDS });
      const spot = foldSpot((quoted.prices ?? [])[0]);
      // Thrown rather than served empty: an unreadable price is not zero.
      if (!spot) throw new Error("get_spot_prices returned no readable bid/ask");
      return json({ ok: true, symbol: SYMBOL_IDS[0], ...spot });
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
        }).catch((err: unknown) => `FAILED: ${err instanceof Error ? err.message : err}`);
        parts.push(`--- get_trendbars M_1, ${w.days} days back, from ` +
          `${new Date(w.from).toISOString()}, ${Date.now() - began} ms ---\n${body}`);
      }
      return new Response(parts.join("\n"),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
      return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
    const folded = [...byPosition.values()]
      .filter(ds => ds.some(d => d.executionTimestamp >= from))
      .map(ds => ({
        row: foldPosition(ds, USER_ID),
        closedAt: Math.max(...ds.map(d => d.executionTimestamp)),
      }));
    const n = await upsert(folded.map(f => f.row));

    /* After the upsert, because a PATCH on an id not yet inserted matches
       nothing and reports success. It never takes the poll down: the deals are
       already written. */
    let stamped = 0;
    try {
      for (const f of folded.filter(f => f.row.exit_price !== null)) {
        if (await writeFill(f.row.id, f.closedAt)) stamped++;
      }
    } catch (err) {
      console.error("doji-mcp-sync: close instant not recorded —",
        err instanceof Error ? err.message : err);
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
      await writeBalance(target, Math.round(account.balance / 10 ** account.moneyDigits * 100) / 100);
    }

    // The plan and the stops: after the upsert and never fatal, for the close
    // instant's reasons.
    let planned = 0, stops = 0;
    try {
      const open = await mcpCall(session, "get_positions", {});
      const plans = openPlans(open.positions ?? []);
      // Sequential: a handful of single-row PATCHes. Counted on the answer:
      // steady state is 0, and a filter that stopped filtering reads 1 forever.
      for (const plan of plans) planned += await writePlan(plan);
      stops = await recordStops(plans);
    } catch (err) {
      console.error("doji-mcp-sync: plan not recorded —",
        err instanceof Error ? err.message : err);
    }

    // Last, being the one step that reads the table; never fatal either.
    let excursions = 0;
    try {
      excursions = await fillExcursions(session);
    } catch (err) {
      console.error("doji-mcp-sync: excursion not recorded —",
        err instanceof Error ? err.message : err);
    }

    // Marked after every step, so it means the deals landed.
    await heartbeat("poller");

    return json({
      ok: true, window_hours: hours, fold_hours: foldHours(hours),
      deals: deals.length, positions: n, balance_for: target, planned, stamped, stops, excursions,
      // Reported, not acted on: true of almost every run.
      has_more: data.hasMore ?? null,
    });
  } catch (err) {
    console.error("doji-mcp-sync:", err instanceof Error ? err.message : err);
    // The only record of a poll that failed at 03:00.
    await heartbeat("poller", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
