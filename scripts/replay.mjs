/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — what would her calls have done?
   ───────────────────────────────────────────────────────────────────────────
   Her calls are scored a session at a time, so a month is the shortest span a
   change to how she reads a chart can be judged on. This asks her for the
   call she would have filed on past mornings and scores each the way the
   nightly pass does, so a change is judged in an afternoon.

   For each weekday N back the poller serves his six charts as they stood at
   08:00 New York and that session's minute bars (`doji-mcp-sync?replay=N`).
   Her map is folded from the charts by foldStructure, said by structureList,
   and handed to her under her real system prompt; her answer goes through
   callProblem, as make_call would put it, and scoreCall, as the pass would.

   THE TECHNICAL HALF, UNLESS --inputs. Asked plainly she is told she has her
   map and nothing else, and the record is of her reading of his charts. With
   --inputs each morning is asked a second time, handed the whole message that
   morning's briefing was handed (eugenia_inputs, kept since 22 October 2026),
   with no tools: the same mornings, with the market around gold, the calendar
   and the Fed's odds beside the map. The two tallies side by side are whether
   the other half of her reading makes her calls better, which nothing else
   measures. A morning with no input kept is asked neither way.

   AGAINST HIS RULES WITH NOBODY READING. A tally of hers alone cannot say
   whether she earned it or his rules did, so every session is also traded by
   `baseline`: the first five-minute candle after 08:00 to reach a mark on her
   map and close off it, entered on that close as his R-07 enters, $20 stop,
   $30 target, scored by scoreCall. No bias, no choice of level, no model.
   What she adds is the distance between her line and that one.

   ASKED MORE THAN ONCE, WITH --runs. The model does not answer the same way
   twice, and one asking a morning cannot tell a reading from a draw. Asked N
   times, the run counts the mornings she took the same side every time and
   the mornings she bought on one asking and sold on another. A call that
   flips on the same map is noise whatever it made.

   ON ANOTHER MODEL, WITH --model. The same mornings under another model id is
   the only fair way to compare two, and it is what a change to MODELS in the
   function should rest on.

   NEVER A DAY THE MODEL CAN REMEMBER. The model she runs on read the world up
   to June 2026; a call on a morning it read about is a test with the answer
   in it. CLEAN_FROM is the first day replayed, and an earlier one is skipped.
   A model named with --model is held to the same day, so check what it read.

   It changes nothing. A change to how she reads a chart is judged by two runs,
   before and after, over the same days, with both tables in its commit.

   Run:  SUPABASE_URL=… DOJI_CRON_SECRET=… ANTHROPIC_API_KEY=… \
           node --experimental-strip-types scripts/replay.mjs [--days 21] \
             [--runs 3] [--model <id>] [--inputs]     (--inputs: SB_SECRET_KEY too)
   Cost: one model call a weekday, about $0.12 to $0.25 each with her prompt
         cached across them, so a month of sessions is a few dollars; times
         --runs, and twice that with --inputs, whose message is longer. One
         broker read a day through the poller. Stated at the end of the run
         for a model whose rate eval.mjs keeps.
   ═══════════════════════════════════════════════════════════════════════════ */
import { SYSTEM } from '../supabase/functions/doji-eugenia/prompt.ts';
import { ALWAYS } from '../supabase/functions/doji-eugenia/strategy.ts';
import { foldStructure } from '../supabase/functions/doji-eugenia/structure.ts';
import { structureList, callProblem, scoreCall, expiryOf, notBefore, dollars, CALL_SIDES, CALL_CONFIRMS, CALL_OUTCOMES, CONFIRM_MS }
  from '../supabase/functions/doji-eugenia/index.ts';
import { FULL_STOP, TARGET_MAX } from '../supabase/functions/doji-eugenia/adherence.ts';
import { nyDate } from '../supabase/functions/_shared/edge.ts';
import { claude, costOf, MODEL } from './eval.mjs';

export const CLEAN_FROM = '2026-07-01';
export const DAYS = 21;

const ASK = `A REPLAY OF A PAST MORNING. It is 08:00 New York and you are writing the
briefing's call, but you are handed only your map of his charts as it stood
then: no news, no calendar, no journal, nothing he said. Decide the one call
you would file for this session on his rules, exactly as make_call takes it,
or no call. Answer as the schema asks, with why in one sentence.`;

const ASK_INPUT = `A REPLAY OF A PAST MORNING. Below, under THE MORNING, is the whole
message that morning's briefing was asked, as it was handed to you then. You
have no tools here: nothing can be searched and nothing is filed. Do not write
the briefing. Decide the one call you would file for this session on his rules,
exactly as make_call takes it, or no call, which is also the answer whenever
your rules give none. Answer as the schema asks, with why in one sentence.

THE MORNING:

`;

