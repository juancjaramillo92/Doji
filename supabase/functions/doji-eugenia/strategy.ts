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
// SECTIONS 1, 2, 3, 9, 10 AND 11 DO NOT EXIST. Four of them are cited — §2 for
// the market model, §9 for the leg of a failure that leaves no signature, §10
// for what would have to change before a judgment rule could be checked, and §1
// only by the retrieval contract's own list. get_strategy says so plainly rather
// than returning nothing: a blank is a thing she fills in herself, and a rule
// pointing at reasoning nobody can read is worth knowing about.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = "v1.7";

/* Always in context, appended to the cached system prompt. The summary is the
   whole strategy said once; the table is every rule with how it is checked. */
export const ALWAYS = `

HIS TRADING STRATEGY, version v1.7. This is what he has decided, and it is not
yours to change — you read it, you do not edit it.

XAUUSD only, intraday to multi-session, positions held for the move they were
opened for. Two setups, selected by where price sits in a marked structure:
Support & Resistance at the outer extremes of the range, Break & Retest at
interior levels and quarters. Every entry takes profit $30 from entry price — shortened
to $25 after entry where the level looks hard to reach or is showing reversal — and stops at
most $20 from it. Reward-to-risk must be at least 1:1.5 to enter, and 1:1.25 is
the floor of what can be realised once a target is shortened. Stop moves to break-even once price has travelled $20 toward the
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
| R-01 | Take profit set $30 from entry price, or $25 where the level looks hard to reach or is turning | trade | \`followed_tp\` | journal | no win with \`abs(exit_price − entry_price) < 25\` | §5 | v1.0 |
| R-02 | Stop never beyond $20 from entry price | trade | \`followed_sl\` | journal | no loss with \`abs(exit_price − entry_price) > 20\` | §5 | v1.0 |
| R-03 | No entry after a full-stop loss on the same day | day | \`followed_rules\` | journal | within an \`open_day\`, no \`entry_time\` later than the \`fill_time\` of a loss closing at its \`planned_stop\`; \`unknown\` where no plan was recorded | §5 | v1.0 |
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

**Version** v1.7 · **Effective from** [decide] · **Supersedes** v1.6

### Summary

*The only part of this document always loaded into Eugenia's context. Everything
below §0 is retrieved on demand. It earns its length more than anything else in
the file.*

XAUUSD only, intraday to multi-session, positions held for the move they were
opened for. Two setups, selected by where price sits in a marked structure:
Support & Resistance at the outer extremes of the range, Break & Retest at
interior levels and quarters. Every entry takes profit $30 from entry price — shortened
to $25 after entry where the level looks hard to reach or is showing reversal — and stops at
most $20 from it. Reward-to-risk must be at least 1:1.5 to enter, and 1:1.25 is
the floor of what can be realised once a target is shortened. Stop moves to break-even once price has travelled $20 toward the
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

**There is none, and that is a decision rather than an omission.** The stop is at
most $20 from entry. A loss that closed further away than that was not a $20 stop
being filled badly — it was a stop that had been moved — so the predicates
compare against 20 and 30 flat, with nothing added.

Stated here rather than left implicit because the alternative was live for a
version: a tolerance wide enough to absorb slippage is also wide enough to absorb
a stop moved a couple of dollars, and every rule that compares a price distance
would have inherited it.

**A false positive costs a question, not a conclusion.** Reconciliation is
one-way — she names the gap and stops, and never corrects a marker or decides
what it meant — so a flagged trade is something he looks at, and erring tight is
the right direction to err. What it must not become is frequent: a check that
cries wolf teaches him to ignore it, which is the same failure §7 records for a
stale zone map.

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

  "4": `## 4 · The setups

Two, and **the difference between them is not where they are taken.** That is the
consequence; the difference is which way each one trades relative to the level.

