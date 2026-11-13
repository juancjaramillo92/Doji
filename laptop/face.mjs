/* Her face on the laptop, with a body of glass.
   ───────────────────────────────────────────────────────────────────────────
   Her render and the drawing over it — eyes, highlight, smile — in a
   466-pixel square of her own, scaled to the window. Then the body: she
   breathes and floats a little at rest, bends as she sways and turns, gives
   on a spring when she is carried and dropped, and lights from inside while
   she listens; three dots over her head say she is thinking. Eyes and mouth
   are drawn on the same skin, so they stay on her. She sleeps when there is
   nothing to be awake for. Above her head, a line for what her face alone
   cannot say, and the journal's card when a trade waits for its answers.

   This page records him and plays her; the main process carries both to her
   door and back, and his answers to Gladys's, and owns the keys, the chart
   and the window.
   ═══════════════════════════════════════════════════════════════════════════ */
import { FINE, opacity } from './art.mjs';
import { FLING, marketOpen, settle, sleeps, slide } from './body.mjs';
import { FRAME, PCM_RATE, sampler } from './frames.mjs';
import { ASKS, SETUPS, asked, given, turned } from './journal.mjs';
import { CARD, ROOM, fitsRight, lineAt } from './place.mjs';

/* ─── Her face ──────────────────────────────────────────────────────────────
   Measured from the drawing of her face over the render, in pixels of her
   466 × 466 square. */
const F = {
  eye_l: [188.8, 148.0], eye_r: [286.7, 132.6], rx: 8.8, ry: 9.0,
  hl: [4.3, -2.6, 1.8],
  mouth: [244.3, 162.2], mouth_w: 51.0, sag: 9.4, stroke: 3.4,
  tilt: -10.0,
};
const DOTS = [[208, 38, 3.2], [233, 30, 3.8], [258, 38, 3.2]];
const FEATURES = '#0d0c0b', SHINE = '#f2f0ec', THROAT = '#1d0e0b', THOUGHT = '#ead3b6';
/* Doji's colours. Those named beside a token are the app's own, copies of
   index.html's, which agree.test.mjs holds them against; the emeralds the
   gradients are made of are her own. */
const ACCENT = '#0c8650';  // --p
const INK    = '#e6ece9';  // --tx
const MUTED  = '#96a89e';  // --mt2
const GROUND = '#070c0a';  // --glass
const LINE   = '#1c2922';  // --bd
const WARN   = '#d9a441';  // --warn
const DEEP = '#0e6f5c', GLOW = '#3cc488', TEAL = '#1f9e93';
const BLINK_EVERY_MS = 4000;
const LOOK_RANGE = 6;
const CONFUSED_MS = 4000;

/* ─── Her ear and sounds ───────────────────────────────────────────────────
   His voice is heard when its level, a sixth of full scale, passes VOICE; a
   recording he never spoke into is let go at SILENT_MS, and the last
   WARN_LEFT of one is ticked. Two notes start her listening and two in
   reverse send what she heard. */
const VOICE = 0.12;
const SILENT_MS = 30_000;
const WARN_LEFT = 30_000;
const LISTEN = [[660.0, 0.07], [990.0, 0.11]];
const SENT = [[990.0, 0.07], [660.0, 0.11]];

/* ─── Gladys's journal ─────────────────────────────────────────────────────
   A card beside her, in Doji's typeface: which trade, the question in
   the app's words, and its two answers as the card's two halves — left is no
   and right is yes, the setup's halves its two setups — in Doji's emeralds
   rather than a win's teal and a loss's red, each brightening when clicked.
   Four chips along the bottom say what is answered and how. Done, a tick
   draws itself in, light emerald when every answer was a yes, and she is
   pleased. Unclicked for ASK_MS, the card gives way, the trade still
   waiting. */
const WORDS = ['SETUP', 'RULES', 'SL', 'TP'];
const SHORT = ['B&R', 'S&R'];
const HALVES = [
  //         resting                    lit
  /* setup */ [['#0b2a22', '#113a2f'], [DEEP, GLOW]],
  /* no    */ [['#0a2430', '#0f3340'], ['#1f6f8a', TEAL]],
  /* yes   */ [['#0d2a17', '#153d22'], [ACCENT, '#5fe08a']],
];
const ASK_MS = 60_000;
const FLASH_MS = 260;
const DONE_MS = 2600;
/* The laptop's own: the card comes up on its own over his chart, at the
   moment he is likeliest to be working it, so a click in its first
   SETTLE_MS was meant for the chart beneath it. */
const SETTLE_MS = 500;
const TYPE = '"Hanken Grotesk"';
// The card's em at her 200-point size; it grows and shrinks with her.
const CARD_EM = 14 / 200;
/* Where what waits sits, low beside her, and the radius of each mark: the
   ring and the dot are drawn there and clicked there, so both read this. A
   click a little past the ring still lands, and further past the dot, whose
   glow reaches beyond it. */
const MARK = { x: 404, y: 404, ring: 25, dot: 16 };
const REACH = { ring: 4, dot: 6 };

/* ─── Her body ──────────────────────────────────────────────────────────────
   Tuned by eye and kept small: she is alive, not busy. The two rhythms differ
   so they never fall into step and repeat like a metronome. She gives from
   her base, the lowest row of the render, and bends from it: a bend is so
   many pixels at her crown, the highest, falling away by the square of the
   height. At rest she is drawn at a lower rate, which a breath this slow
   does not show, and the battery does. */
const BASE = 381, CROWN = 53;
const BREATH_S = 4.6, BREATH = 0.015;
const DEEP_S = 7.2, DEEP_BREATH = 0.03, DROOP = 0.03;
const BOB_S = 3.3, BOB = 2.5;
const SWAY_S = 2.6, SWAY = 9, TURN = 5;
const LEAN = 0.02, SQUASH = 0.035, LIFT = 4;
/* The spring she gives on, and how much of a carry goes into it: sideways
   into the bend, up and down into her height. The kicks are what a moment
   gives it — a nod as she takes his question, a start, a landing. */
