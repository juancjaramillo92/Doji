/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — client tests
   ───────────────────────────────────────────────────────────────────────────
   index.html booted in jsdom against synthetic trades. See test/boot.mjs for
   how a single-file app with no exports is got at.

   Run:  npm test

   WHAT IS NOT COVERED, said plainly. These tests assert on values and on
   emitted markup; they cannot see pixels, so a renderer that produces correct
   HTML with broken CSS passes here. Supabase is a recording stand-in, so load
   and save are exercised, and so is each answer a boot can get about the
   session, but realtime and the auth server itself are not. The xlsx
   export is exercised against a recording SheetJS stub, so the rows it builds
   are asserted and the bytes SheetJS writes from them are not. And the Apps
   Script has no coverage at all, here or anywhere.

   One thing about the trade factory shapes every result test below: trade()
   defaults to entry 3400 and exit 3410, a $10 move. Under the price-based
   scratch rule that is decisively not a break-even, so a test that wants one
   has to say so in prices. That is the point — a P&L figure alone can no longer
   make a scratch.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, trade, journalled } from './boot.mjs';

let app, seed, $, win, close, db, charts, sheets;

before(async () => {
  ({ app, seed, $, win, close, db, charts, sheets } = await boot());
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

/* THE SAME THREE-STATE, EVERYWHERE IT IS READ. `isComplete` is only one of six
   consumers of these columns, and the other five each answer a different
   question about the same null: what the bars count, what the log draws, what
   the form pre-selects, what a save writes back, and what the export says. A
   null read as a `no` in any one of them is the journal reporting a rule broken
   that was never answered — and the bar is the worst of the six, because a
   violation is exactly what the trader is looking for there. */

test('an unanswered question is outside the compliance bar, not inside it as a no', () => {
  // One answered YES and one never answered. The bar is 1 of 1, not 1 of 2:
  // the second trade has nothing to say about the rule and must not be counted
  // as having broken it.
  renderClean([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 }),
    journalled({ id: 'PID2', open_day: '2026-07-30', pnl: 40, followed_rules: null })
  ]);
  // The ratio is in the track's title; the percentage is what he reads.
  const rules = $('disc-bars-total').querySelector('.period-disc-row');
  assert.match(rules.textContent, /Rules/, 'the first bar is the rules bar');
  assert.equal(rules.querySelector('.sess-wr-track').getAttribute('title'),
    '1/1 followed',
    'the unanswered rule was counted into the population it says nothing about');
  assert.equal(rules.querySelector('.period-disc-pct').textContent, '100%',
    'a question never answered is being reported as a rule broken');
});

test('the log draws an unanswered question as unanswered, never as a cross', () => {
  renderClean([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40,
    followed_rules: true, followed_sl: false, followed_tp: null })]);
  const row = $('trade-table').querySelector('tr[data-trade="PID1"]');
  assert.ok(row, 'the row is not in the log');
  assert.equal(row.querySelectorAll('.rules-tick').length, 1, 'the YES');
  assert.equal(row.querySelectorAll('.rules-cross').length, 1,
    'the NO — and only the NO. A null drawn as a cross is a broken rule the ' +
    'trader never reported');
});

test('a question left unanswered saves as unanswered, not as a no', () => {
  // The form path, which is the one that writes. pickYN reads the radios; with
  // neither pill selected there is no answer to read, and null is the only
  // honest thing to send — `false` would put a rule breach in the database that
  // nobody ever typed, and nothing downstream could tell it from a real one.
  seed([trade({ id: 'PID1' })]);
  app.Journal.open('PID1');
  try {
    assert.equal(app.pickYN('followed_rules'), null);
    assert.equal(app.pickYN('followed_sl'), null);
    assert.equal(app.pickYN('followed_tp'), null);
  } finally { app.Journal.close(); }
});

/* ─── A day that ended where it started ──────────────────────────────────────
   Exactly zero has no sign, so the sign rule cannot answer it, and it used to
   fall through to `loss`: one real win and one real loss cancelling out was a
   red day. It went nowhere, which is what break-even means.

   It is a POINT and not a band, so nothing else moves — a day netting a few
   dollars off two real losses is still two real losses, and there is still no
   dead zone for cells.
   ─────────────────────────────────────────────────────────────────────────── */

test('a day that nets exactly nothing is a break-even day', () => {
  // Two real trades, neither a scratch: $60 of price each way.
  assert.equal(app.aggregateResult(0, 2, 0), 'be');
  // And the neighbouring cents are untouched — this is a point, not a band.
  assert.equal(app.aggregateResult(0.01, 2, 0), 'win');
  assert.equal(app.aggregateResult(-0.01, 2, 0), 'loss');
  // A day with nothing decided still takes no colour at all.
  assert.equal(app.aggregateResult(0, 0, 0), '');
});

