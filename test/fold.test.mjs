/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — Edge Function tests
   ───────────────────────────────────────────────────────────────────────────
   The pure exports of all five Edge Functions and the _shared primitives they
   are built from. Each guards every Deno touch behind env() and Deno?.serve,
   so importing them under plain Node runs nothing.

   NOT COVERED: anything whose first line is the network — the MCP transport,
   the upserts, the Telegram sends, the Claude call. What is tested is what
   they decide, not what they send; the transport is proved by rows arriving.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// secretMatches comes from _shared, and this import resolving proves every
// function's `../_shared/edge.ts` resolves.
import { secretMatches, nyClock, nyDate, marketOpen, parseSse, CHARTS } from '../supabase/functions/_shared/edge.ts';

import {
  foldPosition, nyDay, ozFromVolume, usdFromCents,
  lookbackFor, foldHours, balanceTarget,
  fromPipettes, foldSpot, PIPETTES, openPlans, barSpan, bestPrice, foldCandles, stopChanges, sliced,
  barWindows, BAR_MAX, RANGE_MAX_MS,
} from '../supabase/functions/doji-mcp-sync/index.ts';

import { SETUPS, COLUMNS, answered, parseCallback, renderMessage, staysOpen } from '../supabase/functions/doji-gladys/index.ts';
import { emailRow, answerFor } from '../supabase/functions/doji-email-sync/index.ts';
import { pkceChallenge, challenge, wellKnown, tokenFields, fresh, accessToken, unwrap, foldCalendar,
  calendarWindow, foldBars, foldHeadlines, FOMC, contractMonths, foldRates, oddsOf, unlisted, zq, foldSessions,
  readMarket, readRates,
} from '../supabase/functions/doji-tradingview/index.ts';
import {
  briefDue, retryDue, briefKind, dueNow, isSilent, briefingMarker, briefedQuery,
  chunk, TG_LIMIT, tradesQuery, openOnUser, nowBlock, withClock, dateTurns,
  notesList, channelsList, searchList, readStrategy, dayQuery, repliedQuery, spokenQuery,
  spokenBriefing, ask,
  consolidateRetryDue, thesisLine, portraitLine, loopsList, calendarList, keepDraft, TRIM_MOST,
  parseFeedback, feedbackKeyboard, stamped, apologyFor, APOLOGY, LOOP_KINDS,
  quoteWindow, quoteLine, ROLL_HOUR,
  foldVectors, EMBED_DIMS,
  VOICE_TROUBLE,
  positionsList, isOpen, healthLine, sweepLine, serve, parseChannel, sayAloud, postSpeak,
  marketBlock, notesBlock, channelsBlock, tradesBlock, thesisBlock, portraitBlock, NOTES, recordBlock, recordList, recordQuery,
  callProblem, expiryOf, scoreCall, callsList, effortMessages, BASE_EFFORT,
  healthBlock, loopsBlock, calendarBlock, positionsBlock, feedbackBlock,
  releasesQuery, weeksQuery, stopsQuery, coveredWeeks, RULE_RELEASES, wanted, calendarRows, fileCalendar, fileWeek, historyWeeks, postHistory,
  aroundList, aroundBlock, headlinesList, headlinesBlock,
  sinceBriefing, breachesList, breachesBlock, postTradeEvent, TRADE_ROWS, weekQuery, weekBlock, positioningList, positioningBlock, ratesList, ratesBlock,
  volumeList, volumeBlock, keptMarket, storeMarket, storeRates, structureList, structureBlock, storeStructure,
} from '../supabase/functions/doji-eugenia/index.ts';
import {
  journalStats, statsList, resultOf, counts, money, averages, realisedRR,
  sessionAt, isJournalled, BE,
} from '../supabase/functions/doji-eugenia/journal.ts';
import {
  checkRules, adherenceList, settle, dayStanding, easter, lowVolumeDays,
  nyInstant, nyWall, crossesFridayClose, nearFridayClose, CLOSEOUT_MIN,
  SWEEP_MIN, DAY_LOSS, STRETCH, TO_BREAK_EVEN, ALERT_GRACE_MIN, HIGH, HOME, weekOf, STOP_GRACE_MIN,
} from '../supabase/functions/doji-eugenia/adherence.ts';
import {
  turns, biasOf, sweepsOf, poolsOf, foldStructure, READINGS, GRID, CANDLES,
} from '../supabase/functions/doji-eugenia/structure.ts';
import { CHANNELS, CHANNEL_STATES } from '../supabase/functions/doji-eugenia/prompt.ts';
import { ALWAYS, SECTIONS } from '../supabase/functions/doji-eugenia/strategy.ts';
import { backup, readAll, TABLES } from '../scripts/backup.mjs';
import { lastRun, stale } from '../scripts/health.mjs';
import { score, table, readingsGrid, NEAR } from '../scripts/calibrate.mjs';

const USER = '00000000-0000-0000-0000-000000000001';

/* Runs `work` with the console quiet, and puts fetch and the console back however
   it ends: a stub left installed answers the next test's requests. `work`
   installs its own stub, and a test that reads the log lines sets console.log
   there. */
async function stubbed(work) {
  const real = [globalThis.fetch, console.log, console.error];
  console.log = console.error = () => {};
  try { return await work(); }
  finally { [globalThis.fetch, console.log, console.error] = real; }
}

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
   `fixtures/ctrader-get-deals.txt` is what cTrader returned for a week of this
   account, captured through ?raw=1 — SSE framing, JSON-RPC envelope,
   double-encoded payload and all. Position 577885869 is in it AND in
   `ctrader-stop-loss-filled.html`, the email Pepperstone sent about the same
   fill: two independent records of one trade, neither built here, so the fold
   is checked against something other than its own arithmetic.
   ═══════════════════════════════════════════════════════════════════════════ */

const RAW_DEALS = readFileSync(
  new URL('./fixtures/ctrader-get-deals.txt', import.meta.url), 'utf8');

const REAL_DEALS = JSON.parse(parseSse(RAW_DEALS).result.content[0].text).deals;

/* The Deal interface is the only statement here of what a deal IS; the capture
   and the builder below are both checked against it. */
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
  /* Three layers: `data:` lines carrying a JSON-RPC envelope whose one content
     block is a STRING that is itself JSON. parseSse handles the outside and
     mcpCall parses the inside twice — a shape nobody would invent. */
  assert.match(RAW_DEALS, /^event: message\ndata: \{/);
  assert.equal(REAL_DEALS.length, 41);
  assert.equal(JSON.parse(parseSse(RAW_DEALS).result.content[0].text).hasMore, false);
});

test('every field the poller declares is on every deal cTrader actually sent', () => {
  // The interface is a SUBSET on purpose (deals also carry orderId). What matters
  // is a field the fold depends on that the broker does not send.
  for (const d of REAL_DEALS) {
    for (const field of declaredDealFields()) {
      assert.ok(field in d, `deal ${d.dealId} has no ${field}`);
    }
  }
});

test('commission really does arrive negative, which is why the column stores a magnitude', () => {
  // The schema's check constraint refuses a negative commission, so foldPosition
  // takes the absolute value — held here against what cTrader actually sends.
  assert.ok(REAL_DEALS.every(d => d.commission < 0),
    'cTrader has started reporting commission positive — foldPosition would now flip a sign');
});

test('a real trade folds to the numbers the broker emailed about the same trade', () => {
  /* THE ONE TEST HELD AGAINST SOMETHING NOBODY HERE WROTE. The position id is the
     email's own, so replacing either capture moves the comparison with it. */
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

  /* THE SIZE, AND THE REASON THE COLUMN IS IN OUNCES. cTrader sends a volume of
     400, the poller divides by 100, and the email prints `Oz 4.00`: two units on
     the wire, one number. */
  assert.equal(folded.size_oz, Number(said(/Volume\s+Oz\s+([\d.]+)/, 'volume')));

  /* gross for a short is (entry − exit) × oz: (4485.77 − 4512.80) × 4 = −108.12,
     the email's Gross P&L; less commission, −108.40, its Net P&L. They agree to
     the cent only because this trade held no swap. */
  assert.equal(folded.computed_pnl,
    Number(said(/Net P&L\s+USD\s+(-?[\d.]+)/, 'net P&L')));
  // Read off the deals, not typed: the magnitude of what both of them charged.
  assert.equal(folded.commission,
    Math.abs(mine.reduce((sum, d) => sum + d.commission, 0)) / 100);

  /* THE FILL TIME, AGAINST A TIMESTAMP: the email's words against the deals'
     milliseconds for one event. It confirms the instant, NOT the day-first rule —
     19 cannot be a month. That is pinned in test/parse.test.mjs. */
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
  /* THE FILING ANCHOR, ON TRADES THAT CROSSED A NEW YORK MIDNIGHT. The trade above
     opened and closed in one session, so reading the wrong deal is invisible
     there. Found rather than named, so replacing the capture cannot leave this
     pointed at a trade it no longer holds. */
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

/* THE BUILDER AGAINST THE SAME INTERFACE. The capture holds the interface to
   cTrader; this holds the invented deals below to the interface, so a field
   added or renamed in the source cannot leave them behind. A field DROPPED is
   not caught. */

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
  // Out of order on purpose: the sort inside foldPosition is what makes
  // ordered[0] the entry.
  const row = foldPosition([
    deal({ side: 'BUY',  price: 3371.38, min: 29, dealId: 2 }),
    deal({ side: 'SELL', price: 3400.00, min: 0 })
  ], USER);
  assert.equal(row.direction, 'SELL');
});

test('a sliced deal set inverts direction and leaves exit_price null', () => {
  // The signature of a row folded without its entry deal, which the fold window
  // exists to prevent and a repair query searches for.
  const closeOnly = foldPosition([
    deal({ side: 'BUY', price: 3371.38, min: 29, dealId: 2 })
  ], USER);
  assert.equal(closeOnly.direction, 'BUY');        // the real position was SELL
  assert.equal(closeOnly.exit_price, null);        // `exit_price is null` on a closed trade
  assert.equal(closeOnly.computed_pnl, null);
  assert.equal(closeOnly.entry_price, 3371.38);    // the exit's price, filed as the entry
});

/* What the poll holds back, judged against the broker's own live list as
   get_positions serves it. Folds are real ones, so a change to what an
   entry-less fold looks like reaches this test too. */
test('a fold the deals call open that the broker no longer lists is held back', () => {
  const closeOnly = foldPosition([deal({ side: 'BUY', price: 3371.38, min: 29, positionId: 7 })], USER);
  const live = foldPosition([deal({ side: 'SELL', price: 3400, positionId: 8 })], USER);
  const closed = foldPosition([
    deal({ side: 'SELL', price: 3400, positionId: 9 }),
    deal({ side: 'BUY', price: 3390, min: 10, dealId: 2, positionId: 9 })], USER);
  const listed = openPlans([{ positionId: 8, stopLoss: 3410 }]);

  assert.deepEqual(sliced([closeOnly, live, closed], listed), ['PID7'],
    'the entry-less fold was written, so its inverted direction overwrites the right one');
  // A partial close is open by its deals and still listed: written.
  const partial = foldPosition([
    deal({ side: 'SELL', price: 3400, vol: 200, positionId: 8 }),
    deal({ side: 'BUY', price: 3390, vol: 100, min: 10, dealId: 2, positionId: 8 })], USER);
  assert.deepEqual(sliced([partial], listed), [], 'a live partial close was held back');
  // A list that could not be read holds nothing back: the poll writes as it did.
  assert.deepEqual(sliced([closeOnly], null), []);
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

  /* THE SIZE IS WHAT WAS OPENED, NOT WHAT HAS CLOSED SO FAR. Equal on every
     fully closed position, so only a half-closed one can show a fold reporting
     1.00 oz for a 2.00 oz position. */
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
// was it worth after this fill". They agree only while nothing has happened in
// between, which is what balanceTarget enforces. The poll runs an hour past
// T0, so a close at minute 55 is five minutes old.
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
  // ?force=1&hours=200 folds positions closed days ago. Each fails the age test,
  // so no historical balance is overwritten — what makes a repair safe to run.
  assert.equal(balanceTarget([close(-72 * 60), close(-24 * 60)], POLL), null);
});

test('a fully closed position ends on a deal opposite its direction', () => {
  // The handler takes the LATEST deal as the close time, which holds only because
  // outstanding open volume keeps isClosed false — asserted here.
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
  // Every extra byte is zero, so `a[i] ?? 0` reads identical to it. The explicit
  // length comparison is the only thing separating these two.
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
   way PostgREST does: a stub answering every PATCH with the row hides a filter
   that matches nothing. The lease's `or=(…)` is evaluated against the row and
   a PATCH it excludes answers an empty array. `onRead` changes the row behind
   a read, simulating another caller's renewal. */
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

/* THE SEQUENCE, BECAUSE THE FAILURE IS IN THE SECOND STEP. A rotating server
   kills each refresh token as it answers, so the NEXT refresh must present the
   one just given — and a server that does not rotate sends none, which must
   not be stored as null. */
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

/* TWO CALLERS, ONE STALE TOKEN, ONE RENEWAL. A rotating server may revoke the
   sign-in on seeing a refresh token twice. */
test('two callers finding the token stale at once renew it once and share it', async () => {
  const server = authServer({ ...STALE }, [{ access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }]);
  const got = await withFetch(server.fetch, () => Promise.all([accessToken(), accessToken()]));
  assert.deepEqual(got, ['A2', 'A2']);
  assert.deepEqual(server.presented, ['R1'], 'the refresh token was presented twice');
  assert.equal(server.row().refreshing_until, null);
});

/* THE ROW IS READ AGAIN ONCE THE LEASE IS HELD: another caller renewed in
   between, so the token first read is spent. */
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
    category: 'lbr', importance: 'medium', timed: true, period: 'Sep/26',
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
  // TradingView gives the PMIs no category, and no category is not a code.
  assert.equal(by['398554'].category, null);
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
/* TradingView behind a door: a fresh sign-in, a session, then `answers` calls
   served and every one after held until its signal aborts — as a server that
   has stopped answering does. */
function slowTradingView(answers) {
  let served = 0;
  return async (url, init = {}) => {
    if (url.includes('/rest/v1/tradingview_auth')) {
      return Response.json([{ id: 'current', access_token: 'A', expires_at: new Date(Date.now() + 3600_000).toISOString() }]);
    }
    const { method } = JSON.parse(init.body);
    if (method === 'initialize') return new Response('{}', { headers: { 'mcp-session-id': 's' } });
    if (method !== 'tools/call') return new Response('', { status: 202 });
    if (init.signal?.aborted) throw init.signal.reason;
    if (served++ < answers) {
      return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { structuredContent: DXY_BARS } })}\n\n`);
    }
    // A call that carries no signal is held for ever.
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
  };
}

/* THE DEADLINE, DRIVEN. On 12 October the market's fourteen calls outran her
   45 seconds and the block was lost whole, the symbols that had answered with
   it. Against a server that answers three and then stops, each door answers
   with what it has and names the rest, with DOOR_MS shortened so the test does
   not wait it out. */
test('a TradingView that stops answering costs the symbols not reached, not the ones read', async () => {
  const realTimeout = AbortSignal.timeout;
  // The stub holds no socket open, and the timer behind the signal is unref'd.
  const open = setTimeout(() => {}, 1_000);
  try {
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 30);
    const market = await stubbed(async () => { globalThis.fetch = slowTradingView(3); return readMarket(); });
    // MARKET's first three: its order is what a slow morning keeps.
    assert.deepEqual(market.market.map(m => m.symbol), ['TVC:DXY', 'TVC:US02Y', 'TVC:US10Y']);
    assert.deepEqual(market.missing.map(m => m.error), Array(11).fill('not reached in 35s'));

    const rates = await stubbed(async () => { globalThis.fetch = slowTradingView(1); return readRates(); });
    assert.equal(rates.ok, true);
    assert.equal(rates.contracts.length, 1);
    assert.ok(rates.missing.length && rates.missing.every(m => m.error === 'not reached in 35s'),
      JSON.stringify(rates.missing));
    // The meeting check is unread rather than waited for.
    assert.equal(rates.calendar, null);
  } finally {
    clearTimeout(open);
    AbortSignal.timeout = realTimeout;
  }
});

/* THREE AT A TIME, AND IN ORDER. A server whose calls finish out of order —
   each later symbol answered sooner — with its concurrency counted: one lane
   is the fourteen-call queue that outran the deadline, and an unbounded burst
   is what TradingView refuses. */
test('the market is read three charts at a time and answered in its own order', async () => {
  let open = 0, most = 0, calls = 0;
  const symbols = [];
  const fetch = async (url, init = {}) => {
    if (url.includes('/rest/v1/tradingview_auth')) {
      return Response.json([{ id: 'current', access_token: 'A', expires_at: new Date(Date.now() + 3600_000).toISOString() }]);
    }
    const body = JSON.parse(init.body);
    if (body.method === 'initialize') return new Response('{}', { headers: { 'mcp-session-id': 's' } });
    if (body.method !== 'tools/call') return new Response('', { status: 202 });
    symbols.push(body.params.arguments.symbol);
    most = Math.max(most, ++open);
    await new Promise(r => setTimeout(r, 30 - 2 * calls++));
    open--;
    return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: DXY_BARS } })}\n\n`);
  };
  const answer = await stubbed(async () => { globalThis.fetch = fetch; return readMarket(); });
  assert.equal(most, 3, `${most} charts were asked for at once`);
  // Asked in the list's order and finished out of it.
  assert.deepEqual(answer.market.map(m => m.symbol), symbols, 'the answer is in the order the charts finished');
  assert.equal(answer.market[0].symbol, 'TVC:DXY');
  assert.equal(answer.market.length, 14);
  assert.deepEqual(answer.missing, []);
});

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
    { symbol: 'TVC:DXY', name: 'Dollar index', unit: '', daily: false, from: 101.95, since: '2026-09-30T18:00:00.000Z',
      last: 102.16, at: '2026-10-01T17:45:00.000Z' },
    { symbol: 'TVC:US10Y', name: 'Ten-year Treasury yield', unit: '%', daily: false, from: 5.18, since: '2026-09-30T18:00:00.000Z',
      last: 5.243, at: '2026-10-01T17:45:00.000Z' },
    { symbol: 'FRED:DFII10', name: 'Ten-year real yield (TIPS)', unit: '%', daily: true, from: 2.83, since: '2026-09-25T00:00:00.000Z',
      last: 2.91, at: '2026-09-29T00:00:00.000Z' },
  ],
  missing: [{ symbol: 'TVC:VIX', name: 'VIX', error: 'TradingView mcp-tv-get-ohlcv: no answer' }],
};

test('every line of the market says what its number is measured from, and computes no change', () => {
  const out = aroundList(AROUND, Date.parse('2026-10-01T18:00:00Z'));
  assert.match(out, /· Dollar index 102\.16, from 101\.95 at 14:00 ET on 30 Sept? \(latest bar 13:45 ET\)/);
  assert.match(out, /· Ten-year Treasury yield 5\.243%, from 5\.18% at 14:00 ET on 30 Sept?/);
  // The real yield is dated, never timed, and says it is behind.
  assert.match(out, /· Ten-year real yield \(TIPS\) 2\.91% on 29 Sept?, from 2\.83% on 25 Sept? — a daily series, a day or more behind/);
  // A symbol TradingView would not serve is named rather than left out.
  assert.match(out, /Not read just now: VIX\./);
  /* NO DIRECTION WORD, because none is computed: a sign worked out here is a
     figure with its window stripped. */
  assert.doesNotMatch(out, /\b(up|down|rose|fell)\b/);
  assert.match(out, /hourly bars rather than live ticks/);
});

/* THE TABLE AND THE DOORS IN ONE STUB: eugenia_market answers what was last
   stored under each door, eugenia_runs collects the meter, and each
   doji-tradingview door, and the poller's charts, answer what the test has
   set for them. */
function marketWorld() {
  const stored = new Map(), rows = [], doors = {};
  const fetch = async (url, init = {}) => {
    if (url.includes('/rest/v1/eugenia_runs')) {
      rows.push(...JSON.parse(init.body));
      return new Response('', { status: 201 });
    }
    if (url.includes('/rest/v1/eugenia_market')) {
      if (init.method === 'POST') {
        const row = JSON.parse(init.body);
        stored.set(row.door, row);
        return new Response('', { status: 201 });
      }
      const door = url.match(/door=eq\.(\w+)/)[1];
      return Response.json(stored.has(door) ? [stored.get(door)] : []);
    }
    const [answer, status] = doors[url.match(/doji-(?:tradingview|mcp-sync)\?(\w+)=1/)[1]];
    return Response.json(answer, { status });
  };
  return { fetch, stored, rows, doors };
}

/* READ AHEAD, READ BACK. On 13 and 14 October a chart took five or six seconds
   and the briefing, reading them itself, kept six lines of fourteen. Now the
   job reads and stores, and the briefing reads the copy, which a failed pass
   leaves standing. */
test('the market is read ahead by the job, and a briefing reads the copy a failed pass leaves', async () => {
  const world = marketWorld();
  await stubbed(async () => {
    globalThis.fetch = world.fetch;
    // Before the job has run there is nothing to read, and she is told so.
    assert.match(await aroundBlock(), /could not be read just now\. Do not quote the dollar or yields from a search/);
    assert.match(await ratesBlock(), /could not be read just now\. Do not quote rate\s+odds from a search/);

    world.doors.market = [AROUND, 200];
    world.doors.rates = [{ ok: true, ...RATES, missing: [] }, 200];
    await Promise.all([storeMarket(), storeRates()]);
    assert.match(await aroundBlock(), /Dollar index 102\.16/);
    assert.match(await ratesBlock(), /read at \d\d:\d\d ET:\n· 28 Oct: 73% no change/);

    // A pass that fails, or serves nothing, leaves the copy as it was.
    world.doors.market = [{ ok: false, error: 'not connected' }, 500];
    world.doors.rates = [{ ok: true, market: [], meetings: [], missing: [] }, 200];
    await Promise.all([storeMarket(), storeRates()]);
    assert.match(await aroundBlock(), /Dollar index 102\.16/);
    assert.match(await ratesBlock(), /28 Oct: 73% no change/);
  });
  assert.deepEqual(world.rows.map(r => r.detail), [
    'market: not read yet', 'rates: not read yet',
    // The partial pass's VIX, written by the job that saw it, not the reader.
    'market: TVC:VIX: TradingView mcp-tv-get-ohlcv: no answer',
    'market: TradingView market: not connected', 'rates: no meeting served',
  ]);
  assert.ok(world.rows.every(r => r.caller === 'market read' && r.ok === false));
});

/* ─── His charts, as a map ─────────────────────────────────────────────────
   Hand-built bars, so every turn below is one a person can find by eye. */
const HOUR = 3600_000;
const candle = (t, high, low, close = (high + low) / 2) => ({ t, open: close, high, low, close });
const series = (start, ms, highs, lows) => highs.map((h, i) => candle(start + i * ms, h, lows[i]));

