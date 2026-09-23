# CLAUDE.md — working context for Doji

This file is the context a Claude Code session starts from. It is **subordinate
to `README.md`**: where anything here disagrees with the README, the README wins
and you say so. The README is the contract for how the app behaves; this file is
how to work on it, and it holds only what the README does not — every
description of behaviour lives there, once.

`REFACTOR.md` is the third document and the only one that is a record rather
than a rule: what one long pass over this code changed, what it left open, and
in §6 every move considered and REFUSED. Read that register before proposing a
simplification — most of what looks like duplication here has already been
looked at, and the register is what stops a refused move being re-proposed every
few months and waved through on a tired afternoon.

Doji is a personal XAUUSD trading journal: one `index.html` of ~4,000 lines, one
flat namespace, **no build step, no bundler**. Four writers share one Supabase
table — the app, and three Edge Functions: `doji-mcp-sync` (the cTrader poller),
`doji-email-sync` (which writes what the Apps Script parses out of Gmail) and
`doji-gladys` (the Telegram journal bot). Journal columns and broker columns
never meet; that single idea is what the whole design rests on. Eugenia, the
market bot, would be the fifth writer and is not: she owns only her own
conversation and her own notes.

**A function is named after who it is** — `doji-gladys`, `doji-eugenia` — and so
are its secrets: `GLADYS_BOT_TOKEN`, `EUGENIA_BOT_TOKEN`. `TELEGRAM_CHAT_ID` is
the one exception and earns it, being the only value the two bots share. The two
ingestion functions are named for the channel they read, which is the only thing
that distinguishes them.

---

## Standard of work

Every change is:

- **Minimal in surface, complete in effect.** The smallest edit that fully
  solves the problem — then actually finished: state, render, storage, sync,
  styles, README, tests. A change that works but leaves the README untrue is not
  done.
- **Elegant, not clever.** Read the surrounding code and match its idiom, naming,
  spacing and comment register. A patch should be indistinguishable from the code
  it lands in. Never import a new style, pattern or abstraction layer into a file
  that already has one.
- **Free of wrappers and indirection.** No function that only forwards to
  another. No options object for a one-caller call. No abstraction for a second
  case that does not exist yet. A helper used once that adds no clarity gets
  inlined — unless exporting it is what makes a decision testable, which is why
  `balanceTarget`, `foldHours` and `staysOpen` exist.
- **Free of dead code.** No commented-out blocks, no `TODO`, no stubs, no
  placeholder branches, no rule whose effect is already the default. When
  something is retired, delete it *and* its CONFIG entry, its CSS, its README
  paragraph and every call site — same pass. CSS comments and `id` attributes
  count.
- **Free of archaeology.** A removal leaves no trace it happened. No comment for
  what used to be there, no test named after a thing that no longer exists. The
  file reads as though written this way from scratch. (Comments explaining *why
  the current design is what it is* are wanted — the test is whether a new reader
  needs it.)
- **Free of defensive padding.** Guards belong at boundaries where untrusted data
  enters, nowhere else. Check the schema before writing a guard — a
  `NOT NULL DEFAULT` column cannot arrive null. Never wrap something in
  `try/catch` to make a symptom go away.
- **Single-sourced.** One decision, one place. `CONFIG.BE` (±$3, one fill),
  `CONFIG.PERIODS`, `Data.OWNED`, `resultOf`, `money()`, `byKey` and the shared
  primitives each exist so a rule changes once. Never compute the same thing a
  second way in a second spot — and that includes prose: a fact stated in the
  README does not get restated here.
- **Where a copy is unavoidable, a test holds the copies together.** Four
  runtimes and no build step mean a set of facts genuinely lives in more than
  one file. The README's *Facts that live in more than one file* names them,
  and it is the count as well as the list — a number repeated here goes stale
  on the release that adds a row, in a file nothing compares against that
  table. `test/agree.test.mjs` reads every copy of each and fails when they
  disagree.
  Adding a copy of anything means adding it there too, and to that table: a copy
  nothing can compare is the actual defect, not the copy itself.
- **Load-order safe.** Nothing references anything defined below it at load time.
  New code goes in the section it belongs to, under the right banner — not at the
  bottom because that is easier.
- **Efficient by structure.** Renders run in O(trades) because `Data.index()`
  builds both lookups in one pass. Never nest a scan over `Data.rows` inside a
  loop — use `Data.byId`, `Data.byDay` or `Data.day(iso)` — and call
  `Data.index()` after any mutation to `Data.rows`.
- **Commented for *why*, never for *what*.** Match the existing comments, which
  carry reasoning that cannot be recovered from the code. Delete any comment that
  only restates the line beneath it.
- **Deployed from `main`, not from a dashboard.** Never tell anyone to paste a
  function into the dashboard editor: a hand-deployed function can differ from
  the committed one with nothing to reveal it, and every later change is then
  reasoned about from a file that is not what runs. The SQL stays manual on
  purpose. Mechanics in the README's Deployment section.
- **Dependency-free.** No new libraries in the app. Three CDN scripts only
  (Chart.js and Supabase client are blocking tags; SheetJS is fetched on first
  export by `loadXLSX()`). `jsdom` and `typescript` are dev dependencies and
  neither ships. A fourth needs a real argument.
- **A workflow names a commit, never a tag.** A tag is mutable and its owner can
  repoint it between one run and the next; `supabase/setup-cli@v1` was a
  *branch*, in the job that holds `SUPABASE_ACCESS_TOKEN`. Nothing here reads a
  secret it is not given — the credentials are step-scoped — so the reach is the
  toolchain rather than the environment: `setup-node` provides the `node` that
  reads `SB_SECRET_KEY` a step later. `.github/dependabot.yml` is the other half,
  because an unmaintained pin is why people skip pinning; it bumps the SHA and
  the `# v7.0.1` beside it together. `agree.test.mjs` holds the SHAs.

---

## The rule this project keeps re-learning

**A check you have not proved can fail is not a check.** Three times a "clean"
result was the tool being broken rather than the code being clean. The fix every
time is to run the check against a known defect and confirm it finds it *before*
trusting any zero. Do the same for every new test: break the thing on purpose,
watch it go red, put it back.

**And the same applies to reasoning, which is the harder half.** A conclusion
drawn from a value you have just proved is corrupt is worth nothing. State
mechanisms you can trace, not stories that fit. If a claim rests on a number, say
which number and check it is one you trust.

The Telegram bot shipped with a mechanism that was asserted in the code, the
README and a PR description without once being executed — an open form and a
reopened one both draw four rows, so the redraw could never settle. Eighty-two
tests were green throughout, because they called the renderer with a hand-picked
flag instead of replaying the sequence. **A test that supplies the answer cannot
discover that the answer is never produced.** Prefer a test that drives the real
sequence end to end over one that asserts on a function in isolation.

---

## Tests — one command, and run it

```sh
npm ci        # once — jsdom and typescript, and nothing else
npm test      # 565 tests, six suites
```

Node 22.22.2+ — jsdom's floor, above the 22.6 `--experimental-strip-types`
needs, stated in `package.json`'s `engines` and ENFORCED by `engine-strict=true`
in `.npmrc`: without that, `npm ci` installs on any version and the floor is a
note. Six suites, and the script globs `test/*.test.mjs` one level, so a test
in a subfolder silently would not run. `fold.test.mjs` covers the pure logic
of all four Edge Functions, of `_shared` and of `adherence.ts`; `app.test.mjs`
boots `index.html` in jsdom with a recording Supabase stand-in that answers
per-table, so a query for her calendar cannot be served the trades; `agree.test.mjs` holds the duplicated
vocabularies together; `parse.test.mjs` runs the Apps Script in a `vm` with the
Google globals stubbed. `boot.mjs` and `gs.mjs` are the two harnesses, not
suites.

**`types.test.mjs` is the sixth, and it exists because a green suite is not
evidence about a line no test reaches.** The consolidation shipped calling
`res.json()` after the read it wrapped had moved into `readRows` — a free
variable, in a function that is neither exported nor pure, so nothing here could
be driven at it and 473 tests and a green deploy said fine. It runs `tsc` over
the Edge Functions and keeps only the codes that are pure SCOPE facts: a name
used that is declared nowhere, and a name declared that nothing uses. Not a
whole typecheck, deliberately — under Node's lib a `Uint8Array` is not a
`BlobPart`, and without `--strict` a discriminated union stops narrowing, so
most of what a full run reports is a fact about the invocation. **The two
questions it asks cannot go red for that reason, which is the whole basis for trusting a zero
from it** — and it does not rely on that trust either: a file naming something
that does not exist is compiled alongside the real ones on every run, and the
assertion is that THAT was found and nothing else. `typescript` is a dev
dependency, never a build step, and never runs over `index.html`.

**`golden.test.mjs` is the fifth, and it asserts on what the other four do not
name.** They test named things; a refactor breaks unnamed ones — an attribute
order, a class that stopped being emitted, a label whose whitespace collapsed.
It boots the real page against a fixed fixture set on a frozen clock
(`boot({ now })`, frozen BEFORE the script runs, because `View.heatmap` is set
from the clock at load) and compares every derived value and every panel's
markup against `test/golden.json`. Regenerate deliberately and never to make a
red run go away — `GOLDEN=write npm test`, in the same commit as the behaviour
change, with the reason in the message. A golden file regenerated on failure
costs what it always cost and proves nothing.

Its fixtures earn their place by mutation rather than by looking realistic:
three were added because a planted defect stayed green without them, and the
one to keep in mind is the pair entered and closed in opposite orders — an
ordering rule proved by rows that cannot disagree is the audit's own blind spot,
and it recurred here.

It also SWEEPS `Dates.session` rather than sampling it, over six windows chosen
around both US and both EU changeovers, and records the transitions. New York
and London do not change on the same date, so for three weeks a year the
London+NY overlap sits an hour off where it sits the rest of the time — and a
spot check at 14:00 on a Tuesday in July gets the right answer under almost any
mistake in those tables.

**Two branches of `session()` decide nothing, and a test says so rather than a
comment.** Walked at fifteen-minute resolution across a year, London, New York
and an Asian centre are never open together, so the order of the first two
branches is unobservable; and Sydney is open without Tokyo at 5,112 instants but
never while London is open, so `MARKETS.sydney` cannot change what `session()`
returns. It STAYS, and not as pending work: `isOpen(tokyo) || isOpen(sydney)`
asks whether any Asian centre is open, which is a true statement about the
world, and reducing it to Tokyo would say something less true for no reason but
an accident of four hour tables. The deletion would also take this test with
it — it reads `MARKETS.sydney` to ask the question — and one line in two files
is a poor price for the thing that would notice the domain shifting.
Both are accidents of four hour-tables, not decisions, so the test exists to
catch the day one of them wakes up in a commit about something else.

They do **not** cover pixels, realtime, auth or the xlsx export, and nothing
here sees the live database: `verify.sql` is that check and a person runs it. So
a good deal of what a change can break is only caught by reading. You cannot see
pixels; say so on any visual change. The golden snapshot cannot see two of
`esc`'s five replacements either, and for a structural reason rather than a
fixable one: it captures `innerHTML`, which is the DOM re-serialised, so `"` and
`'` come back literal in any text context. A direct test holds those.

---

## Domain rules that constrain the code

- **`README.md` is the contract.** Read it before proposing a change; update it
  in the same pass if the change makes any part of it untrue.
- **Reuse the shared primitives.** `mountDonut`, `wheelBlock` + `paintWheel`,
  `sessionBars` (`.sess-wr-*`), `disciplineBar`, `rollRow`, `--bar-h`,
  `DONUT_CUTOUT` / `RESULT_FILL` / `RESULT_BORDER` / `SEG_BD`. Chart.js cannot
  read a CSS variable, so anything it needs is resolved through `cssToken()` into
  a module constant. Never hand-roll a new component, and never write a literal
  colour — the palette is tokenised, and the README lists every token.
- **No renderer mutates state.**
- **The snapshot is a read cache and can never be anything else.** Painted on
  open, before the token check and the fetch answer; never written back.
- **Broker sync must never overwrite journal fields.** `Data.OWNED` is the
  definitive list — a save sends those columns and nothing else, enforced in one
  place. Deletes are a soft `deleted: true` flag.
- **`size_oz` is poller-only, and the account is derived from it rather than
  stored.** Both broker sources state size in ounces — cTrader sends a volume the
  poller divides by a hundred, the alert email prints `Oz 4.00` — so ounces is
  what the column holds. The email boundary stays at its five columns, so a
  position the poller never reached carries no size, permanently. `latestBefore`
  reads the newest one: the ladder is 0.02 lots per 1,000, so `size_oz × 500` is
  the account the sizing implies, which is not the balance and must never be
  labelled as one.