test('a trade that made exactly nothing is a break-even trade', () => {
  /* THE TWO LEVELS HAVE TO AGREE OR ONE TRADE GETS TWO VERDICTS. A day holding
     a single trade that netted zero would otherwise read BE on the calendar and
     Loss in the log — the same trade, contradicting itself on one screen.

     The price band cannot reach this case: a trade can move sixty dollars and
     come back to zero once commission is in. The band is in price because a
     band does not scale; zero is the value that needs no scaling. */
  const px = (entry, exit, pnl) => trade({ entry_price: entry, exit_price: exit, pnl });
  assert.equal(app.resultOf(px(4400, 4460, 0)), 'be',
    'a trade that made nothing was called a loss');
  // The cent either side is still decided on its sign.
  assert.equal(app.resultOf(px(4400, 4460, 0.01)), 'win');
  assert.equal(app.resultOf(px(4400, 4460, -0.01)), 'loss');
  // And no P&L at all is still undecided rather than break-even.
  assert.equal(app.resultOf(px(4400, 4460, null)), null);

  // The day agrees with the trade it holds.
  const t = px(4400, 4460, 0);
  assert.equal(app.aggregateResult(0, 1, app.resultOf(t) === 'be' ? 1 : 0), 'be');
});

test('a zero-net day sits in the win-rate denominator like any break-even', () => {
  // It is a decided day made of decided trades — nothing here becomes invisible.
  const px = (entry, exit, pnl) => trade({ entry_price: entry, exit_price: exit, pnl });
  const c = app.counts([px(4400, 4460, 50), px(4400, 4340, -50)]);
  assert.equal(c.decided, 2);
  assert.equal(c.win, 1);
  assert.equal(c.loss, 1);
  assert.equal(c.be, 0, 'the two trades are still a real win and a real loss');
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
    pnl: 999, direction: 'SELL', entry_time: '2026-01-01T00:00:00Z',
    size_oz: 4, deleted: true
  });

  assert.equal(db.patches.length, 1);
  assert.deepEqual(Object.keys(db.patches[0]).sort(),
    ['followed_rules', 'followed_sl', 'followed_tp', 'setup']);
});

/* ─── The balance window ─────────────────────────────────────────────────────
   openBal and lastBal are the same read against two different bounds, and that
   bound is the only thing separating them. Lose it and a month opens and closes
   on the identical figure — a roll-forward showing no movement at all, which
   looks like a quiet month rather than like a broken one.

   Nothing covered this until the two loops behind it were collapsed into one
   and the mutation went unnoticed.
   ─────────────────────────────────────────────────────────────────────────── */

test('a month opens on the balance before it and closes on the last inside it', () => {
  const rows = [
    trade({ id: 'PID1', open_day: '2026-07-31', entry_time: '2026-07-31T14:00:00.000Z',
            balance: 1000, pnl: 10 }),
    trade({ id: 'PID2', open_day: '2026-08-10', entry_time: '2026-08-10T14:00:00.000Z',
            balance: 1200, pnl: 20 }),
    trade({ id: 'PID3', open_day: '2026-09-02', entry_time: '2026-09-02T14:00:00.000Z',
            balance: 1500, pnl: 30 })
  ];
  const aug = app.rangeStats(rows, '2026-08-01', '2026-09-01');

  // Half-open [start, end): July's balance opens August, August's closes it, and
  // September's is outside the window entirely.
  assert.equal(aug.openBal, 1000, 'the opening balance is not the one before the month');
  assert.equal(aug.lastBal, 1200, 'the closing balance reached past the end of the month');
  assert.notEqual(aug.openBal, aug.lastBal,
    'the month opens and closes on one figure — the day bound has stopped applying');
});

