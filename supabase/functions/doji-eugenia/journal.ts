// ═══════════════════════════════════════════════════════════════════════════
// THE JOURNAL SUMMARISED — the app's own arithmetic, where she can reach it
// ───────────────────────────────────────────────────────────────────────────
// `index.html` computes a win rate, a money split, a realised reward-to-risk
// and a session breakdown, and she could see none of it. What she had was up to
// four hundred rows of JSON and a prompt telling her the rules to apply to them
// by hand — which is the same arrangement `adherence.ts` was written to end,
// for the same reason: that is the one thing a model is worst at, and a rate
// computed the wrong way looks exactly like one computed the right way.
//
// The prompt already carries every definition below. That is the tell. A rule
// stated to a model and applied by it on every question is a rule that will be
// applied differently on some of them.
//
// PURE, AND A COPY THAT A TEST HOLDS. These are the app's definitions, in a
// second runtime, with no build step between them — so `agree.test.mjs` reads
// both and fails when they part. That is the price of four runtimes; the copy
// nothing compares is the defect, not the copy.
//
// THE THREE PLACES THE APP IS DELIBERATELY SUBTLE, all of which she got wrong
// by hand and all of which are load-bearing here:
//
//   · A scratch is measured in PRICE, not dollars — ±$3 of the ENTRY PRICE at
//     any lot size. Read against P&L the band would mean something different
//     every time size changed. Rows with no prices fall back to P&L, which is
//     the only measure they have.
//   · `money` splits on the SIGN of each P&L and `averages` splits on the
//     RESULT LABEL, and that difference is the point: it keeps gross − loss
//     exactly equal to net, while a scratch bucketed with the winners would
//     halve an average win.
//   · A break-even is in the win rate's DENOMINATOR. Scratches drag it down
//     rather than vanishing, and a rate that quietly drops them is higher than
//     the truth on exactly the trader who scratches a lot.
// ═══════════════════════════════════════════════════════════════════════════
import type { TradeRow } from "./adherence.ts";

/* ±$3 of the entry PRICE, one fill. `CONFIG.BE` in the app. */
export const BE = 3;

/* Each centre against its OWN local clock, so London's boundary moves with
   London's daylight saving rather than New York's — which is why this is four
   time zones rather than four offsets. `Dates.MARKETS` in the app. */
export const MARKETS = {
  sydney: { tz: 'Australia/Sydney',  open: 7,  close: 16 },
  tokyo:  { tz: 'Asia/Tokyo',        open: 9,  close: 18 },
  london: { tz: 'Europe/London',     open: 8,  close: 17 },
  ny:     { tz: 'America/New_York',  open: 8,  close: 17 },
} as const;

// The overlaps are the more specific case and are tested first; the dead
// stretch between the New York close and the Sydney open folds into Asian, the
// session it precedes. `CONFIG.SESSIONS` in the app, in the same order.
export const SESSIONS =
  ['Asian', 'Asia+London', 'London', 'London+NY', 'New York'] as const;

// hourCycle rather than hour12, for the reason every other clock in this repo
// states it: hour12:false leaves the cycle to the locale and can resolve to
// h24, and an hour of 24 fails every `h >= open` it meets.
const hourIn = (tz: string, at: Date): number => +new Intl.DateTimeFormat('en-US', {
  timeZone: tz, hour: '2-digit', hourCycle: 'h23',
}).format(at);

const isOpen = (m: { tz: string; open: number; close: number }, at: Date): boolean => {
  const h = hourIn(m.tz, at);
  return h >= m.open && h < m.close;
};

export function sessionAt(at: Date): string {
  const london = isOpen(MARKETS.london, at);
  const ny     = isOpen(MARKETS.ny, at);
  const asia   = isOpen(MARKETS.tokyo, at) || isOpen(MARKETS.sydney, at);
  if (london && ny)   return 'London+NY';
  if (london && asia) return 'Asia+London';
  if (london)         return 'London';
  if (ny)             return 'New York';
  return 'Asian';
}

// Off the entry, falling back to the fill — an email-only row the poller never
// reached has no entry_time and its fill is the only instant it carries.
export const sessionOf = (t: TradeRow): string | null =>
  t.entry_time ? sessionAt(new Date(t.entry_time))
  : t.fill_time ? sessionAt(new Date(t.fill_time))
  : null;

export type Result = 'win' | 'loss' | 'be';

/* A trade with no P&L is UNDECIDED and belongs to neither side. It is not a
   loss, and counting it as one is the shape of error that makes a bad month
   look worse than it was. */
