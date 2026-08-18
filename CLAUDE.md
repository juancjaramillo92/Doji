# CLAUDE.md — working context for Doji

This file is the context a Claude Code session starts from. It is **subordinate
to `README.md`**: where anything here disagrees with the README, the README wins
and you say so. The README is the contract for how the app behaves; this file is
how to work on it.

Doji is a personal XAUUSD trading journal: one `index.html` of ~4,000 lines, one
flat namespace, **no build step, no bundler**. Four writers share one Supabase
table — the app, the cTrader poller (Edge Function), the email parser (Apps
Script), and the Telegram bot (two more Edge Functions). Journal columns and
broker columns never meet; that single idea is what the whole design rests on.

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
  inlined.
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
  changes once. Never compute the same thing a second way in a second spot.
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

The same applies to reasoning. A conclusion drawn from a value you have just
proved is corrupt is worth nothing. **State mechanisms you can trace, not stories
that fit.** If a claim rests on a number, say which number and check it is one you
trust.

---

## Tests — run both, always

```sh
npm install   # once — jsdom, and nothing else
npm test
```

Node 22.6+. `test/fold.test.mjs` covers the pure logic of the poller and of
`functions/_shared/telegram.ts`;
`test/app.test.mjs` boots `index.html` in jsdom with a recording Supabase
stand-in. They do **not** cover pixels, realtime, auth, the xlsx export, or the
Apps Script — so a good deal of what a change can break is only caught by
reading. You cannot see pixels; say so on any visual change.

---

## Domain rules that constrain the code

- **`README.md` is the contract.** Read it before proposing a change; update it
  in the same pass if the change makes any part of it untrue.
- **Reuse the shared primitives.** `mountDonut`, `wheelBlock` + `paintWheel`,
  `sessionBars` (`.sess-wr-*`), `disciplineBar`, `rollRow`, `--bar-h`,
  `DONUT_CUTOUT` / `RESULT_FILL` / `RESULT_BORDER` / `SEG_BD`. Chart.js cannot
  read a CSS variable, so anything it needs is resolved through `cssToken()` into
  a module constant. Never hand-roll a new component.
- **No renderer mutates state.**
- **The snapshot is a read cache and can never be anything else.** Painted on
  open, before the token check and the fetch answer; never written back.
- **Broker sync must never overwrite journal fields.** `Data.OWNED` is the
  definitive list — a save sends those columns and nothing else, enforced in one
  place. Deletes are a soft `deleted: true` flag.

### The data model, in one breath

Journal-owned (app writes these, poller never sends them): `setup`,
`followed_rules`, `followed_sl`, `followed_tp`. The three booleans have a third
state — `null` is unanswered, **not** `no`. Polarity: the journal asks whether
the stop and target were *respected*, not whether they were moved.

Broker-owned (the app never writes these): `direction`, `entry_time`,
`fill_time`, `entry_price`, `exit_price`, `open_day`, `commission`, `balance`,
`net_pnl`, `computed_pnl`, and generated `pnl`. **A wrong direction, P&L or date
cannot be fixed in `index.html`** — the fault is upstream in the poller or the
parser. Say so rather than looking for it in the app.

### The poller has two windows, and they are not the same question

Write window (`LOOKBACK_HOURS`, 6h): which positions get upserted. Fold window
(`write + MAX_POSITION_HOURS`, 78h): which deals get read. The fold reads wide
because `foldPosition` takes direction from the earliest deal it is given; a
narrow read hands it a closing deal with no entry, direction inverts, and
`entry_time`/`entry_price`/`open_day` are overwritten with the exit's values. A
manual DB correction older than the write window sticks; a forced backfill
overwrites it. Repairs are `?force=1&hours=N`; the signature of a sliced row is
`exit_price is null` on a closed trade.

---

## The Telegram journal — shipped

`README.md` carries the full account; this is what constrains code you write
near it.

- **It is the fourth writer and it stays in the journal half.** The webhook maps
  a button's field to a column through the same four names as `Data.OWNED`. No
  broker column is nameable from a tap, so there is nothing to arbitrate.
- **`callback_data` is the entire state store.** `PID562780708|setup|Break &
  Retest`, `PID562780708|edit` — trade, field, value, 39 bytes at worst against
  Telegram's 64. No session table, no `tg_message_id`, no schema change. Whether
  a settled message has been reopened is read off the keyboard already on it:
  four rows open, one row settled.
- **The trigger guard is load-bearing.** `when (new.entry_time > now() -
  interval '1 hour')` on `after insert`. Verified against the real column types
  and the restore SQL: an `on conflict do update` is not an insert, restored rows
  carry historical `entry_time`, and an email-first row has none at all, so
  `null > anything` keeps it silent.
- **Answering `followed_sl`/`followed_tp` at open records intent, not outcome**,
  and biases those two bars upward when a needed edit is never made. The mirror
  of the `null`-is-not-`no` rule.
- **Everything either function decides lives in
  `supabase/functions/_shared/telegram.ts`**, because that is the part a test can
  reach. `secretMatches` is duplicated there rather than imported from the
  poller: that file calls `Deno.serve` at module scope, so importing it would
  start a second poller inside whichever function imported it.

---

## On handback

State plainly what was changed, what was verified by running, what by reading,
and what could not be verified.
