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
| doc coverage, both directions | the documentation phase |
| vendor coupling | nothing — an ops pass, do it when convenient |
| soft delete and undo (4.9) | DONE — see the ledger |

**Phase 2 — archaeology.** The dead-code scans are built and both answer zero.
The prose pass has not run: a paragraph describing a removed thing is the same
defect as a commented-out block.

**Phase 3 — two duplication rows left.** The New York clock, in six files across
four runtimes: audit which copies share a runtime, because only those are a real
M4 and the rest keep their agreement test. Newest-first ordering, five reads.

**Phases 4 to 7** — indirection, naming and section placement, comment register,
Tier 3 structural moves. Not started.

---

## 6 · THE REJECTED REGISTER

Every move considered and NOT made, so a tempting one is not re-proposed every
few months and eventually waved through on a tired afternoon.

### R-1 — splitting `index.html` into modules
**Why refused:** requires a build step. No build step, no bundler, one flat
namespace is a stated design decision.
**Revisit if:** the trader decides to take a build step, recorded as a decision.

### R-2 — single-sourcing the setup vocabulary
**Why refused:** three copies across three runtimes; impossible without a build
step. The agreement test is the treatment and it exists.
**Revisit if:** never, on current architecture.

### R-3 — deleting `MARKETS.sydney`
**Why refused:** it is dead by measurement — walked at fifteen-minute resolution
across a year, Sydney is open without Tokyo at 5,112 instants and never once
while London is open, so it cannot change what `sessionOf` returns. Deleting it
was queued as ordinary dead-code work and is refused on looking at what it costs.

Two reasons, and the second is the one that decides it.

`isOpen(tokyo) || isOpen(sydney)` is a true statement about the world: it asks
whether any Asian centre is open. Reducing it to Tokyo would make the code say
something less true, adopted for no reason except an accident of four hour
tables that DST moves twice a year.

And the deletion takes a live sensor with it. The test asserting Sydney reaches
nothing reads `MARKETS.sydney` to ask the question — remove the entry and the
test goes with it, so the day London's open moves earlier or Sydney's close
moves later, nothing says so. One line in two files is a poor price for the
thing that would notice the domain shifting under the code.

**Revisit if:** that test goes red, which is the event that makes the term live
again — and then it is not dead code at all.

### R-4 — reordering the branches of `sessionOf`
**Why refused:** unobservable. London, New York and an Asian centre are never
open together, so the order of the first two branches decides nothing. A move
that changes nothing is not worth the diff, and a test now pins the property so
the day it stops being true is not silent.
**Revisit if:** that test goes red.

### R-5 — collapsing the poller's two windows
**Why refused:** which positions get written and which deals get read are
different questions. Collapsing them restores the re-fold corruption.

### R-6 — making the offline snapshot writable
**Why refused:** it is a read cache, painted before the token check and the fetch
answer. Writing it back makes a stale render authoritative.

### R-7 — deciding a Telegram redraw from the keyboard
**Why refused:** an open form and one reopened with `[Edit]` draw the same four
rows. Only the row as it stood before the tap tells them apart.

### R-8 — moving a `drop` into an earlier numbered SQL file
**Why refused:** a file carrying a bare `create table` is run-once; one without
is re-appliable. Tidying a drop backwards lets a re-run undo a later file.

### R-9 — a database test in `npm test`
**Why refused:** `npm ci` installs jsdom and nothing else. The one assertion that
wanted a database — whether a BEFORE trigger's write needs a column grant — was
answered on a throwaway Postgres and written down instead.
**Revisit if:** a second and third such question appear.

### R-10 — regenerating `golden.json` to make a red run go away
**Why refused:** a golden file regenerated on failure costs what it always cost,
reports green, and proves nothing. Regeneration is `GOLDEN=write npm test`, in
the same commit as the behaviour change, with the reason in the message.

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