const STIFF = 130, DAMP = 9;
const GIVE = 4, GIVE_UP = 0.012, BEND_MOST = 26, STRETCH_MOST = 0.12;
const NOD = 0.6, START = 1.2, LAND = 1.0, STIR = 0.7, WIGGLE = 150;
// The skin is bent in strips this many rows high.
const STRIP = 3;
const FRAME_MS = 33, REST_FRAME_MS = 50;
// The cursor within this many of her pixels has her eyes.
const NEAR = 700;
/* Play, kept for a cursor that means it, and for when he is flat: a pass
   faster than SWIFT of her pixels a second, close by, makes her start, no
   oftener than STARTLE_EVERY; RUB of her side travelled over her without a
   click pleases her. */
const SWIFT = 3000, CLOSE = 300, START_MS = 700, STARTLE_EVERY_MS = 4000;
const RUB = 3, PLEASED_MS = 1600;
const HINT_AFTER_MS = 1200;
/* A print his rules are cautious around, within SOON_MS: a bar beneath
   her, in the app's colour for caution, draining as its minutes go. She
   glances down at it a moment in every GLANCE_EVERY_MS. */
const SOON_MS = 15 * 60_000;
const GLANCE_EVERY_MS = 9000, GLANCE_MS = 900;

/* A recording's ceiling, at the bitrate it is made at, is well inside her
   door's FILE_MAX; agree.test.mjs holds the arithmetic. Shorter than a
   breath is a press he took back. */
const RECORD_MS = 5 * 60_000;
const RECORD_BPS = 32_000;
const RECORD_MIN_MS = 400;

/* ─── The line above her head ───────────────────────────────────────────────
   Each failure says whose it is and what to do, as her door's VOICE_TROUBLE
   does for a recording; `k` is the talk key he has chosen. */
const SAY = {
  hello: (k) => `Hi, jefe. ${k} or a click to talk — ⇧${k} and I look at your chart.`,
  hint: (k) => `${k} or a click to talk · drag to move me`,
  taken: (k) => `${k} is taken by another app — pick another Talk key in my menu.`,
  here: () => "I'm here — and up in the menu bar.",
  looking: () => 'Looking at your chart…',
  key: () => 'My key was refused — paste it again.',
  voice: () => "My voice isn't set up on the server yet.",
  door: () => 'Something went wrong on my side. Try again.',
  offline: () => "I can't reach the internet. Try again in a moment.",
  lost: () => 'The line went quiet. Try again.',
  screen: () => 'Turn on Screen Recording for Eugenia, then choose Restart her in my menu.',
  sight: () => "I couldn't see your chart. Try again.",
  mic: () => 'Turn on the Microphone for Eugenia in System Settings.',
  silent: () => "I didn't hear anything.",
  updating: () => 'Updating — back in a moment.',
  update: () => "The update didn't download. Try again later.",
};
const SAY_MS = 4500, HELLO_MS = 9000;

const canvas = document.getElementById('her');
const said = document.getElementById('said');
const card = document.getElementById('card');
const halves = [...document.getElementById('halves').children];
const chips = [...document.getElementById('chips').children];
const g = canvas.getContext('2d');
// Her skin: the render bent, lit and drawn on, as fine as the render is, before the body's transform carries all of it.
const skin = new OffscreenCanvas(466 * FINE, 466 * FINE);
const s = skin.getContext('2d');
const still = matchMedia('(prefers-reduced-motion: reduce)');
for (const [name, color] of Object.entries({ ink: INK, muted: MUTED, ground: GROUND, line: LINE, accent: ACCENT, glow: GLOW })) {
  document.body.style.setProperty(`--${name}`, color);
}

let art, alpha;              // the render with its black made clear, and her shape for clicks
let shape;                   // the box her shape fills, in her pixels: what an edge of the screen turns back
let mode = 'idle';           // idle · listening · thinking · speaking · confused · journal
let briefingWaits = false;
let printAt = null;          // when the next print lands, as her door last said
let trade = null, waiting = 0;   // the oldest trade waiting for its journal, and how many do
let calm = false;                // he is in a trade: she keeps still, and her play waits until he is flat
let due = false;                 // a trade came in: its card comes up once she is idle
let journal = null;              // the card, up while the mode is: the trade, the question, the half lit, done
let talkKey = '⌥Space';
let recorder = null, recording = null, ear = null;
let listen = null;           // the recording under way: when it began, whether he spoke, the tick
let audio = null;            // her answer playing: its context, its player, and what the player has said
let confusedUntil = 0, sayUntil = 0;
let cues = null;             // the context her two-note sounds and the ear share
let side = 0;                // her square's side, in the window's pixels
let tucked = null;           // the edge she peeks over while she is tucked away
let flight = null;           // a throw under way: her box on the screen and its speed
let asleep = false, market = true, marketAsked = -Infinity;
let nearAt = performance.now(), movedAt = nearAt;   // when he was last by her — the cursor near, a press, a word of hers — and when he last stirred at all
let startUntil = 0, startAfter = 0, pleasedUntil = 0, rubbed = 0;

/* The render is drawn on black: its black made clear by art.mjs's rule, and
   the edge un-darkened by the same amount, so the glass keeps its colour to
   the rim without a dark fringe. */
