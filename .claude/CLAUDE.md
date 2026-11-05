# CLAUDE.md — working context for Doji

This file is subordinate to `docs/README.md`. The README is the contract for how the
app behaves; this file is how to work on it, and holds only what the README does
not. Where the two disagree, the README wins and you say so.

`docs/REFACTOR.md` is the register: every move considered and REFUSED, with the
reasoning that decided it, what no test reaches, and what was deferred. Read it
before proposing a simplification — most of what looks like duplication here
has already been looked at.

Doji is a personal XAUUSD trading journal: one `index.html`, one flat namespace,
**no build step, no bundler**. Four writers share one Supabase table — the app,
`doji-mcp-sync` (the cTrader poller), `doji-email-sync` (the write behind the
Apps Script's Gmail parse) and `doji-gladys` (the Telegram journal bot). Journal
columns and broker columns never meet; the whole design rests on that. Eugenia
(`doji-eugenia`) owns only her own tables; `doji-tradingview` writes only its own
sign-in row.

**A function is named after who it is** — `doji-gladys`, `doji-eugenia` — and so
are its secrets: `GLADYS_BOT_TOKEN`, `EUGENIA_BOT_TOKEN`. `TELEGRAM_CHAT_ID` is the
one value the two bots share. The ingestion functions and `doji-tradingview` are
named for the channel they read.

---

## Standard of work

Every change is:

- **Minimal in surface, complete in effect.** The smallest edit that fully solves
  the problem — then finished: state, render, storage, sync, styles, README,
  tests. A change that leaves the README untrue is not done.
- **Elegant, not clever.** Match the surrounding idiom, naming, spacing and
  comment register. Never import a new pattern or abstraction into a file that
  already has one.
- **Free of wrappers and indirection.** No function that only forwards; no options
  object for one caller; no abstraction for a case that does not exist. A helper
  used once is inlined — unless exporting it is what makes a decision testable,
  which is why `balanceTarget`, `foldHours` and `staysOpen` exist.
- **Free of dead code.** No commented-out blocks, `TODO`, stubs or placeholder
  branches. Retiring something deletes it *and* its CONFIG entry, CSS, README
  paragraph and every call site, in the same pass.
- **Free of archaeology.** A removal leaves no trace. No comment for what used to
  be there, no test named after a thing that no longer exists. Comments explaining
  *why the current design is what it is* are wanted.
- **Free of defensive padding.** Guards belong where untrusted data enters. Check
  the schema before writing one — a `NOT NULL DEFAULT` column cannot arrive null.
  Never `try/catch` a symptom away.
- **Single-sourced.** One decision, one place: `CONFIG.BE`, `CONFIG.PERIODS`,
  `Data.OWNED`, `resultOf`, `money()`, `byKey` and the shared primitives each
  exist so a rule changes once. That includes prose — a fact the README states is
  not restated here.
- **Where a copy is unavoidable, a test holds the copies together.** The README's
  *Facts that live in more than one file* is the list, and `test/agree.test.mjs`
  reads every copy of each. Adding a copy means adding it to both; a copy nothing
  compares is the defect.
- **Load-order safe.** Nothing references anything defined below it at load time.
  New code goes in its own section, under the right banner.
- **Efficient by structure.** Renders are O(trades) because `Data.index()` builds
  both lookups in one pass. Never scan `Data.rows` inside a loop — use
  `Data.byId`, `Data.byDay` or `Data.day(iso)`. A write changes `Data.all` and
  then calls `Data.index()`, which derives `Data.rows` from it.
- **Commented for *why*, never for *what*.**
- **Deployed from `main`, never from a dashboard.** A hand-deployed function can
  differ from the committed one with nothing to reveal it. The SQL stays manual
  on purpose.
- **Dependency-free.** No new libraries in the app: Chart.js and the Supabase
  client are its two, both blocking tags.
  `jsdom` and `typescript` are dev dependencies and neither ships.
- **A workflow names a commit, never a tag.** `.github/dependabot.yml` keeps the
  SHAs maintained, and `agree.test.mjs` holds them.

---

## The rule this project keeps re-learning

**A check you have not proved can fail is not a check.** More than once a clean
result was the tool being broken. Run every new check against a planted defect
and watch it go red before trusting its zero.

**A refactor changes how the code reads, never what it does,** and the two never
share a commit. If a number, a rendered string, a written column or a model's
answer changes, it is a behaviour change with its own commit and justification.
You cannot refactor what you cannot prove you have not changed —
`golden.test.mjs` is that proof.

**The same applies to reasoning.** A conclusion drawn from a value you have just
proved corrupt is worth nothing; state mechanisms you can trace, and if a claim
rests on a number, say which and check it is one you trust.

**A test that supplies the answer cannot discover that the answer is never
produced.** The Telegram bot shipped with a redraw that could never settle while
every test passed, because the tests handed the renderer the flag it should have
derived. Prefer driving the real sequence end to end. And a pure half passing
proves nothing about its call site: where a decision lives in a function no test
can drive, `agree.test.mjs` reads the call.

---

## Tests — two commands, and run them

```sh
npm ci        # once — jsdom and typescript, and nothing else
npm test      # 878 tests, nine suites
npm run test:db   # schema.sql on a real Postgres, the major version Supabase runs
```

Node 22.22.2+ (jsdom's floor), stated in `package.json`'s `engines` and enforced
by `engine-strict=true` in `.npmrc`; a cloud session gets it from the
session-start hook (README, Tests). The script globs `test/*.test.mjs` one level
deep, so a test in a subfolder silently would not run — except `test/db`, on
purpose, which needs a server and has its own command and CI job. A cloud session
whose network refuses `apt.postgresql.org` cannot install that version; CI is then
the run, and run on any other version the suite's first test is the one that fails.
`boot.mjs` and `gs.mjs` are harnesses, not suites; the README's Tests section says
what each suite covers.

- **`types.test.mjs`** asks a compiler two scope questions — a name used and
  declared nowhere, a name declared and used nowhere — of the Edge Functions and,
  as a separate program, of `index.html`'s script (`appScript()` is the slice
  `boot.mjs` runs, exported so both read one program). Only those two, because
  they cannot go red for a reason that is not a defect; a whole typecheck under
  Node's lib reports facts about the invocation. One planted defect per question
  rides in every program. `Chart` is the browser shim, held against the page
  still loading its script.
- **`golden.test.mjs`** asserts on what the others do not name — every derived
  value and every panel's markup — booted on a frozen clock (`boot({ now })`,
  frozen before the script runs, since `View.heatmap` reads the clock at load).
  Regenerate with `GOLDEN=write npm test` only in the commit that changes
  behaviour, with the reason in the message. Its fixtures earn their place by
  mutation; the pair entered and closed in opposite orders is the one to keep in
  mind. It sweeps `Dates.session` around all four DST changeovers. The same
  rules hold `golden-fold.json`: what the poller, the email path, the calendar
  fold and Eugenia's rules and stats make of the real captures, with the poller's
  two windows applied as it applies them — fold every position in a capture and
  the closing half of an earlier trade reads as an open one.
