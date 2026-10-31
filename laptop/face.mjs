/* Her face on the laptop: the charm's face, with a body that breathes.
   ───────────────────────────────────────────────────────────────────────────
   The same render and the same drawing over it — eyes, highlight, smile,
   thought dots, the listening ring — at the charm's own coordinates, in the
   charm's 466-pixel square, scaled to the window; agree.test.mjs holds the
   numbers to charm/main/face.c. What the laptop adds is the body: she
   breathes and floats a little at rest, leans in to listen, sways while she
   thinks and gives with the loud moments of her voice. Eyes and mouth ride
   the same transform, so they stay on her.

   This page records him and plays her; the main process carries both to her
   door and back, and owns the key, the chart and the window.
   ═══════════════════════════════════════════════════════════════════════════ */
import { FRAME, PCM_RATE, sampler } from './frames.mjs';

/* ─── The charm's face, copied ─────────────────────────────────────────────
   Measured from the drawing of her face over the render, in pixels of the
   charm's 466 × 466 screen, in face_geometry_t's order. */
const F = {
  eye_l: [188.8, 148.0], eye_r: [286.7, 132.6], rx: 8.8, ry: 9.0,
  hl: [4.3, -2.6, 1.8],
  mouth: [244.3, 162.2], mouth_w: 51.0, sag: 9.4, stroke: 3.4,
  tilt: -10.0,
};
const DOTS = [[208, 38, 3.2], [233, 30, 3.8], [258, 38, 3.2]];
const FEATURES = '#0d0c0b', SHINE = '#f2f0ec', THROAT = '#1d0e0b', THOUGHT = '#ead3b6';
// The charm's emeralds, copies of charm/main/palette.h.
const DEEP = '#0e6f5c', ACCENT = '#0c8650', GLOW = '#3cc488', TEAL = '#1f9e93';
const BLINK_EVERY_MS = 4000;
const LOOK_RANGE = 6;
const CONFUSED_MS = 4000;

/* ─── What the laptop adds ─────────────────────────────────────────────────
   Tuned by eye and kept small: she is alive, not busy. The two rhythms differ
   so they never fall into step and repeat like a metronome. She gives from
   her base, the lowest row of the render. */
const BASE = 381;
const BREATH_S = 4.6, BREATH = 0.015;
const BOB_S = 3.3, BOB = 2.5;
const SWAY_S = 2.6, SWAY = 0.026;
const LEAN = 0.02, SQUASH = 0.035, LIFT = 4;
const FRAME_MIN_MS = 33;

/* A recording's ceiling, at the bitrate it is made at, is well inside her
   door's FILE_MAX; agree.test.mjs holds the arithmetic. Shorter than a
   breath is a press he took back. */
const RECORD_MS = 5 * 60_000;
const RECORD_BPS = 32_000;
const RECORD_MIN_MS = 400;

const canvas = document.getElementById('her');
const g = canvas.getContext('2d');
const still = matchMedia('(prefers-reduced-motion: reduce)');

let art, alpha;              // the render with its black made clear, and her shape for clicks
let mode = 'idle';           // idle · listening · thinking · speaking · confused
let briefingWaits = false;
let recorder = null, recording = null;
let audio = null;            // her answer playing: its context, its queue and when her voice starts
let confusedUntil = 0;

/* The render is drawn on black, which on a laptop is a black square. Its
   black is made clear by brightness, and the edge un-darkened by the same
   amount, so the glass keeps its colour to the rim without a dark fringe. */
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
    const a = Math.min(1, Math.max(p[0], p[1], p[2]) / 48);
    if (a > 0) { p[0] /= a; p[1] /= a; p[2] /= a; }
    p[3] = alpha[i] = 255 * a;
  }
  o.putImageData(d, 0, 0);
  art = off;
}

/* ─── Drawing ─────────────────────────────────────────────────────────────── */
const ease = (v, t, rate, dt) => {
  const e = v + (t - v) * (1 - Math.exp(-rate * dt));
  return Math.abs(t - e) < 0.002 ? t : e;
};

