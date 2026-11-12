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
  EUGENIA_LAPTOP_SECRET: 'laptop', STT_URL: 'https://stt.test/v1/audio/transcriptions',
  STT_KEY: 'stt', TTS_KEY: 'tts', GLADYS_LAPTOP_SECRET: 'gladys-laptop',
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

/* ─── The laptop: one request, answered at once, her voice after it ────────
   Through the real door and the real turn — the transcription, the reads, the
   model, the gate, the speech, the copy and the write — each answered by URL,
   and what comes back read to its end. A form for a body: the recording under
   the name and type the laptop gave it, and the TradingView window beside his
   words when he shows it. */

const PCM = [1, 2, 3, 4];
const laptopTurn = (said, answer) => (url, init) => {
  if (url.startsWith('https://stt.test/')) return ok({ text: said });
  if (url.startsWith('https://api.anthropic.com/')) {
    return ok({ model: JSON.parse(init.body).model, stop_reason: 'end_turn',
                usage: { input_tokens: 10, output_tokens: 5 },
                content: [{ type: 'text', text: answer }] });
  }
  if (url.includes('/audio/speech')) return Promise.resolve(new Response(new Uint8Array(PCM)));
  if (url.startsWith('https://api.telegram.org/')) return ok({ ok: true });
  if (url.startsWith('https://db.test/rest/v1/')) return ok([]);
  return Promise.reject(new Error(`the laptop asked something unexpected: ${url}`));
};
const bodies = (part) => calls.filter(c => c.url.includes(part)).map(c => JSON.parse(c.body));
const laptopForm = (voice, chart) => {
  const form = new FormData();
  if (voice) form.append('voice', voice, 'laptop.webm');
  if (chart) form.append('chart', chart, 'chart.png');
  return form;
};
const laptop = (body, key = 'laptop', path = '') =>
  new Request(`https://fn.test/functions/v1/doji-eugenia${path}`,
    { method: body === undefined ? 'GET' : 'POST', body, headers: { 'x-laptop-key': key } });
const webm = new Blob([new Uint8Array(64)], { type: 'audio/webm' });
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

/* What the laptop is sent, read as its framer reads it: a kind byte, three
   bytes of length, that many bytes, to the last byte. A frame that overran
   the end or a stray byte after the last is a stream it cannot follow. */
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

test('doji-eugenia: the laptop is answered at once, hears her answer, and Telegram gets the copy', async () => {
  const serve = await serving('doji-eugenia');
  respond = laptopTurn('how is gold doing', 'Gold is holding 4,410.');
  const res = await serve(laptop(laptopForm(webm)));
  assert.equal(res.status, 200);
  assert.equal(kept.length, 1, 'the turn was not handed to EdgeRuntime.waitUntil, so a laptop that hangs up kills it');

  const frames = await framesOf(res);
  await Promise.all(kept);
  assert.deepEqual([...new Set(frames.map(f => f.kind))], [0], 'a frame other than her voice was sent');
  const played = voiceOf(frames);
  assert.ok(played.length > PCM.length, 'nothing was on the wire while she thought');
  assert.ok(played.slice(0, -PCM.length).every(b => b === 0),
    'what played before her answer was not silence');
  assert.deepEqual(played.slice(-PCM.length), PCM, 'her answer is not what the laptop played');

  const file = calls.find(c => c.url.startsWith('https://stt.test/')).body.get('file');
  assert.deepEqual([file.name, file.type], ['laptop.webm', 'audio/webm'],
    'the recording was handed to transcription as something other than what the laptop sent');
  assert.equal(typeof bodies('api.anthropic.com/v1/messages')[0].messages.at(-1).content, 'string',
    'her turn carried an image he never showed her');
  assert.deepEqual(bodies('/audio/speech').map(b => [b.input, b.response_format]),
    [['Gold is holding 4,410.', 'pcm']],
    'the laptop was read something other than the gated answer, or in a format it cannot play');
  assert.deepEqual(bodies('/sendMessage').map(b => b.text), ['«how is gold doing»\n\nGold is holding 4,410.'],
    'Telegram did not get the copy, his words first');
  assert.deepEqual(calls.filter(c => c.url.endsWith('/rest/v1/eugenia_turns')).map(c => JSON.parse(c.body)),
    [[{ role: 'user', content: '[voice note] how is gold doing' },
      { role: 'assistant', content: 'Gold is holding 4,410.' }]],
    'the exchange was not stored as one conversation with Telegram');
});

