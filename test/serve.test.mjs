/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the five request handlers, served
   ───────────────────────────────────────────────────────────────────────────
   fold.test.mjs drives what each function decides; this drives the door in
   front of it. Each module guards `Deno.serve` so importing it serves nothing,
   so a stub `Deno` whose `serve` keeps the handler hands the real one to a
   test, without the module exporting it.

   Its own file because its own process: `_shared/edge.ts` reads SUPABASE_URL
   and SB_SECRET_KEY once, when first imported, and every other suite imports it
   with no environment at all. Here the stub is installed before anything loads.
   Each function is imported fresh, under a query, with whatever environment
   the test asks for, since each reads its own secrets at load.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const USER = '00000000-0000-0000-0000-000000000001';
const ENV = {
  SUPABASE_URL: 'https://db.test', SB_SECRET_KEY: 'sb_secret_test', DOJI_USER_ID: USER,
  DOJI_CRON_SECRET: 'cron', DOJI_EMAIL_SECRET: 'mail', TELEGRAM_CHAT_ID: '42',
  GLADYS_BOT_TOKEN: 'gladys', GLADYS_WEBHOOK_SECRET: 'gladys-hook',
  EUGENIA_BOT_TOKEN: 'eugenia', EUGENIA_WEBHOOK_SECRET: 'eugenia-hook',
  ANTHROPIC_API_KEY: 'sk-ant-test', CTRADER_MCP_TOKEN: 'ctrader',
  EUGENIA_CHARM_SECRET: 'charm', STT_URL: 'https://stt.test/v1/audio/transcriptions',
  STT_KEY: 'stt', TTS_KEY: 'tts', GLADYS_CHARM_SECRET: 'gladys-charm',
};

let env = ENV;
globalThis.Deno = { env: { get: (k) => env[k] } };

// What the answer-first paths hand to the runtime to keep alive.
const kept = [];
globalThis.EdgeRuntime = { waitUntil: (p) => { kept.push(p); } };

/* Every request a handler makes, in order. `respond` decides the answer, and
   by default never gives one: a test that did not expect a request then
   shows it as a hang-free entry in `calls` rather than as a passing write. */
const calls = [];
let respond;
globalThis.fetch = (url, init = {}) => {
  calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {},
               body: init.body });
  return respond(String(url), init);
};
const pending = () => new Promise(() => {});
const ok = (body = {}, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  calls.length = 0;
  kept.length = 0;
  respond = pending;
});

let n = 0;
async function serving(fn, unset = []) {
  env = Object.fromEntries(Object.entries(ENV).filter(([k]) => !unset.includes(k)));
  let handler;
  globalThis.Deno.serve = (h) => { handler = h; };
  try {
    await import(`../supabase/functions/${fn}/index.ts?serve=${n++}`);
  } finally {
    delete globalThis.Deno.serve;
    env = ENV;
  }
  assert.ok(handler, `${fn} registered no handler with Deno.serve`);
  return handler;
}

const request = (path, { key, header = 'x-doji-key', body, method = 'POST' } = {}) =>
  new Request(`https://fn.test/functions/v1/${path}`, {
    method, body, headers: key === undefined ? {} : { [header]: key },
  });

const answer = async (res) => ({ status: res.status, body: await res.json() });

/* ─── Every door refuses before it works ──────────────────────────────────
   A missing secret is a 503 at the door, never a 401 or a write downstream;
   a wrong key is a 401; and neither makes a single request. */

// Each function, one secret its boot guard names, and its path.
const DOORS = [
  ['doji-email-sync',  'DOJI_EMAIL_SECRET',  'doji-email-sync'],
  ['doji-gladys',      'GLADYS_BOT_TOKEN',   'doji-gladys'],
  ['doji-mcp-sync',    'CTRADER_MCP_TOKEN',  'doji-mcp-sync'],
  ['doji-tradingview', 'DOJI_CRON_SECRET',   'doji-tradingview'],
  ['doji-eugenia',     'ANTHROPIC_API_KEY',  'doji-eugenia'],
];

test('every door refuses a secret that did not load, and asks nothing', async () => {
  // Derived, so a sixth function arrives here unguarded rather than unnoticed.
  const functions = readdirSync(new URL('../supabase/functions', import.meta.url))
    .filter(d => d !== '_shared').sort();
  assert.deepEqual(DOORS.map(([fn]) => fn).sort(), functions,
    'a function is deployed whose door no test here knocks on');
  for (const [fn, secret, path] of DOORS) {
    calls.length = 0;
    const serve = await serving(fn, [secret]);
    const res = await answer(await serve(request(path, { key: ENV.DOJI_CRON_SECRET, body: '{}' })));
    assert.deepEqual(res, { status: 503, body: { ok: false, error: 'not configured' } },
      `${fn} answered with ${secret} unset`);
    assert.deepEqual(calls, [], `${fn} made a request with ${secret} unset`);
  }
});

