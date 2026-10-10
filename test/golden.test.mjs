/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the golden snapshot
   ───────────────────────────────────────────────────────────────────────────
   THE OTHER SUITES ASSERT ON NAMED THINGS; THIS ONE ASSERTS ON EVERYTHING
   ELSE. A refactor breaks what nobody named — an attribute, a label whose
   whitespace collapsed, a class that stopped being emitted, a derived value
   something renders and nothing asserts. So: boot the real page against fixed
   fixtures on a frozen clock, and record every derived value AND every panel's
   markup. golden.json is CURRENT behaviour, not correct behaviour: any diff
   means the change was not behaviour-preserving, better or not.

   ── Reading a failure ──────────────────────────────────────────────────────
     1. A refactor that changed behaviour. It is not a refactor. Split it.
     2. A deliberate behaviour change. Regenerate in the SAME commit, and the
        message says what moved and why — the only legitimate way it changes.
     3. The snapshot became non-deterministic: a defect in this file, and the
        one that quietly destroys the instrument.

   A GOLDEN FILE REGENERATED WHENEVER IT FAILS IS WORSE THAN NONE: it reports
   green and proves nothing. Regenerating is a deliberate act with a reason:

       GOLDEN=write npm test

   ATTRIBUTE ORDER IS RED, deliberately. The app builds HTML by string
   template, so attribute order is something an author typed; hiding it would
   hide template edits, which are most of what the client is.

   ── What this cannot see ───────────────────────────────────────────────────
   Pixels: a class that stops being emitted is caught, a colour that changed is
   not. And two of `esc`'s five replacements: the capture is `innerHTML`, the
   DOM re-serialised, so `"` and `'` come back literal in text whatever the app
   built. The direct test at the foot of this file holds those.
   ═══════════════════════════════════════════════════════════════════════════ */

// Before anything creates a Date. The midday anchor absorbs any offset inside
// ±12h, but the runner is not the place to find a +13. Pinned.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { boot, trade } from './boot.mjs';
import { boot as bootScript } from './gs.mjs';
import { parseSse } from '../supabase/functions/_shared/edge.ts';
import { foldPosition, foldHours, balanceTarget } from '../supabase/functions/doji-mcp-sync/index.ts';
import { emailRow } from '../supabase/functions/doji-email-sync/index.ts';
import { foldCalendar, unwrap } from '../supabase/functions/doji-tradingview/index.ts';
import { checkRules, adherenceList, dayStanding } from '../supabase/functions/doji-eugenia/adherence.ts';
import { journalStats, statsList } from '../supabase/functions/doji-eugenia/journal.ts';

const GOLDEN = new URL('./golden.json', import.meta.url);
const WRITE  = process.env.GOLDEN === 'write';

/* ─── The clock ──────────────────────────────────────────────────────────────
   Thursday 30 July 2026, 14:00 in New York: inside the trading week, so the
   week and month windows and their predecessors all hold rows; inside the
   London+NY overlap; and a Thursday, so `weekStart` counts back over plain days
   rather than through the Sunday-before-17:00 case fold.test.mjs drives.
   ─────────────────────────────────────────────────────────────────────────── */
const NOW = '2026-07-30T18:00:00.000Z';

/* ─── The fixture set ────────────────────────────────────────────────────────
   Built to cover the derived space, not to look like a real month. Each row is
   the ONLY one reaching some branch: a win, a loss, both kinds of scratch (the
   price band and exact zero); a row with no P&L, absent from the win rate
   rather than a loss; an open position; journalled and unjournalled rows; a
   deleted row, which must appear in no render; every session; both setups;
   last week and last month for the P&L card's comparisons; and net_pnl beside
   the computed_pnl fallback.
   ─────────────────────────────────────────────────────────────────────────── */
