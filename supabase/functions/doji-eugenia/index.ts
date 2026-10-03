// ═══════════════════════════════════════════════════════════════════════════
// EUGENIA — market briefing and conversation  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// The second bot: Gladys collects the journal, Eugenia does macro. Two
// callers, told apart by the secret they present:
//
//   x-doji-key                        the scheduled jobs in 004, the trades
//                                     trigger in 005, and her own speaking
//                                     worker — postScheduled reads which.
//   x-telegram-bot-api-secret-token   Telegram — he replied, answer him.
//
// She owns no column of `trades` and has no write path to it: she reads the
// journal through eugenia_trades, granted SELECT alone, and writes only her
// own tables.
//
// The schedule is decided here rather than in cron, which runs in UTC: the job
// runs hourly and dueNow answers against New York's own clock.
//
// Her cron secret is not harmless: here `?force=1` spends money, a briefing at
// a time. The bound is the spend cap on the Anthropic key, the one place one
// can be enforced.
//
// Deploy:   supabase functions deploy doji-eugenia --no-verify-jwt
// Register: setWebhook with secret_token = EUGENIA_WEBHOOK_SECRET and
//           allowed_updates = ["message", "callback_query"] — without the
//           second, the taps under a briefing are never delivered.
// Secrets:  EUGENIA_BOT_TOKEN, EUGENIA_WEBHOOK_SECRET, TELEGRAM_CHAT_ID,
//           DOJI_CRON_SECRET, ANTHROPIC_API_KEY, SB_SECRET_KEY
// ═══════════════════════════════════════════════════════════════════════════
import { SYSTEM, CONSOLIDATE, CRITIC, TRIM, RELEASE, MOVE, TRADE_EVENT, CHANNELS, CHANNEL_STATES } from "./prompt.ts";
import { ALWAYS, SECTIONS, VERSION } from "./strategy.ts";
// Pure and imported, so the parts that decide are testable.
import {
  checkRules, adherenceList, dayStanding, DAY_LOSS, isBroker, HIGH, weekOf,
  type TradeRow, type Standing, type Stop, type RuleResult,
} from "./adherence.ts";
import { journalStats, statsList } from "./journal.ts";
import {
  env, secretMatches, json, marketOpen, nyClock, nyDate, telegram, sbHeaders, SB_URL, SB_KEY, why
} from "../_shared/edge.ts";

const BOT_TOKEN      = env("EUGENIA_BOT_TOKEN");
const WEBHOOK_SECRET = env("EUGENIA_WEBHOOK_SECRET");
// The same chat as Gladys; numeric, being both a send target and an identity.
const CHAT_ID        = env("TELEGRAM_CHAT_ID");
const CRON_SECRET    = env("DOJI_CRON_SECRET");
const ANTHROPIC_KEY  = env("ANTHROPIC_API_KEY");

/* ─── When the briefing is due ─────────────────────────────────────────────
   Weekdays at 08:00 and Sunday at 17:00 New York — the gold open, so the
   week's first briefing lands with the market. Which briefing rather than a
   boolean: the two are asked different things and read different calendars.
   ───────────────────────────────────────────────────────────────────────── */
export type Brief = 'weekday' | 'sunday';

export function briefDue(now: Date): Brief | null {
  const { wd, hour } = nyClock(now);
  if (wd >= 1 && wd <= 5 && hour === 8) return 'weekday';
  if (wd === 0 && hour === 17) return 'sunday';
  return null;
}

/* The second look, whose default answer is silence: weekdays at 10:00, past
   the 08:30 data and into the session. One call a day rather than an hourly
   watch, whose right answer would usually be "nothing happened". */
export function pulseDue(now: Date): boolean {
  const { wd, hour } = nyClock(now);
  return wd >= 1 && wd <= 5 && hour === 10;
}

/* The retries, which fire only if the briefing did not land: weekdays 09:00 to
   11:00, while it is still a briefing, and Sunday 18:00 to 20:00 — the one
   whose absence would otherwise last a week. Returns which briefing, because a
   retry sends the shape the failed one would have; dueNow once named
   'weekday' itself, right only while this window was weekdays-only. */
export function retryDue(now: Date): Brief | null {
  const { wd, hour } = nyClock(now);
  if (wd >= 1 && wd <= 5 && hour >= 9 && hour <= 11) return 'weekday';
  if (wd === 0 && hour >= 18 && hour <= 20) return 'sunday';
  return null;
}

/* Which briefing this DAY takes — what ?force=1 needs, so a forced Sunday
   evening briefing is a Sunday one. */
export const briefKind = (now: Date): Brief =>
  nyClock(now).wd === 0 ? 'sunday' : 'weekday';

/* The nightly pass: 22:00 New York, every day. Clear of every other hour,
   which the week-walk test holds. The window and the gap between runs are the
   same twenty-four hours, so no watermark is needed; a missed night loses the
   distillation, never the day, since the turns stay searchable. */
export function consolidateDue(now: Date): boolean {
  return nyClock(now).hour === 22;
}

/* Its retry at 23:00, still the same civil day, so "did tonight's pass run" has
   an answer. A pass that dies silently looks like a memory with nothing worth
   keeping. */
export function consolidateRetryDue(now: Date): boolean {
  return nyClock(now).hour === 23;
}

/* What this hour owes — one answer, because the schedules overlap and each
   being right alone settles nothing. At 10:00 a needed retry beats the pulse:
   a second look at a morning he was never told about is worth nothing. */
export function dueNow(now: Date, briefed: boolean, consolidated: boolean):
    Brief | 'pulse' | 'consolidate' | null {
  const brief = briefDue(now);
  if (brief) return brief;
  const retry = retryDue(now);
  if (retry && !briefed) return retry;
  // The gate makes 23:00 a retry rather than a second pass.
  if ((consolidateDue(now) || consolidateRetryDue(now)) && !consolidated) return 'consolidate';
  return pulseDue(now) ? 'pulse' : null;
}


/* ─── Telegram's 4096-character limit ──────────────────────────────────────
   A briefing that builds a term properly can reach it. A break mid-sentence
   reads as a bug, so the split prefers a blank line, then any newline, then a
   hard cut.

   Two lookups rather than a max() over the pair: lastIndexOf('\n') is always
   at or past lastIndexOf('\n\n'), so a max can never prefer the paragraph.
   ───────────────────────────────────────────────────────────────────────── */
export const TG_LIMIT = 4096;

export function chunk(text: string, limit = TG_LIMIT): string[] {
  const out: string[] = [];
  let rest = text.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // On the window, so the break is always inside the budget.
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
   Read-only by structure, not restraint: the view fixes the columns and hides
   deleted rows, its grant is SELECT, and this is her one read of the journal.
   A tool rather than trades in every request — most messages are about the
   Fed, and a journal on every turn is paid for every turn and breaks the cache
   on every fill.
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
   Three kinds. A `fact` she noticed about him. An `instruction` he gave her —
   "stop mentioning the ten-year" — his only channel for correcting her. A
   `commitment` he made — "this week I stop after two losses" — read the other
   way: held against his trades, not obeyed.

   One table, read as separate windows: one newest-20 window would evict a
   standing instruction after a month of observations, after she had told him
   it stuck. Append-only; a correction is a newer note superseding the old.
   ───────────────────────────────────────────────────────────────────────── */
export const NOTE_KINDS = ['fact', 'instruction', 'commitment'] as const;
export const NOTE_MAX = 200;

const NOTES_TOOL = {
  name: "remember",
  description:
    "Keep one short line for later. Use kind='fact' for something about the trader — " +
    "how he trades, what he is working on, what he already understands, what " +
    "explanation landed; never today's price or today's data, which are stale " +
    "tomorrow. Use kind='instruction' for something he has told you to do or stop " +
    "doing, in his own words: those are standing, and every later message obeys " +
    "them. Use kind='commitment' for something he has said HE will do or stop " +
    "doing, in his own words and with its period if he gave one: those are what " +
    "his trades are held against. Record a fact silently; acknowledge an " +
    "instruction or a commitment in four words or fewer.",
  input_schema: {
    type: "object",
    properties: {
      note: { type: "string", description: `One short sentence, at most ${NOTE_MAX} characters.` },
      kind: {
        type: "string",
        enum: NOTE_KINDS,
        description: "'fact' for something you noticed about him; 'instruction' for something he " +
          "told you to do; 'commitment' for something he said he would do.",
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
   The five channels her teaching is anchored to: five rows rather than a
   window, so a channel he has never used is a row saying so — an absence
   nobody would write down as a note.

   The nightly pass's alone, not in CHAT_TOOLS: a rung is a judgment across
   days, and moving one from a single exchange is reading a pattern into one
   fill. A demotion is something he SAID, but it lands at the pass too — the
   pass reads the whole day, and the rung is read only by the next briefing.
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
   The summary and rules table ride on the cached system prompt; this is the
   rest. She cannot write it: a document that decides whether he followed his
   rules cannot be edited by the thing checking them.
   ───────────────────────────────────────────────────────────────────────── */
const STRATEGY_TOOL = {
  name: "get_strategy",
  description:
    "The reasoning behind his trading rules. You already hold the summary and the " +
    "rules table; this is the rest of the document — why a rule exists, how a " +
    "journal column is meant to be read, what a term means precisely. Sections: " +
    Object.keys(SECTIONS).join(", ") + ". " +
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

/* A module constant, so it cannot fail. An unknown section is answered rather
   than refused — the number comes from the model, and a blank is something she
   would fill in herself.

   A subsection is served by the section holding it: R-05 and R-06 cite §4.1
   and §4.2, which are prose inside §4, and an exact lookup once told her they
   did not exist. Exported because it is the decision. */
export function readStrategy(section: unknown): string {
  const key = String(section ?? "").trim().replace(/^§/, '');
  const found = SECTIONS[key] ?? SECTIONS[key.split('.')[0]];
  if (found) return found;
  return `The strategy has no section ${key}. It holds ${Object.keys(SECTIONS).join(", ")} ` +
         `at version ${VERSION}. Sections 1 and 11 do not exist and nothing ` +
         `cites them, so say that rather than guessing what they would have said.`;
}

/* ─── Reaching what the windows do not ─────────────────────────────────────
   Twelve turns and twenty notes are what she is handed; everything older is in
   the tables and never selected. A search is paid for only when a question
   needs one, where a wider window is paid on every request.
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

// About one briefing's worth of text: enough to answer from, and bounded.
const SEARCH_HITS = 12;
const SEARCH_CHARS = 300;

export type Hit = { source: string; id: number; at: string; retired: boolean; body: string };

/* Who said it is part of the hit: without the role, half of every result was
   HIS words handed back as hers. It rides in `source` — `note`, `you`, `him` —
   because changing the function's return type would mean dropping it and its
   grants. A map rather than ternaries, so agree.test.mjs can hold it against
   the SQL's literals; an unknown source renders as itself rather than falling
   into hers. Pure; the read stays with the caller. */
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
   Full text and trigram find a rephrasing, not a different idea: "the December
   cut" against "the market has given up on easing" shares no substring, and
   she would answer that they never discussed it. This adds no memory and no
   window — everything a vector finds was already in the table.

   Unset is a first-class state: with no EMBED_KEY every caller gets null, rows
   land without a vector, and the search runs as it did before.

   A vendor that refuses is different, so embed() THROWS: ?embed=1 must be able
   to say whether it was credit, permission or a mistyped secret. The write
   paths and the search swallow it with `.catch(() => null)`, because a vendor
   failure must never cost a note, a turn or the lexical arm. agree.test.mjs
   counts both sides.
   ───────────────────────────────────────────────────────────────────────── */
const EMBED_URL = env("EMBED_URL") || "https://api.openai.com/v1/embeddings";
const EMBED_KEY = env("EMBED_KEY");

/* Pinned, unlike STT_MODEL: vectors from two models are not comparable, and
   the column catches a change of width but not one at the same width. A change
   is a reviewed diff and a re-embedding of both tables. */
const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;

/* Fifty at a time, sized by the writes that follow: one PATCH per row, since an
   upsert carrying only id and embedding fails `content not null` before any
   conflict is detected. */
const EMBED_BATCH = 50;

/* Ordered by the index the vendor states, never by arrival: a vector filed
   against the wrong row is a memory returning the wrong text, undetectably. All
   or nothing, since a short or wrong-width answer cannot say which row lost
   its vector. Returns pgvector's text form, which crosses a JSON body intact
   into both the column and the search. */
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

  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${EMBED_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, dimensions: EMBED_DIMS, input: texts }),
  });
  // The body names the refusal — credit, permission, model — and each is a
  // different repair.
  if (!res.ok) {
    throw new Error(`embedding refused (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const vecs = foldVectors((await res.json())?.data, texts.length);
  if (!vecs) throw new Error(`asked for ${texts.length} vectors of ${EMBED_DIMS}, got something else`);
  return vecs;
}

/* Never throws: it runs inside the tool loop, and a failed search comes back
   as a sentence she can carry on from. */
async function searchMemory(query: unknown): Promise<string> {
  const q = String(query ?? "").trim();
  if (!q) return "Nothing to search for.";

  try {
    // Caught here: a vendor failure leaves the lexical arm, which still answers.
    // The catch below is for a database that refused.
    const [qv] = await embed([q]).catch(() => null) ?? [];
    const res = await fetch(`${SB_URL}/rest/v1/rpc/eugenia_search`, {
      method: "POST", headers: sbHeaders(),
      body: JSON.stringify({ q, lim: SEARCH_HITS, qv: qv ?? null }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hits: Hit[] = await res.json();

    // An empty result is an answer, distinct from a broken search.
    if (!hits.length) return `Nothing in your memory matches "${q}".`;

    return searchList(hits);
  } catch (err) {
    console.error("doji-eugenia: search failed —", why(err));
    return "Your memory could not be searched just now. Say you cannot check rather than answering as though you had.";
  }
}

// Twenty of each: a season of observations, and more instructions than he will
// give — the whole memory costs less than a paragraph.
const NOTES = 20;

/* Every read of her tables: ask, refuse a bad status, parse. In one place
   because PostgREST answers a missing table with a 404 whose JSON body parses
   fine, and a copy that skips the status check hands back an object for rows.
   fillEmbeddings stays out: it needs the response's content-range. */
async function readRows<T>(what: string, path: string): Promise<T[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`${what} read failed (HTTP ${res.status})`);
  return await res.json();
}

// Live notes only: drop `superseded_by=is.null` and she is handed each
// correction beside what it corrected. The id comes back so she can retire one.
async function readNotes(kind: string): Promise<Note[]> {
  return readRows<Note>('Notes',
    `eugenia_notes?select=id,note&kind=eq.${kind}` +
    `&superseded_by=is.null&order=id.desc&limit=${NOTES}`);
}

type Note = { id: number; note: string };

// The number is how a note is named when one is retired — in both renderings.
const noteLine = (n: Note) => `[${n.id}] ${n.note}`;

// What every tool that writes answers when the write failed and the failure is
// not his to hear about.
const UNSAVED = "That did not save. Carry on and do not mention it.";

/* Truncated rather than refused, and never throws: the reply she is writing
   matters more than the note, and a throw would cost the whole of it. That is
   also how she survives running without 003: no memory, every answer lands.

   Failures say which kind failed. A lost fact she need not mention; a lost
   INSTRUCTION she is about to acknowledge, and an acknowledgement of something
   never stored means he stops repeating a thing she will keep doing. */
async function writeNote(note: unknown, kind: unknown, supersedes: unknown): Promise<string> {
  const text = String(note ?? "").trim();
  if (!text) return "Nothing to remember.";

  // An unrecognised kind takes the quieter branch.
  const k = (NOTE_KINDS as readonly string[]).includes(String(kind)) ? String(kind) : 'fact';
  const kept = text.slice(0, NOTE_MAX);

  // Only a retirement needs the new row back; an unread body holds its
  // connection open.
  const old = Math.trunc(Number(supersedes));
  const retiring = Number.isFinite(old) && old > 0;

  try {
    // Embedded before the insert, so the note lands with its vector in one
    // write; caught, because a lost vector must never read as a lost note.
    const [vec] = await embed([kept]).catch(() => null) ?? [];
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_notes`, {
      method: "POST", headers: sbHeaders(retiring ? "return=representation" : "return=minimal"),
      body: JSON.stringify([{ note: kept, kind: k, ...(vec ? { embedding: vec } : {}) }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // The new note is written before the old one is retired: a failed
    // retirement leaves two live notes, recoverably, never neither.
    if (retiring) {
      const [row] = await res.json();
      const done = await fetch(
        `${SB_URL}/rest/v1/eugenia_notes?id=eq.${old}&superseded_by=is.null`, {
          method: "PATCH", headers: sbHeaders("return=representation"),
          body: JSON.stringify({ superseded_by: row.id }),
        });
      // A miss must not pass as done, or she believes a contradiction is gone
      // while it is still handed to her every turn.
      if (!done.ok || (await done.json()).length === 0) {
        return `Remembered, but note ${old} is not there to retire — ` +
               `it may already be superseded. Check the list you were given.`;
      }
    }

    if (kept.length < text.length) {
      return `Kept, but cut at ${NOTE_MAX} characters: "${kept}". ` +
             (k !== 'fact'
               ? 'Say it back to him shorter and check that is still what he meant.'
               : 'Write it shorter next time.');
    }
    return "Remembered.";
  } catch (err) {
    console.error("doji-eugenia: note not written —", why(err));
    return k !== 'fact'
      ? "That did NOT save. Tell him it did not stick and that he will have to say it again."
      : UNSAVED;
  }
}

/* Never throws, for writeNote's reason. Both names are checked against
   prompt.ts, or the check constraint answers a bad argument with a 400 that
   reads as a database fault. moved_on is a New York civil day, computed here:
   now() would file an evening move on tomorrow. */
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
  // The bottom rung is a fact about history, not about how well he holds it:
  // written back, it would report a channel she taught last week as never met.
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
    // An empty answer means 003's seed rows are missing and every move drops.
    if ((await res.json()).length === 0) {
      return `No row for ${id} — the channels table has not been seeded, so ` +
             `nothing was saved. Say nothing about this to him.`;
    }
    return `${id} is now ${to}.`;
  } catch (err) {
    console.error("doji-eugenia: channel not moved —", why(err));
    return UNSAVED;
  }
}

/* The whole query in one place, so a test can read it. `days` comes from the
   model, so it is clamped: this is the boundary. 400 rows is more than a year
   of this account. The window is counted in civil days, stepped off today's
   New York date, because open_day is a civil day and a clock change makes a
   day 23 or 25 hours long. */
export const TRADE_ROWS = 400;

export function tradesQuery(days: unknown, now = Date.now()): string {
  return `eugenia_trades?open_day=gte.${windowStart(days, now, 0)}` +
         `&order=open_day.desc,entry_time.desc&limit=${TRADE_ROWS}`;
}

/* A full read is not the whole window: past TRADE_ROWS the oldest end is cut,
   and every figure over it would still be labelled with the window asked for.
   Said where it happens, and nowhere on an ordinary window. */
export function reachLine(rows: { open_day: string | null }[], days: unknown): string {
  if (rows.length < TRADE_ROWS) return "";
  return `\nThe read stops at its ${TRADE_ROWS}-trade bound, so this reaches back only to ` +
         `${rows[rows.length - 1].open_day}, not the whole ${windowDays(days)} days. Say so ` +
         `before giving any figure over the window.`;
}

// Clamped once: the window read and the span reported are one number.
const windowDays = (days: unknown): number =>
  Math.min(Math.max(Math.trunc(Number(days)) || 30, 1), 365);

// The first civil day of the window, `back` days further out still.
function windowStart(days: unknown, now: number, back: number): string {
  const n = windowDays(days);

  const [y, m, d] = nyDate(new Date(now)).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n - back)).toISOString().slice(0, 10);
}

/* R-14's reads over check_rules' window: TradingView's high-rated releases —
   only rows with its id, since her older typed ones were never a rating he
   chose — a day early, as a UTC bound would drop the evening before; and the
   fetched weeks a further seven back, since the window's first day sits in a
   week that began before it. */
export const RULE_RELEASES = 500;

export function releasesQuery(days: unknown, now = Date.now()): string {
  return `eugenia_calendar?select=at&importance=eq.${HIGH}&tv_id=not.is.null` +
         `&at=gte.${windowStart(days, now, 1)}&order=at.desc&limit=${RULE_RELEASES}`;
}

/* A full read of the releases is not the whole window either: the oldest weeks
   would still be marked fetched while their releases never arrived, and R-14
   would pass every entry in them. So a full read covers only the weeks after
   the one its oldest release falls in. */
export function coveredWeeks(weeks: string[], releases: { at: string }[]): Set<string> {
  const reach = releases.length === RULE_RELEASES ? weekOf(new Date(releases[releases.length - 1].at)) : '';
  return new Set(weeks.filter(w => w > reach));
}

// R-19's read, from a week before the window so a position opened before it
// still has its first sighting.
export function stopsQuery(days: unknown, now = Date.now()): string {
  return `trade_stops?select=id,seen_at,sl,tp&seen_at=gte.${windowStart(days, now, 7)}` +
         `&order=seen_at.desc&limit=2000`;
}

export function weeksQuery(days: unknown, now = Date.now()): string {
  return `calendar_weeks?select=week&week=gte.${windowStart(days, now, 7)}` +
         `&order=week.desc&limit=60`;
}

/* Never throws: an exception in the tool loop costs the answer — it once cost
   a briefing and its three retries. And it says so rather than coming back
   empty: "no trades in that window" becomes "you have not traded since
   Friday", a false statement about his own week. */
async function readTrades(days: unknown): Promise<string> {
  try {
    const rows = await readRows<TradeRow>('Trades', tradesQuery(days));
    return rows.length ? JSON.stringify(rows) + reachLine(rows, days) : "No trades in that window.";
  } catch (err) {
    console.error("doji-eugenia: trades read failed —", why(err));
    return "His journal could not be read just now. Say you cannot see it rather than saying he has not traded.";
  }
}

/* ─── His own rules, evaluated ─────────────────────────────────────────────
   Whether each row satisfies a predicate HE wrote — what a judgment stands on,
   not a judgment. The prompt has her state it first, so he always holds the
   half he can check. adherence.ts says why thirteen.
   ───────────────────────────────────────────────────────────────────────── */
const CHECK_TOOL = {
  name: "check_rules",
  description:
    "Check his journal against the thirteen rules a row can actually answer — R-01, " +
    "R-02, R-03, R-04, R-10, R-11, R-12, R-13, R-14, R-15, R-16, R-18 and R-19 — over the last N days. Returns a " +
    "verdict per rule with the counts behind it and the rows that failed. Use it " +
    "whenever he asks how he has been following his rules, or before saying " +
    "anything about his discipline: this is computed from the rows, so it is not " +
    "something to reproduce by reading trades yourself. A verdict of unknown means " +
    "the data cannot decide it and is NEVER the same as a pass. The other five " +
    "rules are judgment rules and nothing stored can check them — say so " +
    "rather than implying the thirteen are the whole strategy.",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "integer", description: "How many days back to check, 1 to 365." },
    },
    required: ["days"],
    additionalProperties: false,
  },
} as const;