test('doji-eugenia: the laptop sees the chart he shows her, and its copy names it', async () => {
  const serve = await serving('doji-eugenia');
  respond = laptopTurn('what do you make of this', 'A clean break of the Asian high.');
  await framesOf(await serve(laptop(laptopForm(webm, png))));
  await Promise.all(kept);
  const turn = bodies('api.anthropic.com/v1/messages')[0].messages.at(-1);
  assert.deepEqual(turn.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } },
    'the chart did not reach her turn as the image he showed her');
  assert.deepEqual(bodies('/sendMessage').map(b => b.text),
    ['«what do you make of this» — with your chart\n\nA clean break of the Asian high.'],
    'Telegram did not get the copy, his words first and the chart named');
  assert.deepEqual(calls.filter(c => c.url.endsWith('/rest/v1/eugenia_turns')).map(c => JSON.parse(c.body)),
    [[{ role: 'user', content: '[voice note] what do you make of this' },
      { role: 'assistant', content: 'A clean break of the Asian high.' }]],
    'the exchange was not stored as one conversation, or the chart was stored with it');
});

test('doji-eugenia: a long answer reaches the laptop whole, every part in order', async () => {
  // Two paragraphs past the vendor's input limit together: two readings, joined.
  const long = `${'Gold held. '.repeat(250).trim()}\n\n${'Then it gave way. '.repeat(150).trim()}`;
  const serve = await serving('doji-eugenia');
  respond = laptopTurn('tell me everything', long);
  const played = voiceOf(await framesOf(await serve(laptop(laptopForm(webm)))));
  await Promise.all(kept);
  const read = bodies('/audio/speech').map(b => b.input);
  assert.equal(read.length, 2, `the answer was read in ${read.length} parts`);
  assert.equal(read.join('\n\n'), long, 'what was read is not the whole answer, in order');
  assert.deepEqual(played.slice(-2 * PCM.length), [...PCM, ...PCM], 'the laptop did not play every part');
});

test('doji-eugenia: a recording with no words is answered on the laptop, and nothing else happens', async () => {
  const serve = await serving('doji-eugenia');
  respond = laptopTurn('', 'never asked');
  const res = await serve(laptop(laptopForm(webm)));
  await res.arrayBuffer();
  await Promise.all(kept);
  assert.match(bodies('/audio/speech')[0]?.input ?? '', /could not make out any words/,
    'the laptop was not told it could not be heard');
  for (const asked of ['api.anthropic.com', 'api.telegram.org', 'eugenia_turns']) {
    assert.ok(!calls.some(c => c.url.includes(asked)), `a recording with no words reached ${asked}`);
  }
});