test('a month with no balance before it opens on nothing rather than on its own', () => {
  const rows = [
    trade({ id: 'PID1', open_day: '2026-08-10', entry_time: '2026-08-10T14:00:00.000Z',
            balance: 1200, pnl: 20 })
  ];
  const aug = app.rangeStats(rows, '2026-08-01', '2026-09-01');
  assert.equal(aug.openBal, null, 'the month opened on a balance from inside itself');
  assert.equal(aug.lastBal, 1200);
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

/* ─── The account the sizing implies ─────────────────────────────────────────
   Balance is the portion at the broker. This is the base the ladder was applied
   to, which includes what is held off it — so the two are different numbers and
   the caption must not read as though it were restating the one above it.
   ─────────────────────────────────────────────────────────────────────────── */

test('the latest size is read as lots and as the account the ladder implies', () => {
  app.renderPnLCard(seed([
    trade({ id: 'PID1', open_day: '2026-07-29', entry_time: '2026-07-29T14:00:00.000Z',
            size_oz: 2, balance: 500 }),
    trade({ id: 'PID2', open_day: '2026-07-30', entry_time: '2026-07-30T14:00:00.000Z',
            size_oz: 4, balance: 500 })
  ]));
  // 4 oz is 0.04 lots, and 0.02 lots per 1,000 makes that a 2,000 account.
  assert.equal($('pnl-balance-at').textContent, '0.04 lots — sizing for 2000');
});

test('the newest size wins outright — rungs are stepped, never averaged', () => {
  app.renderPnLCard(seed([
    trade({ id: 'PID1', open_day: '2026-07-29', entry_time: '2026-07-29T14:00:00.000Z',
            size_oz: 10, balance: 500 }),
    trade({ id: 'PID2', open_day: '2026-07-30', entry_time: '2026-07-30T14:00:00.000Z',
            size_oz: 2, balance: 500 })
  ]));
  // A mean of 10 and 2 would read 0.06 lots and describe an account that has
  // never existed.
  assert.equal($('pnl-balance-at').textContent, '0.02 lots — sizing for 1000');
});

test('no row carries a size, so the caption says nothing rather than zero', () => {
  app.renderPnLCard(seed([trade({ id: 'PID1', size_oz: null, balance: 500 })]));
  // Every row predating the column is this case, and 0 lots would be a claim.
  assert.equal($('pnl-balance-at').textContent, '');
});

test('the awaiting notice outranks the sizing line, because it owns the figure above', () => {
  app.renderPnLCard(seed([trade({ id: 'PID1', size_oz: 4, balance: null })]));
  // The poller writes size and the email writes balance, so this pair is a real
  // state and not a contrived one. The dash above needs explaining first.
  assert.equal($('pnl-balance-at').textContent, 'awaiting a synced fill');
});

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

test('a bucket with nothing in it averages to nothing, never to zero', () => {
  /* null and 0 are different claims — 0 says the average loss IS zero, which is
     what a divide-by-zero produces once it has been coerced, and it is the
     number the R:R bar then divides by. So the empty bucket is the case the
     guard exists for, and it had never been driven. */
  const px = (entry, exit, pnl) => trade({ entry_price: entry, exit_price: exit, pnl });
  const range = (rows) => app.rangeStats(rows, '2000-01-01', '2100-01-01');

  const noLosses = range([px(4500, 4560, 57), px(4500, 4540, 41)]);
  assert.equal(noLosses.avgWin, 49);
  assert.equal(noLosses.avgLoss, null, 'no losses yet is not an average loss of zero');

  const noWins = range([px(4500, 4440, -30), px(4500, 4460, -20)]);
  assert.equal(noWins.avgLoss, 25);
  assert.equal(noWins.avgWin, null, 'no wins yet is not an average win of zero');

  // A window of nothing but scratches decides neither bucket.
  const allScratch = range([px(4500, 4502, 2), px(4500, 4498, -2)]);
  assert.equal(allScratch.avgWin, null);
  assert.equal(allScratch.avgLoss, null);
});

test('a run of wins with no loss behind it shows a ceiling, not a division', () => {
  /* avgLoss is null there, and null coerces to 0 — so an unguarded ratio is
     Infinity, which reaches the panel as "Infinity:1" and hands the segment
     widths NaN. The cap is a ceiling and says so; what it must never be is a
     computed value. */
  renderClean([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 57, entry_price: 4500, exit_price: 4560 }),
    journalled({ id: 'PID2', open_day: '2026-07-30', pnl: 41, entry_price: 4500, exit_price: 4540 })
  ]);
  const rr = $('rr-bar-total').textContent;
  assert.match(rr, /RR Ratio/);
  assert.match(rr, /9\.99:1/, `the ratio was divided rather than capped: ${rr.trim()}`);
  assert.doesNotMatch(rr, /Infinity|NaN/);
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
  // The same Sunday at 00:30 ET, which is the hour the CYCLE decides. `hour <
  // 17` is written for a midnight that arrives as 0; a formatter left to pick
  // its own cycle can hand back 24, and 24 is not less than 17 — so this one
  // instant would file the small hours of Sunday under the week that has not
  // opened yet, and every figure on screen would jump a week for an hour.
  assert.equal(wk('2026-08-16T04:30:00Z'), '2026-08-09');
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

test('a full render leaves every row exactly as it found it', () => {
  /* No renderer mutates state, which is a rule this file states and nothing
     checked. Freezing would not catch it: the app is a classic script in sloppy
     mode, so a write to a frozen object fails silently rather than throwing —
     the render would pass and the row would simply not have changed. So the
     rows are compared before and after instead, which catches the write however
     the engine treats it.

     It matters most where it would be least visible. A renderer that sorted
     Data.rows in place, or stamped a derived field onto a row to save
     recomputing it, would leave every assertion in this file passing and change
     what the NEXT render draws. */
  /* Deliberately NEWEST first, so the order is one byKey would change. Given
     the factory's default entry_time on every row the sort is stable and a
     renderer sorting in place reorders nothing — a fixture that cannot show the
     mutation asserts only that it did not happen to it. */
  const rows = [
    journalled({ id: 'PID3', open_day: '2026-07-30', pnl: 12, setup: 'Break & Retest',
                 entry_time: '2026-07-30T16:00:00Z' }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -22, setup: 'Support & Resistance',
                 entry_time: '2026-07-29T11:00:00Z', followed_sl: false }),
    journalled({ id: 'PID1', open_day: '2026-07-28', pnl: 57.1, setup: 'Break & Retest',
                 entry_time: '2026-07-28T09:00:00Z' }),
  ];
  const before = JSON.stringify(rows);
  assert.deepEqual(renderClean(rows), [], 'a step failed, so this proves nothing');
  assert.equal(JSON.stringify(rows), before,
    'a render step wrote to the rows it was given');
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

  // The counts alone do not hold the order: reversed fills would draw the wins
  // red and every assertion above would still pass. Chart.js cannot read a CSS
  // variable, so the palette is resolved into a module constant — and this is
  // the only thing checking that copy still lines up with the stylesheet.
  const token = (name) =>
    win.getComputedStyle(win.document.documentElement).getPropertyValue(name).trim();

  assert.deepEqual([...set.backgroundColor],
    [token('--seg-win-bg'), token('--seg-loss-bg'), token('--seg-be-bg')],
    'the arc fills no longer run win, loss, break-even');
  assert.deepEqual([...set.borderColor],
    [token('--win'), token('--loss'), token('--seg-be-bd')],
    'the arc borders no longer run win, loss, break-even');
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
  assert.equal(card.querySelector('input:disabled'), null);

  /* BY NAME, NOT BY INPUT TYPE. Every answer on this form is a pill, so "no
     free-text control" and "no broker control" happen to hold together here and
     only one of them is the guarantee. Naming the columns says which. */
  for (const broker of ['direction', 'entry_time', 'fill_time', 'entry_price',
                        'exit_price', 'size_oz', 'open_day', 'commission',
                        'balance', 'net_pnl', 'computed_pnl', 'pnl']) {
    assert.equal(card.querySelector(`[name="${broker}"], #jf-${broker}`), null,
      `the modal offers a control over ${broker}, which the poller rewrites every two minutes`);
  }
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


/* ─── What the export actually carries ───────────────────────────────────────
   The export was the last surface here reading these columns with nothing
   watching it, and the reason was mechanical rather than deliberate: SheetJS
   arrives from a CDN, so the whole of IO.journal() sat behind a fetch. It does
   not any more — the harness puts a recording stand-in on window.XLSX, which is
   the one condition loadXLSX() checks, so every line the app owns runs and the
   rows it hands over are read back.

   What this cannot see is SheetJS itself: the workbook is a stub, so a column
   width or a sheet name would pass here and be wrong in the file. The numbers
   are the part worth holding, and they are the part that is now held.
   ─────────────────────────────────────────────────────────────────────────── */

test('the export carries the figures the screen carries', async () => {
  seed([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 57.1, setup: 'Break & Retest',
                 entry_time: '2026-07-30T14:00:00Z' }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -22, setup: 'Support & Resistance',
                 entry_time: '2026-07-29T09:00:00Z', followed_sl: false })
  ]);
  const before = sheets.length;
  await app.IO.journal();
  assert.equal(sheets.length, before + 1, 'the export built no sheet');

  const rows = sheets[sheets.length - 1].rows;
  assert.equal(rows.length, 2);

  // Same P&L, same result label and same session the panel derives — read from
  // the app rather than typed here, so this cannot drift into its own opinion
  // of what a trade is.
  for (const row of rows) {
    const t = app.Data.byId.get(row.Date.includes('30') ? 'PID1' : 'PID2');
    assert.equal(row['P&L ($)'], t.pnl);
    assert.equal(row.Session, app.sessionOf(t));
    assert.equal(row.Setup, t.setup);
    assert.equal(row.Result,
      { win: 'Win', loss: 'Loss', be: 'Break Even' }[app.resultOf(t)]);
  }
});

