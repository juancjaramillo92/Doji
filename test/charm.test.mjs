/* The charm's pure C, compiled on this machine and driven from here, in the
   time zone the charm itself reads its clock in: the briefing watch held
   against the server's own hours every five minutes of both weeks the clocks
   change in, how long she sleeps between errands, a lift judged on
   readings, the setup's answer to a phone's every name, the Ogg file a recording travels in, her answer read out of
   the server's own frames, and her glass — its bubbles, its breath and its
   wobble — against the outline and renders charm/tools/art.py made. Only
   what has no ESP-IDF in it is here; the rest is the board's to prove. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { briefDue, retryDue, charmFrame, FRAME } from '../supabase/functions/doji-eugenia/index.ts';
import { nyDate, marketOpen } from '../supabase/functions/_shared/edge.ts';

const MAIN = 'charm/main';

// Questions on stdin, one answer a line: `due <epoch>`, `announce <epoch>`,
// `lift <six readings in g>`, `hold <six readings in g>`, `dns <a message in
// hex>` (- for no answer), `ogg <room> <packet sizes…> 0` (the file in hex, or
// - when a packet did not fit), `frames <read size> <a stream in hex>` (the
// volume, -1 for none, then each sample), `wait <epoch> <charging> <trade>
// <away>` (seconds), `up <a reading in g>` and `jolt <six readings in g>`,
// `glass <seed> <steps> <up x y> <rise> <every> <most> <stir> <depth>
// <period> <at step> <poke> <depth after>` (a line a step at 30 a second: the
// render, then `x y radius shown` for each bubble), `place <render> <x> <y>`
// and `chord <x> <y> <dx> <dy> <margin>` (its ends, or -).
const DRIVER = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "briefing.h"
#include "dns.h"
#include "errand.h"
#include "frames.h"
#include "glass.h"
#include "lift.h"
#include "ogg.h"
int main(int argc, char **argv) {
    (void)argc;
    setenv("TZ", argv[1], 1);
    tzset();
    char op[16], hex[1025];
    long long t;
    float a[3], b[3];
    unsigned char msg[512];
    static unsigned char file[8192], packet[1024], stream[512];
    static int16_t voice[512];
    while (scanf("%15s", op) == 1) {
        if (!strcmp(op, "due") && scanf("%lld", &t) == 1) printf("%d\\n", briefing_due((time_t)t));
        int charging, trade, away;
        if (!strcmp(op, "wait") && scanf("%lld %d %d %d", &t, &charging, &trade, &away) == 4)
            printf("%d\\n", errand_wait((time_t)t, charging, trade, away));
        if (!strcmp(op, "announce") && scanf("%lld", &t) == 1) { briefing_announced((time_t)t); printf("ok\\n"); }
        if (!strcmp(op, "today") && scanf("%lld", &t) == 1) printf("%d\\n", briefing_today((time_t)t));
        if (!strcmp(op, "lift") && scanf("%f %f %f %f %f %f", a, a + 1, a + 2, b, b + 1, b + 2) == 6)
            printf("%d\\n", lift_seen(a, b));
        if (!strcmp(op, "hold") && scanf("%f %f %f %f %f %f", a, a + 1, a + 2, b, b + 1, b + 2) == 6)
            printf("%d\\n", lift_hold(a, b));
        if (!strcmp(op, "up") && scanf("%f %f %f", a, a + 1, a + 2) == 3) {
            float up[2];
            lift_up(a, up);
            printf("%.4f %.4f\\n", up[0], up[1]);
        }
        if (!strcmp(op, "jolt") && scanf("%f %f %f %f %f %f", a, a + 1, a + 2, b, b + 1, b + 2) == 6)
            printf("%.4f\\n", lift_jolt(a, b));
        glass_mood_t m;
        int seed, steps, at;
        float poke, after;
        if (!strcmp(op, "glass") && scanf("%d %d %f %f %f %f %d %f %f %f %d %f %f", &seed, &steps, &m.up[0], &m.up[1],
                                          &m.rise, &m.every, &m.most, &m.stir, &m.depth, &m.period, &at, &poke, &after) == 13) {
            static glass_t g;
            glass_start(&g, (uint32_t)seed);
            for (int s = 0; s < steps; s++) {
                if (s == at) { glass_poke(&g, poke); m.depth = after; }
                glass_step(&g, &m, 1.0f / 30);
                printf("%d", glass_frame(&g));
                for (int i = 0; i < GLASS_BUBBLES; i++) {
                    const glass_bubble_t *bb = &g.bubbles[i];
                    if (bb->state != GLASS_NONE) printf(" %.3f %.3f %.2f %.3f", bb->x, bb->y, GLASS_RADIUS[bb->size], bb->shown);
                }
                printf("\\n");
            }
        }
        int f;
        if (!strcmp(op, "place") && scanf("%d %f %f", &f, a, a + 1) == 3) {
            glass_place(f, a[0], a[1], b);
            printf("%.4f %.4f\\n", b[0], b[1]);
        }
        float ends[4];
        if (!strcmp(op, "chord") && scanf("%f %f %f %f %f", a, a + 1, b, b + 1, b + 2) == 5) {
            if (glass_chord(a[0], a[1], b[0], b[1], b[2], ends)) printf("%.3f %.3f %.3f %.3f\\n", ends[0], ends[1], ends[2], ends[3]);
            else printf("-\\n");
        }
        if (!strcmp(op, "dns") && scanf("%1024s", hex) == 1) {
            size_t n = 0;
            for (; hex[2 * n] && n < sizeof msg; n++) sscanf(hex + 2 * n, "%2hhx", &msg[n]);
            size_t len = dns_answer(msg, n, sizeof msg);
            for (size_t i = 0; i < len; i++) printf("%02x", msg[i]);
            printf(len ? "\\n" : "-\\n");
        }
        if (!strcmp(op, "ogg") && scanf("%lld", &t) == 1) {
            ogg_t o;
            ogg_start(&o, file, (size_t)t, 0x2a, 16000);
            int size, fits = 1;
            while (scanf("%d", &size) == 1 && size > 0) {
                for (int i = 0; i < size; i++) packet[i] = (unsigned char)(i * 7 + size);
                fits &= ogg_packet(&o, packet, (size_t)size, 20);
            }
            size_t len = ogg_end(&o);
            if (!fits) printf("-\\n");
            else { for (size_t i = 0; i < len; i++) printf("%02x", file[i]); printf("\\n"); }
        }
        if (!strcmp(op, "frames") && scanf("%lld %1024s", &t, hex) == 2) {
            size_t len = strlen(hex) / 2, got = 0;
            for (size_t i = 0; i < len; i++) sscanf(hex + 2 * i, "%2hhx", &stream[i]);
            frames_t f = { 0 };
            int volume = -1;
            for (size_t at = 0; at < len; at += (size_t)t) {
                size_t k = len - at < (size_t)t ? len - at : (size_t)t;
                got += frames_read(&f, stream + at, k, voice + got, &volume);
            }
            printf("%d", volume);
            for (size_t i = 0; i < got; i++) printf(" %d", voice[i]);
            printf("\\n");
        }
    }
    return 0;
}`;

// The zone is the charm's own, read out of net.c rather than restated.
const zone = readFileSync(`${MAIN}/net.c`, 'utf8').match(/#define NEW_YORK "([^"]+)"/);

function charm(questions) {
  const dir = mkdtempSync(join(tmpdir(), 'charm-'));
  try {
    // RTC_DATA_ATTR places a variable in the memory deep sleep keeps; on a
    // computer it is an ordinary one.
    writeFileSync(join(dir, 'esp_attr.h'), '#define RTC_DATA_ATTR\n');
    writeFileSync(join(dir, 'drive.c'), DRIVER);
    execFileSync('cc', ['-std=c11', '-D_DEFAULT_SOURCE', '-Wall', '-Werror', '-I', dir, '-I', MAIN,
      join(dir, 'drive.c'), `${MAIN}/briefing.c`, `${MAIN}/errand.c`, `${MAIN}/lift.c`, `${MAIN}/dns.c`, `${MAIN}/ogg.c`, `${MAIN}/frames.c`,
      `${MAIN}/glass.c`, `${MAIN}/art.c`, '-lm', '-o', join(dir, 'drive')]);
    return execFileSync(join(dir, 'drive'), [zone[1]], { input: questions.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 28 })
      .trim().split('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const epoch = (date) => Math.floor(date.getTime() / 1000);

test('the charm reads its clock in a zone net.c names', () => {
  assert.ok(zone, 'net.c no longer defines NEW_YORK as this suite reads it');
});

test('the charm asks for the briefing in exactly the minutes the server writes it', () => {
  // The weeks around both changes of the clocks, every five minutes. The server
  // writes in whole hours; the charm starts five minutes in, when writing has.
  const moments = [];
  for (const start of [Date.UTC(2026, 2, 6), Date.UTC(2026, 9, 30)]) {
    for (let t = start; t < start + 9 * 86_400_000; t += 300_000) moments.push(new Date(t));
  }
  const answers = charm(moments.map(m => `due ${epoch(m)}`));
  assert.equal(answers.length, moments.length, 'the charm did not answer every moment');
  const wrong = moments.filter((m, i) => {
    const written = Boolean(briefDue(m) || retryDue(m)) && !(briefDue(m) && m.getUTCMinutes() < 5);
    return (answers[i] === '1') !== written;
  });
  assert.deepEqual(wrong.slice(0, 5).map(m => m.toISOString()), [],
    `${wrong.length} moments where the charm and the server disagree`);
});

test('once she has announced the briefing she asks no more that day, and asks again the next', () => {
  const wednesday = (h, m) => epoch(new Date(Date.UTC(2026, 7, 19, h + 4, m)));  // New York on daylight time
  const thursday = epoch(new Date(Date.UTC(2026, 7, 20, 12, 5)));
  assert.deepEqual(charm([`due ${wednesday(9, 0)}`, `announce ${wednesday(8, 15)}`, `due ${wednesday(9, 0)}`, `due ${thursday}`]),
    ['1', 'ok', '0', '1']);
});

/* Her door serves today's briefing alone, so the dot that says one waits is
   today's too: at midnight in New York it goes, as the server's day does. */
