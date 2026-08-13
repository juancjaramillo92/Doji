/**
 * DOJI ↔ PEPPERSTONE (cTrader) EMAIL SYNC
 * ─────────────────────────────────────────────────────────────────────────
 * Runs in your own Google account. Every minute it finds unprocessed cTrader
 * alerts, parses the fill, and merges TWO VALUES into `trades`:
 *
 *   net_pnl  — includes swap, which get_deals does not report
 *   balance  — account balance after the fill
 *
 * plus fill_time, which is the filing-day fallback for a position the MCP
 * poller never reached, and direction, which is the only source for one.
 *
 * That is the whole job. Everything else about a trade — entry time, entry and
 * exit price, commission, the New York filing day, the computed P&L — belongs
 * to the poller, and this script does not name those columns, so it cannot
 * overwrite them. It equally never names setup, session, the discipline
 * answers or `deleted`, so it cannot touch the journal.
 *
 * These alerts are also the early warning if the cTrader MCP token is ever
 * misused, so leave the notifications switched on regardless.
 *
 * SETUP
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties:
 *        DOJI_EMAIL     your Supabase login email
 *        DOJI_PASSWORD  your Supabase login password
 *      Never put the password in this file. It ends up in version history, in
 *      screenshots, and in anything the file is ever pasted into.
 *   3. Run `testLogin`  → confirm sign-in works.
 *   4. Run `testParse`  → check the logged fields. Writes nothing.
 *   5. Run `syncPepperstone` once by hand → confirm a row moved in Supabase.
 *   6. Triggers → syncPepperstone · Time-driven · Minutes · Every minute.
 */

// No secret key: Supabase's sb_secret_ keys reject any client whose User-Agent
// looks like a browser, and Apps Script's does with no way to change it. So the
// script signs in as YOU and writes as an authenticated user, which the RLS
// policy allows — and which also fills user_id from its auth.uid() default on
// any row this script creates first.
var SUPABASE_URL    = 'https://gujhyogvkzjgnrodyuse.supabase.co';
var PUBLISHABLE_KEY = 'sb_publishable_qDYX9YI-F8zrTYs0Vw5nhA_gNuYWsyL';

function creds_() {
  var p = PropertiesService.getScriptProperties();
  var email = p.getProperty('DOJI_EMAIL');
  var pass  = p.getProperty('DOJI_PASSWORD');
  if (!email || !pass) {
    throw new Error('Set DOJI_EMAIL and DOJI_PASSWORD in Project Settings → Script Properties.');
  }
  return { email: email, password: pass };
}

var ALERT_FROM = 'trade@alerts.ctrader.com';
var DONE_LABEL = 'doji-synced';
var FAIL_LABEL = 'doji-parse-failed';

// 90 days rather than 30. The label is what stops a message being re-read, so
// the window only has to be wider than the longest plausible outage — and it is
// what bounds resetDojiLabels(), the repair path, which at 30 days could not
// reach anything worth repairing.
var GMAIL_QUERY = 'from:' + ALERT_FROM + ' -label:' + DONE_LABEL +
                  ' -label:' + FAIL_LABEL + ' newer_than:90d';

