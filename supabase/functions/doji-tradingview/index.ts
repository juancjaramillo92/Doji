// ═══════════════════════════════════════════════════════════════════════════
// DOJI — TradingView  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// Holds the TradingView sign-in, alone. TradingView adds what the broker cannot
// serve: the calendar as data, and the dollar and yields gold is priced
// against. Its own function, because the same credential serves create_alert
// and delete_watchlist — his account, kept out of Eugenia as the cTrader token
// is — and the sign-in ends in a public callback that has no place in her
// webhook.
//
// Every reader was written after its probe: ?tools=1 showed tool names that
// TradingView's documentation does not give, and ?probe= shows each answer raw.
//
// SECURITY CONTRACT
//   1. ALLOWED_TOOLS is a hardcoded list of read tools; tvPost() is the only
//      place a tool name becomes a request. Each carries readOnlyHint in the
//      listing kept in test/fixtures/tradingview-tools-list.json, which the
//      test holds it against.
//   2. ?connect=1, ?tools=1 and ?probe= present DOJI_CRON_SECRET on x-doji-key.
//      ?probe= picks from a fixed set and every argument is written here.
//   3. /client and /callback are public because they must be. /callback acts
//      only on a `state` ?connect=1 stored, compared in constant time and
//      cleared on success.
//   4. The tokens live in tradingview_auth — never logged, never returned.
//
// Deploy:  supabase functions deploy doji-tradingview --no-verify-jwt
// Secrets: DOJI_CRON_SECRET, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { env, secretMatches, json, sbHeaders, mcpInit, parseSse, nyDate, SB_URL, SB_KEY, why } from "../_shared/edge.ts";

const TV_URL = "https://mcp.tradingview.com/mcp";

const CRON_SECRET = env("DOJI_CRON_SECRET");

// Under a client metadata document, the client_id IS the URL it is served at.
const HOME = `${SB_URL}/functions/v1/doji-tradingview`;
const CLIENT_ID = `${HOME}/client`;
const REDIRECT = `${HOME}/callback`;

/* A public client: no secret, PKCE carries the proof. Served whole at /client
   and sent less its id to a dynamically registering server. */
const CLIENT = {
  client_name: "Doji",
  redirect_uris: [REDIRECT],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

const plain = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/* ─── The sign-in ──────────────────────────────────────────────────────────
   OAuth 2.1 as MCP specifies it, discovered rather than configured: the 401
   points at the resource metadata, which names the authorisation server, whose
   metadata names the rest. Typed in, each would be a copy of a fact TradingView
   can move.
   ───────────────────────────────────────────────────────────────────────── */
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

// RFC 7636's S256; its appendix gives a verifier and challenge to test against.
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/* RFC 9728's `resource_metadata` and MCP's optional `scope`, either of which
   may be absent. */
export function challenge(header: string | null): { metadata?: string; scope?: string } {
  const param = (name: string) => header?.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  return { metadata: param("resource_metadata"), scope: param("scope") };
}

/* RFC 8414's well-known paths, suffix before the URL's own path, then the bare
   origin — the specification's order. */
export function wellKnown(url: string, ...names: string[]): string[] {
  const { origin, pathname } = new URL(url);
  const path = pathname.replace(/\/$/, "");
  return names.flatMap(n => path
    ? [`${origin}/.well-known/${n}${path}`, `${origin}/.well-known/${n}`]
    : [`${origin}/.well-known/${n}`]);
}

// The first that answers; the error names every one that did not.
async function firstJson(urls: string[]): Promise<any> {
  const tried: string[] = [];
  for (const url of urls) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) return res.json();
    tried.push(`${url} → ${res.status}`);
  }
  throw new Error(`no metadata at any of: ${tried.join("; ")}`);
}

/* Whichever registration the server offers: MCP prefers a client metadata
   document, and keeps dynamic registration for older servers. */
async function register(as: any): Promise<{ clientId: string; via: string }> {
  if (as.client_id_metadata_document_supported) {
    return { clientId: CLIENT_ID, via: "client metadata document" };
  }
  if (as.registration_endpoint) {
    const res = await fetch(as.registration_endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(CLIENT),
    });
    if (!res.ok) throw new Error(`dynamic registration refused (HTTP ${res.status})`);
    return { clientId: (await res.json()).client_id, via: "dynamic registration" };
  }
  throw new Error(`the authorisation server offers neither a client metadata document nor ` +
                  `dynamic registration — it advertised: ${Object.keys(as).join(", ")}`);
}

