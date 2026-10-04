/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — jsdom harness for index.html
   ───────────────────────────────────────────────────────────────────────────
   One file, one flat namespace, no build step — so the real page is booted:
   jsdom parses the markup, the inline script runs inside it, and a probe
   appended to that same script hands the top-level declarations back out.
   Appended to the TEXT, because a top-level `const` lands in the global lexical
   scope, never on `window`, and a second eval could not see it.

   The CDN tags are never fetched. window.supabase and window.Chart are stubbed,
   and the stubbed Chart records what the renderers asked it to draw.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Explicit rather than scraped, so a rename in the app fails here loudly
// instead of a test asserting on `undefined`.
const EXPOSED = [
  'CONFIG', 'Data', 'Dates', 'IO', 'Journal', 'Login',
  'isComplete', 'resultOf', 'aggregateResult', 'dayOf', 'sessionOf',
  'counts', 'money', 'averages', 'pctSplit', 'byKey', 'round2', 'prevWeek', 'shiftMonth',
  'render', 'renderTable', 'renderSetups', 'renderPeriods', 'renderPnLCard', 'rangeStats',
  'journalForm', 'pickYN', 'disciplineBar', 'sessionBars', 'esc', 'Watch',
  // The undo window around a delete: its rules are about ORDER, and none is
  // reachable through Data alone.
  'PendingDelete'
];

/* The inline script, which is the whole app — the last opening tag, the three
   `<script src>` tags coming first. Exported so types.test.mjs compiles the
   same text this boots. */
export function appScript() {
  return HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
}

/* `auth` replaces the two session answers — signed in, signed out, or unable
   to reach the server. `snapshot` is what the device already holds, written
   before the script runs. */
