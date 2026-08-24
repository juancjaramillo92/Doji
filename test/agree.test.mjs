/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the copies that have to agree
   ───────────────────────────────────────────────────────────────────────────
   Four runtimes, no build step, and facts that consequently live in more than
   one file: the setups vocabulary, the four journal column names, Eugenia's
   note limit, and the names of the functions themselves.

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

const SCHEMA = readFileSync(new URL('../supabase/001_trades.sql', import.meta.url), 'utf8');
const EUGENIA_SQL = readFileSync(new URL('../supabase/003_eugenia.sql', import.meta.url), 'utf8');
const EUGENIA_TS = readFileSync(
  new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

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
    ];
    const reachable = new Set([...app.Data.OWNED, ...Object.values(COLUMNS)]);
    for (const column of broker) {
      assert.ok(!reachable.has(column), `${column} is writable from the journal half`);
    }
  } finally { close(); }
});

/* ─── Eugenia's note length ──────────────────────────────────────────────────
   200 lives in three places: the ceiling writeNote truncates at, the constraint
   Postgres enforces, and the sentence the tool description gives the model.

   They fail quietly if they drift. Truncate above the constraint and every
   remember() is refused by Postgres — writeNote catches that and answers "That
   did not save. Carry on and do not mention it.", which is deliberate for a
   transient blip and is exactly wrong for a permanent mismatch: her memory
   stops working and the only sign is her not mentioning it.
   ─────────────────────────────────────────────────────────────────────────── */

const noteLimit = {
  truncatedAt: () => Number(EUGENIA_TS.match(/\.trim\(\)\.slice\(0,\s*(\d+)\)/)?.[1]),
  constrainedTo: () =>
    Number(EUGENIA_SQL.match(/char_length\(note\)\s+between\s+1\s+and\s+(\d+)/i)?.[1]),
  toldToTheModel: () => Number(EUGENIA_TS.match(/at most (\d+) characters/)?.[1]),
};

test('the note length is one number in all three places', () => {
  // Each number is read back out of its own file, so a pattern that stops
  // matching yields NaN — and NaN against NaN would report a drift that is
  // really this test having gone blind. All three are checked before they are
  // compared, which is the same reason the setups lists are counted first.
  const truncated  = noteLimit.truncatedAt();
  const constraint = noteLimit.constrainedTo();
  const promised   = noteLimit.toldToTheModel();
  assert.ok(Number.isInteger(truncated), 'writeNote no longer truncates at a literal length');
  assert.ok(Number.isInteger(constraint), 'the note constraint no longer reads as a char_length range');
  assert.ok(Number.isInteger(promised), 'the tool description no longer states a character budget');

  assert.equal(constraint, truncated,
    'Postgres would refuse notes writeNote considers fine — every remember() fails quietly');
  assert.equal(promised, truncated,
    'the tool description promises the model a budget the code does not keep');
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
     tg_message_id               the column Gladys works without, by design
     background_color            }  manifest fields tried against the iOS
     apple-touch-startup-image   }  launch frame, none of which reached it */
const DELIBERATELY_ABSENT = new Set([
  'TODO', 'tg_message_id', 'background_color', 'apple-touch-startup-image',
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

  for (const fn of ['postBriefing', 'postPulse', 'handleMessage']) {
    assert.match(body(fn), /notesBlock\(\)/,
      `${fn} does not read his notes — an instruction he gave would be ignored ` +
      `with nothing anywhere reporting it`);
  }
});