test('doji-eugenia: the laptop is refused at the door without its vendors, a recording or a chart she can read', async () => {
  for (const unset of ['STT_URL', 'STT_KEY', 'TTS_KEY']) {
    calls.length = 0;
    const serve = await serving('doji-eugenia', [unset]);
    const res = await answer(await serve(laptop(laptopForm(webm))));
    assert.equal(res.status, 503, `the laptop was let in with ${unset} unset`);
    assert.deepEqual(calls, [], `the laptop made a request with ${unset} unset`);
  }
  const serve = await serving('doji-eugenia');
  const big = new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: 'image/png' });
  for (const [what, body] of [
    ['no recording', laptopForm(null, png)],
    ['an empty recording', laptopForm(new Blob([], { type: 'audio/webm' }))],
    ['a recording past FILE_MAX', laptopForm(new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: 'audio/webm' }))],
    ['a chart that is not an image she reads', laptopForm(webm, new Blob([new Uint8Array(4)], { type: 'image/heic' }))],
    ['a chart past FILE_MAX', laptopForm(webm, big)],
    ['a body that is not a form', new Uint8Array(64)],
  ]) {
    calls.length = 0;
    assert.equal((await serve(laptop(body))).status, 400, `${what} was let in`);
    assert.deepEqual(calls, [], `${what} made a request`);
  }
  assert.equal((await serve(laptop(laptopForm(webm), 'wrong'))).status, 401, 'the laptop door admitted a wrong key');
});

test('doji-eugenia: the laptop\'s door is shut while its secret is unset', async () => {
  const serve = await serving('doji-eugenia', ['EUGENIA_LAPTOP_SECRET']);
  for (const key of ['', 'laptop']) {
    calls.length = 0;
    assert.equal((await serve(laptop(laptopForm(webm), key))).status, 401,
      `the laptop door opened to ${JSON.stringify(key)} with no secret set`);
    assert.deepEqual(calls, [], 'a shut laptop door made a request');
  }
});

/* ─── The briefing on the laptop ──────────────────────────────────────────
   The laptop asks every few minutes whether the briefing waits, then asks for
   the briefing itself when he does. Both read today's stored briefing by its
   marker, as the speaking worker does, and whether he has heard it: `heard`
   is when that was, if ever. */

const briefingStored = (content, heard = null) => (url, init) => {
  if (url.includes('/rest/v1/eugenia_turns?select=created_at')) {
    return ok(content === null ? [] : [{ created_at: new Date().toISOString() }]);
  }
  if (url.includes('/rest/v1/eugenia_turns?select=content')) return ok([{ content }]);
  if (url.includes('/rest/v1/eugenia_runs?select=at')) return ok(heard ? [{ at: heard }] : []);
  if (url.endsWith('/rest/v1/eugenia_runs') && init?.method === 'POST') return ok([]);
  if (url.includes('/audio/speech')) return Promise.resolve(new Response(new Uint8Array(PCM)));
  return Promise.reject(new Error(`the briefing door asked something unexpected: ${url}`));
};
// The runs filed, by caller — a heard briefing is one.
const filed = () => calls.filter(c => c.method === 'POST' && c.url.endsWith('/rest/v1/eugenia_runs'))
  .map(c => JSON.parse(c.body)[0].caller);
const briefingDoor = (which) => laptop(undefined, 'laptop', `?briefing=${which}`);

test('doji-eugenia: the laptop hears the briefing, and it is heard once spoken to its end', async () => {
  const serve = await serving('doji-eugenia');
  respond = briefingStored('Gold opened quiet.');
  const res = await serve(briefingDoor('today'));
  assert.equal(res.status, 200, '?briefing=today did not answer with audio');
  assert.deepEqual(voiceOf(await framesOf(res)).slice(-PCM.length), PCM);
  assert.deepEqual(bodies('/audio/speech').map(b => [b.input, b.response_format]), [['Gold opened quiet.', 'pcm']],
    '?briefing=today read the laptop something other than the stored briefing');
  // Sunday's briefing on a Sunday in New York, the weekday one otherwise.
  const sunday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
    .format(new Date()) === 'Sun';
  const marker = calls.find(c => c.url.includes('select=created_at')).url;
  assert.ok(marker.includes(encodeURIComponent(`[${sunday ? 'sunday' : 'weekday'} briefing]`)),
    `the laptop looked for the wrong briefing today: ${marker}`);
  assert.deepEqual(filed(), [`${sunday ? 'sunday' : 'weekday'} briefing heard`], 'the briefing spoken to its end was not marked heard');
});

