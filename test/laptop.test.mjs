/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the laptop, as far as anything here can drive it
   ───────────────────────────────────────────────────────────────────────────
   The app in laptop/ is Electron: a window, a microphone, a speaker and a
   screen capture, none of which a suite can open. What it can drive is the
   pure half — her frames read off the wire, and her voice read out of them,
   fed the door's own bytes, from `laptopFrame`, cut at every place a network
   read can cut them; her voice played from its queue while it arrives late
   and unevenly, as a real stream does; where her window goes when a screen
   is gone, which side of her the card stands on and where the line does,
   and the edge she tucks behind; what her body decides — the
   spring, a throw, the market's hours, when she sleeps; the journal's
   answers, read by Gladys's own boundary, the question a trade is asked
   first, and when the card turns to another; and the swap an update leaves behind,
   run in a scratch folder with macOS's `ditto`, `open` and `codesign` stood
   in for, in every way it can fail.
   The copies the app holds of the doors are agree.test.mjs's; whether she
   looks, sounds and floats as she should is his to see on the Mac (README,
   The laptop).
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laptopFrame } from '../supabase/functions/doji-eugenia/index.ts';
import { parseCallback } from '../supabase/functions/doji-gladys/index.ts';
import { FRAME, LEAD, PCM_RATE, Queue, framer, sampler } from '../laptop/frames.mjs';
import { marketOpen as pollerOpen } from '../supabase/functions/_shared/edge.ts';
import { AWAY_MS, DOZE_MS, FLING, marketOpen, settle, sleeps, slide } from '../laptop/body.mjs';
import { ANSWERS, SETUPS, asked, given, tap, turned } from '../laptop/journal.mjs';
import { fitsRight, lineAt, placed, room, tucked, within, CARD, ROOM } from '../laptop/place.mjs';
import { BUNDLE, swapScript } from '../laptop/update.mjs';

const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

/* A stream as the door sends one: silence first, a frame of a kind the
   laptop does not know, then her voice in parts of every awkward length —
   empty, one byte, odd, and one past 65,535, which needs the length's third
   byte. */
const SENT = [
  [FRAME.voice, new Uint8Array(4800)],
  [FRAME.voice + 1, Uint8Array.of(80)],
  [FRAME.voice, bytes(0, 1)],
  [FRAME.voice, bytes(1, 2)],
  [FRAME.voice, bytes(4801, 3)],
  [FRAME.voice, bytes(70_001, 4)],
];
const WIRE = Uint8Array.from(SENT.flatMap(([kind, b]) => [...laptopFrame(kind, b)]));

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
  const side = 200, corner = { x: 1512 - side - 24, y: 25 + 920 - side - 24, side };
  assert.deepEqual(placed({ x: 300, y: 400, side }, [main], main), { x: 300, y: 400, side },
    'a place on the main screen was not kept');
  assert.deepEqual(placed({ x: -900, y: 300, side }, [main, left], main), { x: -900, y: 300, side },
    'a place on a second screen, left of the main one, was not kept');
  assert.deepEqual(placed({ x: -900, y: 300, side }, [main], main), corner,
    'a place on a screen since unplugged left her where nothing shows her');
  assert.deepEqual(placed({ x: undefined, y: undefined, side }, [main], main), corner,
    'her first launch did not put her in the corner');
  // Half off an edge is still on the screen her middle is on.
  assert.deepEqual(placed({ x: 1512 - side / 2 + 10, y: 400, side }, [main], main).x, corner.x,
    'a place with her middle off every screen was kept');
  assert.equal(placed({ x: 1512 - side / 2 - 10, y: 400, side }, [main], main).x, 1512 - side / 2 - 10,
    'a place with her middle on the screen was moved');
});

/* The window is the room around her square, she its bottom middle; and her
   square is read back out of the window exactly, at every size she comes in,
   or each drop would walk her a pixel. */