const FIXTURES = [
  // ── This week (Mon 27th – Thu 30th July 2026) ────────────────────────────
  // A clean win, journalled, London+NY.
  trade({ id: 'P-001', open_day: '2026-07-27', entry_time: '2026-07-27T14:05:00.000Z',
          fill_time: '2026-07-27T15:10:00.000Z', direction: 'BUY',
          entry_price: 3400, exit_price: 3432.5, pnl: 61.24, net_pnl: 61.24,
          balance: 10061.24, size_oz: 2, setup: 'Break & Retest',
          followed_rules: true, followed_sl: true, followed_tp: true }),

  // A loss, journalled, and the rules were NOT followed — the discipline bar
  // needs a false as much as it needs a true.
  trade({ id: 'P-002', open_day: '2026-07-28', entry_time: '2026-07-28T08:30:00.000Z',
          fill_time: '2026-07-28T09:02:00.000Z', direction: 'SELL',
          entry_price: 3440, exit_price: 3455.25, pnl: -31.02, net_pnl: -31.02,
          balance: 10030.22, size_oz: 2, setup: 'Support & Resistance',
          followed_rules: false, followed_sl: false, followed_tp: true }),

  // A SCRATCH BY PRICE: it moved $2.10, inside CONFIG.BE, but made $18.40. The
  // label is 'be' and the money still flows into gross profit — which keeps
  // profit minus loss equal to net.
  trade({ id: 'P-003', open_day: '2026-07-29', entry_time: '2026-07-29T13:00:00.000Z',
          fill_time: '2026-07-29T13:40:00.000Z', direction: 'BUY',
          entry_price: 3450, exit_price: 3452.1, pnl: 18.4, net_pnl: 18.4,
          balance: 10048.62, size_oz: 4, setup: 'Break & Retest',
          followed_rules: true, followed_sl: true, followed_tp: false }),

  // A SCRATCH BY EXACT ZERO, on a trade that moved $40 and came back. The price
  // rule cannot reach this one; only `pnl === 0` can.
  trade({ id: 'P-004', open_day: '2026-07-29', entry_time: '2026-07-29T18:15:00.000Z',
          fill_time: '2026-07-29T20:00:00.000Z', direction: 'SELL',
          entry_price: 3460, exit_price: 3420, pnl: 0, net_pnl: 0,
          balance: 10048.62, size_oz: 1, setup: 'Support & Resistance',
          followed_rules: true, followed_sl: true, followed_tp: true }),

  // SYNCED BUT NOT JOURNALLED — the broker banner counts exactly this, and the
  // day it files under is `pending`.
  trade({ id: 'P-005', open_day: '2026-07-30', entry_time: '2026-07-30T02:20:00.000Z',
          fill_time: '2026-07-30T04:05:00.000Z', direction: 'BUY',
          entry_price: 3448, exit_price: 3441.8, pnl: -12.75, net_pnl: null,
          computed_pnl: -12.75, balance: 10035.87, size_oz: 1,
          setup: null, followed_rules: null, followed_sl: null, followed_tp: null }),

  // STILL OPEN, and open is BOTH columns null — the two witnesses. It has no
  // P&L, so it is in no money figure and in neither side of the win rate.
  trade({ id: 'P-006', open_day: '2026-07-30', entry_time: '2026-07-30T17:10:00.000Z',
          fill_time: null, balance: null, direction: 'BUY',
          entry_price: 3455, exit_price: null, pnl: null, net_pnl: null,
          computed_pnl: null, size_oz: 2, commission: null,
          setup: 'Break & Retest', followed_rules: true, followed_sl: true, followed_tp: true }),

  // DELETED. It must appear in nothing below, and it is the only way to notice
  // the filter being dropped.
  trade({ id: 'P-007', open_day: '2026-07-28', entry_time: '2026-07-28T15:00:00.000Z',
          fill_time: '2026-07-28T15:30:00.000Z', pnl: 999.99, net_pnl: 999.99,
          entry_price: 3400, exit_price: 3500, balance: 99999, deleted: true,
          setup: 'Break & Retest', followed_rules: true, followed_sl: true, followed_tp: true }),

  // ── Last week (still July, so the month figure holds it and the week does
  //    not — which is the pair that catches a window off by a day) ──────────
  trade({ id: 'P-008', open_day: '2026-07-21', entry_time: '2026-07-21T01:05:00.000Z',
          fill_time: '2026-07-21T03:30:00.000Z', direction: 'SELL',
          entry_price: 3380, exit_price: 3352.4, pnl: 52.8, net_pnl: 52.8,
          balance: 9975.4, size_oz: 2, setup: 'Support & Resistance',
          followed_rules: true, followed_sl: false, followed_tp: true }),

  // Asian session, and a P&L that is null on a CLOSED row — the shape a fold
  // with no entry deal leaves behind.
  trade({ id: 'P-009', open_day: '2026-07-22', entry_time: '2026-07-22T00:30:00.000Z',
          fill_time: '2026-07-22T02:00:00.000Z', direction: 'BUY',
          entry_price: 3375, exit_price: null, pnl: null, net_pnl: null,
          computed_pnl: null, balance: 9975.4, size_oz: 1,
          setup: 'Break & Retest', followed_rules: true, followed_sl: true, followed_tp: true }),

  /* ── Each of the three below exists because a planted defect stayed green
           without it ────────────────────────────────────────────────────────── */

  // STRADDLES THE SCRATCH BAND. It moved exactly $4.00: a win at CONFIG.BE = 3
  // and a scratch at 5. Without it, redefining what a scratch IS changed nothing
  // on screen.
  trade({ id: 'P-012', open_day: '2026-07-21', entry_time: '2026-07-21T13:15:00.000Z',
          fill_time: '2026-07-21T13:55:00.000Z', direction: 'BUY',
          entry_price: 3400, exit_price: 3404, pnl: 7.5, net_pnl: 7.5,
          balance: 9982.9, size_oz: 1, setup: 'Break & Retest',
          followed_rules: true, followed_sl: true, followed_tp: true }),

  /* A SCALP TAKEN WHILE A SWING IS OPEN. P-013 is entered first and closed
     last; P-014 entered second and closed first. `sortKey` prefers entry_time and
     falls back to fill_time, so swapping that preference reorders these two and
     nothing else. An ordering rule needs two rows that ORDER DIFFERENTLY under
     the candidate keys, or no fixture can see it. */
  trade({ id: 'P-013', open_day: '2026-07-23', entry_time: '2026-07-23T14:00:00.000Z',
          fill_time: '2026-07-23T19:45:00.000Z', direction: 'BUY',
          entry_price: 3410, exit_price: 3427.3, pnl: 33.9, net_pnl: 33.9,
          balance: 10016.8, size_oz: 2, setup: 'Break & Retest',
          followed_rules: true, followed_sl: true, followed_tp: true }),

  trade({ id: 'P-014', open_day: '2026-07-23', entry_time: '2026-07-23T14:20:00.000Z',
          fill_time: '2026-07-23T14:35:00.000Z', direction: 'SELL',
          entry_price: 3415, exit_price: 3421.6, pnl: -13.4, net_pnl: -13.4,
          balance: 10003.4, size_oz: 1, setup: 'Support & Resistance',
          followed_rules: true, followed_sl: false, followed_tp: true }),

  // ── Last month (June 2026) — the month comparison, and the opening balance
  //    every range figure is stepped off ─────────────────────────────────────
  trade({ id: 'P-010', open_day: '2026-06-18', entry_time: '2026-06-18T07:45:00.000Z',
          fill_time: '2026-06-18T11:20:00.000Z', direction: 'BUY',
          entry_price: 3300, exit_price: 3341.9, pnl: 83.11, net_pnl: 83.11,
          balance: 9922.6, size_oz: 2, setup: 'Break & Retest',
          followed_rules: true, followed_sl: true, followed_tp: true }),

  trade({ id: 'P-011', open_day: '2026-06-25', entry_time: '2026-06-25T19:30:00.000Z',
          fill_time: '2026-06-25T20:15:00.000Z', direction: 'SELL',
          entry_price: 3330, exit_price: 3358.6, pnl: -44.05, net_pnl: -44.05,
          balance: 9878.55, size_oz: 2, setup: 'Support & Resistance',
          followed_rules: false, followed_sl: true, followed_tp: false }),
];