async function load() {
  const img = new Image();
  img.src = 'eugenia.png';
  await img.decode();
  const off = new OffscreenCanvas(img.width, img.height);
  const o = off.getContext('2d');
  o.drawImage(img, 0, 0);
  const d = o.getImageData(0, 0, img.width, img.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const p = d.data.subarray(i, i + 4);
    const a = opacity(p[0], p[1], p[2]);
    if (a > 0) { p[0] /= a; p[1] /= a; p[2] /= a; }
    p[3] = 255 * a;
  }
  o.putImageData(d, 0, 0);
  art = off;
  // Her shape for the mouse, in her own 466 pixels: a click needs no finer.
  const small = new OffscreenCanvas(466, 466).getContext('2d');
  small.drawImage(art, 0, 0, 466, 466);
  alpha = small.getImageData(0, 0, 466, 466).data.filter((_, i) => i % 4 === 3);
  shape = { left: 466, top: 466, right: 0, bottom: 0 };
  for (const [i, a] of alpha.entries()) {
    if (a <= 64) continue;
    const u = i % 466, v = Math.floor(i / 466);
    shape = { left: Math.min(shape.left, u), top: Math.min(shape.top, v), right: Math.max(shape.right, u), bottom: Math.max(shape.bottom, v) };
  }
}

function say(reason, ms = SAY_MS) {
  said.textContent = SAY[reason](talkKey);
  said.style.left = `${lineAt(screenX + innerWidth / 2, said.offsetWidth + 12, { x: screen.availLeft, width: screen.availWidth }) - screenX}px`;
  said.classList.add('shown');
  sayUntil = performance.now() + ms;
  nearAt = movedAt = performance.now();
}
const unsay = () => { said.classList.remove('shown'); sayUntil = 0; };

/* ─── Her sounds ─────────────────────────────────────────────────────────────
   Two notes rising in and dying away, and the tick, two 8 ms clicks of a
   high note 110 ms apart — each drawn sample by sample. */
const sounds = () => (cues ??= new AudioContext());

function notes(pair) {
  const ctx = sounds(), rate = ctx.sampleRate;
  const parts = pair.map(([hz, s]) => Array.from({ length: Math.round(rate * s) }, (_, i) => {
    const t = i / rate;
    return Math.sin(2 * Math.PI * hz * t) * Math.min(1, t * 400) * Math.exp(-t * 22) * 6000 / 32768;
  }));
  play(Float32Array.from(parts.flat()));
}

function tick() {
  const rate = sounds().sampleRate, span = Math.round(rate * 0.11);
  const one = Array.from({ length: span }, (_, i) => {
    const t = i / rate;
    return t < 0.008 ? Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 600) * 7000 / 32768 : 0;
  });
  play(Float32Array.from([...one, ...one]));
}

function play(samples) {
  const ctx = sounds();
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

/* ─── Drawing ─────────────────────────────────────────────────────────────── */
const ease = (v, t, rate, dt) => {
  const e = v + (t - v) * (1 - Math.exp(-rate * dt));
  return Math.abs(t - e) < 0.002 ? t : e;
};

function dot(c, cx, cy, rx, ry, color, fade = 1) {
  c.save();
  c.globalAlpha *= fade;
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  c.fill();
  c.restore();
}

/* A smile through its two ends and its lowest point, turned through F.tilt
   with her head. At this size the arc of the circle those points lie on and
   this curve are the same line. A sag the other way is an eye shut in
   pleasure. */
function curve(cx, y, half, sag, width) {
  s.save();
  s.translate(cx, y);
  s.rotate(F.tilt * Math.PI / 180);
  s.strokeStyle = FEATURES;
  s.lineWidth = width;
  s.lineCap = 'round';
  s.beginPath();
  s.moveTo(-half, 0);
  s.quadraticCurveTo(0, 2 * sag, half, 0);
  s.stroke();
  s.restore();
}

const V = {
  open: 0, gx: 0, gy: 0, mouth: 0, shape: 0, smile: 1, dots: 0, confused: 0, lid: 1, lean: 0, sway: 0, squash: 0,
  heard: 0, glow: 0, turn: 0, wide: 0, joy: 0, sleep: 0,
};
// What she gives on: the bend, in pixels at her crown, and her height.
const bend = { x: 0, v: 0 }, stretch = { x: 0, v: 0 };
const gaze = [0, 0];
let nextGlance = 0, nextBlink = 0, blinkAt = 0, blinking = false, level = 0, bright = 0, heard = 0, breath = 0;
let cursor = null;           // where the cursor is in her pixels, when it is near
let over = null;             // the half of the card the cursor is on
let right = true;            // the card stands on his right of her

function features() {
  const lid = V.open * V.lid, wide = 1 + 0.2 * V.wide;
  for (const [i, eye] of [F.eye_l, F.eye_r].entries()) {
    const odd = (1 + V.confused * (i ? 0.12 : -0.18)) * wide;
    const cx = eye[0] + V.gx, cy = eye[1] + V.gy + V.confused * (i ? -1.6 : 1.6);
    const rx = F.rx * odd, ry = F.ry * odd * lid * Math.max(0, 1 - 1.7 * V.joy);
    if (V.joy > 0.5 && lid > 0.3) { curve(cx, cy + 2, rx * 1.1, -3.2 * V.joy, 2.8); continue; }
    if (ry < 1.8) { curve(cx, cy, rx * 0.9, 1.2, 2.6); continue; }
    dot(s, cx, cy, rx, ry, FEATURES);
    if (lid > 0.45) {
      const k = lid - 0.45 > 0.25 ? 1 : (lid - 0.45) * 4;
      dot(s, cx + F.hl[0], cy + F.hl[1] * lid, F.hl[2], F.hl[2], SHINE, 0.92 * k);
    }
  }

  const [mx, my] = F.mouth;
  if (V.mouth < 0.06) {
    curve(mx, my, F.mouth_w / 2, F.sag * V.smile, F.stroke);
  } else {
    // Wide and shallow on a bright sound, narrow and deep on a dark one.
    const half = F.mouth_w / 2 * (0.7 + 0.32 * V.shape), bottom = my + F.sag * 0.8 + 2 * V.mouth * (14 - 5 * V.shape);
    s.fillStyle = THROAT;
    s.strokeStyle = FEATURES;
    s.lineWidth = 2;
    s.beginPath();
    s.roundRect(mx - half, my - 1, 2 * half, bottom - my + 1, (bottom - my + 1) / 2);
    s.fill();
    s.stroke();
  }
}

/* Her skin: the render, bent; then the light of his voice while she
   listens, drawn only where she is, filling her from her base and draining
   through a recording's last WARN_LEFT; then her thought, over her head and
   leaning with it; then her face, leaning with the glass it is on. Nothing
   but light moves inside her: the render's own bubbles are still, and
   beside them a shape that moves reads as laid on the glass. */
const leans = (y, by) => by * (Math.max(0, BASE - y) / (BASE - CROWN)) ** 2;

function wear(now, by) {
  s.setTransform(FINE, 0, 0, FINE, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.clearRect(0, 0, 466, 466);
  if (by === 0) s.drawImage(art, 0, 0, 466, 466);
  else for (let y = 0; y < 466; y += STRIP) s.drawImage(art, 0, y * FINE, art.width, STRIP * FINE, leans(y, by), y, 466, STRIP);

  s.globalCompositeOperation = 'source-atop';
  if (V.glow > 0.01) {
    const left = Math.min(1, (RECORD_MS - (now - listen.began)) / WARN_LEFT), line = BASE - left * (BASE - CROWN);
    const light = s.createLinearGradient(0, line - 16, 0, line + 16);
    light.addColorStop(0, `${GLOW}00`);
    light.addColorStop(1, GLOW);
    s.globalAlpha = V.glow * (0.16 + 0.4 * V.heard);
    s.fillStyle = light;
    s.fillRect(0, 0, 466, 466);
    s.globalAlpha = 1;
  }

  s.globalCompositeOperation = 'source-over';
  if (V.dots > 0.02) {
    for (const [i, [x, y, r]] of DOTS.entries()) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 260 - i * 1.1);
      dot(s, x + leans(y, by), y - pulse * 2.5, r, r, THOUGHT, V.dots * (0.25 + 0.75 * pulse));
    }
  }
  const [mx, my] = F.mouth, rise = (BASE - my) / (BASE - CROWN);
  s.translate(mx + leans(my, by), my);
  s.rotate(2 * by * rise / (BASE - CROWN));
  s.translate(-mx, -my);
  features();
}

