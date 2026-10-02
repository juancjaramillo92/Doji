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
import { secretMatches, nyClock, nyDate, marketOpen, parseSse } from '../supabase/functions/_shared/edge.ts';

import {
  foldPosition, nyDay, ozFromVolume, usdFromCents,
  lookbackFor, foldHours, balanceTarget,
  fromPipettes, foldSpot, PIPETTES, openPlans, barSpan, bestPrice, stopChanges,
} from '../supabase/functions/doji-mcp-sync/index.ts';

import { SETUPS, COLUMNS, answered, parseCallback, renderMessage, staysOpen } from '../supabase/functions/doji-gladys/index.ts';
import { emailRow, answerFor } from '../supabase/functions/doji-email-sync/index.ts';
import { pkceChallenge, challenge, wellKnown, tokenFields, fresh, accessToken, unwrap, foldCalendar,
  calendarWindow, foldBars, foldHeadlines, FOMC, contractMonths, foldRates, oddsOf, unlisted, zq,
} from '../supabase/functions/doji-tradingview/index.ts';
import {
  briefDue, pulseDue, retryDue, briefKind, dueNow, isSilent, briefingMarker, briefedQuery,
  chunk, TG_LIMIT, tradesQuery, openOnUser, nowBlock, withClock, dateTurns,
  notesList, channelsList, searchList, readStrategy, dayQuery, repliedQuery, ask,
  consolidateRetryDue, thesisLine, loopsList, calendarList, keepDraft, TRIM_MOST,
  parseFeedback, feedbackKeyboard, stamped, apologyFor, APOLOGY, LOOP_KINDS,
  moveWorth, MOVE_SHARE, MOVE_FLOOR, MOVE_QUIET_H, MARK_STALE_MIN,
  quoteWindow, quoteLine, ROLL_HOUR,
  foldVectors, EMBED_DIMS,
  VOICE_TROUBLE,
  positionsList, isOpen, healthLine, sweepLine, serve, dueRelease, parseChannel, sayAloud, postSpeak,
  marketBlock, notesBlock, channelsBlock, tradesBlock, thesisBlock,
  healthBlock, loopsBlock, calendarBlock, positionsBlock, feedbackBlock,
  releasesQuery, weeksQuery, stopsQuery, calendarRows, fileCalendar, fileWeek, historyWeeks, postHistory, awaitingActual,
  aroundList, aroundBlock, headlinesList, headlinesBlock, recordList, recordQuery, revisionLine,
  sinceBriefing, breachesList, breachesBlock, weekQuery, weekBlock, positioningList, positioningBlock, ratesList, ratesBlock,
} from '../supabase/functions/doji-eugenia/index.ts';
import {
  journalStats, statsList, resultOf, counts, money, averages, realisedRR,
  sessionAt, isJournalled, BE,
} from '../supabase/functions/doji-eugenia/journal.ts';
import {
  checkRules, adherenceList, settle, dayStanding, easter, marketHolidays,
  nyInstant, nyWall, crossesFridayClose, nearFridayClose, CLOSEOUT_MIN,
  SWEEP_MIN, DAY_LOSS, STRETCH, TO_BREAK_EVEN, ALERT_GRACE_MIN, NEWS_MIN, HIGH, weekOf, STOP_GRACE_MIN,
} from '../supabase/functions/doji-eugenia/adherence.ts';
import { CHANNELS, CHANNEL_STATES } from '../supabase/functions/doji-eugenia/prompt.ts';
import { ALWAYS } from '../supabase/functions/doji-eugenia/strategy.ts';
import { backup, readAll, TABLES } from '../scripts/backup-memory.mjs';

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

/* ─── TradingView: the sign-in ───────────────────────────────────────────── */

test('the PKCE challenge is the one RFC 7636 states for its own verifier', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
               'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test("the server's 401 is read for where its metadata is and what scope to ask", () => {
  assert.deepEqual(
    challenge('Bearer resource_metadata="https://tv.example/.well-known/oauth-protected-resource/mcp", scope="read"'),
    { metadata: 'https://tv.example/.well-known/oauth-protected-resource/mcp', scope: 'read' });
  // Either half may be missing, and a missing one must read as absent rather
  // than as a string, or the well-known fallback is never tried.
  assert.deepEqual(challenge('Bearer realm="mcp"'), { metadata: undefined, scope: undefined });
  assert.deepEqual(challenge(null), { metadata: undefined, scope: undefined });
});

test('the well-known paths insert before the path, then fall back to the origin', () => {
  assert.deepEqual(wellKnown('https://mcp.tradingview.com/mcp', 'oauth-protected-resource'), [
    'https://mcp.tradingview.com/.well-known/oauth-protected-resource/mcp',
    'https://mcp.tradingview.com/.well-known/oauth-protected-resource',
  ]);
  // An issuer with no path has one candidate per name, not the same one twice.
  assert.deepEqual(wellKnown('https://auth.example/', 'oauth-authorization-server', 'openid-configuration'), [
    'https://auth.example/.well-known/oauth-authorization-server',
    'https://auth.example/.well-known/openid-configuration',
  ]);
});

test('a token answer with no stated expiry is never treated as fresh', () => {
  const fields = tokenFields({ access_token: 'a' }, 0, 'r');
  assert.equal(fields.expires_at, null);
  assert.equal(fresh(fields, 0), false);
});

test('a token is fresh until a minute before it expires, and not after', () => {
  const auth = { access_token: 'a', expires_at: new Date(10 * 60_000).toISOString() };
  assert.equal(fresh(auth, 8 * 60_000), true);
  assert.equal(fresh(auth, 9 * 60_000), false);
  assert.equal(fresh({ ...auth, access_token: null }, 0), false);
});

/* A STUB THAT IS BOTH POSTGREST AND THE TOKEN ENDPOINT, and that FILTERS the
   way PostgREST does. A stub answering every PATCH with the row is how the
   release look's quoted filter matched nothing for a fortnight under a green
   test, so the lease's `or=(refreshing_until.is.null,refreshing_until.lt.…)` is
   evaluated against the row here and a PATCH it excludes answers an empty
   array. `onRead` lets a test change the row behind a read, which is how
   another caller's renewal is simulated without a second runtime. */
function authServer(row, issue, onRead = () => {}) {
  const presented = [];
  const fetch = async (url, init = {}) => {
    if (url === row.token_endpoint) {
      const form = new URLSearchParams(init.body);
      presented.push(form.get('refresh_token'));
      await new Promise(r => setTimeout(r, 20));
      return new Response(JSON.stringify(issue[presented.length - 1]), { status: 200 });
    }
    if (init.method === 'PATCH') {
      const lapse = decodeURIComponent(url).match(/refreshing_until\.lt\.([^)]+)\)/);
      const free = row.refreshing_until === null || (lapse && row.refreshing_until < lapse[1]);
      if (!free) return new Response('[]', { status: 200 });
      row = { ...row, ...JSON.parse(init.body) };
      return new Response(JSON.stringify([row]), { status: 200 });
    }
    if (init.method === 'POST') {
      row = { ...row, ...JSON.parse(init.body) };
      return new Response('', { status: 201 });
    }
    const seen = row;
    onRead();
    return new Response(JSON.stringify([seen]), { status: 200 });
  };
  return { fetch, presented, row: () => row, set: (r) => { row = { ...row, ...r }; } };
}

const STALE = {
  id: 'current', client_id: 'c', token_endpoint: 'https://auth.example/token', resource: 'r',
  access_token: 'old', refresh_token: 'R1', expires_at: new Date(0).toISOString(), refreshing_until: null,
};

async function withFetch(stub, run) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await run(); } finally { globalThis.fetch = real; }
}

/* THE SEQUENCE, BECAUSE THE FAILURE IS IN THE SECOND STEP. A server that
   rotates kills each refresh token the moment it answers, so what has to be
   proved is that the NEXT refresh presents the one it was just given — and a
   server that does not rotate sends none, which must not be stored as null. */
test('two refreshes against a rotating server each present the token the last one stored', async () => {
  const server = authServer({ ...STALE }, [{ access_token: 'A2', refresh_token: 'R2', expires_in: 0 },
                                          { access_token: 'A3', expires_in: 3600 }]);
  await withFetch(server.fetch, async () => {
    assert.equal(await accessToken(), 'A2');
    assert.equal(server.row().refresh_token, 'R2');
    // expires_in 0 is stale on arrival, so the second call refreshes again.
    assert.equal(await accessToken(), 'A3');
    // And the third is served from the row, without asking the server.
    assert.equal(await accessToken(), 'A3');
  });
  assert.deepEqual(server.presented, ['R1', 'R2']);
  assert.equal(server.row().refresh_token, 'R2', 'a refresh that sent no new token erased the one that works');
  assert.equal(server.row().refreshing_until, null, 'the lease was not released with the token');
});

/* TWO CALLERS, ONE STALE TOKEN, ONE RENEWAL. The briefing and the release look
   can both find the token stale in the same second; a server that rotates may
   revoke the sign-in on seeing a refresh token twice. */
test('two callers finding the token stale at once renew it once and share it', async () => {
  const server = authServer({ ...STALE }, [{ access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }]);
  const got = await withFetch(server.fetch, () => Promise.all([accessToken(), accessToken()]));
  assert.deepEqual(got, ['A2', 'A2']);
  assert.deepEqual(server.presented, ['R1'], 'the refresh token was presented twice');
  assert.equal(server.row().refreshing_until, null);
});

/* AND THE ROW IS READ AGAIN ONCE THE LEASE IS HELD. Here another caller renews
   between this one's first read and its lease: the token it first read is now
   spent, and presenting it is the double presentation again. */
test('a caller that wins the lease after someone else renewed presents nothing', async () => {
  let server;
  server = authServer({ ...STALE }, [], () => server.set({
    access_token: 'A2', refresh_token: 'R2', expires_at: new Date(Date.now() + 3600_000).toISOString(),
  }));
  assert.equal(await withFetch(server.fetch, () => accessToken()), 'A2');
  assert.deepEqual(server.presented, [], 'the spent refresh token was presented after someone else renewed');
});

/* ─── TradingView: what a tool answered ─────────────────────────────────── */

const TV_CALENDAR = JSON.parse(readFileSync(
  new URL('./fixtures/tradingview-calendar.json', import.meta.url), 'utf8'));

test('a refusal inside a result marked isError false is a refusal', () => {
  // The quote batch's own answer on 1 October, verbatim: the envelope reports
  // nothing wrong and the payload says it was refused.
  const refused = JSON.parse('{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":' +
    '"{\\"error\\":\\"tradingview api: https://scanner.tradingview.com/forex/scan?label-product=tv-mcp: 429: \\",\\"success\\":false}"}],' +
    '"structuredContent":{"error":"tradingview api: https://scanner.tradingview.com/forex/scan?label-product=tv-mcp: 429: ","success":false},"isError":false}}');
  assert.throws(() => unwrap(refused, 'mcp-tv-get-symbol-data-batch'), /429/);
  assert.equal(unwrap(TV_CALENDAR, 'mcp-tv-get-economic-calendar').status, 'ok');
});

test('the calendar folds to what her calendar holds, and no more', () => {
  const events = foldCalendar(unwrap(TV_CALENDAR, 'mcp-tv-get-economic-calendar'));
  const by = Object.fromEntries(events.map(e => [e.id, e]));
  assert.equal(events.length, 8);

  assert.deepEqual(by['396934'], {
    id: '396934', at: '2026-10-01T12:30:00.000Z', title: 'Initial Jobless Claims', country: 'US',
    importance: 'medium', timed: true, period: 'Sep/26',
    consensus: '200K', prior: '198K', actual: '197K', ticker: 'ECONOMICS:USIJC',
  });
  // No consensus is not a consensus of zero — and a consensus of zero is one.
  assert.equal(by['421425'].consensus, null);
  assert.equal(by['421425'].period, null);
  assert.equal(by['397905'].consensus, '0%');
  assert.equal(by['397905'].prior, '-0.1%');
  assert.equal(by['396941'].actual, '64B cf');
  assert.equal(by['397784'].prior, '$6.748T');
  assert.equal(by['397784'].actual, null);
  assert.equal(by['398554'].ticker, null);
  assert.equal(by['396953'].importance, 'high');
  assert.equal(by['396953'].consensus, '90K');
  // On the calendar, rated high, and not a release: nothing counts minutes to it.
  assert.equal(by['421335'].importance, 'high');
  assert.equal(by['421335'].timed, false);
  assert.equal(by['396953'].timed, true);
  // The paragraph each event carries is not paid for on every request.
  assert.ok(events.every(e => !('comment' in e)));
});

test('a calendar answer that is not ok is a refusal, not an empty day', () => {
  assert.throws(() => foldCalendar({ status: 'error', error: 'upstream' }), /upstream/);
  assert.throws(() => foldCalendar({ status: 'ok' }), /calendar/);
});

/* ─── The market around gold ─────────────────────────────────────────────────
   The bars are the 1 October probe's, verbatim: the dollar index's last two
   15-minute bars and the real yield's last three days. */
const DXY_BARS = { bars: [
  { c: 102.081, h: 102.103, l: 101.997, o: 102.102, t: 1790875800, v: null },
  { c: 102.16, h: 102.164, l: 102.081, o: 102.082, t: 1790876700, v: null }], success: true };
const DFII10_BARS = { bars: [
  { c: 2.83, h: 2.83, l: 2.83, o: 2.83, t: 1790294400, v: null },
  { c: 2.9, h: 2.9, l: 2.9, o: 2.9, t: 1790553600, v: null },
  { c: 2.91, h: 2.91, l: 2.91, o: 2.91, t: 1790640000, v: null }], success: true };

test('bars fold to a span — where the first opened and where the last stands, each with its time', () => {
  assert.deepEqual(foldBars(DXY_BARS),
    { from: 102.102, since: '2026-10-01T17:30:00.000Z', last: 102.16, at: '2026-10-01T17:45:00.000Z' });
  // Daily, and the weekend between: the span runs from Friday to Tuesday.
  assert.deepEqual(foldBars(DFII10_BARS),
    { from: 2.83, since: '2026-09-25T00:00:00.000Z', last: 2.91, at: '2026-09-29T00:00:00.000Z' });
  assert.throws(() => foldBars({ bars: [], success: true }), /no bars/);
});

const AROUND = {
  ok: true,
  market: [
    { name: 'Dollar index', unit: '', daily: false, from: 101.95, since: '2026-09-30T18:00:00.000Z',
      last: 102.16, at: '2026-10-01T17:45:00.000Z' },
    { name: 'Ten-year Treasury yield', unit: '%', daily: false, from: 5.18, since: '2026-09-30T18:00:00.000Z',
      last: 5.243, at: '2026-10-01T17:45:00.000Z' },
    { name: 'Ten-year real yield (TIPS)', unit: '%', daily: true, from: 2.83, since: '2026-09-25T00:00:00.000Z',
      last: 2.91, at: '2026-09-29T00:00:00.000Z' },
  ],
  missing: [{ name: 'VIX' }],
};

test('every line of the market says what its number is measured from, and computes no change', () => {
  const out = aroundList(AROUND, Date.parse('2026-10-01T18:00:00Z'));
  assert.match(out, /· Dollar index 102\.16, from 101\.95 at 14:00 ET on 30 Sept? \(latest bar 13:45 ET\)/);
  assert.match(out, /· Ten-year Treasury yield 5\.243%, from 5\.18% at 14:00 ET on 30 Sept?/);
  // The real yield is dated, never timed, and says it is behind.
  assert.match(out, /· Ten-year real yield \(TIPS\) 2\.91% on 29 Sept?, from 2\.83% on 25 Sept? — a daily series, a day or more behind/);
  // A symbol TradingView would not serve is named rather than left out.
  assert.match(out, /Not read just now: VIX\./);
  /* NO DIRECTION WORD, because none is computed: a change with its sign worked
     out here is a figure with its window stripped, which is how an evening's
     move was once called the day's. */
  assert.doesNotMatch(out, /\b(up|down|rose|fell)\b/);
  assert.match(out, /hourly bars rather than live ticks/);
});

test('a market that will not read is a sentence telling her not to reach for a search', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'not connected' }), { status: 500 });
    assert.match(await aroundBlock(), /could not be read just now\. Do not quote the dollar or yields from a search/);
    // An answer with nothing in it is the same: zero lines is not a market.
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, market: [], missing: [] }), { status: 200 });
    assert.match(await aroundBlock(), /could not be read just now/);
    globalThis.fetch = async () => new Response(JSON.stringify(AROUND), { status: 200 });
    assert.match(await aroundBlock(), /Dollar index 102\.16/);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
});

/* ─── What the wires said ────────────────────────────────────────────────────
   Four headlines from the 1 October probe, fields as served — and the Reuters
   gold story put on the dollar's feed as well, since a story on both feeds is
   the overlap the fold exists to remove. */
const H = (id, published, title, name) => ({ id, published, title, provider: { name }, paywall: true });
const GOLD_NEWS = { data: { headlines: [
  H('tag:reuters.com,2026:newsml_L1N45N0PD:0', 1790869666,
    'Gold holds steady as firm dollar, yields counter easing Fed rate hike bets', 'Reuters'),
  H('DJN_DN20261001005012:0', 1790861220, 'Comex Gold Delivery Intentions Breakdown - Oct 1', 'Dow Jones Newswires'),
] }, success: true };
const DXY_NEWS = { data: { headlines: [
  H('macenews:ed8cb4683094b:0', 1790876280,
    "FED GOV JEFFERSON/CHARLOTTESVILLE: 'EXPECT INFLATION TO BE ELEVATED IN THE SHORT RUN BEFORE RESUMING ITS DECLINE TOWARD OUR 2% GOAL'",
    'Mace News'),
  H('tag:reuters.com,2026:newsml_L6N45N0VX:0', 1790873546,
    'Yields fall after US 10-year hits highest since 2002; stocks, euro also decline', 'Reuters'),
  H('tag:reuters.com,2026:newsml_L1N45N0PD:0', 1790869666,
    'Gold holds steady as firm dollar, yields counter easing Fed rate hike bets', 'Reuters'),
] }, success: true };

test('two feeds fold to one list of headlines, a story on both counted once, newest first', () => {
  const folded = foldHeadlines([{ symbol: 'TVC:GOLD', answer: GOLD_NEWS }, { symbol: 'TVC:DXY', answer: DXY_NEWS }]);
  assert.equal(folded.length, 4, 'the story carried by both feeds was counted twice');
  assert.deepEqual(folded.map(h => h.published), [
    '2026-10-01T17:38:00.000Z', '2026-10-01T16:52:26.000Z', '2026-10-01T15:47:46.000Z', '2026-10-01T13:27:00.000Z']);
  assert.deepEqual(folded[0], { id: 'macenews:ed8cb4683094b:0', source: 'Mace News', feed: 'TVC:DXY',
    published: '2026-10-01T17:38:00.000Z', title: DXY_NEWS.data.headlines[0].title });
  assert.equal(folded.find(h => h.id.endsWith('L1N45N0PD:0')).feed, 'TVC:GOLD');
});