// Eugenia's three reads behind the watch card. Fixed like everything else — the
// card is markup the client owns, however the rows got there.
/* THE ONLY UNTRUSTED TEXT THE CLIENT RENDERS. These tables are written by a
   model that reads the web, so `thesis` and a loop `body` are the strings on
   this page whose content nobody chose. Escaping is only observable on input
   that needs escaping, so the fixture carries every character `esc` replaces. */
const HOSTILE = `<script>alert("x")</script> & 'quotes' "double" <b>`;

const DESK = {
  eugenia_calendar: [
    { at: '2026-07-30T12:30:00.000Z', name: 'US Initial Jobless Claims',
      importance: 'high', consensus: '232k', actual: '229k' },
    { at: '2026-07-31T14:00:00.000Z', name: 'Core PCE & "revisions"',
      importance: 'high', consensus: "0.2%", actual: null },
  ],
  eugenia_thesis: [{ thesis: `Dollar bid into month end; gold heavy above 3450. ${HOSTILE}`,
                     moved_on: '2026-07-30' }],
  eugenia_loops: [{ kind: 'question', body: `Does he still size up after two losses? ${HOSTILE}` }],
};

/* ─── What gets written down ─────────────────────────────────────────────────
   Derived values AND markup, because each alone has a blind spot: the values
   miss a template that stopped emitting a class, the markup misses a derived
   value that is wrong where the screen does not show it.
   ─────────────────────────────────────────────────────────────────────────── */

