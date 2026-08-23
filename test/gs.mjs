/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — sandbox for doji_gmail_sync.gs
   ───────────────────────────────────────────────────────────────────────────
   The Apps Script was described as untestable, and half of it is: GmailApp
   needs a live mailbox and nothing here can supply one. The other half never
   did. parseAlert_ is a pure function of a subject and an HTML body, sendFill_
   is a function of one HTTP response, and syncPepperstone is a loop over
   threads — all three are reachable the moment the four Google globals exist.

   The file has no top-level calls, only `var` declarations and function
   declarations, so evaluating it in a vm context runs nothing and leaves every
   function on that context. That is the whole trick.

   The stubs RECORD rather than merely satisfy. What is being tested about
   syncPepperstone is which label a thread ends up with, and a stub that
   accepted addLabel and forgot it could not tell a retry from a permanent
   failure — which is the distinction that once lost a fill's P&L.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exported so a test can assert on what the file SAYS, not only on what the
// stubs answer. The credential check needs this: a stub that returns null for
// every unknown property answers "no password here" whatever the script does.
export const SOURCE = readFileSync(new URL('../doji_gmail_sync.gs', import.meta.url), 'utf8');

// A Gmail thread as the script uses one: messages in, a label out. `labels` is
// what every assertion about the three outcomes actually reads.
export function thread(messages) {
  return {
    labels: [],
    getMessages: () => messages,
    addLabel(l) { this.labels.push(l.name); },
    removeLabel(l) { this.labels = this.labels.filter(n => n !== l.name); },
  };
}

export const message = (subject, body, date = new Date('2026-07-30T14:29:00Z')) => ({
  getSubject: () => subject,
  getBody: () => body,
  getDate: () => date,
});

/* Boots the script. `responses` is what UrlFetchApp hands back, one per call —
   an object of { code, text }, or an Error to throw, which is how a network
   failure with no response at all is expressed.

   `existingLabels` is which Gmail labels already exist. It matters because
   getOrCreateLabel_ and resetDojiLabels both branch on a label being absent,
   and a stub that always answered with one made neither branch reachable. */
export function boot({ threads = [], responses = [], secret = 'test-secret',
                       existingLabels = ['doji-synced', 'doji-parse-failed'] } = {}) {
  const log = [];
  const posted = [];
  const created = [];
  let next = 0;

  const label = (name) => ({ name, getThreads: () => threads });

  const context = {
    // The three-outcome logic reads the code and nothing else, so a response is
    // a code and a body.
    UrlFetchApp: {
      fetch(url, options) {
        posted.push({ url, options, body: JSON.parse(options.payload) });
        // A call the test did not describe is a call the test cannot be
        // asserting about. Answering it 200 makes "sent one fill" and "sent
        // four" look identical from the labels, which is the whole subject.
        if (next >= responses.length && responses.length) {
          throw new Error(`gs.mjs: call ${next + 1} was not described — ` +
                          `${responses.length} response(s) supplied`);
        }
        const answer = responses[next++] ?? { code: 200, text: '{"ok":true}' };
        if (answer instanceof Error) throw answer;
        return {
          getResponseCode: () => answer.code,
          getContentText: () => answer.text ?? '',
        };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'DOJI_EMAIL_SECRET' ? secret : null),
      }),
    },
    GmailApp: {
      search: () => threads,
      // null when the label does not exist yet, which is what the script's two
      // absent-label branches are written for.
      getUserLabelByName: (name) =>
        existingLabels.includes(name) ? label(name) : null,
      createLabel(name) { created.push(name); existingLabels.push(name); return label(name); },
    },
    Logger: { log: (m) => log.push(String(m)) },
  };

  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  return { ...context, log, posted, created, threads };
}