test('her window is built around her square, and her square read back out of it', () => {
  for (const side of [140, 200, 280, 201]) {
    const her = { x: 613, y: -40, side }, win = room(her);
    assert.deepEqual([win.width, win.height], [Math.round(side * ROOM.width), Math.round(side * ROOM.height)]);
    assert.equal(win.y + win.height, her.y + side, 'she is not at the bottom of her window');
    assert.ok(Math.abs(win.x + win.width / 2 - (her.x + side / 2)) <= 0.5, 'she is not in the middle of her window');
    assert.deepEqual(within(win, side), her, `a ${side}-point square does not come back out of its window`);
  }
});

/* The card stands on his right of her unless the screen ends before it
   would: in the corner he keeps her in it is on the right, whole, and in the
   corner she is first put in — where the right would crop it — on the left. */
test('the card stands on his right of her, and on his left where the screen ends first', () => {
  const main = { x: 0, y: 25, width: 1512, height: 920 };
  for (const side of [140, 200, 280]) {
    const span = (her) => { const win = room(her); return { win, card: fitsRight(win, main) ? [her.x + side, her.x + side + side * CARD] : [her.x - side * CARD, her.x] }; };
    const shown = ({ card: [from, to] }) => from >= main.x && to <= main.x + main.width;
    const left = span({ x: 0, y: 945 - side, side }), first = span(placed({ side }, [main], main));
    assert.equal(fitsRight(left.win, main), true, 'in the bottom-left corner the card is not on his right');
    assert.equal(fitsRight(first.win, main), false, 'in the bottom-right corner the card is still on his right');
    assert.ok(shown(left) && shown(first), `a ${side}-point card is cropped in a corner`);
    // The last place the right still holds it, and the first it does not.
    const edge = main.width - Math.round(side * ROOM.width) + Math.round((Math.round(side * ROOM.width) - side) / 2);
    assert.equal(fitsRight(room({ x: edge, y: 400, side }), main), true, 'the card left his right while the screen still held it there');
    assert.equal(fitsRight(room({ x: edge + 1, y: 400, side }), main), false, 'the card stayed on his right a point past where the screen holds it');
    assert.ok(shown(span({ x: edge, y: 400, side })) && shown(span({ x: edge + 1, y: 400, side })), 'the card is cropped where it changes sides');
  }
});

/* The line is over her head wherever that leaves it whole, and otherwise as
   near to there as the screen allows — and always inside her window, which
   is all of her that can draw it. */
test('the line stays over her head, and whole where the screen ends', () => {
  const main = { x: 0, y: 25, width: 1512, height: 920 };
  for (const side of [140, 200, 280]) {
    const most = side * CARD;
    for (const wide of [80, most]) {
      for (const x of [-side / 2 + 1, 0, 656, 1512 - side, 1512 - side / 2 - 1]) {
        const win = room({ x, y: 945 - side, side }), mid = x + side / 2, at = lineAt(mid, wide, main);
        assert.ok(at - wide / 2 >= main.x && at + wide / 2 <= main.x + main.width, `a ${wide}-point line is cut by the screen with her at ${x}`);
        assert.ok(at - wide / 2 >= win.x && at + wide / 2 <= win.x + win.width, `a ${wide}-point line leaves her window with her at ${x}`);
        if (mid - wide / 2 >= main.x && mid + wide / 2 <= main.x + main.width) assert.equal(at, mid, 'a line with room over her head was moved');
      }
    }
    assert.equal(lineAt(side / 2, most, main), most / 2, 'in the left corner the line is not against the edge');
    assert.equal(lineAt(1512 - side / 2, most, main), 1512 - most / 2, 'in the right corner the line is not against the edge');
  }
});

/* Tucked away she peeks over the nearest edge that can hide her: one where
   the screen ends, with no Dock or menu bar on it and no display past it. */
