/* The charm's pure C, compiled on this machine and driven from here, in the
   time zone the charm itself reads its clock in: the briefing watch held
   against the server's own hours every five minutes of both weeks the clocks
   change in, how long she sleeps between errands, a lift judged on
   readings, the setup's answer to a phone's every name, the Ogg file a recording travels in, and her answer read out of
   the server's own frames. Only what has no ESP-IDF in it is here; the rest is
   the board's to prove. */
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
// <away>` (seconds).
const DRIVER = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "briefing.h"
#include "dns.h"
#include "errand.h"
#include "frames.h"
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
      join(dir, 'drive.c'), `${MAIN}/briefing.c`, `${MAIN}/errand.c`, `${MAIN}/lift.c`, `${MAIN}/dns.c`, `${MAIN}/ogg.c`, `${MAIN}/frames.c`, '-lm', '-o', join(dir, 'drive')]);
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