test('every door refuses a caller without the secret, and asks nothing', async () => {
  for (const [fn, , path] of DOORS) {
    calls.length = 0;
    const serve = await serving(fn);
    for (const key of [undefined, 'wrong']) {
      const res = await answer(await serve(request(path, { key, body: '{}' })));
      assert.equal(res.status, 401, `${fn} admitted a caller presenting ${key ?? 'no key'}`);
    }
    assert.deepEqual(calls, [], `${fn} made a request for a caller it refused`);
  }
});

/* ─── The email path: three outcomes, and the heartbeat on each ──────────── */

const marks = () => calls.filter(c => c.url.startsWith('https://db.test/rest/v1/sync_health'))
  .map(c => JSON.parse(c.body));

test('doji-email-sync: a fill is upserted onto its position and marks a completed run', async () => {
  const serve = await serving('doji-email-sync');
  respond = () => ok();
  const fill = { id: 'PID577885869', direction: 'SELL', fill_time: '2026-07-30T15:04:05Z', net_pnl: 57.1 };
  const res = await answer(await serve(request('doji-email-sync', { key: 'mail', body: JSON.stringify(fill) })));

  assert.deepEqual(res, { status: 200, body: { ok: true, id: 'PID577885869' } });
  const [write] = calls;
  assert.equal(write.url, 'https://db.test/rest/v1/trades?on_conflict=id');
  assert.equal(write.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(write.headers.apikey, 'sb_secret_test');
  assert.deepEqual(JSON.parse(write.body), [{ ...fill, user_id: USER }],
    'the row sent is not the boundary\'s row, owner from secrets');
  assert.deepEqual(Object.keys(marks()[0]), ['last_ok']);
});

test('doji-email-sync: a body that is not a fill is refused for good and marked; a probe is not', async () => {
  const serve = await serving('doji-email-sync');
  respond = () => ok();

  let res = await answer(await serve(request('doji-email-sync', { key: 'mail', body: 'not json' })));
  assert.equal(res.status, 400);
  assert.equal(marks()[0].last_error, 'body is not JSON');

  calls.length = 0;
  res = await answer(await serve(request('doji-email-sync', { key: 'mail', body: '{"id":"PID1","direction":"LONG"}' })));
  assert.equal(res.status, 400);
  assert.match(marks()[0].last_error, /^refused, the fill is lost: direction/);

  calls.length = 0;
  res = await answer(await serve(request('doji-email-sync', { key: 'mail', body: '{}' })));
  assert.deepEqual(res, { status: 400, body: { ok: false, error: 'id is not PID<digits>', probe: true } });
  assert.deepEqual(calls, [], 'testSecret()\'s probe marked the heartbeat, so the diagnostic reports a broken sync');
});

test('doji-email-sync: PostgREST\'s answer decides whether the Apps Script retries', async () => {
  const serve = await serving('doji-email-sync');
  const fill = JSON.stringify({ id: 'PID1', direction: 'BUY', fill_time: '2026-07-30T15:04:05Z' });
  for (const [status, expected] of [[409, 400], [422, 400], [401, 500], [503, 500]]) {
    calls.length = 0;
    respond = (url) => url.includes('/trades') ? ok({ message: 'no' }, status) : ok();
    const res = await answer(await serve(request('doji-email-sync', { key: 'mail', body: fill })));
    assert.equal(res.status, expected, `PostgREST's ${status} reached the Apps Script as ${res.status}`);
    assert.match(marks()[0].last_error, new RegExp(`^HTTP ${status}`));
  }
  calls.length = 0;
  respond = (url) => url.includes('/trades') ? Promise.reject(new Error('dns')) : ok();
  const res = await answer(await serve(request('doji-email-sync', { key: 'mail', body: fill })));
  assert.deepEqual(res, { status: 500, body: { ok: false, error: 'write unreachable' } });
  assert.equal(marks()[0].last_error, 'dns');
});

/* ─── Gladys: the header picks the half ─────────────────────────────────── */

test('doji-gladys: a tap from another chat is answered and written nowhere', async () => {
  const serve = await serving('doji-gladys');
  respond = () => ok({ ok: true });
  const tap = { callback_query: { id: 'cq1', data: 'a|PID1|r|y', message: { chat: { id: 7 }, message_id: 3 } } };
  const res = await answer(await serve(request('doji-gladys',
    { header: 'x-telegram-bot-api-secret-token', key: 'gladys-hook', body: JSON.stringify(tap) })));
  assert.deepEqual(res, { status: 200, body: { ok: true, ignored: 'wrong chat' } });
  assert.deepEqual(calls.map(c => c.url), ['https://api.telegram.org/botgladys/answerCallbackQuery'],
    'a tap from outside his thread reached the table');
});

test('doji-gladys: Telegram\'s secret does not open the database\'s half, nor the reverse', async () => {
  const serve = await serving('doji-gladys');
  for (const [header, key] of [['x-telegram-bot-api-secret-token', 'cron'], ['x-doji-key', 'gladys-hook']]) {
    const res = await serve(request('doji-gladys', { header, key, body: '{}' }));
    assert.equal(res.status, 401, `${header} carrying the other half's secret was admitted`);
  }
  assert.deepEqual(calls, []);
});

/* ─── The poller: the weekend is a completed run ────────────────────────── */

test('doji-mcp-sync: with the market closed it marks a run and calls no broker', async () => {
  const serve = await serving('doji-mcp-sync');
  respond = () => ok();
  // Saturday noon in New York.
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-08-01T16:00:00Z') });
  try {
    const res = await answer(await serve(request('doji-mcp-sync', { key: 'cron' })));
    assert.deepEqual(res, { status: 200, body: { ok: true, skipped: 'market closed' } });
  } finally { mock.timers.reset(); }
  assert.deepEqual(calls.map(c => c.url), ['https://db.test/rest/v1/sync_health?id=eq.poller'],
    'the weekend skip reached the broker, or left no mark and reads as a dead sync every Sunday');
  assert.deepEqual(Object.keys(marks()[0]), ['last_ok']);
});

/* ─── TradingView: two public paths, and nothing else without the secret ── */

test('doji-tradingview: the client document is public, and a bare call asks for nothing', async () => {
  const serve = await serving('doji-tradingview');
  const client = await answer(await serve(request('doji-tradingview/client', { method: 'GET' })));
  assert.equal(client.status, 200);
  assert.match(client.body.client_id, /doji-tradingview\/client$/);

  const bare = await answer(await serve(request('doji-tradingview', { key: 'cron' })));
  assert.equal(bare.status, 400);
  assert.match(bare.body.error, /^nothing asked/);
  assert.deepEqual(calls, [], 'a call that asked for nothing made a request');
});

/* ─── Eugenia: everything answers before it works ─────────────────────────
   Every request below hangs, so a handler that awaited its work would never
   answer; one that answered and dropped its work would leave nothing kept.
   Afterwards every hung request fails, so the kept work unwinds through its
   own catches and the reply's typing interval is cleared by its `finally`. */

test('doji-eugenia: a message, a trade event and the hour each answer first and keep their work', async () => {
  const serve = await serving('doji-eugenia');
  const hung = [];
  respond = () => new Promise((_, reject) => hung.push(reject));
  const all = [];
  const cases = [
    [{ header: 'x-telegram-bot-api-secret-token', key: 'eugenia-hook',
       body: JSON.stringify({ message: { chat: { id: 42 }, text: 'hola' } }) }, { ok: true }],
    [{ key: 'cron', body: JSON.stringify({ trade: 'PID1', event: 'closed' }) },
     { ok: true, accepted: 'trade event' }],
    [{ key: 'cron' }, { ok: true, accepted: 'hourly' }],
  ];
  try {
    for (const [req, body] of cases) {
      kept.length = 0;
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('the handler waited on its work before answering')), 2_000);
      });
      try {
        const res = await answer(await Promise.race([serve(request('doji-eugenia', req)), late]));
        assert.deepEqual(res, { status: 200, body });
      } finally { clearTimeout(timer); }
      assert.equal(kept.length, 1, 'the work was not handed to EdgeRuntime.waitUntil, so it dies with the answer');
      all.push(...kept);
    }
  } finally {
    // Unwound however the test ended: a failure must fail, not hang the suite.
    respond = () => Promise.reject(new Error('test over'));
    for (const reject of hung) reject(new Error('test over'));
    await Promise.all(all);
  }
});

