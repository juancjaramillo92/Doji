# Eugenia — what the best systems do that she does not

Research, 12 October 2026. Nothing here is implemented. The six parts are the
ones the brief asked for, in its order, and the last section says what was read
in code, what was read only as a vendor or a search summary stated it, and what
the network refused.

**How to read the verdicts.** ADOPT is taken as it is done elsewhere. ADAPT is
taken in a shape her rules allow, and says how. DEFER carries a *Revisit if*.
REFUSE carries its reasoning in `REFACTOR.md`'s register. Everything that would
cross a line `CLAUDE.md` calls the product is in §5, not in the ranking.

---

## 1 · What she does today

Every entry is something read in this session, cited by file and line.

### Memory

| Capability | Where |
|---|---|
| The conversation window: the newest twelve turns, opened on a user turn, each past user turn stamped with its New York day | `index.ts:1726` (`HISTORY`), `:1728` `openOnUser`, `:1733` `recent`, `:2035` `dateTurns` |
| What is stored is the raw turn and the gate's output, never the augmented prompt or the draft | `index.ts:1772` `remember`; `:3089`; `README.md:1502` |
| Notes in three kinds — `fact`, `instruction`, `commitment` — each its own window of twenty, one row past it read so an overflow says so | `index.ts:173`, `:440` `NOTES`, `:457` `readNotes`, `:2045` `notesBlock`; `schema.sql:362` |
| Retirement by `supersedes` (a list, so a merge retires several), filtered on `superseded_by is null`; append-only, no delete path | `index.ts:203`, `:485` `writeNote`; `schema.sql:383` |
| What is never a note: an order to herself, a failed tool, a failed approach written up as working | `index.ts:176` (`NOTES_TOOL` description) |
| Commitments held against his trades, retired by the nightly pass with how they went | `prompt.ts:715`, `:1029` |
| The portrait — one paragraph of what notes, trades and his record against his word add up to, rewritten only at night, never on the trade look | `index.ts:1150` `PORTRAIT_MAX`, `:1172` `setPortrait`, `:2279` `portraitBlock`; `prompt.ts:739`, `:1068`; `schema.sql:586` |
| The running thesis, one row, dated, moved rather than replaced, nightly only | `index.ts:1101`, `:1122` `setThesis`, `:2253`; `prompt.ts:558`, `:1053`; `schema.sql:562` |
| Open threads (`watch`, `question`), the newest ten handed back, closed only at night; an unanswered question closes after a week | `index.ts:1198`, `:1243`, `:1260`, `:2399`; `prompt.ts:568`, `:1096`; `schema.sql:639` |
| The channel ladder — five rows, four rungs, `moved_on` dated, moved only at night or by his `/channel` | `prompt.ts:26`, `:36`, `:44` `PITCH`, `:627`; `index.ts:229`, `:549` `setChannel`, `:2124` `parseChannel`, `:2156` `channelsList`; `schema.sql:410` |
| Search past the windows: full text and trigram, plus two vector arms, fused by reciprocal rank; who said it rides in `source` | `index.ts:300` `SEARCH_TOOL`, `:337` `searchList`, `:369` (pinned model), `:413` `searchMemory`; `schema.sql:803` `eugenia_search` |
| The nightly pass at 22:00, retried at 23:00: notes, merges past fifteen, commitments, thesis, portrait, filing reads, closing loops, rungs; then the channel census, the embedding sweep and the week's calendar | `index.ts:85`, `:92`, `:3223` `postConsolidation`, `:3286`; `prompt.ts:1005` `CONSOLIDATE` |
| `/notes` — the whole memory rendered for him from the database, in his second person | `index.ts:2079` `notesList` |

### Market perception

| Capability | Where |
|---|---|
| The live broker quote with its session window named, handed to the briefing, `get_market` elsewhere; never a price off a page | `index.ts:981`, `:1026`, `:1048` `quoteWindow`, `:1062` `quoteLine`, `:1091`; `prompt.ts:329`–`359` |
| The market around gold off TradingView's hourly bars — DXY, 2y, 10y, real yield, silver, oil, S&P, VIX, four European 10-years, Japan's, the euro — each a level now beside a stated earlier level | `index.ts:1000` `AROUND_TOOL`, `:2544` `aroundList`; `prompt.ts:361` |
| Fed funds futures folded the way FedWatch folds them; the next meeting as odds, later ones as basis points | `index.ts:2582` `ratesList`; `prompt.ts:175` `LATER_MEETINGS`, `:375` |
| Six hours of gold and dollar headlines, titles only | `index.ts:2621` |
| CFTC managed-money positioning with its year's range; COMEX front-month volume against twenty sessions | `index.ts:2685`, `:2738`; `prompt.ts:385`, `:396` |
| The calendar filed quarter-hourly from TradingView by id, US medium and up, chosen events abroad, `due`/`LANDED`/`PAST`; the Sunday week | `index.ts:784`, `:833` `wanted`, `:890` `fileCalendar`, `:2463` `calendarList`, `:2513` `weekBlock`; `schema.sql:492` |
| Web search (12) and web fetch (6, page size bounded), server-side with their container | `index.ts:1376`–`1380`; `README.md:2416` |
| Charts and voice notes as inputs | `index.ts:3394`–`3471`; `prompt.ts:964`, `:983` |
| Every market read bounded at 45s, a failed read filed as a row and said as a sentence | `index.ts:792`, `:1687` `unread` |

### Reasoning and quality control

