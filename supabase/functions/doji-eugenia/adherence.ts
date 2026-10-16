// ═══════════════════════════════════════════════════════════════════════════
// THE STRATEGY, EXECUTED — the twelve rules a row can actually answer
// ───────────────────────────────────────────────────────────────────────────
// §7 writes a predicate per rule and §8 the population filters and three
// verdicts. Applied by hand over four hundred rows, a rate over the wrong
// population looks exactly like one over the right — §8's own opening. So it is
// code, and pure: rows in, verdicts out, no clock but the one passed in, which
// is what lets every rule be driven both ways from a test.
//
// Twelve, because §7's Evaluable column decides it: `journal` rules only. A
// judgment rule reporting `pass` is the "no violations" claim §8 warns about.
//
// It judges whether a row satisfies a predicate HE wrote — a fact about his own
// rule, never a verdict on the trading.
// ═══════════════════════════════════════════════════════════════════════════
import { nyDate } from "../_shared/edge.ts";
// The journal's own band, not a second one. journal.ts imports TradeRow with
// `import type`, erased at runtime, so this is not a cycle.
import { BE, sessionAt } from "./journal.ts";

/* The row eugenia_trades serves, written out: a column missing here is a rule
   that silently never fires. agree.test.mjs holds it against the view. */
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

/* §8's three verdicts; `unknown` mirrors the journal's null, which is not "no". */
export type Verdict = 'pass' | 'fail' | 'unknown';

export interface RuleResult {
  rule: string;
  verdict: Verdict;
  passed: number;
  failed: number;
  unresolved: number;
  // Failed and undecided rows, named so a finding can be checked. Capped,
  // because a tool result is context.
  ids: string[];
  why: string;
}

const NAMED = 6;

/* The worst outcome present wins: fail > unknown > pass, and an empty
   population is unknown — §8 as code. The counts travel with the verdict so
   "unknown, nine passes and one Friday close-out" reads as what it is. */
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
   Every boundary in the strategy is New York wall-clock — the Friday close, a
   civil open_day, a holiday. Minutes and weekday are needed only here. h23, or
   a midnight fill lands on the wrong side of every comparison.
   ───────────────────────────────────────────────────────────────────────── */
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

/* The instant a New York wall time is. The offset changes twice a year, so it
   is measured: guess, read the guess in New York, subtract the difference.
   Exact except on an ambiguous wall time, which 17:00 never is. */
export function nyInstant(y: number, m: number, d: number, hour: number): number {
  const guess = Date.UTC(y, m - 1, d, hour);
  const w = nyWall(new Date(guess));
  return guess - (Date.UTC(w.y, w.m - 1, w.d, w.hour, w.min) - guess);
}

/* ─── R-16's calendar ──────────────────────────────────────────────────────
   Computed rather than listed: a table of dates stops being true the year
   nobody extends it, and that failure looks like perfect compliance.
   Observance is part of the rule — a Saturday holiday is observed the Friday
   before, a Sunday one the Monday after. Bank holidays count too, per the
   rule: Columbus and Veterans Day are the banks' alone, and the Fed moves a
   Sunday one to Monday and a Saturday one nowhere (bankObserved).
   ───────────────────────────────────────────────────────────────────────── */
const nthWeekday = (y: number, m: number, wd: number, n: number): number => {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
};

const lastWeekday = (y: number, m: number, wd: number): number => {
  const last = new Date(Date.UTC(y, m, 0));
  return last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7);
};

/* Easter by the anonymous Gregorian algorithm; Good Friday is two days before. */
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

// The Fed's observance: Sunday → Monday, Saturday stays.
const bankObserved = (y: number, m: number, d: number): string =>
  iso(y, m, d + (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0 ? 1 : 0));

function observed(y: number, m: number, d: number): string {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const shift = wd === 6 ? -1 : wd === 0 ? 1 : 0;
  return new Date(Date.UTC(y, m - 1, d + shift)).toISOString().slice(0, 10);
}

