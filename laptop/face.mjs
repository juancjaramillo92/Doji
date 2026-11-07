/* Her face on the laptop, with a body that breathes.
   ───────────────────────────────────────────────────────────────────────────
   Her render and the drawing over it — eyes, highlight, smile, thought dots,
   the listening ring — in a 466-pixel square of her own, scaled to the
   window. Then the body: she breathes and floats a little at rest, looks
   at the cursor when it comes near, leans in to listen, sways while she
   thinks and gives with the loud moments of her voice. Eyes and mouth ride
   the same transform, so they stay on her. And a line above her head, for
   what her face alone cannot say: why something failed, and how to talk.
   When a trade waits for its journal, the journal's screens take her place,
   and his clicks answer them.

   This page records him and plays her; the main process carries both to her
   door and back, and his answers to Gladys's, and owns the keys, the chart
   and the window.
   ═══════════════════════════════════════════════════════════════════════════ */
import { opacity } from './art.mjs';
import { FRAME, PCM_RATE, sampler } from './frames.mjs';
import { asked } from './journal.mjs';
import { ROOM } from './place.mjs';

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
   The journal's screens, drawn on her round square: each question owns the
   whole of it, split down the middle, with one word in Doji's typeface. Left
   is no and right is yes — the setup's halves its two setups — in Doji's
   emeralds rather than a win's teal and a loss's red, each a gradient from
   top to bottom that brightens when clicked. Four dots at the top say what
   is answered; done, they fill, a tick draws itself in and the ring sweeps
   round once, brighter when every answer was a yes. Unclicked for ASK_MS,
   the questions give way to her, the trade still waiting. */
const WORDS = ['SETUP', 'RULES', 'SL', 'TP'];
const SHORT = ['B&R', 'S&R'];
const HALVES = [
  //         resting                    lit
  /* setup */ [['#0b2a22', '#113a2f'], [DEEP, GLOW]],
  /* no    */ [['#0a2430', '#0f3340'], ['#1f6f8a', TEAL]],
  /* yes   */ [['#0d2a17', '#153d22'], [ACCENT, '#5fe08a']],
];
const TICK = [[203, 237], [223, 257], [263, 209]];
const ASK_MS = 60_000;
const FLASH_MS = 260;
const FADE_MS = 180;
const TICK_MS = 420;
const SWEEP_MS = 700;
const DONE_MS = 2600;
/* The laptop's own: the questions come up on their own over his chart, at
   the moment he is likeliest to be working it, so a click in their first
   SETTLE_MS was meant for the chart beneath them. */
const SETTLE_MS = 500;
// The ring near white: grey on black reads as a smudge.
const WAITS = '#ecf4ef';
const TYPE = '"Hanken Grotesk"';

/* ─── What the laptop adds ─────────────────────────────────────────────────
   Tuned by eye and kept small: she is alive, not busy. The two rhythms differ
   so they never fall into step and repeat like a metronome. She gives from
   her base, the lowest row of the render. At rest she is drawn at a lower
   rate, which a breath this slow does not show, and the battery does. */
const BASE = 381;
const BREATH_S = 4.6, BREATH = 0.015;
const BOB_S = 3.3, BOB = 2.5;
const SWAY_S = 2.6, SWAY = 0.026;
const LEAN = 0.02, SQUASH = 0.035, LIFT = 4;
// The journal crosses over her rather than cutting in: nothing flashes.
const CROSS = 12;
const FRAME_MS = 33, REST_FRAME_MS = 50;
// The cursor within this many of her pixels has her eyes.
const NEAR = 700;
const HINT_AFTER_MS = 1200;

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
const g = canvas.getContext('2d');
const still = matchMedia('(prefers-reduced-motion: reduce)');
Object.assign(said.style, { color: INK, background: `${GROUND}e0`, border: `1px solid ${LINE}` });

