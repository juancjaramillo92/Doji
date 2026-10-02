/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — jsdom harness for index.html
   ───────────────────────────────────────────────────────────────────────────
   The app is one file, one flat namespace and no build step, so there is
   nothing to import. This boots the real page instead: the markup is parsed by
   jsdom, the inline script is evaluated inside it, and a probe appended to that
   same script hands the top-level declarations back out.

   The probe has to be appended to the script TEXT rather than evaluated
   separately, because `const` at the top level of a classic script lands in the
   global lexical scope and never on `window` — a second eval could not see it.

   The three CDN tags are never fetched: jsdom loads no external resources by
   default and the inline script is the only one executed. window.supabase and
   window.Chart are stubbed instead, which is also what makes the assertions
   meaningful — a stubbed Chart records what the renderers asked it to draw.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// The names the tests reach for. Kept explicit rather than scraped, so a rename
// in the app fails here loudly instead of leaving a test silently asserting on
// `undefined`.
const EXPOSED = [
  'CONFIG', 'Data', 'Dates', 'IO', 'Journal', 'Login',
  'isComplete', 'resultOf', 'aggregateResult', 'dayOf', 'sessionOf',
  'counts', 'money', 'pctSplit', 'byKey', 'round2',
  'render', 'renderTable', 'renderSetups', 'renderPeriods', 'renderPnLCard', 'rangeStats',
  'journalForm', 'pickYN', 'disciplineBar', 'sessionBars', 'esc', 'Watch',
  // The undo window around a delete. Its rules are all about ORDER — stage
  // finalising the previous one, a second undo being inert — and none of
  // them is reachable through Data alone.
  'PendingDelete'
];

/* THE INLINE SCRIPT, WHICH IS THE WHOLE APP. Exported because types.test.mjs
   compiles this same text: two readers slicing the page by hand is two chances
   for one of them to be reading a different program than the other, and the
   one that drifts would go on passing about a file nobody is running. The
   three `<script src>` tags come before it, so the LAST opening tag is the
   inline one. */
export function appScript() {
  return HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
}

/* `auth` replaces the two session answers, so a boot can be driven down the
   path a real device takes — signed in, signed out, or unable to reach the
   server to ask. `snapshot` is what the device already holds from its last
   confirmed read, written before the script runs as a real device's would be. */