- **A wrong direction, P&L or date cannot be fixed in `index.html`.** The app
  does not own those columns; the fault is upstream in the poller or the email
  path. Say so rather than looking for it in the app.
- **`fill_time` HAS ONE WRITER AND IT IS THE EMAIL, WHICH IS NOT WHAT ANYTHING
  READING IT ASSUMED.** The poller never sets it, on any row; what it records
  when a position closes is `exit_price`, off the broker's own deals every two
  minutes. So a close with no alert email behind it leaves `fill_time` null for
  ever — and everything that read that column as "still open" said so for ever.
  `positionsBlock` told him he had a buy open days after he closed it, citing
  R-19 and R-15 at him about it; R-10 ran the phantom to `now` and failed every
  trade taken after it; R-15 dropped those rows out of its population in
  silence. Open is now BOTH columns null — two witnesses, either sufficient,
  the shape `balance` and `direction` already use — and `isOpen` is exported
  because the filter was the half no test could reach: `positionsList` is pure,
  was driven from both sides for its whole life, and renders correctly whatever
  it is handed. THE ROOT IS FIXED AT THE POLLER NOW: it writes
  `fill_time` off the `closedAt` it already computes for `balanceTarget`, under
  `where fill_time is null`, so the email still owns the column wherever it
  lands. The trigger that sets off is the POINT rather than a side effect — that
  transition is how she learns a position closed, and it had never once fired.
  Only rows the fold window reaches are stamped, so the historical gap needs
  `?force=1&hours=N` and is opt-in; on a close event `postTradeEvent` reads the
  day's standing first and returns silently unless R-11 was breached, so a
  backfill is quiet rather than a burst. WHAT THE POLLER CANNOT REPAIR IS
  `net_pnl`: the email owns that alone, `pnl` is `coalesce(net_pnl,
  computed_pnl)`, and a row it never stamped carries the folded figure with no
  swap in it.

- **Two columns have two claimants, and their arbitration differs.** `balance`
  is settled by a filter inside the UPDATE (`where balance is null`); `direction`
  is last-write-wins, and is only safe because both sources read the side off the
  opening deal. Anything else in `trades` has exactly one writer.
- **`null` is not `no`,** and the journal asks whether the stop and target were
  *respected*, not whether they were moved. Both halves of that trip people up.
  Column lists and the full account are in the README's Data model.
- **Two scales on one endpoint, and neither is documented.** `get_spot_prices`
  serves PIPETTES and `get_positions` serves DISPLAY prices, on the same account
  and the same symbol. `PIPETTES` and `fromPipettes` are named once and applied
  to the spot read alone; applying them to a position price puts the stop at
  four hundredths of a cent, and a test holds that asymmetry in place. Both were
  established by probe — `?market=raw` and `?positions=1` — because the
  documentation says "DISPLAY price (not pipettes)" about INPUTS and nothing
  about outputs. `get_trendbars` also documents a `count`-only call it refuses;
  the range form is what works.

- **THE PLAN IS BROKER-OWNED NOW, AND `where planned_sl is null` IS THE WHOLE OF
  IT.** §8 called the plan unrecoverable and was right about a CLOSED position,
  where the final stop has overwritten the original; nobody had asked about an
  open one. `get_positions` carries `stopLoss` and `takeProfit`, the poller
  records both the first time it sees a position, and every write after the first
  would file R-04's break-even stop as the plan — which is the filter, the same
  arbitration `balance` uses and the second-ever use of it. Say **as first
  seen**, never as set: up to two minutes separate the entry from the poll that
  caught it. `planned` IN THE ANSWER COUNTS ROWS WRITTEN, NOT CALLS MADE, which
  it did not: with a position open it read 1 every two minutes, and a working
  filter, one that had stopped filtering, and a row the upsert had not yet
  reached all looked identical — the meter could not see the failure it sits
  beside. `return=representation` is what makes the count answerable, since a
  PATCH filtered to nothing is a 200 with an empty body; dropping the header
  reads as a permanently quiet poll, so `agree.test.mjs` reads for it. It looks forward only, which is why §7's `Evaluable` column did NOT
  move — a rule is `journal` when a row can answer it, and almost no row carries
  this. §10's shut door is still shut: what was retired is *journalling* a plan,
  and he types neither column.

- **The price is HANDED to the briefing and is a tool everywhere else, and
  `quoteLine` is the only place a quote becomes words.** Every other thing the
  briefing always needs is read before the call; the price — its opening line —
  was a tool she had to remember to reach for, which is an instruction standing
  where an input belongs and fails the way instructions here always fail: a
  level off a search page is four digits and looks like gold. One rendering for
  all three callers, with the window sentence inside it rather than beside it,
  because a quote said three ways is three chances to print `change` without
  saying what it changed from.

  AND A TYPE THAT LIED DEFEATED THE ONE GUARD THE DESIGN DESCRIBES. `foldSpot`
  yields null rather than NaN for a price that will not parse, and says in its
  own comment that a null is something the caller must handle — then declared
  `prev_close` and `change` as `number` and forced them through with
  `as number`, with `marketQuote` casting a second time on the far side. So the
  state the function goes out of its way to produce was invisible to every
  caller and to `tsc`, and `quoteLine` read it exactly as the comment says it
  must not: `${null}` is the text "null", `null >= 0` is TRUE, and
  `Math.abs(null)` is 0. A broker read with no `sessionClose` opened his
  briefing with *against a previous close of null — up 0 since it* — both
  halves of a confident sentence about the market, wrong. The bid and the range
  are still worth having, so the MOVE goes rather than the quote, and she is
  told not to reconstruct it. `change_pct` was deleted rather than made honest:
  it crossed the wire, sat in two interfaces and was asserted in tests, and
  nothing had ever read it.

  `quoteLine` HAD NEVER BEEN EXECUTED BY A TEST, only read for a substring —
  which is how a line every briefing opens on carried that for its whole life.
  Both branches are driven now.

  AND THE WINDOW IS INSIDE THAT RENDERING RATHER THAN BESIDE IT. `high`, `low`,
  `prev_close` and `change` are all measured from the BROKER'S session open,
  which for gold restarts at the 17:00 New York roll — so the SAME `change` is
  the overnight move before that hour and the evening's after it. Served as bare
  JSON it read as "on the day", and she said so at 20:57 about a session under
  four hours old. Nothing here can see the calendar day; `get_trendbars` rolls on
  the same boundary, so `quoteWindow` NAMES the window rather than computing one
  out of numbers that cannot carry it, and `agree.test.mjs` reads `readMarket`,
  `marketBlock` and `postMove` for the call — dropping it breaks nothing and the
  message still reads as a working price.

- **Eugenia reads a price through the poller and must never hold the broker
  token.** The endpoint that serves a quote also serves `create_order`, so the
  market read goes through `doji-mcp-sync`, which will only ever answer with a
  quote, and she presents the cron secret she already has. `agree.test.mjs`
  asserts she reads no `CTRADER_` credential and addresses no broker host —
  matching the READ rather than the mention, since the comment explaining why
  she does not hold it names the secret.

- **`ALLOWED_TOOLS` is what stands between this system and a placed trade, and
  it should be read that way rather than as configuration.** `?tools=1`
  established that the broker's endpoint also serves `create_order`,
  `close_position`, `amend_position`, `amend_order` and `cancel_order`, on the
  same credential. Every name in the array carries `readOnlyHint: true` on the
  broker's own listing; `DESTRUCTIVE_TOOLS` names the five that do not, and
  `agree.test.mjs` asserts none of them is reachable through the list or around
  it by a direct call — and that a permitted name nothing calls fails too, since
  that is the shape a destructive one would arrive in. The credential is the
  better place for this guarantee and is not where it lives; a read-only token
  would retire the array.

- **The poller's two windows are not the same question** — which positions get
  written, and which deals get read. The README explains why the fold window is
  wider. What it does not carry, and you will need for a repair: the signature of
  a row folded without its entry deal is **`exit_price is null` on a closed
  trade**. Repairs are `?force=1&hours=N`, and a forced backfill overwrites a
  manual DB correction.

---

## The Telegram journal

The README carries the account of how it behaves. These are the constraints on
code you write near it:

- **Never read whether a message should settle off its keyboard.** An open form
  and one reopened with `[Edit]` both draw four rows. Only the row as it stood
  *before* the tap can tell them apart — that is `staysOpen`, and getting it
  wrong shipped a bot whose message could never settle.
- **`Deno.serve` is guarded so the test can import the module without serving.**
  That guard is also why the shared primitives live in `_shared/edge.ts` and not
  in one of the functions: importing a module that serves at its top level would
  start that function inside the caller.
- **Do not extract the entry point.** All four functions authorise their callers
  with the same four lines, and that is the one shape that must stay readable in
  the file being edited rather than behind a helper.
- **The `COLUMNS` map is the whole guarantee.** It holds the same four names as
  `Data.OWNED`, so no broker column is nameable from a tap. `tg_message_id` is
  on neither list and must stay off both. `agree.test.mjs` asserts the two lists
  against each other, and both column lists inside `trades_telegram_on_answer`
  against them, rather than each against a literal; do not widen any of them
  without widening it.
- **`callback_data` must stay under 64 bytes.** It is the entire state a *tap*
  needs — no session table, no schema change on that path — and a longer setup
  name is the way it would silently overrun.
- **The two redraws a tap sets off must decide the same thing.** A tap writes,
  so it fires `trades_telegram_on_answer` as well as redrawing the message
  itself, and the trigger's redraw is the one that lands. Neither may decide
  from the writer: `answered(before)` in `postAnswer` and `staysOpen` on the tap
  path are one expression against one before-state, which is why the second edit
  comes back `message is not modified`. Change either and a form reopened with
  `[Edit]` shuts under the correction being made in it — `agree.test.mjs` reads
  `postAnswer`'s body for that call, because nothing in the suite can drive it.
- **That trigger compares with `is distinct from`, never `<>`.** These columns
  are three-state and `<>` is NULL against an unanswered one; a `WHEN` clause
  that is not true does not fire, so the first answer to every question would be
  the one redraw that never happened.

---

## Eugenia

### What she is, and what she may never do

- **The prohibitions live in `prompt.ts`, and they are the product.** No signals,
  no verdict on a trade, one question at a time. The line she may cross is narrow
  and deliberate: *what the market is pricing* and *what would surprise it* are
  facts about today and are hers to say; what price will do never is. Widening
  that is a product decision, not a prompt tweak.
- **The briefing is prose and must stay prose, with ONE relaxation that is his
  and is written down.** Numbered sections with headings are a report however
  plain the words inside them, and reintroducing scaffolding to "organise" the
  prose is still the move to refuse. The CALENDAR slot is the exception: a bold
  day label and one line per item, because he read a draft of it beside the prose
  and the list was the half that was instantly readable. It holds times and names
  — `NAMED AND NOTHING MORE` — and no mechanism, which is the rule the reshape
  had to carry across and nearly did not.
- **ONE CHAIN PER BRIEFING, AND IT IS A BREADTH RULE RATHER THAN A LENGTH ONE.**
  Every scheduled thing that matters still gets named — he needs the week — but
  only one gets its mechanism walked. Nine subjects each carrying a clause of
  chain is a survey, and it drifts there because every clause looks justified on
  its own. It took two stored instruction notes failing to land to find it: the
  notes were read every turn and outranked by `cut words and never events`, which
  had no carve-out for them. The round-up slot now forbids mechanism outright,
  and `CRITIC` holds the same rule — `agree.test.mjs` reads both, because the
  critic runs last and a rule loosened in one place is a rule it puts back every
  morning.

- **LENGTH IS A RULE AGAIN, AND IT IS ONLY SAFE BECAUSE OF WHAT SITS BESIDE IT.**
  A flat ceiling was tried and it decided she could not teach: with channels at
  `unseen`, where §0 says build the term before using it, there is room for four
  paragraphs of market OR three plus a build-up, and one ceiling chose the first
  every morning. **A ceiling on its own is what failed, not a ceiling** — asked
  to be shorter with nothing saying WHAT to lose, she cuts the teaching block,
  because it is the longest thing on the page. So 250–300 words, 400 at the
  outside, and beside it a fixed ORDER of what comes out: numbers he cannot act
  on, then levels he can read off his own screen, then any market sentence that
  could have been written on any morning. Never the teaching block, never an
  event. Still over means the briefing is about too many things. Four thousand
  characters remains the separate mechanical bound and it is Telegram's.
  `agree.test.mjs` reads BOTH halves for the count AND for the protection,
  because a copy holding the count alone reproduces exactly the failure the
  count was removed for the first time.