/* §5's "Christmas-to-New-Year stretch" given dates: the 24th to the 31st. A
   decision rather than a fact, so it is named where it can be found and
   argued with. */
export const STRETCH = { from: 24, to: 31 };

export function lowVolumeDays(y: number): Set<string> {
  const gf = easter(y);

  const days = new Set<string>([
    observed(y, 1, 1),                                  // New Year's Day
    iso(y, 1, nthWeekday(y, 1, 1, 3)),                  // Martin Luther King Jr Day
    iso(y, 2, nthWeekday(y, 2, 1, 3)),                  // Washington's Birthday
    new Date(Date.UTC(y, gf.m - 1, gf.d - 2)).toISOString().slice(0, 10),   // Good Friday
    iso(y, 5, lastWeekday(y, 5, 1)),                    // Memorial Day
    observed(y, 6, 19),                                 // Juneteenth
    observed(y, 7, 4),                                  // Independence Day
    iso(y, 9, nthWeekday(y, 9, 1, 1)),                  // Labor Day
    iso(y, 10, nthWeekday(y, 10, 1, 2)),                // Columbus Day, banks only
    bankObserved(y, 11, 11),                            // Veterans Day, banks only
    iso(y, 11, nthWeekday(y, 11, 4, 4)),                // Thanksgiving
    observed(y, 12, 25),                                // Christmas
  ]);

  for (let d = STRETCH.from; d <= STRETCH.to; d++) days.add(iso(y, 12, d));
  return days;
}

/* ─── §8's population filters ──────────────────────────────────────────────
   Applied by every rule rather than remembered case by case. `deleted` is
   already filtered by the view.
   ───────────────────────────────────────────────────────────────────────── */
export const isBroker = (t: TradeRow) => t.id.startsWith('PID');
const priced = (t: TradeRow) => t.entry_price != null && t.exit_price != null;
const closed = (t: TradeRow) => t.pnl != null;

const gap = (t: TradeRow) => Math.abs((t.exit_price as number) - (t.entry_price as number));

// A cent of tolerance, so a stop filled at exactly $20.00 cannot read as
// $20.000000001.
const CENT = 0.005;

/* What trade_stops holds for a position. The read is newest first, and every
   rule walks it in the order the poller saw it. */
export interface Stop { seen_at: string; sl: number | null; tp: number | null }

const history = (stops: Map<string, Stop[]>, id: string): Stop[] =>
  [...(stops.get(id) ?? [])].sort((a, b) => +new Date(a.seen_at) - +new Date(b.seen_at));

/* ─── R-01 ─────────────────────────────────────────────────────────────────
   Take profit $30, or $25 where the level looks hard. §7: no win with
   |exit − entry| < 25, a Friday close-out being unknown. R-15 forces that
   close, and §6 draws the line: filling at the close is unknown, at 2 p.m.
   Friday still a flag. Thirty minutes, named for STRETCH's reason.
   ───────────────────────────────────────────────────────────────────────── */
export const CLOSEOUT_MIN = 30;

// The two targets, the exception and the default; her calls are held to both.
export const TARGET_MIN = 25, TARGET_MAX = 30;

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
    if (gap(t) >= TARGET_MIN - CENT) { pass.push(t.id); continue; }

    /* A scratch is not a missed target. §6 names a break-even stop-out as a
       legitimate exit, while §7's predicate flags any win under $25 — and a
       break-even stop a few cents favourable clears the commission. The
       journal's own ±$3 band decides what a scratch is; named for
       CLOSEOUT_MIN's reason, since this is where two sections part. */
    if (gap(t) <= BE) continue;

    // A Friday close-out is the one exit the data cannot tell from a choice.
    if (t.fill_time && nearFridayClose(new Date(t.fill_time))) unknown.push(t.id);
    else fail.push(t.id);
  }
  return result('R-01', `wins closing under $${TARGET_MIN} from entry, break-even exits and Friday close-outs excepted`,
                pass, fail, unknown);
}