test('the briefing she announced waits until midnight in New York, and no longer', () => {
  // Announced at noon before each change of the clocks, then asked every half
  // hour for two days, against the server's own day.
  for (const noon of [Date.UTC(2026, 2, 7, 17), Date.UTC(2026, 9, 31, 16)]) {
    const moments = Array.from({ length: 96 }, (_, i) => new Date(noon + i * 1_800_000));
    const answers = charm([`announce ${epoch(new Date(noon))}`, ...moments.map(m => `today ${epoch(m)}`)]);
    const wrong = moments.filter((m, i) => (answers[i + 1] === '1') !== (nyDate(m) === nyDate(new Date(noon))));
    assert.deepEqual(wrong.map(m => m.toISOString()), [],
      'the charm keeps a briefing waiting on a day her door no longer serves it, or drops it on its own day');
  }
  assert.deepEqual(charm([`today ${epoch(new Date(Date.UTC(2026, 9, 16, 16)))}`]), ['0'],
    'a briefing waits that was never announced');
});

test('she never asks before the internet has set her clock', () => {
  // 08:30 on Friday 2 January 1970 in New York: a briefing's hour, on a clock never set.
  assert.deepEqual(charm([`due ${epoch(new Date(Date.UTC(1970, 0, 2, 13, 30)))}`]), ['0']);
});