function dot(cx, cy, rx, ry, color, opacity = 1) {
  g.globalAlpha = opacity;
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  g.fill();
  g.globalAlpha = 1;
}

/* A smile through its two ends and its lowest point, turned through F.tilt
   with her head. The charm draws the arc of the circle those points lie on;
   at this size the arc and this curve are the same line. */
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

const V = { open: 0, gx: 0, gy: 0, mouth: 0, smile: 1, dots: 0, confused: 0, lid: 1, lean: 0, sway: 0, squash: 0 };
const gaze = [0, 0];
let nextGlance = 0, nextBlink = 0, blinkAt = 0, blinking = false, level = 0;

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

// The listening ring round the rim, Doji's emeralds turning through it.
function ring() {
  const conic = g.createConicGradient(-Math.PI / 2, 233, 233);
  [DEEP, ACCENT, GLOW, TEAL, DEEP].forEach((c, i) => conic.addColorStop(i / 4, c));
  g.strokeStyle = conic;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(233, 233, 228, 0, 2 * Math.PI);
  g.stroke();
}

// The briefing waits: an emerald dot with a glow, low beside her.
function waits() {
  g.save();
  g.shadowColor = ACCENT;
  g.shadowBlur = 22;
  dot(404, 404, 16, 16, GLOW);
  g.restore();
}

/* The charm's tick, then the body. Each value eases toward what the mode asks
   for, so nothing jumps between modes. */
function tick(now, dt) {
  const m = mode;
  let tOpen = 1, tMouth = 0, tSmile = 1, tDots = 0, tConfused = 0, glance = 1, fixed = null;
  const pondering = [Math.floor(now / 1700) % 2 ? -LOOK_RANGE * 0.55 : LOOK_RANGE * 0.9, -LOOK_RANGE];
  if (m === 'listening') { tSmile = 1.1; fixed = [0, -2]; }
  if (m === 'speaking')  { tMouth = level; tSmile = 0.9; glance = 0.4; }
  if (m === 'thinking')  { tOpen = 0.85; tSmile = 0.25; tDots = 1; fixed = pondering; }
  if (m === 'confused')  { tSmile = -0.35; tConfused = 1; fixed = [3, -2.5]; }

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
  g.save();
  g.translate(233, BASE - BOB * bob - LIFT * V.squash);
  g.rotate(SWAY * V.sway);
  g.scale(sx, sy);
  g.translate(-233, -BASE);
  g.drawImage(art, 0, 0);
  features(now);
  g.restore();
  if (mode === 'listening') ring();
  if (briefingWaits) waits();
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (now - last < FRAME_MIN_MS) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.033);
  last = now;
  hearing();
  if (mode === 'confused' && now >= confusedUntil) mode = 'idle';
  tick(now, dt);
  draw(now);
}

function fit() {
  canvas.width = Math.round(innerWidth * devicePixelRatio);
  canvas.height = Math.round(innerHeight * devicePixelRatio);
}

/* ─── Her voice ─────────────────────────────────────────────────────────────
   Played as it arrives, each part queued after the last. Her silence while
   she thinks is exact zeros, so the first sample above nothing is her voice,
   as on the charm: thinking until it plays, speaking from then until the
   answer has played to its end. */
function voice() {
  if (!audio) {
    const ctx = new AudioContext({ sampleRate: PCM_RATE });
    const gain = ctx.createGain(), meter = ctx.createAnalyser();
    meter.fftSize = 512;
    gain.connect(meter).connect(ctx.destination);
    audio = { ctx, gain, meter, sample: sampler(), next: 0, voiceAt: Infinity, done: false, playing: new Set() };
  }
  return audio;
}

