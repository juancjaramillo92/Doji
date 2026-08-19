// ═══════════════════════════════════════════════════════════════════════════
// DOJI — the three primitives every Edge Function needs
// ───────────────────────────────────────────────────────────────────────────
// One definition each, because these three had three byte-identical copies and
// the copies could not be checked against one another. A behavioural test
// cannot do it either: secretMatches exists to be CONSTANT-TIME, and a copy
// silently rewritten to `presented === expected` returns the same answer to
// every assertion anyone would think to write while leaking the secret through
// timing. One definition has nothing to drift.
//
// THIS FILE SERVES NOTHING, which is what makes it importable. The three
// function modules each call Deno.serve at their top level, so importing one
// from another would start that function's server inside the caller — which is
// why they carried copies rather than importing from each other. A module with
// no Deno.serve has no such problem, and `_shared/` is the Supabase convention
// for exactly this: the CLI bundles it into each function that imports it.
//
// Nothing here reads a secret, holds state, or touches the network. Anything
// that closes over per-function configuration stays in the function that owns
// it — sbHeaders and tg are NOT here, deliberately: tg binds a different bot
// token per bot, and the poller's sbHeaders is genuinely a different function
// from the bots' (no argument, a hardcoded Prefer). Sharing either would mean
// threading config through every call site or a flag to switch behaviours, and
// both cost more than the copy saves.
// ═══════════════════════════════════════════════════════════════════════════

// Every Deno touch in this repo goes through here, so the function modules
// import under plain Node and test/fold.test.mjs can reach their pure exports.
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
