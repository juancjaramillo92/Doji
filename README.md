# Doji

A single-file XAUUSD trading journal. It records what you did on a trade and
whether you followed your own rules doing it, pulls the execution data from your
broker automatically, and works from any device you sign in on.

The premise is that the chart explains less about a trading result than the
process behind it. So every trade carries two halves: the technical one, which
the broker supplies, and the discipline record, which only you can.

---

## Running it

Open `index.html`. That is the whole application — no build step, no bundler, no
dependencies to install.

Three libraries load from a CDN. Chart.js and the Supabase client are blocking
scripts in the page; SheetJS is fetched on the first export, because it is the
largest of the three and is needed only there.

You need a connection to sign in and to save. Without one the journal still
opens and draws from a cached copy of the last successful read; saving is
refused until the connection returns. The sync dot goes amber to say so.

Added to an iOS home screen it runs standalone, with the icon from
`apple-touch-icon` and the label from `<title>`. iOS reads both once, when the
shortcut is created, so changing the icon means deleting it from the home screen
and adding it back.

There is a brief grey frame on launch, between iOS handing over and the first
paint. It belongs to the web view starting up, not to this file: a web app
manifest with a `background_color`, a dark `color-scheme` and an
`apple-touch-startup-image` were each tried and none of them reach it. The
manifest was removed afterwards — every other field in it either matched an iOS
default or duplicated something already in the head. Left alone deliberately.

---

## Layout

```
index.html                              the entire application
icon-512.png                            home-screen icon
vercel.json                             no-cache header for index.html
supabase/001_trades.sql                 the schema
supabase/functions/doji-mcp-sync/       Edge Function: cTrader poller
doji_gmail_sync.gs                      Apps Script: broker email parser
test/                                   node:test suites — see Tests
```

---

## The system

```
        ┌────────────────┐          ┌──────────────────┐
        │  cTrader MCP   │          │  cTrader email   │
        │   get_deals    │          │  TP / SL alerts  │
        └───────┬────────┘          └────────┬─────────┘
                │ every 2 min                │ on arrival
                │ (Edge Function)            │ (Apps Script)
                │                            │
                │   broker-owned columns     │  net_pnl · balance
                │                            │  fill_time · direction
                ▼                            ▼
        ┌──────────────────────────────────────────────┐
        │                   trades                     │
        │            one row per position              │
        └──────────────────┬───────────────────────────┘
                           │ read · realtime · update
                           ▼
                    ┌──────────────┐
                    │     Doji     │
                    └──────────────┘
```

Three writers, one table, and no arbitration between them — because none of them
writes another's columns. That is the single idea the whole design rests on.

---

## Data model

One table. A trade is one row.

### Broker-owned

Written by the poller and the email parser. **The app never writes these.**

| Column | Meaning |
|---|---|
| `id` | the position id verbatim, `PID562780708` |
| `user_id` | owner; defaults to `auth.uid()` — the poller supplies it explicitly, since that default is null under the service role |
| `direction` | `BUY` / `SELL` — the **position** side |
| `entry_time` | true execution instant of the opening deal |
| `fill_time` | closing instant, email only — the `open_day` fallback |
| `entry_price`, `exit_price` | volume-weighted where the fill was scaled |
| `open_day` | the New York civil day the trade is filed under |
| `commission` | dollars, positive magnitude, **never subtracted** |
| `balance` | account balance after the fill (email only) |
| `net_pnl` | broker's figure — includes swap |
| `computed_pnl` | derived from the deals — no swap |
| `pnl` | **generated**: `coalesce(net_pnl, computed_pnl)` |

`pnl` is a generated column so the email-beats-computed rule is stated once, in
the schema, rather than reimplemented in every client that reads a P&L.

`commission` is recorded and never displayed. The P&L this app stores is already
net of it — `net_pnl` includes costs and swap, `computed_pnl` is derived from
deals that carry them — so subtracting it would double-count. It is captured
because the value exists only at sync time, so a panel that wants it later can
have history rather than starting from the day it was added.

### Journal-owned

Written by the app alone. The poller never sends these keys.