- **Two branches of `session()` decide nothing, and a test says so.** London, New
  York and an Asian centre are never open together, and Sydney is never open with
  London without Tokyo, so `MARKETS.sydney` cannot change what `session()`
  returns. It stays: `isOpen(tokyo) || isOpen(sydney)` is a true statement about
  the world, and the test that would notice the domain shifting reads it.
- The golden snapshot captures `innerHTML`, the DOM re-serialised, so it cannot
  see two of `esc`'s five replacements; a direct test holds those.

Nothing here sees pixels, realtime, auth, or the live database — `verify.sql`
is that check and a person runs it. Nor whether the model still obeys her
prompts: `scripts/eval.mjs` asks that, by hand, with `--plant` first; a prompt
change is run through it before and after. Say so on any visual change. State on handback what was verified by running, what by reading, and
what could not be verified, and end every handback with what is still pending —
his to do and yours — so nothing open goes unsaid.

---

## Domain rules that constrain the code

- **`README.md` is the contract.** Update it in the same pass if a change makes
  any part of it untrue.
- **Reuse the shared primitives** (README, *The shared primitives*). Never
  hand-roll a component, never write a literal colour; Chart.js gets its colours
  through `cssToken()`.
- **No renderer mutates state.** A test compares the rows before and after render.
- **The snapshot is a read cache and nothing else**: painted on open, never
  written back.
- **Broker sync never overwrites journal fields.** `Data.OWNED` is the whole list a
  save sends, enforced in one place; deletes are a soft `deleted: true`.
- **A wrong direction, P&L or date cannot be fixed in `index.html`.** The app does
  not own those columns; the fault is in the poller or the email path.
- **`size_oz` is poller-only and the account is derived from it**: `size_oz × 500`
  is what the sizing implies, never the balance and never labelled as one. The
  email boundary stays at five columns.
- **Arbitrated columns use a filter inside the UPDATE**, never a read-then-write:
  `balance`, `planned_sl` and `planned_tp` (one PATCH per column, each on its own
  `is null`), `fill_time` (the email's; the poller stamps a close only under
  `where fill_time is null`), `best_price`. `direction` is last-write-wins and safe
  only because both sources read the opening deal. A PATCH filtered to nothing is
  a 200 with an empty body, so any meter beside one counts rows returned under
  `return=representation` — `agree.test.mjs` reads for the header.