// Every panel, by the id it renders into. innerHTML rather than textContent:
// a result colour, a pending flag and a today marker are classes and nothing
// else.
const PANELS = [
  'broker-banner', 'pnl-net-number', 'pnl-net-count', 'pnl-gross-profit',
  'pnl-gross-loss', 'pnl-week-cur', 'pnl-week-prev', 'pnl-month-cur',
  'pnl-month-prev', 'pnl-balance-number', 'pnl-balance-at',
  'period-row', 'heatmap-title', 'heatmap-grid', 'heatmap-year',
  'heatmap-month-pnl', 'hm-profit', 'hm-loss', 'hm-net', 'hm-trades',
  'setup-table', 'roll-forward', 'trade-table', 'tlog-pagination', 'watch-card',
];

/* ─── The session map, swept rather than sampled ─────────────────────────────
   Every market window is a table of hours DST moves twice a year, on different
   dates in New York and London. In the weeks the two are out of step the
   London+NY overlap shifts by an hour, and a spot check at 14:00 on a Tuesday
   in July passes almost any mistake there. So this walks the clock and records
   the TRANSITIONS, over both US changeovers, both EU ones, and one ordinary
   week from each half of the year.
   ─────────────────────────────────────────────────────────────────────────── */
const SWEEPS = [
  ['us-spring',  '2026-03-07', 4],   // US forward 8 Mar; EU has not yet
  ['eu-spring',  '2026-03-28', 4],   // EU forward 29 Mar; the two re-align
  ['eu-autumn',  '2026-10-24', 4],   // EU back 25 Oct; out of step again
  ['us-autumn',  '2026-10-31', 4],   // US back 1 Nov
  ['winter',     '2026-01-19', 7],   // an ordinary week, both on standard time
  ['summer',     '2026-07-13', 7],   // an ordinary week, both on summer time
];

function sweepSessions(app) {
  const out = {};
  for (const [name, from, days] of SWEEPS) {
    const start = Date.parse(from + 'T00:00:00.000Z');
    const marks = [];
    let prev = null;
    // Half-hourly: every boundary in MARKETS lands on an hour or a half, so a
    // one-hour step can straddle a window that opens and shuts inside it.
    for (let ms = start; ms < start + days * 864e5; ms += 18e5) {
      const at = new Date(ms);
      const sess = app.Dates.session(at);
      if (sess !== prev) { marks.push([at.toISOString(), sess]); prev = sess; }
    }
    out[name] = marks;
  }
  return out;
}

