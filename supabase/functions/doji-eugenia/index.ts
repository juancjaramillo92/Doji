// ═══════════════════════════════════════════════════════════════════════════
// EUGENIA — market briefing and conversation  ·  Supabase Edge Function (Deno)
// ───────────────────────────────────────────────────────────────────────────
// The second bot: Gladys collects the journal, Eugenia does macro. Three
// callers, told apart by the secret they present:
//
//   x-doji-key                        the scheduled jobs and the trades
//                                     trigger in schema.sql, and her own
//                                     speaking worker — postScheduled reads
//                                     which.
//   x-telegram-bot-api-secret-token   Telegram — he replied, answer him.
//   x-laptop-key                      her face on his laptop — he spoke to
//                                     it, with his chart when he shows it,
//                                     or it asks after the briefing.
//
// She owns no column of `trades` and has no write path to it: she reads the
// journal through eugenia_trades, granted SELECT alone, and writes only her
// own tables.
//
// The schedule is decided here rather than in cron, which runs in UTC: the job
// runs hourly and dueNow answers against New York's own clock.
//
// Her cron secret is not harmless: here `?force=1` spends money, a briefing at
// a time. The bound is the spend limit on the Anthropic key's workspace, the
// one place one can be enforced.
//
// Deploy:   supabase functions deploy doji-eugenia --no-verify-jwt
// Register: setWebhook with secret_token = EUGENIA_WEBHOOK_SECRET and
//           allowed_updates = ["message", "callback_query"] — without the
//           second, the taps under a briefing are never delivered.
// Secrets:  EUGENIA_BOT_TOKEN, EUGENIA_WEBHOOK_SECRET, TELEGRAM_CHAT_ID,
//           DOJI_CRON_SECRET, ANTHROPIC_API_KEY, SB_SECRET_KEY; optional —
//           each guarded where it is used — STT_URL, STT_KEY, TTS_KEY,
//           EMBED_KEY, and EUGENIA_LAPTOP_SECRET, which, unset, shuts the
//           laptop's door
// ═══════════════════════════════════════════════════════════════════════════
import { SYSTEM, CONSOLIDATE, CRITIC, TRIM, TRADE_EVENT, REVIEW, CHANNELS, CHANNEL_STATES } from "./prompt.ts";
import { ALWAYS, SECTIONS, VERSION } from "./strategy.ts";
// Pure and imported, so the parts that decide are testable.
import {
  checkRules, adherenceList, dayStanding, DAY_LOSS, isBroker, HIGH, HOME, weekOf, FULL_STOP, TO_BREAK_EVEN,
  TARGET_MIN, TARGET_MAX,
  type TradeRow, type Standing, type Stop, type RuleResult,
} from "./adherence.ts";
import { journalStats, statsList } from "./journal.ts";
import { foldStructure, READINGS, GRID, ADR_SESSIONS, type Structure, type Turn, type Shape } from "./structure.ts";
import {
  env, secretMatches, json, nyClock, nyDate, telegram, sbHeaders, SB_URL, SB_KEY, why, marketOpen, CHARTS,
  FED_DECISION, type Candle, type Period,
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
   being right alone settles nothing. */
export function dueNow(now: Date, briefed: boolean, consolidated: boolean):
    Brief | 'consolidate' | null {
  const brief = briefDue(now);
  if (brief) return brief;
  const retry = retryDue(now);
  if (retry && !briefed) return retry;
  // The gate makes 23:00 a retry rather than a second pass.
  return (consolidateDue(now) || consolidateRetryDue(now)) && !consolidated ? 'consolidate' : null;
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
    "entry and fill time (UTC), pnl, net_pnl, size_oz, open_day, setup, the three discipline " +
    "answers, planned_sl, planned_tp and best_price. A discipline answer of null means " +
    "unanswered, which is NOT 'no'. pnl is the figure to read: net_pnl, the broker's own, " +
    "where a close alert came, and the figure the poller worked out where none did. " +
    "size_oz is the position size in ounces; lots are oz / 100. planned_sl and planned_tp " +
    "are the stop and target as first seen on the open position, and best_price the best " +
    "price it reached while open. These four are written by the poller alone, so a trade " +
    "it never reached has none.",
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
    "tomorrow. Write a fact as what is true of him — 'he reads the first paragraph " +
    "and stops' — never as an order to yourself, which reads back next month as " +
    "one he gave. Never a note that a tool, a source or a read of yours failed or " +
    "came back empty: that is fixed by the time it matters, and the note would " +
    "have you refusing for months. Never an approach that did not work written up " +
    "as one that does. Use kind='instruction' for something he has told you to do " +
    "or stop doing, in his own words: those are standing, and every later message " +
    "obeys them. Use kind='commitment' for something he has said HE will do or stop " +
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
        type: "array",
        items: { type: "integer" },
        description:
          "Optional. The ids of the notes this one replaces, taken from the bracketed " +
          "number beside each. Usually one: whenever the new line contradicts, corrects " +
          "or updates an existing one — the old note stops being shown rather than " +
          "sitting alongside the new one disagreeing with it. Several when the new line " +
          "merges notes that already say the same thing into one.",
      },
    },
    required: ["note", "kind"],
    additionalProperties: false,
  },
} as const;

/* ─── Where he stands on each channel ──────────────────────────────────────
   The channels her teaching is anchored to: a row each rather than a
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
export const NOTES = 20;

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
// One past the window, so a list that overflows can say so: otherwise the
// twenty-first instruction leaves every prompt and /notes with nothing marking
// the loss, and she stops obeying what he believes she took.
async function readNotes(kind: string): Promise<Note[]> {
  return readRows<Note>('Notes',
    `eugenia_notes?select=id,note&kind=eq.${kind}` +
    `&superseded_by=is.null&order=id.desc&limit=${NOTES + 1}`);
}

type Note = { id: number; note: string };

// The number is how a note is named when one is retired — in both renderings.
const noteLine = (n: Note) => `[${n.id}] ${n.note}`;

// Both renderings show the window and say how many it holds, so the nightly
// pass can merge before a list overflows, and he can see that one did.
const inWindow = (ns: Note[]) => ns.slice(0, NOTES);
const howMany = (ns: Note[]) =>
  ns.length > NOTES ? `more than ${NOTES}, the oldest not shown` : `${ns.length}`;

// What every tool that writes answers when the write failed and the failure is
// not his to hear about.
const UNSAVED = "That did not save. Carry on and do not mention it.";

/* Truncated rather than refused, and never throws: the reply she is writing
   matters more than the note, and a throw would cost the whole of it. That is
   also how she survives running without her tables: no memory, every answer
   lands.

   Failures say which kind failed. A lost fact she need not mention; a lost
   INSTRUCTION she is about to acknowledge, and an acknowledgement of something
   never stored means he stops repeating a thing she will keep doing. */
async function writeNote(note: unknown, kind: unknown, supersedes: unknown): Promise<string> {
  const text = String(note ?? "").trim();
  if (!text) return "Nothing to remember.";

  // An unrecognised kind takes the quieter branch.
  const k = (NOTE_KINDS as readonly string[]).includes(String(kind)) ? String(kind) : 'fact';
  const kept = text.slice(0, NOTE_MAX);
  const cut = kept.length < text.length;

  // Only a retirement or a cut needs the new row back; an unread body holds its
  // connection open. Several ids is a merge; a lone number is taken too, since
  // this is where the model's arguments enter.
  const old = [supersedes ?? []].flat().map(n => Math.trunc(Number(n)))
    .filter(n => Number.isFinite(n) && n > 0);
  const retiring = old.length > 0;

  try {
    // Embedded before the insert, so the note lands with its vector in one
    // write; caught, because a lost vector must never read as a lost note.
    const [vec] = await embed([kept]).catch(() => null) ?? [];
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_notes`, {
      method: "POST", headers: sbHeaders(retiring || cut ? "return=representation" : "return=minimal"),
      body: JSON.stringify([{ note: kept, kind: k, ...(vec ? { embedding: vec } : {}) }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const [row] = retiring || cut ? await res.json() : [];

    // The new note is written before the old one is retired: a failed
    // retirement leaves two live notes, recoverably, never neither.
    if (retiring) {
      const done = await fetch(
        `${SB_URL}/rest/v1/eugenia_notes?id=in.(${old.join(',')})&superseded_by=is.null`, {
          method: "PATCH", headers: sbHeaders("return=representation"),
          body: JSON.stringify({ superseded_by: row.id }),
        });
      // A miss must not pass as done, or she believes a contradiction is gone
      // while it is still handed to her every turn — each id is answered for.
      const hit: number[] = done.ok ? (await done.json()).map((r: Note) => r.id) : [];
      const missed = old.filter(id => !hit.includes(id));
      if (missed.length) {
        return `Remembered, but ${missed.length > 1 ? 'notes' : 'note'} ${missed.join(', ')} ` +
               `${missed.length > 1 ? 'are' : 'is'} not there to retire — ` +
               `it may already be superseded. Check the list you were given.`;
      }
    }

    /* Written again now, every kind: "shorter next time" left a fact cut
       mid-sentence in her window until he found it, note 37 on 28 October. Its
       id is handed back so the rewrite retires it. */
    if (cut) {
      return `Kept, but cut at ${NOTE_MAX} characters: "${kept}". Write it again now, shorter, ` +
             `with supersedes ${row.id} so the cut one is retired` +
             (k !== 'fact' ? ', and say it back to him to check it is still what he meant.' : '.');
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
    // Empty means the channels' seed rows are missing and every move drops.
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

/* R-19's calendar reads over check_rules' window: TradingView's high-rated US
   releases — only rows with its id, since her older typed ones were never a
   rating he chose — a day early, as a UTC bound would drop the evening before;
   and the fetched weeks a further seven back, since the window's first day sits
   in a week that began before it. */
export const RULE_RELEASES = 500;

export function releasesQuery(days: unknown, now = Date.now()): string {
  return `eugenia_calendar?select=at&importance=eq.${HIGH}&country=eq.${HOME}&tv_id=not.is.null` +
         `&at=gte.${windowStart(days, now, 1)}&order=at.desc&limit=${RULE_RELEASES}`;
}

/* A full read of the releases is not the whole window either: the oldest weeks
   would still be marked fetched while their releases never arrived, and R-19
   would never look for a print in them. So a full read covers only the weeks
   after the one its oldest release falls in. */
export function coveredWeeks(weeks: string[], releases: { at: string }[]): Set<string> {
  const reach = releases.length === RULE_RELEASES ? weekOf(new Date(releases[releases.length - 1].at)) : '';
  return new Set(weeks.filter(w => w > reach));
}

// R-02's and R-19's read, from a week before the window so a position opened
// before it still has its first sighting.
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
   half he can check. adherence.ts says why twelve.
   ───────────────────────────────────────────────────────────────────────── */
const CHECK_TOOL = {
  name: "check_rules",
  description:
    "Check his journal against the twelve rules a row can actually answer — R-01, " +
    "R-02, R-03, R-04, R-10, R-11, R-12, R-13, R-15, R-16, R-18 and R-19 — over the last N days. Returns a " +
    "verdict per rule with the counts behind it and the rows that failed. Use it " +
    "whenever he asks how he has been following his rules, or before saying " +
    "anything about his discipline: this is computed from the rows, so it is not " +
    "something to reproduce by reading trades yourself. A verdict of unknown means " +
    "the data cannot decide it and is NEVER the same as a pass. The other six " +
    "rules are judgment rules and nothing stored can check them — say so " +
    "rather than implying the twelve are the whole strategy.",
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
   R-19 cannot be judged against a calendar in one and nothing in the other.
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
    "reward-to-risk, how much of the total is the broker's settled figure, his " +
    "own answers to whether he followed his rules, respected his stop and " +
    "respected his target, each over the trades that answered it with the " +
    "unanswered counted apart, and the same broken down by session and by " +
    "setup. The rules answer is the only record of entering on the touch, §9 of " +
    "his strategy, so a rate of it over a stretch with many blanks is a rate of " +
    "his answering as much as of his discipline: say so. These are " +
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
   Filed from TradingView, keyed on its id, so nothing she writes can mint
   a second row for one release. Two callers file it: the briefing, before it
   reads, and the quarter-hourly release job, which is how an actual lands
   within fifteen minutes of publication. Read through doji-tradingview with
   the cron secret she already holds.

   A rolling window rather than a civil day — the Sunday briefing is about a
   week not yet started. The forward reach is the half to keep: the weekday
   briefing carries tomorrow morning's prints, and at twenty-four hours the
   08:00 briefing left tomorrow's 08:30 print unfiled until tomorrow.
   Twenty-eight carries it past tomorrow's 10:00. Read and write share the
   constant.
   ───────────────────────────────────────────────────────────────────────── */
const CAL_BACK = 12, CAL_AHEAD = 28;

/* Every market read is bounded, and what is left when it runs out is the
   caller's own sentence for a failed read. Unbounded, a feed that stopped
   answering held the caller until the platform closed the request at 150s —
   a 7 October look spent that long learning TradingView was down — and in a
   briefing the wait lands on the writing worker's clock. TradingView's doors,
   the broker's price and the CFTC's count all carry it. */
const READ_MS = 45_000;

/* Every door of doji-tradingview she reads, behind the cron secret: its
   answer, or a throw naming the door and the reason it gave. */
async function tvRead(door: string, query = ""): Promise<any> {
  const signal = AbortSignal.timeout(READ_MS);
  try {
    const res = await fetch(`${SB_URL}/functions/v1/doji-tradingview?${door}=1${query}`,
                            { headers: { "x-doji-key": CRON_SECRET }, signal });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok || !answer.ok) throw new Error(`TradingView ${door}: ${answer.error ?? `HTTP ${res.status}`}`);
    return answer;
  } catch (err) {
    // The abort's own message is "Signal timed out." and names no door, and
    // the calendar's meter rows are where an outage is read afterwards.
    throw signal.aborted ? new Error(`TradingView ${door}: no answer in ${READ_MS / 1000}s`) : err;
  }
}

// What doji-tradingview's `foldCalendar` answers, one release each.
interface TvEvent {
  id: string; at: string; title: string; country: string; category: string | null;
  importance: string; timed: boolean;
  period: string | null; consensus: string | null; prior: string | null; actual: string | null;
  ticker: string | null;
}

/* At home, releases only — `timed` false is a marker, not a print — and medium
   or above: low is mortgage rates and rig counts, paid for on every request
   and moving nothing. Since TradingView's ids changed on 3 November it rates
   some of that medium, so the rating no longer keeps it out and `bnd` and
   NOISE name it.

   Abroad, what she asked for, by kind rather than by rating, which would miss
   some of it: TradingView rates China's reserves low and a dozen surveys high.
   The central banks of the euro area, Britain and Japan, less the money supply
   and reserves the same change rated medium beside them; each economy's
   headline inflation, by its title, since Britain's core MoM is rated high
   too; China's reserves. None of it counts for R-19 or R-20, which are about
   US releases. */
const BANKS = ['EU', 'GB', 'JP'];
const NOISE = /^(USDA|WASDE) |Rig Count|Ethanol|^(Car|Truck) Sales$|^MBA (?!30-Year Mortgage Rate$)|Money Supply|Broad Money|Reserves$/;

export function wanted(e: TvEvent): boolean {
  if (e.country === HOME) return e.timed && e.importance !== 'low' && e.category !== 'bnd' &&
    !NOISE.test(e.title);
  if (e.category === 'mny' && BANKS.includes(e.country)) return e.importance !== 'low' && !NOISE.test(e.title);
  if (e.category === 'prce') return e.importance === 'high' && /^Inflation Rate YoY/.test(e.title);
  return e.country === 'CN' && e.title === 'Foreign Exchange Reserves';
}

/* A figure TradingView has not published is left out, never sent as null:
   under merge-duplicates a null erases an actual already filed. The period
   joins the name, since the title alone does not say which month, and abroad
   the country leads it, since France, Italy and Germany each publish an
   "Inflation Rate YoY Prel". */
export function calendarRows(events: TvEvent[], from: number, to: number) {
  return events
    .filter(wanted)
    .filter(e => {
      const at = Date.parse(e.at);
      return at >= from && at <= to;
    })
    .map(e => {
      const title = e.country === HOME ? e.title : `${e.country} ${e.title}`;
      const row: Record<string, string> = {
        tv_id: e.id, at: new Date(e.at).toISOString(),
        name: e.period ? `${title} (${e.period})` : title,
        country: e.country, importance: e.importance, source: 'tradingview',
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

/* A whole week, then the mark that says so (calendar_weeks). `week` is a New
   York Sunday; TradingView is asked in UTC days, so the read runs to the next
   Sunday and keeps what weekOf files under this week. The mark goes down only
   after the rows, so a failure between leaves the week unknown rather than
   covered and empty. */
export async function fileWeek(week: string, now = Date.now()): Promise<number> {
  const next = utcDay(Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000);
  const rows = calendarRows(await readTvCalendar(week, next), 0, Infinity)
    .filter(r => weekOf(new Date(r.at)) === week);
  const filed = await upsertCalendar(rows);
  const res = await fetch(`${SB_URL}/rest/v1/calendar_weeks?on_conflict=week`, {
    method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([{ week, fetched_at: new Date(now).toISOString() }]),
  });
  if (!res.ok) throw new Error(`week ${week} filed and not marked (HTTP ${res.status}) — has schema.sql been applied?`);
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
   driven.

   A week already marked filed is not walked again. A row is keyed on
   TradingView's id, and when its ids changed on 3 November every week behind
   it came back under new ones, so walking a filed week files each release
   twice. A walk that cannot read the marks does not start: the read throws,
   and the door fails as any job does, with its row and its apology. */
const HISTORY_PAUSE_MS = 35_000;

export async function postHistory(start: string, pause = HISTORY_PAUSE_MS): Promise<Response> {
  const weeks = historyWeeks(start, Date.now());
  if (!weeks) return json({ ok: false, error: "history takes a date, YYYY-MM-DD" }, 400);
  const marked = new Set((await readRows<{ week: string }>('Weeks', `calendar_weeks?select=week` +
    `&week=gte.${weeks[0]}&week=lte.${weeks.at(-1)}&order=week.desc&limit=${HISTORY_WEEKS}`)).map(m => m.week));
  for (const week of weeks.filter(w => !marked.has(w))) {
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

/* ─── How a release has run against expectations ───────────────────────────
   The calendar is filed back as far as the history door has walked, each
   release with its consensus and its actual, and every other read of it
   reaches a day or a week: how core inflation has run against the forecast
   for a year was on file and out of her reach. Past prints of one release,
   oldest first, each beside what was expected. The tally is worked out here,
   since lining up two dozen figures and their units by eye is what a model
   does worst; a pair in different units, or one that is not a number, is
   counted apart rather than guessed. Above and below are arithmetic, never
   good or bad: a higher unemployment rate is above consensus too.

   Matched on the start of the name, so the period every row carries is left
   off and a release from abroad, which leads with its country's code, does not
   answer for one at home.
   ───────────────────────────────────────────────────────────────────────── */
export const RELEASE_PRINTS = 24;

const RELEASES_TOOL = {
  name: "get_releases",
  description:
    `Past prints of one release from the calendar on file — the newest ${RELEASE_PRINTS} ` +
    "inside the months asked, oldest first, each with its actual against the consensus " +
    "and the prior, and what gold did fifteen and sixty minutes on where that is on file — " +
    "and a count of how many came in above, below or on the consensus. " +
    "Name the release whole, as the calendar lists it, without the period in brackets: " +
    `'Core Inflation Rate MoM', 'Non Farm Payrolls', '${FED_DECISION}' for the Fed's decision. One ` +
    "from abroad starts with its country's code: 'EU Inflation Rate YoY Flash'. Use it " +
    "when how a release has run against expectations changes what you say about the " +
    "next one, and quote that history from here, never from a search.",
  input_schema: {
    type: "object",
    properties: {
      release: { type: "string", description: "The release's name as the calendar lists it, without its period." },
      months: { type: "integer", description: "How far back to read, 1 to 120. Defaults to 24." },
    },
    required: ["release"],
    additionalProperties: false,
  },
} as const;

// A boundary: cleaned and clamped, never thrown.
export const releaseName = (release: unknown) => String(release ?? "").trim().slice(0, 80);

/* The name whole, with or without its period, every character of it a
   literal: a prefix read "Interest Rate on Reserve Balances" into the Fed's
   decisions, and "Core Inflation Rate" into both the MoM and the YoY. */
export function printsQuery(name: string, months: unknown, now = Date.now()): string {
  const n = Math.min(Math.max(Math.trunc(Number(months)) || 24, 1), 120);
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - n);
  const whole = `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(.*\\))?$`;
  return `eugenia_calendar?select=${RELEASE_COLUMNS}&name=imatch.${encodeURIComponent(whole)}` +
         `&actual=not.is.null&at=gte.${from.toISOString()}&at=lte.${new Date(now).toISOString()}` +
         `&order=at.desc&limit=${RELEASE_PRINTS}`;
}