- **WHAT WAS MISSING WAS A BOUND ON A SENTENCE, NOT ON A WORD.** Everything here
  governed word CHOICE — plain words first, `the gap between rates and inflation`
  before `real yields` — and nothing governed how many ideas one sentence could
  carry. So a briefing built entirely of plain words still read as hard, and no
  rule was being broken. One idea per sentence, twenty words, no em-dash aside,
  no stacked subordinate clause; no punchline, because a line that is satisfying
  to read and takes a second to decode is a line he reads twice and will not; and
  no COINED SHORTHAND, since a name she invents and then reuses arrives as a term
  he was taught and never was.

  AND THE COUNTABLE HALF LANDED WHILE THE JUDGEMENT HALF DID NOT. The first
  briefing under these rules had TWENTY prose sentences, none over the cap, the
  longest eighteen words, no asides — measured, not eyeballed. In the same
  message: `war premium` used bare, `dearer fuel`, `the basket`, `measured
  inflation`, `stiffer competition`. A gate can count words; it cannot
  adjudicate *is this the plainest word* against an adjective. So the rule that
  could be counted was obeyed perfectly and the rule that needed taste was
  ignored entirely, and that split is what the three repairs are aimed at.

  THE OLD RULE BANNED THE REGISTER IT WAS WRITTEN TO PRODUCE. `NO COINED
  SHORTHAND` forbade inventing a name and reusing it — and his own approved
  draft leans on *the genuine part* three times. Read literally the prompt
  contradicted its own target, which is how a rule comes to be ignored rather
  than followed. SELF-DESCRIBING is the distinction that was meant: *the
  leftover* tells a reader nothing, *the genuine part* tells them everything.
  And the case it actually fails on is not an invented word at all — it is a
  MARKET term used bare, which is every briefing rather than a rare one.

  A WORKED EXAMPLE IS IN `WRITING` BECAUSE NO DESCRIPTION OF THE REGISTER
  WORKED. *Use the plainest available word* had been in these rules for days and
  produced *dearer fuel lifts measured inflation*. A model matches an example
  where it ignores an adjective, and one example in `WRITING` teaches the writer
  and both gates at once. It is the STANDARD rather than a taste of his, which
  is the rule it sits next to — and that adjacency is worth checking against
  before anything else goes in there.

  A PARAGRAPH IS BOUNDED TOO, at three or four sentences. Sixteen easy sentences
  arrived in one unbroken block, which reads as a wall however short each one
  is; his own draft had air between the steps and the prompt had copied the
  sentence rule from it without the shape.

  `WRITING` IS WHERE THEY LIVE, ONCE, AND THREE READ IT. They were in `SYSTEM`
  and restated in `CRITIC` — two copies held apart by a test, which works while
  there are two readers. `TRIM` was the third, and a third copy is where two
  agreeing and one drifting starts. `agree.test.mjs` asserts all three
  interpolate it, because a reader that stops is silent: it still has a prompt,
  the message still arrives, and one of the three is working from an older idea
  of how she writes. THE COUNT OF NUMBERS STAYS WITH THE BRIEFING and the
  principle moved into `WRITING`: four to six is a budget for four paragraphs
  and says nothing useful about three sentences, where what generalises is which
  number earns its place.

- **ONE CHAIN IS EXEMPT FROM THE RUNG AND IT IS THE ONE UNDER EVERYTHING.** Gold
  pays no interest, so it competes with what a bond pays once inflation is taken
  out rather than with the headline rate. `PITCH` says `owns` gets a term bare,
  which is right for every term but this one: it sits under nearly every briefing
  written, and a reader who has lost it has lost all of them. Stated in both
  copies, because the critic is the half that decides a mechanism it can see
  inside one briefing is a repetition — that is the failure that cut the build-up
  `PITCH` had just required, and it would cut this the same way.

- **`CRITIC` restates several of the prompt's rules**, so changing one there and
  not here has the critic undo it; it runs LAST. That is the shape to check
  whenever a prompt rule moves, and `agree.test.mjs` holds each pair together.
- **THE PROMPT STATES NO PREFERENCE OF HIS, AND THAT IS STRICTER THAN SOURCING
  ONE HONESTLY.** It held a taste he had never expressed, in the file that decides
  how she talks to the person it is about — so it reached him as her quoting
  something he never said. A real preference would be in the wrong place too: an
  instruction note is the channel he can correct, `notesBlock()` puts it in front
  of her, and the prompt says notes outrank the shape. A rule worth keeping stands
  on why it is right. `agree.test.mjs` reads the prompt for both halves — the
  taste, and any rule propped up with *and he has told you so*.
- **She is not a writer to `trades` and must not become one.** She reads the web,
  reads the journal through the `eugenia_trades` view, and writes only
  `eugenia_turns` and `eugenia_notes`. The view is granted `select` alone and
  hides `user_id`, `balance`, `commission` and deleted rows — but the grant
  secures the view, not the key, so the guarantee that matters is structural: one
  database read of the journal, no write path to it in the file. Do not add one.

### Her memory, which has five lifetimes

A turn rolls inside a morning. A note about him outlives twenty of those, which
is what `kind` is for. What he UNDERSTANDS outlives both, which is
`eugenia_channels`. `eugenia_thesis` is one row rewritten nightly — a reading
that is only ever current, the opposite of a note and why it is not append-only.
`eugenia_loops` holds what she flagged and what she asked until it closes.
`eugenia_calendar` is both the event spine's input and the only dataset here that
compounds.

- **The strategy is a fourth memory and the only one she cannot write.**
  `strategy.ts` holds it; its retrieval contract splits it — the summary and the
  rules table are appended to the CACHED system prompt, everything else is
  `get_strategy`. Putting it in a message pays for it on every turn and breaks
  the prefix each time the document is edited. It is markdown in a template
  literal, so every backtick in it is escaped.

  THE WINDOW IS DERIVED FROM THE TOOL ARRAY, AND IT WAS THE ROWS THAT DECIDED
  IT. A read is a tenth of the input rate; a WRITE is 1.25× at five minutes and
  2× at an hour — so the longer window moves the break-even from two requests on
  a prefix to three, and a caller that makes one request and is not followed
  inside the hour pays double for a lifetime nothing uses. The tool ARRAY is
  where the cache key starts, so the tool sets are that many separate prefixes,
  none readable by another — which makes *is a second turn likely inside the
  hour* a question about the ARRAY rather than about the caller. A week of
  `wrote_1h` answered it in one shape: every caller's turns equalled its prefix
  writes except the release look, which made fourteen and wrote five, its
  quarter-hourly job clustering several looks into one morning. The briefing is
  08:00 and the pulse is 10:00 — two hours apart — so the hour they were paying
  2× for could never have been read. `RELEASE_TOOLS` keeps it, everything else
  is `5m`, and that loses nothing: the rounds within a turn are seconds apart and
  a read refreshes the five minutes. `cached` was the only figure `ask()`
  collected and it can only ever report the good news; `wrote_1h` and `wrote_5m`
  are the other side, kept apart because their rates differ and their sum is not
  money. Do not move a window off an argument — these rows are what that costs.

  She has no write path to it, deliberately: a document that decides whether he
  followed his rules cannot be edited by the thing checking them. The numbering
  skips 1 and 11 and nothing cites them. `readStrategy` NAMES a section it does
  not hold rather than returning nothing, because the number arrives from the
  model and a blank is a thing she fills in herself.

  §4.1 AND §4.2 ARE PROSE INSIDE §4, and they are the only two citations in the
  half she carries on every turn. An exact lookup told her they were unwritten,
  which is worse than a blank: a wrong fact about her own document from the tool
  that exists to stop her inventing one. `readStrategy` falls back one level to
  the parent, and `agree.test.mjs` resolves every citation through it — asserting
  a dotted one names a heading actually present in what came back, since the
  fallback would answer a mistyped §4.7 with §4 and look identical to one that
  worked.

  §2 AND §3 ARE THE TWO SECTIONS THAT ARE NOT HIS — researched reference rather
  than decisions, labelled as such where they start. Both must use the SPOKEN
  channel names from `prompt.ts`, never the database ids: `agree.test.mjs`
  resolves §2's headings against the names. Everything else in the file is his,
  and a rule he has not stated is a `[decide]` rather than a pattern read as one.

  R-08's four steps are in §6, and step 4 is arithmetic HE runs: nothing records
  where the stop or target were set, so the ratio is asked and never computed. Do
  not read that 1.5 against the 1.25 as a pair of floors — 1:1.5 is a condition
  at ENTRY, and a realised 1:1.25 is the rule working on a shortened target and a
  breach on a $25 one set at entry, which no row can tell apart.

- **A note can be retired, and one filter is the whole of it.** `superseded_by`
  keeps the row and takes it out of the read; drop `superseded_by=is.null` from
  `readNotes` and she is handed the correction AND the thing it corrected, every
  turn, with nothing marking which is current. No error, and a note count that
  looks healthy. Three copies have to agree — the column, the filter, the tool
  parameter.

- **Superseding is what makes the nightly pass safe, not a convenience.** A
  consolidator that can only add is a noise generator: it cannot fix what it got
  wrong last night, and five mediocre notes push five good ones out of a
  twenty-note window. The prompt pulls toward writing almost nothing and toward
  retiring rather than adding.

- **The windows are small on purpose, and `search_memory` is what reaches past
  them.** Twelve turns and twenty notes of each kind are what she is HANDED;
  everything older was always in the tables and never selected. Widening a window
  puts the archive in her context, where every token is paid on every request — so
  the fix for "she cannot remember" is never a bigger limit. `eugenia_search`
  ranks notes and turns together, uses `websearch_to_tsquery` because the query is
  model-written and the strict parser throws on an unbalanced quote, and returns a
  retired note MARKED rather than hidden.

  IT IS TWO ARMS AND THE LEXICAL ONE IS THE FLOOR, not a fallback beside the
  vector. A row whose `embedding` is null does not appear in a nearest-neighbour
  query at all — no error, no log, half an archive quietly unsearchable — and a
  vector is worse than trigram wherever the thing asked for IS the string: a date,
  a ticker, `R-08`. The two are fused by reciprocal rank, never by a weighted sum,
  because `ts_rank` and cosine distance are on unrelated scales and any weighting
  of them is a constant somebody guessed. With no `EMBED_KEY` the query vector is
  null, both semantic arms return nothing, and the fusion over one arm reproduces
  the old ordering exactly.

  A VENDOR THAT REFUSES IS A DIFFERENT THING FROM AN UNSET KEY, and `embed()`
  throws so the `?embed=1` door can say which — a missing credit, a wrong
  permission and a mistyped secret are three different repairs and once looked
  identical. The three WRITE paths swallow it with `.catch(() => null)` and the
  door does not; `agree.test.mjs` counts both sides, because the search's catch is
  the one that is not about losing a row: without it a dead embedding vendor takes
  the LEXICAL arm down too, and she reports a memory she could have searched
  perfectly well.

  `foldVectors` orders the vendor's answer by the index IT states and refuses it
  whole if it is short or the wrong width: a vector filed against the wrong row is
  undetectable afterwards and surfaces months later as her misremembering. THE
  MODEL IS PINNED IN THE FILE, unlike `STT_MODEL` — vectors from two models are
  not comparable, the column type catches a change of width and not one at the
  same width, and the ranking would degrade into noise silently.

  IT ALSO SAYS WHO SAID IT. `role` was on the table and not selected, so every
  turn rendered as `you said` and half of every result set was HIS words handed
  back as hers. The role rides in `source` — `note`, `you`, `him` — because
  `create or replace function` may not change a return type and dropping the
  function takes its grants. Those three words are a vocabulary shared with
  `searchList`'s `SAID` map, and `agree.test.mjs` holds the copies together.

- **Every read of a growing table carries a limit, and it has to take the newest
  rows.** Four hundred trades, twelve turns, twenty notes, two hundred turns for
  the nightly pass. Select newest-first and reverse for reading, as `recent()`
  does. A limit at the wrong end is indistinguishable from a limit at the right
  one until the day it bites — which it has twice: the pass once kept the FIRST
  two hundred turns of a day, distilling the morning and dropping the evening
  where a late instruction lives; and `fillEmbeddings` drained a backlog `id.asc`,
  where the order looks consequence-free because the same rows fill either way.
  What it decides is WHEN. A read whose order "cannot matter" is where to look
  next.