/* What waits, low beside her, both in her emerald: an open ring for a
   trade, a dot with a glow for the briefing, the dot inside the ring for
   both — shape tells them apart. */
function waits() {
  if (trade) {
    g.strokeStyle = GLOW;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(MARK.x, MARK.y, MARK.ring, 0, 2 * Math.PI);
    g.stroke();
  }
  if (!briefingWaits) return;
  g.save();
  g.shadowColor = ACCENT;
  g.shadowBlur = 22;
  dot(g, MARK.x, MARK.y, MARK.dot, MARK.dot, GLOW);
  g.restore();
}

/* How much of SOON_MS is left before the print, or nothing while it is
   further off or past. */
const soon = () => {
  const left = (printAt - Date.now()) / SOON_MS;
  return printAt !== null && left > 0 && left <= 1 ? left : 0;
};

function nears() {
  const left = soon();
  if (!left) return;
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (const [color, part] of [[LINE, 1], [WARN, left]]) {
    g.strokeStyle = color;
    g.beginPath();
    g.moveTo(143, 432);
    g.lineTo(143 + 180 * part, 432);
    g.stroke();
  }
}

/* The face, then the body. Each value eases toward what the mode asks for,
   so nothing jumps between modes. At rest, a cursor near her has her eyes
   and turns her a little; otherwise she glances about. Tucked away, she
   looks back at the screen she left; while the card is up, at the card. */
function step(now, dt) {
  const m = mode;
  let tOpen = 1, tMouth = 0, tSmile = 1, tDots = 0, tConfused = 0, glance = 1, fixed = null;
  const pondering = [Math.floor(now / 1700) % 2 ? -LOOK_RANGE * 0.55 : LOOK_RANGE * 0.9, -LOOK_RANGE];
  const pleased = now < pleasedUntil;
  if (m === 'listening') { tSmile = 1.1; fixed = [0, -2]; }
  if (m === 'speaking')  { tMouth = level; tSmile = 0.9; glance = 0.4; }
  if (m === 'thinking')  { tOpen = 0.85; tSmile = 0.25; tDots = 1; fixed = pondering; }
  if (m === 'confused')  { tSmile = -0.35; tConfused = 1; fixed = [3, -2.5]; }
  if (m === 'journal')   fixed = [(right ? 5 : -5) + (over === null ? 0 : over ? 1 : -1), 0];
  if (m === 'idle' && tucked) fixed = { left: [LOOK_RANGE, 0], right: [-LOOK_RANGE, 0], bottom: [0, -LOOK_RANGE] }[tucked];
  if (m === 'idle' && soon() && now % GLANCE_EVERY_MS < GLANCE_MS) fixed = [0, LOOK_RANGE];
  if (m === 'idle' && cursor) fixed = cursor;
  if (asleep) { tOpen = 0; tSmile = 0.5; }
  if (pleased) tSmile = 1.3;

  if (fixed) [gaze[0], gaze[1]] = fixed;
  else if (now >= nextGlance) {
    const a = Math.random() * 2 * Math.PI, r = Math.sqrt(Math.random()) * LOOK_RANGE * glance;
    gaze[0] = Math.cos(a) * r;
    gaze[1] = Math.sin(a) * r * 0.7;
    nextGlance = now + 1200 + Math.random() * 2800;
  }

  V.lid = 1;
  if (!blinking && now >= nextBlink) { blinking = true; blinkAt = now; }
  if (blinking) {
    const b = now - blinkAt;
    V.lid = b < 70 ? 1 - b / 70 : b < 160 ? (b - 70) / 90 : 1;
    if (b >= 160) { blinking = false; nextBlink = now + BLINK_EVERY_MS * (0.6 + Math.random() * 0.8); }
  }

  V.open = ease(V.open, tOpen, asleep ? 3 : 16, dt);
  V.gx = ease(V.gx, gaze[0], 22, dt);
  V.gy = ease(V.gy, gaze[1], 22, dt);
  V.mouth = ease(V.mouth, tMouth, 28, dt);
  V.shape = ease(V.shape, m === 'speaking' ? bright : 0.5, 18, dt);
  V.smile = ease(V.smile, tSmile, 10, dt);
  V.dots = ease(V.dots, tDots, 5, dt);
  V.confused = ease(V.confused, tConfused, 8, dt);
  V.lean = ease(V.lean, m === 'listening' ? 1 : 0, 6, dt);
  V.sway = ease(V.sway, m === 'thinking' ? Math.sin(2 * Math.PI * now / 1000 / SWAY_S) : 0, 4, dt);
  V.squash = ease(V.squash, m === 'speaking' ? level : 0, 14, dt);
  V.heard = ease(V.heard, m === 'listening' ? heard : 0, 18, dt);
  V.glow = ease(V.glow, m === 'listening' ? 1 : 0, 8, dt);
  V.turn = ease(V.turn, m === 'idle' && cursor ? cursor[0] / LOOK_RANGE : 0, 5, dt);
  V.wide = ease(V.wide, held?.moved || flight || now < startUntil ? 1 : 0, 14, dt);
  V.joy = ease(V.joy, pleased ? 1 : 0, 12, dt);
  V.sleep = ease(V.sleep, asleep ? 1 : 0, 1.5, dt);
  settle(bend, STIFF, DAMP, dt);
  settle(stretch, STIFF, DAMP, dt);
  // Asleep she breathes slower and deeper; the breath keeps its place as the pace changes.
  breath += dt * 2 * Math.PI / (BREATH_S + (DEEP_S - BREATH_S) * V.sleep);
}