test('the move look is handed the last hour of headlines and says so, and says when a feed failed', () => {
  const headlines = foldHeadlines([{ symbol: 'TVC:GOLD', answer: GOLD_NEWS }, { symbol: 'TVC:DXY', answer: DXY_NEWS }]);
  const out = headlinesList({ headlines, missing: [] }, Date.parse('2026-10-01T17:45:00Z'));
  assert.match(out, /Headlines in the last hour, from TradingView's gold and dollar feeds — titles only/);
  assert.match(out, /· 13:38 ET, Mace News: FED GOV JEFFERSON/);
  assert.match(out, /· 12:52 ET, Reuters: Yields fall after US 10-year hits highest since 2002/);
  // The morning's gold story is not an explanation for a move a quarter-hour old.
  assert.doesNotMatch(out, /Gold holds steady/);
  assert.ok(out.indexOf('13:38') < out.indexOf('12:52'), 'the headlines are not newest first');

  assert.match(headlinesList({ headlines, missing: [] }, Date.parse('2026-10-01T21:00:00Z')),
    /No headline on gold's or the dollar's TradingView feeds in the last hour\./);
  assert.match(headlinesList({ headlines: [], missing: [{ symbol: 'TVC:DXY' }] }, Date.now()),
    /One of the two feeds could not be read\./);
});

/* A conversation reads six hours, and six hours is a span a feed read to a
   fixed number of headlines may not hold. Folded, the fixture's dollar feed
   stops at 12:52 New York while its gold feed reaches 09:27, so before 12:52
   only one feed was read — and a block that did not say so would hand her a
   quiet dollar where there was an unread one. */
test('the conversation reads six hours of headlines, names another day, and says where a feed stops', () => {
  const headlines = foldHeadlines([{ symbol: 'TVC:GOLD', answer: GOLD_NEWS }, { symbol: 'TVC:DXY', answer: DXY_NEWS }]);
  const out = headlinesList({ headlines, missing: [] }, Date.parse('2026-10-01T18:00:00Z'), 6 * 60);
  assert.match(out, /Headlines in the last 6 hours/, 'the span is not the one that was read');
  assert.match(out, /Gold holds steady/, 'a headline from earlier in the six hours is dropped');
  assert.match(out, /feeds reach back only to 12:52 ET/,
    'a feed that stops inside the span is presented as a quiet one');

  const next = headlinesList({ headlines, missing: [] }, Date.parse('2026-10-02T05:00:00Z'), 12 * 60);
  assert.match(next, /ET on Thursday 1 Oct/, 'a headline from yesterday reads as today\'s');
  assert.doesNotMatch(headlinesList({ headlines, missing: [] }, Date.parse('2026-10-01T17:45:00Z')),
    /on Thursday/, 'a headline from today carries a date it does not need');
});

test('headlines that will not read send her to search, and never take the look down', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  globalThis.fetch = async () => new Response('not json', { status: 502 });
  try {
    assert.match(await headlinesBlock(), /could not be read just now; search for what moved it/);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
});

/* ─── What the market prices for the Fed ────────────────────────────────────
   The three prices the fedfunds probe read on 1 October. October holds a
   meeting on the 28th and November none, so November's price IS the rate after
   it, and the rate before falls out of October's average over 28 days at one
   rate and 3 at the other: (31 × 3.8825 − 3 × 3.945) / 28 = 3.87580. December
   meets on the 9th and January meets too, so the clear month that pins it is
   November, before it: (31 × 4.085 − 9 × 3.945) / 22 = 4.14227. Worked here
   from the prices rather than read back from the fold. */
const ZQ_PROBE = { '2026-10': 96.1175, '2026-11': 96.055, '2026-12': 95.915 };

test('fed funds futures are read as FedWatch reads them, meeting by meeting', () => {
  const { meetings, unread } = foldRates(ZQ_PROBE, '2026-10-01');
  const [oct, dec] = meetings;
  assert.equal(oct.date, '2026-10-28');
  assert.equal(oct.before, 3.8758, 'the rate before October is not backed out of its own average');
  assert.equal(oct.after, 3.945, 'the clear month after October is not taken as the rate after it');
  assert.deepEqual(oct.odds, [{ bp: 0, chance: 72 }, { bp: 25, chance: 28 }]);
  assert.equal(dec.before, oct.after, 'December does not start where October left off');
  assert.equal(dec.after, 4.1423);
  assert.equal(dec.move_bp, 19.7);
  assert.equal(dec.total_bp, 26.6, 'the move since now is not measured from the rate before October');
  assert.deepEqual(unread, ['2027-01-27'], 'a meeting whose months were not read is dropped rather than named');
});

/* A CONTRACT EXPIRES ON THE LAST DAY OF ITS MONTH, so on 1 December the clear
   November that pins December may not answer — the morning a December
   meeting is closest. January is pinned by a clear February, and the rate
   between the two decisions is one rate, so January's rate before IS
   December's rate after and the meeting still resolves. */
test('a meeting with no clear month read beside it is solved off the meeting after it', () => {
  const prices = { '2026-12': 95.95, '2027-01': 95.80, '2027-02': 95.79, '2027-03': 95.75 };
  const { meetings, unread } = foldRates(prices, '2026-12-01');
  assert.deepEqual(unread, []);
  const [dec, jan] = meetings;
  assert.equal(dec.after, jan.before, 'December is not solved off January');
  // (31 × 4.05 − 22 × after) / 9, with after = (31 × 4.20 − 4 × 4.21) / 27
  const after = (31 * 4.20 - 4 * 4.21) / 27;
  assert.equal(dec.before, Math.round((31 * 4.05 - 22 * after) / 9 * 1e4) / 1e4);
});

test('the contracts are named months, each meeting with the clear one beside it', () => {
  assert.deepEqual(contractMonths('2026-10-01'), ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(['2026-10', '2026-11', '2027-01'].map(zq), ['CBOT:ZQV2026', 'CBOT:ZQX2026', 'CBOT:ZQF2027']);
  // The table's last date is a boundary, never a meeting to price.
  assert.ok(!contractMonths(FOMC.at(-2)).includes(FOMC.at(-1).slice(0, 7)),
    'the last meeting in the table is priced against a month the table cannot say is clear');
});

test('the odds are the two outcomes either side of the move priced', () => {
  assert.deepEqual(oddsOf(6.9), [{ bp: 0, chance: 72 }, { bp: 25, chance: 28 }]);
  assert.deepEqual(oddsOf(-30), [{ bp: -25, chance: 80 }, { bp: -50, chance: 20 }]);
});

/* THE TABLE IS TRUE UNTIL THE YEAR NOBODY EXTENDS IT, so this fails half a year
   before it runs out rather than on the morning it does — on the real clock,
   because the clock is the thing it is about. Every decision is the second day
   of a Tuesday–Wednesday meeting, which is what catches the first day typed. */
test('the table of Fed meetings reaches half a year ahead, and every date is a decision day', () => {
  const left = (Date.parse(FOMC.at(-1)) - Date.now()) / 86_400_000;
  assert.ok(left > 182, `the table of FOMC meetings ends ${FOMC.at(-1)}; add the Fed's next published year`);
  assert.deepEqual(FOMC, [...FOMC].sort());
  for (const d of FOMC) assert.equal(new Date(`${d}T12:00:00Z`).getUTCDay(), 3, `${d} is not a Wednesday`);
});

test('a decision the calendar lists and the table does not refuses the odds; a gap in the feed does not', () => {
  assert.deepEqual(unlisted(['2026-10-28']), []);
  assert.deepEqual(unlisted([]), [], 'a calendar listing nothing is taken as a moved meeting');
  assert.deepEqual(unlisted(['2026-10-21']), ['2026-10-21']);
});

/* What ?rates=1 answered live on 1 October at the 18:00 bar, cut to what
   Eugenia reads. FedWatch shows a later meeting as the chance of each range BY
   THEN — December at 20.6/61.3/18.1 that morning — and the fold's odds for it
   are December's own, given October: a different number for the same pricing.
   So a later meeting is said in basis points priced, which both agree on, and a
   chance for it beside his screen would read as a mistake. */
const RATES = {
  meetings: [
    { date: '2026-10-28', move_bp: 6.6, total_bp: 6.6, odds: [{ bp: 0, chance: 73 }, { bp: 25, chance: 27 }] },
    { date: '2026-12-09', move_bp: 19, total_bp: 25.7, odds: [{ bp: 0, chance: 24 }, { bp: 25, chance: 76 }] },
    { date: '2027-01-27', move_bp: 9.2, total_bp: 35.1, odds: [{ bp: 0, chance: 63 }, { bp: 25, chance: 37 }] },
  ],
  unread: [],
};

test('the first meeting is said as odds and the later ones as what is priced by then', () => {
  const out = ratesList(RATES);
  assert.match(out, /· 28 Oct: 73% no change, 27% a quarter-point hike/);
  assert.match(out, /· 9 Dec: 26 basis points of hikes priced in all by then, 19 of them at this meeting/);
  assert.match(out, /· 27 Jan: 35 basis points of hikes priced in all by then, 9 of them at this meeting/);
  assert.doesNotMatch(out, /76%|37%/, 'a later meeting is said as its own odds, which FedWatch does not show');
  assert.match(out, /at least\s+fifteen minutes behind/, 'the block does not say the bars are delayed');

  const cut = ratesList({ meetings: [{ ...RATES.meetings[0], odds: [{ bp: -25, chance: 60 }, { bp: -50, chance: 40 }] },
    { ...RATES.meetings[1], total_bp: -30.4 }], unread: ['2027-01-27'] });
  assert.match(cut, /60% a quarter-point cut, 40% a 50bp cut/);
  assert.match(cut, /30 basis points of cuts priced in all by then/);
  assert.match(cut, /Not read just now: 27 Jan\./, 'a meeting the fold could not solve is dropped rather than named');
});

test('odds refused or unreadable are a sentence, and never take the briefing down', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  try {
    // Meetings carried alongside, so it is the refusal that decides and not their absence.
    globalThis.fetch = async () => Response.json({ ok: false, error: 'the calendar lists a decision on 2026-10-21',
                                                  meetings: RATES.meetings, unread: [] });
    assert.match(await ratesBlock(), /could not be read just now\. Do not quote rate\s+odds from a search/);
    globalThis.fetch = async () => new Response('not json', { status: 502 });
    assert.match(await ratesBlock(), /could not be read just now/);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
});

/* ─── What the last print became ────────────────────────────────────────────
   The payrolls rows as filed on 2 October, cut to what the line reads. August
   was first reported at 162K and September's row carries it revised to 133K as
   its prior; July, under August's, went from −23K to 21K. The record is handed
   newest first, which is how recordQuery reads it. */
const NFP_SEP = { at: '2026-10-02T12:30:00.000Z', prior: '133K' };
const NFP_RECORD = [
  { at: '2026-09-04T12:30:00.000Z', name: 'Non Farm Payrolls (Aug)', actual: '162K' },
  { at: '2026-08-07T12:30:00.000Z', name: 'Non Farm Payrolls (Jul)', actual: '-23K' },
  { at: '2026-07-03T12:30:00.000Z', name: 'Non Farm Payrolls (Jun)', actual: '147K' },
];

test('a revision is the prior disagreeing with what was first reported, and says both', () => {
  assert.equal(revisionLine(NFP_SEP, NFP_RECORD),
    '\nRevised: Non Farm Payrolls (Aug) was first reported at 162K on 4 Sept, ' +
    'and this release revises it to 133K.');
  assert.equal(revisionLine({ ...NFP_SEP, prior: '162K' }, NFP_RECORD), '',
    'a prior that matches what was first reported is called a revision');
  assert.equal(revisionLine({ ...NFP_SEP, prior: null }, NFP_RECORD), '');
  assert.equal(revisionLine(NFP_SEP, []), '');
});

test('a revision is read only against the print immediately before', () => {
  /* August's row missing: the newest on file is July's, and −23K against a
     prior of 133K is two months apart rather than a revision. */
  assert.equal(revisionLine(NFP_SEP, NFP_RECORD.slice(1)), '',
    'a missing month reads as a revision of the month before it');
  assert.equal(revisionLine(NFP_SEP, NFP_RECORD.slice(0, 1)), '',
    'one row on file is no rhythm to tell a missing print from the last one');
  // A weekly series keeps its own rhythm: claims a week apart are adjacent.
  assert.match(revisionLine({ at: '2026-10-01T12:30:00.000Z', prior: '219K' }, [
    { at: '2026-09-24T12:30:00.000Z', name: 'Initial Jobless Claims', actual: '218K' },
    { at: '2026-09-17T12:30:00.000Z', name: 'Initial Jobless Claims', actual: '231K' },
  ]), /first reported at 218K on 24 Sept, and this release revises it to 219K/);
});

/* ─── Where the speculators stand ───────────────────────────────────────────
   The two reports the CFTC served for gold through pg_net, as strings because
   that is how they arrive. Net 135,699 − 8,310 = 127,389; the week's change is
   the long side's −6,695 less the short side's −968. */
const COT = [
  { report_date_as_yyyy_mm_dd: '2026-09-22T00:00:00.000', m_money_positions_long_all: '135699',
    m_money_positions_short_all: '8310', change_in_m_money_long_all: '-6695', change_in_m_money_short_all: '-968' },
  { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', m_money_positions_long_all: '142394',
    m_money_positions_short_all: '9278', change_in_m_money_long_all: '1210', change_in_m_money_short_all: '-311' },
];

test('positioning is dated, netted, and set against its own range', () => {
  const out = positioningList(COT);
  assert.match(out, /taken Tuesday 22 Sept?/, 'the count does not say which day it was taken');
  assert.match(out, /Net long 127,389 contracts \(135,699 long, 8,310 short\), down 5,727/);
  assert.match(out, /Over the 2 weeks to then, net ranged from long 127,389 on 22 Sept? to long 133,116 on 15 Sept?/);
  const short = [{ ...COT[0], m_money_positions_long_all: '1000', m_money_positions_short_all: '4000' }];
  assert.match(positioningList(short), /Net short 3,000/, 'a net short reads as a negative long');
  assert.throws(() => positioningList([{ ...COT[0], m_money_positions_long_all: 'n/a' }]), /no readable report/);
  // The dataset leaves a null field out of the row rather than sending it.
  const { change_in_m_money_short_all, ...partial } = COT[0];
  assert.throws(() => positioningList([partial]), /no readable report/);
  assert.throws(() => positioningList([]), /no readable report/);
});

test('positioning that will not read is a sentence, and never takes the briefing down', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  globalThis.fetch = async () => new Response('[]', { status: 200 });
  try {
    assert.match(await positioningBlock(), /could not be read just now; do not quote it from a search/);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
});

/* ─── How a release usually goes ─────────────────────────────────────────── */

test("a release's record is listed oldest first, as printed, and never scored", () => {
  const out = recordList('Core PCE Price Index MoM (Sep)', [
    { at: '2026-08-29T12:30:00.000Z', name: 'Core PCE Price Index MoM (Jul)', consensus: '0.2%', actual: '0.1%' },
    { at: '2026-09-30T12:30:00.000Z', name: 'Core PCE Price Index MoM (Aug)', consensus: '0.3%', actual: '0.2%' },
    { at: '2026-07-31T12:30:00.000Z', name: 'Core PCE Price Index MoM (Jun)', consensus: null, actual: '0.3%' },
  ].slice(0, 2));
  assert.match(out, /How Core PCE Price Index MoM \(Sep\) has printed against expectations, the last 2 times:/);
  assert.ok(out.indexOf('(Jul)') < out.indexOf('(Aug)'), 'the record does not read oldest first');
  assert.match(out, /· 29 Aug, Core PCE Price Index MoM \(Jul\): 0\.1% against 0\.2% expected/);
  // A missing consensus is said, not left to read as a figure.
  assert.match(recordList('x', [{ at: '2026-07-31T12:30:00.000Z', name: 'x (Jun)', consensus: null, actual: '0.3%' }]),
    /x \(Jun\): 0\.3%, no consensus on file/);
  assert.doesNotMatch(out, /\b(above|below|beat|miss)\b/, 'the record is scored rather than listed');
  assert.equal(recordList('x', []), '');
});

test('the record reads one series, newest first, before the release, printed ones only', () => {
  const q = recordQuery('ECONOMICS:USCPCEPIMM', '2026-10-30T12:30:00.000Z');
  assert.match(q, /^eugenia_calendar\?select=at,name,consensus,actual&ticker=eq\.ECONOMICS%3AUSCPCEPIMM&/);
  assert.match(q, /&at=lt\.2026-10-30T12:30:00\.000Z&actual=not\.is\.null&order=at\.desc&limit=12$/);
});

test('the calendar window is whole days, at most a month, inside the data', () => {
  assert.deepEqual(calendarWindow('2026-10-01', '2026-10-03'), { date_from: '2026-10-01', date_to: '2026-10-03' });
  assert.deepEqual(calendarWindow('2026-10-01', '2026-10-01'), { date_from: '2026-10-01', date_to: '2026-10-01' });
  assert.ok(calendarWindow('2026-09-01', '2026-10-02'), 'thirty-one days is allowed');
  assert.equal(calendarWindow('2026-09-01', '2026-10-03'), null);
  assert.equal(calendarWindow('2026-10-03', '2026-10-01'), null);
  assert.equal(calendarWindow('2003-08-31', '2003-09-02'), null);
  assert.equal(calendarWindow('2026-10-01T00:00:00Z', '2026-10-02'), null);
  assert.equal(calendarWindow('2026-10-01', null), null);
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
  /* AND SUNDAY RETRIES AS ITSELF. 22:00, 23:00 and 00:00 UTC are 18:00, 19:00
     and 20:00 in New York — the same three hours after its own briefing that a
     weekday gets, and it must come back 'sunday' rather than 'weekday' or the
     retry sends Buenos dias at the week's open. The last of them is 00:00 UTC
     on the Monday, which is still Sunday evening in New York; it is the hour a
     walk restarting each UTC day never reaches, and the reason this one runs
     168 consecutive hours. Two clear of the 02:00 pass. */
  assert.deepEqual(timetable(false), [
    '2026-08-16T02:00 consolidate', '2026-08-16T21:00 sunday',
    '2026-08-16T22:00 sunday', '2026-08-16T23:00 sunday', '2026-08-17T00:00 sunday',
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
    assert.equal(retryDue(new Date(Date.UTC(2026, 7, 19, h))), 'weekday', `${h}:00 UTC`);
  }
  // 08:00 is the briefing's own hour, and noon is too late to be a morning.
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 19, 12))), null);
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 19, 16))), null);
});

test('the retry window holds its New York hours in winter too', () => {
  // January: EST (UTC-5), so 09:00 ET is 14:00 UTC and 08:00 ET is 13:00.
  assert.equal(retryDue(new Date(Date.UTC(2026, 0, 14, 14))), 'weekday');
  assert.equal(retryDue(new Date(Date.UTC(2026, 0, 14, 13))), null);
});

/* ─── Sunday's own three hours, which it did not have ────────────────────────
   The Sunday open is the one briefing of the week that could not be retried,
   and the one whose absence takes seven days to come round again — so it was
   both the least recoverable and the least noticeable. It went missing on the
   first Sunday the branch existed for and there was no second chance in the
   timetable at all.
   ─────────────────────────────────────────────────────────────────────────── */

test('Sunday retries in the three hours after its open, as itself', () => {
  // Sun 23 Aug 2026, EDT: 17:00 ET is 21:00 UTC, so 22:00–00:00 UTC is 18:00–20:00.
  for (const [h, d] of [[22, 23], [23, 23], [0, 24]]) {
    assert.equal(retryDue(new Date(Date.UTC(2026, 7, d, h))), 'sunday',
      `${h}:00 UTC on the ${d}th — a retry that answers 'weekday' sends Buenos ` +
      `dias and a weekday shape into a market that has just opened for the week`);
  }
  // 17:00 ET is the briefing's own hour, and 21:00 is late enough that the week
  // is under way — it also leaves the 22:00 pass two hours clear.
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 23, 21))), null);
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 24, 1))), null);
});

test('Saturday never retries, and the weekday window does not reach Sunday', () => {
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 22, 14))), null);   // Saturday
  // 10:00 ET on a Sunday: inside the WEEKDAY window's hours and not its days.
  assert.equal(retryDue(new Date(Date.UTC(2026, 7, 23, 14))), null);
});

/* ─── Which briefing a forced call sends ─────────────────────────────────────
   `?force=1` exists for the hour a briefing did NOT arrive, and it read
   `briefDue(now) ?? 'weekday'` — so outside the single hour a Sunday briefing
   is due, the door for recovering one could not produce one. The fallback is a
   question about the DAY, and it was being answered with a constant.
   ─────────────────────────────────────────────────────────────────────────── */