/* ─── R-02 ─────────────────────────────────────────────────────────────────
   Stop never beyond $20 from entry, and never widened. §7: no loss with
   |exit − entry| > 20, and no closed trade whose stop in trade_stops moved away
   from entry. The second half reaches only a trade the poller saw carry a
   stop, so without one a loss is judged on the cap alone and a win is not in
   the population. An exit past a stop that never moved is slippage, and
   passes.

   Each sighting is held against the last stop that rested, so a stop pulled
   and put back further out is caught. One pulled and never put back recorded
   no distance: unknown.
   ───────────────────────────────────────────────────────────────────────── */
export const FULL_STOP = 20;

function r02(rows: TradeRow[], stops: Map<string, Stop[]>): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  for (const t of rows) {
    if (!isBroker(t) || !closed(t)) continue;
    const loss = (t.pnl as number) < 0;
    const seen = history(stops, t.id).map(s => s.sl == null ? null : Number(s.sl));
    const rested = seen.filter((sl): sl is number => sl !== null);
    if (!loss && !rested.length) continue;

    const wider = rested.some((sl, i) =>
      i > 0 && (t.direction === 'BUY' ? sl < rested[i - 1] - CENT : sl > rested[i - 1] + CENT));
    const pulled = rested.length > 0 && seen[seen.length - 1] === null;

    if ((loss && priced(t) && gap(t) > FULL_STOP + CENT) || wider) fail.push(t.id);
    else if ((loss && !priced(t)) || pulled) unknown.push(t.id);
    else pass.push(t.id);
  }
  return result('R-02', `losses further than $${FULL_STOP} from entry, and stops moved away from entry where the poller recorded them`,
                pass, fail, unknown);
}

/* ─── R-03 ─────────────────────────────────────────────────────────────────
   No entry after a full-stop loss the same day. §7: within an open_day, no
   entry later than the fill of a loss with |exit − entry| ≥ 20. A full stop
   is the stop at its $20 ceiling, by his definition, so a smaller loss leaves
   the population — and a sweep re-entry follows only a stop tighter than that
   (v1.24), since a full stop is already the day's 4%.

   Unknown only where the answer could differ: an unpriced loss might be a full
   stop, and one with no fill_time cannot be placed — but a day with one entry
   cannot breach whatever it is. A known breach stands regardless.
   ───────────────────────────────────────────────────────────────────────── */
function r03(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];

  for (const [day, all] of byDay(rows)) {
    const entries = all.filter(t => t.entry_time).map(t => +new Date(t.entry_time as string));
    const losses = all.filter(t => closed(t) && (t.pnl as number) < 0);
    const full = losses.filter(t => priced(t) && gap(t) >= FULL_STOP - CENT);
    const unmeasured = losses.filter(t => !priced(t));
    if (!full.length && !unmeasured.length) continue;

    // Entries after the loss closed; null with no instant to count from.
    const after = (t: TradeRow) =>
      t.fill_time ? entries.filter(at => at > +new Date(t.fill_time as string)).length : null;

    if (full.some(t => (after(t) ?? 0) >= 1)) { fail.push(day); continue; }
    const couldBreach = entries.length >= 2 &&
      [...full, ...unmeasured].some(t => after(t) === null || (after(t) as number) >= 1);
    if (couldBreach) unknown.push(day);
    else if (full.length) pass.push(day);
  }
  return result('R-03', `days with an entry after a full-stop loss — a loss $${FULL_STOP} or more from entry`,
                pass, fail, unknown);
}

