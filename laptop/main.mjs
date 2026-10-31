/* Eugenia on the laptop — the main process.
   ───────────────────────────────────────────────────────────────────────────
   A third door into her conversation, for when he trades away from home
   without the charm. Her face floats over his charts; ⌥Space and he talks,
   ⌥Space and she answers, ⇧⌥Space and she looks at the chart as well. Nothing
   about her is here: the door is doji-eugenia's, the turn is hers, and this
   file only carries his words and his chart to it and her voice back.

   This half owns everything the page may not: the key, the door, the window
   it floats in, the chart it captures and the update. The door is asked from
   here rather than from the page because the page is a file and the door
   allows no browser origin; the key never reaches the page at all.
   ═══════════════════════════════════════════════════════════════════════════ */
import {
  app, BrowserWindow, Menu, Tray, desktopCapturer, globalShortcut, ipcMain, nativeImage, safeStorage, screen,
  shell, systemPreferences,
} from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { framer } from './frames.mjs';

const DOOR = 'https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia';
// Published by laptop.yml from main: the zipped app, and its version after it.
const UPDATES = 'https://gujhyogvkzjgnrodyuse.supabase.co/storage/v1/object/public/laptop';

// The window's side in points, a square she floats in.
const SIZES = { Small: 140, Medium: 200, Large: 280 };
/* The chart's longest side. The model reads an image down to about this
   size anyway, so a larger capture is bytes paid for on every round of the
   turn and seen no better. */
const CHART_PX = 1568;
// The briefing is asked after the way the charm asks it: every few minutes until it lands.
const BRIEFING_EVERY_MS = 5 * 60_000;
const UPDATE_EVERY_MS = 24 * 60 * 60_000;

const here = import.meta.dirname;
const kept = (name) => join(app.getPath('userData'), name);
// Stamped by the workflow with the commit it built; a copy run from the repository has none and never updates.
const BUILD = existsSync(join(here, 'build.txt')) ? readFileSync(join(here, 'build.txt'), 'utf8').trim() : null;

// Her voice starts on a key press, which is no gesture inside the page.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

let face, tray, keyWindow;
let settings = {};
let key = null;
let asking = null;     // the request in flight, so a press can hush her
let looking = null;    // the chart being captured since he asked her to look
let waiting = null;    // the New York date a landed briefing waits for him on
let heard = null;      // the New York date he heard it
let offered = null;    // a newer build than this one

const nyDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const send = (channel, ...args) => face?.webContents.send(channel, ...args);

/* ─── What she keeps on the laptop ─────────────────────────────────────────
   The window's size and place, and her key, encrypted by the Keychain. */
function load() {
  try { settings = JSON.parse(readFileSync(kept('settings.json'), 'utf8')); } catch { settings = {}; }
  try { key = safeStorage.decryptString(readFileSync(kept('key'))); } catch { key = null; }
}
const save = () => writeFileSync(kept('settings.json'), JSON.stringify(settings));

/* A key is tried before it is kept, as the charm's setup tries one: an empty
   form, which her door refuses with a 400 for a right key — a 503 when the
   right key finds the door without its vendors — and a 401 for a wrong one. */
async function tryKey(candidate) {
  const res = await fetch(DOOR, { method: 'POST', body: new FormData(), headers: { 'x-laptop-key': candidate } })
    .catch(() => null);
  if (!res) return 'offline';
  if (res.status !== 400 && res.status !== 503) return 'wrong';
  key = candidate;
  writeFileSync(kept('key'), safeStorage.encryptString(key));
  keyWindow?.close();
  briefing();
  return 'kept';
}

function askForKey() {
  if (keyWindow) return keyWindow.focus();
  keyWindow = new BrowserWindow({
    width: 380, height: 210, resizable: false, minimizable: false, maximizable: false, title: 'Eugenia',
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  keyWindow.on('closed', () => { keyWindow = null; });
  keyWindow.loadFile(join(here, 'key.html'));
}

/* ─── The window she floats in ──────────────────────────────────────────────
   A panel: it floats over full-screen apps and a click on her does not take
   the focus from TradingView. Clicks outside her shape go through to it — the
   page says where her shape is. Kept out of every capture, so the chart she
   is shown never has her in it. */
function float() {
  const side = SIZES[settings.size] ?? SIZES.Medium;
  const { workArea } = screen.getPrimaryDisplay();
  face = new BrowserWindow({
    width: side, height: side,
    x: settings.x ?? workArea.x + workArea.width - side - 24,
    y: settings.y ?? workArea.y + workArea.height - side - 24,
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
}

function resize(name) {
  settings.size = name;
  save();
  face.setSize(SIZES[name], SIZES[name]);
  menu();
}

function menu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: face.isVisible() ? 'Hide her' : 'Show her', click: () => { face.isVisible() ? face.hide() : face.showInactive(); menu(); } },
    { label: 'Size', submenu: Object.keys(SIZES).map(name => ({
      label: name, type: 'radio', checked: (settings.size ?? 'Medium') === name, click: () => resize(name),
    })) },
    { label: 'Start with the Mac', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: 'Her key…', click: askForKey },
    ...(offered ? [{ type: 'separator' }, { label: 'Update her', click: update }] : []),
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]));
}

/* ─── Her door ──────────────────────────────────────────────────────────────
   One request each time, answered at once with her frames: the voice goes to
   the page as it arrives, so she starts speaking before the rest has come. A
   press while she thinks or speaks hushes her; the door keeps the turn going,
   so the copy and the memory still land. */
