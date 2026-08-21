// ═══════════════════════════════════════════════════════════════════════════
// EUGENIA — market briefing and conversation  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// The second bot. Gladys collects the journal; Eugenia does macro. Same two-
// caller shape as doji-gladys, told apart by which secret arrives:
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
// HOLDING HER CRON SECRET IS NOT NOTHING. Against the poller it starts a poll
// that was going to run anyway; here `?force=1` spends money, a briefing at a
// time, with no bound in the code. The bound is a spend cap on the Anthropic
// key, which is the only place one can actually be enforced.
//
// Deploy:   supabase functions deploy doji-eugenia --no-verify-jwt
// Register: setWebhook with secret_token = EUGENIA_WEBHOOK_SECRET and
//           allowed_updates = ["message"] — she answers text and nothing else.
// Secrets:  EUGENIA_BOT_TOKEN, EUGENIA_WEBHOOK_SECRET, TELEGRAM_CHAT_ID,
//           DOJI_CRON_SECRET, ANTHROPIC_API_KEY, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { SYSTEM } from "./prompt.ts";
// Everything shared lives in _shared/edge.ts — one definition each, for the
// reason that file gives.
import {
  env, secretMatches, json, nyClock, telegram, sbHeaders, SB_URL, SB_KEY,
} from "../_shared/edge.ts";

const BOT_TOKEN      = env("EUGENIA_BOT_TOKEN");
const WEBHOOK_SECRET = env("EUGENIA_WEBHOOK_SECRET");
// The same chat as Gladys — one trader, one thread each. Numeric, for the same
// reason as doji-gladys: it is both a send target and an identity.
const CHAT_ID        = env("TELEGRAM_CHAT_ID");
const CRON_SECRET    = env("DOJI_CRON_SECRET");
const ANTHROPIC_KEY  = env("ANTHROPIC_API_KEY");

/* ─── When the briefing is due ─────────────────────────────────────────────
   Monday to Friday at 08:00, Sunday at 17:00 — New York, which is the clock
   every other time in this system is kept in. Sunday 17:00 is also the gold
   open, so the week's first briefing lands exactly as the market does.

   Returns which briefing is due, or null. The two answers differ only in their
   salutation, but they are the whole reason this is not a boolean.
   ───────────────────────────────────────────────────────────────────────── */
export type Brief = 'weekday' | 'sunday';

// nyClock is shared with the poller's market hours, so the two cannot disagree
// about what hour it is in New York — the sort of difference nobody finds until
// March. Both schedules below read it, which is why it is read once here.
export function briefDue(now: Date): Brief | null {
  const { wd, hour } = nyClock(now);
  if (wd >= 1 && wd <= 5 && hour === 8) return 'weekday';
  if (wd === 0 && hour === 17) return 'sunday';
  return null;
}

/* THE SECOND LOOK, and its default answer is silence.

   Weekdays at 10:00 New York: an hour and a half after the briefing, which puts
   it past the 08:30 data window and into the session. One extra call a day
   rather than a check every hour — an hourly watch is twenty-three model calls
   with web search behind them, and the cost of that is not worth a feature
   whose right answer is usually "nothing happened".

   It is therefore NOT event-driven, and calling it that would be a lie: it is a
   second scheduled look that usually says nothing. Adding a second hour is one
   line if the morning one proves useful. */
export function pulseDue(now: Date): boolean {
  const { wd, hour } = nyClock(now);
  return wd >= 1 && wd <= 5 && hour === 10;
}

// Buenos días before the week, buenas tardes for the Sunday open — which is
// the evening, and the only briefing that is not a morning one.
export const greeting = (brief: Brief) =>
  brief === 'sunday'
    ? 'Buenas tardes jefesito, todays news below'
    : 'Buenos dias jefesito, todays news below';

/* ─── Telegram's 4096-character limit ──────────────────────────────────────
   The prompt aims at fourteen hundred characters, so a briefing now arrives as
   one message and this does nothing. It stays for the day it does not — a heavy
   week, or a Sunday that runs on — because splitting badly is worse than not
   splitting: a break mid-sentence reads as a bug.

   So the split prefers a blank line, then any newline, then — only if a single
   paragraph is itself over the limit — a hard cut. The prompt puts a blank line
   between paragraphs and nowhere else, which is why the first choice is nearly
   always the one taken.
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

/* ─── What she remembers ───────────────────────────────────────────────────
   Twelve turns of conversation roll over in a morning, so without this she can
   never know in September that he has been working on holding his stop since
   August. These are facts about HIM, kept in her own words — not a transcript
   and not a market log.

   APPEND-ONLY, and read newest-first. Superseding a note means writing a newer
   one, which is also how a person's memory works: the recent account wins. No
   update path and no delete path, so the only thing she can do to this table is
   add a sentence to it.

   Still not a writer to `trades`. eugenia_turns and eugenia_notes are hers;
   the journal remains one read through a view with no write path in the file.
   ───────────────────────────────────────────────────────────────────────── */
