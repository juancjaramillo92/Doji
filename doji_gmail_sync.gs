/**
 * DOJI ↔ PEPPERSTONE (cTrader) EMAIL SYNC
 * ─────────────────────────────────────────────────────────────────────────
 * Runs in your own Google account. Every minute it finds unprocessed cTrader
 * alerts, parses the fill, and posts it to the doji-email-sync Edge Function,
 * which merges FOUR VALUES into `trades`:
 *
 *   net_pnl    includes swap, which get_deals does not report
 *   balance    the account after the fill
 *   fill_time  the filing-day fallback for a position the poller never reached
 *   direction  the only source for one the poller never reached
 *
 * That is the whole job. Everything else about a trade — entry time, entry and
 * exit price, commission, the New York filing day, the computed P&L — belongs
 * to the poller, and the Edge Function will not accept those columns from here.
 *
 * THIS SCRIPT HOLDS NO ACCOUNT CREDENTIALS. It used to sign in as you, with
 * your Supabase email and password in Script Properties, because Supabase's
 * secret keys reject any client whose user agent looks like a browser and Apps
 * Script's does. The write moved behind an Edge Function instead: what lives
 * here now is one secret whose entire authority is those five columns. If this
 * script is ever compromised, that is the whole of what is lost.
 *
 * These alerts are also the early warning if the cTrader MCP token is ever
 * misused, so leave the notifications switched on regardless.
 *
 * SETUP
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties:
 *        DOJI_EMAIL_SECRET   the same value set as DOJI_EMAIL_SECRET in the
 *                            Supabase Edge Function secrets
 *      Never put it in this file. It ends up in version history, in
 *      screenshots, and in anything the file is ever pasted into.
 *   3. Run `testParse`  → check the logged fields. Writes nothing.
 *   4. Run `testSecret` → confirms the function accepts the secret. Writes
 *      nothing: it deliberately sends a fill that cannot be valid.
 *   5. Run `syncPepperstone` once by hand → confirm a row moved in Supabase.
 *   6. Triggers → syncPepperstone · Time-driven · Minutes · Every minute.
 */

var SYNC_URL = 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-email-sync';

function secret_() {
  var s = PropertiesService.getScriptProperties().getProperty('DOJI_EMAIL_SECRET');
  if (!s) {
    throw new Error('Set DOJI_EMAIL_SECRET in Project Settings → Script Properties.');
  }
  return s;
}

var ALERT_FROM = 'trade@alerts.ctrader.com';
var DONE_LABEL = 'doji-synced';
var FAIL_LABEL = 'doji-parse-failed';

// 90 days rather than 30. The label is what stops a message being re-read, so
// the window only has to be wider than the longest plausible outage — and it is
// also the reach of the repair path: resetDojiLabels() strips the labels, and
// this is what decides how far back the next run then re-reads. At 30 days that
// could not reach anything worth repairing.
var GMAIL_QUERY = 'from:' + ALERT_FROM + ' -label:' + DONE_LABEL +
                  ' -label:' + FAIL_LABEL + ' newer_than:90d';