- **Her notes are the only channel he has for correcting her, so `notesBlock()`
  is load-bearing on all SEVEN paths, and the conversation window on the six that
  speak.** An instruction — *"stop mentioning the ten-year"* — is a note, and every
  later message obeys it; the conversation window would forget it by morning.
  Dropping the call from a path fails silently: she carries on ignoring something
  he believes she took, and nothing anywhere reports it. `channelsBlock()` goes to
  the six asked to build a term, and `recent()` stays off the nightly pass, which
  reads its own fixed twenty-four hours. `agree.test.mjs` reads the function
  bodies for all three.

  THE TWO MID-TRADE MESSAGES ARE THE ONES THIS BITES HARDEST. The trade look had
  neither for its whole life, so an instruction he gave was obeyed everywhere
  except the messages that reach him while he is in a position — and its
  R-14/R-19 line fires on exactly the print the morning briefing is likeliest to
  have named, so without the window the sharpest thing she sends arrives as a
  repetition. Both reads sit AFTER its early returns, so an ordinary fill still
  costs nothing.

- **A LOOP THAT CANNOT CLOSE IS THE ONE THAT FILLS THE WINDOW.** `readLoops`
  takes the newest ten and the list was already at ten, so the next loop opened
  pushes the oldest out of what she is HANDED while leaving it open in the
  table — unreachable by the only thing that could close it. The limit is at the
  right end; what it assumed is that threads close at all. Two kinds did not: an
  unexplained move that was noise, fixed at the gate above, and a question he
  never answers. The pass was told to write a NOTE about a week-old question
  instead of closing it, so it wrote one and nothing read it — the observation
  complete and the behaviour missing. A question unanswered for a week IS
  answered; it closes, the note is still written, and a WATCH is untouched
  because age proves nothing about an odd reaction. The briefing reads the same
  list before asking again — and then stopped asking at all.

- **THE BRIEFING ASKS HIM NOTHING, AND THE REPLY PATH IS UNTOUCHED.** The slot
  was there to learn what he holds and over eleven days produced four questions,
  four open threads and no answers: a slot whose only output is an open thread
  measures nothing. The rules that only made sense while it asked went with it —
  the re-asking rule, and `open_loop`'s question half — because a rule about
  re-asking in a file where nothing asks is the dead branch that a later reader
  restores the slot from. SCOPE IS THE HALF THAT MATTERS: cutting questions
  everywhere would take the trade conversation, where one question and then
  silence is the method and where he DOES answer, having started it.
  `agree.test.mjs` reads both directions — a briefing that asks again, and a
  reply that has stopped.

- **`/channel` is the one rung he can move himself, and it had to exist.** The
  ladder climbs on him using a term back, judged at the nightly pass — so a
  reader who takes the briefing and rarely answers it never leaves `explained`,
  which is the rung that mandates restating the mechanism every time. The census
  had no way up. `parseChannel` is exported and pure (the rung is the LAST word:
  three of the five spoken names are several words long), and the write goes
  through `setChannel` so the `unseen` guard and the unseeded-table check are not
  copied. Her own reading of him is unchanged — `set_channel` stays out of
  `CHAT_TOOLS`.

- **`/notes` is his audit, and the whole of it is addressed to him.** Answered
  from the database rather than by the model, so nothing can paraphrase or drop a
  row — and `notesList` renders the channel map itself rather than appending
  `channelsBlock()`, which is written for HER and opens *Where he stands*. The one
  message written to him must not switch into the third person about him. It also
  means a failed channel read costs the whole reply rather than being swallowed,
  which is right here and wrong in the briefing: an audit that silently omits half
  of what it audits is the defect it exists to prevent.

- **What is stored is the raw turn, never the augmented one.** Notes and the
  week's trades are rebuilt every turn; storing them would resend a stale copy as
  history for the next six briefings.
- **The history window is repaired, not assumed.** Pairs are written in one
  INSERT, but a concurrent one can take a sequence value between them, so an even
  window can still open on an assistant turn — which the Messages API refuses.
  `openOnUser` trims to the first user turn; nothing may go back to depending on
  `HISTORY` being even.

### Where he stands on each channel

- **Five rows, never a window, and the only absence this system can see.** Every
  rung carries `moved_on`, the civil day it last moved, formatted in UTC off a
  midday anchor because re-zoning a stored New York date moves it a day back.
  Nothing descends the ladder but him saying he has lost one, so without that date
  a year of use piles every channel at `owns` and the census loses the absence it
  exists to show; a rung months old counts toward the tiebreaker as a low one
  does. A channel he has never once used is a row saying `unseen`, where in the
  notes it is nothing written down and therefore unnoticeable.

- **Subject and register are two questions and the rung answers only the second.**
  The map is a TIEBREAKER between two mechanisms both live today, never a driver
  of what the briefing is about. On REGISTER it drives outright: how much a term
  has to be built before it is used.

  AND THE TABLE THAT ANSWERS THAT WAS NEVER IN FRONT OF HER, WHICH IS WHY WEEKS OF
  PROMPT WORK CHANGED NOTHING. It lived in §0, and §0 below its summary is
  `get_strategy`-only with nothing instructing her to fetch it. What she held was a
  pair of ends quoted in two prompts — build at `unseen`, do not at `owns` — and
  `unseen` is a ONE-WAY DOOR: `setChannel` refuses to write it back, because it
  says a subject has never once come up. So the only build instruction she had
  went unreachable the first time each channel was mentioned, the two rungs
  everything actually sits at had no instruction, and a binary rule over four
  states reads as the other case. She said every term bare, correctly, following
  the rule she was given. `PITCH` is that table, defined once in `prompt.ts` and
  interpolated into the cached prefix AND into §0 the way `SUMMARY` already is;
  `agree.test.mjs` asserts it is IN `SYSTEM` and holds its rungs against
  `CHANNEL_STATES`, where the old test proved a row per rung and nothing about
  whether the rows were ever read. **A prompt rule
  gated on a state that cannot recur is the shape to look for next.**

- **Only the nightly pass may move a rung**, because one exchange is not evidence
  any more than one fill is a pattern — which is why `set_channel` is in
  `CONSOLIDATE_TOOLS` and not beside `remember` in `CHAT_TOOLS`. Closing a loop
  is the same split: opening one is a moment and may happen anywhere, closing one
  is a judgment and belongs to the pass. THE LADDER DESCENDS IN ONE CASE AND IT IS
  NOT HER READING OF ONE: a demotion is something HE said — *"I have lost this"* —
  which is why it is allowed where a promotion from one exchange is not. It lands
  at the pass all the same, and the rung is right before the next briefing, the
  only place it is read. Three copies say this and all three are needed —
  `CHANNEL_TOOL`'s description, the CONSOLIDATE prompt, and §0; the prompt is the
  one whose absence is silent, so `agree.test.mjs` reads it.

- **`unseen` IS UNREACHABLE BY ANY OF IT**, guarded in `setChannel` before the
  write. That rung says a channel has never once come up — history, not
  understanding — and a demotion able to write it would report a channel she
  taught last week as one he has never met, which is the census saying the
  opposite of the truth in the one column it exists for. A channel he has lost
  goes to `explained`.

### What she is handed about his desk

- **`positionsBlock()` IS THE ONLY BLOCK WITH RULES ABOUT WHAT SHE MAY DO WITH
  IT, and that asymmetry is the design.** She sees the full open row — entry, stop
  and target as first seen — so she can answer properly when he raises it;
  unprompted it may only suppress a setup-flavoured line and name a collision his
  OWN rules name (R-14/R-19, R-11). The guard keeping his levels out of a message
  SHE starts is a paragraph in `prompt.ts` with no structural half, so
  `agree.test.mjs` reads the prompt for it: deleting it breaks nothing else and
  the result reads as her being relevant. The failure it prevents is a briefing
  framed around his position instead of around the day.

  AN ENTRY FROM ANOTHER DAY NAMES THE DAY. The line read `open since 09:15 ET`
  under a heading that says what he has on RIGHT NOW, whether the fill was this
  morning or on Monday. Not an edge case: the summary calls his positions intraday
  to MULTI-SESSION and R-15 bounds a hold at the Friday close, not at midnight.
  Today stays bare, or the date is noise on every intraday fill.

  NO UNREALISED P&L, AND THAT IS ONE DECISION RATHER THAN TWO. `eugenia_price` is
  quarter-hourly, so the figure would be the most anchoring number in the block
  and the one staleness gets most wrong; entry and mark go in labelled and she
  subtracts them if asked. The mark is read only when something is open and is
  caught SEPARATELY from the block, so a price she cannot read costs one line
  rather than the position. Six paths, not the notes' five — the move look joins
  because a sharp move is the likeliest thing to arrive while he is in something;
  `postTradeEvent` stays out, being reached from the position it would be told
  about.

  A RUN OF LOSSES IS A TALLY AND A TALLY IS A VERDICT. She may never hand him the
  count — only what the trades have in common, which is the briefing's own rule
  about a cause with no chain under it. A breach of one of his rules is not the
  same thing and is never withheld: that is his document deciding.

- **`TradeRow` is a copy of the view's column list and has a test.** Its own
  comment calls it the row `eugenia_trades` serves, and every rule in
  `adherence.ts` is written against it — so appending a column to the view without
  adding it here leaves columns no rule can name, invisibly. It matters more now
  that `readDesk` asks for `select=*` precisely so the list is not copied a fourth
  time, which makes the interface the only description of what comes back.

- **`tradesQuery` is a boundary, and its window is counted in civil days.** `days`
  comes from the model, so it is clamped and row-limited there rather than
  trusted; the bound is stepped off today's New York date, because `open_day` is a
  civil day and a fixed number of milliseconds is not one. `writeNote` is the
  other boundary: it truncates rather than refusing, because a tool that errors
  mid-turn costs the whole answer.

- **A SUMMARY INHERITS EVERY GUARANTEE THE DETAILED READ CARRIED.** `journal.ts`
  is the app's own arithmetic — the win rate over decided trades, the money split
  on the sign, the averages on the result label, the realised reward-to-risk, the
  session and setup breakdowns — ported so `get_stats` can answer without her
  doing it by hand over four hundred rows. It is a copy of `index.html` with no
  build step between them, so `agree.test.mjs` reads both for `CONFIG.BE`, the
  session names, all four sets of market hours and the SHAPE of the three
  definitions that look identical in every ordinary case and part on one.

  IT SHIPPED DROPPING THE ONE SIGNAL §8 BUILT THE JOURNAL TO KEEP. `pnl` is
  `coalesce(net_pnl, computed_pnl)`, and §8 withholds `computed_pnl` by name and
  serves `net_pnl` beside `pnl` so a fallback row is visible without the unsettled
  number being reachable. A total cannot carry that, and the prompt now tells her
  to prefer the total over the rows — so `journalStats` counts `settled` and
  `fellBack` and says so where anything did. Ask it of every new aggregate: what
  did the read underneath this one guarantee?

### Her senses, which are data rather than a clock

- **The event spine.** The briefing files the day's calendar with `log_calendar`;
  a quarter-hourly cron job (`?release=1`, its own job in `004_cron.sql`) looks at
  anything `high` that has landed
  and is not yet `looked_at`. That column is stamped BEFORE the look, for the
  reason the briefing marker is: a look that generates and fails to write would
  repeat every fifteen minutes, each one billed.

  ONE LOOK PER RELEASE TIME, NOT PER ROW, AND THE DIFFERENCE IS A FEEDBACK
  LOOP. The key is `(at, name)` and the name is free text, so one print arrives
  as four or five rows; each high one fired its own look, and the release look
  holds `log_calendar`, so filing the actual under a slightly different name
  INSERTED a row that was then unlooked and fired in its turn. Five messages for
  one CPI, and the two apologies that surfaced it were duplicate looks
  reconciling against the conversation window rather than her catching an error.
  `dueRelease` is pure and takes the earliest release time with no mark on it;
  `pendingRelease` therefore READS `looked_at` rather than filtering on it, and
  `markLooked` takes every id in the group — that call site is the half no pure
  test can reach, so `agree.test.mjs` reads it.

  AND THE WRITE IS BOUNDED BY THE WINDOW SHE IS HANDED, `CAL_BACK`/`CAL_AHEAD`,
  which is where the duplicates actually came from. She filed four and five days
  ahead against a block that reaches one day, so every morning re-filed the same
  release under wording it could not see and had no way to match. Nothing reads
  past that window, so those rows had no consumer at all. The count of what was
  refused goes back in the tool's answer: a bound she cannot see is one she
  files against for ever.

  `log_calendar` IS THE SECOND BOUNDARY HERE THAT UPSERTS, and it now follows
  the rule `emailRow` already states: an absent key and a null key mean opposite
  things under `merge-duplicates`. One row, two writers, the briefing filing the
  consensus and the release look coming back with the actual — sending every
  column each time erased the comparison the table exists for, invisibly. Only
  what she sent is written, and rows go up grouped by the columns they carry
  because PostgREST refuses a bulk insert that mixes them. It is a second job rather than a
  faster one because every hourly predicate tests `hour ===` — a `*/15` on the
  existing job runs four briefings a morning.

  AND THE LOOK NO LONGER HOLDS THAT TOOL AT ALL, WHICH IS WHERE THE ROWS WERE
  STILL COMING FROM. Deduplicating the LOOK left the WRITE alone: on 16
  September it was handed `US retail sales (August, advance)`, marked that row
  at 12:35:00 and filed the print under `retail sales` at 12:36:15 — an insert,
  because the key is `(at, name)` over a name the model writes. The actual
  landed on a row with no consensus and the consensus stayed on a row with no
  actual. `RELEASE` had said *the same time and name* since the tool was
  written, so this is the instruction-shaped guarantee failing in the file that
  says instructions fail here. `ACTUAL_TOOL` replaces it in `RELEASE_TOOLS` and
  `recordActual` is a PATCH with no insert path at any spelling; it cannot write
  `consensus` or `prior`, which is how that release came to hold two
  contradictory priors. A filter matching nothing is a 200 with an empty body —
  `planned`'s failure exactly — so it reads the names back and says them.

  AND `updated_at` MAY NOT MOVE ON A MARK. `markLooked` writes `looked_at`
  alone, and an unconditional touch made the column say when a row was last
  HANDLED where its own comment claims it says which of two contradictory rows
  is later. On that release it ordered correctly by seventy-five seconds.
  Compared as `jsonb` less the two bookkeeping columns rather than against a
  list of the rest, so a column added later is compared without anyone
  remembering to add it.

