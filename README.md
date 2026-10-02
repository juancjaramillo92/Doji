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
largest of the three and is needed only there. All three come from jsDelivr,
pinned to an exact version — Chart.js and SheetJS with an SRI hash beside the
pin, the Supabase client deliberately without one, for the reason given where
the tag is.

**Two typefaces load from Google Fonts** — Hanken Grotesk for the interface and
JetBrains Mono for every figure — which is the fourth and fifth external host
the page reaches, and the only ones that are not a library. Both `--ui` and
`--mono` carry a full system fallback stack, so a network that blocks Google
Fonts costs the typeface and nothing else: the app opens, draws and saves
exactly as before, in the platform's own faces.

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
README.md                               the contract: what the app does and why
CLAUDE.md                               how to work on it; the README outranks it
REFACTOR.md                             every move refused, and why
index.html                              the entire application
icon-512.png                            home-screen icon
vercel.json                             no-cache header for the app shell
supabase/config.toml                    Edge Function deploy settings
supabase/001_trades.sql                 the schema
supabase/002_gladys.sql                 Gladys's trade-open trigger
supabase/003_eugenia.sql                Eugenia's tables, her view of the journal
supabase/004_cron.sql                   every scheduled job
supabase/005_eugenia_senses.sql         Eugenia's meters, her calendar, her senses
supabase/006_plan.sql                   where a trade was aimed, off the open position
supabase/007_semantic.sql               her memory searchable by meaning
supabase/008_sync_health.sql            the heartbeat the two silent writers mark
supabase/009_dispatch.sql               what pg_net sent, and what came back
supabase/010_pace.sql                   how much of its clock a briefing spends
supabase/011_trades_grants.sql          which columns the app may write
supabase/012_excursion.sql              how far a trade ran in his favour
supabase/014_stops.sql                  every stop and target a position carried, which R-19 reads
supabase/015_commitments.sql            what he committed to, as a third kind of note
supabase/016_tradingview.sql            the TradingView sign-in, one row
supabase/017_tradingview_lease.sql      one renewal of that sign-in at a time
supabase/018_calendar_tradingview.sql   her calendar keyed by TradingView's id
supabase/019_calendar_weeks.sql         the weeks R-14 can judge; Forex Factory dropped
supabase/020_calendar_ticker.sql        which series a release belongs to
supabase/verify.sql                     read-only: does the database match these?
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
scripts/backup-memory.mjs               the paged read behind the weekly copy
test/                                   node:test suites — see Tests
.github/workflows/test.yml              runs the suite on every push
.github/workflows/deploy-functions.yml  deploys the Edge Functions on push to main
.github/workflows/backup-memory.yml     the weekly copy of the eight tables nothing else holds
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

**And the other half has no write path into any of it.** Eugenia reads the
journal through `eugenia_trades`, a view granted `select` alone, and writes only
tables of her own. She is woken by three things and never by a clock she keeps
herself — a schedule in pg_cron, a message he sent, or a trigger on `trades`
firing the moment a position opens or closes.

```
   WHAT WAKES HER                        WHAT SHE IS HANDED OR READS
 ┌─────────────────────────┐        ┌────────────────────────────────────┐
 │ pg_cron   hourly        │        │ eugenia_trades   select only       │
 │           spine  ×4/h   │        │ her own tables   9, 7 backed up    │
 │           price  ×4/h   │        │ strategy.ts      no write path     │
 │ Telegram  he writes     │        │ the web          search and fetch  │
 │ trades    opened/closed │        │ the broker's price, via the poller │
 │                         │        │ calendar, market   via TradingView │
 └────────────┬────────────┘        └─────────────────┬──────────────────┘
              └───────────────┬───────────────────────┘
                              ▼
              ┌──────────────────────────────────┐
              │             Eugenia              │
              │           doji-eugenia           │
              │  briefing · pulse · reply ·      │
              │  release look · move look ·      │
              │  trade event · nightly pass      │
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

Four writers, one table. Journal columns and broker columns never meet, so
between the journal half and the broker half there is nothing to arbitrate at
all — that is the single idea the whole design rests on. Gladys is a writer on
the journal side, the app's side, and reaches the same four columns through the
same list.

Every writer but the app is an Edge Function deployed from `main`. The email
parser used to be the exception — it signed in as the trader from Apps Script,
with the account password in Script Properties — and now posts its fill to
`doji-email-sync` instead. See **The email parser**.

**Two columns have two claimants, and they are arbitrated differently.**

`balance` is settled by a filter rather than by a rule anybody has to remember:
the poller writes it only `where balance is null`, and Postgres evaluates that
inside the UPDATE, so an email landing mid-run cannot lose a race — there is no
read to race with. The email's figure is the balance the broker itself printed
on the fill, so it is the better number and it always wins; the poller fills
only the gap the email leaves, which is every manually closed trade.

`direction` has no filter at all: last write wins. The poller re-upserts every
position inside its six-hour write window, so the poller's reading wins for
anything it can see, and the email's survives only on a position the poller
never reached. That is safe for one reason and it is worth stating rather than
trusting — **both sources read the side off the OPENING deal**, so they agree by
construction. If either ever started reading it off a close, this column would
disagree with itself depending on how old the trade was.

Nothing else is shared. `id` is the join, not a value.

She would be the fifth writer to `trades` and is deliberately not one: a
document that decides whether he followed his rules cannot be edited by the
thing checking them, and the same reasoning keeps her off the journal. The
guarantee is structural rather than a grant — one database read of the journal,
and no write path to it anywhere in the file.

**Three monitors watch the parts that fail silently**, and each is written where
the thing it watches cannot take it down with it. `sync_health` is marked by the
two writers with no voice; `dispatch` is a ledger of what pg_net sent and what
came back, and posts to Telegram itself rather than through the function it
watches; `pace` speaks before a briefing runs out of wall clock, because
afterwards there is nothing left to speak with. `diagnose.sql` reads all three
in one grid. See **Deployment**.

**A fifth function holds the TradingView sign-in and writes nowhere but its own
row.** It is how the calendar and the market around gold will reach her, through
a credential she never holds. See **TradingView**.

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
| `size_oz` | position size in **ounces**, as opened — poller only |
| `planned_sl`, `planned_tp` | the stop and target as **first seen** on the open position — poller only |
| `best_price` | the best price the position reached while open, off the broker's minute bars — poller only |
| `open_day` | the New York civil day the trade is filed under |
| `commission` | dollars, positive magnitude, **never subtracted** |
| `balance` | account balance after the fill — from the email, or from the poller on a close under ten minutes old |
| `net_pnl` | broker's figure — includes swap; null for good on a position closed by hand, since cTrader sends no alert for one |
| `computed_pnl` | derived from the deals — no swap |
| `pnl` | **generated**: `coalesce(net_pnl, computed_pnl)` |

`pnl` is a generated column so the email-beats-computed rule is stated once, in
the schema, rather than reimplemented in every client that reads a P&L.

**`balance` and the account are different numbers, and the card shows both.**
`balance` is the cash at the broker — the portion deployed. The account is the
base the sizing ladder was applied to, which includes whatever is held off the
broker ready to be moved across, and Doji never sees that directly.

It is recoverable anyway, because the ladder is 0.02 lots per 1,000 continuous:

    lots     = size_oz / 100
    account  = size_oz * 500

So a size is a readout of the capital it was sized against. The caption under
Balance at broker reads `0.04 lots — sizing for 2000`, and *sizing for* is doing
real work in that sentence — it is what the ladder implies, not a figure anyone
reported. It uses the **latest** size rather than an average, because rungs are
stepped and a mean across a month describes no account that ever existed.

Which makes the gap between the two worth reading: an implied account well above
the balance is the reserve sitting off-broker. It is also the only thing that
would show a size drifting off the ladder, since nothing else in the system
knows what the ladder is.

The notice wins the caption when there is no balance at all. It explains the
dash directly above it, and a caption belongs to the figure it sits under.

`size_oz` is in ounces because that is the unit **both** broker sources state:
cTrader sends the poller a volume it divides by a hundred, and the alert email
prints `Volume  Oz 4.00`. Lots are ounces over a hundred. It is the size the
position was **opened** at, which is the quantity `computed_pnl` is calculated
over — equal to the closed size on a full exit, and the honest number on a
partial.

**The poller writes it and the email does not.** The email boundary is five
columns on purpose, and widening it would trade a stated property of that
design — the secret in Google's infrastructure opens five columns, not the
account — for coverage of trades the poller never reached. So a position it
never saw carries no size, permanently, and anything reading sizes has to
tolerate a null rather than assume one.

**`planned_sl` and `planned_tp` are the plan, and it is only readable while the
position is open.** A closed position reports its *final* stop, so one moved to
break-even under R-04 has overwritten the original in everything the broker
serves afterwards — which is why §8 of the strategy called the plan
unrecoverable, and it is right about every closed trade. A live position is a
different question: `get_positions` carries `stopLoss` and `takeProfit`, and the
poller runs every two minutes, so it sees almost every position while it is
still open.

**Written once, and the filter in the URL is the whole of it.** `where planned_sl
is null` inside the UPDATE, the same arbitration `balance` uses and for the same
reason: the poller re-reads every open position on every run, and any write after
the first would file the break-even stop as the plan — the thing the plan exists
to be compared against.

**As first seen, never as set.** Up to two minutes separate the entry from the
poll that catches it. For R-04, which moves a stop only after +$20, that gap is
immaterial; a stop moved inside the first two minutes would be recorded wrong and
nothing here can tell that case apart. And it only ever looks forward — every
trade that closed before these columns existed carries null for good, which is why
§7's `Evaluable` column is unchanged: a rule is `journal` when a row can answer
it, and today almost no row can.

**`trade_stops` keeps every move the plan columns refuse to.** The plan is the
first sighting and a closed position reports only its final stop, so where the
stop sat when a print landed — which is all of R-19 — was seen every two minutes
and kept nowhere. `stopChanges` writes a row only when a position's stop or target
differs from the last row written for it, a side the broker stopped carrying as
null, so seven hundred polls of a stop that never moved are one row. A move is
recorded up to two minutes after it is made, the plan's own *as first seen*. The
table is outside `eugenia_trades` because it is a history rather than a column;
`check_rules` reads it beside the trades.

**`best_price` is how far the trade ran in his favour, and unlike the plan it
reaches backwards.** The highest bid on a buy, the lowest on a sell, read off the
broker's minute bars — which `?bars=raw` showed go back a full year, so every
trade in the journal can carry one, not only the ones after this column. It is
what R-04 turns on: a loss taken after the trade had already been $20 his way is
a stop that was not moved to break-even. The poller fills it newest first, three
trades a poll, so a fresh close is never queued behind the backlog and the
backlog drains in minutes without a door anyone has to call. **Only whole minutes
inside the trade are read**, because the minute he entered in holds prices from
before he was in and the minute he left in holds prices from after — so the
figure can fall short of what happened and can never exceed it, and a trade under
a minute long carries none. Written once, under `where best_price is null`: the
bars of a closed trade do not change.

`commission` is recorded and never displayed. The P&L this app stores is already
net of it — `net_pnl` includes costs and swap, `computed_pnl` is derived from
deals that carry them — so subtracting it would double-count. It is captured
because the value exists only at sync time, so a panel that wants it later can
have history rather than starting from the day it was added.

### Journal-owned

Written by the app and by the Telegram bot. Neither broker writer ever sends
these keys.

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

`created_at` is when this row was first written — the moment the poller or the
email parser first saw the position, which is not the moment it was opened.
`entry_time` is that, and is the column every reading of the trade uses.
Nothing reads `created_at` on `trades`; it is the audit floor under a table
four writers share.

`updated_at` is maintained by a trigger, not by call sites that each have to
remember. Read it as "when the poller last touched this row", not "when this row
last changed" — the poller re-upserts every position in its window on every run,
and Postgres does not skip no-op updates. Nothing reads the column today; the
distinction matters the first time anything does.

`tg_message_id` is the Telegram message Gladys posted for the trade, and it is
hers alone — in neither `Data.OWNED` nor her `COLUMNS`, so nothing can name it
from a save or from a tap. It exists so a journal answer written **anywhere**
reaches the message she already sent; `null` simply means there is nothing to
edit, which is every row the poller never opened.

---

## What is derived, not stored

Four things every surface needs, each computed by one function, because storing
them is what lets them drift from the values they come from.

**`result`** — win / loss / break-even. A scratch is measured in **price**: an
exit within **±$3 of the entry price** went nowhere, whatever size was on. A
P&L band cannot say that, because $3 of P&L is $3 of gold at 0.01 lots and three
cents of gold at 1.00 — the same rule would mean something different every time
the account scaled. Win and loss still come from the **sign of the P&L**: price
distance is unsigned, and it is the account that decides which way a trade went.

It changes the label only, and the dollars still flow into every money figure,
which is what keeps gross profit − gross loss equal to net. Break-evens sit in
the win-rate **denominator**, so scratches drag it down rather than vanishing.
`null` when there is no P&L yet — a trade can be journalled before it closes, and
a missing figure is not a break-even.

**A P&L of exactly zero is a break-even too, and the price band cannot say so.**
A trade can move sixty dollars and come back to nothing once commission is in:
the price went somewhere, the account did not. That is a break-even at any lot
size — which is the very property the band is measured in price to protect, and
zero is the value that needs no scaling. It is a *point* and not a second band,
so the cent either side is still decided on its sign.

The pre-sync rows carry no prices, so the rule cannot be evaluated for them and
the same $3 is read against their P&L instead — the only measure they have ever
had. An open position has an entry price and no exit, which is the same case.

**An aggregate result** — the colour of a calendar day, a week cell or a month
tile — **inherits rather than re-bands.** Several trades share no single entry
and exit, so there is no price distance to measure across them: a cell is a
scratch when *every* decided trade inside it was one, **or when the trades
inside it cancelled out exactly**, and otherwise takes the sign of its total.

A total of exactly zero has no sign, so the sign rule cannot answer it, and a
day that ends precisely where it started went nowhere — which is what
break-even means. One real win and one real loss of the same size is a
break-even day, not a red one. There is still deliberately no separate dead band
for cells: zero is a point, so a day that nets a few dollars off two real losses
is two real losses, exactly as before. The two levels agree by construction —
without that, a day holding a single trade that netted zero would read
break-even on the calendar and a loss in the log, on one screen.

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

## Facts that live in more than one file

Four runtimes, five languages and no build step, so some things genuinely cannot
be single-sourced at run time:

| The fact | Where its copies live |
|---|---|
| the **setups vocabulary** | `CONFIG.SETUPS`, Gladys's `SETUPS`, `trades_setup_check` |
| the **four journal column names** | `Data.OWNED`, Gladys's `COLUMNS`, the columns themselves, and twice inside `trades_telegram_on_answer` — the `is distinct from` list and the `before` object |
| the **five columns the app may WRITE** | the `grant update (…)` in `011_trades_grants.sql`, and both lists in `verify.sql` — the exclusion and the positive one. Four of them are `Data.OWNED`; the fifth is `deleted`, which no tap or save may name but `remove()` and `undo()` write directly, so a grant list built from `Data.OWNED` alone reads as correct and takes soft delete out on the day it is applied |
| the **two sides a trade may have** | `trades_direction_check`, the poller's `tradeSide` and its short/long P&L inversion, `emailRow`'s check, the Apps Script's `BUY`/`SELL` mapping, and the app's Long/Short label — narrowing the constraint refuses every SELL at PostgREST and the poller reports it to the console only |
| the **two roles a turn may have** | `eugenia_turns_role_check` and every `role:` she writes — her own turns are half of every pair, so a constraint that refuses `assistant` leaves a history of his messages alone |
| Eugenia's **note length** | `writeNote`, the check constraint, the tool description |
| the **five channels**, in two vocabularies | ids: `CHANNELS` in `prompt.ts`, the check constraint and the seed in `003_eugenia.sql`; spoken names: `CHANNELS` again, and §2's headings in the strategy — the tool's enum reads `CHANNELS` rather than holding its own |
| the **four rungs of the ladder** | `CHANNEL_STATES` in `prompt.ts`, the check constraint, and `PITCH` — which is one constant interpolated into both the cached prefix and §0, so the rungs are a copy and the table is not |
| Eugenia's **search source vocabulary** | the `source` literals `eugenia_search` returns (`note`, `you`, `him`) and the three branches `searchList` renders them with — a value on one side and not the other is a hit silently attributed to the wrong person |
| the **`eugenia_trades` column list** | the numbered SQL files — `003_eugenia.sql` creates it and `006_plan.sql` appends the plan, so the last definition is the one the database ends up with — the README's two quoted copies of that statement — the one an existing database runs on its own and the one inside the drop-and-rebuild migration — §8's inventory of a row in the strategy, the section she is told to read before producing any number, which named four columns the view does not serve for five versions of the document, and `TradeRow` in `adherence.ts`, which calls itself the row the view serves and is what every rule is written against — so a column it does not name is one no rule can be written against, and `readDesk` asking for `select=*` makes it the only description of what comes back |
| the **kinds an open thread may have** | `LOOP_KINDS` in `index.ts` and the check constraint in `005` |
| each **sense's query flag** | the cron job's URL in `004` and the branch in `postScheduled` — the one rename in this system that fails in complete silence, since pg_net discards the 200 the unread flag still answers. Held in BOTH directions: every flag `004` calls with is read, and every flag read is either scheduled in `004` or declared as a door a person opens, so a sense can no longer ship with no job behind it |
| the **embedding width** | `EMBED_DIMS` in `index.ts`, the two `vector(n)` columns in `007`, and the cast inside the search — a disagreement is a 400 on every write, reported to a console nobody reads |
| the **journal's own arithmetic** | `index.html`'s `CONFIG.BE`, `resultOf`, `counts`, `money`, `averages` and `Dates.MARKETS`, and `journal.ts`'s port of all six so she can reach them — the break-even band, the session names and all four sets of market hours are read out of both files, and so is the SHAPE of the three definitions that look identical in every ordinary case and part on one |
| the **hour cycle** | the nine formatters that ask for an hour — three in `index.html`, and one each in `_shared/edge.ts`, `adherence.ts`, `journal.ts`, `doji-gladys` and two in `doji-eugenia` — every one stating `hourCycle: 'h23'`, because `hour12: false` leaves the choice to the locale and a locale resolving to h24 renders midnight as hour 24. Harmless in the two `hourIn` ports, where 24 fails `h < close` as 0 fails `h >= open`; wrong in `nyParts` and `nyWall`, which compare the hour against 17 and feed it to `Date.UTC` |
| the **17:00 New York roll** | `marketOpen` in `_shared/edge.ts`, which closes Friday and opens Sunday on it, and `ROLL_HOUR` in `index.ts`, which decides whether a quote is describing the night or the evening — one boundary, and a disagreement is a window labelled wrong for an hour a day |
| the **columns of `eugenia_price`** | the table, and what `markPrice` PATCHes — and `looked_at` written unconditionally is the quiet window that never reopens |
| the **importance a release may carry** | `IMPORTANCE` in `doji-tradingview`, which carries TradingView's 1, 0 and −1 into her words, the check constraint, and the `importance=eq.high` the event spine selects on — a rename on any side is a spine that files everything and wakes for nothing, or a quarter-hourly filing refused whole |
| the **verdicts a briefing tap may carry** | the keyboard's `callback_data`, `parseFeedback`, and the check constraint |
| the **thesis length** | `THESIS_MAX` and the check constraint |
| the **two writers' names** | `sync_health_id_check`, the seed beside it, and the `heartbeat("…")` call in each of the two functions — an unaccepted name is a 400 the writer swallows, an unseeded one is a PATCH landing on nothing, and both read as a writer that died |
| the **columns of `eugenia_runs`** | the table, the object literals `recordRun` is called with, and the two `verify.sql` names in the row that asks whether a database has the cache-write columns — a key with no column is a row PostgREST refuses whole, so the meter goes quiet for every caller at once |
| **which rules a row can answer** | §7's `Evaluable` column in the strategy, and the thirteen predicates `adherence.ts` implements — a rule marked `journal` and never implemented is a check she cites that nobody runs; one marked `judgment` and implemented anyway starts reporting `pass` for something §8 says nothing stored can see |
| the **caller a delivered briefing writes** | the `` `${due} briefing delivered` `` template in `postBriefing`, the `Brief` union it interpolates, and `010`'s `owed \|\| ' briefing delivered'` — the two halves are in two languages with no build step between them, and a watcher looking for a caller nobody writes reports a briefing missing every single day |
| the **number of scheduled jobs** | the `cron.schedule` calls in `004` and the count `verify.sql` asserts — a row that has been wrong once already, reporting a correct database as broken |
| the **paid worker wall clock** | `ceiling_ms` in `010`, which is also what its message quotes back, and the sentence in `CLAUDE.md` explaining why the cron half answers before it works — a fact about the plan rather than about this repository, so it moves in both places or neither |
| each **function's name** | its directory, the triggers, the cron jobs, the Apps Script |
| the **project ref** | every `net.http_post` URL in the SQL, plus `index.html`, `config.toml`, the deploy workflow and the Apps Script — the middle two name it without a URL |
| each function's **required secrets** | its `env()` calls and its own boot guard |
| each function's **gateway setting** | `config.toml`'s stanza and the deploy command's flag |

Copies are the cost. Copies that can *disagree* were the risk, and that is what
`test/agree.test.mjs` closes: it reads every copy of each — the app out of
`index.html` through the same jsdom harness the render tests use, the function
exports directly, the constraint and the cron jobs out of the SQL as text, the
project ref out of the workflow and `config.toml` — and fails when they stop
saying the same thing.

Every one of those values was already tested before, and every one of those
tests asserted against a literal typed into the file beside it — so changing a
list and its own test in one pass left the other copies untouched and the suite
green.

It also asserts the guarantee rather than only the lists: no broker column may
appear in `Data.OWNED` or in `COLUMNS`, which is the sentence the whole design
rests on, tested rather than repeated.

**And the database holds it too, since `011_trades_grants.sql`.** The RLS policy
on `trades` scopes rows to their owner and says nothing about columns, so a
client signed in as the trader could write any column of its own rows —
`net_pnl`, `direction`, `fill_time`, every figure the app does not own and
cannot repair. 009 revokes insert, update and delete on the table and grants
back update on exactly five columns: `Data.OWNED`'s four, plus `deleted`.

This paragraph used to argue the other way, and the argument is worth keeping
because two thirds of it were dissolved rather than overruled. It said the grant
list would be a fifth copy of the boundary *in the one place nothing here can
test*, and that getting it wrong would *silently break soft delete rather than
failing loudly*. Both are now false: `agree.test.mjs` reads the grant out of 009
and both of `verify.sql`'s lists, holds all three against `Data.OWNED`, and goes
red on a list that is too narrow, too wide, or drifting in either file. The
missing-`deleted` case — the exact silent breakage that was predicted — is one
of the five it is proved against.

What was NOT dissolved is the value: the threat it stops is a client that
already holds the session token, which is a narrow one. It is done because the
cost fell away, not because the threat grew.

`updated_at` is not in the grant, though the earlier version of this paragraph
listed it. Column-level UPDATE is checked against the columns a statement NAMES
in its SET list, and `trades_touch` is a BEFORE trigger assigning `NEW`, which
needs no privilege of the caller's.

That was reasoning rather than a result, and it has since been run. On a
throwaway Postgres 16 carrying this table, this trigger and 009's two statements
verbatim, `set role authenticated` then a journal save SUCCEEDS and
`updated_at` moves — with nothing granting that column to that role. The same
save against `net_pnl` is refused, as are an insert and a hard delete, and the
soft delete and its undo both pass. The refusals are what make the success worth
having: a run where everything is permitted would prove only that the grants had
not been applied.

It is not in `npm test` and will not be. The suite installs jsdom and nothing
else, and a database dependency would cost that for one assertion. What is on
the live database is `verify.sql`'s business, and its three rows there answer the
privileges rather than this — a privilege check is not a write.

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
  followed_tp = excluded.followed_tp, deleted = excluded.deleted,
  tg_message_id = excluded.tg_message_id;
```

The deleted rows matter: restoring without them lets the poller rebuild every
trade you ever removed.

**The weekly auto-backup** fires after the Friday 17:00 New York close, keyed on
the last completed week so it runs once and never twice. Desktop only — a phone's
Downloads folder is not where a backup belongs, and the marker is per-device so
skipping on a phone does not consume the laptop's turn. A gesture-less download
can be blocked silently with no API to detect it, so the toast asks you to verify
rather than asserting success.

**The backup is `trades` and nothing else, and the tables it leaves out are the
ones that cannot be rebuilt.** Every broker column in `trades` exists in
cTrader's history and a wide `?force=1` backfill reconstructs it; the journal
columns and the soft-deleted rows are the part only this file holds, and those
the backup does carry. Her memory is the other way round. `eugenia_notes`,
`eugenia_turns`, `eugenia_channels`, `eugenia_thesis`, `eugenia_loops` and
`eugenia_calendar` have no source anywhere else — the channel map is a year of
teaching with a `moved_on` date per rung, and the calendar is the one dataset
here that compounds — and no button in this app reaches them.

That is not a bug in the backup. `003` denies the publishable key her notes and
turns deliberately, and `005` grants the app a read on only three of her tables,
so an in-app backup structurally cannot include them and should not be given the
policy that would let it. The copy has to be taken with the secret key, from
outside the browser.

**`scripts/backup-memory.mjs` is that copy, and `.github/workflows/backup-memory.yml`
runs it every Sunday evening.** It reads the eight tables that have no other
source — the channel map, the notes, the turns, the thesis, the open loops, the
calendar and the feedback, and every stop and target a position carried, which
the broker forgets once it closes — and writes
one JSON document as a build artifact.
`eugenia_runs` is deliberately out: it is the cost meter, by far the largest
table, and every row in it is a fact about a model call rather than about him.

It needs `SUPABASE_URL` and `SB_SECRET_KEY` as repository secrets, and nothing
else — one file, no install step, because a backup that depends on a registry is
a backup that fails the week the registry does.

**Give it its own `sb_secret_` key rather than the one the functions hold.** Both
bypass RLS identically, so this is about blast radius rather than capability:
this is the second secret in the system to live outside the trader's own
infrastructure, in GitHub's, and the argument is the one `DOJI_EMAIL_SECRET`
already makes. Leaked, a key used only here is revoked on its own and the
poller, Gladys and Eugenia keep running; the shared one has to be rotated
everywhere, under pressure. Supabase allows several named secret keys for
exactly this — name it for what it does. It can still read every table,
`trades` included: a key that could not would also be denied her notes, which
is the whole point of the backup. **The paging is the load-bearing
part.** PostgREST caps a response at its own `max-rows` whatever is asked for, so
a single read of `eugenia_turns` returns a page and looks exactly like a complete
archive: green job, well-formed file, plausible counts, discovered on the day
someone restores from it. The walk stops on a short page rather than on a count
it was told, and the job refuses to upload a document holding zero rows.

**Artifacts expire after ninety days**, which is the maximum a free account
allows, so this is a rolling window rather than an archive. Download one
occasionally and keep it somewhere that does not expire, or run the script by
hand for a durable copy:

```sh
SUPABASE_URL=... SB_SECRET_KEY=... node scripts/backup-memory.mjs > memory.json
```

**Signing out** is a double-click on the sync dot, and it deletes the snapshot:
a full copy of the journal sits in `localStorage` in plaintext, and left behind
it puts the login screen and the previous session's trades one keypress apart on
a shared machine. `app.test.mjs` drives that path — removing the delete goes
red, as does a confirmed load that writes no snapshot or a failed one that
ignores it.

**Run `verify.sql` whole and read the `ok` column.** It is one statement, and
that is load-bearing rather than tidy. Ten listings used to sit below the
summary, and a SQL editor shows the result of the **last** statement only — so
pasting the file in and pressing Run displayed the ten most recent HTTP
responses and silently discarded every check above them. The file carried a
paragraph at the bottom explaining that to someone who had already lost their
result, and told them to scroll up and select a six-hundred-line range by hand.
It happened to the person who wrote that note, and then to the person it was
written for. A check that awkward to run is a check that stops being run.

Moving the summary to the end instead would have been worse. `cron.job` raises
without pg_cron, `net._http_response` without pg_net, and a direct read of a
table that was never created raises too — anything that raises takes every
statement after it, so the summary would vanish on exactly the databases it
exists for. **Two files is what lets each one's statement be last in its own.**
The listings are `diagnose.sql`, which you open when a row says false and the
next question is which object, which grant, which schedule. A raise in there is
not a fault; it is that file reporting an extension or a table that is absent.

Its **last** listing is the one to run on an ordinary day: the three monitors in
one grid, which is what a top-to-bottom run leaves on screen. `008` records
whether the two silent writers are alive, `009` what pg_net sent and what came
back, `010` how much of its worker clock a briefing spent — and until that
listing existed a person wanting the answer had to know all three tables were
there and read them one at a time. It adds no fourth definition of broken:
`dispatch_failures` decides what a failed dispatch is and the listing calls it,
`pace_line` decides what too slow is and the listing quotes it, and
`sync_health` shows its mark and its age because the judgment there is
`healthLine`'s and lives in TypeScript.

A function in the database — `verify_doji()` — was the obvious fix and it is
wrong twice over. It would put the expectations *inside* the thing being
verified, applied by hand like everything else, so a stale copy reports a stale
truth with nothing to catch it. And `agree.test.mjs` reads the summary's text in
eight places; every one goes silently blind the moment those rows leave the file.

`agree.test.mjs` counts the semicolons in `verify.sql` and asserts there is one,
because the regression is a single appended `select` — the file still runs, every
check still passes, and the grid shows something else.

**If a trade does not appear**, the cron reporting `succeeded` proves nothing —
`net.http_post` is asynchronous, so the SQL succeeded in *queuing* the request.
The function's own answer is here:

```sql
select status_code, content, created
from net._http_response order by created desc limit 10;
```

### When a number looks wrong

Every column has exactly one writer or a written arbitration rule, so the first
question is always *who owns this*, and the second is *what does the repair
overwrite*. Nothing here is guesswork: a wrong direction cannot be fixed in the
app, because the app does not own the column.

| The number | Who owns it | How to see the fault | The repair | What that repair also does |
|---|---|---|---|---|
| direction, entry time or price, exit price, size, commission, `computed_pnl`, filing day | the poller, alone | `?raw=1&hours=N` — what cTrader actually sent | `?force=1&hours=N` if the fold is wrong for a response that is right; a code change if the response itself is shaped differently | rewrites all ten of those columns for **every** position in the window, so any hand-correction inside it goes back |
| `net_pnl` — the settled money figure | the email path, alone | the thread is unlabelled, so the next Apps Script run retries it | re-send the alert, or accept `computed_pnl` through `pnl` | nothing; the poller never writes this column |
| a closed trade with `exit_price is null` | the poller, folded without its entry deal | that combination *is* the signature | `?force=1&hours=N` wide enough to reach the entry | as above — the whole window |
| `balance`, `planned_sl`, `planned_tp`, `fill_time` | two claimants, settled by `where … is null` | compare against the broker | clear the column, then let the next poll fill it | first write wins, so a backfill alone changes nothing |
| setup, the three discipline answers | the trader, through the app or a tap | the log, or `/notes` in her thread | edit it in either place | no broker column moves; the two writers hold the same four names |
| a session that looks misfiled | derived, never stored | `entry_time is null` on the row — the seam | `?force=1` wide enough to backfill the entry | as above; `get_stats` counts these and says so |