/* The four reads and the evaluation, shared by the tool and the briefing so
   R-14 cannot be judged against a calendar in one and nothing in the other.
   `keep` narrows only the trades. Null when nothing was kept — not a pass. */
async function readRules(days: unknown, keep: (t: TradeRow) => boolean = () => true):
    Promise<{ results: RuleResult[] | null; reach: string }> {
  const [rows, releases, weeks, moves] = await Promise.all([
    readRows<TradeRow>('Trades', tradesQuery(days)),
    readRows<{ at: string }>('Releases', releasesQuery(days)),
    readRows<{ week: string }>('Weeks', weeksQuery(days)),
    readRows<Stop & { id: string }>('Stops', stopsQuery(days)),
  ]);
  const kept = rows.filter(keep);
  const reach = reachLine(rows, days);
  if (!kept.length) return { results: null, reach };
  const stops = new Map<string, Stop[]>();
  for (const m of moves) (stops.get(m.id) ?? stops.set(m.id, []).get(m.id)!).push(m);
  return { results: checkRules(kept, Date.now(), {
    releases: releases.map(r => r.at), weeks: coveredWeeks(weeks.map(w => w.week), releases),
  }, stops), reach };
}

/* Never throws. */
async function checkAdherence(days: unknown): Promise<string> {
  try {
    const { results, reach } = await readRules(days);
    if (!results) return "No trades in that window, so there is nothing to check.";
    return adherenceList(results) + reach;
  } catch (err) {
    console.error("doji-eugenia: rule check failed —", why(err));
    return "His journal could not be read just now, so the rules were not checked. Say you could not check rather than saying nothing was broken.";
  }
}

/* ─── The journal, summarised ──────────────────────────────────────────────
   The app's arithmetic, for check_rules' reason: four definitions applied by
   hand produce a number that looks right either way. get_trades stays beside
   it, because a summary cannot be asked what happened on the eleventh.
   ───────────────────────────────────────────────────────────────────────── */
const STATS_TOOL = {
  name: "get_stats",
  description:
    "The journal summarised over the last N days — win rate, wins/losses/break-evens, " +
    "gross, losses and net, average win and average loss, the realised " +
    "reward-to-risk, how much of the total is the broker's settled figure, and " +
    "the same broken down by session and by setup. These are " +
    "the figures his own journal app shows him, computed from the rows the same " +
    "way, so they agree with what is on his screen. USE THIS RATHER THAN WORKING " +
    "IT OUT of get_trades: a break-even is measured in price and sits in the win " +
    "rate's denominator, the money split is on the sign of each P&L while the " +
    "averages are on the result label, and getting any of that wrong produces a " +
    "number that looks right. The reward-to-risk here is REALISED — average win " +
    "over average loss — and is never what he planned. Call get_trades as well " +
    "when he asks about a particular trade rather than about a stretch of them.",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "integer", description: "How many days back to summarise, 1 to 365." },
    },
    required: ["days"],
    additionalProperties: false,
  },
} as const;

/* Never throws, and says what it could not do: an empty summary reads as a
   trader who has not traded. */
async function readStats(days: unknown): Promise<string> {
  try {
    const rows = await readRows<TradeRow>('Trades', tradesQuery(days));
    return statsList(journalStats(rows), windowDays(days)) + reachLine(rows, days);
  } catch (err) {
    console.error("doji-eugenia: stats read failed —", why(err));
    return "His journal could not be read just now, so nothing was computed. Say you cannot see it rather than saying he has not traded.";
  }
}

/* ─── What lands today ─────────────────────────────────────────────────────
   Filed from TradingView, keyed on its id (018), so nothing she writes can mint
   a second row for one release. Two callers file it: the briefing, before it
   reads, and the quarter-hourly release job, which is how an actual lands
   within fifteen minutes of publication. Read through doji-tradingview with
   the cron secret she already holds.

   A rolling window rather than a civil day — the Sunday briefing is about a
   week not yet started. The forward reach is the half to keep: aheadToday can
   only warn about what is filed, and at twenty-four hours the 08:00 briefing
   left tomorrow's 08:30 print unfiled until tomorrow. Twenty-eight carries it
   past tomorrow's 10:00. Read and write share the constant.
   ───────────────────────────────────────────────────────────────────────── */
const CAL_BACK = 12, CAL_AHEAD = 28;

/* Every door of doji-tradingview she reads, behind the cron secret: its
   answer, or a throw naming the door and the reason it gave. */
async function tvRead(door: string, query = ""): Promise<any> {
  const res = await fetch(`${SB_URL}/functions/v1/doji-tradingview?${door}=1${query}`,
                          { headers: { "x-doji-key": CRON_SECRET } });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok || !answer.ok) throw new Error(`TradingView ${door}: ${answer.error ?? `HTTP ${res.status}`}`);
  return answer;
}

// What doji-tradingview's `foldCalendar` answers, one release each.
interface TvEvent {
  id: string; at: string; title: string; importance: string; timed: boolean;
  period: string | null; consensus: string | null; prior: string | null; actual: string | null;
  ticker: string | null;
}

/* Releases only — `timed` false is a marker, not a print — and medium or
   above: low is mortgage rates and rig counts, paid for on every request and
   moving nothing.

   A figure TradingView has not published is left out, never sent as null:
   under merge-duplicates a null erases an actual the release look recorded by
   hand. `note` is hers and never named. The period joins the name, since the
   title alone does not say which month. */
export function calendarRows(events: TvEvent[], from: number, to: number) {
  return events
    .filter(e => e.timed && e.importance !== 'low')
    .filter(e => {
      const at = Date.parse(e.at);
      return at >= from && at <= to;
    })
    .map(e => {
      const row: Record<string, string> = {
        tv_id: e.id, at: new Date(e.at).toISOString(),
        name: e.period ? `${e.title} (${e.period})` : e.title,
        importance: e.importance, source: 'tradingview',
      };
      for (const k of ['consensus', 'prior', 'actual', 'ticker'] as const) if (e[k] !== null) row[k] = e[k]!;
      return row;
    });
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function readTvCalendar(from: string, to: string): Promise<TvEvent[]> {
  return (await tvRead("calendar", `&from=${from}&to=${to}`)).events;
}

/* Grouped by the keys each row carries: PostgREST refuses a bulk insert whose
   objects name different columns, and leaving a figure out depends on it. */
async function upsertCalendar(rows: Record<string, string>[]): Promise<number> {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const shape = Object.keys(row).sort().join(",");
    (groups.get(shape) ?? groups.set(shape, []).get(shape)!).push(row);
  }
  for (const batch of groups.values()) {
    const put = await fetch(`${SB_URL}/rest/v1/eugenia_calendar?on_conflict=tv_id`, {
      method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(batch),
    });
    if (!put.ok) throw new Error(`calendar not written (HTTP ${put.status})`);
  }
  return rows.length;
}

// Exported so a test can drive the grouping.
export async function fileCalendar(now: number): Promise<number> {
  const from = now - CAL_BACK * 3600_000, to = now + CAL_AHEAD * 3600_000;
  return upsertCalendar(calendarRows(await readTvCalendar(utcDay(from), utcDay(to)), from, to));
}

/* A whole week, then the mark that says so (019). `week` is a New York Sunday;
   TradingView is asked in UTC days, so the read runs to the next Sunday and
   keeps what weekOf files under this week. The mark goes down only after the
   rows, so a failure between leaves the week unknown rather than covered and
   empty. */
export async function fileWeek(week: string, now = Date.now()): Promise<number> {
  const next = utcDay(Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000);
  const rows = calendarRows(await readTvCalendar(week, next), 0, Infinity)
    .filter(r => weekOf(new Date(r.at)) === week);
  const filed = await upsertCalendar(rows);
  const res = await fetch(`${SB_URL}/rest/v1/calendar_weeks?on_conflict=week`, {
    method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([{ week, fetched_at: new Date(now).toISOString() }]),
  });
  if (!res.ok) throw new Error(`week ${week} filed and not marked (HTTP ${res.status}) — has 019 been applied?`);
  return filed;
}

/* Never takes its caller down, and both outcomes are a row: a calendar that
   silently stopped moving looks like a quiet week. Its own caller label, apart
   from the quarter-hourly filing, because only this marks a week covered. */
async function filedWeek(week: string): Promise<boolean> {
  try {
    await recordRun({ caller: 'calendar week', ok: true, detail: `${week}: ${await fileWeek(week)} filed` });
    return true;
  } catch (err) {
    const reason = why(err);
    console.error(`doji-eugenia: week ${week} not filed —`, reason);
    await recordRun({ caller: 'calendar week', ok: false, detail: `${week}: ${reason}`.slice(0, 500) });
    return false;
  }
}

/* The weeks from a date to now, at most two years — one run's worth inside the
   wall clock; a longer history is a second run. Anchored at noon UTC on the
   Sunday, so a week's step never crosses a clock change into the wrong day.
   Pure, so the walk is driven. */
const HISTORY_WEEKS = 104;

export function historyWeeks(start: string, now: number): string[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || isNaN(Date.parse(start))) return null;
  const weeks: string[] = [];
  for (let at = Date.parse(`${weekOf(new Date(`${start}T12:00:00Z`))}T12:00:00Z`);
       weeks.length < HISTORY_WEEKS && at <= now; at += 7 * 86_400_000) {
    weeks.push(weekOf(new Date(at)));
  }
  return weeks;
}

/* One week at a time, each failure its own eugenia_runs row — where this door
   is read, since it answers before it works. TradingView refuses past about
   thirty calendar reads a minute, so a refused week is asked again once after
   a pause, and a second refusal ends the walk with its last row naming where
   to resume. Exported with the pause as a parameter so the sequence is
   driven. */
const HISTORY_PAUSE_MS = 35_000;

export async function postHistory(start: string, pause = HISTORY_PAUSE_MS): Promise<Response> {
  const weeks = historyWeeks(start, Date.now());
  if (!weeks) return json({ ok: false, error: "history takes a date, YYYY-MM-DD" }, 400);
  for (const week of weeks) {
    if (await filedWeek(week)) continue;
    await new Promise(r => setTimeout(r, pause));
    if (!await filedWeek(week)) break;
  }
  return json({ ok: true, weeks: weeks.length });
}

async function filed(now = Date.now()): Promise<void> {
  try {
    await recordRun({ caller: 'calendar', ok: true, detail: `${await fileCalendar(now)} filed` });
  } catch (err) {
    const reason = why(err);
    console.error("doji-eugenia: calendar not filed —", reason);
    await recordRun({ caller: 'calendar', ok: false, detail: reason.slice(0, 500) });
  }
}

/* The fallback for a print TradingView has not published. It cannot insert —
   an upsert on a model-written name once filed a print beside the row it was
   handed — so it is a PATCH over the two columns a look owns, never consensus
   or prior. A name matching nothing answers with the names on file, since an
   empty PATCH is a 200 that reads like a write.

   Either half may come alone: a speech has no figure, and its one line must
   not be refused for want of a number. An absent key is left as it was. */
