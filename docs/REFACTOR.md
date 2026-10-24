# REFACTOR.md — what was refused, and why

`README.md` is the contract and `CLAUDE.md` is how to work here. This is the
REGISTER: every move considered and turned down, with the reasoning that decided
it, so a tempting one is not re-proposed and eventually waved through on a tired
afternoon. A refusal has no code to attach itself to, which is why it needs a
document. Read §2 before proposing a simplification; §3 is the next step, and
says what is pending.

Where it disagrees with the README, the README wins and you say so.

---

## 1 · WHAT NO TEST REACHES

What a green `npm test` says nothing about, and what must therefore be stated on
any change that touches it.

| Blind spot | What settles it instead |
|---|---|
| pixels, CSS values | a device pass by a person |
| realtime, auth | a live two-tab and sign-in test |
| the live database | `verify.sql`, run by hand |
| retrieval quality | a golden set that does not exist |
| the Apps Script's Gmail half | `gs.mjs` reaches the parser only |
| an Edge Function path no test can drive | `types.test.mjs` for the names in it; the rest by reading |
| whether a prompt still behaves | `scripts/eval.mjs`, run by hand with his key — nothing in `npm test` calls the model |
| the charm's firmware beyond its pure C | `charm.test.mjs`'s census for the names in it; the charm workflow's build for the rest of its code; the board itself for what it does |

---

## 2 · THE REJECTED REGISTER

Twelve are refused by a rule `CLAUDE.md` states, and are named here rather than
argued, so the reason lives once, in the document every session reads.

| Move | Refused by, in `CLAUDE.md` |
|---|---|
| R-1 — splitting `index.html` into modules | no build step, no bundler, one flat namespace |
| R-2 — single-sourcing the setup vocabulary | where a copy is unavoidable, a test holds the copies together |
| R-3 — deleting `MARKETS.sydney` | the two branches of `session()` that decide nothing, and why the entry stays |
| R-4 — reordering the branches of `sessionOf` | the same paragraph: the order of the first two is unobservable |
| R-5 — collapsing the poller's two windows | the poller's two windows are different questions |
| R-6 — making the offline snapshot writable | the snapshot is a read cache and can never be anything else |
| R-7 — deciding a Telegram redraw from the keyboard | never decide whether a message settles off its keyboard |
| R-8 — writing a `drop` into `schema.sql` | never write a `drop` into it: a re-run repeats it on the live database |
| R-10 — regenerating `golden.json` or `golden-fold.json` to make a red run go away | regenerate deliberately, never to make a red run go away |
| R-18 — a per-caller cache window in place of the tool array | the cache window is derived from the tool array; do not move a window on an argument |
| R-25 — grading a read by where gold went, or handing her record to the trade look | her record is judged by the test she stated, never by where price went, and it is hers |
| R-37 — handing the portrait to the trade look | the trade event is exempt from `TRIM`: a paraphrase reaching a man in a position is how a sentence becomes an order |

The rest are refused by something no other document holds, so they carry their
reasoning here.

### R-15 — giving the critic the briefing's tool array so it rides its cache
**Why refused:** it was tried, shipped, and measured, and it does not work. This
is the only entry here that was made before it was refused, which is the whole
reason it is written down: the argument for it is correct in every part except
the one that decides it, and it will read as free money to the next person.

The argument: a cache entry is keyed from the exact bytes of `tools` then
`system`, so an EMPTY array is a different key from byte zero — which means the
critic, running seconds after the briefing over the same system prompt, buys its
own copy of a prefix that is already in the cache. Send it the same array with
`tool_choice: none` and it cannot call anything, the guarantee is unchanged, and
the write becomes a read. `tool_choice` is documented as one of the few request
fields that changes without invalidating the tools and system caches.

All of that is true. What it leaves out is that the two calls differ in
**effort** — the briefing runs `high` and the critic `medium` — and an effort
change invalidates the tools and system caches on models that render the
thinking configuration ahead of them. So the prefix was never shareable, for a
reason that has nothing to do with the array.

The first morning it ran:

| caller | rounds | in | cached | wrote_1h |
|---|---|---|---|---|
| weekday briefing | 3 | 4,789 | 138,401 | 23,309 |
| critic | 1 | 2,471 | **0** | **23,309** |

Zero read, an entry written of exactly the briefing's size, seconds apart. And
the change had made it slightly WORSE than the empty array it replaced: eleven
tool schemas the critic cannot call, in a prefix it pays 2× to write.

That the same morning's release looks read theirs four times over
(`wrote_1h` 21,466 then 0, 0, 0, 0) is what rules out a broken cache and leaves
effort as the cause.

**Revisit if:** the critic's effort is ever raised to the briefing's — then the
prefix is genuinely shared and the array is worth revisiting in the same pass.
Not before, and never on the argument alone: the numbers above took one morning
to collect and the argument took a fortnight to look wrong.

Nor is the effort worth raising for its own sake. A higher effort would only
earn its time and cost if the critic were letting rule breaks through, and in
October 2026 it had revised every briefing since its verdicts were first
recorded — all six, by 1 to 11 per cent. Ask `eugenia_runs` for `critic
verdict` rows before reopening it on that ground.

**Since October 2026 effort is a message on Opus** (README, *What a turn
cost*): the top of every request carries one effort and the caller's own rides
inside the conversation, so the effort difference that decided this is gone
from the prefix. What still keeps the critic off the briefing's prefix is its
array alone. Moving it — the briefing's array with `tool_choice: none` — is the
next measurement, made by itself, with the critic's `wrote_1h` and `cached` read
the morning after. Not before the effort change has its own morning of rows.

**And the shape to carry away:** the request field that broke this was not the
one the change touched. A cache key spans every field that renders ahead of the
breakpoint, so "what else differs between these two calls" is the question, not
"what did I change".

### R-9 — a database test in `npm test`
**Why refused:** `npm test` needs Node alone, and `npm ci` installs jsdom and
typescript and nothing else. The database has its own suite, `npm run test:db`,
and its own CI job; folding it in would make every run need a server.

### R-11 — folding the New York clock into one definition
**Why refused:** the nine copies are FIVE questions, not nine answers to one.

The civil day is `nyDate` and the weekday-with-hour is `nyClock`; both live in
`_shared/edge.ts` already and every Edge caller imports them. `nyWall` in
`adherence.ts` is a superset — it needs minutes and the full date, which nothing
else does, and its own comment says so where it is defined. `nyStamp`,
`shortDay`, `nyTime` and `nyDayTime` are four DISPLAY shapes, not clocks. And
`MARKETS.ny` is a pair of integers.

So the fold is already done where it was possible, and what is left is not
duplication. Moving `nyWall` into `_shared` to serve `nyClock` from one
formatter would couple `adherence.ts` — deliberately pure, rows in and verdicts
out — to a module whose top level reads the environment, in exchange for one
formatter.

**Revisit if:** a second caller ever needs wall-clock minutes, which is the
condition `adherence.ts`'s own comment names.