/* ─── The charm: one request, answered at once, her voice after it ─────────
   Through the real door and the real turn — the transcription, the reads, the
   model, the gate, the speech, the copy and the write — each answered by URL,
   and what comes back read to its end. */

const PCM = [1, 2, 3, 4];
const charmTurn = (said, answer) => (url, init) => {
  if (url.startsWith('https://stt.test/')) return ok({ text: said });
  if (url.startsWith('https://api.anthropic.com/')) {
    return ok({ model: JSON.parse(init.body).model, stop_reason: 'end_turn',
                usage: { input_tokens: 10, output_tokens: 5 },
                content: [{ type: 'text', text: answer }] });
  }
  if (url.includes('/audio/speech')) return Promise.resolve(new Response(new Uint8Array(PCM)));
  if (url.startsWith('https://api.telegram.org/')) return ok({ ok: true });
  if (url.startsWith('https://db.test/rest/v1/')) return ok([]);
  return Promise.reject(new Error(`the charm asked something unexpected: ${url}`));
};
const charm = (body, headers = {}) => new Request('https://fn.test/functions/v1/doji-eugenia',
  { method: 'POST', body, headers: { 'x-charm-key': 'charm', ...headers } });
const bodies = (part) => calls.filter(c => c.url.includes(part)).map(c => JSON.parse(c.body));

