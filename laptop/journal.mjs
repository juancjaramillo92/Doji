/* Gladys's journal as the laptop asks it, shared by both processes and pure,
   so laptop.test.mjs drives it against her door's own parseCallback.

   The four answers in the order the screens ask them, each by the key her
   door's COLUMNS takes and the column that key writes, and the two setups by
   their names: copies of COLUMNS and SETUPS in doji-gladys, which
   agree.test.mjs holds them against. */
export const ANSWERS = [['setup', 'setup'], ['rules', 'followed_rules'], ['sl', 'followed_sl'], ['tp', 'followed_tp']];
export const SETUPS = ['Break & Retest', 'Support & Resistance'];

/* What a trade still lacks, and the question it is asked first — the first
   it lacks of the setup, rules and stop loss, or else the take profit. */
export function asked(trade) {
  const missing = ANSWERS.map(([, column]) => trade[column] == null);
  const q = missing.slice(0, 3).indexOf(true);
  return { q: q < 0 ? 3 : q, missing };
}

/* One answer in a tap's own grammar: the left half the first setup or no,
   the right the second setup or yes. */
export const tap = (id, q, half) => `${id}|${ANSWERS[q][0]}|${q === 0 ? SETUPS[half] : half ? '1' : '0'}`;