/* Today's heard answers every question as though none were stored, and
   speaks nothing; yesterday's does not. The question that has no voice
   answers 200 while one waits. A briefing whose speech broke off is not
   heard. */
test('doji-eugenia: a briefing heard is gone, and only one heard whole', async () => {
  const serve = await serving('doji-eugenia');
  respond = briefingStored('Gold opened quiet.', new Date().toISOString());
  for (const which of ['today', 'waits']) {
    calls.length = 0;
    assert.equal((await serve(briefingDoor(which))).status, 204, `?briefing=${which} answered a briefing already heard`);
    assert.ok(!calls.some(c => c.url.includes('/audio/speech')), `?briefing=${which} spoke a briefing already heard`);
  }

  respond = briefingStored('Gold opened quiet.', new Date(Date.now() - 86_400_000).toISOString());
  calls.length = 0;
  const waits = await serve(briefingDoor('waits'));
  assert.equal(waits.status, 200, 'a briefing heard yesterday kept today\'s from waiting');
  assert.equal((await waits.arrayBuffer()).byteLength, 0, '?briefing=waits answered with something to play');
  assert.ok(!calls.some(c => c.url.includes('/audio/speech')), '?briefing=waits spoke');

  const stored = briefingStored('Gold opened quiet.');
  respond = (url, init) => url.includes('/audio/speech') ? Promise.resolve(new Response('busy', { status: 503 })) : stored(url, init);
  calls.length = 0;
  await framesOf(await serve(briefingDoor('today')));
  assert.deepEqual(filed(), [], 'a briefing whose speech broke off was marked heard');
});

test('doji-eugenia: a briefing not stored yet is a 204, and nothing is spoken', async () => {
  const serve = await serving('doji-eugenia');
  respond = briefingStored(null);
  for (const which of ['today', 'waits']) {
    calls.length = 0;
    const res = await serve(briefingDoor(which));
    assert.equal(res.status, 204, `?briefing=${which} answered ${res.status} with no briefing stored`);
    assert.ok(!calls.some(c => c.url.includes('/audio/speech')), 'a briefing that is not there was spoken');
  }
  calls.length = 0;
  assert.equal((await serve(briefingDoor('yesterday'))).status, 400, 'a briefing door it does not open answered');
  assert.deepEqual(calls, [], 'a briefing door it does not open made a request');
});

/* The next print is its instant and nothing more: the nearest release ahead
   that is rated high at home, or a 204 while the calendar holds none. */
test('doji-eugenia: the laptop is told when the next print lands, and nothing else', async () => {
  const serve = await serving('doji-eugenia');
  const at = new Date(Date.now() + 600_000).toISOString();
  respond = (url) => url.includes('/rest/v1/eugenia_calendar?') ? ok([{ at }])
    : Promise.reject(new Error(`the print door asked something unexpected: ${url}`));
  const res = await answer(await serve(laptop(undefined, 'laptop', '?print=next')));
  assert.deepEqual(res, { status: 200, body: { ok: true, at } });
  assert.equal(calls.length, 1, 'the print door read more than the calendar');
  const read = decodeURIComponent(calls[0].url);
  for (const part of ['select=at&', 'importance=eq.high', 'country=eq.US', 'order=at.asc', 'limit=1']) {
    assert.ok(read.includes(part), `the next print is no longer read with ${part}: ${read}`);
  }
  const from = Date.now() - new Date(read.match(/at=gte\.([^&]+)/)[1]);
  assert.ok(from >= 0 && from < 60_000, `the next print is looked for from ${from} ms ago, not from now`);

  respond = () => ok([]);
  assert.equal((await serve(laptop(undefined, 'laptop', '?print=next'))).status, 204, 'a calendar with nothing ahead did not answer 204');
  calls.length = 0;
  assert.equal((await serve(laptop(undefined, 'laptop', '?print=last'))).status, 400, 'a print door it does not open answered');
  assert.deepEqual(calls, [], 'a print door it does not open made a request');
});