/* What the charm is sent, read as the charm reads it: a kind byte, three bytes
   of length, that many bytes, to the last byte. A frame that overran the end
   or a stray byte after the last is a stream the charm cannot follow. */
async function framesOf(res) {
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  const b = new Uint8Array(await res.arrayBuffer());
  const out = [];
  for (let i = 0; i < b.length;) {
    assert.ok(i + 4 <= b.length, `a frame header was cut off at byte ${i}`);
    const n = b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3];
    assert.ok(i + 4 + n <= b.length, `a frame at byte ${i} runs past the end`);
    out.push({ kind: b[i], bytes: [...b.subarray(i + 4, i + 4 + n)] });
    i += 4 + n;
  }
  return out;
}
const voiceOf = (frames) => frames.filter(f => f.kind === 0).flatMap(f => f.bytes);

test('doji-eugenia: the charm is answered at once, hears her answer, and Telegram gets the copy', async () => {
  const serve = await serving('doji-eugenia');
  respond = charmTurn('how is gold doing', 'Gold is holding 4,410.');
  const res = await serve(charm(new Uint8Array(64)));
  assert.equal(res.status, 200);
  assert.equal(kept.length, 1, 'the turn was not handed to EdgeRuntime.waitUntil, so a charm that hangs up kills it');

  const frames = await framesOf(res);
  await Promise.all(kept);
  assert.deepEqual([...new Set(frames.map(f => f.kind))], [0], 'a frame other than her voice was sent unasked');
  const played = voiceOf(frames);
  assert.ok(played.length > PCM.length, 'nothing was on the wire while she thought');
  assert.ok(played.slice(0, -PCM.length).every(b => b === 0),
    'what played before her answer was not silence');
  assert.deepEqual(played.slice(-PCM.length), PCM, 'her answer is not what the charm played');

  const file = calls.find(c => c.url.startsWith('https://stt.test/')).body.get('file');
  assert.deepEqual([file.name, file.type], ['charm.ogg', 'audio/ogg'],
    'the recording was handed to transcription as something other than the Ogg it is');
  assert.deepEqual(bodies('/audio/speech').map(b => [b.input, b.response_format]),
    [['Gold is holding 4,410.', 'pcm']],
    'the charm was read something other than the gated answer, or in a format it cannot play');
  assert.deepEqual(bodies('/sendMessage').map(b => b.text), ['«how is gold doing»\n\nGold is holding 4,410.'],
    'Telegram did not get the copy, his words first');
  assert.deepEqual(calls.filter(c => c.url.endsWith('/rest/v1/eugenia_turns')).map(c => JSON.parse(c.body)),
    [[{ role: 'user', content: '[voice note] how is gold doing' },
      { role: 'assistant', content: 'Gold is holding 4,410.' }]],
    'the exchange was not stored as one conversation with Telegram');
});

test('doji-eugenia: a long answer reaches the charm whole, every part in order', async () => {
  // Two paragraphs past the vendor's input limit together: two readings, joined.
  const long = `${'Gold held. '.repeat(250).trim()}\n\n${'Then it gave way. '.repeat(150).trim()}`;
  const serve = await serving('doji-eugenia');
  respond = charmTurn('tell me everything', long);
  const played = voiceOf(await framesOf(await serve(charm(new Uint8Array(64)))));
  await Promise.all(kept);
  const read = bodies('/audio/speech').map(b => b.input);
  assert.equal(read.length, 2, `the answer was read in ${read.length} parts`);
  assert.equal(read.join('\n\n'), long, 'what was read is not the whole answer, in order');
  assert.deepEqual(played.slice(-2 * PCM.length), [...PCM, ...PCM], 'the charm did not play every part');
});

