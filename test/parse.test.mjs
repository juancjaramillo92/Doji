/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the email parser
   ───────────────────────────────────────────────────────────────────────────
   net_pnl is the only settled P&L in the system. computed_pnl is arithmetic
   over the deals and swap appears in none of them, so a position carried
   through the 17:00 New York rollover is only ever correct from the email —
   and if this parser mis-reads a label the fill returns null, the thread is
   labelled failed, it leaves the queue, and the trade keeps the computed figure
   forever with nothing anywhere reporting it. That is the case these cover.

   SAY THE LIMIT PLAINLY, BECAUSE IT IS THE WHOLE WEAKNESS OF THIS FILE. The
   bodies below are built to cTrader's shape, not saved from a real alert, so
   they prove the parser holds its RULES — the explicit Z, the position side,
   the label escaping, thousands separators, a margin notice declined — and they
   cannot prove it matches what cTrader actually sends. Only a real message can
   do that. ALERT is one string and replacing it with a saved body is the whole
   of that upgrade; do it the next time a fill lands.

   The rest of the script is genuinely out of reach: GmailApp needs a mailbox.
   What is reachable is the labelling, and the labelling is where a transient
   failure used to be recorded as permanent.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, thread, message } from './gs.mjs';

const SUBJECT = 'Your order has been filled for XAUUSD';

// cTrader's alerts are an HTML table, which is what the tag-stripping in
// parseAlert_ is for — the labels and their values sit in separate cells, so a
// fixture that ran them together as plain text would not exercise it.
const alert = (f = {}) => `
<html><head><style>.x{color:#fff}</style></head><body>
  <table>
    <tr><td>Position ID</td><td>${f.id ?? 'PID562780708'}</td></tr>
    <tr><td>Symbol</td><td>XAUUSD</td></tr>
    <tr><td>Direction</td><td>${f.direction ?? 'Sell'}</td></tr>
    <tr><td>Volume</td><td>2.00</td></tr>
    <tr><td>Fill time</td><td>${f.fillTime ?? '30/07/2026 14:29:00'} UTC</td></tr>
    <tr><td>Gross P&amp;L</td><td>${f.gross ?? '57.24'}</td></tr>
    <tr><td>Net P&amp;L</td><td>${f.net ?? '57.10'}</td></tr>
    <tr><td>Current balance</td><td>${f.balance ?? '10,057.10'}</td></tr>
  </table>
</body></html>`;

const ALERT = alert();

// Spread on the way out: the fill is built inside the vm context, so it carries
// that realm's Object.prototype and a strict deep-equal compares prototypes as
// well as contents. null is preserved — it is the parser's refusal, and turning
// it into an empty object would make every refusal test assert on the default.
const parse = (body = ALERT, subject = SUBJECT) => {
  const fill = boot().parseAlert_(subject, body);
  return fill && { ...fill };
};

/* ─── The fill ───────────────────────────────────────────────────────────── */

test('a closing alert parses to the five columns the email owns, and no others', () => {
  assert.deepEqual(parse(), {
    id: 'PID562780708',
    direction: 'SELL',
    fill_time: '2026-07-30T14:29:00Z',
    net_pnl: 57.10,
    balance: 10057.10,
  });
});

test('the fill time carries an explicit Z, because the email states UTC', () => {
  // WITHOUT THE Z the runtime reads the string in its own timezone, and an
  // evening fill lands on the wrong New York day — which is the bug this
  // suffix was added for. Asserted as an instant, not as a string, so the
  // check is about what it MEANS rather than how it is spelled.
  const { fill_time } = parse();
  assert.equal(fill_time.endsWith('Z'), true);
  assert.equal(Date.parse(fill_time), Date.UTC(2026, 6, 30, 14, 29, 0));
});

test('an ISO fill time is accepted as well as the slashed one', () => {
  assert.equal(parse(alert({ fillTime: '2026-07-30 14:29:00' })).fill_time,
    '2026-07-30T14:29:00Z');
});

test('direction is the position side, in either spelling', () => {
  assert.equal(parse(alert({ direction: 'Sell' })).direction, 'SELL');
  assert.equal(parse(alert({ direction: 'Buy'  })).direction, 'BUY');
  assert.equal(parse(alert({ direction: 'BUY'  })).direction, 'BUY');
});

test('a thousands separator does not truncate the balance', () => {
  // 10,057.10 read without stripping the comma gives 10 — a plausible number,
  // wrong by three orders of magnitude, and silent.
  assert.equal(parse(alert({ balance: '1,234,567.89' })).balance, 1234567.89);
});

test('a loss keeps its sign', () => {
  assert.equal(parse(alert({ net: '-38.42' })).net_pnl, -38.42);
});

test('Net P&L is read, not Gross', () => {
  // They differ by commission, and the column stores the settled figure. The
  // ampersand in both labels is also the reason the parser escapes them.
  assert.equal(parse(alert({ gross: '99.99', net: '57.10' })).net_pnl, 57.10);
});