**Break & Retest is a continuation trade.** A level has already broken, and the
break is the premise. Price extends away, comes back, and the level it broke is
now the other thing — resistance that has become support, or support that has
become resistance. The entry is on that retest and it goes THROUGH the level, in
the direction of the break.

**Support & Resistance is a mean-reversion trade.** Nothing has broken. The level
is intact, price arrives at it and refuses, and the entry goes AWAY from the
level, back into the range it came from.

So one trades a level that has failed, and the other trades a level that is
holding. Interior levels and quarters are where levels break and flip as price
works through a range, and the extremes are the boundaries that turn it back —
which is why R-05 and R-06 read as rules about location. **They are rules about
method, and location is how the method is recognised.**

That distinction decides what a per-setup statistic means. A win rate split by
\`setup\` is a comparison of continuation against mean-reversion, not of one part
of the chart against another.

### 4.1 · Break & Retest

Journal value: \`Break & Retest\`. Taken at interior levels and quarters, never at
an extreme (R-05).

**The premise is the break, and the trade is the retest.** Entering on the
breakout itself is a different trade and not this one: the retest is what
separates a level that has genuinely flipped from a push that is about to fail
back. It is also what makes the stop tight, since the level being retested is
close by — and a tighter stop for the same target is where this setup's
reward-to-risk comes from.

**Confirmation is required at the retest, not at the break.** A signal is price
reaching the flipped level and rejecting it; confirmation is a close in the
intended direction, or the reaction resolving clearly enough to enter before one
(§6, R-07).

**Invalidation is price closing back on the original side of the level.** That is
the break having been false, and it is a different event from the stop being hit:
the idea is wrong at that close whether or not price has travelled far enough to
take the stop out.

The stop sits beyond the retest extreme, within the $20 cap. Everything else —
target, break-even at +$20, one position — is §5 and §6 and is not restated here.

**How it loses:** the break was liquidity rather than intent, so the retest keeps
going and closes back through. Read as continuation, it is the only failure this
setup has.

### 4.2 · Support & Resistance

Journal value: \`Support & Resistance\`. Taken at the outer extremes of the range
only, never at an interior level (R-06). The extremes are few and thick, which is
what makes them worth fading and what makes an entry there rarer than an interior
one.

**The premise is that the level holds.** Price arrives, refuses, and the trade is
the refusal — a signal is that rejection, and confirmation is the close or the
read (§6, R-07).

**INVALIDATION IS A CLOSE BEYOND THE LEVEL, NEVER A WICK THROUGH IT**, and this
is the single most important line in either subsection. A wick that pierces the
extreme and closes back inside is a liquidity sweep: the stops resting beyond the
level were taken and price refused anyway, which is the level holding rather than
failing.

That is why §6 allows re-entry after a sweep takes the stop and price comes
rapidly back. It is not an exception to the rules and not a revenge trade — the
idea was never invalidated, the stop was simply inside the sweep. The trade being
stopped out and the idea being wrong are two different events at an extreme, and
only the second one ends it.

**How it loses:** the range is over. A level that had turned price back stops
doing so, and a fade taken into a break is the failure this setup has — the
mirror of §4.1's, and the reason R-09 restricts both to obvious trends and
cycles.`,

  "5": `## 5 · Risk

### Risk per trade is 4% of account, and that is deliberate

The stop is never beyond $20 of price distance from entry, and size comes from
the ladder — 0.02 lots per $1,000, continuous. Those two facts fix the third:

    0.02 lots = 2 oz    account $1,000    $20 stop = $40    = 4.0%
    0.10 lots = 10 oz   account $5,000    $20 stop = $200   = 4.0%

The ladder is linear, so the share is the same at every rung. **He set it knowing
that**, which is why it is written here as a number rather than left to fall out
of two others — a figure nobody has stated is a figure nobody can be held to, and
this one is the single most consequential quantity in the document.

What 4% means in the shape of a month, so it is not abstract: **two and a half
full stops erase a +10% month**, and **1.7 winners at $30 make one**. The target
in §0 and the risk here are the same decision seen from two ends.

Deriving it rather than storing it is deliberate too. \`size_oz\` is on the row, so
the account tier and therefore the dollar risk of any past trade are recoverable
from the trade itself, and a second column stating the percentage could disagree
with the ladder that produced it.

### The day ends at 4%, which is one full stop

The daily limit and the per-trade risk are the same number seen twice. 4% of
account is what a full stop costs, so R-03 ending the day after a full stop and a
4% daily cap are one rule, not two — which is why there is no second limit
written beside it.

It does mean losses that are not full stops still count toward it. Three exits
cut by hand at a third of a stop each have spent the day exactly as one full stop
would, and R-03's predicate does not see that, because the row it looks for is a
loss closing at its planned stop. The limit is the 4%; the full stop is the usual
shape of reaching it.

### Nothing else caps a loss, and that is deliberate

**No weekly maximum. No monthly maximum.** The day is the only window with a
limit, and a run of bad days is not stopped by anything written here.

### One position, always

One trade at a time. He does not scale in, does not add, and does not hold two
positions at once — so the $20 stop is the whole exposure rather than a per-leg
figure, and 4% is the most that can be at risk at any moment.

### Nothing changes size but the ladder

No setup is sized up, no session is sized down. The rung is the only input, and
it moves only as above.

### Moving up a rung is discretionary, and it is a deposit rather than a threshold

**He changes it by hand, when he feels like it.** That is the rule, and it is
stated first because it is the part that decides what can be checked: there is no
trigger a program could evaluate, so nothing here is ever a violation and no run
of trades at one size means anything on its own.

What he described alongside it is the pattern, not a condition: **holding the 10%
for a couple of months at the current size**, then depositing and moving to the
next level. The rung follows the money in, and the money in follows the months.
It is what he does, which is different from what he must do, and reading it as a
rule would produce findings about a decision he never bound himself to.

So the ladder does not track the balance. It is not re-read per trade and it does
not step the moment an account crosses a number — which is why §8 computes the
month against the size actually traded rather than against a balance delta, and
why that section says this account is funded in steps. These are those steps.

Two things follow. A good month does not by itself move the rung, so a size that
has not changed is not evidence of anything having gone wrong. And because the
increase is funded rather than compounded, the 4% above survives the change: the
new rung is 4% of the new account, not a larger share of the old one.

**Coming back down is not stated.** The rule is written for the upward direction
only, and nothing here says what happens to the rung after a bad stretch —
whether it is reduced, and on what. That gap is the half of a sizing rule that
matters when it matters most.`,

  "6": `## 6 · Lifecycle

### Before the trade

R-08 requires a pre-trade sequence run in order, with a failed step ending it
rather than being weighed against the others. **The same five steps for both
setups:**

1. **Top-down bias**
2. **Liquidity pools and support/resistance**
3. **Psychological levels**
4. **Candle or chart pattern** — signal first, then confirmation
5. **Reward-to-risk of at least 1:1.5**

The order is the rule. A failed step ends the sequence rather than being traded
off against a later one, so a setup that fails step 1 is not rescued by a clean
step 4 — which is what separates this from a checklist where enough ticks carry
a trade.

Steps 1 to 4 are read, and nothing stored can see them. **Step 5 is arithmetic,**
and since \`planned_stop\` and \`planned_target\` are recorded at entry it is the one
step a row can be held to:

    (planned_target − entry_price) / (entry_price − planned_stop)  >=  1.5

Step 4 is where §6's signal and confirmation sit: the rejection is the signal,
the close or the read is the confirmation, and R-07 is that step failing.

R-09 restricts him to obvious trends and cycles, and what makes a trend obvious
is read from **price action**. That is a judgment rather than a condition, which
is why R-09 is marked \`judgment\` and asks him rather than checking anything.

### Entry

A signal is price reaching a level and rejecting, and it is not an entry.
Confirmation is required and is either a candle closing in the intended
direction, or the reaction around the level resolving clearly enough to enter
before a close. Entering on the signal with neither is the violation R-07 names.

**Entry is at market.** There is no resting limit back into the level, so the
fill is where price was when he decided rather than a price he chose in advance —
which is part of why slippage is treated as his in §0 rather than allowed for.

### While it is on

The stop moves to break-even once price has travelled $20 toward the target. The
target may be shortened from $30 to $25 where the level looks hard to reach or is
showing reversal. Beyond those two, nothing is done to a position: no partial
exits, no adding, no widening.

**Re-entry after a stop-out is allowed, in one shape.** Where a liquidity sweep
takes the stop and price comes rapidly back to the level he was trading, he may
enter again. It is the same idea, not a new one, and it is the only case in which
a level that has already stopped him out is tradeable again the same session.

### Exit

**Price-based, never time-based.** A trade ends at its target, at its stop, or at
break-even once R-04 has moved the stop there. Nothing closes a position for
having taken too long, and a trade going nowhere is left alone rather than cut —
§0's *held for the move they were opened for* is what that phrase has always
meant.

### Recording

**He journals at entry**, which is what makes \`planned_stop\` and \`planned_target\`
worth anything: they are written before the stop moves, so they record the plan
rather than a memory of it. A journal filled in at the end of the day would
capture the same two prices as whatever the trade ended up doing, and every
question they exist to answer would quietly become circular.

The three discipline answers ask whether the stop and target were *respected*,
not whether they were moved. \`null\` is unanswered and is not "no".`,

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
| R-01 | Take profit set $30 from entry price, or $25 where the level looks hard to reach or is turning | trade | \`followed_tp\` | journal | no win with \`abs(exit_price − entry_price) < 25\` | §5 | v1.0 |
| R-02 | Stop never beyond $20 from entry price | trade | \`followed_sl\` | journal | no loss with \`abs(exit_price − entry_price) > 20\` | §5 | v1.0 |
| R-03 | No entry after a full-stop loss on the same day | day | \`followed_rules\` | journal | within an \`open_day\`, no \`entry_time\` later than the \`fill_time\` of a loss closing at its \`planned_stop\`; \`unknown\` where no plan was recorded | §5 | v1.0 |
| R-04 | Stop to break-even once price reaches +$20 | trade | \`followed_sl\` | judgment | *"Did this one reach +$20 before it turned?"* — asked on full-stop losses only | §6 | v1.0 |
| R-05 | Break & Retest at interior levels and quarters only, never at an extreme | trade | \`followed_rules\` | judgment | *"Was this at an extreme or in the interior?"* | §4.1 | v1.0 |
| R-06 | Support & Resistance at the outer extremes of the range only | trade | \`followed_rules\` | judgment | *"Was this the outer boundary, or a level inside the range?"* | §4.2 | v1.0 |
| R-07 | A rejection alone is not an entry — confirmation required, by close or by read | trade | \`followed_rules\` | judgment | *"Close, read, or neither?"* | §6 | v1.0 |
| R-08 | Pre-trade sequence run in order; a failed step ends it rather than being weighed | trade | \`followed_rules\` | judgment | *"Which step did you stop at, if any?"* | §6 | v1.0 |
| R-09 | Only operate in obvious trends and cycles | trade | \`followed_rules\` | judgment | *"Was the trend obvious, or were you reading into it?"* | §6 | v1.0 |

### Notes on individual rules

**THERE ARE TWO REWARD-TO-RISK NUMBERS AND THEY ARE AT DIFFERENT MOMENTS.** The
document carried them as one and they contradicted each other.

**At entry it is 1:1.5, and it is a condition.** Step 5 of §6's sequence refuses
the trade below it, so with the stop at its $20 cap the target has to be $30. A
$25 target set AT ENTRY would be 1:1.25 and fails step 5 — it is only reachable
with a stop tighter than about $16.70.

**After entry the realised floor is 1:1.25**, because the target may be shortened
from $30 to $25 once the trade is on. That is a management decision under §6, not
an entry that skipped step 5, and it is the whole reason the two numbers differ.

So R-01 and R-02 bound what may be SET, and step 5 bounds what may be ENTERED.
The floor is not a third rule restating an identity — it is a condition on the
plan, and it is checkable from the planned columns rather than from the outcome.

**R-01 IS TWO-SIDED, AND THE LOWER BOUND IS THE HALF THAT CATCHES ANYTHING.**
The target may be shortened to $25 when the level looks hard to reach or is
turning, so a win at $25 is the rule working. A win BELOW $25 is a position
closed before any target he is allowed to set, which is the discretionary exit
the predicate exists to find — and it is the common failure, where an overshoot
is not.

Two targets are intended, $30 and $25. A win landing between them was neither,
so it is worth a question even though the predicate lets it pass; the floor is
what is checked because it is the only part that is unambiguous.

Break-evens are not caught by this and must not be: an exit within $3 of entry
is a scratch by result, not a win, so R-04 firing never reads as a target
missed.

**R-02 is the highest-value check in the table.** A loss that closed further from
entry than $20 was not a $20 stop — the stop had been moved — and there is no
tolerance in the comparison, for the reason §0 gives. It is also the rule most
likely to disagree with its own marker: \`followed_sl = true\` on a row with a $34
loss distance is a concrete discrepancy, not an inference.

**R-01 IS NOT ITS MIRROR, and the difference is what a larger distance means.**
On a loss, further from entry is always worse than intended. On a WIN it can be
better: a take profit sitting at $30 fills at $30 or through it, so a gap fills
at $30.60 with the order never having moved. R-01 flags that identically to a
target genuinely moved further out, and nothing on the row separates them.

So an R-01 flag is a question rather than a finding — ask which it was. If gaps
turn out to be common enough that the check stops being read, the honest fix is
to record the target at entry, not to widen the number until the noise stops.

**R-03 IS CHECKABLE NOW, AND IT WAS THE POPULATION THAT WAS MISSING RATHER THAN
THE PREDICATE.** The comparison was always simple — within an \`open_day\`, no
\`entry_time\` later than the \`fill_time\` of a full-stop loss. What could not be
answered was WHICH losses were full stops, because §12 allows a stop set tighter
than $20 and the broker reports only the final one, so a $12 loss could not be
told from an exit cut by hand.

\`planned_stop\` settles it: a loss that closed at its planned stop is a full stop,
whatever the distance, and one that closed short of it was cut. The rule is
\`journal\` on every row carrying a plan.

**It is \`unknown\`, never \`pass\`, on the rest.** Every trade before the column
existed has no plan, and so does anything he did not journal — and a day whose
only loss cannot be classified has not been shown compliant, it has been left
unexamined. The narrowed fallback that read losses at $20 as full stops is
retired: it under-detected, and it is not needed now.

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

**The planned stop and target are on the row now**, entered by hand at the time
under \`planned_stop\` and \`planned_target\`. They are the only record of intent
this system has: the broker reports the final stop, so a stop moved to
break-even has erased the original everywhere else, and nothing recovers it
afterwards.

Three things become answerable that were not — R-03's full-stop population, the
planned R:R, and whether a win at $25 was a shortened target or an early close.
All three only on rows carrying a plan, and \`unknown\` on the rest rather than
\`pass\`: everything before the columns existed is null, permanently.

They are journal-owned and **app-entered rather than tappable**. Gladys takes
\`callback_query\` alone and there is no inline keyboard for 4512.80, which is why
her \`COLUMNS\` map holds four names while \`Data.OWNED\` holds six.

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

**Full stop.** A loss closed at the stop — $20 of price distance from entry, or
tighter where the stop was set tighter at entry. The second half is not
identifiable from a row today (see R-03), so *the checkable definition is the
first half only* and it under-detects. Distinguished from a break-even and from a
manually tightened exit, and it is the only close that ends the trading day.

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

**R:R.** Planned and realised are two numbers at two moments. **Planned, at
entry: at least 1:1.5**, which is step 5 of §6's sequence and a condition on
taking the trade at all — with the stop at $20 that means a $30 target.
**Realised: 1:1.25 at worst**, once a $30 target has been shortened to $25 on a
trade already open. A realised 1.25 is the shortening working, not an entry that
skipped step 5, and the two must not be compared as though they answered the
same question. In the app, realised: average win ÷ average loss over
closed P&L. They are different numbers and the app's cannot be read as the plan.
Both are stored now, so on a row carrying a plan the two ARE comparable and a
realised 1:1.25 can be told from a $30 target that was shortened. On a row
without one — everything before the columns existed — it still cannot, and that
is \`unknown\` rather than an assumption.`,

  "13": `## 13 · Changelog

The write path. Findings, retired rules and rule changes are recorded here, and
the §7 table read afterwards is whatever this section last left in place. Rule
IDs are never reused, even after retirement — a recycled ID silently falsifies
history.

| Version | Effective from | Change | From lesson |
|---|---|---|---|
| v1.0 | [decide] | Initial document. R-01 through R-09. | — |
| v1.7 | [decide] | R-08's five steps written: top-down bias, liquidity pools and S&R, psychological levels, candle or chart pattern with signal then confirmation, and reward-to-risk of at least 1:1.5. Step 5 is arithmetic and checkable from the planned columns. It also settles a contradiction the document was carrying — 1:1.5 is a condition at ENTRY, 1:1.25 the realised floor after a permitted shortening: two numbers at two moments rather than one disagreeing with itself. | His rules |
| v1.6 | [decide] | §4 written. The two setups differ by METHOD, not location — Break & Retest is continuation through a level that has flipped, Support & Resistance is mean-reversion off a level that is holding; location is how each is recognised. Invalidation stated per setup, and §6's re-entry rule is shown to follow from S&R's rather than being an exception to it. | Method research, anchored to his stated rules |
| v1.5 | [decide] | §5 and §6 written. Risk per trade is 4% and is deliberate; the rung moves by hand; 4% is also the daily limit, and there is no weekly or monthly one. One position at a time, nothing else changes size. Entry at market, exits price-based only, journalled at entry. Re-entry allowed after a liquidity sweep that snaps back to the level. R-08's sequence is recorded as existing but not written down. | His answers |
| v1.4 | [decide] | \`planned_stop\` and \`planned_target\` are recorded at journalling time. R-03 moves from \`field\` to \`journal\` — it was the full-stop population that was missing, not the predicate — and is \`unknown\` rather than \`pass\` on rows with no plan. §8 and §12 restated: intent is on the row, and planned R:R is recoverable where a plan exists. | Schema change |
| v1.3 | [decide] | The target may be shortened from $30 to $25 where the level looks hard to reach or is showing reversal. R-01 gains its lower bound and becomes two-sided — the §7 [decide] on early exits is answered. The R:R floor is restated as 1:1.25, being the shortest allowed target over the widest allowed stop. | His decision |
| v1.2 | [decide] | Tolerance settled at none: the stop is at most $20, so a loss further out is a stop that moved, and R-01/R-02 compare flat. \`TOL\` retired from §0 and §12. Recorded that R-01 is not R-02's mirror — a gap through the target enlarges the distance without anything having moved. | His decision |
| v1.1 | [decide] | \`TOL\` named in §0 and R-01/R-02 given executable predicates. R-03 relabelled \`field\` — the full-stop population needs a planned stop. §8 records \`size_oz\` and the account arithmetic it enables, and the \`pnl\` fallback that makes \`net_pnl\` the figure for any multi-day total. | Review of v1.0 against the live schema |`,

};
