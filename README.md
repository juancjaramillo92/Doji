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
vercel.json                             no-cache header for the app shell
supabase/config.toml                    Edge Function deploy settings
supabase/001_trades.sql                 the schema
supabase/002_gladys.sql                 Gladys's trade-open trigger
supabase/003_eugenia.sql                Eugenia's tables, her view of the journal
supabase/004_cron.sql                   every scheduled job
supabase/005_eugenia_senses.sql         Eugenia's meters, her calendar, her senses
supabase/006_plan.sql                   where a trade was aimed, off the open position
supabase/007_semantic.sql               her memory searchable by meaning
supabase/verify.sql                     read-only: does the database match these?
supabase/functions/_shared/edge.ts      the primitives every function needs
supabase/functions/doji-mcp-sync/       Edge Function: cTrader poller
supabase/functions/doji-email-sync/     Edge Function: the email fill's write
supabase/functions/doji-gladys/         Edge Function: Gladys, the journal bot
supabase/functions/doji-eugenia/        Edge Function: Eugenia, the market bot
  doji-eugenia/adherence.ts             the eight rules a journal row can answer
doji_gmail_sync.gs                      Apps Script: broker email parser
test/                                   node:test suites — see Tests
.github/workflows/test.yml              runs the suite on every push
.github/workflows/deploy-functions.yml  deploys the Edge Functions on push to main
package.json                            one dev dependency and the test script
package-lock.json                       committed — see Tests
```

---

## The system

```
        ┌────────────────┐          ┌──────────────────┐
        │  cTrader MCP   │          │  cTrader email   │
        │   get_deals    │          │  TP / SL alerts  │
        │  get_balance   │          │                  │
        └───────┬────────┘          └────────┬─────────┘
                │ every 2 min                │ on arrival
                │ (Edge Function)            │ (Apps Script)
                │                            │
                │   broker-owned columns     │  net_pnl · balance
                │   balance on a fresh close │  fill_time · direction
                ▼                            ▼
        ┌──────────────────────────────────────────────┐
        │                   trades                     │
        │            one row per position              │
        └────┬───────────────────────┬─────────────────┘
             │ after insert          │ read · realtime · update
             │ (entry_time < 1h)     ▼
             │                       ┌──────────────┐
             │                       │     Doji     │
             ▼                       └──────────────┘
      ┌──────────────┐
      │   Telegram   │   a tap writes setup and the three
      │ one message  │   discipline answers back to trades
      │  per trade   │
      └──────────────┘
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
| `open_day` | the New York civil day the trade is filed under |
| `commission` | dollars, positive magnitude, **never subtracted** |
| `balance` | account balance after the fill — from the email, or from the poller on a close under ten minutes old |
| `net_pnl` | broker's figure — includes swap |
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

The pre-sync rows carry no prices, so the rule cannot be evaluated for them and
the same $3 is read against their P&L instead — the only measure they have ever
had. An open position has an entry price and no exit, which is the same case.