| Capability | Where |
|---|---|
| `CRITIC` on the briefing, Opus at `medium`, no tools, handed notes, channel map, desk and story | `prompt.ts:1160`; `index.ts:2994` |
| `TRIM` on every reply, Sonnet, no tools, handed desk and story | `prompt.ts:1314`; `index.ts:3008`, `:1429` `MODELS` |
| One `gate`: a revision past `keepDraft` is overruled, a throw sends the draft, every outcome is a row | `index.ts:2989`, `:3017` |
| Both gates check direction against the story and percentages on later meetings | `prompt.ts:160` `AGAINST_THE_STORY`, `:175` |
| One `WRITING` read by writer and both gates, with worked examples, the countable rules counted last | `prompt.ts:56`, `:1267`, `:1349` |
| Adaptive thinking, effort per caller (`high` briefing and pass, `medium` reply and gates), `fallbacks: "default"` on Opus | `index.ts:1469`–`1474`, `:3078`, `:3249`, `:3544`, `:3021` |
| The system prompt cached, `1h` for `CHAT_TOOLS` and `5m` for the rest; the newest `tool_result` carries a moving breakpoint | `index.ts:1463`–`1465`, `:1633`–`1639` |
| `MAX_ROUNDS` 10, `TURN_MS` 300s, `WRITER_MS` 370s for the briefing's whole worker | `index.ts:1487`, `:1496`, `:3049` |
| The tool loop answers everything with a sentence, dispatches with `Promise.all`, refuses a tool outside the caller's set | `index.ts:1507` `serve`, `:1536` `ask`, `:1626` |

### Coaching

| Capability | Where |
|---|---|
| Thirteen of his eighteen rules evaluated in code over §8's population, three verdicts, counts and ids | `adherence.ts:1`–`64`; `index.ts:674` `CHECK_TOOL`, `:699` `readRules`; `prompt.ts:787` |
| The journal's own arithmetic ported for `get_stats` — win rate, money, averages, realised R:R, by session and setup | `journal.ts:178` `journalStats`, `:205` `statsList`; `index.ts:734` |
| Breaches since the last briefing computed and handed to the briefing | `index.ts:2204`, `:2210`, `:2220` |
| Judge the decision, never the result; the verdict not optional; one lesson; blunt once | `prompt.ts:813`, `:840`–`862` |
| A plan he has not taken checked against his own numbers; the levels stay his | `prompt.ts:944`–`962` |
| What he has on — open positions, the plan as first seen, the day against R-11 — and what she may not do with it | `index.ts:2777`, `:2790`, `:2833` `isOpen`; `prompt.ts:912`–`942` |
| The trade event: R-14/R-19 on an open into a pending print, R-11 on a close past −4%, decided from data before any model call | `index.ts:3310`, `:3322` `postTradeEvent`; `prompt.ts:1286` `TRADE_EVENT`; `schema.sql:699` |
| His strategy carried in the cached prefix, the rest fetchable by section, unwritable by her | `strategy.ts:44` `ALWAYS`, `:104` `SECTIONS`; `index.ts:260`, `:286` |
| Teaching: one chain per briefing, the rung decides register, the one chain never assumed | `prompt.ts:301`–`321`, `:550`, `:642`–`683` |

### Self-evaluation

| Capability | Where |
|---|---|
| Every read filed nightly with its stated test and a verdict — `held`, `wrong`, `untested` — never by where price went | `index.ts:1292`, `:1295` `RECORD_TOOL`, `:1321` `recordRead`; `prompt.ts:1084`; `schema.sql:611` |
| The record — a month of counts and the three newest misses — to the briefing, a reply and the pass, never the trade look; sets how firmly she holds a view | `index.ts:2294`–`2325`; `prompt.ts:257` |
| His two taps under a briefing, read at night as one signal, never a score | `index.ts:2962`, `:3207`, `:3484`; `prompt.ts:1142` |

### Delivery

| Capability | Where |
|---|---|
| Telegram, split at 4,096 on paragraph then line | `index.ts:119` `chunk` |
| Everything spoken through `sayAloud`, text as the fallback; the briefing spoken by a second worker | `index.ts:1936`, `:1971`, `:3097`, `:3143` |
| The charm: one request, framed PCM back, silence beats while she thinks, battery and volume headers | `index.ts:3712`–`3820`; `README.md:1731` |

### Operations

| Capability | Where |
|---|---|
| `eugenia_runs`: one row per model call with tokens, cache writes by TTL, searches, fetches, rounds, model and fallback, and the tool tally | `index.ts:1565`, `:1671`; `schema.sql:449` |
| Rows for a written and a delivered briefing, gate verdicts, the channel census, the embedding sweep, a missed market read, a job that died | `index.ts:3102`, `:3114`, `:3023`, `:3291`, `:3266`, `:1689`, `:2917` |
| Retries for the briefing and the pass, gated on markers; `?force=1`; the apology names the job | `index.ts:69`, `:98` `dueNow`, `:2852` `APOLOGY`, `:2944` |
| A journal that stopped being written is said first | `index.ts:2355` `healthLine` |

### What she does not have, from her own register

`REFACTOR.md` §1 names two blind spots that matter here. **"Whether a prompt
still behaves — a red-team set that does not exist"** and **"retrieval quality —
a golden set that does not exist."** R-19's *Revisit if* waits on the first.

---

## 2 · The gap table

One row per technique, grouped by where it came from. The *Eugenia* column says
what she does instead. *REFACTOR* names an entry that already decided it.

### Memory and user modelling