async function connect() {
  const probe = await fetch(TV_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  const told = challenge(probe.headers.get("www-authenticate"));
  const resource = await firstJson([
    ...(told.metadata ? [told.metadata] : []), ...wellKnown(TV_URL, "oauth-protected-resource")]);

  const issuer = resource.authorization_servers?.[0];
  if (!issuer) throw new Error("TradingView's resource metadata names no authorisation server");
  const as = await firstJson(wellKnown(issuer, "oauth-authorization-server", "openid-configuration"));
  // MCP requires refusing a server that does not state S256.
  if (!as.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("the authorisation server does not advertise PKCE with S256");
  }

  const { clientId, via } = await register(as);
  const state = random(), verifier = random();
  const audience = resource.resource ?? TV_URL;
  const scope = told.scope ?? resource.scopes_supported?.join(" ");

  /* A connect starts over, old tokens included: dynamic registration mints a
     new client, and an old refresh token under it is invalid_client — a
     connection that reads as present and fails on first use. */
  await saveAuth({
    client_id: clientId, token_endpoint: as.token_endpoint, resource: audience,
    access_token: null, refresh_token: null, expires_at: null,
    pending_state: state, pending_verifier: verifier,
  });

  const authorize = new URL(as.authorization_endpoint);
  const params: Record<string, string> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state, resource: audience,
    code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256",
  };
  if (scope) params.scope = scope;
  for (const [k, v] of Object.entries(params)) authorize.searchParams.set(k, v);

  // Reported, because a read-only scope would retire the allow-list's job.
  return {
    ok: true, open_this: authorize.toString(), registered_by: via,
    scopes_asked: scope ?? null, scopes_supported: resource.scopes_supported ?? null,
  };
}

/* ─── The tokens ───────────────────────────────────────────────────────────
   In a table, not an Edge secret: the refresh token may rotate on every use
   and a function cannot rewrite its own secrets. No policy walls the row off.
   ───────────────────────────────────────────────────────────────────────── */
interface Auth {
  client_id: string; token_endpoint: string; resource: string;
  access_token: string | null; refresh_token: string | null; expires_at: string | null;
  pending_state: string | null; pending_verifier: string | null; refreshing_until: string | null;
}

async function readAuth(): Promise<Auth | null> {
  const res = await fetch(`${SB_URL}/rest/v1/tradingview_auth?id=eq.current&select=*`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`tradingview_auth: HTTP ${res.status} — has schema.sql been applied?`);
  return (await res.json())[0] ?? null;
}

// Only the keys passed are written.
async function saveAuth(fields: Partial<Auth>) {
  const res = await fetch(`${SB_URL}/rest/v1/tradingview_auth?on_conflict=id`, {
    method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({ id: "current", ...fields }),
  });
  if (!res.ok) throw new Error(`tradingview_auth: HTTP ${res.status} — has schema.sql been applied?`);
}

/* A server that rotates sends a new refresh token; one that does not sends
   none, and the old one stands. Storing the absence would end the connection
   at the next expiry, so an absent one keeps what was held. */
export function tokenFields(answer: any, now: number, held: string | null) {
  return {
    access_token: answer.access_token as string,
    refresh_token: (answer.refresh_token as string | undefined) ?? held,
    expires_at: typeof answer.expires_in === "number"
      ? new Date(now + answer.expires_in * 1000).toISOString() : null,
  };
}

/* A minute of margin. No stated expiry counts as expired: a refresh per call is
   slower, and a token used past an unrecorded expiry is an unexplained 401. */
export function fresh(auth: Pick<Auth, "access_token" | "expires_at">, now: number): boolean {
  return !!auth.access_token && !!auth.expires_at && Date.parse(auth.expires_at) - now > 60_000;
}

async function tokenRequest(auth: Auth, grant: Record<string, string>) {
  const res = await fetch(auth.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...grant, client_id: auth.client_id, resource: auth.resource }),
  });
  const answer = await res.json().catch(() => ({}));
  // OAuth's `error` code carries no secret; nothing else is echoed.
  if (!res.ok || !answer.access_token) {
    throw new Error(`TradingView's token endpoint refused (HTTP ${res.status}` +
                    `${answer.error ? `, ${answer.error}` : ""})`);
  }
  return answer;
}

