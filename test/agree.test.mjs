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
import { CONSOLIDATE, SYSTEM, PITCH } from '../supabase/functions/doji-eugenia/prompt.ts';
import { BE, SESSIONS, MARKETS } from '../supabase/functions/doji-eugenia/journal.ts';

const SCHEMA = readFileSync(new URL('../supabase/001_trades.sql', import.meta.url), 'utf8');
const GLADYS_SQL = readFileSync(new URL('../supabase/002_gladys.sql', import.meta.url), 'utf8');
const EUGENIA_SQL = readFileSync(new URL('../supabase/003_eugenia.sql', import.meta.url), 'utf8');
const SENSES_SQL = readFileSync(new URL('../supabase/005_eugenia_senses.sql', import.meta.url), 'utf8');
const CRON_SQL = readFileSync(new URL('../supabase/004_cron.sql', import.meta.url), 'utf8');
const SEMANTIC_SQL = readFileSync(new URL('../supabase/007_semantic.sql', import.meta.url), 'utf8');
const SCHEMA_008 = readFileSync(new URL('../supabase/008_sync_health.sql', import.meta.url), 'utf8');
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

/* ─── The row as TWO files describe it ───────────────────────────────────────
   `TradeRow` says in its own comment that it is the row eugenia_trades serves,
   and it is the type every rule in adherence.ts is written against — so a
   column the view gained and the interface did not is a column no rule can
   name, invisibly. That is exactly what happened: 006 appended the plan to the
   view and TradeRow went on describing the row without it for two releases.

   IT MATTERS MORE NOW THAT A READ ASKS FOR `select=*`. readDesk takes whatever
   the view serves precisely so the column list is not copied a fourth time —
   which makes this interface the only description of what comes back, and a
   wrong one indistinguishable from a right one at runtime.
   ─────────────────────────────────────────────────────────────────────────── */