const NOTES_TOOL = {
  name: "remember",
  description:
    "Keep one short fact about the trader for later — how he trades, what he is " +
    "working on, what he already understands, what explanation landed. Facts about " +
    "him, not about the market: never today's price, today's data, or anything that " +
    "will be stale tomorrow. One sentence, in your own words. He is not told.",
  input_schema: {
    type: "object",
    properties: {
      note: { type: "string", description: "One short sentence, at most 200 characters." },
    },
    required: ["note"],
    additionalProperties: false,
  },
  strict: true,
} as const;

// Twenty is a season of them at the few-a-week the prompt asks for, and they are
// one sentence each, so the whole memory costs less than one paragraph of a
// briefing.
const NOTES = 20;

async function readNotes(): Promise<string[]> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_notes?select=note&order=id.desc&limit=${NOTES}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Notes read failed (HTTP ${res.status})`);
  return (await res.json()).map((r: { note: string }) => r.note);
}

/* Truncated rather than refused, and it NEVER THROWS.

   Both for the same reason: this tool exists for a side effect, and the answer
   she is in the middle of writing matters more than the note. A sentence one
   character over its budget is still worth keeping, and a throw here would
   propagate out of the tool loop and cost the whole reply — so a failed write
   comes back as a sentence she can read and carry on from. It is also what
   makes her survive being deployed before 003_eugenia.sql has been run:
   no table, no memory, but every answer still lands. */
async function writeNote(note: unknown): Promise<string> {
  const text = String(note ?? "").trim().slice(0, 200);
  if (!text) return "Nothing to remember.";
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_notes`, {
      method: "POST", headers: sbHeaders("return=minimal"),
      body: JSON.stringify([{ note: text }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "Remembered.";
  } catch (err) {
    console.error("doji-eugenia: note not written —", err instanceof Error ? err.message : err);
    return "That did not save. Carry on and do not mention it.";
  }
}

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
   depth: a dozen searches and one shot a day. A reply does not, and neither
   does the pulse, whose usual answer is one word.

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
        NOTES_TOOL,
      ],
      thinking: { type: "adaptive" },
      output_config: { effort },
      // A DECLINE USED TO COST THE WHOLE BRIEFING. Nothing retries this half —
      // pg_net is fire-and-forget — so a refusal was simply a morning with no
      // briefing and a line in a log nobody reads. `fallbacks: "default"` re-runs
      // the same request on another model inside this same call and routes by
      // refusal category, so there is no model list here to go stale. A decline
      // before any output is not billed.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Six rounds, because a loop that cannot end is a loop that bills forever.
// Three is the realistic maximum now — read the journal, write a note, answer —
// and the cap exists for the case where that assumption is wrong rather than as
// a working limit. It was four when there was one tool to call.
const MAX_ROUNDS = 6;

async function ask(messages: Turn[], effort: Effort): Promise<string> {
  const convo: any[] = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body = await call(convo, effort);
    // Still checked, and it still happens: `fallbacks` rescues a model that
    // declines, and this is the case where the whole chain did. No usable
    // content, so it is caught before the blocks are read rather than surfacing
    // as an empty message.
    if (body.stop_reason === "refusal") {
      throw new Error(`Claude declined: ${body.stop_details?.category ?? "unknown"}`);
    }

    if (body.stop_reason === "tool_use") {
      convo.push({ role: "assistant", content: body.content });
      // All results in ONE user message. Splitting them teaches the model to
      // stop asking for tools in parallel.
      const results = [];
      for (const b of body.content ?? []) {
        if (b.type !== "tool_use") continue;
        // Only the two this function serves. web_search runs on Anthropic's
        // side and never arrives here; anything else is a name we did not send.
        if (b.name === TRADES_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: b.id, content: await readTrades(b.input?.days) });
        } else if (b.name === NOTES_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: b.id, content: await writeNote(b.input?.note) });
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

