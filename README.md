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

Two libraries load from jsDelivr, each pinned to an exact version, as blocking
scripts: Chart.js and the Supabase client. Chart.js carries an SRI hash; the
Supabase client does not, for the reason given beside its tag. Two typefaces come from Google Fonts —
Hanken Grotesk for the interface, JetBrains Mono for every figure — and `--ui`
and `--mono` both carry a system fallback, so a network that blocks the fonts
costs the typeface and nothing else.

Signing in and saving need a connection. Without one the journal still opens and
draws from a cached copy of the last successful read, saving is refused, and the
sync dot goes amber.

Added to an iOS home screen it runs standalone, with the icon from
`apple-touch-icon` and the label from `<title>`. iOS reads both once, when the
shortcut is created, so a new icon means removing the shortcut and adding it
back. The brief grey frame on launch belongs to the web view starting up: a
manifest `background_color`, a dark `color-scheme` and an
`apple-touch-startup-image` were each tried and none reaches it.

---

## Layout

```
README.md                               the contract: what the app does and why
CLAUDE.md                               how to work on it; the README outranks it
REFACTOR.md                             every move refused, and why
index.html                              the entire application
icon-512.png                            home-screen icon
vercel.json                             no-cache header for the app shell
supabase/config.toml                    Edge Function deploy settings
supabase/schema.sql                     the whole database, safe to re-run in full
supabase/upgrade.sql                    by hand, before it: what a re-run cannot change
supabase/verify.sql                     read-only: does the database match it?
supabase/diagnose.sql                   read-only: what the database actually holds
supabase/functions/_shared/edge.ts      the primitives every function needs
supabase/functions/doji-mcp-sync/       Edge Function: cTrader poller
supabase/functions/doji-email-sync/     Edge Function: the email fill's write
supabase/functions/doji-gladys/         Edge Function: Gladys, the journal bot
supabase/functions/doji-eugenia/        Edge Function: Eugenia, the market bot
  doji-eugenia/prompt.ts                who she is, and what she may never say
  doji-eugenia/strategy.ts              what he decided; she cannot write it
  doji-eugenia/journal.ts               the app's arithmetic, ported so she can reach it
  doji-eugenia/adherence.ts             the thirteen rules a journal row can answer
supabase/functions/doji-tradingview/    Edge Function: the TradingView sign-in
doji_gmail_sync.gs                      Apps Script: broker email parser
scripts/backup.mjs                      the paged read behind the daily copy
scripts/health.mjs                      whether anything is running, asked from outside
test/                                   node:test suites — see Tests
.github/workflows/test.yml              runs the suite on every push
.github/workflows/deploy-functions.yml  deploys the Edge Functions on push to main
.github/workflows/backup.yml            the daily copy of the nine tables nothing else holds
.github/workflows/health.yml            the hourly outside check; a failed run is the alarm
.github/dependabot.yml                  monthly update PRs, both ecosystems
package.json                            two dev dependencies and the test script
package-lock.json                       committed — see Tests
.npmrc                                  engine-strict: the Node floor made a gate
.gitignore                              node_modules, and nothing else
```

---

## The system

Two halves that share one table and never write the same column. The journal is
four writers on `trades`; Eugenia reads it through a view and owns nothing in
it.

```
        ┌────────────────┐          ┌──────────────────┐
        │  cTrader MCP   │          │  cTrader email   │
        │ deals·balance  │          │  TP / SL alerts  │
        │ the open plan  │          │                  │
        └───────┬────────┘          └────────┬─────────┘
                │ every 2 min                │ on arrival
                │ doji-mcp-sync              │ Apps Script →
                │                            │ doji-email-sync
                │   broker-owned columns     │  net_pnl · balance
                │   balance where null       │  fill_time · direction
                ▼                            ▼
        ┌──────────────────────────────────────────────┐
        │                   trades                     │
        │            one row per position              │
        └────┬───────────────────────┬─────────────────┘
             │ after insert          │ read · realtime · update
             │ (entry_time < 1h)     ▼
             │                       ┌──────────────┐
             │                       │     Doji     │
             ▼                       │  index.html  │
      ┌──────────────┐               └──────────────┘
      │    Gladys    │   a tap writes setup and the three
      │ doji-gladys  │   discipline answers back to trades
      │ one message  │
      │  per trade   │
      └──────────────┘
```

**The other half has no write path into any of it.** Eugenia reads the journal
through `eugenia_trades`, a view granted `select` alone, and writes only tables
of her own. She is woken by a schedule in pg_cron, a message he sent, or a
trigger on `trades` firing when a position opens or closes — never by a clock
she keeps herself.

```
   WHAT WAKES HER                        WHAT SHE IS HANDED OR READS
 ┌─────────────────────────┐        ┌────────────────────────────────────┐
 │ pg_cron   hourly        │        │ eugenia_trades   select only       │
 │           calendar ×4/h │        │ her own tables   8, 7 backed up    │
 │                         │        │ strategy.ts      no write path     │
 │ Telegram  he writes     │        │ the web          search and fetch  │
 │ trades    opened/closed │        │ the broker's price, via the poller │
 │                         │        │ calendar, market   via TradingView │
 └────────────┬────────────┘        └─────────────────┬──────────────────┘
              └───────────────┬───────────────────────┘
                              ▼
              ┌──────────────────────────────────┐
              │             Eugenia              │
              │           doji-eugenia           │
              │  briefing · reply · trade event  │
              │  nightly pass                    │
              └────────────────┬─────────────────┘
                               │ every composed message is read once
                               │ more — CRITIC for the briefing, TRIM
                               │ for the rest — and only then sent
                               ▼
                      ┌──────────────────┐
                      │     Telegram     │  a voice note, with the
                      │                  │  text as the fallback
                      └──────────────────┘
```

Journal columns and broker columns never meet, so between the two halves there
is nothing to arbitrate — the single idea the whole design rests on. Gladys
writes on the journal side and reaches the same four columns through the same
list as the app. Every writer but the app is an Edge Function deployed from
`main`; the email path posts its fill to `doji-email-sync` rather than holding
any account credential (see **The email parser**).

**A few columns are written by two sources, or by one source more than once,
and each is arbitrated by a filter or by construction — never by a rule someone
has to remember.**

- `balance` — the poller writes it only `where balance is null`, evaluated by
  Postgres inside the UPDATE, so an email landing mid-run cannot lose a race.
  The email's figure is the balance the broker printed on the fill and always
  wins; the poller fills the gap the email leaves on a manual close.
- `planned_sl`, `planned_tp` — the poller's, each written once under its own
  `is null` filter, so later stop moves never overwrite the plan.
- `fill_time` — the email's; the poller stamps a close the email never covered,
  under `where fill_time is null`.
- `direction` — last write wins, and that is safe only because **both sources
  read the side off the OPENING deal**. If either ever read it off a close, the
  column would disagree with itself depending on the trade's age.

Nothing else is shared. `id` is the join, not a value.

She would be the fifth writer and is deliberately not one: a document that
decides whether he followed his rules cannot be edited by the thing checking
them. The guarantee is structural — one database read of the journal, no write
path to it anywhere in her file.

**Three monitors watch the parts that fail silently**, each placed where the
thing it watches cannot take it down. `sync_health` is marked by the two writers
with no voice; `dispatch` records what pg_net sent and what came back, and posts
to Telegram itself; `pace` speaks before a briefing runs out of wall clock,
because afterwards nothing can. `diagnose.sql` reads all three in one grid. See
**Deployment**.

**A fifth function holds the TradingView sign-in** and writes nowhere but its
own row. It is how the calendar and the market around gold reach her, through a
credential she never holds. See **TradingView**.

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
| `fill_time` | closing instant — the email's, or the poller's for a close no alert covered; the `open_day` fallback |
| `entry_price`, `exit_price` | volume-weighted where the fill was scaled |
| `size_oz` | position size in **ounces**, as opened — poller only |
| `planned_sl`, `planned_tp` | the stop and target as **first seen** on the open position — poller only |
| `best_price` | the best price the position reached while open, off the broker's minute bars — poller only |
| `open_day` | the New York civil day the trade is filed under |
| `commission` | dollars, positive magnitude, **never subtracted** |
| `balance` | account balance after the fill — from the email, or from the poller on a close under ten minutes old |
| `net_pnl` | broker's figure — includes swap; null for good on a position closed by hand, since cTrader sends no alert for one |
| `computed_pnl` | derived from the deals — no swap |
| `pnl` | **generated**: `coalesce(net_pnl, computed_pnl)` |

`pnl` is generated so the email-beats-computed rule is stated once, in the
schema, rather than in every client that reads a P&L.

**`balance` and the account are different numbers, and the card shows both.**
`balance` is the cash at the broker. The account is the base the sizing ladder
was applied to, including whatever is held off the broker, and Doji never sees it
directly — but the ladder is 0.02 lots per 1,000, continuous, so a size is a
readout of it:

    lots     = size_oz / 100
    account  = size_oz * 500

The caption under Balance at broker reads `0.04 lots — sizing for 2000`, and
*sizing for* is the point: it is what the ladder implies, not a figure anyone
reported. It uses the **latest** size, because rungs are stepped and a mean
describes no account that existed. An implied account well above the balance is
the reserve off-broker, and it is the only thing that would show a size drifting
off the ladder. With no balance at all, the notice explaining the dash takes the
caption.

`size_oz` is in ounces because both broker sources state ounces: cTrader sends a
volume the poller divides by a hundred, and the alert prints `Volume  Oz 4.00`.
It is the size **opened**, the quantity `computed_pnl` is calculated over. **The
email does not write it**: its boundary is five columns on purpose, so the secret
held in Google's infrastructure opens five columns and not the account. A
position the poller never saw carries no size, and a reader must tolerate null.

**`planned_sl` and `planned_tp` are the plan, readable only while the position is
open.** A closed position reports its *final* stop, so a stop moved to break-even
under R-04 has overwritten the original. `get_positions` carries `stopLoss` and
`takeProfit`, and the poller sees almost every position while it is open. Each
side is written once, under its own `where … is null` — the `balance`
arbitration — because every later poll would otherwise file the break-even stop
as the plan. **As first seen, never as set:** up to two minutes separate the
entry from the poll that catches it, which is immaterial to R-04's +$20 trigger.
It looks forward only, so §7's `Evaluable` column is unchanged: almost no row
carries a plan yet.

**`trade_stops` keeps every move the plan columns refuse to.** Where the stop
sat when a print landed is all of R-19, so `stopChanges` writes a row whenever a
position's stop or target differs from its last row — a pulled side as null, both
sides pulled together included — and seven hundred polls of an unmoved stop are
one row. It is a history rather than a column, so it sits outside
`eugenia_trades`, and `check_rules` reads it beside the trades.

**`best_price` is how far the trade ran in his favour, and it reaches
backwards** — the broker's minute bars go back a year, so every trade can carry
one. The highest bid on a buy, the lowest on a sell; R-04 turns on it, since a
loss after the trade had been $20 his way is a stop not moved to break-even.
**Only whole minutes inside the trade are read**: the entry minute holds prices
from before he was in, the exit minute prices from after, so the figure can fall
short of what happened and never exceed it, and a trade under a minute carries
none. The poller fills it newest first, three a poll, under `where best_price is
null`.

`commission` is recorded and never displayed. Both P&L figures already carry
costs, so subtracting it would double-count; it is captured because the value
exists only at sync time.

### Journal-owned

Written by the app and by the Telegram bot. Neither broker writer ever sends
these keys.

| Column | Meaning |
|---|---|
| `setup` | `Break & Retest` or `Support & Resistance` |
| `followed_rules` | did you follow your process |
| `followed_sl` | did you **respect** your stop |
| `followed_tp` | did you **respect** your target |

The three discipline answers are booleans and `null` is unanswered — a third
state, not `no`. Every fill arrives with all three null, so a blank must never
count as a miss. Note the polarity: the journal asks whether the stop and target
were **respected**, not whether they were moved.

### Bookkeeping

`deleted` is a soft delete and has to be: the poller re-upserts every position in
its window, so a hard delete would be undone within two minutes. The poller never
sends the column, so the flag survives every later write.

`created_at` is when the row was first written — when a writer first saw the
position, not when it opened (`entry_time` is that). Nothing reads it; it is the
audit floor under a table four writers share.

`updated_at` is maintained by a trigger. Read it as "when the poller last touched
this row": the poller re-upserts its window every run and Postgres does not skip
no-op updates. Nothing reads it today.

`tg_message_id` is the Telegram message Gladys posted for the trade, and it is
hers alone — in neither `Data.OWNED` nor her `COLUMNS`, so nothing can name it
from a save or a tap. It lets a journal answer written **anywhere** reach the
message she sent; `null` means there is nothing to edit.

---

## What is derived, not stored

Four things every surface needs, each computed by one function, because storing
them is what lets them drift.

**`result`** — win / loss / break-even. A scratch is measured in **price**: an
exit within **±$3 of the entry price** went nowhere, whatever size was on. A P&L
band cannot say that — $3 of P&L is $3 of gold at 0.01 lots and three cents at
1.00. Win and loss come from the **sign of the P&L**. A P&L of **exactly zero**
is a break-even too: a trade can move sixty dollars and come back to nothing once
commission is in, and zero needs no scaling. It is a point, not a second band.

The label changes and the dollars do not: a scratch's money still flows into
every figure, which keeps gross profit − gross loss equal to net, and
break-evens sit in the win-rate **denominator**. `null` when there is no P&L yet.
Pre-sync rows carry no prices, so their $3 is read against P&L — the only measure
they ever had; an open position, with no exit, is the same case.

**An aggregate result** — a calendar day, a week cell, a month tile —
**inherits rather than re-bands.** Several trades share no entry and exit, so a
cell is a scratch when *every* decided trade in it was one, **or when its total
is exactly zero**, and otherwise takes the sign of its total. A win and a loss
that cancel went nowhere; a day netting a few dollars off two losses is two
losses. The levels agree by construction, so a day of one zero-P&L trade reads
break-even on the calendar and in the log alike.

**The filing day** — `open_day` when the poller supplied one, otherwise the New
York civil day of the closing fill.

**`session`** — derived from `entry_time` against each centre's own local hours,
so London's boundary moves with its own daylight saving. Derived at read time, so
nothing can go stale and a backfilled fill corrects itself. There is no override.

**Completeness** — setup and all three discipline answers. P&L is not required.

---

## Facts that live in more than one file

Four runtimes, five languages and no build step, so some things cannot be
single-sourced at run time:

| The fact | Where its copies live |
|---|---|
| the **setups vocabulary** | `CONFIG.SETUPS`, Gladys's `SETUPS`, `trades_setup_check` |
| the **four journal column names** | `Data.OWNED`, Gladys's `COLUMNS`, the columns, and twice in `trades_telegram_on_answer` — the `is distinct from` list and the `before` object |
| the **five columns the app may WRITE** | the `grant update (…)` in `schema.sql` and both lists in `verify.sql`. Four are `Data.OWNED`; the fifth is `deleted`, which no tap or save names but `remove()` and `undo()` write — a grant built from `Data.OWNED` alone takes soft delete out |
| the **two sides a trade may have** | `trades_direction_check`, the poller's `tradeSide` and its P&L inversion, `emailRow`'s check, the Apps Script's `BUY`/`SELL` mapping, the app's Long/Short label |
| the **two roles a turn may have** | `eugenia_turns_role_check` and every `role:` she writes |
| Eugenia's **note length** | `writeNote`, the check constraint, the tool description |
| Eugenia's **notes window** | `NOTES` in `index.ts`, and the *twenty* and the *fifteen* five short of it that `CONSOLIDATE` spells out |
| the **five channels**, in two vocabularies | ids: `CHANNELS` in `prompt.ts`, the check constraint and the seed in `schema.sql`; spoken names: `CHANNELS` and §2's headings in the strategy |
| the **four rungs of the ladder** | `CHANNEL_STATES` in `prompt.ts`, the check constraint, and `PITCH` |
| Eugenia's **search source vocabulary** | the `source` literals `eugenia_search` returns (`note`, `you`, `him`) and `searchList`'s three branches |
| the **`eugenia_trades` column list** | the view in `schema.sql`, §8's inventory of a row, and `TradeRow` in `adherence.ts` — the only description of what `readDesk`'s `select=*` returns |
| the **kinds an open thread may have** | `LOOP_KINDS` in `index.ts` and the check constraint in `schema.sql` |
| each **job's query flag** | the cron job's URL in `schema.sql` and the branch in `postScheduled` — held in both directions, so a rename and a door with no job both fail |
| the **embedding width** | `EMBED_DIMS` in `index.ts`, the two `vector(n)` columns in `schema.sql`, and the cast inside the search |
| the **journal's own arithmetic** | `index.html`'s `CONFIG.BE`, `resultOf`, `counts`, `money`, `averages` and `Dates.MARKETS`, and `journal.ts`'s port — the band, the session names, the market hours and the SHAPE of the three definitions that part on one case — and both run over the same rows, and every half hour of a year, must answer alike |
| the **hour cycle** | the nine formatters that ask for an hour — three in `index.html`, one each in `_shared/edge.ts`, `adherence.ts`, `journal.ts`, `doji-gladys`, two in `doji-eugenia` — each stating `hourCycle: 'h23'`, since a locale resolving to h24 renders midnight as 24 and breaks `nyParts` and `nyWall` |
| the **17:00 New York roll** | `marketOpen` in `_shared/edge.ts` and `ROLL_HOUR` in `index.ts` |
| the **importance a release may carry** | `IMPORTANCE` in `doji-tradingview`, the check constraint, and the rated reads' `importance=eq.high` |
| the **economies the calendar reads** | `CALENDAR_COUNTRIES` in `doji-tradingview` and the countries `wanted` keeps in `doji-eugenia` |
| the **country his rules count** | `HOME` in `adherence.ts`, the default on `eugenia_calendar.country`, and the watch card's `.eq('country', 'US')` — and every rated read but the Sunday week filters on it |
| the **verdicts a briefing tap may carry** | the keyboard's `callback_data`, `parseFeedback`, the check constraint |
| the **thesis length** | `THESIS_MAX` and the check constraint |
| the **portrait length** | `PORTRAIT_MAX` and the check constraint |
| the **verdicts a read may carry** | `READ_VERDICTS` in `index.ts` and the check constraint |
| the **length of a filed read** | `READ_MAX` and the three check constraints on `eugenia_reads` |
| the **two writers' names** | `sync_health_id_check`, the seed beside it, and each function's `heartbeat("…")` call |
| the **columns of `eugenia_runs`** | the table, the object literals `recordRun` is called with, and the `verify.sql` row on the cache-write columns |
| **which rules a row can answer** | §7's `Evaluable` column and the thirteen predicates in `adherence.ts` |
| the **caller a delivered briefing writes** | the `` `${due} briefing delivered` `` template in `postBriefing`, the `Brief` union, and `pace_line`'s `owed \|\| ' briefing delivered'` |
| the **number of scheduled jobs** | the `cron.schedule` calls in `schema.sql` and the count `verify.sql` asserts |
| the **paid worker wall clock** | `ceiling_ms` in `pace_line` and the sentence in `CLAUDE.md` on why the cron half answers first; its three-quarter share, `speak_at` in `pace_line` and `TURN_MS` in `doji-eugenia`; `WRITER_MS` beneath it |
| each **function's name** | its directory, the triggers, the cron jobs, the Apps Script |
| the **project ref** | every `net.http_post` URL in the SQL, `index.html`, `config.toml`, the deploy workflow and the Apps Script |
| each function's **required secrets** | its `env()` calls and its own boot guard |
| each function's **gateway setting** | `config.toml`'s stanza and the deploy command's flag |

