// ═══════════════════════════════════════════════════════════════════════════
// THE STRATEGY, EXECUTED — the twelve rules a row can actually answer
// ───────────────────────────────────────────────────────────────────────────
// §7 of strategy.ts writes a predicate for all nineteen rules and §8 writes the
// population filters and the three verdicts. Both were prose: she was handed up
// to four hundred rows of JSON and expected to apply seven filters and a
// three-state verdict in her head, on the way to producing a number.
//
// That is the one thing a model is worst at and SQL-shaped arithmetic is best
// at, and it is where a wrong answer is least visible — a rate computed over
// the wrong population looks exactly like a rate computed over the right one,
// which is §8's own opening sentence.
//
// SO IT IS CODE, AND IT IS PURE. Rows in, verdicts out, no clock but the one
// passed in and no database anywhere. That is what lets every rule below be
// driven from a test with a hand-built row and broken on purpose — which is the
// only way anything here earns the word "checked".
//
// TWELVE RULES, AND THE SET IS NOT A CHOICE. §7's Evaluable column decides it:
// `journal` means a row can answer it today. R-05 through R-09, R-17 and R-19
// are `judgment` — nothing stored can see them,
// and inventing an approximation here would be worse than the gap, because a
// judgment rule that starts reporting `pass` is exactly the "no violations"
// claim §8 warns is close to saying nothing.
//
// IT GIVES NO VERDICT ON A TRADE, and could not: it reports whether a row
// satisfies a predicate HE wrote. "Two entries eleven days ago were 41 minutes
// apart, and R-12 allows fifteen" is a fact about his own rule. The prohibition
// is on her judging the trading, and this judges the rule.
// ═══════════════════════════════════════════════════════════════════════════
import { nyDate } from "../_shared/edge.ts";
/* The journal's own break-even band, not a second reading of it. `journal.ts`
   imports `TradeRow` from here with `import type`, which is erased — so this is
   a one-way dependency at runtime and not a cycle. */
import { BE } from "./journal.ts";

/* The row as eugenia_trades serves it. Written out rather than inferred,
   because this module is the one place that reasons about every column at once
   and a missing name here is a rule that silently never fires. */
export interface TradeRow {
  id: string;
  direction: string | null;
  entry_time: string | null;
  fill_time: string | null;
  entry_price: number | null;
  exit_price: number | null;
  pnl: number | null;
  open_day: string | null;
  setup: string | null;
  followed_rules: boolean | null;
  followed_sl: boolean | null;
  followed_tp: boolean | null;
  size_oz: number | null;
  net_pnl: number | null;
  planned_sl: number | null;
  planned_tp: number | null;
  best_price: number | null;
}

/* §8's three verdicts, and the third is not a formality — it mirrors the
   journal's own three-state boolean, where null is unanswered and is not "no". */
export type Verdict = 'pass' | 'fail' | 'unknown';

export interface RuleResult {
  rule: string;
  verdict: Verdict;
  passed: number;
  failed: number;
  unresolved: number;
  // The rows that failed and the rows nothing could decide, named so a finding
  // can be checked rather than believed. Capped, because a tool result is
  // context and a bad month should not fill it.
  ids: string[];
  why: string;
}

const NAMED = 6;

/* THE WORST OUTCOME PRESENT WINS, and `pass` is the strict reading.
   fail > unknown > pass, and an empty population is `unknown` rather than
   `pass` — which is §8 stated as code: a rule whose population came back empty
   is unknown, and one narrowed by a missing column is unknown outside the
   narrowed set rather than pass across the whole of it. The counts travel
   beside the verdict precisely so that "unknown with nine passes and one
   Friday close-out" is legible as what it is. */
export function settle(passed: number, failed: number, unresolved: number): Verdict {
  if (failed > 0) return 'fail';
  if (unresolved > 0 || passed === 0) return 'unknown';
  return 'pass';
}

const result = (rule: string, why: string, pass: string[], fail: string[], unknown: string[]): RuleResult => ({
  rule,
  verdict: settle(pass.length, fail.length, unknown.length),
  passed: pass.length,
  failed: fail.length,
  unresolved: unknown.length,
  ids: [...fail, ...unknown].slice(0, NAMED),
  why,
});

/* ─── The clock these rules are written in ─────────────────────────────────
   Every boundary in the strategy is a New York wall-clock one — the Friday
   17:00 close, a civil `open_day`, a market holiday — and none of them is a
   fixed number of milliseconds from anything. nyDate is shared and gives the
   civil day; minutes and the weekday are needed here and nowhere else, so this
   is the one place they are computed.

   `en-GB` with an explicit h23 cycle, matching _shared/nyClock: hour12:false
   leaves the cycle to the locale and can resolve to h24, which renders midnight
   as "24:05" and would put a midnight fill on the wrong side of every
   comparison below. */
