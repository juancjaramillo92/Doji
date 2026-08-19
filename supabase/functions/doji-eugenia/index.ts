// ═══════════════════════════════════════════════════════════════════════════
// EUGENIA — market briefing and conversation  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// The second bot. Gladys collects the journal; Eugenia does macro. Same two-
// caller shape as doji-telegram, told apart by which secret arrives:
//
//   x-doji-key                        the hourly pg_cron job in
//                                     supabase/003_eugenia.sql — post the
//                                     briefing if this is one of its hours.
//   x-telegram-bot-api-secret-token   Telegram — the trader replied, answer him.
//
// SHE OWNS NO TABLE COLUMN AND READS NO TRADE. The only thing she writes is her
// own conversation history, which is why she is not a fifth writer to `trades`
// and has nothing to arbitrate with anybody. Trade review stays in the Claude
// app, where the data is.
//
// THE SCHEDULE IS DECIDED HERE, NOT IN CRON. Weekdays at 08:00 and Sunday at
// 17:00 New York — and pg_cron schedules in UTC, so a fixed expression would be
// an hour wrong for half the year. The job runs hourly and briefDue() answers
// whether this is the hour, exactly as marketOpen() does for the poller. Asking
// America/New_York for its own clock is correct all year and is one function.
//
// Deploy:   supabase functions deploy doji-eugenia --no-verify-jwt
// Register: setWebhook with secret_token = EUGENIA_WEBHOOK_SECRET
// Secrets:  EUGENIA_BOT_TOKEN, EUGENIA_WEBHOOK_SECRET, TELEGRAM_CHAT_ID,
//           DOJI_CRON_SECRET, ANTHROPIC_API_KEY, SUPABASE_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { SYSTEM } from "./prompt.ts";

const env = (k: string): string => (globalThis as any).Deno?.env?.get(k) ?? "";

const BOT_TOKEN      = env("EUGENIA_BOT_TOKEN");
const WEBHOOK_SECRET = env("EUGENIA_WEBHOOK_SECRET");
// The same chat as Gladys — one trader, one thread each. Numeric, for the same
// reason as doji-telegram: it is both a send target and an identity.
const CHAT_ID        = env("TELEGRAM_CHAT_ID");
const CRON_SECRET    = env("DOJI_CRON_SECRET");
const ANTHROPIC_KEY  = env("ANTHROPIC_API_KEY");

const SB_URL = env("SUPABASE_URL");
const SB_KEY = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const IS_JWT = SB_KEY.startsWith("eyJ");

/* ─── When the briefing is due ─────────────────────────────────────────────
   Monday to Friday at 08:00, Sunday at 17:00 — New York, which is the clock
   every other time in this system is kept in. Sunday 17:00 is also the gold
   open, so the week's first briefing lands exactly as the market does.

   Returns which briefing is due, or null. The two answers differ only in their
   salutation, but they are the whole reason this is not a boolean.
   ───────────────────────────────────────────────────────────────────────── */
export type Brief = 'weekday' | 'sunday';

export function briefDue(now: Date): Brief | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(now);
  const wd = ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 } as Record<string, number>)[
    parts.find(p => p.type === "weekday")?.value ?? ""] ?? -1;
  let hour = +(parts.find(p => p.type === "hour")?.value ?? -1);
  if (hour === 24) hour = 0;

  if (wd >= 1 && wd <= 5 && hour === 8) return 'weekday';
  if (wd === 0 && hour === 17) return 'sunday';
  return null;
}

// Buenos días before the week, buenas tardes for the Sunday open — which is
// the evening, and the only briefing that is not a morning one.
export const greeting = (brief: Brief) =>
  brief === 'sunday'
    ? 'Buenas tardes jefesito, todays news below'
    : 'Buenos dias jefesito, todays news below';

/* ─── Telegram's 4096-character limit ──────────────────────────────────────
   A full briefing is seven sections long and will not fit. Splitting is not
   optional, and splitting badly is worse than not splitting: a break mid-
   sentence reads as a bug.

   So the split prefers a blank line, then any newline, then — only if a single
   paragraph is itself over the limit — a hard cut. Paragraph boundaries are
   what the prompt asks Eugenia to write toward, which is why the first choice
   is nearly always the one taken.
   ───────────────────────────────────────────────────────────────────────── */