// ═══════════════════════════════════════════════════════════════════════════
// MAIN — attach the every-minute trigger to this
// ═══════════════════════════════════════════════════════════════════════════
function syncPepperstone() {
  var done = getOrCreateLabel_(DONE_LABEL);
  var fail = getOrCreateLabel_(FAIL_LABEL);
  var threads = GmailApp.search(GMAIL_QUERY, 0, 20);

  threads.forEach(function (thread) {
    // Three outcomes, not two. A PERMANENT failure — this body will never parse,
    // or the function refused the fill it produced — earns the fail label so the
    // thread leaves the queue. A TRANSIENT one — a Supabase blip, no network, a
    // cold start — must leave the thread UNLABELLED so the next run retries it.
    // Labelling those the same way is how a momentary outage used to discard a
    // fill's net_pnl and balance forever.
    var permanent = false, transient = false;

    thread.getMessages().forEach(function (msg) {
      var subject = msg.getSubject() || '';
      // Only closed-trade alerts carry a position id and a P&L. Anything else
      // from this sender — a margin notice — is skipped, and the thread ends up
      // labelled synced: nothing was written, but nothing ever will be, and the
      // label is what stops it being read again every minute for ninety days.
      if (!/filled for/i.test(subject)) return;

      var fill = parseAlert_(subject, msg.getBody());
      if (!fill) {
        permanent = true;
        Logger.log('PARSE FAILED: ' + subject + ' (' + msg.getDate() + ')');
        return;
      }

      var outcome = sendFill_(fill);
      if (outcome === 'rejected') permanent = true;
      else if (outcome === 'retry') transient = true;
    });

    if (transient) return;                          // no label — retried next run
    thread.addLabel(permanent ? fail : done);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST — run this first. Parses your newest alert and logs it. Writes nothing.
// ═══════════════════════════════════════════════════════════════════════════
function testParse() {
  var threads = GmailApp.search('from:' + ALERT_FROM + ' subject:"filled for"', 0, 1);
  if (!threads.length) { Logger.log('No cTrader alert emails found.'); return; }
  var msgs = threads[0].getMessages();
  var msg  = msgs[msgs.length - 1];
  Logger.log('SUBJECT: ' + msg.getSubject());
  var fill = parseAlert_(msg.getSubject(), msg.getBody());
  Logger.log(fill ? JSON.stringify(fill, null, 2) : '✗ PARSE FAILED');
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST — confirms the secret is right without writing anything.
// ───────────────────────────────────────────────────────────────────────────
// It sends a body the function cannot accept, so the two answers separate
// cleanly: 401 means the secret is wrong, 400 means the secret was accepted and
// the fill was refused — which is the whole of what is being checked here.
// ═══════════════════════════════════════════════════════════════════════════
function testSecret() {
  var res = post_({});
  var code = res.getResponseCode();
  if (code === 400) Logger.log('✓ Secret accepted. (' + res.getContentText() + ')');
  else if (code === 401) Logger.log('✗ Secret rejected — check DOJI_EMAIL_SECRET on both sides.');
  else Logger.log('? Unexpected ' + code + ': ' + res.getContentText());
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER — HTML body → a fill
// ═══════════════════════════════════════════════════════════════════════════
function parseAlert_(subject, htmlBody) {
  var text = htmlBody
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|tr|p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ');

  // Labels are escaped before going into the pattern: "Gross P&L" has no regex
  // metacharacters today, but a label added later that does would otherwise
  // change what this matches rather than failing visibly.
  function grab(label) {
    var safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var m = text.match(new RegExp(safe + '\\s*:?\\s*\\n?\\s*([^\\n]+)', 'i'));
    return m ? m[1].trim() : null;
  }
  function num(s) {
    if (s == null) return null;
    var m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  var m = text.match(/\bPID\d+\b/);
  var positionId = m ? m[0] : null;
  if (!positionId) return null;

  // The POSITION side, not the closing order's. Confirmed against 21 fills the
  // poller never reached, whose direction the app renders correctly with no
  // other source to correct them.
  var direction = (function () {
    var d = grab('Direction') || '';
    if (/sell/i.test(d)) return 'SELL';
    if (/buy/i.test(d))  return 'BUY';
    return null;
  })();

  // DAY FIRST. cTrader sends `19/08/2026 20:22:55 (UTC)`, which is the 19th of
  // August — and the saved fixture is the only thing that says so, because a
  // day above twelve is the only way the two readings differ visibly. Read as
  // month-first, every fill on the 1st to the 12th would be filed in the wrong
  // month and nothing anywhere would report it. A test pins the ambiguous case.
  //
  // The email states UTC explicitly, and the Z is what makes that stick.
  // Dropping it lets the runtime read the string in its own timezone, which is
  // how evening trades used to land on the wrong day.
  //
  // ONE LABEL, not a list of guesses at one. If cTrader renames the field the
  // fill is refused, the thread is labelled doji-parse-failed and the subject is
  // logged — a loud failure with a repair path. An alias nobody has ever seen
  // trades that for the chance of reading some other line as the fill time,
  // which would file the trade on the wrong day silently.
  var fillTime = (function () {
    var raw = grab('Fill time') || '';
    var a = raw.match(/(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (a) return a[3] + '-' + a[2] + '-' + a[1] + 'T' + a[4] + ':' + a[5] + ':' + a[6] + 'Z';
    var b = raw.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (b) return b[1] + '-' + b[2] + '-' + b[3] + 'T' + b[4] + ':' + b[5] + ':' + b[6] + 'Z';
    return null;
  })();

  if (!direction || !fillTime) return null;

  return {
    id:        positionId,
    direction: direction,
    // The CLOSING instant — the email carries no entry data at all. The app
    // uses it as the filing-day fallback for a row the poller never folded.
    fill_time: fillTime,
    net_pnl:   num(grab('Net P&L')),
    balance:   num(grab('Current balance'))
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND — hand the fill to doji-email-sync, which owns the write
// ───────────────────────────────────────────────────────────────────────────
// Three outcomes rather than a boolean, because the caller has three things to
// do with them. The column whitelist, the shape checks and the merge live in
// the function now, where they are covered by test/fold.test.mjs — this end
// parses and forwards, and nothing here can name a column at all.
// ═══════════════════════════════════════════════════════════════════════════
function sendFill_(fill) {
  var res;
  try {
    res = post_(fill);
  } catch (e) {
    Logger.log('SEND FAILED (network): ' + e);   // no response at all
    return 'retry';
  }

  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return 'ok';

  // 400 is the function saying this fill is not acceptable and never will be —
  // retrying it every minute for ninety days would be the only alternative.
  if (code === 400) {
    Logger.log('FILL REFUSED ' + fill.id + ': ' + res.getContentText());
    return 'rejected';
  }

  Logger.log('SEND FAILED ' + code + ': ' + res.getContentText());
  return 'retry';
}

function post_(payload) {
  return UrlFetchApp.fetch(SYNC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-doji-key': secret_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ═══════════════════════════════════════════════════════════════════════════
// RECOVERY — strip the doji labels so every alert in the window is re-read.
// The merge is idempotent, so this is safe to run at any time.
// ═══════════════════════════════════════════════════════════════════════════
function resetDojiLabels() {
  [DONE_LABEL, FAIL_LABEL].forEach(function (name) {
    var l = GmailApp.getUserLabelByName(name);
    if (!l) return;
    l.getThreads().forEach(function (t) { t.removeLabel(l); });
  });
  Logger.log('Labels cleared — run syncPepperstone now.');
}
