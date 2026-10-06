// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 16 — core: variants, design tokens, defaults, storage, maths, filters, agents, sound
// A prototype of the SiX research project (FBAUP · FCT 2023.11224.PEX), PI Eliana Penedos-Santiago · https://six.fba.up.pt/
// Interface, expressive line and drawing agents: Pedro Amado (FBAUP / i2ADS). Code: Claude Opus 5.5 (Anthropic), Oct 2026.
// Full credits: README.md.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '16.1.0';
export const BUILD = 'inkwell-16';

// ── the three interaction / testing variants (one app; settings are stored per variant) ──
export const VARIANTS = {
  a: { id: 'a', key: 'inkwell-16a-eyetracker', title: 'Inkwell 16a · eye tracker', short: 'eye tracker (webcam)', input: 'inkgaze', vr: false, page: 'inkwell-16a-eyetracker.html' },
  b: { id: 'b', key: 'inkwell-16b-mouse-cursor', title: 'Inkwell 16b · mouse cursor', short: 'mouse cursor', input: 'mouse', vr: false, page: 'inkwell-16b-mouse-cursor.html' },
  c: { id: 'c', key: 'inkwell-16c-cardboard', title: 'Inkwell 16c · cardboard', short: 'VR head-mount (Cardboard / WebXR)', input: 'head', vr: true, page: 'inkwell-16c-cardboard.html' },
};

// ── design tokens (Figma "HUD Prototype" + "Design System", as in builds 12–15) ──
export const TK = {
  bgCanvas: '#faf9f7', panel: '#f4f1e9', button: '#ffffff', ink: '#191817', label: '#55524c',
  muted: '#9e968a', divider: '#d6d3cc', hairline: '#e8e6e1', red: '#e63c22', redSoft: '#fdeeeb', dot: 'rgba(25,24,23,0.4)',
};

// ── pen colours (v16: black default, deep red, navy blue, white) ──
export const COLORS = {
  black: { hex: '#191817', label: 'Black Color' },   // ink token: ≈17:1 on the paper, softer than #000 (god-ray safe in VR)
  red:   { hex: '#b8261a', label: 'Red Color' },     // deep red, between the brand red #e63c22 and crimson #8e1d0f
  blue:  { hex: '#1d3a6e', label: 'Blue Color' },    // navy
  white: { hex: '#ffffff', label: 'White Color' },   // draws over other colours (near-invisible on the paper by design)
};
export const COLOR_ORDER = ['black', 'red', 'blue', 'white'];

// ── line options: smoothing (1€ filter presets, dossier §7.9) + expression ──
// The 1€ filter runs in DEGREES of visual angle (minCutoff Hz, beta Hz per deg/s), so one preset means the same on a
// laptop screen and on the VR canvas. Fluid ≈ near-raw and alive; Dynamic balanced (speed → width); Rigid heavily
// buffered, constant width (a firm, hard-edged line).
export const LINE_MODES = {
  rigid:   { label: 'Rigid Line',   minCutoff: 0.4, beta: 0.05, expressive: false },
  dynamic: { label: 'Dynamic Line', minCutoff: 1.2, beta: 0.5,  expressive: true },
  fluid:   { label: 'Fluid Line',   minCutoff: 5.0, beta: 1.0,  expressive: true },
};
export const LINE_ORDER = ['rigid', 'dynamic', 'fluid'];

// ── line thickness in visual angle (dossier §7.8: perception-grounded): min · nominal · max (degrees) ──
export const THICKNESS = {
  thin:   { label: 'Thin Line',   min: 0.14, nom: 0.18, max: 0.24 },   // graphite pencil / fine-liner
  medium: { label: 'Medium Line', min: 0.32, nom: 0.40, max: 0.55 },   // felt marker
  thick:  { label: 'Thick Line',  min: 0.70, nom: 0.90, max: 1.20 },   // broad marker (inside the ~1.7° rod-free zone)
};
export const THICKNESS_ORDER = ['thin', 'medium', 'thick'];

// ── drawing modes: freehand + the three grid-visibility forks (build 14) ──
export const GRID_MODES = {
  off:      { label: 'Freehand Mode' },
  always:   { label: 'Grid Mode (on)' },
  feedback: { label: 'Grid Mode (feedback)' },
  hidden:   { label: 'Grid Mode (hidden)' },
};
export const GRID_ORDER = ['off', 'always', 'feedback', 'hidden'];