test('the export says nothing where a question was never answered', () => {
  // The sixth reader of the three-state boolean, and the one that leaves the
  // app: a null written out as "No" is a rule breach in a file he may hand to
  // someone else, with no way back to the fact that he simply never answered.
  const cell = sheets[sheets.length - 1].rows.find(r => r.Setup === 'Break & Retest');
  assert.equal(cell['Followed Rules'], 'Yes');

  return (async () => {
    seed([journalled({ id: 'PID3', open_day: '2026-07-30', pnl: 12,
                       followed_rules: null, followed_sl: false })]);
    await app.IO.journal();
    const row = sheets[sheets.length - 1].rows[0];
    assert.equal(row['Followed Rules'], '',
      'an unanswered question left the app as an answer');
    assert.equal(row['Followed Stop Loss'], 'No', 'a real NO must still say No');
    assert.equal(row['Followed Take Profit'], 'Yes');
  })();
});

/* ─── The snapshot, which is a full copy of the journal on the device ────────
   It exists so the panel is drawn before the fetch answers, and it is written
   in plaintext to localStorage. Two properties matter and neither was tested:
   it is only ever written from what the database confirmed, and it is gone the
   moment he signs out. Left behind, the next person to open the laptop gets the
   login screen and the previous session's trade history one keypress apart —
   and there is nothing to notice, because everything on screen looks right.
   ─────────────────────────────────────────────────────────────────────────── */