/* ─── Gladys's laptop: what waits, and an answer given on it ──────────────
   What waits is read oldest first from a newest-first page; an answer is a
   tap's own grammar, so it can only ever write one of the four columns. */

const trade = (id, hoursAgo, fields = {}) => ({
  id, direction: 'BUY', entry_price: 4412.5,
  entry_time: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  setup: null, followed_rules: null, followed_sl: null, followed_tp: null, ...fields,
});
const gladysLaptop = (init = {}, key = 'gladys-laptop') => new Request('https://fn.test/functions/v1/doji-gladys',
  { method: 'GET', ...init, headers: { 'x-laptop-key': key } });

test('doji-gladys: the laptop is told what waits, oldest first, a week back at most', async () => {
  const serve = await serving('doji-gladys');
  let held = [];
  respond = (url) => url.includes('exit_price=is.null') ? ok(held)
    : url.includes('/rest/v1/trades?') ? ok([trade('PID2', 1), trade('PID1', 30)]) : pending();
  const res = await answer(await serve(gladysLaptop()));
  assert.equal(res.status, 200);
  assert.equal(res.body.waiting, 2);
  assert.equal(res.body.trade.id, 'PID1', 'the laptop was handed the newer trade first');
  assert.equal(res.body.open, false, 'with no trade open, the laptop was told he is in one');
  held = [{ id: 'PID2' }];
  assert.equal((await answer(await serve(gladysLaptop()))).body.open, true, 'with a trade open, the laptop was not told');
  const asked = decodeURIComponent(calls.find(c => c.url.includes('exit_price')).url);
  for (const part of ['deleted=is.false', 'exit_price=is.null', 'fill_time=is.null', 'limit=1']) {
    assert.ok(asked.includes(part), `whether he is in a trade is no longer read with ${part}: ${asked}`);
  }
  const read = decodeURIComponent(calls.find(c => c.url.includes('or=(')).url);
  for (const part of ['deleted=is.false', 'entry_time=gte.', 'order=entry_time.desc', 'limit=20',
                      'or=(setup.is.null,followed_rules.is.null,followed_sl.is.null,followed_tp.is.null)']) {
    assert.ok(read.includes(part), `what waits is no longer read with ${part}: ${read}`);
  }
  const since = new Date(read.match(/entry_time=gte\.([^&]+)/)[1]);
  const days = (Date.now() - since) / 86_400_000;
  assert.ok(days > 6.9 && days < 7.1, `what waits reaches back ${days.toFixed(2)} days, not a week`);
});

test('doji-gladys: an answer from the laptop writes its one column, then says what waits', async () => {
  const serve = await serving('doji-gladys');
  respond = (url, init) => {
    if (init.method === 'PATCH') return ok([trade('PID1', 30, JSON.parse(init.body))]);
    if (url.includes('/rest/v1/trades?')) return ok([]);
    return pending();
  };
  const res = await answer(await serve(gladysLaptop({ method: 'POST', body: JSON.stringify({ data: 'PID1|sl|1' }) })));
  assert.deepEqual(res, { status: 200, body: { ok: true, waiting: 0, trade: null, open: false } });
  const writes = calls.filter(c => c.method === 'PATCH');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].url.includes('trades?id=eq.PID1'), writes[0].url);
  assert.deepEqual(JSON.parse(writes[0].body), { followed_sl: true }, 'the laptop wrote more than its one answer');
});