Copies are the cost; copies that can *disagree* are the risk.
`test/agree.test.mjs` reads every copy of each — the app through the jsdom
harness, the function exports directly, the SQL and workflows as text — and fails
when they stop saying the same thing. It also asserts the guarantee rather than
only the lists: no broker column may appear in `Data.OWNED` or `COLUMNS`.

**The database holds that guarantee too.** RLS on `trades` scopes rows to their
owner and says nothing about columns, so `schema.sql` revokes insert,
update and delete and grants back update on exactly five columns —
`Data.OWNED`'s four and `deleted`. The threat it stops is a client already
holding the session token, a narrow one; it is done because the test above made
it cheap. `updated_at` needs no grant: column privileges are checked against the
SET list, and `trades_touch` is a BEFORE trigger assigning `NEW`.
`test/db/schema.test.mjs` runs it: a journal save as `authenticated` succeeds
and moves `updated_at`; a write to `net_pnl`, an insert and a hard delete are
refused; soft delete and undo pass; another owner's row is neither read nor
written.

---

## Operating

**The dashboard, top to bottom** — one `render()` step each, every figure off
the shared definitions in **What is derived, not stored**:

| Panel | What it shows |
|---|---|
| Broker banner | how many trades are not yet journalled — a setup and all three answers — and opens the oldest |
| P&L card | the latest synced balance; all-time net, gross profit and gross loss; this week and this month each beside the one before, in money rather than a percentage |
| Curve | cumulative P&L over every trade carrying a figure, by filing day, coloured by where it ended |
| Periods | This Month, This Week and All Time: the win, loss and break-even wheel with its win rate over decided trades, gross, loss and net, the realised reward-to-risk bar and the discipline bars |
| Calendar | a month of day tiles in their result colour with weekly totals, the month's profit, loss, net and trade count, and the year as a strip of months; a day opens its trades |
| Setups | one wheel per setup, with its split by session beneath |
| Roll-forward | this month beside last: opening, profit, loss, closing, change, best and worst trade, average win and loss, and the synced balances at each end |
| Trade log | ten a page, newest first: filing day and New York time, direction, session, setup and P&L; a row opens its entry |
| Watch card | Eugenia's thesis, open loops and calendar — **What she is watching, on the dashboard** |

**Trades appear on their own.** Enter a position and it shows within about two
minutes — correct day, correct session, purple and pending, P&L blank until it
closes. Open it and fill in the setup and the three discipline answers.

**There is no manual entry, and no import.** A hand-made row carries no position
id, so the sync could never match it. Historical backfill belongs in the SQL
editor, run once, not behind a button that can be pressed twice.

**The journal modal holds only your half.** Direction, P&L, the session and the
filing date are not offered: the poller rewrites them every two minutes, so a
control over any of them could only lie. The trade log is where they are read.

**Deletes** stage with a 7-second undo. The row leaves the screen and `deleted`
is set at once; undo clears it. The window forgives the reflex, it does not hold
the delete back.

**Two backups, for two different losses.** Neither is in the app.

**Supabase snapshots the whole database daily**, and the Pro plan keeps the last
seven, under Database → Backups in the dashboard. A snapshot is every table,
Vault included, and Doji keeps nothing in Storage, so it is everything there is.
It is the repair for a database that is gone or broken: a restore returns the
whole project to that day, and everything written since — trades, answers, her
memory — goes with it. Point-in-time recovery between snapshots is a paid
add-on.

**A copy of what exists nowhere else is taken daily, outside Supabase.**
`scripts/backup.mjs`, run every night by `.github/workflows/backup.yml`, reads
eleven tables into one JSON artifact: `trades`, whose journal columns only
you can supply, and the ten of hers with no other source — the channel map,
notes, turns, thesis, portrait, her record, open loops, calendar, feedback, and
every stop and target a position carried. `trades` goes whole, the soft-deleted rows included: a restore
without them lets the poller rebuild every trade you removed. `eugenia_runs` is
left out: the largest table, and facts about model calls rather than about you.

It needs `SUPABASE_URL` and `SB_SECRET_KEY` as repository secrets and no install
step. **Give it its own named `sb_secret_` key**: both bypass RLS identically,
so this is blast radius — leaked, it is revoked alone while the functions keep
running. **The paging is the load-bearing part.** PostgREST caps a response at
its own `max-rows`, so one read of `eugenia_turns` returns a page that looks
exactly like a complete archive. The walk stops on a short page, not a count it
was told, and the job refuses to upload a document whose `trades` is empty.
It is the repair the snapshots cannot make: ninety days rather than seven, so a
mistake found in the second week can still be undone; one table at a time,
so the journal comes back without rolling back her memory; and in another
company's keeping, if the Supabase account itself is lost. Artifacts expire
after ninety days, so download one occasionally, or run it by hand:

```sh
SUPABASE_URL=... SB_SECRET_KEY=... node scripts/backup.mjs > backup.json
```

**Restoring the journal** is a job for the SQL editor, done knowingly — there is
no restore button:

```sql
-- 1. paste the file's `tables.trades` array as the argument
-- 2. run it; every column is written except the generated pnl
insert into trades (id, user_id, direction, entry_time, fill_time, entry_price,
  exit_price, size_oz, commission, balance, open_day, net_pnl, computed_pnl,
  setup, followed_rules, followed_sl, followed_tp, deleted, created_at,
  updated_at, tg_message_id, planned_sl, planned_tp, best_price)
select id, user_id, direction, entry_time, fill_time, entry_price,
  exit_price, size_oz, commission, balance, open_day, net_pnl, computed_pnl,
  setup, followed_rules, followed_sl, followed_tp, deleted, created_at,
  updated_at, tg_message_id, planned_sl, planned_tp, best_price
from jsonb_populate_recordset(null::trades, '<<<PASTE ARRAY HERE>>>')
on conflict (id) do update set
  direction = excluded.direction, entry_time = excluded.entry_time,
  fill_time = excluded.fill_time, entry_price = excluded.entry_price,
  exit_price = excluded.exit_price, size_oz = excluded.size_oz,
  commission = excluded.commission, balance = excluded.balance,
  open_day = excluded.open_day, net_pnl = excluded.net_pnl,
  computed_pnl = excluded.computed_pnl, setup = excluded.setup,
  followed_rules = excluded.followed_rules, followed_sl = excluded.followed_sl,
  followed_tp = excluded.followed_tp, deleted = excluded.deleted,
  tg_message_id = excluded.tg_message_id, planned_sl = excluded.planned_sl,
  planned_tp = excluded.planned_tp, best_price = excluded.best_price;
```

The columns are named because Postgres refuses any value for a generated
column, a null included, so `select *` would stop at `pnl` before a row landed;
the backup carries `pnl` and the statement ignores it. `agree.test.mjs` reads
all three lists against the schema, so a column added later fails the suite
until the restore names it, and `test/db` runs the statement over a backup's
rows.

**Signing out** is a double-click on the sync dot, and it deletes the snapshot:
a full plaintext copy of the journal in `localStorage`, which left behind puts
the previous session's trades one keypress from the login screen.

**Run `verify.sql` whole and read the `ok` column.** It is one statement because
a SQL editor shows only the **last** statement's result: listings below the
summary would display and discard every check above them. The summary cannot go
last instead, because `cron.job`, `net._http_response` and a never-created table
each raise, and a raise takes every statement after it. So the listings are
`diagnose.sql`, opened when a row says false — a raise there is that file
reporting something absent. A `verify_doji()` function in the database would put
the expectations inside the thing being verified, applied by hand like
everything else, and blind the tests that read the summary's text.

`diagnose.sql`'s **last** listing is the ordinary-day one: the three monitors in
one grid. It adds no definition of broken — `dispatch_failures` decides a failed
dispatch, `pace_line` too slow, and `sync_health`'s judgment is `healthLine`'s.

**If a trade does not appear**, cron reporting `succeeded` proves only that the
request was *queued*. The function's own answer:

```sql
select status_code, content, created
from net._http_response order by created desc limit 10;
```

### When a number looks wrong

Every column has one writer or a filter that arbitrates, so the first question
is *who owns this*, and the second *what does the repair overwrite*. A wrong
direction cannot be fixed in the app, which does not own the column.

| The number | Who owns it | How to see the fault | The repair | What that repair also does |
|---|---|---|---|---|
| direction, entry time or price, exit price, size, commission, `computed_pnl`, filing day | the poller, alone | `?raw=1&hours=N` — what cTrader actually sent | `?force=1&hours=N` if the fold is wrong for a response that is right; a code change if the response itself is shaped differently | rewrites all ten of those columns for **every** position in the window, so any hand-correction inside it goes back |
| `net_pnl` — the settled money figure | the email path, alone | the thread is unlabelled, so the next Apps Script run retries it | re-send the alert, or accept `computed_pnl` through `pnl` | nothing; the poller never writes this column |
| a closed trade with `exit_price is null` | the poller, whose fold lost its entry deal and was held back | that combination *is* the signature, and `sync_health` names the ids while the close is in the window | `?force=1&hours=N` wide enough to reach the entry | as above — the whole window |
| `balance`, `planned_sl`, `planned_tp`, `fill_time`, `best_price` | settled by `where … is null` | compare against the broker | clear the column, then let the next poll fill it | first write wins, so a backfill alone changes nothing |
| setup, the three discipline answers | the trader, through the app or a tap | the log, or `/notes` in her thread | edit it in either place | no broker column moves; the two writers hold the same four names |
| a session that looks misfiled | derived, never stored | `entry_time is null` on the row — the seam | `?force=1` wide enough to backfill the entry | as above; `get_stats` counts these and says so |

**The two writers with no voice leave a heartbeat.** The poller and the email
function have no path to Telegram, so `sync_health` holds one row each:
`last_ok` moves on every completed run, `last_error` records every failure. It
is a heartbeat rather than an alarm because an alarm cannot fire when the run
stops happening at all — an unscheduled job, a renamed function, a dropped
deploy — and `last_ok` going cold sees that too. `healthBlock()` puts it in the
morning briefing and she leads with it. Six hours is set against the two-minute
poll and the 08:00 delivery.

**The writers are judged differently.** The poller is scheduled, so its silence
is evidence; the email function runs only when a fill arrives, so its silence is
a quiet week. Staleness is read for the poller alone; for both, an error stamped
after the latest success means failing now, and a success after it clears. **A
market-closed skip is a completed run and marks itself**, or gold's weekend close
reads as a dead sync every Sunday evening. The table is inert until it exists:
both writers swallow their own heartbeat failure.

**Something outside the database asks too.** Every watcher here is a pg_cron
job, and so is the briefing that reports them, so pg_cron stopping or the
project pausing silences all of them at once. `scripts/health.mjs`, run hourly by
`.github/workflows/health.yml` with the backup's two secrets, reads the poller's
`last_ok` and fails the job when it is older than `STALE_HOURS` — imported from
her file, so the two readers cannot disagree — and GitHub's email about a failed
run is the alarm. Staleness only: a failed poll is hers to report, and one that
keeps failing goes stale. A refused read fails the job too, since a revoked key
or a paused project is the outage it exists to name.

**`dispatch_watch` sees the call that never ran.** Supabase can refuse a
worker with `546 WORKER_RESOURCE_LIMIT` *before* the function exists — nothing
marks, nothing throws, nothing logs — and the only witness is a row in
`net._http_response`, pruned within hours and carrying **no url**. So every
`net.http_post` records its request id in a ledger with the job named, and
`agree.test.mjs` counts calls against ledger rows. `dispatch_watch` runs every
ten minutes **in Postgres** and posts to Telegram directly through `tell_him`,
which reads `eugenia_bot_token` and `telegram_chat_id` from Vault, so it shares
no failure mode with the function it watches. A failed call is defined once, in
`dispatch_bad`: no `2xx` answer, a timeout, or no answer at all.

- **A single lost poll is not reported.** A job that comes round on its own is
  evidence only in quantity — `dispatch_repeats`, three failures in an hour; a
  one-shot job (the hourly job, the trade event, Gladys) is evidence alone.
- **The ledger cannot break the trigger it sits in**: the post goes into a
  variable and the insert sits behind `exception when others then null`, since
  a raise inside the UPDATE would fail the journal write.
- **The judging window has both ends** — fifteen minutes, so a slow call is not
  dead, and three hours, because pruning makes every older row read as no
  answer.
- **Its own report can be lost.** A row is marked with the request id of the
  message that named it (`reported_by`) and settled only on a `2xx`; anything
  else clears the mark and it is said again. A sweep that could not send at all
  settles nothing, so fixing a misspelled Vault name still delivers the outage.
  Past three hours it gives up.

**`pace_watch` speaks before the failure, because afterwards nothing can.**
The cron half answers before it works, so a briefing killed at the 400s wall
clock has already handed pg_net a `200`: the ledger is green, `ask()` never
reaches its catch, no apology is sent, and every retry redoes the same work.
`pace_line` reads `eugenia_runs.ms` and speaks when the longest run of seven
days passes three quarters of the ceiling — 300s. Ordinary mornings have swung
by 77s, so a heavy day cannot reach it and 100s remain when it fires. `ms` is a
lower bound on the wall clock, so reading the largest row costs lateness and
never a false alarm. Seven days so the window holds a Sunday briefing.

Its second half is the **absence**: a briefing owed and not delivered by noon on
a weekday or 21:00 on a Sunday — a full ceiling past the last retry, or it would
name a briefing still being written. **A slow run is said once**: the watcher
passes `pace_line` the time it last spoke. It speaks at most once a New York
day, and **the row it writes is the guard**, so the row goes down only where the
post was made — written after a failed send, it would swallow the warning for
good. A quiet day leaves a `clear` row: both outcomes, always.

---

## Broker ingestion

### The MCP poller

A Supabase Edge Function calls cTrader's `get_deals` every two minutes, folds
deals into positions, and upserts one row per position. `get_deals` is a durable
execution ledger, not a snapshot of open positions, so a trade that opens and
closes between two polls is still there, and a skipped run self-heals on the
next.

**The write window is six hours.** Every upsert fires the `updated_at` trigger
and a realtime UPDATE that makes every open tab re-render, so a month-wide window
rewrote some 28,800 rows a day for nothing. Six hours tolerates 180 missed runs;
backfills pass `?force=1&hours=168`. `LOOKBACK_HOURS` overrides the six.

**The read window is wider, and has to be.** Deals are fetched over `write window
+ MAX_POSITION_HOURS` (72h by default) and folded from that; a position is
upserted only if one of its deals falls inside the narrow window. Read at six
hours, a long position's closing deal arrives without its entry, and the fold
reads direction, entry time, entry price and filing day off the exit — silently.
Anything held longer than `MAX_POSITION_HOURS` still slices, so the constant is a
bound on position lifetime. **A slice is never written**: its fold reads open,
and `sliced` holds back any fold the deals call open that `get_positions` no
longer lists — read after the deals, so a position closing between the two reads
is skipped for one poll rather than written sliced once. Written, it would
overwrite the direction and entry the poll filed while the position was live,
and the email's direction with them. The row keeps its entry and gets no exit,
so the signature of a slice is still **`exit_price is null` on a closed trade**,
and the poll marks `sync_health` with the ids after its own mark, so her briefing
names it while the close is in the write window.

Four things about the data are easy to get wrong and invisible afterwards:

- **Direction comes from the earliest deal.** `get_position_details` reports
  `tradeSide`, but a *closed* position's object is hollow — `volume: 0`,
  `entryPrice: 0` — and its side is the closing one. A short reports `BUY`.
- **Closes are the opposite-side deals**, not simply the ones after the first. A
  same-side deal is a scale-in; counted as a close it fabricates an exit and a
  P&L on a live position.
- **Position ids are normalised.** The email writes `PID562780708`; MCP returns
  the integer. Unprefixed, one position mints two rows.
- **Units are hundredths.** `volume: 200` is 2.00 oz; `commission: -7` is
  −$0.07. Both are converted before writing.

**A cut page is an error, checked before anything is written.** If `get_deals`
returns `maxRows` deals the function throws ahead of the upsert, because a cut
page can carry a position's closes without its entry. The test is our own cap,
not the vendor's `hasMore`, which says more deals exist beyond the window — true
of almost every run — and travels in the answer as `has_more`. Five hundred deals
in a 78-hour window is an order of magnitude past this account, so hitting the
cap means the window is wrong.

**A forced backfill overwrites a hand-corrected row.** The fold rewrites
`direction`, `entry_time`, `entry_price`, `exit_price`, `size_oz`, `commission`,
`computed_pnl` and `open_day` for every position the window reaches. The journal
columns, `net_pnl` and the `is null`-filtered columns survive. Widen `hours` to
the smallest window that covers the row you mean.

**The doors.** Each answers the cron secret, writes nothing, and answers when the
market is shut — a test holds every flag the entry point reads against the market
gate, since one left out replies `market closed` all weekend, which is exactly
when a suspicious row gets looked at.

- **`?raw=1`** returns what the broker sent for the deals, SSE framing and
  double-encoded payload included. A wrong row is either a fold this function
  got wrong or a response cTrader shaped differently, and the repairs are
  opposite — `?force=1` for the first, a code change for the second.
- **`?tools=1`** lists what the broker offers. It is a JSON-RPC **method**, not a
  tool call, so it goes past the allow-list, which guards a tool *name* becoming
  a request.
- **`?positions=1`** returns the open positions as served.
- **`?market=1`** returns the folded price; **`?market=raw`** what the broker
  sent.
- **`?bars=raw`** returns fifteen minutes of `M_1` bars at six ages — now, and
  7, 30, 90, 180 and 365 days back, each moved to a Tuesday–Thursday 14:00 UTC —
  one request at a time, since a single `504` took the batch with it.

```sh
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?raw=1&hours=72" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
```

**Nothing here can place a trade, and that is one array, not the key.** The
endpoint serves `get_spot_prices`, `get_trendbars`, `get_positions`,
`get_symbols`, `get_assets`, `get_pending_orders`, `get_order_history` and
`get_version` — and `create_order`, `close_position`, `amend_position`,
`amend_order` and `cancel_order`, **on the same credential**. `ALLOWED_TOOLS`
names what this function may call, each carrying `readOnlyHint: true` on the
broker's own listing; `DESTRUCTIVE_TOOLS` names the five that do not, so a test
asserts none is reachable through the list or around it, and fails a permitted
name nothing calls, since that is how a destructive one would arrive. A
read-only token would retire the array; none exists.

**The endpoint uses two scales and documents neither.** `get_spot_prices` and
`get_trendbars` serve **pipettes** — `bid: 441982000` is 4419.82.
`get_positions` serves **display prices** on the same account and symbol —
`entryPrice: 4402.71`. The tool descriptions say *"DISPLAY price (not
pipettes)"* about their inputs only. `PIPETTES` is named once and applied to the
spot and bar reads, and both folds are tested against real captures.
`get_trendbars` also documents a `count`-only call it refuses with
`fromTimestamp: must not be null`; the range form is what it accepts.

**A quote names its window.** `sessionClose` is the previous session's close —
the 17:00 New York roll — so the overnight move is one request and a
subtraction. But `high`, `low`, `prev_close` and `change` are all measured from
that roll, so the same `change` is the overnight move before 17:00 and only the
evening's after it, and a bare number reads as *on the day* either way. Nothing
here sees the calendar day — daily bars roll on the same boundary — so
`quoteWindow` names the window rather than computing one. `quoteLine` is the only
place a quote becomes words, with that sentence inside it, for its two callers:
the `get_market` tool and `marketBlock()` (the briefing is handed the price rather
than asked to fetch it — a level off a search page is four digits and looks like
gold).

**Minute bars go back a year.** Every age `?bars=raw` asked answered sixteen bars
in under half a second; a bar carries `timestamp` (the minute it opens), `open`,
`high`, `low`, `close` and `volume`, a range is inclusive at both ends, and it is
in pipettes. That is what `best_price` is built on, and
`test/fixtures/ctrader-get-trendbars.txt` is one such window, unchanged.

