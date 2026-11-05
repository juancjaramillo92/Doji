/* Eugenia on the laptop — the main process.
   ───────────────────────────────────────────────────────────────────────────
   A third door into her conversation, for when he trades away from home
   without the charm. Her face floats over his charts; the talk key and he
   talks, again and she answers, with Shift and she looks at the chart as
   well. Nothing about her is here: the door is doji-eugenia's, the turn is
   hers, and this file only carries his words and his chart to it and her
   voice back. Gladys's journal comes with her, as it does on the charm: what
   waits is asked of Gladys's door, and his answers carried to it.

   This half owns everything the page may not: the keys, the doors, the window
   it floats in, the talk keys, the chart it captures, the permissions and the
   update. The doors are asked from here rather than from the page because the
   page is a file and the doors allow no browser origin; the keys never reach
   the page at all.
   ═══════════════════════════════════════════════════════════════════════════ */
import {
  app, BrowserWindow, Menu, Tray, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, safeStorage,
  screen, shell, systemPreferences,
} from 'electron';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { BLOB, opacity } from './art.mjs';
import { framer } from './frames.mjs';
import { tap } from './journal.mjs';
import { placed, room } from './place.mjs';
import { swapScript } from './update.mjs';

const DOOR = 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia';
const GLADYS = 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-gladys';
// Each key in its own file, encrypted by the Keychain.
const KEPT = { eugenia: 'key', gladys: 'gladys-key' };
// Published by laptop.yml from main: the zipped app, and its version after it.
const UPDATES = 'https://gujhyogvkzjgnrodyuse.supabase.co/storage/v1/object/public/laptop';

// Her side in points; the window is her ROOM around it.
const SIZES = { Small: 140, Medium: 200, Large: 280 };
/* The talk keys he may choose, by the name the menu shows. Shift added is the
   chart's. Two, because another app can hold the first: the menu says so. */
const KEYS = { '⌥Space': 'Alt+Space', '⌃⌥Space': 'Control+Alt+Space' };
/* The chart's longest side. The model reads an image down to about this
   size anyway, so a larger capture is bytes paid for on every round of the
   turn and seen no better. */
const CHART_PX = 1568;
/* Her door beats every BEAT_MS while she thinks, so two beats missed is a
   line that is dead, not a turn that is long; agree.test.mjs holds the two. */
const READ_MS = 40_000;
// A question with a short answer — the key, whether a briefing waits, the version.
const ASK_MS = 20_000;
// The app is a hundred megabytes and more.
const DOWNLOAD_MS = 10 * 60_000;
/* A capture granted answers in a moment; one not yet granted can be held by
   macOS until it is, so it is asked only long enough to put her in the list
   and open the pane. */
const LOOK_MS = 8_000;
const PROMPT_MS = 1_500;
// Whether a briefing waits, asked every few minutes: the charm's wakings, more often.
const BRIEFING_EVERY_MS = 5 * 60_000;
/* What waits for its journal, asked oftener than the charm can afford to:
   the laptop is awake and online whenever he trades on it, and a trade's
   questions belong to the minute it opened. */
const JOURNAL_EVERY_MS = 60_000;
const UPDATE_EVERY_MS = 24 * 60 * 60_000;
// How often she looks for the cursor, to look at it when it comes near; the page is told only when it has moved.
const CURSOR_MS = 100;
// Her last decisions, kept for him to copy when something looks wrong.
const LOG_LINES = 80;
/* Her desktops set without her Dock icon touched: by default Electron hides
   it or shows it again at every call. */