test('doji-eugenia: the charm tells her about itself, and the volume she sets goes ahead of her voice', async () => {
  const serve = await serving('doji-eugenia');
  respond = charmTurn('speak up a little', '[volume 80] Is this better, jefe?');
  const frames = await framesOf(await serve(charm(new Uint8Array(64),
    { 'x-charm-battery': '37', 'x-charm-charging': '1', 'x-charm-volume': '55' })));
  await Promise.all(kept);
  const told = JSON.stringify(bodies('api.anthropic.com/v1/messages')[0].messages.at(-1));
  for (const fact of ['battery is at 37% and charging', 'volume is 55 of 100', '[volume N]']) {
    assert.ok(told.includes(fact), `her turn was not told ${fact}`);
  }
  const volume = frames.findIndex(f => f.kind === 1);
  assert.deepEqual(frames[volume]?.bytes, [80], 'the charm was not sent the volume she set');
  assert.ok(frames.slice(volume + 1).some(f => f.kind === 0 && f.bytes.some(b => b !== 0)) &&
            !frames.slice(0, volume).some(f => f.bytes.some(b => b !== 0)),
    'her voice did not wait for the volume');
  const answer = 'Is this better, jefe?';
  assert.deepEqual(bodies('/audio/speech').map(b => b.input), [answer], 'the volume marker was read aloud');
  assert.ok(bodies('/sendMessage')[0].text.endsWith(`\n\n${answer}`), 'the copy carries the volume marker');
  assert.equal(calls.filter(c => c.url.endsWith('/rest/v1/eugenia_turns'))
    .map(c => JSON.parse(c.body))[0][1].content, answer, 'the volume marker was stored as hers');
});

test('doji-eugenia: a low battery is said on the charm after her answer, and nowhere else', async () => {
  const serve = await serving('doji-eugenia');
  respond = charmTurn('anything else', 'Nothing more today.');
  await framesOf(await serve(charm(new Uint8Array(64), { 'x-charm-low': '1' })));
  await Promise.all(kept);
  assert.deepEqual(bodies('/audio/speech').map(b => b.input),
    ["Nothing more today. Jefe, I'm running out of battery. Charge me when you can."],
    'the charm did not say its battery is low after her answer');
  assert.ok(!bodies('/sendMessage')[0].text.includes('battery'), 'the battery line reached Telegram');
  assert.ok(!calls.filter(c => c.url.endsWith('/rest/v1/eugenia_turns')).some(c => c.body.includes('battery')),
    'the battery line was stored as a turn of hers');
});

test('doji-eugenia: a recording with no words is answered on the charm, and nothing else happens', async () => {
  const serve = await serving('doji-eugenia');
  respond = charmTurn('', 'never asked');
  const res = await serve(charm(new Uint8Array(64)));
  await res.arrayBuffer();
  await Promise.all(kept);
  assert.match(bodies('/audio/speech')[0]?.input ?? '', /could not make out any words/,
    'the charm was not told it could not be heard');
  for (const asked of ['api.anthropic.com', 'api.telegram.org', 'eugenia_turns']) {
    assert.ok(!calls.some(c => c.url.includes(asked)), `a recording with no words reached ${asked}`);
  }
});

test('doji-eugenia: the charm is refused at the door without its vendors or a recording', async () => {
  for (const unset of ['STT_URL', 'STT_KEY', 'TTS_KEY']) {
    calls.length = 0;
    const serve = await serving('doji-eugenia', [unset]);
    const res = await answer(await serve(charm(new Uint8Array(64))));
    assert.equal(res.status, 503, `the charm was let in with ${unset} unset`);
    assert.deepEqual(calls, [], `the charm made a request with ${unset} unset`);
  }
  const serve = await serving('doji-eugenia');
  calls.length = 0;
  assert.equal((await serve(charm(new Uint8Array(0)))).status, 400, 'an empty recording was let in');
  assert.deepEqual(calls, [], 'an empty recording made a request');
  assert.equal((await serve(request('doji-eugenia', { header: 'x-charm-key', key: 'wrong', body: 'x' }))).status,
    401, 'the charm door admitted a wrong key');
});

