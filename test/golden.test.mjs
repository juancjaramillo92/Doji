/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — the golden snapshot
   ───────────────────────────────────────────────────────────────────────────
   THE OTHER FOUR SUITES ASSERT ON NAMED THINGS. This one asserts on everything
   else. A refactor does not break the thing a test was written about — it
   breaks an attribute nobody named, a label whose whitespace collapsed, a class
   that stopped being emitted, a derived value something renders and nothing
   asserts. Those are the defects whose answer to "when would this have been
   noticed" is never, and they are exactly what a rewrite-in-disguise leaves
   behind.

   So: boot the real page against a fixed fixture set on a frozen clock, and
   write down every derived value AND the rendered markup of every panel. The
   file beside this one is that record. It is not a description of correct
   behaviour — it is a description of CURRENT behaviour, which is a different
   and more useful thing while refactoring: any diff at all means the change was
   not behaviour-preserving, whether or not the new behaviour is better.

   ── Reading a failure ──────────────────────────────────────────────────────
   A diff here is one of three things, and they are not equally welcome:

     1. A refactor that changed behaviour. It is not a refactor. Split it.
     2. A deliberate behaviour change. Then the golden file is regenerated in
        the SAME commit as the code, and the commit message says what moved and
        why. This is the only legitimate way the file changes.
     3. The snapshot itself became non-deterministic. That is a defect in this
        file, not in the app, and it is the one that quietly destroys the whole
        instrument — see the hazard below.

   ── The hazard, stated so it cannot be forgotten ───────────────────────────
   A GOLDEN FILE REGENERATED WHENEVER IT FAILS IS WORSE THAN NO GOLDEN FILE.
   It costs the same to run, it reports green, and it proves nothing — while
   reading as though something is being checked. Regenerating is a deliberate
   act with a written reason:

       GOLDEN=write npm test

   ── Attribute order: decided deliberately ──────────────────────────────────
   §0.1 of the framework asks whether reordering two attributes in a template
   should be red. IT SHOULD, and this file makes it so, because the markup is
   captured verbatim. The reasoning: the app builds HTML by string template, so
   attribute order is something an author typed rather than something a
   serialiser chose — there is no such thing here as an incidental reordering.
   Making it visible costs one line in a diff that is trivially read and waved
   through; making it invisible means the snapshot cannot see template edits at
   all, which is most of what the client is. Red, then reclassified by a human.

   ── What this cannot see ───────────────────────────────────────────────────
   Pixels. It holds the markup and the class names, so a rule that stops being
   emitted is caught and a rule whose COLOUR changed is not. Every CSS move
   still needs a device pass, and says so.

   AND TWO OF `esc`'s FIVE REPLACEMENTS, for a reason worth knowing before
   trusting a green run here. The capture is `innerHTML`, which is the DOM
   RE-SERIALISED rather than the string the app built: `&`, `<` and `>` come
   back escaped because a serialiser must escape them in text, and `"` and `'`
   come back literal because it must not. So `esc` losing its quote handling is
   invisible in every text context, and visible in an attribute one only
   because the attribute would break and change the parsed shape. That is not a
   hole to be widened away — it is what innerHTML IS — so the two are held by
   the direct test at the foot of this file instead.
   ═══════════════════════════════════════════════════════════════════════════ */

// Before anything creates a Date. `Dates.fmt` parses `YYYY-MM-DDT12:00:00` as
// LOCAL time and formats with toLocaleDateString, so the midday anchor absorbs
// any offset inside ±12h — but the runner is not the place to find out that
// somewhere is +13. Pinned rather than relied upon.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { boot, trade } from './boot.mjs';

const GOLDEN = new URL('./golden.json', import.meta.url);
const WRITE  = process.env.GOLDEN === 'write';

/* ─── The clock ──────────────────────────────────────────────────────────────
   Thursday 30 July 2026, 14:00 in New York. Chosen rather than arbitrary: it is
   a weekday inside the trading week, so the week and month windows both hold
   rows and both have a populated predecessor; it is mid-afternoon in New York,
   which puts it inside the London+NY overlap so the session logic is exercised
   at a boundary rather than in the middle of a quiet one; and it is a Thursday,
   so `weekStart` counts back over a plain run of days rather than through the
   Sunday-before-17:00 special case, which `fold.test.mjs` already drives.
   ─────────────────────────────────────────────────────────────────────────── */