let art, alpha;              // the render with its black made clear, and her shape for clicks
let mode = 'idle';           // idle · listening · thinking · speaking · confused · journal
let briefingWaits = false;
let trade = null, waiting = 0;   // the oldest trade waiting for its journal, and how many do
let due = false;                 // a trade came in: its questions come up once she is idle
let journal = null;              // the questions, up while the mode is: the trade, the question, the half lit, done
let talkKey = '⌥Space';
let recorder = null, recording = null, ear = null;
let listen = null;           // the recording under way: when it began, whether he spoke, the tick
let audio = null;            // her answer playing: its context, its player, and what the player has said
let confusedUntil = 0, sayUntil = 0;
let cues = null;             // the context her two-note sounds and the ear share

/* The render is drawn on black: its black made clear by art.mjs's rule, and
   the edge un-darkened by the same amount, so the glass keeps its colour to
   the rim without a dark fringe. */
async function load() {
  const img = new Image();
  img.src = 'eugenia.png';
  await img.decode();
  const off = new OffscreenCanvas(466, 466);
  const o = off.getContext('2d');
  o.drawImage(img, 0, 0);
  const d = o.getImageData(0, 0, 466, 466);
  alpha = new Uint8Array(466 * 466);
  for (let i = 0; i < alpha.length; i++) {
    const p = d.data.subarray(4 * i, 4 * i + 4);
    const a = opacity(p[0], p[1], p[2]);
    if (a > 0) { p[0] /= a; p[1] /= a; p[2] /= a; }
    p[3] = alpha[i] = 255 * a;
  }
  o.putImageData(d, 0, 0);
  art = off;
}

function say(reason, ms = SAY_MS) {
  said.textContent = SAY[reason](talkKey);
  said.classList.add('shown');
  sayUntil = performance.now() + ms;
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

function dot(cx, cy, rx, ry, color, fade = 1) {
  g.save();
  g.globalAlpha *= fade;
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  g.fill();
  g.restore();
}

/* A smile through its two ends and its lowest point, turned through F.tilt
   with her head. At this size the arc of the circle those points lie on and
   this curve are the same line. */
function curve(cx, y, half, sag, width, color) {
  g.save();
  g.translate(cx, y);
  g.rotate(F.tilt * Math.PI / 180);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-half, 0);
  g.quadraticCurveTo(0, 2 * sag, half, 0);
  g.stroke();
  g.restore();
}

const V = {
  open: 0, gx: 0, gy: 0, mouth: 0, smile: 1, dots: 0, confused: 0, lid: 1, lean: 0, sway: 0, squash: 0, heard: 0, journal: 0,
};
const gaze = [0, 0];
let nextGlance = 0, nextBlink = 0, blinkAt = 0, blinking = false, level = 0, heard = 0;
let cursor = null;           // where the cursor is in her pixels, when it is near

function features(now) {
  const open = V.open * V.lid;
  for (const [i, eye] of [F.eye_l, F.eye_r].entries()) {
    const odd = 1 + V.confused * (i ? 0.12 : -0.18);
    const cx = eye[0] + V.gx, cy = eye[1] + V.gy + V.confused * (i ? -1.6 : 1.6);
    const rx = F.rx * odd, ry = F.ry * odd * open;
    if (ry < 1.8) { curve(cx, cy, rx * 0.9, 1.2, 2.6, FEATURES); continue; }
    dot(cx, cy, rx, ry, FEATURES);
    if (open > 0.45) {
      const k = open - 0.45 > 0.25 ? 1 : (open - 0.45) * 4;
      dot(cx + F.hl[0], cy + F.hl[1] * open, F.hl[2], F.hl[2], SHINE, 0.92 * k);
    }
  }

  const [mx, my] = F.mouth;
  if (V.mouth < 0.06) {
    curve(mx, my, F.mouth_w / 2, F.sag * V.smile, F.stroke, FEATURES);
  } else {
    const half = F.mouth_w / 2 * 0.86, bottom = my + F.sag * 0.8 + 2 * V.mouth * 12;
    g.fillStyle = THROAT;
    g.strokeStyle = FEATURES;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(mx - half, my - 1, 2 * half, bottom - my + 1, (bottom - my + 1) / 2);
    g.fill();
    g.stroke();
  }

  if (V.dots > 0.02) {
    for (const [i, [x, y, r]] of DOTS.entries()) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 260 - i * 1.1);
      dot(x, y - pulse * 2.5, r, r, THOUGHT, V.dots * (0.25 + 0.75 * pulse));
    }
  }
}

