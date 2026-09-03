/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the copies that have to agree
   ───────────────────────────────────────────────────────────────────────────
   Four runtimes, no build step, and facts that consequently live in more than
   one file: the setups vocabulary, the four journal column names, Eugenia's
   note limit and note kinds, and the names of the functions themselves.

   TWO CHECKS HERE ARE NOT ABOUT COPIES, and they are here because there is
   nowhere better: each function's boot guard against the secrets it reads, and
   `notesBlock()` against the three paths that must call it. Both are one file
   read against itself rather than two files read against each other — what they
   share with the rest is the shape of the failure, which is silence.

   Copies are not the problem. Copies NOTHING CAN COMPARE are, and that is what
   this closes. Every one of these values was already tested — and every one of
   those tests asserted against a literal typed into the test file beside it, so
   an editor changing a list and its own test in one pass left the other copy
   untouched and the suite green.

   Nothing here needs a build step or a running database. The app is read off
   disk by the same harness the render tests use, the function exports import
   directly, and the constraint is a line of text in a file.

   WHAT THIS CANNOT SEE: the live database. trades_setup_check is asserted as
   001_trades.sql declares it, not as Postgres holds it, so a constraint edited
   by hand in the SQL editor would pass here. supabase/verify.sql is where that
   is caught, and it is a query a person runs rather than something a suite can
   reach.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { boot } from './boot.mjs';
import { SETUPS, COLUMNS } from '../supabase/functions/doji-gladys/index.ts';
import { ALWAYS, SECTIONS, VERSION } from '../supabase/functions/doji-eugenia/strategy.ts';
import { readStrategy, SAID, LOOP_KINDS, THESIS_MAX, parseFeedback, feedbackKeyboard, EMBED_DIMS }
  from '../supabase/functions/doji-eugenia/index.ts';
import { CONSOLIDATE } from '../supabase/functions/doji-eugenia/prompt.ts';