const NY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});

export interface Wall { y: number; m: number; d: number; wd: number; hour: number; min: number }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function nyWall(at: Date): Wall {
  const p: Record<string, string> = {};
  for (const { type, value } of NY.formatToParts(at)) p[type] = value;
  return {
    y: +p.year, m: +p.month, d: +p.day,
    wd: WEEKDAYS.indexOf(p.weekday),
    hour: +p.hour, min: +p.minute,
  };
}

/* THE INSTANT A NEW YORK WALL TIME ACTUALLY IS, which is the half that cannot
   be done with a formatter. Date.UTC of a wall time is that time in UTC, not in
   New York; the gap between the two is the offset, and the offset is what
   changes twice a year — so it is measured rather than assumed.

   Guess, ask New York what the guess reads as, and subtract the difference.
   Correct in both halves of the year and at every clock change except an
   ambiguous wall time, and 17:00 is never one — the spring gap is 02:00-03:00
   and the autumn repeat is 01:00-02:00. */
export function nyInstant(y: number, m: number, d: number, hour: number): number {
  const guess = Date.UTC(y, m - 1, d, hour);
  const w = nyWall(new Date(guess));
  return guess - (Date.UTC(w.y, w.m - 1, w.d, w.hour, w.min) - guess);
}

/* ─── R-16's calendar ──────────────────────────────────────────────────────
   A US market holiday is a known date, which is exactly why §5 calls R-16
   decidable the day before and checkable afterwards. Computed rather than
   listed: a hard-coded table of dates is a rule that silently stops being true
   the year nobody remembers to extend it, and that failure looks like perfect
   compliance.

   OBSERVANCE IS PART OF THE RULE. A fixed-date holiday landing on a Saturday is
   observed on the Friday before and on a Sunday the Monday after, so the market
   is shut on a day the naive date test calls open. */
const nthWeekday = (y: number, m: number, wd: number, n: number): number => {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
};

const lastWeekday = (y: number, m: number, wd: number): number => {
  const last = new Date(Date.UTC(y, m, 0));
  return last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7);
};

/* Easter by the anonymous Gregorian algorithm, and Good Friday is two days
   before it. The only moving holiday on the list, and the only reason this
   function is longer than a lookup would be. */
