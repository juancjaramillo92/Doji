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
import { SYSTEM, CONSOLIDATE, CRITIC, RELEASE, MOVE, TRADE_EVENT, CHANNELS, CHANNEL_STATES } from "./prompt.ts";
import { ALWAYS, SECTIONS, VERSION } from "./strategy.ts";
// The eight rules a row can answer, evaluated rather than reasoned about. Pure
// and imported rather than inlined for the reason balanceTarget and foldHours
// are exported in the app: it is the part that has to be testable.
import { checkRules, adherenceList, dayStanding, DAY_LOSS, type TradeRow } from "./adherence.ts";
// Everything shared lives in _shared/edge.ts — one definition each, for the
// reason that file gives.
import {
  env, secretMatches, json, marketOpen, nyClock, nyDate, telegram, sbHeaders, SB_URL, SB_KEY,
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

/* AND IT GETS THE RETRY THE BRIEFING HAS HAD ALL ALONG. Twenty-three hundred,
   still inside the same New York civil day — which is what makes "did tonight's
   pass run" a question with an answer, since the check below is against today.

   The pass was the only schedule in this file with no meter and no second
   chance. A briefing that dies is retried three times and apologised for; a
   pass that died was silent, and its symptom is that her memory quietly stops
   growing — which looks exactly like a bot with nothing worth remembering.
   That is the same invisible-absence shape `unseen` and `moved_on` exist to
   defeat, arriving for a third time in a different place. */
export function consolidateRetryDue(now: Date): boolean {
  return nyClock(now).hour === 23;
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
export function dueNow(now: Date, briefed: boolean, consolidated: boolean):
    Brief | 'pulse' | 'consolidate' | null {
  const brief = briefDue(now);
  if (brief) return brief;
  if (retryDue(now) && !briefed) return 'weekday';
  // ONE CLAUSE FOR BOTH NIGHTLY HOURS, and the gate is what makes 23:00 a retry
  // rather than a second pass: a night that already distilled itself does
  // nothing at 23:00, and a night that failed at 22:00 gets one more go while
  // the day it is reading is still the day it is filed under.
  if ((consolidateDue(now) || consolidateRetryDue(now)) && !consolidated) return 'consolidate';
  return pulseDue(now) ? 'pulse' : null;
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

   TWO LOOKUPS RATHER THAN A max() OVER THE PAIR, and the difference is that the
   max() cannot express the preference above. Every blank line contains a
   newline at a higher index, so lastIndexOf('\n') is always at or past
   lastIndexOf('\n\n') and the paragraph term can never win — the split silently
   took the last newline of any kind, which lands mid-list inside the one shape
   FORMAT permits a newline in.
   ───────────────────────────────────────────────────────────────────────── */
export const TG_LIMIT = 4096;

export function chunk(text: string, limit = TG_LIMIT): string[] {
  const out: string[] = [];
  let rest = text.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // lastIndexOf on the window, so the break is always inside the budget.
    const para = window.lastIndexOf('\n\n');
    const line = window.lastIndexOf('\n');
    const cut = para > limit / 2 ? para : line > limit / 2 ? line : limit;
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
    "the poller alone, so a trade it never reached has none.",
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

/* ─── Where he stands on each channel ──────────────────────────────────────
   The five channels are the map her teaching is anchored to, and this is the
   only part of her memory that never scrolls: five rows rather than a window,
   so a channel he has NEVER used is legible as a row saying so. Notes cannot
   carry that — an absence is not something anybody writes down.

   CONSOLIDATION ONLY, and deliberately not in CHAT_TOOLS beside `remember`.
   A note is a moment and is fairly written in one; a rung is a judgment across
   days, and moving one from a single exchange is the same error as reading a
   pattern into one fill. The nightly pass is the only caller that sees a whole
   day, which is exactly the argument that put note-writing there as well.

   A DEMOTION IS NOT THAT JUDGMENT — IT IS SOMETHING HE SAID — and it still
   lands here rather than mid-conversation. The pass reads the whole day, so
   *"explain that again"* is in front of it either way, and the rung is fixed
   before the next morning's briefing, which is the only place it is read. What
   putting the tool in CHAT_TOOLS would buy is a few hours; what it would cost
   is its schema on every single request and a promotion she could make from one
   exchange.
   ───────────────────────────────────────────────────────────────────────── */
const CHANNEL_TOOL = {
  name: "set_channel",
  description:
    "Move one channel along the ladder, at the nightly pass and nowhere else. The " +
    "rungs in order are " + CHANNEL_STATES.join(", ") + ": unseen is never come " +
    "up, explained is you explained it and he has not used it back, used is he " +
    "used it himself, owns is he reasoned with it unaided more than once. Move " +
    "UP on evidence from the day in front of you, never on a nod, and most nights " +
    "nothing moves at all. Move DOWN only when he has said he has lost one — that " +
    "is his to declare and never yours to argue with. Nothing goes back to " +
    CHANNEL_STATES[0] + ", which says a channel has never once come up.",
  input_schema: {
    type: "object",
    properties: {
      channel:  { type: "string", enum: CHANNELS.map(([id]) => id),
                  description: "Which channel." },
      state:    { type: "string", enum: CHANNEL_STATES,
                  description: "The rung it moves to." },
      evidence: { type: "string",
                  description: `One line saying what moved it, at most ${NOTE_MAX} characters.` },
    },
    required: ["channel", "state", "evidence"],
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
   An unknown section is answered rather than refused — the number arrives from
   the model, so a mistyped or an invented one is what this has to survive, and
   "there is no such section" is a better answer than silence, which she would
   fill in herself.

   A SUBSECTION IS SERVED BY THE SECTION THAT HOLDS IT, and without that the two
   citations she is handed on every single turn were the two this could not
   answer. R-05 cites §4.1 and R-06 cites §4.2; both are written, in full,
   inside §4 — and an exact lookup told her they did not exist, which is not a
   blank she fills in herself but something worse: a wrong fact about the
   document, delivered by the one tool that exists to stop her inventing one.

   Exported because it is the decision. The test that was meant to catch this
   read the file for the word `has no section` and passed, and the one that
   reads citations captured `4` out of `§4.1`. */
export function readStrategy(section: unknown): string {
  const key = String(section ?? "").trim().replace(/^§/, '');
  const found = SECTIONS[key] ?? SECTIONS[key.split('.')[0]];
  if (found) return found;
  return `The strategy has no section ${key}. It holds ${Object.keys(SECTIONS).join(", ")} ` +
         `at version ${VERSION}. Sections 1 and 11 do not exist and nothing ` +
         `cites them, so say that rather than guessing what they would have said.`;
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
    "what you said or what he told you. It matches both the words and the MEANING, " +
    "so ask it as you would ask a person — and still include any exact term that " +
    "matters, a date or a rule number, since those are found by the words. Results say whether " +
    "each was a note, something you said or something HE said, when it was, and " +
    "whether a note has since been retired — a retired one is what you used to " +
    "believe and is no longer true.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you are looking for, phrased as a question or a description — with any exact terms that matter included in it." },
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

export type Hit = { source: string; id: number; at: string; retired: boolean; body: string };

/* WHO SAID IT IS PART OF THE HIT, and it went missing on the way out of the
   database. eugenia_turns carries `role`; eugenia_search did not select it, and
   every turn came back rendered `you said` — so half of every result set was
   HIS words handed back to her as her own. She would quote an instruction he
   gave as her own analysis, or deny having said something he said, fluently and
   with nothing anywhere reporting it.

   The role rides in `source` rather than in a column of its own because
   `create or replace function` may not change a return type, and dropping the
   function to widen it takes its grants with it. Three values, one column, no
   migration hazard: `note`, `you`, `him`.

   The words themselves are a map rather than a chain of ternaries, because they
   are one half of a vocabulary the database holds the other half of: a name
   woven into a conditional is not something a reader can enumerate, and this
   pair has to be comparable against the SQL's own literals or it is once again
   a copy nothing can check. An unrecognised source renders as itself rather
   than folding into hers — a value renamed on one side would otherwise land in
   the default branch and quietly restore the misattribution.

   Pure, so a test can drive all three renderings; the read stays with the
   caller — the same split notesList and channelsList are written on. */
export const SAID: Record<string, string> = { you: 'you said', him: 'he said' };

export function searchList(hits: Hit[]): string {
  return hits.map(h => {
    const when = shortDay(new Date(h.at));
    const tag  = h.source === 'note'
      ? `note ${h.id}${h.retired ? ', RETIRED — you no longer believe this' : ''}`
      : SAID[h.source] ?? h.source;
    const body = h.body.length > SEARCH_CHARS ? h.body.slice(0, SEARCH_CHARS) + '…' : h.body;
    return `[${when}, ${tag}] ${body}`;
  }).join("\n");
}

/* ─── Meaning, rather than words ───────────────────────────────────────────
   THE SEARCH BELOW WAS FULL TEXT AND TRIGRAM, WHICH FIND A REPHRASING AND NOT
   A DIFFERENT IDEA. *"What did we conclude about the December cut"* against a
   turn that said *"the market has mostly given up on easing this year"* shares
   no substrings at all — so she answers that they never discussed it, which is
   worse than answering that she cannot find it.

   THIS ADDS NO MEMORY AND NO WINDOW. Twelve turns and twenty notes are what she
   is handed and that does not move: every token in a window is paid on every
   request, and search is what reaches past it. Everything a vector finds was
   already in the table.

   NEVER THROWS, AND UNSET IS A FIRST-CLASS STATE. With no EMBED_KEY every
   caller here gets null, writes its row without a vector, and the search runs
   exactly as it did before — the SQL's fusion over one arm reproduces the old
   ordering. That is what lets this ship before the key exists rather than
   after: the failure of an embedding must never cost the note, the turn, or
   the answer she is in the middle of writing.
   ───────────────────────────────────────────────────────────────────────── */
const EMBED_URL = env("EMBED_URL") || "https://api.openai.com/v1/embeddings";
const EMBED_KEY = env("EMBED_KEY");

/* PINNED HERE RATHER THAN READ FROM THE ENVIRONMENT, and that is the whole
   difference between this and STT_MODEL. A transcription model chosen in the
   dashboard changes one answer; an EMBEDDING model chosen there changes what is
   comparable to what. Vectors from two models are not comparable and nothing
   says so — the column type catches a change of WIDTH and cannot catch a change
   at the same width, so ranking would degrade into noise with no error
   anywhere. Changing it is therefore a code change, reviewable in a diff, and
   it means re-embedding both tables. */
const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;

/* Fifty at a time. The vendor call is one request whatever the count, so the
   batch is sized by the writes that follow it — those are one PATCH per row,
   since an upsert cannot be used here: PostgREST would send a row carrying only
   `id` and `embedding`, and `content not null` is checked when the tuple is
   built, before any conflict is detected. */
const EMBED_BATCH = 50;

/* ORDERED BY THE INDEX THE VENDOR STATES, never by arrival. Each object carries
   the position of the input it answers, and taking the array as it comes would
   file a vector against the wrong row — a memory that returns the wrong text
   for the right question, with nothing anywhere able to reveal it.

   ALL OR NOTHING for the same reason: a short answer, or one of the wrong
   width, gives no way to tell WHICH row lost its vector, so none is written and
   the sweep tries the batch again.

   Pure and exported because it is the decision, and because the alternative is
   a test that stubs a vendor to prove a sort it supplied the answer to. Returns
   pgvector's own text form rather than numbers: the same string goes into the
   column and into the search, and `[0.1,0.2,…]` crosses a JSON body into a
   `vector` intact where a JSON array would depend on a cast from json that
   pgvector does not promise. */
export function foldVectors(data: any, want: number): string[] | null {
  const rows = Array.isArray(data) ? [...data] : [];
  rows.sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));
  const vecs = rows.map((d: any) => d?.embedding);

  if (vecs.length !== want) return null;
  if (vecs.some((v: any) => !Array.isArray(v) || v.length !== EMBED_DIMS)) return null;
  return vecs.map((v: number[]) => `[${v.join(",")}]`);
}

async function embed(texts: string[]): Promise<string[] | null> {
  if (!EMBED_KEY || !texts.length) return null;

  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${EMBED_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, dimensions: EMBED_DIMS, input: texts }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const vecs = foldVectors((await res.json())?.data, texts.length);
    if (!vecs) throw new Error(`asked for ${texts.length} vectors of ${EMBED_DIMS}, got something else`);
    return vecs;
  } catch (err) {
    console.error("doji-eugenia: embedding failed —", err instanceof Error ? err.message : err);
    return null;
  }
}

/* NEVER THROWS, for the reason writeNote does not: this runs inside the tool
   loop, and an exception here costs the answer she is in the middle of writing.
   A search that fails comes back as a sentence she can carry on from. */
async function searchMemory(query: unknown): Promise<string> {
  const q = String(query ?? "").trim();
  if (!q) return "Nothing to search for.";

  try {
    // Unset key, failed call, or a query that embeds to nothing — all three are
    // one null, and the function answers lexically as it always did.
    const [qv] = await embed([q]) ?? [];
    const res = await fetch(`${SB_URL}/rest/v1/rpc/eugenia_search`, {
      method: "POST", headers: sbHeaders(),
      body: JSON.stringify({ q, lim: SEARCH_HITS, qv: qv ?? null }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hits: Hit[] = await res.json();

    // An empty result is an ANSWER, and saying so plainly is what stops her
    // reporting that she never discussed something when the search simply broke.
    if (!hits.length) return `Nothing in your memory matches "${q}".`;

    return searchList(hits);
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

// `[12] he trades the London open` — the number is how a note is NAMED when one
// is retired, so it is part of the line rather than decoration. Both renderings
// carry it: hers, so she can pass `supersedes`, and his, so he can say which.
const noteLine = (n: Note) => `[${n.id}] ${n.note}`;

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
    /* INSIDE THE try AND BEFORE THE INSERT. Before, so the note lands with its
       vector in one statement rather than needing a second write that could
       fail on its own — a null here costs nothing but a place in the sweep.
       Inside, because this function's whole contract is that it never throws:
       embed() catches its own failures today, and a fetch outside the try would
       make that promise depend on it continuing to. */
    const [vec] = await embed([kept]) ?? [];
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_notes`, {
      method: "POST", headers: sbHeaders(retiring ? "return=representation" : "return=minimal"),
      body: JSON.stringify([{ note: kept, kind: k, ...(vec ? { embedding: vec } : {}) }]),
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

/* NEVER THROWS, for the reason writeNote does not — it runs inside the tool
   loop and an exception costs the answer being written. Both names are checked
   against prompt.ts rather than trusted: the tool schema declares an enum, and
   a value outside it would be refused by the check constraint as a 400 that
   reads like a database fault rather than like a bad argument.

   moved_on is a New York civil day, computed here. Defaulting it to now() in
   the schema would file an evening move on tomorrow. */
async function setChannel(channel: unknown, state: unknown, evidence: unknown): Promise<string> {
  const id = String(channel ?? "");
  const to = String(state ?? "");
  if (!CHANNELS.some(([c]) => c === id)) {
    return `There is no channel called "${id}". They are ` +
           CHANNELS.map(([c]) => c).join(", ") + ".";
  }
  if (!(CHANNEL_STATES as readonly string[]).includes(to)) {
    return `"${to}" is not a rung. They are ` + CHANNEL_STATES.join(", ") + ".";
  }
  /* THE BOTTOM RUNG IS A FACT ABOUT HISTORY, NOT ABOUT HOW WELL HE HOLDS IT, so
     a demotion can reach every rung but that one. Written back, it would report
     a channel she taught last week as one he has never met — and an absence that
     can be manufactured is no longer the absence the census exists to show. */
  if (to === CHANNEL_STATES[0]) {
    return `${id} cannot go back to ${CHANNEL_STATES[0]} — it has come up. ` +
           `Move it to ${CHANNEL_STATES[1]} if he has said he has lost it.`;
  }

  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_channels?channel=eq.${id}`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({
        state: to,
        evidence: String(evidence ?? "").trim().slice(0, NOTE_MAX) || null,
        moved_on: nyDate(new Date()),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // A PATCH that matches nothing is a 200 with an empty array, and it must not
    // pass as done: the row is seeded by 003_eugenia.sql, so an empty answer
    // means the migration has not been applied and every move is being dropped.
    if ((await res.json()).length === 0) {
      return `No row for ${id} — the channels table has not been seeded, so ` +
             `nothing was saved. Say nothing about this to him.`;
    }
    return `${id} is now ${to}.`;
  } catch (err) {
    console.error("doji-eugenia: channel not moved —",
      err instanceof Error ? err.message : err);
    return "That did not save. Carry on and do not mention it.";
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

/* NEVER THROWS, for the reason searchMemory and writeNote do not: this runs
   inside the tool loop, and an exception here costs the answer she is in the
   middle of writing. It cost four — a briefing and its three retries, one
   sentence each and nothing else all day — the morning the view behind it was
   dropped and not rebuilt. The read that killed them was the one the model
   ASKED for; the identical failure in tradesBlock had already been absorbed a
   round earlier, which is how a briefing came to die of a read it had already
   survived.

   AND IT SAYS SO, rather than coming back empty. "No trades in that window" is
   an answer and must be reserved for a window that was actually looked at: it
   is the sentence a briefing turns into "you have not traded since Friday",
   which is a false statement about his own week from the one thing he trusts
   to have read it. */
async function readTrades(days: unknown): Promise<string> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${tradesQuery(days)}`, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return rows.length ? JSON.stringify(rows) : "No trades in that window.";
  } catch (err) {
    console.error("doji-eugenia: trades read failed —", err instanceof Error ? err.message : err);
    return "His journal could not be read just now. Say you cannot see it rather than saying he has not traded.";
  }
}

/* ─── His own rules, evaluated ─────────────────────────────────────────────
   §7 writes a predicate for every rule and §8 writes the filters and the three
   verdicts. Both were prose she had to apply by hand, over up to four hundred
   rows of JSON, on the way to a number — which is the single most error-prone
   thing she does and the place a wrong answer is least visible.

   THIS IS NOT A VERDICT ON A TRADE and does not become one. It reports whether
   a row satisfies a predicate HE wrote down. "Two entries were 41 minutes apart
   and R-12 allows fifteen" is a fact about his rule; what it MEANT is his to
   say, and the prohibitions are untouched.

   Eight rules and not one more. §7's Evaluable column decides the set, and the
   eleven marked `judgment` stay out — an approximation of one would be worse
   than the gap, because a judgment rule that starts reporting `pass` is exactly
   the "no violations" claim §8 warns is close to saying nothing.
   ───────────────────────────────────────────────────────────────────────── */
const CHECK_TOOL = {
  name: "check_rules",
  description:
    "Check his journal against the eight rules a row can actually answer — R-01, " +
    "R-02, R-10, R-11, R-12, R-13, R-15 and R-16 — over the last N days. Returns a " +
    "verdict per rule with the counts behind it and the rows that failed. Use it " +
    "whenever he asks how he has been following his rules, or before saying " +
    "anything about his discipline: this is computed from the rows, so it is not " +
    "something to reproduce by reading trades yourself. A verdict of unknown means " +
    "the data cannot decide it and is NEVER the same as a pass. The other eleven " +
    "rules are judgment or field rules and nothing stored can check them — say so " +
    "rather than implying the eight are the whole strategy.",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "integer", description: "How many days back to check, 1 to 365." },
    },
    required: ["days"],
    additionalProperties: false,
  },
} as const;

/* NEVER THROWS, for the reason every other tool here does not — it runs inside
   the loop and an exception costs the answer being written. The read is the one
   get_trades already makes through the same view; the evaluation is pure. */
async function checkAdherence(days: unknown): Promise<string> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${tradesQuery(days)}`, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows: TradeRow[] = await res.json();
    if (!rows.length) return "No trades in that window, so there is nothing to check.";
    return adherenceList(checkRules(rows));
  } catch (err) {
    console.error("doji-eugenia: rule check failed —", err instanceof Error ? err.message : err);
    return "His journal could not be read just now, so the rules were not checked. Say you could not check rather than saying nothing was broken.";
  }
}

/* ─── What lands today ─────────────────────────────────────────────────────
   She has searched for the day's calendar every morning, read it once and
   thrown it away — which cost two different things. A print at 08:30 is
   knowable at 08:00, so the quarter-hour after it could have been a look at
   what actually happened rather than a fixed 10:00 pulse whose usual answer is
   silence. And `actual` against `consensus` with her own line beside it is a
   series that is worth nothing today and a great deal in June.

   ONE TOOL WRITES BOTH HALVES, because they are the same row at two moments:
   the briefing files what is coming, the release look fills in what it printed.
   Upserted on (at, name) so the second write updates rather than duplicates.
   ───────────────────────────────────────────────────────────────────────── */
const CALENDAR_MAX = 12;

const CALENDAR_TOOL = {
  name: "log_calendar",
  description:
    "Record what is scheduled today and what it printed. Call it in the briefing " +
    "with everything on the day's calendar — the time in UTC, the name, the " +
    "consensus and the prior — and call it again once a number has landed to fill " +
    "in the actual and one line on what it meant. Recording a release with " +
    "importance 'high' is also what wakes you to look at it after it lands, so a " +
    "print worth reacting to must be filed as high. Filing the same time and name " +
    "twice updates the row rather than adding one.",
  input_schema: {
    type: "object",
    properties: {
      releases: {
        type: "array",
        description: `Up to ${CALENDAR_MAX} entries.`,
        items: {
          type: "object",
          properties: {
            at:         { type: "string", description: "When it lands, ISO 8601 in UTC, e.g. 2026-09-03T12:30:00Z." },
            name:       { type: "string", description: "What it is, as a person would say it — 'core CPI', 'nonfarm payrolls'." },
            importance: { type: "string", enum: ["high", "medium", "low"],
                          description: "high is a number that can move gold on its own." },
            consensus:  { type: "string", description: "What is expected, with its unit. Optional." },
            prior:      { type: "string", description: "Last time's figure, with its unit. Optional." },
            actual:     { type: "string", description: "What it printed, once it has. Optional." },
            note:       { type: "string", description: `One line on what it meant, once it has landed. Optional, at most ${NOTE_MAX} characters.` },
          },
          required: ["at", "name", "importance"],
          additionalProperties: false,
        },
      },
    },
    required: ["releases"],
    additionalProperties: false,
  },
} as const;

/* A BOUNDARY, so everything below coerces rather than trusts: the array arrives
   from the model. A row whose `at` will not parse is dropped rather than
   written — an unparseable timestamp in this table is a look that fires at the
   wrong moment or never, and both are worse than the row's absence. */
async function logCalendar(releases: unknown): Promise<string> {
  const list = Array.isArray(releases) ? releases.slice(0, CALENDAR_MAX) : [];
  if (!list.length) return "Nothing to record.";

  const rows = list.map((r: any) => {
    const at = new Date(String(r?.at ?? ""));
    if (isNaN(+at) || !String(r?.name ?? "").trim()) return null;
    const importance = ['high', 'medium', 'low'].includes(String(r?.importance)) ? String(r.importance) : 'high';
    const text = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s ? s.slice(0, NOTE_MAX) : null;
    };
    return {
      at: at.toISOString(), name: String(r.name).trim().slice(0, NOTE_MAX), importance,
      consensus: text(r?.consensus), prior: text(r?.prior),
      actual: text(r?.actual), note: text(r?.note), source: 'briefing',
    };
  }).filter(Boolean);

  if (!rows.length) return "None of those had a readable time, so nothing was recorded.";

  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_calendar?on_conflict=at,name`, {
      method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `Recorded ${rows.length}.`;
  } catch (err) {
    console.error("doji-eugenia: calendar not written —", err instanceof Error ? err.message : err);
    return "That did not save. Carry on and do not mention it.";
  }
}

/* ─── The price, read off the instrument ───────────────────────────────────
   She has quoted gold out of whatever a news page said, at whatever staleness
   that page had, since she existed. The broker this system already polls serves
   a live bid and ask, and now she can read it.

   THROUGH THE POLLER, NOT THROUGH THE BROKER, and that is the whole design.
   `doji-mcp-sync` holds CTRADER_MCP_TOKEN, and the same endpoint that serves a
   price also serves `create_order`, `close_position` and `amend_position`.
   Giving Eugenia that token would put a market order one prompt injection away
   from the bot whose entire product is that she gives no signals — so she gets
   a JSON price from a function that will only ever answer with one, and the
   token stays where it was.

   The cron secret is what she presents, which she already holds because her own
   scheduled half checks it. Against the poller it opens exactly what the README
   says it opens: a read-only poll that was going to run anyway.
   ───────────────────────────────────────────────────────────────────────── */
// SB_URL is already the project's own origin, so the poller is one path away
// and needs no second copy of the project ref — which agree.test.mjs counts.
const MARKET_URL = `${SB_URL}/functions/v1/doji-mcp-sync?market=1`;

const MARKET_TOOL = {
  name: "get_market",
  description:
    "The live gold price from his own broker — bid, ask, the session high and low, " +
    "the previous session's close, and the move since it. Use it whenever you are " +
    "about to state where gold is or what it has done overnight, which is every " +
    "briefing. This is read off the instrument, so prefer it over any number a " +
    "search or a page gives you; those are as stale as the page was. It says " +
    "nothing about what price will do next and is not to be used as though it did.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
} as const;

/* The fields of that answer this file actually reads. The poller folds pipettes
   out of the quote and settles the scale before it is served, so everything
   here is a display price — see the poller, where that asymmetry is named. */
export interface Quote {
  bid: number; ask: number; high: number; low: number;
  prev_close: number; change: number; change_pct: number; at: string;
}

/* THE NUMBERS, AND NULL WHERE THERE ARE NONE. Two callers want two different
   things from one read: the tool below wants a sentence it can hand the model,
   and the price sense wants the figures — so the fetch is here once and each
   caller says what an unreadable price means to it. A price that cannot be read
   is not a price of zero, and neither caller may be given one. */
async function marketQuote(): Promise<Quote | null> {
  try {
    const res = await fetch(MARKET_URL, { headers: { "x-doji-key": CRON_SECRET } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const quote = await res.json();
    if (!quote?.ok || typeof quote.bid !== 'number') throw new Error("no readable quote");
    return quote as Quote;
  } catch (err) {
    console.error("doji-eugenia: market read failed —", err instanceof Error ? err.message : err);
    return null;
  }
}

/* NEVER THROWS, for the reason every other tool here does not. And it says what
   it could not do rather than coming back empty: a briefing that opens on a
   silently missing price is one that either invents a number or drops the line
   the whole first paragraph is built on. */
async function readMarket(): Promise<string> {
  const quote = await marketQuote();
  return quote ? JSON.stringify(quote)
    : "The live price could not be read just now. Say you do not have a current level rather than quoting one from a search.";
}

/* ─── The running story ────────────────────────────────────────────────────
   Her memory had two timescales and needed three. Turns roll over in a morning;
   notes are durable facts about HIM. Nothing held what is going on in the
   MARKET across weeks, so every briefing rebuilt the story out of a web search
   and continuity survived only as long as yesterday stayed inside twelve turns.

   THE NIGHTLY PASS WRITES IT AND NOTHING ELSE DOES. A thesis is a reading
   across days, which is the same argument that keeps set_channel out of
   CHAT_TOOLS: rewriting it mid-conversation would let one exchange redirect the
   week's story, and the pass is the only caller that sees a whole day.
   ───────────────────────────────────────────────────────────────────────── */
export const THESIS_MAX = 600;

const THESIS_TOOL = {
  name: "set_thesis",
  description:
    "Rewrite the running story — the one thing the market has been trading and " +
    "what has been happening to it. At the nightly pass and nowhere else. It is " +
    "handed back to you with every briefing, so it is what stops each morning " +
    "starting from nothing. MOVE it rather than replacing it: most nights it " +
    "should read as the same story one day further on, and a thesis that changes " +
    "completely every night is not a thesis. Two or three sentences at most.",
  input_schema: {
    type: "object",
    properties: {
      thesis: { type: "string", description: `The story as it now stands, at most ${THESIS_MAX} characters.` },
    },
    required: ["thesis"],
    additionalProperties: false,
  },
} as const;

async function setThesis(thesis: unknown): Promise<string> {
  const text = String(thesis ?? "").trim().slice(0, THESIS_MAX);
  if (!text) return "Nothing to write.";
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_thesis?id=eq.current`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({ thesis: text, moved_on: nyDate(new Date()), updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // A PATCH matching nothing is a 200 with an empty array, exactly as
    // setChannel's is: the row is seeded by 005, so an empty answer means the
    // migration has not been applied and every rewrite is being dropped.
    if ((await res.json()).length === 0) {
      return "There is no thesis row — 005 has not been applied, so nothing was saved. Say nothing about this to him.";
    }
    return "Thesis updated.";
  } catch (err) {
    console.error("doji-eugenia: thesis not written —", err instanceof Error ? err.message : err);
    return "That did not save. Carry on and do not mention it.";
  }
}

/* ─── What she flagged, and what she asked ─────────────────────────────────
   Every briefing flags one odd thing and asks one question, and both were
   fire-and-forget. The prompt asks her to follow through with nothing to follow
   through WITH — whether Tuesday's oddity resolved depended on whether Tuesday
   was still inside twelve turns, and his answer to a question arriving three
   hours later had nothing joining it back to what was asked.

   OPENED ANYWHERE, CLOSED ONLY AT THE PASS. Opening is a moment and is fairly
   done in one; closing is a judgment that it actually resolved, which is the
   same distinction that put note-writing and rung-moving where they are.
   ───────────────────────────────────────────────────────────────────────── */
export const LOOP_KINDS = ['watch', 'question'] as const;

const LOOP_TOOL = {
  name: "open_loop",
  description:
    "Keep one open thread. kind='watch' for something odd you flagged that has not " +
    "resolved — a reaction that went the wrong way, a number that does not fit. " +
    "kind='question' for a question you put to him and have not had an answer to. " +
    "Both come back to you every briefing until they close, which is what lets you " +
    "say how something landed rather than never mentioning it again. Open at most " +
    "one of each in a briefing, and only for something you would actually want " +
    "back — this is not a diary.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: LOOP_KINDS,
              description: "'watch' for something you flagged; 'question' for something you asked him." },
      body: { type: "string", description: `The thread, in one sentence, at most ${NOTE_MAX} characters.` },
    },
    required: ["kind", "body"],
    additionalProperties: false,
  },
} as const;

const CLOSE_TOOL = {
  name: "close_loop",
  description:
    "Close one open thread, at the nightly pass and nowhere else. Every open thread " +
    "comes to you with a number in brackets. Close it when it actually resolved — " +
    "the odd thing explained itself, or he answered the question — and say in one " +
    "line what the answer turned out to be. A thread that is merely OLD stays open: " +
    "closing it because you are tired of seeing it is how the follow-through this " +
    "exists for stops happening.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "integer", description: "The bracketed number beside the thread." },
      resolution: { type: "string", description: `What it turned out to be, at most ${NOTE_MAX} characters.` },
    },
    required: ["id", "resolution"],
    additionalProperties: false,
  },
} as const;

async function openLoop(kind: unknown, body: unknown): Promise<string> {
  const text = String(body ?? "").trim().slice(0, NOTE_MAX);
  if (!text) return "Nothing to keep.";
  const k = (LOOP_KINDS as readonly string[]).includes(String(kind)) ? String(kind) : 'watch';
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_loops`, {
      method: "POST", headers: sbHeaders("return=minimal"),
      body: JSON.stringify([{ kind: k, body: text, opened_on: nyDate(new Date()) }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "Kept open.";
  } catch (err) {
    console.error("doji-eugenia: loop not opened —", err instanceof Error ? err.message : err);
    return "That did not save. Carry on and do not mention it.";
  }
}

async function closeLoop(id: unknown, resolution: unknown): Promise<string> {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return "That is not a thread number.";
  try {
    // `closed_on=is.null` in the filter, so closing an already-closed thread
    // matches nothing and is reported rather than passing as done — the same
    // shape as writeNote's retirement, and for the same reason.
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_loops?id=eq.${n}&closed_on=is.null`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({
        closed_on: nyDate(new Date()),
        resolution: String(resolution ?? "").trim().slice(0, NOTE_MAX) || null,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if ((await res.json()).length === 0) {
      return `Thread ${n} is not open — it may already be closed. Check the list you were given.`;
    }
    return "Closed.";
  } catch (err) {
    console.error("doji-eugenia: loop not closed —", err instanceof Error ? err.message : err);
    return "That did not save. Carry on and do not mention it.";
  }
}

/* ─── Claude ───────────────────────────────────────────────────────────────
   Raw fetch rather than the SDK, to match every other outbound call in this
   repo — the poller speaks JSON-RPC to cTrader and REST to PostgREST the same
   way, and one function importing an npm client would be the only one.

   web_search is what makes a briefing possible at all: without it the model has
   no access to today's calendar, and a briefing invented from training data is
   worse than none. It bills separately at $10 per 1,000 searches.
   ───────────────────────────────────────────────────────────────────────── */
// `content` is a string for everything stored and replayed, and an array of
// blocks only for the turn being asked right now — a chart he just sent. What
// goes into eugenia_turns is always the string, which is what keeps the history
// replayable and stops a megabyte of base64 becoming permanent memory.
interface Turn { role: 'user' | 'assistant'; content: string | any[] }

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
   keeping; it has no question to research. Sending it the full set would let a
   nightly bookkeeping pass run a dozen web searches, which is money for nothing
   and a slower job that can fail in more ways.

   SEARCH IS THE EXCEPTION, AND IT IS NOT A LOOSENING. The instruction this
   prompt leans hardest on is PREFER SUPERSEDING TO ADDING — and a pass that can
   only see the twenty notes it was handed cannot tell a new observation from
   one it wrote in June. It was being asked to avoid duplicating an archive it
   had no way to look at. One database read, no web, and the tool it reaches for
   is the same one every other caller has.

   Both sets are served by the same loop below — a tool set is a list of what
   may be offered, never of what can be executed. */
/* WEB FETCH BESIDE WEB SEARCH, AND IT IS THE GROUNDING HALF.

   Search returns somebody's prose about a number. Fetch returns the page the
   number is on — so "where gold is, in one line" stops being a figure lifted
   from whatever staleness a news article had and becomes one she read. It only
   ever fetches a URL already in the conversation, which is why the sources are
   named in the prompt rather than left to her to invent.

   Six uses against search's twelve: fetching is the precise half and is reached
   for deliberately, where searching is how she finds what to be precise about.

   Both are server-side and neither arrives at the dispatch below. Both must
   stay non-strict, and neither may sit beside a declared code_execution tool —
   the 2026-02-09 variants run their own container for dynamic filtering, and a
   second execution environment is what confuses the model about which one it
   is in. */
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 12 };
const WEB_FETCH  = { type: "web_fetch_20260209",  name: "web_fetch",  max_uses: 6 };

/* FIVE SETS, BECAUSE FIVE JOBS ARE NOT THE SAME CONVERSATION, and a tool set is
   a list of what may be OFFERED rather than of what can be executed — every one
   of them is served by the same loop below.

   The rule each set follows is the one CONSOLIDATE_TOOLS was written on: never
   send a schema for something this job has no business doing. It is money on
   every request, it is attention spent on an option that should not be taken,
   and it is a way for a job to do something nobody expected it to. The nightly
   pass gets no web search because a bookkeeping pass has nothing to research;
   the release look gets no memory tools because it is a look at one number, not
   a conversation; the trade look gets neither, because the only honest thing it
   can say comes out of his own strategy. */
const CHAT_TOOLS = [
  WEB_SEARCH,
  WEB_FETCH,
  MARKET_TOOL,
  TRADES_TOOL,
  CHECK_TOOL,
  NOTES_TOOL,
  SEARCH_TOOL,
  STRATEGY_TOOL,
  CALENDAR_TOOL,
  LOOP_TOOL,
];
const CONSOLIDATE_TOOLS = [NOTES_TOOL, CHANNEL_TOOL, SEARCH_TOOL, THESIS_TOOL, CLOSE_TOOL, CHECK_TOOL];
const RELEASE_TOOLS = [WEB_SEARCH, WEB_FETCH, MARKET_TOOL, CALENDAR_TOOL, LOOP_TOOL];
const TRADE_TOOLS = [STRATEGY_TOOL, TRADES_TOOL];
// The critic reads a draft and returns a draft. Giving it a tool would let it
// go and check something, which is a second briefing at a second price.
const CRITIC_TOOLS: unknown[] = [];

/* NAMED, BECAUSE TWO THINGS NOW READ IT. The request asks for this model and
   ask() compares what answered against it. A second literal would report a
   fallback on every call from the day someone edited one of the two. */
const MODEL = "claude-opus-5";

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
      model: MODEL,
      max_tokens: 16000,
      /* Cached: both are long, fixed, and sent on every turn — which is exactly
         why the strategy rides here rather than in the message.

         AN HOUR, STATED, BECAUSE THE DEFAULT IS FIVE MINUTES AND HER CALLERS
         ARE HOURS APART. What the cache actually buys is worth saying plainly
         rather than assuming: the rounds WITHIN one turn, always — a briefing
         that reads the journal and writes a note is three requests carrying
         this prefix — and across turns only inside the window. Five minutes
         caught almost nothing across turns; an hour catches the morning's
         replies after a briefing, and the 09:00 retry after an 08:00 failure.
         It does not catch 08:00 → 10:00, and nothing sensible would.

         Not a beta: `ttl` is a plain field on cache_control. The meter is the
         log line at the bottom of ask() — `cached` is the number that says
         whether any of this is true, and it is the reason it is printed. */
      system: [{ type: "text", text: SYSTEM + ALWAYS,
                 cache_control: { type: "ephemeral", ttl: "1h" } }],
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

/* ONE PLACE A TOOL NAME BECOMES WORK, and it is a switch rather than a chain of
   ifs because there are ten of them now and a reader should be able to
   enumerate what she can do by looking at one list.

   NOTHING HERE THROWS, which is the rule every handler below already follows
   individually and which this restates as a property of the whole surface: it
   runs inside the loop, and an exception costs the answer she is in the middle
   of writing rather than the tool she was in the middle of calling.

   AN UNKNOWN NAME IS ANSWERED, NOT DROPPED. Every tool_use block must come back
   with a tool_result or the next request is a 400 — so a name no set serves
   gets a sentence saying so, which is also the only way that mistake would ever
   become visible rather than presenting as a turn that died. */
async function serve(name: string, input: any): Promise<string> {
  switch (name) {
    case TRADES_TOOL.name:   return await readTrades(input.days);
    case CHECK_TOOL.name:    return await checkAdherence(input.days);
    case NOTES_TOOL.name:    return await writeNote(input.note, input.kind, input.supersedes);
    case SEARCH_TOOL.name:   return await searchMemory(input.query);
    case STRATEGY_TOOL.name: return readStrategy(input.section);
    case CHANNEL_TOOL.name:  return await setChannel(input.channel, input.state, input.evidence);
    case MARKET_TOOL.name:   return await readMarket();
    case CALENDAR_TOOL.name: return await logCalendar(input.releases);
    case THESIS_TOOL.name:   return await setThesis(input.thesis);
    case LOOP_TOOL.name:     return await openLoop(input.kind, input.body);
    case CLOSE_TOOL.name:    return await closeLoop(input.id, input.resolution);
    default:
      console.error(`doji-eugenia: no handler for tool "${name}"`);
      return `There is no tool called "${name}" here. Answer without it and do not mention this.`;
  }
}

/* `label` names the caller in the log line below and does nothing else. The
   four jobs are not distinguishable from effort alone — the briefing and the
   nightly pass both run high — and a cost line that cannot say which of them
   spent the money is a cost line nobody can act on.

   Exported so a test can drive the loop itself against a stubbed `fetch`.
   Asserting on a comparison in isolation would prove the arithmetic and not
   that the line is ever printed, which is the half that has been wrong here
   before. */
export async function ask(messages: Turn[], effort: Effort, label: string,
                          tools: unknown[] = CHAT_TOOLS): Promise<string> {
  const convo: any[] = withClock(messages);
  // Carried forward once seen, and never cleared: the container outlives the
  // round that opened it, and a later request that drops it fails the same way
  // the missing one did.
  let container: string | undefined;
  // Summed across the rounds rather than logged per round, because the unit
  // worth knowing is what one briefing cost, not what one leg of it did.
  let inTok = 0, outTok = 0, cached = 0, searches = 0;
  /* EMPTY UNLESS `fallbacks` ACTUALLY FIRED, which is the whole reason to keep
     it. A decline re-runs the request on another model inside the same call and
     that is what rescues the briefing — but it also means the briefing he read
     was written by a model nothing in this system named, and it reads exactly
     like one that was not — so it is counted here, where the tokens and the
     searches already are, for the reason they are.

     Kept once set: a turn where one leg fell back is worth knowing about
     whatever the remaining rounds came back on. */
  let fellBack = "";
  // Both exist for the row written on the way out, and `rounds` is separate
  // from the loop variable because the catch below is outside its scope — a
  // turn that died in round three should say three.
  const started = Date.now();
  let rounds = 0;

  try {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    rounds = round + 1;
    const body = await call(convo, effort, tools, container);
    container = body.container?.id ?? container;

    const used = body.usage ?? {};
    inTok    += used.input_tokens ?? 0;
    outTok   += used.output_tokens ?? 0;
    cached   += used.cache_read_input_tokens ?? 0;
    searches += used.server_tool_use?.web_search_requests ?? 0;
    if (body.model && body.model !== MODEL) fellBack = body.model;
    // Still checked, and it still happens: `fallbacks` rescues a model that
    // declines, and this is the case where the whole chain did. No usable
    // content, so it is caught before the blocks are read rather than surfacing
    // as an empty message.
    if (body.stop_reason === "refusal") {
      throw new Error(`Claude declined: ${body.stop_details?.category ?? "unknown"}`);
    }

    if (body.stop_reason === "tool_use") {
      convo.push({ role: "assistant", content: body.content });

      /* ALL RESULTS IN ONE USER MESSAGE, AND ALL OF THEM RUN AT ONCE.

         The single message was always right — splitting them teaches the model
         to stop asking for tools in parallel. But the work behind it was a for
         loop with an await inside, so a round that asked for the journal, the
         rules and a memory search served them one after another and paid the
         sum of three round trips to answer a batch the model had deliberately
         parallelised. Collected and awaited together, a round costs its slowest
         tool rather than all of them.

         Ordering is preserved by mapping rather than pushing: tool_result
         blocks are matched by tool_use_id, but a stable order keeps the
         transcript readable and the tests deterministic. */
      const calls = (body.content ?? []).filter((b: any) => b.type === "tool_use");
      const results = await Promise.all(calls.map(async (b: any) => ({
        type: "tool_result", tool_use_id: b.id, content: await serve(b.name, b.input ?? {}),
      })));

      // EVERY CALL GETS A RESULT, INCLUDING ONE THIS FUNCTION DOES NOT SERVE —
      // serve() answers an unknown name with a sentence rather than nothing.
      // A user message missing the tool_result for a tool_use block is a 400,
      // so dropping the odd one out would turn a name we mistyped into a dead
      // turn. web_search and web_fetch run on Anthropic's side and never arrive
      // here at all.
      if (!results.length) throw new Error("tool_use with no tool call in it");
      convo.push({ role: "user", content: results });
      continue;
    }

    const text = (body.content ?? [])
      .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (!text) throw new Error("Claude returned no text");
    /* WHAT ANY OF THIS COSTS, IN THE TWO PLACES IT CAN BE READ.

       The console line is unchanged and still the fastest way to see one turn
       while looking at it. The row is the same figures somewhere they survive:
       this repository's own account of pg_net says plainly that nobody reads
       Edge logs, which is exactly why a failed briefing messages Telegram — and
       every cost and quality meter in this file was still writing there and
       nowhere else. "Is the briefing drifting long again", "what did last month
       cost", "how often does fallbacks actually fire" were questions whose
       answers were being collected and then discarded within hours.

       Searches are counted apart from the tokens because they bill apart.
       Only on the way out; the catch below records the turns that never got
       here, which are the ones a cost line could never see at all. */
    console.log(`doji-eugenia: ${label} — ${round + 1} round(s), ${effort} effort, ` +
                `${inTok} in (${cached} cached), ${outTok} out, ${searches} search(es)` +
                (fellBack ? `, FELL BACK TO ${fellBack}` : ""));
    await recordRun({
      caller: label, effort, rounds: round + 1, in_tokens: inTok, cached,
      out_tokens: outTok, searches, fell_back: fellBack || null,
      ms: Date.now() - started, ok: true,
    });
    return text;
  }
  throw new Error(`tool loop did not settle in ${MAX_ROUNDS} rounds`);
  } catch (err) {
    /* A FAILED TURN IS A ROW TOO, and it is the row that was never there.
       A briefing that dies costs the same searches and the same tokens as one
       that lands, and until now the only trace was a Telegram apology — a
       message, not data, so "how often does this actually fail" had no answer.
       Recorded and rethrown: the caller's own handling is unchanged. */
    await recordRun({
      caller: label, effort, rounds: rounds || null, in_tokens: inTok, cached,
      out_tokens: outTok, searches, fell_back: fellBack || null,
      ms: Date.now() - started, ok: false,
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    });
    throw err;
  }
}

/* NEVER THROWS AND NEVER BLOCKS THE ANSWER, which is what separates a meter
   from a dependency. Recording is the least important thing happening in any
   turn: a briefing that was written, paid for and delivered must not be lost
   because an instrumentation insert failed, and it must not be lost because the
   005 migration has not been applied yet either.

   Written by ask() alone. Nothing reads it back into her context — this is for
   him and for whoever is debugging, which is why it carries no note and no
   opinion, only figures. */
async function recordRun(row: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_runs`, {
      method: "POST", headers: sbHeaders("return=minimal"), body: JSON.stringify([row]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("doji-eugenia: run not recorded —", err instanceof Error ? err.message : err);
  }
}

/* ─── Telegram and history ─────────────────────────────────────────────── */

// Her token, bound once. Every call below is unchanged by the binding.
const tg = (method: string, body: unknown) => telegram(BOT_TOKEN, method, body);

// One message per chunk, in order. Sequential rather than parallel: Telegram
// does not promise ordering, and a briefing whose section 5 arrives before
// section 2 is unreadable.
// A KEYBOARD RIDES ON THE LAST PART AND ONLY THE LAST, which is what makes it a
// keyboard under the briefing rather than one under each of its pieces. Optional,
// so every existing caller is unchanged by its existence.
async function say(text: string, keyboard?: unknown) {
  const parts = chunk(text);
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    const sent = await tg("sendMessage", {
      chat_id: CHAT_ID, text: part,
      ...(last && keyboard ? { reply_markup: keyboard } : {}),
    });
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

/* EVERY CALLER REACHES THIS AFTER say(), which is what makes the embedding free
   in the only sense that matters: he has the message before this runs. Both
   turns go in one vendor call and one INSERT — and the pair still has to be one
   INSERT for the reason openOnUser exists, since a concurrent write taking a
   sequence value between them is what leaves the window opening on an assistant
   turn. */
async function remember(turns: Turn[]) {
  const vecs = await embed(turns.map(t => String(t.content)));
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_turns`, {
    method: "POST", headers: sbHeaders("return=minimal"),
    body: JSON.stringify(vecs ? turns.map((t, i) => ({ ...t, embedding: vecs[i] })) : turns),
  });
  if (!res.ok) throw new Error(`History write failed (HTTP ${res.status})`);
}

/* ─── What the vendor missed ───────────────────────────────────────────────
   A null embedding is every row written before 007 ran, plus any row whose
   vendor call failed. Both are invisible from the outside: the row is there,
   the search still answers, and it simply never returns that row from its
   semantic arm.

   ONE PATCH PER ROW, WHICH IS DELIBERATE RATHER THAN LAZY. An upsert would be
   one request, and PostgREST would send rows carrying only `id` and
   `embedding`: `content not null` is checked when the tuple is built, before
   any conflict is detected, so the whole batch would be refused. The expensive
   half is the vendor call and that is one request for the batch either way.

   RESUMABLE, AND IT SAYS HOW MUCH IS LEFT. `count=exact` is what turns this
   from a call you repeat hopefully into one you repeat until it answers zero.
   ───────────────────────────────────────────────────────────────────────── */
async function fillEmbeddings(table: string, column: string): Promise<{ filled: number; left: number }> {
  const res = await fetch(
    `${SB_URL}/rest/v1/${table}?select=id,${column}&embedding=is.null&order=id.asc&limit=${EMBED_BATCH}`,
    { headers: sbHeaders("count=exact") });
  if (!res.ok) throw new Error(`${table} read failed (HTTP ${res.status})`);

  const rows = await res.json() as Record<string, any>[];
  const left = Number(res.headers.get('content-range')?.split('/')[1] ?? rows.length);
  if (!rows.length) return { filled: 0, left: 0 };

  const vecs = await embed(rows.map(r => String(r[column])));
  // No key, or the vendor refused the batch. Nothing is written and nothing is
  // lost — the same rows are still waiting the next time this runs.
  if (!vecs) return { filled: 0, left };

  let filled = 0;
  for (const [i, row] of rows.entries()) {
    const done = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${row.id}`, {
      method: "PATCH", headers: sbHeaders("return=minimal"),
      body: JSON.stringify({ embedding: vecs[i] }),
    });
    if (!done.ok) throw new Error(`${table} embedding write failed (HTTP ${done.status})`);
    filled++;
  }
  return { filled, left: left - filled };
}

async function postEmbed(): Promise<Response> {
  // One after the other rather than together: each is fifty single-row PATCHes,
  // and there is nothing to be gained by having a hundred of them in flight.
  const notes = await fillEmbeddings('eugenia_notes', 'note');
  const turns = await fillEmbeddings('eugenia_turns', 'content');
  return json({ ok: true, notes, turns });
}

/* ─── And she answers in the channel he used ───────────────────────────────
   NO SETTING, NO TOGGLE, NO STORED PREFERENCE. He speaks because his hands are
   busy — driving, at a screen, mid-session — and the whole point is over the
   moment he has to look at a phone to read the answer. So the rule is the
   message he sent: a voice note is answered aloud, a typed line is answered in
   text, and nothing anywhere has to remember which he prefers.

   IT FALLS OUT THAT NOTHING SCHEDULED EVER SPEAKS. The briefing, the pulse, the
   release look, the move look and the trade event are not replies to anything —
   they reach this file by another path entirely — so they stay text without a
   rule saying so. That is the right answer for the briefing in particular: a
   fourteen-hundred-character read is something you skim, and audio is the one
   format you cannot.

   THE TEXT GOES FIRST AND IS NEVER CONTINGENT ON THE VOICE. It is what
   remember() stores, what a later search finds, and what he re-reads at a desk;
   a voice note is none of those. So it is already delivered before this is
   attempted, which is what makes a failure here cost nothing but the audio.
   ───────────────────────────────────────────────────────────────────────── */
const TTS_URL   = env("TTS_URL") || "https://api.openai.com/v1/audio/speech";
const TTS_KEY   = env("TTS_KEY");
// Both from the environment, unlike EMBED_MODEL. Nothing is stored, so a change
// here alters one message rather than what is comparable to what — and which
// voice she has is his to change without a deploy.
const TTS_MODEL = env("TTS_MODEL") || "tts-1";
const TTS_VOICE = env("TTS_VOICE") || "nova";

/* Roughly fifty seconds of speech. Past that a voice note stops being a reply
   and becomes a recording to scrub through, and the text — already sent — is
   the better artifact for anything that long. The prompt is told the number so
   a long answer is one she chose rather than one silently left unspoken. */
export const SPEAK_MAX = 700;

// Exported because it is the decision, and because it is the one thing here a
// test can drive: everything below it is a vendor and a wire.
export const speaksBack = (answer: string, heard: boolean): boolean =>
  heard && answer.length > 0 && answer.length <= SPEAK_MAX;

/* NEVER THROWS AND NEVER MESSAGES HIM. Unset key, a vendor that refused, a
   format Telegram would not render — every one of them leaves him with the
   answer he already has and no audio, which is a degraded reply rather than a
   missing one. That is the opposite call from VOICE_TROUBLE, and the difference
   is that a voice note she cannot hear costs the whole exchange while a reply
   she cannot speak costs the convenience.

   Its own fetch rather than the shared telegram() helper, for tgDownload's
   reason: sendVoice is multipart and that helper posts JSON. And OGG/Opus
   specifically — Telegram renders those as a voice note, with a waveform and
   playback speed, and anything else as a file attachment. */
async function speak(answer: string): Promise<void> {
  if (!TTS_KEY) return;

  try {
    const spoken = await fetch(TTS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${TTS_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TTS_MODEL, voice: TTS_VOICE, input: answer, response_format: "opus",
      }),
    });
    if (!spoken.ok) throw new Error(`speech HTTP ${spoken.status}`);

    const form = new FormData();
    form.append("chat_id", CHAT_ID);
    // Type and filename both, the same reasoning transcribe() gives for the
    // other direction: it is not knowable which one Telegram reads.
    form.append("voice", new Blob([new Uint8Array(await spoken.arrayBuffer())],
                                  { type: "audio/ogg" }), "reply.ogg");
    const sent = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVoice`, {
      method: "POST", body: form,
    });
    const said = await sent.json();
    if (!said?.ok) throw new Error(`sendVoice: ${said?.description ?? "unknown"}`);
  } catch (err) {
    console.error("doji-eugenia: could not speak —", err instanceof Error ? err.message : err);
  }
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
/* A TURN IS SOMETIMES BLOCKS RATHER THAN A SENTENCE, and the clock has to reach
   both. He can send a chart now, which arrives as an image block beside his
   text — and string concatenation against an array produces "[object Object]"
   attached to nothing, which would put the one line telling her what day it is
   somewhere she cannot read it, silently, on exactly the turns that carry the
   most context.

   Exported and separate because it is the decision. Appended as a trailing text
   block so it stays the last thing in the message either way. */
export function stamped(content: string | any[], now: Date): string | any[] {
  return typeof content === 'string'
    ? content + nowBlock(now)
    : [...content, { type: 'text', text: nowBlock(now) }];
}

export function withClock(messages: Turn[], now = new Date()): Turn[] {
  const last = messages.length - 1;
  if (last < 0 || messages[last].role !== 'user') return messages;
  return messages.map((m, i) =>
    i === last ? { ...m, content: stamped(m.content, now) } : m);
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
    const list = (ns: Note[]) => `\n· ` + ns.map(noteLine).join("\n· ");
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

type Channel = { channel: string; state: string; evidence: string | null; moved_on: string | null };

/* THE SAME ROWS, RENDERED FOR HIM RATHER THAN FOR HER, and the only window he
   has into any of it.

   Her memory is the one part of this system he can write to and could not read.
   Notes are the only channel he has for correcting her, a fact is recorded
   SILENTLY by design, and the acknowledgement for an instruction is four words
   that scroll away — so the evidence that anything stuck lasts about a morning.
   A wrong note then fails in the worst available way: a fact saying he
   understands something he does not makes her STOP explaining it, and the
   symptom is an absence, which is the hardest thing there is to notice.

   Pure, so a test can read the formatting; the read stays with the caller. The
   ids are the point rather than decoration — they are how she is told which
   note to retire, and now how he is.

   THE MAP IS PART OF THIS MESSAGE RATHER THAN APPENDED TO IT, and it has to be.
   The `/notes` reply used to end with channelsBlock() — which is written for HER
   context and opens `Where he stands on each channel`, so the one message
   addressed to him switched into the third person about him halfway through.
   Rendering the whole audit here fixes that and makes it one pure function
   instead of a him-facing half glued to a her-facing half.

   It also means a failed channels read now costs the whole `/notes` reply
   rather than being swallowed. That is the right direction here and the
   opposite of the rule the blocks follow: this is an AUDIT, answered from the
   database precisely so nothing can quietly drop a row, and an audit that
   silently omits half of what it audits is the defect it exists to prevent. */
export function notesList(told: Note[], noticed: Note[], channels: Channel[],
                          loops: Loop[] = [], story: Thesis | null = null): string {
  const list = (ns: Note[]) => ns.map(noteLine).join("\n");
  /* RENDERED FOR HIM RATHER THAN REUSING loopsList, which is the same reason
     the channel map is rendered here rather than by appending channelsBlock():
     that one opens "What you flagged" and is written to HER about her own
     threads. Sent to him unchanged it would be the audit addressed to him
     switching into her voice halfway through. */
    const open = (kind: string, heading: string) => {
      const rs = loops.filter(l => l.kind === kind);
      return rs.length
        ? `${heading}\n${rs.map(l => `[${l.id}] ${l.body} (since ${civilDay(l.opened_on)})`).join("\n")}`
        : "";
    };
  return [
    told.length    ? `What you have told me, newest first:\n${list(told)}`  : "",
    noticed.length ? `What I have noticed, newest first:\n${list(noticed)}` : "",
    told.length || noticed.length ? "" : "I have not kept any notes yet, jefe.",
    open('watch',    "What I flagged and am still watching:"),
    open('question', "What I asked you and have not had back:"),
    story ? `The story I am carrying${story.moved_on ? `, last moved ${civilDay(story.moved_on)}` : ""}:\n${story.thesis}` : "",
    `Where you stand on each channel:\n${channelsList(channels)}`,
  ].filter(Boolean).join("\n\n");
}

/* A CIVIL DAY FORMATTED AS ONE, which shortDay cannot do. `moved_on` is already
   a New York date written by setChannel, so re-zoning it moves it: new Date
   ('2026-03-12') is midnight UTC, which is the 11th in New York, and every rung
   would read a day early. Formatted in UTC off a midday anchor, the date that
   was stored is the date that is shown. */
const civilDay = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short',
}).format(new Date(`${iso}T12:00:00Z`));

