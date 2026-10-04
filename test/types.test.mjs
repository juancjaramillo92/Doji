/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the two questions a compiler answers and no test in here can
   ───────────────────────────────────────────────────────────────────────────
   The suites drive what is exported and pure. A read whose network call is its
   first line is neither, so a free variable in one — `res.json()` left behind
   after the read moved into `readRows` — passes every test and dies in
   production. A parser settles that in under a second.

   WHAT IT ASKS IS DELIBERATELY NARROW. These functions run on Deno, and a full
   typecheck under Node's lib says `Uint8Array` is not a `BlobPart` — true here,
   false where the code runs — and its answers move with `--strict`. A check
   whose output has to be triaged is one nobody runs twice. So only the pure
   scope facts: a name used that is declared nowhere (TS2304, TS2552) and a
   name declared that nothing uses (TS6133). Neither depends on the lib or the
   strictness, so neither can go red for a reason that is not a defect.

   `index.html` is asked the same two questions, and it is the larger half: one
   flat namespace, no bundler, and nothing that reads a name before the browser
   does. It is compiled as its OWN program — one is modules and the other a
   classic script, and a shim written for the browser must not declare a name
   into Deno.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appScript } from './boot.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSC  = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Found rather than listed: a sixth function is covered the day it is added.
function sources(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? sources(`${dir}/${e.name}`)
    : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []);
}

/* Every file in one program, so the relative `.ts` imports resolve against each
   other and a name that arrives from _shared counts as declared. --noResolve
   then stops tsc pulling in anything else; nothing here imports over the
   network, so there is nothing else to pull. */
const FLAGS = [
  '--noEmit', '--noResolve', '--noUnusedLocals', '--allowImportingTsExtensions',
  '--target', 'esnext', '--module', 'esnext', '--moduleResolution', 'bundler',
  '--skipLibCheck',
];

const PROBE = 'probe.ts';

/* ONE PLANTED DEFECT PER QUESTION, because a check proves only what it is
   watched failing at: a zero from a question not being asked reads exactly
   like a clean tree. */
const PROBE_SRC =
  'export const planted = () => res.json();\n' +
  'export function alsoPlanted() { const neverRead = 1; return 2; }\n';

const CODES = /^(.+)\((\d+),\d+\): error (TS2304|TS2552|TS6133): (.+)$/;

/* The probe rides in every program, so each is separately proved to be
   compiling anything at all — a tsc run that matched no files reports a clean
   tree in exactly the voice a clean tree does. */
function scope(files, scratchFiles = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'doji-types-'));
  try {
    writeFileSync(join(scratch, PROBE), PROBE_SRC);
    const written = Object.entries(scratchFiles).map(([name, text]) => {
      writeFileSync(join(scratch, name), text);
      return join(scratch, name);
    });
    let output;
    try {
      // tsc exits non-zero on any finding, including the planted ones and the
      // whole-typecheck noise above that this deliberately ignores.
      output = execFileSync(process.execPath,
        [TSC, ...FLAGS, ...files, ...written, join(scratch, PROBE)],
        { cwd: ROOT, encoding: 'utf8' });
    } catch (err) {
      if (err.stdout === undefined) throw err;
      output = err.stdout;
    }
    const found = output.split('\n').map(l => l.match(CODES)).filter(Boolean);
    return {
      output,
      planted: found.filter(m => m[1].endsWith(PROBE)),
      real: found.filter(m => !m[1].endsWith(PROBE))
        .map(m => `${m[1]}:${m[2]} — ${m[4]}`),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function proved(what, program) {
  assert.deepEqual(program.planted.map(m => m[3]).sort(), ['TS2304', 'TS6133'],
    `${what}: the planted free variable and the planted unused declaration were ` +
    `not both reported, so a clean answer from this program means nothing. ` +
    `tsc said:\n${program.output}`);
}

/* ─── The Edge Functions ─────────────────────────────────────────────────── */

const files = sources('supabase/functions');
const edge = scope(files);

test('the compiler is reading the Edge Functions and the filter still matches', () => {
  assert.ok(files.length >= 5,
    `only ${files.length} Edge Function sources found — the walk has gone blind`);
  proved('the Edge Functions', edge);
});

test('no Edge Function uses a name nothing declares, or declares one nothing uses', () => {
  assert.deepEqual(edge.real, [],
    `a free variable is a function that throws the first time it is reached, ` +
    `and an unused declaration is the half of a refactor that did not land:\n` +
    edge.real.join('\n'));
});

/* ─── The app ────────────────────────────────────────────────────────────────
   THE SHIM IS A BOUNDARY AND IS DECLARED, NOT DERIVED. `Chart` is a global
   off a CDN script this repository does not own. It is held against a script
   the page still loads, or the entry becomes a free variable wearing a
   declaration. `supabase` needs no row: the app reads `window.supabase`, a
   property question rather than a scope one. */
const CDN = {
  Chart: 'chart.js@',
};

const GLOBALS = 'globals.d.ts';
const app = scope([], {
  [GLOBALS]: Object.keys(CDN).map(n => `declare const ${n}: any;\n`).join(''),
  'app.ts': appScript(),
});

test('the compiler is reading index.html and every shimmed global is still loaded', () => {
  const script = appScript();
  assert.ok(script.split('\n').length > 1500,
    `only ${script.split('\n').length} lines of app script extracted — the ` +
    `slice has stopped finding the inline script and this program is empty`);
  proved('index.html', app);

  for (const [name, src] of Object.entries(CDN)) {
    assert.ok(HTML.includes(src),
      `${GLOBALS} declares ${name} and index.html no longer loads ${src} — the ` +
      `shim is now telling the compiler a global exists that nothing provides`);
  }
});

test('the app uses no name nothing declares, and declares none nothing uses', () => {
  assert.deepEqual(app.real, [],
    `index.html is one flat namespace with no bundler, so a name nothing ` +
    `declares is a TypeError the first time that branch is reached and the ` +
    `browser is the only thing that would ever have said so:\n` +
    app.real.join('\n'));
});