export function easter(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const dd = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return { m: month, d: day };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Saturday → the Friday before, Sunday → the Monday after. Applied to the fixed
// dates only; a holiday defined as "the third Monday" can never need it.
function observed(y: number, m: number, d: number): string {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const shift = wd === 6 ? -1 : wd === 0 ? 1 : 0;
  const moved = new Date(Date.UTC(y, m - 1, d + shift));
  return iso(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/* THE CHRISTMAS STRETCH IS AN OPERATIONAL READING, AND IT IS NAMED SO IT CAN BE
   ARGUED WITH. §5 says "the Christmas-to-New-Year stretch" and gives no dates,
   so a number had to be chosen to make the rule checkable at all: the 24th
   through the 31st, which is Christmas Eve to New Year's Eve. Exported rather
   than inlined because it is the one figure in this file that is a decision
   rather than a fact, and a decision buried in a comparison is one nobody can
   find to change. */
export const STRETCH = { from: 24, to: 31 };

export function marketHolidays(y: number): Set<string> {
  const gf = easter(y);
  const good = new Date(Date.UTC(y, gf.m - 1, gf.d - 2));

  const days = new Set<string>([
    observed(y, 1, 1),                                  // New Year's Day
    iso(y, 1, nthWeekday(y, 1, 1, 3)),                  // Martin Luther King Jr Day
    iso(y, 2, nthWeekday(y, 2, 1, 3)),                  // Washington's Birthday
    iso(good.getUTCFullYear(), good.getUTCMonth() + 1, good.getUTCDate()),
    iso(y, 5, lastWeekday(y, 5, 1)),                    // Memorial Day
    observed(y, 6, 19),                                 // Juneteenth
    observed(y, 7, 4),                                  // Independence Day
    iso(y, 9, nthWeekday(y, 9, 1, 1)),                  // Labor Day
    iso(y, 11, nthWeekday(y, 11, 4, 4)),                // Thanksgiving
    observed(y, 12, 25),                                // Christmas
  ]);

  for (let d = STRETCH.from; d <= STRETCH.to; d++) days.add(iso(y, 12, d));
  return days;
}

/* ─── §8's population filters ──────────────────────────────────────────────
   Applied by every rule below rather than remembered case by case, which is
   §8's own instruction. `deleted` is already filtered by the view, so it is not
   here — a filter this file cannot apply is not one it should pretend to. */
export const isBroker = (t: TradeRow) => t.id.startsWith('PID');
const priced = (t: TradeRow) => t.entry_price != null && t.exit_price != null;
const closed = (t: TradeRow) => t.pnl != null;

const gap = (t: TradeRow) => Math.abs((t.exit_price as number) - (t.entry_price as number));

// Money compared against a threshold in dollars, so the tolerance is a cent.
// Without it a stop that filled at exactly $20.00 can read as $20.000000001 and
// be reported as a breach of a rule it satisfies exactly.
const CENT = 0.005;

/* ─── R-01 ─────────────────────────────────────────────────────────────────
   Take profit $30, or $25 where the level looks hard to reach. §7: no win with
   |exit − entry| < 25, except a Friday close-out, which is unknown.

   THE EXCEPTION IS NARROW BECAUSE §6 MADE IT NARROW. R-15 forces a close at the
   Friday 17:00 New York close, and a forced exit at +$12 is a win under $25
   that R-01 would flag every single week. §6 draws the line in words — "a win
   under $25 filling at the Friday close is unknown; one filling at 2 p.m.
   Friday is still a flag" — and a window had to be chosen to make that
   checkable. Thirty minutes, named, for the reason STRETCH is. */
export const CLOSEOUT_MIN = 30;

export function nearFridayClose(fill: Date): boolean {
  const w = nyWall(fill);
  if (w.wd !== 5) return false;
  const minutes = w.hour * 60 + w.min;
  const close = 17 * 60;
  return minutes <= close && minutes >= close - CLOSEOUT_MIN;
}

function r01(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  for (const t of rows) {
    if (!isBroker(t) || !closed(t) || (t.pnl as number) <= 0) continue;
    if (!priced(t)) { unknown.push(t.id); continue; }
    if (gap(t) >= 25 - CENT) { pass.push(t.id); continue; }

    /* A SCRATCH IS NOT A WIN THAT FAILED TO TAKE PROFIT, and §7's predicate
       read literally says it is. The document contradicts itself here: its
       Exit section names four legitimate ways a trade ends and one of them is
       "at break-even once R-04 has moved the stop there" — while the predicate
       flags any win closing under $25. A break-even stop-out filling a few
       cents favourable clears the commission, so `pnl > 0`, and every one of
       them came back a breach of a rule he had just followed.

       The journal already decides what a scratch is: `resultOf` calls it `be`
       inside ±$3 of the ENTRY PRICE, and that band is what leaves this
       population rather than a second number invented here. The reading is
       named for CLOSEOUT_MIN's reason — where §7 and §6 part, the code has to
       choose, and a choice buried in a comparison is one nobody can find. */
    if (gap(t) <= BE) continue;

    // Under $25 and beyond a scratch. A Friday close-out is the one exit the
    // data cannot tell from a discretionary one, so it is unknown rather than
    // either answer.
    if (t.fill_time && nearFridayClose(new Date(t.fill_time))) unknown.push(t.id);
    else fail.push(t.id);
  }
  return result('R-01', 'wins closing under $25 from entry, break-even exits and Friday close-outs excepted',
                pass, fail, unknown);
}

/* ─── R-02 ─────────────────────────────────────────────────────────────────
   Stop never beyond $20 from entry. §7: no loss with |exit − entry| > 20 — the
   CAP only. The other half of R-02, whether the stop was RESPECTED, is not
   checked here: `planned_sl` records the stop as the poller first saw it, so it
   is no longer unrecoverable — but almost no row carries one yet, which is why
   §7's Evaluable column did not move. This checks the cap and says so. */
function r02(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  for (const t of rows) {
    if (!isBroker(t) || !closed(t) || (t.pnl as number) >= 0) continue;
    if (!priced(t)) { unknown.push(t.id); continue; }
    if (gap(t) > 20 + CENT) fail.push(t.id); else pass.push(t.id);
  }
  return result('R-02', 'losses further than $20 from entry — the cap only, never whether it was respected',
                pass, fail, unknown);
}

/* ─── R-03 ─────────────────────────────────────────────────────────────────
   No entry after a full-stop loss on the same day, except one sweep re-entry.
   §7: within an open_day, at most one entry_time later than the fill_time of a
   loss with |exit − entry| ≥ 20.

   A FULL STOP IS $20 FROM ENTRY BECAUSE HE SAID SO, and that is the whole of
   why this is checkable. §12 used to count a stop set tighter and taken in
   full, which no row can tell from a hand-cut exit; his definition is the stop
   at its ceiling, so a smaller loss is not one and leaves the population
   rather than making the day unknown.

   UNKNOWN ONLY WHERE THE ANSWER COULD DIFFER. A loss with no prices might be a
   full stop, and a full stop with no fill_time cannot be placed before the
   entries it would count — but a day with fewer than three entries cannot
   breach this whatever those rows turn out to be, so it is not reported as
   something the data failed to decide. A breach found elsewhere in the day
   stands regardless: a known third entry after a known full stop is a fail
   whatever else is unmeasured. */
export const FULL_STOP = 20;

function r03(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];

  for (const [day, all] of byDay(rows)) {
    const entries = all.filter(t => t.entry_time).map(t => +new Date(t.entry_time as string));
    const losses = all.filter(t => closed(t) && (t.pnl as number) < 0);
    const full = losses.filter(t => priced(t) && gap(t) >= FULL_STOP - CENT);
    const unmeasured = losses.filter(t => !priced(t));
    if (!full.length && !unmeasured.length) continue;

    // Entries after the loss closed; null where there is no instant to count from.
    const after = (t: TradeRow) =>
      t.fill_time ? entries.filter(at => at > +new Date(t.fill_time as string)).length : null;

    if (full.some(t => (after(t) ?? 0) >= 2)) { fail.push(day); continue; }
    const couldBreach = entries.length >= 3 &&
      [...full, ...unmeasured].some(t => after(t) === null || (after(t) as number) >= 2);
    if (couldBreach) unknown.push(day);
    else if (full.length) pass.push(day);
  }
  return result('R-03', `days with more than one entry after a full-stop loss — a loss $${FULL_STOP} or more from entry`,
                pass, fail, unknown);
}

/* ─── R-04 ─────────────────────────────────────────────────────────────────
   Stop to break-even once price reaches +$20. §7: no loss beyond the scratch
   band on a trade whose best_price was $20 or more in his favour.

   THE POPULATION IS LOSSES, and that is the rule's own shape rather than a
   limit of the data. A win says nothing about where the stop sat, and an exit
   inside the ±$3 band is R-04 having fired — so only a loss beyond the band
   can breach it, and it does exactly when the trade had already been $20 his
   way: the stop that should have been at entry was not. A loss that never got
   there passes, because the rule never engaged.

   best_price reads whole minutes inside the trade only, so the excursion here
   can fall short of what happened and never exceed it — a breach can be
   missed, never invented. Null is a trade too short to measure or not yet
   reached by the poller, and is unknown. */
export const TO_BREAK_EVEN = 20;

function r04(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  for (const t of rows) {
    if (!isBroker(t) || !closed(t) || (t.pnl as number) >= 0) continue;
    if (!priced(t)) { unknown.push(t.id); continue; }
    if (gap(t) <= BE) continue;
    if (t.best_price == null || (t.direction !== 'BUY' && t.direction !== 'SELL')) { unknown.push(t.id); continue; }
    const ran = t.direction === 'BUY'
      ? t.best_price - (t.entry_price as number)
      : (t.entry_price as number) - t.best_price;
    (ran >= TO_BREAK_EVEN - CENT ? fail : pass).push(t.id);
  }
  return result('R-04', `losses beyond break-even on trades that had already run $${TO_BREAK_EVEN} in his favour`,
                pass, fail, unknown);
}

/* ─── R-10 ─────────────────────────────────────────────────────────────────
   One position at a time. §7: no two rows whose entry_time→fill_time spans
   overlap.

   AN OPEN POSITION EXTENDS TO NOW, not to null. A trade still running while a
   second one opened is the clearest possible breach of this rule, and treating
   a null fill_time as "no span" would drop exactly that case.

   BUT A NULL fill_time IS NOT ALWAYS AN OPEN POSITION, and reading it as one
   manufactured breaches out of nothing. That column has a single writer and it
   is the EMAIL path; the poller records a close as `exit_price` and never
   touches fill_time at all. So a position closed with no alert email behind it
   ran to `now` here for ever — and every trade taken after it overlapped it, so
   one missing email turned a clean month into a cascade of R-10 failures, each
   naming a real row and each wrong.

   Three states rather than two. Closed with a time: the span ends there. Closed
   with no time — `exit_price` set, `fill_time` null — the END IS UNKNOWN, and
   an unknown end cannot be compared with anything, so the row is unresolved
   rather than assumed to run to now. Only a row neither witness has closed is
   still open, and only that one extends to now.

   TWO SWEEPS, BECAUSE COMPARING EACH SPAN WITH THE ONE BEFORE IT IS NOT THE
   SAME QUESTION. Sorted by entry, the previous span is not the only earlier one
   still running: a multi-session hold — which the summary says is a shape he
   trades — covers everything opened inside it, and a second trade taken after a
   first one has closed sits beside a `to` that has already been left behind. So
   `spans[i].from < spans[i-1].to` answered for one neighbour and the third
   trade of a nested set came back PASSED, named nowhere.

   The verdict survived that, which is why it went unseen: a span nested inside
   an earlier one always has a neighbour that overlaps too, so something was
   always flagged and the rule always said `fail`. What was wrong is what she
   REPORTS — the counts, and the ids she hands him to check. A breach counted as
   a pass and left out of the list is this file's own opening argument about a
   rate over the wrong population, arriving inside one rule.

   Forward for a span that starts before an earlier one ends, backward for one
   that ends after a later one starts. Between them they name every span
   overlapping any other, in one pass each rather than a scan per row. */
function r10(rows: TradeRow[], now: number): RuleResult {
  const dated = rows.filter(t => isBroker(t) && t.entry_time);

  // Closed by the poller and never stamped by the email: there is no instant to
  // end the span at, so it is named as undecidable rather than run to now.
  const unknown = dated
    .filter(t => !t.fill_time && t.exit_price !== null)
    .map(t => t.id);

  const spans = dated
    .filter(t => t.fill_time || t.exit_price === null)
    .map(t => ({
      id: t.id,
      from: new Date(t.entry_time as string).getTime(),
      to: t.fill_time ? new Date(t.fill_time).getTime() : now,
    }))
    .sort((a, b) => a.from - b.from);

  const pass: string[] = [], fail: string[] = [];
  const bad = new Set<string>();

  // The furthest any earlier span runs to. Strict, so a position closing in the
  // same instant the next one opens is a clean handover rather than a breach.
  let ends = -Infinity;
  for (const s of spans) {
    if (s.from < ends) bad.add(s.id);
    ends = Math.max(ends, s.to);
  }

  // And the earliest any later span starts, which is the same test read from
  // the other side — it catches the long hold that the ones nested inside it
  // were already caught against.
  let starts = Infinity;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].to > starts) bad.add(spans[i].id);
    starts = Math.min(starts, spans[i].from);
  }

  for (const s of spans) (bad.has(s.id) ? fail : pass).push(s.id);
  return result('R-10', 'positions whose open spans overlap another', pass, fail, unknown);
}