// The only columns this script may write. Enforced in upsertFill_ rather than
// trusted to the parser: a stray key here would overwrite the poller's data
// with whatever the closing email happened to know.
var EMAIL_OWNED = ['id', 'direction', 'fill_time', 'net_pnl', 'balance'];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN — attach the every-minute trigger to this
// ═══════════════════════════════════════════════════════════════════════════
function syncPepperstone() {
  var done = getOrCreateLabel_(DONE_LABEL);
  var fail = getOrCreateLabel_(FAIL_LABEL);
  var threads = GmailApp.search(GMAIL_QUERY, 0, 20);

  threads.forEach(function (thread) {
    // Three outcomes, not two. A PARSE failure is permanent and earns the fail
    // label so the thread leaves the queue. An UPSERT failure is transient —
    // a Supabase blip, an expired session, no network — and must leave the
    // thread UNLABELLED so the next run retries it. Labelling those the same
    // way is how a momentary outage used to discard a fill's net_pnl and
    // balance forever.
    var parseFailed = false, writeFailed = false;

    thread.getMessages().forEach(function (msg) {
      var subject = msg.getSubject() || '';
      // Only closed-trade alerts carry a position id and a P&L. Anything else
      // from this sender — a margin notice — is skipped without failing.
      if (!/filled for/i.test(subject)) return;

      var fill = parseAlert_(subject, msg.getBody());
      if (!fill) {
        parseFailed = true;
        Logger.log('PARSE FAILED: ' + subject + ' (' + msg.getDate() + ')');
        return;
      }
      if (!upsertFill_(fill)) writeFailed = true;
    });

    if (writeFailed) return;                        // no label — retried next run
    thread.addLabel(parseFailed ? fail : done);
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
// PARSER — HTML body → a trades row
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

  // The email states UTC explicitly, and the Z is what makes that stick.
  // Dropping it lets the runtime read the string in its own timezone, which is
  // how evening trades used to land on the wrong day.
  var fillTime = (function () {
    var raw = grab('Fill time') || grab('Filled time') || grab('Time') || '';
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
    balance:   num(grab('Current balance') || grab('Balance'))
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPABASE UPSERT
// ───────────────────────────────────────────────────────────────────────────
// merge-duplicates, not ignore-duplicates. With two writers, ignoring meant
// that whenever the poller created the row first — entirely possible, it runs
// every two minutes — PostgREST silently DISCARDED this row and still returned
// 2xx. net_pnl and balance were lost, this function reported success, and the
// thread was labelled synced: a failure that looks exactly like a success.
//
// Two guards make the merge safe:
//   · only EMAIL_OWNED keys are sent, so no other column is ever targeted;
//   · null and empty values are stripped, because PostgREST writes exactly the
//     keys present — sending direction:null would erase a correct direction.
// ═══════════════════════════════════════════════════════════════════════════
function upsertFill_(fill) {
  var payload = {};
  EMAIL_OWNED.forEach(function (k) {
    if (fill[k] !== null && fill[k] !== undefined && fill[k] !== '') payload[k] = fill[k];
  });
  if (!payload.id) { Logger.log('UPSERT SKIPPED: no id'); return false; }

  var res = postFill_(payload);
  if (res && res.getResponseCode() === 401) {
    clearSession_();                       // stale cached session — retry once
    res = postFill_(payload);
  }
  if (!res) return false;

  var code = res.getResponseCode();
  var ok = code >= 200 && code < 300;
  if (!ok) Logger.log('UPSERT FAILED ' + code + ': ' + res.getContentText());
  return ok;
}

function postFill_(payload) {
  var token = getAccessToken_();
  if (!token) { Logger.log('UPSERT SKIPPED: could not sign in.'); return null; }
  return UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/trades?on_conflict=id', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + token,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify([payload]),
    muteHttpExceptions: true
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH — sign in once, cache the session, refresh near expiry. Runs every
// minute without minting a new session each time.
// ═══════════════════════════════════════════════════════════════════════════
function getAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('sb_access_token');
  var exp   = Number(props.getProperty('sb_expires_at') || 0);
  if (token && Math.floor(Date.now() / 1000) < exp - 60) return token;

  var refresh = props.getProperty('sb_refresh_token');
  if (refresh) {
    var r = authRequest_('grant_type=refresh_token', { refresh_token: refresh });
    if (r) return r;
  }
  var c = creds_();
  return authRequest_('grant_type=password', { email: c.email, password: c.password });
}

function authRequest_(grant, payload) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/auth/v1/token?' + grant, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: PUBLISHABLE_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    // Does not log the response body — it can echo credentials.
    Logger.log('AUTH ' + grant + ' failed ' + res.getResponseCode());
    return null;
  }
  var data  = JSON.parse(res.getContentText());
  var props = PropertiesService.getScriptProperties();
  props.setProperty('sb_access_token',  data.access_token);
  props.setProperty('sb_refresh_token', data.refresh_token || '');
  props.setProperty('sb_expires_at',    String(Math.floor(Date.now() / 1000) + (data.expires_in || 3600)));
  return data.access_token;
}

function clearSession_() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('sb_access_token');
  props.deleteProperty('sb_refresh_token');
  props.deleteProperty('sb_expires_at');
}

function testLogin() {
  clearSession_();
  Logger.log(getAccessToken_() ? '✓ Signed in.' : '✗ Sign-in failed — check Script Properties.');
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