/* The ring round the rim, Doji's emeralds turning through it, `part`
   of the way round from the top. */
function ring(radius, width, part, fade = 1) {
  const conic = g.createConicGradient(-Math.PI / 2, 233, 233);
  [DEEP, ACCENT, GLOW, TEAL, DEEP].forEach((c, i) => conic.addColorStop(i / 4, c));
  g.save();
  g.globalAlpha *= fade;
  g.strokeStyle = conic;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(233, 233, radius, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * part);
  g.stroke();
  g.restore();
}

/* What waits, low beside her: a near-white ring for a trade, an emerald dot
   with a glow for the briefing, the dot inside the ring for both — shape
   tells them apart. His chart may be light, so the ring has a dark edge. */
function waits() {
  if (trade) {
    g.save();
    g.shadowColor = GROUND;
    g.shadowBlur = 4;
    g.strokeStyle = WAITS;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(404, 404, 25, 0, 2 * Math.PI);
    g.stroke();
    g.restore();
  }
  if (!briefingWaits) return;
  g.save();
  g.shadowColor = ACCENT;
  g.shadowBlur = 22;
  dot(404, 404, 16, 16, GLOW);
  g.restore();
}

/* ─── The journal's screens ─────────────────────────────────────────────────
   Drawn in her 466 square, on its round screen. */
function word(text, x, y, size, weight, color, spacing) {
  g.font = `${weight} ${size}px ${TYPE}`;
  g.letterSpacing = `${spacing}px`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // The spacing follows the last letter as well, so the word is centred without it.
  g.fillText(text, x + spacing / 2, y);
}

// Answered emerald, this one larger, the rest to come faint.
function progress(q, missing) {
  for (let i = 0; i < 4; i++) {
    const r = i === q ? 5 : 4;
    dot(233 + (i - 1.5) * 22, 34, r, r, missing[i] ? INK : ACCENT, !missing[i] || i === q ? 1 : 56 / 255);
  }
}

function questions(j, now) {
  g.save();
  g.globalAlpha = V.journal;
  g.beginPath();
  g.arc(233, 233, 233, 0, 2 * Math.PI);
  g.clip();
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 466, 466);
  if (j.done) finished(now - j.done, j.allYes);
  else {
    const setup = j.q === 0;
    for (const i of [0, 1]) {
      const [top, bottom] = HALVES[setup ? 0 : 1 + i][j.lit === i ? 1 : 0], x = i ? 235 : 0;
      const fill = g.createLinearGradient(0, 0, 0, 466);
      fill.addColorStop(0, top);
      fill.addColorStop(1, bottom);
      g.fillStyle = fill;
      g.fillRect(x, 0, 231, 466);
      if (setup) word(SHORT[i], x + 231 / 2, 233, 64, 800, j.lit === i ? '#ffffff' : INK, 1);
    }
    if (setup) {
      g.fillStyle = '#000000';
      g.beginPath();
      g.roundRect(183, 70, 100, 34, 17);
      g.fill();
      word(WORDS[0], 233, 87, 16, 700, MUTED, 2);
    } else {
      // The word with room either side, never narrower than the pill's own curve.
      g.font = `800 64px ${TYPE}`;
      g.letterSpacing = '2px';
      const w = Math.max(150, g.measureText(WORDS[j.q]).width - 2 + 64);
      g.save();
      g.globalAlpha *= Math.min(1, (now - j.faded) / FADE_MS);
      g.fillStyle = GROUND;
      g.strokeStyle = LINE;
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(233 - w / 2 + 1, 191, w - 2, 86, 43);
      g.fill();
      g.stroke();
      word(WORDS[j.q], 233, 234, 64, 800, INK, 2);
      g.restore();
    }
    progress(j.q, j.missing);
  }
  g.restore();
}

