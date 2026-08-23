/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — client tests
   ───────────────────────────────────────────────────────────────────────────
   index.html booted in jsdom against synthetic trades. See test/boot.mjs for
   how a single-file app with no exports is got at.

   Run:  npm test

   WHAT IS NOT COVERED, said plainly. These tests assert on values and on
   emitted markup; they cannot see pixels, so a renderer that produces correct
   HTML with broken CSS passes here. Supabase is a recording stand-in, so load
   and save are exercised but realtime and the auth paths are not. The xlsx
   export needs SheetJS from a CDN and is not exercised. And the Apps Script has
   no coverage at all, here or anywhere.

   One thing about the trade factory shapes every result test below: trade()
   defaults to entry 3400 and exit 3410, a $10 move. Under the price-based
   scratch rule that is decisively not a break-even, so a test that wants one
   has to say so in prices. That is the point — a P&L figure alone can no longer
   make a scratch.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, trade, journalled } from './boot.mjs';

let app, seed, $, win, close, db, charts;

before(async () => {
  ({ app, seed, $, win, close, db, charts } = await boot());
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
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -10, deleted: true })
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

test('a save replaces the row it names, in both row sets', async () => {
  /* replace() finds its row by id in `rows` AND in `all`, and `all` is what a
     backup exports. Match the wrong one and a save writes over someone else's
     trade; match nothing and it appends a duplicate. Neither shows on screen —
     the panel just quietly holds two of something. */
  db.error = null;
  db.rows = [journalled({ id: 'PID1', pnl: 10 }), journalled({ id: 'PID2', pnl: 20 })];
  await app.Data.load();

  app.Data.replace({ ...journalled({ id: 'PID2', pnl: 20 }), setup: 'Support & Resistance' });

  assert.equal(app.Data.rows.length, 2, 'the replacement was appended instead of replacing');
  assert.equal(app.Data.byId.get('PID2').setup, 'Support & Resistance');
  assert.equal(app.Data.byId.get('PID1').setup, 'Break & Retest', 'the wrong row was overwritten');

  // `all` is the set a backup exports, and it is the half that goes wrong
  // quietly: nothing on screen reads it, so a stale copy there shows up only in
  // a restore, which is the one thing a restore point cannot get wrong.
  assert.equal(app.Data.all.length, 2, 'the backup copy now holds two of one trade');
  assert.equal(app.Data.all.find(t => t.id === 'PID2').setup, 'Support & Resistance',
    'the backup copy still holds the pre-edit row');
});

/* ─── The scratch rule ───────────────────────────────────────────────────────
   A break-even is a distance in PRICE, and the reason is scale: $3 of P&L is $3
   of gold at 0.01 lots and three cents of gold at 1.00, so a dollar band would
   mean something different every time the account grew. Win and loss still come
   from the sign of the P&L — price distance is unsigned.
   ─────────────────────────────────────────────────────────────────────────── */

test('a scratch is measured in price, and the band is ±$3 inclusive', () => {
  const px = (entry, exit, pnl) => app.resultOf(trade({ entry_price: entry, exit_price: exit, pnl }));

  // The whole purpose of the rule: the same $3 of gold at a size where it is
  // $300 of account. A dollar band would have called both of these wins.
  assert.equal(px(4500, 4503, 300), 'be');
  assert.equal(px(4500, 4497, -300), 'be');

  // Inclusive, and the cent either side of it decides.
  assert.equal(px(4500, 4503.00, 300), 'be');
  assert.equal(px(4500, 4503.01, 301), 'win');
  assert.equal(px(4500, 4496.99, -301), 'loss');
  assert.equal(px(4500, 4500, 0), 'be');

  // And the converse: a trivial P&L over a real move is not a scratch. This is
  // the case a dollar band got wrong in the other direction.
  assert.equal(px(4500, 4520, 0.40), 'win');
});

