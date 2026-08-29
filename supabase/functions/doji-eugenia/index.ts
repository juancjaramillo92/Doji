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
// SHE OWNS NO COLUMN OF `trades` AND HAS NO WRITE PATH TO IT. She reads the
// journal through the eugenia_trades view, which is granted SELECT and nothing
// else, and writes only her own conversation and her own notes — which is why
// she is not a fifth writer and has nothing to arbitrate with anybody.
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
import { SYSTEM, CONSOLIDATE } from "./prompt.ts";
import { ALWAYS, SECTIONS, VERSION } from "./strategy.ts";
// Everything shared lives in _shared/edge.ts — one definition each, for the
// reason that file gives.
import {
  env, secretMatches, json, nyClock, nyDate, telegram, sbHeaders, SB_URL, SB_KEY,
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

/* Weekday 09:00, 10:00 and 11:00 New York — the hours where a briefing is still
   a briefing rather than a bulletin about a morning that has gone. Nothing
   fires unless the 08:00 one failed, which briefedToday() decides. */
export function retryDue(now: Date): boolean {
  const { wd, hour } = nyClock(now);
  return wd >= 1 && wd <= 5 && hour >= 9 && hour <= 11;
}

/* SLEEP, ROUGHLY. Twenty-two hundred New York, every day including the weekend —
   a Saturday conversation is worth keeping as much as a Tuesday one.

   Clear of every other hour by construction: the briefing is 08:00 and Sunday
   17:00, the retries are 09:00 to 11:00, the pulse is 10:00. The week-walk test
   is what actually holds that, since an hour added to any of them could collide
   here and nothing else would notice.

   Late enough that the trading day and any evening conversation are done, which
   is what makes a fixed 24-hour window the right read: nothing needs a watermark
   because the window and the period between runs are the same length. A missed
   night loses the DISTILLATION of that day, never the day — the turns stay in
   the table and stay searchable, which is exactly why consolidation is allowed
   to be lossy. */
export function consolidateDue(now: Date): boolean {
  return nyClock(now).hour === 22;
}

/* WHAT THIS HOUR OWES — one answer, because one call cannot owe two.

   The three schedules above overlap, so the decision between them is a fourth
   one and belongs here rather than spread through the caller: each predicate
   answering correctly on its own says nothing about which of them wins.

   At 10:00 the retry window and the pulse both apply, and the retry takes it:
   on a day the briefing failed, the briefing is the thing worth having and a
   second look at a morning he was never told about is not. `briefed` is the
   fact the caller reads from the database, and only the retry hours turn on
   it. */
export function dueNow(now: Date, briefed: boolean): Brief | 'pulse' | 'consolidate' | null {
  const brief = briefDue(now);
  if (brief) return brief;
  if (retryDue(now) && !briefed) return 'weekday';
  if (pulseDue(now)) return 'pulse';
  return consolidateDue(now) ? 'consolidate' : null;
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
    "entry and fill time (UTC), pnl, size_oz, open_day, setup, and the three discipline " +
    "answers. A discipline answer of null means unanswered, which is NOT 'no'. " +
    "size_oz is the position size in ounces; lots are oz / 100. It is written by " +
    "the poller alone, so a trade it never reached has none. planned_stop and " +
    "planned_target are where he AIMED the trade, entered by hand at the time — " +
    "null on everything before they existed and on anything he did not journal. " +
    "They are the only record of intent: the broker reports the final stop, so a " +
    "stop moved to break-even has erased the original everywhere else.",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "integer", description: "How many days back to read, 1 to 365." },
    },
    required: ["days"],
    additionalProperties: false,
  },
} as const;

