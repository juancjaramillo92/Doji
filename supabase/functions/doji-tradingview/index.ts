// ═══════════════════════════════════════════════════════════════════════════
// DOJI — TradingView  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// Holds the TradingView sign-in, and is the only thing here that does. What
// TradingView adds is the half of the market the broker cannot serve — the
// calendar as data rather than as a page she transcribes, and the dollar and
// the yields gold is priced against — and every read of it will come through
// this function.
//
// A FUNCTION OF ITS OWN, FOR THE POLLER'S REASON AND ONE MORE. The endpoint
// that serves the calendar and the quotes also serves create_alert,
// delete_alert and delete_watchlist on the same credential. None of them
// trades, but all of them are his account, so the credential stays out of
// Eugenia exactly as the cTrader token does. And the sign-in ends in a callback
// a browser reaches carrying no secret, which has no place in the function that
// is her Telegram webhook.
//
// EVERY READER WAS WRITTEN AFTER ITS PROBE, AND THAT ORDER IS THE RULE. ?tools=1
// said what the endpoint offers — and its tool names were not the ones
// TradingView's documentation gives, which is the whole case for reading before
// writing. ?probe= says what each useful tool RETURNS, raw, and ?calendar=1,
// ?market=1, ?news=1 and ?rates=1 were written against those answers: the
// poller's ?market=raw and ?positions=1 were how its two scales were found, and
// a reader written first would have been the guess this repository keeps
// paying for.
//
// SECURITY CONTRACT
//   1. ALLOWED_TOOLS is a hardcoded list of read tools, and tvPost() is the only
//      place a tool name becomes a request and refuses anything else. Every name
//      on it carries readOnlyHint in the listing TradingView served, which is
//      kept whole in test/fixtures/tradingview-tools-list.json and is what the
//      test holds the list against — not a second list typed here.
//   2. ?connect=1, ?tools=1 and ?probe= present DOJI_CRON_SECRET on x-doji-key.
//      No value from the request reaches a tool: ?probe= picks one of a fixed
//      set, and every argument is written below.
//   3. /client and /callback are public because they must be: TradingView's
//      authorisation server fetches the first, and its sign-in redirects a
//      browser to the second. /callback acts only on a `state` that ?connect=1
//      stored, compared in constant time, and clears it on success.
//   4. The tokens live in `tradingview_auth` — never logged, never returned.
//
// Deploy:  supabase functions deploy doji-tradingview --no-verify-jwt
// Secrets: DOJI_CRON_SECRET, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { env, secretMatches, json, sbHeaders, mcpInit, parseSse, nyDate, SB_URL, SB_KEY } from "../_shared/edge.ts";

const TV_URL = "https://mcp.tradingview.com/mcp";

const CRON_SECRET = env("DOJI_CRON_SECRET");

// Where this function answers, which is also who it says it is: under a client
// metadata document the client_id IS the URL its metadata is served from.
const HOME = `${SB_URL}/functions/v1/doji-tradingview`;
const CLIENT_ID = `${HOME}/client`;
const REDIRECT = `${HOME}/callback`;

/* A PUBLIC CLIENT, so no secret is registered and PKCE carries the proof
   instead. The metadata is served whole at /client and sent less its id to a
   server that registers dynamically — one statement of who Doji is for both. */
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
   OAuth 2.1 as MCP specifies it, discovered rather than configured. Nothing
   here names a TradingView URL but the endpoint itself: the server's own 401
   points at its metadata, the metadata names the authorisation server, and that
   server's metadata names everything else. Typed in, any of those would be a
   copy of a fact TradingView owns and can move.
   ───────────────────────────────────────────────────────────────────────── */
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

// RFC 7636's S256. Exported because its appendix states one verifier and the
// challenge it must produce, which is a test that needs no network.
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/* What an unauthenticated request is told. RFC 9728 puts the metadata URL in
   `resource_metadata` and MCP may add the `scope` to ask for; either can be
   absent, and an absent one falls through to the well-known paths below. */
