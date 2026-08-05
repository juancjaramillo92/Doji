/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — client tests
   ───────────────────────────────────────────────────────────────────────────
   index.html booted in jsdom against synthetic trades. See test/boot.mjs for
   how a single-file app with no exports is got at.

   Run:  node --experimental-strip-types --test test/

   WHAT IS NOT COVERED, said plainly. These tests assert on values and on
   emitted markup; they cannot see pixels, so a renderer that produces correct
   HTML with broken CSS passes here. Nothing touches Supabase, so Data.load,
   Data.save, realtime and the auth paths are unverified. The xlsx export needs
   SheetJS from a CDN and is not exercised. And the Apps Script has no coverage
   at all, here or anywhere.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, trade, journalled } from './boot.mjs';

let app, seed, $, win, close, db;

before(async () => {
  ({ app, seed, $, win, close, db } = await boot());
});
after(() => close());

/* ─── Completeness ───────────────────────────────────────────────────────────
   Setup plus the three discipline answers. It decides the purple pending state,
   the banner count and the day dot, so a clause added here quietly changes all
   three at once.
   ─────────────────────────────────────────────────────────────────────────── */

test('a trade is complete on setup and the three discipline answers alone', () => {
  assert.equal(app.isComplete(journalled()), true);
});

test('a NO answer is an answer', () => {
  // The three-state boolean: false is answered, null is not. Treating a broken
  // rule as an unfilled field would hide exactly the entries worth reading.
  assert.equal(app.isComplete(journalled({ followed_rules: false, followed_sl: false, followed_tp: false })), true);
});

test('any unanswered field leaves the trade pending', () => {
  assert.equal(app.isComplete(trade()), false);
  assert.equal(app.isComplete(journalled({ setup: null })), false);
  assert.equal(app.isComplete(journalled({ followed_rules: null })), false);
  assert.equal(app.isComplete(journalled({ followed_sl: null })), false);
  assert.equal(app.isComplete(journalled({ followed_tp: null })), false);
});

test('an open position with no P&L can still be complete', () => {
  assert.equal(app.isComplete(journalled({ pnl: null, exit_price: null })), true);
});

/* ─── The write contract ─────────────────────────────────────────────────────
   Data.OWNED is the single list a save payload is built from, and it is what
   stops the client writing broker-owned data. Enforced in one place rather than
   trusted to each call site, so this is the one place to assert it.
   ─────────────────────────────────────────────────────────────────────────── */

test('Data.OWNED names the four journal columns and nothing else', () => {
  // Spread first: the app's array belongs to the jsdom realm, and a strict
  // deep-equal compares prototypes across realms as well as contents.
  assert.deepEqual([...app.Data.OWNED],
    ['setup', 'followed_rules', 'followed_sl', 'followed_tp']);
});

/* ─── The load path ──────────────────────────────────────────────────────────
   Data owns load, save, soft-delete and both indexes, and a mistake in it is
   silent — the panel renders empty and the sync dot sticks, which reads as a
   connection problem rather than as a bug. These run the real methods against
   the harness table.
   ─────────────────────────────────────────────────────────────────────────── */

test('load fills both row sets, hides deleted rows, and reports Synced', async () => {
  db.error = null;
  db.rows = [
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 }),
    { ...journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -10 }), deleted: true }
  ];
  await app.Data.load();

  assert.equal(app.Data.all.length, 2);        // the backup keeps deleted rows
  assert.equal(app.Data.rows.length, 1);       // nothing renders them
  assert.equal(app.Data.offline, false);
  assert.ok(app.Data.byId.has('PID1'));        // load indexed on the way out
  assert.equal($('sync-dot').className, 'sync-dot ok');
});

test('a failed load falls back to the snapshot and goes read-only', async () => {
  db.rows = [journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })];
  await app.Data.load();                       // writes the snapshot
  db.error = { message: 'network' };
  await app.Data.load();

  assert.equal(app.Data.rows.length, 1);       // drawn from the snapshot, not blank
  assert.equal(app.Data.offline, true);
  assert.equal($('sync-dot').className, 'sync-dot offline');
  db.error = null;
});