test('she tucks behind the nearest edge of her screen that hides her, or nowhere', () => {
  const bounds = { x: 0, y: 0, width: 1512, height: 982 }, side = 200;
  const bare = { bounds, workArea: { x: 0, y: 25, width: 1512, height: 957 } };
  const docked = { bounds, workArea: { x: 0, y: 25, width: 1512, height: 887 } };
  const right = tucked({ x: 1200, y: 300, side }, bare, []);
  assert.equal(right.edge, 'right', 'near the right edge, she did not tuck behind it');
  assert.ok(right.x < 1512 && right.x + side > 1512 && right.y === 300, 'tucked right, she is not half past that edge where she was');
  assert.equal(tucked({ x: 100, y: 300, side }, bare, []).edge, 'left');
  const down = tucked({ x: 700, y: 700, side }, bare, []);
  assert.equal(down.edge, 'bottom');
  assert.ok(down.y < 982 && down.y + side > 982 && down.x === 700, 'tucked down, she is not half below the screen where she was');
  assert.notEqual(tucked({ x: 700, y: 700, side }, docked, []).edge, 'bottom', 'she tucked behind the Dock, which is drawn over her');
  const beside = { x: 1512, y: 0, width: 1920, height: 1080 }, below = { x: 0, y: 982, width: 1512, height: 982 };
  assert.equal(tucked({ x: 1200, y: 300, side }, bare, [beside]).edge, 'bottom', 'she tucked into the display beside hers, which shows the rest of her');
  assert.equal(tucked({ x: 1200, y: 300, side }, bare, [beside, below]).edge, 'left');
  const leftOf = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.equal(tucked({ x: 700, y: 400, side }, docked, [beside, leftOf]), null, 'with no edge to hide behind, she tucked all the same');
  // Half off the screen already, she tucks from inside it.
  assert.equal(tucked({ x: 1450, y: 900, side }, bare, []).y, 982 - side);
});

/* ─── Her body ──────────────────────────────────────────────────────────── */

test('what she gives on rings down and stops exactly, at any frame rate she is drawn at', () => {
  for (const dt of [0.016, 0.033, 0.05]) {
    const s = { x: 0, v: 400 };
    let most = 0, steps = 0;
    while ((s.x || s.v) && steps < 5000) { settle(s, 130, 9, dt); most = Math.max(most, Math.abs(s.x)); steps++; }
    assert.ok(steps < 5000 / (dt / 0.016), `at ${dt}s a frame the spring never came to rest`);
    assert.ok(most > 10 && most < 60, `at ${dt}s a frame a kick of 400 carried it ${most}`);
    assert.deepEqual(s, { x: 0, v: 0 });
  }
});

test('thrown, she slides on, comes back off the edge of the screen, and stops', () => {
  const area = { x: 0, y: 25, width: 1512, height: 920 };
  let box = { x: 1300, y: 500, width: 160, height: 140, vx: 2400, vy: -300 }, hits = 0, steps = 0, furthest = 0;
  while (!box.done && steps++ < 2000) {
    box = slide(box, area, 0.033);
    hits += box.hit;
    furthest = Math.max(furthest, box.x + box.width - 1512);
  }
  assert.ok(box.done && steps < 400, 'a throw never came to rest');
  assert.equal(hits, 1, `a throw at the right edge turned back ${hits} times`);
  assert.ok(furthest < 2400 * 0.033, `she went ${furthest} pixels past the edge before turning`);
  assert.ok(box.x + box.width <= 1512 && box.x > 600, `she came to rest at ${box.x}, not back inside near the edge`);
  // Let go half off the screen and moving in, she is not turned out again.
  const back = slide({ x: -80, y: 500, width: 160, height: 140, vx: 1200, vy: 0 }, area, 0.033);
  assert.ok(!back.hit && back.vx > 0, 'an edge turned her back while she was coming in through it');
  assert.ok(FLING > 300, 'an ordinary carry is a throw');
});

/* Gold's week on the laptop is a copy of the poller's: both run over every
   hour of four weeks, across the autumn change of the clocks. */
test('she keeps the market\'s hours as the poller does', () => {
  let shut = 0;
  for (let h = 0; h < 24 * 28; h++) {
    const at = new Date(Date.UTC(2026, 9, 18, 0, 30) + h * 3_600_000);
    assert.equal(marketOpen(at), pollerOpen(at), `${at.toISOString()}: the laptop and the poller disagree on whether gold trades`);
    shut += !marketOpen(at);
  }
  assert.equal(shut, 4 * 48, 'four weekends are not four closes of forty-eight hours');
});