export function challenge(header: string | null): { metadata?: string; scope?: string } {
  const param = (name: string) => header?.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  return { metadata: param("resource_metadata"), scope: param("scope") };
}

/* RFC 8414's well-known paths, which insert the suffix BEFORE the URL's own
   path, then the bare origin. The order is the specification's: the path form
   is the precise one, and a server that serves only the root answers the
   second. */
export function wellKnown(url: string, ...names: string[]): string[] {
  const { origin, pathname } = new URL(url);
  const path = pathname.replace(/\/$/, "");
  return names.flatMap(n => path
    ? [`${origin}/.well-known/${n}${path}`, `${origin}/.well-known/${n}`]
    : [`${origin}/.well-known/${n}`]);
}

// The first candidate that answers with a document. Every one that did not is
// named in the error, because "metadata not found" alone sends nobody anywhere.
async function firstJson(urls: string[]): Promise<any> {
  const tried: string[] = [];
  for (const url of urls) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) return res.json();
    tried.push(`${url} → ${res.status}`);
  }
  throw new Error(`no metadata at any of: ${tried.join("; ")}`);
}

/* WHICHEVER REGISTRATION THE SERVER OFFERS, because nothing here could ask it
   in advance. MCP prefers a client metadata document — the client_id is a URL
   and the server reads who Doji is from it — and keeps dynamic registration for
   servers that predate that. A server offering neither is a stop, and the error
   lists what it did advertise. */
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
  // MCP requires a client to refuse a server that does not state S256, rather
  // than send a verifier over a method nobody agreed.
  if (!as.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("the authorisation server does not advertise PKCE with S256");
  }

  const { clientId, via } = await register(as);
  const state = random(), verifier = random();
  const audience = resource.resource ?? TV_URL;
  const scope = told.scope ?? resource.scopes_supported?.join(" ");

  /* A CONNECT STARTS OVER, and the old tokens go with it. Dynamic registration
     mints a new client each time, and a refresh token presented under a client
     it was not issued to is refused as invalid_client — so keeping the old pair
     through a sign-in that was then abandoned would leave a connection that
     reads as present and fails on its first use. Cleared, it says what it is:
     not connected, run ?connect=1. */
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

  // The scopes are reported because they decide what the token can do: if a
  // read-only one exists, the reconnect that asks for it alone retires the
  // allow-list's job the way a read-only cTrader token would retire the poller's.
  return {
    ok: true, open_this: authorize.toString(), registered_by: via,
    scopes_asked: scope ?? null, scopes_supported: resource.scopes_supported ?? null,
  };
}

/* ─── The tokens ───────────────────────────────────────────────────────────
   IN A TABLE, WHICH THE POLLER'S CONTRACT SAYS A TOKEN NEVER IS, and that is
   the one place this function departs from it. An OAuth server may rotate the
   refresh token on every use, and a function cannot rewrite its own Edge
   secrets — so a token kept there would be good for exactly one refresh and the
   connection would die an hour after it was made. One row, RLS on and no
   policy, revoked from both public roles in 016.
   ───────────────────────────────────────────────────────────────────────── */
interface Auth {
  client_id: string; token_endpoint: string; resource: string;
  access_token: string | null; refresh_token: string | null; expires_at: string | null;
  pending_state: string | null; pending_verifier: string | null; refreshing_until: string | null;
}

async function readAuth(): Promise<Auth | null> {
  const res = await fetch(`${SB_URL}/rest/v1/tradingview_auth?id=eq.current&select=*`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`tradingview_auth: HTTP ${res.status} — has 016 been applied?`);
  return (await res.json())[0] ?? null;
}

// Only the keys passed are written, so a refresh leaves the client and any
// pending sign-in alone.
async function saveAuth(fields: Partial<Auth>) {
  const res = await fetch(`${SB_URL}/rest/v1/tradingview_auth?on_conflict=id`, {
    method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({ id: "current", ...fields }),
  });
  if (!res.ok) throw new Error(`tradingview_auth: HTTP ${res.status} — has 016 been applied?`);
}