// ── agents (boids): per-agent physics ranges + presets (builds 13–15) ──
export const AGENT_RANGE = { speed: [0.05, 0.9], spring: [0.05, 0.9], damp: [0.2, 1.6], mass: [0.2, 4.0], jitter: [0, 0.4] };

export const PRESETS = {
  direct:    { label: 'Direct (no agent)',  gazeAmp: 1.0, boidCount: 0 },
  assisted:  { label: 'Assisted (1 agent)', gazeAmp: 1.0, boidCount: 1, boidSpeed: 0.30, boidSpring: 0.34, boidDamp: 0.75, boidMass: 1.0, boidJitter: 0.00 },
  amplified: { label: 'Amplified direct',   gazeAmp: 2.0, boidCount: 0 },
  tremor:    { label: 'Tremor-steady',      gazeAmp: 0.8, boidCount: 1, boidSpeed: 0.24, boidSpring: 0.26, boidDamp: 0.85, boidMass: 1.6, boidJitter: 0.00 },
  limited:   { label: 'Limited motion',     gazeAmp: 2.4, boidCount: 1, boidSpeed: 0.16, boidSpring: 0.14, boidDamp: 0.88, boidMass: 2.4, boidJitter: 0.00 },
  springy:   { label: 'Springy',            gazeAmp: 1.2, boidCount: 1, boidSpeed: 0.50, boidSpring: 0.62, boidDamp: 0.55, boidMass: 0.5, boidJitter: 0.02 },
  calli:     { label: 'Calligraphic',       gazeAmp: 1.5, boidCount: 1, boidSpeed: 0.22, boidSpring: 0.26, boidDamp: 0.70, boidMass: 1.6, boidJitter: 0.00 },
  chorus:    { label: 'Chorus (3 agents)',  gazeAmp: 1.5, boidCount: 3, boidSpeed: 0.30, boidSpring: 0.30, boidDamp: 0.70, boidMass: 1.0, boidJitter: 0.03 },
  swarm:     { label: 'Swarm (5 agents)',   gazeAmp: 2.2, boidCount: 5, boidSpeed: 0.40, boidSpring: 0.36, boidDamp: 0.60, boidMass: 0.8, boidJitter: 0.05 },
};
export const PRESET_KEYS = ['gazeAmp', 'boidCount', 'boidSpeed', 'boidSpring', 'boidDamp', 'boidMass', 'boidJitter'];