/* ─── What she remembers ───────────────────────────────────────────────────
   Twelve turns of conversation roll over in a morning, so without this she can
   never know in September that he has been working on holding his stop since
   August.

   TWO KINDS, AND THEY ARE NOT INTERCHANGEABLE. A `fact` is something about him
   she noticed. An `instruction` is something he TOLD her — "stop mentioning the
   ten-year", "too long" — and it is the only channel he has for correcting her:
   no settings page, no feedback button, and the conversation window forgets by
   morning.

   They are one table because they are the same shape and the same lifecycle,
   and they are read SEPARATELY because they are not the same size. Notes arrive
   at a few a week; instructions at a few ever. One newest-20 window over both
   would evict "stop mentioning the ten-year" after a month of ordinary
   observations — silently, and after she had told him it stuck, which is the
   one failure this feature cannot have.

   APPEND-ONLY, and read newest-first. Superseding either means writing a newer
   one, which is also how a person's memory works and is what lets him change
   his mind about an instruction with nothing to delete.

   Still not a writer to `trades`. eugenia_turns and eugenia_notes are hers;
   the journal remains one read through a view with no write path in the file.
   ───────────────────────────────────────────────────────────────────────── */
export const NOTE_KINDS = ['fact', 'instruction'] as const;
export const NOTE_MAX = 200;

const NOTES_TOOL = {
  name: "remember",
  description:
    "Keep one short line for later. Use kind='fact' for something about the trader — " +
    "how he trades, what he is working on, what he already understands, what " +
    "explanation landed; never today's price or today's data, which are stale " +
    "tomorrow. Use kind='instruction' for something he has told you to do or stop " +
    "doing, in his own words: those are standing, and every later message obeys " +
    "them. Record a fact silently; acknowledge an instruction in four words or fewer.",
  input_schema: {
    type: "object",
    properties: {
      note: { type: "string", description: `One short sentence, at most ${NOTE_MAX} characters.` },
      kind: {
        type: "string",
        enum: NOTE_KINDS,
        description: "'fact' for something you noticed about him; 'instruction' for something he told you.",
      },
      supersedes: {
        type: "integer",
        description:
          "Optional. The id of the note this one replaces, taken from the bracketed " +
          "number beside it. Use it whenever the new line contradicts, corrects or " +
          "updates an existing one — the old note stops being shown rather than " +
          "sitting alongside the new one disagreeing with it.",
      },
    },
    required: ["note", "kind"],
    additionalProperties: false,
  },
} as const;

/* ─── What he has decided ──────────────────────────────────────────────────
   The summary and the rules table ride on the cached system prompt and are in
   front of her on every turn. This is the rest: the reasoning under a rule, how
   a column is meant to be read, what a term means exactly.

   SHE CANNOT WRITE IT, and that is the point rather than an omission. A document
   that defines whether he followed his rules cannot also be edited by the thing
   checking them — adherence to a moving target is not measurable, and her own
   analysis would start feeding the standard she measures against.
   ───────────────────────────────────────────────────────────────────────── */
const STRATEGY_TOOL = {
  name: "get_strategy",
  description:
    "The reasoning behind his trading rules. You already hold the summary and the " +
    "rules table; this is the rest of the document — why a rule exists, how a " +
    "journal column is meant to be read, what a term means precisely. Sections: " +
    Object.keys(SECTIONS).map(k => `${k}`).join(", ") + ". " +
    "Read the section a rule cites before explaining that rule, rather than " +
    "reconstructing it from the one-line summary.",
  input_schema: {
    type: "object",
    properties: {
      section: { type: "string", description: "The section number, as the rules table cites it." },
    },
    required: ["section"],
    additionalProperties: false,
  },
} as const;

/* Synchronous and cannot fail: it is a module constant, not a database read.
   An unknown section is answered rather than refused — §7 cites sections that
   are drafted and not yet written, and "that part does not exist yet" is a
   better answer than silence, which she would fill in herself. */
function readStrategy(section: unknown): string {
  const key = String(section ?? "").trim().replace(/^§/, '');
  const found = SECTIONS[key];
  if (found) return found;
  return `The strategy has no section ${key}. It holds ${Object.keys(SECTIONS).join(", ")} ` +
         `at version ${VERSION}. Sections 1, 2, 3, 9, 10 and 11 are not written, ` +
         `so say that rather than guessing what it would have said.`;
}