/* WHAT A TOKEN ANSWER BECOMES, AND THE REFRESH TOKEN IS THE HALF THAT MATTERS.
   A server that rotates sends a new one and the old one is dead; a server that
   does not sends none and the old one stands. Writing whatever came back would
   store null on the second kind, and the connection would end at the next
   expiry with nothing to say why — so an absent one keeps what was there. */
export function tokenFields(answer: any, now: number, held: string | null) {
  return {
    access_token: answer.access_token as string,
    refresh_token: (answer.refresh_token as string | undefined) ?? held,
    expires_at: typeof answer.expires_in === "number"
      ? new Date(now + answer.expires_in * 1000).toISOString() : null,
  };
}

/* A minute of margin, so a token cannot expire between being read here and
   reaching TradingView. No stated expiry is treated as already expired: a
   refresh each call is slower, and a token used past an expiry nobody recorded
   is a 401 nobody can explain. */
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
  // OAuth's `error` is a code like invalid_grant and carries no secret; the
  // rest of the body is not echoed.
  if (!res.ok || !answer.access_token) {
    throw new Error(`TradingView's token endpoint refused (HTTP ${res.status}` +
                    `${answer.error ? `, ${answer.error}` : ""})`);
  }
  return answer;
}

/* ONE RENEWAL AT A TIME, AND THE LEASE IN 017 IS HOW. A server that rotates
   may treat a refresh token presented twice as stolen and revoke the whole
   sign-in, and the briefing and the release look can find the token stale in
   the same second. So a renewal is taken by a PATCH filtered on the lease being
   empty or lapsed — the filter is evaluated inside the UPDATE, `balance`'s
   arbitration — and a PATCH that matched nothing is a caller that waits for the
   token the holder writes.

   THE ROW IS READ AGAIN ONCE THE LEASE IS HELD, and that is the half that is
   easy to drop. Between the first read and the lease, another caller can have
   renewed and released: the refresh token from the first read is then the one
   just spent, and presenting it is the double presentation the lease exists to
   stop. */
const LEASE_MS = 30_000;
const LEASE_POLL_MS = 250, LEASE_POLLS = 40;

async function takeLease(): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await fetch(`${SB_URL}/rest/v1/tradingview_auth?id=eq.current` +
    `&or=(refreshing_until.is.null,refreshing_until.lt.${encodeURIComponent(now)})`, {
    method: "PATCH", headers: sbHeaders("return=representation"),
    body: JSON.stringify({ refreshing_until: new Date(Date.now() + LEASE_MS).toISOString() }),
  });
  if (!res.ok) throw new Error(`tradingview_auth: HTTP ${res.status} — has 017 been applied?`);
  return (await res.json()).length > 0;
}

/* Exported so a test can drive the real sequence — two refreshes against a
   server that rotates, and two callers finding the token stale at once —
   rather than tokenFields handed one answer. */
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
        // The token and the release are one write, so no caller can see the
        // lease free and the old token still standing.
        await saveAuth({ ...next, refreshing_until: null });
        return next.access_token;
      } catch (err) {
        // Released so the next caller can try rather than wait out the lapse;
        // if the release fails too, the lease lapses on its own.
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

  // Said, because it decides whether this lasts: without a refresh token the
  // sign-in ends when the access token does.
  return plain(fields.refresh_token
    ? "Connected. TradingView is signed in for Doji, and this tab can be closed."
    : `Connected, but TradingView issued no refresh token, so this sign-in ends ` +
      `${fields.expires_at ? `at ${fields.expires_at}` : "when the access token does"}. ` +
      `Run ?connect=1 again and send ?tools=1's answer with this message.`);
}

/* ─── The reads ────────────────────────────────────────────────────────────
   EVERY ONE READ-ONLY, AND THE LIST IS THE ONLY THING THAT MAKES THAT TRUE.
   ?tools=1 established that the same credential serves eleven tools that change
   his account — alerts created, updated, paused, resumed and deleted, and
   watchlists created, renamed, edited and deleted — and one that reads as a read
   and is not: `mcp-watchlist-get-active-watchlist` activates a watchlist, or
   creates one, when none is active, and carries no readOnlyHint for that reason.

   What is NOT here is as deliberate. The technical rating, analyst forecasts and
   the screener are read-only and are also a signal by another name, which is
   the line her prompt exists to hold; fundamentals, filings, earnings and
   dividends are about companies, and gold is not one. */
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

