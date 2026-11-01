/* Her face on the laptop: the charm's face, with a body that breathes.
   ───────────────────────────────────────────────────────────────────────────
   The same render and the same drawing over it — eyes, highlight, smile,
   thought dots, the listening ring — at the charm's own coordinates, in the
   charm's 466-pixel square, scaled to the window; agree.test.mjs holds the
   numbers to charm/main/face.c, and her sounds to charm/main/sound.c. What the
   laptop adds is the body: she breathes and floats a little at rest, looks
   at the cursor when it comes near, leans in to listen, sways while she
   thinks and gives with the loud moments of her voice. Eyes and mouth ride
   the same transform, so they stay on her. And a line above her head, for
   what her face alone cannot say: why something failed, and how to talk.

   This page records him and plays her; the main process carries both to her
   door and back, and owns the key, the chart and the window.
   ═══════════════════════════════════════════════════════════════════════════ */
import { opacity } from './art.mjs';
import { FRAME, PCM_RATE, sampler } from './frames.mjs';
import { ROOM } from './place.mjs';

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
// Doji's colours as the charm has them, copies of charm/main/palette.h.
const DEEP = '#0e6f5c', ACCENT = '#0c8650', GLOW = '#3cc488', TEAL = '#1f9e93';
const INK = '#e6ece9', GROUND = '#070c0a', LINE = '#1c2922';
const BLINK_EVERY_MS = 4000;
const LOOK_RANGE = 6;
const CONFUSED_MS = 4000;

/* ─── The charm's ear and sounds, copied ───────────────────────────────────
   His voice is heard when its level, a sixth of full scale, passes VOICE; a
   recording he never spoke into is let go at SILENT_MS, and the last
   WARN_LEFT of one is ticked, as on the charm. Two notes start her
   listening and two in reverse send what she heard. */
const VOICE = 0.12;
const SILENT_MS = 30_000;
const WARN_LEFT = 30_000;
const LISTEN = [[660.0, 0.07], [990.0, 0.11]];
const SENT = [[990.0, 0.07], [660.0, 0.11]];

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
let mode = 'idle';           // idle · listening · thinking · speaking · confused
let briefingWaits = false;
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
   The charm's own: two notes rising in and dying away, and the tick, two
   8 ms clicks of a high note 110 ms apart — each drawn sample by sample by
   the charm's formula, at the charm's loudness. */
const sounds = () => (cues ??= new AudioContext());

