# REFACTOR.md — the refactoring pass, and what it has cost so far

`README.md` is the contract and `CLAUDE.md` is how to work here. This is neither:
it is the state of one long pass over the code, kept so a session that starts
cold does not re-derive what has already been settled. Where it disagrees with
the README, the README wins and you say so — that has already happened once, and
the entry is in the register below.

---

## 0 · THE ONE RULE

**A refactor changes how the code reads, never what it does.**

If a number, a rendered string, a written column or a model's answer changes, it
is not a refactor. It is a behaviour change, it belongs in its own commit, and it
needs its own justification. The two must never travel together: when a
behaviour change rides inside a refactor there is no way to tell which half broke
something.

The corollary, which is the expensive half:

**You cannot refactor what you cannot prove you have not changed.**

---

## 1 · THE NET, AND WHAT IT CANNOT SEE

`npm test` is the net. `golden.test.mjs` is the part written for this pass —
`CLAUDE.md` describes what it holds and how to regenerate it, and that paragraph
is the one to read before trusting a green run here.

What no test reaches, and what therefore must be stated on any change that
touches it:

| Blind spot | What settles it instead |
|---|---|
| pixels, CSS values | a device pass by a person |
| realtime, auth | a live two-tab and sign-in test |
| the live database | `verify.sql`, run by hand |
| the xlsx export's own output | one manual export |
| retrieval quality | a golden set that does not exist |
| the Apps Script's Gmail half | `gs.mjs` reaches the parser only |
| an Edge Function path no test can drive | `types.test.mjs` for the names in it; the rest by reading |
| whether a prompt still behaves | a red-team set that does not exist |

---

## 2 · THE PROTOCOL, PER MOVE

1. **Name the move** as one entry from the catalogue. If it cannot be named as
   one, it splits into two commits.
2. **Name the reason** — which line of `CLAUDE.md`'s standard of work it serves.
3. **Prove the net covers it** BEFORE changing anything: break the code you are
   about to touch, run the suite, confirm red. If it stays green you have found a
   coverage hole and closing it is now the task.
4. **Check the mutation landed.** This has failed repeatedly. A `perl -0pe`
   interpolates `${...}` even inside `\Q…\E`; a non-raw Python string collapses
   `\\w` to `\w` and matches nothing. A mutation that did not land reports a test
   as passing when nothing was tested.
5. **Make the change.** One move. No drive-by rename.
6. **Verify.** Full suite. Golden snapshot byte-identical — and confirm that by
   re-capturing with `GOLDEN=write` and diffing, not by the run being green.
7. **Commit,** one move per commit, and update the ledger below.

Never batch and verify at the end. The snapshot's value is naming which edit
broke it.

---

## 3 · RISK TIERS

**Tier 1 — free to move.** Pure helpers, formatting, the harnesses.

**Tier 2 — move with the snapshot green.** Render steps, charts, the journal
form, the carousel.

**Tier 3 — named reason, trader informed.** Column lists, vocabularies, the
callback grammar, `Data.OWNED`, view columns, secret names, the cron payload
shape. A rename here is a coordinated change across files no compiler reads.

**Tier 4 — STOP.** Load-bearing designs, each with its reason in the register.

---

## 4 · THE MOVE CATALOGUE

**M1 Rename** · **M2 Inline a single-use helper** · **M3 Extract, only to remove
a real duplicate** · **M4 Single-source a rule** · **M5 Collapse indirection** ·
**M6 Delete dead code** · **M7 Remove archaeology** · **M8 Remove defensive
padding** · **M9 Move code to its correct section** · **M10 Restructure a comment
for why** · **M11 Reshape for efficiency** · **M12 Unify duplicate CSS**

Across runtimes, M4 is impossible without a build step — there the agreement test
IS the fix, not a shared constant.

---

## 5 · THE LEDGER

Every move gets a line, whether it was made or refused.

### Done