/* ─── Reaching what the windows do not ─────────────────────────────────────
   Twelve turns and twenty notes are what she is HANDED. Everything older is
   still in the tables and simply never selected, so the archive is complete and
   unreachable at the same time. This is the reach.

   Deliberately not a wider window. Every token handed over is paid on every
   request and competes with the briefing for attention; a search is paid only
   when a question needs one, which is the same trade get_trades makes for the
   journal.
   ───────────────────────────────────────────────────────────────────────── */
const SEARCH_TOOL = {
  name: "search_memory",
  description:
    "Search everything you have ever said to him and every note you have kept — " +
    "far past the recent turns and notes you are handed each message. Use it when " +
    "he refers to something you discussed before that is not in front of you, when " +
    "you need to know whether you have already explained something, or when he asks " +
    "what you said or what he told you. Matches words, so search the terms that " +
    "would appear in the text rather than a description of it. Results say whether " +
    "each was a note or a turn, when it was, and whether a note has since been " +
    "retired — a retired one is what you used to believe and is no longer true.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The words to look for, as you would type them into a search box." },
    },
    required: ["query"],
    additionalProperties: false,
  },
} as const;

// Twelve hits and 300 characters each is roughly one briefing's worth of text —
// enough to answer from, and bounded, because a turn can be a whole briefing and
// an unbounded search result would push the conversation out of its own context.
const SEARCH_HITS = 12;
const SEARCH_CHARS = 300;

type Hit = { source: string; id: number; at: string; retired: boolean; body: string };

/* NEVER THROWS, for the reason writeNote does not: this runs inside the tool
   loop, and an exception here costs the answer she is in the middle of writing.
   A search that fails comes back as a sentence she can carry on from. */
async function searchMemory(query: unknown): Promise<string> {
  const q = String(query ?? "").trim();
  if (!q) return "Nothing to search for.";

  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/eugenia_search`, {
      method: "POST", headers: sbHeaders(),
      body: JSON.stringify({ q, lim: SEARCH_HITS }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hits: Hit[] = await res.json();

    // An empty result is an ANSWER, and saying so plainly is what stops her
    // reporting that she never discussed something when the search simply broke.
    if (!hits.length) return `Nothing in your memory matches "${q}".`;

    return hits.map(h => {
      const when = shortDay(new Date(h.at));
      const tag  = h.source === 'note'
        ? `note ${h.id}${h.retired ? ', RETIRED — you no longer believe this' : ''}`
        : `you said`;
      const body = h.body.length > SEARCH_CHARS ? h.body.slice(0, SEARCH_CHARS) + '…' : h.body;
      return `[${when}, ${tag}] ${body}`;
    }).join("\n");
  } catch (err) {
    console.error("doji-eugenia: search failed —", err instanceof Error ? err.message : err);
    return "Your memory could not be searched just now. Say you cannot check rather than answering as though you had.";
  }
}

// Twenty of each is a season of observations at the few-a-week the prompt asks
// for, and more standing instructions than he is ever likely to give — they are
// one sentence each, so the whole memory costs less than one paragraph.
const NOTES = 20;

/* LIVE NOTES ONLY, and the filter is the whole feature. Drop `superseded_by=is.null`
   and every retired line comes back — she is handed the correction and the thing
   it corrected, with nothing to say which won. The failure is silent, which is
   why agree.test.mjs reads this query for the filter.

   The id comes back too, because a note she cannot name is a note she cannot
   retire. It costs a few characters per line and it is what makes `supersedes`
   callable at all. */
async function readNotes(kind: string): Promise<Note[]> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_notes?select=id,note&kind=eq.${kind}` +
    `&superseded_by=is.null&order=id.desc&limit=${NOTES}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Notes read failed (HTTP ${res.status})`);
  return await res.json();
}

type Note = { id: number; note: string };

