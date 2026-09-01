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
// serves. Loading all of it instead would be close to sixty thousand characters
// against every message, competing with the briefing for attention.
//
// THE SUMMARY IS WRITTEN ONCE, IN SUMMARY, AND INTERPOLATED INTO BOTH. It used
// to be typed out twice — in ALWAYS and again in SECTIONS["0"] — which is two
// hand-maintained copies of the one paragraph she carries on every single turn.
// Nothing held them together, and the copy that drifted would have been the one
// she never stops reading.
//
// SECTIONS 1, 3 AND 11 DO NOT EXIST AND ARE NOT CITED. They were placeholders in
// a numbering that outlived them; six holes read as an unfinished document,
// where a numbering that simply skips reads as a decision. §2, §9 and §10 were
// the three that carried citations, and all three are now written.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = "v1.9";

/* The whole strategy said once. Interpolated into ALWAYS and into §0, so the
   paragraph she holds on every turn and the paragraph get_strategy serves are
   the same characters and cannot disagree. */
const SUMMARY = `XAUUSD only, intraday to multi-session, positions held for the move they were
opened for. Two setups, told apart by method rather than by location: Break &
Retest is a continuation trade through an interior level that has broken and
flipped, Support & Resistance a mean-reversion trade off an outer extreme that is
holding. Take profit is **$30 from entry price by default**, $25 by exception
where the level looks hard to reach. The stop is a **ceiling of $20** and is set
at entry from where the chart shows the idea to be wrong, so it is frequently
tighter — it is never moved tighter once the trade is on. Reward-to-risk must be
at least 1:1.5 to enter, which the default $30 target satisfies at any permitted
stop. Stop moves to break-even once price has travelled $20 toward the target.
One full stop ends the trading day. One position at a time. Position size is on
the row in ounces; lots are ounces ÷ 100 and \`account = lots × 50,000\`. Target is
+10% of account every month.`;

/* Always in context, appended to the cached system prompt. The summary is the
   whole strategy said once; the index is how she knows what to fetch; the table
   is every rule with how it is checked. */
export const ALWAYS = `

HIS TRADING STRATEGY, version ${VERSION}. This is what he has decided, and it is
not yours to change — you read it, you do not edit it.

${SUMMARY}

WHAT IS IN THE REST OF THE DOCUMENT, so you know when a question needs it. Call
get_strategy with the number.

- §0 header, retrieval contract, tolerance, notation, write access
- §2 the market model — the five channels, mechanism only, no forecasting
- §4 the setups, and what tells them apart
- §5 risk, the sizing ladder, the day's limit
- §6 lifecycle — the four-step sequence, entry, management, exit, recording
- §7 the rules, enumerated, with predicate or probe for each
- §8 journal binding — what a row can answer, and the filters that come first
- §9 how he actually fails, and why nothing stored can see it
- §10 what would have to change for a judgment rule to become checkable
- §12 definitions
- §13 changelog

§8 BEFORE ANY NUMBER. A rate computed over the wrong population looks exactly
like a rate computed over the right one, and nothing cites §8 — it is on you to
fetch it.

THE RULES, and the Evaluable column is the one that matters: journal means it can
be checked against a row today, field means a column would have to exist first,
judgment means it cannot be checked from stored data at all. A judgment rule is
not a weaker rule — it is one whose compliance nothing can see, and it never
counts as kept just because nothing contradicted it.

| ID | Rule | Scope | Marker | Evaluable | Predicate / Probe | § | Introduced |
|---|---|---|---|---|---|---|---|
| R-01 | Take profit $30 from entry price, or $25 where the level looks hard to reach | trade | \`followed_tp\` | journal | no win with \`abs(exit_price − entry_price) < 25\` | §5 | v1.0 |
| R-02 | Stop never beyond $20 from entry price | trade | \`followed_sl\` | journal | no loss with \`abs(exit_price − entry_price) > 20\` — the CAP only, see §7 | §5 | v1.0 |
| R-03 | No entry after a full-stop loss on the same day | day | \`followed_rules\` | field | within an \`open_day\`, no \`entry_time\` later than the \`fill_time\` of a full-stop loss; only losses at $20 are identifiable, so \`unknown\` elsewhere | §5 | v1.0 |
| R-04 | Stop to break-even once price reaches +$20 | trade | \`followed_sl\` | judgment | *"Did this one reach +$20 before it turned?"* — asked on full-stop losses only | §6 | v1.0 |
| R-05 | Break & Retest at interior levels and quarters only, never at an extreme | trade | \`followed_rules\` | judgment | *"Was this at an extreme or in the interior?"* | §4.1 | v1.0 |
| R-06 | Support & Resistance at the outer extremes of the range only | trade | \`followed_rules\` | judgment | *"Was this the outer boundary, or a level inside the range?"* | §4.2 | v1.0 |
| R-07 | A rejection alone is not an entry — confirmation required, by close or by read | trade | \`followed_rules\` | judgment | *"Did you wait, or did you take the touch?"* — see §9 | §9 | v1.0 |
| R-08 | Pre-trade sequence run in order; a failed step ends it rather than being weighed | trade | \`followed_rules\` | judgment | *"Which step did you stop at, if any?"* | §6 | v1.0 |
| R-09 | Only operate in obvious trends and cycles | trade | \`followed_rules\` | judgment | *"Was the trend obvious, or were you reading into it?"* | §6 | v1.0 |
| R-10 | One position at a time — no scaling in, no adding, no second trade open | trade | \`followed_rules\` | journal | no two rows whose \`entry_time\`→\`fill_time\` spans overlap | §5 | v1.9 |
| R-11 | The day ends at −4% of account, however it was reached | day | \`followed_rules\` | journal | within an \`open_day\`, no \`entry_time\` later than the \`fill_time\` of the loss that took cumulative P&L past −4% of \`size_oz × 500\` | §5 | v1.9 |

Call get_strategy for the reasoning behind any of this.`;