| | Move | Proved by |
|---|---|---|
| The supersede write filter had no test | net | 3 planted defects, each landed in executable code |
| The Node floor had two homes | M4 | 3 planted defects |
| The Node floor was enforced by nobody | net | floor at `>=99.0.0` installed clean before, refuses after |
| Golden snapshot | net | 15 planted defects; 4 caught by nothing else |
| Session map swept, not sampled | net | 2 market-hour defects; 2 more proved unreachable |
| Every CSS rule is reachable | net | 4 planted defects, after the scan was wrong twice |
| Every top-level declaration is reached | net | 4 planted defects |
| Unsigned money formatting | M4 | golden byte-identical; 3M-sample equivalence proof |
| Signed money formatting | M4 | golden byte-identical |
| The em dash, 28 sites | M4 | golden byte-identical |
| Soft delete and undo (audit 4.9) | net | 9 planted defects, one reachable only by driving the timer |
| The journal/broker boundary in the database | Tier 3 | 6 planted defects; run against a real Postgres 16 |
| `verify.sql`'s footer counted wrong | net | 4 planted defects |
| The clock built a formatter per call | M11 | measured: 460ms → 53ms per render at 400 trades, golden byte-identical |
| `journalStats` had both faults at once | M11 | measured: 411ms → 1.2ms over 400 rows, output deep-compared against the old module |
| `sessionBars` filtered once per session | M11 | golden byte-identical; the sessionless row now has its own test |
| No colour is written in the script | net | 3 planted defects, plus a comment that must NOT fail |
| A door existed that the README did not name | net + doc | 2 planted defects, both directions |
| Vendor coupling (9.3) | read: three libraries pinned, two hashed, the third's absence documented; the two font hosts were not written down and now are |
| `nyTime` named two different output shapes | M1 | output already pinned by a test asserting the card's line |
| Three copies of the screen-reader-hiding rule | M12 | golden byte-identical; dead-rule scan still clean. PIXELS NOT VERIFIED |
| The write-failure block, twice | M3 | golden byte-identical; helper proved red two ways |
| The tool loop had 32 catch blocks and no execution test | net | every tool driven against four kinds of refusal; proved red on four handlers losing their catch |
| Fourteen lines of the prompt were stated twice | M6 | removed; a guard on both prose files proved red on each |
| The ten blocks had no execution test | net | driven against four refusals AND against success; proved red six ways |
| Twenty reads of her tables, hand-written | M3 | −29 lines; a guard NAMES the three functions allowed to call fetch directly. **AND IT SHIPPED ONE BROKEN READ** — see §7 |

### Open

**Phase 0.2 — pure-logic goldens.** `Dates.session` has one. `foldPosition`, the
email parser and `adherence.ts` do not.

**Phase 1C — five of the eight have now run, and all five are clean.**

| Check | Result |
|---|---|
| render complexity (7.7) | linear in trades, measured 200 → 3200 rows. No nested scan — it surfaced the CONSTANT instead, three ledger rows above |
| defensive padding (7.9) | fourteen `try`/`catch`, every one at a boundary — browser storage, network, the database — or render's documented per-step isolation. No guard on a column the schema says cannot be null |
| empty states (7.6) | no trades at all, and one trade with no P&L and no journal: no render errors, nothing printing NaN or undefined, the dash where it belongs |
| primitive reuse (7.3) | two `new Chart` sites, both legitimate — `mountDonut` and the equity line. Zero literal colours in the script; the rule now has a test |
| CSS rules (7.2) | zero dead, after the scan was wrong twice |

Three left, and none of them blocks a move:

| Check | Gates |
|---|---|
| doc coverage, code → doc | the maintenance doors are now held by a test; whether every feature has a paragraph is unrun |
| doc coverage, doc → code | RUN. Four stale claims, every one a COUNT — `CLAUDE.md`'s seven facts against a table of twenty-seven, the README's three calling cron jobs against four, and a Vault-spelling paragraph naming two trigger functions where `verify.sql` asked about one. That last was a check the database had never been asked; it is row 61 now. Two enumerations inside `verify.sql` went with them, neither able to fail loudly. Two claims came back CLEAN and were counted wrong by a first scan before reading settled them: the nine hour-formatters, and `backup-memory.mjs`'s seven tables |
| soft delete and undo (4.9) | DONE — see the ledger |