async function talk(path, body) {
  asking?.abort();
  const abort = asking = new AbortController();
  try {
    const res = await fetch(`${DOOR}${path}`, {
      method: body ? 'POST' : 'GET', body, headers: { 'x-laptop-key': key ?? '' }, signal: abort.signal,
    });
    if (res.status === 401) { askForKey(); return send('trouble'); }
    if (!res.ok || !res.body) return send('trouble');
    const feed = framer((kind, bytes) => send('frame', kind, bytes));
    for await (const chunk of res.body) feed(chunk);
    send('done');
  } catch {
    if (!abort.signal.aborted) send('trouble');
  }
}

/* A short question can end before its chart is captured, so it waits for it;
   one whose chart could not be captured is not asked, since the page has
   said she could not see. */
async function ask(voice) {
  const wanted = looking !== null, chart = await looking;
  looking = null;
  if (wanted && !chart) return;
  const form = new FormData();
  form.append('voice', new Blob([voice], { type: 'audio/webm' }), 'laptop.webm');
  if (chart) form.append('chart', new Blob([chart], { type: 'image/jpeg' }), 'chart.jpg');
  talk('', form);
}

/* The chart, when he asks her to look: the window whose title names
   TradingView, or the screen she floats on when none does — his chart is what
   is in front of him when he asks. Captured at the press, beside the
   listening rather than before it, so it is what he was looking at and his
   first words are not lost to the seconds a capture can take. Without the Screen Recording permission the capture
   comes back empty, and macOS is opened where it is granted. */
async function look() {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'], thumbnailSize: { width: CHART_PX, height: CHART_PX },
  }).catch(() => []);
  const display = String(screen.getDisplayMatching(face.getBounds()).id);
  const chart = sources.find(s => s.id.startsWith('window:') && /tradingview/i.test(s.name))
    ?? sources.find(s => s.id.startsWith('screen:') && s.display_id === display);
  if (!chart || chart.thumbnail.isEmpty()) {
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    return null;
  }
  return chart.thumbnail.toJPEG(85);
}

/* The briefing, as the charm has it: asked until it lands, then a dot beside
   her until he clicks, and gone at midnight in New York, as the door's today
   is. The ready answer is her line spoken; the dot is the news, so it is not
   played. */
async function briefing() {
  const today = nyDate();
  if (waiting && waiting !== today) { waiting = null; send('briefing', false); }
  if (!key || waiting || heard === today) return;
  const res = await fetch(`${DOOR}?briefing=ready`, { headers: { 'x-laptop-key': key } }).catch(() => null);
  if (res?.status !== 200) return;
  res.body?.cancel();
  waiting = today;
  send('briefing', true);
}

function hearBriefing() {
  heard = nyDate();
  waiting = null;
  send('briefing', false);
  talk('?briefing=today');
}

/* ─── Her updates ───────────────────────────────────────────────────────────
   laptop.yml publishes main's build with its version beside it. A newer one
   is offered in the menu, never installed unasked: one click downloads it,
   and a small shell left behind swaps the app once this one has quit and
   opens the new one. Downloaded here rather than by a browser, it carries no
   quarantine, and signed by the same certificate, macOS keeps her
   permissions. */
async function lookForUpdate() {
  if (!BUILD) return;
  const res = await fetch(`${UPDATES}/version`).catch(() => null);
  const version = res?.ok ? (await res.text()).trim() : null;
  offered = version && version !== BUILD ? version : null;
  menu();
}

async function update() {
  const res = await fetch(`${UPDATES}/Eugenia.zip`).catch(() => null);
  if (!res?.ok) return;
  const zip = join(app.getPath('temp'), 'eugenia-update.zip');
  const unpacked = join(app.getPath('temp'), 'eugenia-update');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const bundle = resolve(app.getPath('exe'), '../../..');
  const swap = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
rm -rf "${unpacked}" && ditto -x -k "${zip}" "${unpacked}" &&
  mv "${bundle}" "${bundle}.old" && mv "${unpacked}/Eugenia.app" "${bundle}" && rm -rf "${bundle}.old"
open "${bundle}"`;
  spawn('/bin/sh', ['-c', swap], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

/* ─── What the page asks of this half ──────────────────────────────────── */
ipcMain.handle('look', async () => (await (looking = look())) !== null);
ipcMain.on('ask', (_, voice) => ask(voice));
ipcMain.on('hush', () => { asking?.abort(); asking = null; looking = null; });
ipcMain.on('briefing', hearBriefing);
ipcMain.on('solid', (_, yes) => face.setIgnoreMouseEvents(!yes, { forward: true }));
ipcMain.on('drag', (_, dx, dy) => {
  const [x, y] = face.getPosition();
  face.setPosition(x + dx, y + dy);
});
ipcMain.handle('key', (_, candidate) => tryKey(String(candidate).trim()));

app.whenReady().then(async () => {
  load();
  await systemPreferences.askForMediaAccess('microphone');
  float();
  tray = new Tray(nativeImage.createFromPath(join(here, 'eugenia.png')).resize({ width: 18, height: 18 }));
  tray.setToolTip('Eugenia');
  menu();
  globalShortcut.register('Alt+Space', () => send('press', false));
  globalShortcut.register('Shift+Alt+Space', () => send('press', true));
  if (!key) askForKey();
  briefing();
  setInterval(briefing, BRIEFING_EVERY_MS);
  lookForUpdate();
  setInterval(lookForUpdate, UPDATE_EVERY_MS);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
// Closing the key's window is not leaving: she lives in the menu bar.
app.on('window-all-closed', () => {});