### R-12 — one home for the newest-first reads
**Why refused:** they are eight reads that differ in table, select list, filter
(`superseded_by=is.null`, `embedding=is.null`, `closed_on=is.null`) and order
column (`id.desc`, `entry_time.desc`, `open_day.desc,entry_time.desc`). A helper
covering that is an options object over every part of a URL, which is the
abstraction the standard of work forbids twice over.

What the row was actually worried about is already treated. The guard derives
its subjects rather than naming them — every call to `readRows`, with each
`…Query()` builder resolved to its body — and asserts each carries a limit and
none orders `id.asc` under one, proved by planting a new read of each shape and
watching both go red. A read added tomorrow is covered without anyone
remembering to add it.

**Revisit if:** the reads ever converge on one shape, which would mean the
filters had gone.

### R-13 — folding Gladys's `readRow` and `patchRow`
**Why refused:** they share four lines — the not-ok throw, the json, the empty
check, the first row. A helper for it takes a `Response`, a verb and an id, and
reads worse at both call sites than the four lines do. Two sites, fourteen lines
apart, visible on one screen.
**Revisit if:** a third caller appears, or the empty-row behaviour has to change.

### R-16 — splitting `doji-eugenia/index.ts` into modules
**Why refused:** it was proposed, costed and turned down, and the reason is not
the one R-1 gives. R-1 refuses splitting `index.html` because the browser has no
bundler and modules there would mean adding a build step. None of that applies
here: Deno has real modules, `import` needs nothing built, and this repository
already does it five times — `_shared/edge.ts`, `prompt.ts`, `strategy.ts`,
`journal.ts`, `adherence.ts`. The banner comments already name the seams.

What decides it is that the move finds nothing. Nearly four thousand lines is
hard to hold in one head and easy to lose a helper inside, which is a real
cost — but it is a cost paid by a reader, and every defect found in this file
was found by reading it with a question, not by its being shorter. Against that:
load-order safety is free in one file and stops being free across five, and
`agree.test.mjs` reads function bodies out of one string in some thirty places,
every one of which would have to learn to read a directory. That is days of
careful work on the checks themselves, which is the worst thing to be editing
for a reason that is not about what they check.

**Not revisited:** the owner settled it in October 2026, on length or any
other ground.

### R-17 — bounding the lexical arm of `eugenia_search`
**Why refused:** it was proposed on a reading of the query and the reading was
wrong. This is the second entry here made against a measurement rather than an
argument, and like R-15 the argument is right in every part except the one that
decides it.

The argument: the two semantic arms are capped at 25 each and the lexical arm
is capped at nothing, so a common word against a growing archive pulls every
matching row out of both tables and the fusion sorts the lot. Bound each
lexical branch by its own ranking and the sort stops growing.

Every sentence of that is true about the SQL and none of it is where the time
goes. On a throwaway Postgres 16 seeded with 120,000 turns and 4,000 notes at
the real column and index definitions:

| what | ms |
|---|---|
| the lexical arm as written | 1,565 |
| the same with each branch bounded to 200 | 1,506 |
| the full-text predicate alone (`search @@ tsq`) | 28 |
| `ts_rank` over every matching row | 27 |
| `word_similarity` projected over every matching row | 30 |
| **the trigram predicate alone (`q <% content`)** | **1,246** |

The bound saves four per cent. The sort was never the cost — `ts_rank` and
`word_similarity` are nearly free as projections and the full-text match is
index-served. What costs is `<%` as a PREDICATE: a short query against
`gin_trgm_ops` produces an enormous candidate set, and it is slowest on
`R-08`, which is the exact query shape `CLAUDE.md` says the trigram arm exists
to serve.

It grows linearly and gently. Measured on the real plan, the whole archive
scanned each time:

| turns | ms |
|---|---|
| 10,000 | 108 |
| 20,000 | 211 |
| 40,000 | 435 |
| 80,000 | 834 |
| 120,000 | 1,326 |

About eleven milliseconds per thousand turns. Several years of use is one and
a third seconds inside a tool loop bounded at 150, so there is nothing here to
repair.

A GiST index with a KNN order (`content <<-> q limit 200`) was measured too:
412 ms against the GIN predicate's 1,265. Three times better, for a second
index type, a rebuild, and an arm that returns the nearest N rather than
everything above the threshold — which is a change to what `search_memory`
finds, not a speed-up of it.

**Revisit if:** `eugenia_turns` passes a few hundred thousand rows, or a
`search_memory` call is ever seen taking a share of a turn worth noticing. The
thing to change then is the trigram arm and the index under it. Never the
lexical bound, and never on the shape of the query alone — reading this one
produced a confident wrong answer about which line was expensive.

**And the shape to carry away:** an unbounded row count is a claim about
memory, not about time. The question is which operator runs per row and
whether an index can serve it, and that is a measurement rather than a reading.

### R-19 — a pattern filter on what she sends, behind her prohibitions
**Why refused:** an outside review in October 2026 proposed it as the one wall
that is not a sentence. The prohibition is about meaning, and a pattern cannot
read meaning: a printed level is a fact she may state, a plan he has not taken
is checked against his own numbers, and a filed call carries levels by design. A filter strict enough to catch a
paraphrased signal holds real messages, and the path the review would start
with, the trade event, is where a held message costs most. The trade event's
exemption from `TRIM` is deliberate, for the reason `CLAUDE.md` gives. What the
review actually found was §1's last row: nothing said whether the prompts still
behave. `scripts/eval.mjs` now asks it, by hand.
**Revisit if:** that set exists, and shows a violation with a shape a pattern
catches and no real message shares.

### R-20 — a "started" marker against a second briefing across the hour
**Why refused:** the race needs one run to outlive the hour. The job fires at
minute zero, the worker dies at 400s, and each turn is bounded at `TURN_MS`.
**Revisit if:** the hourly job leaves minute zero, or the wall clock passes an
hour.

### R-21 — de-duplicating Telegram's update id in the reply path
**Why refused:** the reply path answers 200 before it works, so a redelivery
needs Telegram to give up on a response that is sent at once. Nothing has shown
a double reply.
**Revisit if:** `eugenia_turns` ever holds one message of his twice.

### R-22 — a secret per caller in place of `DOJI_CRON_SECRET`
**Why refused:** the system has one user, and the secret lives only in Vault,
in Edge secrets and in the cron jobs. Every new name is another pair spelled in
two places that fails quietly when one is wrong — the failure `CLAUDE.md` lists
under *Two names that are one value*. What a leak would spend is bounded by the
spend limit on the Anthropic key's workspace.
**Revisit if:** anyone but him ever holds a credential here.

### R-23 — holding the function deploy until `test:db` passes
**Why refused:** the deploy ships functions, and `schema.sql` is applied by
hand, on purpose. A red database suite cannot reach the database through the
deploy, so gating it would hold back functions for a change they do not carry.
**Revisit if:** applying `schema.sql` is ever automated.

### R-24 — keeping the live TradingView sign-in until a new one completes
**Deferred, not refused.** `?connect=1` clears the tokens before anyone signs
in, so a stray call (his, or anyone holding the cron secret) ends a working
connection. The repair is to hold the new client beside the old one and swap
on a completed callback. It needs new columns, and a function deploys itself
on merge while the SQL waits for a person: shipped in that order, the sign-in
breaks.
**Revisit if:** a sign-in is lost to a stray `?connect=1`, or `tradingview_auth`
changes for another reason. Then it goes in the same pass, SQL applied first.