**Phase 2 — archaeology.** The dead-code scans are built and both answer zero.
The prose pass found one: the rough-edges entry announcing the old tables were
dropped, which is a tombstone for a resolved item and had been wrong about what
introspection returns since 005. A resolved rough edge is removed, not kept.

**Phase 3 is CLOSED.** Money formatting and the em dash were folded; the New
York clock and newest-first ordering are refusals, R-11 and R-12. Both were
counted as duplication and are not: one is five different questions with the two
shared ones already single-sourced, the other is five reads that differ in table,
select, filter and order column, already held together by a test that names none
of them.

**THE WHOLE REPO HAS NOW BEEN SWEPT, not just the client.** Every scanner was
proved against a planted defect before its zero was believed:

| Check | Scope | Result |
|---|---|---|
| declared and referenced nowhere | every `.ts`, `.mjs`, `.gs` | 0 — the two Apps Script hits are Run-menu entry points |
| duplicated code blocks | every source file | 1 outside `doji-eugenia`, refused as R-13 |
| duplicated PROSE | `prompt.ts`, `strategy.ts` | 1 — fourteen lines, removed, now guarded |
| SQL objects nothing references | all nine numbered files | 0 |
| per-call `Intl` construction | every runtime | fixed in the app and `journal.ts`; `checkRules` measured at 33ms over 400 rows and left |
| CSS rules never emitted | the stylesheet | 0 |

`doji-eugenia/index.ts` HAS NOW BEEN REACHED, net first and fold second. The
twelve tools and the ten blocks are driven against four kinds of database
refusal and against a database that answers; then twenty hand-written reads were
folded into `readRows`, and a guard NAMES the three functions still allowed to
call `fetch` directly — `readRows` itself, `fillEmbeddings`, which needs
`content-range` off the response, and `healthBlock`, where a 404 is a supported
state rather than a failure.

The guard found six reads the fold had missed on its own: they threw the generic
`HTTP ${status}` rather than the named form, so the grep that found the first
fourteen never saw them.

**Phase 4 is CLOSED and found nothing.** Fifty-eight top-level functions in the
client, twenty-eight called exactly once — and every one of those is a render
step, a shell builder or a named primitive, which is the architecture rather than
indirection. One short single-use helper, `modalOpen`, and it is a named
predicate over three modal ids that reads better than what it replaces. Zero
destructured-object parameters in the client and zero in the Edge functions; the
only one in the repository is `boot({ now })` in the harness, which has many
callers and one optional named argument.

**Phase 5's load-order half needs no scanner.** A top-level reference to
something declared below it throws while the script evaluates, and two hundred
tests evaluate that script through `boot()`. The rule is enforced by every one
of them.

**Phases 4 to 7** — indirection, naming and section placement, comment register,
Tier 3 structural moves. Not started.

---

## 6 · THE REJECTED REGISTER

Every move considered and NOT made, so a tempting one is not re-proposed every
few months and eventually waved through on a tired afternoon.

Nine of them are already refused by a rule `CLAUDE.md` states, and are named
here rather than argued: the reason belongs in the document every session reads,
once. Two of the nine WERE argued here as well, in the same words — R-3 and
R-10 — and a reader of either file had no way to know the other existed. The
prose guard cannot see that shape: it reads within a file, by exact line, and
this was an argument restated across two.