function draw(now) {
  const t = now / 1000, idle = still.matches ? 0 : 1;
  const air = idle * (BREATH + (DEEP_BREATH - BREATH) * V.sleep) * Math.sin(breath);
  const bob = idle * (1 - V.sleep) * (calm ? 0.5 : 1) * Math.sin(2 * Math.PI * t / BOB_S + 1.3);
  const up = Math.max(-STRETCH_MOST, Math.min(STRETCH_MOST, stretch.x));
  const sy = 1 + air + LEAN * V.lean - SQUASH * V.squash - DROOP * V.sleep + up;
  const sx = 1 - 0.4 * air + LEAN * V.lean + SQUASH * 0.7 * V.squash + 0.5 * DROOP * V.sleep - 0.6 * up;
  const lift = BOB * bob + LIFT * V.squash;
  wear(now, Math.max(-BEND_MOST, Math.min(BEND_MOST, SWAY * V.sway + TURN * V.turn + bend.x)));

  const k = canvas.width / 466;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.clearRect(0, 0, 466, 466);
  // Her shadow on his chart, drawing in as she rises off it.
  const shade = g.createRadialGradient(0, 0, 0, 0, 0, 150);
  shade.addColorStop(0, `${GROUND}66`);
  shade.addColorStop(1, `${GROUND}00`);
  g.save();
  g.translate(233, BASE + 6);
  g.scale(sx * (1 - lift / 60), 0.11);
  g.fillStyle = shade;
  g.fillRect(-150, -150, 300, 300);
  g.restore();
  g.save();
  g.translate(233, BASE - lift);
  g.scale(sx, sy);
  g.translate(-233, -BASE);
  g.drawImage(skin, 0, 0, 466, 466);
  g.restore();
  waits();
  nears();
}

/* At rest she is drawn at REST_FRAME_MS, and so she is while the card is
   up — once nothing she gives on is still moving. */
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const settled = !held && !flight && !bend.x && !bend.v && !stretch.x && !stretch.v;
  const resting = settled && (mode === 'idle' && !cursor || mode === 'journal');
  if (now - last < (resting ? REST_FRAME_MS : FRAME_MS)) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.033);
  last = now;
  step(now, dt);
  draw(now);
}

/* Her square at the bottom of the room, drawn at the screen's own density —
   which changes when the window moves to another screen, watched for once
   per density rather than once per resize. The card's em follows her side,
   and so does its width, which is the most the line is given; which side of
   her the card stands on is asked of the screen she is on as it comes up. */
let density = 0;
function fit() {
  side = Math.round(innerHeight / ROOM.height);
  canvas.style.width = canvas.style.height = `${side}px`;
  canvas.width = canvas.height = Math.round(side * devicePixelRatio);
  right = fitsRight({ x: screenX, width: innerWidth }, { x: screen.availLeft, width: screen.availWidth });
  const wide = `${side * CARD - 12}px`, past = `${(innerWidth + side) / 2 + 4}px`;
  card.style.fontSize = `${side * CARD_EM}px`;
  card.style.width = said.style.maxWidth = wide;
  card.style.bottom = `${side / 2}px`;
  card.style.left = right ? past : '';
  card.style.right = right ? '' : past;
  card.classList.toggle('left', !right);
  said.style.bottom = `${side + 2}px`;
  if (devicePixelRatio === density) return;
  density = devicePixelRatio;
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', fit, { once: true });
}

/* ─── Her voice ─────────────────────────────────────────────────────────────
   Played from one queue in the audio thread (voice.mjs), which holds a
   moment of her voice before it starts and plays it sample by sample, so her
   first words come whole. It says when her voice first sounds — thinking
   until then — and when the answer has played to its end.
   Its module loads while her first frames arrive; they wait for it. */