| Technique | Who, source (date) | Evidence | Eugenia instead | REFACTOR | Fit | Cost | What proves it | Verdict |
|---|---|---|---|---|---|---|---|---|
| Background review after a run of turns | Hermes `agent/background_review.py` (head of 12 Oct 2026) | Claimed; no measurement in repo | The nightly pass, `index.ts:3223` | R-28 | Already the nightly pass | — | — | **REFUSE**, R-28 stands; its condition is not shown met |
| Procedural skills written and patched by the agent, a curator that ages them to `stale` and `archived` | Hermes `skills.md`, `curator.md`; `/learn` (Jun 2026); `skills.auto_load` (v0.21.4, 21 Sep) | Claimed | Instruction notes, `prompt.ts:685` | R-29 deferred | Would be a second memory that changes behaviour | Medium | — | **DEFER**, R-29 stands |
| Recall before every reply | Hermes; Honcho prewarm (`honcho.md`) | Claimed | She searches when she decides, `prompt.ts:747` | R-30 deferred | — | An embedding and a search a reply | `detail` already counts `search_memory` | **DEFER**, R-30 stands, still unmeasured |
| Search with date bounds, newest/oldest sort, and a scroll around a hit | Hermes `sessions.md` §Session Search Tool; `session_search` bounds (v0.21.4) | Claimed | One query, twelve hits cut at 300 chars, no neighbours, `index.ts:324`–`345` | — | A hit "he said: yes" is useless without the turn before it | A tool and a REST read; or a signature change, which is a `drop` in `upgrade.sql` | A test driving the window around a planted id | **DEFER** — R-37 below |
| Memory writes staged for the user's approval | Hermes `memory.md` §`write_approval` | Claimed | He audits after the fact with `/notes` and corrects by telling her | — | Adds a step to the one channel he uses | New table, a command, a send | — | **DEFER** — R-38 |
| A diff of what the background pass changed, shown in chat | Hermes `memory.md` §`memory_notifications` | Claimed | `/notes` shows the current state, not what moved last night | — | A marker in `/notes` on notes written in the last day | Small | `notesList` test | **DEFER** — folded into R-38 |
| Every memory mutation ledgered with before and after, rollback by entry | Hermes `curator.md` §Audit ledger; Letta Code memory as a git repo (`letta-code`, `reflection-v2.md`) | Two independent systems converged on it | Notes keep their trail; **the thesis and the portrait are one row overwritten**, `schema.sql:562`, `:586` | — | A trigger copying the old row into a history table | SQL only | `test:db`: two updates leave two history rows | **ADOPT** — item 6 |
| Conclusions linked to their premises and source ids | Honcho `src/dreamer/specialists.py` (deduction/induction specialists) | Code verified; effect claimed | Portrait "seen more than once, counted with `check_rules` and `get_stats`", `prompt.ts:1075`–`1082`, with no link back | — | Ids in a free-text paragraph of 800 chars would crowd it | Medium | — | **DEFER** — R-39 |
| Peer card: identity only, `INSTRUCTION` only when explicit, behaviour kept out | Honcho `PEER_CARD_SYSTEM_SECTION` | Code verified | Three note kinds; instruction "in his words", `prompt.ts:685` | — | Already the shape | — | — | Already done |
| Bi-temporal facts (`valid_at`, `invalid_at`), contradiction only when both cannot be true | Graphiti `graphiti_core/edges.py:271`–`284`, `prompts/dedupe_edges.py` | Code verified | `superseded_by`; a commitment's period lives in its text | — | A structured `until` on commitments | Column, tool, nightly read | — | **DEFER** — R-40 |
| ADD / UPDATE / DELETE / NONE on each new fact | mem0 `mem0/configs/prompts.py:176` | Code verified | `remember` with `supersedes`, and "write almost nothing", `prompt.ts:1014` | — | Same model | — | — | Already done |
| Multi-pass dialectic on the user model each N turns | Honcho via Hermes `honcho.md` | Claimed | Portrait once a night | — | A model call per N replies | High | — | **REFUSE** — R-41 |
| Layered memory with decay | FinMem README (2024) | Backtest only | "A note that is merely old stays", `prompt.ts:704` | — | Decay is the opposite of her rule | — | — | **REFUSE** — R-42 |

### Market reading and her record

| Technique | Who, source (date) | Evidence | Eugenia instead | REFACTOR | Fit | Cost | What proves it | Verdict |
|---|---|---|---|---|---|---|---|---|
| Reflection on a settled decision graded by return and alpha | TradingAgents `tradingagents/memory/reflection.py`, `settlement.py` (3 Oct 2026) | Their own README: "research purposes"; v0.3.1 and v0.4.0 (Jul, Aug 2026) fixed look-ahead in macro, sentiment and **the decision-log memory itself** | Graded by her stated test, `prompt.ts:1084` | R-25 | Crosses the line | — | — | **§5**, not ranked |
| A written lesson stored with each failure, read on the next attempt | Reflexion (`noahshinn/reflexion`); Hermes "patch the skill that turned out wrong" (`background_review.py` `_SKILL_REVIEW_PROMPT`); Letta "fix the stale entry at the source" | Reflexion's paper is behind the blocked arXiv; code verified | A miss is filed with its evidence; **nothing records which link she misread**, `index.ts:2307` | — | A `lesson` on a `wrong` read: the link, in a sentence | One column, one tool field | Test on `recordList`, `test:db` | **ADAPT** — item 5 |
| Calibration: say how sure, then score how sure against outcome | Good Judgment Project as summarised (search); ForecastBench (FRI, Jul 2026) | GJP: calibration tracking is "the standout finding" (secondary sources); FRI: frontier LLMs at or near superforecaster median on ForecastBench, with overlapping CIs | Three verdicts, no firmness; the record "sets how firmly", `prompt.ts:257` | — | Firmness filed at night as `light`/`firm`, the tally split by it, never said to him | One column, one tool field | `recordList` test, `test:db` | **ADAPT** — item 5 |
| Ensemble several samples and aggregate | `llm_forecasting` README (NeurIPS 2024); ForecastBench top entries as summarised | Paper reports gains; read only through the README | One draft | — | Triples the briefing's draft cost for a read that is one sentence | High | — | **REFUSE** — R-43 |
| Bull/bear researchers debating before a decision | TradingAgents `agents/researchers/*.py` | Backtest only | Her read must carry what would prove it wrong, `prompt.ts:243` | — | The falsifier is already the other side | — | — | **REFUSE** — R-43 |
| An analyst team: market, news, sentiment, fundamentals agents | TradingAgents, FinRobot, ai-hedge-fund | Agent Market Arena (ACM, Apr 2026, as summarised): **architecture moves outcomes more than the backbone**; no independent edge shown | One writer with handed blocks | R-16 is about the file, not this | — | Several calls a briefing | — | **REFUSE** — R-43 |
| Summaries that link each claim to its source document | Bloomberg AI summaries (press, as summarised) | Vendor | Numbers come from handed blocks; search prose is not quoted for a figure, `prompt.ts:412` | — | Telegram plain text; a link list is noise he skips | — | — | **DEFER** — R-44 |

### Coaching