function capture({ app, $, win, charts }) {
  const A = app;
  const live = A.Data.rows;

  // Per-trade derivations, keyed by id so a row moving in the array is not a
  // diff and a row deriving differently is.
  const derived = {};
  for (const t of A.Data.all) {
    derived[t.id] = {
      result:     A.resultOf(t),
      complete:   A.isComplete(t),
      day:        A.dayOf(t),
      session:    A.sessionOf(t),
    };
  }

  // The aggregates, over the live rows the renderers are handed.
  const wk = A.Dates.weekStart(), mo = A.Dates.monthStart();
  const aggregates = {
    counts:   A.counts(live),
    money:    A.money(live),
    pctSplit: A.pctSplit([A.counts(live).win, A.counts(live).loss, A.counts(live).be]),
    rangeWeek:  A.rangeStats(live, wk, '9999-12-31'),
    rangeMonth: A.rangeStats(live, mo, '9999-12-31'),
    aggregateResult: {
      // Named cases rather than a sweep: these are the four answers, and the
      // flat day is the one a decision was taken about.
      empty:  A.aggregateResult(0, 0, 0),
      flat:   A.aggregateResult(0, 3, 0),
      scratch: A.aggregateResult(12, 2, 2),
      win:    A.aggregateResult(50, 3, 0),
      loss:   A.aggregateResult(-50, 3, 0),
    },
  };

  const clock = {
    today: A.Dates.today(), nyMonth: A.Dates.nyMonth(),
    weekStart: wk, monthStart: mo,
  };

  // Both indexes, whole: every render reads them.
  const indexes = {
    byId:  [...A.Data.byId.keys()].sort(),
    byDay: Object.fromEntries([...A.Data.byDay.entries()].sort()
      .map(([iso, d]) => [iso, { n: d.list.length, ids: d.list.map(t => t.id),
                                 pnl: d.pnl, pnlN: d.pnlN, be: d.be, pending: d.pending }])),
  };

  const panels = {};
  for (const id of PANELS) {
    const el = $(id);
    // A panel that vanished is recorded as absent rather than skipped, which is
    // the point on a refactor that renames an id. Its own class too: a figure's
    // win or loss colour sits on the element, where innerHTML cannot see it.
    panels[id] = el === null ? null
      : { display: el.style.display || '', cls: el.className, html: el.innerHTML };
  }

  /* THE CHARTS ARE THE HALF NOTHING ELSE CAN SEE: a canvas has no markup. The
     stub records what the renderers ASKED for, the half of the contract the app
     owns. Options are not captured — they hold functions. */
  const drawn = charts.map(c => ({
    type: c.config?.type ?? null,
    labels: c.data?.labels ?? null,
    datasets: (c.data?.datasets ?? []).map(d => ({
      label: d.label ?? null, data: d.data ?? null,
      backgroundColor: d.backgroundColor ?? null, borderColor: d.borderColor ?? null,
    })),
  }));

  /* THROUGH JSON, AND NOT AS A CONVENIENCE. Every object here was built in the
     jsdom realm and `deepStrictEqual` compares prototypes, so two identical boots
     would compare unequal. And golden.json IS JSON, so what survives the round
     trip is what a run must match. */
  return JSON.parse(JSON.stringify(
    { clock, derived, aggregates, sessions: sweepSessions(A), indexes, panels,
      charts: drawn }));
}

test('the client renders the fixture set exactly as it is written down', async () => {
  const h = await boot({ now: NOW });
  try {
    for (const [name, rows] of Object.entries(DESK)) h.db.tables[name] = rows;

    // Seeded the way a landed fetch leaves it: `all` includes the deleted row,
    // `rows` is what renders. The harness's seed() sets both to one array, which
    // would put the deleted row on screen.
    h.app.Data.all  = FIXTURES;
    h.app.Data.rows = FIXTURES.filter(t => !t.deleted);
    h.app.Data.index();

    h.app.render();
    await h.app.Watch.draw();

    const shot = capture(h);

    if (WRITE) {
      writeFileSync(GOLDEN, JSON.stringify(shot, null, 2) + '\n');
      // A run that WROTE the file has checked nothing, and says so — or
      // `GOLDEN=write` becomes the way it is always run.
      console.log('golden.json rewritten — this run asserted nothing');
      return;
    }

    const want = JSON.parse(readFileSync(GOLDEN, 'utf8'));

    // Section by section, so a failure names the half that moved rather than
    // handing over a diff of the whole file.
    for (const section of ['clock', 'derived', 'aggregates', 'sessions', 'indexes', 'charts']) {
      assert.deepEqual(shot[section], want[section],
        `the ${section} the client computes is not what golden.json records — ` +
        `if this was a refactor, it changed behaviour and is not a refactor`);
    }

    // Panels one at a time and by name: a whole-object diff of twenty-five panels
    // of markup is one nobody reads.
    for (const id of PANELS) {
      assert.deepEqual(shot.panels[id], want.panels[id],
        `#${id} does not render what golden.json records`);
    }

    // Last, because the loop above cannot see a panel ADDED to PANELS without the
    // file being regenerated.
    assert.deepEqual(Object.keys(shot.panels).sort(), Object.keys(want.panels).sort(),
      'the set of panels captured is not the set golden.json holds');
  } finally {
    h.close();
  }
});

