# CLAUDE.md — working context for Doji

This file is the context a Claude Code session starts from. It is **subordinate
to `README.md`**: where anything here disagrees with the README, the README wins
and you say so. The README is the contract for how the app behaves; this file is
how to work on it, and it holds only what the README does not — every
description of behaviour lives there, once.

Doji is a personal XAUUSD trading journal: one `index.html` of ~3,800 lines, one
flat namespace, **no build step, no bundler**. Four writers share one Supabase
table — the app, the cTrader poller (Edge Function), the email parser (Apps
Script), and Gladys, the Telegram journal bot (one more Edge Function). Journal
columns and broker columns never meet; that single idea is what the whole design
rests on. Eugenia, the market bot, would be the fifth writer and is not: she
owns only her own conversation and her own notes.

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
  `CONFIG.BE_AGG` (±$10, a day/week/month cell), `CONFIG.PERIODS`, `Data.OWNED`,
  `resultOf`, `money()`, `byKey` and the shared primitives each exist so a rule
  changes once. Never compute the same thing a second way in a second spot — and
  that includes prose: a fact stated in the README does not get restated here.
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

## Tests — run both, always

```sh
npm install   # once — jsdom, and nothing else
npm test
```

Node 22.6+. `test/fold.test.mjs` covers the pure logic of the poller and of
`functions/doji-telegram/index.ts`; `test/app.test.mjs` boots `index.html` in
jsdom with a recording Supabase stand-in. They do **not** cover pixels, realtime,
auth, the xlsx export, or the Apps Script — so a good deal of what a change can
break is only caught by reading. You cannot see pixels; say so on any visual
change.

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
- **A wrong direction, P&L or date cannot be fixed in `index.html`.** The app
  does not own those columns; the fault is upstream in the poller or the parser.
  Say so rather than looking for it in the app.
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
  That guard is also why the three shared primitives live in `_shared/edge.ts`
  and not in one of the functions: importing a module that serves at its top
  level would start that function inside the caller.
- **The `COLUMNS` map is the whole guarantee.** It holds the same four names as
  `Data.OWNED`, so no broker column is nameable from a tap. A test asserts
  exactly that; do not widen it without widening the test.
- **`callback_data` must stay under 64 bytes.** It is the entire state store —
  no session table, no `tg_message_id`, no schema change — and a longer setup
  name is the way it would silently overrun.

---

## Eugenia

- **She is not a writer to `trades` and must not become one.** She reads the web,
  reads the journal through the `eugenia_trades` view, and writes only
  `eugenia_turns` and `eugenia_notes`. The view is granted `select` alone and
  hides `user_id`, `balance`, `commission` and deleted rows — but the grant
  secures the view, not the key, so the guarantee that matters is structural:
  one database read of the journal, no write path to it in the file. Do not add
  one.
- **`tradesQuery` is a boundary.** Its `days` comes from the model, so it is
  clamped and row-limited there rather than trusted. `writeNote` is the other
  one: it truncates rather than refusing, because a tool that errors mid-turn
  costs the whole answer.
- **The prohibitions live in `prompt.ts`, and they are the product.** No signals,
  no verdict on a trade, one question at a time. The line she may now cross is
  narrow and deliberate: *what the market is pricing* and *what would surprise
  it* are facts about today and are hers to say; what price will do never is.
  Widening that further is a product decision, not a prompt tweak.
- **The briefing is prose and must stay prose.** Numbered sections with headings
  are a report however plain the words inside them; that is what the rewrite
  removed. Do not reintroduce scaffolding to "organise" it.
- **Two schedules, one hourly job.** `briefDue` and `pulseDue` both read
  `nyClock`, because pg_cron is UTC and a fixed expression is wrong for half the
  year. A test walks every hour of a week asserting they never both fire — one
  call cannot owe two answers.
- **The pulse's default is silence, and `isSilent` is how it is said.** It
  matches the bare word only, so a sentence merely opening with it is sent. Err
  toward sending: a swallowed message is invisible, an extra one is extra.
  Nothing is stored on a quiet pulse — twelve turns is the whole window and
  empty pairs would push the briefing out of it.
- **What is stored is the raw turn, never the augmented one.** Notes and the
  week's trades are rebuilt every turn; storing them would resend a stale copy
  as history for the next six briefings.
- **`HISTORY` has to stay even.** Turns are written in pairs, so an odd window
  starts on an assistant turn and the Messages API refuses it.
- **A briefing can exceed Telegram's 4,096 characters.** `chunk` splits it and
  the parts go sequentially; Telegram does not promise ordering. The prompt aims
  well under the cap, so this is the exception now — do not delete it for being
  quiet.
- **Effort is per caller, and it is the latency dial.** The briefing runs `high`;
  a reply and the pulse run `medium`. Nothing here runs `low`, because a careless
  read of the journal is worse than a slow one.
- **Her Telegram half must answer before it works, never after.** Telegram gives
  a webhook about a minute and then redelivers — which would run a whole
  briefing twice and bill for both. `background()` + `EdgeRuntime.waitUntil` is
  what makes the 200 immediate. The cron half has no such limit: pg_net never
  retries.

---

## On handback

State plainly what was changed, what was verified by running, what by reading,
and what could not be verified.
