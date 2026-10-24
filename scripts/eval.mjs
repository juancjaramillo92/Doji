/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — does Eugenia still behave?
   ───────────────────────────────────────────────────────────────────────────
   Every rule that matters most about her is a sentence in prompt.ts, and no
   other test can say whether the model still obeys it. This sends fixed cases
   through her real prompts — the reply, both gates, the trade look, the
   Saturday review and the weekday briefing, built the way index.ts builds them
   — and grades what comes back: what can be counted is counted here, and what
   needs judgement goes to a judge with a written criterion per case.

   The cases are the failures the README records, and the rules his decisions
   added: a later meeting given a percentage, a cut in a hike week, a read
   beside an open position, the target that fixes a ratio, a filed call cut by
   a gate, a commitment with no moment in it, the map of his charts written
   into a briefing's prose. test/fixtures/eval-cases.json.

   It spends money, so it is never in `npm test` and is run by hand. With
   `--plant` it first runs the cases a deliberately broken prompt should fail,
   and stops if the breakage goes unseen: an eval that cannot fail is not one.

   Run:  ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/eval.mjs [--plant] [--only <id>]
   Cost: about fifty model calls, half of them the judge; the system prompt is
         cached across them. Measured on the first run and stated in its output.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { SYSTEM, CRITIC, TRIM, TRADE_EVENT, REVIEW } from '../supabase/functions/doji-eugenia/prompt.ts';
import { ALWAYS, SECTIONS } from '../supabase/functions/doji-eugenia/strategy.ts';

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

export const CASES = JSON.parse(file('test/fixtures/eval-cases.json'));

/* The models are read out of the function rather than named again here, so the
   eval always asks the models she runs on. */
const FN = file('supabase/functions/doji-eugenia/index.ts');
export const MODEL = {
  opus:   FN.match(/const OPUS = "([^"]+)"/)[1],
  sonnet: FN.match(/const SONNET = "([^"]+)"/)[1],
};

/* ─── What she is asked, path by path ────────────────────────────────────────
   Each mirrors its call site in index.ts: converse for a reply, critique() and
   trim() for the gates, postTradeEvent for the trade look, postReview for the
   Saturday review's draft, postBriefing for the weekday briefing's.
   agree.test.mjs holds the gates' two markers against the function's. `prompts`
   is a parameter so a planted defect can hand in a broken copy. A case whose
   prompt tells her to read a section names it as `strategy`, and is handed the
   section itself, read from the module get_strategy serves. */
const context = (c) => (c.context ?? '') +
  (c.strategy ? `\n\nWhat get_strategy returned for §${c.strategy}:\n\n${SECTIONS[c.strategy]}` : '');

/* The weekday briefing's draft, asked as postBriefing asks it: the request,
   then what it was handed. With no tools, so a case hands her what a search
   or get_around would have. */
export const BRIEF_ASKED = "Today's briefing, please.";

export const PATHS = {
  reply:  (c) => ({ model: MODEL.opus, effort: 'medium',
                    content: `${context(c)}\n\n${c.asked}` }),
  critic: (c, p) => ({ model: MODEL.opus, effort: 'medium',
                       content: `${p.CRITIC}${context(c)}\n\nTHE BRIEFING:\n\n${c.draft}` }),
  trim:   (c, p) => ({ model: MODEL.sonnet, effort: 'medium',
                       content: `${p.TRIM}${context(c)}\n\nTHE MESSAGE:\n\n${c.draft}` }),
  trade:  (c, p) => ({ model: MODEL.opus, effort: 'medium',
                       content: `${p.TRADE_EVENT}\n\n${c.situation}${context(c)}` }),
  review: (c, p) => ({ model: MODEL.opus, effort: 'high', content: `${p.REVIEW}${context(c)}` }),
  brief:  (c) => ({ model: MODEL.opus, effort: 'high', content: `${BRIEF_ASKED}${context(c)}` }),
};

export const PROMPTS = { SYSTEM, CRITIC, TRIM, TRADE_EVENT, REVIEW };

/* The request body, as ask() sends it but for the tools: a case hands her what
   a tool would have returned, so the answer depends on the prompt alone. */