| Column | Meaning |
|---|---|
| `setup` | `Break & Retest` or `Support & Resistance` |
| `followed_rules` | did you follow your process |
| `followed_sl` | did you **respect** your stop |
| `followed_tp` | did you **respect** your target |

The three discipline answers are booleans: `null` is unanswered, which is a
third state and not the same as `no`. Every broker fill arrives with all three
null, so a blank must never count as a miss — otherwise an entry you never got
round to would permanently depress every compliance rate it touches.

Note the polarity. The journal asks whether the stop and the target were
**respected**, not whether they were moved.

### Bookkeeping

`deleted` is a soft delete and has to be. The poller re-upserts every position
inside its window, so a hard delete would be undone within two minutes. The
poller never sends the column, so the flag survives every later write. That one
boolean is the entire resurrection guard.

`updated_at` is maintained by a trigger, not by call sites that each have to
remember. Read it as "when the poller last touched this row", not "when this row
last changed" — the poller re-upserts every position in its window on every run,
and Postgres does not skip no-op updates. Nothing reads the column today; the
distinction matters the first time anything does.

---

## What is derived, not stored

Four things every surface needs, each computed by one function, because storing
them is what lets them drift from the values they come from.

**`result`** — win / loss / break-even, from `pnl`. A P&L within **±$3** of zero
is a scratch: it changes the label only, and the dollars still flow into every
money figure, which is what keeps gross profit − gross loss equal to net.
Break-evens sit in the win-rate **denominator**, so scratches drag it down
rather than vanishing. `null` when there is no P&L yet — a trade can be
journalled before it closes, and a missing figure is not a break-even.

**The filing day** — `open_day` when the poller supplied one, otherwise the New
York civil day of the closing fill.

**`session`** — derived from `entry_time` against each financial centre's own
local hours, so London's boundary moves with its own daylight saving rather than
New York's. Derived at read time rather than stored, so a fill nobody has opened
yet still shows one, nothing can go stale against the times it came from, and a
fill the poller backfills later corrects itself. There is no override.

**Completeness** — setup and all three discipline answers. P&L is deliberately
not required.

---

## Operating

**Trades appear on their own.** Enter a position and it shows within about two
minutes — correct day, correct session, purple and pending, P&L blank until it
closes. Open it and fill in the setup and the three discipline answers.

**There is no manual entry, and no import.** A hand-made row carries no position
id, so the sync could never match it and it would sit in the log forever as a
duplicate of a real trade waiting to happen. Historical backfill belongs in the
SQL editor, run once, not behind a button that can be pressed twice.

**The journal modal holds only your half.** Direction, P&L, the session and the
filing date are not offered there at all: the poller rewrites them every two
minutes, so a control over any of them could only ever lie. The trade log is
where they are read. The modal is the setup and the three discipline answers,
and nothing else.

**Deletes** stage with a 7-second undo. The row leaves the screen immediately and
`deleted` is set at once; undo clears it again. The window forgives the reflex,
it does not hold the delete back.

**Export** lives in the Export panel — labelled Export, since there is no import
path for it to share: the journal as `.xlsx`, and a full `.json` backup. Both
are produced as Blob URLs, the same mechanism the weekly auto-backup uses. The backup carries **every** row including the soft-deleted ones, and
omits `pnl` because it is a generated column and cannot be written back.

It is a genuine restore point. There is deliberately no restore *button* —
replacing the database from a file is a job for the SQL editor, done knowingly,
rather than one click away from an export. The procedure:

```sql
-- 1. paste the file's `trades` array as the argument
-- 2. run it; every column is written except the generated pnl
insert into trades
select * from jsonb_populate_recordset(null::trades, '<<<PASTE ARRAY HERE>>>')
on conflict (id) do update set
  direction = excluded.direction, entry_time = excluded.entry_time,
  fill_time = excluded.fill_time, entry_price = excluded.entry_price,
  exit_price = excluded.exit_price, commission = excluded.commission,
  balance = excluded.balance, open_day = excluded.open_day,
  net_pnl = excluded.net_pnl, computed_pnl = excluded.computed_pnl,
  setup = excluded.setup,
  followed_rules = excluded.followed_rules, followed_sl = excluded.followed_sl,
  followed_tp = excluded.followed_tp, deleted = excluded.deleted;
```