test('a confirmed load leaves a snapshot, and a failed one is drawn from it', async () => {
  const key = app.CONFIG.SNAPSHOT;
  win.localStorage.removeItem(key);

  db.rows = [journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })];
  db.error = null;
  await app.Data.load();
  assert.equal(app.Data.offline, false);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(key)).map(t => t.id), ['PID1'],
    'a load the database confirmed left nothing to draw from next time');

  // Now the database refuses. The rows must come back off the snapshot, and
  // the dot must say so rather than showing a confident empty panel.
  db.error = { message: 'network' };
  await app.Data.load();
  assert.equal(app.Data.offline, true);
  // Spread first: Data.rows lives in the jsdom realm, and deepStrictEqual
  // compares prototypes — the same idiom every array assertion here uses.
  assert.deepEqual([...app.Data.rows].map(t => t.id), ['PID1']);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(key)).map(t => t.id), ['PID1'],
    'a failed load overwrote the snapshot with what it did not get');
  db.error = null;
});

test('signing out takes the journal off the device', async () => {
  const key = app.CONFIG.SNAPSHOT;
  win.localStorage.setItem(key, JSON.stringify([{ id: 'PID1' }]));
  // location.reload() is not implemented in jsdom and is the last thing signOut
  // does; the clearing happens before it and is what this is about.
  try { await app.Login.signOut(); } catch { /* the reload, not the clear */ }
  assert.equal(win.localStorage.getItem(key), null,
    'the snapshot survived sign-out — the next person sees the login screen ' +
    'and the previous session\'s trades one keypress apart');
});

/* ─── Opening it with no network ─────────────────────────────────────────────
   The README promises the journal opens and draws from the snapshot without a
   connection. It did not: supabase-js answers a server it cannot reach with
   the same `error` it uses for a refusal, the session check failed first, and
   the login screen came up — where nothing can be done offline — in front of a
   journal the device already held. Driven through the real boot, because the
   load() test above passed the whole time this was broken.
   ─────────────────────────────────────────────────────────────────────────── */

const settle = () => new Promise(r => setTimeout(r, 20));
const UNREACHABLE = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };

test('an open that cannot reach the server draws the snapshot, read-only', async () => {
  const dev = await boot({
    snapshot: [journalled({ id: 'PID7', open_day: '2026-07-30', pnl: 40 })],
    auth: { getSession: async () => ({ data: { session: null }, error: UNREACHABLE }) },
  });
  try {
    await settle();
    assert.ok(!dev.$('login-overlay').classList.contains('open'),
      'the login screen came up offline, in front of the journal the device holds');
    assert.equal(dev.app.Data.offline, true, 'drawn from the snapshot without going read-only');
    assert.deepEqual([...dev.app.Data.rows].map(t => t.id), ['PID7']);
    assert.ok(dev.$('trade-table').querySelector('tr[data-trade="PID7"]'),
      'the snapshot was read and never drawn');
    assert.equal(dev.$('sync-dot').className, 'sync-dot offline');
  } finally { dev.close(); }
});

test('a session that is genuinely gone still asks him to sign in', async () => {
  const dev = await boot({
    snapshot: [journalled({ id: 'PID7' })],
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  });
  try {
    await settle();
    assert.ok(dev.$('login-overlay').classList.contains('open'),
      'a signed-out device drew the previous session from its snapshot');
    assert.equal(dev.$('trade-table').querySelector('tr[data-trade]'), null);
  } finally { dev.close(); }
});

test('a refused user check is a sign-in, an unreachable one is the snapshot', async () => {
  const session = async () => ({ data: { session: { access_token: 't' } }, error: null });
  const refused = await boot({
    snapshot: [journalled({ id: 'PID7' })],
    auth: { getSession: session,
            getUser: async () => ({ data: { user: null }, error: { name: 'AuthApiError', status: 401 } }) },
  });
  try {
    await settle();
    assert.ok(refused.$('login-overlay').classList.contains('open'), 'a refused session was drawn anyway');
  } finally { refused.close(); }

  const away = await boot({
    snapshot: [journalled({ id: 'PID7' })],
    auth: { getSession: session,
            getUser: async () => ({ data: { user: null }, error: UNREACHABLE }) },
  });
  try {
    await settle();
    assert.ok(!away.$('login-overlay').classList.contains('open'),
      'an unreachable user check sent him to a login he cannot complete offline');
  } finally { away.close(); }
});