/* RENDERED IN THE ORDER prompt.ts DECLARES THEM, not in whatever order the
   database returns — the list she reads should be the list she was taught, and
   a stable order is also what stops a rung looking like it moved when it did
   not. A channel with no row is shown at the bottom rung rather than dropped:
   the point of this block is that an absence is visible, so a missing row must
   not be the one thing it hides. Pure, so a test can read the shape.

   AND EVERY RUNG CARRIES THE DAY IT LAST MOVED, which is what stops the map
   going blind. The ladder only ever climbs — deliberately, since failing to
   reach for a mechanism once is not the same as having lost it — so over a year
   every channel he has ever used converges on `owns`, and a census with nothing
   left at `unseen` has no absence left to show. That is the whole thing it is
   for. `moved_on` was written by setChannel from the first day and read by
   nobody: a rung set in March looked exactly like one set last night, which is
   the difference between a channel he owns and a channel that has gone quiet.
   Rendering it is the entire fix, and it costs one clause. */
export function channelsList(rows: Channel[]): string {
  const byId = new Map(rows.map(r => [r.channel, r]));
  return CHANNELS.map(([id, name]) => {
    const row = byId.get(id);
    const state = row?.state ?? CHANNEL_STATES[0];
    const since = row?.moved_on ? ` since ${civilDay(row.moved_on)}` : "";
    return `· ${name} — ${state}${since}${row?.evidence ? ` (${row.evidence})` : ""}`;
  }).join("\n");
}