/* ─── The briefing on the charm ───────────────────────────────────────────
   The charm wakes after the briefing's hour and asks whether it has landed,
   then asks for the briefing itself when he presses. Both read today's stored
   briefing by its marker, as the speaking worker does. */

const briefingStored = (content) => (url) => {
  if (url.includes('/rest/v1/eugenia_turns?select=created_at')) {
    return ok(content === null ? [] : [{ created_at: new Date().toISOString() }]);
  }
  if (url.includes('/rest/v1/eugenia_turns?select=content')) return ok([{ content }]);
  if (url.includes('/audio/speech')) return Promise.resolve(new Response(new Uint8Array(PCM)));
  return Promise.reject(new Error(`the briefing door asked something unexpected: ${url}`));
};
const briefingDoor = (which) => new Request(`https://fn.test/functions/v1/doji-eugenia?briefing=${which}`,
  { method: 'GET', headers: { 'x-charm-key': 'charm' } });

test('doji-eugenia: the charm hears that the briefing landed, then the briefing itself', async () => {
  const serve = await serving('doji-eugenia');
  respond = briefingStored('Gold opened quiet.');
  for (const [which, said] of [['ready', 'Your briefing is ready, jefe.'], ['today', 'Gold opened quiet.']]) {
    calls.length = 0;
    const res = await serve(briefingDoor(which));
    assert.equal(res.status, 200, `?briefing=${which} did not answer with audio`);
    assert.deepEqual(voiceOf(await framesOf(res)).slice(-PCM.length), PCM);
    assert.deepEqual(bodies('/audio/speech').map(b => [b.input, b.response_format]), [[said, 'pcm']],
      `?briefing=${which} read the charm something other than ${JSON.stringify(said)}`);
    // Sunday's briefing on a Sunday in New York, the weekday one otherwise.
    const sunday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
      .format(new Date()) === 'Sun';
    const marker = calls.find(c => c.url.includes('select=created_at')).url;
    assert.ok(marker.includes(encodeURIComponent(`[${sunday ? 'sunday' : 'weekday'} briefing]`)),
      `the charm looked for the wrong briefing today: ${marker}`);
  }
});

test('doji-eugenia: a briefing not stored yet is a 204, and nothing is spoken', async () => {
  const serve = await serving('doji-eugenia');
  respond = briefingStored(null);
  for (const which of ['ready', 'today']) {
    calls.length = 0;
    const res = await serve(briefingDoor(which));
    assert.equal(res.status, 204, `?briefing=${which} answered ${res.status} with no briefing stored`);
    assert.ok(!calls.some(c => c.url.includes('/audio/speech')), 'a briefing that is not there was spoken');
  }
  calls.length = 0;
  assert.equal((await serve(briefingDoor('yesterday'))).status, 400, 'a briefing door it does not open answered');
  assert.deepEqual(calls, [], 'a briefing door it does not open made a request');
});

/* ─── Gladys's charm: what waits, and an answer on its screen ─────────────
   What waits is read oldest first from a newest-first page; an answer is a
   tap's own grammar, so it can only ever write one of the four columns. */

const trade = (id, hoursAgo, fields = {}) => ({
  id, direction: 'BUY', entry_price: 4412.5,
  entry_time: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  setup: null, followed_rules: null, followed_sl: null, followed_tp: null, ...fields,
});
const gladysCharm = (init = {}) => new Request('https://fn.test/functions/v1/doji-gladys',
  { method: 'GET', ...init, headers: { 'x-charm-key': 'gladys-charm', ...(init.headers ?? {}) } });

test('doji-gladys: the charm is told what waits, oldest first, a week back at most', async () => {
  const serve = await serving('doji-gladys');
  respond = (url) => url.includes('/rest/v1/trades?') ? ok([trade('PID2', 1), trade('PID1', 30)]) : pending();
  const res = await answer(await serve(gladysCharm()));
  assert.equal(res.status, 200);
  assert.equal(res.body.waiting, 2);
  assert.equal(res.body.trade.id, 'PID1', 'the charm was handed the newer trade first');
  const read = decodeURIComponent(calls[0].url);
  for (const part of ['deleted=is.false', 'entry_time=gte.', 'order=entry_time.desc', 'limit=20',
                      'or=(setup.is.null,followed_rules.is.null,followed_sl.is.null,followed_tp.is.null)']) {
    assert.ok(read.includes(part), `what waits is no longer read with ${part}: ${read}`);
  }
  const since = new Date(read.match(/entry_time=gte\.([^&]+)/)[1]);
  const days = (Date.now() - since) / 86_400_000;
  assert.ok(days > 6.9 && days < 7.1, `what waits reaches back ${days.toFixed(2)} days, not a week`);
});