/* ─── R-11 ─────────────────────────────────────────────────────────────────
   The day ends at −4% of account, however it was reached. §7: within an
   open_day, no entry_time later than the fill_time of the loss that took
   cumulative P&L past −4% of size_oz × 500.

   THE ACCOUNT IS DERIVED AND NEVER `balance`, which §8 withholds precisely so
   this denominator cannot be reached for by mistake: balance moves on transfers
   with no trade behind them. A day whose rows carry no size at all is unknown
   rather than passed — there is no account to take 4% of. */
export const DAY_LOSS = 0.04;

function r11(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];

  for (const [day, all] of byDay(rows)) {
    const done = all.filter(t => t.pnl != null);
    if (!done.length) continue;

    /* ONE SIZE OR NONE. `find` took whichever non-null size came first in
       whatever order the rows arrived in, and a day carrying two of them is
       exactly the day R-13 exists to flag — so the denominator of the limit
       was decided by row order on the days least able to afford it. A bigger
       size is a bigger account and a more forgiving floor, so the two answers
       are not close. Two sizes means no account, which means no limit. */
    const sizes = new Set(done.map(t => t.size_oz).filter(s => s != null));
    if (sizes.size !== 1) { unknown.push(day); continue; }
    const size = [...sizes][0] as number;

    /* A CLOSED ROW WITH NO `fill_time` CANNOT BE PLACED IN THE SEQUENCE, and
       this rule is a running total walked in time order. Dropping it silently
       is what R-15 was repaired for and R-11 kept doing: a lost LOSS never
       reaches the floor and the day comes back `pass`, a lost WIN breaches a
       day that never did. Both directions are corrupted by the same absence,
       so the day is undecidable rather than either answer.

       `dayStanding` below sums every closed row and needs no order, so it
       stays whole — which is how this was found: the two disagreed about the
       same day, one telling him the day was over while this reported pass. */
    const settled = done.filter(t => t.fill_time)
      .sort((a, b) => +new Date(a.fill_time as string) - +new Date(b.fill_time as string));
    if (settled.length < done.length) { unknown.push(day); continue; }

    const floor = -DAY_LOSS * (size * 500);
    let running = 0, breached: number | null = null;
    for (const t of settled) {
      running += t.pnl as number;
      if (running <= floor) { breached = +new Date(t.fill_time as string); break; }
    }
    if (breached === null) { pass.push(day); continue; }

    const after = all.some(t => t.entry_time && +new Date(t.entry_time) > (breached as number));
    (after ? fail : pass).push(day);
  }
  return result('R-11', `entries taken after the day was already past −${DAY_LOSS * 100}% of account`,
                pass, fail, unknown);
}