const SCHEMA = readFileSync(new URL('../supabase/001_trades.sql', import.meta.url), 'utf8');
const GLADYS_SQL = readFileSync(new URL('../supabase/002_gladys.sql', import.meta.url), 'utf8');
const EUGENIA_SQL = readFileSync(new URL('../supabase/003_eugenia.sql', import.meta.url), 'utf8');
const SENSES_SQL = readFileSync(new URL('../supabase/005_eugenia_senses.sql', import.meta.url), 'utf8');
const CRON_SQL = readFileSync(new URL('../supabase/004_cron.sql', import.meta.url), 'utf8');
const SEMANTIC_SQL = readFileSync(new URL('../supabase/007_semantic.sql', import.meta.url), 'utf8');
const EUGENIA_TS = readFileSync(
  new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
const EUGENIA_PROMPT = readFileSync(
  new URL('../supabase/functions/doji-eugenia/prompt.ts', import.meta.url), 'utf8');

// The functions as the DIRECTORY holds them, not as a list typed here: the two
// tests below both need it, and a fifth function added to one copy and not the
// other is the same defect this file exists to catch.
const DEPLOYED = readdirSync(new URL('../supabase/functions', import.meta.url),
  { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name).sort();

const FUNCTIONS = DEPLOYED.map(name => ({ name, text: readFileSync(
  new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8') }));

/* The vocabulary as Postgres will enforce it, read out of the constraint rather
   than out of a comment near it. Deliberately anchored on the constraint NAME:
   a check written against some other column would not be this rule, and a
   pattern that just hunted for quoted strings in the file would find the
   direction vocabulary as happily as this one. */
function setupsInSchema() {
  const line = SCHEMA.match(/constraint\s+trades_setup_check\s+check\s*\(([^)]*)\)/i);
  assert.ok(line, 'trades_setup_check is not in 001_trades.sql at all');
  return [...line[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

// The journal columns as the table declares them, so a rename in the schema is
// caught rather than discovered by a write that silently does nothing.
const declaresColumn = (name) =>
  new RegExp(`^\\s*${name}\\s+(text|boolean)\\b`, 'mi').test(SCHEMA);

/* ─── Eugenia's view, and the README's copy of it ────────────────────────────
   The README quotes the whole `create or replace view` statement, because 003
   starts with a CREATE TABLE and stops there on a database that already has the
   tables — so re-applying the view means running that statement on its own, and
   the README is where a person reads it from.

   That makes the select list a fact in two files with nothing between them. A
   column added to 003 and not to the README leaves the documented statement
   building a view WITHOUT it, and running the documented one is the whole point
   of quoting it: the reader would be handed a view missing the column they came
   to add. Compared as a list rather than as text, so reformatting is free and
   only the columns matter.
   ───────────────────────────────────────────────────────────────────────── */
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

/* EVERY COPY IN THE README, NOT THE FIRST ONE. It states this view twice — as
   the statement an existing database runs on its own, and again inside the
   migration that drops the view and rebuilds it — and a plain `match` reads
   only the one at the top. The second is the copy that runs immediately after a
   `drop view`, so a stale column list there rebuilds the wrong view on a
   database that has just lost the right one, which is the worst moment for it. */
/* THE LAST DEFINITION APPLIED IS THE ONE THE DATABASE HOLDS, and there is more
   than one now. 003 creates the view; 006 replaces it to append the plan. A
   reader — or a test — anchored on 003 would be describing a view that has not
   existed since 006 ran, which is the same class of wrongness this whole file
   exists to catch.

   So the numbered files are read in order and the LAST statement wins, exactly
   as Postgres resolves it. Nothing needs editing here when a future file
   appends another column; the file simply joins the list. */
// Read from the directory rather than from TRACKED, which is defined further
// down this file — nothing may reference anything below it at load time.
const NUMBERED = readdirSync(new URL('../supabase', import.meta.url))
  .filter(f => /^\d{3}_.*\.sql$/.test(f))
  .sort()
  .map(f => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8'))
  .join('\n');

const servedView = () => {
  const all = viewColumns(NUMBERED, 'the numbered SQL files');
  return all[all.length - 1];
};

test('every eugenia_trades view the README states is the one the SQL ends with', () => {
  const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const cols of viewColumns(README, 'README.md')) {
    assert.deepEqual(cols, servedView(),
      'the README quotes a view with a different column list than the numbered SQL ' +
      'ends up with — following the README would build the wrong view');
  }
});

/* ─── What §8 says she holds, against what the view hands her ────────────────
   §8 is the section she is told to read before producing any number, and its
   first paragraph is the inventory of a row. For five versions it named four
   columns the view does not serve — she followed its monthly instruction against
   `net_pnl` and summed a column that was not there.

   THE INVENTORY IS THEREFORE A COPY OF THE VIEW, in prose, in a file no SQL
   change has any reason to touch. `id` is in the view and not in §8's list
   because nothing in the document computes from it beyond the `PID` filter,
   which §8 states separately — so it is added here rather than left as a
   difference that would have to be explained every time this is read.
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

  /* AND THE WITHHELD ONES STAY WITHHELD. §8 now explains why each is absent,
     and every explanation is a rule she would otherwise have to be told: that
     costs are already in the P&L, that balance is the wrong denominator, that
     the unsettled figure is not reachable by name. Serving one silently turns
     its paragraph into a wrong fact about her own document. */
  const cols = servedView();
  // Scoped to the block that explains them. `balance` and `computed_pnl` are
  // named all over §8 for other reasons, so searching the section rather than
  // the block is a check that cannot fail — it passed with the whole paragraph
  // for `balance` deleted.
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

  /* AND net_pnl, BECAUSE §8 SUMS IT AND `pnl` CANNOT BE SUMMED HONESTLY.
     `pnl` is `coalesce(net_pnl, computed_pnl)`, so on a position whose broker
     email has not landed it is the folded figure and carries no swap — and this
     account holds through the 17:00 rollover. Served `pnl` alone she followed
     §8's monthly instruction against a column that does not exist and produced
     a total short by an unknown amount, on rows she could not identify. The
     failure was silent for five versions of the document, which is why it is
     asserted here rather than left to the prose in either file. */
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

test('a setup the app offers can actually be written, and one it does not cannot', async () => {
  const { app, close } = await boot();
  try {
    // The direction the failure has to hold in: the constraint is the last
    // word, so every value reachable from a client must satisfy it, and nothing
    // else may.
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
      assert.ok(declaresColumn(column), `${column} is not declared in 001_trades.sql`);
    }
  } finally { close(); }
});

/* ─── And the two copies inside the redraw trigger ───────────────────────────
   002_gladys.sql names the four journal columns twice more, and both copies are
   typed SQL in a file no compiler reads. The WHEN clause decides that an answer
   moved; the `before` object carries the answers as they stood, which is the
   whole input to whether the redraw settles the form.

   Each fails silently and differently. A column missing from the WHEN clause is
   an answer that never reaches the Telegram message — the exact defect the
   trigger was added to fix, back for one question out of four. A column missing
   from `before` reads as unanswered, so a correction to a settled trade reopens
   the form instead of leaving it settled.
   ───────────────────────────────────────────────────────────────────────── */

test('the redraw trigger watches, and carries, exactly the journal columns', async () => {
  const { app, close } = await boot();
  try {
    const owned = [...app.Data.OWNED].sort();

    // Anchored on the trigger itself, so the columns in the payload above it
    // cannot stand in for the ones in the WHEN clause.
    const at = GLADYS_SQL.indexOf('create or replace trigger trades_telegram_on_answer');
    assert.ok(at > -1, '002_gladys.sql no longer creates trades_telegram_on_answer');

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

/* And the third read of that same before-state, which is a file against itself
   rather than two files against each other — same shape as notesBlock() below,
   and the same failure: silence. postAnswer() is the half of the redraw no test
   can drive, because it talks to Telegram and PostgREST and nothing else calls
   it. A constant in place of answered(before) there disagrees with the tap that
   fired the trigger, and the second redraw is the one that lands. */

test('the redraw decides from the before-state, not from a constant', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-gladys/index.ts', import.meta.url), 'utf8');

  const at = src.indexOf('async function postAnswer(');
  assert.ok(at > -1, 'doji-gladys no longer has postAnswer()');
  // Comments stripped: the expression named in the prose above the call is not
  // the call.
  const body = src.slice(at, src.indexOf('\n}', at))
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

  assert.match(body, /redraw\([^)]*answered\(before\)\)/,
    'postAnswer no longer redraws on answered(before) — it and the tap that fired ' +
    'the trigger would then disagree, and a form reopened with [Edit] shuts under ' +
    'the correction being made in it');
});

test('no broker column is reachable through either writer', async () => {
  const { app, close } = await boot();
  try {
    // The list that must never intersect: everything the poller, the email
    // writer or the database itself owns. If one of these ever appears in
    // Data.OWNED or in COLUMNS, the design's central guarantee is gone and
    // there is suddenly something to arbitrate.
    const broker = [
      'id', 'user_id', 'direction', 'entry_time', 'fill_time', 'entry_price',
      'exit_price', 'commission', 'balance', 'open_day', 'net_pnl',
      'computed_pnl', 'pnl', 'deleted', 'created_at', 'updated_at',
      // Gladys's own bookkeeping rather than a broker's, and it belongs on this
      // list for the same reason: a tap or a save that could name it would be
      // able to point her at somebody else's message, or lose the trade its own.
      'tg_message_id',
    ];
    const reachable = new Set([...app.Data.OWNED, ...Object.values(COLUMNS)]);
    for (const column of broker) {
      assert.ok(!reachable.has(column), `${column} is writable from the journal half`);
    }
  } finally { close(); }
});

/* ─── Eugenia's note length ──────────────────────────────────────────────────
   The ceiling used to live in three places — the truncation, the constraint,
   and the sentence the tool description gives the model. Two of those are now
   one: NOTE_MAX is the constant, and the description interpolates it, so the
   model can no longer be promised a budget the code does not keep.

   The constraint is the copy that remains, and it is the one that cannot be
   fixed from this side. Truncate above it and every remember() is refused by
   Postgres — writeNote catches that and answers "That did not save", which is
   deliberate for a transient blip and exactly wrong for a permanent mismatch:
   her memory stops working and the only sign is her not mentioning it.
   ─────────────────────────────────────────────────────────────────────────── */

const noteLimit = {
  truncatedAt: () => Number(EUGENIA_TS.match(/NOTE_MAX\s*=\s*(\d+)/)?.[1]),
  constrainedTo: () =>
    Number(EUGENIA_SQL.match(/char_length\(note\)\s+between\s+1\s+and\s+(\d+)/i)?.[1]),
};

test('the note length is one number on both sides of the wire', () => {
  // Each read back out of its own file, so a pattern that stops matching yields
  // NaN — and NaN against NaN would report a drift that is really this test
  // having gone blind. Both are checked before they are compared.
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

/* ─── And the two kinds of note ──────────────────────────────────────────────
   'fact' and 'instruction' are a vocabulary the model chooses from and Postgres
   enforces, which is the same shape as the setups list and fails the same way:
   a kind the tool offers and the constraint refuses makes every remember() of
   that kind vanish, reported to nobody. A kind the constraint allows and the
   tool never offers is dead weight that reads as coverage.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── The five channels, in four places and two vocabularies ────────────────
   prompt.ts declares them once and the prose interpolates the names, so her
   vocabulary cannot drift from the list. The other three copies can: the tool's
   enum is what she is allowed to name, the check constraint is what the database
   will accept, and §2 of the strategy is the mechanism behind each one. An id
   the tool offers and the constraint refuses is a set_channel that 400s —
   reported to her as a database fault, and to nobody else at all. An id the
   constraint allows that the tool never offers is a rung nothing can ever move:
   it reads as a channel he has not reached, forever.

   §2 IS THE COPY THAT IS NOT AN ID, which is why it is checked separately and
   against the other half of the pair. She never utters "central_bank_buying"
   across a desk, so §2 heads each channel with the SPOKEN name — and a name can
   therefore drift with every id in the repository still agreeing.

   EITHER WAY IT IS THE QUIET FAILURE. She would teach the channel, at length and
   correctly, against a map with no rung for it — so the census that exists to
   show what he has never met would report nothing at all about the thing she
   spent the morning on.
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
  /* The read renders what it is given. A channel with no row would simply drop
     out of her map — and the whole point of the map is that a channel he has
     never touched is VISIBLE, so a missing row hides exactly what it exists to
     show. */
  const seeded = [...(EUGENIA_SQL.match(/insert into public\.eugenia_channels[\s\S]*?on conflict/)?.[0] ?? '')
    .matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
  const declared = [...(EUGENIA_PROMPT.match(/export const CHANNELS = \[([\s\S]*?)\] as const/)?.[1] ?? '')
    .matchAll(/\['([a-z_]+)',/g)].map(m => m[1]).sort();
  assert.deepEqual(seeded, declared,
    'the seed and the channel list disagree — an unseeded channel vanishes from her map');
});

/* ─── The rung that comes back down, and the one that cannot ────────────────
   The ladder climbed only, for a reason: failing to reach for a mechanism once
   is not the same as having lost it. What that reasoning missed is that HE can
   say he has lost it — and promoting too early is her natural error, so without
   a way down she keeps using a term bare that he told her he no longer follows,
   with nothing anywhere reporting it.

   THE BOTTOM RUNG IS STILL UNREACHABLE, and that is the half worth testing.
   `unseen` says a channel has never once come up. It is the only absence this
   system can see, and a demotion able to write it would report a channel she
   taught last week as one he has never met — which is the census reporting the
   opposite of the truth in the one column it exists for.
   ─────────────────────────────────────────────────────────────────────────── */

test('a demotion can reach every rung but the bottom one', () => {
  const at = EUGENIA_TS.indexOf('async function setChannel(');
  assert.ok(at > -1, 'doji-eugenia no longer has setChannel()');
  const body = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('\n}', at));

  // Before the write, not after it: a PATCH that has already landed cannot be
  // refused, and `unseen` written once is indistinguishable from never taught.
  const guard = body.indexOf('CHANNEL_STATES[0]');
  assert.ok(guard > -1,
    'setChannel no longer refuses the bottom rung, so a demotion can report a ' +
    'channel she has taught as one he has never met');
  assert.ok(guard < body.indexOf('method: "PATCH"'),
    'the bottom-rung guard sits after the write, which is not a guard');
});

test('the nightly pass is told a demotion is his to declare', () => {
  /* The tool permits it and the prompt is what asks for it. Silence here is the
     shape this defect had for its whole life: a mechanism that exists, is
     documented, and is never once invoked because nothing tells her to. */
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

  // ORDER MATTERS HERE, unlike the channels: this is a ladder, and the first
  // element is the bottom rung — channelsList falls back to it for a row that
  // is missing, and a reordered list would render an unseeded channel as owned.
  assert.deepEqual(declared, ['unseen', 'explained', 'used', 'owns'],
    'the ladder has changed — say so here, and check what channelsList falls back to');
  assert.deepEqual(enforced.sort(), [...declared].sort(),
    'the check constraint and prompt.ts no longer hold the same rungs');

  /* AND §0 SAYS WHAT TO DO AT EACH ONE, a row per rung, which is what turned
     the ladder from a census into an instruction. A rung renamed anywhere else
     leaves that table answering for a state nothing produces and silent on the
     state she is actually handed — and the silence is the half that shows,
     because she falls back to explaining everything or to explaining nothing. */
  const pitched = [...SECTIONS['0'].matchAll(/^\| `([a-z]+)` \| /gm)].map(m => m[1]);
  assert.deepEqual(pitched, declared,
    'the strategy pitches at a different set of rungs than the map carries');
});

test('the note kinds are the same two words in the tool and the constraint', () => {
  const offered = [...EUGENIA_TS.matchAll(/NOTE_KINDS = \[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/'([a-z]+)'/g)].map(k => k[1])).sort();
  const enforced = [...(EUGENIA_SQL.match(/kind in \(([^)]*)\)/i)?.[1] ?? '')
    .matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort();

  assert.deepEqual(offered, ['fact', 'instruction'],
    'the kinds the tool offers have changed — say so here, and check the constraint');
  assert.deepEqual(enforced, offered,
    'the tool and the check constraint no longer offer the same kinds');
});


/* ─── Who the database and Gmail think they are calling ─────────────────────
   A function's name is in its directory, in the Deno.serve URL Supabase derives
   from that directory, and in every caller's URL — and the callers are a SQL
   file and an Apps Script, which no compiler, deploy or type check ever reads.
   Renaming doji-telegram to doji-gladys meant editing a trigger body and a cron
   job by hand, and a missed one is a 404 into a void: pg_net discards the
   response, so the trade simply goes unannounced.

   So this asserts the other direction from verify.sql. verify.sql reads the
   live database and checks the trigger names doji-gladys; this reads every
   caller in the repository and checks each one names a function that exists.
   ─────────────────────────────────────────────────────────────────────────── */

const read = (path) =>
  ({ path, text: readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') });

// The three that name a FUNCTION.
const CALLERS = ['supabase/002_gladys.sql', 'supabase/004_cron.sql',
                'supabase/005_eugenia_senses.sql', 'doji_gmail_sync.gs']
  .map(read);

// Every file that names the PROJECT, which is a longer list: the app connects
// to it, config.toml links the CLI to it and the deploy workflow pushes to it.
const PROJECT_FILES = [...CALLERS.map(c => c.path),
  'index.html', 'supabase/config.toml', '.github/workflows/deploy-functions.yml'].map(read);

const called = (text) =>
  [...text.matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co\/functions\/v1\/([a-z0-9-]+)/g)]
    .map(([, project, fn]) => ({ project, fn }));

test('every function a caller names is a function that exists', () => {
  assert.deepEqual(DEPLOYED,
    ['doji-email-sync', 'doji-eugenia', 'doji-gladys', 'doji-mcp-sync'],
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

/* The project ref is not a secret, and it is not a URL everywhere it appears:
   config.toml carries it as project_id and the deploy workflow as
   --project-ref. So all three shapes are matched, and each is anchored to the
   text around it — hunting for a bare twenty-letter word would find one in
   index.html sooner or later and fail for a reason that is not this.

   A copy in every language here and nothing else checking any of them. A
   restore into a new project means editing every one, and the one that is
   missed keeps talking to the old project for as long as it exists. */
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


/* ─── Every secret a function needs is one it refuses to run without ────────
   Each function opens by answering 503 if a required secret is unset, because
   the alternative is a function that starts, authorises nobody and reports
   nothing — the shape SB_SECRET_KEY's misspelling had for months.

   That guard is a hand-written list, and the failure is adding a secret and not
   adding it to the list. Nothing else could catch it: an unset secret makes the
   function behave differently, not crash, and no test here can set one. So this
   reads both lists out of the file and requires them to be the same list.

   The guard must also be a chain of ORs. `!A || !B && !C` parses as
   `!A || (!B && !C)`, which reads exactly like the correct thing and lets two
   of the three go missing unnoticed — one `&&` in a line of five clauses.
   ─────────────────────────────────────────────────────────────────────────── */

// The consts a function binds from its own environment. SB_KEY and SB_URL come
// from _shared and are named in the guards without being bound here, which is
// why the comparison runs from the file's own reads to the guard.
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

/* SECRETS A FUNCTION CAN GENUINELY RUN WITHOUT, named here rather than waved
   through. The boot guard exists because a missing secret used to surface as a
   downstream failure hours later — so an exemption from it has to be a decision
   somebody wrote down, not the absence of one.

   Three, and all three are external vendors this system otherwise has no use
   for. Speech-to-text: the Messages API takes text and images and not audio,
   and Telegram does not transcribe for bots, so hearing a voice note needs one.
   Embeddings: Anthropic serves none, and semantic search is a widening of a
   reach that already works without it — unset, the search is full text and
   trigram, which is what it was. Speech: unset, she answers a voice note in
   text, which is what every other message gets.

   ALL THREE ARE A DIFFERENT KIND OF THING FROM EUGENIA_BOT_TOKEN being unset,
   where nothing works at all and the right answer is to refuse every request.
   Here one capability is absent and every other path is untouched.

   THE EXEMPTION IS NOT FREE. Each one has to be guarded where it is USED, so
   "optional" means a branch that handles its absence rather than a value that
   reaches a fetch as an empty string. That check is below, and it is the half
   that stops this list becoming somewhere to hide a secret that is actually
   required. */
const OPTIONAL = new Set(['STT_URL', 'STT_KEY', 'EMBED_KEY', 'TTS_KEY']);

test('an optional secret is guarded where it is used', () => {
  for (const { name, text } of FUNCTIONS) {
    for (const { name: secret } of bound(text)) {
      if (!OPTIONAL.has(secret)) continue;
      assert.match(text, new RegExp(`if \\(![A-Z_ |!]*\\b${secret}\\b`),
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
    // SB_KEY is not bound here — it comes from _shared — so it has to be added
    // by hand, and it is the secret whose silent absence this whole guard is
    // named after.
    if (/\bSB_KEY\b/.test(text)) required.push('SB_KEY');

    // WITHOUT THIS THE LOOP BELOW IS VACUOUS. bound() reads `const X = env(` and
    // a file that stopped binding its secrets that way would satisfy every
    // guard, including `if (false)`.
    assert.ok(required.length >= 2,
      `${name}: only ${required.length} required secrets found — the reader has gone blind`);

    for (const secret of required) {
      assert.ok(guarded.includes(secret),
        `${name} reads ${secret} but will start without it — an unset one then ` +
        `surfaces as a downstream failure rather than as "not configured"`);
    }
  }
});


/* ─── Every function says the same thing about its own gateway ──────────────
   verify_jwt = false is stated twice on purpose — once per function in
   config.toml, once as --no-verify-jwt on the deploy command — because each
   function authorises its own caller in code and a gateway that quietly
   started checking a JWT would take down both Telegram webhooks and the cron
   poller at once.

   Two statements is the cheap mistake; ONE MISSING statement is not. A function
   added without a stanza here deploys correctly only for as long as the
   workflow's flag is what deploys it — a hand-run `supabase functions deploy
   <name>` would put it behind the gateway, and every caller would get a 401
   with nothing in the function's own logs to say why.
   ─────────────────────────────────────────────────────────────────────────── */

test('config.toml turns the gateway off for every function that exists', () => {
  // Comments stripped first. The file is half explanation, and a `verify_jwt`
  // named in prose — or a live `= true` above a note about `= false` — would
  // otherwise satisfy every assertion below while the gateway was on.
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
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
   README.md is the contract and CLAUDE.md is how to work on the repo, and both
   are dense with `identifiers` in backticks. Nothing checked them. A rename
   leaves every mention behind, and a document naming a function that is gone
   reads exactly like a document that is right — which is how `005_cron.sql`,
   `doji-telegram` and a `nyClock` correction that no longer existed all
   survived in prose after the code moved on.

   This catches the mechanical half: a name that is nowhere in the repository.
   It cannot catch a name that still exists but no longer does what the sentence
   says. That half is caught by reading, or not at all.
   ─────────────────────────────────────────────────────────────────────────── */

const TRACKED = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);

/* Everything the repository is, as one string, so a symbol counts as real if it
   exists ANYWHERE — a test file, a SQL constraint, a CSS token — rather than
   only where a reader might expect it.

   THIS FILE IS EXCLUDED, and that is not tidiness. The exception list below
   holds the names the documents mention BECAUSE they are absent, and with this
   file in the corpus every one of them would validate against its own
   exception — the list would pass by existing rather than by being right. */
const CODE = TRACKED
  .filter(f => /\.(html|ts|gs|sql|mjs|toml|json|yml)$/.test(f) && f !== 'test/agree.test.mjs')
  .map(f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');

/* Prose in backticks is mostly prose. What is wanted is the subset that looks
   like something a compiler or a filesystem would recognise, so this keeps
   names that are camelCase, snake_case, hyphenated, dotted or SCREAMING — and
   drops short lower-case words like `null`, `both` and `no`, which are English
   wearing a code font.

   THE HYPHEN AND THE LEADING DIGIT MATTER: `doji-telegram` and `005_cron.sql`
   are two of the three renames that actually survived in prose here, and a
   pattern anchored on an identifier start would miss both. */
const SYMBOLS = /`([A-Za-z0-9_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_]+)*)`/g;

const looksLikeCode = (name) =>
  /[A-Z_.\-]/.test(name) && name.length >= 4 && /[A-Za-z]/.test(name);

/* Named in prose PRECISELY BECAUSE they are not in the code, so each entry needs
   its reason beside it or this becomes the place failures are sent to be
   forgotten:

     TODO                        a prohibition — CLAUDE.md forbids the marker
     background_color            }  manifest fields tried against the iOS
     apple-touch-startup-image   }  launch frame, none of which reached it

   AND THE BROKER'S OWN TOOL NAMES, which are named to say what its endpoint
   OFFERS and what this repository therefore chooses not to call. They are the
   one category this test cannot judge: they are real, they are just real
   somewhere else. `create_order` and the other four destructive names are
   deliberately NOT here — they are in DESTRUCTIVE_TOOLS in the poller, so they
   validate against the code, which is what makes the read-only claim checkable
   rather than merely written down.

     get_symbols · get_assets · get_pending_orders · get_order_history ·
     get_version   read-only tools cTrader serves and the poller does not call
     MN_1          a get_trendbars period, one of nine the broker accepts
     insufficient_quota  the embedding vendor's own code for an unfunded
                   account, quoted exactly because the README's account of what
                   the ?embed=1 door reports is worth nothing if it paraphrases
                   the string somebody will actually read */
const DELIBERATELY_ABSENT = new Set([
  'TODO', 'background_color', 'apple-touch-startup-image',
  'get_symbols', 'get_assets', 'get_pending_orders', 'get_order_history',
  'get_version', 'MN_1', 'insufficient_quota',
]);

test('the documents name only symbols the repository has', () => {
  const missing = [];

  for (const doc of ['README.md', 'CLAUDE.md']) {
    const text = readFileSync(new URL(`../${doc}`, import.meta.url), 'utf8');
    const named = new Set();

    for (const [, name] of text.matchAll(SYMBOLS)) {
      if (!looksLikeCode(name) || DELIBERATELY_ABSENT.has(name)) continue;
      named.add(name);
    }

    // WITHOUT THIS THE LOOP BELOW PROVES NOTHING. A pattern that stopped
    // matching would report every document clean.
    assert.ok(named.size > 40,
      `${doc}: only ${named.size} symbols found — the reader has gone blind`);

    for (const name of named) {
      // A name with a file extension is a FILE and is checked as one, against
      // what git tracks. `verify.sql` and `005_cron.sql` are not symbols, and
      // reading them as one made their last segment the only thing checked.
      if (/\.(sql|html|ts|gs|mjs|toml|json|yml|md)$/.test(name)) {
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


/* ─── Every way she speaks to him reads what he has told her ────────────────
   His notes are the only channel he has for correcting her — there is no
   settings page, no feedback button, and nothing else that survives the twelve
   turns of conversation window. "Stop mentioning the ten-year" becomes a note,
   and every later message is supposed to obey it.

   That makes notesBlock() load-bearing in a way it was not before, and its
   absence is silent: drop it from one path and she simply carries on ignoring
   an instruction he thinks she took. He would have no way to tell whether she
   disagreed, forgot, or never read it.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── The strategy, and the two ways it goes quiet ───────────────────────────
   She cannot write this document, so nothing she does can report that it never
   arrived. Both failures are silent and neither changes a single test elsewhere:
   the always-loaded half dropped from the system prompt, and a rule citing a
   section get_strategy cannot serve.
   ─────────────────────────────────────────────────────────────────────────── */

test('the strategy rides on the cached system prompt, not on a message', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  // In the system block AND cached. Moved to a message it is paid on every turn
  // and breaks the prefix each time the document is edited; dropped entirely she
  // reasons about his trading from nothing and says so about nothing.
  assert.match(src, /system:\s*\[\{[^}]*text:\s*SYSTEM \+ ALWAYS[^}]*cache_control/,
    'the strategy is no longer part of the cached system prompt — either she has ' +
    'stopped being given it at all, or it is being paid for on every message');

  /* AND THE WINDOW IS STATED, because the default is five minutes and her
     callers are hours apart. Without a ttl the cache pays only for the rounds
     within one turn and the comment above it claims more than that — the
     briefing at 08:00 and the replies it draws through the morning share
     nothing. Dropping the ttl is silent: the request still succeeds, and the
     only sign is the `cached` figure in ask()'s log line. */
  assert.match(src, /cache_control:\s*\{\s*type:\s*"ephemeral",\s*ttl:\s*"1h"\s*\}/,
    'the cached prefix no longer states a ttl, so it falls back to five minutes ' +
    'and almost nothing hits across turns');
});

test('what is summarised into every turn can also be read in full', () => {
  // Each rule cites the section holding its reasoning, and that citation is the
  // only route from a one-line rule to why it exists.
  /* THE SUBSECTION IS PART OF THE CITATION, and reading only the integer is how
     this test passed over the defect it was written for. R-05 cites §4.1 and
     R-06 cites §4.2 — the only two citations in the half she carries on every
     turn — and `/§(\d+)/` captured `4` out of both, so the reader reported two
     sections that resolve while she was being told they did not exist. */
  const cited = [...ALWAYS.matchAll(/§(\d+(?:\.\d+)?)/g)].map(m => m[1]);
  assert.ok(cited.length >= 3,
    `only ${cited.length} section references read out of the rules table — the reader has gone blind`);
  assert.ok(cited.some(k => k.includes('.')),
    'no subsection citation read out of the rules table — the reader has gone blind ' +
    'to exactly the shape that broke');

  /* Every one of them, through the same resolution the tool uses. A citation
     she cannot follow is answered "there is no section 4.1", which is not a
     blank she fills in herself but a wrong fact about her own document.

     AND A SUBSECTION HAS TO BE IN WHAT CAME BACK. readStrategy falls back to
     the parent section, deliberately — §4.1 is prose inside §4 — which means a
     citation to a §4.7 that was never written resolves to §4 and reads exactly
     like a citation that worked. The heading is the only thing that separates
     them, so it is the thing asserted. */
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

  /* §0 and §7 are the two the document's retrieval contract names as always
     loaded, and both are summarised to get there — the header down to its
     summary paragraph, the rules down to their table. Losing either from
     SECTIONS means she holds an abbreviation of something she can no longer
     read whole, which is the shape of a confident wrong answer.

     Sections 1 and 11 do not exist and nothing cites them: a numbering that
     skips reads as a decision where six holes read as an unfinished document,
     and readStrategy answering for a number she invents is asserted below
     rather than pretended away here. */
  for (const k of ['0', '7']) {
    assert.ok(k in SECTIONS,
      `§${k} is summarised into every turn and can no longer be read in full`);
  }
});

test('an unknown section is answered, never silently empty', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('function readStrategy(');
  assert.ok(at > -1, 'doji-eugenia no longer has readStrategy()');
  const body = src.slice(at, src.indexOf('\n}', at));

  // The section number arrives from the model, so an invented one is what this
  // has to survive. An empty tool result is a blank she fills in herself, which
  // is the one outcome worse than saying it is missing.
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
   dueNow can answer 'consolidate' correctly every night for a year and the pass
   never runs, because the branch that would call it is not there. The week-walk
   in fold.test.mjs proves the ANSWER; nothing there proves anyone acts on it,
   and the failure is a nightly no-op that returns 200 and looks healthy in
   net._http_response.
   ─────────────────────────────────────────────────────────────────────────── */

test('every answer dueNow can give is dispatched by postScheduled', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  // The literals in dueNow's return type, which is the one statement of what it
  // can answer. 'weekday' and 'sunday' arrive as Brief and are handled together.
  const sig = src.match(/export function dueNow\([^)]*\):\s*([^{]+)\{/);
  assert.ok(sig, 'doji-eugenia no longer declares what dueNow returns');
  const answers = [...sig[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.ok(answers.length, 'dueNow now returns no named answers — the reader has gone blind');

  const at = src.indexOf('async function postScheduled(');
  assert.ok(at > -1, 'doji-eugenia no longer has postScheduled()');
  const body = src.slice(at, src.indexOf('\n}', at));

  for (const a of answers) {
    assert.match(body, new RegExp(`due === '${a}'`),
      `dueNow can answer '${a}' and postScheduled never asks — that hour would ` +
      `return 200 having done nothing at all`);
  }
});

/* ─── Every tool sent is a tool served ───────────────────────────────────────
   The tools array in call() and the branches in ask() are two lists of the same
   names, and they fail in opposite directions. A tool sent but not served makes
   the loop throw `tool_use with no tool this function serves` — loud, but only
   once the model happens to call it, which for a search tool may be days. A tool
   served but not sent is dead code the model can never reach.

   web_search is the deliberate exception and is excluded by shape rather than by
   name: it carries a `type` and runs on Anthropic's side, so it never arrives in
   the loop at all.
   ─────────────────────────────────────────────────────────────────────────── */

test('the tools she is offered are exactly the tools the loop can run', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  // Read from the DEFINITIONS rather than from a tools array, because there are
  // two arrays now and a tool belonging to either still has to be executable.
  const defined = [...src.matchAll(/^const ([A-Z_]+_TOOL) = \{/gm)].map(m => m[1]).sort();
  assert.ok(defined.length >= 3,
    `only ${defined.length} tools read out of the file — the reader has gone blind`);

  // A switch rather than a chain of ifs since there are ten of them, so the
  // shape the dispatch is read out of moved with it. What is being asserted is
  // unchanged: every tool defined is executable, and every tool executable is
  // defined.
  const served = [...src.matchAll(/case ([A-Z_]+_TOOL)\.name:/g)].map(m => m[1]).sort();
  assert.deepEqual(served, defined,
    'a tool is defined that the loop cannot execute, or the reverse — the first ' +
    'throws only once she happens to call it, the second is unreachable');

  /* AND EVERY TOOL SET IS DRAWN FROM THAT SAME LIST. A name appearing in a set
     but nowhere as a definition is a tool the model is offered and the loop has
     never heard of. */
  for (const set of ['CHAT_TOOLS', 'CONSOLIDATE_TOOLS', 'RELEASE_TOOLS', 'TRADE_TOOLS']) {
    const block = src.match(new RegExp(`const ${set} = \\[([\\s\\S]*?)\\];`));
    assert.ok(block, `doji-eugenia no longer defines ${set}`);
    const named = [...block[1].matchAll(/([A-Z_]+_TOOL)/g)].map(m => m[1]);
    assert.ok(named.length, `${set} offers no tool this file defines`);
    for (const t of named) {
      assert.ok(defined.includes(t), `${set} offers ${t}, which is not defined anywhere`);
    }
  }
});

/* ─── What the nightly pass is given to judge with ───────────────────────────
   Two instructions in CONSOLIDATE ask for something the pass could not see. It
   is told to notice what he has started doing differently — a claim about his
   trading, judged from a transcript that on most days never mentions a trade —
   and it is told to prefer superseding to adding while holding twenty notes out
   of an archive it had no way to look at. Both failed upward: the pass ran, the
   notes looked fine, and the evidence was simply absent.
   ─────────────────────────────────────────────────────────────────────────── */

test('the nightly pass sees his week and can reach past its own window', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const at = src.indexOf('async function postConsolidation(');
  assert.ok(at > -1, 'doji-eugenia no longer has postConsolidation()');
  const code = src.slice(at, src.indexOf('\n}', at))
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

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
   Everything else unobservable in this function is counted where it happens and
   for that exact reason — ask() logs tokens because the spend cap is a ceiling
   and not a meter, postBriefing logs characters because the length target lives
   past a model call. What she is FOR is that his understanding grows, the map is
   the instrument for it, and nothing ever read that instrument back. A ladder
   that has stopped moving looks exactly like one that never had to.
   ─────────────────────────────────────────────────────────────────────────── */

test('the nightly pass reports the map it may just have moved', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const at = src.indexOf('async function postConsolidation(');
  const code = src.slice(at, src.indexOf('\n}', at))
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  assert.match(code, /await\s+logChannels\(\)/,
    'nothing records where the channels stand, so the only claim this design ' +
    'rests on is the only one with no meter on it');

  const fn = src.indexOf('async function logChannels(');
  assert.ok(fn > -1, 'doji-eugenia no longer has logChannels()');
  const body = src.slice(fn, src.indexOf('\n}', fn));
  // It runs after the pass has already written memory, so a throw here would
  // turn a good night into a 500.
  assert.match(body, /catch\s*\(/,
    'logChannels can throw, and it runs after the work it reports on is done');
});

test('the search tool names the function the database actually defines', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  // The RPC path is a string in one file and a function name in another, and a
  // rename in either is a 404 that searchMemory catches and reports as "could
  // not be searched" — indistinguishable from the database being down.
  const rpc = src.match(/rest\/v1\/rpc\/(\w+)/);
  assert.ok(rpc, 'doji-eugenia no longer calls an RPC at all');
  assert.match(EUGENIA_SQL,
    new RegExp(`create or replace function public\\.${rpc[1]}\\(`),
    `doji-eugenia calls ${rpc[1]}() but 003_eugenia.sql does not define it`);

  // Both search columns have to exist or the function body references nothing.
  for (const table of ['eugenia_notes', 'eugenia_turns']) {
    assert.match(EUGENIA_SQL,
      new RegExp(`alter table public\\.${table}[\\s\\S]{0,120}add column if not exists search tsvector`),
      `${table} has no generated search column, so eugenia_search cannot match against it`);
  }
});

/* ─── Who said it, on both sides of the wire ─────────────────────────────────
   `source` is a vocabulary now, not a constant: the SQL decides which of three
   words a hit carries and searchList decides how each is rendered. A word on
   one side and not the other is a hit attributed to the wrong person — the
   exact defect that shipped, where the SQL emitted one value for every turn and
   half of every result set came back as her own words.

   Both lists are read out of the files rather than typed here, for the reason
   the rest of this suite gives: a test asserting against a literal beside it is
   a test that changes in the same pass as the thing it guards.
   ─────────────────────────────────────────────────────────────────────────── */

test('every source the search can return is a source the renderer knows', () => {
  const fn = EUGENIA_SQL.match(
    /create or replace function public\.eugenia_search[\s\S]*?\$\$;/);
  assert.ok(fn, '003_eugenia.sql no longer defines eugenia_search');

  /* The literals in the two select lists — 'note' from the notes arm, and both
     arms of the CASE that carries the turn's role. A turn arm that has gone
     back to a bare 'turn' fails here rather than at the far end of a search. */
  const emitted = [...new Set([...fn[0].matchAll(/'(note|turn|you|him)'/g)].map(m => m[1]))];
  assert.ok(emitted.includes('note'), 'the notes arm no longer labels its hits');
  assert.ok(!emitted.includes('turn'),
    'the turn arm labels every turn the same way again — his words come back as hers');

  // Every source that is not a note has to be a word the renderer holds. The
  // map is imported rather than read as text, the same way SETUPS and COLUMNS
  // are: a vocabulary compared against the file that shares it.
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
  assert.match(EUGENIA_SQL, /from public\.eugenia_turns t/);
  assert.match(EUGENIA_SQL, /case when t\.role = 'user'/,
    'eugenia_search does not read t.role, so nothing downstream can tell his ' +
    'messages from hers');
});

test('the search function is not reachable by a public key', () => {
  // EXECUTE on a function is granted to PUBLIC by default, and anon inherits it.
  // Left alone that is a public entry point to her whole memory.
  assert.match(EUGENIA_SQL, /revoke execute on function public\.eugenia_search\(text, int\) from public/,
    'eugenia_search is still executable by PUBLIC');
  assert.match(EUGENIA_SQL, /grant execute on function public\.eugenia_search\(text, int\) to service_role/,
    'eugenia_search is not granted to the one role that should call it');
});

/* ─── The pre-trade sequence ─────────────────────────────────────────────────
   R-08 is a rule about a list, and for six versions the list was not in the
   document — the rule cited §6, §6 said the steps existed somewhere else, and
   nothing anywhere could state them. A rule pointing at nothing reads exactly
   like a rule pointing at something.

   FOUR SINCE v1.9. Psychological levels were a fifth and were folded into the
   levels step, because they gated nothing — a step that can never be the step
   you stopped at is not a step, and R-08's only claim is that one of them ends
   the sequence. The count is asserted because the fold is the kind of edit that
   lands in the prose and not in the list.
   ─────────────────────────────────────────────────────────────────────────── */

test('R-08 cites a section that actually holds its steps', () => {
  const row = ALWAYS.split('\n').find(l => l.startsWith('| R-08'));
  assert.ok(row, 'R-08 is no longer in the rules table');

  const cited = row.match(/§(\d+)/);
  assert.ok(cited, 'R-08 cites no section at all');
  const body = SECTIONS[cited[1]];
  assert.ok(body, `R-08 cites §${cited[1]}, which get_strategy cannot serve`);

  // Four, numbered, in the section the rule points at. The ORDER is the rule —
  // a failed step ends the sequence rather than being traded off against a
  // later one — so a list that has stopped being ordered is a different rule.
  const steps = [...body.matchAll(/^\d\. \*\*/gm)];
  assert.equal(steps.length, 4,
    `§${cited[1]} lists ${steps.length} numbered steps, not the four R-08 requires`);
});

test('the two reward-to-risk numbers are kept apart', () => {
  /* 1:1.5 is a condition at ENTRY — step 4 refuses the trade below it. A
     realised 1:1.25 is what a $30 target shortened on an open trade leaves
     behind, and it is ALSO what $25 set at entry over a $20 stop leaves behind,
     which is a breach. The document stated one floor for six versions and the
     two silently contradicted each other; v1.9 keeps them apart by saying the
     row cannot tell which produced it. */
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
   Every backtick in that document is escaped, and the file is written by editing
   text that ALREADY contains escaped ones — so an editor that escapes a second
   time produces `\\\`` , which parses fine, passes every other test, and reaches
   her as a literal backslash in front of every column name.

   It has happened three times. Nothing failed any of them, because a stray
   backslash is valid TypeScript and valid prose.
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
   `strategy.ts` is scanned above for double-escaped backticks because that
   defect is invisible in a diff and reaches her as literal noise. This is the
   same class in the other file she is actually made of: a sentence inserted
   into a wrapped paragraph without re-wrapping it, which leaves a line at
   double the width and, where the insert landed on a dash, `— —` shipped into
   the system prompt of every single request. Nothing anywhere reads this file
   as text.

   IT CATCHES THE MECHANICAL HALF ONLY, and saying so is the point of saying
   anything: an over-long line and a doubled dash are artifacts nothing else
   produces, so they can be asserted. The other half of the same edit — the
   SHORT line left behind where the sentence was pulled out — is indistinguishable
   from a deliberate break before a heading or a list, and a check for it would
   fire on most of this prompt. That half is caught by reading and by nothing here.
   ─────────────────────────────────────────────────────────────────────────── */

test('no paragraph of the prompt shows where it was edited', () => {
  /* The template literals as the FILE holds them, not the interpolated
     constants: ${CHANNEL_NAMES} expands one short source line to 168
     characters, and it is the source wrapping that is the artifact. */
  const bodies = [...EUGENIA_PROMPT.matchAll(
    /export const (SYSTEM|CONSOLIDATE|CRITIC|RELEASE|TRADE_EVENT) = `([\s\S]*?)`;/g)];
  assert.equal(bodies.length, 5,
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

/* ─── Every read is bounded ──────────────────────────────────────────────────
   Four reads in this function pull rows she is then charged for reasoning over,
   and three of them were capped from the day they were written. The fourth —
   the nightly pass — was not, and nothing failed: a normal day is a handful of
   turns, so an unbounded window looks identical to a bounded one until the day
   it does not.
   ─────────────────────────────────────────────────────────────────────────── */

test('every row-returning read of her own tables carries a limit', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  /* TWO NORMALISATIONS, AND BOTH WERE LEARNED BY THIS TEST FAILING ON CORRECT
     CODE. Every URL here is built from template literals joined by `+`, so the
     limit routinely sits in a different literal from the select and a pattern
     that stops at the first backtick cannot see it. And a path is a READ only if
     it names `select=` — a PATCH against one primary key is a REST path against
     a growing table too, and needs no limit at all. */
  const joined = src.replace(/`\s*\+\s*`/g, '');
  const reads = [...joined.matchAll(/rest\/v1\/(eugenia_\w+|trades)\?(select=[^`]*)/g)];
  assert.ok(reads.length >= 3,
    `only ${reads.length} reads found — the reader has gone blind`);

  for (const [, table, query] of reads) {
    assert.match(query, /limit=/,
      `the read of ${table} has no limit — an unusual day puts the whole window ` +
      `into a model call with nothing to stop it`);
  }
});

/* ─── Retirement, and the filter that is the whole of it ─────────────────────
   A superseded note is still in the table by design — the trail is the point.
   What keeps it out of her context is one clause in one query, and losing that
   clause fails in the worst available way: she is handed the correction AND the
   thing it corrected, every turn, with nothing marking which is current. No
   error, no log, and the note count merely looks healthy.

   Three copies have to agree for the feature to exist at all: the column in the
   schema, the filter in the read, and the parameter in the tool she calls. Any
   one of them missing leaves the other two doing nothing.
   ─────────────────────────────────────────────────────────────────────────── */

test('the notes read asks for live notes only, and for the id that names one', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('async function readNotes(');
  assert.ok(at > -1, 'doji-eugenia no longer has readNotes()');
  const body = src.slice(at, src.indexOf('\n}', at));

  assert.match(body, /superseded_by=is\.null/,
    'readNotes no longer filters out retired notes — every correction she has ' +
    'ever made comes back alongside the thing it corrected');
  assert.match(body, /select=id,note/,
    'readNotes no longer selects the id, so no note can be named in supersedes ' +
    'and nothing can ever be retired');
});

test('the column, the filter and the tool parameter all exist together', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  assert.match(EUGENIA_SQL, /superseded_by\s+bigint\s+references\s+public\.eugenia_notes\(id\)/,
    '003_eugenia.sql has no superseded_by column — the filter in the read would ' +
    'match nothing and PostgREST would refuse it');
  assert.match(src, /supersedes:\s*\{[\s\S]{0,80}type:\s*"integer"/,
    'the remember tool no longer offers supersedes, so she cannot retire a note ' +
    'however many she is shown');
  // The index has to match the read or it stops being used for it.
  assert.match(EUGENIA_SQL, /create index eugenia_notes_kind_id_desc[\s\S]*?where superseded_by is null/,
    'the notes index no longer matches the read it exists for');
});

/* ─── A block reaches the message, however it was awaited ────────────────────
   These calls used to be `await notesBlock()` spliced straight into the string
   being built, and a regex for that exact shape was the whole check. They are
   now gathered into a Promise.all — six independent reads that were six round
   trips before a briefing asked for its first token — so the text the old regex
   looked for is gone while the thing it was protecting is not.

   So this follows the VALUE rather than the syntax: the call is made, and
   whatever it was bound to is used again afterwards. A dropped call fails the
   first half. A call whose result is read and then never concatenated into the
   message fails the second — which is the new way this can break, is invisible
   at runtime, and is precisely what the old regex could not have seen.
   ─────────────────────────────────────────────────────────────────────────── */
const reaches = (code, fn) => {
  if (new RegExp(`await\\s+${fn}\\(\\)`).test(code)) return true;
  // EVERY Promise.all IN THE BODY, not the first one. handleMessage has two —
  // the /notes audit reads its own rows before the reply path gathers its
  // context — and stopping at the first meant the check answered "no" for a
  // call sitting in the second, which is a green test reporting the opposite of
  // the truth.
  for (const all of code.matchAll(/const \[([^\]]+)\] = await Promise\.all\(\[([\s\S]*?)\]\)/g)) {
    const names = all[1].split(',').map(s => s.trim()).filter(Boolean);
    const items = all[2].split(',').map(s => s.trim());
    const at = items.findIndex(i => i.startsWith(`${fn}(`));
    if (at < 0 || !names[at]) continue;
    const after = code.slice(all.index + all[0].length);
    if (new RegExp(`\\b${names[at]}\\b`).test(after)) return true;
  }
  return false;
};

test('every path that speaks to him reads his notes and the map', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  // The function bodies, so a call anywhere else in the file cannot satisfy this.
  const body = (name) => {
    const at = src.indexOf(`async function ${name}(`);
    assert.ok(at > -1, `doji-eugenia no longer has ${name}()`);
    const end = src.indexOf('\n}', at);
    assert.ok(end > at, `could not read the body of ${name}()`);
    return src.slice(at, end);
  };

  /* postConsolidation is the worst one to lose. The others going without notes
     costs continuity in one message; consolidation going without them means she
     cannot see what she already holds, so she never supersedes and writes the
     same fact again every night.

     postRelease JOINED THE LIST WHEN THE PRINT LOOK WAS ASKED TO TEACH. Its
     prompt now tells her to build a mechanism he has never had built before
     saying what a number changed — and which those are is exactly what the map
     holds. Asking it to teach from a ladder it is not handed is the same shape
     the nightly pass was already fixed for: an instruction that outruns its
     inputs, and one that fails by teaching the wrong thing well rather than by
     failing at all. */
  for (const fn of ['postBriefing', 'postPulse', 'handleMessage', 'postConsolidation',
                    'postRelease']) {
    // Comments stripped, because the identifier appearing in prose about the
    // call is not the call. And `await` required: notesBlock is async, so an
    // un-awaited one interpolates "[object Promise]" into the prompt — which
    // reaches the model as text rather than as an error.
    const code = body(fn).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert.ok(reaches(code, 'notesBlock'),
      `${fn} never gets notesBlock() into the message it sends — an instruction ` +
      `he gave would be ignored, with nothing anywhere reporting it`);
    /* AND THE MAP, on the same four paths and for a sharper version of the same
       reason. Losing the notes costs continuity in one message; losing the map
       costs the only thing that says which channels are THIN, and it fails
       upward — she carries on teaching well, on whatever the day happens to be
       about, and the channel he has never once used stays never used with
       nothing anywhere reporting it. Worst on the nightly pass, which is also
       the only thing that can move a rung: without the map in front of it, it
       cannot see what it is moving from. */
    assert.ok(reaches(code, 'channelsBlock'),
      `${fn} never gets channelsBlock() into the message it sends — she would teach without knowing ` +
      `which channels are thin, and nothing would report it`);
  }
});

/* ─── The senses, and the copies they add ────────────────────────────────────
   005 brings five tables, a trigger and a hybrid search, and with them a fresh
   crop of vocabularies stated in two places: a `kind` the tool offers and the
   constraint refuses is a write that vanishes reported to nobody, which is the
   exact failure eugenia_channels' ids were already held together against.

   Every check below reads BOTH copies out of their files rather than either
   against a literal typed here. A literal is a third copy and would go stale
   with the other two.
   ─────────────────────────────────────────────────────────────────────────── */

// The values inside a `check (col in ('a', 'b'))`, whichever constraint it is.
const checkValues = (sql, constraint) => {
  const at = sql.indexOf(constraint);
  if (at < 0) return null;
  const clause = sql.slice(at, sql.indexOf('))', at));
  return [...clause.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
};

test('the kinds a loop may have are the kinds the table accepts', () => {
  const declared = checkValues(SENSES_SQL, 'eugenia_loops_kind_check');
  assert.ok(declared, '005 no longer constrains eugenia_loops.kind');
  assert.deepEqual([...LOOP_KINDS].sort(), declared,
    'index.ts offers a loop kind the table refuses, or the reverse — the first ' +
    'is a 400 she reports to nobody, the second is a value nothing can write');
});

test('the importance a release may carry is the one the table accepts', () => {
  const declared = checkValues(SENSES_SQL, 'eugenia_calendar_importance_check');
  assert.ok(declared, '005 no longer constrains eugenia_calendar.importance');

  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const offered = src.match(/importance: \{ type: "string", enum: \[([^\]]+)\]/);
  assert.ok(offered, 'the log_calendar tool no longer declares an importance enum');
  assert.deepEqual([...offered[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]).sort(), declared,
    'log_calendar offers an importance the table refuses, or the reverse');

  /* AND THE ONE THAT WAKES HER IS ONE OF THEM. The event spine selects on
     importance='high', so a rename on either side leaves a spine that matches
     nothing — every release filed, none of them ever looked at, and no error
     anywhere. */
  assert.ok(declared.includes('high'), 'nothing is filed as high, so the spine can never fire');

  /* READ OUT OF pendingRelease ITSELF, not out of the file. aheadToday filters
     on the same value, so a whole-file match stayed green while the spine's own
     filter was deleted — the query that decides whether she is ever woken by a
     print, answering for a query that decides what to mention in a message. */
  const at = src.indexOf('async function pendingRelease(');
  assert.ok(at > -1, 'doji-eugenia no longer has pendingRelease()');
  const spine = src.slice(at, src.indexOf('\n}', at));
  assert.match(spine, /importance=eq\.high/,
    'the release spine no longer filters on importance, so every medium and low ' +
    'entry filed all week would wake her');
  assert.match(spine, /looked_at=is\.null/,
    'the release spine no longer filters on looked_at, so one print is looked at ' +
    'every quarter of an hour until it ages out — each one a billed model call');
});

test('the verdicts a tap can carry are the verdicts the table accepts', () => {
  const declared = checkValues(SENSES_SQL, 'eugenia_feedback_verdict_check');
  assert.ok(declared, '005 no longer constrains eugenia_feedback.verdict');
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
  assert.ok(declared, '005 no longer bounds the thesis');
  assert.equal(THESIS_MAX, Number(declared[1]),
    'index.ts truncates the thesis at a different length than the table accepts — ' +
    'the longer side is a 400 on a write she reports as saved');
});

test('every table she reads or writes is one the schema creates', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const created = new Set([
    ...[...EUGENIA_SQL.matchAll(/create table public\.(\w+)/g)].map(m => m[1]),
    ...[...EUGENIA_SQL.matchAll(/create or replace view public\.(\w+)/g)].map(m => m[1]),
    ...[...SENSES_SQL.matchAll(/create table if not exists public\.(\w+)/g)].map(m => m[1]),
  ]);
  assert.ok(created.size >= 7, `only ${created.size} objects read out of the schema — the reader has gone blind`);

  const touched = new Set([...src.matchAll(/rest\/v1\/(eugenia_\w+)/g)].map(m => m[1]));
  assert.ok(touched.size >= 6, `only ${touched.size} tables read out of the function — the reader has gone blind`);
  for (const t of touched) {
    assert.ok(created.has(t),
      `doji-eugenia reads or writes ${t}, which neither 003 nor 005 creates — ` +
      `every call against it is a 404 the tool handlers turn into "that did not save"`);
  }
});

test('every column the cost meter writes is a column the table has', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const table = SENSES_SQL.match(/create table if not exists public\.eugenia_runs \(([\s\S]*?)\n\);/);
  assert.ok(table, '005 no longer creates eugenia_runs');
  const columns = new Set([...table[1].matchAll(/^\s{2}(\w+)\s+\w/gm)].map(m => m[1]));
  assert.ok(columns.size >= 8, `only ${columns.size} columns read out of eugenia_runs — the reader has gone blind`);

  const calls = [...src.matchAll(/recordRun\(\{([\s\S]*?)\}\)/g)];
  assert.ok(calls.length >= 3, `only ${calls.length} recordRun call sites — the reader has gone blind`);

  for (const [, body] of calls) {
    // Shorthand and long form both, since `cached` and `caller: label` sit in
    // the same literal. Comments stripped: a name in prose is not a key.
    // Parenthesised sub-expressions come out first: `Date.now() - started` and
    // `.slice(0, 500)` both carry commas that are not key separators, and
    // splitting naively reads "500" as a column name.
    let flat = body.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    for (let i = 0; i < 8 && /\([^()]*\)/.test(flat); i++) flat = flat.replace(/\([^()]*\)/g, '');
    const keys = flat.split(',').map(seg => seg.trim().match(/^(\w+)/)?.[1]).filter(Boolean);
    for (const k of keys) {
      assert.ok(columns.has(k),
        `recordRun writes "${k}" and eugenia_runs has no such column — PostgREST ` +
        `refuses the whole row, so the meter goes quiet and only the console says so`);
    }
  }
});

/* ─── A door in the schedule and a door in the code ──────────────────────────
   The two data-driven senses are reached by a query flag and nothing else, and
   the flag is written twice: in the cron job's URL and in the branch that reads
   it. They are the only two things in this system where a rename fails in
   COMPLETE silence — pg_net discards the response, so a `?move=1` nothing reads
   falls past every branch to "nothing due this hour", answers 200, and the sense
   simply stops existing. No apology, because nothing threw; no missing message,
   because the message was never due.
   ─────────────────────────────────────────────────────────────────────────── */

test('every flag a cron job calls with is a flag the function reads', () => {
  const eugenia = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const called = [...CRON_SQL.matchAll(/functions\/v1\/([\w-]+)\?(\w+)=(\w+)/g)];
  assert.ok(called.length >= 2,
    `only ${called.length} flagged cron URLs read — the reader has gone blind`);

  const at = eugenia.indexOf('async function postScheduled(');
  assert.ok(at > -1, 'doji-eugenia no longer has postScheduled()');
  const body = eugenia.slice(at, eugenia.indexOf('\n}', at));

  for (const [, fn, flag, value] of called) {
    assert.equal(fn, 'doji-eugenia',
      `a cron job calls ${fn} with a flag, and only doji-eugenia's doors are checked here`);
    assert.match(body, new RegExp(`searchParams\\.get\\("${flag}"\\) === "${value}"`),
      `a cron job calls ?${flag}=${value} and postScheduled never reads it — the ` +
      `job answers 200, nothing throws, and that sense quietly does not exist`);
  }

  // AND EACH DOOR REACHES ITS OWN WORK. A branch that reads the flag and then
  // falls through to the briefing would pass the check above.
  assert.match(body, /get\("release"\) === "1"\)\s*\{[^}]*postRelease\(\)/);
  assert.match(body, /get\("move"\) === "1"\)\s*\{[^}]*postMove\(\)/);
});

test('a vendor that refuses costs the vector, never the note or the turn', () => {
  /* embed() THROWS ON PURPOSE, so that `?embed=1` — a door run by hand and read
     for its answer — reports WHY nothing was filled rather than `ok: true,
     filled: 0`. No credit on the account, a key without the permission and a
     mistyped secret otherwise look identical, and the one place the reason was
     written is the Edge log this repository already says nobody reads.

     WHICH MAKES THE TWO WRITE PATHS THE ONES THAT MUST SWALLOW IT. A helper
     reached from a caught call site and a bare one is the exact shape that
     killed a briefing here once. This asserts the asymmetry is the intended one
     — the writers catch, the door does not — because getting it backwards means
     a vendor outage stops her remembering anything at all, silently, while the
     door that exists to report it stays cheerfully quiet. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  /* READ BY LINE RATHER THAN BY A REGEX OVER THE CALL. `embed(turns.map(t =>
     String(t.content)))` closes three parens, and a pattern that walks to the
     first one stops inside the argument — reporting the one call site that most
     needs the catch as though it had none. Each call is one statement on one
     line, so the line is the honest unit. */
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
  const at = src.indexOf('async function fillEmbeddings(');
  assert.ok(at > -1, 'doji-eugenia no longer has fillEmbeddings()');
  const body = src.slice(at, src.indexOf('\n}', at));
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
  /* TWO FILES, ONE OBJECT, AND NO BUILD STEP BETWEEN THEM. The poller folds a
     cTrader price into `Spot` and serves it; doji-eugenia declares `Quote` and
     reads the fields back out by name. Nothing resolves one against the other at
     runtime, so a field renamed on the poller's side reaches her as undefined —
     and the price sense would put "against a previous close of undefined" in
     front of him rather than failing.

     Both are read out of their own files. A list typed here would be a third
     copy, and would go stale with whichever of the two it stopped matching. */
  const poller = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');
  const eugenia = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

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

test('every column the price mark writes is a column the table has', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const table = SENSES_SQL.match(/create table if not exists public\.eugenia_price \(([\s\S]*?)\n\);/);
  assert.ok(table, '005 no longer creates eugenia_price');
  const columns = new Set([...table[1].matchAll(/^\s{2}(\w+)\s+\w/gm)].map(m => m[1]));
  assert.deepEqual([...columns].sort(), ['at', 'bid', 'id', 'looked_at'],
    'eugenia_price has changed shape and the sense reading it has not');

  /* THE MARK ADVANCES ON EVERY RUN AND `looked_at` DOES NOT, which is the whole
     of the cooldown: written unconditionally it would stamp on every quarter
     hour, the quiet gate would be permanently shut, and the sense would fire
     exactly once ever. Read out of markPrice rather than the file, since
     eugenia_calendar's own looked_at is written a few hundred lines above. */
  const at = src.indexOf('async function markPrice(');
  assert.ok(at > -1, 'doji-eugenia no longer has markPrice()');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /\.\.\.\(looked \? \{ looked_at:/,
    'markPrice writes looked_at unconditionally — every run stamps it, the quiet ' +
    'window never opens again, and she says one thing about a move and then ' +
    'nothing for the life of the deployment');
  assert.match(body, /bid, at: new Date\(\)\.toISOString\(\)/,
    'markPrice no longer advances the mark on every run, so the window a move is ' +
    'measured over stops being the gap between runs');
});

test('the trades trigger fires on the transition, not on every poll', () => {
  /* `is distinct from`, NEVER `<>`, and this is the same three-state trap
     trades_telegram_on_answer already documents. fill_time is null on every open
     position, so `old.fill_time <> new.fill_time` is NULL rather than true on
     exactly the transition this trigger exists for — a WHEN clause that is not
     true does not fire, and the close event would be the one that never
     happened. */
  const closed = SENSES_SQL.match(/create trigger trades_eugenia_closed[\s\S]*?execute function/);
  assert.ok(closed, '005 no longer creates trades_eugenia_closed');
  assert.match(closed[0], /old\.fill_time is null/);
  assert.match(closed[0], /is distinct from/);
  assert.ok(!/fill_time\s*<>/.test(closed[0]),
    'the close trigger compares fill_time with <>, which is NULL against an open ' +
    'position and therefore never fires');

  /* AND THE POLLER MUST NOT RE-FIRE IT. Every position in the window is
     re-upserted every two minutes, so an update trigger without a transition
     guard is a model call every two minutes for the life of the position. */
  const opened = SENSES_SQL.match(/create trigger trades_eugenia_opened[\s\S]*?execute function/);
  assert.ok(opened, '005 no longer creates trades_eugenia_opened');
  assert.match(opened[0], /after insert/);
  for (const t of [opened[0], closed[0]]) {
    assert.match(t, /new\.id like 'PID%'/, 'the trigger fires on pre-sync rows too');
    assert.match(t, /new\.deleted = false/, 'the trigger fires on soft-deleted rows');
  }
});

test('the trigger reads the cron secret under the spelling Vault holds', () => {
  // One value, two stores, two spellings, and Postgres compares the Vault name
  // case-sensitively. Gladys's trigger shipped reading the upper-case one and
  // went quiet without failing anything.
  assert.match(SENSES_SQL, /where name = 'doji_cron_secret'/,
    '005 reads the cron secret under a name Vault does not hold, so the trigger ' +
    'presents null and doji-eugenia answers 401 — silently, to nobody');
  assert.ok(!/DOJI_CRON_SECRET/.test(SENSES_SQL),
    '005 uses the Edge-secret spelling against Vault, which yields null');
});

test('the app reads only the three tables it was given a policy for', () => {
  const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const read = new Set([...app.matchAll(/\.from\('(eugenia_\w+)'\)/g)].map(m => m[1]));
  assert.ok(read.size, 'the app no longer reads anything of hers — the card is dead');

  for (const t of read) {
    assert.match(SENSES_SQL, new RegExp(`create policy ${t}_app_read on public\\.${t}`),
      `index.html reads ${t} and 005 grants the app no policy on it, so RLS ` +
      `returns an empty list and the card silently shows nothing`);
    assert.match(SENSES_SQL, new RegExp(`grant select on public\\.${t} to authenticated`),
      `index.html reads ${t} and 005 never grants select on it`);
  }

  /* AND HER NOTES STAY OUT OF IT. eugenia_notes and eugenia_turns are working
     memory; his window into them is /notes in her own thread, where an answer
     can be asked a question back. A policy on either would make the app a
     second reader of something 003 deliberately denies the publishable key. */
  for (const shut of ['eugenia_notes', 'eugenia_turns']) {
    assert.ok(!read.has(shut), `index.html now reads ${shut}, which is her memory`);
    assert.ok(!new RegExp(`create policy .*on public\\.${shut}`).test(SENSES_SQL),
      `005 opens ${shut} to the app, which 003 denies on purpose`);
  }
});

test('the hybrid search still answers in the shape the function reads', () => {
  /* THE RETURN TYPE IS LOAD-BEARING: `create or replace function` may not alter
     one, so widening it needs a `drop function` — which takes the grants with
     it. 005 replaces eugenia_search in place, and the columns searchList reads
     have to survive that. */
  const fn = SENSES_SQL.match(/create or replace function public\.eugenia_search[\s\S]*?\$\$;/);
  assert.ok(fn, '005 no longer replaces eugenia_search');
  assert.match(fn[0], /returns table \(source text, id bigint, at timestamptz, retired boolean, body text\)/,
    'the hybrid search changed the return type, which create or replace cannot do');

  // The trigram half is what catches a rephrasing, and word_similarity rather
  // than similarity is what makes it work against a long turn at all.
  assert.match(fn[0], /q <% n\.note/, 'notes are no longer reachable by trigram');
  assert.match(fn[0], /q <% t\.content/, 'turns are no longer reachable by trigram');
  assert.ok(!/\bsimilarity\(q,/.test(fn[0]),
    'plain similarity() normalises over both trigram sets, so a short question ' +
    'against a briefing-length turn scores near zero and every long turn is lost');
  assert.match(SENSES_SQL, /create extension if not exists pg_trgm/);
  for (const idx of ['eugenia_notes_trgm', 'eugenia_turns_trgm']) {
    assert.match(SENSES_SQL, new RegExp(`create index if not exists ${idx}[\\s\\S]*?gin_trgm_ops`),
      `${idx} is missing, so <% falls back to a sequential scan of the archive`);
  }
});

test('005 is safe to re-run, because it is the file that will grow', () => {
  // 003's CREATE TABLEs make it run-once by design. This one is meant to be
  // applied again, so anything that would refuse a second time is a bug.
  const creates = [...SENSES_SQL.matchAll(/^create (table|index|policy|trigger|extension|or replace)/gm)];
  assert.ok(creates.length >= 8, `only ${creates.length} statements read — the reader has gone blind`);
  for (const line of SENSES_SQL.split('\n')) {
    if (/^create (table|index) (?!if not exists)/.test(line)) {
      assert.fail(`005 has a bare "${line.split(' ')[1]}" — it would refuse on a ` +
                  `second run: ${line.trim()}`);
    }
  }
  assert.match(SENSES_SQL, /on conflict \(id\) do nothing/, 'the thesis seed is not idempotent');
});

/* ─── Semantic search, and the three ways it fails without saying so ─────────
   Nothing in this repository can reach a database or an embedding vendor, so
   what a vector actually RETRIEVES is not knowable from here — that shows up in
   use and nowhere else. What is knowable is the shape around it, and every one
   of these failures is silent by construction: the search keeps answering, and
   answers worse.
   ─────────────────────────────────────────────────────────────────────────── */

test('the width the vendor is asked for is the width the column accepts', () => {
  // A disagreement is a 400 on every write — every note, every turn, forever —
  // and the only place it would surface is a console nobody reads.
  const declared = SEMANTIC_SQL.match(/add column if not exists embedding vector\((\d+)\)/g);
  assert.ok(declared?.length === 2,
    `${declared?.length ?? 0} embedding columns declared in 007 — notes and turns both need one`);
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
  /* THE FLOOR UNDER THE SEMANTIC ARM. Every row written before 007 has a null
     embedding, and so does any row whose vendor call failed — none of them
     appears in a nearest-neighbour query, with no error and no log. Replacing
     the lexical arm with the vector one rather than fusing them would make half
     an archive unsearchable and look like a search that simply found nothing. */
  const fn = SEMANTIC_SQL.slice(SEMANTIC_SQL.indexOf('create function public.eugenia_search'));
  assert.match(fn, /websearch_to_tsquery/, 'the full-text arm is gone from the search');
  assert.match(fn, /word_similarity\(q,/, 'the trigram arm is gone from the search');
  assert.match(fn, /<%/, 'the trigram operator is gone, so its index is unused');

  // BOTH null guards, and each stops a different thing. Without the first a row
  // with no vector is ordered by a distance it does not have; without the
  // second every distance is null on an unset key, `order by null` returns
  // whatever the scan reaches first, and arbitrary rows enter the fusion.
  const arms = [...fn.matchAll(/where \w\.embedding is not null and \(select vec from ask\) is not null/g)];
  assert.equal(arms.length, 2,
    'a semantic arm no longer guards on both nulls — with no key it would feed ' +
    'arbitrary rows into the ranking rather than none');

  // And each arm is ranked where the distance is still in scope. A CTE's own
  // order is not carried out of it, so numbering the rows anywhere else is the
  // ranking replaced by whatever order the scan produced.
  assert.equal([...fn.matchAll(/row_number\(\) over \(order by dist\)/g)].length, 2,
    'a semantic arm is numbered by something other than its distance');
});

test('the search that is dropped is granted again in the same file', () => {
  /* 005 REPLACES THIS FUNCTION IN PLACE PRECISELY SO ITS GRANTS SURVIVE, and
     007 cannot: the query vector is a new argument, and `create or replace`
     cannot change an argument list. So the drop is deliberate — and a drop
     takes the grants with it, while a bare `create function` carries EXECUTE to
     PUBLIC, which `anon` inherits. Forgetting these two lines is a public
     entry point to her memory with only RLS behind it. */
  const at = SEMANTIC_SQL.indexOf('create function public.eugenia_search');
  assert.ok(at > -1, '007 no longer creates eugenia_search');
  /* THE `> -1` IS THE HALF THAT MAKES THIS A CHECK. Written as a bare position
     comparison it passed with the drop deleted outright — indexOf answers -1,
     which is duly less than everything, and the assertion that exists to catch
     a missing statement was satisfied by its absence. */
  const dropped = SEMANTIC_SQL.indexOf('drop function if exists public.eugenia_search(text, int)');
  assert.ok(dropped > -1 && dropped < at,
    'the old two-argument search is not dropped before the new one is created — ' +
    'the two are an overload, and a two-argument call matches both, which ' +
    'Postgres refuses as ambiguous');

  const after = SEMANTIC_SQL.slice(at);
  assert.match(after, /revoke all on function public\.eugenia_search\(text, int, text\) from public/,
    '007 creates the search and leaves EXECUTE granted to PUBLIC');

  /* AND FROM anon AND authenticated BY NAME, which is a SECOND revoke and not
     the same one written twice. `public` above is the PUBLIC pseudo-role; these
     two are granted EXECUTE separately by the default privileges Supabase sets
     on the public SCHEMA. Two different things spelled the same way — the live
     database answered 2 to "executable by anyone else" with the PUBLIC revoke
     in place, and had done since 003 created this function. */
  assert.match(after, /revoke all on function public\.eugenia_search\(text, int, text\) from anon, authenticated/,
    "007 revokes the search from PUBLIC and leaves it granted to anon and " +
    "authenticated, which is what Supabase's default privileges give every new " +
    'function in the public schema');
  assert.match(after, /grant execute on function public\.eugenia_search\(text, int, text\) to service_role/,
    '007 revokes the search from PUBLIC and never grants it to the one caller ' +
    'that needs it — every search would come back 403');
});

test('007 is safe to re-run, and the sweep names columns that exist', () => {
  for (const line of SEMANTIC_SQL.split('\n')) {
    if (/^create (table|index|extension) (?!if not exists)/.test(line)) {
      assert.fail(`007 has a bare "${line.split(' ')[1]}": ${line.trim()}`);
    }
  }
  // The function is create-not-replace, which is only re-runnable because the
  // drop above it is unconditional.
  assert.match(SEMANTIC_SQL, /drop function if exists public\.eugenia_search\(text, int, text\)/,
    '007 creates the three-argument search without dropping it first, so a ' +
    'second run refuses');

  /* AND THE BACKFILL'S TABLE AND COLUMN ARE A PAIR THAT HAS TO BE REAL. It
     builds its URL from arguments, so the reader that checks every
     `rest/v1/eugenia_*` cannot see these two — a mistyped column here is a 400
     on a maintenance door nobody runs twice. */
  const calls = [...EUGENIA_TS.matchAll(/fillEmbeddings\('(\w+)', '(\w+)'\)/g)]
    .map(m => `${m[1]}.${m[2]}`);
  assert.ok(calls.length >= 4, `only ${calls.length} sweep call sites — the door and the nightly pass both call it`);
  for (const pair of new Set(calls)) {
    const [table, column] = pair.split('.');
    assert.match(EUGENIA_SQL, new RegExp(`create table[^;]*?public\\.${table}[^;]*?\\n\\s+${column}\\s`),
      `the sweep reads ${table}.${column} and 003 creates no such column`);
    assert.match(SEMANTIC_SQL, new RegExp(`alter table public\\.${table} add column if not exists embedding`),
      `the sweep fills ${table}.embedding and 007 never adds it`);
  }
});

test('the answer is his before it is ever spoken', () => {
  /* THE ORDER IS THE WHOLE SAFETY OF THIS PATH. say() first, speak() after —
     so an unset key, a vendor that refused, or a format Telegram will not
     render costs the audio and nothing else. Reversed, a speech call that hung
     would hold the reply behind it, and one that threw would lose it: he asked
     a question aloud and got silence, which is the failure VOICE_TROUBLE exists
     on the other side of.

     Read as positions in the handler rather than as a call anywhere in the
     file, because both are called exactly once and only their ORDER is wrong. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('async function handleMessage(');
  assert.ok(at > -1, 'doji-eugenia no longer has handleMessage()');
  const body = src.slice(at);

  const said = body.indexOf('await say(answer);');
  const spoke = body.indexOf('await speak(answer)');
  assert.ok(said > -1, 'handleMessage no longer sends the answer as text');
  assert.ok(spoke > -1, 'handleMessage never speaks the answer');
  assert.ok(said < spoke,
    'handleMessage speaks before it sends the text, so a speech vendor that ' +
    'hangs or throws costs him the answer rather than the audio');

  // AND IT IS GATED, not spoken every time. Without this every typed line comes
  // back as a voice note he did not ask for.
  assert.match(body.slice(said, spoke + 40), /if \(speaksBack\(answer, heard\)\)/,
    'the answer is spoken unconditionally rather than only when he spoke first');
});

test('the audio is asked for in the one format Telegram renders as a voice note', () => {
  /* THE ONLY THING ON THIS PATH THAT WOULD FAIL QUIETLY. The vendor's default
     is mp3, and mp3 WORKS: the request succeeds, Telegram accepts the file, and
     it arrives as an attachment — no waveform, no speed control, no playing it
     with the phone at your ear. Nothing errors and nothing logs; the feature
     simply stops being the thing it was built for, which is the one failure
     shape a person would not think to report as a bug. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('async function speak(');
  assert.ok(at > -1, 'doji-eugenia no longer has speak()');
  const body = src.slice(at, src.indexOf('\n}', at));

  assert.match(body, /response_format: "opus"/,
    'the speech request no longer asks for opus — mp3 succeeds and arrives as a ' +
    'file attachment rather than a voice note, silently');
  assert.match(body, /type: "audio\/ogg"/,
    'the upload no longer declares audio/ogg, so Telegram has only the filename ' +
    'to go on');
  assert.match(body, /"reply\.ogg"/,
    'the upload no longer carries an .ogg filename');
});

test('the length she is told to write to is the length that is spoken', () => {
  /* TWO COPIES OF ONE NUMBER, and the failure of a disagreement is silent in
     the worse direction: a prompt allowed to run longer than the cap produces
     answers that are simply never spoken, and nothing tells him the audio was
     dropped rather than never attempted. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  assert.match(src, /Keep it under \$\{SPEAK_MAX\} characters/,
    'the instruction states a length as a literal rather than reading SPEAK_MAX, ' +
    'so the two can disagree with nothing to reveal it');
});

test('every reason a voice note fails is one the handler can actually reach', () => {
  /* A SENTENCE NOTHING SELECTS IS A SENTENCE NOBODY READS, and the reverse is
     worse — a key looked up in the map and not defined there renders as
     `undefined` to him. Both halves, because either alone goes green while the
     feature is broken in the other direction. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

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

  /* AND THE FORMAT IS DECLARED BOTH WAYS. Telegram hands over `audio/ogg` and
     the file's own extension; the services that speak this API shape differ in
     which of the two they read the format off, so sending only one is a bet on
     which provider is behind STT_URL. Both is the portable answer, and the
     content type is the half that looks redundant and would be tidied away. */
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
  /* A READ-ONLY FLAG LEFT OUT OF THE GATE ANSWERS "market closed" AT THE
     WEEKEND, which is precisely when it is reached for: a suspicious row gets
     looked at on a Saturday, and the debug surface that exists to answer the
     question replies that there is nothing to poll. The failure is silent, it
     looks like the flag working, and it is invisible five days a week.

     So the list is held against itself rather than against a literal here:
     every flag the entry point reads must appear in the gate, whether it is
     read-only or not. Adding one and forgetting it is the whole failure. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

  // Any compared value, not only "1": ?market=raw is a second flag on the same
  // parameter, and a pattern anchored on "1" would have skipped it — leaving
  // the one that answers "market closed" all weekend unchecked.
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
  // Both read-only flags return a Response, and both must do it before the
  // fold and the upsert are reached — a debug surface that writes on the way
  // to answering is not a debug surface.
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

  const write = src.indexOf('const data = await mcpCall(sid, "get_deals", dealArgs)');
  assert.ok(write > -1, 'the poller no longer folds the deals it was about to write');

  for (const [flag, marker] of [['raw', 'if (raw) {'], ['tools', 'if (tools) {']]) {
    const at = src.indexOf(marker);
    assert.ok(at > -1, `the poller no longer answers ?${flag}=1`);
    assert.ok(at < write,
      `?${flag}=1 is answered after the poll has already folded its deals`);
  }

  /* AND tools/list GOES PAST THE ALLOW-LIST RATHER THAN THROUGH IT, which is
     correct and worth stating: ALLOWED_TOOLS guards a tool NAME becoming a
     request, and `tools/list` names none. What must stay true is that it
     discovers tools without calling one. */
  const block = src.slice(src.indexOf('if (tools) {'), write);
  assert.match(block, /method: "tools\/list"/);
  assert.ok(!/tools\/call/.test(block),
    'the tools probe calls a tool it discovered, which is exactly what the ' +
    'allow-list exists to prevent');
});

/* ─── Nothing this function can call may place a trade ───────────────────────
   `?tools=1` established what the broker's endpoint actually offers, and the
   answer has two halves. It serves prices, which is why ALLOWED_TOOLS grew. It
   also serves create_order, close_position, amend_position, amend_order and
   cancel_order — on the same credential, reachable by the same token.

   So the read-only guarantee this repository states about the poller is not a
   property of the key. It is a property of one array in one file, and the
   failure mode of editing it carelessly is not a bug report.
   ─────────────────────────────────────────────────────────────────────────── */

test('the poller can call nothing that would place, move or close a trade', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

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

  /* AND EVERY READ STILL GOES THROUGH THE CHECK. The list is inert if the one
     place a tool name becomes a request stops consulting it — which is a
     likelier regression than someone typing create_order into the array. */
  assert.match(src, /if \(!ALLOWED_TOOLS\.includes\(tool\)\) throw/,
    'mcpPost no longer enforces the allow-list, so the array is decoration');

  // Nowhere in the file may a destructive name appear as a call, whatever the
  // array says — the probes call tools directly and must not be a way round it.
  for (const t of destructive) {
    assert.ok(!new RegExp(`mcpPost\\(sid, "${t}"|mcpCall\\(sid, "${t}"|name: "${t}"`).test(src),
      `doji-mcp-sync calls ${t} somewhere, bypassing the allow-list entirely`);
  }
});

test('every tool the poller may call is one it actually calls or probes', () => {
  // A name in the array that nothing reaches is a widening with no feature
  // behind it — which is the shape a destructive tool would arrive in if one
  // ever did, since it would be added "for later" rather than used.
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');
  const allowed = [...src.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\] as const;/)[1]
    .matchAll(/"(\w+)"/g)].map(m => m[1]);

  for (const t of allowed) {
    assert.match(src, new RegExp(`(mcpPost|mcpCall)\\(sid, "${t}"`),
      `ALLOWED_TOOLS permits ${t} and nothing in the file ever calls it`);
  }
});

/* ─── The two columns with two claimants are settled inside the UPDATE ───────
   `balance` and the plan are the only columns here two writers both reach for,
   and both are arbitrated the same way: a filter in the URL, evaluated by
   Postgres inside the UPDATE, so there is no read to lose a race with.

   Losing either filter is silent in the way that matters. The poller re-reads
   every open position for the life of the position, and R-04 moves the stop to
   break-even partway through — so an unfiltered write files the break-even stop
   as the plan, and the plan is then the thing it exists to be compared against.
   The number is present, plausible and wrong. `balance` fails the same way
   against the figure the broker printed on the fill.

   Read out of each function body rather than out of the file: both filters are
   one clause in one template literal, and a whole-file match for `is.null` is
   answered by the other function's copy. */

test('the two columns with two claimants are filtered inside the UPDATE', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

  for (const [fn, col] of [['writeBalance', 'balance'], ['writePlan', 'planned_sl']]) {
    const at = src.indexOf(`function ${fn}(`);
    assert.ok(at > -1, `doji-mcp-sync no longer has ${fn}()`);
    const body = src.slice(at, src.indexOf('\n}', at));

    assert.match(body, new RegExp(`${col}=is\\.null`),
      `${fn} writes with no ${col}=is.null filter, so it writes on every poll — ` +
      `the last sighting wins a column where the first one is the whole point`);
    assert.match(body, /method: "PATCH"/,
      `${fn} no longer PATCHes, and an upsert under merge-duplicates sets every ` +
      `key it is handed — the filter in the URL would not be consulted at all`);
  }
});

test('Eugenia reaches a price through the poller and never holds the broker token', () => {
  /* THE SAME ENDPOINT THAT SERVES A PRICE SERVES create_order. So the market
     read is deliberately not hers to make: doji-mcp-sync holds
     CTRADER_MCP_TOKEN and will only ever answer with a quote, and she presents
     the cron secret she already has. Giving her that token to save a hop would
     put a market order one prompt injection away from the bot whose entire
     product is that she gives no signals.

     Structural, not instructed — the same shape as her having exactly one
     database read of the journal and no write path to it. */
  const eugenia = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  /* THE READ, NOT THE MENTION. The comment above readMarket explains at length
     why she does not hold this token, and a bare name match fired on the
     explanation — a test that forbids saying the word rather than doing the
     thing, which would push the reasoning out of the file to stay green. */
  assert.ok(!/env\(\s*["']CTRADER_/.test(eugenia),
    'doji-eugenia reads a cTrader credential — the market read must go through ' +
    'the poller, which is the only function that may hold one');
  assert.ok(!/mcp\.ctrader\.com/.test(eugenia),
    'doji-eugenia addresses the broker directly, bypassing the allow-list that ' +
    'is the only thing keeping create_order out of reach');

  // And it reaches a function that exists, by a path this repository deploys.
  const url = eugenia.match(/const MARKET_URL = `\$\{SB_URL\}\/functions\/v1\/([\w-]+)/);
  assert.ok(url, 'doji-eugenia no longer builds a market URL from SB_URL');
  assert.ok(DEPLOYED.includes(url[1]),
    `doji-eugenia reads a price from /functions/v1/${url[1]}, which is not a ` +
    `function this repository deploys — every call is a 404`);
  assert.match(eugenia, /MARKET_URL[\s\S]{0,400}?x-doji-key/,
    'the market read presents no secret, so the poller will refuse it 401');
});