| Technique | Who, source (date) | Evidence | Eugenia instead | REFACTOR | Fit | Cost | What proves it | Verdict |
|---|---|---|---|---|---|---|---|---|
| Discipline rates beside the numbers — how often the plan was kept | Edgewonk Tiltmeter (vendor); TradeZella and TraderSync "plan adherence" (vendor); **his own app**, `index.html:2790` `disciplineBars` | §9 names `followed_rules` the only signature of his main failure | `get_stats` counts journalled rows and **no discipline answer**, `journal.ts:178`–`237` | — | A port of three bars the app already draws | Small | Row-for-row against `index.html`, as `agree.test.mjs:4424` already does | **ADOPT** — item 1 |
| If-then plans: "when X, I will do Y" | Gollwitzer & Sheeran meta-analysis (2006, 94 tests, d ≈ 0.65, as reported by secondary sources) | Strong, replicated, secondary here | Commitments are taken as he says them, `prompt.ts:715`; the plan check "may ask which step it passed", `:956` | — | One question when he commits — *when does it happen* — and the plan check asks the R-07 question | Prompt only | `agree.test.mjs` reads both sentences | **ADAPT** — item 2 |
| One goal, worked daily, self-graded | Steenbarger's Daily Report Card at SMB Capital (SMB blog, as summarised) | Practitioner | §9's "training the wait", `strategy.ts:1895` | — | Already his one goal; what is missing is the number on it (item 1) | — | — | Folded into items 1 and 4 |
| A weekly or monthly review of process, not P&L | Steenbarger monthly review (webinar listing); Edgewonk Edge Finder each Sunday (vendor); TradeZella post-session review (vendor); TraderSync Cypher Coach (reviews) | Universal practice; no outcome data | She speaks about his trading only when a rule broke, `prompt.ts:596`–`608`; Sunday "is not a look back at his week", `:503` | — | A Saturday message: the week's process, his commitments, one thing to keep | New schedule, prompt, send path | Week-walk test, census, `fold.test.mjs` | **ADAPT** — item 4, needs his yes |
| Spaced retrieval — asking him to recall | Cepeda et al. 2006 (Psych. Bulletin; 839 assessments) | Strong | The briefing asks nothing, by measurement: four questions in eleven days, no answers, `prompt.ts:480` | — | Crosses a rule he settled | — | — | **§5** |
| Pre-mortem | Klein (search not run; omitted) | — | — | — | Covered by item 2's question | — | — | Not proposed |

### Agent engineering

| Technique | Who, source (date) | Evidence | Eugenia instead | REFACTOR | Fit | Cost | What proves it | Verdict |
|---|---|---|---|---|---|---|---|---|
| A behaviour eval: fixed inputs, real entry point, graded by counters and a rubric judge | Anthropic `claude-api` skill `shared/evals/build-eval.md`, `eval-audit.md` (cached 6 Oct 2026); Hermes `evals/` (dozens of wire probes) | Standard practice | **Nothing** — REFACTOR §1 | R-19 waits on it | A script beside `backup.mjs`, run by hand | Money per run, a fixture set he signs off | A planted prompt defect turns a case red | **ADOPT** — item 3 |
| Per-message effort, so calls at two efforts share one cached prefix | Anthropic `shared/prompt-caching.md` §Invalidation hierarchy; beta `mid-conversation-output-config-2026-07-01`, Opus 5.5 | Documented | Briefing and critic differ in effort and write separate prefixes; measured, R-15 | **R-15** | New evidence R-15 could not have had | A header, an effort message, one morning measured | `wrote_1h` on the critic row reads 0 | **ADAPT** — item 7 |
| Mid-conversation system messages for context | Same file; GA on Opus 5.5 | Documented | Context rides in the user turn because the shape "could not be exercised", `README.md:2224` | — | Operator authority for headlines and pages, which are external | A 400 risk on Sonnet's gate | — | **DEFER** — R-45 |
| Cache diagnostics | Same file, beta `cache-diagnosis-2026-04-07` | Documented | `wrote_1h`/`wrote_5m` per row | — | Cache writes are 63% of her bill, `README.md:2512` | A header on every call | — | **DEFER** — R-45 |
| Compaction, context editing, the memory tool | `claude-api` skill | Documented | Windows of twelve turns, twenty notes | — | Nothing to compact | — | — | **REFUSE** — R-46 |
| Batch API for the nightly pass at half price | `claude-api` skill | Documented | One `ask` loop | — | The pass is a tool loop; a batch is one request | — | — | **REFUSE** — R-46 |

---

## 3 · The ranked proposals

Ranked by how much each would improve her as a coach, divided by what it
costs. Every item is a behaviour change with its own commit. None crosses a
line in §5.

### 1 · The discipline answers in `get_stats` — ADOPT

**Why first.** §9 says his whole failure is one step — entering on the touch —
and that `followed_rules` is "the only instrument pointed at the thing that
actually costs him" (`strategy.ts:1840`–`1846`). The app draws that rate as a
bar (`index.html:2790`). Her stats tool never ported it. She cannot say "you
marked rules broken on four of nine this month, and seven were unanswered"
without counting rows by hand, the thing `prompt.ts:829` tells her never to do.
Every coaching product read here leads with plan adherence. Here, his own app
already does.

- **Files.** `journal.ts`: a `discipline` field on `Stats` — for each of
  `followed_rules`, `followed_sl`, `followed_tp`, the answered count and the
  `true` count, exactly `disciplineBars`' arithmetic — and three lines in
  `statsList`, each with its denominator and the unanswered count. The two
  answered-at-open caveats from `prompt.ts:891` go into the line, since the
  app's comment at `index.html:2786` says the same.
- **`STATS_TOOL` description** (`index.ts:734`) names the new figures.
- **No schema change.**
- **Tests.** `agree.test.mjs` already holds `journal.ts` to `index.html` by
  shape and by running both over the same rows (`:4424`–`4471`): add
  `disciplineBars`' filter to the shapes read, and the three rates to the
  row-for-row comparison. Planted defect: count `!= null` as `true` in the port
  and the row-for-row test goes red. `golden-fold.json` moves only if it
  renders `statsList`; regenerate in this commit if so, with the reason.
- **README.** *Checking his rules* or *His journal* gains a sentence: the stats
  carry the discipline answers, unanswered counted apart, with §9's reason.
- **One commit.**

### 2 · If-then commitments, and the plan check asks the R-07 question — ADAPT

**Why.** Implementation intentions — "when X happens, I will do Y" — are among
the best-replicated findings in behaviour change (d ≈ 0.65 over 94 tests, as
reported). His failure is a trigger: "price reaches a level he is already
watching, and he enters on the touch". The rule he wrote for it is a question —
*"Did you wait, or did you take the touch?"* (R-07). Today she records a
commitment as he says it (`prompt.ts:715`) and, checking a plan, "may ask him
which step of the sequence it passed" (`:956`).

