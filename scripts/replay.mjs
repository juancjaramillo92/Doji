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

   THE TECHNICAL HALF ONLY. Nothing kept says what the market around gold,
   the calendar or the Fed's odds read on a past morning, so she is told she
   has her map and nothing else, and the record it makes is of her reading of
   his charts.

   NEVER A DAY THE MODEL CAN REMEMBER. The model she runs on read the world up
   to June 2026; a call on a morning it read about is a test with the answer
   in it. CLEAN_FROM is the first day replayed, and an earlier one is skipped.

   It changes nothing. A change to how she reads a chart is judged by two runs,
   before and after, over the same days, with both tables in its commit.

   Run:  SUPABASE_URL=… DOJI_CRON_SECRET=… ANTHROPIC_API_KEY=… \
           node --experimental-strip-types scripts/replay.mjs [--days 21]
   Cost: one model call a weekday, about $0.12 to $0.25 each with her prompt
         cached across them, so a month of sessions is a few dollars; and one
         broker read a day through the poller. Stated at the end of the run.
   ═══════════════════════════════════════════════════════════════════════════ */
import { SYSTEM } from '../supabase/functions/doji-eugenia/prompt.ts';
import { ALWAYS } from '../supabase/functions/doji-eugenia/strategy.ts';
import { foldStructure } from '../supabase/functions/doji-eugenia/structure.ts';
import { structureList, callProblem, scoreCall, expiryOf, CALL_SIDES, CALL_CONFIRMS, CALL_OUTCOMES }
  from '../supabase/functions/doji-eugenia/index.ts';
import { claude, costOf, MODEL } from './eval.mjs';

export const CLEAN_FROM = '2026-07-01';
export const DAYS = 21;

const ASK = `A REPLAY OF A PAST MORNING. It is 08:00 New York and you are writing the
briefing's call, but you are handed only your map of his charts as it stood
then: no news, no calendar, no journal, nothing he said. Decide the one call
you would file for this session on his rules, exactly as make_call takes it,
or no call. Answer as the schema asks, with why in one sentence.`;

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
    why:       { type: 'string' },
  },
  required: ['call', 'why'],
  additionalProperties: false,
};

/* The request, as the briefing's: her system prompt and his rules' cached
   prefix, the briefing's effort, and the map in the words she is handed it. */
export function request(served) {
  return {
    model: MODEL.opus, max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM + ALWAYS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `${ASK}${structureList(foldStructure(served.charts, served.at), served.at)}` }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: ANSWER } },
  };
}

/* What her answer files: no call, a call make_call would refuse, or the row
   it would write, scored on the session's minute bars. */
export function replayed(answer, served) {
  if (!answer.call) return { outcome: 'none', why: answer.why };
  const { direction, entry, stop, target, confirm } = answer;
  const level = confirm === 'close' ? answer.level : null;
  const refused = callProblem(direction, entry, stop, target, confirm, level ?? NaN);
  if (refused) return { outcome: 'refused', why: refused };
  const made = new Date(served.at);
  const call = { id: 0, made_at: made.toISOString(), expires_at: expiryOf(made).toISOString(), direction,
                 entry, stop, target, condition: answer.condition ?? '', confirm, level, outcome: null, result: null };
  return { ...scoreCall(call, served.bars, served.at), call, why: answer.why };
}

export function tally(rows) {
  const by = (o) => rows.filter(r => r.outcome === o).length;
  const traded = rows.filter(r => r.result !== null && r.result !== undefined);
  const net = Math.round(traded.reduce((s, r) => s + r.result, 0) * 100) / 100;
  return `${rows.length} sessions: ${by('none')} no call, ${by('refused')} off his rules, ` +
    CALL_OUTCOMES.map(o => `${by(o)} ${o}`).join(', ') +
    (traded.length ? `; the ${traded.length} that triggered made ${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)} an ounce` : '') + '.';
}

const line = (day, r) => `${day}  ${r.outcome.padEnd(11)}` +
  (r.call ? ` ${r.call.direction} ${r.call.entry}, stop ${r.call.stop}, target ${r.call.target}` +
            (r.call.confirm === 'close' ? `, on a 5m close beyond ${r.call.level}` : ', at the market') : '') +
  (r.result !== null && r.result !== undefined ? `  ${r.result >= 0 ? '+' : ''}${r.result}` : '') + `  — ${r.why}`;

async function main(argv) {
  const { SUPABASE_URL: url, DOJI_CRON_SECRET: secret, ANTHROPIC_API_KEY: key } = process.env;
  if (!url || !secret || !key) throw new Error('SUPABASE_URL, DOJI_CRON_SECRET and ANTHROPIC_API_KEY must all be set; this calls the model and costs money');
  const days = argv.includes('--days') ? Number(argv[argv.indexOf('--days') + 1]) : DAYS;
  const rows = [], usage = [];
  for (let n = 1; n <= days; n++) {
    const res = await fetch(`${url}/functions/v1/doji-mcp-sync?replay=${n}`, { headers: { 'x-doji-key': secret } });
    if (!res.ok) throw new Error(`replay ${n}: HTTP ${res.status} ${await res.text()}`.slice(0, 300));
    const served = await res.json();
    const day = new Date(served.at).toISOString().slice(0, 10);
    if (day < CLEAN_FROM) { console.log(`${day}  stopped: before ${CLEAN_FROM}, a morning the model may remember`); break; }
    if (!served.bars.length) { console.log(`${day}  no session`); continue; }
    if (served.missing.length) console.log(`${day}  not read: ${served.missing.map(m => `${m.period} ${m.error}`).join('; ')}`);
    const sent = await claude(request(served));
    usage.push(sent.usage);
    const r = replayed(JSON.parse(sent.text), served);
    rows.push(r);
    console.log(line(day, r));
  }
  console.log(`\n${tally(rows)}\nThis run cost about $${costOf(usage).toFixed(2)}.`);
}

// Only when run directly, so the test can import the functions above.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 2; });
}