// ── defaults (the configuration panel shows every one; saved per variant) ──
export const DEFAULTS = {
  // activation (dossier §7.7 S3 + §7.10)
  menuDwellMs: 800,       // S3: standard dwell 0.8 s (buttons, submenus, intro dots, splash)
  confirmDwellMs: 1200,   // S3: Clear 1.2 s, visibly different, cancelled the moment the gaze leaves
  graceMs: 200,           // exit hysteresis (150–250 ms, §6): a brief exit does not reset a dwell
  hitPad: 0.5,            // effective hit area = visible size + 50 % (S3: interaction-space hitboxes, never overlapping)
  dwellStart: true,       // a dwell on the canvas starts the line (Draw mode on)
  canvasDwellMs: 800,     // ... how long
  dwellStop: false,       // a dwell on the canvas stops the line (off: it caught slow drawing as a stop)
  escapeStop: true,       // the escape saccade (a fast, large look-away) stops the line
  escapePauses: true,     // ... and switches Draw mode back to rest (off: Draw stays armed; the landing point is ignored)
  escapeAmplitude: 0.3,   // escape: share of the screen diagonal (16a / 16b: InkGaze's escape saccade)
  escapeDegS: 160,        // escape: head-flick speed in °/s (16c)
  blinkToggle: false,     // a LONG blink starts / stops the line (16a: deliberate blinks, InkGaze ≥ 0.4 s)
  settleDegS: 6,          // the gaze must slow below this (°/s) before a canvas / grid dwell counts
  dwellRadiusDeg: 1.5,    // canvas dwell tolerance around its anchor (°)
  cursorSmooth: 1.0,      // extra EMA on the reticle (1 = none: InkGaze already smooths)
  cursorDrawing: false,   // the cursor while a line is drawn: hidden (HTC Vive app: a visible cursor makes the eyes drift after it)
  cursorPaused: true,     // the cursor while paused / after an escape or a dwell stop: a dashed light-grey circle

  // line
  lineMode: 'dynamic',
  lineParams: { rigid: [0.4, 0.05], dynamic: [1.2, 0.5], fluid: [5.0, 1.0] },   // 1€ [minCutoff Hz, beta] per line option
  thickness: 'medium',
  color: 'black',
  ppd: 40,                // screen pixels per degree (laptop at ~55 cm ≈ 40; desktop at 70 cm ≈ 50)
  engorge: 0.8,           // nearly still → width grows up to × (1 + engorge)
  slowDegS: 1.0,          // at or below this pen speed the line is at its maximum width
  fastDegS: 18,           // at or above this the line is at its minimum width
  drips: true, dripSpeed: 0.8, dripInt: 220,
  splats: true, splatThr: 1.4, splatInt: 70,

  // agents
  boidCount: 1,           // v16 default: one agent (the pen has weight and inertia)
  boidSpeed: 0.30, boidSpring: 0.34, boidDamp: 0.75, boidMass: 1.0, boidJitter: 0.0,
  preset: 'assisted',

  // amplification + assistive pan
  gazeAmp: 1.0,
  panEnabled: false,      // v16: off by default (the eye tracker covers the whole screen; edge-pan moved the canvas)
  comfortFrac: 0.72, panRate: 0.35, worldScale: 1.5,

  // grid assisted mode
  gridMode: 'off',
  gridSpacingDeg: 3.0, gridDotDeg: 0.8, gridPadDeg: 0.2,

  // VR (16c)
  headGain: 1.0, ipd: 64, distort: 0.0, vrZoom: 1.0, invertX: false, invertY: false, flipH: false, flipV: false,
  followDelayMs: 350,     // the menu waits this long, then eases after the head turn (HTC Vive style)
  followMs: 650,          // ease-in-out duration of the follow
  hudPitchDeg: -26,       // the menu sits below the eyes (downward-glance band −15…−25°, §6)
  stereo: true,

  agents: null,           // the agents' own settings (CRUD in Configuration), saved with the rest
};

// variant-specific starting points ("adapt the interaction design to the mouse cursor / head orientation")
export const VARIANT_DEFAULTS = {
  a: { },
  b: { dwellRadiusDeg: 1.0, settleDegS: 8, escapeAmplitude: 0.3 },
  c: { ppd: 12, cursorSmooth: 0.45, dwellRadiusDeg: 2.0, settleDegS: 8, hitPad: 0.35 },
};