const SPACES = { skipTransformProcessType: true };
const PANES = {
  mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

const here = import.meta.dirname;
const kept = (name) => join(app.getPath('userData'), name);
// Stamped by the workflow with the commit it built; a copy run from the repository has none and never updates.
const BUILD = existsSync(join(here, 'build.txt')) ? readFileSync(join(here, 'build.txt'), 'utf8').trim() : null;
// Built by `npm run package` (spaces.m); a copy run from the repository has none and floats on every desktop.
const spaces = existsSync(join(here, 'spaces.node')) ? createRequire(import.meta.url)('./spaces.node') : null;

// Her voice starts on a key press, which is no gesture inside the page.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const first = app.requestSingleInstanceLock();
if (!first) app.quit();

let face, tray, keyWindow;
let settings = {};
let fresh = false;     // no settings yet: the first launch
const keys = { eugenia: null, gladys: null };
let keyFor = null;     // whose key the key window asks for
let micOk = true;
let taken = false;     // the talk key is held by another app
let asking = null;     // the request in flight, so a press can hush her
let looking = null;    // the chart being captured since he asked her to look
let waiting = false;   // a briefing waits for him, as her door last said
let hearings = 0;      // briefings heard here, so an ask one overtook is dropped
let offered = null;    // a newer build than this one
let pending = { waiting: 0, trade: null };  // what waits for its journal, as Gladys's door last said
let answering = false; // an answer on its way to Gladys's door
let knocks = 0;        // asks of Gladys's door, so a look an answer overtook is dropped
let pointed = '';      // where the page was last told the cursor is
let updating = false;
const log = [];

/* Her window, while it is there: what answers late — a check, a reply, a
   screen change — can arrive after a quit has destroyed it. */
const present = () => Boolean(face) && !face.isDestroyed();
const send = (channel, ...args) => { if (present()) face.webContents.send(channel, ...args); };
const timers = [];
const note = (what) => {
  log.push(`${new Date().toISOString().slice(11, 23)} ${what}`);
  if (log.length > LOG_LINES) log.shift();
};
const every = (fn, ms) => timers.push(setInterval(fn, ms));
const talkKey = () => (settings.key in KEYS ? settings.key : '⌥Space');

/* ─── What she keeps on the laptop ─────────────────────────────────────────
   The window's size and place, the talk key, and the two keys, hers and
   Gladys's, encrypted by the Keychain. */
function load() {
  fresh = !existsSync(kept('settings.json'));
  try { settings = JSON.parse(readFileSync(kept('settings.json'), 'utf8')); } catch { settings = {}; }
  for (const who of Object.keys(KEPT)) {
    try { keys[who] = safeStorage.decryptString(readFileSync(kept(KEPT[who]))); } catch { keys[who] = null; }
  }
}
const save = () => writeFileSync(kept('settings.json'), JSON.stringify(settings));

/* A key is tried at its door before it is kept, as the charm's setup tries
   one. Hers is asked with an empty form, which her door refuses with a 400
   for a right key — a 503 when the right key finds the door without its
   vendors — and a 401 for a wrong one; Gladys's is asked what waits, which
   her door answers with a 200 for a right key alone. Hers kept and Gladys's
   never given, the window asks for Gladys's next, as the charm's setup asks
   for both. */
async function tryKey(who, candidate) {
  const signal = AbortSignal.timeout(ASK_MS);
  const res = await (who === 'gladys'
    ? fetch(GLADYS, { headers: { 'x-laptop-key': candidate }, signal })
    : fetch(DOOR, { method: 'POST', body: new FormData(), headers: { 'x-laptop-key': candidate }, signal })
  ).catch(() => null);
  if (!res) return 'offline';
  res.body?.cancel();
  if (who === 'gladys' ? res.status !== 200 : res.status !== 400 && res.status !== 503) return 'wrong';
  keys[who] = candidate;
  writeFileSync(kept(KEPT[who]), safeStorage.encryptString(candidate));
  if (who === 'gladys') journal();
  else briefing();
  if (keys.gladys) keyWindow?.close();
  else askForKey('gladys');
  return 'kept';
}

/* One window asks for either key, saying whose. A menu-bar app's window
   opens behind the app he is in unless it takes the front. */
function askForKey(who) {
  app.focus({ steal: true });
  if (keyWindow && keyFor === who) return keyWindow.focus();
  keyFor = who;
  if (!keyWindow) {
    keyWindow = new BrowserWindow({
      width: 420, height: 250, resizable: false, minimizable: false, maximizable: false, title: 'Eugenia',
      webPreferences: { preload: join(here, 'preload.cjs') },
    });
    keyWindow.on('closed', () => { keyWindow = null; });
  }
  keyWindow.loadFile(join(here, 'key.html'), { query: { who } });
  keyWindow.focus();
}

/* ─── The window she floats in ──────────────────────────────────────────────
   An ordinary window, never a panel: Electron's panel adds every desktop to
   whatever it is told, so a panel cannot keep to one. Clicks outside her
   shape go through to the chart — the page says where her shape is. Kept out
   of every capture it can be, so the chart she is shown does not have her in
   it. */
function bounds() {
  const { width, height } = room(SIZES[settings.size] ?? SIZES.Medium);
  return placed({ x: settings.x, y: settings.y, width, height },
    screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea);
}

function float() {
  face = new BrowserWindow({
    ...bounds(),
    transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, fullscreenable: false, acceptFirstMouse: true, show: false,
    // Her ear and her voice keep time on a desktop he is not looking at.
    webPreferences: { preload: join(here, 'preload.cjs'), backgroundThrottling: false },
  });
  // Above the windows of her desktop, and kept to it: a raised window is otherwise one of every desktop.
  face.setAlwaysOnTop(true, 'floating');
  if (spaces) note(`kept to one desktop (${spaces.managed(face.getNativeWindowHandle())})`);
  face.setContentProtection(true);
  face.setIgnoreMouseEvents(true, { forward: true });
  face.loadFile(join(here, 'face.html'));
  face.once('ready-to-show', () => { if (!settings.hidden) bringHere(); });
  // A screen unplugged or rearranged can take her place with it.
  for (const change of ['display-removed', 'display-metrics-changed']) {
    screen.on(change, () => present() && face.setBounds(placed(face.getBounds(),
      screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea)));
  }
}

function resize(name) {
  settings.size = name;
  save();
  face.setBounds(bounds());
  menu();
}

/* She lives on one desktop, as any window does, and macOS moves her with it:
   she slides away when he switches desktops and back when he returns, and
   nothing watches for it. Another app's full-screen desktop is one no
   ordinary window joins, so TradingView is filled rather than full screen.
   To put her on the desktop in front, she joins every desktop for a moment,
   is shown, and leaves them all again — a window that leaves them stays on
   the one it is on. */
function bringHere() {
  settings.hidden = false;
  save();
  face.setVisibleOnAllWorkspaces(true, SPACES);
  face.showInactive();
  face.setVisibleOnAllWorkspaces(false, SPACES);
  note('brought here');
  menu();
}

function hideHer() {
  settings.hidden = true;
  save();
  face.hide();
  note('hidden');
  menu();
}

/* The keys, registered whole or reported: a key another app holds registers
   as nothing, which would read as her not hearing. A press is heard wherever
   he is, and she answers where she is: she does not move for a turn. The
   chart goes only when he asks for it, with Shift — a picture on every
   question is a cost on every answer, and his to choose. */
function bind() {
  globalShortcut.unregisterAll();
  const accelerator = KEYS[talkKey()];
  const talk = globalShortcut.register(accelerator, () => send('press', false));
  const chart = globalShortcut.register(`Shift+${accelerator}`, () => send('press', true));
  taken = !talk || !chart;
  if (taken) send('say', 'taken', talkKey());
  menu();
}

/* Her menu, in the menu bar and on her Dock icon alike: the menu bar's
   icon carries the marks of what waits, the Dock's is where an app is looked
   for. The marks are the charm's sleep screen's — a dot for the briefing, a
   ring for a trade, the dot inside the ring for both. */
function menu() {
  if (!tray) return;
  const name = talkKey(), accelerator = KEYS[name];
  tray.setTitle(pending.waiting ? (waiting ? '◉' : '○') : waiting ? '•' : '');
  const items = () => [
    { label: 'Talk to her', accelerator, registerAccelerator: false, click: () => send('press', false) },
    { label: 'Show her the chart', accelerator: `Shift+${accelerator}`, registerAccelerator: false, click: () => send('press', true) },
    { label: 'Hear the briefing', enabled: waiting, click: () => send('briefing-now') },
    { label: 'Journal the trade', enabled: pending.waiting > 0, click: () => send('journal-now') },
    { type: 'separator' },
    { label: 'Bring her here', click: bringHere },
    ...(settings.hidden ? [] : [{ label: 'Hide her', click: hideHer }]),
    { label: 'Size', submenu: Object.keys(SIZES).map(size => ({
      label: size, type: 'radio', checked: (settings.size ?? 'Medium') === size, click: () => resize(size),
    })) },
    { label: 'Talk key', submenu: Object.keys(KEYS).map(choice => ({
      label: choice, type: 'radio', checked: name === choice, click: () => { settings.key = choice; save(); bind(); },
    })) },
    ...(taken ? [{ label: `${name} is taken by another app`, enabled: false }] : []),
    { label: 'Start with the Mac', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: 'Her key…', click: () => askForKey('eugenia') },
    { label: 'Gladys\'s key…', click: () => askForKey('gladys') },
    { label: 'Restart her', click: () => { app.relaunch(); app.exit(0); } },
    { label: 'Copy her log', click: () => clipboard.writeText([`Eugenia ${BUILD ?? 'from the repository'}`, ...log].join('\n')) },
    { type: 'separator' },
    ...(offered ? [{ label: updating ? 'Updating…' : 'Update her', enabled: !updating, click: update }] : []),
    { label: `Version ${BUILD ?? 'from the repository'}`, enabled: false },
  ];
  tray.setContextMenu(Menu.buildFromTemplate([...items(), { label: 'Quit', role: 'quit' }]));
  app.dock?.setMenu(Menu.buildFromTemplate(items()));
}

/* ─── Her door ──────────────────────────────────────────────────────────────
   One request each time, answered at once with her frames: the voice goes to
   the page as it arrives, so she starts speaking before the rest has come.
   Nothing on the wire for READ_MS is a dead line, said as one rather than
   thought about for ever. A press while she thinks or speaks hushes her; the
   door keeps the turn going, so the copy and the memory still land. True
   when the answer came to its end. */
async function talk(path, body) {
  asking?.abort();
  const abort = asking = new AbortController();
  let idle;
  const alive = () => { clearTimeout(idle); idle = setTimeout(() => abort.abort('silent'), READ_MS); };
  alive();
  try {
    const res = await fetch(`${DOOR}${path}`, {
      method: body ? 'POST' : 'GET', body, headers: { 'x-laptop-key': keys.eugenia ?? '' }, signal: abort.signal,
    });
    if (res.status === 401) { askForKey('eugenia'); return send('trouble', 'key'); }
    if (res.status === 503) return send('trouble', 'voice');
    // Nothing to say: the briefing asked for as midnight passed, or heard on the charm since its dot was drawn.
    if (res.status === 204) { send('done'); return true; }
    if (!res.ok || !res.body) return send('trouble', 'door');
    const feed = framer((kind, bytes) => send('frame', kind, bytes));
    for await (const chunk of res.body) { alive(); feed(chunk); }
    send('done');
    return true;
  } catch {
    if (abort.signal.reason === 'silent') send('trouble', 'lost');
    else if (asking === abort) send('trouble', 'offline');
  } finally {
    clearTimeout(idle);
  }
}

/* A short question can end before its chart is captured, so it waits for it;
   one whose chart could not be captured is not asked, since the page has
   said she could not see. */
async function ask(voice) {
  const wanted = looking !== null, chart = await looking;
  looking = null;
  if (wanted && !Buffer.isBuffer(chart)) return;
  const form = new FormData();
  form.append('voice', new Blob([voice], { type: 'audio/webm' }), 'laptop.webm');
  if (chart) form.append('chart', new Blob([chart], { type: 'image/jpeg' }), 'chart.jpg');
  talk('', form);
}

/* The chart, when he asks her to look: the window whose title names
   TradingView, or else the screen his cursor is on — his chart is what he is
   working, and the app's window title is his to set. Captured at the press,
   beside the listening rather than before it, so it is what he was looking
   at and his first words are not lost to the moment a capture takes.

   Screen Recording is asked first, because without it macOS can hold the
   capture unanswered for ever. Not yet granted, the capture is asked only
   long enough to put her in macOS's list, the pane is opened, and the page
   says what to do; macOS applies the grant only to an app started after it.
   Answers the JPEG, or why there is none. */
async function look() {
  const granted = systemPreferences.getMediaAccessStatus('screen') === 'granted';
  const asked = desktopCapturer.getSources({
    types: ['window', 'screen'], thumbnailSize: { width: CHART_PX, height: CHART_PX },
  }).catch(() => null);
  const sources = await Promise.race([asked, new Promise(r => setTimeout(r, granted ? LOOK_MS : PROMPT_MS, null))]);
  if (!granted) {
    shell.openExternal(PANES.screen);
    return 'screen';
  }
  const display = String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
  const chart = sources?.find(s => s.id.startsWith('window:') && /tradingview/i.test(s.name))
    ?? sources?.find(s => s.id.startsWith('screen:') && s.display_id === display);
  if (!chart || chart.thumbnail.isEmpty()) return 'sight';
  return chart.thumbnail.toJPEG(85);
}

/* The briefing, as the charm has it: a dot beside her and in the menu bar
   while one waits for him. Her door says whether one does — today's, landed,
   and heard whole on neither the charm nor the laptop — so the dot goes when
   he hears it on the charm, at midnight in New York, and stays gone after a
   restart. Asked as ?briefing=waits, whose answer has no voice in it; the
   charm's ready line is spoken, and the dot is the news. An answer that is
   neither leaves the dot as it was, and so does one asked before a briefing
   heard here ended, since it read the door before the door knew.

   The dot goes once the briefing has come to its end, as on the charm: a
   briefing that failed — the line gone, her door's error — leaves it up, to
   be heard again. */
async function briefing() {
  if (!keys.eugenia) return;
  const mine = hearings;
  const res = await fetch(`${DOOR}?briefing=waits`, { headers: { 'x-laptop-key': keys.eugenia }, signal: AbortSignal.timeout(ASK_MS) })
    .catch(() => null);
  if (res?.status !== 200 && res?.status !== 204) return;
  res.body?.cancel();
  if (mine !== hearings || waiting === (res.status === 200)) return;
  waiting = !waiting;
  send('briefing', waiting);
  menu();
}

async function hearBriefing() {
  if (!await talk('?briefing=today')) return;
  hearings++;
  waiting = false;
  send('briefing', false);
  menu();
}

/* ─── Gladys's journal ──────────────────────────────────────────────────────
   Asked of her door as the charm asks it, on the laptop's own key: a GET
   answers what waits, { waiting, trade }, and an answer is a POST in a tap's
   own grammar, answered with what waits after it, so the page moves on
   without a second request. The page draws the questions and says which
   half he clicked; the grammar is journal.mjs's. An answer is never raced:
   no look starts while one is out, and a look one overtook is dropped, since
   it read the row before the answer was written. Answers the trade, or why
   there is none — 'offline', 'key', 'door', or 'stale' for a look dropped. */
async function gladys(body) {
  const mine = ++knocks;
  const res = await fetch(GLADYS, {
    method: body ? 'POST' : 'GET', body, headers: { 'x-laptop-key': keys.gladys ?? '' }, signal: AbortSignal.timeout(ASK_MS),
  }).catch(() => null);
  if (!res) return 'offline';
  if (!res.ok) {
    res.body?.cancel();
    if (res.status !== 401) return 'door';
    keys.gladys = null;
    askForKey('gladys');
    return 'key';
  }
  const { waiting, trade } = await res.json().catch(() => ({}));
  if (!Number.isInteger(waiting)) return 'door';
  if (!body && mine !== knocks) return 'stale';
  pending = { waiting, trade };
  menu();
  return pending;
}

async function journal() {
  if (!keys.gladys || answering) return;
  const got = await gladys();
  if (typeof got !== 'string') send('journal', got.trade, got.waiting);
}

async function answer(id, q, half) {
  answering = true;
  const got = await gladys(JSON.stringify({ data: tap(id, q, half) }));
  answering = false;
  return got;
}

/* ─── Her updates ───────────────────────────────────────────────────────────
   laptop.yml publishes main's build with its version beside it. A newer one
   is offered in the menu, never installed unasked: one click downloads it,
   quits, and the swap left behind puts it in place and opens it. Downloaded
   here rather than by a browser, it carries no quarantine, and signed by the
   same certificate, macOS keeps her permissions. */
async function lookForUpdate() {
  if (!BUILD) return;
  const res = await fetch(`${UPDATES}/version`, { signal: AbortSignal.timeout(ASK_MS) }).catch(() => null);
  const version = res?.ok ? (await res.text()).trim() : null;
  offered = version && version !== BUILD ? version : null;
  menu();
}

async function update() {
  updating = true;
  menu();
  send('say', 'updating');
  const zip = join(app.getPath('temp'), 'eugenia-update.zip');
  try {
    const res = await fetch(`${UPDATES}/Eugenia.zip`, { signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  } catch {
    updating = false;
    menu();
    return send('trouble', 'update');
  }
  const swap = swapScript(process.pid, zip, join(app.getPath('temp'), 'eugenia-update'), resolve(app.getPath('exe'), '../../..'));
  spawn('/bin/sh', ['-c', swap], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

/* Run from Downloads, macOS runs her from a hidden copy her update cannot
   replace; from Applications, she updates and is found. */
async function settle() {
  if (!app.isPackaged || app.isInApplicationsFolder()) return;
  app.focus({ steal: true });
  const { response } = await dialog.showMessageBox({
    message: 'Move Eugenia to Applications?',
    detail: 'She updates herself from there, and macOS keeps her permissions.',
    buttons: ['Move to Applications', 'Not now'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) app.moveToApplicationsFolder();
}

/* Her menu-bar icon: the render cropped close around her, at the menu bar's
   18 points on a Retina screen, its black made clear by the face's own rule.
   The bitmap is premultiplied, which a pixel drawn over black already is:
   only its opacity is set. */
function trayIcon() {
  const side = 36;
  const art = nativeImage.createFromPath(join(here, 'eugenia.png')).crop(BLOB).resize({ width: side, height: side, quality: 'best' });
  const pixels = art.toBitmap();
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = Math.round(255 * opacity(pixels[i], pixels[i + 1], pixels[i + 2]));
  return nativeImage.createFromBitmap(pixels, { width: side, height: side, scaleFactor: 2 });
}

/* ─── What the pages ask of this half ──────────────────────────────────── */
ipcMain.handle('ready', () => ({ fresh, micOk, taken, talk: talkKey(), briefing: waiting, ...pending }));
ipcMain.handle('look', async () => {
  const seen = await (looking = look());
  return typeof seen === 'string' ? seen : null;
});
ipcMain.on('ask', (_, voice) => ask(voice));
ipcMain.on('hush', () => { asking?.abort(); asking = null; looking = null; });
ipcMain.on('briefing', hearBriefing);
ipcMain.handle('answer', (_, id, q, half) => answer(id, q, half));
ipcMain.on('open', (_, pane) => { if (pane in PANES) shell.openExternal(PANES[pane]); });
ipcMain.on('solid', (_, yes) => face.setIgnoreMouseEvents(!yes, { forward: true }));
/* Where he leaves her is written once, when he lets go: a drag moves her a
   step at every movement of the mouse, and a write to the disk at each was
   dozens a second. */
ipcMain.on('drag', (_, dx, dy) => {
  const [x, y] = face.getPosition();
  face.setPosition(x + dx, y + dy);
});
ipcMain.on('dropped', () => { [settings.x, settings.y] = face.getPosition(); save(); });
ipcMain.handle('key', (_, candidate) => tryKey(keyFor, String(candidate).trim()));

// Her pages are files and stay files: no window opens from them, and none navigates away.
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
});

/* Her Dock icon clicked, or the app opened again, is him looking for her: she
   comes to the desktop he is on. Not before her window is made — at the first
   launch it waits on macOS's question about the microphone. */
const found = () => {
  if (!present()) return;
  bringHere();
  send('say', 'here');
};
app.on('activate', found);
app.on('second-instance', found);

app.whenReady().then(async () => {
  if (!first) return;
  load();
  // A companion is there when the Mac is: on by default, his to turn off.
  if (fresh) {
    app.setLoginItemSettings({ openAtLogin: true });
    save();
  }
  micOk = await systemPreferences.askForMediaAccess('microphone');
  if (!micOk) shell.openExternal(PANES.mic);
  // The app's own menu, for its name, Quit, and the Edit menu ⌘V pastes her key through.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
  float();
  tray = new Tray(trayIcon());
  tray.setToolTip('Eugenia');
  bind();
  if (!keys.eugenia) askForKey('eugenia');
  else if (!keys.gladys) askForKey('gladys');
  briefing();
  every(briefing, BRIEFING_EVERY_MS);
  journal();
  every(journal, JOURNAL_EVERY_MS);
  lookForUpdate();
  every(lookForUpdate, UPDATE_EVERY_MS);
  every(() => {
    if (!present() || !face.isVisible()) return;
    const at = screen.getCursorScreenPoint(), { x, y } = face.getBounds();
    if (`${at.x - x},${at.y - y}` === pointed) return;
    pointed = `${at.x - x},${at.y - y}`;
    send('cursor', at.x - x, at.y - y);
  }, CURSOR_MS);
  settle();
});

/* Her clocks stop when she quits. Her window goes first, and a clock
   answering a moment later would meet it destroyed: an exception, whose
   dialog keeps the process and her menu-bar icon alive — and an update waits
   on the process ending before it swaps. */
app.on('before-quit', () => timers.forEach(clearInterval));
app.on('will-quit', () => globalShortcut.unregisterAll());