### R-26 — folding the portrait into `notesBlock`
**Why refused:** both are what she knows of him, and one block would save a
read and an argument on four paths. But `notesBlock` fails whole: a function
deploys on merge while `schema.sql` waits for a person, so a missing
`eugenia_portrait` — or any failed read of it — would take his instructions
with it. Its own block costs the paragraph and nothing else.
**Revisit if:** applying `schema.sql` is ever automated with the deploy.

### R-27 — reading the live note count with `count=exact`
**Why refused:** an exact number matters only past the window, and one row
more than the window answers "is there more" inside the read already made. A
counted read is a second request per kind on every path, for the same answer
below twenty.
**Revisit if:** the nightly pass ever needs the exact count past twenty.

### R-28 — Hermes Agent's review every ten turns
**Why refused:** Hermes forks itself after a run of turns to ask what is worth
saving. Her day has one end, and a note decided mid-conversation is decided at
the worst moment (README); the nightly pass is that review, over the whole day,
with the week's trades beside it.
**Revisit if:** a day's turns stop fitting the pass's window.

### R-29 — playbooks: lessons loaded only in the situation they govern
**Deferred, not refused.** Hermes keeps "how to do this kind of task for this
user" in skills that load when the task comes up, so always-loaded memory stays
small. For her it would be a second memory that changes how she behaves, which
needs his audit and his correction channel as notes have, and nothing yet shows
an instruction that should hold only some days. Twelve standing instructions
fit the window.
**Revisit if:** he wants an instruction that holds only on certain days, or the
merges the pass makes past fifteen start losing meaning.

### R-30 — recalling memory before every reply
**Deferred, not refused.** Hermes searches its memory before each turn; she
searches when she decides to. Automatic recall costs an embedding and a search
on every reply and puts unasked-for rows in front of her. Unmeasured: a reply's
`detail` counts `search_memory` calls, so how often she reaches past the window
can be read.
**Revisit if:** that count shows her rarely searching while he refers back to
conversations she no longer holds.

### R-31 — ranking her own turns below his in search
**Deferred, not refused.** Hermes demoted scheduled sessions once their
vocabulary crowded the user's own out of recall. `eugenia_search` ranks her
long daily briefings beside his short lines, and `ts_rank` is not normalised
for length. Unmeasured.
**Revisit if:** a search for words he used comes back mostly as her briefings.

### R-32 — opening a read when it is given and grading it later
**Why refused:** a read is about today's news and the pass runs after the day
it was about, so filing and judging are one write. An open state would need a
window and a closing rule, as loops do, for reads that would almost all close
the same night.
**Revisit if:** reads about a week — Sunday's — are untested so often that the
record stops saying anything about them.

### R-33 — folding the charm's `sound_tick` into `play_notes`
**Why refused:** the chime and the listening notes were one loop with
different numbers and now share `play_notes`, proved byte-identical. The tick
is not the same sound: its note stops dead at 8 ms where `play_notes` lets a
decay run on, so folding it changes the samples, and a refactor may not.
**Revisit if:** the tick is redesigned, as a behaviour change with its own
commit.

### R-34 — dropping `agree.test.mjs`'s read of the charm's briefing hours
**Why refused:** `charm.test.mjs` compiles `briefing.c` and walks it against
`briefDue` and `retryDue`, which is the stronger proof, and the two look like
one check twice. They answer different questions: the Facts list is held by
`agree.test.mjs`, which reads every copy as written, and the compiled walk
proves what the copy does. Each would go red where the other might not.
**Revisit if:** the Facts list stops being `agree.test.mjs`'s alone.

### R-35 — one register helper for the charm's power chip and motion sensor
**Why refused:** `power.c` and `motion.c` each write a register through their
own device handle in three lines. A shared helper needs a file of its own, or
one driver reaching into the other, to save six lines between two chips that
share nothing but the bus.
**Revisit if:** a third chip on the bus is driven.

### R-36 — signing the charm's updates
**Why refused:** she installs whatever app the public `charm` bucket holds,
over TLS, and only the workflow writes it, with `SB_SECRET_KEY`. Whoever holds
that key already reads and writes every table, so a signature would guard a
door behind one already open, at the price of a signing key to keep and a
public key built into every board.
**Revisit if:** anyone but him ever holds a credential here, or the bucket is
ever written by anything but the workflow.

### R-38 — `-Werror` on the charm's own component
**Why refused:** the C version of `types.test.mjs`'s two questions is asked
already. A name used and declared nowhere fails the ESP-IDF build — its
`-Werror=all` makes an implicit declaration an error, and an undeclared
variable is one under any flags — which was seen red on the workflow, planted.
A name declared and used nowhere is `charm.test.mjs`'s census, which runs on
every push in `npm test`, needs no toolchain, and reaches what no warning
does: a header export no other file calls, a function missing from its
header. Wholesale `-Werror` would add a red build for every warning the pinned
toolchain or a component's header raises — facts about the invocation, which
is why `types.test.mjs` asks two questions and not a whole typecheck.
**Revisit if:** a defect the compiler warned about reaches `main` past the
census.

### R-39 — moving `FRAME_VOICE` and `FRAME_VOLUME` into `frames.c`
**Why refused:** they are the one header export only its own file reads, so
the strict reading of "a header exports only what another file calls" moves
them. But they are the wire format `frames.h` documents beside the function
that decodes it, the Facts row names them there, and `agree.test.mjs` reads
them there against `FRAME`. The census holds a header's functions to another
caller and its other names to a use, which these have.
**Revisit if:** a header grows constants that are not part of what it
documents.

### R-40 — naming the charm's screen centre and size
**Why refused:** 233 and 466 recur in every file that draws, but they are two
of some hundred coordinates measured in the same pixels — the render is bytes
for this panel, and every position is the playgrounds' number on it. Naming
two leaves the rest literal in the same space and makes no decision movable.
**Revisit if:** a second panel size is ever driven.

### R-41 — the charm's single-use colours into `palette.h`
**Why refused:** `palette.h` holds a colour the app or a second file shares.
The render's ink, highlight and mouth in `face.c`, the journal's resting
halves and the setup screen's cross are each drawn by one function, beside
which they are read — the reason §3 gives for leaving each CSS rule beside its
component.
**Revisit if:** a second file draws one of them.

### R-42 — one tick for the setup screen and the journal's done
**Why refused:** the two ticks share three points, but one is an `lv_line`
object shown whole and the other is drawn in stroke by stroke by its own
event; sharing the points needs a header for six numbers, and they may part
the day either is redesigned.
**Revisit if:** the tick is redesigned and both are meant to stay one shape.