test('a row with no prices falls back to the same $3 read against P&L', () => {
  // The pre-sync rows have no prices at all, so the rule cannot be evaluated
  // for them and they keep the only measure they have ever had. That set is
  // closed — every fill since the broker integration carries both prices — so
  // this branch shrinks rather than grows.
  const noPx = pnl => app.resultOf(trade({ entry_price: null, exit_price: null, pnl }));
  assert.equal(noPx(3.01), 'win');
  assert.equal(noPx(3.00), 'be');
  assert.equal(noPx(0), 'be');
  assert.equal(noPx(-3.00), 'be');
  assert.equal(noPx(-3.01), 'loss');

  // An open position is the same case from the other end: an entry price and no
  // exit yet, so there is no distance to measure.
  assert.equal(app.resultOf(trade({ exit_price: null, pnl: -40 })), 'loss');

  /* AND THE HALF-PRICED ROW INSIDE THE BAND, which is the case that separates
     "both prices" from "either price". A closed trade with an entry price and
     no exit is a real state — it is the signature the README gives for a
     position the poller folded without its entry deal — and with a P&L inside
     the band the two readings disagree: the missing price is null, so measuring
     the distance gives the other price itself, which is nowhere near ≤ 3, and
     the trade reads as a win it did not earn.

     The -40 above cannot see that. Its P&L is outside the band either way. */
  assert.equal(app.resultOf(trade({ exit_price: null, pnl: 1 })), 'be');
  assert.equal(app.resultOf(trade({ entry_price: null, pnl: 1 })), 'be');
});

test('no P&L is not a break-even', () => {
  // An open position journalled on entry. Filing it as a scratch would put it
  // in the win-rate denominator and drag every rate on the panel.
  assert.equal(app.resultOf(trade({ pnl: null })), null);
  assert.equal(app.resultOf(trade({ pnl: null, entry_price: 4500, exit_price: 4500 })), null);
});

test('an aggregate cell inherits the verdicts and has no dead band of its own', () => {
  // Several trades share no single entry and exit, so there is no price
  // distance to measure across them: a cell is a scratch only when every
  // decided trade inside it was one, and otherwise takes the sign of its total.
  assert.equal(app.aggregateResult(-4, 2, 2), 'be');     // both scratches
  assert.equal(app.aggregateResult(-6, 2, 0), 'loss');   // two real losses, small net
  assert.equal(app.aggregateResult(-6, 2, 1), 'loss');   // one scratch is not enough
  assert.equal(app.aggregateResult(1, 2, 1), 'win');
  assert.equal(app.aggregateResult(500, 3, 0), 'win');

  // Nothing priced — no colour at all, whatever number is handed in.
  assert.equal(app.aggregateResult(0, 0, 0), '');
  assert.equal(app.aggregateResult(500, 0, 0), '');
});

/* ─── Rates and money ────────────────────────────────────────────────────── */