function voice() {
  if (!audio) {
    const ctx = new AudioContext({ sampleRate: PCM_RATE });
    const a = audio = { ctx, meter: ctx.createAnalyser(), sample: sampler(),
                        player: null, waiting: [], voiced: false, drained: false };
    a.meter.fftSize = 512;
    a.meter.connect(ctx.destination);
    ctx.audioWorklet.addModule('voice.mjs').then(() => {
      if (audio !== a) return;
      a.player = new AudioWorkletNode(ctx, 'voice', { outputChannelCount: [1] });
      a.player.connect(a.meter);
      a.player.port.onmessage = ({ data }) => { a[data === 'voice' ? 'voiced' : 'drained'] = true; };
      for (const said of a.waiting) a.player.port.postMessage(said);
    });
  }
  return audio;
}

const tell = (a, said) => (a.player ? a.player.port.postMessage(said) : a.waiting.push(said));

function answer(kind, bytes) {
  if (mode !== 'thinking' && mode !== 'speaking') return;
  const a = voice();
  if (kind !== FRAME.voice) return;
  const samples = a.sample(bytes);
  if (samples.length) tell(a, samples);
}

function silence() {
  if (!audio) return;
  audio.ctx.close();
  audio = null;
  level = 0;
}

const loudness = (meter) => {
  const wave = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(wave);
  return Math.min(1, 6 * Math.sqrt(wave.reduce((n, v) => n + v * v, 0) / wave.length));
};

/* How bright her voice is this moment, for the shape of her mouth: how often
   the wave crosses nothing — seldom on an "oh", often on an "ee" or an "s". */
const brightness = (meter) => {
  const wave = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(wave);
  let crossed = 0;
  for (let i = 1; i < wave.length; i++) if (wave[i - 1] < 0 !== wave[i] < 0) crossed++;
  return Math.min(1, Math.max(0, (crossed / wave.length - 0.03) / 0.2));
};

/* What she hears and does keeps its own clock; only her drawing waits on the
   screen. A window on a desktop he is not looking at is not drawn, and a
   turn asked from another desktop must still listen, answer and end. Each
   tick: how loud she is, and whether she has started or finished; and how
   loud he is while she listens — the light, the silence that lets go, the
   tick before the end; then whether she sleeps, where a throw has carried
   her, and whether the card is up. */
function live() {
  const now = performance.now();
  level = 0;
  if (audio) {
    if (mode === 'thinking' && audio.voiced) { mode = 'speaking'; unsay(); }
    level = loudness(audio.meter);
    bright = brightness(audio.meter);
    if (audio.drained) { silence(); mode = 'idle'; }
  }
  heard = 0;
  if (mode === 'listening' && ear) {
    heard = loudness(ear);
    if (heard > VOICE) listen.spoke = true;
    const elapsed = now - listen.began;
    if (!listen.spoke && elapsed >= SILENT_MS) { letGo(); say('silent'); }
    else if (!listen.warned && elapsed >= RECORD_MS - WARN_LEFT) { listen.warned = true; tick(); }
  }
  if (mode === 'confused' && now >= confusedUntil) mode = 'idle';
  if (mode === 'journal') {
    const j = journal;
    if (j.done ? now - j.done >= DONE_MS : j.lit === null && now - j.since >= ASK_MS) mode = 'idle';
  }
  if (mode === 'idle' && due && !tucked) journalNow();
  if (mode === 'journal' !== card.classList.contains('shown')) {
    card.classList.toggle('shown');
    fit();
  }

  // The market's hours are asked of the clock once a minute, not at every tick.
  if (now - marketAsked >= 60_000) { market = marketOpen(new Date()); marketAsked = now; }
  const slept = asleep;
  asleep = mode === 'idle' && !trade && !briefingWaits && !soon() && !held && !flight && sleeps(market, now - nearAt, now - movedAt);
  if (slept && !asleep) stretch.v += STIR;
  rubbed *= 0.94;

  if (flight) {
    const next = slide(flight, { x: screen.availLeft, y: screen.availTop, width: screen.availWidth, height: screen.availHeight }, FRAME_MS / 1000);
    carry(Math.round(next.x) - Math.round(flight.x), Math.round(next.y) - Math.round(flight.y));
    if (next.hit) stretch.v -= LAND;
    flight = next.done ? null : next;
    if (!flight) window.doji.dropped();
  }
  if (!held) feel();
  if (sayUntil && now >= sayUntil) unsay();
}

function trouble(reason) {
  letGo();
  silence();
  mode = 'confused';
  confusedUntil = performance.now() + CONFUSED_MS;
  say(reason);
  if (reason === 'mic') window.doji.open('mic');
}

/* ─── Him ───────────────────────────────────────────────────────────────────
   The microphone is opened at the press and closed with the recording, so
   macOS shows it in use only while she listens; her two notes say when to
   start talking. */
async function listening(chart) {
  try {
    recording = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    return trouble('mic');
  }
  const chunks = [];
  ear = sounds().createAnalyser();
  ear.fftSize = 1024;
  // Let go with the recording: the context outlives every question, and a source left connected to it stays.
  const source = sounds().createMediaStreamSource(recording);
  source.connect(ear);
  recorder = new MediaRecorder(recording, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: RECORD_BPS });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    const short = performance.now() - listen.began < RECORD_MIN_MS, kept = mode === 'listening';
    recording?.getTracks().forEach(t => t.stop());
    source.disconnect();
    recording = recorder = ear = null;
    if (!kept) return;
    if (short) { window.doji.hush(); mode = 'idle'; unsay(); return; }
    mode = 'thinking';
    stretch.v -= NOD;
    notes(SENT);
    window.doji.ask(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  };
  recorder.start();
  listen = { began: performance.now(), spoke: false, warned: false };
  mode = 'listening';
  notes(LISTEN);
  if (chart) say('looking', RECORD_MS);
  setTimeout(() => { if (mode === 'listening' && recorder) recorder.stop(); }, RECORD_MS);
}

// A recording ended without asking anything: the press taken back, or nothing said.
function letGo() {
  if (mode === 'listening') { mode = 'idle'; window.doji.hush(); }
  recorder?.stop();
}