/* The four dots filled, the tick drawn in over TICK_MS in its two strokes,
   and the ring swept round over SWEEP_MS — the tick light emerald and the
   ring at full strength when every answer was a yes. */
function finished(t, allYes) {
  progress(-1, [false, false, false, false]);
  const first = Math.hypot(20, 20), second = Math.hypot(40, 48);
  let drawn = Math.min(1, t / TICK_MS) * (first + second);
  g.strokeStyle = allYes ? GLOW : INK;
  g.lineWidth = 9;
  g.lineCap = 'round';
  for (let s = 0; s < 2 && drawn > 0; s++) {
    const len = s ? second : first, k = Math.min(1, drawn / len), [x, y] = TICK[s], [x2, y2] = TICK[s + 1];
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (x2 - x) * k, y + (y2 - y) * k);
    g.stroke();
    drawn -= len;
  }
  ring(231, 8, Math.min(1, t / SWEEP_MS), allYes ? 1 : 0.55);
}

/* The face, then the body. Each value eases toward what the mode asks for,
   so nothing jumps between modes. At rest, a cursor near her has her eyes;
   otherwise she glances about. */
function step(now, dt) {
  const m = mode;
  let tOpen = 1, tMouth = 0, tSmile = 1, tDots = 0, tConfused = 0, glance = 1, fixed = null;
  const pondering = [Math.floor(now / 1700) % 2 ? -LOOK_RANGE * 0.55 : LOOK_RANGE * 0.9, -LOOK_RANGE];
  if (m === 'listening') { tSmile = 1.1; fixed = [0, -2]; }
  if (m === 'speaking')  { tMouth = level; tSmile = 0.9; glance = 0.4; }
  if (m === 'thinking')  { tOpen = 0.85; tSmile = 0.25; tDots = 1; fixed = pondering; }
  if (m === 'confused')  { tSmile = -0.35; tConfused = 1; fixed = [3, -2.5]; }
  if (m === 'idle' && cursor) fixed = cursor;

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

  V.open = ease(V.open, tOpen, 16, dt);
  V.gx = ease(V.gx, gaze[0], 22, dt);
  V.gy = ease(V.gy, gaze[1], 22, dt);
  V.mouth = ease(V.mouth, tMouth, 28, dt);
  V.smile = ease(V.smile, tSmile, 10, dt);
  V.dots = ease(V.dots, tDots, 5, dt);
  V.confused = ease(V.confused, tConfused, 8, dt);
  V.lean = ease(V.lean, m === 'listening' ? 1 : 0, 6, dt);
  V.sway = ease(V.sway, m === 'thinking' ? Math.sin(2 * Math.PI * now / 1000 / SWAY_S) : 0, 4, dt);
  V.squash = ease(V.squash, m === 'speaking' ? level : 0, 14, dt);
  V.heard = ease(V.heard, m === 'listening' ? heard : 0, 18, dt);
  V.journal = ease(V.journal, m === 'journal' ? 1 : 0, CROSS, dt);
}