test('doji-gladys: the laptop cannot write anything but an answer, and is shut without its key', async () => {
  const serve = await serving('doji-gladys');
  for (const body of [JSON.stringify({ data: 'PID1|edit' }), JSON.stringify({ data: 'PID1|exit_price|1' }),
                      JSON.stringify({ data: 'PID1|setup|Scalp' }), JSON.stringify({ data: 'PID1|rules|yes' }),
                      'not json']) {
    calls.length = 0;
    const res = await answer(await serve(gladysLaptop({ method: 'POST', body })));
    assert.equal(res.status, 400, `the laptop's ${body} was accepted`);
    assert.deepEqual(calls, [], `the laptop's ${body} made a request`);
  }
  calls.length = 0;
  assert.equal((await serve(gladysLaptop({}, 'wrong'))).status, 401, 'the laptop door admitted a wrong key');
  const shut = await serving('doji-gladys', ['GLADYS_LAPTOP_SECRET']);
  for (const key of ['', 'gladys-laptop']) {
    assert.equal((await shut(gladysLaptop({}, key))).status, 401, `the laptop door opened to ${JSON.stringify(key)} with its secret unset`);
  }
  assert.deepEqual(calls, [], 'a refused laptop made a request');
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
// His alerts, as the list answered on 29 October with two set.
const ALERTS = JSON.parse(readFileSync(new URL('./fixtures/tradingview-alerts.json', import.meta.url), 'utf8'));

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
  if (name === 'mcp-tv-list-alerts') return ALERTS.result;
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

/* The replay door is read by a script rather than by her, and the script folds
   it with her own folds: a key renamed at the door is a map she cannot read or
   a call scored on no bars, and neither reaches a test that types the answer. */
test('the replay door serves the script a map and a session it can score', async () => {
  const poller = await serving('doji-mcp-sync');
  const { request: asked, replayed } = await import('../scripts/replay.mjs');
  respond = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'initialize') return new Response('{}', { headers: { 'mcp-session-id': 's' } });
    if (body.method !== 'tools/call') return new Response('', { status: 202 });
    return new Response(TRENDBARS);
  };
  const res = await poller(new Request('https://fn.test/functions/v1/doji-mcp-sync?replay=1', { headers: { 'x-doji-key': 'cron' } }));
  assert.equal(res.status, 200);
  const served = await res.json();
  assert.ok(served.bars.length, 'the door served the session no minute bars');
  assert.match(asked(served).messages[0].content, /This is YOUR map/, 'the map the script folds from the door is no map');
  const r = replayed({ call: true, direction: 'buy', entry: 4000, stop: 3985, target: 4030, confirm: 'market', why: 'x' }, served);
  assert.ok(r.call && !['refused', 'none', 'unread'].includes(r.outcome),
    `the script scored the served session as "${r.outcome}", as though the door served no bars from its hour`);
  const bad = await poller(new Request('https://fn.test/functions/v1/doji-mcp-sync?replay=0', { headers: { 'x-doji-key': 'cron' } }));
  assert.equal(bad.status, 400, 'a replay of no day was read as a default');
});

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

  await Promise.all([eugenia.storeMarket(), eugenia.storeTrend(), eugenia.storeRates(), eugenia.storeStructure(),
                     eugenia.storeFlows()]);
  assert.deepEqual([...stored.keys()].sort(), ['flows', 'market', 'rates', 'structure', 'trend'],
    'a door answered and nothing she could keep came of it');
  const blocks = {
    around: await eugenia.aroundBlock(), rates: await eugenia.ratesBlock(), news: await eugenia.headlinesBlock(),
    volume: await eugenia.volumeBlock(), flows: await eugenia.flowsBlock(), structure: await eugenia.structureBlock(),
    alerts: await eugenia.alertsBlock(),
  };
  for (const [name, text] of Object.entries(blocks)) {
    assert.doesNotMatch(text, /could not be read/, `the ${name} door answered and she says it could not be read`);
  }
  assert.match(blocks.around, /Dollar index[\s\S]*The weeks behind it/);
  assert.match(blocks.alerts, /· 4078\.55 on PEPPERSTONE:XAUUSD, cross, set [^\n]*not fired yet\n· 4026\.34 /,
    'his alerts were served and she does not read his levels off them, highest first');
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