const NOW = '2026-07-30T18:00:00.000Z';

/* ─── The fixture set ────────────────────────────────────────────────────────
   Built to cover the derived space rather than to look like a real month. Every
   row below is here because it is the ONLY row that reaches some branch:

     a win, a loss, and both kinds of scratch — the price band and exact zero,
     which are separate rules in resultOf and part on a trade that moved and
     came back; a row with no P&L at all, which is absent from the win rate
     rather than counted as a loss; an open position, which is BOTH fill_time
     and balance null and nothing else; a journalled row and an unjournalled
     one, so `pending` and the broker banner both have something to say; a
     deleted row, which must appear in no render; rows in each session; both
     setups; last week and last month, so the P&L card's four comparisons are
     not all reading the same rows; and a row whose P&L came from net_pnl beside
     one that fell back to computed_pnl.
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

  // A SCRATCH BY PRICE: it moved $2.10, inside CONFIG.BE, but made $18.40.
  // The label is 'be' and the money still flows into gross profit — which is
  // the single thing that keeps profit minus loss equal to net.
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

  // DELETED. It must appear in nothing below — not a figure, not a cell, not a
  // row of the log — and it is the only way to notice if the filter is dropped.
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

  /* ── The three below were added because the mutation matrix said they were
        missing, which is the only reason a fixture should ever be added ──── */

  // STRADDLES THE SCRATCH BAND. It moved exactly $4.00, so it is a win at
  // CONFIG.BE = 3 and a scratch at 5. Without it every fixture sat well inside
  // or well outside the band, and moving BE changed nothing on screen — the
  // snapshot was green on a mutation that redefines what a scratch IS.
  trade({ id: 'P-012', open_day: '2026-07-21', entry_time: '2026-07-21T13:15:00.000Z',
          fill_time: '2026-07-21T13:55:00.000Z', direction: 'BUY',
          entry_price: 3400, exit_price: 3404, pnl: 7.5, net_pnl: 7.5,
          balance: 9982.9, size_oz: 1, setup: 'Break & Retest',
          followed_rules: true, followed_sl: true, followed_tp: true }),

  /* A SCALP TAKEN WHILE A SWING IS OPEN, and the pair exists to give the two
     time columns different opinions about order. P-013 is entered first and
     closed last; P-014 is entered second and closed first. `sortKey` prefers
     entry_time and falls back to fill_time, so swapping that preference
     reorders these two and nothing else — with every other fixture on its own
     day, the preference was unobservable and the snapshot passed a mutation to
     the ordering rule.

     This is the audit's own blind spot arriving again: a sort proved by rows
     that could not disagree. Any fixture set for an ordering rule needs two
     rows that ORDER DIFFERENTLY under the two candidate keys. */
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
/* THE ONLY UNTRUSTED TEXT THE CLIENT RENDERS, and the fixtures say so. The
   trade columns come from a broker and a fixed setup vocabulary; these three
   tables are written by a model that reads the web, so `thesis` and a loop
   `body` are the two strings on this page whose content nobody chose. They are
   escaped at eleven of `esc`'s eighteen call sites and one of those is an
   attribute context.

   The characters below are here because the mutation matrix found `esc` with no
   coverage at all — deleting its `"` replacement outright was green across all
   447 tests. A fixture of well-behaved prose cannot see that: escaping is only
   observable on input that needs escaping. */
const HOSTILE = `<script>alert("x")</script> & 'quotes' "double" <b>`;

const DESK = {
  eugenia_calendar: [
    { at: '2026-07-30T12:30:00.000Z', name: 'US Initial Jobless Claims',
      importance: 'high', consensus: '232k', actual: '229k', note: null },
    { at: '2026-07-31T14:00:00.000Z', name: 'Core PCE & "revisions"',
      importance: 'high', consensus: "0.2%", actual: null, note: null },
  ],
  eugenia_thesis: [{ thesis: `Dollar bid into month end; gold heavy above 3450. ${HOSTILE}`,
                     moved_on: '2026-07-30' }],
  eugenia_loops: [{ kind: 'question', body: `Does he still size up after two losses? ${HOSTILE}` }],
};

