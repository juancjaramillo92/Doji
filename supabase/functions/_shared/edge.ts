// ═══════════════════════════════════════════════════════════════════════════
// DOJI — the primitives every Edge Function needs
// ───────────────────────────────────────────────────────────────────────────
// One definition each. The test is not "could this be shared" but "are there
// two copies that nothing can compare": a byte-identical copy drifts silently,
// and secretMatches is the case that proves why a behavioural test cannot catch
// it — the function exists to be CONSTANT-TIME, and a copy quietly rewritten to
// `presented === expected` returns the same answer to every assertion anyone
// would think to write while leaking the secret through timing.
//
// THIS FILE SERVES NOTHING, which is what makes it importable. The four
// function modules each call Deno.serve at their top level, so importing one
// from another would start that function's server inside the caller. A module
// with no Deno.serve has no such problem, and `_shared/` is the Supabase
// convention for exactly this: the CLI bundles it into each function that
// imports it.
//
// What is NOT here is anything that closes over one function's own
// configuration — a bot token, a whitelist, a schedule. sbHeaders and telegram
// are here because their configuration is an argument rather than a capture:
// every caller passes what differs and shares the rest.
// ═══════════════════════════════════════════════════════════════════════════

// Every Deno touch in this repo goes through here, so the function modules
// import under plain Node and the test suite can reach their pure exports.
// Their Deno.serve calls are guarded for the same reason.
export const env = (k: string): string => (globalThis as any).Deno?.env?.get(k) ?? "";

/* Length-independent comparison of a presented secret against the expected one.

   A plain !== leaks the expected secret's length through timing, and then its
   leading bytes. That is a small thing on endpoints called by one caller each,
   and free to avoid.

   A null header is a closed door rather than an open one — callers rely on
   that and check no header for null first. An unset EXPECTED secret is also
   refused: a function whose secret failed to load must not admit everyone. */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!expected || !presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* ─── PostgREST ────────────────────────────────────────────────────────────
   The key that bypasses RLS, and the only header shape that carries it.

   `sb_secret_` keys are opaque tokens and PostgREST REJECTS them on
   Authorization: Bearer — they belong on `apikey` and nowhere else. There used
   to be a second path here, detecting a legacy service_role JWT by its `eyJ`
   prefix and adding an Authorization header for it. Legacy keys are JWTs tied
   to the project's JWT secret and cannot be rotated at all, which is what made
   moving off them worth doing; nothing presents one now, so there is one
   header shape and no branch to pick it.

   `prefer` is the only thing that differs between callers, so it is the only
   argument. Naming it at the call site also keeps an upsert directive off a
   PATCH, which is what happened while the poller had its own copy with
   `resolution=merge-duplicates` baked in.
   ───────────────────────────────────────────────────────────────────────── */
export const SB_URL = env("SUPABASE_URL");

// SB_SECRET_KEY, NOT SUPABASE_SECRET_KEY, and the difference is not cosmetic.
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself and treats
// the SUPABASE_ prefix as its own, so a secret cannot be created under that
// name — which means a function reading one gets "" no matter what is in the
// dashboard. That is how this shipped reading a name nothing could ever set and
// silently falling back to the legacy service_role JWT instead: two spellings of
// one value, the same shape of mistake as doji_cron_secret's case sensitivity,
// and equally quiet.
//
// Unset now, every function answers 503 at its first line rather than reaching
// for something else. A key that is not there should stop the work, not change
// which key does it.
export const SB_KEY = env("SB_SECRET_KEY");

export const sbHeaders = (prefer?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    apikey: SB_KEY,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
};

/* ─── Telegram ─────────────────────────────────────────────────────────────
   Two bots, two tokens, one wire. The token is an argument rather than a
   capture, so each bot binds its own in one line and every call site below it
   is unchanged.
   ───────────────────────────────────────────────────────────────────────── */
export const telegram = (token: string, method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json());

/* ─── The New York clock ───────────────────────────────────────────────────
   Weekday and hour in New York, which is the clock every market decision in
   this system is kept in: the poller's market hours, Eugenia's briefing hour
   and her pulse hour all ask this and nothing else.

   ONE DEFINITION BECAUSE THE COPIES DISAGREED ABOUT NOTHING REACHABLE. The
   poller's and Eugenia's differed only in what they returned when Intl failed
   to emit a part — Monday noon on one side, -1 on the other. Neither could
   fire: formatToParts with `weekday` and `hour` requested always emits both.
   That is defensive padding at a boundary where nothing untrusted enters, so
   it is gone, and a genuinely impossible response now throws rather than
   quietly deciding the market is open.
   ───────────────────────────────────────────────────────────────────────── */
// The New York CIVIL DAY an instant falls on — a different question from the
// clock below, and asked by both the poller (which day a trade is filed under)
// and Eugenia (whether today's briefing already went). en-CA is YYYY-MM-DD,
// which is also the shape `open_day` is compared against.
export const nyDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function nyClock(now: Date): { wd: number; hour: number } {
  // hourCycle rather than hour12, which leaves the cycle to the locale and can
  // resolve to h24 — midnight arriving as 24 and every `hour === 8` test in the
  // schedules missing the first hour of the day. This carried a `=== 24 ? 0`
  // correction for that; stating h23 removes the case rather than repairing it,
  // which is what Eugenia's nyStamp does too.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const at = (type: string) => parts.find(p => p.type === type)!.value;

  return { wd: WEEKDAY[at("weekday")], hour: +at("hour") };
}

/* ─── Market hours ─────────────────────────────────────────────────────────
   Gold trades Sunday 17:00 to Friday 17:00, New York. The poller skips the
   ~49-hour weekend close — roughly 1,400 pointless calls a week for data that
   cannot have changed — and Eugenia's price sense skips it for the same reason
   and by the same rule, which is why this is here rather than in either of
   them.

   Decided in code rather than in the cron expression on purpose: "continuous
   from Sunday evening to Friday evening" takes three cron jobs, pg_cron
   schedules in UTC, and every one of them would be an hour wrong whenever New
   York is on standard time. nyClock asks America/New_York for its own clock
   instead, which is correct all year.
   ───────────────────────────────────────────────────────────────────────── */
export function marketOpen(now = new Date()): boolean {
  const { wd, hour } = nyClock(now);
  if (wd === 6) return false;                 // Saturday
  if (wd === 5 && hour >= 17) return false;   // after the Friday close
  if (wd === 0 && hour < 17) return false;    // before the Sunday open
  return true;
}