- **Open is both witnesses null** — `exit_price` and `fill_time` — via the exported
  `isOpen`. Either column alone has reported closed trades as open.
- **What the poller cannot repair is `net_pnl`**: the email owns it, and a row it
  never stamped carries the folded figure with no swap.
- **`null` is not `no`**, and the journal asks whether the stop and target were
  *respected*, not moved.
- **Two scales on one endpoint.** `get_spot_prices` and `get_trendbars` serve
  PIPETTES; `get_positions` serves display prices. `PIPETTES` and `fromPipettes`
  are applied to the spot and bar reads only; a test holds the asymmetry. Use the
  range form of `get_trendbars`.
- **The plan is as first seen, never as set.** Each side is its own first sighting;
  requiring the pair is what once filed a break-even stop as the plan.
  `positionsBlock` shows whichever half exists and never names the absence.
- **`quoteLine` is the only place a quote becomes words**, with `quoteWindow`
  inside it, and the briefing is handed the price (`marketBlock()`) rather than
  asked to fetch it. `agree.test.mjs` reads `readMarket` and `marketBlock` for
  `quoteLine`. `foldSpot` yields null for an unreadable price, and
  its type says so — never force a null through `as number`. `aroundList` computes
  no change at all.
- **Eugenia never holds the broker token**; the market read goes through
  `doji-mcp-sync`. `agree.test.mjs` asserts she reads no `CTRADER_` credential,
  matching the read rather than the mention.
- **`ALLOWED_TOOLS` is what stands between this system and a placed trade.**
  `DESTRUCTIVE_TOOLS` names the five the broker serves on the same credential, and
  a test asserts none is reachable, and that no permitted name goes uncalled.
  `doji-tradingview` derives its banned set from the captured listing.
- **The poller's two windows are different questions** (README). A fold without
  its entry deal is held back by `sliced`, judged against `get_positions` read
  after the deals; the row it leaves is `exit_price is null` on a closed trade.
  Repairs are `?force=1&hours=N`, which overwrite hand corrections in the window.

---

## The Telegram journal

- **Never decide whether a message settles off its keyboard.** An open form and a
  reopened one both draw four rows; only the row as it stood *before* the tap can
  tell them apart — `staysOpen`.
- **The two redraws a tap sets off decide the same thing.** `answered(before)` in
  `postAnswer` and `staysOpen` on the tap path are one expression against one
  before-state; `agree.test.mjs` reads `postAnswer`'s body for it.
- **The trigger compares with `is distinct from`, never `<>`.** These columns are
  three-state; `<>` is NULL against an unanswered one and the `WHEN` never fires.
- **The `COLUMNS` map is the whole guarantee.** It holds the four names of
  `Data.OWNED`; `tg_message_id` is on neither list. `agree.test.mjs` holds both
  lists, and both lists in `trades_telegram_on_answer`, against each other.
- **`callback_data` stays under 64 bytes**: it is the entire state a tap needs.
- **`Deno.serve` is guarded so a test can import the module without serving**,
  which is also why shared primitives live in `_shared/edge.ts`. `serve.test.mjs`
  hands the guard a stub that keeps the handler, in its own process because
  `edge.ts` reads its environment once, at first import.
- **Do not extract the entry point.** All five functions authorise their callers
  in the same four lines, and that stays readable in the file being edited.

---

## Eugenia

### What she may never do

- **The prohibitions in `prompt.ts` are the product.** Never what to do with a
  position he holds, and nothing about direction unasked while he holds one, are
  enforced by nothing but the sentences, so `agree.test.mjs` reads for them in
  `SYSTEM`, `CRITIC`, `TRIM` and `TRADE_EVENT`. The gates need them as much as
  the writer: they REWRITE and run last. `CONSOLIDATE` inherits `SYSTEM`.
- **A forward level lives in a filed call and nowhere else.** Her calls are paper
  trades on his rules — `callProblem` refuses one off them before `make_call`
  files it — scored on price at night by `scoreCall`, every doubt against her.
  Both gates keep a filed call whole and never change its numbers; `make_call` is
  in `CHAT_TOOLS` and in no other set. `agree.test.mjs` holds the sentences and
  the sets. `TRADE_EVENT` keeps the flat ban.
- **A chain's last link is mechanism, not a view** — `MECHANISM`, one block
  `SYSTEM`, `CRITIC` and `TRIM` interpolate, held by `agree.test.mjs`.
  "So gold is a harder sell" stays while he is in a trade; which way gold goes
  from here does not.