/* ─── R-04 ─────────────────────────────────────────────────────────────────
   Stop to break-even at +$20. §7: no loss beyond the scratch band on a trade
   whose best_price ran $20 or more his way. Losses only: a win says nothing
   about the stop, and an exit inside the band is R-04 having fired. A loss
   that never ran $20 passes, the rule never having engaged.

   best_price can fall short of what happened, never exceed it, so a breach can
   be missed but not invented. Null is unknown.
   ───────────────────────────────────────────────────────────────────────── */
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
   One position at a time. §7: no two entry→fill spans overlap.

   Three states. Closed with a fill_time: the span ends there. Closed with an
   exit_price and no fill_time: the end is unknown, so the row is unresolved —
   running it to now once failed every later trade. Neither: still open, and it
   runs to now, the clearest breach there is.

   Two sweeps, because comparing each span with the one before it misses a
   nested set: a multi-session hold covers everything opened inside it, and the
   third such trade came back a pass. The verdict never showed it — something
   always overlapped — but the counts and ids he checks did. Forward for a span
   starting before an earlier one ends, backward for one ending after a later
   one starts: every overlapping span, one pass each.
   ───────────────────────────────────────────────────────────────────────── */
function r10(rows: TradeRow[], now: number): RuleResult {
  const dated = rows.filter(t => isBroker(t) && t.entry_time);

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

  // Strict: closing in the instant the next opens is a handover.
  let ends = -Infinity;
  for (const s of spans) {
    if (s.from < ends) bad.add(s.id);
    ends = Math.max(ends, s.to);
  }

  // The same test from the other side: catches the long hold.
  let starts = Infinity;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].to > starts) bad.add(spans[i].id);
    starts = Math.min(starts, spans[i].from);
  }

  for (const s of spans) (bad.has(s.id) ? fail : pass).push(s.id);
  return result('R-10', 'positions whose open spans overlap another', pass, fail, unknown);
}

/* ─── R-11 ─────────────────────────────────────────────────────────────────
   The day ends at −4% of account. §7: within an open_day, no entry later than
   the fill of the loss that took cumulative P&L past −4% of size_oz × 500.
   Never `balance`, which §8 withholds because it moves on transfers. No size,
   no account: unknown.
   ───────────────────────────────────────────────────────────────────────── */
export const DAY_LOSS = 0.04;

function r11(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];

  for (const [day, all] of byDay(rows)) {
    const done = all.filter(t => t.pnl != null);
    if (!done.length) continue;

    // One size or none. A day carrying two is exactly R-13's day, and 4 oz and
    // 20 oz imply floors far apart: two sizes is no account.
    const sizes = new Set(done.map(t => t.size_oz).filter(s => s != null));
    if (sizes.size !== 1) { unknown.push(day); continue; }
    const size = [...sizes][0] as number;

    /* A closed row with no fill_time cannot be placed in a running total: a lost
       loss passes the day, a lost win breaches it. So the day is unknown.
       dayStanding sums and needs no order, so it stays whole. */
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
   One entry a day; two only for a sweep re-entry. §7: three or more is a fail;
   a second more than 15 minutes after the prior fill is a fail, within 15 is
   unknown — no row says an entry was a sweep re-entry, so a prompt one is
   undecidable by construction.

   A second entry while the first was still open is a second position, which he
   does not trade (v1.21): a fail, not a prompt re-entry, though the gap reads
   negative. A first closed with no instant stays unknown.
   ───────────────────────────────────────────────────────────────────────── */
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
    if (!first.fill_time) { (first.exit_price === null ? fail : unknown).push(day); continue; }
    const apart = (+new Date(second.entry_time as string) - +new Date(first.fill_time)) / 60000;
    (apart > SWEEP_MIN || apart < 0 ? fail : unknown).push(day);
  }
  return result('R-12', `days with a second entry taken while the first was open or more than ${SWEEP_MIN} minutes after it closed, or a third entry at all`,
                pass, fail, unknown);
}

/* ─── R-13 ─────────────────────────────────────────────────────────────────
   The sizing rung moves only between months. §7: one size_oz per calendar
   month. The month is sliced off open_day, the civil day a trade is filed on,
   whatever UTC says.
   ───────────────────────────────────────────────────────────────────────── */
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

/* ─── The calendar R-19 is judged against ──────────────────────────────────
   High impact is a US release TradingView rates high. HIGH and HOME are his
   decision (v1.20), imported by the query that reads the calendar; the
   calendar also holds releases from abroad, and none of them is one of his.

   A week nobody fetched is not a quiet week: `weeks` is evidence of a
   whole-week fetch, and a position outside one is unknown.
   ───────────────────────────────────────────────────────────────────────── */
