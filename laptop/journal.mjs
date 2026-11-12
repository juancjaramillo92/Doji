/* Gladys's journal as the laptop asks it, shared by both processes and pure,
   so laptop.test.mjs drives it against her door's own parseCallback.

   The four answers in the order the card asks them, each by the key her
   door's COLUMNS takes and the column that key writes, and the two setups by
   their names: copies of COLUMNS and SETUPS in doji-gladys, which
   agree.test.mjs holds them against. */
export const ANSWERS = [['setup', 'setup'], ['rules', 'followed_rules'], ['sl', 'followed_sl'], ['tp', 'followed_tp']];
export const SETUPS = ['Break & Retest', 'Support & Resistance'];
/* Each question in the app's own words: the three it asks yes or no are
   copies of journalForm's in index.html, which agree.test.mjs holds. */
export const ASKS = ['Which setup?', 'Followed rules?', 'Followed stop loss?', 'Followed take profit?'];

/* What a trade still lacks, and the question it is asked first — the first
   it lacks of the setup, rules and stop loss, or else the take profit. */
export function asked(trade) {
  const missing = ANSWERS.map(([, column]) => trade[column] == null);
  const q = missing.slice(0, 3).indexOf(true);
  return { q: q < 0 ? 3 : q, missing };
}

/* Whether what waits now is another question than the one the card shows:
   another trade, or this one's question answered elsewhere. Only then does
   the card turn and its minute begin again — a look that finds the same
   question must not keep the card up for ever. */
export const turned = (shown, q, next) => next.id !== shown.id || asked(next).q !== q;

/* What a trade already holds, each answer as the half that gave it — the
   first setup or a no the left, 0 — or null for one not yet given. */
export const given = (trade) => ANSWERS.map(([, column], q) =>
  (trade[column] == null ? null : q === 0 ? SETUPS.indexOf(trade[column]) : Number(trade[column])));

/* One answer in a tap's own grammar: the left half the first setup or no,
   the right the second setup or yes. */
export const tap = (id, q, half) => `${id}|${ANSWERS[q][0]}|${q === 0 ? SETUPS[half] : half ? '1' : '0'}`;