### R-43 — one Wi-Fi bring-up for `net.c` and `setup.c`
**Why refused:** one starts a station that joins in the background with a
fast path through the last access point; the other an access point and a
station side by side, every event routed to the setup screen. What they must
agree on — her own leaving is no refusal — is already held, found rather than
listed, by `agree.test.mjs`. A shared start would be an options object over
two modes. The same holds for the `yyyymmdd` day `briefing.c` and `ota.c`
each keep: each is compared only with itself, so the two cannot disagree in a
way that matters.
**Revisit if:** a third file joins a network.

### R-44 — one bare full-screen object for `face.c`, `journal.c` and `setup.c`
**Why refused:** `plain()`, `box()` and `group()` each make a 466 × 466 object,
but on different parents, with different flags, one with a background and one
hidden at birth. One helper would take those as arguments for three callers
that read plainer as they are.
**Revisit if:** a fourth file draws a screen of its own.

### R-45 — checking every `esp_err_t` in the firmware
**Why refused:** a check is for a failure that changes what she does next.
What she does next is decided by the exchange's outcome, not by each call on
the way to it: `esp_http_client_fetch_headers` failing leaves the status at
0, and `talk()` shows any answer but 200 as her confused face while the
network is up, the lock screen once it is gone — a −1 included, and an answer
whose stream stopped short of its end, which reads like her last word until
`esp_http_client_is_complete_data_received` is asked (October 2026: a dropped
line had been playing as a finished answer). An NVS write that fails costs a
setting the next save repeats; the codecs and the radio's start-up fail into
the same refusals the doors report. Each check would be padding where nothing
untrusted enters.
**Revisit if:** a failure is found that the exchange's outcome does not carry,
or a setting is ever written once and never again.


### R-46 — search by date, and a scroll around a hit
**Deferred, not refused.** Hermes's session search takes date bounds, sorts
newest or oldest, and returns the turns around a match. Hers returns twelve
hits cut at 300 characters with no neighbours, so a hit on his "yes, that one"
says nothing about what he agreed to. A date argument changes `eugenia_search`'s
signature, which is a `drop` run by hand. A scroll could be a plain read of the
turns either side of an id, but hits carry no turn id today. Unmeasured, as R-30
is.
**Revisit if:** a reply's tally shows `search_memory` called twice or more in
one turn for the same question, or he says she quoted him out of context.

### R-47 — his approval before a note is kept, and a mark on what changed overnight
**Deferred, not refused.** Hermes can stage every memory write for the user's
yes, and announce each change in chat. Her notes are his correction channel, and
staging would put a step in front of the only lever he uses. `/notes` shows what
she holds but not what moved last night.
**Revisit if:** a wrong note is found that shaped her for more than a week
before he saw it.

### R-48 — the portrait's claims linked to the notes and counts they rest on
**Deferred, not refused.** Honcho's deduction and induction passes refuse a
conclusion without its source ids. The portrait asks for each claim to be
counted, but nothing links a sentence to what it counted. Ids inside an
800-character paragraph read back to her as noise.
**Revisit if:** the portrait is found carrying a claim no count supports.

### R-49 — a commitment's period as a column
**Deferred, not refused.** Graphiti stores when a fact stopped being true apart
from when it was learned. A commitment's period lives in its words, and the
nightly pass reads it there. A column would make *ended* computable instead of
read.
**Revisit if:** a commitment is retired before its period ended, or left open
long after.

### R-50 — reasoning about him every few replies
**Why refused:** Honcho re-derives its model of the user every N turns, in up to
three passes. Hers is a judgement across days, made once at night with the week
in front of it. Doing it per reply is a model call per reply to answer a
question whose evidence arrives once a day. R-28 is the same refusal for notes.
**Revisit if:** R-28's condition is met.

### R-51 — memory that decays with age
**Why refused:** FinMem and its kin rank memories by recency and let the old
ones fade. Hers keeps what is still true however old (`CONSOLIDATE`: "a note
that is merely old stays"), and the window, the merge rule and search already
handle volume.
**Revisit if:** never on age alone.

### R-52 — several drafts, a debate, or a team of analysts behind a read
**Why refused:** TradingAgents and the forecasting systems sample many times,
argue a bull against a bear, or split the analysis across agents. Her read is
one sentence fenced by its own falsifier, and the briefing's cost is its
draft. Several drafts multiply that cost for the one paragraph the rules
already constrain hardest. Agent Market Arena's finding that architecture moves
outcomes more than the backbone is a finding about trading P&L, which she is not
graded on.
**Revisit if:** `scripts/eval.mjs` shows her reads failing their own fence in a
way a second opinion would catch.

### R-53 — sources printed under the briefing
**Deferred, not refused.** Bloomberg links its summaries to the documents behind
them. Hers are spoken and read on a phone, and every figure she quotes already
comes from a handed block rather than a page.
**Revisit if:** he asks where a figure came from more than once.

### R-54 — context as a mid-conversation system message, and cache diagnostics
**Deferred, not refused.** Both are documented for Opus 5.5. The first gives
handed context operator authority over web text, but the README records that
shape as never exercised here, and a 400 kills every reply. The second would
say where a prefix broke, but effort as a message (R-15) tests the one place a
break is known.
**Revisit if:** that measurement leaves an unexplained write, or a page's
text is seen steering a reply.

### R-55 — compaction, context editing, the memory tool, the batch API
**Why refused:** each solves a problem she does not have. Her windows are twelve
turns and twenty notes, her memory is her own tables, and the nightly pass is a
tool loop that a single batch request cannot run.
**Revisit if:** a window is ever widened past what a request carries cheaply.

### R-56 — interpolating the call rules into `SYSTEM`
**Why refused:** `SYSTEM` tells her the rules her calls are held to in words —
*twenty dollars*, *twenty-five to thirty*, *one and a half times* — and
`make_call`'s description interpolates the same constants. Interpolating
`SYSTEM` too would single-source the numbers, but it changes the prompt she
reads, which is a behaviour change to be run through `scripts/eval.mjs`, for a
fact that has not moved. The words stay, and `agree.test.mjs` holds them to
`callProblem`'s constants.
**Revisit if:** one of the call rules changes, when the edit is a prompt change
anyway.

### R-57 — several Opus packets to an Ogg page on the charm
**Deferred, not refused.** `ogg.c` writes one 20 ms packet a page, and each
page's head is 28 bytes against a packet of about 60 at 24 kbit/s, so a
quarter or more of a five-minute file is heads — about 1.3 MB where packing
pages would make it under a megabyte. It fits her door's 3 MB and the room
`talk.c` gives it, and one packet a page is what the test can read against
the specification page by page. **Revisit if:** the upload's time shows in
how long he waits for her, or the room on the board proves short.

### R-58 — the five-minute tick without a gap in the recording
**Deferred, not refused.** The tick half a minute before the end plays on the
same task that reads the microphones, so about a fifth of a second of his
voice is not recorded while it sounds. Playing it beside the recording means
a second task on a codec pair that is opened and closed together. **Revisit
if:** a transcript is seen to lose the words said over the tick.

### R-59 — one wait for the sleep screen reaching the panel
**Why refused:** `main.c`'s `LAST_FRAME_MS` (200 ms) and the journal's two
face frames both wait for the dark to be drawn, but before different things:
the first before deep sleep stops the chip, which the panel must have
finished with, the second only before the journal object is hidden over a
dark that is already drawing. The first has no frame to count and keeps a
margin the second does not need. **Revisit if:** the sleep screen is ever
seen half drawn after she sleeps, or a flash is seen when the journal leaves.

### R-60 — reading all fourteen charts at once
**Why refused:** one at a time, fourteen outran `DOOR_MS` at the five or six
seconds a chart took on 13 and 14 October; all at once is the burst TradingView
refuses — its scanner answered 429 on every quote batch, and its calendar
refuses past about thirty reads a minute — on one session. `inLanes` keeps
three in flight. Three is a reading, not a fact.
**Revisit if:** the `market read` rows name refusals from the job's reads (go
to two), or still name *not reached* at three.