export const TG_LIMIT = 4096;

export function chunk(text: string, limit = TG_LIMIT): string[] {
  const out: string[] = [];
  let rest = text.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // lastIndexOf on the window, so the break is always inside the budget.
    const at = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
    const cut = at > limit / 2 ? at : limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/* ─── The journal, read-only ───────────────────────────────────────────────
   She can look at trades when the conversation is about trades, and cannot
   touch them. Three things make that true and none of them is her restraint:
   the view fixes the columns and hides deleted rows, the grant on it is SELECT
   only, and this function is the single database read of the journal she has —
   there is no write path to `trades` anywhere in the file.

   A TOOL rather than trades pasted into every request. Most messages are about
   the Fed, not about last Tuesday, and a journal stapled to every turn would be
   paid for on every turn and would break the prompt cache each time a fill
   landed. She pulls it when she needs it.
   ───────────────────────────────────────────────────────────────────────── */
const TRADES_TOOL = {
  name: "get_trades",
  description:
    "The trader's own journal for the last N days, newest first. Use it whenever " +
    "he asks about his trades, his discipline, or a pattern in how he has been " +
    "trading. Returns one object per trade: id, direction, entry and exit price, " +
    "entry and fill time (UTC), pnl, open_day, setup, and the three discipline " +
    "answers. A discipline answer of null means unanswered, which is NOT 'no'.",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "integer", description: "How many days back to read, 1 to 365." },
    },
    required: ["days"],
    additionalProperties: false,
  },
  strict: true,
} as const;

// The whole query, built in one place so a test can read it. `days` arrives
// from the model, so it is clamped rather than trusted: this is the boundary.
// 400 rows is far more than a year of this account and stops a wide window
// returning a context-filling answer.
export function tradesQuery(days: unknown, now = Date.now()): string {
  const n = Math.min(Math.max(Math.trunc(Number(days)) || 30, 1), 365);
  const since = new Date(now - n * 86_400_000).toISOString().slice(0, 10);
  return `eugenia_trades?open_day=gte.${since}` +
         `&order=open_day.desc,entry_time.desc&limit=400`;
}

async function readTrades(days: unknown): Promise<string> {
  const res = await fetch(`${SB_URL}/rest/v1/${tradesQuery(days)}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Trades read failed (HTTP ${res.status})`);
  const rows = await res.json();
  return rows.length ? JSON.stringify(rows) : "No trades in that window.";
}

/* ─── Claude ───────────────────────────────────────────────────────────────
   Raw fetch rather than the SDK, to match every other outbound call in this
   repo — the poller speaks JSON-RPC to cTrader and REST to PostgREST the same
   way, and one function importing an npm client would be the only one.

   web_search is what makes a briefing possible at all: without it the model has
   no access to today's calendar, and a briefing invented from training data is
   worse than none. It bills separately at $10 per 1,000 searches.
   ───────────────────────────────────────────────────────────────────────── */
interface Turn { role: 'user' | 'assistant'; content: string }

/* THE BRIEFING AND A QUESTION ARE NOT THE SAME AMOUNT OF WORK, AND WERE PRICED
   AS IF THEY WERE. Effort sets how deeply the model thinks before it writes,
   and at "high" — the API default — "how many trades did I take this week"
   bought a minute of reasoning to produce one sentence. The briefing earns that
   depth: a dozen searches, seven sections, one shot a day. A reply does not.

   Medium rather than low for the reply, because the journal is the half that
   punishes carelessness — `null` is not `no`, break-even is a price band and
   not a number, and a fast wrong reading of his discipline is worse than a slow
   right one. Low is for work with no way to be subtly wrong. */
type Effort = 'medium' | 'high';

async function call(messages: any[], effort: Effort) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 16000,
      // Cached: the system prompt is long, fixed, and sent on every turn.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      // web_search runs on Anthropic's side and needs no loop here; get_trades
      // is ours and is executed below.
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 12 },
        TRADES_TOOL,
      ],
      thinking: { type: "adaptive" },
      output_config: { effort },
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Four rounds, because a loop that cannot end is a loop that bills forever. Two
// is the realistic maximum — ask for trades, then answer — and the cap exists
// for the case where that assumption is wrong rather than as a working limit.
const MAX_ROUNDS = 4;