The deleted rows matter: restoring without them lets the poller rebuild every
trade you ever removed.

**The weekly auto-backup** fires after the Friday 17:00 New York close, keyed on
the last completed week so it runs once and never twice. Desktop only — a phone's
Downloads folder is not where a backup belongs, and the marker is per-device so
skipping on a phone does not consume the laptop's turn. A gesture-less download
can be blocked silently with no API to detect it, so the toast asks you to verify
rather than asserting success.

**Signing out** is a double-click on the sync dot.

**If a trade does not appear**, the cron reporting `succeeded` proves nothing —
`net.http_post` is asynchronous, so the SQL succeeded in *queuing* the request.
The function's own answer is here:

```sql
select status_code, content, created
from net._http_response order by created desc limit 10;
```

---

## Broker ingestion

### The MCP poller

A Supabase Edge Function calls cTrader's `get_deals` every two minutes, folds
deals into positions, and upserts one row per position.

**The write window is six hours, not thirty days.** It was 720h, which meant
every run rewrote every position of the last month — around forty rows, ~28,800
pointless row-rewrites a day, each one firing the `updated_at` trigger and
broadcasting a realtime UPDATE that made every open tab reload and re-render.
Six hours still tolerates 180 consecutive missed runs. Backfills pass
`?force=1&hours=168` instead of editing the secret and putting it back.

**The read window is wider than the write window, and has to be.** Deals are
fetched over `write window + MAX_POSITION_HOURS` (72h by default) and folded
from that; a position is upserted only if one of its deals falls inside the
narrow window. Reading at six hours returned a long position's closing deal
without its entry, so `foldPosition` read direction off a close — a short
reported `BUY` — and overwrote `entry_time`, `entry_price` and `open_day` with
the exit's values, which silently moved the trade's session and its calendar
day. Nothing was truncated, so the truncation guard never fired: the entry deal
was simply never requested. Reading wide costs one identical MCP call; the
28,800 rewrites were always a write problem. Anything held longer than
`MAX_POSITION_HOURS` still slices, so that constant is a bound on position
lifetime rather than a guess at a window.

`get_deals` is a durable execution ledger, not a snapshot of open positions.
That distinction is what makes the design work: a trade that opens and closes
between two polls is still in the ledger waiting, so nothing is missed and a
skipped run self-heals on the next pass.

Four things about the data are easy to get wrong and invisible afterwards:

**Direction must come from the earliest deal.** `get_position_details` reports
`tradeSide` on the position object, but for a *closed* position that object is
hollow — `volume: 0`, `entryPrice: 0` — and its `tradeSide` is the closing side.
A short reports `BUY`. Reading it there mirrors every directional statistic.

**Closes are the deals on the opposite side, not simply the ones after the
first.** A same-side deal is a scale-in. Counting it as a close averages it into
the exit price and can trip a live position into a fabricated "closed" state
with a fabricated P&L.

**Position IDs must be normalised.** The email writes `PID562780708`; MCP returns
the integer. Unprefixed, the same position mints two rows.

**Units are hundredths.** `volume: 200` is 2.00 oz; `commission: -7` is −$0.07.
Both are plausible integers that are wrong by 100× if misread. The Edge Function
converts before writing, so `commission` in the database is already dollars.

**Truncation is an error, not a field.** If `get_deals` hits `maxRows` the
function throws. It used to return `truncated: true` in a 200 body, which
`net.http_post` discards — so the one signal that trades were being dropped went
to nobody. It is also worse than losing rows: a truncated window can return a
position's closing deals without its entry, and direction then gets read off a
close and inverted.

The function is whitelisted to a single read tool and contains no code path that
constructs an order. It needs `DOJI_USER_ID` in secrets: `trades.user_id`
defaults to `auth.uid()`, which is null under the service role.

### The email parser

An Apps Script reads cTrader's TP/SL alerts and merges four values the poller
cannot read back from a closed position: `net_pnl` (which includes swap),
`balance`, `fill_time`, and `direction` for a position the poller never reached.