**The two writers with no voice leave a heartbeat instead.** The poller and the
email function have no path to Telegram: a 500, a refused write, or a cut deals
page reaches `console.error` and stops there, and `pg_net` discards the
response. So `008_sync_health.sql` holds one row each, and both writers move
`last_ok` on every completed run and record `last_error` on every failure.

It is a heartbeat rather than an alarm, and that is the whole design. An alarm
fires when a run fails, which means it cannot fire when the run stops happening
at all — an unscheduled cron job, a renamed function, a deploy that dropped one.
Those are silent under any failure-triggered scheme and they are exactly the
failures worth catching. `last_ok` going cold answers "running and failing" and
"not running" with one column.

`healthBlock()` reads it into the morning briefing, and she is told to lead with
it. Six hours is chosen against the poll's two-minute schedule and the 08:00
delivery — shorter and a brief outage reads as a fault, longer and a Monday
outage reaches him on Tuesday.

**And the heartbeat cannot see a call that never ran, which is what
`009_dispatch.sql` is for.** `heartbeat()` is written by a function that
executed. When Supabase refuses a worker it answers `546 WORKER_RESOURCE_LIMIT`
*before* the function exists — so nothing marks, nothing throws, no apology is
sent, and the function's own log has no entry at all. The only witness is a row
in `net._http_response`, which pg_net prunes within hours and nobody reads. A
Sunday briefing went missing for two hours that way, and was found by hand.

**`net.http_post` returns the request id and all six callers threw it away.**
That id is the only link to the response row, and that row carries **no url** —
so what a failed request was *for* cannot be recovered afterwards. The ledger
captures it at the moment of the call: one row per dispatch, the job named, and
`agree.test.mjs` counts `net.http_post` calls against ledger rows so a seventh
site cannot be added unwatched.

**The watcher lives in Postgres, and that is the point rather than a
convenience.** The thing that fails is the Edge Function; a monitor that
reported a refused worker by asking that same function to send a message would
share its subject's failure mode. `dispatch_watch` runs every ten minutes and
posts to Telegram directly, reading `eugenia_bot_token` and `telegram_chat_id`
from Vault — the third and fourth names in this system that are one value under
two spellings, and `verify.sql` asks whether both resolve.

**A single lost poll is an ordinary day and is not reported.** The poller runs
720 times daily with the next one two minutes away, so naming every refused
worker would put three or four messages a day in front of him about a sync that
healed before he read them. `dispatch_repeats` is the same split `healthLine`
makes below, arriving for a second reason: a job that comes round on its own is
evidence only in *quantity* — three failures in an hour — and a job that does
not is evidence alone. The hourly job carries the briefing and the nightly pass;
the trade event has no retry anywhere in this system; Gladys's has none either.

**The ledger may not break the trigger it sits in.** Both trigger sites post
into a variable first and record it behind `exception when others then null`,
because they fire inside the UPDATE that set the column — a raise there would
fail the journal write itself. It was proved by renaming the table away and
watching the trade still write and all four messages still dispatch.

**The judging window has both ends.** Fifteen minutes at the near end, so a slow
call is not called dead; three hours at the far end, because pg_net's own
pruning makes every older row read as *no answer* — which on the one day the
watcher itself stopped would bring back a hundred invented failures.

**And the report itself can be lost — the first one ever sent was.** pg_net came
back `timed_out`, the whole twenty-second budget spent in the TCP/SSL handshake
and nothing at all in the request: the connection to Telegram never opened. The
rows had already been settled, because pg_net is asynchronous and the function
cannot learn otherwise inside the same call. A real outage would have been
reported once, into a dropped connection, and never mentioned again.

So `reported_by` carries the request id of the message that named a row, and the
row is not settled until that message is known to have arrived. The next sweep
settles on a `2xx` and clears the mark on anything else, so it is said again. A
sweep that could not send at all — a Vault name misspelled, which this project
has had happen twice — settles nothing, so repairing the name still delivers the
outage. Past three hours it gives up, because a row that can never be
adjudicated would be announced every ten minutes for the life of the
deployment.

**And neither of those can see how much of its budget a run spent, which is
`010_pace.sql`.** Both ask whether something ran. This asks how close it came to
not being allowed to finish, and it is the only one of the three that can speak
*before* the failure rather than after it — because after it there is nothing
left to speak with. Since the cron half began answering before it works, a
briefing killed at the 400s wall clock has already handed pg_net a `200`: the
ledger records a healthy dispatch, `ask()` never reaches its catch so no failure
row is written, `postScheduled`'s apology never runs, and the 09:00, 10:00 and
11:00 retries redo the same too-long work and die the same way. Three monitors,
all green, and nothing reaches him — the Sunday `009` was built after, arriving
again through the door that was opened to fix it.

`eugenia_runs.ms` has been written on every model call since `005` and read by
nobody. Three unattended days put the briefing at 170.6s, 162.3s and 238.7s:
sixty per cent of the ceiling on an ordinary Wednesday, swinging two to one on
work that looks identical from outside.

**It watches from both sides, and the threshold is argued from the spread rather
than chosen.** `pace_line` speaks when the longest run of the last seven days
passes three quarters of the ceiling — 300s. The briefing's own swing between
its fastest and slowest ordinary morning is 77s, so an ordinary heavy day cannot
reach it, and the 100s still left when it fires is more than one whole swing:
early enough to act on rather than a description of something already dying. The
window is seven days because the week has to contain a Sunday briefing, the
longest and rarest of them.

`ms` is a lower bound on the wall clock and never an overstatement — a row
measures one model call, or everything `postBriefing` did, while the worker's
clock started earlier and stops later — so reading the largest row rather than
reassembling an invocation (there is no invocation id to reassemble one with)
costs lateness and never a false alarm.

**The second half is the absence, and it is what actually closes the hole.** A
briefing this day owed, past the last hour it could still have arrived — noon on
a weekday, 21:00 on a Sunday, both a full ceiling past the final retry — with no
`<kind> briefing delivered` row saying it did. Asked any earlier it reports a
briefing that is still being written, which is the ordinary-day false alarm that
gets a monitor muted in a week.

**A slow run is said once.** The day was once the only guard, and a run stays in
a seven-day window for seven days — so the first Sunday over the share, at 315s,
was announced at 17:37 and again at 00:37, on its way to the same sentence every
midnight until the next Sunday. The watcher hands `pace_line` the time it last
spoke, and a run at or before that has been said; `diagnose.sql` hands it
nothing, because a person looking wants the week rather than what is left to
say. The second argument is a second function to Postgres, so 010 drops the
one-argument version first — left beside it, `pace_line()` matches both and is
refused as ambiguous.

**It speaks at most once a New York day, and the row it writes is the guard.**
Which is what makes one ordering load-bearing: a row written after a send that
could *not* be made would mark the day as said and swallow the warning for good,
so repairing a misspelled Vault name would deliver silence. The row goes down
only where the post was made, and the next hour tries again. A quiet day still
leaves one row saying `clear` — both outcomes, always, because a meter that
records only its firings reports a watcher nobody is calling as a system with
nothing to report.

**The two writers are judged differently, and conflating them is a monitor that
cries wolf until it is ignored.** The poller runs every two minutes on a
schedule, so its silence *is* evidence — nothing ran. The email function runs
only when a fill arrives, so its silence is a quiet week, and a staleness rule
over it fires on almost every ordinary day. Silence is read for the scheduled
writer alone; what is read for both is the outcome of the last run, so an error
stamped after the most recent success means the thing is failing now, and a
success after an error clears it.

**A market-closed skip is a completed run and marks itself.** Gold closes Friday
17:00 New York and opens Sunday 17:00, and the poller is still invoked every two
minutes across that, answering `skipped: "market closed"`. That is everything the
mark exists to prove: cron fired, the function is deployed, its secrets loaded,
it decided correctly. Unmarked, forty-eight hours pass against a six-hour window
and the sync reads as dead every Sunday evening. Whether the broker answers is
the failure path's question, not this one's.

**It is inert until `008` is applied.** Both writers swallow their own failure
there, so a database that has not seen the file gets a 404 on the health write
and keeps folding deals exactly as before, and her read answers nothing. A
monitoring table that can take down the thing it monitors is worse than no
table.

Eugenia's scheduled half was always the exception — it messages Telegram on
failure and retries until the marker lands.

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

**A cut page is an error, not a field, and it is checked before anything is
written.** If `get_deals` comes back holding `maxRows` deals, the function
throws — ahead of the upsert, because a cut page can return a position's closing
deals without its entry and those are exactly the rows that would land. It used
to throw after the write, on the reasoning that the write had already happened;
that is backwards.

**The test is our own cap, not the vendor's flag.** `hasMore` says more deals
exist beyond the window asked for, which is true of almost every run and says
nothing about whether this page was cut. Reading it as truncation would hand
cTrader the ability to halt the journal by changing what a field means — and
silently, since `net.http_post` discards the response. It travels in the answer
instead, as `has_more`.

Five hundred *deals* is roughly two hundred trades inside a 78-hour window, an
order of magnitude beyond this account and not reachable on the two-minute
schedule. Hitting the cap means something is wrong with the window rather than
that the trader had a busy week, and the last thing to do then is write rows
folded from a partial history.

**`?raw=1` returns what the broker actually sent.** A trade with an inverted
direction or a missing entry price is either a fold this function got wrong or a
response cTrader shaped differently, and the two repairs are opposite — a
`?force=1&hours=N` backfill for the first, a code change for the second. Nothing
else in the system can tell them apart.

**A forced backfill overwrites a hand-corrected row, and that is the one thing
to know before running one.** Every broker column is rewritten from the deals as
they fold today, so a row edited in the dashboard to fix a direction or a price
goes back to what the fold produces — silently, and for every position the
window reaches, not only the one being repaired. The journal columns are never
touched, `net_pnl` is not among the columns the fold writes at all, and the
arbitrated columns keep their `is null` filters — so the money figure the email
owns, `balance`, `planned_sl`, `planned_tp` and `fill_time` all survive it. The
ten the fold does write are `direction`, `entry_time`, `entry_price`,
`exit_price`, `size_oz`, `commission`, `computed_pnl` and `open_day`, and those
do not.
Widen `hours` to the smallest window that covers the row you mean, and expect a
correction older than that window to stand only until the next backfill reaches
back past it. The flag writes nothing, makes the same
`get_deals` call the poll was about to make, and returns the body as text: the
SSE framing and the double-encoded payload are half of what is being looked at,
so parsing them away would hide the layer the question is usually about.

```sh
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?raw=1&hours=72" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
```

**`?tools=1` asks the broker what it actually offers.** `ALLOWED_TOOLS` names the
two this function calls, and it has never said anything about what *exists*: the
poller needs deals and a balance, so those are what it asked for, and whether
cTrader also serves a quote, a symbol list or an open-position feed was never
established either way. That gap decides real things — whether Eugenia can read a
price off the broker this system is already connected to, or has to reach for a
third-party feed and the vendor decision that comes with it.

It is a JSON-RPC **method**, not a tool call, so it goes past the allow-list
rather than through it: the list guards a tool *name* becoming a request, and
`tools/list` names none. It writes nothing, calls nothing it discovers, and
answers at any hour — the same standing as `?raw=1`, and there for the same
reason, which is that guessing has cost a day more than once.

```sh
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?tools=1" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
```

**What it offers, established rather than assumed.** `?tools=1` was run, and the
answer changed two things. It serves prices — `get_spot_prices` for bid/ask,
`get_trendbars` for OHLCV candles from `M_1` to `MN_1` — which is what lets a
briefing quote a number read off the instrument rather than paraphrased from a
news page. It also serves `get_positions`, `get_symbols`, `get_assets`,
`get_pending_orders`, `get_order_history` and `get_version`.

And it serves `create_order`, `close_position`, `amend_position`, `amend_order`
and `cancel_order`, **on the same credential**.

**So the read-only guarantee is one array, not the key.** `ALLOWED_TOOLS` names
what this function may call; every entry carries `readOnlyHint: true` on the
broker's own listing, and `DESTRUCTIVE_TOOLS` names the five that do not so a
test can assert none of them is ever reachable — through the list, or around it
by a direct call. It also fails a name permitted but never called, because a
destructive tool would arrive that way: added "for later" rather than used.

The credential is the better place for that guarantee and is not where it lives.
If cTrader can issue a read-only token, this array stops being load-bearing.
Until then it is, and it should be read as such rather than as configuration.

**`?positions=1` answered a question §8 had closed, and answered it the other
way.** A live position carries `entryPrice`, `stopLoss` and `takeProfit`. So the
plan *is* available from the broker — for an **open** position. §8's claim was
formed against closed ones, where it remains true, and the poller had never
looked at an open one because it had no reason to.

That is not a documentation fix: §8 is the trader's own document, and four of
its unanswerable questions rest on that sentence. **Changing it is his call**,
and what would follow from it — sampling the stop at open, where
`trades_eugenia_opened` already fires — is a schema change to a table with four
writers. Neither is done here.

**The original question, for the record.** §8 says it is not —
*where the stop and target were set at entry* is called unavailable from the
broker, and four questions are marked unanswerable because of it, R-02's
*respect* half among them. That claim was formed against `get_deals` and
`get_position_details` on a **closed** position, where the broker reports only
the final stop, and about those it is right. A **live** position was never asked:
`amend_position` takes `stopLoss` and `takeProfit`, so positions carry them, and
whether `get_positions` *serves* them is what this settles. If it does, the
`trades_eugenia_opened` trigger already fires at the one moment worth sampling,
and a stop recorded at open is the plan.

**`?market=1` returns the price; `?market=raw` returns what the broker sent.**
The same split `?raw=1` makes for the deals, and it earned itself immediately.

**The endpoint uses two scales, and its documentation mentions neither.**
`get_spot_prices` serves **pipettes** — `bid: 441982000` is 4419.82, a hundred
thousandth of what it prints. `get_positions` serves **display prices** on the
same account and the same symbol — `entryPrice: 4402.71` is 4402.71. cTrader's
tool descriptions say *"DISPLAY price (not pipettes)"* about their **inputs**
and nothing at all about their outputs. A parser written from the documentation
would have been a hundred thousand out on one of the two, and would still have
produced a four-digit number that looked like gold.

`PIPETTES` is named once and applied in one place, and `foldSpot` is tested
against the real capture rather than an invented shape.

**The overnight move needs no second call.** `sessionClose` is the previous
session's close — the 17:00 New York roll for gold — so *where it is, with the
overnight move* is one request and a subtraction. That is the whole of the
briefing's opening line.

**And that roll is a window, which the quote used not to say.** `high`, `low`,
`prev_close` and `change` are all measured from the session open, so the same
`change` is the overnight move for the sixteen hours before 17:00 New York and
only the evening's move for the seven after it. Served as bare JSON it read as
neither, which is to say it read as *on the day* — and at 20:57 Eugenia said
gold was up $12 on the day when the calendar day was up more than $40. Both
figures were real; the label was not. `quoteWindow` states which side of the
roll the reading is on, and `readMarket` and the price sense both carry it.

Nothing here can see the calendar day. `get_trendbars` serves the broker's daily
bars, which roll on the same boundary, so the honest answer is to name the window
rather than to compute a figure out of numbers that cannot carry one.

**One rendering, three callers.** `quoteLine` is the only place a quote becomes
words — the `get_market` tool, the block the briefing is handed, and the price
sense — and the window sentence is inside it rather than beside it. A quote said
three ways is three chances to print `change` without saying what it changed
from, which is the whole of what went wrong. The tool used to return raw JSON,
which is the same failure with the field name doing the talking.

**And the briefing is handed the price rather than asked to fetch it.** Notes,
the channel map, his week of trades, the thesis, the open threads, the calendar
and his desk are all read before the call. The price — the opening line, and the
one figure he checks against his own screen — was a *tool she had to remember to
reach for*: an instruction standing where an input belongs, failing the way
instructions here always fail, with a level off a search page that is four digits
and looks like gold. The tool stays for replies, where most turns do not need it;
`marketBlock()` is the briefing's, and `agree` reads `postBriefing` for it.

**And `get_trendbars` documents a call shape it refuses.** Its own description
offers *"(count) → last N bars ending now"*; sending exactly that answers
`fromTimestamp: must not be null`. The range form is what it accepts, so that is
what is sent. Worth knowing before trusting any other combination it lists.

**`?bars=raw` asks whether a closed trade's path can be read back.** §7 calls
R-04 uncheckable because how far a trade ran in his favour is *"stored nowhere,
including at the broker"* — and `get_trendbars` serves minute bars, which are that
path. Nobody has read one: which fields a bar carries, which of the two scales
above it is on, or how far back the broker keeps them, and that last one decides
whether R-04 could reach the trades already closed or only the ones after. So it
returns fifteen minutes of `M_1` bars at six ages — now, and 7, 30, 90, 180 and
365 days back, each aged window moved to 14:00 UTC on a Tuesday to Thursday so a
weekend cannot read as missing history — raw, for `?market=raw`'s reason. One at
a time: sent together, one `504` from the broker took the other five answers
with it.

**What it found, on 25 September 2026.** Every age answered all sixteen bars in
under half a second, the year-old one included. A bar carries `timestamp` (the
minute it opens, in ms), `open`, `high`, `low`, `close` and `volume`, and a range
is inclusive at both ends. And it is in **pipettes** — `high: 428834000` beside a
spot of the same order — so it sits with `get_spot_prices` on the scaled side of
the endpoint, not with `get_positions`. That is what `best_price` is built on,
and `test/fixtures/ctrader-get-trendbars.txt` is one of those windows, unchanged.

```sh
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?positions=1" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?market=1" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?bars=raw" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
```

**Every read-only flag answers when the market is shut**, and a test holds that:
every flag the entry point reads must appear in the market gate. One left out
replies `market closed` all weekend — which is exactly when a suspicious row gets
looked at — and it fails silently, looks like the flag working, and is invisible
five days a week.

**Balance is read from a second tool, and only for a close just seen.**
`get_deals` carries no balance — eleven fields, none of them the account — and
`get_position_details` reports `balance`, `commission` and `swap` as zero on a
closed position, beside two deals that each charged 7. `get_balance` is the only
source and it answers *now*, not *after that fill*. Those are the same number
only while nothing has happened in between, so `balanceTarget` offers the figure
to one position: the most recent close, and only if it closed inside
`BALANCE_MAX_AGE_MS` (10 minutes, against a two-minute cron). Anything older
gets nothing, because a missing balance is honest and the next close supplies
one. That bound is also what makes `?force=1&hours=200` safe — a backfill folds
positions that closed days ago, every one fails the test, and no historical
balance is touched. When two positions close inside one run only the later one
is offered the balance: there is a single figure to hand and only that close
actually ended at it.

The function is whitelisted to two read tools, both carrying `readOnlyHint` on
cTrader's own tool listing, and contains no code path that constructs an order. It needs `DOJI_USER_ID` in secrets: `trades.user_id`
defaults to `auth.uid()`, which is null under the service role.

### The email parser

An Apps Script reads cTrader's TP/SL alerts, parses the fill, and posts it to
`doji-email-sync`, which merges four values: `net_pnl` (which includes swap),
`balance`, `fill_time`, and `direction` for a position the poller never reached.

**cTrader sends an alert when a stop or a target fills, and nothing when he
closes a position by hand.** It is a fact about the broker rather than about this
code, it was known to him and written down nowhere, and it cost a day: eight closes
with no `net_pnl` looked like a sync losing alerts until Gmail was searched for
their position ids and held nothing. So a closed row with `net_pnl` null is a hand
close — R-15's Friday close-out, or a breach of R-18 — and that is exactly what
`check_rules` reads it as. The only other way to reach that state is an alert the
email path lost, which is why R-18 names the trade rather than just counting it.

**The write is in an Edge Function because of where the alternative put a
password.** Supabase's `sb_secret_` keys refuse any client whose user agent
looks like a browser and Apps Script's does, so the obvious alternative is for
the script to sign in *as the trader*, with the account password sitting in
Script Properties. That constraint is about who may write, not about
where the write happens. Moving it leaves the script holding one secret whose
entire authority is five columns of one table, instead of holding the account,
and takes about fifty lines of session machinery out of the file with it.

It also puts the column whitelist somewhere it can be tested. `emailRow` is the
boundary: it builds the payload from five names rather than filtering one, so a
key that is not one of them cannot survive, and it type-checks each — an id that
is not `PID\d+`, a direction that is not `BUY`/`SELL`, a `fill_time` that does
not parse, or a figure that is not a finite number is refused rather than
coerced. A **missing** figure is dropped rather than sent as null, because
`merge-duplicates` writes exactly the keys present and `direction: null` would
erase a correct direction rather than leave it alone.

**The script refuses a fill it cannot read in full.** Four of the five values
are required — `id`, `direction`, `fill_time` and `net_pnl` — and if any of them
does not parse, nothing is sent: the thread is labelled `doji-parse-failed`, the
subject is logged, and the repair is to fix the parser and run
`resetDojiLabels()`. `net_pnl` is required for the reason given below, and a row
written without it would look complete while carrying the computed figure
forever. `balance` is the one value allowed to go missing, and the one that can
afford to: the poller writes that column too, `where balance is null`, so a
dropped balance is repaired on the next poll.

That is also why each value is read from **one** label rather than a list of
candidates. A rename then fails loudly instead of half-writing, where an alias
nobody has ever seen might match some other line and file the trade wrongly.

**The fill time is day first.** cTrader writes `19/08/2026`, which is August the
19th, and the saved alert cannot prove that on its own: a parser that swapped the
two would produce `2026-19-08`, which is not a date at all and which the fixture
tests already reject. What they cannot see is a reading that is wrong only when
both numbers are plausible months — every fill from the 1st to the 12th, filed in
the wrong month with every other figure correct. A separate test pins `05/08/2026`
to the 5th of August for exactly that.

**`net_pnl` is the one nothing else can supply, and it is why this script
stays.** `computed_pnl` is arithmetic over the deals — entry, exit, volume,
commission — and swap appears in none of them, so a position carried through the
17:00 New York rollover is only ever settled correctly from the email.
`get_position_details` does report a `swap` field and it reads zero, but so does
its `commission` against deals that charged 7: the object is hollow rather than
genuinely swap-free, and nothing has yet tested it on a position actually held
overnight. Until something does, the email is the only settled P&L in the
system.

The other three the poller could now reach — `balance` from `get_balance`,
`fill_time` and `direction` from the deals themselves. They stay here because a
second independent path into the table costs nothing and the poller is otherwise
a single point of failure for everything.

**Permanent failures and transient failures are different, and there are now
three answers rather than two.** A body that does not parse is permanent and
labels the thread so it leaves the queue. A `400` from the function is also
permanent — it means this fill will never be accepted, and retrying it every
minute for ninety days is the only alternative. Anything else, including no
response at all, is transient and leaves the thread *unlabelled* so the next run
retries it. Treating a transient failure as permanent is how a momentary outage
used to discard a fill's P&L forever, and it is the case
`test/parse.test.mjs` was broken against on purpose to confirm the check fires.

**Permanent is a statement about the row, not about the caller**, and the list
is short on purpose: `400`, `409` and `422` — malformed, a constraint, an
unprocessable value. Postgres examined that row and will never take it.
Everything else is the caller, the connection or the deployment: a rotated
`SB_SECRET_KEY` answers `401`, and treating that as permanent would label every
queued thread failed and discard each fill's P&L for a fault that has nothing to
do with the fill. The two mistakes are not symmetrical — retrying something
permanent costs a thread sitting in the queue, which is visible and harmless.

The alerts are also the early warning if the MCP token is ever misused, so leave
the notifications on regardless of whether you read them.

---

## TradingView

**`doji-tradingview` holds the TradingView sign-in, and nothing else here does.**
What TradingView adds is the half of the market the broker cannot serve: the
economic calendar as data rather than as a page Eugenia transcribes, and the
dollar and the yields that gold is priced against. Every read of it will come
through this function. **Her calendar is the first thing she is handed from
it** — see **The event spine**. `?tools=1` said what the endpoint offers, and
`?probe=` says what each useful tool returns, raw; each reader is written
against those answers. That is the
order the poller's `?market=raw` and `?positions=1` set, and it is how the
poller's two price scales were found rather than guessed. It earned its keep on
the first call: the tool names TradingView serves (`mcp-tv-get-economic-calendar`)
are not the ones its documentation gives.

**A function of its own, for the poller's reason and one more.** The endpoint
that serves the calendar and the quotes also serves, on the same credential,
eleven tools that change his account: alerts created, updated, paused, resumed
and deleted (`mcp-tv-delete-alert` among them), and watchlists created, renamed,
edited and deleted (`mcp-watchlist-delete-watchlist`). None of them can trade,
but all of them are his account, so the token stays out of Eugenia exactly as
the cTrader token does. And the sign-in ends in a callback that a
browser reaches carrying no secret, which has no place in the function that is
her Telegram webhook.

**Connecting it.** It needs the Essential plan or above; trials carry no MCP
access. It needs no new secret either: it checks `DOJI_CRON_SECRET` and writes
with `SB_SECRET_KEY`.

1. Run `supabase/016_tradingview.sql`. It is safe to re-run.
2. Let the deploy workflow ship the function from `main`.
3. Ask it to start a sign-in:

   ```
   curl -s -H "x-doji-key: <DOJI_CRON_SECRET>" \
     "https://<project>.supabase.co/functions/v1/doji-tradingview?connect=1"
   ```

   The answer carries `open_this`, the sign-in address. It also says how the
   function registered itself (`registered_by`), which scopes it asked for
   (`scopes_asked`) and which ones TradingView offers (`scopes_supported`). If a
   read-only scope is on that list, it is worth knowing: a token that cannot
   delete anything would make the function's allow-list a second wall rather
   than the only one. Asking again starts over, and the sign-in it replaces
   stops working at once. Dynamic registration mints a new client each time,
   and an old refresh token kept beside a new client would fail on first use.
4. Open `open_this` in a browser, sign in to TradingView and approve. The
   browser comes back to `/callback` carrying `code` and `state`, or `error` if
   the sign-in was refused, and the page says whether it connected. It also
   says whether TradingView issued a refresh token. Without one, the sign-in
   ends when the first access token does.
5. Ask what TradingView offers:

   ```
   curl -s -H "x-doji-key: <DOJI_CRON_SECRET>" \
     "https://<project>.supabase.co/functions/v1/doji-tradingview?tools=1"
   ```

   That answer is what the next readers are written against: every tool's name,
   its input schema and its `readOnlyHint`.

**Without a terminal, the SQL editor makes the same call.** `pg_net` is what the
cron jobs use, and the secret comes straight out of Vault, so it is never copied
anywhere:

```sql
select net.http_get(
  url := 'https://<project>.supabase.co/functions/v1/doji-tradingview?probe=gold',
  headers := jsonb_build_object('x-doji-key',
    (select decrypted_secret from vault.decrypted_secrets where name = 'doji_cron_secret')),
  timeout_milliseconds := 60000
) as request_id;
```

and a few seconds later, with the number it returned:
`select status_code, content from net._http_response where id = <request_id>;`

**What it may read is TradingView's own answer, not a list typed here.** The
`?tools=1` capture is kept whole in `test/fixtures/tradingview-tools-list.json`:
35 tools, 24 marked `readOnlyHint`. `ALLOWED_TOOLS` names six of those 24, and
`agree.test.mjs` holds every name on it against the capture. It also derives the
eleven that write from the same file, and fails if any of them is named in the
function at all, so a twelfth in a fresh capture is banned without anyone adding
it. One of the eleven reads like a read: `mcp-watchlist-get-active-watchlist`
activates a watchlist, or creates one, when none is active. The technical
rating, analyst forecasts and the screener are read-only and stay off the list
anyway, because each is a signal by another name; fundamentals, filings,
earnings and dividends are about companies, and gold is not one.