test('a forced briefing takes the shape of the day, not a constant', () => {
  // Sunday evening, hours after the open — the exact case the door exists for.
  assert.equal(briefKind(new Date(Date.UTC(2026, 7, 24, 1))), 'sunday');   // 21:00 ET Sun
  assert.equal(briefKind(new Date(Date.UTC(2026, 7, 23, 21))), 'sunday');  // 17:00 ET Sun
  // And Sunday BEFORE the open is still Sunday: a forced call at noon is for
  // the evening that has not happened, not for a Monday morning.
  assert.equal(briefKind(new Date(Date.UTC(2026, 7, 23, 16))), 'sunday');  // 12:00 ET Sun
  assert.equal(briefKind(new Date(Date.UTC(2026, 7, 19, 16))), 'weekday');
  assert.equal(briefKind(new Date(Date.UTC(2026, 7, 22, 16))), 'weekday'); // Saturday
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

/* ─── Eugenia: which message a swipe-reply answers ───────────────────────────
   Answered off a stand-in table rather than by reading the query's spelling,
   because the spelling of a wrong answer is equally plausible: the newest row
   in the window is what she said SINCE, and a query ordered that way reads
   exactly as well as the right one.
   ───────────────────────────────────────────────────────────────────────── */

const pickTurn = (query, rows) => {
  const params = new URLSearchParams(query.split('?')[1]);
  const [col, dir] = params.get('order').split('.');
  const kept = rows.filter(r => params.getAll('role').every(v => v === `eq.${r.role}`) &&
    params.getAll('created_at').every(v => {
      const [op, ...rest] = v.split('.'); const bound = rest.join('.');
      return op === 'gte' ? r.created_at >= bound : op === 'lte' ? r.created_at <= bound : false;
    }));
  kept.sort((a, b) => (a[col] < b[col] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
  return kept.slice(0, Number(params.get('limit'))).map(r => r.content);
};

test('a reply is matched to the message it answers, not to what she said since', () => {
  const sent = Date.UTC(2026, 8, 25, 14, 0, 0) / 1000;
  const iso = (s) => new Date((sent + s) * 1000).toISOString();
  const rows = [
    { role: 'assistant', content: 'the briefing',        created_at: iso(-7200) },
    { role: 'user',      content: '[pulse]',             created_at: iso(12) },
    { role: 'assistant', content: 'the pulse',           created_at: iso(12) },
    { role: 'user',      content: 'what does that mean', created_at: iso(90) },
    { role: 'assistant', content: 'her answer to that',  created_at: iso(90) },
  ];
  assert.equal(repliedQuery(sent).split('?')[0], 'eugenia_turns');
  assert.deepEqual(pickTurn(repliedQuery(sent), rows), ['the pulse']);
  // A message that was never stored finds nothing, rather than a turn from later.
  assert.deepEqual(pickTurn(repliedQuery(sent - 3600), rows), []);
});


/* ─── The heartbeat the two silent writers leave ─────────────────────────────
   The poller and the email function report failure to nobody: console.error and
   a response pg_net discards. So the symptom of either dying is trades that
   never arrive, and that is indistinguishable from a week he did not trade.

   STALENESS IS THE TEST, NOT THE ERROR, and that is the whole design. A writer
   failing every run and a writer that stopped being invoked at all — an
   unscheduled cron job, a renamed function, a deploy that dropped one — produce
   the same silence, and an alarm on failure cannot fire for the second. Only
   last_ok going cold sees both.
   ─────────────────────────────────────────────────────────────────────────── */

const HEALTH_NOW = Date.UTC(2026, 7, 19, 12, 0);
const ago = (h) => new Date(HEALTH_NOW - h * 3600_000).toISOString();

test('a writer that has run recently is not mentioned at all', () => {
  const line = healthLine([
    { id: 'poller', last_ok: ago(0.1), last_error: null, last_error_at: null },
    { id: 'email',  last_ok: ago(3),   last_error: null, last_error_at: null },
  ], HEALTH_NOW);
  assert.equal(line, '',
    'a healthy pair still produced a line — this reaches him every morning, so ' +
    'silence when nothing is wrong is what makes the line worth reading');
});

/* ─── THE TWO FALSE ALARMS, WHICH ARE THE WHOLE RISK HERE ────────────────────
   A monitor that is wrong on ordinary days gets ignored, and an ignored monitor
   is worse than none — it is the green tick that stops anyone looking. Both of
   these fired on the first design and both are ordinary days.
   ─────────────────────────────────────────────────────────────────────────── */

test('a quiet weekend is not the poller dying', () => {
  /* Gold closes Friday 17:00 New York and opens Sunday 17:00. The poller is
     still invoked every two minutes across that and answers "market closed" —
     which IS a completed run: cron fired, the function is deployed, its secrets
     loaded, it decided correctly. It marks itself on that path for exactly this
     reason. Without the mark, forty-eight hours pass against a six-hour window
     and she reports the sync dead every Sunday evening. */
  const line = healthLine(
    [{ id: 'poller', last_ok: ago(0.05), last_error: null, last_error_at: null }],
    HEALTH_NOW);
  assert.equal(line, '', 'a weekend skip was read as a dead poller');
});

test('a week with no fills is not the email path dying', () => {
  /* The email function runs only when a fill arrives, so silence is a quiet
     week and nothing else. Judging it by staleness fires on almost every
     ordinary day — which is the same defect as the weekend one and far more
     frequent. Silence is evidence only for the writer that runs on a clock. */
  const line = healthLine(
    [{ id: 'email', last_ok: ago(200), last_error: null, last_error_at: null }],
    HEALTH_NOW);
  assert.equal(line, '',
    'a week without trades was reported as the fill emails failing');

  // But the poller going quiet for the same stretch is real, and is reported.
  assert.match(
    healthLine([{ id: 'poller', last_ok: ago(200), last_error: null, last_error_at: null }],
               HEALTH_NOW),
    /the broker sync last completed a run/,
    'silence from the scheduled writer has to still be evidence');
});

test('a writer gone quiet is named, with when it last completed a run', () => {
  const line = healthLine([
    { id: 'poller', last_ok: ago(9), last_error: null, last_error_at: null },
    { id: 'email',  last_ok: ago(1), last_error: null, last_error_at: null },
  ], HEALTH_NOW);
  assert.match(line, /the broker sync/, 'the writer is named in words, not as an id');
  assert.doesNotMatch(line, /the fill emails/, 'the healthy one was named too');
  assert.match(line, /2026-08-19 03:00 UTC/, 'the time it went quiet has to be in it');
  assert.match(line, /Say this first/,
    'she is not told to lead with it, so a briefing about gold sits on top of a ' +
    'journal that stopped updating');
});

test('a writer that has never run says so rather than showing a blank', () => {
  const line = healthLine(
    [{ id: 'poller', last_ok: null, last_error: null, last_error_at: null }], HEALTH_NOW);
  assert.match(line, /has never completed a run/);
});

test('the last outcome decides, for the writer no clock can judge', () => {
  /* The email path is reported on its OUTCOME rather than its silence, so a
     failure has to surface however long ago the last fill was — and a success
     after it has to clear. */
  const failing = healthLine(
    [{ id: 'email', last_ok: ago(30), last_error: 'HTTP 401 — bad key', last_error_at: ago(2) }],
    HEALTH_NOW);
  assert.match(failing, /the fill emails failed at/);
  assert.match(failing, /HTTP 401 — bad key/, 'the reason has to travel with it');

  const recovered = healthLine(
    [{ id: 'email', last_ok: ago(1), last_error: 'HTTP 401 — bad key', last_error_at: ago(2) }],
    HEALTH_NOW);
  assert.equal(recovered, '',
    'an error older than the last success is a fault already recovered from, ' +
    'and reporting it every morning is how a real one stops being read');
});

test('a writer that has failed and never succeeded is reported', () => {
  // `ok > failed` is NaN-false when last_ok is null, so this is the case that
  // needs saying out loud rather than being left to the comparison.
  const line = healthLine(
    [{ id: 'email', last_ok: null, last_error: 'refused', last_error_at: ago(1) }],
    HEALTH_NOW);
  assert.match(line, /the fill emails failed at/);
});

/* ─── The copy of her memory, and the loop that is the whole of it ───────────
   The app's weekly backup carries `trades` — the one table cTrader could
   rebuild. Her notes, turns, channel map, thesis, loops and calendar have no
   other source, and the app cannot read them by design. This script is the only
   copy, which makes its paging the load-bearing part: PostgREST caps a response
   at its own max-rows whatever is asked for, so ONE read of eugenia_turns
   returns a page and looks exactly like a complete archive.

   That failure is invisible in every way that matters — the job is green, the
   file is well-formed, the counts look plausible — and it is discovered on the
   day someone restores from it.
   ─────────────────────────────────────────────────────────────────────────── */

test('a table larger than one page is read to the end', async () => {
  // 2,300 rows against a 1,000 page: three requests, the last one short.
  const all = Array.from({ length: 2300 }, (_, i) => ({ id: i + 1 }));
  const ranges = [];
  const stub = async (url, opts) => {
    const [from, to] = opts.headers.Range.split('-').map(Number);
    ranges.push(opts.headers.Range);
    return { ok: true, json: async () => all.slice(from, to + 1) };
  };

  const rows = await readAll('https://x', 'k', 'eugenia_turns', 'id', stub);
  assert.equal(rows.length, 2300, 'the read stopped before the end of the table');
  assert.deepEqual(rows.map(r => r.id), all.map(r => r.id), 'rows were lost or reordered');
  assert.deepEqual(ranges, ['0-999', '1000-1999', '2000-2999'],
    'the walk did not page the way it claims to');
});

test('a table that fits in one page costs one request', async () => {
  let calls = 0;
  const stub = async () => { calls++; return { ok: true, json: async () => [{ id: 1 }] }; };
  assert.equal((await readAll('https://x', 'k', 'eugenia_notes', 'id', stub)).length, 1);
  assert.equal(calls, 1, 'a short page is the end and must not be followed by another read');
});

test('a refused read throws rather than backing up a blank', async () => {
  const stub = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(() => readAll('https://x', 'k', 'eugenia_notes', 'id', stub), /401/,
    'a refused read returned quietly, so the backup would hold an empty table ' +
    'and the job would go green over it');
});

test('the backup names every table that has no other source', async () => {
  const asked = [];
  const stub = async (u) => { asked.push(u); return { ok: true, json: async () => [] }; };
  const out = await backup('https://x', 'k', stub);
  // A key of several columns is ordered by all of them, or a page boundary
  // between two rows sharing the first can serve one twice or not at all.
  assert.ok(asked.includes('https://x/rest/v1/trade_stops?select=*&order=id.asc,seen_at.asc'),
    'trade_stops is not paged by its whole key');
  assert.ok(asked.includes('https://x/rest/v1/eugenia_notes?select=*&order=id.asc'),
    'a one-column key is no longer paged the way it was');
  for (const t of ['eugenia_notes', 'eugenia_turns', 'eugenia_channels',
                   'eugenia_thesis', 'eugenia_loops', 'eugenia_calendar',
                   'trade_stops']) {
    assert.ok(t in out.tables, `${t} cannot be rebuilt from anywhere and is not in the backup`);
  }
  // The cost meter is deliberately out: every row is about a model call rather
  // than about him, and it is by far the largest table.
  assert.ok(!TABLES.some(([t]) => t === 'eugenia_runs'), 'the cost meter is in the backup');
  assert.match(out.taken_at, /^\d{4}-\d\d-\d\dT/, 'the document does not say when it was taken');
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
  assert.deepEqual(chunk('Buenos días jefesito.'), ['Buenos días jefesito.']);
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
  assert.match(line, /test — claude-opus-5, 1 round\(s\), medium effort/);
  assert.doesNotMatch(line, /FELL BACK/);
});

test('a caller on a cheaper model does not read as having fallen back', async () => {
  /* THE HALF THE SPLIT COULD HAVE BROKEN SILENTLY. The fallback column is
     `what answered` against `what was asked for`, and that was one constant for
     the whole file. Left that way, every Sonnet caller would report a fallback
     on every single call — three of the eight, every turn — and `fell_back`
     would stop meaning anything on the day the models parted.

     Driven through `ask` with a Sonnet caller's label, because the comparison
     is inside the loop and a constant put back there passes every pure test. */
  const realFetch = globalThis.fetch, realLog = console.log;
  const lines = [];
  globalThis.fetch = async () => answers('claude-sonnet-5');
  console.log = (line) => lines.push(line);
  try {
    await ask([{ role: 'user', content: 'anything' }], 'medium', 'trim');
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  assert.match(lines[0], /trim — claude-sonnet-5/,
    'the trim did not ask for Sonnet, so the model map is not reaching the request');
  assert.doesNotMatch(lines[0], /FELL BACK/,
    'a caller answered by the model it asked for reads as a fallback, so the ' +
    'comparison is against one name for the file rather than against the caller');
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

/* ─── A paused turn, and a cut-off one ───────────────────────────────────────
   Two stop reasons that both carry text, and neither text is the answer. A
   pause is the server's search loop running out of iterations mid-turn; a
   max_tokens stop is the answer truncated. Driven through ask() for the reason
   the tests above are: the loop is what has to tell them apart from an ending.
   ─────────────────────────────────────────────────────────────────────────── */

const pausedContent = [
  { type: 'text', text: 'Let me look at the overnight session.' },
  { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'gold' } },
];
const paused = (model) => served(model, { stop_reason: 'pause_turn', content: pausedContent });

test('a paused turn is resumed, not sent as the answer', async () => {
  const { sent, lines } = await bodiesOf([paused('claude-opus-5'), answers('claude-opus-5')]);
  assert.equal(sent.length, 2, 'the paused turn ended the loop, so its preamble was the answer');
  // Resumed by sending it back as it stands, with nothing after it.
  assert.deepEqual(sent[1].messages.at(-1), { role: 'assistant', content: pausedContent });
  assert.match(lines[0], /2 round\(s\)/);
});

test('a turn cut off at max_tokens fails rather than sending half an answer', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  const rows = [];
  globalThis.fetch = async (url, init) => String(url).startsWith('/rest/')
    ? (rows.push(JSON.parse(init.body)[0]), { ok: true, status: 201 })
    : served('claude-opus-5', { stop_reason: 'max_tokens',
        content: [{ type: 'text', text: 'Gold opened the week at' }] });
  console.error = () => {};
  try {
    await assert.rejects(ask([{ role: 'user', content: 'anything' }], 'medium', 'test'),
      /max_tokens/);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.match(rows[0].detail, /max_tokens/, 'the failure row does not say why the turn died');
});

/* ─── What the cache costs, and what stops it being bought twice ─────────────
   TWO THINGS SHIP TOGETHER HERE BECAUSE THEY ARE THE SAME OMISSION. Only the
   system block carried a breakpoint, so a tool round re-sent the whole
   conversation at full price; and a cache WRITE — 1.25× at five minutes, 2× at
   an hour — was counted nowhere, so the meter that exists to say what a turn
   cost could not see either fact.

   DRIVEN THROUGH ask(), for the reason every other test in this section is:
   what was at risk was never the arithmetic. A breakpoint that is computed and
   never attached to a request, and a usage field read into a variable nothing
   prints, both pass any assertion made on the value alone.
   ─────────────────────────────────────────────────────────────────────────── */

// The same two-round shape as above, with the request bodies kept.
async function bodiesOf(responses) {
  const realFetch = globalThis.fetch, realLog = console.log, realErr = console.error;
  const sent = [], lines = [];
  let n = 0;
  globalThis.fetch = async (url, init) =>
    String(url).startsWith('/rest/')
      ? { ok: true, status: 200, json: async () => [] }
      : (sent.push(JSON.parse(init.body)), responses[n++]);
  console.log = (line) => lines.push(line);
  console.error = () => {};
  try {
    await ask([{ role: 'user', content: 'anything' }], 'medium', 'test');
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realErr;
  }
  return { sent, lines };
}

// Every cache_control marker sitting in a request's messages, ignoring the
// system block — which has carried one since the strategy moved into it.
const marks = (body) => body.messages.flatMap(m =>
  (Array.isArray(m.content) ? m.content : []).filter(b => b.cache_control));

test('the first request marks nothing, because there is nothing yet to re-read', async () => {
  const { sent } = await bodiesOf([asksForStrategy('claude-opus-5'),
                                   answers('claude-opus-5')]);
  assert.equal(marks(sent[0]).length, 0,
    'a breakpoint on the opening message is a write nothing will ever read back');
});

test('the round after a tool call reads the last one back instead of buying it', async () => {
  const { sent } = await bodiesOf([asksForStrategy('claude-opus-5'),
                                   answers('claude-opus-5')]);
  const [mark] = marks(sent[1]);
  assert.ok(mark, 'the tool results carry no breakpoint — every round re-sends ' +
                  'the whole conversation at full price, which is what this fixes');
  assert.equal(mark.type, 'tool_result',
    'the mark is not on the tool results, so it is not where the conversation grew');
  // FIVE MINUTES, NOT THE PREFIX'S HOUR: rounds are seconds apart and nothing
  // reads this after the turn, so an hour would pay 2× for a lifetime unused.
  assert.deepEqual(mark.cache_control, { type: 'ephemeral' });
});

test('the mark moves rather than accumulating, which is what keeps it under four', async () => {
  /* A REQUEST MAY CARRY FOUR BREAKPOINTS, THE SYSTEM BLOCK HOLDS ONE, AND THIS
     LOOP RUNS SIX ROUNDS. Left behind on each round the fifth request is a 400
     — and a briefing that 400s on its fifth round is a briefing that dies on
     exactly the mornings it had the most to read. Two tool rounds is enough to
     tell a mark that moved from one that stayed. */
  const { sent } = await bodiesOf([asksForStrategy('claude-opus-5'),
                                   asksForStrategy('claude-opus-5'),
                                   answers('claude-opus-5')]);
  assert.equal(marks(sent[2]).length, 1,
    `the third request carries ${marks(sent[2]).length} breakpoints — they are ` +
    `accumulating, and the fifth round will be refused`);
});

test('a cache write is counted, and the two prices are counted apart', async () => {
  /* THE FIGURE THAT DECIDES THE ttl AND WAS THE ONE THE METER DID NOT COLLECT.
     A read is a tenth of the input price and was always counted; a write is
     1.25× or 2× depending on the lifetime asked for, so a single total cannot
     be turned back into money. */
  const { lines } = await bodiesOf([served('claude-opus-5', {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'an answer' }],
    usage: {
      input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 400,
      cache_creation_input_tokens: 1300,
      cache_creation: { ephemeral_1h_input_tokens: 1000,
                        ephemeral_5m_input_tokens: 300 },
    },
  })]);
  assert.match(lines[0], /400 cached, 1000\+300 written/);
});

test('a vendor that stops splitting the total reads as wrong, never as free', async () => {
  /* THE FIVE-MINUTE FIGURE IS THE REMAINDER RATHER THAN A READ, and this is the
     whole reason. Read directly, a response with no `cache_creation` breakdown
     would report both TTLs at zero — a cache costing nothing, which is what a
     working one is supposed to look like. As a remainder it lands somewhere
     visible instead. */
  const { lines } = await bodiesOf([served('claude-opus-5', {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'an answer' }],
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1300 },
  })]);
  assert.match(lines[0], /0\+1300 written/);
});

/* ─── The rung he can move himself ───────────────────────────────────────────
   The ladder climbs on him using a term back, judged at the nightly pass — so a
   reader who takes the briefing and rarely answers it never leaves `explained`,
   the rung that says restate the mechanism every time. This is him saying where
   he is, which is the standing a demotion already had.
   ─────────────────────────────────────────────────────────────────────────── */

test('a channel and a rung come back as the ids the table holds', () => {
  assert.deepEqual(parseChannel('/channel dollar used'), { channel: 'dollar', state: 'used' });
});

test('the spoken name works, because that is the one he is shown', () => {
  // /notes prints the names; the table holds the ids. A command that only took
  // the id would be a dial he cannot find the label for.
  const [id, name] = CHANNELS.find(([, n]) => n.split(' ').length > 2);
  assert.deepEqual(parseChannel(`/channel ${name} owns`), { channel: id, state: 'owns' });
});

test('the rung is the last word, not the second', () => {
  /* THE SHAPE THAT BREAKS ON THE REAL NAMES. Three of the five are several
     words long, so reading the rung out of position two makes most of the map
     unnameable — and it fails as "no such channel", which reads like the
     command working on a name he got wrong. */
  const multi = CHANNELS.filter(([, n]) => n.includes(' '));
  assert.ok(multi.length >= 3, 'the names are no longer multi-word — this test is asserting nothing');
  for (const [id, name] of multi) {
    assert.deepEqual(parseChannel(`/channel ${name} used`), { channel: id, state: 'used' });
  }
});

test('a rung that is not a rung is said back, never guessed at', () => {
  const said = parseChannel('/channel dollar mastered');
  assert.equal(typeof said, 'string');
  assert.match(said, /not a rung/);
  for (const rung of CHANNEL_STATES) assert.ok(said.includes(rung), `${rung} is not offered back`);
});

test('a channel she does not have lists the ones she does', () => {
  const said = parseChannel('/channel bitcoin used');
  assert.equal(typeof said, 'string');
  for (const [id] of CHANNELS) assert.ok(said.includes(id), `${id} is missing from the list`);
});

test('the bare command says how to use it rather than doing nothing', () => {
  assert.match(parseChannel('/channel'), /channel/);
  assert.match(parseChannel('/channel   '), /channel/);
});

test('every other message is not this command', () => {
  // It runs on every inbound message, so anything it claims by accident is a
  // reply he never gets.
  for (const other of ['/notes', '/start', 'channel dollar used', 'what is the dollar doing',
                       'the channel is open', '']) {
    assert.equal(parseChannel(other), null, `"${other}" was taken for a channel command`);
  }
});

/* ─── One look per release time, because one print is not one row ────────────
   While she typed the calendar, `PPI`, `US PPI` and `US PPI (August)` were
   three rows and one print, and each one marked high fired its own look, its
   own model call and its own message. A time holds several rows still — the
   08:30 slot is most of a report — so one look covers the time.

   The fixture is the real morning, names and timestamps as the table holds
   them: five high rows for one CPI at 12:30 on 11 September.
   ─────────────────────────────────────────────────────────────────────────── */

const CPI_MORNING = [
  { id: 1, at: '2026-09-11T12:30:00+00', name: 'August CPI',        importance: 'high', looked_at: null },
  { id: 2, at: '2026-09-11T12:30:00+00', name: 'core CPI',          importance: 'high', looked_at: null },
  { id: 3, at: '2026-09-11T12:30:00+00', name: 'headline CPI',      importance: 'high', looked_at: null },
  { id: 4, at: '2026-09-11T12:30:00+00', name: 'US CPI (August)',   importance: 'high', looked_at: null },
  { id: 5, at: '2026-09-11T12:30:00+00', name: 'US CPI (core CPI)', importance: 'high', looked_at: null },
  { id: 6, at: '2026-09-11T14:00:00+00', name: 'Michigan sentiment', importance: 'high', looked_at: null },
];

test('one print under five names is one look, not five', () => {
  const due = dueRelease(CPI_MORNING);
  assert.equal(due.length, 5, 'the group is not the whole release time');
  assert.deepEqual([...new Set(due.map(r => r.at))], ['2026-09-11T12:30:00+00'],
    'the group spans two release times, so one message would cover two prints');
});

test('a release time with any mark on it is finished, whatever else stands there', () => {
  /* THE HALF THAT BREAKS THE LOOP. A row minted at 08:35 by the look itself is
     unlooked and shares the release time — under the old question it was the
     next quarter-hour's second message about the same number. */
  const minted = [...CPI_MORNING.slice(0, 2).map(r => ({ ...r, looked_at: '2026-09-11T12:35:00+00' })),
                  ...CPI_MORNING.slice(2)];
  const due = dueRelease(minted);
  assert.deepEqual(due.map(r => r.name), ['Michigan sentiment'],
    'a looked-at release time came back again, so the duplicates still speak');
});

test('the earliest unlooked release time is the one taken', () => {
  // Rows arrive `at.asc` but the decision must not depend on that: a group is
  // chosen by its time, and the query's ordering is not the guarantee.
  const shuffled = [...CPI_MORNING].reverse();
  assert.equal(dueRelease(shuffled)[0].at, '2026-09-11T12:30:00+00');
});

test('nothing standing unlooked is no look at all', () => {
  assert.deepEqual(dueRelease([]), []);
  assert.deepEqual(dueRelease(CPI_MORNING.map(r => ({ ...r, looked_at: 'x' }))), []);
});

/* ─── The actual goes to the row that was looked at ──────────────────────────
   An upsert keyed on a name the model writes was once handed
   `US retail sales (August, advance)`, marked that row at 12:35:00 and filed
   the print under `retail sales` at 12:36:15. An INSERT, silently: the actual
   landed on a row with no consensus and the consensus stayed on a row with no
   actual, which is the one comparison the table holds. The prompt had said *the
   same time and name* since the tool was written, which is the evidence that an
   instruction cannot carry this.

   So the tool on that path cannot insert at all. These drive it rather than
   asserting on its source, because "it is a PATCH" is exactly the claim a
   reading cannot settle.
   ─────────────────────────────────────────────────────────────────────────── */

/* Every request record_actual made, with the answer it gave, against `onFile` —
   the calendar as it stands. THE STUB FILTERS THE WAY PostgREST DOES, and that
   is the point of it. It used to answer every PATCH with a matched row whatever
   the URL said, and the test beside it asserted the name went out wrapped in
   double quotes: so the suite held the tool to a filter that could never match,
   and went green while every print for a fortnight was recorded nowhere. A top-
   level `eq` value is taken whole — PostgREST's `pSingleVal` is `many anyChar`
   — and quotes are stripped only inside an `in.(…)` list. So each filter here
   is split off the raw query, decoded, and compared literally. */
async function actualWrites(input, onFile) {
  const realFetch = globalThis.fetch, realErr = console.error;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    const eq = Object.fromEntries(String(url).split('?')[1].split('&')
      .map(p => p.split('=')).filter(([, v]) => v.startsWith('eq.'))
      .map(([k, v]) => [k, decodeURIComponent(v.slice(3))]));
    const hits = onFile.filter(r => +new Date(r.at) === +new Date(eq.at)
                                 && (!('name' in eq) || r.name === eq.name));
    return { ok: true, status: 200, json: async () => hits };
  };
  console.error = () => {};
  try {
    return { said: await serve('record_actual', input), sent };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
}

const RETAIL = { at: '2026-09-16T12:30:00Z', name: 'US retail sales (August, advance)',
                 actual: '+1.2% m/m; control group +1.4%', note: 'well above consensus' };

test('the actual is patched onto the row and never posted as a new one', async () => {
  const { said, sent } = await actualWrites(RETAIL, [RETAIL]);
  assert.equal(sent.length, 1, 'a second request went out after a write that landed');
  assert.equal(sent[0].method, 'PATCH',
    'record_actual is not a PATCH, so a name a shade off the one it was handed mints a row again');
  assert.match(sent[0].url, /at=eq\.2026-09-16T12:30:00\.000Z/, 'the row is not selected by its time');
  assert.match(said, /Recorded against/);
});

test('only the two columns a look owns are written', async () => {
  /* THE SAME RELEASE CARRIED TWO CONTRADICTORY PRIORS — `+0.5% m/m (Jul)` on the
     row the briefing filed and `-0.5% m/m (Jul, revised)` on the one the look
     minted — because the look could write those columns at all. It cannot now,
     and the schema is only half of that: a model sending them anyway must not
     reach the database with them. */
  const { sent } = await actualWrites(
    { ...RETAIL, consensus: '+0.3% m/m', prior: '-0.5% m/m (Jul, revised)', importance: 'low' },
    [RETAIL]);
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['actual', 'note'],
    'a look can write a column the briefing owns again');
});

