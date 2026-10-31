/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the laptop, as far as anything here can drive it
   ───────────────────────────────────────────────────────────────────────────
   The app in laptop/ is Electron: a window, a microphone, a speaker and a
   screen capture, none of which a suite can open. What it can drive is the
   pure half both processes share — her frames read off the wire, and her
   voice read out of them — fed the door's own bytes, from `charmFrame`, cut
   at every place a network read can cut them. The copies the app holds of the
   door and of the charm are agree.test.mjs's; whether she looks, sounds and
   floats as she should is his to see on the Mac (README, The laptop).
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charmFrame } from '../supabase/functions/doji-eugenia/index.ts';
import { FRAME, framer, sampler } from '../laptop/frames.mjs';

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