**An aggregate result** — the colour of a calendar day, a week cell or a month
tile — **inherits rather than re-bands.** Several trades share no single entry
and exit, so there is no price distance to measure across them: a cell is a
scratch only when *every* decided trade inside it was one, and otherwise takes
the sign of its total. There is deliberately no separate dead band for cells; a
day that nets a few dollars off two real losses is two real losses.

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
| Eugenia's **note length** | `writeNote`, the check constraint, the tool description |
| the **five channels**, in two vocabularies | ids: `CHANNELS` in `prompt.ts`, the check constraint and the seed in `003_eugenia.sql`; spoken names: `CHANNELS` again, and §2's headings in the strategy — the tool's enum reads `CHANNELS` rather than holding its own |
| the **four rungs of the ladder** | `CHANNEL_STATES` in `prompt.ts`, the check constraint, and §0's table of what to do at each one |
| Eugenia's **search source vocabulary** | the `source` literals `eugenia_search` returns (`note`, `you`, `him`) and the three branches `searchList` renders them with — a value on one side and not the other is a hit silently attributed to the wrong person |
| the **`eugenia_trades` column list** | the numbered SQL files — `003_eugenia.sql` creates it and `006_plan.sql` appends the plan, so the last definition is the one the database ends up with — the README's two quoted copies of that statement — the one an existing database runs on its own and the one inside the drop-and-rebuild migration — and §8's inventory of a row in the strategy, the section she is told to read before producing any number, which named four columns the view does not serve for five versions of the document |
| the **kinds an open thread may have** | `LOOP_KINDS` in `index.ts` and the check constraint in `005` |
| each **sense's query flag** | the cron job's URL in `004` and the branch in `postScheduled` — the one rename in this system that fails in complete silence, since pg_net discards the 200 the unread flag still answers |
| the **embedding width** | `EMBED_DIMS` in `index.ts`, the two `vector(n)` columns in `007`, and the cast inside the search — a disagreement is a 400 on every write, reported to a console nobody reads |
| the **columns of `eugenia_price`** | the table, and what `markPrice` PATCHes — and `looked_at` written unconditionally is the quiet window that never reopens |
| the **importance a release may carry** | the `log_calendar` enum, the check constraint, and the `importance=eq.high` the event spine selects on — a rename on any side is a spine that files everything and wakes for nothing |
| the **verdicts a briefing tap may carry** | the keyboard's `callback_data`, `parseFeedback`, and the check constraint |
| the **thesis length** | `THESIS_MAX` and the check constraint |
| the **columns of `eugenia_runs`** | the table, and the object literals `recordRun` is called with — a key with no column is a row PostgREST refuses whole, so the meter goes quiet |
| **which rules a row can answer** | §7's `Evaluable` column in the strategy, and the eight predicates `adherence.ts` implements — a rule marked `journal` and never implemented is a check she cites that nobody runs; one marked `judgment` and implemented anyway starts reporting `pass` for something §8 says nothing stored can see |
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
else in the system can tell them apart. The flag writes nothing, makes the same
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

**And `get_trendbars` documents a call shape it refuses.** Its own description
offers *"(count) → last N bars ending now"*; sending exactly that answers
`fromTimestamp: must not be null`. The range form is what it accepts, so that is
what is sent. Worth knowing before trusting any other combination it lists.

```sh
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?positions=1" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
curl -s "https://<project>.supabase.co/functions/v1/doji-mcp-sync?market=1" \
     -H "x-doji-key: $DOJI_CRON_SECRET"
```

**All four read-only flags answer when the market is shut**, and a test holds that:
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
market does. She greets with `Buenos dias jefesito` in the morning and `Buenas
tardes jefesito` on Sunday evening.

Reply to her and she answers — by typing, by voice, or by sending a chart.
`supabase/003_eugenia.sql` holds her memory and her read of the journal,
`005_eugenia_senses.sql` her meters, her calendar and the trigger that tells her
about a trade, `004_cron.sql` her clock; `prompt.ts` holds who she is,
`strategy.ts` what he decided, `adherence.ts` the eight rules a row can answer;
`index.ts` is the wiring.

**Three objects in the database, and only two of them store anything.**
`eugenia_turns` is the conversation window, `eugenia_notes` is what she
remembers, and `eugenia_trades` is a view — a saved `select`, no rows of its
own. The two tables stay two because nothing ever reads them together: notes go
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
The two are indistinguishable from outside, which is why nothing caught it.

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

### The briefing is prose, not a report

Four or five short paragraphs of someone talking: where gold is, the one thing
that matters today and the chain of why, everything else in a sentence, one
genuinely odd fact, and a single question or nothing.

It used to be seven numbered sections with impact emoji, and plain-Englishing
the words inside them did not help — **seven numbered sections with headings
*are* a report**, whatever the vocabulary. The scaffolding was doing the
talking. Nine hundred to fourteen hundred characters, and running long is cut by
dropping words, never events.

The vocabulary rule is now "plain words first": *the gap between rates and
inflation* before *real yields*, and the short name only once the long one has
been said. The ideas stay exactly as sophisticated; only the words come down.