test('a save sends the journal columns and nothing else', async () => {
  // The other half of the OWNED contract: not just what the list says, but what
  // actually leaves the client. The broker columns handed in here are the ones
  // the poller rewrites every two minutes — naming any of them in an UPDATE is
  // how the journal would start fighting the sync.
  db.error = null;
  db.rows = [journalled({ id: 'PID1' })];
  await app.Data.load();
  db.patches.length = 0;

  await app.Data.save('PID1', {
    setup: 'Break & Retest',
    followed_rules: true, followed_sl: false, followed_tp: null,
    pnl: 999, direction: 'SELL', entry_time: '2026-01-01T00:00:00Z', deleted: true
  });

  assert.equal(db.patches.length, 1);
  assert.deepEqual(Object.keys(db.patches[0]).sort(),
    ['followed_rules', 'followed_sl', 'followed_tp', 'setup']);
});

/* ─── Result bands ───────────────────────────────────────────────────────── */

test('the per-fill break-even band is ±$3 inclusive', () => {
  assert.equal(app.resultOf(trade({ pnl: 3.01 })), 'win');
  assert.equal(app.resultOf(trade({ pnl: 3.00 })), 'be');
  assert.equal(app.resultOf(trade({ pnl: 0 })), 'be');
  assert.equal(app.resultOf(trade({ pnl: -3.00 })), 'be');
  assert.equal(app.resultOf(trade({ pnl: -3.01 })), 'loss');
});

test('no P&L is not a break-even', () => {
  // An open position journalled on entry. Filing it as a scratch would put it
  // in the win-rate denominator and drag every rate on the panel.
  assert.equal(app.resultOf(trade({ pnl: null })), null);
});

test('the aggregate band is ±$10 and needs at least one priced trade', () => {
  assert.equal(app.aggregateResult(10, 3), 'be');
  assert.equal(app.aggregateResult(10.01, 3), 'win');
  assert.equal(app.aggregateResult(-10.01, 3), 'loss');
  assert.equal(app.aggregateResult(0, 0), '');      // nothing priced — no colour at all
  assert.equal(app.aggregateResult(500, 0), '');
});

/* ─── Rates and money ────────────────────────────────────────────────────── */

test('break-evens sit in the win-rate denominator', () => {
  const c = app.counts([
    trade({ pnl: 100 }), trade({ pnl: 100 }),
    trade({ pnl: 1 }),                     // scratch
    trade({ pnl: -50 }),
    trade({ pnl: null })                   // still open — in neither side
  ]);
  assert.deepEqual({ win: c.win, loss: c.loss, be: c.be, decided: c.decided },
                   { win: 2, loss: 1, be: 1, decided: 4 });
  assert.equal(c.wr, 50);                  // 2 of 4, not 2 of 3
});

test('profit minus loss comes out exactly equal to net', () => {
  // The reason the sign-split lives in money() and nowhere else: a scratch is
  // still a dollar, and it has to land on one side or the other.
  const m = app.money([trade({ pnl: 100 }), trade({ pnl: 2.5 }), trade({ pnl: -40 }), trade({ pnl: null })]);
  assert.equal(m.n, 3);
  assert.equal(m.gross, 102.5);
  assert.equal(m.loss, 40);
  assert.equal(m.net, 62.5);
  assert.equal(app.round2(m.gross - m.loss), m.net);
});

test('a split always totals 100 percent, and nothing to split is null', () => {
  // The largest-remainder pass is there so three thirds read 34/33/33 rather
  // than 33/33/33 — a rate that does not add up is the kind of thing the trader
  // notices at 6am and cannot explain.
  for (const parts of [[1, 1, 1], [2, 1, 0], [7, 11, 3], [1, 0, 0], [5, 5, 0]]) {
    const p = app.pctSplit(parts);
    assert.equal(p.reduce((a, b) => a + b, 0), 100, `${parts} split to ${p}`);
  }
  assert.equal(app.pctSplit([0, 0, 0]), null);   // no trades — not 0%, nothing
});

/* ─── Filing and sessions ────────────────────────────────────────────────── */

test('open_day is the filing anchor, the closing fill only its fallback', () => {
  assert.equal(app.dayOf(trade({ open_day: '2026-07-30' })), '2026-07-30');
  // 01:05 UTC on the 31st is 21:05 on the 30th in New York.
  assert.equal(app.dayOf(trade({ open_day: null, fill_time: '2026-07-31T01:05:00Z' })), '2026-07-30');
});

