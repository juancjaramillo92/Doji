/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — Edge Function tests
   ───────────────────────────────────────────────────────────────────────────
   Covers the pure exports of all four Edge Functions — doji-mcp-sync,
   doji-email-sync, doji-gladys and doji-eugenia — and the primitives in
   _shared they are built from. Each guards every Deno touch behind env() and
   Deno?.serve, so importing them under plain Node runs nothing — that guard
   exists for this file and nothing else, which is why it is exercised by the
   mere fact that these imports work.

   Run:  npm test

   WHAT IS NOT COVERED, said plainly: mcpInit, mcpCall, upsert and writeBalance
   all reach the network on their first line and are not exported. The transport
   is verified in production by the fact that rows arrive; the arithmetic is
   verified here. The same goes for both bots — sendMessage, editMessageText,
   the PATCH and the Claude call are all network on their first line, so what is
   tested is what they decide, not what they send. Which effort level each of
   Eugenia's two callers asks for is therefore not covered here either; the
   `Effort` union is what a compiler catches instead.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// secretMatches comes from _shared, not from a function module, because there
// is now one of it. That this import resolves is also what proves every
// function's `../_shared/edge.ts` resolves — the same file, the same path
// shape — which is the check standing between a bad extraction and a deploy.
import { secretMatches, nyClock } from '../supabase/functions/_shared/edge.ts';

import {
  foldPosition, nyDay, ozFromVolume, usdFromCents,
  lookbackFor, foldHours, balanceTarget, parseSse, marketOpen
} from '../supabase/functions/doji-mcp-sync/index.ts';

import { SETUPS, COLUMNS, parseCallback, renderMessage, staysOpen } from '../supabase/functions/doji-gladys/index.ts';
import { emailRow, answerFor } from '../supabase/functions/doji-email-sync/index.ts';
import {
  briefDue, pulseDue, retryDue, dueNow, isSilent, briefingMarker, isBriefingMarker,
  greeting, chunk, TG_LIMIT, tradesQuery, openOnUser, nowBlock, withClock, dateTurns,
} from '../supabase/functions/doji-eugenia/index.ts';

const USER = '00000000-0000-0000-0000-000000000001';

// One deal. Timestamps are minutes past a fixed instant so a test reads as a
// sequence rather than as thirteen-digit noise.
const T0 = Date.UTC(2026, 6, 30, 14, 0, 0);   // 30 Jul 2026, 10:00 New York
const deal = (o) => ({
  dealId: o.dealId ?? 1, positionId: o.positionId ?? 562780708, symbolId: 41,
  tradeSide: o.side, volume: o.vol ?? 200, filledVolume: o.vol ?? 200,
  executionPrice: o.price, executionTimestamp: T0 + (o.min ?? 0) * 60_000,
  dealStatus: 'FILLED', commission: o.comm ?? 0
});

/* THE BUILDER AGAINST THE SHAPE THE POLLER DECLARES.

   Every fold test below runs on deals this file invents, so the whole section
   rests on `deal()` producing what cTrader produces. The email parser has a
   saved message to be held against; the poller has none, and nothing here can
   make one — a fixture built to a believed shape proves the belief, not the
   broker.

   What CAN be held is the builder against the interface in the same repository:
   the poller declares the fields it reads, and a deal missing one of them is a
   deal the tests could pass while the live fold threw. It catches a field
   added, renamed or dropped in the source. It cannot catch the interface itself
   being wrong about cTrader — only a saved response would, and that is named in
   the README as still missing. */
const POLLER_SRC = readFileSync(
  new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

test('a built deal carries every field the poller declares it reads', () => {
  const block = POLLER_SRC.match(/interface Deal \{([^}]*)\}/);
  assert.ok(block, 'the poller no longer declares a Deal interface');

  const declared = [...block[1].matchAll(/([a-zA-Z]+)\??\s*:/g)].map(m => m[1]);
  assert.ok(declared.length >= 8,
    `only ${declared.length} fields read out of the interface — the reader has gone blind`);

  const built = deal({ side: 'SELL', price: 3400 });
  for (const field of declared) {
    assert.ok(field in built,
      `the poller reads deal.${field}; the test builder does not produce it`);
  }
});

/* ─── Units ──────────────────────────────────────────────────────────────── */

test('units match the fill they were derived from', () => {
  assert.equal(ozFromVolume(200), 2);
  assert.equal(usdFromCents(-7), -0.07);
});

/* ─── nyDay ──────────────────────────────────────────────────────────────── */

test('nyDay files an evening trade under the New York day, not the UTC one', () => {
  // 21:05 New York on 30 July is 01:05 UTC on the 31st. The whole reason the
  // column is filled through Intl rather than toISOString().slice(0,10).
  assert.equal(nyDay(Date.UTC(2026, 6, 31, 1, 5)), '2026-07-30');
});

test('nyDay respects standard time as well as daylight time', () => {
  // January: New York is UTC-5, so 22:30 EST on the 11th is 03:30 UTC on the 12th.
  assert.equal(nyDay(Date.UTC(2026, 0, 12, 3, 30)), '2026-01-11');
});

/* ─── foldPosition ───────────────────────────────────────────────────────── */

test('a closed short folds to the numbers its broker email reported', () => {
  // Position 562780708: 2.00 oz short, gross 57.24, net 57.10, commission $0.14.
  const row = foldPosition([
    deal({ side: 'SELL', price: 3400.00, comm: -7, min: 0 }),
    deal({ side: 'BUY',  price: 3371.38, comm: -7, min: 29, dealId: 2 })
  ], USER);

  assert.equal(row.id, 'PID562780708');
  assert.equal(row.user_id, USER);
  assert.equal(row.direction, 'SELL');
  assert.equal(row.entry_price, 3400);
  assert.equal(row.exit_price, 3371.38);
  assert.equal(row.commission, 0.14);        // positive magnitude, never subtracted twice
  assert.equal(row.computed_pnl, 57.10);     // gross 57.24 less the 0.14 cost
  assert.equal(row.entry_time, new Date(T0).toISOString());
  assert.equal(row.open_day, '2026-07-30');
});

test('a closed long inverts the P&L sign convention', () => {
  const row = foldPosition([
    deal({ side: 'BUY',  price: 3371.38, min: 0 }),
    deal({ side: 'SELL', price: 3400.00, min: 15, dealId: 2 })
  ], USER);
  assert.equal(row.direction, 'BUY');
  assert.equal(row.computed_pnl, 57.24);
});

test('direction comes from the first deal, not the last', () => {
  // The deals arrive out of order on purpose: the sort inside foldPosition is
  // what makes ordered[0] the entry, and passing them pre-sorted would test
  // nothing.
  const row = foldPosition([
    deal({ side: 'BUY',  price: 3371.38, min: 29, dealId: 2 }),
    deal({ side: 'SELL', price: 3400.00, min: 0 })
  ], USER);
  assert.equal(row.direction, 'SELL');
});

test('a sliced deal set inverts direction and leaves exit_price null', () => {
  // NOT a bug being asserted as correct — this is the documented signature of a
  // row folded without its entry deal, which is what the fold window exists to
  // prevent. A repair query looks for exactly this: a position whose closing
  // deal was inside the window while its entry had aged out. If this test ever
  // stops failing to find the entry, the window has changed and the repair
  // signature below is no longer the right thing to search for.
  const closeOnly = foldPosition([
    deal({ side: 'BUY', price: 3371.38, min: 29, dealId: 2 })
  ], USER);
  assert.equal(closeOnly.direction, 'BUY');        // the real position was SELL
  assert.equal(closeOnly.exit_price, null);        // `exit_price is null` on a closed trade
  assert.equal(closeOnly.computed_pnl, null);
  assert.equal(closeOnly.entry_price, 3371.38);    // the exit's price, filed as the entry
});