- **Her read is fenced, not banned**: labelled as hers, with what would prove it
  wrong, no level, and none unasked while he is in a position. All four halves
  live in `SYSTEM`, `CRITIC` and `TRIM`, and both gates are handed
  `positionsBlock()` to judge the last. A printed level is a fact, never in the
  paragraph with her read. A plan he has not taken is checked when he asks, in
  two halves — the rules §7 marks `journal`, and R-08's sequence, judgment rules
  she now judges — and ends in whether she would take it; the levels stay his.
  `agree.test.mjs` reads each half's citations against the table.
- **Her read record is judged by the test she stated, never by where price
  went**, and it is hers: never on the trade look, never cited to him as a
  reason to believe a read. Her calls are the one thing price judges, and their
  record goes where the read record goes.
  `agree.test.mjs` reads the sentence in `CONSOLIDATE`, `record_read` and
  `SYSTEM`, and the trade look's absence.
- **The verdict is not optional**: stated in `SYSTEM`, given room in the briefing
  slot, added by `CRITIC` when missing and never cut for length.
- **The prompt states no preference of his.** A real one belongs in an
  instruction note, the channel he can correct. `agree.test.mjs` reads for the
  taste and for a rule propped up with *and he has told you so*.
- **She is not a writer to `trades` and must not become one.** One database read
  of the journal through `eugenia_trades`, no write path in the file.

### How she writes

- **The briefing is prose.** Numbered sections are a report however plain the
  words. The calendar slot is the one relaxation — times and names, `NAMED AND
  NOTHING MORE`.
- **The briefing is four lines, and its why is one line with no chain** — his
  shape, of 26 October; the teaching lives in conversation. The calendar slot
  forbids mechanism and `CRITIC` holds the same rules; `agree.test.mjs` reads
  both, since the critic runs last and once grew every briefing back.
- **Length is safe only beside what to cut.** A ceiling alone cuts whatever is
  longest. `agree.test.mjs` reads the writer's copy and the critic's for the count
  AND the protection.
- **`WRITING` holds the sentence rules, once, and three read it** — `SYSTEM`,
  `CRITIC`, `TRIM`; `agree.test.mjs` asserts all three interpolate it. Rules that
  need judgement carry a worked example, because a model matches an example where
  it ignores an adjective — check a new example against the rule it sits beside.
  The countable rules are asked for as a count, last, in both gates.
- **The real-rate chain is exempt from the rung**, stated in both copies.
- **`CRITIC` restates several prompt rules**; changing one without the other has
  the critic undo it. `agree.test.mjs` holds each pair.

### Her memory

Six lifetimes — turns, notes (three `kind`s, `commitment` held against his
trades rather than obeyed), channels, the thesis and the portrait, loops — plus
the calendar, her record, and `strategy.ts`, which she cannot write.

- **The strategy rides the cached prefix** (summary, index, rules table) and the
  rest is `get_strategy`. It is markdown in a template literal: every backtick is
  escaped. `readStrategy` names a section it does not hold, and falls back one
  level for §4.1/§4.2; `agree.test.mjs` resolves every citation and checks a
  dotted one names a heading in what came back. §2 and §3 are not his and use the
  spoken channel names. Step 4 of R-08 is readable only off a row carrying the
  plan; do not read 1:1.5 and a realised 1:1.25 as a pair of floors.
- **The cache window is derived from the tool array**: `1h` for `CHAT_TOOLS`,
  `5m` for the rest. Do not move a window on an argument; `wrote_1h` and
  `wrote_5m` are what decide it.
- **`superseded_by=is.null` on `readNotes` is the whole of retirement**, and the
  write is filtered the same way. Column, filter and tool parameter agree.
- **The windows stay small; `search_memory` reaches past them.** The lexical arm
  is the floor, fused by reciprocal rank, never a weighted sum. `embed()` throws;
  the three write paths and the search swallow it, the `?embed=1` door does not —
  `agree.test.mjs` counts both sides. `foldVectors` refuses a short or mis-sized
  answer whole. The embedding model is pinned in the file. `source` is `note`,
  `you` or `him`, a vocabulary shared with `searchList`.
- **Every read of a growing table carries a limit and takes the newest rows.**
  Select newest-first and reverse, as `recent()` does. `agree.test.mjs` refuses
  `order=id.asc` under a limit.
- **`notesBlock()` reaches every path, `portraitBlock()` all but the trade
  look, `channelsBlock()` the three that teach, `recent()` everything that
  speaks** (not the nightly pass), `positionsBlock()` four.
  The trade look's reads sit after its early returns. `agree.test.mjs` reads every
  body, and asserts the absences too.
- **Loops close.** `readLoops` takes the newest ten, so a loop that cannot close
  fills the window. A question unanswered for a week closes; a watch does not. The
  briefing asks nothing; the reply path keeps its questions — `agree.test.mjs`
  reads both directions.
