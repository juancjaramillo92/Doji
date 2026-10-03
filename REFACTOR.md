# REFACTOR.md — what was refused, and why

`README.md` is the contract and `CLAUDE.md` is how to work here. This is the
REGISTER: every move considered and turned down, with the reasoning that decided
it, so a tempting one is not re-proposed and eventually waved through on a tired
afternoon. A refusal has no code to attach itself to, which is why it needs a
document. Read §2 before proposing a simplification.

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
| the xlsx export's own output | one manual export |
| retrieval quality | a golden set that does not exist |
| the Apps Script's Gmail half | `gs.mjs` reaches the parser only |
| an Edge Function path no test can drive | `types.test.mjs` for the names in it; the rest by reading |
| whether a prompt still behaves | a red-team set that does not exist |

---

## 2 · THE REJECTED REGISTER

Nine are refused by a rule `CLAUDE.md` states, and are named here rather than
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
| R-8 — moving a `drop` into an earlier numbered SQL file | a re-runnable file may not undo a later one |
| R-10 — regenerating `golden.json` to make a red run go away | regenerate deliberately, never to make a red run go away |

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

## 3 · WHAT IS STILL OPEN

None of which blocks anything:

- **Pure-logic goldens.** `Dates.session` has one. `foldPosition`, the email
  parser and `adherence.ts` are covered by `fold.test.mjs` and by nothing that
  would notice an unnamed output changing shape.
- **Doc coverage, code to doc.** The maintenance doors are held by a test and
  the doc-to-code direction has been run; whether every feature has a paragraph
  has not.
- **Section placement.** Never swept. The comment register was swept once, in
  the pass that cut every comment to its *why* and proved each file
  token-identical afterwards; placement is the judgment half that pass left.

