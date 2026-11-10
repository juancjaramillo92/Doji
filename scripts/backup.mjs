/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — a copy of everything about him that exists nowhere else
   ───────────────────────────────────────────────────────────────────────────
   His journal answers and her memory exist nowhere else, so they are copied
   with the secret key from outside the browser — RLS denies the publishable
   key her notes and turns, rightly. Each table is read through PostgREST,
   paged to the end, and written as one JSON document.

   `trades` goes whole, soft-deleted rows included: a wide `?force=1` can
   rebuild its broker columns but never his answers, and a restore without the
   deleted rows lets the poller bring back every trade he removed.

   It pages because PostgREST caps a response at its own `max-rows`, and one
   read of `eugenia_turns` looks exactly like a complete archive until the day
   it is restored. The loop stops on a short page, not on a count it was told.

   What is left out is declared beside the test that holds this list, each
   with its reason: `eugenia_runs` the largest of it, the cost meter, and
   nothing about him.

   Run:  SUPABASE_URL=... SB_SECRET_KEY=... node scripts/backup.mjs > backup.json
   ═══════════════════════════════════════════════════════════════════════════ */

/* Each table with its primary key, which orders the paging: Range needs a
   stable order or a row lands on two pages or none. Not always `id` —
   eugenia_channels is keyed by `channel`, and ordering it by `id` is a 400
   that refuses the whole backup; agree.test.mjs reads each key against its
   `create table`. Listed in restore order, so a note's supersedes target is
   always there first. */
export const TABLES = [
  ['trades',           'id'],
  ['eugenia_channels', 'channel'],
  ['eugenia_notes',    'id'],
  ['eugenia_turns',    'id'],
  ['eugenia_thesis',   'id'],
  ['eugenia_portrait', 'id'],
  ['eugenia_craft',    'id'],
  ['eugenia_reads',    'id'],
  ['eugenia_loops',    'id'],
  ['eugenia_calendar', 'id'],
  ['eugenia_feedback', 'id'],
  // Her calls and what the story and the portrait said before: neither can be
  // rebuilt from anything else.
  ['eugenia_calls',    'id'],
  ['eugenia_rewrites', 'id'],
  // What each briefing was handed: the only record of what a past morning
  // looked like to her.
  ['eugenia_inputs',   'id'],
  // What gold did on each print, which the bars it came from no longer reach.
  ['eugenia_reactions', 'release'],
  // The stop history R-19 is judged on; the broker keeps only the final stop.
  ['trade_stops',      ['id', 'seen_at']],
];

const PAGE = 1000;

/* One table, in full. `fetchImpl` is an argument so the test can drive the
   paging without a network — the loop is the part worth holding, since a
   backup that stops after one page is the failure this file exists to avoid. */
export async function readAll(url, key, table, orderBy, fetchImpl = fetch) {
  const rows = [];
  const order = [orderBy].flat().map(c => `${c}.asc`).join(',');
  for (let from = 0; ; from += PAGE) {
    const res = await fetchImpl(`${url}/rest/v1/${table}?select=*&order=${order}`, {
      headers: {
        apikey: key,
        // PostgREST turns a Range into LIMIT and OFFSET, so a row inserted
        // mid-walk into pages already read pushes one row onto two pages, and
        // a row deleted from them would put one on none. Nothing here is ever
        // hard-deleted, so the walk can repeat a row and never lose one.
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
    console.error('backup: SUPABASE_URL and SB_SECRET_KEY must both be set');
    process.exit(1);
  }
  const out = await backup(url, key);
  // With each table's size, since growth is read off this line: nothing is
  // ever pruned, and ninety of these documents are what the artifacts hold.
  const counts = Object.entries(out.tables)
    .map(([t, r]) => `${t}=${r.length} (${Math.round(JSON.stringify(r).length / 1024)} KB)`).join(' ');
  // To stderr, so stdout is the document and nothing else.
  console.error(`backup: ${counts}`);
  process.stdout.write(JSON.stringify(out));
}