- **Only the nightly pass moves a rung** (`set_channel` is in
  `CONSOLIDATE_TOOLS`, not `CHAT_TOOLS`), a demotion included, and the loop
  refuses a tool outside the caller's set. `/channel` is his override, through
  `setChannel`, where the `unseen` guard lives. `PITCH` is defined once and
  interpolated into the cached prefix and §0; `agree.test.mjs` asserts it is in
  `SYSTEM`. **A prompt rule gated on a state that cannot recur is the shape to
  look for.**
- **`/notes` is answered from the database**, addressed wholly to him, and a
  failed channel read costs the reply.
- **What is stored is the raw turn**, never the augmented one, and the gated
  callers store what the gate returned. `openOnUser` repairs a window opening on
  an assistant turn; nothing may depend on `HISTORY` being even.
- **`TradeRow` is a copy of the view's column list**, held by a test. A summary
  inherits the detailed read's guarantees: `journalStats` counts `settled` and
  `fellBack`. `journal.ts` is a copy of `index.html`'s arithmetic, held by shape and by
  running both over the same rows.
- **`tradesQuery` and `writeNote` are boundaries**: clamp and truncate, never
  throw mid-turn.

### Her senses

- **The calendar is filed from TradingView by `fileCalendar`, keyed on its id.**
  One write may create a row, and nothing she can call writes to it. A filter
  value goes out as `encodeURIComponent(value)` and nothing else — PostgREST
  takes a top-level `eq` whole. An absent figure is left out of the row, never
  sent as null. Rows go up grouped by the columns they carry.
- **The calendar reaches abroad; his rules do not.** `wanted` keeps what she
  asked for by kind, judged against the whole captured catalogue in
  `tradingview-abroad.json`, and `CALENDAR_COUNTRIES` asks for nothing else.
  Every rated read filters on `HOME` but the Sunday week — `agree.test.mjs`
  finds them rather than listing them.
- **The market, its weeks, the Fed's odds, the flows and the speculators' count
  are read ahead** by the quarter-hourly job into `eugenia_market`, as
  `readsDue` spends TradingView's daily quota, and the blocks read the copy:
  nothing that runs on a writer's clock reads those doors. One writer, so the market's
  read-then-write cannot race; `agree.test.mjs` holds it and the census of
  market reads.
- **Her map of his charts is folded in `structure.ts`**, from bars the poller
  serves on `CHARTS` — one list in `_shared/edge.ts` for both. The poller serves
  bars; what a bar means to his rules is hers. It is her map, never his, every
  figure printed, and in the briefing it is for the call alone — `SYSTEM` and
  `CRITIC` each hold that, and `agree.test.mjs` reads both. The market reads are
  derived from the URL constants, so a fourth door is held the day it arrives.
- **The functions meet over HTTP, so both halves of a door are held.** Every
  `?flag=value` one function or script sends another is read in the callee, and
  every `tvRead` name is a door `doji-tradingview` opens: a flag the poller does
  not read falls through to its sync. What each door but the quote answers is
  read by `serve.test.mjs` the way she reads it, the real handlers serving her
  readers — a fixture typed beside a reader cannot see a key renamed at the
  door.
- **`CAL_BACK`/`CAL_AHEAD` carry the 08:00 briefing past tomorrow's 10:00**, read
  and write alike; `fold.test.mjs` derives the reach from the source.
- **The trade event is a close alone** — an open does not call her, and an
  "opened" event returns before any read. It decides from data before any model
  call and returns first for a trade not filed today. The close trigger uses
  `is distinct from` and a transition guard.

### Checking his rules

- **`adherence.ts` is pure and its rule set is §7's `Evaluable` column**, read out
  of the document by `fold.test.mjs`. `unknown` is never `pass`; an empty
  population is `unknown`. **Assert on the counts and `ids`, not the verdict.**
- A close with no instant is `unknown` in R-10, R-11 and R-15; two sizes in a day
  is no account. `CLOSEOUT_MIN` and `STRETCH` are named because they are readings
  rather than facts. The holiday calendar is computed. R-01's scratch exclusion
  uses `BE` from `journal.ts`.

### The jobs, the clock and the meters

- **`dueNow` composes the clock-driven schedules** and a test walks every hour of
  a week through it. `retryDue` answers *which* briefing; `briefKind` answers the
  `?force=1` door, and `agree.test.mjs` reads `postScheduled` for the call. **A
  literal that is right by accident of another function's range is the shape to
  look for.**
- **The calendar's quarter-hourly door is not in `dueNow`.** Its flag is written
  in its cron job's URL and in `postScheduled`; `agree.test.mjs` holds both
  directions, with the doors a person opens declared.
- **Both halves answer before they work** (`background()` +
  `EdgeRuntime.waitUntil`), because of Telegram's redelivery and the 150s request
  idle timeout behind the 400s paid wall clock. `?embed=1` is the derived
  exception. The body names the job.
