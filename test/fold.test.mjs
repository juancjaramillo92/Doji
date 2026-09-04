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
import { secretMatches, nyClock, nyDate, marketOpen } from '../supabase/functions/_shared/edge.ts';

import {
  foldPosition, nyDay, ozFromVolume, usdFromCents,
  lookbackFor, foldHours, balanceTarget, parseSse,
  fromPipettes, foldSpot, PIPETTES, openPlans,
} from '../supabase/functions/doji-mcp-sync/index.ts';

import { SETUPS, COLUMNS, answered, parseCallback, renderMessage, staysOpen } from '../supabase/functions/doji-gladys/index.ts';
import { emailRow, answerFor } from '../supabase/functions/doji-email-sync/index.ts';
import {
  briefDue, pulseDue, retryDue, dueNow, isSilent, briefingMarker, briefedQuery,
  greeting, chunk, TG_LIMIT, tradesQuery, openOnUser, nowBlock, withClock, dateTurns,
  notesList, channelsList, searchList, readStrategy, dayQuery, ask,
  consolidateRetryDue, thesisLine, loopsList, calendarList, keepDraft,
  parseFeedback, feedbackKeyboard, stamped, apologyFor, APOLOGY, LOOP_KINDS,
  moveWorth, MOVE_SHARE, MOVE_FLOOR, MOVE_QUIET_H, MARK_STALE_MIN,
  quoteWindow, ROLL_HOUR,
  foldVectors, EMBED_DIMS,
  speaksBack, SPEAK_MAX,
  VOICE_TROUBLE,
  positionsList,
} from '../supabase/functions/doji-eugenia/index.ts';
import {
  checkRules, adherenceList, settle, dayStanding, easter, marketHolidays,
  nyInstant, nyWall, crossesFridayClose, nearFridayClose, CLOSEOUT_MIN,
  SWEEP_MIN, DAY_LOSS, STRETCH,
} from '../supabase/functions/doji-eugenia/adherence.ts';
import { CHANNELS, CHANNEL_STATES } from '../supabase/functions/doji-eugenia/prompt.ts';
import { ALWAYS } from '../supabase/functions/doji-eugenia/strategy.ts';

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

/* ═══════════════════════════════════════════════════════════════════════════
   THE ANCHOR — a real get_deals response, and a real email about one of its
   trades
   ───────────────────────────────────────────────────────────────────────────
   `fixtures/ctrader-get-deals.txt` is the body cTrader actually returned for a
   week of this account, captured through the poller's own ?raw=1 — SSE framing,
   JSON-RPC envelope, double-encoded payload and all. Everything else in this
   section runs on deals invented below, which is the belief the email fixture
   exists to stop trusting; this is the other half of that.

   AND THE TWO FIXTURES OVERLAP. Position 577885869 is in both: the poller saw
   its deals, and `ctrader-stop-loss-filled.html` is the email Pepperstone sent
   about the same fill. Two independent records of one trade, from two
   different systems, neither built by anyone here — so the fold can be checked
   against something other than its own arithmetic. That is as close to an
   end-to-end test as a repository with no live broker can get.
   ═══════════════════════════════════════════════════════════════════════════ */

const RAW_DEALS = readFileSync(
  new URL('./fixtures/ctrader-get-deals.txt', import.meta.url), 'utf8');

const REAL_DEALS = JSON.parse(parseSse(RAW_DEALS).result.content[0].text).deals;

/* The poller's own source, read once: the Deal interface is the only statement
   in this repository of what a deal IS, and both the real capture and the
   builder below are checked against it. */
const POLLER_SRC = readFileSync(
  new URL('../supabase/functions/doji-mcp-sync/index.ts', import.meta.url), 'utf8');

const declaredDealFields = () => {
  const block = POLLER_SRC.match(/interface Deal \{([^}]*)\}/);
  assert.ok(block, 'the poller no longer declares a Deal interface');
  const fields = [...block[1].matchAll(/([a-zA-Z]+)\??\s*:/g)].map(m => m[1]);
  // WITHOUT THIS EVERY LOOP BELOW IS VACUOUS: an emptied interface declares
  // nothing, so nothing is checked and both tests pass saying so.
  assert.ok(fields.length >= 8,
    `only ${fields.length} fields read out of the interface — the reader has gone blind`);
  return fields;
};