### R-61 — a bound on how old a kept market line may be
**Why refused:** the odds carry `ODDS_HOURS` because they carry only the time
they were read. Each market line carries its own bar times, so a line kept
from an earlier pass reads as old where it is old, and a bound would drop a
true reading for its age. A job that has stopped is the dispatch watcher's to
report.
**Revisit if:** a briefing quotes a kept line as though it were current.

### R-62 — a job of its own for the read-ahead
**Why refused:** it rides the quarter-hourly calendar job, after the filing.
Its own job is a new name in `dispatch_job_check` (an `upgrade.sql` step), a
seventh schedule and the counts in `verify.sql`, for the same cadence. The
cost is a job whose name says only *calendar*.
**Revisit if:** the market and the calendar want different cadences, or the
job's worst case — 45s filing, then 45s reading — nears its 120s timeout.

### R-63 — a longer bound for the quarter-hourly calendar read
**Deferred, not refused.** About thirteen of some 270 filings from 12 to 15
October got no answer in 45 seconds, most of them overnight. Each window
overlaps the next, so the filing a quarter hour later catches up, and no
briefing lost its calendar.
**Revisit if:** a print's actual reaches the calendar later than the next
filing, or the failures cluster before 08:00.

### R-64 — dropping `event` from the trade-event wire
**Why refused:** with the open trigger gone, every event the trigger sends is
`closed`, so `postTradeEvent(id)` alone would do. But the `{trade}` door takes a
body from a person too, and the guard on `event` is where that body enters; the
trigger's body is SQL re-run by hand, so the change costs a manual step to
remove one line that decides something.
**Revisit if:** the door stops taking a body from anyone but the trigger.

### R-65 — renaming `trades_eugenia_on_event` for the close it now serves
**Why refused:** the name is still true — a close is an event — and a rename is
a trigger body, a `verify.sql` row and the README's six-caller list edited by
hand, for a word.
**Revisit if:** a second event comes to need a function of its own.

### R-66 — folding R-03 into R-11 now that a full stop is the day's 4%
**Why refused:** on a linear ladder every full stop breaches R-11 as well, so
the two agree on it. R-03 reads prices alone and decides a day whose rows carry
no size, where R-11 is `unknown`; folding it loses the only verdict on those
days.
**Revisit if:** every row in the journal carries `size_oz`.

### R-67 — the strategy's note that R-14 is retired
**Kept on purpose.** "Free of archaeology" is for code. Her notes and turns
can still cite R-14, and §7's line saying it is retired, and that its ID is not
reused, is what stops her holding him to a rule he no longer keeps.
**Revisit if:** nothing she has stored mentions R-14 any more.

### R-68 — narrowing `CAL_AHEAD` now that no trade warning reads ahead
**Why refused:** the warning on an open was one reason for the 28 hours; the
weekday briefing naming tomorrow morning's prints is the other, and it stands.
Narrowing it would change what the briefing knows, which nobody asked for.
**Revisit if:** the briefing stops carrying tomorrow morning.

### R-69 — indicators on her map
**Why refused:** `doji-tradingview` could hand her RSI, MACD and the moving
averages for one call (`mcp-tv-get-technicals-rating`), but his rules read
none of them: R-08's four steps are bias, level, candle and the ratio, and
she is told to hold him to what he wrote rather than to her idea of a setup.
A number on her map is one she reasons from, so an oscillator there is a
second strategy beside his, and her calls would be scored on rules that are
not his. **Revisit if:** his strategy names an indicator.

### R-70 — a picture of his chart instead of a map
**Why refused:** she reads screenshots, so the bars could be drawn and sent to
her as one. A model reading a level off pixels is the arithmetic she does
worst, done blind, and the drawing would be a new dependency in a function
that has none. The map hands her the numbers his chart would show, each one
timed. **Revisit if:** a judgment his rules ask for turns out to need the
shape and not the numbers.

### R-71 — every central bank, and gold funds outside the US
**Deferred, not refused.** `?flows=1` reads five central banks and two US funds
off TradingView. Every other central bank is the IMF's data, and the funds in
Europe and Asia the World Gold Council's; neither site answered this session's
network, so nothing could be captured, and a reader written without a capture is
one written before its probe. She reads both off their pages with `web_fetch`,
dated and sourced.
**Revisit if:** a capture of either is saved as a fixture, or a central bank
outside the five starts moving the story.
**China's premium is refused, the yuan read instead, October 2026.** The
fastest live read of Chinese buying is the Shanghai premium — Shanghai's gold
in dollars an ounce less London's. `?probe=china` was captured twice on 17
October: the Shanghai Futures Exchange is refused on his TradingView plan, and
CME's Shanghai Gold contracts (`COMEX:SGU1!` in dollars, `COMEX:SGC1!` in
yuan) printed the same settlement three days running with no volume, the
dollar one some $600 above gold — a stale number a premium cannot be read
off. `FX:USDCNH` traded, so the offshore yuan joined `MARKET`.
**Revisit if:** his plan gains SHFE, or the CME contracts start printing
volume.

### R-72 — gold's reaction to each print, filed beside it
**Built, October 2026, his decision, without either cost named here.** A table
of its own keyed on the calendar row, so the calendar keeps its one writer;
filed off the same thirty-hour window of minute bars the nightly pass scores
her calls on, so nothing reads further back than the bars already reach. What
it does not have is the history before
it: the record starts the night it shipped.
**Revisit if:** a base rate is wanted before a year of prints has been filed —
the poller's `?replay=N` door reaches the 08:30, 10:00 and 14:00 prints of the
last 120 weekdays.

### R-73 — reading the weeks with the market every quarter hour
**Why refused:** a daily close moves once a day, and the whole market list
again on every pass is the burst TradingView refuses. `storeTrend` asks once a
New York day and carries what a pass misses.
**Revisit if:** TradingView's quote batch answers, so one call serves the list.

### R-74 — computing the move over a week or a month
**Why refused:** `trendList` and `flowsList` state levels on dates, as
`aroundList` does, because a change worked out here is a figure with its window
stripped. She reads two dated levels and says the window. A fund's money in or
out is the one figure over a window, and the screener names the window.
**Revisit if:** she is seen getting the arithmetic between two levels wrong.
**Not a change over a window:** a correlation of gold's daily changes with the
real yield's and the dollar's (`fitOf`, October 2026, his decision) is a
figure two levels cannot give, stated with its sessions and its dates, so
this refusal stands beside it.