/* ─── What gets written down ─────────────────────────────────────────────────
   Two halves. The derived half is every value the app computes and something
   downstream depends on; the markup half is what a human would actually see.
   Both, because either alone has a blind spot: the derived values would miss a
   template that stopped emitting a class, and the markup would miss a figure
   that is right on screen and wrong in the object the export reads.
   ─────────────────────────────────────────────────────────────────────────── */

// Every panel the client renders, by the id it renders into. innerHTML rather
// than textContent: the class names ARE the behaviour here — a result colour, a
// pending flag and a today marker are all classes and nothing else.
const PANELS = [
  'broker-banner', 'pnl-net-number', 'pnl-net-count', 'pnl-gross-profit',
  'pnl-gross-loss', 'pnl-week-cur', 'pnl-week-prev', 'pnl-month-cur',
  'pnl-month-prev', 'pnl-balance-number', 'pnl-balance-at',
  'period-row', 'heatmap-title', 'heatmap-grid', 'heatmap-year',
  'heatmap-month-pnl', 'hm-profit', 'hm-loss', 'hm-net', 'hm-trades',
  'setup-table', 'roll-forward', 'trade-table', 'tlog-pagination', 'watch-card',
];

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
    weekStart: wk, monthStart: mo, lastClose: A.Dates.lastClose(),
  };

  // Both indexes: the keys and, for byDay, the whole per-day object. `index()`
  // builds them in one pass and every render reads them, so a change here is a
  // change everywhere at once.
  const indexes = {
    byId:  [...A.Data.byId.keys()].sort(),
    byDay: Object.fromEntries([...A.Data.byDay.entries()].sort()
      .map(([iso, d]) => [iso, { n: d.list.length, ids: d.list.map(t => t.id),
                                 pnl: d.pnl, pnlN: d.pnlN, be: d.be, pending: d.pending }])),
  };

  const panels = {};
  for (const id of PANELS) {
    const el = $(id);
    // A panel that vanished is recorded as absent rather than skipped — the
    // difference is the whole point on a refactor that renames an id.
    panels[id] = el === null ? null
      : { display: el.style.display || '', html: el.innerHTML };
  }

  /* THE CHARTS ARE THE HALF NOTHING ELSE CAN SEE. A canvas has no markup, so
     five wheels and the equity curve would be a blank in a markup snapshot. The
     stub records what the renderers ASKED for, which is the app's half of the
     contract and the only half it owns. Options are not captured — they hold
     functions, and Chart.js's own defaults are not this app's behaviour. */
  const drawn = charts.map(c => ({
    type: c.config?.type ?? null,
    labels: c.data?.labels ?? null,
    datasets: (c.data?.datasets ?? []).map(d => ({
      label: d.label ?? null, data: d.data ?? null,
      backgroundColor: d.backgroundColor ?? null, borderColor: d.borderColor ?? null,
    })),
  }));

  /* THROUGH JSON, AND NOT AS A CONVENIENCE. Every object above was built inside
     the jsdom realm — `counts()` returns a jsdom object, not a Node one — and
     `deepStrictEqual` compares prototypes, so two boots of identical fixtures
     compare unequal while every value in them matches. The determinism test
     below found exactly that, which is the whole reason it exists.

     It is also the honest comparison rather than a way around the symptom: the
     golden file IS JSON, so what a run must match is what survives the round
     trip. Anything that does not — an undefined, a Map, a function — would be
     absent from the file and present in the capture, and would have compared
     unequal against the file for ever. */
  return JSON.parse(JSON.stringify(
    { clock, derived, aggregates, indexes, panels, charts: drawn }));
}