export async function boot({ now, auth = {}, snapshot } = {}) {
  const dom = new JSDOM(HTML, {
    url: 'https://doji.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  /* The clock is frozen BEFORE the script runs: `View.heatmap` is set from
     `Dates.nyMonth()` at load, so a later freeze opens the grid on the machine's
     month and the golden file moves with the calendar.
  
     A subclass rather than a stub: only the no-arg constructor and `now()` are
     answered, and `new Date(iso)`, `Date.UTC` and `Date.parse` are inherited. */
  if (now != null) {
    const Real = win.Date;
    const fixed = typeof now === 'number' ? now : Real.parse(now);
    if (!Number.isFinite(fixed)) throw new Error(`harness: cannot read now=${now}`);
    class Frozen extends Real {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    }
    win.Date = Frozen;
  }

  // Chart.js is optional by design — the app warns and degrades. Stubbing it
  // rather than omitting it keeps the wheel paths under test.
  const charts = [];
  class ChartStub {
    constructor(ctx, cfg) {
      this.ctx = ctx;
      // Real Chart.js exposes its canvas, and mountDonut's `existing.canvas ===
      // canvas` decides between updating and rebuilding a wheel.
      this.canvas = ctx?.canvas;
      this.config = cfg;
      this.data = cfg.data;
      charts.push(this);
    }
    update() { this.updated = (this.updated || 0) + 1; }
    destroy() { this.destroyed = true; }
  }
  win.Chart = ChartStub;
  win.__charts = charts;

  // A recording stand-in for the Supabase client. Load and save are real paths
  // whose failures are silent — a throw in load() falls back to the snapshot and
  // looks like a connection problem — so table calls are answered, not stubbed
  // away.
  const db = { rows: [], error: null, patches: [] };
  win.__db = db;

  // A real query builder is thenable, so it is awaited wherever the caller stops
  // chaining; a stub resolving on one terminal method answers `undefined` the day
  // a query drops it.
  const answer = () => Promise.resolve(
    db.error ? { data: null, error: db.error } : { data: db.rows, error: null });

  /* Per-table answers, so a query for the calendar is never handed `trades`.
     `db.tables[name]` where set, `db.rows` otherwise. */
  db.tables = {};
  db.read = [];

  const bind = (name) => {
    const rows = () => (name in db.tables ? db.tables[name] : db.rows);
    const reply = () => Promise.resolve(
      db.error ? { data: null, error: db.error } : { data: rows(), error: null });
    const t = {
      select: () => t,
      order:  () => t,
      // The filter methods the app chains, each returning the builder.
      eq: () => t, gte: () => t, lte: () => t, is: () => t, limit: () => t,
      then: (ok, no) => reply().then(ok, no),
      update(patch) { db.patches.push(patch); return t; },
      // db.error honoured here too, or the failure branch of every .single() path —
      // save and restore — is unreachable and its test proves the opposite.
      single: () => Promise.resolve(
        db.error ? { data: null, error: db.error } : { data: rows()[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve(
        db.error ? { data: null, error: db.error } : { data: rows()[0] ?? null, error: null }),
    };
    return t;
  };

  const table = bind('trades');

  win.supabase = {
    createClient: () => ({
      auth: {
        getSession: auth.getSession ?? (async () => ({ data: { session: null } })),
        // Sign-out clears the offline snapshot, so it is a real path.
        signOut: async () => ({ error: null }),
        getUser: auth.getUser ?? (async () => ({ data: { user: { id: 'u' } }, error: null })),
        signInWithPassword: auth.signInWithPassword ?? (async () => ({ error: null })),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      from: (name) => { db.read.push(name); return name === 'trades' ? table : bind(name); },
      removeChannel: () => {}
    })
  };

  // jsdom has none of these and the app touches all three: matchMedia at load,
  // getContext on every wheel, createObjectURL from the export.
  win.matchMedia = q => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  });
  // The app clears the placeholder ring itself, so the context is a no-op
  // surface; `canvas` is the one real property, read back by the wheel-reuse
  // check.
  win.HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return new Proxy({}, {
      get: (t, k) => k === 'canvas' ? canvas : (t[k] ??= () => {})
    });
  };
  win.URL.createObjectURL = () => 'blob:doji-test';
  win.URL.revokeObjectURL = () => {};

  /* SheetJS, recorded rather than fetched: with window.XLSX present, loadXLSX()
     returns at once, the export builds its own rows, and json_to_sheet catches
     them. Only the four entry points the export calls. */
  const sheets = [];
  win.XLSX = {
    utils: {
      json_to_sheet: (rows) => { const ws = { rows }; sheets.push(ws); return ws; },
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; }
    },
    write: () => new Uint8Array([0])
  };

  if (snapshot) win.localStorage.setItem('doji_snapshot_v1', JSON.stringify(snapshot));

  win.eval(appScript() + `\nwindow.__app = { ${EXPOSED.join(', ')} };`);

  const app = win.__app;
  for (const name of EXPOSED) {
    if (app[name] === undefined) throw new Error(`harness: ${name} is not defined in index.html`);
  }

  // Seeds Data as though a fetch had just landed: rows in, indexes built, no
  // network involved. Every render test starts here.
  const seed = (rows) => {
    app.Data.rows = rows;
    app.Data.all = rows;
    app.Data.index();
    return rows;
  };

  // Let the app's async boot finish before returning, so a test never closes
  // the window mid-flight.
  await new Promise(r => setTimeout(r, 0));

  // boot() also sets a 30-second interval that outlives the test file and keeps
  // the process alive. Closing the window is not optional housekeeping.
  const close = () => win.close();

  return { dom, win, app, seed, charts, sheets, close, db: win.__db, $: id => win.document.getElementById(id) };
}

// A trade as the app receives one: broker columns filled, journal columns
// null. No tag arrays — their absence is asserted.
export function trade(o = {}) {
  return {
    // `in` rather than ??: null is meaningful for most of these columns, and a
    // factory replacing it would make every null-path test assert on the default.
    id: 'id' in o ? o.id : 'PID1',
    user_id: 'u',
    direction: 'direction' in o ? o.direction : 'BUY',
    entry_time: 'entry_time' in o ? o.entry_time : '2026-07-30T14:00:00.000Z',
    fill_time: 'fill_time' in o ? o.fill_time : '2026-07-30T14:29:00.000Z',
    entry_price: 'entry_price' in o ? o.entry_price : 3400,
    exit_price: 'exit_price' in o ? o.exit_price : 3410,
    commission: 'commission' in o ? o.commission : 0.14,
    size_oz: 'size_oz' in o ? o.size_oz : null,
    balance: 'balance' in o ? o.balance : 10000,
    open_day: 'open_day' in o ? o.open_day : '2026-07-30',
    net_pnl: 'net_pnl' in o ? o.net_pnl : null,
    computed_pnl: 'computed_pnl' in o ? o.computed_pnl : null,
    pnl: 'pnl' in o ? o.pnl : null,              // the generated column, as read
    setup: 'setup' in o ? o.setup : null,
    followed_rules: 'followed_rules' in o ? o.followed_rules : null,
    followed_sl: 'followed_sl' in o ? o.followed_sl : null,
    followed_tp: 'followed_tp' in o ? o.followed_tp : null,
    deleted: 'deleted' in o ? o.deleted : false,
    created_at: '2026-07-30T14:30:00.000Z',
    updated_at: '2026-07-30T14:30:00.000Z'
  };
}

// A trade with every journal answer filled in — the completed state.
export const journalled = (o = {}) => trade({
  setup: 'Break & Retest', followed_rules: true, followed_sl: true, followed_tp: true, ...o
});