It writes only those columns, so it cannot disturb anything else.

**Parse failures and write failures are different.** A parse failure is
permanent and labels the thread so it leaves the queue. A write failure is
transient — a Supabase blip, an expired session — and leaves the thread
*unlabelled* so the next run retries it. Treating them the same is how a
momentary outage used to discard a fill's P&L forever.

The alerts are also the early warning if the MCP token is ever misused, so leave
the notifications on regardless of whether you read them.

---

## Application structure

`index.html` is organised in labelled sections, in dependency order — nothing
references anything defined below it at load time.

| Module | Responsibility |
|---|---|
| `CONFIG` | frozen domain constants |
| `Dates` | formatting, New York wall clock, sessions, week boundaries |
| `Derive` | result, filing day, session, completeness |
| `Stats` | pure arithmetic over a list of rows |
| `Data` | Supabase: load, save, delete, realtime, offline snapshot |
| `Charts` | Chart.js wrappers and the shared visual primitives |
| `Render` | one function per component |
| `Journal` | the entry modal |
| `IO` | export and backup |
| `Login` | session gate |
| `Carousel` | mobile swipe position and dots |

`render()` is the orchestrator and holds no drawing of its own. Each step runs in
isolation, so one widget can degrade without blanking the panel.

### The shared primitives

Every wheel and every bar is built from one of these. That is what keeps the
panels in visual agreement; a hand-rolled Chart config or a new bar markup is how
a page drifts apart from itself one component at a time.

- `wheelBlock(key, strip, cls)` — the markup for any result wheel
- `paintWheel(key, counts)` — the figures and arcs for one, from a `counts()`
- `mountDonut(canvasId, [w, l, be])` — the wheel itself; updates in place if it already exists
- `pctStrip(pctSplit([w, l, be]))` / `moneyStrip(key)` — the figures under a wheel
- `sessionBars(list)` — win/loss distribution, `.sess-wr-*`
- `disciplineBar(label, followed, n)` — every compliance bar
- `rollRow(label, cur, prev)` — every roll-forward row
- `--bar-h` — bar thickness
- `DONUT_CUTOUT`, `RESULT_FILL`, `RESULT_BORDER` — wheel geometry and palette

The period and setup wheel rows are both `wheelBlock` + `paintWheel`. Each row's
**shell is emitted once** and only its figures are repainted, which is what lets
`mountDonut` update an existing Chart instead of destroying and rebuilding every
one of them on every render.

Typography and colour follow the same rule as the wheels. `font-family:var(--mono)`
is declared in one grouped rule, not in each of the fifty-six components that
use it, and every colour in the sheet is a token — there are no raw `rgba()` or
hex literals outside `:root`.

**Empty-state rule:** a row with no data is a dim placeholder, never a missing
row. These blocks are `flex:1` with `space-between`, so dropping a row makes the
survivors stretch.

### Sync model

Supabase is the data. There is no local write path, so there is no shadow, no
cursor, no tombstone bookkeeping and no conflict rule — a save is one `UPDATE`,
and the next read returns what the database holds.

The snapshot in `localStorage` is a **read cache** and can never be anything
else. It lets the journal open and draw with no connection; it is never written
back. That is what makes offline cost thirty lines rather than eight hundred.

Realtime is the fast path; the refresh is the floor underneath it. Every
websocket dies eventually — a phone backgrounds its tab and the socket is killed
outright — and nothing replays what was missed. So the app also re-reads on
foreground, on reconnect, and on a slow timer. Correctness lives in the refresh.

A refresh while a modal is open is held rather than dropped, and flushed when the
modal closes; replacing the rendered set under half-typed input would pull the
ground out from under it.

---

## Setup from scratch

1. Run `supabase/001_trades.sql` in the SQL editor.
2. Confirm `trades` is in the `supabase_realtime` publication and has RLS enabled.
3. Put the project URL and publishable key in `SUPABASE` in `index.html`.
4. Deploy the Edge Function; set `CTRADER_MCP_TOKEN` and `DOJI_USER_ID` in secrets.
5. Schedule it with pg_cron every 2 minutes.
6. Deploy the Apps Script; put `DOJI_EMAIL` and `DOJI_PASSWORD` in Script
   Properties, never in the file. Trigger `syncPepperstone` every minute.