**She teaches, and that is a rule about depth rather than length.** He is
learning macro deliberately, so the paragraph on the day's one thing states its
chain link by link — *hot inflation, so the Fed waits, so the gap between rates
and inflation widens, so gold has stiffer competition* — because a cause named
with no chain under it is something to memorise rather than understand. The
character budget does not move to make room; the same words carry the why.

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
no tool round. Mentioned only when there is something real to say, in a clause,
never as a verdict — most mornings the right amount to say about your trading is
nothing.

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

**She files the calendar she reads.** `log_calendar` records what is scheduled —
the time in UTC, the name, the consensus, the prior — and the briefing calls it
every morning before writing a word. A **quarter-hourly job** then asks one
question: has anything marked `high` landed and not yet been looked at? If so she
searches for what it printed, files the actual, and decides whether it is worth
saying. `looked_at` is what makes that once-only; it is stamped **before** the
look for the reason the briefing marker is, since a look that generates and fails
to write would otherwise repeat every fifteen minutes, each one a billed call.

It is a second schedule rather than a faster one, because the four hourly
predicates all test `hour ===` and a `*/15` job would have run four briefings
every morning. `?release=1` is its door and the way to exercise a look by hand.

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
| `MOVE_SHARE` | 0.35 of the session range so far | binds on an established session, where an ordinary swing clears any fixed floor |
| `MOVE_FLOOR` | 0.001 of the price | binds an hour after the Sunday open, where the range is a couple of dollars and a third of it is noise |
| `MARK_STALE_MIN` | 40 minutes | two missed runs and the gap is no longer a quarter of an hour — $15 in fifteen minutes is an event, $15 across an hour is a session |
| `MOVE_QUIET_H` | 2 hours | one message about one move; a market that trends all afternoon is one story, and this is the only thing between it and eight messages before lunch |

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

It runs only while the market is open, by the same `marketOpen` the poller keeps
— one definition in `_shared/edge.ts`, since both now ask it. Most firings cost
one quote and one indexed read: **no model call at all unless a move clears every
gate.**

### Checking his rules

§7 of the strategy writes a concrete predicate for all nineteen rules and §8
writes the population filters and the three verdicts. **Nothing executed any of
it.** She was handed up to four hundred rows of JSON and expected to apply seven
filters and three-state logic in her head on the way to producing a number —
which is the one thing a model is worst at, and where a wrong answer is least
visible, because a rate computed over the wrong population looks exactly like one
computed over the right one. That is §8's own opening sentence.

`adherence.ts` evaluates the eight rules a row can answer — **R-01, R-02, R-10,
R-11, R-12, R-13, R-15 and R-16** — and `check_rules` serves it. The set is not a
choice: §7's `Evaluable` column decides it, and `agree` holds the two lists
against each other, because a rule marked `journal` and never implemented is a
check she cites that nobody runs, and one marked `judgment` and implemented
anyway starts reporting `pass` for something nothing stored can see.

**`unknown` is not a pass**, and the code says so rather than the prompt: the
verdict is the worst outcome present, and an empty population is `unknown`. A
Friday close-out under $25, a second entry inside the fifteen-minute sweep
window, a day with no size to derive an account from — each is undecidable by
construction, and each is reported as undecidable with its count beside it.

It is pure, so every rule is driven from a test in **both** directions. A
predicate only ever seen to return `pass` has been shown to be reachable, not to
work, and three "clean" results in this repository's history turned out to mean
exactly that.

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
the rules it was written to — is the first sentence only true today, was a term
redefined after it was already explained, is the chain missing a link, is there a
forward call in it, is it inside the budget, does it obey his standing
instructions. It returns the briefing, not notes about it.

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

**A chart** she can now see, and the prohibitions do not move an inch because she
can. She may describe what is on it and take it as context; she may not say
whether a setup is valid or a level will hold, and the prompt says so in those
words, because a picture is the most tempting place in this system to give a
verdict on a trade.

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

Two kinds of memory, and they answer different questions.