| Move | Refused by, in `CLAUDE.md` |
|---|---|
| R-1 — splitting `index.html` into modules | no build step, no bundler, one flat namespace |
| R-2 — single-sourcing the setup vocabulary | where a copy is unavoidable, a test holds the copies together |
| R-3 — deleting `MARKETS.sydney` | the two branches of `session()` that decide nothing, and why the entry stays |
| R-4 — reordering the branches of `sessionOf` | the same paragraph: the order of the first two is unobservable |
| R-5 — collapsing the poller's two windows | which positions get written and which deals get read are different questions |
| R-6 — making the offline snapshot writable | the snapshot is a read cache and can never be anything else |
| R-7 — deciding a Telegram redraw from the keyboard | never read whether a message should settle off its keyboard |
| R-8 — moving a `drop` into an earlier numbered SQL file | a re-runnable file may not undo a later one |
| R-10 — regenerating `golden.json` to make a red run go away | regenerate deliberately, never to make a red run go away |

The five below are refused by something no other document holds, so they carry
their reasoning here.

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
effort holding the bag.

**Revisit if:** the critic's effort is ever raised to the briefing's — then the
prefix is genuinely shared and the array is worth revisiting in the same pass.
Not before, and never on the argument alone: the numbers above took one morning
to collect and the argument took a fortnight to look wrong.

**And the shape to carry away:** the request field that broke this was not the
one the change touched. A cache key spans every field that renders ahead of the
breakpoint, so "what else differs between these two calls" is the question, not
"what did I change".

### R-9 — a database test in `npm test`
**Why refused:** `npm ci` installs jsdom and nothing else. The one assertion that
wanted a database — whether a BEFORE trigger's write needs a column grant — was
answered on a throwaway Postgres and written down instead.
**Revisit if:** a second and third such question appear.

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

What the row was actually worried about is already treated. The guard finds
every `rest/v1/…?select=` in the file rather than naming its subjects, and
asserts each carries a limit and none orders `id.asc` under one — proved by
planting a new read of each shape and watching both go red. A read added
tomorrow is covered without anyone remembering to add it.

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

What decides it is that the move finds nothing. Four and a half thousand lines
is hard to hold in one head and easy to lose a helper inside, which is a real
cost — but it is a cost paid by a reader, and every defect found in this file
was found by reading it with a question, not by its being shorter. Against that:
load-order safety is free in one file and stops being free across five, and
`agree.test.mjs` reads function bodies out of one string in some thirty places,
every one of which would have to learn to read a directory. That is days of
careful work on the checks themselves, which is the worst thing to be editing
for a reason that is not about what they check.

**Revisit if:** the file gains a second subject — something that is not Eugenia
answering, remembering or being scheduled — or a second function needs one of
its blocks. Not on length alone. And if it ever happens, the entry point stays
where it is, guarded, for the reason `CLAUDE.md` gives.

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

---

## 7 · THE RULE THIS PASS KEEPS RE-LEARNING

`CLAUDE.md` states it: a check you have not proved can fail is not a check. This
pass has confirmed it five more times — the golden snapshot failed on its first
run for a reason unrelated to the app, the CSS scan reported a clean file twice
while broken, and twice a mutation meant to prove a test silently did not land,
so the test "passed" against an unmodified file.

Its twin, for this pass:

**A refactor you cannot prove changed nothing is a rewrite you have not admitted
to.**

And the sharpest instance of the rule this pass has produced, which arrived
after it: folding twenty hand-written reads into `readRows` left `turnsSince`
calling `res.json()` on a `res` that no longer existed. The suite went green,
the deploy went green, the change was read — and the nightly pass then died with
`res is not defined` at 22:00 and again on the 23:00 retry, which is the whole
of her memory not growing for a day, reported to him twice by her own apology.

**Every one of those three green signals was about something else.** The tests
drive what is exported and pure, and `turnsSince` is neither; the deploy bundles
without typechecking; and a reader comparing twenty near-identical call sites is
the exact task a reader is worst at. The defect was not subtle — it was one word
that no longer referred to anything, which is a question a parser settles in
under a second and which nothing in this repository had ever asked.

So the twin has a corollary. **A refactor's blind spot is not the hard cases; it
is the cases nothing executes.** Twenty call sites, nineteen driven by something
somewhere, and the one that was not is the one that broke. `types.test.mjs` asks
the parser now — narrowly, and proving on every run that it can still answer.