---

## Tests

```sh
npm install          # once — jsdom, and nothing else
npm test
```

Node 22.6 or newer; `--experimental-strip-types` is what lets the suite import
the Edge Function's `.ts` directly, which is why the script exists rather than a
bare `node --test`. `jsdom` is the only dependency in the repository and it is a
dev dependency — the application itself still installs nothing and still has no
build step.

| File | Covers |
|---|---|
| `test/fold.test.mjs` | `foldPosition`, `nyDay`, the two windows, `secretMatches`, `parseSse`, `marketOpen` |
| `test/app.test.mjs` | completeness, `Data.load` and `Data.save`, both break-even bands, win rate, the money split, filing day, sessions, both `Data` indexes, every render step, the journal form |
| `test/boot.mjs` | the harness: boots `index.html` in jsdom with the CDN libraries stubbed |

**What is not covered, plainly.** The suite asserts on values and on emitted
markup, so it cannot see pixels — a renderer that emits correct HTML with broken
CSS passes. The Supabase client is a recording stand-in, so `load` and `save`
are exercised but realtime and the auth paths are not. `mcpInit`, `mcpCall` and
`upsert` reach the network on their first line and are not exported. The xlsx
export needs SheetJS from a CDN and is not exercised. And the Apps Script has no
coverage at all.

**A check you have not proved can fail is not a check.** Both suites were run
against deliberately broken copies before being trusted: the fold tests against
an inverted entry deal, a double-counted commission, a fold window collapsed to
the write window and a secret comparison that ignores length; the client tests
against a widened break-even band, break-evens dropped from the win-rate
denominator, a stray column in `Data.OWNED`, a session derived from the close,
an inverted filing anchor and a throwing renderer. Every one of those was
caught. Do the same to any check added later — a green run from a scanner that
cannot fail has more than once been mistaken here for clean code.

---

## Known rough edges

**The Apps Script has no coverage and is the hardest of the three to ever get
any.** It needs Gmail and a live session, so it stays read-the-code-carefully
whatever else changes. It is also one of the two pieces that can lose data
quietly — the poller is the other — and the weekly backup is the floor
underneath both.

**The Supabase client carries no SRI hash**, unlike Chart.js and SheetJS. The
floating `@2` tag is gone — it is pinned to `@2.111.0`, which closes the drift
problem, the half of this that actually mattered — but it remains the one script
with access to the auth session and no integrity check. The hash is left off
deliberately: it has to be recomputed on every version bump and a forgotten one
fails closed with no message, which is a poor trade in a single-user setting.
Chart.js and SheetJS carry hashes because they are effectively frozen; this one
moves. To add one anyway, compute it from the npm tarball the CDN mirrors:

```sh
curl -s https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-<ver>.tgz \
  | tar -xzO package/dist/umd/supabase.js \
  | openssl dgst -sha512 -binary | openssl base64 -A
```

**The session seam.** Fills the poller never reached have no `entry_time`, so
their session derives from close time rather than entry time. Flag it whenever
session data is read for a pattern spanning that boundary. A `?force=1` run with
a wide lookback repairs them for good — nothing is stored, so backfilling the
entry time is the whole fix.

**R:R is realised, not planned.** Average win over average loss from closed P&L.
The planned floor is **not recoverable from the data** — the broker reports only
the *final* stop, so a stop moved to break-even has overwritten the original
risk. Never infer what the planned R:R was; ask.

**The pg_cron job holds no database power.** It presents `DOJI_CRON_SECRET`,
read from Vault at call time, and that secret's entire authority is to start a
poll that was going to run anyway. The service-role key lives in the Edge
Function's own secrets and never appears in the job. This replaced an earlier
arrangement where the job text carried a legacy service_role JWT — full
RLS-bypassing access, in a job definition, unrotatable.

**Resolved — the old tables are gone.** `records`, `broker_fills` and
`app_state` were dropped; introspection now returns `trades` alone. That was the
last step of the migration.