test('signing in from the login screen draws her card, as a signed-in boot does', async () => {
  const dev = await boot();
  try {
    await settle();
    dev.db.tables.eugenia_thesis = [{ thesis: 'The market is trading the December cut.', moved_on: null }];
    dev.db.tables.eugenia_calendar = [];
    dev.db.tables.eugenia_loops = [];
    dev.$('login-email').value = 'him@doji.test';
    dev.$('login-pass').value = 'secret';
    await dev.app.Login.submit();
    await settle();
    assert.equal(dev.$('watch-card').style.display, 'flex',
      'the card is drawn only by a boot that found a session, never after a sign-in');
  } finally { dev.close(); }
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

/* ─── What Eugenia is watching ───────────────────────────────────────────────
   The only place her work and this page meet. Everything she knows has lived in
   a Telegram thread; three small reads put the three things worth a glance on
   the screen he already opens every morning.

   The card is drawn from model-written text, which is why the escaping test
   below is not ceremony: her calendar entries and her thesis are prose she
   composed, and prose reaches innerHTML.
   ─────────────────────────────────────────────────────────────────────────── */

const watching = async ({ calendar = [], thesis = [], loops = [] } = {}) => {
  db.tables.eugenia_calendar = calendar;
  db.tables.eugenia_thesis   = thesis;
  db.tables.eugenia_loops    = loops;
  db.error = null;
  await app.Watch.draw();
  return $('watch-card');
};

test('the card stays hidden when she has nothing to show', async () => {
  // A database without 005 applied, or a quiet Sunday. An empty frame captioned
  // "no data" is worse than the absence it describes.
  const el = await watching();
  assert.equal(el.style.display, 'none');
});

test('the card shows what lands today, the story, and what is still open', async () => {
  const el = await watching({
    calendar: [{ at: '2026-01-09T13:30:00Z', name: 'core CPI', importance: 'high',
                 consensus: '0.3%', actual: null, note: null }],
    thesis:   [{ thesis: 'Still trading the December cut.', moved_on: '2026-01-08' }],
    loops:    [{ kind: 'question', body: 'Which does he think is bigger?' }],
  });

  assert.notEqual(el.style.display, 'none');
  assert.match(el.innerHTML, /core CPI/);
  assert.match(el.innerHTML, /0\.3% exp/);
  assert.match(el.innerHTML, /Still trading the December cut/);
  assert.match(el.innerHTML, /Which does he think is bigger/);
  // The time is New York's, which is the clock every other time in this system
  // is kept in. 13:30Z in January is 08:30 there.
  assert.match(el.innerHTML, /08:30/);
});

test('a landed release is not drawn as one still to come', async () => {
  const el = await watching({
    calendar: [{ at: '2026-01-09T13:30:00Z', name: 'core CPI', importance: 'high',
                 consensus: '0.3%', actual: '0.4%', note: 'Hotter.' }],
  });
  assert.match(el.innerHTML, /0\.4%/);
  assert.match(el.innerHTML, /vs 0\.3%/);
  // The class is how a landed one reads differently at a glance, and it takes
  // an existing token rather than a fourth accent nobody could name.
  assert.match(el.innerHTML, /watch-landed/);
  assert.ok(!/exp<\/span>/.test(el.innerHTML), 'a printed number is still labelled as expected');
});

test('her prose is escaped before it reaches the page', async () => {
  /* SHE WRITES THIS TEXT AND IT REACHES innerHTML. Nothing here is hostile, but
     a thesis containing a stray angle bracket would silently eat the rest of
     the card — and the same hole is the one that matters if anything ever
     writes to these tables but her. */
  const el = await watching({
    thesis: [{ thesis: '<img src=x onerror="window.__pwned=1">', moved_on: null }],
  });
  assert.ok(!el.querySelector('img'), 'a tag in her thesis was parsed as markup');
  assert.equal(win.__pwned, undefined);
  assert.match(el.innerHTML, /&lt;img/);
});

test('a card that cannot be read costs the card and nothing else', async () => {
  /* 005 NOT APPLIED IS THE LIKELY CAUSE, and it must not reach him as anything.
     Drawn first, so the card is genuinely visible before the failing read —
     otherwise this passes on a card that was already hidden, which is how the
     check would go green against a catch that does nothing at all. */
  await watching({ thesis: [{ thesis: 'A story.', moved_on: null }] });
  assert.notEqual($('watch-card').style.display, 'none');

  /* AND THE FAILURE IS NOTICED, not merely survived. supabase-js resolves a
     failed read as `{ data: null, error }` rather than throwing, so `data || []`
     turns a missing table into an empty calendar — the card hides itself, the
     warning never fires, and why it is blank becomes unknowable. Asserting only
     that it ends up hidden cannot tell that apart from a quiet Sunday, which is
     the whole reason the warning is what this checks. */
  const warned = [];
  const realWarn = win.console.warn;
  win.console.warn = (...a) => warned.push(a.join(' '));

  db.error = { message: 'relation "eugenia_calendar" does not exist' };
  await app.Watch.draw();
  win.console.warn = realWarn;

  assert.equal($('watch-card').style.display, 'none');
  assert.ok(warned.some(w => /Eugenia card unavailable/.test(w)),
    'a failed read hid the card without reporting it, which is indistinguishable ' +
    'from a day with nothing on the calendar');
  // The journal is untouched — which is the whole reason this read runs after
  // the render and is never awaited by it.
  assert.ok($('trade-table'));
  db.error = null;
});

test('the card reads her three tables and never her notes', async () => {
  db.read.length = 0;
  await watching({ thesis: [{ thesis: 'A story.', moved_on: null }] });
  const touched = new Set(db.read);
  assert.ok(touched.has('eugenia_calendar'));
  assert.ok(touched.has('eugenia_thesis'));
  assert.ok(touched.has('eugenia_loops'));
  /* HER NOTES STAY OUT. They are working memory, and his window into them is
     /notes in her own thread, where an answer can be asked a question back. */
  assert.ok(!touched.has('eugenia_notes'), 'the card reads her notes');
  assert.ok(!touched.has('eugenia_turns'), 'the card reads her conversation');
});

/* ─── Soft delete and the window that takes it back ──────────────────────────
   Audit 4.9, which had never run. The code turns out to be right; nothing was
   checking it, and it is the one path in the app that can lose a trade.

   The delete is soft because it has to be: the poller re-upserts every position
   inside its window, so a hard delete comes back within two minutes. That makes
   `deleted` a column the app writes and `Data.OWNED` does not name — `remove()`
   and `restore()` call `update()` directly rather than going through `save()` —
   which is worth knowing before anyone builds a column list out of `OWNED` and
   wonders why delete stopped working.

   Two row sets move, and they move differently. `rows` is what renders and the
   row leaves it; `all` is what the backup exports and the row STAYS, flagged.
   Getting that backwards exports a deleted trade as live, or loses it from the
   backup entirely, and neither shows on screen.
   ─────────────────────────────────────────────────────────────────────────── */

const staged = async (rows) => {
  db.error = null;
  db.rows = rows;
  await app.Data.load();
  db.patches.length = 0;
};

test('a delete leaves the rendered rows and stays in the backup, flagged', async () => {
  await staged([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -10 })
  ]);

  assert.equal(await app.Data.remove('PID1'), true);

  assert.deepEqual(db.patches.map(p => ({ ...p })), [{ deleted: true }],
    'the delete sent something other than the soft-delete flag');
  assert.deepEqual([...app.Data.rows].map(t => t.id), ['PID2'],
    'the deleted trade still renders');
  assert.equal(app.Data.all.length, 2, 'the deleted trade left the backup');
  assert.equal(app.Data.all.find(t => t.id === 'PID1').deleted, true,
    'the backup copy is not flagged, so a restore point exports it as live');
  // Re-indexed on the way out, or every render still reads it through byId.
  assert.equal(app.Data.byId.has('PID1'), false, 'the index still holds the row');
});