export function resultOf(t: TradeRow): Result | null {
  if (t.pnl == null) return null;
  const scratch = t.entry_price != null && t.exit_price != null
    ? Math.abs(t.exit_price - t.entry_price) <= BE
    : Math.abs(t.pnl) <= BE;
  return scratch ? 'be' : t.pnl > 0 ? 'win' : 'loss';
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface Counts { win: number; loss: number; be: number; decided: number; wr: number | null }

// Over DECIDED trades, with break-evens in the denominator. `wr` is null rather
// than zero on an empty population: nothing decided is not a win rate of none.
export function counts(rows: TradeRow[]): Counts {
  const out = { win: 0, loss: 0, be: 0, decided: 0, wr: null as number | null };
  for (const t of rows) {
    const r = resultOf(t);
    if (r) out[r]++;
  }
  out.decided = out.win + out.loss + out.be;
  out.wr = out.decided ? round2(out.win / out.decided * 100) : null;
  return out;
}

export interface Money { n: number; gross: number; loss: number; net: number }

// On the SIGN, which is what makes gross − loss come out exactly equal to net.
export function money(rows: TradeRow[]): Money {
  let gross = 0, loss = 0, n = 0;
  for (const t of rows) {
    if (t.pnl == null) continue;
    n++;
    if (t.pnl >= 0) gross += t.pnl; else loss -= t.pnl;
  }
  return { n, gross: round2(gross), loss: round2(loss), net: round2(gross - loss) };
}

export interface Averages { avgWin: number | null; avgLoss: number | null }

// On the RESULT LABEL, which is the one place this must differ from money().
export function averages(rows: TradeRow[]): Averages {
  let winSum = 0, winN = 0, lossSum = 0, lossN = 0;
  for (const t of rows) {
    const r = resultOf(t);
    if (r === 'win')  { winSum  += t.pnl as number; winN++;  }
    if (r === 'loss') { lossSum -= t.pnl as number; lossN++; }
  }
  return {
    avgWin:  winN  ? round2(winSum  / winN)  : null,
    avgLoss: lossN ? round2(lossSum / lossN) : null,
  };
}

/* REALISED, NEVER PLANNED, and the distinction is the whole of what she may say
   about it: average win over average loss, out of trades that closed. The
   planned ratio is R-08 step 4 and is a number HE runs — nothing records where
   the target was set, so it is asked and never computed. Null where there is no
   loss to divide by, because a ratio against nothing is not infinity, it is
   unanswerable. */
export const realisedRR = (a: Averages): number | null =>
  a.avgWin !== null && a.avgLoss ? round2(a.avgWin / a.avgLoss) : null;

// Setup and all three discipline answers. P&L is deliberately not required —
// a position can be journalled before it closes.
export const isJournalled = (t: TradeRow): boolean =>
  !!t.setup && t.followed_rules != null && t.followed_sl != null && t.followed_tp != null;

export interface Slice { key: string; n: number; counts: Counts; money: Money }

// Bucketed in ONE pass over the rows, so a slice is O(trades) rather than a
// scan per key — the same reason the app indexes once rather than filtering
// inside a loop.
function sliceBy(rows: TradeRow[], key: (t: TradeRow) => string | null): Slice[] {
  const buckets = new Map<string, TradeRow[]>();
  for (const t of rows) {
    const k = key(t);
    if (k === null) continue;
    const list = buckets.get(k);
    if (list) list.push(t); else buckets.set(k, [t]);
  }
  return [...buckets].map(([k, list]) =>
    ({ key: k, n: list.length, counts: counts(list), money: money(list) }));
}

export interface Stats {
  n: number;
  journalled: number;
  counts: Counts;
  money: Money;
  averages: Averages;
  rr: number | null;
  bySession: Slice[];
  bySetup: Slice[];
}

export function journalStats(rows: TradeRow[]): Stats {
  const avg = averages(rows);
  return {
    n: rows.length,
    journalled: rows.filter(isJournalled).length,
    counts: counts(rows),
    money: money(rows),
    averages: avg,
    rr: realisedRR(avg),
    // Ordered by the app's own list rather than by whatever the rows produced,
    // so a session with no trades is absent and the rest read in the order he
    // sees them on screen.
    bySession: SESSIONS
      .map(s => sliceBy(rows, sessionOf).find(x => x.key === s))
      .filter((x): x is Slice => !!x),
    bySetup: sliceBy(rows, t => t.setup),
  };
}

const pct = (v: number | null) => v === null ? '—' : `${v}%`;
const usd = (v: number | null) => v === null ? '—' : `$${v.toFixed(2)}`;

/* Rendered here rather than by the caller, for the reason adherenceList and
   searchList are: what she is told is a decision, and a decision a test can
   read. Every figure carries the population it was taken over, because a rate
   without its denominator is the thing §8 warns about arriving as a number. */
export function statsList(s: Stats, days: number): string {
  if (!s.n) return `No trades in the last ${days} days.`;
  const c = s.counts;
  const line = (x: Slice) =>
    `· ${x.key}: ${x.n} trade${x.n === 1 ? '' : 's'}, ` +
    `${pct(x.counts.wr)} win rate over ${x.counts.decided} decided, net ${usd(x.money.net)}`;

  return [
    `The last ${days} days, computed from the rows rather than read off them:`,
    `· ${s.n} trades, ${s.journalled} journalled`,
    `· ${pct(c.wr)} win rate — ${c.win} win, ${c.loss} loss, ${c.be} break-even, ` +
      `over ${c.decided} decided. Break-evens are IN that denominator.`,
    `· gross ${usd(s.money.gross)}, losses ${usd(s.money.loss)}, net ${usd(s.money.net)}, ` +
      `over ${s.money.n} rows carrying a P&L`,
    `· average win ${usd(s.averages.avgWin)}, average loss ${usd(s.averages.avgLoss)}, ` +
      `realised reward-to-risk ${s.rr === null ? '—' : `1:${s.rr}`} — realised, not planned`,
    s.bySession.length ? `\nBy session:\n${s.bySession.map(line).join('\n')}` : '',
    s.bySetup.length ? `\nBy setup:\n${s.bySetup.map(line).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}