/* THE READ, SEPARATE FROM EITHER RENDERING, because there are two of them now
   and they are addressed to different people — `channelsBlock` below speaks to
   her about him, `notesList` speaks to him about himself, and neither is the
   place for a query. */
async function readChannels(): Promise<Channel[]> {
  const res = await fetch(
    // Bounded by the list that defines it rather than by a literal: the table
    // cannot hold a sixth row — the primary key sits on a five-value check —
    // so this is the one read here whose limit can never bite. It is written
    // anyway, because every read of her tables carrying one is the invariant,
    // and the read that was allowed to be the exception was the one that got
    // missed.
    `${SB_URL}/rest/v1/eugenia_channels?select=channel,state,evidence,moved_on` +
    `&limit=${CHANNELS.length}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Channels read failed (HTTP ${res.status})`);
  return await res.json();
}

/* Optional the same way notesBlock is: a database blip costs her the map, not
   the briefing. */
async function channelsBlock(): Promise<string> {
  try {
    return `\n\nWhere he stands on each channel:\n${channelsList(await readChannels())}`;
  } catch (err) {
    console.error("doji-eugenia: channels unavailable —",
      err instanceof Error ? err.message : err);
    return "";
  }
}

// Seven days, handed over unasked, so "you have not traded since Tuesday" costs
// no tool round. Same read as get_trades through the same read-only view — she
// gains no reach here, only the saved trip.
async function tradesBlock(): Promise<string> {
  return `\n\nHis trades this past week:\n${await readTrades(7)}`;
}