### R-75 — a scoreboard of the channels, kept by the nightly pass
**Deferred, not refused.** Which force moved over a week or a month is now
read off the weeks behind the market, and the thesis carries which way the
story is going; a scoreboard would be a third place saying it.
**Revisit if:** the thesis keeps naming a force the weeks do not show moving.

### R-76 — the flows read ahead into `eugenia_market`, every quarter hour
**Built once a New York day instead, October 2026.** The refusal stands for the
quarter hour: the reserves are quarterly and months behind, and the funds'
windows are a month and longer, so a copy kept fresh that often would be the
same answer refetched. What reopened it was the revisit condition met: on 22
October the weekday briefing reached for the flows through `get_around`, and
TradingView's daily quota, spent by the job, refused it. Read once a day by
`storeFlows`, as the weeks are, the copy costs six calls a day where every
`get_around` cost six, and no reader waits on the door. The speculators' count
rides beside it (`storePositioning`); the CFTC has no quota, but a reader then
waits on nothing either. Neither reaches the weekday briefing as a block:
`SYSTEM` says they come on Sunday and from `get_around`, and moving that line is
a prompt change, made only through the eval.
**Revisit if:** a day's copy is seen to miss a release that mattered the same
day.

### R-77 — a database test for the reads' channel key
**Why refused:** `eugenia_reads.channel` references `eugenia_channels` as a
declaration, not a function, so `test/db`'s census does not ask for one, and the
dump comparison already holds it fresh, re-run and upgraded. `agree.test.mjs`
reads the key in `schema.sql` and holds the six names against the check and the
seed; `verify.sql` asks only that the column is there.
**Revisit if:** a write path to `eugenia_reads` starts choosing the channel from
anything but the tool's enum.

### R-78 — the map's grid and candle count interpolated into her words
**Why refused:** `GRID` and `CANDLES` are said in words by `get_structure`'s
description and by `SYSTEM`, "the $25 grid" and "the last four closed 15m and
5m candles". `prompt.ts` imports nothing, and the first import would be a new
pattern in it for two numbers; the tool's description would read "4" where it
reads "four", a change to what the model is told made by a refactor. Both
copies are in the README's Facts list, and `agree.test.mjs` holds them, with
§4's grid, against `structure.ts`.
**Revisit if:** a third reading of the map comes to be said in words.

### R-79 — the position case judged by the judge alone
**Why refused:** its `my read` pattern failed a reply the judge passed, because
the ban leaves her free to offer a read he can ask for. Dropping the pattern
would leave the case's one check that costs nothing and cannot drift with the
judge's model. It now matches a read stated, "my read is" or "my read:", and
`fold.test.mjs` holds reads it must fail and offers it must pass.
**Revisit if:** she gives a read in words the pattern does not name, and the
judge is what catches it.

### R-80 — "never widened" as a rule of its own
**Why refused:** §7 already called it R-02's respect half, and it answers the
stop question R-02 asks, on the same marker. A new ID would move the twelve in
every list and count `agree.test.mjs` holds, for a predicate that is one more
`fail` in an existing rule.
**Revisit if:** he wants the cap and the widening reported apart.

### R-81 — R-02 judging a position still open
**Why refused:** `check_rules` runs while he may be holding the trade, and a
widening named on a live position is a remark about what to do with it, which
`SYSTEM` forbids. The rule reads closed trades only, as the cap always did.
**Revisit if:** the prohibition on his open positions changes.

### R-82 — a stop pulled and never put back read as widened
**Why refused:** the poller writes a pulled side as null, so no distance was
recorded, and a verdict on a distance nobody saw is the claim §8 warns about.
`unknown` names the trade. A pull put back further out is a `fail` already.
**Revisit if:** he decides that pulling the stop is itself the breach.

### R-83 — the folds over captures with their stop history
**Deferred, not refused.** `golden-fold.json`'s captures predate `trade_stops`,
so the widening half runs there over no history and only `fold.test.mjs`'s
planted histories drive it. A capture of the table would have to be read off
the live database, which this session's network refuses.
**Revisit if:** a capture of `trade_stops` beside its trades is saved as a
fixture.

### R-84 — her day check on an open, and a narrower rules question at fill
**Why refused, both, by him.** Eugenia proposed that a trade opening should
first say whether the day already had its entry or its −4%, and that Gladys's
rules question become *"first entry today, or a sweep re-entry?"*. The first
arrives after the click, about a position he holds, which v1.23 removed for
that reason; he now brings her the plan before entering, and that check holds
R-03 and R-11. The second asks what R-03, R-10 and R-11 already compute, and the
broad box is worth more as his own account: where his mark and the computed
rule disagree is the finding she uses.
**Revisit if:** he stops bringing her a plan before he enters.

### R-85 — R-04's guard on a row with no side
**Kept on purpose**, where R-02's and R-19's went. Those two reach a trade only
through its stop history, so the poller saw it open and wrote the broker's side.
R-04 reads `best_price`, which the poller recovers for trades older than its own
history, written by paths that predate `emailRow`'s check, so a broker row
without a side can reach it.
**Revisit if:** the live database holds no broker row whose `direction` is
null.

### R-86 — the setup refusing a 503 its door gives before the key
**Deferred, not refused.** `setup.c` takes a 503 as a right key at a door short
of a secret of its own, which Eugenia's charm door answers after the key. Each
function's boot guard answers 503 before it, so while a required secret is
missing any key is saved as right. Telling the two apart means the setup reading
the body, for a function that is down anyway and a key the next exchange would
refuse.
**Revisit if:** a key saved at setup is ever found wrong after a function came
back up.

### R-87 — the keys each door answers, held as a list
**Why refused:** a list of the keys Eugenia reads off each door, beside the keys
the door's return literal names, is what the other copies here get. It would see
neither a nested key, the weeks' `points` or a reserve's `tonnes`, nor a key
spread in from a fold, and every one of those was renamed green. `serve.test.mjs`
drives her readers off the real handlers instead, which sees them all and needs
no declaration. The quote stays held by its two interfaces, which already name
every field.
**Revisit if:** a door is added that the driven test cannot stub a vendor for.

### R-88 — loosening the eval's counts to the model's miss
**Why refused:** a review of 257 against 250 and a paragraph of five against four
are misses by a word and a sentence, and widening each count to what she sent
would have been green the same day. But the count is the rule she is given, and
an eval that moves to meet her stops saying whether she keeps it. The prompt
moved instead: the review cuts with room below its ceiling, and a lead-in is
counted as the sentence it is.
**Revisit if:** she misses a count by the same margin with the room given, which
says the room is in the wrong place rather than too small.