**`?calendar=1&from=YYYY-MM-DD&to=YYYY-MM-DD` is the reader,** and the one door
where a request value reaches a tool. That follows the poller's `?hours=`, but
refused rather than clamped. `from` and `to` are whole days only, because TradingView rejects other
formats and was seen to treat a day as inclusive. At most 31 days, which is as
far forward as it serves and long enough to walk a history a month at a time.
Nothing before 2003-09-01, where its data starts. US only, because every rule
that reads a release is about USD. Each event comes back as its permanent `id`,
the minute it lands, its title, its importance (`high`, `medium` or `low` from
TradingView's 1, 0 and −1), its period, the consensus, prior and actual as text
with their unit (`200K`, `0.2%`, `$6.748T`), and its `ticker`. No consensus
stays null; a consensus of zero is `0%`. `timed` is false for what is on the
calendar without being a release. A summit was rated high and filed at midnight
under the indicator `Calendar`, and nothing that counts minutes before a print
may count it. The paragraph of description each event carries is dropped, since
she would pay for every one of them on every request.

**`?market=1` is the market around gold, as bars.** The dollar index, the two-
and ten-year yields, the ten-year real yield, silver, US crude, the S&P 500 and
the VIX. The quote batch was the natural read, and it refused on every probe:
the forex scanner's 429, then the CFD scanner's. The OHLCV read answered for
every symbol, its last bar inside the current quarter hour. So each symbol is
twenty-five hourly bars, a day's span with the current hour on the end, folded
by `foldBars` to where the first bar opened and where the last one stands, each
with its time. The real yield is FRED's daily series, a day or more behind, so
it is read in days and marked `daily`. The symbols, their spoken names and
their units live in one list, `MARKET`; a symbol that fails is named in
`missing` rather than dropped. Eugenia renders it with `aroundList`, which
states every line as a level beside the level at a stated time and computes
no change, because a move served without its window is how an evening's move
was once called the day's. It is handed to the briefing and the move look, and
a read that fails is a sentence telling her not to quote the dollar or yields
from a search.

**`?news=1` is gold's and the dollar's headlines, for the move look.** A move
with nothing on the calendar behind it is the one look that has to find its own
explanation, and it used to start from a web search. `foldHeadlines` merges the
two feeds — a story carried by both is one headline — newest first, each with
its title, source and time. Eugenia's `headlinesList` hands her the last hour
and says it is the last hour; she is told to read them before she searches, to
cite a headline with its time and source, and never to claim what a paywalled
story says beyond its title. A feed that fails is said, and a read that fails
sends her back to her search.

**A conversation reads both through `get_around`.** The briefing and the move
look were handed the dollar, the yields and the wires and a reply was not, so
asked why gold fell she had a web search and nothing else, against her own rule
never to quote those from one. `get_around` serves `aroundBlock` and six hours
of headlines rather than one, since a question is about the morning. Six hours
is a span the feeds, each read to a fixed number of headlines, may not hold, so
where the shorter one stops inside it the block says how far back it reaches;
a line from another day names the day. No TradingView tool was added: the
function serves the same `?market=1` and `?news=1` it already did.

**`?rates=1` is what fed funds futures price for the next three Fed meetings.**
It reads them the way CME's FedWatch does, so the odds come from prices rather
than from a page. One such page once called a hike a cut. A thirty-day contract
settles on the month's average overnight rate, so its price is 100 less that
average. A month with a meeting averages the rate before the decision and the
rate after it, weighted by the days each held. A neighbour pins one of the two
and the price gives the other. The month after is preferred where no meeting
falls in it, then the month before. Where neither is clear, or the clear one has
expired, the meeting is solved off the meeting beside it: the rate between two
decisions is one rate, whichever months it spans. Contracts are named months
(`CBOT:ZQV2026`), never `ZQ1!`, which the `fedfunds` probe showed rolling early.
For each meeting, `foldRates` returns:

- the rate before and the rate after
- the move in basis points
- the move since the rate now
- `odds`, the two outcomes either side of the move, as FedWatch splits a meeting

A meeting that cannot be solved is named in `unread`. The dates are `FOMC`, the
Fed's published schedule with the decision day of each meeting. A test fails
half a year before the table runs out and checks that every date is a
Wednesday. The table's last date is a boundary and is never priced, because the
month after it is unknown. Each read also asks TradingView's calendar for the
month's rate decisions. A decision the table does not hold refuses the whole
answer, since odds worked out against a moved meeting are a confident wrong
number. A table date the calendar does not list is a gap in a feed, not a moved
meeting, and does not refuse.

**Eugenia reads it in the briefing and through `get_around`.** It was checked
against FedWatch on 1 October. On FedWatch's own prices, the October odds came
out identical (24.9%) and December within a point. The 18:00 read differed by
two or three points, which is the bars being hours apart rather than the
arithmetic. `ratesList` states the first meeting as odds. Later meetings are
stated as basis points priced in all by then, with the share at that meeting.
That is because FedWatch shows a later meeting as the chance of each range by
then, every path summed, while the fold's odds are that meeting's own given the
one before. Both are right, but they are different numbers, so a chance quoted
for December would read as wrong beside the screen he checks it on. She is told
to quote rate odds from here and never from a search, to say they are futures
pricing rather than her forecast, and that they run at least fifteen minutes
behind. A refused or failed read is a sentence telling her she does not have
them.

**Where the speculators stand is read straight from the CFTC.** It is the
weekly Commitments of Traders count for COMEX gold (dataset `72hh-3qpy`, code
`088691`), and it needs no credential, so Eugenia reads it herself rather than
through this function. `positioningList` gives the managed-money net, its long
and short sides, and the week's change. It sets these against the net's range
over the past 52 weeks, because crowded only means something against its own
past. It also gives the Tuesday the count was taken, because it is days old
when it is released and a shutdown has stopped it for weeks. Two readers get
it: the Sunday briefing and `get_around`. A weekday briefing would carry the
same lines five mornings running. The move look is left out because a weekly
count cannot be the cause of a quarter-hour move, and offering it there is the
plausible cause that path is told not to invent. She is told to use it as
background, in one sentence at most, and never as a reason to trade.

**A refusal can arrive marked as success.** The quote batch refused with
TradingView's own 429 inside a result marked `isError: false`, with `success:
false` in the payload. `unwrap` checks both, and a test holds it to that real
answer. It reads `structuredContent` rather than the text block, which carries
the same payload a second time as a string.
`test/fixtures/tradingview-calendar.json` is eight events cut from the 1 October
calendar probe, one for each shape the fold has to handle.

**`?probe=` is fixed, and nothing in the request reaches a tool.** It picks one
of seven and every argument is written in the function. Each call's failure is its
own answer, as `?bars=raw`'s are:

| `?probe=` | what it asks |
|---|---|
| `calendar` | the next three days of US events, and the past week at high importance, to see whether a release that printed carries its actual beside the forecast and the prior |
| `quotes` | whether the quote batch answers for the dollar, the two- and ten-year yields, the real yield, silver, oil, the S&P and the VIX with no forex symbol in it — it refused twice with the forex scanner's 429, taking the whole batch with it — and each one's last bars from the OHLCV read, which answered where the batch did not, with the bar times saying how fresh each feed is |
| `gold` | the broker's quote through the poller and TradingView's gold feeds read in the same second, plus the last three one-minute bars, which say how stale a TradingView quote is |
| `news` | headlines for gold and the dollar, and what one carries |
| `econ` | which US price and money series exist, the actual releases a calendar entry would be judged against |
| `search` | the names gold's feeds and a real yield go by, for whatever `quotes` could not resolve |
| `fedfunds` | whether thirty-day fed funds futures answer, under the continuous names (`ZQ1!` to `ZQ3!`) and under named contract months, and what a bar of them carries — the price `?rates=1` works the meeting odds out from |

**How the sign-in is found.** It is OAuth 2.1 as MCP specifies it, and it is
discovered rather than configured. The only TradingView address in the file is
the endpoint itself. Its 401 points at its metadata, the metadata names the
authorisation server, and that server's metadata names the rest. The function
registers itself whichever way the server offers. It prefers a client metadata
document: the `client_id` is the URL `/client` serves, and the server reads who
Doji is from there. Otherwise it uses dynamic registration. A server that
offers neither stops `?connect=1` with an error listing what it did advertise.
It is a public client, so PKCE with S256 carries the proof, and a server that
does not advertise S256 is refused. `/client` and `/callback` are the only two
paths that answer without the secret, because neither caller can hold it.
`/callback` acts only on a `state` that `?connect=1` stored, compares it in
constant time, and clears it once the sign-in lands.

**The tokens live in a table, which the poller's contract says a token never
does.** An OAuth server may rotate the refresh token on every use, and a
function cannot rewrite its own Edge secrets. A token kept there would survive
exactly one refresh. So it is one row in `tradingview_auth`: RLS on, no policy,
revoked from both public roles, and `verify.sql` asks all three. A refresh that
brings no new refresh token keeps the one it had. Storing the absence would end
the connection at the next expiry with nothing to say why, and a test drives
two refreshes against a rotating server to hold that. The table is not in the
memory backup and must not be, because a live refresh token in a workflow
artefact is the account.

**One renewal at a time, by a lease.** A server that rotates may treat a
refresh token presented twice as stolen and revoke the whole sign-in, and the
briefing and the release look can find the token stale in the same second. So a
renewal first takes the lease `017_tradingview_lease.sql` adds, with a PATCH
filtered on it being empty or lapsed. That is `balance`'s arbitration: Postgres
evaluates the filter inside the UPDATE, so there is no read to lose a race
against. A caller that does not get the lease waits for the token the holder
writes. The holder reads the row again once it has the lease, because another
caller may have renewed in between, and the refresh token it first read would
then be the one just spent. The new token and the release are one write. A
holder that dies leaves a lease that lapses on its own after thirty seconds.
Three tests drive it against a stub that filters the way PostgREST does: two
refreshes against a rotating server, two callers at once, and a caller that wins
the lease after someone else renewed.

**Gold's own price is still read from the broker, and that was measured.** The
gold probe read both in the same second: cTrader's bid at 4162.17 and
TradingView's Pepperstone feed at 4162.45, off a one-minute bar that had opened
two seconds earlier. TradingView's feed is the same broker's price and is live,
not better. The broker's is the price his stops and fills happen on, so it
stays; what TradingView adds is everything around gold.

---

## The two bots

**Gladys** collects the journal. **Eugenia** does macro. They are separate bots
with separate tokens and separate threads, and they share nothing but a chat id
and the cron secret — Gladys writes four journal columns and reads no market;
Eugenia reads the web and writes no trade.

That split is deliberate. Gladys is deterministic, answers in milliseconds and
must never change; Eugenia calls a model, takes seconds, costs money per message
and will be tuned constantly. Putting them in one function would mean
redeploying the thing that writes to `trades` every time a prompt is reworded.

What they do share is a definition rather than a copy. `_shared/edge.ts` holds
`env`, `secretMatches`, `json`, `sbHeaders`, `telegram` and `nyClock`, and each
bot binds its own token in one line: `const tg = (m, b) => telegram(BOT_TOKEN, m, b)`.
The test is not "could this be shared" but "are there two copies nothing can
compare" — `sbHeaders` and the Telegram call were byte-identical in both bots,
and the two New York clocks differed only in fallbacks neither could reach.

---

## Gladys — the Telegram journal

When a position opens, the trader gets one Telegram message and answers the
whole journal from it — setup and all three discipline booleans — without
opening the app. Journalling the same trade anywhere else redraws that message
rather than leaving it behind. `supabase/002_gladys.sql` holds both triggers and
`doji-gladys` is the Edge Function behind them.

**A function is named after who it is, and so are its secrets** — `doji-gladys`,
`GLADYS_BOT_TOKEN`, `GLADYS_WEBHOOK_SECRET`. Naming a bot after the wire it
speaks over leaves no rule anybody could apply to the next one. `TELEGRAM_CHAT_ID`
is the exception and earns it: it is the one value the two bots genuinely share,
because there is one trader and one chat, with a thread each.

**One function, two callers**, told apart by which secret they present:
`x-doji-key` is the database — a position opened, or its journal answers moved —
and `x-telegram-bot-api-secret-token` is Telegram reporting a tap. They were
briefly two functions and share everything that matters — the keyboard, the
message, the `callback_data` grammar — so splitting them meant deploying that
code twice and keeping the copies in step.

She opens with `Hola Jefe, new fill below`.

**One message, edited in place.** Four rows of buttons — the two setups, then
Rules, Stop Loss and Take Profit — answerable in any order. Each tap writes one
column and redraws the message, and the fourth answer settles it to a two-line
summary with an `[Edit]` button. One thread entry per trade, not five. There is
no text-reply path: a tap is the whole vocabulary.

`[Edit]` reopens the form and adds a fifth row, `[Done]`, which collapses it
again. That button exists because nothing else could: once every answer is in,
no tap can be the fourth, so without it a reopened message stayed open forever
even if you re-picked the same values. It appears only on a complete journal —
on an unfinished one it would be a button for abandoning it.

**It fires at open, not at close.** The poller mints the row from the entry deal
alone, so all four answers are null at that point and the message asks for all
four. The app has always allowed journalling an open position; this is that,
from the notification.

**`callback_data` is the entire state a tap needs.** `PID562780708|setup|Break &
Retest`, `PID562780708|sl|1`, `PID562780708|edit` — the trade, the field and the
value, in 39 bytes at worst against Telegram's 64-byte cap. So there is no
session table and no schema change on the tap path: the callback also carries
the chat and message ids that `editMessageText` needs. A tap is self-describing,
and a redeploy in the middle of answering costs nothing.

**A write from anywhere else has none of that, which is why the message id is
kept.** Journalling a trade in the app used to reach Telegram not at all — the
message sat on `Setup: —` for the life of the trade, because nothing knew which
message to edit. So `postOpen` stores what `sendMessage` hands back in
`trades.tg_message_id`, and a second trigger, `trades_telegram_on_answer`, fires
whenever any of the four journal columns actually changes on a row that has one.
The answers now travel in both directions: a tap reaches the app through the
realtime subscription it already holds, and a save reaches Telegram through this.

That trigger watches the four columns with `is distinct from` rather than `<>`,
because they are three-state — `<>` is `NULL` against an unanswered one, a `WHEN`
clause that is not true does not fire, and the *first* answer to every question
would be the one redraw that never happened. It needs no time guard, unlike the
open trigger: this edits a message rather than posting one, so a restore from
backup asks Telegram to redraw each message to what it already says, which is
refused as `message is not modified`. A row with no message id fails the clause
outright, so an email-first trade stays silent for good — correctly, there was
never a message.

`[Edit]` and `[Done]` say plainly which way the form should move. An **answer**
is the case that has to be decided, and it is decided from the row **as it stood
before the tap** — which costs one extra read per tap and is what the question
is really about: already complete means a correction inside a reopened form, so
it stays open; incomplete means this tap may be the fourth answer, and the
fourth answer settles it. That is what lets a two-field correction happen
without pressing `[Edit]` twice.

That decision shipped wrong once — read off the keyboard's row count, which is
true on every tap, so the message never settled and the summary, the `[Edit]`
button and the read path were all unreachable. It is `staysOpen`, it is
exported, and a test replays all four taps against it.

**Which is why the two redraws a tap sets off agree by construction.** A tap
writes, so it fires the redraw trigger as well as redrawing the message itself —
two redraws, and the trigger's is the one that lands. They cannot be allowed to
differ, so neither decides from the writer: both decide from that same
before-state, which the trigger sends as `before` and the webhook has already
read. `answered(before)` and `staysOpen` are one expression, the two messages
come out identical, and Telegram answers the second `message is not modified`.
Decide it any other way and the trigger's answer wins — so a form reopened with
`[Edit]` would shut under the very correction being made in it. `agree.test.mjs`
reads `postAnswer`'s body for that call, because nothing in the suite can drive
the function itself.

**The write is the fourth writer and it stays in the journal half.** The webhook
maps a button's field to a column through the same four names as `Data.OWNED`,
so no broker column is nameable from a tap and there is nothing to arbitrate.
`updated_at` moves, and the realtime subscription the app already holds
re-renders any open tab for free. `tg_message_id` is on neither list, which is
what keeps the column Gladys's own: no tap and no save can point her at another
message, or take a trade's own away.

**The open trigger's guard is load-bearing.** `when (new.entry_time > now() -
interval '1 hour')`. Without it, restoring from backup messages you once per row
in the file. A live fill is seconds old; everything else fails the test — restored rows
carry historical `entry_time`, an `on conflict do update` is not an insert at
all, a `?force=1` backfill updates existing ids, and the poller's own re-upserts
inside its six-hour write window are updates too. One message per trade, and the
mechanism is Postgres's rather than a de-dupe check.

A row the poller never reached — minted by the email parser, which sends no
`entry_time` — gets no message, ever. `null > anything` is NULL, so the trigger
stays silent. That is right: there was no open event to prompt from.

**Answering `followed_sl` and `followed_tp` at open records intent, not
outcome.** The message arrives seconds after the fill, long before either level
is anywhere near. Those two columns only measure respect if the edit is actually
made on the occasions it is needed — a missed edit reads as compliance, so those
two bars bias upward and nothing in the data shows it. It is the same shape as
the `null`-is-not-`no` rule: an answer nobody gave must not be counted as one.

It is said at all three places the columns are used, not only here. The trigger
that asks the question carries it; `disciplineBars` carries it, because that is
where the figure is produced and a schema comment is not in front of anyone
reading a renderer; and Eugenia's prompt carries it, because she is served both
columns through `eugenia_trades` and could otherwise report a stop-discipline
rate as a measurement. `agree.test.mjs` reads the prompt for it — deleting the
paragraph breaks nothing else, and the rate she gives still reads as a fact.

**Two failure modes are coded for rather than discovered.** A double tap sends
the identical update twice and the second `editMessageText` returns `400 message
is not modified` — the correct outcome, reported as an error, and treated as
success. Any *other* edit failure falls back to a fresh message, which is also
the answer if Telegram caps how long a bot may edit its own message. And every
path answers 200: Telegram redelivers anything else, and a write that failed is
better retried by the trader's own second tap than by a redelivery loop.

---

## Eugenia — the market bot

A daily XAU/USD briefing, a quieter look later in the morning, a look at any
number that actually lands, a word when a position opens into one, and a
conversation about any of it. **Weekdays at 08:00 ET, Sunday at 17:00 ET** — the
second is the gold open, so the week's first briefing lands exactly as the
market does. She says hello her own way — Spanish or English, whatever fits the
hour and the market — inside the first paragraph, and goes straight to the
number.

Reply to her and she answers — by typing, by voice, or by sending a chart.
`supabase/003_eugenia.sql` holds her memory and her read of the journal,
`005_eugenia_senses.sql` her meters, her calendar and the trigger that tells her
about a trade, `004_cron.sql` her clock; `prompt.ts` holds who she is,
`strategy.ts` what he decided, `adherence.ts` the thirteen rules a row can answer;
`index.ts` is the wiring.

**The conversation and what she remembers are two tables, and stay two.**
`eugenia_turns` is the conversation window, `eugenia_notes` is what she
remembers, and `eugenia_trades` beside them is a view — a saved `select`, no
rows of its own. The two tables stay two because nothing ever reads them together: notes go
in at the top of a turn, turns at the end, with different windows, different
shapes and different constraints. Merged, they would need a `kind` column, a
nullable `role`, two constraints that each say "unless this is the other kind"
and two partial indexes — more parts to hold one idea, not fewer.

**She tidies her own memory at 22:00, every day.** Notes written mid-conversation
are decided while she is busy answering, which is the worst moment to judge what
will matter in November. The nightly pass is the only point at which she sees a
whole day at once: it reads the last twenty-four hours of turns against the notes
she is holding, writes what changed and will stay changed, and retires what is no
longer true.

**It is given what it is asked to judge with**, which for two of its
instructions it was not. It is told to notice what he has started doing
differently — a claim about his trading, judged from a transcript that on most
days never mentions a trade — so the week's trades go in beside the day, the same
read the briefing already makes. And it is told to prefer superseding to adding
while holding twenty notes out of an archive it had no way to look at, so
`search_memory` is in its tool set. Still no web search: a bookkeeping pass has
nothing to research, and that argument has not moved.

**The window's limit takes the newest turns, not the oldest.** Two hundred is far
more than a real day, so it bites only on a backfill or a very long day — and
`order=id.asc&limit=200` read the *first* two hundred, which is a pass that
distils the morning and drops the evening, where a late instruction lives. The
select runs newest-first and is reversed for reading, exactly as `recent()` does.
The two are indistinguishable from outside, which is why nothing caught it — so
`agree.test.mjs` now refuses `order=id.asc` under a limit on *every* read of her
own tables rather than on the two that have already gone wrong. Ordering by a
clock is left alone: the event spine reads `at.asc` because the next release is
the earliest one.

**Its default is almost nothing.** Most days deserve no note — a conversation
about today's data leaves nothing durable, and that is the normal outcome. The
prompt pulls toward superseding rather than adding, because the visible window is
twenty and five mediocre notes push five good ones out of it.

Nothing is sent and no turn is stored: her reply is a line for the log, and
storing it would spend two of tomorrow's twelve turns on bookkeeping she wrote to
herself. `?consolidate=1` runs it on demand and is the only way to see what it
does.

**And it prints where the five channels stand, at the one moment a rung could
just have moved.** Everything else here that cannot be seen is counted where it
happens and for that exact reason — `ask()` logs tokens because the spend cap is
a ceiling and not a meter, `postBriefing` logs characters because the length
target lives past a model call. What she is *for* is that his understanding
grows, the map is the instrument built to measure it, and nothing ever read that
instrument back. A ladder that has stopped moving looks exactly like one that
never had to.

**A fixed twenty-four hours and no watermark anywhere**, because the window and
the gap between runs are the same length. A missed night loses that day's
distillation and never the day — the turns stay in the table and stay searchable,
which is what makes a lossy pass safe to run unattended.

**And it finally gets the retry the briefing has always had.** It was the one
schedule here with no meter and no second chance: a briefing that dies is retried
three times and apologised for, while a pass that died was silent, and its
symptom is that her memory quietly stops growing — which looks exactly like a bot
with nothing worth remembering. That is the same invisible-absence shape `unseen`
and `moved_on` exist to defeat, arriving a third time in a different place.

23:00 New York, still inside the same civil day, gated on whether tonight's pass
already ran. The check reads `eugenia_runs` rather than a marker turn, because
the pass deliberately stores no turn and giving it one would spend two of
tomorrow's twelve on bookkeeping it wrote to itself — so the meter that had to
exist anyway turns out to be exactly the record the retry needs. A read failure
counts as *already run*, as `briefedToday`'s does: a second pass on a guess is
worse than a skipped one. A quiet day records itself too, so the retry does not
re-run a pass that correctly decided nothing.

**It also moves the story and closes what resolved.** `set_thesis` rewrites the
running thesis — *moved* rather than replaced, since most nights it should read
as the same story one day further on — and `close_loop` closes a thread that
actually resolved. Both are nightly-only for the reason `set_channel` is: they
are judgments across days, and one exchange should not be able to redirect the
week's story.

**The schedule is decided in the function, not in cron.** pg_cron schedules in
UTC, so any fixed expression is an hour wrong for half the year and needs
editing twice a year forever. The job runs hourly and the function asks
America/New_York for its own clock — `briefDue()` for the briefing, `pulseDue()`
for the pulse, `consolidateDue()` for the nightly pass — and most of those calls
find nothing due and spend nothing. Adding the fourth schedule needed no cron
change at all, the job having always been `0 * * * *`, which is also how a
schedule could be answered correctly and dispatched by nobody: `agree.test.mjs`
reads `postScheduled` for a branch per answer `dueNow` can give. It
is the same trade `marketOpen()` makes for the poller. A test walks every hour
of a week and asserts the two never both fire, because one call cannot owe two
answers.

### The briefing is prose, with one list in it

Five slots. What happened, in two or three sentences with the conclusion first;
**why that matters for gold**, walked link by link, one sentence per step; the
calendar; one context line; one thing worth noticing.

**The calendar is the one place the prose rule is deliberately relaxed** — a plain
day label and one line per item, times in ET, one fact each. On a weekday it is
that day's releases and nothing more; tomorrow's belong to tomorrow's briefing.
Sunday's is the week, below. It reads better than
the prose around it did, which is the whole argument for it. The relaxation is
narrow and stated: the list holds times and names, `NAMED AND NOTHING MORE`, and
no mechanism goes in it. That slot is where a second chain hides.

**On Sunday the briefing is about the week it opens** (`weekBlock`). It was the
weekday briefing at another hour, and it could not see the week: its
calendar reached Monday evening, and the week was filed by the nightly pass at
22:00, five hours after the one briefing about it. So Sunday files the whole week
first (`filedWeek`, the nightly pass's own filing, which holds every row the
rolling window would) and is handed every release TradingView rates high for the
seven days ahead, in place of the rolling calendar rather than beside it. High
only, because seven days of medium is most of a page and none of it moves gold
alone; medium still reaches each morning's own calendar. The first paragraph is
where the story stands as the market opens, the teaching block walks the one
release most likely to move it, and the calendar slot is the week, a day label
per line. The week's list is not counted toward the length, in `SYSTEM` and in
`CRITIC`. It is deliberately not a look back at his week: his trades get what
they get every morning.

It used to be seven numbered sections with impact emoji, and plain-Englishing
the words inside them did not help — **seven numbered sections with headings
*are* a report**, whatever the vocabulary. The scaffolding was doing the
talking.

**Length is a rule again, and what makes it safe is what sits beside it.** It was
once a flat nine hundred to fourteen hundred characters, and with four of the
five channels at `unseen` — where §0 says *build it before using it* — that
number was the thing deciding she could not. A briefing has room for four
paragraphs of market or three plus a term built from the ground up, and a single
ceiling silently chose the first every morning.

The lesson was not *no ceiling*. It was that **a ceiling with nothing saying what
to lose cuts the teaching block**, because the teaching block is the longest
thing on the page. So the budget is 250–300 words, 400 at the outside, and beside
it a fixed order of what comes out: numbers he cannot act on, then levels he can
read off his own screen, then any sentence in the market read that could have
been written on any morning. **Never the teaching block and never an event.**
Still over means the briefing is about too many things, and the answer is to
decide which one rather than to shave the chain. Four thousand characters remains
the separate mechanical bound — it is where Telegram stops delivering one
message.

`agree.test.mjs` reads both the writer's copy and the critic's for the count
**and** for the protection, because a copy holding the count alone is exactly the
arrangement that stopped her teaching the first time.

**And what was missing was a bound on a sentence, not on a word.** Every rule
here governed vocabulary — *the gap between rates and inflation* before *real
yields*, the short name only once the long one has been said — and nothing
governed how many ideas one sentence could carry. So a briefing built entirely of
plain words still read as hard, and no rule was being broken. The rules now:

- **One idea per sentence.** Two `because` clauses or two `and` clauses make two
  sentences. Twenty words is the ceiling.
- **No em-dash aside, no stacked subordinate clause.** Short beats elegant.
- **No punchlines.** A line that is satisfying to read and takes a second to
  decode is a line he reads twice, and he will not read it twice.
- **No term used bare, and the test is whether the name explains itself.** *The
  leftover* tells a reader nothing; *the genuine part* tells them everything. The
  old rule banned inventing a name at all — and the approved draft it was written
  from leans on *the genuine part* three times, so read literally the prompt
  forbade the register it existed to produce. The case it actually fails on is
  not an invented word: it is a **market term used bare**. *"Oil has handed back
  most of the war premium"* is four plain words and one that does all the damage.
  Two ways out and no third — plain words instead, or the term with its own
  sentence saying what it is. Real names he will meet elsewhere stay: dot plot,
  retail sales, jobless claims, the ten-year.
- **Use the word you would text.** *Dearer fuel* fails that; *expensive fuel*
  passes. So does *makes gold a harder sell* over *stiffer competition for gold*.
- **No figures of speech.** *The relief in gold has been contained rather than
  clean* obeys every countable rule and still has to be decoded; *gold has only
  risen a little* does not. The rule carries that example and four more from
  her own messages, because a worked example moved her register where a
  description did not.
- **A paragraph is three or four sentences.** Sixteen easy sentences in one block
  is still a wall. The critic COUNTS this one as its last step, and every
  em-dash with it, rather than reading for it among the rest: three briefings in
  a row went through it with six-sentence paragraphs while the verdict row read
  `revised` every time. It worked: the next briefing had none over four. `TRIM`
  counts the same way now, as its last step too, because the short messages that
  week still carried paragraphs of five to seven.
- **Four to six numbers in the whole briefing**, and a number that cannot be said
  to *mean* something is one of the ones to cut. Fourteen true figures is a page
  he skims; four he remembers by lunch.

**The countable rules landed and the judgement rules did not, which is why
`WRITING` carries a worked example.** The first briefing under these rules had
twenty prose sentences, none over the twenty-word cap, the longest eighteen
words, no em-dash asides — counted, not eyeballed. The same message said *war
premium*, *dearer fuel*, *the basket* and *measured inflation*. A gate can count
words; it cannot adjudicate *is this the plainest word* from an adjective. *Use
the plainest available word* had been in the rules for days and produced *dearer
fuel lifts measured inflation twice over*.

So the rules end with a passage in the target register rather than more
adjectives about it — a model matches an example where it ignores a description.
It lives in `WRITING`, so the writer, `CRITIC` and `TRIM` are all shown the same
one.

**She answers in English whatever he wrote in, and that is the opposite of the
instinct.** He is a native Spanish speaker and writes to her in it, or sends a
voice note in it, and a model's reflex is to mirror the language it was given.
The markets he reads are in English and the vocabulary he is building is
English, so the same idea in Spanish hands it to him in words he cannot reuse
anywhere he will meet it again.

**A word of Spanish now and then, though, because she is not a terminal.** A
greeting, an aside, something said with a shrug — never a market term, never a
number, never the sentence carrying the mechanism, because those are the words
he is building. Most messages have none at all: it is seasoning, and the way it
fails is trying. Both rules live in `WRITING` rather than in `SYSTEM`, and that
placement is the whole of what makes the second one survive — `CRITIC` and
`TRIM` read the same block, and a gate that had only been told to prefer the
plainest word would take every Spanish word back out, last, every morning.

**And the Spanish is said as a native says it, which takes two halves.** The
voice can only pronounce what is written, so `WRITING` asks for the accents and
the ñ — its stress comes off the spelling. `TTS_STYLE` then asks for native
Latin American Spanish at speed: *not read as English letters* ruled out the
worst reading and asked for nothing better, and a correct, careful Spanish word
in an American mouth is still the gringo version. Slowing down to get it right
is the tell itself, and a native speaker is quickest in their own language. It
is asked for as code-switching in both directions, because the other failure is
a Spanish accent leaking onto the English around it.

**One chain is exempt from the rung, and it is the one under everything else.**
Gold pays no interest, so it competes with what a bond pays once inflation is
taken out rather than with the headline rate. `PITCH` says a channel at `owns`
gets its term bare, which is right for every term but this one: it sits under
nearly every briefing written, and a reader who has lost it has lost all of them.
Both the writer and the critic are told the map does not apply to it — the critic
especially, since it is the half that decides a mechanism it can see inside one
briefing is a repetition, which is the failure that once cut the build-up `PITCH`
had just required.

**She teaches, and that is a rule about depth rather than length.** He is
learning macro deliberately, so the paragraph on the day's one thing states its
chain link by link — *hot inflation, so the Fed waits, so the gap between rates
and inflation widens, so gold has stiffer competition* — because a cause named
with no chain under it is something to memorise rather than understand. Depth is
not word count — a longer briefing that names a cause and skips its chain has
taught nothing — but where the chain genuinely costs words, it gets them.

Three rules keep that from turning into a lecture. A term explained this week is
**used** the next time rather than redefined, since the second exposure is what
turns vocabulary into something he thinks with. A simplification is signposted
in a clause — *that is the clean version* — so he can tell a compressed story
from a complete one. And what he has shown he understands is recorded as a note,
because it is the only thing that says what **not** to explain; the five
channels double as the map of which he reasons with unaided and which he has
never once used himself.

The single closing question is sometimes one he has to reason to answer rather
than agree with. His answer is evidence about what he actually has, which no
amount of explaining produces.

**She remembers what she told you yesterday.** The briefing reads the last
twelve turns, so it opens with how yesterday's print landed rather than from
nothing. It did not until now — it wrote to `eugenia_turns` and never read back,
so every morning started blank and she could not know she had explained the same
term three times that week. A briefing that could have been written on any
morning is a failure.

The stored turn is a marker (`[weekday briefing]`), not the text that was sent:
the memory and the week's trades are rebuilt fresh each morning, and storing
them would resend a stale copy as history for the next six briefings.

**She sees your week without being asked.** The last seven New York days of
trades go in with the briefing, so *"you have not traded since Tuesday"* costs
no tool round. Mentioned only when there is something real to say, in a clause.
The one verdict that earns a line in the morning is a closed trade since the last
briefing that broke one of your rules or repeated a mistake she has seen before —
the fact, her verdict and the lesson in three short sentences, saying so if it is
not the first time, then back to the market. Most mornings the right amount to say
about your trading is nothing.

**Which rules broke is computed, not read off the rows** (`breachesBlock`). It was
"yesterday", and on a Monday yesterday is Sunday, so a rule Friday's trades broke
was never raised unless you asked. The window is now every closed trade since the
last briefing that went out — Sunday's evening briefing covers Friday — plus any
trade that CLOSED since then, which is a Friday hold closed on Monday, R-15's
whole case, open on both briefings either side of the weekend. The rules are
`check_rules`' own evaluation over that set (`readRules`, one reader for both),
so she is handed the failures rather than working them out by eye, and told so
when nothing broke. Closed trades only: a verdict on an open one is a hard
prohibition. Narrowing the set can lose a day-level failure on a partial day and
cannot invent one. Your commitments are still hers to hold the trades against.

### The pulse

Weekdays at 10:00 ET, past the 08:30 data window and into the session. **Its
default answer is silence:** she replies with the single word `NOTHING` and the
function sends nothing at all, storing nothing either — twelve turns is the
whole window and a week of empty pairs would push the morning's briefing out of
it, which is the one thing a follow-up needs.

One extra call a day rather than a check every hour. An hourly watch is
twenty-three model calls with web search behind them, which is not worth a
feature whose right answer is usually "nothing happened" — so this is **not
event-driven**, and calling it that would be a lie. It is a second scheduled
look that usually says nothing. A second hour is one line if the first proves
useful.

`isSilent()` matches the bare word and nothing else, so *"Nothing much has
changed, except gold is up forty"* is news wearing the word and gets sent. The
failure direction is deliberate: a swallowed message is invisible, an extra one
is merely extra.

### The event spine — the first thing here that is not a clock

Every schedule above fires at an hour someone chose in advance. So a print at
08:30 landed into a briefing that had already gone, and waited for a 10:00 pulse
whose default answer is silence — the one moment of the day when something
genuinely happened was the moment she was least likely to speak.

**The calendar is filed for her, from TradingView.** `fileCalendar` reads
`doji-tradingview?calendar=1` for the days around now, through the cron secret
she already holds, and upserts every timed US release rated medium or above into
`eugenia_calendar` under TradingView's own id (`018_calendar_tradingview.sql`).
Each row carries the time, the name with its period (*Core PCE Price Index MoM
(Aug)*), the importance, the consensus and the prior, and the actual once it
prints. Two callers file it: the briefing, before it reads the calendar, and a
**quarter-hourly job** before it asks one question: **which release time has
landed and not yet been looked at?** If there is one she reads what those
printed and decides whether it is worth saying. Low-rated items (mortgage rates,
rig counts, bill auctions) are not filed, because every one would be in front
of her on every request and none moves gold on its own. Every filing is a row
in `eugenia_runs` under `calendar`, failed or not, because a calendar that
quietly stopped moving looks exactly like a quiet week.

**She used to type it in, and most of what went wrong here came from the
typing.** The key was `(at, name)` over a name the model wrote, so one CPI
arrived as `August CPI`, `core CPI`, `US CPI (core CPI)`, `US CPI (August)` and
`headline CPI`: five rows laid down by four turns across five days. Her
importance came off a search page and had to be corrected against Forex
Factory's folder. TradingView keeps an id for every release, so one release is
one row whatever it is called, and nothing she can call is able to create one.
What she had filed for the days ahead was deleted when 018 was applied, since
TradingView's rows for the same releases arrive under other names; what had
already printed stays, as the history this table exists to grow. On the day 018
went in, that meant the morning's claims and ISM were each listed twice, her copy
beside TradingView's, until they aged out of the window — and hers, carrying no
actual, read as still **due** hours after the print. `calendarList` marks a row
with no figure **PAST** once its time has gone, which is also every speech, all
day, and every print whose number has not reached the calendar yet.

**A figure TradingView has not published is left out of the row, never sent as
null.** `merge-duplicates` writes exactly the keys a payload names, so a filing
carrying `actual: null` would erase an actual the release look recorded by hand
fifteen minutes later. Rows go up grouped by the columns they carry, because
PostgREST refuses a bulk insert whose objects do not all name the same ones.

**The look waits for the number, and not for ever.** TradingView publishes an
actual a minute or two after the print. A due group still missing a figure is
left unmarked for the next quarter-hour until thirty minutes have passed
(`awaitingActual`), and then it looks anyway. A speech has no consensus and no
prior and is looked at on time, since nothing is coming.

**And the look reads a release against its own record.** Each filed row carries
TradingView's `ticker` (`020_calendar_ticker.sql`), the series a release belongs
to, where the id names one release only. The release look is handed the last
twelve prints of each series in the group, oldest first, each as printed against
what was expected (`recordList`, read by `recordQuery`). They are listed, never
scored: the figures are text, and a surprise worked out by parsing "0.2%" into a
sign is a chance to get every unit backwards. Reading the record is her job.
`RELEASE` asks her to say whether a miss runs the way the series has been
missing, or is the first the other way in a long time.

**And it is handed what the last print became.** A release revises the one
before it. TradingView carries the revised figure as the new row's `prior`,
while last month's row keeps the figure first reported, so the revision is the
two disagreeing. On 2 October payrolls missed by sixty thousand and August came
down from 162K to 133K in the same report, which is half the story.
`revisionLine` reads it off the same record read, with no new query: *"Revised:
Non Farm Payrolls (Aug) was first reported at 162K on 4 Sept, and this release
revises it to 133K."* It compares only against the print immediately before.
The newest row on file is last month's only if none is missing, so a gap half as
long again as the one before it, whatever the series' rhythm, says nothing
rather than report two months apart as a revision. `RELEASE` tells her to say a
revision beside the miss and never to work one out herself. The briefing does
not carry it: a revision is published with the new report, so at 08:00 there is
none to show yet, and the look right after the print is where it lands.

**The question is about the time rather than the row.** The 08:30 slot is most
of a report, and while she typed the calendar each spelling of one print fired
its own look, its own model call and its own message — five for a single CPI on
11 September. `dueRelease` takes the earliest release time nothing has looked at
and every high row standing at it, so several numbers landing together are one
message, which is how a person reads "the 8:30 data" anyway. `looked_at` is what
makes that once-only; it is stamped **before** the look for the reason the
briefing marker is, since a look that generates and fails to write would
otherwise repeat every fifteen minutes, each one a billed call.

It is a second schedule rather than a faster one, because the four hourly
predicates all test `hour ===` and a `*/15` job would have run four briefings
every morning. `?release=1` is its door and the way to exercise a look by hand.

**A look fills a release in and cannot file one.** Where TradingView has not yet
published a figure, the look searches for it and records it with
`record_actual`, a **PATCH and nothing else**. It matches an entry on `(at,
name)`, writes `actual` and `note`, and has no insert path at any spelling. An
upsert keyed on a name the model writes was once handed `US retail sales
(August, advance)` and filed the print under `retail sales` — an insert, the
actual on a row with no consensus and the consensus on a row with no actual. It
cannot touch `consensus` or `prior` either, which are TradingView's. A name
matching nothing is a 200 with an empty body, which reads exactly like a write,
so it answers with the names actually on file. The look is handed the UTC stamp
beside the ET heading, because the tool matches on the instant and asking her to
convert is a conversion standing where an input belongs.

**A speech is recorded by its line alone.** A speech TradingView rates high is
looked at the moment it lands, and the look is told it may add one line on what
it meant either way — but the tool demanded a figure, and a speech prints none,
so a Chair's press conference left no record at all. Either half may come
alone now, and an absent key is left as it was, so a line written after the
figure never erases it. A past row with no figure shows its line, which is the
only thing in the calendar saying what was said. Speakers rated medium get no
look, and covering them would mean web search in the nightly pass, which has
nothing to research by design; the next briefing searches them when they matter.

**And the row records when its content was last written.** Two writers hours
apart on one row means `created_at` says only when each was first seen — so when
duplicates disagreed about what a number printed at, nothing could say which
figure was the later one. `updated_at` moves through a trigger, the same shape
`trades` has used since `001`, but **not on a mark**: `markLooked` writes
`looked_at` and nothing else, and an unconditional touch made the column say when
a row was last *handled*. On 16 September the row carrying the stale prior was
marked at 12:35:00 and the row carrying the actual was written at 12:36:15 — it
ordered correctly by seventy-five seconds. Reverse them and the column answers
the opposite of the truth in the one question it has. The trigger compares the
row as `jsonb` less `updated_at` and `looked_at`, rather than against a list of
the other columns, so a column added later is compared without anyone having to
remember it.

**Every message she composes is read once more before it is sent, and for most of
them that is new.** `CRITIC` ran on the briefing *alone*. The pulse, the release
look, the move look and the reply went out unreviewed for their whole lives —
which is most of what arrives in a week, and it is exactly where the writing
rules were being ignored with nothing to answer for it.

**The reply was the one with no argument behind it at all.** It was never
exempted; it simply was not in the list the day the gate was written, and it is
the busiest thing she sends. The case made for leaving it out afterwards was
wrong twice over: `TRIM` reads `WRITING`, and `WRITING` is where *English,
always, whatever he wrote in* lives — so the one path he writes Spanish on was
the one path with nothing checking the rule written for it. It is gated INSIDE
the typing indicator, because clearing the ping first leaves three silent
seconds in which she reads as having finished and then said nothing.

**And what is remembered is what the gate returned.** The three callers that
gained a gate went on storing the DRAFT — a message he never read, filed as her
own words and resent as history for six exchanges, which is the stale copy
`remember` already refuses for the notes and the week's trades, arriving through
the door the gate itself opened. The briefing never had that fault; it stored
what `critique` returned from the day it existed.

`TRIM` is that gate, and it is **not `CRITIC` with a shorter prompt**. The
briefing's checks ask whether the first sentence is true only today, whether the
chain is complete in the paragraph that matters, whether there is more than one
chain, and whether it runs to 250–300 words. Every one is a question about a
briefing; asked of three sentences they would demand a chain, complain about
length, and rewrite a good message into a bad one. `TRIM` asks the writing
questions and nothing else — off the same `WRITING` the writer was given — and is
handed no notes and no channel map, because it is not judging whether a term was
built. It **is** handed what you have on right now, because her read on price is
allowed and a read while you are in a position is not, and a gate cannot tell
those apart without the block that says which. It runs on Sonnet.

**Both gates are handed the story she has been carrying, and check one fact
against it: the direction.** Twice in one week she wrote "October rate cut odds"
while the Fed had just hiked, both times inside a message whose own reasoning was
about a hike. So she knew, and the phrase she had seen most often came out
instead. Neither gate could catch it: they judged how she writes and held nothing
saying which way things were going. Now a "cut" where the story says "hike" is
changed to match, unless the message says the story itself changed today and why.
The check is only as good as the story, so the nightly pass is told to write the
direction into it — which way the central bank last moved, and which way the
market is betting next. The rule is written once, `AGAINST_THE_STORY`, and both
gates read it.

**The trade event stays out, and the reason first given for it was wrong.** It
said there was no composed prose to trim. Both branches do decide *whether to
speak* from data before any model call — which is why an ordinary fill costs
nothing — but the one that speaks then calls the model with the conversation
window, her notes and two tools, and writes two sentences. That is composed
prose by any reading.

What exempts it is the gate's own shape. `TRIM` **rewrites**, and this message
reaches him while he is in a position or has just breached his day. The one thing
that must never happen on this path is a sentence that reads as an instruction,
and a gate paraphrasing a citation of his rule is how one becomes an order. That is a failure already seen once here — a gate
not told the no-direction rule could take a compliant message and hand back one
that broke it. `TRADE_EVENT` is also the most constrained prompt in the file —
two sentences, the fact then the rule, no greeting, `NOTHING` as an explicit way
out — so little of what `TRIM` checks is reachable inside it.

`gate()` holds the half that makes either one safe — a revision failing
`keepDraft` is overruled, and a gate that *throws* costs nothing. Copied, that
catch is where one gate loses the message it was checking on the day a vendor is
slow.

**And what a gate decided is a row in `eugenia_runs`, not a console line.** The
first three days with a gate on every path showed the paragraph rule broken in
nearly every message that went through one — five, six and seven sentences where
`WRITING` asks for three or four — and nothing could say why. The model call was
recorded, so the gate had plainly RUN; whether it then sent its revision, handed
the draft back unchanged, or was overruled by `keepDraft` was written to a log
nobody reads. Those are three different repairs. Every gated message now leaves
one `trim verdict` or `critic verdict` row — `revised 1840 → 1795`,
`unchanged`, `kept the draft`, or `failed, the draft went` — so the rows count
the messages, and a gate costing sixty seconds on a long reply can be seen
earning it or not.

And **`keepDraft` is relative now**. A flat 400 characters is a *briefing's*
floor: shorter than that and what came back was an apology. A release look is two
or three sentences and often under 400 to begin with, so that floor overrules
every revision there is — and a gate overruled every time looks exactly like a
gate that agreed with the draft.

**And its ceiling is each gate's own.** The critic may put back a missing link or
a missing verdict, so a briefing can grow, up to twice the draft. `TRIM` only
cuts and swaps words, so it may grow a quarter (`TRIM_MOST`). At twice, a
541-character reply came back at 852 on 30 September with `TRIM`'s own notes on
the message above it — *"this message looks fine as is…"* — and that went out and
was stored as hers. Every other trim that fortnight stayed within a tenth.

**One chain per briefing, not one per event.** Every scheduled thing that
matters still gets named — he needs the day, and on Sunday the week — but only
one of them gets its mechanism walked. Nine subjects each carrying a clause of
chain is not a thorough briefing, it is a survey, and it drifts there precisely because every
clause looks justified on its own. The round-up slot now says so itself: named
and nothing more, no mechanism at all. `CRITIC` holds the same rule, because the
critic runs last and a rule loosened in one place and left standing in the other
is a rule the critic puts back every morning.

**Its default is silence**, on the pulse's reasoning exactly: a number landing
where everyone expected it is not news. `isSilent` is shared with it rather than
written twice.

**And a trade reaches her in two minutes.** `doji-mcp-sync` writes a position
almost as it opens, and nothing told her: a trade taken at 10:47 arrived the next
morning as one row inside a week of JSON. A trigger on `trades` now calls her,
and the two things she is allowed to say are both **his own rules read back at
the moment they apply**:

| Event | What she may say |
|---|---|
| opened | a high-impact print is pending and he is now in a position — R-14 is about standing aside before one, R-19 about a position inherited into one |
| closed | that fill took the day past −4% of the account his size implies, and R-11 says the day ends there |

Naming the rule is citation; saying what he should do about it is not hers and
the prompt forbids it in those words. **Silence costs nothing and is the common
case**: both branches decide from data *before* any model call, so no pending
print and no breach means the function returns having spent nothing. A trade
event that always ran a model call would be a bill attached to every fill for a
message that usually should not be sent.

**"Pending" means filed, and the calendar was filed a morning too late for the
trades that need it most.** The check reads her own calendar, and her calendar
is filed by the 08:00 briefing — which reached twenty-four hours ahead, so it
stopped at 08:00 the next day. Tomorrow's 08:30 and 10:00 prints, the biggest
there are, went in only at tomorrow's own briefing, and every trade opened
before it checked an empty calendar and said nothing. On 25 September an entry
around 07:38 was silent about the 10:00 Michigan print while the 09:38 entry
was warned about the same release. The London session is that window every
morning. The briefing now files today's calendar and tomorrow's up to noon New
York, the window she is handed moves with it so she never files what she cannot
see, and every calendar line from a day other than today names its day — at this
width two mornings each have an 08:30, and a time with no date reads as today's.

The trigger fires on the transition and not on every poll. `fill_time` is null on
every open position, so the close clause compares with `is distinct from` — `<>`
is NULL there, a `WHEN` that is not true does not fire, and the one event it
exists for would be the one that never happened. The poller re-upserts every
position in its window every two minutes, which is what the guard is holding off.

### The price sense — the third thing that wakes her, and the first with no row behind it

The two senses above are events: a print she filed lands, a position opens. Both
are noticed by asking whether a row is there. **Gold is always there.** "It
moved" is not a fact about the instrument at all — it is a fact about the
instrument *and* a previous reading — which is why this one needs a mark and the
other two need none.

`eugenia_price` is that mark: one row, `bid` and `at`, rewritten every quarter
hour by its own cron job. The move is a subtraction, and the window it is
measured over is the gap between firings rather than a number anyone chose.

**What makes a move worth waking her for is the day's own measure.** Gold at
4,400 and gold at 2,000 are the same market, and a fixed $10 threshold means two
different things to them; a table of thresholds goes stale the year nobody
revises it, and that failure looks exactly like a quiet market. So the test is
relative twice over, and the two halves bind at opposite ends of the day:

| Gate | Value | What it is for |
|---|---|---|
| `MOVE_SHARE` | 0.35 of the session range so far | the bar itself — what the move is measured against |
| `MOVE_FLOOR` | 0.0025 of the price | the smallest bar worth applying; below it the session has no range to judge against and she says nothing |
| `MARK_STALE_MIN` | 40 minutes | two missed runs and the gap is no longer a quarter of an hour — $15 in fifteen minutes is an event, $15 across an hour is a session |
| `MOVE_QUIET_H` | 2 hours | one message about one move; a market that trends all afternoon is one story, and this is the only thing between it and eight messages before lunch |

**The share is measured against the BROKER'S session, and that session restarts
every weekday at 17:00.** From the roll until the range has been rebuilt, the
share is taken against a few hours of thin evening trade — so the range is small
because the session is *young*, not because the market is quiet.

**The two gates used to stand side by side, and that is what broke it.** A range
near zero made the share stop binding, leaving the floor as the whole test for a
third of the week: a bar written for a full day's trading, carried alone through
the thinnest hours. An earlier pass saw this and reasoned that the share could
not be fixed from here, since nothing this system reads spans the calendar day,
so the floor had to be raised until it was an event in the thin hours too. That
was the wrong of two options, and there was a third: **refuse to judge.** A
session with no range yet is one the share cannot be applied to, and silence is
a better answer than a lower standard.

So the floor bounds the **bar** rather than standing beside it. If
`range × MOVE_SHARE` is under `price × MOVE_FLOOR`, the session is too young and
she says nothing. A move under a quarter percent of the price is still never
reported, since the bar is never below it — what changed is the composition
rather than either number.

What the old shape cost is in his own `/notes`: a $13 drop just after the Sunday
roll on 6 September and a $17 one just after the next roll on the 13th, both
filed as unexplained open threads and neither ever closed, because there was
nothing to explain. The one real find in that run — $33 at 11:12 on a
Wednesday — cleared both gates on its own and still does. **A sense that
manufactures a loop it cannot close is worse than a quiet one**, because the
loop then rides into every briefing after it.

The evening bar is now *higher* than the midday one, which is the intent rather
than a side effect. A real evening move is not silenced by it, because a real
move is the range: a $35 fall takes the low with it and clears its own bar.

**Both things the trade look may say are about today, and it checks.** The
trigger fires on a transition rather than on a clock, so anything that stamps an
old close — a `?force=1` repair, an email landing late, the poller's first
`fill_time` backfill — used to fire it for a finished day. It reported the 11th
and 19th of August in the present tense, three weeks on. `open_day` against
today's New York date returns before either branch. An overnight hold closing
this morning is filed under yesterday and is skipped with them, which is correct:
R-11 forbids an entry *later* than the breaching loss, and a day that is over can
have no later entry.

**And a move a print explains is not this sense's to report.** The spine is
already looking at anything high-impact that landed, so a jump at 08:30 on
payrolls would otherwise reach him twice in ten minutes saying the same thing.
The calendar she filed is what tells them apart — anything `high` inside the last
hour hands the move to the spine and this stays quiet.

`looked_at` on that same row is the quiet window, and it is the one column
written conditionally: the mark advances on **every** run and `looked_at` only
when a move cleared the gates. Written unconditionally the window would never
reopen and she would say one thing about a move and then nothing for the life of
the deployment.

**Silent by default after all of that.** The gates decide something happened;
only she decides whether it is worth a sentence, and `isSilent` is shared with
the pulse and the release look. The prompt pushes hard against the failure that
belongs to this path specifically: a search will always return *something*, so an
unexplained move must be told as an unexplained move — what it did, and that she
cannot yet see why — rather than as a cause she reached for. That is what
`open_loop` is for.

**A thread that cannot close fills the list that holds the ones that can.**
`readLoops` takes the newest ten, and the window filled: six watches and four
questions. The eleventh loop pushes the oldest out of what she is *handed* while
leaving it open in the table — so it can never be closed by anyone who cannot
see it. That limit takes the newest rows, which is the right end; what the rule
assumed underneath it is that threads close at all.

Two kinds could not. A move filed as unexplained when nothing had actually
moved, which the gate above now prevents. And a question he does not answer,
which closed only on an answer: the nightly pass was told to write a *note*
about a week-old question rather than close it, so it wrote one — *"he engages
by instruction, not by reply"* — and nothing acted on it. **A question he has not
answered in a week he has answered.** It closes now, with a line saying so, and
the note is still written. A watch is untouched by that: age proves nothing
about an odd reaction, which may still explain itself.

**And the briefing has stopped asking altogether.** The slot existed to learn
what he actually holds, and over eleven days it produced four questions, four
open threads and no answers — a slot whose only output is an open thread is not
measuring anything. He reads the briefing on a phone and engages by *instruction*
rather than by reply, which is a channel that works and needs no slot.

The scope is the half that matters. Cutting questions everywhere would take the
trade conversation with it — where asking one thing and waiting is the whole
method, and where he does answer, because he started the exchange. So the
briefing is silent and the reply path is untouched, and `agree.test.mjs` reads
both halves: a briefing that asks again, and a reply that has stopped.

**And it teaches, which for a long time it was the only unscheduled look that
did not.** The print look builds a mechanism he has never had built before saying
what a number changed; this one only reported. But what moves gold runs through a
channel as surely as what a print changes does — a message saying the dollar came
off teaches nothing to someone for whom the dollar is `unseen`, and that is the
likeliest message this path sends. It is handed the map and told to build from it
on the release look's own terms: build where the channel is thin, and where he
owns it say what moved and stop.

It runs only while the market is open, by the same `marketOpen` the poller keeps
— one definition in `_shared/edge.ts`, since both now ask it. Most firings cost
one quote and one indexed read: **no model call at all unless a move clears every
gate.**

### Checking his rules

§7 of the strategy writes a concrete predicate for all eighteen rules and §8
writes the population filters and the three verdicts. **Nothing executed any of
it.** She was handed up to four hundred rows of JSON and expected to apply seven
filters and three-state logic in her head on the way to producing a number —
which is the one thing a model is worst at, and where a wrong answer is least
visible, because a rate computed over the wrong population looks exactly like one
computed over the right one. That is §8's own opening sentence.

`adherence.ts` evaluates the thirteen rules a row can answer — **R-01, R-02,
R-03, R-04, R-10, R-11, R-12, R-13, R-14, R-15, R-16, R-18 and R-19** — and
`check_rules` serves it. The set is not a choice: §7's `Evaluable` column decides it, and `agree` holds the two lists
against each other, because a rule marked `journal` and never implemented is a
check she cites that nobody runs, and one marked `judgment` and implemented
anyway starts reporting `pass` for something nothing stored can see.

**R-14 and R-19 are judged against TradingView's calendar.** He defined high
impact, at v1.20 of the strategy, as a US release TradingView rates high, so one
calendar serves the briefing, the trade-event warning and the rules. The rows are
the ones `eugenia_calendar` already holds under TradingView's id; what she typed
in before 018 carries no id, was never a rating he chose, and is not read.
**A week nobody fetched is not a quiet week.** Both have no releases stored, and
every entry in the unfetched one would pass, so `calendar_weeks`
(`019_calendar_weeks.sql`) records each week a whole-week fetch landed for, and
an entry outside one is `unknown`. Two things mark a week, and both go through
`fileWeek`, which writes the week's rows first and the mark only after:
- **the nightly pass,** which files the current week;
- **the history door,** `?history=YYYY-MM-DD` on `doji-eugenia`, which walks
  every week from that date, up to two years a run. It answers first and works
  behind the 200 like every other door, so its result is read off
  `eugenia_runs`: one row per week under `calendar week`, both outcomes.
  TradingView refuses past about thirty reads a minute, so a refused week is
  asked again once after a pause; refused twice, the walk stops, and its last
  row names the week to start the next run from.

The quarter-hourly filing sees a rolling day and a half and marks nothing.
TradingView's data goes back to 2003, so the weeks already traded can be judged.
Forex Factory's export only ever held the current one.

**`unknown` is not a pass**, and the code says so rather than the prompt: the
verdict is the worst outcome present, and an empty population is `unknown`. A
Friday close-out under $25, a second entry inside the fifteen-minute sweep
window, a day with no size to derive an account from — each is undecidable by
construction, and each is reported as undecidable with its count beside it.

It is pure, so every rule is driven from a test in **both** directions. A
predicate only ever seen to return `pass` has been shown to be reachable, not to
work, and three "clean" results in this repository's history turned out to mean
exactly that.

**And a verdict is not the whole answer, which is how R-10 hid a miscount.** It
asked whether each span overlapped *the one before it* in entry order — which is
not the rule. A multi-session hold covers everything opened inside it, so the
second short trade taken within one sat beside a `to` already left behind and
came back **counted as a pass**, named nowhere, while genuinely breaching. The
verdict survived it every time: a span nested inside an earlier one always has a
neighbour that overlaps too, so something was always flagged and the rule always
said `fail`. What was wrong was the counts and the ids — the rows `check_rules`
promises so a finding can be checked rather than believed. Two sweeps now, one
from each end, naming every span that overlaps any other. **A test asserting only
on the verdict could never have found it**, which is why the one that replaces it
asserts on the counts and the list.

**It gives no verdict on a trade and could not.** It reports whether a row
satisfies a predicate he wrote. *"Two entries eleven days ago were 41 minutes
apart, and R-12 allows fifteen"* is a fact about his own rule; what it meant is
his to say.

Two figures in it are operational readings rather than facts, and both are named
constants so they can be argued with: `CLOSEOUT_MIN` is thirty minutes, giving
§6's *"at or very near"* the Friday close a number; `STRETCH` is 24–31 December,
giving §5's *"Christmas-to-New-Year stretch"* one. The holiday calendar is
computed rather than listed — including Good Friday, and including the
observance shift that closes the market on Friday 3 July 2026 — because a table
of dates stops being true the year nobody extends it, and that failure looks
exactly like perfect compliance.

### The second read

The briefing is researched and written in one generation, and its quality target
lives in prose on the far side of a model call where no test can reach it. That
is not hypothetical: unmeasured, it grew by a sixth and the way anyone found out
was by counting the characters by hand.

So it is read once more before it goes, at `medium` effort with no tools, against
the rules it was written to — is the first sentence only true today, is a term
built at a rung that no longer needs building, is the chain missing a link, is
there a forward call in it, is it inside the budget, does it obey his standing
instructions. It returns the briefing, not notes about it.

**It is handed his notes and the channel map, because two of those checks read
them.** The last one names his standing instructions, which live in notes; the
second names the ladder. Given neither, the first check is skipped and the second
is answered from the only evidence in the room — the mechanism sitting in the
paragraph being judged — so a build-up the map had just required came out as a
redefinition, last, every morning. What arrived was the term bare: shorter,
fluent, correct, and with the teaching removed. Both blocks are already read for
the briefing itself, so the second pass costs nothing extra.

**It cannot make things worse, and that is enforced rather than trusted.** A
revision that comes back empty, apologetic, or twice the length is a critic that
failed, and the draft is kept. Same direction as the pulse: the failure that
sends the original is better than the failure that sends nothing.

### Hearing him, and seeing what he sees

`if (!msg.text) return` silently dropped the two things a trader at a desk is
most likely to send.

**A voice note** now reaches her as text marked `[voice note]`, and the prompt
tells her to read it as him talking rather than writing — it will ramble, and it
is likely to be about how a trade felt, which is exactly when she slows down and
asks one thing. This is the one capability here that needs something the system
does not otherwise have: the Messages API takes text and images and not audio,
and Telegram does not transcribe for bots. `STT_URL` and `STT_KEY` are therefore
optional secrets, written against the `/audio/transcriptions` shape so the
provider is configuration. **Unset is a first-class state** — she says she cannot
hear it, and nothing else is affected, which is why they are deliberately not in
the boot guard beside the secrets whose absence stops her working. `agree`
enforces the exemption rather than waving it through: an optional secret must be
guarded where it is used.

**Everything she writes is spoken as well as written**, and that reversed a rule
that was sound. It was *she answers in the channel he used* — a voice note
answered aloud, a typed line in text, no setting and no stored preference,
because he speaks when his hands are busy and the point is over the moment he has
to look at a phone.

What that rule actually decided was a **reply**. Everything she *starts* was
silent as a side effect of it rather than as a decision, so the morning briefing
— the one message he wanted read to him — was the one the rule could never reach.
He decided it the other way, and the cost is about a dollar a month.

**Six paths speak**: both briefings, the pulse, the release look, the trade event
and the move look, plus the reply. `say()` keeps three things deliberately — the
`/notes` audit, which is a rendered table and unlistenable; the apologies, which
are failure notices rather than messages she wrote; and the short operational
lines.

**The voice note is the message, and the text is what happens when it is not.**
Sending both worked, and both arrived — two notifications and two bubbles for one
thing she said. He asked for the voice note alone.

The objection to audio-only was real, and the fallback is the answer to it rather
than a climb-down. An unset key, a vendor that refused, a format Telegram will
not render: audio alone turns each of those into a **missing** message, which is
the failure shape this whole system is built against. So `say()` is still
reachable and fires only when the audio did not land — in full rather than in
part, because a message he heard three quarters of is worse than either.

**What is stored is untouched.** `remember()` writes the transcript whatever
happened on the wire, so her memory, `search_memory` and the nightly pass read
exactly what they always did. The briefing's keyboard rides on the last voice
note, since there is no text message under it to carry one.

`fold.test.mjs` **drives** the fallback rather than reading it — the one property
a source read cannot settle. With no TTS key every `speak()` answers false, which
is exactly the shape of a vendor that refused, so the real sequence replays and
the text must still go out.

**A vendor that never answers is the other shape, and it cost a briefing.** On
2 October the briefing was stored at 08:02:23. The speech request then never
answered, and at 08:06:40, four hundred seconds after boot, the platform shut
the worker down. A worker that is killed runs no catch. So there was no text, no
row, no apology and no retry, because the marker had already gone down.

**So the briefing is written in one worker and spoken in another.** Writing and
speaking shared one four-hundred-second clock, and a slow morning in either was
taken out of the other. `postBriefing` writes, runs the critic and stores the
briefing, then opens `?speak=weekday` (or `sunday`) on its own function and
ends. That door answers before it works, like every scheduled door, and starts
`postSpeak` on a clock of its own. `postSpeak` finds today's stored briefing by
its marker, pairs it with its text by the instant both were written (one INSERT,
one `created_at`), and speaks it. If the second worker will not start, which is
any non-2xx from the door such as a refused boot, `postBriefing` speaks the
briefing itself as it did before there were two. Losing the second worker must
never be losing the briefing.

**Every request in `speak()` carries a budget, and a part that fails gets a
second attempt.** The budget covers the whole message, not each part, since a
per-request limit multiplies by the parts.

- **`SPEAK_MS`, 150 seconds,** for the paths that write and speak in one worker,
  which is everything but the briefing. That is the slowest speaking that ever
  landed (a Sunday at 155s, storing included).
- **`SPEAK_WORKER_MS`, 330 seconds,** for the speaking worker, which has nothing
  else to do.
- **`ATTEMPT_MS`, 150 seconds per attempt.** A vendor that stalls has stalled on
  one request, and the next is a fresh connection. So on the speaking worker a
  stall costs one attempt rather than the voice. On `SPEAK_MS` a stalled first
  attempt has spent the budget, so only a quick refusal is tried twice there.

A part that has not landed when the budget runs out has failed like any other,
and the full text goes. `fold.test.mjs` drives both a vendor that never settles
and one that refuses once and then answers, on a fresh instance of the module
read with a key.

**`?speak=weekday` is also a repair.** A briefing that was stored and never
reached him is sent again by opening it by hand, the same way the cron secret
opens any door. It speaks today's only, since yesterday's would arrive as this
morning's.

That ordering lives in **`sayAloud`** rather than in six copies of two lines —
five of which nothing would be guarding, and the failure of getting it backwards
is that the audio arrives and the text does not. A test reads the order inside it
*and* counts the six call sites, because a path that drops back to `say()` still
reaches him and is simply silent.

**There was a cap, and there is not one now.** It was 700 characters — fifty
seconds — on the reasoning that past that a voice note stops being a reply and
becomes a recording to scrub through. That is right about a reply and fatal
here: a briefing is 250–400 words by its own rule, so it would have been over
the cap **every single morning** and would have arrived silently, correctly,
forever.

Raising it to 4,000 fixed that morning and left the shape of the mistake in
place — a cap decides that past some length a message is not worth hearing, and
**nothing she writes should be shortened to fit a voice note or go unspoken for
being long**. So a long message becomes *several* voice notes, exactly as it
already becomes several text messages, split by the same `chunk()` with the same
paragraph preference so each part is a whole thought. The only number left is
what the speech vendor accepts in one request, and it is a chunk size rather
than a gate. The prompt is told no length at all.

**The markdown is stripped on the way to the vendor.** She is told plain text —
Telegram is sent no parse mode, so a bold label arrives as asterisks — but the
text is model-written, and the calendar slot is a list where a model reaches for
one anyway. `**Today:**` read aloud is a gamble on what an asterisk becomes, so
the boundary takes off what the instruction only asks for.

`TTS_URL` and `TTS_KEY` are optional on the same terms as `STT_*`; `TTS_VOICE`
and `TTS_MODEL` are environment with defaults, unlike the pinned embedding model,
because nothing is stored — a change alters one message rather than what is
comparable to what, and which voice she has is his to change without a deploy.
**The two are coupled, and the vendor decides how**: the older `tts-1` serves a
smaller set of voices and takes no delivery instruction, so overriding the model
alone can name a voice it does not have. That is a 400 costing the audio and not
the answer, and it is why both defaults name the current model's own recommended
pairing rather than the safest-looking one.

**How it is read is pinned, where which voice reads it is not.** `TTS_STYLE`
carries it, because the prompt spends most of its length keeping her off signals
and verdicts and a breathless delivery of a deliberately unexcited paragraph
contradicts all of it. The register has to survive the trip through audio. Voice
is taste; delivery is the product.

**It asked for the register and not for the delivery, and that is why it read as
a machine.** It was two sentences and both of them said what *not* to do — not
breathless, not selling. Given only prohibitions the model returns the null
reading: every sentence taking the same length of time, every sentence shaped the
same way, and no beat at a paragraph break. That is what a person means by
robotic, and none of it was ruled out. It says the positive half now — and it is
the only dial there is. The defaults above already name the newest model the
speech endpoint serves and one of the two voices the vendor recommends for it,
so a better read was never going to come from moving either.

**That first repair asked for a per-sentence shape, over text that is sixteen
near-identical sentences.** It said *sentences finish downward*, which is right
about one sentence and is the metronome itself against the register `WRITING`
produces — measured over the approved example: sixteen sentences, mean 9.2
words, fourteen of them between 5 and 13. Sixteen identical falls in a row, each
resetting to the same place to start the next. The rule was aimed at news-reader
uplift and it bought that at the price of the thing it was written to fix.

**So the arc moved up a level, to the paragraph**, which is the one rhythm
variable still free. The words cannot carry it: sentence length is fixed by
rules that exist for the eye, and those rules are staying — he read a draft
under them, and they are why the page works. What is left is where the pitch
sits across four sentences and how long she rests between them, and neither was
being asked for. Only the last sentence of a paragraph fully lands now; the ones
before it stay open, which is what a person does when something is still coming.

**The last line of it is pronunciation, and it is there on real text rather than
on a guess.** A calendar line is `08:30 ET <name>`, the trade event reads R-11
and R-14/R-19 back at him, and a level is a comma'd figure — read as glyphs,
those are three stumbles in the middle of a fluent paragraph. They are said in
the instruction rather than rewritten on the way out, because the text `remember`
stores has to stay the text he can read: a rewriter would either touch the
transcript or become a second copy of it.

**The tempo is his ear rather than a default.** At 1.0 he was playing every
voice note at 1.5x in Telegram and calling 1.5 a shade fast, so `TTS_SPEED` is
1.3 and it is read off what he was already doing. It sits at generation rather
than in a player setting he has to remember on each message, and it is pinned
where `TTS_VOICE` is not, for `TTS_STYLE`'s reason: how fast she is heard is the
product.

**It may also be ignored, and that has to be known before a result here is
read.** `speed` is documented for this endpoint across 0.25–4.0, and
`gpt-4o-mini-tts` has been reported to disregard it where `tts-1` honours it —
no error, no header, audio at 1.0 and a constant in the file claiming otherwise.
Nothing in the suite can see it, because the suite never calls the vendor. If
the tempo is unchanged, that is the first thing to suspect, and the fallback is
to ask for pace in `TTS_STYLE` instead.

**The hello is hers, and no longer scripted.** It was a fixed `Buenos días
jefesito.` put in front of every briefing by code, and it was the line that
sounded worst: the same words every morning, with a tempo and pauses that three
rounds of punctuation and voice instructions never fixed. She now opens with a
greeting of her own, in one breath, inside the first paragraph. On a line of its
own a hello is read aloud as a paragraph, with every rule about a paragraph's
closing breath landing on it, which is how the old one dragged. `CRITIC` runs
last, so it is told the hello is hers and stays as written, that the
first-sentence test applies to the sentence after it, and that a split never
leaves it on its own. A test reads the call site, so nothing gets put back in
front of the briefing.

**The audio is requested as OGG/Opus, and this is the one thing on the path that
would fail quietly.** The vendor's default is mp3, and mp3 *works* — the request
succeeds, Telegram accepts the file, and it arrives as an **attachment**: no
waveform, no speed control, nothing you can play with a phone at your ear.
Nothing errors and nothing logs. A test reads the request for `opus` and the
upload for both its `audio/ogg` type and its `.ogg` filename.

**Their policy requires the listener to know the voice is synthetic.** Here the
only listener is the person who built the bot, so the disclosure is the context —
but a voice note forwarded to anyone else carries no such context, and that is
worth knowing before forwarding one.

**A chart** she can now see, and the prohibitions do not move an inch because she
can. She may describe what is on it and take it as context; on a trade not yet
taken she may not say whether a setup is valid or a level will hold, and the
prompt says so in those words, because a picture is the most tempting place in
this system to give a signal. A chart of a trade that has closed she judges the
way she judges the journal.

**And when it produces no words, she says which of four things happened.** They
were one sentence: a rejected key, a wrong URL, an unsupported format and
genuinely unclear audio all reached him as *"I could not make that out — send it
again"*, so the one failure he cannot fix by speaking more clearly was the one he
was being told to speak more clearly for. `VOICE_TROUBLE` is four lines, each
naming whose problem it is, and a test asserts none of them asks him to repeat
himself for a fault that is not his. It is the same rule `readTrades` is written
on, one layer up: an empty answer is only an answer when something was read.

The audio is sent with **both** its filename extension and its content type,
because Telegram supplies both and the services that speak this API shape differ
in which one they detect the format from. Sending only one is a bet on which
provider is behind `STT_URL`.

Neither is stored as sent. The transcript is kept and the image is not — a chart
in `eugenia_turns` would be a megabyte of base64 resent as history for the next
six exchanges. And the clock reaches a picture turn: `stamped` appends the New
York time as a trailing text block rather than concatenating against an array,
which would have produced `[object Object]` on exactly the turns carrying the
most context.

### Whether it landed

An instruction note is the only correction channel he has, and it is a good one —
but it fires only when something annoys him enough to type. On every ordinary
morning there was no signal at all, so the nightly pass judged her own output
with no evidence about how any of it went.

Two buttons ride under the briefing — the mechanism Gladys has used since she
shipped — and the nightly pass reads the last two days of them. `callback_data`
stays far under Telegram's 64 bytes for the same reason hers does. **It is not a
score and the prompt forbids treating it as one**: a bot optimising a thumbs-up
average writes briefings that flatter rather than teach, and what he *told* her
always outranks what he tapped.

Registering the webhook for `["message"]` alone means the taps are never
delivered, the button spins, and nothing reports it — `allowed_updates` must name
`callback_query` too.

### What she remembers

Seven tables, and what separates them is how long a thing is true for. A turn
rolls over inside a morning; a note about him outlives twenty of those; what he
UNDERSTANDS outlives both; a thesis is only ever current, which is why it is one
row rewritten rather than a log; a loop stays until it closes; and the calendar
is the only dataset here that compounds.

| | Holds | Window | Written by |
|---|---|---|---|
| `eugenia_turns` | the conversation | last 12 turns | every exchange |
| `eugenia_notes` | facts about him, what he has told her to do, and what he has committed to | last 20 of each kind | her `remember` tool |
| `eugenia_channels` | where he stands on each of the five channels | all 5 rows, always | her `set_channel` tool, nightly |
| `eugenia_thesis` | the running story the market is trading | 1 row, rewritten | her `set_thesis` tool, nightly |
| `eugenia_loops` | what she flagged and what she asked, until it closes | all open, newest 10 | `open_loop` anywhere, `close_loop` nightly |
| `eugenia_calendar` | what lands today, and what it printed | a rolling ±day | filed from TradingView by `fileCalendar`, and an actual TradingView has not published by `record_actual` |
| `eugenia_feedback` | his verdict on a briefing, one row per day | the last two days | a tap on the keyboard under it, read by the nightly pass |

Turns roll over in a morning, so without notes she could never know in September
that he has been working on holding his stop since August. Notes are one
sentence each about *him* rather than about the market — a note about today's
price is stale tomorrow and the prompt forbids it. They are handed back at the
start of every turn, briefing and reply alike.

**And they are how he corrects her, which is the only way he can.** There is no
settings page, the button under a briefing carries a verdict and not a reason,
and the conversation window rolls over in a morning — so *"stop mentioning the ten-year"*, *"too long"*, *"lead with what
is odd"* would all be forgotten by tomorrow if they stayed in the conversation.
Recorded as notes they are standing instructions: written the moment he gives
one, in his words, obeyed from the next message on, and overriding the shape the
prompt otherwise asks for. She acknowledges an instruction in four words or
fewer — a fact about him she records silently — because otherwise he cannot tell
it stuck and will say it again.

**What he commits to is the third kind, and it is read the other way round.**
*"This week I stop after two losses"* is not something she does — it is something
he does, so she holds his trades against it rather than obeying it. Written in
his words with its period, acknowledged like an instruction, and never one he did
not make. When a closed trade breaks one she says so, fact first and verdict
after, the way she says a broken rule; the briefing gives it one sentence the
morning after. The nightly pass reads each day's trades against them, and a
commitment whose period is over is retired by superseding it with a fact saying
how it went — kept, or broken and on which trade — because how he does against
his own word outlives the commitment by months. Its own kind rather than an
instruction because the two are read in opposite directions, and one window over
both would have her telling them apart from the wording alone. `/notes` lists
them between what he told her and what she noticed.

**A reply to one of her messages tells her which one.** Swipe a message in
Telegram and answer it, typed or spoken, and she is handed the message he
answered — the text when it has any, otherwise the stored turn sent at that
moment, since a voice note carries no words and her history dates a turn by the
day alone. Without it, *"too dense"* under the 10:00 pulse and under the release
look an hour later arrive identically. What is stored is his words behind a
marker carrying her message's opening, so the nightly pass can tell what a
correction was about.

**The briefing is found looking back, because it is the one message stored
before it is sent.** Its marker goes down first and the speaking worker sends it
seconds to minutes later, so looking forward from the voice note — right for
every other message — found nothing under the briefing, every time. When the
forward look is empty, the newest two rows across the speaking worker's budget
are taken only if they are a briefing and its marker, sharing one instant;
anything else there gets no quote rather than a wrong one.

`notesBlock()` is therefore load-bearing on **all seven paths**, and its absence
would be silent: drop it from one and she carries on ignoring an instruction he
believes she took. A test asserts that the briefing, the pulse, a reply, the
nightly pass, the release look, the move look and the trade look each read
them — the last of those was deaf for its whole life, so an instruction he had
given was obeyed everywhere except the two messages that arrive while he is in
a position, which are the ones he is least able to ignore. `channelsBlock()`
goes to the six that are asked to build a term — the release look having joined
when its prompt was asked to teach, and the move look one release later, for the
same reason and after the same failure. The two are the same shape: an
unscheduled message about something the morning did not cover. What moves gold
runs through a channel as surely as what a print changes does, so a message
saying the dollar came off teaches nothing to someone for whom the dollar is
`unseen` — and that is the likeliest message this path sends.

**And the conversation window goes to everything that speaks**, which is the
same list minus the nightly pass — that one reads a fixed twenty-four hours of
its own, and the twelve-turn window would be a shorter second copy of the same
day. This too was missing from the trade look, and it is the quieter failure:
its R-14/R-19 message fires on a print pending against an open position, which
is exactly what the morning briefing is likeliest to have named already. With no
window she cannot know she said it two hours ago, and the sharpest thing she
sends arrives as a repetition. Both reads sit *after* the two early returns, so
an ordinary fill — no print pending, no breach — still costs nothing at all.
Telling her to build a mechanism he has never had built, without handing her the
map that says which those are, is an instruction outrunning its inputs — and it
fails by teaching the wrong thing well rather than by failing at all.

### What he has on right now

Every other thing she is handed is about the market, or about what he
understands. **None of them said whether he was exposed.** So a briefing could
open on an observation about a level while he sat in a position through the very
print it was describing, and nothing about that message read as wrong from
anywhere — every prohibition was kept, and the only thing missing was the fact
that would have stopped her writing it.

`positionsBlock()` is that fact. One read with two filters, because each half
misses the other: an overnight hold is not in today's rows and today's closed
trades are not open.

**A position is closed on either witness, and reading one column told him he was
in a trade he had closed days earlier.** `fill_time` had exactly one writer and
it was `doji-email-sync` — the poller never set it, on any row. **It writes it
now**, off the `closedAt` it already computes, under `where fill_time is null`:
the third use of the balance filter, so the email still owns the column wherever
it lands and the poller fills the gaps. Both reads below stay as they are — two
witnesses is the right test whichever of them got there first, and a row the
fold window never reaches is still stamped by neither. What the poller
records when a position closes is `exit_price`, folded from the broker's own
deals every two minutes. So a close with no alert email behind it — a manual
close, R-15's Friday close-out, a parse that failed, an email that never came —
left `fill_time` null for ever, and this block reported an open position for
ever. It did it while citing R-19 and R-15 at him about a trade that no longer
existed, which is the worst failure available here: this is the one block where
she speaks with his own rules behind her.

Open now means **neither** witness has closed it — `exit_price is null and
fill_time is null` — the same two-claimant shape `balance` and `direction`
already use, since a row the poller folded without its entry deal carries a null
`exit_price` on a closed trade and the email catches that one. **And broker rows
only:** pre-sync rows carry client ids and no `exit_price`, so every one of them
read as permanently open. `isOpen` is exported and driven from both sides,
because `positionsList` is pure, was always driven from both sides, and renders
exactly what it is handed — the mistake was upstream of it, in deciding what to
hand it.

**The same column runs through two of the thirteen rules.** R-10 ended an unclosed
span at *now*, so one missing email made every trade after it overlap a phantom —
a cascade of failures each naming a real row and each wrong. A close with no time
is now `unknown`, which is what an end nothing recorded actually is. R-15 used to
`continue` past those, dropping them from its population silently, which is §8's
opening sentence happening inside the file that exists to prevent it. It renders the open positions — age, side, size, entry, and
the stop and target as first seen — the quarter-hourly mark **with its age**, and
where the day stands against the 4% R-11 sets. **A position opened on an earlier
day names that day**; it used to render a bare `open since 09:15 ET` under a
heading that says *right now*, and there is one way to read that and it is the
wrong one. The summary calls his positions *intraday to multi-session* and R-15
bounds a hold at the Friday close rather than at midnight, so this is a shape he
trades. Today stays bare, or the date would be noise on every intraday fill. When he is flat and has not traded
today, which is most mornings, it is nothing at all.

It is handed to six paths rather than five: the briefing, the pulse, a reply, the
release look, the nightly pass, and the move look, which joins because a sharp
move is the likeliest of all of them to arrive while he is in something. The
trade-event look is deliberately outside it — that one is reached *from* the
position and already holds the row that fired it.

**What she may do with it is a narrower thing than what she can see, and that
asymmetry is the design.** Unprompted it does two jobs: it stops her writing
anything setup-flavoured while a position is open, and it lets her name a
collision his own rules already name — a high-impact print against an open
position (R-14, R-19), or a day past R-11. When *he* raises the position she
discusses it properly, using his entry and his plan, and refuses exactly one
thing: any statement about what to do with it.

**His levels never appear in a message she starts.** A briefing that mentions the
number he is long from has begun framing the day around his position rather than
around what is happening — and it reads as relevance while being the opposite.
That guard is a paragraph in the prompt and has no structural half, because the
whole point of handing her the numbers is that she can use them when asked; a
test reads the prompt for it, since deleting it breaks nothing else.

**No unrealised P&L is computed.** The nearest price she holds is up to fifteen
minutes old, and that figure would be both the most anchoring number in the block
and the one staleness gets most wrong. Entry and mark are given as what they are,
labelled, and she can subtract them if he asks.

A run of losses is named — *"that is three this week"* is a fact he should hear
— and then either explained by what the trades have **in common** or admitted as
not yet explained, which is information too. A breach of one of his own rules
inside the run leads, because that is his document deciding.

### Search that survives a rephrasing

`eugenia_search` was `websearch_to_tsquery` ranked by `ts_rank`: it found rows
containing the words asked for and nothing else. Ask *"what did we conclude about
the December cut"* and a turn saying *the market has mostly given up on easing
this year* is invisible — same subject, no shared stem.

The failure is silent, and the prompt makes it worse by telling her an empty
result is trustworthy: *if the search comes back empty, that is an answer worth
trusting*. A lexical miss becomes a confident *"I have no record of that."*

`pg_trgm` is the half that needs no new vendor — no embedding provider, no per-write
cost, nothing to backfill — and it is what catches a rephrasing, a typo or a
half-remembered quote. It is not what catches a different *idea*, and for a while
this said so and stopped there. The semantic arm below is that half, and the
trigram one did not move to make room for it.

`word_similarity`, never `similarity`, and the difference is total here.
`similarity()` normalises over the union of both trigram sets, so a six-word
question against a fourteen-hundred-character briefing scores near zero however
well it matches, and every long turn would be unreachable. `word_similarity`
scores the query against the best matching *extent* inside the target, which is
exactly this shape: a short query, a long document.

Ranked in two keys rather than one fused score. `ts_rank` lands around 0.0–0.1
and `word_similarity` spans 0–1, so adding or maxing them needs a scale factor
invented to make the arithmetic come out — a fudge that decides rankings while
looking like a formula. Instead an exact word match outranks a near one, and
within each group the stronger score wins. That is still the order *inside* the
lexical arm, and it is what the fusion below sees.

### Search that survives a different idea

The example above is the one trigram cannot reach. *"What did we conclude about
the December cut"* and *"the market has mostly given up on easing this year"*
share no substrings at all, so full text finds nothing, trigram finds nothing,
and the answer she gives is that you never discussed it.

`007_semantic.sql` adds an `embedding` column to both tables and a second arm to
the same function. **It is not a sixth memory.** Her memories are lifetimes;
this is the *reach* into two of them, and the windows do not move — twelve turns
and twenty notes, because every token in a window is paid on every request.
Everything a vector finds was already in the table.

**The lexical arm stays, and that is the load-bearing decision.** Two reasons,
both of which bite. A vector is worse than trigram at exact terms — a date, a
ticker, `R-08`, a note id — where the thing being asked for *is* the string. And
a row whose embedding is null does not appear in a nearest-neighbour query at
all: no error, no log, half an archive quietly unsearchable. The lexical arm is
full coverage over both tables and cannot have that failure, so it is the floor
under the semantic one rather than a fallback beside it.

**Reciprocal rank fusion, not a weighted sum**, and for the reason the two keys
above exist: `ts_rank` and cosine distance are on unrelated scales, so any
weighting of them is a constant somebody guessed. RRF compares only *positions*,
needs no calibration, and makes a row found by both arms outrank one that is
merely first in either.

**Unset is a first-class state, so this shipped before the key existed.** With no
`EMBED_KEY` every write stores its row without a vector, the query vector is
null, both semantic arms return nothing, and the fusion over one arm reproduces
exactly the ordering above. Turning it on is a secret and a backfill, not a
deploy.

**The embedding model is pinned in the file, not read from the environment**, and
that is the whole difference between it and `STT_MODEL`. A transcription model
chosen in a dashboard changes one answer. An embedding model chosen there changes
what is *comparable to what* — vectors from two models are not comparable, the
column type catches a change of width and cannot catch a change at the same
width, and the ranking degrades into noise with nothing anywhere reporting it.
Changing it is a code change, and it means re-embedding both tables.

**The function is dropped and recreated, which this repository otherwise avoids.**
The query vector is a new argument and `create or replace function` cannot change
an argument list — creating the three-argument form beside the two-argument one
makes an *overload*, so a two-argument call matches both and Postgres refuses it
as ambiguous. A drop takes the grants with it, so the `revoke` and `grant` are
part of the statement rather than a follow-up.

**And `revoke … from public` is not the whole revoke**, which the live database
had to be asked to find out. `public` there is the PUBLIC *pseudo-role*, which
every new function carries `EXECUTE` for. `anon` and `authenticated` hold it
*separately and by name*, from the default privileges Supabase sets on the
`public` **schema** — two different things spelled the same way, so revoking one
leaves the other in place and reports nothing. `eugenia_search` had been
executable by the publishable key since 003 created it; nothing was exposed,
because the function is not `security definer` and an `anon` caller meets RLS on
two tables that have no policy for it, but the guarantee stated here was false.

`verify.sql` now asks it of **every callable function in the schema** rather than
of this one, through `has_function_privilege`, which answers for the role however
the privilege arrived.

**What cannot be checked from here is the part that matters most.** Nothing in
the repository reaches a database or the vendor, so the ordering, the coverage
floor, the widths and the grants are all held by tests and the *retrieval
quality* is not. That shows up in use and nowhere else.

### Where he stands on each channel

**The same bug this schema already fixed once.** `kind` exists because one
newest-20 window over notes and instructions together would evict *"stop
mentioning the ten-year"* after a month of ordinary observations. What he
**understands** has that property too and did not have that fix: a note saying
he worked out the dollar link unaided is not an observation about Tuesday, it is
a durable fact about him, and it was sitting in the bucket that ages out. Twenty
notes later it is gone and she re-explains a mechanism the prompt forbids her to
re-explain.

`eugenia_channels` is five rows, one per channel, and it never scrolls. Not a
window — a **census over a fixed set**, which is what makes it the only place in
the system where an **absence** is legible. A channel he has never once used is
a row saying `unseen`; in `eugenia_notes` it is nothing written down, and
nothing is not a thing anyone can notice. That absence is the whole point: it is
the one question her memory could never answer, and the only one that says where
the teaching should go.

The ladder is `unseen → explained → used → owns`. Order matters, and not only as
documentation: `channelsList` renders a row it was not given at the **first**
rung, so reversing the list would render every unseeded channel as owned.

**Every rung carries the day it last moved, and that is what stops the map going
blind.** The ladder does not come down on her reading of a bad evening — failing
to reach for a mechanism once is not the same as having lost it — so over a year
the channels he has used pile up at the top, and a census with nothing left at
`unseen` has no absence left to show, which is the entire thing it is for.
`moved_on` was written by `set_channel` from the first day and read by nobody: a
rung set in March looked exactly like one set last night. The prompt now counts a
rung that has not moved in months toward the tiebreaker the same way a low one
counts — a channel that has gone quiet, not one he has lost.

It is formatted as the civil day it was stored as. Read back through a New York
formatter it would move: `new Date('2026-03-12')` is midnight UTC, which is the
11th in New York, so every rung would read a day early in the one column that
says how stale it is.

**It is a tiebreaker for what the briefing is about, never a driver**, and the
prompt says so in those words. It decides which of two mechanisms that are *both*
live today she unpacks — lean toward the thinner one. It never decides what the
day is about. A briefing that worked through the channels in turn because one was
`unseen` would be a curriculum, and the opening paragraph would stop being what
actually matters that morning, which is the only thing it is for.

**It does drive how a thing is said**, and that is the second job §0 of the
strategy gave it: build the term from §3 at `unseen`, restate the mechanism in a
clause at `explained`, say it plainly at `used`, say it bare at `owns`. Subject
and register are two different questions, and the rung answers only the second.
On subject it is a tiebreaker; on register it drives outright.

**That table is `PITCH`, and for a long time she was never handed it.** It was
written in §0 — and §0 below its summary is `get_strategy`-only, with no prompt
on any path telling her to fetch it. So the rule that decides how every
explanation is pitched sat in a section nothing ever opened, and what she
actually held was a pair of ends quoted in two prompts: *build it at `unseen`,
do not at `owns`*.

`unseen` is a **one-way door**. `setChannel` refuses to write it back, correctly,
because it means a channel has never once come up — history, not understanding.
So the only build instruction she had stopped being reachable the first time each
subject was mentioned, and the two rungs every channel actually sits at had no
instruction at all. A binary rule over four states reads as *the other case*, and
she used every term bare. Every message she sent was her following the rule she
had; no prompt tweak could reach it, because the rule that would have produced
the teaching was in a file she never read from.

`PITCH` now lives in `prompt.ts` beside the ladder, is interpolated into the
cached prefix **and** into §0 — the way `SUMMARY` already is, so the two are the
same characters — and `agree` asserts it is in `SYSTEM` rather than merely
well-formed. The old test proved a row per rung and proved nothing about whether
the rows reached her, which is this repository's oldest shape of mistake.

**Only the nightly pass may move a rung.** `set_channel` is in
`CONSOLIDATE_TOOLS` and deliberately not in `CHAT_TOOLS` beside `remember`: a
note is a moment and is fairly written in one, but a rung is a judgment across
days, and moving one on a single exchange is the same error as reading a pattern
into one fill. Most nights nothing moves, and the prompt says that is the
honest outcome rather than a wasted run.

**And the loop holds that, not the model's restraint.** A tool set is what a
caller can run as well as what it is shown: `ask()` answers a name outside the
set it was handed exactly as it answers an unknown one, and runs nothing. Until
then every tool in the file was runnable from every path, and *only the nightly
pass moves a rung* held only for as long as the model never named a tool it had
not been given.

**It comes back down when he says so, and only then.** *"I have lost this"*,
*"explain that again"* — the rung drops that night and she does not defend the
earlier read. Promoting too early is her natural error and he is the only one who
can see it, so this direction is his to declare where the other is hers to infer.
It still lands at the pass rather than mid-conversation: the pass reads the whole
day, so what he said is in front of it either way, and the rung is right before
the next morning's briefing, which is the only place it is read. Putting the tool
in `CHAT_TOOLS` would buy a few hours and cost its schema on every request and a
promotion she could make from one exchange.

**Nothing goes back to `unseen`, and `setChannel` refuses it before the write.**
That rung says a channel has never once come up — a fact about history, not about
how well he holds it. A demotion able to write it would report a channel she
taught last week as one he has never met, which is the census saying the opposite
of the truth in the one column it exists for. A channel he has lost goes to
`explained`.

The five ids live in `prompt.ts` and are read from there by the tool's enum and
interpolated into her prose, so the check constraint and the seed are the genuine
second copies — `agree.test.mjs` holds them together, because an id the tool
offers and the constraint refuses is a `set_channel` that 400s and is reported to
nobody.

**The strategy is a copy in the other vocabulary.** Each `CHANNELS` entry is an id
and a spoken name, and §2 heads each channel with the *name*, because
`central_bank_buying` is not something a person says across a desk. So the name
can drift with every id in the repository still agreeing — she would read the
mechanism under one name and move the rung under another — which is why the test
resolves §2's headings against the names rather than the ids. §0's pitch table is
the same shape for the four rungs.

**`/notes` is how he reads what she is keeping**, and it is answered from the
database rather than by the model — `notesList()` renders the rows themselves,
with the id each is named by, so the listing is an audit rather than her account
of one. Asked to recite her own notes she could paraphrase a line, drop one, or
produce a plausible sentence that is not in the table, and none of that would be
visible.

Without it her memory is the one part of this system he can write to and cannot
read. A fact is recorded silently by design and an instruction is acknowledged
in four words that scroll away, so the evidence that anything stuck lasts about
a morning — and a wrong note fails in the worst available way. A fact saying he
understands something he does not makes her **stop explaining it**, and the
symptom is an absence, which is the hardest thing there is to notice.

The channel map is part of the same listing, because it is the half of her
memory he has never been able to see at all — and the half that says what she is
missing rather than what she has. It is rendered *by* `notesList()` rather than
appended after it: the block the briefing uses is written for her and opens
*Where he stands on each channel*, so the one message in the system addressed to
him used to switch into the third person about him halfway down. Rendering the
whole audit in one place fixes that and makes it one pure function.

**And `/channel` is the half of that map he can move himself.**
`/channel <channel> <rung>` — either the id or the spoken name the listing
prints, and the rung as the last word, because three of the five names are
several words long. It reuses `setChannel`, so the one-way door on `unseen` and
the check for an unseeded table hold exactly as they do for the nightly pass.

It exists because **the ladder could only ever climb on evidence he does not
produce.** A rung moves at the nightly pass and it moves on him using a term
back, so a reader who takes the briefing and rarely answers it sits at
`explained` for ever — and `explained` is the rung that says restate the
mechanism in a clause every time the word is used. Weeks of that read as her
being unable to stop over-explaining; what it actually was is a census with no
way up. That stays true of *her* reading of him — one exchange is not evidence,
and `set_channel` is still out of `CHAT_TOOLS`. This is not her reading of him:
it is him saying where he is, which is the standing a demotion already had and
the only testimony on the subject that was never in doubt.

It also means a failed channel read now costs the whole `/notes` reply rather
than being swallowed, which is the opposite of the rule the briefing's blocks
follow and is right here: this is an audit, answered from the database precisely
so nothing can quietly drop a row, and one that silently omits half of what it
audits is the defect it exists to prevent.

Append-only, and now with a way to retire a line rather than only bury it. Every
note reaches her with a number in brackets, and `remember` takes an optional
`supersedes` — so a new note that contradicts an old one names it, and the old
one stops being read.

**That filter is the whole feature and it fails silently.** Without
`superseded_by is null` on the read she is handed the correction *and* the thing
it corrected, every turn, with nothing marking which is current — no error, and
a note count that looks perfectly healthy. `agree.test.mjs` reads the query for
it, and checks the column, the filter and the tool parameter all exist together,
since any one of the three missing leaves the other two doing nothing.

The row itself never goes. It keeps what she used to believe and names what
changed it, which is exactly what a search over this table will need later:
findable, and marked as no longer true. There is still no delete path, so the
only things she can do to that table are add a sentence and retire one.

**She can search everything she has ever said.** The twelve turns and twenty
notes she is handed are the newest slice of two append-only tables; everything
older was still there and simply never selected. `search_memory` reaches it —
one RPC, `eugenia_search`, ranking notes and turns together by words and by
meaning so a question like *"what did we conclude about the December cut"* is
answerable from March even when nobody used those words.

**Searched, not loaded, and that is the design rather than a limitation.**
Widening the windows would put the archive in her context, where every token is
paid on every request and competes with the briefing for attention. The windows
stay small and what is outside them is addressable on demand — the same trade
`get_trades` makes for the journal.

`websearch_to_tsquery` rather than `to_tsquery`, because the query is written by
a model: the strict parser throws on an unbalanced quote, and a throw inside the
tool loop costs the whole answer. **A retired note is returned and marked, never
hidden** — that is the promise `superseded_by` makes, and *what did I used to
think* is worth being able to answer.

**And a hit says who said it.** `eugenia_turns` carries `role`; the search did
not select it, so every turn came back rendered as *you said* and half of every
result set was **his** messages handed back to her as her own words — she would
quote an instruction he gave as her own analysis, or deny saying something he
said, fluently, with nothing anywhere reporting it. The role rides in `source`
rather than in a column of its own, because `create or replace function` may not
change a return type and dropping the function to widen it takes its grants with
it. Three words, one column: `note`, `you`, `him`. They are a vocabulary shared
with `searchList`, so `agree.test.mjs` holds the two lists against each other.

**She holds his strategy and can never write it.** `strategy.ts` is the document
he wrote — what he trades, the rules, how each one is checked. Its own retrieval
contract decides what she carries: the summary, a one-line index of every
section, and the rules table ride on the **cached** system prompt, so they are in
front of her on every turn; `get_strategy` fetches the reasoning behind any of
it. Loading the whole document instead would be close to a hundred thousand
characters against every message, competing with the briefing for attention.

**The index is there because nothing cites §8.** Every other section is reachable
from a rule's `§` column, and §8 — which population, which filters, which figure
is the honest one — is the section that decides whether a number means anything
at all. No rule points at it. A tool she can call is not a tool she knows when to
call.

**A subsection is served by the section that holds it**, and without that the two
citations she carries on every single turn were the two `get_strategy` could not
answer. R-05 cites §4.1 and R-06 cites §4.2; both are written, in full, inside
§4, and an exact lookup told her they did not exist — not a blank she fills in
herself but a wrong fact about her own document, delivered by the one tool that
exists to stop her inventing one. `agree.test.mjs` now resolves every citation in
the rules table through the same lookup, and checks a dotted one names a heading
that is actually in what came back: the fallback would otherwise answer a
mistyped §4.7 with §4 and read exactly like a citation that worked. Its reader
captured `4` out of `§4.1` and reported both as fine.

**The asymmetry is the point.** A document that decides whether he followed his
rules cannot be edited by the thing checking them — adherence to a moving target
is not measurable, and her own analysis would start feeding the standard she
measures against. She has no write path to it at all, in the same way she has
none to `trades`.

**The Evaluable column is what the table is for.** `journal` means a rule can be
checked against a row today, `field` that a column would have to exist first,
`judgment` that nothing stored can see it. A judgment rule is not a weaker rule —
it is one whose compliance is invisible, so it never counts as kept merely
because nothing contradicted it.

The numbering skips 1 and 11, and that is a decision rather than an unfinished
document: a numbering that skips reads as deliberate where six holes read as a
draft. Every section anything cites is written. `get_strategy` still names a
number it does not hold rather than returning nothing: the number arrives from
the model, so a mistyped or an invented one is what it has to survive, and a
blank is something she would fill in herself, which is the one outcome worse than
reporting it missing.

**Two of the sections are not his.** §2 and §3 are researched reference material
rather than decisions he made, and both say so where they start. Everything else
in the file is his, and a rule he has not stated is a `[decide]` rather than a
pattern read as a rule — which is the difference between a document that records
what he decided and one that tells him what he apparently does.

**§3 is the foundation, and it exists because he said the briefings land as terms
he nods past.** Nineteen thousand characters built from the ground up — what
inflation is, what the Fed actually sets, how a rate hike transmits, what a bond
yield is, what TIPS and breakevens measure, and why gold sits at the end of all
of it — plus every metric a briefing uses. It is written to teach rather than to
be looked up, and it is what she reaches for when a term needs building rather
than naming.

**§0 decides how much building a term needs, and it reads that off the channel
map.** Each of the five channels carries `unseen → explained → used → owns`, and
§0 turns the rung into an instruction: build it from §3 at `unseen`, restate the
mechanism in a clause at `explained`, say it plainly at `used`, say it bare at
`owns`. Reaching for the build-up at `owns` is condescending, and skipping it at
`unseen` is the term he nods past — so the same table that exists to show an
absence now also sets the register.

§6 holds R-08's four steps — top-down bias; levels, meaning liquidity pools,
support and resistance and the $25 grid; a candle or chart pattern with signal
then confirmation; and reward-to-risk of at least 1:1.5. The order is the rule: a
failed step ends the sequence rather than being traded off against a later one,
and nothing stored can see any of the four. **Psychological levels were a fifth
step until v1.9** and are now inside the levels step: they gated nothing of their
own — attention rather than a test — and a step that can never be the step you
stopped at breaks the one claim R-08 makes.

**Step 4 is arithmetic he runs, and it binds in exactly one place.** The default
$30 target over a stop of $20 or tighter is always at least 1:1.5, so on the
default path the step refuses nothing. What it refuses is a $25 target set at
entry, which needs a stop of $16.67 or tighter — and no row records which target
was set.

So a realised 1:1.25 is **legitimate as an outcome and illegitimate as a plan**:
the rule working where a $30 target was shortened on a trade already open, and a
breach where $25 was set at entry over a $20 stop. Nothing on the row separates
them, so it is `unknown` rather than either. That is v1.9's correction to a
contradiction the document carried for six versions and then papered over for
two — one floor that disagreed with itself, restated as two numbers at two
moments, when the honest statement is that the row cannot tell which happened.

**The stop is a ceiling, not a value**, and that is what makes R-02 one-sided.
$20 is the most it may ever be; where it actually goes is read off the chart at
entry, so it is usually tighter, and the only way it moves is outward to
break-even, or inward under R-19. A loss closing further than $20 from entry can
therefore only be a stop that was widened, which is what the predicate catches —
and a $10 stop that closed $18 out was widened by eight dollars and passes
silently. A clean R-02 run means no stop went past $20. It never means stops were
respected.

**R-10 and R-11 arrived at v1.9 with IDs they should have had all along.** One
position at a time, and the day ends at −4% of account: both were prose in §5
from v1.5, neither was ever in the table, so neither was ever checked. Both come
out of broker columns alone — two rows whose entry-to-fill spans overlap, and
cumulative P&L against `size_oz × 500` — which is why they arrive as `journal`
rather than as another thing waiting on a schema change. R-11 also separates two
rules §5 had been stating as one: a full stop ends the day under R-03 and −4%
ends it under R-11, and the two can disagree in both directions — a full stop is
$20 from entry, which at a small rung ends the day having spent well under 4%,
and three smaller losses can spend the whole 4% without R-03 seeing anything.
**That definition is his, settled at v1.14**, and it is what made R-03 `journal`:
§12 had also counted a tighter stop taken in full, which no row can tell from a
hand-cut exit.

**The table reached nineteen rules, and the eight after R-11 came out of audits
rather than out of new behaviour.** It is eighteen since v1.18 retired R-09, a line
from a book he read while learning rather than one he traded by. R-12 caps him at one entry a day, two only
when the second is a sweep re-entry. R-13 pins a rung change to a month boundary.
R-14 stands him aside in the hours before a high-impact release — the first rule
connecting the briefing to the trading. R-15 closes anything live before the
Friday close, because a weekend gap can open past the stop. R-16 keeps him off
known low-volume days. R-17 stops him when the trading itself has deteriorated,
and its trigger is behaviour rather than a drawdown number, which is why it is
`judgment` and not a threshold.

**R-18 is the one that changes what the older rules mean.** The stop and the
target are resting broker orders and a position is never closed by hand, so a
loss further from entry than $20 is an edited order rather than a decision at the
screen — which turns R-01 and R-02 from suggestive into exact. R-19 is the single
exception to *never tightened*: a high-impact print landing on a position
inherited from an earlier session goes to break-even if it is in profit and to a
closer invalidation if it is not, and the target never moves. It also costs a
reading the journal had for free: a scratch on this account was reliably R-04
having fired, and a scratch under $20 can now be R-19 instead — unless the trade
was opened in the same session, in which case it is neither and is a question.

§4 is the one section that answers a question the rules could not. **The two
setups differ by method, not by location**: Break & Retest is a continuation
trade taken through a level that has already broken and flipped, and Support &
Resistance is a mean-reversion trade taken off a level that is holding. Interior
levels are where levels break, the extremes are where they turn price back — so
R-05 and R-06 read as rules about location and are rules about method. It also
settles what a per-setup statistic is: a win rate split by `setup` compares
continuation against mean-reversion, not one part of the chart against another.

**An interior level is not only a quarter**, and reducing it to one was the error
v1.12 corrected. A level is marked by the $25 grid — 00 and 50 psychological, 25
and 75 the quarters between — or by a reaction point, a previous high or low where
something actually happened, and it is strongest where the two agree. So a
previous high mid-range is tradeable for Break & Retest, which the earlier reading
excluded. A `[decide]` in the text is a value he has not settled, and she is told
to say so rather than supply one.

A TS module rather than a markdown file for the reason `prompt.ts` is one: a
function deploys as its own directory, and an import is the one way to be certain
a file travels with it. It is markdown inside a template literal, so **every
backtick is escaped** — writing a new one plainly ends the string, which fails
loudly at build rather than subtly at runtime.

**She reads the journal and can never write it.** `get_trades` is a tool she
calls when the conversation is about his trading, and three separate things make
it read-only: the `eugenia_trades` view fixes the column list (no `user_id`, no
`balance`, no `commission`, no `computed_pnl`) and hides deleted rows; the grant on that view is
`select` and nothing else; and her function has exactly one database read of the
journal and no write path to it anywhere. Said plainly, because it is the honest
limit: the grant makes the *view* read-only, not the key — she holds the service
key to write her own tables, so the structural guarantee is what matters and the
grant is the second lock.

The view is `security_invoker`, which a view is **not** by default. Without it
the view reads `trades` with the rights of whoever ran `003_eugenia.sql`, so
what row level security does depends on an attribute of that role rather than on
who is asking — and the grant is then the only thing between the publishable key
and every user's trades. With it the reader's own rights apply. Nothing changes
for Eugenia, who holds the service key and bypasses RLS either way; what changes
is that a grant widened by mistake leaks nothing.

She is still not a fifth writer to `trades`. The only things she writes are
`eugenia_turns` and `eugenia_notes`.

**Context goes in the user turn, not in a system message.** Mid-conversation
system messages are the channel built for exactly this and would keep the cached
prefix intact — but that request shape could not be exercised from the machine
this was written on, and a 400 there kills every reply she gives. Nothing here
is untrusted anyway: the trades are his own journal, and the notes are her
sentences or his, in his own thread — so the injection safety a system turn buys
is not what this needs.

### When it breaks, she says so

**The briefing went silent once and nothing reported it.** `pg_net` discards the
function's response, `console.error` goes to logs nobody has open, and
`net._http_response` is pruned within hours — so a briefing that died at 08:00
was unrecoverable by lunchtime, and the way it surfaced was the trader noticing
nothing had arrived. The cron half now sends a short Telegram message naming the
error instead. Silence is the worst thing this system can do and it had three
separate ways of doing it.

**A read that fails does not take the briefing with it.** `get_trades`,
`search_memory`, `remember` and `set_channel` all run inside the tool loop,
where an exception ends the turn outright: the model has asked a question and
there is no answer to hand back. So each of them catches and returns a sentence
instead — *his journal could not be read just now*, *your memory could not be
searched* — and she writes around the gap and says what she could not see. The
morning `eugenia_trades` was dropped and not rebuilt, the journal read threw
rather than answering, and a failure that cost only the trades cost the whole
day: four apologies, one an hour, and no briefing at all.

**The sentence matters as much as the catch.** A read that comes back *no trades
in that window* from a window nothing looked at is a briefing telling him he has
not traded since Friday — a false statement about his own week, in her voice,
with nothing anywhere reporting that the read never happened. An empty answer is
only an answer when something was actually read.

**A failed briefing tries again**, at 09:00, 10:00 and 11:00 ET — and on a
Sunday at 18:00, 19:00 and 20:00, the same three hours after its own 17:00 open —
and stops the moment one has landed. `briefedToday()` reads the marker `postBriefing` stores
— written *before* the send, so it exists whenever a briefing was generated. The
generation is the expensive half, and a marker written after it would let a
failed insert produce four briefings and four bills. A read failure counts as
*already briefed* for the same reason: if the database is unwell the retry
cannot check, and a second briefing sent on a guess is worse than a skipped one.

**The database finds the marker; nothing scans a window of turns for it.**
`briefedQuery()` filters on the two marker strings and returns one row, because
the obvious alternative — read the last thirty user turns and look for it among
them — is correct on a quiet morning and wrong on a talkative one. Thirty
messages between 08:00 and 09:00 push the marker out of that window, the retry
concludes nothing was sent, and generates and delivers a second briefing: a
dozen searches at `high` effort, and a duplicate he did not ask for. A filter on
the marker itself cannot be crowded out by whatever was said around it.

At 10:00 the retry window and the pulse overlap, and `dueNow()` gives that hour
to the retry — on a day the briefing failed, a second look at a morning he was
never told about is not what is wanted.

**Sunday had no second chance at all until it needed one**, which was the wrong
way round twice over: it is the only briefing of the week that could not be
retried, and the one whose absence takes seven days to come round again rather
than one. It went missing on the first Sunday the branch existed for. The three
hours are chosen the same way the weekday ones are — late enough to still be an
evening about a week that is opening, and two clear of the 22:00 pass.

`retryDue` answers **which** briefing rather than whether one is due, because a
retry has to send the shape the failed one would have. `dueNow` named `'weekday'`
itself, which was correct only for as long as the window was weekdays-only: a
literal that is right by accident of another function's range breaks the first
time that range moves, and this is the commit that moved it.

**`?force=1` falls back to the day, not to a constant.** It reads
`briefDue(now) ?? briefKind(now)`, and it used to read `?? 'weekday'` — so the
door that exists for the hour a briefing did *not* arrive could not produce a
Sunday one outside the single hour it was already due. Forced on a Sunday
evening it sent *Buenos dias* and a weekday shape into a market that had just
opened for the week. `briefKind` is pure and driven from both sides by a test,
and every one of those assertions passed while the constant was still there —
so `agree.test.mjs` reads `postScheduled` for the call as well, which is the
half that was missing.

**Everything a cron secret reaches answers before it works, and there are two
limits behind that.** The worker's wall clock is 150s on the Free plan and 400s
on paid — that is what killed the first Sunday briefing, at 145.4 seconds of
drafting, four and a half short of done. The **request idle timeout is 150s on
every plan**: send the caller nothing for that long and the request is closed
under you. So the same briefing, completing and delivering perfectly, still
handed pg_net a `504 IDLE_TIMEOUT`.

That is not cosmetic. `net._http_response` is the only record of a dispatch, and
in it a good briefing and a call that never ran are the same row — so a watcher
built on that table would report every working briefing as a failure, which is
exactly the ordinary-day false alarm that gets a monitor ignored. Answering
first makes a non-2xx there mean what it says, and the body names the job
(`accepted: "pulse=1"`) because the table carries no URL.

`?embed=1` is the only door that still waits, and the entitlement is derived
rather than typed: its answer *is* its interface — you call it until it reports
`left: 0` — and it is the one flag no cron job dispatches. `agree.test.mjs`
holds that against `004_cron.sql`, so giving it a schedule fails the suite.

**And the apology names the job that actually died.** Every scheduled failure said
*"No briefing, jefe"* — including a pulse, the nightly pass, a release look and a
trade event. So a consolidation that died at 22:00 reported itself to him as a
missing briefing, sending him to look for the wrong thing at the wrong time of
day; and the failure whose real symptom is that her memory stops growing was
described as the one whose symptom is a message that never arrived. `APOLOGY` is
a word per job, and a test asserts no two of them are the same sentence.

**The trade event reaches the same catch.** It answers before it works like
everything scheduled, but it is dispatched beside `postScheduled` rather than
through it, so it had an apology written for it and no path that sent one: a
read that failed before its model call left a console line and nothing else, on
the one message with no retry behind it. Both callers now hand a failure to
`jobFailed`, which writes the `<job> job` row and then apologises, in that order.

### What a turn cost

`ask()` logs one line per turn — the caller, the rounds it took, the effort, the
tokens in and out, how many were served from cache, and how many web searches
were billed. `postBriefing` adds the briefing's length in characters, and
the `<brief> briefing delivered` row carries it, which is where a manual run
reads it now: `?force=1` answers before it works, like everything else a cron
secret reaches, so its body says `accepted` rather than `chars`. Its `detail`
splits what came after the critic. The writing worker leaves a `<brief>
briefing written` row (`stored in 1s, handed to the speaking worker`, with its
own total in `ms`), and the speaking worker writes the delivered row once he has
it (`spoken in 19s`, or `sent as text` where the voice did not land). That split
exists because both model calls have rows of their own and that stretch had
none: the Sunday that took 315s spent 155 of them there, where Monday spent 20,
and nothing could say whether the embedding or the voice was the slow half.

None of this changes what she does. It exists because nothing else can see any
of it: the spend cap on the Anthropic key is a ceiling rather than a meter, web
search bills separately from tokens, and the briefing's nine-hundred-to-fourteen-
hundred-character target lives in the prompt, on the far side of a model call,
where no test can hold it. Unmeasured, the briefing grew by a sixth and the way
it surfaced was somebody counting the characters by hand.

**And all of it went somewhere it did not survive.** This repository's own
account of `pg_net` says plainly that nobody reads Edge logs — it is the whole
reason a failed briefing messages Telegram instead. Every cost and quality meter
was still writing there and nowhere else, so *"is the briefing drifting long
again"*, *"what did last month cost"* and *"how often does `fallbacks` actually
fire"* were questions whose answers were collected and then discarded within
hours.

`eugenia_runs` is those same figures somewhere they last. One row per model call
on the way out, plus a third row per briefing carrying what he actually received
and how long the whole thing took — kept apart on purpose, so *the critic costs
more than it is worth* and *the briefing is drifting long* stay two answerable
questions rather than one blurred figure. **A failed turn is a row too**, which
is the row that never existed: a briefing that dies costs the same searches as
one that lands, and the only trace was an apology, which is a message rather than
data.

**Two more figures were written after that argument was settled and did not get
it applied to them**, and both fail in the shape this table was built for — no
error, nothing reaching him, and the system looking healthy throughout. The
nightly embedding sweep writes `caller: 'embeddings'`, because a vendor that has
stopped answering takes the semantic arm of `eugenia_search` out while the
lexical one keeps returning results. The channel census writes
`caller: 'channels'`, because a ladder that has quietly stopped moving looks
exactly like one that had no reason to move — and a rung is read by comparing
nights, which a line discarded within hours can never be. `caller` is free text
precisely so neither of these needed a migration.

**Both of these shipped behind an early return**, which is the failure they
exist to end arriving inside the fix for it. `postConsolidation` returns at once
on a day nobody spoke, and the two meters sat after that return — so on exactly
the nights when nothing else happens, neither ran. Quiet nights are ordinary:
two of the four before this was found were `nothing said`, and a dead embedding
vendor could have survived all of them with the meter reporting nothing at all.
The quiet day is a branch now and the meters sit past it. What the test asserts
is that `postConsolidation` has exactly **one** `return` — the branch shape will
change, and a second return is what puts the hole back. The census may not be
hoisted to the top instead: it is taken after the pass because the pass is the
only thing that can move a rung.

**And a job that dies before its first model call now leaves a row too.** `ask()`
records a failed turn, so the table could answer *how often does a model call
die* — and could say nothing whatever about a job that never reached one. Two
consolidations threw in `turnsSince`, one line into `postConsolidation`,
apologised on two consecutive nights, and left no row on either: read afterwards
the table showed a system that had simply had nothing to do. `postScheduled`'s
catch writes `caller: '<job> job'` — the apology's own vocabulary, suffixed so it
can never be confused with an `ask()` label — **before** it sends the apology,
because the apology is sent with `.catch(() => {})` and a Telegram that is
refusing would otherwise take the only notice with it.

It never throws and never blocks the answer. A briefing that was written, paid
for and delivered must not be lost because an instrumentation insert failed — or
because `005` has not been applied yet.

### Adding the channel map to an existing database

`003_eugenia.sql` now ends with `eugenia_channels`. The statements are safe to
re-run as they stand — the seed is `on conflict do nothing` — so applying just
that block is the whole migration, and `verify.sql` then answers whether all
five rows are actually there. That last check is the one `agree.test.mjs` cannot
make: it reads the insert statement and confirms it names five channels, but
whether five rows exist is a fact about the database.

It matters more than it looks. `setChannel` PATCHes by primary key, so a missing
row is a `200` with an empty array — the move is dropped silently, and that
channel then renders at the bottom rung forever, which is indistinguishable from
a channel he has genuinely never used. The function reports that case back to
her rather than claiming success, but nothing reaches him.

### Applying 005, and the wiring it needs

`005_eugenia_senses.sql` is the senses, the meters and the compounding half. It
is **safe to re-run in full** — every statement is `if not exists`, `or replace`
or `on conflict do nothing` — which `003` deliberately is not, because this is
the file that will grow. A test asserts that: a bare `create table` or
`create index` in it would refuse on the second run.

**Being re-runnable also means it may not undo a later file**, which is the half
that has already been wrong once. 005 carried the two-argument `eugenia_search`
until `007` dropped that signature to make room for the query vector, and
re-applying 005 afterwards would have put the old function back *beside* the new
one — an ambiguous two-argument call, and a bare `create` taking `execute` from
the schema's default privileges, which Supabase grants to `anon` and
`authenticated` by name. The `revoke ... from public` sitting under it does not
touch either. Nothing would have failed; the file applies cleanly and the damage
is a privilege nobody asked about. The function is 007's alone now, 005 keeps
only the extension and the two trigram indexes it still owes it, and a test
reads every re-runnable file against every `drop` a later one makes.

Three things outside the SQL have to move with it, and none of them fails loudly:

**The event spine needs its own cron job.** `004_cron.sql` gains a
quarter-hourly `doji-eugenia-spine` calling `?release=1`. It is a second job
rather than a faster one because the four hourly predicates all test `hour ===`
— a `*/15` on the existing job would run four briefings every morning. It is
offset off the hour so it never collides with the 08:00 briefing.

**The price sense needs the second quarter-hourly job.** `004_cron.sql` gains
`doji-eugenia-price` calling `?move=1`, offset from the spine rather than sharing
its minutes: the two read the same calendar table for opposite purposes — the
spine for a print to look at, this for a print that would *explain* a move — and
running them together would have one deciding nothing explains it in the same
second the other is writing what does. Without the job the mark never advances,
which reads from every other surface as a market that has not moved.

**The webhook has to allow `callback_query`.** Re-register with
`allowed_updates = ["message", "callback_query"]`, or the taps under a briefing
are never delivered, the button spins, and nothing reports it.

**Four optional secrets, and one key serves all of them.** `STT_URL`/`STT_KEY`
enable hearing a voice note, `TTS_URL`/`TTS_KEY` enable answering in one, and
`EMBED_KEY` enables semantic search. Unset, each capability is simply absent —
she says she cannot hear, she answers in text, the search is lexical — and
everything else is unaffected, which is why none of them is in the boot guard.
An exemption from that guard is not free: each has to be guarded where the
secret is *used*, and a test holds all three to it.

```sh
supabase secrets set STT_KEY=<key> STT_URL=https://api.openai.com/v1/audio/transcriptions
supabase secrets set TTS_KEY=<key>
supabase secrets set EMBED_KEY=<key>
```

```sh
supabase secrets set STT_URL=https://<provider>/v1/audio/transcriptions
supabase secrets set STT_KEY=<key>
supabase secrets set STT_MODEL=whisper-1     # optional, defaults to whisper-1
```

`verify.sql` answers whether every table, trigger, policy, index and function
the numbered files declare is actually there, which is the half no test in the
repository can reach — and what it asks about is derived from those files by
`agree.test.mjs` rather than typed here, so a number in this paragraph would go
stale on the release that adds a row while the file itself stayed right. Read
the count in its own header and the `ok` column in its grid. Several of its
rows have been wrong that way already: it counted the cron jobs a mismatch on a
correct database from the day the spine was added, and it named three triggers
on `trades` while five existed, which is the worst thing a check can do.

### Applying 006, which is two columns and one view

`006_plan.sql` adds `planned_sl` and `planned_tp` to `trades` and appends them to
`eugenia_trades`. It is **safe to re-run**: both alters are `if not exists` and
the view statement appends rather than reorders. Nothing outside the SQL moves
with it — the poller writes the columns the moment it is deployed, and the app
never names them.

**Deploying the poller before running this file is the failure to watch for.**
The plan write is a PATCH filtered on `planned_sl=is.null`, so against a table
without the column PostgREST answers `400` and nothing is stored. It does not
take the poll down — the deals are why that function exists and they are written
by the time this runs — so the fills keep landing and the only sign is a line in
an Edge log nobody reads.

**`planned` in the poller's answer is not that sign, and used to be read as
one.** It counts rows written rather than calls made, so on a healthy run with a
position whose plan was recorded hours ago it is `0` — the same `0` the missing
column produces. That is the right trade: counting calls made it `1` every two
minutes, which a working filter, a filter that had stopped filtering, and a row
the upsert had not yet reached all produced alike, so the meter could not see
the failure it sits beside. What it reports now is `1` exactly once per position,
on the poll that first sees it, and `1` on every poll only if the arbitration has
broken.

So the check for whether this file has been applied is `verify.sql`'s **`trades
has its plan columns`** row, which asks the database directly. That is what
`verify.sql` is for.

### Applying 007, and the one call you have to repeat

`007_semantic.sql` adds `pgvector`, an `embedding` column and an HNSW index to
each of her two memories, and replaces `eugenia_search` with the two-armed
version. **Safe to re-run**: the alters and indexes are `if not exists`, and the
function is dropped before it is created rather than replaced in place — which
it cannot be, since the query vector is a new argument.

**It changes nothing until `EMBED_KEY` is set.** Unset, every write stores its
row without a vector and the search runs exactly as it did.

```sh
supabase secrets set EMBED_KEY=<key>
supabase secrets set EMBED_URL=https://api.openai.com/v1/embeddings   # optional, this is the default
```

**And it says why when it fills nothing.** `embed()` throws where the two write
paths swallow it — a vendor failure must never cost a note or a turn, and the
search still answers on words alone — but the door does not, because a door you
run by hand and read the answer of is the one place a swallowed reason is
indefensible. The first version replied `ok: true, filled: 0` to a missing
credit, a key without the permission and a mistyped secret alike, with the reason
written only to the Edge log this README already says nobody reads. The error now
carries the vendor's own body, since those are three different repairs and a bare
status sends you to the wrong one.

**Then backfill, and keep calling until it says zero.** Every row written before
this ran has a null embedding, which is invisible from the outside — the row is
there, the search still answers, and that row simply never comes back from the
semantic arm.

```sh
curl -s "https://<project>.supabase.co/functions/v1/doji-eugenia?embed=1" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
```

Each call fills fifty rows per table and answers `{"notes":{"filled":…,"left":…},
"turns":{…}}`. No cron job calls it: the archive is a one-off, and the trickle a
failed vendor call leaves behind is swept by the nightly pass, which already runs
and already reads the day. A schedule of its own would be a job doing nothing
every hour for the one night a year it had something to do.

**It drains newest first, which is the same decision the day's window got wrong.**
The sweep took `id.asc`, and since the backlog empties either way that looked
like a choice with no consequence — exactly how `order=id.asc&limit=200` looked
on the nightly turns. It was also the one read the bounded-read test could not
see, because it reads `rest/v1/${table}` for two tables through one function and
that test named its subjects; it matches whatever stands before the `?` now. The consequence is *when*: at fifty rows a night, a vendor
outage that left a fortnight without vectors became searchable oldest-first, so
last month's archive came back before last week's conversation and the rows he is
likeliest to ask about arrived last.

`verify.sql` ends with the count that matters — how many rows in each table are
still without an embedding. It should fall to zero and stay there. A number that
climbs day after day means the key is unset or the vendor is refusing.

**And the nightly sweep now says which, without being asked.** It writes a
`caller: 'embeddings'` row to `eugenia_runs` on both outcomes, and the three
states it has to part are three different repairs. A vendor that refuses throws,
so it arrives as its own message. An unset key does not throw — `embed()` returns
null and the rows are left exactly where they were — so *nothing filled with a
backlog still waiting* is an exact statement about the key rather than a guess,
and `sweepLine` says it in those words. A drained archive answers `0 filled, 0
left` and accuses nobody, which is the false alarm that would otherwise fire
every night for the life of the deployment.

Until this the whole account of a dead embedding vendor was a `console.error` in
a log nobody reads, while `eugenia_search` carried on answering off its lexical
arm and looked perfectly healthy. Half of `search_memory` could have been gone
for a fortnight with nothing anywhere to say so.

### Applying 012, which is one column and one view

`012_excursion.sql` adds `best_price` to `trades` and appends it to
`eugenia_trades`. **Safe to re-run**, for 006's reasons: the alter is `if not
exists` and the view statement appends rather than reorders.

**Deploying the poller before running this file is the failure to watch for**,
and it is quieter than 006's. The read that picks which trades to measure names
`best_price` in its filter, so against a table without the column PostgREST
answers `400`, the step logs and gives way, and the poll carries on — the deals
land, `excursions` reads `0`, and R-04 comes back `unknown` on every trade, which
looks exactly like a journal with nothing to check. `verify.sql`'s **`trades has
its best_price column`** row is what says which.

Once it is applied the backlog fills itself at three trades every two minutes.
`excursions` in the poller's answer counts rows written, for `planned`'s reason,
and reads `0` once every trade that can be measured has been.

### Applying 015, which is his commitments

`015_commitments.sql` recreates the check on `eugenia_notes.kind` with a third
word, `commitment`. **Safe to re-run.** Deploying the function first costs one
thing: a commitment she tries to record is refused by the old constraint, and she
tells him it did not save — so run the file first. `verify.sql`'s **`eugenia_notes
accepts a commitment`** row is what says which.

### Applying 014, which is the stop history

`014_stops.sql` creates `trade_stops`. **Safe to re-run.** It looks forward only:
every trade already closed has no history and R-19 reads it `unknown`, as it does
any position whose first recorded stop is later than the print it is judged at.
Deploying the poller first costs the same way the plan did — the read is a `400`
the step swallows, and `stops` in the poller's answer reads `0`.

### Applying 019, which is the weeks R-14 can judge

`019_calendar_weeks.sql` creates `calendar_weeks` and drops Forex Factory's two
tables and its function. **Safe to re-run.** R-14 answers `unknown` on every trade
until a week is marked, so run the history door once from his first trade.
`select min(open_day) from trades` gives the date:

```sql
select net.http_get(
  url := 'https://<project>.supabase.co/functions/v1/doji-eugenia?history=2026-01-05',
  headers := jsonb_build_object('x-doji-key',
    (select decrypted_secret from vault.decrypted_secrets where name = 'doji_cron_secret')),
  timeout_milliseconds := 10000
) as request_id;
```

Each week lands as a `calendar week` row in `eugenia_runs`, with how many
releases it filed, or why it could not. A history longer than two years, or a
walk that met TradingView's refusal twice running, is a second run from the
week its last row names.

### Applying 020, which is each release's series

`020_calendar_ticker.sql` adds `ticker` to `eugenia_calendar` and the index the
track record reads. **Safe to re-run.** Rows filed before it carry no ticker
until a filing writes them again, and the history door re-files every week it
walks. So walk it from a year back, `?history=` with a date twelve months ago,
and the release look has a year of each series behind it from the next print
on.

### Programmatic tool calls need their container

`web_search_20260209` does dynamic filtering, and **that runs code execution on
Anthropic's side**. From inside that container the model can call `get_trades`
programmatically rather than directly — the paused script invokes the tool and
the result returns to the running code instead of to the model's context.

A continuation answering those calls must carry the container id from the paused
response, and one that does not is rejected outright:

```
container_id is required when there are pending tool uses generated by
code execution with tools
```

That is what took the briefing down the morning after `get_trades` and
`remember` were both in play. Three rules of the contract, all now met and all
of which must stay met: the container id rides on the request as a bare string
(the response nests it under `container.id`), the user message answering the
calls carries **only** `tool_result` blocks with no text, and the `tools` array
is identical on every request of the turn.

Neither tool may declare `strict: true` — structured outputs are not supported
with programmatic calling. Nothing is lost by dropping it: `tradesQuery` clamps
`days` and `writeNote` coerces `note`, because both were written as boundaries
rather than as trust in the model.

### The rest of the wiring

**A reply is answered after the response, not inside it.** Telegram waits about
a minute for a webhook and then gives up with `Read timeout expired` and
redelivers the update — and a briefing does not fit in a minute. Answering late
is worse than slow: the redelivery runs the whole thing again, so you get two
briefings and pay for two. The function returns 200 immediately and hands the
work to `EdgeRuntime.waitUntil`, which keeps the worker alive past the response.
Her cron half has no such limit, because pg_net never retries.

**Twelve turns of memory.** Enough that a follow-up has the briefing it follows
and the exchange since; not so much that every question resends last Tuesday's
calendar. Both tables have RLS enabled and no policy at all, which denies the
publishable key outright.

**The window is repaired on the way out, not assumed on the way in.** The
Messages API merges consecutive same-role turns and refuses a leading assistant
one, and that refusal is total: every reply 400s until the offending row rolls
out of the window. The old argument was that turns are written in pairs, so an
even window can only open on a user turn — and it is wrong. Two rows in one
`INSERT` draw two sequence values and a concurrent `INSERT` can take one in
between, so two messages sent seconds apart — ordinary, since the webhook answers
200 immediately and both handlers then run at once — can interleave as
`u₁ u₂ a₁ a₂` and the window opens mid-pair. `openOnUser` drops leading assistant
turns, which retires the even-window rule entirely: nothing now depends on a
sentence being remembered, and `HISTORY` is free to be any number.

**A long briefing still does not fit in one Telegram message.** The cap is 4,096
characters, so `chunk()` splits on a blank line, then any newline, and only
hard-cuts a single paragraph that is itself over the limit. Parts go
sequentially, because Telegram does not promise ordering.

That is what it does now. It was written as `Math.max` over the two
`lastIndexOf` calls, and every blank line contains a newline at a higher index —
so the paragraph term could never win the max and the split silently took the
last newline of any kind. The one thing `FORMAT` lets carry an internal newline
is a plain-dash list of times, which is exactly where the break then landed.

**A refusal no longer costs the whole briefing.** Nothing retries the cron half
— `pg_net` is fire-and-forget — so a model declining the request was simply a
morning with no briefing and a line in a log nobody reads. The request now
carries `fallbacks: "default"`, which re-runs it on another model inside the same
call and routes by refusal category, so there is no model list here to go stale.
A decline before any output is not billed. The `stop_reason === "refusal"` check
stays and still fires: it is now the case where the whole chain declined.

**Two other stop reasons carry text that is not the answer, and the loop reads
both.** `pause_turn` is the server's own search loop stopping at ten iterations
mid-turn — reachable by any caller allowed twelve searches and six fetches — and
read as an ending it sent whatever preamble came before the pause, or died on
`no text`. It is resumed by sending the paused response back as it stands, and
counts as a round, so `MAX_ROUNDS` still bounds it. `max_tokens` is an answer
cut off, or a tool call dropped half-written; it throws, so the briefing's retry,
a gate's draft or the apology runs, and the failure row says `cut off at
max_tokens`.

**And a fallback now says so.** It is invisible by construction — the call
succeeds, the briefing arrives on time, and the only difference is that another
model wrote it. `ask()` compares the `model` on each response against the one
the request asked for and appends `FELL BACK TO <model>` to its cost line when
they differ. It is kept for the whole turn rather than the round, because a
briefing whose first round was rescued and whose second was ordinary is still a
briefing worth knowing about; and the model is named once in the file so the
request and the comparison cannot drift into reporting a fallback on every call.

**She is told what time it is, and told when each past exchange happened.** Asked a
question at 23:42 she opened with "morning" — not a model error, but the only
inference available from what she was given: a system prompt about morning
briefings, and a history whose most recent long turn was that morning's
briefing. `ask()` attaches the New York date and time to the turn being asked —
in one place, because three callers each remembering was three chances to
forget, and removing it from the pulse alone left every test green. The prompt
tells her to trust it over the conversation, because the conversation genuinely
does argue for morning.

History is dated too. "Yesterday you said the print was the thing to watch" is a
guess across a weekend otherwise, and the prompt now forbids her inferring the
date from the turns themselves — so each user turn carries the New York day it
happened on, from a `created_at` the table already had. Her own words go back
unprefixed: a date in front of them reads as though she said it.

**A slash command is answered without a model call.** `/start` arrives once per
install and is addressed to Telegram rather than to her; answering it the normal
way costs a full turn with the notes attached. Gladys ignores everything that is
not a tap for the same reason.

**A question is not a briefing, and used to cost the same.** `effort` sets how
deeply the model thinks before it writes. The briefing earns the depth and runs
at `high`; a reply and the pulse run at `medium`, because at `high` "how many
trades did I take this week" bought a minute of reasoning to produce one
sentence. Not `low`: the journal is the half that punishes carelessness, and a
fast wrong reading of his discipline is worse than a slow right one.

The typing indicator repeats while she works, because Telegram's lasts five
seconds and cannot be extended — one call at the start left a thirty-second
answer looking like a dead bot for twenty-five of them. It makes nothing faster;
it makes the wait legible.

**What she costs, measured rather than estimated.** `eugenia_runs` carries every
model call, and the week of 2026-09-10 came to **$16.68, about $72 a month** —
not the $10 this paragraph used to claim from an estimate, and not spent where it
claimed either:

| | tokens | rate | |
|---|---|---|---|
| cache writes, 1h | 620,460 | 2× | **$6.20** |
| cache reads | 6,267,957 | 0.1× | $3.13 |
| cache writes, 5m | 435,375 | 1.25× | $2.72 |
| output | 94,956 | $25/M | $2.37 |
| web search | 123 searches | $10/1,000 | $1.23 |
| fresh input | 202,653 | $5/M | $1.01 |

**The cache is the bill.** Writes alone are 58% of the token spend and the
largest line on the table — larger than everything she says. Search is 7%, where
this paragraph used to say the searches dominate and a weaker model would
therefore save little; that was wrong in both halves. Deriving the window from
the tool array takes the 1h line to about $1.08 and moves the rest onto the 5m
rate, roughly $64 a month.

**And one model for every caller was never a decision either.** Read per caller,
the same week says something the totals hide:

| caller | turns | $/wk | model |
|---|---|---|---|
| release look | 14 | **$5.30** | Sonnet 5 |
| weekday briefing | 5 | $4.12 | Opus 5 |
| pulse | 5 | $1.89 | Sonnet 5 |
| consolidation | 7 | $1.47 | Opus 5 |
| critic | 6 | $1.35 | Opus 5 |
| move look | 2 | $1.27 | Sonnet 5 |
| Sunday briefing | 1 | $0.98 | Opus 5 |
| reply | 1 | $0.31 | Opus 5 |

**Fourteen release looks cost more than five briefings**, and the move look is
$0.64 a turn — the most expensive single message she sends, for two sentences
about a price. The split was between **judging and checking**: what stays on Opus
decides something open, and what moves is bounded work handed everything it
needs.

**It cost a caller its life, and the table above is what the money looked like
before that was known.** The release look, the pulse and the move look moved to
Sonnet; the release look died at `MAX_ROUNDS` on its first two firings the next
morning, twice inside half an hour, arriving as the apology. Fourteen turns on
Opus in the measured week had never come near the cap.

**What those two failures were first read as establishing, they do not.** They
were written down as proof that *the round budget on a tool-heavy caller is a
property of the model* — but two changes landed that night, not one. At 23:16
`record_actual` became the release look's tool for the number; at 00:35 the look
moved to Sonnet. The model was reverted at 12:41 and the rounds did not come
back: before that night the look took two or three, and back on Opus it took
10, 8, 5, 9, 9, 7 and 8. The change that was not reverted is the one still
standing. The model is not ruled out; it is not established either, and a
lesson drawn from a confounded pair is exactly what this repository says is
worth nothing.

What survives is the policy, which never depended on the attribution: a cheaper
caller that does not answer is not cheaper, and any future move is one caller at
a time with `rounds` read afterwards. **The cap is a working limit again** —
seven to nine rounds against ten — and neither raising it nor moving a model is
the next step. The row now says what the rounds were SPENT on: a successful
turn's `detail` carries the count of each of her own tools it called
(`record_actual×4, get_market×1`), and a failed turn's carries the same after
its error. Server-side searches and fetches were already counted beside it. A
name `record_actual` cannot match costs a round and says so; so does each
`get_market`; so does a model calling one tool per round instead of batching
them. Those are different repairs, and the tally is what tells them apart.

**The first look it recorded named the cause.** On 30 September the release look
took seven rounds and its detail read `record_actual×6`, and she told him why in
the message itself: the tool said nothing at that time was called `core PCE`,
then listed `core PCE` as what was on file. The tool had wrapped the name in
double quotes to protect a comma, and PostgREST reads an `eq` value whole — it
strips quotes only inside an `in.(…)` list — so the quotes became part of the
name it compared, and no call had matched since the tool shipped on 16
September. That accounts for the jump in rounds with no help from the model. The
name now goes out as itself, URL-encoded, and the test's stand-in database
filters the way PostgREST does; the old one answered every write as a match,
which is how a test asserting the quotes stayed green through all of it.

`trim` stays on Sonnet, and the distinction is the whole of why: it is handed
`CRITIC_TOOLS`, which is empty — one request, no loop to run out of — so it
cannot reach the cap whatever a model's appetite for rounds. That is the shape a
cheaper model is safe on here.

The lever after that is the prefix itself: 23,309 tokens written 32 times a week.
It is worth about $3 a month against editing what she is told on every turn, and
it is refused on those terms rather than pending.

**What the prompt cache actually buys, said plainly.** Her cached prefix is
23,309 tokens with the chat tool set and 16,477 with the nightly pass's — read
off `eugenia_runs.wrote_1h`, which records the size of the entry each caller
writes, rather than estimated. The default window is five minutes, and what that
buys is the rounds *within* one turn: a briefing that reads the journal and
writes a note is three requests carrying that prefix, seconds apart, and a read
refreshes the five minutes, so a long turn keeps its entry alive to the end.

**The hour has a price, and a week of rows decided who pays it.** A cache READ
is a tenth of the input rate; a cache WRITE is 1.25× at five minutes and **2× at
an hour**. So the longer window does not simply buy more — it moves the
break-even from two requests on a prefix to three, and a caller that makes one
request and is not followed within the hour pays double for a lifetime nothing
uses. That matters more than it looks, because *the tool array is part of the
cache key*: each tool set is a separate prefix, none readable by another.
Which makes *is a second turn likely inside the hour?* a question about the
**array** rather than about the caller — and the answer came back in one shape:

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

Consolidation's sixth turn is neither: it is the row `ask()` writes for a turn
that failed before the model answered, and reading it as an inherited prefix is
the mistake this table is laid out to prevent.

Only `RELEASE_TOOLS` earns the hour, and for a reason in the schedule rather than
in the prompt: its job runs quarter-hourly, so a morning carrying several release
times clusters the looks inside one window. The briefing is 08:00 and the pulse
is 10:00 — two hours apart — so the hour those were paying 2× for could never
have been read by anything. The window is derived from the tool array now: `1h`
for `RELEASE_TOOLS`, `5m` for the rest, which is 512,059 tokens a week moving
off the doubled rate.

**The move look used to share that array, and has its own now.** It bought the
hour without earning it — two turns, two prefixes written, none inherited — and
it was handed `record_actual` for a move the calendar has already said no print
explains. `MOVE_TOOLS` is the release look's set without that tool, at five
minutes.

`ask()` records both halves — `cached` for the reads, `wrote_1h` and `wrote_5m`
for the writes, kept apart because their rates differ and a sum of them cannot be
turned back into money. Until those two columns existed the one figure that
decides the window was the one figure the meter beside it did not collect, and
the argument for the hour had nothing under it.

**Inside a turn the conversation is cached too, at five minutes.** Only the
system block carried a breakpoint, so each round of the tool loop re-sent
everything after it at full price — the history, the day's blocks, every tool
result and every fetched page. The loop marks the newest `tool_result` block, and
the mark *moves* rather than accumulating: a request may carry four breakpoints,
the system block holds one, and the loop runs six rounds. Five minutes rather
than an hour because rounds are seconds apart and nothing reads this once the
turn ends — and the longer TTL has to come first in the request, which it does,
since `system` renders ahead of `messages`.

**The critic is handed an empty tool array, and that is the cheaper option as
well as the stricter one.** Sharing the briefing's array so the critic could read
its prefix instead of writing one was tried, shipped and measured: it wrote
23,309 tokens and read none, seconds behind a briefing that had just written
exactly that. The array is where the cache key starts, and the two calls also
differ in EFFORT — `high` against `medium` — which invalidates the tools and
system caches by itself. An empty array is the smaller write of the two. The
figures and what would have to change first are in `REFACTOR.md` R-15.

### What she is watching, on the dashboard

She and the app have shared a database and nothing else: everything she knew
lived in a Telegram thread. Three things are worth a glance on the screen he
already opens every morning — what lands today, what story she is carrying, and
what is still open — and none of them is private to her.

**Not her notes and not her turns.** Those stay denied to the publishable key
exactly as `003` left them; his window into them is `/notes`, in her own thread,
where an answer can be asked a question back. The three tables the card reads
carry no `user_id` and nothing to scope a policy by, so `using (true)` for
`authenticated` is the honest statement of what is true rather than a view
standing in front of tables that deny everyone. A test asserts the card reads
only those three, and that `005` opens no policy on the other two.

**One read, after the render, never in front of it.** The journal is what the
page is for. A failure — `005` not applied, the policy missing, the network gone
— hides the card and touches nothing else.

That failure is checked rather than inferred, which it was not at first:
`supabase-js` resolves a failed read as `{ data: null, error }` rather than
throwing, so `data || []` turned a missing table into an empty calendar. The card
hid itself, nothing was logged, and why it was blank became unknowable — the same
mistake `readTrades` is written against on her side of the wire, in the same
words: **an empty answer is only an answer when something was read.**

### What she will not do, and what she may

In the prompt rather than left to taste: **no signals** — no entry, no level to
buy or sell at, no stop, no target, nothing about what to do with a position —
and never more than one question at a time. No instruction note can widen that;
one that narrows it (*"keep your read to yourself"*) is obeyed.

**Most of what she says is what the market is pricing.** *"A December cut is
about 70% priced"* is a fact about today. *"A 0.4% core print is not in the
price"* is a statement about expectations. Saying them is most of what stops the
briefing reading like a wire feed.

**She may also give her read, fenced three ways.** Which way today's news leans
for gold, said as *her read* (*"my read is this print is bad news for gold"*),
with what would prove her wrong in the same breath, and with no level in it —
the moment a read has a price in it, it is a signal. One per message at most, in
the briefing or a conversation; the pulse, the release and move looks and the
trade event carry none, because they land at moments she did not choose. **And
none at all while you are in a position**, where a view on price is advice about
the trade however it is worded. *"That will send gold lower"* stays out: that is
a forecast dressed as a fact. Both gates carry the same fence and are handed
what you have on, so the pass that runs last neither lets a tip through nor cuts
a read that obeyed it.

**A level price has already printed is a fact, and she may name it.** Today's
high and low, the overnight range, the previous close, where a release moved
gold from and to: all things that happened, and all checkable against your own
chart. What stays out is a level attached to what comes next (where price gets
to, whether a level holds, a level worth watching), and any printed level in
the same paragraph as her read. A level beside a direction is an entry with the
word *buy* left out.

**She checks a plan you have not taken yet, when you ask, against your rules.**
Give her the entry, stop and target you are about to use and she says which of
your rules the plan meets and which it breaks: the target and stop distances
(R-01, R-02), the reward against the risk at entry against the 1:1.5 the
pre-trade sequence asks for (R-08), a release rated high inside R-14's thirty
minutes, whether the day already rules out an entry (R-03, R-11, R-12, R-16),
something already open (R-10), and the Friday close (R-15). Whether the setup is
the right kind of level is a judgment rule and stays yours. **The levels stay
yours too.** She never suggests a different entry, stop or target, never says
whether the setup is good or whether to take it, and never goes from "the ratio
is 1:1.1" to the target that would fix it. TRIM, the gate on every reply, keeps
the check and takes out any level she offers in place of yours. Both of these
were decided when the no-signal rule was put to you: the rule stays, and these
are what a coach does inside it.

**She judges trades, the decision and never the result.** A closed trade gets a
plain verdict and, where there is one, the lesson — measured against your rules
and the plan you entered with, not the P&L. A loss taken inside your rules was a
good trade; a win that broke one was a bad trade that paid. Judged on the result
she would be praising luck and punishing discipline. Blunt, not cruel: once, and
about the trade rather than about you. **And never the fact alone.** The first
briefings under these rules named a breach and went straight back to the market,
which is a report you can read off your own journal; the verdict is not optional,
and the critic adds one a breach was left without and may not cut it for
length. A trade still open gets no verdict — that
waits for the close.

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

### Palette

Every colour is a CSS custom property on `:root` in `index.html`. Nothing in the
app writes a literal — Chart.js is the one thing that cannot read a variable, so
what it needs is resolved once through `cssToken()` into a module constant.

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

**The result colours have a house treatment**, and it is worth knowing before
adding anything that shows a win or a loss: a flat 12% fill against a
full-strength border. `--seg-win-bg` and `--seg-loss-bg` are `--win` and `--loss`
at `.12`; the hover pair `--seg-win-hv` / `--seg-loss-hv` are the same at `.22`.
Break-even is the exception and is a solid colour rather than an alpha, because
it has to stay legible on a 58px calendar cell where a translucent fill hazes.

Break-even is also deliberately the darkest of the three: nothing happened, so it
recedes furthest. Its green runs at or above its red so a small tile goes cool
rather than mauve — the rest of the palette has red above green, which reads warm
on a large card and muddy on a cell.

**Neutral surfaces come from seven alphas of white**, so a change lands in one
place: `--fill-0` (`.02`, inset panels) through `--fill-3` (`.08`, hover on a
`--fill-2` surface), plus `--row-hv` (`.03`), `--hair-2` (`.07`) and `--bd-hi`
(`.30`). The accent has the same ladder — `--p-gl` at `.07` through `--p-gl4` at
`.42`, and `--p-hair` at `.04` for the table row rule.

**Type** is `--ui` (Hanken Grotesk) and `--mono` (JetBrains Mono). **Radii** are
`--r-sm` 10px, `--r-md` 14px, `--r-lg` 18px, `--r-full`, and `--r-cell` 5px —
the last an exception for calendar tiles, which at the card radius each read as
their own card and stop scanning as rows.

---

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
- `rrBar(list)` — the realised R:R bar above each wheel, same head and track
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

**A calendar cell carries two separate readings in one colour.** The **hue** is
the result — which way the day went. The **strength of the fill** is size: the
day's `|net|` against the largest `|net|` **in the month on show**, floored so
the quietest day is still plainly coloured. The scale is the month's own, so the
question a cell answers is "how does this day compare with my month" rather than
"with the loudest day in the account" — rescaling it globally would leave most
months a grid of near-blanks. It is one custom property, `--hm-i`, mixed in CSS
rather than three fixed bands, because bands would need an alpha for every band
*and* every band's hover. Break-even is deliberately not scaled: nothing happened,
so there is no size to show. Today is marked on the day **number** rather than
the cell, because purple already means unfinished here. And the **dashed border**
on the week rail says derived rather than recorded — it is the one cell in the
grid holding no trade of its own, which is also why it carries no `--sh-2`.

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

## Deployment

**`index.html` is served by Vercel from `main`, and the Edge Functions follow
the same rule.** `.github/workflows/deploy-functions.yml` runs
`supabase functions deploy` on any push to `main` that touches
`supabase/functions/**` or `supabase/config.toml`. It needs one repository
secret, `SUPABASE_ACCESS_TOKEN`, generated from the Supabase account page.

All five functions go on each run rather than only the changed one, so none of
them can drift apart from the others. `adherence.ts` ships inside
`doji-eugenia` the way `prompt.ts` and `strategy.ts` do — it is a module of that
function, not a sixth one. `verify_jwt` lives in
`supabase/config.toml` rather than in a dashboard toggle, which is what makes
the committed file the whole description of how a function is deployed.

**`supabase/functions/_shared/edge.ts` holds one definition of each primitive**
— `env`, `secretMatches`, `json`, `sbHeaders`, `mcpInit`, `parseSse`, `telegram`,
`nyDate` and `nyClock` —
bundled into every function that imports it. The test is not "could this be
shared" but **"are there two copies nothing can compare"**, and `secretMatches`
is why: the function exists to be *constant-time*, so a copy quietly rewritten
to `presented === expected` returns the same answer to every assertion anyone
would write while leaking the secret through timing. A behavioural test cannot
see that, so `agree.test.mjs` reads the body instead — the loop over the longer
of the two inputs, and the absence of any direct comparison of the two secrets.
One definition has nothing to drift, and now the definition itself is held.

The rest met the same test and were extracted late. `sbHeaders` and the Telegram
call were **byte-identical** in both bots. The two New York clocks differed only
in what they returned when `Intl` failed to emit a part — Monday noon in the
poller, `-1` in Eugenia — and neither branch can fire, because `formatToParts`
with `weekday` and `hour` requested always emits both. That is defensive padding
at a boundary where nothing untrusted enters, so it is gone and an impossible
response now throws rather than quietly deciding the market is open.

`nyDate` and `nyClock` are separate because they answer separate questions —
which civil day an instant falls on, and what weekday and hour it is. The poller
asks the first to file a trade and Eugenia asks it to decide whether today's
briefing already went; the poller asks the second for market hours and Eugenia
for both her schedules. Gladys's `nyTime` stays hers: it is a display format with
one caller, not a third reading of the clock.

Configuration is an argument rather than a capture, which is what makes sharing
free: each bot binds its own token in one line, and every call site below it is
unchanged. `sbHeaders(prefer?)` names the `Prefer` at the call site, which also
keeps an upsert directive off a `PATCH` — the poller's private copy had
`resolution=merge-duplicates` baked in and sent it on the balance write, where
it means nothing.

What is deliberately **not** shared is the entry point. All five authorise their
own callers with the same shape — refuse if a secret is unset, match one, match
the other, 401 — and extracting that into a router would put the one check
worth reading behind a helper. Authorisation stays visible in the file being
read.

**`npm test` runs first, in the same job, and a red suite stops the deploy.**
`test.yml` also runs on every push, but it is a *separate* workflow — it would
have gone red beside the deploy while the deploy shipped anyway, leaving two
green ticks, one red, and the broken code already live. A failing step inside
the deploy job is the only ordering that actually holds anything back. It is
also what makes `_shared/` safe to depend on: the suite imports it by the same
relative path the functions use, so an extraction that does not resolve fails
the job instead of shipping five broken functions at once.

**This is worth the machinery for one reason.** The poller and Gladys were
pasted into the dashboard by hand, and nothing tied the running code to the
committed code — so the repository could describe a system while the system ran
something else, and every later change would be reasoned about from a file that
was not the truth. That failure is silent, which is what makes it expensive.

**Two things are still deliberately manual.** The SQL is run knowingly in the
SQL editor, never by a robot: `001_trades.sql` through `020_calendar_ticker.sql` are not
under `supabase/migrations/`, so nothing applies them automatically, and a
schema change that lands because a file was committed is exactly the accident
the Operating section argues against for restores. The Apps Script is deployed
from the Apps Script editor; it holds no secrets in the file and nothing reads
it from here.

**The editor reads the words and not the language, so no file says `select …
into`.** Before it runs anything it looks for new tables without RLS, and it
takes `select … into worst` inside a plpgsql function for `create table worst`.
It then warns, and its *run with RLS* button appends `alter table worst enable
row level security` to the END of the paste — a table that does not exist, so
Postgres refuses the statement and the whole paste, which runs as one
transaction, rolls back with it. Every function here reads into a variable as
`x := (select …)` instead, which means the same and cannot be mistaken for a
table, and `agree.test.mjs` refuses the other form in any numbered file.

**Check the paste ends where the file does.** The editor runs its whole contents,
or only the selection if there is one. A paste that stopped partway — 010 has
twice arrived cut at line 150 — fails as `unterminated dollar-quoted string`,
which reads like a fault in the file. The last line in the editor should be the
file's last line.

**Applying by hand means the files are a claim, so `supabase/verify.sql` is how
the claim gets tested.** It writes nothing: it reads back the columns, the
constraints, the indexes, the policies, the grants on Eugenia's view, the
triggers, the realtime publication, every cron job and the last ten function
responses, to be compared against 001–007 by eye. Run it after any manual change
and before believing anything here about the database. A CI job cannot stand in
for it — 002, 003 and 004 need `pg_net`, `vault` and `pg_cron`, none of which a
plain Postgres container has, so a green pipeline would prove only that 001
parses.

**001, 002 and 003 are not re-runnable in full, and the reason differs.** 002 is
a function and two triggers and is entirely `create or replace`, so it re-applies
cleanly — its closing `drop function if exists` is the old single-purpose name of
that function, left behind rather than dropped by the triggers being repointed
above it, and a no-op on a database that never had it. 001 and 003 create tables,
which stops them at the first statement — so a change to something further down
is applied by running *that statement* on its own. In 003 those are the `eugenia_trades` view and the three grants under it,
which is what an existing database needs to pick up `security_invoker`:

```sql
create or replace view public.eugenia_trades
  with (security_invoker = true) as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         open_day, setup, followed_rules, followed_sl, followed_tp, size_oz,
         net_pnl, planned_sl, planned_tp, best_price
  from public.trades
  where deleted = false;

revoke all on public.eugenia_trades from anon, authenticated, service_role;
grant select on public.eugenia_trades to service_role;
grant select on public.trades to service_role;
```

An existing `trades` needs the column Gladys edits her own message through.
Without it the redraw trigger's `WHEN` clause is never true, and journalling in
the app goes on reaching Telegram not at all — silently, because the half that
posts the message is unaffected:

```sql
alter table public.trades add column if not exists tg_message_id bigint;
```

Apply that **before** 002, which creates the trigger that reads it.

And an existing `eugenia_notes` needs its `kind` column, which is what lets a
standing instruction outlive twenty observations:

```sql
alter table public.eugenia_notes
  add column if not exists kind text not null default 'fact';
alter table public.eugenia_notes
  drop constraint if exists eugenia_notes_kind_check,
  add constraint eugenia_notes_kind_check check (kind in ('fact', 'instruction'));

create index if not exists eugenia_notes_kind_id_desc
  on public.eugenia_notes (kind, id desc);
drop index if exists eugenia_notes_id_desc;
```

A `trades` that carries `planned_stop` and `planned_target` sheds them, and the
view goes first because it reads them — a column something depends on cannot be
dropped out from under it. `create or replace view` cannot do this half: it
matches column by column and may only append, so a shorter list is a drop and a
rebuild, which is the other side of the trap #30 was fixed for.

**The rebuild is in the same block as the drop, and that is not tidiness.** It
was written as a drop followed by *"…then re-run the view statement above"* — a
migration whose second half is a cross-reference, which is a half that gets read
rather than run. Left undone, the columns are gone and so is the view, and every
read Eugenia makes of the journal answers `404`: PostgREST's PGRST205, the
relation is not in the schema cache. That is what 08:00, 09:00, 10:00 and 11:00
each reported on 2 September, one sentence apiece and no briefing at all.

```sql
drop view if exists public.eugenia_trades;

alter table public.trades
  drop column if exists planned_stop,
  drop column if exists planned_target;

create or replace view public.eugenia_trades
  with (security_invoker = true) as
  select id, direction, entry_time, fill_time, entry_price, exit_price, pnl,
         open_day, setup, followed_rules, followed_sl, followed_tp, size_oz,
         net_pnl, planned_sl, planned_tp, best_price
  from public.trades
  where deleted = false;

-- A view is dropped with its privileges, so these are not optional either.
revoke all on public.eugenia_trades from anon, authenticated, service_role;
grant select on public.eugenia_trades to service_role;
grant select on public.trades to service_role;
```

Run `verify.sql` after it. *eugenia_trades is select-only, service_role only*
answers `none` on a view that is missing and on one rebuilt without its grants,
which are the two ways this ends badly and the only check that tells them from a
healthy database.

The two columns held a plan the journal asked *him* to type, and nothing read
them but Eugenia. **`planned_sl` and `planned_tp` are not those columns coming
back.** They are broker-owned, written by the poller off the open position, and
he types neither — which is the distinction §10 turns on, since what was shut is
the door to journalling a plan by hand.

Search is added to both of Eugenia's tables, and the whole block is idempotent —
`add column if not exists`, `create index if not exists`, `create or replace
function` — so it can be re-applied without a drop:

```sql
alter table public.eugenia_notes
  add column if not exists search tsvector
  generated always as (to_tsvector('english', note)) stored;

alter table public.eugenia_turns
  add column if not exists search tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists eugenia_notes_search on public.eugenia_notes using gin (search);
create index if not exists eugenia_turns_search on public.eugenia_turns using gin (search);
```

…then the `create or replace function public.eugenia_search` statement from
`003_eugenia.sql`, **including the `revoke` and `grant` under it** — EXECUTE is
granted to PUBLIC by default and `anon` inherits it, so skipping those two lines
leaves a public entry point to her memory with only RLS behind it.

The generated columns backfill on the `alter`, so the whole archive is
searchable the moment it runs — this is the one change today that works on
history rather than only going forward.

**`eugenia_search` has changed since, and a database that already has it needs
that statement run again.** Its turn arm now reads `role` and labels each hit
`you` or `him` instead of `turn`; until it is re-applied she is still handed his
messages as her own words, and nothing about that is visible from the app or the
logs. `create or replace function` is the whole migration — the signature is
unchanged, deliberately, so the `revoke` and `grant` under it are untouched and
no grant is dropped. `verify.sql` confirms the function exists; that it reads
`role` is a fact only the source shows, so re-run the statement rather than
checking for it.

An existing `eugenia_notes` needs its `superseded_by` column, and the index has
to be replaced with the partial one the read now matches:

```sql
alter table public.eugenia_notes
  add column if not exists superseded_by bigint references public.eugenia_notes(id);

drop index if exists eugenia_notes_kind_id_desc;
create index eugenia_notes_kind_id_desc on public.eugenia_notes (kind, id desc)
  where superseded_by is null;
```

Without the column the read's `superseded_by=is.null` is a 400 on every turn,
and `notesBlock()` swallows it — she loses her whole memory and says nothing.

An existing `trades` needs its `size_oz` column, and Eugenia's view has to be
replaced to expose it — the view statement in `003_eugenia.sql` is `or replace`
precisely so it can be re-applied on its own:

```sql
alter table public.trades add column if not exists size_oz numeric;
```

Then re-run the `create or replace view public.eugenia_trades` statement from
`003_eugenia.sql`.

**`net_pnl` was appended to that same list**, so an existing database picks it up
by re-running the one statement and nothing else — no column to add, no grant to
restore. It is there because `pnl` alone cannot be summed honestly: `pnl` is
`coalesce(net_pnl, computed_pnl)`, so on a position whose broker email has not
landed it is the folded figure and carries no swap. Served `pnl` alone, Eugenia
followed the strategy's monthly instruction against a column she could not read
and produced totals short by an unknown amount, on rows she could not identify.
With both she sums the settled ones and says how many fell back.

**The tail of that select list is in the order columns were added, on purpose.**
`create or replace view` matches the existing view position by position and may
only append, so a column inserted mid-list reads as renaming whatever used to sit
at that position — `cannot change name of view column "open_day" to "size_oz"`.
Moving `size_oz` or `net_pnl` up beside the other broker columns, where they
belong by sense, is the tidy that breaks re-application on every database that
already has the view.
Reordering or removing needs a `drop view` first, which also drops the grants
under it.

The alter is the half that fails quietly. PostgREST drops a key the table does
not have from a `merge-duplicates` payload instead of refusing the row, so a
database that missed it keeps accepting fills and keeps storing no size.

`verify.sql` answers whether it took.

**`004_cron.sql` is safe to re-run**, and that is the point: `cron.schedule`
upserts on the job name, so applying the file makes the database match it rather
than describing what the database might hold. The poller's job was not in this
repository at all until then — its schedule, its timeout and the secret it
presents were readable only by querying the live database, which is the same
silent drift `deploy-functions.yml` exists to prevent for the functions.

Seven jobs, and `select jobname, schedule, active from cron.job order by
jobname` is how you read them back:

| Job | Schedule | What it drives |
|---|---|---|
| `doji-mcp-sync` | `*/2 * * * *` | the poller |
| `doji-eugenia` | `0 * * * *` | the briefing, the pulse and the nightly pass — the function decides which, or neither |
| `doji-eugenia-spine` | `5,20,35,50 * * * *` | the release look |
| `doji-eugenia-price` | `12,27,42,57 * * * *` | the price mark and the move look |
| `doji-dispatch-watch` | `*/10 * * * *` | `009`'s sweep |
| `doji-pace-watch` | `37 * * * *` | `010`'s one-a-day warning |
| `purge-cron-history` | `0 3 * * *` | trims `cron.job_run_details` |

Only the first four call a function; the two watchers post to Telegram
themselves, which is what keeps a watchdog off the thing it watches, and the
last touches nothing outside pg_cron. `verify.sql` counts them, and
`agree.test.mjs` holds that count against this file — a row that had already
been wrong once, reporting a correct database as broken.

---

## Setup from scratch

1. Run `supabase/001_trades.sql` in the SQL editor.
2. Confirm `trades` is in the `supabase_realtime` publication and has RLS enabled.
3. Put the project URL and publishable key in `SUPABASE` in `index.html`.
4. Deploy the functions — they deploy from `main`, see **Deployment** — and set
   `CTRADER_MCP_TOKEN`, `DOJI_USER_ID` and **`SB_SECRET_KEY`** in Edge Function
   secrets. `SB_SECRET_KEY` holds an `sb_secret_` key from the API settings page,
   and the name is short for a reason: Supabase owns the `SUPABASE_` prefix, so a
   secret cannot be created under it. A function reading `SUPABASE_SECRET_KEY`
   therefore reads `""` however carefully the dashboard is filled in. Unset,
   every function answers 503 at its first line rather than reaching for
   something else.
5. **Generate one cron secret and store it twice**, because two systems read it
   under two spellings: `DOJI_CRON_SECRET` in Edge Function secrets, which is
   what the poller and the two bots check, and `doji_cron_secret` in Vault,
   which is what the cron jobs and Gladys's trigger present. Same value, and the
   lower-case one is the database's. Nothing works without both.
   `doji-email-sync` is the exception and checks its own — see step 7.
6. Run `supabase/004_cron.sql` to schedule the poller, Eugenia and the nightly
   sweep of pg_cron's own history. It is safe to
   re-run: `cron.schedule` upserts on the job name, so the file is what the
   database holds rather than a description of what it might.
7. Deploy the Apps Script. Generate a second secret, and store it twice:
   `DOJI_EMAIL_SECRET` in Edge Function secrets, and the same value in the
   script's own Script Properties, never in the file. It is separate from the
   cron secret on purpose — this is the only secret that lives outside your own
   infrastructure, so it opens the narrowest door there is. Run `testParse`, then
   `testSecret`, then trigger `syncPepperstone` every minute.
8. For Gladys: create the bot with BotFather and send it `/start` once, so it
   may message you unprompted. Set `GLADYS_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and
   `GLADYS_WEBHOOK_SECRET` in Edge Function secrets — values never in the
   repo, the same discipline as the Apps Script's.
9. Point Telegram at her function, passing the secret it will check:

   ```
   POST https://api.telegram.org/bot<token>/setWebhook
        url=https://<project>.supabase.co/functions/v1/doji-gladys
        secret_token=<GLADYS_WEBHOOK_SECRET>
        allowed_updates=["callback_query"]
   ```

10. Run `supabase/002_gladys.sql`. It reads `doji_cron_secret` from Vault —
    the same secret and the same read the poller's cron job uses, so the trigger
    holds no database power either. **Check the name against
    `select command from cron.job` rather than trusting this line:** Postgres
    compares it case-sensitively, and the wrong spelling makes the trigger give
    up silently, which reads exactly like a bot that was never installed.
11. For Eugenia: a second BotFather bot, `/start` it, and set
    `EUGENIA_BOT_TOKEN`, `EUGENIA_WEBHOOK_SECRET` and `ANTHROPIC_API_KEY` in
    Edge Function secrets. Point Telegram at `/functions/v1/doji-eugenia` with
    that secret token and `allowed_updates=["message", "callback_query"]` —
    both, because her briefings carry a feedback keyboard and a webhook
    registered for messages alone never delivers the taps: the button spins and
    nothing anywhere reports it. The API key comes from
    platform.claude.com — the same Anthropic account, billed as prepaid credits
    rather than a subscription. **Set a spend cap on that key**: it is the only
    place a bound on what she can cost is actually enforceable.
12. Run `supabase/003_eugenia.sql`, then `supabase/004_cron.sql`, then
    `supabase/005_eugenia_senses.sql`, `supabase/006_plan.sql` and
    `supabase/007_semantic.sql`. The hourly job drives both the briefing and the
    pulse; the function decides which, or neither. 005, 006 and 007 are safe to
    re-run in full.
13. Run `supabase/008_sync_health.sql`, `supabase/009_dispatch.sql`,
    `supabase/010_pace.sql` and `supabase/011_trades_grants.sql` — the three
    monitors and the column grant. Each is safe to re-run. **010 needs the two
    Vault names 009 reads**, `eugenia_bot_token` and `telegram_chat_id`, since
    both watchers post to Telegram themselves rather than through the function
    they are watching; store them lower-case, the way step 5's cron secret is.
    Re-run `supabase/004_cron.sql` afterwards if the two watchers' jobs are not
    already scheduled — it upserts on the job name.
14. Run `supabase/012_excursion.sql`, `supabase/014_stops.sql` and
    `supabase/015_commitments.sql`, all safe to re-run.
15. Run `supabase/016_tradingview.sql` and `supabase/017_tradingview_lease.sql`,
    and connect TradingView — see **TradingView** — then
    `supabase/018_calendar_tradingview.sql`, `supabase/019_calendar_weeks.sql` and
    `supabase/020_calendar_ticker.sql`, and walk the history door once from a
    year back — see **Applying 019** and **Applying 020**.
16. Run `supabase/verify.sql` and read it against 001–020. Nothing is set up
    until that agrees.

---

## Tests

```sh
npm ci               # once — jsdom and typescript, and nothing else
npm test
```

Node 22.22.2 or newer — stated in `package.json`'s `engines`, enforced by
`engine-strict=true` in `.npmrc`, and repeated here. The enforcement is the half
that was missing: `engines` on its own is a note npm prints past, so the floor
held on every machine by luck rather than by a check, and the first sign of
running below it would have been jsdom failing somewhere that looks unrelated.
With the gate in place `npm ci` refuses outright — which also makes the CI run
the proof that the runner installed a Node above the floor, rather than a green
tick that says the workflow parsed.

It is jsdom that sets that floor, not the app: `--experimental-strip-types` has
worked since 22.6, and jsdom 30 declares `^22.22.2`. The number worth writing
down is the one at which everything in the repository actually runs;
`--experimental-strip-types` is what lets the suite import the Edge Function's
`.ts` directly, which is why the script exists rather than a bare `node --test`.
It is a no-op from Node 22.18, where type stripping is on by default, and stays
for the versions below that. `jsdom` and `typescript` are the only two
dependencies in the repository and both are dev dependencies — the application
itself still installs nothing and still has no build step. **`typescript` is
never a build step.** It reads the Edge Functions AND the app's inline script,
as two separate programs, and answers two questions no test in here can — a
name used that is declared nowhere, and a name declared that nothing uses.
`test/types.test.mjs` says why it asks only those two.

**The `no-cache` header names both paths.** `/` and `/index.html` are the same
document, and only the second is ever typed — the home-screen shortcut and every
bookmark open `/`. A rule matching the request path rather than the file left the
app shell cacheable at the one address it is actually opened at.

**`package-lock.json` is committed and CI runs `npm ci`.** `npm install` against
a floating `^30.0.1` means the tree that goes green in CI is not necessarily the
tree anyone else gets, and the same suite gates the Edge Function deploy — so
"the tests pass" would be a claim about one machine on one afternoon. `npm ci`
installs the lockfile exactly and fails outright if it disagrees with
`package.json`, which is the only version of that claim worth making.

The suites run on every push through `.github/workflows/test.yml`, so a red run
is attached to the commit that caused it rather than found later. A second
workflow deploys the Edge Functions — see **Deployment** below. The script
globs `test/*.test.mjs` — one level, deliberately, since `boot.mjs` is a harness
and not a suite. A test added in a subfolder would not match and would silently
not run.

**Every `uses:` in those three workflows names a commit, never a tag.** A tag is
mutable and the account that owns it can repoint it between one run and the
next, which is the whole of the supply-chain attack on a CI job: the code you
audited is not the code that runs. `supabase/setup-cli@v1` was not even a tag
but a *branch* — a ref expected to move in the ordinary course of someone
else's work — sitting in the job that holds `SUPABASE_ACCESS_TOKEN`. The
credentials are step-scoped, so none of these actions reads a secret directly;
what they are handed is the toolchain, and `setup-node` provides the `node` that
reads `SB_SECRET_KEY` a step later. A commit SHA is content-addressed and cannot
be moved.

The cost of pinning is a SHA nobody maintains, so `.github/dependabot.yml`
maintains it: a monthly pull request bumps both the SHA and the `# v7.0.1`
comment beside it, and CI runs on the branch before you read it. That comment is
the only reason the line is legible, and `agree.test.mjs` asserts the SHA half —
a tag reintroduced by hand fails the suite rather than sitting there looking
tidy.

| File | Covers |
|---|---|
| `test/fold.test.mjs` | a real `get_deals` response, folded and cross-checked against the real email for the trade they share; `_shared`'s `secretMatches`, `nyClock` and `parseSse`; the poller's `foldPosition`, `nyDay`, `ozFromVolume`, `usdFromCents`, the two windows, `balanceTarget` and `marketOpen`; `doji-email-sync`'s `emailRow` and `answerFor`; Gladys's `parseCallback`, `renderMessage`, `answered` and `staysOpen`, and the two halves of the redraw agreeing on every before-state; Eugenia's `briefDue`, `pulseDue`, `retryDue` — including Sunday's own three hours and that it answers `'sunday'` rather than `'weekday'` — `briefKind`, `dueNow`, `isSilent`, `briefingMarker`, `briefedQuery`, `notesList`, `channelsList`, `chunk`, `tradesQuery`, `repliedQuery`, `openOnUser`, `nowBlock`, `withClock` and `dateTurns`; the whole of `adherence.ts` — every one of the thirteen rules driven in both directions, the holiday calendar including Good Friday and the Saturday observance, `nyInstant` in both halves of the year, and the three-verdict rule that makes an empty population `unknown`; and Eugenia's `thesisLine`, `loopsList`, `calendarList`, `keepDraft`, `parseFeedback`, `stamped`, `apologyFor` and `sweepLine` — the last driven through all three of its states, including the drained archive that must accuse nobody |
| `test/app.test.mjs` | completeness, `Data.load`, `Data.save` and `Data.replace`, the price-based scratch rule and aggregate inheritance, win rate, the money split, `averages` bucketing on the label rather than the sign, the week and backup-key boundaries, `rangeStats`' half-open range, filing day, sessions, both `Data` indexes, every render step, the three-state discipline answer in every surface that reads it — the compliance bar, the log's ticks, the form's pre-selection, what a save writes back and what the export carries — the xlsx export's figures against the app's own derivations, the journal form, and the dashboard card — that it hides itself when there is nothing, that a landed release is never drawn as one still to come, that her prose is escaped before it reaches `innerHTML`, that a failed read is reported rather than mistaken for a quiet day, and that it never reads her notes |
| `test/golden.test.mjs` | the snapshot, and the only suite that asserts on what nothing else NAMES: the real page booted against a fixed fixture set on a frozen clock, with every derived value and every panel's markup compared byte for byte against `test/golden.json`. The others test named things; a refactor breaks unnamed ones — an attribute order, a class that stopped being emitted, a label whose whitespace collapsed. Its fixtures earn their place by mutation rather than by looking realistic, and the one to keep in mind is the pair entered and closed in opposite orders, because an ordering rule proved by rows that cannot disagree is the audit's own blind spot. It also SWEEPS `Dates.session` across six windows around both US and both EU changeovers rather than sampling it, since New York and London do not change on the same date and a spot check in July gets the right answer under almost any mistake in those tables. Regenerate with `GOLDEN=write npm test`, deliberately, in the same commit as the behaviour change and never to make a red run go away — a golden file regenerated on failure costs what it always cost and proves nothing |
| `supabase/verify.sql` | run by hand against the live database, and the only check on it — one query, one row per fact. Its errors are fatal to the rest of the file, so nothing in it may raise on a wrong database: ask about a function by oid or through `to_regprocedure`, never by a written-out signature. A stale one raised 42883 and hid the eleven checks below it for two releases — among them a trigger count 005 had made wrong, which is why rows here name what they expect rather than counting it |
| `test/agree.test.mjs` | the facts that live in more than one file: the setups vocabulary across `index.html`, `doji-gladys` and `trades_setup_check`; the four journal columns across `Data.OWNED`, Gladys's `COLUMNS`, the schema, and both lists inside `trades_telegram_on_answer`; Eugenia's 200-character note limit across `writeNote`, the constraint and the tool description; every function name and project ref a caller uses, across the SQL, the Apps Script, `config.toml`, `index.html` and the deploy workflow; Eugenia's two note kinds across her tool and the check constraint; her five channels across `prompt.ts`, the tool's enum, the check constraint and the seed as ids, and §2's headings as the names she says out loud; the four rungs of the ladder across `prompt.ts`, the constraint and §0's table of what to do at each one; every function's `verify_jwt` stanza against the directory that holds it; every secret a function reads against the guard that refuses to start without it; `notesBlock()` against the seven paths that must call it and `channelsBlock()` against the six — the briefing, the pulse, a reply, the release look, the move look, and the nightly pass, which is the worst one to lose it from: without her notes she cannot see what she already holds, so she never supersedes and writes the same fact again every night; `positionsBlock()` against those five and the move look besides; the conversation window against the six paths that speak to him; and `TradeRow` against the column list the view actually serves; and `secretMatches`' own body, because the one property that matters about it is invisible to every assertion about its answer; and the hour cycle across every formatter in the repository that asks for an hour; every `net.http_post` in the numbered SQL against 009's ledger and its job constraint, so a dispatch site cannot be added unwatched, and both trigger sites for the exception guard that keeps a ledger failure from failing the journal write it fires inside; the nightly sweep and the channel census against `recordRun`, both outcomes each, since a meter that records only its successes reports a vendor refusing every night as a table with nothing in it; and every `§N` the prompts cite, resolved through `readStrategy` — a dotted one having to name a heading actually present in what came back, since the parent fallback answers a citation that does not exist with one that does; and every `uses:` across the three workflows, which must name a commit rather than a tag anyone could repoint |
| `test/types.test.mjs` | the two questions a compiler settles and nothing else here can, asked of the Edge Functions and of the app's inline script as two separate programs: nothing uses a name declared nowhere, and nothing declares a name nothing uses. Deliberately not a whole typecheck — under Node's lib a `Uint8Array` is not a `BlobPart`, which is true here and false on Deno, and without `--strict` a discriminated union stops narrowing; both are facts about the invocation rather than the code. The two questions it does ask are pure scope facts and cannot go red for either reason. A file carrying one planted defect per question goes into every program on every run, so a clean answer is only reported once that reader has been seen to produce a dirty one. `Chart` and `XLSX` are declared for the app, being CDN globals nothing here owns, and each is held against the page still loading the script that provides it |
| `test/parse.test.mjs` | the Apps Script: `parseAlert_` against a real saved alert and variants built in its shape, and `syncPepperstone`'s three outcomes — which label a thread ends up with |
| `test/boot.mjs` | the harness: boots `index.html` in jsdom with the CDN libraries stubbed |
| `test/gs.mjs` | the harness: evaluates `doji_gmail_sync.gs` with the four Google globals stubbed to record |

**What is not covered, plainly.** The suite asserts on values and on emitted
markup, so it cannot see pixels — a renderer that emits correct HTML with broken
CSS passes. The Supabase client is a recording stand-in, so `load` and `save`
are exercised but realtime and the auth paths are not. `mcpInit`, `mcpCall` and
`upsert` reach the network on their first line and no test drives them. The xlsx
export runs against a recording SheetJS stand-in — `loadXLSX()` returns at once
when `window.XLSX` is already there, so every line the app owns is exercised and
the rows it hands over are asserted; what SheetJS then writes from them, and the
column widths and sheet name it is given, are not.

**The Apps Script is covered where it decides something, and the rest is
named.**
`parseAlert_` is a pure function of a subject and a body and `syncPepperstone`
is a loop over threads, so both are reachable once `GmailApp`,
`PropertiesService`, `Logger` and `UrlFetchApp` exist — `test/gs.mjs` evaluates
the file in a `vm` context with those four stubbed to record, which runs nothing,
because the file has no top-level calls. The anchor is a real alert body under
`test/fixtures/`, so what the parser claims is held against what cTrader
actually sent. What that still cannot reach is Gmail itself — the search, the
labels and the trigger are exercised through stubs, so what is tested is which
label a thread ends up with, not that GmailApp behaves as assumed.

**`agree.test.mjs` cannot see the live database either.** `trades_setup_check`
is asserted as `001_trades.sql` declares it, not as Postgres holds it, so a
constraint edited by hand in the SQL editor passes there. `supabase/verify.sql`
is where that is caught, and it is a query a person runs.

Gladys is covered only where she decides something.
`parseCallback`, `renderMessage` and `answered` are pure and are tested hard;
`sendMessage`, `editMessageText` and the PATCH reach the network on their first
line, so the double tap, the fresh-message fallback, the chat check, the secret
that picks which half runs, and the message id being recorded after each are
verified by reading. `postAnswer` is unreachable for the same reason, and
because its one decision is the one that has been wrong before, `agree.test.mjs`
reads its body for `answered(before)` instead — one file against itself, the
same shape as the `notesBlock()` check.

So are the triggers. Nothing in the suite runs Postgres, so their `WHEN` clauses
are argued against the real column types rather than executed; what the suite
does hold is that both column lists inside the redraw trigger are the four
`Data.OWNED` names, since those are text in a file no compiler reads.

Three gaps are worth naming rather than leaving to be rediscovered. Soft delete
has no test of its own — `Data.mark` and the `deleted` path are touched only
incidentally, by the load test asserting that a flagged row is kept and not
rendered. `London+NY` is the one session bucket never asserted. And `IO.backup`
is plain JSON and testable, and is not tested.

**Both broker paths are anchored to something the broker actually sent, and the
two anchors overlap.** `fixtures/ctrader-get-deals.txt` is a real `get_deals`
body captured through `?raw=1` — SSE framing, JSON-RPC envelope, double-encoded
payload and all — and `fixtures/ctrader-stop-loss-filled.html` is a real
Pepperstone alert. **Position 577885869 is in both.** The poller saw its deals;
the email announced the same fill. Two independent records of one trade, from
two systems, neither written by anyone here.

So the fold can be checked against something other than its own arithmetic: the
direction it reads off the earliest deal against the direction the email states,
the exit price against the fill price, and `computed_pnl` against the email's
`Net P&L` — which agree to the cent here only because swap was zero on this
trade. It also checks the fill time the email writes in words against the millisecond
timestamp the deals give for the same event — which confirms the *instant*, not
the day-first rule: 19 cannot be a month, so this trade parses the same either
way. That rule is pinned by an ambiguous date, in `test/parse.test.mjs` and only
there.

That is as close to end-to-end as a repository with no live broker gets. What it
still cannot see is cTrader changing something *after* the capture; a fresh
`?raw=1` is how the fixture gets replaced when they do.

**A check you have not proved can fail is not a check.** Every test here was run
against a deliberately broken copy of the thing it covers before it was
believed, and the rule is the point rather than the inventory — a list of the
individual breaks would be a changelog, and would be stale the day it was
written. Three that are worth keeping because they name a shape rather than a
line:

- **`staysOpen` forced true** — the bug that actually shipped, and the reason
  CLAUDE.md opens on it. A whole suite stayed green because it handed the
  renderer the flag it should have derived.
- **A transient send failure recorded as permanent**, which is the shape that
  discards a fill's P&L forever — and it appears twice, once in the Apps Script
  and once in the Edge Function that answers it.
- **A timezone reverted to UTC**, which takes nine tests with it, in a system
  where every market boundary is New York wall time.

The other direction is worth naming too, because it is subtler: several checks
turned out to be unable to fail *before* the thing they cover was broken. A
clock test whose call site could be deleted with the suite still green; a
credential check that asked a stub rather than reading the file; a boot-guard
check that passed a guard gutted to `if (false)`; a keyboard test that typed the
payloads it should have taken off the buttons. Each was found the same way —
break it on purpose, watch it stay green — and each was rewritten until it
could fail.

Do the same to any check added later — a green run from a scanner that cannot
fail has more than once been mistaken here for clean code.

---

## Known rough edges

**The email parser is checked against a real message, and the variants are
not.** `test/fixtures/ctrader-stop-loss-filled.html` is an actual Pepperstone
alert, decoded exactly as GmailApp hands it over, for a fill that is in the
database — so every field the parser claims is checked against what the broker
sent rather than against a guess at it. Replacing the invented fixture caught
two things immediately: money arrives as `USD -108.40`, with a currency prefix,
and the fill time as `19/08/2026 20:22:55 (UTC)`, with the zone in brackets.
Both parsed correctly; nothing had been proving it. A saved message settles the
shape of a field and not always its meaning, which is why the day-first reading
above needs a test the fixture cannot supply.

The variants — a buy, a thousands separator, a missing figure, an unreadable
time — are still built, because no saved message contains them. They are built
in the real message's shape, and one test holds the builder against the real
body so a variant cannot quietly stop resembling what cTrader sends. This is
still one of the two pieces that can lose data quietly — the poller is the
other — and the weekly backup is the floor underneath both.

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

**A release reaches her within a quarter of an hour, not instantly.** The event
spine is a cron job, so a print at 08:30 is looked at somewhere between 08:35 and
08:50. That is the trade: a `*/15` job on the existing hourly one would have run
four briefings a morning, and a per-minute job is ninety-six times the
invocations for a granularity nothing here needs. If a number's first five
minutes ever matter, the fix is a shorter interval on that job alone — the
predicate is already data-driven and would not change.

**The calendar is only as good as the search that filled it.** She writes
`eugenia_calendar` from what she read on the web, so a release she never found is
one the spine will never wake her for, silently. `source` records where it came
from; nothing downstream treats these as broker data. The accumulating half —
what printed against what was expected, with her line beside it — is worth
nothing this month and a great deal in a year, which is the whole argument for
starting it before it is useful.

**Three capabilities need a vendor Anthropic does not serve.** The Messages API
takes text and images and not audio and Telegram does not transcribe for bots, so
hearing goes through `STT_URL`/`STT_KEY` and speaking through `TTS_URL`/`TTS_KEY`;
Anthropic serves no embeddings, so semantic search goes through `EMBED_KEY`. All
three are written against a shape rather than a named provider, and each unset is
a supported state rather than a broken one.

**Together they are the only thing in this system that sends his own words
outside his own infrastructure** — the audio of what he said, the text of what she
answers, and every note and turn as it is written. Worth knowing before setting
the secrets, and the reason leaving any of them unset changes nothing but that
one capability.

None of them could be exercised from the machine they were written on, so each
shipped with its failures handled and its central claim unproven: a transcription
that produces no words names which of four things went wrong, a batch of
embeddings that comes back mis-shaped is refused whole, speech that fails costs
the audio and not the answer — but whether any of it *worked* was a reading.

**All three have since run against the live account**, and two of the three
answers were worth having. The backfill embedded the whole archive on its second
attempt; its first replied `filled: 0` and, once the door was made to say why,
named `insufficient_quota` with the billing URL — a fault in the account rather
than the code, which is a distinction the first version could not draw. And a
voice note came back as a voice note: the transcript reached her, the text landed
first, and the audio arrived as a playable bubble rather than a file attachment,
which is the `opus` question settled by the only thing that could settle it.

**`web_fetch` grounds a number she was not handed.** The tool only fetches URLs
already in the conversation, so what it reaches is a page a search turned up — a
figure deeper in a report than the calendar carries, what an official actually
said. Never gold's price or the market lines: those are handed to her, and a
second copy off a page is a second number that disagrees with his screen, so no
price page is named in the prompt any more. It is bounded at both ends — `max_uses` for how many pages and
`max_content_tokens` for how large one may be. Only the first was written for a
while, and one long thread can put more into a turn than the rest of the briefing
put together, re-sent on every round after it. A page that refuses bots
degrades to search, with no signal that the figure came from prose rather than
from the page it is on.

**The session seam.** Fills the poller never reached have no `entry_time`, so
their session derives from close time rather than entry time. Flag it whenever
session data is read for a pattern spanning that boundary. `get_stats` is the
one read that does exactly that, so it counts the seam rows and says so above
the split, on the same terms as the settled-versus-folded count above it — only
where there is one, and with the reason travelling beside the number. A
`?force=1` run with a wide lookback repairs them for good — nothing is stored,
so backfilling the entry time is the whole fix.

**R:R is realised, not planned.** Average win over average loss from closed P&L,
drawn once per window — month, week and all time — above that window's wheel, so
a period reads against the periods either side of it rather than against the
account. The planned floor is **not recoverable from the data** — the broker
reports only the *final* stop, so a stop moved to break-even has overwritten the
original risk. Never infer what the planned R:R was; ask.

**The four calling pg_cron jobs hold no database power**, and that is a claim
about the database rather than about the secret. None can read or write a table:
each presents the cron secret, read from Vault at call time, and the
service-role key lives in the functions' own secrets and never appears in a job.
The housekeeping job is the exception and is why the distinction is worth making
— it is a DELETE, and it reaches nothing outside pg_cron's own history. The two
`trades` triggers are `security definer` and reach nothing either: both build one
`net.http_post` and return.
This replaced an arrangement where the job text carried a legacy service_role
JWT — full RLS-bypassing access, in a job definition, and unrotatable, because
legacy keys are tied to the project's JWT secret.

**What `DOJI_CRON_SECRET` can actually cause is not the same at all three doors,
and it used to be described as though it were.** Say it per endpoint:

| Function | What a holder of the secret can do |
|---|---|
| `doji-mcp-sync` | start a read-only poll that was going to run anyway, or read back the deals (`?raw=1`), the broker's tool list (`?tools=1`), the open positions (`?positions=1`), a price (`?market=1`) or minute bars (`?bars=raw`). Nothing that places, moves or closes a trade is reachable — see `ALLOWED_TOOLS` |
| `doji-eugenia` | `?force=1` — run a briefing, about $0.20, with no bound in the code. `?consolidate=1` is the one that does more than spend: it runs the nightly pass, which WRITES memory — notes written and superseded, channel rungs moved, loops closed. `?pulse=1` costs a medium-effort call that usually answers `NOTHING` and sends nothing. `?embed=1` spends at the embedding vendor. `?release=1`, `?move=1` and a `{trade}` body reach the three cheaper event paths |
| `doji-gladys` | post arbitrary text into the trader's own Telegram thread |

Neither of the last two can reach a column: Gladys's trigger half never names
one, and Eugenia has no write path to `trades` at all. But "the worst case is
nothing" was the sentence that stopped anyone checking the worst case, and it
was wrong for two of the three. There is no exposure path today — the value sits
in Vault and in function secrets and crosses no untrusted channel — so the fix
is the description, plus the one bound that is actually enforceable: a spend cap
on the Anthropic key.

`DOJI_EMAIL_SECRET` is deliberately not this secret. It is the only one that
lives outside the trader's own infrastructure, in Google's, so it opens the
narrowest door there is — five columns of one table — and it is stored in two
places rather than three, with no Vault spelling to get wrong.

One value, two stores, two spellings, and it is worth knowing before you touch
either: the Edge Functions read the cron secret from their own secrets as
**`DOJI_CRON_SECRET`**, while the database reads it from Vault as
**`doji_cron_secret`**. The four calling jobs read the lower-case Vault name,
and so do the two trigger functions that present it — `trades_telegram` and
`trades_eugenia_on_event`. `verify.sql` asks the database for all six: one row
counting the jobs, and one per function body, because a function is not a job
and cannot be counted with them. Gladys's trigger shipped reading the
upper-case one, found nothing, and went quiet without failing anything.