- **`eugenia_runs` is where the meters survive.** Every `recordRun` key is a column
  and every column is written; both outcomes, always — but `unread`, failures
  only, whose success is the row of the run it fed. `postConsolidation` has
  exactly one `return`, and the census stays after the pass. `postScheduled`'s
  catch writes its row before the apology. `caller` is free text.
- **`gate` is one function.** Every outcome records a verdict row before it
  returns, each window bounded at the previous `return`. `keepDraft` is relative to
  the draft, with `TRIM_MOST` as `TRIM`'s ceiling.
- **`SENDS` in `agree.test.mjs` is the census of paths that send**, derived from
  source — speaking, a turn of conversation or text through `say` — and compared
  with a declaration that sets the apology apart; the same shape covers growing
  reads, flags, poller returns and tools. **Ask of any check whether it would
  notice a new sibling arriving beside its subject.** The declarations live in
  `agree.test.mjs`, the one file the symbol check cannot read.
- **The trade event is exempt from `TRIM`**: it rewrites, and a paraphrased rule
  citation reaching him at the day's limit is how a sentence becomes an order.
- **`APOLOGY` is a word per job**, and a failure reaches him, not the console.

### The model call

- **Nothing the tool loop serves may throw**; it returns a sentence, and an empty
  answer is an answer only when something was read. `serve()` answers an unknown
  name with a sentence; a missing `tool_result` is a 400. Dispatch is
  `Promise.all`.
- **A beta flag is a header on a raw fetch**, never a `betas` field.
- **The container is mandatory once web search is in play**; neither tool sets
  `strict: true`.
- **Effort is per caller**; nothing runs `low`. On Opus it rides as an
  effort-only system message (`effortMessages`) under one top-level
  `BASE_EFFORT`, so callers on one array share one cached prefix; the message is
  sent, never stored.
- **`MAX_ROUNDS` is a backstop** at ten, and `TURN_MS` its twin for time — one
  signal per turn, at `pace_line`'s share. `rounds` and `model` are columns; a
  successful turn's `detail` is its client-tool tally. Read `rounds` before
  changing a caller's model.
- **`MODELS` is keyed on the caller's label**, absent means Opus, and only `trim`
  is on Sonnet: its tool array is empty, so it cannot reach the cap. The retired
  release look's failures on Sonnet were confounded with a new tool landing the
  same night and establish nothing about the model. `fellBack` compares against what
  the caller asked for. `fallbacks` rides with Opus alone, header and field
  together. The critic stays on Opus and is handed `CRITIC_TOOLS` (empty) — see
  `REFACTOR.md` R-15.
- **`FAST` is keyed like `MODELS`** and holds `reply` alone: one reply,
  whichever channel carried it. A fast request refused for any reason is sent
  once more at the ordinary speed; `fold.test.mjs` drives both halves.
- **`chunk` is two lookups, not a `max()`**: `lastIndexOf('\n')` is always at or
  past `lastIndexOf('\n\n')`.

### Voice and charts

- Neither is stored as sent; `stamped` appends the clock as a trailing block.
  `STT_URL`/`STT_KEY`, `TTS_KEY` and `EMBED_KEY` are optional secrets, outside the
  boot guard, each guarded where used — `agree.test.mjs` makes that cost
  something.
- **Everything she writes is spoken, with the text as the fallback**, through
  `sayAloud`; `agree.test.mjs` reads it and counts the four call sites, and
  `fold.test.mjs` drives the fallback. There is no length cap and the prompt
  states none; `TTS_LIMIT` is a chunk size. The briefing speaks in a second worker
  (`postSpeak`), stored before the hand-off, falling back to speaking itself.
- `TTS_VOICE` and `TTS_MODEL` are environment and coupled; `TTS_STYLE` and
  `TTS_SPEED` are pinned. The format is `opus`, `audio/ogg`, `.ogg` — mp3 fails
  quietly as an attachment.

---

## The charm

The firmware in `charm/` is C on ESP-IDF, built by the charm workflow in a
pinned image; the README's *The charms* says what it does. Three levels of
proof, and a change says which it rests on:

- **Pure, and driven in `npm test`.** `briefing.c`, `errand.c`, `lift.c`,
  `dns.c`, `ogg.c` and `frames.c` include no ESP-IDF, so `charm.test.mjs` compiles
  them with the host's `cc -Wall -Werror` and drives them against the
  server's own functions and bytes. A decision that can be pure goes in one of these, or a
  new one added to that compile, so a test can drive it; one that cannot is
  read by `agree.test.mjs`, as `awake()` and `journal_ask()` are.