test('a turn clears TURN bars before it and is not beaten after, and the newest bars are never one', () => {
  assert.equal(READINGS.TURN, 3, 'the fixtures below are drawn for three bars a side');
  const highs = [10, 11, 12, 20, 12, 11, 20, 9, 8, 7, 30, 29, 28];
  const lows  = highs.map(h => h - 2);
  lows[7] = 1;
  const found = turns(series(0, HOUR, highs, lows));
  /* 20 at 3 is a turn; the equal 20 at 6 is not, being beaten by none before it
     but equalled; 1 at 7 is a low; 30 at 10 has only two bars after it. */
  assert.deepEqual(found.map(t => [t.kind, t.price, t.at / HOUR]), [['high', 20, 3], ['low', 1, 7]]);
});

test('the sequence of turns is named only when both sides agree, and two of each are needed', () => {
  const bars = (highs, lows) => series(0, HOUR, highs, lows);
  // Highs rising, lows falling: a widening, which is neither.
  const wide = bars([5, 6, 7, 20, 7, 6, 5, 6, 7, 25, 7, 6, 5, 4],
                    [3, 2, 1.5, 1, 2, 3, 4, 3, 2, 0.5, 2, 3, 4, 5]);
  assert.deepEqual(turns(wide).filter(t => t.kind === 'low').map(t => t.price), [1, 0.5],
    'the fixture no longer draws the two lows it is about');
  assert.equal(biasOf('H_1', wide).trend, 'mixed', 'higher highs beside lower lows are read as a trend');
  const rising = bars([5, 6, 7, 20, 7, 6, 5, 6, 7, 25, 7, 6, 5, 4],
                      [3, 2, 1, 0.5, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5]);
  assert.deepEqual(turns(rising).map(t => [t.kind, t.price]),
    [['high', 20], ['low', 0.5], ['high', 25], ['low', 1]]);
  assert.equal(biasOf('H_1', rising).trend, 'up');
  const falling = bars([5, 6, 7, 25, 7, 6, 5, 6, 7, 20, 7, 6, 5, 4],
                       [3, 2, 1.5, 1, 2, 3, 4, 3, 2, 0.5, 2, 3, 4, 5]);
  assert.equal(biasOf('H_1', falling).trend, 'down');
  const one = biasOf('D_1', bars([1, 2, 3, 9, 3, 2, 1], [0, 0, 0, 0, 0, 0, 0]));
  assert.equal(one.trend, null, 'one turn is no sequence, and none is guessed');
  assert.equal(one.close, 0.5);
});

/* §4.2's sweep: a wick through a standing turn that closed back. Not one when
   price had already closed beyond it, not before the turn was confirmed, and
   not older than the day it is asked about. */
test('a sweep is a wick through a standing turn that closed back', () => {
  const highs = [5, 6, 7, 10, 7, 6, 5, 11, 6, 12, 13, 14];
  const lows  = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const bars = series(0, HOUR, highs, lows).map((b, i) => ({ ...b, close: [4, 4, 4, 4, 4, 4, 4, 9, 5, 11, 12, 13][i] }));
  const swept = sweepsOf('H_1', bars, 0);
  // Bar 7 wicked to 11 and closed at 9, under the turn at 10. Bar 9 closed at
  // 11, through it: the turn is gone, and bar 10's wick is no sweep of it.
  assert.deepEqual(swept, [{ period: 'H_1', at: 7 * HOUR, level: 10, kind: 'high', wick: 11, close: 9 }]);
  assert.deepEqual(sweepsOf('H_1', bars, 8 * HOUR), [], 'a sweep older than the day asked about is reported');

  // Mirrored for a low: a wick under it that closed back above.
  const under = series(0, HOUR, [9, 9, 9, 9, 9, 9, 9, 9], [5, 4, 3, 1, 3, 4, 5, 0.5])
    .map(b => ({ ...b, close: 6 }));
  assert.deepEqual(sweepsOf('M_15', under, 0),
    [{ period: 'M_15', at: 7 * HOUR, level: 1, kind: 'low', wick: 0.5, close: 6 }]);
});

/* His step 2's liquidity pool: two highs that printed level, apart, with price
   gone away between them and nothing trading through since. The second of the
   two is never a turn, so the pool is read off the bars. */
test('a pool is two equal highs, apart, that price left and has not taken since', () => {
  assert.deepEqual([READINGS.EQUAL, READINGS.TURN, READINGS.ON_GRID], [1.5, 3, 3], 'the fixtures are drawn for these');
  const flat = 4000;
  const bars = (highs, lows) => series(0, HOUR, highs, lows ?? highs.map(h => h - 1));
  // 4010 then 4009, five bars apart, with lows of 4000 between: one pool at 4010.
  const top = [4010, 4005, 4004, 4003, 4004, 4009, 4006];
  const lows = [4008, flat, flat, flat, flat, 4007, 4005];
  assert.deepEqual(poolsOf('H_1', bars(top, lows)).filter(p => p.kind === 'high'),
    [{ price: 4010, kind: 'high', periods: ['H_1'], touches: [0, 5 * HOUR] }]);
  // Taken: a bar since has traded above it by more than EQUAL. One within EQUAL
  // of the ceiling is another touch of it, and lifts the pool to its high.
  assert.deepEqual(poolsOf('H_1', bars([...top, 4012], [...lows, 4005])).filter(p => p.kind === 'high'), []);
  assert.deepEqual(poolsOf('H_1', bars([...top, 4011], [...lows, 4005])).filter(p => p.kind === 'high')
    .map(p => [p.price, p.touches.length]), [[4011, 2]]);
  // Too close together: three bars apart is one move, not two failures.
  assert.deepEqual(poolsOf('H_1', bars([4010, 4005, 4004, 4009.5, 4006], [4008, flat, flat, 4007, 4005]))
    .filter(p => p.kind === 'high'), []);
  // Price never left: lows of 4008 are not $3 from a 4010 ceiling.
  assert.deepEqual(poolsOf('H_1', bars(top, lows.map(l => Math.max(l, 4008)))).filter(p => p.kind === 'high'), []);
  // A third touch joins the pool rather than making a second.
  const triple = poolsOf('H_1', bars([...top, 4003, 4002, 4003, 4002, 4009.8], [...lows, flat, flat, flat, flat, 4007]))
    .filter(p => p.kind === 'high');
  assert.deepEqual(triple.map(p => [p.price, p.touches.length]), [[4010, 3]]);
  // Through the whole fold, a pool is drawn only within REACH of price.
  const at = { M_5: [candle(10 * HOUR, 4001, 3999, 4000)] };
  const highs = (charts) => foldStructure({ ...charts, ...at }, 11 * HOUR).pools.filter(p => p.kind === 'high');
  assert.deepEqual(highs({ H_1: bars(top, lows) }).map(p => p.price), [4010]);
  assert.deepEqual(highs({ H_1: bars(top.map(h => h + 100), lows.map(l => l + 100)) }), [],
    `a pool more than $${READINGS.REACH} from price is on the map`);
  // Mirrored: equal lows with price gone above between them.
  const floor = poolsOf('M_30', bars([4002, 4010, 4010, 4010, 4010, 4002, 4003], [3990, 4004, 4005, 4004, 4005, 3990.5, 3995]))
    .filter(p => p.kind === 'low');
  assert.deepEqual(floor.map(p => [p.price, p.kind]), [[3990, 'low']]);
});

/* The map's fixture, at 10:07 New York on Thursday 15 October 2026. The 1H
   holds a high turn at 4049 (the week's top), a low at 3980 (its bottom) and a
   high at 4024.5; the 30m a low at 4023 that is newer and the same level, and
   a high at 4100, past REACH. A forming 1H bar at 4200 is not a printed turn. */
const MAP_NOW = Date.UTC(2026, 9, 15, 14, 7);
const MAP_HOUR = Date.UTC(2026, 9, 15, 14);
const MAP_CHARTS = {
  D_1: [candle(Date.UTC(2026, 9, 11, 21), 4040, 4000), candle(Date.UTC(2026, 9, 12, 21), 4050, 4000),
        candle(Date.UTC(2026, 9, 13, 21), 4060, 4000), candle(Date.UTC(2026, 9, 14, 21), 4040, 4010)],
  H_1: [...series(MAP_HOUR - 14 * HOUR, HOUR,
    [4010, 4012, 4015, 4049, 4016, 4013, 4011, 4014, 4017, 4024.5, 4018, 4015, 4013, 4012],
    [4000, 4002, 4005, 4030, 4006, 4003, 3980, 4004, 4007, 4012, 4008, 4005, 4003, 4002]),
    candle(MAP_HOUR, 4200, 4010)],
  M_30: series(MAP_HOUR - 10 * HOUR / 2, HOUR / 2,
    [4030, 4031, 4032, 4100, 4033, 4032, 4031, 4030, 4029, 4028],
    [4024, 4025, 4026, 4027, 4026, 4023, 4026, 4027, 4028, 4029]),
  M_15: series(MAP_HOUR - HOUR, HOUR / 4, [4030, 4031, 4029, 4028, 4027], [4022, 4021, 4020, 4023, 4024]),
  M_5: [candle(MAP_HOUR - 5 * 60_000, 4027, 4023, 4025), candle(MAP_HOUR, 4028, 4024, 4026),
        candle(MAP_HOUR + 5 * 60_000, 4027, 4025, 4026)],
};

test('the map reads his level charts in his words, off printed bars only', () => {
  const map = foldStructure(MAP_CHARTS, MAP_NOW);
  // The newest bar is the 5m still forming: where price was when the map was.
  assert.equal(map.last.close, 4026);
  assert.deepEqual(map.missing, ['H_4']);
  // The week's range is the closed hourly bars; the forming 4200 is not in it.
  assert.deepEqual([map.range.low.price, map.range.high.price], [3980, 4049]);
  assert.deepEqual(map.levels.map(l => [l.price, l.sides, [...l.periods].sort(), l.quarter, l.edge]), [
    [4049, 'high', ['H_1'], 4050, 'top'],
    // The 30m low is newer, so it names the level; the 1H high beside it makes
    // it one that has flipped.
    [4023, 'both', ['H_1', 'M_30'], 4025, null],
    [3980, 'low', ['H_1'], null, 'bottom'],
  ]);
  assert.ok(!map.levels.some(l => l.price === 4100), `a turn more than $${READINGS.REACH} away is on the map`);
  assert.deepEqual(map.grid, [
    { price: 3975, round: false, turned: false }, { price: 4000, round: true, turned: false },
    { price: 4025, round: false, turned: true }, { price: 4050, round: true, turned: true },
    { price: 4075, round: false, turned: false },
  ]);
  assert.equal(GRID, 25);
  // Three closed sessions of 40, 50 and 60, and the one forming has covered 30.
  assert.equal(map.adr, 50);
  assert.equal(map.today, 30);
  // Over the weekend the newest daily bar has closed, and there is no today.
  const weekend = foldStructure({ D_1: MAP_CHARTS.D_1 }, Date.UTC(2026, 9, 17, 12));
  assert.deepEqual([weekend.adr, weekend.today], [45, null]);
  // The last CLOSED candles of each entry chart, oldest first, never the one
  // forming: four 15m, and the two 5m the fixture has closed.
  assert.equal(CANDLES, 4);
  assert.deepEqual(map.candles.map(c => [c.period, c.bars.map(b => b.t)]), [
    ['M_15', [0, 1, 2, 3].map(i => MAP_HOUR - HOUR + i * HOUR / 4)],
    ['M_5', [MAP_HOUR - 5 * 60_000, MAP_HOUR]],
  ]);
  // The 30m lows at 4024 and 4023, five bars apart with price gone $3 above
  // between them and nothing under since, are one pool at the lower.
  assert.deepEqual(map.pools.map(p => [p.price, p.kind, p.periods, p.touches.length]), [[4023, 'low', ['M_30'], 2]]);
  // A session's range so far includes the bar still forming.
  assert.equal(map.sessions.at(-1).to, MAP_HOUR + HOUR / 4);
  assert.equal(map.sessions.at(-1).low, 4020);
  assert.deepEqual(map.bias.map(b => [b.period, b.trend]), [['D_1', null], ['H_1', null]]);
  assert.deepEqual(map.sweeps, []);
  assert.ok(READINGS.ON_GRID >= 2 && READINGS.EDGE >= 1, 'the fixture is drawn for a level two dollars off its quarter');
});