/* Truncated rather than refused, and it NEVER THROWS.

   Both for the same reason: this tool exists for a side effect, and the answer
   she is in the middle of writing matters more than the note. A sentence one
   character over its budget is still worth keeping, and a throw here would
   propagate out of the tool loop and cost the whole reply — so a failed write
   comes back as a sentence she can read and carry on from. It is also what
   makes her survive being deployed before 003_eugenia.sql has been run:
   no table, no memory, but every answer still lands.

   BOTH ANSWERS SAY WHICH KIND FAILED, because the two are not equally
   forgivable. A lost observation costs a little continuity and she should not
   mention it. A lost INSTRUCTION is worse than saying nothing: she is about to
   acknowledge it, and an acknowledgement for something that was never stored
   means he stops repeating himself about a thing she will keep doing. Same for
   a truncation — an instruction cut mid-sentence becomes a standing rule
   nobody wrote. */
async function writeNote(note: unknown, kind: unknown, supersedes: unknown): Promise<string> {
  const text = String(note ?? "").trim();
  if (!text) return "Nothing to remember.";

  // The kind decides how a failure is reported, so an unrecognised one takes
  // the quieter branch rather than promising him something.
  const k = (NOTE_KINDS as readonly string[]).includes(String(kind)) ? String(kind) : 'fact';
  const kept = text.slice(0, NOTE_MAX);

  // Decided BEFORE the write, because it decides what the write asks for. Only a
  // retirement needs the new row back, and asking for it every time left a body
  // nobody read on the common path — an unconsumed response holds its connection
  // open, and most notes supersede nothing.
  const old = Math.trunc(Number(supersedes));
  const retiring = Number.isFinite(old) && old > 0;

  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_notes`, {
      method: "POST", headers: sbHeaders(retiring ? "return=representation" : "return=minimal"),
      body: JSON.stringify([{ note: kept, kind: k }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    /* THE NEW NOTE IS SAFE BEFORE ANY OF THIS RUNS, and that ordering is the
       point: a retirement that fails leaves two live notes, which is today's
       behaviour and is recoverable. Retiring first and failing to write would
       lose the correction and the thing it corrected in one go. */
    if (retiring) {
      const [row] = await res.json();
      const done = await fetch(
        `${SB_URL}/rest/v1/eugenia_notes?id=eq.${old}&superseded_by=is.null`, {
          method: "PATCH", headers: sbHeaders("return=representation"),
          body: JSON.stringify({ superseded_by: row.id }),
        });
      // A miss is not an error — she may have named a note that never existed or
      // one already retired — but it must not pass as done, or she believes a
      // contradiction is gone while it is still being handed to her every turn.
      if (!done.ok || (await done.json()).length === 0) {
        return `Remembered, but note ${old} is not there to retire — ` +
               `it may already be superseded. Check the list you were given.`;
      }
    }

    if (kept.length < text.length) {
      return `Kept, but cut at ${NOTE_MAX} characters: "${kept}". ` +
             (k === 'instruction'
               ? 'Say it back to him shorter and check that is still what he meant.'
               : 'Write it shorter next time.');
    }
    return "Remembered.";
  } catch (err) {
    console.error("doji-eugenia: note not written —", err instanceof Error ? err.message : err);
    return k === 'instruction'
      ? "That did NOT save. Tell him it did not stick and that he will have to say it again."
      : "That did not save. Carry on and do not mention it.";
  }
}

/* The whole query, built in one place so a test can read it. `days` arrives
   from the model, so it is clamped rather than trusted: this is the boundary.
   400 rows is far more than a year of this account and stops a wide window
   returning a context-filling answer.

   THE WINDOW IS COUNTED IN CIVIL DAYS, NOT IN MILLISECONDS, because `open_day`
   is a civil day. Subtracting n × 86,400,000 and formatting the result is
   instant arithmetic wearing a civil-day label: it is right until a clock
   change, when a day is 23 or 25 hours long and "seven days ago" lands on the
   wrong date. So today's New York date is taken first and the days are stepped
   off it — the same way index.html walks to a week or a month boundary. */
export function tradesQuery(days: unknown, now = Date.now()): string {
  const n = Math.min(Math.max(Math.trunc(Number(days)) || 30, 1), 365);

  const [y, m, d] = nyDate(new Date(now)).split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d));
  from.setUTCDate(from.getUTCDate() - n);

  return `eugenia_trades?open_day=gte.${from.toISOString().slice(0, 10)}` +
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

/* THE CONTAINER, AND WHY IT IS NOT OPTIONAL.

   web_search_20260209 does dynamic filtering, which runs CODE EXECUTION on
   Anthropic's side. From inside that container the model can call our tools
   programmatically rather than directly — the paused code invokes get_trades,
   the result returns to the running script instead of to the model's context.

   A continuation answering those calls must carry the container id from the
   paused response, and a request that does not is rejected outright:

     container_id is required when there are pending tool uses generated by
     code execution with tools

   which is what took the briefing down the morning after get_trades and
   remember were both in play. The id is a bare string on the request, though
   the response nests it under container.id.

   Two more rules of that contract are already met and must stay met: the user
   message answering the calls carries ONLY tool_result blocks — no text, ever —
   and the tools array is identical on every request of the turn.

   Neither tool may declare strict: true. Structured outputs are not supported
   with programmatic calling, and that is why the two schemas below do not carry
   it. Nothing is lost: tradesQuery clamps `days` and writeNote coerces `note`,
   because both were already written as boundaries rather than trusting the
   model. */
/* TWO TOOL SETS, because the two jobs are not the same conversation.

   Consolidation is handed the day and the notes and asked what is worth
   keeping; it has no question to research and nothing to look up in the
   journal. Sending it the full set would let a nightly bookkeeping pass run a
   dozen web searches, which is money for nothing and a slower job that can fail
   in more ways.

   Both are served by the same loop below — a tool set is a list of what may be
   offered, never of what can be executed. */
const CHAT_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 12 },
  TRADES_TOOL,
  NOTES_TOOL,
  SEARCH_TOOL,
  STRATEGY_TOOL,
];
const CONSOLIDATE_TOOLS = [NOTES_TOOL];

async function call(messages: any[], effort: Effort, tools: unknown[], container?: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      // A HEADER, NOT A BODY FIELD, and the difference is total. `betas: [...]`
      // is what the SDKs accept and what they turn into this header; a raw
      // fetch sending it in the JSON sends an unknown parameter, which the API
      // rejects — and `fallbacks` without the header is rejected as well. So
      // the shape below 400s every call, briefing and reply alike, which is
      // the whole function. It shipped that way for one commit.
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 16000,
      // Cached: both are long, fixed, and sent on every turn — which is exactly
      // why the strategy rides here rather than in the message.
      system: [{ type: "text", text: SYSTEM + ALWAYS, cache_control: { type: "ephemeral" } }],
      messages,
      // web_search runs on Anthropic's side and needs no loop here; the rest
      // are ours and are executed below.
      tools,
      thinking: { type: "adaptive" },
      output_config: { effort },
      // A DECLINE COSTS THE WHOLE BRIEFING OTHERWISE. The cron half now retries
      // at 09:00, 10:00 and 11:00, so a refusal is no longer silent — but a
      // retry is another dozen searches paid for again, and the next hour may
      // decline for the same reason. `fallbacks: "default"` re-runs the request
      // on another model inside this same call and routes by refusal category,
      // so there is no model list here to go stale, and a decline before any
      // output is not billed.
      fallbacks: "default",
      // Only once there is one — the first request of a turn has no container.
      ...(container ? { container } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Six rounds, because a loop that cannot end is a loop that bills forever.
// Three is the realistic maximum now — read the journal, write a note, answer —
// and the cap exists for the case where that assumption is wrong rather than as
// a working limit.
const MAX_ROUNDS = 6;

async function ask(messages: Turn[], effort: Effort, tools: unknown[] = CHAT_TOOLS): Promise<string> {
  const convo: any[] = withClock(messages);
  // Carried forward once seen, and never cleared: the container outlives the
  // round that opened it, and a later request that drops it fails the same way
  // the missing one did.
  let container: string | undefined;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body = await call(convo, effort, tools, container);
    container = body.container?.id ?? container;
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
        // Only the three this function serves. web_search runs on Anthropic's
        // side and never arrives here; anything else is a name we did not send.
        if (b.name === TRADES_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: b.id, content: await readTrades(b.input?.days) });
        } else if (b.name === NOTES_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: b.id,
            content: await writeNote(b.input?.note, b.input?.kind, b.input?.supersedes) });
        } else if (b.name === SEARCH_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: b.id,
            content: await searchMemory(b.input?.query) });
        } else if (b.name === STRATEGY_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: b.id,
            content: readStrategy(b.input?.section) });
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
    `${SB_URL}/rest/v1/eugenia_turns?select=role,content,created_at&order=id.desc&limit=${HISTORY}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`History read failed (HTTP ${res.status})`);
  return openOnUser(dateTurns((await res.json()).reverse()));
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
   Nothing here is untrusted anyway: the trades are his own journal, and the
   notes are her sentences or his, in his own thread — so the injection safety a
   system turn buys is not what this needs.

   remember() stores the RAW message, never the augmented one, so a preamble is
   never resent forever as history.
   ───────────────────────────────────────────────────────────────────────── */