// The allow-list check lives here because here is the only place a tool name
// becomes a request — the poller's mcpPost, for the poller's reason.
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

/* WHAT A TOOL ANSWERED, OR WHY IT DID NOT, and the second is the trap. The
   quote batch refused with TradingView's own scanner 429 and said so INSIDE a
   result marked `isError: false` — `success: false` in the payload, beside an
   envelope reporting nothing wrong. A reader checking the envelope alone takes
   a refusal for an empty answer. `structuredContent` is read rather than the
   text block, which carries the same payload a second time as a string. */
export function unwrap(envelope: any, tool: string): any {
  if (envelope.error) throw new Error(`TradingView ${tool}: ${envelope.error.message}`);
  const result = envelope.result;
  const answer = result?.structuredContent ?? JSON.parse(result?.content?.[0]?.text ?? "null");
  if (result?.isError || !answer || answer.success === false) {
    throw new Error(`TradingView ${tool}: ${answer?.error || "no answer"}`);
  }
  return answer;
}

/* ─── The calendar ─────────────────────────────────────────────────────────
   The day's releases as data, which is what Eugenia files instead of a page she
   transcribes. Each event carries an id TradingView keeps — the key her
   calendar never had, and the reason one print arrived as five rows under five
   names — and its forecast, prior and actual as numbers with a unit and a
   scale, which become the text her calendar holds.

   US ONLY, because every rule that reads a release is about USD; the tool
   takes other countries and nothing here has a use for them yet.

   THE WINDOW IS DAYS, VALIDATED, AND THE ONE REQUEST VALUE THAT REACHES A TOOL
   — the poller's `?hours=` is the precedent, clamped where this is refused.
   Dates and nothing else, because TradingView rejects other formats and an
   inclusive day is what it was seen to honour; at most 31 days, which is as far
   forward as it serves and long enough that a history is walked a month at a
   time; and nothing before 2003-09-01, where its data starts. */
const CALENDAR_DAYS = 31;
const CALENDAR_FIRST = "2003-09-01";

export function calendarWindow(from: string | null, to: string | null) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !day.test(from) || !day.test(to)) return null;
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!(span >= 0) || span > CALENDAR_DAYS || from < CALENDAR_FIRST) return null;
  return { date_from: from, date_to: to };
}

/* A figure as her calendar holds it: text, with its unit, because "0.2%",
   "197K" and "$6.748T" are what a person reads and the column is text for that
   reason. A null stays null — no consensus is not a consensus of zero. */
export function figure(value: number | null, unit?: string, scale?: string): string | null {
  if (value === null || value === undefined) return null;
  const n = `${value}${scale ?? ""}`;
  if (unit === "%") return `${n}%`;
  if (unit === "$") return `$${n}`;
  return unit ? `${n} ${unit}` : n;
}

const IMPORTANCE: Record<number, string> = { 1: "high", 0: "medium", [-1]: "low" };

/* `timed` IS FALSE FOR WHAT IS ON THE CALENDAR WITHOUT BEING A RELEASE. A
   summit was rated high and filed at midnight with `indicator: "Calendar"` —
   no print, no minute, nothing a thirty-minute window before it could mean.
   Kept rather than dropped, because it is still news; marked, so nothing that
   counts minutes counts it. The long `comment` each event carries is dropped:
   it is a paragraph per release, and every one of them would be paid for on
   every request she makes. */
