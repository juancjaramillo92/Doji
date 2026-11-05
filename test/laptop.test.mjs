/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the laptop, as far as anything here can drive it
   ───────────────────────────────────────────────────────────────────────────
   The app in laptop/ is Electron: a window, a microphone, a speaker and a
   screen capture, none of which a suite can open. What it can drive is the
   pure half — her frames read off the wire, and her voice read out of them,
   fed the door's own bytes, from `charmFrame`, cut at every place a network
   read can cut them; her voice played from its queue while it arrives late
   and unevenly, as a real stream does; where her window goes when a screen
   is gone; the journal's answers, read by Gladys's own boundary, and the
   question a trade is asked first; and the swap an update leaves behind,
   run in a scratch folder with macOS's `ditto` and `open` stood in for, in
   every way it can fail.
   The copies the app holds of the door and of the charm are
   agree.test.mjs's; whether she looks, sounds and floats as she should is
   his to see on the Mac (README, The laptop).
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { charmFrame } from '../supabase/functions/doji-eugenia/index.ts';
import { parseCallback } from '../supabase/functions/doji-gladys/index.ts';
import { FRAME, LEAD, PCM_RATE, Queue, framer, sampler } from '../laptop/frames.mjs';
import { ANSWERS, SETUPS, asked, tap } from '../laptop/journal.mjs';
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

/* ─── Her voice, played from its queue ──────────────────────────────────────
   A speaker pulling a block at a time, as the audio thread does, against her
   voice arriving on a clock of its own: slow at first, as the vendor's stream
   is before it gets ahead of her speaking, then fast. Every sample is its own
   value, so a sample lost, repeated or out of order shows. */
const BLOCK = 128;
const PART = 480;  // 20 ms of her voice

function playing(arrivals) {
  const q = new Queue(PCM_RATE), out = [], said = [];
  const voiceSample = (j) => ((j % 997) + 1) / 2000;
  let sent = 0;
  for (let now = 0, step = 0; step < 4000; step++, now = step * BLOCK / PCM_RATE) {
    while (sent < arrivals.length && arrivals[sent] <= now) {
      q.push(Float32Array.from({ length: PART }, (_, i) => voiceSample(sent * PART + i)));
      if (++sent === arrivals.length) q.end();
    }
    const block = new Float32Array(BLOCK);
    const event = q.fill(block);
    if (event) said.push([event, out.length]);
    out.push(...block);
    if (event === 'drained') break;
  }
  // Her samples are 32-bit, so what she should play is too.
  return { out, said, expected: Array.from({ length: arrivals.length * PART }, (_, j) => Math.fround(voiceSample(j))) };
}

// Her voice as played, against what was sent: the first sample lost, repeated or out of order, by its place.
const whole = (out, expected) => {
  const voiced = out.filter(s => s !== 0);
  const wrong = voiced.findIndex((s, i) => s !== expected[i]);
  return voiced.length === expected.length && wrong === -1 ? 'whole' : `sample ${wrong} of ${voiced.length}, ${expected.length} sent`;
};

// How many runs of silence fall inside her voice, once it has started.
const pauses = (out) => {
  const first = out.findIndex(s => s !== 0), last = out.findLastIndex(s => s !== 0);
  let runs = 0;
  for (let i = first; i <= last; i++) if (out[i] === 0 && out[i - 1] !== 0) runs++;
  return runs;
};

test('her first words come whole while her voice arrives slower than she speaks, then faster', () => {
  // Ten parts a little slower than real time, then the rest in a rush.
  const arrivals = [...Array.from({ length: 10 }, (_, k) => 0.2 + k * 0.025), ...Array.from({ length: 60 }, (_, k) => 0.45 + k * 0.005)];
  const { out, said, expected } = playing(arrivals);
  assert.equal(pauses(out), 0, 'her voice stammered: a silence fell inside it');
  assert.equal(whole(out, expected), 'whole', 'her voice lost, repeated or reordered a sample');
  assert.deepEqual(said.map(([e]) => e), ['voice', 'drained'], 'the queue did not say once that she began and once that she ended');
  // It waited for LEAD of her voice before the first sample went out.
  const first = out.findIndex(s => s !== 0) / PCM_RATE;
  assert.ok(first >= 0.2 + 0.25 && first < 0.2 + LEAD + 0.15, `her voice began at ${first.toFixed(3)} s`);
});

test('a stream that stalls is one pause, never a stammer, and nothing is lost', () => {
  // Steady parts, a stall of half a second, then parts as uneven as a real
  // stream's, on time on average — what plays the moment it arrives stammers.
  const arrivals = [...Array.from({ length: 40 }, (_, k) => k * 0.02),
                    ...Array.from({ length: 40 }, (_, k) => 1.3 + k * 0.02 + (k % 2 ? 0.012 : 0))];
  const { out, expected } = playing(arrivals);
  assert.equal(pauses(out), 1, `the stall was heard as ${pauses(out)} silences`);
  assert.equal(whole(out, expected), 'whole', 'the stall cost a sample');
});

test('an answer shorter than the lead is played whole when it ends, and silence alone says nothing', () => {
  const short = playing([0.1, 0.11, 0.12, 0.13, 0.14]);
  assert.equal(whole(short.out, short.expected), 'whole', 'a short answer waited for a lead it would never reach');
  const q = new Queue(PCM_RATE);
  q.push(new Float32Array(2400));
  q.end();
  const events = [];
  for (let i = 0; i < 40; i++) { const e = q.fill(new Float32Array(BLOCK)); if (e) events.push(e); if (e === 'drained') break; }
  assert.deepEqual(events, ['drained'], 'her silence was taken for her voice');
});

/* Every half of every question, read by Gladys's own boundary: the column the
   question names, the left half the first setup or a no, the right the
   second or a yes. */
test('every half of every journal question is the answer Gladys writes for it', () => {
  for (const [q, [, column]] of ANSWERS.entries()) {
    for (const half of [0, 1]) {
      const data = tap('PID562780708', q, half);
      assert.deepEqual(parseCallback(data),
        { id: 'PID562780708', column, value: q === 0 ? SETUPS[half] : half === 1, action: 'answer' }, data);
    }
  }
});

/* Asked first what it lacks of the setup, rules and stop loss, else the take
   profit — over every way a trade can lack them; and a no is an answer, so
   it is never asked again. */
test('a trade is asked first the first of its questions it lacks', () => {
  for (let lacks = 1; lacks < 16; lacks++) {
    const trade = Object.fromEntries(ANSWERS.map(([, column], i) => [column, lacks & 1 << i ? null : i ? false : SETUPS[1]]));
    const { q, missing } = asked(trade);
    assert.deepEqual(missing, ANSWERS.map((_, i) => Boolean(lacks & 1 << i)), `lacking ${lacks.toString(2)}`);
    assert.equal(q, [0, 1, 2].find(i => missing[i]) ?? 3, `lacking ${lacks.toString(2)}, the trade is asked ${ANSWERS[q]?.[0]}`);
  }
});