async function ask(messages: Turn[], effort: Effort): Promise<string> {
  const convo: any[] = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body = await call(convo, effort);
    // A refusal stops the turn with no usable content, so it is checked before
    // the blocks are read rather than surfacing as an empty message.
    if (body.stop_reason === "refusal") {
      throw new Error(`Claude declined: ${body.stop_details?.category ?? "unknown"}`);
    }

    if (body.stop_reason === "tool_use") {
      convo.push({ role: "assistant", content: body.content });
      // All results in ONE user message. Splitting them teaches the model to
      // stop asking for tools in parallel.
      const results = [];
      for (const b of body.content ?? []) {
        if (b.type === "tool_use" && b.name === TRADES_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: b.id, content: await readTrades(b.input?.days) });
        }
      }
      if (!results.length) throw new Error("tool_use with no tool this function serves");
      convo.push({ role: "user", content: results });
      continue;
    }

    const text = (body.content ?? [])
      .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (!text) throw new Error("Claude returned no text");
    return text;
  }
  throw new Error(`tool loop did not settle in ${MAX_ROUNDS} rounds`);
}

/* ─── Telegram and history ─────────────────────────────────────────────── */

const tg = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json());

// One message per chunk, in order. Sequential rather than parallel: Telegram
// does not promise ordering, and a briefing whose section 5 arrives before
// section 2 is unreadable.
async function say(text: string) {
  for (const part of chunk(text)) {
    const sent = await tg("sendMessage", { chat_id: CHAT_ID, text: part });
    if (!sent.ok) throw new Error(`sendMessage failed: ${sent.description ?? "unknown"}`);
  }
}

const sbHeaders = (prefer?: string) => {
  const headers: Record<string, string> = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (IS_JWT) headers.Authorization = `Bearer ${SB_KEY}`;
  if (prefer) headers.Prefer = prefer;
  return headers;
};

/* Twelve turns, oldest first.

   A briefing is long, so a wider window would resend several of them on every
   question for no gain — what a follow-up needs is the briefing it follows and
   the exchange since, not last Tuesday's calendar. Twelve covers a morning's
   conversation and keeps the cost of a one-line question near the cost of a
   one-line question. */
const HISTORY = 12;

async function recent(): Promise<Turn[]> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_turns?select=role,content&order=id.desc&limit=${HISTORY}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`History read failed (HTTP ${res.status})`);
  return (await res.json()).reverse();
}

