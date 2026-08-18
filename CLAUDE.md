# CLAUDE.md — working context for Doji

This file is the context a Claude Code session starts from. It is **subordinate
to `README.md`**: where anything here disagrees with the README, the README wins
and you say so. The README is the contract for how the app behaves; this file is
how to work on it.

Doji is a personal XAUUSD trading journal: one `index.html` of ~4,000 lines, one
flat namespace, **no build step, no bundler**. Three writers share one Supabase
table — the app, the cTrader poller (Edge Function), and the email parser (Apps
Script). Journal columns and broker columns never meet; that single idea is what
the whole design rests on.

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

Node 22.6+. `test/fold.test.mjs` covers the Edge Function's pure logic;
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

## Pending work — the Telegram journaling bot

Goal: when a trade opens, the trader gets a Telegram message and answers the
whole journal from it — setup and all three discipline booleans — without opening
the app.

### Decisions already made (do not relitigate)

- **Transport is a Telegram bot, not WhatsApp.** WhatsApp needs a business number
  and its 24-hour window forces pre-approved templates; a Telegram bot has its
  own identity, needs no new number, and can message freely once the trader has
  sent `/start` once.
- **Fires at trade open**, i.e. `after insert on trades`. The poller mints the
  row from the entry deal alone, so setup and the three booleans are null at that
  point. An open position may be journalled before it closes — the README already
  allows this.
- **All four answers at open.** The trader follows SL and TP strictly, so
  answering `followed_sl`/`followed_tp` at open is intended behaviour, and a
  missed case is corrected later via the message's Edit button. No second message
  at close.
- **One self-editing message.** Inline keyboard, four rows (setup + rules + stop
  + target), answered in any order. Each tap writes one column and `editMessageText`
  redraws the message in place; the fourth answer settles it to a one-line summary
  carrying an `[Edit]` button that restores the full keyboard. One thread entry,
  not five.
- **`[Edit]` button only — no text-reply path.** Editing reopens the same
  keyboard via `callback_data`; there is no natural-language parsing of replies.
  (A text-reply path would need a stored `tg_message_id` and phrase
  interpretation — rejected as fragile. Revisit only if attaching a free-text
  *note* to a trade becomes a wanted feature, which is a different thing.)

### How it hangs together

- **`callback_data` grammar:** `PID562780708|setup|Break & Retest`,
  `PID562780708|sl|1`. Under Telegram's 64-byte cap with room to spare, and it
  carries the trade id, the field and the value — so **no schema change** and no
  session table. The callback payload also carries `chat.id` and
  `message.message_id`, which is what `editMessageText` targets.
- **The insert trigger must be guarded** or a restore-from-backup fires it for
  every row in the file. Proposed guard: `when (new.entry_time > now() -
  interval '1 hour')` — a live fill is always minutes old; a restored historical
  row and a null-`entry_time` pre-sync row are both excluded. A `?force=1`
  backfill is an UPDATE on existing ids, so it stays silent on its own. **Confirm
  this against the real column types and the restore SQL before trusting it.**
- **Two Edge Functions.** Send: invoked by the trigger via `pg_net`, reads the
  bot token and chat id, posts the message. Webhook: `verify_jwt = false` (Meta…
  Telegram calls it unauthenticated), validates the
  `X-Telegram-Bot-Api-Secret-Token` header against the stored secret, writes the
  answer, returns 200 **fast** or Telegram retries. Both should read like the
  poller wrote them — same imports, same secret reads, same error handling.
- **The write is a fourth writer, strictly inside the journal half.** Service
  role, `update trades set … where id = $1`, sending only the four `Data.OWNED`
  columns. Nothing to arbitrate. The resulting `updated_at` broadcast re-renders
  any open browser tab for free.
- **Secrets live in Supabase Edge Function secrets, never in the repo:**
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`. Names are
  read verbatim in code, so keep them exact. (Same discipline as `DOJI_EMAIL` /
  `DOJI_PASSWORD` in the Apps Script — value never in the file.)

### Two failure modes to code for, not discover

- A **double-tap** sends two identical webhook calls; the second `editMessageText`
  returns `400 message is not modified`. That must not be treated as fatal.
- The webhook must **return 200 quickly** or Telegram redelivers, producing the
  same tap twice anyway.

### A data-integrity note worth a comment in the code

Answering `followed_sl`/`followed_tp` at open records *intent*, not *outcome*.
The field only measures respect if the edit is actually made on the occasions it
is needed; a missed edit reads as compliance, biasing exactly those two bars
upward. This is the mirror of the `null`-is-not-`no` rule the app already
protects, and whoever documents the feature should say so.

---

## What this file's author could NOT verify

This context was assembled from `README.md`, `index.html` and the design
conversation — **not** from the schema, the Edge Function or the test files,
which were not readable at the time. Before trusting any of the Telegram plan,
a Code session should:

1. Confirm the trigger idiom and the `entry_time` guard against the real
   `supabase/001_trades.sql` — column types, the `updated_at` trigger, and the
   restore-from-backup `insert … on conflict` path.
2. Match the two new Edge Functions to the poller's actual idiom in
   `supabase/functions/doji-mcp-sync/index.ts` — imports, secret reads, error
   and truncation handling.
3. Cover the `callback_data` parse and the keyboard builder in
   `test/fold.test.mjs` against the `boot.mjs` harness — and break each on
   purpose first, per the rule above.
4. Verify whether Telegram caps editing a bot's own message in a private chat.
   If there is a cap, the `[Edit]` button on an old trade fails and must fall
   back to sending a fresh message rather than editing the old one.

State plainly, on handback, what was changed, what was verified by running, what
by reading, and what could not be verified.