test('a failed delete changes nothing locally', async () => {
  await staged([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })]);
  db.error = { message: 'nope' };

  assert.equal(await app.Data.remove('PID1'), false);

  /* THE ORDER IS THE POINT. The write is awaited and checked before anything
     local moves, so a refused delete leaves the trade on screen rather than
     hiding a row the database still has — which would read as deleted until the
     next refresh brought it back. */
  assert.deepEqual([...app.Data.rows].map(t => t.id), ['PID1'],
    'the row was hidden locally despite the write failing');
  assert.equal(app.Data.all.find(t => t.id === 'PID1').deleted, false);
  assert.equal($('sync-dot').className, 'sync-dot error');
  db.error = null;
});

test('a restore puts the trade back in both row sets', async () => {
  await staged([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40, deleted: true })]);
  // load() hides it, which is the state a restore actually starts from.
  assert.equal(app.Data.rows.length, 0);

  db.rows = [journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40, deleted: false })];
  assert.equal(await app.Data.restore('PID1'), true);

  assert.deepEqual(db.patches.map(p => ({ ...p })), [{ deleted: false }]);
  assert.deepEqual([...app.Data.rows].map(t => t.id), ['PID1'], 'the trade did not come back');
  assert.equal(app.Data.all.find(t => t.id === 'PID1').deleted, false,
    'the backup copy is still flagged deleted after a restore');
  assert.ok(app.Data.byId.has('PID1'), 'the restored row was not re-indexed');
});

test('a failed restore is reported rather than assumed', async () => {
  await staged([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40, deleted: true })]);
  db.error = { message: 'nope' };
  assert.equal(await app.Data.restore('PID1'), false,
    'a refused restore answered true, so the trade reads as recovered');
  db.error = null;
});

/* ─── The undo window, whose rules are all about ORDER ───────────────────────
   None of these is reachable through `Data` alone, and each one is a way a
   trade goes missing quietly rather than loudly.
   ─────────────────────────────────────────────────────────────────────────── */