- **A trigger on `trades` tells her a position opened or closed**, and the two
  things she may say are both his own rules read back: R-14/R-19 on a print
  pending against an open position, R-11 on a fill that took the day past its
  limit. Never a verdict. Both branches decide from data BEFORE any model call, so
  the common case costs nothing.

  BOTH ARE ABOUT TODAY AND NOTHING CHECKED THAT THE TRADE IS. The trigger fires on
  a transition rather than on a clock, so the row it carries is only today's by
  habit — and anything stamping an old close fires it for an old day, which is how
  two messages arrived reporting August in the present tense weeks later.
  `open_day !== nyDate(now)` returns before either branch, because it is a property
  of the EVENT rather than of what she would have said; placed after the branches
  it is two guards and the second gets forgotten. An overnight hold closing this
  morning is filed under yesterday and is skipped too, which is right: R-11 forbids
  an entry LATER than the breaching loss, and a finished day can have no later
  entry.

  The close trigger compares `old.fill_time is null and new.fill_time is distinct
  from null`; `<>` is NULL there and the one event it exists for would never fire,
  and without the guard the poller's two-minute re-upsert fires it forever.

- **THE THIRD SENSE HAS NO ROW BEHIND IT, WHICH IS WHY IT NEEDS A MARK.** A release
  landing and a position opening are both rows appearing; gold is always there, so
  *it moved* is a fact about the instrument AND a previous reading. `eugenia_price`
  is one row rewritten every quarter hour by its own job (`?move=1`), so the window
  is the gap between firings rather than a number anyone chose.

  Both gates are relative — a share of the session's range, and a share of the
  price — because a fixed dollar threshold means two different things to gold at
  4,400 and at 2,000, and the year nobody revises it the sense fires constantly or
  never; never looks exactly like a quiet market.

  THE FLOOR BOUNDS THE BAR RATHER THAN STANDING BESIDE IT, AND THAT COMPOSITION
  IS THE WHOLE FIX. The share is taken against the BROKER'S session, which
  restarts at 17:00 New York — so for hours every evening the range is small
  because the session is YOUNG rather than because the market is quiet, the share
  stops binding, and the floor used to carry the whole test alone. An earlier
  pass saw that and chose the wrong of two options: it raised the floor until it
  was an event in the thin hours, having reasoned the share was unfixable here
  since nothing spans the calendar day. The third option is to REFUSE TO JUDGE —
  a session with no range yet cannot be measured against, and silence beats a
  lower standard. It cost three open loops in a week, two of which ($13 and $17,
  both just after a roll) could never be closed because nothing had happened. A
  SENSE THAT MANUFACTURES A LOOP IT CANNOT CLOSE IS WORSE THAN A QUIET ONE: the
  loop rides into every briefing after it.

  `MARK_STALE_MIN` stops a move measured across an outage counting as a
  quarter-hour move, and `looked_at` is the one column written conditionally:
  unconditionally, the quiet window never reopens and she says one thing about a
  move and then nothing for the life of the deployment. A move a high-impact print
  explains belongs to the spine and not here, or payrolls reaches him twice in ten
  minutes from two senses saying the same thing. `marketOpen` moved into
  `_shared/edge.ts` when this arrived, because the poller and this ask the same
  question.

### Checking his rules

- **`adherence.ts` is the strategy executed, and the set of rules is not a
  choice.** §7's `Evaluable` column decides it: eight `journal` rules, and the
  eleven `judgment` and `field` ones stay out, because a judgment rule that starts
  reporting `pass` is exactly the "no violations" claim §8 warns is close to
  saying nothing. It is pure — rows in, verdicts out, no clock but the one passed
  in — which is what lets every rule be driven in BOTH directions from a test.
  `unknown` is never `pass`, and an empty population is `unknown`.
  `agree.test.mjs` holds the eight against §7's table.

  A VERDICT IS NOT THE WHOLE ANSWER, WHICH IS HOW R-10 HID A MISCOUNT FOR ITS
  WHOLE LIFE. It compared each span with the one BEFORE it in entry order, which
  is a question about a neighbour rather than about the rule: a multi-session hold
  covers everything opened inside it, so the second trade taken within one came
  back counted as a PASS and named nowhere while genuinely breaching. The verdict
  never moved — a nested span always has a neighbour that overlaps too — so a test
  asserting on `verdict` alone could not have found it. **Assert on the counts and
  on `ids`:** those are what `check_rules` hands him to check, and a breach missing
  from that list is one he cannot see.

  Two numbers in it are decisions rather than facts and are named constants for
  that reason: `CLOSEOUT_MIN` gives §6's "at or very near" the Friday close a
  value, and `STRETCH` gives §5's "Christmas-to-New-Year stretch" one. The holiday
  calendar is COMPUTED, Good Friday and the Saturday observance included — a table
  of dates stops being true the year nobody extends it, and that failure looks
  exactly like perfect compliance.

### The jobs, the clock and the meters

- **Six schedules, three jobs, and `dueNow` picks between the clock-driven four.**
  `briefDue`, `pulseDue`, `retryDue`, `consolidateDue` and `consolidateRetryDue`
  all read `nyClock`, because pg_cron is UTC and a fixed expression is wrong for
  half the year. They overlap, so each answering correctly on its own settles
  nothing: the composition is the decision, and a test walks every hour of a week
  through `dueNow`, DRIVING the sequence rather than being handed a flag — the
  pass records itself, which is what makes 23:00 a retry rather than a second
  pass.

  `retryDue` ANSWERS WHICH BRIEFING, NOT WHETHER ONE IS DUE, and the Sunday open
  has its own three hours (18:00–20:00) as of the first Sunday it ever went
  missing. It had none: the one briefing of the week that could not be retried
  was also the one whose absence takes seven days to come round rather than one.
  `dueNow` used to name `'weekday'` itself, correct only while the window was
  weekdays-only — **a literal that is right by accident of another function's
  range is the shape to look for**, and it is the second time that shape has
  been found here. `briefKind` is the same repair on the `?force=1` door, which
  read `?? 'weekday'` and so could not produce a Sunday briefing outside the one
  hour it was already due.

  AND THE PURE HALF PASSING PROVES NOTHING ABOUT THE CALL. `briefKind` is driven
  from both sides in `fold.test.mjs`, and every one of those assertions was green
  while `postScheduled` still read the constant — found by putting the constant
  back and watching the suite stay green. `agree.test.mjs` reads the call site,
  which is the half that was missing.

  The two data-driven schedules are deliberately not in `dueNow`: each is decided
  by a table rather than by the clock. Each has its own door and its own
  quarter-hourly job, and THE FLAG IS THE COPY THAT MATTERS — renaming one fails
  in complete silence, because pg_net discards the 200 an unread flag still gets
  back from `nothing due this hour`. `agree.test.mjs` reads every flagged cron URL
  against `postScheduled`, and reads `postScheduled` for a branch per answer.
  Adding an hour costs nothing in cron — the job is `0 * * * *` — which is exactly
  why a new schedule can be answered correctly and dispatched by nobody.

- **The pulse's default is silence, and `isSilent` is how it is said.** It matches
  the bare word only, so a sentence merely opening with it is sent. Err toward
  sending: a swallowed message is invisible, an extra one is extra. Nothing is
  stored on a quiet pulse — twelve turns is the whole window and empty pairs would
  push the briefing out of it.

- **The nightly pass writes memory and sends nothing.** 22:00 New York, every day.
  Notes written mid-conversation are decided at the worst possible moment — while
  she is busy answering — and this is the only point at which she sees a whole day
  at once. The window is a fixed twenty-four hours and there is no watermark,
  because the window and the gap between runs are the same length; a missed night
  loses that day's distillation and never the day, since the turns stay in the
  table and stay searchable. That is what makes a lossy pass safe to run
  unattended. It is `high` effort, and that is not a latency decision — a careless
  note outlives a careless briefing by months.

  IT IS GIVEN WHAT IT IS ASKED TO JUDGE WITH. Two of its instructions outran its
  inputs: it is told to notice what he has started doing differently, from a
  transcript that on most days never mentions a trade — so `tradesBlock()` goes in
  — and told to prefer superseding while holding twenty notes out of an archive it
  could not look at — so `SEARCH_TOOL` is in `CONSOLIDATE_TOOLS`. Never web
  search: a bookkeeping pass has nothing to research. It also RECORDS where the
  five channels stand, which is the only meter on the one claim this whole design
  rests on — and a rung is read by comparing nights, which a console line
  discarded within hours can never be.

- **`eugenia_runs` is where the meters survive.** Everything this file argues
  about `pg_net` — that nobody reads Edge logs — applied to every cost and quality
  figure `ask()` was printing. One row per model call, plus one per delivered
  briefing carrying its length, plus a row for the turns that FAILED, which is the
  row that never existed.

  AND `web_fetch` WAS THE SAME OMISSION IN ITS PLAINEST FORM: it sits in the
  same two tool arrays as `web_search`, carries `max_uses: 6`, bills on its own
  tariff, and was tallied NOWHERE — so every comparison of what a caller costs
  was made against the half of the server bill that happened to have a column,
  and `searches: 0` on a turn that burned its rounds read as idle when it may
  have been fetching throughout. `fetches` is summed from whatever `*_requests`
  keys come back rather than from a key this file guessed at, because a name
  spelled wrong reads 0 for ever — `planned`'s failure exactly. `agree.test.mjs`
  censuses the columns BOTH ways now: every key `recordRun` writes is a column,
  and every column is written by some `recordRun`. The second direction is the
  one `model` shipped without.

  A METER THAT RECORDS ONLY THE CHEAP SIDE OF A PRICE IS THE SAME OMISSION AGAIN.
  `cached` counts reads, at a tenth of the input rate — the number that can only
  ever look good — while the write beside it, at 1.25× or 2×, was counted
  nowhere. Ask it of any figure here: what is this the cheap half OF? It never throws and never blocks an answer. It is also
  what `consolidatedToday()` reads, which is how the nightly pass gets the retry
  the briefing has always had.

  TWO FIGURES WERE WRITTEN AFTER THAT ARGUMENT WAS SETTLED AND DID NOT GET IT
  APPLIED TO THEM, and both fail in the shape this table exists for: no error,
  nothing reaching him, the system healthy throughout. The nightly embedding
  sweep (`caller: 'embeddings'`) — a vendor that stopped answering takes the
  semantic arm of `eugenia_search` out while the lexical one keeps returning
  results, so half of `search_memory` can be gone for a fortnight with only a
  `console.error` behind it. The channel census (`caller: 'channels'`) — a ladder
  that stopped moving looks exactly like one with no reason to move. **BOTH
  OUTCOMES, ALWAYS**: a meter that records only its successes reports a vendor
  refusing every night as a table with nothing in it, which is the heartbeat's
  lesson arriving a second time. `caller` is free text precisely so neither
  needed a migration, and `agree.test.mjs` reads both call sites in both
  functions because `sweepLine` is pure and cannot see whether anyone wrote its
  answer down.

  AND BOTH SHIPPED BEHIND AN EARLY RETURN, WHICH IS THE FAILURE THEY EXIST TO
  END ARRIVING INSIDE THE FIX FOR IT. `postConsolidation` returns at once on a
  day nobody spoke, and the two meters sat after that return — so on exactly the
  nights when nothing else happens, neither ran. Quiet nights are ordinary: two
  of the four before this was found were `nothing said`, and a dead embedding
  vendor could have survived all of them with the meter reporting nothing at
  all. The quiet day is a BRANCH now and the meters sit past it, and what
  `agree.test.mjs` asserts is that `postConsolidation` has exactly ONE `return`:
  the branch shape will change, a second return is what puts the hole back. The
  census may NOT be hoisted to the top to solve it — it is taken after the pass
  because the pass is the only thing that can move a rung, and a test holds that
  ordering too.

  AND A JOB THAT DIES BEFORE ITS FIRST MODEL CALL LEAVES A ROW TOO. `ask()`
  records a failed turn, so the table could answer *how often does a model call
  die* and could say NOTHING about a job that never reached one — two
  consolidations threw in `turnsSince` one line into `postConsolidation`,
  apologised on two consecutive nights, and left no row on either, so the table
  read as a system with nothing to do. `postScheduled`'s catch writes
  `caller: '<job> job'` — the apology's vocabulary, suffixed so it cannot be
  confused with an `ask()` label — BEFORE the apology, because that send carries
  `.catch(() => {})` and a Telegram that is refusing would otherwise take the
  only notice with it. `agree.test.mjs` reads the order, not just the call.

  `sweepLine` PARTS THREE REPAIRS AND THE THIRD IS THE FALSE ALARM. A refusing
  vendor throws and arrives as its own message; an unset key does NOT throw —
  `embed()` returns null and the rows stay where they were — so *nothing filled
  against a backlog* is an exact statement about the key rather than a guess.
  A drained archive answers `0 filled, 0 left` and must accuse nobody, or the
  line fires every night for the life of the deployment and stops being read.