/* ─── R-12 ─────────────────────────────────────────────────────────────────
   At most one entry a day; two only when the second is a sweep re-entry. §7:
   no open_day with three or more entries; a second entry more than 15 min after
   the prior fill_time is a fail, within 15 min is unknown.

   THE FIFTEEN MINUTES IS WHAT MAKES HALF OF THIS CHECKABLE. Nothing on a row
   says an entry was a sweep re-entry — §8 lists it among what is not stored —
   so a prompt second entry is unknown by construction and a late one is a fail
   whatever it was. Three is a fail either way, since the rule permits two. */
export const SWEEP_MIN = 15;

function r12(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];

  for (const [day, all] of byDay(rows)) {
    const entries = all.filter(t => t.entry_time)
      .sort((a, b) => +new Date(a.entry_time as string) - +new Date(b.entry_time as string));
    if (!entries.length) continue;
    if (entries.length >= 3) { fail.push(day); continue; }
    if (entries.length === 1) { pass.push(day); continue; }

    const first = entries[0], second = entries[1];
    if (!first.fill_time) { unknown.push(day); continue; }
    const apart = (+new Date(second.entry_time as string) - +new Date(first.fill_time)) / 60000;
    (apart > SWEEP_MIN ? fail : unknown).push(day);
  }
  return result('R-12', `days with a second entry more than ${SWEEP_MIN} minutes after the first closed, or a third entry at all`,
                pass, fail, unknown);
}