/* One renewal at a time, through refreshing_until's lease: a rotating server
   may revoke the sign-in on a refresh token presented twice. Taken by a PATCH
   filtered on the lease being free or lapsed; a caller that misses waits for
   the holder's token. The row is read AGAIN once the lease is held — another
   caller may have renewed in between, and the first read's refresh token is
   then spent. */
const LEASE_MS = 30_000;
const LEASE_POLL_MS = 250, LEASE_POLLS = 40;

async function takeLease(): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await fetch(`${SB_URL}/rest/v1/tradingview_auth?id=eq.current` +
    `&or=(refreshing_until.is.null,refreshing_until.lt.${encodeURIComponent(now)})`, {
    method: "PATCH", headers: sbHeaders("return=representation"),
    body: JSON.stringify({ refreshing_until: new Date(Date.now() + LEASE_MS).toISOString() }),
  });
  if (!res.ok) throw new Error(`tradingview_auth: HTTP ${res.status} — has schema.sql been applied?`);
  return (await res.json()).length > 0;
}

/* Exported so a test can drive the real sequence: rotation across two
   refreshes, and two callers stale at once. */
export async function accessToken(): Promise<string> {
  for (let poll = 0; ; poll++) {
    const auth = await readAuth();
    if (auth && fresh(auth, Date.now())) return auth.access_token!;
    if (!auth?.refresh_token) throw new Error("TradingView is not connected — run ?connect=1 and sign in");

    if (await takeLease()) {
      const held = (await readAuth())!;
      try {
        if (fresh(held, Date.now())) {
          await saveAuth({ refreshing_until: null });
          return held.access_token!;
        }
        const next = tokenFields(
          await tokenRequest(held, { grant_type: "refresh_token", refresh_token: held.refresh_token! }),
          Date.now(), held.refresh_token);
        // Token and release in one write.
        await saveAuth({ ...next, refreshing_until: null });
        return next.access_token;
      } catch (err) {
        // Released for the next caller; failing that, it lapses.
        await saveAuth({ refreshing_until: null }).catch(() => {});
        throw err;
      }
    }
    if (poll >= LEASE_POLLS) {
      throw new Error("another caller is renewing the TradingView sign-in and has not finished");
    }
    await new Promise(r => setTimeout(r, LEASE_POLL_MS));
  }
}

async function callback(url: URL): Promise<Response> {
  const refused = url.searchParams.get("error");
  if (refused) return plain(`TradingView refused the sign-in: ${refused}`, 400);

  const auth = await readAuth();
  const code = url.searchParams.get("code");
  if (!auth?.pending_state || !auth.pending_verifier || !code ||
      !secretMatches(url.searchParams.get("state"), auth.pending_state)) {
    return plain("This sign-in was not started by ?connect=1, or has already been used.", 400);
  }

  const answer = await tokenRequest(auth, {
    grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: auth.pending_verifier,
  });
  const fields = tokenFields(answer, Date.now(), null);
  await saveAuth({ ...fields, pending_state: null, pending_verifier: null });

  // Without a refresh token the sign-in ends with the access token.
  return plain(fields.refresh_token
    ? "Connected. TradingView is signed in for Doji, and this tab can be closed."
    : `Connected, but TradingView issued no refresh token, so this sign-in ends ` +
      `${fields.expires_at ? `at ${fields.expires_at}` : "when the access token does"}. ` +
      `Run ?connect=1 again and send ?tools=1's answer with this message.`);
}

/* ─── The reads ────────────────────────────────────────────────────────────
   Every one read-only, and this list is the only thing making that true: the
   same credential serves eleven tools that change his alerts and watchlists,
   and mcp-watchlist-get-active-watchlist creates a watchlist when none is
   active. Left out on purpose: the technical rating, forecasts and screener,
   which are signals by another name, and everything about companies. */
const ALLOWED_TOOLS = [
  "mcp-tv-get-economic-calendar", "mcp-tv-get-economic-symbols", "mcp-tv-get-symbol-data-batch",
  "mcp-tv-get-ohlcv", "mcp-tv-get-news", "mcp-tv-search-symbols",
] as const;
type AllowedTool = typeof ALLOWED_TOOLS[number];

async function tvSession() {
  return mcpInit(TV_URL, {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  }, { name: "doji", version: "1" });
}

