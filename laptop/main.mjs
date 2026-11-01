/* Eugenia on the laptop — the main process.
   ───────────────────────────────────────────────────────────────────────────
   A third door into her conversation, for when he trades away from home
   without the charm. Her face floats over his charts; the talk key and he
   talks, again and she answers, with Shift and she looks at the chart as
   well. Nothing about her is here: the door is doji-eugenia's, the turn is
   hers, and this file only carries his words and his chart to it and her
   voice back.

   This half owns everything the page may not: the key, the door, the window
   it floats in, the keys, the chart it captures, the permissions and the
   update. The door is asked from here rather than from the page because the
   page is a file and the door allows no browser origin; the key never reaches
   the page at all.
   ═══════════════════════════════════════════════════════════════════════════ */
import {
  app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, safeStorage,
  screen, shell, systemPreferences,
} from 'electron';
import { Buffer } from 'node:buffer';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { framer } from './frames.mjs';
import { placed, room } from './place.mjs';
import { swapScript } from './update.mjs';

const DOOR = 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia';
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
// A question with a short answer — the key, the briefing, the version.
const ASK_MS = 20_000;
// The app is a hundred megabytes and more.
const DOWNLOAD_MS = 10 * 60_000;
/* A capture granted answers in a moment; one not yet granted can be held by
   macOS until it is, so it is asked only long enough to put her in the list
   and open the pane. */
const LOOK_MS = 8_000;
const PROMPT_MS = 1_500;
// The briefing is asked after the way the charm asks it: every few minutes until it lands.
const BRIEFING_EVERY_MS = 5 * 60_000;
const UPDATE_EVERY_MS = 24 * 60 * 60_000;
// How often she looks for the cursor, to look at it when it comes near.
const CURSOR_MS = 100;
/* Where she shows: beside TradingView alone — in front, full screen or not,
   on whichever desktop it is — or on every desktop. He switches desktops all
   day and wants her only over the chart. */
