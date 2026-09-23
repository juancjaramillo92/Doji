/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the two questions a compiler answers and no test in here can
   ───────────────────────────────────────────────────────────────────────────
   This suite exists because of a defect that shipped past 473 green tests, a
   green deploy and a reading pass: `turnsSince` was left calling `res.json()`
   after the read it wrapped had been folded into `readRows`, so the nightly
   consolidation died with `res is not defined` at 22:00 and again on the 23:00
   retry. Nothing here could have found it. The suite drives what is exported
   and pure; `turnsSince` is neither, and every other read of her tables is in
   the same position — the network is on its first line, so the twenty call
   sites that one refactor rewrote were checked by eye and by nothing else.

   A free variable is not a matter of taste or of coverage. It is a fact about
   the file that a parser settles in under a second, and this repository has
   twice written as though a compiler were reading these files — fold.test.mjs
   says the `Effort` union "is what a compiler catches instead", and the README
   says the trigger's column lists are "text in a file no compiler reads". One
   of those was true and the other was not. Now both are.

   WHAT IT ASKS IS DELIBERATELY NARROW, and the narrowness is the point rather
   than a shortcut. These functions run on Deno, and a full typecheck under
   Node's lib says `Uint8Array` is not a `BlobPart` — true here, false where the
   code runs. Its answers also move with `--strict`: without it a discriminated
   union stops narrowing and `moveWorth`'s own `why` reads as absent. So a whole
   typecheck would be a wall of findings that are facts about the invocation,
   and a check whose output has to be triaged is one nobody runs twice.

   The three codes asked for are the ones that are pure scope facts — a name
   used that is declared nowhere (TS2304, TS2552) and a name declared that
   nothing uses (TS6133). Neither depends on which lib is loaded or how strict
   the run is, so neither can go red for a reason that is not a defect. The
   second is the "free of dead code" rule in CLAUDE.md, enforced rather than
   restated: the same refactor left `nyClock` imported and unused in the poller.

   AND `index.html` IS ASKED THE SAME TWO QUESTIONS, WHICH IS THE LARGER HALF.
   It is the biggest artefact here, one flat namespace, no bundler and nothing
   that reads a name before the browser does — so a renamed helper with one
   call site missed, or a typo in a branch no test drives, is found when he
   opens the page. Every argument above for asking a compiler carries over
   unchanged; the only thing that had ever stopped it was that the script lives
   inside markup, which is four lines to undo. It is compiled as its OWN
   program, never beside the Edge Functions: one is a set of modules and the
   other a classic script, and a shim written for the browser must not be able
   to declare a name into Deno.
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

// Found rather than listed, for the reason the test-count check gives: a fifth
// function is covered the day someone adds it, and a list typed here would be
// a copy nothing compares.
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
   watched failing at. The first is the shape of the one that shipped. The
   second is the half that had never been proved at all: nothing here could
   tell an unused declaration going unreported from there being none, and a
   zero from a question that is not being asked reads exactly like a clean
   tree — which is the failure this file opens by describing. */
const PROBE_SRC =
  'export const planted = () => res.json();\n' +
  'export function alsoPlanted() { const neverRead = 1; return 2; }\n';

const CODES = /^(.+)\((\d+),\d+\): error (TS2304|TS2552|TS6133): (.+)$/;

/* The probe rides in every program rather than in one of them, so each is
   separately proved to be compiling anything at all. A tsc invocation that
   silently matched no files, or a filter that stopped matching, reports a
   clean tree in exactly the voice a clean tree does — three times here a green
   result has been the tool being broken. */
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
   THE SHIM IS A BOUNDARY AND IS DECLARED, NOT DERIVED. `Chart` and `XLSX`
   arrive as globals off CDN scripts this repository does not own, so nothing
   in the tree declares them and nothing could. What CAN be held is that each
   name here is still paid for by a script the page actually loads — a shim
   entry outliving its CDN tag is a global this check would go on accepting
   after the thing providing it was deleted, which is the same free variable
   wearing a declaration.

   `supabase` needs no row: the app reads it as `window.supabase`, which is a
   property question rather than a scope one and is outside the three codes on
   purpose. */
const CDN = {
  Chart: 'chart.js@',
  XLSX:  'xlsx@',
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