// The only place a tool name becomes a request, as with the poller's mcpPost.
async function tvPost(session: Record<string, string>, tool: AllowedTool,
                      args: Record<string, unknown>): Promise<string> {
  if (!ALLOWED_TOOLS.includes(tool)) throw new Error(`Tool not permitted: ${tool}`);
  const res = await fetch(TV_URL, {
    method: "POST", headers: session,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP ${tool}: HTTP ${res.status}`);
  return res.text();
}

/* What a tool answered, or why not. A refusal can arrive as `success: false`
   inside a result marked `isError: false` — the quote batch's scanner 429 did
   — so the payload is checked as well as the envelope. structuredContent
   rather than the text block, which repeats it as a string. */
export function unwrap(envelope: any, tool: string): any {
  if (envelope.error) throw new Error(`TradingView ${tool}: ${envelope.error.message}`);
  const result = envelope.result;
  const answer = result?.structuredContent ?? JSON.parse(result?.content?.[0]?.text ?? "null");
  if (result?.isError || !answer || answer.success === false) {
    throw new Error(`TradingView ${tool}: ${answer?.error || "no answer"}`);
  }
  return answer;
}

// What a tool answered, unwrapped — the read every folder starts from.
const tvCall = async (session: Record<string, string>, tool: AllowedTool, args: Record<string, unknown>) =>
  unwrap(parseSse(await tvPost(session, tool, args)), tool);

/* ─── The calendar ─────────────────────────────────────────────────────────
   The releases as data, each with an id TradingView keeps — the key her
   calendar is filed on — and its figures with unit and scale. The US, which
   every rule that reads a release is about, and the economies she reads the
   dollar through: the euro area and its three largest, Britain, Japan and
   China. Which of theirs are filed is hers to decide, in `calendarRows`.

   The window is the one request value that reaches a tool, so it is refused
   unless valid: dates only, at most 31 days (as far ahead as TradingView
   serves, and a month per step of a history walk), nothing before 2003-09-01.
   ───────────────────────────────────────────────────────────────────────── */
const CALENDAR_DAYS = 31;
const CALENDAR_FIRST = "2003-09-01";
const CALENDAR_COUNTRIES = "US,EU,DE,FR,IT,GB,JP,CN";

export function calendarWindow(from: string | null, to: string | null) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !day.test(from) || !day.test(to)) return null;
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!(span >= 0) || span > CALENDAR_DAYS || from < CALENDAR_FIRST) return null;
  return { date_from: from, date_to: to };
}

/* Text with its unit — "0.2%", "197K", "$6.748T" — as a person reads it. Null
   stays null: no consensus is not a consensus of zero. */
export function figure(value: number | null, unit?: string, scale?: string): string | null {
  if (value === null || value === undefined) return null;
  const n = `${value}${scale ?? ""}`;
  if (unit === "%") return `${n}%`;
  if (unit === "$") return `$${n}`;
  return unit ? `${n} ${unit}` : n;
}

const IMPORTANCE: Record<number, string> = { 1: "high", 0: "medium", [-1]: "low" };

/* `timed` is false for an entry that is not a release — a summit rated high
   and filed at midnight under `indicator: "Calendar"`. Kept as news, marked so
   nothing counts minutes to it. `category` is TradingView's own code — `mny`,
   `prce`, `bnd` — or null where it gives none. `comment` is dropped: a
   paragraph per release, paid for on every request. */
export function foldCalendar(answer: any) {
  if (answer.status !== "ok" || !Array.isArray(answer.result)) {
    throw new Error(`TradingView calendar: ${answer.error || `status ${answer.status}`}`);
  }
  return answer.result.map((e: any) => ({
    id: String(e.id),
    at: e.date,
    title: e.title,
    country: e.country,
    category: e.category ?? null,
    importance: IMPORTANCE[e.importance] ?? "low",
    timed: e.indicator !== "Calendar",
    period: e.period || null,
    consensus: figure(e.forecast, e.unit, e.scale),
    prior: figure(e.previous, e.unit, e.scale),
    actual: figure(e.actual, e.unit, e.scale),
    ticker: e.ticker ?? null,
  }));
}

/* ─── The market around gold ───────────────────────────────────────────────
   What gold is priced against, read as hourly bars — twenty-five, a day with
   the current hour on the end — because the quote batch refused on every
   probe while the OHLCV read answered for every symbol.

   The real yield is FRED's daily TIPS series, a day or more behind, and must
   never read as live: `daily` says so to whoever renders it. Abroad, the
   ten-year yields she reads the calendar's auctions and central banks against
   — France and Italy each against Germany is what lenders charge for the doubt
   — and the euro, more than half the dollar index. The names live here, once,
   beside the symbols — this list is the whole of what is read. */
const MARKET = [
  { symbol: "TVC:DXY",     name: "Dollar index",              unit: "" },
  { symbol: "TVC:US02Y",   name: "Two-year Treasury yield",   unit: "%" },
  { symbol: "TVC:US10Y",   name: "Ten-year Treasury yield",   unit: "%" },
  { symbol: "FRED:DFII10", name: "Ten-year real yield (TIPS)", unit: "%", daily: true },
  { symbol: "TVC:SILVER",  name: "Silver",                    unit: "$" },
  { symbol: "TVC:USOIL",   name: "US crude oil",              unit: "$" },
  { symbol: "SP:SPX",      name: "S&P 500",                   unit: "" },
  { symbol: "TVC:VIX",     name: "VIX",                       unit: "" },
  { symbol: "TVC:DE10Y",   name: "German ten-year yield",     unit: "%" },
  { symbol: "TVC:FR10Y",   name: "French ten-year yield",     unit: "%" },
  { symbol: "TVC:IT10Y",   name: "Italian ten-year yield",    unit: "%" },
  { symbol: "TVC:GB10Y",   name: "UK ten-year gilt yield",    unit: "%" },
  { symbol: "TVC:JP10Y",   name: "Japanese ten-year yield",   unit: "%" },
  { symbol: "FX:EURUSD",   name: "Euro in dollars",           unit: "" },
];

/* A span, not a change: where the first bar opened and the last one stands,
   each with its time, so no figure arrives without its window. The last bar is
   still forming; its time is when that hour began. */
export function foldBars(answer: any) {
  const bars = answer.bars;
  if (!Array.isArray(bars) || !bars.length) throw new Error("no bars");
  const iso = (t: number) => new Date(t * 1000).toISOString();
  const first = bars[0], last = bars[bars.length - 1];
  return { from: first.o, since: iso(first.t), last: last.c, at: iso(last.t) };
}

/* One at a time, for the poller's ?bars=raw reason; a symbol that fails is
   named, not dropped. */
async function readMarket() {
  const session = await tvSession();
  const market: Record<string, unknown>[] = [], missing: Record<string, string>[] = [];
  for (const m of MARKET) {
    try {
      const bars = foldBars(await tvCall(session, "mcp-tv-get-ohlcv",
        { symbol: m.symbol, interval: m.daily ? "1D" : "1h", count: m.daily ? 2 : 25 }));
      market.push({ ...m, daily: !!m.daily, ...bars });
    } catch (err) {
      missing.push({ symbol: m.symbol, name: m.name, error: why(err) });
    }
  }
  return { ok: true, market, missing };
}

/* ─── The headlines ────────────────────────────────────────────────────────
   Gold's feed and the dollar's: titles only, since most stories are
   paywalled and a title with its time and source is what a move is explained
   from. A story on both feeds is one headline; newest first. */
const FEEDS = [{ symbol: "TVC:GOLD", limit: 15 }, { symbol: "TVC:DXY", limit: 10 }];

export function foldHeadlines(answers: { symbol: string; answer: any }[]) {
  const seen = new Map<string, { id: string; title: string; source: string; published: string; feed: string }>();
  for (const { symbol, answer } of answers) {
    for (const h of answer.data?.headlines ?? []) {
      if (seen.has(h.id)) continue;
      seen.set(h.id, {
        id: h.id, title: h.title, source: h.provider?.name ?? "",
        published: new Date(h.published * 1000).toISOString(), feed: symbol,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.published < b.published ? 1 : -1);
}

async function readHeadlines() {
  const session = await tvSession();
  const answers: { symbol: string; answer: any }[] = [], missing: Record<string, string>[] = [];
  for (const f of FEEDS) {
    try {
      answers.push({ symbol: f.symbol,
        answer: await tvCall(session, "mcp-tv-get-news", { symbol: f.symbol, limit: f.limit }) });
    } catch (err) {
      missing.push({ symbol: f.symbol, error: why(err) });
    }
  }
  return { ok: true, headlines: foldHeadlines(answers), missing };
}

/* ─── What the market prices for the Fed ───────────────────────────────────
   Thirty-day fed funds futures, read as CME's FedWatch reads them, so the odds
   are worked out from prices rather than copied off a page. A contract settles
   on the month's average rate, so its price is 100 less that average; a
   meeting month averages the rates before and after the decision, weighted by
   days, and a neighbouring month supplies one so the other falls out.

   Named months, never the continuous ones: `ZQ1!` rolls early and `ZQ3!` was
   refused.

   The meeting dates are the Fed's published schedule — the calendar reaches a
   month and the odds need three meetings. A test fails half a year before the
   table runs out, and every read checks the calendar: a decision it lists that
   the table lacks refuses the answer, since odds against the wrong meeting are
   a confident wrong number. The decision day is the second of the two. */
export const FOMC = [
  "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
  "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];
const MEETINGS_AHEAD = 3;
const MONTH_CODES = "FGHJKMNQUVXZ";

const shift = (ym: string, by: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate();
export const zq = (ym: string) => `CBOT:ZQ${MONTH_CODES[Number(ym.slice(5)) - 1]}${ym.slice(0, 4)}`;

/* The table's last date is a boundary rather than a meeting to price: the
   month after it is only known clear while the table says so. */
const ahead = (today: string, meetings: string[]) =>
  meetings.slice(0, -1).filter(d => d >= today).slice(0, MEETINGS_AHEAD);

/* Each meeting's own month and the neighbour that pins one end: the month
   after if clear — CME's preference, since a late meeting backed out from the
   month before divides by few days — else the month before if clear. */
export function contractMonths(today: string, meetings = FOMC): string[] {
  const meets = new Set(meetings.map(d => d.slice(0, 7)));
  const months = new Set<string>();
  for (const date of ahead(today, meetings)) {
    const ym = date.slice(0, 7), next = shift(ym, 1), prev = shift(ym, -1);
    months.add(ym);
    if (!meets.has(next)) months.add(next);
    else if (!meets.has(prev)) months.add(prev);
  }
  return [...months].sort();
}

/* The two outcomes either side of the move priced: seven basis points is 28%
   of a quarter point and 72% of none. */
export function oddsOf(bp: number) {
  const quarters = Math.abs(bp) / 25, whole = Math.floor(quarters), part = quarters - whole;
  const sign = bp < 0 ? -1 : 1;
  return [
    { bp: sign * whole * 25, chance: Math.round((1 - part) * 100) },
    { bp: sign * (whole + 1) * 25, chance: Math.round(part * 100) },
  ];
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/* Prices in, by month; out, each meeting ahead with its rate before and after,
   the move, and the move since the rate now.

   A neighbouring meeting pins an end as well as a clear month does — the rate
   between two decisions is one rate. So where no clear neighbour was read (the
   month before has expired by the first, just as a December meeting nears),
   meetings are solved off each other until nothing more resolves. One still
   unpinned is named in `unread`, never dropped. */
export function foldRates(prices: Record<string, number>, today: string, meetings = FOMC) {
  const meets = new Set(meetings.map(d => d.slice(0, 7)));
  const rate = (ym: string) => ym in prices ? 100 - prices[ym] : undefined;
  const list = ahead(today, meetings).map(date => {
    const ym = date.slice(0, 7);
    return { date, ym, d: Number(date.slice(8)), n: daysIn(ym), avg: rate(ym),
             before: undefined as number | undefined, after: undefined as number | undefined };
  });
  for (let changed = true; changed;) {
    changed = false;
    list.forEach((m, i) => {
      if (m.before !== undefined || m.avg === undefined) return;
      const next = shift(m.ym, 1), prev = shift(m.ym, -1);
      const after = meets.has(next) ? list[i + 1]?.before : rate(next);
      const before = meets.has(prev) ? list[i - 1]?.after : rate(prev);
      if (after !== undefined) {
        m.after = after;
        m.before = (m.n * m.avg - (m.n - m.d) * after) / m.d;
      } else if (before !== undefined && m.d < m.n) {
        m.before = before;
        m.after = (m.n * m.avg - m.d * before) / (m.n - m.d);
      } else return;
      changed = true;
    });
  }
  const now = list[0]?.before;
  const priced: Record<string, unknown>[] = [], unread: string[] = [];
  for (const { date, before, after } of list) {
    if (before === undefined || after === undefined) { unread.push(date); continue; }
    const move = (after - before) * 100;
    priced.push({
      date, before: round(before, 4), after: round(after, 4), move_bp: round(move, 1),
      total_bp: now === undefined ? null : round((after - now) * 100, 1), odds: oddsOf(move),
    });
  }
  return { meetings: priced, unread };
}

/* A decision the calendar lists and the table lacks. Only this direction
   refuses: a gap in a feed is not a moved meeting. */
export function unlisted(listed: string[], meetings = FOMC): string[] {
  return listed.filter(d => !meetings.includes(d));
}

/* One at a time. A failed contract is named; an unreadable calendar leaves the
   table unchecked and says so with a null rather than costing the odds. */
async function readRates() {
  const session = await tvSession();
  const today = nyDate(new Date());
  const prices: Record<string, number> = {};
  const contracts: Record<string, unknown>[] = [], missing: Record<string, string>[] = [];
  for (const ym of contractMonths(today)) {
    const symbol = zq(ym);
    try {
      const bars = foldBars(await tvCall(session, "mcp-tv-get-ohlcv", { symbol, interval: "1D", count: 2 }));
      prices[ym] = bars.last;
      contracts.push({ symbol, price: bars.last, at: bars.at });
    } catch (err) {
      missing.push({ symbol, error: why(err) });
    }
  }
  let calendar: string[] | null = null;
  try {
    const events = foldCalendar(await tvCall(session, "mcp-tv-get-economic-calendar",
      { countries: "US", date_from: today,
        date_to: new Date(Date.parse(today) + CALENDAR_DAYS * 86_400_000).toISOString().slice(0, 10) }));
    calendar = events.filter((e: { title: string }) => /interest rate decision/i.test(e.title))
      .map((e: { at: string }) => nyDate(new Date(e.at)));
  } catch (err) {
    console.error("doji-tradingview: calendar unread for the meeting check —", why(err));
  }
  const moved = unlisted(calendar ?? []);
  if (moved.length) {
    return { ok: false, error: `TradingView's calendar lists a Fed decision on ${moved.join(", ")}, ` +
                               `which the table of meetings does not hold`, calendar };
  }
  return { ok: true, today, ...foldRates(prices, today), contracts, missing, calendar };
}