const yearDay = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', day: 'numeric', month: 'short', year: 'numeric',
}).format(new Date(iso));

// Newest first as read, so the limit keeps the latest; told oldest first.
export function printsList(rows: Release[], release: string, moves: Reaction[] = []): string {
  // A figure as TradingView writes it — `0.3%`, `254K`, `-1.2B` — split into
  // its number and its unit, or null for anything else.
  const figureOf = (v: string | null) => {
    const m = v?.match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s]*)$/);
    return m ? { n: Number(m[1]), unit: m[2] } : null;
  };
  const told = [...rows].reverse();
  const tally = { above: 0, below: 0, on: 0, apart: 0 };
  const byRelease = new Map(moves.map(m => [m.release, m]));
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
  const hour = { above: [0, 0], below: [0, 0] };
  const lines = told.map(r => {
    const a = figureOf(r.actual), c = figureOf(r.consensus);
    const side = a && c && a.unit === c.unit ? (a.n > c.n ? 'above' : a.n < c.n ? 'below' : 'on') : 'apart';
    tally[side]++;
    const m = byRelease.get(r.id);
    if (m?.after_60 != null && (side === 'above' || side === 'below')) hour[side][m.after_60 > m.before ? 0 : 1]++;
    return `· ${yearDay(r.at)}, ${r.name}: ${r.actual}` +
           (r.consensus ? ` against ${r.consensus} expected` : ", no consensus on file") +
           (r.prior ? `, after ${r.prior}` : "") +
           (m ? `; gold ${m.before} at the print` +
                (m.after_15 != null ? `, ${signed(m.after_15 - m.before)} fifteen minutes on` : "") +
                (m.after_60 != null ? `, ${signed(m.after_60 - m.before)} an hour on` : "") : "");
  });
  const onFile = hour.above[0] + hour.above[1] + hour.below[0] + hour.below[1];
  const reach = rows.length === RELEASE_PRINTS
    ? `\nThe read stops at its ${RELEASE_PRINTS} newest prints, so it reaches back only to ` +
      `${yearDay(told[0].at)}.`
    : "";
  return `How "${release}" has printed against the consensus, oldest first, from the calendar on file:\n` +
    `${lines.join("\n")}\nAgainst the consensus: ${tally.above} above, ${tally.below} below, ` +
    `${tally.on} on it` + (tally.apart ? `; ${tally.apart} with no consensus or no comparable figure` : "") +
    `. Above and below are arithmetic, not good or bad news.` +
    (onFile ? `\nGold an hour on, where it is on file: after a print above the consensus, ${hour.above[0]} higher ` +
      `and ${hour.above[1]} not; after one below, ${hour.below[0]} higher and ${hour.below[1]} not. That is ` +
      `what these prints did, never a rule for the next one.` : "") + reach;
}

async function readPrints(release: unknown, months: unknown): Promise<string> {
  const name = releaseName(release);
  if (!name) return "Name the release as the calendar lists it, without its period.";
  try {
    const rows = await readRows<Release>('Prints', printsQuery(name, months));
    const moves = rows.length ? await readRows<Reaction>('Reactions',
      `eugenia_reactions?select=*&release=in.(${rows.map(r => r.id).join(",")})&order=at.desc&limit=${RELEASE_PRINTS}`) : [];
    return rows.length
      ? printsList(rows, name, moves)
      : "Nothing on file carries that name and a figure in that window. Check the " +
        "name against the calendar, and say you have no record rather than that it never printed: " +
        "the calendar holds only what was filed.";
  } catch (err) {
    console.error("doji-eugenia: prints read failed —", why(err));
    return "The calendar on file could not be read just now. Do not take a release's history from a " +
      "search; say you do not have it.";
  }
}

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

/* The market around gold, in a conversation: the reads the briefing is handed,
   the headlines, plus the rate odds and the speculators' count — "is gold
   crowded" gets asked on a Wednesday. Without it her only source was a web
   search, against her own rule. */
const AROUND_TOOL = {
  name: "get_around",
  description:
    "The market around gold, from TradingView: the dollar index, the two- and " +
    "ten-year yields, the real yield, the breakeven, silver, oil, the S&P 500, the VIX " +
    "and gold's own volatility index, and " +
    "abroad the German, French, Italian, UK and Japanese ten-year yields and the " +
    "euro and the offshore yuan, each a level now beside the level at a stated time, and its daily close a week, " +
    "a month and three months back; and gold's and the dollar's " +
    "headlines from the last six hours, titles only; what fed funds futures price for " +
    "the Fed's meetings over the next year; central banks' gold reserves and the two " +
    "largest US gold funds' assets and money in or out; the CFTC's weekly count of " +
    "where the speculators stand in gold futures; and what COMEX gold futures traded in " +
    "the last finished session against the twenty before. Use it whenever you are about " +
    "to say what the dollar, yields or anything else around gold did, or what " +
    "crossed the wires, and quote those from here rather than from a search. " +
    "Every line says what it is measured from; say that window, never 'today'. " +
    "Like get_market, it says nothing about where price goes next.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
} as const;

/* His charts, in a conversation: what the briefing is handed for its call,
   for the call he asks for and the plan he brings without a chart. */
const STRUCTURE_TOOL = {
  name: "get_structure",
  description:
    "His six charts, read off his own broker's bars every quarter hour: the turns on the daily, " +
    "4H and 1H, the sequence they make and whether the last close has broken it; where price has turned on the 1H and 30m, with the $25 " +
    "grid beside them and where the two agree; the previous day's and week's highs and lows and " +
    "the daily and 4H turns near price; which of those sit at the edge of the week's hourly " +
    "range and which inside it; equal highs and lows still resting, the liquidity pools of his " +
    "step 2; wicks through a turn that closed back; the sessions' ranges; the average daily range; " +
    "and the last four closed daily, 4H, 15m and 5m candles, each with its body, its wicks and " +
    "the marks it traded through with the side it closed on. Use it before judging his bias or " +
    "his level when he has sent no chart, and before filing a call, whose levels come off it. It is " +
    "your map, computed the same way every time, and not his. Every figure in it has already " +
    "printed; like get_market, it says nothing about where price goes next.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
} as const;

/* His levels, as he marks them: price alerts in TradingView. Read live when
   she asks, unlike the market's copy — an alert is set the minute before he
   talks a setup through, and a copy fifteen minutes old would miss it. */
