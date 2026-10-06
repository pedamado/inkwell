// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 17 — hand input for 17d (the caregiver / able-bodied variant): one hand, seen by the webcam
//   Model    MediaPipe HandLandmarker (tasks-vision PINNED 0.10.35, as InkGaze: 0.10.x sends no usage telemetry),
//            VIDEO mode, up to two hands (the one in use is kept), GPU with a CPU fallback
//   Cursor   the INDEX FINGERTIP, from a reach box in the mirrored camera view to the whole screen (the menu, the
//            corners and the pan edges are reachable with the whole hand in view), then a 1€ filter
//   Poses    from the 3D (world) landmarks — joint angles and distances in palm lengths, so they hold at any hand angle
//            and distance — with hysteresis per finger:
//              point · 1 index · 2 index + middle · 3 index + middle + ring (the pinky folded) · the thumb in or out ("L")
//              fist (no long finger) · palm (the four long fingers) · other · none
//            a new pose counts after poseStableMs (a thumb change 1.5 × that; a folding index first waits for a tap)
//   Events   pose (the stable pose changed) · wave (an open hand, two swings ≥ waveMinSwing within waveWindowMs) ·
//            tap (the index curls and straightens within 0.5 s, the hand still: a click where the curl began) ·
//            reach (a 5-s sweep set the box) · status · frame
// The camera image never leaves the device.
// ═══════════════════════════════════════════════════════════════════════════
import { OneEuro, TK, AGENT_RANGE, clamp, lerp } from './core.js';

export const MP_VERSION = '0.10.35';
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION;
export const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
// the part of the mirrored camera view (0…1) that covers the screen until the reach is calibrated: high in the image,
// so the fingertip reaches the menu (screen bottom) while the wrist is still in view
export const DEFAULT_BOX = { x0: 0.18, x1: 0.82, y0: 0.12, y1: 0.66 };
// extension score (0 curled … 1 straight): a finger counts as extended above `extend`, folded below `fold` (in between it
// keeps its state); the thumb is out above `thumbOut` palm lengths from the index knuckle, in below `thumbIn`
export const THRESH = { extend: 0.62, fold: 0.4, thumbOut: 0.8, thumbIn: 0.64 };
export const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
const LONG = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
const TAP_MIN_MS = 60, TAP_MAX_MS = 520, LOST_MS = 260, WAVE_COOLDOWN_MS = 1500;

// ---------------------------------------------------------------------------------------------- geometry + poses
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const mag = (v) => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => mag(sub(a, b));
const angle = (u, v) => Math.acos(clamp((u.x * v.x + u.y * v.y + u.z * v.z) / ((mag(u) * mag(v)) || 1), -1, 1)) * 180 / Math.PI;

// how straight one long finger is, 0 (curled) … 1 (straight): the bend at its middle and end joints, the straightness
// of the whole finger, and whether its tip reaches beyond its middle joint (seen from the wrist)
export function fingerExtension(lm, [m, p, d, t]) {
  const flex = angle(sub(lm[p], lm[m]), sub(lm[d], lm[p])) + angle(sub(lm[d], lm[p]), sub(lm[t], lm[d]));
  const chain = dist(lm[m], lm[p]) + dist(lm[p], lm[d]) + dist(lm[d], lm[t]);
  const straight = dist(lm[m], lm[t]) / (chain || 1);
  const reach = (dist(lm[0], lm[t]) - dist(lm[0], lm[p])) / (dist(lm[0], lm[m]) || 1);
  return (clamp(1 - (flex - 40) / 80, 0, 1) + clamp((straight - 0.6) / 0.32, 0, 1) + clamp((reach + 0.05) / 0.5, 0, 1)) / 3;
}
// the thumb away from the hand (the "L"): its tip ↔ the index knuckle, in palm lengths (tucked ≈ 0.3–0.6 · out ≈ 0.8–1.2)
export function thumbSpread(lm) { return dist(lm[4], lm[5]) / (dist(lm[0], lm[9]) || 1); }