async function recordActual(at: unknown, name: unknown, actual: unknown, note: unknown): Promise<string> {
  const when = new Date(String(at ?? ""));
  const called = String(name ?? "").trim();
  const printed = String(actual ?? "").trim().slice(0, NOTE_MAX);
  const line = String(note ?? "").trim().slice(0, NOTE_MAX);
  if (isNaN(+when) || !called || !(printed || line)) {
    return "That needs the release's time in UTC, its name exactly as the calendar lists it, " +
           "and what it printed, or for a speech one line on what was said.";
  }

  const patch: Record<string, string> = {};
  if (printed) patch.actual = printed;
  if (line) patch.note = line;

  // The name goes out encoded and nothing else. PostgREST reads an `eq` value
  // whole — quotes are stripped only inside `in.(…)` — so quoting it once made
  // every call miss.
  const at_ = when.toISOString();

  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_calendar?at=eq.${at_}&name=eq.${encodeURIComponent(called)}`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if ((await res.json()).length) return `Recorded against ${called}.`;

    // Bounded: the 08:30 slot holds most of a report.
    const standing = await readRows<Release>('Release',
      `eugenia_calendar?select=name&at=eq.${at_}&limit=12`);
    return standing.length
      ? `Nothing at that time is called "${called}". On file: ` +
        `${standing.map(r => r.name).join(", ")}. Call it again with one of those, copied exactly.`
      : "Nothing is on file at that time, so there is no entry to fill in. Leave it.";
  } catch (err) {
    console.error("doji-eugenia: actual not written —", why(err));
    return UNSAVED;
  }
}

const ACTUAL_TOOL = {
  name: "record_actual",
  description:
    "Fill in what a release printed, on the entry already filed for it, or for a " +
    "speech, which prints nothing, one line on what was said. Give the time in " +
    "UTC and the name exactly as the list you were handed spells it. This updates " +
    "that entry and can never add a second one, so a name that matches nothing " +
    "writes nothing and tells you what is on file instead.",
  input_schema: {
    type: "object",
    properties: {
      at:     { type: "string", description: "When it landed, ISO 8601 in UTC, as the entry was filed." },
      name:   { type: "string", description: "The entry's name, copied exactly from the list you were given." },
      actual: { type: "string", description: "What it printed, with its unit. Left out for a speech." },
      note:   { type: "string", description: `One line on what it meant, or for a speech what was said. At most ${NOTE_MAX} characters.` },
    },
    required: ["at", "name"],
    additionalProperties: false,
  },
} as const;

/* ─── The price, read off the instrument ───────────────────────────────────
   Through the poller, never the broker: the endpoint that serves a price also
   serves create_order, so the token stays in doji-mcp-sync and she presents
   the cron secret, which there opens only a read-only poll.
   ───────────────────────────────────────────────────────────────────────── */
// One path from SB_URL, so no second copy of the project ref.
const MARKET_URL = `${SB_URL}/functions/v1/doji-mcp-sync?market=1`;

const MARKET_TOOL = {
  name: "get_market",
  description:
    "The live gold price from his own broker — bid, ask, the session high and low, " +
    "the previous session's close, and the move since it. Use it whenever you are " +
    "about to state where gold is or what it has done overnight, which is every " +
    "briefing. This is read off the instrument, so prefer it over any number a " +
    "search or a page gives you; those are as stale as the page was. Everything " +
    "but the bid and the ask is measured from the session open, which for gold is " +
    "the 17:00 New York roll — the answer says which side of that roll you are on, " +
    "and after it those figures are the evening rather than the day. It says " +
    "nothing about what price will do next and is not to be used as though it did.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
} as const;

/* The market around gold, in a conversation: the reads the move look makes,
   headlines wider, plus the rate odds and the speculators' count — "is gold
   crowded" gets asked on a Wednesday. Without it her only source was a web
   search, against her own rule. */
const AROUND_TOOL = {
  name: "get_around",
  description:
    "The market around gold, from TradingView: the dollar index, the two- and " +
    "ten-year yields, the real yield, silver, oil, the S&P 500 and the VIX, each a " +
    "level now beside the level at a stated time; and gold's and the dollar's " +
    "headlines from the last six hours, titles only; what fed funds futures price for " +
    "the next three Fed meetings; and the CFTC's weekly count of " +
    "where the speculators stand in gold futures. Use it whenever you are about " +
    "to say what the dollar, yields or anything else around gold did, or what " +
    "crossed the wires, and quote those from here rather than from a search. " +
    "Every line says what it is measured from; say that window, never 'today'. " +
    "Like get_market, it says nothing about where price goes next.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
} as const;

/* Display prices: the poller settles the scale before serving. */
export interface Quote {
  bid: number; ask: number; high: number; low: number;
  prev_close: number | null; change: number | null; at: string;
}

/* The figures, or null: an unreadable price is not zero. One fetch, and each
   caller says what a missing price means to it. */
async function marketQuote(): Promise<Quote | null> {
  try {
    const res = await fetch(MARKET_URL, { headers: { "x-doji-key": CRON_SECRET } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const quote = await res.json();
    if (!quote?.ok || typeof quote.bid !== 'number') throw new Error("no readable quote");
    return quote as Quote;
  } catch (err) {
    console.error("doji-eugenia: market read failed —", why(err));
    return null;
  }
}

/* The window every figure is measured over. High, low, previous close and the
   move all belong to the broker's session, which restarts at the 17:00 New
   York roll — so the same `change` is the overnight move before that hour and
   the evening's after it. Unlabelled it read as "on the day". Nothing here
   spans the calendar day, so the window is named rather than computed. Pure,
   so both sides of the roll are driven. */
export const ROLL_HOUR = 17;

export function quoteWindow(now: Date): string {
  return nyClock(now).hour >= ROLL_HOUR
    ? "The broker's session began at the 17:00 New York roll THIS EVENING. The " +
      "high and the low are only the hours since that roll, and the move is " +
      "measured from the close it rolled off — so none of it is the calendar " +
      "day. This is NOT the move on the day and must not be called one; what " +
      "gold has done since midnight is not something this quote can tell you."
    : "The broker's session began at the 17:00 New York roll YESTERDAY evening, " +
      "so the high and the low are the overnight range and the move since the " +
      "previous close is the overnight move.";
}

/* One rendering of a quote, with the window inside it, for all three callers —
   prose, because a bare `change` reads as whatever it sounds like. */
export function quoteLine(q: Quote, now: Date): string {
  // No previous close, no move — and she is told not to reconstruct one. The
  // bid and the range are still worth having.
  const since = q.prev_close === null || q.change === null
    ? `. The broker reported no previous close on this read, so there is no ` +
      `move to state and you may not infer one.`
    : ` against a previous close of ${q.prev_close} — ` +
      `${q.change >= 0 ? "up" : "down"} ${Math.abs(q.change)} since it.`;

  return `Gold, read off his own broker: bid ${q.bid}, ask ${q.ask}. The session ` +
    `has traded ${q.low} to ${q.high}${since} ` + quoteWindow(now);
}

// Said rather than left out: a briefing missing its price invents one or
// drops the line its first paragraph is built on.
const NO_PRICE =
  "The live price could not be read just now. Say you do not have a current " +
  "level rather than quoting one from a search.";

/* Never throws. */
async function readMarket(): Promise<string> {
  const quote = await marketQuote();
  return quote ? quoteLine(quote, new Date()) : NO_PRICE;
}

/* The briefing is handed the price rather than told to fetch it: an
   instruction where an input belongs fails the way instructions do, with a
   level off a search page that still looks like gold. The tool stays for
   replies. marketQuote already swallows its failure. */
export async function marketBlock(): Promise<string> {
  const quote = await marketQuote();
  return "\n\n" + (quote ? quoteLine(quote, new Date()) : NO_PRICE);
}

/* ─── The running story ────────────────────────────────────────────────────
   What the market has been trading, across weeks: turns roll over in a
   morning and notes are about him. The nightly pass alone writes it, for
   set_channel's reason — one exchange must not redirect the week's story.
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
    // Empty means 005's seed row is missing, as with setChannel.
    if ((await res.json()).length === 0) {
      return "There is no thesis row — 005 has not been applied, so nothing was saved. Say nothing about this to him.";
    }
    return "Thesis updated.";
  } catch (err) {
    console.error("doji-eugenia: thesis not written —", why(err));
    return UNSAVED;
  }
}

/* ─── What she flagged, and what she asked ─────────────────────────────────
   Threads she flagged or questions she put to him, handed back until they
   close — without them, follow-through depended on the turn still being inside
   twelve. Opened anywhere, closed only at the pass: closing is a judgment that
   it resolved.
   ───────────────────────────────────────────────────────────────────────── */
export const LOOP_KINDS = ['watch', 'question'] as const;

const LOOP_TOOL = {
  name: "open_loop",
  description:
    "Keep one open thread. kind='watch' for something odd you flagged that has not " +
    "resolved — a reaction that went the wrong way, a number that does not fit. " +
    "kind='question' for a question you put to him in a conversation and have not " +
    "had an answer to. Both come back to you every briefing until they close, which " +
    "is what lets you say how something landed rather than never mentioning it " +
    "again. A briefing asks him nothing, so it opens at most one watch and never a " +
    "question. Open one only for something you would actually want back — this is " +
    "not a diary.",
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
    console.error("doji-eugenia: loop not opened —", why(err));
    return UNSAVED;
  }
}

async function closeLoop(id: unknown, resolution: unknown): Promise<string> {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return "That is not a thread number.";
  try {
    // So an already-closed thread is reported rather than passing as done.
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
    console.error("doji-eugenia: loop not closed —", why(err));
    return UNSAVED;
  }
}

/* ─── Claude ───────────────────────────────────────────────────────────────
   Raw fetch rather than the SDK, like every other outbound call here. Web
   search is what makes a briefing possible at all: a briefing invented from
   training data is worse than none.
   ───────────────────────────────────────────────────────────────────────── */
// `content` is a string for everything stored and replayed, and blocks only for
// the turn being asked now — a chart he just sent. What is stored is always
// the string, so a megabyte of base64 never becomes memory.
interface Turn { role: 'user' | 'assistant'; content: string | any[] }

/* Effort per caller. The briefing earns `high`; a reply and the pulse do not —
   at high, "how many trades did I take" bought a minute of thought for one
   sentence. Medium rather than low, because a fast wrong reading of his
   journal is worse than a slow right one. */
type Effort = 'medium' | 'high';

/* The container is not optional. web_search_20260209 filters dynamically by
   running code on Anthropic's side, and from there the model can call our tools
   programmatically. A continuation answering those calls must carry the
   container id — a bare string on the request, container.id on the response —
   or the request is refused. The message answering them holds only
   tool_result blocks, and no tool may be strict, which programmatic calling
   does not support; tradesQuery and writeNote are boundaries regardless.

   Web fetch is the grounding half: search returns prose about a number, fetch
   the page it is on. Six uses to search's twelve. Both are server-side, and
   neither may sit beside a declared code_execution tool — a second execution
   environment confuses the model about which it is in. */
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 12 };
/* Page size bounded as well as count: one forum thread could outweigh the whole
   briefing, carried again on every later round. */
const WEB_FETCH  = { type: "web_fetch_20260209",  name: "web_fetch",  max_uses: 6,
                     max_content_tokens: 10000 };

/* One set per job, and a set is what a job can run as well as what it is
   offered: the shared loop answers a name outside its set as unknown. Never a
   schema for something a job has no business doing — it is paid on every
   request and it is an option that should not be taken. The pass has nothing
   to research but needs search to supersede rather than duplicate; the release
   look gets no memory; the move look nothing to file; the trade look only his
   strategy and journal. */
const CHAT_TOOLS = [
  WEB_SEARCH,
  WEB_FETCH,
  MARKET_TOOL,
  AROUND_TOOL,
  TRADES_TOOL,
  STATS_TOOL,
  CHECK_TOOL,
  NOTES_TOOL,
  SEARCH_TOOL,
  STRATEGY_TOOL,
  LOOP_TOOL,
];
const CONSOLIDATE_TOOLS = [NOTES_TOOL, CHANNEL_TOOL, SEARCH_TOOL, THESIS_TOOL, CLOSE_TOOL, CHECK_TOOL, STATS_TOOL];
// A look files an actual, through a PATCH that cannot mint a row.
const RELEASE_TOOLS = [WEB_SEARCH, WEB_FETCH, MARKET_TOOL, ACTUAL_TOOL, LOOP_TOOL];
/* Its own array: borrowing the release look's handed it a tool for filing a
   print and the hour-long cache write that array carries. */
const MOVE_TOOLS = [WEB_SEARCH, WEB_FETCH, MARKET_TOOL, LOOP_TOOL];
const TRADE_TOOLS = [STRATEGY_TOOL, TRADES_TOOL];
/* No tools: the gates read a draft and return one. Sharing the briefing's
   array to ride its cache does not work — the array starts the key and the
   effort differs, which invalidates the rest; measured, the critic wrote
   23,309 tokens and read none. The empty array is the smaller write.
   REFACTOR.md R-15. */
const CRITIC_TOOLS: unknown[] = [];

/* The model per caller. A week of eugenia_runs put fourteen release looks
   above five briefings in cost, so the bounded callers moved to Sonnet — and
   the release look then died at MAX_ROUNDS twice the next morning. That pair
   is confounded: record_actual had joined its tools eighty minutes before the
   model changed, and its rounds stayed high after the revert. So it proves
   neither half; the policy stands anyway — a cheaper caller that does not
   answer is not cheaper, so a move is one caller at a time with `rounds` read
   after.

   `trim` stays on Sonnet because its array is empty: one request, no loop, no
   cap to reach. The critic does not move: it runs last, can rewrite, and is
   the final gate on how she reads. */
const OPUS = "claude-opus-5";
const SONNET = "claude-sonnet-5";

/* Keyed on the caller's label — the string eugenia_runs.caller records — and
   agree.test.mjs holds the keys against labels actually passed. Absent means
   Opus: a new caller is expensive and correct rather than cheap and unnoticed. */
const MODELS: Record<string, string> = {
  'trim': SONNET,
};

export const modelFor = (label: string): string => MODELS[label] ?? OPUS;

async function call(messages: any[], effort: Effort, tools: unknown[],
                    model: string, container?: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      // A header, not a `betas` body field: that is the SDKs' parameter, and
      // an unknown body field is a 400 on every call. With Opus alone, by
      // caution: nothing has shown Sonnet accepts `fallbacks`, and if it does
      // not, every Sonnet call 400s. The header and the field go together.
      ...(model === OPUS
          ? { "anthropic-beta": "server-side-fallback-2026-07-01" }
          : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      /* Cached: long, fixed, and sent on every turn — which is why the strategy
         rides here. The window is a property of the tool ARRAY, where the key
         starts: each array is its own prefix. A week of wrote_1h showed every
         caller's turns equal to its writes except the release look, whose
         quarter-hourly looks cluster in one morning — so it keeps the hour.
         Everything else is five minutes, which the rounds within a turn keep
         alive. `ttl` is a plain field, not a beta. */
      system: [{ type: "text", text: SYSTEM + ALWAYS,
                 cache_control: { type: "ephemeral",
                                  ttl: tools === RELEASE_TOOLS ? "1h" : "5m" } }],
      messages,
      // Server tools need no loop here; the rest are executed below.
      tools,
      thinking: { type: "adaptive" },
      output_config: { effort },
      // A decline would otherwise cost the briefing and a retry's searches.
      // `fallbacks: "default"` re-runs on another model inside this call,
      // routed by refusal category; a decline before output is not billed.
      ...(model === OPUS ? { fallbacks: "default" } : {}),
      // The first request of a turn has none.
      ...(container ? { container } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/* A backstop against a loop billing for ever, not a working limit. Six was
   reached by a release look that searched, fetched and searched again, and the
   failure it caused — a message that never arrives — is worse than the one it
   guards against. eugenia_runs.rounds says how close each caller runs. */
const MAX_ROUNDS = 10;

// What a name with nothing behind it is told, by serve and by the loop alike.
const unserved = (name: string) =>
  `There is no tool called "${name}" here. Answer without it and do not mention this.`;

/* The one place a tool name becomes work — a switch, so what she can do is one
   enumerable list. Nothing here throws: an exception in the loop costs the
   answer, not the tool. An unknown name is answered, never dropped, because a
   tool_use without its tool_result is a 400 on the next request. Exported so a
   test can drive every tool against a refusing database. */
export async function serve(name: string, input: any): Promise<string> {
  switch (name) {
    case TRADES_TOOL.name:   return await readTrades(input.days);
    case CHECK_TOOL.name:    return await checkAdherence(input.days);
    case STATS_TOOL.name:    return await readStats(input.days);
    case NOTES_TOOL.name:    return await writeNote(input.note, input.kind, input.supersedes);
    case SEARCH_TOOL.name:   return await searchMemory(input.query);
    case STRATEGY_TOOL.name: return readStrategy(input.section);
    case CHANNEL_TOOL.name:  return await setChannel(input.channel, input.state, input.evidence);
    case MARKET_TOOL.name:   return await readMarket();
    case AROUND_TOOL.name:
      return (await Promise.all([aroundBlock(), ratesBlock(), headlinesBlock(WIRES_CHAT_MIN),
                                 positioningBlock()])).join("").trim();
    case ACTUAL_TOOL.name:   return await recordActual(input.at, input.name, input.actual, input.note);
    case THESIS_TOOL.name:   return await setThesis(input.thesis);
    case LOOP_TOOL.name:     return await openLoop(input.kind, input.body);
    case CLOSE_TOOL.name:    return await closeLoop(input.id, input.resolution);
    default:
      console.error(`doji-eugenia: no handler for tool "${name}"`);
      return unserved(name);
  }
}

/* `label` names the caller: eugenia_runs files the row under it and modelFor
   picks the model from it, so one string decides what ran and what it is filed
   as. Effort alone cannot tell the callers apart. Exported so a test can drive
   the loop against a stubbed fetch. */
export async function ask(messages: Turn[], effort: Effort, label: string,
                          tools: unknown[] = CHAT_TOOLS): Promise<string> {
  // Derived, so a caller cannot run one model and be recorded under another.
  const model = modelFor(label);
  const offered = new Set(tools.map((t: any) => t.name));
  const convo: any[] = withClock(messages);
  // Carried forward and never cleared: it outlives the round that opened it.
  let container: string | undefined;
  // Summed across rounds: the unit worth knowing is the turn.
  let inTok = 0, outTok = 0, cached = 0, searches = 0, fetches = 0;
  /* Cache writes, the expensive side of the cache — 1.25× at five minutes, 2×
     at an hour — kept apart because their sum is not money. The five-minute
     figure is the remainder, so a vendor that stops itemising shows up as
     wrong rather than as a cache costing nothing. */
  let wrote1h = 0, wrote5m = 0;
  // Set when `fallbacks` fired: the message was then written by a model
  // nothing here named, and reads exactly like one that was not. Kept once set.
  let fellBack = "";
  // For the row; `rounds` outlives the loop so a turn that died says where.
  const started = Date.now();
  let rounds = 0;
  // What the rounds were spent on — the client-tool half of the tally, beside
  // the server tools. A count of rounds could not say.
  const called: Record<string, number> = {};
  const toolLine = () =>
    Object.entries(called).map(([name, n]) => `${name}×${n}`).join(', ') || null;
  // One row for both endings, so the turn that threw is filed like the one that
  // finished.
  const run = (ok: boolean, detail: string | null) => recordRun({
    caller: label, model, effort, rounds: rounds || null, in_tokens: inTok, cached,
    wrote_1h: wrote1h, wrote_5m: wrote5m,
    out_tokens: outTok, searches, fetches, fell_back: fellBack || null,
    ms: Date.now() - started, ok, detail,
  });
  // The tool_result carrying the loop's cache breakpoint.
  let marked: any;

  try {
  while (rounds < MAX_ROUNDS) {
    rounds++;
    const body = await call(convo, effort, tools, model, container);
    container = body.container?.id ?? container;

    const used = body.usage ?? {};
    inTok    += used.input_tokens ?? 0;
    outTok   += used.output_tokens ?? 0;
    cached   += used.cache_read_input_tokens ?? 0;
    /* Fetches are summed from whatever `*_requests` keys come back beyond the
       search, rather than from a key name this file guesses — a wrong guess
       reads 0 for ever. Apart from searches, being a different tariff. */
    const server = used.server_tool_use ?? {};
    searches += server.web_search_requests ?? 0;
    fetches  += Object.entries(server)
      .filter(([k]) => k !== "web_search_requests" && k.endsWith("_requests"))
      .reduce((n, [, v]) => n + (typeof v === "number" ? v : 0), 0);
    const madeCache = used.cache_creation_input_tokens ?? 0;
    const hour = used.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    wrote1h  += hour;
    wrote5m  += madeCache - hour;
    // Against what this caller asked for, or every Sonnet call reads as a
    // fallback.
    if (body.model && body.model !== model) fellBack = body.model;
    // The whole fallback chain declined: no usable content.
    if (body.stop_reason === "refusal") {
      throw new Error(`Claude declined: ${body.stop_details?.category ?? "unknown"}`);
    }

    /* A paused turn has not ended: the server's search loop stops at ten
       iterations with pause_turn. Sent back as it stands, it resumes; read as
       an ending, a preamble went out as the briefing. It costs a round. */
    if (body.stop_reason === "pause_turn") {
      convo.push({ role: "assistant", content: body.content });
      continue;
    }

    // Cut off is not an answer: thrown, so each caller's own failure path runs.
    if (body.stop_reason === "max_tokens") {
      throw new Error("Claude was cut off at max_tokens");
    }

    if (body.stop_reason === "tool_use") {
      convo.push({ role: "assistant", content: body.content });

      // All results in one message, served at once: a round costs its slowest
      // tool rather than the sum. Mapped, so the order is stable.
      const calls = (body.content ?? []).filter((b: any) => b.type === "tool_use");
      for (const c of calls) called[c.name] = (called[c.name] ?? 0) + 1;
      // Only what this caller was offered, so a tool set is a guarantee: only
      // the pass moves a rung or closes a thread, only a look files a print.
      const results = await Promise.all(calls.map(async (b: any) => ({
        type: "tool_result", tool_use_id: b.id,
        content: offered.has(b.name) ? await serve(b.name, b.input ?? {}) : unserved(b.name),
      })));

      if (!results.length) throw new Error("tool_use with no tool call in it");

      /* A breakpoint on the newest result, so the next round reads everything
         so far from the cache instead of buying it again. It moves rather than
         accumulates — a request may carry four. Five minutes: rounds are
         seconds apart and nothing reads it after the turn. */
      if (marked) delete marked.cache_control;
      marked = results[results.length - 1];
      marked.cache_control = { type: "ephemeral" };

      convo.push({ role: "user", content: results });
      continue;
    }

    const text = (body.content ?? [])
      .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (!text) throw new Error("Claude returned no text");
    // The console line to watch one turn; the row, because nobody reads Edge
    // logs. The catch records the turns that never got here.
    console.log(`doji-eugenia: ${label} — ${model}, ${rounds} round(s), ${effort} effort, ` +
                `${inTok} in (${cached} cached, ${wrote1h}+${wrote5m} written), ` +
                `${outTok} out, ${searches} search(es), ${fetches} fetch(es)` +
                (fellBack ? `, FELL BACK TO ${fellBack}` : ""));
    await run(true, toolLine());
    return text;
  }
  throw new Error(`tool loop did not settle in ${MAX_ROUNDS} rounds`);
  } catch (err) {
    // A failed turn is a row too — the one that never existed. Rethrown.
    await run(false, [why(err), toolLine()].filter(Boolean).join(' · tools: ').slice(0, 500));
    throw err;
  }
}

/* Never throws and never blocks the answer: a delivered briefing must not be
   lost to an instrumentation insert. A row is for an absence nobody would
   otherwise notice. Nothing reads it back into her context. */
async function recordRun(row: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_runs`, {
      method: "POST", headers: sbHeaders("return=minimal"), body: JSON.stringify([row]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("doji-eugenia: run not recorded —", why(err));
  }
}

/* ─── Telegram and history ─────────────────────────────────────────────── */

const tg = (method: string, body: unknown) => telegram(BOT_TOKEN, method, body);

// One message per chunk, sequentially — Telegram does not promise order. A
// keyboard rides on the last part only.
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

/* Twelve turns, oldest first: the briefing a follow-up follows and the
   exchange since, keeping a one-line question cheap.

   It must open on a user turn or the API refuses every reply. Pairs are written
   in one INSERT, but a concurrent one can take a sequence value between them,
   so the shape is repaired rather than assumed. Exported because it is the
   decision.
   ───────────────────────────────────────────────────────────────────────── */
const HISTORY = 12;

export function openOnUser(turns: Turn[]): Turn[] {
  const first = turns.findIndex(t => t.role === 'user');
  return first === -1 ? [] : turns.slice(first);
}

async function recent(): Promise<Turn[]> {
  const rows = await readRows<Turn & { created_at: string }>('History',
    `eugenia_turns?select=role,content,created_at&order=id.desc&limit=${HISTORY}`);
  return openOnUser(dateTurns(rows.reverse()));
}

/* Which of her messages a swipe-reply answers. A voice note carries no text
   and history dates turns by day, so it is found by time: the earliest
   assistant row at or after the send — every caller but the briefing stores
   after sending. Five minutes covers several voice notes. Exported because it
   is the decision. */
const atSecond = (s: number) => new Date(s * 1000).toISOString();

export function repliedQuery(sent: number): string {
  return `eugenia_turns?select=content&role=eq.assistant` +
         `&created_at=gte.${atSecond(sent)}&created_at=lte.${atSecond(sent + 300)}` +
         `&order=created_at.asc&limit=1`;
}

/* The briefing is stored before it is sent, so the look above misses it. Asked
   only when that finds nothing, back across the speaking worker's budget, and
   taken only if the newest two rows are a briefing and its marker sharing an
   instant: no quote is the direction to fail in. */
export function spokenQuery(sent: number): string {
  return `eugenia_turns?select=role,content,created_at` +
         `&created_at=gte.${atSecond(sent - SPEAK_WORKER_MS / 1000 - 60)}` +
         `&created_at=lte.${atSecond(sent)}&order=id.desc&limit=2`;
}

export function spokenBriefing(rows: (Turn & { created_at: string })[]): string | null {
  const [text, marker] = rows;
  return text?.role === 'assistant' && marker?.role === 'user' &&
         marker.created_at === text.created_at &&
         [briefingMarker('weekday'), briefingMarker('sunday')].includes(String(marker.content))
    ? String(text.content) : null;
}

/* Every caller reaches this after sending, so the embedding costs him nothing.
   The pair is one INSERT, for openOnUser's reason. */
async function remember(turns: Turn[]) {
  const vecs = await embed(turns.map(t => String(t.content))).catch(() => null);
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_turns`, {
    method: "POST", headers: sbHeaders("return=minimal"),
    body: JSON.stringify(vecs ? turns.map((t, i) => ({ ...t, embedding: vecs[i] })) : turns),
  });
  if (!res.ok) throw new Error(`History write failed (HTTP ${res.status})`);
}

export interface Sweep { filled: number; left: number }

/* A night's sweep, in the form that parts three repairs. A refusing vendor
   throws and names itself. embed() returns null on an unset key alone, so
   nothing filled against a backlog is an exact statement about the key. A
   drained archive reads `0 filled, 0 left` and accuses nobody, or the line
   fires every night and stops being read. */
export function sweepLine(notes: Sweep, turns: Sweep): string {
  const counts = (s: Sweep) => `${s.filled} filled, ${s.left} left`;
  const line = `notes ${counts(notes)} · turns ${counts(turns)}`;
  return notes.filled + turns.filled === 0 && notes.left + turns.left > 0
    ? `${line} — nothing filled against a backlog, so EMBED_KEY is unset`
    : line;
}

/* ─── What the vendor missed ───────────────────────────────────────────────
   Rows with no embedding — everything before 007, and any whose vendor call
   failed — are never found by meaning, silently. One PATCH per row, for
   EMBED_BATCH's reason. count=exact makes it resumable: repeat until it
   answers zero. Newest first: an outage's fortnight should come back before
   last month's archive, being what he is likeliest to ask about.
   ───────────────────────────────────────────────────────────────────────── */
async function fillEmbeddings(table: string, column: string): Promise<Sweep> {
  const res = await fetch(
    `${SB_URL}/rest/v1/${table}?select=id,${column}&embedding=is.null&order=id.desc&limit=${EMBED_BATCH}`,
    { headers: sbHeaders("count=exact") });
  if (!res.ok) throw new Error(`${table} read failed (HTTP ${res.status})`);

  const rows = await res.json() as Record<string, any>[];
  const left = Number(res.headers.get('content-range')?.split('/')[1] ?? rows.length);
  if (!rows.length) return { filled: 0, left: 0 };

  const vecs = await embed(rows.map(r => String(r[column])));
  // Not caught: a refusing vendor's reason reaches the door's answer. Only an
  // unset key arrives here, and then the rows wait for it.
  if (!vecs) return { filled: 0, left };

  for (const [i, row] of rows.entries()) {
    const done = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${row.id}`, {
      method: "PATCH", headers: sbHeaders("return=minimal"),
      body: JSON.stringify({ embedding: vecs[i] }),
    });
    if (!done.ok) throw new Error(`${table} embedding write failed (HTTP ${done.status})`);
  }
  return { filled: rows.length, left: left - rows.length };
}