test('the map is said as hers, with every price timed and nothing about what comes next', () => {
  const out = structureList(foldStructure(MAP_CHARTS, MAP_NOW), MAP_NOW);
  assert.match(out, /This is YOUR map, computed from the bars; his is drawn in TradingView/);
  assert.match(out, /The newest bar read opened at 10:05 ET and last traded 4026\./);
  assert.match(out, /· daily: no highs yet; no lows yet — too few turns for a sequence\. Last close 4030\./);
  assert.match(out, /The week of hourly bars runs from 3980 \(02:00 ET\) to 4049 \(23:00 ET Wednesday 14 Oct\)/);
  assert.match(out, /· 4049 — a high, on the 1H, newest 23:00 ET Wednesday 14 Oct; on the 4050 round number; at the top of the week's range/);
  assert.match(out, /· 4023 — turned both ways, a level that has flipped, on the 30m and 1H, newest 07:30 ET; on the 4025 quarter; inside the range/);
  assert.match(out, /4050 \(round, a turn sits on it\)/);
  assert.match(out, /No wick through a turn closed back in the last day\./);
  assert.match(out, /09:00 ET to 10:15 so far, 4020 to 4031/);
  assert.match(out, /averaged \$50 over the last 14 sessions; this session has covered \$30 so far\./);
  assert.match(out, /The last closed 5m candles, oldest first: 09:55 ET open 4025, high 4027, low 4023, close 4025; 10:00 ET open 4026, high 4028, low 4024, close 4026\./);
  assert.match(out, /The last closed 15m candles, oldest first: 09:00 ET open 4026/);
  assert.match(out, /· 4023 — equal lows, on the 30m, touched 05:00 ET, 07:30 ET/);
  assert.match(structureList({ ...foldStructure(MAP_CHARTS, MAP_NOW), pools: [] }, MAP_NOW),
    /No equal highs or lows still rest within \$60\./);
  assert.match(out, /Not read just now: the 4H\. Say so rather than judging a step off a chart you do not have\./);
  assert.doesNotMatch(out, /\b(will|next|likely|expect|should)\b/i);
  // A map with no bar at all is said as no map.
  assert.match(structureList(foldStructure({}, MAP_NOW), MAP_NOW), /could not be read just now, so you have no map/);
});

/* THE CALIBRATION SCORES A READING BY WHAT IT FOUND OF HIS, NOT BY HOW MUCH IT
   DREW. On the map's fixture the level charts draw 4049 (the week's top),
   4023 (inside) and 3980 (the bottom); three entries are scored against them. */
test('the calibration scores her map by the levels he traded, against chance', () => {
  const charts = { H_1: MAP_CHARTS.H_1, M_30: MAP_CHARTS.M_30 };
  const entry = (id, price) => ({ id, entry_price: price, at: MAP_NOW, charts, missing: [] });
  const entries = [entry('PID1', 4024), entry('PID2', 4047), entry('PID3', 4000)];
  const setups = { PID1: 'Break & Retest', PID2: 'Break & Retest' };
  const today = readingsGrid().find(r => r.TURN === READINGS.TURN && r.ON_GRID === READINGS.ON_GRID &&
                                         r.EDGE === READINGS.EDGE);
  assert.ok(today, "today's readings are not in the grid, so the run cannot say whether they are beaten");
  assert.equal(readingsGrid().length, 36);
  assert.equal(NEAR, 3);
  const got = score(entries, setups, today);
  // 4024 is $1 from 4023 and 4047 $2 from 4049; 4000 is $20 from 3980.
  assert.deepEqual([got.hits, got.median], [2, 2]);
  // Three levels within $60 cover three $6 windows of $120: 15% by chance.
  assert.equal(got.chance, 0.15);
  assert.equal(Math.round(got.lift * 100) / 100, 4.44);
  // A Break & Retest belongs inside the range: 4023 agrees, 4049 at its top does not.
  assert.deepEqual([got.agreed, got.judged], [1, 2]);
  assert.equal(score(entries, { PID2: 'Support & Resistance' }, today).agreed, 1);
  // An entry the map draws nothing for is a miss, and chance is not paid for it.
  const blind = score([{ ...entry('PID4', 4024), charts: {} }], {}, today);
  assert.deepEqual([blind.hits, blind.chance, blind.lift, blind.median], [0, 0, 0, null]);
  const out = table([got]);
  assert.match(out, /^3 entries, within \$3 of a level/);
  assert.match(out, /\* TURN 3  ON_GRID 3  EDGE 5  at a level 67% \(chance 15%, lift 4\.44\)  median \$2  setup agrees 1\/2/);
});

/* EVERY READ STAYS INSIDE WHAT ONE ANSWER CAN CARRY, as the broker's own
   description of the tool states it: 1000 bars and 30 days. Asked for more, it
   answers its newest bars and says nothing, which is how every chart of the
   map and every chunk behind best_price came back as its newest 100. */
test('the broker\'s limits on one bar read are the ones the poller holds itself to', () => {
  const tool = JSON.parse(readFileSync(new URL('./fixtures/ctrader-get-trendbars.json', import.meta.url), 'utf8'));
  assert.equal(tool.name, 'get_trendbars');
  const count = tool.inputSchema.properties.count.description;
  assert.match(count, /default 100, clamped to (\d+)/);
  assert.equal(BAR_MAX, Number(count.match(/clamped to (\d+)/)[1]), 'BAR_MAX is not the clamp the broker states');
  assert.match(count, /counted back from toTimestamp/, 'the capture no longer says which bars a short answer keeps');
  const days = Number(tool.description.match(/must not exceed (\d+) days/)[1]);
  assert.equal(RANGE_MAX_MS, days * 86_400_000, 'RANGE_MAX_MS is not the window the broker states');
  for (const p of CHARTS.map(c => c.period)) assert.ok(tool.inputSchema.properties.period.enum.includes(p), `${p} is not a period it serves`);
});

test('a bar read is split into windows that cover it whole, inside both limits', () => {
  const reads = [
    ...CHARTS.map(c => [c.period, c.ms, c.hours * HOUR]),
    // ?bars=1's thirty hours of minutes, and a trade held a day and a half.
    ['M_1 calls', 60_000, 30 * HOUR], ['M_1 trade', 60_000, 36 * HOUR + 7 * 60_000],
  ];
  const to = Date.UTC(2026, 9, 15, 18, 53);
  for (const [name, ms, span] of reads) {
    const ws = barWindows(to - span, to, ms);
    assert.equal(ws[0].from, to - span, `${name} starts late`);
    assert.equal(ws.at(-1).to, to, `${name} ends early`);
    ws.forEach((w, i) => {
      if (i) assert.equal(w.from, ws[i - 1].to, `${name} leaves a gap between windows`);
      assert.ok(w.to - w.from <= RANGE_MAX_MS, `${name} asks for more than 30 days in one read`);
      // Ends inclusive: a window of n bar lengths holds n + 1 bars.
      assert.ok((w.to - w.from) / ms + 1 < BAR_MAX, `${name} can fill an answer, which reads as cut`);
    });
  }
  // The daily's 120 days are four reads; the four-hour's 30 days exactly one.
  assert.equal(barWindows(to - 2880 * HOUR, to, 86_400_000).length, 4);
  assert.equal(barWindows(to - 720 * HOUR, to, 4 * HOUR).length, 1);
  assert.deepEqual(barWindows(to, to, 60_000), []);
});

test('his charts are read ahead by the job, and the map a failed pass leaves stands', async () => {
  const world = marketWorld();
  await stubbed(async () => {
    globalThis.fetch = world.fetch;
    assert.match(await structureBlock(), /could not be read just now, so you have no map/);

    const charts = Object.fromEntries(Object.entries(MAP_CHARTS));
    world.doors.structure = [{ ok: true, symbol: 41, at: MAP_NOW, charts,
                               missing: [{ period: 'H_4', error: 'MCP get_trendbars: bad period' }] }, 200];
    await storeStructure();
    assert.match(await structureBlock(), /4023 — turned both ways/);

    // A door that fails, or serves no chart, leaves the map as it was.
    world.doors.structure = [{ ok: false, error: 'not configured' }, 503];
    await storeStructure();
    world.doors.structure = [{ ok: true, charts: {}, missing: [] }, 200];
    await storeStructure();
    assert.match(await structureBlock(), /4023 — turned both ways/);
  });
  assert.deepEqual(world.rows.map(r => r.detail), [
    'structure: not read yet',
    'structure: H_4: MCP get_trendbars: bad period',
    'structure: HTTP 503',
    'structure: no chart served',
  ]);
});

/* ONE SLOW CALL LEAVES NO GAP: a symbol this pass missed keeps the last pass's
   line, with that pass's bar times, and one never read is still named. */
test('a symbol the pass did not reach keeps the line the last pass read', () => {
  const line = (symbol, last) => ({ symbol, name: symbol, unit: '', daily: false,
    from: 1, since: '2026-10-14T12:00:00Z', last, at: '2026-10-14T13:00:00Z' });
  const kept = { market: [line('TVC:DXY', 100), line('TVC:VIX', 17)], missing: [] };
  const fresh = { market: [line('TVC:DXY', 101)], missing: [
    { symbol: 'TVC:VIX', name: 'VIX', error: 'not reached in 35s' },
    { symbol: 'FX:EURUSD', name: 'Euro in dollars', error: 'not reached in 35s' }] };
  const out = keptMarket(fresh, kept);
  assert.deepEqual(out.market.map(m => [m.symbol, m.last]), [['TVC:DXY', 101], ['TVC:VIX', 17]],
    'the fresh line lost to the old, or the old one was dropped');
  assert.deepEqual(out.missing.map(m => m.symbol), ['FX:EURUSD']);
  assert.deepEqual(keptMarket(fresh, null).missing.length, 2, 'a first pass invented lines');
});

/* THE ODDS AGE OUT; THE LINES DO NOT NEED TO. Each market line carries its bar
   times, but the odds carry only when they were read, and a door that keeps
   refusing would otherwise leave its last answer standing for good. */
test('odds read more than two hours ago are not handed to her', async () => {
  const world = marketWorld();
  const read_at = '2026-10-15T12:00:00.000Z';
  world.stored.set('rates', { door: 'rates', answer: { ok: true, ...RATES, missing: [] }, read_at });
  await stubbed(async () => {
    globalThis.fetch = world.fetch;
    assert.match(await ratesBlock(Date.parse(read_at) + 2 * 3600_000), /08:00 ET:\n· 28 Oct/);
    assert.match(await ratesBlock(Date.parse(read_at) + 2 * 3600_000 + 1), /could not be read just now/);
  });
  assert.equal(world.rows.length, 1, 'odds too old to hand her left no row');
});

/* ─── What the wires said ────────────────────────────────────────────────────
   Four headlines from the 1 October probe, fields as served, with the Reuters
   gold story on the dollar's feed too — the overlap the fold removes. */
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

test('the headlines come newest first, and say when there are none or a feed failed', () => {
  const headlines = foldHeadlines([{ symbol: 'TVC:GOLD', answer: GOLD_NEWS }, { symbol: 'TVC:DXY', answer: DXY_NEWS }]);
  const out = headlinesList({ headlines, missing: [] }, Date.parse('2026-10-01T17:45:00Z'));
  assert.match(out, /Headlines in the last 6 hours, from TradingView's gold and dollar feeds — titles only/);
  assert.match(out, /· 13:38 ET, Mace News: FED GOV JEFFERSON/);
  assert.match(out, /· 12:52 ET, Reuters: Yields fall after US 10-year hits highest since 2002/);
  assert.ok(out.indexOf('13:38') < out.indexOf('12:52'), 'the headlines are not newest first');

  assert.match(headlinesList({ headlines, missing: [] }, Date.parse('2026-10-02T01:00:00Z')),
    /No headline on gold's or the dollar's TradingView feeds in the last 6 hours\./);
  assert.match(headlinesList({ headlines: [], missing: [{ symbol: 'TVC:DXY' }] }, Date.now()),
    /One of the two feeds could not be read\./);
});

/* Six hours is a span a feed read to a fixed number of headlines may not hold.
   The fixture's dollar feed stops at 12:52 New York while gold's reaches 09:27,
   and a block that did not say so would hand her a quiet dollar where there
   was an unread one. */
test('the conversation reads six hours of headlines, names another day, and says where a feed stops', () => {
  const headlines = foldHeadlines([{ symbol: 'TVC:GOLD', answer: GOLD_NEWS }, { symbol: 'TVC:DXY', answer: DXY_NEWS }]);
  const out = headlinesList({ headlines, missing: [] }, Date.parse('2026-10-01T18:00:00Z'));
  assert.match(out, /Headlines in the last 6 hours/, 'the span is not the one that was read');
  assert.match(out, /Gold holds steady/, 'a headline from earlier in the six hours is dropped');
  assert.match(out, /feeds reach back only to 12:52 ET/,
    'a feed that stops inside the span is presented as a quiet one');

  const next = headlinesList({ headlines, missing: [] }, Date.parse('2026-10-02T05:00:00Z'), 12 * 60);
  assert.match(next, /ET on Thursday 1 Oct/, 'a headline from yesterday reads as today\'s');
  assert.doesNotMatch(headlinesList({ headlines, missing: [] }, Date.parse('2026-10-01T17:45:00Z')),
    /on Thursday/, 'a headline from today carries a date it does not need');
});

test('headlines that will not read send her to search, and never take the reply down', async () => {
  await stubbed(async () => {
    globalThis.fetch = async () => new Response('not json', { status: 502 });
    assert.match(await headlinesBlock(), /could not be read just now; search for what moved it/);
  });
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
   before it runs out, on the real clock. Every decision is the second day of a
   Tuesday–Wednesday meeting, which catches the first day typed. */
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

/* What ?rates=1 answered on 1 October at the 18:00 bar. FedWatch shows a later
   meeting as the chance of each range BY THEN; the fold's odds are that
   meeting's own, given the one before — a different number for the same
   pricing. So a later meeting is said in basis points, which both agree on. */
const RATES = {
  meetings: [
    { date: '2026-10-28', move_bp: 6.6, total_bp: 6.6, odds: [{ bp: 0, chance: 73 }, { bp: 25, chance: 27 }] },
    { date: '2026-12-09', move_bp: 19, total_bp: 25.7, odds: [{ bp: 0, chance: 24 }, { bp: 25, chance: 76 }] },
    { date: '2027-01-27', move_bp: 9.2, total_bp: 35.1, odds: [{ bp: 0, chance: 63 }, { bp: 25, chance: 37 }] },
  ],
  unread: [],
  read_at: '2026-10-01T22:00:00.000Z',
};

test('the first meeting is said as odds and the later ones as what is priced by then', () => {
  const out = ratesList(RATES);
  assert.match(out, /· 28 Oct: 73% no change, 27% a quarter-point hike/);
  assert.match(out, /· 9 Dec: 26 basis points of hikes priced in all by then, 19 of them at this meeting/);
  assert.match(out, /· 27 Jan: 35 basis points of hikes priced in all by then, 9 of them at this meeting/);
  assert.doesNotMatch(out, /76%|37%/, 'a later meeting is said as its own odds, which FedWatch does not show');
  assert.match(out, /at least\s+fifteen minutes behind/, 'the block does not say the bars are delayed');
  // Read ahead, so the block says when; the odds carry no other time.
  assert.match(out, /read at 18:00 ET:/);

  const cut = ratesList({ meetings: [{ ...RATES.meetings[0], odds: [{ bp: -25, chance: 60 }, { bp: -50, chance: 40 }] },
    { ...RATES.meetings[1], total_bp: -30.4 }], unread: ['2027-01-27'], read_at: RATES.read_at });
  assert.match(cut, /60% a quarter-point cut, 40% a 50bp cut/);
  assert.match(cut, /30 basis points of cuts priced in all by then/);
  assert.match(cut, /Not read just now: 27 Jan\./, 'a meeting the fold could not solve is dropped rather than named');
});

test('odds refused or unreadable are a sentence, and never take the briefing down', async () => {
  await stubbed(async () => {
    // Meetings carried alongside, so it is the refusal that decides and not their absence.
    globalThis.fetch = async () => Response.json({ ok: false, error: 'the calendar lists a decision on 2026-10-21',
                                                  meetings: RATES.meetings, unread: [] });
    assert.match(await ratesBlock(), /could not be read just now\. Do not quote rate\s+odds from a search/);
    globalThis.fetch = async () => new Response('not json', { status: 502 });
    assert.match(await ratesBlock(), /could not be read just now/);
  });
});

/* ─── Where the speculators stand ───────────────────────────────────────────
   The two reports the CFTC served for gold through pg_net, as strings because
   that is how they arrive. Net 135,699 − 8,310 = 127,389; the week's change is
   the long side's −6,695 less the short side's −968. The open interest is
   planted, not served: 512,340 against 520,815 is down 8,475. */
const COT = [
  { report_date_as_yyyy_mm_dd: '2026-09-22T00:00:00.000', m_money_positions_long_all: '135699',
    m_money_positions_short_all: '8310', change_in_m_money_long_all: '-6695', change_in_m_money_short_all: '-968',
    open_interest_all: '512340' },
  { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', m_money_positions_long_all: '142394',
    m_money_positions_short_all: '9278', change_in_m_money_long_all: '1210', change_in_m_money_short_all: '-311',
    open_interest_all: '520815' },
];

test('positioning is dated, netted, and set against its own range', () => {
  const out = positioningList(COT);
  assert.match(out, /taken Tuesday 22 Sept?/, 'the count does not say which day it was taken');
  assert.match(out, /Net long 127,389 contracts \(135,699 long, 8,310 short\), down 5,727/);
  assert.match(out, /Over the 2 weeks to then, net ranged from long 127,389 on 22 Sept? to long 133,116 on 15 Sept?/);
  assert.match(out, /Open interest, every contract still open whoever holds it: 512,340, down 8,475 on the week before\./,
    'open interest is no longer set against the week before');
  assert.match(positioningList([COT[0]]), /still open whoever holds it: 512,340\.\n/,
    'with no week before to compare, open interest claims a change it cannot know');
  const short = [{ ...COT[0], m_money_positions_long_all: '1000', m_money_positions_short_all: '4000' }];
  assert.match(positioningList(short), /Net short 3,000/, 'a net short reads as a negative long');
  assert.throws(() => positioningList([{ ...COT[0], m_money_positions_long_all: 'n/a' }]), /no readable report/);
  // The dataset leaves a null field out of the row rather than sending it.
  const { change_in_m_money_short_all, ...partial } = COT[0];
  assert.throws(() => positioningList([partial]), /no readable report/);
  const { open_interest_all, ...unopened } = COT[1];
  assert.throws(() => positioningList([COT[0], unopened]), /no readable report/,
    'a week with no open interest should refuse the report, not print a change against nothing');
  assert.throws(() => positioningList([]), /no readable report/);
});

test('positioning that will not read is a sentence, and never takes the briefing down', async () => {
  await stubbed(async () => {
    globalThis.fetch = async () => new Response('[]', { status: 200 });
    assert.match(await positioningBlock(), /could not be read just now; do not quote it from a search/);
  });
});

/* ─── What COMEX gold futures traded ─────────────────────────────────────────
   The front month's daily bars from the 5 October futures probe, verbatim, read
   at 15:47 UTC: Thursday's session, Friday's, and Monday's still forming. Each
   starts at 18:00 New York the evening before. */
const GC_BARS = { bars: [
  { c: 4202.3, h: 4222.8, l: 4169.4, o: 4190.1, t: 1790805600, v: 128923 },
  { c: 4162.3, h: 4259, l: 4153.8, o: 4204.6, t: 1790892000, v: 165228 },
  { c: 4165.5, h: 4198.9, l: 4150.4, o: 4169.4, t: 1791151200, v: 90330 }], success: true };
const PROBED = Date.parse('2026-10-05T15:47:57Z');

test('futures bars fold to each session\'s start and its contracts', () => {
  assert.deepEqual(foldSessions(GC_BARS), [
    { start: '2026-09-30T22:00:00.000Z', volume: 128923 },
    { start: '2026-10-01T22:00:00.000Z', volume: 165228 },
    { start: '2026-10-04T22:00:00.000Z', volume: 90330 },
  ]);
  assert.throws(() => foldSessions({ bars: [], success: true }), /no bars/);
});

test('futures volume is the last finished session, named for the day it ended, against the ones before', () => {
  const sessions = foldSessions(GC_BARS);
  const out = volumeList(sessions, PROBED);
  assert.match(out, /Friday 2 Oct: 165,228 contracts, against an average of 128,923 over the session before\./,
    'the session that ended Friday is not the latest finished one, or is named for the evening it began');
  assert.doesNotMatch(out, /90,330/, 'a session still forming is read as finished, so every morning reads light');
  // Monday's session ends at 17:00 New York, 21:00 UTC in October.
  assert.match(volumeList(sessions, Date.parse('2026-10-05T21:00:00Z')),
    /Monday 5 Oct: 90,330 contracts, against an average of 147,076 over the 2 sessions before\./);
  // In winter the session starts at 23:00 UTC and still runs 23 hours.
  assert.match(volumeList([{ start: '2026-12-03T23:00:00.000Z', volume: 1000 }], Date.parse('2026-12-04T22:00:00Z')),
    /Friday 4 Dec: 1,000 contracts\.$/, 'with nothing before it, the line claims an average of nothing');
  const twentyTwo = Array.from({ length: 22 }, (_, i) =>
    ({ start: new Date(Date.parse('2026-09-01T22:00:00Z') + i * 86_400_000).toISOString(), volume: i === 0 ? 1e9 : 100 }));
  assert.match(volumeList(twentyTwo, Date.parse('2026-10-01T00:00:00Z')), /average of 100 over the 20 sessions before/,
    'the average reaches past the twenty sessions before the latest');
  assert.throws(() => volumeList([{ ...sessions[0], volume: null }, sessions[1]], PROBED), /no readable session/);
  assert.throws(() => volumeList([sessions[2]], PROBED), /no finished session/);
});

test('futures volume that will not read is a sentence, and never takes the briefing down', async () => {
  await stubbed(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, sessions: [] }), { status: 200 });
    assert.match(await volumeBlock(), /could not be read just now; do not quote it from a search/);
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    assert.match(await volumeBlock(), /could not be read just now; do not quote it from a search/);
  });
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

// August 2026 is EDT, January EST: a UTC schedule is an hour wrong for half
// the year, which is why this is code rather than a cron expression.
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
   The grammar is the whole state store, so a payload that parses wrong writes
   the wrong column to the wrong trade, silently.
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
  // The guarantee that matters: no payload can name a broker column.
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
  // Measured in BYTES, over every button both forms draw — a setup travels inside
  // the payload, so the vocabulary sets the budget. The cap is asserted, not the
  // current longest name.
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
  /* parseCallback refuses anything but two or three `|` parts, so a setup named
     "Break | Retest" would arrive as four and every tap on it be dropped
     silently. The vocabulary is the one string here a person edits. */
  for (const setup of SETUPS) {
    assert.equal(setup.includes('|'), false,
      `"${setup}" contains the callback_data delimiter and can never be tapped`);
  }
});