/* One gesture for everything: the key, or a click on her. Idle, she listens
   — and looks, when he asked her to, while she listens; listening, she takes
   what he said; thinking or speaking, she stops. A chart she could not
   capture ends the question there, rather than answering it unseen. A click
   while a briefing waits plays it. A press while the microphone is still
   opening is kept for when it has, so a quick second press takes the
   question back rather than being lost. */
let starting = false, stopped = false;
async function press(chart) {
  if (starting) { stopped = true; return; }
  if (mode === 'listening') return recorder?.stop();
  if (mode === 'thinking' || mode === 'speaking') { window.doji.hush(); silence(); mode = 'idle'; return; }
  if (mode === 'journal') mode = 'idle';
  starting = true;
  nearAt = movedAt = performance.now();
  unsay();
  const seen = chart ? window.doji.look() : null;
  await listening(chart);
  starting = false;
  if (stopped) { stopped = false; recorder?.stop(); }
  const why = seen && await seen;
  if (why) trouble(why);
}

function briefing() {
  if (mode !== 'idle' || !briefingWaits) return false;
  mode = 'thinking';
  unsay();
  window.doji.briefing();
  return true;
}

/* ─── His journal ───────────────────────────────────────────────────────────
   What waits comes from the main process, asked of Gladys's door every
   minute; a trade that came in ticks, and its card comes up once she is
   idle — the conversation first. Each answer is sent as he gives it and
   answered with what waits after it, so the next question, or the next
   trade, follows at once; one her door did not take leaves the question
   where it was, to be clicked again, and the line says why. The talk key, or
   a click on her, closes the card and she listens. Answered elsewhere while
   it is up, it follows what is left. Tucked away, she is half off the screen
   and the card would be too: it waits until she is brought back. */
function journalNow() {
  if (mode !== 'idle' || !trade) return false;
  due = false;
  unsay();
  mode = 'journal';
  nearAt = movedAt = performance.now();
  journal = { q: -1, allYes: true, done: 0, opened: nearAt };
  ask(trade);
  return true;
}

function ask(next) {
  const { q } = asked(next);
  Object.assign(journal, { trade: next, q, since: performance.now(), lit: null });
  write();
}

/* The card as the journal stands: the trade as Gladys's message names it,
   at the hour on his own clock; the question; its halves; and the chips. */
function write() {
  const j = journal, setup = j.q === 0;
  card.classList.toggle('done', Boolean(j.done));
  card.classList.toggle('all', j.allYes);
  if (j.done) return;
  const at = new Date(j.trade.entry_time).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  document.getElementById('fill').textContent = `${j.trade.direction} ${Number(j.trade.entry_price).toFixed(2)} · ${at}`;
  document.getElementById('more').textContent = waiting > 1 ? `+${waiting - 1}` : '';
  document.getElementById('asks').textContent = ASKS[j.q];
  for (const [i, half] of halves.entries()) {
    const [top, bottom] = HALVES[setup ? 0 : 1 + i][j.lit === i ? 1 : 0];
    half.textContent = setup ? SETUPS[i] : i ? 'Yes' : 'No';
    half.style.background = `linear-gradient(${top}, ${bottom})`;
  }
  for (const [q, half] of given(j.trade).entries()) {
    chips[q].textContent = half === null ? WORDS[q] : `${WORDS[q]} ${q === 0 ? SHORT[half] : half ? '✓' : '✗'}`;
    chips[q].className = q === j.q ? 'now' : half === null ? '' : 'got';
  }
}

// A click on a half of the card: lit at once, held FLASH_MS at least, and sent.
async function choose(x) {
  const j = journal;
  if (j.lit !== null || j.done || performance.now() - j.opened < SETTLE_MS) return;
  const half = halfAt(x);
  j.lit = half;
  write();
  const [got] = await Promise.all([window.doji.answer(j.trade.id, j.q, half), new Promise(r => setTimeout(r, FLASH_MS))]);
  if (typeof got !== 'string') ({ trade, waiting, open: calm } = got);
  if (mode !== 'journal' || journal !== j) return;
  if (typeof got === 'string') {
    j.lit = null;
    j.since = performance.now();
    write();
    return say(got);
  }
  j.allYes &&= j.q === 0 || half === 1;
  if (trade) return ask(trade);
  j.done = performance.now();
  pleasedUntil = j.done + DONE_MS;
  stretch.v += STIR;
  write();
}

function waitsNow(next, count, inTrade) {
  calm = inTrade;
  if (count > waiting) tick();
  due = count > waiting || (due && count > 0);
  trade = next;
  waiting = count;
  if (mode !== 'journal' || journal.lit !== null || journal.done) return;
  if (!next) mode = 'idle';
  else if (turned(journal.trade, journal.q, next)) ask(next);
  else { journal.trade = next; write(); }
}

/* ─── Her shape, for the mouse ──────────────────────────────────────────────
   The window lets clicks through but where she is drawn; the marks of what
   waits count as her, and so does the card while it is up. A press that
   moves is a carry, and one that does not is a click: on the card, an
   answer; on her, tucked away, it brings her back; otherwise what waits goes
   first — the journal, then the briefing — and otherwise she listens.
   Whether the pointer is on her is asked as it moves and as she changes
   under it — the card coming up or going, a mark appearing — so a window
   that takes clicks where she no longer is never catches one meant for the
   chart. The first time the cursor rests on her, she says how to talk. */
function pixel(x, y) {
  const r = canvas.getBoundingClientRect();
  return [(x - r.left) * 466 / r.width, (y - r.top) * 466 / r.height];
}