| | Holds | Window | Written by |
|---|---|---|---|
| `eugenia_turns` | the conversation | last 12 turns | every exchange |
| `eugenia_notes` | facts about him, and what he has told her to do | last 20 notes | her `remember` tool |
| `eugenia_channels` | where he stands on each of the five channels | all 5 rows, always | her `set_channel` tool, nightly |
| `eugenia_thesis` | the running story the market is trading | 1 row, rewritten | her `set_thesis` tool, nightly |
| `eugenia_loops` | what she flagged and what she asked, until it closes | all open, newest 10 | `open_loop` anywhere, `close_loop` nightly |
| `eugenia_calendar` | what lands today, and what it printed | a rolling ±day | her `log_calendar` tool |

Turns roll over in a morning, so without notes she could never know in September
that he has been working on holding his stop since August. Notes are one
sentence each about *him* rather than about the market — a note about today's
price is stale tomorrow and the prompt forbids it. They are handed back at the
start of every turn, briefing and reply alike.

**And they are how he corrects her, which is the only way he can.** There is no
settings page and no feedback button, and the conversation window rolls over in
a morning — so *"stop mentioning the ten-year"*, *"too long"*, *"lead with what
is odd"* would all be forgotten by tomorrow if they stayed in the conversation.
Recorded as notes they are standing instructions: written the moment he gives
one, in his words, obeyed from the next message on, and overriding the shape the
prompt otherwise asks for. She acknowledges an instruction in four words or
fewer — a fact about him she records silently — because otherwise he cannot tell
it stuck and will say it again.

`notesBlock()` is therefore load-bearing on all four paths, and its absence
would be silent: drop it from one and she carries on ignoring an instruction he
believes she took. A test asserts the briefing, the pulse and a reply each read
them.

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

**Only the nightly pass may move a rung.** `set_channel` is in
`CONSOLIDATE_TOOLS` and deliberately not in `CHAT_TOOLS` beside `remember`: a
note is a moment and is fairly written in one, but a rung is a judgment across
days, and moving one on a single exchange is the same error as reading a pattern
into one fill. Most nights nothing moves, and the prompt says that is the
honest outcome rather than a wasted run.

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
ends it under R-11, and now that the stop is a ceiling the two can disagree in
both directions — a $12 stop taken in full ends the day having spent 2.4%, and
three hand-cut exits can spend the whole 4% without R-03 seeing anything.

**The table is nineteen rules now, and the eight after R-11 came out of audits
rather than out of new behaviour.** R-12 caps him at one entry a day, two only
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

**A failed briefing tries again**, at 09:00, 10:00 and 11:00 ET, and stops the
moment one has landed. `briefedToday()` reads the marker `postBriefing` stores
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

**And the apology names the job that actually died.** Every scheduled failure said
*"No briefing, jefe"* — including a pulse, the nightly pass, a release look and a
trade event. So a consolidation that died at 22:00 reported itself to him as a
missing briefing, sending him to look for the wrong thing at the wrong time of
day; and the failure whose real symptom is that her memory stops growing was
described as the one whose symptom is a message that never arrived. `APOLOGY` is
a word per job, and a test asserts no two of them are the same sentence.

### What a turn cost

`ask()` logs one line per turn — the caller, the rounds it took, the effort, the
tokens in and out, how many were served from cache, and how many web searches
were billed. `postBriefing` adds the briefing's length in characters, and
`?force=1` returns it as `chars` so a manual run shows it without opening the
logs.

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

**`STT_URL` and `STT_KEY` are optional** and only enable voice notes. Unset, she
says she cannot hear them and everything else is unaffected — which is why they
are deliberately not in the boot guard, and why an exemption from it has to be
guarded where the secret is *used*: `EMBED_KEY` is the second, and a test holds
both to that.

```sh
supabase secrets set STT_URL=https://<provider>/v1/audio/transcriptions
supabase secrets set STT_KEY=<key>
supabase secrets set STT_MODEL=whisper-1     # optional, defaults to whisper-1
```

`verify.sql` answers whether the six tables, the two triggers, the three
policies and the `pg_trgm` extension are actually there, which is the half no
test in the repository can reach. It also counts the cron jobs — a row that had
been wrong since the spine was added, reporting a mismatch on a correct database,
which is the worst thing a check can do.

### Applying 006, which is two columns and one view