/* Every errand that finds no network makes the next one later, since until
   one answers there is nothing to ask, and none is ever an hour away, so the
   night's look for an update always has one. On the cable, often. */
test('she sleeps longer between errands that find no network, never an hour', () => {
  const tuesday = epoch(new Date(Date.UTC(2026, 7, 18, 14)));
  const waits = charm([0, 1, 2, 3, 4, 50].map(away => `wait ${tuesday} 0 0 ${away}`)).map(Number);
  assert.deepEqual(waits, [300, 600, 1200, 1800, 1800, 1800]);
  assert.deepEqual(charm([`wait ${tuesday} 1 0 0`, `wait ${tuesday} 1 0 9`]), ['120', '120'],
    'on the cable she waits other than two minutes');
});

/* Nothing new can come in for Gladys while the market is shut, so from an
   hour after the Friday close — a trade's row can trail it — to the Sunday
   open she asks every half hour, waking at the open itself; unless a trade
   already waits, whose ring Telegram may clear. Walked every five minutes of
   both weeks the clocks change in, against the server's own marketOpen. */
test('over the weekend she asks seldom, and wakes for the open', () => {
  const moments = [];
  for (const start of [Date.UTC(2026, 2, 4), Date.UTC(2026, 9, 28)]) {
    for (let t = start; t < start + 7 * 86_400_000; t += 300_000) moments.push(new Date(t));
  }
  const quiet = charm(moments.map(m => `wait ${epoch(m)} 0 0 0`)).map(Number);
  const busy = charm(moments.map(m => `wait ${epoch(m)} 0 1 0`)).map(Number);
  const wrong = moments.filter((m, i) => {
    const w = quiet[i], shut = !marketOpen(m) && !marketOpen(new Date(m.getTime() - 3_600_000));
    if (busy[i] !== 300) return true;
    if (!shut) return w !== 300;
    const woken = new Date(m.getTime() + w * 1000);
    return !(w > 0 && w <= 1800) || marketOpen(new Date(woken.getTime() - 1000)) ||
      (w < 1800 && !marketOpen(woken));
  });
  assert.deepEqual(wrong.slice(0, 5).map(m => m.toISOString()), [],
    `${wrong.length} moments where her errands and the market's week disagree`);
  assert.ok(quiet.filter(w => w === 1800).length > 400, 'the weekend never came — the walk has gone blind');
  // A clock the internet has not set reads 1970: a Saturday there decides nothing.
  assert.deepEqual(charm([`wait ${epoch(new Date(Date.UTC(1970, 0, 3, 12)))} 0 0 0`]), ['300']);
});

test('a lift is him looking only when the screen faces up and is held still', () => {
  const lift = (a, b) => `lift ${[...a, ...b].join(' ')}`;
  assert.deepEqual(charm([
    lift([0, 0.3, 0.9], [0.02, 0.31, 0.88]),   // tilted up toward him, still
    lift([0, 0.95, 0.1], [0, 0.95, 0.1]),      // upright in a pocket
    lift([0, 0.3, 0.9], [0.3, 0.1, 0.7]),      // facing up but swinging
    lift([0, 0.1, -0.95], [0, 0.1, -0.95]),    // face down
  ]), ['1', '0', '0', '0']);
});

test('awake, held up she stays, put down she sleeps, and anything else is left to the quiet spell', () => {
  const hold = (a, b) => `hold ${[...a, ...b].join(' ')}`;
  const [ELSE, HELD, DOWN] = ['0', '1', '2'];
  assert.deepEqual(charm([
    hold([0, 0.5, 0.85], [0.03, 0.52, 0.84]),    // tilted toward him in a hand, a little tremor
    hold([0, 0.05, 0.99], [0.02, 0.06, 0.99]),   // flat in his palm, still a hand's tremor
    hold([0, 0.01, 1.0], [0, 0.01, 1.0]),        // lying face up on a table
    hold([0, 0.01, -1.0], [0, 0.01, -1.0]),      // lying face down
    hold([0.1, 0.2, -0.6], [0.3, 0.1, -0.7]),    // face down in a moving hand
    hold([0.1, 0.95, 0.1], [0.3, 0.9, 0.2]),     // upright in a pocket, walking
  ]), [HELD, HELD, DOWN, DOWN, DOWN, ELSE]);
});