async function postEmbed(): Promise<Response> {
  // Sequential: nothing gained by a hundred PATCHes in flight.
  const notes = await fillEmbeddings('eugenia_notes', 'note');
  const turns = await fillEmbeddings('eugenia_turns', 'content');
  return json({ ok: true, notes, turns });
}

/* ─── And everything she writes is spoken ──────────────────────────────────
   He listens because his hands are busy, so every message she composes goes as
   a voice note, on every path. The transcript is what is kept, and the text is
   what goes when the audio does not land — see sayAloud.
   ───────────────────────────────────────────────────────────────────────── */
const TTS_URL   = env("TTS_URL") || "https://api.openai.com/v1/audio/speech";
const TTS_KEY   = env("TTS_KEY");
// From the environment, unlike EMBED_MODEL: nothing is stored, so a change
// alters one message, and the voice is his to change. The two are coupled —
// `tts-1` serves fewer voices and takes no instruction — so the defaults are
// the current model's own pairing.
const TTS_MODEL = env("TTS_MODEL") || "gpt-4o-mini-tts";
const TTS_VOICE = env("TTS_VOICE") || "marin";

/* How it is read is the product, so it is pinned where the voice is not: a
   breathless read of a deliberately calm paragraph contradicts the prompt.

   It says what TO do, because prohibitions alone produced the null reading —
   every sentence the same length and contour, which is what robotic means. The
   arc sits at the paragraph rather than the sentence: WRITING's short, even
   sentences would make a per-sentence fall a metronome. Pronunciation is
   spelled out for the codes she reads back (08:30 ET, R-11, a comma'd level)
   rather than rewriting the text, which must stay what is stored. Spanish is
   asked for as native code-switching: careful Spanish is the gringo tell. */
const TTS_STYLE = `Voice: a colleague reading something over to one person who is
busy. Low and warm, certain of what she is saying, with nothing to sell.

Shape: a paragraph is one arc, not four separate readings. The sentences are
short and nearly all of them are the same length, so giving each one the same
rise and fall is exactly what makes a read sound counted out. Carry the thought
across them. Start the second and third lower than the first, and let only the
last sentence of a paragraph really land — the ones before it stay open, because
something is still coming.

Pace: the rests do the work the sentence lengths cannot. Vary the gap between
sentences, and take a full breath at a blank line. Inside a sentence, slow across
a number or a name he has to catch, and let the plain words run.

Emphasis: one word in a sentence carries it. Land on that and let the rest fall
away. Never lift at the end of a line, and never read it like a news bulletin.

Say a number, a time or a code the way a person says it out loud: "08:30 ET" is
"eight thirty Eastern", "R-11" is "rule eleven", "$4,412.50" is "four thousand
four hundred and twelve dollars fifty".

Spanish: she is bilingual and switches the way bilingual people do. A Spanish
word is said in native Latin American Spanish — pure short vowels, a tapped r,
the stress where Spanish puts it: "claro" is never "clair-oh", "jefesito" is
heh-feh-SEE-toh. Say it at speed and without care, the way anyone says their
own language; slowing down to get it right is exactly what sounds foreign. Then
straight back to her ordinary English, with no accent carried across.`;

/* A chunk size, not a cap: a cap decides some messages are not worth hearing,
   and he decided none are. The vendor takes a bounded input, so a long message
   is several voice notes, split by `chunk` into whole thoughts. */
const TTS_LIMIT = 4000;

/* His number: at 1.0 he was playing every note at 1.5× and calling that a
   shade fast. It may be silently ignored — gpt-4o-mini-tts has been reported
   to disregard `speed` — and nothing here can see it; if the tempo is
   unchanged, ask for pace in TTS_STYLE instead. */
const TTS_SPEED = 1.3;

/* The voice gets a budget, and the text is what is left when it runs out. A
   speech request that never answered once outlived the worker, which was
   killed with no catch, no row and no retry. One budget per message, not per
   request, which would multiply by the parts; 150s is the slowest speaking
   that ever landed.

   The briefing speaks in a second worker (`?speak=`) with its own clock, so a
   slow morning in writing or speaking is not taken out of the other. */
const SPEAK_MS = 150_000;
const SPEAK_WORKER_MS = 330_000;

/* A part that does not land gets one more attempt, each bounded: a stall is
   one request, and the next is a fresh connection. On SPEAK_MS only a quick
   refusal gets its second try. */
const ATTEMPT_MS = 150_000;

/* Never throws and never messages him: any failure answers false and the text
   goes instead. Its own fetch, sendVoice being multipart. Ogg/opus, because the
   default mp3 works and arrives as a file attachment rather than a voice note,
   with nothing erroring. */