`006_plan.sql` adds `planned_sl` and `planned_tp` to `trades` and appends them to
`eugenia_trades`. It is **safe to re-run**: both alters are `if not exists` and
the view statement appends rather than reorders. Nothing outside the SQL moves
with it — the poller writes the columns the moment it is deployed, and the app
never names them.

**Deploying the poller before running this file is the failure to watch for, and
it is loud in exactly one place.** The plan write is a PATCH filtered on
`planned_sl=is.null`, so against a table without the column PostgREST answers
`400` and nothing is stored. It does not take the poll down — the deals are why
that function exists and they are written by the time this runs — so the fills
keep landing and `planned` comes back `0` in the response on every run. That
figure is the check: a run with an open position and `planned: 0` means this file
has not been applied.

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

`verify.sql` ends with the count that matters — how many rows in each table are
still without an embedding. It should fall to zero and stay there. A number that
climbs day after day means the key is unset or the vendor is refusing, and
nothing else anywhere will say so.

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

**What she costs.** Roughly $0.20 a briefing and rather less for a pulse that
finds nothing — call it $10 a month for six briefings and five pulses a week —
of which a large share is web search at $10 per 1,000 searches rather than
tokens. Questions are a few cents each. The model is the strongest one; at this
volume the searches dominate, so a weaker model would save little.

**What the prompt cache actually buys, said plainly.** Her system prefix is about
5,300 tokens and it is cached — but the default window is five minutes and her
callers are hours apart, so for most of this system's life the cache paid only
for the rounds *within* one turn: a briefing that reads the journal and writes a
note is three requests carrying that prefix. The window is now stated as an hour,
which also catches the replies a briefing draws through the morning and the 09:00
retry after an 08:00 failure. It does not catch 08:00 → 10:00, and nothing
sensible would. `cache_read_input_tokens` is in `ask()`'s log line, and is the
number that says whether any of this is true rather than argued.

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

### What she will not do

In the prompt rather than left to taste: no forward price-action opinions, no
signals or entries, no verdict on a trade, and never more than one question at
a time.

**The line is between describing the world and predicting it**, and she is
allowed the first half of that deliberately. *"A December cut is about 70%
priced"* is a fact about today. *"A 0.4% core print is not in the price"* is a
statement about expectations. Both are hers to say, and saying them is most of
what stops the briefing reading like a wire feed. *"That would send gold lower"*
is not, and never becomes so.

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

All four functions go on each run rather than only the changed one, so none of
them can drift apart from the others. `adherence.ts` ships inside
`doji-eugenia` the way `prompt.ts` and `strategy.ts` do — it is a module of that
function, not a fifth one. `verify_jwt` lives in
`supabase/config.toml` rather than in a dashboard toggle, which is what makes
the committed file the whole description of how a function is deployed.

**`supabase/functions/_shared/edge.ts` holds one definition of each primitive**
— `env`, `secretMatches`, `json`, `sbHeaders`, `telegram`, `nyDate` and `nyClock` —
bundled into every function that imports it. The test is not "could this be
shared" but **"are there two copies nothing can compare"**, and `secretMatches`
is why: the function exists to be *constant-time*, so a copy quietly rewritten
to `presented === expected` returns the same answer to every assertion anyone
would write while leaking the secret through timing. A behavioural test cannot
see that; one definition has nothing to drift.

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

What is deliberately **not** shared is the entry point. All four authorise their
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
the job instead of shipping four broken functions at once.

**This is worth the machinery for one reason.** The poller and Gladys were
pasted into the dashboard by hand, and nothing tied the running code to the
committed code — so the repository could describe a system while the system ran
something else, and every later change would be reasoned about from a file that
was not the truth. That failure is silent, which is what makes it expensive.

**Two things are still deliberately manual.** The SQL is run knowingly in the
SQL editor, never by a robot: `001_trades.sql` through `007_semantic.sql` are not
under `supabase/migrations/`, so nothing applies them automatically, and a
schema change that lands because a file was committed is exactly the accident
the Operating section argues against for restores. The Apps Script is deployed
from the Apps Script editor; it holds no secrets in the file and nothing reads
it from here.