export async function boot({ now, auth = {}, snapshot } = {}) {
  const dom = new JSDOM(HTML, {
    url: 'https://doji.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  /* THE CLOCK IS FROZEN BEFORE THE SCRIPT RUNS, NOT AFTER, and the ordering is
     the whole of it: the app reads the clock at LOAD time as well as at render
     time. `View.heatmap` is set from `Dates.nyMonth()` while the script is
     evaluating, so a clock frozen afterwards would leave the grid opened on
     whatever month the machine happened to be in — and a golden file that moves
     with the calendar is not a golden file, it is a diff nobody can read.

     A subclass rather than a stub, because `Date` is called every other way in
     this app too: `new Date(iso)`, `Date.UTC`, `Date.parse`. Only the no-arg
     constructor and `now()` are answered; everything else is the real thing,
     inherited. */
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
      // Real Chart.js exposes the canvas it was mounted on, and mountDonut
      // reads it: `existing.canvas === canvas` is how a wheel decides between
      // updating in place and being rebuilt. Without it that check was always
      // false, so every render tore down and rebuilt all five wheels — the
      // exact path the app has a comment explaining it avoids, exercised by
      // nothing.
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

  // A recording stand-in for the Supabase client. boot() reaches its "no
  // session" branch and stops, but load and save are real code paths whose
  // failures are silent — a throw inside load() falls through to the snapshot
  // and shows as an empty panel behind a stuck sync dot, which reads as a
  // connection problem rather than a bug. So the table calls are answered here
  // rather than stubbed away.
  const db = { rows: [], error: null, patches: [] };
  win.__db = db;

  // A real PostgrestFilterBuilder is thenable, so a query is awaited wherever
  // the caller stops chaining — with or without an order() on the end. `then`
  // rather than a promise-returning order(): a stub that only resolves on one
  // terminal method silently answers `undefined` the day a query drops it.
  const answer = () => Promise.resolve(
    db.error ? { data: null, error: db.error } : { data: db.rows, error: null });

  /* PER-TABLE ANSWERS, because there are five of her tables now and one shared
     row set would hand `trades` back to a query for the calendar — which reads
     as a card that renders nonsense rather than as a stub that was never told
     about the table. `db.tables[name]` when it exists, `db.rows` otherwise, so
     every existing test is untouched. */
  db.tables = {};
  db.read = [];

  const bind = (name) => {
    const rows = () => (name in db.tables ? db.tables[name] : db.rows);
    const reply = () => Promise.resolve(
      db.error ? { data: null, error: db.error } : { data: rows(), error: null });
    const t = {
      select: () => t,
      order:  () => t,
      // The filter methods the app actually chains. Each returns the builder,
      // because a stub that resolves on only one terminal method silently
      // answers `undefined` the day a query drops it.
      eq: () => t, gte: () => t, lte: () => t, is: () => t, limit: () => t,
      then: (ok, no) => reply().then(ok, no),
      update(patch) { db.patches.push(patch); return t; },
      // db.error honoured here as well as in maybeSingle. It was not, so any
      // path ending in .single() — Data.save() and Data.restore() are both —
      // had an unreachable failure branch: the stub answered success however
      // the test was set up, and a test for the error path would have passed
      // while proving the opposite of what it claimed.
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
        // Sign-out is a real path with a real consequence — it is what clears
        // the offline snapshot off the device — so it is answered rather than
        // stubbed away.
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

  // jsdom implements none of these and the app touches all of them: matchMedia
  // at load time (the Carousel's breakpoint), getContext on every wheel, and
  // createObjectURL from the weekly backup, which the boot timer fires on its
  // own schedule whether or not a test asked for it.
  win.matchMedia = q => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  });
  // Chart.js is stubbed, but the app calls clearRect itself on the placeholder
  // ring, so the context needs to be a no-op surface rather than a bare object.
  // `canvas` is the one real property on it: a 2d context carries the element
  // it came from, and both Chart.js and the wheel-reuse check read it back.
  win.HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return new Proxy({}, {
      get: (t, k) => k === 'canvas' ? canvas : (t[k] ??= () => {})
    });
  };
  win.URL.createObjectURL = () => 'blob:doji-test';
  win.URL.revokeObjectURL = () => {};

  /* SheetJS, recorded rather than fetched. loadXLSX() returns immediately when
     window.XLSX is already present, so the export runs its own row-building
     code — the column names, the formatters and the three-state answers — and
     hands the finished rows to json_to_sheet, which is where they are caught.
     Only the four entry points the export actually calls are here: a wider
     stub would be describing SheetJS rather than the app. */
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

  // The app's own boot() is an async IIFE: it awaits Data.init(), finds no
  // session and hands over to the login overlay. Letting it finish before the
  // harness returns is what stops a test closing the window mid-flight and
  // seeing the crash rather than the assertion it came for.
  await new Promise(r => setTimeout(r, 0));

  // boot() also sets a 30-second interval that outlives the test file and keeps
  // the process alive. Closing the window is not optional housekeeping.
  const close = () => win.close();

  return { dom, win, app, seed, charts, sheets, close, db: win.__db, $: id => win.document.getElementById(id) };
}

// A trade in the shape the app actually receives one: broker columns from the
// poller, journal columns null until the trader fills them. No tag arrays —
// their absence is deliberate and is itself asserted.
export function trade(o = {}) {
  return {
    // `in` rather than ?? throughout: null is a meaningful value for most of
    // these columns, and a factory that silently replaced it with its default
    // would make every null-path test assert on the default instead.
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