test('a speech is recorded by its line alone, and a line never erases a figure', async () => {
  /* A speech prints nothing, so a tool that demanded the figure refused the one
     record a Chair's press conference could leave. Either half may come alone,
     and an absent key is left as it was: a line written after the figure must
     not send `actual` at all. */
  const POWELL = { at: '2026-10-29T18:30:00Z', name: 'Fed Chair Powell Speaks' };
  const speech = await actualWrites({ ...POWELL, note: 'Said a December hike is not the base case.' }, [POWELL]);
  assert.match(speech.said, /Recorded against/, 'a speech with no figure is still refused');
  assert.deepEqual(Object.keys(speech.sent[0].body), ['note'],
    'a line alone sent an actual with it, which erases a figure written earlier');

  const neither = await actualWrites(POWELL, [POWELL]);
  assert.equal(neither.sent.length, 0, 'a call with nothing to record still reached the database');
  assert.match(neither.said, /for a speech one line/, 'she is not told a line alone is enough for a speech');
});

test('the name she was handed matches the row it names, whatever it is spelled with', async () => {
  /* THE NAME GOES OUT AS ITSELF. It was wrapped in double quotes on the belief
     that a comma splits an `eq` value, which is true only inside `in.(…)`, and
     the quotes were then compared as part of the name. On 30 September she
     filed `core PCE` six times, was told six times that nothing by that name was
     on file, and was read `core PCE` back as what was — and said so to him.
     Every punctuation a release name carries, including the ones that DO mean
     something in a URL. */
  for (const name of ['core PCE', 'US retail sales (August, advance)', 'S&P Global PMI',
                      'Fed "dot plot"', '#1 jobs report: 100%']) {
    const row = { ...RETAIL, name };
    const { said, sent } = await actualWrites(row, [row]);
    assert.match(said, /Recorded against/,
      `"${name}" is on file and the filter did not match it — she is told it is not ` +
      `there, reads it back, and the print is recorded nowhere`);
    assert.equal(sent.length, 1, `"${name}" needed a second request`);
  }
});

test('a name that matches nothing answers with the names on file', async () => {
  /* A PATCH FILTERED TO NOTHING IS A 200 WITH AN EMPTY BODY, which reads exactly
     like a write that landed. Answered with what is actually there, the next
     round has what it needs instead of leaving a second row behind. */
  const { said, sent } = await actualWrites({ ...RETAIL, name: 'retail sales' },
    [RETAIL, { ...RETAIL, name: 'jobless claims' }]);
  assert.equal(sent.length, 2, 'nothing was read back, so she is told nothing and files again');
  assert.equal(sent[1].method, undefined, 'the fallback is not a read');
  assert.match(said, /US retail sales \(August, advance\)/);
  assert.match(said, /jobless claims/);
});

test('nothing on file at that time is said plainly and nothing is written', async () => {
  const { said, sent } = await actualWrites(RETAIL, []);
  assert.equal(sent.filter(r => r.method === 'PATCH').length, 1);
  assert.match(said, /Nothing is on file/);
});

test('a release without a readable time, or with nothing to record, writes nothing at all', async () => {
  for (const bad of [{ ...RETAIL, at: 'whenever' }, { ...RETAIL, name: '  ' },
                     { ...RETAIL, actual: '', note: '  ' }]) {
    const { sent } = await actualWrites(bad, [RETAIL]);
    assert.equal(sent.length, 0, `${JSON.stringify(bad)} reached the database`);
  }
});

/* ─── The calendar TradingView files ─────────────────────────────────────────
   Driven off the same fixture doji-tradingview's fold is tested against, folded
   by that fold — so the two halves of the read are held together rather than
   each against a hand-written copy of the other.
   ─────────────────────────────────────────────────────────────────────────── */

const FOLDED = foldCalendar(unwrap(TV_CALENDAR, 'mcp-tv-get-economic-calendar'));
const OCT1_3PM = Date.parse('2026-10-01T15:00:00Z');

test('only releases rated medium and above, inside the bounds, are filed', () => {
  const rows = calendarRows(FOLDED, 0, Infinity);
  // Claims and a Fed speech on the 1st, payrolls on the 2nd. Not the four lows,
  // and not the summit, which is on the calendar without being a release.
  assert.deepEqual(rows.map(r => r.tv_id).sort(), ['396934', '396953', '421425']);
  assert.deepEqual(calendarRows(FOLDED, Date.parse('2026-10-02T00:00:00Z'), Infinity).map(r => r.tv_id),
    ['396953']);
});

test('a figure TradingView has not published is left out of the row, never sent as null', () => {
  const by = Object.fromEntries(calendarRows(FOLDED, 0, Infinity).map(r => [r.tv_id, r]));
  assert.deepEqual(by['396934'], {
    tv_id: '396934', at: '2026-10-01T12:30:00.000Z', name: 'Initial Jobless Claims (Sep/26)',
    importance: 'medium', source: 'tradingview', consensus: '200K', prior: '198K', actual: '197K',
    ticker: 'ECONOMICS:USIJC',
  });
  // Payrolls has not printed: present-and-null would erase an actual the
  // release look recorded by hand fifteen minutes before the next filing.
  assert.ok(!('actual' in by['396953']), 'an unpublished actual is sent, and would erase one recorded by hand');
  assert.equal(by['396953'].consensus, '90K');
  // A speech has no figure of any kind, and names none.
  for (const k of ['consensus', 'prior', 'actual']) assert.ok(!(k in by['421425']), `a speech names ${k}`);
  assert.ok(Object.values(by).every(r => !('note' in r)), 'a filing names note, which is hers');
});

test('the filing goes up in groups that carry the same columns, keyed on the id', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('doji-tradingview')) {
      sent.push({ read: String(url) });
      return new Response(JSON.stringify({ ok: true, events: FOLDED }), { status: 200 });
    }
    sent.push({ url: String(url), rows: JSON.parse(init.body) });
    return new Response('', { status: 201 });
  };
  try {
    assert.equal(await fileCalendar(OCT1_3PM), 3);
  } finally {
    globalThis.fetch = realFetch;
  }
  // The read asks for whole days covering the window: twelve hours back from
  // 15:00 is still the 1st, and twenty-eight forward is the 2nd.
  assert.match(sent[0].read, /calendar=1&from=2026-10-01&to=2026-10-02$/);
  const writes = sent.slice(1);
  assert.equal(writes.length, 3, 'three column sets went up in fewer requests, which PostgREST refuses');
  for (const w of writes) {
    assert.match(w.url, /eugenia_calendar\?on_conflict=tv_id$/);
    assert.equal(new Set(w.rows.map(r => Object.keys(r).sort().join(','))).size, 1);
    assert.ok(w.rows.every(r => Object.values(r).every(v => v !== null)));
  }
});

test('the quarter-hourly filing keeps to twelve hours back and twenty-eight ahead', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('doji-tradingview')
    ? new Response(JSON.stringify({ ok: true, events: FOLDED }), { status: 200 })
    : new Response('', { status: 201 });
  try {
    // A day and a half on, the 1st's claims and speech are past the twelve hours back.
    assert.equal(await fileCalendar(Date.parse('2026-10-02T20:00:00Z')), 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* A WEEK IS MARKED COVERED BY A WHOLE-WEEK FETCH, AND ONLY AFTER ITS ROWS. A
   mark standing in front of rows that never landed is a covered week with no
   releases in it, which R-14 passes every entry in — the failure the coverage
   exists to stop, arriving through the thing that writes it. */
async function weekWrites(week, failRows = false) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('doji-tradingview')) {
      sent.push({ read: String(url) });
      return new Response(JSON.stringify({ ok: true, events: FOLDED }), { status: 200 });
    }
    sent.push({ url: String(url), rows: JSON.parse(init.body) });
    return new Response('', { status: failRows && String(url).includes('eugenia_calendar') ? 500 : 201 });
  };
  try {
    return { filed: await fileWeek(week, Date.parse('2026-10-03T03:00:00Z')).catch(e => e), sent };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a week is fetched whole, filed, and only then marked covered', async () => {
  const { filed, sent } = await weekWrites('2026-09-27');
  assert.equal(filed, 3);
  // Asked to the next Sunday in UTC days, since a New York week ends a UTC day late.
  assert.match(sent[0].read, /from=2026-09-27&to=2026-10-04$/);
  const marks = sent.filter(s => s.url?.includes('calendar_weeks'));
  assert.equal(marks.length, 1);
  assert.match(marks[0].url, /calendar_weeks\?on_conflict=week$/);
  assert.deepEqual(marks[0].rows, [{ week: '2026-09-27', fetched_at: '2026-10-03T03:00:00.000Z' }]);
  assert.equal(sent.at(-1), marks[0], 'the week was marked before its rows were written');
  // The summit's week is the one before, and it is not a release besides.
  assert.ok(sent.filter(s => s.rows && !s.url.includes('calendar_weeks')).flatMap(s => s.rows)
    .every(r => weekOf(new Date(r.at)) === '2026-09-27'));
});

test('a week whose rows did not land is not marked covered', async () => {
  const { filed, sent } = await weekWrites('2026-09-27', true);
  assert.ok(filed instanceof Error);
  assert.ok(!sent.some(s => s.url?.includes('calendar_weeks')),
    'a week was marked covered with its releases refused — R-14 would pass every entry in it');
});

test('the history walks Sundays in New York from the date given, through a clock change', () => {
  // A Thursday starts its own week; the walk stops at now.
  assert.deepEqual(historyWeeks('2026-09-24', Date.parse('2026-10-01T15:00:00Z')),
    ['2026-09-20', '2026-09-27']);
  // US clocks go back on 1 November 2026, and the walk does not slip a day.
  assert.deepEqual(historyWeeks('2026-10-25', Date.parse('2026-11-12T15:00:00Z')),
    ['2026-10-25', '2026-11-01', '2026-11-08']);
  assert.equal(historyWeeks('2024-01-01', Date.parse('2026-10-01T15:00:00Z')).length, 104,
    'one run walked past the two years its wall clock was sized for');
  assert.equal(historyWeeks('last March', Date.now()), null);
  assert.equal(historyWeeks('2026-13-40', Date.now()), null);
});

/* THE WALK IS REPLAYED, NOT ASSUMED. TradingView refuses a burst of calendar
   reads and the first year walked turned twenty-three weeks into refusals in a
   second and a half. A refused week is asked again after the pause; twice
   refused, the walk ends there rather than spending the rest of the run on the
   same answer. */