**Applying by hand means the files are a claim, so `supabase/verify.sql` is how
the claim gets tested.** It writes nothing: it reads back the columns, the
constraints, the indexes, the policies, the grants on Eugenia's view, the
triggers, the realtime publication, all three cron jobs and the last ten function
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
         net_pnl, planned_sl, planned_tp
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
         net_pnl, planned_sl, planned_tp
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
    that secret token and `allowed_updates=["message"]`. The API key comes from
    platform.claude.com — the same Anthropic account, billed as prepaid credits
    rather than a subscription. **Set a spend cap on that key**: it is the only
    place a bound on what she can cost is actually enforceable.
12. Run `supabase/003_eugenia.sql`, then `supabase/004_cron.sql`, then
    `supabase/005_eugenia_senses.sql`, `supabase/006_plan.sql` and
    `supabase/007_semantic.sql`. The hourly job drives both the briefing and the
    pulse; the function decides which, or neither. 005, 006 and 007 are the
    three that are safe to re-run in full.
13. Run `supabase/verify.sql` and read it against 001–007. Nothing is set up
    until that agrees.

---

## Tests

```sh
npm ci               # once — jsdom, and nothing else
npm test
```

Node 22.22.2 or newer — stated in `package.json`'s `engines` as well as here.
It is jsdom that sets that floor, not the app: `--experimental-strip-types` has
worked since 22.6, and jsdom 30 declares `^22.22.2`. The number worth writing
down is the one at which everything in the repository actually runs;
`--experimental-strip-types` is what lets the suite import the Edge Function's
`.ts` directly, which is why the script exists rather than a bare `node --test`.
It is a no-op from Node 22.18, where type stripping is on by default, and stays
for the versions below that. `jsdom` is the only dependency in the repository
and it is a dev dependency — the application itself still installs nothing and
still has no build step.

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

| File | Covers |
|---|---|
| `test/fold.test.mjs` | a real `get_deals` response, folded and cross-checked against the real email for the trade they share; `_shared`'s `secretMatches` and `nyClock`; the poller's `foldPosition`, `nyDay`, `ozFromVolume`, `usdFromCents`, the two windows, `balanceTarget`, `parseSse` and `marketOpen`; `doji-email-sync`'s `emailRow` and `answerFor`; Gladys's `parseCallback`, `renderMessage`, `answered` and `staysOpen`, and the two halves of the redraw agreeing on every before-state; Eugenia's `briefDue`, `pulseDue`, `retryDue`, `dueNow`, `isSilent`, `briefingMarker`, `briefedQuery`, `notesList`, `channelsList`, `greeting`, `chunk`, `tradesQuery`, `openOnUser`, `nowBlock`, `withClock` and `dateTurns`; the whole of `adherence.ts` — every one of the eight rules driven in both directions, the holiday calendar including Good Friday and the Saturday observance, `nyInstant` in both halves of the year, and the three-verdict rule that makes an empty population `unknown`; and Eugenia's `thesisLine`, `loopsList`, `calendarList`, `keepDraft`, `parseFeedback`, `stamped` and `apologyFor` |
| `test/app.test.mjs` | completeness, `Data.load`, `Data.save` and `Data.replace`, the price-based scratch rule and aggregate inheritance, win rate, the money split, `averages` bucketing on the label rather than the sign, the week and backup-key boundaries, `rangeStats`' half-open range, filing day, sessions, both `Data` indexes, every render step, the journal form, and the dashboard card — that it hides itself when there is nothing, that a landed release is never drawn as one still to come, that her prose is escaped before it reaches `innerHTML`, that a failed read is reported rather than mistaken for a quiet day, and that it never reads her notes |
| `test/agree.test.mjs` | the facts that live in more than one file: the setups vocabulary across `index.html`, `doji-gladys` and `trades_setup_check`; the four journal columns across `Data.OWNED`, Gladys's `COLUMNS`, the schema, and both lists inside `trades_telegram_on_answer`; Eugenia's 200-character note limit across `writeNote`, the constraint and the tool description; every function name and project ref a caller uses, across the SQL, the Apps Script, `config.toml`, `index.html` and the deploy workflow; Eugenia's two note kinds across her tool and the check constraint; her five channels across `prompt.ts`, the tool's enum, the check constraint and the seed as ids, and §2's headings as the names she says out loud; the four rungs of the ladder across `prompt.ts`, the constraint and §0's table of what to do at each one; every function's `verify_jwt` stanza against the directory that holds it; every secret a function reads against the guard that refuses to start without it; and `notesBlock()` and `channelsBlock()` against the four paths that must call each — the briefing, the pulse, a reply, and the nightly pass, which is the worst one to lose it from: without her notes she cannot see what she already holds, so she never supersedes and writes the same fact again every night |
| `test/parse.test.mjs` | the Apps Script: `parseAlert_` against a real saved alert and variants built in its shape, and `syncPepperstone`'s three outcomes — which label a thread ends up with |
| `test/boot.mjs` | the harness: boots `index.html` in jsdom with the CDN libraries stubbed |
| `test/gs.mjs` | the harness: evaluates `doji_gmail_sync.gs` with the four Google globals stubbed to record |

