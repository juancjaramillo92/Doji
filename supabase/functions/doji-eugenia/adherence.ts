// ═══════════════════════════════════════════════════════════════════════════
// THE STRATEGY, EXECUTED — the eight rules a row can actually answer
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
// EIGHT RULES, AND THE SET IS NOT A CHOICE. §7's Evaluable column decides it:
// `journal` means a row can answer it today. R-03 is `field`, and R-04 through
// R-09, R-14, R-17, R-18 and R-19 are `judgment` — nothing stored can see them,
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
    // Under $25. A Friday close-out is the one exit the data cannot tell from a
    // discretionary one, so it is unknown rather than either answer.
    if (t.fill_time && nearFridayClose(new Date(t.fill_time))) unknown.push(t.id);
    else fail.push(t.id);
  }
  return result('R-01', 'wins closing under $25 from entry, Friday close-outs excepted',
                pass, fail, unknown);
}

/* ─── R-02 ─────────────────────────────────────────────────────────────────
   Stop never beyond $20 from entry. §7: no loss with |exit − entry| > 20 — the
   CAP only. The other half of R-02, whether the stop was RESPECTED, is not
   recoverable: the broker reports only the final stop, so one moved to
   break-even has overwritten the original. This checks the cap and says so. */
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

/* ─── R-10 ─────────────────────────────────────────────────────────────────
   One position at a time. §7: no two rows whose entry_time→fill_time spans
   overlap.

   AN OPEN POSITION EXTENDS TO NOW, not to null. A trade still running while a
   second one opened is the clearest possible breach of this rule, and treating
   a null fill_time as "no span" would drop exactly that case. */
function r10(rows: TradeRow[], now: number): RuleResult {
  const spans = rows
    .filter(t => isBroker(t) && t.entry_time)
    .map(t => ({
      id: t.id,
      from: new Date(t.entry_time as string).getTime(),
      to: t.fill_time ? new Date(t.fill_time).getTime() : now,
    }))
    .sort((a, b) => a.from - b.from);

  const pass: string[] = [], fail: string[] = [];
  const bad = new Set<string>();
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].from < spans[i - 1].to) { bad.add(spans[i - 1].id); bad.add(spans[i].id); }
  }
  for (const s of spans) (bad.has(s.id) ? fail : pass).push(s.id);
  return result('R-10', 'positions whose open spans overlap another', pass, fail, []);
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
    const settled = all.filter(t => t.pnl != null && t.fill_time)
      .sort((a, b) => +new Date(a.fill_time as string) - +new Date(b.fill_time as string));
    if (!settled.length) continue;

    const size = all.map(t => t.size_oz).find(s => s != null);
    if (size == null) { unknown.push(day); continue; }

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
    if (!isBroker(t) || !t.entry_time || !t.fill_time) continue;
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
export function checkRules(rows: TradeRow[], now = Date.now()): RuleResult[] {
  return [r01(rows), r02(rows), r10(rows, now), r11(rows), r12(rows), r13(rows), r15(rows), r16(rows)];
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

  const size = all.map(t => t.size_oz).find(s => s != null);
  if (size == null) return null;

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