test('the history asks a refused week again once, and a second refusal ends the walk', async () => {
  const reads = [], runs = [];
  const refusals = new Map([['2026-09-13', 1], ['2026-09-20', 2]]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('doji-tradingview')) {
      const week = u.match(/from=([\d-]+)/)[1];
      reads.push(week);
      if (refusals.get(week)) {
        refusals.set(week, refusals.get(week) - 1);
        return new Response(JSON.stringify({ ok: false, error: 'Rate limit exceeded' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200 });
    }
    if (u.includes('eugenia_runs')) runs.push(...JSON.parse(init.body));
    return new Response('', { status: 201 });
  };
  try {
    await postHistory('2026-09-06', 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(reads, ['2026-09-06', '2026-09-13', '2026-09-13', '2026-09-20', '2026-09-20'],
    'the walk did not retry a refused week once, or carried on past a second refusal');
  assert.deepEqual(runs.map(r => r.ok), [true, false, true, false, false],
    'an attempt went unrecorded — both outcomes are a row');
  assert.match(runs.at(-1).detail, /^2026-09-20: /, 'the last row does not name the week to resume from');
});

test('a calendar TradingView refused is an error, not an empty day', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'TradingView calendar: 429' }), { status: 500 });
  try {
    await assert.rejects(fileCalendar(OCT1_3PM), /429/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the release look waits for a missing figure, but not past half an hour, and never for a speech', () => {
  const at = '2026-10-02T12:30:00.000Z';
  const payrolls = { id: 1, at, name: 'Non Farm Payrolls (Sep)', importance: 'high',
                     consensus: '90K', prior: '162K', actual: null, note: null };
  const t = (min) => Date.parse(at) + min * 60_000;
  assert.equal(awaitingActual([payrolls], t(5)), true);
  assert.equal(awaitingActual([payrolls], t(31)), false, 'it waited past half an hour');
  assert.equal(awaitingActual([{ ...payrolls, actual: '120K' }], t(5)), false);
  assert.equal(awaitingActual([{ ...payrolls, consensus: null, prior: null }], t(5)), false,
    'it waited for a figure a speech will never have');
  // One missing figure in the group holds the group: one look covers the time.
  assert.equal(awaitingActual([{ ...payrolls, actual: '120K' }, payrolls], t(5)), true);
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

/* ─── Whether the semantic half of her memory is still being filled ─────────
   A row whose `embedding` is null does not appear in a nearest-neighbour query
   at all — no error, no log — so a vendor that has stopped answering costs her
   half of `search_memory` while the lexical arm carries on returning results.
   The nightly sweep is the only thing that would know, and until now it said so
   to a console.

   THREE OUTCOMES AND THE LINE HAS TO PART THEM, because they are three
   different repairs. A vendor that refuses throws and arrives as its own
   message, so what is left here is the pair of counts — and `embed()` returns
   null on an unset key ALONE, every other failure throwing, which is what makes
   "nothing filled with a backlog waiting" an exact statement rather than a
   guess.
   ─────────────────────────────────────────────────────────────────────────── */

test('a night that filled rows says so and accuses nobody', () => {
  const line = sweepLine({ filled: 3, left: 0 }, { filled: 50, left: 128 });
  assert.equal(line, 'notes 3 filled, 0 left · turns 50 filled, 128 left');
  assert.doesNotMatch(line, /EMBED_KEY/,
    'a working sweep reported a missing key — the backlog is draining, which is ' +
    'the one thing that proves the vendor answered');
});

test('nothing filled against a backlog names the key', () => {
  // The signature of an unset EMBED_KEY: embed() returns null, the rows are
  // read and left exactly where they were, and this repeats every night.
  const line = sweepLine({ filled: 0, left: 12 }, { filled: 0, left: 340 });
  assert.match(line, /nothing filled against a backlog, so EMBED_KEY is unset/);
  assert.match(line, /notes 0 filled, 12 left/,
    'the counts went missing behind the diagnosis — 352 rows unsearchable and ' +
    '2 are different sizes of problem');
});

test('a fully swept archive is not a missing key', () => {
  /* THE FALSE ALARM, and it is the ordinary night rather than the edge case.
     Once the backlog is drained every sweep answers `0 filled, 0 left` for the
     rest of the deployment. A line that read that as a missing key would fire
     every night forever, which is how a meter stops being read at all. */
  assert.equal(sweepLine({ filled: 0, left: 0 }, { filled: 0, left: 0 }),
    'notes 0 filled, 0 left · turns 0 filled, 0 left');

  // And the half-quiet night: notes all done, turns still draining.
  assert.doesNotMatch(sweepLine({ filled: 0, left: 0 }, { filled: 50, left: 20 }),
    /EMBED_KEY/, 'a table with nothing waiting dragged a working sweep down');
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
  size_oz: 4, net_pnl: null, planned_sl: null, planned_tp: null, best_price: null, ...o,
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

test('R-03 allows one entry after a $20 stop, and a tighter loss is not one', () => {
  const day = '2026-01-06';
  const at = (hm) => `${day}T${hm}:00Z`;
  const t = (id, open, close, o) => trade({ id, open_day: day, entry_price: 4000,
    entry_time: at(open), fill_time: close && at(close), ...o });
  const stop = (o) => t('PIDs', '10:00', '10:30', { pnl: -80, exit_price: 3980, ...o });
  const win = (id, open) => t(id, open, '15:00', { pnl: 120, exit_price: 4030 });
  const r = (rows) => verdictOf(rows, 'R-03');

  // One re-entry after the full stop is the sweep exception, and a pass.
  const kept = r([stop(), win('PIDa', '10:40')]);
  assert.deepEqual([kept.verdict, kept.passed, kept.failed], ['pass', 1, 0]);

  // A second is the breach, and the DAY is what is named — in either row order.
  const broke = r([win('PIDb', '12:00'), win('PIDa', '10:40'), stop()]);
  assert.deepEqual([broke.verdict, broke.failed, broke.ids], ['fail', 1, [day]]);

  // Past the cap is R-02's breach and still a full stop.
  assert.equal(r([stop({ exit_price: 3975 }), win('PIDa', '10:40'), win('PIDb', '12:00')]).verdict, 'fail');

  /* HIS DEFINITION, AND THE HALF A LOOSER ONE WOULD GET WRONG. A $12 stop taken
     in full is a loss and not a full stop, so two entries after it leave the
     population entirely — counted nowhere, rather than failed or unknown. */
  const tight = r([stop({ exit_price: 3988, pnl: -48 }), win('PIDa', '10:40'), win('PIDb', '12:00')]);
  assert.deepEqual([tight.passed, tight.failed, tight.unresolved], [0, 0, 0]);
  assert.equal(r([stop({ exit_price: 3980.01 }), win('PIDa', '10:40'), win('PIDb', '12:00')]).failed, 0,
    'a loss a cent inside $20 was read as a full stop');

  // Unmeasurable where it could matter, and only there.
  assert.equal(r([stop({ fill_time: null }), win('PIDa', '10:40'), win('PIDb', '12:00')]).verdict, 'unknown',
    'a full stop with no instant cannot count the entries after it');
  assert.equal(r([stop({ exit_price: null }), win('PIDa', '10:40'), win('PIDb', '12:00')]).verdict, 'unknown',
    'a loss with no exit price might be a full stop');
  const cannot = r([stop({ fill_time: null }), win('PIDa', '10:40')]);
  assert.deepEqual([cannot.verdict, cannot.unresolved], ['pass', 0],
    'two entries cannot breach this, so there was nothing the data failed to decide');
});

test('R-18 reads a close with no broker alert as a hand close, and spares the Friday one', () => {
  // cTrader alerts on a stop or target filling and on nothing else, and the
  // alert is the only writer of net_pnl — so its absence is the hand close.
  const closeAt = (iso, o) => trade({ id: 'PIDx', pnl: -20, entry_price: 4000, exit_price: 3995,
    open_day: iso.slice(0, 10), entry_time: iso, fill_time: iso, ...o });
  const later = Date.parse('2026-01-12T12:00:00Z');
  const r = (rows, now = later) => verdictOf(rows, 'R-18', now);

  assert.equal(r([closeAt('2026-01-06T18:00:00Z', { net_pnl: -20.14 })]).verdict, 'pass',
    'a close the broker alerted on was read as a hand close');
  const cut = r([closeAt('2026-01-06T18:00:00Z')]);
  assert.deepEqual([cut.verdict, cut.failed, cut.ids], ['fail', 1, ['PIDx']]);

  /* R-15'S CLOSE-OUT IS THE ONE PERMITTED HAND CLOSE, and it is read through
     R-01's window — 16:50 New York is inside it, 14:00 the same Friday is not. */
  assert.equal(r([closeAt('2026-01-09T21:50:00Z')]).verdict, 'pass',
    'the Friday close-out R-15 forces was flagged as a breach of R-18');
  assert.equal(r([closeAt('2026-01-09T19:00:00Z')]).verdict, 'fail',
    'a Friday 2 p.m. hand close was excused as the close-out');

  /* THE SAME CLOSE, REPLAYED. Minutes after it the alert may still be in
     flight, so the verdict waits; past the grace its absence is the answer. */
  const fresh = closeAt('2026-01-06T18:00:00Z');
  const fill = Date.parse('2026-01-06T18:00:00Z');
  assert.equal(r([fresh], fill + 10 * 60_000).verdict, 'unknown');
  assert.equal(r([fresh], fill + (ALERT_GRACE_MIN + 1) * 60_000).verdict, 'fail');

  // No instant is unknown, and a position still open is not in the population.
  assert.equal(r([closeAt('2026-01-06T18:00:00Z', { fill_time: null })]).verdict, 'unknown');
  const open = r([closeAt('2026-01-06T18:00:00Z', { pnl: null, exit_price: null, fill_time: null })]);
  assert.deepEqual([open.passed, open.failed, open.unresolved], [0, 0, 0]);
});

/* ─── R-14, against the calendar TradingView rates ──────────────────────── */

test('an instant files under the Sunday its week began, in New York', () => {
  // Sunday 19:00 New York is Monday UTC, and still the week that began that Sunday.
  assert.equal(weekOf(new Date('2026-09-20T23:00:00Z')), '2026-09-20');
  assert.equal(weekOf(new Date('2026-09-26T14:00:00Z')), '2026-09-20');   // Saturday
  // Saturday 21:00 New York is Sunday 01:00 UTC, and still the old week.
  assert.equal(weekOf(new Date('2026-09-27T01:00:00Z')), '2026-09-20');
  assert.equal(weekOf(new Date('2026-09-27T05:00:00Z')), '2026-09-27');
});

test('R-14 fails an entry in the thirty minutes before a release rated high, and nothing else', () => {
  const cpi = '2026-10-14T12:30:00Z';                      // 08:30 New York
  const cal = { releases: [cpi], weeks: new Set(['2026-10-11']) };
  const at = (iso, id = 'PIDx') => trade({ id, entry_time: iso, open_day: '2026-10-14' });
  const r = (rows) => verdictOf(rows, 'R-14', Date.parse('2026-10-20T00:00:00Z'));
  const rr = (rows, c = cal) => checkRules(rows, Date.parse('2026-10-20T00:00:00Z'), c)
    .find(x => x.rule === 'R-14');

  const inside = rr([at('2026-10-14T12:05:00Z')]);
  assert.deepEqual([inside.verdict, inside.failed, inside.ids], ['fail', 1, ['PIDx']]);
  // Exactly thirty minutes before is inside the floor; thirty-one is not.
  assert.equal(rr([at('2026-10-14T12:00:00Z')]).verdict, 'fail');
  /* PAST THE FLOOR IS HIS JUDGEMENT, not a pass: the stand-aside is
     open-ended and he set only the part no reading of it excuses. */
  assert.equal(rr([at('2026-10-14T11:59:00Z')]).verdict, 'unknown');
  assert.equal(rr([at('2026-10-14T09:00:00Z')]).verdict, 'unknown',
    'an entry hours ahead of CPI on its own day was passed');
  // After the print, and on a day with nothing ahead, is a pass.
  assert.equal(rr([at('2026-10-14T12:31:00Z')]).verdict, 'pass');
  assert.equal(rr([at('2026-10-13T13:00:00Z')]).verdict, 'pass');

  /* A WEEK NOBODY FETCHED LOOKS EXACTLY LIKE A QUIET ONE, which is the whole
     reason calendar_weeks exists: the same CPI entry, with the week unfetched, is
     unknown rather than the pass an empty calendar would hand it. */
  assert.equal(rr([at('2026-10-14T12:05:00Z')], { releases: [], weeks: new Set() }).verdict, 'unknown');
  assert.equal(rr([at('2026-10-14T12:05:00Z')], { releases: [], weeks: new Set(['2026-10-11']) }).verdict, 'pass');
  // And with no calendar handed at all, which is every caller but check_rules.
  assert.equal(r([at('2026-10-14T12:05:00Z')]).verdict, 'unknown');
  assert.equal(NEWS_MIN, 30);
});

test("R-14's reads cover the trades' window, TradingView's high-rated releases only, newest first", () => {
  const now = Date.parse('2026-10-20T15:00:00Z');
  const since = tradesQuery(30, now).match(/open_day=gte\.([\d-]+)/)[1];
  const rel = releasesQuery(30, now), wk = weeksQuery(30, now);
  assert.match(rel, new RegExp(`^eugenia_calendar\\?select=at&importance=eq\\.${HIGH}&tv_id=not\\.is\\.null`));
  // What she typed in before 018 carries no id and was never a rating he chose.
  assert.match(wk, /^calendar_weeks\?select=week/);
  // A day earlier than the trades, and a week earlier for the weeks.
  assert.ok(rel.match(/at=gte\.([\d-]+)/)[1] < since);
  assert.ok(wk.match(/week=gte\.([\d-]+)/)[1] <= new Date(Date.parse(since) - 7 * 864e5).toISOString().slice(0, 10));
  assert.match(rel, /order=at\.desc&limit=\d+/);
  assert.match(wk, /order=week\.desc&limit=\d+/);
});

test('R-19 judges the stop in force when a print lands on a position from an earlier session', () => {
  /* Opened at 19:00 New York on the Tuesday — the Asian session — and still
     running at Wednesday's 08:30 CPI, which is the one path §6 writes R-19 for. */
  const cpi = '2026-10-14T12:30:00Z';
  const cal = { releases: [cpi], weeks: new Set(['2026-10-11']) };
  const buy = (o) => trade({ id: 'PIDx', direction: 'BUY', entry_price: 4000, exit_price: 4010, pnl: 40,
    entry_time: '2026-10-13T23:00:00Z', fill_time: '2026-10-14T15:00:00Z', open_day: '2026-10-13', ...o });
  const first = { seen_at: '2026-10-13T23:02:00Z', sl: 3980, tp: 4030 };
  const moved = (sl, at = '2026-10-14T12:00:00Z', tp = 4030) => ({ seen_at: at, sl, tp });
  const r = (history, t = buy(), c = cal) =>
    checkRules([t], Date.parse('2026-10-20T00:00:00Z'), c, new Map([['PIDx', history]]))
      .find(x => x.rule === 'R-19');

  const be = r([first, moved(4000)]);
  assert.deepEqual([be.verdict, be.passed], ['pass', 1]);
  const idle = r([first]);
  assert.deepEqual([idle.verdict, idle.failed, idle.ids], ['fail', 1, ['PIDx']],
    'a stop left where it was through the print passed');
  assert.equal(r([first, moved(3975)]).verdict, 'fail', 'a stop widened into the print passed');
  assert.equal(r([first, moved(4000, '2026-10-14T12:00:00Z', 4025)]).verdict, 'fail',
    'a target shortened for the print passed — it never moves');
  /* THE ONE CASE NO ROW CAN PART: tightened short of break-even is the rule if
     the trade was losing and a breach if it was winning. */
  assert.equal(r([first, moved(3990)]).verdict, 'unknown');

  // A move the poller wrote a couple of minutes after the print is not late;
  // one well after it is.
  assert.equal(r([first, moved(4000, '2026-10-14T12:33:00Z')]).verdict, 'pass');
  assert.equal(r([first, moved(4000, `2026-10-14T12:${30 + STOP_GRACE_MIN + 1}:00Z`)]).verdict, 'fail');

  // A short is the mirror.
  const sell = buy({ direction: 'SELL', exit_price: 3990 });
  const high = { seen_at: '2026-10-13T23:02:00Z', sl: 4020, tp: 3970 };
  assert.equal(r([high, { seen_at: '2026-10-14T12:00:00Z', sl: 4000, tp: 3970 }], sell).verdict, 'pass');
  assert.equal(r([high, { seen_at: '2026-10-14T12:00:00Z', sl: 4025, tp: 3970 }], sell).verdict, 'fail');

  /* NARROW BECAUSE §6 MADE IT NARROW: opened in the session the print lands
     in, it is R-14's business and not in this population at all. */
  const same = r([first], buy({ entry_time: '2026-10-14T12:00:00Z', open_day: '2026-10-14' }));
  assert.deepEqual([same.passed, same.failed, same.unresolved], [0, 0, 0]);

  // No history, a history that starts after the print, or a week never fetched.
  assert.equal(r([]).verdict, 'unknown');
  assert.equal(r([moved(3980, '2026-10-14T13:00:00Z')]).verdict, 'unknown');
  /* A HISTORY THAT BEGINS JUST AFTER THE PRINT, inside the grace, is the one
     that could be misread: its first row is the stop in force, so it looks
     untouched — but nothing says where the stop was before it. */
  assert.equal(r([moved(3980, '2026-10-14T12:32:00Z')]).verdict, 'unknown',
    'a stop history begun after the print was read as a stop left untouched');
  assert.equal(r([first, moved(4000)], buy(), { releases: [cpi], weeks: new Set() }).verdict, 'unknown');
});

test("R-19's read reaches a week before the trades, newest first", () => {
  const now = Date.parse('2026-10-20T15:00:00Z');
  const since = tradesQuery(30, now).match(/open_day=gte\.([\d-]+)/)[1];
  const q = stopsQuery(30, now);
  assert.ok(q.match(/seen_at=gte\.([\d-]+)/)[1] <= new Date(Date.parse(since) - 7 * 864e5).toISOString().slice(0, 10));
  assert.match(q, /order=seen_at\.desc&limit=\d+/);
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

/* ─── One missing email used to fail every trade after it ────────────────────
   R-10 ended an unclosed span at `now`, and `fill_time` is written by the email
   path alone — the poller records a close as `exit_price` and never touches it.
   So a close with no alert behind it ran to now for ever, and every trade taken
   after it overlapped that phantom: one missing email, a cascade of R-10
   failures, each naming a real row and each wrong.

   An end nothing recorded is UNKNOWN, which is this file's whole argument about
   unknown never being pass — and equally about it never being fail.
   ─────────────────────────────────────────────────────────────────────────── */
test('a close the email never stamped is undecidable, not a running position', () => {
  const span = (id, from, to, extra = {}) =>
    trade({ id, entry_time: from, fill_time: to, ...extra });
  const now = Date.parse('2026-01-09T20:00:00Z');

  // Closed on Monday per the broker's own deals; no email, so no fill_time.
  const stale = span('PIDstale', '2026-01-05T10:00:00Z', null, { exit_price: 4402.7 });
  const after = span('PIDafter', '2026-01-07T10:00:00Z', '2026-01-07T12:00:00Z');

  const out = verdictOf([stale, after], 'R-10', now);
  assert.equal(out.failed, 0,
    'a position the poller closed on Monday cannot still be running on Friday');
  assert.equal(out.unresolved, 1, 'its end is unrecorded, which is undecidable');
  assert.ok(out.ids.includes('PIDstale'),
    'the row nothing could decide is named, or the gap is invisible');
  assert.equal(out.verdict, 'unknown', 'unknown is not a pass and is not a fail');

  // A genuinely open position still runs to now, which is the case this rule
  // exists for and the half a fix like this could quietly destroy.
  const live = span('PIDlive', '2026-01-09T10:00:00Z', null);
  const inside = span('PIDinside', '2026-01-09T11:00:00Z', '2026-01-09T12:00:00Z');
  assert.equal(verdictOf([live, inside], 'R-10', now).verdict, 'fail');
});

test('R-15 counts a close it cannot time, rather than dropping it', () => {
  /* The same missing column, in the rule that is entirely about WHEN a span
     ended. It used to `continue` past a close with no fill_time, which takes
     the row out of the population altogether — and a rate over the wrong
     population is §8's opening sentence and this file's whole reason to exist.

     A position still genuinely open is a different case: it has not closed, so
     there is nothing for this rule to time, and it stays skipped. */
  const t = (o) => trade({ id: 'PIDx', entry_time: '2026-01-08T10:00:00Z', ...o });

  const dropped = verdictOf([t({ exit_price: 4402.7 })], 'R-15');
  assert.equal(dropped.unresolved, 1,
    'a close the email never stamped is undecidable here, not absent');
  assert.ok(dropped.ids.includes('PIDx'));

  // Still open — nothing has closed, so R-15 has nothing to measure and the
  // population is genuinely empty rather than narrowed.
  const live = verdictOf([t({})], 'R-15');
  assert.equal(live.unresolved, 0);
  assert.equal(live.passed, 0);
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

test('R-01 does not call a break-even stop-out a failure to take profit', () => {
  /* THE STRATEGY CONTRADICTS ITSELF HERE and the code had followed the wrong
     half. §7's predicate says "no win with abs(exit − entry) < 25"; the Exit
     section names four legitimate ways a trade ends and one of them is "at
     break-even once R-04 has moved the stop there". A stop moved to break-even
     and taken out a few cents favourable clears the commission — so `pnl > 0`,
     the gap is pennies, and R-01 reported a breach of a rule he had just
     followed. Common rather than rare: commission is cents at this size. */
  const scratch = verdictOf([trade({
    id: 'PIDbe', pnl: 0.12, entry_price: 4400, exit_price: 4400.1,
    fill_time: '2026-01-06T15:00:00Z',
  })], 'R-01');
  assert.equal(scratch.failed, 0,
    'a break-even exit is counted as a win that failed to reach its target');
  assert.equal(scratch.passed, 0, 'a scratch is not a passing win either');
  assert.equal(scratch.unresolved, 0, 'a scratch is simply not R-01\'s population');

  // The band is the journal's own, so $3 of entry price is still a scratch and
  // a dollar past it is a real flag.
  assert.equal(verdictOf([trade({
    id: 'PIDedge', pnl: 11, entry_price: 4400, exit_price: 4403,
    fill_time: '2026-01-06T15:00:00Z',
  })], 'R-01').failed, 0, 'the band parted from journal.ts BE');
  assert.equal(verdictOf([trade({
    id: 'PIDreal', pnl: 40, entry_price: 4400, exit_price: 4410,
    fill_time: '2026-01-06T15:00:00Z',
  })], 'R-01').failed, 1, 'a genuine $10 discretionary exit stopped being flagged');

  // And a win that did reach the target is untouched.
  assert.equal(verdictOf([trade({
    id: 'PIDok', pnl: 120, entry_price: 4400, exit_price: 4430,
    fill_time: '2026-01-06T15:00:00Z',
  })], 'R-01').verdict, 'pass');
});

test('R-11 will not pass a day it could only partly add up', () => {
  /* THE R-15 REPAIR, UN-APPLIED TO R-11. `fill_time` is the email path's column
     and a close with no alert behind it has an `exit_price` and no instant —
     so it was filtered out of the running total and the day added up without
     it. A lost LOSS never reaches the floor and the day reports `pass`; a lost
     WIN breaches a day that never did. Both directions, same absence.

     Found by the two halves of this file disagreeing: `dayStanding` sums every
     closed row, so it can tell him the day is over while this reports pass. */
  const leg = (id, pnl, from, to) =>
    trade({ id, pnl, open_day: '2026-01-06', entry_time: from, fill_time: to,
            exit_price: 4400 });

  // −90 against a −80 floor, but the losing row carries no instant. The day
  // cannot be walked in order, so it cannot be cleared either.
  const partial = verdictOf([
    leg('PIDx', -90, '2026-01-06T10:00:00Z', null),
    leg('PIDy', 10,  '2026-01-06T12:00:00Z', '2026-01-06T13:00:00Z'),
  ], 'R-11');
  assert.equal(partial.verdict, 'unknown',
    'a day missing a closed row from its running total came back decided');
  assert.equal(partial.passed, 0, 'the day was counted as clean');

  // Every close unstamped: the day used to vanish from the population entirely.
  const none = verdictOf([leg('PIDx', -90, '2026-01-06T10:00:00Z', null)], 'R-11');
  assert.equal(none.verdict, 'unknown');
  assert.equal(none.unresolved, 1, 'the day is not in the population at all');

  // Nothing closed yet is genuinely not this rule's day, and stays out.
  assert.equal(verdictOf([
    trade({ id: 'PIDo', open_day: '2026-01-06', entry_time: '2026-01-06T10:00:00Z' }),
  ], 'R-11').unresolved, 0);
});

test('a day carrying two sizes has no account, in both readers', () => {
  /* `find(s => s != null)` took whichever size arrived first, and a day with
     two of them is the day R-13 exists to flag — so the denominator of the
     limit was decided by row order exactly where it mattered. 4 oz implies
     2,000 and a −80 floor; 20 oz implies 10,000 and a −400 floor, so the two
     answers are not close to each other. */
  const rows = [
    trade({ id: 'PIDx', pnl: -90, size_oz: 4,  open_day: '2026-01-06',
            entry_time: '2026-01-06T10:00:00Z', fill_time: '2026-01-06T11:00:00Z' }),
    trade({ id: 'PIDy', pnl: -10, size_oz: 20, open_day: '2026-01-06',
            entry_time: '2026-01-06T12:00:00Z', fill_time: '2026-01-06T13:00:00Z' }),
  ];
  assert.equal(verdictOf(rows, 'R-11').verdict, 'unknown',
    'the limit was computed against a size picked by row order');
  assert.equal(dayStanding(rows, '2026-01-06'), null,
    'dayStanding still names an account it cannot derive');
});

test('dayStanding counts a close the running total cannot place', () => {
  /* The deliberate difference between the two: this is a SUM and needs no
     order, so an unstamped close still counts here where r11 must step past
     it. Collapsing them would take the day-close message down with the rule. */
  const out = dayStanding([
    trade({ id: 'PIDx', pnl: -90, open_day: '2026-01-06', exit_price: 4400 }),
  ], '2026-01-06');
  assert.equal(out.pnl, -90, 'a closed row with no fill_time was dropped from the sum');
  assert.equal(out.breached, true, 'the day is past −4% and reads as clear');
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
  /* THE ROWS HAVE TO BE ABLE TO TRIP THE RULES, or this asserts nothing. An
     earlier version passed one bare row — no entry_time, no open_day, no
     fill_time — and every rule that needs one of those skipped it on that
     ground rather than on its id. Removing isBroker from any single rule left
     the test green, because the fixture could not reach the filter it was
     written to check.

     So these are real trades in every respect but their ids, and the second
     half proves it: under broker ids the same rows produce verdicts. */
  const rows = (id) => [
    // A win that closed under $25 — R-01. Overlaps the next one — R-10.
    trade({ id: `${id}a`, pnl: 100, entry_price: 4000, exit_price: 4012,
            open_day: '2026-01-06', entry_time: '2026-01-06T10:00:00Z',
            fill_time: '2026-01-06T15:00:00Z' }),
    // A loss further than $20 from entry — R-02 — opened inside that span.
    trade({ id: `${id}b`, pnl: -400, entry_price: 4000, exit_price: 3950,
            open_day: '2026-01-06', entry_time: '2026-01-06T11:00:00Z',
            fill_time: '2026-01-06T12:00:00Z' }),
  ];

  for (const r of checkRules(rows('abc'))) {
    assert.equal(r.verdict, 'unknown', `${r.rule} read a pre-sync row into its population`);
  }

  // The anti-vacuity half: the identical rows under broker ids are seen.
  const seen = checkRules(rows('PID')).filter(r => r.verdict !== 'unknown');
  assert.ok(seen.length > 0,
    'the fixture trips no rule even under a broker id, so the half above ' +
    'proves nothing about the id filter');

  /* AND THE ONE POPULATION checkRules DOES NOT REACH. dayStanding is what tells
     her a day has passed its R-11 limit, and it takes the same filter for the
     same reason — a client-id row carrying today's date would put money she
     never lost today into the figure that stops him trading. */
  assert.equal(dayStanding(rows('abc'), '2026-01-06'), null,
    'a pre-sync row was counted into the day the loss limit is read over');
  assert.ok(dayStanding(rows('PID'), '2026-01-06'),
    'the same rows under a broker id must produce a standing, or the line ' +
    'above is passing on the date rather than on the id');
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
  // The morning of those two prints, so both are today's and carry no date.
  const out = calendarList([
    { id: 1, at: '2026-01-09T13:30:00Z', name: 'core CPI', importance: 'high',
      consensus: '0.3%', prior: '0.2%', actual: '0.4%', note: 'Hotter than expected.' },
    { id: 2, at: '2026-01-09T20:00:00Z', name: 'FOMC minutes', importance: 'high',
      consensus: null, prior: null, actual: null, note: null },
  ], Date.parse('2026-01-09T13:05:00Z'));
  assert.match(out, /08:30 ET core CPI — LANDED at 0\.4%/);
  assert.match(out, /15:00 ET FOMC minutes — due/);
  assert.equal(calendarList([]), '');
});

test('a calendar line from another day names the day, and today stays bare', () => {
  /* At a day and a morning forward the briefing is handed two 08:30s — today's
     and tomorrow's — and at twelve hours back last night's 20:00 would read as
     tonight's. Driven across all three: yesterday evening, this morning, and
     tomorrow morning, from the 08:00 weekday briefing on a Thursday. */
  const row = (at, name) => ({ id: 0, at, name, importance: 'high',
    consensus: null, prior: null, actual: null, note: null });
  const out = calendarList([
    row('2026-09-24T00:00:00Z', 'FOMC minutes'),       // Wed 20:00 New York
    row('2026-09-24T12:30:00Z', 'jobless claims'),     // Thu 08:30
    row('2026-09-25T12:30:00Z', 'durable goods'),      // Fri 08:30
    row('2026-09-25T14:00:00Z', 'Michigan expectations'), // Fri 10:00
  ], Date.parse('2026-09-24T12:02:00Z'));
  assert.match(out, /· 08:30 ET jobless claims — due/,
    'today\'s release carries a date it does not need');
  assert.match(out, /· 08:30 ET on Friday 25 Sept? durable goods/,
    'tomorrow\'s 08:30 reads exactly like today\'s — she can brief it as due this morning');
  assert.match(out, /· 10:00 ET on Friday 25 Sept? Michigan expectations/);
  assert.match(out, /· 20:00 ET on Wednesday 23 Sept? FOMC minutes — PAST, no figure on file/,
    'last night\'s release reads as tonight\'s, due, when it has already happened');
});

test('a past speech carries the line written about it', () => {
  // The line is the only record a speech leaves; a PAST row that dropped it
  // would hand her the time and the name and nothing of what was said.
  const out = calendarList([{ id: 0, at: '2026-10-01T19:30:00Z', name: 'Fed Williams Speaks',
    importance: 'high', consensus: null, prior: null, actual: null,
    note: 'No urgency to hike again after September.' }], Date.parse('2026-10-01T22:00:00Z'));
  assert.match(out, /Fed Williams Speaks — PAST, no figure on file\. No urgency to hike again/);
});

test('the calendar filed at the weekday briefing reaches the next morning\'s prints', () => {
  /* A trade opened before tomorrow's briefing is checked against what is filed
     today, by `aheadToday`, and nothing else. So the window has to carry the
     08:00 briefing past tomorrow's 10:00 — at twenty-four hours it stopped at
     08:00, and every London-session entry found the day's calendar empty and
     said nothing about the 08:30 print it was sitting in front of. Derived from
     the source, so narrowing either the window or moving the briefing later
     fails here rather than quietly re-opening the gap. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const ahead = Number(src.match(/const CAL_BACK = \d+, CAL_AHEAD = (\d+);/)?.[1]);
  const hour  = Number(src.match(/hour === (\d+)\) return 'weekday'/)?.[1]);
  assert.ok(ahead > 0 && hour > 0, 'the window or the briefing hour can no longer be read');
  const LAST_MORNING_PRINT = 10;   // 10:00 New York: ISM, Michigan, JOLTS
  assert.ok(hour + ahead > 24 + LAST_MORNING_PRINT,
    `the ${hour}:00 briefing files ${ahead}h ahead, which stops before tomorrow's ` +
    `${LAST_MORNING_PRINT}:00 — a trade opened before tomorrow's briefing is ` +
    `checked against a calendar with nothing on it`);
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

test('a trim that grows past a quarter is overruled, at the lengths it actually ran', () => {
  /* 30 September: a 541-character reply came back at 852 with TRIM's own notes
     on top of it, and went out. Every other trim that fortnight stayed within a
     tenth — 362 to 382 was the largest growth. The critic may add a link or a
     verdict, so its ceiling stays at twice. */
  assert.equal(keepDraft('x'.repeat(541), 'y'.repeat(852), TRIM_MOST), true,
    'the revision that carried TRIM\'s notes to him still goes through');
  assert.equal(keepDraft('x'.repeat(362), 'y'.repeat(382), TRIM_MOST), false,
    'an ordinary trim is overruled');
  assert.equal(keepDraft('x'.repeat(1675), 'y'.repeat(1694)), false,
    'the critic adding a verdict is overruled');
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

/* ─── What he committed to, which she holds his trades against ──────────────
   A commitment is read the opposite way to an instruction — she does not obey
   it, she checks him against it — so it is its own kind with its own window.
   Both renderings have to carry it: hers, or nothing is ever held against it;
   his, or he cannot see what she thinks he promised. Driven through the real
   read rather than handed a list, because the kind the block ASKS for is the
   half a rendering test cannot reach.
   ─────────────────────────────────────────────────────────────────────────── */

test('his audit shows what he committed to, between what he told her and what she noticed', () => {
  const out = notesList(
    [{ id: 1, note: 'stop mentioning the ten-year' }],
    [{ id: 2, note: 'he trades the London open' }],
    [{ channel: 'dollar', state: 'used', evidence: null, moved_on: null }],
    [], null,
    [{ id: 3, note: 'this week I stop after two losses' }]);
  assert.match(out, /What you have committed to, newest first:\n\[3\] this week I stop after two losses/);
  assert.ok(out.indexOf('[1]') < out.indexOf('[3]') && out.indexOf('[3]') < out.indexOf('[2]'),
    'a commitment is neither an instruction to her nor her observation, and ' +
    'reads between the two');

  // A memory holding only a commitment is not an empty one.
  const only = notesList([], [], [], [], null, [{ id: 3, note: 'no Friday afternoons' }]);
  assert.doesNotMatch(only, /have not kept any notes/);
});

test('the notes she is handed carry his commitments, asked for by their kind', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const kind = String(url).match(/kind=eq\.(\w+)/)?.[1];
    const rows = { commitment: [{ id: 9, note: 'this week I stop after two losses' }] }[kind] ?? [];
    return new Response(JSON.stringify(rows), {
      status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const out = await notesBlock();
    assert.match(out, /What he has committed to/,
      'notesBlock no longer reads commitments, so nothing is ever held against one');
    assert.match(out, /\[9\] this week I stop after two losses/);
  } finally { globalThis.fetch = realFetch; }
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
  assert.equal(spot.at, new Date(1788404105346).toISOString());
});

test('a quote with no previous close states no move rather than inventing one', () => {
  /* THE LINE THE BRIEFING OPENS ON, AND IT HAD NEVER BEEN EXECUTED BY A TEST —
     only read for a substring. `prev_close` and `change` were typed `number`
     and forced through with `as number`, so the null `foldSpot` goes out of its
     way to produce was invisible to every caller. In the template it became
     text: `${null}` is "null", `null >= 0` is TRUE so the word chosen is "up",
     and `Math.abs(null)` is 0. Both halves of a confident sentence about the
     market, wrong, in the one figure he checks against his own screen. */
  const blind = { bid: 4419.82, ask: 4419.93, high: 4420.14, low: 4381.13,
                  prev_close: null, change: null, at: '2026-09-03T12:15:05.346Z' };
  const said = quoteLine(blind, new Date('2026-09-03T12:15:05Z'));

  assert.doesNotMatch(said, /\bnull\b/,
    'the quote prints the word "null" at him — the type said the field could ' +
    'not be null and the broker disagreed');
  assert.doesNotMatch(said, /\b(up|down) 0\b/,
    'a missing previous close reads as a flat session, which is a claim that ' +
    'nothing moved rather than an absence of information');
  assert.match(said, /bid 4419\.82/, 'the bid is still worth having');
  assert.match(said, /4381\.13 to 4420\.14|4381\.13/, 'the range is still worth having');
  assert.match(said, /no previous close/i, 'she is not told why there is no move');
});

test('a quote with a previous close still states the move', () => {
  const said = quoteLine(
    { bid: 4419.82, ask: 4419.93, high: 4420.14, low: 4381.13,
      prev_close: 4387.96, change: 31.86, at: '2026-09-03T12:15:05.346Z' },
    new Date('2026-09-03T12:15:05Z'));
  assert.match(said, /previous close of 4387\.96/);
  assert.match(said, /up 31\.86 since it/);
});

test('foldSpot leaves both halves of the move null when the close is unreadable', () => {
  const out = foldSpot({ bid: 441982000, ask: 441993000, timestamp: 1788404105346 });
  assert.equal(out.prev_close, null, 'an unreadable sessionClose must not become a number');
  assert.equal(out.change, null, 'a change measured from nothing is not a change');
  assert.equal(out.bid, 4419.82, 'the bid is unaffected');
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

test('each side of the plan is recorded on its own, and a bad id is dropped', () => {
  /* REQUIRING THE PAIR WAS WHAT CORRUPTED IT. A stop-only entry recorded
     NOTHING, so `planned_sl is null` was still true when a target appeared
     later — by which time R-04 had moved the stop to break-even, and the
     break-even stop was filed as the plan it exists to be compared against.

     The reason given for the pair was that half a row "would produce a
     division by a missing number", and nothing divides: no rule in
     `adherence.ts` reads either column and `positionsBlock` names only what it
     has. The ratio is arithmetic HE runs. The guard belonged at the render. */
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 4403.24 }]),
    [{ id: 'PID1', planned_sl: 4403.24, planned_tp: undefined }],
    'a stop set with no target is thrown away, and the next poll to see a ' +
    'target will file whatever R-04 has since moved the stop to');
  assert.deepEqual(openPlans([{ positionId: 1, takeProfit: 4432.1 }]),
    [{ id: 'PID1', planned_sl: undefined, planned_tp: 4432.1 }]);
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 0, takeProfit: 4432.1 }]),
    [{ id: 'PID1', planned_sl: undefined, planned_tp: 4432.1 }],
    'a zero is "not set" rather than a price, and must not survive as one');

  // Neither side, a bad id, and nothing at all are still nothing.
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 0, takeProfit: 0 }]), []);
  assert.deepEqual(openPlans([{ stopLoss: 4403.24, takeProfit: 4432.1 }]), []);
  assert.deepEqual(openPlans([]), []);
  assert.deepEqual(openPlans(undefined), []);
});

test('a stop or target is written when it moves, and never on a poll where it did not', () => {
  const plan = (sl, tp) => ({ id: 'PID1', planned_sl: sl, planned_tp: tp });
  // The first sighting has nothing before it, so it is always written.
  assert.deepEqual(stopChanges([plan(3980, 4030)], []), [{ id: 'PID1', sl: 3980, tp: 4030 }]);
  /* SEVEN HUNDRED POLLS OF A STOP THAT NEVER MOVED ARE ONE ROW — and PostgREST
     can serve the stored numeric as a string, which must still read as equal. */
  assert.deepEqual(stopChanges([plan(3980, 4030)], [{ id: 'PID1', sl: '3980', tp: 4030 }]), []);
  // Only the newest row per position is compared: the stop was moved back.
  assert.deepEqual(stopChanges([plan(3980, 4030)],
    [{ id: 'PID1', sl: 4000, tp: 4030 }, { id: 'PID1', sl: 3980, tp: 4030 }]),
    [{ id: 'PID1', sl: 3980, tp: 4030 }]);
  assert.deepEqual(stopChanges([plan(4000, 4030)], [{ id: 'PID1', sl: 3980, tp: 4030 }]),
    [{ id: 'PID1', sl: 4000, tp: 4030 }]);
  // A pulled target is a change, written as null rather than left as the old one.
  assert.deepEqual(stopChanges([plan(4000, undefined)], [{ id: 'PID1', sl: 4000, tp: 4030 }]),
    [{ id: 'PID1', sl: 4000, tp: null }]);
});

test('every open position with a plan is filed, not just the first', () => {
  const plans = openPlans([
    { positionId: 1, stopLoss: 4400, takeProfit: 4430 },
    { positionId: 2, stopLoss: 4200, takeProfit: 4230 },
  ]);
  assert.deepEqual(plans.map(p => p.id), ['PID1', 'PID2']);
});

/* ─── How far a trade ran, off the broker's minute bars ─────────────────────
   The capture is `?bars=raw`'s answer for 17 Sep 2026 14:00–14:15 UTC,
   unchanged — sixteen bars, the scale and the field names as the broker sent
   them. The two trades below are placed so the extreme of the window sits in
   an EDGE minute, which is the bar the figure must never read.
   ─────────────────────────────────────────────────────────────────────────── */
const BARS = JSON.parse(parseSse(readFileSync(
  new URL('./fixtures/ctrader-get-trendbars.txt', import.meta.url), 'utf8'))
  .result.content[0].text).trendbars;
const at = (hm) => Date.parse(`2026-09-17T${hm}Z`);

test('a real minute bar is in pipettes, and the best price comes out in dollars', () => {
  assert.equal(BARS.length, 16, 'the capture no longer holds the sixteen bars the probe returned');
  // 14:09's high, the top of the window, read as a price and not a pipette count.
  assert.equal(bestPrice(BARS, 'BUY', at('14:00:30'), at('14:14:10')), 4380.14);
  assert.equal(bestPrice(BARS, 'SELL', at('14:00:30'), at('14:14:10')), 4364.64);
});

test('the minute he entered in and the minute he left in are never read', () => {
  /* THE ONE PROPERTY THE COLUMN PROMISES. A bar holds a whole minute of prices
     and he was in for only part of it, so an edge bar can carry a spike from
     before the fill or after the close. The window's lowest low is 14:00's,
     the minute a 14:00:30 entry landed in; its highest high is 14:09's. Each
     trade below is placed so that bar is an edge, and each must come back
     short of it rather than past it. */
  assert.equal(bestPrice(BARS, 'SELL', at('14:00:30'), at('14:14:10')), 4364.64,
    "14:00's low of 4364.48 is from before the entry and was read as his");
  assert.equal(bestPrice(BARS, 'BUY', at('14:09:30'), at('14:15:30')), 4379.95,
    "14:09's high of 4380.14 was read on a trade that entered half-way through it");
  // And a close that lands mid-minute drops that minute from the far end.
  assert.equal(bestPrice(BARS, 'BUY', at('14:02:00'), at('14:09:59')), 4378.03);
});

test('a trade too short to hold a whole minute has no figure, never a flat one', () => {
  assert.equal(barSpan(at('14:00:30'), at('14:01:40')), null);
  assert.deepEqual(barSpan(at('14:00:30'), at('14:02:00')), { from: at('14:01:00'), to: at('14:02:00') });
  assert.equal(bestPrice(BARS, 'BUY', at('14:00:30'), at('14:01:40')), null,
    'a 70-second trade reported a best price, which reads as one that went nowhere');
  assert.equal(bestPrice([], 'BUY', at('14:00:30'), at('14:14:10')), null);
  assert.equal(bestPrice(BARS, null, at('14:00:30'), at('14:14:10')), null);
  // A bar that will not parse refuses the whole answer — it may be the extreme.
  const torn = BARS.map((b, i) => i === 9 ? { ...b, high: 'x' } : b);
  assert.equal(bestPrice(torn, 'BUY', at('14:00:30'), at('14:14:10')), null);
});

test('R-04 fails a loss taken after the trade had already run $20 his way', () => {
  const loss = (o) => trade({ pnl: -80, entry_price: 4000, exit_price: 3985, open_day: '2026-01-06', ...o });
  const r = (rows) => verdictOf(rows, 'R-04');

  const breached = r([loss({ best_price: 4000 + TO_BREAK_EVEN })]);
  assert.deepEqual([breached.verdict, breached.failed, breached.ids], ['fail', 1, ['PID1']]);
  assert.equal(r([loss({ best_price: 4019.99 })]).verdict, 'pass',
    'a trade that never reached +$20 was held to a rule that never engaged');

  // A short is the mirror, and reading it the buy's way inverts every verdict.
  const short = (best) => loss({ direction: 'SELL', exit_price: 4015, best_price: best });
  assert.equal(r([short(3980)]).verdict, 'fail');
  assert.equal(r([short(4020)]).verdict, 'pass');

  /* THE POPULATION IS LOSSES BEYOND THE SCRATCH BAND. A break-even exit is
     R-04 having fired and a win says nothing about the stop, so neither is
     counted — even at $25 in his favour. */
  const outside = r([
    loss({ id: 'PIDbe', pnl: -8, exit_price: 3998, best_price: 4025 }),
    trade({ id: 'PIDw', pnl: 120, entry_price: 4000, exit_price: 4030, best_price: 4031, open_day: '2026-01-06' }),
  ]);
  assert.deepEqual([outside.passed, outside.failed, outside.unresolved], [0, 0, 0]);

  // No figure is unknown, never a pass.
  const unmeasured = r([loss({ best_price: null })]);
  assert.deepEqual([unmeasured.verdict, unmeasured.unresolved], ['unknown', 1]);
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
  prev_close: 4387.96, change: 31.86,
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

  /* AND THE GUARANTEE SURVIVED THE GATES BEING RECOMPOSED, which is the half
     worth asserting rather than the rejection: the floor now bounds the BAR
     instead of standing beside it, so nothing under this share of the price can
     ever be reported — the bar is never below it. Asserted over a sweep rather
     than at one price, because a single quote cannot tell a floor that scales
     from one that happens to be right at 4,400. */
  for (const price of [1800, 2000, 3000, 4400, 6000]) {
    const range = price * 0.01;                        // a full, ordinary session
    const spot = { ...QUOTE, bid: price, high: price, low: price - range };
    const just = price * MOVE_FLOOR * 0.99;
    assert.equal(moveWorth(spot, { ...MARK, bid: price - just }, LOOKED).worth, false,
      `a move of ${just.toFixed(2)} was reported at ${price}, under the floor`);
  }
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

/* ─── The evening roll, which is where the gates were weakest ────────────────
   THE SESSION RESTARTS AT 17:00 NEW YORK, so for hours every evening the range
   is small because the session is YOUNG rather than because the market is
   quiet. The two gates used to stand side by side, so a range near zero made
   the share stop binding and left the floor as the whole test — a bar written
   for a full day's trading, carried alone through the thinnest hours.

   THE PREVIOUS PASS SAW THAT AND CHOSE THE WRONG OF TWO OPTIONS. It reasoned
   that the share could not be fixed from here, since nothing this system reads
   spans the calendar day, so the floor had to be set to an amount that is an
   event in the thin hours. There was a third option it did not consider:
   refuse to judge. A session with no range yet is one the share cannot be
   applied to, and silence is a better answer than a lower standard.

   What it cost meanwhile is on his `/notes` — $13 just after the Sunday roll on
   6 September and $17 just after the next one on the 13th, both filed as
   unexplained and neither ever closed, because there was nothing to explain.
   The one real find in that run, $33 at 11:12 on a Wednesday, cleared both
   gates on its own. A sense that manufactures a loop it cannot close is worse
   than a quiet one: the loop then rides into every briefing after it.
   ─────────────────────────────────────────────────────────────────────────── */

// The session as she described it at 20:57: 4,485 the top, and a range that
// began at the 17:00 roll rather than at the day's low near 4,440.
const EVENING = { ...QUOTE, bid: 4485, high: 4485, low: 4467, prev_close: 4473,
                  change: 12 };

test('the $7 evening drift that reached him does not clear the gates now', () => {
  const out = moveWorth(EVENING, { ...MARK, bid: 4478 }, LOOKED);
  assert.equal(out.worth, false, 'a $7 drift in thin evening trade is not a sharp move');
  assert.match(out.why, /no session range/);

  // THE SHARE ADMITS IT, which is the finding rather than an aside: $7 of an
  // $18 range passes a test written for $14 of a $39 one. What rejects it is
  // that the $18 range is too narrow to be a bar at all.
  assert.ok(7 >= (EVENING.high - EVENING.low) * MOVE_SHARE,
    'the share no longer admits this, so it is not the case this test was built on');
});

test('the two drops that became loops nobody could close are silent now', () => {
  /* THE ACTUAL MESSAGES, from the open threads in his own audit. Both cleared
     the old floor by a couple of dollars with nothing behind it. */
  for (const [size, when] of [[13, 'Sun 6 Sept, 21:00 ET'], [17, 'Sun 13 Sept, after the roll']]) {
    const out = moveWorth(EVENING, { ...MARK, bid: EVENING.bid - size }, LOOKED);
    assert.equal(out.worth, false, `the $${size} drop of ${when} still reaches him`);
    assert.ok(size > EVENING.bid * MOVE_FLOOR,
      `$${size} is under the floor, so this proves nothing about the composition`);
  }
});

test('and the evening is not simply shut: a move that builds its own range speaks', () => {
  /* THE COST OF THE CHANGE, STATED RATHER THAN HIDDEN. The bar is higher after
     the roll than it is at noon — which is the intent, since a young session is
     one she cannot judge against. A real move is not silenced by it, because a
     real move IS the range: a $35 fall takes the low with it. */
  const violent = { ...EVENING, low: 4450 };
  const out = moveWorth(violent, { ...MARK, bid: 4485 + 35 }, LOOKED);
  assert.equal(out.worth, true, 'a $35 evening move is silenced, which is too far');
  assert.equal(out.move, -35);
});

test('the mid-session drop that was a real find still is', () => {
  // $33 at 11:12 on 9 September, on a session that had travelled a full day.
  // It cleared both gates before and has to clear both now, or the change has
  // bought quiet by turning the sense off.
  const midday = { ...QUOTE, bid: 4419.82, high: 4452, low: 4413 };
  const out = moveWorth(midday, { ...MARK, bid: 4419.82 + 33 }, LOOKED);
  assert.equal(out.worth, true);
  assert.equal(out.move, -33);
});

test('a quote carrying no range is not judged at all', () => {
  /* foldSpot FALLS BACK TO THE BID for a quote with no high or low, which makes
     the range zero. That used to leave the floor deciding alone; it now lands
     where every other rangeless session lands — there is nothing to judge
     against, so she says nothing. */
  const flat = { ...QUOTE, high: QUOTE.bid, low: QUOTE.bid };
  const out = moveWorth(flat, MARK, LOOKED);
  assert.equal(out.worth, false);
  assert.match(out.why, /no session range/);
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
  assert.match(said, /none of it is the calendar day/);
  assert.match(said, /NOT the move on the day/);
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
   EVERYTHING SHE WRITES IS ALSO SPOKEN
   ───────────────────────────────────────────────────────────────────────────
   It used to depend on how he wrote: a voice note was answered aloud and a
   typed line was not. That rule was sound and it only ever decided a REPLY —
   everything she STARTS was silent as a side effect of it rather than as a
   decision, so the briefing he actually wanted read to him was the one message
   the rule could never reach. He decided it the other way.

   What is left is a bound, and it is the speech vendor's rather than a
   judgement about listening: everything she writes already fits under it,
   because the briefing's own ceiling is Telegram's.
   ═══════════════════════════════════════════════════════════════════════════ */

test('a speech vendor that cannot answer still leaves him the message', async () => {
  /* THE ONE PROPERTY A SOURCE READ CANNOT SETTLE: there is no path on which he
     gets nothing. Audio-only was the ask, and audio-only turns an unset key, a
     refusing vendor and a format Telegram will not render into a MISSING
     message rather than a degraded one — which is the failure shape the whole
     system is built against.

     Driven rather than read, and for free: with no TTS key `speak` answers
     false without a request, which is exactly the shape of a vendor that
     refused. So what this replays is the real sequence — every part fails, and
     the text must still go. */
  const realFetch = globalThis.fetch, realErr = console.error;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  console.error = () => {};
  try {
    await sayAloud('Gold is holding 4,410 into the close.');
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }

  const texts = sent.filter(r => r.url.includes('sendMessage'));
  assert.equal(texts.length, 1,
    'no text went out when the audio could not be made, so a speech vendor ' +
    'having a bad morning is a briefing he never receives');
  assert.equal(texts[0].body.text, 'Gold is holding 4,410 into the close.',
    'the fallback sent something other than the message itself');
});

test('a speech vendor that never answers still leaves him the message, in time', async () => {
  /* THE SHAPE THAT COST A BRIEFING. The test above is a vendor that REFUSES,
     which speak() has always caught. On 2 October the vendor did not refuse —
     it never answered, and the worker was shut down at its four hundred seconds
     with the voice request still open: no catch ran, so nothing fell back.

     So this one needs a key, which means a fresh instance of the module read
     with one — TTS_KEY is fixed when the file loads, and the instance the rest
     of this suite imported has none. The vendor stub hangs until the request is
     aborted, exactly as a vendor that never answers does, and the budget is
     passed short so the test does not wait out SPEAK_MS. */
  const realFetch = globalThis.fetch, realErr = console.error, realDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: (k) => (k === 'TTS_KEY' ? 'sk-test' : undefined) } };
  const fresh = await import('../supabase/functions/doji-eugenia/index.ts?voice');
  delete globalThis.Deno;
  if (realDeno) globalThis.Deno = realDeno;

  const asked = [], sent = [];
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.includes('/audio/speech')) {
      asked.push(u);
      // Never settles unless aborted — a request sent without the budget waits
      // here for good, which is what the test's own timeout then reports.
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason)));
    }
    sent.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  };
  console.error = () => {};
  /* RACED AGAINST A DEADLINE OF ITS OWN, for two reasons. The regression this
     guards is a wait with no end, which must fail rather than hang the suite.
     And the timer behind AbortSignal.timeout is unref'd: a real open request
     keeps the event loop alive and this stub does not, so the deadline's timer
     is what stands in for the open socket while the budget runs out. */
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      'sayAloud waited past its budget for a vendor that never answers')), 3_000);
  });
  let heard;
  try {
    heard = await Promise.race([
      fresh.sayAloud('Gold is holding 4,410 into the close.', undefined, 50), deadline]);
  } finally {
    clearTimeout(timer);
    globalThis.fetch = realFetch;
    console.error = realErr;
  }

  assert.equal(asked.length, 1, 'the voice was never attempted, so this proves nothing about a hang');
  assert.equal(heard, false, 'a voice that never landed is reported as heard');
  const texts = sent.filter(r => r.url.includes('sendMessage'));
  assert.equal(texts.length, 1,
    'no text went out when the voice never answered — the briefing of 2 October, again');
  assert.equal(texts[0].body.text, 'Gold is holding 4,410 into the close.');
});