/* ─── R-13 ─────────────────────────────────────────────────────────────────
   The sizing rung moves only between months. §7: one distinct size_oz per
   calendar month, over rows carrying one.

   THE MONTH IS THE CIVIL ONE `open_day` IS FILED UNDER, so it is sliced off the
   stored date rather than derived from a timestamp — a trade opened at 20:00 on
   the 31st is filed on the 31st and belongs to that month whatever UTC says. */
function r13(rows: TradeRow[]): RuleResult {
  const months = new Map<string, Set<number>>();
  for (const t of rows) {
    if (!isBroker(t) || !t.open_day || t.size_oz == null) continue;
    const key = t.open_day.slice(0, 7);
    if (!months.has(key)) months.set(key, new Set());
    (months.get(key) as Set<number>).add(t.size_oz);
  }
  const pass: string[] = [], fail: string[] = [];
  for (const [month, sizes] of months) (sizes.size > 1 ? fail : pass).push(month);
  return result('R-13', 'calendar months carrying more than one position size', pass, fail, []);
}

/* ─── R-14 ─────────────────────────────────────────────────────────────────
   No entries in the hours before a high-impact release. §7: no entry in the
   30 minutes before a USD red-folder release on Forex Factory; an entry with
   one later that day but further off is unknown.

   BOTH NUMBERS ARE HIS, and the second is a floor rather than the rule. §6
   calls the stand-aside open-ended — a 10 a.m. print can cost the New York
   morning from the open — so thirty minutes is the part no reading of it can
   excuse, and a release further ahead the same day leaves the entry to his
   judgement: unknown, never pass. RED is what counts as high impact, stated
   here because it is the rule's decision; the query that reads the calendar
   imports it rather than typing it again.

   A WEEK NOBODY FETCHED IS NOT A QUIET WEEK. The export is only ever the
   current week, so the calendar holds what the nightly pass kept, and a week
   it missed has no releases in the table for the same reason a quiet one
   does. `weeks` is the evidence of a fetch; an entry outside one is unknown.
   After the print is not checked: he stands aside through it by judgement,
   and set no number for it. */
export const NEWS_MIN = 30;
export const RED = { country: 'USD', impact: 'High' };