export function poseOf(ext) {
  const { index: i, middle: m, ring: r, pinky: p } = ext;
  if (i && m && r && p) return { pose: 'palm', n: 4 };
  if (!i && !m && !r && !p) return { pose: 'fist', n: 0 };
  if (i && !p && (m || !r)) return { pose: 'point', n: m ? (r ? 3 : 2) : 1 };
  return { pose: 'other', n: 0 };
}
// one frame (21 landmarks; world landmarks preferred) → finger states with hysteresis (prev: the previous frame) → pose
export function classify(lm, prev = null, th = THRESH) {
  const ext = {}, score = {};
  for (const k of Object.keys(LONG)) {
    const e = fingerExtension(lm, LONG[k]); score[k] = e;
    ext[k] = prev ? (prev.ext[k] ? e > th.fold : e >= th.extend) : e >= (th.extend + th.fold) / 2;
  }
  const s = thumbSpread(lm); score.thumb = s;
  const thumb = prev ? (prev.thumb ? s > th.thumbIn : s >= th.thumbOut) : s >= (th.thumbOut + th.thumbIn) / 2;
  return Object.assign({ ext, thumb, score }, poseOf(ext));
}
export const poseKey = (p) => (!p ? 'none' : p.pose === 'point' ? 'point' + p.n + (p.thumb ? '+thumb' : '') : p.pose);

// ---------------------------------------------------------------------------------------------- the thumb's agents
// 1–5 agents with random settings that are always STABLE: Boid.step is a semi-implicit Euler spring, stable while
// b = speed·damp/mass < 2 and k = speed²·spring/mass < 4 − 2b. Kept well inside that, and never sluggish (k ≥ 0.006).
export function agentStable(p) {
  const m = Math.max(0.05, p.mass), b = p.speed * p.damp / m, k = p.speed * p.speed * p.spring / m;
  return b <= 1.4 && k <= 0.6 * (4 - 2 * b) && k >= 0.006;
}
export function randomOrchestra(rand = Math.random) {
  const n = 1 + Math.floor(rand() * 5), out = [], pick = (lo, hi) => lo + (hi - lo) * rand();
  while (out.length < n) {
    let p = null;
    for (let i = 0; i < 80 && !p; i++) {
      const q = { speed: pick(0.15, 0.6), spring: pick(0.12, 0.7), damp: pick(0.35, 1.3), mass: pick(0.4, 2.6), jitter: rand() < 0.3 ? pick(0.005, 0.05) : 0 };
      if (agentStable(q)) p = q;
    }
    p = p || { speed: 0.3, spring: 0.34, damp: 0.75, mass: 1, jitter: 0 };
    for (const k of Object.keys(AGENT_RANGE)) p[k] = Math.round(clamp(p[k], AGENT_RANGE[k][0], AGENT_RANGE[k][1]) * 1000) / 1000;
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- reach + wave
// the reach box from a sweep: the 2nd–98th percentiles of the fingertip, mapped a little inside the screen edges (the
// edges are reached before a full stretch); null when the sweep was too small to trust
export function boxFrom(xs, ys) {
  if (xs.length < 15) return null;
  const q = (a, f) => { const s = a.slice().sort((u, v) => u - v); return s[Math.round(f * (s.length - 1))]; };
  const x0 = q(xs, 0.02), x1 = q(xs, 0.98), y0 = q(ys, 0.02), y1 = q(ys, 0.98);
  if (x1 - x0 < 0.16 || y1 - y0 < 0.12) return null;
  const mx = (x1 - x0) * 0.05, my = (y1 - y0) * 0.05, r = (v) => Math.round(v * 1000) / 1000;
  return { x0: r(x0 + mx), x1: r(x1 - mx), y0: r(y0 + my), y1: r(y1 - my) };
}
// zig-zag on the palm's x: a swing is a run of ≥ minSwing one way; two swings within windowMs (left → right → left) wave
export class WaveDetector {
  constructor() { this.reset(); }
  reset() { this.dir = 0; this.peak = 0; this.hist = []; this.swings = []; }
  feed(x, t, minSwing, windowMs) {
    if (this.dir === 0) {
      this.hist.push({ x, t });
      while (this.hist.length && t - this.hist[0].t > windowMs) this.hist.shift();
      let lo = this.hist[0], hi = this.hist[0];
      for (const s of this.hist) { if (s.x < lo.x) lo = s; if (s.x > hi.x) hi = s; }
      if (hi.x - lo.x >= minSwing) { this.dir = hi.t > lo.t ? 1 : -1; this.peak = this.dir > 0 ? hi.x : lo.x; this.swings = [t]; this.hist = []; }
    } else if (this.dir > 0 ? x > this.peak : x < this.peak) this.peak = x;
    else if (Math.abs(x - this.peak) >= minSwing) { this.dir = -this.dir; this.peak = x; this.swings.push(t); }
    this.swings = this.swings.filter((s) => t - s <= windowMs);
    if (this.swings.length >= 2) { this.reset(); return true; }
    return false;
  }
  get progress() { return this.swings.length; }
}

// ---------------------------------------------------------------------------------------------- MediaPipe
let visionP = null;
function loadVision() {
  if (!visionP) {
    visionP = import(CDN + '/vision_bundle.mjs').then(async (vision) => {
      if (!vision || !vision.HandLandmarker || !vision.FilesetResolver) throw new Error('vision_bundle.mjs has no HandLandmarker');
      return { vision, fileset: await vision.FilesetResolver.forVisionTasks(CDN + '/wasm') };
    });
    visionP.catch(() => { visionP = null; });
  }
  return visionP;
}
export async function createHandLandmarker({ numHands = 2, runningMode = 'VIDEO' } = {}) {
  const { vision, fileset } = await loadVision();
  let err = null;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const lm = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode, numHands,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
      });
      return { lm, delegate };
    } catch (e) { err = e; }
  }
  throw err || new Error('The hand model could not be created');
}