test('a same-side deal is a scale-in, not a close', () => {
  const row = foldPosition([
    deal({ side: 'SELL', price: 3400.00, vol: 100, min: 0 }),
    deal({ side: 'SELL', price: 3410.00, vol: 100, min: 5, dealId: 2 })
  ], USER);
  assert.equal(row.exit_price, null);           // still open
  assert.equal(row.computed_pnl, null);
  assert.equal(row.entry_price, 3405);          // volume-weighted across both
});

test('a partial close leaves the position open and its P&L unresolved', () => {
  const row = foldPosition([
    deal({ side: 'SELL', price: 3400.00, vol: 200, min: 0 }),
    deal({ side: 'BUY',  price: 3390.00, vol: 100, min: 10, dealId: 2 })
  ], USER);
  assert.equal(row.exit_price, null);
  assert.equal(row.computed_pnl, null);
});

test('scaled entries and exits are volume-weighted, not averaged', () => {
  const row = foldPosition([
    deal({ side: 'BUY',  price: 3300.00, vol: 300, min: 0 }),
    deal({ side: 'BUY',  price: 3320.00, vol: 100, min: 2, dealId: 2 }),
    deal({ side: 'SELL', price: 3340.00, vol: 100, min: 8, dealId: 3 }),
    deal({ side: 'SELL', price: 3360.00, vol: 300, min: 9, dealId: 4 })
  ], USER);
  assert.equal(row.entry_price, 3305);   // (3300*3 + 3320*1) / 4 — not 3310
  assert.equal(row.exit_price, 3355);    // (3340*1 + 3360*3) / 4 — not 3350
  assert.equal(row.computed_pnl, 200);   // 50 * 4 oz, no commission
});

test('filledVolume wins over volume when both are present', () => {
  const d = deal({ side: 'BUY', price: 3300, min: 0 });
  d.volume = 999; d.filledVolume = 100;
  const row = foldPosition([d, deal({ side: 'SELL', price: 3310, vol: 100, min: 5, dealId: 2 })], USER);
  assert.equal(row.computed_pnl, 10);    // 1.00 oz, not 9.99
});

/* ─── Windows ────────────────────────────────────────────────────────────── */

test('lookbackFor falls back, clamps, and refuses junk', () => {
  const u = (q) => new URL('https://x.test/f' + q);
  assert.equal(lookbackFor(u('')), 6);
  assert.equal(lookbackFor(u('?hours=48')), 48);
  assert.equal(lookbackFor(u('?hours=5000')), 720);   // cTrader's cap
  assert.equal(lookbackFor(u('?hours=0')), 6);
  assert.equal(lookbackFor(u('?hours=-3')), 6);
  assert.equal(lookbackFor(u('?hours=abc')), 6);
});

test('the fold window is always wider than the write window', () => {
  assert.equal(foldHours(6), 78);
  assert.equal(foldHours(48), 120);
  assert.equal(foldHours(700), 720);      // clamped, and still ≥ its write window
  assert.ok(foldHours(6) > 6);
});

/* ─── Balance ────────────────────────────────────────────────────────────── */

// get_balance answers "what is the account worth now"; the column asks "what
// was it worth after this fill". Those agree only while nothing has happened in
// between, which is the whole of what balanceTarget enforces.
//
// The poll runs an hour past T0, so a close at minute 55 is five minutes old
// and one at minute 45 is fifteen — the same minutes-past-T0 vocabulary the
// deals above use.
const POLL  = T0 + 60 * 60_000;
const close = (min) => ({ id: 'PID' + min, at: T0 + min * 60_000 });

test('balanceTarget offers a balance only to a close the poller has just seen', () => {
  assert.equal(balanceTarget([], POLL), null);                // nothing closed: no call at all
  assert.equal(balanceTarget([close(55)], POLL), 'PID55');    // five minutes old
  assert.equal(balanceTarget([close(50)], POLL), 'PID50');    // exactly on the bound
  assert.equal(balanceTarget([close(49)], POLL), null);       // eleven minutes: nothing written
});

test('two closes in one run: only the later one ended at that balance', () => {
  // There is a single figure to hand and the earlier position did not end at
  // it — giving both the same balance overstates the first by the second's P&L.
  assert.equal(balanceTarget([close(52), close(58)], POLL), 'PID58');
  assert.equal(balanceTarget([close(58), close(52)], POLL), 'PID58');   // order-independent
});

test('a backfill writes no balance at all', () => {
  // ?force=1&hours=200 folds positions that closed days ago. Every one fails
  // the age test, so no historical balance — email-written or otherwise — is
  // overwritten. This bound is what makes a repair safe to run.
  assert.equal(balanceTarget([close(-72 * 60), close(-24 * 60)], POLL), null);
});

test('a fully closed position ends on a deal opposite its direction', () => {
  // The handler takes the LATEST deal's timestamp as the close time rather than
  // re-splitting on side. That holds only because outstanding open volume keeps
  // isClosed false, so the claim is asserted here rather than assumed there.
  const deals = [
    deal({ side: 'SELL', price: 3400.00, min: 0 }),
    deal({ side: 'BUY',  price: 3371.38, min: 29, dealId: 2 })
  ];
  const row    = foldPosition(deals, USER);
  const latest = deals.reduce((a, b) => b.executionTimestamp > a.executionTimestamp ? b : a);
  assert.notEqual(row.exit_price, null);
  assert.notEqual(latest.tradeSide, row.direction);
});

/* ─── Authorisation ──────────────────────────────────────────────────────── */

test('secretMatches accepts only an exact match', () => {
  assert.equal(secretMatches('hunter2', 'hunter2'), true);
  assert.equal(secretMatches('hunter3', 'hunter2'), false);
  assert.equal(secretMatches('hunter', 'hunter2'), false);      // shorter
  assert.equal(secretMatches('hunter22', 'hunter2'), false);    // longer
  assert.equal(secretMatches('hunter2 ', 'hunter2'), false);    // trailing space
});

test('a missing secret on either side is a closed door, not an open one', () => {
  assert.equal(secretMatches(null, 'hunter2'), false);
  assert.equal(secretMatches('', 'hunter2'), false);
  assert.equal(secretMatches('anything', ''), false);
  assert.equal(secretMatches(null, ''), false);
});

test('a NUL-padded secret does not match its unpadded self', () => {
  // The one case the byte loop cannot catch on its own: every extra byte is
  // zero, so `a[i] ?? 0` reads identical to it. The explicit length comparison
  // is the only thing standing between these two, which is why it is there and
  // why removing it as redundant would be wrong.
  assert.equal(secretMatches('hunter2', 'hunter2\u0000'), false);
  assert.equal(secretMatches('hunter2\u0000', 'hunter2'), false);
});

test('secretMatches handles multi-byte secrets by bytes, not code units', () => {
  assert.equal(secretMatches('café', 'café'), true);
  assert.equal(secretMatches('cafe', 'café'), false);
});

/* ─── SSE framing ────────────────────────────────────────────────────────── */

test('parseSse reads the last frame that actually parses', () => {
  assert.deepEqual(parseSse('event: message\ndata: {"ok":1}\n\n'), { ok: 1 });
  assert.deepEqual(parseSse('data: {"ok":1}\ndata: {"ok":2}\n'), { ok: 2 });
});