export interface Calendar { releases: string[]; weeks: Set<string> }

// The Sunday, New York, that the Forex Factory week holding `at` began on —
// the key ff_weeks is written under.
export function weekOf(at: Date): string {
  const w = nyWall(at);
  const d = new Date(Date.UTC(w.y, w.m - 1, w.d - w.wd));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function r14(rows: TradeRow[], cal: Calendar): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  const prints = cal.releases.map(r => +new Date(r));
  for (const t of rows) {
    if (!isBroker(t) || !t.entry_time) continue;
    const entry = new Date(t.entry_time), e = +entry;
    if (!cal.weeks.has(weekOf(entry))) { unknown.push(t.id); continue; }
    const day = nyDate(entry);
    const ahead = prints.filter(p => p > e && nyDate(new Date(p)) === day);
    if (prints.some(p => p > e && p - e <= NEWS_MIN * 60_000)) fail.push(t.id);
    else (ahead.length ? unknown : pass).push(t.id);
  }
  return result('R-14', `entries in the ${NEWS_MIN} minutes before a USD red-folder release`,
                pass, fail, unknown);
}

/* ─── R-15 ─────────────────────────────────────────────────────────────────
   Nothing is held over the weekend. §7: no entry_time before and fill_time
   after a Friday 17:00 New York close.

   WALKED DAY BY DAY RATHER THAN ARITHMETIC ON THE SPAN, because "the Friday
   17:00 close inside this span" is a wall-clock instant whose UTC value moves
   with the offset — and a span crossing the March or November change would be
   an hour wrong exactly where it matters. The walk is bounded: a span longer
   than a month is not this account and is answered `unknown` rather than
   looped over. */
const SPAN_DAYS = 31;

export function crossesFridayClose(from: Date, to: Date): boolean | null {
  if (+to <= +from) return false;
  if (+to - +from > SPAN_DAYS * 86_400_000) return null;

  const start = nyWall(from);
  // From the entry's own New York day, forward one civil day at a time.
  for (let i = 0; i <= SPAN_DAYS; i++) {
    const probe = new Date(Date.UTC(start.y, start.m - 1, start.d + i, 12));
    const w = nyWall(probe);
    if (w.wd !== 5) continue;
    const close = nyInstant(w.y, w.m, w.d, 17);
    if (close > +from && close < +to) return true;
    if (close >= +to) return false;
  }
  return false;
}

function r15(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  for (const t of rows) {
    if (!isBroker(t) || !t.entry_time) continue;
    /* CLOSED, WITH NO INSTANT SAYING WHEN. `fill_time` is the email path's
       column and the poller never writes it, so a close with no alert behind it
       has an `exit_price` and no time — and this rule is entirely about whether
       a span crossed a particular Friday instant. It used to `continue` past
       those, which drops them from the population silently: the one shape §8
       says a rate must never be computed over. A position still genuinely open
       is a different case and is still skipped, since it has not closed at all. */
    if (!t.fill_time) {
      if (t.exit_price !== null) unknown.push(t.id);
      continue;
    }
    const crossed = crossesFridayClose(new Date(t.entry_time), new Date(t.fill_time));
    if (crossed === null) unknown.push(t.id);
    else (crossed ? fail : pass).push(t.id);
  }
  return result('R-15', 'positions still open across a Friday 17:00 New York close', pass, fail, unknown);
}

/* ─── R-16 ─────────────────────────────────────────────────────────────────
   No trading on known low-volume days. §7: no entry_time on a US market
   holiday. The day is the New York civil one, because that is the day the
   market was shut on. */
function r16(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [];
  const cache = new Map<number, Set<string>>();

  for (const t of rows) {
    if (!isBroker(t) || !t.entry_time) continue;
    const day = nyDate(new Date(t.entry_time));
    const year = +day.slice(0, 4);
    if (!cache.has(year)) cache.set(year, marketHolidays(year));
    ((cache.get(year) as Set<string>).has(day) ? fail : pass).push(t.id);
  }
  return result('R-16', 'entries taken on a US market holiday or in the Christmas stretch', pass, fail, []);
}