async function remember(turns: Turn[]) {
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_turns`, {
    method: "POST", headers: sbHeaders("return=minimal"), body: JSON.stringify(turns),
  });
  if (!res.ok) throw new Error(`History write failed (HTTP ${res.status})`);
}

/* ─── The cron half: today's briefing ───────────────────────────────────── */

// pg_net is fire-and-forget and never retries, so this half may take as long as
// it takes — the timeout in the cron job only has to outlast the work. That is
// the whole difference between this caller and Telegram's.
async function postBriefing(url: URL): Promise<Response> {
  // ?force=1 runs a briefing now, whatever the clock says — the same flag
  // doji-mcp-sync carries, for the same two jobs: a manual re-run after a
  // failure, and a way to exercise the whole path without waiting for 08:00.
  // It changes nothing else, and the answer comes back in the response rather
  // than only in Telegram, which is what makes a failure readable.
  const due = url.searchParams.get("force") === "1"
    ? briefDue(new Date()) ?? 'weekday'
    : briefDue(new Date());
  // The job runs hourly; twenty-three of those hours are not a briefing hour.
  if (!due) return json({ ok: true, skipped: "not a briefing hour" });

  const asked = due === 'sunday'
    ? "Today's briefing, please — the full structure. It is Sunday evening, the gold week is about to open."
    : "Today's briefing, please — the full structure.";

  const brief = await ask([{ role: 'user', content: asked }], 'high');
  await say(`${greeting(due)}\n\n${brief}`);
  // Stored so a follow-up question has the briefing it follows.
  await remember([{ role: 'user', content: asked }, { role: 'assistant', content: brief }]);
  return json({ ok: true, brief: due });
}

/* ─── The Telegram half: he replied ─────────────────────────────────────── */

/* THE ANSWER IS NOT WRITTEN INSIDE THE RESPONSE, AND IT CANNOT BE.

   Telegram waits about a minute for a webhook to reply and then gives up with
   "Read timeout expired" and redelivers the update. A briefing is a dozen web
   searches and a long generation; it does not fit in that window, and the first
   attempt proved it. Answering late is worse than slow: the redelivery runs the
   whole thing again, so the trader gets two briefings and pays for two.

   So the entry point answers 200 immediately and hands the work here.
   EdgeRuntime.waitUntil is what keeps the worker alive past the response —
   without it the runtime may reclaim it the moment the 200 is sent, killing the
   generation halfway. Nothing awaits this, so it carries its own error handling
   and its own apology; there is no response left to put a failure in. */
async function handleMessage(update: any): Promise<void> {
  try {
    const msg = update?.message;
    // Edits, joins, and anything without text. Dropped.
    if (!msg?.text) return;
    if (String(msg.chat?.id) !== CHAT_ID) {
      console.error("doji-eugenia: message from unexpected chat");
      return;
    }

    // TELEGRAM'S TYPING INDICATOR LASTS FIVE SECONDS AND CANNOT BE EXTENDED, so
    // one call at the start leaves a thirty-second answer looking like a dead
    // bot for twenty-five of them — which is exactly how it was read the first
    // time it ran long. Re-sent until there is something to send. It makes
    // nothing faster; it makes the wait legible. Best effort, so a failed ping
    // is swallowed rather than taking the answer down with it.
    const typing = () => tg("sendChatAction", { chat_id: CHAT_ID, action: "typing" }).catch(() => {});
    typing();
    const keepTyping = setInterval(typing, 4_500);

    try {
      const history = await recent();
      const answer = await ask([...history, { role: 'user', content: msg.text }], 'medium');
      await say(answer);
      await remember([{ role: 'user', content: msg.text }, { role: 'assistant', content: answer }]);
    } finally {
      clearInterval(keepTyping);
    }
  } catch (err) {
    console.error("doji-eugenia:", err instanceof Error ? err.message : err);
    await tg("sendMessage",
      { chat_id: CHAT_ID, text: "Something broke on my side, jefe. Try again in a moment." })
      .catch(() => {});
  }
}

// Keeps a promise alive past the response. The catch is not optional: nothing
// awaits this, so an unhandled rejection is the only trace a failure would
// otherwise leave.
function background(work: Promise<unknown>) {
  const guarded = work.catch(err =>
    console.error("doji-eugenia:", err instanceof Error ? err.message : err));

  const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
  // SAID OUT LOUD, because its absence is otherwise invisible: without it the
  // worker can be reclaimed the moment the 200 is sent, and the answer dies
  // mid-generation with no error anywhere. That reads exactly like a model call
  // that hung, which is the wrong thing to go looking for.
  if (!waitUntil) {
    console.error("doji-eugenia: EdgeRuntime.waitUntil unavailable — " +
                  "the reply may be killed when this response returns");
    return;
  }
  waitUntil.call((globalThis as any).EdgeRuntime, guarded);
}

// ─── Entry point ───────────────────────────────────────────────────────────
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  const fromTelegram = req.headers.get("x-telegram-bot-api-secret-token");
  const fromCron     = req.headers.get("x-doji-key");

  if (!BOT_TOKEN || !CHAT_ID || !WEBHOOK_SECRET || !CRON_SECRET || !ANTHROPIC_KEY || !SB_KEY) {
    console.error("doji-eugenia: a required secret is not set — refusing all requests");
    return json({ ok: false, error: "not configured" }, 503);
  }

  try {
    if (fromTelegram !== null && secretMatches(fromTelegram, WEBHOOK_SECRET)) {
      // Answer first, work after. See handleMessage.
      background(handleMessage(await req.json()));
      return json({ ok: true });
    }
    if (fromCron !== null && secretMatches(fromCron, CRON_SECRET)) {
      return await postBriefing(new URL(req.url));
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  } catch (err) {
    // pg_net discards this, so the console is where a missed briefing is
    // reported. Nothing retries: tomorrow's briefing is the next attempt.
    console.error("doji-eugenia:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

// Its own copy rather than an import from doji-telegram, for the reason that
// file gives about doji-mcp-sync: importing a module that calls Deno.serve at
// its top level would start that function's server inside this one.
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!expected || !presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