- **EVERY MESSAGE SHE COMPOSES IS READ ONCE MORE BEFORE IT GOES, AND FOR FOUR
  OF THE FIVE THAT IS NEW.** `CRITIC` ran on the briefing ALONE — the pulse, the
  release look and the move look went out unreviewed for their whole lives,
  which is most of what he receives in a week and is exactly where he was
  reading her and finding her hard. The writing rules were live and global on
  those paths and nothing had to answer for them.

  `TRIM` is that gate and it is NOT `CRITIC` with a shorter prompt. The
  briefing's checks ask whether the first sentence is true only today, whether
  the chain is complete in the paragraph that matters, whether there is more
  than one chain and whether it runs to 250–300 words. Every one is a question
  about a briefing; asked of three sentences they demand a chain, complain about
  length and rewrite a good message into a bad one. `TRIM` asks the writing
  questions and nothing else, off the same `WRITING` the writer was given, and
  is handed no notes and no channel map because it is not judging whether a term
  was built. It runs on Sonnet: checking a message against a stated rule is the
  bounded half of the split the models are chosen on.

  THE TRADE EVENT STAYS OUT. Both its branches are decided from data before any
  model call and what it says is one of his own rules read back — there is no
  composed prose to trim.

  THE REPLY WAS OUT AND HAD NO ARGUMENT BEHIND IT, WHICH IS THE POINT. It was
  never exempted; it was simply not in the list the day the gate was written,
  and it is the busiest thing she sends. The case for leaving it out was made
  after the fact and was wrong twice over: `WRITING` is what `TRIM` reads, and
  `WRITING` is where `ENGLISH, ALWAYS, WHATEVER HE WROTE IN` lives — so the one
  path he writes Spanish on was the one path with nothing checking the rule
  written for it. It is gated INSIDE the typing indicator, because clearing the
  ping first leaves three silent seconds in which she reads as having finished
  and then said nothing.

  WHAT IS REMEMBERED IS WHAT THE GATE RETURNED. The three callers bind the
  revision before sending it, because storing the draft files a message he never
  read as her own words and resends it as history for six exchanges — the stale
  copy `remember` already refuses for the notes and the week's trades, arriving
  through the door the gate itself opened. The briefing never had it, storing
  what `critique` returned; the three that GAINED a gate kept storing the draft
  for as long as they had one. `agree.test.mjs` reads all three bodies, because
  nothing in the suite can drive a path that sends.

  `SENDS` IN `agree.test.mjs` IS THE CENSUS, AND IT EXISTS BECAUSE EVERY OTHER
  CHECK HERE IS VERTICAL. They ask whether a name exists, whether two copies
  agree, whether an output drifted — one fact each, verified deeply. The fault
  none of them can see is HORIZONTAL: six paths that should do comparable
  things, one missing a step. It hid twice in one week — the gate reached three
  paths and not the reply, and the three that gained a gate went on storing the
  draft — and neither was findable by any check in the file taken alone. The
  census DERIVES the path list from the source and compares it with a
  declaration, so a new thing that sends him something fails the suite until
  someone writes down what gate it runs and what text it carries. An exemption
  is a row with a reason in it, never an absence.

  `gate` HOLDS THE HALF THAT MAKES EITHER ONE SAFE: a revision failing
  `keepDraft` is overruled and a gate that THROWS costs nothing. Copied, that
  catch is where one gate loses the message it was checking on the day a vendor
  is slow.

  AND `keepDraft` IS RELATIVE NOW. A flat four hundred characters is a
  BRIEFING's floor — shorter than that and what came back was an apology. A
  release look is two or three sentences and often under four hundred to begin
  with, so that floor overrules every revision there is, and a gate overruled
  every time looks exactly like a gate that agreed with the draft.

- **The briefing's own gate.** `CRITIC`, medium effort,
  no tools — and the empty array is the CHEAPER of the two as well as the
  stricter, which is the opposite of how it reads. Sharing the briefing's array
  so the critic could ride its cache was tried and measured and did not work:
  the tools array is where the cache key starts, and the two ALSO differ in
  effort, which invalidates the tools and system caches on top of that. The
  morning it shipped, the critic wrote 23,309 tokens and read none, seconds
  behind a briefing that had just written that exact figure. `REFACTOR.md` R-15.
  `keepDraft` is the guard: a revision that comes back empty, apologetic
  or twice the length is a critic that failed, and the draft goes instead. A critic
  that could make the briefing worse would be worse than none.

  A RULE IT RESTATES MUST BE HANDED THE INPUTS THAT RULE READS, and two of its
  five were not. It is asked whether the briefing obeys his standing
  instructions — which are notes it was never given — and it was asked whether a
  term had already been explained, which is a fact about last week that a reader
  of one message cannot hold. The first check was simply skipped. The second
  fails UPWARD, which is why it survived: answered from the only evidence in the
  room, the mechanism sitting in the paragraph being judged reads as a
  redefinition, so the pass that runs LAST cut the build-up `PITCH` had just
  required, every morning, and what reached him was the term bare. Shorter,
  fluent, correct, and with the teaching taken out of it — the ladder's own
  failure arriving after the ladder had been obeyed. It is handed `notesBlock()`
  and `channelsBlock()` now, both already awaited in `postBriefing`, and the
  redefinition check is written against the rung instead of against a memory.
  `agree.test.mjs` reads the call site, since a critic holding neither still
  returns a briefing that looks right.

- **The apology names the job.** Every scheduled failure used to say "No
  briefing", including the nightly pass, whose real symptom is that her memory
  stops growing. `APOLOGY` is a word per job and a test asserts no two are alike.

- **A failure must reach him, not the console.** pg_net discards the response,
  `net._http_response` is pruned within hours, and nobody reads Edge logs — so the
  cron half messages Telegram on failure and retries at 09:00–11:00 ET until
  `briefedToday()` sees the marker. Do not quietly remove either half.

- **BOTH HALVES ANSWER BEFORE THEY WORK, FOR TWO UNRELATED REASONS.** Telegram
  gives a webhook about a minute and then redelivers — which would run a whole
  briefing twice and bill for both. `background()` + `EdgeRuntime.waitUntil` is
  what makes the 200 immediate.

  THE CRON HALF WAS EXEMPT ON THE GROUND THAT pg_net NEVER RETRIES, WHICH IS
  TRUE AND WAS NOT THE ONLY QUESTION. There are two limits and paying moves only
  one: the worker's WALL CLOCK is 150s free and 400s paid — that is what killed
  the Sunday briefing at 145.4s of drafting, four and a half seconds short of
  finishing — and the REQUEST IDLE TIMEOUT is 150s on every plan. Send the caller
  nothing for that long and the request is closed under you, so a briefing that
  now completes and delivers perfectly still hands pg_net a 504.

  That 504 is why this matters rather than being cosmetic. `net._http_response`
  is the only place a dispatch is recorded, and there a good briefing and a call
  that never ran are the same row — so any watcher built on it reports every
  working briefing as a failure, which is the ordinary-day false alarm `008`
  says gets a monitor ignored. Answering first makes a non-2xx there mean what
  it says. **`?embed=1` IS THE ONE EXCEPTION AND IT IS DERIVED RATHER THAN
  TYPED**: its answer IS its interface, since it is called until it reports
  `left: 0`, and it is the only flag no cron job dispatches — which is the same
  fact from the other side, and is what `agree.test.mjs` asserts it against.

  The body NAMES the job (`accepted: "pulse=1"`), because `net._http_response`
  carries no URL and the flag is otherwise unrecoverable from the row.

### The model call

- **Nothing the tool loop serves may throw**, and it is a separate rule from the
  boundaries above: a boundary coerces input the model wrote, this is about a read
  that simply failed. All of them return a sentence and she writes around the gap.
  `readTrades` was the one that did not, and the briefing it killed had already
  absorbed that same 404 a round earlier in `tradesBlock` — so the shape to watch
  for is a helper reached from a caught call site and an uncaught one, where the
  catch on the first hides that the second is bare. And the sentence is half of
  it: an empty answer is only an answer when something was read.
- **A tool result is never dropped, and a round runs at once.** `serve()` answers
  an unknown name with a sentence, because a user message missing the
  `tool_result` for a `tool_use` block is a 400 — so a mistyped name would present
  as a dead turn rather than as a mistake. The dispatch is `Promise.all`: the model
  is taught to batch its calls and they were being served in series.
- **A beta flag is a header on a raw fetch, never a `betas` body field.** The
  `betas: [...]` array is the SDKs' parameter and they turn it into
  `anthropic-beta`. This file uses `fetch`, so the header is the only form that
  works — and an unknown top-level parameter is a 400, which is every call.
- **The container is not optional once web search is in play.**
  `web_search_20260209` runs code execution for its dynamic filtering, so the model
  can call `get_trades` from inside that container; the continuation must carry
  `container` (a bare string on the request, `container.id` on the response) or the
  API rejects it. Neither tool may set `strict: true`, and the message answering
  those calls must hold only `tool_result` blocks.
- **Effort is per caller, and it is the latency dial.** The briefing runs `high`;
  a reply and the pulse run `medium`. Nothing here runs `low`, because a careless
  read of the journal is worse than a slow one.

- **`MAX_ROUNDS` IS A BACKSTOP AND IT HAD BECOME A WORKING LIMIT.** Six was set
  on the reasoning that three is realistic — read the journal, write a note,
  answer — with the cap there for the case where that assumption is wrong. The
  assumption WAS wrong the day a tool-heavy caller changed model, and the way it
  announced itself is the shape to remember: a release look that searched,
  fetched and searched again, out of rounds, twice in half an hour, arriving as
  an apology rather than as a number. Ten keeps it a backstop. The failure it
  guards against is a loop billing for ever; the failure it CAUSED is a message
  that never arrives, and of the two only the second has happened.
  `eugenia_runs.rounds` is written on every turn, so how close a caller runs to
  this is a question with an answer — and reading it is what should have come
  before a model changed underneath it. WHICH MODEL RAN IS A COLUMN NOW, which
  it was not: the log line named it and the row did not, so `rounds` could not
  be compared across the change it mattered for. Two guards, because a schema
  check sees only half — the column existing, and `recordRun` actually writing
  it. Absent the second, every row lands, the meter looks healthy, and the
  column reads null for ever.