test('break-evens sit in the win-rate denominator', () => {
  const c = app.counts([
    trade({ pnl: 100 }), trade({ pnl: 100 }),
    trade({ pnl: 1, entry_price: 4500, exit_price: 4501 }),   // scratch, stated in prices
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

test('the money split is on the sign, so a scratch still moves the dollars', () => {
  // money() splits on the sign and counts() labels on the rule, and this is the
  // one place the two are meant to disagree: a scratch is not a win, but its
  // dollars are still in gross profit.
  const scratch = trade({ pnl: 2.5, entry_price: 4500, exit_price: 4501 });
  assert.equal(app.resultOf(scratch), 'be');
  assert.equal(app.money([scratch]).gross, 2.5);
  assert.equal(app.money([scratch]).net, 2.5);
});

test('an average is bucketed on the result label, never on the sign', () => {
  /* THE ONE PLACE money() AND averages() MUST DIFFER. money() splits on the
     sign, so every dollar lands somewhere and profit minus loss equals net.
     averages() splits on the LABEL, because a scratch is a dollar but not a
     win — bucketed with the winners it adds nothing to the numerator and a
     whole trade to the denominator, halving an average win that should read
     $57.

     Two wins and a scratch, all positive, all inside money()'s gross. */
  const px = (entry, exit, pnl) => trade({ entry_price: entry, exit_price: exit, pnl });
  const { avgWin, avgLoss } = app.rangeStats(
    [px(4500, 4560, 57), px(4500, 4557, 57), px(4500, 4502, 2), px(4500, 4440, -30)],
    '2000-01-01', '2100-01-01');

  assert.equal(avgWin, 57, 'the scratch was averaged in with the winners');
  assert.equal(avgLoss, 30);
});

test('a range opens where the range before it closed', () => {
  /* The half-open bound is what makes that true: [start, end), so a trade
     filed ON the start day is inside the range rather than in its opening
     balance. Off by one in either direction and last month's closing figure
     stops equalling this month's opening one, which is the whole point of the
     panel. */
  const on = (day, pnl) => trade({ open_day: day, entry_price: 4500, exit_price: 4600, pnl });
  const rows = [on('2026-07-31', 10), on('2026-08-01', 100), on('2026-08-31', 5), on('2026-09-01', 999)];

  const aug = app.rangeStats(rows, '2026-08-01', '2026-09-01');
  assert.equal(aug.opening, 10, 'the range swallowed a day that belongs before it');
  assert.equal(aug.n, 2, 'the bound included the first day of the next range');
  assert.equal(aug.closing, 115);

  const sep = app.rangeStats(rows, '2026-09-01', '2026-10-01');
  assert.equal(sep.opening, aug.closing, 'September does not open where August closed');
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

/* ─── The week and the backup key ────────────────────────────────────────────
   The one rule that decides what "This Week" means, and the one that decides
   when the weekly backup fires. Both hinge on 17:00 New York, both take their
   date as an argument, and neither was covered — flipping either comparison
   left the suite green.
   ─────────────────────────────────────────────────────────────────────────── */

test('the week opens at the Sunday 17:00 New York gold open', () => {
  const wk = iso => app.Dates.weekStart(new Date(iso));

  // Sunday 16 Aug 2026, EDT. 20:00 UTC is 16:00 ET — before the open, so the
  // week that is running is still the one that began on the 9th. That is the
  // reason the rule is not a calendar Sunday: the gap between the Friday close
  // and the Sunday open is when the week gets reviewed, and a calendar anchor
  // would blank every figure at exactly that moment.
  assert.equal(wk('2026-08-16T20:00:00Z'), '2026-08-09');
  // 21:00 UTC is 17:00 ET exactly: the new week starts on the minute.
  assert.equal(wk('2026-08-16T21:00:00Z'), '2026-08-16');
  // And every day after it belongs to that Sunday.
  assert.equal(wk('2026-08-19T16:00:00Z'), '2026-08-16');
  assert.equal(wk('2026-08-22T23:00:00Z'), '2026-08-16');
});

test('the week boundary holds its New York hour in winter too', () => {
  // January: EST, so 17:00 ET is 22:00 UTC rather than 21:00. An hour built in
  // UTC would open the week an hour early for half the year.
  assert.equal(app.Dates.weekStart(new Date('2026-01-11T21:30:00Z')), '2026-01-04');
  assert.equal(app.Dates.weekStart(new Date('2026-01-11T22:00:00Z')), '2026-01-11');
});

test('the backup key is the Friday whose 17:00 New York close last passed', () => {
  const key = iso => app.Dates.lastClose(new Date(iso));

  // Fri 21 Aug 2026, EDT. Before 17:00 ET the week has not closed, so the key
  // is still the previous Friday and the backup does not fire twice.
  assert.equal(key('2026-08-21T20:00:00Z'), '2026-08-14');
  assert.equal(key('2026-08-21T21:00:00Z'), '2026-08-21');
  // It then holds all weekend and into the next week.
  assert.equal(key('2026-08-23T12:00:00Z'), '2026-08-21');
  assert.equal(key('2026-08-27T12:00:00Z'), '2026-08-21');
});

/* ─── Filing and sessions ────────────────────────────────────────────────── */

test('open_day is the filing anchor, the closing fill only its fallback', () => {
  assert.equal(app.dayOf(trade({ open_day: '2026-07-30' })), '2026-07-30');
  // 01:05 UTC on the 31st is 21:05 on the 30th in New York.
  assert.equal(app.dayOf(trade({ open_day: null, fill_time: '2026-07-31T01:05:00Z' })), '2026-07-30');
});

test('the current day comes from New York, not from the device', () => {
  // Dates.today() drives DayWatcher's rollover and the heatmap's opening month,
  // so a device clock here files a trade under the wrong day and resets the grid
  // at the wrong moment. Only discriminating when the runner is NOT on Eastern
  // time: run the suite with TZ=Asia/Tokyo and this is the test that catches a
  // regression to the device clock.
  const ny = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  assert.equal(app.Dates.today(), ny);
  assert.equal(app.Dates.nyMonth().y, +ny.slice(0, 4));
  assert.equal(app.Dates.nyMonth().m, +ny.slice(5, 7) - 1);   // zero-based, as View.heatmap wants
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

test('the day index counts scratches, which is what a cell inherits', () => {
  // The counter and the rule are two halves of one behaviour: aggregateResult
  // cannot inherit a verdict the index never recorded, and getting this wrong
  // shows up only as a calendar cell in the wrong colour.
  seed([
    journalled({ id: 'PID1', open_day: '2026-07-30', entry_price: 4500, exit_price: 4501, pnl: 1 }),
    journalled({ id: 'PID2', open_day: '2026-07-30', entry_price: 4500, exit_price: 4480, pnl: -20 }),
    journalled({ id: 'PID3', open_day: '2026-07-31', entry_price: 4500, exit_price: 4502, pnl: -2 })
  ]);
  const mixed = app.Data.day('2026-07-30');
  assert.equal(mixed.pnlN, 2);
  assert.equal(mixed.be, 1);
  assert.equal(app.aggregateResult(mixed.pnl, mixed.pnlN, mixed.be), 'loss');

  const allScratch = app.Data.day('2026-07-31');
  assert.equal(allScratch.be, 1);
  assert.equal(app.aggregateResult(allScratch.pnl, allScratch.pnlN, allScratch.be), 'be');
});

test('an open position is in the day list but not in its scratch count', () => {
  seed([
    journalled({ id: 'PID1', open_day: '2026-07-30', entry_price: 4500, exit_price: 4501, pnl: 1 }),
    journalled({ id: 'PID2', open_day: '2026-07-30', pnl: null, exit_price: null })
  ]);
  const d = app.Data.day('2026-07-30');
  assert.equal(d.list.length, 2);
  assert.equal(d.pnlN, 1);
  assert.equal(d.be, 1);
  // Every decided trade was a scratch, and the open one does not spoil that.
  assert.equal(app.aggregateResult(d.pnl, d.pnlN, d.be), 'be');
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
  assert.deepEqual({ n: d.list.length, pnl: d.pnl, pnlN: d.pnlN, be: d.be, pending: d.pending },
                   { n: 0, pnl: 0, pnlN: 0, be: 0, pending: false });
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
    journalled({ id: 'PID3', open_day: '2026-07-30', pnl: 1.5, setup: 'Break & Retest', entry_price: 4500, exit_price: 4501 }),
    trade({ id: 'PID4', open_day: '2026-07-30', pnl: null })
  ]);
  assert.deepEqual(failures, []);
  assert.ok($('trade-table').innerHTML.length > 0);
  assert.ok($('setup-table').innerHTML.length > 0);
});

test('the wheel row runs narrowest window to widest, left to right', () => {
  // CONFIG.PERIODS is the only definition of that row, so the list order and
  // the DOM order are the same fact — asserted together to keep them so.
  assert.deepEqual([...app.CONFIG.PERIODS].map(p => p.key), ['month', 'week', 'total']);
  renderClean([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })]);
  assert.deepEqual([...$('period-row').children].map(el => el.dataset.period),
    ['month', 'week', 'total']);
});

/* ─── What the charts were actually asked to draw ────────────────────────────
   The harness records every Chart the app builds — the constructor arguments,
   and the live `data` object every later update mutates in place. Nothing read
   it, so until now a wheel was tested for NOT THROWING and nothing else: a
   donut plotting its counts in the wrong order, or a curve that stopped
   accumulating, passed every assertion in this file.

   These read that recording. They are the only tests here that look at what a
   chart says rather than at whether it appeared.
   ─────────────────────────────────────────────────────────────────────────── */

// Charts are built once and updated in place, so the recording is searched by
// canvas id rather than by position, and the dataset is read live.
const chartFor = (id) => {
  // Last, not first: a wheel whose host replaced its canvas is legitimately
  // rebuilt, so the newest one on that id is the live one.
  const live = [...charts].reverse().find(c => c.canvas?.id === id && !c.destroyed);
  return live && live.data.datasets[0];
};

test('a wheel plots wins, losses and break-evens, in that order', () => {
  /* [w, l, be] is the order RESULT_FILL and RESULT_BORDER are frozen in, and
     the order the legend beside the wheel is written in markup. Three lists,
     one order — and the arcs are the copy nothing could see. */
  renderClean([
    journalled({ id: 'PID1', open_day: '2026-07-28', pnl: 40,  entry_price: 4500, exit_price: 4560 }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: 30,  entry_price: 4500, exit_price: 4550 }),
    journalled({ id: 'PID3', open_day: '2026-07-29', pnl: -22, entry_price: 4500, exit_price: 4470 }),
    journalled({ id: 'PID4', open_day: '2026-07-30', pnl: 1.5, entry_price: 4500, exit_price: 4501 }),
  ]);

  const set = chartFor('chart-total');
  assert.ok(set, 'the all-time wheel was never built');
  assert.deepEqual([...set.data], [2, 1, 1]);
});

test('a wheel with nothing decided draws the placeholder ring, not an empty one', () => {
  // A single full arc in the empty colour. Drawing [0,0,0] gives Chart.js
  // nothing to lay out and the panel loses its shape where a wheel should be.
  renderClean([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: null })]);

  const set = chartFor('chart-total');
  assert.deepEqual([...set.data], [1]);
  assert.equal(set.backgroundColor.length, 1, 'the placeholder took the result palette');
});

test('the curve is cumulative, and takes its colour from where it ended', () => {
  /* Each point is the running total, not the trade — a curve of individual
     P&Ls is a bar chart with the bars joined up, and says nothing about the
     account. The line is green or red on the FINAL value, which is the only
     thing the colour is claiming. */
  renderClean([
    journalled({ id: 'PID1', open_day: '2026-07-28', pnl: 100, entry_price: 4500, exit_price: 4600 }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -30, entry_price: 4500, exit_price: 4470 }),
    journalled({ id: 'PID3', open_day: '2026-07-30', pnl: -50, entry_price: 4500, exit_price: 4450 }),
  ]);

  const set = chartFor('chart-pnl');
  assert.ok(set, 'the curve was never built');
  assert.deepEqual([...set.data], [100, 70, 20]);
});