const WHERE = { 'With TradingView': 'tradingview', Everywhere: 'everywhere' };
const TRADINGVIEW = /tradingview/i;
// How often she asks which app is in front: half a second is a switch she follows.
const FRONT_MS = 500;
const PANES = {
  mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

const here = import.meta.dirname;
const kept = (name) => join(app.getPath('userData'), name);
// Stamped by the workflow with the commit it built; a copy run from the repository has none and never updates.
const BUILD = existsSync(join(here, 'build.txt')) ? readFileSync(join(here, 'build.txt'), 'utf8').trim() : null;

// Her voice starts on a key press, which is no gesture inside the page.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const first = app.requestSingleInstanceLock();
if (!first) app.quit();

let face, tray, keyWindow;
let settings = {};
let fresh = false;     // no settings yet: the first launch
let key = null;
let micOk = true;
let taken = false;     // the talk key is held by another app
let asking = null;     // the request in flight, so a press can hush her
let looking = null;    // the chart being captured since he asked her to look
let waiting = null;    // the New York date a landed briefing waits for him on
let heard = null;      // the New York date he heard it
let offered = null;    // a newer build than this one
let updating = false;
let beside = true;     // TradingView in front, or which app is in front not knowable
let busy = false;      // she is listening, thinking, speaking or saying something

const nyDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const send = (channel, ...args) => face?.webContents.send(channel, ...args);
const talkKey = () => (settings.key in KEYS ? settings.key : '⌥Space');

/* ─── What she keeps on the laptop ─────────────────────────────────────────
   The window's size and place, the talk key, and her key, encrypted by the
   Keychain. */
function load() {
  fresh = !existsSync(kept('settings.json'));
  try { settings = JSON.parse(readFileSync(kept('settings.json'), 'utf8')); } catch { settings = {}; }
  try { key = safeStorage.decryptString(readFileSync(kept('key'))); } catch { key = null; }
}
const save = () => writeFileSync(kept('settings.json'), JSON.stringify(settings));

/* A key is tried before it is kept, as the charm's setup tries one: an empty
   form, which her door refuses with a 400 for a right key — a 503 when the
   right key finds the door without its vendors — and a 401 for a wrong one. */
async function tryKey(candidate) {
  const res = await fetch(DOOR, {
    method: 'POST', body: new FormData(), headers: { 'x-laptop-key': candidate }, signal: AbortSignal.timeout(ASK_MS),
  }).catch(() => null);
  if (!res) return 'offline';
  if (res.status !== 400 && res.status !== 503) return 'wrong';
  key = candidate;
  writeFileSync(kept('key'), safeStorage.encryptString(key));
  keyWindow?.close();
  briefing();
  return 'kept';
}

// A menu-bar app's window opens behind the app he is in unless it takes the front.
function askForKey() {
  app.focus({ steal: true });
  if (keyWindow) return keyWindow.focus();
  keyWindow = new BrowserWindow({
    width: 420, height: 250, resizable: false, minimizable: false, maximizable: false, title: 'Eugenia',
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  keyWindow.on('closed', () => { keyWindow = null; });
  keyWindow.loadFile(join(here, 'key.html'));
}

/* ─── The window she floats in ──────────────────────────────────────────────
   A panel: it floats over full-screen apps and a click on her does not take
   the focus from TradingView. Clicks outside her shape go through to it — the
   page says where her shape is. Kept out of every capture it can be, so the
   chart she is shown does not have her in it. */
function bounds() {
  const { width, height } = room(SIZES[settings.size] ?? SIZES.Medium);
  return placed({ x: settings.x, y: settings.y, width, height },
    screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea);
}

function float() {
  face = new BrowserWindow({
    ...bounds(),
    type: 'panel', transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, fullscreenable: false, acceptFirstMouse: true,
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  face.setAlwaysOnTop(true, 'screen-saver');
  face.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  face.setContentProtection(true);
  face.setIgnoreMouseEvents(true, { forward: true });
  face.on('moved', () => { [settings.x, settings.y] = face.getPosition(); save(); });
  face.loadFile(join(here, 'face.html'));
  // A screen unplugged or rearranged can take her place with it.
  for (const change of ['display-removed', 'display-metrics-changed']) {
    screen.on(change, () => face.setBounds(placed(face.getBounds(),
      screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea)));
  }
}

function resize(name) {
  settings.size = name;
  save();
  face.setBounds(bounds());
  menu();
}

/* Whether she shows: not if he hid her; else while she is busy, wherever he
   is; else beside TradingView, or everywhere if he asked for that. */
function appear() {
  const wanted = !settings.hidden && (busy || settings.where === 'everywhere' || beside);
  if (wanted && !face.isVisible()) face.showInactive();
  if (!wanted && face.isVisible()) face.hide();
  menu();
}

function show() {
  settings.hidden = false;
  save();
  appear();
}

/* Which app is in front, asked of macOS's own lsappinfo, which needs no
   permission. Her own app in front — her Dock icon, her menu, her key — is
   no switch, and an answer that cannot be read leaves her showing rather
   than lost. */
function front() {
  execFile('/bin/sh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"'], { timeout: FRONT_MS * 4 }, (err, out) => {
    const name = err ? null : out.match(/"LSDisplayName"="([^"]*)"/)?.[1] ?? null;
    if (name === app.getName()) return;
    beside = name === null || TRADINGVIEW.test(name);
    appear();
  });
}

/* The keys, registered whole or reported: a key another app holds registers
   as nothing, which would read as her not hearing. */
function bind() {
  globalShortcut.unregisterAll();
  const accelerator = KEYS[talkKey()];
  const talk = globalShortcut.register(accelerator, () => press(false));
  const chart = globalShortcut.register(`Shift+${accelerator}`, () => press(true));
  taken = !talk || !chart;
  if (taken) send('say', 'taken', talkKey());
  menu();
}

// A press is heard wherever he is: she comes for the turn, and goes after it.
function press(chart) {
  busy = true;
  show();
  send('press', chart);
}

/* Her menu, in the menu bar and on her Dock icon alike: the menu bar's
   icon carries the briefing's dot, the Dock's is where an app is looked for. */
function menu() {
  if (!tray) return;
  const name = talkKey(), accelerator = KEYS[name];
  tray.setTitle(waiting ? '•' : '');
  const items = () => [
    { label: 'Talk to her', accelerator, registerAccelerator: false, click: () => press(false) },
    { label: 'Show her the chart', accelerator: `Shift+${accelerator}`, registerAccelerator: false, click: () => press(true) },
    { label: 'Hear the briefing', enabled: Boolean(waiting), click: () => { busy = true; show(); send('briefing-now'); } },
    { type: 'separator' },
    { label: settings.hidden ? 'Unhide her' : 'Hide her', click: () => { settings.hidden = !settings.hidden; save(); appear(); } },
    { label: 'Show her', submenu: Object.entries(WHERE).map(([label, where]) => ({
      label, type: 'radio', checked: (settings.where ?? 'tradingview') === where,
      click: () => { settings.where = where; save(); appear(); },
    })) },
    { label: 'Size', submenu: Object.keys(SIZES).map(size => ({
      label: size, type: 'radio', checked: (settings.size ?? 'Medium') === size, click: () => resize(size),
    })) },
    { label: 'Talk key', submenu: Object.keys(KEYS).map(choice => ({
      label: choice, type: 'radio', checked: name === choice, click: () => { settings.key = choice; save(); bind(); },
    })) },
    ...(taken ? [{ label: `${name} is taken by another app`, enabled: false }] : []),
    { label: 'Start with the Mac', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: 'Her key…', click: askForKey },
    { label: 'Restart her', click: () => { app.relaunch(); app.exit(0); } },
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
   door keeps the turn going, so the copy and the memory still land. */
async function talk(path, body) {
  asking?.abort();
  const abort = asking = new AbortController();
  let idle;
  const alive = () => { clearTimeout(idle); idle = setTimeout(() => abort.abort('silent'), READ_MS); };
  alive();
  try {
    const res = await fetch(`${DOOR}${path}`, {
      method: body ? 'POST' : 'GET', body, headers: { 'x-laptop-key': key ?? '' }, signal: abort.signal,
    });
    if (res.status === 401) { askForKey(); return send('trouble', 'key'); }
    if (res.status === 503) return send('trouble', 'voice');
    if (!res.ok || !res.body) return send('trouble', 'door');
    const feed = framer((kind, bytes) => send('frame', kind, bytes));
    for await (const chunk of res.body) { alive(); feed(chunk); }
    send('done');
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

/* The briefing, as the charm has it: asked until it lands, then a dot beside
   her and in the menu bar until he hears it, gone at midnight in New York, as
   the door's today is. The ready answer is her line spoken; the dot is the
   news, so it is not played. */
async function briefing() {
  const today = nyDate();
  if (waiting && waiting !== today) { waiting = null; send('briefing', false); menu(); }
  if (!key || waiting || heard === today) return;
  const res = await fetch(`${DOOR}?briefing=ready`, { headers: { 'x-laptop-key': key }, signal: AbortSignal.timeout(ASK_MS) })
    .catch(() => null);
  if (res?.status !== 200) return;
  res.body?.cancel();
  waiting = today;
  send('briefing', true);
  menu();
}

function hearBriefing() {
  heard = nyDate();
  waiting = null;
  send('briefing', false);
  menu();
  talk('?briefing=today');
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

/* ─── What the pages ask of this half ──────────────────────────────────── */
ipcMain.handle('ready', () => ({ fresh, micOk, taken, talk: talkKey(), briefing: Boolean(waiting) }));
ipcMain.handle('look', async () => {
  const seen = await (looking = look());
  return typeof seen === 'string' ? seen : null;
});
ipcMain.on('ask', (_, voice) => ask(voice));
ipcMain.on('hush', () => { asking?.abort(); asking = null; looking = null; });
ipcMain.on('briefing', hearBriefing);
ipcMain.on('open', (_, pane) => { if (pane in PANES) shell.openExternal(PANES[pane]); });
ipcMain.on('busy', (_, yes) => { busy = yes; appear(); });
ipcMain.on('solid', (_, yes) => face.setIgnoreMouseEvents(!yes, { forward: true }));
ipcMain.on('drag', (_, dx, dy) => {
  const [x, y] = face.getPosition();
  face.setPosition(x + dx, y + dy);
});
ipcMain.handle('key', (_, candidate) => tryKey(String(candidate).trim()));

// Her pages are files and stay files: no window opens from them, and none navigates away.
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
});

/* Her Dock icon clicked, or the app opened again, is him looking for her:
   she shows wherever he is, for as long as she says she is here. */
const found = () => { busy = true; show(); send('say', 'here'); };
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
  tray = new Tray(nativeImage.createFromPath(join(here, 'eugenia.png')).resize({ width: 18, height: 18 }));
  tray.setToolTip('Eugenia');
  bind();
  if (!key) askForKey();
  briefing();
  setInterval(briefing, BRIEFING_EVERY_MS);
  lookForUpdate();
  setInterval(lookForUpdate, UPDATE_EVERY_MS);
  front();
  setInterval(front, FRONT_MS);
  setInterval(() => {
    if (!face.isVisible()) return;
    const at = screen.getCursorScreenPoint(), { x, y } = face.getBounds();
    send('cursor', at.x - x, at.y - y);
  }, CURSOR_MS);
  settle();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
// Closing the key's window is not leaving: she floats until he quits her.
app.on('window-all-closed', () => {});