test('the session comes from the entry, falling back to the close', () => {
  // 09:00 UTC is inside London and outside New York; 20:00 UTC is the reverse.
  // Both times are present, so this only passes if entry_time is preferred.
  assert.equal(app.sessionOf(trade({ entry_time: '2026-07-30T09:00:00Z', fill_time: '2026-07-30T20:00:00Z' })), 'London');
  // The seam: a fill the poller never reached has no entry, so it is filed by
  // when it closed.
  assert.equal(app.sessionOf(trade({ entry_time: null, fill_time: '2026-07-30T20:00:00Z' })), 'New York');
  assert.equal(app.sessionOf(trade({ entry_time: null, fill_time: null })), null);
});

test('the session is always derived, never read off the row', () => {
  // Derived at read time is the whole contract: no stored value can go stale
  // against the times it was derived from, and nothing has to be repaired when
  // a fill the poller missed is backfilled later.
  const t = { ...trade({ entry_time: '2026-07-30T09:00:00Z' }), session: 'Asian' };
  assert.equal(app.sessionOf(t), 'London');
});

test('the London boundary moves with British Summer Time', () => {
  // The same wall-clock UTC hour, six months apart. In July 07:30 UTC is 08:30
  // in London and the desk is open; in January it is 07:30 and it is not. A
  // session table written in fixed UTC hours would call these identical.
  assert.equal(app.sessionOf(trade({ entry_time: '2026-07-15T07:30:00Z' })), 'Asia+London');
  assert.equal(app.sessionOf(trade({ entry_time: '2026-01-15T07:30:00Z' })), 'Asian');
});

/* ─── Data indexes ───────────────────────────────────────────────────────── */

test('one pass builds both lookups', () => {
  seed([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 }),
    journalled({ id: 'PID2', open_day: '2026-07-30', pnl: -10.005 }),
    trade({ id: 'PID3', open_day: '2026-07-31', pnl: 5 })
  ]);
  assert.equal(app.Data.byId.get('PID2').pnl, -10.005);
  assert.equal(app.Data.day('2026-07-30').list.length, 2);
  assert.equal(app.Data.day('2026-07-30').pnl, 29.99);      // rounded once, at the end
  assert.equal(app.Data.day('2026-07-30').pnlN, 2);
});

test('a day is pending if any trade in it is', () => {
  seed([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 }),
    trade({ id: 'PID2', open_day: '2026-07-30', pnl: 5 })      // never journalled
  ]);
  assert.equal(app.Data.day('2026-07-30').pending, true);
  seed([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })]);
  assert.equal(app.Data.day('2026-07-30').pending, false);
});

test('an untraded day is an empty day, not undefined', () => {
  seed([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })]);
  const d = app.Data.day('2020-01-01');
  assert.deepEqual({ n: d.list.length, pnl: d.pnl, pending: d.pending }, { n: 0, pnl: 0, pending: false });
});

test('a trade with no filing day at all is indexed by id but lands on no day', () => {
  seed([trade({ id: 'PID9', open_day: null, fill_time: null, entry_time: null, pnl: 12 })]);
  assert.ok(app.Data.byId.has('PID9'));
  assert.equal(app.Data.byDay.size, 0);
});

/* ─── Rendering ──────────────────────────────────────────────────────────────
   render() wraps each step in its own catch so one broken widget degrades
   alone. That is good for the trader and bad for a test, because a thrown
   renderer looks like a pass — so these read the console instead.
   ─────────────────────────────────────────────────────────────────────────── */

function renderClean(rows) {
  const failures = [];
  const original = win.console.error;
  win.console.error = (...a) => { if (String(a[0]).includes('render step failed')) failures.push(a[1]); };
  try { seed(rows); app.render(); } finally { win.console.error = original; }
  return failures;
}

test('a full panel renders with no step failing', () => {
  const failures = renderClean([
    journalled({ id: 'PID1', open_day: '2026-07-28', pnl: 57.1, setup: 'Break & Retest', session: 'London' }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -22, setup: 'Support & Resistance', followed_sl: false }),
    journalled({ id: 'PID3', open_day: '2026-07-30', pnl: 1.5, setup: 'Break & Retest' }),
    trade({ id: 'PID4', open_day: '2026-07-30', pnl: null })
  ]);
  assert.deepEqual(failures, []);
  assert.ok($('trade-table').innerHTML.length > 0);
  assert.ok($('setup-table').innerHTML.length > 0);
});