export function request(c, prompts = PROMPTS) {
  const { model, effort, content } = PATHS[c.path](c, prompts);
  return {
    model, max_tokens: 16000,
    system: [{ type: 'text', text: prompts.SYSTEM + ALWAYS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive' },
    output_config: { effort },
  };
}

/* ─── What is counted rather than judged ─────────────────────────────────────
   The countable rules, the ones the gates are told to count: no em-dash, a
   paragraph of four sentences at most, a word budget, one question. */
/* CRITIC is told the briefing's hello is not counted, and TRIM, which reads
   replies, is told nothing of the kind; so on the critic's path a first
   sentence that is a greeting alone — four words at most — is not counted. A
   hello run into a longer first sentence is. */
const HELLO_WORDS = 4;

export const COUNTERS = {
  emDash:    (text) => !text.includes('—') || 'an em-dash',
  sentences: (text, n, c) => {
    // A list line — a dash or the calendar's label — is not prose and is not counted.
    const paras = text.split(/\n\s*\n/)
      .map(p => p.split('\n').filter(l => !/^\s*(-|·|Today:)/.test(l)).join(' ').trim()).filter(Boolean);
    const count = (p, i) => {
      const said = p.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [p];
      const hello = c?.path === 'critic' && i === 0 && said[0].trim().split(/\s+/).length <= HELLO_WORDS;
      return said.length - (hello ? 1 : 0);
    };
    const over = paras.findIndex((p, i) => count(p, i) > n);
    return over < 0 || `a paragraph of ${count(paras[over], over)} sentences: "${paras[over].slice(0, 60)}…"`;
  },
  words:     (text, n) => {
    const w = text.split(/\s+/).filter(Boolean).length;
    return w <= n || `${w} words`;
  },
  questions: (text, n) => {
    const q = (text.match(/\?/g) ?? []).length;
    return q <= n || `${q} questions`;
  },
};

/* Every counted check and every pattern, as a list of what failed. She is sent
   no tools, so a tool she reaches for comes back as text: that is not a
   message, and a judge told to pass what a criterion does not touch passed it.
   It fails whatever else the case checks, and says the case is short of an
   answer, not that the prompt is wrong. */
export function counted(c, text) {
  const failed = [];
  const reached = text.match(/<invoke name="([^"]+)"/);
  if (reached) failed.push(`reached for ${reached[1]}, which this case does not serve: hand her its answer`);
  failed.push(...writing(c, text));
  for (const re of c.must ?? []) if (!new RegExp(re, 'i').test(text)) failed.push(`missing /${re}/`);
  for (const re of c.mustNot ?? []) {
    const hit = text.match(new RegExp(re, 'i'));
    if (hit) failed.push(`has /${re}/ in "…${text.slice(Math.max(0, hit.index - 60), hit.index + 60)}…"`);
  }
  if (c.equals !== undefined && text.trim() !== c.equals) failed.push(`not "${c.equals}"`);
  return failed;
}

// The counts alone: the writing rules, which settle() asks again before failing.
function writing(c, text) {
  return Object.entries(c.counts ?? {}).map(([name, arg]) => COUNTERS[name](text, arg, c)).filter(said => said !== true);
}

/* ─── The judge ──────────────────────────────────────────────────────────────
   One call per case, every criterion at once, answered as JSON the schema
   fixes, so a verdict cannot be read off prose. Told the context, since "no
   view while he is in a position" means nothing without the position. */
const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { criterion: { type: 'string' }, pass: { type: 'boolean' }, why: { type: 'string' } },
        required: ['criterion', 'pass', 'why'], additionalProperties: false,
      },
    },
  },
  required: ['verdicts'], additionalProperties: false,
};

export function judgeRequest(c, text) {
  return {
    model: MODEL.opus, max_tokens: 4000,
    system: [{ type: 'text', text:
      'You grade one message written by Eugenia, a market coach bot for a gold day ' +
      'trader, against criteria a person wrote. Judge only what each criterion asks, ' +
      'strictly and literally, from the message and the context it was written in. ' +
      'A criterion the message does not touch passes only if it says so.' }],
    messages: [{ role: 'user', content:
      `THE CONTEXT SHE WAS GIVEN:\n${c.context ?? ''}\n${c.situation ?? ''}\n${c.asked ?? ''}` +
      (c.draft ? `\n\nTHE DRAFT SHE WAS CHECKING:\n${c.draft}` : '') +
      `\n\nTHE MESSAGE SHE SENT:\n${text}\n\nCRITERIA:\n` +
      c.judge.map((j, i) => `${i + 1}. ${j}`).join('\n') }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: VERDICTS } },
  };
}

/* ─── The planted defects ────────────────────────────────────────────────────
   Each breaks one rule in a copy of the prompts and names the cases that must
   then fail. Run first with --plant: if those cases still pass, the eval is
   blind to that rule and its green means nothing.

   A broken prompt does not break every answer, so each case is asked
   PLANT_TRIES times, and one failure is the eval seeing the breakage. A rule
   the writer states more than once goes from every copy, or the one left
   standing keeps her to it: the position ban stands in the ban, in the
   permission on asking, which states the default, in what she may say of a
   position being narrower than what she sees, and in what she does unprompted.
   And its case asks for what the ban withholds, a read on a print that
   surprised: asked what the dollar did, she answers the dollar, ban or no ban. */
export const PLANT_TRIES = 3;

// MECHANISM's second half restates the ban, in the writer and the critic both.
const MECHANISM_BAN = / A\s+view says which way you think gold goes from here,[\s\S]*?take out the view\./;