test('a speech vendor that refuses once is asked again before the text goes', async () => {
  /* THE SECOND ATTEMPT, which is what turns a vendor's bad minute into a voice
     note rather than text. Driven with a refusal that answers at once, so the
     test needs no clock: the attempt is the same whichever way the first one
     failed, and the stall that cost 2 October is the budget test's to hold. */
  const realFetch = globalThis.fetch, realErr = console.error, realDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: (k) => (k === 'TTS_KEY' ? 'sk-test' : undefined) } };
  const fresh = await import('../supabase/functions/doji-eugenia/index.ts?retry');
  delete globalThis.Deno;
  if (realDeno) globalThis.Deno = realDeno;

  let asked = 0;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/audio/speech')) {
      asked++;
      return asked === 1
        ? { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    }
    sent.push(u);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  console.error = () => {};
  let heard;
  try {
    heard = await fresh.sayAloud('Gold is holding 4,410 into the close.');
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
  assert.equal(asked, 2, 'a part that failed once was not asked for again');
  assert.equal(heard, true, 'the second attempt landed and the voice is reported as not heard');
  assert.equal(sent.filter(u => u.includes('sendVoice')).length, 1);
  assert.equal(sent.filter(u => u.includes('sendMessage')).length, 0,
    'the text went as well as the voice that landed — two bubbles for one message');
});

