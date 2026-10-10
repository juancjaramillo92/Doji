/* The charm's pure C, compiled on this machine and driven from here, in the
   time zone the charm itself reads its clock in: the briefing watch held
   against the server's own hours every five minutes of both weeks the clocks
   change in, and a lift judged on readings. Only what has no ESP-IDF in it is
   here; the rest is the board's to prove. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { briefDue, retryDue } from '../supabase/functions/doji-eugenia/index.ts';

const MAIN = 'charm/main';

// Questions on stdin, one answer a line: `due <epoch>`, `announce <epoch>`,
// `lift <six readings in g>`.
const DRIVER = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "briefing.h"
#include "lift.h"
int main(int argc, char **argv) {
    (void)argc;
    setenv("TZ", argv[1], 1);
    tzset();
    char op[16];
    long long t;
    float a[3], b[3];
    while (scanf("%15s", op) == 1) {
        if (!strcmp(op, "due") && scanf("%lld", &t) == 1) printf("%d\\n", briefing_due((time_t)t));
        if (!strcmp(op, "announce") && scanf("%lld", &t) == 1) { briefing_announced((time_t)t); printf("ok\\n"); }
        if (!strcmp(op, "lift") && scanf("%f %f %f %f %f %f", a, a + 1, a + 2, b, b + 1, b + 2) == 6)
            printf("%d\\n", lift_seen(a, b));
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
      join(dir, 'drive.c'), `${MAIN}/briefing.c`, `${MAIN}/lift.c`, '-lm', '-o', join(dir, 'drive')]);
    return execFileSync(join(dir, 'drive'), [zone[1]], { input: questions.join('\n') + '\n', encoding: 'utf8' })
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

test('she never asks before the internet has set her clock', () => {
  // 08:30 on Friday 2 January 1970 in New York: a briefing's hour, on a clock never set.
  assert.deepEqual(charm([`due ${epoch(new Date(Date.UTC(1970, 0, 2, 13, 30)))}`]), ['0']);
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
