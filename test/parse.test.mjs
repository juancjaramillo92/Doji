/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the email parser
   ───────────────────────────────────────────────────────────────────────────
   net_pnl is the only settled P&L in the system. computed_pnl is arithmetic
   over the deals and swap appears in none of them, so a position carried
   through the 17:00 New York rollover is only ever correct from the email —
   and if this parser mis-reads a label the fill returns null, the thread is
   labelled failed, it leaves the queue, and the trade keeps the computed figure
   forever with nothing anywhere reporting it. That is the case these cover.

   THE ANCHOR IS A REAL MESSAGE. `fixtures/ctrader-stop-loss-filled.html` is the
   body of an actual Pepperstone alert, decoded from quoted-printable exactly as
   GmailApp hands it over, for a fill that is in the database — PID577885869,
   SELL, -108.40, balance 385.73. Every field the parser claims is checked
   against what the broker actually sent, not against a shape anyone guessed at.

   That mattered. The fixture this replaced was written to the alert's shape and
   got two things wrong that no assertion could have caught: money arrives as
   `USD -108.40`, with a currency prefix, and the fill time as
   `19/08/2026 20:22:55 (UTC)`, with the zone in brackets. Both parse correctly —
   but nothing was testing that they did.

   WHAT IS STILL SYNTHETIC, and it is unavoidable: the variants. A buy, a
   thousands separator, a missing P&L, an unreadable time — none of those exist
   as saved messages, so `alert()` builds them in the real message's shape. The
   last test in the first section holds that builder against the real body, so a
   variant cannot quietly stop resembling what cTrader sends.

   The rest of the script is out of reach: GmailApp needs a mailbox. What is
   reachable is the labelling, and the labelling is where a transient failure
   used to be recorded as permanent.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, thread, message, SOURCE } from './gs.mjs';

// The real subject line, which is also what syncPepperstone matches on: a stop
// loss says "Stop loss filled for", not "order has been filled".
const SUBJECT = '[cTrader live account] Stop loss filled for XAUUSD';

const ALERT = readFileSync(new URL('./fixtures/ctrader-stop-loss-filled.html', import.meta.url), 'utf8');

/* A variant, in the real message's shape. Label and value sit in SEPARATE <p>
   elements, which is what the tag-stripping in parseAlert_ exists for — a
   fixture that ran them together on one line would not exercise it. The USD
   prefix and the bracketed zone are cTrader's, not decoration. */
const field = (label, value) =>
  `<p style="font-size: 13px;">\n                ${label}            </p>\n` +
  `            <p style="font-size: 16px; font-weight: 600;">\n                ${value}\n            </p>\n` +
  `            <hr style="border-top: 1px solid #eaeaea;">`;

const alert = (f = {}) => `
<html><head><style>.x{color:#fff}</style></head><body>
  <table><tr><td>
    ${field('Account', '1351729 (Live)')}
    ${field('Symbol', 'XAUUSD')}
    ${field('Direction', f.direction ?? 'SELL')}
    ${field('Fill time', f.fillTime ?? '19/08/2026 20:22:55 (UTC)')}
    ${field('Fill price', '4512.80')}
    ${field('Volume', 'Oz 4.00')}
    ${field('Position ID', f.id ?? 'PID577885869')}
    ${field('Gross P&amp;L', f.gross ?? 'USD -108.12')}
    ${field('Net P&amp;L', f.net ?? 'USD -108.40')}
    ${field('Current balance', f.balance ?? 'USD 385.73')}
  </td></tr></table>
</body></html>`;

// Spread on the way out: the fill is built inside the vm context, so it carries
// that realm's Object.prototype and a strict deep-equal compares prototypes as
// well as contents. null is preserved — it is the parser's refusal, and turning
// it into an empty object would make every refusal test assert on the default.
const parse = (body = ALERT, subject = SUBJECT) => {
  const fill = boot().parseAlert_(subject, body);
  return fill && { ...fill };
};

/* ─── The fill ───────────────────────────────────────────────────────────── */

test('the real alert parses to the five columns the email owns, and no others', () => {
  // These five values are the row in the database: PID577885869. If this
  // assertion and that row ever disagree, one of them is wrong about a fill
  // that actually happened.
  assert.deepEqual(parse(), {
    id: 'PID577885869',
    direction: 'SELL',
    fill_time: '2026-08-19T20:22:55Z',
    net_pnl: -108.40,
    balance: 385.73,
  });
});

test('the money figures survive their currency prefix', () => {
  // `USD -108.40`, not `-108.40`. The old fixture omitted the prefix, so
  // nothing proved the parser could see past it.
  const { net_pnl, balance } = parse();
  assert.equal(net_pnl, -108.40);
  assert.equal(balance, 385.73);
});