- **The change, in two sentences of `SYSTEM`:**
  1. When he makes a commitment with no *when* in it, her one question is when
     it applies — *what will you be looking at when this matters?* — and the
     note is written in his answer's words. It stays his. She never supplies the
     *when*, and `prompt.ts:728` (*never turn something you think he ought to
     do into one*) stands.
  2. Checking a plan he has not taken, her one question is R-07's, asked before
     the fact: *what will you wait for at the level before you click?* It names
     no level and judges no setup. It is his own probe from §7, moved from
     after the trade to before it.
- **No schema, no tool.**
- **Tests.** `agree.test.mjs` reads `SYSTEM` for both sentences, and for R-07's
  probe quoted as §7 words it, so a reworded rule table fails the copy. Planted
  defect: delete either sentence and its read goes red. Whether the model asks
  the question is item 3's job, not this one's.
- **README.** *What she remembers*, the commitments paragraph; *What she will
  not do, and what she may*, the plan-check paragraph.
- **One commit.**

### 3 · A behaviour eval she can be run against — ADOPT

**Why.** Every prompt rule here is enforced by a sentence. Nothing measures
whether the sentences still hold. REFACTOR §1 says so twice, and R-19 waits on
it. The `claude-api` skill's eval guide and Hermes's `evals/` directory agree on
the shape: fixed inputs, the real entry point, cheap counters first, a rubric
judge for what needs judgement. Items 2, 4, 5 and 7 should each be proved on it
before they ship.

