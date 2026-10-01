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
// IT CALLS NO TOOL YET, AND THAT IS THE ORDER RATHER THAN AN OMISSION. What this
// endpoint offers and what each tool takes is read with ?tools=1 before anything
// is written against it — the poller's ?market=raw and ?positions=1 were how its
// two scales were found, and a reader written first would have been the guess
// this repository keeps paying for. The first tool this calls arrives with an
// allow-list beside it.
//
// SECURITY CONTRACT
//   1. No tool is called. `tools/list` is a method and names none.
//   2. ?connect=1 and ?tools=1 present DOJI_CRON_SECRET on x-doji-key.
//   3. /client and /callback are public because they must be: TradingView's
//      authorisation server fetches the first, and its sign-in redirects a
//      browser to the second. /callback acts only on a `state` that ?connect=1
//      stored, compared in constant time, and clears it on success.
//   4. The tokens live in `tradingview_auth` — never logged, never returned.
//
// Deploy:  supabase functions deploy doji-tradingview --no-verify-jwt
// Secrets: DOJI_CRON_SECRET, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { env, secretMatches, json, sbHeaders, mcpInit, SB_URL, SB_KEY } from "../_shared/edge.ts";

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

/* THE THREE TRADINGVIEW SERVES THAT WRITE TO HIS ACCOUNT, as its own
   documentation names them, and named before any tool is called so the first
   allow-list arrives with a test already holding it against them. The same
   documentation lists eight alert tools and eight watchlist tools, so these are
   the ones named rather than all there are; ?tools=1's `readOnlyHint` is what
   finishes the list. */
export const DESTRUCTIVE_TOOLS = ["create_alert", "delete_alert", "delete_watchlist"] as const;

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
  pending_state: string | null; pending_verifier: string | null;
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

/* ONLY ONE CALLER REFRESHES AT A TIME TODAY BECAUSE ONLY A PERSON CALLS THIS.
   A server that rotates may treat a refresh token presented twice as stolen and
   revoke the whole sign-in, and two scheduled readers refreshing in the same
   second would present it twice. The first scheduled caller has to serialise
   this, and that is a condition on adding one rather than a defect in this.

   Exported so a test can drive two refreshes against a server that rotates —
   the sequence, rather than tokenFields handed one answer, is what shows the
   second refresh presenting the token the first one was given. */
export async function accessToken(): Promise<string> {
  const auth = await readAuth();
  if (auth && fresh(auth, Date.now())) return auth.access_token!;
  if (!auth?.refresh_token) throw new Error("TradingView is not connected — run ?connect=1 and sign in");

  const next = tokenFields(
    await tokenRequest(auth, { grant_type: "refresh_token", refresh_token: auth.refresh_token }),
    Date.now(), auth.refresh_token);
  await saveAuth(next);
  return next.access_token;
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
      const session = await mcpInit(TV_URL, {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      }, { name: "doji", version: "1" });
      const listed = await fetch(TV_URL, {
        method: "POST", headers: session,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      // Checked for the reason the poller checks: a 401 body under a 200 would
      // read as TradingView offering nothing.
      if (!listed.ok) throw new Error(`MCP tools/list: HTTP ${listed.status}`);
      return plain(await listed.text());
    }

    return json({ ok: false, error: "nothing asked — ?connect=1 or ?tools=1" }, 400);
  } catch (err) {
    console.error("doji-tradingview:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