/* ─── The running story, the open threads, and the day's calendar ──────────
   Three reads and three renderings, and they are together because they are one
   idea: a briefing that starts from nothing writes a briefing that could have
   been written on any morning, which the prompt calls a failure and had no
   means to avoid.

   Optional, all three, exactly as notesBlock and channelsBlock are: a database
   blip costs her the context, never the briefing. Logged, because a bot that
   has quietly stopped carrying its own story reads exactly like one that never
   had one.
   ───────────────────────────────────────────────────────────────────────── */
type Thesis = { thesis: string; moved_on: string | null };

async function readThesis(): Promise<Thesis | null> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_thesis?select=thesis,moved_on&id=eq.current&limit=1`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Thesis read failed (HTTP ${res.status})`);
  const [row] = await res.json();
  return row ?? null;
}

/* THE DATE IS THE HALF THAT MAKES IT USABLE, for the reason `moved_on` is on a
   channel: a thesis written three weeks ago and never moved is not the same
   claim as one written last night, and without the date the two read
   identically. Formatted off a midday anchor in UTC, because `moved_on` is a
   stored New York civil day and re-zoning it moves it back a day. */
export function thesisLine(row: Thesis | null): string {
  if (!row) return "";
  const since = row.moved_on ? ` (last moved ${civilDay(row.moved_on)})` : "";
  return `\n\nThe story you have been carrying${since}:\n${row.thesis}`;
}

