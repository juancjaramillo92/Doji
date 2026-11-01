/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the laptop, as far as anything here can drive it
   ───────────────────────────────────────────────────────────────────────────
   The app in laptop/ is Electron: a window, a microphone, a speaker and a
   screen capture, none of which a suite can open. What it can drive is the
   pure half — her frames read off the wire, and her voice read out of them,
   fed the door's own bytes, from `charmFrame`, cut at every place a network
   read can cut them; where her window goes when a screen is gone; and the
   swap an update leaves behind, run in a scratch folder with macOS's `ditto`
   and `open` stood in for, in every way it can fail. The copies the app holds of the
   door and of the charm are agree.test.mjs's; whether she looks, sounds and
   floats as she should is his to see on the Mac (README, The laptop).
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { charmFrame } from '../supabase/functions/doji-eugenia/index.ts';
import { FRAME, framer, sampler } from '../laptop/frames.mjs';
import { placed, room, ROOM } from '../laptop/place.mjs';
import { BUNDLE, swapScript } from '../laptop/update.mjs';

const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

/* A stream as the door sends one: silence first, a volume, her voice in parts
   of every awkward length — empty, one byte, odd, and one past 65,535, which
   needs the length's third byte. */
const SENT = [
  [FRAME.voice, new Uint8Array(4800)],
  [FRAME.volume, Uint8Array.of(80)],
  [FRAME.voice, bytes(0, 1)],
  [FRAME.voice, bytes(1, 2)],
  [FRAME.voice, bytes(4801, 3)],
  [FRAME.voice, bytes(70_001, 4)],
];
const WIRE = Uint8Array.from(SENT.flatMap(([kind, b]) => [...charmFrame(kind, b)]));

function read(cuts) {
  const got = [];
  const feed = framer((kind, b) => got.push([kind, [...b]]));
  let at = 0;
  for (const cut of [...cuts, WIRE.length]) { feed(WIRE.subarray(at, cut)); at = cut; }
  return got;
}

test('the laptop reads the door\'s frames whole, however the reads cut them', () => {
  const sent = SENT.map(([kind, b]) => [kind, [...b]]);
  assert.deepEqual(read([]), sent, 'the stream in one read did not come back as the frames sent');
  // Every cut inside the frame headers and around each frame's edges, where a
  // reader that assumes a whole header or a whole frame goes wrong.
  const edges = [];
  for (let at = 0, i = 0; i < SENT.length; at += 4 + SENT[i][1].length, i++) {
    for (let d = -2; d <= 6; d++) if (at + d > 0 && at + d < WIRE.length) edges.push(at + d);
  }
  for (const cut of edges) {
    assert.deepEqual(read([cut]), sent, `the stream cut at byte ${cut} did not come back whole`);
  }
  // And a read of a few bytes at a time across all of it.
  const small = [];
  for (let at = 7; at < WIRE.length; at += 7 + (at % 13)) small.push(at);
  assert.deepEqual(read(small), sent, 'the stream in small reads did not come back whole');
});

test('her voice cut between the two bytes of a sample plays as the whole would', () => {
  const values = [0, 1, -1, 32767, -32768, 1000, -1000, 12345, -23456];
  const pcm = new Uint8Array(2 * values.length);
  values.forEach((v, i) => new DataView(pcm.buffer).setInt16(2 * i, v, true));
  const whole = [...sampler()(pcm)];
  assert.deepEqual(whole, values.map(v => v / 32768), 'samples were not read as 16-bit little-endian');
  for (let cut = 1; cut < pcm.length; cut++) {
    const read = sampler();
    const parts = [...read(pcm.subarray(0, cut)), ...read(pcm.subarray(cut))];
    assert.deepEqual(parts, whole, `a frame ending at byte ${cut} shifted the samples after it`);
  }
  // Her silence is exact zeros, which is how the page tells thinking from speaking.
  assert.ok(sampler()(new Uint8Array(4800)).every(s => s === 0), 'the door\'s silence did not read as silence');
});

/* ─── Where her window goes ─────────────────────────────────────────────── */