test('parseSse walks back past a trailing keepalive instead of throwing', () => {
  // The failure that made this a loop: an unparseable final frame surfaced as a
  // SyntaxError inside a 500 that pg_cron discards.
  assert.deepEqual(parseSse('data: {"ok":1}\ndata: [DONE]\n'), { ok: 1 });
});

test('parseSse accepts a plain JSON body with no framing at all', () => {
  assert.deepEqual(parseSse('{"ok":3}'), { ok: 3 });
});

/* ─── Market hours ───────────────────────────────────────────────────────── */

// August 2026 is EDT (UTC-4); January 2026 is EST (UTC-5). Both are tested
// because the whole reason this lives in code rather than in a cron expression
// is that a UTC schedule is an hour wrong for half the year.
test('the market is shut all Saturday', () => {
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 8, 16, 0))), false);   // Sat 12:00 NY
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 8, 4, 0))), false);    // Sat 00:00 NY
});

test('Friday closes at 17:00 New York, to the minute', () => {
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 7, 20, 59))), true);   // Fri 16:59 NY
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 7, 21, 0))), false);   // Fri 17:00 NY
});

test('Sunday opens at 17:00 New York, to the minute', () => {
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 9, 20, 59))), false);  // Sun 16:59 NY
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 9, 21, 0))), true);    // Sun 17:00 NY
});

test('the Sunday open moves with New York, not with UTC', () => {
  // 21:00 UTC in January is 16:00 EST — still shut, though the identical UTC
  // instant is open in August. A cron expression could not tell these apart.
  assert.equal(marketOpen(new Date(Date.UTC(2026, 0, 11, 21, 0))), false);
  assert.equal(marketOpen(new Date(Date.UTC(2026, 0, 11, 22, 0))), true);   // Sun 17:00 EST
});

test('midweek is open around the clock', () => {
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 5, 6, 0))), true);     // Wed 02:00 NY
  assert.equal(marketOpen(new Date(Date.UTC(2026, 7, 5, 21, 0))), true);    // Wed 17:00 NY
});

/* ─── Telegram: callback_data ────────────────────────────────────────────────
   The grammar is the whole state store — there is no session table and no
   stored message id — so a payload that parses wrong writes the wrong column to
   the wrong trade, silently.
   ───────────────────────────────────────────────────────────────────────── */

test('a tap names one journal column and its value', () => {
  assert.deepEqual(parseCallback('PID562780708|setup|Break & Retest'),
    { id: 'PID562780708', column: 'setup', value: 'Break & Retest', action: 'answer' });
  assert.deepEqual(parseCallback('PID562780708|rules|1'),
    { id: 'PID562780708', column: 'followed_rules', value: true, action: 'answer' });
  assert.deepEqual(parseCallback('PID562780708|sl|0'),
    { id: 'PID562780708', column: 'followed_sl', value: false, action: 'answer' });
  assert.deepEqual(parseCallback('PID562780708|tp|1'),
    { id: 'PID562780708', column: 'followed_tp', value: true, action: 'answer' });
});

test('[Edit] and [Done] carry no column, so they write nothing', () => {
  // They differ only in which way they move the form, which is why the action
  // is carried rather than inferred from a null column.
  assert.deepEqual(parseCallback('PID562780708|edit'),
    { id: 'PID562780708', column: null, value: null, action: 'edit' });
  assert.deepEqual(parseCallback('PID562780708|done'),
    { id: 'PID562780708', column: null, value: null, action: 'done' });
});

test('only the four journal columns are reachable from a button', () => {
  // The one guarantee that matters: no payload can name a broker column. If
  // this ever passes for something outside Data.OWNED, the fourth writer has
  // stopped being confined to the journal half.
  for (const field of ['direction', 'pnl', 'net_pnl', 'deleted', 'user_id', 'balance']) {
    assert.equal(parseCallback(`PID1|${field}|1`), null, field);
  }
});

test('a setup outside the vocabulary is refused before it reaches the column', () => {
  assert.equal(parseCallback('PID1|setup|Liquidity Sweep'), null);
});

test('a discipline answer is 1 or 0 and nothing else', () => {
  // 'true', 'yes' and '' would each become a boolean under a looser parse, and
  // an empty string would land as `false` — a no the trader never gave.
  for (const v of ['true', 'yes', '', '2', 'null']) {
    assert.equal(parseCallback(`PID1|sl|${v}`), null, v);
  }
});

test('a malformed payload parses to null rather than to something', () => {
  assert.equal(parseCallback(''), null);
  assert.equal(parseCallback('PID1'), null);
  assert.equal(parseCallback('PID1|reopen'), null);              // not the edit action
  assert.equal(parseCallback('1|sl|1'), null);                   // id without the PID prefix
  assert.equal(parseCallback('PIDx|sl|1'), null);                // id without a position
  assert.equal(parseCallback('PID1|sl|1|extra'), null);          // a fourth part
});

/* ─── Telegram: the keyboard ─────────────────────────────────────────────── */

const open = {
  id: 'PID562780708', direction: 'SELL', entry_price: 3400, entry_time: T0_ISO(),
  setup: null, followed_rules: null, followed_sl: null, followed_tp: null
};
function T0_ISO() { return new Date(Date.UTC(2026, 6, 30, 14, 0, 0)).toISOString(); }
const settled = { ...open, setup: 'Break & Retest', followed_rules: true, followed_sl: true, followed_tp: false };

test('every button fits inside Telegram\'s 64-byte callback_data cap', () => {
  // Measured in BYTES, not characters, and over every button both forms draw —
  // a setup value travels inside the payload, so the vocabulary sets the
  // budget. Worst case today is 39. Asserting the cap rather than the current
  // longest name, so a longer legal setup fails this only if it truly overruns.
  const rows = [
    ...renderMessage(open, false).reply_markup.inline_keyboard,
    ...renderMessage(settled, false).reply_markup.inline_keyboard
  ];
  for (const row of rows) {
    for (const btn of row) {
      const bytes = new TextEncoder().encode(btn.callback_data).length;
      assert.ok(bytes <= 64, `${btn.callback_data} is ${bytes} bytes`);
    }
  }
});

test('no setup name contains the delimiter its callback_data is split on', () => {
  /* callback_data is `id|field|value`, and parseCallback refuses anything that
     is not exactly two or three parts. A setup named "Break | Retest" would
     therefore arrive as four and every tap on it would be dropped — silently,
     because an unrecognised payload is acknowledged and ignored by design.

     The vocabulary is the one string in this system a person edits, and nothing
     else checks this. It is the same class as the 64-byte cap above: a legal
     name that the grammar cannot carry. */
  for (const setup of SETUPS) {
    assert.equal(setup.includes('|'), false,
      `"${setup}" contains the callback_data delimiter and can never be tapped`);
  }
});

test('the message heads with the New York hour and the New York day', () => {
  /* Two instants either side of the boundary, because they fail differently.

     04:05 UTC is 00:05 the same day in New York: only the HOUR moves, and it
     moves to the one an h24 cycle would render as 24.

     02:00 UTC is 22:00 the PREVIOUS day in New York: the DAY moves, which is
     the failure that files a trade under tomorrow. The first fixture alone does
     not cover this — its date reads 22 August in both zones, which an earlier
     version of this comment claimed otherwise.

     Driven through renderMessage rather than the private formatter, because the
     message is what the trader reads. WHAT IT DOES NOT PROVE is the h24 half:
     nyTime states hourCycle h23, and V8 resolves en-GB to h23 either way, so
     reverting that option leaves this green. Reverting the timezone fails it. */
  assert.match(renderMessage({ ...open, entry_time: '2026-08-22T04:05:00Z' }, false).text,
    /22 Aug, 00:05 ET/);
  assert.match(renderMessage({ ...open, entry_time: '2026-08-22T02:00:00Z' }, false).text,
    /21 Aug, 22:00 ET/);
});

