// ═══════════════════════════════════════════════════════════════════════════
// THE STRATEGY — his rules, as they stand
// ───────────────────────────────────────────────────────────────────────────
// The fourth thing she remembers, and the only one she cannot write. Turns are
// a window, notes are what she noticed, the archive is searchable — and this is
// what he has DECIDED, which none of those can be.
//
// A TS module rather than a markdown file, for the reason prompt.ts is one: a
// function is deployed as its own directory and an import is the one way to be
// certain a file travels with it. It is markdown inside a template literal, so
// EVERY BACKTICK IS ESCAPED — a new one written plainly ends the string, and the
// failure is a build error rather than anything subtle.
//
// TWO EXPORTS, BECAUSE THE DOCUMENT ASKS FOR TWO. Its own retrieval contract
// says the summary and the rules table are always in context and everything else
// is fetched when a conversation needs it. ALWAYS rides on the cached system
// prefix, so it is paid once rather than per turn; SECTIONS is what get_strategy
// serves. Loading all of it instead would be roughly ten thousand characters
// against every message, competing with the briefing for attention.
//
// SECTIONS 1-6 AND 9-11 DO NOT EXIST YET. §7 references them because they are
// drafted separately, and get_strategy says so plainly rather than returning
// nothing — a rule pointing at reasoning nobody can read is worth knowing about.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = "v1.1";

/* Always in context, appended to the cached system prompt. The summary is the
   whole strategy said once; the table is every rule with how it is checked. */
export const ALWAYS = `

HIS TRADING STRATEGY, version v1.1. This is what he has decided, and it is not
yours to change — you read it, you do not edit it.

XAUUSD only, intraday to multi-session, positions held for the move they were
opened for. Two setups, selected by where price sits in a marked structure:
Support & Resistance at the outer extremes of the range, Break & Retest at
interior levels and quarters. Every entry takes profit $30 from entry price and
stops at most $20 from it, so reward-to-risk has a floor of 1:1.5 by
construction. Stop moves to break-even once price has travelled $20 toward the
target. One full stop ends the trading day. Position size is on the row in
ounces; lots are ounces ÷ 100 and \`account = lots × 50,000\`. Target is +10% of
account every month.

THE RULES, and the Evaluable column is the one that matters: journal means it can
be checked against a row today, field means a column would have to exist first,
judgment means it cannot be checked from stored data at all. A judgment rule is
not a weaker rule — it is one whose compliance nothing can see, and it never
counts as kept just because nothing contradicted it.

| ID | Rule | Scope | Marker | Evaluable | Predicate / Probe | § | Introduced |
|---|---|---|---|---|---|---|---|
| R-01 | Take profit set $30 from entry price | trade | \`followed_tp\` | journal | no win with \`abs(exit_price − entry_price) > 30 + TOL\` | §5 | v1.0 |
| R-02 | Stop never beyond $20 from entry price | trade | \`followed_sl\` | journal | no loss with \`abs(exit_price − entry_price) > 20 + TOL\` | §5 | v1.0 |
| R-03 | No entry after a full-stop loss on the same day | day | \`followed_rules\` | field | needs \`planned_stop\` at entry to identify the full-stop population — see the note | §5 | v1.0 |
| R-04 | Stop to break-even once price reaches +$20 | trade | \`followed_sl\` | judgment | *"Did this one reach +$20 before it turned?"* — asked on full-stop losses only | §6 | v1.0 |
| R-05 | Break & Retest at interior levels and quarters only, never at an extreme | trade | \`followed_rules\` | judgment | *"Was this at an extreme or in the interior?"* | §4.1 | v1.0 |
| R-06 | Support & Resistance at the outer extremes of the range only | trade | \`followed_rules\` | judgment | *"Was this the outer boundary, or a level inside the range?"* | §4.2 | v1.0 |
| R-07 | A rejection alone is not an entry — confirmation required, by close or by read | trade | \`followed_rules\` | judgment | *"Close, read, or neither?"* | §6 | v1.0 |
| R-08 | Pre-trade sequence run in order; a failed step ends it rather than being weighed | trade | \`followed_rules\` | judgment | *"Which step did you stop at, if any?"* | §6 | v1.0 |
| R-09 | Only operate in obvious trends and cycles | trade | \`followed_rules\` | judgment | *"Was the trend obvious, or were you reading into it?"* | §6 | v1.0 |

Call get_strategy for the reasoning behind any of this.`;