/* ─── The probes ───────────────────────────────────────────────────────────
   What each read returns, raw, before anything folds it:

     calendar   an event's shape, and whether a printed release carries its
                actual — hence the past week at high importance
     quotes     the quote batch without forex symbols, and each symbol's last
                bars from the OHLCV read, whose times say how fresh each is
     gold       the broker and TradingView in the same second, and the last
                minute bars
     news       what a headline carries
     econ       which ECONOMICS: series exist for prices and money
     search     the names a real yield and gold's feeds go by
     fedfunds   fed funds futures under continuous and named months, and what
                a bar carries

   Every argument is written here; none is read from the request. */
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const GOLD = ["PEPPERSTONE:XAUUSD", "OANDA:XAUUSD", "FX_IDC:XAUUSD", "TVC:GOLD", "COMEX:GC1!"];
const AROUND = MARKET.map(m => m.symbol);

type Call = [AllowedTool, Record<string, unknown>];

const PROBES: Record<string, () => Call[]> = {
  calendar: () => [
    ["mcp-tv-get-economic-calendar", { countries: "US", date_from: day(0), date_to: day(2) }],
    ["mcp-tv-get-economic-calendar", { countries: "US", date_from: day(-7), date_to: day(0), min_importance: 1 }],
  ],
  quotes: () => [
    // Without the euro: a forex symbol is what drew the scanner's 429.
    ["mcp-tv-get-symbol-data-batch", { symbols: AROUND.filter(s => !s.startsWith("FX:")) }],
    // The real yield is daily; a 15m bar of it answers nothing.
    ...AROUND.filter(s => s !== "FRED:DFII10")
      .map((symbol): Call => ["mcp-tv-get-ohlcv", { symbol, interval: "15m", count: 2 }]),
    ["mcp-tv-get-ohlcv", { symbol: "FRED:DFII10", interval: "1D", count: 3 }],
  ],
  gold: () => [
    ["mcp-tv-get-symbol-data-batch", { symbols: GOLD }],
    ["mcp-tv-get-ohlcv", { symbol: GOLD[0], interval: "1m", count: 3 }],
  ],
  news: () => FEEDS.map((f): Call => ["mcp-tv-get-news", { symbol: f.symbol, limit: f.limit }]),
  econ: () => [
    ["mcp-tv-get-economic-symbols", { country: "US", category: "prce" }],
    ["mcp-tv-get-economic-symbols", { country: "US", category: "mny" }],
  ],
  search: () => [
    ["mcp-tv-search-symbols", { query: "XAUUSD", type_filter: "forex" }],
    ["mcp-tv-search-symbols", { query: "10 year TIPS" }],
    ["mcp-tv-search-symbols", { query: "real yield" }],
  ],
  fedfunds: () => [
    ["mcp-tv-search-symbols", { query: "30 day fed funds" }],
    ...["CBOT:ZQ1!", "CBOT:ZQ2!", "CBOT:ZQ3!", "CBOT:ZQV2026", "CBOT:ZQX2026", "CBOT:ZQZ2026"]
      .map((symbol): Call => ["mcp-tv-get-ohlcv", { symbol, interval: "1D", count: 3 }]),
  ],
};