async function thesisBlock(): Promise<string> {
  try {
    return thesisLine(await readThesis());
  } catch (err) {
    console.error("doji-eugenia: thesis unavailable —", err instanceof Error ? err.message : err);
    return "";
  }
}

type Loop = { id: number; kind: string; body: string; opened_on: string };

// Twenty of each kind would be a backlog rather than a set of open threads. Ten
// is more than a fortnight of one-a-briefing, and a list longer than that is
// itself the finding — she has stopped closing them.
const LOOPS = 10;

async function readLoops(): Promise<Loop[]> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_loops?select=id,kind,body,opened_on` +
    `&closed_on=is.null&order=id.desc&limit=${LOOPS}`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Loops read failed (HTTP ${res.status})`);
  return await res.json();
}

/* Pure, so a test can read the shape, and the id is carried for the reason a
   note's is: a thread she cannot name is a thread she cannot close. The two
   kinds are labelled separately because they close on different evidence — a
   watch resolves in the world, a question resolves in him. */
export function loopsList(rows: Loop[]): string {
  if (!rows.length) return "";
  const of = (kind: string) => rows.filter(r => r.kind === kind);
  const list = (rs: Loop[]) => rs.map(r => `· [${r.id}] ${r.body} (opened ${civilDay(r.opened_on)})`).join("\n");
  const watch = of('watch'), asked = of('question');
  return (watch.length ? `\n\nWhat you flagged and has not resolved:\n${list(watch)}` : "")
       + (asked.length ? `\n\nWhat you asked him and he has not answered:\n${list(asked)}` : "");
}

async function loopsBlock(): Promise<string> {
  try {
    return loopsList(await readLoops());
  } catch (err) {
    console.error("doji-eugenia: loops unavailable —", err instanceof Error ? err.message : err);
    return "";
  }
}

type Release = {
  id: number; at: string; name: string; importance: string;
  consensus: string | null; prior: string | null; actual: string | null; note: string | null;
};

/* A ROLLING WINDOW RATHER THAN A CIVIL DAY, and it is the simpler correct
   answer as well as the cheaper one. What a briefing wants is "what just landed
   and what is coming", which straddles midnight in exactly the way a civil-day
   filter handles worst — the Sunday 17:00 briefing is about a week that has not
   started yet. Twelve hours back and a day forward covers both without any
   boundary arithmetic to get wrong. */
const CAL_BACK = 12, CAL_AHEAD = 24;

async function readCalendar(now = Date.now()): Promise<Release[]> {
  const from = new Date(now - CAL_BACK * 3600_000).toISOString();
  const to   = new Date(now + CAL_AHEAD * 3600_000).toISOString();
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_calendar?select=id,at,name,importance,consensus,prior,actual,note` +
    `&at=gte.${from}&at=lte.${to}&order=at.asc&limit=40`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Calendar read failed (HTTP ${res.status})`);
  return await res.json();
}

// Times in ET because that is the clock the prompt asks her to speak in, and
// the one every scheduled thing in this system is kept in.
const nyTime = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

/* A LANDED RELEASE READS DIFFERENTLY FROM A PENDING ONE, and rendering them the
   same way is how a briefing comes to describe a print that has already
   happened as something to watch for. `actual` present is the whole test. */
export function calendarList(rows: Release[]): string {
  if (!rows.length) return "";
  const lines = rows.map(r => {
    const head = `· ${nyTime(r.at)} ET ${r.name}`;
    if (r.actual) {
      return `${head} — LANDED at ${r.actual}` +
             (r.consensus ? ` against ${r.consensus} expected` : "") +
             (r.note ? `. ${r.note}` : "");
    }
    return `${head} — due` +
           (r.consensus ? `, ${r.consensus} expected` : "") +
           (r.prior ? ` after ${r.prior}` : "");
  });
  return `\n\nThe calendar around now, as you filed it:\n${lines.join("\n")}`;
}

async function calendarBlock(): Promise<string> {
  try {
    return calendarList(await readCalendar());
  } catch (err) {
    console.error("doji-eugenia: calendar unavailable —", err instanceof Error ? err.message : err);
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
/* WHAT THE APOLOGY IS ABOUT, and it used to be a lie four times out of five.

   Every scheduled failure said "No briefing, jefe" — including a pulse, the
   nightly pass, a release look and a trade event. So a consolidation that died
   at 22:00 reported itself to him as a missing briefing, sending him to look
   for the wrong thing at the wrong time of day; and the failure whose actual
   symptom is that her memory stops growing was described as the one whose
   symptom is a message that never arrived.

   A map rather than a ternary chain, for the reason SAID is one: these are
   words paired with the job names above them, and a reader should be able to
   enumerate them. */
export const APOLOGY: Record<string, string> = {
  briefing:     "No briefing, jefe — something broke on my side.",
  pulse:        "My second look at the morning broke, jefe. Nothing is wrong with the briefing.",
  consolidate:  "My nightly tidy-up broke, jefe. I may not have kept what today was worth keeping.",
  release:      "I could not look at the number that just landed, jefe.",
  trade:        "Something broke while I was looking at your position, jefe.",
  move:         "I lost sight of the price for a moment, jefe.",
  embed:        "I could not file what I remember for searching, jefe.",
};

export const apologyFor = (job: string) => APOLOGY[job] ?? APOLOGY.briefing;

async function postScheduled(url: URL): Promise<Response> {
  // Named before the work so the catch can say which job died. Defaulted to the
  // briefing because that is what an unlabelled failure most likely is, and
  // because the old message is the right one for it.
  let job = 'briefing';
  try {
    if (url.searchParams.get("pulse") === "1")       { job = 'pulse';       return await postPulse(); }
    if (url.searchParams.get("consolidate") === "1") { job = 'consolidate'; return await postConsolidation(); }
    /* THE TWO DATA-DRIVEN SENSES, EACH BEHIND ITS OWN DOOR. Their cron jobs
       call nothing else, which is also how either is exercised by hand without
       waiting for a print or a move. They are deliberately not folded into
       dueNow: it decides from the clock, and these decide from a table. */
    if (url.searchParams.get("release") === "1")     { job = 'release';     return await postRelease(); }
    if (url.searchParams.get("move") === "1")        { job = 'move';        return await postMove(); }

    /* THE BACKFILL, AND NO CRON JOB CALLS IT. The archive is filled in by hand
       — call it until it answers `left: 0` — and the trickle a failed vendor
       call leaves behind is swept by the nightly pass, which already runs and
       already sees the day. A schedule of its own would be a job doing nothing
       every hour for the one night a year it had something to do. */
    if (url.searchParams.get("embed") === "1")       { job = 'embed';       return await postEmbed(); }

    const now = new Date();
    if (url.searchParams.get("force") === "1") {
      return await postBriefing(briefDue(now) ?? 'weekday');
    }

    // Which hours turn on this is dueNow's rule and is stated there once; a
    // caller deciding when to bother asking would be the same rule again. Both
    // reads are one row each and neither depends on the other, so they go
    // together rather than one after the other.
    const [briefed, consolidated] = await Promise.all([briefedToday(), consolidatedToday()]);
    const due = dueNow(now, briefed, consolidated);
    if (due === 'pulse')       { job = 'pulse';       return await postPulse(); }
    if (due === 'consolidate') { job = 'consolidate'; return await postConsolidation(); }
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
      text: `${apologyFor(job)}\n\n${why.slice(0, 600)}`,
    }).catch(() => {});
    return json({ ok: false, error: why, job }, 500);
  }
}

/* What postBriefing stores instead of the text it sent. One definition, because
   a retry that could not spot yesterday's shape would send a second briefing
   every morning. */
export const briefingMarker = (due: Brief) => `[${due} briefing]`;

/* THE MARKER IS FOUND BY THE DATABASE, NOT BY SCANNING A WINDOW OF TURNS.

   Reading the last thirty user turns and looking for it among them is right on
   a quiet morning and wrong on a busy one: thirty messages between 08:00 and
   09:00 push the marker out of that window, the retry concludes no briefing was
   sent, and generates and sends a second one — a dozen searches at high effort
   and a duplicate he did not ask for. Filtering on the marker itself is exact
   whatever was said around it, and returns one row rather than thirty.

   Exported because it is the decision, the same reason tradesQuery is. */
export function briefedQuery(): string {
  const markers = [briefingMarker('weekday'), briefingMarker('sunday')]
    .map(m => `"${encodeURIComponent(m)}"`).join(',');
  return `eugenia_turns?select=created_at&role=eq.user&content=in.(${markers})` +
         `&order=id.desc&limit=1`;
}

/* Whether a briefing has already landed today, read off the marker
   postBriefing stores in place of the sent text. It is written just BEFORE the
   send, so it exists whenever a briefing was generated — which is the question
   worth asking here, because the expensive half is the generation and a retry
   that duplicates it is the failure this guards.

   The day comparison is done HERE, in New York, rather than as a timestamp
   filter in the query. A `created_at=gte.<date>T00:00:00-05:00` would be an
   hour wrong for half the year, which is the same mistake briefDue and
   marketOpen exist to avoid; asking Intl for the civil day of the row is
   correct in both halves.

   A read failure counts as "yes, already briefed": if the database is unwell
   the retry cannot check, and sending a second briefing on a guess is worse
   than skipping one. */