/* ─── The snapshot has to be the same twice ──────────────────────────────────
   Drift is the failure that destroys the instrument: red for no reason,
   regenerated, and after a few of those nobody reads a red run here. Two boots
   compared against each other catch a Map, a Set, a timestamp or an unsorted
   key HERE, rather than as a mystery diff next week.
   ─────────────────────────────────────────────────────────────────────────── */
test('two boots of the same fixtures on the same clock capture the same thing', async () => {
  const run = async () => {
    const h = await boot({ now: NOW });
    try {
      for (const [name, rows] of Object.entries(DESK)) h.db.tables[name] = rows;
      h.app.Data.all  = FIXTURES;
      h.app.Data.rows = FIXTURES.filter(t => !t.deleted);
      h.app.Data.index();
      h.app.render();
      await h.app.Watch.draw();
      return capture(h);
    } finally { h.close(); }
  };
  assert.deepEqual(await run(), await run(),
    'the same input rendered twice captured differently — something in the ' +
    'capture is reading a clock, an iteration order or an identity');
});

/* ─── The clock is frozen, and that is worth its own test ────────────────────
   If `now` stopped being honoured the file would pass on the day it was
   regenerated and fail every day after, reading as flakiness.
   ─────────────────────────────────────────────────────────────────────────── */
test('the frozen clock is the clock the app reads', async () => {
  const h = await boot({ now: NOW });
  try {
    assert.equal(h.win.Date.now(), Date.parse(NOW), 'Date.now() is not frozen');
    assert.equal(new h.win.Date().toISOString(), NOW, 'new Date() is not frozen');
    // The other Date forms must keep working, or freezing the clock breaks every
    // date the app parses.
    assert.equal(new h.win.Date('2026-01-02T03:04:05.000Z').toISOString(),
      '2026-01-02T03:04:05.000Z', 'new Date(iso) stopped parsing');
    assert.equal(h.win.Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 2), 'Date.UTC is gone');
    assert.equal(h.win.Date.parse(NOW), Date.parse(NOW), 'Date.parse is gone');
    // And the app's own reading of it, which decides the month the grid opens on.
    assert.equal(h.app.Dates.today(), '2026-07-30',
      'the app reads a different day from the one the clock was frozen to');
  } finally { h.close(); }
});

/* ─── `esc`, held directly, because the snapshot cannot hold all of it ───────
   Eleven of its call sites render text a model wrote off the web. Driven both
   ways: each replacement is checked, and the input is checked to still carry
   the character replaced, so a fixture that lost its `<` cannot pass clean.
   ─────────────────────────────────────────────────────────────────────────── */