// Her token, bound once. Every call below is unchanged by the binding.
const tg = (method: string, body: unknown) => telegram(BOT_TOKEN, method, body);

// One message per chunk, in order. Sequential rather than parallel: Telegram
// does not promise ordering, and a briefing whose section 5 arrives before
// section 2 is unreadable.
async function say(text: string) {
  for (const part of chunk(text)) {
    const sent = await tg("sendMessage", { chat_id: CHAT_ID, text: part });
    if (!sent.ok) throw new Error(`sendMessage failed: ${sent.description ?? "unknown"}`);
  }
}

/* Twelve turns, oldest first.

   A briefing is long, so a wider window would resend several of them on every
   question for no gain — what a follow-up needs is the briefing it follows and
   the exchange since, not last Tuesday's calendar. Twelve covers a morning's
   conversation and keeps the cost of a one-line question near the cost of a
   one-line question.

   IT MUST START ON A USER TURN, which is the Messages API's one hard rule about
   the shape of a conversation. Consecutive same-role turns it merges; a leading
   assistant turn it refuses, and the refusal is total — every reply 400s until
   the offending row rolls out of the window.

   Pairs are written in a single INSERT, so the obvious argument is that an even
   window can only ever open on a user turn. That argument is wrong, and it held
   this together for one release. Two rows in one statement draw two sequence
   values, and a concurrent INSERT can take one in between: two messages sent
   seconds apart — ordinary, since the webhook answers 200 immediately and both
   handlers then run at once — can interleave as u₁ u₂ a₁ a₂. The window then
   opens mid-pair.

   So the shape is repaired rather than assumed, which also means HISTORY no
   longer has to be even and nothing depends on a sentence being remembered.
   Exported because it is the decision, and a decision asserted in a comment is
   what this replaced.
   ───────────────────────────────────────────────────────────────────────── */
const HISTORY = 12;

export function openOnUser(turns: Turn[]): Turn[] {
  const first = turns.findIndex(t => t.role === 'user');
  return first === -1 ? [] : turns.slice(first);
}

async function recent(): Promise<Turn[]> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_turns?select=role,content&order=id.desc&limit=${HISTORY}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`History read failed (HTTP ${res.status})`);
  return openOnUser((await res.json()).reverse());
}