/* Awake, her face is told which way is up and of any jolt. The sensor reads
   the push that holds her up, so held upright, its top up, the bubbles rise
   up the screen; lying flat there is no up across it; and a hand's tremor is
   no jolt where a knock is a full one. */
test('held up, her bubbles know which way is up, and a knock is a jolt where a hand is not', () => {
  const [upright, flat, sideways, hard] = charm(['up 0 0.9 0.4', 'up 0 0 1', 'up 0.9 0.1 0.4', 'up 0.9 0.9 0'])
    .map(line => line.split(' ').map(Number));
  assert.ok(upright[1] < -0.85 && Math.abs(upright[0]) < 0.01, `held upright, up across the screen is ${upright}`);
  assert.ok(Math.hypot(...flat) < 0.01, `lying flat, up across the screen is ${flat}, not nothing`);
  assert.ok(sideways[0] > 0.85, `turned onto her side, up across the screen is ${sideways}`);
  assert.ok(Math.abs(Math.hypot(...hard) - 1) < 1e-3, 'up is longer than upright');
  const jolt = (a, b) => `jolt ${[...a, ...b].join(' ')}`;
  const [still, tremor, knock, middling] = charm([
    jolt([0, 0.9, 0.4], [0, 0.9, 0.4]),
    jolt([0, 0.9, 0.4], [0.05, 0.86, 0.43]),
    jolt([0, 0.9, 0.4], [1.2, -0.6, 1.4]),
    jolt([0, 0.9, 0.4], [0.3, 0.5, 0.6]),
  ]).map(Number);
  assert.deepEqual([still, tremor, knock], [0, 0, 1]);
  assert.ok(middling > 0 && middling < 1, `a middling jolt is ${middling}, not part of a full one`);
});

/* Her glass, from what art.py wrote: the outline row by row, the patch every
   render is cut to, the point she squashes about and each render's squash. */
const ART_C = readFileSync(`${MAIN}/art.c`, 'utf8');
const GLASS_H = readFileSync(`${MAIN}/glass.h`, 'utf8');
const glassDefine = (name) => Number(GLASS_H.match(new RegExp(`^#define GLASS_${name}\\s+(\\d+)`, 'm'))?.[1]);
const artList = (name) => ART_C.match(new RegExp(`${name}\\[[^\\]]*\\](?:\\[2\\])? = \\{([^;]+)\\};`))?.[1]
  .match(/-?\d+(?:\.\d+)?/g).map(Number);
const OUTLINE = (() => {
  const n = artList('GLASS_OUTLINE');
  return Array.from({ length: n.length / 2 }, (_, y) => [n[2 * y], n[2 * y + 1]]);
})();
const [CROP_X, CROP_Y, CROP_W, CROP_H] = artList('GLASS_CROP');
const SQUASH = artList('GLASS_SQUASH'), [ANCHOR_X, ANCHOR_Y] = artList('GLASS_ANCHOR');
const REST = SQUASH.indexOf(0);
const TOP = OUTLINE.findIndex(([l, r]) => r >= l);

// Whether a disc lies inside her outline, row by row: the test's own reading.
const insideHer = (x, y, r) => {
  for (let row = Math.floor(y - r); row <= Math.ceil(y + r); row++) {
    const dy = row - y, w = dy * dy < r * r ? Math.sqrt(r * r - dy * dy) : 0;
    const [l, rr] = OUTLINE[row] ?? [0, -1];
    if (x - w < l || x + w > rr) return false;
  }
  return true;
};

/* A run of her glass, a step a line: the render showing, and each bubble. */
function glass({ seed = 7, steps = 900, up = [0, -0.9], rise = 26, every = 1.6, most = 6, stir = 0, depth = 0,
                 period = 4.2, at = -1, poke = 0, after = depth } = {}) {
  return charm([`glass ${seed} ${steps} ${up.join(' ')} ${rise} ${every} ${most} ${stir} ${depth} ${period} ${at} ${poke} ${after}`])
    .map(line => {
      const n = line.split(' ').map(Number);
      const bubbles = [];
      for (let i = 1; i < n.length; i += 4) bubbles.push({ x: n[i], y: n[i + 1], r: n[i + 2], shown: n[i + 3] });
      return { frame: n[0], bubbles };
    });
}

/* art.py makes the renders and the tables that describe them in one run;
   each is held here to the other, and to glass.h's counts, so a render made
   again without its tables, or a count changed without the renders, is
   caught before a board draws past the end of one. */
