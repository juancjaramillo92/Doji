/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — does her map have the levels he trades?
   ───────────────────────────────────────────────────────────────────────────
   Her map of his charts is drawn by readings (structure.ts's READINGS), and a
   reading is a guess until it is held against what he did. For each of his
   newest entries the poller serves the 1H and 30m as they stood the minute he
   clicked, nothing after it (`doji-mcp-sync?entries=1`). This folds her map
   there under every set of readings in GRID and asks three things:

   · how far his entry sat from the nearest level on the map;
   · how often that was within NEAR, against how often a level would sit that
     close to any price by chance, given how many the readings draw — the
     lift. A reading that draws a level every five dollars finds his entry
     every time and means nothing; the lift is what says it found HIS;
   · for an entry journalled with a setup, whether the map put that level
     where his rules put the setup: at the edge of the range for Support &
     Resistance (R-06), inside it for Break & Retest (R-05).

   It changes nothing. A reading worth changing is a behaviour change to
   structure.ts, its own commit, with this run's table in the message.

   Run:  SUPABASE_URL=… SB_SECRET_KEY=… DOJI_CRON_SECRET=… \
           node --experimental-strip-types scripts/calibrate.mjs
   Cost: forty broker reads through the poller, and one read of the journal.
   ═══════════════════════════════════════════════════════════════════════════ */
import { foldStructure, READINGS } from '../supabase/functions/doji-eugenia/structure.ts';

// Within this of a level, his entry was at it: a retest fills a few dollars
// off the line, and a rejection closes a few dollars away from it.
export const NEAR = 3;

// Today's value sits inside each range, so the run says whether it is beaten.
export const GRID = { TURN: [2, 3, 4, 5], ON_GRID: [2, 3, 5], EDGE: [3, 5, 8] };

export function readingsGrid() {
  return GRID.TURN.flatMap(TURN => GRID.ON_GRID.flatMap(ON_GRID => GRID.EDGE.map(EDGE =>
    ({ ...READINGS, TURN, ON_GRID, EDGE }))));
}

// In cents, as every price here is: halving two of them leaves float noise.
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 100) / 100;
};

/* One set of readings against every entry. An entry the map draws no level for
   is a miss at no distance it can name, and adds nothing to the chance. */
export function score(entries, setups, r) {
  let hits = 0, chance = 0, judged = 0, agreed = 0;
  const distances = [];
  for (const e of entries) {
    const levels = foldStructure(e.charts, e.at, r).levels;
    chance += Math.min(1, levels.length * NEAR / r.REACH);
    if (!levels.length) continue;
    const nearest = levels.reduce((m, l) =>
      Math.abs(l.price - e.entry_price) < Math.abs(m.price - e.entry_price) ? l : m);
    const d = Math.round(Math.abs(nearest.price - e.entry_price) * 100) / 100;
    distances.push(d);
    if (d > NEAR) continue;
    hits++;
    const setup = setups[e.id];
    if (setup === 'Support & Resistance' || setup === 'Break & Retest') {
      judged++;
      if ((setup === 'Support & Resistance') === (nearest.edge !== null)) agreed++;
    }
  }
  const n = entries.length;
  return {
    readings: { TURN: r.TURN, ON_GRID: r.ON_GRID, EDGE: r.EDGE },
    entries: n, hits, hit: n ? hits / n : null, chance: n ? chance / n : null,
    lift: hits && chance ? hits / chance : 0, median: median(distances), judged, agreed,
  };
}

const pct = (v) => v === null ? '—' : `${Math.round(v * 100)}%`;

export function table(rows) {
  const today = (r) => r.readings.TURN === READINGS.TURN && r.readings.ON_GRID === READINGS.ON_GRID &&
                       r.readings.EDGE === READINGS.EDGE;
  const lines = [...rows].sort((a, b) => b.lift - a.lift).map(r =>
    `${today(r) ? '*' : ' '} TURN ${r.readings.TURN}  ON_GRID ${r.readings.ON_GRID}  EDGE ${r.readings.EDGE}` +
    `  at a level ${pct(r.hit)} (chance ${pct(r.chance)}, lift ${r.lift.toFixed(2)})` +
    `  median $${r.median ?? '—'}  setup agrees ${r.agreed}/${r.judged}`);
  return [`${rows[0]?.entries ?? 0} entries, within $${NEAR} of a level; * is today's readings`, ...lines].join('\n');
}

async function main() {
  const { SUPABASE_URL: url, SB_SECRET_KEY: key, DOJI_CRON_SECRET: secret } = process.env;
  if (!url || !key || !secret) throw new Error('SUPABASE_URL, SB_SECRET_KEY and DOJI_CRON_SECRET must all be set');
  const res = await fetch(`${url}/functions/v1/doji-mcp-sync?entries=1`, { headers: { 'x-doji-key': secret } });
  if (!res.ok) throw new Error(`entries: HTTP ${res.status} ${await res.text()}`.slice(0, 300));
  const { entries } = await res.json();
  for (const e of entries.filter(e => e.missing.length)) {
    console.error(`${e.id}: not read — ${e.missing.map(m => `${m.period} ${m.error}`).join('; ')}`);
  }
  const ids = entries.map(e => e.id).join(',');
  const journal = await fetch(`${url}/rest/v1/trades?select=id,setup&id=in.(${ids})`, { headers: { apikey: key } });
  if (!journal.ok) throw new Error(`setups: HTTP ${journal.status} ${await journal.text()}`.slice(0, 300));
  const setups = Object.fromEntries((await journal.json()).map(t => [t.id, t.setup]));
  console.log(table(readingsGrid().map(r => score(entries, setups, r))));
}

// Only when run directly, so the test can import the functions above.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message); process.exitCode = 2; });
}