async function briefedToday(): Promise<boolean> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${briefedQuery()}`, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const [latest] = await res.json();
    return !!latest && nyDate(new Date(latest.created_at)) === nyDate(new Date());
  } catch (err) {
    console.error("doji-eugenia: could not check for today's briefing —",
      err instanceof Error ? err.message : err);
    return true;
  }
}


/* THE BRIEFING READS ITS OWN HISTORY, which it did not until now — it wrote to
   eugenia_turns and never read back, so every morning started from nothing and
   she could not know what she had said the day before, whether it landed, or
   that she had already explained a term twice this week. Continuity is most of
   what separates a person from a feed.

   The stored user turn is a marker, not the sent text: the notes and the week's
   trades are rebuilt fresh every morning, and storing them would resend a stale
   copy as history for the next six briefings. */
/* ─── The feedback keyboard ────────────────────────────────────────────────
   An instruction note is the only correction channel he has, and it is a good
   one — but it fires only when something annoys him enough to type. On every
   ordinary morning there is no signal at all, so the nightly pass judges her
   own output with no evidence about how any of it landed.

   Two taps is the cheapest real evidence there is, and the mechanism is already
   proven in this system: Gladys has drawn an inline keyboard and answered its
   taps since she shipped. `callback_data` stays far under the 64-byte cap for
   the same reason hers does — it is the entire state a tap carries.

   IT IS NOT A SCORE AND MUST NOT BECOME ONE. The pass reads it as one input
   beside the day's turns; a bot optimising an average would start writing
   briefings that flatter rather than teach, which is the failure the
   prohibitions exist to prevent.
   ───────────────────────────────────────────────────────────────────────── */
export const feedbackKeyboard = (day: string) => ({
  inline_keyboard: [[
    { text: "Useful", callback_data: `fb|good|${day}` },
    { text: "Off",    callback_data: `fb|off|${day}` },
  ]],
});

/* ─── The second read of the day's one expensive artifact ──────────────────
   The briefing is researched and written in a single generation, and its
   quality target lives in prose on the far side of a model call where no test
   can hold it. That is not a theory about what might go wrong: unmeasured, the
   briefing grew by a sixth and the way it surfaced was somebody counting the
   characters by hand.

   So it is read once more before it is sent, against the rules it was written
   to — the length, the first sentence being true only today, a term redefined
   after it was already explained, a chain missing a link. One extra round at
   medium effort on one artifact a day.

   IT CANNOT MAKE THINGS WORSE, AND THAT IS ENFORCED RATHER THAN TRUSTED. A
   critic that returns nothing, returns an apology, or returns something twice
   the length has failed, and the draft it was given is better than whatever it
   did — so the draft goes out. Same direction as the pulse's `isSilent`: the
   failure that costs a message is worse than the failure that sends the
   original one. */
const CRITIC_FLOOR = 400;

export function keepDraft(draft: string, revised: string): boolean {
  const t = revised.trim();
  return t.length < CRITIC_FLOOR || t.length > draft.length * 2;
}

async function critique(draft: string): Promise<string> {
  try {
    const revised = await ask([{ role: 'user', content: `${CRITIC}\n\n${draft}` }],
                              'medium', 'critic', CRITIC_TOOLS);
    if (keepDraft(draft, revised)) {
      console.log(`doji-eugenia: critic rejected — kept the draft (${draft.length} vs ${revised.trim().length})`);
      return draft;
    }
    return revised.trim();
  } catch (err) {
    // A critic that fails must never cost the briefing it was checking.
    console.error("doji-eugenia: critic failed —", err instanceof Error ? err.message : err);
    return draft;
  }
}

async function postBriefing(due: Brief): Promise<Response> {
  const opened = Date.now();
  /* THE SIX READS RUN AT ONCE. They are independent, they are all small, and
     run one after another they were six round trips before the first token of a
     briefing was asked for. Promise.all is the same argument the tool dispatch
     now makes: a batch should cost its slowest member. */
  const [notes, channels, trades, story, loops, calendar] = await Promise.all([
    notesBlock(), channelsBlock(), tradesBlock(), thesisBlock(), loopsBlock(), calendarBlock(),
  ]);

  const asked = (due === 'sunday'
    ? "Today's briefing, please. It is Sunday evening and the gold week is about to open."
    : "Today's briefing, please.")
    + notes + channels + trades + story + loops + calendar;

  const draft = await ask([...await recent(), { role: 'user', content: asked }],
                          'high', `${due} briefing`);
  const brief = await critique(draft);

  /* THE LENGTH IS LOGGED BECAUSE NOTHING ELSE CAN SEE IT. The prompt asks for
     nine hundred to fourteen hundred characters and no test can hold it there —
     the figure lives in prose, on the far side of a model call. Unmeasured, the
     briefing grew by a sixth and the way it surfaced was someone counting the
     characters by hand. */
  console.log(`doji-eugenia: ${due} briefing — ${brief.length} characters`);

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
  await say(`${greeting(due)}\n\n${brief}`, feedbackKeyboard(nyDate(new Date())));

  /* A THIRD ROW, AND IT IS THE ARTIFACT RATHER THAN A CALL. ask() has already
     written one row for the draft and one for the critic — what each of them
     cost, which is the question a bill asks. This one says what he actually
     received and how long the whole thing took, which is the question a reader
     asks. Keeping them apart is what makes "the critic is costing more than it
     is worth" and "the briefing is drifting long again" two separate answerable
     questions rather than one blurred figure. */
  await recordRun({
    caller: `${due} briefing delivered`, chars: brief.length,
    ms: Date.now() - opened, ok: true,
  });
  return json({ ok: true, brief: due, chars: brief.length });
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

/* THE LIMIT HAS TO TAKE THE NEWEST, and it was taking the oldest.

   `order=id.asc&limit=200` reads the FIRST two hundred turns of the window, so
   the one day the bound bites is the day the pass distils the morning and drops
   the evening — which is where a late instruction lives, and the only thing in
   a day that must not be lost. Every other bounded read in this file selects
   newest-first and reverses, which is also what recent() does; this was the one
   that did not, and the bound looked identical from the outside either way.

   Exported because it is the decision, the same reason tradesQuery and
   briefedQuery are. */
export function dayQuery(hours: number, now = Date.now()): string {
  const from = new Date(now - hours * 3600_000).toISOString();
  return `eugenia_turns?select=role,content,created_at` +
         `&created_at=gte.${from}&order=id.desc&limit=${CONSOLIDATE_TURNS}`;
}

async function turnsSince(hours: number): Promise<Turn[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${dayQuery(hours)}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Day read failed (HTTP ${res.status})`);
  // Reversed back into the order it is read in: the pass is handed the day
  // oldest first, and only the SELECT needed to run the other way round.
  return dateTurns((await res.json()).reverse());
}

/* WHETHER TONIGHT'S PASS HAS ALREADY RUN, read off eugenia_runs rather than off
   a marker turn — because the pass deliberately stores no turn, and giving it
   one would spend two of tomorrow's twelve on bookkeeping it wrote to itself.
   The meter that had to exist anyway turns out to be the exact record the retry
   needs, which is why the retry could not sensibly have come first.

   A read failure counts as "already run", the same way briefedToday's does and
   for the same reason: if the database is unwell the retry cannot check, and
   running a second pass on a guess is worse than skipping one. A skipped pass
   loses that day's distillation and never the day. */
async function consolidatedToday(): Promise<boolean> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/eugenia_runs?select=at&caller=eq.consolidation&ok=is.true` +
      `&order=id.desc&limit=1`, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const [latest] = await res.json();
    return !!latest && nyDate(new Date(latest.at)) === nyDate(new Date());
  } catch (err) {
    console.error("doji-eugenia: could not check for tonight's pass —",
      err instanceof Error ? err.message : err);
    return true;
  }
}

/* What he made of the briefings, which until now nothing could say. Two days,
   because the pass runs nightly and a tap can arrive late; more than that and
   she would be reading last week's verdict into tonight's decision. */
async function feedbackBlock(): Promise<string> {
  try {
    const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const res = await fetch(
      `${SB_URL}/rest/v1/eugenia_feedback?select=on_day,verdict&on_day=gte.${from}` +
      `&order=on_day.desc&limit=5`, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows: { on_day: string; verdict: string }[] = await res.json();
    if (!rows.length) return "";
    const said = rows.map(r => `· ${civilDay(r.on_day)}: he marked it ${r.verdict === 'good' ? 'useful' : 'off'}`);
    return `\n\nWhat he made of the recent briefings:\n${said.join("\n")}\n` +
           `Read this as one signal beside the day, never as a score to raise.`;
  } catch (err) {
    console.error("doji-eugenia: feedback unavailable —", err instanceof Error ? err.message : err);
    return "";
  }
}

async function postConsolidation(): Promise<Response> {
  const day = await turnsSince(CONSOLIDATE_HOURS);
  // A day nobody spoke on has nothing to distil, and a call that says so costs
  // a model round to be told what an empty array already said. Recorded all the
  // same: a quiet day is a pass that ran and decided nothing, and without the
  // row the 23:00 retry would run it again to reach the same conclusion.
  if (!day.length) {
    await recordRun({ caller: 'consolidation', ok: true, detail: 'nothing said' });
    return json({ ok: true, skipped: "nothing said" });
  }

  /* THE WEEK GOES IN TOO, and without it the pass was asked to notice something
     it could not see. What earns a note includes "he has started doing
     something differently" — a claim about his trading, judged against a
     transcript that on most days does not mention a trade at all. It is the
     same read the briefing already makes through the same read-only view, so
     this buys the evidence for that instruction and no new reach. */
  const [notes, channels, trades, story, loops, calendar, verdicts] = await Promise.all([
    notesBlock(), channelsBlock(), tradesBlock(),
    thesisBlock(), loopsBlock(), calendarBlock(), feedbackBlock(),
  ]);

  const asked = CONSOLIDATE + notes + channels + trades + story + loops + calendar + verdicts +
    `\n\nThe day, oldest first:\n\n` +
    day.map(t => `${t.role === 'user' ? 'him' : 'you'}: ${t.content}`).join("\n\n");

  // `high`, and it is the one place that is not a latency decision: this writes
  // the memory every later briefing reasons from, and a careless note outlives
  // a careless briefing by months.
  const said = await ask([{ role: 'user', content: asked }], 'high', 'consolidation',
                         CONSOLIDATE_TOOLS);
  console.log("doji-eugenia: consolidated —", said.slice(0, 200));
  await logChannels();

  /* AND THE SWEEP, WHICH IS BOOKKEEPING RATHER THAN PART OF THE PASS. It runs
     here because this job already runs nightly and already reads the day, so it
     needs no schedule of its own — and it runs AFTER, wrapped, because a vendor
     that is down must not report itself to him as a pass that failed. The rows
     it misses are still waiting tomorrow. */
  try {
    const notes = await fillEmbeddings('eugenia_notes', 'note');
    const turns = await fillEmbeddings('eugenia_turns', 'content');
    console.log("doji-eugenia: embeddings swept —", JSON.stringify({ notes, turns }));
  } catch (err) {
    console.error("doji-eugenia: embedding sweep failed —",
                  err instanceof Error ? err.message : err);
  }

  return json({ ok: true, consolidated: day.length });
}

/* THE ONE CLAIM IN THIS SYSTEM THAT HAD NO METER.

   Everything else that cannot be seen is counted where it happens and for that
   exact reason: ask() logs tokens and searches because the spend cap is a
   ceiling and not a meter, and postBriefing logs the character count because
   the length target lives in prose past a model call — unmeasured, it grew by a
   sixth and somebody found out by counting by hand.

   What she is FOR is that his understanding grows, and the map is the designed
   instrument for it. Nothing ever read that instrument back. A ladder that has
   stopped moving looks exactly like one that never had to, and the nightly pass
   is the only thing that can move a rung — so this is the line that says
   whether it does, printed at the one moment a rung could just have changed.

   Never throws: the pass has done its work by the time this runs, and a log
   line must not turn a good night into a 500. */
async function logChannels() {
  try {
    const rungs = channelsList(await readChannels())
      .split('\n').map(l => l.replace(/^· /, '')).join(' · ');
    console.log(`doji-eugenia: channels — ${rungs}`);
  } catch (err) {
    console.error("doji-eugenia: channels unavailable —",
      err instanceof Error ? err.message : err);
  }
}

async function postPulse(): Promise<Response> {
  const [notes, channels, story, loops, calendar] = await Promise.all([
    notesBlock(), channelsBlock(), thesisBlock(), loopsBlock(), calendarBlock(),
  ]);
  const asked = "Pulse, please — anything since the briefing?"
    + notes + channels + story + loops + calendar;
  const said = await ask([...await recent(), { role: 'user', content: asked }],
                         'medium', 'pulse');

  if (isSilent(said)) return json({ ok: true, pulse: "quiet" });

  await say(said);
  await remember([{ role: 'user', content: '[pulse]' }, { role: 'assistant', content: said }]);
  return json({ ok: true, pulse: "sent" });
}

/* ─── The look after a number lands ────────────────────────────────────────
   THE FIRST THING IN THIS SYSTEM THAT IS NOT A CLOCK.

   Everything else here fires at an hour someone chose in advance: 08:00, 10:00,
   22:00. A print at 08:30 landed into a briefing that had already gone and
   waited for a 10:00 pulse whose default answer is silence — so the one moment
   of the day when something genuinely happened was the moment she was least
   likely to speak.

   This fires off the calendar SHE FILED. The briefing records what is due; the
   quarter-hourly job asks whether anything high-impact has landed and not yet
   been looked at; and `looked_at` makes the answer once-only. It is data
   deciding when she speaks, which is the whole difference between a scheduled
   feed and something that notices.

   STILL SILENT BY DEFAULT, and that is not timidity — a number landing exactly
   where everyone expected it is not news, and the pulse's own reasoning applies
   unchanged. `isSilent` is shared with it rather than reimplemented.
   ───────────────────────────────────────────────────────────────────────── */
// Older than this and the moment has gone: a print six hours stale is history,
// and history belongs in tomorrow's briefing rather than in a message now. It
// also bounds what a redeploy after a long outage can send — without it, a day
// of unlooked releases would all arrive at once.
const RELEASE_STALE_H = 6;

async function pendingRelease(now = Date.now()): Promise<Release | null> {
  const from = new Date(now - RELEASE_STALE_H * 3600_000).toISOString();
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_calendar?select=id,at,name,importance,consensus,prior,actual,note` +
    `&importance=eq.high&looked_at=is.null` +
    `&at=lte.${new Date(now).toISOString()}&at=gte.${from}` +
    `&order=at.asc&limit=1`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Release read failed (HTTP ${res.status})`);
  const [row] = await res.json();
  return row ?? null;
}

/* MARKED BEFORE THE LOOK, NOT AFTER, and it is the briefing marker's argument
   exactly. Marked after, a look that generates and fails to write leaves the
   release pending — so the next quarter-hour runs it again, and the one after
   that, each one a model call with web search behind it. Marked first, a
   failure costs one look. Losing a look is cheaper than looping on one. */
async function markLooked(id: number): Promise<void> {
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_calendar?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders("return=minimal"),
    body: JSON.stringify({ looked_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Could not mark release ${id} looked at (HTTP ${res.status})`);
}