export const HIGH = 'high';
export const HOME = 'US';

export interface Calendar { releases: string[]; weeks: Set<string> }

// The Sunday, New York, the week began on — calendar_weeks' key.
export function weekOf(at: Date): string {
  const w = nyWall(at);
  return new Date(Date.UTC(w.y, w.m - 1, w.d - w.wd)).toISOString().slice(0, 10);
}

/* ─── R-15 ─────────────────────────────────────────────────────────────────
   Nothing held over the weekend. §7: no entry before and fill after a Friday
   17:00 New York close. Walked day by day, because that close is a wall-clock
   instant whose UTC value moves with the offset. A span over a month is not
   this account, and is unknown.
   ───────────────────────────────────────────────────────────────────────── */
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
    // Closed with no instant: unknown, never silently dropped. Still open: not
    // closed at all, so skipped.
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
   No trading on known low-volume days. §7: no entry on a US market or bank
   holiday or in the Christmas stretch, by the New York civil day.
   ───────────────────────────────────────────────────────────────────────── */
function r16(rows: TradeRow[]): RuleResult {
  const pass: string[] = [], fail: string[] = [];
  const cache = new Map<number, Set<string>>();

  for (const t of rows) {
    if (!isBroker(t) || !t.entry_time) continue;
    const day = nyDate(new Date(t.entry_time));
    const year = +day.slice(0, 4);
    if (!cache.has(year)) cache.set(year, lowVolumeDays(year));
    ((cache.get(year) as Set<string>).has(day) ? fail : pass).push(t.id);
  }
  return result('R-16', 'entries taken on a US market or bank holiday, or in the Christmas stretch', pass, fail, []);
}

/* ─── R-18 ─────────────────────────────────────────────────────────────────
   Stop and target rest at the broker; never closed by hand. §7: no closed trade
   without a broker alert, the Friday close excepted. cTrader emails on a stop
   or target fill and sends nothing for a hand close, and net_pnl comes from
   that alert alone — so a closed row without one was closed by him. The prices
   cannot say this.

   The Friday close-out reads through R-01's window, so the rules agree on what
   it is. Inside the grace a close is unknown, the alert normally seconds
   behind; one with no instant cannot be placed. The one way to be wrong — an
   alert the email path lost — carries the id, to be looked up in Gmail.
   ───────────────────────────────────────────────────────────────────────── */
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

/* ─── R-19 ─────────────────────────────────────────────────────────────────
   A print on a position from an earlier session: in profit, stop to
   break-even; losing, tighten; target never moves; never wider. §7: judged at
   the first high-rated US release inside the span whose session differs from
   the entry's, against the stop and target then in force. Narrow because §6
   made it so: a print in the entry's own session was taken on at entry, and
   is R-20's caution, which no row can see.

   A stop tightened short of break-even is the rule when losing and a breach
   when winning, and no row says which it was: unknown. At or past break-even
   passes either way; untouched, wider, or a moved target fails either way.

   STOP_GRACE_MIN covers the poller writing a move up to two minutes late — so
   a move just after the print also passes, the side this errs on. A stop
   history starting after the print is unknown.
   ───────────────────────────────────────────────────────────────────────── */
export const STOP_GRACE_MIN = 5;