export const PLANTS = [
  /* A reply case cannot see this plant: without the ban she walks the chain to
     gold, which MECHANISM allows, and volunteers no read. So the critic is
     handed a draft carrying her labelled read while he holds a position; with
     the ban it comes out, without it CRITIC is told a labelled read stays. */
  { why: 'the ban on a view while he holds a position, gone from the writer and the critic',
    cases: ['critic-strips-read-in-position'],
    breaks: (p) => ({
      ...p,
      CRITIC: p.CRITIC.replace(/, and any view\s+at all if what he has on shows an open position/, '')
        .replace(MECHANISM_BAN, ''),
      SYSTEM: p.SYSTEM
        .replace(MECHANISM_BAN, '')
        .replace(/· No view on where price goes and no call while he has a position open,[\s\S]*?shows a position\.\n/, '')
        .replace(/, or a view while he is in a position,/, ',')
        .replace(/ If he asks where you think price goes, you may[\s\S]*?and you say so\./, '')
        .replace(/ Read these rules before using it: this is the one thing you are given\s+where what you may SAY is narrower than what you can SEE\./, '')
        .replace(/UNPROMPTED IT DOES TWO THINGS AND NO MORE\. It stops you writing anything[\s\S]*?as being about his trade\. And it lets you/,
                 'It lets you'),
    }) },
  /* Taken out alone, the exception leaves a call TRIM keeps anyway: it is
     labelled and says what would prove it wrong, which is what the fence
     above it asks of a read. So the plant turns it into a plain order to cut,
     in words that cannot be read as keeping the call whole or as the fence. */
  { why: 'the gates\' exception for a filed call, gone from TRIM',
    cases: ['trim-keeps-filed-call'],
    breaks: (p) => ({
      ...p,
      TRIM: p.TRIM.replace(/YOUR CALL IS THE ONE\s+EXCEPTION:[\s\S]*?never changed\./,
        'YOUR CALL COMES OUT TOO: delete every sentence that gives an entry, a stop or a target.'),
    }) },
  /* The map rule restates the hours rule above it for the map, and the critic
     runs under both, so both go. Its draft names no level off the map, and says
     the map in plain words: with the rule gone, the number budget cuts a level
     and the plain-words rule a trader's word, a sweep or a flip, and either way
     the case cannot see the rule go. */
  { why: 'the map of his charts kept out of the briefing\'s prose, gone from the critic and the writer',
    cases: ['critic-keeps-map-out-of-prose'],
    breaks: (p) => ({
      ...p,
      SYSTEM: p.SYSTEM
        .replace(/THE BRIEFING IS THE WEEKS BEHIND HIS CHART, NOT THE HOURS ON IT\.[\s\S]*?the story that leads\.\n\n/, '')
        .replace(/THE MAP OF HIS CHARTS IS THE HOURS ON IT,[\s\S]*?a call you file\.\n\n/, ''),
      CRITIC: p.CRITIC.replace(/Is the map of his charts in the prose\?[\s\S]*?it comes out\.\n\n/, ''),
    }) },
  /* The writer states R-20's caution once, and the critic runs under the
     writer's prompt, so both copies go. On 15 October the writer tied the
     08:30 prints to the position opened that morning and the critic, with no
     check for it, sent it. */
  { why: 'a print beside a position he opened knowingly left to him, gone from the critic and the writer',
    cases: ['critic-print-beside-his-position'],
    breaks: (p) => ({
      ...p,
      CRITIC: p.CRITIC.replace(/Is a print put beside a position he opened this session\?[\s\S]*?said with the rule\.\n\n/, ''),
      SYSTEM: p.SYSTEM.replace(/ A print due beside a position he opened knowing\s+it was there is R-20's,[\s\S]*?adds nothing he did not have\./, ''),
    }) },
  /* From 15 to 22 October she failed the bias step whenever the three charts
     disagreed. The plan check points at the call's rule, so both go. */
  { why: 'the bias weighed rather than failed on disagreement, gone from the writer',
    cases: ['bias-weighed'],
    breaks: (p) => ({
      ...p,
      SYSTEM: p.SYSTEM.replace(/HOW THE THREE BIAS CHARTS ADD UP IS YOURS TO JUDGE\.[\s\S]*?then say that is what failed\.\n\n/, '')
        .replace(/, weighed as it is for your own call\./, '.'),
    }) },
  /* On 24 October, checking a Wednesday plan with Thursday's 08:30 pending, she
     wrote that the stop has to move before it lands: R-19 rightly cited, said
     as an order about a trade he was weighing. */
  { why: 'R-19 said as his rule on a plan he would hold into a later session, gone from the writer',
    cases: ['plan-r19-said-as-rule'],
    breaks: (p) => ({
      ...p,
      SYSTEM: p.SYSTEM.replace(/ One that lands in a later\s+session, were he to hold it, is R-19's,[\s\S]*?those\s+are\s+orders\./, ''),
    }) },
];

/* ─── The run ────────────────────────────────────────────────────────────── */
const KEY = process.env.ANTHROPIC_API_KEY;

export async function claude(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  if (out.stop_reason === 'refusal' || out.stop_reason === 'max_tokens') throw new Error(`stopped: ${out.stop_reason}`);
  return { text: (out.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim(),
           usage: { model: body.model, ...out.usage } };
}

export async function grade(c, prompts = PROMPTS, ask = claude) {
  const sent = await ask(request(c, prompts));
  const failed = counted(c, sent.text);
  const usage = [sent.usage];
  if (c.judge?.length) {
    const judged = await ask(judgeRequest(c, sent.text));
    usage.push(judged.usage);
    for (const v of JSON.parse(judged.text).verdicts) if (!v.pass) failed.push(`${v.criterion}: ${v.why}`);
  }
  return { id: c.id, text: sent.text, failed, usage, slipped: failed.length > 0 && failed.length === writing(c, sent.text).length };
}

/* A case is asked once, and the model does not write the same words twice, so
   one miss of a count could be the rule broken or a slip a second asking would
   not repeat. A miss of the writing counts alone is asked RETRIES more times,
   and fails if either misses again: a rule broken misses every time. Anything
   else fails on the first miss: a prohibition kept most of the time is broken,
   and so is a judge's verdict or a pattern. */
export const RETRIES = 2;

export async function settle(c, prompts = PROMPTS, ask = claude) {
  const first = await grade(c, prompts, ask);
  if (!first.slipped) return first;
  const again = await Promise.all(Array.from({ length: RETRIES }, () => grade(c, prompts, ask)));
  const missed = again.filter(r => r.failed.length).length;
  return { ...first, failed: missed ? first.failed : [], slip: first.failed, missed,
           usage: [first, ...again].flatMap(r => r.usage) };
}

// Per million tokens, each model's list price: a five-minute write is 1.25×
// input, and a read is $0.20 on both.
const RATE = {
  [MODEL.opus]:   { in: 4, out: 20, read: 0.2, write: 5 },
  [MODEL.sonnet]: { in: 2, out: 10, read: 0.2, write: 2.5 },
};

// What a run's calls cost, in dollars, off the usage each answer reports.
export const costOf = (usage) => usage.reduce((sum, u) => sum +
  ((u.input_tokens ?? 0) * RATE[u.model].in + (u.output_tokens ?? 0) * RATE[u.model].out +
   (u.cache_read_input_tokens ?? 0) * RATE[u.model].read +
   (u.cache_creation_input_tokens ?? 0) * RATE[u.model].write) / 1e6, 0);

async function main(argv) {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY is not set; this eval calls the model and costs money');
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  // A mistyped id would run nothing and pass.
  if (only && !CASES.some(c => c.id === only)) throw new Error(`no case ${only}`);
  const usage = [];

  if (argv.includes('--plant')) {
    for (const plant of PLANTS) {
      const broken = plant.breaks(PROMPTS);
      if (Object.keys(PROMPTS).every(k => broken[k] === PROMPTS[k])) throw new Error(`the plant did not change the prompt: ${plant.why}`);
      for (const id of plant.cases) {
        const results = await Promise.all(Array.from({ length: PLANT_TRIES },
          () => grade(CASES.find(c => c.id === id), broken)));
        for (const r of results) usage.push(...r.usage);
        const caught = results.filter(r => r.failed.length).length;
        console.log(`${caught ? 'caught' : 'NOT CAUGHT'} ${caught} of ${PLANT_TRIES} — ${plant.why} (${id})`);
        // What she wrote with the rule gone is the one thing that says why a
        // case cannot see it go.
        if (!caught) {
          console.log(`      she wrote: ${results[0].text.replace(/\s+/g, ' ').slice(0, 400)}`);
          throw new Error('a planted defect passed: the eval is blind to it, and its green says nothing');
        }
      }
    }
  }

  let red = 0;
  for (const c of CASES.filter(c => !only || c.id === only)) {
    const result = await settle(c);
    usage.push(...result.usage);
    if (result.failed.length) red++;
    console.log(`${result.failed.length ? 'FAIL' : 'pass'}  ${c.id} — ${c.why}` +
      (result.slip ? `  (a count missed, then ${result.missed} of ${RETRIES} asked again)` : ''));
    for (const f of result.slip ?? result.failed) console.log(`      · ${f}`);
    if (result.slip || result.failed.length) console.log(`      she wrote: ${result.text.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  console.log(`\n${red} of ${only ? 1 : CASES.length} failed; this run cost about $${costOf(usage).toFixed(2)}`);
  process.exitCode = red ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 2; });
}
