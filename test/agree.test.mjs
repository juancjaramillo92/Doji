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
import { readStrategy, SAID } from '../supabase/functions/doji-eugenia/index.ts';

const SCHEMA = readFileSync(new URL('../supabase/001_trades.sql', import.meta.url), 'utf8');
const GLADYS_SQL = readFileSync(new URL('../supabase/002_gladys.sql', import.meta.url), 'utf8');
const EUGENIA_SQL = readFileSync(new URL('../supabase/003_eugenia.sql', import.meta.url), 'utf8');
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
  const stmt = text.match(
    /create or replace view public\.eugenia_trades[\s\S]*?select([\s\S]*?)from public\.trades/i);
  assert.ok(stmt, `${where} no longer states the eugenia_trades view`);
  const cols = stmt[1].split(',').map(c => c.trim()).filter(Boolean);
  // An emptied match would make the comparison below vacuous and green.
  assert.ok(cols.length >= 8, `only ${cols.length} columns read out of ${where}`);
  return cols;
};

test('the README builds the same eugenia_trades view that 003 does', () => {
  const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.deepEqual(
    viewColumns(README, 'README.md'),
    viewColumns(EUGENIA_SQL, '003_eugenia.sql'),
    'the README quotes a view with a different column list than 003_eugenia.sql creates — ' +
    'following the README would build the wrong view');
});

test('the view exposes size_oz and still hides what it is meant to hide', () => {
  const cols = viewColumns(EUGENIA_SQL, '003_eugenia.sql');
  // Without this she can read every trade and never its size, so account tier
  // and per-trade risk stay underivable however the prompt is written.
  assert.ok(cols.includes('size_oz'), 'Eugenia cannot see position size');
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
const CALLERS = ['supabase/002_gladys.sql', 'supabase/004_cron.sql', 'doji_gmail_sync.gs']
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

   Eight copies across five languages, none of them checked by anything else. A
   restore into a new project means editing all eight, and the one that is
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

test('a function refuses to run without every secret it reads', () => {
  for (const { name, text } of FUNCTIONS) {
    const clause = guardClause(text);
    assert.ok(clause, `${name} has no boot guard refusing to run without its secrets`);

    assert.ok(!clause.includes('&&'),
      `${name}'s boot guard joins clauses with && — && binds tighter than ||, ` +
      `so a missing secret in that pair would not refuse the request`);

    const guarded = [...clause.matchAll(/!([A-Z_]+)/g)].map(m => m[1]);

    // A read with a `||` default can never be unset, so it is not required.
    const required = bound(text).filter(b => !b.line.includes('||')).map(b => b.name);
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
     apple-touch-startup-image   }  launch frame, none of which reached it */
const DELIBERATELY_ABSENT = new Set([
  'TODO', 'background_color', 'apple-touch-startup-image',
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

  const served = [...src.matchAll(/b\.name === ([A-Z_]+_TOOL)\.name/g)].map(m => m[1]).sort();
  assert.deepEqual(served, defined,
    'a tool is defined that the loop cannot execute, or the reverse — the first ' +
    'throws only once she happens to call it, the second is unreachable');

  /* AND EVERY TOOL SET IS DRAWN FROM THAT SAME LIST. A name appearing in a set
     but nowhere as a definition is a tool the model is offered and the loop has
     never heard of. */
  for (const set of ['CHAT_TOOLS', 'CONSOLIDATE_TOOLS']) {
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

  assert.match(code, /await\s+tradesBlock\(\)/,
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
    /export const (SYSTEM|CONSOLIDATE) = `([\s\S]*?)`;/g)];
  assert.equal(bodies.length, 2,
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

test('the briefing, the pulse and a reply all read his notes', () => {
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

  /* postConsolidation is the FOURTH and the worst one to lose. The other three
     going without notes costs continuity in one message; consolidation going
     without them means she cannot see what she already holds, so she never
     supersedes and writes the same fact again every night. */
  for (const fn of ['postBriefing', 'postPulse', 'handleMessage', 'postConsolidation']) {
    // Comments stripped, because the identifier appearing in prose about the
    // call is not the call. And `await` required: notesBlock is async, so an
    // un-awaited one interpolates "[object Promise]" into the prompt — which
    // reaches the model as text rather than as an error.
    const code = body(fn).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert.match(code, /await\s+notesBlock\(\)/,
      `${fn} does not await notesBlock() — an instruction he gave would be ` +
      `ignored, or arrive as [object Promise], with nothing reporting either`);
    /* AND THE MAP, on the same four paths and for a sharper version of the same
       reason. Losing the notes costs continuity in one message; losing the map
       costs the only thing that says which channels are THIN, and it fails
       upward — she carries on teaching well, on whatever the day happens to be
       about, and the channel he has never once used stays never used with
       nothing anywhere reporting it. Worst on the nightly pass, which is also
       the only thing that can move a rung: without the map in front of it, it
       cannot see what it is moving from. */
    assert.match(code, /await\s+channelsBlock\(\)/,
      `${fn} does not await channelsBlock() — she would teach without knowing ` +
      `which channels are thin, and nothing would report it`);
  }
});