// ---------------------------------------------------------------------------------------------- HandInput
export class HandInput {
  // cfg: the app's settings (read live: handBox, handSmooth, poseStableMs, waveMinSwing, waveWindowMs, handTap)
  // on: { status, pose(p, prev), wave(), tap({x, y}), reach(box | null), frame(this) }
  constructor({ cfg, on = {} }) {
    this.cfg = cfg; this.on = on;
    this.state = 'idle'; this.delegate = ''; this.fps = 0;
    this.video = null; this.stream = null; this.lm = null;
    this.fx = new OneEuro(); this.fy = new OneEuro(); this.wave = new WaveDetector();
    this.pose = null;          // the stable pose {pose, n, thumb} · null: no hand
    this.cls = null;           // the last frame's classification (finger states and scores)
    this.present = false; this.pointing = false; this.cursor = null; this.tip = null; this.img = null;
    this._cand = { key: 'none', t: 0 }; this._seenT = -1e9; this._hist = []; this._tap = null; this._reach = null;
    this._handAt = null; this._palmT = -1e9; this._waveT = -1e9; this._ct = 0; this._fps = { n: 0, t: 0 };
    this._loopOn = false; this._lastTs = 0; this._vt = -1; this._gen = 0;
  }
  _emit(name, ...args) { const f = this.on[name]; if (f) { try { f(...args); } catch (e) { console.error('[hands] ' + name, e); } } }
  _status(state, extra = {}) { this.state = state; this._emit('status', Object.assign({ state }, extra)); }
  get running() { return this.state === 'ready' || this.state === 'tracking'; }

