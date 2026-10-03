// ═══════════════════════════════════════════════════════════════════════════
// THE JOURNAL SUMMARISED — the app's own arithmetic, where she can reach it
// ───────────────────────────────────────────────────────────────────────────
// The win rate, money split, realised reward-to-risk and breakdowns index.html
// computes, so get_stats answers without her applying the rules by hand over
// four hundred rows — the thing a model is worst at, and a rate computed wrong
// looks exactly like one computed right.
//
// Pure, and a copy of the app's definitions that agree.test.mjs holds to it.
// The three places the app is deliberately subtle:
//
//   · A scratch is measured in PRICE — ±$3 of the entry at any size — or the
//     band would shift with every lot size. Rows without prices fall back to
//     P&L, the only measure they have.
//   · `money` splits on the SIGN, keeping gross − loss equal to net; `averages`
//     splits on the RESULT LABEL, or a scratch would halve an average win.
//   · A break-even is in the win rate's denominator; dropping scratches
//     flatters exactly the trader who scratches a lot.
// ═══════════════════════════════════════════════════════════════════════════
import type { TradeRow } from "./adherence.ts";

/* ±$3 of the entry PRICE, one fill. `CONFIG.BE` in the app. */
export const BE = 3;

/* Each centre on its own local clock, so London's boundary moves with London's
   daylight saving — four time zones, not four offsets. `Dates.MARKETS` in the
   app. */
export const MARKETS = {
  sydney: { tz: 'Australia/Sydney',  open: 7,  close: 16 },
  tokyo:  { tz: 'Asia/Tokyo',        open: 9,  close: 18 },
  london: { tz: 'Europe/London',     open: 8,  close: 17 },
  ny:     { tz: 'America/New_York',  open: 8,  close: 17 },
} as const;

// Overlaps first, as the more specific case; the gap between the New York close
// and the Sydney open folds into Asian. `CONFIG.SESSIONS`, in the same order.
export const SESSIONS =
  ['Asian', 'Asia+London', 'London', 'London+NY', 'New York'] as const;

// h23, or an hour of 24 fails every `h >= open`. Held per zone rather than
// built per call: construction is the expensive part, and sessionAt asks up to
// four hours per trade.
const HOUR_FMT: Record<string, Intl.DateTimeFormat> = {};

const hourIn = (tz: string, at: Date): number => +(HOUR_FMT[tz] ??=
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', hourCycle: 'h23',
  })).format(at);

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

// Off the entry, else the fill: an email-only row has no entry_time.
export const sessionOf = (t: TradeRow): string | null =>
  t.entry_time ? sessionAt(new Date(t.entry_time))
  : t.fill_time ? sessionAt(new Date(t.fill_time))
  : null;

export type Result = 'win' | 'loss' | 'be';

/* No P&L is undecided, never a loss. */
export function resultOf(t: TradeRow): Result | null {
  if (t.pnl == null) return null;
  const scratch = t.entry_price != null && t.exit_price != null
    ? Math.abs(t.exit_price - t.entry_price) <= BE
    : Math.abs(t.pnl) <= BE;
  // Exactly zero is a break-even whatever the price did, as in the app.
  return scratch || t.pnl === 0 ? 'be' : t.pnl > 0 ? 'win' : 'loss';
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface Counts { win: number; loss: number; be: number; decided: number; wr: number | null }

// Over decided trades, break-evens included. Null on an empty population:
// nothing decided is not a win rate of none.
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

// On the sign, so gross − loss is exactly net.
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

// On the result label — the one place this must differ from money().
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

/* Realised, never planned: average win over average loss. The planned ratio is
   R-08 step 4, readable only off rows carrying the plan as first seen, and not
   computed here. Null with no loss to divide by. */
export const realisedRR = (a: Averages): number | null =>
  a.avgWin !== null && a.avgLoss ? round2(a.avgWin / a.avgLoss) : null;

// Setup and all three answers; P&L is not required, since a position can be
// journalled while open.
export const isJournalled = (t: TradeRow): boolean =>
  !!t.setup && t.followed_rules != null && t.followed_sl != null && t.followed_tp != null;

export interface Slice { key: string; n: number; counts: Counts; money: Money }

// One pass over the rows, not a scan per key.
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

/* How many dollars are settled, which a net figure cannot say. `pnl` is
   coalesce(net_pnl, computed_pnl), and a row without net_pnl is the folded
   figure, with no swap. The rows show that; a total does not, and this tool is
   preferred over the rows — so it counts them. Only a hold across the 17:00
   roll is short, by a night's carry. */
export interface Stats {
  n: number;
  journalled: number;
  counts: Counts;
  money: Money;
  averages: Averages;
  rr: number | null;
  // Of the rows with a P&L: the broker's settled figure, or the fold.
  settled: number;
  fellBack: number;
  // Rows whose session comes from the closing fill, the poller never having
  // reached them.
  seam: number;
  bySession: Slice[];
  bySetup: Slice[];
}

export function journalStats(rows: TradeRow[]): Stats {
  const avg = averages(rows);
  const priced = rows.filter(t => t.pnl != null);
  return {
    n: rows.length,
    journalled: rows.filter(isJournalled).length,
    counts: counts(rows),
    money: money(rows),
    averages: avg,
    rr: realisedRR(avg),
    settled: priced.filter(t => t.net_pnl != null).length,
    fellBack: priced.filter(t => t.net_pnl == null).length,
    seam: rows.filter(t => t.entry_time == null && t.fill_time != null).length,
    // One slice pass, ordered by the app's list, so the sessions read as he
    // sees them and an empty one is absent.
    bySession: (bySession => SESSIONS
      .map(s => bySession.find(x => x.key === s))
      .filter((x): x is Slice => !!x))(sliceBy(rows, sessionOf)),
    bySetup: sliceBy(rows, t => t.setup),
  };
}

const pct = (v: number | null) => v === null ? '—' : `${v}%`;
const usd = (v: number | null) => v === null ? '—' : `$${v.toFixed(2)}`;

/* Rendered here, so what she is told is a decision a test can read. Every
   figure carries its population: a rate without its denominator is what §8
   warns about. */
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
    // Only where there is one; the tool description carries the meaning.
    s.fellBack
      ? `· ${s.settled} of those are the broker's settled figure and ${s.fellBack} ` +
        `fell back to the folded one, which carries no swap — so the net above is ` +
        `short by whatever those ${s.fellBack} accrued across a 17:00 roll. Say so ` +
        `if you give him this total.`
      : '',
    `· average win ${usd(s.averages.avgWin)}, average loss ${usd(s.averages.avgLoss)}, ` +
      `realised reward-to-risk ${s.rr === null ? '—' : `1:${s.rr}`} — realised, not planned`,
    // The session seam, on the same terms: a row without entry_time takes its
    // session from the close, which can differ on anything held across one.
    s.seam && s.bySession.length
      ? `· ${s.seam} of these have no entry_time, so their session below is taken ` +
        `from the closing fill rather than the entry. Say so before reading a ` +
        `pattern off the session split.`
      : '',
    s.bySession.length ? `\nBy session:\n${s.bySession.map(line).join('\n')}` : '',
    s.bySetup.length ? `\nBy setup:\n${s.bySetup.map(line).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}