function r19(rows: TradeRow[], cal: Calendar, stops: Map<string, Stop[]>): RuleResult {
  const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
  const prints = cal.releases.map(r => +new Date(r)).sort((a, b) => a - b);
  const price = (v: number | null) => v == null ? null : Number(v);

  for (const t of rows) {
    if (!isBroker(t) || !t.entry_time) continue;
    const entry = new Date(t.entry_time), e = +entry;
    if (!cal.weeks.has(weekOf(entry))) { unknown.push(t.id); continue; }
    // Closed with no instant: no end to the span.
    if (!t.fill_time && t.exit_price !== null) { unknown.push(t.id); continue; }
    const end = t.fill_time ? +new Date(t.fill_time) : Infinity;

    const opened = sessionAt(entry);
    const print = prints.find(p => p > e && p < end && sessionAt(new Date(p)) !== opened);
    if (print === undefined) continue;

    const seen = history(stops, t.id);
    const first = seen[0];
    const held = seen.filter(s => +new Date(s.seen_at) <= print + STOP_GRACE_MIN * 60_000).pop();
    const buy = t.direction === 'BUY';
    if (!first || !held || +new Date(first.seen_at) > print || t.entry_price == null ||
        (t.direction !== 'BUY' && t.direction !== 'SELL')) { unknown.push(t.id); continue; }

    const [was, now] = [price(first.sl), price(held.sl)];
    const targetMoved = price(first.tp) !== null && price(held.tp) !== price(first.tp);
    const wider = was !== null && now !== null && (buy ? now < was : now > was);
    if (targetMoved || wider) { fail.push(t.id); continue; }
    if (was === null || now === null) { unknown.push(t.id); continue; }

    const atEntry = buy ? now >= t.entry_price - CENT : now <= t.entry_price + CENT;
    if (atEntry) pass.push(t.id);
    else (now === was ? fail : unknown).push(t.id);
  }
  return result('R-19', 'positions from an earlier session a high-rated US release landed on, judged on the stop and target in force at the print',
                pass, fail, unknown);
}

/* One pass to bucket by filing day, as Data.byDay does in the app. */
function byDay(rows: TradeRow[]): Map<string, TradeRow[]> {
  const days = new Map<string, TradeRow[]>();
  for (const t of rows) {
    if (!isBroker(t) || !t.open_day) continue;
    const list = days.get(t.open_day);
    if (list) list.push(t); else days.set(t.open_day, [t]);
  }
  return days;
}

/* The whole set in §7's order, so a rule that stopped being evaluated is a gap
   in a sequence she can see. */
export function checkRules(rows: TradeRow[], now = Date.now(),
                           cal: Calendar = { releases: [], weeks: new Set() },
                           stops: Map<string, Stop[]> = new Map()): RuleResult[] {
  return [r01(rows), r02(rows, stops), r03(rows), r04(rows), r10(rows, now), r11(rows),
          r12(rows), r13(rows), r15(rows), r16(rows), r18(rows, now),
          r19(rows, cal, stops)];
}

/* ─── Where a day stands right now ────────────────────────────────────────
   R-11 asks whether he traded AFTER the limit — a question about the past that
   answers pass at the moment the limit is reached. This asks whether the day
   is past its limit NOW, which is when a close is worth waking her for. Null
   when no account can be derived.
   ───────────────────────────────────────────────────────────────────────── */
export interface Standing { day: string; pnl: number; account: number; breached: boolean }

export function dayStanding(rows: TradeRow[], day: string): Standing | null {
  const all = rows.filter(t => isBroker(t) && t.open_day === day);
  if (!all.length) return null;

  // Two sizes is no account. A sum, not a sequence, so an unstamped close
  // still counts.
  const sizes = new Set(all.map(t => t.size_oz).filter(s => s != null));
  if (sizes.size !== 1) return null;
  const size = [...sizes][0] as number;

  const pnl = all.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const account = size * 500;
  return { day, pnl, account, breached: pnl <= -DAY_LOSS * account };
}

/* Rendered here, so what she is told is a decision a test can read. Ids only
   where something failed or is undecided — on a pass they are noise. */
export function adherenceList(results: RuleResult[]): string {
  return results.map(r => {
    const counts = `${r.passed} pass, ${r.failed} fail, ${r.unresolved} unknown`;
    const named = r.ids.length ? ` — ${r.ids.join(', ')}` : '';
    return `${r.rule}: ${r.verdict.toUpperCase()} (${counts}) · ${r.why}${named}`;
  }).join("\n");
}