const ANSWER = {
  type: 'object',
  properties: {
    call:      { type: 'boolean' },
    direction: { type: 'string', enum: [...CALL_SIDES] },
    entry:     { type: 'number' },
    stop:      { type: 'number' },
    target:    { type: 'number' },
    condition: { type: 'string' },
    confirm:   { type: 'string', enum: [...CALL_CONFIRMS] },
    level:     { type: 'number' },
    not_before: { type: 'string' },
    why:       { type: 'string' },
  },
  required: ['call', 'why'],
  additionalProperties: false,
};

/* The request, as the briefing's: her system prompt and his rules' cached
   prefix, the briefing's effort, and the map in the words she is handed it,
   or, with an input, the morning's whole message in its place. */
export function request(served, model = MODEL.opus, input = null) {
  return {
    model, max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM + ALWAYS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: input === null
      ? `${ASK}${structureList(foldStructure(served.charts, served.at), served.at)}`
      : `${ASK_INPUT}${input}` }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: ANSWER } },
  };
}

/* What her answer files: no call, a call make_call would refuse, or the row
   it would write, scored on the session's minute bars. `at` is when she was
   asked: 08:00 for the map alone, and for an input the minute it was kept,
   since a briefing run late saw a later morning and is scored from there. */
export function replayed(answer, served, at = served.at) {
  if (!answer.call) return { outcome: 'none', why: answer.why };
  const { direction, entry, stop, target, confirm } = answer;
  const level = confirm === 'close' ? answer.level : null;
  const refused = callProblem(direction, entry, stop, target, confirm, level ?? NaN);
  if (refused) return { outcome: 'refused', why: refused };
  const made = new Date(at), until = expiryOf(new Date(served.at));
  const held = answer.not_before == null ? null : notBefore(made, until, answer.not_before);
  if (answer.not_before != null && !held) return { outcome: 'refused', why: 'not_before is not a time before the roll' };
  const call = { id: 0, made_at: made.toISOString(), expires_at: until.toISOString(), direction,
                 entry, stop, target, condition: answer.condition ?? '', confirm, level,
                 not_before: held?.toISOString() ?? null, outcome: null, result: null };
  return { ...scoreCall(call, served.bars, served.at), call, why: answer.why };
}

/* His rules with nobody reading them: the first 5m candle opened at or after
   08:00 whose range holds a mark on her map, a level or a quarter, and that
   closed off it, bought above and sold below, entered on that close with the
   full stop and the full target. A candle closing above one mark and below
   another names no side and is passed over. Scored by scoreCall as a call at
   the market made the minute the candle closed, so its doubts are hers. */
export function baseline(served) {
  const map = foldStructure(served.charts, served.at);
  const marks = [...new Set([...map.levels, ...map.grid].map(m => m.price))];
  const candles = new Map();
  for (const b of served.bars) {
    const t = Math.floor(b.t / CONFIRM_MS) * CONFIRM_MS;
    if (t < served.at) continue;
    const c = candles.get(t);
    candles.set(t, c ? { ...c, high: Math.max(c.high, b.high), low: Math.min(c.low, b.low), close: b.close } : { ...b, t });
  }
  for (const c of candles.values()) {
    const sides = new Set(marks.filter(m => c.low <= m && m <= c.high && c.close !== m).map(m => c.close > m ? 'buy' : 'sell'));
    if (sides.size !== 1) continue;
    const [direction] = sides, way = direction === 'buy' ? 1 : -1;
    const call = { id: 0, made_at: new Date(c.t + CONFIRM_MS).toISOString(),
                   expires_at: expiryOf(new Date(served.at)).toISOString(), direction, entry: c.close,
                   stop: Math.round((c.close - way * FULL_STOP) * 100) / 100,
                   target: Math.round((c.close + way * TARGET_MAX) * 100) / 100,
                   condition: '', confirm: 'market', level: null, outcome: null, result: null };
    return { ...scoreCall(call, served.bars, served.at), call, why: 'the first five-minute close off a mark' };
  }
  return { outcome: 'none', why: 'no five-minute candle reached a mark and closed off it' };
}

export function tally(rows) {
  const by = (o) => rows.filter(r => r.outcome === o).length;
  const traded = rows.filter(r => r.result !== null && r.result !== undefined);
  const net = Math.round(traded.reduce((s, r) => s + r.result, 0) * 100) / 100;
  const left = rows.filter(r => r.outcome === 'untriggered' && r.confirmed_at).length;
  return `${rows.length} sessions: ${by('none')} no call, ${by('refused')} off his rules, ` +
    CALL_OUTCOMES.map(o => `${by(o)} ${o}`).join(', ') +
    (left ? ` (${left} with the close and no fill after it)` : '') +
    (traded.length ? `; the ${traded.length} that triggered made ${dollars(net)} an ounce` : '') + '.';
}

/* Whether asking again gets the same answer. `mornings` is each morning's
   rows, one an asking; a side is buy, sell, no call or a call off his rules. */
export function agreement(mornings) {
  const sides = mornings.map(rows => new Set(rows.map(r => r.call ? r.call.direction : r.outcome)));
  const flipped = sides.filter(s => s.has('buy') && s.has('sell')).length;
  return `Asked ${mornings[0]?.length ?? 0} times a morning: the same side every time on ` +
    `${sides.filter(s => s.size === 1).length} of ${mornings.length}, a buy on one asking and a sell on another on ${flipped}.`;
}

