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
supabase/config.toml                    Edge Function deploy settings
supabase/001_trades.sql                 the schema
supabase/002_gladys.sql                 Gladys's trade-open trigger
supabase/003_eugenia.sql                Eugenia's tables, her view of the journal
supabase/005_cron.sql                   both scheduled jobs
supabase/verify.sql                     read-only: does the database match these?
supabase/functions/_shared/edge.ts      the primitives every function needs
supabase/functions/doji-mcp-sync/       Edge Function: cTrader poller
supabase/functions/doji-email-sync/     Edge Function: the email fill's write
supabase/functions/doji-gladys/         Edge Function: Gladys, the journal bot
supabase/functions/doji-eugenia/        Edge Function: Eugenia, the market bot
doji_gmail_sync.gs                      Apps Script: broker email parser
test/                                   node:test suites — see Tests
.github/workflows/test.yml              runs both suites on every push
.github/workflows/deploy-functions.yml  deploys the Edge Functions on push to main
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
| `open_day` | the New York civil day the trade is filed under |
| `commission` | dollars, positive magnitude, **never subtracted** |
| `balance` | account balance after the fill — from the email, or from the poller on a close under ten minutes old |
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

Four runtimes and no build step, so two things genuinely cannot be single-sourced
at run time: the **setups vocabulary** (`CONFIG.SETUPS`, Gladys's `SETUPS`,
`trades_setup_check`) and the **four journal column names** (`Data.OWNED`,
Gladys's `COLUMNS`, and the columns themselves).

Copies are the cost. Copies that can *disagree* were the risk, and that is what
`test/agree.test.mjs` closes: it reads all three of each — the app out of
`index.html` through the same jsdom harness the render tests use, the function
exports directly, and the constraint out of the SQL as text — and fails when
they stop saying the same thing. Every one of those values was already tested
before, and every one of those tests asserted against a literal typed into the
file beside it, so changing a list and its own test in one pass left the other
copies untouched and the suite green.

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

**Truncation is an error, not a field, and it is checked before anything is
written.** If `get_deals` hits `maxRows` the function throws — ahead of the
upsert, because a truncated window can return a position's closing deals without
its entry and those are exactly the rows that would land. It used to throw after
the write, on the reasoning that the write had already happened; that is
backwards.

**What that costs, said plainly: a truncated run writes nothing, and the only
place it says so is a 500 that `net.http_post` discards.** So a fold window that
stayed at or over 500 deals would halt the journal quietly. It takes about
fifteen times this account's volume to reach that in 78 hours, and the realistic
way to get there is a `?hours=` backfill — which is a manual run whose response
you are reading. The poller has no Telegram path of its own, unlike Eugenia's
cron half; giving it one is the fix if this ever bites, and the reason it has
not been done is that a failure repeating every two minutes needs a rate limit
before it needs a notification. It used to return `truncated: true` in a 200 body, which
`net.http_post` discards — so the one signal that trades were being dropped went
to nobody. It is also worse than losing rows: a truncated window can return a
position's closing deals without its entry, and direction then gets read off a
close and inverted.

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
opening the app. `supabase/002_gladys.sql` holds the trigger and `doji-gladys`
is the Edge Function behind it.

**A function is named after who it is, and so are its secrets** — `doji-gladys`,
`GLADYS_BOT_TOKEN`, `GLADYS_WEBHOOK_SECRET`. Naming a bot after the wire it
speaks over leaves no rule anybody could apply to the next one. `TELEGRAM_CHAT_ID`
is the exception and earns it: it is the one value the two bots genuinely share,
because there is one trader and one chat, with a thread each.

**One function, two callers**, told apart by which secret they present:
`x-doji-key` is the trigger saying a position opened, `x-telegram-bot-api-secret-token`
is Telegram reporting a tap. They were briefly two functions and share
everything that matters — the keyboard, the message, the `callback_data`
grammar — so splitting them meant deploying that code twice and keeping the
copies in step.

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

**`callback_data` is the entire state store.** `PID562780708|setup|Break &
Retest`, `PID562780708|sl|1`, `PID562780708|edit` — the trade, the field and the
value, in 39 bytes at worst against Telegram's 64-byte cap. So there is no
session table, no `tg_message_id` column and no schema change: the callback also
carries the chat and message ids that `editMessageText` needs. A tap is
self-describing, and a redeploy in the middle of answering costs nothing.

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

**The write is the fourth writer and it stays in the journal half.** The webhook
maps a button's field to a column through the same four names as `Data.OWNED`,
so no broker column is nameable from a tap and there is nothing to arbitrate.
`updated_at` moves, and the realtime subscription the app already holds
re-renders any open tab for free.

**The trigger guard is load-bearing.** `when (new.entry_time > now() - interval
'1 hour')`. Without it, restoring from backup messages you once per row in the
file. A live fill is seconds old; everything else fails the test — restored rows
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

A daily XAU/USD briefing, a quieter look later in the morning, and a
conversation about either. **Weekdays at 08:00 ET, Sunday at 17:00 ET** — the
second is the gold open, so the week's first briefing lands exactly as the
market does. She greets with `Buenos dias jefesito` in the morning and `Buenas
tardes jefesito` on Sunday evening.

Reply to her and she answers. `supabase/003_eugenia.sql` holds both her tables
and her read of the journal, `005_cron.sql` her clock; `prompt.ts` holds who she
is; `index.ts` is the wiring.

**Three objects in the database, and only two of them store anything.**
`eugenia_turns` is the conversation window, `eugenia_notes` is what she
remembers, and `eugenia_trades` is a view — a saved `select`, no rows of its
own. The two tables stay two because nothing ever reads them together: notes go
in at the top of a turn, turns at the end, with different windows, different
shapes and different constraints. Merged, they would need a `kind` column, a
nullable `role`, two constraints that each say "unless this is the other kind"
and two partial indexes — more parts to hold one idea, not fewer.

**The schedule is decided in the function, not in cron.** pg_cron schedules in
UTC, so any fixed expression is an hour wrong for half the year and needs
editing twice a year forever. The job runs hourly and the function asks
America/New_York for its own clock — `briefDue()` for the briefing, `pulseDue()`
for the pulse — and most of those calls find nothing due and spend nothing. It
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

**She remembers what she told you yesterday.** The briefing reads the last
twelve turns, so it opens with how yesterday's print landed rather than from
nothing. It did not until now — it wrote to `eugenia_turns` and never read back,
so every morning started blank and she could not know she had explained the same
term three times that week. A briefing that could have been written on any
morning is a failure.

The stored turn is a marker (`[weekday briefing]`), not the text that was sent:
the memory and the week's trades are rebuilt fresh each morning, and storing
them would resend a stale copy as history for the next six briefings.

**She sees your week without being asked.** The last seven days of trades go in
with the briefing, so *"you have not traded since Tuesday"* costs no tool round.
Mentioned only when there is something real to say, in a clause, never as a
verdict — most mornings the right amount to say about your trading is nothing.

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

### What she remembers

Two kinds of memory, and they answer different questions.

| | Holds | Window | Written by |
|---|---|---|---|
| `eugenia_turns` | the conversation | last 12 turns | every exchange |
| `eugenia_notes` | facts about the trader | last 20 notes | her `remember` tool |

Turns roll over in a morning, so without notes she could never know in September
that he has been working on holding his stop since August. Notes are one
sentence each, in her own words, about *him* rather than about the market — a
note about today's price is stale tomorrow and the prompt forbids it. They are
handed back at the start of every turn, briefing and reply alike.

Append-only: superseding a note means writing a newer one, which is how a
person's memory works — the recent account wins. There is no update path and no
delete path in the function, so the only thing she can do to that table is add a
sentence to it.

**She reads the journal and can never write it.** `get_trades` is a tool she
calls when the conversation is about his trading, and three separate things make
it read-only: the `eugenia_trades` view fixes the column list (no `user_id`, no
`balance`, no `commission`) and hides deleted rows; the grant on that view is
`select` and nothing else; and her function has exactly one database read of the
journal and no write path to it anywhere. Said plainly, because it is the honest
limit: the grant makes the *view* read-only, not the key — she holds the service
key to write her own tables, so the structural guarantee is what matters and the
grant is the second lock.

She is still not a fifth writer to `trades`. The only things she writes are
`eugenia_turns` and `eugenia_notes`.

**Context goes in the user turn, not in a system message.** Mid-conversation
system messages are the channel built for exactly this and would keep the cached
prefix intact — but that request shape could not be exercised from the machine
this was written on, and a 400 there kills every reply she gives. Nothing here
is untrusted anyway: the notes are her own sentences and the trades are his own
journal, so the injection safety a system turn buys is not what this needs.

### When it breaks, she says so

**The briefing went silent once and nothing reported it.** `pg_net` discards the
function's response, `console.error` goes to logs nobody has open, and
`net._http_response` is pruned within hours — so a briefing that died at 08:00
was unrecoverable by lunchtime, and the way it surfaced was the trader noticing
nothing had arrived. The cron half now sends a short Telegram message naming the
error instead. Silence is the worst thing this system can do and it had three
separate ways of doing it.

**A failed briefing tries again**, at 09:00, 10:00 and 11:00 ET, and stops the
moment one has landed. `briefedToday()` reads the marker `postBriefing` stores
— written immediately after `say()` returns, so it exists exactly when the
message reached Telegram. A read failure counts as *already briefed*: if the
database is unwell the retry cannot check, and a second briefing sent on a guess
is worse than a skipped one.

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

**A refusal no longer costs the whole briefing.** Nothing retries the cron half
— `pg_net` is fire-and-forget — so a model declining the request was simply a
morning with no briefing and a line in a log nobody reads. The request now
carries `fallbacks: "default"`, which re-runs it on another model inside the same
call and routes by refusal category, so there is no model list here to go stale.
A decline before any output is not billed. The `stop_reason === "refusal"` check
stays and still fires: it is now the case where the whole chain declined.

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

**Neutral surfaces come from five alphas of white**, so a change lands in one
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
them can drift apart from the others. `verify_jwt` lives in
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
SQL editor, never by a robot: `001_trades.sql` through `005_cron.sql` are not
under `supabase/migrations/`, so nothing applies them automatically, and a
schema change that lands because a file was committed is exactly the accident
the Operating section argues against for restores. The Apps Script is deployed
from the Apps Script editor; it holds no secrets in the file and nothing reads
it from here.

**Applying by hand means the files are a claim, so `supabase/verify.sql` is how
the claim gets tested.** It writes nothing: it reads back the columns, the
constraints, the indexes, the policies, the grants on Eugenia's view, the
triggers, the realtime publication, both cron jobs and the last ten function
responses, to be compared against 001–005 by eye. Run it after any manual change
and before believing anything here about the database. A CI job cannot stand in
for it — 002, 003 and 005 need `pg_net`, `vault` and `pg_cron`, none of which a
plain Postgres container has, so a green pipeline would prove only that 001
parses.

**`005_cron.sql` is safe to re-run**, and that is the point: `cron.schedule`
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
6. Run `supabase/005_cron.sql` to schedule the poller and Eugenia. It is safe to
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
12. Run `supabase/003_eugenia.sql`, then `supabase/005_cron.sql`. The hourly
    job drives both the briefing and the pulse; the function decides which, or
    neither.
13. Run `supabase/verify.sql` and read it against 001–005. Nothing is set up
    until that agrees.

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

The suites run on every push through `.github/workflows/test.yml`, so a red run
is attached to the commit that caused it rather than found later. A second
workflow deploys the Edge Functions — see **Deployment** below. The script
globs `test/*.test.mjs` — one level, deliberately, since `boot.mjs` is a harness
and not a suite. A test added in a subfolder would not match and would silently
not run.

| File | Covers |
|---|---|
| `test/fold.test.mjs` | `_shared`'s `secretMatches` and `nyClock`; the poller's `foldPosition`, `nyDay`, the two windows, `balanceTarget`, `parseSse` and `marketOpen`; `doji-email-sync`'s `emailRow`; Gladys's `parseCallback`, `renderMessage` and `staysOpen`; Eugenia's `briefDue`, `pulseDue`, `retryDue`, `isSilent`, `briefingMarker`, `greeting`, `chunk`, `tradesQuery`, `openOnUser`, `nowBlock`, `withClock` and `dateTurns` |
| `test/app.test.mjs` | completeness, `Data.load` and `Data.save`, the price-based scratch rule and aggregate inheritance, win rate, the money split, filing day, sessions, both `Data` indexes, every render step, the journal form |
| `test/agree.test.mjs` | the facts that live in more than one file: the setups vocabulary across `index.html`, `doji-gladys` and `trades_setup_check`, and the four journal columns across `Data.OWNED`, Gladys's `COLUMNS` and the schema |
| `test/parse.test.mjs` | the Apps Script: `parseAlert_` against built alert bodies, and `syncPepperstone`'s three outcomes — which label a thread ends up with |
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
`parseCallback` and `renderMessage` are pure and are tested hard; `sendMessage`,
`editMessageText` and the PATCH reach the network on their first line, so the
double tap, the fresh-message fallback, the chat check and the secret that
picks which half runs are verified by reading. So is the trigger — nothing here runs Postgres, so its guard is argued
against the real column types and the restore SQL rather than executed.

Four gaps are worth naming rather than leaving to be rediscovered. Soft delete
has no test of its own — `Data.mark` and the `deleted` path are touched only
incidentally, by the load test asserting that a flagged row is kept and not
rendered. `London+NY` is the one session bucket never asserted. `IO.backup` is
plain JSON and testable, and is not tested. And `boot()` returns the recorded
Chart configs so a test can read what a wheel was asked to draw; nothing does,
so the wheels are checked for not throwing and nothing more.

**A check you have not proved can fail is not a check.** Both suites were run
against deliberately broken copies before being trusted: the fold tests against
an inverted entry deal, a double-counted commission, a fold window collapsed to
the write window, a `balanceTarget` with its age bound removed, one that returns
the earliest close instead of the latest, and a secret comparison that ignores
length; the Telegram tests against a setup whitelist removed, a discipline
answer that accepts anything, `direction` added to the reachable columns, `sl`
and `tp` swapped, a loosened trade id, `null` drawn as `no`, the clock reverted
to UTC, a keyboard row dropped, a summary spilling onto two lines, a setup name
long enough to overrun the 64-byte cap, `staysOpen` forced true — which is the
bug that shipped, restored on purpose — one that stops `[Edit]` reopening, and
one that lets a reopened form re-settle, Eugenia's schedule reverted to UTC
hours, a Saturday briefing, the Sunday briefing moved to the weekday hour,
swapped salutations, a splitter that stops splitting and one that drops its last
piece; the client tests
against a widened break-even band, break-evens dropped from the win-rate
denominator, a stray column in `Data.OWNED`, a session derived from the close,
an inverted filing anchor and a throwing renderer. Every one of those was
caught.

The checks added since were broken the same way before being trusted. The
**agreement** tests against a setup added to `index.html` alone, a setup added
to Gladys alone, a setup changed in the constraint alone, a journal column
renamed in `Data.OWNED` alone, and `direction` added to Gladys's `COLUMNS` — five
edits, each on one side of a pair, each caught. The **email parser** against a
fill time with its `Z` dropped, an inverted position side, thousands separators
left unstripped, and — the one that matters most — a transient send failure
recorded as permanent, which is the shape that discards a fill's P&L forever.
The **shared clock** against a timezone reverted to UTC, which took nine tests
with it. **`openOnUser`** against a repair turned back into a no-op, which is
precisely the state that shipped. And the **email boundary** against a whitelist
widened to let `entry_price` and `setup` through.

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
Both parsed correctly; nothing had been proving it.

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

**The pg_cron jobs hold no database power**, and that is a claim about the
database rather than about the secret. Neither job can read or write a table:
each presents the cron secret, read from Vault at call time, and the
service-role key lives in the functions' own secrets and never appears in a job.
This replaced an arrangement where the job text carried a legacy service_role
JWT — full RLS-bypassing access, in a job definition, and unrotatable, because
legacy keys are tied to the project's JWT secret.

**What `DOJI_CRON_SECRET` can actually cause is not the same at all three doors,
and it used to be described as though it were.** Say it per endpoint:

| Function | What a holder of the secret can do |
|---|---|
| `doji-mcp-sync` | start a read-only poll that was going to run anyway |
| `doji-eugenia` | `?force=1` — run a briefing, about $0.20, with no bound in the code |
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
**`doji_cron_secret`**. Both cron jobs and Gladys's trigger use the lower-case
Vault name. That trigger shipped reading the upper-case one, found nothing, and
went quiet without failing anything.

**Resolved — the old tables are gone.** `records`, `broker_fills` and
`app_state` were dropped; introspection now returns `trades`, Eugenia's two
tables and her view. That was the last step of the migration.
