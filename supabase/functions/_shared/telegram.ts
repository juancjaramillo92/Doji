// ═══════════════════════════════════════════════════════════════════════════
// DOJI — Telegram journal, shared core
// ───────────────────────────────────────────────────────────────────────────
// The pure half of the two Telegram functions: what a message says, what its
// buttons carry, and what a tap on one of them means. No network, no Deno, no
// secrets — which is what lets test/fold.test.mjs import it directly.
//
// THE MESSAGE IS THE STATE. There is no session table and no stored
// tg_message_id, because there is nothing to store: `callback_data` carries the
// trade id, the field and the value, and the callback payload carries the chat
// and message ids that editMessageText needs. A tap is self-describing, so a
// restart, a redeploy or a message from six weeks ago all behave identically.
//
// The same idea settles the one thing the design could not derive from the row.
// Once all four answers are in, the message collapses to a summary with an
// [Edit] button — but a correction usually touches more than one field, and a
// form that re-collapsed after each tap would need [Edit] pressed again every
// time. So "expanded" is read off the keyboard already on the message: the
// settled form has exactly one row, the open form has four.
// ═══════════════════════════════════════════════════════════════════════════

// Identical to CONFIG.SETUPS in index.html and to the trades_setup_check
// constraint. Three copies of one vocabulary, and the constraint is the one
// that cannot be bypassed — a value that gets past the check below still has to
// satisfy Postgres.
export const SETUPS: readonly string[] = ['Break & Retest', 'Support & Resistance'];

// callback_data field → column. This map is the entire reason a tap cannot
// disturb broker data: it is the same four columns as Data.OWNED in index.html,
// and nothing outside it is nameable from a button.
const COLUMNS: Record<string, string> = {
  setup: 'setup',
  rules: 'followed_rules',
  sl:    'followed_sl',
  tp:    'followed_tp',
};

export interface Row {
  id: string;
  direction: string;
  entry_price: number;
  entry_time: string;
  setup: string | null;
  followed_rules: boolean | null;
  followed_sl: boolean | null;
  followed_tp: boolean | null;
}

export interface Tap {
  id: string;
  // null is the [Edit] action: reopen the keyboard, write nothing.
  column: string | null;
  value: string | boolean | null;
}

/* ─── callback_data ────────────────────────────────────────────────────────
   `PID562780708|setup|Break & Retest` and `PID562780708|sl|1`, with
   `PID562780708|edit` for the reopen. Telegram caps callback_data at 64 bytes;
   the longest this can produce is 39, and a test measures it so a setup name
   added later cannot quietly cross the line.

   THIS IS THE BOUNDARY. Everything arriving here came off the wire, so the
   whitelists live in this function and the callers do no further checking. An
   unrecognised payload returns null rather than throwing: the webhook answers
   Telegram 200 regardless, because a 500 only buys the same bad payload again.
   ───────────────────────────────────────────────────────────────────────── */
export function parseCallback(data: string): Tap | null {
  const parts = data.split('|');
  const id = parts[0];
  if (!/^PID\d+$/.test(id)) return null;

  if (parts.length === 2) return parts[1] === 'edit' ? { id, column: null, value: null } : null;
  if (parts.length !== 3) return null;

  const column = COLUMNS[parts[1]];
  if (!column) return null;

  if (parts[1] === 'setup') {
    return SETUPS.includes(parts[2]) ? { id, column, value: parts[2] } : null;
  }
  if (parts[2] !== '0' && parts[2] !== '1') return null;
  return { id, column, value: parts[2] === '1' };
}

/* ─── Rendering ────────────────────────────────────────────────────────────
   Plain text, no parse_mode. `Break & Retest` carries an ampersand and the
   setups are the one string in here that a person edits, so HTML or Markdown
   framing would buy a bold header at the price of an escaping bug the day a
   setup name gains a character. Nothing here needs weight.
   ───────────────────────────────────────────────────────────────────────── */

// Unanswered is an em dash, never a cross. null is a third state, and a message
// that drew it as "no" would teach the trader the opposite of what the column
// means.
const mark = (v: boolean | null) => v === null ? '—' : v ? '✓' : '✗';

// The New York clock, because that is the day the trade is filed under. The
// same 21:05 fill that nyDay keeps on its own day would read as tomorrow here
// if this used the UTC stamp.
const nyTime = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));

const answered = (row: Row) =>
  row.setup !== null && row.followed_rules !== null &&
  row.followed_sl !== null && row.followed_tp !== null;

const yesNo = (id: string, field: string, label: string) => [
  { text: `${label} ✓`, callback_data: `${id}|${field}|1` },
  { text: `${label} ✗`, callback_data: `${id}|${field}|0` },
];

// One shape for both functions: send posts it, the webhook edits with it, and
// neither decides anything about presentation on its own.
export function renderMessage(row: Row, expanded: boolean) {
  const price = Number(row.entry_price).toFixed(2);

  if (answered(row) && !expanded) {
    return {
      text: `${row.direction} ${price} · ${row.setup} · rules ${mark(row.followed_rules)}` +
            ` stop ${mark(row.followed_sl)} target ${mark(row.followed_tp)}`,
      reply_markup: { inline_keyboard: [[{ text: 'Edit', callback_data: `${row.id}|edit` }]] },
    };
  }

  return {
    text: [
      `${row.direction} ${price} · ${nyTime(row.entry_time)} NY`,
      '',
      `Setup: ${row.setup ?? '—'}`,
      `Rules: ${mark(row.followed_rules)}`,
      `Stop: ${mark(row.followed_sl)}`,
      `Target: ${mark(row.followed_tp)}`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        SETUPS.map(s => ({ text: s, callback_data: `${row.id}|setup|${s}` })),
        yesNo(row.id, 'rules', 'Rules'),
        yesNo(row.id, 'sl', 'Stop'),
        yesNo(row.id, 'tp', 'Target'),
      ],
    },
  };
}

/* ─── Inbound authorisation ────────────────────────────────────────────────
   Length-independent comparison, the same one doji-mcp-sync makes on its own
   header. A plain !== leaks the expected secret's length through timing, which
   is free to avoid.

   Its own copy rather than an import: doji-mcp-sync calls Deno.serve at module
   scope, so importing that file from here would start a second poller inside
   whichever function did the importing.
   ───────────────────────────────────────────────────────────────────────── */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!expected || !presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
