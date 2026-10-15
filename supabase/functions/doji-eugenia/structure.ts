/* ═══════════════════════════════════════════════════════════════════════════
   HIS CHARTS, READ IN HIS WORDS  ·  pure
   ───────────────────────────────────────────────────────────────────────────
   The broker's bars on his six charts, folded into what §4 marks a chart with:
   where price has turned, the $25 grid, where the two agree, which levels sit
   at the edge of the range and which inside it, a wick through a turn that
   closed back, and the sequence the turns make on the bias charts. In code,
   because the highest high in a hundred and thirty bars is the arithmetic a
   model does worst — scoreCall's reason.

   Every figure is one price has already printed. A run of higher highs is a
   description of the bars behind it, and nothing here says where price goes.
   It is her map, built the same way every time; his is drawn in TradingView.
   ═══════════════════════════════════════════════════════════════════════════ */
import { CHARTS, type Candle, type Period } from "../_shared/edge.ts";
import { sessionAt } from "./journal.ts";

/* Readings rather than facts, as STRETCH is, named so each can be argued with,
   and one object so scripts/calibrate.mjs can fold his past entries under
   others and see which find the levels he traded. */
export const READINGS = {
  // Bars on either side a turn must clear: on the hour, a turn that held three.
  TURN: 3,
  // A turn this close to a quarter sits on it, and two turns this close are one.
  ON_GRID: 3,
  // This close to the week's high or low is at the edge — R-06's extreme.
  EDGE: 5,
  // As far from price as the map is drawn: a call waits for its level and then
  // reaches $30 beyond it, so twice the target.
  REACH: 60,
  // Two highs this close are one ceiling price has failed at twice, and the
  // stops above it rest there until a bar trades through: his step 2's
  // liquidity pool. A low, mirrored.
  EQUAL: 1.5,
};
export type Readings = typeof READINGS;

// The newest wicks through a turn that closed back, the last day's only.
export const SWEEPS = 3;
// The closed candles of each entry chart handed over, oldest first: three can
// make a pattern, which one never does.
export const CANDLES = 4;

// §4's grid: 00 and 50 round, 25 and 75 the quarters between.
export const GRID = 25;
export const ADR_SESSIONS = 14;
const DAY = 86_400_000;