test('her renders are the ones art.c describes, and her outline is the one they draw', () => {
  const frames = glassDefine('FRAMES'), sizes = glassDefine('SIZES'), phases = glassDefine('PHASES');
  assert.equal(SQUASH.length, frames, 'art.c has a squash for other than every render');
  assert.deepEqual(SQUASH, [...SQUASH].sort((a, b) => a - b), 'the renders are not in order of their squash');
  assert.ok(REST >= 0, 'no render is her at rest');
  assert.equal(OUTLINE.length, 466, 'the outline is not a row for every row of the screen');
  const body = readFileSync('charm/art/body.rgb565'), glow = readFileSync('charm/art/glow.a8');
  assert.equal(body.length, frames * CROP_W * CROP_H * 2, 'body.rgb565 is not every render, each the patch art.c gives');
  assert.equal(glow.length, CROP_W * CROP_H, 'glow.a8 is not the patch art.c gives');
  const sides = artList('GLASS_SIDE'), radii = artList('GLASS_RADIUS');
  assert.equal(sides.length, sizes);
  assert.equal(radii.length, sizes);
  assert.equal(readFileSync('charm/art/bubbles.argb8888').length, phases * phases * sides.reduce((n, s) => n + 4 * s * s, 0),
    'bubbles.argb8888 is not every size at every phase');
  sides.forEach((s, i) => assert.ok(s >= 2 * radii[i] + 2, `a bubble of radius ${radii[i]} does not fit its ${s}-pixel sprite`));

  // Her render at rest is her outline: lit inside it, black two pixels clear
  // of it every way, and her light is nowhere outside her.
  let lit = 0, dark = 0;
  for (let y = 0; y < CROP_H; y++) {
    const [l, r] = OUTLINE[CROP_Y + y];
    for (let x = 0; x < CROP_W; x++) {
      const sx = CROP_X + x, sy = CROP_Y + y, px = body.readUInt16LE(2 * ((REST * CROP_H + y) * CROP_W + x));
      const far = [-2, -1, 0, 1, 2].every(d => { const [ll, rr] = OUTLINE[sy + d] ?? [0, -1]; return sx < ll - 2 || sx > rr + 2; });
      if (sx >= l && sx <= r) { assert.ok(px, `(${sx}, ${sy}) is inside her outline and black`); lit++; }
      else if (far) {
        assert.equal(px, 0, `(${sx}, ${sy}) is outside her outline and lit`);
        assert.equal(glow[y * CROP_W + x], 0, `her light reaches (${sx}, ${sy}), outside her`);
        dark++;
      }
    }
  }
  assert.ok(lit > 80_000 && dark > 20_000, `${lit} pixels inside her and ${dark} outside — the reader has gone blind`);
  // Every render fits the patch: her top, bottom and sides at rest, squashed
  // and stretched as far as they go.
  const rows = OUTLINE.map(([l, r], y) => ({ l, r, y })).filter(({ l, r }) => r >= l);
  const left = rows.reduce((a, b) => b.l < a.l ? b : a), right = rows.reduce((a, b) => b.r > a.r ? b : a);
  const ends = [[rows[0].l, rows[0].y], [rows.at(-1).r, rows.at(-1).y], [left.l, left.y], [right.r, right.y]];
  const placed = charm([0, frames - 1].flatMap(f => ends.map(([x, y]) => `place ${f} ${x} ${y}`)))
    .map(line => line.split(' ').map(Number));
  for (const [x, y] of placed) {
    assert.ok(x >= CROP_X && x < CROP_X + CROP_W && y >= CROP_Y && y < CROP_Y + CROP_H, `(${x}, ${y}) falls outside the patch`);
  }
});

/* The bubbles are drawn inside her glass and nowhere else: every one shown,
   at every step, upright, on her side, upside down, stirred and thinking,
   against her outline as this test reads it. */
test('a bubble is only ever drawn inside her glass', () => {
  let seen = 0;
  for (const mood of [{}, { up: [0.85, 0] }, { up: [-0.7, 0.2] }, { up: [0, 0.9] }, { stir: 1, most: 8 },
                      { rise: 48, every: 0.35, most: 12 }, { up: [0, 0] }]) {
    for (const [step, { bubbles }] of glass({ ...mood, steps: 600 }).entries()) {
      for (const b of bubbles) {
        if (b.shown <= 0) continue;
        assert.ok(insideHer(b.x, b.y, b.r), `step ${step} of ${JSON.stringify(mood)}: a bubble at (${b.x}, ${b.y}) is outside her`);
        seen++;
      }
    }
  }
  assert.ok(seen > 10_000, `only ${seen} bubbles seen — the run has gone blind`);
});

test('her bubbles rise the way up is, come and go, and never more than her mood allows', () => {
  // How far each bubble moves along x and y in a step, from one line to the next.
  const drift = (run) => {
    const d = [0, 0];
    for (let s = 1; s < run.length; s++) {
      for (const b of run[s].bubbles) {
        const was = run[s - 1].bubbles.find(o => Math.hypot(o.x - b.x, o.y - b.y) < 3);
        if (was) { d[0] += b.x - was.x; d[1] += b.y - was.y; }
      }
    }
    return d;
  };
  const upright = glass(), right = glass({ up: [0.85, 0] }), down = glass({ up: [0, 0.9] });
  const [ux, uy] = drift(upright), [rx, ry] = drift(right), [, dy] = drift(down);
  assert.ok(uy < -5 * Math.abs(ux), `held upright they drift (${ux}, ${uy}), not up`);
  assert.ok(rx > 5 * Math.abs(ry), `on her side they drift (${rx}, ${ry}), not toward her new top`);
  assert.ok(dy > 0, 'upside down they still rise toward the screen\'s top');
  const most = Math.max(...upright.map(s => s.bubbles.length));
  assert.equal(most, 6, `at most ${most} bubbles at once, where her mood asks six`);
  // They pop as they reach her top, so new ones keep coming: over thirty
  // seconds, far more starts than there is room for at once.
  let starts = 0;
  for (let s = 1; s < upright.length; s++) {
    starts += upright[s].bubbles.filter(b => !upright[s - 1].bubbles.some(o => Math.hypot(o.x - b.x, o.y - b.y) < 3)).length;
  }
  assert.ok(starts > 12, `only ${starts} bubbles started in thirty seconds — they are stuck, not rising and popping`);
});