/* ─── What it refuses ────────────────────────────────────────────────────── */

test('a body with no position id parses to nothing rather than to something', () => {
  assert.equal(parse('<html><body>Margin call warning. Your equity is low.</body></html>'), null);
});

test('a fill with no direction is refused, because nothing downstream could supply one', () => {
  assert.equal(parse(alert({ direction: 'n/a' })), null);
});

test('a fill with an unreadable time is refused rather than filed under today', () => {
  assert.equal(parse(alert({ fillTime: 'just now' })), null);
});

test('a missing P&L is absent, not zero', () => {
  // A body carrying no Net P&L line at all. null travels to the Edge Function,
  // which drops the key rather than writing it — zero would be a real figure
  // and would read as a scratch.
  const body = ALERT.replace(/<tr><td>Net P&amp;L<\/td>.*?<\/tr>/, '');
  assert.equal(parse(body).net_pnl, null);
});

/* ─── The three outcomes ─────────────────────────────────────────────────────
   The labelling is the part that can lose data. A PERMANENT failure earns the
   fail label and the thread leaves the queue; a TRANSIENT one must leave the
   thread UNLABELLED so the next run retries it. Treating them the same is how a
   momentary Supabase outage used to discard a fill's net_pnl forever.
   ─────────────────────────────────────────────────────────────────────────── */

const run = (responses) => {
  const t = thread([message(SUBJECT, ALERT)]);
  const gs = boot({ threads: [t], responses });
  gs.syncPepperstone();
  return { labels: t.labels, posted: gs.posted, log: gs.log };
};

test('a written fill is labelled synced', () => {
  const { labels, posted } = run([{ code: 200, text: '{"ok":true}' }]);
  assert.deepEqual(labels, ['doji-synced']);
  assert.equal(posted.length, 1);
});

test('a refused fill is permanent, so the thread leaves the queue', () => {
  // 400 is the function saying this will never be accepted. Retrying it every
  // minute for ninety days is the only alternative.
  const { labels } = run([{ code: 400, text: '{"error":"direction is not BUY or SELL"}' }]);
  assert.deepEqual(labels, ['doji-parse-failed']);
});

test('a server failure leaves the thread unlabelled, so the next run retries it', () => {
  const { labels } = run([{ code: 500, text: 'upstream' }]);
  assert.deepEqual(labels, [], 'a transient failure was recorded as permanent — the fill is lost');
});

test('a network failure with no response at all is also a retry', () => {
  const { labels } = run([new Error('DNS failure')]);
  assert.deepEqual(labels, []);
});

test('an unparseable body is permanent and the thread leaves the queue', () => {
  const t = thread([message(SUBJECT, '<html><body>nothing here</body></html>')]);
  const gs = boot({ threads: [t] });
  gs.syncPepperstone();
  assert.deepEqual(t.labels, ['doji-parse-failed']);
  assert.equal(gs.posted.length, 0, 'a body that did not parse was still sent');
});

test('a message that is not a fill is skipped without failing the thread', () => {
  const t = thread([message('Margin call warning', ALERT)]);
  const gs = boot({ threads: [t] });
  gs.syncPepperstone();
  assert.deepEqual(t.labels, ['doji-synced']);
  assert.equal(gs.posted.length, 0);
});

test('one bad message in a thread does not discard the good one', () => {
  // Both are sent; the thread is labelled failed so the parse failure is
  // visible, and the fill that DID parse has already been written.
  const t = thread([
    message(SUBJECT, ALERT),
    message(SUBJECT, '<html><body>unreadable</body></html>'),
  ]);
  const gs = boot({ threads: [t] });
  gs.syncPepperstone();
  assert.equal(gs.posted.length, 1);
  assert.deepEqual(t.labels, ['doji-parse-failed']);
});

/* ─── What leaves this machine ───────────────────────────────────────────── */

test('the request carries the secret on the header the function checks', () => {
  const { posted } = run([{ code: 200 }]);
  assert.equal(posted[0].options.headers['x-doji-key'], 'test-secret');
  assert.equal(posted[0].url.endsWith('/functions/v1/doji-email-sync'), true);
});

test('no account credential is anywhere in the script', () => {
  // The password is the finding this file exists to keep closed. A sign-in path
  // reappearing here would put the whole account back into Google's
  // infrastructure to save one hop.
  const gs = boot();
  for (const gone of ['DOJI_PASSWORD', 'DOJI_EMAIL', 'sb_access_token', 'signInWithPassword']) {
    assert.equal(gs.PropertiesService.getScriptProperties().getProperty(gone), null);
  }
  for (const gone of ['getAccessToken_', 'authRequest_', 'clearSession_']) {
    assert.equal(gs[gone], undefined, `${gone} is back`);
  }
});