test('a curve that ends underwater is drawn in the loss colour', () => {
  renderClean([
    journalled({ id: 'PID1', open_day: '2026-07-28', pnl: 10,  entry_price: 4500, exit_price: 4510 }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -60, entry_price: 4500, exit_price: 4440 }),
  ]);

  const set = chartFor('chart-pnl');
  assert.deepEqual([...set.data], [10, -50]);
  // The two colours must differ, or the rule is decoration.
  const down = set.borderColor;
  renderClean([journalled({ id: 'PID1', open_day: '2026-07-28', pnl: 10, entry_price: 4500, exit_price: 4510 })]);
  assert.notEqual(chartFor('chart-pnl').borderColor, down,
    'a winning curve and a losing one are drawn the same colour');
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
});

test('the setup choice comes before the discipline questions', () => {
  // Order is the order of the decision: which setup this was, then whether it
  // was traded to plan.
  const html = app.journalForm(journalled());
  assert.ok(html.indexOf('jf-setup-row') < html.indexOf('jf-yn-row'));
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

test('the discipline answers are read from the modal body, not the document', () => {
  // pickRadio is scoped to #jm-body, so a decoy is the only way to assert it: an
  // identically named radio EARLIER in document order, answering the opposite
  // way. Unscoped, querySelector returns the decoy and the trader's answer is
  // silently replaced by a stray input.
  seed([journalled({ id: 'PID1', pnl: 57.1, setup: 'Support & Resistance', followed_sl: false })]);
  app.Journal.open('PID1');

  const decoy = win.document.createElement('input');
  decoy.type = 'radio'; decoy.name = 'followed_sl'; decoy.value = 'yes'; decoy.checked = true;
  win.document.body.insertBefore(decoy, win.document.body.firstChild);
  try {
    assert.equal(app.pickYN('followed_sl'), false);   // the form's NO, not the decoy's YES
    assert.equal(app.pickYN('followed_rules'), true);
  } finally {
    decoy.remove();
    app.Journal.close();
  }
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