async function remember(turns: Turn[]) {
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_turns`, {
    method: "POST", headers: sbHeaders("return=minimal"), body: JSON.stringify(turns),
  });
  if (!res.ok) throw new Error(`History write failed (HTTP ${res.status})`);
}

/* ─── What she brings to a turn ────────────────────────────────────────────
   Folded into the opening user message rather than sent as a mid-conversation
   system message. That channel exists for exactly this and would keep the
   cached prefix intact — but its request shape could not be exercised from the
   machine this was written on, and a 400 there kills every reply she gives.
   Nothing here is untrusted anyway: the notes are her own sentences and the
   trades are his own journal, so the injection safety a system turn buys is not
   what this needs.

   remember() stores the RAW message, never the augmented one, so a preamble is
   never resent forever as history.
   ───────────────────────────────────────────────────────────────────────── */

// Optional by design: a database blip must cost her the memory, not the
// briefing. Logged, because a bot that has quietly stopped remembering reads
// exactly like a bot with nothing to remember.
async function notesBlock(): Promise<string> {
  try {
    const notes = await readNotes();
    return notes.length
      ? `\n\nWhat you have remembered about him, newest first:\n· ${notes.join("\n· ")}`
      : "";
  } catch (err) {
    console.error("doji-eugenia: notes unavailable —", err instanceof Error ? err.message : err);
    return "";
  }
}

// Seven days, handed over unasked, so "you have not traded since Tuesday" costs
// no tool round. Same read as get_trades through the same read-only view — she
// gains no reach here, only the saved trip.
async function tradesBlock(): Promise<string> {
  try {
    return `\n\nHis trades this past week:\n${await readTrades(7)}`;
  } catch (err) {
    console.error("doji-eugenia: trades unavailable —", err instanceof Error ? err.message : err);
    return "";
  }
}

/* ─── The cron half: the briefing, and the quieter second look ───────────── */

// pg_net is fire-and-forget and never retries, so this half may take as long as
// it takes — the timeout in the cron job only has to outlast the work. That is
// the whole difference between this caller and Telegram's.
//
// One hourly job, three answers: a briefing hour, a pulse hour, or neither.
// ?force=1 runs a briefing now and ?pulse=1 a pulse, whatever the clock says —
// the same flag doji-mcp-sync carries, for the same two jobs: a manual re-run
// after a failure, and a way to exercise the path without waiting for 08:00.
// The answer comes back in the response as well as in Telegram, which is what
// makes a failure readable.
async function postScheduled(url: URL): Promise<Response> {
  if (url.searchParams.get("pulse") === "1") return await postPulse();

  const now = new Date();
  const due = briefDue(now) ?? (url.searchParams.get("force") === "1" ? 'weekday' : null);
  if (due) return await postBriefing(due);
  if (pulseDue(now)) return await postPulse();

  return json({ ok: true, skipped: "nothing due this hour" });
}

/* THE BRIEFING READS ITS OWN HISTORY, which it did not until now — it wrote to
   eugenia_turns and never read back, so every morning started from nothing and
   she could not know what she had said the day before, whether it landed, or
   that she had already explained a term twice this week. Continuity is most of
   what separates a person from a feed.

   The stored user turn is a marker, not the sent text: the notes and the week's
   trades are rebuilt fresh every morning, and storing them would resend a stale
   copy as history for the next six briefings. */
async function postBriefing(due: Brief): Promise<Response> {
  const asked = (due === 'sunday'
    ? "Today's briefing, please. It is Sunday evening and the gold week is about to open."
    : "Today's briefing, please.")
    + await notesBlock() + await tradesBlock();

  const brief = await ask([...await recent(), { role: 'user', content: asked }], 'high');
  await say(`${greeting(due)}\n\n${brief}`);
  await remember([{ role: 'user', content: `[${due} briefing]` },
                  { role: 'assistant', content: brief }]);
  return json({ ok: true, brief: due });
}

/* How silence is said, since a tool call cannot express "do not send this".

   The whole reply, not a prefix: told to answer with one word a model will
   sometimes add a full stop, and "NOTHING." means the same thing. But "Nothing
   much has changed except gold is up forty" is news wearing the word, so it
   goes through. Erring toward sending is the right direction — a swallowed
   message is invisible, an extra one is merely an extra one.

   Exported because a pulse that could never go quiet would message him every
   weekday whether or not anything happened. */
export const isSilent = (text: string) => /^nothing[.!\s]*$/i.test(text.trim());

/* A quiet look, whose right answer is usually nothing at all.

   Nothing is stored when she stays quiet. Twelve turns is the whole window, and
   a week of "NOTHING" pairs would push the morning's briefing out of it — the
   one thing a follow-up question actually needs. */
async function postPulse(): Promise<Response> {
  const asked = "Pulse, please — anything since the briefing?" + await notesBlock();
  const said = await ask([...await recent(), { role: 'user', content: asked }], 'medium');

  if (isSilent(said)) return json({ ok: true, pulse: "quiet" });

  await say(said);
  await remember([{ role: 'user', content: '[pulse]' }, { role: 'assistant', content: said }]);
  return json({ ok: true, pulse: "sent" });
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
    // A slash command is addressed to Telegram, not to her, and /start arrives
    // once per install. Answering one costs a full model call with the notes
    // attached, so it is answered from here instead — Gladys ignores everything
    // that is not a tap for the same reason.
    if (msg.text.startsWith('/')) {
      await tg("sendMessage", { chat_id: CHAT_ID, text: "Aqui estoy, jefe. Just talk to me." });
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

    let answer: string;
    try {
      const history = await recent();
      answer = await ask([...history, { role: 'user', content: msg.text + await notesBlock() }], 'medium');
    } finally {
      // Stopped the moment there is something to send, not after sending it —
      // otherwise a ping fires between the message landing and the write, and
      // she reads as about to say more.
      clearInterval(keepTyping);
    }

    await say(answer);
    await remember([{ role: 'user', content: msg.text }, { role: 'assistant', content: answer }]);
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
    if (secretMatches(fromTelegram, WEBHOOK_SECRET)) {
      // Answer first, work after. See handleMessage.
      background(handleMessage(await req.json()));
      return json({ ok: true });
    }
    if (secretMatches(fromCron, CRON_SECRET)) {
      return await postScheduled(new URL(req.url));
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  } catch (err) {
    // pg_net discards this, so the console is where a missed briefing is
    // reported. Nothing retries: tomorrow's briefing is the next attempt.
    console.error("doji-eugenia:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