test('staging a second delete finalises the first, so nothing sits in limbo', async () => {
  await staged([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -10 })
  ]);

  await app.PendingDelete.stage('PID1');
  assert.equal(app.PendingDelete.id, 'PID1');
  await app.PendingDelete.stage('PID2');
  assert.equal(app.PendingDelete.id, 'PID2', 'the second delete did not take over');

  // Undo now recovers the SECOND, and the first is permanent — which is what
  // "only the most recent is recoverable" has to mean for the offer to be true.
  db.rows = [journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -10, deleted: false })];
  await app.PendingDelete.undo();
  assert.ok(app.Data.byId.has('PID2'), 'undo restored something other than the last delete');
  assert.equal(app.Data.byId.has('PID1'), false, 'the finalised delete came back');
});

/* THE STALE TIMER, which is the one rule here no assertion about `id` can
   reach. `stage()` opens with `commit()`, and dropping that line leaves
   `PendingDelete.id` looking perfectly correct — the new id is assigned two
   lines later either way. What it actually loses is the PREVIOUS delete's
   timer, which stays armed and fires `commit()` partway through the new undo
   window, closing it early. The trade is gone and the Undo button silently
   stops working, seconds after being offered.

   Waiting UNDO_MS out is not a test, so the window's own timer calls are
   recorded instead: `setTimeout` here resolves to `window.setTimeout` at call
   time, so wrapping it catches the real sequence rather than a stand-in. */
test('staging a delete disarms the previous timer, not just the previous id', async () => {
  await staged([
    journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 }),
    journalled({ id: 'PID2', open_day: '2026-07-29', pnl: -10 })
  ]);

  const cleared = [];
  const realClear = win.clearTimeout;
  win.clearTimeout = (t) => { cleared.push(t); return realClear(t); };
  try {
    await app.PendingDelete.stage('PID1');
    // Its own timer, read off the object rather than counted: `notifyUndo` arms
    // one too, with the same CONFIG.UNDO_MS delay, so neither the count nor the
    // delay can tell the two apart.
    const first = app.PendingDelete.timer;
    assert.ok(first, 'staging a delete did not arm an undo timer at all');

    await app.PendingDelete.stage('PID2');
    assert.notEqual(app.PendingDelete.timer, first, 'the second delete reused the first timer');
    assert.ok(cleared.includes(first),
      'the first delete\'s timer is still armed after a second was staged — it ' +
      'will fire inside the new undo window and close it early, so the Undo ' +
      'button stops working seconds after being offered');
  } finally {
    win.clearTimeout = realClear;
    app.PendingDelete.commit();
  }
});

test('a second undo is inert rather than restoring the wrong trade', async () => {
  await staged([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })]);
  await app.PendingDelete.stage('PID1');

  db.rows = [journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40, deleted: false })];
  await app.PendingDelete.undo();
  assert.equal(app.PendingDelete.id, null);

  // The id is cleared whatever happens, so this must write nothing at all.
  db.patches.length = 0;
  await app.PendingDelete.undo();
  assert.deepEqual(db.patches.map(p => ({ ...p })), [], 'a second undo wrote to the database');
});

test('staging an id the app does not hold does nothing at all', async () => {
  await staged([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })]);
  await app.PendingDelete.stage('NOPE');
  assert.deepEqual(db.patches.map(p => ({ ...p })), [], 'an unknown id was deleted from the database');
  assert.equal(app.PendingDelete.id, null);
  assert.deepEqual([...app.Data.rows].map(t => t.id), ['PID1']);
});

test('a refused delete leaves nothing staged, so undo cannot offer a lie', async () => {
  await staged([journalled({ id: 'PID1', open_day: '2026-07-30', pnl: 40 })]);
  db.error = { message: 'nope' };

  await app.PendingDelete.stage('PID1');
  assert.equal(app.PendingDelete.id, null,
    'a delete that failed still armed the undo window, which would then try to ' +
    'restore a trade that was never deleted');
  db.error = null;
});

/* ─── A trade in no session at all ───────────────────────────────────────────
   `sessionOf` returns null for a row carrying neither an entry nor a fill
   instant, and `sessionBars` buckets by that answer. The old shape filtered per
   session, so a null simply matched nothing; the bucketed one has to say so
   deliberately, and a missing `?.` there is a TypeError that takes the whole
   setups panel down through render()'s catch — an empty column, no error on
   screen, and a trade silently absent from the counts either way.
   ─────────────────────────────────────────────────────────────────────────── */
test('a trade with no session is in no bar, and does not take the panel down', () => {
  const orphan = trade({
    id: 'PIDX', entry_time: null, fill_time: null, open_day: '2026-07-28',
    pnl: 12, net_pnl: 12, setup: 'Break & Retest',
    followed_rules: true, followed_sl: true, followed_tp: true });

  assert.equal(app.sessionOf(orphan), null, 'the fixture is no longer sessionless');

  const html = app.sessionBars([orphan, journalled({ id: 'PID1', pnl: 10, net_pnl: 10 })]);

  // Every bar states its population in a title. The orphan belongs to none of
  // them, so the five together must account for the OTHER trade and no more.
  const counted = [...html.matchAll(/\((\d+) trades?\)/g)]
    .reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(counted, 1,
    'the sessionless trade was bucketed into a session, or counted twice');
});