test('the client renders the fixture set exactly as it is written down', async () => {
  const h = await boot({ now: NOW });
  try {
    for (const [name, rows] of Object.entries(DESK)) h.db.tables[name] = rows;

    // Seeded the way a landed fetch leaves it: `all` is everything including
    // the deleted row, `rows` is what renders. The harness's own seed() sets
    // both to one array, which would put the deleted row on screen and quietly
    // make the fixture that exists to catch that unable to.
    h.app.Data.all  = FIXTURES;
    h.app.Data.rows = FIXTURES.filter(t => !t.deleted);
    h.app.Data.index();

    h.app.render();
    await h.app.Watch.draw();

    const shot = capture(h);

    if (WRITE) {
      writeFileSync(GOLDEN, JSON.stringify(shot, null, 2) + '\n');
      // Not a silent pass: a run that WROTE the file has checked nothing, and
      // saying so is what stops `GOLDEN=write` becoming the way it is always run.
      console.log('golden.json rewritten — this run asserted nothing');
      return;
    }

    const want = JSON.parse(readFileSync(GOLDEN, 'utf8'));

    // Section by section, so a failure names the half that moved rather than
    // handing over a diff of the whole file.
    for (const section of ['clock', 'derived', 'aggregates', 'indexes', 'charts']) {
      assert.deepEqual(shot[section], want[section],
        `the ${section} the client computes is not what golden.json records — ` +
        `if this was a refactor, it changed behaviour and is not a refactor`);
    }

    // Panels one at a time and by name: a whole-object compare on twenty-five
    // panels of markup prints a diff nobody reads.
    for (const id of PANELS) {
      assert.deepEqual(shot.panels[id], want.panels[id],
        `#${id} does not render what golden.json records`);
    }

    // Caught last, and deliberately: the loop above cannot see a panel that was
    // ADDED to PANELS without the file being regenerated.
    assert.deepEqual(Object.keys(shot.panels).sort(), Object.keys(want.panels).sort(),
      'the set of panels captured is not the set golden.json holds');
  } finally {
    h.close();
  }
});

/* ─── The snapshot has to be the same twice ──────────────────────────────────
   A golden file that drifts on its own is the third failure mode in the header,
   and it is the one that destroys the instrument rather than reporting on it:
   it goes red for no reason, gets regenerated, and after two or three of those
   nobody reads a red run here again. Two boots on the same frozen clock, from
   the same fixtures, compared against each other — so a Map iterating in
   insertion order, a Set, a timestamp or an unsorted key that got into the
   capture is caught HERE, by a test about determinism, rather than showing up
   next week as a mystery diff in a commit that touched nothing near it.
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
   Everything above rests on it. If `now` stopped being honoured the whole file
   would still pass on the day it was regenerated and fail every day after,
   which reads as flakiness rather than as the harness having broken.
   ─────────────────────────────────────────────────────────────────────────── */
test('the frozen clock is the clock the app reads', async () => {
  const h = await boot({ now: NOW });
  try {
    assert.equal(h.win.Date.now(), Date.parse(NOW), 'Date.now() is not frozen');
    assert.equal(new h.win.Date().toISOString(), NOW, 'new Date() is not frozen');
    // The other three forms have to keep working, or freezing the clock would
    // silently break every date the app parses rather than the one it asks for.
    assert.equal(new h.win.Date('2026-01-02T03:04:05.000Z').toISOString(),
      '2026-01-02T03:04:05.000Z', 'new Date(iso) stopped parsing');
    assert.equal(h.win.Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 2), 'Date.UTC is gone');
    assert.equal(h.win.Date.parse(NOW), Date.parse(NOW), 'Date.parse is gone');
    // And the app's own reading of it, which is the value that actually decides
    // which month the grid opens on.
    assert.equal(h.app.Dates.today(), '2026-07-30',
      'the app reads a different day from the one the clock was frozen to');
  } finally { h.close(); }
});

/* ─── `esc`, held directly, because the snapshot cannot hold all of it ───────
   It guards eighteen call sites and had no test of any kind — deleting its `"`
   replacement outright was green across all 447 tests, which is how this got
   written. Eleven of those sites render text nobody chose: `eugenia_thesis`
   and `eugenia_loops` are written by a model that reads the web, and the watch
   card puts both on the page.

   Driven both ways rather than asserted at: each replacement is checked, and
   the input is checked to still contain the character being replaced, so a
   fixture that quietly stopped carrying a `<` cannot pass this as a clean run.
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

    /* THE ATTRIBUTE CONTEXT, DRIVEN RATHER THAN ASSERTED. `data-trade` is the
       one attribute built from an escaped value, and the failure it prevents is
       not a wrong string — it is a second attribute appearing, or the row
       losing the id the trade log reads back on a click. So this parses the
       markup and asks the DOM what it got, which is the only question that
       matters and the one a string compare cannot ask. */
    const nasty = `x" onclick="steal()" data-x="`;
    // In a real table context: a bare <tr> inside a <div> is dropped by the
    // HTML parser, which reads as esc failing and is nothing of the sort.
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