/* ─── R-18 ─────────────────────────────────────────────────────────────────
   Stop and target are resting orders; a position is never closed by hand.
   §7: no closed trade without a broker alert, except at the Friday close.

   THE ALERT IS THE EVIDENCE, AND ITS ABSENCE IS THE BREACH. cTrader emails
   when a stop or target fills and sends nothing for a hand close — his own
   account, confirmed against eight closes nothing was ever sent for. net_pnl
   is written from that alert alone, so a closed row without one is a position
   he closed himself. The prices cannot say this: a hand close at the stop and
   the stop filling look identical.

   R-15's close-out is the one permitted hand close, read through R-01's window
   so the two rules agree on what "at the Friday close" is. A close under the
   grace is unknown rather than a breach — the alert is normally seconds behind
   the fill, and the Apps Script retries anything the function refused — and a
   close with no instant cannot be aged or placed against Friday.

   ONE WAY TO BE WRONG, AND IT IS NAMED. An alert the email path lost reads as
   a hand close. The failure carries the id, so it can be looked up in Gmail
   rather than believed. */
export const ALERT_GRACE_MIN = 60;

function r18(rows: TradeRow[], now: number): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  for (const t of rows) {
    if (!isBroker(t) || !closed(t)) continue;
    if (t.net_pnl != null) { pass.push(t.id); continue; }
    if (!t.fill_time) { unknown.push(t.id); continue; }
    const fill = new Date(t.fill_time);
    if (now - +fill < ALERT_GRACE_MIN * 60_000) unknown.push(t.id);
    else (nearFridayClose(fill) ? pass : fail).push(t.id);
  }
  return result('R-18', 'closes with no broker alert behind them — closed by hand — the Friday close-out excepted',
                pass, fail, unknown);
}

/* One pass over the rows to bucket them by filing day, so the two day-scoped
   rules do not each scan the list per day. The same reason index.html builds
   Data.byDay once rather than filtering inside a loop. */
function byDay(rows: TradeRow[]): Map<string, TradeRow[]> {
  const days = new Map<string, TradeRow[]>();
  for (const t of rows) {
    if (!isBroker(t) || !t.open_day) continue;
    const list = days.get(t.open_day);
    if (list) list.push(t); else days.set(t.open_day, [t]);
  }
  return days;
}

/* THE WHOLE SET, IN §7's ORDER. Order matters only for reading, and reading is
   the point: the list she is handed should be the list the rules table states,
   so a rule that stopped being evaluated is a gap in a sequence rather than an
   absence nobody can see. */
export function checkRules(rows: TradeRow[], now = Date.now(),
                           cal: Calendar = { releases: [], weeks: new Set() }): RuleResult[] {
  return [r01(rows), r02(rows), r03(rows), r04(rows), r10(rows, now), r11(rows),
          r12(rows), r13(rows), r14(rows, cal), r15(rows), r16(rows), r18(rows, now)];
}

/* ─── Where a day stands right now ────────────────────────────────────────
   R-11 asks whether he TRADED AFTER the day was already past −4%, which is a
   question about the past and answers `pass` at the very moment the limit is
   reached — correctly, since nothing has been taken after it yet.

   This is the other question, and it is the one a close is worth waking her
   for: is the day past its limit AS OF NOW. A rule he wrote says the day ends
   here, and saying so at the moment it becomes true is citing his own rule
   rather than judging his trade. Separate function because it is a separate
   question, and folding it into r11 would make that rule answer two things.

   Returns null when the day cannot be judged — no rows, or no size to derive an
   account from — because a limit with no denominator is not a limit. */
export interface Standing { day: string; pnl: number; account: number; breached: boolean }

export function dayStanding(rows: TradeRow[], day: string): Standing | null {
  const all = rows.filter(t => isBroker(t) && t.open_day === day);
  if (!all.length) return null;

  // Two sizes is no account, for r11's reason. Whole rather than ordered: this
  // is a sum and not a sequence, so a close with no `fill_time` still counts
  // here where r11 cannot place it.
  const sizes = new Set(all.map(t => t.size_oz).filter(s => s != null));
  if (sizes.size !== 1) return null;
  const size = [...sizes][0] as number;

  const pnl = all.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const account = size * 500;
  return { day, pnl, account, breached: pnl <= -DAY_LOSS * account };
}

/* Rendered here rather than by the caller, for the reason searchList and
   channelsList are: it is a decision about what she is told, and a decision a
   test can read. Counts always, ids only where there is something to name —
   a list of six passing trade ids is noise, and the same list on a failure is
   the entire finding. */
export function adherenceList(results: RuleResult[]): string {
  return results.map(r => {
    const counts = `${r.passed} pass, ${r.failed} fail, ${r.unresolved} unknown`;
    const named = r.ids.length ? ` — ${r.ids.join(', ')}` : '';
    return `${r.rule}: ${r.verdict.toUpperCase()} (${counts}) · ${r.why}${named}`;
  }).join("\n");
}