test('she stays where he left her while a screen shows her, and comes home when none does', () => {
  const main = { x: 0, y: 25, width: 1512, height: 920 };
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  const { width, height } = room(200);
  assert.deepEqual([width, height], [Math.round(200 * ROOM.width), Math.round(200 * ROOM.height)]);
  const corner = { x: 1512 - width - 24, y: 25 + 920 - height - 24, width, height };
  assert.deepEqual(placed({ x: 300, y: 400, width, height }, [main], main), { x: 300, y: 400, width, height },
    'a place on the main screen was not kept');
  assert.deepEqual(placed({ x: -900, y: 300, width, height }, [main, left], main), { x: -900, y: 300, width, height },
    'a place on a second screen, left of the main one, was not kept');
  assert.deepEqual(placed({ x: -900, y: 300, width, height }, [main], main), corner,
    'a place on a screen since unplugged left her where nothing shows her');
  assert.deepEqual(placed({ x: undefined, y: undefined, width, height }, [main], main), corner,
    'her first launch did not put her in the corner');
  // Half off an edge is still on the screen her middle is on.
  assert.deepEqual(placed({ x: 1512 - width / 2 + 10, y: 400, width, height }, [main], main).x, corner.x,
    'a place with her middle off every screen was kept');
  assert.equal(placed({ x: 1512 - width / 2 - 10, y: 400, width, height }, [main], main).x, 1512 - width / 2 - 10,
    'a place with her middle on the screen was moved');
});

/* ─── The swap an update leaves behind ──────────────────────────────────── */

function swapping({ unpack = 'whole', mvFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doji-swap-'));
  const apps = join(root, "Apps it's here"), bundle = join(apps, BUNDLE), stubs = join(root, 'bin');
  const unpacked = join(root, 'eugenia-update'), zip = join(root, 'Eugenia.zip'), opened = join(root, 'opened');
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, 'version'), 'old');
  writeFileSync(zip, 'zip');
  mkdirSync(stubs);
  const stub = (name, body) => { writeFileSync(join(stubs, name), `#!/bin/sh\n${body}\n`); chmodSync(join(stubs, name), 0o755); };
  // ditto -x -k <zip> <dest>: the new app unpacked, or not.
  stub('ditto', {
    whole: `mkdir -p "$4/${BUNDLE}" && echo new > "$4/${BUNDLE}/version"`,
    broken: 'exit 1',
    empty: 'mkdir -p "$4"',
  }[unpack]);
  stub('open', `echo "$1" >> '${opened}'`);
  if (mvFails) stub('mv', `case "$1" in *eugenia-update/${BUNDLE}) exit 1;; esac\nexec /bin/mv "$@"`);
  const gone = spawnSync('true').pid;
  execFileSync('/bin/sh', ['-c', swapScript(gone, zip, unpacked, bundle)],
    { env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` } });
  const result = {
    version: existsSync(join(bundle, 'version')) ? readFileSync(join(bundle, 'version'), 'utf8').trim() : null,
    leftover: existsSync(`${bundle}.old`),
    opened: existsSync(opened) ? readFileSync(opened, 'utf8').trim() : null,
  };
  rmSync(root, { recursive: true, force: true });
  return { ...result, bundle };
}

test('an update puts the new app in place of the old, and opens it', () => {
  const r = swapping();
  assert.equal(r.version, 'new', 'the new app is not where the old one was');
  assert.equal(r.leftover, false, 'the old app was left beside the new one');
  assert.ok(r.opened?.endsWith(`Apps it's here/${BUNDLE}`), `the app opened was not the one in place: ${r.opened}`);
});

test('an update that cannot take the old app\'s place leaves the old app, and opens it', () => {
  for (const [why, how] of [['a download that will not unpack', { unpack: 'broken' }],
                            ['a download with no app in it', { unpack: 'empty' }],
                            ['a new app that will not move into place', { mvFails: true }]]) {
    const r = swapping(how);
    assert.equal(r.version, 'old', `${why} left no app, or the wrong one`);
    assert.equal(r.leftover, false, `${why} left the old app set aside`);
    assert.ok(r.opened?.endsWith(BUNDLE), `${why} did not reopen the app`);
  }
});