const onCard = (x, y) => {
  const r = card.getBoundingClientRect();
  return mode === 'journal' && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
};
const halfAt = (x) => {
  const r = card.getBoundingClientRect();
  return Number(x >= (r.left + r.right) / 2);
};
const on = (x, y) => {
  if (onCard(x, y)) return true;
  const [u, v] = pixel(x, y).map(Math.round);
  const mark = trade ? 'ring' : 'dot';
  if ((trade || briefingWaits) && Math.hypot(u - MARK.x, v - MARK.y) < MARK[mark] + REACH[mark]) return true;
  return u >= 0 && v >= 0 && u < 466 && v < 466 && alpha[v * 466 + u] > 64;
};
let solid = false, held = null, hinted = false, hint = 0;
let pointer = null;          // where the cursor last was, in the window's pixels
function feel() {
  const now = pointer !== null && on(...pointer);
  over = pointer !== null && onCard(...pointer) ? halfAt(pointer[0]) : null;
  for (const [i, half] of halves.entries()) half.classList.toggle('over', over === i);
  if (now === solid) return;
  window.doji.solid(solid = now);
  document.body.classList.toggle('hand', solid);
  clearTimeout(hint);
  if (solid && !hinted) hint = setTimeout(() => { if (mode === 'idle' && !sayUntil) { hinted = true; say('hint'); } }, HINT_AFTER_MS);
}

/* Carried, by his hand or by a throw: the window moves, and she gives the
   other way, as glass would. */
function carry(dx, dy) {
  if (dx || dy) window.doji.drag(dx, dy);
  bend.v -= dx * GIVE;
  stretch.v -= dy * GIVE_UP;
}

addEventListener('mousemove', (e) => {
  if (held) {
    const dx = e.screenX - held.x, dy = e.screenY - held.y;
    if (held.moved || Math.hypot(dx, dy) > 4) {
      held.moved = true;
      carry(dx, dy);
      held.x = e.screenX;
      held.y = e.screenY;
      held.trail = [...held.trail.filter(p => e.timeStamp - p.at < 100), { at: e.timeStamp, x: e.screenX, y: e.screenY }];
    }
    return;
  }
  // Rubbed: the cursor going over and over her, without a press.
  if (solid && mode === 'idle' && !tucked && !calm && (rubbed += Math.hypot(e.movementX, e.movementY)) > RUB * side) {
    rubbed = 0;
    pleasedUntil = performance.now() + PLEASED_MS;
    bend.v += WIGGLE;
  }
  pointer = [e.clientX, e.clientY];
  feel();
});
// A press on her mid-throw catches her: she is held, and letting go sets her down rather than asking her anything.
addEventListener('mousedown', (e) => {
  if (!solid) return;
  held = { x: e.screenX, y: e.screenY, moved: flight !== null, trail: [{ at: e.timeStamp, x: e.screenX, y: e.screenY }] };
  flight = null;
});
/* Let go while moving faster than FLING, she is thrown: she slides on and
   comes back off the screen's edges, and where she stops is where he left
   her. Slower, with Reduce Motion on, or while he is in a trade, she is set
   down. */
addEventListener('mouseup', (e) => {
  if (held?.moved) {
    const [from] = held.trail, to = held.trail.at(-1), span = (to.at - from.at) / 1000;
    const vx = span ? (to.x - from.x) / span : 0, vy = span ? (to.y - from.y) / span : 0;
    if (Math.hypot(vx, vy) > FLING && !still.matches && !calm) {
      const r = canvas.getBoundingClientRect(), k = r.width / 466;
      flight = {
        x: screenX + r.left + shape.left * k, y: screenY + r.top + shape.top * k,
        width: (shape.right - shape.left) * k, height: (shape.bottom - shape.top) * k, vx, vy,
      };
    } else {
      stretch.v -= LAND;
      window.doji.dropped();
    }
  } else if (held) {
    if (onCard(e.clientX, e.clientY)) choose(e.clientX);
    else if (tucked) window.doji.bring();
    else if (!journalNow() && !briefing()) press(false);
  }
  held = null;
});

/* The cursor anywhere on the screen, from the main process: near her, it has
   her eyes and wakes her; past her fast and close, it makes her start. */
let seen = null;
function near(x, y) {
  const now = performance.now();
  pointer = [x, y];
  const [u, v] = pixel(x, y), dx = u - 237, dy = v - 140, far = Math.hypot(dx, dy);
  cursor = far < NEAR && far > 1 ? [dx / far * LOOK_RANGE, dy / far * LOOK_RANGE * 0.7] : null;
  movedAt = now;
  if (cursor) nearAt = now;
  const swift = seen ? Math.hypot(u - seen.u, v - seen.v) / (now - seen.at) * 1000 : 0;
  seen = { u, v, at: now };
  if (mode === 'idle' && !asleep && !held && !calm && far < CLOSE && swift > SWIFT && now >= startAfter) {
    startUntil = now + START_MS;
    startAfter = now + STARTLE_EVERY_MS;
    stretch.v += START;
  }
}

window.doji.on('press', press);
window.doji.on('frame', answer);
window.doji.on('done', () => { if (audio) tell(audio, 'end'); else if (mode === 'thinking') mode = 'idle'; });
window.doji.on('trouble', trouble);
window.doji.on('briefing', (yes) => { briefingWaits = yes; });
window.doji.on('briefing-now', briefing);
window.doji.on('journal', waitsNow);
window.doji.on('journal-now', journalNow);
window.doji.on('say', (reason, key) => { if (key) talkKey = key; say(reason); });
window.doji.on('cursor', near);
window.doji.on('tucked', (edge) => { tucked = edge; });
window.doji.on('print', (at) => { printAt = at; });

addEventListener('resize', fit);
fit();
await Promise.all([load(), document.fonts.load(`800 18px ${TYPE}`), document.fonts.load(`700 10px ${TYPE}`), document.fonts.load(`600 12px ${TYPE}`)]);
const start = await window.doji.ready();
talkKey = start.talk;
briefingWaits = start.briefing;
printAt = start.print;
waitsNow(start.trade, start.waiting, start.open);
if (start.fresh) say('hello', HELLO_MS);
else if (!start.micOk) say('mic');
else if (start.taken) say('taken');
setInterval(live, FRAME_MS);
requestAnimationFrame(frame);