test('an empty journal renders with no step failing', () => {
  // The empty state is a dim placeholder everywhere, never a missing row, so
  // this path has to be as safe as the populated one.
  assert.deepEqual(renderClean([]), []);
});

test('a journal of nothing but open positions renders with no step failing', () => {
  // Every rate divides by `decided`, which is zero here.
  assert.deepEqual(renderClean([
    journalled({ id: 'PID1', pnl: null }), journalled({ id: 'PID2', pnl: null })
  ]), []);
});

test('the pending banner counts unjournalled trades and hides when there are none', () => {
  renderClean([journalled({ id: 'PID1', pnl: 10 }), trade({ id: 'PID2', open_day: '2026-07-29', pnl: 10 })]);
  assert.equal($('broker-banner').style.display, 'flex');
  assert.match($('broker-banner').textContent, /1 New trade/);

  renderClean([journalled({ id: 'PID1', pnl: 10 })]);
  assert.equal($('broker-banner').style.display, 'none');
});

/* ─── Journal form ───────────────────────────────────────────────────────── */

test('the form is one card: three questions, two setups, nothing else', () => {
  const html = app.journalForm(journalled());
  assert.equal((html.match(/jm-card/g) || []).length, 1);
  for (const name of ['followed_rules', 'followed_sl', 'followed_tp']) {
    assert.ok(html.includes(`name="${name}"`), `missing ${name}`);
  }
  assert.equal((html.match(/name="jf-setup"/g) || []).length, 2);
  assert.equal(html.includes('type="checkbox"'), false);   // the chip pickers are gone
});

test('the form reflects the answers already saved', () => {
  const html = app.journalForm(journalled({ followed_sl: false, setup: 'Support & Resistance' }));
  assert.match(html, /id="followed_sl-no" value="no" checked/);
  assert.match(html, /id="followed_rules-yes" value="yes" checked/);
  assert.match(html, /value="Support &amp; Resistance" checked/);
});

test('an unanswered question renders with neither pill selected', () => {
  const html = app.journalForm(trade());
  assert.equal(/id="followed_rules-(yes|no)"[^>]*checked/.test(html), false);
});

test('the modal opens onto the form alone, with no broker controls', () => {
  // Direction, P&L and the filing day are rewritten by the poller every two
  // minutes, so the modal does not offer them at all — a disabled control over
  // a value this app cannot set is still a control it has to explain.
  seed([journalled({ id: 'PID1', pnl: 57.1 })]);
  app.Journal.open('PID1');

  assert.equal(app.Journal.id, 'PID1');
  assert.equal($('journal-modal').classList.contains('open'), true);
  const card = win.document.querySelector('.journal-modal-card');
  assert.equal(card.children.length, 1);                  // #jm-body and nothing above it
  assert.equal(card.querySelector('input[type="number"]'), null);
  assert.equal(card.querySelector('input:disabled'), null);
  assert.equal($('jm-body').querySelectorAll('.jm-card').length, 1);

  app.Journal.close();
  assert.equal($('journal-modal').classList.contains('open'), false);
  assert.equal(app.Journal.id, null);
});

/* ─── Sorting ────────────────────────────────────────────────────────────── */

test('the sort runs on the true execution instant, oldest first', () => {
  const rows = [
    journalled({ id: 'PID1', entry_time: '2026-07-30T16:00:00Z' }),
    journalled({ id: 'PID2', entry_time: '2026-07-28T09:00:00Z' }),
    journalled({ id: 'PID3', entry_time: null, fill_time: '2026-07-29T09:00:00Z' })
  ];
  assert.deepEqual([...rows].sort(app.byKey).map(t => t.id), ['PID2', 'PID3', 'PID1']);
});

test('two rows with the identical key compare equal rather than swapping', () => {
  // Pre-poller rows carry no entry_time and no fill_time, so everything filed on
  // one day ties. A comparator that never returns 0 lets them trade places
  // between renders, which reads as the log shuffling itself for no reason.
  const a = journalled({ id: 'PID1', entry_time: null, fill_time: null });
  const b = journalled({ id: 'PID2', entry_time: null, fill_time: null });
  assert.equal(app.byKey(a, b), 0);
  assert.deepEqual([a, b].sort(app.byKey).map(t => t.id), ['PID1', 'PID2']);
  assert.deepEqual([b, a].sort(app.byKey).map(t => t.id), ['PID2', 'PID1']);
});