async function speak(answer: string, keyboard: unknown, signal: AbortSignal): Promise<boolean> {
  if (!TTS_KEY) return false;

  try {
    const spoken = await fetch(TTS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${TTS_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Markdown stripped at the boundary: no parse mode is sent, yet a model
        // writes a bold label in a list anyway, and an asterisk read aloud is
        // a gamble.
        model: TTS_MODEL, voice: TTS_VOICE, speed: TTS_SPEED,
        input: answer.replace(/\*\*|__|\*|_/g, '').replace(/^[·•]\s*/gm, ''),
        instructions: TTS_STYLE, response_format: "opus",
      }),
      signal,
    });
    if (!spoken.ok) throw new Error(`speech HTTP ${spoken.status}`);

    const form = new FormData();
    form.append("chat_id", CHAT_ID);
    // Type and filename both: which one Telegram reads is not knowable.
    form.append("voice", new Blob([new Uint8Array(await spoken.arrayBuffer())],
                                  { type: "audio/ogg" }), "reply.ogg");
    // The briefing's keyboard rides on the voice note, as JSON in the field.
    if (keyboard) form.append("reply_markup", JSON.stringify(keyboard));
    const sent = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVoice`, {
      method: "POST", body: form, signal,
    });
    const said = await sent.json();
    if (!said?.ok) throw new Error(`sendVoice: ${said?.description ?? "unknown"}`);
    return true;
  } catch (err) {
    console.error("doji-eugenia: could not speak —", why(err));
    return false;
  }
}

/* The voice note is the message and the text its fallback — both went for a
   day, two notifications for one thing said. Audio-only would turn a refusing
   vendor or an unset key into a missing message, so the text is sent, in full,
   whenever any part did not land. What is stored is unaffected.

   Not `say` itself, which keeps three things silent: the /notes audit, the
   apologies, and short operational lines. Exported so the fallback is driven —
   with no TTS key every speak answers false, a refusing vendor's shape — with
   the budget a parameter so a stall needs no waiting out. */
export async function sayAloud(words: string, keyboard?: unknown, budget = SPEAK_MS): Promise<boolean> {
  const parts = chunk(words, TTS_LIMIT);
  const signal = AbortSignal.timeout(budget);
  let heard = parts.length > 0;
  // Sequentially, keyboard on the last part, as in say().
  for (const [i, part] of parts.entries()) {
    const marked = i === parts.length - 1 ? keyboard : undefined;
    let landed = false;
    for (let attempt = 0; attempt < 2 && !landed && !signal.aborted; attempt++) {
      landed = await speak(part, marked, AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_MS)]));
    }
    if (!landed) heard = false;
  }
  // Any part missing: three quarters of a message cannot be acted on.
  if (!heard) await say(words, keyboard);
  return heard;
}

/* ─── What she brings to a turn ────────────────────────────────────────────
   Folded into the opening user message rather than a mid-conversation system
   message, whose request shape could not be exercised here — and a 400 there
   kills every reply. Nothing in it is untrusted. remember() stores the raw
   message, so a preamble is never resent as history.
   ───────────────────────────────────────────────────────────────────────── */

/* ─── What time it is ─────────────────────────────────────────────────────
   She has no clock otherwise: asked something at 23:42 with this morning's
   briefing the freshest thing in context, she said "morning". The trust clause
   is load-bearing for that reason. h23, or midnight reads "24:05".
   ───────────────────────────────────────────────────────────────────────── */
const nyStamp = (now: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', weekday: 'long', day: 'numeric', month: 'long',
  year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(now);

export const nowBlock = (now = new Date()) =>
  `\n\n[Right now it is ${nyStamp(now)} in New York. Trust this over anything ` +
  `the conversation above implies about the time or the date.]`;

/* The clock goes on in one place, so no caller can forget it — removing it
   from one path once left every test green. On the last user turn, a copy;
   the stored turn stays raw. A turn may be blocks (a chart he sent), where
   string concatenation gives "[object Object]", so it goes on as a trailing
   text block. Exported because it is the decision. */
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

/* History is dated too, or "yesterday you said" is a guess across a weekend.
   The user turn of each pair only: prefixing her own words reads as though
   she wrote the date. */
const shortDay = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short',
}).format(d);

export function dateTurns(rows: (Turn & { created_at: string })[]): Turn[] {
  return rows.map(({ role, content, created_at }) => role === 'user'
    ? { role, content: `[${shortDay(new Date(created_at))}] ${content}` }
    : { role, content });
}

/* Optional: a database blip costs her the memory, not the briefing. Logged,
   because a bot that stopped remembering reads like one with nothing to
   remember. The kinds are labelled apart, so an instruction is never weighed
   against an observation. */
export async function notesBlock(): Promise<string> {
  try {
    const [told, promised, noticed] = await Promise.all([
      readNotes('instruction'), readNotes('commitment'), readNotes('fact'),
    ]);
    const list = (ns: Note[]) => `\n· ` + ns.map(noteLine).join("\n· ");
    return (told.length
             ? `\n\nWhat he has told you to do, newest first. These are not optional and a` +
               ` later one replaces an earlier one:${list(told)}`
             : "")
         + (promised.length
             ? `\n\nWhat he has committed to, newest first. Hold his trades against these` +
               ` and say so plainly when one broke one:${list(promised)}`
             : "")
         + (noticed.length
             ? `\n\nWhat you have noticed about him, newest first:${list(noticed)}`
             : "");
  } catch (err) {
    console.error("doji-eugenia: notes unavailable —", why(err));
    return "";
  }
}

type Channel = { channel: string; state: string; evidence: string | null; moved_on: string | null };

/* The same rows rendered for him — his only window into a memory he writes to
   and could not read. A wrong fact that says he understands something makes
   her stop explaining it, an absence nobody notices. The ids are how he says
   which note is wrong.

   The whole audit is rendered here, in his second person, rather than
   appending blocks written to her. And a failed read costs the whole reply,
   which is right for an audit: one that silently omits half of itself is the
   defect it exists to prevent. Pure; the read stays with the caller. */
export function notesList(told: Note[], noticed: Note[], channels: Channel[],
                          loops: Loop[] = [], story: Thesis | null = null,
                          promised: Note[] = []): string {
  const list = (ns: Note[]) => ns.map(noteLine).join("\n");
  // Not loopsList, which is written to her about her own threads.
    const open = (kind: string, heading: string) => {
      const rs = loops.filter(l => l.kind === kind);
      return rs.length
        ? `${heading}\n${rs.map(l => `[${l.id}] ${l.body} (since ${civilDay(l.opened_on)})`).join("\n")}`
        : "";
    };
  return [
    told.length     ? `What you have told me, newest first:\n${list(told)}`         : "",
    promised.length ? `What you have committed to, newest first:\n${list(promised)}` : "",
    noticed.length  ? `What I have noticed, newest first:\n${list(noticed)}`        : "",
    told.length || promised.length || noticed.length ? "" : "I have not kept any notes yet, jefe.",
    open('watch',    "What I flagged and am still watching:"),
    open('question', "What I asked you and have not had back:"),
    story ? `The story I am carrying${story.moved_on ? `, last moved ${civilDay(story.moved_on)}` : ""}:\n${story.thesis}` : "",
    `Where you stand on each channel:\n${channelsList(channels)}`,
  ].filter(Boolean).join("\n\n");
}

/* A stored New York civil day, shown as itself: re-zoned, `2026-03-12` is
   midnight UTC and reads as the 11th. Formatted in UTC off a midday anchor. */
const civilDay = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short',
}).format(new Date(`${iso}T12:00:00Z`));

/* ─── The one rung he can move himself ───────────────────────────────────────
   The ladder climbs on him using a term back, so a reader who rarely answers
   sat at `explained` for ever — the rung that restates the mechanism every
   time. Her reading of him still needs the pass; this is him saying where he
   is, which has the standing a demotion has. Exported and pure, because the
   parse is the whole of it.
   ─────────────────────────────────────────────────────────────────────────── */
export function parseChannel(text: string): { channel: string; state: string } | string | null {
  const words = text.trim().split(/\s+/);
  if (words[0].toLowerCase() !== '/channel') return null;
  const said = words.slice(1).join(' ').trim();
  if (!said) {
    return `Say which and where, jefe — /channel <${CHANNELS.map(([c]) => c).join('|')}> ` +
           `<${CHANNEL_STATES.slice(1).join('|')}>.`;
  }

  // The rung is the last word and the channel the rest: three spoken names are
  // several words long.
  const to = words[words.length - 1].toLowerCase();
  const wanted = words.slice(1, -1).join(' ').toLowerCase();
  if (!(CHANNEL_STATES as readonly string[]).includes(to)) {
    return `"${to}" is not a rung. They are ${CHANNEL_STATES.join(", ")}.`;
  }

  // The id or the spoken name, since /notes prints the names.
  const hit = CHANNELS.find(([id, name]) =>
    id.toLowerCase() === wanted || name.toLowerCase() === wanted);
  if (!hit) {
    return `I do not have a channel called "${wanted}". They are:\n` +
           CHANNELS.map(([id, name]) => `· ${id} — ${name}`).join("\n");
  }
  return { channel: hit[0], state: to };
}

/* In prompt.ts's order, so the list is stable and a rung never seems to move.
   A channel with no row shows at the bottom rung rather than vanishing — this
   block exists to make absence visible. Each rung carries the day it last
   moved: the ladder only climbs, so without the date a year of use piles
   everything at `owns` and a rung from March reads like last night's. */
export function channelsList(rows: Channel[]): string {
  const byId = new Map(rows.map(r => [r.channel, r]));
  return CHANNELS.map(([id, name]) => {
    const row = byId.get(id);
    const state = row?.state ?? CHANNEL_STATES[0];
    const since = row?.moved_on ? ` since ${civilDay(row.moved_on)}` : "";
    return `· ${name} — ${state}${since}${row?.evidence ? ` (${row.evidence})` : ""}`;
  }).join("\n");
}

/* The read, apart from both renderings — one speaks to her, one to him. */
async function readChannels(): Promise<Channel[]> {
  return readRows<Channel>('Channels',
    // A limit that can never bite — the key sits on a five-value check — kept
    // because every read here carries one.
    `eugenia_channels?select=channel,state,evidence,moved_on` +
    `&limit=${CHANNELS.length}`);
}

/* Optional, as notesBlock is. */
export async function channelsBlock(): Promise<string> {
  try {
    return `\n\nWhere he stands on each channel:\n${channelsList(await readChannels())}`;
  } catch (err) {
    console.error("doji-eugenia: channels unavailable —", why(err));
    return "";
  }
}

// Seven days handed over unasked, saving a tool round; the same read, no new
// reach.
export async function tradesBlock(): Promise<string> {
  return `\n\nHis trades this past week:\n${await readTrades(7)}`;
}

/* ─── What his trades broke since the last briefing ────────────────────────
   Since the last briefing that went out, rather than "yesterday": on a Monday
   yesterday is Sunday, and Friday's breaches went unraised. Computed, not read
   off the rows by eye — and this is §8's moment for the marker that says he
   followed a rule the row says he broke. A sentence only when something broke.

   Closed trades only: a verdict on an open one is prohibited. A trade counts if
   its day began since that briefing or it closed since — the Friday hold
   closed on Monday, R-15's case. Narrowing can lose a day-level failure on a
   partial day, never invent one.
   ───────────────────────────────────────────────────────────────────────── */
const BREACH_DAYS = 7;

export function sinceBriefing(t: TradeRow, at: string): boolean {
  if (!isBroker(t) || isOpen(t)) return false;
  return (t.open_day ?? '') >= nyDate(new Date(at)) ||
         (!!t.fill_time && Date.parse(t.fill_time) >= Date.parse(at));
}

export function breachesList(results: RuleResult[] | null): string {
  if (!results) return "";
  const broke = results.filter(r => r.verdict === 'fail');
  if (!broke.length) {
    return "\n\nNo closed trade since your last briefing broke a rule a row can check.";
  }
  return `\n\nRules his closed trades broke since your last briefing, computed from the rows:\n` +
         adherenceList(broke);
}

export async function breachesBlock(): Promise<string> {
  try {
    const [last] = await readRows<{ created_at: string }>('Briefing marker',
      briefedQuery());
    const at = last?.created_at ?? new Date(Date.now() - 86_400_000).toISOString();
    const { results, reach } = await readRules(BREACH_DAYS, t => sinceBriefing(t, at));
    return breachesList(results) + reach;
  } catch (err) {
    console.error("doji-eugenia: breaches unavailable —", why(err));
    return "\n\nWhich rules his recent trades broke could not be checked just now. Say nothing about a broken rule rather than working it out from the rows.";
  }
}

/* ─── The running story, the open threads, and the day's calendar ──────────
   One idea: a briefing that starts from nothing could have been written on any
   morning. Optional and logged, as the other blocks are.
   ───────────────────────────────────────────────────────────────────────── */
type Thesis = { thesis: string; moved_on: string | null };

async function readThesis(): Promise<Thesis | null> {
  const [row] = await readRows<Thesis>('Thesis',
    `eugenia_thesis?select=thesis,moved_on&id=eq.current&limit=1`);
  return row ?? null;
}

/* Dated, so a thesis never moved in three weeks does not read like last
   night's — formatted as civilDay is. */
export function thesisLine(row: Thesis | null): string {
  if (!row) return "";
  const since = row.moved_on ? ` (last moved ${civilDay(row.moved_on)})` : "";
  return `\n\nThe story you have been carrying${since}:\n${row.thesis}`;
}

export async function thesisBlock(): Promise<string> {
  try {
    return thesisLine(await readThesis());
  } catch (err) {
    console.error("doji-eugenia: thesis unavailable —", why(err));
    return "";
  }
}

/* ─── Whether the journal is still being written ────────────────────────────
   The poller and the email function have no voice, and either dying looks like
   a week he did not trade. sync_health is their heartbeat and this its one
   reader. Six hours against the two-minute poll: shorter and a quiet Sunday
   reads as a fault, longer and a Monday outage reaches him Tuesday. A fact
   about his instruments, so she leads with it.
   ─────────────────────────────────────────────────────────────────────────── */
const STALE_HOURS = 6;

const WRITERS: Record<string, string> = {
  poller: "the broker sync",
  email:  "the fill emails",
};

/* The two writers cannot be judged alike. The poller is scheduled, so its
   silence is evidence; the email function runs only on a fill, so its silence
   is a quiet week. Silence is read for the scheduled writer only; the outcome
   of the LAST run is read for both. */
const SCHEDULED = new Set(["poller"]);

type Health = {
  id: string; last_ok: string | null; last_error: string | null; last_error_at: string | null;
};

const stamp = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export function healthLine(rows: Health[], now = Date.now()): string {
  const when = (s: string | null) => (s ? Date.parse(s) : NaN);

  const bad = rows.filter(r => {
    const ok = when(r.last_ok), failed = when(r.last_error_at);
    // Last outcome a failure; `!(ok > failed)` also counts a writer that has
    // never succeeded.
    if (Number.isFinite(failed) && !(ok > failed)) return true;
    return SCHEDULED.has(r.id) &&
      (!Number.isFinite(ok) || now - ok > STALE_HOURS * 3600_000);
  });
  if (!bad.length) return "";

  return "\nHis journal is not being written:\n" + bad.map(r => {
    const name = WRITERS[r.id] ?? r.id;
    const failing = r.last_error_at && !(when(r.last_ok) > when(r.last_error_at));
    // A writer erroring has a reason he can see; one nobody calls has not.
    return failing
      ? `· ${name} failed at ${stamp(r.last_error_at!)}: ${r.last_error ?? "no detail recorded"}`
      : `· ${name} ${r.last_ok ? `last completed a run at ${stamp(r.last_ok)}`
                               : "has never completed a run"}`;
  }).join("\n") +
  "\nSay this first, plainly. Trades may be missing from everything below.";
}

export async function healthBlock(): Promise<string> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/sync_health?select=id,last_ok,last_error,last_error_at` +
      `&order=id.desc&limit=5`,
      { headers: sbHeaders() });
    // Without 008 this is a 404, and the feature is simply inert.
    if (!res.ok) return "";
    return healthLine(await res.json());
  } catch (err) {
    console.error("doji-eugenia: health unavailable —", why(err));
    return "";
  }
}

type Loop = { id: number; kind: string; body: string; opened_on: string };

// Ten is more than a fortnight of one a briefing; a longer list is itself the
// finding — threads have stopped closing.
const LOOPS = 10;

async function readLoops(): Promise<Loop[]> {
  return readRows<Loop>('Loops',
    `eugenia_loops?select=id,kind,body,opened_on` +
    `&closed_on=is.null&order=id.desc&limit=${LOOPS}`);
}

/* The id carried so a thread can be closed; the kinds apart, because a watch
   resolves in the world and a question in him. Pure. */
export function loopsList(rows: Loop[]): string {
  if (!rows.length) return "";
  const of = (kind: string) => rows.filter(r => r.kind === kind);
  const list = (rs: Loop[]) => rs.map(r => `· [${r.id}] ${r.body} (opened ${civilDay(r.opened_on)})`).join("\n");
  const watch = of('watch'), asked = of('question');
  return (watch.length ? `\n\nWhat you flagged and has not resolved:\n${list(watch)}` : "")
       + (asked.length ? `\n\nWhat you asked him and he has not answered:\n${list(asked)}` : "");
}

export async function loopsBlock(): Promise<string> {
  try {
    return loopsList(await readLoops());
  } catch (err) {
    console.error("doji-eugenia: loops unavailable —", why(err));
    return "";
  }
}

type Release = {
  id: number; at: string; name: string; importance: string;
  consensus: string | null; prior: string | null; actual: string | null; note: string | null;
  looked_at?: string | null; ticker?: string | null;
};

// The columns every calendar read asks for; the spine adds the two optional ones.
const RELEASE_COLUMNS = "id,at,name,importance,consensus,prior,actual,note";

/* Read earliest first, so a day too heavy for the bound loses the
   furthest-ahead rows, which tomorrow's briefing reads anyway. A full read
   says it stopped. */
const CAL_ROWS = 40;

async function readCalendar(now = Date.now()): Promise<Release[]> {
  const from = new Date(now - CAL_BACK * 3600_000).toISOString();
  const to   = new Date(now + CAL_AHEAD * 3600_000).toISOString();
  return readRows<Release>('Calendar',
    `eugenia_calendar?select=${RELEASE_COLUMNS}` +
    `&at=gte.${from}&at=lte.${to}&order=at.asc&limit=${CAL_ROWS}`);
}

// ET, the clock the prompt has her speak in.
const nyTime = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

/* Three states, by `actual` and the clock: landed, past with no figure — every
   speech, and any print not yet published — and due. Rendering a past row as
   due had her describe a print as still to come. A line from another day names
   the day, or tomorrow's 08:30 and today's read alike, and the weekday is
   given rather than left to her arithmetic. */
const weekday = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', weekday: 'long',
}).format(new Date(`${iso}T12:00:00Z`));

export function calendarList(rows: Release[], now = Date.now(),
                             heading = "The calendar around now, as TradingView lists it"): string {
  if (!rows.length) return "";
  const today = nyDate(new Date(now));
  const lines = rows.map(r => {
    const day = nyDate(new Date(r.at));
    const head = `· ${nyTime(r.at)} ET` + (day === today ? "" : ` on ${weekday(day)} ${civilDay(day)}`) +
                 ` ${r.name}`;
    if (r.actual) {
      return `${head} — LANDED at ${r.actual}` +
             (r.consensus ? ` against ${r.consensus} expected` : "") +
             (r.note ? `. ${r.note}` : "");
    }
    if (Date.parse(r.at) <= now) return `${head} — PAST, no figure on file` + (r.note ? `. ${r.note}` : "");
    return `${head} — due` +
           (r.consensus ? `, ${r.consensus} expected` : "") +
           (r.prior ? ` after ${r.prior}` : "");
  });
  return `\n\n${heading}:\n${lines.join("\n")}`;
}

export async function calendarBlock(): Promise<string> {
  try {
    const rows = await readCalendar();
    return calendarList(rows) + (rows.length === CAL_ROWS
      ? `\n· The list stops at ${CAL_ROWS} entries, so later releases were not read. ` +
        `Do not say nothing else is due after the last one.`
      : "");
  } catch (err) {
    console.error("doji-eugenia: calendar unavailable —", why(err));
    return "";
  }
}

/* ─── The week ahead, for the briefing that opens it ───────────────────────
   The Sunday briefing's rolling calendar reaches Monday evening, so a Thursday
   CPI reached it only if a search did. It gets the week instead, high only —
   the releases R-14 stands him aside for — replacing the rolling list rather
   than sitting beside it, since one print twice reads as two things.
   ───────────────────────────────────────────────────────────────────────── */
export function weekQuery(now: number): string {
  const to = new Date(now + 7 * 86_400_000).toISOString();
  return `eugenia_calendar?select=${RELEASE_COLUMNS}` +
         `&importance=eq.${HIGH}&at=gte.${new Date(now).toISOString()}&at=lte.${to}` +
         `&order=at.asc&limit=40`;
}

export async function weekBlock(now = Date.now()): Promise<string> {
  try {
    const rows = await readRows<Release>('Week', weekQuery(now));
    return calendarList(rows, now, "The week ahead, every release TradingView rates high");
  } catch (err) {
    console.error("doji-eugenia: week unavailable —", why(err));
    return "";
  }
}

/* ─── The market around gold ───────────────────────────────────────────────
   The dollar, yields, real yield, silver, oil, the S&P and the VIX, for the
   briefing and the move look, which explain gold against them.

   Every line is a level now beside the level at a stated time, and no change
   is computed — quoteLine's lesson, applied here. The latest bar's time is
   given, a bar not being a tick; the real yield is daily and dated.

   Never throws, and a failed read is a sentence, or she reaches for a search
   page. A symbol not served is named: an absent line reads as never asked.
   ───────────────────────────────────────────────────────────────────────── */
type Around = {
  name: string; unit: string; daily: boolean;
  from: number; since: string; last: number; at: string;
};

const NO_AROUND =
  "\n\nThe market around gold could not be read just now. Do not quote the dollar " +
  "or yields from a search; say you do not have them.";

export function aroundList(answer: { market: Around[]; missing: { name: string }[] }, now = Date.now()): string {
  const today = nyDate(new Date(now));
  const figure = (v: number, unit: string) => unit === "%" ? `${v}%` : unit === "$" ? `$${v}` : `${v}`;
  const when = (iso: string) => {
    const day = nyDate(new Date(iso));
    return `${nyTime(iso)} ET` + (day === today ? "" : ` on ${civilDay(day)}`);
  };
  const lines = answer.market.map(m => m.daily
    ? `· ${m.name} ${figure(m.last, m.unit)} on ${civilDay(m.at.slice(0, 10))}, from ` +
      `${figure(m.from, m.unit)} on ${civilDay(m.since.slice(0, 10))} — a daily series, a day or more behind`
    : `· ${m.name} ${figure(m.last, m.unit)}, from ${figure(m.from, m.unit)} at ${when(m.since)}` +
      ` (latest bar ${when(m.at)})`);
  if (answer.missing.length) lines.push(`· Not read just now: ${answer.missing.map(m => m.name).join(", ")}.`);
  return `\n\nThe market around gold, from TradingView's hourly bars rather than live ticks:\n${lines.join("\n")}`;
}

export async function aroundBlock(): Promise<string> {
  try {
    const answer = await tvRead("market");
    if (!answer.market?.length) throw new Error("no symbol served");
    return aroundList(answer);
  } catch (err) {
    console.error("doji-eugenia: market around gold unavailable —", why(err));
    return NO_AROUND;
  }
}

/* ─── What the market prices for the Fed ───────────────────────────────────
   Worked out in doji-tradingview as FedWatch works them, and checked against
   FedWatch on 1 October — a page had twice told her "cut" in a week the Fed
   hiked. The first meeting gets its odds; later ones get the basis points
   priced by then, because FedWatch's later odds are cumulative and the fold's
   are conditional, and a December chance would disagree with the screen he
   checks. Never throws; a refused read is a failed read.
   ───────────────────────────────────────────────────────────────────────── */
type Priced = { date: string; move_bp: number; total_bp: number | null; odds: { bp: number; chance: number }[] };

export function ratesList(answer: { meetings: Priced[]; unread: string[] }): string {
  const move = (bp: number) => bp === 0 ? "no change"
    : `a ${Math.abs(bp) === 25 ? "quarter-point" : `${Math.abs(bp)}bp`} ${bp > 0 ? "hike" : "cut"}`;
  const bps = (bp: number) => `${Math.abs(Math.round(bp))} basis points of ${bp < 0 ? "cuts" : "hikes"}`;
  const lines = answer.meetings.map((m, i) => `· ${civilDay(m.date)}: ` + (i === 0
    ? [...m.odds].sort((a, b) => b.chance - a.chance).map(o => `${o.chance}% ${move(o.bp)}`).join(", ")
    : m.total_bp === null
      ? `${bps(m.move_bp)} priced at this meeting`
      : `${bps(m.total_bp)} priced in all by then, ${Math.abs(Math.round(m.move_bp))} of them at this meeting`));
  if (answer.unread.length) lines.push(`· Not read just now: ${answer.unread.map(civilDay).join(", ")}.`);
  return `\n\nWhat fed funds futures price for the next Fed meetings, worked out as CME's FedWatch ` +
    `works them, from daily bars at least fifteen minutes behind:\n${lines.join("\n")}`;
}

export async function ratesBlock(): Promise<string> {
  try {
    const answer = await tvRead("rates");
    if (!answer.meetings?.length) throw new Error("no meeting served");
    return ratesList(answer);
  } catch (err) {
    console.error("doji-eugenia: rate odds unavailable —", why(err));
    return "\n\nWhat the futures price for the Fed could not be read just now. Do not quote rate " +
      "odds from a search; say you do not have them.";
  }
}

/* ─── What the wires said ──────────────────────────────────────────────────
   Gold's and the dollar's headlines, for the look at a move nothing on the
   calendar explains. The last hour for the move look — a morning headline
   explains nothing a quarter-hour old — and six for a conversation. Titles
   only: most stories are paywalled.

   The feeds are read to a fixed count, so where one stops inside the span the
   block says how far back it reaches; a story both carry can make a feed look
   to reach later than it did, never earlier. Another day's line names it.
   ───────────────────────────────────────────────────────────────────────── */
const WIRES_MIN = 60;
const WIRES_CHAT_MIN = 6 * 60;

type Headline = { title: string; source: string; published: string; feed: string };