- **Compiled only by the workflow.** Everything else. The build refuses a
  name declared nowhere; `charm.test.mjs`'s census refuses one used nowhere,
  in a file or across a header. A refactor here is only an edit equivalent by
  reading, and the workflow's green build is its proof. Nothing runs ESP-IDF
  locally; push and read the build.
- **Only the board.** Pixels, sound, touch, sleep current, the power chip's and
  the motion sensor's registers, the lift readings, a rollback, the battery.
  The README's *To check on the real board first* is that list, and only he
  takes a line off it.

What a change most often breaks:

- **A sample, a frame or a byte changed is a behaviour change**, its own
  commit — R-33 is the tick that looks foldable and is not.
- **Standby keeps everything, and a restart keeps nothing.** Every waking after
  the first runs on in the same program, so state that belongs to one waking
  is reset where `life()` takes the next (`reporting`, `lit_at`, `woke_at`),
  and a reading that belongs to one moment carries its age (`motion.c`'s
  `kept_t`). The one thing a restart must carry is the update's mark,
  `RTC_NOINIT_ATTR`.
- **A waking ends in `sleep_now()`, from however deep in it**: it jumps back
  to `life()` (`longjmp`), so nothing may hold the display lock or anything
  else across a call that can reach it.
- **Nothing flashes.** What shows first is decided before `light()`, and the
  journal leaves on the dark: `FACE_DARK` goes up before the questions come
  down.
- **PWR is a notification to her task, and nothing else is**: a question only
  looks at it (`ulTaskNotifyValueClear`) and leaves it to be taken, and the
  sleeper says it has woken through a semaphore. `agree.test.mjs` reads all
  three.
- **LVGL is touched from her task under `bsp_display_lock`**, or from inside
  LVGL's own callbacks — the touch, the dial, the face's timer. The power task
  reaches the screen only through the `face_set_*` setters, which write plain
  volatiles the face's timer reads on its next frame.
- **Every copy of a server fact is in the Facts list** — the frames, the
  headers, the briefing's hours and words, the wait, the recording room, the
  update's path, the doors in `net.h`. A new one goes in the list and in
  `agree.test.mjs` in the same commit.
- **A word drawn is a word the font holds.** A new word means `tools/fonts.sh`
  run again; a new file that draws must be added to the font test, which
  finds it.
- **A wall-clock decision waits for `CLOCK_SET`**: before the internet sets it
  the clock reads 1970.
- **Flash `charm-full.bin`, never `charm.bin`** — the workflow checks the image
  holds the app at the first slot's offset, and `agree.test.mjs` holds that
  offset to `partitions.csv`.

## The laptop

`laptop/` is Electron, a fourth runtime, and the README's *The laptop* says
what it does. Three levels of proof, as on the charm:

- **Pure, and driven in `npm test`.** `frames.mjs`, fed `charmFrame`'s bytes,
  and its `Queue`, played against a stream that arrives late and unevenly;
  `art.mjs`; `place.mjs`; and `update.mjs`, whose swap `laptop.test.mjs` runs in a scratch
  folder with `ditto` and `open` stood in for. A decision that can be pure goes
  in one of these.
- **Read.** Every copy it holds of the door or the charm — the header, the
  form, the frames, the face's numbers and colours, the sounds and the ear,
  the wait, the update's path — and the level the workflow's check raises
  its window to, is read out of both by `agree.test.mjs`; `types.test.mjs`
  asks it the two scope questions as its own program.
- **Only the Mac.** The window, the keys, the microphone, the capture, the
  sound, the signature and the update. The README's *To check on the Mac
  first* is what of it he has not yet seen hold, and only he takes a line
  off it. `spaces.m` is the one part a Mac answers in CI: the workflow asks
  the runner whether a raised window took it, beside a panel as the defect
  it must see. A Linux run under Xvfb drives the page and the main process
  against a stand-in door, which proves the sequence and the drawing and
  nothing about macOS; it is built for the change at hand and not kept
  (`REFACTOR.md` R-139).

The key and the door stay in the main process; the page asks for nothing
`preload.cjs` does not name. A face change is a change to the charm's numbers
or to the body's, never to both in one place without the other — the charm's
are held.

## The journal and her memory are backed up from outside the browser

`scripts/backup.mjs`, run daily by `.github/workflows/backup.yml`, beside
Supabase's own daily snapshots, which roll back the whole project; the README
says which repair each makes. The app has no backup of its own.
The paging is the part to be careful with: PostgREST caps a response at its own
`max-rows`, so one read returns a page that looks like a complete archive. The
walk stops on a short page, `readAll` takes its `fetch` as an argument so the loop
is tested, and a refused read throws rather than backing up a blank.
`scripts/health.mjs` beside it asks hourly whether the poller is still running,
for when pg_cron is not; it imports `STALE_HOURS` rather than copying it.