test('the real response is read through its framing, its envelope and its double encoding', () => {
  /* Three layers, and the synthetic parseSse tests further down build only the
     first. `data:` lines carrying a JSON-RPC envelope whose one content block
     is a STRING that is itself a JSON document — parseSse handles the outside
     and mcpCall parses the inside twice, which is a shape nobody would
     invent. */
  assert.match(RAW_DEALS, /^event: message\ndata: \{/);
  assert.equal(REAL_DEALS.length, 41);
  assert.equal(JSON.parse(parseSse(RAW_DEALS).result.content[0].text).hasMore, false);
});

test('every field the poller declares is on every deal cTrader actually sent', () => {
  // The interface is a SUBSET on purpose — the real deals also carry orderId,
  // which nothing here reads. What matters is the other direction: a field the
  // fold depends on that the broker does not send.
  for (const d of REAL_DEALS) {
    for (const field of declaredDealFields()) {
      assert.ok(field in d, `deal ${d.dealId} has no ${field}`);
    }
  }
});

test('commission really does arrive negative, which is why the column stores a magnitude', () => {
  // The schema's check constraint refuses a negative commission, so foldPosition
  // takes the absolute value. That was a claim about cTrader until now.
  assert.ok(REAL_DEALS.every(d => d.commission < 0),
    'cTrader has started reporting commission positive — foldPosition would now flip a sign');
});

test('a real trade folds to the numbers the broker emailed about the same trade', () => {
  /* THE ONE TEST HELD AGAINST SOMETHING NOBODY IN THIS REPOSITORY WROTE — and
     the JOIN ITSELF comes out of the email too. The position id is the email's
     own, not a number typed here, so replacing either capture moves the whole
     comparison rather than leaving it pointed at a trade that is no longer in
     both. */
  const email = readFileSync(
    new URL('./fixtures/ctrader-stop-loss-filled.html', import.meta.url), 'utf8')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

  // Each field stated as the shape the broker writes it in, so a pattern that
  // stops matching fails loudly rather than comparing undefined to undefined.
  const said = (re, what) => {
    const m = email.match(re);
    assert.ok(m, `the saved email no longer states its ${what}`);
    return m[1];
  };

  const id = said(/\b(PID\d+)\b/, 'position id');
  const mine = REAL_DEALS.filter(d => `PID${d.positionId}` === id);
  assert.equal(mine.length, 2, `${id} is not a two-deal position in the saved response`);

  const folded = foldPosition(mine, USER);
  assert.equal(folded.id, id, 'the two fixtures no longer describe the same position');

  // Direction: the email states the POSITION side, and foldPosition reads it
  // off the earliest deal. Two different derivations, one answer.
  assert.equal(folded.direction, said(/Direction\s+(BUY|SELL)\b/, 'direction'));

  // The closing price, which the email calls the fill price.
  assert.equal(folded.exit_price, Number(said(/Fill price\s+([\d.]+)/, 'fill price')));

  /* THE SIZE, AND IT IS THE REASON THE COLUMN IS IN OUNCES. cTrader sends the
     poller a volume of 400 and it divides by 100; the email prints `Oz 4.00`
     for the same position. Two systems, two units on the wire, one number — so
     storing anything but ounces would mean converting away from what both of
     them actually said. */
  assert.equal(folded.size_oz, Number(said(/Volume\s+Oz\s+([\d.]+)/, 'volume')));

  /* And the settled figure. gross is (entry − exit) × oz for a short:
     (4485.77 − 4512.80) × 4 = −108.12, which is the email's Gross P&L; less the
     commission it is −108.40, which is the email's Net P&L. They agree to the
     cent only because swap was zero on this trade — it opened and closed inside
     one New York session — and a position held through 17:00 would not. */
  assert.equal(folded.computed_pnl,
    Number(said(/Net P&L\s+USD\s+(-?[\d.]+)/, 'net P&L')));
  // Read off the deals, not typed: the magnitude of what both of them charged.
  assert.equal(folded.commission,
    Math.abs(mine.reduce((sum, d) => sum + d.commission, 0)) / 100);

  /* THE FILL TIME, AGAINST A TIMESTAMP. The email writes it in local words and
     the deals in milliseconds, so this is the one place the parser's reading of
     that string is checked against a machine-readable instant for the same
     event. It confirms the instant, NOT the day-first rule — 19 cannot be a
     month, so this trade would parse the same either way. That rule is pinned
     by an ambiguous date in test/parse.test.mjs and only there. */
  const fill = email.match(/Fill time\s+(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  assert.ok(fill, 'the saved email no longer states its fill time');
  const [, dd, mo, yyyy, hh, mm, ss] = fill;

  const closedAt = Math.max(...mine.map(d => d.executionTimestamp));
  assert.equal(`${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`,
    new Date(closedAt).toISOString().replace(/\.\d+Z$/, 'Z'));

  // And the filing day is the ENTRY's New York day, which is a different deal
  // from the one the email is about.
  const openedAt = Math.min(...mine.map(d => d.executionTimestamp));
  assert.equal(folded.open_day, nyDay(openedAt));
});

test('a real position held overnight is filed under the day it OPENED', () => {
  /* THE FILING ANCHOR, ON TRADES THAT ACTUALLY CROSSED A NEW YORK MIDNIGHT.
     The cross-check above cannot see this rule: its trade opened and closed in
     one session, so entry and close give the same day and reading the wrong
     deal is invisible. The capture holds two positions that did span the
     boundary, and they are the only place in the suite where a real fill
     settles it.

     Found rather than named: a position id typed here would go stale the day
     the fixture is replaced, and the point is that the CAPTURE contains such a
     trade, not that one particular trade does. */
  const byPosition = new Map();
  for (const d of REAL_DEALS) {
    if (!byPosition.has(d.positionId)) byPosition.set(d.positionId, []);
    byPosition.get(d.positionId).push(d);
  }

  const overnight = [...byPosition.values()].filter(ds => {
    const at = ds.map(d => d.executionTimestamp);
    return nyDay(Math.min(...at)) !== nyDay(Math.max(...at));
  });
  assert.ok(overnight.length,
    'no position in the saved response crosses a New York day — replace it with a capture that does');

  for (const ds of overnight) {
    const at = ds.map(d => d.executionTimestamp);
    assert.equal(foldPosition(ds, USER).open_day, nyDay(Math.min(...at)),
      'a position was filed under the day it closed rather than the day it opened');
  }
});

/* THE BUILDER AGAINST THE SAME INTERFACE.

   Every fold test below runs on deals this file invents. The capture above is
   what holds the interface to cTrader; this holds the builder to the interface,
   so a field added or renamed in the source cannot leave the synthetic deals
   behind. A field DROPPED is still not caught — fewer declared fields is fewer
   things to check. */

test('a built deal carries every field the poller declares it reads', () => {
  const built = deal({ side: 'SELL', price: 3400 });
  for (const field of declaredDealFields()) {
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

  /* AND THE SIZE IS WHAT WAS OPENED, NOT WHAT HAS CLOSED SO FAR. The two are
     equal on every fully closed position, so the anchor above cannot tell them
     apart — a fold reporting closeOz passes every other test in this file and
     would report 1.00 oz for a 2.00 oz position that is half out. */
  assert.equal(row.size_oz, 2);
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

/* ─── Telegram: an answer written somewhere else ─────────────────────────────
   The app writes the same four columns, and for as long as nothing told Gladys
   so, journalling a trade in the app left her message reading `Setup: —` for
   the life of the trade. supabase/002_gladys.sql now fires on the update and
   sends the row with the answers AS THEY STOOD, and doji-gladys decides the
   redraw from that before-state with answered() — the same expression
   staysOpen() applies to a tap.

   THEY HAVE TO STAY THE SAME EXPRESSION, because a tap fires both: the webhook
   redraws, and the write it just made fires the trigger, which redraws again.
   Two answers that differed would leave the message wherever the SECOND one
   landed — and the second one is the trigger, so a form reopened with [Edit]
   would shut under the correction being made in it.
   ───────────────────────────────────────────────────────────────────────── */

test('a trade missing any one answer is not answered', () => {
  /* All four, and the setup counts. answered() is the whole gate on settling —
     a message that settled without a setup would read
     `Logged · SELL 3400.00 · null`, and the app path would settle a trade the
     app itself still shows as pending. */
  for (const missing of ['setup', 'followed_rules', 'followed_sl', 'followed_tp']) {
    assert.equal(answered({ ...settled, [missing]: null }), false, missing);
  }
  assert.equal(answered(settled), true);
});

test('the trigger and a tap decide the redraw identically, on every before-state', () => {
  // Driven off a real payload rather than a hand-built Tap, so a change to the
  // grammar that stopped producing an `answer` reaches this too.
  const tap = parseCallback('PID562780708|rules|1');

  for (const setup of [null, SETUPS[0]])
    for (const rules of [null, true])
      for (const sl of [null, false])
        for (const tp of [null, true]) {
          const before = { setup, followed_rules: rules, followed_sl: sl, followed_tp: tp };
          assert.equal(answered(before), staysOpen(tap, before),
            `the two halves disagree on ${JSON.stringify(before)}`);
        }
});

test('journalling from the app settles the message, exactly as a fourth tap does', () => {
  /* The app writes all four columns in ONE update, so the trigger sees a
     before-state with every answer null against a row with every answer in —
     a sequence no tap can produce, and the one the complaint was about. */
  const before = { setup: null, followed_rules: null, followed_sl: null, followed_tp: null };
  const drawn = renderMessage(settled, answered(before));

  assert.equal(drawn.reply_markup.inline_keyboard.length, 1, 'the form did not settle');
  assert.equal(drawn.text, renderMessage(settled, false).text,
    'the app path and a fourth tap draw different summaries');
});

test('correcting a settled trade from the app reopens the form, as a tap does', () => {
  // Complete before the write, so this is a correction rather than a last
  // answer — and a correction leaves the form open whoever made it. Deciding
  // that from the ROW rather than from the writer is what lets the trigger a
  // tap fires agree with the tap's own redraw.
  const corrected = { ...settled, followed_tp: true };
  const viaApp = renderMessage(corrected, answered(settled)).reply_markup.inline_keyboard;
  const viaTap = renderMessage(corrected, staysOpen(parseCallback('PID562780708|tp|1'), settled))
    .reply_markup.inline_keyboard;

  assert.equal(viaApp.length, 5, 'the reopened form is missing a row');
  assert.deepEqual(viaApp, viaTap);
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

/* DRIVEN AS THE LOOP ACTUALLY RUNS, not called with a hand-picked flag.

   dueNow now takes a second fact — whether tonight's pass has already run — and
   asserting on it with a fixed `true` or `false` would be the exact shape of
   test this repository has been bitten by: one that supplies the answer and so
   cannot discover that the answer is never produced. The pass at 22:00 records
   itself, which is what makes 23:00 a retry rather than a second pass, and only
   a walk that carries that state forward can show it.

   `passFails` is the night the recording never happens. Everything else is the
   ordinary sequence. */
const timetable = (briefed, passFails = false) => {
  const owed = [];
  const done = new Set();
  for (let h = 0; h < 24 * 7; h++) {
    const at  = new Date(Date.UTC(2026, 7, 16, h));
    const due = dueNow(at, briefed, done.has(nyDate(at)));
    if (!due) continue;
    owed.push(`${at.toISOString().slice(0, 16)} ${due}`);
    if (due === 'consolidate' && !passFails) done.add(nyDate(at));
  }
  return owed;
};

test('an ordinary week owes one briefing and one pulse a day, and nothing else', () => {
  // August, so New York is EDT: 08:00 ET is 12:00 UTC, 10:00 ET is 14:00, and
  // the Sunday open at 17:00 ET is 21:00.
  // And 22:00 ET is 02:00 UTC the NEXT day, so each night's consolidation sorts
  // ahead of the morning it precedes rather than after the day it is about.
  assert.deepEqual(timetable(true), [
    '2026-08-16T02:00 consolidate', '2026-08-16T21:00 sunday',
    '2026-08-17T02:00 consolidate', '2026-08-17T12:00 weekday', '2026-08-17T14:00 pulse',
    '2026-08-18T02:00 consolidate', '2026-08-18T12:00 weekday', '2026-08-18T14:00 pulse',
    '2026-08-19T02:00 consolidate', '2026-08-19T12:00 weekday', '2026-08-19T14:00 pulse',
    '2026-08-20T02:00 consolidate', '2026-08-20T12:00 weekday', '2026-08-20T14:00 pulse',
    '2026-08-21T02:00 consolidate', '2026-08-21T12:00 weekday', '2026-08-21T14:00 pulse',
    '2026-08-22T02:00 consolidate',
  ]);
});

test('a week of failed briefings owes the retry hours, and the pulse gives way', () => {
  // 09:00, 10:00 and 11:00 ET are 13:00, 14:00 and 15:00 UTC. 14:00 is the one
  // hour the pulse also wants, and the retry takes it: a second look at a
  // morning he was never told about is not what is missing.
  // Consolidation is untouched by any of it: it is not a briefing, so a briefing
  // that failed neither delays nor replaces it.
  const day = (d) => [`2026-08-${d}T02:00 consolidate`,
                      `2026-08-${d}T12:00 weekday`, `2026-08-${d}T13:00 weekday`,
                      `2026-08-${d}T14:00 weekday`, `2026-08-${d}T15:00 weekday`];
  assert.deepEqual(timetable(false), [
    '2026-08-16T02:00 consolidate', '2026-08-16T21:00 sunday',
    ...day('17'), ...day('18'), ...day('19'), ...day('20'), ...day('21'),
    '2026-08-22T02:00 consolidate',
  ]);
});

test('the timetable holds its New York hours in winter too', () => {
  // January: EST (UTC-5), so every hour above moves one later in UTC.
  const owed = [];
  const done = new Set();
  for (let h = 0; h < 24; h++) {
    const at  = new Date(Date.UTC(2026, 0, 14, h));   // Wed 14 Jan
    const due = dueNow(at, true, done.has(nyDate(at)));
    if (!due) continue;
    owed.push(`${at.toISOString().slice(11, 16)} ${due}`);
    if (due === 'consolidate') done.add(nyDate(at));
  }
  // 03:00 UTC on the 14th is 22:00 ET on the 13th — the previous night's
  // consolidation, which is what a fixed UTC day of a New York timetable looks
  // like from the inside.
  assert.deepEqual(owed, ['03:00 consolidate', '13:00 weekday', '15:00 pulse']);
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

test('the retry asks the database for exactly what a briefing stores', () => {
  /* Both markers, or the briefing that stores the missing one is never seen and
     the 09:00 retry sends a second. The equality is the database's now: the
     filter names the two strings and nothing else can satisfy it, so a question
     merely mentioning the word cannot suppress a real briefing. */
  const q = briefedQuery();
  assert.equal(q.split('?')[0], 'eugenia_turns');
  for (const due of ['weekday', 'sunday']) {
    assert.ok(q.includes(encodeURIComponent(briefingMarker(due))),
      `briefedQuery does not name the ${due} marker — that briefing would go ` +
      `unseen and the retry would generate and send another one`);
  }
  assert.ok(!q.includes(encodeURIComponent('[pulse]')));
});

test('the retry reads one row, not a window that a busy morning can overflow', () => {
  /* This is the defect it replaced. Scanning the last thirty user turns for the
     marker is correct on a quiet morning and wrong on a talkative one: thirty
     messages between 08:00 and 09:00 push it out, briefedToday answers "no",
     and the retry pays for a whole second briefing and sends it. A filter on
     the marker cannot be crowded out, however much was said around it. */
  const q = briefedQuery();
  assert.match(q, /limit=1(&|$)/);
  assert.match(q, /order=id\.desc/);
  // The marker is written as the USER turn of the stored pair; her half is the
  // briefing itself, which would match nothing here anyway.
  assert.match(q, /role=eq\.user/);
});

/* ─── Eugenia: what he can see of her memory ─────────────────────────────────
   notesBlock renders the notes for HER, framed as instructions to obey.
   notesList renders the same rows for HIM, and is the only window he has into
   what she is keeping — everything in there was written by her, a fact
   silently, so an unreadable memory is one he can only audit by noticing an
   absence.
   ───────────────────────────────────────────────────────────────────────── */

// The map rides in the same message, so every case below supplies one.
const MAP = CHANNELS.map(([channel]) => ({ channel, state: 'unseen', evidence: null, moved_on: null }));

test('the listing carries the id each note is named by', () => {
  // The number is how a note is retired. Without it he can read what she holds
  // and still not be able to tell her which line to drop.
  const out = notesList([{ id: 14, note: 'keep it under 1400' }],
                        [{ id: 12, note: 'he trades the London open' }], MAP);
  assert.match(out, /\[14\] keep it under 1400/);
  assert.match(out, /\[12\] he trades the London open/);
});

test('what he told her and what she noticed stay apart, and in that order', () => {
  // Run together they invite exactly the confusion notesBlock keeps out of her
  // context: an instruction is not an observation to be weighed against one.
  const out = notesList([{ id: 2, note: 'stop mentioning the ten-year' }],
                        [{ id: 1, note: 'he has the dollar channel' }], MAP);
  assert.ok(out.indexOf('[2]') < out.indexOf('[1]'),
    'the instructions must come first — they are the half that is not optional');
  assert.match(out, /told me/);
  assert.match(out, /noticed/);
});

test('an empty memory says so, and an empty half prints no heading', () => {
  // A blank reply reads as a bot that failed rather than one holding nothing.
  assert.match(notesList([], [], MAP), /have not kept any notes/);
  assert.ok(!notesList([], [{ id: 1, note: 'x' }], MAP).includes('told me'));
  assert.ok(!notesList([{ id: 1, note: 'x' }], [], MAP).includes('noticed'));
});

test('the whole audit is addressed to him, never about him', () => {
  /* THE DEFECT THIS EXISTS TO CATCH. The map used to be appended by
     channelsBlock(), which is written for HER context and opens "Where he
     stands on each channel" — so the one message in the system addressed to
     him switched into the third person about him halfway down. The map is not
     optional here: it is the half of her memory he could never see at all.

     Read as a whole rather than by heading, because the failure was a heading
     from the other rendering leaking in, and any of them would do it. */
  const out = notesList([{ id: 2, note: 'stop mentioning the ten-year' }],
                        [{ id: 1, note: 'he trades the London open' }], MAP);
  for (const [, name] of CHANNELS) {
    assert.ok(out.includes(name), `${name} is missing from his own audit`);
  }
  assert.ok(!/\bhe stands\b/.test(out),
    `the map is still worded about him rather than to him: ${out}`);
  assert.match(out, /Where you stand on each channel/);
});

/* ─── Eugenia: where he stands on each channel ───────────────────────────────
   The five channels are the only part of her memory that does not scroll, and
   the only place an ABSENCE is legible. Everything below is about that second
   property: a channel he has never touched has to SHOW, because in her notes it
   is nothing written down, and nothing is not a thing anyone can notice.
   ───────────────────────────────────────────────────────────────────────── */

test('a channel with no row shows at the bottom rung, never vanishes', () => {
  /* THE DEFECT THIS EXISTS TO CATCH. The map renders what the database gives
     it, so a channel that was never seeded — or was dropped in a repair — would
     simply not appear, and the one thing the map is for is that a channel he
     has never used is VISIBLE. Silently showing four channels reads exactly
     like a trader who has covered the fifth. */
  const out = channelsList([{ channel: 'dollar', state: 'owns', evidence: null, moved_on: null }]);
  for (const [, name] of CHANNELS) {
    assert.ok(out.includes(name), `${name} is missing from the map entirely`);
  }
  assert.match(out, /jobs — unseen/);
});

test('the map is rendered in the order the prompt teaches them', () => {
  // Not in whatever order PostgREST returns. A stable order is what keeps a
  // rung from looking like it moved when nothing did.
  const shuffled = [...CHANNELS].reverse()
    .map(([channel]) => ({ channel, state: 'used', evidence: null, moved_on: null }));
  const out = channelsList(shuffled);
  const at = CHANNELS.map(([, name]) => out.indexOf(name));
  assert.deepEqual(at, [...at].sort((a, b) => a - b),
    'the map no longer reads in the order prompt.ts declares');
});

test('she is shown the name she says, never the id she stores', () => {
  /* "central_bank_buying" is not something a person says across a desk, and a
     prompt that hands her one is a prompt that will eventually see it repeated
     back to him.

     The underscore is the test rather than the id itself, and that is not
     laziness: three of the five ids ARE their own display words — `jobs` is
     `jobs`, and `inflation` is a substring of two of the names — so asking
     whether an id appears is a question that cannot be answered. What can be
     answered is whether anything MACHINE-SHAPED got through, and snake_case is
     the whole of what that means here. */
  const out = channelsList(CHANNELS.map(([channel]) => ({ channel, state: 'owns', evidence: null, moved_on: null })));
  assert.ok(!out.includes('_'), `a raw channel id reached her: ${out}`);
});

test('the evidence rides with the rung when there is any', () => {
  // A rung with no reason behind it is a number she cannot argue with, and the
  // nightly pass has to be able to see what it is about to overwrite.
  const withIt = channelsList([{ channel: 'jobs', state: 'used', evidence: 'he asked what the claims trend implies', moved_on: null }]);
  assert.match(withIt, /jobs — used \(he asked what the claims trend implies\)/);
  // And leaves no empty brackets when there is none.
  assert.ok(!channelsList([{ channel: 'jobs', state: 'used', evidence: null, moved_on: null }]).includes('()'));
});

/* THE DATE IS WHAT KEEPS THE MAP FROM GOING BLIND. Nothing brings a rung down
   but him saying he has lost one, so a year of ordinary use piles every channel
   he has touched at `owns` and the census stops being able to say which one is
   thin — which is the only thing it is for. `moved_on` was written from the
   first day and rendered by nobody. */

test('a rung says when it last moved', () => {
  const out = channelsList([
    { channel: 'dollar', state: 'owns', evidence: 'he got there unaided', moved_on: '2026-03-12' },
  ]);
  assert.match(out, /the dollar — owns since 12 Mar \(he got there unaided\)/);
});

test('the stored civil day is the day shown, not the day before it', () => {
  /* moved_on is written by setChannel as a NEW YORK civil day. Read back
     through a New York formatter it moves: new Date('2026-03-12') is midnight
     UTC, which is 19:00 on the 11th in New York, so every rung in the map would
     read a day early — quietly, and in the one column that says how stale a
     rung is. Both halves of the year, since this is the shape of mistake that
     only shows up in one of them. */
  assert.match(channelsList([{ channel: 'jobs', state: 'used', evidence: null, moved_on: '2026-03-12' }]),
    /jobs — used since 12 Mar/);
  assert.match(channelsList([{ channel: 'jobs', state: 'used', evidence: null, moved_on: '2026-01-01' }]),
    /jobs — used since 1 Jan/);
});

test('a rung that has never moved says nothing rather than a blank date', () => {
  // Every channel is seeded before anything is known, so a null moved_on is the
  // ordinary case rather than an error, and "since " with nothing after it
  // would be the map reporting a fault that is not one.
  const out = channelsList([{ channel: 'jobs', state: 'unseen', evidence: null, moved_on: null }]);
  assert.match(out, /jobs — unseen/);
  assert.ok(!out.includes('since'), out);
});

test('the bottom rung is the first one, because the map falls back to it', () => {
  // channelsList renders a missing row at CHANNEL_STATES[0]. Reorder the ladder
  // and every unseeded channel would render as owned — the exact inversion that
  // would make a thin channel look covered.
  assert.equal(CHANNEL_STATES[0], 'unseen');
});

/* ─── Eugenia: who said the thing the search found ───────────────────────────
   eugenia_turns carries `role` and eugenia_search did not select it, so every
   turn came back rendered as her own words — half of every result set was HIS
   messages handed back to her as things she had said. She would quote an
   instruction he gave as her own analysis, or deny saying something he said,
   fluently, with nothing reporting it. The role now rides in `source`.
   ───────────────────────────────────────────────────────────────────────── */

const AT = '2026-08-19T14:00:00Z';   // Wed 19 Aug 2026, 10:00 New York

test('his words come back as his, and hers as hers', () => {
  const out = searchList([
    { source: 'him', id: 7, at: AT, retired: false, body: 'stop mentioning the ten-year' },
    { source: 'you', id: 8, at: AT, retired: false, body: 'the gap between rates and inflation' },
  ]);
  assert.match(out, /he said\] stop mentioning the ten-year/);
  assert.match(out, /you said\] the gap between rates and inflation/);
});

test('a note is named by its id, and a retired one says it is no longer true', () => {
  // The id is how she retires one; RETIRED is what stops her repeating a belief
  // she has already corrected as though it were current.
  const out = searchList([
    { source: 'note', id: 12, at: AT, retired: false, body: 'he trades the London open' },
    { source: 'note', id: 3,  at: AT, retired: true,  body: 'he trades the New York open' },
  ]);
  assert.match(out, /note 12\] he trades the London open/);
  assert.match(out, /note 3, RETIRED — you no longer believe this\] he trades/);
});

test('every hit is dated, and a long one is cut rather than sent whole', () => {
  // A turn can be a whole briefing, and an unbounded result set would push the
  // conversation out of its own context.
  const [line] = searchList([
    { source: 'you', id: 1, at: AT, retired: false, body: 'x'.repeat(400) },
  ]).split('\n');
  assert.match(line, /^\[Wed 19 Aug, you said\] /);
  assert.ok(line.endsWith('…'), line.slice(-40));
  assert.ok(line.length < 400, `${line.length} characters is not a bounded hit`);
});

/* ─── Eugenia: the strategy she can read ─────────────────────────────────────
   A section she is cited to and cannot fetch is worse than a blank: readStrategy
   answers "there is no section 4.1", which is a wrong fact about the document,
   delivered by the one tool that exists to stop her inventing one.
   ───────────────────────────────────────────────────────────────────────── */

test('a subsection is served by the section that holds it', () => {
  // §4.1 and §4.2 are the only citations in the half she carries on every turn,
  // and both are written inside §4.
  for (const key of ['4.1', '4.2', '§4.1']) {
    assert.match(readStrategy(key), /## 4 · The setups/,
      `${key} does not resolve, and it is cited on every single turn`);
  }
});

test('a section that exists is served whole, with or without its sign', () => {
  assert.match(readStrategy('5'),  /## 5 · Risk/);
  assert.match(readStrategy('§5'), /## 5 · Risk/);
  assert.match(readStrategy(' 5 '), /## 5 · Risk/);
});

test('a section that genuinely is not written says so rather than nothing', () => {
  // The number comes from the model, so a mistyped or an invented one is what
  // arrives. An empty result is a blank she fills in herself.
  for (const key of ['1', '1.1', '11', 'nonsense', null, undefined]) {
    assert.match(readStrategy(key), /has no section/, `${key} came back silently`);
  }

  // A subsection of a section that IS written resolves to it — §4 is the thing
  // that would hold a §4.9, and handing it over lets her read that it is not
  // there. The fallback only reaches one level up, never to a guess.
  assert.match(readStrategy('4.9'), /## 4 · The setups/);
});

/* ─── Eugenia: the day the nightly pass reads ────────────────────────────────
   The limit has to take the NEWEST turns of the window. Taking the oldest is a
   pass that distils the morning and drops the evening — where a late
   instruction lives — and the two look identical from outside.
   ───────────────────────────────────────────────────────────────────────── */

test('the day window keeps the newest turns, never the oldest', () => {
  const q = dayQuery(24, Date.UTC(2026, 7, 19, 12, 0));
  assert.equal(q.split('?')[0], 'eugenia_turns');
  assert.match(q, /order=id\.desc/,
    'the pass reads the first N turns of the day and drops the rest of it');
  assert.match(q, /limit=\d+/);
});

test('the window starts exactly the stated number of hours back', () => {
  const at = Date.UTC(2026, 7, 19, 12, 0);
  assert.match(dayQuery(24, at), /gte\.2026-08-18T12:00:00/);
  assert.match(dayQuery(1, at),  /gte\.2026-08-19T11:00:00/);
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

test('the seam lands on a paragraph break, not on the last newline in budget', () => {
  /* THE DEFECT THIS EXISTS TO CATCH, and it was live for as long as chunk was.
     The split read Math.max(lastIndexOf('\n\n'), lastIndexOf('\n')) — and every
     blank line contains a newline at a higher index, so the paragraph term
     could never win and the break always went to the last newline of any kind.

     FORMAT permits exactly one thing to carry an internal newline: a plain-dash
     list of times. So the fixture is a paragraph, then such a list, and the
     break belongs before the list rather than inside it. */
  const para = 'Gold is at 3,412, up nine overnight. '.repeat(3).trim();
  const times = '- 08:30 ET claims\n- 10:00 ET Powell\n- 14:00 ET minutes';
  const text  = `${para}\n\n${times}\n\n${para}`;

  const parts = chunk(text, para.length + times.length + 3);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], para,
    `the break landed inside the list of times: ${JSON.stringify(parts[0].slice(-60))}`);
  assert.equal(parts[1], `${times}\n\n${para}`);
});

test('a paragraph break too early in the budget gives way to a newline', () => {
  // The order is a preference, not a rule: a blank line in the first half of
  // the window would waste most of a message, so a later plain newline wins.
  const parts = chunk(`short\n\n${'a'.repeat(60)}\nb`.trim(), 70);
  assert.ok(parts[0].length > 35, `the split gave up most of the budget: ${parts[0].length}`);
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

/* ─── Eugenia: which model actually answered ─────────────────────────────────
   `fallbacks: "default"` re-runs a declined request on another model inside the
   same call, and that is what stops a refusal costing the whole briefing. It
   also means the briefing he read can have been written by a model nothing in
   this system named — and on the page it reads exactly like one that was not.

   DRIVEN THROUGH ask() RATHER THAN ASSERTED ON THE COMPARISON. The comparison
   is one `!==` and was never the part at risk; the part at risk is the line
   never being printed, which asserting on a hand-fed flag cannot discover.
   ─────────────────────────────────────────────────────────────────────────── */

// Only what ask() actually reads out of a response.
const served = (model, rest) => ({
  ok: true,
  json: async () => ({ model, usage: { input_tokens: 10, output_tokens: 5 }, ...rest }),
});

const answers = (model) =>
  served(model, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'an answer' }] });

// get_strategy is the one tool the loop serves without a database read, which
// is what makes a second round drivable here at all.
const asksForStrategy = (model) =>
  served(model, { stop_reason: 'tool_use', content: [
    { type: 'tool_use', id: 'tu_1', name: 'get_strategy', input: { section: '§4.1' } }] });

// The cost line ask() printed while those responses were served, in order.
async function costLines(responses) {
  const realFetch = globalThis.fetch, realLog = console.log;
  const lines = [];
  let n = 0;
  globalThis.fetch = async () => responses[n++];
  console.log = (line) => lines.push(line);
  try {
    await ask([{ role: 'user', content: 'anything' }], 'medium', 'test');
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  return lines;
}

test('the ordinary turn says nothing about the model, because nothing happened', async () => {
  const [line] = await costLines([answers('claude-opus-5')]);
  assert.match(line, /test — 1 round\(s\), medium effort/);
  assert.doesNotMatch(line, /FELL BACK/);
});

test('a turn served by another model names it in the cost line', async () => {
  const [line] = await costLines([answers('some-other-model')]);
  assert.match(line, /FELL BACK TO some-other-model/);
});

test('a fallback on one round survives a later round that did not fall back', async () => {
  // Round one declines and is rescued; round two runs on the model that was
  // asked for. Clearing on the second would report the turn as ordinary, which
  // is the shape of every silent failure in this system.
  const [line] = await costLines([asksForStrategy('some-other-model'),
                                  answers('claude-opus-5')]);
  assert.match(line, /2 round\(s\)/);
  assert.match(line, /FELL BACK TO some-other-model/);
});

/* ─── A failed tool read must not take the answer with it ────────────────────
   THE 404 THAT COST A DAY. `eugenia_trades` was dropped and not rebuilt, and
   the briefing did not come out thinner — it died, four times, at 08:00 and at
   each retry, each one a single sentence saying something broke. tradesBlock
   had already absorbed the identical failure a round earlier, so what was left
   to kill the turn was the read the MODEL asked for.

   Driven through ask() rather than asserted on readTrades, for the reason the
   fallback tests above are: that readTrades returns a sentence is not the
   claim. The claim is that the loop carries on and hands that sentence to the
   next round, and only the sequence can show it.
   ─────────────────────────────────────────────────────────────────────────── */

const asksForTrades = (model) =>
  served(model, { stop_reason: 'tool_use', content: [
    { type: 'tool_use', id: 'tu_1', name: 'get_trades', input: { days: 7 } }] });

// Every request body ask() sent, with the journal read answering `status`.
// SB_URL is "" under Node, so PostgREST is the caller whose path starts /rest.
async function turnWithJournal(status, responses) {
  const realFetch = globalThis.fetch, realLog = console.log, realErr = console.error;
  const sent = [];
  let n = 0;
  globalThis.fetch = async (url, init) =>
    String(url).startsWith('/rest/')
      ? { ok: status === 200, status, json: async () => [] }
      : (sent.push(JSON.parse(init.body)), responses[n++]);
  console.log = () => {};
  console.error = () => {};
  try {
    const text = await ask([{ role: 'user', content: 'anything' }], 'medium', 'test');
    return { text, answered: sent[1].messages.at(-1).content[0].content };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realErr;
  }
}

const twoRounds = [asksForTrades('claude-opus-5'), answers('claude-opus-5')];

test('a journal read that 404s is answered to her, and the turn finishes', async () => {
  const { text, answered } = await turnWithJournal(404, twoRounds);
  assert.equal(text, 'an answer');
  assert.match(answered, /could not be read/);
});

test('a journal read that 404s never comes back as an empty window', async () => {
  // The one answer it must not give. "No trades in that window" from a window
  // nothing looked at is what a briefing reads as "you have not traded since
  // Friday" — a false statement about his own week, in her voice, with nothing
  // anywhere reporting that the read never happened.
  const { answered } = await turnWithJournal(404, twoRounds);
  assert.doesNotMatch(answered, /No trades in that window/);
});

test('an empty window still says it is empty, because that is an answer', async () => {
  const { answered } = await turnWithJournal(200, twoRounds);
  assert.match(answered, /No trades in that window/);
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE STRATEGY, EXECUTED — adherence.ts
   ───────────────────────────────────────────────────────────────────────────
   §7 writes a predicate for every rule and §8 writes the population filters and
   the three verdicts. Until now both were prose she applied by hand over four
   hundred rows of JSON, which is the one thing a model is worst at and where a
   wrong answer is least visible.

   EVERY RULE IS DRIVEN IN BOTH DIRECTIONS, and that is the whole point of this
   block rather than a stylistic preference. A predicate that can only be seen
   to return `pass` has not been shown to work — it has been shown to be
   reachable, which is what three "clean" results in this repository's history
   turned out to mean. So each rule below is given a row that satisfies it and a
   row that breaks it, and the third verdict is driven wherever the data can
   produce one.
   ═══════════════════════════════════════════════════════════════════════════ */

// A row with everything null but the id and a size, so each test names only the
// columns its own rule reads and nothing else can quietly be doing the work.
const trade = (o) => ({
  id: 'PID1', direction: 'BUY', entry_time: null, fill_time: null,
  entry_price: null, exit_price: null, pnl: null, open_day: null, setup: null,
  followed_rules: null, followed_sl: null, followed_tp: null,
  size_oz: 4, net_pnl: null, planned_sl: null, planned_tp: null, ...o,
});
const verdictOf = (rows, rule, now) =>
  checkRules(rows, now).find(r => r.rule === rule);

test('the worst outcome present is the verdict, and an empty population is unknown', () => {
  assert.equal(settle(3, 0, 0), 'pass');
  assert.equal(settle(3, 1, 0), 'fail');
  assert.equal(settle(3, 0, 1), 'unknown');
  assert.equal(settle(0, 1, 2), 'fail');
  // §8's own rule, and the one that matters: nothing checked is not a pass.
  assert.equal(settle(0, 0, 0), 'unknown');
});

test('R-01 flags a win that closed under $25, and spares the Friday close-out', () => {
  const win = (o) => trade({ pnl: 100, entry_price: 4000, open_day: '2026-01-06', ...o });

  assert.equal(verdictOf([win({ exit_price: 4030 })], 'R-01').verdict, 'pass');
  // Exactly $25 is the target, not a breach of it.
  assert.equal(verdictOf([win({ exit_price: 4025 })], 'R-01').verdict, 'pass');
  assert.equal(
    verdictOf([win({ exit_price: 4012, fill_time: '2026-01-06T18:00:00Z' })], 'R-01').verdict,
    'fail', 'a $12 win on a Tuesday is a discretionary exit and R-01 flags it');

  /* THE ONE EXCEPTION §6 CARVES, and it is narrow on purpose: R-15 forces a
     close at the Friday 17:00 New York close, so a forced exit at +$12 would be
     flagged every single week. 21:50Z is 16:50 in New York in January — inside
     the window — and the same trade at 19:00Z is 14:00 there and still a flag,
     which is exactly the pair §6 draws the line between. */
  assert.equal(
    verdictOf([win({ exit_price: 4012, fill_time: '2026-01-09T21:50:00Z' })], 'R-01').verdict,
    'unknown');
  assert.equal(
    verdictOf([win({ exit_price: 4012, fill_time: '2026-01-09T19:00:00Z' })], 'R-01').verdict,
    'fail');
});

test('R-02 checks the cap and nothing else', () => {
  const loss = (exit) => trade({ pnl: -80, entry_price: 4000, exit_price: exit, open_day: '2026-01-06' });
  // $20.00 exactly is the cap being honoured, and the tolerance is what stops a
  // float landing at 20.000000001 reporting a breach of a rule kept exactly.
  assert.equal(verdictOf([loss(3980)], 'R-02').verdict, 'pass');
  assert.equal(verdictOf([loss(3979)], 'R-02').verdict, 'fail');
  // A win is not R-02's population however far it travelled.
  assert.equal(
    verdictOf([trade({ pnl: 500, entry_price: 4000, exit_price: 4100, open_day: '2026-01-06' })], 'R-02').verdict,
    'unknown', 'R-02 has no losses to look at, which is unknown rather than clean');
});

test('R-10 catches two positions open at once, and an open one still counts', () => {
  const span = (id, from, to) => trade({ id, entry_time: from, fill_time: to });
  assert.equal(verdictOf([
    span('PIDa', '2026-01-06T10:00:00Z', '2026-01-06T12:00:00Z'),
    span('PIDb', '2026-01-06T11:00:00Z', '2026-01-06T13:00:00Z'),
  ], 'R-10').verdict, 'fail');

  assert.equal(verdictOf([
    span('PIDa', '2026-01-06T10:00:00Z', '2026-01-06T12:00:00Z'),
    span('PIDb', '2026-01-06T12:30:00Z', '2026-01-06T13:00:00Z'),
  ], 'R-10').verdict, 'pass');

  /* A STILL-OPEN POSITION EXTENDS TO NOW RATHER THAN TO NOTHING. A trade left
     running while a second one opened is the clearest breach this rule has, and
     reading a null fill_time as "no span" is exactly how it would be missed. */
  const now = Date.parse('2026-01-06T14:00:00Z');
  assert.equal(verdictOf([
    span('PIDa', '2026-01-06T10:00:00Z', null),
    span('PIDb', '2026-01-06T11:00:00Z', '2026-01-06T13:00:00Z'),
  ], 'R-10', now).verdict, 'fail');
});

/* ─── The breach that was counted as a pass ──────────────────────────────────
   R-10 COMPARED EACH SPAN WITH THE ONE BEFORE IT, which answers for a neighbour
   and not for the rule. A long hold covers everything opened inside it, so the
   second short trade taken within it sits beside a `to` that has already been
   left behind — and it came back counted as a PASS and named nowhere, while
   genuinely breaching.

   The verdict is what hid it. A span nested inside an earlier one always has a
   neighbour that overlaps as well, so something was always flagged and the rule
   always answered `fail` — which is why no test asserting on a verdict alone
   could ever have found this. THE COUNTS AND THE IDS ARE THE ASSERTION, and
   they are what she actually hands him: `check_rules` promises the rows behind
   the finding, and a breach missing from that list is one he cannot check.
   ─────────────────────────────────────────────────────────────────────────── */
test('every position inside a longer hold is a breach, not just the first', () => {
  const span = (id, from, to) => trade({ id, entry_time: from, fill_time: to });

  // Two short trades entirely inside one long one. All three were open at the
  // same time as something else, so all three breach R-10.
  const out = verdictOf([
    span('PIDlong',  '2026-01-06T10:00:00Z', '2026-01-06T14:00:00Z'),
    span('PIDfirst', '2026-01-06T10:30:00Z', '2026-01-06T10:45:00Z'),
    span('PIDthird', '2026-01-06T11:00:00Z', '2026-01-06T11:30:00Z'),
  ], 'R-10');

  assert.equal(out.verdict, 'fail');
  assert.equal(out.failed, 3, 'the trade nested inside the hold is a breach like the others');
  assert.equal(out.passed, 0, 'nothing here was a clean single position');
  assert.deepEqual([...out.ids].sort(), ['PIDfirst', 'PIDlong', 'PIDthird'],
    'a breach he is not handed the id of is one he cannot check');
});

test('a clean handover is still clean, however many of them there are', () => {
  /* THE OTHER DIRECTION, because a fix that flags everything would pass the
     test above and destroy the rule. Three trades back to back, each opening
     exactly as the last one closed — strict comparison, so touching endpoints
     are a handover rather than an overlap. */
  const span = (id, from, to) => trade({ id, entry_time: from, fill_time: to });
  const out = verdictOf([
    span('PID1', '2026-01-06T10:00:00Z', '2026-01-06T11:00:00Z'),
    span('PID2', '2026-01-06T11:00:00Z', '2026-01-06T12:00:00Z'),
    span('PID3', '2026-01-06T12:00:00Z', '2026-01-06T13:00:00Z'),
  ], 'R-10');
  assert.equal(out.verdict, 'pass');
  assert.equal(out.passed, 3);
  assert.deepEqual(out.ids, []);
});

test('R-11 reads the account off the size, and only flags trading after the limit', () => {
  // 4 oz × 500 = an implied account of 2,000, so the day's floor is −80.
  const leg = (id, pnl, from, to) =>
    trade({ id, pnl, open_day: '2026-01-06', entry_time: from, fill_time: to });

  assert.equal(verdictOf([
    leg('PIDx', -90, '2026-01-06T10:00:00Z', '2026-01-06T11:00:00Z'),
    leg('PIDy', 10,  '2026-01-06T12:00:00Z', '2026-01-06T13:00:00Z'),
  ], 'R-11').verdict, 'fail');

  // The same loss with nothing taken after it is the rule working.
  assert.equal(verdictOf([
    leg('PIDx', -90, '2026-01-06T10:00:00Z', '2026-01-06T11:00:00Z'),
  ], 'R-11').verdict, 'pass');

  // A limit with no denominator is not a limit. §8 withholds `balance` precisely
  // so the wrong one cannot be reached for, which leaves a day with no size
  // undecidable rather than clean.
  assert.equal(verdictOf([
    trade({ id: 'PIDz', pnl: -900, size_oz: null, open_day: '2026-01-06', fill_time: '2026-01-06T11:00:00Z' }),
  ], 'R-11').verdict, 'unknown');
});

test('R-12 separates a late second entry from a sweep it cannot see', () => {
  const entry = (id, at, filled) =>
    trade({ id, open_day: '2026-01-06', entry_time: at, fill_time: filled });

  assert.equal(verdictOf([entry('PIDa', '2026-01-06T10:00:00Z', '2026-01-06T10:30:00Z')],
    'R-12').verdict, 'pass');

  assert.equal(verdictOf([
    entry('PIDa', '2026-01-06T10:00:00Z', '2026-01-06T10:30:00Z'),
    entry('PIDb', '2026-01-06T11:30:00Z', '2026-01-06T12:00:00Z'),
  ], 'R-12').verdict, 'fail', `a second entry more than ${SWEEP_MIN} minutes later is a fail`);

  /* WITHIN THE WINDOW IS UNKNOWN, NOT PASS, and the difference is the whole
     honesty of this rule: nothing on a row says an entry was a sweep re-entry —
     §8 lists it among what is not stored — so a prompt second entry is
     undecidable by construction rather than permitted. */
  assert.equal(verdictOf([
    entry('PIDa', '2026-01-06T10:00:00Z', '2026-01-06T10:30:00Z'),
    entry('PIDb', '2026-01-06T10:40:00Z', '2026-01-06T11:00:00Z'),
  ], 'R-12').verdict, 'unknown');

  // Three is a fail whatever the timing, because the rule permits two.
  assert.equal(verdictOf(['a', 'b', 'c'].map((k, i) =>
    entry('PID' + k, `2026-01-06T1${i}:00:00Z`, `2026-01-06T1${i}:30:00Z`)),
    'R-12').verdict, 'fail');
});

test('R-13 allows the rung to move between months and not inside one', () => {
  assert.equal(verdictOf([
    trade({ id: 'PIDa', open_day: '2026-01-06', size_oz: 4 }),
    trade({ id: 'PIDb', open_day: '2026-01-20', size_oz: 6 }),
  ], 'R-13').verdict, 'fail');

  assert.equal(verdictOf([
    trade({ id: 'PIDa', open_day: '2026-01-06', size_oz: 4 }),
    trade({ id: 'PIDb', open_day: '2026-02-20', size_oz: 6 }),
  ], 'R-13').verdict, 'pass');
});

test('R-15 finds the Friday close inside a span, in both halves of the year', () => {
  const held = (from, to) => verdictOf([trade({ entry_time: from, fill_time: to })], 'R-15').verdict;

  // January: the close is 22:00Z. Entered Friday afternoon, out on Monday.
  assert.equal(held('2026-01-09T20:00:00Z', '2026-01-12T14:00:00Z'), 'fail');
  // Out before it.
  assert.equal(held('2026-01-09T20:00:00Z', '2026-01-09T21:30:00Z'), 'pass');
  // And through it by half an hour.
  assert.equal(held('2026-01-09T20:00:00Z', '2026-01-09T22:30:00Z'), 'fail');

  /* JULY, WHERE THE CLOSE IS 21:00Z RATHER THAN 22:00Z. A span ending at 21:30Z
     is over the close in summer and short of it in winter — which is the exact
     hour a fixed offset would get wrong, in the direction that reports a rule
     kept as a rule broken, every summer, for half the year. */
  assert.equal(held('2026-07-10T20:00:00Z', '2026-07-10T21:30:00Z'), 'fail');
  assert.equal(held('2026-07-10T20:00:00Z', '2026-07-10T20:30:00Z'), 'pass');

  // A midweek span never touches one.
  assert.equal(held('2026-01-06T14:00:00Z', '2026-01-07T14:00:00Z'), 'pass');
  // And a span too long to walk is answered rather than looped over.
  assert.equal(crossesFridayClose(new Date('2026-01-06T14:00:00Z'),
                                  new Date('2026-03-07T14:00:00Z')), null);
});

test('R-16 knows the market holidays, including the ones that move', () => {
  const on = (at) => verdictOf([trade({ entry_time: at })], 'R-16').verdict;

  // Good Friday 2026 is 3 April — the only moving holiday on the list, and the
  // reason the calendar is computed rather than typed.
  assert.equal(on('2026-04-03T14:00:00Z'), 'fail');
  // 4 July 2026 is a Saturday, so the market shuts on Friday the 3rd. A naive
  // date test calls that an open day.
  assert.equal(on('2026-07-03T14:00:00Z'), 'fail');
  // The Christmas stretch, which is an operational reading of §5 and is named.
  assert.equal(on('2026-12-28T14:00:00Z'), 'fail');
  assert.equal(on(`2026-12-${STRETCH.from}T14:00:00Z`), 'fail');
  assert.equal(on('2026-12-23T14:00:00Z'), 'pass');
  assert.equal(on('2026-07-06T14:00:00Z'), 'pass');
});

test('easter is right, which is what makes Good Friday right', () => {
  // Four known years. Getting this wrong shifts one holiday a year by weeks and
  // would look like a rule broken on a day the market was open.
  assert.deepEqual(easter(2024), { m: 3, d: 31 });
  assert.deepEqual(easter(2025), { m: 4, d: 20 });
  assert.deepEqual(easter(2026), { m: 4, d: 5 });
  assert.deepEqual(easter(2027), { m: 3, d: 28 });
});

test('the holiday set is the ten the market keeps, and nothing else', () => {
  const days = marketHolidays(2026);
  for (const d of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
                   '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']) {
    assert.ok(days.has(d), `${d} is a market holiday and is not in the set`);
  }
  for (const d of ['2026-01-02', '2026-03-17', '2026-07-06', '2026-11-25']) {
    assert.ok(!days.has(d), `${d} is an ordinary trading day and the set closes the market on it`);
  }
});

test('a New York wall time resolves to the instant it actually is', () => {
  // The whole reason this exists: 17:00 in New York is 22:00Z in January and
  // 21:00Z in July, and every Friday-close test above rests on it.
  assert.equal(new Date(nyInstant(2026, 1, 9, 17)).toISOString(), '2026-01-09T22:00:00.000Z');
  assert.equal(new Date(nyInstant(2026, 7, 10, 17)).toISOString(), '2026-07-10T21:00:00.000Z');
  // And the reading back, which is the half the formatter does.
  assert.equal(nyWall(new Date('2026-01-09T22:00:00Z')).hour, 17);
  assert.equal(nyWall(new Date('2026-01-09T22:00:00Z')).wd, 5);
});

test('the Friday close-out window is a window, not the whole day', () => {
  // 21:50Z is 16:50 New York — ten minutes before the close.
  assert.equal(nearFridayClose(new Date('2026-01-09T21:50:00Z')), true);
  // The far edge of it, exactly CLOSEOUT_MIN out.
  assert.equal(nearFridayClose(new Date(Date.parse('2026-01-09T22:00:00Z') - CLOSEOUT_MIN * 60000)), true);
  // One minute earlier is outside it.
  assert.equal(nearFridayClose(new Date(Date.parse('2026-01-09T22:00:00Z') - (CLOSEOUT_MIN + 1) * 60000)), false);
  // A Thursday at the same clock time is not a Friday close.
  assert.equal(nearFridayClose(new Date('2026-01-08T21:50:00Z')), false);
});

test('a day that has hit its limit says so, and one that has not does not', () => {
  const leg = (id, pnl) => trade({ id, pnl, open_day: '2026-01-06' });
  // 4 oz implies a 2,000 account, so the floor is −80.
  assert.equal(dayStanding([leg('PIDa', -90)], '2026-01-06').breached, true);
  assert.equal(dayStanding([leg('PIDa', -70)], '2026-01-06').breached, false);
  assert.equal(dayStanding([leg('PIDa', -40), leg('PIDb', -45)], '2026-01-06').breached, true);
  assert.equal(dayStanding([leg('PIDa', -90)], '2026-01-06').account, 2000);
  // The floor is the constant, not a number retyped here.
  assert.equal(dayStanding([leg('PIDa', -DAY_LOSS * 2000)], '2026-01-06').breached, true);
  // No rows and no size are both "cannot judge", never "fine".
  assert.equal(dayStanding([], '2026-01-06'), null);
  assert.equal(dayStanding([trade({ id: 'PIDa', pnl: -900, size_oz: null, open_day: '2026-01-06' })],
    '2026-01-06'), null);
});

test('pre-sync rows are outside every population', () => {
  // §8's first filter. A client-id row has no prices and null timestamps, and
  // sweeping them in is how a hunt for broker-data problems fills with false
  // positives.
  const old = { ...trade({ id: 'abc123', pnl: 100, entry_price: 4000, exit_price: 4012 }) };
  for (const r of checkRules([old])) {
    assert.equal(r.verdict, 'unknown', `${r.rule} read a pre-sync row into its population`);
  }
});

test('the render names the failures and says how much was unknown', () => {
  const line = adherenceList(checkRules([
    trade({ id: 'PIDa', open_day: '2026-01-06', entry_time: '2026-01-06T10:00:00Z', fill_time: '2026-01-06T10:30:00Z' }),
    trade({ id: 'PIDb', open_day: '2026-01-06', entry_time: '2026-01-06T11:30:00Z', fill_time: '2026-01-06T12:00:00Z' }),
  ])).split('\n').find(l => l.startsWith('R-12'));

  assert.match(line, /FAIL/);
  assert.match(line, /1 fail/);
  // The day is named, so a finding can be checked rather than believed.
  assert.match(line, /2026-01-06/);
});

test('every rule §7 marks journal is one this file actually evaluates', () => {
  /* THE COPY THAT WOULD OTHERWISE BE UNCHECKABLE. §7's table is the strategy's
     own statement of which rules a row can answer, and adherence.ts is a second
     list of the same fact in a different file. Marking a rule `journal` in the
     document without implementing it leaves her citing a check nobody runs;
     implementing one the document calls `judgment` is worse, because it starts
     reporting `pass` for something §8 says nothing stored can see. */
  const table = [...ALWAYS.matchAll(/^\| (R-\d\d) \|.*?\| (journal|field|judgment) \|/gm)];
  assert.ok(table.length >= 15, `read ${table.length} rules out of the table — the reader has gone blind`);

  const journal = table.filter(([, , kind]) => kind === 'journal').map(([, id]) => id).sort();
  const checked = checkRules([]).map(r => r.rule).sort();
  assert.deepEqual(checked, journal,
    'adherence.ts and §7 disagree about which rules a row can answer — either a ' +
    'rule the document calls checkable is never checked, or one it calls ' +
    'judgment is being reported as pass');
});

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT SHE CARRIES, AND WHAT SHE SAYS WHEN SOMETHING BREAKS
   ═══════════════════════════════════════════════════════════════════════════ */

test('the story carries the day it last moved, and an absent one says nothing', () => {
  const line = thesisLine({ thesis: 'The market is still trading the December cut.', moved_on: '2026-03-12' });
  assert.match(line, /December cut/);
  /* THE DATE IS FORMATTED OFF A MIDDAY UTC ANCHOR, because moved_on is a stored
     New York civil day: read back through a New York formatter, midnight UTC on
     the 12th is the 11th there and every thesis would read a day early. */
  assert.match(line, /12 Mar/);
  assert.equal(thesisLine(null), '');
});

test('the open threads are split by what closes them', () => {
  const out = loopsList([
    { id: 4, kind: 'watch', body: 'Gold rose on a hot print.', opened_on: '2026-03-12' },
    { id: 5, kind: 'question', body: 'Which does he think is bigger?', opened_on: '2026-03-13' },
  ]);
  assert.match(out, /What you flagged[\s\S]*\[4\]/);
  assert.match(out, /he has not answered[\s\S]*\[5\]/);
  // The id is how a thread is named when it is closed, so it is part of the line.
  assert.match(out, /\[4\]/);
  assert.equal(loopsList([]), '');
});

test('a landed release is never described as one still to come', () => {
  const out = calendarList([
    { id: 1, at: '2026-01-09T13:30:00Z', name: 'core CPI', importance: 'high',
      consensus: '0.3%', prior: '0.2%', actual: '0.4%', note: 'Hotter than expected.' },
    { id: 2, at: '2026-01-09T20:00:00Z', name: 'FOMC minutes', importance: 'high',
      consensus: null, prior: null, actual: null, note: null },
  ]);
  assert.match(out, /08:30 ET core CPI — LANDED at 0\.4%/);
  assert.match(out, /15:00 ET FOMC minutes — due/);
  assert.equal(calendarList([]), '');
});

test('the critic cannot destroy a briefing it was meant to check', () => {
  const draft = 'x'.repeat(1200);
  // A revision that came back empty, apologetic, or twice the length is a
  // critic that failed, and the draft it was handed is better than any of them.
  assert.equal(keepDraft(draft, ''), true);
  assert.equal(keepDraft(draft, 'Sorry, I cannot do that.'), true);
  assert.equal(keepDraft(draft, 'y'.repeat(2500)), true);
  // An ordinary edit goes through.
  assert.equal(keepDraft(draft, 'y'.repeat(1100)), false);
});

test('a tap under a briefing is read strictly or not at all', () => {
  assert.deepEqual(parseFeedback('fb|good|2026-03-12'), { verdict: 'good', day: '2026-03-12' });
  assert.deepEqual(parseFeedback('fb|off|2026-03-12'),  { verdict: 'off',  day: '2026-03-12' });
  assert.equal(parseFeedback('fb|maybe|2026-03-12'), null);
  assert.equal(parseFeedback('fb|good|yesterday'), null);
  assert.equal(parseFeedback('nope'), null);
  assert.equal(parseFeedback(undefined), null);
});

test('the keyboard stays inside the 64 bytes a tap may carry', () => {
  /* THE SAME CAP GLADYS IS BUILT AROUND, and it is the entire state a tap
     carries — no session table, no schema change on that path. A longer date
     format or a third button label is how it would silently overrun. */
  for (const row of feedbackKeyboard('2026-03-12').inline_keyboard) {
    for (const b of row) {
      assert.ok(new TextEncoder().encode(b.callback_data).length < 64,
        `${b.callback_data} is over Telegram's 64-byte callback_data limit`);
      assert.ok(parseFeedback(b.callback_data), `${b.callback_data} is not readable by parseFeedback`);
    }
  }
});

test('the clock reaches a turn whether it is a sentence or a chart', () => {
  const now = new Date('2026-03-12T18:00:00Z');
  assert.match(stamped('hola', now), /Right now it is/);

  /* A CHART ARRIVES AS BLOCKS, and string concatenation against an array is
     "[object Object]" attached to nothing — so the one line telling her what day
     it is would land somewhere she cannot read it, silently, on exactly the
     turns carrying the most context. */
  const blocks = stamped([{ type: 'image', source: {} }], now);
  assert.ok(Array.isArray(blocks));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'image');
  assert.match(blocks[1].text, /Right now it is/);
});

test('withClock stamps a picture turn as well as a typed one', () => {
  const out = withClock([{ role: 'user', content: [{ type: 'image', source: {} }] }],
                        new Date('2026-03-12T18:00:00Z'));
  assert.ok(Array.isArray(out[0].content));
  assert.match(out[0].content[1].text, /Right now it is/);
});

test('the apology names the job that actually died', () => {
  /* IT USED TO SAY "No briefing" FOR ALL OF THEM. A consolidation that died at
     22:00 reported itself as a missing briefing — sending him to look for the
     wrong thing at the wrong time of day, and describing the failure whose
     symptom is that her memory stops growing as the one whose symptom is a
     message that never arrived. */
  assert.match(apologyFor('briefing'), /No briefing/);
  assert.match(apologyFor('consolidate'), /nightly/);
  assert.match(apologyFor('pulse'), /second look/);
  assert.match(apologyFor('release'), /number/);
  // Every job says something different, or the map is not doing anything.
  const said = Object.values(APOLOGY);
  assert.equal(new Set(said).size, said.length, 'two jobs share an apology');
  // An unnamed job still gets an answer rather than "undefined".
  assert.equal(apologyFor('something new'), APOLOGY.briefing);
});

test('the audit he asks for carries everything she keeps', () => {
  /* `/notes` IS HIS ONE WINDOW INTO ANY OF IT, and it is answered from the
     database precisely so nothing can paraphrase or drop a row. An audit that
     shows three of the five things it audits is the defect it exists to
     prevent — and all of it is addressed to HIM, so nothing in it may switch
     into the third person about him. */
  const out = notesList(
    [{ id: 1, note: 'stop mentioning the ten-year' }],
    [{ id: 2, note: 'he trades the London open' }],
    [{ channel: 'dollar', state: 'used', evidence: null, moved_on: '2026-03-12' }],
    [{ id: 7, kind: 'watch', body: 'Gold rose on a hot print.', opened_on: '2026-03-11' }],
    { thesis: 'Still trading the December cut.', moved_on: '2026-03-12' });

  assert.match(out, /What you have told me/);
  assert.match(out, /What I have noticed/);
  assert.match(out, /What I flagged/);
  assert.match(out, /The story I am carrying/);
  assert.match(out, /Where you stand on each channel/);
  // Written to him: her own context block opens "Where he stands", and that
  // wording reaching this message is the bug this shape exists to stop.
  assert.ok(!/where he stands/i.test(out), 'the audit addressed to him talks about him in the third person');
});

test('the audit still works before any of the newer memory exists', () => {
  // The two new arguments default, so a database with 003 and not 005 answers
  // /notes rather than throwing on a read that returns nothing.
  const out = notesList([], [{ id: 2, note: 'he trades the London open' }],
    [{ channel: 'dollar', state: 'used', evidence: null, moved_on: null }]);
  assert.match(out, /What I have noticed/);
  assert.ok(!/The story I am carrying/.test(out));
});

test('the nightly pass gets a retry hour, and it is inside the same day', () => {
  // 23:00 New York is still the day the pass is filed under, which is what makes
  // "did tonight's pass run" a question with an answer.
  assert.equal(consolidateRetryDue(new Date('2026-01-14T04:00:00Z')), true);   // 23:00 EST
  assert.equal(consolidateRetryDue(new Date('2026-01-14T03:00:00Z')), false);  // 22:00 EST
  assert.equal(consolidateRetryDue(new Date('2026-07-15T03:00:00Z')), true);   // 23:00 EDT
});

test('a night that already distilled itself does nothing at the retry hour', () => {
  const at23 = new Date('2026-01-14T04:00:00Z');
  assert.equal(dueNow(at23, true, false), 'consolidate', 'a failed pass gets its second chance');
  assert.equal(dueNow(at23, true, true), null, 'a pass that ran does not run twice');
});

test('a voice note that produced no words says WHICH of the four things went wrong', () => {
  /* THEY WERE ONE SENTENCE, and that is the failure worth a test. A rejected
     key, a wrong URL, an unsupported format and genuinely unclear audio all
     reached him as "I could not make that out — send it again", so the one
     failure he cannot fix by speaking more clearly was the one he was told to
     try speaking more clearly for. */
  const said = Object.values(VOICE_TROUBLE);
  assert.equal(new Set(said).size, said.length, 'two of the four reasons share a sentence');
  assert.equal(said.length, 4);

  // Each names whose problem it is, which is the whole point of splitting them.
  assert.match(VOICE_TROUBLE.unconfigured, /not .*yet|cannot hear/i);
  assert.match(VOICE_TROUBLE.failed, /my side|broken/i);
  assert.match(VOICE_TROUBLE.empty, /words/i);
  assert.match(VOICE_TROUBLE.download, /come through|again/i);

  // And none of them tells him to repeat himself for a fault that is not his.
  assert.ok(!/send it again/i.test(VOICE_TROUBLE.failed),
    'a transcription outage still asks him to repeat himself, which is the ' +
    'exact conflation splitting these apart was for');
  assert.ok(!/send it again/i.test(VOICE_TROUBLE.unconfigured),
    'an unconfigured transcriber asks him to repeat himself');
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE PRICE, AND THE TWO SCALES ONE ENDPOINT USES
   ───────────────────────────────────────────────────────────────────────────
   Every number below is a REAL capture from `?market=raw` and `?positions=1`
   against the live account, not a shape invented here. That matters more than
   usual: cTrader serves `get_spot_prices` in pipettes and `get_positions` in
   display prices, on the same account and the same symbol, and its own tool
   descriptions say nothing about either. A parser written from the docs would
   have been a hundred thousand out on one of the two and would still have
   produced a four-digit number that looked like gold.
   ═══════════════════════════════════════════════════════════════════════════ */

// get_spot_prices, symbol 41, exactly as it came back.
const SPOT = {
  symbolId: 41,
  bid: 441982000, ask: 441993000,
  high: 442014000, low: 438113000,
  sessionClose: 438796000,
  timestamp: 1788404105346,
};

test('a spot price is pipettes, and the scale is applied once', () => {
  assert.equal(fromPipettes(SPOT.bid), 4419.82);
  assert.equal(fromPipettes(SPOT.ask), 4419.93);
  assert.equal(PIPETTES, 100_000);
  // Two decimals, which is what gold quotes to. A scale that left more would
  // reach a briefing as 4419.8200000001.
  assert.equal(fromPipettes(438796000), 4387.96);
});

test('the overnight move comes out of the same call as the price', () => {
  /* sessionClose is the previous session's close — the 17:00 New York roll for
     gold — so "where it is, with the overnight move" needs no second request
     and no trendbars. That is the whole of the briefing's opening line. */
  const spot = foldSpot(SPOT);
  assert.equal(spot.bid, 4419.82);
  assert.equal(spot.ask, 4419.93);
  assert.equal(spot.high, 4420.14);
  assert.equal(spot.low, 4381.13);
  assert.equal(spot.prev_close, 4387.96);
  assert.equal(spot.change, 31.86);
  assert.equal(spot.change_pct, 0.73);
  assert.equal(spot.at, new Date(1788404105346).toISOString());
});

test('a price that will not parse is null rather than NaN', () => {
  /* NaN formats as "NaN" and would reach him as text in a briefing; a null is
     something the caller is forced to handle, and the caller throws. An empty
     answer here is not a price of zero. */
  assert.equal(foldSpot(undefined), null);
  assert.equal(foldSpot({}), null);
  assert.equal(foldSpot({ bid: 'x', ask: 441993000 }), null);
  assert.equal(foldSpot({ bid: 441982000 }), null);
});

test('a quote with no previous close still gives a price', () => {
  // The move is unknown rather than zero — a zero change is a claim that
  // nothing moved, which is a different statement from having no reference.
  const spot = foldSpot({ bid: 441982000, ask: 441993000, timestamp: 1788404105346 });
  assert.equal(spot.bid, 4419.82);
  assert.equal(spot.change, null);
  // And the range falls back to the price rather than to zero, which would
  // render as a day that traded down to nothing.
  assert.equal(spot.high, 4419.82);
  assert.equal(spot.low, 4419.82);
});

test('a live position carries its plan, and NOT in pipettes', () => {
  /* THE CAPTURE THAT CONTRADICTS §8. It says the plan — where the stop and the
     target were set — is not available from the broker, and four questions are
     marked unanswerable because of it. That is true of a CLOSED position, which
     is all this system had ever asked about. A live one carries both.

     And it carries them as DISPLAY prices, beside a spot call that does not.
     This test exists to hold that asymmetry in place: applying fromPipettes
     here would put the stop at four one-hundredths of a cent. */
  const position = {
    positionId: 586244103, symbolId: 41, tradeSide: 'BUY', volume: 400,
    entryPrice: 4402.71, stopLoss: 4403.24, takeProfit: 4432.1,
    commission: -14, swap: 0,
  };

  // Already display prices — gold, four digits, no conversion wanted.
  assert.ok(position.entryPrice > 1000 && position.entryPrice < 100000);
  assert.ok(position.stopLoss > 1000 && position.stopLoss < 100000);
  assert.equal(fromPipettes(position.entryPrice), 0.04,
    'fromPipettes applied to a position price gives four hundredths of a cent — ' +
    'which is why the two scales are named apart rather than assumed alike');

  // The units the poller already knows are unchanged by any of this.
  assert.equal(ozFromVolume(position.volume), 4);
  assert.equal(usdFromCents(position.commission), -0.14);
});

/* ─── The plan, off the open position ───────────────────────────────────────
   §8 said this was unrecoverable, and it was — of a CLOSED position. The
   capture below is the live one that showed otherwise, unchanged.
   ─────────────────────────────────────────────────────────────────────────── */

test('an open position yields its plan, keyed the way the poller files it', () => {
  const plans = openPlans([{
    positionId: 586244103, symbolId: 41, tradeSide: 'BUY', volume: 400,
    entryPrice: 4402.71, stopLoss: 4403.24, takeProfit: 4432.1,
    commission: -14, swap: 0,
  }]);

  assert.equal(plans.length, 1);
  // The same id foldPosition writes, or the PATCH matches nothing and reports
  // success — a plan silently filed against no row at all.
  assert.equal(plans[0].id, 'PID586244103');
  // Display prices, untouched. fromPipettes here would file the stop at four
  // hundredths of a cent, which is the trap the two-scale probe found.
  assert.equal(plans[0].planned_sl, 4403.24);
  assert.equal(plans[0].planned_tp, 4432.1);
});

test('half a plan is no plan, and a bad id is dropped', () => {
  /* HALF-WRITTEN IS WORSE THAN ABSENT: the reward-to-risk needs both sides, and
     a row carrying one would look answerable and produce a division by a
     missing number. A position with no stop set is a real state — it is what
     R-02 exists about — and it is recorded as nothing rather than as half. */
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 4403.24 }]), []);
  assert.deepEqual(openPlans([{ positionId: 1, takeProfit: 4432.1 }]), []);
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 0, takeProfit: 4432.1 }]), []);
  assert.deepEqual(openPlans([{ stopLoss: 4403.24, takeProfit: 4432.1 }]), []);
  assert.deepEqual(openPlans([]), []);
  assert.deepEqual(openPlans(undefined), []);
});

test('every open position with a plan is filed, not just the first', () => {
  const plans = openPlans([
    { positionId: 1, stopLoss: 4400, takeProfit: 4430 },
    { positionId: 2, stopLoss: 4200, takeProfit: 4230 },
  ]);
  assert.deepEqual(plans.map(p => p.id), ['PID1', 'PID2']);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE PRICE SENSE — DRIVEN FROM BOTH SIDES OF EVERY GATE
   ───────────────────────────────────────────────────────────────────────────
   A sense that is silent by design is the one where a broken predicate and a
   quiet market produce the same evidence: nothing, for weeks. `moveWorth`
   returning "not worth it" to everything would look exactly like gold behaving
   itself, and no log anywhere would say otherwise. So every gate is driven in
   BOTH directions here — each one is shown to block, and shown to pass with the
   one thing it objects to removed.

   The quote below is the real `?market=1` capture folded, so the numbers the
   gates are tested against are numbers this system has actually served.
   ═══════════════════════════════════════════════════════════════════════════ */
const QUOTE = {                            // the SPOT capture, after foldSpot
  bid: 4419.82, ask: 4419.93, high: 4420.14, low: 4381.13,
  prev_close: 4387.96, change: 31.86, change_pct: 0.73,
  at: '2026-09-03T12:15:05.346Z',
};
const LOOKED = Date.parse('2026-09-03T12:15:30Z');
// A mark taken a quarter of an hour ago, at a price a big move below the quote.
// The session range is 39.01, so 35% of it is 13.65 — this clears it.
const MARK = { bid: 4404.82, at: '2026-09-03T12:00:30Z', looked_at: null };

test('a move large by the day own measure is worth waking her for', () => {
  const out = moveWorth(QUOTE, MARK, LOOKED);
  assert.equal(out.worth, true);
  assert.equal(out.move, 15);
});

test('the mark seeded at zero is not a price, and cannot be a move of 4,400', () => {
  /* 005 SEEDS THE ROW so the first run has something to PATCH. Read as a price
     that seed is a move of the entire value of gold, which passes every
     threshold there is — a message on the first tick after any deploy that
     rebuilt the table, saying gold had moved four and a half thousand dollars. */
  const out = moveWorth(QUOTE, { ...MARK, bid: 0 }, LOOKED);
  assert.equal(out.worth, false);
  assert.match(out.why, /no mark/);
});

test('a move measured across an outage is not a quarter-hour move', () => {
  // Two missed runs and the gap is no longer the window this sense is about:
  // $15 in fifteen minutes is an event, $15 across an hour is a session.
  const stale = { ...MARK, at: new Date(LOOKED - (MARK_STALE_MIN + 1) * 60_000).toISOString() };
  assert.equal(moveWorth(QUOTE, stale, LOOKED).worth, false);
  assert.match(moveWorth(QUOTE, stale, LOOKED).why, /stale/);

  // And one missed run still counts, which is the half that makes it a bound
  // rather than a rejection of anything but an exact fifteen minutes.
  const late = { ...MARK, at: new Date(LOOKED - (MARK_STALE_MIN - 1) * 60_000).toISOString() };
  assert.equal(moveWorth(QUOTE, late, LOOKED).worth, true);
});

test('she says one thing about one move, however long it keeps going', () => {
  /* THE GATE A THRESHOLD CANNOT REPLACE. A market that trends $15 a quarter
     hour clears every other gate on every run — this is the only thing between
     that and eight messages before lunch about one story. */
  const spoken = { ...MARK, looked_at: new Date(LOOKED - (MOVE_QUIET_H - 0.5) * 3600_000).toISOString() };
  assert.equal(moveWorth(QUOTE, spoken, LOOKED).worth, false);
  assert.match(moveWorth(QUOTE, spoken, LOOKED).why, /already said/);

  // And it opens again once the window has passed, rather than latching shut.
  const older = { ...MARK, looked_at: new Date(LOOKED - (MOVE_QUIET_H + 0.5) * 3600_000).toISOString() };
  assert.equal(moveWorth(QUOTE, older, LOOKED).worth, true);
});

test('the floor is a share of the price, so it cannot go stale as gold moves', () => {
  /* A FIXED $4 WOULD MEAN TWO DIFFERENT THINGS to gold at 4,400 and gold at
     2,000, and the year nobody revises it the sense either fires constantly or
     never — and never looks exactly like a quiet market. */
  const small = { ...MARK, bid: QUOTE.bid - QUOTE.bid * MOVE_FLOOR * 0.9 };
  assert.equal(moveWorth(QUOTE, small, LOOKED).worth, false);
  assert.match(moveWorth(QUOTE, small, LOOKED).why, /floor/);

  // The same absolute move at a much lower price does clear it, which is the
  // whole point of expressing it as a share.
  const cheap = { ...QUOTE, bid: 2000, high: 2000, low: 2000 };
  assert.equal(moveWorth(cheap, { ...MARK, bid: 2000 - QUOTE.bid * MOVE_FLOOR * 0.9 }, LOOKED).worth, true);
});

test('a move small against the day range is the day, not an event', () => {
  // Below the share and above the floor: $12.50 on a session that has already
  // travelled $39 is an ordinary swing, and it is the case the floor alone
  // would let through on every quiet afternoon. The band between the two gates
  // is narrow — $11.05 to $13.65 on this quote — so the figure is asserted to
  // be inside it rather than assumed, which is what makes this a test of the
  // SHARE rather than a second test of the floor.
  const ordinary = { ...MARK, bid: QUOTE.bid - 12.5 };
  const out = moveWorth(QUOTE, ordinary, LOOKED);
  assert.equal(out.worth, false);
  assert.match(out.why, /range/);
  assert.ok(12.5 > QUOTE.bid * MOVE_FLOOR, 'the floor is doing the rejecting, not the share');
  assert.ok(12.5 < (QUOTE.high - QUOTE.low) * MOVE_SHARE);
});

/* ─── The evening roll, which is where both gates were weakest ───────────────
   THE ONE MESSAGE THIS SENSE HAS ACTUALLY SENT WRONG, replayed from what he was
   shown. At 20:57 New York it said gold was "up $12 on the day and $7 of that
   in the last quarter hour", on a day that had opened near 4,440 and was up
   more than $40.

   Both halves of that come from the same fact and it is the one nothing in the
   code had written down: the broker's session rolls at 17:00 New York, so at
   20:57 every figure in the quote was under four hours old. The $12 was the
   move since that roll, read off `change` and reported as the day. And the $7
   cleared the share gate only because the range it is taken against had
   restarted with the session — $7 of a $20 evening range passes a test written
   for $7 of a $39 day.

   The share cannot be fixed from here; nothing this system reads spans the
   calendar day. The floor can, and this is the case that says what it has to
   be: an amount that is an event in the thin hours, since the thin hours are
   exactly when the share has stopped binding and the floor is alone. */
test('the $7 evening drift that reached him does not clear the gates now', () => {
  // The session as she described it: 4,485 the top, and a range that began at
  // the 17:00 roll rather than at the day's low near 4,440.
  const evening = {
    ...QUOTE, bid: 4485, high: 4485, low: 4467, prev_close: 4473,
    change: 12, change_pct: 0.27,
  };
  const before = { ...MARK, bid: 4478 };

  const out = moveWorth(evening, before, LOOKED);
  assert.equal(out.worth, false, 'a $7 drift in thin evening trade is not a sharp move');
  assert.match(out.why, /floor/);

  // And the share is shown to be no help here, which is the finding rather than
  // an aside: $7 of a $20 range passes it. The floor is the only gate left
  // standing between the roll and a rebuilt range, which is why it carries the
  // whole test for seven hours of every weekday.
  assert.ok(7 >= (evening.high - evening.low) * MOVE_SHARE,
    'the share still admits this — the floor is what now rejects it');

  // The gate is not simply shut: a move that is genuinely sharp for the hour
  // still gets through, or this would be a sense that fires on nothing.
  assert.equal(moveWorth(evening, { ...MARK, bid: 4470 }, LOOKED).worth, true);
});

test('a quote with no range is decided by the floor alone', () => {
  /* foldSpot FALLS BACK TO THE BID for a quote carrying no high or low, which
     makes the range zero — and a share of zero is zero, so every move would
     clear it. The floor is what still has to be satisfied. */
  const flat = { ...QUOTE, high: QUOTE.bid, low: QUOTE.bid };
  assert.equal(moveWorth(flat, MARK, LOOKED).worth, true);
  assert.equal(moveWorth(flat, { ...MARK, bid: QUOTE.bid - 0.5 }, LOOKED).worth, false);
});

test('a fall is a move, and it is reported as one', () => {
  // Signed, not absolute: the gates measure size and the message needs the
  // direction, and a sense that only noticed rallies would be half a sense.
  const out = moveWorth(QUOTE, { ...MARK, bid: QUOTE.bid + 15 }, LOOKED);
  assert.equal(out.worth, true);
  assert.equal(out.move, -15);
});

/* ═══════════════════════════════════════════════════════════════════════════
   WHICH SESSION THE QUOTE IS DESCRIBING
   ───────────────────────────────────────────────────────────────────────────
   `high`, `low`, `prev_close` and `change` are all measured from the broker's
   session open, and gold's session opens at the 17:00 New York roll. Before
   that hour the window reaches back through the night and `change` really is
   the overnight move, which is what the briefing's opening line wants. After
   it the window is a few hours old and `change` is the evening's move — and
   served as a bare number in a JSON blob there is nothing to tell the two
   apart, which is how "up $12 on the day" was said at 20:57 about a day that
   was up more than $40.

   So the label is driven from both sides of the roll, and from both sides of
   the daylight-saving change as well: the boundary is 17:00 in New York, not a
   fixed UTC hour, and a test pinned to one offset would pass all summer and be
   an hour wrong every winter evening.
   ═══════════════════════════════════════════════════════════════════════════ */
test('before the roll the quote covers the night, and says so', () => {
  // 08:00 New York on a summer weekday — the briefing's own hour, where the
  // session began at 17:00 the previous evening.
  const said = quoteWindow(new Date('2026-09-03T12:00:00Z'));
  assert.match(said, /YESTERDAY/);
  assert.match(said, /overnight move/);
  assert.doesNotMatch(said, /THIS EVENING/);
});

test('after the roll the quote is not the day, and says that instead', () => {
  // 20:57 New York — the minute of the message that prompted this. The window
  // is under four hours old, and the whole job of the label is to stop the
  // figure inside it being called the move on the day.
  const said = quoteWindow(new Date('2026-09-04T00:57:00Z'));
  assert.match(said, /THIS EVENING/);
  assert.match(said, /NOT the calendar day/);
  assert.doesNotMatch(said, /overnight move/);
});

test('the roll is 17:00 in New York, in winter as well as in summer', () => {
  /* THE CASE A FIXED UTC HOUR GETS WRONG FOR HALF THE YEAR, and it is the same
     argument that keeps every other schedule here on nyClock. 22:00 UTC is
     18:00 in New York in September and 17:00 in January — one is past the roll
     and both would be past a boundary written as 22. */
  assert.match(quoteWindow(new Date('2026-09-03T20:59:00Z')), /YESTERDAY/); // 16:59 ET
  assert.match(quoteWindow(new Date('2026-09-03T21:01:00Z')), /THIS EVENING/); // 17:01 ET
  assert.match(quoteWindow(new Date('2026-01-14T21:59:00Z')), /YESTERDAY/); // 16:59 ET
  assert.match(quoteWindow(new Date('2026-01-14T22:01:00Z')), /THIS EVENING/); // 17:01 ET
});

test('the roll hour is the one the market hours are already kept on', () => {
  // marketOpen closes Friday and opens Sunday at this same hour, because it is
  // one boundary rather than two that happen to agree. A second literal here
  // would be a copy nothing compares.
  assert.equal(ROLL_HOUR, 17);
  assert.equal(marketOpen(new Date('2026-09-04T20:59:00Z')), true);  // Fri 16:59 ET
  assert.equal(marketOpen(new Date('2026-09-04T21:01:00Z')), false); // Fri 17:01 ET
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE VENDOR'S ANSWER, FOLDED
   ───────────────────────────────────────────────────────────────────────────
   The embedding call is the one place in this system where a wrong answer is
   completely undetectable afterwards. A vector filed against the wrong row does
   not error, does not log, and does not look wrong in the table — it surfaces
   only as a memory that returns the wrong text for the right question, months
   later, as her seeming to misremember.

   So the ordering, the count and the width are decided in a pure function and
   driven from here, rather than proved by stubbing a vendor to return the order
   the test wanted.
   ═══════════════════════════════════════════════════════════════════════════ */
const vec = (fill) => Array(EMBED_DIMS).fill(fill);

test('the vectors come back in the order they were asked for', () => {
  /* THE RESPONSE CARRIES THE POSITION OF THE INPUT IT ANSWERS, and taking the
     array as it arrives is the bug that cannot be found later: turn A gets
     turn B's meaning and both rows look perfectly healthy. */
  const out = foldVectors([
    { index: 1, embedding: vec(0.2) },
    { index: 0, embedding: vec(0.1) },
  ], 2);
  assert.equal(out[0], `[${vec(0.1).join(',')}]`);
  assert.equal(out[1], `[${vec(0.2).join(',')}]`);
});

test('a vector is pgvector text, not a JSON array', () => {
  // The same string goes into the column and into the query, and this is the
  // form that crosses a JSON body into a `vector` without depending on a cast
  // from json existing.
  const [only] = foldVectors([{ index: 0, embedding: vec(0.5) }], 1);
  assert.ok(only.startsWith('[') && only.endsWith(']'));
  assert.equal(only.split(',').length, EMBED_DIMS);
});

test('a batch that comes back wrong is refused whole', () => {
  /* ALL OR NOTHING, because a short answer gives no way to tell WHICH row lost
     its vector. Writing the ones that arrived would silently pair the tail of
     the batch with the wrong rows — the same undetectable failure as the
     ordering, arrived at from the other direction. */
  assert.equal(foldVectors([{ index: 0, embedding: vec(0.1) }], 2), null,
    'a batch one vector short was accepted');
  assert.equal(foldVectors([{ index: 0, embedding: vec(0.1) },
                            { index: 1, embedding: vec(0.2) }], 1), null,
    'a batch with a vector too many was accepted');
  assert.equal(foldVectors([{ index: 0, embedding: [0.1, 0.2] }], 1), null,
    'a vector of the wrong width was accepted — every insert would be a 400');
  assert.equal(foldVectors([{ index: 0, embedding: 'not a vector' }], 1), null);
  assert.equal(foldVectors([{ index: 0 }], 1), null);
  assert.equal(foldVectors(undefined, 1), null);
  assert.equal(foldVectors([], 1), null);
});

test('an empty ask is answered empty rather than refused', () => {
  // Nothing was asked for and nothing came back, which is agreement.
  assert.deepEqual(foldVectors([], 0), []);
});

/* ═══════════════════════════════════════════════════════════════════════════
   ANSWERING IN THE CHANNEL HE USED
   ───────────────────────────────────────────────────────────────────────────
   No setting and no stored preference: the message he sent decides. Which makes
   this one predicate the whole feature, and the only part of speaking back that
   is not a vendor and a wire.
   ═══════════════════════════════════════════════════════════════════════════ */

test('a voice note is answered aloud and a typed line is not', () => {
  assert.equal(speaksBack('Gold is holding 4,410.', true), true);
  assert.equal(speaksBack('Gold is holding 4,410.', false), false,
    'she speaks back to a typed message — he is at a keyboard and did not ask ' +
    'to be read to');
});

test('an answer too long to listen to is left in text', () => {
  /* PAST THE CAP IT IS A RECORDING TO SCRUB THROUGH rather than a reply, and
     the text has already been sent — so the audio is what gives way. The prompt
     is told the same number, so an answer over it is one she chose. */
  assert.equal(speaksBack('x'.repeat(SPEAK_MAX), true), true);
  assert.equal(speaksBack('x'.repeat(SPEAK_MAX + 1), true), false);
});

test('there is nothing to speak when there is nothing to say', () => {
  // An empty answer would be a zero-length voice note, which renders in
  // Telegram as a broken attachment rather than as nothing.
  assert.equal(speaksBack('', true), false);
});

/* ─── What he has on, rendered ───────────────────────────────────────────────
   The block that closed the one thing she could not see. Every field on it is
   nullable and most of them are null on a row he opened by hand, so the failure
   this is driven against is not a missing block — it is a block that renders
   and puts the word `null` where a price goes, which reads as a price.

   THE MARK IS THE OTHER HALF. It is quarter-hourly, so its AGE is the thing
   that makes it usable, and it belongs beside a position or nowhere: on a flat
   day it is a number with nothing to be a number of.
   ─────────────────────────────────────────────────────────────────────────── */
const DESK_NOW = Date.parse('2026-09-03T14:20:00Z');
const MARK_NOW = { bid: 4386.1, at: '2026-09-03T14:09:00Z', looked_at: null };
const OPEN = trade({
  id: 'PID9', direction: 'BUY', entry_time: '2026-09-03T13:14:00Z',
  entry_price: 4388.2, size_oz: 4, open_day: '2026-09-03',
  planned_sl: 4380, planned_tp: 4412,
});

test('a flat day with nothing traded is no block at all', () => {
  assert.equal(positionsList([], null, MARK_NOW, DESK_NOW), '');
});

test('an open position states its age, its side, its size and its plan', () => {
  const out = positionsList([OPEN], null, null, DESK_NOW);
  assert.match(out, /open since 09:14 ET/);
  assert.match(out, /BUY 4oz from 4388\.2/);
  assert.match(out, /stop 4380 and target 4412 as first seen/);
});

/* ─── A hold from another day said only what hour it opened ──────────────────
   THE BLOCK IS HEADED "what he has on RIGHT NOW", and inside it a position read
   `open since 09:15 ET` whether it opened this morning or on Monday. There is
   one way to read a bare clock time under that heading and it is the wrong one.

   Not an edge case: the strategy's own summary calls his positions "intraday to
   multi-session", and R-15 bounds a hold at the Friday close rather than at
   midnight. So the shape this got wrong is one he trades, and what it produced
   is a confident wrong fact about his own open position — in the one block
   whose whole purpose is that she knows what he is exposed to.
   ─────────────────────────────────────────────────────────────────────────── */
test('a position opened on an earlier day says which day', () => {
  // Opened 09:14 New York on the 1st, still open on the 3rd.
  const held = trade({ ...OPEN, entry_time: '2026-09-01T13:14:00Z', open_day: '2026-09-01' });
  const out = positionsList([held], null, null, DESK_NOW);
  assert.match(out, /open since 09:14 ET on 1 Sep/,
    'a multi-session hold that names only an hour reads as having opened today');
});

test("a position opened today says the hour and no date", () => {
  // The other direction, because dating every fill would bury the one line
  // where the date is the point.
  const out = positionsList([OPEN], null, null, DESK_NOW);
  assert.match(out, /open since 09:14 ET —/);
  assert.doesNotMatch(out, /on \d+ Sep/);
});

test('a position with no plan recorded says nothing about a plan', () => {
  const out = positionsList([trade({ ...OPEN, planned_sl: null, planned_tp: null })],
                            null, null, DESK_NOW);
  assert.match(out, /BUY 4oz from 4388\.2/);
  assert.doesNotMatch(out, /stop|target/);
});

/* HALF A PLAN IS NOT A PLAN, and the columns are independently nullable however
   the poller writes them — it PATCHes both in one body, but a hand correction in
   the database sets whichever one it sets. Rendering the pair from either being
   present puts "target null" in front of her, which reads as a target of
   nothing rather than as an absent one.

   THIS CASE IS THE TEST. The both-null row above passes whether the guard reads
   `&&` or `||`, so it was proving nothing about the guard it was written for —
   only a row carrying exactly one column can tell those two apart. */
test('a row carrying one half of the plan is treated as carrying none', () => {
  for (const half of [{ planned_tp: null }, { planned_sl: null }]) {
    const out = positionsList([trade({ ...OPEN, ...half })], null, null, DESK_NOW);
    assert.doesNotMatch(out, /null/,
      `a row with only ${Object.keys(half)[0]} missing renders it: ${out}`);
    assert.doesNotMatch(out, /stop|target/,
      'half a plan is being shown as a plan');
  }
});

test('a hand-opened row with no side, size or price prints no nulls', () => {
  const out = positionsList([trade({
    id: 'legacy-1', direction: null, entry_time: null,
    entry_price: null, size_oz: null,
  })], null, null, DESK_NOW);
  assert.doesNotMatch(out, /null|undefined|NaN/);
  assert.match(out, /side and size not recorded/);
});

test('the mark is given with its age, counted from the clock passed in', () => {
  assert.match(positionsList([OPEN], null, MARK_NOW, DESK_NOW), /gold was 4386\.1 11 minutes ago/);
});

/* A PRICE WITH NOTHING TO BE A PRICE OF. On a flat day the mark is the number
   she would otherwise subtract an entry from, and handing it over anyway is how
   a spot quote fifteen minutes old ends up in a briefing as the current level. */
test('the mark is withheld when nothing is open, however fresh it is', () => {
  const standing = { day: '2026-09-03', pnl: -182.4, account: 2000, breached: false };
  const out = positionsList([], standing, MARK_NOW, DESK_NOW);
  assert.doesNotMatch(out, /gold was/);
  assert.match(out, /his day so far: -182\.40/);
});

test('a day inside the limit and a day past it are not rendered the same', () => {
  const inside = positionsList([], { day: 'd', pnl: -50, account: 2000, breached: false }, null, DESK_NOW);
  const past   = positionsList([], { day: 'd', pnl: -90, account: 2000, breached: true }, null, DESK_NOW);
  assert.match(inside, /inside the 4% R-11 sets/);
  assert.match(past, /PAST the 4% R-11 sets/);
  assert.doesNotMatch(inside, /PAST/);
});