export function headlinesList(answer: { headlines: Headline[]; missing: { symbol: string }[] },
                              now = Date.now(), minutes = WIRES_MIN): string {
  const span = minutes === 60 ? "the last hour" : `the last ${minutes / 60} hours`;
  const today = nyDate(new Date(now));
  const when = (ms: number) => {
    const day = nyDate(new Date(ms));
    return `${nyTime(new Date(ms).toISOString())} ET` +
           (day === today ? "" : ` on ${weekday(day)} ${civilDay(day)}`);
  };
  const recent = answer.headlines.filter(h => {
    const age = now - Date.parse(h.published);
    return age >= 0 && age <= minutes * 60_000;
  });
  const gap = answer.missing.length ? " One of the two feeds could not be read." : "";
  if (!recent.length) {
    return `\n\nNo headline on gold's or the dollar's TradingView feeds in ${span}.${gap}`;
  }
  const oldest = new Map<string, number>();
  for (const h of answer.headlines) {
    oldest.set(h.feed, Math.min(oldest.get(h.feed) ?? Infinity, Date.parse(h.published)));
  }
  const reach = Math.max(...oldest.values());
  const short = now - reach < minutes * 60_000
    ? ` The feeds reach back only to ${when(reach)}, so nothing earlier in that span was read.` : "";
  return `\n\nHeadlines in ${span}, from TradingView's gold and dollar feeds — titles only, ` +
    `most stories are paywalled:\n` +
    recent.map(h => `· ${when(Date.parse(h.published))}, ${h.source}: ${h.title}`).join("\n") + gap + short;
}

export async function headlinesBlock(minutes = WIRES_MIN): Promise<string> {
  try {
    return headlinesList(await tvRead("news"), Date.now(), minutes);
  } catch (err) {
    console.error("doji-eugenia: headlines unavailable —", why(err));
    return "\n\nThe headlines could not be read just now; search for what moved it.";
  }
}

/* ─── Where the speculators stand ──────────────────────────────────────────
   The CFTC's weekly count of COMEX gold futures held by managed money, whose
   crowding is why a drop can outrun its news. Public, no credential. A Tuesday
   count released days later, so the line carries its date, and the year's
   range beside it, since crowded is relative to its own past.

   The Sunday briefing and get_around, not the move look: it changes weekly,
   and handed to a look at a quarter-hour's move it is a plausible cause that
   path is told not to invent. Never throws.
   ───────────────────────────────────────────────────────────────────────── */
const COT_URL = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json" +
  "?cftc_contract_market_code=088691&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=52" +
  "&$select=report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all," +
  "change_in_m_money_long_all,change_in_m_money_short_all";

// Strings, as the dataset sends them; one that will not parse refuses all.
type Cot = {
  report_date_as_yyyy_mm_dd: string;
  m_money_positions_long_all: string; m_money_positions_short_all: string;
  change_in_m_money_long_all: string; change_in_m_money_short_all: string;
};

export function positioningList(rows: Cot[]): string {
  const read = rows.map(r => ({
    day: r.report_date_as_yyyy_mm_dd.slice(0, 10),
    long: Number(r.m_money_positions_long_all), short: Number(r.m_money_positions_short_all),
    change: Number(r.change_in_m_money_long_all) - Number(r.change_in_m_money_short_all),
  }));
  if (!read.length || !read.every(r => [r.long, r.short, r.change].every(Number.isFinite))) {
    throw new Error("no readable report");
  }
  const n = (v: number) => v.toLocaleString('en-US');
  const net = (r: { long: number; short: number }) => r.long - r.short;
  const side = (v: number) => `${v >= 0 ? "long" : "short"} ${n(Math.abs(v))}`;
  const [latest] = read;
  const low = read.reduce((a, b) => net(b) < net(a) ? b : a);
  const high = read.reduce((a, b) => net(b) > net(a) ? b : a);
  return `\n\nWhere the speculators stand in COMEX gold futures — the CFTC's count of ` +
    `managed money (hedge funds and commodity funds), taken ${weekday(latest.day)} ` +
    `${civilDay(latest.day)} and released later that week:\n` +
    `· Net ${side(net(latest))} contracts (${n(latest.long)} long, ${n(latest.short)} short), ` +
    `${latest.change >= 0 ? "up" : "down"} ${n(Math.abs(latest.change))} on the week before.\n` +
    `· Over the ${read.length} weeks to then, net ranged from ${side(net(low))} on ` +
    `${civilDay(low.day)} to ${side(net(high))} on ${civilDay(high.day)}.`;
}