/* The first input kept each New York day, which is the session's: a morning
   asked twice was written from the first, and a briefing asked again in the
   evening is already tomorrow in UTC. Sunday's is about the week and has no
   08:00. */
export function inputsByDay(rows) {
  const by = new Map();
  for (const r of [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) by.set(nyDate(new Date(r.at)), r);
  return by;
}

const line = (day, r) => `${day}  ${r.outcome.padEnd(11)}` +
  (r.call ? ` ${r.call.direction} ${r.call.entry}, stop ${r.call.stop}, target ${r.call.target}` +
            (r.call.confirm === 'close' ? `, on a 5m close beyond ${r.call.level}` : ', at the market') +
            (r.call.not_before ? `, not before ${r.call.not_before.slice(11, 16)}Z` : '') : '') +
  (r.result !== null && r.result !== undefined ? `  ${r.result >= 0 ? '+' : ''}${r.result}` : '') + `  — ${r.why}`;

async function main(argv) {
  const { SUPABASE_URL: url, DOJI_CRON_SECRET: secret, ANTHROPIC_API_KEY: key, SB_SECRET_KEY: service } = process.env;
  if (!url || !secret || !key) throw new Error('SUPABASE_URL, DOJI_CRON_SECRET and ANTHROPIC_API_KEY must all be set; this calls the model and costs money');
  const flag = (name) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : null;
  const days = Number(flag('--days') ?? DAYS), runs = Number(flag('--runs') ?? 1), model = flag('--model') ?? MODEL.opus;
  // A mistyped count would ask nothing and print an empty tally.
  if (!(Number.isInteger(days) && days >= 1 && Number.isInteger(runs) && runs >= 1)) throw new Error('--days and --runs are whole numbers, 1 or more');
  let inputs = null;
  if (argv.includes('--inputs')) {
    if (!service) throw new Error('--inputs reads eugenia_inputs, which needs SB_SECRET_KEY');
    const res = await fetch(`${url}/rest/v1/eugenia_inputs?select=at,asked&caller=eq.${encodeURIComponent('weekday briefing')}` +
                            `&order=id.desc&limit=${days * 3}`, { headers: { apikey: service, authorization: `Bearer ${service}` } });
    if (!res.ok) throw new Error(`eugenia_inputs: HTTP ${res.status} ${await res.text()}`.slice(0, 300));
    inputs = inputsByDay(await res.json());
  }
  const base = [], usage = [];
  // Each way a morning is asked, with its mornings: the rows of one morning's askings.
  const ways = [{ name: 'her map alone', whole: false, mornings: [] },
                ...(inputs ? [{ name: 'the whole morning', whole: true, mornings: [] }] : [])];
  for (let n = 1; n <= days; n++) {
    const res = await fetch(`${url}/functions/v1/doji-mcp-sync?replay=${n}`, { headers: { 'x-doji-key': secret } });
    if (!res.ok) throw new Error(`replay ${n}: HTTP ${res.status} ${await res.text()}`.slice(0, 300));
    const served = await res.json();
    const day = nyDate(new Date(served.at));
    if (day < CLEAN_FROM) { console.log(`${day}  stopped: before ${CLEAN_FROM}, a morning the model may remember`); break; }
    if (!served.bars.length) { console.log(`${day}  no session`); continue; }
    if (served.missing.length) console.log(`${day}  not read: ${served.missing.map(m => `${m.period} ${m.error}`).join('; ')}`);
    const input = inputs?.get(day);
    // Kept after the roll, it saw a session this one's bars do not hold.
    if (inputs && !(input && Date.parse(input.at) < served.ends)) { console.log(`${day}  no input kept that morning`); continue; }
    const mechanical = baseline(served);
    base.push(mechanical);
    console.log(line(day, mechanical));
    for (const way of ways) {
      const rows = [];
      for (let i = 0; i < runs; i++) {
        const sent = await claude(request(served, model, way.whole ? input.asked : null));
        usage.push(sent.usage);
        const r = replayed(JSON.parse(sent.text), served, way.whole ? Math.max(served.at, Date.parse(input.at)) : served.at);
        rows.push(r);
        console.log(`${line(day, r)}${inputs ? `  [${way.name}]` : ''}`);
      }
      way.mornings.push(rows);
    }
  }
  console.log(`\nHis rules with nobody reading — ${tally(base)}`);
  for (const way of ways) {
    console.log(`${model}, ${way.name} — ${tally(way.mornings.flat())}` +
      (runs > 1 && way.mornings.length ? `\n${agreement(way.mornings)}` : ''));
  }
  console.log(Object.values(MODEL).includes(model)
    ? `This run cost about $${costOf(usage).toFixed(2)}.`
    : `No rate is kept for ${model}, so the cost is not stated.`);
}

// Only when run directly, so the test can import the functions above.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 2; });
}