export function foldCalendar(answer: any) {
  if (answer.status !== "ok" || !Array.isArray(answer.result)) {
    throw new Error(`TradingView calendar: ${answer.error || `status ${answer.status}`}`);
  }
  return answer.result.map((e: any) => ({
    id: String(e.id),
    at: e.date,
    title: e.title,
    country: e.country,
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
   The dollar, the yields and the rest of what gold is priced against, as bars.
   The quote batch would have been the natural read and it refused on every
   probe — the forex scanner's 429, then the CFD scanner's — while the OHLCV
   read answered for every symbol, its last bar opened inside the current
   quarter hour. So the market is read as bars: hourly, twenty-five of them, a
   day's span with the current hour on the end.

   THE REAL YIELD IS DAILY, AND IT IS A DAY OR MORE BEHIND. FRED publishes the
   ten-year TIPS yield once a day after the fact, so its bars are days and the
   newest one is dated — and it is the one figure here that must never read as
   live. `daily` is what says so to whoever renders it.

   THE NAMES ARE HERE, ONCE, beside the symbols they name: this list is the
   whole of what is read, and a renderer holding its own copy of the names is
   a list that can name a symbol nothing reads. */
const MARKET = [
  { symbol: "TVC:DXY",     name: "Dollar index",              unit: "" },
  { symbol: "TVC:US02Y",   name: "Two-year Treasury yield",   unit: "%" },
  { symbol: "TVC:US10Y",   name: "Ten-year Treasury yield",   unit: "%" },
  { symbol: "FRED:DFII10", name: "Ten-year real yield (TIPS)", unit: "%", daily: true },
  { symbol: "TVC:SILVER",  name: "Silver",                    unit: "$" },
  { symbol: "TVC:USOIL",   name: "US crude oil",              unit: "$" },
  { symbol: "SP:SPX",      name: "S&P 500",                   unit: "" },
  { symbol: "TVC:VIX",     name: "VIX",                       unit: "" },
];

/* A SPAN, NOT A CHANGE: where the first bar opened and where the last one
   stands, each with its time. A change computed here would be a number with
   no window attached, and a figure that arrives without saying what it is
   measured from is how a briefing came to call an evening's move the day's.
   The last bar is still forming, so its close is "now" to within the hour and
   its time is when that hour began. */
export function foldBars(answer: any) {
  const bars = answer.bars;
  if (!Array.isArray(bars) || !bars.length) throw new Error("no bars");
  const iso = (t: number) => new Date(t * 1000).toISOString();
  const first = bars[0], last = bars[bars.length - 1];
  return { from: first.o, since: iso(first.t), last: last.c, at: iso(last.t) };
}

/* One at a time, for the poller's reason: six bar reads in parallel once came
   back as one 504 that took the other five with it, and which symbol cannot be
   read is half of the answer. A symbol that fails is named, not dropped. */
async function readMarket() {
  const session = await tvSession();
  const market: Record<string, unknown>[] = [], missing: Record<string, string>[] = [];
  for (const m of MARKET) {
    const tool = "mcp-tv-get-ohlcv";
    try {
      const bars = foldBars(unwrap(parseSse(await tvPost(session, tool,
        { symbol: m.symbol, interval: m.daily ? "1D" : "1h", count: m.daily ? 2 : 25 })), tool));
      market.push({ ...m, daily: !!m.daily, ...bars });
    } catch (err) {
      missing.push({ symbol: m.symbol, name: m.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: true, market, missing };
}

/* ─── The headlines ────────────────────────────────────────────────────────
   Gold's own feed and the dollar's, which between them carried everything the
   1 October probe needed to explain the afternoon: Reuters on gold against
   yields, and the Fed vice chair's lines within minutes of his saying them.
   Titles only — most stories are paywalled, and a title with its time and its
   source is what a move is explained from. The two feeds overlap, so a story
   on both is one headline; newest first. */
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
  const tool = "mcp-tv-get-news";
  const answers: { symbol: string; answer: any }[] = [], missing: Record<string, string>[] = [];
  for (const f of FEEDS) {
    try {
      answers.push({ symbol: f.symbol,
        answer: unwrap(parseSse(await tvPost(session, tool, { symbol: f.symbol, limit: f.limit })), tool) });
    } catch (err) {
      missing.push({ symbol: f.symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: true, headlines: foldHeadlines(answers), missing };
}

/* ─── What the market prices for the Fed ───────────────────────────────────
   Thirty-day fed funds futures, read the way CME's FedWatch reads them, so the
   odds she quotes are worked out from prices rather than copied off a page that
   once called a hike a cut. A contract settles on the month's average overnight
   rate, so its price is 100 less that average; a month with a meeting averages
   the rate before the decision and the rate after it, weighted by the days each
   held, and whichever of the two a neighbouring month supplies, the other falls
   out of the price.

   NAMED MONTHS, NEVER THE CONTINUOUS ONES. The fedfunds probe showed `ZQ1!`
   rolling to the next month before the current one ends and `ZQ3!` refused
   outright, so a continuous name is a month nobody chose.

   THE MEETING DATES ARE A TABLE, AND THE CALENDAR CHECKS IT. TradingView's
   calendar reaches a month ahead and the odds need three meetings, so the dates
   are the Fed's published schedule — 2027's is tentative until each preceding
   meeting confirms it. A table is true until the year nobody extends it, so a
   test fails half a year before it runs out. And a meeting moved at short
   notice is what a table cannot know, so every read asks the calendar which
   decisions it lists, and a date the table does not hold refuses the whole
   answer: odds worked out against the wrong meeting are a confident wrong
   number, and none is better. The decision day is the second of the two. */
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

/* The table's LAST date is a boundary rather than a meeting to price: what
   follows it is unknown, and the month after a meeting is read as clear of one
   when the table says so. */
const ahead = (today: string, meetings: string[]) =>
  meetings.slice(0, -1).filter(d => d >= today).slice(0, MEETINGS_AHEAD);

/* For each meeting, its own month and the neighbour that pins one end of it:
   the month after if no meeting falls in it — CME's preference, since backing
   the rate before out of a late meeting divides by most of the month rather
   than by the few days after it — else the month before if that one is clear. */
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

/* Two outcomes either side of the move priced, as FedWatch splits a meeting:
   seven basis points is a 28% chance of a quarter point and 72% of none. */
export function oddsOf(bp: number) {
  const quarters = Math.abs(bp) / 25, whole = Math.floor(quarters), part = quarters - whole;
  const sign = bp < 0 ? -1 : 1;
  return [
    { bp: sign * whole * 25, chance: Math.round((1 - part) * 100) },
    { bp: sign * (whole + 1) * 25, chance: Math.round(part * 100) },
  ];
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/* Prices in, by month; out, each meeting ahead with the rate before it, the rate
   after it, the move between them, and the move since the rate now.

   A NEIGHBOURING MEETING PINS AN END AS WELL AS A CLEAR MONTH DOES, because the
   rate between two decisions is one rate whichever months it spans. So where
   neither neighbouring month is clear, or the one that is was not read — the
   month before has EXPIRED by the first of the month, which is exactly when a
   December meeting is closest — the meeting is solved off the one beside it,
   in either direction, until nothing more resolves. A meeting that still has
   no end pinned is named in `unread` rather than dropped. The move since now
   is measured from the first meeting's rate before, and has no base without it. */
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

/* A decision on TradingView's calendar that the table does not hold. A table
   date the calendar does not list is not the same evidence — a gap in a feed
   is not a moved meeting — so only this direction refuses. */
export function unlisted(listed: string[], meetings = FOMC): string[] {
  return listed.filter(d => !meetings.includes(d));
}

/* One at a time, for readMarket's reason. A contract that fails is named, and
   a calendar that cannot be read leaves the table unchecked and says so with a
   null, rather than costing the odds. */
async function readRates() {
  const session = await tvSession();
  const today = nyDate(new Date());
  const prices: Record<string, number> = {};
  const contracts: Record<string, unknown>[] = [], missing: Record<string, string>[] = [];
  for (const ym of contractMonths(today)) {
    const tool = "mcp-tv-get-ohlcv", symbol = zq(ym);
    try {
      const bars = foldBars(unwrap(parseSse(await tvPost(session, tool, { symbol, interval: "1D", count: 2 })), tool));
      prices[ym] = bars.last;
      contracts.push({ symbol, price: bars.last, at: bars.at });
    } catch (err) {
      missing.push({ symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }
  let calendar: string[] | null = null;
  try {
    const tool = "mcp-tv-get-economic-calendar";
    const events = foldCalendar(unwrap(parseSse(await tvPost(session, tool,
      { countries: "US", date_from: today,
        date_to: new Date(Date.parse(today) + CALENDAR_DAYS * 86_400_000).toISOString().slice(0, 10) })), tool));
    calendar = events.filter((e: { title: string }) => /interest rate decision/i.test(e.title))
      .map((e: { at: string }) => nyDate(new Date(e.at)));
  } catch (err) {
    console.error("doji-tradingview: calendar unread for the meeting check —", err instanceof Error ? err.message : err);
  }
  const moved = unlisted(calendar ?? []);
  if (moved.length) {
    return { ok: false, error: `TradingView's calendar lists a Fed decision on ${moved.join(", ")}, ` +
                               `which the table of meetings does not hold`, calendar };
  }
  return { ok: true, today, ...foldRates(prices, today), contracts, missing, calendar };
}

/* ─── The probes ───────────────────────────────────────────────────────────
   What each read RETURNS, raw, before anything folds it. Each answers a
   question a reader cannot be written without:

     calendar   the shape of an event, and whether a release that has printed
                carries its actual beside the forecast and the prior — the
                week behind is asked at high importance for that reason
     quotes     whether the quote batch answers for the dollar, the yields,
                the metals and the indices once no forex symbol is in it —
                it refused twice with the forex scanner's 429, and the whole
                batch failed with it — and each one's last bars from the OHLCV
                read, which answered where the batch did not, with the bar
                times saying how fresh each feed is
     gold       the broker and TradingView read in the same second, which is
                the only way "which gold price is better" is a measurement —
                and the last minute bars, which say how stale a TradingView
                quote is
     news       what a headline carries, and whether gold's own feed is the
                place to explain a move from
     econ       which ECONOMICS: series exist for prices and money, the actual
                releases a calendar entry would be judged against
     search     the names a real yield and gold's feeds go by, for whatever
                the quotes probe could not resolve
     fedfunds   whether thirty-day fed funds futures answer, under the
                continuous names and under named contract months, and what a
                bar of them carries: the price the meeting odds she now
                searches for would be worked out from, read where the dollar
                and the yields already are

   Every argument is written here and none is read from the request. */
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const GOLD = ["PEPPERSTONE:XAUUSD", "OANDA:XAUUSD", "FX_IDC:XAUUSD", "TVC:GOLD", "COMEX:GC1!"];
const AROUND = MARKET.map(m => m.symbol);

const PROBES: Record<string, () => [AllowedTool, Record<string, unknown>][]> = {
  calendar: () => [
    ["mcp-tv-get-economic-calendar", { countries: "US", date_from: day(0), date_to: day(2) }],
    ["mcp-tv-get-economic-calendar", { countries: "US", date_from: day(-7), date_to: day(0), min_importance: 1 }],
  ],
  quotes: () => [
    ["mcp-tv-get-symbol-data-batch", { symbols: AROUND }],
    // The real yield is a daily series, so it is asked for in days; a 15m bar
    // of it would be its own refusal and answer nothing.
    ...AROUND.filter(s => s !== "FRED:DFII10")
      .map(symbol => ["mcp-tv-get-ohlcv", { symbol, interval: "15m", count: 2 }] as [AllowedTool, Record<string, unknown>]),
    ["mcp-tv-get-ohlcv", { symbol: "FRED:DFII10", interval: "1D", count: 3 }],
  ],
  gold: () => [
    ["mcp-tv-get-symbol-data-batch", { symbols: GOLD }],
    ["mcp-tv-get-ohlcv", { symbol: GOLD[0], interval: "1m", count: 3 }],
  ],
  news: () => FEEDS.map(f => ["mcp-tv-get-news", { symbol: f.symbol, limit: f.limit }] as
    [AllowedTool, Record<string, unknown>]),
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
      .map(symbol => ["mcp-tv-get-ohlcv", { symbol, interval: "1D", count: 3 }] as
        [AllowedTool, Record<string, unknown>]),
  ],
};

/* ONE AT A TIME, AND EACH ONE'S FAILURE IS ITS OWN ANSWER, for the poller's
   ?bars=raw reason: which call TradingView refuses, and why, is half of what a
   probe asks. The gold probe also reads the broker's quote through the poller —
   the door Eugenia already uses, with the secret she already presents — timed
   beside TradingView's so the two prices are of the same second. */
async function probe(name: string): Promise<string> {
  const session = await tvSession();
  const parts: string[] = [`--- read at ${new Date().toISOString()} ---`];
  if (name === "gold") {
    const broker = await fetch(`${SB_URL}/functions/v1/doji-mcp-sync?market=1`,
      { headers: { "x-doji-key": CRON_SECRET } })
      .then(r => r.text(), (err: unknown) => `FAILED: ${err instanceof Error ? err.message : err}`);
    parts.push(`--- broker, via doji-mcp-sync?market=1, at ${new Date().toISOString()} ---\n${broker}`);
  }
  for (const [tool, args] of PROBES[name]()) {
    const began = Date.now();
    const body = await tvPost(session, tool, args)
      .catch((err: unknown) => `FAILED: ${err instanceof Error ? err.message : err}`);
    parts.push(`--- ${tool} ${JSON.stringify(args)}, ${Date.now() - began} ms ---\n${body}`);
  }
  return parts.join("\n");
}

// ─── Entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module runs nothing — the file loads under plain
// Node, where Deno.serve does not exist.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  if (!CRON_SECRET || !SB_KEY) {
    console.error("doji-tradingview: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }

  const url = new URL(req.url);
  try {
    // THE TWO PUBLIC PATHS, ahead of the secret because neither caller can hold
    // it: an authorisation server reading who Doji is, and a browser returning
    // from TradingView's sign-in page. Neither reads the request beyond its URL.
    if (url.pathname.endsWith("/client")) return json({ client_id: CLIENT_ID, ...CLIENT });
    if (url.pathname.endsWith("/callback")) return await callback(url);

    if (!secretMatches(req.headers.get("x-doji-key"), CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    if (url.searchParams.get("connect") === "1") return json(await connect());

    /* ?tools=1 — WHAT TRADINGVIEW ACTUALLY OFFERS, with every input schema and
       every `readOnlyHint`, which is what the allow-list and each reader get
       written against. A METHOD, so no tool name becomes a request. Text rather
       than JSON for the poller's reason: the framing is part of what is read. */
    if (url.searchParams.get("tools") === "1") {
      const session = await tvSession();
      const listed = await fetch(TV_URL, {
        method: "POST", headers: session,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      // Checked for the reason the poller checks: a 401 body under a 200 would
      // read as TradingView offering nothing.
      if (!listed.ok) throw new Error(`MCP tools/list: HTTP ${listed.status}`);
      return plain(await listed.text());
    }

    /* ?calendar=1&from=YYYY-MM-DD&to=YYYY-MM-DD — the reader, folded. The
       caller filters by the minute; this answers in whole days. */
    if (url.searchParams.get("calendar") === "1") {
      const window = calendarWindow(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!window) {
        return json({ ok: false, error: `from and to are YYYY-MM-DD, at most ${CALENDAR_DAYS} days ` +
                      `apart, and not before ${CALENDAR_FIRST}` }, 400);
      }
      const session = await tvSession();
      const answer = unwrap(parseSse(await tvPost(session, "mcp-tv-get-economic-calendar",
        { countries: "US", ...window })), "mcp-tv-get-economic-calendar");
      return json({ ok: true, events: foldCalendar(answer) });
    }

    // ?market=1 — the market around gold, folded. Every symbol is fixed above.
    if (url.searchParams.get("market") === "1") return json(await readMarket());
    // ?news=1 — gold's and the dollar's headlines, folded. Both feeds are fixed.
    if (url.searchParams.get("news") === "1") return json(await readHeadlines());
    // ?rates=1 — what fed funds futures price for the meetings ahead. The
    // contracts follow from the date and the table; nothing is read from the request.
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
    console.error("doji-tradingview:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