export async function positioningBlock(): Promise<string> {
  try {
    const res = await fetch(COT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return positioningList(await res.json());
  } catch (err) {
    console.error("doji-eugenia: positioning unavailable —", why(err));
    return "\n\nWhere the speculators stand could not be read just now; do not quote it from a search.";
  }
}

/* ─── What he has on, and where his day stands ─────────────────────────────
   Whether he is exposed right now, which no other block said — so a briefing
   could talk about a level he was sitting in a position through. Six paths;
   postTradeEvent is reached from the position itself.

   One read, two filters, since an overnight hold is not in today's rows and
   today's closes are not open. The civil day is read once and passed in, or
   one night a year the filter and the standing straddle midnight. `select=*`
   because the view IS the list of what she may see.
   ───────────────────────────────────────────────────────────────────────── */
async function readDesk(day: string): Promise<TradeRow[]> {
  return readRows<TradeRow>('Desk',
    `eugenia_trades?select=*` +
    `&or=(open_day.gte.${day},and(exit_price.is.null,fill_time.is.null))` +
    `&order=entry_time.desc&limit=50`);
}

/* The mark carries its age, and no unrealised P&L is computed: the price can be
   fifteen minutes old, and that figure would be the most anchoring number here
   and the one staleness gets most wrong. Entry and mark, labelled; she
   subtracts if asked. A null field is said, never printed — `from null` reads
   as a price. An entry from another day names the day: his holds run
   multi-session, and `open since 09:15 ET` on Wednesday for a Monday fill is a
   confident wrong fact about his own position. Today stays bare. */
export function positionsList(
  open: TradeRow[], standing: Standing | null, mark: Mark | null, now = Date.now(),
): string {
  const today = nyDate(new Date(now));
  const lines = open.map(t => {
    const opened = t.entry_time ? nyDate(new Date(t.entry_time)) : null;
    const since = t.entry_time
      ? `open since ${nyTime(t.entry_time)} ET` +
        (opened === today ? "" : ` on ${civilDay(opened as string)}`)
      : "open";
    const what = [t.direction, t.size_oz != null ? `${t.size_oz}oz` : null]
      .filter(Boolean).join(" ") || "side and size not recorded";
    const from = t.entry_price != null ? ` from ${t.entry_price}` : "";
    // Whichever sides were seen, and never the absence: a null is equally "he
    // set none" and "never seen open".
    const seen = [
      t.planned_sl != null ? `stop ${t.planned_sl}` : null,
      t.planned_tp != null ? `target ${t.planned_tp}` : null,
    ].filter(Boolean);
    const plan = seen.length ? `, ${seen.join(" and ")} as first seen` : "";
    return `· ${since} — ${what}${from}${plan}`;
  });

  // Only beside a position; on a flat day it is a price of nothing.
  if (lines.length && mark) {
    lines.push(`· gold was ${mark.bid} ` +
               `${Math.round((now - Date.parse(mark.at)) / 60_000)} minutes ago`);
  }

  if (standing) {
    lines.push(
      `· his day so far: ${standing.pnl.toFixed(2)} against an account of ` +
      `${standing.account.toFixed(0)} implied by his size — ` +
      `${standing.breached ? "PAST" : "inside"} the ${DAY_LOSS * 100}% R-11 sets`);
  }

  return lines.length
    ? `\n\nWhat he has on, and where his day stands:\n${lines.join("\n")}`
    : "";
}

/* Open is BOTH witnesses null. fill_time comes from the email and from the
   poller, which stamps only closes its fold window reaches; what the poller
   records on every close is exit_price. Read off fill_time alone, a close with
   no alert stayed open for ever, and this block cited R-19 and R-15 at him
   about a position gone since Wednesday. Either witness closes it — the shape
   balance and direction use. Broker rows only: pre-sync rows carry neither
   column. Exported because the filter was the half no test reached;
   positionsList renders correctly whatever it is handed. */
export const isOpen = (t: TradeRow): boolean =>
  isBroker(t) && t.exit_price === null && t.fill_time === null;

// The mark is caught on its own, so a price she cannot read costs one line
// rather than the position; read only when something is open.
export async function positionsBlock(): Promise<string> {
  try {
    const day = nyDate(new Date());
    const rows = await readDesk(day);
    const open = rows.filter(isOpen);
    return positionsList(
      open,
      dayStanding(rows, day),
      open.length ? await readMark().catch(() => null) : null);
  } catch (err) {
    console.error("doji-eugenia: positions unavailable —", why(err));
    return "";
  }
}

/* ─── The cron half: the briefing, and the quieter second look ───────────── */

/* The apology names the job. Every failure once said "No briefing", so a
   nightly pass that died — whose symptom is a memory that stops growing — sent
   him looking for a missing message. A map, so the words can be enumerated. */
export const APOLOGY: Record<string, string> = {
  briefing:     "No briefing, jefe — something broke on my side.",
  pulse:        "My second look at the morning broke, jefe. Nothing is wrong with the briefing.",
  consolidate:  "My nightly tidy-up broke, jefe. I may not have kept what today was worth keeping.",
  release:      "I could not look at the number that just landed, jefe.",
  trade:        "Something broke while I was looking at your position, jefe.",
  move:         "I lost sight of the price for a moment, jefe.",
  embed:        "I could not file what I remember for searching, jefe.",
  speak:        "Your briefing is written, jefe, but I could not send it. Ask me for it.",
};

export const apologyFor = (job: string) => APOLOGY[job] ?? APOLOGY.briefing;

/* The scheduled half. The hourly job asks dueNow what this hour owes; the
   data-driven senses and the repair doors each name theirs with a flag.
   ?force=1, ?pulse=1 and ?consolidate=1 run now whatever the clock says — a
   re-run after a failure, and the only way to see the nightly pass, which
   sends nothing. */
async function postScheduled(url: URL): Promise<Response> {
  // Named before the work so the catch can say which job died.
  let job = 'briefing';
  try {
    if (url.searchParams.get("pulse") === "1")       { job = 'pulse';       return await postPulse(); }
    if (url.searchParams.get("consolidate") === "1") { job = 'consolidate'; return await postConsolidation(); }
    // The data-driven senses, each behind its own door: decided by a table,
    // not by the clock, so not in dueNow.
    if (url.searchParams.get("release") === "1")     { job = 'release';     return await postRelease(); }
    if (url.searchParams.get("move") === "1")        { job = 'move';        return await postMove(); }

    // The backfill, called by hand until `left: 0`; the nightly pass sweeps
    // the trickle a failed vendor call leaves.
    if (url.searchParams.get("embed") === "1")       { job = 'embed';       return await postEmbed(); }

    // The calendar's history, walked once by hand: R-14 and R-19 judge only
    // weeks a whole-week fetch covered.
    const history = url.searchParams.get("history");
    if (history) { job = 'history'; return await postHistory(history); }

    // The briefing's speaking worker, or a person re-sending a stored briefing.
    const speak = url.searchParams.get("speak");
    if (speak) { job = 'speak'; return await postSpeak(speak); }

    const now = new Date();
    if (url.searchParams.get("force") === "1") {
      return await postBriefing(briefDue(now) ?? briefKind(now));
    }

    // Which hours these matter in is dueNow's rule, stated there once.
    const [briefed, consolidated] = await Promise.all([briefedToday(), consolidatedToday()]);
    const due = dueNow(now, briefed, consolidated);
    if (due === 'pulse')       { job = 'pulse';       return await postPulse(); }
    if (due === 'consolidate') { job = 'consolidate'; return await postConsolidation(); }
    if (due) return await postBriefing(due);

    return json({ ok: true, skipped: "nothing due this hour" });
  } catch (err) {
    return await jobFailed(job, err);
  }
}

/* How a job that died behind a 200 says so — everything scheduled, and the
   trade event, which has no retry behind it. pg_net discards the response and
   nobody reads the console, so the message is how he finds out. */
async function jobFailed(job: string, err: unknown): Promise<Response> {
  const reason = why(err);
  console.error("doji-eugenia:", reason);
  /* The row first, because the message can fail and its catch swallows that:
     a job that dies before its first model call otherwise leaves no row, and
     the table reads as a system with nothing to do. `<job> job`, so it is never
     confused with an ask() label. */
  await recordRun({ caller: `${job} job`, ok: false, detail: reason.slice(0, 500) });

  await tg("sendMessage", {
    chat_id: CHAT_ID,
    text: `${apologyFor(job)}\n\n${reason.slice(0, 600)}`,
  }).catch(() => {});
  return json({ ok: false, error: reason, job }, 500);
}

/* What postBriefing stores in place of the text: one definition, or a retry
   misses yesterday's shape and sends a second briefing. */
export const briefingMarker = (due: Brief) => `[${due} briefing]`;

/* Found by filtering on the marker, not by scanning recent turns: thirty
   messages in an hour pushed it out of the window and the retry sent a second
   briefing. Exported because it is the decision. */
export function briefedQuery(): string {
  const markers = [briefingMarker('weekday'), briefingMarker('sunday')]
    .map(m => `"${encodeURIComponent(m)}"`).join(',');
  return `eugenia_turns?select=created_at&role=eq.user&content=in.(${markers})` +
         `&order=id.desc&limit=1`;
}

/* Whether today's briefing was generated — the marker goes down just before
   the send, and generation is the expensive half. The day is compared in New
   York here, never as a timestamp filter an hour wrong half the year. A failed
   read counts as yes: a second briefing on a guess is worse than none. */
async function briefedToday(): Promise<boolean> {
  try {
    const [latest] = await readRows<{ created_at: string }>('Briefing marker',
      briefedQuery());
    return !!latest && nyDate(new Date(latest.created_at)) === nyDate(new Date());
  } catch (err) {
    console.error("doji-eugenia: could not check for today's briefing —", why(err));
    return true;
  }
}


/* ─── The feedback keyboard ────────────────────────────────────────────────
   Two taps, the cheapest evidence of how a morning landed — an instruction
   note fires only when something annoys him enough to type. Gladys's
   mechanism; callback_data far under its 64 bytes. Never a score: a bot
   optimising an average writes briefings that flatter rather than teach.
   ───────────────────────────────────────────────────────────────────────── */
export const feedbackKeyboard = (day: string) => ({
  inline_keyboard: [[
    { text: "Useful", callback_data: `fb|good|${day}` },
    { text: "Off",    callback_data: `fb|off|${day}` },
  ]],
});

/* ─── The second read of the day's one expensive artifact ──────────────────
   The briefing's quality rules live in prose past a model call, where no test
   reaches — unmeasured, it grew by a sixth. So it is read once more against
   them before sending.

   The critic is handed his notes and the channel map: asked to enforce his
   instructions and whether a term was already explained without them, it
   skipped the first and answered the second from the paragraph in front of
   it — cutting the build-up the writer had just been told to include. Both are
   already awaited; agree.test.mjs holds the call site.

   It cannot make things worse. keepDraft is relative — a third of the draft
   catches the apology on a short message as well as a long one, where a flat
   floor overruled every revision and looked like agreement. The ceiling is
   each gate's own: the critic may add a missing link or verdict, so twice the
   draft; TRIM only cuts and swaps, and once returned its own notes above the
   message at 852 characters for 541.
   ───────────────────────────────────────────────────────────────────────── */
export const TRIM_MOST = 1.25;

export function keepDraft(draft: string, revised: string, most = 2): boolean {
  const t = revised.trim();
  return t.length < draft.length / 3 || t.length > draft.length * most;
}

async function critique(draft: string, notes: string, channels: string, desk: string,
                        story: string): Promise<string> {
  return await gate(draft, `${CRITIC}${notes}${channels}${desk}${story}\n\nTHE BRIEFING:\n\n${draft}`, 'critic');
}

/* The gate on the messages the critic never reached — most of what he gets in
   a week. TRIM asks only the writing questions; the briefing's checks would
   ruin three sentences, and it needs no notes or map. It is handed his
   position and the story, since a read on price turns on the first and a
   direction is checked against the second.

   What it returns is what is remembered: storing the draft files words he
   never read as hers, resent as history. The three callers bind it. */
async function trim(draft: string, desk: string, story: string): Promise<string> {
  return await gate(draft, `${TRIM}${desk}${story}\n\nTHE MESSAGE:\n\n${draft}`, 'trim', TRIM_MOST);
}

/* One body, because what makes a gate safe must never be copied: a revision
   keepDraft refuses is overruled, and a gate that throws costs nothing. Every
   outcome is a verdict row — revised, unchanged, overruled, or failed — since
   whether a gate changed anything was a console line, and the paragraph rule
   failed through every gate for days with nothing able to say why. */
async function gate(draft: string, asked: string, label: string, most?: number): Promise<string> {
  const caller = `${label} verdict`;
  try {
    const revised = await ask([{ role: 'user', content: asked }], 'medium', label, CRITIC_TOOLS);
    if (keepDraft(draft, revised, most)) {
      await recordRun({ caller, ok: true, chars: draft.length,
                        detail: `kept the draft — revision ${revised.trim().length} vs draft ${draft.length}` });
      return draft;
    }
    const sent = revised.trim();
    await recordRun({ caller, ok: true, chars: sent.length,
                      detail: sent === draft.trim() ? 'unchanged' : `revised ${draft.length} → ${sent.length}` });
    return sent;
  } catch (err) {
    // A gate that fails must never cost the message it was checking.
    const reason = why(err);
    console.error(`doji-eugenia: ${label} failed —`, reason);
    await recordRun({ caller, ok: false, chars: draft.length,
                      detail: `failed, the draft went — ${reason}`.slice(0, 500) });
    return draft;
  }
}

/* The briefing reads its own history, so a morning continues from the last
   rather than starting from nothing. The stored user turn is a marker, not the
   sent text, which is rebuilt every morning and would resend stale as history. */
async function postBriefing(due: Brief): Promise<Response> {
  const opened = Date.now();
  // Filed before the reads, so she is handed this morning's calendar — and on a
  // Sunday the whole week.
  await (due === 'sunday' ? filedWeek(weekOf(new Date())) : filed());
  // Every read at once: independent and small, so the batch costs its slowest.
  const [price, around, rates, crowd, notes, channels, trades, breaches, story, health, loops, calendar, desk] =
    await Promise.all([
      marketBlock(), aroundBlock(), ratesBlock(), due === 'sunday' ? positioningBlock() : "", notesBlock(),
      channelsBlock(), tradesBlock(), breachesBlock(), thesisBlock(), healthBlock(), loopsBlock(),
      due === 'sunday' ? weekBlock() : calendarBlock(), positionsBlock(),
    ]);

  const asked = (due === 'sunday'
    ? "Today's briefing, please. It is Sunday evening and the gold week is about to open."
    : "Today's briefing, please.")
    // `health` first: if the journal stopped, everything after it may be
    // missing rows.
    + health + price + around + rates + crowd + notes + channels + trades + breaches + story + loops + calendar + desk;

  const draft = await ask([...await recent(), { role: 'user', content: asked }],
                          'high', `${due} briefing`);
  const brief = await critique(draft, notes, channels, desk, story);

  // The length lives in prose past a model call, where nothing else sees it.
  console.log(`doji-eugenia: ${due} briefing — ${brief.length} characters`);

  /* The marker goes down before the send. After, a failed insert leaves a
     delivered briefing unmarked and each retry sends another: four briefings
     from one failure. Before, a failed send costs the retry instead, and he is
     told. */
  const checked = Date.now();
  await remember([{ role: 'user', content: briefingMarker(due) },
                  { role: 'assistant', content: brief }]);
  const stored = Date.now();

  /* Handed to a second worker to speak, on its own clock. A 2xx says only that
     it started; postSpeak writes the delivered row. A worker that would not
     start — a 546 — and the briefing is spoken here instead: losing the second
     worker must never lose the briefing. */
  const handed = await fetch(`${SB_URL}/functions/v1/doji-eugenia?speak=${due}`, {
    method: "POST", headers: { "x-doji-key": CRON_SECRET },
  }).then(async res => { await res.body?.cancel(); return res.ok ? null : `HTTP ${res.status}`; },
          (err: unknown) => why(err));
  if (handed === null) {
    await recordRun({
      caller: `${due} briefing written`, chars: brief.length, ms: Date.now() - opened, ok: true,
      detail: `stored in ${Math.round((stored - checked) / 1000)}s, handed to the speaking worker`,
    });
    return json({ ok: true, brief: due, chars: brief.length });
  }

  const heard = await sayAloud(brief, feedbackKeyboard(nyDate(new Date())));

  // The artifact's row, apart from the two calls': what he received and how
  // long it all took, with the stretch after the critic split out.
  const spoken = Date.now();
  await recordRun({
    caller: `${due} briefing delivered`, chars: brief.length,
    ms: spoken - opened, ok: true,
    detail: `stored in ${Math.round((stored - checked) / 1000)}s, the speaking worker did not start `
          + `(${handed}), ${heard ? "spoken" : "sent as text"} in ${Math.round((spoken - stored) / 1000)}s`,
  });
  return json({ ok: true, brief: due, chars: brief.length });
}

/* The second worker: today's stored briefing, found by its marker and paired
   with its text by the instant they were written in one INSERT — adjacent ids
   would not prove that. Today's only, since the door is also a person's repair
   and yesterday's would arrive as this morning's. The delivered row is written
   here, after the send: 010 reads its absence as a briefing that never came.
   Exported so find, pair, speak, record is driven. */
export async function postSpeak(due: string): Promise<Response> {
  if (due !== 'weekday' && due !== 'sunday') throw new Error(`no such briefing to speak: ${due}`);
  const opened = Date.now();
  const [marker] = await readRows<{ created_at: string }>('Briefing marker',
    `eugenia_turns?select=created_at&role=eq.user` +
    `&content=eq.${encodeURIComponent(briefingMarker(due))}&order=id.desc&limit=1`);
  const today = nyDate(new Date());
  if (!marker || nyDate(new Date(marker.created_at)) !== today) {
    throw new Error(`no ${due} briefing is stored for ${today}`);
  }
  const [turn] = await readRows<{ content: string }>('Briefing',
    `eugenia_turns?select=content&role=eq.assistant` +
    `&created_at=eq.${encodeURIComponent(marker.created_at)}&order=id.desc&limit=1`);
  if (!turn) throw new Error(`the ${due} briefing's marker is stored and its text is not`);

  const heard = await sayAloud(turn.content, feedbackKeyboard(today), SPEAK_WORKER_MS);
  const spoken = Date.now();
  await recordRun({
    caller: `${due} briefing delivered`, chars: turn.content.length, ms: spoken - opened, ok: true,
    detail: `${heard ? "spoken" : "sent as text"} in ${Math.round((spoken - opened) / 1000)}s`,
  });
  return json({ ok: true, spoke: due, heard });
}

/* How silence is said. The whole reply, allowing a full stop; "Nothing much
   has changed except…" is news and goes through. Err toward sending: a
   swallowed message is invisible. */
export const isSilent = (text: string) => /^nothing[.!\s]*$/i.test(text.trim());

/* ─── The nightly pass ─────────────────────────────────────────────────────
   Without it, what a conversation established is reachable only by search, and
   what she knows never grows. A fixed twenty-four hours, no watermark — the
   window and the gap are the same. Nothing is sent and nothing is stored as a
   turn, which would spend two of tomorrow's twelve on bookkeeping.
   ───────────────────────────────────────────────────────────────────────── */
const CONSOLIDATE_HOURS = 24;

// A bound, not a working limit: a backfill or a very long day must not put an
// unbounded window into a high-effort call.
const CONSOLIDATE_TURNS = 200;

/* Newest first, reversed for reading: the oldest two hundred would distil the
   morning and drop the evening, where a late instruction lives. Exported
   because it is the decision. */
export function dayQuery(hours: number, now = Date.now()): string {
  const from = new Date(now - hours * 3600_000).toISOString();
  return `eugenia_turns?select=role,content,created_at` +
         `&created_at=gte.${from}&order=id.desc&limit=${CONSOLIDATE_TURNS}`;
}

async function turnsSince(hours: number): Promise<Turn[]> {
  const rows = await readRows<Turn & { created_at: string }>('Day',
    dayQuery(hours));
  return dateTurns(rows.reverse());
}

/* Whether tonight's pass ran, read off eugenia_runs — the pass stores no turn
   to mark itself. A failed read counts as yes, for briefedToday's reason. */
async function consolidatedToday(): Promise<boolean> {
  try {
    const [latest] = await readRows<{ at: string }>('Consolidation marker',
      `eugenia_runs?select=at&caller=eq.consolidation&ok=is.true` +
      `&order=id.desc&limit=1`);
    return !!latest && nyDate(new Date(latest.at)) === nyDate(new Date());
  } catch (err) {
    console.error("doji-eugenia: could not check for tonight's pass —", why(err));
    return true;
  }
}

/* His taps on recent briefings: two days, since a tap can arrive late; older
   would read last week's verdict into tonight. */
export async function feedbackBlock(): Promise<string> {
  try {
    const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const rows = await readRows<{ on_day: string; verdict: string }>('Feedback',
      `eugenia_feedback?select=on_day,verdict&on_day=gte.${from}` +
      `&order=on_day.desc&limit=5`);
    if (!rows.length) return "";
    const said = rows.map(r => `· ${civilDay(r.on_day)}: he marked it ${r.verdict === 'good' ? 'useful' : 'off'}`);
    return `\n\nWhat he made of the recent briefings:\n${said.join("\n")}\n` +
           `Read this as one signal beside the day, never as a score to raise.`;
  } catch (err) {
    console.error("doji-eugenia: feedback unavailable —", why(err));
    return "";
  }
}

async function postConsolidation(): Promise<Response> {
  const day = await turnsSince(CONSOLIDATE_HOURS);

  /* A silent day skips the model call but still leaves a row, or 23:00 runs it
     again. A branch, not an early return: the meters below are about the
     system, and an early return skipped them on exactly the quiet nights. The
     census still runs after the pass, the only thing that moves a rung. */
  if (day.length) {

  // His week too: it is asked to notice what he has started doing
  // differently, which most days' transcripts never mention.
  const [notes, channels, trades, story, loops, calendar, verdicts, desk] = await Promise.all([
    notesBlock(), channelsBlock(), tradesBlock(),
    thesisBlock(), loopsBlock(), calendarBlock(), feedbackBlock(), positionsBlock(),
  ]);

  const asked = CONSOLIDATE + notes + channels + trades + story + loops + calendar +
    verdicts + desk +
    `\n\nThe day, oldest first:\n\n` +
    day.map(t => `${t.role === 'user' ? 'him' : 'you'}: ${t.content}`).join("\n\n");

  // High: a careless note outlives a careless briefing by months.
  const said = await ask([{ role: 'user', content: asked }], 'high', 'consolidation',
                         CONSOLIDATE_TOOLS);
  console.log("doji-eugenia: consolidated —", said.slice(0, 200));

  } else {
    await recordRun({ caller: 'consolidation', ok: true, detail: 'nothing said' });
  }

  await recordChannels();

  // The embedding sweep, after the pass and wrapped, so a vendor outage never
  // reads as a failed pass. Both outcomes are a row.
  try {
    const notes = await fillEmbeddings('eugenia_notes', 'note');
    const turns = await fillEmbeddings('eugenia_turns', 'content');
    const swept = sweepLine(notes, turns);
    console.log("doji-eugenia: embeddings swept —", swept);
    await recordRun({ caller: 'embeddings', ok: true, detail: swept });
  } catch (err) {
    const reason = why(err);
    console.error("doji-eugenia: embedding sweep failed —", reason);
    await recordRun({ caller: 'embeddings', ok: false, detail: reason.slice(0, 500) });
  }

  // The whole week, which R-14 and R-19 judge against — the quarter-hourly
  // filing never marks one covered. Wrapped inside filedWeek.
  await filedWeek(weekOf(new Date()));

  // One exit: a second return is how the meters got skipped.
  return day.length ? json({ ok: true, consolidated: day.length })
                    : json({ ok: true, skipped: "nothing said" });
}

/* The meter on what she is for: his understanding growing. A ladder that
   stopped moving looks like one with no reason to move, and is read by
   comparing nights, so a row per night is the series — taken after the pass,
   the one moment a rung could have changed. Never throws. */
async function recordChannels() {
  try {
    const rungs = channelsList(await readChannels())
      .split('\n').map(l => l.replace(/^· /, '')).join(' · ');
    console.log(`doji-eugenia: channels — ${rungs}`);
    await recordRun({ caller: 'channels', ok: true, detail: rungs });
  } catch (err) {
    const reason = why(err);
    console.error("doji-eugenia: channels unavailable —", reason);
    await recordRun({ caller: 'channels', ok: false, detail: reason.slice(0, 500) });
  }
}

/* The quiet look. Nothing is stored when she stays quiet: empty pairs would
   push the briefing out of the twelve turns. */
async function postPulse(): Promise<Response> {
  const [notes, channels, story, loops, calendar, desk] = await Promise.all([
    notesBlock(), channelsBlock(), thesisBlock(), loopsBlock(), calendarBlock(),
    positionsBlock(),
  ]);
  const asked = "Pulse, please — anything since the briefing?"
    + notes + channels + story + loops + calendar + desk;
  const said = await ask([...await recent(), { role: 'user', content: asked }],
                         'medium', 'pulse');

  if (isSilent(said)) return json({ ok: true, pulse: "quiet" });

  const sent = await trim(said, desk, story);
  await sayAloud(sent);
  await remember([{ role: 'user', content: '[pulse]' }, { role: 'assistant', content: sent }]);
  return json({ ok: true, pulse: "sent" });
}

/* ─── The look after a number lands ────────────────────────────────────────
   The first thing here that is not a clock: an 08:30 print used to land after
   the briefing and wait for a pulse whose default is silence. This fires off
   the filed calendar — the quarter-hourly job asks whether anything high has
   landed unlooked, and `looked_at` makes it once-only. Still silent by
   default: a number landing where everyone expected is not news.
   ───────────────────────────────────────────────────────────────────────── */
// Older than this, a print is history for tomorrow's briefing — and a redeploy
// after an outage cannot send a day of looks at once.
const RELEASE_STALE_H = 6;

// A bound, not a working limit.
const RELEASE_ROWS = 40;

/* One look per release TIME, not per row: the 08:30 slot is most of a report,
   and her typed rows once fired five looks for one CPI. The earliest time
   nothing has looked at, and every high row at it, in one message. Exported and
   pure, since which rows get looked at is the decision. */
export function dueRelease(rows: Release[]): Release[] {
  const byTime = new Map<string, Release[]>();
  for (const r of rows) (byTime.get(r.at) ?? byTime.set(r.at, []).get(r.at)!).push(r);
  for (const [, group] of [...byTime].sort(([a], [b]) => a < b ? -1 : 1)) {
    if (!group.some(r => r.looked_at)) return group;
  }
  return [];
}

async function pendingRelease(now = Date.now()): Promise<Release[]> {
  const from = new Date(now - RELEASE_STALE_H * 3600_000).toISOString();
  // looked_at is read, not filtered on: a filter would hide the mark that makes
  // the rest of the group skippable.
  const rows = await readRows<Release>('Release',
    `eugenia_calendar?select=${RELEASE_COLUMNS},looked_at,ticker` +
    `&importance=eq.high` +
    `&at=lte.${new Date(now).toISOString()}&at=gte.${from}` +
    `&order=at.asc&limit=${RELEASE_ROWS}`);
  return dueRelease(rows);
}

/* The look waits for the number, up to half an hour: TradingView publishes an
   actual a minute or two late, and a look run first spends a search finding
   what the next filing would hand it. Left unmarked meanwhile. A speech — no
   consensus, no prior — has nothing coming and is looked at on time. */
const ACTUAL_WAIT_MIN = 30;

export function awaitingActual(due: Release[], now: number): boolean {
  return due.some(r => !r.actual && (r.consensus || r.prior)) &&
         now - Date.parse(due[0].at) < ACTUAL_WAIT_MIN * 60_000;
}

/* ─── How it usually goes ──────────────────────────────────────────────────
   The last twelve prints of the same series (020's ticker), each with its
   consensus, so a surprise is read against its own record. Listed, not scored:
   the figures are text, and a surprise computed here would be a parse with
   every unit a chance to get the sign backwards.
   ───────────────────────────────────────────────────────────────────────── */
const RECORD = 12;

export function recordList(name: string, rows: Pick<Release, 'at' | 'name' | 'consensus' | 'actual'>[]): string {
  if (!rows.length) return "";
  return `\n\nHow ${name} has printed against expectations, the last ${rows.length} times:\n` +
    rows.map(r => `· ${civilDay(r.at.slice(0, 10))}, ${r.name}: ${r.actual}` +
      (r.consensus ? ` against ${r.consensus} expected` : ", no consensus on file")).join("\n");
}

/* What the last print became. TradingView carries the revised figure as this
   row's `prior` while last month's row keeps the first report, so a revision is
   the two disagreeing — half the story on 2 October, payrolls' August cut from
   162K to 133K. Only against the print immediately before: a gap half as long
   again as the one before it is a missing print, and says nothing. */
export function revisionLine(r: Pick<Release, 'at' | 'prior'>,
                             record: Pick<Release, 'at' | 'name' | 'actual'>[]): string {
  const [last, before] = record;
  if (!r.prior || !last?.actual || !before || r.prior === last.actual) return "";
  if (Date.parse(r.at) - Date.parse(last.at) > 1.5 * (Date.parse(last.at) - Date.parse(before.at))) return "";
  return `\nRevised: ${last.name} was first reported at ${last.actual} on ` +
         `${civilDay(last.at.slice(0, 10))}, and this release revises it to ${r.prior}.`;
}

export function recordQuery(ticker: string, before: string): string {
  return `eugenia_calendar?select=at,name,consensus,actual&ticker=eq.${encodeURIComponent(ticker)}` +
         `&at=lt.${before}&actual=not.is.null&order=at.desc&limit=${RECORD}`;
}

/* One read per series; a failed read costs its block only. */
async function recordBlock(due: Release[]): Promise<string> {
  const series = [...new Map(due.filter(r => r.ticker).map(r => [r.ticker!, r])).values()];
  const parts = await Promise.all(series.map(async r => {
    try {
      const rows = await readRows<Release>('Record', recordQuery(r.ticker!, r.at));
      return recordList(r.name, [...rows].reverse()) + revisionLine(r, rows);
    } catch (err) {
      console.error("doji-eugenia: track record unavailable —", why(err));
      return "";
    }
  }));
  return parts.join("");
}

/* Marked before the look, for the briefing marker's reason: a look that fails
   after generating would otherwise repeat every quarter hour, billed. Every row
   at that time, or one left unmarked is the next look. */
async function markLooked(ids: number[]): Promise<void> {
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_calendar?id=in.(${ids.join(',')})`, {
    method: "PATCH", headers: sbHeaders("return=minimal"),
    body: JSON.stringify({ looked_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Could not mark ${ids.length} release(s) looked at (HTTP ${res.status})`);
}

async function postRelease(): Promise<Response> {
  await filed();
  const due = await pendingRelease();
  if (!due.length) return json({ ok: true, skipped: "nothing has landed unlooked" });
  if (awaitingActual(due, Date.now())) return json({ ok: true, skipped: "waiting for TradingView's actual" });

  await markLooked(due.map(r => r.id));

  // The channel map, since it is asked to build terms by rung.
  const [notes, channels, story, loops, desk, record] = await Promise.all([
    notesBlock(), channelsBlock(), thesisBlock(), loopsBlock(), positionsBlock(), recordBlock(due),
  ]);
  const landed = due.map(r =>
    `· ${r.name}` +
    (r.actual ? ` — printed ${r.actual}` : " — not yet published") +
    (r.consensus ? `, ${r.consensus} expected` : "") +
    (r.prior ? `, after ${r.prior}` : "")).join("\n");
  // The UTC instant beside the ET heading: record_actual takes it, and a
  // conversion she would do in her head is an input.
  const asked = RELEASE +
    `\n\nWhat landed at ${nyTime(due[0].at)} ET — ${new Date(due[0].at).toISOString()} in UTC, ` +
    `which is what record_actual takes:\n${landed}` +
    record + notes + channels + story + loops + desk;

  const said = await ask([...await recent(), { role: 'user', content: asked }],
                         'medium', 'release look', RELEASE_TOOLS);

  const named = due.map(r => r.name).join(", ");
  if (isSilent(said)) return json({ ok: true, release: named, said: "quiet" });

  const sent = await trim(said, desk, story);
  await sayAloud(sent);
  // Stored, unlike a quiet look: a follow-up needs it.
  await remember([{ role: 'user', content: `[${named} landed]` },
                  { role: 'assistant', content: sent }]);
  return json({ ok: true, release: named, said: "sent" });
}

/* ─── The trade she hears about in two minutes ─────────────────────────────
   Still no verdict; she may say only his own rules, at the moment they apply:

     opened — a high-impact print is pending and he is now in a position: R-14
              and R-19. Citing them is hers; deciding what he does is not.
     closed — that fill took the day past −4%: R-11 says the day ends there.

   Both branches decide from data before any model call, so an ordinary fill
   costs nothing.
   ───────────────────────────────────────────────────────────────────────── */
// Beyond this a print is tomorrow's, and the briefing carries it.
const PENDING_AHEAD_H = 8;

async function aheadToday(now = Date.now()): Promise<Release[]> {
  const to = new Date(now + PENDING_AHEAD_H * 3600_000).toISOString();
  return readRows<Release>('Calendar',
    `eugenia_calendar?select=${RELEASE_COLUMNS}` +
    `&importance=eq.high&at=gt.${new Date(now).toISOString()}&at=lte.${to}` +
    `&order=at.asc&limit=5`);
}

/* Exported so read, guard, decide is driven: every guard returns before a
   model call, and one that stopped returning looks like one never needed. */