function notes(pair, attack = 400, decay = 22, loud = 6000 / 32768) {
  const ctx = sounds(), rate = ctx.sampleRate;
  const parts = pair.map(([hz, s]) => Array.from({ length: Math.round(rate * s) }, (_, i) => {
    const t = i / rate;
    return Math.sin(2 * Math.PI * hz * t) * Math.min(1, t * attack) * Math.exp(-t * decay) * loud;
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

const V = {
  open: 0, gx: 0, gy: 0, mouth: 0, smile: 1, dots: 0, confused: 0, lid: 1, lean: 0, sway: 0, squash: 0, heard: 0,
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

/* The listening ring round the rim, Doji's emeralds turning through it. It
   swells with his voice, so he sees she hears him, and in a recording's last
   WARN_LEFT it empties toward the end. */
function ring(part) {
  const conic = g.createConicGradient(-Math.PI / 2, 233, 233);
  [DEEP, ACCENT, GLOW, TEAL, DEEP].forEach((c, i) => conic.addColorStop(i / 4, c));
  g.strokeStyle = conic;
  g.lineWidth = 5 + 9 * V.heard;
  g.lineCap = 'round';
  g.beginPath();
  // Inside her square at its widest, or the window's edge cuts it.
  g.arc(233, 233, 222, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * part);
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
   for, so nothing jumps between modes. At rest, a cursor near her has her
   eyes; otherwise she glances about, as on the charm. */
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
  if (mode === 'listening') ring(Math.min(1, (RECORD_MS - (now - listen.began)) / WARN_LEFT));
  if (briefingWaits) waits();
}

/* What she hears and does keeps its own clock; only her drawing waits on the
   screen. A window on a desktop he is not looking at is not drawn, and a
   turn asked from another desktop must still listen, answer and end. */
function live() {
  const now = performance.now();
  hearing();
  hearingHim(now);
  if (mode === 'confused' && now >= confusedUntil) mode = 'idle';
  if (sayUntil && now >= sayUntil) unsay();
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const resting = mode === 'idle' && !cursor;
  if (now - last < (resting ? REST_FRAME_MS : FRAME_MS)) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.033);
  last = now;
  step(now, dt);
  draw(now);
}

/* Her square at the bottom of the room, drawn at the screen's own density —
   which changes when the window moves to another screen. */
function fit() {
  const side = Math.round(innerHeight / ROOM.height);
  canvas.style.width = canvas.style.height = `${side}px`;
  canvas.width = canvas.height = Math.round(side * devicePixelRatio);
  // Above the ring, in the room over her head.
  said.style.bottom = `${side + 2}px`;
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', fit, { once: true });
}

/* ─── Her voice ─────────────────────────────────────────────────────────────
   Played from one queue in the audio thread (voice.mjs), which holds a
   moment of her voice before it starts and plays it sample by sample, so her
   first words come whole. It says when her voice first sounds — thinking
   until then, as on the charm — and when the answer has played to its end.
   Its module loads while her first frames arrive; they wait for it. */
function voice() {
  if (!audio) {
    const ctx = new AudioContext({ sampleRate: PCM_RATE });
    const a = audio = { ctx, gain: ctx.createGain(), meter: ctx.createAnalyser(), sample: sampler(),
                        player: null, waiting: [], voiced: false, drained: false };
    a.meter.fftSize = 512;
    a.gain.connect(a.meter).connect(ctx.destination);
    ctx.audioWorklet.addModule('voice.mjs').then(() => {
      if (audio !== a) return;
      a.player = new AudioWorkletNode(ctx, 'voice', { outputChannelCount: [1] });
      a.player.connect(a.gain);
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
  if (kind === FRAME.volume) { a.gain.gain.value = bytes[0] / 100; return; }
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

// Once a frame: how loud she is now, and whether she has started or finished.
function hearing() {
  if (!audio) { level = 0; return; }
  if (mode === 'thinking' && audio.voiced) { mode = 'speaking'; unsay(); }
  level = loudness(audio.meter);
  if (audio.drained) { silence(); mode = 'idle'; }
}

// And how loud he is, while she listens: the ring, the silence that lets go, the tick.
function hearingHim(now) {
  if (mode !== 'listening' || !ear) { heard = 0; return; }
  heard = loudness(ear);
  if (heard > VOICE) listen.spoke = true;
  const elapsed = now - listen.began;
  if (!listen.spoke && elapsed >= SILENT_MS) { letGo(); say('silent'); return; }
  if (!listen.warned && elapsed >= RECORD_MS - WARN_LEFT) { listen.warned = true; tick(); }
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
  sounds().createMediaStreamSource(recording).connect(ear);
  recorder = new MediaRecorder(recording, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: RECORD_BPS });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    const short = performance.now() - listen.began < RECORD_MIN_MS, kept = mode === 'listening';
    release();
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

// The microphone closed and forgotten.
function release() {
  recording?.getTracks().forEach(t => t.stop());
  recording = recorder = ear = null;
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

// Through the main process, as the key is, so she stays for the turn wherever he is.
const click = () => briefing() || window.doji.talk();

/* ─── Her shape, for the mouse ──────────────────────────────────────────────
   The window lets clicks through but where she is drawn; the briefing's dot
   counts as her. A press that moves is a drag, and one that does not is a
   click. The first time the cursor rests on her, she says how to talk. */
function pixel(x, y) {
  const r = canvas.getBoundingClientRect();
  return [(x - r.left) * 466 / r.width, (y - r.top) * 466 / r.height];
}

const on = (x, y) => {
  const [u, v] = pixel(x, y).map(Math.round);
  if (briefingWaits && Math.hypot(u - 404, v - 404) < 22) return true;
  return u >= 0 && v >= 0 && u < 466 && v < 466 && alpha[v * 466 + u] > 64;
};
let solid = false, held = null, hinted = false, hint = 0;
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
  if (now === solid) return;
  window.doji.solid(solid = now);
  document.body.classList.toggle('hand', solid);
  clearTimeout(hint);
  if (solid && !hinted) hint = setTimeout(() => { if (mode === 'idle' && !sayUntil) { hinted = true; say('hint'); } }, HINT_AFTER_MS);
});
addEventListener('mousedown', (e) => { if (solid) held = { x: e.screenX, y: e.screenY, moved: false }; });
addEventListener('mouseup', () => {
  if (held && !held.moved) click();
  held = null;
});

// The cursor anywhere on the screen, from the main process: near her, it has her eyes.
function near(x, y) {
  const [u, v] = pixel(x, y), dx = u - 237, dy = v - 140, far = Math.hypot(dx, dy);
  cursor = far < NEAR && far > 1 ? [dx / far * LOOK_RANGE, dy / far * LOOK_RANGE * 0.7] : null;
}

window.doji.on('press', press);
window.doji.on('frame', answer);
window.doji.on('done', () => { if (audio) tell(audio, 'end'); else if (mode === 'thinking') mode = 'idle'; });
window.doji.on('trouble', trouble);
window.doji.on('briefing', (yes) => { briefingWaits = yes; });
window.doji.on('briefing-now', briefing);
window.doji.on('say', (reason, key) => { if (key) talkKey = key; say(reason); });
window.doji.on('cursor', near);

addEventListener('resize', fit);
fit();
await load();
const start = await window.doji.ready();
talkKey = start.talk;
briefingWaits = start.briefing;
if (start.fresh) say('hello', HELLO_MS);
else if (!start.micOk) say('mic');
else if (start.taken) say('taken');
setInterval(live, FRAME_MS);
requestAnimationFrame(frame);