- **SO IS THE MODEL NOW, AND ONE MODEL FOR EVERYTHING WAS NEVER A DECISION.** A
  week of `eugenia_runs` put the release look at $5.30 against the whole
  briefing's $4.12 — fourteen looks costing more than five briefings — and the
  move look at $0.64 a turn, the most expensive single message she sends, for
  two sentences about a price. `MODELS` is keyed on the caller's LABEL, which is
  the same string `eugenia_runs.caller` records, so one string decides both what
  ran and what it is filed under; absent means Opus, because a new caller should
  be expensive and correct rather than cheap and unnoticed.

  THE SPLIT WAS BETWEEN JUDGING AND CHECKING AND IT COST A CALLER ITS LIFE. The
  release look, the pulse and the move look moved to Sonnet on that reasoning.
  The release look then died at `MAX_ROUNDS` on its first two firings the next
  morning — twice inside half an hour, arriving as the apology — where fourteen
  turns on Opus in the measured week had never come near the cap.

  WHAT THE TWO FAILURES ESTABLISH is that the round budget on a TOOL-HEAVY
  caller is a property of the MODEL rather than of the task. Nothing here had
  measured that and the change assumed it, reasoning only about output quality.
  A cheaper caller that does not answer is not cheaper. They are back on the
  model they were measured on, the cap is raised because it had become a working
  limit, and any future move is ONE caller at a time with `rounds` read
  afterwards.

  `trim` STAYS ON SONNET AND THE DISTINCTION IS THE WHOLE OF WHY: it is handed
  `CRITIC_TOOLS`, which is empty — one request, no loop to run out of — so it
  cannot reach the cap whatever a model's appetite for rounds. That is the shape
  a cheaper model is safe on here, and `agree.test.mjs` RESOLVES the array each
  Sonnet caller is handed rather than reading what sits near it, because a label
  reaches `ask` two ways and a reader that knew only one would pass the next
  tool-heavy caller wired through `gate`.

  THE CRITIC IS THE ONE THAT LOOKS LIKE IT SHOULD MOVE AND DOES NOT: about $3.50
  a month, and it runs LAST, it can rewrite, and it is the final gate on the
  exact thing he spent a fortnight saying read badly.

  `fellBack` COMPARES AGAINST WHAT THE CALLER ASKED FOR. It was one constant for
  the file; left that way every Sonnet caller reports a fallback on every call
  and the column stops meaning anything. AND `fallbacks` RIDES WITH OPUS ALONE —
  caution rather than a rule. It has carried the briefings since the morning a
  decline cost one, on the model it was turned on for; whether Sonnet accepts the
  parameter is not something anything here has established, and if it does not
  the failure is a 400 on every call, three scheduled callers dark at once. The
  header and the field are a pair and either alone is its own 400, so both are
  gated together and `agree.test.mjs` reads for both.
- **A briefing can exceed Telegram's 4,096 characters.** `chunk` splits it and the
  parts go sequentially; Telegram does not promise ordering. Its preference is
  paragraph break, then any newline, then a hard cut, and it must stay two lookups
  rather than a `max()` over the pair: `lastIndexOf('\n')` is always at or past
  `lastIndexOf('\n\n')`, so a max can only ever return the plain newline and the
  paragraph preference silently never happens.

### Voice and charts

- **Neither is stored as sent.** The transcript is kept and the image is not —
  base64 in `eugenia_turns` is a megabyte resent as history for six exchanges.
  `stamped` appends the clock as a trailing text block, because concatenating
  against an array is `[object Object]` on exactly the turns carrying the most
  context. `STT_URL`/`STT_KEY`, `TTS_KEY` and `EMBED_KEY` are OPTIONAL secrets,
  deliberately not in the boot guard, and `agree.test.mjs` makes that exemption
  cost something — an optional secret must be guarded where it is used.

- **EVERYTHING SHE WRITES IS SPOKEN, AND THAT REVERSED A RULE THAT WAS SOUND.**
  It was *she answers in the channel he used* — a voice note aloud, a typed line
  in text, no setting and nothing stored. What that rule decided was a REPLY, and
  everything she STARTS was silent as a side effect of it rather than as a
  decision. So the morning briefing, the one message he actually wanted read to
  him, was the one the rule could never reach. He decided it the other way.

  AND THE CAP WENT ENTIRELY, WHICH THE FIRST FIX ONLY MOVED. It was 700
  characters — fifty seconds, on the reasoning that past that a voice note stops
  being a reply and becomes a recording. Right about a reply and fatal here: a
  briefing is 250–400 words by its own rule, so it would have been over the cap
  every single morning and would have arrived silently, correctly, for ever.
  Raising it to 4,000 fixed that morning and kept the SHAPE of the mistake — a
  cap decides that past some length a message is not worth hearing, and nothing
  she writes may be shortened to fit a voice note or left unspoken for being
  long. A long message is SEVERAL notes now, split by the same `chunk` with its
  paragraph preference so each part is a whole thought. The only number left is
  `TTS_LIMIT`, which is what the vendor accepts in one request and is a chunk
  size rather than a gate.

  AND THE VOICE NOTE IS THE MESSAGE NOW, WITH THE TEXT AS THE FALLBACK. Sending
  both worked and both arrived — two notifications and two bubbles for one thing
  she said, which is not what he asked for. The objection to audio-only was real
  and this is the ANSWER to it rather than a climb-down: a refusing vendor, an
  unset key or a format Telegram will not render each turn audio-only into a
  MISSING message, so `say` is still reachable and fires when the audio did not
  land — in FULL rather than in part, because a message he heard three quarters
  of is worse than either. What is STORED is untouched: `remember` writes the
  transcript whatever happened on the wire. The briefing's keyboard rides on the
  last voice note, since there is no text message under it to carry one.

  SIX PATHS send him something she wrote, so that ordering lives in `sayAloud`
  rather than in six copies — five of which nothing would be guarding.
  `agree.test.mjs` reads it AND counts the six call sites, and `fold.test.mjs`
  DRIVES the fallback, which is the one property a source read cannot settle:
  with no TTS key every `speak` answers false, which is exactly the shape of a
  vendor that refused, so the real sequence is replayed and the text must still
  go.

  `say` KEEPS three things deliberately, unspoken and unconditional: the `/notes`
  audit, which is a rendered table and unlistenable; the apologies, which are
  failure notices rather than messages she wrote; and the short operational
  lines. And the markdown is
  stripped on the way to the vendor, because the calendar slot carries a bold
  label per line — the one place the prose rule is relaxed, for a reader's eye,
  and `**Today:**` read aloud is a gamble on what an asterisk becomes.

  THE PROMPT IS TOLD NO LENGTH. It carried the cap, so that an answer over it was
  one she chose rather than one silently left unspoken. With no cap, a number
  there would be asking her to write shorter for a limit that does not exist,
  which is the thing this was changed to stop; `agree.test.mjs` reads for its
  absence. She is still told the answer will be heard, on every path rather than
  only when he spoke first.

  `TTS_VOICE` and `TTS_MODEL` are environment rather than pinned, unlike
  `EMBED_MODEL` — nothing is stored, so a change alters one message rather than
  what is comparable to what — but they are COUPLED, since the older `tts-1`
  serves a smaller voice set and takes no delivery instruction. `TTS_STYLE` is
  pinned where they are not: which voice reads it is taste, how it is read is the
  product. AND THE FORMAT IS THE ONE THING HERE THAT FAILS QUIETLY — mp3 is the
  vendor's default and it WORKS, arriving as a file attachment rather than a voice
  note, with nothing erroring and nothing logged; `agree.test.mjs` reads `speak()`
  for `opus`, for `audio/ogg` and for the `.ogg` filename.

---

## On handback

State plainly what was changed, what was verified by running, what by reading,
and what could not be verified.

---

## Her memory is backed up from outside the browser

`scripts/backup-memory.mjs` is the only copy of the seven tables that have no
other source. It is run weekly by `.github/workflows/backup-memory.yml` and can
be run by hand for a durable copy; the README carries the mechanics. The part to
be careful with is the PAGING: PostgREST caps a response at its own `max-rows`
whatever is asked for, so one read of `eugenia_turns` returns a page and looks
exactly like a complete archive — green job, well-formed file, plausible counts,
discovered on the day someone restores from it. The walk stops on a short page
rather than on a count it was told, `readAll` takes its `fetch` as an argument so
that loop is driven from a test, and a refused read throws rather than backing up
a blank.

---

## The email path

- **The Apps Script parses and forwards; it does not write.** `doji-email-sync`
  owns the write, and `emailRow` is the boundary — five names built into a
  payload rather than filtered out of one, each type-checked. An absent key and
  a null key mean opposite things under `merge-duplicates`, which is why a
  missing figure is dropped rather than sent as null.
- **It holds no account credential, and must never hold one again.** The write
  moved behind a function precisely so that the secret living in Google's
  infrastructure opens five columns rather than the whole account. A test asserts
  the sign-in helpers are gone.
- **Three outcomes, not two.** A body that will never parse and a `400` from the
  function are permanent and label the thread; anything else, including no
  response at all, leaves it unlabelled so the next run retries. Collapsing the
  last two is how a fill's P&L was once discarded forever.
- **Both broker paths are anchored to real captures, and they overlap.**
  `fixtures/ctrader-get-deals.txt` (a `?raw=1` capture) and
  `ctrader-stop-loss-filled.html` (a real alert) both contain position
  577885869, so the fold is checked against the broker's own email rather than
  against its own arithmetic. Replace either capture and the comparison moves
  with it — both sides are read out of the fixtures, never typed into the test.
- **`parseAlert_` is anchored to a real message; the Gmail half is not.**
  `test/fixtures/` holds an actual alert body for a fill that is in the
  database, so the parser is held to its input and not only to its rules. The
  variants around it are built, and one test keeps the builder matching the real
  body. Save a new fixture whenever cTrader changes the alert.

---

## The database

- **The files are a claim; `verify.sql` is how it is tested.** Applying by hand
  is deliberate, so nothing keeps the live schema honest on its own. Run
  `verify.sql` after any manual change and before believing the numbered files.

  IT IS ONE STATEMENT, AND THAT IS LOAD-BEARING RATHER THAN TIDY. A SQL editor
  shows the result of the LAST statement only, so the ten listings that used to
  sit below the summary meant running the file top to bottom displayed the last
  ten HTTP responses and threw all 71 checks away — silently, with a paragraph at
  the bottom explaining to someone who had already lost their result how to go
  back and select the block by hand. It happened to the person who wrote that
  note and then to the person it was written for. **A check that awkward to run
  is a check that stops being run**, which is the ignored-monitor lesson arriving
  about the checker itself.
  Moving the summary to the END would have been worse: `cron.job`,
  `net._http_response` and a direct public read can all RAISE, and anything that
  raises takes every statement after it, so the summary would vanish on exactly
  the databases it exists for. The listings are `diagnose.sql` now — two files,
  each with its own statement last. `agree.test.mjs` counts the semicolons in
  `verify.sql` and asserts there is ONE, because the regression is a single
  appended `select` and the file still runs, still passes, and shows something
  else.

  A FUNCTION IN THE DATABASE WAS THE OBVIOUS FIX AND IT IS WRONG. `verify_doji()`
  would put the expectations inside the thing being verified — applied by hand
  like everything else, so a stale copy reports a stale truth with nothing to
  catch it — and `agree.test.mjs` reads the summary's TEXT in eight places,
  every one of which goes silently blind the moment those rows leave the file.

  AN ERROR IN IT IS NOT A FAILED ROW, IT IS A FILE THAT STOPPED. The summary is
  one query returning one row per fact, so anything that RAISES takes every
  check below it with it — and the run then reports itself as a fault in the
  database rather than in the file. A row asked `has_function_privilege` about
  `public.eugenia_search(text, int)`, the signature 007 deliberately dropped;
  a text signature that does not resolve raises 42883, so eleven checks stopped
  running the day 007 was applied and nothing said so for two releases. Ask by
  oid out of `pg_proc`, or with `to_regprocedure`, which answers null — never
  with a written-out signature or a `regprocedure` cast, and `agree.test.mjs`
  reads the file for both. The same care goes for any new row: it must be able
  to come back FALSE on a wrong database rather than throw.

  THE SECOND SHAPE OF THAT IS A SUMMARY ROW READING A PUBLIC TABLE DIRECTLY, and
  three seed checks did. Postgres parses the whole statement up front, so
  `select count(*) from public.eugenia_thesis` does not report a missing table —
  it raises 42P01 and takes every check in the summary with it. A `case` guard
  does not help, because both branches are parsed. `query_to_xml` does: it takes its
  query as a STRING, so nothing is parsed until it runs, and a `to_regclass`
  guard beside it means it never runs when the table is absent. A seed check has
  to read the table — that is what it is for — so that is how it reads it, and
  `agree.test.mjs` asserts no summary row reads `public.` outside a quoted
  query. It strips block comments AND dash comments before it looks: an
  apostrophe in either desynchronises quote matching for everything after it,
  and the check then reads a guarded string as live SQL.

  THE COUNT IS IN THE HEADER NOW, not a footer. A footer was a paragraph for
  someone already lost, and nobody arrives at the bottom lost any more; it is
  read before running instead. Stated once and as a digit, because a test counts
  the summary rows and compares it.

  AND WHAT IT ASKS ABOUT IS HELD AGAINST THE FILES. It asserted 25 of 39
  declared objects — eleven indexes and the three policies the card reads were
  never asked about, and RLS was asserted for four of ten tables. Each fails
  silently by construction: a missing policy is RLS doing its job and a card
  showing nothing, a missing index is the same rows off a sequential scan.
  `agree.test.mjs` now reads every `create table`, `create policy` and `create
  index` in the numbered SQL against this file, and holds the index row's list
  against the statements themselves.

  AND A ROW THAT COUNTS GOES STALE WHERE A ROW THAT NAMES DOES NOT. Below that
  same dead line sat `three triggers on trades` — 001's touch and 002's two —
  which 005 made wrong by adding the event spine's two, so the first run it ever
  got reported a correct database as broken. It names the five now, sorted, and
  `agree.test.mjs` reads that list against every `create trigger ... on
  public.trades` in the numbered SQL. Prefer a name or a `string_agg` to a
  count: five is still five when one is renamed and another added, and the two
  that matter most here fail silently — a position opening with nothing telling
  her looks exactly like a quiet day.