---

## The email path

- **The Apps Script parses and forwards; `doji-email-sync` writes**, and `emailRow`
  is the boundary — five names built into a payload, each type-checked. An absent
  key and a null key mean opposite things under `merge-duplicates`.
- **It holds no account credential, and never will again.** A test asserts the
  sign-in helpers are gone.
- **Three outcomes, not two.** Permanent (unparseable, `400`/`409`/`422`) labels the
  thread; anything else leaves it for the next run.
- **Every 400 marks `sync_health`**, except a body with no `id` — `testSecret()`'s
  probe. `agree.test.mjs` derives the refusal paths and reads the carve-out's
  exact shape.
- **Both broker paths are anchored to real captures that overlap** (position
  577885869). Replace a capture and the comparison moves with it; save a new
  fixture whenever cTrader changes the alert.

---

## The database

- **`schema.sql` is the whole database, and it is applied by re-running all of
  it** — on a fresh project and on the live one. Every statement outside a
  function body is `if not exists`, `or replace`, `on conflict do nothing` or
  guarded by a check, and `agree.test.mjs` holds that shape. **Never write a
  `drop` into it**: a re-run repeats it on the live database; a drop that is
  needed goes in `upgrade.sql`, guarded, and is run by hand. `create or replace
  view` may only append a column, and `create or replace function` may not
  change a return type or an argument list. `npm run test:db` proves an edit:
  fresh, re-run, and main's copy brought forward by `upgrade.sql` must dump
  identically. A new PL/pgSQL function needs a test that
  calls it, or the suite's census goes red.
- **The file is a claim; `verify.sql` tests it.** It is ONE statement, because a
  SQL editor shows only the last statement's result; `agree.test.mjs` counts its
  semicolons. The listings are `diagnose.sql`, whose header count is also held.
  The checks live in the file, not in a database function.
- **Nothing in `verify.sql` may raise on a wrong database.** Ask about a function
  by oid out of `pg_proc` or with `to_regprocedure`, never a written-out signature
  or a `regprocedure` cast; read a public table only through `query_to_xml` behind
  `to_regclass`. Prefer a row that names (`string_agg`) to one that counts.
  `agree.test.mjs` holds what it asks about against every table, policy, index,
  trigger and function `schema.sql` declares, and the count in its header.
- **`revoke ... from public` is not the whole revoke**: `anon` and `authenticated`
  hold `execute` by name. `verify.sql` asks every callable function.
- **Every `security definer` function sets `search_path = ''`**; `agree.test.mjs`
  derives them all.
- **`sync_health` must never break what it watches.** `heartbeat()`
  swallows everything and bounds `last_error` at both ends of its constraint.
  Every completed path marks — the market-closed skip included — and the three
  that do not are declared. `SCHEDULED` separates the poller from the email
  writer.
- **The dispatch ledger captures every `net.http_post`'s request id**; trigger
  sites post into a variable and record behind `exception when others then null`.
  `dispatch_bad` is the one definition of a failed dispatch, and the repeat gate
  counts rows rather than unsettled ones. `reported_by` keeps a lost report from
  settling its rows.
- **`pace_line` speaks before the failure.** Its first hour is derived from
  `retryDue`; it is said once per run; the row is written only where the post
  was made. The ceiling is the 400s paid wall clock, stated once.
  `test/db` drives it from planted rows; `agree.test.mjs` reads its shape.
- **No SQL file reads into a variable with `select … into`**; use
  `x := (select …)`. When the editor refuses a file, read what it actually received
  first — a truncated paste reads as a broken file.
- **Every schedule is in `schema.sql`'s timer section.** `verify.sql` counts the
  jobs and `agree.test.mjs` holds the count.
- **A caller's URL is checked twice**: `agree.test.mjs` reads every
  `/functions/v1/<name>` and project ref in the repository, `verify.sql` asks the
  live trigger. A rename means editing a trigger body and a cron job by hand.

---

## Two names that are one value

Each fails the same way — the wrong spelling reads as empty and something else
happens quietly:

- **`doji_cron_secret`** in Vault, **`DOJI_CRON_SECRET`** in Edge secrets. Postgres
  compares the Vault name case-sensitively.
- **`SB_SECRET_KEY`**, never `SUPABASE_SECRET_KEY`: no secret can be created under
  the `SUPABASE_` prefix.
- **`eugenia_bot_token`** and **`telegram_chat_id`** in Vault, `EUGENIA_BOT_TOKEN`
  and `TELEGRAM_CHAT_ID` in Edge secrets. `verify.sql` asks whether both resolve.

`verify.sql` catches a database-side mismatch and a 503 at boot a secrets-side
one; neither catches a name that is merely *wrong*, so check a new one against
the surface that stores it.