export async function postTradeEvent(id: string, event: string): Promise<Response> {
  const [row] = await readRows<TradeRow>('Trade',
    `eugenia_trades?id=eq.${encodeURIComponent(id)}&limit=1`);
  // Soft-deleted: nothing to say.
  if (!row) return json({ ok: true, skipped: "no such trade" });

  /* Both things this path may say are about today, and the trigger fires on a
     transition, not a clock — anything stamping an old close fires it for an
     old day, and once reported August's losses in the present tense. A
     property of the event, so it guards both branches. An overnight hold
     closing this morning is yesterday's and skipped too: R-11 forbids a LATER
     entry, and a finished day has none. */
  if (row.open_day !== nyDate(new Date())) {
    return json({ ok: true, trade: id, skipped: "not today" });
  }

  let situation: string;

  if (event === 'opened') {
    // Opened and closed inside one poll arrives as an open event about a
    // position he is out of; the close event that follows is the true one.
    if (!isOpen(row)) return json({ ok: true, trade: id, skipped: "already closed" });
    const ahead = await aheadToday();
    if (!ahead.length) return json({ ok: true, trade: id, said: "nothing pending" });
    situation =
      `He has just opened a ${row.direction ?? "position"}` +
      (row.entry_price ? ` at ${row.entry_price}` : "") + ".\n" +
      `Still ahead today:\n` +
      ahead.map(r => `· ${nyTime(r.at)} ET ${r.name}` +
                     (r.consensus ? `, ${r.consensus} expected` : "")).join("\n");
  } else {
    // The day as it stands, computed, through the same view.
    const day = row.open_day;
    if (!day) return json({ ok: true, skipped: "no filing day" });
    const standing = dayStanding(await readRows<TradeRow>('Day',
      `eugenia_trades?open_day=eq.${day}&limit=50`), day);
    if (!standing || !standing.breached) {
      return json({ ok: true, trade: id, said: "day is inside its limit" });
    }
    situation =
      `That fill closed his day at ${standing.pnl.toFixed(2)} against an account of ` +
      `${standing.account.toFixed(0)} implied by his size — past the ${DAY_LOSS * 100}% ` +
      `R-11 sets. Read R-11 in the strategy before you say anything about it.`;
  }

  /* The reads come after the early returns, so an ordinary fill costs nothing.
     History matters most here: the print this warns about is the one the
     briefing likely named, and without the window she repeats herself. Notes,
     or his instructions are obeyed everywhere but mid-trade. */
  const [history, notes] = await Promise.all([recent(), notesBlock()]);

  const said = await ask(
    [...history, { role: 'user', content: `${TRADE_EVENT}\n\n${situation}${notes}` }],
    'medium', 'trade look', TRADE_TOOLS);

  if (isSilent(said)) return json({ ok: true, trade: id, said: "quiet" });

  await sayAloud(said);
  await remember([{ role: 'user', content: `[trade ${event}]` },
                  { role: 'assistant', content: said }]);
  return json({ ok: true, trade: id, said: "sent" });
}

/* ─── The move nobody filed ────────────────────────────────────────────────
   Releases and positions are rows appearing; gold is always there, so "it
   moved" is a fact about a price AND a previous reading — hence the mark. The
   test is relative twice, to the session's range and to the price, because a
   fixed dollar threshold means different things at 4,400 and at 2,000 and
   goes stale silently. A move a fresh print explains is the release look's, or
   payrolls reaches him twice. Silent by default after all of that.
   ───────────────────────────────────────────────────────────────────────── */
// Decisions rather than facts, so named here, as CLOSEOUT_MIN and STRETCH are.
// A third of the session's range inside a quarter of an hour.
export const MOVE_SHARE = 0.35;
/* A quarter of a percent of the price, the least the bar may be. The range is
   the broker's session's, which restarts at the 17:00 roll, so for hours every
   evening it is small because the session is young — and a tenth of a percent
   let a $7 drift at 20:57 through. Applied to the bar, below. */
export const MOVE_FLOOR = 0.0025;
// Past two missed runs the gap is not a quarter-hour, so the reading restarts.
export const MARK_STALE_MIN = 40;
// One message per move: a trending afternoon is one story.
export const MOVE_QUIET_H = 2;
// How recently a print counts as the explanation — a different question from
// the release look's own staleness window.
const MOVE_EXPLAINED_H = 1;

export interface Mark { bid: number; at: string; looked_at: string | null }

/* Pure, so every gate is driven both ways: for a sense silent by design, that
   is the only way to know it can fire. */
export function moveWorth(spot: Quote, mark: Mark, now = Date.now()):
  { worth: true; move: number } | { worth: false; why: string } {
  // The seeded zero row, the one shape that is not a price.
  if (!(mark.bid > 0)) return { worth: false, why: "no mark yet" };

  const age = (now - Date.parse(mark.at)) / 60_000;
  if (!(age <= MARK_STALE_MIN)) return { worth: false, why: "mark is stale" };

  if (mark.looked_at &&
      now - Date.parse(mark.looked_at) < MOVE_QUIET_H * 3600_000) {
    return { worth: false, why: "already said something about a move" };
  }

  const move = Math.round((spot.bid - mark.bid) * 100) / 100;
  const size = Math.abs(move);

  /* The floor bounds the bar rather than standing beside it. A session too
     young to have a range is one she cannot judge, and silence beats a lower
     standard: beside it, the floor alone let post-roll wobbles of $13 and $17
     through as loops nothing could ever close. A quote with no range lands
     here too. */
  const bar = (spot.high - spot.low) * MOVE_SHARE;
  if (bar < spot.bid * MOVE_FLOOR) {
    return { worth: false, why: "no session range to judge against yet" };
  }
  if (size < bar) return { worth: false, why: "small against the day's range" };

  return { worth: true, move };
}

async function readMark(): Promise<Mark | null> {
  const [row] = await readRows<Mark>('Mark',
    `eugenia_price?id=eq.current&select=bid,at,looked_at&limit=1`);
  return row ?? null;
}

/* The mark advances every run and looked_at does not, so the window is the gap
   between runs. Stamped before the look, for markLooked's reason. */
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

// A high print in the last hour, looked at or not: that message is the one he
// gets about this move.
async function explained(now = Date.now()): Promise<Release | null> {
  const from = new Date(now - MOVE_EXPLAINED_H * 3600_000).toISOString();
  const [row] = await readRows<Release>('Calendar',
    `eugenia_calendar?select=${RELEASE_COLUMNS}` +
    `&importance=eq.high&at=gte.${from}&at=lte.${new Date(now).toISOString()}` +
    `&order=at.desc&limit=1`);
  return row ?? null;
}

async function postMove(): Promise<Response> {
  // The weekend quote is Friday's last; the poller's rule, the same function.
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

  const [notes, map, story, loops, ahead, desk, around, wires] = await Promise.all([
    notesBlock(), channelsBlock(), thesisBlock(), loopsBlock(), aheadToday(),
    positionsBlock(), aroundBlock(), headlinesBlock(),
  ]);
  // The window from the mark, not assumed: a missed run makes it longer.
  const since = Math.round((Date.now() - Date.parse(mark.at)) / 60_000);
  const asked = MOVE +
    `\n\nGold is ${spot.bid}, ${worth.move > 0 ? "up" : "down"} ` +
    `${Math.abs(worth.move)} in the last ${since} minutes. ` +
    `Nothing high-impact on the calendar has printed in the last hour.` +
    // quoteLine, which names the session window — this path fires in the
    // evening, when the session and the calendar day disagree.
    `\n\n${quoteLine(spot, new Date())}` +
    (ahead.length
      ? `\nStill ahead today: ` +
        ahead.map(r => `${nyTime(r.at)} ET ${r.name}`).join(", ") + "."
      : "") +
    around + wires + notes + map + story + loops + desk;

  const said = await ask([...await recent(), { role: 'user', content: asked }],
                         'medium', 'move look', MOVE_TOOLS);

  if (isSilent(said)) return json({ ok: true, move: worth.move, said: "quiet" });

  const sent = await trim(said, desk, story);
  await sayAloud(sent);
  await remember([{ role: 'user', content: `[gold ${worth.move > 0 ? "up" : "down"} ${Math.abs(worth.move)}]` },
                  { role: 'assistant', content: sent }]);
  return json({ ok: true, move: worth.move, said: "sent" });
}


/* ─── What he sends that is not typing ─────────────────────────────────────
   A voice note and a chart, the two things he sends mid-session, both used to
   be dropped. One download serves both: getFile, then the file endpoint with
   the token in the URL — Telegram's design, and why this is not telegram().
   ───────────────────────────────────────────────────────────────────────── */
// Well under Telegram's 20MB: an image goes in as base64, a third larger, and
// is paid as input on every round of its turn.
const FILE_MAX = 3 * 1024 * 1024;

/* The four image types the API reads, checked here rather than met as a 400
   mid-reply: a chart sent as a file can be a BMP, HEIC or TIFF. */
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

/* Chunked: spreading every byte into one argument list is a RangeError on any
   real photo, and works on every small one a test would use. */
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

/* ─── Hearing him ──────────────────────────────────────────────────────────
   The Messages API takes no audio and Telegram does not transcribe for bots,
   so a voice note needs a second vendor. Written to the /audio/transcriptions
   shape every provider implements, so the endpoint is configuration. Unset is
   a first-class state — she says she cannot hear it — and not a boot failure.
   ───────────────────────────────────────────────────────────────────────── */
const STT_URL   = env("STT_URL");
const STT_KEY   = env("STT_KEY");
const STT_MODEL = env("STT_MODEL") || "whisper-1";

/* Four reasons a voice note yields no words, four sentences: a bad key is not
   fixed by him speaking more clearly, and one message for all four had him
   resending. Each says whose problem it is. */
export const VOICE_TROUBLE: Record<string, string> = {
  unconfigured: "I cannot hear voice notes yet, jefe — type it and I will answer.",
  download:     "That voice note would not come through, jefe. Send it again?",
  failed:       "My transcription is not answering, jefe — that is broken on my side, not something you said. Type it and I will answer.",
  empty:        "I could not make out any words in that one, jefe. Send it again, or type it?",
};

type Heard = { said: string } | { trouble: keyof typeof VOICE_TROUBLE & string };

async function transcribe(bytes: Uint8Array, name: string, mime: string): Promise<Heard> {
  if (!STT_URL || !STT_KEY) return { trouble: 'unconfigured' };
  try {
    const form = new FormData();
    // Telegram's type and filename both: providers read the format from one or
    // the other, and msg.audio is not always ogg.
    form.append("file", new Blob([bytes], { type: mime }), name);
    form.append("model", STT_MODEL);
    const res = await fetch(STT_URL, {
      method: "POST", headers: { Authorization: `Bearer ${STT_KEY}` }, body: form,
    });
    // The body names the actual complaint; the status alone points at the key.
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const said = String((await res.json())?.text ?? "").trim();
    return said ? { said } : { trouble: 'empty' };
  } catch (err) {
    console.error("doji-eugenia: transcription failed —", why(err));
    return { trouble: 'failed' };
  }
}

/* ─── The tap under a briefing ─────────────────────────────────────────────
   Answered here, not by the model: one word to store needs a PATCH, not a
   turn. answerCallbackQuery is not optional, or the button spins.
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
    // One verdict a day; the last tap wins.
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_feedback?on_conflict=on_day`, {
      method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify([{ on_day: tap.day, verdict: tap.verdict }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await ack(tap.verdict === 'good' ? "Noted, gracias." : "Noted — I will look at that tonight.");
  } catch (err) {
    console.error("doji-eugenia: feedback not written —", why(err));
    await ack("That did not save, jefe.");
  }
}

/* ─── The Telegram half: he replied ─────────────────────────────────────── */

/* Not answered inside the response: Telegram waits about a minute, then
   redelivers, and a long answer would run — and bill — twice. The entry point
   answers 200 at once; background() keeps the worker alive. Nothing awaits
   this, so it carries its own error handling and apology. */
async function handleMessage(update: any): Promise<void> {
  try {
    const msg = update?.message;
    // Nothing she can read.
    if (!msg) return;
    if (String(msg.chat?.id) !== CHAT_ID) {
      console.error("doji-eugenia: message from unexpected chat");
      return;
    }

    // Best effort; it lasts five seconds, so the answer re-sends it below.
    const typing = () => tg("sendChatAction", { chat_id: CHAT_ID, action: "typing" }).catch(() => {});

    // What he sent, resolved first: `text` is stored and read by the commands;
    // `blocks` is an image, for this turn only.
    let text: string = typeof msg.text === 'string' ? msg.text : "";
    const blocks: any[] = [];

    const voice = msg.voice ?? msg.audio;
    if (voice?.file_id) {
      // Typing from the start: a voice note's wait is the longest.
      await typing();
      const file = await tgDownload(voice.file_id);
      const heard: Heard = file
        ? await transcribe(file.bytes, file.path.split('/').pop() ?? "voice.oga",
                           String(voice.mime_type ?? "audio/ogg"))
        : { trouble: 'download' };

      if ('trouble' in heard) { await say(VOICE_TROUBLE[heard.trouble]); return; }
      // Marked, so a transcript is never passed off as typed.
      text = `[voice note] ${heard.said}`;
    }

    // A chart. Whether a setup on it is valid would be a signal; that line is in
    // the prompt. Largest size last, Telegram's order.
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
    // A photo is JPEG; a document is whatever he attached.
    const docType = String(msg.document?.mime_type ?? "");
    const asImage = photo ?? (IMAGE_TYPES.includes(docType) ? msg.document : null);
    if (asImage?.file_id) {
      await typing();
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
    // Neither readable audio nor image: said, never dropped.
    if (!blocks.length && !text && msg.document) {
      await say(`I cannot open ${docType || 'that kind of file'}, jefe. A screenshot works.`);
      return;
    }

    if (!text) return;
    // /notes is answered from the database, never by the model, which could
    // paraphrase or drop a row: an audit that can do that audits nothing.
    if (text.trim().toLowerCase() === '/notes') {
      try {
        // Everything she keeps that he cannot otherwise see, in one message.
        const [told, noticed, channels, loops, story, promised] = await Promise.all([
          readNotes('instruction'), readNotes('fact'), readChannels(), readLoops(), readThesis(),
          readNotes('commitment'),
        ]);
        await say(notesList(told, noticed, channels, loops, story, promised));
      } catch (err) {
        console.error("doji-eugenia: notes unavailable —", why(err));
        await say("I cannot read my notes just now, jefe.");
      }
      return;
    }
    // /channel, answered from the database through setChannel, so the bottom
    // rung's one-way door holds here too.
    const wanted = parseChannel(text);
    if (wanted !== null) {
      await say(typeof wanted === 'string'
        ? wanted
        : await setChannel(wanted.channel, wanted.state, 'he said so'));
      return;
    }
    // Any other command — /start — costs no model call.
    if (text.startsWith('/')) {
      await tg("sendMessage", { chat_id: CHAT_ID,
        text: "Aqui estoy, jefe. Just talk to me — or /notes to see what I have kept." });
      return;
    }

    // Re-sent until there is something to send.
    typing();
    const keepTyping = setInterval(typing, 4_500);

    // A swipe-reply names the message: its text, or for a voice note the turn
    // found by time. A failed read costs the quote, never the answer.
    const replied = msg.reply_to_message?.from?.is_bot ? msg.reply_to_message : null;
    const quoting: Promise<string | null> = !replied ? Promise.resolve(null)
      : typeof replied.text === 'string' ? Promise.resolve(replied.text)
      : readRows<{ content: string }>('Replied-to', repliedQuery(replied.date))
          .then(async ([turn]) => turn?.content ?? spokenBriefing(await readRows<Turn & { created_at: string }>(
            'Replied-to briefing', spokenQuery(replied.date))) ?? "")
          .catch(() => "");

    let answer: string;
    try {
      const [history, notes, channels, story, loops, calendar, desk, quoted] = await Promise.all([
        recent(), notesBlock(), channelsBlock(), thesisBlock(), loopsBlock(),
        calendarBlock(), positionsBlock(), quoting,
      ]);
      // A marker with the opening words is stored, so the nightly pass knows
      // which message "too long" was about; the quote itself is not.
      if (quoted !== null) {
        const words = quoted.trim().split(/\s+/).filter(Boolean);
        const opening = words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
        text = `[replying to ${opening ? `"${opening}"` : 'an earlier message'}] ${text}`;
      }
      const about = quoted ? `\n\nHe is replying to this message of yours:\n«${quoted}»` : "";
      // Told it will be heard, and no length: there is no cap to write for.
      const aloud =
        `\n\nYour answer reaches him as a voice note, so write it ` +
        `to be heard: plain sentences, no headings, and nothing that only works ` +
        `on a page. Its length is whatever the answer needs.`;
      const context = text + about + aloud + notes + channels + story + loops + calendar + desk;
      const draft = await ask(
        [...history, {
          role: 'user',
          // An image rides beside the text; the context is in the text either way.
          content: blocks.length ? [...blocks, { type: 'text', text: context }] : context,
        }],
        'medium', 'reply');
      // Gated while the indicator still runs, or three silent seconds read as
      // her finishing and saying nothing.
      answer = await trim(draft, desk, story);
    } finally {
      // Stopped before sending, or a ping lands after the message.
      clearInterval(keepTyping);
    }

    // Sent before the write: the message is what he is waiting on.
    await sayAloud(answer);
    // The text, never the blocks or the audio: a megabyte resent as history.
    await remember([{ role: 'user', content: text }, { role: 'assistant', content: answer }]);
  } catch (err) {
    console.error("doji-eugenia:", why(err));
    await tg("sendMessage",
      { chat_id: CHAT_ID, text: "Something broke on my side, jefe. Try again in a moment." })
      .catch(() => {});
  }
}

// Keeps work alive past the response. The catch matters: nothing awaits it.
function background(work: Promise<unknown>) {
  const guarded = work.catch(err => console.error("doji-eugenia:", why(err)));

  const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
  // Logged, because without it the worker can be reclaimed at the 200 and the
  // answer dies mid-generation, reading like a model call that hung.
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
      // Messages and taps, so the webhook registers both in allowed_updates.
      // Answer first, work after.
      background(update?.callback_query
        ? handleFeedback(update.callback_query)
        : handleMessage(update));
      return json({ ok: true });
    }
    if (secretMatches(fromCron, CRON_SECRET)) {
      // Cron posts nothing; the trades trigger posts {trade, event}. Parsed from
      // text, since req.json() throws on an empty body.
      const raw = (await req.text()).trim();
      const sent = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
      const url  = new URL(req.url);

      // ?embed=1 alone works before answering: it is called until `left: 0`,
      // and it is the one flag no cron job dispatches — agree.test.mjs holds that.
      if (url.searchParams.get("embed") === "1") return await postScheduled(url);

      /* Everything else answers before it works. The request idle timeout is
         150s on every plan, so a briefing that completed perfectly still handed
         pg_net a 504 — indistinguishable in the only dispatch record from a
         call that never ran. Answering first makes a non-2xx mean what it
         says. The body names the job, since the response row carries no URL. */
      if (sent?.trade) {
        background(postTradeEvent(String(sent.trade), String(sent.event ?? 'opened'))
          .catch(err => jobFailed('trade', err)));
        return json({ ok: true, accepted: "trade event" });
      }
      background(postScheduled(url));
      return json({ ok: true, accepted: url.search.slice(1) || "hourly" });
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  } catch (err) {
    // pg_net discards this; only the console sees it.
    console.error("doji-eugenia:", why(err));
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