test('an unanswered trade opens on the full keyboard, one row per question', () => {
  const rows = renderMessage(open, false).reply_markup.inline_keyboard;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].map(b => b.text), [...SETUPS]);
  // The labels, not just the shape. They are what the trader reads on the
  // button, and the column they write is not recoverable from them.
  assert.deepEqual(rows[1].map(b => b.text), ['Rules ✓', 'Rules ✗']);
  assert.deepEqual(rows[2].map(b => b.text), ['Stop Loss ✓', 'Stop Loss ✗']);
  assert.deepEqual(rows[3].map(b => b.text), ['Take Profit ✓', 'Take Profit ✗']);
});

test('the fourth answer settles the message to one [Edit] row', () => {
  const rows = renderMessage(settled, false).reply_markup.inline_keyboard;
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].text, 'Edit');
  assert.equal(rows[0][0].callback_data, 'PID562780708|edit');
});

test('a reopened form offers [Done], an unfinished one does not', () => {
  // Without it there is no way back to the summary: every answer is already in,
  // so no tap can be the fourth. A [Done] on an unfinished journal would be a
  // button for abandoning it, so it appears only once all four are answered.
  const reopened = renderMessage(settled, true).reply_markup.inline_keyboard;
  assert.equal(reopened.length, 5);
  assert.deepEqual(reopened[4], [{ text: 'Done', callback_data: 'PID562780708|done' }]);

  const unfinished = renderMessage(open, true).reply_markup.inline_keyboard;
  assert.equal(unfinished.length, 4);
  assert.equal(unfinished.flat().some(b => b.text === 'Done'), false);
});

test('[Done] collapses a reopened form, [Edit] opens it again', () => {
  const done = parseCallback('PID562780708|done');
  assert.equal(staysOpen(done, settled), false);
  assert.equal(renderMessage(settled, staysOpen(done, settled))
    .reply_markup.inline_keyboard.length, 1);
});

/* ─── Telegram: the message ──────────────────────────────────────────────── */

test('an unanswered discipline column draws as unanswered, never as no', () => {
  // The null-is-not-no rule, in the one place it is shown to a person. A
  // message that drew a blank as ✗ would teach the trader the opposite of what
  // the column means.
  const text = renderMessage({ ...open, followed_sl: false }, false).text;
  assert.match(text, /Rules: —/);
  assert.match(text, /Stop Loss: ✗/);
  assert.match(text, /Take Profit: —/);
  assert.match(text, /Setup: —/);
});

test('the message heads with the New York clock, not the UTC one', () => {
  // 21:05 New York on 30 July is 01:05 UTC on the 31st, the same fill nyDay is
  // tested against. The header has to agree with the day the trade is filed on.
  const evening = { ...open, entry_time: new Date(Date.UTC(2026, 6, 31, 1, 5)).toISOString() };
  assert.match(renderMessage(evening, false).text, /^SELL 3400\.00 · 30 Jul, 21:05 ET$/m);
});

test('the settled summary is two lines and carries all four answers', () => {
  assert.equal(renderMessage(settled, false).text,
    'Logged · SELL 3400.00 · Break & Retest\nrules ✓ · SL ✓ · TP ✗');
});

test('the open form greets, then states the fill', () => {
  const lines = renderMessage(open, false).text.split('\n');
  assert.equal(lines[0], 'Hola Jefe, new fill below');
  assert.equal(lines[2], 'SELL 3400.00 · 30 Jul, 10:00 ET');
});

/* ─── Telegram: when the form settles ────────────────────────────────────────
   The decision that was wrong. An earlier version read the keyboard's row count
   off the incoming message, which is true on every tap — an open form always
   has four rows — so the message never settled and the summary, the [Edit]
   button and the readRow path were all unreachable. These replay the taps.
   ───────────────────────────────────────────────────────────────────────── */

test('the fourth answer settles the form, and the three before it do not', () => {
  // The whole sequence, exactly as the webhook drives it: read before, write,
  // then redraw with staysOpen. This is the regression test for a message that
  // could never settle at all.
  const complete = r => r.setup !== null && r.followed_rules !== null &&
                        r.followed_sl !== null && r.followed_tp !== null;
  let row = { ...open };
  let didSettle = false;

  for (const data of ['PID562780708|setup|Break & Retest', 'PID562780708|rules|1',
                      'PID562780708|sl|1', 'PID562780708|tp|1']) {
    const tap = parseCallback(data);
    const before = row;                                  // the row as it stood
    row = { ...row, [tap.column]: tap.value };            // the write
    // Settling needs both: the row complete, and the tap not a reopen.
    didSettle = complete(row) && !staysOpen(tap, before);
    const rows = renderMessage(row, staysOpen(tap, before)).reply_markup.inline_keyboard.length;
    assert.equal(rows, didSettle ? 1 : 4, data);
  }
  assert.equal(didSettle, true, 'the fourth answer must settle it');
});

test('the taps are taken off the buttons the form actually drew', () => {
  /* THE SAME SEQUENCE AS ABOVE, WITH NOTHING TYPED INTO IT. The test before
     this one writes its own callback_data, so it proves the loop settles on
     four answers and says nothing about whether the keyboard emits payloads
     that reach it. Those are different questions, and only this one covers the
     join: a ✓ button drawn with any value but `1` parses to null, the tap is
     acknowledged and dropped by design, and the bot goes silent while every
     test that supplies its own payload stays green.

     So each round renders the form, finds the button that writes the field,
     and taps THAT — the payload, the parse and the redraw all off the real
     thing. */
  let row = { ...open };

  for (const field of ['setup', 'rules', 'sl', 'tp']) {
    const before = row;
    const drawn = renderMessage(row, false).reply_markup.inline_keyboard.flat()
      .find(b => b.callback_data.split('|')[1] === field);
    assert.ok(drawn, `the open form draws no button that writes ${field}`);

    const tap = parseCallback(drawn.callback_data);
    assert.ok(tap, `the ${field} button draws ${drawn.callback_data}, which the parser refuses`);
    assert.equal(tap.column, COLUMNS[field]);

    row = { ...row, [tap.column]: tap.value };
    const rows = renderMessage(row, staysOpen(tap, before)).reply_markup.inline_keyboard.length;
    assert.equal(rows, field === 'tp' ? 1 : 4, drawn.callback_data);
  }

  // And the values landed as the three-state booleans the column holds, not as
  // the strings they travelled as.
  assert.equal(row.setup, SETUPS[0]);
  for (const c of ['followed_rules', 'followed_sl', 'followed_tp']) {
    assert.equal(typeof row[c], 'boolean', c);
  }
});