async function postRelease(): Promise<Response> {
  const due = await pendingRelease();
  if (!due) return json({ ok: true, skipped: "nothing has landed unlooked" });

  await markLooked(due.id);

  const [notes, story, loops] = await Promise.all([notesBlock(), thesisBlock(), loopsBlock()]);
  const asked = RELEASE +
    `\n\nWhat landed: ${nyTime(due.at)} ET ${due.name}` +
    (due.consensus ? `, ${due.consensus} expected` : "") +
    (due.prior ? `, after ${due.prior}` : "") + "." +
    notes + story + loops;

  const said = await ask([...await recent(), { role: 'user', content: asked }],
                         'medium', 'release look', RELEASE_TOOLS);

  if (isSilent(said)) return json({ ok: true, release: due.name, said: "quiet" });

  await say(said);
  // Stored, unlike a quiet one: this is a thing he read, and a follow-up
  // question about it needs the exchange it follows.
  await remember([{ role: 'user', content: `[${due.name} landed]` },
                  { role: 'assistant', content: said }]);
  return json({ ok: true, release: due.name, said: "sent" });
}

/* ─── The trade she hears about in two minutes ─────────────────────────────
   The poller writes a position within two minutes of it opening, and until now
   nothing told her: a trade taken at 10:47 reached her the next morning as one
   row inside a week of JSON, by which time there is nothing useful left to say.

   SHE STILL GIVES NO VERDICT, and the two things she may say are both his own
   rules read back at the moment they apply:

     opened — a high-impact print is pending and he is now in a position. R-14
              is about standing aside before one and R-19 about a position
              inherited into one. Naming the rule is citation; deciding what he
              should do about it is not hers and the prompt forbids it.
     closed — that fill took the day past −4% of account. R-11 says the day ends
              there. It is arithmetic against a threshold he set, and it is the
              one thing that is both time-critical and not a judgment.

   SILENCE COSTS NOTHING AND IS THE COMMON CASE. Both branches decide from data
   BEFORE any model call — no pending print, or no breach, and the function
   returns without spending anything at all. A trade event that always ran a
   model call would be a bill attached to every fill for a message that usually
   should not be sent.
   ───────────────────────────────────────────────────────────────────────── */
// How far ahead a print still counts as pending against a position just opened.
// Beyond this it is tomorrow's problem and the briefing will carry it.
const PENDING_AHEAD_H = 8;

async function aheadToday(now = Date.now()): Promise<Release[]> {
  const to = new Date(now + PENDING_AHEAD_H * 3600_000).toISOString();
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_calendar?select=id,at,name,importance,consensus,prior,actual,note` +
    `&importance=eq.high&at=gt.${new Date(now).toISOString()}&at=lte.${to}` +
    `&order=at.asc&limit=5`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Calendar read failed (HTTP ${res.status})`);
  return await res.json();
}