test('the built variants still look like the real message', () => {
  // The one guard on the synthetic half: parse the real body and a variant
  // built to match it, and require the same five keys with the same types. A
  // builder that drifts from what cTrader sends makes every variant below a
  // test of nothing.
  const real = parse();
  const built = parse(alert());
  assert.deepEqual(Object.keys(built).sort(), Object.keys(real).sort());
  for (const k of Object.keys(real)) {
    assert.equal(typeof built[k], typeof real[k], k);
  }
  assert.deepEqual(built, real, 'the builder no longer reproduces the real fill');
});

test('the fill time carries an explicit Z, because the email states UTC', () => {
  // WITHOUT THE Z the runtime reads the string in its own timezone, and an
  // evening fill lands on the wrong New York day — which is the bug this
  // suffix was added for. Asserted as an instant, not as a string, so the
  // check is about what it MEANS rather than how it is spelled.
  const { fill_time } = parse();
  assert.equal(fill_time.endsWith('Z'), true);
  assert.equal(Date.parse(fill_time), Date.UTC(2026, 7, 19, 20, 22, 55));
});

test('an ISO fill time is accepted as well as the slashed one', () => {
  assert.equal(parse(alert({ fillTime: '2026-07-30 14:29:00 (UTC)' })).fill_time,
    '2026-07-30T14:29:00Z');
});

test('direction is the position side, in either spelling', () => {
  // The real message sends it upper case; the others are cheap insurance
  // against cTrader changing its mind about capitalisation.
  assert.equal(parse(alert({ direction: 'SELL' })).direction, 'SELL');
  assert.equal(parse(alert({ direction: 'Sell' })).direction, 'SELL');
  assert.equal(parse(alert({ direction: 'BUY'  })).direction, 'BUY');
  assert.equal(parse(alert({ direction: 'Buy'  })).direction, 'BUY');
});

test('a thousands separator does not truncate the balance', () => {
  // This account has not crossed 1,000 yet, so the real message carries no
  // comma and cannot cover it. Read without stripping, `USD 1,234,567.89`
  // gives 1 — a plausible number, wrong by six orders of magnitude, silent.
  assert.equal(parse(alert({ balance: 'USD 1,234,567.89' })).balance, 1234567.89);
});

test('a win keeps its sign too', () => {
  // The real message is a loss, so the positive case is the one that needs
  // building.
  assert.equal(parse(alert({ net: 'USD 57.10' })).net_pnl, 57.10);
});

test('Net P&L is read, not Gross', () => {
  // In the real message they are -108.12 and -108.40, and only the second is
  // settled. The ampersand in both labels is why the parser escapes them.
  assert.equal(parse().net_pnl, -108.40);
  assert.equal(parse(alert({ gross: 'USD 99.99', net: 'USD 57.10' })).net_pnl, 57.10);
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
  // The real body with its Net P&L value blanked. null travels to the Edge
  // Function, which drops the key rather than writing it — zero would be a real
  // figure and would read as a scratch.
  const body = ALERT.replace('USD -108.40', '');
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
  // syncPepperstone matches /filled for/i on the SUBJECT, which the real one
  // satisfies as "Stop loss filled for XAUUSD".
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
  /* THE PASSWORD IS THE FINDING THIS KEEPS CLOSED, and the first version of
     this test could not have caught it coming back: it asked the stub for
     DOJI_PASSWORD, and the stub returns null for every key it does not know
     regardless of what the script reads. It asserted the harness, not the file.

     So this reads the source. A sign-in path reappearing here would put the
     whole account back into Google's infrastructure to save one network hop. */
  // Word-bounded, because DOJI_EMAIL is a prefix of DOJI_EMAIL_SECRET and a
  // plain substring test fails on the one credential the script is allowed.
  for (const gone of ['DOJI_PASSWORD', 'DOJI_EMAIL', 'signInWithPassword',
                      'auth', 'grant_type', 'refresh_token',
                      'sb_access_token', 'PUBLISHABLE_KEY']) {
    assert.match(SOURCE, new RegExp(`^(?!.*\\b${gone}\\b)`, 's'),
      `${gone} is back in doji_gmail_sync.gs`);
  }

  // And that the helpers are gone from the evaluated file, not just its text.
  const gs = boot();
  for (const gone of ['getAccessToken_', 'authRequest_', 'clearSession_', 'creds_']) {
    assert.equal(gs[gone], undefined, `${gone} is back`);
  }

  // The one secret it may hold, so the test fails if the script stops needing
  // any credential at all — which would mean the write moved back inline.
  assert.equal(SOURCE.includes('DOJI_EMAIL_SECRET'), true);
});