  // the camera, then the model; resolves true when frames are being read
  async start() {
    if (['camera', 'model'].includes(this.state) || this.running) return this.running;
    const gen = ++this._gen;
    try {
      if (window.isSecureContext === false) { this._status('insecure'); return false; }
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) { this._status('nocamera'); return false; }
      this._status('camera');
      try {
        this.stream = await md.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' } });
      } catch (e) {
        const n = e && e.name;
        this._status(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'nocamera' : 'error', { reason: (e && e.message) || String(e) });
        return false;
      }
      const track = this.stream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', () => { if (this.stream && this.stream.getVideoTracks()[0] === track) { this.stop(); this._status('error', { reason: 'the camera was disconnected or stopped by the system' }); } });
      const v = this._ensureVideo();
      v.srcObject = this.stream;
      if (!(v.readyState >= 1 && v.videoWidth)) await new Promise((ok) => v.addEventListener('loadedmetadata', ok, { once: true }));
      try { await v.play(); } catch (e) { if (!e || e.name !== 'AbortError') throw e; }
      if (gen !== this._gen) return false;
      this._status('model');
      if (!this.lm) {
        const r = await createHandLandmarker(); this.lm = r.lm; this.delegate = r.delegate;
        // warm-up: the first inference compiles the GPU shaders (seconds, blocking) — do it while "loading" is shown
        await new Promise((ok) => setTimeout(ok, 60));
        try { this._lastTs = performance.now(); this.lm.detectForVideo(v, this._lastTs); } catch (e) { /* the loop retries */ }
      }
      if (gen !== this._gen) return false;
      this._status(this.pose && this.pose.pose === 'point' ? 'tracking' : 'ready', { delegate: this.delegate });
      this._loop();
      return true;
    } catch (e) {
      this.stop();
      this._status('error', { reason: (e && e.message) || String(e) });
      return false;
    }
  }
  // the hidden <video> stays RENDERED (requestVideoFrameCallback stops for display:none in some browsers): 1 × 1 px
  _ensureVideo() {
    if (this.video) return this.video;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
    v.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;margin:0;padding:0;border:0;';
    document.body.appendChild(v);
    return (this.video = v);
  }
  // one inference per NEW camera frame: requestVideoFrameCallback, else requestAnimationFrame + a currentTime check
  _loop() {
    if (this._loopOn) return;
    this._loopOn = true;
    const v = this.video, gen = this._gen;
    const next = () => { if (!this._loopOn || gen !== this._gen) return; if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else requestAnimationFrame(step); };
    const step = () => {
      if (!this._loopOn || gen !== this._gen) return;
      if (this.lm && v.readyState >= 2 && v.currentTime !== this._vt) {
        this._vt = v.currentTime;
        let t = performance.now(); if (t <= this._lastTs) t = this._lastTs + 0.5; this._lastTs = t;
        let res = null;
        try { res = this.lm.detectForVideo(v, t); } catch (e) { console.warn('[hands] detect', e); }
        if (res) this.feed(res, t);
      }
      next();
    };
    next();
  }
  stop() {
    this._gen++; this._loopOn = false;
    if (this.stream) for (const tr of this.stream.getTracks()) { try { tr.stop(); } catch (e) { /* stopped */ } }
    this.stream = null;
    if (this.video) { try { this.video.pause(); this.video.srcObject = null; } catch (e) { /* gone */ } }
    this.present = false; this.pointing = false;
    if (this.running || ['camera', 'model'].includes(this.state)) this._status('idle');
  }
  destroy() { this.stop(); if (this.lm) { try { this.lm.close(); } catch (e) { /* closed */ } this.lm = null; } if (this.video) { this.video.remove(); this.video = null; } }

  // ------------------------------------------------------------------------------------------ the per-frame pipeline
  // one HandLandmarker result ({landmarks, worldLandmarks}); synthetic results work the same (tests)
  feed(res, t = performance.now()) {
    const i = this._pick(res);
    if (i < 0) { this._absent(t); return; }
    const img = res.landmarks[i], w = res.worldLandmarks && res.worldLandmarks[i];
    const c = classify(w && w.length === 21 ? w : img, this.present ? this.cls : null);
    this.img = img;
    this._process(c, { x: 1 - img[8].x, y: img[8].y }, this._centre(img), { x: 1 - img[0].x, y: img[0].y }, t);
  }
  // tests without landmarks: a pose ('point' n thumb · 'fist' · 'palm' · 'other' · null = no hand), the cursor (screen
  // px), the hand in the camera view (palmX; tipY: the fingertip, for the reach); indexOut false = the index is folded
  inject({ pose = null, n = 0, thumb = false, x = null, y = null, palmX = 0.5, tipY = 0.4, indexOut } = {}, t = performance.now()) {
    if (!pose) { this._absent(t, true); return; }
    const io = indexOut != null ? indexOut : pose === 'point' || pose === 'palm';
    const ext = { index: io, middle: pose === 'palm' || (pose === 'point' && n >= 2), ring: pose === 'palm' || (pose === 'point' && n >= 3), pinky: pose === 'palm' };
    const c = Object.assign({ ext, thumb, score: { index: +io, middle: +ext.middle, ring: +ext.ring, pinky: +ext.pinky, thumb: thumb ? 1 : 0.4 } }, io || pose !== 'point' ? { pose, n } : poseOf(ext));
    this.img = null;
    this._process(c, { x: palmX, y: tipY }, { x: palmX, y: tipY + 0.1 }, { x: palmX, y: tipY + 0.22 }, t, x != null ? { x, y } : null);
  }
  _absent(t, now = false) {
    this.cls = null;
    if (now || t - this._seenT > LOST_MS) {
      this.present = false; this.pointing = false; this.img = null; this._tap = null; this.wave.reset();
      this._candidate(null, t);
      this.pointing = false;
    }
    this._frame(t);
  }
  _process(c, tip, centre, wrist, t, screen = null) {
    if (!this.present) { this.fx.reset(); this.fy.reset(); this._ct = 0; this._hist = []; }
    this._seenT = t; this.present = true; this.cls = c; this.tip = tip; this._handAt = centre;
    this._reachStep(tip, t, c.ext.index);
    this._cursor(tip, t, screen);
    this._tapStep(c, t, wrist);
    this._candidate({ pose: c.pose, n: c.n, thumb: c.thumb }, t, c);
    if (c.pose === 'palm') {   // the wave, frame by frame (a misread frame or two is forgiven)
      this._palmT = t;
      if (this.wave.feed(centre.x, t, +this.cfg.waveMinSwing || 0.1, +this.cfg.waveWindowMs || 1600) && t - this._waveT > WAVE_COOLDOWN_MS) { this._waveT = t; this._emit('wave'); }
    } else if (t - this._palmT > 300) this.wave.reset();
    this.pointing = !!(this.pose && this.pose.pose === 'point');
    this._frame(t);
  }
  _frame(t) {
    const F = this._fps; F.n++;
    if (t - F.t >= 1000) { this.fps = F.n * 1000 / (t - F.t); F.n = 0; F.t = t; }
    this._emit('frame', this);
  }
  _centre(lm) { let x = 0, y = 0; for (const k of [0, 5, 9, 13, 17]) { x += lm[k].x; y += lm[k].y; } return { x: 1 - x / 5, y: y / 5 }; }
  // two hands in view: keep the one in use (the nearest to where it was), else the larger (closer) one
  _pick(res) {
    const L = (res && res.landmarks) || [];
    if (!L.length) return -1;
    if (L.length === 1) return 0;
    if (this.present && this._handAt) {
      let best = -1, bd = 0.3;
      L.forEach((lm, i) => { const c = this._centre(lm), d = Math.hypot(c.x - this._handAt.x, c.y - this._handAt.y); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) return best;
    }
    let best = 0, size = -1;
    L.forEach((lm, i) => { const s = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y); if (s > size) { size = s; best = i; } });
    return best;
  }
  // the fingertip → the screen (the reach box), a 1€ filter in pixels (handSmooth 0 = raw … 1 = smoothest)
  _cursor(tip, t, screen) {
    let p = screen;
    if (!p) {
      const b = this.cfg.handBox || DEFAULT_BOX, W = window.innerWidth, H = window.innerHeight;
      const s = clamp(+this.cfg.handSmooth || 0, 0, 1), dtS = this._ct ? clamp((t - this._ct) / 1000, 0.001, 0.25) : 1 / 30;
      const mc = lerp(3.0, 0.4, s), beta = lerp(0.02, 0.002, s);
      this.fx.set(mc, beta); this.fy.set(mc, beta);
      const x = this.fx.filter((tip.x - b.x0) / Math.max(0.05, b.x1 - b.x0) * W, dtS);
      const y = this.fy.filter((tip.y - b.y0) / Math.max(0.05, b.y1 - b.y0) * H, dtS);
      p = { x: clamp(x, 0, W), y: clamp(y, 0, H) };
    }
    this._ct = t;
    this._hist.push({ t, x: p.x, y: p.y }); if (this._hist.length > 16) this._hist.shift();
    this.cursor = this._tap ? this._tap.at : p;
  }
  _ago(t, ms) {
    for (let i = this._hist.length - 1; i >= 0; i--) if (t - this._hist[i].t >= ms) return { x: this._hist[i].x, y: this._hist[i].y };
    return this._hist.length ? { x: this._hist[0].x, y: this._hist[0].y } : this.cursor;
  }
  // a tap: while the stable pose points, the index folds (≥ 2 frames) and straightens again within TAP_MAX_MS, the wrist
  // still → a click where the fold began (meanwhile the cursor holds there, so it never slides down with the finger)
  _tapStep(c, t, wrist) {
    if (this.cfg.handTap === false || !this.pose || this.pose.pose !== 'point') { this._tap = null; return; }
    const T = this._tap;
    if (!T) {
      if (!c.ext.index) { this._tap = { t0: t, at: this._ago(t, 90), wrist, n: 1 }; this.cursor = this._tap.at; }
      return;
    }
    if (!c.ext.index) { T.n++; if (t - T.t0 > TAP_MAX_MS) this._tap = null; return; }
    this._tap = null;
    const dur = t - T.t0, still = Math.hypot(wrist.x - T.wrist.x, wrist.y - T.wrist.y) < 0.05;
    if (T.n >= 2 && dur >= TAP_MIN_MS && dur <= TAP_MAX_MS && still && T.at) this._emit('tap', { x: T.at.x, y: T.at.y });
  }
  // a new pose counts once it has held poseStableMs (only the thumb changed: 1.5 ×; the index folding from a point:
  // TAP_MAX_MS, so a tap never reads as "rest")
  _candidate(p, t, c = null) {
    const key = poseKey(p);
    if (key !== this._cand.key) this._cand = { key, t };
    if (key === poseKey(this.pose)) return;
    const st = this.pose;
    let need = +this.cfg.poseStableMs || 120;
    if (p && st && p.pose === st.pose && p.n === st.n) need *= 1.5;
    if (st && st.pose === 'point' && c && !c.ext.index && this.cfg.handTap !== false) need = Math.max(need, TAP_MAX_MS);
    if (t - this._cand.t >= need) this._setPose(p);
  }
  _setPose(p) {
    const prev = this.pose;
    this.pose = p ? { pose: p.pose, n: p.n, thumb: !!p.thumb } : null;
    this.pointing = !!(this.pose && this.pose.pose === 'point');
    if (this.pointing && this.state === 'ready') this._status('tracking', { delegate: this.delegate });
    this._emit('pose', this.pose, prev);
  }

  // ------------------------------------------------------------------------------------------ reach calibration
  startReach(ms = 5000) { this._reach = { need: ms, got: 0, last: 0, xs: [], ys: [] }; }
  cancelReach() { this._reach = null; }
  get reaching() { return !!this._reach; }
  get reachProgress() { const R = this._reach; return R ? clamp(R.got / R.need, 0, 1) : 0; }
  reachSweep() {   // the extent swept so far (shown live)
    const R = this._reach; if (!R || R.xs.length < 3) return null;
    return { x0: Math.min(...R.xs), x1: Math.max(...R.xs), y0: Math.min(...R.ys), y1: Math.max(...R.ys) };
  }
  _reachStep(tip, t, pointing) {
    const R = this._reach; if (!R) return;
    if (pointing) { if (R.last) R.got += Math.min(100, t - R.last); R.last = t; R.xs.push(tip.x); R.ys.push(tip.y); } else R.last = 0;
    if (R.got >= R.need) { this._reach = null; this._emit('reach', boxFrom(R.xs, R.ys)); }
  }

  // ------------------------------------------------------------------------------------------ the camera preview
  // the mirrored image, the reach box (dashed red), the swept extent (calibration), the hand (extended fingers and the
  // thumb out in red), the five finger scores (tuning) and the pose
  drawPreview(cv, { label = '', sweep = null, scores = true } = {}) {
    const c = cv.getContext('2d'); if (!c) return;
    const w = cv.width, h = cv.height, v = this.video, u = w / 320;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#ece6d7'; c.fillRect(0, 0, w, h);
    if (v && v.readyState >= 2 && v.videoWidth) {
      c.save(); c.translate(w, 0); c.scale(-1, 1); c.drawImage(v, 0, 0, w, h); c.restore();
      c.fillStyle = 'rgba(250,249,247,0.3)'; c.fillRect(0, 0, w, h);
    }
    if (sweep) { c.fillStyle = 'rgba(230,60,34,0.14)'; c.fillRect(sweep.x0 * w, sweep.y0 * h, (sweep.x1 - sweep.x0) * w, (sweep.y1 - sweep.y0) * h); }
    const b = this.cfg.handBox || DEFAULT_BOX;
    c.save(); c.setLineDash([6 * u, 5 * u]); c.lineWidth = 2 * u; c.strokeStyle = 'rgba(230,60,34,0.9)';
    c.strokeRect(b.x0 * w, b.y0 * h, (b.x1 - b.x0) * w, (b.y1 - b.y0) * h); c.restore();
    const lm = this.present ? this.img : null, cls = this.present ? this.cls : null;
    if (lm) {
      const P = (k) => [(1 - lm[k].x) * w, lm[k].y * h];
      const chain = (ids, on) => {
        c.strokeStyle = on ? TK.red : 'rgba(25,24,23,0.78)'; c.beginPath();
        ids.forEach((k, i) => { const [x, y] = P(k); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
      };
      c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 2.6 * u;
      chain([0, 5, 9, 13, 17, 0], false);
      chain([0, 1, 2, 3, 4], cls && cls.thumb);
      for (const [k, ids] of Object.entries(LONG)) chain(ids, cls && cls.ext[k]);
      const [tx, ty] = P(8); c.beginPath(); c.arc(tx, ty, 5.5 * u, 0, Math.PI * 2); c.fillStyle = TK.red; c.fill();
      c.lineWidth = 1.5 * u; c.strokeStyle = '#fff'; c.stroke();
    }
    if (scores && cls) {   // thumb · index · middle · ring · pinky: how extended each one reads (red = counted as out)
      const keys = ['thumb', 'index', 'middle', 'ring', 'pinky'], bw = 7 * u, bh = 30 * u, gap = 4 * u, y = 8 * u;
      keys.forEach((k, i) => {
        const val = k === 'thumb' ? clamp((cls.score.thumb - 0.4) / 0.8, 0, 1) : clamp(cls.score[k], 0, 1), x = w - 8 * u - (keys.length - i) * (bw + gap);
        c.fillStyle = 'rgba(250,249,247,0.8)'; c.fillRect(x - 1, y - 1, bw + 2, bh + 2);
        c.fillStyle = (k === 'thumb' ? cls.thumb : cls.ext[k]) ? TK.red : 'rgba(25,24,23,0.7)'; c.fillRect(x, y + bh * (1 - val), bw, bh * val);
      });
    }
    if (label) {
      const fs = Math.round(14 * u), bh = Math.round(fs * 1.9);
      c.fillStyle = 'rgba(25,24,23,0.8)'; c.fillRect(0, h - bh, w, bh);
      c.font = `700 ${fs}px 'JetBrains Mono', ui-monospace, monospace`; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = '#fff';
      c.fillText(label, 10 * u, h - bh / 2 + 1);
    }
  }
}