/* Fetched on demand. The keys are the section numbers as the document writes
   them, so a rule citing §8 names the thing get_strategy serves. */
export const SECTIONS: Record<string, string> = {
  "0": `## 0 · Header

**Version** v1.1 · **Effective from** [decide] · **Supersedes** v1.0

### Summary

*The only part of this document always loaded into Eugenia's context. Everything
below §0 is retrieved on demand. It earns its length more than anything else in
the file.*

XAUUSD only, intraday to multi-session, positions held for the move they were
opened for. Two setups, selected by where price sits in a marked structure:
Support & Resistance at the outer extremes of the range, Break & Retest at
interior levels and quarters. Every entry takes profit $30 from entry price and
stops at most $20 from it, so reward-to-risk has a floor of 1:1.5 by
construction. Stop moves to break-even once price has travelled $20 toward the
target. One full stop ends the trading day. Position size is on the row in
ounces; lots are ounces ÷ 100 and \`account = lots × 50,000\`. Target is +10% of
account every month.

### What this document is

A description of behaviour and reasoning. It states no view on where price will
go. Market behaviour appears in §2 as mechanism only.

### Retrieval contract

§0's summary and §7's table are always in context. §1–§6 and §8–§13 are fetched
when a conversation needs them. §7 points back to the prose rather than
restating it, so nothing in this file is written twice.

**This is a contract, not a mechanism.** Nothing enforces it until a
\`get_strategy\` tool exists that serves §0 and §7 by default and a named section
on request. Until then the whole document is either in context or none of it is,
and the split above is a description of what should happen rather than of what
does.

### Tolerance

One named value, used by every rule that compares a price distance: **\`TOL\` =
$[decide]**.

It exists because "materially above 30" and "20 plus slippage" are not
predicates — they read as checks and cannot be executed, and a rule that cannot
be executed but is labelled as though it can is worse than one honestly marked
\`judgment\`.

**Set it from the data rather than by guessing.** The distribution of
\`|exit_price − entry_price|\` across closed losses on this account already
contains the answer: real slippage clusters just past the intended stop, and a
moved stop lands well beyond it. Pick the value that separates the two, and
record here what the distribution looked like when it was picked so that a later
reader can tell whether it still holds.

Single-sourced deliberately, the way \`CONFIG.BE = 3\` is. Three rules depend on
it and they must not drift apart.

### Write access

Eugenia reads \`trades\` and cannot write to it. This document is her only
persistent state: findings, retired experiments and rule changes are recorded in
§13 by the trader, and the §7 table she reads next week is whatever §13 last
left there.

**The loop is missing its inbound edge.** She has no way to put a finding in
front of you — \`eugenia_notes\` is her own memory, not a proposal queue — so a
conclusion reached on a Tuesday reaches §13 only if you remember it. Until a
proposal path exists, §13 is written from conversation and nothing guarantees a
finding survives to reach it.`,

  "7": `## 7 · The rules, enumerated

Every rule the sections above impose, in one table a program can hold you to.
The prose is not repeated here — the Rule column is a handle, and §-references
point at the reasoning.

**Evaluable** is the load-bearing column:

- \`journal\` — computable from a row today. A predicate is given and it is not
  optional.
- \`field\` — would be computable if a column existed. The column is named.
- \`judgment\` — cannot be checked from stored data at all, permanently or until
  §10's blockers clear. A probe is given instead: the question Eugenia asks
  rather than the check she runs.

A \`judgment\` rule is not a weaker rule. It is a rule whose compliance the system
cannot see, and labelling it is what stops it quietly counting as passing.

**Marker** is the rollup. \`followed_rules\`, \`followed_sl\` and \`followed_tp\` are
one boolean each, covering every rule mapped to them — so a self-report of
\`true\` is a claim about all of them at once, and a \`journal\` rule reading false
underneath one is a discrepancy worth raising.

| ID | Rule | Scope | Marker | Evaluable | Predicate / Probe | § | Introduced |
|---|---|---|---|---|---|---|---|
| R-01 | Take profit set $30 from entry price | trade | \`followed_tp\` | journal | no win with \`abs(exit_price − entry_price) > 30 + TOL\` | §5 | v1.0 |
| R-02 | Stop never beyond $20 from entry price | trade | \`followed_sl\` | journal | no loss with \`abs(exit_price − entry_price) > 20 + TOL\` | §5 | v1.0 |
| R-03 | No entry after a full-stop loss on the same day | day | \`followed_rules\` | field | needs \`planned_stop\` at entry to identify the full-stop population — see the note | §5 | v1.0 |
| R-04 | Stop to break-even once price reaches +$20 | trade | \`followed_sl\` | judgment | *"Did this one reach +$20 before it turned?"* — asked on full-stop losses only | §6 | v1.0 |
| R-05 | Break & Retest at interior levels and quarters only, never at an extreme | trade | \`followed_rules\` | judgment | *"Was this at an extreme or in the interior?"* | §4.1 | v1.0 |
| R-06 | Support & Resistance at the outer extremes of the range only | trade | \`followed_rules\` | judgment | *"Was this the outer boundary, or a level inside the range?"* | §4.2 | v1.0 |
| R-07 | A rejection alone is not an entry — confirmation required, by close or by read | trade | \`followed_rules\` | judgment | *"Close, read, or neither?"* | §6 | v1.0 |
| R-08 | Pre-trade sequence run in order; a failed step ends it rather than being weighed | trade | \`followed_rules\` | judgment | *"Which step did you stop at, if any?"* | §6 | v1.0 |
| R-09 | Only operate in obvious trends and cycles | trade | \`followed_rules\` | judgment | *"Was the trend obvious, or were you reading into it?"* | §6 | v1.0 |

### Notes on individual rules

**R-01 and R-02 are the two primitives, and the 1:1.5 floor is their
consequence.** There is deliberately no rule enforcing the floor: with the
target fixed at 30 and the stop capped at 20 it cannot be violated while both of
these hold, and a third rule restating an arithmetic identity is a rule that can
only ever agree with the other two.

**R-01 catches overshoots only, and that is a decision not yet made.** A win
closing at +$9 is a target that was not respected in the other direction, and it
passes this predicate cleanly. If §6 permits discretionary early exits then the
rule is right as written and §6 should say so plainly. If it does not, R-01
needs a lower bound as well and the predicate above is half a rule.
**[decide]** — and note the answer is not recoverable from history either way,
so it has to be stated rather than measured.

**R-02 is the highest-value check in the table.** A loss wider than $20 is
either slippage or a stop moved away from entry, and the two are distinguishable
by how far past $20 it lands — which is exactly what \`TOL\` is calibrated to
separate. It is also the rule most likely to disagree with its own marker:
\`followed_sl = true\` on a row with a $34 loss distance is a concrete
discrepancy, not an inference.

**R-03 is \`field\`, not \`journal\`, and the reason is the population rather than
the predicate.** The comparison itself is simple — within an \`open_day\`, no
\`entry_time\` later than the \`fill_time\` of a full-stop loss — and \`fill_time\` is
present on exactly the rows it depends on. What is not available is *which
losses are full stops.* §12 defines a full stop as roughly $20 from entry **or
tighter where the stop was set tighter at entry**, and the planned stop is
nowhere on the row, so a $12 loss cannot be told apart from a manually tightened
exit. Recording \`planned_stop\` at entry closes it.

Until then a narrower version is available and should be labelled as what it is:
losses within \`TOL\` of $20 are identifiable full stops, so the rule can be
checked over *those* and returns \`unknown\` rather than \`pass\` for a day whose
only loss was tighter. That under-detects, and a clean result means less than it
appears to.

**R-04 cannot be confirmed, only violated.** Whether a losing trade ever reached
+$20 is not recoverable: \`entry_price\` and \`exit_price\` are endpoints, and the
path between them is not stored anywhere, including at the broker. The gap is
one-sided — a win proves its own excursion, and a break-even is R-04 having
fired — so the probe fires on full-stop losses alone.

**R-05 and R-06 are judgment because of where the zone map lives, not because
they are vague.** Both are precise rules about position in a marked structure.
The structure is maintained in TradingView and deliberately not mirrored here: a
map kept in two places disagrees with itself, and a stale boundary produces
false violations that teach the trader to ignore real ones. See §10.

**R-05 can only ever be violated, never confirmed.** An empty population returns
\`unknown\`, not \`pass\`. A clean run means either that the rule was kept or that
no extreme has broken lately, and the journal cannot separate those. Silence is
silence — it is not evidence of discipline.

### Six of nine are judgment, and most of them need not be

R-04, R-05, R-06 and R-07 are each **a single question at journalling time**
rather than an unanswerable one at analysis time. *Did it reach +$20 before it
turned? Extreme or interior? Close, read, or neither?* Each is one tap while the
trade is fresh, and each would move that rule from \`judgment\` to \`field\`.

Gladys already draws a four-row keyboard with \`callback_data\` under sixty-four
bytes, so this is an established pattern rather than new machinery — subject to
the same constraint that a longer setup name is how that budget silently
overruns.

R-04 is the strongest case: maximum favourable excursion is genuinely
unrecoverable afterwards and trivially answerable in the moment. It is the one
gap in this table that gets permanently worse every day it is not closed.

This is a bigger change to what the table can see than any market data would be,
and it is deliberately recorded here rather than acted on: widening what Gladys
asks is a product decision. **[decide]**`,

  "8": `## 8 · Journal binding

What a row can answer, what it cannot, and the filters that have to be applied
before any of it is read. This section exists because a rate computed over the
wrong population looks exactly like a rate computed over the right one.

### What is on a row

**Broker-owned** — written by the poller and the email parser, never by the app:
\`direction\` · \`entry_time\` · \`fill_time\` · \`entry_price\` · \`exit_price\` ·
\`size_oz\` · \`open_day\` · \`commission\` · \`balance\` · \`net_pnl\` · \`computed_pnl\` ·
\`pnl\`.

**Journal-owned** — written by the app alone: \`setup\` · \`followed_rules\` ·
\`followed_sl\` · \`followed_tp\`.

**Derived at read time, never stored:** \`result\` (win / loss / break-even) ·
\`session\` (five buckets) · filing day · completeness.

### Position size, and what it now makes computable

\`size_oz\` is the position size **in ounces**, as opened. Ounces because that is
the unit both broker sources state it in — cTrader sends a volume the poller
divides by a hundred, and the alert email prints \`Volume  Oz 4.00\` — so storing
anything else would mean converting away from what both of them actually said.

    lots     = size_oz / 100
    account  = lots × 50,000   =  size_oz × 500

**Two limits, and neither is small.** It is written by the poller alone, so a
position the poller never reached carries no size and never will — the email
boundary is five columns by design and widening it would trade a stated property
of that design for coverage of old rows. And it is null on every row that closed
before the column existed. So anything reading sizes filters for it rather than
assuming it, and any account figure derived from history starts at the date the
column landed rather than at the start of the journal.

### What is still not on a row, and why

**Maximum favourable excursion.** How far a trade travelled before it turned.
Not stored and not available from the broker, which is what makes R-04 a probe
and what makes asking at journalling time the only way it is ever recoverable.

**The planned stop.** What the stop was set to at entry, as against the final
stop the broker reports. Its absence is why R-03 is \`field\` and why realised R:R
cannot be read as planned R:R. A stop moved to break-even has overwritten the
original risk and nothing anywhere remembers it.

**Which rule broke.** \`followed_rules\` is one boolean covering R-03 and R-05
through R-09. It records that something broke, not what.

**Whether an entry was an override.** A setup correctly identified as bad and
taken anyway files identically to a good one. §9's first leg has no signature.

### Three verdicts

\`pass\` · \`fail\` · \`unknown\`. The third is not a formality. It mirrors the
journal's own three-state boolean, where \`null\` means unanswered and is not the
same as \`no\` — every broker fill arrives with all three markers null, so a blank
must never count as a miss.

The same rule one layer up: a \`judgment\` rule with no answer is \`unknown\`, a
\`journal\` rule whose population came back empty is \`unknown\`, and a rule whose
population was narrowed by a missing column — R-03 today — is \`unknown\` outside
the narrowed set rather than \`pass\` across the whole of it. None of them is
\`pass\`.

### Population filters

Applied to every query, not remembered case by case.

| Filter | Why |
|---|---|
| \`id like 'PID%'\` | Pre-sync rows carry client-generated ids and null timestamps. Any hunt for broker-data problems sweeps them up as false positives. |
| \`deleted = false\` | Soft-deleted rows stay in the table so the poller cannot resurrect them. |
| \`pnl is not null\` | An open position is in neither the win nor the loss side. A missing figure is not a break-even. |
| both prices present | The scratch band is a distance in price. A row without both cannot be evaluated by it and falls back to the same $3 read against P&L. |
| \`entry_time is not null\` | Anything reading \`session\` — see the seam below. |
| \`size_oz is not null\` | Anything deriving account, lots or a percentage. Absent on poller-missed rows and on everything predating the column. |
| \`net_pnl is not null\` | Monthly and multi-day P&L — see below. |

### The session seam

\`session\` derives from \`entry_time\`, falling back to \`fill_time\` when there is
none. So a fill the poller never reached is filed by when it **closed** rather
than when it opened. This account holds across sessions deliberately, which
means those rows land in a later bucket than they belong to, systematically.

Flag it whenever session data is read for a pattern spanning that boundary. The
repair is \`?force=1&hours=N\` with a wide lookback, which fixes the rows
permanently; the signature of a sliced row is \`exit_price is null\` on a closed
trade. Repair, then read — do not exclude the rows and call the result clean.

### \`pnl\` is a fallback, and reading it is not the same as choosing it

\`pnl\` is a generated column: \`coalesce(net_pnl, computed_pnl)\`. So reading \`pnl\`
**is** reading \`computed_pnl\` on every row whose broker email has not landed —
which is the one case this account cannot afford, because \`computed_pnl\` is
folded from deals and carries no swap, and positions here are held through the
17:00 rollover.

"Read \`pnl\`, never \`computed_pnl\`" is therefore not achievable by naming a
column. Any figure summed across days either requires \`net_pnl is not null\`, or
reports how many rows fell back to \`computed_pnl\` alongside the total. A monthly
P&L that quietly omits swap on an unknown subset is wrong by an unknown amount,
which is worse than one that is late.

### Break-even means R-04 fired

The ±$3 scratch band is a price distance, so a stop moved to entry lands inside
it by construction. Break-evens on this account are therefore mostly R-04
working, not random scratches, which makes the break-even count a meaningful
figure: roughly, how often a move went most of the way and turned.

It follows that **a break-even close is never evidence of a violated stop.** The
markers ask whether the stop and target were *respected*, not whether they were
moved, and moving to break-even at +$20 is the rule. Do not invert the polarity.

### Reconciliation is one-way

Where a \`journal\` rule and its marker disagree, Eugenia names the gap and stops.
She does not correct a marker, infer what was meant, or fill an \`unknown\`. She
cannot resolve one — she can only ask, and the answer is the trader's to give or
withhold.

That disagreement is the most valuable signal the system produces. Neither the
self-report nor the derived value says anything on its own.

### Sample

No claim from a single trade. Per-trade conversations are for processing;
patterns belong to the weekly. Where a comparison is under observation rather
than under test — session performance, \`close\` versus \`read\` entries — it is
reported on request only, never volunteered and never framed as a finding.

### Monthly P&L

Sum of \`net_pnl\` over the month's filing days, divided by the account the month
was traded at — \`size_oz × 500\` off a representative row, since size is what
account tier is read from and the tier is what the target is a percentage of.

Never a balance delta: transfers move \`balance\` with no trade behind them, and
this account is funded in steps.

\`net_pnl\` rather than \`pnl\` for the reason above, and rows lacking it are
counted and reported rather than silently dropped — the count is the honest
error bar on the figure.

**Where the account tier is read from is a decision.** Size varies as rungs are
stepped, so a month spanning a change has no single account. First trade of the
month, last trade, or largest — **[decide]**, and once decided it goes in §12 as
a definition rather than being chosen again each month.`,

  "12": `## 12 · Definitions

Terms used as if precise. Where the app already defines one, this is that
definition and not a second version of it.

**Break-even (scratch).** An exit within ±$3 of the entry price, at any size.
Measured in price rather than dollars because $3 of P&L is $3 of gold at 0.01
lots and three cents of it at 1.00 — a dollar band would mean something
different at every rung of the ladder. Win and loss still come from the sign of
the P&L; price distance is unsigned.

**Decided.** A trade carrying a P&L. Break-evens are decided and sit in the
win-rate denominator, so scratches drag the rate down rather than vanishing from
it. An open position is not decided and is absent from both sides.

**Complete.** A setup and all three discipline answers present. P&L is
deliberately not required — an open position can be journalled before it closes.

**Filing day.** \`open_day\` where the poller supplied one, otherwise the New York
civil day of the closing fill. The day a trade is counted under.

**Session.** One of five buckets — Asian, Asia+London, London, London+NY, New
York — derived from \`entry_time\` against each financial centre's own local
hours, so London's boundary moves with its own daylight saving. Nothing is
stored and there is no override.

**Size.** \`size_oz\`, in ounces, as the position was opened — not as it was
closed, which differs on a partial exit. Lots are ounces ÷ 100. Poller-written
only, and null on anything it never reached or that predates the column.

**\`TOL\`.** The single price tolerance every distance rule compares against, set
in §0 from the observed distribution of loss distances. Not a fudge factor: it
is the width of real slippage on this account, and it is what separates slippage
from a moved stop.

**Full stop.** A loss closed at the stop — within \`TOL\` of $20 of price distance
from entry, or tighter where the stop was set tighter at entry. The second half
is not identifiable from a row today (see R-03), so *the checkable definition is
the first half only* and it under-detects. Distinguished from a break-even and
from a manually tightened exit, and it is the only close that ends the trading
day.

**Extreme.** The outer boundary of the marked range. Few, thick, and where
Support & Resistance is traded.

**Interior level.** A marked level inside the range, and quarters. Where Break &
Retest is traded.

**Signal.** Price reaches a level and rejects. Not an entry on its own.

**Confirmation.** Either a candle closing in the intended direction (*close*),
or the reaction around the level resolving clearly enough to enter before a
close (*read*). Both are valid. Entering on the signal with neither is not.

**Rung.** A step on the sizing ladder. \`account = lots × 50,000\`, continuous —
0.02 lots per $1,000 at every size.

**R:R.** In this document, planned: $30 target over a stop of at most $20. In
the app, realised: average win ÷ average loss over closed P&L. They are
different numbers and the app's cannot be read as the plan — the planned stop is
not stored, so the plan is not recoverable from any row.`,

  "13": `## 13 · Changelog

The write path. Findings, retired rules and rule changes are recorded here, and
the §7 table read afterwards is whatever this section last left in place. Rule
IDs are never reused, even after retirement — a recycled ID silently falsifies
history.

| Version | Effective from | Change | From lesson |
|---|---|---|---|
| v1.0 | [decide] | Initial document. R-01 through R-09. | — |
| v1.1 | [decide] | \`TOL\` named in §0 and R-01/R-02 given executable predicates. R-03 relabelled \`field\` — the full-stop population needs a planned stop. §8 records \`size_oz\` and the account arithmetic it enables, and the \`pnl\` fallback that makes \`net_pnl\` the figure for any multi-day total. | Review of v1.0 against the live schema |`,

};