- **`revoke ... from public` IS NOT THE WHOLE REVOKE, and this is a third pair of
  names that are one value.** `public` in a `revoke` is the PUBLIC pseudo-role;
  `anon` and `authenticated` hold `execute` separately and by name, from the
  default privileges Supabase sets on the public SCHEMA. So a new function
  arrives reachable by the publishable key and revoking from PUBLIC does not
  change that, silently. `eugenia_search` was in that state from the day 003
  created it — not a leak, since it is not `security definer` and an anon caller
  meets RLS on two tables with no policy for it, but the guarantee this
  repository states was false and nothing had ever asked the database. Both
  revokes are in 007 now, and `verify.sql` asks it of EVERY callable function
  through `has_function_privilege`, which answers for the role however the
  privilege arrived.

- **`007_semantic.sql` is dropped-and-recreated on purpose, which nothing else
  here does.** `create or replace function` cannot change an argument list, so
  the three-argument search beside the two-argument one is an OVERLOAD: a
  two-argument call matches both and Postgres refuses it as ambiguous. The drop
  takes the grants, and a bare `create function` carries `execute` to PUBLIC
  which `anon` inherits — so the `revoke` and `grant` are part of the statement,
  not a follow-up, and `agree.test.mjs` reads for all three. The backfill door
  (`?embed=1`) has no cron job by design: the archive is a one-off and the
  trickle a failed vendor call leaves is swept by the nightly pass, which
  already runs and already reads the day.

- **`005_eugenia_senses.sql` is safe to re-run in full, and `003` is not.**
  Every statement is `if not exists`, `or replace` or `on conflict do nothing`,
  and a test asserts it — this is the file that will grow. Note also that
  `create or replace view` may only APPEND a column and `create or replace
  function` may not change a return type.

  AND A RE-RUNNABLE FILE MAY NOT UNDO A LATER ONE. 005 held `eugenia_search`
  in place for the return-type reason above, and kept holding it after 007
  dropped that signature for the query vector — so re-applying 005 would have
  recreated the two-argument overload 007 exists to remove, executable by
  `anon` from the schema's default privileges, with the `revoke ... from
  public` beside it touching neither. 007 owns the function; 005 keeps the
  extension and the trigram indexes. `agree.test.mjs` reads every re-runnable
  file — derived from whether it carries a bare `create table` — against every
  `drop` a later file makes.

- **`008_sync_health.sql` is the only table here that is about the system rather
  than the desk, and it must never be able to break what it watches.** The
  poller and the email function have no path to Telegram, so `heartbeat()` in
  `_shared/edge.ts` is the only evidence either is alive. It swallows
  everything — a database without 008, a 404, a refused network — because a
  monitor that can fail the work it monitors is worse than none, and the poll
  folds its deals exactly as before.

  IT IS A HEARTBEAT AND NOT AN ALARM, which is why `last_ok` moves on SUCCESS.
  A failure-triggered message cannot fire when the failure is that nothing ran:
  an unscheduled cron job, a renamed function, a deploy that dropped one. Those
  are the failures worth catching and `last_ok` going cold is what sees them.
  `healthLine` is exported and pure so both states can be driven from a test —
  a writer failing, and a writer nobody is calling — and `agree.test.mjs` reads
  both call sites in both functions, since a mark missing from the success path
  makes a healthy writer read as dead.

  THE TWO FALSE ALARMS ARE THE WHOLE RISK, and both are ordinary days rather
  than edge cases. EVERY path that completes must mark: the poller's
  market-closed skip is a completed run, and unmarked it freezes the mark across
  gold's Friday-to-Sunday close — forty-eight hours against a six-hour window,
  reported as a dead sync every Sunday evening. And the two writers may not be
  judged the same way: the poller is scheduled, so silence is evidence; the
  email function runs only when a fill arrives, so silence is a quiet week and a
  staleness rule over it fires on almost every ordinary day. `SCHEDULED` is that
  distinction, the outcome of the LAST run is what is read for both, and
  `agree.test.mjs` reads the skip path for its mark because `healthLine` is pure
  and cannot see a call site. A monitor that is wrong on an ordinary day gets
  ignored, and an ignored monitor is worse than none.

- **`009_dispatch.sql` watches the half `008` cannot see, and it lives in
  Postgres because the thing it watches is the Edge Function.** A 546 comes back
  BEFORE the worker exists: no `eugenia_runs` row, no apology, nothing in the
  function's own log, and the only witness is a row in `net._http_response` that
  pg_net prunes within hours. That is how a Sunday briefing went missing for two
  hours until a person noticed. `heartbeat()` cannot catch it — it is written by
  a function that RAN — and a watcher that reported a refused worker by asking
  that same function to send a message would share the failure mode of its
  subject. So this one posts to Telegram directly.

  `net.http_post` RETURNS the request id and all six callers threw it away. That
  id is the only link to the response row, which carries NO URL — so what a
  failed request was for is unrecoverable without capturing it. The ledger is
  that capture, and `agree.test.mjs` counts `net.http_post` calls against ledger
  rows so a seventh site cannot be added unwatched.

  **A SINGLE LOST POLL IS AN ORDINARY DAY AND MUST NOT BE REPORTED.** The poller
  runs 720 times a day with the next one two minutes away; naming every refused
  worker would put three or four messages a day in front of him about a sync
  that healed before he read them, which is how a monitor teaches someone to
  swipe it away. `dispatch_repeats` is the same split `healthLine`'s `SCHEDULED`
  makes, arriving for a second reason — a job that comes round on its own is
  evidence only in QUANTITY (three in an hour), and a job that does not is
  evidence alone. The hourly job, the trade event and Gladys are one-shot.

  **THE LEDGER MAY NOT BREAK THE TRIGGER IT SITS IN.** Both trigger sites post
  into a variable FIRST and record it behind `exception when others then null`,
  because they fire inside the UPDATE that set the column — a raise there fails
  the journal write itself. Proved by renaming the table away and watching the
  trade still write and all four messages still dispatch.

  The window has BOTH ends. Judged at fifteen minutes so a slow call is not
  called dead, and not at all past three hours, because pg_net's own pruning
  makes every old row read as `no answer` — which on the day the watcher itself
  stopped would come back as a hundred invented failures.

  **AND ITS OWN REPORT CAN BE LOST, WHICH THE FIRST ONE EVER SENT WAS.** pg_net
  answered `timed_out` with the whole twenty-second budget spent in the TCP/SSL
  handshake and zero milliseconds in the request — the connection to Telegram
  never opened. The function had already settled the rows, because pg_net is
  ASYNCHRONOUS and it cannot learn otherwise inside the same call. So a real
  outage would have been reported once, into a dropped connection, and never
  mentioned again: the silence this table exists to end, arriving inside the
  thing built to end it, which is the third time that shape has been found.
  `reported_by` holds the request id of the message that named a row; the next
  sweep settles on a 2xx and clears the mark on anything else, so it is said
  again. A sweep that could NOT send — a Vault name misspelled — settles
  nothing, or repairing the name would deliver an outage nobody is still
  recording. Past three hours it gives up, because a row that can never be
  adjudicated would otherwise be announced every ten minutes forever.

- **`010_pace.sql` is the only monitor here that speaks BEFORE the failure, and
  it has to be, because afterwards there is nothing left to speak with.** Since
  the cron half began answering before it works, a briefing killed at the 400s
  wall clock has already handed pg_net a 200: 009's ledger records a healthy
  dispatch, `ask()` never reaches its catch so no failure row is written,
  `postScheduled`'s apology never runs, and all three retries redo the same
  too-long work. Three monitors, all green, nothing reaching him — the Sunday
  009 was built after, arriving back through the door opened to fix it.

  `eugenia_runs.ms` had been written on every model call since 005 and read by
  nobody. `pace_line` is exported for `healthLine`'s reason and takes its clock
  the way `dispatch_failures` does. It reads the LARGEST row of the last seven
  days rather than reassembling an invocation, because there is no invocation
  id and `ms` is a lower bound on the wall clock either way — the cost is
  lateness, never a false alarm. `ceiling_ms` is stated once and the message
  quotes it: a ceiling written twice is a threshold that moves while the
  sentence beside it keeps naming the old one.

  THE SECOND HALF IS THE ABSENCE AND IT IS WHAT CLOSES THE HOLE. Noon on a
  weekday, 21:00 on a Sunday — both a full ceiling past the last retry, because
  asked any earlier it reports a briefing still being written. The caller it
  looks for is `postBriefing`'s, in two languages with no build step between
  them, so a rename would report a briefing missing every single day.

  AND THE ROW IT WRITES IS THE GUARD, which is what makes one ordering
  load-bearing. It speaks at most once a New York day and decides that by
  finding its own row, so a row written after a send that could NOT be made
  marks the day as said and swallows the warning for good — repairing a
  misspelled Vault name would then deliver silence, which is 009's lesson
  arriving here and was found by running it with the name wrong. Written only
  where the post was made. A quiet day still leaves a `clear` row: both
  outcomes, always.

- **`004_cron.sql` holds every schedule and is safe to re-run.** `cron.schedule`
  upserts on the job name, so applying the file makes the database match it. Add
  a new scheduled job there, never in a feature's own file. `verify.sql` counts
  the jobs and `agree.test.mjs` holds that count against this file — the row had
  already been wrong once, reporting a correct database as broken, and was
  repaired by hand and left to be counted by hand again.
- **A caller's URL is checked in the repository and in the database, and they
  are different checks.** `agree.test.mjs` reads every `/functions/v1/<name>` in
  the SQL and the Apps Script and fails if one names a function that is not
  there, and reads the project ref out of every file that carries one —
  including `index.html`, `config.toml` and the deploy workflow, which name a
  project without naming a function; `verify.sql` asks the live trigger the same
  question. Renaming a function means editing a trigger body
  and a cron job by hand, and a missed one is a 404 pg_net throws away.

---

## Two names that are one value

Four pairs now. The first two have already caused a silent failure, and every
one of them fails the same way — the wrong spelling reads as empty and something
else happens quietly:

- **`doji_cron_secret`** in Vault, **`DOJI_CRON_SECRET`** in Edge secrets.
  Postgres compares the Vault name case-sensitively. Gladys's trigger shipped
  reading the upper-case one and went quiet without failing anything.
- **`SB_SECRET_KEY`**, never `SUPABASE_SECRET_KEY`. Supabase owns the
  `SUPABASE_` prefix, so no secret can be created under it and a function
  reading that name gets `""` whatever the dashboard shows. The code read it
  for months while the legacy service_role JWT quietly served every request
  through a fallback.

- **`eugenia_bot_token`** and **`telegram_chat_id`** in Vault, `EUGENIA_BOT_TOKEN`
  and `TELEGRAM_CHAT_ID` in Edge secrets. `dispatch_watch` reads the Vault pair
  to message him directly, which is what keeps the watchdog off the function it
  watches. A wrong spelling here yields null, the watcher falls through to a
  `raise warning` nobody sees and settles the rows anyway — silent for exactly
  the same reason a healthy system is. `verify.sql` asks whether both resolve,
  which is the check this section demands before a name like these is added.

`verify.sql` catches a database-side mismatch, and a 503
at boot catches a secrets-side one. Neither catches a name that is merely
*wrong*, so check a new one against the surface that stores it.
