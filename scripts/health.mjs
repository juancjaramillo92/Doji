/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — whether anything is running at all, asked from outside
   ───────────────────────────────────────────────────────────────────────────
   Every watcher here is a pg_cron job, and so is the briefing that reports
   them: pg_cron stopping, the project pausing, the poller's deploy vanishing —
   nothing inside the database can say any of it. This asks, from GitHub, the
   one question that sees all of them: has the poller, which pg_cron runs every
   two minutes and which marks a run even over the weekend, completed one
   within STALE_HOURS? The job fails when it has not, and GitHub's email about
   a failed run is the alarm.

   Staleness alone, and the briefing's own threshold, imported rather than
   copied: a poll that failed is hers to report, and one failed poll is not an
   outage — a run that keeps failing goes stale and is caught here too.

   Run:  SUPABASE_URL=... SB_SECRET_KEY=... node --experimental-strip-types scripts/health.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import { STALE_HOURS } from '../supabase/functions/doji-eugenia/index.ts';

/* The poller's last completed run. A refused read throws: a key revoked or a
   project gone is the outage this exists to name, never a pass. `fetchImpl`
   is an argument so the test drives it without a network. */
export async function lastRun(url, key, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/rest/v1/sync_health?select=last_ok&id=eq.poller`,
    { headers: { apikey: key } });
  if (!res.ok) {
    throw new Error(`sync_health: HTTP ${res.status} ${await res.text()}`.slice(0, 300));
  }
  const [row] = await res.json();
  if (!row) throw new Error('sync_health holds no poller row');
  return row.last_ok;
}

// What to say, or null when the poller is running.
export function stale(lastOk, now = Date.now()) {
  const at = Date.parse(lastOk ?? '');
  if (!Number.isFinite(at)) return 'the poller has never completed a run';
  const hours = (now - at) / 3600_000;
  return hours > STALE_HOURS
    ? `the poller last completed a run ${hours.toFixed(1)}h ago, at ${lastOk} — past ` +
      `${STALE_HOURS}h, so pg_cron, the function or the project has stopped`
    : null;
}

// Only when run directly, so the test can import the functions above.
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SB_SECRET_KEY;
  if (!url || !key) {
    console.error('health: SUPABASE_URL and SB_SECRET_KEY must both be set');
    process.exit(1);
  }
  const lastOk = await lastRun(url, key);
  const said = stale(lastOk);
  if (said) {
    console.error(`health: ${said}`);
    process.exit(1);
  }
  console.error(`health: the poller last completed a run at ${lastOk}`);
}