test('doji-gladys: an answer from the charm writes its one column, then says what waits', async () => {
  const serve = await serving('doji-gladys');
  respond = (url, init) => {
    if (init.method === 'PATCH') return ok([trade('PID1', 30, JSON.parse(init.body))]);
    if (url.includes('/rest/v1/trades?')) return ok([]);
    return pending();
  };
  const res = await answer(await serve(gladysCharm({ method: 'POST', body: JSON.stringify({ data: 'PID1|sl|1' }) })));
  assert.deepEqual(res, { status: 200, body: { ok: true, waiting: 0, trade: null } });
  const writes = calls.filter(c => c.method === 'PATCH');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].url.includes('trades?id=eq.PID1'), writes[0].url);
  assert.deepEqual(JSON.parse(writes[0].body), { followed_sl: true }, 'the charm wrote more than its one answer');
});

test('doji-gladys: the charm cannot write anything but an answer, and is shut without its key', async () => {
  const serve = await serving('doji-gladys');
  for (const body of [JSON.stringify({ data: 'PID1|edit' }), JSON.stringify({ data: 'PID1|exit_price|1' }),
                      JSON.stringify({ data: 'PID1|setup|Scalp' }), JSON.stringify({ data: 'PID1|rules|yes' }),
                      'not json']) {
    calls.length = 0;
    const res = await answer(await serve(gladysCharm({ method: 'POST', body })));
    assert.equal(res.status, 400, `the charm's ${body} was accepted`);
    assert.deepEqual(calls, [], `the charm's ${body} made a request`);
  }
  const shut = await serving('doji-gladys', ['GLADYS_CHARM_SECRET']);
  calls.length = 0;
  assert.equal((await shut(gladysCharm())).status, 401, 'the charm door opened with its secret unset');
  assert.deepEqual(calls, [], 'a shut charm door made a request');
});

/* ─── Between the functions, read as served ───────────────────────────────
   Eugenia reads the poller and doji-tradingview over HTTP, and each side's
   own tests hand the other a fixture typed beside it — a rename of a key on
   one side passes both. So here her readers are served by the real handlers,
   each answering from its vendor stubbed below, and what she makes of every
   answer is asked: a key she reads that the door no longer serves is a
   sentence that it could not be read, a meter row, or a call scored on bars
   it never had. */

// The poller's broker: every chart's bars are the captured minutes. TradingView's
// calendar is its 1 October capture, and its reserves China's.
const TRENDBARS = readFileSync(new URL('./fixtures/ctrader-get-trendbars.txt', import.meta.url), 'utf8');
const CALENDAR = JSON.parse(readFileSync(new URL('./fixtures/tradingview-calendar.json', import.meta.url), 'utf8'));
const RESERVES = JSON.parse(readFileSync(new URL('./fixtures/tradingview-reserves.json', import.meta.url), 'utf8'));

// Daily or hourly bars ending now, at `price`.
const tvBars = (count, every, price) => {
  const now = Math.floor(Date.now() / 1000);
  return { success: true, bars: Array.from({ length: count }, (_, i) => {
    const c = price + i / 100;
    return { t: now - (count - i) * every, o: c, h: c + 1, l: c - 1, c, v: 1000 + i };
  }) };
};

// What TradingView answers each tool with, as the envelope's result.
function tradingViewAnswer(name, args) {
  if (name === 'mcp-tv-get-economic-calendar') return CALENDAR.result;
  if (name === 'mcp-tv-get-ohlcv') {
    const bars = args.symbol === 'COMEX:GC1!' ? tvBars(args.count, 86_400, 4000)
      : args.symbol.startsWith('CBOT:ZQ') ? tvBars(args.count, 86_400, 96.1)
      : tvBars(args.count, args.interval === '1D' ? 86_400 : 3600, 100);
    return { structuredContent: bars };
  }
  if (name === 'mcp-tv-get-news') {
    return { structuredContent: { success: true, data: { headlines: [{ id: `${args.symbol}:1`,
      published: Math.floor(Date.now() / 1000) - 3600, title: `A headline on ${args.symbol}`,
      provider: { name: 'Reuters' }, paywall: true }] } } };
  }
  if (name === 'mcp-tv-get-symbol-data-batch') {
    return { structuredContent: { data: { 'AMEX:GLD': { description: 'SPDR Gold Shares', aum: 141.3e9,
      'fund_flows.1M': 2.1e9 }, 'AMEX:IAU': { description: 'iShares Gold Trust', aum: 60e9 } }, missing: [] } };
  }
  return { structuredContent: RESERVES.CN };
}

