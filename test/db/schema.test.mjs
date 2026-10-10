/* ═══════════════════════════════════════════════════════════════════════════
   DOJI — schema.sql on a real Postgres
   ───────────────────────────────────────────────────────────────────────────
   The other suites read the SQL as text. Text cannot show a trigger body that
   fails when it runs (Postgres checks a PL/pgSQL body only on its first call,
   inside the write that fired it), a WHEN clause that never fires, or a re-run
   that leaves the live database different from a fresh one. So this applies
   the file to a throwaway database behind supabase.sql's stand-ins and drives
   every function it declares.

   Its own command, `npm run test:db`, because it needs a Postgres server of
   the major version Supabase runs, with pgvector, named by the standard PG*
   variables and reached as a superuser; `npm test` needs Node alone. CI runs
   both.
   ═══════════════════════════════════════════════════════════════════════════ */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SCHEMA = file('supabase/schema.sql');
const DB = 'doji_test';

// One session per call, stopping at the first error, which is the throw.
function sql(text, db = DB) {
  return execFileSync('psql', ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-d', db],
    { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function build(db, ...files) {
  sql(`drop database if exists ${db} with (force);\ncreate database ${db};`, 'postgres');
  for (const f of [file('test/db/supabase.sql'), ...files]) sql(f, db);
}

/* The schema, plus the jobs, which are rows in cron.job and so data. The
   \restrict lines carry a key pg_dump draws fresh on every run. */
const dump = (db) =>
  execFileSync('pg_dump', ['-s', db], { encoding: 'utf8' }).replace(/^\\(un)?restrict .*$/gm, '') +
  sql('select jobname, schedule, command from cron.job order by jobname', db);

const U = '00000000-0000-0000-0000-00000000000a';
const V = '00000000-0000-0000-0000-00000000000b';
const SECRETS = `insert into vault.decrypted_secrets values
  ('doji_cron_secret', 'cron'), ('eugenia_bot_token', 'bot'), ('telegram_chat_id', '1')
  on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;`;

// Each behaviour starts from no trades, no runs and nothing sent.
const RESET = `truncate public.trades, public.dispatch, public.eugenia_runs, public.eugenia_notes,
  public.eugenia_calendar, net.sent, net._http_response;
  alter sequence net.request_id restart;
  ${SECRETS}`;

// Where each request went: the function's name, or Telegram.
const sent = () => sql(`select string_agg(case when url like 'https://api.telegram.org/%' then 'telegram'
                                          else regexp_replace(url, '^.*/functions/v1/', '') end,
                                     ',' order by url) from net.sent`);

// A position the poller has just seen open.
const trade = (id) => `insert into public.trades (id, user_id, direction, entry_time, entry_price)
  values ('${id}', '${U}', 'BUY', now(), 2400);`;

let fresh;

before(() => {
  build(DB, SCHEMA);
  fresh = dump(DB);
  sql(`alter database ${DB} set track_functions = 'all';`);
  sql(`insert into auth.users values ('${U}'), ('${V}');`);
});

/* ─── The server is the one the live database runs ──────────────────────── */

/* A file that applies cleanly on one major version can refuse on another, so
   a pass here says something about the live database only on its version.
   test.yml's PGCLUSTER is where that version is stated. */
test('the server is the major version Supabase runs', () => {
  const live = file('.github/workflows/test.yml').match(/PGCLUSTER: (\d+)\//)?.[1];
  assert.ok(live, 'test.yml no longer names the cluster the suite runs on');
  assert.equal(String(Math.floor(Number(sql('show server_version_num', 'postgres')) / 10000)), live,
    `this server is not Postgres ${live}, the version Supabase runs`);
});

/* ─── Re-runnable, as CLAUDE.md requires of every statement ─────────────── */

test('a second run of schema.sql changes nothing', () => {
  sql(SCHEMA);
  assert.equal(dump(DB), fresh, 'a re-run of schema.sql leaves a different database than the first run');
});

/* The live database was built by an older copy and then brought forward by
   hand — upgrade.sql, then this one — so it must end where a fresh apply does.
   A default changed inside `create table if not exists`, say, reaches a fresh
   project and never the live one unless upgrade.sql carries it. The older copy
   is main where this branch left it, or main's previous commit on main itself. */
test('applied over what main holds, upgrade.sql and schema.sql leave what a fresh apply leaves', () => {
  let base = git('merge-base', 'HEAD', 'origin/main');
  if (base === git('rev-parse', 'HEAD')) base = git('rev-parse', 'HEAD^');
  build('doji_test_live', git('show', `${base}:supabase/schema.sql`), file('supabase/upgrade.sql'), SCHEMA);
  assert.equal(dump('doji_test_live'), fresh,
    `brought forward from ${base.slice(0, 7)}'s schema.sql, the live database ends where a fresh apply would not`);
});

// On a fresh project too, and a second time: every statement is guarded.
test('upgrade.sql changes nothing a fresh apply built, however often it runs', () => {
  build('doji_test_again', SCHEMA, file('supabase/upgrade.sql'), file('supabase/upgrade.sql'));
  assert.equal(dump('doji_test_again'), fresh, 'upgrade.sql changes a database schema.sql has just built');
});

/* ─── verify.sql asks what schema.sql builds ────────────────────────────── */

test('verify.sql passes every check against the database schema.sql builds', () => {
  sql(SECRETS);
  const rows = sql(file('supabase/verify.sql')).split('\n');
  assert.ok(rows.length > 1, 'verify.sql returned no rows');
  assert.deepEqual(rows.filter(r => !r.endsWith('|t')), [],
    'verify.sql fails against the database schema.sql builds — one of the two files is wrong');
});

/* ─── The trades triggers ───────────────────────────────────────────────── */

test('a position opening reaches Gladys and Eugenia, and the ledger records both', () => {
  sql(RESET + trade('PID1'));
  assert.equal(sent(), 'doji-eugenia,doji-gladys');
  assert.equal(sql(`select string_agg(job, ',' order by job) from public.dispatch`), 'gladys,trade-event');
  assert.equal(sql(`select body->>'event' from net.sent where url like '%doji-eugenia'`), 'opened');

  // A backfill an hour old is not news to Gladys; a row that is not the
  // broker's is not Eugenia's.
  sql(RESET + `insert into public.trades (id, user_id, direction, entry_time)
               values ('PID2', '${U}', 'BUY', now() - interval '2 hours');`);
  assert.equal(sent(), 'doji-eugenia');
  sql(RESET + trade('M1'));
  assert.equal(sent(), 'doji-gladys');
});

test('each journal answer redraws the message, and nothing else does', () => {
  sql(RESET + `insert into public.trades (id, user_id, direction, entry_time, tg_message_id)
               values ('PID3', '${U}', 'BUY', now() - interval '2 hours', 7);`);
  for (const set of ["setup = 'Break & Retest'", 'followed_rules = true',
                     'followed_sl = false', 'followed_tp = true']) {
    sql(`truncate net.sent; update public.trades set ${set} where id = 'PID3';`);
    assert.equal(sent(), 'doji-gladys', `the first answer (${set}) does not redraw the message`);
  }
  for (const set of ['exit_price = 2410', 'net_pnl = 10', 'balance = 500', 'deleted = true']) {
    sql(`truncate net.sent; update public.trades set ${set} where id = 'PID3';`);
    assert.equal(sent(), '', `${set} redraws the message, which draws none of it`);
  }
  sql(`truncate net.sent; update public.trades set tg_message_id = null, deleted = false where id = 'PID3';
       update public.trades set followed_sl = true where id = 'PID3';`);
  assert.equal(sent(), '', 'a row with no message tries to edit one');
});

test('a close reaches Eugenia once, however often the poller re-upserts it', () => {
  sql(RESET + `insert into public.trades (id, user_id, direction, entry_time)
               values ('PID4', '${U}', 'BUY', now() - interval '2 hours');
               truncate net.sent;
               update public.trades set fill_time = now(), exit_price = 2410 where id = 'PID4';`);
  assert.equal(sql(`select string_agg(body->>'event', ',') from net.sent`), 'closed');
  sql(`truncate net.sent; update public.trades set fill_time = now() + interval '1 second' where id = 'PID4';`);
  assert.equal(sent(), '', 'a second write to a closed row tells her it closed again');
});

test('a missing secret costs the message, never the write', () => {
  sql(RESET + `delete from vault.decrypted_secrets where name = 'doji_cron_secret';` + trade('PID5'));
  assert.equal(sql(`select count(*) from public.trades where id = 'PID5'`), '1');
  assert.ok(!sent().includes('doji-gladys'), 'Gladys was called with no secret to present');
});

/* ─── What the app may write ────────────────────────────────────────────── */

test('the app writes its four answers and the soft delete, on its own rows, and nothing else', () => {
  sql(RESET + trade('PID6') + `insert into public.trades (id, user_id, direction) values ('PID7', '${V}', 'BUY');`);
  const as = (stmt) => sql(`set role authenticated; set request.jwt.claim.sub = '${U}'; ${stmt}`);

  as(`update public.trades set setup = 'Support & Resistance', followed_rules = true, followed_sl = false,
        followed_tp = true, deleted = true where id = 'PID6';`);
  assert.equal(sql(`select concat_ws(',', setup, followed_rules, followed_sl, followed_tp, deleted,
                                     updated_at > created_at) from public.trades where id = 'PID6'`),
    'Support & Resistance,t,f,t,t,t');
  as(`update public.trades set deleted = false where id = 'PID6';`);
  assert.equal(sql(`select deleted from public.trades where id = 'PID6'`), 'f', 'a soft delete cannot be undone');

  for (const stmt of [`update public.trades set net_pnl = 1 where id = 'PID6'`,
                      `insert into public.trades (id, user_id) values ('PID8', '${U}')`,
                      `delete from public.trades where id = 'PID6'`]) {
    assert.throws(() => as(stmt), /permission denied/, `the app may: ${stmt}`);
  }

  assert.equal(as(`select count(*) from public.trades where id = 'PID7'`), '0', 'another owner\'s row is visible');
  as(`update public.trades set followed_sl = true where id = 'PID7';`);
  assert.equal(sql(`select followed_sl is null from public.trades where id = 'PID7'`), 't',
    'another owner\'s row was written');
});

/* ─── The restore the README gives ──────────────────────────────────────── */

/* Run as written, over the array a backup holds — PostgREST's `select=*`,
   generated `pnl` included — into a table that lost one row and had another's
   answers wiped. `updated_at` is set by the touch trigger on the repaired row,
   so it is the one column left out of the comparison. The row whose answers
   come back has its Telegram message redrawn to show them; nothing is sent
   that is not an edit of a message that exists. */
test('the README\'s restore puts back every row a backup holds, and sends no new message', () => {
  sql(RESET + `insert into public.trades (id, user_id, direction, entry_time, fill_time, entry_price,
                 exit_price, size_oz, commission, balance, open_day, net_pnl, computed_pnl, setup,
                 followed_rules, followed_sl, followed_tp, deleted, tg_message_id, planned_sl,
                 planned_tp, best_price) values
    ('PID20', '${U}', 'SELL', now() - interval '3 days', now() - interval '3 days' + interval '40 minutes',
     2410.5, 2380.25, 0.5, 0.07, 10123.45, current_date - 3, 15.06, 15.05, 'Break & Retest',
     true, true, false, false, 501, 2420, 2380, 2379.9),
    ('PID21', '${U}', 'BUY', now() - interval '2 days', now() - interval '2 days' + interval '9 minutes',
     2400, 2390, 1, 0.14, 10113.31, current_date - 2, -10.14, -10.14, 'Support & Resistance',
     false, null, true, true, null, 2390, 2425, null);
    truncate net.sent;`);
  const table = () => sql(`select json_agg(to_jsonb(t) - 'updated_at' order by id) from public.trades t`);
  const backup = sql(`select json_agg(t) from public.trades t`);
  const before = table();

  sql(`delete from public.trades where id = 'PID21';
       update public.trades set setup = null, followed_rules = null, deleted = true where id = 'PID20';
       truncate net.sent;`);
  assert.notEqual(table(), before, 'the damage did not change the table');

  const restore = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
    .match(/```sql\n(-- 1\. paste the file's `tables\.trades` array[\s\S]*?)```/)[1];
  sql(restore.replace(`'<<<PASTE ARRAY HERE>>>'`, `$backup$${backup}$backup$`));

  assert.equal(table(), before, 'the restore did not put the table back as the backup held it');
  assert.equal(sql(`select string_agg(concat_ws(':', regexp_replace(url, '^.*/functions/v1/', ''),
                                              body->>'id', body->>'tg_message_id'), ',') from net.sent`),
    'doji-gladys:PID20:501', 'a restore sent something other than the one redraw a restored answer owes');
});

/* ─── The calendar's clock ──────────────────────────────────────────────── */

test('a release changing moves updated_at, and marking it looked at does not', () => {
  sql(RESET + `insert into public.eugenia_calendar (at, name) values (now(), 'CPI');`);
  const moved = (set) => sql(`select updated_at from public.eugenia_calendar;`) !==
    sql(`update public.eugenia_calendar set ${set}; select updated_at from public.eugenia_calendar;`);
  assert.equal(moved('looked_at = now()'), false, 'a mark moved updated_at');
  assert.equal(moved(`actual = '0.3%'`), true, 'a new actual did not move updated_at');
});

/* ─── The dispatch watcher, on a planted clock ──────────────────────────── */

const T = `'2026-10-07 17:00+00'::timestamptz`;
const planted = (rows) => `insert into public.dispatch (id, job, at) values ${rows.map(([id, job, ago]) =>
  `(${id}, '${job}', ${T} - interval '${ago} minutes')`).join(', ')};`;
const answered = (rows) => `insert into net._http_response (id, status_code, timed_out) values ${rows.map(([id, code]) =>
  `(${id}, ${code}, false)`).join(', ')};`;

test('the dispatch watcher reports a lost one-shot once, and settles it when the report lands', () => {
  sql(RESET + `alter sequence net.request_id restart with 100;` +
      planted([[1, 'gladys', 20], [2, 'poller', 20], [3, 'eugenia', 20], [4, 'gladys', 5]]) +
      answered([[1, 500], [2, 500], [3, 200]]));

  assert.equal(sql(`select public.dispatch_watch(${T})`), '1');
  const told = sql(`select body->>'text' from net.sent`);
  assert.match(told, /gladys at \d\d:\d\d — HTTP 500/);
  assert.doesNotMatch(told, /poller/, 'one lost poll was reported; the next one heals it');
  assert.equal(sql(`select string_agg(concat_ws(':', id, settled, reported_by), ',' order by id) from public.dispatch`),
    '1:f:100,2:t,3:t,4:f', 'the sweep marked the wrong rows');

  assert.equal(sql(`select public.dispatch_watch(${T})`), '0', 'a failure in flight to him was said again');
  sql(answered([[100, 200]]));
  sql(`select public.dispatch_watch(${T})`);
  assert.equal(sql(`select settled from public.dispatch where id = 1`), 't', 'a delivered report did not settle its row');
});

test('a poll lost three times in an hour is reported', () => {
  sql(RESET + planted([[1, 'poller', 50], [2, 'poller', 40], [3, 'poller', 20]]) +
      answered([[1, 500], [2, 500], [3, 500]]));
  assert.equal(sql(`select public.dispatch_watch(${T})`), '3');
  assert.equal(sent(), 'telegram', 'three failures went out as more than one message');
  assert.match(sql(`select body->>'text' from net.sent`), /poller/);
});

/* ─── The pace watcher, on a planted clock ──────────────────────────────── */

// Wednesday 7 October 2026 in New York, and the Sunday before it.
const NY = (wall) => `'${wall} America/New_York'::timestamptz`;

test('pace_line names a briefing the day owed and a run near the wall clock, and nothing else', () => {
  const line = (wall) => sql(`select public.pace_line(${NY(wall)})`);

  sql(RESET);
  assert.equal(line('2026-10-07 11:00'), '', 'a briefing still inside its retry window was reported missing');
  assert.match(line('2026-10-07 13:00'), /^No weekday briefing landed today/);
  assert.equal(line('2026-10-04 20:00'), '');
  assert.match(line('2026-10-04 21:00'), /^No Sunday open briefing landed today/);

  sql(`insert into public.eugenia_runs (caller, at) values ('weekday briefing delivered', ${NY('2026-10-07 08:05')});`);
  assert.equal(line('2026-10-07 13:00'), '');

  sql(`insert into public.eugenia_runs (caller, at, ms) values ('weekday briefing', ${NY('2026-10-07 08:00')}, 290000);`);
  assert.equal(line('2026-10-07 13:00'), '', 'a run under three-quarters of the ceiling was reported');
  sql(`insert into public.eugenia_runs (caller, at, ms) values ('weekday briefing', ${NY('2026-10-07 09:00')}, 310000);`);
  assert.match(line('2026-10-07 13:00'), /^Longest run in the last seven days: weekday briefing, 310s against the worker's 400s ceiling/);
});

/* On the real clock: the row pace_watch writes is stamped now(), and its
   once-a-day guard reads that stamp. Both briefings delivered today, so only
   the planted slow run can be a finding, whatever day the suite runs on. */
test('pace_watch says a finding once a day, and writes no row for a message it could not send', () => {
  const DELIVERED = `insert into public.eugenia_runs (caller) values
    ('weekday briefing delivered'), ('sunday briefing delivered');`;
  const SLOW = `insert into public.eugenia_runs (caller, at, ms)
    values ('weekday briefing', now() - interval '1 hour', 310000);`;
  const watch = () => sql('select public.pace_watch()');
  const pace = () => sql(`select string_agg(ok::text, ',' order by id) from public.eugenia_runs where caller = 'pace'`);

  sql(RESET + DELIVERED + SLOW + `delete from vault.decrypted_secrets where name = 'eugenia_bot_token';`);
  assert.equal(watch(), '');
  assert.equal(pace(), '', 'a warning that was never sent was recorded as said');

  sql(SECRETS);
  assert.match(watch(), /^Longest run in the last seven days/);
  assert.equal(watch(), '', 'the same finding was said twice');
  assert.equal(pace(), 'false');
  assert.equal(sent(), 'telegram');

  sql(RESET + DELIVERED);
  watch(); watch();
  assert.equal(pace(), 'true', 'a quiet day did not leave exactly one row');
});

/* ─── Her search ────────────────────────────────────────────────────────── */

test('her search finds a note by its words, by a near spelling, and by its vector', () => {
  const vec = (x) => `[${Array(1536).fill(0).map((_, i) => i === x ? 1 : 0).join(',')}]`;
  sql(RESET + `insert into public.eugenia_notes (note, embedding) values
    ('He waits for the London open before taking a breakout', '${vec(0)}'),
    ('Sizes down after two losses in a row', '${vec(1)}');`);
  const top = (q, qv = null) => sql(`select body from public.eugenia_search('${q}', 1${qv ? `, '${qv}'` : ''})`);

  assert.match(top('London open'), /London open/);
  assert.match(top('Londn'), /London open/, 'the trigram arm missed a near spelling');
  assert.match(top('nothing alike', vec(1)), /two losses/, 'the semantic arm missed its nearest note');
});

/* ─── Every job, and every function ─────────────────────────────────────── */

test('every scheduled job runs its command without an error', () => {
  sql(RESET);
  for (const name of sql('select jobname from cron.job order by jobname').split('\n')) {
    const command = sql(`select command from cron.job where jobname = '${name}'`);
    assert.doesNotThrow(() => sql(`begin;\n${command}\nrollback;`), `the ${name} job fails when it runs`);
  }
});

/* Last, because it reads what the tests above called. PL/pgSQL only, since
   that is the language whose body Postgres resolves on first call rather than
   when the file is applied; a SQL function's body is checked by the apply, and
   is inlined where it is called, so it would never be counted. Postgres counts
   every call under track_functions, so a PL/pgSQL function schema.sql gains is
   a failure here until a test drives it — the check notices a new sibling. */
test('every PL/pgSQL function schema.sql declares was run by a test above', () => {
  const declared = sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         join pg_language l on l.oid = p.prolang
                         where n.nspname = 'public' and l.lanname = 'plpgsql'
                         order by 1`).split('\n');
  const called = sql(`select funcname from pg_stat_user_functions where schemaname = 'public' and calls > 0`).split('\n');
  assert.ok(declared.length > 5, 'the function census found nothing to count');
  assert.deepEqual(declared.filter(f => !called.includes(f)), [], 'declared and never run by this suite');
});