/* A tap or a jolt wobbles her: squashed and stretched both, then still, at
   rest, within two seconds. Untouched and not breathing, she never leaves
   rest. */
test('a poke wobbles her glass and she settles back to rest', () => {
  assert.ok(glass({ steps: 300 }).every(s => s.frame === REST), 'untouched and holding her breath, she moved');
  const run = glass({ steps: 300, at: 10, poke: 1 }).map(s => s.frame);
  assert.ok(run.some(f => f > REST) && run.some(f => f < REST), 'a poke did not both squash and stretch her');
  assert.ok(run.slice(10 + 60).every(f => f === REST), 'two seconds after a poke she is still wobbling');
  assert.ok(run.includes(0) || run.includes(SQUASH.length - 1), 'a full poke never reached the furthest render');
});

/* A breath is slow, so it must glide: it walks the renders one at a time,
   each step moving her top less than a pixel, and holding her breath — as
   listening does — eases out rather than jumping back to rest. */
test('a breath walks her renders one at a time, under a pixel a step, and is held without a jump', () => {
  const run = glass({ steps: 600, depth: 0.009, at: 300, after: 0 }).map(s => s.frame);
  const used = [...new Set(run)].sort((a, b) => a - b);
  assert.ok(used.length >= 4, `a breath used only ${used.length} renders`);
  assert.ok(used.every(f => f <= REST), 'a breath squashed her rather than drawing her up');
  for (let s = 1; s < run.length; s++) {
    assert.ok(Math.abs(run[s] - run[s - 1]) <= 1, `step ${s}: the breath skipped from render ${run[s - 1]} to ${run[s]}`);
  }
  const top = (f) => ANCHOR_Y - (ANCHOR_Y - TOP) / (1 + SQUASH[f]);
  for (let i = 1; i < used.length; i++) {
    const moved = Math.abs(top(used[i]) - top(used[i - 1]));
    assert.ok(moved < 1, `from render ${used[i - 1]} to ${used[i]} her top moves ${moved.toFixed(2)} pixels`);
  }
  assert.ok(run.slice(-60).every(f => f === REST), 'held, her breath never came to rest');
});

test('a render places her face on her glass where it draws it', () => {
  const [rest, anchor, squashed, stretched] = charm([`place ${REST} 188.8 162`, `place 0 ${ANCHOR_X} ${ANCHOR_Y}`,
    `place ${SQUASH.length - 1} 188.8 162`, `place 0 188.8 162`]).map(line => line.split(' ').map(Number));
  assert.deepEqual(rest, [188.8, 162], 'at rest her eye is not where it is drawn');
  assert.deepEqual(anchor, [ANCHOR_X, ANCHOR_Y], 'the point she squashes about moves');
  assert.ok(squashed[1] > 162 && squashed[0] < 188.8, 'squashed, her eye does not sink and spread with her');
  assert.ok(stretched[1] < 162 && stretched[0] > 188.8, 'stretched, her eye does not rise and draw in with her');
});

test('the glint\'s chord runs inside her edge, to it and no further', () => {
  const [through, outside] = charm(['chord 233 250 -0.6 0.8 18', 'chord 10 10 1 0 18']);
  assert.equal(outside, '-', 'a chord through a point outside her has ends');
  const [x1, y1, x2, y2] = through.split(' ').map(Number);
  assert.ok(Math.hypot(x2 - x1, y2 - y1) > 200, 'the chord through her middle is short');
  for (const [x, y, sign] of [[x1, y1, 1], [x2, y2, -1]]) {
    assert.ok(insideHer(x, y, 18), `the chord ends at (${x}, ${y}), less than its margin inside her`);
    assert.ok(!insideHer(x + sign * -0.6 * 3, y + sign * 0.8 * 3, 18), `the chord stops short of her edge at (${x}, ${y})`);
  }
});

