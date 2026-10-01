/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — a copy of everything about him that exists nowhere else
   ───────────────────────────────────────────────────────────────────────────
   The weekly backup in the app carries `trades`, which is the one table that
   could be rebuilt without it: every broker column is in cTrader's history and
   a wide `?force=1` backfill reconstructs it. Her memory is the other way
   round. The notes, the turns, the channel map with a `moved_on` date per rung,
   the thesis, the open loops and the calendar have no source anywhere else, and
   nothing in the app reaches them — 003 denies the publishable key her notes
   and turns deliberately, and it should stay denied.

   So the copy has to be taken with the secret key, which means from outside the
   browser. This is that, and it is the whole mechanism: read each table through
   PostgREST, page until it ends, write one JSON document.

   IT PAGES RATHER THAN TRUSTING ONE READ. PostgREST caps a response at its own
   `max-rows` regardless of what is asked for, so a single request against
   `eugenia_turns` returns a page and looks exactly like a complete archive —
   the failure being a backup that is quietly short, discovered on the day it is
   restored. `Content-Range` is what says whether more is coming, and the loop
   below stops on a short page rather than on a count it was told.

   `eugenia_runs` is deliberately absent: it is the cost meter, it is by far the
   largest table, and every row in it is a fact about a model call rather than
   about him. Losing it costs a graph nobody has drawn.

   Run:  SUPABASE_URL=... SB_SECRET_KEY=... node scripts/backup-memory.mjs > memory.json
   ═══════════════════════════════════════════════════════════════════════════ */

/* Each table with the column it is READ BY, which is its primary key. Paging by
   Range needs a stable order or a row can be served on two pages or on neither,
   and the key is the only column every row here is guaranteed to have and to
   have uniquely.

   IT IS NOT ALWAYS `id`. `eugenia_channels` is keyed by `channel`, because the
   five rungs are the rows and a surrogate key would let a sixth 'macro' exist
   beside the first. Ordering it by `id` is a 400 from PostgREST — the whole
   backup, refused — and nothing in this repository could see that until it ran,
   because a stubbed fetch answers whatever it is asked. `agree.test.mjs` reads
   each key below against that table's own `create table` now.

   Ordered as they are restored: the tables a later row can reference come
   first, so a restore run top to bottom never lands a note whose supersedes
   target is not there yet. */
export const TABLES = [
  ['eugenia_channels', 'channel'],
  ['eugenia_notes',    'id'],
  ['eugenia_turns',    'id'],
  ['eugenia_thesis',   'id'],
  ['eugenia_loops',    'id'],
  ['eugenia_calendar', 'id'],
  ['eugenia_feedback', 'id'],
  // Every stop and target a position carried. The broker reports only the final
  // stop once a position closes, so the moves R-19 is judged on are kept here
  // and nowhere else.
  ['trade_stops',      ['id', 'seen_at']],
];

const PAGE = 1000;

/* One table, in full. `fetchImpl` is an argument so the test can drive the
   paging without a network — the loop is the part worth holding, since a
   backup that stops after one page is the failure this file exists to avoid. */
export async function readAll(url, key, table, orderBy, fetchImpl = fetch) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const order = [orderBy].flat().map(c => `${c}.asc`).join(',');
    const res = await fetchImpl(`${url}/rest/v1/${table}?select=*&order=${order}`, {
      headers: {
        apikey: key,
        // Range rather than limit/offset: PostgREST answers it with a
        // Content-Range that says how much there is, and an offset walk over a
        // table being written to can skip a row where a range does not.
        Range: `${from}-${from + PAGE - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) {
      throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`.slice(0, 300));
    }
    const page = await res.json();
    rows.push(...page);
    // A short page is the end. Trusting the total in Content-Range instead
    // would believe a header over the rows actually in hand.
    if (page.length < PAGE) return rows;
  }
}

export async function backup(url, key, fetchImpl = fetch) {
  const out = { taken_at: new Date().toISOString(), tables: {} };
  for (const [table, orderBy] of TABLES) {
    out.tables[table] = await readAll(url, key, table, orderBy, fetchImpl);
  }
  return out;
}

// Only when run directly, so the test can import the functions above without
// needing the secrets or making a request.
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SB_SECRET_KEY;
  if (!url || !key) {
    console.error('backup-memory: SUPABASE_URL and SB_SECRET_KEY must both be set');
    process.exit(1);
  }
  const out = await backup(url, key);
  const counts = Object.entries(out.tables).map(([t, r]) => `${t}=${r.length}`).join(' ');
  // To stderr, so stdout is the document and nothing else.
  console.error(`backup-memory: ${counts}`);
  process.stdout.write(JSON.stringify(out));
}
