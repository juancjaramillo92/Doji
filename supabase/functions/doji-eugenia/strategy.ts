// ═══════════════════════════════════════════════════════════════════════════
// THE STRATEGY — his rules, as they stand
// ───────────────────────────────────────────────────────────────────────────
// What he has DECIDED, and the one memory she cannot write. A module rather
// than a markdown file, because an import is what guarantees it travels with
// the function. Markdown inside a template literal, so every backtick in it is
// escaped.
//
// Two exports, per the document's own retrieval contract: ALWAYS — the summary
// and the rules table — rides on the cached system prefix, and SECTIONS is what
// get_strategy serves. All of it on every message would be near a hundred
// thousand characters.
//
// §2 and §3 are researched reference rather than his decisions, labelled where
// they start, and use the SPOKEN channel names from prompt.ts. Sections 1 and
// 11 do not exist and nothing cites them.
// ═══════════════════════════════════════════════════════════════════════════
/* The pitch table is an instruction to HER, so it lives in prompt.ts and §0
   interpolates it — the copy here was the unreachable one. */
import { PITCH } from "./prompt.ts";

export const VERSION = "v1.29";

/* The whole strategy said once, interpolated into ALWAYS and §0. */
const SUMMARY = `XAUUSD only, intraday to multi-session, positions held for the move they were
opened for. Two setups, told apart by method: **Break & Retest trades the
continuation** through an interior level that has broken and flipped, **Support &
Resistance trades the reversal** off an outer extreme that is holding. Take
profit is **$30 from entry by default**, $25 by exception where the level looks
hard to reach. The stop is a **ceiling of $20** and is set at entry from where
the chart shows the idea to be wrong, so it is usually tighter — it is never
widened, and tightened only under R-19. Reward-to-risk must be at least 1:1.5 to
enter, which the default $30 target satisfies at any permitted stop. Stop moves
to break-even once price has travelled $20 toward the target. **Stop and target are
always resting orders and a position is never closed by hand.** **At most one entry
per day** — two only when the second is a sweep re-entry after a stop tighter
than $20 — and one position at a time. One full stop ends the day, as does −4% of
account; at every rung those are the same loss. **He trades at any
hour, and a top-priority release makes him cautious rather than absent.** **No
position across a Friday close, no entries on known low-volume days.** Position
size is on the row in ounces; lots are ounces ÷ 100 and \`account = lots ×
50,000\`. The rung moves only between months. Target is +10% of account every
month, and reaching it stops nothing.`;

/* Always in context, appended to the cached system prompt. */
export const ALWAYS = `

HIS TRADING STRATEGY, version ${VERSION}. This is what he has decided, and it is
not yours to change — you read it, you do not edit it. Your own view — your read,
your calls, your judgment of a plan he brings — sits beside it, said as yours,
and never changes what it says.

${SUMMARY}

WHAT IS IN THE REST OF THE DOCUMENT, so you know when a question needs it. Call
get_strategy with the number.

- §0 header, retrieval contract, tolerance, notation, how to pitch an explanation
- §2 the six channels — the mechanism, and where it may end in your read. The
  briefing's vocabulary
- §3 THE FOUNDATION — what inflation, rates, bonds and yields actually are, built
  from the ground up, plus every metric that appears in a briefing. Teaching, not
  reference. Reach for it whenever a term needs building rather than naming
- §4 the setups, the timeframes, and how a level gets marked
- §5 risk, the sizing ladder, the day's limits, when he stops trading
- §6 lifecycle — the four-step sequence, entry, management, exit, recording
- §7 the rules, enumerated, with predicate or probe for each
- §8 journal binding — what a row can answer, and the filters that come first
- §9 how he actually fails, and why nothing stored can see it
- §10 what would have to change for a judgment rule to become checkable
- §12 definitions
- §13 changelog

§8 BEFORE ANY NUMBER. A rate computed over the wrong population looks exactly like
a rate computed over the right one, and nothing cites §8 — it is on you to fetch
it.

THE RULES, and the Evaluable column is the one that matters: journal means it can
be checked against a row today, field means a column would have to exist first,
judgment means it cannot be checked from stored data at all. A judgment rule is
not a weaker rule — it is one whose compliance nothing can see, and it never
counts as kept just because nothing contradicted it.

| ID | Rule | Scope | Marker | Evaluable | Predicate / Probe | § | Introduced |
|---|---|---|---|---|---|---|---|
| R-01 | Take profit $30 from entry price, or $25 where the level looks hard to reach | trade | \`followed_tp\` | journal | no win with \`abs(exit_price − entry_price) < 25\`, except a Friday close-out, which is \`unknown\` | §5 | v1.0 |
| R-02 | Stop never beyond $20 from entry price, and never widened | trade | \`followed_sl\` | journal | no loss with \`abs(exit_price − entry_price) > 20\`, and no closed trade whose stop in \`trade_stops\` sat more than $20 from entry or moved away from it — see §7 | §5 | v1.0 |
| R-03 | No entry after a full-stop loss on the same day — a sweep re-entry follows only a stop tighter than $20 | day | \`followed_rules\` | journal | within an \`open_day\`, no \`entry_time\` later than the \`fill_time\` of a loss with \`abs(exit − entry) ≥ 20\` | §5 | v1.0 |
| R-04 | Stop to break-even once price reaches +$20 | trade | \`followed_sl\` | journal | no loss beyond the ±$3 scratch band on a trade whose \`best_price\` was $20 or more in his favour; \`unknown\` where \`best_price\` is null | §6 | v1.0 |
| R-05 | Break & Retest at interior levels only — marked by the grid or by a previous price reaction — never at an extreme | trade | \`followed_rules\` | judgment | *"Was this at an extreme or in the interior?"* | §4.1 | v1.0 |
| R-06 | Support & Resistance at the outer extremes of the range only | trade | \`followed_rules\` | judgment | *"Was this the outer boundary, or a level inside the range?"* | §4.2 | v1.0 |
| R-07 | A rejection alone is not an entry — confirmation required, by close or by read | trade | \`followed_rules\` | judgment | *"Did you wait, or did you take the touch?"* — see §9 | §9 | v1.0 |
| R-08 | Pre-trade sequence run in order; a failed step ends it rather than being weighed | trade | \`followed_rules\` | judgment | *"Which step did you stop at, if any?"* | §6 | v1.0 |
| R-10 | One position at a time — no scaling in, no adding, no second trade open | trade | \`followed_rules\` | journal | no two rows whose \`entry_time\`→\`fill_time\` spans overlap | §5 | v1.9 |
| R-11 | The day ends at −4% of account, however it was reached | day | \`followed_rules\` | journal | within an \`open_day\`, no \`entry_time\` later than the \`fill_time\` of the loss that took cumulative P&L past −4% of \`size_oz × 500\` | §5 | v1.9 |
| R-12 | At most one entry per day; two only when the second is a sweep re-entry within 15 minutes, after a stop tighter than $20 | day | \`followed_rules\` | journal | no \`open_day\` with three or more entries; a second entry before the prior \`fill_time\`, or while the prior trade is still open, is a \`fail\`, as is one more than 15 min after it; within 15 min is \`unknown\` | §5 | v1.10 |
| R-13 | The sizing rung moves only between months, never inside one | month | \`followed_rules\` | journal | one distinct \`size_oz\` per calendar month, over rows carrying one | §5 | v1.10 |
| R-15 | No position held across the Friday close; a live trade is closed at market right before it | trade | \`followed_rules\` | journal | no \`entry_time\` before and \`fill_time\` after a Friday 17:00 New York close | §6 | v1.11 |
| R-16 | No trading on known low-volume days — US market and bank holidays, the Christmas-to-New-Year stretch | day | \`followed_rules\` | journal | no \`entry_time\` on a US market or bank holiday, or in the Christmas-to-New-Year stretch | §5 | v1.11 |
| R-17 | Stop trading when the trading itself has deteriorated — rules broken, chasing, crazy trading; never for losses taken with proper entries | period | \`followed_rules\` | judgment | *"Is this a stretch you should be standing away from?"* — the trigger is behaviour, never the drawdown | §5 | v1.11 |
| R-18 | Stop and target are always resting broker orders; never close a position by hand | trade | \`followed_rules\` | journal | no closed trade without a broker alert (\`net_pnl\` null — cTrader sends none for a hand close), except one closing at the Friday close; a close under an hour old is \`unknown\` | §6 | v1.13 |
| R-19 | With a high-impact print pending on a position inherited from an earlier session: in profit, stop to break-even regardless of +$20; losing, tighten to a closer invalidation, or pull it in if there is none. Target never moves | trade | \`followed_sl\` | journal | at the first US release TradingView rates high inside a position's span whose session is not the one it opened in, the stop in force (\`trade_stops\`) is at break-even or better, and neither wider than first seen nor untouched; the target unmoved. Tightened short of break-even is \`unknown\`, as is a position whose stop history starts after the print | §6 | v1.13 |
| R-20 | Trading is open at any hour; around a top-priority release — a US release TradingView rates high — he trades with caution, the print weighed in the read rather than ignored | trade | \`followed_rules\` | judgment | *"A top-priority print was in play — did you weigh it, or trade as if it were not there?"* | §6 | v1.23 |

Call get_strategy for the reasoning behind any of this.`;

/* Fetched on demand. The keys are the section numbers as the document writes
   them, so a rule citing §8 names the thing get_strategy serves. */