/* ─── What time it is ─────────────────────────────────────────────────────
   SHE HAS NO CLOCK OTHERWISE, and the absence does not read as one. Her whole
   context is a system prompt about morning briefings and a history whose most
   recent long turn IS this morning's briefing — so asked a question at 23:42
   she opened with "morning", which is not a model error but the only inference
   available from what she was given.

   It also silently undermines everything she says about dates. The prompt asks
   her to be specific with dates and to say he has not traded since one, and
   get_trades computes its window from Date.now() on this side — so the DATA is
   right while her narration of it is a guess.

   A display format with one caller, so it stays here rather than in _shared,
   the same way Gladys's nyTime does. The trust clause is load-bearing: the
   turns above genuinely are from this morning, and without it the freshest
   thing in her context still argues for the wrong answer. */
// hourCycle rather than hour12: false, which leaves the cycle to the locale and
// can resolve to h24 — midnight rendering "24:05". _shared's nyClock states it
// for the same reason.
const nyStamp = (now: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', weekday: 'long', day: 'numeric', month: 'long',
  year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(now);

export const nowBlock = (now = new Date()) =>
  `\n\n[Right now it is ${nyStamp(now)} in New York. Trust this over anything ` +
  `the conversation above implies about the time or the date.]`;

/* THE CLOCK GOES ON IN ONE PLACE, and it has to. Three callers each appending
   it is three chances to forget: removing it from the pulse alone left every
   test green, because the tests called nowBlock directly and nothing proved it
   reached a message. A caller cannot omit what it does not attach.

   The last user turn, because that is the one being asked. History is dated
   separately — see dateTurns — and the stored turn is still the raw text, since
   this runs on a copy the caller never sees. */
export function withClock(messages: Turn[], now = new Date()): Turn[] {
  const last = messages.length - 1;
  if (last < 0 || messages[last].role !== 'user') return messages;
  return messages.map((m, i) =>
    i === last ? { ...m, content: m.content + nowBlock(now) } : m);
}

/* HISTORY IS DATED TOO, or "yesterday you said" is a guess across a weekend.
   The prompt asks her for continuity and now forbids inferring the date from
   the conversation, which together leave her nothing to reason from unless the
   turns carry their own. created_at is already on the table and already read by
   briefedToday.

   The user turn of each pair only: it anchors the exchange, and prefixing her
   own words back to her reads as though she said them. */
const shortDay = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short',
}).format(d);

