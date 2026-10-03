/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — sandbox for doji_gmail_sync.gs
   ───────────────────────────────────────────────────────────────────────────
   GmailApp needs a live mailbox; the rest does not. parseAlert_ is a pure
   function of a subject and an HTML body, sendFill_ of one HTTP response, and
   syncPepperstone a loop over threads — all reachable once the four Google
   globals exist. The file has no top-level calls, so evaluating it in a vm
   context runs nothing and leaves every function on that context.

   The stubs RECORD rather than merely satisfy: what is tested about
   syncPepperstone is which label a thread ends up with, and a stub that forgot
   addLabel could not tell a retry from a permanent failure.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exported so a test can assert on what the file SAYS: a stub that returns null
// for every unknown property answers "no password here" whatever the script does.
export const SOURCE = readFileSync(new URL('../doji_gmail_sync.gs', import.meta.url), 'utf8');

// A Gmail thread as the script uses one: messages in, a label out. `labels` is
// what every assertion about the three outcomes reads.
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

/* `responses` is what UrlFetchApp hands back, one per call — { code, text }, or
   an Error to throw, which is a network failure with no response at all.
   `existingLabels` matters because getOrCreateLabel_ and resetDojiLabels both
   branch on a label being absent. */
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
        // A call the test did not describe cannot be one it asserts about. Answering
        // it 200 makes "sent one fill" and "sent four" identical from the labels.
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