test('the message heads with the New York hour and the New York day', () => {
  /* Either side of the boundary, because they fail differently. 04:05 UTC is
     00:05 the same day in New York: only the HOUR moves, to the one an h24 cycle
     renders as 24. 02:00 UTC is 22:00 the PREVIOUS day: the DAY moves, filing a
     trade under tomorrow. Driven through renderMessage, which is what he reads.
     NOT PROVED: the h24 half — V8 resolves en-GB to h23 either way, so reverting
     hourCycle stays green. Reverting the timezone fails it. */
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
  // Without it there is no way back to the summary. On an unfinished journal it
  // would be a button for abandoning it, so it appears only once all four are in.
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
  // Null is not no, in the one place it is shown to a person.
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
   An open form always has four keyboard rows, so reading the row count off the
   incoming message can never settle it. These replay the taps.
   ───────────────────────────────────────────────────────────────────────── */

test('the fourth answer settles the form, and the three before it do not', () => {
  // The whole sequence as the webhook drives it: read before, write, then
  // redraw with staysOpen.
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
   The app writes the same four columns; trades_telegram_on_answer fires on the
   update and sends the row with the answers AS THEY STOOD, and doji-gladys
   decides the redraw from that before-state with answered() — the expression
   staysOpen() applies to a tap. THEY MUST STAY ONE EXPRESSION: a tap fires both
   redraws, the trigger's lands second, and a difference would shut a form
   reopened with [Edit] under the correction being made in it.
   ───────────────────────────────────────────────────────────────────────── */

test('a trade missing any one answer is not answered', () => {
  /* All four, setup included: a message settling without one would read
     `Logged · SELL 3400.00 · null`. */
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
  /* The app writes all four in ONE update — a before-state no tap can produce. */
  const before = { setup: null, followed_rules: null, followed_sl: null, followed_tp: null };
  const drawn = renderMessage(settled, answered(before));

  assert.equal(drawn.reply_markup.inline_keyboard.length, 1, 'the form did not settle');
  assert.equal(drawn.text, renderMessage(settled, false).text,
    'the app path and a fourth tap draw different summaries');
});

test('correcting a settled trade from the app reopens the form, as a tap does', () => {
  // A correction leaves the form open whoever made it; deciding from the ROW
  // rather than the writer is what makes the trigger agree with the tap.
  const corrected = { ...settled, followed_tp: true };
  const viaApp = renderMessage(corrected, answered(settled)).reply_markup.inline_keyboard;
  const viaTap = renderMessage(corrected, staysOpen(parseCallback('PID562780708|tp|1'), settled))
    .reply_markup.inline_keyboard;

  assert.equal(viaApp.length, 5, 'the reopened form is missing a row');
  assert.deepEqual(viaApp, viaTap);
});

test('the taps are taken off the buttons the form actually drew', () => {
  /* THE SAME SEQUENCE, WITH NOTHING TYPED INTO IT. The test above supplies its own
     callback_data; this one proves the keyboard emits payloads that reach the
     loop. A ✓ drawn with any value but `1` parses to null and the tap is dropped
     by design, so each round renders the form, finds the button and taps THAT. */
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
  /* The walk above presses one path. A ✗ drawn as `|no` is dropped as silently,
     so this presses nothing and checks every button on both forms, [Edit] and
     [Done] included. */
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
   Weekdays 08:00 and Sunday 17:00 New York, from an hourly job — an off-by-one
   is a briefing that never arrives or arrives every hour. EDT and EST both.
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

/* ─── Eugenia: which schedule this hour owes ─────────────────────────────────
   The predicates overlap, so what an hour owes is their composition. This walks
   168 CONSECUTIVE HOURS: a walk restarting at 00:00 UTC never reaches Sunday
   20:00–23:59 New York, which is Monday 00:00–03:59 UTC. Sun 16 Aug 2026 00:00
   UTC is Sat 15 Aug 20:00 New York, so both weekend edges are covered.
   ─────────────────────────────────────────────────────────────────────────── */

/* DRIVEN AS THE LOOP RUNS, not called with a hand-picked flag. The pass at
   22:00 records itself, which is what makes 23:00 a retry rather than a second
   pass, and only a walk carrying that state forward can show it. `passFails`
   is the night the recording never happens. */
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

test('an ordinary week owes one briefing and one nightly pass a day, and the Saturday review', () => {
  // August, so EDT: 08:00 ET is 12:00 UTC, Sunday's 17:00 is 21:00, and 22:00
  // ET is 02:00 UTC the NEXT day.
  assert.deepEqual(timetable(true), [
    '2026-08-16T02:00 consolidate', '2026-08-16T21:00 sunday',
    '2026-08-17T02:00 consolidate', '2026-08-17T12:00 weekday',
    '2026-08-18T02:00 consolidate', '2026-08-18T12:00 weekday',
    '2026-08-19T02:00 consolidate', '2026-08-19T12:00 weekday',
    '2026-08-20T02:00 consolidate', '2026-08-20T12:00 weekday',
    '2026-08-21T02:00 consolidate', '2026-08-21T12:00 weekday',
    '2026-08-22T02:00 consolidate', '2026-08-22T14:00 review',
  ]);
});

test('a week of failed briefings owes the retry hours', () => {
  // 09:00–11:00 ET are 13:00–15:00 UTC. Consolidation is not a briefing, so a
  // failed one neither delays nor replaces it.
  const day = (d) => [`2026-08-${d}T02:00 consolidate`,
                      `2026-08-${d}T12:00 weekday`, `2026-08-${d}T13:00 weekday`,
                      `2026-08-${d}T14:00 weekday`, `2026-08-${d}T15:00 weekday`];
  /* AND SUNDAY RETRIES AS ITSELF, at 18:00–20:00 New York (22:00–00:00 UTC), or
     the retry says Buenos dias at the week's open. 00:00 UTC Monday is the hour a
     walk restarting each UTC day never reaches. */
  assert.deepEqual(timetable(false), [
    '2026-08-16T02:00 consolidate', '2026-08-16T21:00 sunday',
    '2026-08-16T22:00 sunday', '2026-08-16T23:00 sunday', '2026-08-17T00:00 sunday',
    ...day('17'), ...day('18'), ...day('19'), ...day('20'), ...day('21'),
    '2026-08-22T02:00 consolidate', '2026-08-22T14:00 review',
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
  // 03:00 UTC on the 14th is 22:00 ET on the 13th — the previous night's pass.
  assert.deepEqual(owed, ['03:00 consolidate', '13:00 weekday']);
});

test('silence is the word she was told to use, and nothing else', () => {
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
   The hours a failed briefing may try again, and the marker that stops it once
   one has landed.
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

/* ─── Sunday's own three hours ───────────────────────────────────────────────
   The Sunday open is the briefing whose absence takes seven days to come round
   again — the least recoverable and the least noticeable.
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
   `?force=1` exists for the hour a briefing did NOT arrive, so which kind it
   sends is a question about the DAY, never a constant.
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
     the 09:00 retry sends a second. The filter names the two strings, so a
     question merely mentioning the word cannot suppress a real briefing. */
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
  /* Thirty messages between 08:00 and 09:00 would push the marker out of any
     scan of recent turns, and the retry would send a second briefing. A filter
     on the marker cannot be crowded out. */
  const q = briefedQuery();
  assert.match(q, /limit=1(&|$)/);
  assert.match(q, /order=id\.desc/);
  // The marker is written as the USER turn of the stored pair; her half is the
  // briefing itself, which would match nothing here anyway.
  assert.match(q, /role=eq\.user/);
});

/* ─── Eugenia: what he can see of her memory ─────────────────────────────────
   notesBlock renders the notes for HER, as instructions to obey. notesList
   renders the same rows for HIM — the only window he has into what she keeps,
   all of it written by her, silently.
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
  /* The map is rendered here, not appended from channelsBlock(), which is written
     for HER and opens "Where he stands on each channel" — the one message
     addressed to him must not switch into the third person about him. Read as a
     whole, since any heading from the other rendering would do it. */
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
   The only part of her memory that does not scroll, and the only place an
   ABSENCE is legible: a channel he has never touched has to SHOW, because in
   her notes it is nothing written down.
   ───────────────────────────────────────────────────────────────────────── */

test('a channel with no row shows at the bottom rung, never vanishes', () => {
  /* A channel never seeded, or dropped in a repair, would simply not appear —
     and four channels shown reads exactly like a trader who has covered the
     fifth. */
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
  /* "central_bank_buying" is not something a person says across a desk. The
     underscore is the test rather than the id, because three ids ARE their own
     display words; snake_case is the whole of what machine-shaped means here. */
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
   but him, so a year of use piles every channel at `owns` and the census can
   no longer say which is thin. */

test('a rung says when it last moved', () => {
  const out = channelsList([
    { channel: 'dollar', state: 'owns', evidence: 'he got there unaided', moved_on: '2026-03-12' },
  ]);
  assert.match(out, /the dollar — owns since 12 Mar \(he got there unaided\)/);
});

test('the stored civil day is the day shown, not the day before it', () => {
  /* moved_on is a NEW YORK civil day. new Date('2026-03-12') is midnight UTC,
     19:00 on the 11th in New York, so read through a New York formatter every
     rung would show a day early. Both halves of the year. */
  assert.match(channelsList([{ channel: 'jobs', state: 'used', evidence: null, moved_on: '2026-03-12' }]),
    /jobs — used since 12 Mar/);
  assert.match(channelsList([{ channel: 'jobs', state: 'used', evidence: null, moved_on: '2026-01-01' }]),
    /jobs — used since 1 Jan/);
});

test('a rung that has never moved says nothing rather than a blank date', () => {
  // Every channel is seeded before anything is known, so a null moved_on is the
  // ordinary case and must not render as "since " and nothing.
  const out = channelsList([{ channel: 'jobs', state: 'unseen', evidence: null, moved_on: null }]);
  assert.match(out, /jobs — unseen/);
  assert.ok(!out.includes('since'), out);
});

test('the bottom rung is the first one, because the map falls back to it', () => {
  // A missing row renders at CHANNEL_STATES[0]. Reorder the ladder and every
  // unseeded channel reads as owned.
  assert.equal(CHANNEL_STATES[0], 'unseen');
});

/* ─── Eugenia: who said the thing the search found ───────────────────────────
   Without `role`, every turn came back as her own words — she would quote his
   instruction as her analysis, or deny saying what he said. It rides in
   `source`.
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
   A section she is cited to and cannot fetch is worse than a blank: "there is
   no section 4.1" is a wrong fact about the document, from the tool that exists
   to stop her inventing one.
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

  // A subsection of a written section resolves to it, so she can read that §4.9
  // is not there. One level up, never a guess.
  assert.match(readStrategy('4.9'), /## 4 · The setups/);
});

/* ─── Eugenia: the day the nightly pass reads ────────────────────────────────
   The limit takes the NEWEST turns. The oldest would distil the morning and
   drop the evening, where a late instruction lives.
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
   Answered off a stand-in table, because a query ordered the wrong way reads
   exactly as well as the right one.
   ───────────────────────────────────────────────────────────────────────── */

const pickRows = (query, rows) => {
  const params = new URLSearchParams(query.split('?')[1]);
  const [col, dir] = params.get('order').split('.');
  const kept = rows.filter(r => params.getAll('role').every(v => v === `eq.${r.role}`) &&
    params.getAll('created_at').every(v => {
      const [op, ...rest] = v.split('.'); const bound = rest.join('.');
      return op === 'gte' ? r.created_at >= bound : op === 'lte' ? r.created_at <= bound : false;
    }));
  kept.sort((a, b) => (a[col] < b[col] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
  return kept.slice(0, Number(params.get('limit')));
};
const pickTurn = (query, rows) => pickRows(query, rows).map(r => r.content);

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

test('a reply to the briefing finds it, though it was stored before it was sent', () => {
  /* THE ONE MESSAGE STORED FIRST. The marker and text go down before the speaking
     worker sends, so the voice note he swipes is dated after its row. */
  const sent = Date.UTC(2026, 9, 2, 12, 3, 0) / 1000;
  const iso = (s) => new Date((sent + s) * 1000).toISOString();
  const briefing = [
    { id: 1, role: 'assistant', content: 'last night',          created_at: iso(-36000) },
    { id: 2, role: 'user',      content: '[weekday briefing]',  created_at: iso(-40) },
    { id: 3, role: 'assistant', content: 'the briefing',        created_at: iso(-40) },
  ];
  assert.deepEqual(pickTurn(repliedQuery(sent), briefing), []);
  assert.equal(spokenBriefing(pickRows(spokenQuery(sent), briefing)), 'the briefing');

  // Anything else in the window is a message he is not replying to: a turn
  // stored without being sent, or one stored between the briefing and the note.
  const unsent = [...briefing.slice(0, 1),
    { id: 2, role: 'user',      content: 'what about silver', created_at: iso(-30) },
    { id: 3, role: 'assistant', content: 'never reached him',  created_at: iso(-30) }];
  assert.equal(spokenBriefing(pickRows(spokenQuery(sent), unsent)), null);
  const between = [...briefing,
    { id: 4, role: 'user',      content: 'and silver?',        created_at: iso(-10) },
    { id: 5, role: 'assistant', content: 'silver is quiet',    created_at: iso(-10) }];
  assert.equal(spokenBriefing(pickRows(spokenQuery(sent), between)), null);
  // Paired by the instant the INSERT gave both, never by adjacent ids alone.
  const unpaired = [briefing[0], briefing[1],
    { id: 3, role: 'assistant', content: 'another turn', created_at: iso(-35) }];
  assert.equal(spokenBriefing(pickRows(spokenQuery(sent), unpaired)), null);
});


/* ─── The heartbeat the two silent writers leave ─────────────────────────────
   The poller and the email function report failure to nobody, so either dying
   looks like a week he did not trade. STALENESS IS THE TEST, NOT THE ERROR: a
   writer failing every run and one no longer invoked produce the same silence,
   and only last_ok going cold sees the second.
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
   A monitor wrong on ordinary days gets ignored, and an ignored monitor is
   worse than none. Both of these are ordinary days.
   ─────────────────────────────────────────────────────────────────────────── */

test('a quiet weekend is not the poller dying', () => {
  /* Gold shuts Friday 17:00 New York to Sunday 17:00, and the poller answering
     "market closed" across it IS a completed run. Unmarked, forty-eight hours
     pass against a six-hour window and the sync reads dead every Sunday. */
  const line = healthLine(
    [{ id: 'poller', last_ok: ago(0.05), last_error: null, last_error_at: null }],
    HEALTH_NOW);
  assert.equal(line, '', 'a weekend skip was read as a dead poller');
});

test('a week with no fills is not the email path dying', () => {
  /* The email function runs only when a fill arrives, so its silence is a quiet
     week. Silence is evidence only for the writer that runs on a clock. */
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
  /* Reported on OUTCOME, so a failure surfaces however old the last fill, and a
     success after it clears. */
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
   Her notes, turns, channels, thesis, loops and calendar have no other source.
   PostgREST caps a response at its own max-rows whatever is asked, so ONE read
   of eugenia_turns returns a page that looks exactly like a complete archive —
   green job, well-formed file, plausible counts, found on restore.
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
  for (const t of ['trades', 'eugenia_notes', 'eugenia_turns', 'eugenia_channels',
                   'eugenia_thesis', 'eugenia_portrait', 'eugenia_reads', 'eugenia_loops',
                   'eugenia_calendar',
                   'trade_stops']) {
    assert.ok(t in out.tables, `${t} cannot be rebuilt from anywhere and is not in the backup`);
  }
  // The cost meter is deliberately out: every row is about a model call rather
  // than about him, and it is by far the largest table.
  assert.ok(!TABLES.some(([t]) => t === 'eugenia_runs'), 'the cost meter is in the backup');
  assert.match(out.taken_at, /^\d{4}-\d\d-\d\dT/, 'the document does not say when it was taken');
});

/* ─── The outside check: is anything running at all ─────────────────────── */

test('the outside check fails a poller past the briefing\'s threshold, and only then', () => {
  const now = Date.parse('2026-08-03T12:00:00Z');
  const ago = (h) => new Date(now - h * 3600_000).toISOString();
  // The same six hours healthLine reads, imported: at the edge it is running.
  assert.equal(stale(ago(6), now), null);
  assert.match(stale(ago(6.1), now), /^the poller last completed a run 6\.1h ago/);
  assert.equal(stale(ago(0.05), now), null);
  assert.equal(stale(null, now), 'the poller has never completed a run');
});

test('the outside check counts a refused read as the outage, never as a pass', async () => {
  const refused = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(() => lastRun('https://x', 'k', refused), /HTTP 401/,
    'a revoked key or a paused project answered the check as healthy');
  const empty = async () => ({ ok: true, json: async () => [] });
  await assert.rejects(() => lastRun('https://x', 'k', empty), /no poller row/);

  const asked = [];
  const row = async (u) => { asked.push(u); return { ok: true, json: async () => [{ last_ok: 'T' }] }; };
  assert.equal(await lastRun('https://x', 'k', row), 'T');
  assert.deepEqual(asked, ['https://x/rest/v1/sync_health?select=last_ok&id=eq.poller']);
});

/* ─── Eugenia: Telegram's 4096-character limit ───────────────────────────── */

test('a briefing longer than one message is split, and never mid-sentence', () => {
  // Over the length the prompt asks for, in paragraphs as she writes.
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
  /* Two lookups, not Math.max(lastIndexOf('\n\n'), lastIndexOf('\n')): every
     blank line contains a newline at a higher index, so the max can never pick
     the paragraph. The one thing allowed an internal newline is a plain-dash
     list, so the break belongs before the list rather than inside it. */
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
   `days` arrives from the model, so tradesQuery clamps it. Reading the view
   rather than the table is the guarantee she cannot write a trade.
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
  /* open_day is a civil day, so the bound has to be one. 02:00 UTC is 22:00 the
     previous evening in New York, where a UTC date is already tomorrow; and the
     evening after the clocks go back a day is 25 hours, so seven fixed days
     lands six civil days ago. */
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
   One definition, read by the poller's market hours and Eugenia's schedules.
   Asserted DIRECTLY, because a bug here would move all its callers together
   in a way that reads as correct.
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
   The Messages API refuses a leading assistant turn, and the refusal is total
   until the row rolls out. Two rows in one INSERT draw two sequence values and
   a concurrent INSERT can take one between them, so the window can open
   mid-pair. openOnUser holds the invariant.
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
  // Two messages seconds apart interleave as u1 u2 a1 a2; any even window can
  // open on an assistant turn.
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
   call, so the briefing he read can have been written by a model nothing here
   named. Driven through ask(): the risk is the line never being printed, which
   a hand-fed flag cannot discover.
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
  const lines = [];
  let n = 0;
  await stubbed(async () => {
    globalThis.fetch = async () => responses[n++];
    console.log = (line) => lines.push(line);
    await ask([{ role: 'user', content: 'anything' }], 'medium', 'test');
  });
  return lines;
}

test('the ordinary turn says nothing about the model, because nothing happened', async () => {
  const [line] = await costLines([answers('claude-opus-5-5')]);
  assert.match(line, /test — claude-opus-5-5, 1 round\(s\), medium effort/);
  assert.doesNotMatch(line, /FELL BACK/);
});

test('a caller on a cheaper model does not read as having fallen back', async () => {
  /* The fallback column compares what answered against what THIS caller asked
     for. A file-wide constant would report a fallback on every Sonnet call. Driven
     through `ask`, because the comparison is inside the loop. */
  const lines = [];
  await stubbed(async () => {
    globalThis.fetch = async () => answers('claude-sonnet-5-5');
    console.log = (line) => lines.push(line);
    await ask([{ role: 'user', content: 'anything' }], 'medium', 'trim');
  });
  assert.match(lines[0], /trim — claude-sonnet-5-5/,
    'the trim did not ask for Sonnet, so the model map is not reaching the request');
  assert.doesNotMatch(lines[0], /FELL BACK/,
    'a caller answered by the model it asked for reads as a fallback, so the ' +
    'comparison is against one name for the file rather than against the caller');
});

test('a turn served by another model names it in the cost line', async () => {
  const [line] = await costLines([answers('some-other-model')]);
  assert.match(line, /FELL BACK TO some-other-model/);
});

/* A request that never answers. Only the signal ask() hands it can end it, so
   a turn that settles proves the signal reached the request. Raced against a
   deadline of its own, as the speech test is: AbortSignal.timeout's timer is
   unref'd, so this timer stands in for the open socket a real request holds,
   and a regression fails here rather than hanging the suite. */
test('a model request that never answers fails the turn in words, and files its row', async () => {
  const rows = [];
  let err, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      'ask() waited past its budget for a model that never answers')), 3_000);
  });
  await stubbed(async () => {
    globalThis.fetch = (url, init) => {
      if (url.includes('/rest/v1/eugenia_runs')) {
        rows.push(...JSON.parse(init.body));
        return Promise.resolve({ ok: true });
      }
      return new Promise((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
    };
    try {
      err = await Promise.race([
        ask([{ role: 'user', content: 'anything' }], 'medium', 'test', undefined, 50)
          .then(() => null, e => e),
        deadline]);
    } finally { clearTimeout(timer); }
  });
  assert.ok(err, 'a request that never answered let the turn return');
  assert.equal(err.message, "Claude did not finish within the turn's 0.05s",
    'the apology would quote the runtime\'s abort rather than say what happened');
  assert.equal(rows.length, 1, 'the stalled turn left no row');
  assert.equal(rows[0].ok, false);
  assert.match(rows[0].detail, /did not finish/);
});

test('a fallback on one round survives a later round that did not fall back', async () => {
  // Round one declines and is rescued; round two runs on what was asked for.
  // Clearing on the second would report the turn as ordinary.
  const [line] = await costLines([asksForStrategy('some-other-model'),
                                  answers('claude-opus-5-5')]);
  assert.match(line, /2 round\(s\)/);
  assert.match(line, /FELL BACK TO some-other-model/);
});

/* ─── A failed tool read must not take the answer with it ────────────────────
   A read the MODEL asked for that 404s must come back as a sentence the loop
   hands to the next round, not kill the briefing. Driven through ask(),
   because the claim is about the loop carrying on.
   ─────────────────────────────────────────────────────────────────────────── */

const asksForTrades = (model) =>
  served(model, { stop_reason: 'tool_use', content: [
    { type: 'tool_use', id: 'tu_1', name: 'get_trades', input: { days: 7 } }] });

// Every request body ask() sent, with the journal read answering `status`.
// SB_URL is "" under Node, so PostgREST is the caller whose path starts /rest.
async function turnWithJournal(status, responses) {
  const sent = [];
  let n = 0;
  return await stubbed(async () => {
    globalThis.fetch = async (url, init) =>
      String(url).startsWith('/rest/')
        ? { ok: status === 200, status, json: async () => [] }
        : (sent.push(JSON.parse(init.body)), responses[n++]);
    const text = await ask([{ role: 'user', content: 'anything' }], 'medium', 'test');
    return { text, answered: sent[1].messages.at(-1).content[0].content };
  });
}

const twoRounds = [asksForTrades('claude-opus-5-5'), answers('claude-opus-5-5')];

test('a journal read that 404s is answered to her, and the turn finishes', async () => {
  const { text, answered } = await turnWithJournal(404, twoRounds);
  assert.equal(text, 'an answer');
  assert.match(answered, /could not be read/);
});

test('a journal read that 404s never comes back as an empty window', async () => {
  // "No trades in that window" from a window nothing looked at reads as "you have
  // not traded since Friday" — false, in her voice, with nothing reporting it.
  const { answered } = await turnWithJournal(404, twoRounds);
  assert.doesNotMatch(answered, /No trades in that window/);
});

test('an empty window still says it is empty, because that is an answer', async () => {
  const { answered } = await turnWithJournal(200, twoRounds);
  assert.match(answered, /No trades in that window/);
});

/* ─── A tool set is what a caller can run, not only what it is shown ────────
   `serve` can run every tool in the file, and the rules that matter are about
   who may: only the nightly pass moves a rung. Driven through ask() with the
   reply's set, because the guarantee is the loop refusing, not the set's list.
   ─────────────────────────────────────────────────────────────────────────── */

test('a tool the caller was not offered is answered as unknown and never runs', async () => {
  const db = [], sent = [];
  const responses = [
    served('claude-opus-5-5', { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'tu_1', name: 'set_channel',
        input: { channel: 'dollar', state: 'owns', evidence: 'one exchange' } }] }),
    answers('claude-opus-5-5'),
  ];
  let n = 0;
  await stubbed(async () => {
    globalThis.fetch = async (url, init) => String(url).startsWith('/rest/')
      ? (db.push(String(url)), { ok: true, status: 200, json: async () => [{}] })
      : (sent.push(JSON.parse(init.body)), responses[n++]);
    await ask([{ role: 'user', content: 'I get real rates now' }], 'medium', 'reply');
  });
  assert.match(sent[1].messages.at(-1).content[0].content, /no tool called "set_channel"/);
  assert.ok(!db.some(u => u.includes('eugenia_channels')),
    'a reply moved a rung, which only the nightly pass may do');
});

/* ─── A paused turn, and a cut-off one ───────────────────────────────────────
   Two stop reasons that carry text that is not the answer: the server's search
   loop out of iterations, and a max_tokens truncation. The loop has to tell
   them from an ending.
   ─────────────────────────────────────────────────────────────────────────── */

const pausedContent = [
  { type: 'text', text: 'Let me look at the overnight session.' },
  { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'gold' } },
];
const paused = (model) => served(model, { stop_reason: 'pause_turn', content: pausedContent });

test('a paused turn is resumed, not sent as the answer', async () => {
  const { sent, lines } = await bodiesOf([paused('claude-opus-5-5'), answers('claude-opus-5-5')]);
  assert.equal(sent.length, 2, 'the paused turn ended the loop, so its preamble was the answer');
  // Resumed by sending it back as it stands, with nothing after it.
  assert.deepEqual(sent[1].messages.at(-1), { role: 'assistant', content: pausedContent });
  assert.match(lines[0], /2 round\(s\)/);
});

test('a turn cut off at max_tokens fails rather than sending half an answer', async () => {
  const rows = [];
  await stubbed(async () => {
    globalThis.fetch = async (url, init) => String(url).startsWith('/rest/')
      ? (rows.push(JSON.parse(init.body)[0]), { ok: true, status: 201 })
      : served('claude-opus-5-5', { stop_reason: 'max_tokens',
          content: [{ type: 'text', text: 'Gold opened the week at' }] });
    await assert.rejects(ask([{ role: 'user', content: 'anything' }], 'medium', 'test'),
      /max_tokens/);
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.match(rows[0].detail, /max_tokens/, 'the failure row does not say why the turn died');
});

/* ─── What the cache costs, and what stops it being bought twice ─────────────
   A breakpoint on the system block alone re-sends the conversation at full
   price each tool round; and a cache WRITE — 1.25× at five minutes, 2× at an
   hour — is the expensive side the meter must count. Driven through ask(): a
   breakpoint never attached, or a usage field nothing prints, passes any
   assertion on the value alone.
   ─────────────────────────────────────────────────────────────────────────── */

// The same two-round shape as above, with the request bodies kept.
async function bodiesOf(responses) {
  const sent = [], lines = [];
  let n = 0;
  await stubbed(async () => {
    globalThis.fetch = async (url, init) =>
      String(url).startsWith('/rest/')
        ? { ok: true, status: 200, json: async () => [] }
        : (sent.push(JSON.parse(init.body)), responses[n++]);
    console.log = (line) => lines.push(line);
    await ask([{ role: 'user', content: 'anything' }], 'medium', 'test');
  });
  return { sent, lines };
}

// Every cache_control marker sitting in a request's messages, ignoring the
// system block — which has carried one since the strategy moved into it.
const marks = (body) => body.messages.flatMap(m =>
  (Array.isArray(m.content) ? m.content : []).filter(b => b.cache_control));

test('the first request marks nothing, because there is nothing yet to re-read', async () => {
  const { sent } = await bodiesOf([asksForStrategy('claude-opus-5-5'),
                                   answers('claude-opus-5-5')]);
  assert.equal(marks(sent[0]).length, 0,
    'a breakpoint on the opening message is a write nothing will ever read back');
});

test('the round after a tool call reads the last one back instead of buying it', async () => {
  const { sent } = await bodiesOf([asksForStrategy('claude-opus-5-5'),
                                   answers('claude-opus-5-5')]);
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
  /* A REQUEST MAY CARRY FOUR BREAKPOINTS AND THE SYSTEM BLOCK HOLDS ONE. Left
     behind on each round, the fifth request is a 400 — on exactly the mornings
     with most to read. Two tool rounds tell a mark that moved from one that
     stayed. */
  const { sent } = await bodiesOf([asksForStrategy('claude-opus-5-5'),
                                   asksForStrategy('claude-opus-5-5'),
                                   answers('claude-opus-5-5')]);
  assert.equal(marks(sent[2]).length, 1,
    `the third request carries ${marks(sent[2]).length} breakpoints — they are ` +
    `accumulating, and the fifth round will be refused`);
});

test('a cache write is counted, and the two prices are counted apart', async () => {
  /* A read is a twentieth of the input price; a write is 1.25× or 2× by lifetime, so
     a single total cannot be turned back into money. */
  const { lines } = await bodiesOf([served('claude-opus-5-5', {
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
  /* THE FIVE-MINUTE FIGURE IS THE REMAINDER, not a read: with no
     `cache_creation` breakdown both TTLs would read zero — a cache costing
     nothing, which is what a working one looks like. */
  const { lines } = await bodiesOf([served('claude-opus-5-5', {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'an answer' }],
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1300 },
  })]);
  assert.match(lines[0], /0\+1300 written/);
});

/* ─── The rung he can move himself ───────────────────────────────────────────
   A reader who rarely answers never leaves `explained` by the pass alone. This
   is him saying where he is, the standing a demotion already had.
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
  /* Three of the five names are several words, so reading the rung from position
     two fails as "no such channel" — like a name he got wrong. */
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

/* ─── The calendar TradingView files ─────────────────────────────────────────
   Driven off the fixture doji-tradingview's fold is tested against, folded by
   that fold, so the two halves of the read are held together.
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
    country: 'US', importance: 'medium', source: 'tradingview', consensus: '200K', prior: '198K', actual: '197K',
    ticker: 'ECONOMICS:USIJC',
  });
  // Payrolls has not printed: present-and-null would erase an actual already
  // filed, should TradingView ever hand one back blank.
  assert.ok(!('actual' in by['396953']), 'an unpublished actual is sent, and would erase one already filed');
  assert.equal(by['396953'].consensus, '90K');
  // A speech has no figure of any kind, and names none.
  for (const k of ['consensus', 'prior', 'actual']) assert.ok(!(k in by['421425']), `a speech names ${k}`);
});

/* ─── Abroad, what she asked for ─────────────────────────────────────────────
   Judged against every kind of event TradingView listed for the seven
   economies over two months, so the selection is held against the whole
   catalogue rather than the examples someone thought of.
   ─────────────────────────────────────────────────────────────────────────── */

const ABROAD = JSON.parse(readFileSync(
  new URL('./fixtures/tradingview-abroad.json', import.meta.url), 'utf8')).kinds;

test('abroad, the central banks, headline inflation, bond auctions and China\'s reserves are filed, and nothing else', () => {
  const kept = {};
  for (const k of ABROAD.filter(k => wanted({ ...k, timed: true }))) (kept[k.country] ??= []).push(k.title);
  const auctions = (titles) => titles.filter(t => /Auction|Tender|Syndication/.test(t));
  assert.deepEqual(kept.EU, ['Deposit Facility Rate', 'ECB Interest Rate Decision', 'ECB Press Conference',
    'Inflation Rate YoY Flash', 'ECB General Council Meeting', 'ECB Monetary Policy Meeting Accounts',
    'ECB Nagel Speech', 'ECB President Lagarde Speech']);
  assert.deepEqual(kept.JP, ['BoJ Interest Rate Decision', 'Inflation Rate YoY', 'BoJ Gov Ueda Speech',
    'BoJ Koeda Speech', 'BoJ Monetary Policy Meeting Minutes', 'BoJ Quarterly Outlook Report',
    'BoJ Summary of Opinions']);
  assert.deepEqual(kept.CN, ['Inflation Rate YoY', 'Foreign Exchange Reserves'],
    'China is filed past the lowest bar she set for it');
  assert.deepEqual(kept.GB.filter(t => !auctions([t]).length), ['BoE Interest Rate Decision', 'Inflation Rate YoY',
    'BoE MPC Vote Cut', 'BoE MPC Vote Hike', 'BoE MPC Vote Unchanged', 'MPC Meeting Minutes']);
  for (const c of ['DE', 'FR', 'IT']) {
    assert.deepEqual(kept[c].filter(t => !auctions([t]).length), ['Inflation Rate YoY Prel'], `${c} files a survey`);
  }

  /* EVERY GOVERNMENT BOND AUCTION IN THE FOUR, AND NO BILL. TradingView files
     them under three categories, some under the marker's `Calendar`, and names
     every bill in months. */
  const listed = (c) => auctions(ABROAD.filter(k => k.country === c).map(k => k.title));
  for (const c of ['DE', 'FR', 'IT', 'GB']) {
    assert.deepEqual(auctions(kept[c]), listed(c).filter(t => !/Month/.test(t)), `${c} drops a bond auction or files a bill`);
    assert.ok(auctions(kept[c]).length >= 8, `${c} files ${auctions(kept[c]).length} auctions — the reader has gone blind`);
  }
  assert.ok(!kept.JP.some(t => /Auction/.test(t)), "Japan's auctions are filed, and she asked for its bank and its inflation");

  // Her own measure: a hundred events in two months, out of nine hundred.
  const events = ABROAD.filter(k => wanted({ ...k, timed: true })).reduce((n, k) => n + k.n, 0);
  assert.equal(events, 103);
});

test('a release from abroad is filed under its country, and led by it', () => {
  const at = '2026-09-30T12:00:00.000Z';
  const event = (country, title, extra = {}) => ({ id: `${country}-${title}`, at, title, country,
    category: 'prce', importance: 'high', timed: true, period: 'Sep',
    consensus: null, prior: null, actual: null, ticker: null, ...extra });
  const rows = calendarRows([event('FR', 'Inflation Rate YoY Prel'), event('IT', 'Inflation Rate YoY Prel'),
    event('DE', '15/20/30-Year Bund Auction', { category: 'gov', importance: 'low', timed: false, period: null })],
    0, Infinity);
  // Three countries publish this title in one hour.
  assert.deepEqual(rows.map(r => r.name),
    ['FR Inflation Rate YoY Prel (Sep)', 'IT Inflation Rate YoY Prel (Sep)', 'DE 15/20/30-Year Bund Auction']);
  assert.deepEqual(rows.map(r => r.country), ['FR', 'IT', 'DE']);
  // At home the marker is still not a release, however it is rated.
  assert.equal(calendarRows([event(HOME, 'Summit', { category: 'gov', timed: false })], 0, Infinity).length, 0);
});

test('a list holding anything from abroad says once that his rules do not count it', () => {
  const row = (name, country) => ({ id: 0, at: '2026-10-29T12:15:00Z', name, country, importance: 'high',
    consensus: null, prior: null, actual: null });
  const out = calendarList([row('EU ECB Interest Rate Decision', 'EU'), row('GDP Growth Rate QoQ Adv', 'US')],
    Date.parse('2026-10-29T11:00:00Z'));
  assert.match(out, /08:15 ET EU ECB Interest Rate Decision, rated high — due/);
  assert.equal(out.match(/his rules count US releases alone/g)?.length, 1);
  assert.doesNotMatch(calendarList([row('GDP Growth Rate QoQ Adv', 'US')], Date.parse('2026-10-29T11:00:00Z')),
    /abroad/);
});

test('the filing goes up in groups that carry the same columns, keyed on the id', async () => {
  const sent = [];
  await stubbed(async () => {
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('doji-tradingview')) {
        sent.push({ read: String(url) });
        return new Response(JSON.stringify({ ok: true, events: FOLDED }), { status: 200 });
      }
      sent.push({ url: String(url), rows: JSON.parse(init.body) });
      return new Response('', { status: 201 });
    };
    assert.equal(await fileCalendar(OCT1_3PM), 3);
  });
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
  await stubbed(async () => {
    globalThis.fetch = async (url) => String(url).includes('doji-tradingview')
      ? new Response(JSON.stringify({ ok: true, events: FOLDED }), { status: 200 })
      : new Response('', { status: 201 });
    // A day and a half on, the 1st's claims and speech are past the twelve hours back.
    assert.equal(await fileCalendar(Date.parse('2026-10-02T20:00:00Z')), 1);
  });
});

/* A WEEK IS MARKED COVERED ONLY AFTER ITS ROWS. A mark in front of rows that
   never landed is a covered week with no releases, in which R-19 never looks
   for a print. */
async function weekWrites(week, failRows = false) {
  const sent = [];
  return await stubbed(async () => {
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('doji-tradingview')) {
        sent.push({ read: String(url) });
        return new Response(JSON.stringify({ ok: true, events: FOLDED }), { status: 200 });
      }
      sent.push({ url: String(url), rows: JSON.parse(init.body) });
      return new Response('', { status: failRows && String(url).includes('eugenia_calendar') ? 500 : 201 });
    };
    return { filed: await fileWeek(week, Date.parse('2026-10-03T03:00:00Z')).catch(e => e), sent };
  });
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
    'a week was marked covered with its releases refused — R-19 would never look for a print in it');
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
   reads; a refused week is asked again after the pause, and twice refused the
   walk ends rather than spending the run on the same answer. */
test('the history asks a refused week again once, and a second refusal ends the walk', async () => {
  const reads = [], runs = [];
  const refusals = new Map([['2026-09-13', 1], ['2026-09-20', 2]]);
  await stubbed(async () => {
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
    await postHistory('2026-09-06', 0);
  });
  assert.deepEqual(reads, ['2026-09-06', '2026-09-13', '2026-09-13', '2026-09-20', '2026-09-20'],
    'the walk did not retry a refused week once, or carried on past a second refusal');
  assert.deepEqual(runs.map(r => r.ok), [true, false, true, false, false],
    'an attempt went unrecorded — both outcomes are a row');
  assert.match(runs.at(-1).detail, /^2026-09-20: /, 'the last row does not name the week to resume from');
});

test('a calendar TradingView refused is an error, not an empty day', async () => {
  await stubbed(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'TradingView calendar: 429' }), { status: 500 });
    await assert.rejects(fileCalendar(OCT1_3PM), /429/);
  });
});

/* A FEED THAT NEVER ANSWERS IS NAMED IN THE ROW. The abort's own message is
   "Signal timed out.", and on 8 October the calendar's meter filled with it,
   naming no door. Driven against a fetch that settles only when aborted, with
   the clock behind READ_MS shortened so the test does not wait it out. */
test('a TradingView read that never answers says which door, and how long it waited', async () => {
  const realTimeout = AbortSignal.timeout;
  await stubbed(async () => {
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 20);
    globalThis.fetch = (url, init) => new Promise((_, reject) =>
      init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    // The stub holds no socket open, and the timer behind the signal is unref'd.
    const open = setTimeout(() => {}, 1_000);
    try {
      await assert.rejects(fileCalendar(OCT1_3PM), /^Error: TradingView calendar: no answer in 45s$/);
    } finally {
      clearTimeout(open);
      AbortSignal.timeout = realTimeout;
    }
  });
});

/* ─── The email boundary ─────────────────────────────────────────────────────
   doji-email-sync is the only function that reads a request body, so it is the
   one with a shape to check: five columns reach the table and nothing else
   can, whatever arrives.
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
   Apps Script labels a 400 permanently and retries everything else; these
   prove this end emits a 400 for exactly those cases.
   ─────────────────────────────────────────────────────────────────────────── */

test('only a status about the row itself is permanent', () => {
  // Postgres looked at this row and will never take it. The alternative is
  // retrying every minute for ninety days.
  for (const status of [400, 409, 422]) {
    assert.equal(answerFor(status), 400, `${status} should be permanent`);
  }
});

test('a status about the caller is transient, so the fill keeps its place', () => {
  /* A rotated SB_SECRET_KEY answers 401, which says nothing about the fill:
     treated as permanent, every queued net_pnl would be gone by the time anyone
     noticed the key. 404 is a renamed function, 403 a revoked grant, 429 a rate
     limit, 5xx is Supabase — each a repair that wants the fill still waiting. */
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
   She has no other. Without it a question at 23:42 reads as morning, because
   her most recent long turn IS that morning's briefing.
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
   A row with a null `embedding` is absent from a nearest-neighbour query, so a
   vendor that stopped answering costs half of `search_memory` while the
   lexical arm carries on. THREE OUTCOMES, THREE REPAIRS: a refusing vendor
   throws and arrives as its own message, and `embed()` returns null on an
   unset key ALONE — which makes "nothing filled with a backlog waiting" an
   exact statement rather than a guess.
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
  /* THE FALSE ALARM IS THE ORDINARY NIGHT: a drained archive answers `0 filled,
     0 left` for the rest of the deployment, and a line that accused the key
     there would fire every night and stop being read. */
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

/* withClock is where the stamp is attached, once, rather than by three callers
   each able to forget. ask() reaches the network on its first line, so no
   assertion can watch it build a request — this reads the file. Weaker than
   driving the sequence, and the strongest thing available. */
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

/* dateTurns answers "yesterday you said": the prompt forbids inferring the date
   from the conversation, which leaves the turns as the only source. */

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
   §7 writes a predicate for every rule and §8 the population filters and the
   three verdicts. EVERY RULE IS DRIVEN IN BOTH DIRECTIONS: a predicate only
   ever seen returning `pass` has been shown reachable, not shown to work. Each
   gets a row that satisfies it and one that breaks it, and `unknown` wherever
   the data can produce it.
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

  /* THE ONE EXCEPTION §6 CARVES: R-15 forces a close at the Friday 17:00 close,
     so a forced exit at +$12 would otherwise be flagged every week. 21:50Z is
     16:50 New York in January, inside the window; 19:00Z is 14:00 and still a
     flag — the pair §6 draws the line between. */
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

test('R-03 allows no entry after a $20 stop, and a tighter loss is not one', () => {
  const day = '2026-01-06';
  const at = (hm) => `${day}T${hm}:00Z`;
  const t = (id, open, close, o) => trade({ id, open_day: day, entry_price: 4000,
    entry_time: at(open), fill_time: close && at(close), ...o });
  const stop = (o) => t('PIDs', '10:00', '10:30', { pnl: -80, exit_price: 3980, ...o });
  const win = (id, open, close = '15:00') => t(id, open, close, { pnl: 120, exit_price: 4030 });
  const r = (rows) => verdictOf(rows, 'R-03');

  // The full stop ends the day: alone it is a pass, and one entry before it is
  // not after it.
  const kept = r([win('PIDa', '08:00', '09:00'), stop()]);
  assert.deepEqual([kept.verdict, kept.passed, kept.failed], ['pass', 1, 0]);

  /* ONE ENTRY AFTER IT IS THE BREACH — a sweep re-entry follows only a stop
     tighter than $20 — and the DAY is what is named, in either row order. */
  const broke = r([win('PIDa', '10:40'), stop()]);
  assert.deepEqual([broke.verdict, broke.failed, broke.ids], ['fail', 1, [day]]);

  // Past the cap is R-02's breach and still a full stop.
  assert.equal(r([stop({ exit_price: 3975 }), win('PIDa', '10:40')]).verdict, 'fail');

  /* HIS DEFINITION. A $12 stop taken in full is a loss and not a full stop, so
     the re-entry after it — the one a sweep permits — leaves the population. */
  const tight = r([stop({ exit_price: 3988, pnl: -48 }), win('PIDa', '10:40')]);
  assert.deepEqual([tight.passed, tight.failed, tight.unresolved], [0, 0, 0]);
  assert.equal(r([stop({ exit_price: 3980.01 }), win('PIDa', '10:40')]).failed, 0,
    'a loss a cent inside $20 was read as a full stop');

  // Unmeasurable where it could matter, and only there.
  assert.equal(r([stop({ fill_time: null }), win('PIDa', '10:40')]).verdict, 'unknown',
    'a full stop with no instant cannot count the entries after it');
  assert.equal(r([stop({ exit_price: null }), win('PIDa', '10:40')]).verdict, 'unknown',
    'a loss with no exit price might be a full stop');
  const cannot = r([stop({ fill_time: null })]);
  assert.deepEqual([cannot.verdict, cannot.unresolved], ['pass', 0],
    'one entry cannot breach this, so there was nothing the data failed to decide');
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

/* ─── The calendar R-19 is judged against ──────────────────────────────── */

test('an instant files under the Sunday its week began, in New York', () => {
  // Sunday 19:00 New York is Monday UTC, and still the week that began that Sunday.
  assert.equal(weekOf(new Date('2026-09-20T23:00:00Z')), '2026-09-20');
  assert.equal(weekOf(new Date('2026-09-26T14:00:00Z')), '2026-09-20');   // Saturday
  // Saturday 21:00 New York is Sunday 01:00 UTC, and still the old week.
  assert.equal(weekOf(new Date('2026-09-27T01:00:00Z')), '2026-09-20');
  assert.equal(weekOf(new Date('2026-09-27T05:00:00Z')), '2026-09-27');
});

test("R-19's calendar reads cover the trades' window, TradingView's high-rated US releases only, newest first", () => {
  const now = Date.parse('2026-10-20T15:00:00Z');
  const since = tradesQuery(30, now).match(/open_day=gte\.([\d-]+)/)[1];
  const rel = releasesQuery(30, now), wk = weeksQuery(30, now);
  assert.match(rel, new RegExp(`^eugenia_calendar\\?select=at&importance=eq\\.${HIGH}&country=eq\\.${HOME}&tv_id=not\\.is\\.null`));
  // What she typed in before the TradingView filing carries no id and was
  // never a rating he chose.
  assert.match(wk, /^calendar_weeks\?select=week/);
  // A day earlier than the trades, and a week earlier for the weeks.
  assert.ok(rel.match(/at=gte\.([\d-]+)/)[1] < since);
  assert.ok(wk.match(/week=gte\.([\d-]+)/)[1] <= new Date(Date.parse(since) - 7 * 864e5).toISOString().slice(0, 10));
  assert.match(rel, /order=at\.desc&limit=\d+/);
  assert.match(wk, /order=week\.desc&limit=\d+/);
});

test("a full release read covers only the weeks it reached, so R-19 cannot skip a position for want of a print", async () => {
  /* The read takes the newest releases. On a year long enough to fill it, the
     oldest weeks are marked fetched while their releases never arrived. Driven
     through check_rules, because the guard is in the read. */
  const day = (n) => new Date(Date.now() - n * 864e5);
  const entry = day(300);
  const trade = { id: 'PID1', direction: 'BUY', entry_time: entry.toISOString(),
    fill_time: new Date(+entry + 30 * 60_000).toISOString(), entry_price: 4000, exit_price: 4030,
    pnl: 60, open_day: entry.toISOString().slice(0, 10), setup: null, followed_rules: null,
    followed_sl: null, followed_tp: null, size_oz: 4, net_pnl: 60, planned_sl: null,
    planned_tp: null, best_price: null };
  // Every release is in the last few weeks, so none is near the old entry.
  const recent = (n) => Array.from({ length: n }, (_, i) => ({ at: day(1 + i / 40).toISOString() }));
  const weeks = [{ week: weekOf(entry) }, { week: weekOf(day(1)) }];
  const r19 = async (releases) => {
    return await stubbed(async () => {
      globalThis.fetch = async (url) => {
        const u = String(url);
        const rows = u.includes('eugenia_trades') ? [trade] : u.includes('eugenia_calendar') ? releases
          : u.includes('calendar_weeks') ? weeks : [];
        return { ok: true, status: 200, json: async () => rows };
      };
      return (await serve('check_rules', { days: 365 })).split('\n').find(l => l.startsWith('R-19'));
    });
  };
  /* COUNTS, NOT VERDICTS: a covered week with no print in the span leaves the
     position out of R-19's population, and an uncovered one makes it unknown —
     both read UNKNOWN. */
  assert.match(await r19(recent(RULE_RELEASES - 1)), /^R-19: UNKNOWN \(0 pass, 0 fail, 0 unknown\)/,
    'a read short of its bound covers every week it was handed, and no print landed on this position');
  assert.match(await r19(recent(RULE_RELEASES)), /^R-19: UNKNOWN \(0 pass, 0 fail, 1 unknown\)/,
    'a full read still counts the oldest week as covered, so a position nothing was read for drops out unseen');
  // The week the oldest release falls in is partial, and is left out too.
  const edge = [...recent(RULE_RELEASES - 1), { at: entry.toISOString() }];
  assert.ok(!coveredWeeks([weekOf(entry)], edge).has(weekOf(entry)));
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

  /* BOTH PULLED BEFORE THE PRINT, written by the poller as a row of two nulls.
     Without it the break-even stop just taken off reads as the stop in force. */
  assert.equal(r([first, moved(4000, '2026-10-14T11:00:00Z'), moved(null, '2026-10-14T12:00:00Z', null)]).verdict,
    'fail', 'a stop and target pulled before the print passed on the break-even stop they replaced');

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
     in, it was taken on at entry — R-20's caution — and not in this population
     at all. */
  const same = r([first], buy({ entry_time: '2026-10-14T12:00:00Z', open_day: '2026-10-14' }));
  assert.deepEqual([same.passed, same.failed, same.unresolved], [0, 0, 0]);

  // No history, a history that starts after the print, or a week never fetched.
  assert.equal(r([]).verdict, 'unknown');
  assert.equal(r([moved(3980, '2026-10-14T13:00:00Z')]).verdict, 'unknown');
  /* A HISTORY BEGINNING JUST AFTER THE PRINT, inside the grace, looks untouched —
     but nothing says where the stop was before it. */
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

  /* A STILL-OPEN POSITION EXTENDS TO NOW: a trade left running while a second
     opened is the clearest breach this rule has. */
  const now = Date.parse('2026-01-06T14:00:00Z');
  assert.equal(verdictOf([
    span('PIDa', '2026-01-06T10:00:00Z', null),
    span('PIDb', '2026-01-06T11:00:00Z', '2026-01-06T13:00:00Z'),
  ], 'R-10', now).verdict, 'fail');
});

/* ─── Every trade inside a longer hold is a breach ───────────────────────────
   A long hold covers everything opened inside it, so comparing each span only
   with its predecessor misses the second trade taken within one — counted as
   a PASS and named nowhere. The verdict cannot show it, because a nested span
   always has an overlapping neighbour too. THE COUNTS AND THE IDS ARE THE
   ASSERTION: they are what `check_rules` hands him to check.
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

/* ─── A close nothing stamped is unknown, not running ────────────────────────
   A closed row can carry an `exit_price` and no `fill_time` — a close the poller
   never stamped and no alert covered. Ended at `now`, it would overlap every
   trade taken after it: a cascade of R-10 failures, each naming a real row and
   each wrong. An end nothing recorded is UNKNOWN — never pass, and never fail.
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
  /* The same missing column in the rule that is about WHEN a span ended.
     Stepping past the row takes it out of the population, and a rate over the
     wrong population is §8's opening sentence. A genuinely open position has
     nothing to time and stays skipped. */
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
  /* THE OTHER DIRECTION, because a fix that flags everything passes the test
     above. Back-to-back trades: touching endpoints are a handover, not an
     overlap. */
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

  // A limit with no denominator is not a limit, and §8 withholds `balance` so
  // the wrong one cannot be reached for.
  assert.equal(verdictOf([
    trade({ id: 'PIDz', pnl: -900, size_oz: null, open_day: '2026-01-06', fill_time: '2026-01-06T11:00:00Z' }),
  ], 'R-11').verdict, 'unknown');
});

test('R-01 does not call a break-even stop-out a failure to take profit', () => {
  /* THE STRATEGY CONTRADICTS ITSELF HERE. §7 says "no win with abs(exit − entry)
     < 25"; §6's Exit names "at break-even once R-04 has moved the stop there" as
     legitimate. A break-even stop taken a few cents favourable clears the
     commission, so `pnl > 0` with a gap of pennies — common at this size. The
     journal's own scratch band decides. */
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
  /* A close with an `exit_price` and no instant cannot be placed in the running
     total. Stepped over, a lost LOSS never reaches the floor and the day passes;
     a lost WIN breaches a day that never did. `dayStanding` sums every closed
     row, so it would say the day is over while this reported pass. */
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

  // Every close unstamped: unknown, not absent from the population.
  const none = verdictOf([leg('PIDx', -90, '2026-01-06T10:00:00Z', null)], 'R-11');
  assert.equal(none.verdict, 'unknown');
  assert.equal(none.unresolved, 1, 'the day is not in the population at all');

  // Nothing closed yet is genuinely not this rule's day, and stays out.
  assert.equal(verdictOf([
    trade({ id: 'PIDo', open_day: '2026-01-06', entry_time: '2026-01-06T10:00:00Z' }),
  ], 'R-11').unresolved, 0);
});

test('a day carrying two sizes has no account, in both readers', () => {
  /* Two sizes is no account: 4 oz implies 2,000 and a −80 floor, 20 oz 10,000
     and −400. Taking whichever came first lets row order decide the limit on
     exactly the day R-13 exists to flag. */
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
  /* The deliberate difference: this is a SUM and needs no order, so an unstamped
     close counts here where r11 must step past it. */
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

  /* WITHIN THE WINDOW IS UNKNOWN, NOT PASS: nothing on a row says an entry was a
     sweep re-entry (§8), so a prompt second entry is undecidable. */
  assert.equal(verdictOf([
    entry('PIDa', '2026-01-06T10:00:00Z', '2026-01-06T10:30:00Z'),
    entry('PIDb', '2026-01-06T10:40:00Z', '2026-01-06T11:00:00Z'),
  ], 'R-12').verdict, 'unknown');

  // A second entry taken before the first closed is a second position, not a
  // re-entry — and a first still open is the same case.
  assert.equal(verdictOf([
    entry('PIDa', '2026-01-06T10:00:00Z', '2026-01-06T10:30:00Z'),
    entry('PIDb', '2026-01-06T10:20:00Z', '2026-01-06T11:00:00Z'),
  ], 'R-12').verdict, 'fail', 'a second entry while the first was open reads as a prompt re-entry');
  assert.equal(verdictOf([
    entry('PIDa', '2026-01-06T10:00:00Z', null),
    entry('PIDb', '2026-01-06T10:20:00Z', null),
  ], 'R-12').verdict, 'fail', 'a second entry beside a position still open reads as undecidable');
  // Closed with no instant to measure from is still undecidable.
  assert.equal(verdictOf([
    trade({ id: 'PIDa', open_day: '2026-01-06', entry_time: '2026-01-06T10:00:00Z', exit_price: 4400 }),
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

  /* JULY, WHERE THE CLOSE IS 21:00Z, NOT 22:00Z. A span ending at 21:30Z is over
     it in summer and short of it in winter — the hour a fixed offset gets wrong,
     reporting a kept rule as broken every summer. */
  assert.equal(held('2026-07-10T20:00:00Z', '2026-07-10T21:30:00Z'), 'fail');
  assert.equal(held('2026-07-10T20:00:00Z', '2026-07-10T20:30:00Z'), 'pass');

  // A midweek span never touches one.
  assert.equal(held('2026-01-06T14:00:00Z', '2026-01-07T14:00:00Z'), 'pass');
  // And a span too long to walk is answered rather than looped over.
  assert.equal(crossesFridayClose(new Date('2026-01-06T14:00:00Z'),
                                  new Date('2026-03-07T14:00:00Z')), null);
});

test('R-16 knows the market and bank holidays, including the ones that move', () => {
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
  // The banks' two, which the market trades through: Columbus Day, and
  // Veterans Day, a Wednesday in 2026.
  assert.equal(on('2026-10-12T14:00:00Z'), 'fail');
  assert.equal(on('2026-11-11T14:00:00Z'), 'fail');
});

test('easter is right, which is what makes Good Friday right', () => {
  // Four known years. Getting this wrong shifts one holiday a year by weeks and
  // would look like a rule broken on a day the market was open.
  assert.deepEqual(easter(2024), { m: 3, d: 31 });
  assert.deepEqual(easter(2025), { m: 4, d: 20 });
  assert.deepEqual(easter(2026), { m: 4, d: 5 });
  assert.deepEqual(easter(2027), { m: 3, d: 28 });
});

test('the holiday set is the ten the market keeps and the two only the banks keep, and nothing else', () => {
  const days = lowVolumeDays(2026);
  for (const d of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
                   '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
                   '2026-10-12', '2026-11-11']) {
    assert.ok(days.has(d), `${d} is a market or bank holiday and is not in the set`);
  }
  for (const d of ['2026-01-02', '2026-03-17', '2026-07-06', '2026-11-25', '2026-10-13']) {
    assert.ok(!days.has(d), `${d} is an ordinary trading day and the set closes the market on it`);
  }
  // Veterans Day on a Sunday is kept on the Monday, as the Fed observes it.
  assert.ok(lowVolumeDays(2029).has('2029-11-12'));
  assert.ok(!lowVolumeDays(2029).has('2029-11-09'));
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
  // §8's first filter. A client-id row has no prices and null timestamps.
  /* THE ROWS HAVE TO BE ABLE TO TRIP THE RULES, or this asserts nothing: a bare
     row is skipped by every rule for lack of a field, never for its id. These
     are real trades in every respect but their ids, and the second half proves
     it — under broker ids the same rows produce verdicts. */
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

  /* AND THE POPULATION checkRules DOES NOT REACH. dayStanding takes the same
     filter, or a client-id row dated today puts money into the figure that stops
     him trading. */
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
  /* §7's table and adherence.ts are two lists of one fact. A rule marked
     `journal` and not implemented is a check she cites that nobody runs; one
     implemented that the document calls `judgment` reports `pass` for something
     §8 says nothing stored can see. */
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
  /* FORMATTED OFF A MIDDAY UTC ANCHOR: moved_on is a New York civil day, and
     midnight UTC on the 12th is the 11th in New York. */
  assert.match(line, /12 Mar/);
  assert.equal(thesisLine(null), '');
});

test('how she reads him carries the day it last moved, and an absent one says nothing', () => {
  const line = portraitLine({ portrait: 'He cuts winners before the target.', moved_on: '2026-03-12' });
  assert.match(line, /cuts winners/);
  assert.match(line, /12 Mar/);
  // Written to her, about him: the audit is the one place it is said to him.
  assert.match(line, /How you read him/);
  assert.equal(portraitLine(null), '');
});

/* ─── Her record ─────────────────────────────────────────────────────────────
   A count says how often; only the misses say what she keeps getting wrong. */
const READS = [
  { given_on: '2026-07-30', reading: 'a hot print is bad for gold', test: 'the two-year falls on it',
    verdict: 'wrong', evidence: 'the two-year fell eight basis points', firmness: 'firm',
    lesson: 'I took the dollar as leading when the two-year was' },
  { given_on: '2026-07-29', reading: 'claims do not move the Fed', test: 'December pricing moves',
    verdict: 'held', evidence: 'December barely moved', firmness: 'light', lesson: null },
  { given_on: '2026-07-28', reading: 'the dollar leads today', test: 'the dollar index falls',
    verdict: 'untested', evidence: null, firmness: 'firm', lesson: null },
  // Filed before firmness was asked: in the month, in neither half.
  ...['07-27', '07-24', '07-23'].map((d, i) => ({ given_on: `2026-${d}`, reading: `miss ${i}`,
    test: 'a test', verdict: 'wrong', evidence: 'it fired', firmness: null, lesson: null })),
];

test('her record counts every verdict and names the newest misses, three at most', () => {
  const out = recordList(READS);
  assert.match(out, /judged at night by the test you stated: 1 held, 4 proved wrong, 1 untested; /);
  assert.match(out, /said lightly, 1 held, 0 proved wrong, 0 untested; said firmly, 0 held, 1 proved wrong, 1 untested\./,
    'the record no longer splits by how firmly a read was said, or counts an unmarked read in a half');
  assert.match(out, /Misread: I took the dollar as leading when the two-year was/,
    'a miss no longer says which link she misread');
  assert.match(out, /30 Jul: a hot print is bad for gold \(wrong if the two-year falls on it\) — the two-year fell/);
  assert.ok(out.includes('miss 0') && out.includes('miss 1') && !out.includes('miss 2'),
    'more than three misses are listed, or not the newest');
  assert.ok(!out.includes('claims do not move'), 'a read that held is listed as a miss');
  // No reads yet is no record, not a record of zeros.
  assert.equal(recordList([]), '');
});

/* ─── Her own calls ──────────────────────────────────────────────────────────
   His rules, checked in code before a call is filed; the session it lives in;
   and the score, every doubt against her. */
test('a call off his rules is refused, and one on them is not', () => {
  assert.equal(callProblem('buy', 4000, 3985, 4030), null, 'a $15 stop and a $30 target is his default trade');
  assert.equal(callProblem('sell', 4000, 4020, 3970), null, 'the $20 ceiling itself is allowed');
  assert.match(callProblem('buy', 4000, 3979, 4030), /R-02/, 'a stop past $20 is filed');
  assert.match(callProblem('buy', 4000, 3990, 4020), /R-01/, 'a $20 target is filed');
  assert.match(callProblem('buy', 4000, 4010, 4030), /stop below the entry/, 'a stop on the wrong side is filed');
  assert.match(callProblem('buy', 4000, 3980, 4025), /R-08/,
    'a $25 target over a $20 stop is 1:1.25, under the 1:1.5 his sequence asks for at entry');
  assert.match(callProblem('long', 4000, 3985, 4030), /buy or sell/);
});

test('a call lives until the next 17:00 New York roll on a weekday', () => {
  const until = (iso) => expiryOf(new Date(iso)).toISOString();
  assert.equal(until('2026-10-14T13:00:00Z'), '2026-10-14T21:00:00.000Z', 'a Wednesday morning call outlives its session');
  assert.equal(until('2026-10-14T21:00:00Z'), '2026-10-15T21:00:00.000Z', 'a call at the roll belongs to the session it opens');
  assert.equal(until('2026-10-16T21:30:00Z'), '2026-10-19T21:00:00.000Z', 'a Friday evening call expires over the weekend');
  assert.equal(until('2026-10-18T21:03:00Z'), '2026-10-19T21:00:00.000Z', "Sunday's call is Monday's session");
  assert.equal(until('2026-11-02T15:00:00Z'), '2026-11-02T22:00:00.000Z', 'the roll is New York\'s 17:00 in winter too');
});

const CALL = { id: 1, made_at: '2026-10-14T13:00:00Z', expires_at: '2026-10-14T21:00:00Z', direction: 'buy',
               entry: 4000, stop: 3985, target: 4030, condition: 'a retest of 4,000', outcome: null, result: null };
const minute = (n, o) => ({ t: Date.parse('2026-10-14T13:00:00Z') + n * 60_000, open: 4010, high: 4012, low: 4008, close: 4010, ...o });
const FROM = Date.parse('2026-10-13T20:00:00Z');

test('a call is scored on price, every doubt against her', () => {
  const score = (bars, call = CALL) => scoreCall(call, bars, FROM);
  assert.equal(score([minute(1), minute(2)]).outcome, 'untriggered', 'price never came back to the entry');
  const won = score([minute(1, { low: 3999 }), minute(2, { high: 4031 })]);
  assert.deepEqual([won.outcome, won.result, won.closed_price], ['won', 30, 4030]);
  assert.deepEqual([score([minute(1, { low: 3980, high: 4031 })]).outcome, score([minute(1, { low: 3980, high: 4031 })]).result],
    ['lost', -15], 'on the bar that filled her, only the stop counts');
  assert.equal(score([minute(1, { low: 3999, high: 4031 })]).outcome, 'open',
    'the bar that filled her was read as reaching the target after the fill');
  assert.equal(score([minute(1, { low: 3999 }), minute(2, { low: 3984, high: 4031 })]).outcome, 'lost',
    'a bar touching both was read as the target first');
  assert.equal(score([minute(1, { low: 3999 }), minute(2, { high: 4021, low: 3999 }), minute(3, { low: 3999 })]).outcome,
    'scratch', 'R-04 did not move the stop to break-even after +$20');
  assert.equal(score([minute(1, { low: 3999 }), minute(2, { high: 4021, low: 3999 })]).outcome, 'open',
    'the stop moved on the same bar that reached +$20, which cannot say which came first');
  assert.equal(score([minute(1, { low: 3999, high: 4021 }), minute(2, { low: 3984 })]).outcome, 'lost',
    'the fill bar\'s high moved the stop to break-even, though it may have come before the fill');
  const open = score([minute(1, { low: 3999 }), minute(2, { close: 4010.5 })]);
  assert.deepEqual([open.outcome, open.result], ['open', 10.5], 'a call still on at the roll is marked at the last close');
  assert.equal(score([minute(1, { low: 3999 }), { ...minute(0, { high: 4031 }), t: Date.parse(CALL.expires_at) }]).outcome,
    'open', 'a bar after the roll was read into the session');
  const sell = { ...CALL, direction: 'sell', entry: 4020, stop: 4035, target: 3990 };
  assert.equal(score([minute(1, { high: 4021 }), minute(2, { low: 3989 })], sell).outcome, 'won');
});

test('a call the bars do not reach is unread, and a weekend is not a gap', () => {
  assert.equal(scoreCall({ ...CALL, made_at: '2026-10-13T13:00:00Z' }, [minute(1, { low: 3999 })], FROM).outcome,
    'unread', 'a call made before the bars begin was scored on half its session');
  const friday = { ...CALL, made_at: '2026-10-16T21:30:00Z', expires_at: '2026-10-19T21:00:00Z' };
  assert.notEqual(scoreCall(friday, [], Date.parse('2026-10-18T21:00:00Z')).outcome, 'unread',
    'the hours the market was shut were read as bars nobody served');
});

test('her calls say how they ended, what they made, and which still stands', () => {
  const now = Date.parse('2026-10-14T15:00:00Z');
  const out = callsList([
    { ...CALL, id: 3, made_at: '2026-10-14T13:00:00Z' },
    { ...CALL, id: 2, made_at: '2026-10-13T13:00:00Z', expires_at: '2026-10-13T21:00:00Z', outcome: 'lost', result: -15 },
    { ...CALL, id: 1, made_at: '2026-10-12T13:00:00Z', expires_at: '2026-10-12T21:00:00Z', outcome: 'won', result: 30 },
    { ...CALL, id: 0, made_at: '2026-10-09T13:00:00Z', expires_at: '2026-10-09T21:00:00Z', outcome: 'untriggered' },
  ], now);
  assert.match(out, /4 made; 1 won, 1 lost, 0 scratch, 0 open, 1 untriggered, 0 unread\./);
  assert.match(out, /The 2 that triggered made \+\$15\.00 an ounce/);
  assert.match(out, /Standing until the 17:00 roll: buy 4000, stop 3985, target 4030, if a retest of 4,000/,
    'the call still standing is not named, so she would make a second');
  assert.match(out, /The latest lost:\n· 13 Oct: buy 4000/);
  assert.equal(callsList([]), '');
});

test('a call is filed once a session, and a call off his rules never reaches the table', async () => {
  const posts = [];
  await stubbed(async () => {
    globalThis.fetch = async (url, opts = {}) => {
      posts.push({ url: String(url), body: opts.body });
      return new Response(null, { status: posts.length > 1 ? 409 : 201 });
    };
    assert.match(await serve('make_call', { direction: 'buy', entry: 4000, stop: 3975, target: 4030, condition: 'now' }),
      /R-02[\s\S]*Not filed/);
    assert.equal(posts.length, 0, 'a call off his rules reached the database');
    assert.match(await serve('make_call', { direction: 'buy', entry: 4000, stop: 3985, target: 4030, condition: 'at the market' }),
      /^Filed: buy 4000, stop 3985, target 4030, until 17:00 ET/);
    assert.match(await serve('make_call', { direction: 'sell', entry: 4000, stop: 4015, target: 3970, condition: 'at the market' }),
      /already made this session's call/, 'a second call in a session is filed or swallowed');
  });
  const [row] = JSON.parse(posts[0].body);
  assert.equal(Date.parse(row.expires_at), expiryOf(new Date(row.made_at)).getTime(),
    'the call is filed under a session other than the one expiryOf names');
});

/* A month of New York days, read at the pass: 22:00 on 9 October is already
   the 10th in UTC, so a UTC day would start the window a day late. */
test('her record is the last thirty New York days, newest first', () => {
  const q = recordQuery(Date.parse('2026-10-10T02:00:00Z'));
  assert.match(q, /&given_on=gte\.2026-09-09&/,
    'the window is not thirty New York days back from the pass');
  assert.match(q, /&order=id\.desc&limit=\d+$/, 'the record does not take the newest reads');
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
    { id: 1, at: '2026-01-09T13:30:00Z', name: 'core CPI', country: 'US', importance: 'high',
      consensus: '0.3%', prior: '0.2%', actual: '0.4%' },
    // The rating rides every line: the weekday slot lists only what is high.
    { id: 2, at: '2026-01-09T20:00:00Z', name: 'FOMC minutes', country: 'US', importance: 'medium',
      consensus: null, prior: null, actual: null },
  ], Date.parse('2026-01-09T13:05:00Z'));
  assert.match(out, /08:30 ET core CPI, rated high — LANDED at 0\.4%/);
  assert.match(out, /15:00 ET FOMC minutes, rated medium — due/);
  assert.doesNotMatch(out, /abroad/, 'a list of US releases is told some of it is from abroad');
  assert.equal(calendarList([]), '');
});

test('a calendar line from another day names the day, and today stays bare', () => {
  /* A day forward holds two 08:30s and twelve hours back holds last night's
     20:00, so the day must be named. Driven across yesterday evening, this
     morning and tomorrow morning, from Thursday's 08:00 briefing. */
  const row = (at, name) => ({ id: 0, at, name, country: 'US', importance: 'high',
    consensus: null, prior: null, actual: null });
  const out = calendarList([
    row('2026-09-24T00:00:00Z', 'FOMC minutes'),       // Wed 20:00 New York
    row('2026-09-24T12:30:00Z', 'jobless claims'),     // Thu 08:30
    row('2026-09-25T12:30:00Z', 'durable goods'),      // Fri 08:30
    row('2026-09-25T14:00:00Z', 'Michigan expectations'), // Fri 10:00
  ], Date.parse('2026-09-24T12:02:00Z'));
  assert.match(out, /· 08:30 ET jobless claims, rated high — due/,
    'today\'s release carries a date it does not need');
  assert.match(out, /· 08:30 ET on Friday 25 Sept? durable goods/,
    'tomorrow\'s 08:30 reads exactly like today\'s — she can brief it as due this morning');
  assert.match(out, /· 10:00 ET on Friday 25 Sept? Michigan expectations/);
  assert.match(out, /· 20:00 ET on Wednesday 23 Sept? FOMC minutes, rated high — PAST, no figure on file/,
    'last night\'s release reads as tonight\'s, due, when it has already happened');
});

test('the calendar filed at the weekday briefing reaches the next morning\'s prints', () => {
  /* The weekday briefing carries tomorrow morning's prints, so the window must
     carry the 08:00 briefing past tomorrow's 10:00 — or the 08:30 print is
     unfiled until tomorrow. Derived from the source, so narrowing the window or
     moving the briefing later fails here. */
  const src = readFileSync(
    new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const ahead = Number(src.match(/const CAL_BACK = \d+, CAL_AHEAD = (\d+);/)?.[1]);
  const hour  = Number(src.match(/hour === (\d+)\) return 'weekday'/)?.[1]);
  assert.ok(ahead > 0 && hour > 0, 'the window or the briefing hour can no longer be read');
  const LAST_MORNING_PRINT = 10;   // 10:00 New York: ISM, Michigan, JOLTS
  assert.ok(hour + ahead > 24 + LAST_MORNING_PRINT,
    `the ${hour}:00 briefing files ${ahead}h ahead, which stops before tomorrow's ` +
    `${LAST_MORNING_PRINT}:00 — the briefing names tomorrow morning off a ` +
    `calendar with nothing on it`);
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
  /* A 541-character reply came back at 852 with TRIM's own notes on top of it;
     every other trim that fortnight stayed within a tenth. The critic may add a
     link or a verdict, so its ceiling stays at twice. */
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
  /* THE SAME 64-BYTE CAP GLADYS IS BUILT AROUND: the payload is the entire state
     a tap carries. */
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

  /* A CHART ARRIVES AS BLOCKS, and concatenating against an array is
     "[object Object]" — the clock lost on the turns carrying most context. */
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
  /* EACH JOB NAMES ITS OWN FAILURE. A consolidation that dies reads as her memory
     not growing, not as a missing briefing. */
  assert.match(apologyFor('briefing'), /No briefing/);
  assert.match(apologyFor('consolidate'), /nightly/);
  assert.match(apologyFor('trade'), /position/);
  // Every job says something different, or the map is not doing anything.
  const said = Object.values(APOLOGY);
  assert.equal(new Set(said).size, said.length, 'two jobs share an apology');
  // An unnamed job still gets an answer rather than "undefined".
  assert.equal(apologyFor('something new'), APOLOGY.briefing);
});

test('the audit he asks for carries everything she keeps', () => {
  /* `/notes` IS HIS ONE WINDOW INTO ANY OF IT, answered from the database so
     nothing can paraphrase or drop a row — and all of it addressed to HIM. */
  const out = notesList(
    [{ id: 1, note: 'stop mentioning the ten-year' }],
    [{ id: 2, note: 'he trades the London open' }],
    [{ channel: 'dollar', state: 'used', evidence: null, moved_on: '2026-03-12' }],
    [{ id: 7, kind: 'watch', body: 'Gold rose on a hot print.', opened_on: '2026-03-11' }],
    { thesis: 'Still trading the December cut.', moved_on: '2026-03-12' },
    [], { portrait: 'He cuts winners before the target.', moved_on: '2026-03-12' },
    READS);

  assert.match(out, /What you have told me/);
  assert.match(out, /My reads over the last 30 days, each judged by the test I stated and never by where price went: 1 held, 4 proved wrong, 1 untested; said lightly, 1 held, 0 proved wrong, 0 untested; said firmly, 0 held, 1 proved wrong, 1 untested\./);
  assert.match(out, /The latest I got wrong:\n· 30 Jul: a hot print/);
  assert.match(out, /How I read you, last moved 12 Mar:\nHe cuts winners/);
  assert.match(out, /What I have noticed/);
  assert.match(out, /What I flagged/);
  assert.match(out, /The story I am carrying/);
  assert.match(out, /Where you stand on each channel/);
  // Written to him: her own context block opens "Where he stands", and that
  // wording reaching this message is the bug this shape exists to stop.
  assert.ok(!/where he stands/i.test(out), 'the audit addressed to him talks about him in the third person');
});

test('the audit still works before any of the newer memory exists', () => {
  // The two new arguments default, so a database without her newer tables answers
  // /notes rather than throwing on a read that returns nothing.
  const out = notesList([], [{ id: 2, note: 'he trades the London open' }],
    [{ channel: 'dollar', state: 'used', evidence: null, moved_on: null }]);
  assert.match(out, /What I have noticed/);
  assert.ok(!/The story I am carrying/.test(out));
});

/* ─── What he committed to, which she holds his trades against ──────────────
   A commitment is read the opposite way to an instruction — checked against,
   not obeyed — so it is its own kind with its own window, in both renderings.
   Driven through the real read, because which kind the block ASKS for is the
   half a rendering test cannot reach.
   ─────────────────────────────────────────────────────────────────────────── */

test('his audit shows what he committed to, between what he told her and what she noticed', () => {
  const out = notesList(
    [{ id: 1, note: 'stop mentioning the ten-year' }],
    [{ id: 2, note: 'he trades the London open' }],
    [{ channel: 'dollar', state: 'used', evidence: null, moved_on: null }],
    [], null,
    [{ id: 3, note: 'this week I stop after two losses' }]);
  assert.match(out, /What you have committed to \(1\), newest first:\n\[3\] this week I stop after two losses/);
  assert.ok(out.indexOf('[1]') < out.indexOf('[3]') && out.indexOf('[3]') < out.indexOf('[2]'),
    'a commitment is neither an instruction to her nor her observation, and ' +
    'reads between the two');

  // A memory holding only a commitment is not an empty one.
  const only = notesList([], [], [], [], null, [{ id: 3, note: 'no Friday afternoons' }]);
  assert.doesNotMatch(only, /have not kept any notes/);
});

test('the notes she is handed carry his commitments, asked for by their kind', async () => {
  await stubbed(async () => {
    globalThis.fetch = async (url) => {
      const kind = String(url).match(/kind=eq\.(\w+)/)?.[1];
      const rows = { commitment: [{ id: 9, note: 'this week I stop after two losses' }] }[kind] ?? [];
      return new Response(JSON.stringify(rows), {
        status: 200, headers: { 'content-type': 'application/json' } });
    };
    const out = await notesBlock();
    assert.match(out, /What he has committed to/,
      'notesBlock no longer reads commitments, so nothing is ever held against one');
    assert.match(out, /\[9\] this week I stop after two losses/);
  });
});

/* ─── A list that overflows says so ──────────────────────────────────────────
   The window is twenty, and without the row past it the twenty-first
   instruction leaves every prompt and /notes with nothing marking the loss.
   Driven through the real read: the
   stub answers as PostgREST does, honouring the limit it was sent. */
test('a list past the window shows the window and says the oldest are not shown', async () => {
  const live = Array.from({ length: 25 }, (_, i) => ({ id: 25 - i, note: `instruction ${25 - i}` }));
  let asked;
  await stubbed(async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (/kind=eq\.instruction/.test(u)) asked = u;
      const limit = Number(u.match(/limit=(\d+)/)?.[1] ?? Infinity);
      const rows = /kind=eq\.instruction/.test(u) ? live.slice(0, limit) : [];
      return new Response(JSON.stringify(rows), {
        status: 200, headers: { 'content-type': 'application/json' } });
    };
    const out = await notesBlock();
    assert.match(asked, new RegExp(`limit=${NOTES + 1}\\b`),
      'the read asks for exactly the window, so an overflow can never be seen');
    assert.match(out, new RegExp(`What he has told you to do \\(more than ${NOTES}, the oldest not shown\\)`),
      'an overflowing list reads like a complete one — she stops obeying the oldest unaware');
    assert.equal((out.match(/\[\d+\] instruction/g) ?? []).length, NOTES,
      'she is handed more or fewer than the window');
    assert.ok(out.includes('[25] instruction 25') && !out.includes(`[${25 - NOTES}] instruction`),
      'the window is not the newest notes');
  });

  // Under the window, the count is the count — what the nightly pass merges on.
  const under = notesList(live.slice(0, 17), [], []);
  assert.match(under, /What you have told me \(17\), newest first/);
  const over = notesList(live.slice(0, NOTES + 1), [], []);
  assert.match(over, new RegExp(`What you have told me \\(more than ${NOTES}, the oldest not shown\\)`),
    'his audit hides the overflow from him too');
});

test('a read is filed once, with a verdict the table accepts, and never without its test', async () => {
  const posts = [];
  await stubbed(async () => {
    globalThis.fetch = async (url, opts = {}) => {
      posts.push({ url: String(url), prefer: opts.headers?.Prefer, body: opts.body });
      return new Response(null, { status: 201 });
    };
    assert.match(await serve('record_read',
      { reading: 'a read', test: 'a test', verdict: 'right', evidence: 'x' }), /"right" is not a verdict/,
      'a verdict the check constraint refuses is sent, and fails as a database fault');
    assert.match(await serve('record_read',
      { reading: 'a read', test: '  ', verdict: 'held', evidence: 'x' }), /what would prove it wrong/,
      'a read with no test is filed, so a verdict on nothing enters her record');
    assert.equal(posts.length, 0, 'a refused read still reached the database');

    assert.match(await serve('record_read',
      { reading: 'a read', test: 'a test', verdict: 'held', evidence: 'x', firmness: 'loud' }),
      /"loud" is not how firmly/, 'a firmness the check constraint refuses is sent');
    assert.match(await serve('record_read',
      { reading: 'a read', test: 'a test', verdict: 'wrong', evidence: 'x', firmness: 'firm' }),
      /filed with the link you misread/, 'a miss is filed without what it teaches');
    assert.match(await serve('record_read',
      { reading: 'a read', test: 'a test', verdict: 'held', evidence: 'x', firmness: 'firm',
        lesson: 'nothing' }), /Only a read that proved wrong carries a lesson/,
      'a read that held is filed with a lesson from nothing');
    assert.equal(posts.length, 0, 'a refused read still reached the database');

    assert.equal(await serve('record_read',
      { reading: 'a hot print is bad for gold', test: 'the two-year falls', verdict: 'wrong',
        evidence: 'it fell', firmness: 'firm', lesson: 'I read the dollar as leading' }), 'Filed.');
  });
  // A retry's refiling lands on the unique index and is dropped, not doubled.
  assert.match(posts[0].url, /eugenia_reads\?on_conflict=given_on,reading$/);
  assert.match(posts[0].prefer, /resolution=ignore-duplicates/);
  const [row] = JSON.parse(posts[0].body);
  assert.equal(row.verdict, 'wrong');
  assert.equal(row.firmness, 'firm');
  assert.equal(row.lesson, 'I read the dollar as leading');
  assert.match(row.given_on, /^\d{4}-\d\d-\d\d$/, 'the read is not filed under a New York civil day');
});

test('one note can retire several, and every id it could not retire is named', async () => {
  let patched;
  await stubbed(async () => {
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (opts.method === 'POST') return new Response(JSON.stringify([{ id: 40 }]), { status: 201 });
      if (opts.method === 'PATCH') {
        patched = u;
        // Note 12 was already retired, so the filter leaves only 11.
        return new Response(JSON.stringify([{ id: 11 }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    };
    const said = await serve('remember',
      { note: 'mornings under a minute', kind: 'instruction', supersedes: [11, 12] });
    assert.match(patched, /id=in\.\(11,12\)&superseded_by=is\.null/,
      'a merge does not retire every note it names in one filtered write');
    assert.match(said, /note 12 is not there to retire/,
      'a note the merge could not retire passes as retired, and both stay in her window');
    assert.doesNotMatch(said, /\b11\b/, 'a note that was retired is reported as missed');

    // A lone id is still a retirement: the model's arguments enter here.
    const one = await serve('remember', { note: 'x', kind: 'fact', supersedes: 11 });
    assert.match(patched, /id=in\.\(11\)&/);
    assert.equal(one, 'Remembered.');
  });
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
  /* FOUR FAILURES, FOUR SENTENCES. A rejected key, a wrong URL and an
     unsupported format are not fixed by speaking more clearly, so they must not
     be told as unclear audio. */
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
   Every number below is a REAL capture from `?market=raw` and `?positions=1`.
   cTrader serves `get_spot_prices` in pipettes and `get_positions` in display
   prices, on one account and one symbol, and documents neither. A parser
   written from the docs would be a hundred thousand out on one of them and
   still produce a four-digit number that looks like gold.
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
  /* sessionClose is the previous session's close — the 17:00 New York roll — so
     the overnight move needs no second request. */
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
  /* THE LINE THE BRIEFING OPENS ON, EXECUTED. A null `prev_close` in a template
     is "null", `null >= 0` is TRUE so the word is "up", and `Math.abs(null)` is 0:
     a confident sentence, wrong in the figure he checks against his screen. */
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
  /* NaN would print as "NaN"; a null forces the caller to handle it. An empty
     answer is not a price of zero. */
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
  /* A LIVE POSITION CARRIES ITS PLAN. A closed one does not — the final stop has
     overwritten it — but an open one carries both sides, as DISPLAY prices
     beside a spot call that does not. Applying fromPipettes here would put the
     stop at four one-hundredths of a cent. */
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
   The capture is the live position, unchanged.
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
  /* EACH SIDE IS ITS OWN FIRST SIGHTING. Requiring the pair, a stop-only entry
     recorded nothing, so `planned_sl is null` was still true when a target
     appeared — by which time R-04 had moved the stop to break-even, and that was
     filed as the plan. Nothing divides by either column, so half a row is safe. */
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 4403.24 }]),
    [{ id: 'PID1', planned_sl: 4403.24, planned_tp: undefined }],
    'a stop set with no target is thrown away, and the next poll to see a ' +
    'target will file whatever R-04 has since moved the stop to');
  assert.deepEqual(openPlans([{ positionId: 1, takeProfit: 4432.1 }]),
    [{ id: 'PID1', planned_sl: undefined, planned_tp: 4432.1 }]);
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 0, takeProfit: 4432.1 }]),
    [{ id: 'PID1', planned_sl: undefined, planned_tp: 4432.1 }],
    'a zero is "not set" rather than a price, and must not survive as one');

  /* NEITHER SIDE IS STILL A POSITION. The stop history reads this list: dropped
     here, a stop and target pulled together write nothing, and the stop just
     taken off reads as still resting. */
  assert.deepEqual(openPlans([{ positionId: 1, stopLoss: 0, takeProfit: 0 }]),
    [{ id: 'PID1', planned_sl: undefined, planned_tp: undefined }],
    'a position carrying no stop and no target dropped out of the stop history');
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