test('every button either form draws is a tap the parser accepts', () => {
  /* The sequence above walks one path through the keyboard — the ✓ half of each
     pair, and the first setup. Everything it does not press is untested by it,
     and a ✗ drawn as `|no` instead of `|0` is refused by parseCallback exactly
     as silently as a ✓ would be: acknowledged, dropped, no change on screen.

     So this presses nothing and checks everything. Both forms, every row, every
     button, including the [Edit] and [Done] that write no column at all. */
  const forms = [
    ['the open form', renderMessage(open, false)],
    ['the settled summary', renderMessage(settled, false)],
    ['a reopened form', renderMessage(settled, true)],
  ];

  for (const [what, msg] of forms) {
    const buttons = msg.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.length, `${what} draws no buttons at all`);

    for (const btn of buttons) {
      const tap = parseCallback(btn.callback_data);
      assert.ok(tap, `${what} draws "${btn.callback_data}", which parseCallback refuses`);
      // A tap that names a column must name one of the four, and only those.
      if (tap.column) assert.ok(Object.values(COLUMNS).includes(tap.column), tap.column);
    }
  }
});

test('a correction inside a reopened form does not re-settle it', () => {
  // Reopened means every answer was already in before this tap. Collapsing here
  // would make a two-field correction need [Edit] pressed twice.
  const tap = parseCallback('PID562780708|sl|0');
  assert.equal(staysOpen(tap, settled), true);
  // Five rows: the four questions plus the [Done] that closes it again.
  assert.equal(renderMessage({ ...settled, followed_sl: false },
    staysOpen(tap, settled)).reply_markup.inline_keyboard.length, 5);
});

test('[Edit] reopens whatever it is pressed on', () => {
  assert.equal(staysOpen(parseCallback('PID562780708|edit'), settled), true);
  assert.equal(staysOpen(parseCallback('PID562780708|edit'), open), true);
});

/* ─── Eugenia: when the briefing is due ──────────────────────────────────────
   Weekdays 08:00 and Sunday 17:00 New York. The cron job fires hourly and this
   is the whole decision, so an off-by-one here is a briefing that never arrives
   or one that arrives every hour. August 2026 is EDT (UTC-4), January is EST
   (UTC-5) — both are tested, because a fixed UTC schedule is exactly what this
   exists to avoid.
   ───────────────────────────────────────────────────────────────────────── */

test('the weekday briefing is 08:00 New York, in both halves of the year', () => {
  assert.equal(briefDue(new Date(Date.UTC(2026, 7, 19, 12, 0))), 'weekday');  // Wed 08:00 EDT
  assert.equal(briefDue(new Date(Date.UTC(2026, 0, 14, 13, 0))), 'weekday');  // Wed 08:00 EST
  // The same UTC instant is the wrong hour in the other season, which is the
  // entire reason this is not a cron expression.
  assert.equal(briefDue(new Date(Date.UTC(2026, 0, 14, 12, 0))), null);       // Wed 07:00 EST
  assert.equal(briefDue(new Date(Date.UTC(2026, 7, 19, 13, 0))), null);       // Wed 09:00 EDT
});

test('the Sunday briefing is 17:00 New York, when the gold week opens', () => {
  assert.equal(briefDue(new Date(Date.UTC(2026, 7, 23, 21, 0))), 'sunday');   // Sun 17:00 EDT
  assert.equal(briefDue(new Date(Date.UTC(2026, 0, 11, 22, 0))), 'sunday');   // Sun 17:00 EST
  assert.equal(briefDue(new Date(Date.UTC(2026, 7, 23, 12, 0))), null);       // Sun 08:00 — not a weekday
});

test('Saturday never gets a briefing, and no other hour does either', () => {
  assert.equal(briefDue(new Date(Date.UTC(2026, 7, 22, 12, 0))), null);       // Sat 08:00
  assert.equal(briefDue(new Date(Date.UTC(2026, 7, 22, 21, 0))), null);       // Sat 17:00
  assert.equal(briefDue(new Date(Date.UTC(2026, 7, 19, 21, 0))), null);       // Wed 17:00
  // Every hour of one weekday: exactly one of the twenty-four is the hour.
  const due = [...Array(24)].filter((_, h) => briefDue(new Date(Date.UTC(2026, 7, 19, h, 0))));
  assert.equal(due.length, 1);
});

test('the salutation matches the time of day the briefing lands', () => {
  assert.equal(greeting('weekday'), 'Buenos dias jefesito, todays news below');
  assert.equal(greeting('sunday'),  'Buenas tardes jefesito, todays news below');
});

/* ─── Eugenia: the pulse ─────────────────────────────────────────────────────
   The second scheduled look. It has to sit on a weekday hour that is NOT a
   briefing hour, and it has to be able to stay quiet — a pulse that could never
   go silent would message him every weekday whether or not anything happened.
   ─────────────────────────────────────────────────────────────────────────── */

test('the pulse is 10:00 New York on weekdays, in both halves of the year', () => {
  // 14:00 UTC is 10:00 New York in August (EDT, UTC-4).
  assert.equal(pulseDue(new Date(Date.UTC(2026, 7, 19, 14, 0))), true);
  // 15:00 UTC is 10:00 New York in January (EST, UTC-5) — the same wall hour.
  assert.equal(pulseDue(new Date(Date.UTC(2026, 0, 14, 15, 0))), true);
  // An hour either side of it is not the pulse.
  assert.equal(pulseDue(new Date(Date.UTC(2026, 7, 19, 13, 0))), false);
  assert.equal(pulseDue(new Date(Date.UTC(2026, 7, 19, 15, 0))), false);
});

test('the weekend gets no pulse at all', () => {
  assert.equal(pulseDue(new Date(Date.UTC(2026, 7, 22, 14, 0))), false);   // Saturday
  assert.equal(pulseDue(new Date(Date.UTC(2026, 7, 23, 14, 0))), false);   // Sunday
});

test('a briefing hour and a pulse hour never collide', () => {
  // Every hour of a full week: the two schedules must never both fire, or one
  // call would owe two answers and only one caller would get its own.
  for (let h = 0; h < 24 * 7; h++) {
    const at = new Date(Date.UTC(2026, 7, 16, h));           // Sun 16 Aug onwards
    assert.equal(briefDue(at) !== null && pulseDue(at), false,
      `both due at ${at.toISOString()}`);
  }
});

/* ─── Eugenia: which of the three schedules this hour owes ──────────────────
   Each predicate is right on its own and that is not the question — the three
   overlap, and what an hour owes is the composition of them.

   So this walks 168 CONSECUTIVE HOURS and states the whole timetable, rather
   than sampling four separate UTC days: a run that restarts at 00:00 UTC each
   day never reaches Sunday 20:00–23:59 in New York, which is 00:00–03:59 UTC on
   the Monday, and a spurious briefing hour hiding there would ship green.

   Sun 16 Aug 2026 00:00 UTC is Sat 15 Aug 20:00 in New York, so the range
   covers every New York hour of Sunday 16th through Friday 21st, and both
   weekend edges.
   ─────────────────────────────────────────────────────────────────────────── */

const timetable = (briefed) => {
  const owed = [];
  for (let h = 0; h < 24 * 7; h++) {
    const at  = new Date(Date.UTC(2026, 7, 16, h));
    const due = dueNow(at, briefed);
    if (due) owed.push(`${at.toISOString().slice(0, 16)} ${due}`);
  }
  return owed;
};

test('an ordinary week owes one briefing and one pulse a day, and nothing else', () => {
  // August, so New York is EDT: 08:00 ET is 12:00 UTC, 10:00 ET is 14:00, and
  // the Sunday open at 17:00 ET is 21:00.
  assert.deepEqual(timetable(true), [
    '2026-08-16T21:00 sunday',
    '2026-08-17T12:00 weekday', '2026-08-17T14:00 pulse',
    '2026-08-18T12:00 weekday', '2026-08-18T14:00 pulse',
    '2026-08-19T12:00 weekday', '2026-08-19T14:00 pulse',
    '2026-08-20T12:00 weekday', '2026-08-20T14:00 pulse',
    '2026-08-21T12:00 weekday', '2026-08-21T14:00 pulse',
  ]);
});