/* Fetched on demand. The keys are the section numbers as the document writes
   them, so a rule citing §8 names the thing get_strategy serves. */
export const SECTIONS: Record<string, string> = {

  "0": `## 0 · Header

**Version** ${VERSION} · **Effective from** [decide] · **Supersedes** v1.8

### Summary

*The only part of this document always loaded into Eugenia's context. Everything
below §0 is retrieved on demand. It earns its length more than anything else in
the file.*

${SUMMARY}

### What this document is

A description of behaviour and reasoning. It states no view on where price will
go. Market behaviour appears in §2 as mechanism only.

### Retrieval contract

§0's summary, a one-line index of every section, and §7's table are always in
context. Everything else is fetched when a conversation needs it. §7 points back
to the prose rather than restating it, so nothing in this file is written twice.

**It is now a mechanism as well as a contract.** \`get_strategy\` serves any
section by number and a subsection is served by the section that holds it, so a
citation to §4.1 returns §4. A section that does not exist is *named* rather than
answered with a blank, because a blank is something she fills in herself.

**The index exists because nothing cites §8.** Every other section is reachable
from a rule's § column; §8 is not, and it is the section that decides whether a
number means anything. A tool she can call is not a tool she knows when to call.

### Tolerance

**There is none, and that is a decision rather than an omission.** The predicates
compare against the rule's own numbers flat, with nothing added for slippage.

Stated here rather than left implicit because the alternative was live for a
version: a tolerance wide enough to absorb slippage is also wide enough to absorb
a stop moved a couple of dollars, and every rule that compares a price distance
would have inherited it.

**The stop is a ceiling, not a value, and R-02 is one-sided because of it.** $20
is the most the stop may ever be; where it actually sits is read off the chart at
entry and is frequently tighter. So a loss closing further than $20 from entry is
a stop that was moved, and a loss closing at $14 is consistent with either a $14
stop respected or a $20 stop cut short — and no row says which. R-02 catches the
first and is blind to the second, by construction rather than by oversight (§7).

**A false positive costs a question, not a conclusion.** Reconciliation is
one-way — she names the gap and stops, and never corrects a marker or decides
what it meant — so a flagged trade is something he looks at, and erring tight is
the right direction to err. What it must not become is frequent: a check that
cries wolf teaches him to ignore it, which is the same failure §7 records for a
stale zone map.

### Notation

**\`[decide]\`** marks a value he has not settled. Say so rather than supplying
one, and never infer it from behaviour — a pattern read as a decision produces
findings about something he never bound himself to.

**Rule IDs are never reused**, even after retirement. A recycled ID silently
falsifies history.

### Write access

Eugenia reads \`trades\` and cannot write to it. **This document is the one part
of her memory she cannot write** — turns are a window, notes are hers, and this
is what he decided. Findings, retired experiments and rule changes are recorded
in §13 by the trader, and the §7 table she reads next week is whatever §13 last
left there.

**The loop is missing its inbound edge.** She has no way to put a finding in
front of him — \`eugenia_notes\` is her own memory, not a proposal queue — so a
conclusion reached on a Tuesday reaches §13 only if he remembers it. Until a
proposal path exists, §13 is written from conversation and nothing guarantees a
finding survives to reach it.`,

  "2": `## 2 · The market model

**Mechanism only.** This section exists so that a briefing and a trade review use
the same vocabulary, and so that §0's *states no view on where price will go* has
something concrete behind it rather than being a promise about tone.

**The rule that governs everything here: state the chain, stop at the chain.**
*Hawkish repricing → real yields up → the opportunity cost of holding a
non-yielding asset rises → downward pressure on gold* is analysis. *So gold falls
today* is a forecast and is not hers to make. The difference is not hedging
language; it is where the sentence ends.

### The five channels

These are the five in \`eugenia_channels\`, and the names are the same strings the
table holds. Her channel map tracks which of them he has met, used and owns, so
using another vocabulary in conversation makes that map describe nothing.

**\`rates_vs_inflation\` — real interest rates and central-bank policy.** The
dominant channel. Gold yields nothing, so what it competes against is the real
return on holding dollars: the nominal yield minus expected inflation. Real
yields rising is the single most reliable source of downward pressure; falling
real yields the reverse. This is why a hot inflation print is ambiguous rather
than bullish — it lifts expected inflation, which lowers real yields, *and* it
lifts hike expectations, which raises nominal ones, and which of the two wins is
the question rather than the answer.

**\`dollar\` — the US dollar.** Gold is priced in dollars, so a stronger dollar
makes the same ounce cost more in every other currency and weighs on demand
outside the US. Watch DXY, and watch it against yields: when the two disagree,
the disagreement is the story.

**\`inflation\` — CPI and PCE.** Feeds the first channel through expectations
rather than acting on its own. Core over headline, because policy responds to
core; the surprise against consensus over the level, because a print that matches
expectations is already in the price.

**\`jobs\` — employment.** NFP, claims, JOLTS. Labour is the input the Fed reacts
to fastest, so a deteriorating labour market is a rate-cut argument and reaches
gold through the first channel. Weight forward-looking prints above
backward-looking ones and say when doing so.

**\`central_bank_buying\` — official-sector demand.** The slowest channel and the
only one that is a flow rather than a price. Sustained reserve accumulation is a
persistent bid that does not appear in any yield or dollar series, which is why
it can hold a floor under a market the other four channels are pressing down on.

### Two framings that apply to all five

**Pre-priced versus new information.** Markets move on surprises, not on events.
A speech confirming what is already priced is close to neutral however hawkish it
sounds. Ask what was expected before asking what happened.

**The referee test.** Watch whether yields move *with* or *against* gold to
identify which channel has control that day. Gold up with yields up is not the
rates channel driving — look at the dollar, or at safe-haven demand.

### What this section is not

It is not a market view, not a bias, and not an input to a trade. §6's step 1 is
his top-down bias read off price action, and nothing in this section feeds it.
Macro explains why a session behaved as it did; it does not license an entry, and
a briefing has never been a reason to take one.`,

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

### The grid

**Quarters are the $25 increments** — 4500, 4525, 4550, 4575, 4600. **00 and 50
are the psychological levels**, 25 and 75 the quarters between them. One grid at
two strengths, and it is the same grid step 2 of §6's sequence reads.

The grid spacing and the target range are the same number, which is not a
coincidence he stated but is worth holding: a trade taken at one quarter with a
$25 target is aiming at the next quarter, and the $30 default carries it slightly
past. **So the $25 target is the structural one and the $30 is the stretch.**

Marked structure — which levels are live, which extremes are thick — is
maintained in TradingView and deliberately not mirrored here. A map kept in two
places disagrees with itself, and a stale boundary produces false violations that
teach him to ignore real ones (§10).

### 4.1 · Break & Retest

Journal value: \`Break & Retest\`. Taken at interior levels and quarters, never at
an extreme (R-05).

**The premise is the break, and the trade is the retest.** Entering on the
breakout itself is a different trade and not this one: the retest is what
separates a level that has genuinely flipped from a push that is about to fail
back. It is also what makes the stop tight, since the level being retested is
close by — and a tighter stop under the same target is where this setup's
reward-to-risk comes from.

**Confirmation is required at the retest, not at the break.** A signal is price
reaching the flipped level and rejecting it; confirmation is a close in the
intended direction, or the reaction resolving clearly enough to enter before one
(§6, R-07).

**Where the idea is wrong is price back on the original side of the level**, and
that read is a stop-placement input rather than an exit rule — it is what §6's
*Before the trade* turns into the planned stop. Gold moves far enough that a
poke through is not by itself the break having failed; what the read produces is
a price, not a decision to close.

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

**A WICK THROUGH THE LEVEL IS NOT THE LEVEL FAILING**, and this is the single
most important line in either subsection. A wick that pierces the extreme and
closes back inside is a liquidity sweep: the stops resting beyond the level were
taken and price refused anyway, which is the level holding rather than failing.

That is why §6 allows re-entry after a sweep takes the stop and price comes
rapidly back. It is not an exception to the rules and not a revenge trade — the
idea was never invalidated, the stop was simply inside the sweep. The trade being
stopped out and the idea being wrong are two different events at an extreme, and
only the second one ends it.

**How it loses:** the range is over. A level that had turned price back stops
doing so, and a fade taken into a break is the failure this setup has — the
mirror of §4.1's, and the reason R-09 restricts both to obvious trends and
cycles.

### Fading against the bias — **[decide]**

Step 1 of the sequence is a top-down bias, and §4.2 is mean-reversion at a range
extreme, which in an obvious trend is by definition counter-trend. Nothing states
whether an S&R fade against the higher-timeframe bias is permitted, discouraged
or simply expected. It is the one gap in the setups that is a rule rather than a
description, and until it is settled she asks rather than assumes.`,

  "5": `## 5 · Risk

### The stop is a ceiling of $20, set at entry from the chart

Not a value. **$20 is the most it may ever be**, and where it actually goes is
read off price action at entry — the level beyond which the idea is wrong, as
close as that can honestly be put. A $10 stop and a $20 stop are both compliant;
a $22 stop is not.

**It is placed at entry and never moved tighter afterwards.** The only movement a
stop ever makes on this account is to break-even at +$20 (R-04). That one-way
property is what keeps R-02 readable: a close further from entry than $20 can
only be a stop that was widened.

### Risk per trade is at most 4% of account

The ladder is 0.02 lots per $1,000, continuous, so at the full $20 stop:

    0.02 lots = 2 oz    account $1,000    $20 stop = $40   = 4.0%
    0.10 lots = 10 oz   account $5,000    $20 stop = $200  = 4.0%

The ladder is linear, so the share is the same at every rung. **4% is therefore
the ceiling rather than the figure**, and it is reached only on a trade whose stop
sat at the cap. A $12 stop at the same rung risks 2.4%.

What that means in the shape of a month, so it is not abstract: **two and a half
maximum stops erase a +10% month**, and **1.7 winners at $30 make one**. The
target in §0 and the risk here are the same decision seen from two ends.

Deriving it rather than storing it is deliberate. \`size_oz\` is on the row, so the
account tier and therefore the dollar risk of any past trade are recoverable from
the trade itself, and a second column stating the percentage could disagree with
the ladder that produced it.

### The day ends at 4%, and a full stop is the usual way of reaching it

**These are two rules, not one seen twice**, and the document said otherwise
while the stop was assumed to be a flat $20. It is not: a full stop on a $12 stop
costs 2.4%, so R-03 ending the day after a full stop and R-11's 4% limit can now
disagree in both directions. A tight stop taken in full ends the day under R-03
having spent well under the limit; three exits cut by hand at a third of a
maximum stop each spend the day exactly and are invisible to R-03.

**R-11 is the limit. R-03 is the usual shape of hitting it.** Both are in the
table, because neither covers the other.

### Nothing else caps a loss, and that is deliberate

**No weekly maximum. No monthly maximum.** The day is the only window with a
limit, and a run of bad days is not stopped by anything written here.

### One position, always

One trade at a time. He does not scale in, does not add, and does not hold two
positions at once — so the stop is the whole exposure rather than a per-leg
figure, and 4% is the most that can be at risk at any moment. This is R-10, and
it is checkable: two rows whose entry-to-fill spans overlap are a violation on
the face of the data.

### Nothing changes size but the ladder

No setup is sized up, no session is sized down, and **no time of day changes
anything** — there is no session rule at all (§6). The rung is the only input, and
it moves only as below.

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
rather than being weighed against the others. **The same four steps for both
setups:**

1. **Top-down bias**
2. **Levels** — liquidity pools, support and resistance, and the $25 grid: 00 and
   50 psychological, 25 and 75 quarters (§4)
3. **Candle or chart pattern** — signal first, then confirmation
4. **Reward-to-risk of at least 1:1.5**

The order is the rule. A failed step ends the sequence rather than being traded
off against a later one, so a setup that fails step 1 is not rescued by a clean
step 3 — which is what separates this from a checklist where enough ticks carry a
trade.

**Every step gates.** Psychological levels were a separate step through v1.8 and
were folded into step 2 at v1.9, because they added no test of their own — they
were attention rather than a gate, and a step that can never be the step you
stopped at breaks the one claim R-08 makes.

### Where the stop comes from, and why it is the same read as the target

Step 2 produces the level. **The read of where the idea would be wrong produces
the stop** — the price beyond which the premise has failed, as close as that can
honestly be placed, and never further than $20 (§5). That is a stop-placement
input, not an exit rule: nothing closes a position for reaching an invalidation
that the stop was not at.

Step 4 is then arithmetic over what steps 2 and 3 produced:

    (target distance) / (stop distance)  >=  1.5

**On the default path it is satisfied by construction.** A $30 target over a stop
of $20 or tighter is always at least 1:1.5, so step 4 refuses nothing and needs
no checking. It binds in exactly one place, below.

**Nothing stored can see any of the four steps**, including step 4 — the plan is
not on the row (§8). This is arithmetic he runs, not arithmetic anything verifies.

### The $25 target is two different things

Both are permitted and they are not the same decision.

**As an entry choice.** The level looks hard to reach before he is in, so $25 is
set from the start. **This is the one place step 4 binds:** $25 over a $20 stop is
1:1.25 and fails the sequence, so a $25 entry target requires a stop of $16.67 or
tighter. It is the only pairing that can enter in breach of his own rule, and no
row will ever show it.

**As a management decision.** A $30 target is on and structure shows it is
genuinely hard to reach — multiple recent highs in the way, or the level turning.
Pulling it to $25 is permitted. Step 4 already passed at entry, so nothing is
breached.

**So a realised 1:1.25 is legitimate as an outcome and illegitimate as a plan**,
and no row can tell which produced it. That is the honest statement, and it
replaces the two-numbers-at-two-moments account the document carried from v1.3 to
v1.8.

### Entry

A signal is price reaching a level and rejecting, and it is not an entry.
Confirmation is required and is either a candle closing in the intended
direction, or the reaction around the level resolving clearly enough to enter
before a close. Entering on the signal with neither is the violation R-07 names,
and §9 is why it has its own section.

**Entry is at market.** There is no resting limit back into the level, so the fill
is where price was when he decided rather than a price he chose in advance — which
is part of why slippage is treated as his in §0 rather than allowed for.

### Session is not a step

**There is no session rule.** He trades Asian, Asia+London, London, London+NY and
New York alike; the setup decides and the clock does not. Time of day is not one
of the four steps and never disqualifies a trade.

Recorded as his own description of himself, dated v1.9 and explicitly **not a
rule and not a finding**: he reports being more careful around the New York open.
It is on the record so that a later comparison has something to disagree with —
a self-report reconstructed after the data is in is worth nothing (§8).

### While it is on

The stop moves to break-even once price has travelled $20 toward the target. The
target may be shortened to $25 as above. Beyond those two, nothing is done to a
position: no partial exits, no adding, no widening, and **no tightening** — the
stop was placed at entry and only ever moves to break-even.

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

**He journals at entry**, while the trade is fresh and before the outcome exists
to colour the answer. The three discipline answers ask whether the stop and
target were *respected*, not whether they were moved. \`null\` is unanswered and is
not "no".

The plan itself is not recorded. \`planned_stop\` and \`planned_target\` were tried
and retired at v1.8 — he journals a trade, not a plan — and §8 lists what that
costs.`,

  "7": `## 7 · The rules, enumerated

Every rule the sections above impose, in one table a program can hold him to. The
prose is not repeated here — the Rule column is a handle, and §-references point
at the reasoning.

**Evaluable** is the load-bearing column:

- \`journal\` — computable from a row today. A predicate is given and it is not
  optional.
- \`field\` — would be computable if a column existed. The column is named.
- \`judgment\` — cannot be checked from stored data at all. A probe is given
  instead: the question Eugenia asks rather than the check she runs.

A \`judgment\` rule is not a weaker rule. It is a rule whose compliance the system
cannot see, and labelling it is what stops it quietly counting as passing.

**Marker** is the rollup. \`followed_rules\`, \`followed_sl\` and \`followed_tp\` are
one boolean each, covering every rule mapped to them — so a self-report of
\`true\` is a claim about all of them at once, and a \`journal\` rule reading false
underneath one is a discrepancy worth raising.

The table itself is in the always-loaded half and is not repeated here.

### Notes on individual rules

**R-01's lower bound is the half that catches anything.** The target may be $25 —
by exception at entry, or by shortening a $30 once the trade is on (§6) — so a
win at $25 is the rule working. A win BELOW $25 is a position closed before any
target he is allowed to set, which is the discretionary exit the predicate exists
to find.

A win landing between $25 and $30 is not anomalous: on a $25 grid, price stalling
a dollar or two short of the next quarter and being taken there is the level doing
what it was marked for. The floor is what is checked because it is the only part
that is unambiguous.

**R-01 IS NOT R-02'S MIRROR, and the difference is what a larger distance means.**
On a loss, further from entry is always worse than intended. On a WIN it can be
better: a take profit sitting at $30 fills at $30 or through it, so a gap fills at
$30.60 with the order never having moved. So an R-01 flag on an overshoot is a
question rather than a finding — ask which it was.

Break-evens are not caught by this and must not be: an exit within $3 of entry is
a scratch by result, not a win, so R-04 firing never reads as a target missed.

**R-02 CHECKS THE CAP, NOT THE RESPECT, AND THE BLIND SPOT WIDENS AS THE STOP
TIGHTENS.** The marker is \`followed_sl\` — *did you respect your stop* — and the
predicate compares against 20 flat. Since the stop is a ceiling and is usually
tighter (§5), a trade whose stop sat at $10 and which closed $18 from entry had
its stop widened by eight dollars, and this predicate passes it silently.

The version that would catch it compares against the trade's own planned stop,
and that column was retired at v1.8 by decision. **So this is a known,
deliberate, one-sided check**: what it flags is real, and what it misses is
invisible. Never read a clean R-02 run as stops respected — read it as no stop
having gone past $20.

**R-03 IS \`field\`, AND IT IS THE POPULATION THAT IS MISSING RATHER THAN THE
PREDICATE.** The comparison is simple — within an \`open_day\`, no \`entry_time\`
later than the \`fill_time\` of a full-stop loss. What is not available is *which
losses are full stops*: §5 caps the stop at $20 and leaves where inside the cap it
goes to price action, the broker reports only the final one, and nothing records
what it was set to, so a $12 loss cannot be told from an exit cut by hand.

The narrower version is what runs, labelled as what it is: losses at $20 are
identifiable full stops, so the rule is checked over those and returns \`unknown\`
rather than \`pass\` for a day whose only loss was tighter. It under-detects, and a
clean result means less than it appears to.

**R-04 cannot be confirmed, only violated.** Whether a losing trade ever reached
+$20 is not recoverable: \`entry_price\` and \`exit_price\` are endpoints, and the
path between them is not stored anywhere, including at the broker. The gap is
one-sided — a win proves its own excursion, and a break-even is R-04 having fired
— so the probe fires on full-stop losses alone.

**R-05 and R-06 are judgment because of where the zone map lives, not because
they are vague.** Both are precise rules about position in a marked structure.
The structure is maintained in TradingView and deliberately not mirrored here (§4,
§10).

**R-05 can only ever be violated, never confirmed.** An empty population returns
\`unknown\`, not \`pass\`. A clean run means either that the rule was kept or that no
extreme has broken lately, and the journal cannot separate those. Silence is
silence — it is not evidence of discipline.

**R-07 IS THE ONE THAT MATTERS MOST AND THE ONE NOTHING CAN SEE.** It is his
primary failure mode by his own account, it is invisible in every row, and §9 is
the section about it rather than a note here.

**R-10 and R-11 were rules without IDs.** Both were stated in §5's prose from
v1.5 and neither was in the table, so neither was ever checked. Both are
computable from broker columns alone, which is why they arrive as \`journal\`
rather than as another thing waiting on a schema change.

R-11's predicate needs the account, and the account comes from \`size_oz × 500\`
(§8) — so it is \`unknown\` on any day whose rows carry no size, rather than
computed against a balance.

### Six of nine are judgment, and that is now settled rather than pending

R-04, R-05, R-06 and R-07 would each become checkable with a single question at
journalling time. **He has decided against adding them**, and §10 records the
decision and its cost. It is written there as a closed question rather than left
here as a proposal, because a proposal nobody is acting on reads as a task and
quietly rots.`,

  "8": `## 8 · Journal binding

What a row can answer, what it cannot, and the filters that have to be applied
before any of it is read. This section exists because a rate computed over the
wrong population looks exactly like a rate computed over the right one.

**Nothing cites this section**, which is why §0's index names it explicitly. Read
it before producing any number, not after being asked to justify one.

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

**Maximum favourable excursion.** How far a trade travelled before it turned. Not
stored and not available from the broker, which is what makes R-04 a probe and
what makes asking at journalling time the only way it would ever be recoverable.

**The plan.** Where the stop and the target were set at entry, as against the
final stop the broker reports. Nothing on the row carries it: a stop moved to
break-even has overwritten the original everywhere, and no column holds what it
was before.

Four questions are unanswerable for that reason — R-03's full-stop population,
R-02's respect half, whether step 4 was satisfied on a $25 entry, and whether a
win at $25 was a shortened target or an early close. §5 bounds all four without
settling any of them, because the cap is a range and the row does not say where
inside it the stop went.

It is not a gap waiting on a schema change. Journalling a plan was tried and
retired (§13, v1.8), and widening what Gladys asks was declined (§10): every one
of them is a question at journalling time, and that door is closed.

**Which rule broke.** \`followed_rules\` is one boolean covering R-03, R-05 through
R-09, R-10 and R-11. It records that something broke, not what — and on his own
account (§9) it is mostly answering *did I wait?*

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
than when it opened. This account holds across sessions deliberately, which means
those rows land in a later bucket than they belong to, systematically.

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

The ±$3 scratch band is a price distance, so a stop moved to entry lands inside it
by construction. Break-evens on this account are therefore mostly R-04 working,
not random scratches, which makes the break-even count a meaningful figure:
roughly, how often a move went most of the way and turned.

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

**Sessions have a floor and a test, and both are stated so the question opens on
a count rather than on a bad run.**

- **30 decided trades in a bucket** before that bucket's rate is quoted at all,
  counted per bucket. Asian and Asia+London will reach it long after London and
  New York, and that is expected rather than a problem.
- **The test is against 40%, not against the other four buckets.** A $30 target
  over a $20 stop breaks even at 20/(20+30) = 40%, and 44.4% on a $25 target — so
  the line comes out of his own geometry rather than out of a comparison.
- **Ranking the five buckets is not a finding, at any sample size.** One of five
  is highest by chance even when all five are identical, and concentrating on it
  is selecting on noise. Say so rather than producing the ranking.

### Monthly P&L

Sum of \`net_pnl\` over the month's filing days, divided by the account the month
was traded at — \`size_oz × 500\` off a representative row, since size is what
account tier is read from and the tier is what the target is a percentage of.

Never a balance delta: transfers move \`balance\` with no trade behind them, and
this account is funded in steps.

\`net_pnl\` rather than \`pnl\` for the reason above, and rows lacking it are counted
and reported rather than silently dropped — the count is the honest error bar on
the figure.

**Where the account tier is read from is a decision.** Size varies as rungs are
stepped, so a month spanning a change has no single account. First trade of the
month, last trade, or largest — **[decide]**, and once decided it goes in §12 as a
definition rather than being chosen again each month.`,

  "9": `## 9 · How he fails

The sections above describe what he does when the process holds. This one is what
happens when it does not, in his own account, recorded at v1.9. It is here because
every rule in §7 that his failures actually touch is \`judgment\`, so the table
cannot see any of this and would read a bad month as nine unknowns.

### The failure has one shape, and it is FOMO

**Not fear.** Fear breaks a trader out of good positions early; that is not the
pattern here. His weakness is FOMO and, behind it, greed — wanting the outcome
badly enough to stop waiting for the conditions.

**And it is not chasing.** The move is not running away from him and the level is
not behind him. It is more specific than that: **price reaches a level he is
already watching, and he enters on the touch** — without letting the level react,
without giving it room to breathe, without waiting for the close or the read.

So in the vocabulary of §12, he takes the **signal** as the entry. That is R-07
exactly, and it is the reason R-07's probe is worded as *did you wait* rather than
as a question about candles.

### What that means structurally

**Step 2 is clean.** The level is right, which is why R-05 and R-06 are not where
this shows up. **Step 3 is where it breaks** — signal without confirmation — and
step 4 inherits nothing, because an entry at the level keeps the geometry intact:
the stop distance is normal and the R:R is fine.

That is worth stating because it rules out the tempting story. There is no
wide-stop signature, no compressed R:R, no entry far from a level. **A FOMO entry
and a patient entry at the same level, same direction, same size, produce
identical rows.**

### He knows at the time

**This is not a recognition problem.** He is not misreading the level and would
not be helped by more method. The rule is known, the violation is known while it
is happening, and it happens anyway.

Two things follow, and both matter.

**\`followed_rules = false\` is answerable honestly on these trades.** He knows in
the moment, so the mark is a live observation rather than something reconstructed
after a loss. That single boolean is the only instrument pointed at the thing that
actually costs him — which is why an unanswered journal is worse here than
anywhere else in the system.

**And the useful question is never *what was the setup*.** It is what was
happening in the seconds before he clicked. The setup is on the row; that is not.

### The first leg has no signature at all

A trade correctly identified as bad and taken anyway files identically to a good
one — §8 says so about overrides in general, and this is the specific case. No
column, no derived value and no rate will ever separate them. The only record
that this happened is his own answer, given at entry, and if it is not given the
trade is indistinguishable from one that followed every rule.

**So a clean compliance rate over a period with unanswered journals says nothing.**
It is not evidence of discipline; it is an absence of answers.

### He is working on this

Recorded because it dates the baseline. As of v1.9 he is deliberately training the
wait — not entering the moment a level is reached — and that is an active focus
rather than a settled habit. A change in this over time is the single most
valuable thing the journal could show, and the only way it will show is if the
marker keeps being answered honestly while the behaviour is still bad.`,

  "10": `## 10 · What would have to change, and what he has decided

§7 labels six rules \`judgment\` — cannot be checked from stored data at all. This
section is what would lift each of them, and which of those routes are open.

### The two closed routes

**Journalling the plan: tried and retired.** \`planned_stop\` and \`planned_target\`
existed from v1.4 to v1.8 and were dropped — the columns, the app fields, and the
view. He journals a trade, not a plan. The cost is listed in §8 and is real: R-03
falls back to a narrowed population, R-02 checks its cap and not its respect, and
step 4 on a $25 entry target is unverifiable.

**Widening what Gladys asks: declined.** Four rules — R-04, R-05, R-06, R-07 —
would each become checkable with one tap at journalling time. The analysis is
recorded here because it is sound and a future reader should see why the door was
shut rather than assume nobody thought of it:

- **\`level\`** (\`extreme\` | \`interior\`) would settle **R-05 and R-06 together**,
  since setup plus location is the whole test.
- **\`confirmation\`** (\`close\` | \`read\` | \`neither\`) would settle **R-07** — the
  rule §9 identifies as his primary failure — and \`neither\` would be a
  self-reported violation, the strongest signal the system could carry.
- **R-04 does not fit the existing pattern.** Gladys fires at OPEN, when the trade
  has not done anything yet, so *did it reach +$20 before it turned* has no answer
  at the moment the form is drawn. It would need a close-time trigger and a second
  message path, which is machinery rather than a keyboard row.

**He decided against all of it at v1.9.** So R-04, R-05, R-06 and R-07 are
\`judgment\` permanently, not pending. R-04 is the sharpest loss: maximum
favourable excursion is genuinely unrecoverable afterwards, so *did it reach +$20*
is a question no version of this system will ever answer from data.

### The route that stays open, and it is not a schema change

R-08 and R-09 were never candidates for a column — *which step did you stop at*
and *was the trend obvious* are judgments, not fields. What lifts them is the same
thing that lifts R-07 in practice: **the answer given at entry, while the trade is
fresh.**

That is the whole remaining instrument. §9 is why it is enough to be worth
protecting and why an unanswered journal costs more here than the completeness
indicator suggests.

### The zone map stays where it is

R-05 and R-06 are precise rules about position in a marked structure, and that
structure lives in TradingView. Mirroring it here was considered and rejected: a
map kept in two places disagrees with itself, and a stale boundary produces false
violations that teach him to ignore real ones. That is not a gap to be closed
later — it is a decision, and it is why "judgment" for those two is about where
the map lives rather than about the rules being vague.`,

  "12": `## 12 · Definitions

Terms used as if precise. Where the app already defines one, this is that
definition and not a second version of it.

**Break-even (scratch).** An exit within ±$3 of the entry price, at any size.
Measured in price rather than dollars because $3 of P&L is $3 of gold at 0.01
lots and three cents of it at 1.00 — a dollar band would mean something different
at every rung of the ladder. Win and loss still come from the sign of the P&L;
price distance is unsigned.

**Decided.** A trade carrying a P&L. Break-evens are decided and sit in the
win-rate denominator, so scratches drag the rate down rather than vanishing from
it. An open position is not decided and is absent from both sides.

**Complete.** A setup and all three discipline answers present. P&L is
deliberately not required — an open position can be journalled before it closes.

**Filing day.** \`open_day\` where the poller supplied one, otherwise the New York
civil day of the closing fill. The day a trade is counted under.

**Session.** One of five buckets — Asian, Asia+London, London, London+NY, New
York — derived from \`entry_time\` against each financial centre's own local hours,
so London's boundary moves with its own daylight saving. Nothing is stored and
there is no override. **There is no session rule** (§6); the buckets are a
reporting dimension, not a constraint.

**Size.** \`size_oz\`, in ounces, as the position was opened — not as it was
closed, which differs on a partial exit. Lots are ounces ÷ 100. Poller-written
only, and null on anything it never reached or that predates the column.

**Stop.** A ceiling of $20 of price distance from entry, not a value. Set at
entry from where the chart shows the idea to be wrong, so usually tighter. Moved
only to break-even (R-04), never tightened once the trade is on.

**Full stop.** A loss closed at the stop — $20 of price distance from entry, or
tighter where the stop was set tighter at entry. The second half is not
identifiable from a row (see R-03), so *the checkable definition is the first half
only* and it under-detects. Distinguished from a break-even and from a manually
tightened exit, and it is the only close that ends the trading day under R-03.

**Grid.** The $25 increments. **Psychological levels** are 00 and 50;
**quarters** are the 25 and 75 between them. One grid at two strengths, read at
step 2 of §6's sequence.

**Extreme.** The outer boundary of the marked range. Few, thick, and where
Support & Resistance is traded.

**Interior level.** A marked level inside the range, and quarters. Where Break &
Retest is traded.

**Signal.** Price reaches a level and rejects. Not an entry on its own.

**Confirmation.** Either a candle closing in the intended direction (*close*), or
the reaction around the level resolving clearly enough to enter before a close
(*read*). Both are valid. Entering on the signal with neither is not — and per §9
it is his most common failure.

**Rung.** A step on the sizing ladder. \`account = lots × 50,000\`, continuous —
0.02 lots per $1,000 at every size.

**R:R.** **At entry it is a condition: at least 1:1.5**, step 4 of §6's sequence.
The default $30 target satisfies it at any permitted stop, so it binds in exactly
one place — a $25 target set at entry, which needs a stop of $16.67 or tighter.

**A realised 1:1.25 is legitimate as an outcome and illegitimate as a plan.** It
is the rule working when a $30 target was shortened on a trade already open, and a
breach when $25 was set at entry over a $20 stop. Nothing on the row separates
them, so it is \`unknown\` rather than either.

In the app, realised R:R is a different number entirely: average win ÷ average
loss over closed P&L. It cannot be read as the plan.`,

  "13": `## 13 · Changelog

The write path. Findings, retired rules and rule changes are recorded here, and
the §7 table read afterwards is whatever this section last left in place. Rule IDs
are never reused, even after retirement — a recycled ID silently falsifies
history.

Rows below v1.9 are history and describe the document as it stood. Where one of
them states something v1.9 has since corrected — v1.7's "five steps", v1.3's
account of the $25 target — it stays as written, because correcting the record
would falsify it.

| Version | Effective from | Change | From lesson |
|---|---|---|---|
| v1.0 | [decide] | Initial document. R-01 through R-09. | — |
| v1.9 | [decide] | **The stop is a ceiling, not a value** — under $20, set at entry from the chart's invalidation, never tightened afterwards. R-02 restated as a cap check with a stated blind spot. **The $25 target is two things**: an entry choice, where it is the only pairing that can breach step 4 and needs a stop under $16.67, and a management shortening, where it cannot — so 1:1.25 is legitimate as an outcome and illegitimate as a plan, replacing the two-numbers account carried since v1.3. **R-08's sequence folded from five steps to four**, psychological levels merged into step 2, because a step that cannot fail cannot be the step you stopped at. Quarters defined: the $25 grid, 00/50 psychological, 25/75 quarters. **No session rule**, stated; the NY-open caution recorded as a dated self-report; session reporting given a 30-trade floor and a 40% test rather than a ranking. **R-10 and R-11 given IDs** — both were prose from v1.5 and neither was ever checked. §5's "the day ends at 4%, which is one full stop" corrected: two rules, not one. **Sections 2, 9 and 10 written; the never-written 1, 3 and 11 dropped from the contract.** §0 de-duplicated — the summary is one constant interpolated into both exports — and given a section index, because nothing cites §8. | His answers, and a full read of the document |
| v1.8 | [decide] | \`planned_stop\` and \`planned_target\` retired: the columns dropped and the two fields removed from the app. **He journals a trade, not a plan** — §5 fixes the target at $30 and caps the stop at $20, and where inside that cap the stop goes is read off price action rather than typed into a form. R-03 returns to \`field\` and to the narrowed full-stop population; §6's step 5 is arithmetic he runs and nothing checks; §8 and §12 restated — no row carries intent, and planned R:R is not recoverable from one. The three questions the columns were meant to answer are questions at journalling time, alongside R-04's. | His decision |
| v1.7 | [decide] | R-08's five steps written: top-down bias, liquidity pools and S&R, psychological levels, candle or chart pattern with signal then confirmation, and reward-to-risk of at least 1:1.5. Step 5 is arithmetic and checkable from the planned columns. It also settles a contradiction the document was carrying — 1:1.5 is a condition at ENTRY, 1:1.25 the realised floor after a permitted shortening: two numbers at two moments rather than one disagreeing with itself. | His rules |
| v1.6 | [decide] | §4 written. The two setups differ by METHOD, not location — Break & Retest is continuation through a level that has flipped, Support & Resistance is mean-reversion off a level that is holding; location is how each is recognised. Invalidation stated per setup, and §6's re-entry rule is shown to follow from S&R's rather than being an exception to it. | Method research, anchored to his stated rules |
| v1.5 | [decide] | §5 and §6 written. Risk per trade is 4% and is deliberate; the rung moves by hand; 4% is also the daily limit, and there is no weekly or monthly one. One position at a time, nothing else changes size. Entry at market, exits price-based only, journalled at entry. Re-entry allowed after a liquidity sweep that snaps back to the level. R-08's sequence is recorded as existing but not written down. | His answers |
| v1.4 | [decide] | \`planned_stop\` and \`planned_target\` are recorded at journalling time. R-03 moves from \`field\` to \`journal\` — it was the full-stop population that was missing, not the predicate — and is \`unknown\` rather than \`pass\` on rows with no plan. §8 and §12 restated: intent is on the row, and planned R:R is recoverable where a plan exists. | Schema change |
| v1.3 | [decide] | The target may be shortened from $30 to $25 where the level looks hard to reach or is showing reversal. R-01 gains its lower bound and becomes two-sided — the §7 [decide] on early exits is answered. The R:R floor is restated as 1:1.25, being the shortest allowed target over the widest allowed stop. | His decision |
| v1.2 | [decide] | Tolerance settled at none: the stop is at most $20, so a loss further out is a stop that moved, and R-01/R-02 compare flat. \`TOL\` retired from §0 and §12. Recorded that R-01 is not R-02's mirror — a gap through the target enlarges the distance without anything having moved. | His decision |
| v1.1 | [decide] | \`TOL\` named in §0 and R-01/R-02 given executable predicates. R-03 relabelled \`field\` — the full-stop population needs a planned stop. §8 records \`size_oz\` and the account arithmetic it enables, and the \`pnl\` fallback that makes \`net_pnl\` the figure for any multi-day total. | Review of v1.0 against the live schema |`,

};