/* One at a time, each failure its own answer. The gold probe reads the
   broker's quote through the poller — Eugenia's own door — timed beside
   TradingView's. */
async function probe(name: string): Promise<string> {
  const session = await tvSession();
  const parts: string[] = [`--- read at ${new Date().toISOString()} ---`];
  if (name === "gold") {
    const broker = await fetch(`${SB_URL}/functions/v1/doji-mcp-sync?market=1`,
      { headers: { "x-doji-key": CRON_SECRET } })
      .then(r => r.text(), (err: unknown) => `FAILED: ${why(err)}`);
    parts.push(`--- broker, via doji-mcp-sync?market=1, at ${new Date().toISOString()} ---\n${broker}`);
  }
  for (const [tool, args] of PROBES[name]()) {
    const began = Date.now();
    const body = await tvPost(session, tool, args)
      .catch((err: unknown) => `FAILED: ${why(err)}`);
    parts.push(`--- ${tool} ${JSON.stringify(args)}, ${Date.now() - began} ms ---\n${body}`);
  }
  return parts.join("\n");
}

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  if (!CRON_SECRET || !SB_KEY) {
    console.error("doji-tradingview: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }

  const url = new URL(req.url);
  try {
    // The two public paths come before the secret, since neither caller can
    // hold it. Neither reads anything but the URL.
    if (url.pathname.endsWith("/client")) return json({ client_id: CLIENT_ID, ...CLIENT });
    if (url.pathname.endsWith("/callback")) return await callback(url);

    if (!secretMatches(req.headers.get("x-doji-key"), CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    if (url.searchParams.get("connect") === "1") return json(await connect());

    // ?tools=1 — the listing with every schema and readOnlyHint, as text.
    if (url.searchParams.get("tools") === "1") {
      const session = await tvSession();
      const listed = await fetch(TV_URL, {
        method: "POST", headers: session,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      // For the poller's reason.
      if (!listed.ok) throw new Error(`MCP tools/list: HTTP ${listed.status}`);
      return plain(await listed.text());
    }

    // ?calendar=1&from=YYYY-MM-DD&to=YYYY-MM-DD, in whole days.
    if (url.searchParams.get("calendar") === "1") {
      const window = calendarWindow(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!window) {
        return json({ ok: false, error: `from and to are YYYY-MM-DD, at most ${CALENDAR_DAYS} days ` +
                      `apart, and not before ${CALENDAR_FIRST}` }, 400);
      }
      const answer = await tvCall(await tvSession(), "mcp-tv-get-economic-calendar",
        { countries: CALENDAR_COUNTRIES, ...window });
      return json({ ok: true, events: foldCalendar(answer) });
    }

    // ?market=1, ?news=1 and ?rates=1 read only what is fixed above.
    if (url.searchParams.get("market") === "1") return json(await readMarket());
    if (url.searchParams.get("news") === "1") return json(await readHeadlines());
    if (url.searchParams.get("rates") === "1") return json(await readRates());

    const asked = url.searchParams.get("probe");
    if (asked) {
      if (!(asked in PROBES)) {
        return json({ ok: false, error: `no such probe — one of ${Object.keys(PROBES).join(", ")}` }, 400);
      }
      return plain(await probe(asked));
    }

    return json({ ok: false, error: "nothing asked — ?connect=1, ?tools=1, ?calendar=1, ?market=1, ?news=1, ?rates=1 or ?probe=" }, 400);
  } catch (err) {
    console.error("doji-tradingview:", why(err));
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