test('esc neutralises every character it claims to, in both contexts', async () => {
  const h = await boot({ now: NOW });
  try {
    const { esc } = h.app;

    for (const [raw, want] of [
      ['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;'],
    ]) {
      assert.equal(esc(raw), want, `esc no longer replaces ${raw}`);
    }

    // Ampersand first, or every other replacement's own ampersand is escaped a
    // second time and `<` renders as `&amp;lt;`.
    assert.equal(esc('<&>'), '&lt;&amp;&gt;', 'esc double-escapes its own output');

    // The three-state columns arrive as null and are rendered through this.
    assert.equal(esc(null), '', 'esc(null) stopped being empty');
    assert.equal(esc(undefined), '', 'esc(undefined) stopped being empty');

    /* THE ATTRIBUTE CONTEXT, DRIVEN. `data-trade` is the one attribute built from
       an escaped value, and the failure is a second attribute appearing or the row
       losing the id a click reads back — so this asks the DOM what it parsed. */
    const nasty = `x" onclick="steal()" data-x="`;
    // In a real table: a bare <tr> inside a <div> is dropped by the HTML parser,
    // which would read as esc failing.
    const el = h.win.document.createElement('div');
    el.innerHTML = `<table><tbody><tr data-trade="${esc(nasty)}"><td>c</td></tr></tbody></table>`;
    const row = el.querySelector('[data-trade]');
    assert.ok(row, 'the escaped id did not survive as one attribute');
    assert.equal(row.getAttribute('data-trade'), nasty,
      'the id read back off the attribute is not the id that went in');
    assert.equal(row.getAttribute('onclick'), null,
      'a quote in a trade id opened a second attribute — esc is not holding ' +
      'the attribute context');
  } finally { h.close(); }
});

/* ─── Two things in `session()` decide nothing, and that is checked ──────────
   Walked at fifteen-minute resolution across 2026, `london && ny && asia` is
   true at ZERO instants, so the order of those two branches is unobservable;
   and Sydney is open without Tokyo at 5,112 instants but never while London is
   open, so `M.sydney` cannot change what `session()` returns. The term stays:
   it says any Asian centre is open, which is true of the world.

   Both are accidents of four hour-tables DST moves twice a year. Widening a
   window could make either start deciding real answers in a commit about
   something else — and then this goes red and says which woke up.
   ─────────────────────────────────────────────────────────────────────────── */