test('every answer the poller and doji-tradingview serve Eugenia is one she reads', async () => {
  const poller = await serving('doji-mcp-sync');
  const tv = await serving('doji-tradingview');
  const eugenia = await import(`../supabase/functions/doji-eugenia/index.ts?wire=${n++}`);
  const stored = new Map(), runs = [], scored = [], filed = [];
  const made = new Date(Date.now() - 100 * 3600_000).toISOString();
  respond = async (url, init) => {
    const door = url.match(/^https:\/\/db\.test\/functions\/v1\/(doji-mcp-sync|doji-tradingview)\?/);
    if (door) return (door[1] === 'doji-mcp-sync' ? poller : tv)(new Request(url, { headers: init.headers }));
    if (url.startsWith('https://mcp.ctrader.com/') || url.startsWith('https://mcp.tradingview.com/')) {
      const body = JSON.parse(init.body);
      if (body.method === 'initialize') return new Response('{}', { headers: { 'mcp-session-id': 's' } });
      if (body.method !== 'tools/call') return new Response('', { status: 202 });
      if (url.includes('ctrader')) return new Response(TRENDBARS);
      const result = tradingViewAnswer(body.params.name, body.params.arguments);
      return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`);
    }
    if (url.includes('/rest/v1/tradingview_auth')) {
      return ok([{ id: 'current', access_token: 'A', expires_at: new Date(Date.now() + 3600_000).toISOString() }]);
    }
    if (url.includes('/rest/v1/eugenia_market')) {
      if (init.method === 'POST') { const row = JSON.parse(init.body); stored.set(row.door, row); return ok({}, 201); }
      const at = stored.get(url.match(/door=eq\.(\w+)/)[1]);
      return ok(at ? [at] : []);
    }
    if (url.includes('/rest/v1/eugenia_runs')) { runs.push(...JSON.parse(init.body)); return ok({}, 201); }
    if (url.includes('/rest/v1/eugenia_calendar')) { filed.push(...JSON.parse(init.body)); return ok({}, 201); }
    // A call made long before the poller's window of bars reaches back.
    if (url.includes('/rest/v1/eugenia_calls')) {
      if (init.method === 'PATCH') { scored.push(JSON.parse(init.body)); return ok([{}]); }
      return ok([{ id: 1, made_at: made, expires_at: new Date(Date.now() - 3600_000).toISOString(),
                   direction: 'buy', entry: 4370, stop: 4360, target: 4390, condition: 'a retest' }]);
    }
    return ok([]);
  };

  await Promise.all([eugenia.storeMarket(), eugenia.storeTrend(), eugenia.storeRates(), eugenia.storeStructure()]);
  assert.deepEqual([...stored.keys()].sort(), ['market', 'rates', 'structure', 'trend'],
    'a door answered and nothing she could keep came of it');
  const blocks = {
    around: await eugenia.aroundBlock(), rates: await eugenia.ratesBlock(), news: await eugenia.headlinesBlock(),
    volume: await eugenia.volumeBlock(), flows: await eugenia.flowsBlock(), structure: await eugenia.structureBlock(),
  };
  for (const [name, text] of Object.entries(blocks)) {
    assert.doesNotMatch(text, /could not be read/, `the ${name} door answered and she says it could not be read`);
  }
  assert.match(blocks.around, /Dollar index[\s\S]*The weeks behind it/);
  assert.match(blocks.news, /A headline on TVC:GOLD/);
  assert.match(blocks.volume, /contracts/);
  assert.match(blocks.flows, /China: \d+ t in/);
  assert.match(blocks.flows, /SPDR Gold Shares/);

  // The calendar's capture, filed around the day it was taken.
  const day = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(await eugenia.fileCalendar(day), filed.length);
  assert.ok(filed.length, 'the calendar door answered and nothing was filed');

  // The bars reach back thirty hours; a call made a hundred ago cannot be scored on them.
  await eugenia.scoreCalls();
  assert.deepEqual(scored.map(s => s.outcome), ['unread'],
    'a call made before the bars the poller served is scored as though they reached it');
  assert.deepEqual(runs.filter(r => !r.ok).map(r => r.detail), [], 'a read between the functions failed');
});