### R-89 — the bigger charts' highs and lows joining the levels, and today's readings changed
**Why refused, on the first calibration, 16 October 2026.** The map holds the
previous day's and week's highs and lows and the daily and 4H turns apart
until a run says they find more of his entries than chance does. They did
not: added to the levels, his twenty newest entries sat at one 85% of the
time against 86% by chance under today's readings, a lift of 0.99, and no set
of readings beat 1.11. Over sixty sessions they held 50% of the time against
53% for a price nobody marked. The levels themselves held no better (52%,
0.97×), which says the hold test does not separate a turn from any price, not
that the levels are wrong — they find his entries at a lift of 1.19. Two
readings beat today's on lift (TURN 3 with ON_GRID 5, 1.48), but on twenty
entries, picked as the best of thirty-six, with EDGE changing nothing in any
row; a best of thirty-six on twenty is a fit, not a finding. The one kind that
held clearly better than chance was the quarter off the round number (69%,
1.28×, seventy settled) — noted, not acted on.
**Revisit if:** a run over twice the entries still puts the bigger charts
above 1.0, or still puts another reading ahead of today's, or the quarters
still hold above 1.2× over another sixty sessions.

### R-90 — one read of the night's minute bars for the scoring and the reactions
**Why refused:** `scoreCalls` and `fileReactions` each read the poller's thirty
hours of bars, two requests a night where one would serve. Handing one read to
both ties their outcomes: a refused read becomes one failure reported twice, or
a scoring that never ran because there was nothing due leaves the reactions
nothing to read. Apart, each job's row says what happened to that job.
**Revisit if:** the poller's bars door is seen slowing the pass, or a third job
needs the same window.

### R-91 — the confirming candle out of the prompt
**Why refused:** `SYSTEM` says "a fifteen-minute candle", a copy of
`CONFIRM_MS` in words. It is also R-07's 15m, his rule, which she is told in his
words everywhere a call waits, so the words stay and a test holds them to the
constant. The correlation windows are not copied at all: each line of the block
states its own sessions, and the prompt points her to it.
**Revisit if:** his rules move the confirming candle off the 15m.

### R-92 — a cap on what each briefing was handed
**Why refused:** `eugenia_inputs` keeps the whole message a briefing was asked,
one a day, and nothing prunes it, so it is the table that grows fastest. A cap
or a window would delete the one record of what a past morning looked like to
her, which nothing else can rebuild, and the system is meant to run for years.
Postgres already compresses long text out of line, and the backup's artifact
is zipped, so the growth is a fraction of the prompt's size. The run's log
states each table's size, so the growth is watched, not guessed.
**Revisit if:** ninety copies of the backup come near the account's artifact
storage. Then the inputs move to their own artifact, taken once a week and kept
as long as the others, rather than any row being dropped.

R-93 to R-97 were turned down by a database audit in October 2026, each on a
read of the live database rather than an argument, so the figures are the
reason. R-98 was deferred by the same audit's closing review.

### R-93 — dropping `trades_user_open_day`, `eugenia_turns_id_desc` and `eugenia_calendar_ticker`
**Why refused:** read as code, none is needed. Every trade is his, so
`user_id` narrows nothing and no read filters it; `eugenia_turns_id_desc`
copies the primary key, which a backward scan serves; nothing filters or
orders on `ticker`. Measured on Postgres 16 at 3,000 trades and 60,000 turns,
the planner chose the scan and the primary key with the indexes present. But
the live counters showed 2,054 scans of the first and 1,486 of the second,
against none of the turns' primary key: at 132 trades and 312 turns the
planner picks between equal plans. A drop is an `upgrade.sql` step and a
`verify.sql` edit for nothing that can be measured.
**Revisit if:** a write to any of the three tables is ever seen to cost, or `ticker`
stays unread when the calendar passes ten thousand rows.

### R-94 — a reach line on the stop history read
**Why refused:** `stopsQuery` takes the newest 2,000 rows over at most 372
days and says nothing when it stops, where the trades read has `reachLine`;
cut, R-02 would miss a widening on the oldest trades and pass them. The live
table held 38 rows in its year, four at most for one position.
**Revisit if:** `trade_stops` passes a thousand rows in a year.

### R-95 — a hash of the whole schema in `verify.sql`
**Why refused:** `verify.sql` asks by name, not by definition, so a default or
a constraint that drifted inside `create table if not exists` before
`upgrade.sql` existed is invisible to it. One fingerprint of the live database
against a fresh build found every constraint, index, policy, trigger,
function, view and job identical; the drift was column order in three tables,
which nothing reads, and grants on `trades` tighter than the file's, since
written into it. A hash row would need regenerating with every schema change.
**Revisit if:** a live object is ever found to differ from a fresh build in a
way that changes behaviour.

### R-96 — her windowed reads falling back to the fill day, as the app does
**Why refused:** a row with no `open_day` counts in the app, through `dayOf`,
and drops out of every read of hers filtered on `open_day`, so the two would
total differently. The live table held none: the poller files every position it
folds, and the rows from before it carry a day.
**Revisit if:** a live row has `open_day is null`.

### R-97 — a mark on a trade whose minute bars never answer
**Why refused:** `fillExcursions` asks for the newest three trades without a
`best_price`, so three whose bars never come back would be asked every poll and
stall every trade behind them. The live table held no closed trade waiting.
**Revisit if:** the poller's `excursions` reads 0 while a closed trade a minute
or longer carries no `best_price`.

### R-98 — TRUNCATE revoked from the publishable key on her tables
**Deferred, not refused.** `trades` lost TRUNCATE for `anon` and
`authenticated`, the one verb RLS does not govern, because the file was wider
there than the live database. Her tables and the ledger still carry
Supabase's default grant of it, file and live alike, and no API the key
reaches serves TRUNCATE: PostgREST and realtime have no such verb, and both
roles are `nologin`. Revoking it everywhere is one statement and a
`verify.sql` row, for a door nothing opens.
**Revisit if:** anything comes to run SQL as `anon` or `authenticated`, or a
table of hers is ever found readable by the key.