const ALERTS_TOOL = {
  name: "get_alerts",
  description:
    "The price alerts he has active in TradingView: each level, the symbol, how it " +
    "triggers, when he set it and whether it has fired. They are the levels he marks " +
    "for a setup, so read them when he talks one through or mentions his alerts, and " +
    "judge each against your map — at the edge of the range or inside it, and so which " +
    "of his setups it is. The message he writes on an alert is not in what is served. " +
    "They are his levels, never a call of yours; like get_market, they say nothing " +
    "about where price goes next.",
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
    const res = await fetch(MARKET_URL, { headers: { "x-doji-key": CRON_SECRET },
                                          signal: AbortSignal.timeout(READ_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const quote = await res.json();
    if (!quote?.ok || typeof quote.bid !== 'number') throw new Error("no readable quote");
    return quote as Quote;
  } catch (err) {
    await unread("price", why(err));
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

/* One rendering of a quote, with the window inside it, for both callers —
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

/* Kept cut rather than refused, as a note is, and said as a note's cut is: the
   paragraph is handed back with every turn until the next pass, and on 27
   October a portrait went on ending "or jo" with nothing to tell her. Said
   while the pass is still hers, so she can write it again. */
const cutAt = (max: number, kept: string) =>
  `Saved, but cut at ${max} characters, so it now ends "…${kept.slice(-60)}". Write it again, shorter.`;

async function setThesis(thesis: unknown): Promise<string> {
  const text = String(thesis ?? "").trim();
  if (!text) return "Nothing to write.";
  const kept = text.slice(0, THESIS_MAX);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_thesis?id=eq.current`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({ thesis: kept, moved_on: nyDate(new Date()), updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Empty means the thesis seed row is missing, as with setChannel.
    if ((await res.json()).length === 0) {
      return "There is no thesis row — schema.sql has not been applied, so nothing was saved. Say nothing about this to him.";
    }
    return kept.length < text.length ? cutAt(THESIS_MAX, kept) : "Thesis updated.";
  } catch (err) {
    console.error("doji-eugenia: thesis not written —", why(err));
    return UNSAVED;
  }
}

/* ─── How she reads him ────────────────────────────────────────────────────
   The thesis's twin, about him: the notes are lines in a window of twenty, so
   once a twenty-first fact arrives the oldest stops shaping anything unless she
   thinks to search for it. One paragraph carries what they add up to, and the
   lines can roll out of view without taking the lesson with them. Nightly only,
   for the thesis's reason; moved, not replaced. Never on the trade look, which
   reaches him in a position.
   ───────────────────────────────────────────────────────────────────────── */
export const PORTRAIT_MAX = 800;

const PORTRAIT_TOOL = {
  name: "set_portrait",
  description:
    "Rewrite how you read him — what his notes, his trades and his record against " +
    "his own word add up to. At the nightly pass and nowhere else. It is handed " +
    "back to you with every briefing and reply, so it keeps an old lesson about him " +
    "alive after the note that taught it has rolled out of the window. MOVE it " +
    "rather than replacing it: most nights it is the same man one day further on. " +
    "Statements of what is true of him, each one something seen more than once, " +
    "never an order to yourself and never anything about today's market.",
  input_schema: {
    type: "object",
    properties: {
      portrait: { type: "string", description: `How you read him now, at most ${PORTRAIT_MAX} characters.` },
    },
    required: ["portrait"],
    additionalProperties: false,
  },
} as const;

async function setPortrait(portrait: unknown): Promise<string> {
  const text = String(portrait ?? "").trim();
  if (!text) return "Nothing to write.";
  const kept = text.slice(0, PORTRAIT_MAX);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_portrait?id=eq.current`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({ portrait: kept, moved_on: nyDate(new Date()), updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Empty means the seed row is missing, as with setThesis.
    if ((await res.json()).length === 0) {
      return "There is no portrait row — schema.sql has not been applied, so nothing was saved. Say nothing about this to him.";
    }
    return kept.length < text.length ? cutAt(PORTRAIT_MAX, kept) : "Portrait updated.";
  } catch (err) {
    console.error("doji-eugenia: portrait not written —", why(err));
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

/* ─── Her record ───────────────────────────────────────────────────────────
   Every read she gives says what would prove it wrong, and this is what
   looks. The nightly pass files each read of the day with a verdict on the
   test she stated — never on where price went, which would pull a read toward
   the forecast the prohibitions forbid — and the record comes back to the two
   paths that give reads, so how loudly she holds a view is set by how her
   views have done. Filed and judged in one write: a read is about today's
   news, and 22:00 is after the day it was about.
   ───────────────────────────────────────────────────────────────────────── */
export const READ_VERDICTS = ['held', 'wrong', 'untested'] as const;
export const READ_MAX = 300;
// How firmly a read was said, read off her words at night: the two halves the
// record compares, since a firm read should miss less often than a light one.
export const READ_FIRMNESS = ['light', 'firm'] as const;

const RECORD_TOOL = {
  name: "record_read",
  description:
    "File one read you gave today — a view labelled as yours, with what you said " +
    "would prove it wrong — and its verdict. At the nightly pass and nowhere else. " +
    "'wrong' when the thing you said would prove you wrong happened; 'held' when it " +
    "had its chance and did not, and what you were handed shows that; 'untested' " +
    "when the day did not settle it, what would settle it is not in front of you, " +
    "or the test was gold's own price. Judge only the test you stated, never where " +
    "price went. Say how firmly you said it, read off your own words, and which " +
    "channel it ran through. On a read that proved wrong, name the one link in the " +
    "chain you misread.",
  input_schema: {
    type: "object",
    properties: {
      reading: { type: "string", description: `The read, in your words as you said it, at most ${READ_MAX} characters.` },
      test: { type: "string", description: `What you said would prove it wrong, at most ${READ_MAX} characters.` },
      verdict: { type: "string", enum: READ_VERDICTS },
      evidence: { type: "string", description: `What in front of you settled it, or why nothing did, at most ${READ_MAX} characters.` },
      firmness: { type: "string", enum: READ_FIRMNESS,
                  description: "'firm' when you said it as a view you held with conviction; 'light' when you said it as a lean." },
      channel: { type: "string", enum: CHANNELS.map(([id]) => id),
                 description: "The channel the read's chain ran down — where gold was reached from." },
      lesson: { type: "string",
                description: `Only when the verdict is wrong: the one link in the chain you misread, in a sentence of at most ${NOTE_MAX} characters — "I read the dollar as leading when the two-year was". Never "be more careful".` },
    },
    required: ["reading", "test", "verdict", "evidence", "firmness", "channel"],
    additionalProperties: false,
  },
} as const;

/* Never throws, for writeNote's reason. The verdict is checked here, or the
   check constraint answers a bad one with a 400 that reads as a database
   fault. */
async function recordRead(reading: unknown, test: unknown, verdict: unknown,
                          evidence: unknown, firmness: unknown, lesson: unknown,
                          channel: unknown): Promise<string> {
  const said = String(reading ?? "").trim().slice(0, READ_MAX);
  const against = String(test ?? "").trim().slice(0, READ_MAX);
  if (!said || !against) return "A read is filed with what would prove it wrong, or not at all.";
  const v = String(verdict ?? "");
  if (!(READ_VERDICTS as readonly string[]).includes(v)) {
    return `"${v}" is not a verdict. They are ${READ_VERDICTS.join(", ")}.`;
  }
  const firm = String(firmness ?? "");
  if (!(READ_FIRMNESS as readonly string[]).includes(firm)) {
    return `"${firm}" is not how firmly a read was said. It is ${READ_FIRMNESS.join(" or ")}.`;
  }
  // A miss teaches only with the link named; a lesson on anything else is a
  // lesson from nothing.
  const learnt = String(lesson ?? "").trim().slice(0, NOTE_MAX);
  if (v === 'wrong' && !learnt) return "A read that proved wrong is filed with the link you misread.";
  if (v !== 'wrong' && learnt) return "Only a read that proved wrong carries a lesson. File it without one.";
  const ran = String(channel ?? "");
  if (!CHANNELS.some(([id]) => id === ran)) {
    return `"${ran}" is not a channel. They are ${CHANNELS.map(([id]) => id).join(", ")}.`;
  }
  try {
    // A retry after a pass that failed half-way files the same reads again;
    // the same words on the same day are one read.
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_reads?on_conflict=given_on,reading`, {
      method: "POST", headers: sbHeaders("resolution=ignore-duplicates,return=minimal"),
      body: JSON.stringify([{
        given_on: nyDate(new Date()), reading: said, test: against, verdict: v,
        evidence: String(evidence ?? "").trim().slice(0, READ_MAX) || null,
        firmness: firm, lesson: learnt || null, channel: ran,
      }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "Filed.";
  } catch (err) {
    console.error("doji-eugenia: read not filed —", why(err));
    return UNSAVED;
  }
}

/* ─── Her own calls ────────────────────────────────────────────────────────
   A coach who cannot do the thing is not one, so she trades on paper, on HIS
   rules, and is scored on price. A call is filed before it is said, so nothing
   she offers escapes the record: a call in words alone is a tip nobody scores.

   The rules are checked here rather than trusted to the prompt, the way
   adherence.ts checks his: the stop no further than the $20 a full stop is
   (R-02), the target $25 to $30 away (R-01), the reward at least one and a half
   times the risk (R-08's fourth step). One call a session, as he takes one
   entry a day (R-12), and it lives until the next 17:00 New York roll on a
   weekday — a unique index on that instant is the whole of the one-a-session
   rule.
   ───────────────────────────────────────────────────────────────────────── */
export const CALL_SIDES = ['buy', 'sell'] as const;
/* How the entry goes live. R-07 enters on a confirmation, never on the signal,
   so a call that waits for one is scored as waiting: 'close' is a 5m candle
   reaching the level and closing beyond it the call's way, 'market' is a call
   whose confirmation has already printed. */
export const CALL_CONFIRMS = ['close', 'market'] as const;
// The chart his rules read the confirming candle on.
export const CONFIRM_MS = 300_000;
// R-08's fourth step, at entry.
export const RR_MIN = 1.5;
export const CALL_MAX = 300;

const CALL_TOOL = {
  name: "make_call",
  description:
    "File your own call — a trade you would take, by HIS rules — so that it is scored " +
    "on price tonight. File it before you say it; a call you only say is never scored. " +
    "The stop at most $" + FULL_STOP + " from entry, the target $" + TARGET_MIN + " to $" +
    TARGET_MAX + " from it, the reward at least " + RR_MIN + " times the risk; one call a " +
    "session, living until the next 17:00 New York roll. The condition is what price has " +
    "to do before the entry is live, in his words for it — a retest, a candle closing " +
    "back above a level — or 'at the market' for now. `confirm` is how it is scored: " +
    "'close' waits for a five-minute candle that reaches `level` and closes beyond it " +
    "your way, and only then is the entry live; 'market' is live at once. The entry is " +
    "the price you would be filled at, and it is what is scored.",
  input_schema: {
    type: "object",
    properties: {
      direction: { type: "string", enum: CALL_SIDES },
      entry:     { type: "number", description: "The price you would be filled at." },
      stop:      { type: "number", description: "Where the idea is wrong." },
      target:    { type: "number", description: "Where you take it." },
      condition: { type: "string", description: `What price has to do first, at most ${CALL_MAX} characters.` },
      confirm:   { type: "string", enum: CALL_CONFIRMS,
                   description: "'close' when the entry waits for a 5m close beyond the level, 'market' when it does not." },
      level:     { type: "number", description: "With 'close': the level the candle reaches and closes beyond." },
    },
    required: ["direction", "entry", "stop", "target", "condition", "confirm"],
    additionalProperties: false,
  },
} as const;

/* His rules, as a sentence she can act on, or null. Pure, so each is driven
   both ways. */
export function callProblem(direction: unknown, entry: number, stop: number, target: number,
                            confirm: unknown, level: number): string | null {
  if (!(CALL_SIDES as readonly unknown[]).includes(direction)) return `A call is ${CALL_SIDES.join(" or ")}.`;
  if (![entry, stop, target].every(n => Number.isFinite(n) && n > 0)) return "A call needs an entry, a stop and a target, as prices.";
  const buy = direction === 'buy';
  if (buy ? !(stop < entry && entry < target) : !(target < entry && entry < stop)) {
    return `A ${direction} has its stop ${buy ? "below" : "above"} the entry and its target ${buy ? "above" : "below"} it.`;
  }
  if (!(CALL_CONFIRMS as readonly unknown[]).includes(confirm)) {
    return "Say whether the entry waits for a 5m close beyond a level ('close') or is live now ('market').";
  }
  // The stop is where the idea is wrong, which is back on the far side of the
  // level the candle closed beyond.
  if (confirm === 'close' && !(Number.isFinite(level) && (buy ? stop < level && level <= entry : entry <= level && level < stop))) {
    return `A ${direction} waiting on a close beyond a level has the level between the stop and the entry, ` +
      `the entry ${buy ? "at or above" : "at or below"} it.`;
  }
  const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
  if (risk > FULL_STOP) return `The stop is $${risk.toFixed(2)} away; R-02 allows $${FULL_STOP} at most.`;
  if (reward < TARGET_MIN || reward > TARGET_MAX) {
    return `The target is $${reward.toFixed(2)} away; R-01 takes $${TARGET_MAX}, or $${TARGET_MIN} where the level is hard to reach.`;
  }
  if (reward / risk < RR_MIN) return `That is 1:${(reward / risk).toFixed(2)}; R-08 asks for 1:${RR_MIN} at entry.`;
  return null;
}

/* The next 17:00 New York roll on a weekday, strictly after the call: the
   gold session it belongs to. Walked by the hour, since New York moves by
   whole hours. */
export function expiryOf(made: Date): Date {
  let t = Math.floor(made.getTime() / 3_600_000) * 3_600_000 + 3_600_000;
  for (;;) {
    const { wd, hour } = nyClock(new Date(t));
    if (hour === ROLL_HOUR && wd >= 1 && wd <= 5) return new Date(t);
    t += 3_600_000;
  }
}

/* Never throws, for writeNote's reason. A second call in a session meets the
   unique index and is told so, not stored. */
async function makeCall(direction: unknown, entry: unknown, stop: unknown, target: unknown,
                        condition: unknown, confirm: unknown, level: unknown): Promise<string> {
  const [e, s, t, l] = [entry, stop, target, level].map(Number);
  const problem = callProblem(direction, e, s, t, confirm, l);
  if (problem) return `${problem} Not filed; a call off his rules is not one you make.`;
  const when = String(condition ?? "").trim().slice(0, CALL_MAX);
  if (!when) return "Say what price has to do first, or 'at the market'. Not filed.";
  const made = new Date();
  const until = expiryOf(made);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_calls`, {
      method: "POST", headers: sbHeaders("return=minimal"),
      body: JSON.stringify([{ made_at: made.toISOString(), expires_at: until.toISOString(),
                              direction, entry: e, stop: s, target: t, condition: when,
                              confirm, level: confirm === 'close' ? l : null }]),
    });
    if (res.status === 409) {
      return "You already made this session's call, and it stands until the 17:00 roll. Say that rather than making another.";
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `Filed: ${direction} ${e}, stop ${s}, target ${t}, until ${nyTime(until.toISOString())} ET ${weekday(nyDate(until))}.`;
  } catch (err) {
    console.error("doji-eugenia: call not filed —", why(err));
    return "That call did not file, so it will not be scored. Do not state it as one.";
  }
}

/* ─── Scoring a call on what price did ─────────────────────────────────────
   In code, at night, off the broker's minute bars: a model asked whether a
   target was hit before a stop is the arithmetic a model does worst. Every
   doubt goes against her: on the bar that filled her, only the stop counts;
   a bar touching both stop and target is a loss; the stop moves to break-even
   at +$20 as R-04 moves his, reached on a bar after the fill and effective from
   the bar after that, since a bar's high and low cannot say which came first.
   A call that waits for a close goes live only once a 5m candle opened after
   it — built from the minute bars five minutes at a time, as his chart draws it —
   has reached the level and closed beyond it, and fills on the first touch of
   the entry after that candle closed: a touch before it is the trade R-07
   forbids. A call filed before `confirm` existed is scored on the touch alone.
   A call whose session the bars do not reach is `unread`, never a guess.
   ───────────────────────────────────────────────────────────────────────── */
export const CALL_OUTCOMES = ['won', 'lost', 'scratch', 'open', 'untriggered', 'unread'] as const;

export type Call = { id: number; made_at: string; expires_at: string; direction: string;
                     entry: number; stop: number; target: number; condition: string;
                     confirm: string | null; level: number | null;
                     outcome: string | null; result: number | null;
                     closed_at?: string | null; misread?: string | null; lesson?: string | null };
export type Score = { outcome: typeof CALL_OUTCOMES[number]; triggered_at: string | null;
                      closed_at: string | null; closed_price: number | null; result: number | null };

export function scoreCall(c: Call, candles: Candle[], from: number): Score {
  const made = Date.parse(c.made_at), ends = Date.parse(c.expires_at);
  const none = { triggered_at: null, closed_at: null, closed_price: null, result: null };
  // The market was open somewhere between the call and the first bar served.
  for (let h = made; h < from; h += 3_600_000) if (marketOpen(new Date(h))) return { outcome: 'unread', ...none };

  const start = Math.ceil(made / 60_000) * 60_000;
  const bars = candles.filter(b => b.t >= start && b.t + 60_000 <= ends);
  const buy = c.direction === 'buy';
  const live = c.confirm === 'close' ? confirmedAt(bars, buy, Number(c.level), start) : start;
  const at = live === null ? -1 : bars.findIndex(b => b.t >= live && b.low <= c.entry && c.entry <= b.high);
  if (at < 0) return { outcome: 'untriggered', ...none };

  const gain = (p: number) => Math.round((buy ? p - c.entry : c.entry - p) * 100) / 100;
  const close = (b: Candle, price: number, outcome: Score['outcome']): Score => ({
    outcome, triggered_at: new Date(bars[at].t).toISOString(),
    closed_at: new Date(b.t + 60_000).toISOString(), closed_price: price, result: gain(price),
  });
  let stop = c.stop;
  for (let i = at; i < bars.length; i++) {
    const b = bars[i];
    if (buy ? b.low <= stop : b.high >= stop) return close(b, stop, stop === c.entry ? 'scratch' : 'lost');
    if (i > at && (buy ? b.high >= c.target : b.low <= c.target)) return close(b, c.target, 'won');
    if (i > at && gain(buy ? b.high : b.low) >= TO_BREAK_EVEN) stop = c.entry;
  }
  const last = bars[bars.length - 1];
  return close(last, last.close, 'open');
}

/* When the first 5m candle opened at or after `from` closed, having reached
   the level and closed beyond it the call's way, or null. Five minutes with
   no minute in the bars is no candle, never a guess at one. */
function confirmedAt(bars: Candle[], buy: boolean, level: number, from: number): number | null {
  const candles = new Map<number, Candle>();
  for (const b of bars) {
    const t = Math.floor(b.t / CONFIRM_MS) * CONFIRM_MS;
    if (t < from) continue;
    const c = candles.get(t);
    candles.set(t, c ? { ...c, high: Math.max(c.high, b.high), low: Math.min(c.low, b.low), close: b.close }
                      : { ...b, t });
  }
  for (const c of candles.values()) {
    if (buy ? c.low <= level && c.close > level : c.high >= level && c.close < level) return c.t + CONFIRM_MS;
  }
  return null;
}

/* The poller's last thirty hours of minute bars, and where they begin.
   Throws, for its callers to record. */
async function readNightBars(): Promise<{ from: number; bars: Candle[] }> {
  const res = await fetch(`${SB_URL}/functions/v1/doji-mcp-sync?bars=1`, {
    headers: { "x-doji-key": CRON_SECRET }, signal: AbortSignal.timeout(READ_MS),
  });
  if (!res.ok) throw new Error(`bars: HTTP ${res.status}`);
  const served = await res.json();
  if (!served?.ok || !Array.isArray(served.bars)) throw new Error("bars: no readable answer");
  return served;
}

/* Tonight's scoring: every call whose session has ended and is not yet scored,
   against one read of the bars. The PATCH is filtered on `outcome is null`, so
   a retry never rescores one. Both outcomes are a row; never throws. Exported
   so it is driven against the poller's own door. */
export async function scoreCalls(): Promise<void> {
  try {
    const due = await readRows<Call>('Calls',
      `eugenia_calls?select=*&outcome=is.null&expires_at=lte.${new Date().toISOString()}` +
      `&order=id.desc&limit=10`);
    if (!due.length) return;
    const served = await readNightBars();
    const scored: string[] = [];
    for (const c of due) {
      const score = scoreCall(c, served.bars, served.from);
      const put = await fetch(`${SB_URL}/rest/v1/eugenia_calls?id=eq.${c.id}&outcome=is.null`, {
        method: "PATCH", headers: sbHeaders("return=representation"), body: JSON.stringify(score),
      });
      if (!put.ok) throw new Error(`call ${c.id}: HTTP ${put.status}`);
      if ((await put.json()).length) scored.push(`${c.id} ${score.outcome}`);
    }
    await recordRun({ caller: 'calls', ok: true, detail: `scored ${scored.length}: ${scored.join(", ")}` });
  } catch (err) {
    const reason = why(err);
    console.error("doji-eugenia: calls not scored —", reason);
    await recordRun({ caller: 'calls', ok: false, detail: reason.slice(0, 500) });
  }
}

/* ─── What gold did on each print ──────────────────────────────────────────
   get_releases says how a release ran against its consensus and nothing of
   what gold did on it, which left how gold usually takes one hers to guess. Filed
   each night off the window of minute bars her calls are scored on: gold at
   the open of the print's minute and at the close fifteen and sixty minutes
   on, for every high-rated home print with an actual inside the bars' window
   and an hour behind it. Its own table keyed on the calendar row, so the calendar keeps
   its one writer, and duplicates ignored, so a retry files nothing twice. The
   record grows a night at a time; nothing reads further back than the bars.
   ───────────────────────────────────────────────────────────────────────── */
export type Reaction = { release: number; at: string; before: number; after_15: number | null; after_60: number | null };

/* Null when the print's own minute is not in the bars; a later minute that is
   missing is a null figure, never the nearest one. */
export function reactionOf(at: number, bars: Candle[]): Omit<Reaction, 'release' | 'at'> | null {
  const t = Math.floor(at / 60_000) * 60_000;
  const by = new Map(bars.map(b => [b.t, b]));
  const close = (minutes: number) => by.get(t + (minutes - 1) * 60_000)?.close ?? null;
  const first = by.get(t);
  return first ? { before: first.open, after_15: close(15), after_60: close(60) } : null;
}

/* Never throws; both outcomes are a row, counted on what the insert returned. */
export async function fileReactions(): Promise<void> {
  try {
    const served = await readNightBars();
    const settled = new Date(Date.now() - 3_600_000).toISOString();
    const prints = await readRows<{ id: number; at: string }>('Prints',
      `eugenia_calendar?select=id,at&importance=eq.${HIGH}&country=eq.${HOME}&actual=not.is.null` +
      `&at=gte.${new Date(served.from).toISOString()}&at=lte.${settled}&order=at.desc&limit=20`);
    const rows = prints.flatMap(p => {
      const moved = reactionOf(Date.parse(p.at), served.bars);
      return moved ? [{ release: p.id, at: p.at, ...moved }] : [];
    });
    let filed = 0;
    if (rows.length) {
      const res = await fetch(`${SB_URL}/rest/v1/eugenia_reactions?on_conflict=release`, {
        method: "POST", headers: sbHeaders("resolution=ignore-duplicates,return=representation"),
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      filed = (await res.json()).length;
    }
    await recordRun({ caller: 'reactions', ok: true, detail: `filed ${filed} of ${prints.length} prints` });
  } catch (err) {
    const reason = why(err);
    console.error("doji-eugenia: reactions not filed —", reason);
    await recordRun({ caller: 'reactions', ok: false, detail: reason.slice(0, 500) });
  }
}

/* ─── Why a call lost ──────────────────────────────────────────────────────
   A loss counted says how often; the step of his sequence it failed on says
   where her reading of a chart is weak, as a read's misread link does for the
   news. Filed at the nightly pass, judged by what printed after the call
   against what she said when she made it. `none` is a call that kept every
   step and lost anyway: on his rules a stop is sometimes simply reached, and
   a record that cannot say so blames a step for it. The PATCH is filtered on
   a lost call not yet explained, so a retry never re-files one.
   ───────────────────────────────────────────────────────────────────────── */
export const CALL_STEPS = ['bias', 'level', 'candle', 'none'] as const;
// The unexplained losses the pass is handed: a night that missed leaves more.
const LOSSES_MAX = 10;

const EXPLAIN_TOOL = {
  name: "explain_call",
  description:
    "File why one of your lost calls lost, by its number. At the nightly pass and nowhere " +
    "else. The step of his sequence your reading of the chart got wrong: 'bias' when the " +
    "bigger trend went the other way, 'level' when price traded through the level and " +
    "stayed beyond it, 'candle' when the level held and the candle you took as the " +
    "confirmation was not one, 'none' when every step held and price reached the stop " +
    "anyway. Judged by what printed after the call against what you said when you made it.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "number", description: "The call's number, as the lost calls list it." },
      step: { type: "string", enum: CALL_STEPS },
      lesson: { type: "string",
                description: `Except with 'none': what you misread, in a sentence of at most ${NOTE_MAX} characters — "the 4H had already printed a lower high". Never "be more careful".` },
    },
    required: ["id", "step"],
    additionalProperties: false,
  },
} as const;

/* Never throws, for writeNote's reason. */
async function explainCall(id: unknown, step: unknown, lesson: unknown): Promise<string> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return "A call is explained by its number.";
  const s = String(step ?? "");
  if (!(CALL_STEPS as readonly string[]).includes(s)) return `"${s}" is not a step. They are ${CALL_STEPS.join(", ")}.`;
  const learnt = String(lesson ?? "").trim().slice(0, NOTE_MAX);
  if (s !== 'none' && !learnt) return "A step that failed is filed with what you misread.";
  if (s === 'none' && learnt) return "A call that kept every step carries no lesson. File it without one.";
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_calls?id=eq.${n}&outcome=eq.lost&misread=is.null`, {
      method: "PATCH", headers: sbHeaders("return=representation"),
      body: JSON.stringify({ misread: s, lesson: learnt || null }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(await res.json()).length) return `Call ${n} is not a lost call waiting for its reason.`;
    return "Filed.";
  } catch (err) {
    console.error("doji-eugenia: call not explained —", why(err));
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

/* Effort per caller. The briefing earns `high`; a reply does not —
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
   to research but needs search to supersede rather than duplicate; the trade
   look gets only his strategy and journal. */
const CHAT_TOOLS = [
  WEB_SEARCH,
  WEB_FETCH,
  MARKET_TOOL,
  AROUND_TOOL,
  STRUCTURE_TOOL,
  TRADES_TOOL,
  STATS_TOOL,
  CHECK_TOOL,
  NOTES_TOOL,
  SEARCH_TOOL,
  STRATEGY_TOOL,
  LOOP_TOOL,
  CALL_TOOL,
  RELEASES_TOOL,
  ALERTS_TOOL,
];
const CONSOLIDATE_TOOLS = [NOTES_TOOL, CHANNEL_TOOL, SEARCH_TOOL, THESIS_TOOL, PORTRAIT_TOOL, CLOSE_TOOL,
                           RECORD_TOOL, EXPLAIN_TOOL, CHECK_TOOL, STATS_TOOL];
const TRADE_TOOLS = [STRATEGY_TOOL, TRADES_TOOL];
/* No tools: the gates read a draft and return one. Sharing the briefing's
   array to ride its cache does not work — the array starts the key and the
   effort differs, which invalidates the rest; measured, the critic wrote
   23,309 tokens and read none. The empty array is the smaller write.
   REFACTOR.md R-15. */
const CRITIC_TOOLS: unknown[] = [];

/* The model per caller. A week of eugenia_runs put fourteen release looks
   above five briefings in cost, so the bounded callers moved to Sonnet — and
   the release look, since retired, then died at MAX_ROUNDS twice the next morning. That pair
   is confounded: record_actual had joined its tools eighty minutes before the
   model changed, and its rounds stayed high after the revert. So it proves
   neither half; the policy stands anyway — a cheaper caller that does not
   answer is not cheaper, so a move is one caller at a time with `rounds` read
   after.

   `trim` stays on Sonnet because its array is empty: one request, no loop, no
   cap to reach. The critic does not move: it runs last, can rewrite, and is
   the final gate on how she reads. */
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

/* Keyed on the caller's label — the string eugenia_runs.caller records — and
   agree.test.mjs holds the keys against labels actually passed. Absent means
   Opus: a new caller is expensive and correct rather than cheap and unnoticed. */
const MODELS: Record<string, string> = {
  'trim': SONNET,
};

export const modelFor = (label: string): string => MODELS[label] ?? OPUS;

/* Fast mode, keyed on the caller's label as MODELS is: the same model writing
   up to 2.5× faster, at twice the rate. The replies are the caller he waits
   on — one reply, whether it came through Telegram or the laptop — and at
   about $12 a month on Opus he chose speed over the price, 30 October. Opus alone
   serves it. A research preview with its own rate limit, so a fast request
   refused for any reason is sent once more at the ordinary speed: the turn
   is slower, never lost. A change of speed is a cache of its own, so the
   replies no longer read the prefix the briefing writes. */
const FAST = new Set(['reply']);

async function call(messages: any[], effort: Effort, tools: unknown[],
                    model: string, signal: AbortSignal, container: string | undefined,
                    fast: boolean): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      // A header, not a `betas` body field: that is the SDKs' parameter, and
      // an unknown body field is a 400 on every call. With Opus alone: the one
      // Sonnet caller is `trim`, and a gate that fails sends the draft, so a
      // decline there costs nothing a fallback would save. The header and the
      // field go together.
      ...(model === OPUS
          ? { "anthropic-beta": "server-side-fallback-2026-07-01" +
                                (fast ? ",fast-mode-2026-02-01" : "") }
          : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      /* Cached: long, fixed, and sent on every turn — which is why the strategy
         rides here. The window is a property of the tool ARRAY, where the key
         starts: each array is its own prefix. The chat array keeps the hour
         because fourteen of a week's eighteen replies came within an hour of the
         turn before, six within five minutes. Everything else is five
         minutes, which the rounds within a turn keep alive. `ttl` is a plain
         field, not a beta. */
      system: [{ type: "text", text: SYSTEM + ALWAYS,
                 cache_control: { type: "ephemeral",
                                  ttl: tools === CHAT_TOOLS ? "1h" : "5m" } }],
      messages,
      // Server tools need no loop here; the rest are executed below.
      tools,
      thinking: { type: "adaptive" },
      output_config: { effort },
      // A decline would otherwise cost the briefing and a retry's searches.
      // `fallbacks: "default"` re-runs on another model inside this call,
      // routed by refusal category; a decline before output is not billed.
      ...(model === OPUS ? { fallbacks: "default" } : {}),
      ...(fast ? { speed: "fast" } : {}),
      // The first request of a turn has none.
      ...(container ? { container } : {}),
    }),
  });
  if (!res.ok && fast) {
    console.error(`doji-eugenia: fast mode refused (${res.status}), sent at the ordinary speed —`,
                  (await res.text()).slice(0, 300));
    return call(messages, effort, tools, model, signal, container, false);
  }
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/* A backstop against a loop billing for ever, not a working limit. Six was
   reached by a release look that searched, fetched and searched again, and the
   failure it caused — a message that never arrives — is worse than the one it
   guards against. eugenia_runs.rounds says how close each caller runs. */
const MAX_ROUNDS = 10;

/* Its twin for time. A request that never answers otherwise holds the turn
   until the worker is killed at its wall clock — no catch, no row, no apology,
   and each retry dies the same way. Bounded, it throws inside the worker, and
   the row and the apology go out like any other failure. The share pace_line
   warns at, so the hundred seconds above it are left to report in; one budget
   for the whole turn, since ten rounds each under a per-request bound could
   still outlive the worker together. eugenia_runs.ms is the clock it reads. */
const TURN_MS = 300_000;

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
    case RELEASES_TOOL.name: return await readPrints(input.release, input.months);
    case AROUND_TOOL.name:
      return (await Promise.all([aroundBlock(), ratesBlock(), headlinesBlock(),
                                 positioningBlock(), flowsBlock(), volumeBlock()])).join("").trim();
    case STRUCTURE_TOOL.name: return (await structureBlock()).trim();
    case ALERTS_TOOL.name:   return (await alertsBlock()).trim();
    case THESIS_TOOL.name:   return await setThesis(input.thesis);
    case PORTRAIT_TOOL.name: return await setPortrait(input.portrait);
    case LOOP_TOOL.name:     return await openLoop(input.kind, input.body);
    case CLOSE_TOOL.name:    return await closeLoop(input.id, input.resolution);
    case CALL_TOOL.name:     return await makeCall(input.direction, input.entry, input.stop, input.target,
                                               input.condition, input.confirm, input.level);
    case EXPLAIN_TOOL.name:  return await explainCall(input.id, input.step, input.lesson);
    case RECORD_TOOL.name:   return await recordRead(input.reading, input.test, input.verdict, input.evidence,
                                                 input.firmness, input.lesson, input.channel);
    default:
      console.error(`doji-eugenia: no handler for tool "${name}"`);
      return unserved(name);
  }
}

/* `label` names the caller: eugenia_runs files the row under it and modelFor
   picks the model from it, so one string decides what ran and what it is filed
   as. Effort alone cannot tell the callers apart. Exported so a test can drive
   the loop against a stubbed fetch, with the budget a parameter so a stall
   needs no waiting out. */
export async function ask(messages: Turn[], effort: Effort, label: string,
                          tools: unknown[] = CHAT_TOOLS, budget = TURN_MS): Promise<string> {
  // Derived, so a caller cannot run one model and be recorded under another.
  const model = modelFor(label);
  const fast = FAST.has(label) && model === OPUS;
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
  const deadline = AbortSignal.timeout(budget);
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
    const body = await call(convo, effort, tools, model, deadline, container, fast);
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
      // the pass moves a rung or closes a thread, and only the chat array files a call.
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
  } catch (caught) {
    // The abort's own message is the runtime's, and says nothing he can use.
    const err = deadline.aborted
      ? new Error(`Claude did not finish within the turn's ${budget / 1000}s`) : caught;
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

/* A market read that came back short, whole or in part — one a briefing or a
   reply made, or the job's read ahead. What it fed still goes out and its own
   row reads ok, so on 12 October the only trace of a briefing written blind
   to the dollar and the Fed was the console. Failures only: a row for every
   read that answered would be several a run saying nothing. Never throws. */
async function unread(what: string, reason: string): Promise<void> {
  console.error(`doji-eugenia: ${what} not read —`, reason);
  await recordRun({ caller: 'market read', ok: false, detail: `${what}: ${reason}`.slice(0, 500) });
}

// What a door answered without: the market's carry a name, the rates' do not.
type Missed = { symbol: string; name?: string; error: string };

// Grouped by why, so eleven symbols the deadline cut short read as one clause
// and the row stays inside its 500 characters.
const missed = (list: Missed[]) => {
  const by = new Map<string, string[]>();
  for (const m of list) (by.get(m.error) ?? by.set(m.error, []).get(m.error)!).push(m.symbol);
  return [...by].map(([error, symbols]) => `${symbols.join(", ")}: ${error}`).join("; ");
};

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
   Rows with no embedding — everything written before the column, and any whose
   vendor call failed — are never found by meaning, silently. One PATCH per
   row, for EMBED_BATCH's reason. count=exact makes it resumable: repeat until
   it answers zero. Newest first: an outage's fortnight should come back before
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

/* One reading of her words. How she sounds is this request, whoever is
   listening; only the format is the listener's. */
function reading(words: string, format: string, signal: AbortSignal): Promise<Response> {
  return fetch(TTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TTS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Markdown stripped at the boundary: no parse mode is sent, yet a model
      // writes a bold label in a list anyway, and an asterisk read aloud is
      // a gamble.
      model: TTS_MODEL, voice: TTS_VOICE, speed: TTS_SPEED,
      input: words.replace(/\*\*|__|\*|_/g, '').replace(/^[·•]\s*/gm, ''),
      instructions: TTS_STYLE, response_format: format,
    }),
    signal,
  });
}

/* Never throws and never messages him: any failure answers why, null is a
   voice note that landed, and the text goes instead. Its own fetch, sendVoice
   being multipart. Ogg/opus, because the default mp3 works and arrives as a
   file attachment rather than a voice note, with nothing erroring. */
async function speak(answer: string, keyboard: unknown, signal: AbortSignal): Promise<string | null> {
  if (!TTS_KEY) return "no TTS_KEY";

  try {
    const spoken = await reading(answer, "opus", signal);
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
    return null;
  } catch (err) {
    console.error("doji-eugenia: could not speak —", why(err));
    return why(err);
  }
}

/* The voice note is the message and the text its fallback — both went for a
   day, two notifications for one thing said. Audio-only would turn a refusing
   vendor or an unset key into a missing message, so the text is sent, in full,
   whenever any part did not land. What is stored is unaffected.

   Not `say` itself, which keeps four things silent: the /notes audit, the
   apologies, short operational lines, and the copy of a turn the laptop has
   already spoken. Exported so the fallback is driven —
   with no TTS key every speak answers why not, a refusing vendor's shape — with
   the budget a parameter so a stall needs no waiting out.

   It answers how the message went out, with why where the voice failed: the
   reason was a console line alone, and the two text fallbacks of 26 and 27
   October had outlived the logs before anyone asked what stalled. */
export async function sayAloud(words: string, keyboard?: unknown, budget = SPEAK_MS): Promise<string> {
  const parts = chunk(words, TTS_LIMIT);
  const signal = AbortSignal.timeout(budget);
  let heard = parts.length > 0;
  const missed = new Set<string>();
  /* Shown while she speaks, as typing is while she writes: on 27 October the
     voice took two and a half minutes with nothing on his screen, and he asked
     whether she had answered. Best effort; it lasts five seconds, so it is sent
     again, and it stops before the text can go. */
  const recording = () => tg("sendChatAction", { chat_id: CHAT_ID, action: "record_voice" }).catch(() => {});
  recording();
  const keepRecording = setInterval(recording, 4_500);
  try {
    // Sequentially, keyboard on the last part, as in say().
    for (const [i, part] of parts.entries()) {
      const marked = i === parts.length - 1 ? keyboard : undefined;
      let landed = false, attempt = 0;
      // Two attempts, each held to half the budget: a stall is one request, and
      // the next is a fresh connection. A stall on 26 and 27 October held one
      // request for the whole 150s, where every voice note that landed that
      // week took 5 to 30s and the slowest 90.
      for (; attempt < 2 && !landed && !signal.aborted; attempt++) {
        const failed = await speak(part, marked, AbortSignal.any([signal, AbortSignal.timeout(budget / 2)]));
        if (failed) missed.add(failed);
        landed = failed === null;
      }
      if (!attempt) missed.add("no time left to ask");
      if (!landed) heard = false;
    }
  } finally {
    clearInterval(keepRecording);
  }
  const reasons = [...missed].join("; ").slice(0, 300);
  // Any part missing: three quarters of a message cannot be acted on.
  if (!heard) await say(words, keyboard);
  return heard ? (reasons ? `spoken on a second try (${reasons})` : "spoken")
               : `sent as text (${reasons || "nothing to speak"})`;
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
    const list = (ns: Note[]) => `\n· ` + inWindow(ns).map(noteLine).join("\n· ");
    return (told.length
             ? `\n\nWhat he has told you to do (${howMany(told)}), newest first. These are not` +
               ` optional and a later one replaces an earlier one:${list(told)}`
             : "")
         + (promised.length
             ? `\n\nWhat he has committed to (${howMany(promised)}), newest first. Hold his trades` +
               ` against these and say so plainly when one broke one:${list(promised)}`
             : "")
         + (noticed.length
             ? `\n\nWhat you have noticed about him (${howMany(noticed)}), newest first:${list(noticed)}`
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
                          promised: Note[] = [], portrait: Portrait | null = null,
                          record: Read[] = [], calls: Call[] = []): string {
  const list = (ns: Note[]) => inWindow(ns).map(noteLine).join("\n");
  const missed = misses(record);
  // Not loopsList, which is written to her about her own threads.
    const open = (kind: string, heading: string) => {
      const rs = loops.filter(l => l.kind === kind);
      return rs.length
        ? `${heading}\n${rs.map(l => `[${l.id}] ${l.body} (since ${civilDay(l.opened_on)})`).join("\n")}`
        : "";
    };
  return [
    told.length     ? `What you have told me (${howMany(told)}), newest first:\n${list(told)}`             : "",
    promised.length ? `What you have committed to (${howMany(promised)}), newest first:\n${list(promised)}` : "",
    noticed.length  ? `What I have noticed (${howMany(noticed)}), newest first:\n${list(noticed)}`         : "",
    told.length || promised.length || noticed.length ? "" : "I have not kept any notes yet, jefe.",
    portrait
      ? `How I read you${portrait.moved_on ? `, last moved ${civilDay(portrait.moved_on)}` : ""}:\n${portrait.portrait}`
      : "",
    open('watch',    "What I flagged and am still watching:"),
    open('question', "What I asked you and have not had back:"),
    story ? `The story I am carrying${story.moved_on ? `, last moved ${civilDay(story.moved_on)}` : ""}:\n${story.thesis}` : "",
    record.length
      ? `My reads over the last ${RECORD_DAYS} days, each judged by the test I stated and never by ` +
        `where price went: ${tally(record)}.` + (missed ? `\nThe latest I got wrong:\n${missed}` : "")
      : "",
    callsList(calls, Date.now(), "My").trim(),
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

  // The rung is the last word and the channel the rest: four spoken names are
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
    // A limit that can never bite — the key sits on a check of CHANNELS — kept
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

/* The portrait, read and dated as the thesis is, and its own block rather than
   part of notesBlock: a failed read here costs the paragraph, never his
   instructions. */
type Portrait = { portrait: string; moved_on: string | null };

async function readPortrait(): Promise<Portrait | null> {
  const [row] = await readRows<Portrait>('Portrait',
    `eugenia_portrait?select=portrait,moved_on&id=eq.current&limit=1`);
  return row ?? null;
}

export function portraitLine(row: Portrait | null): string {
  if (!row) return "";
  const since = row.moved_on ? ` (last moved ${civilDay(row.moved_on)})` : "";
  return `\n\nHow you read him${since}:\n${row.portrait}`;
}

export async function portraitBlock(): Promise<string> {
  try {
    return portraitLine(await readPortrait());
  } catch (err) {
    console.error("doji-eugenia: portrait unavailable —", why(err));
    return "";
  }
}

/* Her record, a month of it: long enough that one bad week is a part of it,
   short enough that it is about how she reads now. The three newest misses
   come with it, because a count says how often and only the misses say what
   she keeps getting wrong. */
type Read = { given_on: string; reading: string; test: string; verdict: string; evidence: string | null;
              firmness: string | null; lesson: string | null; channel: string | null };

const RECORD_DAYS = 30;
const RECORD_MISSES = 3;

// A read a message at most, so a month is never near the limit; it is there
// because every read carries one.
export function recordQuery(now = Date.now()): string {
  return `eugenia_reads?select=given_on,reading,test,verdict,evidence,firmness,lesson,channel` +
    `&given_on=gte.${nyDate(new Date(now - RECORD_DAYS * 86_400_000))}&order=id.desc&limit=200`;
}

const count = (rows: Read[]) => READ_VERDICTS.map(v =>
  `${rows.filter(r => r.verdict === v).length} ${v === 'wrong' ? 'proved wrong' : v}`).join(", ");

/* The whole month, then each firmness on its own: a firm read should miss less
   often than a light one, and only the split can say whether it does. Reads
   filed before firmness was asked are in the whole and in neither half. */
const tally = (rows: Read[]) => count(rows) + READ_FIRMNESS
  .map(f => [f, rows.filter(r => r.firmness === f)] as const)
  .filter(([, said]) => said.length)
  .map(([f, said]) => `; said ${f === 'firm' ? 'firmly' : 'lightly'}, ${count(said)}`).join("");

/* And by the channel each ran through, by its spoken name: a count of misses
   says how often, and only the channel says where her reading is weak. Reads
   filed before the channel was asked are in no channel. */
const byChannel = (rows: Read[]) => {
  const ran = CHANNELS.map(([id, name]) => [name, rows.filter(r => r.channel === id)] as const)
    .filter(([, reads]) => reads.length);
  return ran.length
    ? `\nBy the channel each ran through, proved wrong of those filed: ` +
      ran.map(([name, reads]) => `${name} ${reads.filter(r => r.verdict === 'wrong').length} of ${reads.length}`)
        .join(", ") + "."
    : "";
};

/* What she filed, set inside a sentence of ours. She writes a test as she says
   it, "I'm wrong if the two-year falls", and a condition as a sentence of its
   own, "Price comes back to 4,110."; set after our "wrong if" and "if" as filed,
   they read "wrong if I'm wrong if" and "if Price … above it..", to him in
   /notes and to her on every turn. */
const clause = (said: string) => said.trim()
  .replace(/^(?:I(?:'m| am| would be|'d be) )?wrong if /i, '').replace(/^if /i, '')
  .replace(/\.+$/, '').replace(/^[A-Z](?=[a-z])/, first => first.toLowerCase());

const misses = (rows: Read[]) => rows.filter(r => r.verdict === 'wrong').slice(0, RECORD_MISSES)
  .map(r => `· ${civilDay(r.given_on)}: ${r.reading} (wrong if ${clause(r.test)}) — ` +
            (r.evidence ?? 'its test fired').replace(/\.+$/, '') + (r.lesson ? `. Misread: ${r.lesson}` : ""))
  .join("\n");

export function recordList(rows: Read[]): string {
  if (!rows.length) return "";
  const missed = misses(rows);
  return `\n\nYour record — every read of the last ${RECORD_DAYS} days, judged at night by the test ` +
    `you stated: ${tally(rows)}.` + byChannel(rows) + (missed ? `\nThe latest proved wrong:\n${missed}` : "");
}

export async function recordBlock(): Promise<string> {
  try {
    return recordList(await readRows<Read>('Reads', recordQuery()));
  } catch (err) {
    console.error("doji-eugenia: record unavailable —", why(err));
    return "";
  }
}

/* Her calls, the month of them, scored on price: how many triggered and how
   they ended, what the triggered ones made an ounce, the newest losses, and any
   call still standing, so she says it stands rather than making another. To the
   briefing, a reply and the pass, as the record goes; never the trade look. */
export function callsQuery(now = Date.now()): string {
  return `eugenia_calls?select=*` +
    `&made_at=gte.${new Date(now - RECORD_DAYS * 86_400_000).toISOString()}&order=id.desc&limit=60`;
}

const callLine = (c: Call) =>
  `${c.direction} ${c.entry}, stop ${c.stop}, target ${c.target}, if ${clause(c.condition)}`;

export function callsList(rows: Call[], now = Date.now(), to = "Your"): string {
  if (!rows.length) return "";
  const scored = rows.filter(c => c.outcome);
  const by = (o: string) => scored.filter(c => c.outcome === o).length;
  const traded = scored.filter(c => c.result !== null);
  const net = Math.round(traded.reduce((sum, c) => sum + Number(c.result), 0) * 100) / 100;
  const standing = rows.filter(c => !c.outcome && Date.parse(c.expires_at) > now);
  const losses = scored.filter(c => c.outcome === 'lost');
  const lost = losses.slice(0, RECORD_MISSES);
  const explained = losses.filter(c => c.misread);
  const step = (c: Call) => c.misread === 'none' ? " — kept every step"
    : c.misread ? ` — misread the ${c.misread}: ${c.lesson}` : "";
  // `open` is an outcome, not a call left unscored: on 22 October she read
  // "1 open" two days after its roll as a scoring that had failed, and told him.
  return `\n\n${to} calls over the last ${RECORD_DAYS} days, scored on price by his rules: ` +
    `${rows.length} made; ${CALL_OUTCOMES.map(o =>
      `${by(o)} ${o === 'open' ? "still on at the 17:00 roll and marked at its close" : o}`).join(", ")}` +
    (rows.length > scored.length + standing.length ? `, ${rows.length - scored.length - standing.length} not yet scored` : "") + `.` +
    (traded.length ? ` The ${traded.length} that triggered made ${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(2)} an ounce.` : "") +
    (standing.length ? `\nStanding until the 17:00 roll: ${standing.map(callLine).join("; ")}.` : "") +
    (explained.length ? `\nOf the ${losses.length} lost, ` + CALL_STEPS.map(x =>
      `${explained.filter(c => c.misread === x).length} ${x === 'none' ? "kept every step" : `misread the ${x}`}`).join(", ") +
      (explained.length < losses.length ? `, ${losses.length - explained.length} not yet explained` : "") + "." : "") +
    (lost.length ? `\nThe latest lost:\n${lost.map(c => `· ${civilDay(nyDate(new Date(c.made_at)))}: ${callLine(c)}${step(c)}`).join("\n")}` : "");
}

/* The pass's list of lost calls still waiting for a reason, each with the
   number explain_call takes and when it was stopped. */
export function lossesList(rows: Call[]): string {
  if (!rows.length) return "";
  return `\n\nYour lost calls not yet explained — file each with explain_call:\n` +
    rows.map(c => `· call ${c.id}, made ${nyTime(c.made_at)} ET ${weekday(nyDate(new Date(c.made_at)))}: ` +
      `${callLine(c)}; stopped ${c.closed_at ? `${nyTime(c.closed_at)} ET` : "at a time not recorded"}`).join("\n");
}

export async function lossesBlock(): Promise<string> {
  try {
    return lossesList(await readRows<Call>('Calls',
      `eugenia_calls?select=*&outcome=eq.lost&misread=is.null&order=id.desc&limit=${LOSSES_MAX}`));
  } catch (err) {
    console.error("doji-eugenia: losses unavailable —", why(err));
    return "";
  }
}

export async function callsBlock(): Promise<string> {
  try {
    return callsList(await readRows<Call>('Calls', callsQuery()));
  } catch (err) {
    console.error("doji-eugenia: calls unavailable —", why(err));
    return "";
  }
}

/* ─── Whether the journal is still being written ────────────────────────────
   The poller and the email function have no voice, and either dying looks like
   a week he did not trade. sync_health is their heartbeat and this its
   reader; scripts/health.mjs asks the same staleness from outside, for when
   pg_cron itself has stopped and no briefing comes. Six hours against the
   two-minute poll: shorter and a quiet Sunday reads as a fault, longer and a
   Monday outage reaches him Tuesday. A fact about his instruments, so she
   leads with it.
   ─────────────────────────────────────────────────────────────────────────── */
export const STALE_HOURS = 6;

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
    // Without sync_health this is a 404, and the feature is simply inert.
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
  id: number; at: string; name: string; country: string; importance: string;
  consensus: string | null; prior: string | null; actual: string | null;
};

// The columns every calendar read asks for.
const RELEASE_COLUMNS = "id,at,name,country,importance,consensus,prior,actual";

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
   given rather than left to her arithmetic. A list holding anything from abroad
   says once what such a line is not: one of the releases his rules count. */
const weekday = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', weekday: 'long',
}).format(new Date(`${iso}T12:00:00Z`));

export function calendarList(rows: Release[], now = Date.now(),
                             heading = "The calendar around now, as TradingView lists it"): string {
  if (!rows.length) return "";
  const today = nyDate(new Date(now));
  const lines = rows.map(r => {
    const day = nyDate(new Date(r.at));
    // The rating is what the weekday slot lists by, so it is on every line.
    const head = `· ${nyTime(r.at)} ET` + (day === today ? "" : ` on ${weekday(day)} ${civilDay(day)}`) +
                 ` ${r.name}, rated ${r.importance}`;
    if (r.actual) {
      return `${head} — LANDED at ${r.actual}` +
             (r.consensus ? ` against ${r.consensus} expected` : "");
    }
    if (Date.parse(r.at) <= now) return `${head} — PAST, no figure on file`;
    return `${head} — due` +
           (r.consensus ? `, ${r.consensus} expected` : "") +
           (r.prior ? ` after ${r.prior}` : "");
  });
  return `\n\n${heading}:\n${lines.join("\n")}` + (rows.some(r => r.country !== HOME)
    ? `\n· A line led by a country code is from abroad and filed as context: his rules ` +
      `count US releases alone.`
    : "");
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
   the US releases he is cautious around, and abroad the central banks'
   decisions and headline inflation — replacing the rolling list rather than
   sitting beside it, since one print twice reads as two things.
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
    return calendarList(rows, now, "The week ahead, the releases TradingView rates high");
  } catch (err) {
    console.error("doji-eugenia: week unavailable —", why(err));
    return "";
  }
}

/* ─── The market, read ahead ───────────────────────────────────────────────
   The market around gold and the Fed's odds are read by the quarter-hourly
   job and kept here, and a briefing or a reply reads the copy. Read when
   wanted, they were paid for out of the briefing's clock: on 13 and 14
   October a chart took five or six seconds, and fourteen did not fit in what
   a briefing can wait. The job can wait. A copy is a quarter hour old at
   most, of hourly and daily bars.

   One row per door, rewritten, so the table never grows. Only the job writes
   it, a quarter hour apart, so the market's read-then-write has no second
   writer to race. Both writers are exported so the job's sequence is driven.
   ───────────────────────────────────────────────────────────────────────── */
type Stored = { answer: any; read_at: string };

async function readStored(door: string): Promise<Stored | null> {
  const [row] = await readRows<Stored>('Market',
    `eugenia_market?select=answer,read_at&door=eq.${door}&limit=1`);
  return row ?? null;
}

async function store(door: string, answer: unknown): Promise<void> {
  const res = await fetch(`${SB_URL}/rest/v1/eugenia_market?on_conflict=door`, {
    method: "POST", headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({ door, answer, read_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Market store failed (HTTP ${res.status})`);
}

/* A symbol this pass did not reach keeps the line the last pass read, its own
   bar times on it, so one slow call leaves no gap; one never read stays named.
   Pure, so the carrying is driven. */
export function keptMarket<T extends { symbol: string }>(fresh: { market: T[]; missing: Missed[] },
                                                         kept: { market: T[] } | null) {
  const old = new Map((kept?.market ?? []).map(m => [m.symbol, m]));
  return {
    market: [...fresh.market, ...fresh.missing.flatMap(m => old.get(m.symbol) ?? [])],
    missing: fresh.missing.filter(m => !old.has(m.symbol)),
  };
}

/* TradingView's daily budget, which the job spends. From 18 October every UTC
   day was refused by four in the morning New York, some thirty passes in at
   thirty calls a pass, so each briefing after went without the odds and the
   market. So the hourly bars are read once an hour, on the hour's last pass,
   while the market is open; the odds every other hour, which ODDS_HOURS
   allows; and both on the pass before a briefing, whatever the hour, so
   Sunday's has them with the market still shut. About seven hundred calls a weekday, the
   calendar's ninety-six and the weeks' and the flows' once a day included.
   Pure, so a week of passes is walked and counted. */
export function readsDue(now: Date): { market: boolean; rates: boolean } {
  if (now.getUTCMinutes() < 45) return { market: false, rates: false };
  const briefing = briefDue(new Date(now.getTime() + 15 * 60_000)) !== null;
  return { market: briefing || marketOpen(now), rates: briefing || nyClock(now).hour % 2 === 1 };
}

export async function storeMarket(): Promise<void> {
  try {
    const answer = await tvRead("market");
    // Every symbol refused is a reason each, never one sentence that hides them.
    if (!answer.market?.length) {
      throw new Error(answer.missing.length ? missed(answer.missing) : "no symbol served");
    }
    if (answer.missing.length) await unread("market", missed(answer.missing));
    await store("market", keptMarket(answer, (await readStored("market"))?.answer ?? null));
  } catch (err) {
    await unread("market", why(err));
  }
}

/* Daily closes move once a day, so a copy read today is kept and the door is
   asked again only on a new New York day; what a pass misses carries, as the
   hourly lines do. The correlations are the pass's own, each dated. */
export async function storeTrend(): Promise<void> {
  try {
    const kept = await readStored("trend");
    if (kept && nyDate(new Date(kept.read_at)) === nyDate(new Date())) return;
    const answer = await tvRead("trend");
    if (!answer.market?.length) {
      throw new Error(answer.missing.length ? missed(answer.missing) : "no symbol served");
    }
    if (answer.missing.length) await unread("trend", missed(answer.missing));
    await store("trend", { ...keptMarket(answer, kept?.answer ?? null), fits: answer.fits });
  } catch (err) {
    await unread("trend", why(err));
  }
}

// Replaced whole once it prices a meeting, since a fold is not merged: a
// contract missed leaves its meeting named as unread.
export async function storeRates(): Promise<void> {
  try {
    const answer = await tvRead("rates");
    if (!answer.meetings?.length) {
      throw new Error(answer.missing.length ? missed(answer.missing) : "no meeting served");
    }
    if (answer.missing.length) await unread("rates", missed(answer.missing));
    await store("rates", answer);
  } catch (err) {
    await unread("rates", why(err));
  }
}

/* His charts come from his broker, through the poller for get_market's
   reason, and are folded here rather than there: the poller serves bars, and
   what a bar means to his rules is hers. Stored as folded, so every reader
   gets the same map; a chart the door did not read is named in it.

   While the market is shut the bars stand still, so the first pass after the
   close — the Friday daily bar closed with it — folds the finished week and
   the rest are skipped: they only emptied the 5m window and metered it as
   unread all weekend. The closure is 48 hours, so a copy read shut within that
   was read in this one. */
const STRUCTURE_URL = `${SB_URL}/functions/v1/doji-mcp-sync?structure=1`;

export async function storeStructure(now = new Date()): Promise<void> {
  try {
    if (!marketOpen(now)) {
      const kept = await readStored("structure");
      const at = kept ? new Date(kept.read_at) : null;
      if (at && !marketOpen(at) && now.getTime() - at.getTime() < 2 * 86_400_000) return;
    }
    const res = await fetch(STRUCTURE_URL, { headers: { "x-doji-key": CRON_SECRET },
                                             signal: AbortSignal.timeout(READ_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const served = await res.json();
    if (!served?.ok || !served.charts) throw new Error("no readable answer");
    if (served.missing.length) {
      /* Open, and not printing yet: the broker's first bar comes after the
         Sunday open, and until it does the 15m and 5m charts are empty and the
         rest end where the week did — four unread rows every Sunday from 17:05
         to 17:50. While nothing served is newer than the finished week's copy,
         that copy stands and nothing is metered; the first new bar is a read
         like any other. */
      const kept = await readStored("structure");
      const newest = Math.max(0, ...(Object.values(served.charts) as Candle[][]).flat().map(b => b.t));
      if (kept && !marketOpen(new Date(kept.read_at)) && newest > 0 && newest <= (kept.answer.last?.t ?? 0)) return;
      await unread("structure", missed(served.missing.map((m: { period: string; error: string }) =>
        ({ symbol: m.period, error: m.error }))));
    }
    const map = foldStructure(served.charts, Date.now());
    if (!map.last) throw new Error("no chart served");
    await store("structure", map);
  } catch (err) {
    await unread("structure", why(err));
  }
}

/* ─── The market around gold ───────────────────────────────────────────────
   The dollar, yields, real yield, breakeven, silver, oil, the S&P, the VIX and
   GVZ, and abroad four European ten-year yields, Japan's, the euro and the yuan, for the
   briefing and get_around, which explain gold against them.

   Every line is a level now beside the level at a stated time, and no change
   is computed — quoteLine's lesson, applied here. The latest bar's time is
   given, a bar not being a tick; a daily series is dated.

   Never throws, and a failed read is a sentence, or she reaches for a search
   page. A symbol not served is named: an absent line reads as never asked.
   ───────────────────────────────────────────────────────────────────────── */
type Around = {
  symbol: string; name: string; unit: string; daily: boolean;
  from: number; since: string; last: number; at: string;
};

const NO_AROUND =
  "\n\nThe market around gold could not be read just now. Do not quote the dollar " +
  "or yields from a search; say you do not have them.";

// A level in its unit, the hourly lines and the weeks alike.
const figure = (v: number, unit: string) => unit === "%" ? `${v}%` : unit === "$" ? `$${v}` : `${v}`;

export function aroundList(answer: { market: Around[]; missing: { name: string }[] }, now = Date.now()): string {
  const today = nyDate(new Date(now));
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
  const weeks = trendBlock();
  try {
    const kept = await readStored("market");
    if (!kept) throw new Error("not read yet");
    return aroundList(kept.answer) + await weeks;
  } catch (err) {
    await unread("market", why(err));
    return NO_AROUND + await weeks;
  }
}

/* ─── The weeks behind it ──────────────────────────────────────────────────
   The same lines as daily closes a week, a month and three months back, each
   dated, so the dollar's trend and which force moved over weeks are read off
   numbers rather than a search page. Levels at stated days, and no change
   computed, as above. Carried by aroundBlock, so every reader of the market
   gets the weeks behind it; never throws.
   ───────────────────────────────────────────────────────────────────────── */
type Trend = { symbol: string; name: string; unit: string; points: { close: number; at: string }[] };
type Fit = { symbol: string; name: string; sessions: number; r: number; from: string; to: string };

/* `fits` is absent from a copy stored before the door computed them, which
   the next daily read replaces. */
export function trendList(answer: { market: Trend[]; missing: { name: string }[]; fits?: Fit[] }): string {
  const lines = answer.market.map(m =>
    `· ${m.name} ${m.points.map(p => `${figure(p.close, m.unit)} on ${civilDay(p.at.slice(0, 10))}`).join(", ")}`);
  if (answer.missing.length) lines.push(`· Not read just now: ${answer.missing.map(m => m.name).join(", ")}.`);
  const fits = answer.fits ?? [];
  return `\n\nThe weeks behind it, from TradingView's daily closes a week, a month and three months ` +
    `back:\n${lines.join("\n")}` +
    (fits.length ? `\nHow closely gold's daily moves have tracked each, from -1 (opposite ways, day by day) ` +
      `to +1 (together), a description of those sessions and never a cause:\n` +
      fits.map(f => `· ${f.name}: ${f.r} over the last ${f.sessions} sessions, ${civilDay(f.from)} to ${civilDay(f.to)}`)
        .join("\n") : "");
}

export async function trendBlock(): Promise<string> {
  try {
    const kept = await readStored("trend");
    if (!kept) throw new Error("not read yet");
    return trendList(kept.answer);
  } catch (err) {
    await unread("trend", why(err));
    return "\n\nThe weeks behind the market could not be read just now. Do not quote a week's " +
      "or a month's move from a search; say you do not have it.";
  }
}

/* ─── His charts, as a map ─────────────────────────────────────────────────
   The fold in structure.ts, said. Every price on it has printed, and every
   line says when, so a level can be checked against his own screen. It is
   handed to the briefing for its call and served by get_structure, and it
   says it is hers: his map is drawn in TradingView and kept nowhere here.

   Never throws, and a failed read is a sentence, or a call is built off a
   search page.
   ───────────────────────────────────────────────────────────────────────── */
const NO_STRUCTURE =
  "\n\nHis charts could not be read just now, so you have no map of them. Say so " +
  "rather than reading a level off a search, and file no call that needs one.";

const SEQUENCE = {
  up: "higher highs and higher lows",
  down: "lower highs and lower lows",
  mixed: "not the same way on both sides",
} as const;

export function structureList(s: Structure, now = Date.now()): string {
  if (!s.last) return NO_STRUCTURE;
  const today = nyDate(new Date(now));
  const when = (ms: number) => {
    const day = nyDate(new Date(ms));
    return `${nyTime(new Date(ms).toISOString())} ET` + (day === today ? "" : ` ${weekday(day)} ${civilDay(day)}`);
  };
  const name = (p: Period) => CHARTS.find(c => c.period === p)!.name;
  const turn = (t: Turn) => `${t.price} (${when(t.at)})`;
  const pair = (ts: Turn[], kind: string) =>
    ts.length ? `${kind} ${ts.map(turn).join(" then ")}` : `no ${kind} yet`;

  const lines = [
    `\n\nHis charts, off his own broker's bars. The newest bar read opened at ${when(s.last.t)} ` +
    `and last traded ${s.last.close}. This is YOUR map, computed from the bars; his is drawn in ` +
    `TradingView. Every figure on it has already printed.`,
    `The turns on the bias charts, the newest two of each:`,
    ...s.bias.map(b => `· ${name(b.period)}: ${pair(b.highs, "highs")}; ${pair(b.lows, "lows")} — ` +
      (b.trend ? SEQUENCE[b.trend] : "too few turns for a sequence") + `. Last close ${b.close}` +
      (b.broken ? `, ${b.trend === 'up' ? `under the newest low, ${b.lows[1].price}` : `over the newest high, ${b.highs[1].price}`}` +
        `: the sequence has broken and no turn says so yet.` : `.`)),
  ];
  if (s.range) {
    lines.push(`The week of hourly bars runs from ${turn(s.range.low)} to ${turn(s.range.high)}. A level ` +
      `within $${READINGS.EDGE} of either end is at its edge; anything between is inside the range.`);
  }
  lines.push(`Where price has turned, on the 1H and 30m, within $${READINGS.REACH} of ${s.last.close}:`,
    ...(s.levels.length ? s.levels.map(l => `· ${l.price} — ` +
      (l.sides === 'both' ? "turned both ways, a level that has flipped" : `a ${l.sides}`) +
      `, on the ${l.periods.map(name).join(" and ")}, newest ${when(l.at)}` +
      (l.quarter === null ? "" : `; on the ${l.quarter} ${l.quarter % (2 * GRID) === 0 ? "round number" : "quarter"}`) +
      (l.edge ? `; at the ${l.edge} of the week's range` : s.range ? "; inside the range" : "")) : ["· none"]),
    ...(s.higher.length
      ? [`On the bigger charts, within $${READINGS.REACH}: the highs and lows §4.2 calls important levels:`,
         ...s.higher.map(m => `· ${m.price} — ` + m.from.map(f =>
           `${f.what}, ${f.daily ? `the session closing ${when(f.at)}` : when(f.at)}`).join("; "))]
      : [`No previous day's, previous week's or daily and 4H high or low within $${READINGS.REACH}.`]),
    ...(s.pools.length
      ? ["Where highs or lows have printed level and still rest, the stops beyond them not yet taken:",
         ...s.pools.map(p => `· ${p.price} — equal ${p.kind}s, on the ${p.periods.map(name).join(" and ")}, ` +
           `touched ${p.touches.map(when).join(", ")}`)]
      : [`No equal highs or lows still rest within $${READINGS.REACH}.`]),
    `The grid within $${READINGS.REACH}: ` + s.grid.map(q =>
      `${q.price} (${q.round ? "round" : "quarter"}${q.turned ? ", a turn sits on it" : ""})`).join(", ") + ".");
  lines.push(...(s.sweeps.length
    ? ["Wicks through a turn that closed back, in the last day:",
       ...s.sweeps.map(w => `· ${name(w.period)} bar at ${when(w.at)}: ${w.kind === 'high' ? "above" : "below"} ` +
         `the ${w.level} ${w.kind} to ${w.wick}, closed back at ${w.close}`)]
    : ["No wick through a turn closed back in the last day."]));
  if (s.sessions.length) {
    lines.push("The sessions over the last day, on the 15m: " + s.sessions.map(x =>
      `${x.name} ${when(x.from)} to ${nyTime(new Date(x.to).toISOString())}${x.to > now ? " so far" : ""}, ` +
      `${x.low} to ${x.high}`).join("; ") + ".");
  }
  if (s.adr !== null) {
    lines.push(`The daily range has averaged $${s.adr} over the last ${ADR_SESSIONS} sessions` +
      (s.today === null ? "." : `; this session has covered $${s.today} so far.`));
  }
  const dollars = (v: number) => `$${Math.abs(v).toFixed(2)}`;
  const shape = (x: Shape) => (x.body ? `${x.body > 0 ? "up" : "down"} ${dollars(x.body)}` : "closed where it opened") +
    `, wicks ${dollars(x.upper)} above and ${dollars(x.lower)} below` +
    (x.through.length ? `; through ${x.through.map(t => `${t.price}, closed ${t.closed} it`).join(", and ")}` : "");
  // A daily bar is timed by the session it closed, as `higherOf` times its marks.
  lines.push(...s.candles.map(c => `The last closed ${name(c.period)} candles, oldest first: ` +
    c.bars.map((b, i) => (c.period === 'D_1' ? `the session closing ${when(b.t + 86_400_000)},` : when(b.t)) +
      ` open ${b.open}, high ${b.high}, low ${b.low}, close ${b.close} ` +
      `(${shape(c.shapes[i])})`).join("; ") + "."));
  if (s.missing.length) {
    lines.push(`Not read just now: the ${s.missing.map(name).join(", ")}. Say so rather than judging a ` +
      `step off a chart you do not have.`);
  }
  return lines.join("\n");
}

export async function structureBlock(): Promise<string> {
  try {
    const kept = await readStored("structure");
    if (!kept) throw new Error("not read yet");
    return structureList(kept.answer);
  } catch (err) {
    await unread("structure", why(err));
    return NO_STRUCTURE;
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

export function ratesList(answer: { meetings: Priced[]; unread: string[]; read_at: string }): string {
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
    `works them, from daily bars at least fifteen minutes behind, read at ${nyTime(answer.read_at)} ET, ` +
    `so nothing that printed after that is in them:` +
    `\n${lines.join("\n")}`;
}

/* Odds two hours old are not the morning's once anything has printed, and a
   door that keeps refusing — a Fed date the table of meetings does not hold —
   must not leave its last answer standing. The market's lines need no such
   bound: each carries its own bar times. */
const ODDS_HOURS = 2;

export async function ratesBlock(now = Date.now()): Promise<string> {
  try {
    const kept = await readStored("rates");
    if (!kept) throw new Error("not read yet");
    if (now - Date.parse(kept.read_at) > ODDS_HOURS * 3600_000) throw new Error(`last read ${kept.read_at}`);
    return ratesList({ ...kept.answer, read_at: kept.read_at });
  } catch (err) {
    await unread("rates", why(err));
    return "\n\nWhat the futures price for the Fed could not be read just now. Do not quote rate " +
      "odds from a search; say you do not have them.";
  }
}

/* ─── What the wires said ──────────────────────────────────────────────────
   Gold's and the dollar's headlines, for a conversation: the last six hours.
   Titles only: most stories are paywalled.

   The feeds are read to a fixed count, so where one stops inside the span the
   block says how far back it reaches; a story both carry can make a feed look
   to reach later than it did, never earlier. Another day's line names it.
   ───────────────────────────────────────────────────────────────────────── */
const WIRES_MIN = 6 * 60;

type Headline = { title: string; source: string; published: string; feed: string };

export function headlinesList(answer: { headlines: Headline[]; missing: { symbol: string }[] },
                              now = Date.now(), minutes = WIRES_MIN): string {
  const span = `the last ${minutes / 60} hours`;
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

export async function headlinesBlock(): Promise<string> {
  try {
    return headlinesList(await tvRead("news"));
  } catch (err) {
    await unread("news", why(err));
    return "\n\nThe headlines could not be read just now; search for what moved it.";
  }
}

/* ─── His alerts ───────────────────────────────────────────────────────────
   What doji-tradingview's `foldAlerts` answers: his levels, highest first, as
   a chart reads them. An alert on an indicator carries no price and says so.
   ───────────────────────────────────────────────────────────────────────── */
interface TvAlert {
  symbol: string; condition: string; level: number | null; set: string; fired: string | null;
}

export function alertsList(alerts: TvAlert[], now = Date.now()): string {
  if (!alerts.length) return "\n\nHe has no active alert in TradingView.";
  const today = nyDate(new Date(now));
  const when = (iso: string) => {
    const day = nyDate(new Date(iso));
    return `${nyTime(iso)} ET` + (day === today ? "" : ` on ${weekday(day)} ${civilDay(day)}`);
  };
  return "\n\nHis active alerts in TradingView, his levels, highest first:\n" +
    [...alerts].sort((a, b) => (b.level ?? -Infinity) - (a.level ?? -Infinity))
      .map(a => `· ${a.level ?? "no price level"} on ${a.symbol}, ${a.condition}, set ${when(a.set)}, ` +
                (a.fired ? `last fired ${when(a.fired)}` : "not fired yet")).join("\n");
}

export async function alertsBlock(): Promise<string> {
  try {
    return alertsList((await tvRead("alerts")).alerts);
  } catch (err) {
    await unread("alerts", why(err));
    return "\n\nHis alerts could not be read just now; ask him for his levels.";
  }
}

/* ─── Where the speculators stand ──────────────────────────────────────────
   The CFTC's weekly count of COMEX gold futures held by managed money, whose
   crowding is why a drop can outrun its news. Public, no credential. A Tuesday
   count released days later, so the line carries its date, and the year's
   range beside it, since crowded is relative to its own past.

   The Sunday briefing and get_around, since it changes weekly. Read ahead
   once a New York day, as the weeks are, so a briefing that reaches for it
   through get_around waits on nothing. Never throws.
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

/* The rows as the dataset sent them, kept only once they fold: a report that
   will not read leaves yesterday's copy standing. */
export async function storePositioning(): Promise<void> {
  try {
    const kept = await readStored("positioning");
    if (kept && nyDate(new Date(kept.read_at)) === nyDate(new Date())) return;
    const res = await fetch(COT_URL, { signal: AbortSignal.timeout(READ_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    positioningList(rows);
    await store("positioning", rows);
  } catch (err) {
    await unread("positioning", why(err));
  }
}

export async function positioningBlock(): Promise<string> {
  try {
    const kept = await readStored("positioning");
    if (!kept) throw new Error("not read yet");
    return positioningList(kept.answer);
  } catch (err) {
    await unread("positioning", why(err));
    return "\n\nWhere the speculators stand could not be read just now; do not quote it from a search.";
  }
}

/* ─── What central banks and the gold funds hold ───────────────────────────
   The two flows strategy §2 names: the gold reserves of the central banks that
   buy most and the one that has been selling, and the two largest US gold
   funds' assets and the money in or out of them. Levels on their dates, as the
   market's lines are; the reserves run months behind the official release, so
   the date is the point. A quarter of buying is the story, and five weekday
   briefings repeating it are not, so it goes where the speculators' count goes:
   the Sunday briefing and get_around. A figure the screener does not serve is
   said, never shown as zero. Read ahead once a New York day: the reserves are
   quarterly and the funds' windows a month and longer, and six calls a
   get_around was TradingView's quota spent on the same answer.
   ───────────────────────────────────────────────────────────────────────── */
type Reserve = { country: string; name: string; points: { date: string; tonnes: number }[] };
type Fund = { symbol: string; name: string; aum: number | null;
              flow_1m: number | null; flow_3m: number | null; flow_ytd: number | null };

export function flowsList(answer: { reserves: Reserve[]; funds: Fund[]; missing: { name: string }[] }): string {
  const monthYear = (date: string) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', month: 'short', year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
  const dollars = (v: number | null, signed = false) => v === null ? "not served"
    : `${signed ? (v < 0 ? "−" : "+") : ""}$${(Math.abs(v) / 1e9).toFixed(1)}B`;
  const lines = [
    ...answer.reserves.map(r => `· ${r.name}: ` +
      [...r.points].reverse().map(p => `${Math.round(p.tonnes)} t in ${monthYear(p.date)}`).join(", ")),
    ...answer.funds.map(f => `· ${f.name} (${f.symbol.split(":")[1]}): ${dollars(f.aum)} under management; ` +
      `money in or out ${dollars(f.flow_1m, true)} over a month, ${dollars(f.flow_3m, true)} over three, ` +
      `${dollars(f.flow_ytd, true)} this year`),
  ];
  if (answer.missing.length) lines.push(`· Not read just now: ${answer.missing.map(m => m.name).join(", ")}.`);
  return `\n\nWhat central banks and the two largest US gold funds hold, from TradingView — the ` +
    `reserves newest first, running months behind the official release, and the funds in dollars:\n` +
    lines.join("\n");
}

export async function storeFlows(): Promise<void> {
  try {
    const kept = await readStored("flows");
    if (kept && nyDate(new Date(kept.read_at)) === nyDate(new Date())) return;
    const answer = await tvRead("flows");
    if (!answer.reserves?.length && !answer.funds?.length) {
      throw new Error(answer.missing.length ? missed(answer.missing) : "nothing served");
    }
    if (answer.missing.length) await unread("flows", missed(answer.missing));
    await store("flows", answer);
  } catch (err) {
    await unread("flows", why(err));
  }
}

export async function flowsBlock(): Promise<string> {
  try {
    const kept = await readStored("flows");
    if (!kept) throw new Error("not read yet");
    return flowsList(kept.answer);
  } catch (err) {
    await unread("flows", why(err));
    return "\n\nWhat central banks and the gold funds hold could not be read just now; do not quote it " +
      "from a search unless you read the page it is on.";
  }
}

/* ─── What COMEX gold futures traded ───────────────────────────────────────
   The exchange's volume in the front month, the one volume that is the
   market's: the broker's is its own clients. The last finished session against
   the twenty before it, since heavy means something only against its own past.

   Every briefing and get_around. Never throws.
   ───────────────────────────────────────────────────────────────────────── */
type Session = { start: string; volume: number };

// A Globex gold session runs 23 hours, 18:00 to 17:00 ET, and is named for the
// day it ends; it starts the evening before.
const SESSION_MS = 23 * 3_600_000;

// One session that will not read refuses all, as the CFTC's rows do.
export function volumeList(sessions: Session[], now = Date.now()): string {
  if (!sessions.every(s => Number.isFinite(Date.parse(s.start)) && Number.isFinite(s.volume))) {
    throw new Error("no readable session");
  }
  const done = sessions.filter(s => Date.parse(s.start) + SESSION_MS <= now);
  if (!done.length) throw new Error("no finished session");
  const n = (v: number) => v.toLocaleString('en-US');
  const latest = done[done.length - 1];
  const before = done.slice(-21, -1);
  const day = nyDate(new Date(Date.parse(latest.start) + SESSION_MS));
  const average = Math.round(before.reduce((sum, s) => sum + s.volume, 0) / before.length);
  return `\n\nWhat COMEX gold futures traded — the exchange's own volume in the front-month ` +
    `contract, from TradingView's daily bars, finished sessions only:\n` +
    `· ${weekday(day)} ${civilDay(day)}: ${n(latest.volume)} contracts` +
    (before.length
      ? `, against an average of ${n(average)} over ` +
        `${before.length === 1 ? "the session" : `the ${before.length} sessions`} before.`
      : `.`);
}

export async function volumeBlock(): Promise<string> {
  try {
    return volumeList((await tvRead("volume")).sessions);
  } catch (err) {
    await unread("volume", why(err));
    return "\n\nWhat COMEX gold futures traded could not be read just now; do not quote it from a search.";
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

/* No price beside the position and no unrealised P&L: an open P&L would be the
   most anchoring number here, and where gold is now is the briefing's quote or
   get_market's. A null field is said, never printed — `from null` reads
   as a price. An entry from another day names the day: his holds run
   multi-session, and `open since 09:15 ET` on Wednesday for a Monday fill is a
   confident wrong fact about his own position. Today stays bare. */
export function positionsList(
  open: TradeRow[], standing: Standing | null, now = Date.now(),
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

export async function positionsBlock(): Promise<string> {
  try {
    const day = nyDate(new Date());
    const rows = await readDesk(day);
    return positionsList(rows.filter(isOpen), dayStanding(rows, day));
  } catch (err) {
    console.error("doji-eugenia: positions unavailable —", why(err));
    return "";
  }
}

/* ─── The cron half: the briefing and the nightly pass ───────────────────── */

/* The apology names the job. Every failure once said "No briefing", so a
   nightly pass that died — whose symptom is a memory that stops growing — sent
   him looking for a missing message. A map, so the words can be enumerated,
   and every job that can reach jobFailed has its own: a test finds them. */
export const APOLOGY: Record<string, string> = {
  briefing:     "No briefing, jefe — something broke on my side.",
  consolidate:  "My nightly tidy-up broke, jefe. I may not have kept what today was worth keeping.",
  trade:        "Something broke while I was looking at your position, jefe.",
  embed:        "I could not file what I remember for searching, jefe.",
  speak:        "Your briefing is written, jefe, but I could not send it. Ask me for it.",
  review:       "Your weekly review broke on my side, jefe. Ask me and I will go through your week.",
  reply:        "Something broke on my side, jefe. Try again in a moment.",
  calendar:     "I could not file the calendar, jefe, so its times and figures may be behind.",
  history:      "The calendar's history walk broke, jefe. The weeks it reached are filed.",
};

/* The scheduled half. The hourly job asks dueNow what this hour owes; the
   calendar and the repair doors each name theirs with a flag.
   ?force=1 and ?consolidate=1 run now whatever the clock says — a
   re-run after a failure, and the only way to see the nightly pass, which
   sends nothing. */
async function postScheduled(url: URL): Promise<Response> {
  // Named before the work so the catch can say which job died.
  let job = 'briefing';
  try {
    if (url.searchParams.get("consolidate") === "1") { job = 'consolidate'; return await postConsolidation(); }
    // The calendar, on its own quarter-hourly job, so an actual lands within
    // one, and the market, its weeks and his charts read ahead after it, as
    // TradingView's budget allows; none of them throws.
    if (url.searchParams.get("calendar") === "1") {
      job = 'calendar';
      await filed();
      const { market, rates } = readsDue(new Date());
      await Promise.all([market && storeMarket(), rates && storeRates(), storeTrend(), storeStructure(),
                         storeFlows(), storePositioning()]);
      return json({ ok: true, filed: true });
    }

    // The backfill, called by hand until `left: 0`; the nightly pass sweeps
    // the trickle a failed vendor call leaves.
    if (url.searchParams.get("embed") === "1")       { job = 'embed';       return await postEmbed(); }

    // The calendar's history, walked once by hand: R-19 judges only
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
    text: `${APOLOGY[job]}\n\n${reason.slice(0, 600)}`,
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
                        story: string, budget: number): Promise<string> {
  return await gate(draft, `${CRITIC}${notes}${channels}${desk}${story}\n\nTHE BRIEFING:\n\n${draft}`,
                    'critic', undefined, budget);
}

/* The gate on the messages the critic never reached — most of what he gets in
   a week. TRIM asks only the writing questions; the briefing's checks would
   ruin three sentences, and it needs no notes or map. It is handed his
   position and the story, since a read on price turns on the first and a
   direction is checked against the second.

   What it returns is what is remembered: storing the draft files words he
   never read as hers, resent as history. Both callers bind it. */
async function trim(draft: string, desk: string, story: string): Promise<string> {
  return await gate(draft, `${TRIM}${desk}${story}\n\nTHE MESSAGE:\n\n${draft}`, 'trim', TRIM_MOST);
}

/* One body, because what makes a gate safe must never be copied: a revision
   keepDraft refuses is overruled, and a gate that throws costs nothing. Every
   outcome is a verdict row — revised, unchanged, overruled, or failed — since
   whether a gate changed anything was a console line, and the paragraph rule
   failed through every gate for days with nothing able to say why. */
async function gate(draft: string, asked: string, label: string, most?: number,
                    budget = TURN_MS): Promise<string> {
  const caller = `${label} verdict`;
  try {
    const revised = await ask([{ role: 'user', content: asked }], 'medium', label, CRITIC_TOOLS, budget);
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

/* THE WRITING WORKER HAS ONE CLOCK, AND EACH STEP IS HANDED WHAT IS LEFT OF IT.
   Every model call is bounded at TURN_MS, but the worker runs several in a row
   — reads, the draft, the critic — and each inside its bound summed past the
   400s wall on 8 October: 50s of reads against a dead feed, a 247s draft that
   searched seven times because the feed was dead, and the critic, 336s in all.
   So the draft gets no more than is left, and the critic gets what remains
   after it; a critic out of time fails, and gate sends the draft. The thirty
   seconds below the wall are storing, the hand-off and the row. */
const WRITER_MS = 370_000;

/* The briefing reads its own history, so a morning continues from the last
   rather than starting from nothing. The stored user turn is a marker, not the
   sent text, which is rebuilt every morning and would resend stale as history. */
async function postBriefing(due: Brief): Promise<Response> {
  const opened = Date.now();
  const left = () => Math.max(0, opened + WRITER_MS - Date.now());
  // On Sunday the week behind is written beside it, on the same clock.
  const review = due === 'sunday' ? weekReview(left) : null;
  // Filed before the reads, so she is handed this morning's calendar — and on a
  // Sunday the whole week.
  await (due === 'sunday' ? filedWeek(weekOf(new Date())) : filed());
  // Every read at once: independent and small, so the batch costs its slowest.
  const [price, chart, around, rates, crowd, held, traded, notes, portrait, channels, trades, breaches, story, health,
         loops, calendar, desk, record, calls] =
    await Promise.all([
      marketBlock(), structureBlock(), aroundBlock(), ratesBlock(), due === 'sunday' ? positioningBlock() : "",
      due === 'sunday' ? flowsBlock() : "", volumeBlock(), notesBlock(), portraitBlock(), channelsBlock(), tradesBlock(), breachesBlock(), thesisBlock(),
      healthBlock(), loopsBlock(), due === 'sunday' ? weekBlock() : calendarBlock(), positionsBlock(), recordBlock(),
      callsBlock(),
    ]);

  const asked = (due === 'sunday'
    ? "Today's briefing, please. It is Sunday evening and the gold week is about to open."
    : "Today's briefing, please.")
    // `health` first: if the journal stopped, everything after it may be
    // missing rows.
    + health + price + chart + around + rates + crowd + held + traded + notes + portrait + channels + trades + breaches
    + story + loops + calendar + desk + record + calls;

  await keepInput(`${due} briefing`, asked);
  const draft = await ask([...await recent(), { role: 'user', content: asked }],
                          'high', `${due} briefing`, CHAT_TOOLS, Math.min(TURN_MS, left()));
  const brief = await critique(draft, notes, channels, desk, story, left())
    + (review ? `\n\n${await review}` : "");

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

  const how = await sayAloud(brief, feedbackKeyboard(nyDate(new Date())), Math.min(SPEAK_MS, left()));

  // The artifact's row, apart from the two calls': what he received and how
  // long it all took, with the stretch after the critic split out.
  const spoken = Date.now();
  await recordRun({
    caller: `${due} briefing delivered`, chars: brief.length,
    ms: spoken - opened, ok: true,
    detail: `stored in ${Math.round((stored - checked) / 1000)}s, the speaking worker did not start `
          + `(${handed}), ${how} in ${Math.round((spoken - stored) / 1000)}s`,
  });
  return json({ ok: true, brief: due, chars: brief.length });
}

/* What a briefing was handed, kept whole for a person to replay a changed
   prompt against: nothing else says what a past morning looked like to her.
   Never throws — a failed keep must never cost the briefing it describes. */
async function keepInput(caller: string, asked: string): Promise<void> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/eugenia_inputs`, {
      method: "POST", headers: sbHeaders("return=minimal"), body: JSON.stringify([{ caller, asked }]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("doji-eugenia: input not kept —", why(err));
  }
}

/* Today's stored briefing, found by its marker and paired with its text by the
   instant they were written in one INSERT — adjacent ids would not prove that.
   Today's only, and null when there is none yet: yesterday's would arrive as
   this morning's. */
async function storedBriefing(due: Brief, today: string): Promise<{ content: string } | null> {
  const [marker] = await readRows<{ created_at: string }>('Briefing marker',
    `eugenia_turns?select=created_at&role=eq.user` +
    `&content=eq.${encodeURIComponent(briefingMarker(due))}&order=id.desc&limit=1`);
  if (!marker || nyDate(new Date(marker.created_at)) !== today) return null;
  const [turn] = await readRows<{ content: string }>('Briefing',
    `eugenia_turns?select=content&role=eq.assistant` +
    `&created_at=eq.${encodeURIComponent(marker.created_at)}&order=id.desc&limit=1`);
  if (!turn) throw new Error(`the ${due} briefing's marker is stored and its text is not`);
  return turn;
}

/* The second worker: today's stored briefing, spoken. Today's only, since the
   door is also a person's repair. The delivered row is written here, after the
   send: pace_line reads its absence as a missing briefing. Exported so find,
   pair, speak, record is driven. */
export async function postSpeak(due: string): Promise<Response> {
  if (due !== 'weekday' && due !== 'sunday') throw new Error(`no such briefing to speak: ${due}`);
  const opened = Date.now();
  const today = nyDate(new Date());
  const turn = await storedBriefing(due, today);
  if (!turn) throw new Error(`no ${due} briefing is stored for ${today}`);

  const how = await sayAloud(turn.content, feedbackKeyboard(today), SPEAK_WORKER_MS);
  const spoken = Date.now();
  await recordRun({
    caller: `${due} briefing delivered`, chars: turn.content.length, ms: spoken - opened, ok: true,
    detail: `${how} in ${Math.round((spoken - opened) / 1000)}s`,
  });
  return json({ ok: true, spoke: due, how });
}

/* ─── The week behind, on Sunday ───────────────────────────────────────────
   Every coach has a cadence that is not about one trade: a look at the week's
   process. It rides the Sunday briefing, after it, as one message: he asked
   for one thing on Sunday rather than a Saturday message of its own. She is
   handed the week computed — his stats with his own answers, his rules, her
   calls — so nothing in it is counted by eye. TRIM gates it, since the critic
   reads the briefing alone, and the briefing's marker stores the two as sent.
   ───────────────────────────────────────────────────────────────────────── */

// His journal and his rules, to look at one trade or read why a rule exists.
const REVIEW_TOOLS = [TRADES_TOOL, STRATEGY_TOOL];

/* Never throws: a review that breaks costs its own paragraph, said as the
   apology in its place, and never the briefing it rides with. */
async function weekReview(left: () => number): Promise<string> {
  try {
    const [history, notes, portrait, stats, rules, calls, record, desk, story] = await Promise.all([
      recent(), notesBlock(), portraitBlock(), readStats(7), checkAdherence(7), callsBlock(), recordBlock(),
      positionsBlock(), thesisBlock(),
    ]);
    const asked = `${REVIEW}\n\nHis week, computed from the rows:\n${stats}\n\nHis rules over the week:\n${rules}` +
      notes + portrait + calls + record + desk;
    const draft = await ask([...history, { role: 'user', content: asked }], 'high', 'sunday review', REVIEW_TOOLS,
                            Math.min(TURN_MS, left()));
    return await trim(draft, desk, story);
  } catch (err) {
    console.error("doji-eugenia: the week's review broke —", why(err));
    await recordRun({ caller: 'review job', ok: false, detail: why(err).slice(0, 500) });
    return APOLOGY.review;
  }
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
  // Scored first, so the pass reads tonight's outcomes; never throws. And
  // what gold did on the day's prints, off the same window of bars, read
  // again so each job's failure is its own row.
  await scoreCalls();
  await fileReactions();
  const day = await turnsSince(CONSOLIDATE_HOURS);

  /* A silent day skips the model call but still leaves a row, or 23:00 runs it
     again. A branch, not an early return: the meters below are about the
     system, and an early return skipped them on exactly the quiet nights. The
     census still runs after the pass, the only thing that moves a rung. */
  if (day.length) {

  // His week too: it is asked to notice what he has started doing
  // differently, which most days' transcripts never mention. And the market
  // around gold and the Fed pricing as they closed, which is what a read's
  // stated test is judged against.
  // And her map of his charts as the day closed, with the calls that lost,
  // since a loss is explained by what printed after it.
  const [notes, portrait, channels, trades, story, loops, calendar, verdicts, desk, record, calls, around, rates,
         losses, chart] =
    await Promise.all([
      notesBlock(), portraitBlock(), channelsBlock(), tradesBlock(),
      thesisBlock(), loopsBlock(), calendarBlock(), feedbackBlock(), positionsBlock(), recordBlock(),
      callsBlock(), aroundBlock(), ratesBlock(), lossesBlock(), structureBlock(),
    ]);

  const asked = CONSOLIDATE + notes + portrait + channels + trades + story + loops + calendar +
    verdicts + desk + record + around + rates + calls + losses + chart +
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

  // The whole week, which R-19 judges against — the quarter-hourly
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

/* ─── The trade she hears about in two minutes ─────────────────────────────
   Still no verdict; she may say only his own rule, at the moment it applies:
   that fill took the day past −4%, and R-11 says the day ends there.

   A close and nothing else: a print pending on an open is R-20's, his to
   weigh, and the briefing has already named it. Decided from data before any
   model call, so an ordinary fill costs nothing.
   ───────────────────────────────────────────────────────────────────────── */
/* Exported so read, guard, decide is driven: every guard returns before a
   model call, and one that stopped returning looks like one never needed. */
export async function postTradeEvent(id: string, event: string): Promise<Response> {
  if (event !== 'closed') return json({ ok: true, trade: id, skipped: "not a close" });

  const [row] = await readRows<TradeRow>('Trade',
    `eugenia_trades?id=eq.${encodeURIComponent(id)}&limit=1`);
  // Soft-deleted: nothing to say.
  if (!row) return json({ ok: true, skipped: "no such trade" });

  /* What this path says is about today, and the trigger fires on a transition,
     not a clock — anything stamping an old close fires it for an old day, and
     once reported August's losses in the present tense. An overnight hold
     closing this morning is yesterday's and skipped too: R-11 forbids a LATER
     entry, and a finished day has none. */
  const day = row.open_day;
  if (day !== nyDate(new Date())) {
    return json({ ok: true, trade: id, skipped: "not today" });
  }

  // The day as it stands, computed, through the same view.
  const standing = dayStanding(await readRows<TradeRow>('Day',
    `eugenia_trades?open_day=eq.${day}&limit=50`), day);
  if (!standing || !standing.breached) {
    return json({ ok: true, trade: id, said: "day is inside its limit" });
  }
  const situation =
    `That fill closed his day at ${standing.pnl.toFixed(2)} against an account of ` +
    `${standing.account.toFixed(0)} implied by his size — past the ${DAY_LOSS * 100}% ` +
    `R-11 sets. Read R-11 in the strategy before you say anything about it.`;

  /* The reads come after the early returns, so an ordinary fill costs nothing.
     History matters here: a second close past the limit on the same day finds
     R-11 already said, and without the window she says it again. Notes,
     or his instructions are obeyed everywhere but here. Neither the portrait
     nor her record: a reading of how he trades, reaching him the moment a loss
     closes his day, is how a sentence becomes an order. */
  const [history, notes] = await Promise.all([recent(), notesBlock()]);

  const said = await ask(
    [...history, { role: 'user', content: `${TRADE_EVENT}\n\n${situation}${notes}` }],
    'medium', 'trade look', TRADE_TOOLS);

  if (isSilent(said)) return json({ ok: true, trade: id, said: "quiet" });

  // Stored before it is spoken, as a reply is; a failed write still costs
  // the history after the message, never the message.
  const unstored = await remember([{ role: 'user', content: `[trade ${event}]` },
                                   { role: 'assistant', content: said }])
    .then(() => null, (err: unknown) => why(err));
  await sayAloud(said);
  if (unstored) throw new Error(unstored);
  return json({ ok: true, trade: id, said: "sent" });
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

/* ─── A turn of conversation ───────────────────────────────────────────────
   What she is handed when he talks to her, the model and the gate — one turn
   however he reached her, so every door into the conversation reads the same
   memory, notes, map and desk. What comes back is his turn as it is stored
   (marked when he was quoting her) and her answer as the gate left it.
   ───────────────────────────────────────────────────────────────────────── */
async function converse(text: string, blocks: any[],
                        quoting: Promise<string | null>): Promise<{ asked: string; answer: string }> {
  const [history, notes, portrait, channels, story, loops, calendar, desk, record, calls, quoted] = await Promise.all([
    recent(), notesBlock(), portraitBlock(), channelsBlock(), thesisBlock(), loopsBlock(),
    calendarBlock(), positionsBlock(), recordBlock(), callsBlock(), quoting,
  ]);
  // A marker with the opening words is stored, so the nightly pass knows
  // which message "too long" was about; the quote itself is not.
  let asked = text;
  if (quoted !== null) {
    const words = quoted.trim().split(/\s+/).filter(Boolean);
    const opening = words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
    asked = `[replying to ${opening ? `"${opening}"` : 'an earlier message'}] ${text}`;
  }
  const about = quoted ? `\n\nHe is replying to this message of yours:\n«${quoted}»` : "";
  // Told it will be heard, and no cap: the shape is FORMAT's, which says what
  // to leave out rather than where to stop.
  const aloud =
    `\n\nYour answer reaches him as a voice note, so write it ` +
    `to be heard: plain sentences, no headings, and nothing that only works ` +
    `on a page. Lead with the answer and say only what decides it.`;
  const context = asked + about + aloud + notes + portrait + channels + story + loops + calendar + desk + record +
    calls;
  const draft = await ask(
    [...history, {
      role: 'user',
      // An image rides beside the text; the context is in the text either way.
      content: blocks.length ? [...blocks, { type: 'text', text: context }] : context,
    }],
    'medium', 'reply');
  const answer = await trim(draft, desk, story);
  return { asked, answer };
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
        const [told, noticed, channels, loops, story, promised, portrait, record, calls] = await Promise.all([
          readNotes('instruction'), readNotes('fact'), readChannels(), readLoops(), readThesis(),
          readNotes('commitment'), readPortrait(), readRows<Read>('Reads', recordQuery()),
          readRows<Call>('Calls', callsQuery()),
        ]);
        await say(notesList(told, noticed, channels, loops, story, promised, portrait, record, calls));
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

    let asked: string, answer: string;
    try {
      // Gated while the indicator still runs, or three silent seconds read as
      // her finishing and saying nothing.
      ({ asked, answer } = await converse(text, blocks, quoting));
    } finally {
      // Stopped before sending, or a ping lands after the message.
      clearInterval(keepTyping);
    }

    /* Stored before it is spoken, as the briefing is: speaking can take
       minutes, and on 26 October "No reply?", sent while the answer was still
       being spoken, read a history without it and was answered as something
       else. A failed write is the apology, after the message: the message is
       what he is waiting on. The text, never the blocks or the audio: a
       megabyte resent as history. */
    const unstored = await remember([{ role: 'user', content: asked }, { role: 'assistant', content: answer }])
      .then(() => null, (err: unknown) => why(err));
    // Its own row, as the briefing's delivery has: on 18 October a reply stored
    // as spoken never reached him, and nothing said how it had gone out.
    const how = await sayAloud(answer);
    await recordRun({ caller: 'reply delivered', chars: answer.length, ok: true, detail: how });
    if (unstored) throw new Error(unstored);
  } catch (err) {
    console.error("doji-eugenia:", why(err));
    await tg("sendMessage", { chat_id: CHAT_ID, text: APOLOGY.reply }).catch(() => {});
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

/* ─── The laptop half: he spoke to her face on his laptop ──────────────────
   Her face floats over his charts. He presses, talks and presses again; the
   laptop posts the recording here and plays what comes back, all on one
   request. The turn is converse, the reply's own, so the laptop and Telegram
   are one conversation with one memory: nothing about her changes — she is
   told nothing of the device, as she is told nothing of Telegram. Telegram
   gets the text as a copy, his words first, so a mishearing shows where he
   can scroll back. What the laptop adds is sight: the TradingView window,
   when he asks her to look, rides beside his words as a chart sent in
   Telegram does, for this turn only.

   The laptop's browser engine records WebM; the file goes to the transcriber
   under the name and type the laptop gave it, which is what the vendor reads
   the format from.
   ───────────────────────────────────────────────────────────────────────── */
const LAPTOP_SECRET = env("EUGENIA_LAPTOP_SECRET");

/* A recording heard, answered as a turn of the conversation: whatever the
   transcriber or the turn does, the laptop has something to say. The copy and
   the write go after it has her words, which are what he is waiting on, and
   the pair is stored whether or not the copy lands. */
async function hearLaptop(voice: File, chart: File | null): Promise<string> {
  const blocks = chart ? [{
    type: "image",
    source: { type: "base64", media_type: chart.type, data: base64(new Uint8Array(await chart.arrayBuffer())) },
  }] : [];
  const heard = await transcribe(new Uint8Array(await voice.arrayBuffer()), voice.name, voice.type);
  if ('trouble' in heard) return VOICE_TROUBLE[heard.trouble];
  try {
    const { asked, answer } = await converse(`[voice note] ${heard.said}`, blocks, Promise.resolve(null));
    background(say(`«${heard.said}»${blocks.length ? ' — with your chart' : ''}\n\n${answer}`));
    background(remember([{ role: 'user', content: asked }, { role: 'assistant', content: answer }]));
    return answer;
  } catch (err) {
    console.error("doji-eugenia:", why(err));
    return APOLOGY.reply;
  }
}

/* What the laptop plays is the vendor's raw `pcm`: 24 kHz, 16-bit
   little-endian, mono. The parts of a long answer join end to end, where each
   part of a file format would carry its own header. It arrives in frames — a
   kind byte, three bytes of length, then that many bytes — as the laptop's
   framer reads them; voice is the one kind, and the format stays whole
   because an installed laptop reads it until he takes an update
   (REFACTOR.md R-155). Exported so that framer can be fed these exact bytes
   in a test. */
export const FRAME = { voice: 0 } as const;

export function laptopFrame(kind: number, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  out.set([kind, bytes.length >> 16 & 255, bytes.length >> 8 & 255, bytes.length & 255]);
  out.set(bytes, 4);
  return out;
}

// The vendor's `pcm`, in samples a second: the rate the laptop plays her voice at.
const PCM_RATE = 24_000;
const BEAT = laptopFrame(FRAME.voice, new Uint8Array(PCM_RATE / 10 * 2));
const BEAT_MS = 15_000;

/* Silence while she thinks: a tenth of a second of zeros every BEAT_MS, from
   the first instant. A turn can run for minutes, and a response with nothing
   on the wire that long is closed by a proxy between here and the laptop —
   which one has never been measured, so the beat sits well inside the
   shortest such limit known, a hundred seconds. Zeros are silence in this
   format, so the laptop plays them like anything else, and her face can tell
   thinking from speaking by the level alone. A part the vendor will not read
   ends the audio; the copy in Telegram is the whole of it.

   SPEAK_MS bounds each part's wait for the vendor to start answering, not its
   reading: a budget on the whole stream bounds how long she may speak, and
   cut a long briefing off mid-sentence. Once she speaks, the laptop's own hanging up and the worker's
   wall clock are the bounds. */
async function* laptopAudio(words: Promise<string>): AsyncGenerator<Uint8Array, boolean> {
  let said: string | null = null;
  while (said === null) {
    yield BEAT;
    let beat = 0;
    said = await Promise.race([words, new Promise<null>(r => { beat = setTimeout(r, BEAT_MS, null); })]);
    clearTimeout(beat);
  }
  try {
    for (const part of chunk(said, TTS_LIMIT)) {
      const started = new AbortController();
      const wait = setTimeout(() => started.abort(), SPEAK_MS);
      const spoken = await reading(part, "pcm", started.signal).finally(() => clearTimeout(wait));
      if (!spoken.ok || !spoken.body) throw new Error(`speech HTTP ${spoken.status}`);
      for await (const bytes of spoken.body) yield laptopFrame(FRAME.voice, bytes);
    }
    return true;
  } catch (err) {
    console.error("doji-eugenia: the laptop could not speak —", why(err));
    return false;
  }
}

/* The briefing, on the laptop. It asks every few minutes whether one waits,
   as `?briefing=waits`, whose answer has no voice in it, so asking costs no
   speech: 204 while none does, 200 once one has landed. Then it shows its dot
   until he asks `?briefing=today` for the briefing itself. The text is the
   one postBriefing stored, read back as the speaking worker reads it, so the
   laptop says exactly what Telegram received.

   Heard is the briefing spoken whole: a run row, written once the last of it
   has gone, so a line that drops halfway leaves it waiting. From then on every
   question is answered as though none were stored, and the dot goes.
   Telegram's copy is sent regardless. */
async function laptopBriefing(which: string): Promise<Response> {
  if (which !== 'today' && which !== 'waits') {
    return json({ ok: false, error: "briefing is today or waits" }, 400);
  }
  const now = new Date(), today = nyDate(now);
  const due: Brief = nyClock(now).wd === 0 ? 'sunday' : 'weekday', heard = `${due} briefing heard`;
  const [turn, [run]] = await Promise.all([
    storedBriefing(due, today),
    readRows<{ at: string }>('Briefing heard',
      `eugenia_runs?select=at&caller=eq.${encodeURIComponent(heard)}&order=id.desc&limit=1`),
  ]);
  if (!turn || (run && nyDate(new Date(run.at)) === today)) return new Response(null, { status: 204 });
  if (which === 'waits') return new Response(null, { status: 200 });
  const said = laptopAudio(Promise.resolve(turn.content));
  return new Response(ReadableStream.from((async function* () {
    if (yield* said) await recordRun({ caller: heard, ok: true });
  })()), { headers: { "Content-Type": "application/octet-stream" } });
}

// ─── Entry point ───────────────────────────────────────────────────────────
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  const fromTelegram = req.headers.get("x-telegram-bot-api-secret-token");
  const fromCron     = req.headers.get("x-doji-key");
  const fromLaptop   = req.headers.get("x-laptop-key");

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
        background(postTradeEvent(String(sent.trade), String(sent.event ?? 'closed'))
          .catch(err => jobFailed('trade', err)));
        return json({ ok: true, accepted: "trade event" });
      }
      background(postScheduled(url));
      return json({ ok: true, accepted: url.search.slice(1) || "hourly" });
    }
    if (secretMatches(fromLaptop, LAPTOP_SECRET)) {
      if (!STT_URL || !STT_KEY || !TTS_KEY) {
        return json({ ok: false, error: "the laptop needs STT_URL, STT_KEY and TTS_KEY" }, 503);
      }
      const briefing = new URL(req.url).searchParams.get("briefing");
      if (briefing !== null) return await laptopBriefing(briefing);
      // A form: the recording as `voice`, and `chart` when he asked her to look.
      const form = await req.formData().catch(() => null);
      const voice = form?.get("voice"), chart = form?.get("chart") ?? null;
      if (!(voice instanceof File) || !voice.size || voice.size > FILE_MAX) {
        return json({ ok: false, error: `a recording, up to ${FILE_MAX} bytes` }, 400);
      }
      if (chart !== null && !(chart instanceof File && IMAGE_TYPES.includes(chart.type) && chart.size <= FILE_MAX)) {
        return json({ ok: false, error: `a chart is ${IMAGE_TYPES.join(', ')}, up to ${FILE_MAX} bytes` }, 400);
      }
      const words = hearLaptop(voice, chart instanceof File ? chart : null);
      background(words);
      return new Response(ReadableStream.from(laptopAudio(words)),
                          { headers: { "Content-Type": "application/octet-stream" } });
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  } catch (err) {
    // pg_net discards this; only the console sees it.
    console.error("doji-eugenia:", why(err));
    return json({ ok: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
