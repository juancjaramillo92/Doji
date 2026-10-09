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
import { readdirSync } from 'node:fs';

const USER = '00000000-0000-0000-0000-000000000001';
const ENV = {
  SUPABASE_URL: 'https://db.test', SB_SECRET_KEY: 'sb_secret_test', DOJI_USER_ID: USER,
  DOJI_CRON_SECRET: 'cron', DOJI_EMAIL_SECRET: 'mail', TELEGRAM_CHAT_ID: '42',
  GLADYS_BOT_TOKEN: 'gladys', GLADYS_WEBHOOK_SECRET: 'gladys-hook',
  EUGENIA_BOT_TOKEN: 'eugenia', EUGENIA_WEBHOOK_SECRET: 'eugenia-hook',
  ANTHROPIC_API_KEY: 'sk-ant-test', CTRADER_MCP_TOKEN: 'ctrader',
  EUGENIA_CHARM_SECRET: 'charm', STT_URL: 'https://stt.test/v1/audio/transcriptions',
  STT_KEY: 'stt', TTS_KEY: 'tts',
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
const charm = (body) => request('doji-eugenia', { header: 'x-charm-key', key: 'charm', body });
const bodies = (part) => calls.filter(c => c.url.includes(part)).map(c => JSON.parse(c.body));

test('doji-eugenia: the charm is answered at once, hears her answer, and Telegram gets the copy', async () => {
  const serve = await serving('doji-eugenia');
  respond = charmTurn('how is gold doing', 'Gold is holding 4,410.');
  const res = await serve(charm(new Uint8Array(64)));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/pcm');
  assert.equal(kept.length, 1, 'the turn was not handed to EdgeRuntime.waitUntil, so a charm that hangs up kills it');

  const played = [...new Uint8Array(await res.arrayBuffer())];
  await Promise.all(kept);
  assert.ok(played.length > PCM.length, 'nothing was on the wire while she thought');
  assert.ok(played.slice(0, -PCM.length).every(b => b === 0),
    'what played before her answer was not silence');
  assert.deepEqual(played.slice(-PCM.length), PCM, 'her answer is not what the charm played');

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
  const played = [...new Uint8Array(await (await serve(charm(new Uint8Array(64)))).arrayBuffer())];
  await Promise.all(kept);
  const read = bodies('/audio/speech').map(b => b.input);
  assert.equal(read.length, 2, `the answer was read in ${read.length} parts`);
  assert.equal(read.join('\n\n'), long, 'what was read is not the whole answer, in order');
  assert.deepEqual(played.slice(-2 * PCM.length), [...PCM, ...PCM], 'the charm did not play every part');
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