export interface Turn { price: number; at: number; kind: 'high' | 'low' }
export interface Bias { period: Period; trend: 'up' | 'down' | 'mixed' | null; highs: Turn[]; lows: Turn[]; close: number }
export interface Level {
  price: number; sides: 'high' | 'low' | 'both'; periods: Period[]; at: number;
  quarter: number | null; edge: 'top' | 'bottom' | null;
}
export interface Quarter { price: number; round: boolean; turned: boolean }
export interface Sweep { period: Period; at: number; level: number; kind: 'high' | 'low'; wick: number; close: number }
export interface Pool { price: number; kind: 'high' | 'low'; periods: Period[]; touches: number[] }
export interface Session { name: string; from: number; to: number; high: number; low: number }
export interface Structure {
  last: Candle | null;
  bias: Bias[];
  range: { high: Turn; low: Turn } | null;
  levels: Level[];
  pools: Pool[];
  grid: Quarter[];
  sweeps: Sweep[];
  sessions: Session[];
  candles: { period: Period; bars: Candle[] }[];
  adr: number | null;
  today: number | null;
  missing: Period[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const msOf = (p: Period) => CHARTS.find(c => c.period === p)!.ms;

/* A bar still forming has no close yet, so a turn, a wick or a candle read off
   one is read off a price that has not finished printing. */
const closed = (bars: Candle[], p: Period, now: number) => bars.filter(b => b.t + msOf(p) <= now);

/* A bar whose high clears TURN bars before it and is not beaten by TURN after
   it — the first of two equal highs is the turn. A low, mirrored. The newest
   TURN bars can never be one: nothing yet says price turned there. */
export function turns(bars: Candle[], turn = READINGS.TURN): Turn[] {
  const out: Turn[] = [];
  for (let i = turn; i < bars.length - turn; i++) {
    const b = bars[i], before = bars.slice(i - turn, i), after = bars.slice(i + 1, i + 1 + turn);
    if (before.every(x => x.high < b.high) && after.every(x => x.high <= b.high)) {
      out.push({ price: b.high, at: b.t, kind: 'high' });
    }
    if (before.every(x => x.low > b.low) && after.every(x => x.low >= b.low)) {
      out.push({ price: b.low, at: b.t, kind: 'low' });
    }
  }
  return out;
}

/* The two newest turns of each kind, and the sequence they make. Fewer than two
   of either is no sequence, never a guess at one. */
export function biasOf(period: Period, bars: Candle[], turn = READINGS.TURN): Bias {
  const all = turns(bars, turn);
  const highs = all.filter(t => t.kind === 'high').slice(-2);
  const lows = all.filter(t => t.kind === 'low').slice(-2);
  const trend = highs.length < 2 || lows.length < 2 ? null
    : highs[1].price > highs[0].price && lows[1].price > lows[0].price ? 'up'
    : highs[1].price < highs[0].price && lows[1].price < lows[0].price ? 'down'
    : 'mixed';
  return { period, trend, highs, lows, close: bars[bars.length - 1].close };
}

/* A wick beyond a turn that closed back on the side it came from, while the
   turn still stood: no bar between had closed beyond it. §4.2's sweep. The
   bars that confirm a turn cannot be one, since none of them clears it. */
export function sweepsOf(period: Period, bars: Candle[], since: number, turn = READINGS.TURN): Sweep[] {
  const index = new Map(bars.map((b, i) => [b.t, i]));
  const out: Sweep[] = [];
  for (const s of turns(bars, turn)) {
    const from = index.get(s.at)!;
    const above = s.kind === 'high';
    for (let i = from + 1; i < bars.length; i++) {
      const b = bars[i];
      if (above ? b.close > s.price : b.close < s.price) break;
      if (b.t >= since && (above ? b.high > s.price : b.low < s.price)) {
        out.push({ period, at: b.t, level: s.price, kind: s.kind, wick: above ? b.high : b.low, close: b.close });
      }
    }
  }
  return out;
}

/* Two highs within EQUAL, more than TURN bars apart, with price gone at least
   ON_GRID away between them and nothing trading above either since the first:
   the stops above are still resting. The second of two equal highs is never a
   turn, which is why a pool is read off the bars and not the turns. A low,
   mirrored. Touches of one pool are merged, so a triple top is one line, and a
   bar within EQUAL above the ceiling is another touch that lifts it: only one
   further is the pool taken. */
export function poolsOf(period: Period, bars: Candle[], r = READINGS): Pool[] {
  const out: Pool[] = [];
  for (const kind of ['high', 'low'] as const) {
    const at = (b: Candle) => kind === 'high' ? b.high : b.low;
    const through = (b: Candle, level: number) => kind === 'high' ? b.high > level : b.low < level;
    const away = (b: Candle, level: number) =>
      kind === 'high' ? b.low <= level - r.ON_GRID : b.high >= level + r.ON_GRID;
    for (let j = 0; j < bars.length; j++) {
      for (let i = 0; i < j - r.TURN; i++) {
        if (Math.abs(at(bars[i]) - at(bars[j])) > r.EQUAL) continue;
        const level = kind === 'high' ? Math.max(at(bars[i]), at(bars[j])) : Math.min(at(bars[i]), at(bars[j]));
        const between = bars.slice(i + 1, j);
        if (!between.some(b => away(b, level)) || bars.slice(i + 1).some(b => through(b, level))) continue;
        const pool = out.find(p => p.kind === kind && Math.abs(p.price - level) <= r.EQUAL);
        if (!pool) { out.push({ price: level, kind, periods: [period], touches: [bars[i].t, bars[j].t] }); continue; }
        pool.price = kind === 'high' ? Math.max(pool.price, level) : Math.min(pool.price, level);
        pool.touches = [...new Set([...pool.touches, bars[i].t, bars[j].t])].sort((a, b) => a - b);
      }
    }
  }
  return out;
}

/* Turns from the two level charts, newest first, merged where they are one
   level; a high and a low on one price is a level that has flipped. */
function levelsOf(charts: Partial<Record<Period, Candle[]>>, now: number, price: number,
                  range: { high: Turn; low: Turn } | null, r: Readings): Level[] {
  const found = (['H_1', 'M_30'] as const).flatMap(p =>
    turns(closed(charts[p] ?? [], p, now), r.TURN).map(t => ({ ...t, period: p })));
  found.sort((a, b) => b.at - a.at);
  const levels: Level[] = [];
  for (const t of found) {
    if (Math.abs(t.price - price) > r.REACH) continue;
    const same = levels.find(l => Math.abs(l.price - t.price) <= r.ON_GRID);
    if (same) {
      if (same.sides !== t.kind) same.sides = 'both';
      if (!same.periods.includes(t.period)) same.periods.push(t.period);
      continue;
    }
    const quarter = Math.round(t.price / GRID) * GRID;
    levels.push({
      price: t.price, sides: t.kind, periods: [t.period], at: t.at,
      quarter: Math.abs(t.price - quarter) <= r.ON_GRID ? quarter : null,
      edge: !range ? null
        : Math.abs(t.price - range.high.price) <= r.EDGE ? 'top'
        : Math.abs(t.price - range.low.price) <= r.EDGE ? 'bottom'
        : null,
    });
  }
  return levels.sort((a, b) => b.price - a.price);
}

/* Contiguous runs of one session name over the last day, the bar still
   forming included: a session's range so far is what has printed. */
function sessionsOf(bars: Candle[], p: Period, since: number): Session[] {
  const out: Session[] = [];
  for (const b of bars.filter(b => b.t >= since)) {
    const name = sessionAt(new Date(b.t));
    const run = out[out.length - 1];
    if (run?.name === name) {
      run.to = b.t + msOf(p);
      run.high = Math.max(run.high, b.high);
      run.low = Math.min(run.low, b.low);
    } else {
      out.push({ name, from: b.t, to: b.t + msOf(p), high: b.high, low: b.low });
    }
  }
  return out;
}

export function foldStructure(charts: Partial<Record<Period, Candle[]>>, now: number,
                              r = READINGS): Structure {
  const read = (p: Period) => closed(charts[p] ?? [], p, now);
  const missing = CHARTS.filter(c => !charts[c.period]?.length).map(c => c.period);
  // The newest bar of the finest chart read: what price was when the map was.
  const finest = [...CHARTS].reverse().find(c => charts[c.period]?.length);
  const last = finest ? charts[finest.period]!.at(-1)! : null;

  // The week of hourly bars is the range R-05 and R-06 split, as his own
  // marking charts show it.
  const hourly = read('H_1');
  const top = hourly.reduce<Candle | null>((m, b) => !m || b.high > m.high ? b : m, null);
  const bottom = hourly.reduce<Candle | null>((m, b) => !m || b.low < m.low ? b : m, null);
  const range = top && bottom ? {
    high: { price: top.high, at: top.t, kind: 'high' as const },
    low: { price: bottom.low, at: bottom.t, kind: 'low' as const },
  } : null;

  const levels = last ? levelsOf(charts, now, last.close, range, r) : [];
  // One line for a pool both level charts show.
  const pools: Pool[] = [];
  for (const p of (['H_1', 'M_30'] as const).flatMap(p => poolsOf(p, read(p), r))) {
    if (!last || Math.abs(p.price - last.close) > r.REACH) continue;
    const same = pools.find(q => q.kind === p.kind && Math.abs(q.price - p.price) <= r.EQUAL);
    if (!same) { pools.push(p); continue; }
    same.periods.push(...p.periods.filter(x => !same.periods.includes(x)));
    same.touches = [...new Set([...same.touches, ...p.touches])].sort((a, b) => a - b);
  }
  pools.sort((a, b) => b.price - a.price);
  const grid: Quarter[] = [];
  if (last) {
    for (let q = Math.ceil((last.close - r.REACH) / GRID) * GRID; q <= last.close + r.REACH; q += GRID) {
      grid.push({ price: q, round: q % (2 * GRID) === 0, turned: levels.some(l => l.quarter === q) });
    }
  }

  const since = now - DAY;
  const daily = read('D_1');
  const forming = charts.D_1?.at(-1);
  return {
    last,
    bias: (['D_1', 'H_4', 'H_1'] as const).map(p => [p, read(p)] as const)
      .filter(([, bars]) => bars.length).map(([p, bars]) => biasOf(p, bars, r.TURN)),
    range,
    levels,
    pools,
    grid,
    sweeps: (['H_1', 'M_15'] as const).flatMap(p => sweepsOf(p, read(p), since, r.TURN))
      .sort((a, b) => b.at - a.at).slice(0, SWEEPS),
    sessions: sessionsOf(charts.M_15 ?? [], 'M_15', since),
    candles: (['M_15', 'M_5'] as const).map(p => ({ period: p, bars: read(p).slice(-CANDLES) }))
      .filter(c => c.bars.length),
    adr: daily.length
      ? round2(daily.slice(-ADR_SESSIONS).reduce((s, b) => s + b.high - b.low, 0) / Math.min(daily.length, ADR_SESSIONS))
      : null,
    today: forming && forming.t + msOf('D_1') > now ? round2(forming.high - forming.low) : null,
    missing,
  };
}
