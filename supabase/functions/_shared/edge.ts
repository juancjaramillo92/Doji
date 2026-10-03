// ═══════════════════════════════════════════════════════════════════════════
// DOJI — the primitives every Edge Function needs
// ───────────────────────────────────────────────────────────────────────────
// One definition each, because two copies nothing compares drift silently —
// and secretMatches shows why a behavioural test cannot catch it: a copy
// rewritten to `===` passes every assertion while leaking through timing.
//
// This file serves nothing, which is what makes it importable: each function
// module calls Deno.serve, so importing one from another would start it inside
// the caller. Nothing here closes over one function's configuration; what
// differs is an argument.
// ═══════════════════════════════════════════════════════════════════════════

// Every Deno touch goes through here, so the modules import under plain Node
// and the tests reach their pure exports.
export const env = (k: string): string => (globalThis as any).Deno?.env?.get(k) ?? "";

/* Constant-time comparison: a plain !== leaks the secret's length and then its
   leading bytes. A null header and an unset expected secret both refuse —
   callers rely on the first, and a secret that failed to load must not admit
   everyone. */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!expected || !presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// A caught value as a message: an Error's own, anything else stringified.
export const why = (err: unknown): string => err instanceof Error ? err.message : String(err);

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* ─── PostgREST ────────────────────────────────────────────────────────────
   `sb_secret_` keys belong on `apikey` alone; PostgREST rejects them as a
   Bearer token. `prefer` is the only thing callers differ in, and naming it at
   the call site keeps an upsert directive off a PATCH.
   ───────────────────────────────────────────────────────────────────────── */
export const SB_URL = env("SUPABASE_URL");

// SB_SECRET_KEY, never SUPABASE_SECRET_KEY: Supabase owns that prefix, so no
// secret can be created under it and reading it yields "". Unset, every
// function answers 503 at its first line rather than reaching for another key.
export const SB_KEY = env("SB_SECRET_KEY");

export const sbHeaders = (prefer?: string): Record<string, string> =>
  ({ apikey: SB_KEY, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) });

/* ─── The heartbeat the two silent writers leave ───────────────────────────
   One sync_health row per writer, moved on every completed run. A heartbeat
   rather than an alarm, because an alarm cannot fire when nothing ran at all.

   It swallows everything: a monitor that can fail the work it watches is
   worse than none. `keepalive`, because both callers reach this on their way
   out and the isolate may be torn down under the PATCH. */
export async function heartbeat(who: "poller" | "email", failure?: unknown) {
  const body = failure === undefined
    ? { last_ok: new Date().toISOString() }
    : {
        last_error_at: new Date().toISOString(),
        // Both ends of 008's `between 1 and 500`: an empty message — `new
        // Error()` — is refused too, and takes last_error_at with it.
        last_error: why(failure).slice(0, 500) || "no detail",
      };
  try {
    await fetch(`${SB_URL}/rest/v1/sync_health?id=eq.${who}`, {
      method: "PATCH", headers: sbHeaders(), body: JSON.stringify(body), keepalive: true,
    });
  } catch { /* a monitor may not break the thing it monitors */ }
}

/* ─── MCP over streamable HTTP ─────────────────────────────────────────────
   cTrader and TradingView both speak it; endpoint and token are arguments.
   A session opens with `initialize`, an assigned Mcp-Session-Id is echoed on
   every later call, sessions expire within minutes so each invocation opens
   its own, and responses arrive as Server-Sent Events to be unwrapped.
   ───────────────────────────────────────────────────────────────────────── */
// The last data: frame that parses, walking back: a trailing keepalive or a
// second event must not surface as a SyntaxError.
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

/* Returns the headers every later call carries, rather than the id: the spec
   lets a server assign none. */
export async function mcpInit(url: string, headers: Record<string, string>,
                              clientInfo: { name: string; version: string }) {
  const res = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo },
    }),
  });
  // Does not echo the response body — it can carry auth detail.
  if (!res.ok) throw new Error(`MCP initialize failed (HTTP ${res.status})`);
  const sid = res.headers.get("mcp-session-id");
  const session: Record<string, string> = sid ? { ...headers, "Mcp-Session-Id": sid } : headers;

  // The spec requires this notification before normal calls are accepted.
  await fetch(url, {
    method: "POST", headers: session,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  });
  return session;
}

/* ─── Telegram ─────────────────────────────────────────────────────────────
   Two bots, one wire; each binds its own token.
   ───────────────────────────────────────────────────────────────────────── */
export const telegram = (token: string, method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json());

/* ─── The New York clock ───────────────────────────────────────────────────
   Every market decision here is kept in New York time. Intl with these parts
   requested always emits both, so an impossible response throws rather than
   quietly deciding the market is open.
   ───────────────────────────────────────────────────────────────────────── */
// The New York civil day an instant falls on, as YYYY-MM-DD — the shape
// `open_day` is compared against.
export const nyDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function nyClock(now: Date): { wd: number; hour: number } {
  // h23 rather than hour12, which can resolve to h24 and turn midnight into 24.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const at = (type: string) => parts.find(p => p.type === type)!.value;

  return { wd: WEEKDAY[at("weekday")], hour: +at("hour") };
}

/* ─── Market hours ─────────────────────────────────────────────────────────
   Gold trades Sunday 17:00 to Friday 17:00, New York. Decided here rather than
   in cron, which schedules in UTC and would be an hour wrong half the year.
   The poller and the price sense both skip the weekend close.
   ───────────────────────────────────────────────────────────────────────── */
export function marketOpen(now = new Date()): boolean {
  const { wd, hour } = nyClock(now);
  if (wd === 6) return false;                 // Saturday
  if (wd === 5 && hour >= 17) return false;   // after the Friday close
  if (wd === 0 && hour < 17) return false;    // before the Sunday open
  return true;
}