export function dateTurns(rows: (Turn & { created_at: string })[]): Turn[] {
  return rows.map(({ role, content, created_at }) => role === 'user'
    ? { role, content: `[${shortDay(new Date(created_at))}] ${content}` }
    : { role, content });
}

/* Optional by design: a database blip must cost her the memory, not the
   briefing. Logged, because a bot that has quietly stopped remembering reads
   exactly like a bot with nothing to remember.

   The two kinds are labelled differently on purpose. What she noticed is
   context; what he told her is not, and a list that ran them together would
   invite her to weigh an instruction against her own observation. */
async function notesBlock(): Promise<string> {
  try {
    const [told, noticed] = await Promise.all([
      readNotes('instruction'), readNotes('fact'),
    ]);
    // `[12] he trades the London open` — the number is how she names one in
    // `supersedes`, so it is part of the line rather than decoration.
    const list = (ns: Note[]) =>
      `\n· ` + ns.map(n => `[${n.id}] ${n.note}`).join("\n· ");
    return (told.length
             ? `\n\nWhat he has told you to do, newest first. These are not optional and a` +
               ` later one replaces an earlier one:${list(told)}`
             : "")
         + (noticed.length
             ? `\n\nWhat you have noticed about him, newest first:${list(noticed)}`
             : "");
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
// ?force=1 runs a briefing now, ?pulse=1 a pulse and ?consolidate=1 the nightly
// pass, whatever the clock says — the same flag doji-mcp-sync carries, for the
// same two jobs: a manual re-run after a failure, and a way to exercise the path
// without waiting for the hour. ?consolidate=1 is also the only way to SEE what
// the nightly pass does, since it sends nothing and stores no turn.
// The answer comes back in the response as well as in Telegram, which is what
// makes a failure readable.
async function postScheduled(url: URL): Promise<Response> {
  try {
    if (url.searchParams.get("pulse") === "1") return await postPulse();
    if (url.searchParams.get("consolidate") === "1") return await postConsolidation();

    const now = new Date();
    if (url.searchParams.get("force") === "1") {
      return await postBriefing(briefDue(now) ?? 'weekday');
    }

    // Which hours turn on this is dueNow's rule and is stated there once; a
    // caller deciding when to bother asking would be the same rule again, and
    // the read is thirty rows.
    const due = dueNow(now, await briefedToday());
    if (due === 'pulse') return await postPulse();
    if (due === 'consolidate') return await postConsolidation();
    if (due) return await postBriefing(due);

    return json({ ok: true, skipped: "nothing due this hour" });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error("doji-eugenia:", why);
    /* THE ONLY WAY HE FINDS OUT, and it took a missing briefing to earn this.

       pg_net discards this response, the console is not somewhere anyone looks,
       and net._http_response is pruned within hours — so a briefing that died
       at 08:00 was invisible by lunchtime and the way it surfaced was him
       noticing nothing had arrived. Silence is the worst thing this system can
       do, and it had three separate ways of doing it. */
    await tg("sendMessage", {
      chat_id: CHAT_ID,
      text: `No briefing, jefe — something broke on my side.\n\n${why.slice(0, 600)}`,
    }).catch(() => {});
    return json({ ok: false, error: why }, 500);
  }
}

/* Whether a briefing has already landed today, read off the marker
   postBriefing stores in place of the sent text. It is written just BEFORE the
   send, so it exists whenever a briefing was generated — which is the question
   worth asking here, because the expensive half is the generation and a retry
   that duplicates it is the failure this guards.

   The day comparison is done HERE, in New York, rather than as a timestamp
   filter in the query. A `created_at=gte.<date>T00:00:00-05:00` would be an
   hour wrong for half the year, which is the same mistake briefDue and
   marketOpen exist to avoid; asking Intl for the civil day of each row is
   correct in both halves.

   A read failure counts as "yes, already briefed": if the database is unwell
   the retry cannot check, and sending a second briefing on a guess is worse
   than skipping one. */
async function briefedToday(): Promise<boolean> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/eugenia_turns?select=content,created_at&role=eq.user` +
      `&order=id.desc&limit=30`, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const today = nyDate(new Date());
    return (await res.json()).some((r: { content: string; created_at: string }) =>
      isBriefingMarker(r.content) && nyDate(new Date(r.created_at)) === today);
  } catch (err) {
    console.error("doji-eugenia: could not check for today's briefing —",
      err instanceof Error ? err.message : err);
    return true;
  }
}

/* What postBriefing stores instead of the text it sent, and the only thing
   briefedToday recognises. One definition, because a retry that could not spot
   yesterday's shape would send a second briefing every morning. */
export const briefingMarker = (due: Brief) => `[${due} briefing]`;
export const isBriefingMarker = (content: string) =>
  content === briefingMarker('weekday') || content === briefingMarker('sunday');


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

  /* THE MARKER GOES DOWN BEFORE THE SEND, and the order is the whole point.
     Written after, a remember() that fails leaves a briefing delivered, an
     apology saying none arrived, and no marker — so 09:00, 10:00 and 11:00 each
     generate and send another one. Four briefings and four times the bill, from
     one failed insert.

     Written first, the failure mode inverts: a send that fails after the marker
     lands costs the retry rather than duplicating it, and he is told. Losing a
     briefing is cheaper than sending four. */
  await remember([{ role: 'user', content: briefingMarker(due) },
                  { role: 'assistant', content: brief }]);
  await say(`${greeting(due)}\n\n${brief}`);
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
/* ─── The nightly pass ─────────────────────────────────────────────────────
   Twelve turns roll over in a morning. Without this, everything a conversation
   established is reachable only by search and only if someone thinks to look —
   so what she KNOWS never grows, however much she has been told.

   A FIXED TWENTY-FOUR HOURS, and no watermark anywhere. The window and the gap
   between runs are the same length, so a run reads exactly the day that has not
   been read. A missed night loses that day's distillation and never the day
   itself: the turns stay in the table and stay searchable, which is precisely
   what makes a lossy pass safe to run unattended.

   NOTHING IS SENT AND NOTHING IS STORED AS A TURN. Her reply here is a line for
   the log, not a message — and storing it would spend two of the twelve turns
   she opens tomorrow on bookkeeping she wrote to herself.
   ───────────────────────────────────────────────────────────────────────── */
const CONSOLIDATE_HOURS = 24;

// Far more than a real day of conversation, and a bound rather than a working
// limit — every other read in this file has one (400 trades, twelve turns,
// twenty notes) and this was the only one that did not. A backfill, a loop, or
// simply a very long day would otherwise put the whole window into a `high`
// effort call with nothing to stop it.
const CONSOLIDATE_TURNS = 200;

async function turnsSince(hours: number): Promise<Turn[]> {
  const from = new Date(Date.now() - hours * 3600_000).toISOString();
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_turns?select=role,content,created_at` +
    `&created_at=gte.${from}&order=id.asc&limit=${CONSOLIDATE_TURNS}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Day read failed (HTTP ${res.status})`);
  return dateTurns(await res.json());
}

async function postConsolidation(): Promise<Response> {
  const day = await turnsSince(CONSOLIDATE_HOURS);
  // A day nobody spoke on has nothing to distil, and a call that says so costs
  // a model round to be told what an empty array already said.
  if (!day.length) return json({ ok: true, skipped: "nothing said" });

  const asked = CONSOLIDATE + await notesBlock() +
    `\n\nThe day, oldest first:\n\n` +
    day.map(t => `${t.role === 'user' ? 'him' : 'you'}: ${t.content}`).join("\n\n");

  // `high`, and it is the one place that is not a latency decision: this writes
  // the memory every later briefing reasons from, and a careless note outlives
  // a careless briefing by months.
  const said = await ask([{ role: 'user', content: asked }], 'high', CONSOLIDATE_TOOLS);
  console.log("doji-eugenia: consolidated —", said.slice(0, 200));
  return json({ ok: true, consolidated: day.length });
}

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
      answer = await ask(
        [...history, { role: 'user', content: msg.text + await notesBlock() }], 'medium');
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
    // pg_net discards this, so the console and the Telegram message above are
    // where a failure is reported. postScheduled retries a failed briefing at
    // 09:00, 10:00 and 11:00; anything reaching here is outside that.
    console.error("doji-eugenia:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