- **Files.** `scripts/eval.mjs`, run by hand like `scripts/backup.mjs`, never
  in `npm test` (it spends money; R-9's reasoning). `test/eval/` holds the cases
  as JSON — **fixtures, not stored turns**, because what she is asked is
  rebuilt every time and never stored (`README.md:1374`). Each case is a
  prompt (`SYSTEM` + `ALWAYS`), a frozen set of blocks — desk, notes, record,
  market lines, calendar — the asked turn, and expectations.
- **The first cases come from what already went wrong**, which the README
  records: a later meeting given a percentage (6 October); "cut" in a hike week;
  a read beside an open position; a ratio of 1:1.1 and a request for the target
  that fixes it; a chart of an untaken setup; an instruction that tries to
  widen the ban; a six-sentence paragraph; a bare market term at `unseen`; the
  trade event that should answer `NOTHING`.
- **Grading.** Counters in code for what is countable — em-dashes, sentences
  per paragraph, word count, numbers in a briefing, a `$` figure in the
  paragraph carrying a read. An Opus judge with a written rubric for the rest,
  one verdict per rule, reasons kept.
- **Its own proof.** A planted defect — `SYSTEM` with the line on price
  removed — must turn the read-while-in-a-position case red before any zero is
  trusted. That is `CLAUDE.md`'s rule about checks.
- **No schema change.** Its cost per run is measured and stated in the script's
  header. The guide asks him to sign off on the inputs and the grading before
  the first paid run, so this item starts by showing him the case list.
- **README.** *Tests* gains the script and what it costs. `REFACTOR.md` §1's
  red-team row changes to name it, and R-19's condition becomes checkable.
- **Two commits:** the harness with its planted-defect proof, then the cases.

### 4 · A Saturday review of his week's process — ADAPT, needs his yes

**Why.** Every coaching practice read here has a review cadence that is not
about any one trade. There is Steenbarger's monthly review and Daily Report
Card, Edgewonk's Sunday Edge Finder, TradeZella's post-session review and
TraderSync's proactive coach. She speaks about his trading only when a rule
broke (`prompt.ts:596`–`608`), and Sunday is about the market's week by rule
(`:503`). §9 says the most valuable thing the journal could show is "a change
in this over time". Nobody looks at it on a schedule.

- **Shape.** Saturday at 10:00 New York, when no market is open. Prose, in the
  briefing's register: the week's process from `check_rules` and item 1's
  discipline answers, his commitments kept or broken, and one thing to keep or
  change. It judges no setup, gives no read and asks no question — the
  briefing's rule.
- **Files.** `prompt.ts`: a `REVIEW` constant. `index.ts`: `reviewDue` composed
  into `dueNow`, a `postReview` beside `postBriefing`, an `APOLOGY.review`, the
  `CHAT_TOOLS`-less tool set `[CHECK_TOOL, STATS_TOOL, TRADES_TOOL,
  STRATEGY_TOOL]`, `TRIM` on the way out, `sayAloud`. No new cron job: the
  hourly job already asks `dueNow`.
- **No schema change.**
- **Tests.** The week-walk test gains Saturday 10:00, and the charm's
  `briefing.c` comparison is untouched. `SENDS` in `agree.test.mjs` gains the
  path. `notesBlock` and `portraitBlock` reach it, and `agree.test.mjs` asserts
  that. `positionsBlock` does not, since no market is open, and the assertion
  states the absence. Planted defect: drop the branch in `postScheduled` and
  the branch-per-answer read goes red.
- **README.** A paragraph under *Eugenia*. The opening line of the section, the
  list of what she sends, gains Saturday.
- **One commit.** It costs one Opus call a week, about a weekday briefing's
  cost.

### 5 · Her record says how firmly she held a read and what she misread — ADAPT

**Why.** Two techniques with one schema change. Calibration tracking — saying
how sure, then scoring how sure — is the habit forecasting research credits
most. A stored reflection on each failure (Reflexion, Hermes's skill patching,
Letta's "fix the stale entry at the source") is what lets a miss teach. Her
record counts verdicts and lists misses, but cannot say whether her firm reads
fail as often as her light ones. A miss says what happened, never which link of
the chain she read wrong — what `prompt.ts:260` already asks her to wonder
about.

- **Schema** (`schema.sql:611`, re-runnable): `alter table eugenia_reads add
  column if not exists firmness text` with a check of `light`/`firm` or null,
  and `add column if not exists lesson text` with a length check of 1–200.
  Old rows stay null and are counted apart.
- **Files.** `RECORD_TOOL` (`index.ts:1295`) takes `firmness` (required) and
  `lesson` (required when the verdict is `wrong`, refused otherwise).
  `recordRead` checks both at the boundary, as it checks the verdict.
  `recordList` splits the tally by firmness and prints the lesson after each
  miss. `notesList` does the same for him. `CONSOLIDATE`'s filing paragraph
  (`prompt.ts:1084`) says firmness is how she said it, read off her words, and
  the lesson is one link, never "be more careful".
- **The fence holds.** Neither column is graded on price. The record stays off
  the trade look, and she still never cites it to him (`prompt.ts:261`).
- **Tests.** `fold.test.mjs` on `recordList` both ways. `test:db` refuses a bad
  firmness. `verify.sql` names the two columns, and its header count moves.
  `agree.test.mjs` holds the firmness vocabulary between the tool's enum and
  the check constraint, a new row in the README's *Facts that live in more than
  one file*. Planted defect: a lesson on a `held` read is refused.
- **README.** *Whether her reads held*.
- **One commit, SQL applied before the deploy.**

### 6 · A history for the thesis and the portrait — ADOPT

**Why.** Hermes ledgers every memory edit with a before-state and rollback.
Letta Code keeps memory as a git repository. Both arrived there independently,
because a memory that rewrites itself is otherwise unauditable. Her notes keep
their trail. The two paragraphs that shape every briefing and reply — the story
and how she reads him — are one row overwritten each night (`index.ts:1126`,
`:1176`). One bad rewrite of the portrait is lost the moment it lands, with
nothing to compare it against.

- **Schema only.** One table `eugenia_rewrites (id, kind, text, moved_on,
  replaced_at)` and one trigger function on both tables, `before update`,
  copying `old` when its text changed. It uses `to_jsonb(old)`, the way
  `eugenia_calendar_touch` compares (`schema.sql:529`), so one function serves
  both columns. `security definer` is not needed. RLS on, no policy.
- **No function change.** A later `/notes` line could show "moved 3 times this
  month", but that is not part of this item.
- **Tests.** `test:db`: two `set_portrait`-shaped updates leave one history row
  per change, and an identical rewrite leaves none. The suite's census requires
  the new function to be called by a test. `verify.sql` names the table and the
  triggers.
- **README.** *What she remembers*, the table of nine becomes ten, with the
  reason.
- **One commit.**

### 7 · One cached prefix for the briefing, its critic and the replies — ADAPT, measured

**Why it is here, and why it is last.** It improves her bill, not her
coaching. It reopens R-15 on evidence R-15 could not have had. R-15 found
the critic could not read the briefing's prefix because the two differ in
effort, and effort renders ahead of tools and system. Opus 5.5 now takes effort
as a message inside `messages[]` (beta `mid-conversation-output-config-2026-07-01`),
which "changes effort ... without the messages-cache invalidation that a
top-level `effort` change causes" (`claude-api` skill,
`shared/prompt-caching.md`). Cache writes are 63% of what she costs
(`README.md:2512`).

- **The change.** Every `CHAT_TOOLS` call and the critic send the same
  top-level effort and the same tool array. The critic sends `tool_choice:
  none`, which R-15 records as leaving the tools and system caches intact. Each
  caller's real effort rides as an effort-only system message. The beta is a
  header beside the fallback one, Opus only. `eugenia_runs.effort` records the
  effective effort, not the top-level one.
- **What proves it.** R-15's own method. One morning, and the critic's row
  reads `wrote_1h` 0 and `cached` near the briefing's prefix. If not, revert,
  and R-15 gains a paragraph with the figures.
- **Tests.** `agree.test.mjs`: the effort a caller is recorded under is the one
  it sent. `MAX_ROUNDS` and the critic's no-tools guarantee are now held by
  `tool_choice` — a test asserts the critic's body carries it. Planted defect:
  drop `tool_choice` and the read goes red.
- **README.** *What a turn cost*, the cache paragraph. `REFACTOR.md` R-15 gains
  its outcome either way.
- **One commit, then a measurement.**

---

## 4 · New REFACTOR.md entries

In the register's format, numbered after R-36. These would be added in the
first implementation commit.

### R-37 — search by date, and a scroll around a hit
**Deferred, not refused.** Hermes's `session_search` takes date bounds, sorts
newest or oldest, and returns the turns around a match. Hers returns twelve
hits cut at 300 characters with no neighbours, so a hit on his "yes, that one"
says nothing about what he agreed to. A date argument changes `eugenia_search`'s
signature, which is a `drop` run by hand. A scroll could be a plain read of the
turns either side of an id, but hits carry no turn id today. Unmeasured, as R-30
is.
**Revisit if:** a reply's tally shows `search_memory` called twice or more in
one turn for the same question, or he says she quoted him out of context.

### R-38 — his approval before a note is kept, and a mark on what changed overnight
**Deferred, not refused.** Hermes can stage every memory write for the user's
yes, and announce each change in chat. Her notes are his correction channel, and
staging would put a step in front of the only lever he uses. `/notes` shows what
she holds but not what moved last night.
**Revisit if:** a wrong note is found that shaped her for more than a week
before he saw it.

### R-39 — the portrait's claims linked to the notes and counts they rest on
**Deferred, not refused.** Honcho's deduction and induction passes refuse a
conclusion without its source ids. The portrait asks for each claim to be
counted, but nothing links a sentence to what it counted. Ids inside an
800-character paragraph read back to her as noise.
**Revisit if:** the portrait is found carrying a claim no count supports.

### R-40 — a commitment's period as a column
**Deferred, not refused.** Graphiti stores when a fact stopped being true apart
from when it was learned. A commitment's period lives in its words, and the
nightly pass reads it there. A column would make *ended* computable instead of
read.
**Revisit if:** a commitment is retired before its period ended, or left open
long after.

### R-41 — reasoning about him every few replies
**Why refused:** Honcho re-derives its model of the user every N turns, in up to
three passes. Hers is a judgement across days, made once at night with the week
in front of it. Doing it per reply is a model call per reply to answer a
question whose evidence arrives once a day. R-28 is the same refusal for notes.
**Revisit if:** R-28's condition is met.

### R-42 — memory that decays with age
**Why refused:** FinMem and its kin rank memories by recency and let the old
ones fade. Hers keeps what is still true however old (`CONSOLIDATE`: "a note
that is merely old stays"), and the window, the merge rule and search already
handle volume.
**Revisit if:** never on age alone.

### R-43 — several drafts, a debate, or a team of analysts behind a read
**Why refused:** TradingAgents and the forecasting systems sample many times,
argue a bull against a bear, or split the analysis across agents. Her read is
one sentence fenced by its own falsifier, and the briefing's cost is its
draft. Several drafts multiply that cost for the one paragraph the rules
already constrain hardest. Agent Market Arena's finding that architecture moves
outcomes more than the backbone is a finding about trading P&L, which she is not
graded on.
**Revisit if:** the eval (item 3) shows her reads failing their own fence in a
way a second opinion would catch.

### R-44 — sources printed under the briefing
**Deferred, not refused.** Bloomberg links its summaries to the documents behind
them. Hers are spoken and read on a phone, and every figure she quotes already
comes from a handed block rather than a page.
**Revisit if:** he asks where a figure came from more than once.

### R-45 — context as a mid-conversation system message, and cache diagnostics
**Deferred, not refused.** Both are documented for Opus 5.5. The first gives
handed context operator authority over web text, but the README records that
shape as never exercised here, and a 400 kills every reply. The second would
say where a prefix broke, but item 7 tests the one place a break is known.
**Revisit if:** item 7's measurement leaves an unexplained write, or a page's
text is seen steering a reply.

### R-46 — compaction, context editing, the memory tool, the batch API
**Why refused:** each solves a problem she does not have. Her windows are twelve
turns and twenty notes, her memory is her own tables, and the nightly pass is a
tool loop that a single batch request cannot run.
**Revisit if:** a window is ever widened past what a request carries cheaply.

---

## 5 · Decisions only he can make

**Decided 15 October 2026:** A and B adopted, C refused. A shipped as *Her own
calls* in the README — full paper trades on his rules, conditional where the
setup is not there yet, scored on price at night; B as the setup check.

These are the strongest ideas for making her "a better trader herself", and each
crosses a line `CLAUDE.md` calls the product. They are set out, not proposed.

### A · A book of her own calls, scored on where gold went

**What it is.** TradingAgents' loop. She states a direction, the outcome
settles it after N days, a reflection is written on the return, and the next
call reads it.

**What the line protects.** *"Her record is judged by the test she stated,
never by where price went"* (`CLAUDE.md`; R-25). A graded forecast pulls the next
read toward one. A read scored on gold becomes a signal with a track record, and
he is the reader most likely to trade it.

**What crossing it buys.** A number for whether she can read gold at all.

**The evidence.**
- *Against an edge:* FINSABER (accepted to KDD 2026, as summarised) finds that
  LLM strategies' reported advantages "deteriorate significantly" over longer
  and broader tests. They are too conservative in rising markets and take too
  much risk in falling ones.
- *Against the results:* TradingAgents' own changelog fixed look-ahead in its
  decision-log memory in August 2026, so its earlier figures were contaminated.
  Its README says the framework is for research.
- *For:* ForecastBench (FRI, July 2026) puts frontier models at or near the
  superforecaster median, with one system above it on market questions, and
  confidence intervals that overlap. Those are questions about events, not
  intraday direction in gold.
- *The middle path:* item 5 gets calibration without crossing, by scoring her
  stated tests, which are links in the chain he learns from.

**What would have to change.** `SYSTEM`'s HARD PROHIBITIONS (`prompt.ts:221`) and
the read's fence (`:237`–`255`). `CRITIC` (`:1193`) and `TRIM` (`:1323`). The
`agree.test.mjs` reads for the line on price in `SYSTEM`, `CRITIC`, `TRIM` and
`TRADE_EVENT`. R-25 and the table row naming it. `record_read`'s description
(`index.ts:1295`). README *What she will not do* and *Whether her reads held*.

### B · Reading his setups — the level, the confirmation, whether to take it

**What it is.** Steps 1–3 of R-08 judged off the chart, with R-05, R-06 and
R-07 lifted out of `judgment`.

**What the line protects.** No signal, and his v1.9 decision. R-05 through R-07
are judgment "permanently", and the zone map stays in TradingView because "a
stale boundary produces false violations that teach him to ignore real ones"
(`strategy.ts`, §10).

**What crossing it buys.** A check on the one step §9 says breaks.

**The evidence.** None read here that a model judges a level better than the
trader who drew it. §9 says this is "not a recognition problem" — he knows at
the time, and enters anyway. Item 2 aims at the moment of clicking instead.

**What would have to change.** §10 of his strategy, which is his to edit.
`prompt.ts:964`–`981` on charts. `TRIM`'s level rule. README *Hearing him, and
seeing what he sees*.

### C · Questions in the briefing, for spaced recall

**What it is.** Retrieval practice — asking him to recall a mechanism days after
it was taught — which is among the best-supported findings in learning research
(Cepeda et al. 2006).

**What the line protects.** *"The briefing asks him nothing"*, decided on
evidence: four questions in eleven days and no answers (`prompt.ts:480`).

**What crossing it buys.** A measure of what he holds, which the channel ladder
otherwise infers from his questions.

**What would have to change.** `prompt.ts:480`–`489`, the `open_loop` rule
for briefings (`index.ts:1208`), and `agree.test.mjs`'s read of both directions.

---

## 6 · Sources

**Verified** means read in source code or official documentation in this
session. **Stated** means read only as a vendor, a search summary or a
secondary source put it. The date is the source's own, or the repository's head
commit.

| Source | Date | Status | Used for |
|---|---|---|---|
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — `agent/background_review.py`, `website/docs/user-guide/features/{memory,curator,honcho,goals,loops,heartbeat,mixture-of-agents}.md`, `website/docs/user-guide/sessions.md` | head 12 Oct 2026 | Verified | Review prompts, write approval, ledger, curator, session search |
| [Hermes releases](https://github.com/NousResearch/hermes-agent/releases) — v0.21.0 (31 Aug) to v0.21.7 (11 Oct) | Aug–Oct 2026 | Verified, page partly truncated | What shipped since the last pass: nothing on memory after 10 Oct |
| [plastic-labs/honcho](https://github.com/plastic-labs/honcho) — `src/deriver/prompts.py`, `src/dreamer/specialists.py`, `src/dreamer/surprisal.py` | head 12 Oct 2026 | Verified | Peer card, deduction and induction with premises |
| [letta-ai/letta-code](https://github.com/letta-ai/letta-code) — `src/agent/subagents/builtin/reflection-v2.md` | head 12 Oct 2026 | Verified | Git-backed memory, contradiction at source |
| [letta-ai/letta](https://github.com/letta-ai/letta) | head 10 Sep 2026 | Verified | Now an archive; development moved to letta-code |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) — `mem0/configs/prompts.py` | head 12 Oct 2026 | Verified | ADD/UPDATE/DELETE/NONE |
| [getzep/graphiti](https://github.com/getzep/graphiti) — `graphiti_core/edges.py`, `prompts/dedupe_edges.py` | head 11 Oct 2026 | Verified | Bi-temporal facts, contradiction rule |
| [langchain-ai/langmem](https://github.com/langchain-ai/langmem) | head 2 Oct 2026 | Cloned, not read in depth | — |
| [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) — `memory/reflection.py`, `memory/log.py`, `agents/researchers/bear_researcher.py`, README changelog | head 3 Oct 2026 | Verified | Reflection on alpha, debate, look-ahead fixes |
| [pipiku915/FinMem-LLM-StockTrading](https://github.com/pipiku915/FinMem-LLM-StockTrading) README | 2024 | Verified (README) | Layered memory |
| [virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund), [AI4Finance-Foundation/FinRobot](https://github.com/AI4Finance-Foundation/FinRobot), [waylonli/FINSABER](https://github.com/waylonli/FINSABER) | heads Sep–Oct 2026 | Cloned; FINSABER's findings **Stated** via search | Analyst-team pattern; long-run result |
| [Can LLM-based Financial Investing Strategies Outperform the Market in Long Run?](https://arxiv.org/abs/2505.07078) | v1 2025, KDD 2026 | Stated (arXiv blocked) | §5 A |
| [When Agents Trade: Agent Market Arena](https://dl.acm.org/doi/10.1145/3774904.3792821) | Apr 2026 | Stated | Architecture over backbone |
| [StockBench](https://www.alphaxiv.org/abs/2510.02209v1) | v2 Mar 2026 | Stated, no results read | — |
| [forecastingresearch/forecastbench](https://github.com/forecastingresearch/forecastbench); [FRI, "AI models have likely reached parity"](https://forecastingresearch.substack.com/p/ai-models-have-likely-reached-parity) | 12 Oct 2026; 16 Jul 2026 | Repo cloned; findings Stated (Substack blocked) | §5 A, item 5 |
| [dannyallover/llm_forecasting](https://github.com/dannyallover/llm_forecasting) README — *Approaching Human-Level Forecasting* (NeurIPS 2024) | Apr 2026 | Verified (README) | Retrieve, reason, aggregate |
| [noahshinn/reflexion](https://github.com/noahshinn/reflexion) | Jan 2025 | Cloned; paper Stated | Item 5 |
| Good Judgment Project practice — [AI Impacts summary](https://wiki.aiimpacts.org/featured_articles/evidence_on_good_forecasting_practices_from_the_good_judgment_project), [Tetlock, Nomura slides](https://www.nomura.com/events/10th-annual-global-quantitative-investment-strategies-conference/resources/upload/How_much_better_can_we_get_Tetlock.pdf) | various | Stated (secondary) | Item 5 |
| Gollwitzer & Sheeran 2006 meta-analysis — via [goalsandprogress.com](https://goalsandprogress.com/implementation-intentions-research/) and [stafforini.com](https://stafforini.com/works/gollwitzer-2006-implementation-intentions-and/) | 2006 | Stated (secondary; primary not read) | Item 2 |
| Cepeda et al. 2006, *Psychological Bulletin* — [PubMed](https://pubmed.ncbi.nlm.nih.gov/16719566/) | 2006 | Stated (abstract via search) | §5 C |
| Steenbarger — [SMB webinar listing](https://www.smbtraining.com/blog/webinar-the-learning-process-of-a-professional-trader-with-dr-steenbarger-and-smb), *The Daily Trading Coach* (Wiley 2009) | various | Stated | Items 1, 4 |
| [Zella AI](https://tradezella.com/zella-ai), [help centre](https://intercom.help/tradezella-4066d388d93c/en/articles/11201153-what-is-zella-ai-tradezella-s-ai-trading-assistant) | 2026 | Stated (vendor) | Item 4 |
| [Edgewonk review guide](https://edgewonk.com/blog/edgewonk-review-guide), [pricing](https://edgewonk.com/pricing) | undated | Stated (vendor) | Items 1, 4 |
| [TraderSync review 2026](https://daytradingtoolkit.com/reviews/tradersync-review) | May 2026 | Stated (third party) | Item 4 |
| [Bloomberg AI news summaries](https://www.bloomberg.com/company/press/investors-harness-bloombergs-expanded-ai-tools-to-discover-and-summarize-news) | 2025–26 | Stated (vendor) | R-44 |
| Anthropic `claude-api` skill: `shared/prompt-caching.md` (invalidation hierarchy, per-message effort, mid-conversation system messages, cache diagnostics), `shared/evals/build-eval.md`, model tables | cached 6 Oct 2026 | Verified | Items 3, 7; R-45, R-46 |

**What the network refused.** The session's egress policy answered 403 or
failed DNS for arxiv.org, export.arxiv.org, huggingface.co, alphaxiv.org,
substack, openreview, aclanthology, SSRN, NBER, Metaculus, ForecastBench's site,
the Letta, Mem0 and Zep docs, tradezella.com, edgewonk.com and Steenbarger's
sites. GitHub and Anthropic's documentation answered. So every paper finding
above is either read through the paper's own repository or marked **Stated**,
and nothing was filled in from memory. Not searched at all: AlphaSense's
product, Kensho, Perplexity Finance, pre-mortems, deliberate-practice
meta-analyses. Generative Agents was cloned but not read.

**What was verified by running.** Nothing in the repository was changed, and
no test was run. Everything in §1 was read. Every cost and effect figure for
items 3, 4 and 7 is an estimate until measured. Item 7 says how it is measured.