test('a week of failed briefings owes the retry hours, and the pulse gives way', () => {
  // 09:00, 10:00 and 11:00 ET are 13:00, 14:00 and 15:00 UTC. 14:00 is the one
  // hour the pulse also wants, and the retry takes it: a second look at a
  // morning he was never told about is not what is missing.
  const day = (d) => [`2026-08-${d}T12:00 weekday`, `2026-08-${d}T13:00 weekday`,
                      `2026-08-${d}T14:00 weekday`, `2026-08-${d}T15:00 weekday`];
  assert.deepEqual(timetable(false), [
    '2026-08-16T21:00 sunday',
    ...day('17'), ...day('18'), ...day('19'), ...day('20'), ...day('21'),
  ]);
});

test('the timetable holds its New York hours in winter too', () => {
  // January: EST (UTC-5), so every hour above moves one later in UTC.
  const owed = [];
  for (let h = 0; h < 24; h++) {
    const at  = new Date(Date.UTC(2026, 0, 14, h));   // Wed 14 Jan
    const due = dueNow(at, true);
    if (due) owed.push(`${at.toISOString().slice(11, 16)} ${due}`);
  }
  assert.deepEqual(owed, ['13:00 weekday', '15:00 pulse']);
});

test('the pulse stays silent on the word it was told to use', () => {
  assert.equal(isSilent('NOTHING'), true);
  assert.equal(isSilent('NOTHING.'), true);
  assert.equal(isSilent('  Nothing  '), true);
});

test('a sentence that merely opens with the word is news, and is sent', () => {
  // The failure direction matters: a swallowed message is invisible, an extra
  // one is merely extra. So only the bare word is silence.
  assert.equal(isSilent('Nothing much has changed, except gold is up forty.'), false);
  assert.equal(isSilent('Core CPI came in at 0.2%, under the 0.3% expected.'), false);
  assert.equal(isSilent(''), false);
});

/* ─── Eugenia: the retry ─────────────────────────────────────────────────────
   A briefing that failed at 08:00 used to wait a full day. These are the hours
   it may try again, and the marker that stops it trying once one has landed.
   ─────────────────────────────────────────────────────────────────────────── */

test('the retry window is the three weekday hours after the briefing', () => {
  // August: New York is EDT (UTC-4), so 13:00–15:00 UTC is 09:00–11:00 ET.
  for (const h of [13, 14, 15]) {
    assert.equal(retryDue(new Date(Date.UTC(2026, 7, 19, h))), true, `${h}:00 UTC`);
  }
  // 08:00 is the briefing's own hour, and noon is too late to be a morning.
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 19, 12))), false);
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 19, 16))), false);
});

test('the retry window holds its New York hours in winter too', () => {
  // January: EST (UTC-5), so 09:00 ET is 14:00 UTC and 08:00 ET is 13:00.
  assert.equal(retryDue(new Date(Date.UTC(2026, 0, 14, 14))), true);
  assert.equal(retryDue(new Date(Date.UTC(2026, 0, 14, 13))), false);
});

test('the weekend never retries', () => {
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 22, 14))), false);   // Saturday
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 23, 14))), false);   // Sunday
});

test('the retry recognises exactly what a briefing stores, and nothing else', () => {
  // If it could not spot yesterday's shape it would send a second briefing
  // every morning; if it matched too loosely, a question mentioning the word
  // would suppress a real one.
  assert.equal(isBriefingMarker(briefingMarker('weekday')), true);
  assert.equal(isBriefingMarker(briefingMarker('sunday')), true);
  assert.equal(isBriefingMarker('[pulse]'), false);
  assert.equal(isBriefingMarker('what did the briefing say about CPI?'), false);
  assert.equal(isBriefingMarker(''), false);
});

/* ─── Eugenia: Telegram's 4096-character limit ───────────────────────────── */

test('a briefing longer than one message is split, and never mid-sentence', () => {
  // Deliberately over the length the prompt asks for — most briefings now fit
  // in one message, and this exercises the ones that do not. Written in
  // paragraphs, as she writes, so the split should always find a break.
  const section = (n) => `SECTION ${n}\n` + `Real yields drive gold. `.repeat(60);
  const brief = [...Array(7)].map((_, i) => section(i + 1)).join('\n\n');
  assert.ok(brief.length > TG_LIMIT, 'the fixture must actually exceed the limit');

  const parts = chunk(brief);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= TG_LIMIT, `${p.length} > ${TG_LIMIT}`);
  // Nothing dropped and nothing duplicated. Compared without whitespace, since
  // the split trims at its seams and that is not a loss.
  const bare = (t) => t.replace(/\s/g, '');
  assert.equal(bare(parts.join('')), bare(brief));
  // No part was re-flowed: each appears verbatim in the original, which is only
  // true if every break landed on whitespace the text already had.
  for (const p of parts) assert.ok(brief.includes(p), 'a part was rewritten, not cut');
});

test('a message that fits is sent whole, as one', () => {
  assert.deepEqual(chunk('Buenos dias jefesito, todays news below'),
    ['Buenos dias jefesito, todays news below']);
});

test('a single paragraph over the limit is cut rather than dropped', () => {
  // No newline to break on. It must still fit, and must not lose characters.
  const wall = 'x'.repeat(TG_LIMIT + 500);
  const parts = chunk(wall);
  assert.equal(parts.length, 2);
  for (const p of parts) assert.ok(p.length <= TG_LIMIT);
  assert.equal(parts.join('').length, wall.length);
});

/* ─── Eugenia: the journal, read-only ────────────────────────────────────────
   `days` arrives from the model, so tradesQuery is the boundary and clamping is
   its job. The view it names is the read-only one; that this function reads a
   view rather than the table is the guarantee she cannot write a trade.
   ───────────────────────────────────────────────────────────────────────── */

const NOW = Date.UTC(2026, 7, 19, 12, 0);   // 19 Aug 2026

test('the journal read names the read-only view, never the table', () => {
  // The path segment itself, not a substring of it — `eugenia_trades` contains
  // `trades`, which is exactly the trap a looser assertion falls into.
  const q = tradesQuery(30, NOW);
  assert.equal(q.split('?')[0], 'eugenia_trades');
});

test('a window from the model is clamped, never trusted', () => {
  const since = (d) => tradesQuery(d, NOW).match(/gte\.(\d{4}-\d\d-\d\d)/)[1];
  assert.equal(since(7), '2026-08-12');
  assert.equal(since(1), '2026-08-18');
  assert.equal(since(99999), since(365));      // a year, and no further back
  assert.equal(since(-5), since(1));           // never forward in time
  assert.equal(since(0), since(30));           // absent or zero is a month
  assert.equal(since('abc'), since(30));       // junk is a month, not NaN
  assert.equal(since(undefined), since(30));
});