// ── storage (per variant) ──
export const storage = {
  get(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } },
};
// settings of one variant: DEFAULTS < the variant's starting points < what this browser saved for that variant
export const settingsKey = (v) => 'inkwell16.' + v.key + '.settings';
export function defaultsFor(v) { return deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), VARIANT_DEFAULTS[v.id] || {}); }
export function loadSettings(v) {
  const saved = storage.get(settingsKey(v));
  const cfg = deepMerge(defaultsFor(v), saved && saved.schema === 1 ? saved.cfg : {});
  return cfg;
}
// only what differs from the defaults is stored, so a better default in a later build still reaches returning users
export function saveSettings(v, cfg) {
  const d = defaultsFor(v), diff = {};
  for (const k of Object.keys(cfg)) if (k === 'agents' ? Array.isArray(cfg.agents) : JSON.stringify(cfg[k]) !== JSON.stringify(d[k])) diff[k] = cfg[k];
  return storage.set(settingsKey(v), { schema: 1, version: VERSION, savedAt: new Date().toISOString(), cfg: diff });
}
// only keys the defaults know (old / foreign keys are dropped); nested objects merged, arrays replaced
export function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (k === 'agents') { if (Array.isArray(over[k])) base[k] = over[k].slice(0, 8); continue; }
    if (!(k in base)) continue;
    const b = base[k], o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)) deepMerge(b, o);
    else if (Array.isArray(b) ? Array.isArray(o) && o.length === b.length : typeof o === typeof b) base[k] = Array.isArray(o) ? o.slice() : o;
  }
  return base;
}
export function getPath(o, p) { return String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
export function setPath(o, p, v) { const ks = String(p).split('.'), last = ks.pop(); let t = o; for (const k of ks) { if (t[k] == null || typeof t[k] !== 'object') t[k] = {}; t = t[k]; } t[last] = v; }

// ── maths ──
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const withAlpha = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
export const wrapDelta = (d, w) => (w ? ((d % w) + w * 1.5) % w - w / 2 : d);   // shortest signed distance on a ring

// ── 1€ filter (Casiez, Roussel & Vogel 2012), one axis ──
export class OneEuro {
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) { this.set(minCutoff, beta, dCutoff); this.reset(); }
  set(minCutoff, beta, dCutoff = 1) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; }
  reset() { this.x = null; this.dx = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, dt) {
    if (this.x == null || !(dt > 0)) { this.x = v; this.dx = 0; return v; }
    const d = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

// ── an autonomous drawing agent: mass-spring-damper (v7/v9 → builds 13–15), integrated in 60 Hz steps ──
export class Boid {
  constructor(x, y, p) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.dvx = 0; this.dvy = 0; this.ox = 0; this.oy = 0; this.last = null;
    Object.assign(this, p);
  }
  // one 1/60 s step toward (tx, ty) (+ this agent's offset); dxFn gives the signed x distance (wraps on the VR ring)
  step(tx, ty, dxFn) {
    const ovx = this.vx, ovy = this.vy, m = Math.max(0.05, this.mass);
    const dx = dxFn(tx + this.ox - this.x), dy = ty + this.oy - this.y;
    this.vx += ((this.spring * dx - this.damp * this.vx) / m) * this.speed;
    this.vy += ((this.spring * dy - this.damp * this.vy) / m) * this.speed;
    if (this.jitter > 0) { this.vx += (Math.random() - 0.5) * this.jitter * 6; this.vy += (Math.random() - 0.5) * this.jitter * 6; }
    this.x += this.vx * this.speed; this.y += this.vy * this.speed;
    this.dvx = this.vx - ovx; this.dvy = this.vy - ovy;
  }
  speedMag() { return Math.hypot(this.vx, this.vy); }
  dvMag() { return Math.hypot(this.dvx, this.dvy); }
  props() { return { speed: this.speed, spring: this.spring, damp: this.damp, mass: this.mass, jitter: this.jitter }; }
}
export function templateProps(cfg) {
  return { speed: cfg.boidSpeed, spring: cfg.boidSpring, damp: cfg.boidDamp, mass: cfg.boidMass, jitter: cfg.boidJitter };
}
const jit = (v, [lo, hi], f) => clamp(v * (1 + (Math.random() - 0.5) * 2 * f), lo, hi);
export function randomizedProps(cfg) {
  return {
    speed: jit(cfg.boidSpeed, AGENT_RANGE.speed, 0.5), spring: jit(cfg.boidSpring, AGENT_RANGE.spring, 0.5),
    damp: jit(cfg.boidDamp, AGENT_RANGE.damp, 0.4), mass: jit(cfg.boidMass, AGENT_RANGE.mass, 0.6),
    jitter: clamp(cfg.boidJitter + (Math.random() - 0.5) * 0.08, AGENT_RANGE.jitter[0], AGENT_RANGE.jitter[1]),
  };
}

// ── a short, soft chime (Web Audio: no sound files). Needs one user gesture before it can play ──
let audioCtx = null;
export function unlockAudio() {
  try {
    if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio */ }
}
export function chime(pitch = 0) {
  try {
    unlockAudio();
    const ac = audioCtx; if (!ac || ac.state !== 'running') return;
    const t0 = ac.currentTime, out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.18, t0 + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    out.connect(ac.destination);
    const base = 880 * Math.pow(2, pitch / 12);                 // A5, raised a few semitones per dot
    for (const [mult, gain] of [[1, 1], [2.76, 0.22], [5.4, 0.08]]) {   // a bell: fundamental + soft inharmonic partials
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(base * mult, t0);
      g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9 / mult + 0.1);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 1.0);
    }
  } catch (e) { /* no audio */ }
}