test('a stop and target pulled together are recorded, through the list the poll builds', () => {
  /* DRIVEN FROM THE BROKER'S SHAPE: the defect would be upstream of stopChanges,
     in the list it is handed, and a hand-built plan cannot see it. */
  const held = [{ id: 'PID1', sl: 4000, tp: 4030 }];
  const pulled = openPlans([{ positionId: 1, stopLoss: 0, takeProfit: 0 }]);
  assert.deepEqual(stopChanges(pulled, held), [{ id: 'PID1', sl: null, tp: null }],
    'a stop and target taken off together left the old ones on file as still resting');
  // And once on file, the next poll of the same naked position writes nothing.
  assert.deepEqual(stopChanges(pulled, [{ id: 'PID1', sl: null, tp: null }, ...held]), []);
});

test('every open position with a plan is filed, not just the first', () => {
  const plans = openPlans([
    { positionId: 1, stopLoss: 4400, takeProfit: 4430 },
    { positionId: 2, stopLoss: 4200, takeProfit: 4230 },
  ]);
  assert.deepEqual(plans.map(p => p.id), ['PID1', 'PID2']);
});

/* ─── How far a trade ran, off the broker's minute bars ─────────────────────
   `?bars=raw`'s answer for 17 Sep 2026 14:00–14:15 UTC, unchanged. The trades
   are placed so the window's extreme sits in an EDGE minute, the bar the
   figure must never read.
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

test('the day\'s bars reach her in dollars, oldest first, once each, or not at all', () => {
  /* What ?bars=1 serves for scoring her calls: the same capture, folded. A
     duplicate is two chunks meeting at an edge; an unreadable bar refuses the
     lot, since the one dropped could hold the stop. */
  const candles = foldCandles([...BARS].reverse().concat(BARS[0]));
  assert.equal(candles.length, 16, 'a bar two chunks both returned is counted twice');
  assert.deepEqual(candles[0], { t: 1789653600000, open: 4367.57, high: 4368.54, low: 4364.48, close: 4365.48 },
    'the first minute is not read in dollars, or not first');
  assert.ok(candles.every((c, i) => !i || c.t > candles[i - 1].t), 'the bars are not oldest first');
  assert.equal(Math.max(...candles.map(c => c.high)), 4380.14);
  assert.equal(foldCandles([...BARS, { ...BARS[3], close: null }]), null,
    'a bar that will not read is dropped and the rest served, short by the one that mattered');
});