**What is not covered, plainly.** The suite asserts on values and on emitted
markup, so it cannot see pixels — a renderer that emits correct HTML with broken
CSS passes. The Supabase client is a recording stand-in, so `load` and `save`
are exercised but realtime and the auth paths are not. `mcpInit`, `mcpCall` and
`upsert` reach the network on their first line and are not exported. The xlsx
export needs SheetJS from a CDN and is not exercised.

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

**Voice notes are the one thing here that needs a second vendor.** The Messages
API takes text and images and not audio, and Telegram does not transcribe for
bots, so `STT_URL` and `STT_KEY` point at an external service. Unset, she says
she cannot hear them and nothing else changes. It is written against the
`/audio/transcriptions` shape rather than a named provider, and **it is the only
thing in this system that sends his own words outside his own infrastructure** —
worth knowing before setting the two secrets, and the reason leaving them unset
is a supported state rather than a broken one. It is also the one path here that
could not be exercised end to end from the machine it was written on — the call is guarded, its failure is reported to her as a
sentence, and that is as far as reading can take it.

**`web_fetch` grounds a number on a page that has to stay fetchable.** The four
sources are named in the prompt because the tool only fetches URLs already in the
conversation. A page that moves or starts refusing bots degrades to search, which
is what she did before — quietly, and with no signal that the number in the
opening line came from prose rather than from the instrument.

**The session seam.** Fills the poller never reached have no `entry_time`, so
their session derives from close time rather than entry time. Flag it whenever
session data is read for a pattern spanning that boundary. A `?force=1` run with
a wide lookback repairs them for good — nothing is stored, so backfilling the
entry time is the whole fix.

**R:R is realised, not planned.** Average win over average loss from closed P&L,
drawn once per window — month, week and all time — above that window's wheel, so
a period reads against the periods either side of it rather than against the
account. The planned floor is **not recoverable from the data** — the broker
reports only the *final* stop, so a stop moved to break-even has overwritten the
original risk. Never infer what the planned R:R was; ask.

**The three calling pg_cron jobs hold no database power**, and that is a claim
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
| `doji-mcp-sync` | start a read-only poll that was going to run anyway, or read back the deals (`?raw=1`), the broker's tool list (`?tools=1`), the open positions (`?positions=1`) or a price (`?market=1`). Nothing that places, moves or closes a trade is reachable — see `ALLOWED_TOOLS` |
| `doji-eugenia` | `?force=1` — run a briefing, about $0.20, with no bound in the code; `?release=1` and a `{trade}` body reach the two cheaper event paths |
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
**`doji_cron_secret`**. The three calling jobs and both triggers all read the
lower-case Vault name, and `verify.sql` asserts all three. That trigger shipped reading the upper-case one, found nothing, and
went quiet without failing anything.

**Resolved — the old tables are gone.** `records`, `broker_fills` and
`app_state` were dropped; introspection now returns `trades`, Eugenia's two
tables and her view. That was the last step of the migration.