test('the setup answers every name with the charm, whether or not the phone adds an EDNS record', () => {
  // captive.apple.com, type A, as a phone asks it; the second adds the OPT
  // record many resolvers send, which an answer appended after it would be
  // read through.
  const query = (edns) => Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, edns ? 1 : 0,
    ...'captive.apple.com'.split('.').flatMap(l => [l.length, ...Buffer.from(l)]), 0, 0, 1, 0, 1,
    ...(edns ? [0, 0, 41, 0x10, 0, 0, 0, 0, 0, 0, 0] : [])]);
  const [plain, edns, junk] = charm([`dns ${query(false).toString('hex')}`, `dns ${query(true).toString('hex')}`,
    'dns 0102030405']);
  const q = query(false), r = Buffer.from(plain, 'hex');
  assert.equal(r.length, q.length + 16, 'the answer is not the question and one A record');
  assert.equal(r.readUInt16BE(0), 0x1234, 'the answer does not carry the question\'s id');
  assert.deepEqual([r.readUInt16BE(4), r.readUInt16BE(6), r.readUInt16BE(8), r.readUInt16BE(10)], [1, 1, 0, 0],
    'one question, one answer and nothing else');
  assert.deepEqual(r.subarray(12, q.length), q.subarray(12), 'the question is not as asked');
  assert.deepEqual([...r.subarray(-4)], [192, 168, 4, 1], 'the name is not the charm');
  assert.equal(edns, plain, 'a phone\'s EDNS record changed the answer');
  assert.equal(junk, '-', 'five bytes that are no question were answered');
});

test('a recording travels as an Ogg Opus file a decoder accepts, page by page', () => {
  // Ogg's own CRC, written from the specification rather than from ogg.c.
  const crc = (bytes) => {
    let c = 0;
    for (const b of bytes) {
      c = (c ^ (b << 24)) >>> 0;
      for (let k = 0; k < 8; k++) c = (c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) : c << 1) >>> 0;
    }
    return c;
  };
  // A small packet, one needing two lacing values, and one a whole 255 long,
  // which needs a closing zero to say it ended.
  const sizes = [3, 300, 255];
  const [hex, full] = charm([`ogg 8192 ${sizes.join(' ')} 0`, 'ogg 120 3 300 0']);
  assert.equal(full, '-', 'a packet that does not fit was written past the end');
  const file = Buffer.from(hex, 'hex');
  const pages = [];
  for (let at = 0; at < file.length;) {
    assert.equal(file.toString('latin1', at, at + 4), 'OggS', `no page at byte ${at}`);
    const n = file[at + 26], lacing = [...file.subarray(at + 27, at + 27 + n)];
    const length = 27 + n + lacing.reduce((a, b) => a + b, 0);
    const bytes = Buffer.from(file.subarray(at, at + length));
    const stated = bytes.readUInt32LE(22);
    bytes.writeUInt32LE(0, 22);
    assert.equal(crc(bytes), stated, `page ${pages.length} carries a CRC a decoder refuses`);
    pages.push({ flags: file[at + 5], granule: Number(file.readBigUInt64LE(at + 6)), serial: file.readUInt32LE(at + 14),
                 seq: file.readUInt32LE(at + 18), lacing, body: file.subarray(at + 27 + n, at + length) });
    at += length;
  }
  assert.equal(pages.length, 2 + sizes.length, 'not a head, tags and a page for each packet');
  assert.deepEqual(pages.map(p => p.seq), pages.map((_, i) => i), 'the pages are not numbered in order');
  assert.ok(pages.every(p => p.serial === 0x2a), 'the pages are not one stream');
  assert.deepEqual(pages.map(p => p.flags), [2, 0, 0, 0, 4], 'the first page does not begin the stream or the last end it');
  const head = pages[0].body;
  assert.equal(head.toString('latin1', 0, 8), 'OpusHead');
  assert.deepEqual([head[9], head.readUInt16LE(10), head.readUInt32LE(12)], [1, 312, 16000],
    'the head does not say mono, its pre-skip and the rate it was recorded at');
  assert.equal(pages[1].body.toString('latin1', 0, 8), 'OpusTags');
  assert.deepEqual(pages.slice(2).map(p => p.granule), [312 + 960, 312 + 1920, 312 + 2880],
    'the granule positions do not count 20 ms packets in 48 kHz samples');
  pages.slice(2).forEach((p, i) => {
    const want = Buffer.from(Array.from({ length: sizes[i] }, (_, k) => (k * 7 + sizes[i]) & 255));
    assert.deepEqual(p.body, want, `packet ${i} is not the bytes that went in`);
  });
  assert.deepEqual(pages[4].lacing, [255, 0], 'a 255-byte packet has no closing zero, and runs into the next');
});

test('the charm plays what the server frames, however its reads fall', () => {
  // The server's own frames: a beat of silence, the volume she set, then her
  // voice in parts of odd length, as a speech vendor's chunks fall, and a kind
  // the charm does not know, which it must step over.
  const bytes = (...b) => Uint8Array.from(b);
  const voice = [bytes(0, 0, 0, 0), bytes(0x01, 0x02, 0x03), bytes(0x04, 0xff, 0x80)];
  const stream = Buffer.concat([
    charmFrame(FRAME.voice, voice[0]),
    charmFrame(FRAME.volume, bytes(80)),
    charmFrame(FRAME.voice, voice[1]),
    charmFrame(9, bytes(0x7f, 0x7f, 0x7f)),
    charmFrame(FRAME.voice, voice[2]),
  ].map(f => Buffer.from(f)));
  assert.deepEqual(Object.keys(FRAME), ['voice', 'volume'], 'the server sends a kind the charm was never taught');
  const pcm = Buffer.concat(voice);
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(2 * i));
  const sizes = [1, 2, 3, 5, stream.length];
  const heard = charm(sizes.map(n => `frames ${n} ${stream.toString('hex')}`));
  for (const [i, line] of heard.entries()) {
    assert.equal(line, ['80', ...samples].join(' '),
      `read ${sizes[i]} bytes at a time, the charm played something other than her voice at her volume`);
  }
});