test('TradeRow names exactly the columns the view serves', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/adherence.ts', import.meta.url), 'utf8');
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

/* ─── The grant list is a fourth copy of what the app may write ──────────────
   009 says the boundary to the database, and saying it added three more places
   that state the same five column names: the `grant update (…)` itself and the
   two arrays in verify.sql that check it. They have to agree with the app or the
   file is wrong in one of two directions, and both are quiet.

   Too NARROW and the journal cannot be filled in — a revoke lands, the grant
   misses a column, and every save fails with a 403 that reads as the app being
   broken rather than as this being mis-stated. Too WIDE and the file has done
   nothing: one broker column in that list and `net_pnl` is writable from the
   browser console again, with every test here still green.

   FIVE, NOT FOUR, AND THE FIFTH IS THE INTERESTING ONE. `Data.OWNED` holds the
   four journal answers. `deleted` is not one of them and is deliberately on the
   never-reachable list two tests above — no tap and no save may ever name it —
   but the app does write it, through `remove()` and `undo()`, which call
   `update()` directly. So a grant list derived from `Data.OWNED` alone reads as
   obviously right and takes delete and undo out the moment it is applied.
   ─────────────────────────────────────────────────────────────────────────── */

test('the columns 009 grants are exactly the columns the app writes', async () => {
  const grants = readFileSync(new URL('../supabase/009_trades_grants.sql', import.meta.url), 'utf8');
  const verify = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');

  const stated = grants.match(/grant update \(([^)]*)\)\s*\n?\s*on public\.trades/);
  assert.ok(stated, '009 no longer grants update on any column of trades');
  const granted = stated[1].split(',').map(c => c.trim()).sort();

  const { app, close } = await boot();
  try {
    const want = [...app.Data.OWNED, 'deleted'].sort();
    assert.deepEqual(granted, want,
      'the grant in 009 and what the app actually writes have parted — too narrow ' +
      'and the journal cannot be saved, too wide and a broker column is writable ' +
      'from the browser again');

    // The app writes `deleted` outside OWNED, which is the whole reason the list
    // is five. If that stopped being true the fifth grant would be dead.
    const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(src, /update\(\{ deleted: true \}\)/,
      'nothing sets deleted any more, so 009 grants a column the app never writes');
    assert.match(src, /update\(\{ deleted: false \}\)/, 'undo no longer clears deleted');
  } finally { close(); }

  /* verify.sql states the same five twice — once as the columns that must NOT be
     writable (by exclusion) and once as the ones that must. Both are read here
     rather than one, because the exclusion list is the half that silently stops
     protecting anything: add a broker column to it and the check still says 0. */
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
  // not revoking from the others — the lesson `eugenia_search` cost 007.
  assert.match(grants, /revoke insert, update, delete on public\.trades\s+from public, anon, authenticated;/,
    '009 revokes from fewer than all three of PUBLIC, anon and authenticated, so ' +
    'the privilege survives under whichever name was left out');
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

/* ─── verify.sql is fatal on error, which makes a stale name expensive ───────
   Nothing in this suite sees the live database, so verify.sql is the only check
   on it — and it is one query returning one row per fact, which means an ERROR
   is not a failed row. It aborts the statement, and every check below the line
   that threw silently stops running.

   THAT IS EXACTLY WHAT HAPPENED. A row asked has_function_privilege about
   `public.eugenia_search(text, int)`, the signature 003 created and 007
   deliberately dropped for the three-argument one. A text signature that does
   not resolve raises 42883 rather than returning false, so from the day 007 was
   applied the file died at that line, eleven checks below it never ran, and the
   whole run reported itself as a fault in the database.

   SO THE RULE IS ABOUT THE FORM, NOT ABOUT THAT NAME. Postgres has a
   non-throwing way to ask about a function — an oid from pg_proc, or
   to_regprocedure, which answers NULL — and the throwing forms are a text
   signature and a regprocedure cast. Neither belongs in a file whose errors
   take the rest of it with them.
   ─────────────────────────────────────────────────────────────────────────── */

test('verify.sql expects exactly the triggers the numbered SQL creates on trades', () => {
  /* THE SECOND THING THE STALE SIGNATURE HID. This row expected three triggers
     — 001's touch and 002's two — and 005 added the event spine's two without
     anyone changing it. Because it sits below the line that was aborting the
     file, it had never once run, so the drift lived from 005 to now and then
     announced itself as a correct database being wrong.

     Both halves are read out of files. The expected list is whatever verify.sql
     names today, and the truth is every `create trigger` in the numbered SQL
     whose target is public.trades — so adding a trigger and forgetting the
     check fails here, which is the round trip nothing was making. */
  const sql = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');

  const expected = sql.match(
    /\('exactly the five triggers on trades'[\s\S]*?\),\s*\n((?:\s*'[^']*'(?:\s*\|\|)?\s*\n?)+)\),/);
  assert.ok(expected, 'verify.sql no longer states the trigger list — the reader has gone blind');
  const named = expected[1].match(/'([^']*)'/g).join('').replace(/'/g, '')
    .split(',').map(t => t.trim()).filter(Boolean).sort();

  /* `create trigger` and `create or replace trigger` both, and the target table
     is on a later line — 002 uses the replace form because a plain create is
     not atomic against an existing one. */
  const created = [...NUMBERED.matchAll(
    /create\s+(?:or\s+replace\s+)?trigger\s+(\w+)\s+[\s\S]{0,120}?\bon\s+public\.trades\b/gi)]
    .map(m => m[1]).sort();

  assert.ok(created.length >= 3,
    `only ${created.length} triggers on trades read out of the SQL — the reader has gone blind`);

  assert.deepEqual(named, created,
    'verify.sql expects a different set of triggers on trades than the numbered ' +
    'SQL creates — run against a correct database it reports a fault, and run ' +
    'against a database missing one it reports nothing');
});

test('verify.sql names no function in a form that throws when it is gone', () => {
  const sql = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');
  assert.ok(sql.length > 1000, 'verify.sql could not be read — the reader has gone blind');

  /* A quoted `public.name(args)` is the shape has_function_privilege and
     to_regprocedure both take, and the first of those throws on a miss. The
     safe forms name no arguments at all, so a signature literal anywhere in
     this file is the defect regardless of what consumes it. */
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
   She is handed his entry, his stop and his target on six paths now, and the
   only thing between that and her quoting them back at him every morning is a
   rule in the prompt. There is no structural half here — unlike the broker
   token she does not hold, or the write path to `trades` that does not exist —
   because the whole point of giving her the numbers is that she can use them
   when he ASKS.

   So the failure is a briefing that opens on the level he is long from. It
   reads as her being relevant, keeps every prohibition she has, and quietly
   makes the morning about his position rather than about the day. Deleting the
   paragraph breaks nothing anywhere else.
   ─────────────────────────────────────────────────────────────────────────── */

test('the prompt keeps his levels out of a message she starts', () => {
  /* Read with the wrapping collapsed. The prompt is hard-wrapped at 84 columns
     and a sentence that fits on one line today sits across two the moment a
     word is added ahead of it — so a literal match here would go red on an edit
     that changed nothing about the rule. */
  const said = SYSTEM.replace(/\s+/g, ' ');

  assert.match(said, /HIS LEVELS DO NOT APPEAR IN A MESSAGE YOU START/,
    'the prompt no longer keeps his entry and his stop out of a message she ' +
    'opens — she has them on every path and nothing now says not to lead with them');

  /* AND THE ONE REFUSAL. Everything else about an open position she may discuss
     when he raises it; this is the sentence that keeps the discussion short of
     advice, and it is the whole of the prohibition on the path where he is most
     likely to want one. */
  assert.match(said, /any statement about what to DO with the position/,
    'the prompt no longer refuses trade management on the open position, which ' +
    'is the one thing the block was not built to enable');
});

test('she is told which two discipline columns lean, and where they lean', () => {
  /* THE BIAS IS A PROPERTY OF THE COLUMN, NOT OF THE READING. followed_sl and
     followed_tp are answered seconds after the fill, so they say what he meant
     to do; they measure respect only where he goes back and corrects one, and a
     correction he never made reads as compliance. Nothing on the row separates
     the two.

     It was stated at the trigger that asks the question and in the README's
     account of it, and in neither place a reader of the FIGURE would look — so
     she could report a stop-discipline rate off the view with no idea it leans,
     which is the same failure as presenting a judgment rule's silence as a pass.
     Read here because there is no structural half: delete the paragraph and
     nothing breaks, and the number she gives still reads as a measurement. */
  const said = SYSTEM.replace(/\s+/g, ' ');

  assert.match(said, /answered at OPEN/,
    'the prompt no longer says the two stop and target answers are given at ' +
    'open, so she has no reason to doubt a rate computed from them');
  assert.match(said, /bias(es)? upward|lean/,
    'the prompt names when the answers are given but not which way that pushes ' +
    'them, which is the half that changes what she may claim');
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
  const pitched = [...PITCH.matchAll(/^\| `([a-z]+)` \| /gm)].map(m => m[1]);
  assert.deepEqual(pitched, declared,
    'the strategy pitches at a different set of rungs than the map carries');
});

/* ─── The table she is handed, not the one she could fetch ───────────────────
   THE TABLE WAS ALWAYS WELL-FORMED AND WAS NEVER READ, which is the exact shape
   this repository keeps re-learning: the test above proved a row per rung and
   proved nothing about whether the rows reach her.

   §0 below its summary is `get_strategy`-only, and no prompt on any path tells
   her to fetch it — so the one rule deciding how every explanation is pitched
   sat in a section nothing opened. What she actually held was a pair of ends
   quoted in two prompts, and the bottom of those is a rung `setChannel` refuses
   to write back. She stopped building the week each channel was first mentioned
   and could never start again, and every message after that was her following
   the instruction she had.

   So this asserts the table is IN the cached prefix, and that §0 serves the same
   characters rather than a second copy of them.
   ─────────────────────────────────────────────────────────────────────────── */
test('the rule that decides how a term is pitched is in her context, not fetchable', () => {
  assert.ok(SYSTEM.includes(PITCH),
    'the pitch table is no longer in the system prompt — it would be reachable ' +
    'only through get_strategy, which nothing instructs her to call, so every ' +
    'explanation would be pitched from the two ends the prompts happen to name');

  assert.ok(SECTIONS['0'].includes(PITCH),
    '§0 no longer serves the same table she is handed — a second copy of the one ' +
    'rule that decides how she teaches, with nothing comparing them');

  /* AND THE MIDDLE RUNGS CARRY AN INSTRUCTION, which is the half that was
     missing rather than wrong. `unseen` stops being true permanently the first
     time a subject comes up and `owns` is the far end; everything real sits
     between them, and a table silent there leaves the binary rule standing. */
  for (const rung of ['explained', 'used']) {
    const row = PITCH.split('\n').find(l => l.startsWith(`| \`${rung}\``));
    assert.ok(row && row.replace(/\|/g, '').trim().length > rung.length + 30,
      `the ${rung} rung has no instruction against it, so the ladder is once ` +
      `again a pair of ends — and that is the rung nearly every channel sits at`);
  }
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

/* ─── Every CSS rule is reachable, and the scan that says so was proved first ─
   The audit scanned CONFIG keys, declarations and `id` attributes; it never
   scanned CSS RULES, so a selector whose class stopped being emitted has been
   invisible for the life of the file. It fails in the quietest way available —
   the rule stays, costs nothing, matches nothing, and reads as styling for
   something that exists.

   THE FIRST VERSION OF THIS REPORTED A CLEAN FILE AND WAS BROKEN, which is the
   fourth time that has happened here and the reason the proof is written down.
   Two ways it went blind:

     · Substring matching. `.win` is "found" inside `window`, and the audit's own
       scan had `"poll"` matching a paragraph about the poller. Names are matched
       as whole tokens now, bounded by anything that is not a name character.

     · A prefix sitting before a quote counted as dynamic construction. Every
       class in the file sits before a quote somewhere, so `.watch-movedx` —
       planted by renaming a live rule — "matched" `class="watch-moved">` and was
       waved through as built at runtime. A name assembled at runtime appears as
       a literal prefix that ENDS where the variable begins: `'sess-wr-' + key`
       or `` `sess-wr-${key}` ``. So the prefix must be quote-terminated or
       followed by `${`, and must end at a dash.

   Proved against three planted defects — an invented rule, a live rule renamed
   in the stylesheet only, and a rule mentioned nowhere but a comment — and
   against a fourth that must NOT be flagged, an invented `.sess-wr-*` that a
   real prefix reaches. Comments are stripped from the searched text for the
   same reason the third case exists.
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
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const got = deadRules(src);

  // WITHOUT THESE THE ASSERTION BELOW PASSES ON A PARSER THAT FOUND NOTHING,
  // which is how a scan reports a clean file three times running and is wrong
  // every time.
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
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const plant = (css, js = '') =>
    src.replace('</style>', `${css}\n</style>`).replace('const $ = id =>', `${js}\nconst $ = id =>`);

  // An invented rule nothing anywhere mentions.
  assert.deepEqual(deadRules(plant('.doji-zzz-orphan{color:red}')).dead, ['.doji-zzz-orphan'],
    'the scan cannot see a selector that is styled and never emitted');

  // A LIVE rule renamed in the stylesheet only — the shape a rename actually
  // leaves, and the one the first version of this scan waved through.
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

  /* A NAME THAT IS A SUBSTRING OF A LIVE ONE, which is the case the other three
     cannot separate. `.hm` appears inside `hm-profit` on the page and never once
     as a class of its own, so a scan matching substrings calls it reachable and
     a scan matching tokens calls it dead. Without this the whole proof passes on
     `rest.includes(name)` — the loosest possible reader — and the audit's `poll`
     failure would be reproduced here with nothing saying so. */
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
   The companion to the rule scan above, and it catches the likelier shape by
   far: not a function somebody wrote and never called, but a live one whose
   last CALLER was deleted. `render()` is a list of eight steps, and removing a
   line from that list leaves the renderer it named intact, exported to the
   harness, still passing its own tests, and reached by nothing on the page.

   IT READS index.html ALONE, DELIBERATELY. A function the test harness still
   names in `EXPOSED` but the app no longer calls is dead in the app, and a scan
   that counted the harness would call it live and be wrong in the direction
   that matters.

   Known limitation, stated rather than worked around: string contents are not
   stripped, so a declaration mentioned only inside a string literal reads as
   referenced. Stripping them properly needs a JS parser — a template literal
   holds real code inside `${}` — and no function in this file is named in a
   string. Comments ARE stripped, which is the case that actually occurs.
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
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const got = unreferenced(src);

  assert.ok(got.declared > 80,
    `only ${got.declared} declarations found — the reader has gone blind`);
  assert.deepEqual(got.dead, [],
    `declared and reached by nothing:\n  ${got.dead.join('\n  ')}\n` +
    `Delete it and everything it owned — the CONFIG entry, the CSS, the README ` +
    `paragraph, the harness export and every call site, same pass.`);
});

test('the unreferenced-declaration scan can actually find one', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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

  /* THE ONE THAT ACTUALLY HAPPENS: a live renderer whose only caller is dropped
     out of render()'s step list. Nothing else in the suite notices — the
     function still exists, still passes its own tests, and is still exported to
     the harness; it is simply never reached from the page. */
  assert.ok(unreferenced(src.replace('    () => renderSetups(rows),\n', '')).dead
    .includes('renderSetups'),
    'dropping a step from render() leaves its renderer unreferenced and unseen');
});

/* ─── verify.sql's header counts its own checks ──────────────────────────────
   It was a FOOTER, and the footer was a paragraph for someone already lost:
   they ran the whole file, the editor showed them the last of ten statements,
   and the checks they came for scrolled past unseen. It told them how many were
   thrown away — and it said fifty-seven while the summary held sixty, which is
   a file describing itself wrongly in the one place read under confusion.

   The file is one statement now and the listings are `diagnose.sql`, so nobody
   arrives at the bottom lost and the count belongs where it is read BEFORE
   running instead. The number still has to be right, and for the same reason.

   The number is a digit rather than a word so it can be compared. This
   repository has been bitten by a stale count twice already; CLAUDE.md's
   preference for a name or a `string_agg` over a count does not help here,
   because the thing being stated IS a quantity. So it is counted instead.

   The rows are matched on their shape in the VALUES list — `('check name',` at
   two spaces of indent — and the count is bounded below as well as compared, so
   a pattern that stopped matching reports a broken reader rather than agreeing
   with a footer that says zero.
   ─────────────────────────────────────────────────────────────────────────── */

test('verify.sql says how many checks it runs, and runs that many', () => {
  const sql = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');

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

  /* AND ONCE. A second copy of the count is a second thing to update, held
     together by nothing — the first stayed right while the sentence explaining
     WHY it is a digit carried the previous release's number, in the same
     paragraph, four lines below it.

     The numbered files are named in this paragraph (001, 002, 003, 004) and are
     not counts, so they come out first — by their three-digit shape rather than
     by a list, which would need extending the day a 011 is written. */
  const others = (header.replace(/\b0\d{2}\b/g, '').match(/\b\d{2,}\b/g) || [])
    .filter(n => n !== stated[1]);
  assert.deepEqual(others, [],
    `the header states a second number (${others.join(', ')}) beside its count of ` +
    `${stated[1]} — one paragraph, one copy, or the spare one goes stale unwatched`);
});

/* ─── No colour is written in the script, only read from a token ─────────────
   The palette is tokenised in CSS, and the rule that nothing in the script
   writes a colour is what keeps light and dark honest: a hex typed into a chart
   config is invisible to the stylesheet, so it survives a theme change, a
   palette revision and every review that reads the CSS to see what a colour is.

   Chart.js cannot read a CSS variable, which is exactly why `cssToken()` exists
   and why the temptation is real — the fix for "the chart needs a colour" looks
   like typing one. Every value it needs is resolved through `cssToken()` into a
   module constant instead.

   The rule was stated in CLAUDE.md and enforced by nothing. Comments are
   stripped first: a comment naming a token's value is documentation, not a
   colour being written, and failing on one would push the next author to delete
   the explanation rather than the literal.
   ─────────────────────────────────────────────────────────────────────────── */

test('the client writes no colour of its own, and reads them all through cssToken', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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
   The doors are `?force=1`, `?raw=1`, `?consolidate=1` and the rest: query
   parameters that exist so a person can exercise a path by hand when something
   has gone wrong. A door nobody can find is a door that does not exist — it is
   reached at exactly the moment nobody is going to read the source to discover
   it.

   `?pulse=1` was that door. The pulse itself has a section of its own; the way
   to fire one by hand appeared nowhere, while every sibling door was written
   down. Worse, the table stating WHAT A HOLDER OF THE CRON SECRET CAN CAUSE
   named two of the six on `doji-eugenia` and omitted `?consolidate=1`, which
   runs the nightly pass and WRITES her memory. That table exists because "the
   worst case is nothing" was once the sentence that stopped anyone checking the
   worst case.

   Matched on the door name rather than on prose about the feature: the pulse
   was discussed at length in a section that never says how to fire one.
   ─────────────────────────────────────────────────────────────────────────── */

test('every door a function opens is written down in the README', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  const doors = new Set();
  for (const fn of DEPLOYED) {
    const src = readFileSync(
      new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8');
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

/* ─── No paragraph is said to her twice ──────────────────────────────────────
   `prompt.ts` and `strategy.ts` are the two files where prose IS the program,
   and a duplicated passage there is worse than a duplicated function. It is
   sent on every request; it is in the CACHED prefix, so it is paid for and
   carried whether or not it is read; and the day someone sharpens one copy the
   model is handed the sharpened instruction and the blunt one together, with
   nothing anywhere reporting a contradiction.

   Fourteen identical lines were sitting in `prompt.ts` — the whole passage
   about every quote figure being measured from the 17:00 New York roll, stated
   twice in a row. Nothing could have caught it: there is no compiler for prose,
   the tests that read this file look for phrases rather than for repetition, and
   a prompt reads perfectly well with a paragraph in it twice.

   Six lines, because that is long enough that no two paragraphs arrive at it by
   coincidence and short enough to catch a passage repeated in part.
   ─────────────────────────────────────────────────────────────────────────── */

test('no passage of the prompt or the strategy is stated twice', () => {
  for (const file of ['prompt.ts', 'strategy.ts']) {
    const text = readFileSync(
      new URL(`../supabase/functions/doji-eugenia/${file}`, import.meta.url), 'utf8');

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
   `readRows` is ask, refuse on a bad status, parse. What makes it worth having
   is the middle step, and what makes it worth ENFORCING is how quietly that step
   fails when it is missing: PostgREST answers a missing table with a 404
   carrying a JSON body, so `await res.json()` succeeds and the caller is handed
   an object where it expected an array. An unapplied migration then reads as a
   block with nothing to say — no error, no log, no empty state, just silence
   where a paragraph was.

   Fourteen hand-written copies is fourteen chances to leave the check out. One
   is one, and this is what stops a fifteenth being written beside it.

   `fillEmbeddings` is the single exemption and is named rather than pattern-
   matched: it reads `content-range` off the response to report how much backlog
   is left, which a helper returning rows cannot give it.
   ─────────────────────────────────────────────────────────────────────────── */

test('every read of her tables goes through readRows', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  assert.match(src, /async function readRows<T>\(what: string, url: string\)/,
    'readRows is gone — every read is hand-written again');

  /* NAMED, NOT COUNTED. A count says three and stays three while one exemption
     is removed and a bypass is added, which is the drift this repository has
     been bitten by before. Each raw GET is attributed to the function it sits
     in, and the SET has to match. */
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

  /* Three functions may call fetch directly, and each for a reason that a
     rows-returning helper cannot serve:

       readRows        it IS the helper
       fillEmbeddings  reads `content-range` off the response to report backlog
       healthBlock     a 404 is a SUPPORTED state — 008 not applied yet — so it
                       returns "" rather than throwing, and readRows throws */
  assert.deepEqual(where, ['fillEmbeddings', 'healthBlock', 'readRows'],
    `these functions read her tables without readRows: ${where.join(', ')}. A missing ` +
    `status check does not throw — PostgREST answers a missing table with a 404 ` +
    `carrying JSON, so the caller gets an object where it expected rows and the ` +
    `block it feeds simply falls silent.`);
});

/* ─── The Node floor has one home, and CI has to read it from there ──────────
   `engines.node` states the floor and package.json is the only file allowed to.
   It is jsdom's requirement, above the 22.6 that `--experimental-strip-types`
   needs, and jsdom is a dependency that moves — so the floor moves with it.

   A workflow pinning `node-version: 22` is a second copy of that decision that
   nothing compares. It resolves to the newest 22.x, which is why it has always
   been above the floor and why the disagreement is invisible: the day the floor
   goes past the newest 22.x, three workflows install a Node the suite is not
   claimed to run on and go green doing it. setup-node resolves the range in
   engines.node itself, so the copy is avoidable rather than unavoidable — which
   is why this asserts one home instead of holding two together.
   ─────────────────────────────────────────────────────────────────────────── */

const WORKFLOWS = ['.github/workflows/test.yml',
                   '.github/workflows/deploy-functions.yml',
                   '.github/workflows/backup-memory.yml'].map(read);

test('every workflow takes its Node version from the one file that states it', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.engines?.node ?? '', /^>=\d+\.\d+\.\d+$/,
    'package.json no longer states a Node floor, so node-version-file resolves ' +
    'to nothing and every workflow below is reading an empty decision');

  // engines on its own is a note npm prints past — proved by raising the floor
  // to >=99 and watching `npm ci` install happily. engine-strict is what turns
  // it into a gate, on a runner and on a laptop alike, which is also what makes
  // a green CI run evidence that the Node installed is above the floor rather
  // than evidence that the workflow parsed.
  const npmrc = readFileSync(new URL('../.npmrc', import.meta.url), 'utf8');
  assert.match(npmrc, /^engine-strict\s*=\s*true$/m,
    '.npmrc no longer sets engine-strict, so engines.node is documentation again ' +
    'and npm installs on any version without a word');

  for (const { path, text } of WORKFLOWS) {
    // Anchored to setup-node: a `node-version` under any other step is not this.
    assert.ok(/actions\/setup-node/.test(text), `${path} no longer sets Node up at all`);
    assert.match(text, /node-version-file: package\.json/,
      `${path} does not read the floor from package.json`);
    assert.doesNotMatch(text, /^\s*node-version:/m,
      `${path} pins a Node version of its own, which is a second home for a ` +
      `floor that only package.json is allowed to state`);
  }
});

/* ─── A tag is a name its owner can move; a commit is the code you read ──────
   Every `uses:` here is a 40-character commit, and the rule is worth a test
   because the mutable form is the one a person types from memory. `@v7` is
   shorter, it is what every README shows, and it re-fetches whatever that tag
   points at on every run — so the audit of an action and the run of it are two
   different trees, silently.

   supabase/setup-cli@v1 was the case that made this real: not a tag but a
   BRANCH, which is a ref expected to move in the ordinary course of somebody
   else's work, in the job that holds SUPABASE_ACCESS_TOKEN. Nothing here reads
   a secret it is not handed — both credentials are scoped to their own step —
   so what an earlier action reaches is the toolchain rather than the
   environment: setup-node provides the `node` that reads SB_SECRET_KEY one step
   later, setup-cli the `supabase` the deploy hands its token to.

   The trailing `# v7.0.1` is what keeps the line legible and is deliberately
   NOT asserted: Dependabot writes it beside the SHA it bumps, and a test on a
   comment would fail on the formatting of a machine-written line rather than on
   anything true. The SHA is the half that carries the guarantee.
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


/* ─── The one door, and the property no assertion about its answer can see ───
   secretMatches is why _shared/edge.ts exists at all: four functions authorise
   their callers with it, and a copy quietly rewritten to `presented === expected`
   returns the identical answer to every behavioural test anyone would think to
   write, while comparing byte by byte and stopping at the first difference —
   which hands an attacker the expected secret's length, then its leading bytes,
   one timed request at a time.

   So the guarantee is structural or it is nothing. Both halves are read: the
   loop that visits every byte of the longer input, and the absence of a direct
   comparison of the two secrets, which is the shape the rewrite would take.
   ─────────────────────────────────────────────────────────────────────────── */

test('the secret comparison cannot stop early, whatever its answer', () => {
  const src = readFileSync(
    new URL('../supabase/functions/_shared/edge.ts', import.meta.url), 'utf8');
  const at = src.indexOf('export function secretMatches(');
  assert.ok(at > -1, '_shared/edge.ts no longer has secretMatches()');
  const body = src.slice(at, src.indexOf('\n}', at));

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
                   the string somebody will actually read
     to_regprocedure  Postgres's non-throwing way to name a function, which
                   both documents prescribe for verify.sql and neither file
                   uses — because the row that needed it was deleted rather
                   than rewritten. Naming the safe form is the point; calling
                   it would mean keeping the copy that went stale
     BlobPart      a type in Node's own lib, and the example both documents
                   give for why types.test.mjs is not a whole typecheck: under
                   that lib a Uint8Array is not one, which is true here and
                   false on Deno. The claim is only checkable if it names the
                   type, and the type is real somewhere this repository is not
     tool_choice   the request field R-15 is about, and the one this file must
                   not send — REFACTOR.md names it because an entry refusing a
                   move cannot describe the move without naming it, and the
                   test beside CRITIC_TOOLS asserts the code has none */
const DELIBERATELY_ABSENT = new Set([
  'TODO', 'background_color', 'apple-touch-startup-image',
  'get_symbols', 'get_assets', 'get_pending_orders', 'get_order_history',
  'get_version', 'MN_1', 'insufficient_quota', 'to_regprocedure', 'BlobPart',
  'tool_choice',
]);

test('the documents name only symbols the repository has', () => {
  const missing = [];

  /* REFACTOR.md is read too. It is the working record of a long pass over this
     code, and its whole value is that a cold session can trust it — a document
     naming a helper that was renamed or a file that was deleted is worse than
     no document, because it is read as current. */
  for (const doc of ['README.md', 'CLAUDE.md', 'REFACTOR.md']) {
    const text = readFileSync(new URL(`../${doc}`, import.meta.url), 'utf8');
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


/* ─── The Layout block is a copy of the tree, and nothing compared it ───────
   README.md opens with a listing of every file and what it is for. It is the
   first thing a cold session reads and the only place the repository is
   described as a whole, and it had drifted the way an unchecked copy always
   does: 008, 009, the backup script, all three documents and both dotfiles
   were tracked and unlisted. The block still read as complete, because a map
   cannot show what it left out.

   BOTH DIRECTIONS, because they fail differently. A file missing from the
   block is invisible to a reader who trusts it — which is what the block is
   for. An entry naming a file that is gone sends them looking for something
   deleted. Neither is reachable by the symbol test above: these entries are
   not in backticks, and the one that is a bare `test/` is not a symbol.
   ─────────────────────────────────────────────────────────────────────────── */

/* An entry is a path, then whitespace, then prose. An INDENTED one is a detail
   under the directory line above it — `doji-eugenia/adherence.ts` beneath
   `supabase/functions/doji-eugenia/` — so it is a partial path already covered
   by its parent, and is checked for existence rather than used as coverage. */
const layoutBlock = () => {
  const found = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
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

  // WITHOUT THIS THE COMPARISONS BELOW PROVE NOTHING. A block that stopped
  // parsing reports every file missing, which is loud — but the fence moving
  // to a heading this pattern does not match reports nothing at all.
  assert.ok(top.length > 20, `only ${top.length} Layout entries parsed`);

  assert.deepEqual(TRACKED.filter(f => !top.some(e => covers(e, f))), [],
    'tracked files the Layout block does not name');

  assert.deepEqual(top.filter(e => !TRACKED.some(f => covers(e, f))), [],
    'Layout entries naming nothing the repository tracks');

  assert.deepEqual(nested.filter(e => !TRACKED.some(f => f.endsWith('/' + e))), [],
    'indented Layout entries naming no such file');
});

/* ─── One hour cycle, across four runtimes ──────────────────────────────────
   Nine formatters in this repository ask for an hour, and every one of them
   has to say WHICH cycle it wants. `hour12: false` does not: it leaves the
   choice to the locale, which is free to resolve to h24 and render midnight as
   hour 24 rather than hour 0.

   Where the hour is only tested against a market's opening range that is
   harmless — 24 fails `h < close` exactly as 0 fails `h >= open` — and both
   `hourIn` ports say so. It is the clocks that compare the hour against a
   BOUNDARY that break: `Dates.nyParts` feeds `weekStart` and `lastClose`,
   where `hour < 17` decides which week a Sunday belongs to, and `nyWall` in
   adherence.ts feeds `Date.UTC(..., w.hour, w.min)`, where an hour of 24 rolls
   the instant into the next day and moves the measured offset with it.

   So the cycle is read off every formatter that asks for an hour, rather than
   off the two that would visibly break. The alternative is nine copies of one
   decision with nothing comparing them, which is what this file exists for.
   ─────────────────────────────────────────────────────────────────────────── */

// The argument list of each `new Intl.DateTimeFormat(...)`, taken by balancing
// the parentheses rather than by a pattern: the options are an object literal
// and several of them run over more than one line.
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
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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

  /* AND THE WINDOW IS DERIVED FROM THE TOOL ARRAY, which is where the cache key
     starts. A week of `wrote_1h` settled which array earns the hour: the release
     look made fourteen turns and wrote five prefixes, its quarter-hourly job
     clustering several looks into one morning, and every other caller wrote its
     own on every single turn. A literal here is the shape that goes stale —
     it reads as a decision and is a default, and the wrong one costs 2× the
     input rate for a lifetime nothing reads. README.md carries the rows. */
  assert.match(src, /ttl:\s*tools === RELEASE_TOOLS \? "1h" : "5m"/,
    'the cached prefix states one window for every caller again — the hour is ' +
    'only earned by RELEASE_TOOLS, see the measurement in README.md');
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

/* ─── The force door asks the day, and asking it is the half a test can miss ──
   `briefKind` is pure and driven from both sides in fold.test.mjs — and every
   one of those assertions passed while `?force=1` still read the constant it
   replaced, because a test that calls a function directly cannot discover that
   nothing else calls it. That is this repository's oldest defect wearing a new
   hat, and it was found by putting the constant back and watching the suite
   stay green.

   The door exists for the hour a briefing did NOT arrive. Reading
   `briefDue(now) ?? 'weekday'` it could not produce a Sunday briefing outside
   the single hour one was already due — so on the one evening a week it is
   needed most it sent Buenos dias and a weekday shape into a market that had
   just opened.
   ─────────────────────────────────────────────────────────────────────────── */

test('a forced briefing asks what the day takes, not a literal', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('async function postScheduled(');
  const body = src.slice(at, src.indexOf('\n}\n', at))
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/\/\/.*$/, '')).join('\n');

  assert.match(body, /postBriefing\(briefDue\(now\) \?\? briefKind\(now\)\)/,
    'the force door no longer falls back through briefKind — a literal there is ' +
    'correct on six days a week, which is exactly why nobody notices the seventh');
});

/* ─── A job that dies before its first model call leaves a row ───────────────
   `ask()` records a failed turn, so eugenia_runs could answer "how often does a
   model call die" — and could say nothing whatever about a job that died BEFORE
   reaching one. Two consolidations threw in `turnsSince`, one line into
   postConsolidation, apologised to him on two consecutive nights, and left the
   table with no row on either: read afterwards it showed a system that had
   simply had nothing to do.

   AND THE ROW HAS TO GO DOWN BEFORE THE MESSAGE. The apology is sent with
   `.catch(() => {})` — deliberately, since a throw there would replace one
   silent failure with two — so a Telegram that is refusing takes the only
   notice with it and leaves nothing anywhere. Ordered this way the row survives
   that case, which is the one where he has no other way of finding out.
   ─────────────────────────────────────────────────────────────────────────── */

test('a scheduled job that dies records it, and records it before it apologises', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('async function postScheduled(');
  assert.ok(at > -1, 'doji-eugenia no longer has postScheduled()');
  const body = src.slice(at, src.indexOf('\n}\n', at))
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/\/\/.*$/, '')).join('\n');

  const row = body.indexOf('recordRun(');
  const msg = body.indexOf('tg("sendMessage"');
  assert.ok(row > -1,
    'a scheduled job can die with nothing but an apology behind it, so the one ' +
    'table that survives says the job never ran at all');
  assert.ok(msg > -1, 'postScheduled no longer tells him a job died');
  assert.ok(row < msg,
    'the row is written after the apology, so the case it exists for — a ' +
    'Telegram that is refusing — is still the case that leaves no trace');
});

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

/* ─── The critic is given no tool, and not for the obvious reason ────────────
   An empty array is the cheaper write as well as the stricter one, which is not
   what it looks like: sharing the briefing's array to ride its cache was tried
   and measured, and the critic wrote its own prefix anyway because the two also
   differ in effort. Dropping this back to `CHAT_TOOLS` would be a quiet 23,309
   tokens a morning at the 1h write rate, buying a read that does not happen.
   REFACTOR.md R-15 carries the figures.
   ─────────────────────────────────────────────────────────────────────────── */

test('the critic is offered no tool at all', () => {
  assert.match(EUGENIA_TS, /const CRITIC_TOOLS: unknown\[\] = \[\];/,
    'CRITIC_TOOLS is no longer empty — either the critic can now go and check ' +
    'something mid-revision, or it is writing a prefix it will not read');

  // AND NOTHING SENDS tool_choice, which is the half a constant cannot show.
  // The parameter was removed with the caller; a new one would mean the move
  // R-15 refused has been made again under another name.
  const code = EUGENIA_TS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /tool_choice/,
    'something sends tool_choice again — see REFACTOR.md R-15 before keeping it');
});

/* ─── A fetched page has two bounds and only one was written ──────────────────
   `max_uses` caps how many pages she may open and says nothing about how large
   one may be, so a single long thread could put more into the turn than the rest
   of the briefing and — before the loop's own breakpoint — be re-sent on every
   round after it. Dropping this bound breaks nothing and is invisible: the
   briefing still arrives, reads well, and costs several times what it did.
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
  assert.match(code, /await\s+recordChannels\(\)/,
    'nothing records where the channels stand, so the only claim this design ' +
    'rests on is the only one with no meter on it');

  const fn = src.indexOf('async function recordChannels(');
  assert.ok(fn > -1, 'doji-eugenia no longer has recordChannels()');
  const body = src.slice(fn, src.indexOf('\n}', fn));
  // It runs after the pass has already written memory, so a throw here would
  // turn a good night into a 500.
  assert.match(body, /catch\s*\(/,
    'recordChannels can throw, and it runs after the work it reports on is done');
});

/* ─── The two meters that were still going to a console ─────────────────────
   `eugenia_runs` exists because nobody reads Edge logs — that is the whole
   argument, made in the file, in the README and in 005. Two figures were
   written after that argument was settled and did not get it applied to them:
   what the nightly embedding sweep filled, and where the five channels stand.

   Both fail in the same shape and it is the shape this table was built for. A
   dead embedding vendor takes the semantic arm of `eugenia_search` out and
   leaves the lexical one answering, so the search still works and nothing
   anywhere says half of it stopped; a ladder that has quietly stopped moving
   looks exactly like one that had no reason to move. Neither is an error, so
   neither reaches him, and both went to a line discarded within hours.

   READ STRUCTURALLY, because nothing in this suite drives an Edge handler and
   because `sweepLine` is pure — it is handed two counts and cannot see whether
   anybody wrote them down. BOTH OUTCOMES, for the reason the heartbeat test
   gives above: a meter that records only its successes reports a vendor that
   has been refusing every night for a fortnight as a table with nothing in it.
   ─────────────────────────────────────────────────────────────────────────── */

test('the sweep and the census both reach the table, however they end', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

  for (const [fn, caller, what] of [
    ['async function postConsolidation(', 'embeddings',
     'a vendor that has stopped answering, which takes half of search_memory ' +
     'with it and reports nothing'],
    ['async function recordChannels(', 'channels',
     'the only meter on the one claim this whole design rests on'],
  ]) {
    const at = src.indexOf(fn);
    assert.ok(at > -1, `doji-eugenia no longer has ${fn}`);
    const body = strip(src.slice(at, src.indexOf('\n}', at)));

    for (const [ok, half] of [['true', 'success'], ['false', 'failure']]) {
      assert.match(body, new RegExp(`recordRun\\(\\{[^}]*caller: '${caller}'[^}]*ok: ${ok}`),
        `${caller} records no ${half}, so the row cannot answer for ${what}`);
    }
  }

  // The sweep's own line is what separates an unset key from a vendor that
  // refused, and it is only in the row if the row carries it.
  const at = src.indexOf('async function postConsolidation(');
  assert.match(strip(src.slice(at, src.indexOf('\n}', at))), /detail: swept/,
    'the sweep records that it ran and not what it found, which is the ' +
    'question it exists to answer');
});

/* ─── Both meters run on the nights nothing else does ────────────────────────
   They were added behind postConsolidation's early return, so on a day nobody
   spoke — two of the last four — neither happened at all. A dead embedding
   vendor could survive every quiet night with the meter that exists to catch
   it reporting nothing, and the channel census, which CLAUDE.md calls the only
   meter on the one claim this design rests on, had the same hole.

   ASSERTED AS ONE EXIT RATHER THAN AS A BRANCH SHAPE. What actually went wrong
   is that a `return` sat between the read and the meters, and any second
   `return` in this function puts it back — whatever the surrounding code looks
   like by then. The census cannot be hoisted to the top instead: it is taken
   after the pass because the pass is the only thing that can move a rung.
   ─────────────────────────────────────────────────────────────────────────── */

test('the nightly meters sit past every branch, not behind an early return', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
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

  /* AND THE CENSUS STAYS AFTER THE PASS. Hoisting it above the model call would
     also make it run on a quiet night, and would record the rungs as they stood
     BEFORE the only thing in this system that can move one. The rung would then
     always be one night stale, which is invisible in the column it exists for. */
  assert.ok(body.indexOf('await ask(') < census,
    'the census is taken before the pass, so it reports the ladder as it was ' +
    'about to stop being');
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

/* ─── Every section she is told to read is one she can be handed ─────────────
   The strategy is the one document she may not edit, and `get_strategy` is what
   stops her inventing what it says. A citation that does not resolve turns that
   tool into the opposite: `readStrategy` answers a missing section with a
   sentence naming what the document DOES hold, so she reports her own strategy
   as silent on something it covers.

   The dotted case is worse and is why the resolution is checked rather than
   the key. §4.1 and §4.2 are prose inside §4, so `readStrategy` falls back one
   level to the parent — which means a mistyped §4.9 comes back as §4, a real
   body, indistinguishable from a citation that worked. So a dotted citation has
   to name a heading actually present in what came back.

   One citation was checked before this — R-08's, from the rules table. Every
   other one, including the ones in the prompt she carries on every turn, was
   not. ─────────────────────────────────────────────────────────────────────── */

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

/* ─── A preference of his is not the prompt's to state ───────────────────────
   The prompt held *"he gets frustrated by walls of text"* and *"he has told you
   so"*, and neither was ever said. They read as grounding and are the opposite:
   a claim about a conversation this repository cannot see, sitting in the file
   that decides how she talks to the person it is about — so the failure is her
   handing him back a taste he never had, in the voice of someone quoting him.

   THE RULE IS NOT "SOURCE IT PROPERLY", IT IS THAT THE PROMPT DOES NOT CARRY
   HIS PREFERENCES AT ALL. There is already a channel for them and it is the one
   he can correct: an instruction note, which `notesBlock()` puts in front of her
   on every path and which the prompt itself says outranks the shape. A rule
   worth keeping stands on why it is right; one that needs him behind it belongs
   in a note.

   So the words below are searched for as tastes rather than as attributions —
   an invented preference and a real one are indistinguishable in this file, and
   both are in the wrong place. The second pattern is the other half of the same
   move: a rule stated on its own terms and then propped up with *and he has told
   you so*, which is the form the RELEASE prompt shipped in. Bare `he told you`
   and `he said` are left alone, since that is how the tool descriptions name the
   notes mechanism — the thing this test is pointing at.
   ─────────────────────────────────────────────────────────────────────────── */

test('the prompt states no preference of his', () => {
  const taste =
    /\bhe (?:gets |is |gets a bit |grows )?\w*(?:frustrat|annoy|irritat|impatien|bored)|\bhe (?:hates|dislikes|prefers|resents)\b|\b(?:frustrates|annoys|irritates|bores) him\b/i;
  const cited = /\bhe has (?:told you|said) so\b|\bas he has (?:told you|said)\b/i;

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
     a growing table too, and needs no limit at all.

     THE TABLE IS WHATEVER STANDS BEFORE THE `?`, rather than a list of the
     names this file happens to use today. An earlier version named them, and
     `fillEmbeddings` — which reads `rest/v1/${table}` because it sweeps two
     tables through one function — was invisible to it: the one read this
     guard could not see was the sweep whose backlog was once drained from the
     wrong end. A reader that names its subjects goes blind the moment one of
     them is spelled differently, and says nothing when it does. */
  const joined = src.replace(/`\s*\+\s*`/g, '');
  const reads = [...joined.matchAll(/rest\/v1\/([^?`]+)\?(select=[^`]*)/g)];
  assert.ok(reads.length >= 3,
    `only ${reads.length} reads found — the reader has gone blind`);

  for (const [, table, query] of reads) {
    assert.match(query, /limit=/,
      `the read of ${table} has no limit — an unusual day puts the whole window ` +
      `into a model call with nothing to stop it`);

    /* AND A LIMIT TAKES AN END, WHICH IS THE HALF THAT HAS ALREADY BITTEN
       TWICE. `id` is the only monotonic key any of these tables has, so a read
       ordered by it is asking for the newest rows or the oldest, and the two
       are indistinguishable from outside: the same rows come back either way
       on a quiet day, and the wrong end only shows on the day there is more
       than a window's worth. The pass once kept the FIRST two hundred turns of
       a day and dropped the evening, where a late instruction lives, and
       `fillEmbeddings` drained its backlog from the wrong end. Ordering by a
       clock is a different question and is left alone — the event spine reads
       `at.asc` on purpose, because the next release is the earliest one. */
    assert.doesNotMatch(query, /order=id\.asc/,
      `the read of ${table} orders id.asc under a limit, so it keeps the OLDEST ` +
      `rows in the window and silently drops everything since — which is what ` +
      `the nightly pass and the embedding backlog each did once`);
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

/* ─── The same filter again, on the write, where it answers a different question
   The read's `superseded_by=is.null` decides what she is HANDED. This one
   decides what a retirement may TOUCH, and only the read has ever been held to
   it. Without it the PATCH matches an already-retired note and re-points it at
   the new row: the trail stops being a chain and becomes a star, the note that
   originally corrected it is orphaned, and every row involved still reads as
   healthy. It is also the branch that decides whether she tells him the
   retirement missed — an unfiltered PATCH always matches, so the honest
   "note N is not there to retire" could never once be said. */

test('the supersede write may only retire a note that is still live', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('async function writeNote(');
  assert.ok(at > -1, 'doji-eugenia no longer has writeNote()');
  const body = src.slice(at, src.indexOf('\n}', at));
  const retire = body.slice(body.indexOf('if (retiring) {'));
  assert.ok(retire.length && retire.length < body.length,
    'writeNote no longer has a retirement branch to check');

  assert.match(retire, /eugenia_notes\?id=eq\.\$\{old\}&superseded_by=is\.null/,
    'the supersede PATCH no longer filters on superseded_by=is.null, so a note ' +
    'that was already retired is re-pointed at the new row and the note that ' +
    'first corrected it is orphaned — with nothing erroring');
  assert.match(retire, /method: "PATCH", headers: sbHeaders\("return=representation"\)/,
    'the supersede PATCH stopped asking for the row back, so a filtered-to-nothing ' +
    'retirement is a 200 with an empty body and reads as done');
  assert.match(retire, /\.length === 0/,
    'nothing checks that the retirement matched a row, so she reports a ' +
    'contradiction retired while it is still handed to her every turn');
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
  // Whitespace-tolerant around the `=`: a destructuring long enough to wrap is
  // still the same call, and a reader that only matches one line answers "this
  // path does not read his notes" about a path that does — a green suite
  // reporting the opposite of the truth, in the other direction.
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
     failing at all.

     AND postMove JOINED IT FOR THE SAME REASON, ONE RELEASE LATER. The two
     looks are the same shape — an unscheduled message about something the
     morning did not cover — and the move look was the one of the pair that
     could only report. What is behind a move runs through a channel as surely
     as what is behind a print does, so a message saying the dollar came off
     teaches nothing to a man for whom the dollar is `unseen`, and that is the
     likeliest message this path sends. It reached him as a number and a name,
     which is the failure the map exists to prevent. */
  /* FOUR LISTS, BECAUSE THEY ANSWER FOUR DIFFERENT QUESTIONS, and collapsing
     them into one would either assert something a path has no business holding
     or quietly stop asserting it of a path that needs it.

     `TEACHES` is the six whose prompts build a term, so those get the map.
     `SENDS` is the six that put a message in front of him right now — the
     nightly pass is not one, it writes memory and sends nothing. His notes go
     to all seven, because an instruction he gave is not optional anywhere. */
  const TEACHES = ['postBriefing', 'postPulse', 'handleMessage', 'postConsolidation',
                   'postRelease', 'postMove'];
  const SENDS = ['postBriefing', 'postPulse', 'handleMessage', 'postRelease',
                 'postMove', 'postTradeEvent'];

  const reads = (fn) =>
    body(fn).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

  for (const fn of TEACHES) {
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

  /* NOTES REACH SEVEN PATHS, NOT FIVE. The move look and the trade look send
     him messages like any other, and the trade look was deaf to his notes for
     its whole life — so an instruction he had given her was obeyed everywhere
     except the two messages that arrive while he is in a position, which are
     the ones he is least able to ignore. */
  for (const fn of [...new Set([...TEACHES, ...SENDS])]) {
    assert.ok(reaches(reads(fn), 'notesBlock'),
      `${fn} never gets notesBlock() into the message it sends — an instruction ` +
      `he gave would be ignored, with nothing anywhere reporting it`);
  }

  /* AND THE CONVERSATION WINDOW, ON EVERYTHING THAT SPEAKS. Its absence is the
     quietest failure on this list: she simply says a thing she already said,
     and a repetition reads as emphasis rather than as a defect. It bites
     hardest on the trade look, whose R-14/R-19 message fires on a print pending
     against an open position — which is exactly what the morning briefing is
     most likely to have named already.

     postConsolidation is deliberately absent: it reads a fixed twenty-four
     hours of its own and the twelve-turn window would be a second, shorter copy
     of the same day. */
  for (const fn of SENDS) {
    assert.ok(reaches(reads(fn), 'recent'),
      `${fn} sends him a message with no conversation window — she cannot know ` +
      `she said the same thing an hour ago, and a repetition reads as emphasis`);
  }

  /* AND WHAT HE HAS ON, WHICH IS SIX PATHS RATHER THAN FIVE. The move look
     joins because the message that talks past a live position is whichever one
     happens to be next, and a sharp move is the likeliest of all of them to
     arrive while he is in one.

     Losing it is silent in the way that matters: she carries on writing well,
     about a level or a shape, into a chat where he is sitting in a trade — and
     the message reads as correct because every rule about what she may SAY is
     still being kept. The only thing missing is the fact that would have
     stopped her.

     postTradeEvent is deliberately not here. It is reached FROM the position
     and already carries the row that fired it, so the block would hand it what
     it opened with. */
  for (const fn of [...TEACHES, 'postMove']) {
    const code = reads(fn);
    assert.ok(reaches(code, 'positionsBlock'),
      `${fn} never gets positionsBlock() into the message it sends — it can talk ` +
      `past an open position, and every rule about what she may say still passes`);
  }
});

/* ─── The pass that runs last reads what the writer was told ────────────────
   The critic is the only thing that touches the briefing after it is written,
   and two of its five checks are about him rather than about the prose: whether
   the briefing obeys his standing instructions, and whether a term is being
   built at a rung that no longer needs it. Both were asked of a message that
   carried the rules and the draft and nothing else.

   Neither fails loudly, and the second fails UPWARD, which is why it survived.
   Asked whether a term had already been explained, a reader holding one message
   answers from the only evidence in the room — the mechanism sitting in the
   paragraph being judged — so the build-up the map had just required was cut as
   a redefinition, last, every morning. The briefing that arrives is shorter,
   fluent and correct, and every rule about what she may SAY still passes. The
   only thing missing is the teaching, which is the one thing it is for.

   So the assertion is the call site rather than the prompt: the prose can say
   the notes are above it, and a call that stops passing them changes nothing
   anyone can see.
   ─────────────────────────────────────────────────────────────────────────── */

test('the critic is handed his notes and the map it is asked to enforce', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const at = src.indexOf('async function critique(');
  assert.ok(at > -1, 'doji-eugenia no longer has critique()');
  const body = src.slice(at, src.indexOf('\n}', at))
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

  // In the message, not merely in the signature: a parameter the content string
  // never interpolates is a critic reading the rules with none of the inputs.
  const content = body.match(/content:\s*`([\s\S]*?)`/);
  assert.ok(content, 'critique() no longer builds its message from a template literal');
  for (const block of ['notes', 'channels']) {
    assert.match(content[1], new RegExp(`\\$\\{${block}\\}`),
      `the critic's message no longer carries ${block} — it is asked to judge the ` +
      `briefing against his instructions and the ladder while holding neither, and ` +
      `it answers anyway`);
  }

  /* AND THE DRAFT STAYS LAST. The prompt names it at the end of the message and
     the blocks are prose that reads exactly like a briefing; put the draft first
     and "return the briefing itself and nothing else" points at his notes. */
  assert.ok(content[1].indexOf('${draft}') > content[1].indexOf('${channels}'),
    'the draft is no longer the last thing in the critic message — the prompt says ' +
    'it is at the end, and the blocks above it read like prose it could return');

  // And postBriefing hands over the two it has already awaited, rather than the
  // critic opening two reads of its own on the far side of a briefing.
  const brief = src.slice(src.indexOf('async function postBriefing('));
  assert.match(brief.slice(0, brief.indexOf('\n}')), /critique\(draft,\s*notes,\s*channels\)/,
    'postBriefing no longer passes the notes and the map it already holds into ' +
    'critique() — the critic is back to judging his instructions without them');
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
  // Case-insensitive: every vocabulary here was lower-case until `direction`,
  // whose values are the broker's own BUY and SELL. A lower-case class returned
  // an empty list for it rather than failing, which is the shape of blindness
  // this file exists to avoid — so the callers below assert on what came back.
  return [...clause.matchAll(/'([A-Za-z_]+)'/g)].map(m => m[1]).sort();
};

test('the kinds a loop may have are the kinds the table accepts', () => {
  const declared = checkValues(SENSES_SQL, 'eugenia_loops_kind_check');
  assert.ok(declared, '005 no longer constrains eugenia_loops.kind');
  assert.deepEqual([...LOOP_KINDS].sort(), declared,
    'index.ts offers a loop kind the table refuses, or the reverse — the first ' +
    'is a 400 she reports to nobody, the second is a value nothing can write');
});

/* ─── The two vocabularies the writers depend on and nothing compared ────────
   Both are enumerated in a check constraint, and both have copies in code that
   the constraint would silently invalidate. They fail in the direction that is
   hardest to see: NARROWING the constraint does not break a test or a build, it
   makes every write carrying the dropped value fail at PostgREST — and the two
   writers that would hit it report to a console this repository says twice that
   nobody reads.

   `direction` drops half the journal: every SELL rejected, the poller logging
   and carrying on, the app showing only longs. `role` drops half of every
   conversation: her own turns refused, so the history window fills with his
   messages alone and she reads as though she had never answered.
   ─────────────────────────────────────────────────────────────────────────── */

/* ─── What Telegram is told to deliver ───────────────────────────────────────
   `allowed_updates` is set once, by hand, outside this repository, and getting
   it wrong fails in the way this system's registration mistakes always fail:
   the update is simply never delivered. Eugenia needs both kinds — a message to
   answer and a callback_query for the feedback keyboard under every briefing —
   and her own dispatch says so in a comment beside the branch that handles them.

   The setup runbook said `["message"]` alone, so a restore built from this file
   would have come up with a briefing nobody could rate, the button spinning and
   nothing reporting it. Two copies of one value, in a document and in a comment,
   with the failure invisible from both.
   ─────────────────────────────────────────────────────────────────────────── */

test('the README registers each bot for the updates its code actually handles', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const wanted = {
    'doji-eugenia': ['message', 'callback_query'],
    'doji-gladys':  ['callback_query'],
  };

  for (const [fn, kinds] of Object.entries(wanted)) {
    /* The registration block is the one that names the function's endpoint AND
       the updates together — the endpoint alone appears in half a dozen other
       sentences, and taking the first of those reads a paragraph about
       something else and reports the registration missing. */
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
    /* And the code has to actually read every kind the README asks for — as a
       PROPERTY of the update, not merely as a word somewhere in the file. A
       bare word match passed for "poll", which appears in prose about the
       poller; asking for `.poll` asks the question that was meant. */
    const src = readFileSync(
      new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8');
    for (const kind of [...line[0].matchAll(/"(\w+)"/g)].map(m => m[1])) {
      assert.match(src, new RegExp(`\\.${kind}\\b`),
        `the README registers ${fn} for "${kind}" and the function never reads ` +
        `it off the update — Telegram would deliver it and nothing would act`);
    }
  }
});

/* ─── Both silent writers leave a mark, on both paths ────────────────────────
   The poller and the email function are the two writers with no voice: their
   failures reach console.error and a response pg_net discards. `sync_health` is
   the only evidence either is alive, and it is worth exactly as much as its
   call sites — a heartbeat missing from the success path makes a healthy writer
   read as dead, and one missing from the failure path is the original problem
   with a table beside it.

   Read structurally because nothing in this suite can drive an Edge handler,
   and because both calls sit at the very end of long functions where a later
   edit walks past them. Neither shows up as a failure if it goes: the poll
   still folds its deals, and the row simply stops moving.
   ─────────────────────────────────────────────────────────────────────────── */

test('the two writers with no voice record both outcomes', () => {
  const accepted = checkValues(SCHEMA_008, 'sync_health_id_check');
  assert.ok(accepted?.length === 2,
    `008 constrains sync_health.id to ${accepted?.length ?? 0} names, not two`);

  for (const [fn, who] of [['doji-mcp-sync', 'poller'], ['doji-email-sync', 'email']]) {
    const src = readFileSync(
      new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8');
    // Comments stripped: the name in prose about the call is not the call.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map(l => l.replace(/\/\/.*$/, '')).join('\n');

    assert.match(code, new RegExp(`await heartbeat\\("${who}"\\)`),
      `${fn} never records a completed run, so a writer that is working reads ` +
      `as one that stopped — which is the exact state this table exists to name`);
    assert.match(code, new RegExp(`await heartbeat\\("${who}",`),
      `${fn} never records a failure, so the only account of a run that failed ` +
      `at 03:00 is still a console nobody reads`);

    /* AND EVERY PATH THAT COMPLETES MUST MARK, NOT ONLY THE LAST ONE. The
       poller returns early when the market is closed, which is a completed run
       by every measure the mark exists for — cron fired, the function is
       deployed, its secrets loaded, it decided correctly. Unmarked, gold's
       Friday-to-Sunday close freezes it for forty-eight hours against a
       six-hour window and she reports the sync dead every Sunday evening.

       A monitor that is wrong on an ordinary day gets ignored, and an ignored
       monitor is worse than none. `healthLine` is pure and cannot see this —
       it is handed rows — so the call site is read here instead. */
    if (fn === 'doji-mcp-sync') {
      const at = code.indexOf('skipped: "market closed"');
      assert.ok(at > -1, 'doji-mcp-sync no longer skips a closed market');
      assert.match(code.slice(Math.max(0, at - 600), at), /await heartbeat\("poller"\)/,
        'the market-closed return does not mark a completed run, so the poller ' +
        'reads as dead across every weekend');
    }

    /* And it must be a name the table both ACCEPTS and SEEDS. Asked of the
       constraint rather than of the file, because the seed alone answers yes
       for a name the check would refuse — and both halves matter separately:
       an unaccepted name is a 400 the writer swallows, an unseeded one is a
       PATCH by primary key landing on nothing, which is a 200 with an empty
       body. Either way the row never moves and the writer reads as dead. */
    assert.ok(accepted.includes(who),
      `sync_health_id_check refuses '${who}', so every heartbeat ${fn} sends is ` +
      `a 400 it swallows — indistinguishable from one that never fired`);
    assert.match(SCHEMA_008, new RegExp(`values[\\s\\S]*?'${who}'`),
      `008 never seeds '${who}', and these writers PATCH by primary key — a ` +
      `missing row is a 200 with an empty array and the mark is dropped`);
  }
});

/* ─── The number in the instructions is a number, and numbers go stale ───────
   CLAUDE.md tells a new reader what `npm test` should print. It said 402 for
   long enough to be wrong by thirty-two, which is the same failure this file
   exists for in its smallest form: a copy nothing compares, in the one document
   somebody reads before touching anything.

   It is derivable, so it is derived. The runner reports one line per top-level
   `test(` call, and that is what is counted here — a suite added in a fifth file
   is picked up without touching this test, and a count typed into the document
   and not updated fails on the next run rather than in six months.
   ─────────────────────────────────────────────────────────────────────────── */

test('the test count the instructions state is the count the suite runs', () => {
  const files = readdirSync(new URL('../test', import.meta.url))
    .filter(f => f.endsWith('.test.mjs')).sort();
  assert.ok(files.length >= 4, `only ${files.length} suites found — the reader has gone blind`);

  const total = files.reduce((n, f) => n +
    (readFileSync(new URL(`../test/${f}`, import.meta.url), 'utf8')
      .match(/^test\(/gm) || []).length, 0);
  assert.ok(total > 100, `counted ${total} tests — the pattern has stopped matching`);

  const doc = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
  const stated = doc.match(/npm test\s+# (\d+) tests, (\w+) suites/);
  assert.ok(stated, 'CLAUDE.md no longer states what npm test prints');
  assert.equal(Number(stated[1]), total,
    `CLAUDE.md says ${stated[1]} tests and the suite runs ${total}`);

  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  assert.equal(stated[2], WORDS[files.length],
    `CLAUDE.md says ${stated[2]} suites and test/ holds ${files.length} — the ` +
    `script globs one level, so a fifth suite is either running unmentioned or ` +
    `sitting in a subfolder where it silently does not run at all`);
});

/* ─── The backup reads each table by a column that table actually has ────────
   Paging by Range needs a stable order, so every read carries one — and the
   order column has to exist. `eugenia_channels` is keyed by `channel` rather
   than `id`, because the five rungs ARE the rows; ordering it by `id` is a 400
   from PostgREST and the whole backup is refused.

   NOTHING IN THIS SUITE COULD SEE THAT, and the reason is worth keeping. The
   paging tests drive `readAll` against a stubbed fetch, and a stub answers
   whatever it is asked — so the loop was proved and the QUERY was never
   checked against a real schema. It failed on its first live run. This is the
   half a stub cannot cover: the column names, read out of the SQL that creates
   the table.
   ─────────────────────────────────────────────────────────────────────────── */

test('every table the backup reads is ordered by a column it has', async () => {
  const { TABLES } = await import('../scripts/backup-memory.mjs');
  assert.ok(TABLES.length >= 6, `only ${TABLES.length} tables in the backup`);

  for (const [table, orderBy] of TABLES) {
    const created = NUMBERED.match(
      new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`));
    assert.ok(created, `${table} is in the backup and no numbered file creates it`);

    // The column as DECLARED — a name in a constraint or a comment is not one.
    const columns = created[1].split('\n')
      .map(l => l.trim().match(/^([a-z_]+)\s+(text|bigserial|bigint|int|numeric|boolean|timestamptz|vector)/))
      .filter(Boolean).map(m => m[1]);
    assert.ok(columns.length >= 2,
      `read ${columns.length} columns out of ${table} — the reader has gone blind`);
    assert.ok(columns.includes(orderBy),
      `the backup orders ${table} by '${orderBy}' and that column is not on it — ` +
      `PostgREST answers 400 and the entire backup is refused, on every run`);
  }
});

/* ─── verify.sql has to ask about everything the files declare ───────────────
   The numbered files are a CLAIM about the database and verify.sql is the only
   thing that tests it, so an object declared and never asked about is drift in
   the part nobody checks. It was 25 of 39: eleven indexes and the three policies
   the dashboard card reads were declared and never asked about, and RLS was
   asserted for four of ten tables.

   Every one of those fails silently by construction. A missing `*_app_read`
   policy is not an error — RLS does exactly its job and the card shows nothing,
   which looks like a quiet week. A missing index is not an error either: the
   query returns the same rows off a sequential scan and gets slower every week.
   ─────────────────────────────────────────────────────────────────────────── */

// NUMBERED is already the numbered files as one string, read at the top of this
// file for the same reason it is needed here.
const VERIFY = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');

test('verify.sql asks about every table, policy and index the files declare', () => {
  const tables = [...NUMBERED.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map(m => m[1]);
  const policies = [...NUMBERED.matchAll(/create policy (\w+) on/g)].map(m => m[1]);
  const indexes = [...NUMBERED.matchAll(/create index (?:if not exists )?(\w+)/g)].map(m => m[1]);
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

  /* AND THE EXPECTED STRING IS THE LIST ITSELF. The row names every index, so
     the row is a second copy of what the SQL declares — held here rather than
     left to be noticed when someone runs the file. */
  const expected = [...new Set(indexes)].sort().join(',');
  const stated = (VERIFY.match(/\('every declared index exists',[\s\S]*?\n   '([\s\S]*?)'\)/) || [])[1];
  assert.ok(stated, "verify.sql has no 'every declared index exists' row");
  assert.equal(stated.replace(/' \|\|\s*'/g, '').replace(/\s+/g, ''), expected,
    'the index row and the create index statements name different sets');
});

/* ─── A summary row may come back false; it may never throw ──────────────────
   An error in verify.sql is not a failed row, it is a file that STOPPED —
   taking every check below it and reporting a correct database as a broken one.
   That has happened once already, to a written-out function signature.

   The shape that does it is a summary row reading a public table DIRECTLY:
   Postgres parses the whole statement up front, so a table that is not there
   raises 42P01 rather than answering. Three seed checks did exactly that. They
   have to read the table — that is what a seed check is — so they read it
   through `query_to_xml`, which takes its query as a string and is guarded by
   `to_regclass`, and answer NULL when the table is absent.
   ─────────────────────────────────────────────────────────────────────────── */

test('no summary row reads a table in a way that would throw', () => {
  const from = VERIFY.indexOf('from (values');
  const to = VERIFY.indexOf(') as t(check_name, actual, expected);');
  assert.ok(from > -1 && to > from, 'verify.sql no longer has one summary block');
  const summary = VERIFY.slice(from, to);

  /* Comments first, then string literals — in that order. A `--` comment in
     this file routinely carries an apostrophe ("the poller's answer"), in a
     dash comment and in a block comment alike, and a single unpaired quote
     desynchronises literal matching for everything after it — which had this
     reading `to_regclass('public.eugenia_channels')` as a live table read. */
  const unquoted = summary
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
  /* Any schema, not only `public`. `cron.job` is the same hazard wearing an
     extension's name: on a database without pg_cron a direct read raises, and
     "that never happens on Supabase" is how a row ends up runnable in exactly
     one place. The catalogs — pg_class, pg_proc, pg_policy, pg_indexes,
     information_schema — are always there and are what the rest of the file
     asks. */
  const direct = [...unquoted.matchAll(/from\s+(public|cron|net|vault)\.(\w+)/g)]
    .map(m => `${m[1]}.${m[2]}`);
  assert.deepEqual(direct, [],
    `the summary reads ${direct[0]} directly — on a database missing it that is ` +
    `a raise, and one raise takes all of the checks with it`);

  // The catalogs are the safe way to ask, and to_regclass answers null.
  assert.match(summary, /to_regclass/, 'the summary no longer asks by oid at all');
});

/* ─── Every table stands behind RLS, and nothing was checking that ───────────
   The publishable key is in `index.html` and is meant to be. RLS is the only
   thing between it and every table in the schema — either a policy that scopes
   the rows, or, for the tables 003 keeps from the app entirely, RLS on with no
   policy at all, which denies that key outright.

   A table created without `enable row level security` is readable by anyone who
   opens the page. Nothing failed, nothing logged, and the table simply answers.
   Read out of the SQL rather than listed here, so table eleven is covered on the
   day it is written rather than on the day someone remembers this test.
   ─────────────────────────────────────────────────────────────────────────── */

test('every table the numbered files create has row level security on', () => {
  const files = readdirSync(new URL('../supabase', import.meta.url))
    .filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  const sql = files
    .map(f => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8')).join('\n');

  const created = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)]
    .map(m => m[1]);
  assert.ok(created.length >= 8,
    `only ${created.length} tables read out of the numbered SQL — the reader has gone blind`);

  for (const t of created) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`),
      `public.${t} is created and never has RLS turned on, so the publishable ` +
      `key in index.html can read it — and a table that simply answers looks ` +
      `exactly like one that is meant to`);
  }
});

test('the sides a trade may have are the sides every writer writes', () => {
  const declared = checkValues(SCHEMA, 'trades_direction_check');
  assert.ok(declared, '001 no longer constrains trades.direction');
  assert.deepEqual(declared, ['BUY', 'SELL']);

  // Every file that names a side, and each must name only sides the table takes.
  const writers = [
    'supabase/functions/doji-mcp-sync/index.ts',
    'supabase/functions/doji-email-sync/index.ts',
    'doji_gmail_sync.gs',
    'index.html',
  ];
  for (const path of writers) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
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
  assert.ok(declared, '003 no longer constrains eugenia_turns.role');

  const named = [...new Set([...EUGENIA_TS.matchAll(/role:\s*["'](\w+)["']/g)].map(m => m[1]))];
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
  /* AND THE MARK IS SELECTED RATHER THAN FILTERED ON, which is the one place
     this reads as a deletion and is not. The query cannot filter it away: the
     question is whether ANYTHING at that release time has been looked at, and a
     `looked_at=is.null` filter hides exactly the mark that answers it — which
     is how one print became five looks. The guarantee moved into dueRelease and
     is driven from both sides in fold.test.mjs; what has to be true here is
     that the column still comes back at all. */
  assert.match(spine, /select=[^&`]*looked_at/,
    'pendingRelease no longer reads looked_at, so dueRelease cannot see the mark ' +
    'and every print is looked at every quarter of an hour until it ages out');
  assert.doesNotMatch(spine, /looked_at=is\.null/,
    'the filter is back, so the duplicates are handed over one at a time again — ' +
    'which is the five-looks-per-print this replaced');
});

/* ─── The pure half settles nothing about the call ───────────────────────────
   `dueRelease` is driven from both sides in fold.test.mjs and every one of those
   assertions stays green while postRelease marks only the row its message
   happens to name — which leaves the other four standing unlooked, and the next
   quarter-hour hands back the same print. That is the loop this was built to
   close, surviving inside the fix for it, and it is the third time this shape
   has been found here.
   ─────────────────────────────────────────────────────────────────────────── */

test('every row at the release time is marked, not the one the message names', () => {
  const at = EUGENIA_TS.indexOf('async function postRelease(');
  assert.ok(at > -1, 'doji-eugenia no longer has postRelease()');
  const body = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('\n}', at));

  assert.match(body, /markLooked\(due\.map\(r => r\.id\)\)/,
    'postRelease marks something other than the whole group, so the duplicates ' +
    'it just decided to skip come back unlooked at the next quarter hour');

  // AND THE MARK GOES DOWN BEFORE THE LOOK, which is what makes it once-only at
  // all: a look that generates and then fails to write would otherwise repeat
  // every fifteen minutes, each one billed.
  assert.ok(body.indexOf('markLooked') < body.indexOf('await ask('),
    'the mark now lands after the model call, so a look that dies repeats');
});

/* ─── A command nothing routes is a command that does not exist ──────────────
   `parseChannel` is pure and driven from both sides in fold.test.mjs, and every
   one of those assertions stays green with the branch deleted from
   handleMessage — the command then falls through to the catch-all that ignores
   anything starting with a slash, and he gets no reply at all. Same shape as
   briefKind's: the pure half proves the parse, never the call.
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

  /* AND IT GOES THROUGH setChannel RATHER THAN WRITING ITS OWN PATCH, which is
     what keeps the one-way door on the bottom rung and the unseeded-table check
     in one place. A second writer here is a second copy of both. */
  assert.match(body.slice(routed, routed + 400), /await setChannel\(/,
    '/channel writes the ladder itself, so the guard on the bottom rung and the ' +
    'check for an unseeded table are now stated in one place and enforced in another');
});

/* ─── A rule the critic also holds has to move in both places ────────────────
   The critic runs LAST and returns the version that goes. A rule loosened in
   the briefing prompt and left standing in `CRITIC` is a rule the critic puts
   back, every morning, on the pass nothing downstream can see — which is how
   the build-up `PITCH` required was being cut after `PITCH` had been obeyed.

   One chain per briefing is the newest such pair. It exists because nine
   subjects each carrying a mechanism is the shape he asked twice to be rid of,
   in notes that were stored, read, and outranked by a rule with no carve-out.
   ─────────────────────────────────────────────────────────────────────────── */

test('one chain per briefing is stated to the writer and to the critic', () => {
  assert.match(EUGENIA_PROMPT, /ONE CHAIN IN A BRIEFING, NOT ONE PER EVENT/,
    'the briefing prompt no longer bounds how many mechanisms a briefing carries, ' +
    'so it goes back to a survey with a clause of chain on every event');
  assert.match(EUGENIA_PROMPT, /IS THERE MORE THAN ONE CHAIN IN IT\?/,
    'the critic no longer checks it — so the writer may obey the rule and the ' +
    'pass that runs last has no reason to keep that version');

  /* AND THE SLOT THAT CARRIED THE SECOND CHAIN SAYS SO ITSELF. "Name it and
     move on" was already there and was not enough: it describes the length of
     the paragraph and not what may be inside it. */
  assert.match(EUGENIA_PROMPT, /NAMED AND NOTHING MORE/,
    'the round-up slot no longer forbids mechanism, which is where the second ' +
    'chain actually lived');
});

/* ─── A thread that cannot close fills the list that holds the ones that can ──
   `readLoops` takes the newest ten and the window was already full: six watches
   and four questions. The eleventh loop she opens pushes the oldest out of what
   she is HANDED while leaving it open in the table, so it can never be closed
   by anyone who cannot see it — the same limit-at-the-right-end shape as the
   nightly pass's, arriving where the assumption underneath it was that threads
   close at all.

   Two kinds could not. A move filed as unexplained when nothing had moved, now
   fixed at the gate; and a question he does not answer, which closes only on an
   answer. The pass was told to write a NOTE about the second and not to close
   it — so it wrote one, correctly, and nothing acted on it. Both halves below
   fail in silence: drop either and she keeps asking, the list keeps filling,
   and no error is raised anywhere.
   ─────────────────────────────────────────────────────────────────────────── */

test('a question he has not answered in a week is closed, not kept', () => {
  assert.match(EUGENIA_PROMPT, /A QUESTION IS THE ONE EXCEPTION, AND A WEEK IS ITS ANSWER/,
    'the nightly pass no longer closes a question he has not answered, so every ' +
    'one of them stays open for the life of the deployment');

  // AND THE WATCH IS NOT SWEPT UP WITH IT. Age proves nothing about an odd
  // reaction — it may still explain itself — so the exception has to stay an
  // exception rather than becoming "close anything old".
  assert.match(EUGENIA_PROMPT, /A thread that is merely old stays open/,
    'the pass may now close a watch for being old, which is the follow-through ' +
    'this whole mechanism exists for, quietly stopping');
});

/* ─── The briefing asks him nothing, and a reply still may ──────────────────
   THE SLOT WAS MEASURING NOTHING. It existed to learn what he actually holds,
   and over eleven days it produced four questions and four open threads and no
   answers — he reads on a phone and answers by instruction, which is a channel
   that works, rather than by reply.

   THE SCOPE IS THE HALF THAT MATTERS HERE. Cutting questions everywhere would
   take the trade conversation with it, where asking one thing and waiting is
   the whole method and where he IS answering. So this is read as a pair: the
   briefing is silent, and the reply path keeps its questions.
   ─────────────────────────────────────────────────────────────────────────── */

test('the briefing closes without a question to him', () => {
  assert.match(EUGENIA_PROMPT, /NO CLOSING QUESTION\./,
    'the briefing may end with a question again — four went unanswered in eleven ' +
    'days and each one is an open thread that can only close by being given up on');

  // AND THE RULES THAT ONLY MADE SENSE WHILE IT ASKED ARE GONE WITH IT. A rule
  // about re-asking, in a file where nothing asks, is the dead branch this
  // repository refuses — and the one a later reader restores the slot from.
  assert.doesNotMatch(EUGENIA_PROMPT, /you may ask it once more, differently/,
    'the re-asking rule survived the slot it belonged to');
  assert.doesNotMatch(EUGENIA_PROMPT, /at most one of each in a\s+briefing/,
    'open_loop still promises a question loop the briefing can no longer open');
});

test('and a reply may still ask, because that is a conversation he is in', () => {
  /* THE CAPABILITY THIS WAS NOT ALLOWED TO COST. He answers when he is the one
     who started talking — most of all about a trade, where the method is one
     question and then silence. A change that took that too would be quieter and
     worse. */
  assert.match(EUGENIA_PROMPT, /When he mentions how he felt, slow down\. One question at a time/,
    'the trade conversation lost its questions, which is where he does answer');
  assert.match(EUGENIA_PROMPT, /Never infer what he planned\. Ask\./,
    'she now guesses a plan rather than asking for it');
  assert.match(EUGENIA_PROMPT, /THIS IS THE BRIEFING AND NOTHING ELSE/,
    'nothing scopes the silence to the briefing, so it reads as a ban on asking');
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

  /* AND THE CHECK THAT WOULD CATCH THAT ON A LIVE DATABASE NAMES THEM A THIRD
     TIME. A verify.sql row asking after a column 005 does not declare comes back
     false on a correct database, which is the failure mode that gets a checker
     stopped being run. */
  const verify = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');
  const asked = verify.match(
    /table_name = 'eugenia_runs'\s*\n\s*and column_name in \(([^)]*)\)/);
  assert.ok(asked, 'verify.sql no longer asks whether eugenia_runs has its later columns');
  for (const name of asked[1].match(/'(\w+)'/g).map(q => q.slice(1, -1))) {
    assert.ok(columns.has(name),
      `verify.sql asks eugenia_runs for "${name}", which 005 does not declare — ` +
      `the row reports false against a database that is in fact correct`);
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

/* ─── The watcher's own report can be lost, and it plans for that ───────────
   THE FIRST MESSAGE IT EVER SENT DID NOT ARRIVE. pg_net reported `timed_out`
   with the whole twenty-second budget spent in the TCP/SSL handshake and zero
   milliseconds in the request — the connection to Telegram never opened. The
   function had already settled the rows, because pg_net is ASYNCHRONOUS and it
   could not learn otherwise inside the same call.

   So a real outage would have been reported exactly once, into a dropped
   connection, and never mentioned again: the silence this table exists to end,
   reproduced inside the thing built to end it. Third time that shape has been
   found here.

   `reported_by` is the repair. A failure is marked with the request id of the
   message that named it and is NOT settled; the next sweep looks that id up and
   settles on a 2xx, or clears the mark and says it again on anything else.

   Held structurally because nothing in this suite runs Postgres. The behaviour
   itself was driven on a real server — reported, lost, said again, lost again,
   said again, and retired past three hours — and each guard here was proved by
   removing it and watching that sequence change.
   ─────────────────────────────────────────────────────────────────────────── */

test('a failure is settled when its report lands, not when it is sent', () => {
  const sql = readFileSync(new URL('../supabase/009_dispatch.sql', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  assert.match(sql, /alter table public\.dispatch add column if not exists reported_by bigint;/,
    '009 is re-runnable, so a database that already has the table gets nothing ' +
    'from the create — the column needs its own idempotent statement');

  // Confirm and release, and both must exist: only one of them and a report
  // either finishes rows it never delivered or never finishes them at all.
  /* Anchored on the closing paren, not just the substring: `between 200 and 299
     and false` contains the condition and never fires, and a loose match said
     that was fine. */
  assert.match(sql, /set settled = true[\s\S]{0,300}?r\.id = d\.reported_by[\s\S]{0,120}?status_code between 200 and 299\);/,
    'nothing settles a row on a DELIVERED report, so the mark is set and never cleared');
  assert.match(sql, /set reported_by = null[\s\S]{0,300}?r\.timed_out/,
    'a report that timed out never releases the rows it named — which is the ' +
    'exact failure this was written for, and it would be permanent');

  // A row still waiting on a report must not be re-judged into a second message.
  assert.match(sql, /d\.reported_by is null\s*\n\s*and d\.at <= now_/,
    'dispatch_failures does not exclude rows already reported, so the same ' +
    'outage arrives every ten minutes until it resolves');

  /* AND THE SETTLE MUST SKIP WHAT WAS JUST SAID. Without this a sweep that
     could NOT send — a Vault name misspelled, which is the failure this
     repository has had twice — settles the outage anyway, and repairing the
     name delivers nothing because there is nothing left to say. Driven both
     ways on a real server: unsettled while the name is wrong, delivered on the
     sweep after it is fixed. */
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
   A 546 comes back BEFORE the worker exists, so the function writes no row,
   sends no apology and appears in no log of its own. `net._http_response` is
   the only witness, it carries no url, and pg_net prunes it within hours — so
   what a failed request was FOR is unrecoverable unless the request id is
   captured at the moment it is made. 009's ledger is that capture, and a
   dispatch site added without it is a job that can vanish silently, which is
   the whole thing this was built to stop.

   THE JOB NAMES ARE HELD AGAINST THE CHECK CONSTRAINT rather than a literal
   here, so the six exist in one place and a seventh has to be declared before
   it can be used.

   AND THE TWO TRIGGER SITES MUST NOT BE ABLE TO BREAK THEIR OWN WRITE. They
   fire inside the UPDATE that set the column, so anything raised in them takes
   that write with it — a tap answering a journal question would fail because a
   monitor could not record that a message had been sent. The post happens
   first, into a variable; the ledger insert is best-effort behind an exception
   block. Same trade 008 makes, same words.
   ─────────────────────────────────────────────────────────────────────────── */

test('every pg_net dispatch records a job the ledger declares', () => {
  const files = readdirSync(new URL('../supabase', import.meta.url))
    .filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();

  const declared = new Set(
    [...readFileSync(new URL('../supabase/009_dispatch.sql', import.meta.url), 'utf8')
      .match(/dispatch_job_check check \(job in \(([\s\S]*?)\)\)/)[1]
      .matchAll(/'([a-z-]+)'/g)].map(m => m[1]));
  assert.ok(declared.size >= 5,
    `009 declares ${declared.size} jobs — the reader has gone blind`);

  const used = [];
  let posts = 0;
  for (const f of files) {
    const sql = readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    /* A POST ADDRESSED TO TELEGRAM IS A REPORT, NOT A DISPATCH, and it is the
       one call that must NOT reach the ledger it is reporting on: a watcher
       that recorded its own message would be judged by the next sweep and end
       up reporting itself. Parted by where the call GOES rather than by which
       file it is in — the exemption was `f.startsWith('009')`, which is a
       statement about a filename, and 010's watcher would have had to be named
       here to stay honest. The url is the first argument, so it is inside the
       call rather than merely near it. */
    for (const tail of sql.split('net.http_post(').slice(1)) {
      if (!/api\.telegram\.org/.test(tail.slice(0, 300))) posts += 1;
    }
    /* The job is the LAST argument of either shape — `), 'poller';` closing the
       select, or `values (req, 'gladys')` in a trigger. Matched that way rather
       than as the first quoted word after the insert, which is 'x-doji-key' in
       the headers and was what the first draft of this test read. */
    for (const m of sql.matchAll(
        /insert into public\.dispatch[\s\S]{0,900}?(?:\),|values \(req,)\s*'([a-z-]+)'\s*[;)]/g)) {
      used.push([f, m[1]]);
    }
  }

  assert.equal(used.length, posts,
    `${posts} calls to net.http_post and ${used.length} of them reach the ledger — ` +
    `the difference is a job that can be refused a worker with nothing anywhere ` +
    `to say it ever existed`);
  assert.ok(posts >= 6, `only ${posts} dispatch sites found — the reader has gone blind`);

  for (const [f, job] of used) {
    assert.ok(declared.has(job),
      `${f} records dispatches as '${job}', which 009's check constraint does not ` +
      `allow — every row it writes will be rejected and the job goes unwatched`);
  }
});

test('a trigger that cannot record its dispatch still makes it', () => {
  for (const [f, sql] of [['002_gladys.sql', GLADYS_SQL], ['005_eugenia_senses.sql', SENSES_SQL]]) {
    assert.match(sql, /req := net\.http_post\(/,
      `${f} inlines net.http_post into the ledger insert, so a ledger that ` +
      `refuses the row takes the message with it`);
    assert.match(sql, /insert into public\.dispatch \(id, job\) values \(req, '[a-z-]+'\);\s*\n\s*exception when others then null;/,
      `${f} records its dispatch unguarded — this fires inside the UPDATE that ` +
      `set the column, so a raise here fails the journal write itself`);
  }
});

/* ─── The clock the workers run on, and the three copies that watch it ───────
   010 is the only monitor here that can speak BEFORE the failure, and it has to
   be, because after the failure there is nothing left to speak with: a briefing
   killed at the wall clock hands pg_net its 200 before it dies, so 009's ledger
   records a healthy dispatch, `ask()` never reaches its catch, no apology is
   sent, and all three retries redo the same too-long work. Three monitors, all
   green, and nothing reaches him.

   Everything below is a copy that nothing else compares. The caller it looks
   for is written in TypeScript and read in SQL; the number of cron jobs is
   declared in 004 and asserted in verify.sql; the ceiling is quoted back to him
   in the message it decides. Each fails silently on its own — a watcher looking
   for a caller nobody writes reports a briefing missing every single day, which
   is the false alarm that gets a monitor muted in a week.
   ─────────────────────────────────────────────────────────────────────────── */

const PACE_SQL = readFileSync(new URL('../supabase/010_pace.sql', import.meta.url), 'utf8');

test('the row 010 looks for is the row postBriefing writes', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  // The two kinds, off the type rather than off a literal here.
  const kinds = [...src.match(/export type Brief = ([^;]+);/)[1]
    .matchAll(/'(\w+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(kinds, ['sunday', 'weekday'],
    `Brief now names ${kinds.join(', ')} — 010 asks for a briefing per kind and ` +
    `would stop asking about one of them`);

  // And the suffix, which is half of the caller and the half a rename touches.
  assert.match(src, /caller: `\$\{due\} briefing delivered`/,
    'postBriefing no longer writes `<kind> briefing delivered` — 010 reads that ' +
    'caller to decide whether a briefing reached him, so it would report every ' +
    'day as a day nothing arrived');
  assert.match(PACE_SQL, /owed \|\| ' briefing delivered'/,
    '010 no longer builds the caller it looks for out of the kind and that ' +
    'suffix — the two halves of this name are in two languages with no build ' +
    'step between them');

  /* THE KINDS 010 CAN PUT IN FRONT OF THAT SUFFIX, held against the type. A
     third Brief that 010 never assigns to `owed` is a briefing whose absence
     is unwatched, and it looks exactly like one that never fails. */
  const owed = [...PACE_SQL.match(/owed := case([\s\S]*?)end;/)[1]
    .matchAll(/then '(\w+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(owed, kinds,
    `010 judges the absence of ${owed.join(', ')} where Brief names ` +
    `${kinds.join(', ')} — the difference is a briefing that can go missing unwatched`);
});

test('010 states its ceiling once and quotes that one', () => {
  const ms = Number(PACE_SQL.match(/ceiling_ms constant int := (\d+);/)[1]);
  assert.ok(ms > 0, '010 no longer declares ceiling_ms — the reader has gone blind');

  /* THE MESSAGE MAY NOT SPELL THE NUMBER OUT AGAIN. It is quoted back to him in
     the sentence the threshold decides, and written twice the threshold moves
     while the sentence keeps naming the old one — a warning that is arithmetic
     about one ceiling and prose about another. */
  const body = PACE_SQL.slice(PACE_SQL.indexOf('lines := lines || format(\n      \'Longest'));
  assert.ok(!new RegExp(`\\b${ms / 1000}s\\b`).test(body.slice(0, 600)),
    `010's message writes ${ms / 1000}s as a literal beside a ceiling it already ` +
    `holds in ceiling_ms — move the threshold and the sentence still names the old one`);
  assert.match(PACE_SQL, /ceiling_ms \/ 1000/,
    '010 no longer interpolates ceiling_ms into what it tells him');

  // And the share is a share, not a second ceiling.
  assert.match(PACE_SQL, /speak_at\s+constant int := ceiling_ms \*/,
    '010 no longer derives its threshold from the ceiling — the two would drift, ' +
    'and a threshold above the ceiling is a watcher that can never speak');

  /* AND THE PROSE HOLDS THE SAME NUMBER. It is a fact about the platform rather
     than about this repository, stated in the file that explains why the cron
     half answers before it works — so a plan change moves both or neither. */
  const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
  assert.ok(claude.includes(`${ms / 1000}s paid`),
    `CLAUDE.md does not name ${ms / 1000}s as the paid wall clock that 010 watches ` +
    `— one of the two has been changed without the other`);
});

test('the cron jobs verify.sql counts are the ones 004 schedules', () => {
  const cron = readFileSync(new URL('../supabase/004_cron.sql', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const scheduled = (cron.match(/cron\.schedule\(/g) || []).length;
  assert.ok(scheduled >= 5, `read ${scheduled} schedules out of 004 — the reader has gone blind`);

  const verify = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');
  const stated = Number(verify.match(
    /\('\w+ cron jobs, all active',[\s\S]*?'(\d+)'\),/)[1]);

  /* THIS ROW HAS BEEN WRONG BEFORE and its own comment says so: it read three
     while 004 defined four, so the check that exists to catch a missing job was
     itself what looked broken on a correct database. It was fixed by hand and
     left to be counted by hand again, which is the same defect with a longer
     fuse. */
  assert.equal(stated, scheduled,
    `verify.sql expects ${stated} cron jobs and 004 schedules ${scheduled} — run ` +
    `against a correct database this row reports a fault, and a job dropped from ` +
    `004 would slip past it`);

  // And the job it schedules has to name a function 010 actually creates.
  const called = [...cron.matchAll(/select public\.(\w+)\(\)/g)].map(m => m[1]);
  for (const fn of called) {
    assert.ok(new RegExp(`create or replace function public\\.${fn}\\(`)
                .test(PACE_SQL + readFileSync(
                  new URL('../supabase/009_dispatch.sql', import.meta.url), 'utf8')),
      `004 schedules public.${fn}(), which no numbered file creates — every ` +
      `firing raises into cron.job_run_details, which this file's own ` +
      `housekeeping prunes and nobody reads`);
  }
});

test('010 marks the day said only where the message was actually sent', () => {
  const body = PACE_SQL.slice(PACE_SQL.indexOf('create or replace function public.pace_watch('));

  /* THE ROW IS THE GUARD, which is what makes this ordering load-bearing rather
     than tidy. `pace_watch` speaks at most once a New York day and decides that
     by looking for its own row — so a row written after a send that could not
     be made marks the day as said and swallows the warning for good. Repairing
     a misspelled Vault name would then deliver silence, which is 009's lesson
     arriving here: found by running it with the name wrong, since nothing else
     exercises that half. */
  const post = body.indexOf('net.http_post(');
  const mark = body.indexOf("values ('pace', false");
  const warn = body.indexOf('raise warning');
  assert.ok(post > -1 && mark > -1 && warn > -1,
    'pace_watch no longer has all three of a post, a said-row and a warning');
  assert.ok(post < mark,
    'pace_watch records the day as said before it has posted — a Vault name that ' +
    'does not resolve would mark the day and swallow the warning for good');
  assert.ok(mark < warn,
    'the said-row has moved past the branch that could not send — it would be ' +
    'written on a failed send, which is the same silence from the other side');
});

/* ─── Everything a cron job dispatches answers before it works ───────────────
   TWO LIMITS, AND PAYING MOVES ONLY ONE. The worker's wall clock is 150s free
   and 400s paid; that is what killed the Sunday briefing at 145.4s of drafting,
   four and a half seconds short of finishing. The REQUEST idle timeout is 150s
   on every plan — send the caller nothing for that long and the request is
   closed under you — so the same briefing, now completing and delivering
   perfectly, still hands pg_net a 504.

   That 504 is the thing this test exists for. In `net._http_response`, the only
   place a dispatch is recorded, it is indistinguishable from a call that never
   ran at all. A watcher built on that table would report every good briefing as
   a failure, which is the ordinary-day false alarm that gets a monitor ignored.
   Answering first is what makes a non-2xx there mean what it says.

   `?embed=1` is the single exception and it is the one flag NO cron job calls —
   which is how this is asserted, against 004 rather than against a literal.
   Its answer IS its interface: it is called until it reports `left: 0`.
   ─────────────────────────────────────────────────────────────────────────── */

test('a cron-dispatched call answers first, and only the backfill door waits', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
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

  /* THE EXCEPTION IS DERIVED, NOT TYPED. Any flag a cron job dispatches must go
     the answer-first way; `embed` is the only one no job calls, which is what
     entitles it to wait. Add a cron job for it and this fails, which is the
     point — the door would then be able to 504 like the rest. */
  const dispatched = new Set(
    [...CRON_SQL.matchAll(/functions\/v1\/[\w-]+\?(\w+)=\w+/g)].map(m => m[1]));
  const waits = [...branch.matchAll(/get\("(\w+)"\) === "1"\) return await/g)].map(m => m[1]);

  assert.deepEqual(waits, ['embed'],
    `the doors that wait for their work are ${JSON.stringify(waits)} — only the ` +
    `backfill earns that, because only its answer is what the caller came for`);
  for (const flag of waits) {
    assert.ok(!dispatched.has(flag),
      `?${flag}=1 waits for its work AND has a cron job in 004 — that job will ` +
      `collect a 504 on every run long enough to matter`);
  }
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

test('every number off the quote reaches her with the window it was measured over', () => {
  /* THE FAILURE THIS EXISTS TO PREVENT HAS ALREADY HAPPENED ONCE, and it left
     no trace anywhere except in the message he read. `readMarket` served the
     folded quote as raw JSON, so `change` arrived as a bare number with no
     window attached — and every window in that object is the BROKER'S session,
     which for gold restarts at the 17:00 New York roll. Before the roll that
     makes `change` the overnight move, which is what the briefing's opening
     line wants and why nobody noticed. After it, the same field is a few hours
     of evening trade, and at 20:57 it reached him as "up $12 on the day" about
     a day that was up more than $40.

     NOTHING ELSE BREAKS IF THE LABEL GOES. The quote is still served, the
     numbers are still right, the message still reads as a working price — the
     only thing missing is the sentence saying what the numbers are of, which is
     exactly the shape of the positionsBlock guard and of the prompt's own
     sourcing rule. So it is read here, on both of the paths that carry it: the
     tool every briefing calls, and the one message that is sent in the hours
     when the two windows disagree. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const body = (name, kind = 'async function') => {
    const at = src.indexOf(`${kind} ${name}(`);
    assert.ok(at > -1, `doji-eugenia no longer has ${name}()`);
    const end = src.indexOf('\n}', at);
    return src.slice(at, end).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  };

  /* THE WINDOW IS INSIDE THE RENDERING RATHER THAN BESIDE IT, which is what
     makes this one assertion rather than one per caller. A quote said three
     ways is three chances to print `change` without saying what it changed
     from, so there is one `quoteLine` and it carries the label itself. */
  assert.match(body('quoteLine', 'export function'), /quoteWindow\(/,
    'quoteLine no longer says which session its figures cover, so every caller ' +
    'of it now hands her a `change` with no window on it — which after the 17:00 ' +
    'roll reads as the move on the day and is not');

  /* AND EVERY PATH THAT PUTS A PRICE IN FRONT OF HER GOES THROUGH IT. The tool
     any turn may call, the block the briefing is handed, and the price sense —
     three callers, and a fourth that rendered its own would be the way this
     comes back. */
  for (const fn of ['readMarket', 'marketBlock', 'postMove']) {
    assert.match(body(fn), /quoteLine\(/,
      `${fn} renders the quote its own way instead of through quoteLine — a ` +
      `second rendering is a second chance to state a figure without its window`);
  }

  /* THE BRIEFING IS HANDED THE PRICE RATHER THAN ASKED TO FETCH IT. Every other
     thing it always needs is read before the call; the price was a tool she had
     to remember to reach for, which is an instruction standing where an input
     belongs. It fails silently — a level off a search page is four digits and
     looks like gold. */
  assert.match(body('postBriefing'), /marketBlock\(/,
    'the briefing no longer reads the price before it writes, so its opening ' +
    'line depends on her choosing to call a tool — and a stale level quoted ' +
    'from a search is indistinguishable from a live one');

  /* AND THE BOUNDARY IS THE ONE THE REST OF THE SYSTEM ALREADY KEEPS. 17:00 New
     York is the Friday close, the Sunday open and the poller's whole definition
     of market hours; a second literal here would be a fourth copy of one value
     with nothing comparing them. It reads nyClock for the same reason every
     other schedule does — a fixed UTC hour is right for half the year. */
  assert.match(src, /export const ROLL_HOUR = 17;/,
    'the roll hour is no longer named, so the window label is deciding from a literal');
  assert.match(src, /nyClock\(now\)\.hour >= ROLL_HOUR/,
    'the window is no longer decided on the New York clock — a fixed offset is ' +
    'an hour wrong for every winter evening, which is half the hours this matters in');
});

test('the two unscheduled looks both build a term before they use one', () => {
  /* THE PRINT LOOK AND THE MOVE LOOK ARE THE SAME SHAPE — something happened
     that this morning did not cover — and for a release the move look was the
     half that could only report. Both are handed the channel map (asserted with
     the rest of the blocks above); this is the other half, which is that the
     prompt actually asks for the thing the map is for.

     Handing a path the ladder and not telling it to build from it fails exactly
     the way handing it the instruction without the ladder does: she teaches
     well, about whatever the message happens to be about, and the channel he
     has never once used stays never used. Neither half is visible at runtime. */
  const prompts = readFileSync(
    new URL('../supabase/functions/doji-eugenia/prompt.ts', import.meta.url), 'utf8');

  const section = (name) => {
    const m = prompts.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`));
    assert.ok(m, `prompt.ts no longer exports ${name}`);
    return m[1];
  };

  /* THE RUNG THEY NAME IS `explained`, AND NAMING `unseen` INSTEAD IS THE BUG
     THIS REPLACED. Both prompts used to read "build it at unseen, do not at
     owns" — a pair of ends over a four-rung ladder, and the bottom one is a
     ONE-WAY DOOR: `setChannel` refuses to write it back, because it means the
     subject has never once come up. So the only build instruction either path
     had stopped being reachable the first time a channel was mentioned, and the
     two rungs every channel actually sits at had no instruction at all.

     A binary rule over four states reads as "the other case". She used the term
     bare, correctly, for weeks — and no prompt tweak could fix it, because the
     rule being followed was the one written down. */
  for (const name of ['RELEASE', 'MOVE']) {
    const text = section(name);
    assert.match(text, /where he stands on each channel/i,
      `${name} never tells her she has the channel map, so the block reaches her ` +
      `as context she has no instruction to use`);
    assert.match(text, /\bexplained\b/,
      `${name} no longer names the rung nearly every channel sits at — bound to ` +
      `the bottom rung instead, it stops building the first time a subject comes ` +
      `up and never starts again`);
    assert.match(text, /\bowns\b/,
      `${name} no longer says when NOT to build, and explaining something he owns ` +
      `is the one failure worse than saying nothing`);
  }

  /* AND THE MOVE LOOK IS TOLD WHAT ITS OWN FIGURES ARE OF. It is the only path
     that fires in the evening, which is the only time the broker's session and
     the calendar day disagree — so the prompt carrying the roll is not a
     restatement of the block above it but the rule for reading it. */
  assert.match(section('MOVE'), /17:00 New York/,
    'the move look is no longer told where its session starts, and the evening ' +
    'is the only time it runs where that matters');
});

/* ─── The app's arithmetic, in a second runtime ──────────────────────────────
   `journal.ts` is index.html's stats layer ported so she can reach it, and
   there is no build step between them — so this is a copy, and a copy nothing
   compares is the defect rather than the copy. Three constants and the shape of
   the definitions are read out of BOTH files.

   The break-even band is the one that matters most. It is ±$3 of the entry
   PRICE, and the alternative that looks identical everywhere except on a large
   position is ±$3 of the P&L. If these two files ever disagree about it, the
   win rate she quotes and the win rate on his screen differ, and neither says
   which is which.
   ─────────────────────────────────────────────────────────────────────────── */
test('the journal stats agree with the app they were ported from', () => {
  const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

  /* AND THE HOURS BEHIND THEM, since the names agreeing is not the same as the
     boundaries agreeing: a London close an hour out relabels every trade in the
     overlap and nothing about the output looks wrong. */
  for (const [name, m] of Object.entries(MARKETS)) {
    const row = app.match(new RegExp(`${name}:\\s*\\{[^}]*tz:\\s*'([^']+)'[^}]*open:\\s*(\\d+)[^}]*close:\\s*(\\d+)`));
    assert.ok(row, `index.html no longer defines the ${name} session hours`);
    assert.deepEqual([m.tz, m.open, m.close], [row[1], Number(row[2]), Number(row[3])],
      `the ${name} hours differ between the app and journal.ts`);
  }

  /* THE THREE SUBTLE DEFINITIONS, read as SHAPE rather than as text, because
     the prose differs between a browser file and an Edge module while the rule
     must not. Each is the half of a pair that looks identical in every ordinary
     case and parts on one: a scratch measured in price rather than dollars, a
     money split on the sign rather than the label, and averages on the label
     rather than the sign. */
  const mod = readFileSync(
    new URL('../supabase/functions/doji-eugenia/journal.ts', import.meta.url), 'utf8');

  for (const [what, re] of [
    ['the scratch band against the entry PRICE', /Math\.abs\(t\.exit_price - t\.entry_price\) <= BE/],
    ['the money split on the SIGN of the P&L',    /if \(t\.pnl >= 0\) gross \+= t\.pnl; else loss -= t\.pnl;/],
    ['the averages split on the RESULT LABEL',    /r === 'win'[\s\S]{0,60}r === 'loss'/],
    /* THE FOURTH, and the one a band cannot state. A trade can move sixty
       dollars of price and come back to exactly nothing once commission is in,
       so the price band cannot reach it — and it is a break-even at any lot
       size, which is the property the band is measured in price to protect.
       Both files must say so or the same trade is a break-even in the app and a
       loss to her, on the same row. */
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

test('the stats tool is offered wherever the journal is reasoned about', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  /* A CONVERSATION AND THE NIGHTLY PASS, and the pass is the one that would be
     missed. It is told to notice what he has started doing differently, which
     is a claim about a stretch of trading — and it was given the week's rows to
     make it from. The rows are the evidence; this is the arithmetic over them. */
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
  /* THE FUNCTION IS 007's, AND ONLY 007's. It was 005's until the query vector
     needed a third argument — `create or replace function` cannot change an
     argument list, so 007 drops and recreates. A definition left behind in 005
     would not replace 007's, it would sit beside it as an overload, and 005 is
     the file meant to be applied again.

     The return type is still load-bearing for the same reason it always was:
     widening it needs another drop, and the columns searchList reads have to
     survive that. */
  const fn = SEMANTIC_SQL.match(/create function public\.eugenia_search[\s\S]*?\$\$;/);
  assert.ok(fn, '007 no longer defines eugenia_search');
  assert.doesNotMatch(SENSES_SQL, /function public\.eugenia_search/,
    '005 defines eugenia_search again — re-applying it would recreate the ' +
    'two-argument overload 007 exists to drop, executable by anon');
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

/* ─── A re-runnable file may not undo a later one ────────────────────────────
   The numbered files are applied in order by hand, and two of them are meant to
   be applied AGAIN as they grow. That only works while nothing in an earlier
   file recreates something a later file has since dropped — and 005 did exactly
   that for a release: it carried the two-argument `eugenia_search` that 007
   drops to make room for the query vector.

   Re-applying 005 on a database that has had 007 would have put the old
   signature back beside the new one. Two things then go wrong at once, and 007's
   own comment names both: a two-argument call matches both functions and
   Postgres refuses it as ambiguous, and a bare `create` takes `execute` from the
   schema's default privileges — which Supabase grants to `anon` and
   `authenticated` BY NAME, so the `revoke ... from public` beside it does not
   touch them. Her whole memory, reachable with the key that ships in the page.

   Nothing failed. The file applies cleanly, the revoke it carries looks like the
   guard, and the damage is a privilege nobody asked about.
   ─────────────────────────────────────────────────────────────────────────── */

test('no numbered file recreates an object a later one drops', () => {
  const files = readdirSync(new URL('../supabase', import.meta.url))
    .filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  assert.ok(files.length >= 6, `only ${files.length} numbered files found — the reader has gone blind`);

  const text = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
  const dropped = [];
  for (const f of files) {
    for (const [, kind, name] of text(f).matchAll(
      /^drop (function|view|table|trigger) if exists (?:public\.)?([a-z0-9_]+)/gm)) {
      dropped.push({ file: f, kind, name });
    }
  }
  assert.ok(dropped.length >= 1, 'no drops read at all — the reader has gone blind');

  /* ONLY THE FILES THAT CAN ACTUALLY BE APPLIED AGAIN. A file carrying a bare
     `create table` refuses on its second run and stops there — 001 and 003 are
     run-once by construction, which is why they may still hold the definitions
     they had. Derived from the file rather than listed here, so a file that
     becomes re-runnable comes under this rule the moment it does. */
  const rerunnable = (f) => !/^create table (?!if not exists)/m.test(text(f));

  for (const d of dropped) {
    for (const f of files.filter(f => f < d.file && rerunnable(f))) {
      assert.doesNotMatch(text(f), new RegExp(`create (or replace )?${d.kind} (public\\.)?${d.name}\\b`),
        `${f} creates ${d.kind} ${d.name} and ${d.file} drops it — applying ${f} ` +
        `again on a database that has had ${d.file} puts back the thing ${d.file} ` +
        `was written to remove, and says nothing`);
    }
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

test('the three columns with two claimants are filtered inside the UPDATE', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

  /* `fill_time` JOINED THEM, AND ARRIVED HERE THE HARD WAY. It had ONE writer
     and it was the email — the poller saw every close within two minutes,
     already knew the instant, and never wrote it. So a close with no alert
     behind it left the column null for ever: Eugenia reported eight positions
     he had closed, cited R-19 and R-15 at him about them, and her close sense
     never fired once. The filter is what keeps the email owning it wherever it
     lands, with this filling the gaps rather than racing it. */
  for (const [fn, col] of [['writeBalance', 'balance'], ['writePlan', 'planned_sl'],
                           ['writeFill', 'fill_time']]) {
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

test('the trade look speaks only about the day it is happening on', () => {
  /* BOTH THINGS THIS PATH MAY SAY ARE ABOUT TODAY and neither had anything
     checking that the trade is. `aheadToday` reads the releases still to come
     THIS day; R-11 says the day ends here, which is a sentence whose whole
     content is that he should stop trading now.

     The trigger fires on a transition, not on a clock, so the row it carries is
     only today's by habit — and anything that stamps an old close fires it for
     an old day. It took the poller's first backfill to show it: two messages
     arrived saying "today's realised P&L is −61.78" and "the day sits at
     −318.88", about the 11th and the 19th of August, in the present tense,
     three weeks after those days ended.

     Read as a guard BEFORE either branch, because it is a property of the event
     rather than of what she would have said about it — and placed after the
     branches it would be two guards, with the second one to be forgotten. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

  const at = src.indexOf('async function postTradeEvent(');
  assert.ok(at > -1, 'doji-eugenia no longer has postTradeEvent()');
  const body = src.slice(at, src.indexOf('\n}', at));

  assert.match(body, /row\.open_day !== nyDate\(new Date\(\)\)/,
    'the trade look no longer checks the trade is today, so any late stamp — a ' +
    'forced repair, an email arriving days later — reports a finished day in ' +
    'the present tense as though he could still act on it');

  const guard = body.indexOf('row.open_day !== nyDate');
  assert.ok(guard > -1 && guard < body.indexOf("event === 'opened'"),
    'the day guard sits inside or after the branches rather than before them — ' +
    'one of the two paths is then unguarded, and it is whichever one nobody ' +
    'thought about second');
});

test('the close instant is written only where the deals say it closed', () => {
  /* THE SAME SET THE BALANCE WRITE TAKES, and it has to be: a fully closed
     position cannot end on an opening deal, so wherever there is an exit price
     the latest deal IS the closing one. On a partial close there is no exit
     price and there is no close to stamp — writing one would file a position
     still running as finished, which is the reported bug in reverse and worse.

     Read out of the handler rather than the helper, because the helper cannot
     see which rows it is called for. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

  assert.match(src, /folded\.filter\(f => f\.row\.exit_price !== null\)[\s\S]{0,120}writeFill\(f\.row\.id, f\.closedAt\)/,
    'the close instant is no longer confined to positions the deals show closed — ' +
    'an open position stamped with a fill_time is reported as finished, and the ' +
    'close trigger fires for a trade that is still running');

  // AFTER the upsert, for writePlan's reason: a PATCH against an id nothing has
  // inserted matches nothing and reports success.
  assert.ok(src.indexOf('await upsert(folded.map(f => f.row))') < src.indexOf('writeFill(f.row.id'),
    'the close instant is written before the row exists, so every first sighting ' +
    'of a close is silently skipped');

  /* AND IT NEVER TAKES THE POLL DOWN. The deals are why this function exists
     and are written by the time this runs; a close instant that fails to record
     leaves one row in the state every unstamped row is already in. */
  const at = src.indexOf('let stamped = 0;');
  assert.ok(at > -1, 'the poller no longer counts the close instants it wrote');
  assert.match(src.slice(at, at + 400), /try \{[\s\S]*?\} catch/,
    'the close-instant write is unguarded, so one failed PATCH loses the whole poll');

  // Counted on the ANSWER rather than the attempt, for `planned`'s reason: a
  // PATCH filtered to nothing is a 200, so a count of calls reads the same on a
  // working filter and a broken one.
  assert.match(src.slice(at, at + 400), /if \(await writeFill\([^)]*\)\) stamped\+\+;/,
    'stamped counts calls made rather than rows written — the number would read ' +
    'the same whether the filter works or has stopped filtering');
  assert.match(src, /balance_for: target, planned, stamped,/,
    'the poller no longer reports what it stamped, so the one meter on this ' +
    'arbitration is not in the answer anybody reads');
});

/* ─── And the meter beside the filter has to be able to report it failing ────
   `planned` in the poller's answer counted CALLS. With a position open it read
   1 every two minutes — which is what a working filter, a filter that had
   stopped filtering, and a row the upsert had not yet inserted all look like.
   Three states, one number, and the number nobody could learn anything from sat
   directly beside the arbitration above: the meter could not see the failure it
   was adjacent to.

   It counts rows now, and `return=representation` is what makes that possible —
   a PATCH filtered to nothing is a 200 with an empty body, so `res.ok` alone
   can never answer the question. DROPPING THE PREFER HEADER IS THE SILENT HALF:
   the body comes back empty, every write reads as no write, and the meter
   settles on 0, which is exactly the healthy steady state. Nothing else in the
   suite would notice.
   ─────────────────────────────────────────────────────────────────────────── */

test('the poller counts the plans it wrote, not the plans it tried', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

  /* BOTH FILTERED WRITERS, because the silent half is a property of the shape
     rather than of one function: a PATCH under a `is.null` filter always
     answers 200, so without the representation there is nothing to count and
     the meter settles on the healthy steady state. writeFill was added with
     this uncovered and a falsification found it — dropping its header turned
     nothing red. */
  for (const fn of ['writePlan', 'writeFill']) {
    const at = src.indexOf(`function ${fn}(`);
    assert.ok(at > -1, `doji-mcp-sync no longer has ${fn}()`);
    const body = src.slice(at, src.indexOf('\n}', at));

    assert.match(body, /Promise<boolean>/,
      `${fn} no longer answers whether it wrote, so the count beside it is ` +
      `back to counting calls`);
    assert.match(body, /sbHeaders\("return=representation"\)/,
      `${fn} asks for no representation, so a PATCH that matched nothing and ` +
      `one that wrote come back identical — the meter reads 0 forever, which ` +
      `is indistinguishable from a quiet poll`);
  }

  assert.match(src, /if \(await writePlan\([^)]*\)\)\s*planned\+\+/,
    'the poller increments its plan count on the call rather than on the answer, ' +
    'so a filter that stopped filtering would report exactly what a working one does');
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

/* ─── A look may fill a release in and may never file one ────────────────────
   The release look held `log_calendar`, whose key is (at, name) over a name the
   model writes. On 16 September it was handed
   `US retail sales (August, advance)`, marked that row at 12:35:00, and filed
   the print under `retail sales` at 12:36:15 — an INSERT. The actual landed on
   a row with no consensus, the consensus stayed on a row with no actual, and
   the comparison the table exists for was gone with nothing failing.

   The RELEASE prompt had said *the same time and name* since the tool was
   written. That is the evidence, rather than an argument, that this cannot be
   carried by an instruction — so the tool array is the guarantee now, and these
   read for it. Every one of them is silent when it breaks: a look that can
   upsert again still answers, still sends a correct message, and leaves a
   second row behind that nobody is looking at.
   ─────────────────────────────────────────────────────────────────────────── */

test('the release look is handed no tool that can file a calendar row', () => {
  const array = EUGENIA_TS.match(/const RELEASE_TOOLS = \[([^\]]*)\]/)?.[1];
  assert.ok(array, 'RELEASE_TOOLS is no longer an array literal, so nothing here can read it');
  assert.doesNotMatch(array, /CALENDAR_TOOL/,
    'the release look can upsert the calendar again — it will mint the row it was ' +
    'looking at, under a name a shade off the one it was handed');
  assert.match(array, /ACTUAL_TOOL/,
    'the release look has no way to record what a release printed, so the table ' +
    'keeps a consensus for ever and never the number');
});

test('record_actual cannot be handed a column the briefing owns', () => {
  const schema = EUGENIA_TS.slice(EUGENIA_TS.indexOf('const ACTUAL_TOOL'));
  const props = schema.slice(0, schema.indexOf('required:'));
  for (const owned of ['consensus', 'prior', 'importance']) {
    assert.doesNotMatch(props, new RegExp(`\\b${owned}:`),
      `record_actual offers ${owned} — the same release once carried two ` +
      `contradictory priors because a look could write one`);
  }
});

test('the release prompt asks for the tool the release look actually has', () => {
  const release = EUGENIA_PROMPT.match(/export const RELEASE = `([\s\S]*?)`;/)?.[1];
  assert.ok(release, 'the RELEASE prompt is no longer readable from here');
  assert.match(release, /record_actual/,
    'the release prompt names no tool for the number, so the look reads the print and files nothing');
  assert.doesNotMatch(release, /log_calendar/,
    'the release prompt still names log_calendar, which that path is no longer given — ' +
    'she is being asked for a tool that answers "there is no tool called that here"');
});

test('the release look is handed the stamp its tool takes', () => {
  /* THE HEADING IS IN ET AND THE TOOL TAKES UTC. Asked to convert, she converts
     from a New York clock she was given as words — a conversion standing where
     an input belongs, which is the shape the price line was moved for. Dropping
     it breaks nothing: the look still runs, still says the right thing, and
     writes against an instant an hour out for half the year. */
  const at = EUGENIA_TS.indexOf('async function postRelease(');
  const body = EUGENIA_TS.slice(at, EUGENIA_TS.indexOf('\n}', at));
  assert.match(body, /toISOString\(\)[\s\S]{0,80}record_actual/,
    'postRelease no longer hands her the UTC stamp record_actual matches on');
});

test('a mark is not an edit, so stamping looked_at leaves updated_at alone', () => {
  /* `updated_at` exists to say which of two contradictory rows carries the later
     CONTENT. markLooked writes looked_at and nothing else, so an unconditional
     touch makes it say when a row was last HANDLED — and on 16 September the row
     with the stale prior was marked at 12:35:00 while the row with the actual
     was written at 12:36:15. Seventy-five seconds is the whole reason it ordered
     correctly. Reverse them and the column answers the opposite of the truth. */
  const fn = SENSES_SQL.slice(SENSES_SQL.indexOf('function public.eugenia_calendar_touch()'));
  const body = fn.slice(0, fn.indexOf('$$;') + 3);
  assert.match(body, /is distinct from/,
    'eugenia_calendar_touch moves updated_at on every update again, so a look ' +
    'marking a stale row makes it read as the later one');
  for (const ignored of ['updated_at', 'looked_at']) {
    assert.ok(body.split(`- '${ignored}'`).length === 3,
      `${ignored} is not excluded from both sides of the comparison, so the ` +
      `trigger compares a column it is in the middle of writing`);
  }
});

/* ─── The shape rules, and the critic's second copy of each ──────────────────
   `CRITIC` runs LAST. A rule tightened for the writer and left out of the
   critic is a rule the critic removes again every morning, which is how the
   build-up `PITCH` had just required came to be cut from every briefing before
   it was sent. These hold the pairs together.

   Each one is silent when it breaks: the briefing still arrives, still reads
   well, and is simply back to the thing he said was too hard to read.
   ─────────────────────────────────────────────────────────────────────────── */

test('one idea per sentence is stated to the writer and to the critic', () => {
  /* THE DIAGNOSIS THAT WAS MISSING ENTIRELY. Everything here bounded word
     CHOICE and nothing bounded a SENTENCE — so plain words in a sentence
     carrying three ideas read as hard, correctly, and no rule was being
     broken. */
  assert.match(EUGENIA_PROMPT, /ONE IDEA PER SENTENCE/,
    'the writer is no longer told to split a sentence, which is where the ' +
    'difficulty actually comes from');
  assert.match(EUGENIA_PROMPT, /DOES ANY SENTENCE CARRY MORE THAN ONE IDEA\?/,
    'the critic no longer checks sentence length — the writer may obey it and ' +
    'the pass that runs last has no reason to keep that version');
  for (const half of [EUGENIA_PROMPT.slice(0, EUGENIA_PROMPT.indexOf('export const CRITIC')),
                      EUGENIA_PROMPT.slice(EUGENIA_PROMPT.indexOf('export const CRITIC'))]) {
    assert.match(half, /[Tt]wenty words/,
      'one of the two copies has lost the ceiling, so they disagree about what long is');
  }
});

test('the number budget is stated to the writer and to the critic', () => {
  // Nothing bounded these before. Fourteen true figures is a page he skims.
  assert.match(EUGENIA_PROMPT, /FOUR TO SIX NUMBERS IN THE WHOLE BRIEFING/,
    'the writer is no longer given a number budget');
  assert.match(EUGENIA_PROMPT, /HOW MANY NUMBERS ARE IN IT\?/,
    'the critic no longer counts them, so the budget is advisory');
});

test('the word count never outranks the teaching block, in either copy', () => {
  /* A CEILING ON ITS OWN WAS TRIED HERE AND IT CUT THE TEACHING, every morning,
     because the teaching block is the longest thing on the page. The count is
     only safe while what to cut INSTEAD is stated beside it — so these two
     belong to one decision and a copy holding the count alone reproduces the
     failure the count was removed for. */
  const writer = EUGENIA_PROMPT.slice(0, EUGENIA_PROMPT.indexOf('export const CRITIC'));
  const critic = EUGENIA_PROMPT.slice(EUGENIA_PROMPT.indexOf('export const CRITIC'));
  for (const [who, half] of [['writer', writer], ['critic', critic]]) {
    assert.match(half, /250 to 300 words/, `the ${who} has lost the word count`);
    assert.match(half, /[Nn]ever the teaching block|NOT A PLACE YOU CUT|never out of the block/,
      `the ${who} holds a word count with nothing saying what to cut instead — ` +
      `which is the arrangement that stopped her teaching the first time`);
  }
});

test('the gold-against-real-yields chain is exempt from the rung, in both copies', () => {
  /* THE ONE PLACE THE LADDER IS OVERRIDDEN, and it has to be said in both: the
     critic is the half that decides a mechanism it can see inside one briefing
     is a repetition. At `owns` the map says use it bare, and for this chain
     that is wrong — it is under nearly every briefing, and a reader who has
     lost it has lost all of them. */
  // WHITESPACE-COLLAPSED, because this file is hard-wrapped at eighty columns by
  // its own prose guard — a phrase is routinely split across two lines, and a
  // reader that cannot see one would report a rule missing that is sitting there.
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

test('nothing invented gets reused as a term', () => {
  assert.match(EUGENIA_PROMPT, /NO COINED SHORTHAND/,
    'she may coin a name for something and then lean on it as jargon again — ' +
    'which reads as a term he was taught and never was');
  assert.match(EUGENIA_PROMPT, /NO PUNCHLINES/,
    'the no-punchline rule is gone, so a paragraph may close on a line that ' +
    'sounds good and takes a second to decode');
});

/* ─── verify.sql is one statement, and diagnose.sql is where the rest went ────
   A SQL editor shows the result of the LAST statement only. Ten listings under
   the summary meant that running the file top to bottom displayed the last ten
   HTTP responses and threw all 71 checks away — which is not hypothetical: it
   happened, to the person who wrote the note at the bottom explaining it, and
   then again to the person that note was written for.

   Moving the summary to the END instead would have been worse. Three of those
   listings can RAISE on a database missing what they read — `cron.job` without
   pg_cron, `net._http_response` without pg_net, a public table never created —
   and anything that raises takes every statement after it, so the summary would
   vanish on exactly the databases it exists for. Two files is what lets both be
   last in their own.

   The regression is one appended `select`, and it is silent: the file still
   runs, every check still passes, and the grid shows something else.
   ─────────────────────────────────────────────────────────────────────────── */

test('verify.sql runs exactly one statement, so the editor shows the checks', () => {
  const sql = readFileSync(new URL('../supabase/verify.sql', import.meta.url), 'utf8');

  /* Comments first, then string literals — the order this file already learned
     the hard way, since a `--` comment here routinely carries an apostrophe and
     one unpaired quote desynchronises literal matching for everything after. */
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
  const diag = readFileSync(new URL('../supabase/diagnose.sql', import.meta.url), 'utf8');
  for (const read of ['cron.job', 'net._http_response', 'information_schema.columns']) {
    assert.ok(diag.includes(read),
      `diagnose.sql no longer reads ${read}, so "which schedule, which column" ` +
      `has no answer anywhere`);
  }
});
