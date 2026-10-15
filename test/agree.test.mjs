/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the copies that have to agree
   ───────────────────────────────────────────────────────────────────────────
   Four runtimes and no build step, so some facts live in more than one file.
   Copies are not the problem; copies NOTHING CAN COMPARE are. A test asserting
   each copy against a literal typed beside it lets an editor change a list and
   its own test in one pass, green. So every copy here is read out of its file
   and held against the others. A few checks read one file against itself —
   a boot guard against its secrets, a function body against the calls it must
   make — and share the rest's failure shape, which is silence.

   WHAT THIS CANNOT SEE: the live database. Constraints are asserted as the SQL
   declares them; a hand edit in the SQL editor passes here and is
   supabase/verify.sql's to catch.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { boot } from './boot.mjs';
import { SETUPS, COLUMNS } from '../supabase/functions/doji-gladys/index.ts';
import { ALWAYS, SECTIONS, VERSION } from '../supabase/functions/doji-eugenia/strategy.ts';
import { readStrategy, SAID, LOOP_KINDS, THESIS_MAX, PORTRAIT_MAX, NOTES, READ_VERDICTS, READ_MAX,
         READ_FIRMNESS, NOTE_MAX, CALL_SIDES, CALL_OUTCOMES, CALL_MAX, RR_MIN, parseFeedback, feedbackKeyboard, EMBED_DIMS, briefDue, retryDue, FRAME }
  from '../supabase/functions/doji-eugenia/index.ts';
import { CONSOLIDATE, SYSTEM, PITCH, REVIEW } from '../supabase/functions/doji-eugenia/prompt.ts';
import { BE, SESSIONS, MARKETS, resultOf, counts, money, averages, sessionAt, sessionOf, isJournalled,
         discipline }
  from '../supabase/functions/doji-eugenia/journal.ts';
import { HOME, FULL_STOP, TO_BREAK_EVEN, TARGET_MIN, TARGET_MAX, checkRules } from '../supabase/functions/doji-eugenia/adherence.ts';

// A repository file, read once however many tests ask for it.
const READ = new Map();
const source = (path) => {
  if (!READ.has(path)) READ.set(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
  return READ.get(path);
};

/* A declaration through its closing brace at the start of a line, which is how
   every body here is read. Either end missing fails rather than reading wrong:
   sliced from -1 an absent declaration is an empty string every doesNotMatch
   passes, and sliced to -1 a body runs on to the end of the file. */
function bodyOf(text, decl, missing = `${decl} is gone`) {
  const at = text.indexOf(decl);
  assert.ok(at > -1, missing);
  const end = text.indexOf('\n}', at);
  assert.ok(end > at, `could not read the body of ${decl}`);
  return text.slice(at, end);
}

// Line comments out, so the prose above a call is never read as the call.
const uncomment = (text) => text.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

/* The database is one file, and each subject in it sits under a banner. A
   check about one subject reads that subject alone, so a pattern cannot pass
   on text that belongs to another. */
const SCHEMA_SQL = source('supabase/schema.sql');
// A table's own column list, from its create to the closing parenthesis.
const tableBody = (sql, table) => {
  const at = sql.indexOf(`create table if not exists public.${table} (`);
  return at === -1 ? '' : sql.slice(at, sql.indexOf('\n);', at));
};
function subject(title) {
  const at = SCHEMA_SQL.indexOf(`-- ═══ ${title} `);
  assert.ok(at > -1, `schema.sql has no "${title}" section`);
  const next = SCHEMA_SQL.indexOf('\n-- ═══ ', at + 1);
  return SCHEMA_SQL.slice(at, next === -1 ? undefined : next);
}
const SCHEMA = subject('Trades');
const GLADYS_SQL = subject('Gladys');
const EUGENIA_SQL = subject('Her memory');
const SENSES_SQL = subject('Her senses');
const CRON_SQL = subject('Everything that runs on a timer');
const SEMANTIC_SQL = subject('Searching her memory');
const SCHEMA_008 = subject('Whether the silent writers are writing');
const EUGENIA_TS = source('supabase/functions/doji-eugenia/index.ts');
const EUGENIA_PROMPT = source('supabase/functions/doji-eugenia/prompt.ts');

// The functions as the DIRECTORY holds them, not a list typed here.
const DEPLOYED = readdirSync(new URL('../supabase/functions', import.meta.url),
  { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name).sort();

const FUNCTIONS = DEPLOYED.map(name => ({ name, text: source(`supabase/functions/${name}/index.ts`) }));

/* Read out of the constraint, anchored on its NAME: a pattern hunting quoted
   strings would find the direction vocabulary as happily as this one. */
function setupsInSchema() {
  const line = SCHEMA.match(/constraint\s+trades_setup_check\s+check\s*\(([^)]*)\)/i);
  assert.ok(line, 'trades_setup_check is not in schema.sql at all');
  return [...line[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

// The journal columns as the table declares them, so a rename in the schema is
// caught rather than discovered by a write that silently does nothing.
const declaresColumn = (name) =>
  new RegExp(`^\\s*${name}\\s+(text|boolean)\\b`, 'mi').test(SCHEMA);

// The columns of each eugenia_trades view a text states, as a list, so
// reformatting is free.
const viewColumns = (text, where) => {
  const stmts = [...text.matchAll(
    /create or replace view public\.eugenia_trades[\s\S]*?select([\s\S]*?)from public\.trades/ig)];
  assert.ok(stmts.length, `${where} no longer states the eugenia_trades view`);
  return stmts.map(([, list]) => {
    const cols = list.split(',').map(c => c.trim()).filter(Boolean);
    // An emptied match would make the comparison below vacuous and green.
    assert.ok(cols.length >= 8, `only ${cols.length} columns read out of ${where}`);
    return cols;
  });
};

// Every column `trades` has, with whether Postgres generates it.
const tradesColumns = () => {
  const at = SCHEMA.indexOf('create table if not exists public.trades');
  assert.ok(at > -1, 'schema.sql no longer creates public.trades');
  const schema = SCHEMA.slice(at);
  return schema.slice(0, schema.indexOf('\n);'))
    .split('\n').map(l => l.match(/^ {2}([a-z_]+)\s+[a-z].*?(generated always)?/))
    .filter(m => m && m[1] !== 'constraint')
    .map(m => ({ name: m[1], generated: /generated always/.test(m.input) }));
};

const servedView = () => {
  const all = viewColumns(SCHEMA_SQL, 'schema.sql');
  assert.equal(all.length, 1, `schema.sql states the eugenia_trades view ${all.length} times where it states it once`);
  return all[0];
};

/* ─── The row as TWO files describe it ───────────────────────────────────────
   `TradeRow` is the row eugenia_trades serves and the type every rule in
   adherence.ts is written against, so a column the view gains and the
   interface lacks is one no rule can name. readDesk asks for `select=*`, which
   makes this interface the only description of what comes back.
   ─────────────────────────────────────────────────────────────────────────── */

test('TradeRow names exactly the columns the view serves', () => {
  const src = source('supabase/functions/doji-eugenia/adherence.ts');
  const declared = src.match(/export interface TradeRow \{([\s\S]*?)\n\}/);
  assert.ok(declared, 'adherence.ts no longer declares TradeRow');

  const named = [...declared[1].matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]);
  assert.ok(named.length >= 8,
    `only ${named.length} fields read out of TradeRow — the reader has gone blind`);

  assert.deepEqual(named.sort(), servedView().sort(),
    'TradeRow and the view disagree about what a row is — a column the view ' +
    'serves that the interface does not name is one no rule can be written ' +
    'against, and one it names that the view drops is a rule reading undefined');
});

/* ─── What §8 says she holds, against what the view hands her ────────────────
   §8 is read before any number, and its first paragraph is the inventory of a
   row — a copy of the view in prose, in a file no SQL change touches. `id` is
   added here because §8 states the `PID` filter separately.
   ─────────────────────────────────────────────────────────────────────────── */

test('§8 inventories exactly the columns the view serves', () => {
  const between = (from, to) => {
    const a = SECTIONS['8'].indexOf(from);
    assert.ok(a > -1, `§8 no longer carries "${from}"`);
    const b = SECTIONS['8'].indexOf(to, a);
    assert.ok(b > a, `§8 no longer carries "${to}" after "${from}"`);
    return [...SECTIONS['8'].slice(a, b).matchAll(/`([a-z_]+)`/g)].map(m => m[1]);
  };

  const served = between('**Broker-owned and served to you**', '**Journal-owned**');
  const owned = between('**Journal-owned**', '**Derived at read time');
  assert.ok(served.length >= 8 && owned.length === 4,
    `§8's inventory read as ${served.length} broker and ${owned.length} journal ` +
    `columns — the reader has gone blind rather than the lists having changed`);

  assert.deepEqual(
    [...served, ...owned, 'id'].sort(),
    servedView().sort(),
    'the section she reads before producing any number inventories a different ' +
    'row than the view hands her — either she reasons about a column that is ' +
    'not there, or one she has is invisible to her');

  /* AND THE WITHHELD ONES STAY WITHHELD. Each absence in §8 carries a rule —
     costs are already in the P&L, balance is the wrong denominator, the
     unsettled figure is not reachable by name — and serving one silently makes
     its paragraph a wrong fact about her own document. */
  const cols = servedView();
  // Scoped to the block that explains them: both names appear all over §8, so a
  // section-wide search could not fail.
  const withheld = between('### On the row and deliberately withheld', '### Position size');
  for (const held of ['commission', 'balance', 'computed_pnl', 'user_id']) {
    assert.ok(!cols.includes(held),
      `${held} is served, and §8 tells her it is withheld and why`);
    assert.ok(withheld.includes(held),
      `§8 no longer says why ${held} is withheld, so the rule that absence ` +
      `enforces is nowhere written down`);
  }
});

test('the view exposes what the strategy computes from, and still hides the rest', () => {
  const cols = servedView();
  // Without this she can read every trade and never its size, so account tier
  // and per-trade risk stay underivable however the prompt is written.
  assert.ok(cols.includes('size_oz'), 'Eugenia cannot see position size');

  /* AND net_pnl, BECAUSE §8 SUMS IT AND `pnl` CANNOT BE SUMMED HONESTLY. `pnl`
     falls back to the folded figure, which carries no swap, and this account
     holds through the 17:00 rollover — so a total over `pnl` alone is short by
     an unknown amount on rows she cannot identify. */
  assert.ok(cols.includes('net_pnl'),
    'Eugenia cannot see net_pnl, so every multi-day total she gives silently ' +
    'falls back to computed_pnl and omits swap');

  for (const hidden of ['user_id', 'balance', 'commission']) {
    assert.ok(!cols.includes(hidden), `${hidden} is exposed to Eugenia`);
  }
});

/* ─── The setups vocabulary ──────────────────────────────────────────────── */

test('the setups vocabulary is the same list in all three places', async () => {
  const { app, close } = await boot();
  try {
    // Spread first: the app's array belongs to the jsdom realm, and a strict
    // deep-equal compares prototypes across realms as well as contents.
    const inApp    = [...app.CONFIG.SETUPS];
    const inGladys = [...SETUPS];
    const inSchema = setupsInSchema();

    assert.deepEqual(inGladys, inApp,
      'doji-gladys and index.html offer different setups — a tap would be refused by the constraint');
    assert.deepEqual([...inSchema].sort(), [...inApp].sort(),
      'trades_setup_check and index.html disagree — the app can offer a setup the database will refuse');
  } finally { close(); }
});

/* Gladys's charm sends a setup by its name and an answer by its key, and reads
   the trade's answers by their columns: the same three lists in C. */
const GLADYS_C = source('charm/main/gladys.c');

test('Gladys\'s charm sends the setups and answers her door takes', () => {
  const setups = GLADYS_C.match(/SETUPS\[2\] = \{ ("[^"]+"), ("[^"]+") \}/);
  assert.ok(setups, 'gladys.c no longer lists SETUPS as this test reads them');
  assert.deepEqual(setups.slice(1).map(s => JSON.parse(s)), [...SETUPS],
    'the charm offers a setup her door would refuse');

  const pairs = [...GLADYS_C.matchAll(/\{ "(\w+)",\s*"(\w+)" \}/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(pairs, Object.entries(COLUMNS),
    'the charm answers a key, or reads a column, her door does not have — or in another order ' +
    'than the screens ask them');
});

/* Eugenia's charm tells her door about itself in headers, and reads her
   answer in frames whose kinds are a copy of the door's. Both directions: a
   header the charm sends that nothing reads is news she never hears, and one
   the door reads that the charm never sends is a sentence she is never told. */
test('Eugenia\'s charm sends the headers her door reads, and knows the frames it sends', () => {
  const talk = source('charm/main/talk.c');
  const sent = [...talk.matchAll(/esp_http_client_set_header\(h, "(x-charm-[\w-]+)"/g)].map(m => m[1]).sort();
  const read = [...new Set([...EUGENIA_TS.matchAll(/\.get\((['"])(x-charm-[\w-]+)\1\)|percent\('(x-charm-[\w-]+)'\)/g)]
    .map(m => m[2] ?? m[3]))].sort();
  assert.ok(sent.length > 1, 'talk.c no longer sets its headers as this test reads them');
  assert.deepEqual(sent, read, 'the charm sends a header her door does not read, or the door reads one it never sends');

  const kinds = Object.fromEntries([...source('charm/main/frames.h').matchAll(/^#define FRAME_(\w+)\s+(\d+)$/gm)]
    .map(m => [m[1].toLowerCase(), Number(m[2])]));
  assert.deepEqual(kinds, { ...FRAME }, 'the charm and her door number the frames differently');

  // Each Ogg page counts FRAME_MS of sound, and the encoder is set to its own
  // frame by name: two spellings of one length, a granule apart if they part.
  const ms = talk.match(/^#define FRAME_MS\s+(\d+)/m), set = [...talk.matchAll(/ESP_OPUS_ENC_FRAME_DURATION_(\d+)_MS/g)];
  assert.ok(ms && set.length === 1, 'talk.c no longer sets the encoder\'s frame and counts it as this test reads them');
  assert.equal(set[0][1], ms[1], 'the Ogg pages count a frame the encoder is not making');
});

/* Three more things the charm holds of her door, each a number or a word in
   C beside the one in TypeScript it must agree with. The charm hangs up on a
   silence longer than READ_MS, so it must outlast two of her BEAT_MS beats;
   it records into FILE_ROOM, which her door refuses past FILE_MAX; and it
   asks ?briefing= for the words charmBriefing answers, and no other. */
test('the charm waits out her silence, records what her door takes, and asks the briefing it answers', () => {
  const talk = source('charm/main/talk.c');
  const number = (text, pattern, what) => {
    const m = text.match(pattern);
    assert.ok(m && /^[\d\s*+()_]+$/.test(m[1]), `${what} is no longer defined as this test reads it`);
    return Function(`return ${m[1].replace(/_/g, '')}`)();
  };
  const readMs = number(talk, /^#define READ_MS\s+(.+)$/m, "talk.c's READ_MS");
  const beatMs = number(EUGENIA_TS, /^const BEAT_MS = (.+);$/m, "doji-eugenia's BEAT_MS");
  assert.ok(readMs >= 2 * beatMs,
    `the charm gives up after ${readMs} ms of nothing, inside two of her ${beatMs} ms beats — it hangs up while she thinks`);
  const room = number(talk, /^#define FILE_ROOM\s+(.+)$/m, "talk.c's FILE_ROOM");
  const max = number(EUGENIA_TS, /^const FILE_MAX = (.+);$/m, "doji-eugenia's FILE_MAX");
  assert.ok(room <= max, `the charm records up to ${room} bytes and her door refuses past ${max}`);

  const asked = [...talk.matchAll(/EUGENIA_DOOR "\?briefing=(\w+)"/g)].map(m => m[1]).sort();
  const door = EUGENIA_TS.match(/if \(which !== '(\w+)' && which !== '(\w+)'\) \{/);
  assert.ok(asked.length && door, 'talk.c or charmBriefing no longer names the briefing as this test reads it');
  assert.deepEqual(asked, door.slice(1).sort(), 'the charm asks ?briefing= for a word her door does not answer, or misses one');
});

/* The charm updates herself from the object the charm workflow publishes, and
   the workflow checks the image it builds holds the app where the bootloader
   looks: two names and an offset, each written in two files. */
test('the charm updates from what the workflow publishes, and the image holds the app where it boots', () => {
  const net = source('charm/main/net.h'), workflow = source('.github/workflows/charm.yml');
  const reads = net.match(/#define FIRMWARE_URL "https:\/\/\w+\.supabase\.co\/storage\/v1\/object\/public\/(\w+)\/([\w.]+)"/);
  const writes = workflow.match(/\/storage\/v1\/object\/(\w+)\/([\w.]+)"/);
  const made = workflow.match(/"id":"(\w+)","name":"\w+","public":true/);
  assert.ok(reads && writes && made, 'net.h or charm.yml no longer names the update as this test reads it');
  assert.deepEqual(reads.slice(1), writes.slice(1), 'the charm looks for her update where the workflow does not put it');
  assert.equal(made[1], reads[1], 'the workflow makes a bucket the charm does not read from');

  const slot = source('charm/partitions.csv').match(/^ota_0,\s*app,\s*ota_0,\s*(0x[0-9a-f]+),/im);
  const checked = workflow.match(/test "\$full" -ge \$\(\( (0x[0-9a-f]+) \+ app \)\)/i);
  assert.ok(slot && checked, 'partitions.csv or charm.yml no longer places the app as this test reads it');
  assert.equal(Number(checked[1]), Number(slot[1]), 'the workflow checks for the app at an offset the partition table does not boot from');
});

/* The conversation comes first, and a trade waits for it to end. Its
   questions come up only once the conversation is over with him looking —
   never after a single answer, never before a waiting briefing, which is read
   however she is held — and PWR on them is a press she keeps: the questions
   only look for it, and her task takes it to listen. main.c and journal.c are
   the board's, so the calls are read. */
test('a trade\'s questions wait for the conversation to end, and PWR on them goes back to her', () => {
  const main = source('charm/main/main.c');
  const awake = bodyOf(main, 'static void awake(void) {', 'main.c has no awake()');
  const loop = awake.slice(awake.indexOf('for (;;) {'));
  assert.equal((loop.match(/journal\(\)/g) ?? []).length, 1, 'the conversation reaches the journal by more than one path');
  assert.match(loop, /if \(next == OVER_LOOKING\) \{[^}]*if \(!journal\(\)\) sleep_now\(\);/,
    'the journal after a conversation no longer waits for it to be over, or no longer goes back to her on PWR');
  const briefing = loop.match(/if \(briefing_waits\) \{[^}]*\}/);
  assert.ok(briefing, 'awake() no longer reads a waiting briefing as this test finds it');
  assert.ok(loop.indexOf(briefing[0]) < loop.indexOf('between_turns('), 'a waiting briefing now waits for the conversation to end');
  assert.doesNotMatch(briefing[0], /motion_hold|between_turns/, 'a waiting briefing now waits on how she is held');

  const between = bodyOf(main, 'static between_t between_turns(bool trade) {', 'main.c has no between_turns()');
  assert.match(between, /if \(trade && hold == LIFT_HELD && now - finished >= pdMS_TO_TICKS\(QUIET_MS\)\) return OVER_LOOKING;/,
    'the conversation is no longer over only when a trade waits and he is held up and quiet');
  assert.match(bodyOf(main, 'static bool journal(void) {', 'main.c has no journal()'), /return ulTaskNotifyTake\(pdTRUE, 0\);/,
    'the journal no longer hands back the PWR that closed it');

  const ask = bodyOf(source('charm/main/journal.c'), 'int journal_ask(int q, const bool missing[4]) {', 'journal.c has no journal_ask()');
  assert.match(ask, /ulTaskNotifyValueClear\(NULL, 0\)/, 'a question no longer gives way to PWR');
  assert.doesNotMatch(ask, /ulTaskNotifyTake/, 'a question takes the press that closed it, so she never hears it');
});

/* The charm's words are drawn in fonts holding only the letters
   tools/fonts.sh gave them; a word with any other letter draws a gap. */
test('every word on the charm\'s screens is in the font that draws it', () => {
  // The files that draw words, found rather than listed: a fifth would draw
  // letters nothing below checks.
  const drawers = execSync('git ls-files charm/main', { encoding: 'utf8' }).split('\n')
    .filter(f => f.endsWith('.c') && /LV_FONT_DECLARE\(hanken_/.test(source(f))).map(f => f.slice('charm/main/'.length));
  assert.deepEqual(drawers.sort(), ['dial.c', 'face.c', 'journal.c', 'setup.c'],
    'a file draws words in the charm\'s fonts that this test does not read');
  const journal = source('charm/main/journal.c');
  const list = (name) => {
    const m = journal.match(new RegExp(`${name}\\[\\d\\] = \\{([^}]+)\\}`));
    assert.ok(m, `journal.c no longer lists ${name}`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map(w => w[1]);
  };
  // What a font holds, as its own header records the run: its symbols, and
  // the space when it was asked for by code point.
  const held = (font) => {
    const opts = source(`charm/main/${font}.c`);
    const m = opts.match(/--symbols (\S+)/);
    assert.ok(m, `${font}.c no longer says which letters it holds`);
    return m[1] + (/--range 0x20 /.test(opts) ? ' ' : '');
  };
  const words = list('WORDS'), short = list('SHORT');
  assert.equal(words.length, 4, 'a word for each of the four answers');
  for (const word of [...words, ...short]) {
    for (const letter of word) assert.ok(held('hanken_64').includes(letter), `hanken_64 cannot draw the ${letter} of ${word}`);
  }
  // The setup screen's label is the small font's.
  for (const letter of words[0]) assert.ok(held('hanken_16').includes(letter), `hanken_16 cannot draw the ${letter} of ${words[0]}`);

  // The dial's label and its number, any of 0 to 100; the charge's, with its %.
  const dial = source('charm/main/dial.c');
  const label = dial.match(/t\.text = "([^"]+)";/);
  assert.ok(label, 'dial.c no longer draws its label as this test reads it');
  for (const letter of label[1]) assert.ok(held('hanken_16').includes(letter), `hanken_16 cannot draw the ${letter} of ${label[1]}`);
  for (const digit of '0123456789%') assert.ok(held('hanken_36').includes(digit), `hanken_36 cannot draw a ${digit}`);
  assert.match(source('charm/main/face.c'), /snprintf\(percent, sizeof percent, "%d%%", charge\)/,
    'face.c no longer draws the charge as a number and %, which is what this test checks the font for');

  // The setup screen: what it says while it works, and her network's name,
  // Charm- and four hex digits.
  const setup = source('charm/main/setup.c');
  const say = setup.match(/SAY\[\] = \{([^}]+)\}/);
  assert.ok(say, 'setup.c no longer lists what its screen says');
  assert.match(setup, /"Charm-%02X%02X"/, 'setup.c no longer names her network as this test reads it');
  for (const words of [...[...say[1].matchAll(/"([^"]+)"/g)].map(w => w[1]), 'Charm-0123456789ABCDEF']) {
    for (const letter of words) assert.ok(held('hanken_18').includes(letter), `hanken_18 cannot draw the ${JSON.stringify(letter)} of ${words}`);
  }
});

/* The charm draws in Doji's colours: copies of the app's tokens in C, each
   beside the token it copies, and in the setup page's CSS under the app's own
   names. Each copy is read against index.html's first declaration. */
test('the charm and its setup page draw in the app\'s own colours', () => {
  const app = new Map();
  for (const [, name, value] of source('index.html').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)) {
    if (!app.has(name)) app.set(name, value.toLowerCase());
  }
  const palette = [...source('charm/main/palette.h').matchAll(/^#define (\w+)\s+0x([0-9a-f]{6})\s+\/\/ (--[\w-]+)$/gim)];
  assert.ok(palette.length >= 5, `palette.h names only ${palette.length} tokens beside its colours — the reader has gone blind`);
  for (const [, name, hex, token] of palette) {
    assert.equal(`#${hex.toLowerCase()}`, app.get(token), `palette.h's ${name} is not index.html's ${token}`);
  }
  const page = source('charm/main/setup.html').match(/:root \{([^}]+)\}/);
  assert.ok(page, 'setup.html no longer declares its colours in :root');
  const shared = [...page[1].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].filter(([, name]) => app.has(name));
  assert.ok(shared.length >= 5, `setup.html shares only ${shared.length} of the app's tokens — the reader has gone blind`);
  for (const [, name, value] of shared) {
    assert.equal(value.toLowerCase(), app.get(name), `setup.html's ${name} is not index.html's`);
  }
});

test('a setup the app offers can actually be written, and one it does not cannot', async () => {
  const { app, close } = await boot();
  try {
    // The constraint is the last word: every value a client can reach must satisfy
    // it, and nothing else may.
    const allowed = setupsInSchema();
    for (const s of app.CONFIG.SETUPS) assert.ok(allowed.includes(s), `${s} would be refused by Postgres`);
    for (const s of SETUPS)            assert.ok(allowed.includes(s), `${s} would be refused by Postgres`);
    assert.ok(!allowed.includes('Liquidity Sweep'), 'the constraint has stopped being a whitelist');
  } finally { close(); }
});

/* ─── The journal column names ───────────────────────────────────────────── */

test('the app and Gladys reach the same four journal columns', async () => {
  const { app, close } = await boot();
  try {
    const owned  = [...app.Data.OWNED].sort();
    const gladys = Object.values(COLUMNS).sort();

    assert.deepEqual(gladys, owned,
      'the fourth writer has stopped being confined to the journal half');
    assert.deepEqual(owned, ['followed_rules', 'followed_sl', 'followed_tp', 'setup'],
      'the journal half itself has changed — every other assertion here is now about the wrong four columns');
  } finally { close(); }
});

test('every journal column both writers name exists in the schema', async () => {
  const { app, close } = await boot();
  try {
    for (const column of app.Data.OWNED) {
      assert.ok(declaresColumn(column), `${column} is not declared in schema.sql`);
    }
  } finally { close(); }
});

/* ─── And the two copies inside the redraw trigger ───────────────────────────
   The Gladys section of schema.sql names the four columns twice more. Missing from the WHEN
   clause, an answer never reaches the Telegram message; missing from `before`,
   it reads as unanswered and a correction to a settled trade reopens the form.
   ───────────────────────────────────────────────────────────────────────── */

test('the redraw trigger watches, and carries, exactly the journal columns', async () => {
  const { app, close } = await boot();
  try {
    const owned = [...app.Data.OWNED].sort();

    // Anchored on the trigger itself, so the columns in the payload above it
    // cannot stand in for the ones in the WHEN clause.
    const at = GLADYS_SQL.indexOf('create or replace trigger trades_telegram_on_answer');
    assert.ok(at > -1, 'schema.sql no longer creates trades_telegram_on_answer');

    const watched = [...GLADYS_SQL.slice(at).matchAll(/new\.(\w+)\s+is distinct from/g)]
      .map(m => m[1]).sort();
    assert.deepEqual(watched, owned,
      'the trigger watches columns the journal half does not write, or misses one it ' +
      'does — an answer to that question would never redraw the message');

    const before = [...GLADYS_SQL.matchAll(/'before', jsonb_build_object\(([^)]*)\)/g)]
      .flatMap(m => [...m[1].matchAll(/'(\w+)',\s*old\./g)].map(k => k[1])).sort();
    assert.deepEqual(before, owned,
      'the before-state the trigger sends is not the four columns answered() reads — ' +
      'a missing one reads as unanswered and reopens a form that was settled');
  } finally { close(); }
});

/* And the third read of that before-state. postAnswer() talks only to Telegram
   and PostgREST, so no test can drive it; a constant in place of
   answered(before) there disagrees with the tap, and the trigger's redraw is
   the one that lands. */

test('the redraw decides from the before-state, not from a constant', () => {
  const src = source('supabase/functions/doji-gladys/index.ts');

  // Comments stripped: the expression named in the prose above the call is not
  // the call.
  const body = uncomment(bodyOf(src, 'async function postAnswer(', 'doji-gladys no longer has postAnswer()'));

  assert.match(body, /redraw\([^)]*answered\(before\)\)/,
    'postAnswer no longer redraws on answered(before) — it and the tap that fired ' +
    'the trigger would then disagree, and a form reopened with [Edit] shuts under ' +
    'the correction being made in it');
});

test('no broker column is reachable through either writer', async () => {
  const { app, close } = await boot();
  try {
    // Everything the poller, the email writer or the database owns. One of these in
    // Data.OWNED or COLUMNS and there is suddenly something to arbitrate.
    const broker = [
      'id', 'user_id', 'direction', 'entry_time', 'fill_time', 'entry_price',
      'exit_price', 'commission', 'balance', 'open_day', 'net_pnl',
      'computed_pnl', 'pnl', 'deleted', 'created_at', 'updated_at',
      // Gladys's own bookkeeping: a tap or save that could name it could point her at
      // another message, or lose the trade its own.
      'tg_message_id',
    ];
    const reachable = new Set([...app.Data.OWNED, ...Object.values(COLUMNS)]);
    for (const column of broker) {
      assert.ok(!reachable.has(column), `${column} is writable from the journal half`);
    }
  } finally { close(); }
});

/* ─── The grant list is a fourth copy of what the app may write ──────────────
   The `grant update (…)` and the two arrays in verify.sql that check it must
   agree with the app. Too NARROW and every save is a 403 that reads as the app
   broken; too WIDE and `net_pnl` is writable from the browser console.

   FIVE, NOT FOUR. `deleted` is on the never-reachable list for taps and saves,
   but `remove()` and `undo()` write it through `update()` — so a grant derived
   from `Data.OWNED` alone looks right and breaks delete and undo.
   ─────────────────────────────────────────────────────────────────────────── */

test('the columns schema.sql grants are exactly the columns the app writes', async () => {
  const grants = subject('What the app may write');
  const verify = source('supabase/verify.sql');

  const stated = grants.match(/grant update \(([^)]*)\)\s*\n?\s*on public\.trades/);
  assert.ok(stated, 'schema.sql no longer grants update on any column of trades');
  const granted = stated[1].split(',').map(c => c.trim()).sort();

  const { app, close } = await boot();
  try {
    const want = [...app.Data.OWNED, 'deleted'].sort();
    assert.deepEqual(granted, want,
      'the grant in schema.sql and what the app actually writes have parted — too narrow ' +
      'and the journal cannot be saved, too wide and a broker column is writable ' +
      'from the browser again');

    // The app writes `deleted` outside OWNED, which is the whole reason the list
    // is five. If that stopped being true the fifth grant would be dead.
    const src = source('index.html');
    assert.match(src, /update\(\{ deleted: true \}\)/,
      'nothing sets deleted any more, so schema.sql grants a column the app never writes');
    assert.match(src, /update\(\{ deleted: false \}\)/, 'undo no longer clears deleted');
  } finally { close(); }

  /* verify.sql states the five twice — as what must NOT be writable, by exclusion,
     and as what must. The exclusion list is the half that silently stops
     protecting: add a broker column to it and the check still says 0. */
  for (const [what, re] of [
    ['the exclusion list', /column_name not in\s*\n?\s*\(([^)]*)\)/],
    ['the positive list',  /from unnest\(array\s*\n?\s*\[([^\]]*)\]\) col/],
  ]) {
    const m = verify.match(re);
    assert.ok(m, `verify.sql no longer carries ${what} for the trades grant`);
    const named = m[1].split(',').map(c => c.trim().replace(/^'|'$/g, '')).sort();
    assert.deepEqual(named, granted,
      `${what} in verify.sql names different columns from the grant in 009`);
  }

  // The revoke has to name PUBLIC as well as both roles. Revoking from one is
  // not revoking from the others — the lesson `eugenia_search` once cost.
  assert.match(grants, /revoke insert, update, delete on public\.trades\s+from public, anon, authenticated;/,
    'schema.sql revokes from fewer than all three of PUBLIC, anon and authenticated, so ' +
    'the privilege survives under whichever name was left out');
});

/* ─── Eugenia's note length ──────────────────────────────────────────────────
   NOTE_MAX is the constant and the tool description interpolates it. The
   constraint is the copy that remains: truncate above it and every remember()
   is refused, answered "That did not save" — right for a blip, and for a
   permanent mismatch her memory simply stops.
   ─────────────────────────────────────────────────────────────────────────── */

const noteLimit = {
  truncatedAt: () => Number(EUGENIA_TS.match(/NOTE_MAX\s*=\s*(\d+)/)?.[1]),
  constrainedTo: () =>
    Number(EUGENIA_SQL.match(/char_length\(note\)\s+between\s+1\s+and\s+(\d+)/i)?.[1]),
};

test('the note length is one number on both sides of the wire', () => {
  // Each read from its own file; a pattern that stops matching yields NaN, so
  // both are checked before they are compared.
  const truncated  = noteLimit.truncatedAt();
  const constraint = noteLimit.constrainedTo();
  assert.ok(Number.isInteger(truncated), 'NOTE_MAX is no longer a literal in doji-eugenia');
  assert.ok(Number.isInteger(constraint), 'the note constraint no longer reads as a char_length range');

  assert.equal(constraint, truncated,
    'Postgres would refuse notes writeNote considers fine — every remember() fails quietly');

  // And the third copy is gone rather than merely agreeing: the description
  // must interpolate the constant, not restate it.
  assert.doesNotMatch(EUGENIA_TS, /at most \d+ characters/,
    'the tool description states the budget as a literal again instead of interpolating NOTE_MAX');
});

/* ─── And the kinds of note ──────────────────────────────────────────────────
   A vocabulary the model chooses from and Postgres enforces. A kind offered and
   refused makes every remember() of it vanish; a kind allowed and never offered
   is dead weight that reads as coverage.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── The five channels, in four places and two vocabularies ────────────────
   prompt.ts declares them and the prose interpolates the names. The tool's enum
   is what she may name, the constraint what the database accepts, and §2 the
   mechanism behind each. Offered and refused is a set_channel that 400s;
   allowed and never offered is a rung nothing can move. §2 heads each channel
   with the SPOKEN name, so it is held against the names rather than the ids.
   Either way she teaches a channel the census cannot see.
   ─────────────────────────────────────────────────────────────────────────── */

test('the five channels are the same five in the prompt, the tool, the constraint and §2', () => {
  const declared = [...(EUGENIA_PROMPT.match(/export const CHANNELS = \[([\s\S]*?)\] as const/)?.[1] ?? '')
    .matchAll(/\['([a-z_]+)',/g)].map(m => m[1]).sort();
  const enforced = [...(EUGENIA_SQL.match(/check \(channel in \(([^)]*)\)/i)?.[1] ?? '')
    .matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();

  assert.deepEqual(declared,
    ['central_bank_buying', 'dollar', 'inflation', 'jobs', 'rates_vs_inflation'],
    'the channels have changed — say so here, then check the constraint and the seed');
  assert.deepEqual(enforced, declared,
    'the check constraint and prompt.ts no longer hold the same five channels');

  // The tool offers whatever prompt.ts declares rather than a list of its own,
  // which is what makes the tool's copy impossible rather than merely checked.
  assert.match(EUGENIA_TS, /enum: CHANNELS\.map\(\(\[id\]\) => id\)/,
    'set_channel names its channels literally again instead of reading CHANNELS');

  // §2 heads each channel with the name she says out loud, so the mechanism she
  // reads and the rung she moves are the same five channels under two spellings.
  const spoken = [...(EUGENIA_PROMPT.match(/export const CHANNELS = \[([\s\S]*?)\] as const/)?.[1] ?? '')
    .matchAll(/\['[a-z_]+',\s*'([^']+)'\]/g)].map(m => m[1]);
  assert.equal(spoken.length, declared.length,
    'the channel list no longer pairs every id with the name she says');

  const headed = [...SECTIONS['2'].matchAll(/^### (.+)$/gm)].map(m => m[1].toLowerCase());
  for (const name of spoken) {
    assert.ok(headed.includes(name),
      `§2 has no section headed "${name}" — she reads the mechanism for a channel ` +
      `under one name and moves the rung under another`);
  }
});

test('the five rows are seeded, or a channel is invisible rather than unseen', () => {
  /* A channel with no row drops out of her map, which hides exactly what the map
     exists to show. */
  const seeded = [...(EUGENIA_SQL.match(/insert into public\.eugenia_channels[\s\S]*?on conflict/)?.[0] ?? '')
    .matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
  const declared = [...(EUGENIA_PROMPT.match(/export const CHANNELS = \[([\s\S]*?)\] as const/)?.[1] ?? '')
    .matchAll(/\['([a-z_]+)',/g)].map(m => m[1]).sort();
  assert.deepEqual(seeded, declared,
    'the seed and the channel list disagree — an unseeded channel vanishes from her map');
});

/* ─── The rung that comes back down, and the one that cannot ────────────────
   HE can say he has lost a channel, and promoting too early is her natural
   error, so the ladder has a way down. THE BOTTOM RUNG IS STILL UNREACHABLE:
   `unseen` says a channel never came up, and writing it back would report one
   she taught last week as one he has never met.
   ─────────────────────────────────────────────────────────────────────────── */

test('a demotion can reach every rung but the bottom one', () => {
  const body = bodyOf(EUGENIA_TS, 'async function setChannel(', 'doji-eugenia no longer has setChannel()');

  // Before the write, not after it: a PATCH that has already landed cannot be
  // refused, and `unseen` written once is indistinguishable from never taught.
  const guard = body.indexOf('CHANNEL_STATES[0]');
  assert.ok(guard > -1,
    'setChannel no longer refuses the bottom rung, so a demotion can report a ' +
    'channel she has taught as one he has never met');
  assert.ok(guard < body.indexOf('method: "PATCH"'),
    'the bottom-rung guard sits after the write, which is not a guard');
});

/* ─── verify.sql is fatal on error, which makes a stale name expensive ───────
   It is one query returning one row per fact, so an ERROR is not a failed row:
   it aborts the statement and every check below stops. A text signature that
   does not resolve raises 42883 rather than returning false. Postgres has
   non-throwing ways to ask — an oid from pg_proc, or to_regprocedure, which
   answers NULL — and the throwing forms (a text signature, a regprocedure
   cast) do not belong in a file whose errors take the rest with them.
   ─────────────────────────────────────────────────────────────────────────── */

test('verify.sql expects exactly the triggers schema.sql creates on trades', () => {
  /* THE TRIGGERS ROW NAMES THEM. Both halves are read out of files — what
     verify.sql expects, and every `create trigger` on public.trades in
     schema.sql — so adding a trigger without the check fails here. */
  const sql = source('supabase/verify.sql');

  const expected = sql.match(
    /\('exactly the four triggers on trades'[\s\S]*?\),\s*\n((?:\s*'[^']*'(?:\s*\|\|)?\s*\n?)+)\),/);
  assert.ok(expected, 'verify.sql no longer states the trigger list — the reader has gone blind');
  const named = expected[1].match(/'([^']*)'/g).join('').replace(/'/g, '')
    .split(',').map(t => t.trim()).filter(Boolean).sort();

  /* Both create forms; Gladys's trigger uses `or replace` because a plain create is not atomic
     against an existing trigger. The target is on a later line. */
  const created = [...SCHEMA_SQL.matchAll(
    /create\s+(?:or\s+replace\s+)?trigger\s+(\w+)\s+[\s\S]{0,120}?\bon\s+public\.trades\b/gi)]
    .map(m => m[1]).sort();

  assert.ok(created.length >= 3,
    `only ${created.length} triggers on trades read out of the SQL — the reader has gone blind`);

  assert.deepEqual(named, created,
    'verify.sql expects a different set of triggers on trades than schema.sql ' +
    'creates — run against a correct database it reports a fault, and run ' +
    'against a database missing one it reports nothing');
});

test('verify.sql names no function in a form that throws when it is gone', () => {
  const sql = source('supabase/verify.sql');
  assert.ok(sql.length > 1000, 'verify.sql could not be read — the reader has gone blind');

  /* A quoted `public.name(args)` is what has_function_privilege takes and throws
     on a miss. The safe forms name no arguments, so a signature literal anywhere
     here is the defect. */
  const signatures = [...sql.matchAll(/'public\.\w+\s*\([^']*\)'/g)].map(m => m[0]);
  assert.deepEqual(signatures, [],
    `verify.sql writes a function signature by hand: ${signatures.join(', ')} — it ` +
    `goes stale the first time an argument list changes, and a signature that no ` +
    `longer resolves THROWS rather than answering false, which takes every check ` +
    `below it with it. Ask by oid out of pg_proc instead`);

  // The same failure wearing a cast: 'public.f(int)'::regprocedure raises 42883
  // where to_regprocedure returns null.
  assert.doesNotMatch(sql, /::\s*regprocedure\b|::\s*regproc\b/,
    'verify.sql casts to regprocedure, which throws on a function that is not ' +
    'there — to_regprocedure answers null and lets the row simply fail');
});

/* ─── The guard on his levels is a paragraph, and nothing else holds it ──────
   She is handed his entry, stop and target so she can use them when he ASKS.
   Nothing structural keeps them out of a message she starts; the failure is a
   briefing opening on the level he is long from, which reads as relevance.
   ─────────────────────────────────────────────────────────────────────────── */

test('the prompt keeps his levels out of a message she starts', () => {
  /* Wrapping collapsed: the prompt is hard-wrapped, and a sentence moves across
     lines when a word is added ahead of it. */
  const said = SYSTEM.replace(/\s+/g, ' ');

  assert.match(said, /HIS LEVELS DO NOT APPEAR IN A MESSAGE YOU START/,
    'the prompt no longer keeps his entry and his stop out of a message she ' +
    'opens — she has them on every path and nothing now says not to lead with them');

  /* AND THE ONE REFUSAL, on the path where he is most likely to want advice. */
  assert.match(said, /any statement about what to DO with the position/,
    'the prompt no longer refuses trade management on the open position, which ' +
    'is the one thing the block was not built to enable');
});

test('she is told which two discipline columns lean, and where they lean', () => {
  /* THE BIAS IS A PROPERTY OF THE COLUMN. followed_sl and followed_tp are answered
     seconds after the fill, so they say what he meant; a correction he never
     made reads as compliance. Told where she reads the FIGURE, or she reports a
     stop-discipline rate with no idea it leans. */
  const said = SYSTEM.replace(/\s+/g, ' ');

  assert.match(said, /answered at OPEN/,
    'the prompt no longer says the two stop and target answers are given at ' +
    'open, so she has no reason to doubt a rate computed from them');
  assert.match(said, /bias(es)? upward|lean/,
    'the prompt names when the answers are given but not which way that pushes ' +
    'them, which is the half that changes what she may claim');
});

test('the nightly pass is told a demotion is his to declare', () => {
  /* The tool permits it; the prompt is what asks for it. Without the asking, a
     mechanism exists, is documented and is never once invoked. */
  assert.match(CONSOLIDATE, /comes back down when he says so/i,
    'the nightly pass is no longer told that he can declare a demotion, so the ' +
    'rung only ever climbs however the tool is written');
  assert.match(CONSOLIDATE, /never move one down/i,
    'the pass is no longer told that a demotion needs him to have said it — ' +
    'she would start reading one off a quiet evening');
});

test('the rungs are the same words in the tool, the constraint and §0', () => {
  const declared = [...(EUGENIA_PROMPT.match(/CHANNEL_STATES = \[([^\]]*)\]/)?.[1] ?? '')
    .matchAll(/'([a-z]+)'/g)].map(m => m[1]);
  const enforced = [...(EUGENIA_SQL.match(/check \(state in \(([^)]*)\)/i)?.[1] ?? '')
    .matchAll(/'([a-z]+)'/g)].map(m => m[1]);

  // ORDER MATTERS: the first element is the bottom rung, and channelsList falls
  // back to it for a missing row.
  assert.deepEqual(declared, ['unseen', 'explained', 'used', 'owns'],
    'the ladder has changed — say so here, and check what channelsList falls back to');
  assert.deepEqual(enforced.sort(), [...declared].sort(),
    'the check constraint and prompt.ts no longer hold the same rungs');

  /* AND §0 SAYS WHAT TO DO AT EACH ONE. A rung renamed elsewhere leaves that table
     answering for a state nothing produces and silent on the one she is handed. */
  const pitched = [...PITCH.matchAll(/^\| `([a-z]+)` \| /gm)].map(m => m[1]);
  assert.deepEqual(pitched, declared,
    'the strategy pitches at a different set of rungs than the map carries');
});

/* ─── The table she is handed, not the one she could fetch ───────────────────
   A row per rung proves nothing about whether the rows reach her. §0 below its
   summary is `get_strategy`-only and nothing tells her to fetch it, and
   `unseen` is a one-way door — so a pair of ends quoted in the prompts left
   every real rung without an instruction. This asserts the table is IN the
   cached prefix, and that §0 serves the same characters.
   ─────────────────────────────────────────────────────────────────────────── */
test('the rule that decides how a term is pitched is in her context, not fetchable', () => {
  assert.ok(SYSTEM.includes(PITCH),
    'the pitch table is no longer in the system prompt — it would be reachable ' +
    'only through get_strategy, which nothing instructs her to call, so every ' +
    'explanation would be pitched from the two ends the prompts happen to name');

  assert.ok(SECTIONS['0'].includes(PITCH),
    '§0 no longer serves the same table she is handed — a second copy of the one ' +
    'rule that decides how she teaches, with nothing comparing them');

  /* AND THE MIDDLE RUNGS CARRY AN INSTRUCTION: everything real sits between the
     ends, and a table silent there leaves a binary rule standing. */
  for (const rung of ['explained', 'used']) {
    const row = PITCH.split('\n').find(l => l.startsWith(`| \`${rung}\``));
    assert.ok(row && row.replace(/\|/g, '').trim().length > rung.length + 30,
      `the ${rung} rung has no instruction against it, so the ladder is once ` +
      `again a pair of ends — and that is the rung nearly every channel sits at`);
  }
});

test('the note kinds are the same three words in the tool and the constraint', () => {
  const offered = [...EUGENIA_TS.matchAll(/NOTE_KINDS = \[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/'([a-z]+)'/g)].map(k => k[1])).sort();
  const declared = [...SCHEMA_SQL.matchAll(/eugenia_notes_kind_check\s+check \(kind in \(([^)]*)\)/gi)];
  assert.equal(declared.length, 1,
    `found ${declared.length} declarations of eugenia_notes_kind_check where there is one`);
  const enforced = [...declared[0][1].matchAll(/'([a-z]+)'/g)]
    .map(m => m[1]).sort();

  assert.deepEqual(offered, ['commitment', 'fact', 'instruction'],
    'the kinds the tool offers have changed — say so here, and check the constraint');
  assert.deepEqual(enforced, offered,
    'the tool and the check constraint no longer offer the same kinds — a kind ' +
    'the constraint refuses is a remember() that vanishes, reported to nobody');
});


/* ─── A commitment is only worth having if something checks it ──────────────
   Three halves, each silent without the others. `/notes` hands him the audit,
   and its argument DEFAULTS, so a call site that stops reading commitments
   still answers — minus the list. SYSTEM tells her to record one and to say
   when a trade breaks it. CONSOLIDATE retires one whose week is over, or they
   pile up in her window held against trades they were never about.
   ─────────────────────────────────────────────────────────────────────────── */

test('a commitment is recorded, audited, held against his trades and retired', () => {
  const at = EUGENIA_TS.indexOf("text.trim().toLowerCase() === '/notes'");
  assert.ok(at > -1, 'the /notes branch is no longer where this reads it');
  const branch = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('return;', at));
  assert.match(branch, /readNotes\('commitment'\)/,
    '/notes no longer reads his commitments — the audit still answers, minus them');
  assert.match(branch, /notesList\([^)]*\bpromised[,)]/,
    '/notes reads his commitments and does not hand them to notesList');
  // The portrait's argument defaults the same way, so the same silence.
  assert.match(branch, /readPortrait\(\)/,
    '/notes no longer reads how she reads him — the audit still answers, minus it');
  assert.match(branch, /notesList\([^)]*\bportrait[,)]/,
    '/notes reads the portrait and does not hand it to notesList');
  assert.match(branch, /readRows<Read>\('Reads', recordQuery\(\)\)/,
    '/notes no longer reads her record — the audit still answers, minus it');
  assert.match(branch, /notesList\([^)]*\brecord[,)]/,
    '/notes reads her record and does not hand it to notesList');

  const bodies = Object.fromEntries(
    [...EUGENIA_PROMPT.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)]
      .map(m => [m[1], m[2].replace(/\s+/g, ' ')]));
  assert.match(bodies.SYSTEM, /kind='commitment'/,
    'SYSTEM no longer tells her how to record a commitment');
  assert.match(bodies.SYSTEM, /WHEN A CLOSED TRADE BREAKS ONE, SAY SO/,
    'SYSTEM no longer has her say when a trade broke a commitment — recorded ' +
    'and never checked, it is a promise nobody holds him to');
  assert.match(bodies.CONSOLIDATE, /HOLD THE DAY AGAINST WHAT HE COMMITTED TO/,
    'the nightly pass no longer checks the day against his commitments or ' +
    'retires the ones whose period is over');
});

/* ─── The moment a plan is kept or broken ────────────────────────────────────
   A plan that names its trigger is kept far more often than one that does not,
   and §9 says his failure has one trigger: the touch. Two sentences carry it,
   and nothing structural does, so this reads for both. R-07's probe is quoted
   as the rules table words it, so a reworded rule fails the copy here.
   ─────────────────────────────────────────────────────────────────────────── */
test('she asks for the moment a commitment applies, and asks his probe for the touch before the fact', () => {
  const system = SYSTEM.replace(/\s+/g, ' ');
  assert.match(system, /A COMMITMENT WITH A WHEN IN IT IS THE ONE THAT GETS KEPT/,
    'SYSTEM no longer asks him when a commitment applies, so "be more patient" is ' +
    'recorded as he said it and names no moment the habit fires in');
  assert.match(system, /The moment is his to name, never yours to supply/,
    'SYSTEM asks for the moment but no longer says it is his — she would write ' +
    'a commitment he never made');
  assert.match(system, /YOUR ONE QUESTION IS HIS OWN PROBE FOR THE TOUCH, ASKED BEFORE THE FACT/,
    'a plan check no longer asks what he will wait for at the level');

  const probe = ALWAYS.match(/\| R-07 \|[^\n]*?\*"([^"]+)"\*/)?.[1];
  assert.ok(probe, 'the rules table no longer words R-07 as a probe');
  assert.ok(system.includes(`"${probe}"`),
    `SYSTEM quotes R-07's probe differently from the rules table ("${probe}")`);
});

/* ─── Who the database and Gmail think they are calling ─────────────────────
   A function's name is its directory and every caller's URL, and the callers
   are SQL and an Apps Script that nothing compiles. A missed rename is a 404
   pg_net discards. verify.sql checks the live trigger; this checks every
   caller in the repository names a function that exists.
   ─────────────────────────────────────────────────────────────────────────── */

const read = (path) => ({ path, text: source(path) });

// Everything that names a FUNCTION, each on its own, so one that stops naming
// any is not covered by the others: Gladys's trigger, the trade event, the
// schedules, the Apps Script and the charm.
const CALLERS = [
  ...['Gladys', 'Her senses', 'Everything that runs on a timer']
    .map(t => ({ path: `schema.sql (${t})`, text: subject(t) })),
  read('doji_gmail_sync.gs'),
  read('charm/main/net.h'),
];

// Every file that names the PROJECT, which is a longer list: the app connects
// to it, config.toml links the CLI to it and the deploy workflow pushes to it.
const PROJECT_FILES = ['supabase/schema.sql', 'doji_gmail_sync.gs', 'index.html',
  'supabase/config.toml', '.github/workflows/deploy-functions.yml', 'charm/main/net.h'].map(read);

const called = (text) =>
  [...text.matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co\/functions\/v1\/([a-z0-9-]+)/g)]
    .map(([, project, fn]) => ({ project, fn }));

test('every function a caller names is a function that exists', () => {
  assert.deepEqual(DEPLOYED,
    ['doji-email-sync', 'doji-eugenia', 'doji-gladys', 'doji-mcp-sync', 'doji-tradingview'],
    'a function was added or removed — say so here, and check every caller');

  for (const { path, text } of CALLERS) {
    const urls = called(text);
    // A caller that matched nothing would pass every assertion below it.
    assert.ok(urls.length, `${path} calls no Edge Function at all — has the URL shape changed?`);
    for (const { fn } of urls) {
      assert.ok(DEPLOYED.includes(fn), `${path} calls /functions/v1/${fn}, which is not deployed`);
    }
  }
});

/* ─── Every CSS rule is reachable, and the scan that says so was proved first ─
   A selector whose class stopped being emitted costs nothing, matches nothing
   and reads as styling for something that exists. Two ways a scan goes blind:

     · Substring matching — `.win` is "found" inside `window`. Names match as
       whole tokens.
     · Treating any prefix before a quote as runtime construction — every class
       sits before a quote somewhere. A name assembled at runtime is a literal
       prefix ending where the variable begins (`'sess-wr-' + key`,
       `` `sess-wr-${key}` ``), so the prefix must be quote-terminated or
       followed by `${`, and end at a dash.

   Proved against planted defects — an invented rule, a live rule renamed in
   the stylesheet only, a rule named only in a comment, a substring of a live
   name — and an invented `.sess-wr-*` a real prefix reaches, which must NOT be
   flagged. Comments are stripped from the searched text.
   ─────────────────────────────────────────────────────────────────────────── */

// Exported shape rather than inline, so the proof above can be re-run against a
// planted defect without editing the assertion it is proving.
export function deadRules(src) {
  const a = src.indexOf('<style>') + 7, b = src.indexOf('</style>');
  const css = src.slice(a, b);

  // Prose is where a scan like this goes blind in both directions.
  const rest = (src.slice(0, a) + src.slice(b))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  // Selectors only: walk the brace depth rather than regex the whole sheet, so
  // a declaration value containing a brace or a dot cannot be read as one.
  const selectors = [];
  let depth = 0, buf = '';
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') { if (depth === 0) selectors.push(buf); buf = ''; depth++; }
    else if (ch === '}') { depth--; if (depth === 0) buf = ''; }
    else if (depth === 0) buf += ch;
  }

  const classes = new Set(), ids = new Set();
  for (const sel of selectors) {
    for (const [, c] of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) classes.add(c);
    for (const [, i] of sel.matchAll(/#(-?[A-Za-z_][\w-]*)/g)) ids.add(i);
  }

  const esc0 = (n) => n.replace(/[-]/g, '\\-');
  const seen = (n) => new RegExp(`(?<![\\w-])${esc0(n)}(?![\\w-])`).test(rest);
  const built = (n) => {
    for (let i = n.length - 1; i >= 4; i--) {
      const pre = n.slice(0, i);
      if (!pre.endsWith('-')) continue;
      const q = esc0(pre);
      if (new RegExp(`['"\`]${q}['"\`]`).test(rest)) return pre;
      if (new RegExp(`['"\`]${q}\\$\\{`).test(rest)) return pre;
    }
    return null;
  };

  const dead = [];
  for (const c of [...classes].sort()) if (!seen(c) && !built(c)) dead.push('.' + c);
  for (const i of [...ids].sort())     if (!seen(i) && !built(i)) dead.push('#' + i);
  return { dead, classes: classes.size, ids: ids.size, selectors: selectors.length };
}

test('every CSS rule in the client is reachable from the markup or the script', () => {
  const src = source('index.html');
  const got = deadRules(src);

  // WITHOUT THESE THE ASSERTION BELOW PASSES ON A PARSER THAT FOUND NOTHING.
  assert.ok(got.selectors > 250,
    `only ${got.selectors} selectors parsed — the brace walk has stopped working`);
  assert.ok(got.classes > 150,
    `only ${got.classes} classes found — the selector reader has gone blind`);

  assert.deepEqual(got.dead, [],
    `these selectors are styled and never emitted:\n  ${got.dead.join('\n  ')}\n` +
    `Delete the rule and everything else the thing owned — the CONFIG entry, the ` +
    `id attribute, the README paragraph and every call site, same pass.`);
});

test('the dead-rule scan can actually find a dead rule', () => {
  const src = source('index.html');
  const plant = (css, js = '') =>
    src.replace('</style>', `${css}\n</style>`).replace('const $ = id =>', `${js}\nconst $ = id =>`);

  // An invented rule nothing anywhere mentions.
  assert.deepEqual(deadRules(plant('.doji-zzz-orphan{color:red}')).dead, ['.doji-zzz-orphan'],
    'the scan cannot see a selector that is styled and never emitted');

  // A LIVE rule renamed in the stylesheet only — the shape a rename actually
  // leaves, and one a quote-adjacent prefix would wave through.
  const i = src.indexOf('<style>'), j = src.indexOf('</style>');
  const renamed = src.slice(0, i) + src.slice(i, j).replace(/\.watch-moved/g, '.watch-movedx') + src.slice(j);
  assert.deepEqual(deadRules(renamed).dead, ['.watch-movedx'],
    'a rule renamed in the stylesheet alone is not reported, so no rename is');

  // Mentioned in a comment and nowhere else. The audit had "poll" matching prose
  // about the poller; this is that failure with the sign flipped.
  assert.deepEqual(
    deadRules(plant('.doji-ghost-rule{color:red}', '// doji-ghost-rule lives only here')).dead,
    ['.doji-ghost-rule'],
    'a comment mentioning a class is being read as the class being used');

  /* A NAME THAT IS A SUBSTRING OF A LIVE ONE: `.hm` appears inside `hm-profit`
     and never as a class of its own. Without this the proof passes on
     `rest.includes(name)`, the loosest possible reader. */
  assert.deepEqual(deadRules(plant('.hm{color:red}')).dead, ['.hm'],
    'a class that only ever appears as part of a longer name is being read as ' +
    'used — the scan is matching substrings rather than whole tokens');

  // AND THE OTHER DIRECTION, which is what stops this scan deleting live code:
  // a name a real prefix builds must not be reported however invented it looks.
  assert.deepEqual(deadRules(plant('.sess-wr-invented{color:red}')).dead, [],
    'a class a runtime prefix reaches is reported dead — following this scan ' +
    'would delete a rule that is in use');
});

/* ─── Every top-level declaration is reached from somewhere in the file ──────
   The likely shape is not a function never called but a live one whose last
   CALLER was deleted: drop a line from render()'s step list and the renderer
   is intact, exported, passing its tests, and reached by nothing. index.html
   ALONE, because a function only the harness names is dead in the app.

   Strings are not stripped — that needs a JS parser, since `${}` holds code —
   so a name inside a string literal reads as referenced; none is. Comments
   ARE stripped.
   ─────────────────────────────────────────────────────────────────────────── */

export function unreferenced(src) {
  const js = src.slice(src.lastIndexOf('<script>') + 8, src.lastIndexOf('</script>'));
  const bare = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  const names = new Set();
  for (const [, n] of bare.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) names.add(n);
  for (const [, n] of bare.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(n);

  const dead = [];
  for (const n of [...names].sort()) {
    // Not preceded by a dot, or `Data.render` would count as a use of `render`.
    const re = new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
    if ((bare.match(re) || []).length <= 1) dead.push(n);
  }
  return { dead, declared: names.size };
}

test('every top-level declaration in the client is referenced somewhere', () => {
  const src = source('index.html');
  const got = unreferenced(src);

  assert.ok(got.declared > 80,
    `only ${got.declared} declarations found — the reader has gone blind`);
  assert.deepEqual(got.dead, [],
    `declared and reached by nothing:\n  ${got.dead.join('\n  ')}\n` +
    `Delete it and everything it owned — the CONFIG entry, the CSS, the README ` +
    `paragraph, the harness export and every call site, same pass.`);
});

test('the unreferenced-declaration scan can actually find one', () => {
  const src = source('index.html');
  const at = (find, add) => src.replace(find, add + find);

  assert.ok(unreferenced(at('function render() {', 'const dojiUnusedThing = 42;\n\n')).dead
    .includes('dojiUnusedThing'), 'a declared-and-never-used const is not found');

  assert.ok(unreferenced(at('function render() {', 'function dojiOrphanFn() { return 1; }\n\n')).dead
    .includes('dojiOrphanFn'), 'a declared-and-never-called function is not found');

  // Mentioned in a comment and nowhere else — the shape that hides dead code
  // behind an explanation of what it used to do.
  assert.ok(unreferenced(at('function render() {',
    'function dojiGhostFn() { return 1; }\n// dojiGhostFn is named only here\n\n')).dead
    .includes('dojiGhostFn'), 'a comment naming a function reads as calling it');

  /* THE ONE THAT HAPPENS: a live renderer dropped out of render()'s step list. */
  assert.ok(unreferenced(src.replace('    () => renderSetups(rows),\n', '')).dead
    .includes('renderSetups'),
    'dropping a step from render() leaves its renderer unreferenced and unseen');
});

/* ─── verify.sql's header counts its own checks ──────────────────────────────
   The count is read BEFORE running, so it has to be right. It is a quantity,
   so it is a digit and counted. Rows are matched on their shape in the VALUES
   list — `('check name',` at two spaces — and the count is bounded below, so a
   pattern that stopped matching reports a broken reader.
   ─────────────────────────────────────────────────────────────────────────── */

test('verify.sql says how many checks it runs, and runs that many', () => {
  const sql = source('supabase/verify.sql');

  const from = sql.indexOf('select check_name, actual, expected');
  const to   = sql.indexOf(') as t(check_name, actual, expected);', from);
  assert.ok(from > -1 && to > from, 'the summary block is no longer where the header says it is');

  const rows = (sql.slice(from, to).match(/^  \('/gm) || []).length;
  assert.ok(rows > 40, `only ${rows} checks parsed out of the summary — the reader has gone blind`);

  // The header is the banner-delimited note the file OPENS with, which is
  // everything above the one statement.
  const header = sql.slice(0, from);
  const stated = header.match(/all (\d+) checks/);
  assert.ok(stated, 'the header no longer states how many checks this runs');
  assert.equal(Number(stated[1]), rows,
    `the header says ${stated[1]} checks and the summary holds ${rows} — the file ` +
    `is wrong about itself in the paragraph read before it is run`);

  // AND ONCE: a second copy of the count is held together by nothing.
  const others = (header.match(/\b\d{2,}\b/g) || [])
    .filter(n => n !== stated[1]);
  assert.deepEqual(others, [],
    `the header states a second number (${others.join(', ')}) beside its count of ` +
    `${stated[1]} — one paragraph, one copy, or the spare one goes stale unwatched`);
});

/* ─── No colour is written in the script, only read from a token ─────────────
   A hex typed into a chart config is invisible to the stylesheet and survives
   every theme change and palette revision. Chart.js cannot read a CSS
   variable, so `cssToken()` resolves each into a module constant. Comments are
   stripped first: a comment naming a token's value is documentation.
   ─────────────────────────────────────────────────────────────────────────── */

test('the client writes no colour of its own, and reads them all through cssToken', () => {
  const src = source('index.html');
  const js = src.slice(src.lastIndexOf('<script>') + 8, src.lastIndexOf('</script>'));
  assert.ok(js.length > 50_000, `only ${js.length} chars of script found — the reader has gone blind`);

  const bare = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const written = [...bare.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g)]
    .map(m => m[0]);

  assert.deepEqual(written, [],
    `the script writes ${written.length} colour(s) of its own — ${written.join(', ')}. ` +
    `Chart.js cannot read a CSS variable, which is what cssToken() is for: put the ` +
    `value in the stylesheet as a token and resolve it into a module constant.`);

  // And the other half of the rule: the tokens ARE resolved rather than the
  // constants having been quietly filled in some other way.
  assert.ok((js.match(/cssToken\(/g) || []).length >= 8,
    'cssToken has almost no call sites left — the palette is being reached some other way');
});

/* ─── Every maintenance door is named in the README ──────────────────────────
   The doors are query parameters for exercising a path by hand when something
   has gone wrong — reached exactly when nobody will read the source to find
   them. They also bound what a holder of the cron secret can cause, and
   `?consolidate=1` WRITES her memory. Matched on the door name, not on prose
   about the feature.
   ─────────────────────────────────────────────────────────────────────────── */

test('every door a function opens is written down in the README', () => {
  const readme = source('README.md');

  const doors = new Set();
  for (const fn of DEPLOYED) {
    const src = source(`supabase/functions/${fn}/index.ts`);
    for (const [, d] of src.matchAll(/searchParams\.get\("([a-zA-Z]+)"\)/g)) doors.add(d);
  }

  // A pattern that stopped matching would report every function doorless.
  assert.ok(doors.size >= 8,
    `only ${doors.size} doors found across the functions — the reader has gone blind`);

  const missing = [...doors].sort().filter(d =>
    !new RegExp(`\\?${d}=|\`${d}\``).test(readme));

  assert.deepEqual(missing, [],
    `these doors exist and the README does not name them: ${missing.map(d => '?' + d).join(', ')}. ` +
    `A door is reached at the moment something has gone wrong, which is not when ` +
    `anyone reads the source to find out it is there.`);
});

/* ─── The README names everything the code keeps a list of ───────────────────
   The symbol test reads doc to code; this reads code to doc, for the lists a
   reader needs whole: every setting a function, the backup or the Apps Script
   reads from its environment, every table, view and function schema.sql
   declares, every tool Eugenia is handed and every command she answers. Each
   list is derived from the code, so a sibling added tomorrow fails here until
   the README says what it is.
   ─────────────────────────────────────────────────────────────────────────── */

test('the README names every setting, table, function, tool and command the code defines', () => {
  const readme = source('README.md');
  const fns = readdirSync(new URL('../supabase/functions', import.meta.url), { recursive: true })
    .filter(f => f.endsWith('.ts')).map(f => source(`supabase/functions/${f}`)).join('\n');
  const all = (text, re) => [...new Set([...text.matchAll(re)].map(m => m[1]))];

  const lists = {
    settings: [...all(fns, /\b(?:env|envHours)\(\s*["'`]([A-Z_]+)/g),
               ...readdirSync(new URL('../scripts', import.meta.url))
                 .flatMap(f => all(source(`scripts/${f}`), /process\.env\.([A-Z_]+)/g)),
               ...all(source('doji_gmail_sync.gs'), /getProperty\('([A-Z_]+)'\)/g)],
    tables: all(SCHEMA_SQL, /create (?:table if not exists|or replace view) public\.(\w+)/g),
    functions: all(SCHEMA_SQL, /create or replace function public\.(\w+)/g),
    tools: all(EUGENIA_TS, /\bname:\s*"([a-z_]+)"/g),
    commands: all(EUGENIA_TS, /'(\/[a-z]+)'/g),
  };
  // A pattern that stopped matching would report every list covered.
  for (const [what, floor] of [['settings', 20], ['tables', 10], ['functions', 10], ['tools', 10], ['commands', 2]]) {
    assert.ok(lists[what].length >= floor,
      `only ${lists[what].length} ${what} read out of the code — the reader has gone blind`);
  }

  const missing = Object.entries(lists).flatMap(([what, names]) =>
    names.filter(n => !new RegExp(`(^|[^\\w/])${n.replace(/\//g, '\\/')}\\b`).test(readme))
         .map(n => `${what}: ${n}`));
  assert.deepEqual(missing, [],
    'the code defines these and the README never says what they are');
});

/* ─── No paragraph is said to her twice ──────────────────────────────────────
   In `prompt.ts` and `strategy.ts` prose IS the program. A duplicate is paid
   for on every request in the cached prefix, and the day one copy is
   sharpened she is handed both with nothing reporting the contradiction. Six
   lines: too long to arise by coincidence, short enough to catch a part.
   ─────────────────────────────────────────────────────────────────────────── */

test('no passage of the prompt or the strategy is stated twice', () => {
  for (const file of ['prompt.ts', 'strategy.ts']) {
    const text = source(`supabase/functions/doji-eugenia/${file}`);

    // Prose lines only: a repeated `\`\`\`` fence or a blank line is not a
    // repeated passage, and the rules table legitimately repeats its shape.
    const lines = text.split('\n')
      .map((l, i) => [i + 1, l.trim()])
      .filter(([, l]) => l.length > 40 && !l.startsWith('|') && !l.startsWith('```'));

    assert.ok(lines.length > 100,
      `${file}: only ${lines.length} prose lines found — the reader has gone blind`);

    const N = 6, seen = new Map(), dup = [];
    for (let i = 0; i + N <= lines.length; i++) {
      // Contiguous in the file, or six lines gathered from across it are not a
      // passage at all.
      if (lines[i + N - 1][0] - lines[i][0] !== N - 1) continue;
      const key = lines.slice(i, i + N).map(x => x[1]).join('\n');
      const at = seen.get(key);
      if (at) dup.push(`${file}: lines ${at} and ${lines[i][0]}`); else seen.set(key, lines[i][0]);
    }
    assert.deepEqual(dup, [],
      `a passage is stated twice — it is sent on every request, it sits in the ` +
      `cached prefix, and sharpening one copy leaves her holding both:\n  ${dup.join('\n  ')}`);
  }
});

/* ─── No read of her tables goes round the one that checks the status ────────
   `readRows` is ask, refuse on a bad status, parse. PostgREST answers a missing
   table with a 404 carrying JSON, so a bare `res.json()` hands the caller an
   object for an array, and an unapplied migration reads as a block with
   nothing to say. One helper, and this stops a second copy being written.
   ─────────────────────────────────────────────────────────────────────────── */

test('every read of her tables goes through readRows', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  assert.match(src, /async function readRows<T>\(what: string, path: string\)/,
    'readRows is gone — every read is hand-written again');

  /* AND IT IS HANDED A PATH: it builds the `${SB_URL}/rest/v1/` prefix itself,
     so a full URL doubles it — a 404 on every read in production that nothing
     here can see, since SB_URL is "" under Node and every stub answers /rest/. */
  const calls = [...src.matchAll(/readRows<[^>]*>\(\s*'[^']*',([\s\S]{0,300}?)\);/g)];
  assert.ok(calls.length >= 15, `only ${calls.length} readRows calls found — the reader has gone blind`);
  for (const [, arg] of calls) {
    assert.doesNotMatch(arg, /SB_URL|rest\/v1/,
      `readRows is handed a full URL, so the prefix is doubled and the read 404s:${arg}`);
  }

  /* NAMED, NOT COUNTED: a count stays three while one exemption goes and a bypass
     arrives. Each raw GET is attributed to its function, and the set must match. */
  const fns = [...src.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)]
    .map(m => [m.index, m[1]]);
  const enclosing = (at) => {
    let name = '(top level)';
    for (const [i, n] of fns) { if (i > at) break; name = n; }
    return name;
  };

  const raw = [...src.matchAll(/await fetch\((?![^)]*method:)[\s\S]{0,400}?\{ headers: sbHeaders\((?:\)|"count=exact"\))[\s\S]{0,20}?\}\);/g)];
  assert.ok(raw.length >= 2,
    `only ${raw.length} raw GETs found — the reader has gone blind, and a bypass ` +
    `would be reported as compliance`);

  const where = [...new Set(raw.map(m => enclosing(m.index)))].sort();

  /* Each needs what a rows-returning helper cannot give:
  
       readRows        it IS the helper
       fillEmbeddings  reads `content-range` to report backlog
       healthBlock     a 404 is a SUPPORTED state — sync_health not applied — so it
                       returns "" where readRows throws */
  assert.deepEqual(where, ['fillEmbeddings', 'healthBlock', 'readRows'],
    `these functions read her tables without readRows: ${where.join(', ')}. A missing ` +
    `status check does not throw — PostgREST answers a missing table with a 404 ` +
    `carrying JSON, so the caller gets an object where it expected rows and the ` +
    `block it feeds simply falls silent.`);
});

/* ─── The Node floor has one home, and CI reads it from there ────────────────
   `engines.node` states the floor, which moves with jsdom. A workflow pinning
   `node-version: 22` is a second copy nothing compares: it resolves to the
   newest 22.x, so the day the floor passes that, CI installs a Node the suite
   is not claimed to run on and goes green. setup-node reads engines.node.
   ─────────────────────────────────────────────────────────────────────────── */

// Derived, so a workflow added later is held to both rules below unasked.
const WORKFLOWS = readdirSync(new URL('../.github/workflows', import.meta.url))
  .filter(f => f.endsWith('.yml')).map(f => read(`.github/workflows/${f}`));

test('every workflow takes its Node version from the one file that states it', () => {
  const pkg = JSON.parse(source('package.json'));
  assert.match(pkg.engines?.node ?? '', /^>=\d+\.\d+\.\d+$/,
    'package.json no longer states a Node floor, so node-version-file resolves ' +
    'to nothing and every workflow below is reading an empty decision');

  // engines alone is a note npm prints past (proved: a floor of >=99 installed
  // happily). engine-strict makes it a gate, so a green CI run means the Node
  // installed is above the floor.
  const npmrc = source('.npmrc');
  assert.match(npmrc, /^engine-strict\s*=\s*true$/m,
    '.npmrc no longer sets engine-strict, so engines.node is documentation again ' +
    'and npm installs on any version without a word');

  // The rule is about Node, so it binds the workflows that run it: the charm's
  // firmware build runs ESP-IDF in its own image and has no Node to version.
  // Comments are not running anything.
  const runsNode = ({ text }) => text.split('\n')
    .some(line => !/^\s*#/.test(line) && /\b(npm|node)\b/.test(line));
  const nodeWorkflows = WORKFLOWS.filter(runsNode);
  assert.ok(nodeWorkflows.length >= 4,
    `only ${nodeWorkflows.length} workflows run Node — the reader has gone blind`);

  for (const { path, text } of nodeWorkflows) {
    // Anchored to setup-node: a `node-version` under any other step is not this.
    assert.ok(/actions\/setup-node/.test(text), `${path} no longer sets Node up at all`);
    assert.match(text, /node-version-file: package\.json/,
      `${path} does not read the floor from package.json`);
    assert.doesNotMatch(text, /^\s*node-version:/m,
      `${path} pins a Node version of its own, which is a second home for a ` +
      `floor that only package.json is allowed to state`);
  }
});

/* ─── The database suite runs, though npm test cannot reach it ───────────────
   test/db sits below the glob `npm test` reads, on purpose: it needs a server.
   So nothing else would notice it stop running — the script renamed, the
   step dropped from CI.
   ─────────────────────────────────────────────────────────────────────────── */
test('CI runs the database suite that npm test leaves out', () => {
  const { scripts } = JSON.parse(source('package.json'));
  assert.match(scripts['test:db'] ?? '', /test\/db\/\*\.test\.mjs/, 'package.json no longer names the database suite');
  assert.ok(readdirSync(new URL('./db/', import.meta.url)).some(f => f.endsWith('.test.mjs')),
    'test/db holds no suite for test:db to run');
  assert.match(source('.github/workflows/test.yml'), /^\s*- run: npm run test:db$/m,
    'test.yml no longer runs the database suite, and nothing else does');
});

/* ─── A tag is a name its owner can move; a commit is the code you read ──────
   Every `uses:` is a 40-character commit. `@v7` is what a person types from
   memory and re-fetches whatever the tag points at, so the audit of an action
   and the run of it are two trees. Credentials are step-scoped, so what an
   earlier action reaches is the toolchain: setup-node provides the `node` that
   reads SB_SECRET_KEY a step later. The trailing `# v7.0.1` is Dependabot's and
   NOT asserted; the SHA carries the guarantee.
   ─────────────────────────────────────────────────────────────────────────── */

test('every action a workflow runs is named by commit, not by a movable tag', () => {
  const used = WORKFLOWS.flatMap(({ path, text }) =>
    [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map(m => ({ path, ref: m[1] })));

  assert.ok(used.length >= 8,
    `only ${used.length} uses: lines found across the workflows — the reader has gone blind`);

  const tagged = used.filter(u => !/@[0-9a-f]{40}$/.test(u.ref));
  assert.deepEqual(tagged, [],
    `${tagged.map(u => `${u.path} runs ${u.ref}`).join('; ')} — a tag or branch ` +
    `is a name its owner can repoint between one run and the next. Pin the ` +
    `commit and put the version in a trailing comment; dependabot.yml keeps it ` +
    `current.`);
});

/* The project ref in all three of its shapes — a URL, config.toml's project_id,
   the workflow's --project-ref — each anchored to its context. A restore into
   a new project edits every one, and a missed one keeps talking to the old. */
const REF = /https:\/\/([a-z]+)\.supabase\.co|project_id\s*=\s*"([a-z]+)"|--project-ref\s+([a-z]+)/g;

const refs = (text) => [...text.matchAll(REF)].map(m => m[1] ?? m[2] ?? m[3]);

test('every file that names the Supabase project names the same one', () => {
  const found = PROJECT_FILES.map(({ path, text }) => {
    const seen = new Set(refs(text));
    // A file that matched nothing would agree with everyone by saying nothing.
    assert.equal(seen.size, 1,
      `${path} names ${seen.size} project refs, expected exactly 1: ${[...seen].join(', ')}`);
    return [...seen][0];
  });
  assert.equal(new Set(found).size, 1,
    `the project is split across refs: ${[...new Set(found)].join(', ')}`);
});

/* The charm cannot be told the briefing has landed — it sleeps — so it wakes
   to ask in the hours the briefing is written, and holds its own copy of them.
   Read out of briefing.c and walked against briefDue and retryDue, every hour
   of a week: a copy an hour early asks for nothing, an hour short misses the
   last retry. */
test('the charm asks for the briefing in the hours it is written', () => {
  const c = source('charm/main/briefing.c');
  const [weekday, sunday, retries] = ['BRIEF_WEEKDAY', 'BRIEF_SUNDAY', 'BRIEF_RETRIES'].map(name => {
    const m = c.match(new RegExp(`^#define ${name}\\s+(\\d+)`, 'm'));
    assert.ok(m, `briefing.c no longer defines ${name}`);
    return Number(m[1]);
  });
  // The days, as the walk below takes them: Sunday's hour, weekdays', none on Saturday.
  assert.match(c, /(\w+)\.tm_wday == 0 \? BRIEF_SUNDAY : \1\.tm_wday <= 5 \? BRIEF_WEEKDAY : -1;/,
    'briefing.c no longer gives the days their hours as this test walks them');
  // Sunday 16 August 2026 to the Saturday after, New York on daylight time.
  for (let day = 0; day < 7; day++) {
    const first = day === 0 ? sunday : day <= 5 ? weekday : null;
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(Date.UTC(2026, 7, 16 + day, hour + 4));
      const charm = first !== null && hour >= first && hour <= first + retries;
      assert.equal(charm, Boolean(briefDue(at) || retryDue(at)),
        `day ${day} at ${hour}:00 New York: the charm ${charm ? 'asks' : 'does not ask'} and the briefing ` +
        `${charm ? 'is not' : 'is'} written`);
    }
  }
});


/* A new app is good once she has reached her Wi-Fi, whichever waking it is:
   confirmed where every join succeeds, and nowhere else. Confirmed on one
   path only, a press in the second after an update took the other, and the
   bootloader rolled a good app back at the next wake. */
test('the charm keeps a new app wherever she reaches her Wi-Fi', () => {
  const callers = execSync('git ls-files charm/main', { encoding: 'utf8' }).split('\n')
    .filter(f => f.endsWith('.c') && /\bota_confirm\(\);/.test(source(f)));
  assert.deepEqual(callers, ['charm/main/net.c'], 'a new app is confirmed somewhere other than where she joins, or nowhere');
  const join = bodyOf(source('charm/main/net.c'), 'static void join(void *arg) {', 'net.c has no join()');
  const gaveUp = join.indexOf('xEventGroupSetBits(events, GAVE_UP);');
  assert.ok(gaveUp > -1 && join.indexOf('ota_confirm();') > gaveUp,
    'join() confirms the app before it knows she joined');
});

/* The charm joins a network by waiting for an address or a refusal, and gives
   up on a failed attempt by leaving it. That leaving arrives as a disconnect,
   possibly once the next attempt has begun, and counted as a refusal it ends
   that attempt before it is tried. So every file that marks a refusal on a
   disconnect skips the reason her own leaving carries. Found, not listed, so
   a third joiner is held too. */
test('the charm never takes her own leaving for a network refusing her', () => {
  const joiners = execSync('git ls-files charm/main', { encoding: 'utf8' }).split('\n')
    .filter(f => f.endsWith('.c') && /WIFI_EVENT_STA_DISCONNECTED/.test(source(f)) && /REFUSED\)/.test(source(f)));
  assert.ok(joiners.length >= 2, `only ${joiners.length} files join a network — the reader has gone blind`);
  for (const f of joiners) {
    assert.match(source(f), /id == WIFI_EVENT_STA_DISCONNECTED &&\s*\(\(wifi_event_sta_disconnected_t \*\)data\)->reason != WIFI_REASON_ASSOC_LEAVE\)/,
      `${f} marks a refusal on any disconnect, her own leaving included`);
  }
});

/* ─── Every secret a function needs is one it refuses to run without ────────
   Each function answers 503 if a required secret is unset, rather than starting
   and authorising nobody. The guard is a hand-written list, so this reads the
   file's own env reads and requires the guard to match. It must be a chain of
   ORs: `!A || !B && !C` parses as `!A || (!B && !C)` and lets two go missing.
   ─────────────────────────────────────────────────────────────────────────── */

// The consts a function binds from its own environment. SB_KEY and SB_URL come
// from _shared, so the comparison runs from the file's reads to the guard.
const bound = (text) =>
  [...text.matchAll(/^const\s+([A-Z_]+)\s*=\s*env\((.*)$/gm)]
    .map(m => ({ name: m[1], line: m[2] }));

// The condition on the line above the refusal, which is the guard by
// construction: an `if` whose body logs "refusing all requests".
const guardClause = (text) => {
  const lines = text.split('\n');
  const at = lines.findIndex(l => l.includes('refusing all requests'));
  if (at < 1) return null;
  return lines[at - 1].match(/^\s*if \((.+)\) \{\s*$/)?.[1] ?? null;
};

/* SECRETS A FUNCTION CAN GENUINELY RUN WITHOUT, each a decision written down.
   Four are external vendors for one capability: speech-to-text (the Messages
   API takes no audio), embeddings (unset, search is full text and trigram),
   and speech (unset, the text goes). The fifth is the charm's door: unset,
   there is no charm. Unlike a missing bot token, one capability is absent and
   every other path is untouched.

   NOT FREE: each must be guarded where it is USED — a branch that handles its
   absence rather than an empty string reaching a fetch. A door's own secret is
   guarded by the door, since secretMatches refuses an empty one and
   fold.test.mjs holds that. That check is below. */
const OPTIONAL = new Set(['STT_URL', 'STT_KEY', 'EMBED_KEY', 'TTS_KEY', 'CHARM_SECRET']);

test('an optional secret is guarded where it is used', () => {
  for (const { name, text } of FUNCTIONS) {
    for (const { name: secret } of bound(text)) {
      if (!OPTIONAL.has(secret)) continue;
      assert.match(text, new RegExp(`if \\(![A-Z_ |!]*\\b${secret}\\b|if \\(secretMatches\\(\\w+, ${secret}\\)\\)`),
        `${name} treats ${secret} as optional but never checks it before use — ` +
        `unset, it would reach a request as an empty string rather than taking ` +
        `the branch that says she cannot do that yet`);
    }
  }
});

test('a function refuses to run without every secret it reads', () => {
  for (const { name, text } of FUNCTIONS) {
    const clause = guardClause(text);
    assert.ok(clause, `${name} has no boot guard refusing to run without its secrets`);

    assert.ok(!clause.includes('&&'),
      `${name}'s boot guard joins clauses with && — && binds tighter than ||, ` +
      `so a missing secret in that pair would not refuse the request`);

    const guarded = [...clause.matchAll(/!([A-Z_]+)/g)].map(m => m[1]);

    // A read with a `||` default can never be unset, so it is not required.
    // Neither is one this file has deliberately made optional — see OPTIONAL.
    const required = bound(text)
      .filter(b => !b.line.includes('||') && !OPTIONAL.has(b.name))
      .map(b => b.name);
    // SB_KEY comes from _shared, so it is added by hand.
    if (/\bSB_KEY\b/.test(text)) required.push('SB_KEY');

    // WITHOUT THIS THE LOOP BELOW IS VACUOUS: a file that stopped binding its
    // secrets as `const X = env(` would satisfy every guard.
    assert.ok(required.length >= 2,
      `${name}: only ${required.length} required secrets found — the reader has gone blind`);

    for (const secret of required) {
      assert.ok(guarded.includes(secret),
        `${name} reads ${secret} but will start without it — an unset one then ` +
        `surfaces as a downstream failure rather than as "not configured"`);
    }
  }
});


/* ─── The one door, and the property no assertion about its answer can see ───
   secretMatches rewritten to `presented === expected` gives the same answer to
   every behavioural test while stopping at the first differing byte — leaking
   the secret's length and leading bytes one timed request at a time. So both
   halves are read: the loop over every byte of the longer input, and the
   absence of a direct comparison.
   ─────────────────────────────────────────────────────────────────────────── */

test('the secret comparison cannot stop early, whatever its answer', () => {
  const src = source('supabase/functions/_shared/edge.ts');
  const body = bodyOf(src, 'export function secretMatches(', '_shared/edge.ts no longer has secretMatches()');

  assert.match(body, /for \([^)]*Math\.max\(a\.length, b\.length\)/,
    'secretMatches no longer walks the longer of the two inputs — a loop that ' +
    'stops at the shorter one returns after the bytes it was given, and the ' +
    'time it takes is the length it was comparing against');
  assert.match(body, /diff \|=/,
    'secretMatches no longer accumulates the difference, so it can leave the ' +
    'loop as soon as one byte disagrees — which is the leak itself');
  assert.doesNotMatch(body, /\b(presented|a)\s*[!=]==\s*(expected|b)\b/,
    'secretMatches compares the two secrets directly somewhere in its body — ' +
    'that is the rewrite this test exists to catch, and it passes every test ' +
    'written about what the function ANSWERS');
});

/* ─── Every function says the same thing about its own gateway ──────────────
   verify_jwt = false is stated per function in config.toml and as
   --no-verify-jwt on deploy. A function with no stanza deploys right only via
   the workflow; a hand-run deploy puts it behind the gateway, and every caller
   gets a 401 with nothing in its logs.
   ─────────────────────────────────────────────────────────────────────────── */

test('config.toml turns the gateway off for every function that exists', () => {
  // Comments stripped: a `verify_jwt` in prose would satisfy every assertion
  // below while the gateway was on.
  const toml = source('supabase/config.toml')
    .split('\n').map(l => l.replace(/#.*$/, '')).join('\n');

  for (const name of DEPLOYED) {
    const stanza = toml.match(
      new RegExp(`\\[functions\\.${name}\\]([^\\[]*)`));
    assert.ok(stanza, `config.toml has no [functions.${name}] stanza`);
    assert.match(stanza[1], /verify_jwt\s*=\s*false/,
      `${name} is deployed but its gateway is not turned off in config.toml`);
  }

  // And nothing configured that is not there: a stanza left behind after a
  // rename configures a function nobody deploys, and reads as coverage.
  const configured = [...toml.matchAll(/\[functions\.([a-z0-9-]+)\]/g)].map(m => m[1]).sort();
  assert.deepEqual(configured, DEPLOYED,
    'config.toml and supabase/functions name different sets of functions');
});


/* ─── The documents may only name things that exist ─────────────────────────
   A rename leaves every mention behind, and a document naming something gone
   reads exactly like one that is right. This catches the mechanical half — a
   name nowhere in the repository. A name that exists but no longer does what
   the sentence says is caught by reading, or not at all.
   ─────────────────────────────────────────────────────────────────────────── */

const TRACKED = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);

/* Everything the repository is, as one string. THIS FILE IS EXCLUDED: with it
   in the corpus, every entry below would validate against its own exception. */
const CODE = TRACKED
  .filter(f => /\.(html|ts|gs|sql|mjs|toml|json|yml|c|h|py)$/.test(f) && f !== 'test/agree.test.mjs')
  .map(f => source(`${f}`)).join('\n');

/* Backticked names that look like code — camelCase, snake_case, hyphenated,
   dotted or SCREAMING — not short English in a code font. The hyphen, the
   leading digit and the slash matter: `doji-telegram`, `005_cron.sql`,
   `supabase/016_tradingview.sql`. */
const SYMBOLS = /`([A-Za-z0-9_][A-Za-z0-9_/-]*(?:\.[A-Za-z0-9_]+)*)`/g;

const looksLikeCode = (name) =>
  /[A-Z_.\-]/.test(name) && name.length >= 4 && /[A-Za-z]/.test(name);

/* Named in prose BECAUSE they are not in the code, each with its reason:

     TODO                        a prohibition — CLAUDE.md forbids the marker
     background_color            }  manifest fields tried against the iOS
     apple-touch-startup-image   }  launch frame, none of which reached it

   AND THE BROKER'S OWN TOOL NAMES, real somewhere else. The five destructive
   ones are NOT here — they are DESTRUCTIVE_TOOLS in the poller, which is what
   makes the read-only claim checkable.

     get_symbols · get_assets · get_pending_orders · get_order_history ·
     get_version   read-only tools cTrader serves and the poller does not call
     MN_1          a get_trendbars period
     insufficient_quota  the embedding vendor's own code, quoted exactly
     to_regprocedure  a non-throwing form the documents prescribe; verify.sql
                   asks by oid instead and never calls it
     BlobPart      a Node lib type: the documents' example of why
                   types.test.mjs is not a whole typecheck
     tool_choice   the request field R-15 refuses, which the test beside
                   CRITIC_TOOLS asserts the code never sends */
const DELIBERATELY_ABSENT = new Set([
  'TODO', 'background_color', 'apple-touch-startup-image',
  'get_symbols', 'get_assets', 'get_pending_orders', 'get_order_history',
  'get_version', 'MN_1', 'insufficient_quota', 'to_regprocedure', 'BlobPart',
  'tool_choice',
]);

test('the documents name only symbols the repository has', () => {
  const missing = [];

  /* REFACTOR.md too: its value is that a cold session can trust it. */
  for (const doc of ['README.md', 'CLAUDE.md', 'REFACTOR.md']) {
    const text = source(`${doc}`);
    const named = new Set();

    for (const [, name] of text.matchAll(SYMBOLS)) {
      if (!looksLikeCode(name) || DELIBERATELY_ABSENT.has(name)) continue;
      named.add(name);
    }

    // WITHOUT THIS THE LOOP BELOW PROVES NOTHING. A pattern that stopped
    // matching would report every document clean.
    const floor = doc === 'REFACTOR.md' ? 10 : 40;
    assert.ok(named.size > floor,
      `${doc}: only ${named.size} symbols found — the reader has gone blind`);

    for (const name of named) {
      // A name with a file extension is a FILE, checked against what git tracks.
      // Checked by its last part, `net.h` would be found in any file holding an h.
      if (/\.(sql|html|ts|gs|mjs|toml|json|yml|md|c|h|py)$/.test(name)) {
        if (!TRACKED.some(f => f === name || f.endsWith('/' + name))) {
          missing.push(`${doc}: ${name} (no such file)`);
        }
        continue;
      }
      // A dotted name is checked by its last part: `Data.OWNED` is declared as
      // `OWNED:` inside an object literal, and `CONFIG.PERIODS` likewise.
      const leaf = name.split('.').pop();
      if (!CODE.includes(leaf)) missing.push(`${doc}: ${name}`);
    }
  }

  assert.deepEqual(missing, [],
    'the documents name things the repository does not have');
});


/* ─── The Data model is a copy of the schema ─────────────────────────────────
   The README's Data model is the contract on which writer owns which column.
   BOTH DIRECTIONS: a column the schema has and the section never names is
   usually the new one whose ownership is unargued; a name the schema dropped
   sends a reader after something gone. Read out of the SQL.
   ─────────────────────────────────────────────────────────────────────────── */

test('the Data model names every column the trades table has, and no other', () => {
  const columns = tradesColumns().map(c => c.name);
  assert.ok(columns.length >= 20,
    `only ${columns.length} columns read out of the schema — the reader has gone blind`);

  const readme = source('README.md');
  const from = readme.indexOf('## Data model');
  const to   = readme.indexOf('## What is derived');
  assert.ok(from > -1 && to > from, 'the README has no Data model section to read');
  const section = readme.slice(from, to);

  const undocumented = columns.filter(c => !section.includes('`' + c + '`'));
  assert.deepEqual(undocumented, [],
    'the trades table has columns the Data model never names — a reader ' +
    'building against this section cannot know they exist, and a new column ' +
    'is exactly the one whose ownership has not been argued yet');

  /* AND NOTHING NAMED THERE IS GONE. Only the two tables: the prose around them
     names columns of HER tables and the view. */
  const rows = [...section.matchAll(/^\| `(\w+)`(?:, `(\w+)`)? \|/gm)]
    .flatMap(m => m.slice(1)).filter(Boolean);
  assert.ok(rows.length >= 15, `only ${rows.length} column rows parsed — the tables have moved`);
  assert.deepEqual(rows.filter(c => !columns.includes(c)), [],
    'the Data model tabulates a column the schema does not have');
});


/* ─── The restore names every column, and never the generated one ───────────
   Postgres refuses any value for a generated column, a null included, so a
   `select *` restore stops at `pnl` — and a restore is only run on the day it
   is needed. Its update list must name every column, or a restored row keeps
   what the damaged one held. Read against the schema.
   ─────────────────────────────────────────────────────────────────────────── */
test('the restore procedure writes every column the table lets it write', () => {
  const readme = source('README.md');
  const sql = readme.match(/```sql\n-- 1\. paste the file's `tables.trades` array[\s\S]*?```/)?.[0];
  assert.ok(sql, 'the README no longer carries the restore procedure');

  const list = (text) => text.split(',').map(c => c.trim()).filter(Boolean);
  const target = list(sql.match(/insert into trades \(([^)]*)\)/)?.[1] ?? '');
  const selected = list(sql.match(/\nselect ([\s\S]*?)\nfrom jsonb_populate_recordset/)?.[1] ?? '');
  const updated = [...sql.matchAll(/(\w+) = excluded\.(\w+)/g)]
    .map(m => { assert.equal(m[1], m[2], `${m[1]} is restored from ${m[2]}`); return m[1]; });

  const columns = tradesColumns();
  assert.ok(columns.length >= 20, 'the schema reader has gone blind');
  const writable = columns.filter(c => !c.generated).map(c => c.name).sort();
  assert.deepEqual(columns.filter(c => c.generated).map(c => c.name), ['pnl'],
    'the generated columns are not the ones this test was written against');

  assert.deepEqual([...target].sort(), writable,
    'the restore does not insert exactly the writable columns — a generated one ' +
    'refuses the whole statement, and a missing one is lost on a fresh restore');
  assert.deepEqual(selected, target, 'the select does not line up with the insert list');
  // Identity, ownership and creation stand on a row that already exists.
  const kept = ['id', 'user_id', 'created_at', 'updated_at'];
  assert.deepEqual([...updated].sort(), writable.filter(c => !kept.includes(c)),
    'a row that exists is restored without some of its columns');
});
/* ─── The Layout block is a copy of the tree ─────────────────────────────────
   The first thing a cold session reads, and a map cannot show what it left
   out. BOTH DIRECTIONS: a file missing is invisible to a reader who trusts
   it; an entry for a deleted file sends them looking. These entries are not in
   backticks, so the symbol test cannot see them.
   ─────────────────────────────────────────────────────────────────────────── */

/* A path, whitespace, prose. An INDENTED entry is a detail under the directory
   above it, checked for existence rather than counted as coverage. */
const layoutBlock = () => {
  const found = source('README.md')
    .match(/\n## Layout\n+```\n([\s\S]*?)\n```\n/);
  assert.ok(found, 'README.md has no Layout block');

  const top = [], nested = [];
  for (const line of found[1].split('\n')) {
    if (!line.trim()) continue;
    (/^\s/.test(line) ? nested : top).push(line.trim().split(/\s/)[0]);
  }
  return { top, nested };
};

const covers = (entry, file) =>
  entry === file || (entry.endsWith('/') && file.startsWith(entry));

test('the Layout block names every file the repository tracks', () => {
  const { top, nested } = layoutBlock();

  // A fence moved to a heading this pattern misses would report nothing at all.
  assert.ok(top.length > 20, `only ${top.length} Layout entries parsed`);

  assert.deepEqual(TRACKED.filter(f => !top.some(e => covers(e, f))), [],
    'tracked files the Layout block does not name');

  assert.deepEqual(top.filter(e => !TRACKED.some(f => covers(e, f))), [],
    'Layout entries naming nothing the repository tracks');

  assert.deepEqual(nested.filter(e => !TRACKED.some(f => f.endsWith('/' + e))), [],
    'indented Layout entries naming no such file');
});

/* ─── One hour cycle, across four runtimes ──────────────────────────────────
   `hour12: false` leaves the cycle to the locale, which may resolve to h24 and
   render midnight as 24. Harmless against a market's opening range, fatal
   against a BOUNDARY: `Dates.nyParts` feeds `hour < 17` in `weekStart`, and
   `nyWall` in adherence.ts feeds `Date.UTC(..., w.hour, w.min)`, where 24 rolls
   into the next day. So every formatter that asks for an hour is read.
   ─────────────────────────────────────────────────────────────────────────── */

// Each `new Intl.DateTimeFormat(...)`'s arguments, by balancing parentheses:
// the options run over several lines.
const formatters = (text) => {
  const out = [];
  for (const m of text.matchAll(/Intl\.DateTimeFormat\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < text.length && depth) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    out.push(text.slice(m.index, i));
  }
  return out;
};

test('every clock in the repository states the same hour cycle', () => {
  let asked = 0;
  for (const path of TRACKED) {
    if (!/\.(html|ts|mjs|gs)$/.test(path) || path.startsWith('test/')) continue;
    const text = source(path);

    for (const args of formatters(text)) {
      assert.doesNotMatch(args, /hour12/,
        `${path} builds a formatter with hour12 — that leaves the cycle to the ` +
        `locale, and a locale resolving to h24 renders midnight as hour 24`);
      if (!/\bhour:/.test(args)) continue;
      asked++;
      assert.match(args, /hourCycle:\s*['"]h23['"]/,
        `${path} asks a formatter for an hour without stating hourCycle h23 — ` +
        `midnight can arrive as 24, and every boundary this repo compares an ` +
        `hour against is written for 0`);
    }
  }
  // The reader has to have found the clocks it is judging: a pattern that
  // stopped matching would report agreement across nothing at all.
  assert.ok(asked >= 8,
    `only ${asked} formatters ask for an hour — the reader has gone blind`);
});



/* ─── Every way she speaks to him reads what he has told her ────────────────
   His notes are the only channel he has for correcting her. Drop notesBlock()
   from one path and she carries on ignoring an instruction he thinks she took,
   and he cannot tell whether she disagreed, forgot, or never read it.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── The strategy, and the two ways it goes quiet ───────────────────────────
   She cannot write it, so nothing she does reports it missing: the
   always-loaded half dropped from the system prompt, or a citation
   get_strategy cannot serve.
   ─────────────────────────────────────────────────────────────────────────── */

test('the strategy rides on the cached system prompt, not on a message', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  // In the system block AND cached. In a message it is paid every turn and
  // breaks the prefix on each edit.
  assert.match(src, /system:\s*\[\{[^}]*text:\s*SYSTEM \+ ALWAYS[^}]*cache_control/,
    'the strategy is no longer part of the cached system prompt — either she has ' +
    'stopped being given it at all, or it is being paid for on every message');

  /* THE WINDOW IS DERIVED FROM THE TOOL ARRAY, where the cache key starts. Only
     the chat array's prefix is reused inside the hour; a literal here reads as
     a decision and costs 2× for a lifetime nothing reads. README.md carries the
     rows. */
  assert.match(src, /ttl:\s*tools === CHAT_TOOLS \? "1h" : "5m"/,
    'the cached prefix states one window for every caller again — the hour is ' +
    'only earned by CHAT_TOOLS, see the measurements in README.md');
});

test('what is summarised into every turn can also be read in full', () => {
  // Each rule cites the section holding its reasoning, and that citation is the
  // only route from a one-line rule to why it exists.
  /* THE SUBSECTION IS PART OF THE CITATION: R-05 and R-06 cite §4.1 and §4.2,
     and `/§(\d+)/` would capture `4` from both. */
  const cited = [...ALWAYS.matchAll(/§(\d+(?:\.\d+)?)/g)].map(m => m[1]);
  assert.ok(cited.length >= 3,
    `only ${cited.length} section references read out of the rules table — the reader has gone blind`);
  assert.ok(cited.some(k => k.includes('.')),
    'no subsection citation read out of the rules table — the reader has gone blind ' +
    'to exactly the shape that broke');

  /* Every one, through the tool's own resolution. AND A SUBSECTION MUST BE IN
     WHAT CAME BACK: readStrategy falls back to the parent, so a §4.7 that was
     never written resolves to §4 and looks like one that worked. The heading
     separates them. */
  for (const k of cited) {
    const body = readStrategy(k);
    assert.ok(body.startsWith('## '),
      `the rules table cites §${k} and get_strategy cannot serve it`);
    if (k.includes('.')) {
      assert.match(body, new RegExp(`^#+ ${k.replace('.', '\\.')} · `, 'm'),
        `the rules table cites §${k}, and the section served in its place has no ` +
        `such subsection in it — she would be handed the parent and never know`);
    }
  }

  /* §0 and §7 are always loaded as summaries; losing either from SECTIONS leaves
     her an abbreviation of something she cannot read whole. §1 and §11 do not
     exist and nothing cites them; an invented number is asserted below. */
  for (const k of ['0', '7']) {
    assert.ok(k in SECTIONS,
      `§${k} is summarised into every turn and can no longer be read in full`);
  }
});

test('an unknown section is answered, never silently empty', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const body = bodyOf(src, 'function readStrategy(', 'doji-eugenia no longer has readStrategy()');

  // The number arrives from the model. An empty result is a blank she fills in
  // herself, the one outcome worse than saying it is missing.
  assert.match(body, /has no section/,
    'readStrategy returns nothing for a section that does not exist — she would ' +
    'invent the reasoning rather than report it missing');
});

test('the version the document states is the version she is handed', () => {
  assert.match(ALWAYS, new RegExp(`version ${VERSION}\\b`),
    'ALWAYS announces a different version than VERSION exports');
  assert.match(SECTIONS['0'], new RegExp(`\\*\\*Version\\*\\* ${VERSION}\\b`),
    'the header section states a different version than VERSION exports — a rule ' +
    'change would be invisible to anything reading the version');
});

/* ─── A schedule nothing dispatches ──────────────────────────────────────────
   dueNow can answer 'consolidate' correctly for a year with no branch to act
   on it — a nightly 200 that looks healthy. fold.test.mjs proves the answer;
   this proves something acts on it.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── The force door asks the day, and asking it is the half a test can miss ──
   `briefKind` is driven from both sides in fold.test.mjs, and none of that can
   discover a caller still reading a constant. The door exists for the hour a
   briefing did NOT arrive, so it must be able to produce a Sunday briefing on
   Sunday evening.
   ─────────────────────────────────────────────────────────────────────────── */

test('a forced briefing asks what the day takes, not a literal', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const at = src.indexOf('async function postScheduled(');
  const body = src.slice(at, src.indexOf('\n}\n', at))
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/\/\/.*$/, '')).join('\n');

  assert.match(body, /postBriefing\(briefDue\(now\) \?\? briefKind\(now\)\)/,
    'the force door no longer falls back through briefKind — a literal there is ' +
    'correct on six days a week, which is exactly why nobody notices the seventh');
});

/* ─── A job that dies before its first model call leaves a row ───────────────
   `ask()` records a failed turn; a job dying BEFORE one would leave a table
   showing a system with nothing to do. AND THE ROW GOES DOWN BEFORE THE
   MESSAGE: the apology carries `.catch(() => {})`, so a refusing Telegram
   would otherwise take the only notice with it.
   ─────────────────────────────────────────────────────────────────────────── */

test('a scheduled job that dies records it, and records it before it apologises', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const bodyOf = (fn) => {
    const at = src.indexOf(`async function ${fn}(`);
    assert.ok(at > -1, `doji-eugenia no longer has ${fn}()`);
    return src.slice(at, src.indexOf('\n}\n', at))
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map(l => l.replace(/\/\/.*$/, '')).join('\n');
  };

  /* BOTH CALLERS THAT ANSWER BEFORE THEY WORK REACH ONE CATCH, the trade event
     included. */
  assert.match(bodyOf('postScheduled'), /catch \(err\) \{\s*return await jobFailed\(job, err\);/,
    'postScheduled no longer hands its failures to jobFailed');
  const entry = src.slice(src.indexOf('secretMatches(fromCron, CRON_SECRET)'));
  assert.match(entry, /background\(postTradeEvent\([^;]*\.catch\(err => jobFailed\('trade', err\)\)\)/,
    'a trade event that dies reaches the console and nothing else — no row, ' +
    'no apology, and no retry anywhere behind it');

  const body = bodyOf('jobFailed');
  const row = body.indexOf('recordRun(');
  const msg = body.indexOf('tg("sendMessage"');
  assert.ok(row > -1,
    'a scheduled job can die with nothing but an apology behind it, so the one ' +
    'table that survives says the job never ran at all');
  assert.ok(msg > -1, 'a job that died is no longer told to him');
  assert.ok(row < msg,
    'the row is written after the apology, so the case it exists for — a ' +
    'Telegram that is refusing — is still the case that leaves no trace');
});

test('every answer dueNow can give is dispatched by postScheduled', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  // The literals in dueNow's return type, which is the one statement of what it
  // can answer. 'weekday' and 'sunday' arrive as Brief and are handled together.
  const sig = src.match(/export function dueNow\([^)]*\):\s*([^{]+)\{/);
  assert.ok(sig, 'doji-eugenia no longer declares what dueNow returns');
  const answers = [...sig[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.ok(answers.length, 'dueNow now returns no named answers — the reader has gone blind');

  const body = bodyOf(src, 'async function postScheduled(', 'doji-eugenia no longer has postScheduled()');

  for (const a of answers) {
    assert.match(body, new RegExp(`due === '${a}'`),
      `dueNow can answer '${a}' and postScheduled never asks — that hour would ` +
      `return 200 having done nothing at all`);
  }
});

/* ─── The critic is given no tool, and not for the obvious reason ────────────
   An empty array is the stricter choice and was the cheaper write while the
   critic's effort differed at the top of the request. With effort a message,
   the array is all that keeps it off the briefing's prefix; moving it is the
   next measurement, one caller at a time. REFACTOR.md R-15 carries the figures.
   ─────────────────────────────────────────────────────────────────────────── */

test('the critic is offered no tool at all', () => {
  assert.match(EUGENIA_TS, /const CRITIC_TOOLS: unknown\[\] = \[\];/,
    'CRITIC_TOOLS is no longer empty — either the critic can now go and check ' +
    'something mid-revision, or it is writing a prefix it will not read');

  // AND NOTHING SENDS tool_choice: a new one would be the move R-15 refused,
  // under another name.
  const code = EUGENIA_TS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /tool_choice/,
    'something sends tool_choice again — see REFACTOR.md R-15 before keeping it');
});

/* ─── A fetched page has two bounds ──────────────────────────────────────────
   `max_uses` caps how many pages, not how large one is, so a single long
   thread could outweigh the briefing. Dropping this bound is invisible: the
   briefing arrives, reads well, and costs several times as much.
   ─────────────────────────────────────────────────────────────────────────── */

test('web fetch is bounded by size as well as by count', () => {
  const block = EUGENIA_TS.match(/const WEB_FETCH\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(block, 'doji-eugenia no longer defines WEB_FETCH');
  assert.match(block[1], /max_uses:\s*\d+/, 'web fetch is unbounded in count');
  assert.match(block[1], /max_content_tokens:\s*\d+/,
    'web fetch is unbounded in size — one long page can cost more than the ' +
    'briefing it was read for, and nothing reports it');
});

/* ─── Every tool sent is a tool served ───────────────────────────────────────
   Sent but not served throws once the model happens to call it — days later
   for a search tool. Served but not sent is unreachable code. web_search is
   excluded by shape: it carries a `type` and never arrives in the loop.
   ─────────────────────────────────────────────────────────────────────────── */

test('the tools she is offered are exactly the tools the loop can run', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  // Read from the DEFINITIONS rather than from a tools array, because there are
  // two arrays now and a tool belonging to either still has to be executable.
  const defined = [...src.matchAll(/^const ([A-Z_]+_TOOL) = \{/gm)].map(m => m[1]).sort();
  assert.ok(defined.length >= 3,
    `only ${defined.length} tools read out of the file — the reader has gone blind`);

  // Every tool defined is executable, and every tool executable is defined.
  const served = [...src.matchAll(/case ([A-Z_]+_TOOL)\.name:/g)].map(m => m[1]).sort();
  assert.deepEqual(served, defined,
    'a tool is defined that the loop cannot execute, or the reverse — the first ' +
    'throws only once she happens to call it, the second is unreachable');

  /* AND EVERY TOOL SET IS DRAWN FROM THAT LIST: a name in a set with no
     definition is offered to the model and unknown to the loop. */
  /* DERIVED: a list of sets typed here goes stale when one is added. CRITIC_TOOLS
     is the empty one, deliberately, and exempt from offering anything. */
  const sets = [...src.matchAll(/const ([A-Z_]+_TOOLS)(?:: unknown\[\])? = \[([\s\S]*?)\];/g)];
  assert.ok(sets.length >= 4,
    `read ${sets.length} tool sets out of the file — the reader has gone blind`);

  for (const [, set, block] of sets) {
    const named = [...block.matchAll(/([A-Z_]+_TOOL)\b/g)].map(m => m[1]);
    if (set !== 'CRITIC_TOOLS') {
      assert.ok(named.length, `${set} offers no tool this file defines`);
    }
    for (const t of named) {
      assert.ok(defined.includes(t), `${set} offers ${t}, which is not defined anywhere`);
    }
  }
});

/* ─── What the nightly pass is given to judge with ───────────────────────────
   It is told to notice what he has started doing differently — so it needs his
   trades — and to prefer superseding over adding — so it needs to search the
   archive. Without either the notes still look fine, which is failing upward.
   ─────────────────────────────────────────────────────────────────────────── */

test('the nightly pass sees his week and can reach past its own window', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const code = uncomment(bodyOf(src, 'async function postConsolidation(', 'doji-eugenia no longer has postConsolidation()'));

  assert.ok(reaches(code, 'tradesBlock'),
    'the pass is asked what he has started doing differently and is handed no ' +
    'trades to see it in');

  const set = src.match(/const CONSOLIDATE_TOOLS = \[([\s\S]*?)\];/);
  assert.ok(set, 'doji-eugenia no longer defines CONSOLIDATE_TOOLS');
  assert.match(set[1], /SEARCH_TOOL/,
    'the pass cannot search, so PREFER SUPERSEDING TO ADDING is asked of ' +
    'something that can only see the twenty notes it was handed');

  /* And still no web search: the argument for a narrow set was that a nightly
     bookkeeping pass has nothing to research, and that argument has not moved. */
  assert.ok(!set[1].includes('web_search'),
    'the nightly pass can now run web searches, which is money for nothing');
});

/* ─── The one thing nothing could measure ────────────────────────────────────
   What she is FOR is that his understanding grows; the map is the instrument,
   and a ladder that stopped moving looks exactly like one that never had to.
   So the pass records where the five stand.
   ─────────────────────────────────────────────────────────────────────────── */

test('the nightly pass reports the map it may just have moved', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const code = uncomment(bodyOf(src, 'async function postConsolidation('));
  assert.match(code, /await\s+recordChannels\(\)/,
    'nothing records where the channels stand, so the only claim this design ' +
    'rests on is the only one with no meter on it');

  const body = bodyOf(src, 'async function recordChannels(', 'doji-eugenia no longer has recordChannels()');
  // It runs after the pass has already written memory, so a throw here would
  // turn a good night into a 500.
  assert.match(body, /catch\s*\(/,
    'recordChannels can throw, and it runs after the work it reports on is done');
});

/* ─── The nightly meters write rows ──────────────────────────────────────────
   A dead embedding vendor leaves the lexical arm answering, so search still
   works with half of it gone; a ladder that stopped moving looks like one with
   no reason to. Neither is an error, so each goes to `eugenia_runs`. Read
   structurally — `sweepLine` is pure and cannot see whether anyone wrote it
   down — and BOTH OUTCOMES, or a vendor refusing for a fortnight reads as a
   table with nothing in it.
   ─────────────────────────────────────────────────────────────────────────── */

test('the sweep and the census both reach the table, however they end', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const strip = (t) => uncomment(t.replace(/\/\*[\s\S]*?\*\//g, ''));

  for (const [fn, caller, what] of [
    ['async function postConsolidation(', 'embeddings',
     'a vendor that has stopped answering, which takes half of search_memory ' +
     'with it and reports nothing'],
    ['async function recordChannels(', 'channels',
     'the only meter on the one claim this whole design rests on'],
  ]) {
    const body = strip(bodyOf(src, fn, `doji-eugenia no longer has ${fn}`));

    for (const [ok, half] of [['true', 'success'], ['false', 'failure']]) {
      assert.match(body, new RegExp(`recordRun\\(\\{[^}]*caller: '${caller}'[^}]*ok: ${ok}`),
        `${caller} records no ${half}, so the row cannot answer for ${what}`);
    }
  }

  // The sweep's own line is what separates an unset key from a vendor that
  // refused, and it is only in the row if the row carries it.
  assert.match(strip(bodyOf(src, 'async function postConsolidation(')), /detail: swept/,
    'the sweep records that it ran and not what it found, which is the ' +
    'question it exists to answer');
});

/* ─── Both meters run on the nights nothing else does ────────────────────────
   ONE EXIT, not a branch shape: any `return` between the read and the meters
   skips them on a night nobody spoke. The census cannot be hoisted to the top
   instead — it is taken after the pass, the only thing that moves a rung.
   ─────────────────────────────────────────────────────────────────────────── */

test('the nightly meters sit past every branch, not behind an early return', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const at = src.indexOf('async function postConsolidation(');
  const body = src.slice(at, src.indexOf('\n}\n', at))
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/\/\/.*$/, '')).join('\n');

  // Every `return`, not only the ones that open a line: `if (!day.length) return …`
  // is the same defect and was the shape that got past a line-anchored count.
  const returns = (body.match(/\breturn\b/g) || []).length;
  assert.equal(returns, 1,
    `postConsolidation has ${returns} returns — a quiet night takes the short ` +
    `one, and every meter written after it is skipped on exactly the nights ` +
    `there is nothing else to notice`);

  // And they really are after it: the last return is the last thing here.
  const census = body.indexOf('recordChannels()');
  const sweep  = body.indexOf('fillEmbeddings(');
  const exit   = body.search(/\breturn\b/);
  assert.ok(census > -1 && sweep > -1, 'postConsolidation no longer runs both meters');
  assert.ok(census < exit && sweep < exit,
    'a meter sits after the only return, so it never runs at all');

  /* AND THE CENSUS STAYS AFTER THE PASS, or every rung is recorded a night
     stale. */
  assert.ok(body.indexOf('await ask(') < census,
    'the census is taken before the pass, so it reports the ladder as it was ' +
    'about to stop being');
});

test('the search tool names the function the database actually defines', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  // The RPC path is a string in one file and a function in another; a rename is a
  // 404 that reads as the database being down.
  const rpc = src.match(/rest\/v1\/rpc\/(\w+)/);
  assert.ok(rpc, 'doji-eugenia no longer calls an RPC at all');
  assert.match(SEMANTIC_SQL,
    new RegExp(`create or replace function public\\.${rpc[1]}\\(`),
    `doji-eugenia calls ${rpc[1]}() but schema.sql does not define it`);

  // Both search columns have to exist or the function body references nothing.
  for (const table of ['eugenia_notes', 'eugenia_turns']) {
    assert.match(tableBody(EUGENIA_SQL, table), /\n\s+search\s+tsvector generated always/,
      `${table} has no generated search column, so eugenia_search cannot match against it`);
  }
});

/* ─── Who said it, on both sides of the wire ─────────────────────────────────
   The SQL decides which of three words a hit carries and searchList how each
   renders. A word on one side only is a hit attributed to the wrong person.
   Both lists are read out of their files.
   ─────────────────────────────────────────────────────────────────────────── */

test('every source the search can return is a source the renderer knows', () => {
  const fn = SEMANTIC_SQL.match(
    /create or replace function public\.eugenia_search[\s\S]*?\$\$;/);
  assert.ok(fn, 'schema.sql no longer defines eugenia_search');

  /* The literals in the two select lists: 'note', and both arms of the CASE on the
     turn's role. */
  const emitted = [...new Set([...fn[0].matchAll(/'(note|turn|you|him)'/g)].map(m => m[1]))];
  assert.ok(emitted.includes('note'), 'the notes arm no longer labels its hits');
  assert.ok(!emitted.includes('turn'),
    'the turn arm labels every turn the same way again — his words come back as hers');

  // Every non-note source must be a word the renderer holds — the map imported,
  // like SETUPS and COLUMNS.
  for (const word of emitted.filter(w => w !== 'note')) {
    assert.ok(word in SAID,
      `eugenia_search can return source '${word}' and searchList has no word for it — ` +
      `it would be rendered as the raw value`);
  }
  for (const word of Object.keys(SAID)) {
    assert.ok(emitted.includes(word),
      `searchList renders source '${word}' and eugenia_search can never return it`);
  }
});

test('the turn arm reads the column that says who was speaking', () => {
  // eugenia_turns.role exists and was simply never selected, which is why the
  // failure was silent: the query was valid and the answer was wrong.
  assert.match(SEMANTIC_SQL, /from public\.eugenia_turns t/);
  assert.match(SEMANTIC_SQL, /case when t\.role = 'user'/,
    'eugenia_search does not read t.role, so nothing downstream can tell his ' +
    'messages from hers');
});

/* ─── The pre-trade sequence ─────────────────────────────────────────────────
   R-08 is a rule about a list, so the list must be in the section the rule
   cites. FOUR STEPS: a step that can never be the one you stopped at is not a
   step, and R-08's only claim is that one of them ends the sequence.
   ─────────────────────────────────────────────────────────────────────────── */

test('R-08 cites a section that actually holds its steps', () => {
  const row = ALWAYS.split('\n').find(l => l.startsWith('| R-08'));
  assert.ok(row, 'R-08 is no longer in the rules table');

  const cited = row.match(/§(\d+)/);
  assert.ok(cited, 'R-08 cites no section at all');
  const body = SECTIONS[cited[1]];
  assert.ok(body, `R-08 cites §${cited[1]}, which get_strategy cannot serve`);

  // Four, numbered. The ORDER is the rule: a failed step ends the sequence.
  const steps = [...body.matchAll(/^\d\. \*\*/gm)];
  assert.equal(steps.length, 4,
    `§${cited[1]} lists ${steps.length} numbered steps, not the four R-08 requires`);
});

/* ─── Every section she is told to read is one she can be handed ─────────────
   `readStrategy` answers a missing section with what the document DOES hold,
   so an unresolved citation has her reporting her strategy silent on something
   it covers. And §4.1 is prose inside §4, so a mistyped §4.9 falls back to §4
   and looks like a citation that worked — a dotted citation must name a
   heading present in what came back.
   ─────────────────────────────────────────────────────────────────────────── */

test('every section the prompts cite is one get_strategy can serve', () => {
  const sources = { SYSTEM, CONSOLIDATE, ALWAYS };
  let checked = 0;

  for (const [name, text] of Object.entries(sources)) {
    for (const [, key] of text.matchAll(/§(\d+(?:\.\d+)?)/g)) {
      checked++;
      const body = readStrategy(key);
      assert.doesNotMatch(body, /^The strategy has no section/,
        `${name} cites §${key} and get_strategy cannot serve it — she would be ` +
        `told her own document is silent on something she was sent to read`);

      // The dotted half. A subsection resolves through the parent, so the body
      // coming back proves nothing unless the heading is actually in it.
      if (key.includes('.')) {
        assert.match(body, new RegExp(`§?${key.replace('.', '\\.')}`),
          `${name} cites §${key}, and what came back is the whole of §` +
          `${key.split('.')[0]} with no §${key} in it — the parent fallback ` +
          `answering a citation that does not exist, which reads exactly like ` +
          `one that does`);
      }
    }
  }
  assert.ok(checked >= 5,
    `only ${checked} citations found across the prompts — the reader has gone blind`);
});

test('the two reward-to-risk numbers are kept apart', () => {
  /* 1:1.5 is a condition at ENTRY — step 4 refuses the trade below it. A realised
     1:1.25 is both a $30 target shortened on an open trade and a breach set at
     $25 over a $20 stop; only a row carrying the plan as first seen can tell. */
  assert.match(ALWAYS, /at least 1:1\.5\s+to\s+enter/,
    'the entry condition has stopped being stated in the always-loaded half');
  assert.match(SECTIONS['12'], /At entry it is a condition: at least 1:1\.5/,
    'the definition no longer states 1:1.5 as a condition at entry');
  assert.match(SECTIONS['12'],
    /realised 1:1\.25 is legitimate as an outcome and illegitimate as a plan/,
    'the definition has gone back to reading 1:1.25 as a floor, which is the ' +
    'reading that let an entry in breach of step 4 look like the rule working');
});

/* ─── The strategy is markdown inside a template literal ─────────────────────
   Every backtick is escaped, and editing text that already contains escaped
   ones invites a second escape: `\\\``, valid TypeScript and valid prose,
   reaching her as a backslash before every column name.
   ─────────────────────────────────────────────────────────────────────────── */

test('no section reaches her carrying escape characters', () => {
  for (const [k, body] of Object.entries(SECTIONS)) {
    assert.ok(!body.includes('\\`'),
      `§${k} contains a backslash before a backtick — the escaping was applied twice, ` +
      `and she reads the document with literal backslashes through it`);
    assert.ok(!body.includes('\\$\{'),
      `§${k} contains an escaped interpolation, which is the same defect`);
  }
  assert.ok(!ALWAYS.includes('\\`'),
    'the always-loaded half carries escape characters into every single turn');
});

/* ─── The prompt is the product, and it is read as prose ─────────────────────
   A sentence inserted into a wrapped paragraph without rewrapping leaves a line
   at double width, and where it lands on a dash, `— —` ships into every
   request. Those two artifacts are asserted. The SHORT line left where a
   sentence was pulled out looks like a deliberate break, and is caught by
   reading only.
   ─────────────────────────────────────────────────────────────────────────── */

test('no paragraph of the prompt shows where it was edited', () => {
  /* The literals as the FILE holds them: an interpolation expands one short line,
     and it is the source wrapping that is the artifact. */
  /* DERIVED, so every exported prompt is checked without anyone deciding to add
     it. PITCH IS THE ONE EXEMPTION: a markdown table row cannot be wrapped. */
  const WRAPPED = /export const (\w+) = `([\s\S]*?)`;/g;
  const TABLE = new Set(['PITCH']);
  const bodies = [...EUGENIA_PROMPT.matchAll(WRAPPED)].filter(([, n]) => !TABLE.has(n));
  assert.ok(bodies.length >= 8,
    `read ${bodies.length} prompt bodies out of prompt.ts — the reader has gone blind`);

  for (const [, name, body] of bodies) {
    for (const [i, line] of body.split('\n').entries()) {
      assert.ok(line.length <= 84,
        `${name} line ${i + 1} is ${line.length} characters — a sentence was ` +
        `inserted without re-wrapping the paragraph: ${line.slice(0, 60)}…`);
      assert.ok(!line.includes('— —'),
        `${name} line ${i + 1} carries a doubled em-dash: ${line.slice(0, 60)}…`);
    }
  }
});

/* ─── The rules she can check, wherever they are listed ──────────────────────
   WRITTEN OUT THREE TIMES — the tool's description, the prompt's CHECKING HIS
   RULES and the README — each with its count spelled, and the two prompts also
   count the judgment rules. A rule retired from adherence.ts and left in a list
   is one she says she checked; a stale count is the same claim.
   ─────────────────────────────────────────────────────────────────────────── */

test('every list of the rules check_rules answers is the list it evaluates', () => {
  const between = (text, from, to) => {
    const a = text.indexOf(from), b = text.indexOf(to, a);
    assert.ok(a > -1 && b > a, `"${from}" … "${to}" is gone — the reader has gone blind`);
    // A description written as concatenated literals reads as one sentence.
    return text.slice(a, b).replace(/"\s*\+\s*"/g, '').replace(/\s+/g, ' ');
  };
  const lists = {
    'check_rules description': between(EUGENIA_TS, 'const CHECK_TOOL', 'input_schema'),
    'the prompt': between(EUGENIA_PROMPT, 'CHECKING HIS RULES', 'USE IT INSTEAD'),
    'the README': between(source('README.md'), '`adherence.ts` evaluates the', '`check_rules` serves it'),
  };

  const WORDS = { five: 5, six: 6, seven: 7, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, eighteen: 18 };
  const checked = checkRules([]).map(r => r.rule).sort();
  const table = [...ALWAYS.matchAll(/^\| (R-\d\d) \|.*?\| (journal|field|judgment) \|/gm)];
  const judgment = table.filter(([, , kind]) => kind === 'judgment').length;

  for (const [where, text] of Object.entries(lists)) {
    assert.deepEqual([...new Set(text.match(/R-\d\d/g))].sort(), checked,
      `${where} names a different set of rules from the ones adherence.ts evaluates`);
    const count = text.match(/the (\w+) rules a row can actually answer|the (\w+) rules a row can answer/i);
    assert.ok(count, `${where} no longer spells how many rules it checks`);
    assert.equal(WORDS[(count[1] ?? count[2]).toLowerCase()], checked.length,
      `${where} says ${count[1] ?? count[2]} rules and adherence.ts evaluates ${checked.length}`);
  }

  const other = lists['check_rules description'].match(/The other (\w+) rules are judgment rules/);
  const ofHis = between(EUGENIA_PROMPT, 'ARE NOT THE STRATEGY', 'nothing stored').match(/(\w+) of his (\w+) rules are judgment/i);
  assert.ok(other && ofHis, 'the judgment count is no longer spelled where it was');
  assert.equal(WORDS[other[1]], judgment, `check_rules says ${other[1]} judgment rules and §7 marks ${judgment}`);
  assert.equal(WORDS[ofHis[1].toLowerCase()], judgment, `the prompt says ${ofHis[1]} judgment rules and §7 marks ${judgment}`);
  assert.equal(WORDS[ofHis[2]], table.length, `the prompt says ${ofHis[2]} rules and §7 holds ${table.length}`);
});

/* ─── A preference of his is not the prompt's to state ───────────────────────
   A claim about a conversation this repository cannot see, in the file that
   decides how she talks to him, reaches him as her quoting a taste he never
   had. THE PROMPT CARRIES NO PREFERENCE OF HIS AT ALL: an instruction note is
   the channel for them, the one he can correct, and the prompt says notes
   outrank the shape. So tastes are searched for as tastes, and a rule propped
   up with *and he has told you so*, or *the nag he asked to be rid of*, is the
   other half. Bare `he told you` and
   `he said` stay: that is how the tool descriptions name the notes mechanism.
   ─────────────────────────────────────────────────────────────────────────── */

test('the prompt states no preference of his', () => {
  const taste =
    /\bhe (?:gets |is |gets a bit |grows )?\w*(?:frustrat|annoy|irritat|impatien|bored)|\bhe (?:hates|dislikes|prefers|resents)\b|\b(?:frustrates|annoys|irritates|bores) him\b/i;
  const cited = /\bhe has (?:told you|said) so\b|\bas he has (?:told you|said)\b|\bhe (?:asked|wants) to be rid of\b/i;

  const bodies = [...EUGENIA_PROMPT.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)];
  assert.ok(bodies.length >= 5,
    `read ${bodies.length} prompt bodies out of prompt.ts — the reader has gone blind`);

  for (const [, name, body] of bodies) {
    for (const sentence of body.split(/\n/).join(' ').split(/(?<=[.?!])\s+/)) {
      assert.ok(!taste.test(sentence),
        `${name} tells her what he does not like: "${sentence.trim().slice(0, 90)}…" — ` +
        `a preference reaches her as an instruction note, where he can change it, ` +
        `and a rule that cannot stand without him behind it is not a rule`);
      assert.ok(!cited.test(sentence),
        `${name} props a rule up with him: "${sentence.trim().slice(0, 90)}…" — ` +
        `say why the rule is right, or move it to a note`);
    }
  }
});

/* ─── Every read is bounded ──────────────────────────────────────────────────
   A normal day is a handful of turns, so an unbounded read looks identical to
   a bounded one until the day it does not.
   ─────────────────────────────────────────────────────────────────────────── */

test('every row-returning read of her own tables carries a limit', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  /* URLs are template literals joined by `+`, so they are joined first. A PATCH
     on one key is not a read and needs no limit. THE TABLE IS WHATEVER STANDS
     BEFORE THE `?`, not a list of names: `fillEmbeddings` reads
     `rest/v1/${table}`, and a reader that names its subjects is blind to it. */
  const joined = src.replace(/`\s*\+\s*`/g, '');
  const reads = [...joined.matchAll(/rest\/v1\/([^?`]+)\?(select=[^`]*)/g)]
    .map(m => [m[1], m[2]]);

  /* AND `select=` IS NOT WHAT MAKES A PATH A READ — the helper is. A read asking
     for every column writes no `select=`, so every call to readRows is a read by
     construction and a new one cannot be spelled out of view. */
  /* THE PATH-BUILDERS ARE RESOLVED RATHER THAN EXEMPTED. Any `…Query()` in the
     argument is replaced by its body, so a limit deleted from a builder fails
     here rather than widening every call site at once. */
  const resolve = (arg) => arg.replace(/(\w+Query)\(/g, (_, fn) =>
    bodyOf(joined, `function ${fn}(`, `the read helper names ${fn}(), which no longer exists`));

  const helper = [...joined.matchAll(/readRows<[^>]*>\(\s*'[^']*',\s*([\s\S]{0,240}?)\);/g)]
    .map(m => resolve(m[1]))
    .filter(arg => /rest\/v1\/|[a-z_]+\?[a-z_]+=/.test(arg));
  assert.ok(helper.length >= 15,
    `only ${helper.length} readRows calls found — the reader has gone blind`);
  for (const arg of helper) {
    const table = (arg.match(/(?:rest\/v1\/\$?\{?|`)([a-z_]+)\?/) ?? [, 'a computed path'])[1];
    reads.push([table, arg]);
  }

  assert.ok(reads.length >= 3,
    `only ${reads.length} reads found — the reader has gone blind`);

  for (const [table, query] of reads) {
    assert.match(query, /limit=/,
      `the read of ${table} has no limit — an unusual day puts the whole window ` +
      `into a model call with nothing to stop it`);

    /* AND A LIMIT TAKES AN END. `id` is the only monotonic key, so ordering by it
       asks for the newest rows or the oldest, and the two are indistinguishable
       until there is more than a window's worth. Ordering by a clock is a
       different question — the trade event reads `at.asc` because the next
       release is the earliest. */
    assert.doesNotMatch(query, /order=id\.asc/,
      `the read of ${table} orders id.asc under a limit, so it keeps the OLDEST ` +
      `rows in the window and silently drops everything since — which is what ` +
      `the nightly pass and the embedding backlog each did once`);
  }
});

/* ─── Retirement, and the filter that is the whole of it ─────────────────────
   A superseded note stays in the table; one clause keeps it out of her
   context. Lose it and she is handed the correction AND the thing it corrected
   every turn, with nothing marking which is current. The column, the filter
   and the tool parameter must all agree.
   ─────────────────────────────────────────────────────────────────────────── */

test('the notes read asks for live notes only, and for the id that names one', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const body = bodyOf(src, 'async function readNotes(', 'doji-eugenia no longer has readNotes()');

  assert.match(body, /superseded_by=is\.null/,
    'readNotes no longer filters out retired notes — every correction she has ' +
    'ever made comes back alongside the thing it corrected');
  assert.match(body, /select=id,note/,
    'readNotes no longer selects the id, so no note can be named in supersedes ' +
    'and nothing can ever be retired');
});

test('the column, the filter and the tool parameter all exist together', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  assert.match(EUGENIA_SQL, /superseded_by\s+bigint\s+references\s+public\.eugenia_notes\(id\)/,
    'schema.sql has no superseded_by column — the filter in the read would ' +
    'match nothing and PostgREST would refuse it');
  assert.match(src, /supersedes:\s*\{[\s\S]{0,80}type:\s*"integer"/,
    'the remember tool no longer offers supersedes, so she cannot retire a note ' +
    'however many she is shown');
  // The index has to match the read or it stops being used for it.
  assert.match(EUGENIA_SQL, /create index if not exists eugenia_notes_kind_id_desc[\s\S]*?where superseded_by is null/,
    'the notes index no longer matches the read it exists for');
});

/* ─── The same filter on the write, where it answers a different question ────
   This decides what a retirement may TOUCH. Without it the PATCH re-points an
   already-retired note: the trail becomes a star rather than a chain, and the
   honest "note N is not there to retire" can never be said. */

test('the supersede write may only retire a note that is still live', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const body = bodyOf(src, 'async function writeNote(', 'doji-eugenia no longer has writeNote()');
  const retire = body.slice(body.indexOf('if (retiring) {'));
  assert.ok(retire.length && retire.length < body.length,
    'writeNote no longer has a retirement branch to check');

  assert.match(retire, /eugenia_notes\?id=in\.\(\$\{old\.join\(','\)\}\)&superseded_by=is\.null/,
    'the supersede PATCH no longer filters on superseded_by=is.null, so a note ' +
    'that was already retired is re-pointed at the new row and the note that ' +
    'first corrected it is orphaned — with nothing erroring');
  assert.match(retire, /method: "PATCH", headers: sbHeaders\("return=representation"\)/,
    'the supersede PATCH stopped asking for the row back, so a filtered-to-nothing ' +
    'retirement is a 200 with an empty body and reads as done');
  assert.match(retire, /old\.filter\(id => !hit\.includes\(id\)\)/,
    'nothing checks that the retirement matched every row it named, so she reports a ' +
    'contradiction retired while it is still handed to her every turn');
});

/* ─── A block reaches the message, however it was awaited ────────────────────
   The calls are gathered into a Promise.all, so this follows the VALUE rather
   than the syntax: the call is made, and what it was bound to is used again.
   A dropped call fails the first half; a result read and never concatenated
   into the message fails the second.
   ─────────────────────────────────────────────────────────────────────────── */
const reaches = (code, fn) => {
  if (new RegExp(`await\\s+${fn}\\(\\)`).test(code)) return true;
  // EVERY Promise.all in the body — a body can hold two. Whitespace-tolerant
  // around the `=`, since a destructuring long enough to wrap is the same call.
  for (const all of code.matchAll(
    /const \[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\]\)/g)) {
    const names = all[1].split(',').map(s => s.trim()).filter(Boolean);
    const items = all[2].split(',').map(s => s.trim());
    const at = items.findIndex(i => i.startsWith(`${fn}(`));
    if (at < 0 || !names[at]) continue;
    const after = code.slice(all.index + all[0].length);
    if (new RegExp(`\\b${names[at]}\\b`).test(after)) return true;
  }
  return false;
};

test('every path that speaks to him reads his notes, the map and his desk', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  // The function bodies, so a call anywhere else in the file cannot satisfy this.
  const body = (name) => bodyOf(src, `async function ${name}(`, `doji-eugenia no longer has ${name}()`);

  /* postConsolidation is the worst to lose: without its notes she cannot see what
     she holds, never supersedes, and writes the same fact nightly. */
  /* FOUR LISTS FOR FOUR QUESTIONS. `TEACHES` is the three whose prompts build a
     term, so they get the map. `SENDS` is the three that put a message in front
     of him now — the nightly pass writes memory and sends nothing. His notes go
     to all four. A reply is `converse`, the turn every door into the
     conversation shares. */
  const TEACHES = ['postBriefing', 'converse', 'postConsolidation'];
  const SENDS = ['postBriefing', 'converse', 'postTradeEvent'];

  const reads = (fn) => uncomment(body(fn));

  for (const fn of TEACHES) {
    // Comments stripped, and `await` required: an un-awaited notesBlock
    // interpolates "[object Promise]" into the prompt as text.
    const code = reads(fn);
    assert.ok(reaches(code, 'notesBlock'),
      `${fn} never gets notesBlock() into the message it sends — an instruction ` +
      `he gave would be ignored, with nothing anywhere reporting it`);
    /* AND THE MAP: the only thing that says which channels are THIN, and its loss
       fails upward — she teaches well on whatever the day is about. Worst on the
       nightly pass, the only thing that can move a rung. */
    assert.ok(reaches(code, 'channelsBlock'),
      `${fn} never gets channelsBlock() into the message it sends — she would teach without knowing ` +
      `which channels are thin, and nothing would report it`);
  }

  /* NOTES REACH FOUR PATHS — the trade look, which arrives while he is in a
     position, included. */
  for (const fn of [...new Set([...TEACHES, ...SENDS])]) {
    assert.ok(reaches(reads(fn), 'notesBlock'),
      `${fn} never gets notesBlock() into the message it sends — an instruction ` +
      `he gave would be ignored, with nothing anywhere reporting it`);
  }

  /* AND HOW SHE READS HIM, wherever the notes go but the trade look: it is what
     the notes add up to once the oldest have rolled out of the window, and the
     nightly pass has to see the paragraph it is asked to move. The trade look
     reaches him in a position, where "he cuts winners early" is an order. */
  for (const fn of ['postBriefing', 'converse', 'postConsolidation']) {
    assert.ok(reaches(reads(fn), 'portraitBlock'),
      `${fn} never gets portraitBlock() into the message it sends — a lesson about ` +
      `him whose note rolled out of the window is gone there, with nothing reporting it`);
  }
  assert.ok(!reaches(reads('postTradeEvent'), 'portraitBlock'),
    'the trade look is handed the portrait — a line about how he trades, reaching ' +
    'a man in a position, reads as an instruction about the trade he is in');

  /* AND HER RECORD, to the two paths that give a read and to the pass that
     files them — and never to the trade look, which carries no read, so a
     record there could only be read as a reason to lean on one. */
  for (const fn of ['postBriefing', 'converse', 'postConsolidation']) {
    assert.ok(reaches(reads(fn), 'recordBlock'),
      `${fn} never gets recordBlock() into the message it sends — she holds a view ` +
      `as firmly after a month of misses as after a month of reads that held`);
  }
  assert.ok(!reaches(reads('postTradeEvent'), 'recordBlock'),
    'the trade look is handed her record — it arrives while he is in a position, ' +
    'where a hit rate beside a message reads as a reason to act on her');

  /* AND HER CALLS, where her record goes: a standing call she cannot see is a
     second one made beside it, and the pass reads tonight's scores. Never the
     trade look, where her own trade beside his is the most anchoring line there
     could be. */
  for (const fn of ['postBriefing', 'converse', 'postConsolidation']) {
    assert.ok(reaches(reads(fn), 'callsBlock'),
      `${fn} never gets callsBlock() into the message it sends — a call standing ` +
      `today is invisible to her, and she makes a second beside it`);
  }
  assert.ok(!reaches(reads('postTradeEvent'), 'callsBlock'),
    'the trade look is handed her calls — her own trade beside his, seconds after his fill');

  /* AND THE CONVERSATION WINDOW, ON EVERYTHING THAT SPEAKS: without it she says
     again what she said, and a repetition reads as emphasis. Hardest on the
     trade look, whose R-19/R-20 line fires on the print the briefing most likely
     named. postConsolidation reads its own fixed twenty-four hours. */
  for (const fn of SENDS) {
    assert.ok(reaches(reads(fn), 'recent'),
      `${fn} sends him a message with no conversation window — she cannot know ` +
      `she said the same thing an hour ago, and a repetition reads as emphasis`);
  }

  /* AND THE ABSENCE IS ASSERTED: presence checked on the paths that need it and
     absence nowhere would leave the one path the rule is about unread. */
  assert.ok(!reaches(reads('postConsolidation'), 'recent'),
    'the nightly pass now takes the twelve-turn window as well as its own ' +
    'fixed twenty-four hours — a second, shorter copy of the same day, paid ' +
    'for on every request of the one caller that reads a whole day at once');

  /* AND WHAT HE HAS ON, on the three that teach. postTradeEvent is reached FROM
     the position and already carries its row. */
  for (const fn of TEACHES) {
    const code = reads(fn);
    assert.ok(reaches(code, 'positionsBlock'),
      `${fn} never gets positionsBlock() into the message it sends — it can talk ` +
      `past an open position, and every rule about what she may say still passes`);
  }
});

/* ─── The pass that runs last reads what the writer was told ────────────────
   Two of the critic's checks are about him: whether the briefing obeys his
   standing instructions, and whether a term is built at a rung that no longer
   needs it. From one message alone, the mechanism in the paragraph reads as a
   redefinition and the build-up the map required is cut — last, every
   morning, fluently. So the call site is asserted: the prose can say the notes
   are above it while the call stops passing them.
   ─────────────────────────────────────────────────────────────────────────── */

test('the critic is handed his notes, the map and the desk it is asked to enforce', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const body = uncomment(bodyOf(src, 'async function critique(', 'doji-eugenia no longer has critique()'));

  /* In the message, not merely the signature, read from the template literal
     critique() hands to gate(). */
  const content = body.match(/`([\s\S]*?)`/);
  assert.ok(content, 'critique() no longer builds its message from a template literal');
  for (const block of ['notes', 'channels', 'desk', 'story']) {
    assert.match(content[1], new RegExp(`\\$\\{${block}\\}`),
      `the critic's message no longer carries ${block} — it is asked to judge the ` +
      `briefing against his instructions, the ladder and whether he is in a ` +
      `position while holding none of them, and it answers anyway`);
  }

  /* AND THE DRAFT STAYS LAST, or "return the briefing itself and nothing else"
     points at his notes. */
  assert.ok(content[1].indexOf('${draft}') > content[1].indexOf('${story}'),
    'the draft is no longer the last thing in the critic message — the prompt says ' +
    'it is at the end, and the blocks above it read like prose it could return');

  // And postBriefing hands over the three it has already awaited, rather than
  // the critic opening reads of its own on the far side of a briefing.
  assert.match(bodyOf(src, 'async function postBriefing('), /critique\(draft,\s*notes,\s*channels,\s*desk,\s*story,\s*left\(\)\)/,
    'postBriefing no longer passes the notes, the map, the desk and the story it already ' +
    'holds into critique() — the critic is back to judging without them');
});

/* ─── The senses, and the copies they add ────────────────────────────────────
   Vocabularies stated in a constraint and in code: a kind offered and refused
   is a write that vanishes. Both copies are read out of their files.
   ─────────────────────────────────────────────────────────────────────────── */

// The values inside a `check (col in ('a', 'b'))`, whichever constraint it is.
const checkValues = (sql, constraint) => {
  const at = sql.indexOf(constraint);
  if (at < 0) return null;
  const clause = sql.slice(at, sql.indexOf('))', at));
  // Case-insensitive, for `direction`'s BUY and SELL; callers assert on what came
  // back, so an empty list fails rather than passing.
  return [...clause.matchAll(/'([A-Za-z_]+)'/g)].map(m => m[1]).sort();
};

test('the kinds a loop may have are the kinds the table accepts', () => {
  const declared = checkValues(SENSES_SQL, 'eugenia_loops_kind_check');
  assert.ok(declared, 'schema.sql no longer constrains eugenia_loops.kind');
  assert.deepEqual([...LOOP_KINDS].sort(), declared,
    'index.ts offers a loop kind the table refuses, or the reverse — the first ' +
    'is a 400 she reports to nobody, the second is a value nothing can write');
});

/* ─── The two vocabularies the writers depend on ─────────────────────────────
   NARROWING a constraint breaks no build; it makes every write carrying the
   dropped value fail at PostgREST, reported to a console. `direction` would
   drop every SELL; `role` would drop her own turns, leaving a history of his
   messages alone.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── What Telegram is told to deliver ───────────────────────────────────────
   `allowed_updates` is set by hand, outside this repository, and a wrong one
   means the update is never delivered. Eugenia needs a message and a
   callback_query for the feedback keyboard; the README's registration and the
   code's dispatch are held together.
   ─────────────────────────────────────────────────────────────────────────── */

test('the README registers each bot for the updates its code actually handles', () => {
  const readme = source('README.md');
  const wanted = {
    'doji-eugenia': ['message', 'callback_query'],
    'doji-gladys':  ['callback_query'],
  };

  for (const [fn, kinds] of Object.entries(wanted)) {
    /* The block naming the endpoint AND the updates together — the endpoint alone
       appears in other sentences. */
    const line = [...readme.matchAll(new RegExp(`/functions/v1/${fn}`, 'g'))]
      .map(m => readme.slice(m.index, m.index + 400)
        .match(/allowed_updates\s*=\s*\[[^\]]*\]/))
      .find(Boolean);
    assert.ok(line,
      `the README shows no allowed_updates beside any mention of ${fn}'s ` +
      `endpoint — either the registration is gone or this reader is looking ` +
      `in the wrong place`);

    for (const kind of kinds) {
      assert.ok(line[0].includes(kind),
        `the README registers ${fn} without "${kind}" — that update is then ` +
        `never delivered, and nothing anywhere reports it`);
    }
    /* Read as a PROPERTY of the update: a bare word matches "poll" in prose about
       the poller. */
    const src = source(`supabase/functions/${fn}/index.ts`);
    for (const kind of [...line[0].matchAll(/"(\w+)"/g)].map(m => m[1])) {
      assert.match(src, new RegExp(`\\.${kind}\\b`),
        `the README registers ${fn} for "${kind}" and the function never reads ` +
        `it off the update — Telegram would deliver it and nothing would act`);
    }
  }
});

/* THE THREE POLLER RETURNS THAT LEGITIMATELY MARK NOTHING, each for its own
   reason, so written down rather than inferred from a status. A 503 at boot
   has no credentials to mark WITH; a 401 is somebody knocking; and the quote
   door is a run that still must not mark — every briefing and conversation
   reaches it, and a mark there would keep `last_ok` fresh while the two-minute
   poll sat dead. */
const UNMARKED = {
  'not configured':
    'the boot guard: no broker credentials loaded, so there is nothing to poll ' +
    'and nothing the mark could truthfully say',
  'unauthorized':
    'a caller without the cron secret — a knock at the door rather than a run',
  'symbol: SYMBOL_IDS[0]':
    'the quote door, which is a different job on the same function: marking it ' +
    'would let her price reads hold last_ok open over a dead poll',
};

/* ─── Both silent writers leave a mark, on both paths ────────────────────────
   `sync_health` is worth exactly as much as its call sites: missing from the
   success path a healthy writer reads as dead, missing from the failure path
   it is the original silence with a table beside it. Read structurally, since
   serve.test.mjs drives only the paths a stub can reach, and the calls sit at
   the end of long functions where a later edit walks past them.
   ─────────────────────────────────────────────────────────────────────────── */

test('the two writers with no voice record both outcomes', () => {
  const accepted = checkValues(SCHEMA_008, 'sync_health_id_check');
  assert.ok(accepted?.length === 2,
    `schema.sql constrains sync_health.id to ${accepted?.length ?? 0} names, not two`);

  for (const [fn, who] of [['doji-mcp-sync', 'poller'], ['doji-email-sync', 'email']]) {
    const src = source(`supabase/functions/${fn}/index.ts`);
    // Comments stripped: the name in prose about the call is not the call.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map(l => l.replace(/\/\/.*$/, '')).join('\n');

    assert.match(code, new RegExp(`await heartbeat\\("${who}"\\)`),
      `${fn} never records a completed run, so a writer that is working reads ` +
      `as one that stopped — which is the exact state this table exists to name`);
    assert.match(code, new RegExp(`await heartbeat\\("${who}",`),
      `${fn} never records a failure, so the only account of a run that failed ` +
      `at 03:00 is still a console nobody reads`);

    /* AND IN THE EMAIL FUNCTION EVERY 400 IS A FILL DISCARDED FOR EVER: the Apps
       Script labels the thread and the settled P&L is gone. Each refusal path must
       mark, and they are derived, so one added later cannot arrive unmarked. */
    if (who === 'email') {
      /* EACH WINDOW ENDS AT THE PREVIOUS `return`, so a path is credited only with
         its OWN mark. A flat look-back borrows the mark above it; bounding at the
         previous refusal spans the 500 path's mark in between. */
      const returns = [...code.matchAll(/return json\([^;]*\);/g)];
      // `answer` is answerFor(res.status), 400 for a row PostgREST will never
      // accept — the same discard, reached by a computed status.
      const isDiscard = (t) => /,\s*(?:400|answer)\s*\)/.test(t);
      const discards = returns.filter(r => isDiscard(r[0]));
      assert.ok(discards.length >= 3,
        `only ${discards.length} refusal paths found in ${fn} — the reader has gone blind`);

      let from = 0;
      for (const r of returns) {
        if (isDiscard(r[0])) {
          assert.match(code.slice(from, r.index), /await heartbeat\("email",/,
            `${fn} answers 400 with no heartbeat of its own behind it — that ` +
            `answer ends a thread's life, so the fill is lost and nothing says so`);
        }
        from = r.index + r[0].length;
      }

      /* THE ONE CONDITIONAL MARK STAYS NARROW. `testSecret()` in doji_gmail_sync.gs
         posts `{}` on purpose, and marking that refusal would report a healthy sync
         broken whenever a person ran the diagnostic. The carve-out is a body with no
         `id`, which `parseAlert_` cannot produce; wider, it swallows real findings. */
      assert.match(code, /const probe = !body \|\| typeof body !== "object" \|\| !\("id" in body\);/,
        `${fn}'s probe test is no longer exactly "the body carries no id" — a ` +
        `wider one stops marking fills that really were discarded`);
      assert.match(code, /if \(!probe\) await heartbeat\("email",/,
        `${fn} marks unconditionally on the refusal path, so running testSecret() ` +
        `reports a working sync as a failing one`);
    }

    /* AND EVERY PATH THAT COMPLETES MUST MARK. The market-closed return is a
       completed run; unmarked, gold's weekend close freezes the mark for
       forty-eight hours against a six-hour window and the sync reads dead every
       Sunday evening. `healthLine` is pure and cannot see this. THE PATHS ARE
       DERIVED AND THE SILENT ONES DECLARED, each with its reason. */
    if (fn === 'doji-mcp-sync') {
      const returns = [...code.matchAll(/return json\([^;]*\);/g)];
      assert.ok(returns.length >= 5,
        `only ${returns.length} return paths found in ${fn} — the reader has gone blind`);

      let from = 0;
      const used = new Set();
      for (const r of returns) {
        const marked = /await heartbeat\("poller"/.test(code.slice(from, r.index));
        from = r.index + r[0].length;
        if (marked) continue;

        const why = Object.keys(UNMARKED).find(k => r[0].includes(k));
        assert.ok(why,
          `${fn} returns \`${r[0].replace(/\s+/g, ' ').slice(0, 70)}…\` with no ` +
          `heartbeat of its own behind it and no reason written down — a run that ` +
          `completes without marking freezes the mark, and a frozen mark is how a ` +
          `healthy writer comes to read as dead`);
        used.add(why);
      }

      // AND NO REASON OUTLIVES ITS PATH, for the doors' reason: a sentence left
      // behind excuses the next return that happens to carry those words.
      for (const k of Object.keys(UNMARKED)) {
        assert.ok(used.has(k),
          `UNMARKED explains the '${k}' return of the poller and either it now ` +
          `marks or it is gone — a stale exemption is one the next path inherits`);
      }
    }

    /* A name the table both ACCEPTS and SEEDS: unaccepted is a 400 the writer
       swallows, unseeded is a PATCH landing on nothing — a 200 with an empty body. */
    assert.ok(accepted.includes(who),
      `sync_health_id_check refuses '${who}', so every heartbeat ${fn} sends is ` +
      `a 400 it swallows — indistinguishable from one that never fired`);
    assert.match(SCHEMA_008, new RegExp(`values[\\s\\S]*?'${who}'`),
      `schema.sql never seeds '${who}', and these writers PATCH by primary key — a ` +
      `missing row is a 200 with an empty array and the mark is dropped`);
  }
});

/* ─── The number in the instructions is a number, and numbers go stale ───────
   CLAUDE.md tells a new reader what `npm test` should print. It is derivable,
   so it is derived: one line per top-level `test(` call, across every suite in
   test/.
   ─────────────────────────────────────────────────────────────────────────── */

test('the test count the instructions state is the count the suite runs', () => {
  const files = readdirSync(new URL('../test', import.meta.url))
    .filter(f => f.endsWith('.test.mjs')).sort();
  assert.ok(files.length >= 4, `only ${files.length} suites found — the reader has gone blind`);

  const total = files.reduce((n, f) => n +
    (source(`test/${f}`)
      .match(/^test\(/gm) || []).length, 0);
  assert.ok(total > 100, `counted ${total} tests — the pattern has stopped matching`);

  const doc = source('CLAUDE.md');
  const stated = doc.match(/npm test\s+# (\d+) tests, (\w+) suites/);
  assert.ok(stated, 'CLAUDE.md no longer states what npm test prints');
  assert.equal(Number(stated[1]), total,
    `CLAUDE.md says ${stated[1]} tests and the suite runs ${total}`);

  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  assert.equal(stated[2], WORDS[files.length],
    `CLAUDE.md says ${stated[2]} suites and test/ holds ${files.length} — the ` +
    `script globs one level, so a fifth suite is either running unmentioned or ` +
    `sitting in a subfolder where it silently does not run at all`);
});

/* ─── The backup reads each table by a column that table has ─────────────────
   Paging needs a stable order, and `eugenia_channels` is keyed by `channel`:
   ordering it by `id` is a 400 and the whole backup refused. A stubbed fetch
   answers whatever it is asked, so the paging tests prove the loop and never
   the QUERY. This reads the column names out of the SQL.
   ─────────────────────────────────────────────────────────────────────────── */

test('every table the backup reads is ordered by a column it has', async () => {
  const { TABLES } = await import('../scripts/backup.mjs');
  assert.ok(TABLES.length >= 6, `only ${TABLES.length} tables in the backup`);

  for (const [table, orderBy] of TABLES) {
    const created = SCHEMA_SQL.match(
      new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`));
    assert.ok(created, `${table} is in the backup and schema.sql never creates it`);

    // The column as DECLARED — a name in a constraint or a comment is not one.
    const columns = created[1].split('\n')
      .map(l => l.trim().match(/^([a-z_]+)\s+(text|bigserial|bigint|int|numeric|boolean|timestamptz|date|vector)/))
      .filter(Boolean).map(m => m[1]);
    assert.ok(columns.length >= 2,
      `read ${columns.length} columns out of ${table} — the reader has gone blind`);
    for (const col of [orderBy].flat()) {
      assert.ok(columns.includes(col),
        `the backup orders ${table} by '${col}' and that column is not on it — ` +
        `PostgREST answers 400 and the entire backup is refused, on every run`);
    }
  }
});

/* ─── verify.sql has to ask about everything the files declare ───────────────
   An object declared and never asked about is drift in the part nobody checks,
   and each fails silently by construction: a missing `*_app_read` policy is
   RLS doing its job and the card showing nothing; a missing index returns the
   same rows off a sequential scan, slower every week.
   ─────────────────────────────────────────────────────────────────────────── */

const VERIFY = source('supabase/verify.sql');

test('verify.sql asks about every table, policy, index and function the files declare', () => {
  const tables = [...SCHEMA_SQL.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map(m => m[1]);
  const policies = [...SCHEMA_SQL.matchAll(/create policy (\w+) on/g)].map(m => m[1]);
  // `unique` too: a reader matching `create index` alone was blind to the one
  // kind of index a write depends on, which is how the tv_id index would have gone unasked.
  const indexes = [...SCHEMA_SQL.matchAll(/create (?:unique )?index (?:if not exists )?(\w+)/g)].map(m => m[1]);
  assert.ok(tables.length >= 8 && indexes.length >= 8,
    `read ${tables.length} tables and ${indexes.length} indexes — the reader has gone blind`);

  for (const t of tables) {
    assert.match(VERIFY, new RegExp(`RLS on ${t}\\b`),
      `verify.sql never asks whether public.${t} has RLS on, and RLS is the ` +
      `only thing between it and the publishable key`);
  }
  for (const p of policies) {
    assert.ok(VERIFY.includes(p),
      `verify.sql never asks for policy ${p} — without it RLS denies the app ` +
      `and the card shows nothing, which looks exactly like a quiet week`);
  }
  for (const i of indexes) {
    assert.ok(VERIFY.includes(i),
      `verify.sql never asks for index ${i} — a missing index is not an error, ` +
      `it is the same rows off a sequential scan, slower every week`);
  }

  /* THE EXPECTED STRING IS THE LIST ITSELF, held against what the SQL declares. */
  const expected = [...new Set(indexes)].sort().join(',');
  const stated = (VERIFY.match(/\('every declared index exists',[\s\S]*?\n   '([\s\S]*?)'\)/) || [])[1];
  assert.ok(stated, "verify.sql has no 'every declared index exists' row");
  assert.equal(stated.replace(/' \|\|\s*'/g, '').replace(/\s+/g, ''), expected,
    'the index row and the create index statements name different sets');

  // Functions the same way: a watcher's missing helper raises only when called.
  const functions = [...SCHEMA_SQL.matchAll(/create or replace function public\.(\w+)/g)]
    .map(m => m[1]);
  assert.ok(functions.length >= 8, `read ${functions.length} functions — the reader has gone blind`);
  const named = (VERIFY.match(/\('every declared function exists',[\s\S]*?\n   '([\s\S]*?)'\)/) || [])[1];
  assert.ok(named, "verify.sql has no 'every declared function exists' row");
  assert.equal(named.replace(/' \|\|\s*'/g, '').replace(/\s+/g, ''),
    [...new Set(functions)].sort().join(','),
    'the function row and the create function statements name different sets');
});

/* ─── A summary row may come back false; it may never throw ──────────────────
   An error in verify.sql is a file that STOPPED, taking every check below it.
   Postgres parses the whole statement first, so a summary row reading a public
   table directly raises 42P01 when the table is absent. Seed checks read
   through `query_to_xml`, which takes its query as a string, guarded by
   `to_regclass`, and answer NULL.
   ─────────────────────────────────────────────────────────────────────────── */

test('no summary row reads a table in a way that would throw', () => {
  const from = VERIFY.indexOf('from (values');
  const to = VERIFY.indexOf(') as t(check_name, actual, expected);');
  assert.ok(from > -1 && to > from, 'verify.sql no longer has one summary block');
  const summary = VERIFY.slice(from, to);

  /* Comments first, then strings: an apostrophe in a comment desynchronises
     quote matching for everything after it. */
  const unquoted = summary
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
  /* Any schema, not only `public`: on a database without pg_cron a direct read of
     `cron.job` raises too. The catalogs are always there. */
  const direct = [...unquoted.matchAll(/from\s+(public|cron|net|vault)\.(\w+)/g)]
    .map(m => `${m[1]}.${m[2]}`);
  assert.deepEqual(direct, [],
    `the summary reads ${direct[0]} directly — on a database missing it that is ` +
    `a raise, and one raise takes all of the checks with it`);

  // The catalogs are the safe way to ask, and to_regclass answers null.
  assert.match(summary, /to_regclass/, 'the summary no longer asks by oid at all');
});

/* ─── Every table stands behind RLS ──────────────────────────────────────────
   The publishable key is in `index.html` by design, and RLS is all that stands
   between it and every table — a policy scoping the rows, or RLS with no
   policy, which denies it outright. A table without `enable row level
   security` simply answers anyone. Read out of the SQL.
   ─────────────────────────────────────────────────────────────────────────── */

test('every table the schema creates has row level security on', () => {
  const sql = SCHEMA_SQL;

  const created = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)]
    .map(m => m[1]);
  assert.ok(created.length >= 8,
    `only ${created.length} tables read out of schema.sql — the reader has gone blind`);

  for (const t of created) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`),
      `public.${t} is created and never has RLS turned on, so the publishable ` +
      `key in index.html can read it — and a table that simply answers looks ` +
      `exactly like one that is meant to`);
  }
});

test('the sides a trade may have are the sides every writer writes', () => {
  const declared = checkValues(SCHEMA, 'trades_direction_check');
  assert.ok(declared, 'schema.sql no longer constrains trades.direction');
  assert.deepEqual(declared, ['BUY', 'SELL']);

  // Every file that names a side, and each must name only sides the table takes.
  const writers = [
    'supabase/functions/doji-mcp-sync/index.ts',
    'supabase/functions/doji-email-sync/index.ts',
    'doji_gmail_sync.gs',
    'index.html',
  ];
  for (const path of writers) {
    const text = source(path);
    const named = [...new Set([...text.matchAll(/["'](BUY|SELL)["']/g)].map(m => m[1]))];
    assert.ok(named.length,
      `${path} names no side at all — it used to, so either it stopped writing ` +
      `direction or this reader has gone blind`);
    for (const side of named) {
      assert.ok(declared.includes(side),
        `${path} writes direction ${side} and trades_direction_check refuses it`);
    }
  }
});

test('the roles a turn may have are the roles she actually writes', () => {
  const declared = checkValues(EUGENIA_SQL, 'eugenia_turns_role_check');
  assert.ok(declared, 'schema.sql no longer constrains eugenia_turns.role');

  // The effort message is sent at the head of a request and never stored, so
  // its role is not one a turn may have.
  const sent = EUGENIA_TS.replace(/export const effortMessages[\s\S]*?: messages;/, '');
  assert.notEqual(sent, EUGENIA_TS, 'effortMessages is gone, so this no longer knows which role is only sent');
  const named = [...new Set([...sent.matchAll(/role:\s*["'](\w+)["']/g)].map(m => m[1]))];
  assert.ok(named.length >= 2,
    `only ${named.length} roles written in doji-eugenia — the reader has gone blind`);
  for (const role of named) {
    assert.ok(declared.includes(role),
      `doji-eugenia writes role '${role}' and eugenia_turns_role_check refuses ` +
      `it, so that half of every exchange is a 400 and her history keeps only ` +
      `the other half`);
  }
  // And the other way: a rung in the constraint nothing writes is a value that
  // can never appear, which is how a vocabulary rots without failing.
  for (const role of declared) {
    assert.ok(named.includes(role),
      `eugenia_turns.role accepts '${role}' and nothing in doji-eugenia writes it`);
  }
});

test('the importance a release may carry is the one the table accepts', () => {
  const declared = checkValues(SENSES_SQL, 'eugenia_calendar_importance_check');
  assert.ok(declared, 'schema.sql no longer constrains eugenia_calendar.importance');

  /* TRADINGVIEW'S THREE LEVELS MAP ONTO THE SAME THREE; one the table refuses is
     a 400 on every filing it touches. */
  const tv = source('supabase/functions/doji-tradingview/index.ts');
  const mapped = tv.match(/const IMPORTANCE[^=]*= \{([^}]+)\}/);
  assert.ok(mapped, "doji-tradingview no longer maps TradingView's importance to her words");
  assert.deepEqual([...mapped[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]).sort(), declared,
    "TradingView's importance maps to one the table refuses, or one is unreachable");

  /* AND THE ONE HIS RULES COUNT IS ONE OF THEM: a rename leaves R-19's read
     matching nothing, with no error anywhere. */
  assert.ok(declared.includes('high'), 'nothing is filed as high, so R-19 never sees a print');
});

/* ─── The calendar reaches abroad; his rules do not ──────────────────────────
   doji-tradingview asks for a fixed list of economies and calendarRows decides
   which of theirs are filed, so the two lists are one fact in two files: an
   economy asked for and never kept is paid for on every filing, and one kept
   and never asked for is a selection that can never fire. And everything that
   acts on a release — R-19 — counts the US alone,
   while only the Sunday week and the rolling list carry what is filed from
   abroad.
   ─────────────────────────────────────────────────────────────────────────── */

test('the economies the calendar is asked for are the ones calendarRows keeps', () => {
  const tv = source('supabase/functions/doji-tradingview/index.ts');
  const asked = tv.match(/const CALENDAR_COUNTRIES = "([A-Z,]+)";/);
  assert.ok(asked, 'doji-tradingview no longer names the economies it asks the calendar for');
  assert.match(uncomment(bodyOf(tv, 'Deno.serve(async')), /countries: CALENDAR_COUNTRIES/,
    'the calendar door asks for something other than the declared economies');

  const lists = EUGENIA_TS.match(/const BANKS = \[[^\]]*\], AUCTIONS = \[[^\]]*\];/);
  assert.ok(lists, 'doji-eugenia no longer declares the central banks and auctions it keeps');
  const kept = new Set([...(lists[0] + bodyOf(EUGENIA_TS, 'export function wanted('))
    .matchAll(/'([A-Z]{2})'/g)].map(m => m[1]));
  kept.add(HOME);
  assert.deepEqual([...kept].sort(), asked[1].split(',').sort(),
    'the calendar is asked for an economy nothing keeps, or keeps one it never asks for');
});

test('only US releases are counted', () => {
  /* EVERY READ FILTERED ON A RATING, found rather than listed, so a new one
     arrives already asked the question. The Sunday week is the one declared
     exception: it is a list for her to read, not a release anything acts on. */
  const LISTS = ['export function weekQuery('];
  const reads = [...EUGENIA_TS.matchAll(/importance=eq\./g)].map(m => {
    const at = Math.max(...['\nexport function ', '\nasync function ', '\nexport async function ']
      .map(d => EUGENIA_TS.lastIndexOf(d, m.index))) + 1;
    return EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('(', at) + 1);
  });
  assert.ok(reads.length >= 2, `only ${reads.length} rated reads found — the reader has gone blind`);
  for (const decl of reads) {
    const body = bodyOf(EUGENIA_TS, decl);
    if (LISTS.includes(decl)) {
      assert.doesNotMatch(body, /country=eq\./, `${decl} no longer carries what is filed from abroad`);
      continue;
    }
    assert.ok(body.includes('country=eq.${HOME}'),
      `${decl} reads releases from abroad as his, so a print in Tokyo is one of his`);
  }
  for (const decl of LISTS) assert.ok(reads.includes(decl), `${decl} is declared a list and reads no rating`);

  /* THE COUNTRY HIS RULES COUNT is HOME in adherence.ts, the column's default
     in schema.sql — every row filed before the column was a US one — and the
     app's watch card, which can import neither. */
  assert.equal(HOME, 'US');
  assert.match(SENSES_SQL, new RegExp(`add column if not exists country text not null default '${HOME}'`),
    'eugenia_calendar.country defaults to an economy other than the one his rules count');
  const watch = bodyOf(source('index.html'), 'const Watch = {');
  assert.match(watch, new RegExp(`from\\('eugenia_calendar'\\)[\\s\\S]*?\\.eq\\('country', '${HOME}'\\)`),
    "the app's calendar card reads abroad too, and a night of it pushes the morning's prints off twenty rows");
});

/* ─── A command nothing routes does not exist ────────────────────────────────
   `parseChannel` stays green with the branch deleted from handleMessage, and
   the command falls through to the catch-all for slashes — no reply at all.
   ─────────────────────────────────────────────────────────────────────────── */

test('the rung he sets himself is routed, and routed before the slash catch-all', () => {
  const at = EUGENIA_TS.indexOf('async function handleMessage(');
  assert.ok(at > -1, 'doji-eugenia no longer has handleMessage()');
  const body = EUGENIA_TS.slice(at);

  const routed = body.indexOf('parseChannel(text)');
  assert.ok(routed > -1,
    'handleMessage no longer reads parseChannel, so /channel falls through to the ' +
    'catch-all and he is answered with silence');

  const catchAll = body.indexOf("text.startsWith('/')");
  assert.ok(catchAll > -1, "the slash catch-all has moved — this check is asserting nothing");
  assert.ok(routed < catchAll,
    '/channel is read after the catch-all that ignores every slash command, so it ' +
    'can never run');

  /* THROUGH setChannel, which holds the one-way door on the bottom rung and the
     unseeded-table check in one place. */
  assert.match(body.slice(routed, routed + 400), /await setChannel\(/,
    '/channel writes the ladder itself, so the guard on the bottom rung and the ' +
    'check for an unseeded table are now stated in one place and enforced in another');
});

/* ─── A rule the critic also holds has to move in both places ────────────────
   The critic runs LAST and returns the version that goes, so a rule loosened in
   the prompt and standing in `CRITIC` is put back every morning. One chain per
   briefing is such a pair: nine subjects each walking a mechanism is a survey.
   ─────────────────────────────────────────────────────────────────────────── */

test('one chain per briefing is stated to the writer and to the critic', () => {
  assert.match(EUGENIA_PROMPT, /ONE CHAIN IN A BRIEFING, NOT ONE PER EVENT/,
    'the briefing prompt no longer bounds how many mechanisms a briefing carries, ' +
    'so it goes back to a survey with a clause of chain on every event');
  assert.match(EUGENIA_PROMPT, /IS THERE MORE THAN ONE CHAIN IN IT\?/,
    'the critic no longer checks it — so the writer may obey the rule and the ' +
    'pass that runs last has no reason to keep that version');

  /* AND THE ROUND-UP SLOT SAYS SO ITSELF: a length says nothing about what may be
     inside the paragraph. */
  assert.match(EUGENIA_PROMPT, /NAMED AND NOTHING MORE/,
    'the round-up slot no longer forbids mechanism, which is where the second ' +
    'chain actually lived');
});

/* ─── A thread that cannot close fills the list that holds the ones that can ──
   `readLoops` hands her the newest ten, so a loop that never closes pushes the
   oldest out of view while leaving it open in the table — closable by nobody.
   A question unanswered for a week IS answered and closes, with a note; a
   WATCH is untouched, since age proves nothing about an odd reaction.
   ─────────────────────────────────────────────────────────────────────────── */

test('a question he has not answered in a week is closed, not kept', () => {
  assert.match(EUGENIA_PROMPT, /A QUESTION IS THE ONE EXCEPTION, AND A WEEK IS ITS ANSWER/,
    'the nightly pass no longer closes a question he has not answered, so every ' +
    'one of them stays open for the life of the deployment');

  // AND THE WATCH STAYS AN EXCEPTION, not "close anything old".
  assert.match(EUGENIA_PROMPT, /A thread that is merely old stays open/,
    'the pass may now close a watch for being old, which is the follow-through ' +
    'this whole mechanism exists for, quietly stopping');
});

/* ─── The briefing asks him nothing, and a reply still may ──────────────────
   A slot whose only output is an open thread measures nothing. THE SCOPE IS
   THE HALF THAT MATTERS: in the trade conversation one question and then
   silence is the method, and he answers there. So this is read as a pair.
   ─────────────────────────────────────────────────────────────────────────── */

test('the briefing closes without a question to him', () => {
  assert.match(EUGENIA_PROMPT, /NO CLOSING QUESTION\./,
    'the briefing may end with a question again — four went unanswered in eleven ' +
    'days and each one is an open thread that can only close by being given up on');

  // AND THE RULES THAT ONLY MADE SENSE WHILE IT ASKED ARE GONE: a rule about
  // re-asking where nothing asks is a dead branch a later reader restores the
  // slot from.
  assert.doesNotMatch(EUGENIA_PROMPT, /you may ask it once more, differently/,
    'the re-asking rule survived the slot it belonged to');
  /* BOTH FILES: the tool's description in index.ts can carry the sentence too. */
  for (const [file, text] of [['prompt.ts', EUGENIA_PROMPT], ['index.ts', EUGENIA_TS]]) {
    assert.doesNotMatch(text, /at most\s*"?\s*\+?\s*"?one of each in a\s+briefing/,
      `${file}: open_loop still promises a question loop the briefing can no longer open`);
  }
});

test('and a reply may still ask, because that is a conversation he is in', () => {
  /* THE CAPABILITY THIS MAY NOT COST: one question and then silence, when he
     started talking. */
  assert.match(EUGENIA_PROMPT, /When he mentions how he felt, slow down\. One question at a time/,
    'the trade conversation lost its questions, which is where he does answer');
  assert.match(EUGENIA_PROMPT, /Never infer what he planned\. Ask\./,
    'she now guesses a plan rather than asking for it');
  assert.match(EUGENIA_PROMPT, /THIS IS THE BRIEFING AND NOTHING ELSE/,
    'nothing scopes the silence to the briefing, so it reads as a ban on asking');
});

test('the verdicts a tap can carry are the verdicts the table accepts', () => {
  const declared = checkValues(SENSES_SQL, 'eugenia_feedback_verdict_check');
  assert.ok(declared, 'schema.sql no longer constrains eugenia_feedback.verdict');
  for (const v of declared) {
    assert.ok(parseFeedback(`fb|${v}|2026-03-12`),
      `the table accepts a verdict of "${v}" and parseFeedback refuses it, so ` +
      `that button could never be recorded`);
  }
  // And the keyboard only ever offers those.
  for (const row of feedbackKeyboard('2026-03-12').inline_keyboard) {
    for (const b of row) {
      assert.ok(declared.includes(parseFeedback(b.callback_data).verdict),
        `the keyboard offers ${b.callback_data}, which the table would refuse`);
    }
  }
});

test('the thesis budget is one number on both sides of the wire', () => {
  const declared = SENSES_SQL.match(/eugenia_thesis_length check \(char_length\(thesis\) between 1 and (\d+)\)/);
  assert.ok(declared, 'schema.sql no longer bounds the thesis');
  assert.equal(THESIS_MAX, Number(declared[1]),
    'index.ts truncates the thesis at a different length than the table accepts — ' +
    'the longer side is a 400 on a write she reports as saved');
});

// The prompts spell the window, and the point five short of it where the pass
// merges, out as words; NOTES is the number.
test('the window the nightly pass is told is the window the read takes', () => {
  const [word, near] = { 20: ['twenty', 'fifteen'] }[NOTES] ?? [];
  assert.ok(word, `NOTES is ${NOTES}, which CONSOLIDATE does not spell — update both`);
  const consolidate = CONSOLIDATE.replace(/\s+/g, ' ');
  assert.match(consolidate, new RegExp(`the ${word} newest notes of each kind`),
    'the nightly pass is told a different window from the one it is handed');
  assert.match(consolidate, new RegExp(`you are shown ${word} at most`),
    'the merge rule names a different window from the one the read takes, so ' +
    'it merges too late or never');
  assert.match(consolidate, new RegExp(`holds more than ${near}, find`),
    'the pass merges at a point that is no longer five short of the window');
});

test('a read is filed with the verdicts and lengths the table accepts', () => {
  const verdicts = SCHEMA_SQL.match(/eugenia_reads_verdict_check check \(verdict in \(([^)]*)\)\)/);
  assert.ok(verdicts, 'schema.sql no longer bounds the verdict');
  assert.deepEqual(verdicts[1].split(',').map(v => v.trim().replace(/'/g, '')), [...READ_VERDICTS],
    'index.ts sends a verdict the table refuses, or never sends one it accepts');
  for (const column of ['reading', 'test']) {
    const declared = SCHEMA_SQL.match(new RegExp(
      `eugenia_reads_${column}_length check \\(char_length\\(${column}\\) between 1 and (\\d+)\\)`));
    assert.ok(declared, `schema.sql no longer bounds ${column}`);
    assert.equal(READ_MAX, Number(declared[1]), `index.ts truncates ${column} past what the table accepts`);
  }
  const evidence = SCHEMA_SQL.match(/eugenia_reads_evidence_length check \(char_length\(evidence\) <= (\d+)\)/);
  assert.equal(READ_MAX, Number(evidence?.[1]), 'index.ts truncates evidence past what the table accepts');
  const firmness = SCHEMA_SQL.match(/eugenia_reads_firmness_check check \(firmness in \(([^)]*)\)\)/);
  assert.ok(firmness, 'schema.sql no longer bounds how firmly a read was said');
  assert.deepEqual(firmness[1].split(',').map(v => v.trim().replace(/'/g, '')), [...READ_FIRMNESS],
    'index.ts sends a firmness the table refuses, or never sends one it accepts');
  const lesson = SCHEMA_SQL.match(/eugenia_reads_lesson_length check \(char_length\(lesson\) between 1 and (\d+)\)/);
  assert.equal(NOTE_MAX, Number(lesson?.[1]), 'index.ts truncates a lesson past what the table accepts');
});

/* NEVER BY PRICE. A read graded on where gold went is a forecast with a score,
   and a score pulls the next read toward one — the thing the prohibitions
   exist to stop. Enforced by nothing but the sentence, in the two places the
   grader reads it. */
test('a call is filed with the sides, outcomes and condition length the table accepts', () => {
  const vocab = (name) => SCHEMA_SQL.match(new RegExp(`eugenia_calls_${name}_check check \\(${name} in \\(([^)]*)\\)\\)`))?.[1]
    ?.split(',').map(v => v.trim().replace(/'/g, ''));
  assert.deepEqual(vocab('direction'), [...CALL_SIDES], 'make_call files a side the table refuses');
  assert.deepEqual(vocab('outcome'), [...CALL_OUTCOMES], 'the scoring writes an outcome the table refuses');
  const length = SCHEMA_SQL.match(/eugenia_calls_condition_length check \(char_length\(condition\) between 1 and (\d+)\)/);
  assert.equal(CALL_MAX, Number(length?.[1]), 'make_call truncates a condition past what the table accepts');
});

/* SYSTEM tells her the rules make_call holds her to in words, and callProblem
   checks them in numbers. A rule moved in one and not the other has her filing
   calls the tool refuses, or describing a limit the tool does not keep. */
test('the call rules she is told are the ones make_call checks', () => {
  const WORDS = { 20: 'twenty', 25: 'twenty-five', 30: 'thirty', 1.5: 'one and a half' };
  const system = SYSTEM.replace(/\s+/g, ' ');
  for (const [said, why] of [
    [`the stop at most ${WORDS[FULL_STOP]} dollars from entry`, 'the stop cap'],
    [`the target ${WORDS[TARGET_MIN]} to ${WORDS[TARGET_MAX]} away`, 'the target band'],
    [`the reward at least ${WORDS[RR_MIN]} times the risk`, 'the reward floor'],
    [`break-even at plus ${WORDS[TO_BREAK_EVEN]}`, 'the break-even move'],
  ]) assert.ok(system.includes(said), `SYSTEM no longer states ${why} as make_call and scoreCall hold it: "${said}"`);
});

test('a read is judged by the test she stated, never by where price went', () => {
  const consolidate = CONSOLIDATE.replace(/\s+/g, ' ');
  assert.match(consolidate, /a read is never judged by where price went/,
    'the nightly pass may grade a read on the price');
  assert.match(consolidate, /Judge the test you stated; never add one, never soften one/);
  const tool = source('supabase/functions/doji-eugenia/index.ts').replace(/"\s*\+\s*"/g, '');
  assert.match(tool, /Judge only the test you stated, never where price went\./,
    'record_read no longer says a verdict is never on the price');
  const system = SYSTEM.replace(/\s+/g, ' ');
  assert.match(system, /Never cite it to him as a reason to believe a read/,
    'her record may be offered to him as a reason to trade on her read');
  assert.match(system, /never give a read to improve it, and never hold one back to protect it/);
});

test('the portrait budget is one number on both sides of the wire', () => {
  const declared = SCHEMA_SQL.match(/eugenia_portrait_length check \(char_length\(portrait\) between 1 and (\d+)\)/);
  assert.ok(declared, 'schema.sql no longer bounds the portrait');
  assert.equal(PORTRAIT_MAX, Number(declared[1]),
    'index.ts truncates the portrait at a different length than the table accepts — ' +
    'the longer side is a 400 on a write she reports as saved');
});

test('every table she reads or writes is one the schema creates', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const created = new Set([
    ...[...SCHEMA_SQL.matchAll(/create table if not exists public\.(\w+)/g)].map(m => m[1]),
    ...[...SCHEMA_SQL.matchAll(/create or replace view public\.(\w+)/g)].map(m => m[1]),
  ]);
  assert.ok(created.size >= 7, `only ${created.size} objects read out of the schema — the reader has gone blind`);

  const touched = new Set([...src.matchAll(/rest\/v1\/(eugenia_\w+)/g)].map(m => m[1]));
  assert.ok(touched.size >= 6, `only ${touched.size} tables read out of the function — the reader has gone blind`);
  for (const t of touched) {
    assert.ok(created.has(t),
      `doji-eugenia reads or writes ${t}, which schema.sql never creates — ` +
      `every call against it is a 404 the tool handlers turn into "that did not save"`);
  }
});

test('every column the cost meter writes is a column the table has', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const table = SENSES_SQL.match(/create table if not exists public\.eugenia_runs \(([\s\S]*?)\n\);/);
  assert.ok(table, 'schema.sql no longer creates eugenia_runs');
  const columns = new Set([...table[1].matchAll(/^\s{2}(\w+)\s+\w/gm)].map(m => m[1]));
  assert.ok(columns.size >= 8, `only ${columns.size} columns read out of eugenia_runs — the reader has gone blind`);

  const calls = [...src.matchAll(/recordRun\(\{([\s\S]*?)\}\)/g)];
  assert.ok(calls.length >= 3, `only ${calls.length} recordRun call sites — the reader has gone blind`);

  /* ONE READER FOR BOTH DIRECTIONS, or its halves read the same source two ways.
     Shorthand and long form both. Comments stripped; strings out next (a comma
     in prose is not a key separator); then every bracketed group, innermost
     first, since `.slice(0, 500)` carries commas that separate arguments. */
  const group = /\([^()[\]{}]*\)|\[[^()[\]{}]*\]|\{[^()[\]{}]*\}/g;
  const keysOf = (body) => {
    let flat = uncomment(body).replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
    // Until nothing changes, not `group.test(flat)`: a g-flag regex keeps its
    // position between calls.
    for (let i = 0; i < 8; i++) {
      const next = flat.replace(group, '');
      if (next === flat) break;
      flat = next;
    }
    return flat.split(',').map(seg => seg.trim().match(/^(\w+)/)?.[1]).filter(Boolean);
  };

  for (const [, body] of calls) {
    for (const k of keysOf(body)) {
      assert.ok(columns.has(k),
        `recordRun writes "${k}" and eugenia_runs has no such column — PostgREST ` +
        `refuses the whole row, so the meter goes quiet and only the console says so`);
    }
  }

  /* AND THE OTHER DIRECTION: a column nothing writes reads null for ever while
     the insert succeeds and the meter looks healthy. `id` and `at` are the only
     exemptions — a bigserial and a default the writer must not set. */
  const written = new Set(calls.flatMap(([, body]) => keysOf(body)));
  for (const col of columns) {
    if (col === 'id' || col === 'at') continue;
    assert.ok(written.has(col),
      `eugenia_runs has a "${col}" column and no recordRun call writes it — every ` +
      `row lands, the meter looks healthy, and the one figure it was added for ` +
      `reads null for ever`);
  }

  /* AND verify.sql NAMES THEM A THIRD TIME: a row asking after an undeclared
     column comes back false on a correct database. */
  const verify = source('supabase/verify.sql');
  const asked = verify.match(
    /table_name = 'eugenia_runs'\s*\n\s*and column_name in \(([^)]*)\)/);
  assert.ok(asked, 'verify.sql no longer asks whether eugenia_runs has its later columns');
  for (const name of asked[1].match(/'(\w+)'/g).map(q => q.slice(1, -1))) {
    assert.ok(columns.has(name),
      `verify.sql asks eugenia_runs for "${name}", which schema.sql does not declare — ` +
      `the row reports false against a database that is in fact correct`);
  }
});

/* ─── The line on price is the product ───────────────────────────────────────
   No signal, and no view on where price goes except one fenced three ways — the
   line between a market analyst and a signal service, enforced by nothing but
   the sentence. THE TWO GATES NEED IT AS MUCH AS THE WRITER: they REWRITE, and
   run last, so a gate not told the rule can hand back a message breaking it.
   CONSOLIDATE inherits SYSTEM.
   ─────────────────────────────────────────────────────────────────────────── */

test('no prompt that writes or rewrites may lose the line on price', () => {
  const bodies = Object.fromEntries(
    [...EUGENIA_PROMPT.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)]
      .map(m => [m[1], m[2].replace(/\s+/g, ' ')]));

  // Several phrasings, so rewording it does not fail and deleting it does.
  const SAYS = /where price goes|what price will do|whether a level holds|what the day will look like|what the rest of the session looks like/i;

  for (const who of ['SYSTEM', 'CRITIC', 'TRIM', 'TRADE_EVENT']) {
    assert.ok(bodies[who], `prompt.ts no longer exports ${who}`);
    assert.match(bodies[who], SAYS,
      `${who} no longer says anything about a call on where price goes. That ` +
      `line is the difference between a market analyst and a signal service, ` +
      `nothing else in this repository enforces it, and a gate that has not ` +
      `been told it rewrites a compliant message into one that breaks it`);
  }

  // And the two that send nothing he reads as analysis are deliberately out:
  // CONSOLIDATE writes memory and runs under SYSTEM like every caller.
  assert.ok(bodies.CONSOLIDATE, 'prompt.ts no longer exports CONSOLIDATE');
});

/* ─── Her read is allowed because it is fenced, and the fence is three copies ─
   Labelled as HER read, carrying what would prove it wrong, naming no level —
   and none while he is in a position. A writer losing a half sends a read with
   a level in it; a gate losing one CUTS every compliant read. THE
   OPEN-POSITION HALF NEEDS AN INPUT TOO: a gate must be handed the block that
   says whether he is in a position.
   ─────────────────────────────────────────────────────────────────────────── */

test('both gates check the message against the story, and the story states a direction', () => {
  /* "Rate cut odds" in a week the Fed had hiked, inside reasoning about a hike: a
     slip neither gate could catch, being handed nothing that says which way
     things are going. One rule held by both, the way WRITING is, and only as good
     as the story — so the nightly pass writes the direction into it. */
  const body = (name) => EUGENIA_PROMPT.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`))[1];
  assert.match(body('AGAINST_THE_STORY'), /says "cut" where the story says "hike"/,
    'AGAINST_THE_STORY no longer names the slip it exists for');
  for (const gate of ['CRITIC', 'TRIM']) {
    assert.ok(body(gate).includes('${AGAINST_THE_STORY}'),
      `${gate} no longer carries the check against the story — it can pass a "cut" ` +
      `in a week the story says "hike", and it runs last`);
  }
  assert.match(body('CONSOLIDATE').replace(/\s+/g, ' '),
    /Say the direction plainly: which way the central bank last moved and which way the market is betting next/,
    'the nightly pass is no longer told to write the direction into the story, so ' +
    'the gates check against a story that may never say it');
});

test('the writing rules ban a figure of speech, with his own example of one beside it', () => {
  /* EVERY WORD SHORT AND THE SENTENCE STILL A PUZZLE: "The relief in gold has been
     contained rather than clean" obeys every countable rule. A worked example
     moves her register where a description does not, and in WRITING the writer
     and both gates read it at once. */
  const writing = EUGENIA_PROMPT.match(/export const WRITING = `([\s\S]*?)`;/)[1].replace(/\s+/g, ' ');
  assert.match(writing, /NO FIGURES OF SPEECH/, 'WRITING no longer bans figures of speech');
  assert.match(writing, /contained rather than clean" makes him work out that it means "that mix is why gold has only risen a little"/,
    'the figure-of-speech rule has lost its worked example — the description alone is what failed');
});

test('the critic counts paragraphs and dashes last, after everything that can add them', () => {
  /* THE COUNTABLE RULES ARE ASKED FOR AS A COUNT. Among a dozen judgement calls
     they did not land; counting is a different act from reading, so it is its
     own step, and LAST — every check above can add a clause. */
  const critic = EUGENIA_PROMPT.match(/export const CRITIC = `([\s\S]*?)`;/)[1];
  const count = critic.indexOf('LAST, COUNT.');
  assert.ok(count > -1, 'CRITIC no longer asks for the count as a step of its own');
  const step = critic.slice(count).replace(/\s+/g, ' ');
  assert.match(step, /count the sentences; any paragraph over four is split/,
    'the count step no longer bounds a paragraph at four sentences');
  assert.match(step, /every em-dash; each one becomes a full stop/,
    'the count step no longer removes the em-dash aside');
  for (const earlier of ['${WRITING}', 'Is the chain complete', 'standing instructions']) {
    assert.ok(critic.indexOf(earlier) > -1 && critic.indexOf(earlier) < count,
      `the count comes before "${earlier}", which can add a clause after it`);
  }
});

test('TRIM counts too, last, because replies broke the rule the critic fixed', () => {
  /* TRIM counts too, last, for the critic's reason. */
  const trim = EUGENIA_PROMPT.match(/export const TRIM = `([\s\S]*?)`;/)[1];
  const count = trim.indexOf('LAST, COUNT.');
  assert.ok(count > -1, 'TRIM no longer counts, so a reply goes out with paragraphs of seven');
  const step = trim.slice(count).replace(/\s+/g, ' ');
  assert.match(step, /count the sentences; any paragraph over four is split/,
    'TRIM\'s count no longer bounds a paragraph at four sentences');
  assert.match(step, /every em-dash; each one becomes a full stop/,
    'TRIM\'s count no longer removes the em-dash aside');
  for (const earlier of ['${WRITING}', 'DO NOT CUT THE MECHANISM']) {
    assert.ok(trim.indexOf(earlier) > -1 && trim.indexOf(earlier) < count,
      `TRIM counts before "${earlier}", which can change a paragraph after it`);
  }
});

/* ─── Two things a coach does, inside the line ───────────────────────────────
   A level price has already printed is a FACT and may be named — never in the
   paragraph holding her read, where a level beside a direction is an entry
   with the verb left out. And a plan he has not taken may be checked against
   HIS rules when he asks, the levels staying his. Each lives in three places
   and fails silently when a copy drops its half. The plan check cites rules by
   number, so each cited rule is read against §7's table: a judgment rule
   there would have her pronounce on what no row can see.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── Her own calls ──────────────────────────────────────────────────────────
   A level about what comes next is allowed in one shape only: a call filed with
   make_call, on his rules, scored that night. Three things hold it, and each
   is a sentence or a tool set. The writer files before she says; both gates,
   which REWRITE and run last, keep a filed call whole and its numbers
   unchanged, and keep none while he holds a position; and the trade look,
   which reaches him in one, is never offered the tool. Scoring runs before
   the pass reads, or the pass reads yesterday.
   ─────────────────────────────────────────────────────────────────────────── */
test('a call is filed before it is said, kept whole by both gates, and never made on the trade look', () => {
  const bodies = Object.fromEntries(
    [...EUGENIA_PROMPT.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)]
      .map(m => [m[1], m[2].replace(/\s+/g, ' ')]));
  assert.match(bodies.SYSTEM, /FILE IT, THEN SAY IT\. Call make_call first/,
    'SYSTEM no longer has her file a call before she says it — an unfiled call is never scored');
  assert.match(bodies.SYSTEM, /said without filing them is a tip nobody scores/,
    'the prohibitions no longer confine a forward level to a filed call');
  assert.match(bodies.SYSTEM, /No trade management — never what to do with a position he holds/,
    'SYSTEM no longer forbids telling him what to do with his position');
  assert.match(bodies.SYSTEM, /no call while he has a position open, unless he asks for one/,
    'SYSTEM may make a call unprompted while he holds a position');
  for (const gate of ['CRITIC', 'TRIM']) {
    assert.match(bodies[gate], /YOUR CALL IS THE ONE EXCEPTION/,
      `${gate} no longer spares a filed call, so the last pass cuts the one level that was scored`);
    assert.match(bodies[gate], /numbers? (?:are|is) never changed|never a number in it changed/,
      `${gate} may change a number in a filed call, so what he reads is not what is scored`);
  }
  assert.match(bodies.TRADE_EVENT, /anything about where price goes/,
    'the trade look no longer carries the flat ban');

  const list = (set) => EUGENIA_TS.match(new RegExp(`const ${set}(?:: unknown\\[\\])? = \\[([\\s\\S]*?)\\];`))?.[1] ?? '';
  assert.match(list('CHAT_TOOLS'), /CALL_TOOL/, 'make_call is not offered where she makes calls');
  for (const set of ['TRADE_TOOLS', 'CONSOLIDATE_TOOLS', 'CRITIC_TOOLS']) {
    assert.doesNotMatch(list(set), /CALL_TOOL/, `${set} offers make_call`);
  }

  const pass = uncomment(bodyOf(EUGENIA_TS, 'async function postConsolidation('));
  assert.ok(pass.indexOf('await scoreCalls()') > -1 &&
            pass.indexOf('await scoreCalls()') < pass.indexOf("ask([{ role: 'user', content: asked }]"),
    'the calls are not scored before the pass reads them, so it judges yesterday');
});

test('a printed level may be named, never beside her read, in the writer and both gates', () => {
  const bodies = Object.fromEntries(
    [...EUGENIA_PROMPT.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)]
      .map(m => [m[1], m[2].replace(/\s+/g, ' ')]));
  for (const who of ['SYSTEM', 'CRITIC', 'TRIM']) {
    assert.match(bodies[who], /level price has already printed/i,
      `${who} no longer says a printed level is a fact, so it reads "today's high" as a forward call`);
    assert.match(bodies[who], /same paragraph as (?:your|the|a) read/i,
      `${who} no longer keeps a printed level out of the paragraph that holds her read — ` +
      `side by side, the two are an entry`);
  }
});

test('a plan he gives her is checked against his rules and his sequence, and the levels stay his', () => {
  const body = (name) => EUGENIA_PROMPT.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`))[1]
    .replace(/\s+/g, ' ');
  const system = body('SYSTEM');
  const at = system.indexOf('WHEN HE ASKS YOU TO CHECK A TRADE HE HAS NOT TAKEN');
  assert.ok(at > -1, 'SYSTEM no longer tells her how to check a plan he has not taken');
  const section = system.slice(at, system.indexOf('WHEN HE SENDS A CHART', at));
  assert.match(section, /THE LEVELS STAY HIS\. Never suggest a different entry, stop or target/,
    'the plan check no longer forbids her offering levels of her own in place of his');
  assert.match(section, /THEN SAY WHETHER YOU WOULD TAKE IT/,
    'the plan check no longer ends in whether she would take it, which is what he asked');
  assert.match(section, /Read §4 and §6 with get_strategy before you judge a step/,
    'she judges his setup against her idea of one rather than the sequence he wrote');

  const trim = body('TRIM');
  assert.match(trim, /check of a plan he gave you against his own rules stays/,
    'TRIM no longer keeps a plan check, so the gate on every reply can cut the one she was asked for');
  assert.match(trim, /your judgment of his setup and whether you would take it/,
    'TRIM no longer keeps her judgment of his setup');
  assert.match(trim, /A level YOU offer in place of his/,
    'TRIM no longer removes a level she offers in place of his');

  /* TWO HALVES, TWO KINDS OF RULE. What a row can answer cites §7's journal rules
     or R-08's arithmetic; the sequence is R-08's steps, whose levels and
     confirmation are judgment rules. Every citation must exist in the table. */
  const rows = [...ALWAYS.matchAll(/^\| (R-\d+) \|.*\| (journal|judgment) \|/gm)];
  const journal = new Set(rows.filter(m => m[2] === 'journal').map(m => m[1]));
  const judgment = new Set(rows.filter(m => m[2] === 'judgment').map(m => m[1]));
  assert.ok(journal.size >= 10 && judgment.size >= 4,
    `read ${journal.size} journal and ${judgment.size} judgment rules out of §7 — the reader has gone blind`);
  const half = (from, to) => section.slice(section.indexOf(from), section.indexOf(to));
  const byRow = [...new Set(half('AGAINST THE RULES A ROW CAN ANSWER', 'AGAINST HIS PRE-TRADE SEQUENCE').match(/R-\d+/g))];
  assert.ok(byRow.length >= 8, `the row half cites ${byRow.length} rules — the reader has gone blind`);
  for (const r of byRow) {
    assert.ok(journal.has(r) || r === 'R-08',
      `the row half cites ${r}, which §7 does not mark journal — a row cannot answer it`);
  }
  const bySequence = [...new Set(half('AGAINST HIS PRE-TRADE SEQUENCE', 'THEN SAY WHETHER').match(/R-\d+/g))];
  assert.deepEqual(bySequence.sort(), ['R-05', 'R-06', 'R-07', 'R-08'],
    'the sequence half no longer names the steps R-08 runs through');
  for (const r of bySequence) assert.ok(judgment.has(r), `${r} is not a judgment rule in §7`);
});

test('her read on price is fenced in the writer and in both gates', () => {
  const bodies = Object.fromEntries(
    [...EUGENIA_PROMPT.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)]
      .map(m => [m[1], m[2].replace(/\s+/g, ' ')]));

  const FENCE = {
    'labelled as hers':         /YOUR READ|labelled as your read|labelled as yours/i,
    'what would prove it wrong': /what would prove (?:you|it) wrong/i,
    'no level':                  /no level|names no level|every level out/i,
    'none while he is in one':   /position (?:is )?open|shows an open position/i,
  };
  for (const who of ['SYSTEM', 'CRITIC', 'TRIM']) {
    for (const [half, says] of Object.entries(FENCE)) {
      assert.match(bodies[who], says,
        `${who} no longer carries "${half}" — the read she is allowed is only ` +
        `allowed inside that fence, and a copy without it either lets a tip ` +
        `through or cuts every read that obeyed it`);
    }
  }

  // Both gates are handed what he has on, on every path that runs one.
  for (const gate of ['critique', 'trim']) {
    const body = bodyOf(EUGENIA_TS, `async function ${gate}(`, `doji-eugenia no longer has ${gate}()`);
    assert.match(body, /\$\{desk\}/,
      `${gate}() no longer puts his open positions in front of the gate, which ` +
      `is asked whether a view was given while he was in one`);
  }
  const calls = [...EUGENIA_TS.matchAll(/await trim\(([^)]*)\)/g)].map(m => m[1]);
  assert.ok(calls.length >= 1, `read ${calls.length} calls to trim() — the reader has gone blind`);
  for (const args of calls) {
    assert.match(args, /,\s*desk,\s*story$/,
      `trim(${args}) is not handed the desk and the story — that gate cannot tell ` +
      `a compliant read from one given while he is in a position, nor a "cut" ` +
      `from the "hike" the story says`);
  }
  assert.match(bodyOf(EUGENIA_TS, 'async function trim('), /\$\{story\}/,
    'trim() takes the story and never puts it in front of the gate');
});

/* ─── A verdict judges the decision, and waits for the close ─────────────────
   Measured against his rules and the plan he entered with, never the P&L, and
   only after the close — a verdict on a live trade is advice about it. The
   critic restates the second half, since it runs last and rewrites.
   ─────────────────────────────────────────────────────────────────────────── */

test('a verdict judges the decision rather than the result, and never an open trade', () => {
  const bodies = Object.fromEntries(
    [...EUGENIA_PROMPT.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)]
      .map(m => [m[1], m[2].replace(/\s+/g, ' ')]));

  assert.match(bodies.SYSTEM, /JUDGE THE DECISION, NEVER THE RESULT/,
    'SYSTEM no longer says a verdict is measured against his rules rather than ' +
    'the P&L — a coach judging by the result praises luck and punishes discipline');
  for (const who of ['SYSTEM', 'CRITIC']) {
    assert.match(bodies[who], /verdict on a trade that is still open/i,
      `${who} no longer keeps a verdict off an open trade, where it is advice ` +
      `about the position however it is worded`);
  }
  // And the message that reaches him mid-trade stays verdict-free outright.
  assert.match(bodies.TRADE_EVENT, /say whether the trade is good/,
    'TRADE_EVENT no longer forbids judging the trade he is in');

  /* THE FACT ALONE IS WHERE SHE STOPS without these: the writer told the verdict
     is not optional, the briefing slot with room for it, and the critic adding
     a missing one and never cutting it for length. */
  assert.match(bodies.SYSTEM, /THE VERDICT IS NOT OPTIONAL/,
    'SYSTEM no longer says a breach needs a verdict after it, and she goes back to ' +
    'stating the fact and stopping');
  assert.match(bodies.SYSTEM, /the fact, your verdict, the lesson/,
    'the briefing slot no longer makes room for the verdict and the lesson');
  assert.match(bodies.CRITIC, /A breach with no verdict after it is half written/,
    'the critic no longer adds a verdict a breach was left without');
  assert.match(bodies.CRITIC, /never the verdict on his trading/,
    'the critic may cut the verdict for length again');
});

/* ─── diagnose.sql counts itself too ─────────────────────────────────────────
   Run top to bottom, an editor shows only the LAST listing, so the header is
   how a reader knows what is in front of them.
   ─────────────────────────────────────────────────────────────────────────── */

test('diagnose.sql says how many listings it holds, and holds that many', () => {
  const sql = source('supabase/diagnose.sql');

  // Statements, not `select` keywords: one listing unions two tables, and a
  // count of the keyword would read it as two.
  const WORDS = { eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };
  const code = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
  const held = code.split(';').filter(x => x.trim()).length;
  assert.ok(held > 5, `only ${held} listings parsed — the reader has gone blind`);

  const stated = sql.match(/— (\w+) listings that say/i);
  assert.ok(stated, 'the header no longer states how many listings this holds');
  const said = WORDS[stated[1].toLowerCase()] ?? Number(stated[1]);
  assert.equal(said, held,
    `the header says ${stated[1]} listings and the file holds ${held} — and only ` +
    `the last one shows when it is run, so the header is how a reader knows ` +
    `what they have not seen`);
});

/* ─── Every definer runs with an empty search_path ───────────────────────────
   `security definer` makes vault.decrypted_secrets readable to a trigger under
   service_role, and makes an unqualified name dangerous: the function runs as
   its owner, so a name resolved through a schema someone else can create in
   resolves with the owner's rights. Every definer is derived from the SQL.
   ─────────────────────────────────────────────────────────────────────────── */

test('every security definer function empties its search_path', () => {
  let seen = 0;
  const sql = SCHEMA_SQL
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

  for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)[\s\S]*?\bas \$\$/g)) {
    if (!/security definer/.test(m[0])) continue;
    seen++;
    assert.match(m[0], /set search_path = ''/,
      `${m[1]} is security definer and does not empty its ` +
      `search_path — it runs as the owner, so any name it resolves through a ` +
      `schema someone else can create in resolves with the owner's rights`);
  }
  assert.ok(seen >= 2,
    `only ${seen} security definer functions read out of schema.sql — ` +
    `the reader has gone blind`);
});

/* ─── The search with the query vector, not merely one by that name ────────
   An older database can hold the two-argument eugenia_search, and side by side
   with this one they are an overload a two-argument call cannot resolve. A
   check COUNTING functions by name answers 1 on a database holding the old one
   alone, so the row names arities.
   ─────────────────────────────────────────────────────────────────────────── */

test('verify.sql asks eugenia_search which arguments it takes', () => {
  const verify = source('supabase/verify.sql');
  const row = verify.match(
    /\('eugenia_search[^']*',\s*\(select ([\s\S]*?)\),\s*'([^']*)'\)/);
  assert.ok(row, 'verify.sql no longer asks after eugenia_search at all');

  assert.match(row[1], /pronargs/,
    'the row counts functions by NAME again — an older database holds a ' +
    'two-argument eugenia_search, and a count answers 1 for a database ' +
    'holding either one');
  assert.equal(row[2], '3',
    `it expects "${row[2]}" where the search's signature takes three arguments`);

  // The three-argument function is the one schema.sql creates and the one her search
  // calls, so the expected value is read out of the file rather than typed.
  const created = SEMANTIC_SQL.match(
    /create or replace function public\.eugenia_search\(([^)]*)\)/);
  assert.ok(created, 'schema.sql no longer creates eugenia_search');
  assert.equal(created[1].split(',').length, 3,
    "eugenia_search no longer takes three arguments, so verify.sql now " +
    'asks for an arity the file does not produce');
});

/* ─── The detail column is bounded at both ends ──────────────────────────────
   schema.sql constrains `last_error` to `between 1 and 500`. An empty message —
   `new Error()` carries one — is refused, and `last_error_at` with it, being
   one PATCH: the failure most needing a record leaves none.
   ─────────────────────────────────────────────────────────────────────────── */

test('heartbeat cannot write a detail the column refuses', () => {
  const health = subject('Whether the silent writers are writing');
  const bound = health.match(/char_length\(last_error\) between (\d+) and (\d+)/);
  assert.ok(bound, 'schema.sql no longer bounds last_error — the reader has gone blind');

  const edge = source('supabase/functions/_shared/edge.ts');
  const body = bodyOf(edge, 'export async function heartbeat(', '_shared no longer exports heartbeat()');

  assert.match(body, new RegExp(`slice\\(0, ${bound[2]}\\)`),
    `heartbeat does not truncate at ${bound[2]}, so a long message is refused ` +
    `and the failure it was reporting leaves no mark at all`);

  if (+bound[1] > 0) {
    assert.match(body, /\|\| "no detail"/,
      `schema.sql refuses a last_error shorter than ${bound[1]} characters and heartbeat ` +
      `can produce one — new Error() carries an empty message — so the PATCH is ` +
      `refused and last_error_at is lost with it`);
  }
});

/* ─── When a briefing has stopped being possible ─────────────────────────────
   pace_line reports an ABSENCE, and asked while a retry is still running it names a
   briefing being written as one that never came. Its first hour is the last
   RETRY hour plus one, so it is derived from `retryDue` and held against pace_line.
   ─────────────────────────────────────────────────────────────────────────── */

test('pace_line waits until the last retry hour has passed, in both languages', () => {
  const last = Object.fromEntries(
    [...bodyOf(EUGENIA_TS, 'export function retryDue(').matchAll(
      /hour >= \d+ && hour <= (\d+)\) return '(weekday|sunday)'/g)]
      .map(m => [m[2], +m[1]]));
  assert.deepEqual(Object.keys(last).sort(), ['sunday', 'weekday'],
    'retryDue no longer states a bounded window per briefing — the reader has gone blind');

  const judged = Object.fromEntries(
    [...PACE_SQL.matchAll(/hour >= (\d+) then '(weekday|sunday)'/g)]
      .map(m => [m[2], +m[1]]));
  assert.deepEqual(Object.keys(judged).sort(), ['sunday', 'weekday'],
    'pace_line no longer judges both briefings for absence');

  for (const kind of ['weekday', 'sunday']) {
    assert.equal(judged[kind], last[kind] + 1,
      `pace_line judges the ${kind} briefing missing from ${judged[kind]}:00 while ` +
      `retryDue still sends one at ${last[kind]}:00 — a retry that is running ` +
      `is reported as a briefing that never arrived`);
  }
});

/* ─── One definition of a failed dispatch ────────────────────────────────────
   `dispatch_watch` gates a REPEATING job behind three failures in an hour, and
   must ask what a failure is of `dispatch_bad` rather than restate it: a
   timed-out request has a row, a null status and `timed_out` set, and a
   narrower restatement counts it as zero. The gate also skips requests too
   young to judge.
   ─────────────────────────────────────────────────────────────────────────── */

test('both readers of "a failed dispatch" ask the same function', () => {
  // Comments stripped first: the restatement this forbids is DESCRIBED in the
  // comment above the gate, and prose about a predicate is not the predicate.
  const sql = subject('What pg_net sent, and what came back')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

  const fn = (name) => {
    const at = sql.indexOf(`create or replace function public.${name}`);
    assert.ok(at > -1, `schema.sql no longer defines ${name}`);
    const end = sql.indexOf('$$;', at);
    return sql.slice(at, end === -1 ? undefined : end);
  };
  const body = fn('dispatch_watch');

  const gate = body.match(/or \(select count\(\*\)([\s\S]*?)>= 3;/);
  assert.ok(gate, 'the repeat gate is gone, so a repeating job reports on one failure');

  // The PREDICATE is shared; the population is not. The sweep settles a
  // suppressed failure on purpose, so counting out of dispatch_failures would
  // inherit `not settled` and never reach three.
  for (const [what, src] of [['the repeat gate', gate[1]],
                             ['dispatch_failures', fn('dispatch_failures')]]) {
    assert.match(src, /public\.dispatch_bad\(/,
      `${what} decides what a failed dispatch is for itself — the last copy ` +
      `that did could not see a timed-out request at all`);
    assert.doesNotMatch(src, /net\._http_response r\s+where r\.id/,
      `${what} tests the response table directly, which is the restatement ` +
      `this exists to prevent`);
  }
  assert.doesNotMatch(gate[1], /dispatch_failures/,
    'the gate counts out of dispatch_failures, inheriting its `not settled` ' +
    'filter — so a suppressed failure, which the sweep settles on purpose, ' +
    'drops out of the tally and three in an hour can never be reached');
  assert.match(gate[1], /interval '1 hour'/,
    'the quantity window is gone — three failures with no window is not a rate');
  assert.match(gate[1], /interval '15 minutes'/,
    'the gate counts requests too young to have answered, so an in-flight poll ' +
    'pushes a healthy job toward the threshold');
});

/* ─── A door in the schedule and a door in the code ──────────────────────────
   The data-driven senses are reached by a query flag written twice — the cron
   URL and the branch that reads it. A rename falls past every branch to
   "nothing due this hour", answers 200, and pg_net discards it: the sense
   stops existing in complete silence.
   ─────────────────────────────────────────────────────────────────────────── */

test('every flag a cron job calls with is a flag the function reads', () => {
  const eugenia = source('supabase/functions/doji-eugenia/index.ts');

  const called = [...CRON_SQL.matchAll(/functions\/v1\/([\w-]+)\?(\w+)=(\w+)/g)];
  assert.ok(called.length >= 1,
    `only ${called.length} flagged cron URLs read — the reader has gone blind`);

  const body = bodyOf(eugenia, 'async function postScheduled(', 'doji-eugenia no longer has postScheduled()');

  for (const [, fn, flag, value] of called) {
    assert.equal(fn, 'doji-eugenia',
      `a cron job calls ${fn} with a flag, and only doji-eugenia's doors are checked here`);
    assert.match(body, new RegExp(`searchParams\\.get\\("${flag}"\\) === "${value}"`),
      `a cron job calls ?${flag}=${value} and postScheduled never reads it — the ` +
      `job answers 200, nothing throws, and that sense quietly does not exist`);
  }

  // AND EACH DOOR REACHES ITS OWN WORK. A branch that reads the flag and then
  // falls through to the briefing would pass the check above.
  assert.match(body, /get\("calendar"\) === "1"\)\s*\{[^}]*filed\(\)/);
});

/* ─── And the same census from the other side ────────────────────────────────
   A door in postScheduled with no job behind it is answered correctly by
   nobody. A scheduled sense needs a job in schema.sql; a door a PERSON opens must not
   have one. Nothing in the source tells them apart, so they are declared, and
   a new flag fails this suite until someone says which it is.
   ─────────────────────────────────────────────────────────────────────────── */

const BY_HAND = {
  embed:       'the backfill, called until it answers `left: 0` — the one door ' +
               'whose answer IS its interface, and so the one that may wait',
  force:       'the repair door: a briefing on demand, taking its kind from ' +
               'briefKind rather than from the hour',
  consolidate: 'the hourly job carries no flag and dueNow decides the hour — ' +
               'this runs the nightly pass out of that schedule, which is how a ' +
               'missed night is made up without waiting for the next one',
  history:     'the weeks he has already traded, walked once from the date ' +
               'given so R-19 can judge them — the nightly pass only ' +
               'ever files the week it runs in',
  review:      'the Saturday review out of its hour — it has no retry, so a ' +
               'failed one is made up by hand rather than a week late',
  speak:       'the briefing\'s second worker, opened by postBriefing itself ' +
               'rather than by a schedule — and by a person re-sending a ' +
               'briefing that was stored and never reached him',
};

test('every door the function reads is opened by a cron job or by a person', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const body = bodyOf(src, 'async function postScheduled(', 'doji-eugenia no longer has postScheduled()');

  const read = [...new Set([...body.matchAll(/searchParams\.get\("(\w+)"\)/g)].map(m => m[1]))];
  assert.ok(read.length >= 4,
    `only ${read.length} doors read out of postScheduled — the reader has gone blind`);

  const dispatched = new Set(
    [...CRON_SQL.matchAll(/functions\/v1\/[\w-]+\?(\w+)=\w+/g)].map(m => m[1]));
  assert.ok(dispatched.size >= 1,
    `only ${dispatched.size} flagged cron URLs read — the reader has gone blind`);

  for (const flag of read) {
    assert.ok(dispatched.has(flag) || BY_HAND[flag],
      `?${flag}=1 is a door postScheduled reads, no cron job in schema.sql calls it, and ` +
      `BY_HAND does not say why — so either a schedule is missing and that sense ` +
      `never runs, or it is a repair door and nothing says so`);
    assert.ok(!(dispatched.has(flag) && BY_HAND[flag]),
      `?${flag}=1 is declared by hand AND scheduled in schema.sql — one of the two is ` +
      `stale, and the reason in BY_HAND is the one nothing else would contradict`);
  }

  // AND NO REASON OUTLIVES ITS DOOR. A flag retired from the function leaves a
  // sentence here that reads as a working exemption for the next one named it.
  for (const flag of Object.keys(BY_HAND)) {
    assert.ok(read.includes(flag),
      `BY_HAND explains ?${flag}=1 and postScheduled no longer reads it — the ` +
      `exemption outlived the door, which is the shape that lets the next flag ` +
      `of that name arrive already excused`);
  }
});

/* ─── The watcher's own report can be lost, and it plans for that ───────────
   pg_net is ASYNCHRONOUS, so the sweep cannot learn inside the same call that
   its message never arrived — and a report that times out in the handshake,
   with the rows already settled, is an outage said once into a dropped
   connection and never again. So a failure is marked with the request id of
   the message that named it and NOT settled; the next sweep settles on a 2xx,
   or clears the mark and says it again. Driven on a real server — reported,
   lost, said again, retired past three hours — with each guard here proved by
   removing it.
   ─────────────────────────────────────────────────────────────────────────── */

test('a failure is settled when its report lands, not when it is sent', () => {
  const sql = subject('What pg_net sent, and what came back')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  assert.match(tableBody(sql, 'dispatch'), /\n\s+reported_by bigint/,
    'the ledger has no reported_by column, so a report cannot be tied to the rows it named');

  // Confirm and release, and both must exist: only one of them and a report
  // either finishes rows it never delivered or never finishes them at all.
  /* Anchored on the closing paren: `between 200 and 299 and false` contains the
     condition and never fires. */
  assert.match(sql, /set settled = true[\s\S]{0,300}?r\.id = d\.reported_by[\s\S]{0,120}?status_code between 200 and 299\);/,
    'nothing settles a row on a DELIVERED report, so the mark is set and never cleared');
  assert.match(sql, /set reported_by = null[\s\S]{0,300}?r\.timed_out/,
    'a report that timed out never releases the rows it named — which is the ' +
    'exact failure this was written for, and it would be permanent');

  // A row still waiting on a report must not be re-judged into a second message.
  assert.match(sql, /d\.reported_by is null\s*\n\s*and d\.at <= now_/,
    'dispatch_failures does not exclude rows already reported, so the same ' +
    'outage arrives every ten minutes until it resolves');

  /* AND THE SETTLE MUST SKIP WHAT WAS JUST SAID, or a sweep that could NOT send
     — a Vault name misspelled — settles the outage anyway, and fixing the name
     delivers nothing. Driven both ways on a real server. */
  assert.match(sql, /where not settled and reported_by is null[\s\S]{0,200}?id not in \(select id from _said\)/,
    'the settle does not exclude the rows just named, so a report that could ' +
    'not be sent finishes them silently');

  // Retried every ten minutes, then given up on — a row that can never be
  // adjudicated would otherwise be re-reported for the life of the deployment.
  assert.match(sql, /set settled = true\s*\n\s*where not settled and at <= now_ - interval '3 hours'/,
    'nothing retires a row past the window where pg_net still has its response, ' +
    'so an unresolvable failure is announced every ten minutes forever');
});

/* ─── Every pg_net dispatch is recorded, and none can break its own caller ───
   A 546 comes back BEFORE the worker exists, so the only witness is a row in
   `net._http_response` — no url, pruned within hours. What a failed request
   was FOR is recoverable only if its id is captured as it is made, which is
   the ledger. Job names are held against the check constraint.

   AND THE TRIGGER SITES MUST NOT BREAK THEIR OWN WRITE: they fire inside the
   UPDATE that set the column, so the post goes into a variable first and the
   ledger insert is best-effort behind an exception block.
   ─────────────────────────────────────────────────────────────────────────── */

test('every pg_net dispatch records a job the ledger declares', () => {
  const declared = new Set(
    [...subject('What pg_net sent, and what came back')
      .match(/dispatch_job_check check \(job in \(([\s\S]*?)\)\)/)[1]
      .matchAll(/'([a-z-]+)'/g)].map(m => m[1]));
  assert.ok(declared.size >= 5,
    `the ledger declares ${declared.size} jobs — the reader has gone blind`);

  const used = [];
  let posts = 0;
  const sql = SCHEMA_SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  /* A POST ADDRESSED TO TELEGRAM IS A REPORT, NOT A DISPATCH, and must not reach
     the ledger it reports on, or the next sweep would judge it. Parted by where
     the call GOES; the url is the first argument. */
  for (const tail of sql.split('net.http_post(').slice(1)) {
    if (!/api\.telegram\.org/.test(tail.slice(0, 300))) posts += 1;
  }
  /* The job is the LAST argument of either shape — `), 'poller';` closing a
     select, or `values (req, 'gladys')` in a trigger. */
  for (const m of sql.matchAll(
      /insert into public\.dispatch[\s\S]{0,900}?(?:\),|values \(req,)\s*'([a-z-]+)'\s*[;)]/g)) {
    used.push(m[1]);
  }

  assert.equal(used.length, posts,
    `${posts} calls to net.http_post and ${used.length} of them reach the ledger — ` +
    `the difference is a job that can be refused a worker with nothing anywhere ` +
    `to say it ever existed`);
  assert.ok(posts >= 5, `only ${posts} dispatch sites found — the reader has gone blind`);

  for (const job of used) {
    assert.ok(declared.has(job),
      `schema.sql records dispatches as '${job}', which the ledger's check constraint does not ` +
      `allow — every row it writes will be rejected and the job goes unwatched`);
  }
});

test('a trigger that cannot record its dispatch still makes it', () => {
  for (const [f, sql] of [['Gladys', GLADYS_SQL], ['the trade event', SENSES_SQL]]) {
    assert.match(sql, /req := net\.http_post\(/,
      `${f} inlines net.http_post into the ledger insert, so a ledger that ` +
      `refuses the row takes the message with it`);
    assert.match(sql, /insert into public\.dispatch \(id, job\) values \(req, '[a-z-]+'\);\s*\n\s*exception when others then null;/,
      `${f} records its dispatch unguarded — this fires inside the UPDATE that ` +
      `set the column, so a raise here fails the journal write itself`);
  }
});

/* ─── The clock the workers run on, and the copies that watch it ─────────────
   pace_line speaks BEFORE the failure because afterwards nothing can: a briefing
   killed at the wall clock has already handed pg_net its 200, so the ledger
   records health, `ask()` never reaches its catch and no apology is sent. The
   caller it looks for is written in TypeScript and read in SQL, the job count
   is declared in schema.sql and asserted in verify.sql, and the ceiling is quoted in
   the message it decides — each a copy that fails silently on its own.
   ─────────────────────────────────────────────────────────────────────────── */

const PACE_SQL = subject("How much of the worker's clock the briefing spends");

test('the row pace_line looks for is the row postBriefing writes', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  // The two kinds, off the type rather than off a literal here.
  const kinds = [...src.match(/export type Brief = ([^;]+);/)[1]
    .matchAll(/'(\w+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(kinds, ['sunday', 'weekday'],
    `Brief now names ${kinds.join(', ')} — pace_line asks for a briefing per kind and ` +
    `would stop asking about one of them`);

  // And the suffix, which is half of the caller and the half a rename touches.
  assert.match(src, /caller: `\$\{due\} briefing delivered`/,
    'postBriefing no longer writes `<kind> briefing delivered` — pace_line reads that ' +
    'caller to decide whether a briefing reached him, so it would report every ' +
    'day as a day nothing arrived');
  assert.match(PACE_SQL, /owed \|\| ' briefing delivered'/,
    'pace_line no longer builds the caller it looks for out of the kind and that ' +
    'suffix — the two halves of this name are in two languages with no build ' +
    'step between them');

  /* THE KINDS pace_line CAN NAME, held against the type: a Brief it never assigns to
     `owed` is a briefing whose absence nobody watches. */
  const owed = [...PACE_SQL.match(/owed := case([\s\S]*?)end;/)[1]
    .matchAll(/then '(\w+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(owed, kinds,
    `pace_line judges the absence of ${owed.join(', ')} where Brief names ` +
    `${kinds.join(', ')} — the difference is a briefing that can go missing unwatched`);
});

test('pace_line states its ceiling once and quotes that one', () => {
  const ms = Number(PACE_SQL.match(/ceiling_ms constant int := (\d+);/)[1]);
  assert.ok(ms > 0, 'pace_line no longer declares ceiling_ms — the reader has gone blind');

  /* THE MESSAGE MAY NOT SPELL THE NUMBER OUT AGAIN, or the threshold moves while
     the sentence names the old one. */
  const body = PACE_SQL.slice(PACE_SQL.indexOf('lines := lines || format(\n      \'Longest'));
  assert.ok(!new RegExp(`\\b${ms / 1000}s\\b`).test(body.slice(0, 600)),
    `pace_line's message writes ${ms / 1000}s as a literal beside a ceiling it already ` +
    `holds in ceiling_ms — move the threshold and the sentence still names the old one`);
  assert.match(PACE_SQL, /ceiling_ms \/ 1000/,
    'pace_line no longer interpolates ceiling_ms into what it tells him');

  // And the share is a share, not a second ceiling.
  assert.match(PACE_SQL, /speak_at\s+constant int := ceiling_ms \*/,
    'pace_line no longer derives its threshold from the ceiling — the two would drift, ' +
    'and a threshold above the ceiling is a watcher that can never speak');

  /* AND THE PROSE HOLDS THE SAME NUMBER, a platform fact, so a plan change moves
     both or neither. */
  const claude = source('CLAUDE.md');
  assert.ok(claude.includes(`${ms / 1000}s paid`),
    `CLAUDE.md does not name ${ms / 1000}s as the paid wall clock that pace_line watches ` +
    `— one of the two has been changed without the other`);
});

/* A turn's budget is the share pace_line warns at, so the seconds above it are
   left to file the row and send the apology. Raised past the ceiling, a stalled
   turn is killed at the wall clock again, silently, which is what it exists to
   prevent; moved apart from the watcher, one of the two is reading the wrong
   share. */
test('a model turn may spend what pace_line calls safe, and no more', () => {
  const ceiling = Number(PACE_SQL.match(/ceiling_ms constant int := (\d+);/)[1]);
  const [num, den] = PACE_SQL.match(/speak_at\s+constant int := ceiling_ms \* (\d+) \/ (\d+);/)
    .slice(1).map(Number);
  const turn = Number(EUGENIA_TS.match(/const TURN_MS = ([\d_]+);/)?.[1].replaceAll('_', ''));
  assert.ok(turn > 0, 'doji-eugenia no longer declares TURN_MS — the reader has gone blind');
  assert.equal(turn, ceiling * num / den,
    `TURN_MS is ${turn}ms where pace_line warns at ${ceiling * num / den}ms`);
  assert.match(EUGENIA_TS, /const deadline = AbortSignal\.timeout\(budget\);/,
    'ask() no longer starts its turn on the budget');
  assert.match(EUGENIA_TS, /call\(convo, effort, tools, model, deadline, container\)/,
    'the turn\'s signal no longer reaches the request');
});

/* THE WRITING WORKER RUNS SEVERAL BOUNDED TURNS IN A ROW, and each inside
   TURN_MS still summed to 336s of 400 on 8 October. So the worker has one
   clock and every step is handed what is left of it: the draft no more than
   that, the critic what remains after the draft (out of time, gate sends the
   draft), the fallback voice the same. Nothing in the suite can run a worker
   against its wall, so the hand-offs are read. */
test('the writing worker spends what is left of its own clock, and no step more', () => {
  const ceiling = Number(PACE_SQL.match(/ceiling_ms constant int := (\d+);/)[1]);
  const writer = Number(EUGENIA_TS.match(/const WRITER_MS = ([\d_]+);/)?.[1].replaceAll('_', ''));
  assert.ok(writer > 0, 'doji-eugenia no longer declares WRITER_MS — the reader has gone blind');
  assert.ok(ceiling - writer >= 20_000,
    `WRITER_MS leaves ${(ceiling - writer) / 1000}s of the ${ceiling / 1000}s wall for storing, the ` +
    `hand-off and the row`);
  const brief = bodyOf(EUGENIA_TS, 'async function postBriefing(');
  assert.match(brief, /const left = \(\) => Math\.max\(0, opened \+ WRITER_MS - Date\.now\(\)\);/,
    'postBriefing no longer measures what is left of its clock');
  assert.match(brief, /'high', `\$\{due\} briefing`, CHAT_TOOLS, Math\.min\(TURN_MS, left\(\)\)\)/,
    'the draft may outlive the worker');
  assert.match(brief, /critique\([^)]*, left\(\)\)/, 'the critic may outlive the worker');
  assert.match(brief, /sayAloud\(brief, [^;]*, Math\.min\(SPEAK_MS, left\(\)\)\)/,
    'the fallback voice may outlive the worker');
  // The census, so a step added beside these three is held to the same clock.
  const steps = [...uncomment(brief).matchAll(/\b(ask|critique|gate|sayAloud)\(([^;]*);/g)];
  assert.ok(steps.length >= 3, `only ${steps.length} timed steps read in postBriefing — the reader has gone blind`);
  for (const [, fn, call] of steps) {
    assert.match(call, /left\(\)/, `postBriefing calls ${fn} on a clock other than what is left of its own`);
  }
  const gate = bodyOf(EUGENIA_TS, 'async function gate(');
  assert.match(gate, /'medium', label, CRITIC_TOOLS, budget\)/,
    'gate no longer hands its budget to the model call — the critic runs on TURN_MS whatever is left');
});

/* ─── And the README lists them, which is a third copy ───────────────────────
   The table a person reads to know what should be running. Both directions,
   since a row that quietly vanishes is as bad as one that lies.
   ─────────────────────────────────────────────────────────────────────────── */

test('the README names every cron job schema.sql schedules, on its stated schedule', () => {
  const readme = source('README.md');

  const scheduled = new Map(
    [...CRON_SQL.matchAll(/cron\.schedule\(\s*'([\w-]+)',\s*'([^']+)'/g)]
      .map(m => [m[1], m[2]]));
  assert.ok(scheduled.size >= 5,
    `only ${scheduled.size} cron jobs read out of schema.sql — the reader has gone blind`);

  /* SLICED TO THE TABLE: the palette table has three backticked cells too. */
  const table = readme.slice(readme.indexOf('| Job | Schedule | What it drives |'));
  assert.ok(table && table.length < readme.length,
    'the README no longer has a job table with that header');
  const listed = new Map(
    [...table.slice(0, table.indexOf('\n\n')).matchAll(/^\| `([\w-]+)` \| `([^`]+)` \| /gm)]
      .map(m => [m[1], m[2]]));
  assert.ok(listed.size >= 5,
    `only ${listed.size} job rows parsed out of the README — the table has moved`);

  assert.deepEqual([...listed.keys()].sort(), [...scheduled.keys()].sort(),
    'the README\'s job table and schema.sql name different jobs');

  for (const [job, when] of listed) {
    assert.equal(when, scheduled.get(job),
      `the README says ${job} runs on \`${when}\` and schema.sql schedules it on ` +
      `\`${scheduled.get(job)}\` — the table is how a person knows what is ` +
      `supposed to be running, and pg_cron answers to the file`);
  }
});

test('the cron jobs verify.sql counts are the ones schema.sql schedules', () => {
  const cron = subject('Everything that runs on a timer')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const scheduled = (cron.match(/cron\.schedule\(/g) || []).length;
  assert.ok(scheduled >= 5, `read ${scheduled} schedules out of schema.sql — the reader has gone blind`);

  const verify = source('supabase/verify.sql');
  const stated = Number(verify.match(
    /\('\w+ cron jobs, all active',[\s\S]*?'(\d+)'\),/)[1]);

  /* A count typed by hand goes stale the day a job is added; this compares it. */
  assert.equal(stated, scheduled,
    `verify.sql expects ${stated} cron jobs and schema.sql schedules ${scheduled} — run ` +
    `against a correct database this row reports a fault, and a job dropped from ` +
    `schema.sql would slip past it`);

  // And the job it schedules has to name a function schema.sql actually creates.
  const called = [...cron.matchAll(/select public\.(\w+)\(\)/g)].map(m => m[1]);
  for (const fn of called) {
    assert.ok(new RegExp(`create or replace function public\\.${fn}\\(`)
                .test(PACE_SQL + subject('What pg_net sent, and what came back')),
      `schema.sql schedules public.${fn}(), which schema.sql never creates — every ` +
      `firing raises into cron.job_run_details, which this file's own ` +
      `housekeeping prunes and nobody reads`);
  }
});

test('pace_watch marks the day said only where the message was actually sent', () => {
  const body = PACE_SQL.slice(PACE_SQL.indexOf('create or replace function public.pace_watch('));

  /* THE ROW IS THE GUARD. `pace_watch` speaks at most once a New York day and
     decides that by finding its own row, so a row written after a send that
     could not be made swallows the warning for good. Written only where the post
     was made. */
  const unsent = body.search(/if public\.tell_him\(said\) is null then\s*return null;/);
  const mark = body.indexOf("values ('pace', false");
  assert.ok(unsent > -1 && mark > -1,
    'pace_watch no longer has both a send that can come back unsent and a said-row');
  assert.ok(unsent < mark,
    'pace_watch records the day as said before it knows the message went — a Vault ' +
    'name that does not resolve would mark the day and swallow the warning for good');
});

test('no SQL file reads into a variable with SELECT … INTO', () => {
  /* THE DASHBOARD READS THE WORDS AND NOT THE LANGUAGE. The SQL editor takes
     `select … into worst` inside plpgsql for `create table worst`, and its *run
     with RLS* button appends an `alter table` for a table that does not exist —
     rolling the whole paste back. `x := (select …)` cannot be mistaken. */
  const files = readdirSync(new URL('../supabase/', import.meta.url)).filter(f => f.endsWith('.sql'));
  assert.ok(files.includes('schema.sql') && files.length >= 3, `only ${files.length} SQL files read — the reader has gone blind`);
  for (const f of files) {
    const sql = source(`supabase/${f}`)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");
    const hit = sql.match(/\bselect\b[^;]*?(?<!\binsert\s+)\binto\s+\w+/i);
    assert.ok(!hit, `${f} has \`${hit?.[0].replace(/\s+/g, ' ').slice(-60)}\` — the SQL editor ` +
      `reads that as a new table, and its RLS fix names a table that does not exist`);
  }
});

test('the briefing is written in one worker and spoken in another, and never lost between them', () => {
  /* TWO WORKERS, so a stalled voice cannot take the briefing with it. The split
     must not open a third way to lose it: stored BEFORE the hand-off, or the
     second worker finds nothing; and a hand-off that did not start falls back to
     speaking HERE. No worker calling itself can be driven, so the source is read. */
  const at = (body, s) => body.indexOf(s);
  const brief = EUGENIA_TS.slice(EUGENIA_TS.indexOf('async function postBriefing('),
                                 EUGENIA_TS.indexOf('async function postSpeak('));
  const order = ['const checked = Date.now()', 'await remember(', 'const stored = Date.now()',
                 '?speak=${due}', 'if (handed === null)', "caller: `${due} briefing written`",
                 'await sayAloud(brief, ', "caller: `${due} briefing delivered`"];
  for (const s of order) assert.ok(at(brief, s) > -1, `postBriefing no longer has ${s}`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(at(brief, order[i - 1]) < at(brief, order[i]),
      `postBriefing has ${order[i - 1]} after ${order[i]} — stored after the hand-off ` +
      `the second worker finds nothing, and with no fallback after it a worker that ` +
      `would not start is a briefing that never arrives`);
  }
  assert.match(brief, /res\.ok \? null : `HTTP \$\{res\.status\}`/,
    'the hand-off is taken as started whatever the door answered — a 546 is then ' +
    'a briefing nobody speaks');

  const speak = EUGENIA_TS.slice(EUGENIA_TS.indexOf('async function postSpeak('),
                                 EUGENIA_TS.indexOf('export const isSilent'));
  assert.match(speak, /sayAloud\(turn\.content, feedbackKeyboard\(today\), SPEAK_WORKER_MS\)/,
    'the speaking worker speaks on the one-worker budget, which is the clock it was split off to escape');
  assert.ok(at(speak, 'await sayAloud(') < at(speak, "caller: `${due} briefing delivered`"),
    'the delivered row is written before the send — pace_line reads it as the statement that he has it');
  assert.match(speak, /const turn = await storedBriefing\(due, today\);/,
    'the speaking worker no longer reads today\'s briefing through storedBriefing');
  assert.match(bodyOf(EUGENIA_TS, 'async function storedBriefing('),
    /created_at=eq\.\$\{encodeURIComponent\(marker\.created_at\)\}/,
    'the text is no longer paired with its marker by the instant both were written');
  assert.match(EUGENIA_TS, /if \(speak\) \{ job = 'speak'; return await postSpeak\(speak\); \}/,
    'postScheduled no longer opens the speaking worker\'s door');
});

test('pace_line says a slow run once, and the week stays visible to diagnose', () => {
  /* A RUN IS SAID ONCE. It stays in a seven-day window for seven days, so a day
     guard alone announces it nightly. Replayed against a real Postgres: eight
     sends before, one after. This reads for the three pieces that replay
     depended on. */
  const line = PACE_SQL.slice(PACE_SQL.indexOf('create or replace function public.pace_line('),
                              PACE_SQL.indexOf('create or replace function public.pace_watch('));
  const watch = PACE_SQL.slice(PACE_SQL.indexOf('create or replace function public.pace_watch('));
  assert.match(line, /and \(since is null or r\.at > since\)/,
    'pace_line no longer leaves out a run the watcher has already said — every ' +
    'midnight for a week repeats the same sentence about the same run');
  assert.match(watch, /public\.pace_line\(now_, \(select max\(r\.at\) from public\.eugenia_runs r\s+where r\.caller = 'pace' and not r\.ok/,
    "pace_watch no longer hands pace_line the time it last spoke, off its own " +
    "'pace' rows — the filter above then has nothing to filter with");

  /* The revoke must name the signature that exists, or it raises mid-file. */
  const args = line.match(/public\.pace_line\(([\s\S]*?)\)\s*returns/)[1]
    .split(',').map(a => a.trim().split(/\s+/)[1]).join(', ');
  assert.ok(PACE_SQL.includes(`revoke execute on function public.pace_line(${args}) from`),
    `schema.sql revokes a pace_line signature other than the (${args}) it creates`);
});

/* ─── Everything a cron job dispatches answers before it works ───────────────
   TWO LIMITS, AND PAYING MOVES ONLY ONE. The wall clock is 150s free and 400s
   paid; the REQUEST idle timeout is 150s on every plan, so a briefing that
   completes perfectly while sending nothing still hands pg_net a 504 — in
   `net._http_response`, indistinguishable from a call that never ran.
   Answering first makes a non-2xx there mean what it says. `?embed=1` is the
   one exception: its answer IS its interface, and no cron job calls it.
   ─────────────────────────────────────────────────────────────────────────── */

test('a cron-dispatched call answers first, and only the backfill door waits', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const at = src.indexOf('secretMatches(fromCron, CRON_SECRET)');
  assert.ok(at > -1, 'doji-eugenia no longer authorises a cron caller');
  const branch = src.slice(at, src.indexOf('\n    return json({ ok: false, error: "unauthorized"', at))
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/\/\/.*$/, '')).join('\n');

  for (const fn of ['postScheduled', 'postTradeEvent']) {
    assert.match(branch, new RegExp(`background\\(${fn}\\(`),
      `${fn} is awaited rather than backgrounded, so any run past 150 seconds ` +
      `answers pg_net with a 504 that reads exactly like a call that never ran`);
  }

  // The trade event has no door and no reader, so it has no reason to wait.
  assert.doesNotMatch(branch, /return await postTradeEvent\(/,
    'the trade event is awaited — a fill that takes a model call would 504, ' +
    'and it is the one message with no retry anywhere behind it');

  // postScheduled keeps exactly one synchronous call site, and the next
  // assertion is what says which one it is allowed to be.
  const sync = (branch.match(/return await postScheduled\(/g) || []).length;
  assert.equal(sync, 1,
    `postScheduled is awaited at ${sync} call sites — one is the backfill door ` +
    `and any other is a scheduled job that can still collect a 504`);

  /* THE EXCEPTION IS DERIVED, NOT TYPED: a cron job for `embed` fails this,
     since the door could then 504 like the rest. */
  const dispatched = new Set(
    [...CRON_SQL.matchAll(/functions\/v1\/[\w-]+\?(\w+)=\w+/g)].map(m => m[1]));
  const waits = [...branch.matchAll(/get\("(\w+)"\) === "1"\) return await/g)].map(m => m[1]);

  assert.deepEqual(waits, ['embed'],
    `the doors that wait for their work are ${JSON.stringify(waits)} — only the ` +
    `backfill earns that, because only its answer is what the caller came for`);
  for (const flag of waits) {
    assert.ok(!dispatched.has(flag),
      `?${flag}=1 waits for its work AND has a cron job in schema.sql — that job will ` +
      `collect a 504 on every run long enough to matter`);
  }
});

test('a vendor that refuses costs the vector, never the note or the turn', () => {
  /* embed() THROWS ON PURPOSE, so `?embed=1` reports WHY nothing filled — no
     credit, a key without permission and a mistyped secret are three repairs.
     WHICH MAKES THE WRITE PATHS THE ONES THAT MUST SWALLOW IT. Backwards, a
     vendor outage stops her remembering anything, silently, while the door
     stays quiet. */
  const src = source('supabase/functions/doji-eugenia/index.ts');

  /* BY LINE, not a regex over the call: `embed(turns.map(t => String(t.content)))`
     closes three parens. */
  const calls = src.split('\n').filter(l => l.includes('await embed('));
  assert.equal(calls.length, 4,
    `${calls.length} embed() call sites read — the reader has gone blind, or one ` +
    `was added without deciding whether it may throw`);

  const caught = calls.filter(l => l.includes('.catch(() => null)')).length;
  assert.equal(caught, 3,
    'the embed calls that must never cost a row are the note write, the turn ' +
    'write and the search — one of them would now lose its row to a vendor ' +
    'outage, or the door has started swallowing the reason it exists to report');

  // AND THE ONE THAT DOES NOT CATCH IS THE SWEEP, reached only by the door and
  // the nightly pass — which wraps it itself, for the same reason the writers do.
  const body = bodyOf(src, 'async function fillEmbeddings(', 'doji-eugenia no longer has fillEmbeddings()');
  assert.ok(!/\.catch\(/.test(body),
    'fillEmbeddings swallows the vendor error, so ?embed=1 is back to answering ' +
    'ok with no reason');

  // The message has to carry the vendor's own words, since the status alone
  // sends someone to check the wrong one of three different repairs.
  assert.match(src, /embedding refused \(HTTP \$\{res\.status\}\): \$\{\(await res\.text\(\)\)/,
    'the embedding error reports a bare status and drops the body that names ' +
    'which refusal it was');
});

test('the quote she reads is the quote the poller serves', () => {
  /* TWO FILES, ONE OBJECT, NO BUILD STEP. The poller serves `Spot`; doji-eugenia
     reads `Quote` by name. A renamed field reaches her as undefined — "against a
     previous close of undefined" — rather than failing. */
  const poller = source('supabase/functions/doji-mcp-sync/index.ts');
  const eugenia = source('supabase/functions/doji-eugenia/index.ts');

  const fields = (src, name) => {
    const m = src.match(new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(m, `${name} is no longer declared as an interface`);
    return [...m[1].matchAll(/(\w+)\s*:/g)].map(x => x[1]).sort();
  };

  const served = fields(poller, 'Spot');
  assert.ok(served.length >= 6, `only ${served.length} fields read out of Spot — the reader has gone blind`);
  assert.deepEqual(fields(eugenia, 'Quote'), served,
    'the poller serves a quote with different fields than doji-eugenia declares — ' +
    'the ones she names and it does not come back undefined, in a message');

  // And the answer is that object plus what the poller adds around it, which is
  // why `ok` is what marketQuote checks rather than the presence of a field.
  assert.match(poller, /return json\(\{ ok: true, symbol: SYMBOL_IDS\[0\], \.\.\.spot \}\)/,
    'the market answer no longer spreads the folded quote, so the fields above ' +
    'agree with each other and with nothing that is actually sent');
});

test('every number off the quote reaches her with the window it was measured over', () => {
  /* THE WINDOW TRAVELS WITH THE NUMBER. Every figure in the quote is measured
     from the broker's session, which restarts at the 17:00 New York roll: before
     it `change` is the overnight move, after it a few hours of evening, and a
     bare number reads as "on the day" either way. Nothing else breaks if the
     label goes, so it is read on both paths that carry it. */
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const body = (name, kind = 'async function') =>
    uncomment(bodyOf(src, `${kind} ${name}(`, `doji-eugenia no longer has ${name}()`));

  /* THE WINDOW IS INSIDE THE RENDERING: one `quoteLine` carries the label, so a
     quote cannot be said without it. */
  assert.match(body('quoteLine', 'export function'), /quoteWindow\(/,
    'quoteLine no longer says which session its figures cover, so every caller ' +
    'of it now hands her a `change` with no window on it — which after the 17:00 ' +
    'roll reads as the move on the day and is not');

  /* AND EVERY PATH THAT PUTS A PRICE IN FRONT OF HER GOES THROUGH IT; a third
     rendering its own is the way this comes back. */
  for (const fn of ['readMarket', 'marketBlock']) {
    assert.match(body(fn), /quoteLine\(/,
      `${fn} renders the quote its own way instead of through quoteLine — a ` +
      `second rendering is a second chance to state a figure without its window`);
  }

  /* THE BRIEFING IS HANDED THE PRICE rather than asked to fetch it: a level off a
     search page is four digits and looks like gold. */
  assert.match(body('postBriefing'), /marketBlock\(/,
    'the briefing no longer reads the price before it writes, so where gold ' +
    'stands depends on her choosing to call a tool — and a stale level quoted ' +
    'from a search is indistinguishable from a live one');

  /* THE BOUNDARY THE REST OF THE SYSTEM KEEPS — the Friday close, the Sunday
     open, the poller's market hours. Read through nyClock. */
  assert.match(src, /export const ROLL_HOUR = 17;/,
    'the roll hour is no longer named, so the window label is deciding from a literal');
  assert.match(src, /nyClock\(now\)\.hour >= ROLL_HOUR/,
    'the window is no longer decided on the New York clock — a fixed offset is ' +
    'an hour wrong for every winter evening, which is half the hours this matters in');
});

/* ─── The app's arithmetic, in a second runtime ──────────────────────────────
   `journal.ts` is index.html's stats layer ported, with no build step between
   them. The break-even band matters most: ±$3 of the entry PRICE, where ±$3
   of P&L looks identical except on a large position — and then her win rate
   and his screen's differ, with nothing saying which is which.
   ─────────────────────────────────────────────────────────────────────────── */
test('the journal stats agree with the app they were ported from', () => {
  const app = source('index.html');

  const appBE = app.match(/BE:\s*([\d.]+)/);
  assert.ok(appBE, 'index.html no longer states CONFIG.BE, so nothing can be compared to it');
  assert.equal(BE, Number(appBE[1]),
    'the break-even band differs between the app and what she is told — the win ' +
    'rate she quotes and the one on his screen would part with nothing saying which is right');

  const appSessions = [...(app.match(/SESSIONS:\s*\[([^\]]*)\]/)?.[1] ?? '')
    .matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...SESSIONS], appSessions,
    'the session vocabulary differs — she would report a breakdown under names ' +
    'that are not the ones he sees, or drop a session entirely');

  /* AND THE HOURS: a London close an hour out relabels every overlap trade. */
  for (const [name, m] of Object.entries(MARKETS)) {
    const row = app.match(new RegExp(`${name}:\\s*\\{[^}]*tz:\\s*'([^']+)'[^}]*open:\\s*(\\d+)[^}]*close:\\s*(\\d+)`));
    assert.ok(row, `index.html no longer defines the ${name} session hours`);
    assert.deepEqual([m.tz, m.open, m.close], [row[1], Number(row[2]), Number(row[3])],
      `the ${name} hours differ between the app and journal.ts`);
  }

  /* THE SUBTLE DEFINITIONS, read as SHAPE: each is half of a pair that parts on
     one case — a scratch in price rather than dollars, money on the sign rather
     than the label, averages on the label rather than the sign. */
  const mod = source('supabase/functions/doji-eugenia/journal.ts');

  for (const [what, re] of [
    ['the scratch band against the entry PRICE', /Math\.abs\(t\.exit_price - t\.entry_price\) <= BE/],
    ['the money split on the SIGN of the P&L',    /if \(t\.pnl >= 0\) gross \+= t\.pnl; else loss -= t\.pnl;/],
    ['the averages split on the RESULT LABEL',    /r === 'win'[\s\S]{0,60}r === 'loss'/],
    /* THE FOURTH, which a band cannot state: a trade can move sixty dollars and
       come back to exactly nothing, and that is a break-even at any size. */
    ['exactly nothing made as a BREAK-EVEN', /scratch \|\| t\.pnl === 0 \? 'be'/],
  ]) {
    assert.match(mod, re, `journal.ts no longer computes ${what}`);
  }

  // And the app still computes them the same way, or the port has been left
  // behind by the thing it was ported from.
  assert.match(app, /Math\.abs\(t\.exit_price - t\.entry_price\) <= CONFIG\.BE/,
    'index.html no longer measures a scratch in price — journal.ts is now a port of something else');
  assert.match(app, /if \(t\.pnl >= 0\) gross \+= t\.pnl; else loss -= t\.pnl;/,
    'index.html no longer splits money on the sign');
  assert.match(app, /scratch \|\| t\.pnl === 0 \? 'be'/,
    'index.html no longer calls a P&L of exactly zero a break-even, so her port ' +
    'and the screen disagree about the same trade');
});

/* The test above reads the copies; this one RUNS them. A shape match cannot see
   a definition the regexes do not name — the session order, the entry-then-fill
   fallback, what counts as journalled — so both are handed the same rows and
   must return the same answers. The win rate is compared where something is
   decided: hers is rounded and null on nothing, on purpose. */
test('the journal stats compute what the app computes, row for row', async () => {
  const { app, close } = await boot();
  try {
    const row = (o) => ({
      id: 'PID1', direction: 'buy', entry_time: '2026-03-10T14:00:00Z', fill_time: '2026-03-10T15:00:00Z',
      entry_price: 2400, exit_price: 2410, pnl: 10, open_day: '2026-03-10',
      setup: null, followed_rules: null, followed_sl: null, followed_tp: null,
      size_oz: 1, net_pnl: null, planned_sl: null, planned_tp: null, best_price: null, ...o,
    });
    const rows = [
      row({}),                                                     // $10 at a small size: a win, not a scratch
      row({ exit_price: 2402, pnl: 200 }),                         // a scratch in price at a large size
      row({ exit_price: 2403, pnl: 300 }),                         // the band's edge, inside
      row({ exit_price: 2403.01, pnl: 301 }),                      // and just past it
      row({ exit_price: 2460, pnl: 0 }),                           // sixty dollars out and back to nothing
      row({ exit_price: 2390, pnl: -10 }),
      row({ entry_price: null, exit_price: null, pnl: 2.5 }),      // no prices: the P&L band
      row({ entry_price: null, exit_price: null, pnl: -50 }),
      row({ exit_price: null, fill_time: null, pnl: null }),       // open: undecided
      row({ entry_time: '2026-03-10T06:00:00Z' }),                 // held from Asian into London+NY: the entry decides
      row({ entry_time: null, fill_time: '2026-07-01T13:30:00Z' }),// the session seam
      row({ entry_time: null, fill_time: null }),                  // no instant at all
      row({ setup: 'Break & Retest', followed_rules: false, followed_sl: false, followed_tp: false }),
      row({ setup: 'Break & Retest', followed_rules: true, followed_sl: true, followed_tp: null }),
    ];

    rows.forEach((t, i) => {
      assert.equal(resultOf(t), app.resultOf(t), `row ${i}: the result differs`);
      assert.equal(sessionOf(t), app.sessionOf(t), `row ${i}: the session differs`);
      assert.equal(isJournalled(t), app.isComplete(t), `row ${i}: journalled differs`);
    });

    const theirs = app.counts(rows), hers = counts(rows);
    for (const k of ['win', 'loss', 'be', 'decided']) assert.equal(hers[k], theirs[k], `the ${k} count differs`);
    assert.equal(hers.wr, Math.round(theirs.wr * 100) / 100, 'the win rate differs');
    assert.deepEqual(money(rows), { ...app.money(rows) }, 'the money split differs');
    assert.deepEqual(averages(rows), { ...app.averages(rows) }, 'the averages differ');

    /* His three answers, read off the bars the app draws: each bar's title is
       followed/answered, Rules then Stop Loss then Take Profit. */
    const bars = [...app.disciplineBars(rows).matchAll(/title="(\d+)\/(\d+) followed"/g)]
      .map(m => ({ followed: Number(m[1]), answered: Number(m[2]) }));
    const d = discipline(rows);
    assert.deepEqual([d.rules, d.sl, d.tp], bars,
      'his discipline answers differ from the bars on his screen — she would say ' +
      'he followed his rules at a rate his own journal does not show');

    /* Every half hour of a year, so both daylight-saving seasons of all four
       centres are crossed; the boundaries are whole hours. */
    for (let at = Date.UTC(2026, 0, 1); at < Date.UTC(2027, 0, 1); at += 30 * 60_000) {
      assert.equal(sessionAt(new Date(at)), app.Dates.session(new Date(at)),
        `the session at ${new Date(at).toISOString()} differs`);
    }
  } finally { close(); }
});

test('the stats tool is offered wherever the journal is reasoned about', () => {
  const src = source('supabase/functions/doji-eugenia/index.ts');

  /* A CONVERSATION AND THE NIGHTLY PASS, which judges a stretch of trading and
     needs the arithmetic over the rows it is given. */
  for (const set of ['CHAT_TOOLS', 'CONSOLIDATE_TOOLS']) {
    const list = src.match(new RegExp(`const ${set} = \\[([\\s\\S]*?)\\];`));
    assert.ok(list, `doji-eugenia no longer declares ${set}`);
    assert.match(list[1], /STATS_TOOL/,
      `${set} does not offer get_stats, so she is back to computing a win rate ` +
      `out of four hundred rows of JSON by hand`);
  }

  assert.match(src, /case STATS_TOOL\.name:\s*return await readStats\(input\.days\);/,
    'get_stats is offered and not served — every call would come back as the ' +
    'sentence serve() answers an unknown name with');
});

test('the trades trigger fires on the transition, not on every poll', () => {
  /* `is distinct from`, NEVER `<>`: fill_time is null on an open position, so
     `<>` is NULL on exactly the transition this trigger exists for, and a WHEN
     that is not true does not fire. */
  const closed = SENSES_SQL.match(/create or replace trigger trades_eugenia_closed[\s\S]*?execute function/);
  assert.ok(closed, 'schema.sql no longer creates trades_eugenia_closed');
  assert.match(closed[0], /old\.fill_time is null/);
  assert.match(closed[0], /is distinct from/);
  assert.ok(!/fill_time\s*<>/.test(closed[0]),
    'the close trigger compares fill_time with <>, which is NULL against an open ' +
    'position and therefore never fires');

  assert.match(closed[0], /new\.id like 'PID%'/, 'the trigger fires on pre-sync rows too');
  assert.match(closed[0], /new\.deleted = false/, 'the trigger fires on soft-deleted rows');

  /* AND A TRADE OPENING DOES NOT CALL HER: a print pending beside an open is
     R-20's, his to weigh, and the briefing has already named it. */
  assert.ok(!/after insert on public\.trades[\s\S]{0,200}?trades_eugenia_on_event/.test(SENSES_SQL),
    'a trade opening calls her — every open becomes a message about a print');
});

test('the trigger reads the cron secret under the spelling Vault holds', () => {
  // One value, two stores, two spellings; Postgres compares the Vault name
  // case-sensitively.
  assert.match(SENSES_SQL, /where name = 'doji_cron_secret'/,
    'schema.sql reads the cron secret under a name Vault does not hold, so the trigger ' +
    'presents null and doji-eugenia answers 401 — silently, to nobody');
  assert.ok(!/DOJI_CRON_SECRET/.test(SENSES_SQL),
    'schema.sql uses the Edge-secret spelling against Vault, which yields null');
});

test('the app reads only the three tables it was given a policy for', () => {
  const app = source('index.html');
  const read = new Set([...app.matchAll(/\.from\('(eugenia_\w+)'\)/g)].map(m => m[1]));
  assert.ok(read.size, 'the app no longer reads anything of hers — the card is dead');

  for (const t of read) {
    assert.match(SENSES_SQL, new RegExp(`create policy ${t}_app_read on public\\.${t}`),
      `index.html reads ${t} and schema.sql grants the app no policy on it, so RLS ` +
      `returns an empty list and the card silently shows nothing`);
    assert.match(SENSES_SQL, new RegExp(`grant select on public\\.${t} to authenticated`),
      `index.html reads ${t} and schema.sql never grants select on it`);
  }

  /* AND HER NOTES STAY OUT OF IT: his window into them is /notes, where an answer
     can be questioned. A policy here would make the app a second reader. */
  for (const shut of ['eugenia_notes', 'eugenia_turns']) {
    assert.ok(!read.has(shut), `index.html now reads ${shut}, which is her memory`);
    assert.ok(!new RegExp(`create policy .*on public\\.${shut}`).test(SENSES_SQL),
      `schema.sql opens ${shut} to the app, which RLS denies on purpose`);
  }
});

test('the hybrid search still answers in the shape the function reads', () => {
  /* ONE DEFINITION: a second signature beside it is an overload a call cannot
     resolve, created executable by anon. The return type stays load-bearing,
     since widening it needs a drop. */
  const fn = SEMANTIC_SQL.match(/create or replace function public\.eugenia_search[\s\S]*?\$\$;/);
  assert.ok(fn, 'schema.sql no longer defines eugenia_search');
  assert.equal([...SCHEMA_SQL.matchAll(/create (or replace )?function public\.eugenia_search\(/g)].length, 1,
    'schema.sql defines eugenia_search twice — an overload a call cannot resolve');
  assert.match(fn[0], /returns table \(source text, id bigint, at timestamptz, retired boolean, body text\)/,
    'the hybrid search changed the return type, which create or replace cannot do');

  // The trigram half is what catches a rephrasing, and word_similarity rather
  // than similarity is what makes it work against a long turn at all.
  assert.match(fn[0], /q <% n\.note/, 'notes are no longer reachable by trigram');
  assert.match(fn[0], /q <% t\.content/, 'turns are no longer reachable by trigram');
  assert.ok(!/\bsimilarity\(q,/.test(fn[0]),
    'plain similarity() normalises over both trigram sets, so a short question ' +
    'against a briefing-length turn scores near zero and every long turn is lost');
  assert.match(SCHEMA_SQL, /create extension if not exists pg_trgm/);
  for (const idx of ['eugenia_notes_trgm', 'eugenia_turns_trgm']) {
    assert.match(SENSES_SQL, new RegExp(`create index if not exists ${idx}[\\s\\S]*?gin_trgm_ops`),
      `${idx} is missing, so <% falls back to a sequential scan of the archive`);
  }
});

/* ─── The database is applied by running the whole file again ───────────────
   That is the only way schema.sql is applied, to a fresh project or to the
   live one, so every statement outside a function body must be one a second
   run leaves alone. A bare `create table` refuses and rolls the paste back; a
   bare `create policy` or a publication `add` raises on the second run; a
   seed without `on conflict` duplicates or refuses; a `drop` re-run on the
   live database takes whatever it names with it. `test/db` proves it on a
   real Postgres; this is the shape, which needs no server to read.
   ─────────────────────────────────────────────────────────────────────────── */

test('schema.sql is safe to re-run in full', () => {
  const code = SCHEMA_SQL.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
  // Outside function bodies and cron commands, which run later, not on apply.
  const top = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
  const statements = top.split(';').map(t => t.trim()).filter(Boolean);
  assert.ok(statements.length >= 60, `only ${statements.length} statements read — the reader has gone blind`);

  for (const st of statements) {
    const head = st.split('\n')[0];
    assert.doesNotMatch(st, /^create (unique )?(table|index) (?!if not exists)/,
      `a bare create refuses on the second run: ${head}`);
    assert.doesNotMatch(st, /^create (function|view|trigger) /,
      `a create without "or replace" refuses on the second run: ${head}`);
    assert.doesNotMatch(st, /^(create policy|alter publication)/,
      `this raises on the second run unless it is guarded: ${head}`);
    assert.doesNotMatch(st, /^alter table [\s\S]* add (column|constraint) (?!if not exists)/,
      `an add without "if not exists" refuses on the second run: ${head}`);
    assert.doesNotMatch(st, /^drop /,
      `a drop re-run on the live database takes what it names: ${head}`);
    if (/^insert into/.test(st)) {
      assert.match(st, /on conflict/, `a seed without "on conflict" refuses or doubles on the second run: ${head}`);
    }
  }

  // The guarded ones are guarded: each sits in a `do` block behind a check.
  for (const m of code.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
    if (/\b(create policy|alter publication)\b/.test(m[1])) {
      assert.match(m[1], /if not exists \(select 1 from pg_(policies|publication_tables)/,
        `a policy or publication change inside a block runs unguarded: ${m[1].trim().slice(0, 80)}`);
    }
  }
});

/* ─── Semantic search, and the three ways it fails without saying so ─────────
   What a vector RETRIEVES is not knowable from here. The shape around it is,
   and each failure is silent: the search keeps answering, worse.
   ─────────────────────────────────────────────────────────────────────────── */

test('the width the vendor is asked for is the width the column accepts', () => {
  // A disagreement is a 400 on every write — every note, every turn, forever —
  // and the only place it would surface is a console nobody reads.
  const declared = EUGENIA_SQL.match(/\n\s+embedding\s+vector\((\d+)\)/g);
  assert.ok(declared?.length === 2,
    `${declared?.length ?? 0} embedding columns declared — notes and turns both need one`);
  for (const line of declared) {
    assert.equal(Number(line.match(/vector\((\d+)\)/)[1]), EMBED_DIMS,
      'doji-eugenia asks the vendor for a different width than the column takes');
  }
  // And the cast inside the search has to agree with both, or every query with
  // a vector throws inside the function and she reports she cannot search.
  assert.match(SEMANTIC_SQL, new RegExp(`qv::vector\\(${EMBED_DIMS}\\)`),
    'the search casts the query vector to a width neither the column nor the ' +
    'request uses');
});

test('the lexical arm survives, because a null embedding vanishes silently', () => {
  /* THE FLOOR UNDER THE SEMANTIC ARM. A null embedding is absent from a
     nearest-neighbour query, so the lexical arm is fused, never replaced. */
  const fn = SEMANTIC_SQL.slice(SEMANTIC_SQL.indexOf('create or replace function public.eugenia_search'));
  assert.match(fn, /websearch_to_tsquery/, 'the full-text arm is gone from the search');
  assert.match(fn, /word_similarity\(q,/, 'the trigram arm is gone from the search');
  assert.match(fn, /<%/, 'the trigram operator is gone, so its index is unused');

  // BOTH null guards: without the first a row is ordered by a distance it does
  // not have; without the second an unset key makes every distance null and
  // arbitrary rows enter the fusion.
  const arms = [...fn.matchAll(/where \w\.embedding is not null and \(select vec from ask\) is not null/g)];
  assert.equal(arms.length, 2,
    'a semantic arm no longer guards on both nulls — with no key it would feed ' +
    'arbitrary rows into the ranking rather than none');

  // Ranked where the distance is in scope: a CTE's order is not carried out.
  assert.equal([...fn.matchAll(/row_number\(\) over \(order by dist\)/g)].length, 2,
    'a semantic arm is numbered by something other than its distance');
});

test('the search is revoked from the public keys and granted to her alone', () => {
  /* A new function carries EXECUTE to PUBLIC, which `anon` inherits. These
     lines keep her memory off the publishable key. */
  const at = SEMANTIC_SQL.indexOf('create or replace function public.eugenia_search');
  assert.ok(at > -1, 'schema.sql no longer creates eugenia_search');

  const after = SEMANTIC_SQL.slice(at);
  assert.match(after, /revoke all on function public\.eugenia_search\(text, int, text\) from public/,
    'schema.sql creates the search and leaves EXECUTE granted to PUBLIC');

  /* AND FROM anon AND authenticated BY NAME — a SECOND revoke. `public` is the
     pseudo-role; these two hold EXECUTE separately from the schema's default
     privileges. */
  assert.match(after, /revoke all on function public\.eugenia_search\(text, int, text\) from anon, authenticated/,
    "schema.sql revokes the search from PUBLIC and leaves it granted to anon and " +
    "authenticated, which is what Supabase's default privileges give every new " +
    'function in the public schema');
  assert.match(after, /grant execute on function public\.eugenia_search\(text, int, text\) to service_role/,
    'schema.sql revokes the search from PUBLIC and never grants it to the one caller ' +
    'that needs it — every search would come back 403');
});

test('the embedding sweep names columns that exist', () => {
  /* THE BACKFILL BUILDS ITS URL FROM ARGUMENTS, so the reader of
     `rest/v1/eugenia_*` cannot see the table and column; each is checked here. */
  const calls = [...EUGENIA_TS.matchAll(/fillEmbeddings\('(\w+)', '(\w+)'\)/g)]
    .map(m => `${m[1]}.${m[2]}`);
  assert.ok(calls.length >= 4, `only ${calls.length} sweep call sites — the door and the nightly pass both call it`);
  for (const pair of new Set(calls)) {
    const [table, column] = pair.split('.');
    assert.match(EUGENIA_SQL, new RegExp(`create table[^;]*?public\\.${table}[^;]*?\\n\\s+${column}\\s`),
      `the sweep reads ${table}.${column} and schema.sql creates no such column`);
    assert.match(tableBody(EUGENIA_SQL, table), /\n\s+embedding\s+vector/,
      `the sweep fills ${table}.embedding and schema.sql never creates it`);
  }
});

test('the text is sent only when the audio did not land', () => {
  /* THE VOICE NOTE IS THE MESSAGE, and `say` is the fallback. An unset key, a
     refusing vendor or an unrenderable format would make audio alone a MISSING
     message, so the property is that `say` is still reachable. */
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const body = bodyOf(src, 'export async function sayAloud(', 'doji-eugenia no longer has sayAloud()');

  const spoke = body.indexOf('await speak(');
  const said = body.indexOf('await say(');
  assert.ok(spoke > -1, 'sayAloud never speaks');
  assert.ok(said > spoke,
    'sayAloud sends the text before or instead of attempting the audio, which is ' +
    'the two-message shape he asked to end');
  assert.match(body, /if \(!heard\) await say\(words, keyboard\)/,
    'the text is no longer the fallback — either it goes unconditionally, or a ' +
    'speech vendor that refuses is now a message he never receives');
  assert.match(body, /const signal = AbortSignal\.timeout\(budget\)/,
    'sayAloud no longer bounds the voice — a vendor that never answers holds the ' +
    'worker until the platform shuts it down, and the text never goes');
  assert.match(body, /i === parts\.length - 1 \? keyboard/,
    "the briefing's keyboard is on every part or on none — there is no text " +
    'message under the voice note to carry it any more');
});

test('the briefing goes out as she wrote it, hello included, and the hello is hers', () => {
  /* THE HELLO IS HERS. A greeting prepended in code was the same words every
     morning; undone by putting one back, or by a critic that cuts her hello as
     an opening true on any morning. */
  const body = bodyOf(EUGENIA_TS, 'async function postBriefing(', 'doji-eugenia no longer has postBriefing()');
  assert.match(body, /sayAloud\(brief, /,
    'something is put in front of the briefing again — the hello is hers to say');
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1];
  const critic = EUGENIA_PROMPT.match(/export const CRITIC = `([\s\S]*?)`;/)[1];
  assert.match(system, /SAY HELLO YOUR OWN WAY, THEN THE STORY/, 'SYSTEM no longer asks for her own hello');
  assert.match(system, /never a line of its own/, 'SYSTEM no longer keeps the hello inside the first paragraph');
  assert.match(critic, /hello it opens with is hers and stays as written/,
    'CRITIC can cut her hello as an opening true on any morning, and it runs last');
  assert.match(critic, /a split never\s+leaves it on its own/,
    'CRITIC can split the first paragraph after the hello, leaving it to be read as a paragraph');
});

test('every message she writes goes out through sayAloud', () => {
  /* THE HALF THE FUNCTION CANNOT GUARANTEE: a path calling `say` directly works
     and is silent. Five sites — the briefing's two (the speaking worker and
     postBriefing's fallback), then the Saturday review, the trade event and the
     reply. `/notes`, the apologies, the short operational lines and the
     charm's copy keep `say` deliberately — the charm's voice is on the charm. */
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const spoken = (src.match(/await sayAloud\(/g) || []).length;
  assert.equal(spoken, 5,
    `${spoken} call sites speak where five should — a message she writes that goes ` +
    `out through say() alone arrives correctly and silently`);
});

test('the audio is asked for in the one format Telegram renders as a voice note', () => {
  /* THE ONE THING HERE THAT FAILS QUIETLY: the vendor's default mp3 WORKS, and
     arrives as an attachment rather than a voice note — nothing errors. */
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const body = bodyOf(src, 'async function speak(', 'doji-eugenia no longer has speak()');

  assert.match(body, /await reading\(answer, "opus", signal\)/,
    'the speech request no longer asks for opus — mp3 succeeds and arrives as a ' +
    'file attachment rather than a voice note, silently');
  assert.match(bodyOf(src, 'function reading(', 'doji-eugenia no longer has reading()'),
    /response_format: format/,
    'the speech request no longer sends the format its caller asked for, so ' +
    'what the voice note asks for is not what the vendor is sent');
  assert.match(body, /type: "audio\/ogg"/,
    'the upload no longer declares audio/ogg, so Telegram has only the filename ' +
    'to go on');
  assert.match(body, /"reply\.ogg"/,
    'the upload no longer carries an .ogg filename');
  /* BOTH REQUESTS CARRY THE BUDGET: an upload to Telegram that hangs kills the
     worker as surely as a hanging vendor. */
  assert.equal((body.match(/\bsignal\b/g) || []).length, 3,
    'speak() takes the budget and does not hand it to both of its requests — a ' +
    'request without it waits for as long as the vendor takes');
});

test('the length she is told to write to is the length that is spoken', () => {
  /* THERE IS NO CAP, SO THE PROMPT STATES NO LENGTH: a number there would ask her
     to write shorter for a limit that does not exist. */
  const src = source('supabase/functions/doji-eugenia/index.ts');
  assert.doesNotMatch(src, /Keep it under \$\{[A-Z_]*MAX[A-Z_]*\} characters/,
    'the prompt asks her to write shorter to fit a voice note again — there is ' +
    'no cap for it to fit, so that is a shorter answer bought for nothing');
});

test('every reason a voice note fails is one the handler can actually reach', () => {
  /* A sentence nothing selects is never read, and a key looked up and not defined
     renders `undefined` to him. Both halves. */
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const block = src.match(/export const VOICE_TROUBLE: Record<string, string> = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'doji-eugenia no longer defines VOICE_TROUBLE');
  const defined = [...block[1].matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]).sort();
  assert.ok(defined.length >= 3, `only ${defined.length} reasons read — the reader has gone blind`);

  // The keys the code actually selects with, read out of the trouble literals
  // the handler and the transcriber produce.
  const reached = [...src.matchAll(/trouble: '(\w+)'/g)].map(m => m[1]);
  assert.ok(reached.length >= 3, `only ${reached.length} reasons are ever selected`);

  for (const key of new Set(reached)) {
    assert.ok(defined.includes(key),
      `the handler selects VOICE_TROUBLE['${key}'] and nothing defines it — he ` +
      `would be sent the word "undefined"`);
  }
  for (const key of defined) {
    assert.ok(reached.includes(key),
      `VOICE_TROUBLE defines "${key}" and no path can ever produce it`);
  }

  /* THE FORMAT IS DECLARED BOTH WAYS — `audio/ogg` and the extension — since
     providers differ in which they read. The content type is the half that
     looks redundant. */
  const fn = src.match(/async function transcribe\([\s\S]*?\n\}/);
  assert.ok(fn, 'doji-eugenia no longer has transcribe()');
  assert.match(fn[0], /new Blob\(\[bytes\], \{ type: mime \}\)/,
    'the audio part carries no content type, so a provider that detects format ' +
    'from it rather than from the filename has nothing to go on');
  assert.match(fn[0], /form\.append\("file",[\s\S]*?, name\)/,
    'the audio part carries no filename, so a provider that detects format from ' +
    'the extension has nothing to go on');
});

test('every query flag the poller reads is one the market gate considers', () => {
  /* A READ-ONLY FLAG LEFT OUT OF THE GATE ANSWERS "market closed" AT THE WEEKEND,
     exactly when a suspicious row gets looked at. Every flag the entry point
     reads must appear in the gate. */
  const src = source('supabase/functions/doji-mcp-sync/index.ts');

  // Any compared value, not only "1": ?market=raw shares its parameter.
  const flags = [...src.matchAll(/const (\w+)\s*=\s*url\.searchParams\.get\("(\w+)"\) === "[^"]+"/g)]
    .map(m => m[1]);
  assert.ok(flags.length >= 3, `only ${flags.length} flags read out of the poller — the reader has gone blind`);

  const gate = src.match(/if \(([^)]*?)!marketOpen\(\)\) \{/);
  assert.ok(gate, 'the poller no longer gates its work on the market being open');

  for (const flag of flags) {
    assert.match(gate[1], new RegExp(`!${flag}\\b`),
      `?${flag}=1 is read but the market gate ignores it, so it answers ` +
      `"market closed" every weekend — which is when it is actually used`);
  }
});

test('the poller answers its debug flags before it writes anything', () => {
  // Both read-only flags return before the fold and the upsert: a debug surface
  // that writes on the way to answering is not one.
  const src = source('supabase/functions/doji-mcp-sync/index.ts');

  const write = src.indexOf('const data = await mcpCall(session, "get_deals", dealArgs)');
  assert.ok(write > -1, 'the poller no longer folds the deals it was about to write');

  for (const [flag, marker] of [['raw', 'if (raw) {'], ['tools', 'if (tools) {']]) {
    const at = src.indexOf(marker);
    assert.ok(at > -1, `the poller no longer answers ?${flag}=1`);
    assert.ok(at < write,
      `?${flag}=1 is answered after the poll has already folded its deals`);
  }

  /* tools/list GOES PAST THE ALLOW-LIST, correctly: ALLOWED_TOOLS guards a tool
     NAME becoming a request, and `tools/list` names none. It must discover
     without calling. */
  const block = src.slice(src.indexOf('if (tools) {'), write);
  assert.match(block, /method: "tools\/list"/);
  assert.ok(!/tools\/call/.test(block),
    'the tools probe calls a tool it discovered, which is exactly what the ' +
    'allow-list exists to prevent');
});

/* ─── Nothing this function can call may place a trade ───────────────────────
   The broker's endpoint serves create_order, close_position, amend_position,
   amend_order and cancel_order on the same credential as the prices. The
   read-only guarantee is a property of one array in one file, not of the key.
   ─────────────────────────────────────────────────────────────────────────── */

test('the poller can call nothing that would place, move or close a trade', () => {
  const src = source('supabase/functions/doji-mcp-sync/index.ts');

  const list = src.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\] as const;/);
  assert.ok(list, 'doji-mcp-sync no longer declares ALLOWED_TOOLS');
  const allowed = [...list[1].matchAll(/"(\w+)"/g)].map(m => m[1]);
  assert.ok(allowed.length >= 2, `only ${allowed.length} tools read — the reader has gone blind`);

  const banned = src.match(/export const DESTRUCTIVE_TOOLS = \[([\s\S]*?)\] as const;/);
  assert.ok(banned, 'doji-mcp-sync no longer names the destructive tools');
  const destructive = [...banned[1].matchAll(/"(\w+)"/g)].map(m => m[1]);
  assert.ok(destructive.length >= 5,
    `only ${destructive.length} destructive tools named — the endpoint offers five`);

  for (const t of destructive) {
    assert.ok(!allowed.includes(t),
      `ALLOWED_TOOLS contains ${t}, which places, moves or closes a trade — the ` +
      `poller is no longer read-only and nothing else in this system says so`);
  }

  /* AND EVERY READ STILL GOES THROUGH THE CHECK — likelier to regress than someone
     typing create_order into the array. */
  assert.match(src, /if \(!ALLOWED_TOOLS\.includes\(tool\)\) throw/,
    'mcpPost no longer enforces the allow-list, so the array is decoration');

  // Nowhere in the file may a destructive name appear as a call, whatever the
  // array says — the probes call tools directly and must not be a way round it.
  for (const t of destructive) {
    assert.ok(!new RegExp(`mcpPost\\(session, "${t}"|mcpCall\\(session, "${t}"|name: "${t}"`).test(src),
      `doji-mcp-sync calls ${t} somewhere, bypassing the allow-list entirely`);
  }
});

/* ─── TradingView reads, and the list of what it may read is TradingView's ────
   `?tools=1`'s answer is a fixture, so the tools that change his account are
   DERIVED from its `readOnlyHint` rather than copied, and a new one in a fresh
   capture is banned unasked. The poller's three halves: every permitted tool
   is read-only on the listing, the one place a name becomes a request
   consults the list, and no writing tool is named anywhere in the file.
   ─────────────────────────────────────────────────────────────────────────── */

test('doji-tradingview may call only what TradingView itself marks read-only', () => {
  const src = source('supabase/functions/doji-tradingview/index.ts');
  const listed = JSON.parse(readFileSync(
    new URL('./fixtures/tradingview-tools-list.json', import.meta.url), 'utf8')).result.tools;
  const reads = listed.filter(t => t.annotations?.readOnlyHint === true).map(t => t.name);
  const writes = listed.filter(t => t.annotations?.readOnlyHint !== true).map(t => t.name);
  // A capture that stopped parsing, or a field renamed, would make both lists
  // empty and every assertion below vacuous.
  assert.ok(reads.length >= 20 && writes.length >= 11,
    `${reads.length} read and ${writes.length} write tools in the capture — the reader has gone blind`);

  const allowed = [...src.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\] as const;/)[1]
    .matchAll(/"([\w-]+)"/g)].map(m => m[1]);
  assert.ok(allowed.length >= 3, `only ${allowed.length} tools on the allow-list — the reader has gone blind`);
  for (const t of allowed) {
    assert.ok(reads.includes(t),
      `ALLOWED_TOOLS permits ${t}, which TradingView's own listing does not mark read-only ` +
      `— or which it does not serve at all`);
  }

  assert.match(src, /if \(!ALLOWED_TOOLS\.includes\(tool\)\) throw/,
    'tvPost no longer enforces the allow-list, so the array is decoration');
  assert.equal(src.match(/tools\/call/g)?.length, 1,
    'tools/call appears somewhere other than tvPost — a second way for a name to become a request');

  for (const t of writes) {
    assert.ok(!src.includes(`"${t}"`),
      `doji-tradingview names ${t}, which changes his account, as a string — the one ` +
      `way that name becomes a request`);
  }
});

test('every tool doji-tradingview may call is one a probe or a reader calls', () => {
  // The poller's rule: a permitted name nothing reaches is a widening with no
  // feature behind it, and that is the shape a write would arrive in.
  const src = source('supabase/functions/doji-tradingview/index.ts');
  const allowed = [...src.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\] as const;/)[1]
    .matchAll(/"([\w-]+)"/g)].map(m => m[1]);
  const body = src.slice(src.indexOf('as const;', src.indexOf('const ALLOWED_TOOLS')));
  for (const t of allowed) {
    assert.ok(body.includes(`"${t}"`), `ALLOWED_TOOLS permits ${t} and nothing in the file ever calls it`);
  }
});

test('the quote batch is probed without the euro, the one forex symbol the market reads', () => {
  /* The batch was refused whole with the forex scanner's 429; the probe asks
     whether it answers without one. The market's own read is bar by bar and
     takes the euro like any other line. */
  const src = source('supabase/functions/doji-tradingview/index.ts');
  const market = [...src.match(/const MARKET = \[([\s\S]*?)\n\];/)[1].matchAll(/symbol: "([^"]+)"/g)].map(m => m[1]);
  const forex = market.filter(s => /^(FX|FX_IDC|OANDA|PEPPERSTONE):/.test(s));
  assert.ok(forex.length, 'the market reads no forex symbol, so this check has nothing to hold');
  assert.ok(forex.every(s => s.startsWith('FX:')), `a forex symbol is read under another prefix: ${forex}`);
  assert.match(src, /"mcp-tv-get-symbol-data-batch", \{ symbols: AROUND\.filter\(s => !s\.startsWith\("FX:"\)\) \}/,
    'the quote probe sends the euro in the batch it exists to try without one');
});

test('every tool the poller may call is one it actually calls or probes', () => {
  // A name in the array nothing reaches is a widening with no feature — the shape
  // a destructive tool would arrive in, added "for later".
  const src = source('supabase/functions/doji-mcp-sync/index.ts');
  const allowed = [...src.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\] as const;/)[1]
    .matchAll(/"(\w+)"/g)].map(m => m[1]);

  for (const t of allowed) {
    assert.match(src, new RegExp(`(mcpPost|mcpCall)\\(session, "${t}"`),
      `ALLOWED_TOOLS permits ${t} and nothing in the file ever calls it`);
  }
});

/* ─── The columns with two claimants are settled inside the UPDATE ───────────
   A filter in the URL, evaluated by Postgres inside the UPDATE, so there is no
   read to lose a race with. Unfiltered, the poller's re-read files R-04's
   break-even stop as the plan — present, plausible and wrong — and `balance`
   overwrites the figure the broker printed on the fill. Read out of each
   function body: a whole-file match is answered by another function's copy. */

test('every column the poller writes once is filtered inside the UPDATE', () => {
  const src = source('supabase/functions/doji-mcp-sync/index.ts');

  // ONE WRITER, so the filter lives in one place and every caller inherits it.
  const body = bodyOf(src, 'async function writeOnce(', 'doji-mcp-sync no longer has writeOnce()');
  assert.match(body, /trades\?id=eq\.\$\{id\}&\$\{column\}=is\.null/,
    'writeOnce writes with no `<column>=is.null` filter, so it writes on every ' +
    'poll — the last sighting wins a column where the first one is the whole point');
  assert.match(body, /method: "PATCH"/,
    'writeOnce no longer PATCHes, and an upsert under merge-duplicates sets every ' +
    'key it is handed — the filter in the URL would not be consulted at all');

  /* AND NOTHING WRITES AROUND IT. A second PATCH in the file is a column written
     with whatever filter its author remembered. `fill_time` is the email's and
     the poller stamps only the gaps; `balance` likewise; the plan and
     `best_price` are their first sighting. */
  assert.equal((src.match(/method: "PATCH"/g) || []).length, 1,
    'doji-mcp-sync PATCHes trades somewhere other than writeOnce');
  for (const call of ['writeOnce(target, "balance"', 'writeOnce(plan.id, col, plan[col])',
                      'writeOnce(f.row.id, "fill_time"', 'writeOnce(t.id, "best_price", best)']) {
    assert.ok(src.includes(call), `the poller no longer writes through ${call}`);
  }
});

test('the trade look speaks only about the day it is happening on', () => {
  /* WHAT THIS PATH SAYS IS ABOUT TODAY. The trigger fires on a transition, not
     a clock, so anything stamping an old close fires it for an old day — a
     backfill would report August's losses in the present tense. Guarded BEFORE
     the day is read, so an old close costs nothing. */
  const src = source('supabase/functions/doji-eugenia/index.ts');

  const body = bodyOf(src, 'async function postTradeEvent(', 'doji-eugenia no longer has postTradeEvent()');

  assert.match(body, /\bday !== nyDate\(new Date\(\)\)/,
    'the trade look no longer checks the trade is today, so any late stamp — a ' +
    'forced repair, an email arriving days later — reports a finished day in ' +
    'the present tense as though he could still act on it');

  const guard = body.indexOf('day !== nyDate');
  assert.ok(guard > -1 && guard < body.indexOf('dayStanding('),
    'the day guard sits after the day is read — an old close pays for a read ' +
    'of a day that is already over');
});

test('the close instant is written only where the deals say it closed', () => {
  /* THE SAME SET THE BALANCE WRITE TAKES: a fully closed position ends on its
     closing deal. A partial close has no exit price and no close to stamp —
     writing one would file a running position as finished. Read out of the
     handler, since the helper cannot see which rows it is called for. */
  const src = source('supabase/functions/doji-mcp-sync/index.ts');

  assert.match(src, /folded\.filter\(f => f\.row\.exit_price !== null\)[\s\S]{0,120}writeOnce\(f\.row\.id, "fill_time", new Date\(f\.closedAt\)/,
    'the close instant is no longer confined to positions the deals show closed — ' +
    'an open position stamped with a fill_time is reported as finished, and the ' +
    'close trigger fires for a trade that is still running');

  // AFTER the upsert, for writePlan's reason: a PATCH against an id nothing has
  // inserted matches nothing and reports success.
  assert.ok(src.indexOf('await upsert(folded.map(f => f.row))') < src.indexOf('writeOnce(f.row.id'),
    'the close instant is written before the row exists, so every first sighting ' +
    'of a close is silently skipped');

  /* AND IT NEVER TAKES THE POLL DOWN: a stamp that fails leaves one row in the
     state every unstamped row is already in. */
  const at = src.indexOf('let stamped = 0;');
  assert.ok(at > -1, 'the poller no longer counts the close instants it wrote');
  assert.match(src.slice(at, at + 400), /try \{[\s\S]*?\} catch/,
    'the close-instant write is unguarded, so one failed PATCH loses the whole poll');

  // Counted on the ANSWER rather than the attempt: a PATCH filtered to nothing is
  // a 200.
  assert.match(src.slice(at, at + 400), /if \(await writeOnce\(f\.row\.id, "fill_time", .*\)\) stamped\+\+;/,
    'stamped counts calls made rather than rows written — the number would read ' +
    'the same whether the filter works or has stopped filtering');
  assert.match(src, /balance_for: target, planned, stamped,/,
    'the poller no longer reports what it stamped, so the one meter on this ' +
    'arbitration is not in the answer anybody reads');
});

/* ─── The meter beside the filter has to be able to report it failing ───────
   `planned` counts ROWS, not calls — a working filter, a broken one and a row
   not yet inserted would otherwise read the same. `return=representation` is
   what makes that answerable: a PATCH filtered to nothing is a 200 with an
   empty body. DROPPING THE PREFER HEADER IS THE SILENT HALF — every write
   reads as none, and the meter settles on 0, the healthy steady state.
   ─────────────────────────────────────────────────────────────────────────── */

test('the poller counts the plans it wrote, not the plans it tried', () => {
  const src = source('supabase/functions/doji-mcp-sync/index.ts');

  /* THE ONE WRITER answers whether it wrote, and every count is taken from that
     answer: the silent half is a property of the shape, so it is held once. */
  const body = bodyOf(src, 'async function writeOnce(');
  assert.match(body, /Promise<boolean>/,
    'writeOnce no longer answers whether it wrote, so every count beside it is ' +
    'back to counting calls');
  assert.match(body, /\(\(await res\.json\(\)\) as unknown\[\]\)\.length > 0/,
    'writeOnce stopped reading the rows it got back, so its answer is no longer ' +
    'about what the database did');
  assert.match(body, /sbHeaders\("return=representation"\)/,
    'writeOnce asks for no representation, so a PATCH that matched nothing and ' +
    'one that wrote come back identical — every meter reads 0 forever, which is ' +
    'indistinguishable from a quiet poll');
  assert.match(src, /if \(plan\[col\] !== undefined && await writeOnce\(plan\.id, col, plan\[col\]\)\) wrote\+\+;/,
    'writePlan counts the calls it made rather than the rows written');

  assert.match(src, /planned \+= await writePlan\(/,
    'the poller increments its plan count on the call rather than on the answer, ' +
    'so a filter that stopped filtering would report exactly what a working one does');
  assert.match(src, /for \(const col of \["planned_sl", "planned_tp"\] as const\)/,
    'writePlan is back to one PATCH for both sides — `planned_sl is null` cannot ' +
    'arbitrate `planned_tp`, so a side that appears later either never lands or ' +
    'lands as whatever R-04 has since moved it to');
});

/* `sliced` is driven in fold.test.mjs; this reads that the poll asks it, in
   the one order that cannot write a slice: the deals, then the broker's live
   list, then the judgment, then the upsert of what survived it. The list read
   first, a position closing between the two reads is written sliced once. */
test('the poll judges its folds against the live list before it writes them', () => {
  const src = source('supabase/functions/doji-mcp-sync/index.ts');
  const at = (needle) => {
    const i = src.indexOf(needle);
    assert.ok(i > -1, `the poll no longer contains ${needle}`);
    return i;
  };
  const deals    = at('await mcpCall(session, "get_deals", dealArgs)');
  const positions = at('await mcpCall(session, "get_positions", {})');
  const judged   = at('const slices = sliced(moved.map(f => f.row), plans);');
  const kept     = at('const folded = moved.filter(f => !slices.includes(f.row.id));');
  const written  = at('await upsert(folded.map(f => f.row))');
  assert.ok(deals < positions && positions < judged && judged < kept && kept < written,
    'the poll no longer reads the deals, then the live list, then judges, then writes ' +
    'what survived — an entry-less fold can reach the upsert');
  assert.equal(src.split('mcpCall(session, "get_positions"').length - 1, 1,
    'get_positions is read twice in the poll — the plan and the slice judgment must ' +
    'stand on the same list');
  assert.match(src, /await heartbeat\("poller"\);\n[\s\S]{0,400}if \(slices\.length\) \{\n\s*await heartbeat\("poller", new Error\(/,
    'a slice is no longer marked after the run\'s own mark, so the last outcome reads ' +
    'as healthy and her briefing never names it');
});

test('the poller fills best_price once, newest first, and counts what it wrote', () => {
  /* bestPrice can be right on every bar while the poll never reaches it, reads the
     backlog oldest first, or overwrites every two minutes — none a wrong number
     a test of the function could see. So the call site is read. */
  const src = source('supabase/functions/doji-mcp-sync/index.ts');
  const body = bodyOf(src, 'async function fillExcursions(', 'doji-mcp-sync no longer has fillExcursions()');

  assert.match(body, /order=entry_time\.desc&limit=\d+/,
    'the excursion read is no longer newest first with a limit — a fresh close ' +
    'queues behind the backlog, or the read grows with the table');
  assert.match(body, /if \(await writeOnce\(t\.id, "best_price", best\)\) wrote\+\+;/,
    'the excursion write no longer goes through writeOnce, or its count is taken ' +
    'from the call rather than the rows written — a figure rewritten every poll, ' +
    'or a meter reading 0 for ever');
  assert.match(src, /excursions = await fillExcursions\(session\)/,
    'the poll no longer calls fillExcursions, so best_price is never written ' +
    'and R-04 is unknown on every trade for ever');
});

test("the nightly pass files the week, meters both outcomes, and check_rules reads it", () => {
  /* fileWeek and r19 are driven in fold.test.mjs; a pass that stopped filing
     leaves R-19 unknown on every trade with nothing erroring. The call sites,
     both meters and the calendar handed to the rules are read. */
  const src = source('supabase/functions/doji-eugenia/index.ts');
  const pass = bodyOf(src, 'async function postConsolidation(');
  assert.match(pass, /await filedWeek\(weekOf\(new Date\(\)\)\)/,
    'the nightly pass no longer files the week R-19 is judged against');
  const week = bodyOf(src, 'async function filedWeek(');
  assert.match(week, /caller: 'calendar week', ok: true/, 'the week filing records no success');
  assert.match(week, /caller: 'calendar week', ok: false/, 'the week filing records no failure');

  const check = src.slice(src.indexOf('async function readRules('));
  const body = check.slice(0, check.indexOf('\n}'));
  assert.match(body, /releasesQuery\(days\)/, 'check_rules no longer reads the releases');
  assert.match(body, /weeksQuery\(days\)/, 'check_rules no longer reads which weeks were fetched');
  assert.match(body, /checkRules\(kept, Date\.now\(\), \{/,
    'check_rules hands the rules no calendar, so R-19 is unknown on every trade');
  assert.match(body, /stopsQuery\(days\)/, 'check_rules no longer reads the stop history');
  assert.match(body, /\}, stops\)/,
    'check_rules hands the rules no stop history, so R-19 is unknown on every trade');

  /* AND THE POLLER WRITES THE HISTORY, inside the step that already read the
     open positions — a pure stopChanges proves nothing about being called. */
  const poller = source('supabase/functions/doji-mcp-sync/index.ts');
  assert.match(poller, /planned \+= await writePlan\(plan\);\s*stops = await recordStops\(plans\);/,
    'the poll no longer records stop moves, so trade_stops stops growing and R-19 goes unknown');
});

test('Eugenia reaches a price through the poller and never holds the broker token', () => {
  /* THE SAME ENDPOINT THAT SERVES A PRICE SERVES create_order. doji-mcp-sync
     holds the token and only ever answers with a quote or bars; she presents the cron
     secret she has. The token in her hands would put a market order one prompt
     injection away. Structural, not instructed. */
  const eugenia = source('supabase/functions/doji-eugenia/index.ts');

  /* THE READ, NOT THE MENTION: the comment explaining why she does not hold the
     token names it. */
  assert.ok(!/env\(\s*["']CTRADER_/.test(eugenia),
    'doji-eugenia reads a cTrader credential — the market read must go through ' +
    'the poller, which is the only function that may hold one');
  assert.ok(!/mcp\.ctrader\.com/.test(eugenia),
    'doji-eugenia addresses the broker directly, bypassing the allow-list that ' +
    'is the only thing keeping create_order out of reach');

  // And each reaches a function that exists, by a path this repository deploys.
  for (const name of ['MARKET_URL', 'STRUCTURE_URL']) {
    const url = eugenia.match(new RegExp(`const ${name} = \`\\$\\{SB_URL\\}\\/functions\\/v1\\/([\\w-]+)`));
    assert.ok(url, `doji-eugenia no longer builds ${name} from SB_URL`);
    assert.ok(DEPLOYED.includes(url[1]),
      `doji-eugenia reads ${name} from /functions/v1/${url[1]}, which is not a ` +
      `function this repository deploys — every call is a 404`);
    assert.match(eugenia, new RegExp(`fetch\\(${name}[\\s\\S]{0,400}?x-doji-key`),
      `${name}'s read presents no secret, so the poller will refuse it 401`);
  }
});

/* ─── Only the TradingView filing makes a calendar row ───────────────────────
   An upsert keyed on a model-written name files a print on a new row, silently,
   and an instruction cannot carry this. So it is structural: one write in the
   file touches the table, keyed on TradingView's id, and no tool she is handed
   writes to it. A second writer still answers and leaves a row nobody watches.
   ─────────────────────────────────────────────────────────────────────────── */

test('one write makes a calendar row, keyed on the id, and she holds none', () => {
  const inserts = [...EUGENIA_TS.matchAll(/eugenia_calendar\?on_conflict=([\w,]+)/g)].map(m => m[1]);
  assert.deepEqual(inserts, ['tv_id'],
    'a second write can create a calendar row, or the filing no longer keys on the ' +
    "id — either way one print can become two rows under two names again");
  // Inside upsertCalendar, and reached only from the two TradingView filings —
  // a found-nowhere index would satisfy a bare `<`, so each position is required.
  const at = EUGENIA_TS.indexOf('async function upsertCalendar(');
  const upsert = EUGENIA_TS.indexOf('eugenia_calendar?on_conflict');
  assert.ok(at > -1 && upsert > at && upsert < EUGENIA_TS.indexOf('\n}', at),
    'the one upsert is no longer inside upsertCalendar');
  const calls = (EUGENIA_TS.match(/upsertCalendar\(/g) ?? []).length - 1;
  assert.equal(calls, 2, `upsertCalendar is called ${calls} times — something other than the two filings writes rows`);
  for (const fn of ['fileCalendar', 'fileWeek']) {
    const from = EUGENIA_TS.indexOf(`export async function ${fn}(`);
    const body = EUGENIA_TS.slice(from, EUGENIA_TS.indexOf('\n}', from));
    assert.ok(from > -1 && body.includes('upsertCalendar(') && body.includes('calendarRows('),
      `${fn} no longer files through calendarRows and upsertCalendar`);
  }
  // AND NOTHING ELSE WRITES: every request addressed to the table is the upsert.
  const writes = [...EUGENIA_TS.matchAll(/rest\/v1\/eugenia_calendar/g)].map(m => m.index);
  assert.ok(writes.length >= 1 && writes.every(i => i > at && i < EUGENIA_TS.indexOf('\n}', at)),
    'something outside upsertCalendar writes to the calendar — a second writer, ' +
    'and the row it leaves is one nobody watches');
});

test('the market around gold reaches the briefing, and only from one list', () => {
  /* aroundList is driven in fold.test.mjs and cannot see its callers. A briefing
     that stopped reading the market still reads well, off a search page. */
  const brief = bodyOf(EUGENIA_TS, 'async function postBriefing(');
  assert.match(brief, /aroundBlock\(\)/, 'the briefing no longer reads the market around gold');
  assert.match(brief, /\baround \+ /, 'the briefing reads the market around gold and never hands it to her');
  /* THE SYMBOLS LIVE IN doji-tradingview ALONE, beside their names. A renderer
     holding its own list is a list that can name a symbol nothing reads. */
  assert.doesNotMatch(EUGENIA_TS, /"(?:TVC|FRED|SP):[A-Z0-9]+"/,
    'doji-eugenia names a TradingView symbol — the list it renders is doji-tradingview\'s');
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1].replace(/\s+/g, ' ');
  assert.match(system, /THE MARKET AROUND GOLD IS HANDED TO YOU TOO/,
    'SYSTEM no longer says the market around gold is handed to her, so she searches for it');
  assert.match(system, /say the window the line gives/,
    'SYSTEM no longer asks her to say what a market figure is measured from');
  assert.doesNotMatch(system, /finance\.yahoo\.com/,
    'SYSTEM still sends her to a page for the dollar or the ten-year she is now handed');
});

/* ─── What broke since the last briefing ─────────────────────────────────────
   `breachesBlock` is driven in fold.test.mjs; whether the briefing reads it is
   read here. */
test('the briefing is handed the rules his trades broke, and told to take them from there', () => {
  const body = uncomment(bodyOf(EUGENIA_TS, 'async function postBriefing('));
  assert.ok(reaches(body, 'breachesBlock'),
    'the briefing no longer reads what his trades broke, so a Friday breach is never raised');
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1];
  assert.match(system, /closed trade since\s+your last briefing/,
    'SYSTEM judges "yesterday" again, which on a Monday is Sunday');
  assert.match(system, /never call a rule broken that it does not list/,
    'SYSTEM no longer holds her to the computed breaches, so she reads them off the rows');
  // One reader for the tool and the block, so the two cannot be fed differently.
  assert.match(bodyOf(EUGENIA_TS, 'export async function breachesBlock('), /readRules\(/,
    'the briefing evaluates the rules through a reader check_rules does not use');
});

/* ─── The briefing that opens the week ───────────────────────────────────────
   Whether a Sunday reads weekBlock, is told what to do with it, and is spared
   the critic counting the week's list against the words — or the prose is cut
   to make room every Sunday. */
test('the Sunday briefing reads the week and tells it rather than lists it, in both copies', () => {
  const brief = bodyOf(EUGENIA_TS, 'async function postBriefing(');
  assert.match(brief, /due === 'sunday' \? weekBlock\(\) : calendarBlock\(\)/,
    'the Sunday briefing no longer reads the week, so it sees only to Monday evening');
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1].replace(/\s+/g, ' ');
  const critic = EUGENIA_PROMPT.match(/export const CRITIC = `([\s\S]*?)`;/)[1].replace(/\s+/g, ' ');
  assert.match(system, /ON SUNDAY THE BRIEFING OPENS THE WEEK/, 'SYSTEM no longer says what a Sunday briefing is for');
  assert.match(system, /Today's releases rated high and nothing else/,
    'the weekday calendar lists more than its own day again, so tomorrow arrives twice');
  /* HIGH-RATED ONLY, IN BOTH COPIES, on his instruction of 13 October: seven
     lines for one release that mattered. The critic runs last. */
  assert.match(critic, /is a line on the Today: list rated anything but high\? It comes out/,
    'CRITIC no longer takes a release rated below high off the weekday list, and it runs last');
  assert.match(system, /not a look back at his week/,
    'SYSTEM no longer rules out a weekly review, which he decided against');
  /* THE WEEK IS TOLD, IN BOTH COPIES. The critic runs last, so a writer told
     to tell the week under a critic that keeps the list gets the list back. */
  assert.match(system, /THE WEEK IS TOLD, NOT LISTED: Sunday has no calendar slot\. Name the release that carries the week with its day/,
    'SYSTEM has Sunday list the week again, which he has on his own screen');
  assert.match(critic, /IS IT SUNDAY'S\? Then the week is told, not listed: a day-by-day list of releases comes out/,
    'CRITIC no longer takes the week\'s list out of a Sunday briefing, and it runs last');
});

/* ─── His charts, as her map ─────────────────────────────────────────────────
   structureList is driven in fold.test.mjs and cannot see its callers or the
   words around it. The map reaches the briefing for its call and a reply
   through get_structure; the briefing is still the weeks behind his chart, so
   the writer is told the map is for the call alone and the critic, which runs
   last, takes it out of the prose. Each half without the other is the critic
   undoing the writer, or letting through what the writer was told. */
test('his charts reach the briefing for its call and a reply through get_structure, and nothing else', () => {
  const brief = bodyOf(EUGENIA_TS, 'async function postBriefing(');
  assert.match(brief, /marketBlock\(\), structureBlock\(\),/, 'the briefing no longer reads his charts');
  assert.match(brief, /\bprice \+ chart \+ /, 'the briefing reads his charts and never hands them to her');
  const sets = Object.fromEntries([...EUGENIA_TS.matchAll(/const (\w+_TOOLS)(?:: [^=]+)? = \[([\s\S]*?)\];/g)]
    .map(m => [m[1], m[2]]));
  assert.ok(Object.keys(sets).length >= 4, 'read too few tool sets — the reader has gone blind');
  assert.deepEqual(Object.keys(sets).filter(k => /\bSTRUCTURE_TOOL\b/.test(sets[k])), ['CHAT_TOOLS'],
    'get_structure is offered outside a conversation, or not in one');
  const served = EUGENIA_TS.slice(EUGENIA_TS.indexOf('case STRUCTURE_TOOL.name:'));
  assert.match(served.slice(0, served.indexOf('\n')), /structureBlock\(\)/,
    'get_structure no longer reads the map the job keeps');
  /* THE MAP IS SAID AS HERS, in every place it is said. */
  const tool = EUGENIA_TS.slice(EUGENIA_TS.indexOf('const STRUCTURE_TOOL = {'));
  assert.match(tool.slice(0, tool.indexOf('} as const;')).replace(/" \+\s*"/g, ''),
    /It is your map, computed the same way every time, and not his/);
  assert.match(bodyOf(EUGENIA_TS, 'export function structureList('), /This is YOUR map/);
});

test('the map is hers, printed, built into her call, and kept out of the briefing\'s prose by both prompts', () => {
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1].replace(/\s+/g, ' ');
  const critic = EUGENIA_PROMPT.match(/export const CRITIC = `([\s\S]*?)`;/)[1].replace(/\s+/g, ' ');
  for (const [said, why] of [
    [/IT IS YOUR MAP, NOT HIS\. His structure is drawn in TradingView and kept nowhere here/,
     'she may present her computed levels as his'],
    [/Where he sends a chart, his chart decides/, 'her map can overrule the chart he sends'],
    [/EVERY FIGURE ON THE MAP HAS PRINTED, so it is a fact, and the rules for a printed level hold/,
     'the map\'s levels are not held to the printed-level rule'],
    [/nothing setup-flavoured comes off it in a message you start while he is in a position/,
     'the map can put a level beside his open position'],
    [/YOUR CALL IS BUILT ON THE MAP\. Its level is a turn or a quarter on it/,
     'her call is no longer built on his charts'],
    [/Break & Retest inside the range, Support & Resistance at its edge/,
     'her call no longer takes the setup his rules name for where the level sits'],
    [/THE MAP OF HIS CHARTS IS THE HOURS ON IT, and in the briefing it is there for your call and nothing else/,
     'the briefing may turn the map into prose, against the weeks behind his chart'],
    [/YOUR CALL, LAST, in two or three sentences, its levels off the map of his charts/,
     'the briefing\'s call slot no longer builds on the map'],
    [/With no chart, get_structure shows you the bias and where his level sits on your map, and you say it is yours/,
     'a plan he brings without a chart is judged blind, or off a map not said to be hers'],
  ]) assert.match(system, said, `SYSTEM: ${why}`);
  assert.match(critic, /Is the map of his charts in the prose\? It was handed to the writer for the call and for nothing else/,
    'CRITIC no longer takes the map out of the briefing\'s prose, and it runs last');
  assert.match(critic, /reaches him in the briefing only as the levels of the filed call/,
    'CRITIC takes the map out of the call too, and a filed call is never changed');
});

/* ─── The market around gold, in a conversation ──────────────────────────────
   The tool array and the prompt: a tool in neither is a reply that searches
   for the dollar, against the rule that it never be quoted from a search. */
test('a reply can read the market around gold, and is told to before searching for it', () => {
  const chat = EUGENIA_TS.match(/const CHAT_TOOLS = \[([\s\S]*?)\];/);
  assert.ok(chat, 'doji-eugenia no longer defines CHAT_TOOLS');
  assert.match(chat[1], /\bAROUND_TOOL\b/, 'a reply cannot read the dollar or the yields, so it searches for them');
  const tool = EUGENIA_TS.slice(EUGENIA_TS.indexOf('const AROUND_TOOL = {'));
  assert.match(tool.slice(0, tool.indexOf('} as const;')), /name: "get_around"/);
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1];
  assert.match(system, /IN A CONVERSATION, get_around READS THE SAME LINES/,
    'SYSTEM no longer tells her the conversation can read the market around gold');
  const served = EUGENIA_TS.slice(EUGENIA_TS.indexOf('case AROUND_TOOL.name:'));
  assert.match(served.slice(0, served.indexOf('case ', 5)), /headlinesBlock\(\)/,
    'the conversation no longer reads the headlines');
});

/* ─── Where the speculators stand ────────────────────────────────────────────
   The Sunday briefing and get_around carry the weekly count. A weekday briefing
   would repeat it five mornings running — an ordinary edit away, and reading as
   better informed. */
test('the speculators\' weekly count reaches the Sunday briefing and a conversation, and nothing else', () => {
  const body = (name) =>
    bodyOf(EUGENIA_TS, `async function ${name}(`, `doji-eugenia no longer has ${name}()`);
  const calls = [...EUGENIA_TS.matchAll(/(?<!function )positioningBlock\(\)/g)].length;
  assert.equal(calls, 2, `positioningBlock() is called ${calls} times — a new reader was given the weekly count`);
  assert.match(body('postBriefing'), /due === 'sunday' \? positioningBlock\(\) : ""/,
    'the weekday briefing carries the weekly count, the same lines five mornings running');
  assert.match(body('postBriefing'), /\+ rates \+ crowd \+/, 'the Sunday briefing reads the count and never hands it over');
  const served = EUGENIA_TS.slice(EUGENIA_TS.indexOf('case AROUND_TOOL.name:'));
  assert.match(served.slice(0, served.indexOf('case ', 5)), /positioningBlock\(\)/,
    'a conversation asked whether gold is crowded has nothing but a search to answer from');
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1];
  assert.match(system, /WHERE THE SPECULATORS STAND COMES ON SUNDAY AND FROM get_around/,
    'SYSTEM no longer says what the count is for, so it reads as news');
  assert.match(system.replace(/\s+/g, ' '), /rising with a move is new money arriving, and falling is one side leaving/,
    'SYSTEM no longer says what open interest tells her, so it is a number she is handed and cannot read');
  assert.match(system, /never\s+a reason to trade, and never a call on where price goes/,
    'the count lost the line that keeps it from reading as a signal');
});

/* ─── What COMEX gold futures traded ─────────────────────────────────────────
   Every briefing and get_around. The prompt keeps the broker's volume, which is
   its own clients, from standing in for the market's. */
test('futures volume reaches every briefing and a conversation', () => {
  const body = (name) =>
    bodyOf(EUGENIA_TS, `async function ${name}(`, `doji-eugenia no longer has ${name}()`);
  const calls = [...EUGENIA_TS.matchAll(/(?<!function )volumeBlock\(\)/g)].length;
  assert.equal(calls, 2, `volumeBlock() is called ${calls} times — a new reader was given the day's volume`);
  assert.match(body('postBriefing'), /volumeBlock\(\)/, 'the briefing no longer reads the futures volume');
  assert.match(body('postBriefing'), /\+ crowd \+ traded \+/, 'the briefing reads the futures volume and never hands it over');
  const served = EUGENIA_TS.slice(EUGENIA_TS.indexOf('case AROUND_TOOL.name:'));
  assert.match(served.slice(0, served.indexOf('case ', 5)), /volumeBlock\(\)/,
    'a conversation asked whether a move had volume behind it has nothing but a search to answer from');
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1].replace(/\s+/g, ' ');
  const said = system.slice(system.indexOf('WHAT COMEX GOLD FUTURES TRADED'));
  assert.ok(said.length < system.length, 'SYSTEM no longer says what the futures volume is for, so it reads as news');
  const paragraph = said.slice(0, said.indexOf('. ', said.indexOf('never a call on where price goes')) + 1);
  assert.match(paragraph, /never read volume off the broker's feed/,
    'the volume lost the line that keeps the broker\'s clients from standing in for the market');
  assert.match(paragraph, /never a reason to trade, and never a call on where price goes/,
    'the volume lost the line that keeps it from reading as a signal');
});

/* THE RATE ODDS GO TO THE BRIEFING AND A CONVERSATION, and the prompt says a
   later meeting is never a chance — the half that keeps her figure matching
   his FedWatch screen. */
test('the rate odds reach the briefing and a conversation, said the way FedWatch shows them', () => {
  const brief = bodyOf(EUGENIA_TS, 'async function postBriefing(');
  assert.equal([...EUGENIA_TS.matchAll(/(?<!function )ratesBlock\(\)/g)].length, 3,
    'ratesBlock() is called somewhere other than the briefing, get_around and the nightly pass');
  // The pass reads them as the day closed, to judge a read whose test was the
  // Fed pricing — and hands them over, or every such read files as untested.
  assert.match(uncomment(bodyOf(EUGENIA_TS, 'async function postConsolidation(')),
    /\+ record \+ around \+ rates \+/,
    'the nightly pass no longer hands over what a read is judged against');
  assert.match(brief, /aroundBlock\(\), ratesBlock\(\),/, 'the briefing no longer reads the rate odds');
  assert.match(brief, /\+ around \+ rates \+/, 'the briefing reads the rate odds and never hands them over');
  const served = EUGENIA_TS.slice(EUGENIA_TS.indexOf('case AROUND_TOOL.name:'));
  assert.match(served.slice(0, served.indexOf('case ', 5)), /ratesBlock\(\)/,
    'a conversation asked about the Fed has nothing but a search to answer from');
  const system = EUGENIA_PROMPT.match(/export const SYSTEM = `([\s\S]*?)`;/)[1];
  assert.match(system, /WHAT THE FUTURES PRICE FOR THE FED COMES IN THE BRIEFING/);
  assert.match(system, /never turn those into a chance/,
    'she may quote a later meeting as its own odds, which FedWatch does not show');
  /* AND BOTH GATES HOLD IT, because SYSTEM alone did not: the 6 October
     briefing said "a 79% chance of a quarter-point hike in December". */
  const body = (name) => EUGENIA_PROMPT.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`))[1];
  assert.match(body('LATER_MEETINGS').replace(/\s+/g, ' '), /take the percentage out and keep which way futures lean/,
    'LATER_MEETINGS no longer says what to do with a later meeting given a percentage');
  for (const gate of ['CRITIC', 'TRIM']) {
    assert.ok(body(gate).includes('${LATER_MEETINGS}'),
      `${gate} no longer checks for a later meeting given a percentage — it runs last, ` +
      `and a December chance disagrees with the FedWatch screen he checks it on`);
  }
});

/* EVERY MARKET READ CARRIES THE BOUND, AND THE SET IS DERIVED. Unbounded, a
   feed that stopped answering held a 7 October look until the platform cut
   the request at 150s. Nothing in the suite can hang a real request, so the
   reads are found by what they address — TradingView's doors, the broker's
   price, the CFTC's count — and a new one arriving without the bound fails. */
/* THE MARKET'S ADDRESSES ARE FOUND, NOT LISTED: every URL constant in the file
   is a market read but the one declared otherwise, so a door added as a fourth
   constant is held by both censuses below on the day it arrives. */
const URLS = [...EUGENIA_TS.matchAll(/^const (\w+_URL) = /gm)].map(m => m[1]);
const NOT_MARKET = ['EMBED_URL'];
const MARKET_URLS = URLS.filter(u => !NOT_MARKET.includes(u)).join('|');
const MARKET_READ = new RegExp(`await fetch\\((\`\\$\\{SB_URL\\}\\/functions\\/v1\\/doji-tradingview[^\`]*\`|` +
  `${MARKET_URLS})[\\s\\S]*?\\);`, 'g');

test('every URL constant is a market read or declared not to be one', () => {
  assert.deepEqual([...URLS].sort(), ['COT_URL', 'EMBED_URL', 'MARKET_URL', 'STRUCTURE_URL'],
    'the URL constants have changed — say whether the new one is a market read');
});

test('every market read gives up at READ_MS rather than at the platform', () => {
  const reads = [...EUGENIA_TS.matchAll(MARKET_READ)];
  assert.equal(reads.length, 4, `read ${reads.length} market fetches — the reader has gone blind, or one was added`);
  for (const { 0: call, index } of reads) {
    // Bound where it is made, or by a signal the enclosing function bounds —
    // tvRead holds its own, to name the door when it fires.
    const enclosing = EUGENIA_TS.slice(EUGENIA_TS.lastIndexOf('\nasync function ', index), index);
    assert.ok(/signal: AbortSignal\.timeout\(READ_MS\)/.test(call) ||
              (/\bsignal\b/.test(call) && /const signal = AbortSignal\.timeout\(READ_MS\)/.test(enclosing)),
      `${call.slice(0, 70)}… carries no bound — a feed that stops answering holds the caller for 150s`);
  }
});

/* A LONG DOOR ANSWERS INSIDE ITS CALLER'S BOUND, or the deadline that keeps
   what was read lands after the caller has stopped listening and keeps
   nothing. Two files, one relation: ten seconds for the boot, the sign-in and
   the wire. And every call the two doors make carries the deadline, the
   calendar check included. */
test('the two long doors answer inside READ_MS', () => {
  const tv = source('supabase/functions/doji-tradingview/index.ts');
  const ms = (src, name) => {
    const m = src.match(new RegExp(`const ${name} = ([\\d_]+);`));
    assert.ok(m, `${name} is gone`);
    return Number(m[1].replace(/_/g, ''));
  };
  assert.ok(ms(EUGENIA_TS, 'READ_MS') - ms(tv, 'DOOR_MS') >= 10_000,
    'DOOR_MS leaves less than ten seconds of READ_MS — the door answers after she has given up on it');
  for (const fn of ['readMarket', 'readRates']) {
    const body = bodyOf(tv, `export async function ${fn}(`);
    assert.match(body, /const signal = AbortSignal\.timeout\(DOOR_MS\)/, `${fn} carries no deadline`);
    const calls = [...uncomment(body).matchAll(/tvCall\(session,[\s\S]*?\)\)/g)].map(m => m[0]);
    assert.ok(calls.length >= 1, `read no tvCall in ${fn} — the reader has gone blind`);
    for (const call of calls) {
      assert.match(call, /, signal\)\)$/, `${call.slice(0, 60)}… in ${fn} is outside the deadline`);
    }
  }
});

/* EVERY MARKET READ SHE GOES WITHOUT IS A ROW, and the set is the one READ_MS
   bounds, found the same way — by what each function addresses — and held
   against a declaration, so a new read arriving without the meter fails. The
   briefing's own row reads ok either way. The calendar's read throws to
   filed() and filedWeek(), which write both outcomes. */
test('every market read she goes without writes a row', () => {
  const starts = [...EUGENIA_TS.matchAll(/^(?:export )?async function (\w+)\(/gm)];
  const readers = starts
    .map((m, i) => [m[1], EUGENIA_TS.slice(m.index, starts[i + 1]?.index)])
    .filter(([, body]) => new RegExp(`tvRead\\("|fetch\\((${MARKET_URLS})`).test(uncomment(body)));
  assert.deepEqual(readers.map(([name]) => name).sort(),
    ['headlinesBlock', 'marketQuote', 'positioningBlock', 'readTvCalendar', 'storeMarket', 'storeRates',
     'storeStructure', 'volumeBlock'],
    'the market reads have changed — declare the new one, and give it the meter');
  for (const [name, body] of readers) {
    if (name === 'readTvCalendar') continue;
    assert.match(body.slice(body.indexOf('} catch')), /await unread\(/,
      `${name}'s failure reaches the console and no row`);
  }
  // In part, too, where the door names what it did not read.
  for (const name of ['storeMarket', 'storeRates']) {
    assert.match(bodyOf(EUGENIA_TS, `export async function ${name}(`),
      /if \(answer\.missing\.length\) await unread\(/, `${name} keeps a partial read to itself`);
  }
  assert.match(bodyOf(EUGENIA_TS, 'export async function storeStructure('),
    /if \(served\.missing\.length\) \{\s*await unread\(/, 'storeStructure keeps a chart it did not read to itself');
});

/* THE MARKET IS READ AHEAD BY ONE WRITER, AND READ BACK BY EVERYONE ELSE. A
   briefing that reads TradingView itself pays for it out of its own clock, as
   on 13 and 14 October; a second writer to the store races the market's
   read-then-write. The census above catches a block reading the door again;
   this holds the job's half and the store's one way in. */
test('the quarter-hourly job reads the market ahead, and nothing else writes the copy', () => {
  const run = bodyOf(EUGENIA_TS, 'async function postScheduled(');
  const door = run.slice(run.indexOf('get("calendar") === "1"'));
  assert.match(door.slice(0, door.indexOf('return json')),
    /await filed\(\);\s*await Promise\.all\(\[storeMarket\(\), storeRates\(\), storeStructure\(\)\]\);/,
    'the quarter-hourly job no longer reads the market ahead, so every copy goes stale');
  for (const name of ['aroundBlock', 'ratesBlock', 'structureBlock']) {
    assert.match(bodyOf(EUGENIA_TS, `export async function ${name}(`), /readStored\("/,
      `${name} no longer reads the copy the job keeps`);
  }
  assert.equal([...uncomment(EUGENIA_TS).matchAll(/eugenia_market\?/g)].length, 2,
    'eugenia_market is addressed somewhere other than readStored and store');
  const writers = [...uncomment(EUGENIA_TS).matchAll(/await store\("(\w+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(writers, ['market', 'rates', 'structure'], 'the copy has a writer other than the job\'s three');
});

test('the calendar is filed before the briefing reads it, and every filing is a row', () => {
  /* A briefing that reads before it files hands her yesterday's calendar. */
  const body = (name) =>
    bodyOf(EUGENIA_TS, `async function ${name}(`, `doji-eugenia no longer has ${name}()`);
  const brief = body('postBriefing');
  /* AND ON A SUNDAY THE WEEK, which the nightly pass files five hours after the
     one briefing about it. */
  const files = brief.search(/await \(due === 'sunday' \? filedWeek\(weekOf\(new Date\(\)\)\) : filed\(\)\)/);
  assert.ok(files > -1, 'the briefing no longer files the week on a Sunday and the day otherwise');
  for (const read of ['calendarBlock()', 'weekBlock()']) {
    assert.ok(brief.indexOf(read) > files, `the briefing reads ${read} before it files it`);
  }
  const run = body('filed');
  assert.equal((run.match(/recordRun\(\{ caller: 'calendar'/g) ?? []).length, 2,
    'the filing no longer records both outcomes — a calendar that stopped moving looks like a quiet week');
});

/* ─── The shape rules, and the critic's second copy of each ──────────────────
   `CRITIC` runs LAST, so a rule tightened for the writer and left out of the
   critic is removed again every morning. Each pair breaks silently.
   ─────────────────────────────────────────────────────────────────────────── */

test('the writing rules are stated once and read by all three', () => {
  /* ONE IDEA PER SENTENCE IS THE RULE THE REST RESTS ON: word CHOICE bounded and
     the SENTENCE not, a message of plain words still reads as hard. `WRITING`
     is the one source — SYSTEM writes to it, CRITIC and TRIM check against it —
     and a reader that stops interpolating it still has a prompt and still
     sends, from an older idea of how she writes. */
  assert.match(EUGENIA_PROMPT, /export const WRITING = `/,
    'the writing rules are no longer stated in one place');
  for (const reader of ['SYSTEM', 'CRITIC', 'TRIM']) {
    const at = EUGENIA_PROMPT.indexOf(`export const ${reader} = \``);
    assert.ok(at > -1, `${reader} is gone`);
    const body = EUGENIA_PROMPT.slice(at, EUGENIA_PROMPT.indexOf('`;', at));
    assert.match(body, /\$\{WRITING\}/,
      `${reader} no longer reads WRITING, so it is working from its own older ` +
      `idea of how she writes and nothing says the three have parted`);
  }
});

test('the number budget is stated to the writer and to the critic, and is one budget', () => {
  // Nothing bounded these before. Fourteen true figures is a page he skims.
  const writer = EUGENIA_PROMPT.match(/(\w+) TO (\w+) NUMBERS IN THE WHOLE BRIEFING/);
  assert.ok(writer, 'the writer is no longer given a number budget');
  const critic = EUGENIA_PROMPT.match(/HOW MANY NUMBERS ARE IN IT\? (\w+) to (\w+) for a briefing/);
  assert.ok(critic, 'the critic no longer counts them, so the budget is advisory');
  /* ONE BUDGET IN TWO COPIES. The critic runs last and cuts to its own, so a
     writer told fewer is rewritten back up to the old count. */
  assert.deepEqual(critic.slice(1).map(w => w.toLowerCase()), writer.slice(1).map(w => w.toLowerCase()),
    'the writer and the critic hold different number budgets, and the critic runs last');
});

test('the briefing opens on the weeks, in the writer and in the critic', () => {
  /* THE SCALE IS STATED TWICE, because the critic runs last and rewrites: a
     writer told to open on the big picture under a critic that tests the opening
     for today's move is put back on the overnight move every morning. And the
     handed quote is said to be for knowing, not for opening on. */
  const flat = (name) => EUGENIA_PROMPT.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`))[1]
    .replace(/\s+/g, ' ');
  const system = flat('SYSTEM');
  const critic = flat('CRITIC');
  assert.match(system, /WHERE THE BIG PICTURE STANDS\. .*?weeks and months/,
    'the briefing\'s first slot no longer opens on the forces that move gold over weeks');
  assert.match(system, /not to open on: a night's move is noise against the weeks/,
    'the handed quote reads as the opening again, which puts the overnight move first');
  assert.match(critic, /Does the first sentence say where the big picture stands today\? .*?weeks and months/,
    'the critic no longer checks the opening for the big picture, and it runs last');
  assert.match(critic, /the overnight move, the session's range or an hour's swing is the wrong scale/,
    'the critic no longer names the opening it replaces, so it can keep one');
});

test('a word count never stands without what to cut instead: the briefing\'s two copies and the review', () => {
  /* A CEILING ON ITS OWN CUTS THE TEACHING, the longest thing on the page. The
     count is safe only beside what to cut INSTEAD, so a copy holding the count
     alone reproduces that. The review's teaching is its verdict and its one
     thing to keep and one to change. */
  const writer = EUGENIA_PROMPT.slice(0, EUGENIA_PROMPT.indexOf('export const CRITIC'));
  const critic = EUGENIA_PROMPT.slice(EUGENIA_PROMPT.indexOf('export const CRITIC'));
  for (const [who, half] of [['writer', writer], ['critic', critic]]) {
    assert.match(half, /250 to 300 words/, `the ${who} has lost the word count`);
    assert.match(half, /[Nn]ever the teaching block|NOT A PLACE YOU CUT|never out of the block/,
      `the ${who} holds a word count with nothing saying what to cut instead — ` +
      `which is the arrangement that stopped her teaching the first time`);
  }
  const review = REVIEW.replace(/\s+/g, ' ');
  assert.match(review, /Under two hundred and fifty words/, 'the review has lost its word count');
  assert.match(review, /THE VERDICT ON THE WEEK AND THE ONE THING TO KEEP AND ONE TO CHANGE ARE NOT PLACES YOU CUT/,
    'the review holds a word count with nothing saying what to cut instead');
});

test('the gold-against-real-yields chain is exempt from the rung, in both copies', () => {
  /* THE ONE PLACE THE LADDER IS OVERRIDDEN, in both: the critic decides whether
     a mechanism inside one briefing is a repetition, and this chain is under
     nearly every briefing. */
  // WHITESPACE-COLLAPSED: the prompt is hard-wrapped and a phrase splits across
  // lines.
  const flat = at => EUGENIA_PROMPT.slice(...at).replace(/\s+/g, ' ');
  const cut = EUGENIA_PROMPT.indexOf('export const CRITIC');
  for (const [who, half] of [['writer', flat([0, cut])], ['critic', flat([cut])]]) {
    assert.match(half, /once inflation is taken out/,
      `the ${who} no longer names the chain that is never assumed`);
    assert.match(half, /exempt from the map|map does not apply/,
      `the ${who} does not say the rung is overridden for it, so at \`owns\` it ` +
      `gets used bare and the one load-bearing mechanism goes unsaid`);
  }
});

test('no term is used bare, and the test is whether the name explains itself', () => {
  /* SELF-DESCRIBING, NOT UNCOINED. "No coined shorthand" forbade "the genuine
     part", which is the register wanted; "the leftover" tells a reader nothing.
     The real failure is a MARKET term used bare: "the war premium". */
  const flat = EUGENIA_PROMPT.replace(/\s+/g, ' ');
  assert.match(flat, /NO TERM USED BARE/,
    'a term may be used with no gloss again, which is what "war premium" was');
  assert.match(flat, /explains itself|EXPLAINS ITSELF/,
    'the self-describing test is gone, so the rule is back to banning the ' +
    'register his own draft is written in');
  assert.match(flat, /A MARKET TERM IS THE CASE THIS ACTUALLY FAILS ON/,
    'nothing names the case that actually recurs — an invented word is rare, ' +
    'a market term used bare is every briefing');
  assert.match(EUGENIA_PROMPT, /NO PUNCHLINES/,
    'the no-punchline rule is gone, so a paragraph may close on a line that ' +
    'sounds good and takes a second to decode');
});

test('the rules carry a worked example, because no description of them worked', () => {
  /* A GATE CAN COUNT WORDS; IT CANNOT ADJUDICATE "THE PLAINEST WORD" against an
     adjective, and a model matches an example where it ignores a description.
     In WRITING, so the writer and both gates read the same one. */
  const at = EUGENIA_PROMPT.indexOf('export const WRITING = `');
  const body = EUGENIA_PROMPT.slice(at, EUGENIA_PROMPT.indexOf('`;', at));
  assert.match(body, /THIS IS THE STANDARD/,
    'the worked example is gone from WRITING — the rules are back to describing ' +
    'a register rather than showing one, which is what produced "dearer fuel"');
  assert.match(body, /the genuine part/,
    'the example no longer carries the chain it exists to demonstrate');
  assert.match(body, /A PARAGRAPH IS THREE OR FOUR SENTENCES/,
    'nothing bounds a paragraph, so sixteen easy sentences arrive in one block ' +
    'with nowhere to breathe — which is how a briefing of short sentences still ' +
    'reads as a wall');
});

/* ─── verify.sql is one statement, and diagnose.sql is where the rest went ────
   An editor shows the LAST statement's result only, so listings below the
   summary throw every check away. The summary cannot go last instead: three
   listings can RAISE (`cron.job`, `net._http_response`, a public table), and
   a raise takes every statement after it. Two files, each last in its own.
   The regression is one appended `select`, and it is silent.
   ─────────────────────────────────────────────────────────────────────────── */

test('verify.sql runs exactly one statement, so the editor shows the checks', () => {
  const sql = source('supabase/verify.sql');

  /* Comments first, then strings: an apostrophe in a comment desynchronises
     quote matching. */
  const bare = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");

  const statements = (bare.match(/;/g) || []).length;
  assert.equal(statements, 1,
    `verify.sql holds ${statements} statements — a SQL editor shows the last one, ` +
    `so every check above it is run and thrown away. The extra one belongs in ` +
    `diagnose.sql`);
});

test('the listings still exist, in the file that can afford to raise', () => {
  // Deleting them instead of moving them would pass the test above and lose the
  // eye pass — the thing you reach for at the moment a check says false.
  const diag = source('supabase/diagnose.sql');
  for (const read of ['cron.job', 'net._http_response', 'information_schema.columns']) {
    assert.ok(diag.includes(read),
      `diagnose.sql no longer reads ${read}, so "which schedule, which column" ` +
      `has no answer anywhere`);
  }
});

/* ─── One model per caller, and the map is keyed on a free-text label ────────
   Measured cost decided it. THE MAP IS KEYED ON A STRING NOTHING CHECKS: a key
   no caller uses silently never applies, and that caller runs on the default
   — correct, at the price the change was made to stop paying.
   ─────────────────────────────────────────────────────────────────────────── */

test('every model the map names belongs to a caller that exists', () => {
  const labels = new Set([
    ...[...EUGENIA_TS.matchAll(/ask\([\s\S]{0,400}?'(?:high|medium|low)',\s*'([^']+)'/g)]
        .map(m => m[1]),
    // The briefings are the one label built rather than written: `${due} briefing`.
    ...[...EUGENIA_TS.matchAll(/\$\{due\} briefing/g)].map(() => 'weekday briefing'),
    // AND THE TWO THAT REACH ask() THROUGH gate(), whose labels are arguments.
    ...[...EUGENIA_TS.matchAll(/gate\([\s\S]{0,200}?,\s*'([^']+)'(?:,\s*\w+)?\)/g)].map(m => m[1]),
  ]);
  assert.ok(labels.size >= 5,
    `only ${labels.size} caller labels read out of the file — the reader has gone blind`);

  const map = EUGENIA_TS.slice(EUGENIA_TS.indexOf('const MODELS: Record<string, string> = {'));
  const keyed = [...map.slice(0, map.indexOf('};')).matchAll(/'([^']+)':\s*(OPUS|SONNET)/g)]
    .map(m => m[1]);
  assert.ok(keyed.length > 0, 'the model map is empty or no longer readable from here');

  for (const key of keyed) {
    assert.ok(labels.has(key),
      `the model map names '${key}' and nothing calls ask() with that label — ` +
      `that caller runs on the default, which is the expensive one, silently`);
  }
});

test('no caller that runs a tool loop is on the cheaper model', () => {
  /* A TOOL-LOOPING CALLER STAYS ON THE DEFAULT. The release look, since retired,
     died on Sonnet at MAX_ROUNDS twice in half an hour; whether the model or a
     new tool spent the rounds is confounded, and the policy needs
     neither answer: a cheaper caller that does not answer is not cheaper.
     `trim` is handed `CRITIC_TOOLS`, which is empty, so it has no loop to run
     out of — the shape a cheaper model is safe on. A caller added with a
     non-empty array looks correct in every test until the morning a print
     lands. */
  const map = EUGENIA_TS.slice(EUGENIA_TS.indexOf('const MODELS: Record<string, string> = {'));
  const keyed = [...map.slice(0, map.indexOf('};')).matchAll(/'([^']+)':\s*SONNET/g)]
    .map(m => m[1]);

  /* RESOLVED, because a label reaches ask() two ways: beside its array, or
     through gate(). */
  const arrayFor = (label) => {
    const direct = EUGENIA_TS.match(
      new RegExp(`ask\\([\\s\\S]{0,400}?'(?:high|medium|low)',\\s*'${label}',\\s*(\\w+)`));
    if (direct) return direct[1];
    // Through gate(): its own ask() names the array every caller of it gets.
    if (new RegExp(`gate\\([\\s\\S]{0,200}?'${label}'(?:,\\s*\\w+)?\\)`).test(EUGENIA_TS)) {
      const at = EUGENIA_TS.indexOf('async function gate(');
      return EUGENIA_TS.slice(at).match(/'medium', label, (\w+)/)?.[1];
    }
    return null;   // named by nothing the reader knows — never silently fine
  };

  for (const label of keyed) {
    assert.equal(arrayFor(label), 'CRITIC_TOOLS',
      `'${label}' is on the cheaper model with a tool array that is not empty — ` +
      `that is what killed the release look twice in half an hour, and it fails ` +
      `as an apology rather than as anything a test could see`);
  }
});

test('the round cap is a backstop rather than a working limit', () => {
  const at = EUGENIA_TS.indexOf('const MAX_ROUNDS =');
  const value = Number(EUGENIA_TS.slice(at).match(/const MAX_ROUNDS = (\d+)/)?.[1]);
  assert.ok(value >= 10,
    `MAX_ROUNDS is ${value} — at six a release look that searched, fetched and ` +
    `searched again ran out twice in half an hour, and the caller died rather ` +
    `than answered`);
});

test('the critic is not among them, and that is the decision', () => {
  /* THE CRITIC STAYS: about $2 a month saved, against the gate that runs
     LAST, can rewrite, and judges the thing he said read badly. */
  const map = EUGENIA_TS.slice(EUGENIA_TS.indexOf('const MODELS: Record<string, string> = {'));
  const body = map.slice(0, map.indexOf('};'));
  for (const judging of ['critic', 'consolidation', 'reply', 'trade look', 'briefing']) {
    assert.doesNotMatch(body, new RegExp(`'${judging}'`),
      `'${judging}' has been moved off Opus — it decides something open rather ` +
      `than checking something bounded, and nothing here can see the quality it costs`);
  }
});

test('the refusal fallback rides only with the model it is proven on', () => {
  /* CAUTION, NOT A RULE. Whether Sonnet accepts `fallbacks` is unestablished,
     and a refusal would be a 400 on every call of three scheduled callers. The
     header and the field are gated together, each a 400 alone. */
  const at = EUGENIA_TS.indexOf('async function call(');
  const body = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('\n  if (!res.ok)', at));
  assert.match(body, /\.\.\.\(model === OPUS\s*\n?\s*\?\s*\{ "anthropic-beta": "server-side-fallback/,
    'the fallback beta header is sent on every model, so a model that refuses ' +
    'the header 400s on every call it makes');
  assert.match(body, /\.\.\.\(model === OPUS \? \{ fallbacks: "default" \} : \{\}\)/,
    'the fallbacks field is sent on every model, or is no longer sent at all — ' +
    'the header and the field are a pair and either alone is a 400');
});

test('the effort a caller asks for is the one it runs at, and the top of every Opus request is one value', () => {
  /* THE PREFIX IS SHARED ONLY IF THE TOP IS ONE VALUE, and the caller still
     runs at its own effort only if the message carries it — with the beta
     header beside it, or the message is a 400 on every call. */
  const at = EUGENIA_TS.indexOf('async function call(');
  const body = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('\n  if (!res.ok)', at));
  assert.match(body, /messages: effortMessages\(messages, effort, model\)/,
    'the conversation is sent without the caller\'s effort, so every Opus caller runs at the top one');
  assert.match(body, /output_config: \{ effort: model === OPUS \? BASE_EFFORT : effort \}/,
    'the top-level effort varies by caller again, so each writes its own copy of the prefix');
  assert.match(body, /model === OPUS\s*\n?\s*\?\s*\{ "anthropic-beta": "[^"]*mid-conversation-output-config-2026-07-01/,
    'the effort message is sent without its beta header, a 400 on every Opus call');
});

/* ─── The gate reaches every message she composes ────────────────────────────
   The briefing has the critic and every reply has TRIM, and the writing rules
   answer for both.

   THE TRADE EVENT STAYS OUT, because TRIM REWRITES. It reaches a man in a
   position or past his day, where a gate paraphrasing a citation of his rule
   is how a sentence becomes an order. Both branches decide whether to speak
   before any model call, and TRADE_EVENT is the most constrained prompt in the
   file — almost nothing TRIM checks is reachable in two sentences.
   ─────────────────────────────────────────────────────────────────────────── */

/* THE CENSUS, BECAUSE EVERY OTHER CHECK HERE IS VERTICAL — one fact each,
   deeply. The HORIZONTAL fault is several paths that should do comparable things,
   one missing a step. So the table is derived from the source and compared
   with a declaration: a new path that sends fails until someone writes down
   its gate and what it carries. An exemption is a row with a reason in it,
   never an absence. */
const SENDS = {
  postBriefing:   { gate: 'critique', carries: 'brief' },
  postSpeak:      { gate: null,       carries: 'turn.content',
                    why: 'the briefing\'s second worker: what it speaks is the ' +
                         'text critique() returned and postBriefing stored, read ' +
                         'back by its marker — a gate here would be a second ' +
                         'rewrite of a message already checked, and would make ' +
                         'what he hears differ from what she remembers',
                    stored: 'by postBriefing, before the hand-off — this reads ' +
                            'the stored turn rather than writing one' },
  charmBriefing:  { gate: null,       carries: 'turn.content', aloud: 'charmAudio',
                    why: 'the briefing read back on the charm, as postSpeak ' +
                         'reads it: the text critique() returned and ' +
                         'postBriefing stored, so the charm says exactly what ' +
                         'Telegram received',
                    stored: 'by postBriefing — this reads the stored turn ' +
                            'rather than writing one' },
  postReview:     { gate: 'trim',     carries: 'review' },
  handleMessage:  { gate: 'trim',     carries: 'answer', through: 'converse' },
  hearCharm:      { gate: 'trim',     carries: 'answer', through: 'converse',
                    copy: 'the charm speaks what this returns, through ' +
                          'charmAudio — the voice goes to his keyring, so ' +
                          'Telegram is sent the text as its copy, not a ' +
                          'second voice note of a thing he has just heard. ' +
                          'It returns the volume she set beside the text, and ' +
                          'the battery line the door may add after it is the ' +
                          "charm's news, neither copied nor stored" },
  postTradeEvent: { gate: null,       carries: 'said',
                    why: 'TRIM REWRITES, and this one reaches a man who is ' +
                         'in a position or has just breached his day — the ' +
                         'single thing that must not happen here is a gate ' +
                         'paraphrasing a citation of his rule into an order. ' +
                         'TRADE_EVENT is the most constrained prompt in the ' +
                         'file: two sentences, the fact then the rule, no ' +
                         'greeting, and NOTHING as an explicit way out, so ' +
                         'almost nothing TRIM checks is even reachable' },
};

test('every path that sends him something is in the census', () => {
  // A path that speaks, or one that takes a turn of conversation — the charm
  // speaks through charmAudio rather than sayAloud, and is still a path that sends.
  const fns = [...EUGENIA_TS.matchAll(/^(?:export )?async function (\w+)/gm)]
    .map(m => [m[1], m.index]);
  const sending = fns.filter(([, at]) => {
    const end = EUGENIA_TS.indexOf('\n}\n', at);
    return /await sayAloud\(|= await converse\(|charmAudio\(/.test(EUGENIA_TS.slice(at, end === -1 ? undefined : end));
  }).map(([name]) => name).sort();

  assert.deepEqual(sending, Object.keys(SENDS).sort(),
    'a path sends him something and is not in the census, or a censused one no ' +
    'longer sends — the census is what makes a missing gate visible, and it can ' +
    'only see paths it knows about');
});

test('every censused path gates, speaks and stores the same one text', () => {
  for (const [fn, spec] of Object.entries(SENDS)) {
    const at = EUGENIA_TS.indexOf(`async function ${fn}(`);
    assert.ok(at > -1, `doji-eugenia no longer has ${fn}()`);
    const body = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('\n}\n', at));

    if (spec.gate) {
      /* THROUGH THE SHARED TURN: the gate runs in `converse`, and the path must
         send what came back from it rather than a draft of its own. */
      const gated = spec.through ? bodyOf(EUGENIA_TS, `async function ${spec.through}(`) : body;
      assert.match(gated, new RegExp(`${spec.carries} = await ${spec.gate}\\(`),
        `${spec.through ?? fn} no longer binds what ${spec.gate}() returned — an ungated ` +
        'message still arrives and still reads correctly, and is simply back ' +
        'to being unchecked');
      if (spec.through) {
        assert.match(gated, new RegExp(`return \\{[^}]*\\b${spec.carries}\\b(?!\\s*:)[^}]*\\};`),
          `${spec.through}() no longer hands back the text its gate returned`);
        assert.match(body, new RegExp(`\\b${spec.carries}\\b[^=;]*= await ${spec.through}\\(`),
          `${fn} no longer sends what ${spec.through}() returned, so the gate ` +
          'it runs checks a message he never receives');
      }
    } else {
      assert.ok(spec.why, `${fn} is exempt from the gate with no reason written down`);
      assert.doesNotMatch(body, /await (trim|critique)\(/,
        `${fn} is declared exempt from the gate and now runs one`);
    }

    if (spec.aloud) {
      assert.match(body, new RegExp(`${spec.aloud}\\([^;]*\\b${spec.carries.replace('.', '\\.')}\\b`),
        `${fn} no longer speaks through ${spec.aloud} the text the census says it carries`);
    } else if (spec.copy) {
      // Spoken by whoever it returns to, and copied to Telegram as text.
      assert.match(body, new RegExp(`return (?:${spec.carries}|\\{[^}]*\\b${spec.carries}\\b(?!\\s*:)[^}]*\\});`),
        `${fn} no longer hands back the text the census says it carries`);
      assert.match(body, new RegExp(`\\bsay\\([^;]*\\b${spec.carries}\\b`),
        `${fn} no longer copies to Telegram the text it sends`);
    } else {
      const spoken = body.match(/await sayAloud\([\s\S]*?\);/);
      assert.ok(spoken, `${fn} no longer speaks at all`);
      assert.match(spoken[0], new RegExp(`\\b${spec.carries}\\b`),
        `${fn} speaks something other than the text the census says it carries`);
    }
    if (spec.stored) continue;
    assert.match(body, new RegExp(`role: 'assistant', content: ${spec.carries}\\b`),
      `${fn} stores a text other than the one it sent — her history then holds ` +
      'words he never read, resent as hers for the next six exchanges');
  }
});

test('the two gates share the half that makes a gate safe', () => {
  /* ONE GATE: a revision failing `keepDraft` is overruled, and a gate that THROWS
     costs nothing. A copied catch is where one gate loses its message on the day
     a vendor is slow. */
  const body = bodyOf(EUGENIA_TS, 'async function gate(', 'the shared gate body is gone, so each gate holds its own copy');

  /* THE FIRST RETURN IN EACH BRANCH, not a character window, which measures the
     branch's length. */
  const firstReturn = (from) => {
    const i = body.indexOf(from);
    return i < 0 ? null : (body.slice(i).match(/return [^;]+;/) ?? [])[0];
  };
  assert.equal(firstReturn('if (keepDraft(draft, revised, most))'), 'return draft;',
    'a gate no longer overrules a failed revision, so a critic that returns an ' +
    'apology sends the apology');
  assert.equal(firstReturn('} catch'), 'return draft;',
    'a gate that throws no longer falls back to the draft, so a slow vendor ' +
    'costs the message rather than the check');
});

/* ─── And what the gate decided is a row ─────────────────────────────────────
   Revised, unchanged and overruled are three different repairs, and `ask`
   records only that the gate RAN. One verdict per gated message on every
   outcome, each bounded at the previous `return`: a path is credited only with
   its own mark. */

test('every message a gate decides leaves one verdict row, on all three outcomes', () => {
  const body = bodyOf(EUGENIA_TS, 'async function gate(');
  assert.match(body, /const caller = `\$\{label\} verdict`;/,
    'the verdict is no longer filed under the gate\'s own label, so a query ' +
    'for what TRIM decided cannot be told from one for what CRITIC decided');

  const returns = [...body.matchAll(/return [^;]+;/g)];
  assert.equal(returns.length, 3,
    `gate has ${returns.length} returns — each outcome is one, and a fourth is ` +
    `an outcome this check cannot see`);
  let from = 0;
  for (const r of returns) {
    assert.match(body.slice(from, r.index), /await recordRun\(\{ caller,/,
      `gate reaches \`${r[0]}\` without recording what it decided, so that ` +
      `outcome is the one the table can never show`);
    from = r.index + r[0].length;
  }
  assert.match(body.slice(body.indexOf('} catch')), /recordRun\(\{ caller, ok: false/,
    'a gate that threw records itself as fine, which is the one outcome the ' +
    'verdict has to be able to say');
});

test('keepDraft is relative, because it reads short replies', () => {
  /* NO FLAT FLOOR: a short reply is often under four hundred characters, and a
     gate overruled every time looks exactly like one that agreed. */
  assert.doesNotMatch(EUGENIA_TS, /CRITIC_FLOOR/,
    'the absolute floor is back, so the gate on a short reply is paid for and ' +
    'overruled on every message it ever checks');
  assert.match(EUGENIA_TS, /t\.length < draft\.length \/ 3/,
    'keepDraft no longer scales with the draft it is judging');
  /* AND TRIM'S CEILING IS ITS OWN, held at the call: without it the fallback is
     twice the draft. */
  assert.match(bodyOf(EUGENIA_TS, 'async function trim('), /'trim', TRIM_MOST\)/,
    'TRIM is judged by the critic\'s ceiling again, so its notes on a message can reach him with it');
});

/* ─── Which model ran ────────────────────────────────────────────────────────
   "How many rounds does THIS model need on THIS caller" needs the model on the
   row. A schema check sees the column; the half it cannot see is NOTHING
   WRITING IT — every row lands and the column reads null for ever.
   ─────────────────────────────────────────────────────────────────────────── */

test('every run row records the model that answered it', () => {
  const calls = [...EUGENIA_TS.matchAll(/recordRun\(\{([\s\S]*?)\}\)/g)]
    .map(m => m[1])
    // ask()'s one, which files the turn that finished and the turn that threw.
    // The briefing marker and the two sweep meters write no model because they
    // make no call.
    .filter(body => /in_tokens/.test(body));
  assert.equal(calls.length, 1,
    `${calls.length} recordRun call sites carry token counts where one should — ` +
    `the reader has gone blind, or a second model call is recording nothing`);

  for (const body of calls) {
    assert.match(body, /\bmodel\b/,
      'a model call is recorded without naming the model that served it, so the ' +
      'column reads null for ever and the question it exists for is still unanswerable');
  }
});

/* ─── A swipe-reply, looked up the way each message was stored ───────────────
   Every message but the briefing is stored after it is sent, so its turn is
   the first after the voice note; the briefing is stored before. The backward
   look runs only when the forward one finds nothing — asked first, it names
   the briefing under a reply to the answer that followed it.
   ─────────────────────────────────────────────────────────────────────────── */

test('a swipe-reply looks forward first and back for the briefing only after', () => {
  const at = EUGENIA_TS.indexOf('async function handleMessage(');
  assert.ok(at > -1, 'doji-eugenia no longer has handleMessage()');
  const body = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('\n}\n', at));
  const forward = body.indexOf('repliedQuery(replied.date)');
  const back = body.search(/turn\?\.content \?\? spokenBriefing\(await readRows[\s\S]{0,120}spokenQuery\(replied\.date\)/);
  assert.ok(forward > -1, 'a reply to a voice note no longer looks for the message it answers');
  assert.ok(back > forward,
    'a reply to the briefing looks only forward from the voice note, and the ' +
    'briefing is the one message stored before it is sent — so it is never found');
});

/* ─── The reply gate holds no length ─────────────────────────────────────────
   A reply's length is whatever the answer needs, and `keepDraft` only refuses
   a revision under a third of the draft — so a sentence count in TRIM cuts a
   nine-finding plan check to that count. */

test('the reply gate does not hold a reply to a fixed length', () => {
  const trim = EUGENIA_PROMPT.match(/export const TRIM = `([\s\S]*?)`;/)?.[1].replace(/\s+/g, ' ');
  assert.ok(trim, 'prompt.ts no longer exports TRIM');
  assert.match(trim, /A REPLY IS AS LONG AS WHAT HE ASKED NEEDS/,
    'TRIM no longer says a reply is as long as it needs, and it gates every reply');
  assert.doesNotMatch(trim, /two or three sentences/,
    'TRIM holds a reply to two or three sentences, which cuts a plan check short');
});

/* ─── The trade look is told what happened, not a state that may be false ────
   On a close that took his day past R-11 he may hold nothing at all. */

test('the trade look does not tell her he is in a position on a close', () => {
  const body = EUGENIA_PROMPT.match(/export const TRADE_EVENT = `([\s\S]*?)`;/)?.[1].replace(/\s+/g, ' ');
  assert.ok(body, 'prompt.ts no longer exports TRADE_EVENT');
  assert.doesNotMatch(body, /He is in a position while reading this/,
    'TRADE_EVENT tells her he is in a position, and it is also sent after a close');
  assert.match(body, /He has just closed a position/,
    'TRADE_EVENT no longer says what it is sent about');
});