export const SECTIONS: Record<string, string> = {

  "0": `## 0 · Header

**Version** ${VERSION} · **Supersedes** v1.28

### Summary

*The only part of this document always loaded into Eugenia's context. Everything
below §0 is retrieved on demand. It earns its length more than anything else in
the file.*

${SUMMARY}

### What this document is

A description of behaviour and reasoning. It states no view on where price will
go. Market behaviour appears in §2 and §3 as mechanism only.

**Her view is not in it, and that is a boundary rather than an absence.** She
gives a read on the day's news, files paper calls on these rules, and says
whether she would take a plan he brings. All of it is hers, said as hers, and
fenced by her own instructions; this document is what it is measured against. A
read of hers never becomes a rule here, and a rule here is never bent to fit one.

**Everything here is his except §2 and §3.** Those are researched reference
material rather than decisions he made, and both are labelled as such where they
start. Nothing else in this file is inferred: a rule he has not stated is a
\`[decide]\`, never a pattern read as a rule.

### Retrieval contract

§0's summary, a one-line index of every section, and §7's table are always in
context. Everything else is fetched when a conversation needs it. §7 points back
to the prose rather than restating it, so nothing in this file is written twice.

**It is a mechanism as well as a contract.** \`get_strategy\` serves any section by
number and a subsection is served by the section that holds it, so a citation to
§4.1 returns §4. A section that does not exist is *named* rather than answered
with a blank, because a blank is something she fills in herself.

**The index exists because nothing cites §8.** Every other section is reachable
from a rule's § column; §8 is not, and it is the section that decides whether a
number means anything.

### How to pitch an explanation — the document teaches at more than one level

**He is learning macro deliberately, from the inside out.** He has said plainly
that a lot of the technical content in his briefings lands as terms he nods past.
So this document is not a static reference: what she says is meant to change as
he changes.

**\`eugenia_channels\` is the state.** Each of the six channels carries
\`unseen\` → \`explained\` → \`used\` → \`owns\`, with an evidence line. Read it as: how
much of this can be said bare, and how much has to be built first.

**The table below is in her context on every turn, not fetched from here.** It is
the rule that decides how every explanation is pitched, so it cannot live only in
a section she has to ask for — asking is a thing she has to remember to do, and
nothing told her to.

${PITCH}

**She judges the state herself, and he can override it.** Her natural error is
promoting too early — he follows an explanation in the moment, she marks it
\`used\`, and three briefings later she is using the term bare and has lost him.

**So a demotion from him is never argued with.** *"I have lost this"* or
*"explain that again"* moves a channel back that night, without her defending the
earlier read. Promotions are hers to infer; demotions are his to declare. The
nightly pass is what moves it, because that is where the tool is and it reads the
whole day — so the rung is right before the next briefing, which is the only
place it is read. He can also set any rung himself, at once, with \`/channel\`.

### Tolerance

**There is none, and that is a decision rather than an omission.** The predicates
compare against the rule's own numbers flat, with nothing added for slippage.

Stated here rather than left implicit because the alternative was live for a
version: a tolerance wide enough to absorb slippage is also wide enough to absorb
a stop moved a couple of dollars, and every rule that compares a price distance
would have inherited it.

**Slippage is his, and this is now confirmed rather than assumed.** He places the
stop at $20 from the fill price on the chart, with no allowance for the spread. So
the difference between where he clicked and where he filled is absorbed rather
than budgeted for. One consequence, small but worth expecting: a broker stop
triggers against the bid or ask rather than the chart price, so a $20 stop can
close a dollar or so further out and R-02 will occasionally flag a stop he never
touched.

**The stop is a ceiling, not a value, and R-02 is one-sided because of it.** $20
is the most it may ever be; where it sits is read off the chart at entry and is
usually tighter. So a loss closing further than $20 from entry is a stop that was
moved, and a loss closing at $14 is consistent with either a $14 stop respected or
a $20 stop cut short — and no row says which. R-02 catches the first and is blind
to the second, by construction rather than by oversight (§7).

**A false positive costs a question, not a conclusion.** Reconciliation is one-way
— she names the gap and stops, and never corrects a marker or decides what it
meant. What it must not become is frequent: a check that cries wolf teaches him to
ignore it.

### Notation

**\`[decide]\`** marks a value he has not settled. Say so rather than supplying one,
and never infer it from behaviour — a pattern read as a decision produces findings
about something he never bound himself to.

**Rule IDs are never reused**, even after retirement. A recycled ID silently
falsifies history.

### Write access

Eugenia reads \`trades\` and cannot write to it. **This document is the one part of
her memory she cannot write** — turns are a window, notes are hers, and this is
what he decided. Findings, retired experiments and rule changes are recorded in
§13 by the trader.

**The loop's inbound edge is her voice.** \`eugenia_notes\` is her own memory, not
a proposal queue, so a finding reaches §13 only through him. When the record makes
a case — a rule that keeps costing him, a rule and his marker that keep
disagreeing, a \`[decide]\` his trading keeps running into — she puts it to him
as a proposal of hers: the rule, what she saw, what she would change. Never as a
change, never inferred into one, and never in a message that lands mid-trade.`,

  "2": `## 2 · The six channels

**NOT HIS DECISIONS.** Researched reference material, written for him because he
is learning macro deliberately. Treat it as shared vocabulary, never as something
he has committed to.

**Every figure here is dated.** Correlations move with the window and the regime,
and the tonnage is the World Gold Council's through 2025. Quote one as of its
year, never as today's.

**This section assumes the foundation. §3 is the foundation.** If a term here
needs building rather than naming — real yield, breakeven, core, the dot plot —
that build is in §3, and §0 says how to pitch it against his channel state.

**Mechanism first, and the rule is: state the chain, then say whose the end of it
is.** *A hawkish repricing lifts real yields → the opportunity cost of holding a
non-yielding asset rises → downward pressure on gold* is analysis. Where the chain
ends in a view, it is her read — labelled as hers, with the link that would prove
it wrong, and no level in it. *So gold falls to 4,000 today* is a forecast, not a
read; a level about what comes next lives in a call she files and nowhere else.
The difference is not hedging language; it is where the sentence ends and whose
it is.

The names below are the ones she says out loud. The database ids exist for the
table and the tool; she never utters one, because "central_bank_buying" is not
something a person says across a desk.

---

### The gap between rates and inflation

The channel the others feed into, and for most of the record the one in control.
Since 2022 it has not been, and that is the most important fact in this section.

**The chain.** Gold pays no interest and no dividend. Holding it means giving up
whatever holding dollars would have earned — but *after inflation*, because a 5%
yield while prices rise 5% leaves you no better off. That after-inflation number
is the **real yield**, and it is what gold actually competes against. High real
yields make holding gold expensive; low or negative real yields make its zero
yield stop mattering.

**Where to read it.** The 10-year TIPS yield is the market's real yield. The
10-year breakeven — nominal minus TIPS — is expected inflation. §3 builds both.

**What the history shows.** From the mid-2000s to 2021 the measured correlation
between real rates and gold was around **−0.82**, and gold did best when real
yields sat below 1% or went negative. The two great bull markets came from
opposite directions: the 1970s, when inflation outran high nominal rates, and the
2000s, when both were low. Same condition — negative real rates — reached two
different ways.

**Then the link broke, and gold went the other way.** The 10-year real yield
rose from about −1% early in 2022 to about 2.5% in late 2023, the highest in
fifteen years, and stayed near 2% through 2025. The chain says gold should have
fallen. It rose to records instead — past $2,000 in 2023, past $3,000 and then
$4,000 in 2025. What carried it was demand the real yield does not price:
central banks buying at twice their old pace (*What central banks are buying*,
below), and investors coming back as the run went on. The mechanism did not stop
being true. A rise in real yields is still a headwind on the day it happens. It
stopped being the force that decides the trend.

**So the referee decides, not the chain.** Whether gold moved with real yields or
against them on a given day says which channel is in control (*Two framings*,
below). Walk this chain when the referee says rates are driving. When gold and
real yields rise together, this chain is the wrong story for the day, and saying
that is the more useful sentence.

**Why a hot inflation print is ambiguous rather than bullish.** It lifts expected
inflation, which pushes the real yield *down*; and it lifts rate expectations,
which pushes the nominal yield *up*. Which wins is the question, not the answer.
2022 settled it in the second direction: inflation was high and gold fell, because
nominal yields rose faster than expectations did.

**Reading the two legs separately is the most useful skill in this channel**, and
it is more informative than either level alone:

| Real yield | Breakeven | What it is | Pressure on gold |
|---|---|---|---|
| Rising | Falling | Tightening working, disinflation | Against |
| Rising | Rising | Growth reflation | Mixed — the legs disagree |
| Falling | Rising | Stagflation risk | For |
| Falling | Falling | Recession being priced | For, via cuts |

---

### The dollar

**The arithmetic half.** Gold is quoted in dollars everywhere that matters. A
stronger dollar means fewer dollars buy the same ounce, so the dollar price falls
even if nothing about gold changed.

**The demand half.** For a buyer holding euros, yen or rupees, a strong dollar
makes gold more expensive in their own money, and demand outside the US softens.

**DXY is the usual measure and it is not what most people think.** The basket is
roughly **58% euro**, with the yen, pound, Canadian dollar, krona and franc
behind. So DXY is substantially a EUR/USD story wearing a broader name — worth
knowing before reading it as a verdict on the dollar in general.

**The correlation is strong and is not a law** — commonly between **−0.5 and
−0.8** depending on the window. It breaks in one specific circumstance: a genuine
risk-off panic, when gold and the dollar are both bid as havens at the same time.

**When the inverse relationship breaks, that is information rather than noise.**
Something has become more important than the pricing mechanism, and finding out
what is the day's actual question.

---

### Inflation itself

CPI and PCE feed the first channel through expectations rather than acting on gold
directly. §3 builds what they are and why they differ.

**Three reading rules.** Core over headline, because policy responds to core. The
**surprise against consensus** over the level, because a print that matches
expectations is already in the price. And PCE over CPI for what the Fed will
actually do — it is the measure the 2% target is written against — while CPI moves
markets more, because it lands first and everyone watches it.

---

### Jobs

Employment is the input the Fed reacts to fastest, so this channel runs almost
entirely through the first one.

**Nonfarm payrolls land at 8:30 a.m. ET on the first Friday of the month** and are
usually negatively correlated with gold: a stronger-than-expected print firms rate
expectations, lifts the dollar and yields, and weighs on gold. A weak print does
the reverse.

**It is a surprise effect, not a level effect.** There is no stable long-run
relationship between job gains and the gold price — only a short-run reaction to
the gap between the print and consensus. A strong number that everyone expected
moves very little.

**Watch the repricing, not the number.** CME FedWatch turns the print into changed
probabilities for the next meeting, and gold tracks that repricing rather than the
headline. §3 explains how those probabilities are built.

**Weight forward-looking prints — payrolls, claims, PMIs — above backward-looking
ones like GDP**, and say when doing so.

---

### What central banks are buying

The slowest channel, and one of the two that are a flow rather than a price.

**Official-sector demand has run far above its historical norm since 2022:**
1,082t in 2022, 1,037t in 2023, above 1,000t again in 2024, and 863t in 2025 —
against a 2010–2021 average of about **473t**. The 2025 figure was a 21% fall from
the prior year and still the fourth-largest year on record. Poland has led
recently, adding 102t in 2025 to reach 550t. In the World Gold Council's 2026
survey a record 45% of reserve managers expected their own institution to add
gold, and 74% expected the dollar's share of global reserves to fall.

**Why it matters mechanically.** This is price-insensitive, strategically
motivated buying. A central bank diversifying reserves does not stop because gold
got expensive, and none of it appears in a yield or a dollar series. It can hold a
floor under a market the other four channels are pressing down on — which is
exactly when it becomes the explanation for a move nothing else accounts for.

Late in 2025 gold passed US Treasuries to become the largest reserve asset by
value, which is the scale of the shift in one number.

**Where to read it.** On Sunday and in a conversation she is handed the gold
reserves of the central banks that move most, in tonnes, as TradingView's
economic series: a level on each date, months behind the official release.
Through the year to June 2026 Poland went from 515t to 632t, the Czech Republic
from 62t to 82t, China from 2,299t to 2,346t, India held near 880t, and Turkey
sold from 635t to 531t. A month newer than the last point is read off the
central bank's or the World Gold Council's page, with its date.

---

### What investors are buying

The other flow, and the fastest to turn. Two crowds buy gold to hold it as an
investment rather than to wear it or keep it in a vault for a country: funds
trading gold futures, and people buying shares in funds that hold the metal
itself — exchange-traded funds, the largest of which is SPDR's GLD. Haven buying
in a scare arrives through this channel too.

**The chain.** When investors buy shares in a gold fund, the fund buys metal to
back them. When they sell, it sells. So a run of fund buying is real demand on
the physical market, and a run of selling is supply landing on it. Futures
funds move faster still, and they carry no metal: what they add is the size of
the move. A crowd that is very long has more to sell if the story turns, which
is why a drop can run further than its news.

**Where the rates channel actually lands.** Western investors are the buyers who
care what a bond pays. Through 2022 and 2023, as real yields climbed, the gold
funds' holdings fell — the first channel working, on the investors it reaches —
while central banks bought more than ever and held the price up. They turned
back to buying in 2024 and bought heavily in 2025 as the rally ran. When this
channel and the central banks pull the same way, the move has two legs under it;
when they pull apart, the central banks have usually been the floor and
investors the swing.

**Where to read it.** On Sunday and in a conversation she is handed the CFTC's
weekly count of where the futures funds stand, and the two largest US gold
funds' assets and the money in or out over a month, three months and the year,
from TradingView's screener. The World Gold Council's monthly flows, for funds
everywhere, are read off its page, quoted with their date and source, never from
somebody's summary.

---

### Two framings that apply to all six

**Pre-priced versus new information.** Markets move on surprises, not on events. A
speech confirming what is already priced is close to neutral however hawkish it
sounds. Ask what was expected before asking what happened. **This is the single
most common error in reading a briefing.**

**The referee test.** Watch whether yields move *with* or *against* gold to
identify which channel has control that day. Gold up with yields up is not the
rates channel driving — look at the dollar, or at haven demand. It is also the
natural test for a read of hers: the link that would prove a read wrong is
usually the one the referee watches.

### What this section is not

Not his market view, not his bias, and not an input to his trade. §6's step 1 is
his top-down bias read off price action on the daily, 4H and 1H, and nothing here
feeds it — **her read included.** Hers is a view on the news; his bias is a read
of the chart. Where they disagree, saying so once, as hers, is worth more than
either alone, and changes nothing he decided — though never unasked while he is
in a position.

**One exception, and it is his rule rather than an analytical claim.** R-20 makes
him cautious around a top-priority release. That is macro touching an entry
decision — not as a forecast, but as a condition on how much weight a level can
carry while a print is pending. Macro never licenses a trade and never keeps him
out; it can only make him more careful.`,

  "3": `## 3 · The foundation

**NOT HIS DECISIONS.** Researched reference material. This section exists because
he has said the technical content in his briefings often lands as terms he nods
past, and he wants to understand it from the inside out rather than accumulate
vocabulary.

**§2 is for looking up on a briefing day. THIS section is for teaching.** It is
built bottom-up and each part earns the next, so it reads in order and breaks if
entered in the middle. Reach for it whenever a term needs building rather than
naming, and pitch it against his channel state (§0).

**Where he actually starts, recorded so nothing is pitched above it.** As of
v1.11 he knows the conclusion — high rates make the dollar attractive and pull
money out of gold, low rates the reverse — and not the machinery underneath it.
He has said he does not know why a hike cools inflation. Build from there.

### Where each term is built

*So a term can be found without reading the whole section. The order still matters
— anything below assumes what is above it.*

| Part | Builds |
|---|---|
| **1** | inflation · demand-pull vs cost-push · deflation |
| **2** | the dual mandate · the 2% target · anchored expectations |
| **3** | the federal funds rate · target range · basis points |
| **4** | how a hike cools inflation · long and variable lags · the mandate in tension with itself |
| **5** | bonds · yields · why price and yield move opposite · the 10-year |
| **6** | nominal vs real yield · TIPS · breakeven inflation |
| **7** | why gold is priced off real yields · the full chain from a jobs print to the gold price |
| **8** | CPI · PCE · core vs headline · PPI · NFP · unemployment · participation · claims · JOLTS · GDP · GDPNow · PMI · retail sales · consumer sentiment · FOMC · SEP · dot plot · FedWatch · QT and QE · hawkish and dovish · DXY · 10-year and 2-year · 2s10s · 5y5y · where to look each one up |

---

### 1 · What inflation actually is

Not "prices going up." That is the symptom.

**Inflation is a sustained rise in the general price level** — not one thing
getting dearer, but money buying less of everything. The classic framing is *too
much money chasing too few goods*: if the money in an economy grows faster than the
stuff to buy, each unit of it buys less.

That framing covers one of the two ways inflation starts, and the difference
between them is why half the vocabulary exists:

- **Demand-pull** — people have more money and want to spend it. Demand outruns
  what the economy can produce, and sellers raise prices because they can.
- **Cost-push** — producing things gets more expensive. Oil, wages, shipping. The
  cost passes through to the shelf.

**Why the distinction matters:** a central bank can do something about the first
and very little about the second. Raising rates cannot drill an oil well. This is
why an inflation print driven by energy is read differently from one driven by
services, and it is the whole reason "core" exists.

**Deflation is the mirror, and central banks fear it more.** Falling prices sound
good until you notice that if a thing will be cheaper next month, you wait — and everybody
waiting is a recession. Debts also get harder to repay, since you owe the same
number of dollars but each one is worth more. This is why central banks target a
small positive number rather than zero.

---

### 2 · Why 2%, and why a central bank targets anything

The Federal Reserve has a **dual mandate** written into law: stable prices and
maximum employment. In 2012 it put a number on the first half — **2% annual
inflation**, measured by PCE.

**Why not zero?** Two reasons. Zero leaves no margin for error — undershoot
slightly and you are in deflation, which is hard to escape.

And rates cannot easily go below zero, which matters more than it sounds. Nominal
rates sit at roughly the real rate *plus* expected inflation, so a 2% target holds
the whole rate structure about two points higher than a 0% target would. **That is
two extra points of room to cut before hitting the floor.** Targeting zero would
leave the Fed fighting the next recession with almost nothing to cut.

**Why announce it at all?** Because expectations are self-fulfilling. If everyone
believes prices will rise 2%, workers ask for 2% raises and firms plan 2% price
increases, and inflation comes out near 2% because everyone acted as though it
would. If belief slips, the belief itself becomes the problem.

**This is what "anchored expectations" means**, and it is why the Fed watches
breakevens so closely — they are the market betting real money on whether the
anchor is holding.

---

### 3 · The federal funds rate — what the Fed actually sets

**It is one specific, narrow thing: the rate banks charge each other for
overnight loans.** Banks are required to hold reserves; some end the day short and
some end long, and the short ones borrow from the long ones overnight. That rate
is the federal funds rate.

**The Fed does not decree it.** It sets a *target range* — "4.00 to 4.25 percent"
— and then makes it true by changing how much money is in the banking system,
buying and selling government securities to add or drain reserves.

**Why one overnight rate matters to everything.** It is the cheapest, safest
short-term borrowing there is, so it is the floor every other rate is built on. A
bank lending to a business for three years prices off it, plus a margin for time
and risk. Your mortgage, a company's bonds, a credit card, all of it stacks on
that base. Move the base and the entire structure moves.

**Basis points.** A basis point is one hundredth of a percentage point. 25bp = a
quarter point. The Fed moves in 25bp steps by convention, so "50bp" means a double
move and signals urgency.

---

### 4 · How a rate hike cools inflation

This is the chain he said he did not have. It works by **deliberately slowing the
economy down**, which is why it is a blunt tool and why the Fed hesitates.

**Step by step:**

1. **The Fed raises the funds rate.** Overnight borrowing between banks costs
   more.
2. **Every other rate follows.** Mortgages, car loans, business credit lines,
   corporate bonds.
3. **Borrowing falls.** A company deciding on a new factory at 4% may not build it
   at 8%. A household stretching for a house at one mortgage rate cannot at
   another.
4. **Saving becomes more attractive.** Money in a deposit account now earns
   something real, so some spending becomes saving instead.
5. **Demand falls.** Less borrowing and less spending mean fewer dollars chasing
   the same goods.
6. **Firms stop raising prices** — and in the harder cases, cut them, or hire less,
   or lay off.
7. **Inflation slows.**

**Two things about this chain that matter more than the chain itself:**

**It is slow.** Typically twelve months or more from hike to visible effect. The
Fed is steering something with a long delay between the wheel and the wheels,
which is why it moves in small steps and why it can overshoot without knowing
until later. "Long and variable lags" is the phrase.

**Step 6 is where it hurts.** The mechanism reaches prices by weakening demand,
and weaker demand means less hiring. **Cooling inflation and protecting employment
pull in opposite directions**, which is the dual mandate in tension with itself —
the whole reason FOMC members disagree and the reason there is anything to read in
a dot plot.

**Cutting rates runs the chain backwards:** borrowing gets cheap, spending and
hiring rise, and inflation risk returns.

---

### 5 · Bonds and yields — the piece that is usually skipped

Everything above happens in the real economy over months. The **bond market
reprices it in seconds**, which is why gold reacts to a jobs number before any
factory has changed a plan.

**What a bond is.** A loan you can trade. Lend the US government $1,000 for ten
years and it pays fixed interest and returns the $1,000 at the end. That security
can then be bought and sold.

**Why the yield moves opposite to the price — the one thing to actually
understand.** The payments are fixed. A bond paying $50 a year:

- Buy it at $1,000 → **5%**
- Rates rise, new bonds pay more, nobody wants yours at $1,000. It trades at $900.
  The buyer still gets $50 a year → **5.6%**
- Rates fall and yours looks generous. It trades at $1,100 → **4.5%**

**Price down, yield up. Always.** Nothing about the bond changed; only what someone
will pay for it.

**So a yield is a live vote on the future.** The 10-year Treasury yield is the
market's collective view of where short-term rates will average over ten years,
plus compensation for tying money up. It moves the instant expectations change —
before the Fed acts, and often instead of the Fed acting.

**The 10-year is the benchmark** because it is the deepest, most liquid, most
watched. When people say "yields," this is usually the one.

---

### 6 · Real yields, TIPS and breakevens

**A yield you can see is nominal — it says nothing about what it is worth.** 5% in
your pocket while prices rise 5% leaves you exactly where you started.

    real yield  ≈  nominal yield  −  expected inflation

**That real number is what an asset paying nothing has to compete with**, which is
the whole of the first channel in §2.

**TIPS make it observable.** Treasury Inflation-Protected Securities are Treasuries
whose principal adjusts with CPI, so the holder is compensated for inflation
separately. What is left is the pure real return — **the TIPS yield is the real
yield, quoted directly by the market.**

**Breakeven inflation falls out of the pair:**

    10-year breakeven  =  10-year nominal yield  −  10-year TIPS yield

Nominal 4.50% and TIPS 2.00% gives a breakeven of **2.50%** — the inflation rate at
which owning either bond leaves you equally well off. Above it, the TIPS holder
wins; below it, the nominal holder does.

**So the breakeven is what the market expects inflation to average**, priced by
people with money at risk rather than by a survey. It is the anchor the Fed
watches for whether expectations are holding.

**One trap in reading the level.** TIPS are indexed to CPI, but the 2% target is
written against PCE — and PCE runs a few tenths below CPI (§3, part 8). So a
breakeven around 2.3% is roughly consistent with the target being met rather than a
breach of it. What matters is a sustained drift well above that, not any print over
2.0%.

**A caution worth carrying.** TIPS trade in a smaller, less liquid market. In a
panic the liquidity discount widens, pushing TIPS yields up and squashing
breakevens — so a breakeven can fall in a crisis while actual inflation
expectations are rising. March 2020 was the extreme case.

---

### 7 · Why gold sits at the end of all of it

Now the thing he already knew, resting on something.

**Gold produces nothing.** No coupon, no dividend, no earnings. Its entire return
is the price change, so the case for holding it is a comparison: what am I giving
up by not holding something that pays?

**That comparison is the real yield.** Not the headline rate — the after-inflation
return on safe dollars.

- **Real yields high** → dollars pay you well in real terms → holding a
  zero-yield metal is expensive → pressure against gold
- **Real yields low or negative** → dollars lose purchasing power just sitting
  there → gold's zero yield costs nothing → pressure for gold

**Which is why gold reacts to a jobs number.** Payrolls come in hot → the Fed
looks likelier to stay tight → the market reprices rate expectations in seconds →
nominal yields rise → if expected inflation does not rise as much, real yields
rise → gold's opportunity cost went up. Six links, all of them in the bond market,
none in a shop.

**And why the comparison is not the whole price.** It is the mechanism, and it
decides how gold reacts to news on the day. Over months, demand that does not
care what a bond pays can outweigh it — since 2022, central banks buying at twice
their old pace have held gold up while real yields sat at fifteen-year highs (§2).
The comparison tells you which way the news pushes; it does not tell you who else
is buying.

**And why "high rates make the dollar attractive" is right but incomplete.** It is
the second channel — the currency effect — and it is real. But it sits on top of
the first one, and when the two disagree, knowing which is which is the day's
question.

---

### 8 · The metrics, built rather than named

Everything that shows up in a briefing.

#### Inflation

**CPI — Consumer Price Index.** Bureau of Labor Statistics, monthly, 8:30 a.m. ET,
usually mid-month. A **fixed basket** of goods and services bought by urban
consumers, priced repeatedly over time. Shelter is roughly a third of it, which
makes housing the single biggest mover. **The market's number**, because it lands
first and everyone watches it.

**PCE — Personal Consumption Expenditures price index.** Bureau of Economic
Analysis, monthly, later than CPI. Broader coverage — including spending made on
your behalf, like employer-paid healthcare — and **weights that update
continuously**, so it captures substitution: beef gets expensive, you buy chicken,
the index notices. Shelter is about 15% rather than a third.

**The Fed's target is written against PCE**, formally since 2012. PCE typically
runs a few tenths *below* CPI because of the substitution effect. **So: CPI moves
the market, PCE moves the Fed.**

**Core versus headline.** Headline is everything. Core strips food and energy —
not because they do not matter but because they are volatile and driven by
supply, and monetary policy cannot do anything about an oil shock. **Core is the
underlying trend; policy responds to core.**

**PPI — Producer Price Index.** What businesses pay for inputs, before it reaches
the consumer. Often a leading indicator of CPI.

#### Employment

**NFP — nonfarm payrolls.** BLS, **8:30 a.m. ET, first Friday of the month**. Net
jobs added or lost, excluding farm work. The single highest-impact scheduled
release for gold. Revisions to prior months arrive with it and are sometimes the
bigger story.

**Unemployment rate.** Same release. Share of people who want work and cannot find
it. Watch the **participation rate** alongside it — unemployment can fall because
people found jobs or because they stopped looking, and those mean opposite things.

**Initial jobless claims.** Weekly, Thursday 8:30 a.m. ET. New unemployment
filings. **Weekly and forward-looking**, so it turns before payrolls do.

**JOLTS — Job Openings and Labor Turnover Survey.** Monthly, lagged. Openings,
hires and quits. The **quits rate** is the interesting one: people quit when they
are confident of finding better, so it reads labour-market strength from the
worker's side.

#### Growth

**GDP.** Quarterly, revised twice. Total output. **Backward-looking by months** —
which is why §2 says to weight it below forward-looking prints, and to say so when
doing it.

**GDPNow.** The Atlanta Fed's running estimate of current-quarter GDP, updated as
data arrives. Not a forecast in the usual sense — a mechanical nowcast. Useful
because it is current where GDP is not.

**PMI — Purchasing Managers' Index.** Monthly survey of purchasing managers.
**Above 50 = expansion, below 50 = contraction.** Fast and forward-looking, since
it asks the people placing the orders. Two versions land in the same week — ISM and
S&P Global — on different panels, so they can disagree. ISM is the one markets
weight more heavily.

**Retail sales.** Monthly, 8:30 a.m. ET. Consumer spending is roughly two-thirds of
US output. Watch the **control group**, which strips autos, petrol, building
materials and food services — the volatile parts — and is what feeds GDP.

**Consumer sentiment (University of Michigan).** Twice monthly, preliminary then
final. The headline is mood, and mood is weak information. **The part that moves
markets is the inflation-expectations component** — a survey read on the same anchor
breakevens price, so a jump there is read as the anchor slipping.

#### Rates and policy

**FOMC.** Federal Open Market Committee. Eight scheduled meetings a year, decision
at **2:00 p.m. ET**, press conference at 2:30. The rate decision itself is usually
priced in; the statement wording and the press conference are where surprise
lives.

**SEP — Summary of Economic Projections.** Published at four of the eight meetings
— **March, June, September, December**. FOMC members' forecasts for growth,
unemployment, inflation and rates.

**The dot plot.** Inside the SEP. Nineteen anonymous dots when the board is fully
staffed — one per FOMC *participant*, which is more than the twelve who vote —
showing where each expects the funds rate at the end of each of the next years.
**The median dot is the headline.** A shift in the median — one cut becoming two,
or two becoming none — reprices the whole forward curve.

**Why the dot plot often moves markets more than the decision does.** The decision
is priced weeks ahead through futures. The dots are not published until the day
and cannot be front-run. On a meeting where a hold is 95% priced, the dots are the
only place a genuine surprise can come from — and when the dots match expectations,
the surprise moves to the *revisions* underneath: a changed inflation or
unemployment forecast implies a different path even when the dots did not move.

**CME FedWatch.** Probabilities of each rate outcome at each upcoming meeting,
derived from 30-day fed funds futures pricing. Those futures are priced at 100
minus the expected average rate, so the market's implied probability is arithmetic
rather than opinion. **This is what "the market has priced 80% odds of a cut"
means**, and it is the number to check before deciding whether an event is news.

**QT — quantitative tightening.** The Fed shrinking its balance sheet by letting
bonds mature without replacing them, draining reserves from the system. The
opposite, **QE**, is buying to add them. QT tightens alongside rate policy and is
slower and less visible — a second lever running in the background.

**Hawkish and dovish.** Hawkish leans toward fighting inflation: higher for longer.
Dovish leans toward supporting employment: cut sooner. A "hawkish cut" is a cut
delivered with language that says do not expect another.

#### The dollar and yields

**DXY — the dollar index.** The dollar against six currencies, weighted roughly
**58% euro**, then yen, pound, Canadian dollar, krona, franc. Not a trade-weighted
measure of the dollar against the world — substantially a EUR/USD proxy.

**The 10-year Treasury yield.** The benchmark long rate. Rises when growth or
inflation expectations rise, or when the Fed is expected to stay tight.

**The 2-year Treasury yield.** Much more sensitive to near-term Fed expectations,
so it moves hardest on a payrolls or CPI surprise. **The 2s10s spread** — 10-year
minus 2-year — inverts when short rates exceed long ones, which historically has
preceded recessions.

**The 5y5y forward breakeven.** Expected inflation for the five years starting
five years from now. Strips out near-term energy noise, so it is the cleanest read
on whether long-run expectations are anchored.

#### Where to look them up

The rates series live on FRED, the St Louis Fed's free database, under short codes
worth knowing because they are what a chart or an article will cite:

| Code | Series |
|---|---|
| \`DGS10\` | 10-year nominal Treasury yield |
| \`DFII10\` | 10-year TIPS yield — **the real yield** |
| \`T10YIE\` | 10-year breakeven inflation |
| \`T5YIFR\` | 5y5y forward breakeven |
| \`DGS2\` | 2-year Treasury yield |
| \`T10Y2Y\` | the 2s10s spread |
| \`FEDFUNDS\` | effective federal funds rate |

CPI and payrolls come from the BLS, PCE and GDP from the BEA, GDPNow from the
Atlanta Fed, rate probabilities from CME FedWatch.`,

  "4": `## 4 · The setups

Two, and **the difference between them is not where they are taken.** That is the
consequence; the difference is which way each one trades relative to the level —
and, following from that, which way it trades relative to the trend.

**Break & Retest is a continuation trade.** A level has already broken, and the
break is the premise. Price extends away, comes back, and the level it broke is
now the other thing — resistance that has become support, or support that has
become resistance. The entry is on that retest and it goes THROUGH the level, in
the direction of the break. **It runs with the trend.**

**Support & Resistance is a mean-reversion trade.** Nothing has broken. The level
is intact, price arrives at it and refuses, and the entry goes AWAY from the
level, back into the range it came from. **It aims at the reversal**, and being
counter-trend is the point rather than a problem — a trend is not a trend forever,
and this is the setup that trades the end of one.

So the bias from step 1 does not gate the S&R entry. It tells him which side of
the range he is fading and what he would be reversing. What keeps the reversal
trade honest is not the bias but the conditions: **an important level — a previous
high or low, not merely a place on the grid — plus rejection visible in the candle
and in the price action.** Those are R-06 and R-07 doing the work.

That distinction decides what a per-setup statistic means. A win rate split by
\`setup\` is a comparison of continuation against mean-reversion, not of one part of
the chart against another.

### The timeframes

Six charts with three jobs, and the hourly does two of them.

| Job | Charts |
|---|---|
| **Bias** — step 1 | daily, 4H, 1H |
| **Levels** — where the map is marked | 1H, 30m |
| **Entry** — the signal, the confirmation, the fill | 15m, 5m |

The 1H is the hinge: last of the bias charts and first of the level charts, which
is where a top-down read meets the map.

### How a level gets marked

Two sources, and both are on the 1H and 30m.

**The quarter grid** — the $25 increments. 4500, 4525, 4550, 4575, 4600. **00 and
50 are the psychological levels**, 25 and 75 the quarters between them: one grid at
two strengths, fixed and known before price arrives.

**Reaction points** — where price has actually turned. Previous highs and lows,
marked because something happened there rather than because of where they sit.

**A level is stronger where the two agree.** A previous high sitting on a quarter is
better than either alone. That confluence is the closest thing the document has to
a statement about level *quality* as opposed to level *position*.

Which structure is live is maintained in TradingView and deliberately not mirrored
here. A map kept in two places disagrees with itself, and a stale boundary produces
false violations that teach him to ignore real ones (§10).

### The sessions have characters, and that is a read rather than a rule

**There is no session rule** (§6) — the setup decides. But the sessions are not
interchangeable, and he reads them differently:

- **New York open is violent.** Sweeps that fail, levels taken and reclaimed, moves
  that look like breaks and are not. A touch there is more likely to be noise than
  signal.
- **Asia is calmer and steadier.** A level holding in Asia is more likely to mean
  what it looks like it means.

**This matters most for §4.2's wick-versus-close read.** Telling a sweep from a
genuine failure is harder in a violent session, which is the same judgment being
made against a worse signal-to-noise ratio.

**Asian and London appear thinly in his data because of when he sleeps, not
because he avoids them.** He usually trades the Asian open until around 1–2 a.m.
his time and is back for New York; London runs while he is asleep. If travel puts
him at the screen for it, he trades it. **Never read a thin bucket as a
preference** — it is availability, and inferring a rule from it is the failure §5
guards against with the sizing rung.

**The Asian session straddles the calendar date.** It opens the previous evening,
so the Asian session he trades on a Tuesday morning opened Monday. A Tuesday
release has nothing to do with it. R-12 counts entries per \`open_day\` — the
New York calendar date the position opened — so a 1 a.m. Asian trade and a 10 a.m.
New York trade on the same date are **two entries on one day**, which he has
confirmed is how he counts it too.

### 4.1 · Break & Retest

Journal value: \`Break & Retest\`. Taken at interior levels, never at an extreme
(R-05). **An interior level is any level inside the range**, marked either by the
quarter grid or by a previous price reaction — the grid is one of the two sources,
not the definition.

**The premise is the break, and the trade is the retest.** Entering on the breakout
itself is a different trade and not this one: the retest is what separates a level
that has genuinely flipped from a push that is about to fail back. It is also what
makes the stop tight, since the level being retested is close by — and a tighter
stop under the same target is where this setup's reward-to-risk comes from.

**Confirmation is required at the retest, not at the break.** A signal is price
reaching the flipped level and rejecting it; confirmation is a close in the
intended direction, or the reaction resolving clearly enough to enter before one
(§6, R-07).

**Where the idea is wrong is price back on the original side of the level**, and
that read is a stop-placement input rather than an exit rule — it is what §6's
*Before the trade* turns into the stop. Gold moves far enough that a poke through
is not by itself the break having failed; what the read produces is a price, not a
decision to close.

**How it loses:** the break was liquidity rather than intent, so the retest keeps
going and closes back through. Read as continuation, it is the only failure this
setup has.

### 4.2 · Support & Resistance

Journal value: \`Support & Resistance\`. Taken at the outer extremes of the range
only, never at an interior level (R-06). The extremes are few and thick, which is
what makes them worth fading and what makes an entry there rarer.

**The premise is that the level holds.** Price arrives, refuses, and the trade is
the refusal — a signal is that rejection, and confirmation is the close or the read
(§6, R-07).

**A WICK THROUGH THE LEVEL IS NOT THE LEVEL FAILING**, and this is the single most
important line in either subsection. A wick that pierces the extreme and closes
back inside is a liquidity sweep: the stops resting beyond the level were taken and
price refused anyway, which is the level holding rather than failing.

That is why §6 allows re-entry after a sweep takes the stop and price comes rapidly
back — a stop tighter than $20, since a full one has already spent the day. It is not an exception to the rules and not a revenge trade — the idea was
never invalidated, the stop was simply inside the sweep. The trade being stopped
out and the idea being wrong are two different events at an extreme, and only the
second one ends it.

**How it loses:** the range is over. A level that had turned price back stops doing
so, and a fade taken into a break is the failure this setup has — the mirror of
§4.1's.`,

  "5": `## 5 · Risk

### The stop is a ceiling of $20, set at entry from the chart

Not a value. **$20 is the most it may ever be**, and where it goes is read off
price action at entry — the level beyond which the idea is wrong, as close as that
can honestly be put. A $10 stop and a $20 stop are both compliant; a $22 stop is
not. It is measured from the fill price on the chart, with no allowance for spread
(§0).

**Placed at entry and never moved tighter, with one exception.** The only movements
a stop makes are to break-even at +$20 (R-04) and R-19's handling of a print landing
on a position inherited from an earlier session.

**R-02 survives both**, which is why the exception costs nothing. A stop that only
ever moves to break-even *or tighter* still cannot produce a loss beyond $20 without
having been widened — the direction R-02 depends on is untouched.

### Risk per trade is at most 4% of account

The ladder is 0.02 lots per $1,000, continuous, so at the full $20 stop:

    0.02 lots = 2 oz    account $1,000    $20 stop = $40   = 4.0%
    0.10 lots = 10 oz   account $5,000    $20 stop = $200  = 4.0%

Linear, so the share is the same at every rung. **4% is the ceiling rather than the
figure** — a $12 stop at the same rung risks 2.4%.

In the shape of a month: **two and a half maximum stops erase a +10% month**, and
**1.7 winners at $30 make one**.

Deriving it rather than storing it is deliberate. \`size_oz\` is on the row, so the
account tier and the dollar risk of any past trade are recoverable from the trade
itself, and a stored percentage could disagree with the ladder that produced it.

### At most one entry a day, and this is the strictest rule here

**One trade per day. Two only when the second is a sweep re-entry** (§6). A third is
a violation on the face of the data — R-12 is a count.

It is aimed directly at what §9 says goes wrong. The failure is impatience at a
level, and a hard cap of one is the structural answer: a trade taken impatiently at
nine in the morning costs the whole day rather than being followed by another.

**What he is working toward is fewer — about four trades a week.** An aim, NOT a
rule, recorded the way this section records the sizing pattern. Report the weekly
count as a plain number when asked, never as a verdict.

It has a consequence for everything statistical here. At that frequency no rate
means anything for a long time. **The value of the journal is the per-trade record,
not the statistics.**

### The day also ends at 4%, and a full stop is the usual way of reaching it

**A full stop is the day's 4%, at every rung.** The ladder is linear, so a $20 stop
on \`size_oz\` ounces loses \`20 × size_oz\` against an account of \`500 × size_oz\`
— 4% exactly, before commission. R-03 and R-11 agree on every full stop.

**Two rules all the same.** Several smaller losses — a tighter stop taken, or a
hand-cut exit — can spend the 4% without R-03 firing, which is R-11's half. And R-03
reads prices alone, so it decides a day whose rows carry no size, where R-11 is
\`unknown\`. In practice R-12's one-entry cap reaches first on most days.

### Nothing else caps a loss, and that is deliberate

**No weekly maximum. No monthly maximum.** The day is the only window with a
number attached. What stops a bad run is R-17, and it is not a number.

### When he stops trading altogether

**R-17, and the trigger is behavioural rather than financial.** When the trading
itself has gone wrong — rules being broken, chasing the move to get back to flat —
he stops for a stretch, and he has done this. **Even at a 5% loss.** The size of
the drawdown is not what tells him; the way he is trading is.

**A bad stretch is crazy trading, in his words — not losing with proper entries.**
A run of losses on trades taken by the sequence is the strategy's variance, and no
reason to stop.

**This is the only rule in the document that watches how he is trading rather than
a price, a distance or a percentage.** Everything else is arithmetic. This one
cannot be, because what it watches is not on a row.

**Why a number would be worse.** A 5% loss traded calmly is not a problem. A 5%
loss with the frequency climbing is, because the mechanism producing it is still
running and getting stronger with each loss. A threshold fires on the wrong
variable.

**Roughly a week, and the week is a description rather than a rule.** What actually
ends the break is the state, which he named precisely: **back to chasing setups and
the plan, not results.** A stated seven days would have him breaking a rule by
returning on day five when he was ready, or holding out on day nine when he was
not.

**That phrase is the whole of §9 in six words.** Entering on the touch is chasing
the result instead of the setup. Revenge trading is the same thing under pressure.
The break ends when the orientation flips back.

**R-12 is the earliest guard against the stretch that triggers this**, since
chasing requires repetition and one entry a day removes it.

### One position, always

One trade at a time. No scaling in, no adding, no second position — so the stop is
the whole exposure and 4% is the most at risk at any moment. R-10, and two rows
whose entry-to-fill spans overlap are a violation on the face of the data.

### Nothing changes size but the ladder

No setup is sized up, no session is sized down, **no time of day changes anything.**
The rung is the only input.

### The rung moves between months, never inside one

**R-13, from experience rather than theory:** he moved size mid-month once, it
disrupted the flow, and the rule exists because of that.

It also removes a bookkeeping problem. The monthly target is a percentage of the
account, the account is read from \`size_oz × 500\`, and a month with two sizes has
two answers to *did I hit 10%*. Pinned to month boundaries there is one size per
month and the ambiguity disappears rather than being resolved by convention.

Checkable: more than one distinct \`size_oz\` inside a calendar month is a broken
rule visible in the data.

### Moving up a rung is discretionary, and it is a deposit rather than a threshold

**He changes it by hand, when he feels like it** — at a month boundary, per R-13.
No trigger a program could evaluate, so the timing is never a violation.

The pattern, not a condition: **holding the 10% for a couple of months at the
current size**, then depositing and moving to the next level. The rung follows the
money in, and the money in follows the months.

So the ladder does not track the balance and does not step when an account crosses
a number — which is why §8 computes the month against the size actually traded.

Because the increase is funded rather than compounded, the 4% survives the change:
the new rung is 4% of the new account, not a larger share of the old one.

### Coming down a rung

**His judgment, with no number, at a month boundary** like every other move (R-13).
What he is keeping is *the maximum stop at about 4% of what is actually there*: when
the capital behind the size has shrunk far enough that a full stop is a much larger
share of it, he steps down.

**Not measurable here, and deliberately so.** \`size_oz × 500\` is the account the
size implies, so it cannot fall while the size stays put, and the capital he holds
off-broker is on no row. A threshold written for him would be a number he never
set.

His reason is the psychological half of the same arithmetic: he does not want each
trade's risk large relative to the account. A 4% stop held through a shrunken
account is an 8% one at the same size, and the second is much harder to take
properly.

**The downward step is not funded.** The account shrank by what was lost, not to the
lower rung's level, so trading the lower rung risks *less* than 4%. That is the
brake working.

**She does not raise it.** When to step down is his call; asked, she can say what a
full stop now costs against what he tells her he holds.

### Known low-volume days

**R-16: no trading on US market and bank holidays, or through the Christmas-to-New-
Year stretch.** Calendar-known rather than judged at the screen, so it is decidable
the day before — and checkable, since a holiday is a known date.

**The reasoning is also why a release is handled differently.** Both setups
depend on levels meaning something: a break that is real, a rejection that is
real. A holiday thins that for the whole day and nothing at the screen repairs it,
so he stands aside. A release breaks it for minutes, at a time printed in advance,
so he trades the day and is cautious around the print (R-20) — adapting rather
than standing aside.

### The monthly target stops nothing

+10% of account a month is the yardstick §8's monthly figure is measured against.
**Reaching it does not end the month.** He keeps trading, same rules, and no trade
can violate anything by being taken after the target was met.`,

  "6": `## 6 · Lifecycle

### Before the trade

R-08 requires a pre-trade sequence run in order, with a failed step ending it
rather than being weighed against the others. **The same four steps for both
setups:**

1. **Top-down bias** — daily, 4H, 1H
2. **Levels** — liquidity pools, support and resistance, and the grid: 00 and 50
   psychological, 25 and 75 quarters, plus the reaction points where price has
   actually turned. Marked on the 1H and 30m (§4)
3. **Candle or chart pattern** — signal first, then confirmation. Read on the 15m
   and 5m
4. **Reward-to-risk of at least 1:1.5**

The order is the rule. A failed step ends the sequence rather than being traded off
against a later one, so a setup that fails step 1 is not rescued by a clean step 3.

**Every step gates.** Psychological levels were a separate step through v1.8 and
were folded into step 2 at v1.9, because they added no test of their own — and a
step that can never be the step you stopped at breaks the one claim R-08 makes.

**When he brings a plan before the fact, she runs the sequence with him** — each
step against what he shows her, a step she cannot see named rather than passed —
and says whether she would take it. That verdict is hers; the sequence and the
levels stay his.

### Before the sequence runs — the calendar

**R-16 is the one calendar rule that keeps him out**: low-volume days (§5).

**R-20: he trades at any hour, and is cautious around a top-priority release.** A
top-priority release is **a US release TradingView rates high** — his decision
since v1.20, so one calendar serves the briefing and the rules. No window keeps
him out, before the print or after it.

**The caution is a judgment, and it is not a number.** It is the print weighed
into the read: knowing it is due and what is priced, and judging whether the level
can carry a trade through it. It changes no size (§5) and no stop — both already
come from elsewhere. Anything sharper is his to write, and until he does it is
\`[decide]\` and never supplied for him.

**It is his, so she does not remind him of it.** The briefing names the day's
prints with their times, and that is where the caution gets what it weighs. A
message when he opens a trade with a print ahead, or a print cited at him beside
a position he opened knowing it was there, tells him what he already weighed —
nothing reaches him on an open.

**It is not one of R-08's steps**, so a plan never fails his sequence for a print
being due. Whether she would take it with the print ahead is part of her own
judgment when he asks, said as hers.

**It is local to the release, not to the calendar day.** A Tuesday 10 a.m. print
does not touch the Asian session he traded that morning, which opened Monday
evening (§4).

### Where the stop comes from, and why it is the same read as the target

Step 2 produces the level. **The read of where the idea would be wrong produces the
stop** — the price beyond which the premise has failed, as close as that can
honestly be placed, and never further than $20 (§5). A stop-placement input, not an
exit rule: nothing closes a position for reaching an invalidation the stop was not
at.

Step 4 is arithmetic over what steps 2 and 3 produced:

    (target distance) / (stop distance)  >=  1.5

**On the default path it is satisfied by construction.** A $30 target over a stop of
$20 or tighter is always at least 1:1.5, so step 4 refuses nothing and needs no
checking. It binds in exactly one place, below.

**Nothing stored can see steps 1 to 3.** Step 4 can be read only off a row
carrying the stop and target as first seen (§8), which is the trades since that
began; on every other row it is arithmetic he runs, not arithmetic anything
verifies.

### The $25 target is two different things

Both permitted, not the same decision. **$30 is the target; $25 is the exception.**

**As an entry choice.** The level looks hard to reach before he is in, so $25 is set
from the start. **This is the one place step 4 binds:** $25 over a $20 stop is
1:1.25 and fails the sequence, so a $25 entry target requires a stop of $16.67 or
tighter. The only pairing that can enter in breach of his own rule, and only a row
carrying the plan as first seen can show it (§8).

**As a management decision.** A $30 target is on and structure shows it is genuinely
hard to reach — multiple recent highs in the way, or the level turning. Pulling it
to $25 is permitted; step 4 already passed at entry.

**So a realised 1:1.25 is legitimate as an outcome and illegitimate as a plan**, and
only a row carrying the plan as first seen can tell which produced it.

### Entry

A signal is price reaching a level and rejecting, and it is not an entry.
Confirmation is required and is either a candle closing in the intended direction,
or the reaction around the level resolving clearly enough to enter before a close.
Entering on the signal with neither is the violation R-07 names, and §9 is why it
has its own section.

**Entry is at market.** No resting limit back into the level, so the fill is where
price was when he decided.

### Session is not a step

**There is no session rule.** The setup decides and the clock does not. Time of day
is not one of the four steps and never disqualifies a trade.

But the sessions are not interchangeable, and §4 records what they mean to him —
New York violent, Asia calmer — as an input to the read rather than a gate.

Recorded as his own description of himself, dated v1.9 and explicitly **not a rule
and not a finding**: he is more careful around the New York open. §9 now gives the
reason, so it is one coherent thing rather than two facts.

### While it is on

Stop moves to break-even once price has travelled $20 toward the target. Target may
be shortened to $25 as above. Beyond those two, nothing: no partial exits, no
adding, no widening, and **no tightening**.

**One forced exception, and it is time-based: R-15, the Friday close** — below.

**And one narrow one, R-19, for a print landing on a position he is already in.**

### R-18 — the orders do the exiting

**Stop and target are placed as resting broker orders, always, and a position is
never closed by hand.** A rule in its own right, separate from where the orders sit:
R-01 and R-02 say what price they are at, and this says that they — rather than he —
are what ends the trade.

**It makes the other two predicates exact rather than suggestive.** With a resting
order, a loss closing beyond $20 is an order that was edited; there is nothing else
that could produce it. And a win under $25 is not a judgment call made at the screen
— it is the order not having been where the rule says it was, or the position having
been closed by hand, which is itself the violation.

**Two things are not manual closes and must not be flagged as such.** Moving the
stop to break-even (R-04) is an order edit, and so is R-19's tightening. **R-15's
Friday close-out is a genuine manual close and is the one permitted case** — forced
by rule, not chosen.

### R-19 — a print landing on a trade he is already in

**It covers the print he did not take on at entry.** He may enter at any hour, so
a position meeting a print is not rare — but one opened in the session the print
lands in took it on knowingly, and that is R-20's caution, not this rule. R-19 is
the other path: **a trade opened in an earlier session —
usually the Asian — still running through London into New York**, where the print
lands. A multi-session hold colliding with the calendar rather than an entry
taken beside it.

**Why the stop has to move.** A $20 stop assumes price trades through it. A
high-impact print can gap straight past, so ahead of one the real exposure is $20
plus whatever the gap adds. Tightening reduces the exposure that is actually there
— it is not a change of mind about the trade.

- **In profit** — stop to break-even, **regardless of R-04's +$20 threshold**
- **Losing** — tighten to a closer invalidation the chart gives; pull the stop in
  only if there is none. Chart first, arbitrary as fallback, the same order as the
  entry stop (§6, *Where the stop comes from*)
- **The target never moves.** A print is not a reason to shorten to $25
- **Never wider**, ever

**Read narrowly or it becomes a door.** Written as a general tool it makes "there is
news later" a reason to touch any position — the same shape as the sweep re-entry,
which §7 already flags as pushable. It applies to a position inherited from
an earlier session and to nothing else.

### Re-entry after a sweep, and it is bounded three times

Where a liquidity sweep takes a stop tighter than $20 and price comes rapidly back,
he may enter again. **Never after a full stop**: $20 is the day's 4% (§5), so R-03
and R-11 have both ended the day. **Same level, same direction, and it has to be a true sweep** — the same
trade re-entered because the idea was never invalidated, not another go at a loss.

**Rapidly back means a couple of 5-minute candles, three at most** — about fifteen
minutes from the sweep to the return. Past that it is not a sweep re-entry; it is a
new idea.

**Once.** One re-entry and the day is over regardless, which is R-12's second entry.
Without the cap the reasoning is reusable, and a violent session would swallow the
day one "sweep" at a time.

**The fifteen minutes is checkable and the rest is not.** \`entry_time\` on the second
trade against \`fill_time\` on the first gives the gap directly, so a late re-entry is
a real \`fail\`. Inside the window, a genuine sweep re-entry and a fast revenge trade
are identical rows. One-sided, like R-02 and R-03.

### Exit

**Price-based, with one time-based exception.** A trade ends at its target, at its
stop, at break-even once R-04 has moved the stop there — or at the Friday close.
Nothing else closes a position for taking too long; a trade going nowhere on a
Tuesday is left alone.

### R-15 — nothing is held over the weekend

**A rule, and his reason is the right one:** weekend news makes the Monday open
unpredictable and price can gap straight over the stop. A stop only holds if price
has to trade through it, and across a weekend it does not.

**Two parts, and they fail differently.**

- **No position open across the Friday 17:00 New York close.** Checkable on the face
  of the data, and a violation is unambiguous.
- **A live trade is closed at market before it.** Target or not — so the exit is
  neither target, stop, nor break-even.

**He leaves it open right up to the close.** Not a Friday policy of flattening
early: the trade gets every minute it can have, and the close-out is a last resort.

**Which is what makes the R-01 exception narrow enough to be worth having.** A
Friday close-out at +$12 is a win under $25, and R-01 would flag it as a
discretionary exit every single time. Because the close-out sits at or very near
17:00 New York, the exception can be tight: **a win under $25 filling at the Friday
close is \`unknown\`; one filling at 2 p.m. Friday is still a flag.**

**And weekday swap still applies.** §8's reasoning about \`net_pnl\` over
\`computed_pnl\` survives — positions still cross the 17:00 rollover midweek, and
Wednesday's triple swap is the expensive one. Only the weekend is off the table.

### Recording

**He journals at entry**, while the trade is fresh and before the outcome exists to
colour the answer. The three discipline answers ask whether the stop and target were
*respected*, not whether they were moved. \`null\` is unanswered and is not "no".

He does not journal the plan. \`planned_stop\` and \`planned_target\` were tried and
retired at v1.8 — he journals a trade, not a plan. The broker's stop and target, as
the poller first saw them on the open position, are on the row instead (§8).`,

  "7": `## 7 · The rules, enumerated

Every rule the sections above impose, in one table a program can hold him to. The
prose is not repeated here — the Rule column is a handle, and §-references point at
the reasoning. The table itself is in the always-loaded half.

**Evaluable** is the load-bearing column:

- \`journal\` — computable from a row today. A predicate is given and it is not
  optional.
- \`field\` — would be computable if a column existed. The column is named.
- \`judgment\` — cannot be checked from stored data at all. A probe is given instead.

A \`judgment\` rule is not a weaker rule. It is a rule whose compliance the system
cannot see, and labelling it is what stops it quietly counting as passing.

**Her judgment of one before the fact is not a verdict on it.** When he brings a
plan, she judges R-05 to R-08 against what he shows her (§6). That is an opinion
about a setup, said as hers: it never becomes a \`pass\`, and nothing she judged
ahead of a trade is counted after it.

**Marker** is the rollup. \`followed_rules\`, \`followed_sl\` and \`followed_tp\` are one
boolean each, covering every rule mapped to them.

### Notes on individual rules

**R-18 is what makes R-01 and R-02 mean what they say.** With resting orders, a loss
beyond $20 is an edited order rather than a decision at the screen, and a win under
$25 is the order not having been where the rule puts it.

**R-18 IS \`journal\` BECAUSE A HAND CLOSE SENDS NOTHING.** The prices look the same
either way, which is why this was judgment. The broker's alert does not: cTrader
emails "Stop loss filled" or "Take profit filled" when an order fills and sends no
alert at all for a position closed by hand — his own account, confirmed against
eight closes with no alert behind them. \`net_pnl\` is written from that alert
alone, so a closed row without one is a hand close. **R-15's Friday close-out is
the permitted one** and passes at the Friday close (R-01's window). **A close under
an hour old is \`unknown\`**, because its alert may still be on its way. The risk is
one-directional and named: an alert the sync lost would read as a hand close, and
the failure names the trade so it can be looked up in Gmail.

**R-19 is \`journal\` since v1.19, and it must stay narrow.** Two things made it
checkable: TradingView's calendar says a print was pending, and
\`trade_stops\` keeps every stop and target the poller saw a position carry, where
the row keeps only the first and the broker only the last. The population is a
position a high-rated US release landed on in a session later than the one it opened in —
the one path the rule is written for. Read generally it turns "there is news later"
into a reason to touch any position, which is the same door §7 already flags on
the sweep re-entry.

**What it can and cannot part.** A stop at break-even or better passes, whichever
way the trade stood — a losing trade cannot hold a stop past its entry. An
untouched stop fails, because both branches move it; so does a wider one, and a
target that moved. **A stop tightened short of break-even is \`unknown\`**: that is
the rule on a losing trade and a breach on a winning one, and whether it was winning
at the print is a price no row holds. A move is recorded up to two minutes after it
is made, so the stop in force is read a few minutes past the print — a move just
before it is never read as late, and one just after it passes.

**The calendar is TradingView's, fetched a whole week at a time** — nightly for
the current week, and once by hand for the weeks already traded, since its data
goes back to 2003. A week no whole-week fetch landed for is \`unknown\` rather
than quiet: a week with no releases stored and a week nobody fetched would
otherwise read the same, and a print that landed on a position in the second
would never be looked for.

**R-01's lower bound is the half that catches anything.** The target may be $25, so
a win at $25 is the rule working. A win BELOW $25 is a position closed before any
target he is allowed to set.

**Its Friday exception is narrow on purpose.** R-15 forces a close at the Friday
close regardless of where price is, so those wins are under $25 by rule rather than
by discretion. Because the close-out sits at or near 17:00 New York, only a win
filling *at the Friday close* is exempted — a Friday 2 p.m. close-out is still a
flag. Exempting all of Friday would have been the lazy version and would have
blinded the rule for a fifth of the week.

**R-01 IS NOT R-02'S MIRROR.** On a loss, further from entry is always worse. On a
WIN it can be better: a take profit at $30 fills at $30 or through it, so a gap
fills at $30.60 with nothing having moved. An R-01 flag on an overshoot is a
question, not a finding.

Break-evens are not caught by this and must not be: an exit within $3 of entry is a
scratch by result, so R-04 firing never reads as a target missed.

**R-02 CHECKS THE CAP ON EVERY LOSS, AND THE RESPECT WHERE THE POLLER WATCHED.**
The cap compares against 20 flat. Since the stop is a ceiling and is usually tighter
(§5), a $10 stop that closed $18 from entry is a stop widened by eight dollars or
slippage on a gap, and the cap passes both. \`trade_stops\` tells them apart: a
sighting further from entry than the stop that rested before it is a widening, on a
win as much as a loss, and an exit past a stop that never moved is slippage, which
passes. A stop pulled and never put back recorded no distance, and is \`unknown\`.
And a sighting more than $20 from entry is the cap broken where it was set, on a
win as much as a loss: the exit alone cannot see a $22 stop that won its target.

**It reaches only the trades the poller recorded** — none before \`trade_stops\`
existed (v1.19), and a move and a close inside the same two minutes is never seen.
So a clean R-02 run is no stop past $20 anywhere and no widening on the trades with
a history. Never read it as stops respected on the rest.

Expect occasional false positives from the spread: a broker stop fills against bid
or ask, so a $20 stop can close a dollar further out (§0).

**R-03 IS \`journal\` BECAUSE A FULL STOP IS $20 FROM ENTRY, BY HIS DEFINITION.**
It was \`field\` while §12 also counted a stop set tighter at entry and taken in
full — a $12 loss of that kind cannot be told from a hand-cut exit, so the
population was missing. He settled it at v1.14: a full stop is the stop hit at
$20. A loss $20 or more from entry is one, anything smaller is not, and the rule
runs over every row that carries both prices. A loss past $20 is also R-02's
breach, and it is still a full stop — the stop is what ended the day. A day whose
losses cannot be measured, or whose full stop carries no \`fill_time\` to count
later entries from, is \`unknown\` wherever it holds a second entry.

**It has no exception.** A sweep re-entry follows only a stop tighter than $20,
which is not a full stop, so it never reaches this population; one entry after a
full stop is a \`fail\`. That closes the door the exception used to open on a full
stop. On a tighter one it stays open — nothing separates a genuine sweep re-entry
from a rationalised one, and *"that was just a sweep"* is available every time.
R-11, R-12 and R-17 are the backstops there; the honesty is his.

**R-04 is \`journal\` because the broker keeps the path.** This section called it
unrecoverable — the prices on a row are endpoints — and the broker's minute bars go
back a year, so \`best_price\` records the furthest a trade ran in his favour while
it was open (§8). A loss beyond the scratch band on a trade that had already been
$20 in his favour is a stop that was not moved: that is the breach. **Still
one-sided, and the population is losses alone** — a win proves nothing about the
stop, and a break-even is R-04 having fired. A loss that never reached $20 passes,
since the rule never engaged.

**It under-detects and never over-detects.** Only whole minutes inside the trade
are read, so a spike in the first or last minute is missed; the figure can fall
short of the truth and cannot pass it. A trade too short to hold a whole minute
carries no figure and is \`unknown\`.

**R-05 and R-06 are judgment because of where the zone map lives**, not because they
are vague. The probe can also ask the better question now that §4 records how a
level is built: not only *extreme or interior*, but whether the grid and a reaction
point agreed there.

**R-05 can only ever be violated, never confirmed.** An empty population returns
\`unknown\`. A clean run means either the rule was kept or no extreme has broken
lately, and the journal cannot separate those.

**R-07 IS THE ONE THAT MATTERS MOST AND THE ONE NOTHING CAN SEE.** His primary
failure mode by his own account, invisible in every row. §9 is the section about it.

**R-10 and R-11 were rules without IDs** until v1.9 — both stated in §5's prose from
v1.5, neither ever checked. Both are computable from broker columns alone.

R-11 needs the account from \`size_oz × 500\` (§8), so it is \`unknown\` on any day
whose rows carry no size.

**R-12 is a count and it is the one that will fire.** One entry a day, two when the
second is a sweep re-entry, three never. **The fifteen-minute window makes half of
it checkable:** a second entry more than fifteen minutes after the prior \`fill_time\`
is not the permitted re-entry and is a \`fail\`. Inside the window it is \`unknown\`,
because the data cannot tell a sweep re-entry from a fast revenge trade.

**R-13's violation is retrospective.** More than one distinct \`size_oz\` inside a
calendar month means the rung moved mid-month.

**R-15 is fully checkable in one half and not at all in the other.** A position open
across the Friday close is unambiguous. Whether a Friday close-out was the rule
firing or a discretionary exit is not — which is what R-01's narrow exception is
for.

**R-16 is the most checkable rule here.** A US market or bank holiday is a known date, so an
entry on one is a violation with no missing column and no judgment.

**R-20 IS \`judgment\` AND MUST STAY SO.** Caution has no number — he lifted the one
the retired R-14 carried — so no row can say whether he was careful. A US release
rated high near an entry is a fact she can state; it is never a breach, and an
entry minutes before one is not a finding. R-14's ID is not reused.

**R-17 cannot be checked and must not be turned into a number.** The trigger is the
quality of the trading, not the size of the loss — he has stopped at 5%. A
drawdown threshold would fire on the wrong variable and would miss the case the rule
exists for: a small loss with the frequency climbing. §5 has the reasoning; the
probe is a question, and it is one he can answer better than any row.

### The judgment set is now settled rather than pending

R-05, R-06 and R-07 would each become checkable with a single question at
journalling time. **He decided against adding them at v1.9**, and §10 records the
decision and its cost. R-04 was on that list and left it at v1.15 by another route —
the broker's own bars, with nothing asked of him. R-17 and R-20 were never
candidates — each watches something no column could hold.`,

  "8": `## 8 · Journal binding

What a row can answer, what it cannot, and the filters that have to be applied
before any of it is read. This section exists because a rate computed over the
wrong population looks exactly like a rate computed over the right one.

**Nothing cites this section**, which is why §0's index names it explicitly. Read it
before producing any number, not after being asked to justify one.

### What is on a row

**Broker-owned and served to you** — written by the poller and the email parser,
never by the app: \`direction\` · \`entry_time\` · \`fill_time\` · \`entry_price\` ·
\`exit_price\` · \`size_oz\` · \`open_day\` · \`pnl\` · \`net_pnl\` · \`planned_sl\` ·
\`planned_tp\` · \`best_price\`.

**Journal-owned** — written by the app alone: \`setup\` · \`followed_rules\` ·
\`followed_sl\` · \`followed_tp\`.

**Derived at read time, never stored:** \`result\` · \`session\` · filing day ·
completeness.

### On the row and deliberately withheld

Four columns exist in \`trades\` and do not reach you, and the reason each is
withheld is a rule rather than a tidy. A fifth, \`deleted\`, is filtered before you
see anything, so the soft-delete filter below is already applied and is listed
because the rest of that table is not.

\`commission\` is already inside both P&L figures — the poller folds it into
\`computed_pnl\` and the broker's \`net_pnl\` is settled — so every figure you read
is net of it. Held, it would only ever be a way to subtract costs a second time.

\`balance\` moves on transfers with no trade behind them, and the account this
document computes against is \`size_oz × 500\` (below). Held, it would only ever be
a way to reach for the wrong denominator, which is the error §8 exists to stop.

\`computed_pnl\` is the folded figure with no swap in it. \`pnl\` is already
\`coalesce(net_pnl, computed_pnl)\`, so you can see the fallback where \`net_pnl\` is
null without being able to reach for the unsettled number by name.

\`user_id\` is not about trading at all.

**The withholding is structural rather than instructed**, and that is the point:
a rule you are told can be forgotten in the middle of a long answer, and a column
you are never handed cannot be. Where this document says never do a thing with a
number, check whether the number is even in front of you — several are not, and
the absence is the enforcement.

### Position size, and what it makes computable

\`size_oz\` is the position size **in ounces**, as opened. Ounces because that is the
unit both broker sources state it in, so storing anything else would mean converting
away from what both of them said.

    lots     = size_oz / 100
    account  = lots × 50,000   =  size_oz × 500

**Two limits.** Written by the poller alone, so a position it never reached carries
no size and never will. And null on every row that closed before the column existed.
Filter for it rather than assuming it.

### What is still not on a row, and why

**Maximum favourable excursion is on the row now, as \`best_price\`** — the highest
bid on a buy, the lowest on a sell, read off the broker's minute bars for whole
minutes inside the trade. This list said it was not available from the broker, and
it was: the bars go back a year, so it reaches every trade in the journal rather
than only the ones after it. Excursion is \`best_price − entry_price\` on a buy and
the reverse on a sell. It can fall short of the truth, never pass it — a spike in
the first or last minute is not read — and it is null on a trade under a minute
long, and on any the poller has not reached yet.

**The plan — no longer entirely absent, and the change is narrow.** This section
said it was unrecoverable, and that was right about a CLOSED position: a stop moved
to break-even has overwritten the original in everything the broker reports
afterwards. Nobody had asked about an OPEN one. The broker serves \`stopLoss\` and
\`takeProfit\` on a live position, and the poller runs every two minutes, so it now
records both the first time it sees a position — \`planned_sl\` and \`planned_tp\`.

**AS FIRST SEEN, NEVER AS SET, and say it that way.** Up to two minutes separate the
entry from the poll that caught it. For R-04, which moves a stop only after +$20,
that gap is immaterial; for a stop moved inside two minutes it is wrong, and nothing
can tell those apart.

**It looks forward only.** Every trade that closed before the column existed carries
null and always will, so the sample is small and grows one trade at a time. A rate
computed over it is a rate over the trades since — never over his record.

**What it makes computable:** the reward-to-risk the trade was AIMED at, which is
step 4 of R-08 — \`(planned_tp − entry) ÷ (entry − planned_sl)\` on a buy, inverted on
a sell. That is a number rather than a probe, on any row carrying both.

**What it does NOT settle alone.** An exit past the planned stop is a widened stop or
ordinary slippage on a gap, and the row cannot tell those apart — \`trade_stops\`
can, and R-02's respect half is judged there (§7). Whether a win at $25 was a
shortened target or an early close is unchanged.

The Evaluable column in §7 is therefore unchanged too. A rule is \`journal\` when a
row can answer it, and today almost no row carries this.

**Whether a second entry was a sweep re-entry.** R-12 permits two when the second
follows a sweep. The fifteen-minute window makes a late second entry checkable; a
prompt one is \`unknown\`.

**Whether a Friday close-out was the rule or a choice** is now half answered. A
missing \`net_pnl\` says the position was closed by hand (R-18), and the timing says
whether that was at the Friday close — so a hand close then is R-15 firing. What no
row says is why a Friday exit that was an order filling happened to land then.

**What his caution changed around a print.** Whether a high-rated release landed
near an entry is answerable off TradingView's calendar; whether he weighed it is
R-20, and on no row.

**Which rule broke.** \`followed_rules\` is one boolean covering every rule but R-01,
R-02, R-04 and R-19. It records that something broke, not what — and on his own
account (§9) it is mostly answering *did I wait?*

**Whether an entry was an override.** A setup correctly identified as bad and taken
anyway files identically to a good one. §9's first leg has no signature.

### Three verdicts

\`pass\` · \`fail\` · \`unknown\`. The third is not a formality. It mirrors the journal's
own three-state boolean, where \`null\` means unanswered and is not the same as \`no\`.

The same rule one layer up: a \`judgment\` rule with no answer is \`unknown\`, a
\`journal\` rule whose population came back empty is \`unknown\`, and a rule whose
population was narrowed by a missing column is \`unknown\` outside the narrowed set
rather than \`pass\` across the whole of it.

### Population filters

Applied to every query, not remembered case by case.

| Filter | Why |
|---|---|
| \`id like 'PID%'\` | Pre-sync rows carry client ids and null timestamps. Any hunt for broker-data problems sweeps them up as false positives. |
| \`deleted = false\` | Soft-deleted rows stay in the table so the poller cannot resurrect them. |
| \`pnl is not null\` | An open position is in neither the win nor the loss side. A missing figure is not a break-even. |
| both prices present | The scratch band is a distance in price. A row without both falls back to the same $3 read against P&L. |
| \`entry_time is not null\` | Anything reading \`session\` — see the seam below. |
| \`size_oz is not null\` | Anything deriving account, lots or a percentage. |
| \`net_pnl is not null\` | Monthly and multi-day P&L — see below. |

### The session seam

\`session\` derives from \`entry_time\`, falling back to \`fill_time\` when there is none.
So a fill the poller never reached is filed by when it **closed** rather than when it
opened, and those rows land in a later bucket than they belong to, systematically.

The repair is \`?force=1&hours=N\` with a wide lookback; the signature of a sliced row
is \`exit_price is null\` on a closed trade. Repair, then read — do not exclude the
rows and call the result clean.

**And the Asian session straddles the calendar date** (§4), which is a different
boundary from this one and is not a defect. A trade opened at 1 a.m. New York time
is in the Asian session that opened the previous evening, and files under the current
\`open_day\`. Both are true; do not "correct" either.

### \`pnl\` is a fallback, and reading it is not the same as choosing it

\`pnl\` is generated: \`coalesce(net_pnl, computed_pnl)\`. So reading \`pnl\` **is**
reading \`computed_pnl\` on every row whose broker email has not landed — the one case
this account cannot afford, because \`computed_pnl\` is folded from deals and carries
no swap, and positions here cross the 17:00 rollover.

**And a row with no email is almost always a hand close.** cTrader alerts only when
a stop or target fills, so a position he closed himself never gets a settled
figure: \`net_pnl\` stays null for good and \`pnl\` is the folded one. That is also
R-18's evidence (§7).

**R-15 does not change this.** Nothing is held over a weekend, but weekday rollovers
still apply and Wednesday's triple swap is the expensive one.

Any figure summed across days either requires \`net_pnl is not null\`, or reports how
many rows fell back to \`computed_pnl\` alongside the total.

### Break-even means R-04 fired

The ±$3 scratch band is a price distance, so a stop moved to entry lands inside it by
construction. Break-evens here are mostly R-04 working, which makes the break-even
count meaningful: roughly, how often a move went most of the way and turned.

**R-19 muddies that, and the muddying is worth stating rather than glossing.** A
pre-print stop to break-even fires at whatever profit the trade is sitting on — $8,
$12 — so it lands in the same band without the move having gone most of the way. The
count is no longer a clean read of near-misses.

**It is separable in the common case.** R-19 only applies to a position inherited
from an earlier session, so **a sub-$20 break-even on a trade opened in the same
session is not R-19 and is a question.** One opened hours earlier, with a scheduled
print in between, probably is.

**A break-even close is never evidence of a violated stop.** The markers ask whether
the stop was *respected*, not whether it was moved, and moving to break-even at +$20
is the rule.

### Reconciliation is one-way

Where a \`journal\` rule and its marker disagree, Eugenia names the gap and stops. She
does not correct a marker, infer what was meant, or fill an \`unknown\`.

That disagreement is the most valuable signal the system produces. Neither the
self-report nor the derived value says anything on its own.

**Its one scheduled moment is hers.** He does not review his own week — he knows
how it went and has usually identified a bad stretch while it was happening (§9).
Her Saturday review is where the week is read whole: the rules a row can check,
and his own answers beside them. Outside it, **things are examined
when he raises them**, and nothing here is deferred to it.

### Sample, and why it is smaller than it looks

No claim from a single trade. Per-trade conversations are for processing.

**He is working toward about four trades a week** (§5), so this is not the
arithmetic of a day-trading journal. A month is a handful of trades. A rate over
anything less than a long stretch is noise, and saying so is more useful than
qualifying a number nobody should be reading.

**Session is a reporting dimension, not a comparison.** There is no session rule, so
a per-session rate tests nothing — and Asian and London are thin because of when he
sleeps rather than because of anything he decided (§4). Report a bucket if he asks.
**Never rank the five, at any sample size:** one of five is highest by chance even
when all five are identical.

**Direction is one of the few splits the data can actually make**, since
\`direction\` is on every row. **He trades both ways, with no preference between
them.** A long/short skew in the data is a fact about a small sample, never a
preference or a decision, and at about four trades a week the split means very
little for a long time yet.

**The break-even win rate is 40%** — the line any win rate is read against. It falls
out of the geometry: a $30 target against a $20 stop needs 20/(20+30), and 44.4% on
a $25 target. Not a threshold he has to clear on a given stretch; it is what the
number means.

### Monthly P&L

Sum of \`net_pnl\` over the month's filing days, divided by \`size_oz × 500\`.

**One size per month, by rule.** R-13 pins rung changes to month boundaries, so there
is one account figure and nothing to choose between. A month showing two sizes is
R-13 broken rather than a question about which to use.

Never a balance delta: transfers move \`balance\` with no trade behind them.

**+10% is the target and reaching it ends nothing** (§5).`,

  "9": `## 9 · How he fails

What happens when the process does not hold, in his own account, recorded at v1.9
and corrected twice since. It is here because every rule in §7 that his failures
touch is \`judgment\`, so the table cannot see any of this and would read a bad month
as a column of unknowns.

### One failure, one shape

**Not fear.** In his words, not so much fear — fear breaks a trader out of good
positions early, and that is not the pattern.

**Not greed as a separate behaviour.** He named greed alongside FOMO and then
corrected it: he does not hold past the target and does not increase size. The
wanting is real but it does not show up as its own action. **Do not go looking for a
greed signature in the data. There is none, and finding nothing would not tell you
that.**

**And not chasing a move that left without him.** The level is not behind him.

What is left is specific: **price reaches a level he is already watching, and he
enters on the touch.** Without letting the level react, without giving it room to
breathe, without waiting for the close or the read. He enters early because he wants
the win.

So in the vocabulary of §12, he takes the **signal** as the entry. That is R-07
exactly, and it is why the probe is worded as *did you wait*.

### What that means structurally

**Steps 1 and 2 are clean.** The bias is read and the level is right, which is why
R-05 and R-06 are not where this shows up. **Step 3 is where it breaks** — signal
without confirmation — and step 4 inherits nothing, because an entry at the level
keeps the geometry intact: normal stop distance, fine R:R.

That rules out the tempting story. No wide-stop signature, no compressed R:R, no
entry far from a level. **A FOMO entry and a patient entry at the same level, same
direction, same size, produce **identical price data** — entry, stop, target, R:R,
session, all of it.

**What is not identical is \`followed_rules\`.** He marks these false, and he can,
because he knows at the time. So the marker is the signature, and it is the only
one. That is the opposite of a reason to stop looking: it is the reason an
unanswered journal costs more here than anywhere else in the system — it is not a
gap in the data, it is the loss of the single distinguishing field.**

His failure profile is unusually narrow. Sizing, exits, management, the day limits,
the position rule — none of them is where this goes wrong. One step, one rule.

### Where it bites hardest

**The same everywhere, and somewhat worse at the New York open** — because that is
where he expects quicker movement, and expecting speed is what makes waiting feel
expensive.

Which explains the self-report in §6 rather than leaving it as a personality note.
He is more careful at the New York open **because that is the session where this
weakness has the most pull.** One coherent thing: a violent session (§4), a
heightened expectation of speed, and a known impatience — so he compensates.

### He knows at the time

**Not a recognition problem.** He is not misreading the level and would not be helped
by more method. The rule is known, the violation is known while it is happening, and
it happens anyway.

**\`followed_rules = false\` is answerable honestly on these trades.** He knows in the
moment, so the mark is a live observation rather than something reconstructed after a
loss. That single boolean is the only instrument pointed at the thing that actually
costs him.

**And the useful question is never *what was the setup*.** It is what was happening
in the seconds before he clicked. The setup is on the row; that is not.

### Under drawdown it accelerates

**The failure never changes shape. What changes is frequency and motive.**

Normally he enters early because he wants the win. **In a bad stretch he enters early
more often, chasing the move to recover what he has lost.** Same action, different
pressure behind it — and it compounds, because each loss increases the pressure that
caused it.

**This is why R-17's trigger is behavioural rather than financial** (§5). A 5% loss
traded calmly is not a problem; a 5% loss with the frequency climbing is, because the
mechanism is still running and getting stronger. No drawdown number can see that.

**And it is why R-12 matters more than it looks.** Chasing requires repetition. One
entry a day removes repetition, so the cap is a drawdown control as much as a
patience rule.

### The one orientation underneath all of it

He named it describing what ends a break: **back to chasing setups and the plan, not
results.**

That is the whole of this section in six words. Entering on the touch is chasing the
result instead of the setup. Revenge trading is the same thing under pressure. There
is not a patience problem and a FOMO problem and a revenge problem — there is one
orientation that slips, and three places it shows up.

### The first leg has no signature at all

A trade correctly identified as bad and taken anyway files identically to a good one.
No column, no derived value and no rate will ever separate them. The only record is
his own answer, given at entry.

**So a clean compliance rate over a period with unanswered journals says nothing.**
It is not evidence of discipline; it is an absence of answers.

### What is being done about it

**R-12's one entry a day is the structural answer.** If impatience costs the whole
session rather than being followed by another attempt, the cap does work no amount of
resolve does.

**R-17 is the backstop** when it has already gone wrong.

**The probe moves before the click.** When he brings a plan, her one question
is his own — what he will wait for at the level — asked while the wait is still
ahead of him rather than after it went wrong.

**His current focus is finding his rhythm**, in his words, as of v1.24 — recorded
as a focus, not a rule, and not defined here beyond what he says of it. The wait
at the level is still R-07 and still the failure above. A change in how often he
takes the touch is the single most valuable thing the journal could show, and the
only way it will show is if the marker keeps being answered honestly.`,

  "10": `## 10 · What would have to change, and what he has decided

§7 labels six rules \`judgment\`. This section is what would lift each, and which
routes are open.

### The two closed routes

**Journalling the plan: tried and retired.** \`planned_stop\` and \`planned_target\`
existed from v1.4 to v1.8 and were dropped — columns, app fields, view. He journals a
trade, not a plan. That door is still shut: \`planned_sl\` and \`planned_tp\` are not
those columns returning, they are the broker's own record of a live position and he
types neither. The cost is in §8, smaller since the poller began taking that record
and still whole for every trade that closed before it.

**Widening what Gladys asks: declined.** Four rules would each become checkable with
one tap at journalling time. Recorded because the analysis is sound and a future
reader should see why the door was shut:

- **\`level\`** (\`extreme\` | \`interior\`) would settle **R-05 and R-06 together**.
- **\`confirmation\`** (\`close\` | \`read\` | \`neither\`) would settle **R-07** — the rule
  §9 identifies as his primary failure — and \`neither\` would be a self-reported
  violation, the strongest signal the system could carry.
- **R-04 did not fit the existing pattern.** Gladys fires at OPEN, when the trade has
  done nothing yet, so *did it reach +$20 before it turned* had no answer when the
  form is drawn.
- **A fifth question would have helped R-12** — whether a second entry was the sweep
  re-entry — now partly covered by the fifteen-minute window (§6).

**He decided against all of it at v1.9.** R-05 through R-07 are \`judgment\`
permanently. R-04 was too, on the reasoning that excursion is unrecoverable
afterwards — and that was wrong about the broker rather than about him: its minute
bars carry the path, so at v1.15 R-04 became \`journal\` with nothing asked of him
and nothing added to Gladys (§8, \`best_price\`).

### The rules that were never candidates

**R-17 watches something no column could hold.** Its trigger is the quality of his
trading rather than any number, and turning it into a field would mean inventing a
threshold he never set — the failure §5 names about the sizing rung.

**R-08 and R-20 likewise.** *Which step did you stop at* and *did you weigh the
print* are judgments, not fields — and R-20's is the number he chose to stop
setting.

### The route that stays open, and it is not a schema change

What lifts all of them in practice is the same thing: **the answer given at entry,
while the trade is fresh.** That is the whole remaining instrument, and §9 is why it
is worth protecting.

### The zone map stays where it is

R-05 and R-06 are precise rules about position in a marked structure, and that
structure lives in TradingView. Mirroring it here was considered and rejected: a map
kept in two places disagrees with itself, and a stale boundary produces false
violations that teach him to ignore real ones. A decision, not a gap.`,

  "12": `## 12 · Definitions

Terms used as if precise. Where the app already defines one, this is that definition
and not a second version of it. **§3 builds the macro terms** — this section is the
trading vocabulary.

**Break-even (scratch).** An exit within ±$3 of the entry price, at any size.
Measured in price rather than dollars because $3 of P&L is $3 of gold at 0.01 lots
and three cents of it at 1.00 — a dollar band would mean something different at every
rung. Win and loss still come from the sign of the P&L.

**Break-even win rate.** **40%.** The rate at which the geometry breaks even: a $30
target against a $20 stop needs 20/(20+30), and 44.4% on a $25 target. The line any
win rate is read against.

**Decided.** A trade carrying a P&L. Break-evens are decided and sit in the win-rate
denominator, so scratches drag the rate down rather than vanishing. An open position
is not decided.

**Complete.** A setup and all three discipline answers present. P&L deliberately not
required — an open position can be journalled before it closes.

**Filing day.** \`open_day\` where the poller supplied one, otherwise the New York
civil day of the closing fill. The day a trade is counted under, rolling at midnight
New York — which is why an Asian-session trade taken at 1 a.m. files under that date
even though its session opened the evening before.

**Session.** One of five buckets — Asian, Asia+London, London, London+NY, New York —
derived from \`entry_time\` against each financial centre's own local hours. Nothing is
stored and there is no override. **There is no session rule** (§6); the buckets are a
reporting dimension. Sessions do have characters he reads (§4), which is not the same
as a constraint.

**Size.** \`size_oz\`, in ounces, as the position was opened. Lots are ounces ÷ 100.
Poller-written only.

**Stop.** A ceiling of $20 of price distance from the fill price on the chart, not a
value, with no allowance for spread. Set at entry from where the chart shows the idea
to be wrong, so usually tighter. **A resting broker order** (R-18). Moved only to
break-even (R-04), or tightened under R-19 when a print lands on a position inherited
from an earlier session — never wider, and never tightened outside that case.

**Full stop.** A loss closed at the stop at its $20 ceiling — $20 or more of price
distance from entry. A stop set tighter and taken is a loss, not a full stop, and
R-03 does not fire on it; R-11 is what bounds a day of those.

**Grid.** The $25 increments. **Psychological levels** are 00 and 50; **quarters** are
the 25 and 75 between them. One grid at two strengths, marked on the 1H and 30m.

**Reaction point.** A place price has actually turned — a previous high or low. The
second source of levels alongside the grid, and what makes an extreme worth fading.
**Confluence** is where the two agree, and a level with both is stronger than either
alone.

**Extreme.** The outer boundary of the marked range. Few, thick, and where Support &
Resistance is traded.

**Interior level.** Any level inside the range — marked by the quarter grid, by a
previous price reaction, or by both. Position is what makes it interior; the grid is
one of the two ways it gets marked, not the definition. Where Break & Retest is
traded.

**Signal.** Price reaches a level and rejects. Not an entry on its own.

**Confirmation.** Either a candle closing in the intended direction (*close*), or the
reaction around the level resolving clearly enough to enter before a close (*read*).
Both valid. Entering on the signal with neither is not — and per §9 it is his most
common failure.

**Sweep.** A wick through a level that closes back inside: the stops beyond it were
taken and price refused anyway. The level held. Distinguished from a close beyond the
level, which is the level failing.

**Sweep re-entry.** Re-entering the same level in the same direction after a sweep
took a stop tighter than $20 and price came back **within about three 5-minute
candles**. Permitted once per day, never after a full stop. Past fifteen minutes it
is a new idea; inside it, indistinguishable in the data from a revenge trade.

**High-impact release** — top priority, in his words. A scheduled economic print or
decision capable of moving gold sharply — NFP, CPI, PCE, FOMC. **For R-19 and R-20,
a US release TradingView rates high**, which is his definition. §3 covers what
each is. R-20 has him trade around one with caution rather than stand aside; R-19
covers one landing on a position inherited from an earlier session.

**Low-volume day.** A US market or bank holiday, or the Christmas-to-New-Year stretch.
Calendar-known rather than judged at the screen (R-16).

**Rung.** A step on the sizing ladder. \`account = lots × 50,000\`, continuous — 0.02
lots per $1,000 at every size. Moves only between months (R-13): up by deposit, down
by his judgment when the capital behind it has shrunk.

**Implied account.** \`size_oz × 500\` — the capital the ladder was applied to,
including what is held off-broker. Distinct from \`balance\`, the deployed portion. The
rung is measured against this.

**R:R.** **At entry it is a condition: at least 1:1.5**, step 4 of §6's sequence. The
default $30 target satisfies it at any permitted stop, so it binds in exactly one
place — a $25 target set at entry, which needs a stop of $16.67 or tighter.

**A realised 1:1.25 is legitimate as an outcome and illegitimate as a plan.** The rule
working when a $30 target was shortened on a trade already open; a breach when $25 was
set at entry over a $20 stop. On a row without the plan nothing separates them, so it
is \`unknown\`; on one carrying \`planned_tp\` the target as first seen does (§8).

In the app, realised R:R is a different number entirely: average win ÷ average loss
over closed P&L. It cannot be read as the plan.`,

  "13": `## 13 · Changelog

The write path. Findings, retired rules and rule changes are recorded here, and the
§7 table read afterwards is whatever this section last left in place. Rule IDs are
never reused — a recycled ID silently falsifies history.

Rows below v1.11 are history and describe the document as it stood. Where one states
something later corrected — v1.7's "five steps", v1.3's account of the $25 target —
it stays as written, because correcting the record would falsify it.

| Version | Change | From lesson |
|---|---|---|
| v1.29 | **R-02's cap read where the stop was set.** The cap was checked on the exit of a loss alone, so a stop set past $20 that won its target passed: on 27 October a $22 stop, first seen by the poller, took its $30. R-02 now also fails a closed trade, win or loss, whose recorded stop sat more than $20 from entry. No rule's wording changed — §5 already called a $22 stop non-compliant — only what the check can see. | Eugenia's morning verdict of 28 October, and his go-ahead |
| v1.28 | **R-02's respect half made checkable.** §7 kept it open because an exit past the stop is a widened stop or slippage and the row cannot tell which; \`trade_stops\` can, and since v1.19 had been read for R-19 alone. R-02 now also fails a closed trade, win or loss, whose recorded stop moved away from entry — each sighting held against the last stop that rested — and passes an exit past a stop that never moved as slippage. A stop pulled and never put back is \`unknown\`. It reaches only the trades the poller recorded, so a clean run is never stops respected on the rest. | Eugenia's suggestion, after an $8 stop closed $18 out, and his go-ahead |
| v1.27 | **The two flows are handed to her.** The central banks' gold reserves — China, Poland, India, Turkey, the Czech Republic — in tonnes, and GLD's and IAU's assets and money in or out, read from TradingView and handed to the Sunday briefing and a conversation. Each channel's *Where to read it* says so, and the central banks' gives the year to June 2026 as it read on 15 October. Reference material only; no rule changed. | A probe of what TradingView serves |
| v1.26 | **A sixth channel: what investors are buying.** Gold funds and futures funds — the flow that turns fastest, where haven buying arrives, and where the rates channel actually lands, on the investors who care what a bond pays. Their holdings fell through 2022 and 2023 while central banks held the price up, and turned back to buying as the rally ran. The CFTC's weekly count is handed to her; the funds' holdings are read off the World Gold Council's and SPDR's pages, dated and sourced. A new rung on her map, starting \`unseen\`. Reference material only; no rule changed. | The 2022–2025 market, which five channels could not tell |
| v1.25 | **§2 says the real-yield link broke in 2022.** The first channel was called dominant on a −0.82 correlation measured before 2022; since then real yields rose to fifteen-year highs and gold rose to records, carried by central-bank buying the yield does not price. The channel now says so, with the figures dated, and that the referee test — gold moving with real yields or against them — decides which channel is in control on the day. §3's part 7 says the comparison is the mechanism and not the whole price. Reference material only; no rule changed. | Reading her framework against the market since 2022 |
| v1.24 | **A sweep re-entry follows only a stop tighter than $20.** A full stop is $20 on a linear ladder, so it is the day's 4% at every rung, and R-11 had already ended the day R-03's one exception was meant to continue — a re-entry after a full stop could only ever breach R-11. R-03 now allows no entry after a full stop, and §5's claim that a full stop at a small rung spends well under the limit is corrected. **Coming down a rung is his judgment**: "the implied account has halved" could not be measured, since \`size_oz × 500\` moves only with the size, so the rule names no number and she does not raise it. The summary says the stop is never widened and tightened only under R-19, where it said never tightened. §2's figures are marked as dated. R-19 stays narrow, by his decision. **R-17's bad stretch is crazy trading, not losing with proper entries.** **What he says of himself, brought up to date**: about four trades a week where it was two or three; no preference between long and short; his current focus is finding his rhythm. The changelog's *Effective from* column goes — never filled, it was twenty-five \`[decide]\` markers for something nothing reads. | A point-by-point review with him |
| v1.23 | **R-14 retired, and R-20 in its place: he trades at any hour, cautious around a top-priority release** — a US release TradingView rates high — rather than out of the market. The thirty minutes before one and the stand-aside until the news had confirmed something both go. Caution has no number, so R-20 is \`judgment\` and \`check_rules\` evaluates twelve rules. R-19 is unchanged and now reads as the print he did not take on at entry; a position opened in the session the print lands in is R-20's. §5 says why a holiday still stands him aside and a release does not. R-14's ID is not reused. **And she stops messaging him about prints on an open**: the warning that fired when he opened a trade with a high-rated print ahead goes with the rule — it was the unnecessary message the change was for. **The document also stops pretending she has no view.** She gives a read, files calls and judges a plan he brings, so §0 draws the line — her view sits beside his rules and is measured against them, never written into them — and gives the loop its inbound edge: a case the record makes is put to him as her proposal. §2's chain may end in her read, labelled, tested by a link, with no level; her read is not his step-1 bias. §6 and §7 record that she runs R-08 with him before the fact and that her judgment of a setup is never a \`pass\`. §8's *no scheduled moment* is corrected: her Saturday review reads the week whole. §9 moves his probe before the click. | His decision, and Eugenia's view widening |
| v1.22 | **Corrections, no rule changed.** Statements written before the poller began recording the stop and target as first seen still said no row could carry the plan: §6's step 4 and its $25 pairing, §6's *Recording*, R-02's note in §7 and §12's R:R now say the plan is on the rows since, and only there. \`open_day\` rolls at midnight New York, not at 17:00, in §4 and §12. §8's list of what \`followed_rules\` covers named fewer rules than the table maps to it. | Reading the document against the system |
| v1.21 | **R-16 reads bank holidays as well as market ones**, as its rule always said. The check had stopped at the exchanges' list, so Columbus Day and Veterans Day — the two days the banks close and the market trades — passed an entry the rule forbids. Veterans Day follows the Fed's observance: a Sunday moves to the Monday, a Saturday is not moved. **R-12 fails a second entry taken while the first was still open**, which had read as \`unknown\` because a negative gap counted as "within fifteen minutes". A sweep re-entry follows the first trade closing; one taken before it is a second position, and he trades one entry at a time. | His decisions, when the two gaps between the rules and their checks were put to him |
| v1.20 | **High impact is a US release TradingView rates high**, for R-14 and R-19 alike — one calendar for the briefing, the warnings and the rules, where two had been read. TradingView's ratings differ from Forex Factory's folders in places (it rates average hourly earnings and jobless claims medium, and a summit high), so a past verdict can move; a calendar marker with no release time is not a release and counts for neither rule. Its data goes back to 2003, so the weeks already traded are fetched once and R-14 stops reading them as unfetched. | His decision, to stop reading the same calendar from two services |
| v1.19 | **R-19 made checkable.** \`trade_stops\` records every stop and target the poller sees a position carry, one row per change, where the row keeps the first and the broker only the last; with Forex Factory's calendar saying a print was pending, R-19 moves to \`journal\`. Judged at the first USD red folder landing on a position opened in an earlier session: break-even or better passes, an untouched or wider stop fails, a moved target fails, a stop tightened short of break-even is \`unknown\` — right if the trade was losing, wrong if winning, and no row holds which. | His go-ahead, after asking which rules still had holes |
| v1.18 | **R-09 retired** — *only operate in obvious trends and cycles*. A line from a book he read while learning, never one he traded by, so it goes rather than being made checkable; its ID is not reused. §4's bias chart and §4.2's failure mode no longer lean on it. | His decision |
| v1.17 | **R-14 made checkable on the floor he set.** High impact is **the red folder on Forex Factory, USD only**, and **no entry in the thirty minutes before one**; the rest of the stand-aside stays open-ended and his. R-14 moves to \`journal\`: an entry inside the thirty minutes fails, one with a red folder later that day but further off is \`unknown\`, one with none ahead passes. The calendar is Forex Factory's own export, fetched nightly and kept, so the rule sees nothing before the first fetch and reads a missed week as \`unknown\` rather than quiet. Nothing after the print is checked — he set no number for it. | His definitions, asked for while making R-14 checkable |
| v1.16 | **R-18 made checkable, from a fact about the broker he confirmed.** cTrader sends an alert when a stop or target fills and none for a position closed by hand, so a closed trade with no alert — \`net_pnl\` null — was closed by hand. R-18 moves to \`journal\`: that is a fail, except at the Friday close, which is R-15 and permitted; a close under an hour old is \`unknown\` while its alert may still arrive. §8 records what a missing \`net_pnl\` means, and that a Friday hand close is now R-15 firing rather than a guess. | Eight closes with no alert, looked up in Gmail with him |
| v1.15 | **R-04 made checkable from the broker, not from him.** §7, §8 and §10 called it uncheckable for good because how far a trade ran was "stored nowhere, including at the broker"; the broker's minute bars go back a year, so \`best_price\` now records the furthest each trade ran in his favour, and R-04 moves to \`journal\` — a loss beyond the scratch band on a trade that had been $20 in his favour is a stop that was not moved. Nothing asked of him, nothing added to Gladys; the v1.9 decision against widening the journal stands for R-05 to R-07. | Eugenia's own review of which rules she could not see |
| v1.14 | **A full stop is the stop hit at $20 from entry**, in his words. §12 had also counted a stop set tighter and taken in full, which no row can tell from a hand-cut exit — so R-03's population was missing and the rule was \`field\`. With the definition his, R-03 moves to \`journal\` and its predicate reads a loss of $20 or more; §5's example of a full stop on a $12 stop is gone with it. | His definition, asked while making R-03 checkable |
| v1.13 | **Three gaps closed, found by asking what the document never asked.** R-18: **stop and target are always resting broker orders and a position is never closed by hand** — which makes R-01 and R-02 exact rather than suggestive, since a loss beyond $20 is now an edited order rather than a decision at the screen, and R-15's Friday close-out is named as the one permitted manual close. R-19: **a high-impact print landing on a position inherited from an earlier session** — in profit the stop goes to break-even regardless of R-04's threshold, losing it is tightened to a closer invalidation or pulled in if there is none, and the target never moves. Written narrowly on his instruction: he should not be holding through a print, and the path that produces this is an Asian-session trade still running into New York. §5's "never moved tighter" now carries that exception, and §8 records that R-19 muddies "break-even means R-04 fired" — a sub-$20 break-even on a trade opened in the same session is not R-19 and is a question. **Direction recorded: he trades both ways**, with a noticed preference for shorting held as a preference and explicitly not a rule, since \`direction\` is on every row and a skew would otherwise read as confirmation of a decision. | Asking what the document had never asked |
| v1.12 | **Verification pass rather than new rules.** Eighteen inherited claims — carried since before the audit and never confirmed by him — read back and confirmed, one corrected: **an interior level is any level inside the range, marked by the quarter grid OR by a previous price reaction**, so R-05, §4.1 and §12 no longer reduce interior levels to quarters and a previous high mid-range is tradeable for Break & Retest. §13's history confirmed as record rather than reconstruction. **§9's "identical rows" corrected** — the *price data* is identical, but \`followed_rules\` is not, and since he marks it honestly the marker is the signature and the only one. **§3 proofread**: the opening definition no longer contradicts cost-push, the room-to-cut argument now follows from nominal = real + expected inflation rather than asserting the Fed would have none, the 2.5% breakeven line is reconciled against the CPI/PCE gap, and the dot plot distinguishes participants from voters. **§3 given a term index** so a single lookup is not a scan of thirty thousand characters, plus retail sales, Michigan inflation expectations, the ISM/S&P PMI split, and the FRED codes for every rates series. | Verification of what was already written |
| v1.11 | **Four rules added, all from gaps an audit surfaced rather than from new behaviour.** R-14: no entries in the hours before a high-impact release, resuming once the volatility has passed and the news has confirmed something — the first rule connecting the briefing to the trading, and judgment because the window is open-ended by his description. R-15: nothing held across the Friday close, closed at market right before it, because a weekend gap can open past the stop — which forces a narrow R-01 exception for wins under $25 filling at that close. R-16: no trading on known low-volume days. R-17: **he stops trading when the trading has deteriorated — rules broken, losses running, chasing — and the trigger is behaviour, never drawdown.** He has stopped at a 5% loss; a threshold would fire on the wrong variable. **§3 written — the foundation**, built bottom-up from what inflation is through the funds rate, the transmission chain, bonds and yields, TIPS and breakevens, to why gold sits at the end of it, plus every metric a briefing uses. Written because he said the technical content lands as terms he nods past and he wants it from the inside out. **§0 records that the document teaches at more than one level**, against \`eugenia_channels\` states, with demotions from him never argued with. **§2 deepened** and pointed down to §3. **Sweep re-entry bounded at three 5-minute candles**, which makes half of R-12 checkable. **Session characters recorded** — New York violent, Asia calmer — as an input to the read, with London thin because of when he sleeps rather than by preference, and the Asian session's straddle of the calendar date written into §4, §8 and §12. **Slippage \`[decide]\` closed**: the stop is $20 from the chart fill with no spread allowance, so slippage is his. **The weekly review dropped** — he has never done one, and §8 no longer defers to it. **§9 corrected twice**: the NY-open caution now has its reason, and revenge trading is recorded as the same failure accelerating rather than a second failure. | A provenance and coverage audit, worked through question by question |
| v1.10 | R-12 caps entries at one a day (two when the second is a sweep re-entry); R-13 pins rung changes to month boundaries. **The sweep re-entry bounded at once** and stated as the one exception to R-03 — the two had contradicted each other since v1.5. Timeframes recorded: bias on daily/4H/1H, levels on 1H/30m, entry on 15m/5m. How a level is marked: the grid plus reaction points, with confluence. **B&R trades continuation, S&R trades the reversal** — counter-trend is the point, closing the fade-against-bias question. Coming down a rung written. §2 rewritten from research and marked as not his decisions. §9 corrected: greed is not a separate failure. Session floor removed; 40% kept in §12. | A full read of the document with him |
| v1.9 | **The stop is a ceiling, not a value** — under $20, set at entry from the chart's invalidation, never tightened. R-02 restated as a cap check with a stated blind spot. **The $25 target is two things**: an entry choice needing a stop under $16.67, and a management shortening. **R-08 folded from five steps to four.** Quarters defined. No session rule, stated. R-10 and R-11 given IDs. §5's "the day ends at 4%, which is one full stop" corrected: two rules. Sections 2, 9 and 10 written. §0 de-duplicated and given a section index. | His answers |
| v1.8 | \`planned_stop\` and \`planned_target\` retired: columns dropped, fields removed from the app. **He journals a trade, not a plan.** R-03 returns to \`field\` and the narrowed full-stop population; §8 and §12 restated — no row carries intent. | His decision |
| v1.7 | R-08's five steps written: top-down bias, liquidity pools and S&R, psychological levels, candle or chart pattern with signal then confirmation, and reward-to-risk of at least 1:1.5. Step 5 is arithmetic and checkable from the planned columns. Settles a contradiction the document was carrying — 1:1.5 at ENTRY, 1:1.25 the realised floor after a permitted shortening. | His rules |
| v1.6 | §4 written. The two setups differ by METHOD, not location. Invalidation stated per setup, and §6's re-entry rule shown to follow from S&R's. | Method research, anchored to his stated rules |
| v1.5 | §5 and §6 written. 4% per trade; the rung moves by hand; 4% is also the daily limit and there is no weekly or monthly one. One position at a time. Entry at market, exits price-based only, journalled at entry. Re-entry allowed after a liquidity sweep. R-08's sequence recorded as existing but not written down. | His answers |
| v1.4 | \`planned_stop\` and \`planned_target\` recorded at journalling time. R-03 moves from \`field\` to \`journal\`. §8 and §12 restated: intent is on the row. | Schema change |
| v1.3 | The target may be shortened from $30 to $25 where the level looks hard to reach. R-01 gains its lower bound. The R:R floor restated as 1:1.25. | His decision |
| v1.2 | Tolerance settled at none. \`TOL\` retired from §0 and §12. Recorded that R-01 is not R-02's mirror. | His decision |
| v1.1 | \`TOL\` named and R-01/R-02 given executable predicates. R-03 relabelled \`field\`. §8 records \`size_oz\` and the \`pnl\` fallback. | Review of v1.0 against the live schema |
| v1.0 | Initial document. R-01 through R-09. | — |`,

};