test('the minute he entered in and the minute he left in are never read', () => {
  /* A bar holds a whole minute and he was in for part of it, so an edge bar can
     carry a spike from before the fill or after the close. The lowest low is
     14:00's, the minute a 14:00:30 entry landed in; the highest high is 14:09's.
     Each trade must come back short of its edge bar, not past it. */
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

  /* THE POPULATION IS LOSSES BEYOND THE SCRATCH BAND: a break-even exit is R-04
     having fired and a win says nothing about the stop. */
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
   WHICH SESSION THE QUOTE IS DESCRIBING
   ───────────────────────────────────────────────────────────────────────────
   `high`, `low`, `prev_close` and `change` are measured from the broker's
   session open, the 17:00 New York roll. Before it `change` is the overnight
   move; after it, the evening's — and a bare number cannot tell them apart.
   Driven from both sides of the roll and of the daylight-saving change, since
   the boundary is 17:00 in New York, not a fixed UTC hour.
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
  // 20:57 New York: the window is under four hours old, and the label stops the
  // figure inside it being called the move on the day.
  const said = quoteWindow(new Date('2026-09-04T00:57:00Z'));
  assert.match(said, /THIS EVENING/);
  assert.match(said, /none of it is the calendar day/);
  assert.match(said, /NOT the move on the day/);
  assert.doesNotMatch(said, /overnight move/);
});