function draw(now) {
  const t = now / 1000, idle = still.matches ? 0 : 1;
  const breath = idle * Math.sin(2 * Math.PI * t / BREATH_S);
  const bob = idle * Math.sin(2 * Math.PI * t / BOB_S + 1.3);
  const sy = 1 + BREATH * breath + LEAN * V.lean - SQUASH * V.squash;
  const sx = 1 - BREATH * 0.4 * breath + LEAN * V.lean + SQUASH * 0.7 * V.squash;

  const k = canvas.width / 466;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.clearRect(0, 0, 466, 466);
  if (V.journal < 1) {
    g.save();
    g.translate(233, BASE - BOB * bob - LIFT * V.squash);
    g.rotate(SWAY * V.sway);
    g.scale(sx, sy);
    g.translate(-233, -BASE);
    g.drawImage(art, 0, 0);
    features(now);
    g.restore();
    /* The ring swells with his voice, so he sees she hears him, and in a
       recording's last WARN_LEFT it empties toward the end — inside her
       square at its widest, or the window's edge cuts it. */
    if (mode === 'listening') ring(222, 5 + 9 * V.heard, Math.min(1, (RECORD_MS - (now - listen.began)) / WARN_LEFT));
    waits();
  }
  if (V.journal > 0) questions(journal, now);
}

/* At rest she is drawn at REST_FRAME_MS, and so are the questions while
   nothing on them moves — up, settled, and not drawing their tick. */
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const settled = mode === 'journal' && V.journal === 1 && !journal.done && now - journal.faded >= FADE_MS;
  const resting = mode === 'idle' && !cursor || settled;
  if (now - last < (resting ? REST_FRAME_MS : FRAME_MS)) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.033);
  last = now;
  step(now, dt);
  draw(now);
}

/* Her square at the bottom of the room, drawn at the screen's own density —
   which changes when the window moves to another screen, watched for once
   per density rather than once per resize. */
let density = 0;
function fit() {
  const side = Math.round(innerHeight / ROOM.height);
  canvas.style.width = canvas.style.height = `${side}px`;
  canvas.width = canvas.height = Math.round(side * devicePixelRatio);
  // Above the ring, in the room over her head.
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
  return Math.min(1, 6 * Math.sqrt(wave.reduce((n, s) => n + s * s, 0) / wave.length));
};

/* What she hears and does keeps its own clock; only her drawing waits on the
   screen. A window on a desktop he is not looking at is not drawn, and a
   turn asked from another desktop must still listen, answer and end. Each
   tick: how loud she is, and whether she has started or finished; and how
   loud he is while she listens — the ring, the silence that lets go, the
   tick before the end. */
