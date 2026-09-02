# CLAUDE.md — working context for Doji

This file is the context a Claude Code session starts from. It is **subordinate
to `README.md`**: where anything here disagrees with the README, the README wins
and you say so. The README is the contract for how the app behaves; this file is
how to work on it, and it holds only what the README does not — every
description of behaviour lives there, once.

Doji is a personal XAUUSD trading journal: one `index.html` of ~3,800 lines, one
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
  runtimes and no build step mean seven facts genuinely live in more than one
  file — the README's *Facts that live in more than one file* names them, and
  `test/agree.test.mjs` reads every copy of each and fails when they disagree.
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
  export by `loadXLSX()`). `jsdom` is a dev dependency and never ships. A fourth
  needs a real argument.

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
npm ci        # once — jsdom, and nothing else
npm test
```

Node 22.22.2+ — jsdom's floor, above the 22.6 `--experimental-strip-types`
needs. Four suites, and the script globs `test/*.test.mjs` one level, so a test
in a subfolder silently would not run. `fold.test.mjs` covers the pure logic
of all four Edge Functions and of `_shared`; `app.test.mjs` boots `index.html` in
jsdom with a recording Supabase stand-in; `agree.test.mjs` holds the duplicated
vocabularies together; `parse.test.mjs` runs the Apps Script in a `vm` with the
Google globals stubbed. `boot.mjs` and `gs.mjs` are the two harnesses, not
suites.

They do **not** cover pixels, realtime, auth or the xlsx export, and nothing
here sees the live database: `verify.sql` is that check and a person runs it. So
a good deal of what a change can break is only caught by reading. You cannot see
pixels; say so on any visual change.

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
- **Two columns have two claimants, and their arbitration differs.** `balance`
  is settled by a filter inside the UPDATE (`where balance is null`); `direction`
  is last-write-wins, and is only safe because both sources read the side off the
  opening deal. Anything else in `trades` has exactly one writer.
- **`null` is not `no`,** and the journal asks whether the stop and target were
  *respected*, not whether they were moved. Both halves of that trip people up.
  Column lists and the full account are in the README's Data model.
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

- **The strategy is a fourth memory and the only one she cannot write.**
  `strategy.ts` holds it; its own retrieval contract splits it — the summary and
  the rules table are appended to the CACHED system prompt, everything else is
  `get_strategy`. Putting it in a message instead pays for it on every turn and
  breaks the prefix each time the document is edited. It is markdown in a
  template literal, so every backtick in it is escaped.

  THE PREFIX STATES `ttl: "1h"`, because the default window is five minutes and
  her callers are hours apart — without it the cache only ever paid for the
  rounds inside one turn, which is less than the comments around it claimed. An
  hour also catches the replies a briefing draws through the morning and the
  09:00 retry; nothing catches 08:00 to 22:00. `cached` in `ask()`'s log line is
  the number that settles it rather than arguing it.

  R-08's four steps are in §6, and step 4 is arithmetic HE runs rather than one
  a row can check: nothing records where the stop or the target were set, so the
  ratio is asked and never computed. Do not read that 1.5 against the 1.25 as a
  pair of floors — 1:1.5 is a condition at ENTRY, and a realised 1:1.25 is the
  rule working on a shortened target and a breach on a $25 one set at entry,
  which no row can tell apart. Collapsing them in either direction is the
  contradiction v1.9 finished off.

  She has no write path to it, deliberately: a document that decides whether he
  followed his rules cannot be edited by the thing checking them. The numbering
  skips 1 and 11 and nothing cites them; every section anything cites is written.
  `readStrategy` still names a section it does not hold rather than returning
  nothing, because the number arrives from the model: a blank is a thing she
  fills in herself.

  §2 AND §3 ARE THE TWO SECTIONS THAT ARE NOT HIS — researched reference rather
  than decisions, and labelled as such where they start. Both must use the SPOKEN
  channel names from `prompt.ts` and never the database ids, which is a second
  vocabulary and therefore a second thing that can drift: `agree.test.mjs`
  resolves §2's headings against the names, not the ids. §0's table of what to do
  at each rung is the same shape for `CHANNEL_STATES`. Everything else in the
  file is his, and a rule he has not stated is a `[decide]` rather than a pattern
  read as a rule.

  §4.1 AND §4.2 ARE PROSE INSIDE §4 RATHER THAN SECTIONS OF THEIR OWN, and they
  are the only two citations in the half she carries on every turn. An exact
  lookup told her they were unwritten, which is worse than a blank: a wrong fact
  about her own document from the tool that exists to stop her inventing one.
  `readStrategy` falls back one level to the parent section, and
  `agree.test.mjs` resolves every citation in the table through it — asserting a
  dotted one names a heading actually present in what came back, since the
  fallback would otherwise answer a mistyped §4.7 with §4 and look identical to
  a citation that worked.

- **She is not a writer to `trades` and must not become one.** She reads the web,
  reads the journal through the `eugenia_trades` view, and writes only
  `eugenia_turns` and `eugenia_notes`. The view is granted `select` alone and
  hides `user_id`, `balance`, `commission` and deleted rows — but the grant
  secures the view, not the key, so the guarantee that matters is structural:
  one database read of the journal, no write path to it in the file. Do not add
  one.

  `net_pnl` IS SERVED AND `pnl` ALONE IS NOT ENOUGH, which is the one widening
  this view has had for a reason outside its own design. §8 sums `net_pnl` over
  a month; `pnl` is `coalesce(net_pnl, computed_pnl)`, so on a position whose
  broker email has not landed it is the folded figure and carries no swap — and
  this account holds through the 17:00 rollover. With both columns she sums the
  settled rows and reports how many fell back. Narrowing the view back to `pnl`
  makes every multi-day total she gives short by an unknown amount on a subset
  she cannot name, silently; `agree.test.mjs` asserts the column is there.
- **`tradesQuery` is a boundary, and its window is counted in civil days.**
  `days` comes from the model, so it is clamped and row-limited there rather
  than trusted; the bound is stepped off today's New York date, because
  `open_day` is a civil day and a fixed number of milliseconds is not one.
  `writeNote` is the other boundary: it truncates rather than refusing, because
  a tool that errors mid-turn costs the whole answer.
- **A note can be retired, and one filter is the whole of it.** `superseded_by`
  keeps the row and takes it out of the read; drop `superseded_by=is.null` from
  `readNotes` and she is handed the correction AND the thing it corrected, every
  turn, with nothing marking which is current. No error, and a note count that
  looks healthy. Three copies have to agree — the column, the filter, the tool
  parameter — and any one missing leaves the other two doing nothing.

- **The windows are small on purpose, and `search_memory` is what reaches past
  them.** Twelve turns and twenty notes of each kind are what she is HANDED;
  everything older was always in the tables and never selected. Widening a window
  puts the archive in her context, where every token is paid on every request —
  so the fix for "she cannot remember" is never a bigger limit. `eugenia_search`
  ranks notes and turns together, uses `websearch_to_tsquery` because the query
  is model-written and the strict parser throws on an unbalanced quote, and
  returns a retired note MARKED rather than hidden.

  IT ALSO SAYS WHO SAID IT, and for a long time it did not: `role` was on the
  table and not selected, so every turn rendered as `you said` and half of every
  result set was HIS words handed back as hers. The role rides in `source` —
  `note`, `you`, `him` — because `create or replace function` may not change a
  return type and dropping the function takes its grants. Those three words are
  a vocabulary shared with `searchList`'s `SAID` map; both copies are in the
  README's table and `agree.test.mjs` holds them against each other.

- **Every read of a growing table carries a limit, and it has to take the newest
  rows.** Four hundred trades, twelve turns, twenty notes, two hundred turns for
  the nightly pass. The last of those was missing and nothing failed, because a
  normal day is a handful of turns — and when it was added it was added to an
  `order=id.asc`, so it kept the FIRST two hundred: a pass that distils the
  morning and drops the evening, where a late instruction lives. Select
  newest-first and reverse for reading, as `recent()` does. A limit at the wrong
  end is indistinguishable from a limit at the right one until the day it bites.

- **Her memory has three lifetimes, not one.** An observation rolls; a standing
  instruction must outlive twenty of them, which is what `kind` is for; and what
  he UNDERSTANDS outlives both, which is what `eugenia_channels` is for. Five
  rows, never a window — and every rung carries `moved_on`, the civil day it
  last moved, formatted in UTC off a midday anchor because re-zoning a stored New
  York date moves it a day back. The ladder never descends, so without that date
  a year of use piles every channel at `owns` and the census loses the absence it
  exists to show; a rung months old counts toward the tiebreaker as a low one
  does. A channel he has never once used is a row saying
  `unseen`, where in the notes it is nothing written down and therefore
  unnoticeable. The map is a TIEBREAKER between two mechanisms that are both
  live today, never a driver of what the briefing is about — but §0 of the
  strategy gave it a second job, and that one it does drive: how much a term has
  to be built before it is used. Subject and register are two questions and the
  rung answers only the second. Only the nightly pass may move a rung, because
  one exchange is not evidence any more than one fill is a pattern.

  THE DEMOTION §0 PROMISES DOES NOT EXIST YET. §0 says *"I have lost this"* moves a channel
  back immediately and is never argued with; `set_channel` is in
  `CONSOLIDATE_TOOLS` and not in `CHAT_TOOLS`, so a reply cannot move a rung at
  all, and the README says the ladder never comes back down. The nightly pass
  reads the day's turns and holds the tool, so *that night* is the honest
  version — but building it means changing what the README states, which is his
  decision and not a repair to make while passing.
- **`/notes` is his audit, and the whole of it is addressed to him.** It is
  answered from the database rather than by the model, so nothing can paraphrase
  or drop a row — and `notesList` renders the channel map itself rather than
  appending `channelsBlock()`, which is written for HER and opens *Where he
  stands*. The one message written to him must not switch into the third person
  about him. It also means a failed channel read costs the whole reply rather
  than being swallowed, which is right here and wrong in the briefing: an audit
  that silently omits half of what it audits is the defect it exists to prevent.

- **Her notes are the only channel he has for correcting her, so `notesBlock()`
  is load-bearing on all four paths.** An instruction — *"stop mentioning the
  ten-year"* — is a note, and every later message obeys it; the conversation
  window would forget it by morning. Dropping the call from the briefing, the
  pulse or a reply fails silently: she carries on ignoring something he believes
  she took, and nothing anywhere reports it. `agree.test.mjs` reads the four
  function bodies for it, and for `channelsBlock()` beside it.
- **The prohibitions live in `prompt.ts`, and they are the product.** No signals,
  no verdict on a trade, one question at a time. The line she may now cross is
  narrow and deliberate: *what the market is pricing* and *what would surprise
  it* are facts about today and are hers to say; what price will do never is.
  Widening that further is a product decision, not a prompt tweak.
- **The briefing is prose and must stay prose.** Numbered sections with headings
  are a report however plain the words inside them; that is what the rewrite
  removed. Do not reintroduce scaffolding to "organise" it.
- **Four schedules, one hourly job, and `dueNow` picks between them.**
  `briefDue`, `pulseDue`, `retryDue` and `consolidateDue` all read `nyClock`,
  because pg_cron is UTC and a fixed expression is wrong for half the year. They
  overlap, so each answering correctly on its own settles nothing: the
  composition is the decision, and a test walks every hour of a week through
  `dueNow` because one call cannot owe two answers. Adding an hour costs nothing
  in cron — the job is `0 * * * *` and always was — which is exactly why a new
  schedule can be answered correctly and dispatched by nobody. `agree.test.mjs`
  reads `postScheduled` for a branch per answer.
- **The pulse's default is silence, and `isSilent` is how it is said.** It
  matches the bare word only, so a sentence merely opening with it is sent. Err
  toward sending: a swallowed message is invisible, an extra one is extra.
  Nothing is stored on a quiet pulse — twelve turns is the whole window and
  empty pairs would push the briefing out of it.
- **The nightly pass writes memory and sends nothing.** 22:00 New York, every
  day. Notes written mid-conversation are decided at the worst possible moment —
  while she is busy answering — and this is the only point at which she sees a
  whole day at once. The window is a fixed twenty-four hours and there is no
  watermark, because the window and the gap between runs are the same length; a
  missed night loses that day's distillation and never the day, since the turns
  stay in the table and stay searchable. That is what makes a lossy pass safe to
  run unattended. It is `high` effort, and that is not a latency decision — a
  careless note outlives a careless briefing by months.

  IT IS GIVEN WHAT IT IS ASKED TO JUDGE WITH. Two of its instructions outran its
  inputs: it is told to notice what he has started doing differently, from a
  transcript that on most days never mentions a trade — so `tradesBlock()` goes
  in — and told to prefer superseding to adding while holding twenty notes out of
  an archive it could not look at — so `SEARCH_TOOL` is in `CONSOLIDATE_TOOLS`.
  Never web search: a bookkeeping pass has nothing to research. It also logs
  where the five channels stand, which is the only meter on the one claim this
  whole design rests on.

- **Superseding is what makes the pass safe, not a convenience.** A consolidator
  that can only add is a noise generator: it cannot fix what it got wrong last
  night, and five mediocre notes push five good ones out of a twenty-note
  window. The prompt pulls toward writing almost nothing and toward retiring
  rather than adding.

- **What is stored is the raw turn, never the augmented one.** Notes and the
  week's trades are rebuilt every turn; storing them would resend a stale copy
  as history for the next six briefings.
- **The history window is repaired, not assumed.** Pairs are written in one
  INSERT, but a concurrent one can take a sequence value between them, so an
  even window can still open on an assistant turn — which the Messages API
  refuses outright. `openOnUser` trims to the first user turn; nothing may go
  back to depending on `HISTORY` being even.
- **A briefing can exceed Telegram's 4,096 characters.** `chunk` splits it and
  the parts go sequentially; Telegram does not promise ordering. Its preference
  is paragraph break, then any newline, then a hard cut, and it must stay two
  lookups rather than a `max()` over the pair: `lastIndexOf('\n')` is always at
  or past `lastIndexOf('\n\n')`, so a max can only ever return the plain newline
  and the paragraph preference silently never happens. The prompt aims
  well under the cap, so this is the exception now — do not delete it for being
  quiet.
- **Effort is per caller, and it is the latency dial.** The briefing runs `high`;
  a reply and the pulse run `medium`. Nothing here runs `low`, because a careless
  read of the journal is worse than a slow one.
- **A beta flag is a header on a raw fetch, never a `betas` body field.** The
  `betas: [...]` array is the SDKs' parameter and they turn it into
  `anthropic-beta`. This file uses `fetch`, so the header is the only form that
  works — and an unknown top-level parameter is a 400, which is every call.
- **The container is not optional once web search is in play.** `web_search_20260209`
  runs code execution for its dynamic filtering, so the model can call
  `get_trades` from inside that container; the continuation must carry
  `container` (a bare string on the request, `container.id` on the response) or
  the API rejects it. Neither tool may set `strict: true`, and the message
  answering those calls must hold only `tool_result` blocks. Getting this wrong
  is a 400 that kills the whole briefing, and it did.
- **A failure must reach him, not the console.** pg_net discards the response,
  `net._http_response` is pruned within hours, and nobody reads Edge logs — so
  the cron half messages Telegram on failure and retries at 09:00–11:00 ET until
  `briefedToday()` sees the marker. Do not quietly remove either half.
- **Her Telegram half must answer before it works, never after.** Telegram gives
  a webhook about a minute and then redelivers — which would run a whole
  briefing twice and bill for both. `background()` + `EdgeRuntime.waitUntil` is
  what makes the 200 immediate. The cron half has no such limit: pg_net never
  retries.

---

## On handback

State plainly what was changed, what was verified by running, what by reading,
and what could not be verified.

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
- **`004_cron.sql` holds every schedule and is safe to re-run.** `cron.schedule`
  upserts on the job name, so applying the file makes the database match it. Add
  a new scheduled job there, never in a feature's own file.
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

Both have already caused a silent failure, and both fail the same way — the
wrong spelling reads as empty and something else happens quietly:

- **`doji_cron_secret`** in Vault, **`DOJI_CRON_SECRET`** in Edge secrets.
  Postgres compares the Vault name case-sensitively. Gladys's trigger shipped
  reading the upper-case one and went quiet without failing anything.
- **`SB_SECRET_KEY`**, never `SUPABASE_SECRET_KEY`. Supabase owns the
  `SUPABASE_` prefix, so no secret can be created under it and a function
  reading that name gets `""` whatever the dashboard shows. The code read it
  for months while the legacy service_role JWT quietly served every request
  through a fallback.

Before adding a third: `verify.sql` catches a database-side mismatch, and a 503
at boot catches a secrets-side one. Neither catches a name that is merely
*wrong*, so check a new one against the surface that stores it.