test('the two branches of session() that decide nothing still decide nothing', async () => {
  const h = await boot({ now: NOW });
  try {
    const D = h.app.Dates, M = D.MARKETS;
    let triple = 0, sydneyMatters = 0, sydneyOpenAlone = 0, n = 0;

    for (let ms = Date.parse('2026-01-01T00:00:00Z');
             ms < Date.parse('2027-01-01T00:00:00Z'); ms += 9e5) {
      const at = new Date(ms); n++;
      const london = D.isOpen(M.london, at), ny = D.isOpen(M.ny, at);
      const tokyo  = D.isOpen(M.tokyo, at),  syd = D.isOpen(M.sydney, at);
      if (london && ny && (tokyo || syd)) triple++;
      if (syd && !tokyo) { sydneyOpenAlone++; if (london) sydneyMatters++; }
    }

    // Without this the three below would all pass on a loop that never ran.
    assert.equal(n, 35040, 'the year is not the year this was measured over');
    assert.ok(sydneyOpenAlone > 4000,
      `Sydney is open without Tokyo at only ${sydneyOpenAlone} instants — the ` +
      `hours moved, so the two conclusions below are about a different table`);

    assert.equal(triple, 0,
      `London, New York and an Asian centre are now open together at ${triple} ` +
      `instants, so the order of the first two branches of session() has started ` +
      `deciding real answers — it never has before and nothing chose which wins`);
    assert.equal(sydneyMatters, 0,
      `Sydney now reaches the London+asia branch at ${sydneyMatters} instants, ` +
      `so MARKETS.sydney has stopped being dead and session() means something ` +
      `new — check that this is what was intended`);
  } finally { h.close(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOLDS — what the functions make of what the broker and the email sent
   ───────────────────────────────────────────────────────────────────────────
   The same instrument, pointed at the pure half of the system. fold.test.mjs
   asserts on what it names; this records everything else the folds return,
   off the real captures rather than built rows — the columns the poller and
   the email write, which the app cannot correct, and what Eugenia is told about
   the week those columns describe. golden-fold.json obeys golden.json's rules:
   CURRENT behaviour, regenerated only in the commit that changes it.
   ═══════════════════════════════════════════════════════════════════════════ */
const FOLD_GOLDEN = new URL('./golden-fold.json', import.meta.url);
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const USER = '00000000-0000-0000-0000-000000000001';

function folds() {
  const deals = JSON.parse(parseSse(fixture('ctrader-get-deals.txt')).result.content[0].text).deals;
  const byPosition = new Map();
  for (const d of deals) byPosition.set(d.positionId, [...(byPosition.get(d.positionId) ?? []), d]);

  /* As the poller runs: the capture is its fold window, and it writes only the
     positions with a deal inside the write window, which ends MAX_POSITION_HOURS
     — foldHours(0) — after the fold window opens. Folding every position
     instead would write the closing half of a trade opened before the capture
     as an open one, which the poller never does. */
  const opened = Math.min(...deals.map(d => d.executionTimestamp));
  const last   = Math.max(...deals.map(d => d.executionTimestamp));
  const from   = opened + foldHours(0) * 3_600_000;
  const written = [...byPosition.values()]
    .filter(ds => ds.some(d => d.executionTimestamp >= from))
    .map(ds => ({ row: foldPosition(ds, USER), closedAt: Math.max(...ds.map(d => d.executionTimestamp)) }))
    .sort((a, b) => a.row.id.localeCompare(b.row.id));

  // The email about one of those trades, parsed and bounded as the two halves
  // of the email path do it.
  const parsed = bootScript().parseAlert_('[cTrader live account] Stop loss filled for XAUUSD',
                                          fixture('ctrader-stop-loss-filled.html'));
  const email = emailRow(JSON.parse(JSON.stringify(parsed)), USER);

  /* The week as the trades table then holds it, read through eugenia_trades:
     the poller's columns, its close stamp, and the email's two owned columns
     where the email landed. Nobody has journalled it. */
  const rows = written.map(({ row, closedAt }) => {
    const t = { ...row, fill_time: row.exit_price === null ? null : new Date(closedAt).toISOString(),
                net_pnl: null, setup: null, followed_rules: null, followed_sl: null, followed_tp: null,
                planned_sl: null, planned_tp: null, best_price: null };
    if (t.id === email.row.id) Object.assign(t, { fill_time: email.row.fill_time, net_pnl: email.row.net_pnl });
    return { ...t, pnl: t.net_pnl ?? t.computed_pnl };
  });
  const rules = checkRules(rows, last + 86_400_000);
  const stats = journalStats(rows);

  return {
    poller: {
      written: written.map(w => w.row),
      stamped: written.filter(w => w.row.exit_price !== null)
                      .map(w => [w.row.id, new Date(w.closedAt).toISOString()]),
      balanceFor: balanceTarget(written.filter(w => w.row.exit_price !== null)
                                       .map(w => ({ id: w.row.id, at: w.closedAt })), last + 60_000),
    },
    email: { parsed, row: email },
    calendar: foldCalendar(unwrap(JSON.parse(fixture('tradingview-calendar.json')), 'mcp-tv-get-economic-calendar')),
    eugenia: {
      rules, told: adherenceList(rules),
      standing: [...new Set(rows.map(t => t.open_day))].sort().map(day => dayStanding(rows, day)),
      stats, statsTold: statsList(stats, 7),
    },
  };
}

// Through JSON, as each half leaves the function: an undefined key is an absent
// column, and the parsed alert crosses from the script's own realm.
const foldShot = () => JSON.parse(JSON.stringify(folds()));

test('the folds make of the real captures exactly what is written down', () => {
  const shot = foldShot();

  if (WRITE) {
    writeFileSync(FOLD_GOLDEN, JSON.stringify(shot, null, 2) + '\n');
    console.log('golden-fold.json rewritten — this run asserted nothing');
    return;
  }

  const want = JSON.parse(readFileSync(FOLD_GOLDEN, 'utf8'));
  for (const [section, parts] of Object.entries(want)) {
    for (const part of Object.keys(parts)) {
      assert.deepEqual(shot[section]?.[part], parts[part],
        `${section}.${part} is not what golden-fold.json records — if this was a ` +
        `refactor, it changed behaviour and is not a refactor`);
    }
  }
  assert.deepEqual(shot, want, 'the folds return a part golden-fold.json does not record');
});

test('the folds capture the same thing twice', () => {
  assert.deepEqual(foldShot(), foldShot(),
    'the same captures folded twice differ — something reads a clock or an iteration order');
});