/* THE BRIEFING'S SECOND WORKER, driven through the real sequence: the marker,
   its text paired by the instant both were written, the send, and the delivered
   row after it. The stub answers each read only when its filter matches what a
   correct read asks for — a stub that answered any read would pass a pairing
   that reads the wrong row. */
test('the speaking worker sends today\'s stored briefing and only then says it was delivered', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  const stamp = new Date(Date.now() - 60_000).toISOString().replace('Z', '+00:00');
  const steps = [];
  globalThis.fetch = async (url, init) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/eugenia_turns?select=created_at')) {
      steps.push('marker');
      assert.match(u, /role=eq\.user&content=eq\.\[weekday briefing\]&order=id\.desc&limit=1/);
      return Response.json([{ created_at: stamp }]);
    }
    if (u.includes('/eugenia_turns?select=content')) {
      steps.push('text');
      return Response.json(u.includes(`created_at=eq.${stamp}`) && u.includes('role=eq.assistant')
        ? [{ content: 'Buenos días. Payrolls lands at 08:30.' }] : []);
    }
    if (u.includes('sendMessage')) {
      steps.push(`sent:${JSON.parse(init.body).text}`);
      return Response.json({ ok: true });
    }
    if (u.includes('/eugenia_runs')) {
      steps.push(`row:${JSON.parse(init.body)[0].caller}`);
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected request ${u}`);
  };
  console.error = () => {};
  try {
    const res = await postSpeak('weekday');
    assert.equal((await res.json()).heard, false, 'with no voice key the text went, and it reads as heard');
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
  assert.deepEqual(steps, ['marker', 'text', 'sent:Buenos días. Payrolls lands at 08:30.',
                           'row:weekday briefing delivered'],
    'the speaking worker did not find, pair, send and then record, in that order');
});

test('the speaking worker refuses a briefing that is not today\'s, and a door that names no briefing', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ created_at: '2026-09-30T12:02:23.4243+00:00' }]);
  try {
    await assert.rejects(postSpeak('weekday'), /no weekday briefing is stored for/,
      "yesterday's briefing would arrive as this morning's");
    await assert.rejects(postSpeak('pulse'), /no such briefing to speak: pulse/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('nothing she writes is left unspoken for being long', () => {
  /* THERE WAS A CAP AND NOW THERE IS NOT. Seven hundred characters, then four
     thousand — and a cap decides that past some length a message is not worth
     hearing, which is a judgement he made the other way. A long message becomes
     SEVERAL voice notes, exactly as it already becomes several text messages.

     Driven through `chunk` at the speech limit, because that is what sayAloud
     does and the property that matters is that every character comes back. */
  const long = Array.from({ length: 40 },
    (_, i) => `Paragraph ${i}. ` + 'word '.repeat(40)).join('\n\n');
  const parts = chunk(long, 4000);
  assert.ok(parts.length > 1, 'the fixture is not long enough to be split');
  assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(),
               long.replace(/\s+/g, ' ').trim(),
               'splitting for speech loses or repeats words');
  for (const part of parts) {
    assert.ok(part.length <= 4000,
      `a part is ${part.length} characters, which the speech vendor refuses — ` +
      `and a refused part is a silence in the middle of a message`);
  }
});

test('a briefing is one voice note, not several', () => {
  // The thing he asked for. 250-400 words by its own rule is ~2,800 characters,
  // well inside one request — splitting it would arrive as two notes with the
  // teaching block cut across them.
  assert.equal(chunk('x'.repeat(2800), 4000).length, 1);
});

test('there is nothing to speak when there is nothing to say', () => {
  // A zero-length voice note renders in Telegram as a broken attachment rather
  // than as nothing. No guard says so any more and none is needed: chunk()
  // returns no parts for an empty string, so the loop that speaks never runs.
  assert.deepEqual(chunk('', 4000), []);
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

/* ─── What counts as open, which was one column and had to be two ────────────
   THE ROW SHE READ IT OFF HAS ONE WRITER AND IT IS THE EMAIL PATH. The poller
   never sets `fill_time` — not on any row, not once — and what it does record
   when a position closes is `exit_price`, folded from the broker's own deals
   every two minutes.

   So a close with no alert email behind it left `fill_time` null for ever, and
   she told him he had a buy open days after it had gone, citing R-19 and R-15
   at him about it. That is the worst failure available to this block: it is the
   one place she speaks with his own rules behind her.

   `positionsList` could never have caught it. It is pure, it was driven from
   both sides for its whole life, and it renders exactly what it is handed —
   the mistake was in deciding what to hand it, which is why the predicate is
   exported now and driven here instead.
   ─────────────────────────────────────────────────────────────────────────── */
test('a position the poller closed is closed, whether or not the email landed', () => {
  const open = trade({ id: 'PID9', entry_time: '2026-09-02T13:14:00Z' });
  assert.equal(isOpen(open), true, 'neither witness has closed this one');

  // The reported bug: closed on the broker's deals, no email, `fill_time` null.
  assert.equal(isOpen({ ...open, exit_price: 4402.7 }), false,
    'the poller folded a closing deal for this position — it is not open, and ' +
    'saying it is cites his rules at him about a trade he does not have');

  // And the other witness alone, which is the case the poller can get wrong:
  // a row folded without its entry deal carries a null exit_price on a trade
  // that has closed, and the email is what catches that one.
  assert.equal(isOpen({ ...open, fill_time: '2026-09-02T18:00:00Z' }), false);
  assert.equal(isOpen({ ...open, exit_price: 4402.7, fill_time: '2026-09-02T18:00:00Z' }), false);
});

test('a pre-sync row is not an open position, however long it sits there', () => {
  /* Rows whose id does not start with PID pre-date the broker sync: no
     entry_time, no exit_price, and — since nothing ever emailed about them —
     no fill_time either. Every one of them read as open, permanently, in the
     block that tells her what he is exposed to right now. dayStanding has
     always filtered them; this never did. */
  assert.equal(isOpen(trade({ id: '2025-11-03-a' })), false);
  assert.equal(isOpen(trade({ id: 'PID1' })), true);
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
test('a row carrying one half of the plan shows that half and never the absence', () => {
  /* THE HALF THAT EXISTS IS WORTH SAYING and the half that does not must not be
     named: a null is equally "he set none" and "the poller never saw this
     position open", and nothing here can tell those apart. Printing "no stop"
     would state the first as fact. */
  const stopOnly = positionsList([trade({ ...OPEN, planned_tp: null })], null, null, DESK_NOW);
  assert.doesNotMatch(stopOnly, /null/, `renders a null: ${stopOnly}`);
  assert.match(stopOnly, /stop 4380 as first seen/, 'the stop it has is dropped');
  assert.doesNotMatch(stopOnly, /target/, 'a target it does not have is named');

  const targetOnly = positionsList([trade({ ...OPEN, planned_sl: null })], null, null, DESK_NOW);
  assert.doesNotMatch(targetOnly, /null/, `renders a null: ${targetOnly}`);
  assert.match(targetOnly, /target 4412 as first seen/, 'the target it has is dropped');
  assert.doesNotMatch(targetOnly, /stop/, 'a stop it does not have is named');

  const neither = positionsList(
    [trade({ ...OPEN, planned_sl: null, planned_tp: null })], null, null, DESK_NOW);
  assert.doesNotMatch(neither, /stop|target|null/,
    'a row the poller never saw open claims a plan');
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE JOURNAL SUMMARISED — the app's arithmetic, driven from both sides
   ───────────────────────────────────────────────────────────────────────────
   Every definition here was previously a sentence in the prompt that she
   applied by hand over four hundred rows. The three the app is deliberately
   subtle about are the three she got wrong, and each is driven here against the
   case that distinguishes it from the plausible alternative — a test that only
   showed a win rate coming back would pass on every one of the wrong ones.
   ═══════════════════════════════════════════════════════════════════════════ */
const jt = (o) => trade({ id: 'PID1', ...o });

test('a scratch is measured in price, not in dollars', () => {
  /* ±$3 OF THE ENTRY PRICE AT ANY LOT SIZE. Read against P&L the band means
     something different every time size changes — $3 of P&L is $3 of gold at
     0.01 lots and three cents of gold at 1.00. The case that tells them apart
     is a big position that went nowhere: $2 of price, $200 of P&L. */
  assert.equal(resultOf(jt({ entry_price: 4400, exit_price: 4402, pnl: 200 })), 'be',
    'two dollars of price is a scratch however much money was on it');
  assert.equal(resultOf(jt({ entry_price: 4400, exit_price: 4410, pnl: 2 })), 'win',
    'ten dollars of price is a win however little money was on it');

  // Rows with no prices pre-date the broker sync and have only P&L to go on.
  assert.equal(resultOf(jt({ pnl: 2 })), 'be');
  assert.equal(resultOf(jt({ pnl: 40 })), 'win');
  assert.equal(resultOf(jt({ pnl: -40 })), 'loss');

  // No P&L is UNDECIDED and is not a loss.
  assert.equal(resultOf(jt({})), null);
  assert.equal(BE, 3);
});

test('break-evens are in the win rate denominator, not dropped from it', () => {
  /* A rate that quietly drops scratches is HIGHER than the truth, and highest
     on exactly the trader who scratches a lot. One win and one scratch is 50%,
     not 100%. */
  const c = counts([
    jt({ id: 'PIDa', entry_price: 4400, exit_price: 4440, pnl: 40 }),
    jt({ id: 'PIDb', entry_price: 4400, exit_price: 4401, pnl: 1 }),
  ]);
  assert.deepEqual([c.win, c.loss, c.be, c.decided], [1, 0, 1, 2]);
  assert.equal(c.wr, 50);

  // An undecided row is in neither the numerator nor the denominator.
  const withOpen = counts([...[
    jt({ id: 'PIDa', entry_price: 4400, exit_price: 4440, pnl: 40 }),
    jt({ id: 'PIDb', entry_price: 4400, exit_price: 4401, pnl: 1 }),
  ], jt({ id: 'PIDc' })]);
  assert.equal(withOpen.decided, 2, 'an open trade is not a loss');

  // Nothing decided is not a win rate of zero.
  assert.equal(counts([jt({})]).wr, null);
  assert.equal(counts([]).wr, null);
});

test('money splits on the sign and averages split on the label', () => {
  /* THE ONE PLACE THE TWO MUST DIFFER, and the case that shows it is a scratch
     with a positive P&L: money() must count its dollars on the gross side, so
     gross − loss still equals net exactly, while averages() must keep it out of
     the average win, which it would otherwise halve. */
  const rows = [
    jt({ id: 'PIDa', entry_price: 4400, exit_price: 4460, pnl: 60 }),
    jt({ id: 'PIDb', entry_price: 4400, exit_price: 4402, pnl: 2 }),   // scratch, positive
    jt({ id: 'PIDc', entry_price: 4400, exit_price: 4380, pnl: -20 }),
  ];
  const m = money(rows);
  assert.equal(m.gross, 62, 'the scratch dollar is on the gross side');
  assert.equal(m.loss, 20);
  assert.equal(round2(m.gross - m.loss), m.net, 'gross minus loss is exactly net');

  const a = averages(rows);
  assert.equal(a.avgWin, 60, 'the scratch is not in the average win');
  assert.equal(a.avgLoss, 20);
  assert.equal(realisedRR(a), 3);

  function round2(v) { return Math.round(v * 100) / 100; }
});

test('the reward-to-risk is unanswerable with no loss to divide by', () => {
  // Not infinity, and not one: a ratio against nothing cannot be stated.
  assert.equal(realisedRR({ avgWin: 60, avgLoss: null }), null);
  assert.equal(realisedRR({ avgWin: null, avgLoss: 20 }), null);
});

test('a session is read against each centre own local clock', () => {
  /* The overlaps are the more specific case, and the dead stretch between the
     New York close and the Sydney open folds into Asian. Instants chosen in
     UTC and asserted through the same four time zones the app uses. */
  assert.equal(sessionAt(new Date('2026-09-03T13:00:00Z')), 'London+NY');  // 09:00 ET, 14:00 London
  assert.equal(sessionAt(new Date('2026-09-03T08:00:00Z')), 'Asia+London'); // 09:00 London, 17:00 Tokyo
  assert.equal(sessionAt(new Date('2026-09-03T11:00:00Z')), 'London');
  assert.equal(sessionAt(new Date('2026-09-03T20:00:00Z')), 'New York');
  assert.equal(sessionAt(new Date('2026-09-03T23:00:00Z')), 'Asian');
});

test('journalled means the setup and all three answers, never the P&L', () => {
  const done = { setup: 'Break & Retest', followed_rules: true, followed_sl: true, followed_tp: false };
  assert.equal(isJournalled(jt(done)), true, 'an open position can be journalled');
  assert.equal(isJournalled(jt({ ...done, followed_tp: null })), false, 'null is unanswered, not no');
  assert.equal(isJournalled(jt({ ...done, setup: null })), false);
});

test('the summary states every figure with the population it was taken over', () => {
  /* A RATE WITHOUT ITS DENOMINATOR is the number §8 warns about, so the
     rendering carries the counts beside every share. Driven end to end rather
     than asserted on the object, because what she READS is the decision. */
  const out = statsList(journalStats([
    jt({ id: 'PIDa', entry_time: '2026-09-03T13:00:00Z', setup: 'Break & Retest',
         entry_price: 4400, exit_price: 4460, pnl: 60,
         followed_rules: true, followed_sl: true, followed_tp: true }),
    jt({ id: 'PIDb', entry_time: '2026-09-03T13:30:00Z', setup: 'Break & Retest',
         entry_price: 4400, exit_price: 4380, pnl: -20 }),
    jt({ id: 'PIDc', entry_time: '2026-09-03T23:00:00Z', setup: 'Support & Resistance' }),
  ]), 30);

  assert.match(out, /3 trades, 1 journalled/);
  assert.match(out, /50% win rate — 1 win, 1 loss, 0 break-even, over 2 decided/);
  assert.match(out, /Break-evens are IN that denominator/);
  assert.match(out, /net \$40\.00/);
  assert.match(out, /realised reward-to-risk 1:3 — realised, not planned/);
  assert.match(out, /London\+NY: 2 trades/);
  assert.match(out, /Asian: 1 trade,/, 'the undecided trade is still a trade in its session');
  assert.match(out, /Break & Retest: 2 trades/);

  // An empty window says so rather than rendering a page of dashes.
  assert.match(statsList(journalStats([]), 7), /No trades in the last 7 days/);
});

/* ─── The one signal a total cannot carry, and §8 built the journal to keep ───
   `pnl` is `coalesce(net_pnl, computed_pnl)`. §8 withholds `computed_pnl` by
   name and serves `net_pnl` beside `pnl` precisely so a fallback row is VISIBLE
   without the unsettled number being reachable — reading rows she can see it.

   A total cannot, and this tool is the one the prompt now tells her to prefer
   OVER reading the rows. So a summary that sums `pnl` and says one net figure
   takes away the only thing §8 put there.
   ─────────────────────────────────────────────────────────────────────────── */
test('a total says how much of it is settled and how much is the fold', () => {
  const settled  = jt({ id: 'PIDa', entry_price: 4400, exit_price: 4460, pnl: 60, net_pnl: 60 });
  const fellBack = jt({ id: 'PIDb', entry_price: 4400, exit_price: 4430, pnl: 30 });

  const s = journalStats([settled, fellBack]);
  assert.equal(s.settled, 1);
  assert.equal(s.fellBack, 1);

  const out = statsList(s, 30);
  assert.match(out, /1 of those are the broker's settled figure and 1 fell back/);
  assert.match(out, /carries no swap/, 'the reason it matters has to travel with the count');

  // An open trade is in neither: it has no P&L to be settled or folded.
  assert.equal(journalStats([settled, jt({ id: 'PIDc' })]).fellBack, 0);
});

/* ─── The second fallback under the same summary ─────────────────────────────
   The session breakdown reads `sessionOf`, which takes the ENTRY instant and
   drops to the closing fill when a row has no entry_time — an email-only fill
   the poller never reached. That is the seam the README names, and a hold
   carried across a session boundary is filed under the wrong one by it.

   Reading the rows she can see which are which; a total cannot, which is
   exactly the argument that put `fellBack` above. So the count travels with
   the split, on the same terms: only where there is one.
   ─────────────────────────────────────────────────────────────────────────── */
test('the session split says how much of it came from the close', () => {
  const entered = jt({ id: 'PIDa', entry_time: '2026-07-30T14:00:00Z',
                       fill_time: '2026-07-30T14:30:00Z', pnl: 60, net_pnl: 60 });
  // No entry_time at all: the email path's row, whose session can only come
  // from when it closed.
  const seam = jt({ id: 'PIDb', entry_time: null,
                    fill_time: '2026-07-30T02:00:00Z', pnl: 30, net_pnl: 30 });

  const s = journalStats([entered, seam]);
  assert.equal(s.seam, 1);
  assert.equal(s.bySession.length > 0, true, 'the split has to exist to be qualified');

  const out = statsList(s, 30);
  assert.match(out, /1 of these have no entry_time/);
  assert.match(out, /from the closing fill rather than the entry/,
    'the reason it matters has to travel with the count, as it does for the P&L');

  // An open position has an entry and no fill: it is not a seam row.
  assert.equal(journalStats([entered, jt({ id: 'PIDc', fill_time: null })]).seam, 0);
});

test('a window with no seam row says nothing about the seam', () => {
  const s = journalStats([jt({ id: 'PIDa', entry_time: '2026-07-30T14:00:00Z',
                               fill_time: '2026-07-30T14:30:00Z', pnl: 60, net_pnl: 60 })]);
  assert.equal(s.seam, 0);
  assert.doesNotMatch(statsList(s, 30), /no entry_time/,
    'a line saying nothing fell back is noise on every ordinary window');
});

test('a window where nothing fell back says nothing about it', () => {
  /* Noise on every ordinary window otherwise — swap accrues only across the
     17:00 roll, so the common case is that every row is settled or intraday
     and the line would appear saying zero, every time, forever. */
  const out = statsList(journalStats([
    jt({ id: 'PIDa', entry_price: 4400, exit_price: 4460, pnl: 60, net_pnl: 60 }),
  ]), 30);
  assert.doesNotMatch(out, /fell back/);
  assert.match(out, /net \$60\.00/, 'the total is still there');
});

/* ─── Nothing the tool loop serves may throw, driven rather than read ────────
   This is the rule this file states more often than any other, and until now it
   was held by reading each handler's source. Thirty-two catch blocks implement
   it and not one of them had ever been executed by a test — so a handler that
   gained an uncaught path would read exactly like one that had not, and the
   briefing it killed would be the first anyone heard about it. That is the
   shape `readTrades` already failed in once.

   The database refuses in the four ways it actually refuses: a network that is
   not there, a 500, a 404 — which is what an unapplied migration looks like —
   and a 200 carrying something that is not JSON. Every tool the model can name
   has to come back with a sentence in all four.

   A user message missing the `tool_result` for a `tool_use` block is a 400, so
   an empty answer is as fatal as a thrown one: the assertion is that something
   was said, not merely that nothing exploded.
   ─────────────────────────────────────────────────────────────────────────── */

const TOOL_CALLS = [
  ['get_trades',    { days: 7 }],
  ['check_rules',   { days: 7 }],
  ['get_stats',     { days: 7 }],
  ['remember',      { note: 'a note', kind: 'fact' }],
  ['search_memory', { query: 'anything' }],
  ['get_strategy',  { section: '§4.1' }],
  ['set_channel',   { channel: 'rates', state: 'explained', evidence: 'said so' }],
  ['get_market',    {}],
  ['get_around',    {}],
  ['record_actual', { at: '2026-09-07T12:30:00Z', name: 'CPI', actual: '+0.3% m/m' }],
  ['set_thesis',    { thesis: 'a reading' }],
  ['open_loop',     { kind: 'question', body: 'a question' }],
  ['close_loop',    { id: 1, resolution: 'answered' }],
];

/* AND THE LIST IS HELD AGAINST THE SWITCH, because a list typed by hand is a
   family that can quietly lose a member. Every tool is driven here against
   four refusals; one added to `serve` and not added above would be undriven, and this test would go on passing — which is the same
   fault as a path with no heartbeat and a door with no cron job, arriving in
   the one place that thought it was exhaustive. The names are resolved through
   the `*_TOOL` constants rather than read off the `case` labels, because a
   case names a constant and it is the constant that carries the string the
   model actually sends. */
test('every tool serve() dispatches is one this suite drives', () => {
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('export async function serve(');
  assert.ok(at > -1, 'doji-eugenia no longer exports serve()');
  const body = src.slice(at, src.indexOf('\n}', at));

  const cases = [...body.matchAll(/case (\w+)\.name:/g)].map(m => m[1]);
  assert.ok(cases.length >= 10,
    `only ${cases.length} tool cases read out of serve() — the reader has gone blind`);

  const dispatched = cases.map(constant => {
    const decl = src.indexOf(`const ${constant} = {`);
    assert.ok(decl > -1, `serve() dispatches ${constant}, which is declared nowhere`);
    const name = src.slice(decl).match(/name:\s*"([^"]+)"/);
    assert.ok(name, `${constant} carries no name for the model to call it by`);
    return name[1];
  });

  const driven = TOOL_CALLS.map(([name]) => name);
  assert.deepEqual([...dispatched].sort(), [...driven].sort(),
    'the tools serve() dispatches and the tools this suite drives have parted — ' +
    'a tool missing from TOOL_CALLS is never once run against a database that ' +
    'refuses, which is the one property no reading of its source can settle');
});

const REFUSALS = {
  'a network that is not there': () => { throw new TypeError('fetch failed'); },
  'a 500':        () => new Response('upstream is unwell', { status: 500 }),
  'a 404':        () => new Response('no such table',      { status: 404 }),
  'JSON that is not': () => new Response('<html>a proxy page</html>',
    { status: 200, headers: { 'content-type': 'application/json' } }),
};

// One test rather than four generated ones: the suite's own count is read off
// `test(` declarations, and a test made in a loop is invisible to it — the
// instruction would then state a number the suite does not run, which is the
// exact drift that check exists to catch.
test('every tool answers with a sentence however the database refuses', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  try {
    for (const [how, refuse] of Object.entries(REFUSALS)) {
      globalThis.fetch = async () => refuse();
      for (const [name, input] of TOOL_CALLS) {
        let answer;
        await assert.doesNotReject(async () => { answer = await serve(name, input); },
          `${name} threw when the database was ${how} — the tool loop dies with it ` +
          `and the whole turn is lost, which is the failure readTrades had once`);
        assert.equal(typeof answer, 'string',
          `${name} answered with something that is not a string when the database was ${how}`);
        assert.ok(answer.trim().length > 0,
          `${name} answered with nothing when the database was ${how}. A user message ` +
          `missing the tool_result for a tool_use block is a 400, so an empty answer ` +
          `kills the turn as surely as a throw`);
      }
    }
  } finally { globalThis.fetch = realFetch; console.error = realErr; }
});

test('a tool name the file has no handler for is answered, not thrown', async () => {
  const realErr = console.error;
  console.error = () => {};
  try {
    const answer = await serve('get_something_invented', {});
    assert.match(answer, /no tool called/i,
      'an unknown tool name must come back as a sentence — a mistyped name would ' +
      'otherwise present as a dead turn rather than as a mistake');
  } finally { console.error = realErr; }
});

/* ─── A block that cannot read degrades; it does not take the message with it ─
   The ten blocks are what she is HANDED — his notes, where he stands, his open
   position, the day's calendar. Each is built from a database read, and the
   contract is that a read which fails costs that block and nothing else: the
   briefing still goes, one paragraph shorter.

   It was enforced by ten separate try/catch blocks and read out of the source by
   nobody. A block that gained an uncaught path would look exactly like one that
   had not, and the first anyone would know is a briefing that never arrived —
   which is the failure `readTrades` had, from a call site whose sibling was
   caught and hid it.

   `notesBlock` is the one to watch. `notesBlock()` is load-bearing on all seven
   paths, and an instruction he gave — "stop mentioning the ten-year" — lives
   only in a note. If it throws, every one of those messages dies; if it
   degrades, she carries on having forgotten one thing. The second is bad and
   the first is worse.
   ─────────────────────────────────────────────────────────────────────────── */

const BLOCKS = {
  marketBlock, notesBlock, channelsBlock, tradesBlock, breachesBlock, thesisBlock,
  healthBlock, loopsBlock, calendarBlock, weekBlock, positionsBlock,
};

test('every block degrades to nothing when its read fails, and never throws', async () => {
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  try {
    for (const [how, refuse] of Object.entries(REFUSALS)) {
      globalThis.fetch = async () => refuse();
      for (const [name, block] of Object.entries(BLOCKS)) {
        let out;
        await assert.doesNotReject(async () => { out = await block(); },
          `${name} threw when the database was ${how} — that is not one paragraph ` +
          `missing from the briefing, it is the whole briefing`);
        assert.equal(typeof out, 'string',
          `${name} answered with something that is not a string when the database was ${how}`);
      }
    }
  } finally { globalThis.fetch = realFetch; console.error = realErr; }
});

/* AND THE OTHER HALF, which no assertion about throwing can reach: a block that
   swallowed its failure AND its content would be silent in exactly the same way
   as one that had nothing to say. So the same blocks are driven against a
   database that ANSWERS, and each has to come back with something. Without this,
   a block rewritten to `return ""` at the top would pass every assertion above. */
test('every block says something when its read succeeds', async () => {
  const rows = {
    eugenia_notes:    [{ id: 1, note: 'he asked for shorter mornings' }],
    eugenia_channels: [{ channel: 'rates', state: 'explained', moved_on: '2026-07-01' }],
    eugenia_thesis:   [{ thesis: 'gold heavy above 3450', moved_on: '2026-07-30' }],
    eugenia_loops:    [{ id: 1, kind: 'question', body: 'does he size up after two losses',
                         opened_on: '2026-07-28' }],
    eugenia_calendar: [{ id: 1, at: '2026-07-30T12:30:00Z', name: 'CPI', importance: 'high' }],
    eugenia_trades:   [{ id: 'PID1', open_day: '2026-07-30', direction: 'BUY',
                         entry_time: '2026-07-30T14:00:00Z', fill_time: null, entry_price: 3400,
                         exit_price: null, pnl: null, net_pnl: null, size_oz: 2, setup: null,
                         followed_rules: null, followed_sl: null, followed_tp: null,
                         planned_sl: 3380, planned_tp: 3450 }],
    doji_sync_health: [{ who: 'poller', last_ok: new Date().toISOString(), last_run: new Date().toISOString(), ok: true }],
  };
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const table = String(url).match(/rest\/v1\/(\w+)/)?.[1];
    return new Response(JSON.stringify(rows[table] ?? []), {
      status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const name of ['notesBlock', 'channelsBlock', 'thesisBlock', 'loopsBlock', 'calendarBlock']) {
      const out = await BLOCKS[name]();
      assert.ok(out.trim().length > 0,
        `${name} read its rows and said nothing — a block that returns "" on success ` +
        `is indistinguishable from one whose read failed, and passes every test that ` +
        `only asks whether it threw`);
    }
  } finally { globalThis.fetch = realFetch; console.error = realErr; }
});

/* ─── What broke since the last briefing ─────────────────────────────────────
   Driven through the real block, against a database that answers, because the
   window is the decision and a pure test of `sinceBriefing` alone would be
   handed the marker rather than reading it. Friday is the case it exists for:
   on a Monday "yesterday" was Sunday, so a Friday breach was never raised. */
const closed = (id, open_day, entry_time, fill_time, extra = {}) => trade({
  id, open_day, entry_time, fill_time, entry_price: 3400, exit_price: 3395,
  pnl: -10, net_pnl: -10, ...extra,
});

/* ─── The week the Sunday briefing opens ─────────────────────────────────────
   Driven against a database that answers, from Sunday 17:00 New York: the
   question is whether Friday's payrolls reaches her, and a query asserted on
   alone would not say whether the rendering names its day. */
test('the Sunday briefing is handed the week ahead, high releases only, each with its day', async () => {
  const sunday = Date.parse('2026-09-27T21:00:00Z');
  const q = weekQuery(sunday);
  assert.match(q, /importance=eq\.high/, 'the week reads every importance, which is most of a page');
  assert.match(q, /at=gte\.2026-09-27T21:00:00\.000Z/, 'the week does not start now');
  assert.match(q, /at=lte\.2026-10-04T21:00:00\.000Z/, 'the week does not reach the next Sunday, so Friday is cut off');
  assert.match(q, /order=at\.asc/, 'the week is not in the order it happens');

  const rows = [
    { id: 1, at: '2026-09-30T12:15:00Z', name: 'ADP Nonfarm Employment Change (Sep)', importance: 'high',
      consensus: '50K', prior: '54K', actual: null, note: null },
    { id: 2, at: '2026-10-02T12:30:00Z', name: 'Nonfarm Payrolls (Sep)', importance: 'high',
      consensus: '45K', prior: '22K', actual: null, note: null },
  ];
  const realFetch = globalThis.fetch;
  let asked = '';
  globalThis.fetch = async (url) => {
    asked = String(url);
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const out = await weekBlock(sunday);
    assert.match(asked, /eugenia_calendar\?/, 'the week is not read from her calendar');
    assert.match(out, /The week ahead/, 'the week arrives under the rolling calendar\'s heading');
    assert.match(out, /Nonfarm Payrolls \(Sep\)[^\n]*due, 45K expected/, 'Friday\'s payrolls does not reach the Sunday briefing');
    assert.match(out, / on Friday 2 Oct Nonfarm Payrolls/, 'a release later in the week does not name its day');
  } finally { globalThis.fetch = realFetch; }
});

test('sinceBriefing keeps closed trades from the last briefing on, and the hold that closed after it', () => {
  const sunday = '2026-09-27T21:00:00Z';  // 17:00 New York
  assert.ok(sinceBriefing(closed('PID1', '2026-09-28', '2026-09-28T13:00:00Z', '2026-09-28T14:00:00Z'), sunday),
    'a trade taken and closed after the last briefing is not judged');
  assert.ok(!sinceBriefing(closed('PID2', '2026-09-25', '2026-09-25T13:00:00Z', '2026-09-25T14:00:00Z'), sunday),
    'a trade the previous briefing already covered is judged again');
  assert.ok(sinceBriefing(closed('PID3', '2026-09-25', '2026-09-25T19:00:00Z', '2026-09-28T14:00:00Z'), sunday),
    'a Friday hold that closed on Monday is judged by neither briefing — R-15\'s whole case');
  assert.ok(!sinceBriefing(closed('PID4', '2026-09-28', '2026-09-28T13:00:00Z', null, { exit_price: null }), sunday),
    'an open trade reaches the verdict block, and a verdict on it is a hard prohibition');
  assert.ok(!sinceBriefing(closed('T-5', '2026-09-28', null, null), sunday),
    'a pre-sync row is judged as a closed broker trade');
});

test('breachesList names only what broke, and says so when nothing did', () => {
  const r = (rule, verdict, ids = []) => ({ rule, verdict, passed: 1, failed: verdict === 'fail' ? 1 : 0,
    unresolved: 0, ids, why: 'because' });
  assert.equal(breachesList(null), '', 'no closed trade in the window still produced a sentence');
  assert.match(breachesList([r('R-01', 'pass'), r('R-14', 'unknown')]), /No closed trade since your last briefing broke/,
    'a window with nothing broken says nothing, and she is left to work it out from the rows');
  const out = breachesList([r('R-01', 'pass'), r('R-12', 'fail', ['PID9']), r('R-14', 'unknown')]);
  assert.match(out, /R-12: FAIL/, 'a broken rule is not named');
  assert.match(out, /PID9/, 'the trade that broke it is not named, so he cannot check it');
  assert.doesNotMatch(out, /R-01|R-14/, 'a rule that did not break is in the list of breaches');
});

test('the briefing is handed what Friday broke on Sunday, and what the weekend hold broke on Monday', async () => {
  const friday = [
    closed('PID11', '2026-09-25', '2026-09-25T12:40:00Z', '2026-09-25T12:50:00Z'),
    closed('PID12', '2026-09-25', '2026-09-25T13:40:00Z', '2026-09-25T13:50:00Z'),
    closed('PID13', '2026-09-25', '2026-09-25T15:40:00Z', '2026-09-25T15:50:00Z'),
  ];
  const held = closed('PID14', '2026-09-25', '2026-09-25T19:00:00Z', '2026-09-28T11:00:00Z');
  const realFetch = globalThis.fetch;
  const serve = (marker, trades) => async (url) => {
    const table = String(url).match(/rest\/v1\/(\w+)/)?.[1];
    const body = table === 'eugenia_turns' ? [{ created_at: marker }]
               : table === 'eugenia_trades' ? trades : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    globalThis.fetch = serve('2026-09-25T12:00:00Z', friday);   // Friday's 08:00 briefing
    const sunday = await breachesBlock();
    assert.match(sunday, /R-12: FAIL/, 'three entries on Friday never reach Sunday\'s briefing');
    assert.match(sunday, /R-12: FAIL[^\n]*2026-09-25/, 'the day that broke R-12 is not named, so he cannot check it');

    globalThis.fetch = serve('2026-09-27T21:00:00Z', [...friday, held]);   // Sunday's 17:00 briefing
    const monday = await breachesBlock();
    assert.match(monday, /R-15: FAIL/, 'a hold across the Friday close never reaches a briefing');
    assert.doesNotMatch(monday, /R-12/, 'Monday judges Friday\'s entries a second time');
  } finally { globalThis.fetch = realFetch; }
});