test('she sleeps when the market is shut and he is not by her, or when he is away', () => {
  assert.equal(sleeps(false, DOZE_MS, 0), true);
  assert.equal(sleeps(false, DOZE_MS - 1, 10 * AWAY_MS), false, 'she slept with the cursor only just gone from her');
  assert.equal(sleeps(true, 10 * AWAY_MS, AWAY_MS - 1), false, 'she slept through his working day, the cursor moving far from her');
  assert.equal(sleeps(true, 0, AWAY_MS), true);
});

/* ─── The swap an update leaves behind ──────────────────────────────────── */

function swapping({ unpack = 'whole', mvFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doji-swap-'));
  const apps = join(root, "Apps it's here"), bundle = join(apps, BUNDLE), stubs = join(root, 'bin');
  const unpacked = join(root, 'eugenia-update'), zip = join(root, 'Eugenia.zip'), opened = join(root, 'opened');
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, 'version'), 'old');
  writeFileSync(join(bundle, 'signer'), 'certificate leaf = H"kept"');
  writeFileSync(zip, 'zip');
  mkdirSync(stubs);
  const stub = (name, body) => { writeFileSync(join(stubs, name), `#!/bin/sh\n${body}\n`); chmodSync(join(stubs, name), 0o755); };
  // ditto -x -k <zip> <dest>: the new app unpacked, signed by her kept certificate or a stranger's, or not.
  const signed = (by) => `mkdir -p "$4/${BUNDLE}" && echo new > "$4/${BUNDLE}/version" && echo '${by}' > "$4/${BUNDLE}/signer"`;
  stub('ditto', {
    whole: signed('certificate leaf = H"kept"'),
    stranger: signed('certificate leaf = H"other"'),
    broken: 'exit 1',
    empty: 'mkdir -p "$4"',
  }[unpack]);
  // codesign -d -r- <app> names its signer as macOS does; --verify -R=<signer> <app> holds an app to it.
  stub('codesign', [
    'case "$1" in',
    '  -d) echo "Executable=$3" >&2; echo "designated => $(cat "$3/signer")";;',
    '  --verify) [ -f "$5/signer" ] && [ "${4#-R=}" = "$(cat "$5/signer")" ];;',
    'esac',
  ].join('\n'));
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
                            ['a new app signed by a stranger', { unpack: 'stranger' }],
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

/* The chips say what a trade already holds, each as the half that gave it:
   every half's answer, as Gladys's boundary writes it, reads back as that
   half. */
test('an answer a trade holds reads back as the half that gave it', () => {
  assert.deepEqual(given(Object.fromEntries(ANSWERS.map(([, column]) => [column, null]))), [null, null, null, null]);
  for (const [q, [, column]] of ANSWERS.entries()) {
    for (const half of [0, 1]) {
      const { value } = parseCallback(tap('PID562780708', q, half));
      assert.equal(given({ [column]: value })[q], half, `${column} = ${value}`);
    }
  }
});

/* The laptop looks every minute at what waits, and the card gives way after a
   minute unclicked: a look that finds the same question must leave the card's
   minute running, or it never ends. It turns for another trade, and for this
   one's question answered elsewhere — not for an answer to a question it is
   not asking. */
test('the card turns for another question, and not for a look that finds the same one', () => {
  const blank = Object.fromEntries(ANSWERS.map(([, column]) => [column, null]));
  const shown = { id: 'PID1', ...blank };
  assert.equal(turned(shown, 0, { ...shown }), false, 'the same trade at the same question restarted the card');
  assert.equal(turned(shown, 0, { ...shown, followed_tp: true }), false, 'an answer to a later question restarted the one being asked');
  assert.equal(turned(shown, 0, { ...shown, setup: SETUPS[0] }), true, 'its question answered elsewhere, the card kept asking it');
  assert.equal(turned(shown, 0, { ...shown, id: 'PID2' }), true, 'another trade waiting, the card kept the first');
});