test('the window is n civil days back from today in New York', () => {
  /* open_day is a civil day, so the bound has to be one. Two instants where an
     instant-arithmetic bound gets it wrong:

     02:00 UTC is 22:00 the previous evening in New York, so a UTC-derived date
     is already tomorrow and the window starts a day late — every evening.

     The evening after the clocks go back, a day is 25 hours long, so
     subtracting seven fixed days lands six civil days ago and the oldest day of
     "this past week" is gone. Spring-forward stretches it to eight. */
  const evening   = new Date('2026-08-22T02:00:00Z').getTime();   // Fri 21 Aug, 22:00 ET
  const fallBack  = new Date('2026-11-03T04:30:00Z').getTime();   // Mon 2 Nov, 23:30 ET
  const springFwd = new Date('2026-03-09T03:30:00Z').getTime();   // Sun 8 Mar, 23:30 ET

  assert.match(tradesQuery(7, evening),   /open_day=gte\.2026-08-14/);
  assert.match(tradesQuery(7, fallBack),  /open_day=gte\.2026-10-26/);
  assert.match(tradesQuery(7, springFwd), /open_day=gte\.2026-03-01/);
});

test('the journal read is bounded, so a wide window cannot fill the context', () => {
  assert.match(tradesQuery(365, NOW), /limit=400/);
});

/* ─── The New York clock ─────────────────────────────────────────────────────
   One definition, read by the poller's market hours and by both of Eugenia's
   schedules. It was two near-identical copies whose only difference was what
   they returned when Intl failed to emit a part — Monday noon on one side, -1
   on the other, and neither reachable.

   These assert the clock DIRECTLY rather than through its three callers,
   because those callers already have their own tests and a bug here would move
   all of them together in a way that reads as correct.
   ─────────────────────────────────────────────────────────────────────────── */

test('the clock reads New York, not UTC, in both halves of the year', () => {
  // Daylight time: UTC-4. Standard time: UTC-5.
  assert.deepEqual(nyClock(new Date('2026-07-30T14:00:00Z')), { wd: 4, hour: 10 });
  assert.deepEqual(nyClock(new Date('2026-01-15T14:00:00Z')), { wd: 4, hour: 9 });
});

test('every weekday maps to the number the schedules switch on', () => {
  // Sunday is 0, because that is what briefDue and marketOpen both test for and
  // Sunday 17:00 is the gold open — the one boundary that is not a weekday.
  const sunday = Date.UTC(2026, 7, 23, 18, 0, 0);          // 23 Aug 2026, 14:00 ET
  for (let i = 0; i < 7; i++) {
    assert.equal(nyClock(new Date(sunday + i * 86_400_000)).wd, i);
  }
});

test('midnight in New York reads as hour 0, never as 24', () => {
  // Some engines emit '24' at midnight, which would make every hour comparison
  // in every schedule miss the first hour of the day.
  assert.equal(nyClock(new Date('2026-07-30T04:00:00Z')).hour, 0);
  assert.equal(nyClock(new Date('2026-01-15T05:00:00Z')).hour, 0);
});

test('the market check and the briefing check read the same hour', () => {
  // The reason they share a definition: a disagreement about what hour it is in
  // New York is the sort of bug nobody finds until March.
  const at8 = new Date('2026-08-24T12:00:00Z');            // Monday 08:00 ET
  assert.equal(nyClock(at8).hour, 8);
  assert.equal(briefDue(at8), 'weekday');
  assert.equal(marketOpen(at8), true);
});

/* ─── Eugenia's history window ───────────────────────────────────────────────
   The Messages API merges consecutive same-role turns and refuses a leading
   assistant one, and the refusal is total: every reply 400s until the offending
   row rolls out of the window.

   The window used to rely on turns being written in pairs, which they are —
   but two rows in one INSERT draw two sequence values and a concurrent INSERT
   can take one in between, so the pairs can interleave and the window can open
   mid-pair. That was an invariant held up by a comment; this is the same
   invariant held up by a function.
   ─────────────────────────────────────────────────────────────────────────── */

const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });

test('a window that already opens on a user turn is left exactly as it is', () => {
  const window = [u('one'), a('two'), u('three'), a('four')];
  assert.deepEqual(openOnUser(window), window);
});

test('a window opening on an assistant turn is trimmed until it does not', () => {
  // What the API refuses, and the only shape that has to be repaired.
  assert.deepEqual(openOnUser([a('two'), u('three'), a('four')]),
    [u('three'), a('four')]);
});

test('interleaved pairs are repaired rather than sent', () => {
  // Two messages seconds apart: both handlers read the same history and both
  // write a pair, and the sequence values interleave as u1 u2 a1 a2. Reading
  // any even number of those can open on an assistant turn.
  const scrambled = [a('a1'), a('a2'), u('u3'), a('a3')];
  const repaired = openOnUser(scrambled);
  assert.equal(repaired[0].role, 'user');
  assert.deepEqual(repaired, [u('u3'), a('a3')]);
});

test('a window with no user turn at all becomes empty, not invalid', () => {
  // Empty is a first message the caller then supplies. A leading assistant turn
  // is a 400 and no answer at all.
  assert.deepEqual(openOnUser([a('one'), a('two')]), []);
  assert.deepEqual(openOnUser([]), []);
});

/* ─── The email boundary ─────────────────────────────────────────────────────
   doji-email-sync is the only function here that reads a request body, so it is
   the only one with a shape to check. What it must guarantee is what the Apps
   Script's EMAIL_OWNED loop used to: five columns reach the table and nothing
   else can, whatever arrives.
   ─────────────────────────────────────────────────────────────────────────── */

const fill = (o = {}) => ({
  id: 'PID562780708', direction: 'SELL', fill_time: '2026-07-30T14:29:00Z',
  net_pnl: 57.10, balance: 10057.10, ...o,
});
const rowOf = (o) => { const r = emailRow(o, USER); assert.ok('row' in r, JSON.stringify(r)); return r.row; };
const why = (o) => { const r = emailRow(o, USER); assert.ok('error' in r, 'accepted a fill it should refuse'); return r.error; };

test('a well-formed fill becomes the five email-owned columns plus the owner', () => {
  assert.deepEqual(rowOf(fill()), {
    id: 'PID562780708', user_id: USER, direction: 'SELL',
    fill_time: '2026-07-30T14:29:00Z', net_pnl: 57.10, balance: 10057.10,
  });
});

test('no broker or journal column is reachable through the body', () => {
  // THE WHOLE GUARANTEE. merge-duplicates writes exactly the keys present, so a
  // key that survives this projection overwrites whatever the poller folded.
  const row = rowOf(fill({
    entry_time: '2020-01-01T00:00:00Z', entry_price: 1, exit_price: 2,
    commission: 99, open_day: '2020-01-01', computed_pnl: 1234, pnl: 1234,
    setup: 'Break & Retest', followed_rules: false, followed_sl: false,
    followed_tp: false, deleted: true, created_at: 'x', updated_at: 'x',
  }));
  assert.deepEqual(Object.keys(row).sort(),
    ['balance', 'direction', 'fill_time', 'id', 'net_pnl', 'user_id']);
});

test('the owner comes from secrets, never from the body', () => {
  assert.equal(rowOf(fill({ user_id: 'somebody-else' })).user_id, USER);
});

test('an id that is not a position id is refused', () => {
  // Unprefixed, the same position mints a second row; anything else is not a
  // trade at all.
  for (const id of ['562780708', 'PID', 'pid562780708', 'PID562780708; drop', '', null]) {
    assert.match(why(fill({ id })), /id/);
  }
});

test('direction is BUY or SELL and nothing else', () => {
  for (const direction of ['Buy', 'sell', 'LONG', '', null, undefined]) {
    assert.match(why(fill({ direction })), /direction/);
  }
});

test('a fill time that does not parse is refused rather than filed under today', () => {
  for (const fill_time of ['just now', '30/07/2026', '', null, 20260730]) {
    assert.match(why(fill({ fill_time })), /fill_time/);
  }
});