/* ─── The firmware's names, the two scope questions in C ──────────────────
   The ESP-IDF build already refuses the first, a name used and declared
   nowhere: an undeclared function is an error under its -Werror=all, an
   undeclared variable under any flags. It does not refuse the second. An
   unused static is only a warning there, and nothing at all is said of a
   header export no other file calls, a macro left from a design that went,
   or a function left out of its header. So the firmware's own files are
   read here, comments and strings stripped, and every name each declares
   is asked for a use:

     · in a .c, every static function and variable, macro and enum constant
       is used again in that file;
     · in a .h, every function is called from a .c other than its own — or
       it belongs in its file as a static — and every other name is used by
       some .c;
     · every function a .c defines without `static` is one a header declares.

   The fonts are lv_font_conv's output and are left out, found by the
   options line it writes. app_main is ESP-IDF's to call. */
const FIRMWARE = execFileSync('git', ['ls-files', MAIN], { encoding: 'utf8' }).split('\n')
  .filter(f => /\.[ch]$/.test(f) && !/\* Opts: --font /.test(readFileSync(f, 'utf8')));

// Comments to blank lines, strings and characters to empty ones, in one pass,
// so a "/*" inside a string opens nothing.
const bare = (text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
  (m) => m[0] === '"' ? '""' : m[0] === "'" ? "''" : m.replace(/[^\n]/g, ' '));

const uses = (text, name) => (text.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;

// What a file declares at its top level, by kind.
function declares(text) {
  const enums = [...text.matchAll(/\benum\s*\{([^}]*)\}/g)].flatMap(m => m[1].match(/\b[A-Z]\w*\b/g) ?? []);
  const types = [...text.matchAll(/^typedef\s+(?:struct|enum)\s*\{[^}]*\}\s*(\w+)\s*;/gm)].map(m => m[1]);
  const flat = text.replace(/\b(?:struct|enum)\s*\{[^}]*\}/g, 'T').replace(/\basm\(""\)/g, '');
  const functions = [...flat.matchAll(/^(static\s+)?(?:\w+\s+)*?\w+[\s*]+(\w+)\([^;{]*\)\s*([;{])/gm)]
    .map(m => ({ name: m[2], static: Boolean(m[1]), defined: m[3] === '{' }));
  const variables = [...flat.matchAll(/^(?:(static|extern)\s+[^;{=(]*|\w+\s+\w+)(?=\s*[;=])/gm)]
    .flatMap(m => m[0].split(',').map(part => part.replace(/\[[^\]]*\]/g, '').match(/(\w+)\s*$/)?.[1]))
    .filter(Boolean);
  const macros = [...text.matchAll(/^#define\s+(\w+)/gm)].map(m => m[1]);
  return { functions, variables, macros, enums, types };
}

// Each name the firmware declares and never uses as asked above, as a sentence.
function unused(files) {
  const found = [];
  const c = Object.keys(files).filter(f => f.endsWith('.c'));
  for (const [file, text] of Object.entries(files)) {
    const d = declares(text);
    if (file.endsWith('.c')) {
      const local = [...d.functions.filter(f => f.static).map(f => f.name), ...d.variables,
                     ...d.macros, ...d.enums];
      for (const name of local) if (uses(text, name) < 2) found.push(`${file}: ${name} is declared and never used`);
      for (const { name, static: s, defined } of d.functions) {
        if (s || !defined || name === 'app_main') continue;
        if (!Object.keys(files).some(h => h.endsWith('.h') && uses(files[h], name)))
          found.push(`${file}: ${name} is not static and no header declares it`);
      }
    } else {
      const own = file.replace(/\.h$/, '.c');
      for (const { name } of d.functions) {
        if (!c.some(f => f !== own && uses(files[f], name)))
          found.push(`${file}: ${name} is called by no file but its own — it belongs there, static`);
      }
      for (const name of [...d.macros, ...d.enums, ...d.types, ...d.variables]) {
        if (!c.some(f => uses(files[f], name))) found.push(`${file}: ${name} is used by no file`);
      }
    }
  }
  return found;
}

test('every name the firmware declares is one it uses, and a header exports only what another file calls', () => {
  const files = Object.fromEntries(FIRMWARE.map(f => [f.slice(MAIN.length + 1), bare(readFileSync(f, 'utf8'))]));
  assert.ok(Object.keys(files).length >= 30, `only ${Object.keys(files).length} firmware files read — the reader has gone blind`);
  const counted = Object.values(files).map(declares);
  for (const kind of ['functions', 'variables', 'macros', 'enums', 'types']) {
    assert.ok(counted.reduce((n, d) => n + d[kind].length, 0) >= 10, `fewer than ten ${kind} found — the reader has gone blind`);
  }
  assert.deepEqual(unused(files), []);
});
