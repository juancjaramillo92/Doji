/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — Edge Function tests
   ───────────────────────────────────────────────────────────────────────────
   Covers the pure exports of all three Edge Functions — doji-mcp-sync,
   doji-telegram and doji-eugenia. Each guards every Deno touch behind env() and
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

import {
  foldPosition, nyDay, ozFromVolume, usdFromCents,
  lookbackFor, foldHours, balanceTarget, secretMatches, parseSse, marketOpen
} from '../supabase/functions/doji-mcp-sync/index.ts';

import { SETUPS, parseCallback, renderMessage, staysOpen } from '../supabase/functions/doji-telegram/index.ts';
import { briefDue, greeting, chunk, TG_LIMIT, tradesQuery } from '../supabase/functions/doji-eugenia/index.ts';

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

test('the journal read is bounded, so a wide window cannot fill the context', () => {
  assert.match(tradesQuery(365, NOW), /limit=400/);
});