function play(kind, bytes) {
  if (mode !== 'thinking' && mode !== 'speaking') return;
  const a = voice();
  if (kind === FRAME.volume) { a.gain.gain.value = bytes[0] / 100; return; }
  if (kind !== FRAME.voice) return;
  const samples = a.sample(bytes);
  if (!samples.length) return;
  const buffer = a.ctx.createBuffer(1, samples.length, PCM_RATE);
  buffer.copyToChannel(samples, 0);
  const part = a.ctx.createBufferSource();
  part.buffer = buffer;
  part.connect(a.gain);
  const at = Math.max(a.next, a.ctx.currentTime + 0.05);
  part.start(at);
  part.onended = () => a.playing.delete(part);
  a.playing.add(part);
  a.next = at + buffer.duration;
  if (a.voiceAt === Infinity && samples.some(s => s !== 0)) a.voiceAt = at;
}

function silence() {
  if (!audio) return;
  for (const part of audio.playing) part.stop();
  audio.ctx.close();
  audio = null;
  level = 0;
}

// Once a frame: how loud she is now, and whether she has started or finished.
function hearing() {
  if (!audio) { level = 0; return; }
  const { ctx, meter } = audio;
  if (mode === 'thinking' && ctx.currentTime >= audio.voiceAt) mode = 'speaking';
  const wave = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(wave);
  level = Math.min(1, 4 * Math.sqrt(wave.reduce((n, s) => n + s * s, 0) / wave.length));
  if (audio.done && ctx.currentTime >= audio.next) { silence(); mode = 'idle'; }
}

function trouble() {
  recorder?.stop();
  silence();
  mode = 'confused';
  confusedUntil = performance.now() + CONFUSED_MS;
}

/* ─── Him ───────────────────────────────────────────────────────────────────
   The microphone is opened at the press and closed with the recording, so
   macOS shows it in use only while she listens. */
async function listen() {
  try {
    recording = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    return trouble();
  }
  const chunks = [], began = performance.now();
  recorder = new MediaRecorder(recording, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: RECORD_BPS });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    recording.getTracks().forEach(t => t.stop());
    recorder = null;
    if (mode !== 'listening') return;
    if (performance.now() - began < RECORD_MIN_MS) { window.doji.hush(); mode = 'idle'; return; }
    mode = 'thinking';
    window.doji.ask(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  };
  recorder.start();
  mode = 'listening';
  setTimeout(() => { if (mode === 'listening' && recorder) recorder.stop(); }, RECORD_MS);
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
  starting = true;
  const seen = chart ? window.doji.look() : null;
  await listen();
  starting = false;
  if (stopped) { stopped = false; recorder?.stop(); }
  if (seen && !await seen) { window.doji.hush(); trouble(); }
}

function click() {
  if (mode === 'idle' && briefingWaits) { mode = 'thinking'; window.doji.briefing(); return; }
  press(false);
}

/* ─── Her shape, for the mouse ──────────────────────────────────────────────
   The window lets clicks through but where she is drawn; the briefing's dot
   counts as her. A press that moves is a drag, and one that does not is a
   click. */
const on = (x, y) => {
  const u = Math.round(x * 466 / innerWidth), v = Math.round(y * 466 / innerHeight);
  if (briefingWaits && Math.hypot(u - 404, v - 404) < 22) return true;
  return u >= 0 && v >= 0 && u < 466 && v < 466 && alpha[v * 466 + u] > 64;
};
let solid = false, held = null;
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
  const now = on(e.clientX, e.clientY);
  if (now !== solid) window.doji.solid(solid = now);
});
addEventListener('mousedown', (e) => { if (solid) held = { x: e.screenX, y: e.screenY, moved: false }; });
addEventListener('mouseup', () => {
  if (held && !held.moved) click();
  held = null;
});

window.doji.on('press', press);
window.doji.on('frame', play);
window.doji.on('done', () => { if (audio) audio.done = true; else if (mode === 'thinking') mode = 'idle'; });
window.doji.on('trouble', trouble);
window.doji.on('briefing', (yes) => { briefingWaits = yes; });

addEventListener('resize', fit);
fit();
await load();
requestAnimationFrame(frame);