function live() {
  const now = performance.now();
  level = 0;
  if (audio) {
    if (mode === 'thinking' && audio.voiced) { mode = 'speaking'; unsay(); }
    level = loudness(audio.meter);
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
  if (mode === 'idle' && due) journalNow();
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
   minute; a trade that came in ticks, and its questions come up once she is
   idle — the conversation first. Each answer
   is sent as he gives it and answered with what waits after it, so the next
   question, or the next trade, follows at once; one her door did not take
   leaves the question where it was, to be clicked again, and the line says
   why. The talk key on them closes them and she listens. Answered elsewhere while they are up, they follow what is left. */
function journalNow() {
  if (mode !== 'idle' || !trade) return false;
  due = false;
  unsay();
  mode = 'journal';
  journal = { q: -1, allYes: true, done: 0, opened: performance.now() };
  ask(trade);
  return true;
}

function ask(next) {
  const { q, missing } = asked(next), now = performance.now();
  if (q !== journal.q) journal.faded = now;
  Object.assign(journal, { trade: next, q, missing, since: now, lit: null });
}

// A click on a half: lit at once, held FLASH_MS at least, and sent.
async function choose(x) {
  const j = journal;
  if (j.lit !== null || j.done || performance.now() - j.opened < SETTLE_MS) return;
  const side = pixel(x, 0)[0] >= 233 ? 1 : 0;
  j.lit = side;
  const [got] = await Promise.all([window.doji.answer(j.trade.id, j.q, side), new Promise(r => setTimeout(r, FLASH_MS))]);
  if (typeof got !== 'string') ({ trade, waiting } = got);
  if (mode !== 'journal' || journal !== j) return;
  if (typeof got === 'string') {
    j.lit = null;
    j.since = performance.now();
    return say(got);
  }
  j.allYes &&= j.q === 0 || side === 1;
  if (trade) ask(trade);
  else j.done = performance.now();
}

function waitsNow(next, count) {
  if (count > waiting) tick();
  due = count > waiting || (due && count > 0);
  trade = next;
  waiting = count;
  if (mode !== 'journal' || journal.lit !== null || journal.done) return;
  if (!next) mode = 'idle';
  else if (next.id !== journal.trade.id || asked(next).q !== journal.q) ask(next);
}

/* ─── Her shape, for the mouse ──────────────────────────────────────────────
   The window lets clicks through but where she is drawn; the marks of what
   waits count as her, and the journal's round screen is all hers. A press
   that moves is a drag, and one that does not is a click: on the journal, an
   answer; on her, what waits goes first — the journal, then the briefing —
   and otherwise she listens. Whether the pointer is on her is asked as it
   moves and as she changes under it — the questions coming up or going, a
   mark appearing — so a window that takes clicks where she no longer is
   never catches one meant for the chart. The first time the cursor rests on
   her, she says how to talk. */
function pixel(x, y) {
  const r = canvas.getBoundingClientRect();
  return [(x - r.left) * 466 / r.width, (y - r.top) * 466 / r.height];
}

const on = (x, y) => {
  const [u, v] = pixel(x, y).map(Math.round);
  if (mode === 'journal') return Math.hypot(u - 233, v - 233) < 233;
  if ((trade || briefingWaits) && Math.hypot(u - 404, v - 404) < (trade ? 29 : 22)) return true;
  return u >= 0 && v >= 0 && u < 466 && v < 466 && alpha[v * 466 + u] > 64;
};
let solid = false, held = null, hinted = false, hint = 0;
let pointer = null;          // where the cursor last was, in the window's pixels
function feel() {
  const now = pointer !== null && on(...pointer);
  if (now === solid) return;
  window.doji.solid(solid = now);
  document.body.classList.toggle('hand', solid);
  clearTimeout(hint);
  if (solid && !hinted) hint = setTimeout(() => { if (mode === 'idle' && !sayUntil) { hinted = true; say('hint'); } }, HINT_AFTER_MS);
}
addEventListener('mousemove', (e) => {
  if (held) {
    const dx = e.screenX - held.x, dy = e.screenY - held.y;
    if (held.moved || Math.hypot(dx, dy) > 4) {
      held.moved = true;
      window.doji.drag(dx, dy);
      held.x = e.screenX;
      held.y = e.screenY;
    }
    return;
  }
  pointer = [e.clientX, e.clientY];
  feel();
});
addEventListener('mousedown', (e) => { if (solid) held = { x: e.screenX, y: e.screenY, moved: false }; });
addEventListener('mouseup', (e) => {
  if (held?.moved) window.doji.dropped();
  else if (held) {
    if (mode === 'journal') choose(e.clientX);
    else if (!journalNow() && !briefing()) press(false);
  }
  held = null;
});

// The cursor anywhere on the screen, from the main process: near her, it has her eyes.
function near(x, y) {
  pointer = [x, y];
  const [u, v] = pixel(x, y), dx = u - 237, dy = v - 140, far = Math.hypot(dx, dy);
  cursor = far < NEAR && far > 1 ? [dx / far * LOOK_RANGE, dy / far * LOOK_RANGE * 0.7] : null;
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

addEventListener('resize', fit);
fit();
await Promise.all([load(), document.fonts.load(`800 64px ${TYPE}`), document.fonts.load(`700 16px ${TYPE}`)]);
const start = await window.doji.ready();
talkKey = start.talk;
briefingWaits = start.briefing;
waitsNow(start.trade, start.waiting);
if (start.fresh) say('hello', HELLO_MS);
else if (!start.micOk) say('mic');
else if (start.taken) say('taken');
setInterval(live, FRAME_MS);
requestAnimationFrame(frame);
