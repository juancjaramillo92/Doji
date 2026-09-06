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

   AND THE READER PROVES ITSELF ON EVERY RUN, which is the rule this project
   keeps re-learning made structural rather than remembered. A tsc invocation
   that silently matched no files, or a filter that stopped matching, reports a
   clean tree in exactly the voice a clean tree does — three times here a green
   result has been the tool being broken. So a file naming something that does
   not exist goes into the same program on every run, and the check is not that
   nothing was found but that THAT was found and nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSC  = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

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
const CODES = /^(.+)\((\d+),\d+\): error (TS2304|TS2552|TS6133): (.+)$/;

const files = sources('supabase/functions');

const scratch = mkdtempSync(join(tmpdir(), 'doji-types-'));
let output;
try {
  // The planted defect: the shape of the one that shipped, in a file of its own
  // so it says nothing about the real ones.
  writeFileSync(join(scratch, PROBE), 'export const planted = () => res.json();\n');
  try {
    // tsc exits non-zero on any finding, including the planted one and the
    // whole-typecheck noise above that this deliberately ignores.
    output = execFileSync(process.execPath, [TSC, ...FLAGS, ...files, join(scratch, PROBE)],
                          { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    if (err.stdout === undefined) throw err;
    output = err.stdout;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const found = output.split('\n').map(l => l.match(CODES)).filter(Boolean);

test('the compiler is reading these files and the filter still matches', () => {
  assert.ok(files.length >= 5,
    `only ${files.length} Edge Function sources found — the walk has gone blind`);
  const planted = found.filter(m => m[1].endsWith(PROBE));
  assert.equal(planted.length, 1,
    `the planted 'res is not defined' was not reported — a clean answer from ` +
    `this check means nothing until it can produce a dirty one. tsc said:\n${output}`);
  assert.equal(planted[0][3], 'TS2304');
});

test('no Edge Function uses a name nothing declares, or declares one nothing uses', () => {
  const real = found.filter(m => !m[1].endsWith(PROBE))
    .map(m => `${m[1]}:${m[2]} — ${m[4]}`);
  assert.deepEqual(real, [],
    `a free variable is a function that throws the first time it is reached, ` +
    `and an unused declaration is the half of a refactor that did not land:\n` +
    real.join('\n'));
});