test('a missing figure is dropped, because null would erase a good one', () => {
  // An absent key and a null key mean opposite things under merge-duplicates:
  // absent leaves the column alone, null overwrites it.
  assert.deepEqual(Object.keys(rowOf(fill({ net_pnl: null, balance: undefined }))).sort(),
    ['direction', 'fill_time', 'id', 'user_id']);
});

test('a figure that is not a finite number is refused, never coerced', () => {
  for (const net_pnl of ['57.10', NaN, Infinity, {}, []]) {
    assert.match(why(fill({ net_pnl })), /net_pnl/);
  }
});

test('a body that is not an object at all is refused without throwing', () => {
  for (const body of [null, undefined, 'PID1', 42, []]) {
    assert.ok('error' in emailRow(body, USER));
  }
});

/* ─── The email path: what the caller is told ────────────────────────────────
   The other half of the three-outcome contract. test/parse.test.mjs proves the
   Apps Script labels a 400 permanently and retries everything else; these prove
   this end emits a 400 for the same cases and only those. Two halves each
   tested against a literal is how the first version of this shipped treating
   every 4xx as permanent.
   ─────────────────────────────────────────────────────────────────────────── */

test('only a status about the row itself is permanent', () => {
  // Postgres looked at this row and will never take it: malformed, a constraint
  // it violates, a value it cannot process. Retrying is the only alternative,
  // every minute for ninety days.
  for (const status of [400, 409, 422]) {
    assert.equal(answerFor(status), 400, `${status} should be permanent`);
  }
});

test('a status about the caller is transient, so the fill keeps its place', () => {
  /* THE ONE THAT LOST DATA. A rotated SB_SECRET_KEY answers 401 — which says
     nothing whatever about the fill. Treated as permanent, the thread is
     labelled failed, drops out of the Gmail query, and every queued net_pnl is
     gone by the time anyone notices the key.

     404 is a renamed function, 403 a revoked grant, 429 a rate limit, and every
     5xx is Supabase. A person fixing any of those wants the fill still waiting
     for them. */
  for (const status of [401, 403, 404, 408, 429, 500, 502, 503, 504]) {
    assert.equal(answerFor(status), 500, `${status} should be retryable`);
  }
});

test('zero is a real P&L and must survive', () => {
  // The one falsy value that is a figure. Dropped, the trade would keep a
  // computed P&L that includes no swap.
  assert.equal(rowOf(fill({ net_pnl: 0 })).net_pnl, 0);
});

/* ─── The clock she is given ─────────────────────────────────────────────────
   She has no other one. Asked a question at 23:42 she answered "morning",
   because her whole context is a system prompt about morning briefings and a
   history whose most recent long turn IS that morning's briefing — the only
   inference available from what she was handed.
   ─────────────────────────────────────────────────────────────────────────── */

test('the stamp is the New York wall clock, not UTC', () => {
  // 03:42 UTC is the night before in New York, which is the case that produced
  // "morning" at twenty to midnight.
  const at = nowBlock(new Date('2026-08-22T03:42:00Z'));
  assert.match(at, /Friday, 21 August 2026 at 23:42/);
  assert.equal(at.includes('22 August'), false, 'the UTC date leaked through');
});

test('the stamp follows New York through the daylight-saving change', () => {
  assert.match(nowBlock(new Date('2026-01-15T14:00:00Z')), /at 09:00/);   // EST, UTC-5
  assert.match(nowBlock(new Date('2026-07-15T14:00:00Z')), /at 10:00/);   // EDT, UTC-4
});

test('the stamp tells her to trust it over the conversation', () => {
  // Without this the freshest thing in her context is still this morning's
  // briefing, and it argues for the wrong answer.
  assert.match(nowBlock(new Date()), /Trust this over anything the conversation/);
});

test('midnight reads as 00, never as 24', () => {
  // hour12: false leaves the cycle to the locale and can resolve to h24.
  assert.match(nowBlock(new Date('2026-08-22T04:05:00Z')), /at 00:05/);
});

/* withClock is where the stamp is actually attached, and it exists because the
   three callers appending it themselves was three chances to forget — removing
   it from the pulse alone left every test green.

   Moving it to one place makes it harder to forget and no easier to SEE: ask()
   reaches the network on its first line, so no assertion here can watch it
   build a request. Deleting the call from ask() left all 162 green, which is
   the same hole one level up. So this reads the file. It is weaker than driving
   the sequence and it is the strongest thing available, which is worth saying
   rather than leaving someone to assume the wiring is covered. */
const EUGENIA = readFileSync(
  new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');

test('ask attaches the clock, so no caller can omit it', () => {
  const from = EUGENIA.indexOf('async function ask(');
  assert.notEqual(from, -1, 'ask() has been renamed — this check is now asserting nothing');
  const body = EUGENIA.slice(from, EUGENIA.indexOf('\n}\n', from));
  assert.match(body, /withClock\(messages\)/,
    'ask() no longer attaches the clock — every caller can lose it silently again');
});

test('the turn being asked carries the clock', () => {
  const out = withClock([u('one'), a('two'), u('three')], new Date('2026-08-22T03:42:00Z'));
  assert.match(out[2].content, /^three\n\n\[Right now it is Friday, 21 August 2026 at 23:42/);
});

test('nothing else in the window is touched', () => {
  const window = [u('one'), a('two'), u('three')];
  const out = withClock(window, new Date());
  assert.equal(out[0].content, 'one');
  assert.equal(out[1].content, 'two');
  // And the caller's array is not mutated, because remember() stores it.
  assert.equal(window[2].content, 'three');
});

test('a window that does not end on a user turn is left alone', () => {
  // Cannot happen through ask(), and returning a doctored assistant turn would
  // be worse than returning nothing.
  assert.deepEqual(withClock([u('one'), a('two')], new Date()), [u('one'), a('two')]);
  assert.deepEqual(withClock([], new Date()), []);
});

/* dateTurns answers "yesterday you said", which across a weekend is otherwise a
   guess — the prompt asks for continuity and forbids inferring the date from
   the conversation, which leaves the turns themselves as the only source. */

const stored = (role, content, created_at) => ({ role, content, created_at });

test('each exchange is anchored to the day it happened', () => {
  const out = dateTurns([
    stored('user', '[weekday briefing]', '2026-08-21T12:00:00Z'),
    stored('assistant', 'Gold is at 4512.', '2026-08-21T12:00:05Z'),
  ]);
  assert.equal(out[0].content, '[Fri 21 Aug] [weekday briefing]');
});

test('her own words are handed back unchanged', () => {
  // Prefixing an assistant turn reads as though she said the date herself.
  const out = dateTurns([stored('assistant', 'Gold is at 4512.', '2026-08-21T12:00:00Z')]);
  assert.deepEqual(out, [{ role: 'assistant', content: 'Gold is at 4512.' }]);
});

test('the day is New York\'s, so a late turn is not filed under tomorrow', () => {
  // 03:42 UTC is still Friday evening in New York — the same boundary the
  // filing day and the briefing hour are kept in.
  const out = dateTurns([stored('user', 'hola', '2026-08-22T03:42:00Z')]);
  assert.equal(out[0].content, '[Fri 21 Aug] hola');
});

test('created_at never leaks into the turn the API is sent', () => {
  const out = dateTurns([stored('user', 'hola', '2026-08-21T12:00:00Z')]);
  assert.deepEqual(Object.keys(out[0]).sort(), ['content', 'role']);
});