### R-99 — skipping the bootloader's check of the app on every waking
**Why refused:** the bootloader hashes the whole 2.18 MB app on every deep-sleep
wake (ESP-IDF's option to skip it then is off), a fraction of a second
at most per errand and under a milliamp-hour a day by the October 2026
estimate. Skipping it gives up the one check that tells a corrupted slot from a
good one, which is what lets the rollback fall back to the app that was.
**Revisit if:** the board's own measurement shows a waking's boot is a share
of the battery worth naming.

### R-100 — her voice sent to the charm as Opus rather than raw pcm
**Why refused:** pcm needs no decoder on the board and joins end to end across
parts. Opus would cut the bytes about twelvefold, but the radio is on for the
whole playback either way, since she is played as she arrives, so the battery
barely notices; it would add a decoder, its stack, and a frame format to keep.
**Revisit if:** her voice is heard stuttering on a slow network.

### R-101 — reconnecting after a network lost mid-conversation
**Why refused:** a network lost once joined takes her to the lock screen, the
no-internet mark saying why, and the next waking joins afresh, the network she
was last on asked first. Rejoining in place would be a second join path beside
`net.c`'s, for a drop the next press repairs in a couple of seconds.
**Revisit if:** drops mid-conversation turn out common on the networks she
lives on.

### R-102 — keeping a recording the network could not take, to send later
**Why refused:** a turn of conversation answered minutes late is not the
conversation he started, and keeping it means flash writes and a queue to drain
and expire. A network already given up is not recorded into at all, so what
is lost is a turn said while she was still joining and the join then failed.
**Revisit if:** he says a turn lost that way mattered.

### R-103 — TLS sessions resumed across sleep, the last DHCP lease restored
**Deferred, not refused.** Each waking makes a fresh TLS handshake to each door
and asks DHCP from the start. Resuming a session needs it kept in RTC memory
through sleep; restoring a lease writes it to flash. Each would shorten an
errand by a part of a second, unmeasured against the radio's whole waking.
**Revisit if:** the board's measurement puts errands at the top of where the
charge goes.

### R-104 — encrypting her flash
**Why refused:** her Wi-Fi passwords and both keys sit in NVS in the clear, so
a charm in someone else's hands over USB gives them up. Flash or NVS
encryption burns eFuses for good, and a mistake in it bricks the board; the
keys are cut off by changing them in Supabase, which is the README's answer to
a lost charm.
**Revisit if:** a charm is lost on a network whose password cannot be changed.

### R-105 — a dimmer sleep screen, and listening before the screen is up
**Deferred, not refused.** The sleep screen draws its marks at the face's 75%,
and the briefing's dot wanders less than its own width; a dimmer sleep screen
would spare the panel and some charge, at a look he has not seen. A press from
sleep plays the listening notes only after the panel has started, whose board
package alone waits 1.2 s; listening first means the screen starting beside
her recording, a concurrency the firmware does not have today.
**Revisit if:** he has seen the sleep screen on the board, for the first; the
serial log's `lit` and `listening` lines put the panel's start at most of a
press's wait, for the second.

### R-106 — a planted defect for the unexplained-move sentence
**Deferred, not refused, his decision of 22 October.** `SYSTEM`'s *THEN SAY
WHAT IS CARRYING IT* paragraph ships without a plant that proves its case can
see it go. With the paragraph removed, `brief-move-without-a-cause` caught the
removal 1 of 3, 1 of 3 and 0 of 3 in three runs, and 1 of 3 again with the
case handed the wires' headlines and what `web_fetch` returned that morning,
the Fed story told in full: even with the live morning's pull in front of her,
she seldom blames the Fed either way. A plant caught that rarely stops most
eval runs and proves little, so it is out; the case stays, and passes, as a
check that the rule's presence does no harm. `agree.test.mjs` holds the
sentences.
**Revisit if:** a briefing is seen putting an unexplained move on an unread
Fed again; that briefing's own inputs are the case to try.

### R-107 — telling her the stop history settles a widened stop
**Why refused:** `SYSTEM` says the row cannot tell a widened stop from
slippage, and on 16 October she told him nothing between a stop's first
sighting and the close was kept. That was true then. R-02 has read
`trade_stops` since v1.28, her own suggestion, and the rules table in the
cached prefix says so: a case asking whether the system can tell the two
apart, put to the prompt as it stands, passed in run 41. A sentence the eval shows she does not need is a sentence the
gates must keep and the eval cannot plant.
**Revisit if:** she is seen saying again that a stop's moves are not recorded.

### R-108 — one helper for the once-a-day reads
**Why refused:** `storeTrend`, `storeFlows` and `storePositioning` open on the
same two lines, a stored copy read and returned when it is from today in New
York. A helper would forward a door name to `readStored` and compare one date,
and each store's own shape, what counts as an answer and what is kept, is the
part that differs. Two lines read where they are.
**Revisit if:** a fourth once-a-day read arrives, or the day's boundary moves
for one and not the others.

### R-109 — medium-rated releases on the weekday calendar line
**Why refused, his decision of 24 October:** Sunday's briefing named Friday's
flash PMI as the week's test, and Friday's said no US release was rated high,
which was true: TradingView rates the flash PMIs and Michigan medium. The
weekday slot lists high alone, as R-19 and R-20 count, and one that surprises
earns its place in the next morning's story. Adding medium works against the
simpler briefing he asked for the same week.
**Revisit if:** he asks for a release by name on its day.

### R-110 — the R-20 critic case's plant
**Deferred.** The plant that removes the critic's R-20 paragraph was caught 3
of 3 in runs 31, 32 and 37, then 2 of 3 and 1 of 3 in runs 39 and 40, after
its criterion was clarified to pass a sentence taken out with nothing in its
place. The rule is live and the case passes; what weakened is the proof that
the case would see the rule go. Firming it changes no behaviour of hers, so it
waits for him.
**Revisit if:** a run catches it 0 of 3, or he asks.

---

## 3 · THE NEXT STEP — DECIDED

The step the owner calls *Raptor 3* was reviewed with him in October 2026,
after 2.5 had run live, and nothing in it is deferred. Each item below is
decided and reopens only on the condition it names. Asked "what is pending",
the answer is this section: nothing, until one of those conditions is met.

- **One rules module for the app and Eugenia — kept as two copies.**
  `journal.ts` copies the app's break-even band, sessions and three P&L rules —
  about 60 lines, held by two
  tests: one reads the copies, the other runs both over the same rows. Sharing
  a file saves roughly 110 lines net, but the app's script is a classic one and
  cannot import, so it changes how the app boots, and with it `boot.mjs`, the
  type check and the golden snapshot. And it trades a drift CI catches before a
  deploy for one it cannot: two deployed files, a fresh page beside a cached
  module, disagreeing on his phone. Her win rate differs on purpose — null when
  nothing is decided, and rounded — and a shared module keeps that difference.
  **Reopen if** the row-for-row test in `agree.test.mjs` ever finds the copies
  apart for a reason that is not a bug in one of them.
- **Every move in §2 — each reviewed, each standing.** The nine `CLAUDE.md`
  refuses stay refused. R-9 is built beside `npm test` as `test/db`. R-15 stays
  measured and refused; R-16 is settled outright; R-11, R-12, R-13 and R-17
  stand on their reasoning. Each reopens only on its own **Revisit if**, one at
  a time, with the owner's sign-off.

Looked at in the same pass and NOT on this list:

- **Section placement** — whether each function sits under the right banner in
  `index.html` and `doji-eugenia/index.ts`. No test can judge it, and a sweep is
  churn in two four-thousand-line files, with load order at stake in the first,
  for readability alone. A block is placed when it is next touched.
- **The CSS.** About 1,500 lines of `index.html`, worked over while the journal
  was built: every colour is a token on `:root`, and no class is declared that
  the markup and script do not name. What repeats is a one-line rule beside
  each component, which grouping would move away from it. No test sees a pixel
  (§1), so any pass is a device check by a person for a saving nobody needs.
- **One cron job for both watchers.** pg_cron runs a job's statements in one
  transaction, so a raise in one watcher would roll back the other's report.
- **Cutting a part of Eugenia.** Every optional secret is set, so nothing of hers
  is dead, and a cut stops her doing something. If one is ever wanted,
  `eugenia_runs` and his feedback taps say which parts earn their cost.
- **Dropping the email path.** The settled P&L with swap arrives only by email:
  deals carry no swap, and cTrader's position details report zero swap and
  commission even when commission was charged. Deriving it from balance changes
  is ambiguous across overlapping positions and transfers, and would need a probe
  and weeks of both paths running side by side before anything is deleted.