**The plan is read off the open position.** A live position carries `stopLoss`
and `takeProfit`, so the poller records both as first seen and every change in
`trade_stops` (see **Data model**).

**Balance comes from `get_balance`, and only for a close just seen.**
`get_deals` carries no balance, and `get_position_details` reports it as zero on
a closed position. `get_balance` answers *now*, which equals *after that fill*
only while nothing has happened between, so `balanceTarget` offers it to the
most recent close alone, and only if it closed inside `BALANCE_MAX_AGE_MS` (10
minutes). Anything older gets nothing — a missing balance is honest — which is
also what makes `?force=1&hours=200` safe for historical balances.

**And a close it sees is stamped.** `fill_time` is written off the same close
instant, under `where fill_time is null`, so the email still owns the column
wherever it lands; that transition is also how Eugenia learns a position closed.
Only rows the fold window reaches are stamped, so the historical gap needs
`?force=1&hours=N`.

It needs `DOJI_USER_ID` in secrets: `trades.user_id` defaults to `auth.uid()`,
which is null under the service role. Two optional secrets override defaults:
`CTRADER_MCP_URL`, the MCP endpoint (cTrader's own), and `SYMBOL_IDS`, the
instruments folded — `41`, XAUUSD — of which the first is the one priced and
read for bars.

### The email parser

An Apps Script reads cTrader's TP/SL alerts, parses the fill, and posts it to
`doji-email-sync`, which merges `net_pnl` (which includes swap), `balance`,
`fill_time`, and `direction` for a position the poller never reached.

**cTrader sends an alert when a stop or target fills, and nothing on a hand
close.** So a closed row with `net_pnl` null is a hand close — R-15's Friday
close-out, or a breach of R-18 — and `check_rules` reads it so. The only other
way to that state is an alert the email path lost, which is why R-18 names the
trade rather than only counting it.

**The write is in an Edge Function so the script holds no password.**
`sb_secret_` keys refuse a browser-like user agent, and Apps Script's is one, so
the alternative is the script signing in *as the trader*. Instead it holds one
secret whose entire authority is five columns of one table. `emailRow` is the
boundary: it builds the payload from five names rather than filtering one, and
type-checks each — an id that is not `PID\d+`, a direction that is not
`BUY`/`SELL`, an unparseable `fill_time`, a non-finite figure is refused, not
coerced. A **missing** figure is dropped rather than sent as null, because
`merge-duplicates` writes exactly the keys present and `direction: null` would
erase a correct one.

**The script refuses a fill it cannot read in full.** `id`, `direction`,
`fill_time` and `net_pnl` are required; if any fails to parse, nothing is sent,
the thread is labelled `doji-parse-failed`, and the repair is to fix the parser
and run `resetDojiLabels()`. `balance` alone may go missing, since the poller
fills it `where balance is null`. Each value is read from **one** label, so a
rename fails loudly rather than an alias matching some other line.

**The fill time is day first.** `19/08/2026` is the 19th of August. A swapped
reading of that date is not a date and fails; the silent case is both numbers
being plausible months, so a test pins `05/08/2026` to the 5th of August.

**`net_pnl` is the one nothing else can supply.** Swap appears in no deal, so a
position carried through the 17:00 rollover is settled correctly only by the
email. `get_position_details` reports a `swap` of zero, but also a zero
commission against deals that charged 7: the object is hollow. The other three
values the poller can reach; a second path into the table costs nothing and
keeps the poller from being a single point of failure.

**Three outcomes, not two.** A body that will not parse, and a `400`, `409` or
`422` from the function — Postgres examined the row and will never take it — are
permanent and label the thread. Anything else, including no response, is
transient and leaves the thread *unlabelled* so the next run retries. A rotated
`SB_SECRET_KEY` answers `401`, and treating that as permanent would discard every
queued fill's P&L for a fault that has nothing to do with the fill.

Leave the alert notifications on: they are also the early warning if the MCP
token is ever misused.

---

## TradingView

**`doji-tradingview` holds the TradingView sign-in, and nothing else here does.**
TradingView adds the half of the market the broker cannot serve: the economic
calendar as data, the dollar and yields gold is priced against, and the
exchange's own volume. Every read of it goes through this function, and each reader was written against what
`?tools=1` and `?probe=` actually returned — the tool names it serves
(`mcp-tv-get-economic-calendar`) are not the ones its documentation gives.

**A function of its own, for the poller's reason and one more.** The same
credential serves eleven tools that change his account — alerts created, updated,
paused, resumed and deleted (`mcp-tv-delete-alert`), watchlists created, renamed,
edited and deleted (`mcp-watchlist-delete-watchlist`). None can trade, but all of
them are his account, so the token stays out of Eugenia as the cTrader token
does. And the sign-in ends in a browser callback carrying no secret, which has no
place in her Telegram webhook.

**Connecting it.** It needs the Essential plan or above (trials carry no MCP
access) and no new secret: it checks `DOJI_CRON_SECRET` and writes with
`SB_SECRET_KEY`.

1. Run `supabase/schema.sql`. It is safe to re-run.
2. Let the deploy workflow ship the function from `main`.
3. Start a sign-in:

   ```
   curl -s -H "x-doji-key: <DOJI_CRON_SECRET>" \
     "https://<project>.supabase.co/functions/v1/doji-tradingview?connect=1"
   ```

   The answer carries `open_this`, the sign-in address, and says how the
   function registered (`registered_by`), the scopes it asked for
   (`scopes_asked`) and those offered (`scopes_supported`) — a read-only scope
   there would make the allow-list a second wall rather than the only one.
   Asking again starts over, and the sign-in it replaces stops working.
4. Open `open_this`, sign in and approve. The browser returns to `/callback`
   with `code` and `state` (or `error`), and the page says whether it connected
   and whether a refresh token was issued — without one, the sign-in ends with
   the first access token.
5. `?tools=1` lists every tool's name, input schema and `readOnlyHint`.

**Without a terminal, the SQL editor makes the same call**, with the secret read
straight out of Vault:

```sql
select net.http_get(
  url := 'https://<project>.supabase.co/functions/v1/doji-tradingview?probe=gold',
  headers := jsonb_build_object('x-doji-key',
    (select decrypted_secret from vault.decrypted_secrets where name = 'doji_cron_secret')),
  timeout_milliseconds := 60000
) as request_id;
```

and a few seconds later:
`select status_code, content from net._http_response where id = <request_id>;`

**What it may read is TradingView's own answer, not a list typed here.** The
`?tools=1` capture is kept whole in `test/fixtures/tradingview-tools-list.json`:
35 tools, 24 marked `readOnlyHint`. `ALLOWED_TOOLS` names six of those 24, and
`agree.test.mjs` holds each against the capture, derives the eleven that write
from the same file, and fails if any is named in the function at all. One of
them reads like a read: `mcp-watchlist-get-active-watchlist` activates or
creates a watchlist when none is active. The technical rating, analyst forecasts
and the screener are read-only and stay off anyway, each being a signal by
another name; fundamentals and filings are about companies.

**`?calendar=1&from=YYYY-MM-DD&to=YYYY-MM-DD` is the calendar reader** — the one
door where a request value reaches a tool, refused rather than clamped: `from`
and `to` are whole days only, at most 31, nothing before 2003-09-01. The
economies are fixed in the function (`CALENDAR_COUNTRIES`): the US, which every
rule that reads a release is about, and the ones Eugenia reads the dollar through
— the euro area, Germany, France, Italy, Britain, Japan and China. Each event
comes back with its permanent `id`, the minute it lands, title, country,
TradingView's own category (`mny`, `prce`, `bnd`, or null where it gives none),
importance (`high`, `medium`, `low` from TradingView's 1, 0, −1), period,
consensus, prior and actual as text with their unit (`200K`, `0.2%`, `$6.748T`),
and `ticker`. No consensus stays null; zero is `0%`.
`timed` is false for what is on the calendar without being a release — a summit
filed at midnight under `Calendar` must not be counted as a print. The event
descriptions are dropped, since she would pay for each on every request.

**`?market=1` is the market around gold, as bars**: the dollar index, the two-
and ten-year yields, the ten-year real yield, silver, US crude, the S&P 500 and
the VIX — and abroad the German, French, Italian, UK and Japanese ten-year
yields and EUR/USD, what the calendar's auctions and central banks are read
against: France and Italy each against Germany is what lenders charge for the
doubt, and the euro is more than half the dollar index. The quote batch refused on every probe with the scanners' 429, while the
OHLCV read answered for every symbol, so each is twenty-five hourly bars folded by
`foldBars` to where the first opened and where the last stands, each with its
time. The real yield is FRED's daily series and is marked `daily`. Symbols, names
and units live in one list, `MARKET`; a symbol that fails is named in `missing`.
`aroundList` states every line as a level beside the level at a stated time and
computes no change, so a move cannot lose its window. A failed read is a sentence
telling her not to quote the dollar or yields from a search.

**`?news=1` is gold's and the dollar's headlines.** `foldHeadlines` merges the
two feeds, a story on both being one headline, newest first with title, source
and time.

**A conversation reads both through `get_around`** — `aroundBlock` and six hours
of headlines. Each feed is read to a fixed count and may not hold six hours, so
where the shorter one stops the block says how far back it reaches; a line from
another day names the day.

**`?rates=1` is what fed funds futures price for the next three Fed meetings**,
worked out the way CME's FedWatch does. A thirty-day contract's price is 100 less
the month's average overnight rate; a meeting month averages the rates before
and after the decision, weighted by days, and a neighbouring clear month pins one
of the two. The month after is preferred, then the month before; where neither
is clear or one has expired, the meeting is solved off the meeting beside it,
since the rate between two decisions is one rate. Contracts are named months
(`CBOT:ZQV2026`), never `ZQ1!`, which the `fedfunds` probe showed rolling early.
For each meeting `foldRates` returns the rate before and after, the move in basis
points, the move since now, and `odds` for the two outcomes either side. An
unsolvable meeting is named in `unread`. The dates are `FOMC`, the Fed's
published decision days; a test fails half a year before the table runs out and
checks every date is a Wednesday, and the last date is never priced. Each read
also asks the calendar for the month's rate decisions, and one the table does not
hold refuses the whole answer.

Checked against FedWatch on 1 October, on its own prices the October odds were
identical (24.9%) and December within a point. `ratesList` states the first
meeting as odds and later ones as basis points priced by then: FedWatch shows a
later meeting as the chance of each range BY THEN, the fold that meeting's own
odds given the one before — both right, different numbers. She quotes rate odds
from here and never from a search, as futures pricing rather than her forecast,
at least fifteen minutes old. It reaches the briefing and `get_around`.

**Where the speculators stand is read straight from the CFTC** — the weekly
Commitments of Traders count for COMEX gold (dataset `72hh-3qpy`, code
`088691`), which needs no credential, so she reads it herself. `positioningList`
gives the managed-money net, its sides, the week's change, the net's range over
52 weeks (crowded means something only against its own past), the open interest
with its change from the week before (a move with it rising is new money, with
it falling one side leaving), and the Tuesday it was taken. Only the Sunday
briefing and `get_around` get it: a weekday briefing would repeat it five times,
and a weekly count cannot cause a quarter-hour move.
Background, in one sentence at most, never a reason to trade.

**`?volume=1` is what COMEX gold futures traded** — the exchange's own volume in
the front-month contract (`COMEX:GC1!`), twenty-two daily bars folded by
`foldSessions` to each session's start and its contracts. It is the market's
volume; the broker's is its own clients, and the prompt tells her never to read
volume off it. `volumeList` decides which sessions have finished — a Globex
session runs 23 hours, 18:00 to 17:00 New York, and is named for the day it
ends — and states the latest beside its average over the twenty before. Every
briefing and `get_around` get it. The front month moves to the next
contract every couple of months, and on that day the count can jump or drop for
no reason in the market, so she says a sharp change may be the switch rather
than reading it. TradingView serves neither daily open interest nor COMEX vault
stocks, and CME's site refuses automated reads, so the weekly CFTC count is the
open interest she has.

**A refusal can arrive marked as success.** The quote batch's 429 came inside a
result marked `isError: false`, with `success: false` in the payload. `unwrap`
checks both and reads `structuredContent` rather than the duplicate text block.
`test/fixtures/tradingview-calendar.json` is eight events from the 1 October
calendar probe, one per shape the fold must handle.
`test/fixtures/tradingview-abroad.json` is every kind of event TradingView listed
for the seven economies abroad from 7 September to 4 November, read on 5 October
— 459 kinds, 862 events, each with its country, rating, category and title — so
what is filed from abroad is judged against the whole catalogue.

**`?probe=` is fixed: nothing in the request reaches a tool.** It picks one of
eight, every argument is written in the function, and each call's failure is its
own answer:

| `?probe=` | what it asks |
|---|---|
| `calendar` | the next three days of US events, and the past week at high importance, to see whether a release that printed carries its actual beside the forecast and the prior |
| `quotes` | whether the quote batch answers for the dollar, the yields at home and abroad, the real yield, silver, oil, the S&P and the VIX with no forex symbol in it (the euro is left out) — it refused twice with the forex scanner's 429, taking the whole batch with it — and each one's last bars from the OHLCV read, which answered where the batch did not, with the bar times saying how fresh each feed is |
| `gold` | the broker's quote through the poller and TradingView's gold feeds read in the same second, plus the last three one-minute bars, which say how stale a TradingView quote is |
| `news` | headlines for gold and the dollar, and what one carries |
| `econ` | which US price and money series exist, the actual releases a calendar entry would be judged against |
| `search` | the names gold's feeds and a real yield go by, for whatever `quotes` could not resolve |
| `fedfunds` | whether thirty-day fed funds futures answer, under the continuous names (`ZQ1!` to `ZQ3!`) and under named contract months, and what a bar of them carries — the price `?rates=1` works the meeting odds out from |
| `futures` | what a daily bar of gold's front month (`COMEX:GC1!`) carries — the bars `?volume=1` folds |

**How the sign-in is found.** OAuth 2.1 as MCP specifies it, discovered rather
than configured: the only TradingView address in the file is the endpoint, whose
401 points at its metadata, which names the authorisation server. The function
prefers a client metadata document — the `client_id` is the URL `/client`
serves — and otherwise registers dynamically; a server offering neither stops
`?connect=1` with what it did advertise. It is a public client, so PKCE with S256
carries the proof, and a server without S256 is refused. `/client` and
`/callback` are the only paths answering without the secret, since neither
caller can hold it; `/callback` acts only on a `state` `?connect=1` stored,
compares it in constant time, and clears it.

**The tokens live in a table**, because a server may rotate the refresh token on
every use and a function cannot rewrite its own Edge secrets. One row in
`tradingview_auth`: RLS on, no policy, revoked from both public roles, and
`verify.sql` asks all three. A refresh that brings no new refresh token keeps the
old one — storing the absence would end the connection at the next expiry. The
table is not in the backup and must not be: a live refresh token in an
artifact is the account.

**One renewal at a time, by a lease.** A rotating server may treat a refresh
token presented twice as stolen and revoke the sign-in, and the briefing and the
calendar's filing can find it stale in the same second. A renewal first takes the
lease `refreshing_until` holds, by a PATCH filtered on it being empty or
lapsed — `balance`'s arbitration. A caller without the lease waits for the token
the holder writes; the holder re-reads the row once it holds the lease, since
another caller may have renewed; the new token and the release are one write; a
dead holder's lease lapses after thirty seconds. Tests drive all three cases
against a stub that filters the way PostgREST does.

**Gold's own price stays with the broker, measured.** Read in the same second,
cTrader's bid was 4162.17 and TradingView's Pepperstone feed 4162.45: the same
broker's price, live, not better. The broker's is the price his stops and fills
happen on.

---

## The two bots

**Gladys** collects the journal. **Eugenia** does macro. Separate bots, tokens
and threads, sharing only a chat id and the cron secret — Gladys writes four
journal columns and reads no market; Eugenia reads the web and writes no trade.
Gladys is deterministic, answers in milliseconds and should never change;
Eugenia calls a model, costs money per message and is tuned constantly. One
function would redeploy the thing that writes to `trades` every time a prompt is
reworded.

What they share is a definition, not a copy: `_shared/edge.ts` holds `env`,
`secretMatches`, `json`, `sbHeaders`, `telegram` and `nyClock`, and each bot
binds its own token in one line, `const tg = (m, b) => telegram(BOT_TOKEN, m, b)`.

---

## Gladys — the Telegram journal

When a position opens he gets one Telegram message and answers the whole journal
from it without opening the app; journalling the trade anywhere else redraws that
message. `schema.sql` holds both triggers and `doji-gladys` is the
function behind them.

**A function is named after who it is, and so are its secrets** — `doji-gladys`,
`GLADYS_BOT_TOKEN`, `GLADYS_WEBHOOK_SECRET`. `TELEGRAM_CHAT_ID` is the exception:
the one value the two bots share, since there is one trader and one chat.

**One function, three callers**, told apart by the secret presented: `x-doji-key`
is the database (a position opened, or its answers moved),
`x-telegram-bot-api-secret-token` is Telegram reporting a tap, and `x-charm-key`
is her charm. They share the keyboard, the message and the `callback_data`
grammar.

**Her charm journals a trade on its own screen.** It sleeps, wakes every few
minutes around the clock to ask what waits, and shows a still near-white dot
while anything does. A `GET` with `x-charm-key: <GLADYS_CHARM_SECRET>` answers
`{ waiting, trade }`: his trades from the last week (`WAITING_DAYS`) with any of
the four answers missing, not deleted, oldest first so they are journalled in
the order he took them — read newest first under `WAITING_MAX` and reversed. The
week is the bound: a trade left unjournalled would otherwise keep the dot lit
for ever. **An answer is a tap in a tap's own grammar** — a `POST` of
`{ "data": "PID562780708|sl|1" }` — so `parseCallback` is the one boundary for
both, and no column but the four is reachable; `[Edit]` and `[Done]` are refused
with a 400, being the Telegram form's. It answers with what waits next, so the
charm moves on without a second request, and the trigger redraws the Telegram
message as it does for an answer from the app. **`GLADYS_CHARM_SECRET` is
optional**: unset, the door is shut, since `secretMatches` refuses an empty
secret.

**One message, edited in place.** It opens `Hola Jefe, new fill below`, with four
rows of buttons — the two setups, then Rules, Stop Loss and Take Profit —
answerable in any order. Each tap writes one column and redraws; the fourth
answer settles it to a two-line summary with `[Edit]`. There is no text-reply
path. `[Edit]` reopens the form with a fifth row, `[Done]`, which collapses it —
needed because once every answer is in, no tap can be the fourth. It appears only
on a complete journal, where it cannot abandon one.

**It fires at open, not at close**: the poller mints the row from the entry deal,
so all four answers are null and the message asks for all four.

**`callback_data` is the entire state a tap needs.** `PID562780708|setup|Break &
Retest`, `PID562780708|sl|1`, `PID562780708|edit` — the trade, field and value,
39 bytes at worst against Telegram's 64-byte cap. The callback also carries the
chat and message ids `editMessageText` needs, so there is no session table and a
redeploy mid-answer costs nothing.

**A write from anywhere else reaches the message through the id.** `postOpen`
stores what `sendMessage` returns in `trades.tg_message_id`, and a second
trigger, `trades_telegram_on_answer`, fires when any of the four columns changes
on a row that has one. A tap reaches the app through realtime; a save reaches
Telegram through this. The trigger compares with `is distinct from`, not `<>`:
the columns are three-state, `<>` is `NULL` against an unanswered one, and a
`WHEN` that is not true does not fire — so the *first* answer to every question
would never redraw. It needs no time guard, since a restore asking Telegram to
redraw a message to what it already says is refused as `message is not
modified`. A row with no message id stays silent: there was never a message.

**Whether a tap settles the form is decided from the row as it stood before the
tap** — one extra read. Already complete means a correction inside a reopened
form, so it stays open; incomplete means this may be the fourth answer. The
keyboard cannot decide it, since an open form and a reopened one both draw four
rows. That is `staysOpen`, exported, and a test replays the taps against it.

**The two redraws a tap sets off agree by construction.** A tap writes, so it
fires the redraw trigger as well as redrawing the message itself, and the
trigger's lands second. Both decide from the same before-state — the trigger
sends it as `before`, the webhook has already read it — so `answered(before)` and
`staysOpen` are one expression and Telegram answers the second `message is not
modified`. Decided any other way, a form reopened with `[Edit]` would shut under
the correction being made in it. `agree.test.mjs` reads `postAnswer`'s body for
that call, since nothing can drive it.

**The write stays in the journal half.** A button's field maps to a column
through the same four names as `Data.OWNED`, so no broker column is nameable from
a tap. `tg_message_id` is on neither list, so nothing can point her at another
message.

**The open trigger's guard is load-bearing**: `when (new.entry_time > now() -
interval '1 hour')`. A live fill is seconds old; a restore, an `on conflict do
update`, a `?force=1` backfill and the poller's re-upserts all fail it, so
restoring from backup does not message you once per row. A row the email parser
minted has no `entry_time`, `null > anything` is NULL, and it gets no message —
there was no open event.

**`followed_sl` and `followed_tp` answered at open record intent, not outcome.**
The message arrives seconds after the fill, so those columns measure respect only
where he goes back and corrects one; a missed correction reads as compliance and
both bars lean upward. That is said where the question is asked, in
`disciplineBars` where the figure is produced, and in Eugenia's prompt, since she
is served both columns — `agree.test.mjs` reads the prompt for it.

**Two failure modes are coded for.** A double tap's second `editMessageText`
returns `400 message is not modified` and is treated as success. Any other edit
failure falls back to a fresh message. Every path answers 200, because Telegram
redelivers anything else, and a failed write is better retried by his second tap.

---

## Eugenia — the market bot

A daily XAU/USD briefing, a quieter look later in the morning, a look at any
number that actually lands, a word when a position opens into one, and a
conversation about any of it. **Weekdays at 08:00 ET, Sunday at 17:00 ET** — the
gold open, so the week's first briefing lands with the market. She says hello
her own way, Spanish or English, inside the first paragraph, and goes straight to
the number. Reply and she answers — typed, by voice, or to a chart.

`schema.sql` holds her memory and her read of the journal, her meters,
calendar and the trigger that tells her about a trade, and her clock; `prompt.ts` holds who she is,
`strategy.ts` what he decided, `adherence.ts` the thirteen rules a row can
answer; `index.ts` is the wiring.

**The conversation and what she remembers are two tables, and stay two.**
`eugenia_turns` is the conversation window, `eugenia_notes` what she remembers,
and `eugenia_trades` a view beside them. Nothing reads the two tables together —
notes go in at the top of a turn, turns at the end, with different windows,
shapes and constraints — so merging them would add parts, not remove them.

**She tidies her own memory at 22:00, every day.** A note written mid-answer is
decided at the worst moment; the nightly pass is the only point she sees a whole
day. It reads the last twenty-four hours of turns against the notes she holds,
writes what changed and will stay changed, and retires what is no longer true.
Its default is almost nothing — most days deserve no note, and the visible
window is twenty, so five mediocre notes push five good ones out. It is given
what it judges with: the week's trades, since it is asked what he has started
doing differently, and `search_memory`, since it is asked to supersede rather
than add. No web search — a bookkeeping pass has nothing to research.

- **Its window takes the newest turns.** Two hundred is more than a real day; a
  limit at the oldest end would distil the morning and drop the evening, where a
  late instruction lives. `agree.test.mjs` refuses `order=id.asc` under a limit
  on every read of her tables. Ordering by a clock is a different question — the
  trade event reads `at.asc` because the next release is the earliest.
- **Twenty-four hours, no watermark**, since the window and the gap between runs
  are the same length. A missed night loses that day's distillation and never
  the day: the turns stay in the table, searchable.
- **Nothing is sent and no turn is stored**; storing one would spend two of
  tomorrow's twelve turns on bookkeeping. `?consolidate=1` runs it on demand.
- **It records where the five channels stand**, at the one moment a rung could
  have moved — the only meter on whether his understanding grows. A ladder that
  stopped moving looks exactly like one that never had to.
- **It moves the story and closes what resolved.** `set_thesis` rewrites the
  running thesis — *moved*, since most nights it is the same story a day on —
  and `close_loop` closes a thread that resolved. Both are nightly-only, like
  `set_channel`: judgments across days.
- **It moves how she reads him.** `set_portrait` rewrites one paragraph of what
  his notes, his trades and his record against his own word add up to — moved,
  as the story is, and each thing in it seen more than once, counted with
  `check_rules` and `get_stats` rather than remembered. Nightly-only for the same
  reason.
- **It retries at 23:00**, gated on whether tonight's pass already ran, read off
  `eugenia_runs` (the pass stores no turn to read). A read failure counts as
  *already run*, and a quiet day records itself, so the retry never re-runs a
  pass that correctly decided nothing.

**The schedule is decided in the function, not in cron.** pg_cron is UTC, so a
fixed expression is an hour wrong for half the year. The job runs hourly and the
function asks America/New_York for its own clock — `briefDue()`,
`consolidateDue()` and their retries, composed by `dueNow` — and most calls find
nothing due. Because the job is `0 * * * *`, a new schedule costs nothing in cron,
which is also how one could be answered correctly and dispatched by nobody:
`agree.test.mjs` reads `postScheduled` for a branch per answer. A test walks every
hour of a week through the composition.

### The briefing is prose, with one list in it

**It is the weeks behind his chart, not the hours on it.** He reads the hours
off his own screen, so the overnight move, the session's range, an hour's swing
in yields and a forty-dollar day stay out; a move earns a line only where it
changed the bigger story. The live quote is still handed in, for knowing where
gold stands rather than for opening on.

Five slots: **where the big picture stands** — the Fed's path, the dollar's
trend, inflation, central-bank buying, and which of them moved — in two or three
sentences with the conclusion first, or one saying none did; **why that matters
for gold**, walked link by link, one sentence per step; the calendar; one context
line on the same scale; one thing worth noticing. Numbered sections with
headings are a report whatever the vocabulary inside them, which is why there
are none.

**The calendar is the one place the prose rule is relaxed** — a plain day label
and one line per item, times in ET, one fact each. On a weekday it is that day's
releases, and a line from abroad only where the story runs through it. The list
holds times and names, `NAMED AND NOTHING MORE`: no mechanism goes in it,
because that slot is where a second chain hides.

**On Sunday the briefing is about the week it opens** (`weekBlock`). It files the
whole week first (`filedWeek`, the nightly pass's own filing) and is handed every
US release TradingView rates high for the seven days ahead, and from abroad the
central banks' decisions and headline inflation, in place of the rolling
calendar — high only, since seven days of medium is a page and none of it moves
gold alone. The first paragraph is where the story stands as the market opens,
the teaching block walks the release most likely to move it, and the calendar is
the week, a day label per line. The week's list is not counted toward the
length, in `SYSTEM` and in `CRITIC`.

**Length is a rule, and what makes it safe is what sits beside it.** A ceiling
with nothing saying what to lose cuts the teaching block, the longest thing on
the page — and with channels at `unseen`, where §0 says build the term before
using it, that is the part that matters. So the budget is 250–300 words, less on
a day the picture did not move, 400 at the outside, and beside it a fixed order of what comes out: numbers he cannot act
on, then levels he can read off his own screen, then any market sentence that
could have been written on any morning. **Never the teaching block and never an
event.** Still over means the briefing is about too many things. Four thousand
characters is the separate mechanical bound, Telegram's. `agree.test.mjs` reads
both the writer's copy and the critic's for the count **and** the protection.

**The writing rules bound a sentence, not only a word.** Plain words alone still
read as hard when one sentence carries three ideas. The rules, in `WRITING`:

- **One idea per sentence**, twenty words at most.
- **No em-dash aside, no stacked subordinate clause.**
- **No punchlines** — a line that takes a second to decode is a line he reads
  twice, and he will not.
- **No term used bare; a name must explain itself.** *The genuine part* tells a
  reader everything; *the leftover* nothing. The usual failure is a **market
  term used bare** — *"Oil has handed back most of the war premium"*. Plain
  words instead, or the term with its own sentence saying what it is. Real names
  he will meet elsewhere stay: dot plot, retail sales, jobless claims, the
  ten-year.
- **Use the word you would text** — *expensive fuel*, not *dearer fuel*; *a
  harder sell*, not *stiffer competition*.
- **No figures of speech.** *The relief in gold has been contained rather than
  clean* obeys every countable rule and still has to be decoded.
- **A paragraph is three or four sentences.** Sixteen easy sentences in one
  block is a wall. `CRITIC` and `TRIM` each COUNT this, and every em-dash, as
  their last step rather than reading for it among the rest.
- **A number earns its place** by meaning something he can use; the briefing
  holds two to four, one budget the writer and `CRITIC` both state and a test
  holds equal.

**The judgement rules carry worked examples.** The countable rules landed at once
— a first briefing with no sentence over twenty words — while the same message
said *war premium*, *dearer fuel* and *measured inflation*. A gate can count; it
cannot adjudicate *the plainest word* from an adjective, and a model matches an
example where it ignores a description. The examples live in `WRITING`, so the
writer, `CRITIC` and `TRIM` all see them.

**She answers in English whatever he wrote in.** He is a native Spanish speaker
building an English market vocabulary, and the same idea in Spanish hands it to
him in words he cannot reuse. **A word of Spanish now and then, though** — a
greeting, an aside — never a market term, a number or the sentence carrying the
mechanism; most messages have none. Both rules live in `WRITING`, so the gates
that read it do not strip the Spanish back out. And it is said as a native says
it: `WRITING` asks for the accents and the ñ, since the voice stresses off the
spelling, and `TTS_STYLE` asks for native Latin American Spanish at speed, as
code-switching in both directions, so no Spanish accent leaks onto the English.

**She teaches, and that is a rule about depth rather than length.** The day's one
thing is stated as a chain — *hot inflation, so the Fed waits, so the gap between
rates and inflation widens, so gold is a harder sell* — because a cause named with
no chain under it is something to memorise rather than understand. **One chain
per briefing**: every scheduled thing still gets named, but only one gets its
mechanism walked. A term explained this week is **used** the next time rather
than redefined; a simplification is signposted in a clause (*that is the clean
version*); and what he has shown he understands is recorded, since it is the
only thing that says what **not** to explain.

**One chain is exempt from the rung, the one under everything else.** Gold pays
no interest, so it competes with what a bond pays once inflation is taken out.
`PITCH` says a channel at `owns` gets its term bare — right for every term but
this, which sits under nearly every briefing. Writer and critic are both told,
the critic especially, since it decides what counts as a repetition.

**She remembers yesterday.** The briefing reads the last twelve turns, so it
opens with how yesterday's print landed rather than from nothing. What is stored
is a marker (`[weekday briefing]`) as his turn and the briefing as hers — never
the augmented prompt: the notes and the week's trades are rebuilt each morning,
and storing them would resend a stale copy as history for six briefings.

**She sees your week without being asked.** The last seven New York days of
trades go in with the briefing, mentioned only when there is something real to
say. **Which rules broke is computed, not read off the rows** (`breachesBlock`):
every closed trade since the last briefing that went out — so Sunday's covers
Friday — plus any trade that CLOSED since then, R-15's Friday hold. The rules are
`check_rules`' own evaluation (`readRules`, one reader for both), so she is
handed the failures and told when nothing broke. A breach gets the fact, her
verdict and the lesson in three short sentences, then back to the market. Closed
trades only: a verdict on an open one is a hard prohibition.

### The calendar — filed for her every quarter hour

**The calendar is filed for her, from TradingView.** `fileCalendar` reads
`doji-tradingview?calendar=1` for the days around now, through the cron secret
she already holds, and upserts every timed US release rated medium or above into
`eugenia_calendar` under TradingView's own id (`tv_id`):
the time, the name with its period (*Core PCE Price Index MoM (Aug)*), the
country, the importance, the consensus, the prior, and the actual once it prints.
Low-rated US items are not filed — each would be in front of her on every request
and none moves gold alone.

**From abroad, what she asked for and nothing else** (`wanted`): the central
banks of the euro area, Britain and Japan (`mny` at medium or above — decisions,
minutes, the president's and the governor's speeches); headline inflation in all
seven (`prce` rated high); government bond auctions in Germany, France, Italy and
Britain, less the bills, which TradingView names in months; and China's reserves.
By kind rather than by rating, since the rating would miss most of it: TradingView
rates Lagarde medium and every auction and China's reserves low, and rates a dozen
surveys high. About 12 events a week, out of more than 100 listed. China's gold
imports are not on TradingView's calendar. A row from abroad carries its country
at the head of its name (*FR Inflation Rate YoY Prel (Sep)*), because three
economies publish that title in one hour. **None of it is one of his**: R-14 and
R-19 and the trade event's warning all read `country=eq.US` (`HOME`, beside
`HIGH` in `adherence.ts`), and a list that carries a line from abroad tells her
so once. The rolling list and the Sunday week carry it; the week takes only what
is rated high, so abroad that is the central banks' decisions and headline
inflation.

**The briefing files before it reads, and a quarter-hourly job files on its
own** — `doji-eugenia-calendar`, on `?calendar=1` — so an actual lands within
fifteen minutes of printing for the dashboard card and the trade event's warning
between briefings. It is a second job rather than a faster one, because the
hourly predicates all test `hour ===` and a `*/15` job would run four briefings.
Every filing is an `eugenia_runs` row under `calendar`, failed or not, since a
calendar that stopped moving looks like a quiet week.

**One release is one row, whatever it is called**, because the key is
TradingView's id and nothing she can call creates a row. Keyed on a name the
model wrote, one CPI once became five rows. `calendarList` marks a row with no
figure **PAST** once its time has gone — every speech, and every print whose
number has not arrived.

**The read is bounded at forty rows, earliest first, and a full read says so.** A
heavy day loses tomorrow's rows, which the next briefing reads — the right end
to lose — but a cut list must not pass as whole, so it ends with a line saying
later releases were not read.

**A figure TradingView has not published is left out of the row, never sent as
null.** `merge-duplicates` writes exactly the keys present, so `actual: null`
would erase an actual already filed. Rows go up grouped by the columns they
carry, since PostgREST refuses a bulk insert whose objects differ.

**The window reaches past tomorrow's morning prints.** A trade opened before
tomorrow's briefing is checked only against what is filed, so the briefing files
today and tomorrow up to noon New York; filed at twenty-four hours, the London
session would never hear of the 08:30. Read and write share one bound, and every
calendar line from another day names its day — two mornings each have an 08:30.

**The row records when its content was last written.** `updated_at` moves through
a trigger, `eugenia_calendar_touch`, only when the content changed: the filing
re-upserts every row each quarter hour, so the column says which of two rows
carries the later content rather than when one was last filed. The trigger
compares the row as `jsonb` less `updated_at`, so a column added later is
compared without anyone remembering it.

**Every reply is read once more before it is sent**, as the briefing is.
`CRITIC` reads the briefing; `TRIM` reads every reply. The reply is gated inside
the typing indicator, so she never reads as having finished and said nothing,
and `TRIM` holds the reply to no short length: a plan checked against his rules
can be nine findings long.

`TRIM` is **not `CRITIC` with a shorter prompt**. The briefing's checks — a first
sentence true only today, a complete chain, one chain only, 250–300 words —
would ruin three sentences. `TRIM` asks the writing questions alone, off the same
`WRITING` the writer was given; it gets no notes and no channel map, since it is
not judging whether a term was built, but **is** handed what you have on now,
because her read on price is allowed and a read while you are in a position is
not. It runs on Sonnet.

**Both gates check one fact against the story she carries: the direction.** She
twice wrote "October rate cut odds" days after a hike, inside reasoning about the
hike. A "cut" where the story says "hike" is changed to match, unless the message
says the story changed today and why. The nightly pass writes into the story
which way the central bank last moved and which way the market is betting. The
rule is written once, `AGAINST_THE_STORY`, and both gates read it.

**And one against the screen he checks: a later Fed meeting given a
percentage.** `SYSTEM` says only the next meeting is quoted as a chance, and the
6 October briefing still said *"a 79% chance of a quarter-point hike in
December"*, which disagrees with FedWatch's cumulative odds for that meeting.
`LATER_MEETINGS` is the check, written once and read by both gates. Neither is
handed the odds, so it takes the percentage out and keeps which way futures
lean rather than inventing a figure.

**The trade event stays out of the gate.** `TRIM` **rewrites**, and this message
reaches him in a position or just past his day's limit, where a paraphrased
citation of his rule is how a sentence becomes an order. `TRADE_EVENT` is also
the most constrained prompt in the file — two sentences, the fact then the rule,
`NOTHING` as a way out. `isSilent()` matches that bare word only, so *"Nothing
much, but the 08:30 is still ahead"* is sent: a swallowed message is invisible,
an extra one merely extra.

`gate()` is one function for both: a revision failing `keepDraft` is overruled,
and a gate that *throws* costs nothing — copied, that catch is where one gate
loses its message on the day a vendor is slow. **Every outcome is a row** in
`eugenia_runs` — `trim verdict` or `critic verdict`, reading `revised 1840 →
1795`, `unchanged`, `kept the draft` or `failed, the draft went` — because
revised, unchanged and overruled are three different repairs. **`keepDraft` is
relative to the draft**: a flat floor would overrule every revision of a short
message, and a gate overruled every time looks exactly like one that agreed. Its
ceiling is each gate's own — twice the draft for the critic, which may add a
missing link or verdict; a quarter (`TRIM_MOST`) for `TRIM`, which only cuts and
swaps, after a reply came back with `TRIM`'s own notes on top of it.

**What is remembered is what the gate returned**, never the draft — a draft
stored is a message he never read, resent as hers for six exchanges.

**A trade reaches her in two minutes.** A trigger on `trades` calls her when the
poller writes a position, and the two things she may say are both **his own
rules read back at the moment they apply**:

| Event | What she may say |
|---|---|
| opened | a high-impact US print is pending and he is now in a position — R-14 is about standing aside before one, R-19 about a position inherited into one |
| closed | that fill took the day past −4% of the account his size implies, and R-11 says the day ends there |

Naming the rule is citation; saying what he should do is not hers, and the
prompt says so. **Silence is the common case and costs nothing**: both branches
decide from data *before* any model call. Both are about **today**, so a trade
filed under another day returns first — anything stamping an old close would
otherwise report it in the present tense — and an "opened" event for a trade
already carrying its exit (a scalp inside one poll) says nothing.

The trigger fires on the transition, not every poll. `fill_time` is null on every
open position, so the close clause uses `is distinct from` — `<>` is NULL there
and the event would never fire — and the poller's two-minute re-upserts never
re-fire it.

**A thread that cannot close fills the list that holds the ones that can.**
`readLoops` hands her the newest ten, so a loop that never closes pushes the
oldest out of view while leaving it open — closable by nobody. **A question he
has not answered in a week he has answered**: it closes, with a line saying so,
and a note is still written. A watch is untouched, since age proves nothing
about an odd reaction.

**The briefing asks him nothing.** A slot whose only output is an open thread
measures nothing; he engages by *instruction*, a channel that works. The reply
path keeps its questions — in the trade conversation one question and then
silence is the method, and he answers there because he started it.
`agree.test.mjs` reads both halves.

### Checking his rules

§7 of the strategy writes a predicate for all eighteen rules and §8 the
population filters and the three verdicts. Applying seven filters and
three-state logic over four hundred rows by eye is what a model does worst, and
a rate over the wrong population looks exactly like one over the right.
`adherence.ts` evaluates the thirteen rules a row can answer — **R-01, R-02,
R-03, R-04, R-10, R-11, R-12, R-13, R-14, R-15, R-16, R-18 and R-19** — and
`check_rules` serves it. §7's `Evaluable` column decides the set, and `agree`
holds the two lists together.

**R-14 and R-19 are judged against TradingView's calendar** — he defined high
impact, at v1.20, as a US release TradingView rates high, so one calendar serves
the briefing, the trade event and the rules. Rows with no TradingView id are not
read, and neither are rows from abroad. **A week nobody fetched is not a quiet week**: `calendar_weeks`
records each week a whole-week fetch landed for, and
an entry outside one is `unknown`. Both markers go through `fileWeek`, which
writes the rows first and the mark after:

- **the nightly pass** files the current week;
- **the history door**, `?history=YYYY-MM-DD` on `doji-eugenia`, walks every
  week from that date, up to two years a run, back to TradingView's 2003. It
  answers first and works behind the 200, so its result is one `eugenia_runs`
  row per week under `calendar week`. A refused week is asked again once after a
  pause; refused twice, the walk stops and its last row names where to resume.

**A week the read did not reach is not covered either.** `check_rules` reads
releases newest first, bounded at five hundred over up to a year, so a full read
covers only the weeks after the one its oldest release falls in. **The trades
read has the same bound and says so**: every tool over the journal reads the
newest four hundred trades in its window, and when a read comes back full
`reachLine` adds the day it actually reaches.

**`unknown` is not a pass**, in the code rather than the prompt: the verdict is
the worst outcome present, and an empty population is `unknown`. A Friday
close-out under $25, a second entry inside the fifteen-minute sweep window, a
day with no size to derive an account from — each is reported as undecidable with
its count. It is pure, so every rule is driven from a test in **both**
directions.

**A verdict is not the whole answer — the counts and the ids are.** R-10 once
compared each span with the one before it, so the second trade inside a long
hold came back a pass, named nowhere, while the verdict still read `fail`. It
sweeps from both ends now, naming every span that overlaps any other, and its
test asserts on the counts and the list — the rows `check_rules` promises so a
finding can be checked rather than believed.

**It gives no verdict on a trade.** *"Two entries eleven days ago were 41 minutes
apart, and R-12 allows fifteen"* is a fact about his own rule; what it meant is
his to say.

Two figures are readings rather than facts, named so they can be argued with:
`CLOSEOUT_MIN`, thirty minutes, gives §6's *"at or very near"* the Friday close a
number; `STRETCH`, 24–31 December, gives §5's *"Christmas-to-New-Year stretch"*
one. The holiday calendar is computed — Good Friday, the Saturday observance
that closes the market on Friday 3 July 2026, and, since v1.21, the banks'
Columbus Day and Veterans Day (on the Fed's observance) — because a table stops
being true the year nobody extends it, which looks exactly like perfect
compliance. **R-12 fails a second entry taken while the first was still open**:
a sweep re-entry follows a close, and he trades one entry at a time.

### The second read

The briefing is researched and written in one generation, and its quality target
lives on the far side of a model call. So `CRITIC` reads it once more before it
goes, at `medium` effort with no tools: does the first sentence say where the
big picture stands today, is a term built at a rung that no longer needs it, is
a link missing from the chain, is there a forward call, is it inside the budget,
does it obey his standing instructions. It returns the briefing, not notes about it.

**It is handed his notes and the channel map, because two of those checks read
them.** Without the map, the mechanism sitting in the paragraph reads as a
redefinition, and the build-up `PITCH` required is cut — last, fluently.

**It cannot make things worse, and that is enforced.** A revision that comes back
empty, apologetic or past `keepDraft`'s bound is a critic that failed, and the
draft goes.

### Hearing him, and seeing what he sees

**A voice note** reaches her as text marked `[voice note]`, and she reads it as
him talking rather than writing — it will ramble, and it is likely to be about
how a trade felt, which is when she slows down and asks one thing. The Messages
API takes no audio and Telegram does not transcribe for bots, so `STT_URL` and
`STT_KEY` are optional secrets written against the `/audio/transcriptions`
shape. **Unset is a first-class state**: she says she cannot hear it and nothing
else is affected, which is why they are not in the boot guard — and `agree`
makes that exemption cost something: an optional secret must be guarded where
it is used.

**When a voice note produces no words, she says which of four things
happened.** A rejected key, a wrong URL, an unsupported format and unclear audio
each have a line in `VOICE_TROUBLE` naming whose problem it is, and none asks him
to repeat himself for a fault that is not his. The audio goes to the vendor with
**both** its extension and its `audio/ogg` type, since providers differ in which
they read.

**A chart** she can see, and the prohibitions do not move because she can. She
may describe it and take it as context; on a trade not yet taken she may not say
whether a setup is valid or a level will hold — a picture is the most tempting
place in this system to give a signal. A chart of a closed trade she judges the
way she judges the journal.

Neither is stored as sent: the transcript is kept, the image is not — a megabyte
of base64 would be resent as history for six exchanges. `stamped` appends the
New York time as a trailing text block, since concatenating against an array
gives `[object Object]` on exactly the turns carrying most context.

**Everything she writes is spoken.** The old rule — answer in the channel he
used — only ever decided a reply, so the briefing, the one message he wanted read
to him, was never spoken. He decided it the other way. Four call sites speak:
the briefing twice (its speaking worker, and its own fallback), the trade event
and the reply. `say()` keeps the
`/notes` audit (a table, unlistenable), the apologies (failure notices, not her
words), the short operational lines and the charm's copy, whose voice is on the
charm.

**The voice note is the message, and the text is the fallback.** Both together
were two notifications for one thing she said. But an unset key, a refusing
vendor or a format Telegram will not render would make audio alone a
**missing** message, so `say()` fires whenever the audio did not land — in full,
since three quarters heard is worse than either. That ordering lives once, in
**`sayAloud`**, and a test reads it and counts the call sites; `fold.test.mjs`
**drives** it, since with no TTS key every `speak()` answers false, exactly as a
refusing vendor does. **What is stored is untouched**: `remember()` writes the
transcript whatever happened on the wire. The briefing's keyboard rides on the
last voice note.

**There is no length cap.** A briefing is 250–400 words by its own rule, and a
cap decides that past some length a message is not worth hearing. A long message
becomes *several* voice notes, split by `chunk()` with its paragraph preference
so each part is a whole thought; the only number is what the vendor accepts per
request. The prompt is told no length.

**The briefing is written in one worker and spoken in another.** A speech request
that never answered once held the worker until the platform killed it at four
hundred seconds — no catch ran, so no text, no row, no apology. So
`postBriefing` writes, runs the critic and stores the briefing, then opens
`?speak=weekday` (or `sunday`) on its own function, which answers before it
works and runs `postSpeak` on a clock of its own. `postSpeak` finds today's
briefing by its marker, pairs it with its text by the instant both were written,
and speaks it. If the second worker will not start, `postBriefing` speaks it
itself. Opened by hand, `?speak=weekday` resends a stored briefing that never
reached him — today's only.

**Every request in `speak()` carries a budget, and a failed part gets a second
attempt.** The budget covers the whole message: **`SPEAK_MS`**, 150 seconds, on
paths that write and speak in one worker; **`SPEAK_WORKER_MS`**, 330 seconds, on
the speaking worker. **`ATTEMPT_MS`** bounds each attempt at 150 seconds — a
stall is one request, the next a fresh connection — so on the speaking worker a
stall costs an attempt rather than the voice. A part that has not landed when
the budget runs out fails like any other, and the full text goes. The Telegram
upload carries the budget too.

**The markdown is stripped on the way to the vendor.** No parse mode is sent, so
she is asked for plain text, but the calendar slot is where a model writes a
bold label anyway, and `**Today:**` read aloud is a gamble.

**The audio is requested as OGG/Opus — the one thing here that fails quietly.**
The vendor's default mp3 *works* and arrives as an **attachment**: no waveform, no
speed control, nothing to play at your ear. A test reads `speak()` for `opus`,
`audio/ogg` and the `.ogg` filename.

**Which voice is taste; how it is read is the product.** `TTS_URL` and `TTS_KEY`
are optional like `STT_*`. `TTS_VOICE` and `TTS_MODEL` are environment with
defaults — nothing is stored, so a change alters one message — but they are
**coupled**: `tts-1` serves fewer voices and takes no delivery instruction, so
overriding the model alone can name a voice it lacks, a 400 costing the audio.
`TTS_STYLE` is pinned, because a breathless delivery of a deliberately unexcited
paragraph contradicts the whole prompt. It asks for the delivery, not only what
to avoid — given only prohibitions the model reads every sentence the same
length and shape. The arc is set at the **paragraph**, since the writing rules
fix sentence length and sixteen identical falls are the metronome itself: only
a paragraph's last sentence fully lands. Its last line is pronunciation — `08:30
ET`, R-11, R-14/R-19, comma'd levels — said in the instruction rather than
rewritten, so the stored text stays the text he reads.

**`TTS_SPEED` is 1.3**, off what he was already doing: playing every note at 1.5x
and calling it a shade fast. It is pinned for `TTS_STYLE`'s reason. `speed` has
been reported ignored by `gpt-4o-mini-tts` — no error, audio at 1.0 — and nothing
here calls the vendor to see it, so if the tempo is unchanged that is the first
suspect, with pace in `TTS_STYLE` as the fallback.

**The hello is hers.** A greeting prepended in code was the same words every
morning with a tempo no punctuation fixed. She now greets in one breath inside
the first paragraph — on a line of its own a hello is read as a paragraph — and
`CRITIC` is told it stays, that the first-sentence test applies after it, and
that no split strands it. A test reads the call site.

The vendor's policy requires the listener to know the voice is synthetic. Here
the listener built the bot; a forwarded note carries no such context.

### The charm — her voice on his keyring

A round screen with a microphone and a speaker: he holds it, talks, lets go,
and she answers out of it. **It is a door into the same conversation, not a
second bot.** The charm posts its recording to `doji-eugenia` with
`x-charm-key: <EUGENIA_CHARM_SECRET>` and plays the response body; nothing
about it goes near Telegram's Bot API, which has no way to speak to a bot as
him. The turn is **`converse`**, the reply's own — the same twelve turns, notes,
map, thesis, loops, calendar and desk, the same model and the same `TRIM` gate —
so the charm and Telegram are one memory and either can follow up the other.
His words are stored marked `[voice note]`, which is what they are.

**One request, answered at once.** The response starts before the turn does
and is the audio itself: the vendor's raw **`pcm` — 24 kHz, 16-bit
little-endian, mono**. No decoder on the device, and the parts of a long answer
join end to end where a file format's header would not; `chunk()` splits it at
`TTS_LIMIT` as for a voice note. **While she thinks, the wire carries silence**:
a tenth of a second of zeros at once and every fifteen seconds (`BEAT`,
`BEAT_MS`), because a turn can run for minutes and a response quiet that long is
closed by a proxy on the way — the shortest such limit known is a hundred
seconds. Zeros are silence in this format, so the device plays them like
anything else and its face tells thinking from speaking by the level alone.
The work is kept past a charm that hangs up, so the copy and the memory still
land.

**Telegram gets the text as a copy**, his words first — `«what she heard»`, a
blank line, her answer — so a mishearing shows where he can scroll back. It is
`say()`, not `sayAloud()`: the voice went to the charm, and a second voice note
of a thing he has just heard is noise. The pair is stored whether or not the
copy lands.

**What the charm hears when it goes wrong.** A recording with no words, or a
transcriber that fails, is answered with its `VOICE_TROUBLE` line, spoken, and
nothing else happens. A turn that throws is answered with `APOLOGY.reply`, the
reply's own. A part the speech vendor will not read ends the audio; the copy
in Telegram is the whole of it. The voice has `SPEAK_MS`, and shares the
request's wall clock with the turn — a turn that runs to its five minutes
leaves the voice what is left of four hundred seconds.

**The briefing reaches the charm without waking it.** The charm sleeps with its
radio off, so nothing can be pushed to it: after the briefing's hour it wakes and
asks **`?briefing=ready`** (a `GET` with the same key), which answers with her
line *"Your briefing is ready, jefe."* as `pcm`, or a `204` while no briefing is
stored for today. Writing takes up to six minutes, so the charm asks again every
few minutes until it lands. Then it shows a still purple dot until he presses,
and asks **`?briefing=today`** for the briefing itself. Both read today's
briefing through `storedBriefing`, the speaking worker's own find-and-pair, so
the charm says exactly what Telegram received: Sunday's on a Sunday, the weekday
one otherwise.

**The door refuses before it works**: a wrong key is a 401 like any other; a
right key without `STT_URL`, `STT_KEY` and `TTS_KEY` is a 503 naming them, since
it could neither hear nor speak; an empty recording, or one over `FILE_MAX`, is
a 400. **`EUGENIA_CHARM_SECRET` is optional** — unset, the door is shut, because
`secretMatches` refuses an empty secret, and nothing else changes.

A laptop stands in for the charm with `sox` and `curl` — record 16 kHz mono
WAV, post it, play what streams back:

```sh
rec -r 16000 -c 1 -b 16 ask.wav      # talk, then Ctrl-C
curl -sN --data-binary @ask.wav -H "x-charm-key: $EUGENIA_CHARM_SECRET" \
     "https://<project>.supabase.co/functions/v1/doji-eugenia" |
  play -t raw -r 24000 -e signed -b 16 -c 1 -
```

### Whether it landed

An instruction note is the only correction channel he has, and it fires only
when something annoys him enough to type. So two buttons ride under the briefing
— Gladys's mechanism — and the nightly pass reads the last two days of them.
**It is not a score and the prompt forbids treating it as one**: a bot optimising
a thumbs-up average flatters rather than teaches, and what he *told* her always
outranks what he tapped. Registering the webhook for `["message"]` alone means
the taps are never delivered — `allowed_updates` must name `callback_query` too.

### Whether her reads held

Every read she gives says what would prove it wrong, and until this nothing
looked. **The nightly pass files each of the day's reads with a verdict** —
`record_read`, one row in `eugenia_reads`: *wrong* when the thing she named
happened, *held* when it had its chance and did not, *untested* for everything
else. It judges against the market around gold and the Fed pricing as the day
closed, which the pass is now handed for this alone, and the calendar and the
day's turns. Filed and judged in one write, because a read is about today's news
and 22:00 is after the day it was about; a unique index on the day and the words
makes a retry's refiling a no-op.

- **Never by where price went.** A read graded on gold's move is a forecast with
  a score, and a score pulls the next read toward one — the thing the
  prohibitions exist to stop. A test that was only gold's own price files as
  untested, and `SYSTEM` asks her to name a link in the chain instead — the
  two-year, the dollar, the next meeting's pricing — which is also the part he
  learns from.
- **The record is hers.** A month of counts and the three newest misses go to the
  briefing and a reply, the two paths that give a read, and to the pass; never
  the trade look, which carries none and arrives while he is in a position. It
  sets how firmly she holds a view — a run of misses on one kind of day is a
  reason to say less on the next — and she never cites it to him as a reason to
  believe one, never gives a read to improve it, and never holds one back to
  protect it. `/notes` shows it to him, so he can see what her reads are worth.

### What she remembers

Nine tables, separated by how long a thing is true for. A turn rolls over inside
a morning; a note about him outlives twenty of those; what he UNDERSTANDS
outlives both; a thesis and a portrait are only ever current, so each is one row
rewritten; a loop
stays until it closes; and the calendar and her record are the datasets here that
compound.

| | Holds | Window | Written by |
|---|---|---|---|
| `eugenia_turns` | the conversation | last 12 turns | every exchange |
| `eugenia_notes` | facts about him, what he has told her to do, and what he has committed to | last 20 of each kind | her `remember` tool |
| `eugenia_channels` | where he stands on each of the five channels | all 5 rows, always | her `set_channel` tool, nightly |
| `eugenia_thesis` | the running story the market is trading | 1 row, rewritten | her `set_thesis` tool, nightly |
| `eugenia_portrait` | how she reads him — what his notes and trades add up to | 1 row, rewritten | her `set_portrait` tool, nightly |
| `eugenia_reads` | every read she gave, with a verdict on the test she stated | the last 30 days | her `record_read` tool, nightly |
| `eugenia_loops` | what she flagged and what she asked, until it closes | all open, newest 10 | `open_loop` anywhere, `close_loop` nightly |
| `eugenia_calendar` | what lands today, and what it printed | a rolling ±day | filed from TradingView by `fileCalendar` |
| `eugenia_feedback` | his verdict on a briefing, one row per day | the last two days | a tap on the keyboard under it, read by the nightly pass |

**Notes are how he corrects her, and the only way he can.** There is no settings
page, the button under a briefing carries a verdict and not a reason, and the
conversation window rolls over in a morning — so *"stop mentioning the
ten-year"*, *"too long"*, *"lead with what is odd"* are recorded as standing
instructions: in his words, obeyed from the next message on, outranking the
shape the prompt otherwise asks for. She acknowledges one in four words or fewer
so he knows it stuck; a fact about him she records silently. Notes are about
*him*, never the market — a note about today's price is stale tomorrow.

**What he commits to is the third kind, read the other way round.** *"This week I
stop after two losses"* is something he does, so she holds his trades against it
rather than obeying it — never one he did not make. A closed trade that breaks one
gets the fact, then her verdict; the briefing gives it one sentence the morning
after. The nightly pass retires a commitment whose period is over by superseding
it with how it went — kept, or broken on which trade — since how he does against
his own word outlives the commitment. Its own kind because the two are read in
opposite directions. `/notes` lists them between what he told her and what she
noticed.

**What the notes add up to is one paragraph, and it outlives them.** She is shown
the newest twenty of each kind, so the twenty-first fact pushes the oldest out of
view: still searchable, but shaping nothing unless she thinks to look. The
portrait is the thesis's twin about him — one row, at most 800 characters,
rewritten only by the nightly pass — and carries the lesson once the line that
taught it has rolled away. Its rules are the ones that keep a reading honest:
each thing in it seen more than once, counted off his trades rather than
recalled; written as what is true of him and never as an order to herself; and
nothing about today's market or what he has open. She uses it as she uses the
facts and never hands it to him as a verdict; `/notes` shows it to him in the
second person, and he corrects it the way he corrects anything — by telling her,
which the pass reads that night.

**Every list says how many it holds, and one past the window says so.** The read
takes one row more than the twenty it shows, so each heading carries its count —
or *more than 20, the oldest not shown* — in her blocks and in `/notes` alike.
A fact past the twentieth is still searchable and the portrait carries it; an
instruction past it is one she stops obeying while he believes she took it. So
the nightly pass merges a list that holds more than fifteen — only what is
already one note said twice, in his words — before anything is lost,
and if something ever is, both of them can see it.

**What is never a note** is written into `remember` itself, so it binds the
mid-reply write and the nightly pass alike. A fact is what is true of him — *"he
reads the first paragraph and stops"* — never an order to herself, which reads
back next month as one he gave. A tool, a source or a read that failed or came
back empty is not a note: it is fixed by the time it matters, and the note would
have her refusing for months. And an approach that did not work is never written
up as one that does. These are the shapes a memory that curates itself falls
into, each of which hardens into a rule nobody gave.

**A reply to one of her messages tells her which one.** Swipe a message and
answer, typed or spoken, and she is handed the message he answered — its text, or
the stored turn sent at that moment, since a voice note carries no words. Without
it, *"too dense"* under the briefing and under a trade message arrive identically.
What is stored is his words behind a marker carrying her message's opening.
**The briefing is found looking back**, because it is the one message stored
before it is sent: when the forward look is empty, the newest two rows inside the
speaking worker's budget are taken only if they are a briefing and its marker
sharing one instant — otherwise no quote rather than a wrong one.

**Who gets what.** `notesBlock()` reaches **all four paths** — the briefing, a
reply, the nightly pass and the trade look — and its absence would be silent:
she carries on ignoring an instruction he believes she took. `portraitBlock()`
goes wherever the notes go, as its own block so a failed read costs the paragraph
and never his instructions. `recordBlock()` goes to the briefing, a reply and the
pass, and a test asserts it never reaches the trade look. `channelsBlock()`
goes to the three asked to build a term, since what moves gold runs through a
channel and a message saying the dollar came off teaches nothing to someone for
whom the dollar is `unseen`. The conversation window goes to everything that
speaks — not the nightly pass, which reads its own twenty-four hours. It matters
most on the trade look, whose R-14/R-19 line fires on the print the briefing is
likeliest to have named. Its reads sit *after* its early returns, so an ordinary
fill costs nothing. A test reads every one of these.

### What he has on right now

**Everything else she is handed is about the market or about what he
understands; `positionsBlock()` says whether he is exposed.** Without it a
briefing could dwell on a level while he sat in a position through the print it
described, every prohibition kept. One read with two filters, since an overnight
hold is not in today's rows and today's closed trades are not open.

**Open is both witnesses null** — `exit_price is null and fill_time is null`.
`exit_price` is the poller's, off the broker's deals; `fill_time` the email's, or
the poller's for a close it saw. Either alone can miss a close — a hand close
sends no email, a fold without its entry deal leaves `exit_price` null — and
reading one column once told him he was in trades he had closed days earlier,
citing R-19 and R-15 at him: the worst failure available, in the one block where
she speaks with his rules behind her. **Broker rows only**: pre-sync rows carry
client ids and neither column. `isOpen` is exported and driven from both sides,
since `positionsList` renders whatever it is handed. The same missing close makes
R-10 and R-15 `unknown` rather than running a span to *now* or dropping the row.

It renders each open position — age, side, size, entry, the stop and target as
first seen — and where the day stands against R-11's 4%. **A position opened on an earlier day names the day**: his
holds run multi-session, and a bare `open since 09:15 ET` under *right now* reads
as this morning. Flat and not traded today, it is nothing at all. It goes to
three paths — the briefing, a reply and the nightly pass.
The trade look is reached *from* the position and already holds its row.

**What she may do with it is narrower than what she can see, by design.**
Unprompted it stops anything setup-flavoured while a position is open, and lets
her name a collision his own rules name — a high-impact US print against an open
position (R-14, R-19), or a day past R-11. When *he* raises the position she
discusses it properly and refuses one thing: what to do with it. **His levels
never appear in a message she starts** — a briefing framed around the number he
is long from reads as relevance and is the opposite. That guard is a prompt
paragraph with no structural half, so a test reads for it.

**No price is given beside a position, and no unrealised P&L.** An open P&L would
be the most anchoring number in the block, and where gold is now is the
briefing's own quote, or `get_market`'s in a conversation.

A run of losses is named — *"that is three this week"* — then explained by what
the trades have **in common**, or admitted as not yet explained. A breach of his
own rule inside the run leads.

### Search that survives a rephrasing

`search_memory` reaches past the windows into everything she ever stored, through
`eugenia_search`. A lexical match alone misses a rephrasing — *"what did we
conclude about the December cut"* shares no stem with *the market has mostly
given up on easing this year* — and an empty result becomes a confident *"I have
no record of that."* So the lexical arm is full text **and** trigram (`pg_trgm`),
which catches a rephrasing, a typo or a half-remembered quote with no vendor and
no backfill. `websearch_to_tsquery`, because the query is model-written and the
strict parser throws on an unbalanced quote.

`word_similarity`, never `similarity`: `similarity()` normalises over both
trigram sets, so a six-word question against a long briefing scores near zero
however well it matches; `word_similarity` scores against the best matching
*extent*. The arm ranks in two keys rather than one fused score — an exact word
match before a near one, then the stronger score — because `ts_rank` and
`word_similarity` are on different scales and a combining factor would be a
fudge.

### Search that survives a different idea

An `embedding` on notes and turns gives the same function a second arm. **It is reach, not a sixth memory**: the windows do not move,
since every token in a window is paid on every request.

**The lexical arm stays, as the floor.** A vector is worse at exact strings — a
date, a ticker, `R-08`, a note id — and a row with a null embedding does not
appear in a nearest-neighbour query at all: half an archive quietly
unsearchable. **Reciprocal rank fusion, not a weighted sum**: the arms' scores
are on unrelated scales, RRF compares positions, and a row found by both
outranks one first in either. A search returns a retired note MARKED rather than
hidden, and says who said each turn — `note`, `you`, `him` — because a turn
rendered as hers when it was his is a quote she would misattribute.

**Unset is a first-class state.** With no `EMBED_KEY` rows store no vector, the
query vector is null, the semantic arms return nothing, and the fusion over one
arm reproduces the lexical order exactly. Turning it on is a secret and a
backfill. **The embedding model is pinned in the file**, unlike `STT_MODEL`:
vectors from two models are not comparable, the column catches a change of width
but not one at the same width, and the ranking would degrade into noise. A change
means re-embedding both tables.

**One signature, revoked and granted where it is created.** `create or
replace` cannot change an argument list, and a second form beside this one would
be an overload a call cannot resolve — so a change to its arguments is a `drop`
run by hand, which takes the grants, and the `revoke` and `grant` beside the
function put them back on the re-run. **And `revoke … from public` is not the
whole revoke**: `public` is the PUBLIC pseudo-role, while
`anon` and `authenticated` hold `EXECUTE` separately, from the default
privileges Supabase sets on the `public` **schema**. `verify.sql` asks it of
every callable function through `has_function_privilege`, which answers however
the privilege arrived.

Retrieval *quality* cannot be checked from here — nothing in the repository
reaches the database or the vendor. The ordering, the coverage floor, the widths
and the grants are held by tests; the rest shows up in use.

### Where he stands on each channel

`eugenia_channels` is five rows, one per channel, and it never scrolls — a
**census over a fixed set**, which makes it the only place an **absence** is
legible. A channel he has never once used is a row saying `unseen`; in
`eugenia_notes` it would be nothing written down, which nobody can notice. And
what he understands is durable, where a note ages out of a twenty-note window.

The ladder is `unseen → explained → used → owns`, and order matters:
`channelsList` renders a missing row at the **first** rung, so a reversed list
would show every unseeded channel as owned.

**Every rung carries `moved_on`, the day it last moved.** Nothing brings a rung
down on her reading of a bad evening, so over a year the channels he uses pile up
at the top and the census loses the absence it exists to show. A rung that has
not moved in months counts toward the tiebreaker the way a low one does. It is
formatted as the civil day it was stored as: `new Date('2026-03-12')` is
midnight UTC, the 11th in New York.

**On subject it is a tiebreaker; on register it drives outright.** It decides
which of two mechanisms *both* live today she unpacks — lean toward the thinner
one — and never what the day is about, or the briefing becomes a curriculum. It
does decide how a term is said, and that table is **`PITCH`**: build the term
from §3 at `unseen`, restate the mechanism in a clause at `explained`, say it
plainly at `used`, bare at `owns`. `PITCH` is defined once in `prompt.ts` and
interpolated into the cached prefix **and** into §0, the way `SUMMARY` is, and
`agree` asserts it is in `SYSTEM`. Held only in §0 — `get_strategy`-only — with a
pair of ends quoted in the prompts, it never reached her: `unseen` is a
**one-way door**, so a build rule gated on it stops applying the first time a
channel is mentioned, and a binary rule over four rungs reads as *the other
case*.

**Only the nightly pass may move a rung**, because a rung is a judgment across
days. `set_channel` is in `CONSOLIDATE_TOOLS` and not beside `remember` in
`CHAT_TOOLS`, and the loop enforces it: `ask()` answers a tool name outside the
set it was handed as it answers an unknown one, and runs nothing. Most nights
nothing moves, and that is the honest outcome.

**It comes back down when he says so.** *"I have lost this"*, *"explain that
again"* — promoting too early is her natural error and he is the only one who can
see it, so the demotion is his to declare. It still lands at the pass, which
reads the whole day and runs before the next briefing, the only place the rung is
read. **Nothing goes back to `unseen`**, and `setChannel` refuses it before the
write: that rung says a channel never came up, and writing it back would report
one she taught last week as never met. A channel he has lost goes to `explained`.

**And `/channel` is the rung he moves himself.** `/channel <channel> <rung>` takes
the id or the spoken name, with the rung as the last word, since three of the
five names are several words. The ladder otherwise climbs only on him using a
term back, so a reader who rarely answers would sit at `explained` — restate the
mechanism every time — for ever. It goes through `setChannel`, so the one-way
door and the unseeded-table check hold; and it is him saying where he is, not
her reading of him, so `set_channel` stays out of `CHAT_TOOLS`.

The five ids live in `prompt.ts`, read by the tool's enum and interpolated into
her prose; the check constraint and the seed are the real second copies. §2 heads
each channel with the **spoken** name, so `agree.test.mjs` resolves §2's headings
against the names rather than the ids.

### What he can see of it

**`/notes` is his audit**, answered from the database rather than by the model —
`notesList()` renders the rows with the id each is named by, so nothing can be
paraphrased, dropped or invented. Without it her memory is the one part of this
system he can write to and cannot read, and a wrong note fails by absence: a fact
saying he understands something he does not makes her **stop explaining it**.
The channel map is part of the same listing, rendered *by* `notesList()` rather
than appended from the block written for her, so the one message addressed to him
never switches into the third person about him. A failed channel read costs the
whole reply rather than being swallowed: an audit that silently omits half of
what it audits is the defect it exists to prevent.

**A note can be retired.** Every note reaches her with its number, and `remember`
takes an optional `supersedes`, so a correction names what it replaces — or
several, when one line merges notes that already said the same thing; every id
the write could not retire is named back to her. **The filter is the whole
feature and fails silently**: without `superseded_by is null`
on the read she is handed the correction *and* the thing it corrected, every
turn. The column, the filter and the tool parameter are held together by a test.
The row itself stays — findable by search and marked no longer true — and there
is no delete path.

**She can search everything she ever said.** The windows are the newest slice of
two append-only tables, and `search_memory` reaches the rest on demand rather
than widening the windows, where every token is paid on every request — the trade
`get_trades` makes for the journal. See **Search that survives a rephrasing**.

### His strategy, which she holds and cannot write

`strategy.ts` is the document he wrote — what he trades, the rules, how each is
checked. Its own retrieval contract decides what she carries: the summary, a
one-line index of every section, and the rules table ride on the **cached**
system prompt; `get_strategy` fetches the reasoning behind any of it. The index is
there because nothing cites §8 — which population, which filters, which figure
is honest — and a tool she can call is not a tool she knows when to call.

**A subsection is served by the section that holds it.** R-05 cites §4.1 and R-06
§4.2, both prose inside §4. `agree.test.mjs` resolves every citation through the
same lookup and checks a dotted one names a heading actually present in what came
back, since the fallback would answer a mistyped §4.7 with §4. A number the
document does not hold is named as missing rather than returned blank, because it
arrives from the model and a blank is something she would fill in herself.

**The asymmetry is the point.** A document that decides whether he followed his
rules cannot be edited by the thing checking them. She has no write path to it.

**The Evaluable column is what the rules table is for.** `journal` means a row can
answer it today, `field` that a column would have to exist first, `judgment` that
nothing stored can see it — not a weaker rule, but one never counted as kept
merely because nothing contradicted it. The numbering skips 1 and 11, which reads
as deliberate where holes would read as a draft. **§2 and §3 are not his** —
researched reference, labelled so where they start. Everything else is, and a
rule he has not stated is a `[decide]` rather than a pattern read as a rule.

**§3 is the foundation**: built from the ground up — what inflation is, what the
Fed sets, how a hike transmits, what a bond yield, TIPS and breakevens are, why
gold sits at the end of it — plus every metric a briefing uses, written to teach.
**§0 turns the channel map into an instruction**, which is `PITCH`.

**§6 holds R-08's four steps**: top-down bias; levels (liquidity pools, support
and resistance, the $25 grid); a candle or chart pattern with signal then
confirmation; reward-to-risk of at least 1:1.5. The order is the rule — a failed
step ends the sequence. Steps 1 to 3 are invisible to anything stored; step 4 can
be read only off a row carrying the stop and target as first seen. The default
$30 target over a stop of $20 or tighter is always 1:1.5, so the step binds only
on a $25 target set at entry. A realised 1:1.25 is the rule working on a target
shortened mid-trade and a breach on a $25 one set at entry, and only a row
carrying the plan can tell which.

**The stop is a ceiling, not a value**, which makes R-02 one-sided: $20 is the
most it may ever be, it usually sits tighter off the chart, and it moves only
outward to break-even or inward under R-19. A loss further than $20 can only be a
widened stop; a $10 stop closed $18 out passes. A clean R-02 means no stop went
past $20, never that stops were respected.

**R-10 and R-11** — one position at a time; the day ends at −4% of the account —
come out of broker columns alone: overlapping entry-to-fill spans, and cumulative
P&L against `size_oz × 500`. R-11 is not R-03: a full stop at a small rung ends
the day under R-03 having spent well under 4%, and three smaller losses can spend
the 4% without R-03 seeing anything. His definition of a full stop, settled at
v1.14, is what made R-03 `journal`. **R-12** caps him at one entry a day, two only
for a sweep re-entry; **R-13** pins a rung change to a month boundary; **R-14**
stands him aside before a high-impact release; **R-15** closes anything live
before the Friday close; **R-16** keeps him off low-volume days; **R-17** stops him
when the trading itself deteriorates — behaviour rather than a number, so
`judgment`. **R-18** — stop and target are resting broker orders and a position is
never closed by hand — makes R-01 and R-02 exact. **R-19** is the one exception to
*never tightened*: a high-impact print landing on a position inherited from an
earlier session takes it to break-even if in profit, a closer invalidation if
not, and the target never moves. R-09 was retired at v1.18.

**§4: the two setups differ by method, not location.** Break & Retest is a
continuation trade through a level that has broken and flipped; Support &
Resistance a mean-reversion trade off a level that is holding. So a win rate split
by `setup` compares continuation against mean-reversion. A level is marked by the
$25 grid or by a reaction point, strongest where they agree, so a previous high
mid-range is tradeable for Break & Retest.

It is a TS module for the reason `prompt.ts` is: a function deploys as its own
directory, and an import guarantees the file travels with it. It is markdown in a
template literal, so **every backtick is escaped**.

### His journal, which she reads and cannot write

`get_trades` reads the journal through `eugenia_trades`, and three things make it
read-only: the view fixes the column list (no `user_id`, `balance`, `commission`
or `computed_pnl`) and hides deleted rows; its grant is `select` alone; and her
function has one database read of the journal and no write path to it. The grant
makes the *view* read-only, not the key — she holds the service key for her own
tables — so the structural guarantee is the one that matters.

The view is `security_invoker`, which a view is **not** by default: without it,
RLS would depend on whoever ran `schema.sql` rather than on who is asking, and
a grant widened by mistake would leak every user's trades.

**Context goes in the user turn, not a mid-conversation system message.** That
shape would keep the cached prefix intact, but it could not be exercised from
where this was built, and a 400 there kills every reply. Nothing in the context is
untrusted: his journal, and notes that are her sentences or his.

### When it breaks, she says so

**A failure must reach him, not the console.** `pg_net` discards the function's
response, nobody reads Edge logs, and `net._http_response` is pruned within
hours, so the cron half sends a short Telegram message naming the error. **The
apology names the job that died** — `APOLOGY` is a word per job, and a test
asserts no two are alike — because a nightly pass that dies is her memory not
growing, not a missing briefing.

**A read that fails does not take the turn with it.** Everything the tool loop
serves — `get_trades`, `search_memory`, `remember`, `set_channel` and the rest —
catches and returns a sentence (*his journal could not be read just now*), and
she writes around the gap; an exception there would end the turn with a question
unanswered. **The sentence matters as much as the catch**: *no trades in that
window* from a window nothing looked at is a false statement about his own week,
in her voice. An empty answer is an answer only when something was read.

**A read that does not answer has failed after `READ_MS`, 45 seconds.** Every
market read is bounded: TradingView's doors through `tvRead`, the broker's
price and the CFTC's count. Unbounded, a feed that stopped answering held the
caller until the platform closed the request at 150s. A 7 October look spent
that long learning TradingView was down, and in a briefing the wait lands
on the writing worker's clock. Each caller already says what a failed read
means, so a dead feed now costs 45 seconds and that sentence. **A timeout names
its door** — *TradingView calendar: no answer in 45s* — since the abort's own
message names nothing, and the meter rows are where an outage is read afterwards.

**A failed briefing tries again** at 09:00, 10:00 and 11:00 ET — and on a Sunday
at 18:00, 19:00 and 20:00, the three hours after its own open, two clear of the
22:00 pass — and stops once one has landed. `retryDue` answers **which**
briefing, so a retry sends the shape the failed one would have.
`briefedToday()` reads the marker `postBriefing`
stores *before* the send, so a failed insert cannot produce four briefings and
four bills, and a read failure counts as *already briefed*. `briefedQuery()`
filters on the two marker strings rather than scanning recent turns, which a
talkative morning would crowd the marker out of.

**`?force=1` falls back to the day, not a constant**: `briefDue(now) ??
briefKind(now)`, so the door for the hour a briefing did *not* arrive can send a
Sunday one on Sunday evening. `briefKind` is driven from both sides, and
`agree.test.mjs` reads `postScheduled` for the call.

**Everything a cron secret reaches answers before it works.** Two limits: the
worker's wall clock (150s free, 400s paid) and a **request idle timeout of 150s
on every plan** — send the caller nothing that long and the request is closed, so
a briefing that delivers perfectly still hands pg_net a `504 IDLE_TIMEOUT`, and in
`net._http_response` a good briefing and a call that never ran become the same
row. Answering first makes a non-2xx there mean what it says, and the body names
the job (`accepted: "calendar=1"`), since the row carries no URL. `?embed=1` alone
waits: its answer *is* its interface — call it until it reports `left: 0` — and
it is the one flag no cron job dispatches, which `agree.test.mjs` holds against
the timer section of `schema.sql`.

**The trade event reaches the same catch.** It is dispatched beside
`postScheduled` rather than through it; both hand a failure to `jobFailed`, which
writes the `<job> job` row and then apologises, in that order.

### What a turn cost

`ask()` records one row per model call in `eugenia_runs` — caller, model,
rounds, effort, tokens in and out, cache reads and both cache writes, web
searches and fetches, milliseconds — and a **failed turn is a row too**, since a
briefing that dies costs the same searches as one that lands. A successful turn's
`detail` is its client-tool tally. Nothing else can see any of it: the spend cap
is a ceiling rather than a meter, search bills separately, and the briefing's
length target lives on the far side of a model call.

Each briefing adds rows of its own, apart from the model calls so *the critic
costs more than it is worth* and *the briefing is drifting long* stay separate
questions: `<brief> briefing written` (`stored in 1s, handed to the speaking
worker`, with its total `ms`) and `<brief> briefing delivered`, carrying the
length he received and how it went out (`spoken in 19s`, or `sent as text`). A
manual `?force=1` answers `accepted`, so the delivered row is where its length is
read.

**Two nightly meters write rows, both outcomes.** The embedding sweep writes
`caller: 'embeddings'`, because a dead vendor takes the semantic arm out while
the lexical one keeps answering; the channel census writes `caller: 'channels'`,
because a ladder that stopped moving looks like one with no reason to, and a rung
is read by comparing nights. `caller` is free text, so neither needed a
migration. **`postConsolidation` has exactly one `return`**, and a test counts
it: a quiet day is a branch, and an early return is how both meters once skipped
every night nobody spoke. The census stays after the pass, the only thing that
can move a rung.

**A job that dies before its first model call leaves a row too.**
`postScheduled`'s catch writes `caller: '<job> job'` **before** the apology,
because the apology carries `.catch(() => {})` and a refusing Telegram would
otherwise take the only notice with it.

`recordRun` never throws and never blocks the answer: a briefing written, paid
for and delivered is not lost to an instrumentation insert, or to its table not
being applied yet.

### Applying her schema to an existing database

`schema.sql` is applied whole and is **safe to re-run**, and the rule is **run
the SQL before the deploy that uses it**: a function reaching for a column that
is not there gets a `400` it swallows, and the only sign is a meter reading `0`
— `planned`, `excursions` and `stops` in the poller's answer all read `0` on a
healthy poll and on a missing column alike. `verify.sql` names a row for each,
which is how to tell an unapplied change from a quiet day. Then check its row
for **all five channels**: `setChannel` PATCHes by key, so a missing row is a
`200` with an empty body, and that channel would sit at the bottom rung for ever,
looking like one he has never used.

Three things outside the SQL, none of which fails loudly:

- **The quarter-hourly job** is in `schema.sql`'s timer section with every
  other schedule: `doji-eugenia-calendar` calling `?calendar=1`, off the hour and
  clear of the briefing.
- **The webhook must allow `callback_query`**: re-register with
  `allowed_updates = ["message", "callback_query"]`, or the taps under a
  briefing are never delivered.
- **The optional secrets.** Unset, each capability is simply absent — she says
  she cannot hear, the text goes, the search is lexical:

  ```sh
  supabase secrets set STT_KEY=<key> STT_URL=https://api.openai.com/v1/audio/transcriptions
  supabase secrets set STT_MODEL=whisper-1     # optional, the default
  supabase secrets set TTS_KEY=<key>
  supabase secrets set EMBED_KEY=<key>
  supabase secrets set EUGENIA_CHARM_SECRET=$(openssl rand -hex 32)   # her charm, which needs STT and TTS
  supabase secrets set GLADYS_CHARM_SECRET=$(openssl rand -hex 32)    # Gladys's charm
  ```

**Two backfills, each a door called by hand.** Semantic search changes nothing
until `EMBED_KEY` is set (`EMBED_URL` is optional and defaults to the vendor's
embeddings endpoint); then fill the archive, calling until both tables report
`left: 0`:

```sh
curl -s "https://<project>.supabase.co/functions/v1/doji-eugenia?embed=1" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
```

Each call fills fifty rows per table, newest first — a backlog drained oldest
first returns last month before last week — and answers
`{"notes":{"filled":…,"left":…},"turns":{…}}`. **It says why when it fills
nothing**: `embed()` throws with the vendor's own body, since a missing credit, a
key without permission and a mistyped secret are three repairs; the write paths
swallow the same throw, so a vendor failure never costs a note or a turn. No
cron job calls it: the nightly pass sweeps what a failed vendor call leaves, and
writes a `caller: 'embeddings'` row either way. `sweepLine` parts the three
states — a refusing vendor arrives as its own message, *nothing filled with a
backlog waiting* means the key is unset, and a drained archive (`0 filled, 0
left`) accuses nobody. `verify.sql` ends with the count still unembedded, which
should fall to zero and stay there.

R-14 is `unknown` on every trade until a week is marked in `calendar_weeks`, and
a release carries its series `ticker` only once filed, so walk the history door
once from a year back, or from his first trade if that is earlier (`select
min(open_day) from trades`):

```sql
select net.http_get(
  url := 'https://<project>.supabase.co/functions/v1/doji-eugenia?history=2026-01-05',
  headers := jsonb_build_object('x-doji-key',
    (select decrypted_secret from vault.decrypted_secrets where name = 'doji_cron_secret')),
  timeout_milliseconds := 10000
) as request_id;
```

Each week lands as a `calendar week` row in `eugenia_runs`; a longer history, or
a walk stopped by two refusals, is a second run from the week its last row names.

### Programmatic tool calls need their container

`web_search` (type `web_search_20260209`) does dynamic filtering by running code on Anthropic's side,
and from inside that container the model can call `get_trades` programmatically.
A continuation answering those calls must carry the container id from the paused
response, or it is rejected:

```
container_id is required when there are pending tool uses generated by
code execution with tools
```

Three rules, all of which must stay met: the container id rides on the request as
a bare string (the response nests it under `container.id`), the user message
answering the calls carries **only** `tool_result` blocks, and the `tools` array is
identical on every request of the turn. Neither tool may declare `strict: true`;
`tradesQuery` clamps `days` and `writeNote` coerces `note` as boundaries anyway.

### The rest of the wiring

**A reply is answered after the response.** Telegram waits about a minute for a
webhook and then redelivers, which would run a briefing twice and bill for both.
The function returns 200 at once and hands the work to `EdgeRuntime.waitUntil`.

**Twelve turns of memory**, repaired on the way out. The Messages API refuses a
leading assistant turn, and the refusal is total until the row rolls out of the
window. Pairs are written in one `INSERT`, but a concurrent one can take a
sequence value between them — two messages seconds apart interleave as
`u₁ u₂ a₁ a₂` — so `openOnUser` drops leading assistant turns, and `HISTORY` may
be any number. Both tables have RLS on and no policy, denying the publishable key.

**A long message is split.** Telegram's cap is 4,096 characters, so `chunk()`
splits on a blank line, then any newline, and hard-cuts only a paragraph itself
over the limit — two lookups, not a `Math.max` over them, since every blank line
contains a newline at a higher index. Parts go sequentially; Telegram does not
promise ordering.

**A refusal does not cost the briefing.** The request carries `fallbacks:
"default"`, which re-runs a declined request on another model inside the same
call; a decline before any output is not billed, and `stop_reason === "refusal"`
now means the whole chain declined. **A fallback says so**: `ask()` compares each
response's `model` with what the caller asked for and appends `FELL BACK TO
<model>` for the turn, and the row records it. `fallbacks` rides with Opus alone,
header and field together, since whether Sonnet accepts it is unestablished and a
refusal would be a 400 on every call.

**Two other stop reasons carry text that is not the answer.** `pause_turn` is the
server's search loop stopping mid-turn; it is resumed by sending the paused
response back, and counts as a round. `max_tokens` is an answer cut off; it
throws, so the retry, a gate's draft or the apology runs, and the row says `cut
off at max_tokens`.

**She is told what time it is**, in one place: `ask()` attaches the New York date
and time to the turn being asked, and the prompt tells her to trust it over a
conversation whose latest long turn is a morning briefing. Each past user turn
carries the New York day it happened on, so "yesterday you said" is not a guess
across a weekend; her own words go back unprefixed.

**A slash command costs no model call**: `/notes` and `/channel` are answered
from the database, and anything else is addressed to Telegram, not to her. **Effort is per caller**: the briefing and the nightly pass run
`high`, a reply `medium`, nothing `low` — a careless read of his
discipline is worse than a slow one. **The typing indicator repeats** while she
works, since Telegram's lasts five seconds.

**`MAX_ROUNDS` is ten, a backstop.** The failure it guards against is a loop
billing for ever; the one it can cause is a message that never arrives.
`eugenia_runs.rounds` shows how close each caller runs, and a successful turn's
`detail` says what the rounds were spent on — `check_rules×4, get_market×1` —
since a name that cannot match, a tool called one per round and a model that
will not batch are different repairs.

**`TURN_MS` is its twin for time: 300s, the share `pace_line` warns at.** Every
request in a turn carries one `AbortSignal`, so a model that never answers throws
inside the worker — the failed row is filed and the apology goes, as for any
other failure — instead of holding the turn until the platform kills the worker
at 400s, where nothing runs. One budget for the whole turn, because ten rounds
each under a per-request bound could still outlive the worker together. It is
measured on the clock `eugenia_runs.ms` records, so the longest successful row
per caller says how much room there is.

**The writing worker has one clock, and each step is handed what is left of
it.** The briefing runs its reads, the draft and the critic in a row, and each
inside its own bound summed past the wall: on 8 October, 50s of reads against a
dead feed, a 247s draft that searched seven times because the feed was dead,
and the critic — 336s. So **`WRITER_MS`**, 370 seconds from the moment the
worker opens, is the budget: the draft gets the lesser of `TURN_MS` and what is
left, the critic what remains after it, and the fallback voice the same. A
critic out of time fails like any other, and `gate` sends the draft. The thirty
seconds under the wall are storing, the hand-off and the row.

**What she costs, measured.** The week to 2026-10-08 came to **$17.52, about $76 a
month**, on Opus 5 and Sonnet 5. The same tokens at the 5.5 rates come to $13.86,
about $60:

| | $/wk | share |
|---|---|---|
| cache writes | **$11.06** | 63% |
| output | $2.79 | 16% |
| fresh input | $1.92 | 11% |
| cache reads | $1.37 | 8% |
| web search | $0.35 | 2% |

**The cache is the bill**: every turn that starts cold writes her whole prompt
again. Per caller:

| caller | turns | $/wk | at 5.5 rates |
|---|---|---|---|
| reply | 18 | **$3.85** | $2.99 |
| weekday briefing | 5 | $2.69 | $2.04 |
| release look | 4 | $2.07 | $1.53 |
| consolidation | 7 | $1.95 | $1.51 |
| trim | 24 | $1.69 | $1.68 |
| pulse | 5 | $1.63 | $1.25 |
| move look | 4 | $1.57 | $1.21 |
| critic | 6 | $1.27 | $1.02 |
| trade look | 2 | $0.50 | $0.39 |
| Sunday briefing | 1 | $0.30 | $0.24 |

**Both tiers are on 5.5** (`claude-opus-5-5`, `claude-sonnet-5-5`): the same
tiers, Opus a fifth cheaper on input, output and writes, and a cache read down to
a twentieth of the input rate on both.

**A cheaper caller that does not answer is not cheaper.** In September three
callers were moved to Sonnet, and the release look, since retired, then died at
`MAX_ROUNDS` twice in its first half hour — but a tool for filing a print had
joined it eighty minutes earlier, and with the model reverted its rounds stayed
at seven to ten where they had been two or three. The pair is confounded, so it
establishes nothing about the model. The cause turned up in the first tally: six
calls to that tool in seven rounds, every one refused by a filter that wrapped
the name in quotes PostgREST compared as part of it. What stands is the policy: a move is one caller at a time
with `rounds` read afterwards. **Only `trim` runs on Sonnet**: it is handed
`CRITIC_TOOLS`, which is empty — one request, no loop to run out of. The critic
stays on Opus: about $2 a month saved, against the last gate on exactly what he
said read badly. `MODELS` is keyed on the caller's label, the string
`eugenia_runs.caller` records, and absent means Opus.

**The cache window is derived from the tool array.** A cache read is a twentieth
of the input rate; a write is 1.25× at five minutes and **2× at an hour**, so the hour
pays once about two turns in five arrive inside it, sparing the rewrites the five
minutes would have paid for. The tool array is where the cache key starts, so
each tool set is its own prefix — and the week of 2026-09-10's `wrote_1h`
answered *is a second turn likely inside the hour* per array:

| caller | turns | prefixes written | inherited one |
|---|---|---|---|
| release look | 14 | 5 | **9** |
| weekday briefing | 5 | 5 | 0 |
| pulse | 5 | 5 | 0 |
| critic | 6 | 6 | 0 |
| consolidation | 6 | 5 | 0 |
| move look | 2 | 2 | 0 |
| reply | 1 | 1 | 0 |
| Sunday briefing | 1 | 1 | 0 |

(Consolidation's sixth turn is the row for a turn that failed before the model
answered.) That week only the release look's array earned the hour, because its
quarter-hourly job clustered several looks into one morning. One reply could not
say how replies arrive. The week to 2026-10-08 had eighteen: fourteen within an
hour of the turn before them, six within five minutes — so eight a week wrote
again a prefix the hour would still have held, and `CHAT_TOOLS` takes the hour.
The weekday briefing shares that array but not its effort, so it reads nothing
the replies wrote and pays 2× for its own write; the replies more than cover it.
So it is `1h` for `CHAT_TOOLS` and `5m` for the rest. `cached` counts
reads; `wrote_1h` and `wrote_5m` count writes, kept apart because their rates
differ.

**Inside a turn the conversation is cached too, at five minutes.** The loop marks
the newest `tool_result` block, and the mark *moves* rather than accumulating — a
request may carry four breakpoints and the system block holds one. The longer TTL
comes first in the request, as `system` renders ahead of `messages`.

**The critic is handed an empty tool array, the cheaper option as well as the
stricter.** Sharing the briefing's array was tried and measured: the critic
wrote 23,309 tokens and read none, because it also differs in effort, which
invalidates the tools and system caches. `REFACTOR.md` R-15 has the figures.

### What she is watching, on the dashboard

Three things are worth a glance on the screen he opens every morning — what lands
today, the story she is carrying, what is still open — and none is private to
her. **Not her notes or turns**: those stay denied to the publishable key, and his
window into them is `/notes`. The three tables the card reads carry no `user_id`,
so `using (true)` for `authenticated` is the honest policy; a test asserts the
card reads only those three and that `schema.sql` opens nothing on the other two.

**The calendar on it is the US releases alone**: what is filed from abroad is
context for her, and a night of European and Asian rows would push the morning's
prints out of the card's twenty.

**One read, after the render.** A failure — her tables not applied, a missing policy,
no network — hides the card and touches nothing else, and is logged:
`supabase-js` resolves a failed read as `{ data: null, error }`, so `data || []`
would turn a missing table into an empty calendar. **An empty answer is only an
answer when something was read.**

### What she will not do, and what she may

In the prompt rather than left to taste: **no signals** — no entry, no level to
buy or sell at, no stop, no target, nothing about what to do with a position —
and never more than one question at a time. No instruction note can widen that;
one that narrows it is obeyed.

**Most of what she says is what the market is pricing.** *"A December cut is
about 70% priced"* is a fact about today; saying it is most of what stops a
briefing reading like a wire feed.

**She may give her read, fenced three ways**: said as *her read*, with what would
prove her wrong in the same breath, and with no level in it — a read with a price
in it is a signal. One per message, in the briefing or a conversation; the trade
event carries none, landing at a moment she did not choose.
**None at all while you are in a position**, where a view on price is advice about
the trade. Both gates carry the same fence and are handed what you have on.

**A level price has already printed is a fact** — today's high and low, the
previous close, where a release moved gold from and to — and checkable against
your chart. A level attached to what comes next stays out, and so does any printed
level in the paragraph holding her read: a level beside a direction is an entry
with *buy* left out.

**She checks a plan you have not taken, when you ask, against your rules**: the
stop and target distances (R-01, R-02), reward against risk at entry against R-08's
1:1.5, a high-rated US release inside R-14's thirty minutes, whether the day already
rules out an entry (R-03, R-11, R-12, R-16), something already open (R-10), the
Friday close (R-15). Whether the setup is the right kind of level is judgment and
stays yours. **The levels stay yours**: she never suggests a different entry, stop
or target, never says whether to take it, and never turns "the ratio is 1:1.1"
into the target that would fix it; `TRIM` removes a level she offers in place of
yours. Both this and the printed level were your decision when the no-signal rule
was put to you: the rule stays, and these are what a coach does inside it.

**She judges trades — the decision, never the result** — against your rules and the
plan you entered with. A loss inside your rules was a good trade; a win that broke
one was a bad trade that paid. Blunt, once, about the trade rather than about you.
**Never the fact alone**: the verdict is not optional, and the critic adds a
missing one and may not cut it for length. A trade still open gets no verdict.

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
| `Login` | session gate |
| `Carousel` | mobile swipe position and dots |

`render()` is the orchestrator and draws nothing itself. Each step runs in its own
catch, so one widget can degrade without blanking the panel.

### Palette

Every colour is a CSS custom property on `:root`. Nothing in the app writes a
literal — Chart.js cannot read a variable, so what it needs is resolved once
through `cssToken()` into a module constant.

| Token | Value | Used for |
|---|---|---|
| `--p` | `#8b35b8` | the accent. Selected states, focus, the sync dot |
| `--bg` | `#070611` | page background — near-black with a faint purple hue |
| `--s2` | `#141022` | the layer above the page |
| `--glass` | `#0a0813` | card surfaces. Solid, not translucent |
| `--cell-bg` | `rgba(8,8,10,.55)` | a calendar day with no result, so it recedes |
| `--bd` / `--bd2` | `#251d39` / `#342948` | borders, dim and dimmer |
| `--tx` | `#e8e6f0` | body text |
| `--mt` / `--mt2` | `#6f6788` / `#9a92b0` | muted, and muted-but-readable |
| `--tx-hi` / `--tx-max` | `#f0eeff` / `#fff` | on an accent fill, and on solid `--p` |
| `--win` | `#3ba585` | a winning trade |
| `--loss` | `#d63d5a` | a losing trade |
| `--warn` | `#d9a441` | "notice this", one step short of `--loss`. Only the offline sync dot |
| `--be-tx` | `#9aa4c0` | break-even text — cool, because a break-even is a result |
| `--seg-be-bg` / `--seg-be-bd` | `#0e1020` / `#333f63` | break-even fill and border |

**Results have a house treatment**: a flat 12% fill against a full-strength
border — `--seg-win-bg` and `--seg-loss-bg` are `--win` and `--loss` at `.12`, the
hover pair `--seg-win-hv` / `--seg-loss-hv` at `.22`. Break-even is a solid colour
instead, because a translucent fill hazes on a 58px calendar cell, and the darkest
of the three because nothing happened; its green runs at or above its red so a
small tile reads cool rather than mauve.

**Neutral surfaces come from seven alphas of white**: `--fill-0` (`.02`) through
`--fill-3` (`.08`), plus `--row-hv` (`.03`), `--hair-2` (`.07`) and `--bd-hi`
(`.30`). The accent has the same ladder — `--p-gl` at `.07` through `--p-gl4` at
`.42`, and `--p-hair` at `.04`. **Type** is `--ui` and `--mono`. **Radii** are
`--r-sm` 10px, `--r-md` 14px, `--r-lg` 18px, `--r-full`, and `--r-cell` 5px for
calendar tiles, which at the card radius each read as their own card.

### The shared primitives

Every wheel and every bar is built from one of these, which is what keeps the
panels in visual agreement:

- `wheelBlock(key, strip, cls)` — the markup for any result wheel
- `paintWheel(key, counts)` — the figures and arcs for one, from a `counts()`
- `mountDonut(canvasId, [w, l, be])` — the wheel itself; updates in place if it already exists
- `pctStrip(pctSplit([w, l, be]))` / `moneyStrip(key)` — the figures under a wheel
- `sessionBars(list)` — win/loss distribution, `.sess-wr-*`
- `disciplineBar(label, followed, n)` — every compliance bar
- `rrBar(list)` — the realised R:R bar above each wheel, same head and track
- `rollRow(label, cur, prev)` — every roll-forward row
- `--bar-h` — bar thickness
- `DONUT_CUTOUT`, `RESULT_FILL`, `RESULT_BORDER` — wheel geometry and palette

Each wheel row's **shell is emitted once** and only its figures are repainted,
which lets `mountDonut` update a Chart rather than rebuild every one each render.
`font-family:var(--mono)` is one grouped rule, and every colour in the sheet is a
token. **A row with no data is a dim placeholder, never a missing row**: these
blocks are `flex:1` with `space-between`, so a dropped row stretches the rest.

**A calendar cell carries two readings in one colour.** The **hue** is the result;
the **strength of the fill** is the day's `|net|` against the largest **in the
month on show**, floored so the quietest day is still coloured — one property,
`--hm-i`, mixed in CSS. Break-even is not scaled: there is no size to show. Today
is marked on the day **number**, because purple already means unfinished. The
**dashed border** on the week rail says derived rather than recorded, which is
also why it carries no `--sh-2`.

### Sync model

Supabase is the data. There is no local write path, so no shadow, cursor,
tombstone or conflict rule — a save is one `UPDATE`, and the next read returns
what the database holds. The snapshot in `localStorage` is a **read cache** and
never anything else: painted on open, never written back.

Realtime is the fast path; the refresh is the floor under it. A phone that
backgrounds its tab kills the socket and nothing replays what was missed, so the
app re-reads on foreground, on reconnect and on a slow timer. A refresh while a
modal is open is held and flushed when it closes, rather than replacing the
rendered set under half-typed input.

---

## Deployment

**`index.html` is served by Vercel from `main`, and the Edge Functions follow the
same rule.** `.github/workflows/deploy-functions.yml` runs `supabase functions
deploy` on any push to `main` touching `supabase/functions/**` or
`supabase/config.toml`, with one repository secret, `SUPABASE_ACCESS_TOKEN`. All
five functions go every run, so none drifts from the others; `adherence.ts`,
`prompt.ts`, `strategy.ts` and `journal.ts` ship inside `doji-eugenia`.
`verify_jwt` lives in `config.toml`, so the committed file is the whole
description of how a function is deployed. A hand-pasted function can differ from
the committed one with nothing to reveal it — never deploy from the dashboard.

**`npm test` runs first, in the same job, and a red suite stops the deploy.**
`test.yml` runs on every push too, but as a separate workflow it would go red
beside a deploy that shipped anyway. The suite also imports `_shared/` by the
path the functions use, so a broken extraction fails the job.

**`supabase/functions/_shared/edge.ts` holds one definition of each primitive** —
`env`, `secretMatches`, `json`, `sbHeaders`, `mcpInit`, `parseSse`, `telegram`,
`nyDate`, `nyClock`, `marketOpen`, `heartbeat` — and the test for extracting
one is **"are there two copies nothing can compare"**. `secretMatches` is why:
it exists to be *constant-time*, and a copy rewritten to `presented ===
expected` answers every behavioural test while leaking the secret through timing,
so `agree.test.mjs` reads its body. Configuration is an argument rather than a
capture, so each bot binds its own token in one line, and `sbHeaders(prefer?)`
names the `Prefer` at the call site. `nyDate` (which civil day) and `nyClock`
(which weekday and hour) answer separate questions; Gladys's `nyTime` is a
display format with one caller.

**The entry point is deliberately not shared.** All five authorise their callers
in the same four lines — refuse if a secret is unset, match one, match the other,
401 — and that is the one check worth reading in the file being read.

**Two things are deliberately manual.** The SQL is run knowingly in the SQL
editor: `supabase/schema.sql` is not under `supabase/migrations/`, so nothing
applies it because a file was committed. The Apps Script is deployed from its
own editor.

**The editor reads the words, not the language, so no file says `select …
into`.** It takes `select … into worst` inside plpgsql for `create table worst`,
and its *run with RLS* button appends `alter table worst enable row level
security` to the paste — a table that does not exist, so the whole paste rolls
back. Every function reads into a variable as `x := (select …)`, and
`agree.test.mjs` refuses the other form. **Check the paste ends where the file
does**: a paste cut partway fails as `unterminated dollar-quoted string`, which
reads like a fault in the file.

**Applied by hand, `schema.sql` is a claim, and `supabase/verify.sql` tests it.**
It writes nothing; run it after any manual change. CI runs it too, against a
fresh build behind stand-ins, which proves the two files agree — only a run in
the SQL editor proves the live database does.

**`schema.sql` is the whole database, and it is applied by running all of it
again.** Every statement is `if not exists`, `or replace`, `on conflict do
nothing` or guarded by a check, so a fresh project and the live one both end up
matching the file, and a change is an edit to the file followed by a re-run.
`agree.test.mjs` holds that shape. Two constraints come from Postgres itself:
`create or replace view` may only append a column, so the view's list is in the
order columns were added, and `create or replace function` cannot change an
argument list or a return type.

**What a re-run cannot change goes in `upgrade.sql`, run by hand before it.** A
`drop` is never written into `schema.sql`, because a re-run would repeat it on
the live database — so what the file stops declaring stays there, as does a
constraint written inside `create table if not exists`. `upgrade.sql` removes
or rewrites it, every statement guarded so a second run changes nothing. `npm
run test:db` proves both files: a second run changes nothing, and main's copy
brought forward by `upgrade.sql` and then this one leaves what a fresh apply
leaves.

**The schedules re-run like everything else**: `cron.schedule` upserts on the
job name, so a re-run makes the jobs match the file. Six jobs —
`select jobname, schedule, active from cron.job order by jobname` reads them back:

| Job | Schedule | What it drives |
|---|---|---|
| `doji-mcp-sync` | `*/2 * * * *` | the poller |
| `doji-eugenia` | `0 * * * *` | the briefing and the nightly pass — the function decides which, or neither |
| `doji-eugenia-calendar` | `5,20,35,50 * * * *` | the calendar's filing |
| `doji-dispatch-watch` | `*/10 * * * *` | `dispatch_watch`'s sweep |
| `doji-pace-watch` | `37 * * * *` | `pace_watch`'s one-a-day warning |
| `purge-cron-history` | `0 3 * * *` | trims `cron.job_run_details` |

Only the first four call a function; the two watchers post to Telegram
themselves, which keeps a watchdog off the thing it watches. `verify.sql` counts
the jobs, and `agree.test.mjs` holds that count against `schema.sql`.

---

## Setup from scratch

1. Put the project URL and publishable key in `SUPABASE` in `index.html`.
2. Let the deploy workflow ship the functions (see **Deployment**), and set
   `CTRADER_MCP_TOKEN`, `DOJI_USER_ID` and **`SB_SECRET_KEY`** in Edge Function
   secrets. `SB_SECRET_KEY` holds an `sb_secret_` key; Supabase owns the
   `SUPABASE_` prefix, so a secret cannot be created under it and a function
   reading `SUPABASE_SECRET_KEY` gets `""`. Unset, every function answers 503.
3. **Generate one cron secret and store it twice**: `DOJI_CRON_SECRET` in Edge
   Function secrets, which the functions check, and `doji_cron_secret` in Vault,
   which the cron jobs and triggers present. Postgres compares the Vault name
   case-sensitively, so a wrong spelling is a trigger that gives up silently.
4. Deploy the Apps Script. Generate a second secret, `DOJI_EMAIL_SECRET`, and
   store it in Edge Function secrets and in the script's Script Properties —
   never in the file. It is separate from the cron secret because it is the only
   one living outside your own infrastructure, so it opens the narrowest door
   there is. Run `testParse`, then `testSecret`, then trigger `syncPepperstone`
   every minute.
5. For Gladys: create the bot with BotFather and send it `/start`, set
   `GLADYS_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `GLADYS_WEBHOOK_SECRET`, and point
   Telegram at her function:

   ```
   POST https://api.telegram.org/bot<token>/setWebhook
        url=https://<project>.supabase.co/functions/v1/doji-gladys
        secret_token=<GLADYS_WEBHOOK_SECRET>
        allowed_updates=["callback_query"]
   ```

6. For Eugenia: a second bot, `/start` it, and set `EUGENIA_BOT_TOKEN`,
   `EUGENIA_WEBHOOK_SECRET` and `ANTHROPIC_API_KEY`. Point Telegram at
   `/functions/v1/doji-eugenia` with that secret and `allowed_updates=["message",
   "callback_query"]` — both, or the taps under a briefing are never delivered.
   **Set a spend cap on the API key**: it is the only enforceable bound on what
   she can cost. Store `eugenia_bot_token` and `telegram_chat_id` in Vault too,
   lower-case — the watchers post to Telegram themselves.
7. Run `supabase/schema.sql` in the SQL editor — last, because its triggers and
   schedules call the functions and secrets above from the moment it lands.
   Connect TradingView (see **TradingView**), then walk the history door once
   from a year back — see **Applying her schema**.
8. Run `supabase/verify.sql`. Nothing is set up until it agrees.

---

## Tests

```sh
npm ci               # once — jsdom and typescript, and nothing else
npm test
npm run test:db      # schema.sql on a real Postgres — see below
```

Node 22.22.2 or newer — jsdom's floor — stated in `package.json`'s `engines` and
enforced by `engine-strict=true` in `.npmrc`, so `npm ci` refuses below it and a
green CI run proves the runner's Node. `--experimental-strip-types` lets the
suite import the Edge Functions' `.ts` directly. `jsdom` and `typescript` are the
only dependencies, both dev; the app installs nothing. **`typescript` is never a
build step**: `test/types.test.mjs` uses it to ask two scope questions of the
Edge Functions and of the app's inline script.

**`package-lock.json` is committed and CI runs `npm ci`**, so the tree that goes
green is the tree everyone gets — and the same suite gates the function deploy.
The suites run on every push through `.github/workflows/test.yml`. The script
globs `test/*.test.mjs` one level deep, so a test in a subfolder would silently
not run — `test/db` is the one subfolder, on purpose, with its own command and
its own CI job, and `agree.test.mjs` holds that both still name it.

**`npm run test:db` needs a Postgres server with pgvector, of the major version
Supabase runs** — named once, in `test.yml`'s `PGCLUSTER`, and asserted by the
suite, so a Supabase upgrade is that one value changed — reached through the
standard `PG*` variables as a superuser, so `npm test` keeps needing
Node alone. It builds a throwaway database from `test/db/supabase.sql` — stand-ins
for `auth`, `vault`, `pg_net`, `pg_cron` and the API roles, which record rather
than send — and `schema.sql`. Text cannot see what it sees: Postgres resolves a
PL/pgSQL body only on its first call, inside the write that fired it, so a
one-letter typo in a trigger passes every other suite and fails every insert.
In CI, the job installs that version and pgvector from PostgreSQL's own
repository, since the runner carries an older one.

**Every `uses:` in the workflows names a commit, never a tag.** A tag can be
repointed between runs, so the action audited is not the action that runs;
`supabase/setup-cli@v1` was a *branch*, in the job holding
`SUPABASE_ACCESS_TOKEN`. Credentials are step-scoped, so what an action reaches
is the toolchain — `setup-node` provides the `node` that reads `SB_SECRET_KEY` a
step later. `.github/dependabot.yml` bumps the SHA and the `# v7.0.1` beside it
monthly, and `agree.test.mjs` asserts the SHA.

**The `no-cache` header in `vercel.json` names both `/` and `/index.html`**: the
home-screen shortcut and every bookmark open `/`.

| File | Covers |
|---|---|
| `test/fold.test.mjs` | the pure logic of all five Edge Functions, `_shared` and `adherence.ts`: a real `get_deals` capture folded and cross-checked against the real email for the trade they share; the poller's fold, windows, balance and plan rules; the email boundary and its three outcomes; Gladys's grammar, rendering and settling, with the two redraws agreeing on every before-state; Eugenia's schedules walked hour by hour, her renderings, gates, voice fallback and tool loop driven through `ask()`; every one of the thirteen rules in both directions; and the TradingView sign-in and folds |
| `test/app.test.mjs` | `index.html` in jsdom against a recording Supabase stand-in: completeness, load, save and soft delete, the scratch rule and aggregates, the money split and averages, the week boundary, sessions, the indexes, every render step, the three-state answer in every surface that reads it, the charts' inputs, the snapshot, the offline boot, and the watch card |
| `test/golden.test.mjs` | the snapshot: the real page on fixed fixtures and a frozen clock, every derived value and every panel's markup compared against `test/golden.json`, plus `Dates.session` swept across the four DST changeovers; and `test/golden-fold.json`, everything the folds return off the real captures — the rows the poller writes through its two windows, the email parsed and bounded, the calendar folded, and Eugenia's rule verdicts, day standings and stats over that week, with what she is told about each. Regenerate with `GOLDEN=write npm test`, deliberately, in the commit that changes behaviour — never to make a red run go away |
| `test/serve.test.mjs` | the five request handlers themselves, captured off a stub `Deno.serve` in a process of their own: every door refuses an unloaded secret with a 503 and a wrong key with a 401 before making any request; the email path's write, its three outcomes and the heartbeat on each, the probe left unmarked; Gladys's halves kept apart and a foreign chat refused; the poller's weekend skip marked; TradingView's public paths; Eugenia answering a message, a trade event and the hour before the work, with the work kept; and the charm driven end to end through the real turn — silence first, her gated answer read as `pcm` in every part, the copy in Telegram, the exchange stored, a wordless recording answered on the charm alone, and the door refusing a missing vendor, an empty recording and a wrong key; and the briefing on the charm, her ready line then today's briefing read as `pcm`, the right day's briefing asked for, a `204` while none is stored; and Gladys's charm told what waits oldest first and a week back, its answer writing exactly one of the four columns, an edit, a stray column and a malformed body refused, and the door shut without its secret |
| `test/agree.test.mjs` | every fact in **Facts that live in more than one file**, read out of each file that holds a copy; the call sites no test can drive, read from source; and the censuses — every path that sends, every growing read, every flag, every tool, every poller return — derived from the code and held against a declaration |
| `test/types.test.mjs` | a name used and declared nowhere, and a name declared and used nowhere, in the Edge Functions and the app as two programs — with one planted defect per question proving the check can fail |
| `test/parse.test.mjs` | the Apps Script: `parseAlert_` against a real saved alert and variants in its shape, and `syncPepperstone`'s three outcomes |
| `test/boot.mjs` | the harness: boots `index.html` in jsdom with the CDN libraries stubbed |
| `test/gs.mjs` | the harness: evaluates `doji_gmail_sync.gs` with the four Google globals stubbed to record |
| `test/db/schema.test.mjs` | `schema.sql` applied to a real Postgres: a re-run changes nothing, and main's copy brought forward by `upgrade.sql` and then this one leaves what a fresh apply leaves, as `upgrade.sql` run twice over a fresh apply does; `verify.sql` passes against what it builds; the trades triggers fire on what they should and nothing else, and a missing secret costs the message, never the write; the app's grants and RLS; the README's restore run over a backup's rows; the calendar's clock; both watchers driven from planted rows; her search by words, spelling and vector; every scheduled job's command run once; and a census that every PL/pgSQL function was driven |
| `test/db/supabase.sql` | the stand-ins: what Supabase provides, as far as `schema.sql` reaches it |
| `supabase/verify.sql` | not a suite: run by hand against the live database, one statement, one row per fact. Nothing in it may raise on a wrong database — functions are asked by oid, tables through `query_to_xml` |

**What is not covered.** Pixels — correct HTML under broken CSS passes. Realtime
and the auth server, since Supabase is a stand-in. Anything whose first line is the network — the MCP transport,
the upserts, the Telegram sends, the model call — is tested for what it decides,
and through the doors `serve.test.mjs` drives, for what it sends; where a
decision lives deeper than a test can reach, `agree.test.mjs` reads its source.
Gmail itself, behind the Apps Script stubs. What Supabase's own `pg_net`,
`pg_cron` and Vault do, behind `test/db`'s stand-ins.

**Both broker paths are anchored to what the broker sent, and the anchors
overlap.** `fixtures/ctrader-get-deals.txt` is a real `?raw=1` capture and
`fixtures/ctrader-stop-loss-filled.html` a real alert, and **position 577885869
is in both** — so the fold's direction, exit, `computed_pnl` and close instant
are checked against an independent record rather than its own arithmetic. A
fresh `?raw=1` replaces the fixture when cTrader changes.

**A check you have not proved can fail is not a check.** Every test here was run
against a deliberately broken copy of what it covers before it was believed, and
several turned out unable to fail until they were rewritten — a call site that
could be deleted with the suite green, a credential check asking a stub rather
than the file, a boot-guard check passing `if (false)`, a keyboard test typing
the payloads it should have taken off the buttons. Do the same to any check you
add.

---

## Known rough edges

**The email variants are built, not saved.** The parser is held to a real alert;
a buy, a thousands separator, a missing figure and an unreadable time exist in no
saved message, so they are built in its shape, and one test holds the builder
against the real body. The email path and the poller are the two pieces that
could lose data quietly, and the daily backup is the floor under both.

**The Supabase client carries no SRI hash**, unlike Chart.js. It is
pinned to an exact version, which closes the drift; the hash would have to be
recomputed on every bump and a forgotten one fails closed with no message. To add
one, compute it from the npm tarball the CDN mirrors:

```sh
curl -s https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-<ver>.tgz \
  | tar -xzO package/dist/umd/supabase.js \
  | openssl dgst -sha512 -binary | openssl base64 -A
```

**Three capabilities need a vendor Anthropic does not serve** — hearing
(`STT_URL`/`STT_KEY`), speaking (`TTS_URL`/`TTS_KEY`) and semantic search
(`EMBED_KEY`) — each written against a shape rather than a provider, each unset a
supported state. **They are the only path by which his own words leave his own
infrastructure**: the audio he sends, the text she answers, every note and turn.
All three have run against the live account: the backfill embedded the whole
archive (its first attempt named `insufficient_quota` once the door was made to
say why), and a voice note came back as a playable voice bubble.

**`web_fetch` grounds a number she was not handed** — a page a search turned up,
since it fetches only URLs already in the conversation. Never gold's price or the
market lines, which are handed to her: a second copy off a page is a second
number that disagrees with his screen. It is bounded by `max_uses` and by
`max_content_tokens`, since one long page could outweigh the briefing. A page
that refuses bots degrades to search, with no sign the figure came from prose.

**The session seam.** A fill the poller never reached has no `entry_time`, so its
session derives from the close. `get_stats` counts these rows and says so above
the split. A wide `?force=1` repairs them for good.

**R:R on the dashboard is realised, not planned** — average win over average loss
per window. The plan is recorded only for positions the poller saw open, as
first seen; for the rest the broker's final stop has overwritten it. Never infer
what a planned R:R was; ask.

**The four calling pg_cron jobs hold no database power.** Each presents the cron
secret read from Vault at call time; the service key lives in the functions'
secrets and never in a job. The housekeeping job is a DELETE on pg_cron's own
history and nothing else. The `trades` triggers are `security definer` and build
one `net.http_post` each.

**What `DOJI_CRON_SECRET` can cause differs per door:**

| Function | What a holder of the secret can do |
|---|---|
| `doji-mcp-sync` | start a read-only poll that was going to run anyway, or read back the deals (`?raw=1`), the broker's tool list (`?tools=1`), the open positions (`?positions=1`), a price (`?market=1`) or minute bars (`?bars=raw`). Nothing that places, moves or closes a trade is reachable — see `ALLOWED_TOOLS` |
| `doji-eugenia` | `?force=1` — run a briefing, about $0.20, with no bound in the code. `?consolidate=1` is the one that does more than spend: it runs the nightly pass, which WRITES memory — notes written and superseded, channel rungs moved, loops closed. `?embed=1` spends at the embedding vendor. `?calendar=1` files the calendar and spends nothing, and a `{trade}` body reaches the trade look |
| `doji-gladys` | post arbitrary text into the trader's own Telegram thread |

Neither of the last two can reach a column. The value sits in Vault and in
function secrets and crosses no untrusted channel; the one enforceable bound is
the spend cap on the Anthropic key. `DOJI_EMAIL_SECRET` is deliberately a
different secret: it lives in Google's infrastructure and opens five columns of
one table.

**One value, two stores, two spellings**: the functions read `DOJI_CRON_SECRET`,
the database reads `doji_cron_secret` from Vault — the four calling jobs and the
two trigger functions that present it, `trades_telegram` and
`trades_eugenia_on_event`. `verify.sql` asks for all six.
