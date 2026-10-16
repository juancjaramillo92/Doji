/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — does Eugenia still behave?
   ───────────────────────────────────────────────────────────────────────────
   Every rule that matters most about her is a sentence in prompt.ts, and no
   other test can say whether the model still obeys it. This sends fixed cases
   through her real prompts — the reply, both gates and the trade look, built
   the way index.ts builds them — and grades what comes back: what can be
   counted is counted here, and what needs judgement goes to a judge with a
   written criterion per case.

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
   Saturday review's draft. agree.test.mjs holds
   the gates' two markers against the function's. `prompts` is a parameter so
   a planted defect can hand in a broken copy. A case whose prompt tells her to
   read a section names it as `strategy`, and is handed the section itself,
   read from the module get_strategy serves. */
const context = (c) => (c.context ?? '') +
  (c.strategy ? `\n\nWhat get_strategy returned for §${c.strategy}:\n\n${SECTIONS[c.strategy]}` : '');

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
const sentences = (para) => (para.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [para]).length;

export const COUNTERS = {
  emDash:    (text) => !text.includes('—') || 'an em-dash',
  sentences: (text, n) => {
    // A list line — a dash or the calendar's label — is not prose and is not counted.
    const over = text.split(/\n\s*\n/)
      .map(p => p.split('\n').filter(l => !/^\s*(-|·|Today:)/.test(l)).join(' ').trim())
      .find(p => p && sentences(p) > n);
    return !over || `a paragraph of ${sentences(over)} sentences: "${over.slice(0, 60)}…"`;
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
  for (const [name, arg] of Object.entries(c.counts ?? {})) {
    const said = COUNTERS[name](text, arg);
    if (said !== true) failed.push(said);
  }
  for (const re of c.must ?? []) if (!new RegExp(re, 'i').test(text)) failed.push(`missing /${re}/`);
  for (const re of c.mustNot ?? []) if (new RegExp(re, 'i').test(text)) failed.push(`has /${re}/`);
  if (c.equals !== undefined && text.trim() !== c.equals) failed.push(`not "${c.equals}"`);
  return failed;
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

   A broken prompt does not break every answer. With the position ban gone she
   still mostly answered the dollar question and nothing more: caught in 9 of
   16 runs, where the whole prompt failed 0 of 8. So each case is asked
   PLANT_TRIES times, and one failure is the eval seeing the breakage. On 15
   October it was caught 1 of 9 against a question with no figure in it, so
   its case now hands her a print that surprised: a read is something to say
   about a surprise, and the ban is what keeps it unsaid. It was still caught
   0 or 1 of 3, because the writer kept the ban in the sentence that lets her
   give a read when he asks: a permission on asking states the default, so it
   goes too. On 16 October it fell to 0 of 3 again: two more copies stood,
   that what she may say of a position is narrower than what she sees, and
   that unprompted it does two things and no more. Both go. It still caught 0
   of 3: asked what the dollar was doing, she answered the dollar, ban or no
   ban. The case now asks what the market makes of the print, where a read is
   what SYSTEM says she gives when one is earned, and what the ban withholds. */
export const PLANT_TRIES = 3;

export const PLANTS = [
  { why: 'the ban on a view while he holds a position, gone from every place the writer states it',
    cases: ['view-unasked-in-position'],
    breaks: (p) => ({
      ...p,
      SYSTEM: p.SYSTEM
        .replace(/· No view on where price goes and no call while he has a position open,[\s\S]*?shows a position\.\n/, '')
        .replace(/, or a view while he is in a position,/, ',')
        .replace(/ If he asks where you think price goes, you may[\s\S]*?and you say so\./, '')
        .replace(/ Read these rules before using it: this is the one thing you are given\s+where what you may SAY is narrower than what you can SEE\./, '')
        .replace(/UNPROMPTED IT DOES TWO THINGS AND NO MORE\. It stops you writing anything[\s\S]*?as being about his trade\. And it lets you/,
                 'It lets you'),
    }) },
  { why: 'the gates\' exception for a filed call, gone from TRIM',
    cases: ['trim-keeps-filed-call'],
    breaks: (p) => ({
      ...p,
      TRIM: p.TRIM.replace(/YOUR CALL IS THE ONE\s+EXCEPTION:[\s\S]*?never changed\./, 'A call with levels in it comes out whole.'),
    }) },
  /* The map rule restates the hours rule above it for the map, and the critic
     runs under both, so both go. Its draft names no level off the map: on 15
     October, with eight levels in it, the number budget cut them with the rule
     gone, and the plant was caught 0 of 3. */
  { why: 'the map of his charts kept out of the briefing\'s prose, gone from the critic and the writer',
    cases: ['critic-keeps-map-out-of-prose'],
    breaks: (p) => ({
      ...p,
      SYSTEM: p.SYSTEM
        .replace(/THE BRIEFING IS THE WEEKS BEHIND HIS CHART, NOT THE HOURS ON IT\.[\s\S]*?the story that leads\.\n\n/, '')
        .replace(/THE MAP OF HIS CHARTS IS THE HOURS ON IT,[\s\S]*?a call you file\.\n\n/, ''),
      CRITIC: p.CRITIC.replace(/Is the map of his charts in the prose\?[\s\S]*?it comes out\.\n\n/, ''),
    }) },
];

/* ─── The run ────────────────────────────────────────────────────────────── */
const KEY = process.env.ANTHROPIC_API_KEY;

async function claude(body) {
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
  return { id: c.id, text: sent.text, failed, usage };
}

// Per million tokens, each model's list price: a five-minute write is 1.25×
// input, and a read is $0.20 on both.
const RATE = {
  [MODEL.opus]:   { in: 4, out: 20, read: 0.2, write: 5 },
  [MODEL.sonnet]: { in: 2, out: 10, read: 0.2, write: 2.5 },
};

async function main(argv) {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY is not set; this eval calls the model and costs money');
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
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
        if (!caught) console.log(`      she wrote: ${results[0].text.replace(/\s+/g, ' ').slice(0, 400)}`);
        if (!caught) throw new Error('a planted defect passed: the eval is blind to it, and its green says nothing');
      }
    }
  }

  let red = 0;
  for (const c of CASES.filter(c => !only || c.id === only)) {
    const result = await grade(c);
    usage.push(...result.usage);
    if (result.failed.length) red++;
    console.log(`${result.failed.length ? 'FAIL' : 'pass'}  ${c.id} — ${c.why}`);
    for (const f of result.failed) console.log(`      · ${f}`);
    if (result.failed.length) console.log(`      she wrote: ${result.text.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  const cost = usage.reduce((sum, u) => sum +
    ((u.input_tokens ?? 0) * RATE[u.model].in + (u.output_tokens ?? 0) * RATE[u.model].out +
     (u.cache_read_input_tokens ?? 0) * RATE[u.model].read +
     (u.cache_creation_input_tokens ?? 0) * RATE[u.model].write) / 1e6, 0);
  console.log(`\n${red} of ${CASES.length} failed; this run cost about $${cost.toFixed(2)}`);
  process.exitCode = red ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 2; });
}