test('the roll is 17:00 in New York, in winter as well as in summer', () => {
  /* 22:00 UTC is 18:00 New York in September and 17:00 in January — one past the
     roll, and both past a boundary written as 22. */
  assert.match(quoteWindow(new Date('2026-09-03T20:59:00Z')), /YESTERDAY/); // 16:59 ET
  assert.match(quoteWindow(new Date('2026-09-03T21:01:00Z')), /THIS EVENING/); // 17:01 ET
  assert.match(quoteWindow(new Date('2026-01-14T21:59:00Z')), /YESTERDAY/); // 16:59 ET
  assert.match(quoteWindow(new Date('2026-01-14T22:01:00Z')), /THIS EVENING/); // 17:01 ET
});

test('the roll hour is the one the market hours are already kept on', () => {
  // marketOpen shuts Friday and opens Sunday at this same hour: one boundary,
  // not two that happen to agree.
  assert.equal(ROLL_HOUR, 17);
  assert.equal(marketOpen(new Date('2026-09-04T20:59:00Z')), true);  // Fri 16:59 ET
  assert.equal(marketOpen(new Date('2026-09-04T21:01:00Z')), false); // Fri 17:01 ET
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE VENDOR'S ANSWER, FOLDED
   ───────────────────────────────────────────────────────────────────────────
   A vector filed against the wrong row does not error, log or look wrong — it
   surfaces months later as her seeming to misremember. So ordering, count and
   width are decided in a pure function and driven here.
   ═══════════════════════════════════════════════════════════════════════════ */
const vec = (fill) => Array(EMBED_DIMS).fill(fill);

test('the vectors come back in the order they were asked for', () => {
  /* THE RESPONSE CARRIES THE INDEX OF THE INPUT IT ANSWERS. Taken in arrival
     order, turn A gets turn B's meaning and both rows look healthy. */
  const out = foldVectors([
    { index: 1, embedding: vec(0.2) },
    { index: 0, embedding: vec(0.1) },
  ], 2);
  assert.equal(out[0], `[${vec(0.1).join(',')}]`);
  assert.equal(out[1], `[${vec(0.2).join(',')}]`);
});

test('a vector is pgvector text, not a JSON array', () => {
  // The same string goes into the column and the query: the form that crosses a
  // JSON body into a `vector` without needing a cast from json.
  const [only] = foldVectors([{ index: 0, embedding: vec(0.5) }], 1);
  assert.ok(only.startsWith('[') && only.endsWith(']'));
  assert.equal(only.split(',').length, EMBED_DIMS);
});

test('a batch that comes back wrong is refused whole', () => {
  /* ALL OR NOTHING: a short answer cannot say WHICH row lost its vector, and
     writing the rest would pair the tail with the wrong rows. */
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
   Every path, whatever channel he used — the briefing he wanted read to him
   included. There is no length past which a message goes unspoken: a long one
   is several voice notes, and the text is the fallback when the audio did not
   land.
   ═══════════════════════════════════════════════════════════════════════════ */

test('a speech vendor that cannot answer still leaves him the message', async () => {
  /* THE ONE PROPERTY A SOURCE READ CANNOT SETTLE: no path leaves him with
     nothing. An unset key, a refusing vendor and an unrenderable format would
     otherwise make audio-only a MISSING message. With no TTS key `speak` answers
     false without a request — the shape of a vendor that refused — so this
     replays the real sequence: every part fails, and the text must still go. */
  const sent = [];
  await stubbed(async () => {
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    await sayAloud('Gold is holding 4,410 into the close.');
  });

  const texts = sent.filter(r => r.url.includes('sendMessage'));
  assert.equal(texts.length, 1,
    'no text went out when the audio could not be made, so a speech vendor ' +
    'having a bad morning is a briefing he never receives');
  assert.equal(texts[0].body.text, 'Gold is holding 4,410 into the close.',
    'the fallback sent something other than the message itself');
});

test('a speech vendor that never answers still leaves him the message, in time', async () => {
  /* A VENDOR THAT NEVER ANSWERS, which no catch sees: the worker is shut down at
     its wall clock with the request still open, and nothing falls back. This
     needs a key, so a fresh instance of the module is loaded with one (TTS_KEY
     is read at load). The stub hangs until aborted, and the budget is passed
     short so the test does not wait out SPEAK_MS. */
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
  /* RACED AGAINST A DEADLINE OF ITS OWN: the regression is a wait with no end,
     which must fail rather than hang the suite. AbortSignal.timeout's timer is
     unref'd, so this timer stands in for the open socket a real request holds. */
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
  /* THE SECOND ATTEMPT turns a vendor's bad minute into a voice note rather than
     text. A refusal that answers at once needs no clock; the stall is the budget
     test's to hold. */
  const realDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: (k) => (k === 'TTS_KEY' ? 'sk-test' : undefined) } };
  const fresh = await import('../supabase/functions/doji-eugenia/index.ts?retry');
  delete globalThis.Deno;
  if (realDeno) globalThis.Deno = realDeno;

  let asked = 0;
  const sent = [];
  const heard = await stubbed(async () => {
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
    return await fresh.sayAloud('Gold is holding 4,410 into the close.');
  });
  assert.equal(asked, 2, 'a part that failed once was not asked for again');
  assert.equal(heard, true, 'the second attempt landed and the voice is reported as not heard');
  assert.equal(sent.filter(u => u.includes('sendVoice')).length, 1);
  assert.equal(sent.filter(u => u.includes('sendMessage')).length, 0,
    'the text went as well as the voice that landed — two bubbles for one message');
});

/* THE BRIEFING'S SECOND WORKER, through the real sequence: the marker, its text
   paired by the instant both were written, the send, and the delivered row
   after it. The stub answers a read only when its filter matches a correct
   one, or a pairing that reads the wrong row would pass. */
test('the speaking worker sends today\'s stored briefing and only then says it was delivered', async () => {
  // Now rather than a minute back: a minute back is yesterday in the first
  // minute of a New York day, and the worker speaks today's briefing only.
  const stamp = new Date().toISOString().replace('Z', '+00:00');
  const steps = [];
  await stubbed(async () => {
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
    const res = await postSpeak('weekday');
    assert.equal((await res.json()).heard, false, 'with no voice key the text went, and it reads as heard');
  });
  assert.deepEqual(steps, ['marker', 'text', 'sent:Buenos días. Payrolls lands at 08:30.',
                           'row:weekday briefing delivered'],
    'the speaking worker did not find, pair, send and then record, in that order');
});

test('the speaking worker refuses a briefing that is not today\'s, and a door that names no briefing', async () => {
  await stubbed(async () => {
    globalThis.fetch = async () => Response.json([{ created_at: '2026-09-30T12:02:23.4243+00:00' }]);
    await assert.rejects(postSpeak('weekday'), /no weekday briefing is stored for/,
      "yesterday's briefing would arrive as this morning's");
    await assert.rejects(postSpeak('consolidate'), /no such briefing to speak: consolidate/);
  });
});

test('nothing she writes is left unspoken for being long', () => {
  /* NO CAP: a long message becomes SEVERAL voice notes, as it becomes several
     text messages. Driven through `chunk` at the speech limit, because every
     character coming back is the property. */
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
  // 250–400 words is ~2,800 characters, one request; split, the teaching block
  // would be cut across two notes.
  assert.equal(chunk('x'.repeat(2800), 4000).length, 1);
});

test('there is nothing to speak when there is nothing to say', () => {
  // A zero-length voice note renders as a broken attachment; chunk() returns no
  // parts for an empty string, so nothing is spoken.
  assert.deepEqual(chunk('', 4000), []);
});

/* ─── What he has on, rendered ───────────────────────────────────────────────
   Every field is nullable and most are null on a hand-opened row, so the
   failure is a block that renders the word `null` where a price goes.
   ─────────────────────────────────────────────────────────────────────────── */
const DESK_NOW = Date.parse('2026-09-03T14:20:00Z');
const OPEN = trade({
  id: 'PID9', direction: 'BUY', entry_time: '2026-09-03T13:14:00Z',
  entry_price: 4388.2, size_oz: 4, open_day: '2026-09-03',
  planned_sl: 4380, planned_tp: 4412,
});

/* ─── What counts as open: both columns null ─────────────────────────────────
   `fill_time` is written by the email, and by the poller only for closes its
   fold window reaches; `exit_price` is the poller's off the broker's deals. A
   close either missed still has the other, so open is BOTH null — two
   witnesses, either sufficient. Getting it wrong has her citing R-19 and R-15
   at him over a position long gone. `positionsList` renders what it is handed,
   so the predicate is exported and driven here.
   ─────────────────────────────────────────────────────────────────────────── */
test('a position the poller closed is closed, whether or not the email landed', () => {
  const open = trade({ id: 'PID9', entry_time: '2026-09-02T13:14:00Z' });
  assert.equal(isOpen(open), true, 'neither witness has closed this one');

  // The reported bug: closed on the broker's deals, no email, `fill_time` null.
  assert.equal(isOpen({ ...open, exit_price: 4402.7 }), false,
    'the poller folded a closing deal for this position — it is not open, and ' +
    'saying it is cites his rules at him about a trade he does not have');

  // And the other witness alone: a row folded without its entry deal carries a
  // null exit_price on a closed trade, and the email catches that one.
  assert.equal(isOpen({ ...open, fill_time: '2026-09-02T18:00:00Z' }), false);
  assert.equal(isOpen({ ...open, exit_price: 4402.7, fill_time: '2026-09-02T18:00:00Z' }), false);
});

test('a pre-sync row is not an open position, however long it sits there', () => {
  /* Rows whose id does not start with PID pre-date the broker sync and carry
     neither column; they are not open. */
  assert.equal(isOpen(trade({ id: '2025-11-03-a' })), false);
  assert.equal(isOpen(trade({ id: 'PID1' })), true);
});

test('a flat day with nothing traded is no block at all', () => {
  assert.equal(positionsList([], null, DESK_NOW), '');
});

test('an open position states its age, its side, its size and its plan', () => {
  const out = positionsList([OPEN], null, DESK_NOW);
  assert.match(out, /open since 09:14 ET/);
  assert.match(out, /BUY 4oz from 4388\.2/);
  assert.match(out, /stop 4380 and target 4412 as first seen/);
});

/* ─── A hold from another day names the day ──────────────────────────────────
   Under "what he has on RIGHT NOW", `open since 09:15 ET` reads as this
   morning. His positions run intraday to multi-session and R-15 bounds a hold
   at the Friday close, so this is a shape he trades.
   ─────────────────────────────────────────────────────────────────────────── */
test('a position opened on an earlier day says which day', () => {
  // Opened 09:14 New York on the 1st, still open on the 3rd.
  const held = trade({ ...OPEN, entry_time: '2026-09-01T13:14:00Z', open_day: '2026-09-01' });
  const out = positionsList([held], null, DESK_NOW);
  assert.match(out, /open since 09:14 ET on 1 Sep/,
    'a multi-session hold that names only an hour reads as having opened today');
});

test("a position opened today says the hour and no date", () => {
  // The other direction, because dating every fill would bury the one line
  // where the date is the point.
  const out = positionsList([OPEN], null, DESK_NOW);
  assert.match(out, /open since 09:14 ET —/);
  assert.doesNotMatch(out, /on \d+ Sep/);
});

test('a position with no plan recorded says nothing about a plan', () => {
  const out = positionsList([trade({ ...OPEN, planned_sl: null, planned_tp: null })],
                            null, DESK_NOW);
  assert.match(out, /BUY 4oz from 4388\.2/);
  assert.doesNotMatch(out, /stop|target/);
});

/* HALF A PLAN IS NOT A PLAN. Each side is its own first sighting and a hand
   correction sets whichever it sets, so the columns are independent; rendering
   the pair from either puts "target null" in front of her. Only a row carrying
   exactly one column tells `&&` from `||`. */
test('a row carrying one half of the plan shows that half and never the absence', () => {
  /* The half that exists is said; the half that does not is never named: a null
     is equally "he set none" and "the poller never saw this position open". */
  const stopOnly = positionsList([trade({ ...OPEN, planned_tp: null })], null, DESK_NOW);
  assert.doesNotMatch(stopOnly, /null/, `renders a null: ${stopOnly}`);
  assert.match(stopOnly, /stop 4380 as first seen/, 'the stop it has is dropped');
  assert.doesNotMatch(stopOnly, /target/, 'a target it does not have is named');

  const targetOnly = positionsList([trade({ ...OPEN, planned_sl: null })], null, DESK_NOW);
  assert.doesNotMatch(targetOnly, /null/, `renders a null: ${targetOnly}`);
  assert.match(targetOnly, /target 4412 as first seen/, 'the target it has is dropped');
  assert.doesNotMatch(targetOnly, /stop/, 'a stop it does not have is named');

  const neither = positionsList(
    [trade({ ...OPEN, planned_sl: null, planned_tp: null })], null, DESK_NOW);
  assert.doesNotMatch(neither, /stop|target|null/,
    'a row the poller never saw open claims a plan');
});

test('a hand-opened row with no side, size or price prints no nulls', () => {
  const out = positionsList([trade({
    id: 'legacy-1', direction: null, entry_time: null,
    entry_price: null, size_oz: null,
  })], null, DESK_NOW);
  assert.doesNotMatch(out, /null|undefined|NaN/);
  assert.match(out, /side and size not recorded/);
});

test('a flat day with trades behind it states where the day stands', () => {
  const standing = { day: '2026-09-03', pnl: -182.4, account: 2000, breached: false };
  assert.match(positionsList([], standing, DESK_NOW), /his day so far: -182\.40/);
});

test('a day inside the limit and a day past it are not rendered the same', () => {
  const inside = positionsList([], { day: 'd', pnl: -50, account: 2000, breached: false }, DESK_NOW);
  const past   = positionsList([], { day: 'd', pnl: -90, account: 2000, breached: true }, DESK_NOW);
  assert.match(inside, /inside the 4% R-11 sets/);
  assert.match(past, /PAST the 4% R-11 sets/);
  assert.doesNotMatch(inside, /PAST/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE JOURNAL SUMMARISED — the app's arithmetic, driven from both sides
   ───────────────────────────────────────────────────────────────────────────
   The three definitions the app is subtle about are each driven against the
   case that separates them from the plausible alternative — a test that only
   saw a win rate come back would pass every wrong one.
   ═══════════════════════════════════════════════════════════════════════════ */
const jt = (o) => trade({ id: 'PID1', ...o });

test('a scratch is measured in price, not in dollars', () => {
  /* ±$3 OF THE ENTRY PRICE AT ANY SIZE. The case a P&L band gets wrong is a big
     position that went nowhere: $2 of price, $200 of P&L. */
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
  /* A rate that drops scratches is HIGHER than the truth, highest on a trader who
     scratches a lot. One win and one scratch is 50%. */
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
  /* THE ONE PLACE THE TWO MUST DIFFER: a positive scratch's dollars are on
     money()'s gross side, so gross − loss equals net, while averages() keeps it
     out of the average win. */
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
  /* The overlaps are the more specific case, and the dead stretch between the New
     York close and the Sydney open folds into Asian. */
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
  /* A RATE WITHOUT ITS DENOMINATOR is the number §8 warns about, so the counts
     ride beside every share. Driven end to end: what she READS is the decision. */
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
  // His answers over the trades that answered, the blanks said apart: two of
  // the three never answered, and a blank is not a miss.
  assert.match(out, /rules followed on 1 of 1 answered \(2 unanswered\)/);
  assert.match(out, /stop respected on 1 of 1 answered \(2 unanswered\)/);

  // An empty window says so rather than rendering a page of dashes.
  assert.match(statsList(journalStats([]), 7), /No trades in the last 7 days/);
});

/* ─── The one signal a total cannot carry ────────────────────────────────────
   `pnl` is `coalesce(net_pnl, computed_pnl)`, and §8 serves `net_pnl` beside it
   so a fallback row is VISIBLE. A total cannot show that, and this is the tool
   she is told to prefer over the rows — so it says what was settled.
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
   `sessionOf` drops to the closing fill when a row has no entry_time, so a hold
   across a session boundary is filed under the wrong one. The count travels
   with the split on `fellBack`'s terms: only where there is one.
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
  /* Swap accrues only across the 17:00 roll, so the common window is all settled
     or intraday, and a line saying zero every time would be noise. */
  const out = statsList(journalStats([
    jt({ id: 'PIDa', entry_price: 4400, exit_price: 4460, pnl: 60, net_pnl: 60 }),
  ]), 30);
  assert.doesNotMatch(out, /fell back/);
  assert.match(out, /net \$60\.00/, 'the total is still there');
});

/* ─── Nothing the tool loop serves may throw, driven rather than read ────────
   The database refuses four ways: no network, a 500, a 404 (an unapplied
   migration) and a 200 that is not JSON. Every tool must come back with a
   sentence in all four — and a missing `tool_result` is a 400, so an empty
   answer is as fatal as a thrown one.
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
  ['get_structure', {}],
  ['set_thesis',    { thesis: 'a reading' }],
  ['set_portrait',  { portrait: 'a reading of him' }],
  ['open_loop',     { kind: 'question', body: 'a question' }],
  ['close_loop',    { id: 1, resolution: 'answered' }],
  ['record_read',   { reading: 'a read', test: 'the two-year falls', verdict: 'untested', evidence: 'no close',
                      firmness: 'light' }],
  ['make_call',     { direction: 'buy', entry: 4000, stop: 3985, target: 4030, condition: 'at the market' }],
];

/* AND THE LIST IS HELD AGAINST THE SWITCH: a tool added to `serve` and not
   above would be undriven, and this would go on passing. Names resolve through
   the `*_TOOL` constants, because a case label names the constant and the
   constant carries the string the model sends. */
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

// One test rather than four generated ones: the suite's count is read off
// `test(` declarations, and a test made in a loop is invisible to it.
test('every tool answers with a sentence however the database refuses', async () => {
  await stubbed(async () => {
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
  });
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
   The blocks are what she is HANDED, each built from a read, and a failed read
   costs that block and nothing else. `notesBlock` is the one to watch: an
   instruction he gave lives only in a note, and it is on all four paths. If
   it throws, every message dies; if it degrades, one thing is forgotten.
   ─────────────────────────────────────────────────────────────────────────── */

const BLOCKS = {
  marketBlock, notesBlock, channelsBlock, tradesBlock, breachesBlock, thesisBlock, portraitBlock,
  recordBlock, healthBlock, loopsBlock, calendarBlock, weekBlock, positionsBlock,
};

test('every block degrades to nothing when its read fails, and never throws', async () => {
  await stubbed(async () => {
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
  });
});

/* AND THE OTHER HALF: a block swallowing its content along with its failure is
   silent the same way as one with nothing to say. Driven against a database
   that ANSWERS, each must say something — or `return ""` passes everything. */
test('every block says something when its read succeeds', async () => {
  const rows = {
    eugenia_notes:    [{ id: 1, note: 'he asked for shorter mornings' }],
    eugenia_channels: [{ channel: 'rates', state: 'explained', moved_on: '2026-07-01' }],
    eugenia_thesis:   [{ thesis: 'gold heavy above 3450', moved_on: '2026-07-30' }],
    eugenia_portrait: [{ portrait: 'he cuts winners before the target', moved_on: '2026-07-30' }],
    eugenia_reads:    [{ given_on: '2026-07-29', reading: 'a hot print is bad for gold',
                         test: 'the two-year falls on it', verdict: 'held', evidence: 'it rose' }],
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
  await stubbed(async () => {
    globalThis.fetch = async (url) => {
      const table = String(url).match(/rest\/v1\/(\w+)/)?.[1];
      return new Response(JSON.stringify(rows[table] ?? []), {
        status: 200, headers: { 'content-type': 'application/json' } });
    };
    for (const name of ['notesBlock', 'channelsBlock', 'thesisBlock', 'portraitBlock', 'recordBlock',
                        'loopsBlock', 'calendarBlock']) {
      const out = await BLOCKS[name]();
      assert.ok(out.trim().length > 0,
        `${name} read its rows and said nothing — a block that returns "" on success ` +
        `is indistinguishable from one whose read failed, and passes every test that ` +
        `only asks whether it threw`);
    }
  });
});

/* ─── What broke since the last briefing ─────────────────────────────────────
   Driven through the real block, because the window is the decision. Friday is
   the case it exists for: on a Monday, "yesterday" was Sunday. */
const closed = (id, open_day, entry_time, fill_time, extra = {}) => trade({
  id, open_day, entry_time, fill_time, entry_price: 3400, exit_price: 3395,
  pnl: -10, net_pnl: -10, ...extra,
});

/* ─── The week the Sunday briefing opens ─────────────────────────────────────
   From Sunday 17:00 New York: whether Friday's payrolls reaches her, with its
   day named. */
test('the Sunday briefing is handed the week ahead, high releases only, each with its day', async () => {
  const sunday = Date.parse('2026-09-27T21:00:00Z');
  const q = weekQuery(sunday);
  assert.match(q, /importance=eq\.high/, 'the week reads every importance, which is most of a page');
  assert.match(q, /at=gte\.2026-09-27T21:00:00\.000Z/, 'the week does not start now');
  assert.match(q, /at=lte\.2026-10-04T21:00:00\.000Z/, 'the week does not reach the next Sunday, so Friday is cut off');
  assert.match(q, /order=at\.asc/, 'the week is not in the order it happens');

  const rows = [
    { id: 1, at: '2026-09-30T12:15:00Z', name: 'ADP Nonfarm Employment Change (Sep)', country: 'US', importance: 'high',
      consensus: '50K', prior: '54K', actual: null },
    { id: 2, at: '2026-10-02T12:30:00Z', name: 'Nonfarm Payrolls (Sep)', country: 'US', importance: 'high',
      consensus: '45K', prior: '22K', actual: null },
  ];
  let asked = '';
  await stubbed(async () => {
    globalThis.fetch = async (url) => {
      asked = String(url);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const out = await weekBlock(sunday);
    assert.match(asked, /eugenia_calendar\?/, 'the week is not read from her calendar');
    assert.match(out, /The week ahead/, 'the week arrives under the rolling calendar\'s heading');
    assert.match(out, /Nonfarm Payrolls \(Sep\)[^\n]*due, 45K expected/, 'Friday\'s payrolls does not reach the Sunday briefing');
    assert.match(out, / on Friday 2 Oct Nonfarm Payrolls/, 'a release later in the week does not name its day');
  });
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
  assert.match(breachesList([r('R-01', 'pass'), r('R-04', 'unknown')]), /No closed trade since your last briefing broke/,
    'a window with nothing broken says nothing, and she is left to work it out from the rows');
  const out = breachesList([r('R-01', 'pass'), r('R-12', 'fail', ['PID9']), r('R-04', 'unknown')]);
  assert.match(out, /R-12: FAIL/, 'a broken rule is not named');
  assert.match(out, /PID9/, 'the trade that broke it is not named, so he cannot check it');
  assert.doesNotMatch(out, /R-01|R-04/, 'a rule that did not break is in the list of breaches');
});

test('the briefing is handed what Friday broke on Sunday, and what the weekend hold broke on Monday', async () => {
  const friday = [
    closed('PID11', '2026-09-25', '2026-09-25T12:40:00Z', '2026-09-25T12:50:00Z'),
    closed('PID12', '2026-09-25', '2026-09-25T13:40:00Z', '2026-09-25T13:50:00Z'),
    closed('PID13', '2026-09-25', '2026-09-25T15:40:00Z', '2026-09-25T15:50:00Z'),
  ];
  const held = closed('PID14', '2026-09-25', '2026-09-25T19:00:00Z', '2026-09-28T11:00:00Z');
  const serve = (marker, trades) => async (url) => {
    const table = String(url).match(/rest\/v1\/(\w+)/)?.[1];
    const body = table === 'eugenia_turns' ? [{ created_at: marker }]
               : table === 'eugenia_trades' ? trades : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await stubbed(async () => {
    globalThis.fetch = serve('2026-09-25T12:00:00Z', friday);   // Friday's 08:00 briefing
    const sunday = await breachesBlock();
    assert.match(sunday, /R-12: FAIL/, 'three entries on Friday never reach Sunday\'s briefing');
    assert.match(sunday, /R-12: FAIL[^\n]*2026-09-25/, 'the day that broke R-12 is not named, so he cannot check it');

    globalThis.fetch = serve('2026-09-27T21:00:00Z', [...friday, held]);   // Sunday's 17:00 briefing
    const monday = await breachesBlock();
    assert.match(monday, /R-15: FAIL/, 'a hold across the Friday close never reaches a briefing');
    assert.doesNotMatch(monday, /R-12/, 'Monday judges Friday\'s entries a second time');
  });
});

/* ─── A calendar read that reached its bound says so ─────────────────────────
   Earliest first, so a heavy day loses tomorrow's rows. Cut silently, the last
   line looks like the last thing due, and "nothing else today" becomes a
   sentence she can write. */

test('a full calendar read says it stopped, and a short one says nothing', async () => {
  const at = (i) => new Date(Date.now() + (i + 1) * 60_000).toISOString();
  const rows = (n) => Array.from({ length: n }, (_, i) =>
    ({ id: i, at: at(i), name: `release ${i}`, country: 'US', importance: 'medium',
       consensus: null, prior: null, actual: null }));
  const block = (n) => stubbed(async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => rows(n) });
    return await calendarBlock();
  });
  assert.match(await block(40), /The list stops at 40 entries/);
  assert.doesNotMatch(await block(39), /stops at/);
});

/* ─── The trade look speaks on a close alone ─────────────────────────────────
   A print pending beside an open is R-20's, his to weigh. Any event but a close
   — a person at the door can send one — returns before any read, driven here
   with a print pending, the case in which it would most want to speak.
   ─────────────────────────────────────────────────────────────────────────── */
test('an opened event reads nothing and says nothing; a close past the limit reaches the model', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const row = (o) => ({ id: 'PID9', direction: 'BUY', entry_time: new Date().toISOString(),
    fill_time: null, entry_price: 4000, exit_price: null, pnl: null, open_day: today,
    setup: null, followed_rules: null, followed_sl: null, followed_tp: null, size_oz: 4,
    net_pnl: null, planned_sl: null, planned_tp: null, best_price: null, ...o });
  const pending = [{ id: 1, at: new Date(Date.now() + 3600_000).toISOString(), name: 'US CPI',
    importance: 'high', consensus: '0.3%', prior: null, actual: null }];

  const run = (trade, event) => {
    const asked = [];
    return withFetch(async (url) => {
      asked.push(String(url));
      if (String(url).includes('eugenia_trades')) return new Response(JSON.stringify([trade]), { status: 200 });
      if (String(url).includes('eugenia_calendar')) return new Response(JSON.stringify(pending), { status: 200 });
      // The model, answering with the silence the prompt allows.
      if (String(url).includes('anthropic')) return new Response(JSON.stringify(
        { content: [{ type: 'text', text: 'NOTHING' }], stop_reason: 'end_turn', usage: {} }), { status: 200 });
      return new Response('[]', { status: 200 });
    }, async () => ({ said: await (await postTradeEvent('PID9', event)).json(), asked }));
  };

  const opened = await run(row(), 'opened');
  assert.equal(opened.said.skipped, 'not a close');
  assert.deepEqual(opened.asked, [],
    'an opened event read the journal, the calendar or the model — every open is a message again');

  // The other side: a close that took the day past −4% of the 2,000 its size
  // implies gets past every guard to the model — the guard must not swallow it.
  const closed = await run(row({ exit_price: 3980, fill_time: new Date().toISOString(), pnl: -90, net_pnl: -90 }),
                           'closed');
  assert.ok(closed.asked.some(u => u.includes('anthropic')),
    'a close past the day\'s limit never reached the model');
  assert.equal(closed.said.said, 'quiet');
});

/* ─── A trades read that reached its bound ───────────────────────────────────
   A year with more than TRADE_ROWS trades is cut at its oldest end. Driven
   through serve() for all three tools, because each caller appends the line.
   ─────────────────────────────────────────────────────────────────────────── */
test('a trades read that hit its bound says how far back it reaches, in every tool built on it', async () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({
    id: `PID${i}`, direction: 'BUY', entry_time: '2026-06-01T14:00:00Z', fill_time: '2026-06-01T14:30:00Z',
    entry_price: 4000, exit_price: 4010, pnl: 40, net_pnl: 40, setup: null, followed_rules: null,
    followed_sl: null, followed_tp: null, size_oz: 4, planned_sl: null, planned_tp: null, best_price: null,
    // Newest first, as the query orders them, so the last row is the oldest day read.
    open_day: i === n - 1 ? '2026-02-10' : '2026-06-01',
  }));
  const ask = (n, tool) => withFetch(async (url) =>
    new Response(JSON.stringify(String(url).includes('eugenia_trades') ? rows(n) : []), { status: 200 }),
    () => serve(tool, { days: 365 }));

  for (const tool of ['get_trades', 'get_stats', 'check_rules']) {
    assert.match(await ask(TRADE_ROWS, tool), /reaches back only to 2026-02-10, not the whole 365 days/,
      `${tool} answered a read cut at its bound as though it covered the whole window`);
    assert.doesNotMatch(await ask(TRADE_ROWS - 1, tool), /stops at its/,
      `${tool} called a read short of its bound truncated, which is every ordinary window`);
  }
});

/* ─── The behaviour eval, offline ────────────────────────────────────────────
   scripts/eval.mjs spends money and is run by hand, so nothing in it is ever
   proved by running it here. What can be is: every case is well formed, the
   counters catch what they are named for, each path builds the request its
   call site builds, every planted defect changes a prompt, and a grade that
   should fail does — driven through a stubbed model. */
const EVAL = await import('../scripts/eval.mjs');

test('every eval case names a path, carries what that path needs, and checks something', () => {
  const ids = EVAL.CASES.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'two eval cases share an id');
  assert.ok(EVAL.CASES.length >= 12, `only ${EVAL.CASES.length} eval cases`);
  const needs = { reply: 'asked', critic: 'draft', trim: 'draft', trade: 'situation', review: 'context' };
  for (const c of EVAL.CASES) {
    assert.ok(EVAL.PATHS[c.path], `${c.id} names a path the eval does not build: ${c.path}`);
    assert.ok(c[needs[c.path]], `${c.id} is a ${c.path} case with no ${needs[c.path]}`);
    assert.ok(c.why, `${c.id} says nothing about why it is a case`);
    for (const name of Object.keys(c.counts ?? {})) {
      assert.ok(EVAL.COUNTERS[name], `${c.id} counts ${name}, which no counter is`);
    }
    for (const re of [...(c.must ?? []), ...(c.mustNot ?? [])]) new RegExp(re, 'i');
    if (c.strategy) assert.ok(SECTIONS[c.strategy], `${c.id} is handed §${c.strategy}, which the strategy does not hold`);
    assert.ok(Object.keys(c.counts ?? {}).length || c.must || c.mustNot || c.equals || c.judge?.length,
      `${c.id} checks nothing, so it passes whatever she writes`);
  }
});

test('the eval counts what the gates are told to count', () => {
  const c = (counts) => ({ counts });
  assert.deepEqual(EVAL.counted(c({ emDash: true }), 'Plain. Words.'), []);
  assert.match(EVAL.counted(c({ emDash: true }), 'The dollar — firm — rose.')[0], /em-dash/);
  const five = 'One. Two. Three. Four. Five.';
  assert.match(EVAL.counted(c({ sentences: 4 }), five)[0], /5 sentences/);
  assert.deepEqual(EVAL.counted(c({ sentences: 4 }), 'One. Two.\n\nThree. Four.'), []);
  assert.deepEqual(EVAL.counted(c({ sentences: 4 }),
    'One.\n\nToday: 08:30 ET CPI. 10:00 ET claims. 11:00 ET an auction. 13:00 ET a speech. 14:00 ET minutes.\n' +
    '- 08:30 ET CPI. Hot. Cold. Warm. Done.'), [],
    'a calendar list was counted as a paragraph of prose');
  assert.match(EVAL.counted(c({ questions: 1 }), 'Why? And when?')[0], /2 questions/);
  assert.match(EVAL.counted(c({ words: 3 }), 'one two three four')[0], /4 words/);
  assert.match(EVAL.counted({ mustNot: ['\\bcut\\b'] }, 'a cut is priced')[0], /has \/\\bcut\\b\//);
  assert.match(EVAL.counted({ must: ['4,?002'] }, 'buy at 4,003')[0], /missing/);
  assert.match(EVAL.counted({}, '<invoke name="get_market">\n</invoke>')[0], /reached for get_market/,
    'a tool she reached for was graded as her message');
});

test('each eval path asks what its call site asks, of the model it runs on', () => {
  const fn = readFileSync(new URL('../supabase/functions/doji-eugenia/index.ts', import.meta.url), 'utf8');
  const [opus, sonnet] = ['OPUS', 'SONNET'].map(k => fn.match(new RegExp(`const ${k} = "([^"]+)"`))[1]);
  const at = (path, extra = {}) => EVAL.request({ path, context: '', asked: 'q', draft: 'D', situation: 'S', ...extra });
  assert.equal(at('trim').model, sonnet, 'TRIM runs on Sonnet in the function and on something else here');
  for (const path of ['reply', 'critic', 'trade', 'review']) {
    assert.equal(at(path).model, opus, `the ${path} runs on Opus in the function and on something else here`);
  }
  assert.match(at('critic').messages[0].content, /THE BRIEFING:\n\nD$/);
  assert.match(at('trim').messages[0].content, /THE MESSAGE:\n\nD$/);
  assert.ok(at('trade').messages[0].content.startsWith(EVAL.PROMPTS.TRADE_EVENT));
  assert.ok(at('review').messages[0].content.startsWith(EVAL.PROMPTS.REVIEW));
  assert.match(fn, /`\$\{REVIEW\}\\n\\nHis week, computed from the rows:/,
    'postReview no longer opens on REVIEW, so the eval\'s review asks something else');
  assert.ok(at('reply').system[0].text.startsWith(EVAL.PROMPTS.SYSTEM), 'the eval asks under a different system prompt');
  // The gates' markers are the function's own.
  assert.match(fn, /\\n\\nTHE BRIEFING:\\n\\n\$\{draft\}/);
  assert.match(fn, /\\n\\nTHE MESSAGE:\\n\\n\$\{draft\}/);
});

test('every planted defect breaks a prompt and names a case that exists', () => {
  for (const plant of EVAL.PLANTS) {
    const broken = plant.breaks(EVAL.PROMPTS);
    assert.ok(Object.keys(EVAL.PROMPTS).some(k => broken[k] !== EVAL.PROMPTS[k]),
      `the plant "${plant.why}" no longer matches the prompt it breaks, so --plant proves nothing`);
    for (const id of plant.cases) assert.ok(EVAL.CASES.some(c => c.id === id), `the plant names no case ${id}`);
  }
  // A plant that leaves a copy of its rule standing tests the copy, not the eval.
  const ban = EVAL.PLANTS.find(p => p.cases.includes('view-unasked-in-position')).breaks(EVAL.PROMPTS).SYSTEM;
  assert.doesNotMatch(ban, /No view on where price goes|a view while he is in a position/,
    'the position-ban plant leaves the writer a statement of the ban');
  const map = EVAL.PLANTS.find(p => p.cases.includes('critic-keeps-map-out-of-prose')).breaks(EVAL.PROMPTS);
  assert.doesNotMatch(map.SYSTEM, /THE MAP OF HIS CHARTS IS THE HOURS ON IT/,
    'the map plant leaves the writer, whose prompt the critic runs under, a statement of the rule');
  assert.doesNotMatch(map.CRITIC, /Is the map of his charts in the prose/,
    'the map plant leaves the critic its check');
});

test('a graded case fails on what she wrote and on what the judge found', async () => {
  const c = EVAL.CASES.find(x => x.id === 'cut-in-a-hike-week');
  const answers = ['October rate cut odds slipped.', JSON.stringify({ verdicts: [
    { criterion: 'direction', pass: false, why: 'says cut' }] })];
  const result = await EVAL.grade(c, EVAL.PROMPTS, async () => ({ text: answers.shift(), usage: {} }));
  assert.ok(result.failed.some(f => /rate cut odds/.test(f)), 'the pattern did not fail a cut in a hike week');
  assert.ok(result.failed.some(f => /says cut/.test(f)), 'the judge\'s verdict was dropped');
});

/* ─── Effort as a message ────────────────────────────────────────────────────
   On Opus the caller's effort rides at the head of the conversation, so the
   effort at the top — which renders ahead of the cached prefix — is one value
   for every caller. Not on Sonnet, whose one caller has its own array. */
test('the caller\'s effort rides as a message on Opus, and the top stays one value', () => {
  const turns = [{ role: 'user', content: 'hello' }];
  const opus = 'claude-opus-5-5', sonnet = 'claude-sonnet-5-5';
  assert.equal(BASE_EFFORT, 'high');
  assert.deepEqual(effortMessages(turns, 'medium', opus),
    [{ role: 'system', content: [], output_config: { effort: 'medium' } }, ...turns],
    'a medium caller on Opus no longer says its effort as a message');
  assert.deepEqual(effortMessages(turns, 'high', opus), turns,
    'a caller at the top effort is sent a message saying so, which changes nothing but the bytes');
  assert.deepEqual(effortMessages(turns, 'medium', sonnet), turns,
    'Sonnet is sent the effort message its caller was never measured with');
});