async function postTradeEvent(id: string, event: string): Promise<Response> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_trades?id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Trade read failed (HTTP ${res.status})`);
  const [row] = await res.json() as TradeRow[];
  // Soft-deleted, or not through the view. Nothing to say and nothing wrong.
  if (!row) return json({ ok: true, skipped: "no such trade" });

  let situation: string;

  if (event === 'opened') {
    const ahead = await aheadToday();
    if (!ahead.length) return json({ ok: true, trade: id, said: "nothing pending" });
    situation =
      `He has just opened a ${row.direction ?? "position"}` +
      (row.entry_price ? ` at ${row.entry_price}` : "") + ".\n" +
      `Still ahead today:\n` +
      ahead.map(r => `· ${nyTime(r.at)} ET ${r.name}` +
                     (r.consensus ? `, ${r.consensus} expected` : "")).join("\n");
  } else {
    // The day as it now stands, computed rather than asked for — and read from
    // the same view get_trades uses, so this gains her no reach.
    const day = row.open_day;
    if (!day) return json({ ok: true, skipped: "no filing day" });
    const all = await fetch(
      `${SB_URL}/rest/v1/eugenia_trades?open_day=eq.${day}&limit=50`,
      { headers: sbHeaders() });
    if (!all.ok) throw new Error(`Day read failed (HTTP ${all.status})`);
    const standing = dayStanding(await all.json() as TradeRow[], day);
    if (!standing || !standing.breached) {
      return json({ ok: true, trade: id, said: "day is inside its limit" });
    }
    situation =
      `That fill closed his day at ${standing.pnl.toFixed(2)} against an account of ` +
      `${standing.account.toFixed(0)} implied by his size — past the ${DAY_LOSS * 100}% ` +
      `R-11 sets. Read R-11 in the strategy before you say anything about it.`;
  }

  const said = await ask([{ role: 'user', content: `${TRADE_EVENT}\n\n${situation}` }],
                         'medium', 'trade look', TRADE_TOOLS);

  if (isSilent(said)) return json({ ok: true, trade: id, said: "quiet" });

  await say(said);
  await remember([{ role: 'user', content: `[trade ${event}]` },
                  { role: 'assistant', content: said }]);
  return json({ ok: true, trade: id, said: "sent" });
}

/* ─── The move nobody filed ────────────────────────────────────────────────
   THE OTHER TWO SENSES ARE EVENTS AND PRICE IS NOT. A release lands and a
   position opens; both are rows appearing, and both are noticed by asking
   whether a row is there. Gold is always there. "It moved" is not a fact about
   the instrument at all — it is a fact about the instrument AND a previous
   reading — which is why this sense needs a mark and the others need none.

   WHAT MAKES A MOVE WORTH WAKING HER FOR IS THE DAY'S OWN MEASURE, not a number
   in dollars. Gold at 4,400 and gold at 2,000 are the same market and a fixed
   $10 threshold means two different things to them; a table of thresholds goes
   stale the year nobody revises it, and that failure looks exactly like a quiet
   market. So the test is relative twice over: against the range the session has
   actually printed, and against the price itself.

   AND A MOVE A PRINT EXPLAINS IS NOT THIS SENSE'S TO REPORT. The release spine
   is already looking at anything high-impact that landed, so a jump at 08:30 on
   payrolls would otherwise reach him twice in the same ten minutes, once from
   each sense, saying the same thing. The calendar she filed is what tells them
   apart.

   SILENT BY DEFAULT AFTER ALL OF THAT, because the gates decide that something
   happened and only she can decide whether it is worth a sentence. `isSilent`
   is shared with the pulse and the release look rather than reimplemented.
   ───────────────────────────────────────────────────────────────────────── */
/* THE FIVE NUMBERS THIS SENSE RESTS ON, and every one of them is a decision
   rather than a fact — which is why they are named here instead of appearing
   inside the predicate, the same reason CLOSEOUT_MIN and STRETCH are named in
   adherence.ts. */
// A third of everything the day has done so far, inside a quarter of an hour.
// The share binds on an established session, where the range is wide enough for
// an ordinary swing to clear any fixed floor.
export const MOVE_SHARE = 0.35;
// And a tenth of a percent of the price — about $4.40 on gold at 4,400. The
// floor binds at the other end of the day: an hour after the Sunday open the
// range is a couple of dollars and a third of it is noise.
export const MOVE_FLOOR = 0.001;
// Two missed runs and the gap is no longer a quarter of an hour. A move measured
// across an outage is a move across an hour, which is a different claim — so the
// mark is advanced and the reading starts again.
export const MARK_STALE_MIN = 40;
// One message about one move. A market that trends all afternoon is one story,
// and telling it every fifteen minutes is the failure a threshold alone cannot
// prevent.
export const MOVE_QUIET_H = 2;
// How recently a high-impact print counts as the explanation. Six hours later a
// move is its own event again; the release spine's own staleness window is wider
// because it is asking a different question — whether the print has been looked
// at, not whether it is what just moved the price.
const MOVE_EXPLAINED_H = 1;

export interface Mark { bid: number; at: string; looked_at: string | null }

/* PURE, AND THE WHOLE DECISION IS HERE. Every gate can be driven from both
   sides by a test, which for a sense that is silent by design is the only way
   to know it can fire at all — a predicate that always answers "not worth it"
   and a market that is genuinely quiet produce the same empty log for weeks. */
export function moveWorth(spot: Quote, mark: Mark, now = Date.now()):
  { worth: true; move: number } | { worth: false; why: string } {
  // The seeded row, and the only shape that is not a price. It exists so the
  // first run has something to PATCH rather than a branch that runs once in the
  // life of the database.
  if (!(mark.bid > 0)) return { worth: false, why: "no mark yet" };

  const age = (now - Date.parse(mark.at)) / 60_000;
  if (!(age <= MARK_STALE_MIN)) return { worth: false, why: "mark is stale" };

  if (mark.looked_at &&
      now - Date.parse(mark.looked_at) < MOVE_QUIET_H * 3600_000) {
    return { worth: false, why: "already said something about a move" };
  }

  const move = Math.round((spot.bid - mark.bid) * 100) / 100;
  const size = Math.abs(move);
  if (size < spot.bid * MOVE_FLOOR) return { worth: false, why: "inside the floor" };

  // high and low fall back to the bid on a quote that carries neither, which
  // makes the range zero — and no size is below zero, so the share simply stops
  // binding and the floor above is the whole test. A guard for that case would
  // read as though it changed the answer.
  const range = spot.high - spot.low;
  if (size < range * MOVE_SHARE) {
    return { worth: false, why: "small against the day's range" };
  }

  return { worth: true, move };
}

async function readMark(): Promise<Mark | null> {
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_price?id=eq.current&select=bid,at,looked_at&limit=1`,
    { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Mark read failed (HTTP ${res.status})`);
  const [row] = await res.json();
  return row ?? null;
}

/* THE MARK ADVANCES ON EVERY RUN AND `looked_at` DOES NOT, which is what makes
   the window between readings the gap between runs rather than a number anyone
   chose. Stamped BEFORE the look for markLooked's reason exactly: a look that
   generates and then fails to write would re-fire on the next run, and on the
   one after that, each one billed. */
async function markPrice(bid: number, looked: boolean): Promise<void> {
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_price?id=eq.current`, {
    method: "PATCH", headers: sbHeaders("return=minimal"),
    body: JSON.stringify({
      bid, at: new Date().toISOString(),
      ...(looked ? { looked_at: new Date().toISOString() } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Mark write failed (HTTP ${res.status})`);
}

// Anything high-impact that printed in the last hour, whether or not the
// release spine has looked at it yet — either way that message is the one he
// gets about this move.
async function explained(now = Date.now()): Promise<Release | null> {
  const from = new Date(now - MOVE_EXPLAINED_H * 3600_000).toISOString();
  const res = await fetch(
    `${SB_URL}/rest/v1/eugenia_calendar?select=id,at,name,importance,consensus,prior,actual,note` +
    `&importance=eq.high&at=gte.${from}&at=lte.${new Date(now).toISOString()}` +
    `&order=at.desc&limit=1`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Calendar read failed (HTTP ${res.status})`);
  const [row] = await res.json();
  return row ?? null;
}

async function postMove(): Promise<Response> {
  // The weekend quote is Friday's last, so every reading is the same number and
  // nothing could fire — but it is still a poll and a broker session every
  // quarter of an hour for two days. The same rule the poller keeps, from the
  // same definition.
  if (!marketOpen()) return json({ ok: true, skipped: "market closed" });

  const [spot, mark] = await Promise.all([marketQuote(), readMark()]);
  if (!spot) return json({ ok: true, skipped: "no readable quote" });
  if (!mark) throw new Error("eugenia_price has no row — 005 has not been applied");

  const worth = moveWorth(spot, mark);
  if (!worth.worth) {
    await markPrice(spot.bid, false);
    return json({ ok: true, bid: spot.bid, skipped: worth.why });
  }

  const behind = await explained();
  if (behind) {
    await markPrice(spot.bid, false);
    return json({ ok: true, bid: spot.bid, skipped: `${behind.name} explains it` });
  }

  await markPrice(spot.bid, true);

  const [notes, story, loops, ahead] = await Promise.all([
    notesBlock(), thesisBlock(), loopsBlock(), aheadToday(),
  ]);
  // The window is STATED FROM THE MARK rather than asserted as a quarter of an
  // hour. A run that fell out and came back reads a thirty-eight-minute gap, and
  // telling her it was fifteen is a wrong fact from the one place that knows.
  const since = Math.round((Date.now() - Date.parse(mark.at)) / 60_000);
  const asked = MOVE +
    `\n\nGold is ${spot.bid}, ${worth.move > 0 ? "up" : "down"} ` +
    `${Math.abs(worth.move)} in the last ${since} minutes. ` +
    `The session has traded ${spot.low} to ${spot.high}, against a previous ` +
    `close of ${spot.prev_close}. Nothing high-impact you filed has printed in ` +
    `the last hour.` +
    (ahead.length
      ? `\nStill ahead today: ` +
        ahead.map(r => `${nyTime(r.at)} ET ${r.name}`).join(", ") + "."
      : "") +
    notes + story + loops;

  const said = await ask([...await recent(), { role: 'user', content: asked }],
                         'medium', 'move look', RELEASE_TOOLS);

  if (isSilent(said)) return json({ ok: true, move: worth.move, said: "quiet" });

  await say(said);
  await remember([{ role: 'user', content: `[gold ${worth.move > 0 ? "up" : "down"} ${Math.abs(worth.move)}]` },
                  { role: 'assistant', content: said }]);
  return json({ ok: true, move: worth.move, said: "sent" });
}


/* ─── What he sends that is not typing ─────────────────────────────────────
   `if (!msg?.text) return` dropped everything that was not typed, and the two
   things it dropped are the two he is most likely to send from a desk mid
   session: a voice note and a chart.

   ONE DOWNLOAD FOR BOTH, because Telegram serves them the same way — getFile
   turns a file_id into a path, and the path is fetched from the file endpoint
   with the bot token in it. The token is in the URL rather than a header there;
   that is Telegram's design, and it is why this does not go through the shared
   `telegram()` helper, which posts JSON to the method endpoint.
   ───────────────────────────────────────────────────────────────────────── */
// Telegram's own ceiling for a bot download is 20MB. This is far lower on
// purpose: an image goes into the request as base64, which is a third larger
// again — so the ceiling that matters is the one on the far side, and a photo
// Telegram has already compressed is nowhere near either. It is also paid for
// as input tokens on every round of the turn it appears in.
const FILE_MAX = 3 * 1024 * 1024;

/* THE FOUR THE API ACCEPTS, checked here rather than discovered as a 400 in the
   middle of a reply. A photo is always JPEG; a DOCUMENT is whatever he attached,
   and "send it as a file to keep the quality" is the ordinary way a chart
   arrives as a PNG — or as a BMP, a HEIC or a TIFF, none of which are readable
   and all of which would otherwise reach the model as an image block. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function tgDownload(fileId: string): Promise<{ bytes: Uint8Array; path: string } | null> {
  const meta = await tg("getFile", { file_id: fileId });
  const path = meta?.result?.file_path;
  if (!meta?.ok || !path) {
    console.error("doji-eugenia: getFile failed —", meta?.description ?? "no file_path");
    return null;
  }
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
  if (!res.ok) {
    console.error(`doji-eugenia: file download failed (HTTP ${res.status})`);
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > FILE_MAX) {
    console.error(`doji-eugenia: file is ${bytes.length} bytes, over the ${FILE_MAX} cap`);
    return null;
  }
  return { bytes, path };
}

/* CHUNKED, BECAUSE THE OBVIOUS ONE-LINER BLOWS THE STACK. `btoa(String
   .fromCharCode(...bytes))` spreads every byte into an argument list, so a
   photo of any real size is a RangeError rather than a string — and it would
   throw on the large images and work on every small one used to test it. */
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

/* ─── Hearing him ──────────────────────────────────────────────────────────
   THE ONE CAPABILITY HERE THAT NEEDS SOMETHING THIS SYSTEM DOES NOT ALREADY
   HAVE, and it is worth saying plainly rather than burying: the Messages API
   takes text and images and not audio, and Telegram does not transcribe for
   bots. So a voice note needs a speech-to-text service, which is a second
   vendor and a second key.

   Written against the /audio/transcriptions shape — a multipart POST answering
   with `{ text }` — because that is the one contract every provider in this
   space implements, so the endpoint is configuration rather than a vendor baked
   into the file.

   UNSET IS A FIRST-CLASS STATE, not a broken one. With no STT_URL she says she
   cannot hear it, which is true, and every other path in this file is
   unaffected — that is why these are not in the 503 check at the entry point
   beside the secrets that genuinely stop her working. */
const STT_URL   = env("STT_URL");
const STT_KEY   = env("STT_KEY");
const STT_MODEL = env("STT_MODEL") || "whisper-1";

/* FOUR REASONS A VOICE NOTE PRODUCES NO WORDS, AND THEY ARE FOUR SENTENCES.

   They were one. `transcribe` returned null for a rejected key, a wrong URL, an
   unsupported format and genuinely unclear audio alike, so every one of them
   reached him as "I could not make that out — send it again", and he would send
   it again, and again. A misconfigured key is not something he can fix by
   speaking more clearly, and telling him it is wastes his time on the only
   failure here he is actually able to act on.

   It is the same rule `readTrades` is written on, one layer up: an empty answer
   is only an answer when something was read. Each line below says whose problem
   it is and what to do about it, which is the whole difference. A map rather
   than a chain of ternaries, for the reason APOLOGY and SAID are. */
export const VOICE_TROUBLE: Record<string, string> = {
  unconfigured: "I cannot hear voice notes yet, jefe — type it and I will answer.",
  download:     "That voice note would not come through, jefe. Send it again?",
  failed:       "My transcription is not answering, jefe — that is broken on my side, not something you said. Type it and I will answer.",
  empty:        "I could not make out any words in that one, jefe. Send it again, or type it?",
};

// The reason, or the words. A string is what she heard; anything else names
// which of the four above he is about to be told.
type Heard = { said: string } | { trouble: keyof typeof VOICE_TROUBLE & string };

async function transcribe(bytes: Uint8Array, name: string, mime: string): Promise<Heard> {
  if (!STT_URL || !STT_KEY) return { trouble: 'unconfigured' };
  try {
    const form = new FormData();
    /* THE TYPE COMES FROM TELEGRAM RATHER THAN BEING LEFT OFF. It hands over
       `audio/ogg` for a voice note and we were discarding it — and providers
       differ in whether they read the format off the part's content type or off
       the filename, so giving both is what makes this portable across the ones
       that speak this shape. The extension is Telegram's own (`.oga` for a
       voice note, whatever the file was for an audio one) rather than a
       constant, since `msg.audio` is not always ogg. */
    form.append("file", new Blob([bytes], { type: mime }), name);
    form.append("model", STT_MODEL);
    const res = await fetch(STT_URL, {
      method: "POST", headers: { Authorization: `Bearer ${STT_KEY}` }, body: form,
    });
    // The body on a failure, truncated: a 400 from one of these services names
    // the actual complaint — an unsupported extension, a model that does not
    // exist — and the status alone would send someone looking at the key.
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const said = String((await res.json())?.text ?? "").trim();
    return said ? { said } : { trouble: 'empty' };
  } catch (err) {
    console.error("doji-eugenia: transcription failed —", err instanceof Error ? err.message : err);
    return { trouble: 'failed' };
  }
}

/* ─── The tap under a briefing ─────────────────────────────────────────────
   Answered from here rather than by the model, exactly as /notes is: it is a
   fact being recorded, and a model call to store one word would be a full turn
   with the whole memory attached for something a PATCH does.

   answerCallbackQuery is not optional — Telegram spins the button until it
   arrives, and a tap that never gets one reads as a bot that hung.
   ───────────────────────────────────────────────────────────────────────── */
export function parseFeedback(data: string): { verdict: string; day: string } | null {
  const [tag, verdict, day] = String(data ?? "").split('|');
  if (tag !== 'fb' || !['good', 'off'].includes(verdict)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) return null;
  return { verdict, day };
}

async function handleFeedback(query: any): Promise<void> {
  const ack = (text: string) =>
    tg("answerCallbackQuery", { callback_query_id: query?.id, text }).catch(() => {});

  const tap = parseFeedback(query?.data);
  if (!tap) { await ack("I did not follow that."); return; }
  if (String(query?.message?.chat?.id) !== CHAT_ID) {
    console.error("doji-eugenia: callback from unexpected chat");
    return;
  }

  try {
    // ONE VERDICT PER DAY, LAST TAP WINS. He may change his mind, and two
    // contradictory rows for one briefing is a number nobody can read.
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_feedback?on_conflict=on_day`, {
      method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify([{ on_day: tap.day, verdict: tap.verdict }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await ack(tap.verdict === 'good' ? "Noted, gracias." : "Noted — I will look at that tonight.");
  } catch (err) {
    console.error("doji-eugenia: feedback not written —", err instanceof Error ? err.message : err);
    await ack("That did not save, jefe.");
  }
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
    // Joins, stickers, and anything carrying nothing she can read. Dropped.
    if (!msg) return;
    if (String(msg.chat?.id) !== CHAT_ID) {
      console.error("doji-eugenia: message from unexpected chat");
      return;
    }

    /* WHAT HE ACTUALLY SENT, resolved before anything else looks at it.

       This used to be `if (!msg.text) return`, which silently dropped the two
       things a trader at a desk is most likely to send: a voice note, because
       talking is what people do when their hands are busy, and a chart, because
       he trades charts. Both were invisible failures — no reply, no log, no
       sign to him that anything had arrived.

       `text` is what gets stored and what the slash commands read. `blocks` is
       the image, which exists only for the turn being asked. */
    let text: string = typeof msg.text === 'string' ? msg.text : "";
    const blocks: any[] = [];

    const voice = msg.voice ?? msg.audio;
    // Remembered rather than re-derived at the bottom: `text` is rewritten by
    // the transcription, so by the time the answer exists there is nothing left
    // in it that says how it arrived.
    const heard = Boolean(voice?.file_id);
    if (voice?.file_id) {
      // The download and the transcription both take seconds, so the indicator
      // starts here rather than after — otherwise the wait for a voice note is
      // the one that looks most like nothing happening.
      await tg("sendChatAction", { chat_id: CHAT_ID, action: "typing" }).catch(() => {});
      const file = await tgDownload(voice.file_id);
      const heard: Heard = file
        ? await transcribe(file.bytes, file.path.split('/').pop() ?? "voice.oga",
                           String(voice.mime_type ?? "audio/ogg"))
        : { trouble: 'download' };

      if ('trouble' in heard) { await say(VOICE_TROUBLE[heard.trouble]); return; }
      // Kept as his words with a marker, so a later search for what he said
      // finds it and the transcript is never passed off as something typed.
      text = `[voice note] ${heard.said}`;
    }

    /* A CHART, AND THE LINE IT MAY NOT CROSS IS IN THE PROMPT RATHER THAN HERE.
       She can describe what is on it and take it as context for the journal;
       she cannot say whether a setup is valid, which would be a verdict on a
       trade he has not taken yet and is the one prohibition an image makes
       tempting to break. Largest size last, which is Telegram's ordering. */
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
    // A photo is always JPEG; a document carries whatever he attached, and only
    // the four the API reads are worth downloading.
    const docType = String(msg.document?.mime_type ?? "");
    const asImage = photo ?? (IMAGE_TYPES.includes(docType) ? msg.document : null);
    if (asImage?.file_id) {
      await tg("sendChatAction", { chat_id: CHAT_ID, action: "typing" }).catch(() => {});
      const file = await tgDownload(asImage.file_id);
      if (!file) {
        await say("That picture would not come through, jefe. Try sending it smaller?");
        return;
      }
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: photo ? "image/jpeg" : docType,
          data: base64(file.bytes),
        },
      });
      text = String(msg.caption ?? "").trim() || "Have a look at this chart.";
    }
    // An attachment that is neither readable audio nor a readable image. Said
    // rather than dropped: a silent non-answer is what this whole branch exists
    // to stop, and "I cannot open that" is a complete reply.
    if (!blocks.length && !text && msg.document) {
      await say(`I cannot open ${docType || 'that kind of file'}, jefe. A screenshot works.`);
      return;
    }

    if (!text) return;
    /* ANSWERED FROM THE DATABASE, NEVER BY THE MODEL, and that is the whole
       value of it. This is an audit of what she is keeping, so it has to show
       the rows themselves — asked to list her own notes she could paraphrase
       one, drop one, or produce a plausible line that is not in the table, and
       an audit that can do that audits nothing. It also costs no model call. */
    if (text.trim().toLowerCase() === '/notes') {
      try {
        // The map goes out with them: it is the half of her memory he has never
        // been able to see at all, and the half that says what she is missing.
        // Read here and rendered by notesList, so the whole audit is one
        // message written to him rather than his half plus hers.
        //
        // The open threads and the running story join it for the same reason.
        // Everything she keeps that he cannot otherwise see belongs in the one
        // place he goes to check what she is keeping — an audit that omits two
        // of the five things it audits is the defect it exists to prevent.
        const [told, noticed, channels, loops, story] = await Promise.all([
          readNotes('instruction'), readNotes('fact'), readChannels(), readLoops(), readThesis(),
        ]);
        await say(notesList(told, noticed, channels, loops, story));
      } catch (err) {
        console.error("doji-eugenia: notes unavailable —",
          err instanceof Error ? err.message : err);
        await say("I cannot read my notes just now, jefe.");
      }
      return;
    }
    // Any other slash command is addressed to Telegram, not to her, and /start
    // arrives once per install. Answering one costs a full model call with the
    // notes attached, so it is answered from here instead — Gladys ignores
    // everything that is not a tap for the same reason.
    if (text.startsWith('/')) {
      await tg("sendMessage", { chat_id: CHAT_ID,
        text: "Aqui estoy, jefe. Just talk to me — or /notes to see what I have kept." });
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
      const [history, notes, channels, story, loops, calendar] = await Promise.all([
        recent(), notesBlock(), channelsBlock(), thesisBlock(), loopsBlock(), calendarBlock(),
      ]);
      /* TOLD THAT IT WILL BE HEARD, rather than left to a cap that silently
         drops the audio on a long answer. The instruction and SPEAK_MAX are one
         number stated once — an answer she keeps under it is one she chose,
         where an answer trimmed by the cap is one he never learns was spoken. */
      const aloud = heard
        ? `\n\nHe sent this as a voice note, so your answer will be read back to him ` +
          `aloud. Keep it under ${SPEAK_MAX} characters and write it to be heard — ` +
          `no lists, no headings, nothing that needs to be looked at.`
        : "";
      const context = text + aloud + notes + channels + story + loops + calendar;
      answer = await ask(
        [...history, {
          role: 'user',
          // An image rides as a block beside the text; everything else is the
          // string it always was. The context goes in the text either way, so
          // the notes reach her whichever shape the turn takes.
          content: blocks.length ? [...blocks, { type: 'text', text: context }] : context,
        }],
        'medium', 'reply');
    } finally {
      // Stopped the moment there is something to send, not after sending it —
      // otherwise a ping fires between the message landing and the write, and
      // she reads as about to say more.
      clearInterval(keepTyping);
    }

    await say(answer);
    // AFTER THE TEXT AND BEFORE THE WRITE. After, so the answer is already his
    // whatever the vendor does; before, only because the write is the slower of
    // the two and the audio is the half he is waiting on.
    if (speaksBack(answer, heard)) await speak(answer);
    // THE TEXT, NEVER THE BLOCKS. A chart stored as base64 would be a megabyte
    // of history resent on every turn for the next six exchanges, and the
    // transcript of a voice note is the part worth searching anyway. What was
    // SPOKEN is not stored either, for the same reason and more so: it is the
    // same words, in a megabyte.
    await remember([{ role: 'user', content: text }, { role: 'assistant', content: answer }]);
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
      const update = await req.json();
      // TWO KINDS OF UPDATE NOW, and the webhook must be registered for both:
      // allowed_updates = ["message", "callback_query"]. Registered for
      // "message" alone the taps under a briefing are never delivered, the
      // button spins, and nothing anywhere reports it — which is exactly the
      // silent-registration failure Gladys's setWebhook already documents.
      // Answer first, work after, for both. See handleMessage.
      background(update?.callback_query
        ? handleFeedback(update.callback_query)
        : handleMessage(update));
      return json({ ok: true });
    }
    if (secretMatches(fromCron, CRON_SECRET)) {
      /* TWO CALLERS BEHIND ONE SECRET, told apart by whether there is a body.
         The cron jobs post nothing; the trades trigger posts {trade, event}.
         Read as text and parsed rather than req.json(), because an empty body
         throws there — and that throw would be every scheduled run. */
      const raw = (await req.text()).trim();
      const sent = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
      if (sent?.trade) {
        return await postTradeEvent(String(sent.trade), String(sent.event ?? 'opened'));
      }
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
