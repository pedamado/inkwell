/*!
 * InkGaze v2.1.0 — drop-in webcam eye tracking for gaze-only drawing.
 * Concept and design: Pedro Amado (FBAUP / i2ADS). Development: Claude Opus 5.5 (Anthropic), October 2026.
 * Part of the SiX research project — Drawing for Social Re-connectivity (FBAUP, University of Porto) — https://six.fba.up.pt/
 * This work is financed by national funds through the Portuguese funding agency, FCT — Fundação para a Ciência e a
 * Tecnologia, within the project «2023.11224.PEX» [DOI 10.54499/2023.11224.PEX].
 *
 * Target users: people with Locked-In Syndrome or ALS; in classic LIS VERTICAL eye movement is the best-preserved
 * channel. Goal: the widest usable eye-movement range with the least calibration. The library shows its settings dialog
 * over the host app, then runs silently and streams plain data objects that any host app can consume.
 *
 * Usage (classic script, ES2020, no build step, no dependencies; MediaPipe tasks-vision FaceLandmarker is loaded at
 * runtime from a PINNED CDN version, see options.mpVersion). Full guide: README.md.
 *   <link rel="stylesheet" href="inkgaze.css"><script src="inkgaze.js"></script>
 *   const ig = new InkGaze({ rate: 60 });
 *   ig.on('data', (p) => draw(p.x, p.y, p.state, p.saccade));   // or window 'inkgaze:data' CustomEvents
 *   await ig.init();                                             // settings dialog -> calibration -> tracking
 *   ig.learn(x, y);  ig.recenter();  ig.openSettings();  ig.destroy();
 *
 * Node (core maths only, no DOM): const { InkGaze, core } = require('./inkgaze.js');
 *
 * Structure of this file
 *   CORE              InkGaze.core: pure, DOM-free gaze maths (features, calibration fit, learning, smoother).
 *                     v2 additions are tagged [v2], v2.1 changes [v2.1] (tuned on a real webcam recording, 2026-10-05).
 *   OPTIONS / CLASS   DEFAULT_OPTIONS and the InkGaze class (constructor, static version/core).
 *   ENGINE            camera, MediaPipe FaceLandmarker, frame loop (one inference per camera frame), states, the data
 *                     stream (packets sent at options.rate Hz, interpolated between camera frames).
 *   API               public methods (init/start/stop/destroy, calibrate/recenter/learn, events, options, recording).
 *   UI: calibration   dot overlay with the shrinking bubble.
 *   UI: settings      <dialog> over the host app.
 *   UI: debug         debug drawer (camera preview, landmarks, quality, fps, recorder).
 *   EXPORT            window.InkGaze in browsers; module.exports = { InkGaze, core } in Node.
 *
 * IMPORTANT: constants tagged (sim) were tuned on a SYNTHETIC simulator; [v2.1] constants on ONE real recording (one
 * user, one laptop webcam). All remain provisional: record more sessions (debug drawer -> Record) and replay them with
 * dev/replay.js.
 */
(function () {
'use strict';

// =====================================================================================================================
// ===== CORE =====
// Grown from sim/pipelines/final.js (the v2 design: judge synthesis of the "minimal", "learning" and "headaware"
// designs, tuned on a synthetic simulator) and re-tuned in [v2.1] on a real webcam recording. Code at column 0; v2
// additions tagged [v2], v2.1 changes [v2.1]. Pure maths: no DOM, no Node APIs.
//
//  per frame   landmarks -> px; per eye: iris centre (mean of 5 iris points) minus eye-corner midpoint, in IMAGE axes,
//              divided by eye WIDTH -> (h, v); both eyes averaged. Lid aperture -> blink gate. Inter-ocular px (distance),
//              eye-centre image position and (optional) head pose from facialTransformationMatrixes. NO blendshapes.
//  gaze vector g = s * G(h + kx*dPsi_x, v + ky*dPsi_y)      G = gnomonic sin->tan linearisation (constant sphereK)
//              dPsi = head yaw/pitch change + eye-centre viewing-angle change since calibration (head:'geo' only),
//              s = iod_cal / iod (distance). With head:'off' (or no pose matrix) dPsi = 0.
//              [v2.1] kx = kappa x headWeight, ky = kx x the measured vertical/horizontal eye-gain ratio (MediaPipe's
//              vertical iris response is ~1/3 of the horizontal one: the same head angle must weigh less on v).
//  per point   blink gate + stability gate around the late-fixation anchor + 20 % trimmed mean -> one row per dot.
//              Rows keep their raw aggregate (h, v, head state): a head-weight change refits without re-calibrating.
//  model       per screen axis: weighted ridge on standardised g (frozen at calibration); intercept free, direct
//              gain ~free, cross term shrunk to 0 by a prior fixed at calibration strength -> 2 dots are enough.
//              [v2.1] + h*v for >= 5 dots spanning both axes ('bilinear'), + h^2, v^2 for a 3x3 grid ('quadratic'),
//              shrunk to 0 by lamNl (real data: the rows of dots are twisted, which a linear map cannot fit).
//              Unresponsive-axis guard (horizontal gaze palsy in LIS): that screen axis becomes intercept-only.
//  output      out = c + reachGain*(model - c) + offset          (c = screen centre)
//  checks      [v2.1] every threshold uses scalePx = max(per-frame noise, errFloor x viewport diagonal ~ 2 deg).
//  learning    learn(frames, sx, sy): known-target fixation -> gate -> new row (model space) -> refit with recency
//              decay -> offset tracker (scalar Kalman + CUSUM) on the residual the refit cannot explain.
//              3 consistent rejections = a shift (bounded). Head movement since the last anchor opens gate + offset.
//  recenter    1-dot offset update, shrunk by its own measurement noise (never makes a good model worse).
//  mirroring   no flag needed for mapping: a mirrored stream flips h, ex and the aligned yaw together; the fit
//              learns the sign. quality().mirrored is DERIVED from the fitted sign (used only for head-pose output).
//  [v2] head pointer (opts.pointer === 'head'; v1's "face-only" mode): the 2-D feature is the face direction
//              (tan yaw, tan pitch from the pose matrix; fallback: nose tip relative to the eye centre / iod) plus the
//              head's viewing angle, through the SAME aggregation, ridge model, learning and recentre.
// Units: px, radians internally; degrees only in headPose(). Design spec: design-spec.md (§ numbers cited below).
// =====================================================================================================================
const core = (function () {

// ------------------------------------------------------------------------------------------------ constants
// Values marked (sim) were tuned on the synthetic simulator and are PROVISIONAL until re-tuned on webcam recordings.
const DEFAULTS = {
  // calibration
  layout: '5',          // [v2.1] '5' centre + 4 corners (default) | '9' 3x3 grid | 'tri' TL, BC, TR | 'diag' (2-dot minimum)
                        // | 'C+tri' | '4'. Real data (2026-10-05): 3 dots cannot model the vertical/horizontal coupling
  inset: 0.08,          // dot inset as a fraction of width/height (0.05..0.25). (sim) 5..12 % within 0.03 deg
  // features
  irisPoints: 5,        // 5 = mean of 468..472 / 473..477 (order-independent); 1 = centre landmark only
  sphereK: 0.42,        // gnomonic constant k = iris-plane radius / eye width (anatomy ~0.33..0.40; 0.42 = mild,
                        // never over-corrects); 0 = off
  distScale: true,      // s = iod_cal / iod (lean in / out); exact under the pinhole model
  head: 'auto',         // 'off' (eyes only) | 'geo' (geometric head compensation) | 'auto' = 'geo' if a pose matrix exists
  kappa: 0.2,           // HORIZONTAL head term at headWeight 1 (eyeball-centre depth behind the canthi / eye width). [v2.1]
                        // 0.25 -> 0.2: on real data 0.25 moved the cursor with the head (user report + within-fixation
                        // regression, 2026-10-05). Under-compensation degrades gracefully
  headWeight: 1,        // [v2.1] user scale of the head term (settings "Head influence" 0..200 %): 0 = eyes only
  kappaRatio: null,     // [v2.1] VERTICAL / horizontal head term. null = measured at calibration: the vertical / horizontal
                        // eye-feature gain ratio (MediaPipe's vertical iris response is ~1/3 of the horizontal one: 0.29
                        // on real data, and the within-fixation vertical head term was 0.08..0.11, not 0.25). Without
                        // it a head nod moved the cursor ~3x more than a head turn of the same angle
  kappaRatioPrior: 0.35, // [v2.1] used when the ratio cannot be measured (2-dot layouts, an axis without eye movement)
  kappaRatioMin: 0.15,  // [v2.1] lower clamp of the measured ratio (upper clamp 1)
  hfovDeg: 70,          // assumed webcam horizontal FOV, ONLY for head-translation compensation (60..80 deg: insensitive)
  poseTauMs: 120,       // runtime low-pass of the head state (pose noise -> cursor); real head motion is < 1 Hz (sim)
  poseShrink: true,     // shrink small head changes by the measured pose noise (protects a still head)
  poseJumpDeg: 8,       // a per-frame pose change larger than this is a tracker glitch: hold the filtered value
                        // (accepted after 3 consecutive frames: a real fast head turn)
  // per-point aggregation
  blinkPt: 0.75,        // calibration: drop frames with aperture < blinkPt * the dot's median aperture (sim)
  gateK: 3,             // stability gate: keep frames within gateK robust SDs of the late-fixation anchor (sim)
  minFrames: 5,         // minimum usable frames per dot / dwell
  estimator: 'trim',    // dot estimate from the kept frames: 'median' | 'trim' (20 % trimmed mean)
  corrFrames: 6,        // frames per statistically independent sample (landmark noise is autocorrelated) (sim)
  // runtime blink gate
  blinkRun: 0.7,        // predict() returns null if aperture < blinkRun * lowest calibrated aperture (sim)
  // model
  model: 'auto',        // [v2.1] 'auto' (by the calibration layout: >= 9 dots on a 3x3 grid -> 'quadratic', >= 5 dots
                        // spanning both axes -> 'bilinear', else 'linear') | 'linear' | 'bilinear' | 'quadratic'
  lamDirect: 1e-3,      // ridge on the direct gains (x<-h, y<-v), standardised scale: essentially free
  lamCross: 1,          // prior pulling cross terms (x<-v, y<-h) to 0, x calibration weight; >= 0.3 needed for '2' dots
  lamNl: 0.25,          // [v2.1] prior pulling the non-linear terms (h*v; h^2, v^2) to 0, x calibration weight. Real data:
                        // the top row of dots was tilted in v, the bottom row was not (a twist a linear map cannot fit)
  snrMin: 1.0,          // axis is DEAD (pinned) if its spread across dots < snrMin x per-frame noise (sim: pure noise
                        // 0.1..0.7 in 32 runs; users with 20-30 % range 1.1..3.6; normal 4.5..13)
  snrWeak: 2.5,         // axis flagged 'weak' below this (host: warn, offer 1-D mode / longer dots)
  reachGain: [1, 1],    // optional gain about the screen centre (>1: less eye travel for full screen; multiplies jitter)
  // validation / quality
  errFloor: 0.04,       // [v2.1] realistic error scale (scalePx) = max(noisePx, errFloor x viewport diagonal): ~2 deg on a
                        // laptop. Real data: per-frame noise 20 px (MediaPipe already smooths) vs 135 px model error, so
                        // every check scaled by noisePx alone failed (the 3-dot check, learn() gate, LOO)
  validateK: 1.5,       // validate(): ok if held-out error <= validateK x scalePx (v2.0: x noisePx)
  looK: 1.2,            // quality().suspect = the worst-LOO dot when its LOO error > looK x scalePx ...
  looRatio: 2.5,        // [v2.1] ... AND > looRatio x the median LOO error of the other dots (>= 6 dots, i.e. the 9-dot
                        // layout): a real outlier, not the extrapolation error every corner dot has
  // learning ("the system learning")
  learnWeight: 0.5,     // weight of a learned row (calibration rows start at 1)
  learnDecay: 0.98,     // every accepted sample multiplies older row weights by this (memory ~50 samples)
  calFloor: 0.3,        // calibration rows never decay below this weight (keeps the screen-wide geometry)
  maxLearned: 40,       // learned rows kept (lowest weight dropped first)
  gateMinK: 1.0,        // learn gate radius = clamp(gateResK * rRes, gateMinK*scalePx, gateMaxK*scalePx)  [v2.1: scalePx]
  gateResK: 3,
  gateMaxK: 5,
  rResInitK: 0.6,       // initial residual scale = rResInitK * scalePx (about one fixation's error)
  qOffsetK: 0.02,       // offset random-walk SD per learned sample, x scalePx (baseline drift allowance) (sim)
  cusumK: 0.5, cusumH: 6, // two-sided CUSUM on normalised residuals: a sustained one-sided bias opens the offset (sim)
  shiftN: 3,            // N consecutive rejections with a consistent residual => accept as a shift ...
  shiftMaxK: 6,         // ... only if |mean residual| <= shiftMaxK x scalePx (~12 deg) and the N residuals agree
                        // within max(2 x residual scale, 0.3 x |mean|)
  // head-movement monitor (drives quality().recenterSuggested)
  movePos: 0.25,        // eye-centre moved > 0.25 inter-ocular distances (~16 mm) ...
  moveScale: 0.15,      // ... or distance changed > 15 % ...
  moveRotDeg: 5,        // ... or head yaw/pitch changed > 5 deg (needs the pose matrix)
  moveOpen: true,       // learn(): when moved, open the gate and the offset (fast re-anchoring after a shift)
                        // quality().recenterSuggested = (moved and head movement not compensated) or >= 2 consecutive
                        // rejected dwells
  // the ONE mirror flag: only affects headPose() output signs. null = derived from the calibration fit
  cameraMirrored: null, // true if the frames given to MediaPipe are mirrored (selfie view baked into the stream)
  // [v2] pointer source. 'eyes' = everything above (default; bit-identical to final.js). 'head' = head-pose pointer
  // (v1's "face-only" mode) through the SAME aggregation / ridge model / learning: see headPointer() in createPipeline.
  pointer: 'eyes',
  headNoseK: 0.4,       // [v2] head pointer WITHOUT a pose matrix: nose-tip depth in front of the eye corners / inter-
                        // ocular distance (canonical face ~0.35..0.45). PROVISIONAL; it only balances the rotation term
                        // against the translation term (the model standardises the feature, so the scale is learned)
};

// ------------------------------------------------------------------------------------------------ layouts
const LAYOUTS = {
  tri: (i) => [[i, i], [0.5, 1 - i], [1 - i, i]],                         // TL, bottom-centre, TR
  'C+tri': (i) => [[0.5, 0.5], [i, i], [0.5, 1 - i], [1 - i, i]],          // centre first, then 'tri'
  diag: (i) => [[i, i], [1 - i, 1 - i]],                                   // 2-dot minimum (TL, BR)
  4: (i) => [[i, i], [1 - i, i], [1 - i, 1 - i], [i, 1 - i]],
  5: (i) => [[0.5, 0.5], [i, i], [1 - i, i], [1 - i, 1 - i], [i, 1 - i]],  // centre, then the corners clockwise
  // [v2.1] centre first (it doubles as the "ready" dot), then clockwise around the edge: short eye jumps
  9: (i) => [[0.5, 0.5], [i, i], [0.5, i], [1 - i, i], [1 - i, 0.5], [1 - i, 1 - i], [0.5, 1 - i], [i, 1 - i], [i, 0.5]],
};
function calibTargets(w, h, opts) {
  const o = Object.assign({}, DEFAULTS, opts);
  return LAYOUTS[o.layout](o.inset).map(([fx, fy]) => ({ sx: fx * w, sy: fy * h }));
}

// ------------------------------------------------------------------------------------------------ helpers
const median = (a) => { const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const madSd = (a, c) => 1.4826 * median(a.map((x) => Math.abs(x - c)));
const trimMean = (a, t = 0.2) => { const s = [...a].sort((p, q) => p - q), k = Math.floor(s.length * t), m = s.slice(k, s.length - k); return m.reduce((x, y) => x + y, 0) / m.length; };
const DEG = Math.PI / 180;

// MediaPipe FaceLandmarker indices. Corners are re-ordered image-left -> image-right, so both eyes and both mirror
// states share one convention; the corner normal n = (-uy, ux) points image-down.
const EYES = [
  { corners: [33, 133], iris: [468, 469, 470, 471, 472], up: 159, lo: 145 },
  { corners: [362, 263], iris: [473, 474, 475, 476, 477], up: 386, lo: 374 },
];

function eyeMeasure(lm, E, vw, vh, nIris) {
  let ax = lm[E.corners[0]].x * vw, ay = lm[E.corners[0]].y * vh, bx = lm[E.corners[1]].x * vw, by = lm[E.corners[1]].y * vh;
  if (ax > bx) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
  const w = Math.hypot(bx - ax, by - ay);
  if (!(w > 1)) return null;
  const ux = (bx - ax) / w, uy = (by - ay) / w, mx = (ax + bx) / 2, my = (ay + by) / 2;
  let ix = 0, iy = 0;
  for (let k = 0; k < nIris; k++) { ix += lm[E.iris[k]].x * vw; iy += lm[E.iris[k]].y * vh; }
  ix /= nIris; iy /= nIris;
  const dUx = (lm[E.lo].x - lm[E.up].x) * vw, dUy = (lm[E.lo].y - lm[E.up].y) * vh;
  return { h: (ix - mx) / w, v: (iy - my) / w, ap: (-dUx * uy + dUy * ux) / w, mx, my };
}

// Head pose from the column-major 4x4 matrix, in the LANDMARK image frame (yaw > 0: face turns towards image +x;
// pitch > 0: chin down / image +y; roll > 0: counter-clockwise in the image). Handedness guard: the face's +X axis
// must point the same image direction as landmark 263 relative to 33. Always true for real MediaPipe (no-op); it
// fixes streams whose landmarks were mirrored after inference (and the simulator, whose matrix is never mirrored).
function readPose(result, lm) {
  const M = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
  if (!M || !M.data || M.data.length < 16) return null;
  const m = M.data, s = Math.hypot(m[0], m[1], m[2]) || 1;
  let yaw = Math.atan2(m[8] / s, m[10] / s), roll = Math.atan2(m[1] / s, m[5] / s);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[9] / s)));
  if (Math.sign(m[0]) !== Math.sign(lm[263].x - lm[33].x)) { yaw = -yaw; roll = -roll; }
  return { yaw, pitch, roll };
}

// Solve a small symmetric system (n <= 5: the ridge normal equations) by Gaussian elimination with partial pivoting.
function solveN(A, b) {
  const n = b.length, M = A.map((r, i) => r.slice(0, n).concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / d; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / (M[r][r] || 1e-12); }
  return x;
}
const ORDER_NAMES = ['linear', 'bilinear', 'quadratic'];

// ------------------------------------------------------------------------------------------------ pipeline
function createPipeline({ screen, video } = {}, opts) {   // a harness `mirrored` flag is deliberately ignored
  const o = Object.assign({}, DEFAULTS, opts);
  const W = screen.w, H = screen.h, cx = W / 2, cy = H / 2;
  const vw = (video && video.w) || 1280, vh = (video && video.h) || 720;
  const fPx = (vw / 2) / Math.tan(o.hfovDeg * DEG / 2);
  const nIris = o.irisPoints === 1 ? 1 : 5;
  // [v2] head pointer: the feature already is a (tan) screen direction, so no gnomonic linearisation and no geometric
  // head compensation (the head IS the pointer). Pointing rotates and translates the head, so the eye-position
  // criterion of the movement monitor is disabled (translation is part of the feature); distance (moveScale) stays.
  const headPtr = o.pointer === 'head';
  if (headPtr) { o.head = 'off'; o.sphereK = 0; o.movePos = 1e9; }

  let neutral = null;       // calibration head state {iod, ex, ey, yaw, pitch, roll, hasPose}
  let useHead = false;       // geometric head compensation active
  let kRatio = o.kappaRatioPrior;   // [v2.1] vertical / horizontal head-term ratio (measured at calibration)
  let kx = 0, ky = 0;        // [v2.1] head-term weights in use, per axis (kappa x headWeight; x kRatio for y)
  let norm = null;           // frozen standardisation {mu, sd, dead, snr, nCal, order}
  let model = null;          // {X: {b0, beta}, Y: {b0, beta}}  (beta: one weight per model term)
  let rows = [];             // {g:[2], e:[h, v], hs:[px, py, s], sd:[2], ap, head, sx, sy, w, cal}
  let apMin = 0, noisePx = 0, scalePx = 0;
  const offset = [0, 0], offP = [0, 0];   // output offset (px) and its variance (learning tracker)
  let rRes = 0;              // running RMS of accepted learning residuals (px)
  let pending = [];          // rejected learn samples (shift detection)
  let cusum = [0, 0, 0, 0];  // CUSUM state (x+, x-, y+, y-) of normalised learning residuals
  let anchor = null;         // head state at the last calibration / recentre / accepted sample
  let hs = null, tPrev = null, headNow = null, glitchRun = 0;  // runtime low-passed head state
  let poseVar = [0, 0];      // per-frame variance of the head change dPsi (rad^2), measured within calibration dots
  const stats = { learned: 0, rejected: 0, shifts: 0, drifts: 0, recenters: 0 };
  let qual = {};

  // ---- per-frame features: {h, v, ap, iod, ex, ey, pose|null}
  //      [v2] + eh, ev, eiod: the raw eye features (image axes) in every pointer mode, for the host packet
  //      (packet.eyes); the maths never reads them. With pointer 'head', h, v and iod are replaced by headPointer().
  function features(result) {
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    if (!lm || lm.length < 478) return null;
    const a = eyeMeasure(lm, EYES[0], vw, vh, nIris), b = eyeMeasure(lm, EYES[1], vw, vh, nIris);
    if (!a || !b) return null;
    const f = {
      h: (a.h + b.h) / 2, v: (a.v + b.v) / 2, ap: (a.ap + b.ap) / 2,
      iod: Math.hypot(b.mx - a.mx, b.my - a.my),
      ex: (a.mx + b.mx) / 2 - vw / 2, ey: (a.my + b.my) / 2 - vh / 2,
      pose: readPose(result, lm),
    };
    f.eh = f.h; f.ev = f.v; f.eiod = f.iod;
    if (headPtr) headPointer(f, lm, result);
    return f;
  }

  // ---- [v2] head pointer feature (pointer 'head'). Where the face direction hits the screen plane, per unit camera
  // distance: tan(face angle) + the head's viewing angle (ex/f, ey/f); the pipeline's s = iod_cal/iod then scales it to
  // the calibration distance, exactly as for the eyes, and the ridge model maps it to the screen (signs are learned:
  // no mirror flag needed; quality().mirrored keeps its meaning because turning right moves the face image-left like
  // the iris). With the pose matrix: yaw / pitch (landmark image frame, readPose). Without: nose tip (landmark 1)
  // relative to the eye-corner midpoint / projected iod / headNoseK (~ tan of the face angle; the vertical rest offset
  // of the nose is a constant that the intercept absorbs). iod is corrected for foreshortening (a turned face shows a
  // shorter inter-ocular distance) so that s keeps measuring distance only.
  function headPointer(f, lm, result) {
    let ax, ay, fore;
    if (f.pose) {
      const m = result.facialTransformationMatrixes[0].data;
      ax = Math.tan(f.pose.yaw); ay = Math.tan(f.pose.pitch);
      fore = Math.hypot(m[0], m[1]) / (Math.hypot(m[0], m[1], m[2]) || 1);   // image-plane share of the face x-axis
    } else {
      const nx = lm[1].x * vw - (f.ex + vw / 2), ny = lm[1].y * vh - (f.ey + vh / 2);
      ax = nx / f.iod / o.headNoseK; ay = ny / f.iod / o.headNoseK;
      fore = 1 / Math.sqrt(1 + ax * ax);                                         // cos(yaw) from tan(yaw) ~ ax
    }
    f.iod /= Math.max(0.5, fore);
    f.h = ax + f.ex / fPx; f.v = ay + f.ey / fPx;
  }

  // ---- head state relative to the calibration neutral: dPsi (rad) and distance ratio s
  function headRaw(f) {
    const s = o.distScale ? neutral.iod / f.iod : 1;
    if (!useHead || !f.pose) return { px: 0, py: 0, s };
    return { px: f.pose.yaw - neutral.yaw + (f.ex - neutral.ex) / fPx, py: f.pose.pitch - neutral.pitch + (f.ey - neutral.ey) / fPx, s };
  }
  // [v2.1] per-axis head-term weights: kx = kappa x headWeight, ky = kx x the vertical / horizontal ratio
  function applyKappa() {
    const base = useHead ? o.kappa * Math.max(0, +o.headWeight || 0) : 0;
    kx = base; ky = base * (o.kappaRatio != null ? o.kappaRatio : kRatio);
  }
  // gaze vector: g = s * G(h + kx*dPsi_x, v + ky*dPsi_y)
  function gaze(f, st) {
    let h = f.h + kx * st.px, v = f.v + ky * st.py;
    if (o.sphereK) { const r = 1 / Math.sqrt(Math.max(0.25, 1 - (h * h + v * v) / (o.sphereK * o.sphereK))); h *= r; v *= r; }
    return [st.s * h, st.s * v];
  }
  // a row's gaze vector from its stored raw aggregate (exact: the same arithmetic as at aggregation)
  const rowG = (r) => gaze({ h: r.e[0], v: r.e[1] }, { px: r.hs[0], py: r.hs[1], s: r.hs[2] });

  // Shrink a head change towards 0 by its noise variance (Wiener / empirical Bayes): a change well above the pose
  // noise is applied fully, pose noise on a still head is (mostly) ignored. var = noise variance of `d`.
  const shrink = (d, v) => (v > 0 && o.poseShrink ? d * (d * d) / (d * d + v) : d);

  // ---- robust aggregation of one fixation (calibration dot, dwell, recentre). Frames: feature objects.
  // 1 blink gate (aperture), 2 per-frame gaze g (head-compensated) -> anchor = median of the second half, 3 keep
  // frames within gateK MAD-SDs of the anchor (per axis), 4 estimate = g(median h, median v, median head change
  // shrunk by its standard error). Returns {g, e (raw h, v), hs (head state px, py, s), sd (per-frame robust SD of raw
  // h, v), ap, n, head} or null. [v2.1] e and hs let a row's g be recomputed when the head weights change.
  function aggregate(frames) {
    let F = frames.filter(Boolean);
    if (F.length < o.minFrames) return null;
    const apMed = median(F.map((f) => f.ap));
    F = F.filter((f) => f.ap >= o.blinkPt * apMed);
    if (F.length < o.minFrames) return null;
    const HS = F.map(headRaw), G = F.map((f, i) => gaze(f, HS[i]));
    const tail = G.slice(G.length >> 1);
    const a = [median(tail.map((g) => g[0])), median(tail.map((g) => g[1]))];
    const sdG = [Math.max(madSd(tail.map((g) => g[0]), a[0]), 1e-5), Math.max(madSd(tail.map((g) => g[1]), a[1]), 1e-5)];
    let keep = G.map((g, i) => i).filter((i) => Math.abs(G[i][0] - a[0]) <= o.gateK * sdG[0] && Math.abs(G[i][1] - a[1]) <= o.gateK * sdG[1]);
    if (keep.length < o.minFrames) keep = G.map((g, i) => i);
    const Fk = keep.map((i) => F[i]), Hk = keep.map((i) => HS[i]), n = keep.length;
    const est = o.estimator === 'trim' ? trimMean : median;
    const h = est(Fk.map((f) => f.h)), v = est(Fk.map((f) => f.v));
    const se2 = (1.2533 * 1.2533) / n;                  // variance of a median of n samples, per unit noise variance
    const st = { px: shrink(median(Hk.map((q) => q.px)), poseVar[0] * se2), py: shrink(median(Hk.map((q) => q.py)), poseVar[1] * se2), s: median(Hk.map((q) => q.s)) };
    return {
      g: gaze({ h, v }, st), e: [h, v], hs: [st.px, st.py, st.s], n,
      sd: [Math.max(madSd(Fk.map((f) => f.h), h), 1e-5), Math.max(madSd(Fk.map((f) => f.v), v), 1e-5)],
      ap: median(Fk.map((f) => f.ap)),
      head: { ex: median(Fk.map((f) => f.ex)) / neutral.iod, ey: median(Fk.map((f) => f.ey)) / neutral.iod, iod: median(Fk.map((f) => f.iod)),
        yaw: useHead ? median(Fk.map((f) => (f.pose ? f.pose.yaw : neutral.yaw))) : null, pitch: useHead ? median(Fk.map((f) => (f.pose ? f.pose.pitch : neutral.pitch))) : null },
    };
  }

  // ---- [v2.1] vertical / horizontal eye-feature gain ratio from the calibration dots' RAW features (head term off):
  // least squares e ~ a + b*sx + c*sy per feature (2 dots: differences), ratio = |dv/dsy| / |dh/dsx| (square pixels:
  // the same visual angle per px on both axes). null when an axis shows no eye movement (spread below snrMin x its
  // per-frame noise: e.g. horizontal gaze palsy) or the dots do not span both axes.
  function measureRatio(R) {
    if (R.length < 2) return null;
    for (let j = 0; j < 2; j++) {
      const m = R.reduce((s, r) => s + r.e[j], 0) / R.length;
      const spread = Math.sqrt(R.reduce((s, r) => s + (r.e[j] - m) ** 2, 0) / R.length);
      if (!(spread >= o.snrMin * median(R.map((r) => r.sd[j])))) return null;
    }
    let gh, gv;
    if (R.length === 2) {
      const dx = R[1].sx - R[0].sx, dy = R[1].sy - R[0].sy;
      if (Math.abs(dx) < 0.1 * W || Math.abs(dy) < 0.1 * H) return null;
      gh = (R[1].e[0] - R[0].e[0]) / dx; gv = (R[1].e[1] - R[0].e[1]) / dy;
    } else {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bh = [0, 0, 0], bv = [0, 0, 0];
      for (const r of R) {
        const x = [1, (r.sx - cx) / W, (r.sy - cy) / H];
        for (let a = 0; a < 3; a++) { bh[a] += x[a] * r.e[0]; bv[a] += x[a] * r.e[1]; for (let c = 0; c < 3; c++) A[a][c] += x[a] * x[c]; }
      }
      for (let a = 1; a < 3; a++) A[a][a] += 1e-9;
      gh = solveN(A, bh)[1] / W; gv = solveN(A, bv)[2] / H;
    }
    const ratio = Math.abs(gv) / Math.abs(gh);
    return isFinite(ratio) && ratio > 0 ? ratio : null;
  }

  // ---- model: per screen axis, ridge on the terms of z = (g - mu)/sd with weighted centring; prior strength fixed at
  // calibration. Terms: z_h, z_v [+ z_h*z_v (bilinear)] [+ z_h^2, z_v^2 (quadratic)] (norm.order, frozen at calibration).
  const terms = (z) => (norm.order >= 2 ? [z[0], z[1], z[0] * z[1], z[0] * z[0], z[1] * z[1]] : norm.order === 1 ? [z[0], z[1], z[0] * z[1]] : [z[0], z[1]]);
  function fitAxis(target, direct) {
    const T = rows.map((r) => terms(zOf(r.g))), n = T.length ? T[0].length : 2;
    const lam = new Array(n).fill(o.lamNl * norm.nCal);
    for (let j = 0; j < 2; j++) lam[j] = (norm.dead[j] ? 1e12 : j === direct ? o.lamDirect : o.lamCross) * norm.nCal;
    let sw = 0, ym = 0;
    const zm = new Array(n).fill(0);
    rows.forEach((r, i) => { sw += r.w; ym += r.w * r[target]; for (let a = 0; a < n; a++) zm[a] += r.w * T[i][a]; });
    for (let a = 0; a < n; a++) zm[a] /= sw;
    ym /= sw;
    const A = lam.map((l, a) => lam.map((_, c) => (a === c ? l : 0))), b = new Array(n).fill(0);
    rows.forEach((r, i) => {
      const d = T[i].map((t, a) => t - zm[a]), y = r[target] - ym;
      for (let a = 0; a < n; a++) { b[a] += r.w * d[a] * y; for (let c = 0; c < n; c++) A[a][c] += r.w * d[a] * d[c]; }
    });
    const beta = solveN(A, b);
    return { b0: ym - beta.reduce((s, v, a) => s + v * zm[a], 0), beta };
  }
  const zOf = (g) => [norm.dead[0] ? 0 : (g[0] - norm.mu[0]) / norm.sd[0], norm.dead[1] ? 0 : (g[1] - norm.mu[1]) / norm.sd[1]];
  const evalModel = (g, m = model) => {
    const t = terms(zOf(g));
    let x = m.X.b0, y = m.Y.b0;
    for (let a = 0; a < t.length; a++) { x += m.X.beta[a] * t[a]; y += m.Y.beta[a] * t[a]; }
    return [x, y];
  };
  const toOut = (p) => ({ x: cx + o.reachGain[0] * (p[0] - cx) + offset[0], y: cy + o.reachGain[1] * (p[1] - cy) + offset[1] });
  const toModel = (sx, sy) => [cx + (sx - offset[0] - cx) / o.reachGain[0], cy + (sy - offset[1] - cy) / o.reachGain[1]];
  function refit() { model = { X: fitAxis('sx', 0), Y: fitAxis('sy', 1) }; }
  // standardisation + unresponsive-axis guard (spread across the calibration dots vs per-frame noise)
  function renorm(order) {
    const cal = rows.filter((r) => r.cal), n = cal.length;
    const mu = [0, 1].map((j) => cal.reduce((s, r) => s + r.g[j], 0) / n);
    const sd = mu.map((u, j) => Math.sqrt(cal.reduce((s, r) => s + (r.g[j] - u) ** 2, 0) / n) || 1e-9);
    const noise = [0, 1].map((j) => median(cal.map((r) => r.sd[j])));
    const snr = [0, 1].map((j) => sd[j] / noise[j]);
    norm = { mu, sd, dead: snr.map((x) => x < o.snrMin), snr, nCal: n, order };
  }
  // [v2.1] model order from the calibration geometry: distinct dot rows / columns (5 % bins of the viewport)
  function chooseOrder(R) {
    const forced = { linear: 0, bilinear: 1, quadratic: 2 }[o.model];
    if (forced != null) return forced;
    const levels = (k, span) => new Set(R.map((r) => Math.round(r[k] / (0.05 * span)))).size;
    const n = R.length, lx = levels('sx', W), ly = levels('sy', H);
    return n >= 9 && lx >= 3 && ly >= 3 ? 2 : n >= 5 && lx >= 2 && ly >= 2 ? 1 : 0;
  }

  function updateQuality() {
    // per-frame noise in screen px: median per-row SD pushed through the model Jacobian at the centre (linear terms)
    const sd = [0, 1].map((j) => median(rows.filter((r) => r.cal).map((r) => r.sd[j])));
    const Jx = [model.X.beta[0] / norm.sd[0], model.X.beta[1] / norm.sd[1]], Jy = [model.Y.beta[0] / norm.sd[0], model.Y.beta[1] / norm.sd[1]];
    const dead = norm.dead, gMax = Math.max(...o.reachGain);
    noisePx = Math.hypot(dead[0] ? 0 : Jx[0] * sd[0], dead[1] ? 0 : Jx[1] * sd[1], dead[0] ? 0 : Jy[0] * sd[0], dead[1] ? 0 : Jy[1] * sd[1]) * gMax;
    // [v2.1] realistic error scale for every check (validate, LOO, learn gate): per-frame noise is NOT the error
    scalePx = Math.max(noisePx, o.errFloor * Math.hypot(W, H) * gMax);
    // leave-one-out residuals (px) of the CALIBRATION rows (needs >= 4 rows); learned rows stay in the fits
    let loo = null, suspect = null;
    const calIdx = rows.map((r, i) => (r.cal ? i : -1)).filter((i) => i >= 0);
    if (rows.length >= 4) {
      const saved = model, all = rows;
      loo = calIdx.map((i) => { rows = all.filter((_, j) => j !== i); refit(); const p = evalModel(all[i].g); return Math.hypot(p[0] - all[i].sx, p[1] - all[i].sy); });
      rows = all; model = saved;
      // [v2.1] a suspect is a real outlier: well above the realistic error AND well above the other dots. Needs >= 6
      // dots: with 5 or fewer, every corner's LOO error is an extrapolation (real data, 5 dots: 170..500 px LOO with
      // no bad dot), so a bad dot cannot be told apart
      const worst = Math.max(...loo), k = loo.indexOf(worst), others = loo.filter((_, i) => i !== k);
      if (loo.length >= 6 && worst > o.looK * scalePx && worst > o.looRatio * median(others)) suspect = k;
    }
    const fitRes = rows.map((r) => { const p = evalModel(r.g); return Math.hypot(p[0] - r.sx, p[1] - r.sy); });
    qual = {
      points: rows.filter((r) => r.cal).length, rows: rows.length, learnedRows: rows.length - rows.filter((r) => r.cal).length,
      noisePx, scalePx, loo, looRms: loo && Math.sqrt(loo.reduce((s, e) => s + e * e, 0) / loo.length), suspect,
      rmsePx: Math.sqrt(fitRes.reduce((s, e) => s + e * e, 0) / fitRes.length),
      axisX: !dead[0], axisY: !dead[1], snr: norm.snr.slice(), weak: norm.snr.map((x) => x < o.snrWeak),
      mirrored: dead[0] ? null : model.X.beta[0] > 0,   // un-mirrored camera: looking right moves the iris image-LEFT
      head: useHead ? 'geo' : 'off', headWeight: o.headWeight, kappa: [kx, ky], kappaRatio: kRatio, model: ORDER_NAMES[norm.order],
    };
  }

  // ---- calibration: points = [{sx, sy, feats:[feature, ...]}]
  function calibrate(points) {
    const all = points.flatMap((p) => p.feats).filter(Boolean);
    if (all.length < o.minFrames) return { ok: false, reason: 'no frames' };
    const withPose = all.filter((f) => f.pose);
    useHead = o.head === 'geo' || (o.head === 'auto' && withPose.length > all.length / 2);
    if (!withPose.length) useHead = false;
    neutral = { iod: median(all.map((f) => f.iod)), ex: median(all.map((f) => f.ex)), ey: median(all.map((f) => f.ey)),
      yaw: withPose.length ? median(withPose.map((f) => f.pose.yaw)) : 0, pitch: withPose.length ? median(withPose.map((f) => f.pose.pitch)) : 0,
      roll: withPose.length ? median(withPose.map((f) => f.pose.roll)) : 0 };
    // per-frame head-change (pose) noise, median over dots; 0 when head compensation is off
    poseVar = [0, 0];
    if (useHead) {
      const per = points.map((p) => p.feats.filter((f) => f && f.pose)).filter((F) => F.length >= o.minFrames).map((F) => {
        const P = F.map(headRaw);
        return [0, 1].map((j) => {   // white-noise variance from frame-to-frame differences (slow real motion excluded)
          const x = P.map((q) => (j ? q.py : q.px)), d = x.slice(1).map((y, i) => y - x[i]);
          return madSd(d, 0) ** 2 / 2;
        });
      });
      if (per.length) poseVar = [0, 1].map((j) => median(per.map((q) => q[j])));
    }
    // [v2.1] two passes: aggregate with the prior head-term ratio, measure the ratio from the raw features, aggregate
    // again with the final per-axis weights (the stability gate works on the head-compensated gaze)
    const build = () => {
      const R = [];
      for (const p of points) { const a = aggregate(p.feats); if (a) R.push({ g: a.g, e: a.e, hs: a.hs, sd: a.sd, ap: a.ap, head: a.head, sx: p.sx, sy: p.sy, w: 1, cal: true }); }
      return R;
    };
    kRatio = o.kappaRatioPrior; applyKappa();
    let R = build();
    if (useHead && o.kappaRatio == null) {
      const m = measureRatio(R);
      if (m != null) { kRatio = Math.min(1, Math.max(o.kappaRatioMin, m)); applyKappa(); R = build(); }
    }
    rows = R;
    if (rows.length < 2) { model = null; return { ok: false, reason: 'fewer than 2 usable dots' }; }
    renorm(chooseOrder(rows));
    apMin = Math.min(...rows.map((r) => r.ap));
    offset[0] = offset[1] = 0; offP[0] = offP[1] = 0; pending = []; cusum = [0, 0, 0, 0]; hs = null; tPrev = null;
    refit(); updateQuality();
    rRes = o.rResInitK * scalePx;
    anchor = headSummary(rows.map((r) => r.head));
    headNow = { ...anchor };
    return { ok: true, ...qual };
  }
  const headSummary = (H) => ({ ex: median(H.map((h) => h.ex)), ey: median(H.map((h) => h.ey)), iod: median(H.map((h) => h.iod)),
    yaw: H[0].yaw == null ? null : median(H.map((h) => h.yaw)), pitch: H[0].pitch == null ? null : median(H.map((h) => h.pitch)) });

  // ---- [v2.1] live head-influence change (settings slider): every row keeps its raw aggregate, so its gaze vector is
  // recomputed exactly with the new weights and the model refitted. No new calibration; offset and learning state kept.
  function setHeadWeight(w) {
    o.headWeight = Math.max(0, +w || 0);
    applyKappa();
    if (!model) return false;
    for (const r of rows) r.g = rowG(r);
    renorm(norm.order); refit(); updateQuality();
    return true;
  }

  // ---- runtime mapping. predict(feature, tMs?) -> {x, y} | null (blink / no model). Unfiltered gaze estimate.
  function predict(f, tMs) {
    if (!model || !f || f.ap < o.blinkRun * apMin) return null;
    const raw = headRaw(f);
    const dt = tMs != null && tPrev != null ? Math.max(1, tMs - tPrev) : 1000 / 30;
    tPrev = tMs != null ? tMs : null;
    if (!hs) hs = { ...raw };
    else {
      const a = 1 - Math.exp(-dt / Math.max(1, o.poseTauMs));
      const glitch = Math.hypot(raw.px - hs.px, raw.py - hs.py) > o.poseJumpDeg * DEG;
      glitchRun = glitch ? glitchRun + 1 : 0;
      if (glitchRun >= 3) { hs.px = raw.px; hs.py = raw.py; glitchRun = 0; }     // persistent: a real fast head turn
      else if (!glitch) { hs.px += a * (raw.px - hs.px); hs.py += a * (raw.py - hs.py); }
      hs.s += a * (raw.s - hs.s);
    }
    if (headNow) {   // slow head-state monitor (eye position, distance, pose) for quality().moved
      const k = 0.05;
      headNow.ex += k * (f.ex / neutral.iod - headNow.ex); headNow.ey += k * (f.ey / neutral.iod - headNow.ey); headNow.iod += k * (f.iod - headNow.iod);
      if (f.pose && headNow.yaw != null) { headNow.yaw += k * (f.pose.yaw - headNow.yaw); headNow.pitch += k * (f.pose.pitch - headNow.pitch); }
    }
    const vf = (1 - Math.exp(-dt / Math.max(1, o.poseTauMs))), k = vf / (2 - vf);   // EMA output variance factor
    return toOut(evalModel(gaze(f, { px: shrink(hs.px, poseVar[0] * k), py: shrink(hs.py, poseVar[1] * k), s: hs.s })));
  }

  function movement(a, b) {
    const pos = Math.hypot(a.ex - b.ex, a.ey - b.ey), scale = Math.abs(Math.log(a.iod / b.iod));
    const rot = a.yaw != null && b.yaw != null ? Math.hypot(a.yaw - b.yaw, a.pitch - b.pitch) / DEG : 0;
    return { pos, scale, rot, moved: pos > o.movePos || scale > Math.log(1 + o.moveScale) || rot > o.moveRotDeg };
  }

  // ---- held-out check of one dot (e.g. the corner dot of the quick start)
  function validate(frames, sx, sy) {
    const a = model && aggregate(frames); if (!a) return null;
    const p = toOut(evalModel(a.g)), errPx = Math.hypot(sx - p.x, sy - p.y);
    return { errPx, ratio: errPx / scalePx, ok: errPx <= o.validateK * scalePx };
  }

  // ---- 1-dot recentre: offset update shrunk by the dot's own measurement noise (empirical Bayes)
  function recenter(frames, sx, sy) {
    const a = model && aggregate(frames); if (!a) return null;
    const p = toOut(evalModel(a.g)), e = [sx - p.x, sy - p.y];
    const sig2 = (noisePx * noisePx / 2) * (Math.PI / 2) * o.corrFrames / Math.max(o.corrFrames, a.n); // var of the dot median
    const tau2 = Math.max(0, (e[0] * e[0] + e[1] * e[1]) / 2 - sig2);
    const gain = tau2 / (tau2 + sig2);
    offset[0] += gain * e[0]; offset[1] += gain * e[1];
    offP[0] = offP[1] = sig2;
    anchor = a.head; headNow = { ...a.head }; pending = []; stats.recenters++;
    return { dx: gain * e[0], dy: gain * e[1], gain, errPx: Math.hypot(e[0], e[1]) };
  }

  // ---- implicit learning from a host-confirmed dwell on a KNOWN target
  function addRow(a, sx, sy, weight) {
    for (const r of rows) r.w = r.cal ? Math.max(o.calFloor, r.w * o.learnDecay) : r.w * o.learnDecay;
    const [mx, my] = toModel(sx, sy);
    rows.push({ g: a.g, e: a.e, hs: a.hs, sd: a.sd, ap: a.ap, head: a.head, sx: mx, sy: my, w: weight, cal: false });
    const learned = rows.filter((r) => !r.cal);
    if (learned.length > o.maxLearned) { const lo = learned.reduce((m, r) => (r.w < m.w ? r : m)); rows.splice(rows.indexOf(lo), 1); }
    refit();
  }
  function learn(frames, sx, sy, weight = o.learnWeight) {
    if (!model) return { accepted: false, reason: 'uncalibrated' };
    const a = aggregate(frames); if (!a) return { accepted: false, reason: 'unstable' };
    const p = toOut(evalModel(a.g)), e = [sx - p.x, sy - p.y], err = Math.hypot(e[0], e[1]);
    // the head moved since the last anchor (calibration / recentre / accepted sample): a shift is plausible, so the
    // gate is opened to its maximum and the offset becomes uncertain again for this sample
    const moved = o.moveOpen && anchor && movement(a.head, anchor).moved;
    const gate = moved ? o.gateMaxK * scalePx : Math.min(o.gateMaxK * scalePx, Math.max(o.gateMinK * scalePx, o.gateResK * rRes));
    if (err > gate) {
      pending.push({ a, sx, sy, e });
      if (pending.length > o.shiftN) pending.shift();
      if (pending.length === o.shiftN) {          // consistent rejections => the user / camera moved: accept as a shift
        const m = [0, 1].map((j) => pending.reduce((s, q) => s + q.e[j], 0) / o.shiftN);
        const spread = Math.max(...pending.map((q) => Math.hypot(q.e[0] - m[0], q.e[1] - m[1])));
        const mag = Math.hypot(m[0], m[1]);
        if (mag <= o.shiftMaxK * scalePx && spread < Math.max(2 * rRes, 0.3 * mag)) {
          offset[0] += m[0]; offset[1] += m[1]; offP[0] = offP[1] = rRes * rRes / 2;
          for (const q of pending) addRow(q.a, q.sx, q.sy, weight);
          anchor = a.head; pending = []; stats.shifts++; updateQuality();
          return { accepted: true, reason: 'shift', errPx: err };
        }
      }
      stats.rejected++;
      return { accepted: false, reason: 'gate', errPx: err, gatePx: gate };
    }
    pending = [];
    // 1) add the row (model space) and refit: gains AND intercept absorb what they can (e.g. a gain error seen on
    //    clustered UI targets). 2) offset tracker (scalar Kalman per axis, random-walk process noise qOffsetK*scalePx
    //    per sample) on the residual the refit could not explain; a two-sided CUSUM on it detects real drift (slump)
    //    and re-opens the offset; head movement since the last anchor does the same.
    addRow(a, sx, sy, weight);
    const q = toOut(evalModel(a.g)); e[0] = sx - q.x; e[1] = sy - q.y;
    const Q = (o.qOffsetK * scalePx) ** 2, R = rRes * rRes / 2;
    for (let j = 0; j < 2; j++) {
      offP[j] += Q + (moved ? e[j] * e[j] : 0);
      if (o.cusumH > 0) {                       // drift detector: a run of same-sign residuals => offset uncertain again
        const z = e[j] / Math.sqrt(R + offP[j]);
        cusum[2 * j] = Math.max(0, cusum[2 * j] + z - o.cusumK); cusum[2 * j + 1] = Math.max(0, cusum[2 * j + 1] - z - o.cusumK);
        if (cusum[2 * j] > o.cusumH || cusum[2 * j + 1] > o.cusumH) { offP[j] += e[j] * e[j]; cusum[2 * j] = cusum[2 * j + 1] = 0; stats.drifts++; }
      }
      const k = offP[j] / (offP[j] + R); offset[j] += k * e[j]; offP[j] *= 1 - k;
    }
    rRes = Math.max(0.3 * scalePx, Math.sqrt(0.9 * rRes * rRes + 0.1 * Math.min(err * err, 9 * rRes * rRes)));
    anchor = a.head; stats.learned++; updateQuality();
    return { accepted: true, reason: 'ok', errPx: err, gatePx: gate };
  }

  // ---- quality / diagnostics
  function quality() {
    if (!model) return { calibrated: false };
    const m = headNow && anchor ? movement(headNow, anchor) : { moved: false };
    const recenterSuggested = (m.moved && !(useHead && kx > 0)) || pending.length >= 2;
    return { calibrated: true, ...qual, offset: offset.slice(), rResPx: rRes, moved: m.moved, recenterSuggested, move: m, ...stats };
  }

  // ---- head pose for the host, USER perspective, degrees, relative to the calibration neutral:
  // yaw > 0 turned to the user's RIGHT, pitch > 0 tilted UP, roll > 0 towards the RIGHT shoulder.
  // cfg.cameraMirrored (boolean) overrides; null = derived from the calibration fit (quality().mirrored).
  function headPose(f) {
    if (!f || !f.pose || !neutral) return null;
    const mir = typeof o.cameraMirrored === 'boolean' ? o.cameraMirrored : !!qual.mirrored;
    const sx = mir ? 1 : -1;   // un-mirrored image: user's right = image -x
    return { yaw: sx * (f.pose.yaw - neutral.yaw) / DEG, pitch: -(f.pose.pitch - neutral.pitch) / DEG, roll: -sx * (f.pose.roll - neutral.roll) / DEG };
  }

  // ---- persistence (localStorage / JSON): everything needed to resume without re-calibrating. [v2.1] state v3: rows
  // carry their raw aggregates (e, hs); the head-term weights and the measured ratio are part of the state.
  function exportState() {
    return model && JSON.parse(JSON.stringify({ v: 3, opts: o, screen: { w: W, h: H }, video: { w: vw, h: vh }, neutral, useHead, kRatio, kx, ky,
      norm, rows, apMin, offset, rRes, poseVar }));
  }
  function importState(s) {
    if (!s || s.v !== 3 || s.screen.w !== W || s.screen.h !== H || s.video.w !== vw || s.video.h !== vh) return false;
    if (!Array.isArray(s.rows) || !s.rows.length || !s.rows.every((r) => Array.isArray(r.e) && Array.isArray(r.hs)) || !s.norm) return false;
    ({ neutral, useHead, norm, rows, apMin, rRes, poseVar } = s); offset[0] = s.offset[0]; offset[1] = s.offset[1];
    kRatio = Number.isFinite(s.kRatio) ? s.kRatio : o.kappaRatioPrior;
    applyKappa();
    if (Math.abs(kx - s.kx) > 1e-12 || Math.abs(ky - s.ky) > 1e-12) { for (const r of rows) r.g = rowG(r); renorm(norm.order); }   // another head weight now
    offP[0] = offP[1] = 0; pending = []; hs = null; refit(); updateQuality();
    anchor = headSummary(rows.filter((r) => r.cal).map((r) => r.head)); headNow = { ...anchor };
    return true;
  }

  return { features, calibrate, predict, recenter, learn, validate, quality, headPose, exportState, importState, setHeadWeight, cfg: o,
    _debug: () => ({ neutral, useHead, norm, model, rows: rows.length, offset, offP, rRes, kx, ky, kRatio }) };
}

// ------------------------------------------------------------------------------------------------ dot collector
// Drives the calibration bubble. push(feature, tMs) per NEW camera frame. A frame is ACCEPTED when: the dot has been
// visible >= settleMs (saccade latency + flight), the eye is open (aperture >= blinkRatio * reference) and the frame
// lies within `tol` (eye-width units) of the median of the last 7 frames AND of the frame 3 frames back ([v2.1]: the
// eye is not moving). The bubble radius
// = r0 * (1 - progress), progress = accepted / need. If the acceptance rate stays low, tol widens (x1.5, twice).
// timedOut => the host moves the dot 30 % towards the centre and retries once (adaptive reach), else skips it.
// need: ~120 accepted frames in total split over the dots (tri 40, C+tri 30, diag 60) — at equal total time fewer,
// longer dots are as accurate as more dots (sim).
function createDotCollector({ need = 40, settleMs = 300, tol = 0.025, timeoutMs = 4000, apRef = null, blinkRatio = 0.6 } = {}) {
  const recent = [], acc = []; let t0 = null, seen = 0, tolNow = tol, widened = 0, apSeen = 0;
  return {
    push(f, tMs) {
      if (t0 === null) t0 = tMs;
      if (f) {
        recent.push(f); if (recent.length > 7) recent.shift();
        apSeen = Math.max(apSeen * 0.98, f.ap);
        const ref = apRef || apSeen, open = f.ap >= blinkRatio * ref;
        if (tMs - t0 >= settleMs && open) {
          seen++;
          const mh = median(recent.map((q) => q.h)), mv = median(recent.map((q) => q.v));
          // [v2.1] + no displacement over the last 3 frames (~100 ms): an eye that keeps moving (drift, pursuit,
          // oscillation) accumulates displacement with the lag, noise does not. Without it a sweeping gaze passed the
          // median test ~40 % of the time and completed every dot.
          const back = recent.length >= 4 ? recent[recent.length - 4] : null;
          if (Math.hypot(f.h - mh, f.v - mv) <= tolNow && (!back || Math.hypot(f.h - back.h, f.v - back.v) <= tolNow)) acc.push(f);
          if (seen >= 30 && acc.length < 0.3 * seen && widened < 2) { tolNow *= 1.5; widened++; seen = 0; }
        }
      }
      const progress = Math.min(1, acc.length / need);
      return { progress, done: progress >= 1, timedOut: tMs - t0 > timeoutMs && progress < 1, accepted: acc.length };
    },
    frames: () => acc.slice(),
  };
}

// ------------------------------------------------------------------------------------------------ output smoother
// Separate drawing stage (never feeds calibration). Fixation-aware centroid (weighted average + saccade detection,
// the family Spakov 2012 / Feit 2017 found best): output = recency-weighted mean of the raw samples since the current
// fixation began (window windowMs). A saccade is CONFIRMED when `confirm` consecutive raw samples lie > jumpK*noisePx
// from the centroid and agree with each other: the window restarts there and `saccade: true` (pen-lift hint).
// Single-frame outliers are ignored. Time-based (same behaviour at 30 or 60 fps). noisePx = quality().noisePx.
// [v2.1] a confirmed saccade also returns jump = {fromX, fromY (the old fixation centroid), toX, toY (the landing
// samples' mean), t0 (last fixation sample), t1 (first landing sample), durationMs = t1 - t0 (an upper bound of the
// flight time)}.
function createSmoother({ noisePx = 60, jumpK = 3, confirm = 2, windowMs = 350 } = {}) {
  let buf = [], cand = [];
  const jump = jumpK * noisePx;
  return function smooth(p, tMs) {
    if (!p) return null;
    let saccade = false, jmp = null;
    if (buf.length) {
      let sx = 0, sy = 0; for (const q of buf) { sx += q.x; sy += q.y; }
      const c = { x: sx / buf.length, y: sy / buf.length };
      if (Math.hypot(p.x - c.x, p.y - c.y) > jump) {
        if (cand.length && Math.hypot(p.x - cand[cand.length - 1].x, p.y - cand[cand.length - 1].y) > jump) cand = [];
        cand.push({ x: p.x, y: p.y, t: tMs });
        if (cand.length >= confirm) {
          let tx = 0, ty = 0; for (const q of cand) { tx += q.x; ty += q.y; }
          const t0 = buf[buf.length - 1].t;
          jmp = { fromX: c.x, fromY: c.y, toX: tx / cand.length, toY: ty / cand.length, t0, t1: cand[0].t, durationMs: cand[0].t - t0 };
          buf = cand; cand = []; saccade = true;
        }
      } else { cand = []; buf.push({ x: p.x, y: p.y, t: tMs }); }
    } else buf.push({ x: p.x, y: p.y, t: tMs });
    while (buf.length > 1 && tMs - buf[0].t > windowMs) buf.shift();
    let sx = 0, sy = 0, sw = 0;
    buf.forEach((q, i) => { const w = i + 1; sx += w * q.x; sy += w * q.y; sw += w; });   // linear recency weights
    const out = { x: sx / sw, y: sy / sw, saccade, fixationMs: tMs - buf[0].t };
    if (jmp) out.jump = jmp;
    return out;
  };
}

// ------------------------------------------------------------------------------------------------ exports (core)
// Same public names as final.js. calibTargets(w, h) and createPipeline(cfg, opts) behave exactly as final.js's
// exports; [v2] calibTargets also accepts final.js's internal optional 3rd argument (e.g. {layout, inset}) so the
// engine can place any layout. `variant` (final.js's ablation helper) and `_util` (shared helpers for the engine) are
// non-enumerable so Object.keys(core) lists exactly the documented contract.
Object.freeze(DEFAULTS.reachGain); Object.freeze(DEFAULTS); Object.freeze(LAYOUTS);
const api = { DEFAULTS, LAYOUTS, calibTargets, createPipeline, createDotCollector, createSmoother };
Object.defineProperties(api, {
  variant: { value: (opts) => ({ calibTargets: (w, h) => calibTargets(w, h, opts), createPipeline: (cfg) => createPipeline(cfg, opts), createDotCollector, createSmoother }) },
  _util: { value: Object.freeze({ median, madSd, trimMean, DEG, EYES, readPose }) },
});
return Object.freeze(api);
})();
// ===== end CORE =====


// =====================================================================================================================
// ===== OPTIONS / CLASS =====
// The class is constructible in Node (core use only): the constructor never touches the DOM; every DOM access in the
// later sections must stay inside methods and be guarded by HAS_DOM.
// =====================================================================================================================
const VERSION = '2.1.0';
const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Default options (public contract). The settings dialog exposes them; ig.setOptions() changes them live where
 * possible and persists them (options.persist).
 * @readonly
 */
const DEFAULT_OPTIONS = Object.freeze({
  source: 'camera',       // 'camera' | 'mouse' (the pointer simulates gaze for hosts without a camera; states, smoother
                          // and events still run)
  cameraId: null,         // MediaDeviceInfo.deviceId; null = browser default (facingMode 'user')
  resolution: '720p',     // '720p' (1280x720) | '480p' (640x480): ideal constraints only
  rate: 60,               // [v2.1] DATA RATE: packets per second sent to the host, 1..250 Hz. The camera measures ~30 times
                          // a second (every camera frame is processed); above the camera's rate positions are
                          // interpolated between frames, below it packets are decimated (the smoother still uses every
                          // frame and a saccade between two packets is never lost)
  pointer: 'eyes',        // 'eyes' | 'head' (head-pose pointer calibrated with the same dots; v1's face-only mode)
  stream: 'full',         // 'eyes' | 'eyes+face' (+ face box) | 'full' (+ head pose + distance): the original three modes
  layout: '5',            // [v2.1] '5' centre + corners (default) | '9' 3x3 grid | 'tri' 3 dots | 'diag' 2 dots
                          // (API also: 'C+tri', '4'). Real data: 3 dots could not fit the vertical/horizontal coupling
  inset: 0.08,            // dot inset as a fraction of the viewport (0.05..0.25)
  dotSeconds: null,       // null = automatic per layout (accepted frames at 30 fps: 5 / 9 dots 24, tri 40, diag 60)
  head: 'auto',           // 'auto' = geometric head compensation when the pose matrix exists | 'off' = eyes only
  headWeight: 1,          // [v2.1] head influence 0..2 (settings: 0..200 %): scales the head compensation live, without
                          // re-calibrating. 1 = tuned default (real data 2026-10-05); 0 = eyes only
  smoothing: 350,         // [v2.1] output smoothing window in ms: 0 (off: raw positions) | 250 | 350 | 500 | 750 | 1000.
                          // v2.0 names still accepted: 'off' 0, 'responsive' 250, 'default' 350, 'steady' 500
  longBlinkMs: 400,       // [v2.1] 'blink' events: a closure at least this long is reported long: true (deliberate;
                          // spontaneous blinks last ~100-400 ms)
  escapeAmplitude: 0.3,   // [v2.1] 'saccade' events: a jump of at least this share of the viewport diagonal, made between
                          // two camera frames (<= 150 ms), is an ESCAPE saccade (escape: true): the pen-up flick
  reachGain: Object.freeze([1, 1]), // 0.5..3 about the screen centre (lockable x == y). WARNING: multiplies jitter and
                          // breaks gaze-cursor correspondence (ArtsIT-2026 "When Gaze Becomes Pointing")
  reachLock: true,        // keep reachGain x == y in the dialog
  cameraMirrored: null,   // null = derived from the calibration fit; affects face box / head pose outputs only
  mpSmoothing: true,      // false = numFaces:2 trick that bypasses MediaPipe's built-in landmark One-Euro filter
                          // (EXPERIMENTAL; the user originally asked for raw data)
  delegate: 'GPU',        // 'GPU' (falls back to CPU) | 'CPU'
  autoStart: false,       // init(): quick-start without the dialog when a matching saved calibration exists
  fullscreen: 'ask',      // 'ask' | 'never'
  showQuality: false,     // brief quality summary after calibration (the original request was no feedback after
                          // calibration; quality is always shown in debug)
  debug: false,           // debug drawer open
  legacyEvents: false,    // also dispatch v1's 'trk:data' / 'trk:status' window events
  persist: true,          // localStorage for settings + calibration
  storageKey: 'inkgaze.v2',
  ui: true,               // false = no settings dialog / debug button (the calibration overlay still shows)
  zIndex: 2147483000,
  mpVersion: '0.10.35',   // PINNED: 0.10.x sends no telemetry; 1.0.x POSTs usage metrics (SiX research ethics)
  cdnBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@',
  modelUrl: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
});

/** Shallow copy of an options object with its own reachGain array (never shares the frozen default). */
function cloneOptions(o) {
  const c = Object.assign({}, o);
  if (Array.isArray(c.reachGain)) c.reachGain = c.reachGain.slice(0, 2);
  else if (typeof c.reachGain === 'number') c.reachGain = [c.reachGain, c.reachGain];
  return c;
}

/**
 * InkGaze — webcam gaze tracker. The ENGINE and API sections add the methods (see the API section for the public
 * contract); the UI sections add the calibration overlay, the settings dialog and the debug drawer.
 * Options precedence: DEFAULT_OPTIONS < persisted settings (localStorage, when persist) < constructor options.
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
 */
class InkGaze {
  constructor(options) {
    /** merged options (internal; public access through getOptions() / setOptions()) */
    this._opts = mergeOptions(options);
    /** last data packet (fresh object per processed frame) or null */
    this.latest = null;
    this._initEngineState();     // ENGINE section; touches no DOM (Node-safe)
  }
}
InkGaze.version = VERSION;
InkGaze.core = core;
InkGaze.DEFAULT_OPTIONS = DEFAULT_OPTIONS;


// =====================================================================================================================
// ===== ENGINE =====
// MediaPipe loader (pinned mpVersion, one FaceLandmarker per session), camera, requestVideoFrameCallback loop with a
// rAF + currentTime fallback (ONE inference per NEW camera frame, strictly increasing integer ms timestamps), per-frame
// processing (core features -> predict -> smoother -> the frame estimate), [v2.1] the DATA STREAM (packets sent at
// options.rate Hz, interpolated / decimated between camera frames), the screen-anchored viewport mapping, states,
// events, persistence, recording, mouse source. Methods are added with mixin() (non-enumerable, redefinable: a later
// section may override a method, e.g. the UI stage overrides _createCalUI). DOM access only inside methods, guarded
// (Node-safe).
//
// UI hooks the UI sections implement (all optional; the engine works without them):
//   this._createCalUI()      -> { show?(), showDot(x, y, info), setBubble(progress, info), pop() -> Promise, hide(),
//                                 showMessage(text, detail?), destroy?() }
//                               (a minimal default is defined below; the UI: calibration section replaces it)
//   this._createSettingsUI() -> { open(), close(), isOpen(), status?(detail), sync?(options), devices?(list),
//                                 destroy?() }   (absent => init() starts + calibrates directly, like ui:false)
//   this._createDebugUI()    -> { toggle(force) -> boolean, frame?(packet), quality?(q), destroy?() }
// =====================================================================================================================

// ------------------------------------------------------------------------------------------------ engine constants
// keys the settings dialog persists; host-level keys (storageKey, persist, ui, zIndex, legacyEvents, CDN/model URLs)
// are never persisted (the host owns them)
const PERSIST_KEYS = ['source', 'cameraId', 'resolution', 'rate', 'pointer', 'stream', 'layout', 'inset', 'dotSeconds',
  'head', 'headWeight', 'smoothing', 'longBlinkMs', 'escapeAmplitude', 'reachGain', 'reachLock', 'cameraMirrored',
  'mpSmoothing', 'delegate', 'autoStart', 'fullscreen', 'showQuality', 'debug'];
// [v2.1] settings schema 2 (rate, headWeight, numeric smoothing; schema 1 is migrated); calibration schema 2 (core
// state v3 + screen geometry: v2.0 calibrations are not reused, a new calibration is needed once)
const SETTINGS_SCHEMA = 2, CAL_SCHEMA = 2;
const ENUMS = {
  source: ['camera', 'mouse'], resolution: ['720p', '480p'], pointer: ['eyes', 'head'], stream: ['eyes', 'eyes+face', 'full'],
  layout: ['5', '9', 'tri', 'diag', 'C+tri', '4'], head: ['auto', 'off'], delegate: ['GPU', 'CPU'], fullscreen: ['ask', 'never'],
};
const EVENT_TYPES = ['data', 'status', 'calibration', 'quality', 'blink', 'saccade'];
const SMOOTH_STEPS = [0, 250, 350, 500, 750, 1000];   // ms (design-spec §9 presets 250/350/500, sim; [v2.1] + 750, 1000)
const SMOOTH_NAMES = { off: 0, responsive: 250, default: 350, steady: 500 };   // v2.0 option values
const RATE_MIN = 1, RATE_MAX = 250;   // Hz (browser timers resolve ~4 ms: 250 Hz is the ceiling)
const STALE_MS = 500;             // no camera frame for this long: no packets (a stalled camera is not repeated forever)
const SACCADE_WIN_MS = 350;       // smoothing 0 (off): the window the saccade detector still uses
// [v2.1] blink detector (lid aperture; works before calibration): closed below BLINK_RATIO x the running open-eye
// aperture; closures of BLINK_MIN_MS..BLINK_MAX_MS that end are 'blink' events (shorter: noise; longer: eyes closed)
const BLINK_RATIO = 0.6, BLINK_MIN_MS = 60, BLINK_MAX_MS = 5000;
const BLINK_BS = 0.5, BLINK_BS_RISE = 0.3;   // eyeBlink blendshape threshold: >= 0.5 and >= 0.3 above the open-eye score
const ESCAPE_MAX_MS = 200;        // an escape saccade lands within this time of leaving the fixation. A big saccade can
                                  // span 2-3 camera frames (main sequence ~2.2 ms/deg + 21 ms; 30 deg ~ 90 ms) and be
                                  // confirmed in parts: same-direction jumps within this window are CHAINED
// accepted frames per dot at 30 fps (scaled by the measured fps, so dots last the same TIME at 60 fps): ~120 in total
// for the 2..3-dot layouts (design-spec §3.3, sim); [v2.1] 24 per dot for 5 and 9 dots (more dots beat longer dots on
// real data, where the model error dominates the per-frame noise)
const NEED = { tri: 40, 'C+tri': 30, diag: 60, 4: 30, 5: 24, 9: 24 };
const READY_NEED = 30;            // ~1 s centre "ready" fixation (apRef + noise for the collector; a row when the layout
                                  // starts at the centre: '5', '9', 'C+tri')
const RECENTER_SECONDS = 2;       // 1-dot recentre: a 2 s centre dot (design-spec §7.1; a 1 s dot hurt a still user)
const QUICK_VALIDATE_NEED = 40;   // held-out corner dot of the quick start (same size as a 'tri' dot)
const QUICK_RECENTER_MAXK = 5;    // quick start fails when the recentre error exceeds 5 x scalePx (design-spec §10;
                                  // [v2.1] scalePx, the realistic error scale, instead of the per-frame noise)
const LOST_MS = 350;              // no face for this long -> state 'lost' (prior art: tracking-lost freeze)
const RING = 96, RING_MS = 800;   // raw feature ring buffer (>= 0.8 s at up to 120 fps) for learn()
const POP_MS = 300, GAP_MS = 150, ABORT_MSG_MS = 3000, QUALITY_MSG_MS = 2500;
const FACE_WAIT_MS = 15000;       // a calibration aborts when no face is seen for this long
const HIDDEN_RELEASE_MS = 10000;  // page hidden this long -> track.enabled = false (camera LED off until visible)
const PERMISSION_HINT_MS = 4000, NO_FRAMES_MS = 8000, ERROR_RUN_MAX = 30;
// the landmark subset the maths uses (+ nose tip / face box points); exactly what recordings store
const LM_SUBSET = [33, 133, 362, 263, 159, 145, 386, 374, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 1, 4, 152, 10, 234, 454];
const FACE_BOX_LM = [10, 152, 234, 454];   // forehead, chin, face edges: the face box (reproducible from a recording)
const IRIS_MM = 11.7;             // human iris diameter (anat, ~11.7 +- 0.5 mm) -> APPROXIMATE camera distance
const MOUSE_NOISE_PX = 10;        // mouse source: nominal noise for the smoother (saccade = jump > 30 px)
const REC_MAX_MS = 120000;        // recordings are bounded to 120 s
const CANCEL = Object.freeze({ cancelled: true });   // thrown through a calibration session on ESC / stop() / destroy()

// ------------------------------------------------------------------------------------------------ engine helpers
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const reportError = (e) => { if (typeof console !== 'undefined') console.error('[InkGaze]', e); };
const finite = (v) => typeof v === 'number' && isFinite(v);
const round = (v, k) => { const m = 10 ** k; return Math.round(v * m) / m; };
const hasRVFC = () => typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
function pick(o, keys) { const r = {}; for (const k of keys) if (o && Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

/** Add methods / accessors to InkGaze.prototype (non-enumerable like class methods; later sections may redefine). */
function mixin(methods) {
  for (const k of Object.getOwnPropertyNames(methods)) {
    const d = Object.getOwnPropertyDescriptor(methods, k);
    d.enumerable = false; d.configurable = true;
    Object.defineProperty(InkGaze.prototype, k, d);
  }
}

/** Validate / clamp an options object in place (unknown enum values fall back to the defaults). */
function sanitize(o) {
  const d = DEFAULT_OPTIONS;
  if (o.layout != null) o.layout = String(o.layout);
  for (const k of Object.keys(ENUMS)) if (!ENUMS[k].includes(o[k])) o[k] = d[k];
  const num = (v, lo, hi, def) => (finite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  o.inset = num(+o.inset, 0.05, 0.25, d.inset);
  o.rate = Math.round(num(+o.rate, RATE_MIN, RATE_MAX, d.rate));
  o.headWeight = round(num(+o.headWeight, 0, 2, d.headWeight), 2);
  const sm = typeof o.smoothing === 'string' && o.smoothing in SMOOTH_NAMES ? SMOOTH_NAMES[o.smoothing] : +o.smoothing;
  o.smoothing = Math.round(num(sm, 0, 2000, d.smoothing));
  o.longBlinkMs = Math.round(num(+o.longBlinkMs, 100, 3000, d.longBlinkMs));
  o.escapeAmplitude = round(num(+o.escapeAmplitude, 0.05, 1, d.escapeAmplitude), 3);
  delete o.maxFps;                                   // v2.0 processing cap: replaced by rate (see mergeOptions)
  o.dotSeconds = o.dotSeconds == null || o.dotSeconds === '' ? null : num(+o.dotSeconds, 0.5, 6, null);
  const rg = Array.isArray(o.reachGain) ? o.reachGain : [o.reachGain, o.reachGain];
  o.reachGain = [num(+rg[0], 0.5, 3, 1), num(+rg[1], 0.5, 3, 1)];
  o.cameraMirrored = typeof o.cameraMirrored === 'boolean' ? o.cameraMirrored : null;
  o.cameraId = typeof o.cameraId === 'string' && o.cameraId ? o.cameraId : null;
  for (const k of ['reachLock', 'mpSmoothing', 'autoStart', 'showQuality', 'debug', 'legacyEvents', 'persist', 'ui']) o[k] = typeof o[k] === 'boolean' ? o[k] : d[k];
  o.zIndex = Math.round(num(+o.zIndex, 0, 2147483647, d.zIndex));
  for (const k of ['storageKey', 'mpVersion', 'cdnBase', 'modelUrl']) if (typeof o[k] !== 'string' || !o[k]) o[k] = d[k];
  return o;
}

// localStorage wrapper: never throws (opaque origins, blocked storage, quota, file://, Node without a polyfill)
const store = {
  ls() { try { return typeof localStorage !== 'undefined' && localStorage ? localStorage : null; } catch (e) { return null; } },
  get(k) { try { const ls = this.ls(), s = ls && ls.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  set(k, v) { try { const ls = this.ls(); if (!ls) return false; ls.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { const ls = this.ls(); if (ls) ls.removeItem(k); } catch (e) { /* blocked */ } },
  keys(prefix) {
    const out = [];
    try { const ls = this.ls(); if (ls) for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.indexOf(prefix) === 0) out.push(k); } } catch (e) { /* blocked */ }
    return out;
  },
};

/** DEFAULT_OPTIONS < persisted settings (schema-checked) < constructor options; sanitised. */
function mergeOptions(options) {
  const host = options && typeof options === 'object' ? cloneOptions(options) : {};
  // v2.0 host option: maxFps was a processing cap; the closest v2.1 meaning is the data rate
  if ('maxFps' in host && !('rate' in host)) host.rate = host.maxFps;
  const o = cloneOptions(DEFAULT_OPTIONS);
  if (host.persist !== false) {
    const key = typeof host.storageKey === 'string' && host.storageKey ? host.storageKey : DEFAULT_OPTIONS.storageKey;
    const saved = store.get(key + ':settings');
    if (saved && (saved.schema === SETTINGS_SCHEMA || saved.schema === 1) && saved.options && typeof saved.options === 'object') {
      const so = cloneOptions(pick(saved.options, PERSIST_KEYS));
      // [v2.1] migrate schema 1 (v2.0): the new default rate; 'tri' was v2.0's default layout -> the new default
      if (saved.schema === 1 && so.layout === 'tri') delete so.layout;
      Object.assign(o, so);
    }
  }
  return sanitize(Object.assign(o, host));
}

// MediaPipe tasks-vision loader: ONE dynamic import per (CDN, version) per page, shared by every instance. Works from
// this classic script (dynamic import() is available in classic scripts). The bundle and the /wasm folder MUST come
// from the same pinned version. A failed load is evicted so a later start() can retry.
const VISION = new Map();
function loadVision(cdnBase, ver) {
  const base = cdnBase + ver;
  let p = VISION.get(base);
  if (!p) {
    p = import(base + '/vision_bundle.mjs').then(async (vision) => {
      if (!vision || !vision.FaceLandmarker || !vision.FilesetResolver) throw new Error('vision_bundle.mjs has no FaceLandmarker');
      const fileset = await vision.FilesetResolver.forVisionTasks(base + '/wasm');
      return { vision, fileset };
    });
    VISION.set(base, p);
    p.catch(() => { if (VISION.get(base) === p) VISION.delete(base); });
  }
  return p;
}

// errors -> { code, message } for status 'error'
function errorInfo(e) {
  if (e && e.igCode) return { code: e.igCode, message: e.message };
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return { code: 'camera-denied', message: 'Camera permission was denied. Allow camera access for this page (address bar / site settings) and start again.' };
  if (n === 'NotFoundError') return { code: 'camera-not-found', message: 'No camera was found. Connect a webcam and start again.' };
  if (n === 'NotReadableError' || n === 'AbortError') return { code: 'camera-busy', message: 'The camera is in use by another application, or it failed to start.' };
  if (n === 'OverconstrainedError') return { code: 'camera-overconstrained', message: 'The camera cannot provide the requested video. Choose another camera or resolution.' };
  return { code: 'error', message: 'Error: ' + ((e && (e.message || e.name)) || String(e)) };
}
const igError = (code, message) => Object.assign(new Error(message), { igCode: code });
// [v2.1] mean of MediaPipe's eyeBlinkLeft / eyeBlinkRight blendshapes (0 open .. 1 closed), null when absent
function blinkScore(r) {
  const B = r && r.faceBlendshapes && r.faceBlendshapes[0], cats = B && (B.categories || B);
  if (!Array.isArray(cats)) return null;
  let s = 0, n = 0;
  for (const c of cats) if (c && (c.categoryName === 'eyeBlinkLeft' || c.categoryName === 'eyeBlinkRight') && finite(c.score)) { s += c.score; n++; }
  return n ? s / n : null;
}
const failure = (reason, message) => Object.assign(new Error(message), { igReason: reason });

mixin({
  // ---------------------------------------------------------------------------------------------- state (Node-safe)
  _initEngineState() {
    this._listeners = { data: new Set(), status: new Set(), calibration: new Set(), quality: new Set(), blink: new Set(), saccade: new Set() };
    this._ac = null;               // AbortController for every page listener (created by _attach)
    this._timers = new Set();      // every setTimeout id (cleared on destroy)
    this._timeScale = 1;           // test hook: scales the UX pauses (pop / gap / messages), never the safety timeouts
    this._destroyed = false; this._headlessMode = false;
    // engine
    this._gen = 0;                 // generation token: callbacks of an older start/stop cycle are ignored
    this._enginePromise = null; this._running = false; this._busy = false; this._hidden = false; this._hiddenTimer = 0;
    this._loopPaused = false; this._opChain = Promise.resolve();
    this._lm = null; this._lmKey = ''; this._lmPromise = null; this._lmPromiseKey = ''; this._delegateUsed = null;
    this._video = null; this._stream = null; this._track = null; this._camKey = ''; this._camAC = null; this._deviceId = null;
    this._devices = []; this._vsize = null; this._wake = null;
    this._vfc = 0; this._raf = 0; this._lastTs = 0; this._lastPF = -1; this._lastVT = -1; this._lastProc = 0;
    this._stats = { frames: 0, dropped: 0, errors: 0, errorRun: 0, fps: 0, inferMs: 0, sent: 0, sentRate: 0 };
    // mapping
    this._pipe = null; this._pipeKey = ''; this._calView = null; this._calGeom = null; this._view = { w: 1280, h: 720 };
    this._iodCal = null; this._mirroredFit = null; this._needsCheck = false; this._confidence = null; this._validation = null;
    this._lastCalibration = null; this._noisePx = 0;
    // per frame
    this._ring = new Array(RING).fill(null); this._ringI = 0;
    this._lastFrameT = 0; this._lastFaceT = -1e9; this._faceSince = null; this._fixStartT = null;
    this._x = null; this._y = null; this._smoother = null; this._smootherKey = ''; this._seq = 0; this._lost = false;
    // [v2.1] data stream: the newest frame estimate (+ the previous one, for interpolation), the emission clock
    this._est = null; this._estPrev = null; this._frameN = 0; this._sentFrame = 0; this._sacPending = false; this._escPending = false;
    this._blk = { ref: 0, bsRef: null, closedT: null, x: null, y: null };   // [v2.1] blink detector state
    this._blinkPending = null; this._sacChain = null;
    this._nextEmitT = null; this._emitTimer = 0; this._lastSentT = -Infinity; this._rateT0 = 0; this._rateN = 0;
    this._mouse = { x: null, y: null, inside: false }; this._mouseOn = false; this._waiters = new Set();
    this._qualSig = ''; this._qualT = 0;
    // calibration session
    this._sess = null; this._dot = null; this._sessView = null; this._lastResizeT = -Infinity; this._vpWarned = false;
    this._resizeTimer = 0;
    // UI + recording + status
    this._calUI = null; this._settingsUI = null; this._debugUI = null; this._debugOpen = false;
    this._rec = null; this._lastRec = null;
    this._state = null; this._statusDetail = null; this._initPromise = null; this._initResolve = null; this._preload = false;
  },

  // ---------------------------------------------------------------------------------------------- events
  // listeners get the SAME object as the window CustomEvent detail; listener exceptions are caught and logged
  _emit(type, detail) {
    const set = this._listeners[type];
    if (set) for (const fn of Array.from(set)) { try { fn(detail); } catch (e) { reportError(e); } }
    if ((type === 'data' || type === 'status' || type === 'blink' || type === 'saccade') && HAS_DOM && typeof CustomEvent === 'function') {
      try { window.dispatchEvent(new CustomEvent('inkgaze:' + type, { detail })); } catch (e) { reportError(e); }
      if (this._opts.legacyEvents) {
        // v1 compatibility ('trk:*'): v1 called 'tracking' 'loaded' and 'settings' 'settings_opened'
        let d = detail;
        if (type === 'status' && (detail.state === 'tracking' || detail.state === 'settings')) d = Object.assign({}, detail, { state: detail.state === 'tracking' ? 'loaded' : 'settings_opened' });
        if (type === 'data' || type === 'status') { try { window.dispatchEvent(new CustomEvent('trk:' + type, { detail: d })); } catch (e) { reportError(e); } }
      }
    }
  },
  /** status helper: state in the contract set + optional {code, message, ...}; emitted on every call */
  _setStatus(state, extra) {
    if (this._destroyed && state !== 'closed') return;
    const detail = Object.assign({ state, t: now() }, extra || null);
    this._state = state; this._statusDetail = detail;
    this._emit('status', detail);
    this._uiCall('_settingsUI', 'status', detail);
  },
  // the state after a transient phase (calibration, dialog, resume, face back)
  _restingState() {
    if (this._settingsUI && this._uiCall('_settingsUI', 'isOpen')) return 'settings';   // the engine keeps running
    if (!this._running) return this._enginePromise ? 'loading' : 'paused';
    if (this._lost) return 'lost';
    return this._isCalibrated() ? 'tracking' : 'ready-to-calibrate';
  },
  _uiCall(slot, method, ...args) {
    const ui = this[slot];
    if (!ui || typeof ui[method] !== 'function') return undefined;
    try { return ui[method](...args); } catch (e) { reportError(e); return undefined; }
  },

  // ---------------------------------------------------------------------------------------------- timers
  _timeout(fn, ms) {
    const id = setTimeout(() => { this._timers.delete(id); if (!this._destroyed) fn(); }, ms);
    this._timers.add(id);
    return id;
  },
  _clearTimeout(id) { if (id) { clearTimeout(id); this._timers.delete(id); } },
  // UX pause; a zero pause (tests: timeScale 0) resolves as a microtask, so a frame-driven run is deterministic
  _sleep(ms) { const d = ms * this._timeScale; return d > 0 ? new Promise((r) => this._timeout(r, d)) : Promise.resolve(); },

  // ---------------------------------------------------------------------------------------------- options internals
  _saveSettings() {
    if (!this._opts.persist) return;
    store.set(this._opts.storageKey + ':settings', { schema: SETTINGS_SCHEMA, version: VERSION, options: pick(this._opts, PERSIST_KEYS) });
  },
  // options handed to core.createPipeline (a fresh reachGain array: the pipeline reads it live)
  _coreOpts(layout) {
    const o = this._opts;
    return { layout: layout || o.layout, inset: o.inset, head: o.head, headWeight: o.headWeight, reachGain: o.reachGain.slice(), cameraMirrored: o.cameraMirrored, pointer: o.pointer };
  },
  _isCalibrated() { return this._opts.source === 'mouse' ? this._running : !!(this._pipe && this._calView); },
  // the calibration no longer matches the viewport exactly: it is only RESCALED (the window geometry is unknown)
  _viewportChanged() {
    const c = this._calView, v = this._view;
    return !!(c && !this._shift() && (Math.abs(c.w - v.w) > 1 || Math.abs(c.h - v.h) > 1));
  },
  // viewport size (CSS px): the window in browsers; the headless test viewport in Node
  _vp() { return HAS_DOM && !this._headlessMode ? { w: window.innerWidth || 1, h: window.innerHeight || 1 } : { w: this._view.w, h: this._view.h }; },
  // [v2.1] where the viewport sits on the SCREEN (CSS px): window position + browser chrome (side borders split evenly,
  // the bottom border = one side border, the rest of outerHeight - innerHeight is the toolbar above). Trusted when the
  // side chrome is plausible (page zoom or a docked side panel make outerWidth - innerWidth large) or in fullscreen.
  // Headless tests: _view.x / _view.y, when given.
  _viewGeom() {
    const v = this._vp();
    if (!HAS_DOM || this._headlessMode) {
      const t = this._view, ok = finite(t.x) && finite(t.y);
      return { w: v.w, h: v.h, x: ok ? t.x : 0, y: ok ? t.y : 0, dpr: 1, ok };
    }
    const dpr = window.devicePixelRatio || 1;
    if (document.fullscreenElement || document.webkitFullscreenElement) return { w: v.w, h: v.h, x: 0, y: 0, dpr, ok: true };
    const ow = window.outerWidth || 0, oh = window.outerHeight || 0, side = ow - v.w, top = oh - v.h;
    const ok = finite(window.screenX) && finite(window.screenY) && side >= 0 && side <= 40 && top >= 0 && top <= 400;
    return { w: v.w, h: v.h, x: window.screenX + side / 2, y: window.screenY + top - side / 2, dpr, ok };
  },
  // viewport -> calibration translation [dx, dy] when both geometries are trusted (same zoom / display), else null
  _shift() {
    const c = this._calGeom;
    if (!c || !c.ok) return null;
    const g = this._geomNow || (this._geomNow = this._viewGeom());
    return g.ok && Math.abs(g.dpr - c.dpr) < 1e-6 ? [g.x - c.x, g.y - c.y] : null;
  },
  // viewport <-> calibration px. [v2.1] Gaze maps to physical screen positions: a window move / resize / fullscreen
  // change TRANSLATES the calibration (exact). Without a trusted geometry: proportional rescale (v2.0 behaviour).
  _toCal(x, y) {
    const s = this._shift();
    if (s) return [x + s[0], y + s[1]];
    const c = this._calView, v = this._view;
    return c && v.w && v.h ? [x * c.w / v.w, y * c.h / v.h] : [x, y];
  },
  _fromCal(x, y) {
    const s = this._shift();
    if (s) return [x - s[0], y - s[1]];
    const c = this._calView, v = this._view;
    return c && c.w && c.h ? [x * v.w / c.w, y * v.h / c.h] : [x, y];
  },
  _mirrored() { const m = this._opts.cameraMirrored; return typeof m === 'boolean' ? m : !!this._mirroredFit; },
});

mixin({
  // ---------------------------------------------------------------------------------------------- engine lifecycle
  // Start (or resume) camera + model + loop once; concurrent callers share one promise. Resolves true when running.
  _startEngine() {
    if (this._destroyed) return Promise.resolve(false);
    if (this._running) return Promise.resolve(true);
    if (this._headlessMode) { this._running = true; this._ensurePipe(); return Promise.resolve(true); }
    if (!HAS_DOM) return Promise.resolve(false);
    if (!this._enginePromise) {
      const gen = ++this._gen;
      const p = this._boot(gen).catch((e) => { if (gen === this._gen) this._fail(e); return false; });
      this._enginePromise = p;
      p.then(() => { if (this._enginePromise === p) this._enginePromise = null; });
    }
    return this._enginePromise;
  },
  async _boot(gen) {
    const o = this._opts, alive = () => gen === this._gen && !this._destroyed;
    this._attach();
    this._view = Object.assign({}, this._view, this._vp());   // (headless tests keep _view.x / y)
    if (o.source === 'camera') {
      this._setStatus('loading', { stage: 'camera', message: 'Starting the camera…' });
      if (!(await this._openCamera(gen)) || !alive()) return false;
      this._setStatus('loading', { stage: 'model', message: 'Loading the face model (MediaPipe ' + o.mpVersion + ')…' });
      await this._ensureLandmarker();
      if (!alive()) return false;
      this._setStatus('warming', { message: 'Warming up the face model…', delegate: this._delegateUsed });
      await new Promise((r) => this._timeout(r, 30));   // let the host paint: the first GPU inference blocks for seconds
      if (!alive()) return false;
      this._warmUp();
    } else {
      this._closeCamera();
      this._attachMouse();
    }
    if (!alive()) return false;
    this._ensurePipe();
    if (o.source === 'camera' && !this._isCalibrated()) this._tryLoadSaved();
    this._loopStart();
    this._wakeLock(true);
    this._setStatus(this._restingState(), { source: o.source, delegate: this._delegateUsed, video: this._videoSize(),
      code: this._needsCheck ? 'calibration-loaded' : undefined,
      message: this._needsCheck ? 'Saved calibration loaded: a quick recentre is advised.' : undefined });
    return true;
  },
  _fail(e) {
    reportError(e);
    this._running = false; this._cancelScheduled();
    this._setStatus('error', errorInfo(e));
    if (!this._uiCall('_settingsUI', 'isOpen')) this._resolveInit(false);   // the dialog shows the error and can retry
  },
  _resolveInit(v) { const r = this._initResolve; if (r) { this._initResolve = null; this._initPromise = null; r(v); } },

  // ---------------------------------------------------------------------------------------------- camera
  _wantCamKey() { return (this._opts.cameraId || '') + '|' + this._opts.resolution; },
  async _openCamera(gen) {
    if (window.isSecureContext === false) throw igError('insecure-context', 'The camera needs a secure page: open it via https:// or http://localhost (not file:// or a LAN IP address).');
    const md = typeof navigator !== 'undefined' && navigator.mediaDevices;
    if (!md || !md.getUserMedia) throw igError('no-media-devices', 'This browser does not expose the camera API (navigator.mediaDevices).');
    const o = this._opts, key = this._wantCamKey();
    if (this._stream && this._camKey === key && this._track && this._track.readyState === 'live') { this._track.enabled = true; return true; }
    this._closeCamera();
    const [w, h] = o.resolution === '480p' ? [640, 480] : [1280, 720];
    // ideal constraints only: a stale deviceId never throws OverconstrainedError; facingMode only selects a device
    // (phones/tablets) and never mirrors. frameRate: ideal 30 (the data rate is independent: options.rate)
    const video = { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 }, facingMode: 'user' };
    if (o.cameraId) video.deviceId = { ideal: o.cameraId };
    const hint = this._timeout(() => this._setStatus('loading', { stage: 'camera', code: 'camera-permission', message: 'Waiting for camera permission… (check the browser prompt)' }), PERMISSION_HINT_MS);
    let stream;
    try { stream = await md.getUserMedia({ audio: false, video }); } finally { this._clearTimeout(hint); }
    if (gen !== this._gen || this._destroyed) { stream.getTracks().forEach((t) => t.stop()); return false; }
    const track = stream.getVideoTracks()[0] || null;
    this._stream = stream; this._track = track; this._camKey = key;
    const st = track && track.getSettings ? track.getSettings() : {};
    this._deviceId = st.deviceId || o.cameraId || null;
    if (o.cameraId && st.deviceId && st.deviceId !== o.cameraId) this._setStatus('loading', { stage: 'camera', code: 'camera-substituted', message: 'The selected camera is not available: another camera is used.' });
    // track lifecycle: unplugged, OS privacy toggle, another app taking the camera
    this._camAC = new AbortController();
    const sig = { signal: this._camAC.signal };
    if (track) {
      track.addEventListener('ended', () => {
        if (this._track !== track) return;
        this._stopLoop(); this._closeCamera(); this._cancelSession('stop');
        this._setStatus('error', { code: 'camera-ended', message: 'The camera was disconnected or stopped by the system. Start again to reconnect.' });
      }, sig);
      track.addEventListener('mute', () => { if (this._track === track && this._running && !this._hidden) this._setStatus('paused', { code: 'camera-muted', message: 'The camera stopped sending frames (muted by the system or another application).' }); }, sig);
      track.addEventListener('unmute', () => { if (this._track === track && this._running && !this._hidden) this._setStatus(this._sess ? 'calibrating' : this._restingState()); }, sig);
    }
    const v = this._ensureVideo();
    v.srcObject = stream;
    if (!(v.readyState >= 1 && v.videoWidth)) {
      await new Promise((resolve, reject) => {
        const t = this._timeout(() => reject(igError('camera-no-frames', 'The camera opened but sent no video.')), NO_FRAMES_MS);
        v.addEventListener('loadedmetadata', () => { this._clearTimeout(t); resolve(); }, { once: true, signal: this._camAC.signal });
      });
    }
    try { await v.play(); } catch (e) { if (!e || e.name !== 'AbortError') throw igError('video-play', 'The camera video could not start (' + ((e && e.name) || e) + ').'); }
    if (gen !== this._gen || this._destroyed) return false;
    this._refreshDevices();   // labels are exposed now that a stream is live
    return true;
  },
  // the hidden <video> stays RENDERED (rVFC stops for display:none in some browsers): 1x1 px, almost transparent
  _ensureVideo() {
    if (this._video) return this._video;
    const v = document.createElement('video');
    v.className = 'ig-video';
    v.muted = true; v.playsInline = true; v.autoplay = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('autoplay', ''); v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    v.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;margin:0;padding:0;border:0;';
    (document.body || document.documentElement).appendChild(v);
    this._video = v;
    return v;
  },
  _closeCamera() {
    if (this._camAC) { this._camAC.abort(); this._camAC = null; }
    if (this._stream) this._stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* already stopped */ } });
    this._stream = null; this._track = null; this._camKey = '';
    if (this._video) { try { this._video.pause(); } catch (e) { /* ignore */ } this._video.srcObject = null; }
  },
  _videoSize() {
    if (this._opts.source === 'mouse') return null;
    if (this._headlessMode) return this._vsize ? { w: this._vsize.w, h: this._vsize.h } : null;
    const v = this._video;
    return v && v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
  },
  async _refreshDevices() {
    const md = typeof navigator !== 'undefined' && navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return this._devices;
    try { this._devices = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || 'Camera ' + (i + 1) })); } catch (e) { this._devices = []; }
    this._uiCall('_settingsUI', 'devices', this._devices.slice());
    return this._devices;
  },
  // camera list for the settings dialog. Labels need a permission: without a live stream, a short PROBE stream is
  // opened and stopped again right after enumerateDevices().
  async _listCameras() {
    if (!HAS_DOM) return [];
    const md = navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return [];
    let list = await this._refreshDevices();
    if (list.some((d) => d.deviceId && !/^Camera \d+$/.test(d.label)) || this._stream || !md.getUserMedia || window.isSecureContext === false) return list;
    let probe = null;
    try { probe = await md.getUserMedia({ video: true, audio: false }); list = await this._refreshDevices(); } catch (e) { /* permission denied: ids only */ }
    finally { if (probe) probe.getTracks().forEach((t) => t.stop()); }
    return list;
  },
  _wakeLock(on) {
    if (!HAS_DOM) return;
    if (!on) { if (this._wake) { try { this._wake.release(); } catch (e) { /* ignore */ } this._wake = null; } return; }
    // gaze-only use produces no input events, so the OS may dim / lock the screen mid-session
    const wl = navigator.wakeLock;
    if (!wl || (this._wake && !this._wake.released) || document.hidden) return;   // the UA releases it when hidden
    wl.request('screen').then((l) => { if (this._running && !this._destroyed) this._wake = l; else l.release(); }).catch(() => { /* policy / unsupported */ });
  },

  // ---------------------------------------------------------------------------------------------- MediaPipe
  // ONE FaceLandmarker per session; re-created only when the delegate, numFaces (mpSmoothing) or version/model change.
  async _ensureLandmarker() {
    const o = this._opts, numFaces = o.mpSmoothing ? 1 : 2;
    const key = [o.cdnBase, o.mpVersion, o.modelUrl, o.delegate, numFaces].join('|');
    if (this._lm && this._lmKey === key) return;
    if (this._lmPromise && this._lmPromiseKey === key) return this._lmPromise;
    const err = (e) => igError('model-load-failed', 'Could not load the MediaPipe face model ' + o.mpVersion + ' (network, Content-Security-Policy or browser support): ' + ((e && e.message) || e));
    const p = (async () => {
      let mp;
      try { mp = await loadVision(o.cdnBase, o.mpVersion); } catch (e) { throw err(e); }
      const make = (delegate) => mp.vision.FaceLandmarker.createFromOptions(mp.fileset, {
        baseOptions: { modelAssetPath: o.modelUrl, delegate }, runningMode: 'VIDEO', numFaces,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });   // [v2.1] blendshapes: eyeBlink scores only
      let lm, used = o.delegate;
      try { lm = await make(o.delegate); } catch (e) {
        if (o.delegate !== 'GPU') throw err(e);
        try { lm = await make('CPU'); used = 'CPU'; } catch (e2) { throw err(e2); }   // no WebGL2: CPU fallback
      }
      if (this._destroyed) { try { await lm.close(); } catch (e) { /* ignore */ } return; }
      const old = this._lm;
      this._lm = lm; this._lmKey = key; this._delegateUsed = used; this._lastTs = 0;
      if (old) { try { await old.close(); } catch (e) { /* ignore */ } }
    })();
    this._lmPromise = p; this._lmPromiseKey = key;
    try { await p; } finally { if (this._lmPromise === p) this._lmPromise = null; }
  },
  // 2 warm-up inferences BEFORE calibration (the first GPU call compiles shaders and can block for seconds)
  _warmUp() {
    const v = this._video;
    if (!this._lm || !v || v.readyState < 2) return;
    for (let i = 0; i < 2; i++) { try { this._lm.detectForVideo(v, this._nextTs(now())); } catch (e) { reportError(e); } }
  },
  // VIDEO mode needs STRICTLY increasing integer ms timestamps (equal or older throws and the graph does not recover)
  _nextTs(t) { const ts = Math.max(this._lastTs + 1, Math.round(t)); this._lastTs = ts; return ts; },

  // camera / model / source changes while running (serialised: overlapping setOptions calls cannot race)
  _reconfigure() {
    if (!this._running && !this._enginePromise) return;     // applied at the next start
    this._opChain = this._opChain.then(() => this._doReconfigure()).catch((e) => this._fail(e));
  },
  async _doReconfigure() {
    if (this._destroyed || this._headlessMode) return;
    if (this._enginePromise) await this._enginePromise;
    if (!this._running) return;
    const o = this._opts, gen = this._gen;
    if (o.source === 'camera') {
      this._detachMouse();
      if (!this._stream || this._camKey !== this._wantCamKey()) {
        this._setStatus('loading', { stage: 'camera', message: 'Switching camera…' });
        this._loopPaused = true; this._cancelScheduled();
        let ok;
        try { ok = await this._openCamera(gen); } finally { this._loopPaused = false; }
        if (!ok) return;
      }
      const needModel = !this._lm || this._lmKey !== [o.cdnBase, o.mpVersion, o.modelUrl, o.delegate, o.mpSmoothing ? 1 : 2].join('|');
      if (needModel) {
        this._setStatus('loading', { stage: 'model', message: 'Loading the face model…' });
        this._loopPaused = true; this._cancelScheduled();
        try { await this._ensureLandmarker(); } finally { this._loopPaused = false; }
        this._setStatus('warming', { message: 'Warming up the face model…', delegate: this._delegateUsed });
        this._warmUp();
      }
    } else { this._closeCamera(); this._attachMouse(); }
    if (gen !== this._gen || this._destroyed) return;
    this._smoother = null; this._x = this._y = null; this._lastProc = 0; this._lastPF = -1; this._lastVT = -1;
    if (this._pipeKeyNow() !== this._pipeKey || (this._calSource && this._calSource !== this._sourceKey())) this._invalidateCalibration('camera');
    this._calSource = this._sourceKey();
    this._cancelScheduled();      // a pending rVFC of a closed camera would never fire and would block _schedule()
    this._schedule();
    this._setStatus(this._sess ? 'calibrating' : this._restingState(), { source: o.source, delegate: this._delegateUsed, video: this._videoSize() });
  },
  _sourceKey() { return this._opts.source + '|' + (this._deviceId || this._opts.cameraId || ''); },

  // ---------------------------------------------------------------------------------------------- frame loop
  _loopStart() {
    this._running = true; this._loopPaused = false;
    this._lastPF = -1; this._lastVT = -1; this._lastProc = 0; this._lost = false;
    this._calSource = this._sourceKey();
    this._schedule();
    this._emitStart();
  },
  _stopLoop() { this._running = false; this._cancelScheduled(); this._emitStop(); },
  _cancelScheduled() {
    if (this._vfc && this._video && this._video.cancelVideoFrameCallback) { try { this._video.cancelVideoFrameCallback(this._vfc); } catch (e) { /* ignore */ } }
    if (this._raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._raf);
    this._vfc = 0; this._raf = 0;
  },
  // ONE inference per NEW camera frame: requestVideoFrameCallback, else rAF + a video.currentTime change check
  _schedule() {
    if (!HAS_DOM || this._headlessMode || !this._running || this._hidden || this._loopPaused || this._destroyed || this._vfc || this._raf) return;
    const gen = this._gen;
    if (this._opts.source === 'camera' && this._video && hasRVFC()) this._vfc = this._video.requestVideoFrameCallback((t, meta) => { this._vfc = 0; this._onFrame(t, meta, gen); });
    else this._raf = requestAnimationFrame((t) => { this._raf = 0; this._onFrame(t, null, gen); });
  },
  _onFrame(t, meta, gen) {
    if (gen !== this._gen || !this._running || this._destroyed) return;
    try {
      if (this._opts.source === 'mouse') this._tickMouse(t);
      else if (meta) {
        if (this._lastPF >= 0 && meta.presentedFrames > this._lastPF + 1) this._stats.dropped += meta.presentedFrames - this._lastPF - 1;
        this._lastPF = meta.presentedFrames;
        // capture time when present and sane, else presentation time (both on the performance.now() timeline;
        // mediaTime may be 0 for live streams and is never used)
        const ct = meta.captureTime, ts = finite(ct) && ct > 0 && Math.abs(ct - t) < 1000 ? ct : (meta.presentationTime || t);
        this._tick(ts);
      } else {
        const v = this._video;
        if (v && v.readyState >= 2 && v.currentTime !== this._lastVT) { this._lastVT = v.currentTime; this._tick(t); }
      }
    } finally { this._schedule(); }
  },
  // camera frames per second actually processed (EMA of the frame interval). [v2.1] every new camera frame is
  // processed: the only rate option is the DATA rate (options.rate), see the data stream below
  _measureFps(t) {
    const dt = this._lastProc ? t - this._lastProc : 0, s = this._stats;
    this._lastProc = t;
    if (dt > 0 && dt < 1000) s.fps = s.fps ? s.fps + 0.1 * (1000 / dt - s.fps) : 1000 / dt;
  },
  _tick(t) {
    if (this._busy || !this._lm || !this._video) return;
    this._busy = true;
    try {
      this._measureFps(t);
      const v = this._video;
      if (v.videoWidth && this._pipeKeyNow() !== this._pipeKey) this._invalidateCalibration('video-size');   // renegotiated
      const ts = this._nextTs(t), t0 = now();
      const result = this._lm.detectForVideo(v, ts);
      const inf = now() - t0, s = this._stats;
      s.inferMs = s.inferMs ? s.inferMs + 0.1 * (inf - s.inferMs) : inf;
      this._processResult(result, ts);
      s.errorRun = 0;
    } catch (e) {
      // one bad frame must not kill the loop; a persistent failure (e.g. WebGL context lost) is reported once
      const s = this._stats;
      s.errors++; s.errorRun++;
      if (s.errorRun === 1) reportError(e);
      if (s.errorRun >= ERROR_RUN_MAX) {
        this._stopLoop(); this._cancelSession('stop');
        this._setStatus('error', { code: 'inference-failed', message: 'Face tracking stopped after repeated errors (' + ((e && e.message) || e) + '). Start again to retry.' });
      }
    } finally { this._busy = false; }
  },
  _tickMouse(t) {
    if (this._busy) return;
    this._busy = true;
    try { this._measureFps(t); this._processPointer(this._nextTs(t)); } catch (e) { reportError(e); } finally { this._busy = false; }
  },
  _attachMouse() {
    if (this._mouseOn || !HAS_DOM || this._headlessMode) return;
    this._mouseOn = true; this._mouseAC = new AbortController();
    const sig = { signal: this._mouseAC.signal, passive: true };
    window.addEventListener('pointermove', (e) => { this._mouse.x = e.clientX; this._mouse.y = e.clientY; this._mouse.inside = true; }, sig);
    document.documentElement.addEventListener('mouseleave', () => { this._mouse.inside = false; }, sig);
  },
  _detachMouse() { if (this._mouseAC) this._mouseAC.abort(); this._mouseAC = null; this._mouseOn = false; },

  // ---------------------------------------------------------------------------------------------- data stream
  // [v2.1] Packets are SENT at options.rate Hz (1..250), independently of the camera. A timer (browsers) or the
  // injected frame clock (headless tests) calls _pump(t), which sends every packet due up to t.
  //   faster than the camera: positions glide between the last two camera frames, rendered one frame interval behind
  //     (smooth cursor motion, ~1 frame of extra delay; never across a saccade, a blink or a lost face)
  //   slower than the camera: the newest estimate; `saccade` is OR-ed over the frames since the previous packet, so a
  //     pen lift is never lost; the smoother still sees every frame
  //   no camera frame for STALE_MS (camera stalled / page hidden): nothing is sent
  _emitStart() {
    if (!HAS_DOM || this._headlessMode || this._emitTimer || !this._running || this._hidden || this._destroyed) return;
    const loop = () => {
      this._emitTimer = 0;
      if (!this._running || this._hidden || this._destroyed) return;
      const t = now();
      try { this._pump(t); } catch (e) { reportError(e); }
      const period = 1000 / this._opts.rate, next = this._nextEmitT != null ? this._nextEmitT : t + period;
      this._emitTimer = this._timeout(loop, Math.max(0, Math.min(period, next - now())));
    };
    this._emitTimer = this._timeout(loop, 0);
  },
  _emitStop() { this._clearTimeout(this._emitTimer); this._emitTimer = 0; this._nextEmitT = null; },
  _pump(t) {
    const e = this._est;
    if (!e || this._destroyed) return;
    if (!this._headlessMode && t - e.pt > STALE_MS) { this._nextEmitT = null; return; }
    const period = 1000 / this._opts.rate;
    if (this._nextEmitT == null || t - this._nextEmitT > 3 * period + 50) this._nextEmitT = t;   // (re)start, no burst
    while (this._nextEmitT <= t + 0.25) { this._send(this._nextEmitT); this._nextEmitT += period; }
  },
  // one data packet for time tau (a FRESH plain object; the nested eyes / face / head / distance objects are shared by
  // the packets of one camera frame: treat packets as read-only)
  _send(tau) {
    const e = this._est, prev = this._estPrev, o = this._opts, st = this._stats;
    let x = e.x, y = e.y;
    if (prev && x != null && prev.x != null && e.state === 'fixation' && prev.state === 'fixation' && o.rate > 1.2 * (st.fps || 30)) {
      const dt = e.pt - prev.pt;
      if (dt > 0 && dt < 250) { const a = Math.min(1, Math.max(0, (tau - dt - prev.pt) / dt)); x = prev.x + a * (x - prev.x); y = prev.y + a * (y - prev.y); }
    }
    const v = this._view, fresh = this._sentFrame !== e.n, t = Math.max(this._lastSentT + 1, Math.round(tau));
    this._sentFrame = e.n; this._lastSentT = t;
    const saccade = this._sacPending, escape = this._escPending, blink = this._blinkPending;
    this._sacPending = this._escPending = false; this._blinkPending = null;
    const pk = {
      t, seq: ++this._seq, fps: round(st.fps, 1), inferMs: round(st.inferMs, 2), fresh, frameT: e.t,
      valid: e.valid, calibrated: e.calibrated, state: e.state,
      x, y, rawX: e.rawX, rawY: e.rawY,
      nx: x == null ? null : x / (v.w || 1), ny: y == null ? null : y / (v.h || 1),
      saccade, escape, fixationMs: e.fixationMs > 0 ? Math.round(e.fixationMs + Math.max(0, tau - e.pt)) : 0,
      blinkMs: e.blinkMs > 0 ? Math.round(e.blinkMs + Math.max(0, tau - e.pt)) : 0, blinked: blink ? blink.durationMs : 0,
      eyes: e.eyes, face: e.face, head: e.head, distance: e.distance,
    };
    if (t - this._rateT0 >= 1000) { st.sentRate = this._rateN * 1000 / Math.max(1, t - this._rateT0); this._rateT0 = t; this._rateN = 0; }
    this._rateN++; st.sent++;
    this.latest = pk;
    this._emit('data', pk);
    if (this._debugOpen) this._uiCall('_debugUI', 'frame', pk);
  },

  // ---------------------------------------------------------------------------------------------- per frame
  /**
   * Process ONE FaceLandmarker result (called once per NEW camera frame by the loop; exposed for tests, which inject
   * simulator results). features -> (calibration dot collector) -> predict (null = blink: hold x, y) -> smoother ->
   * the frame estimate; packets are sent by the data stream (_pump) at options.rate.
   * @param {object|null} result {faceLandmarks: [[...478]], facialTransformationMatrixes: [{data}]}
   * @param {number} t strictly increasing ms (performance.now() timeline)
   * @returns {object|null} the last data packet sent while processing this frame (null if none was due)
   */
  _processResult(result, t) {
    if (this._destroyed) return null;
    const tp = this._headlessMode ? t : now(), seq0 = this._seq;
    this._pump(tp - 0.01);                   // packets due before this frame still carry the previous estimate
    this._stats.frames++;
    if (!this._headlessMode && tp - (this._geomT || 0) > 250) { this._geomNow = this._viewGeom(); this._geomT = tp; }   // window moves fire no event
    if (!this._pipe) this._ensurePipe();
    const one = this._pickFace(result);
    const lm = one ? one.faceLandmarks[0] : null;
    const f = one && this._pipe ? this._pipe.features(one) : null;
    const M = one && one.facialTransformationMatrixes && one.facialTransformationMatrixes[0];
    const bs = one ? blinkScore(one) : null;   // [v2.1] mean eyeBlink blendshape (null without blendshapes)
    this._lastFrameT = t;
    if (f) { if (this._faceSince == null) this._faceSince = t; this._lastFaceT = t; } else this._faceSince = null;
    const blinkMs = this._blinkStep(f, t, bs), closed = blinkMs > 0;
    this._ring[this._ringI] = f && !closed ? { f, t } : null; this._ringI = (this._ringI + 1) % RING;   // RAW features for learn()
    if (this._dot) this._onDotFrame(f, t, closed);
    if (this._waiters.size) this._runWaiters();
    const cal = this._isCalibrated();
    let p = null;
    if (f && cal && !closed) {   // RAW features only: smoothed values never feed back into calibration or learning
      const q = this._pipe.predict(f, t);
      if (q) { const [x, y] = this._fromCal(q.x, q.y); p = { x, y }; }
    }
    this._update(t, tp, p, { f, lm: lm && lm.length >= 478 ? lm : null, matrix: M && M.data ? M.data : null,
      lost: !f && t - this._lastFaceT >= LOST_MS, calibrated: cal, blinkMs, bs });
    this._pump(tp);
    return this._seq > seq0 ? this.latest : null;
  },
  // [v2.1] blink detector (works before calibration), two signals OR-ed:
  //   lid aperture  closed below BLINK_RATIO x the running open-eye aperture (fast up, slow down: looking down lowers
  //                 the lids for seconds)
  //   blendshapes   MediaPipe's eyeBlinkLeft / Right mean >= max(BLINK_BS, open-eye score + BLINK_BS_RISE) (the score
  //                 also rises a little when looking down). Real data: MediaPipe's landmark filter can smooth the lids so
  //                 much that the aperture never dips (no dip below 85 % in a 60 s recording), the scores are robust
  // A closure that ends is a 'blink' event {t, durationMs, long, x, y (gaze before the blink)}. A lost face is no blink.
  // Returns the current closure duration (ms, 0 = open).
  _blinkStep(f, t, bs) {
    const b = this._blk;
    if (!f) { if (b.closedT != null && t - this._lastFaceT >= LOST_MS) b.closedT = null; return b.closedT != null ? t - b.closedT : 0; }
    if (!(b.ref > 0)) b.ref = f.ap;
    const hasBs = finite(bs);
    if (hasBs && b.bsRef == null) b.bsRef = Math.min(bs, 0.3);
    const closed = f.ap < BLINK_RATIO * b.ref || (hasBs && bs >= Math.max(BLINK_BS, b.bsRef + BLINK_BS_RISE));
    if (!closed) {
      b.ref += (f.ap > b.ref ? 0.2 : 0.02) * (f.ap - b.ref);
      if (hasBs) b.bsRef += (bs < b.bsRef ? 0.2 : 0.02) * (Math.min(bs, 0.45) - b.bsRef);
    }
    if (closed && b.closedT == null) { b.closedT = t; b.x = this._x; b.y = this._y; }
    else if (!closed && b.closedT != null) {
      const d = t - b.closedT;
      b.closedT = null;
      if (d >= BLINK_MIN_MS && d <= BLINK_MAX_MS) {
        const ev = { t, durationMs: Math.round(d), long: d >= this._opts.longBlinkMs, x: b.x, y: b.y };
        this._blinkPending = ev;
        this._recEvent('blink', ev);
        this._emit('blink', ev);
      }
    }
    return b.closedT != null ? t - b.closedT : 0;
  },
  // [v2.1] a confirmed saccade (smoother jump, viewport px) -> 'saccade' event; escape = a large jump made quickly
  // (options.escapeAmplitude of the viewport diagonal within ESCAPE_MAX_MS): the drawing apps' pen-up flick. A jump that
  // continues the previous one (same direction, within ESCAPE_MAX_MS) is reported from the chain's start (chained:
  // true), so a big saccade confirmed in two parts is still one escape (flagged once per chain).
  _onSaccade(j, t) {
    const v = this._view, diag = Math.hypot(v.w, v.h) || 1, ch = this._sacChain;
    let fromX = j.fromX, fromY = j.fromY, t0 = j.t0, chained = false;
    if (ch && j.t1 - ch.t0 <= ESCAPE_MAX_MS) {
      const ax = ch.toX - ch.fromX, ay = ch.toY - ch.fromY, bx = j.toX - j.fromX, by = j.toY - j.fromY;
      if ((ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1) > 0.5) { fromX = ch.fromX; fromY = ch.fromY; t0 = ch.t0; chained = true; }
    }
    const dx = j.toX - fromX, dy = j.toY - fromY, amp = Math.hypot(dx, dy), dur = Math.max(1, j.t1 - t0);
    const escape = amp >= this._opts.escapeAmplitude * diag && dur <= ESCAPE_MAX_MS && !(chained && ch.escaped);
    this._sacChain = { fromX, fromY, toX: j.toX, toY: j.toY, t0, escaped: escape || (chained && ch.escaped) };
    const ev = { t, fromX: round(fromX, 1), fromY: round(fromY, 1), toX: round(j.toX, 1), toY: round(j.toY, 1),
      amplitudePx: round(amp, 1), amplitude: round(amp / diag, 3), angleDeg: round(Math.atan2(dy, dx) * 180 / Math.PI, 1),
      durationMs: round(dur, 1), velocity: Math.round(amp / dur * 1000), escape, chained };
    if (escape) this._escPending = true;
    this._recEvent('saccade', ev);
    this._emit('saccade', ev);
  },
  // mouse source: the pointer IS the raw gaze (viewport px); same smoother, states, stream and events
  _processPointer(t) {
    if (this._destroyed) return null;
    const tp = this._headlessMode ? t : now(), seq0 = this._seq;
    this._pump(tp - 0.01);
    this._stats.frames++;
    const m = this._mouse, ok = m.x != null && m.inside;
    this._lastFrameT = t;
    if (ok) { if (this._faceSince == null) this._faceSince = t; this._lastFaceT = t; } else this._faceSince = null;
    if (this._waiters.size) this._runWaiters();
    this._update(t, tp, ok ? { x: m.x, y: m.y } : null, { f: null, lm: null, matrix: null, lost: !ok && t - this._lastFaceT >= LOST_MS, calibrated: true });
    this._pump(tp);
    return this._seq > seq0 ? this.latest : null;
  },
  // the per-frame estimate (smoother, states, host-facing fields); recorded per camera frame
  _update(t, tp, p, c) {
    const o = this._opts;
    let state, s = null;
    if (p) {
      s = this._smooth(p, t);
      if (s.saccade || this._fixStartT == null) this._fixStartT = t - s.fixationMs;
      const raw = o.smoothing === 0;
      this._x = raw ? p.x : s.x; this._y = raw ? p.y : s.y;
      state = s.saccade ? 'saccade' : 'fixation';
      if (s.saccade) { this._sacPending = true; if (s.jump && c.calibrated) this._onSaccade(s.jump, t); }
    } else if (c.lost) { state = 'lost'; this._smoother = null; this._fixStartT = null; }
    else state = c.calibrated ? 'blink' : 'uncalibrated';      // blink / short dropout: x, y held, pen lifted
    if (!c.calibrated) { this._x = this._y = null; }
    const f = c.f, lm = c.lm;
    const e = {
      n: ++this._frameN, t, pt: tp, valid: !!p, calibrated: c.calibrated, state, saccade: !!(s && s.saccade),
      x: this._x, y: this._y, rawX: p ? p.x : null, rawY: p ? p.y : null,
      fixationMs: p && this._fixStartT != null ? t - this._fixStartT : 0, blinkMs: c.blinkMs ? Math.round(c.blinkMs) : 0,
      eyes: f ? { h: f.eh, v: f.ev, aperture: f.ap, iod: f.eiod } : null,
      face: lm && o.stream !== 'eyes' ? this._faceBox(lm) : null,
      head: f && o.stream === 'full' ? this._headOut(f) : null,
      distance: f && lm && o.stream === 'full' ? this._distance(f, lm) : null,
    };
    this._estPrev = this._est; this._est = e;
    if (this._rec) this._recFrame(e, lm, c.matrix, c.bs);
    this._trackStatus(state);
    this._checkQuality(false);
    return e;
  },
  // 'lost' <-> resting status transitions (not while calibrating, paused or in the settings dialog)
  _trackStatus(state) {
    const lost = state === 'lost';
    if (lost === this._lost) return;
    this._lost = lost;
    if (!this._running || this._sess || this._hidden || this._state === 'settings' || this._state === 'paused' || this._state === 'error') return;
    this._setStatus(this._restingState(), lost ? { code: 'face-lost', message: this._opts.source === 'mouse' ? 'The pointer left the page.' : 'The face is not visible to the camera.' } : null);
  },
  _smooth(p, t) {
    const n = this._opts.source === 'mouse' ? MOUSE_NOISE_PX : (this._noisePx || 30), win = this._opts.smoothing || SACCADE_WIN_MS;
    if (!this._smoother || this._smootherWin !== win || Math.abs(n - this._smootherNoise) > 0.2 * this._smootherNoise) {
      this._smoother = core.createSmoother({ noisePx: n, windowMs: win });
      this._smootherNoise = n; this._smootherWin = win; this._fixStartT = null;
    }
    return this._smoother(p, t);
  },
  // per-frame gaze noise in VIEWPORT px (quality().noisePx is in calibration px): drives the smoother's saccade test
  _refreshNoise() {
    if (this._opts.source === 'mouse' || !this._isCalibrated()) { this._noisePx = 0; return; }
    const q = this._pipe.quality(), c = this._calView, v = this._view;
    this._noisePx = Math.max(2, (q.noisePx || 0) * (this._shift() ? 1 : Math.max(v.w / c.w, v.h / c.h)));
  },
  // numFaces 2 (mpSmoothing:false trick): keep the face with the largest box
  _pickFace(r) {
    const L = r && r.faceLandmarks;
    if (!L || !L.length || !L[0]) return null;
    if (L.length === 1) return L[0].length >= 478 ? r : null;
    let best = -1, bi = -1;
    for (let i = 0; i < L.length; i++) {
      const lm = L[i]; if (!lm || lm.length < 478) continue;
      const b = this._box(lm), a = b.w * b.h;
      if (a > best) { best = a; bi = i; }
    }
    if (bi < 0) return null;
    const M = r.facialTransformationMatrixes;
    const B = r.faceBlendshapes;
    return { faceLandmarks: [L[bi]], facialTransformationMatrixes: M && M[bi] ? [M[bi]] : [], faceBlendshapes: B && B[bi] ? [B[bi]] : [] };
  },
  _box(lm) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const i of FACE_BOX_LM) { const q = lm[i]; if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
    return { x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  },
  // normalised face box in the USER's (selfie) view: an un-mirrored camera frame is flipped horizontally
  _faceBox(lm) {
    const b = this._box(lm);
    return { x: this._mirrored() ? b.x0 : 1 - b.x0 - b.w, y: b.y0, w: b.w, h: b.h };
  },
  // head pose, degrees, user perspective (yaw + = user's right, pitch + = up, roll + = toward the right shoulder);
  // relative to the calibration neutral once calibrated, ABSOLUTE before (MediaPipe reads ~+4 deg pitch on a level face)
  _headOut(f) {
    if (!f.pose) return null;
    if (this._isCalibrated() && this._pipe) return this._pipe.headPose(f);
    const sx = this._mirrored() ? 1 : -1, DEGR = Math.PI / 180;
    return { yaw: sx * f.pose.yaw / DEGR, pitch: -f.pose.pitch / DEGR, roll: -sx * f.pose.roll / DEGR };
  },
  // rel = iod / iod at calibration (> 1 = closer; null until calibrated). cm = APPROXIMATE: f_px * 11.7 mm / iris
  // diameter in px, with f_px from the ASSUMED horizontal FOV (core DEFAULTS.hfovDeg, 70 deg)
  _distance(f, lm) {
    const rel = this._iodCal ? f.iod / this._iodCal : null;
    const size = this._videoSize();
    let cm = null;
    if (size) {
      const vw = size.w, vh = size.h, d = (a, b) => Math.hypot((lm[a].x - lm[b].x) * vw, (lm[a].y - lm[b].y) * vh);
      const dPx = (d(469, 471) + d(470, 472) + d(474, 476) + d(475, 477)) / 4;   // mean iris diameter, both eyes
      const fPx = (vw / 2) / Math.tan(core.DEFAULTS.hfovDeg * Math.PI / 360);
      if (dPx > 1) cm = round(fPx * (IRIS_MM / 10) / dPx, 1);
    }
    return { rel, cm };
  },
  // RAW feature frames of the CURRENT fixation (since the last confirmed saccade) within the last ~0.8 s, oldest first
  _fixationFrames() {
    const out = [], t1 = this._lastFrameT, t0 = Math.max(t1 - RING_MS, this._fixStartT == null ? -Infinity : this._fixStartT);
    for (let k = 0; k < RING; k++) { const e = this._ring[(this._ringI + k) % RING]; if (e && e.t >= t0 && e.t <= t1) out.push(e.f); }
    return out;
  },
  // frame-driven waits for the calibration flow (resolve true when test() holds, false on timeout; CANCEL on cancel)
  _waitFor(test, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = 0;
      const w = { test, resolve: (v) => { done(); resolve(v); }, reject: (e) => { done(); reject(e); } };
      const done = () => { this._waiters.delete(w); this._clearTimeout(timer); };
      if (this._sess && this._sess.tok.cancelled) { reject(CANCEL); return; }
      this._waiters.add(w);
      if (timeoutMs) timer = this._timeout(() => w.resolve(false), timeoutMs);
      this._runWaiters();
    });
  },
  _runWaiters() { for (const w of Array.from(this._waiters)) { let ok = false; try { ok = w.test(); } catch (e) { reportError(e); } if (ok) w.resolve(true); } },

  // ---------------------------------------------------------------------------------------------- live pipeline
  _pipeKeyNow() { const s = this._videoSize() || { w: 1280, h: 720 }; return s.w + 'x' + s.h + '|' + this._opts.pointer + '|' + this._opts.head; },
  // the live pipeline: an uncalibrated one (features only) until a calibration is committed or imported
  _ensurePipe() {
    if (this._opts.source === 'mouse') { this._pipe = null; this._pipeKey = ''; this._calView = null; this._calGeom = null; return; }
    const key = this._pipeKeyNow();
    if (this._pipe && this._pipeKey === key) return;
    const size = this._videoSize() || { w: 1280, h: 720 };
    this._pipe = core.createPipeline({ screen: { w: this._view.w || 1, h: this._view.h || 1 }, video: size }, this._coreOpts());
    this._pipeKey = key; this._calView = null; this._calGeom = null; this._iodCal = null; this._mirroredFit = null;
  },

  // ---------------------------------------------------------------------------------------------- page listeners
  _attach() {
    if (this._ac || this._destroyed || !HAS_DOM || this._headlessMode) return;
    this._ac = new AbortController();
    const sig = { signal: this._ac.signal };
    this._view = Object.assign({}, this._view, this._vp());   // (headless tests keep _view.x / y)
    window.addEventListener('resize', () => this._onResize(), sig);
    document.addEventListener('fullscreenchange', () => this._onResize(), sig);
    document.addEventListener('visibilitychange', () => this._onVisibility(), sig);
    window.addEventListener('keydown', (e) => this._onKey(e), sig);
    const md = navigator.mediaDevices;
    if (md && md.addEventListener) md.addEventListener('devicechange', () => { if (this._stream || this._devices.length) this._refreshDevices(); }, sig);
  },
  // [v2.1] the calibration is anchored to the screen: a resize / fullscreen change translates it (the window geometry is
  // re-read at once); without a trusted geometry outputs rescale proportionally and a debounced hint suggests a recentre
  _onResize() {
    this._view = Object.assign({}, this._view, this._vp());   // (headless tests keep _view.x / y)
    this._geomNow = this._viewGeom(); this._geomT = now();
    this._lastResizeT = now();
    this._refreshNoise();
    this._clearTimeout(this._resizeTimer);
    this._resizeTimer = this._timeout(() => { this._resizeTimer = 0; this._viewportHint(); }, 200);
  },
  _viewportHint() {
    if (!this._isCalibrated() || this._opts.source === 'mouse') return;
    const vc = this._viewportChanged();
    if (vc && !this._vpWarned && !this._sess) {
      this._vpWarned = true;
      if (this._state !== 'settings') this._setStatus(this._restingState(), { code: 'viewport-changed', message: 'The window size changed since calibration and its position on the screen is unknown (page zoom?): positions are rescaled proportionally. A recentre is suggested.' });
    }
    if (!vc) this._vpWarned = false;
    this._checkQuality(true);
  },
  _onVisibility() {
    if (document.hidden) {
      if (this._hidden) return;
      this._hidden = true; this._cancelScheduled(); this._emitStop();
      if (this._running) {
        this._setStatus('paused', { code: 'hidden', message: 'Paused while the page is hidden.' });
        this._hiddenTimer = this._timeout(() => { this._hiddenTimer = 0; if (this._track) this._track.enabled = false; }, HIDDEN_RELEASE_MS);
      }
    } else if (this._hidden) {
      this._hidden = false;
      this._clearTimeout(this._hiddenTimer); this._hiddenTimer = 0;
      if (this._track) this._track.enabled = true;
      this._smoother = null; this._lastProc = 0; this._faceSince = null; this._fixStartT = null; this._blk.closedT = null;   // stale after a pause
      if (this._dot) this._restartDot();
      if (this._running) { this._wakeLock(true); this._schedule(); this._emitStart(); this._setStatus(this._sess ? 'calibrating' : this._restingState()); }
    }
  },
  // ESC: cancels a calibration (-> settings); otherwise opens the settings dialog (ui only). Never preventDefault.
  _onKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || this._destroyed) return;
    if (this._sess) { this._cancelSession('user'); return; }
    if (!this._opts.ui || !this._settingsAvailable() || this._uiCall('_settingsUI', 'isOpen')) return;
    const tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName || ''))) return;   // host typing
    if (this._running || this._enginePromise) this.openSettings();
  },

  // ---------------------------------------------------------------------------------------------- quality events
  // emit 'quality' when its meaningful part changes (checked at most twice a second, or forced)
  _checkQuality(force) {
    const t = now();
    if (!force && t - this._qualT < 500) return;
    this._qualT = t;
    const q = this.quality();
    const sig = JSON.stringify([q.calibrated, q.points, q.rows, q.moved, q.recenterSuggested, q.viewportChanged, q.learned, q.rejected,
      q.shifts, q.drifts, q.recenters, q.axisX, q.axisY, q.noisePx && Math.round(q.noisePx), q.confidence, q.needsCheck]);
    if (force || sig !== this._qualSig) {
      this._qualSig = sig;
      this._emit('quality', q);
      if (this._debugOpen) this._uiCall('_debugUI', 'quality', q);
    }
  },

  // ---------------------------------------------------------------------------------------------- persistence
  // calibration key = camera, video WxH, screen WxH, devicePixelRatio, pointer (design-spec §10 + pointer)
  _screenKey() {
    if (!HAS_DOM || this._headlessMode) return this._view.w + 'x' + this._view.h + ':1';
    const s = window.screen || {};
    return (s.width || 0) + 'x' + (s.height || 0) + ':' + (window.devicePixelRatio || 1);
  },
  _camForKey() { return this._deviceId || this._opts.cameraId || 'default'; },
  _calKey() {
    const size = this._videoSize();
    if (!size || this._opts.source === 'mouse') return null;
    return this._opts.storageKey + ':cal:' + this._camForKey() + ':' + size.w + 'x' + size.h + ':' + this._screenKey() + ':' + this._opts.pointer;
  },
  // before the camera opens (video size and real deviceId unknown): any saved calibration for this screen + pointer
  _hasSavedCandidate() {
    if (!this._opts.persist || this._opts.source === 'mouse') return false;
    const pre = this._opts.storageKey + ':cal:' + (this._opts.cameraId ? this._opts.cameraId + ':' : ''), suf = ':' + this._screenKey() + ':' + this._opts.pointer;
    return store.keys(pre).some((k) => k.slice(-suf.length) === suf);
  },
  _saveCalibration(state) {
    if (!this._opts.persist || !this._isCalibrated() || this._opts.source === 'mouse') return false;
    const key = this._calKey();
    if (!key) return false;
    return store.set(key, { schema: CAL_SCHEMA, version: VERSION, savedAt: Date.now(), calView: this._calView, calGeom: this._calGeom,
      head: this._opts.head, pointer: this._opts.pointer, confidence: this._confidence, layout: this._lastCalibration ? this._lastCalibration.layout : null,
      state: state || this._pipe.exportState() });
  },
  // import a matching saved calibration (refused when the video size, pointer or head mode differ). The model keeps its
  // calibration viewport and its place on the screen ([v2.1] calGeom: translated to the current window when trusted,
  // else rescaled). quality().needsCheck until a recentre / quick start. The head weight may differ: importState
  // recomputes the rows.
  _tryLoadSaved() {
    if (!this._opts.persist || this._opts.source === 'mouse') return false;
    const key = this._calKey(), data = key && store.get(key), size = this._videoSize();
    if (!data || data.schema !== CAL_SCHEMA || !data.state || !data.state.screen || !data.calView || !size) return false;
    if (data.head !== this._opts.head || data.pointer !== this._opts.pointer) return false;
    let p;
    try {
      p = core.createPipeline({ screen: data.state.screen, video: size }, this._coreOpts());
      if (!p.importState(data.state)) return false;
    } catch (e) { reportError(e); return false; }
    this._pipe = p; this._pipeKey = this._pipeKeyNow(); this._calView = { w: data.calView.w, h: data.calView.h };
    this._calGeom = data.calGeom && typeof data.calGeom === 'object' ? data.calGeom : null;
    this._afterModelChange(p);
    this._needsCheck = true; this._confidence = data.confidence || null; this._validation = null;
    this._lastCalibration = { at: data.savedAt, layout: data.layout || null, confidence: data.confidence || null, loaded: true };
    this._recEvent('loaded', { savedAt: data.savedAt, layout: data.layout || null });
    this._emit('calibration', { phase: 'loaded', savedAt: data.savedAt, layout: data.layout || null });
    this._checkQuality(true);
    return true;
  },
  // a new / imported / learned model is live: cache what the per-frame path needs and reset the output stage
  _afterModelChange(p) {
    const st = p._debug();
    this._iodCal = st.neutral ? st.neutral.iod : null;
    this._mirroredFit = p.quality().mirrored;
    p.cfg.cameraMirrored = this._opts.cameraMirrored;     // headPose() reads the flag live
    this._smoother = null; this._x = this._y = null; this._fixStartT = null; this._vpWarned = false;
    this._refreshNoise();
  },

  // ---------------------------------------------------------------------------------------------- recording internals
  _recEvent(type, data) {
    const r = this._rec;
    if (!r) return;
    r.events.push(Object.assign({ type, t: this._lastFrameT, wall: round(now(), 1) }, data ? JSON.parse(JSON.stringify(data)) : null));
  },
  // one entry per CAMERA frame (not per sent packet): the frame estimate e from _update()
  _recFrame(pk, lm, M, bs) {
    const r = this._rec;
    if (r.t0 == null) r.t0 = pk.t;
    if (pk.t - r.t0 > r.maxMs) { this._stopRec(true); return; }
    const size = this._videoSize();
    let L = null;
    if (lm) { L = new Array(LM_SUBSET.length * 3); LM_SUBSET.forEach((i, k) => { const q = lm[i]; L[3 * k] = round(q.x, 6); L[3 * k + 1] = round(q.y, 6); L[3 * k + 2] = round(q.z || 0, 5); }); }
    r.frames.push({ t: pk.t, v: size ? [size.w, size.h] : null, lm: L, M: M ? Array.from(M, (x) => round(x, 6)) : null, bs: finite(bs) ? round(bs, 3) : null,
      out: { x: pk.x, y: pk.y, rawX: pk.rawX, rawY: pk.rawY, valid: pk.valid, calibrated: pk.calibrated, state: pk.state, saccade: pk.saccade, fixationMs: pk.fixationMs },
      view: [this._view.w, this._view.h] });
  },
  _stopRec(limit) {
    const r = this._rec;
    if (!r) return this._lastRec;
    this._rec = null;
    r.endedAt = new Date().toISOString(); r.durationMs = r.frames.length ? r.frames[r.frames.length - 1].t - r.t0 : 0; r.truncated = !!limit;
    this._lastRec = r;
    if (limit) this._setStatus(this._sess ? 'calibrating' : this._restingState(), { code: 'recording-limit', message: 'Recording stopped at its ' + Math.round(r.maxMs / 1000) + ' s limit.' });
    return r;
  },
});

// ------------------------------------------------------------------------------------------------ default calibration UI
// Minimal renderer so the engine runs before / without the UI: calibration section (which redefines _createCalUI):
// a no-op in Node, a plain dot + shrinking ring in browsers.
mixin({
  _createCalUI() {
    const ig = this;
    if (!HAS_DOM || this._headlessMode) {
      return { show() {}, showDot() {}, setBubble() {}, pop() { return Promise.resolve(); }, hide() {}, showMessage() {}, destroy() {} };
    }
    const z = this._opts.zIndex;
    const el = (css) => { const d = document.createElement('div'); d.style.cssText = css; return d; };
    const root = el('position:fixed;inset:0;z-index:' + z + ';background:#111;display:none;cursor:none;font:16px/1.4 system-ui,sans-serif;color:#eee;');
    const msg = el('position:absolute;left:0;right:0;top:40%;text-align:center;pointer-events:none;');
    const ring = el('position:absolute;width:80px;height:80px;margin:-40px 0 0 -40px;border-radius:50%;border:3px solid #6cf;box-sizing:border-box;display:none;');
    const dot = el('position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;display:none;transition:opacity .3s,transform .3s;');
    root.append(msg, ring, dot);
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Eye tracking calibration');
    const place = (n, x, y) => { n.style.left = x + 'px'; n.style.top = y + 'px'; };
    return {
      show() { if (!root.isConnected) document.body.appendChild(root); root.style.display = 'block'; },
      showDot(x, y) { place(ring, x, y); place(dot, x, y); ring.style.transform = 'scale(1)'; ring.style.display = dot.style.display = 'block'; dot.style.opacity = '1'; dot.style.transform = 'scale(1)'; },
      setBubble(p, info) { ring.style.transform = 'scale(' + Math.max(0.15, 1 - p) + ')'; ring.style.opacity = info && info.holding ? '0.4' : '1'; },
      pop() { ring.style.display = 'none'; dot.style.opacity = '0'; dot.style.transform = 'scale(2.5)'; return ig._sleep(POP_MS).then(() => { dot.style.display = 'none'; }); },
      hide() { root.style.display = 'none'; ring.style.display = dot.style.display = 'none'; msg.textContent = ''; },
      showMessage(text, detail) { msg.textContent = [text, detail].filter(Boolean).join(' — '); },
      destroy() { root.remove(); },
    };
  },
  _ensureCalUI() { return this._calUI || (this._calUI = this._createCalUI()); },
  _settingsAvailable() { return typeof this._createSettingsUI === 'function' && HAS_DOM && !this._headlessMode; },
});


// =====================================================================================================================
// ===== API =====
// Public methods (none throws; promises never reject):
//   await ig.init()                  settings dialog (or quick start: options.autoStart + a matching saved calibration;
//                                    or, without a dialog / with ui:false, start + calibrate). Resolves true once the
//                                    engine runs, false when closed without starting / failed / in Node.
//   await ig.start(overrides?)       engine without the dialog (imports a matching saved calibration: needsCheck)
//   ig.openSettings() / ig.closeSettings()   <dialog> over the host; the ENGINE KEEPS RUNNING
//   await ig.calibrate({layout?})    -> quality object + {ok, confidence, validation, warnings} | {ok:false, reason, message}
//   await ig.recenter()              1 centre dot (2 s) -> {ok, dx, dy, gain, errPx} | {ok:false, reason}
//   ig.learn(x, y, {weight}?)        host-confirmed fixation on viewport point (x, y) NOW -> {accepted, reason, errPx?}
//   ig.setOptions(partial) / ig.getOptions()   live where possible; persisted (options.persist)
//   ig.on(type, fn) -> unsubscribe; ig.off(type, fn)    'data' | 'status' | 'calibration' | 'quality' | 'blink' | 'saccade'
//   ig.latest; ig.quality(); ig.toggleDebug(force?)
//   ig.startRecording({maxSeconds}?) / ig.stopRecording() -> object / ig.downloadRecording(filename?)
//   ig.forgetCalibration(); ig.stop() (pause camera + loop); await ig.destroy() (full teardown)
//   ig.exportCalibration() -> object | null; ig.importCalibration(object) -> {ok, reason?}   [v2.1] session files
// Window CustomEvents: 'inkgaze:data', 'inkgaze:status', 'inkgaze:blink', 'inkgaze:saccade' (detail = the listener
// object); + 'trk:data' / 'trk:status' when options.legacyEvents. Status states: invoked | settings | loading | warming | ready-to-calibrate |
// calibrating | tracking | paused | lost | error (detail.code, detail.message) | closed.
//
// DATA packet, sent options.rate times per second ([v2.1]; a FRESH plain object per packet; numbers / booleans / null
// only; treat as read-only):
//   { t (integer ms, performance.now() timeline, strictly increasing: the packet's send time), seq (packet counter),
//     fps (camera frames processed per second), inferMs, fresh (a new camera frame since the previous packet),
//     frameT (time of the newest camera frame used), valid (that frame produced a gaze estimate), calibrated,
//     state: 'fixation'|'saccade'|'blink'|'lost'|'uncalibrated',
//     x, y (smoothed gaze, viewport CSS px, UNCLAMPED; interpolated between camera frames when the rate is above the
//     camera's; held through blink / lost; null until the first estimate and whenever uncalibrated), rawX, rawY
//     (unsmoothed, newest frame; null without an estimate), nx = x / innerWidth, ny = y / innerHeight, saccade
//     (pen-lift hint: a saccade since the PREVIOUS packet), escape (an ESCAPE saccade since the previous packet: a
//     jump of >= options.escapeAmplitude of the viewport diagonal), fixationMs (time since the current fixation began;
//     0 without an estimate), blinkMs (how long the eyes have been closed so far; 0 = open), blinked (duration in ms
//     of a blink that ENDED since the previous packet; 0 = none),
//     eyes: {h, v, aperture, iod} | null   raw IMAGE-axis features: iris offset from the eye-corner midpoint / eye
//                                          width (h + = image right, v + = image down), lid aperture / eye width,
//                                          inter-ocular px. Not mirrored, not calibrated.
//     face: {x, y, w, h} | null            normalised 0..1 box in the USER's (selfie) view; stream >= 'eyes+face'
//     head: {yaw, pitch, roll} | null      degrees, user perspective: yaw + = user's right, pitch + = up, roll + =
//                                          toward the right shoulder; relative to the calibration neutral (absolute
//                                          before calibration); stream === 'full'
//     distance: {rel, cm} | null           rel = iod / iod at calibration (> 1 closer; null until calibrated); cm is
//                                          APPROXIMATE (iris 11.7 mm + assumed 70 deg HFOV); stream === 'full' }
// Pen-lift rule for drawing hosts: lift when saccade is true or state is not 'fixation'.
// [v2.1] Events (ig.on + window 'inkgaze:<type>'), sent the moment they are detected, independent of the data rate:
//   'blink'    {t, durationMs, long (>= options.longBlinkMs), x, y (smoothed gaze just before the eyes closed)}
//   'saccade'  {t, fromX, fromY, toX, toY, amplitudePx, amplitude (share of the viewport diagonal), angleDeg (0 = right,
//              90 = down), durationMs, velocity (px/s), escape (a large, fast jump: >= options.escapeAmplitude within
//              200 ms), chained (continues the previous jump: from = the chain's start)}
// =====================================================================================================================
mixin({
  // ---------------------------------------------------------------------------------------------- lifecycle
  init() {
    if (this._destroyed || (!HAS_DOM && !this._headlessMode)) return Promise.resolve(false);
    if (this._initPromise) return this._initPromise;
    if (this._running && this._isCalibrated() && !this._needsCheck) return Promise.resolve(true);   // nothing to do
    const p = this._initPromise = new Promise((resolve) => { this._initResolve = resolve; });
    this._attach();
    this._setStatus('invoked', { version: VERSION });
    if (this._opts.debug && !this._debugOpen) this.toggleDebug(true);   // the drawer is available from the start
    const o = this._opts;
    (async () => {
      const dialog = o.ui && this._settingsAvailable();
      if (!dialog || (o.autoStart && this._hasSavedCandidate())) {
        const ok = await this.start();
        if (!ok) { if (dialog) this.openSettings(); else this._resolveInit(false); return; }
        this._autoCalibrate();
        return;
      }
      this.openSettings();
      if (o.source === 'camera' && !this._running) { this._preload = true; this._startEngine(); }   // preload camera + model while the user reads the settings
    })().catch((e) => { reportError(e); this._resolveInit(false); });
    return p;
  },
  async start(overrides) {
    if (this._destroyed || (!HAS_DOM && !this._headlessMode)) return false;
    this._attach();
    if (overrides && typeof overrides === 'object') this.setOptions(overrides);
    this._preload = false;                       // the engine is now wanted (no longer just a dialog preload)
    const ok = await this._startEngine();
    if (ok && this._opts.source === 'camera' && !this._isCalibrated()) this._tryLoadSaved();
    if (ok) { this._resolveInit(true); if (!this._sess) this._setStatus(this._restingState(), this._needsCheck ? { code: 'calibration-loaded', message: 'Saved calibration loaded: a quick recentre is advised.' } : null); }
    return ok;
  },
  // after Start (dialog / init): quick check of an imported calibration, a full calibration, or simply resume
  _autoCalibrate() {
    if (this._destroyed || this._opts.source === 'mouse' || this._sess) return;
    if (!this._isCalibrated()) this.calibrate();
    else if (this._needsCheck) this._quickStart();
  },
  // the settings dialog's Start / Resume button
  async _dialogStart() {
    this._closeSettings(true);
    const ok = await this.start();
    if (!ok) { if (this._settingsAvailable()) this.openSettings(); return false; }
    this._autoCalibrate();
    return true;
  },
  stop() {
    if (this._destroyed) return;
    this._cancelSession('stop');
    this._gen++; this._enginePromise = null;
    this._stopLoop(); this._closeCamera(); this._detachMouse(); this._wakeLock(false);
    this._clearTimeout(this._hiddenTimer); this._hiddenTimer = 0;
    this._smoother = null; this._lost = false; this._faceSince = null; this._fixStartT = null; this._blk.closedT = null;
    this._setStatus('paused', { message: 'Stopped: call start() to resume.' });
  },
  async destroy() {
    if (this._destroyed) return;
    this._cancelSession('stop');
    this._gen++; this._enginePromise = null;
    this._stopLoop(); this._closeCamera(); this._detachMouse(); this._wakeLock(false);
    if (this._rec) this._stopRec(false);
    this._destroyed = true;
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    if (this._ac) { this._ac.abort(); this._ac = null; }
    for (const slot of ['_calUI', '_settingsUI', '_debugUI']) { this._uiCall(slot, 'destroy'); this[slot] = null; }
    if (this._video) { try { this._video.remove(); } catch (e) { /* ignore */ } this._video = null; }
    const lm = this._lm; this._lm = null; this._lmKey = '';
    if (lm) { try { await lm.close(); } catch (e) { reportError(e); } }   // an in-flight creation closes itself
    this._resolveInit(false);
    this._setStatus('closed', { message: 'InkGaze was destroyed.' });
    for (const k of EVENT_TYPES) this._listeners[k].clear();
    this._pipe = null; this._ring.fill(null);
  },

  // ---------------------------------------------------------------------------------------------- settings dialog
  openSettings() {
    if (this._destroyed || !this._settingsAvailable()) return false;
    if (this._sess) this._cancelSession('settings');
    this._attach();
    if (!this._settingsUI) this._settingsUI = this._createSettingsUI();
    this._uiCall('_settingsUI', 'open');
    this._uiCall('_settingsUI', 'sync', this.getOptions());
    if (this._devices.length) this._uiCall('_settingsUI', 'devices', this._devices.slice());
    this._setStatus('settings');
    return true;
  },
  closeSettings() { return this._closeSettings(false); },
  // starting = closed by Start / a calibration (no status of its own). A user close during init() (nothing started
  // yet) cancels: the preloading camera stops, status 'closed', init() resolves false. Otherwise the engine resumes.
  _closeSettings(starting) {
    if (!this._settingsUI) return false;
    const wasOpen = !!this._uiCall('_settingsUI', 'isOpen');
    this._uiCall('_settingsUI', 'close');
    if (!wasOpen || starting) return wasOpen;
    if (this._initResolve) {
      if (this._preload) { this._preload = false; this.stop(); }   // only the dialog's own preload is undone
      this._setStatus('closed', { message: 'Settings closed without starting.' });
      this._resolveInit(false);
    } else this._setStatus(this._restingState());
    return true;
  },

  // ---------------------------------------------------------------------------------------------- events
  on(type, fn) {
    const set = this._listeners[type];
    if (!set || typeof fn !== 'function') return () => {};
    set.add(fn);
    return () => set.delete(fn);
  },
  off(type, fn) { const set = this._listeners[type]; if (set) set.delete(fn); },

  // ---------------------------------------------------------------------------------------------- options
  getOptions() { return cloneOptions(this._opts); },
  setOptions(partial) {
    if (this._destroyed || !partial || typeof partial !== 'object') return this.getOptions();
    const p = cloneOptions(partial);
    for (const k of Object.keys(ENUMS)) if (k in p && !ENUMS[k].includes(k === 'layout' ? String(p[k]) : p[k])) delete p[k];   // invalid: ignored
    const prev = this._opts, next = sanitize(Object.assign(cloneOptions(prev), p));
    this._opts = next;
    const changed = (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]);
    if (this._pipe) this._pipe.cfg.cameraMirrored = next.cameraMirrored;     // live (head pose / face box)
    if (changed('reachGain')) this._applyReachGain();                         // live
    if (changed('headWeight')) this._applyHeadWeight();                       // live ([v2.1] rows refitted, no re-calibration)
    if (changed('smoothing')) this._smoother = null;                          // live
    if (changed('rate')) this._nextEmitT = null;                              // live (the stream re-times itself)
    if (changed('debug')) this.toggleDebug(next.debug);
    if (changed('pointer') || changed('head')) this._invalidateCalibration('options');   // the mapping no longer applies
    if (['source', 'cameraId', 'resolution', 'delegate', 'mpSmoothing', 'mpVersion', 'cdnBase', 'modelUrl'].some(changed)) this._reconfigure();
    this._saveSettings();
    this._uiCall('_settingsUI', 'sync', this.getOptions());
    if (changed('reachGain') || changed('headWeight') || changed('cameraMirrored') || changed('source')) this._checkQuality(true);
    return this.getOptions();
  },
  // [v2.1] head influence: the pipeline recomputes every row's head-compensated gaze from its raw aggregate and refits
  _applyHeadWeight() {
    const p = this._pipe;
    if (!p || !p.setHeadWeight) return;
    p.setHeadWeight(this._opts.headWeight);
    if (this._isCalibrated() && this._opts.source === 'camera') {
      this._mirroredFit = p.quality().mirrored;
      this._refreshNoise(); this._smoother = null;
      this._saveCalibration();
    }
  },
  // reach gain is read live by the pipeline; a state round trip recomputes noisePx (scaled by max gain) and the
  // learned-row thresholds (rows are stored with the gain removed). Resets the pose low-pass and movement anchor.
  _applyReachGain() {
    const p = this._pipe;
    if (!p) return;
    p.cfg.reachGain = this._opts.reachGain.slice();
    if (this._isCalibrated() && this._opts.source === 'camera') {
      const s = p.exportState();
      if (s) p.importState(s);
      this._refreshNoise(); this._smoother = null;
      this._saveCalibration();
    }
  },

  // ---------------------------------------------------------------------------------------------- quality
  quality() {
    const o = this._opts, s = this._stats, mouse = o.source === 'mouse';
    const q = mouse ? { calibrated: this._running, synthetic: true, points: 0, rows: 0, learnedRows: 0, noisePx: MOUSE_NOISE_PX,
      axisX: true, axisY: true, snr: [Infinity, Infinity], weak: [false, false], mirrored: null, head: 'off', offset: [0, 0],
      moved: false, recenterSuggested: false }
      : this._isCalibrated() ? this._pipe.quality() : { calibrated: false };
    const vc = !mouse && this._viewportChanged();
    q.viewportChanged = vc;
    if (q.calibrated) q.recenterSuggested = !!(q.recenterSuggested || vc || this._needsCheck);
    q.needsCheck = this._needsCheck; q.confidence = this._confidence; q.validation = this._validation;
    q.layout = this._lastCalibration ? this._lastCalibration.layout : null;
    q.calView = this._calView ? { w: this._calView.w, h: this._calView.h } : null;
    q.view = { w: this._view.w, h: this._view.h };
    q.noisePxViewport = mouse ? MOUSE_NOISE_PX : (this._noisePx || null);
    q.source = o.source;
    q.runtime = { state: this._state, fps: round(s.fps, 1), rate: o.rate, sentHz: round(s.sentRate, 1), sent: s.sent, inferMs: round(s.inferMs, 2),
      frames: s.frames, dropped: s.dropped, errors: s.errors, delegate: this._delegateUsed, mpVersion: o.mpVersion, video: this._videoSize(),
      recording: !!this._rec, version: VERSION };
    return q;
  },

  // ---------------------------------------------------------------------------------------------- learning
  learn(x, y, opts) {
    if (this._destroyed) return { accepted: false, reason: 'destroyed' };
    if (this._opts.source === 'mouse') return { accepted: true, reason: 'mouse' };
    if (!this._isCalibrated()) return { accepted: false, reason: 'uncalibrated' };
    if (!finite(x) || !finite(y)) return { accepted: false, reason: 'invalid' };
    const frames = this._fixationFrames();
    const [sx, sy] = this._toCal(x, y);
    const w = opts && finite(opts.weight) ? Math.max(0.05, Math.min(1, opts.weight)) : undefined;
    const res = Object.assign({ frames: frames.length }, this._pipe.learn(frames, sx, sy, w));
    if (res.accepted) {
      this._mirroredFit = this._pipe.quality().mirrored;
      this._refreshNoise();
      this._saveCalibration();
    }
    this._recEvent('learn', Object.assign({ x, y }, res));
    this._emit('calibration', Object.assign({ phase: 'learn', x, y }, res));
    this._checkQuality(true);
    return res;
  },

  // ---------------------------------------------------------------------------------------------- debug
  toggleDebug(force) {
    const want = typeof force === 'boolean' ? force : !this._debugOpen;
    if (typeof this._createDebugUI === 'function' && HAS_DOM && !this._headlessMode && !this._destroyed) {
      if (!this._debugUI) this._debugUI = this._createDebugUI();
      const r = this._uiCall('_debugUI', 'toggle', want);
      this._debugOpen = typeof r === 'boolean' ? r : want;
    } else this._debugOpen = want;
    if (this._opts.debug !== this._debugOpen) { this._opts.debug = this._debugOpen; this._saveSettings(); }
    if (this._debugOpen) this._checkQuality(true);
    return this._debugOpen;
  },

  // ---------------------------------------------------------------------------------------------- recording
  // landmark-only JSON (NO images): per frame t, video size, the landmark subset the maths uses (normalised, as given
  // to the library: NOT mirrored), the pose matrix, the outputs and the state; calibration events with dot targets and
  // timestamps; options, screen and viewport size. Bounded to 120 s.
  startRecording(opts) {
    if (this._destroyed) return false;
    if (this._rec) return true;
    const sec = opts && finite(opts.maxSeconds) ? opts.maxSeconds : REC_MAX_MS / 1000;
    const scr = HAS_DOM && window.screen ? { w: window.screen.width, h: window.screen.height, dpr: window.devicePixelRatio || 1 } : null;
    this._rec = {
      format: 'inkgaze-recording', schema: 1, version: VERSION, mpVersion: this._opts.mpVersion, delegate: this._delegateUsed,
      startedAt: new Date().toISOString(), t0: null, maxMs: Math.min(REC_MAX_MS, Math.max(1000, sec * 1000)),
      options: this.getOptions(), screen: scr, viewport: { w: this._view.w, h: this._view.h }, video: this._videoSize(),
      landmarkIndices: LM_SUBSET.slice(), landmarkLayout: 'frame.lm = [x, y, z] per landmarkIndices entry; normalised image coordinates as given to InkGaze',
      matrixLayout: 'frame.M = facialTransformationMatrixes[0].data (column-major 4x4)',
      calibration: this._isCalibrated() && this._opts.source === 'camera' ? { calView: this._calView, calGeom: this._calGeom, layout: this._lastCalibration && this._lastCalibration.layout, state: this._pipe.exportState() } : null,
      frames: [], events: [],
    };
    this._recEvent('recording-start', null);
    return true;
  },
  stopRecording() { return this._rec ? this._stopRec(false) : null; },
  downloadRecording(filename) {
    const r = this._rec ? this._stopRec(false) : this._lastRec;
    if (!r || !HAS_DOM || typeof Blob === 'undefined') return r || null;
    const url = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'inkgaze-recording-' + r.startedAt.replace(/[:.]/g, '-') + '.json';
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return r;
  },

  // ---------------------------------------------------------------------------------------------- persistence
  /** Remove every saved calibration (all cameras / screens / pointers); the live model is kept. */
  forgetCalibration() { for (const k of store.keys(this._opts.storageKey + ':cal:')) store.del(k); },
  /**
   * [v2.1] The live calibration as a plain JSON-safe object, for host apps that save a user's session (e.g. a drawing
   * file), or null (not calibrated / mouse source).
   */
  exportCalibration() {
    if (this._destroyed || this._opts.source !== 'camera' || !this._isCalibrated() || !this._pipe) return null;
    return JSON.parse(JSON.stringify({ format: 'inkgaze-calibration', schema: CAL_SCHEMA, version: VERSION, savedAt: Date.now(),
      calView: this._calView, calGeom: this._calGeom, head: this._opts.head, pointer: this._opts.pointer, video: this._videoSize(),
      confidence: this._confidence, layout: this._lastCalibration ? this._lastCalibration.layout : null, state: this._pipe.exportState() }));
  },
  /**
   * [v2.1] Load a calibration saved with exportCalibration(). Needs the camera running at the same video size, and the
   * same pointer and head mode; the screen-anchored mapping adapts to the current window. A quick recentre is advised
   * afterwards (quality().needsCheck). Returns {ok, reason?}.
   */
  importCalibration(data) {
    if (this._destroyed) return { ok: false, reason: 'destroyed' };
    if (this._opts.source !== 'camera') return { ok: false, reason: 'mouse-source' };
    if (!data || data.format !== 'inkgaze-calibration' || data.schema !== CAL_SCHEMA || !data.state || !data.state.screen || !data.calView) return { ok: false, reason: 'invalid' };
    const size = this._videoSize();
    if (!size) return { ok: false, reason: 'camera-not-running' };
    if (data.head !== this._opts.head || data.pointer !== this._opts.pointer) return { ok: false, reason: 'different-mode' };
    let p;
    try {
      p = core.createPipeline({ screen: data.state.screen, video: size }, this._coreOpts());
      if (!p.importState(data.state)) return { ok: false, reason: 'different-camera-or-screen' };
    } catch (e) { reportError(e); return { ok: false, reason: 'error' }; }
    this._cancelSession('stop');
    this._pipe = p; this._pipeKey = this._pipeKeyNow(); this._calView = { w: data.calView.w, h: data.calView.h };
    this._calGeom = data.calGeom && typeof data.calGeom === 'object' ? data.calGeom : null;
    this._afterModelChange(p);
    this._needsCheck = true; this._confidence = data.confidence || null; this._validation = null;
    this._lastCalibration = { at: data.savedAt || Date.now(), layout: data.layout || null, confidence: data.confidence || null, loaded: true };
    this._saveCalibration();
    this._recEvent('loaded', { savedAt: data.savedAt, layout: data.layout || null, imported: true });
    this._emit('calibration', { phase: 'loaded', savedAt: data.savedAt, layout: data.layout || null, imported: true });
    if (this._running && !this._sess && this._state !== 'settings') this._setStatus(this._restingState(), { code: 'calibration-loaded', message: 'Calibration imported: a quick recentre is advised.' });
    this._checkQuality(true);
    return { ok: true };
  },

  // ---------------------------------------------------------------------------------------------- test hook
  /**
   * TEST HOOK (Node / offline): run the engine without camera, MediaPipe or DOM. Frames are injected with
   * _processResult(result, t) (camera source) or by setting _mouse and calling _processPointer(t) (mouse source).
   * @param {{view?: {w, h}, video?: {w, h}, timeScale?: number}} [cfg] timeScale scales the UX pauses only
   */
  _headless(cfg) {
    const c = cfg || {};
    this._headlessMode = true;
    if (c.view) this._view = Object.assign({}, c.view);   // {w, h} (+ x, y: the viewport's screen position, trusted)
    if (c.video) this._vsize = { w: c.video.w, h: c.video.h };
    if (c.timeScale != null) this._timeScale = c.timeScale;
    this._running = true; this._lost = false;
    this._ensurePipe();
    if (this._opts.source === 'camera' && !this._isCalibrated()) this._tryLoadSaved();
    this._setStatus(this._restingState());
    return this;
  },
});

// ------------------------------------------------------------------------------------------------ calibration flows
// Orchestration (design-spec §3, §7.1, §10). Rendering goes through this._calUI (UI hooks, see ENGINE); the dot
// collector is fed ONE frame per new camera frame from _processResult (frame-driven, testable offline). The collector
// clock is VIRTUAL: it advances only while a face is visible, so a moment out of frame pauses the dot instead of
// timing it out.
mixin({
  calibrate(opts) {
    const L = opts && opts.layout != null ? String(opts.layout) : this._opts.layout;
    const layout = ENUMS.layout.includes(L) ? L : this._opts.layout;
    if (this._opts.source === 'mouse') return this._mouseFlow('calibrate', layout);
    return this._session('calibrate', (tok) => this._runCalibration(layout, tok));
  },
  recenter() {
    if (this._opts.source === 'mouse') return this._mouseFlow('recenter');
    if (!this._isCalibrated()) return Promise.resolve({ ok: false, reason: 'uncalibrated', calibrated: false });
    return this._session('recenter', async (tok) => {
      this._calMsg('Look at the dot', 'Recentring');
      await this._waitFace(tok);
      const rc = await this._recenterFlow(tok);
      if (!rc) return { ok: false, reason: 'unstable', message: 'The fixation was not stable enough to recentre.' };
      this._needsCheck = false;
      return Object.assign({ ok: true }, rc);
    });
  },
  // mouse source: nothing to calibrate; resolve at once with a synthetic quality (states / events still run)
  async _mouseFlow(kind, layout) {
    if (this._destroyed) return { ok: false, reason: 'destroyed' };
    if (!this._running) await this._startEngine();
    const res = kind === 'recenter' ? { ok: true, synthetic: true, dx: 0, dy: 0, gain: 0, errPx: 0 }
      : Object.assign({ ok: true, synthetic: true, confidence: 'high', validation: null, warnings: [] }, this.quality(), { layout: layout || null });
    this._emit('calibration', Object.assign({ phase: kind === 'recenter' ? 'recenter' : 'done' }, kind === 'recenter' ? res : { synthetic: true, layout: layout || null }));
    this._checkQuality(true);
    return res;
  },

  // Quick start for a saved calibration (design-spec §10): import (already done) -> 2 s recentre -> held-out check at
  // a corner (never learned) -> on failure, or a recentre error > 5 x noisePx, a full calibration with options.layout.
  _quickStart() {
    if (this._opts.source === 'mouse') return this._mouseFlow('recenter');
    if (!this._isCalibrated()) return this.calibrate();
    return this._session('quick', async (tok) => {
      this._calMsg('Look at the dot', 'Quick check of your saved calibration');
      await this._waitFace(tok);
      const rc = await this._recenterFlow(tok);
      const scale = this._pipe.quality().scalePx;
      if (!rc || rc.errPx > QUICK_RECENTER_MAXK * scale) {
        this._emit('calibration', { phase: 'quick-failed', step: 'recenter', errPx: rc ? rc.errPx : null, scalePx: scale });
        this._recEvent('quick-failed', { step: 'recenter', errPx: rc ? rc.errPx : null });
        return this._runCalibration(this._opts.layout, tok);
      }
      const v = this._vp(), x = this._opts.inset * v.w, y = this._opts.inset * v.h;   // top-left corner
      this._calMsg('', 'Check');
      const need = QUICK_VALIDATE_NEED;
      const r = await this._collectDot(x, y, { need, timeoutMs: this._timeoutFor(need), label: 'check' });
      if (r.noFace) await this._abort(tok, 'no-face', NO_FACE_MSG);
      if (r.done) await this._pop(tok);
      const [sx, sy] = this._toCal(x, y);
      const val = r.done ? this._pipe.validate(r.frames, sx, sy) : null;
      if (!val || !val.ok) {
        this._emit('calibration', { phase: 'quick-failed', step: 'validate', validation: val });
        this._recEvent('quick-failed', { step: 'validate', validation: val });
        return this._runCalibration(this._opts.layout, tok);
      }
      this._needsCheck = false; this._validation = val;
      this._saveCalibration();
      this._emit('calibration', { phase: 'quick-ok', validation: val, recenter: rc });
      this._recEvent('quick-ok', { validation: val, recenter: rc });
      return Object.assign({ ok: true, quick: true, validation: val, recenter: rc, warnings: [] }, this.quality());
    });
  },

  // One overlay session at a time (calibrate / recenter / quick): owns the overlay, the cancel token and the status.
  async _session(kind, fn) {
    if (this._destroyed) return { ok: false, reason: 'destroyed', calibrated: false };
    if (!HAS_DOM && !this._headlessMode) return { ok: false, reason: 'no-dom', calibrated: false };
    if (this._sess) return { ok: false, reason: 'busy', calibrated: this._isCalibrated() };
    const tok = { cancelled: false, why: null };
    this._sess = { kind, tok };            // claimed before any await: no double sessions
    let res, failed = null, engineFailed = false;
    try {
      const started = await this._startEngine();
      if (tok.cancelled) throw CANCEL;
      if (!started) { engineFailed = true; throw failure('engine', (this._statusDetail && this._statusDetail.message) || 'The camera or the face model could not start.'); }
      this._preload = false; this._resolveInit(true);   // e.g. Calibrate pressed in the dialog: the engine is now wanted
      this._closeSettings(true);
      this._setStatus('calibrating', { kind });
      const ui = this._ensureCalUI();
      this._uiCall('_calUI', 'show');
      if (!ui) throw failure('error', 'No calibration renderer.');
      this._recEvent('session-start', { kind, view: this._vp() });
      this._emit('calibration', { phase: 'session-start', kind });
      res = await fn(tok);
      if (tok.cancelled) throw CANCEL;
    } catch (e) {
      if (e === CANCEL || tok.cancelled) res = { ok: false, reason: 'cancelled' };
      else if (e && e.igReason) { failed = e; res = { ok: false, reason: e.igReason, message: e.message }; }
      else { reportError(e); failed = failure('error', String((e && e.message) || e)); res = { ok: false, reason: 'error', message: failed.message }; }
    } finally {
      if (this._dot) { this._clearTimeout(this._dot.safety); this._dot = null; }
      for (const w of Array.from(this._waiters)) w.reject(CANCEL);
      this._sess = null;
      this._uiCall('_calUI', 'hide');
    }
    if (!res.ok) res.calibrated = this._isCalibrated();
    if (this._destroyed) return res;
    if (res.reason === 'cancelled') { this._emit('calibration', { phase: 'cancelled', kind, why: tok.why }); this._recEvent('cancelled', { kind, why: tok.why }); }
    else if (failed) { this._emit('calibration', { phase: 'failed', kind, reason: failed.igReason, message: failed.message }); this._recEvent('failed', { kind, reason: failed.igReason }); }
    if (!engineFailed && tok.why !== 'stop') {
      const w = res.ok && res.warnings && res.warnings[0];
      this._setStatus(this._restingState(), failed ? { code: 'calibration-failed', reason: failed.igReason, message: failed.message }
        : res.reason === 'cancelled' ? { code: 'calibration-cancelled', message: 'Calibration cancelled.' }
          : w ? { code: w.code, message: w.message, warnings: res.warnings } : { code: kind + '-done' });
    }
    // ESC (the user) or a failure -> back to the settings dialog; stop() / destroy() / settings cancellations do not
    if (this._opts.ui && this._settingsAvailable() && ((res.reason === 'cancelled' && tok.why === 'user') || (failed && !engineFailed))) this._timeout(() => this.openSettings(), 60);
    this._checkQuality(true);
    return res;
  },
  _cancelSession(why) {
    const s = this._sess;
    if (!s || s.tok.cancelled) return;
    s.tok.cancelled = true; s.tok.why = why || 'user';
    const d = this._dot; this._dot = null;
    if (d) d.reject(CANCEL);
    for (const w of Array.from(this._waiters)) w.reject(CANCEL);
  },

  async _runCalibration(layout, tok) {
    const o = this._opts;
    this._calMsg('Get ready', 'Keep your head still and follow the dots with your eyes');
    await this._stableViewport(tok);          // e.g. right after entering fullscreen
    const view = this._vp(), W = view.w, H = view.h, size = this._videoSize() || { w: 1280, h: 720 };
    this._view = Object.assign({}, this._view, { w: W, h: H }); this._sessView = { w: W, h: H };
    const geom = this._viewGeom();            // [v2.1] where this viewport sits on the screen (calibration anchor)
    const pipe = core.createPipeline({ screen: { w: W, h: H }, video: size }, this._coreOpts(layout));
    const targets = core.calibTargets(W, H, { layout, inset: o.inset });
    const need = this._needFor(layout), timeoutMs = this._timeoutFor(need);
    this._recEvent('calibration-start', { layout, view: { w: W, h: H }, geom, video: size, targets, need, inset: o.inset });
    this._emit('calibration', { phase: 'start', layout, need, view: { w: W, h: H }, targets: targets.map((t) => ({ x: t.sx, y: t.sy })) });
    await this._waitFace(tok);

    // 1. centre "ready" dot: the starting gaze position (dot 1's transition becomes predictable), apRef (open-eye
    //    aperture) and the per-frame noise for the collector. A calibration row when the layout starts at the centre
    //    ('5', '9', 'C+tri').
    const centreFirst = Math.abs(targets[0].sx - W / 2) < 1 && Math.abs(targets[0].sy - H / 2) < 1;
    const readyNeed = centreFirst ? need : READY_NEED;
    this._calMsg('Look at the dot', 'Hold your gaze on it until the circle closes');
    const ready = await this._collectDot(W / 2, H / 2, { need: readyNeed, timeoutMs: this._timeoutFor(readyNeed), label: 'ready', index: centreFirst ? 0 : null, total: targets.length });
    if (ready.noFace) await this._abort(tok, 'no-face', NO_FACE_MSG);
    let apRef = null, tol;
    if (ready.frames.length >= 5) {
      const F = ready.frames, mh = median(F.map((f) => f.h)), mv = median(F.map((f) => f.v));
      apRef = median(F.map((f) => f.ap));
      // design-spec §3.2 refinement tol = max(0.015, 3.5 sigma) is UNVERIFIED: used here only to WIDEN the verified
      // default (0.025) for noisy users, capped at 0.05 so a restless ready dot cannot disable the stillness test
      tol = Math.min(0.05, Math.max(0.025, 3.5 * (madSd(F.map((f) => f.h), mh) + madSd(F.map((f) => f.v), mv)) / 2));
    }
    if (ready.done) await this._pop(tok);
    this._emit('calibration', { phase: 'ready', done: ready.done, accepted: ready.accepted, apRef, tol: tol || 0.025 });

    // 2. the layout's dots (adaptive retry inside _dotWithRetry)
    const pts = [];
    for (let i = 0; i < targets.length; i++) {
      const T = targets[i];
      if (i === 0 && centreFirst && ready.done) { pts.push({ sx: T.sx, sy: T.sy, feats: ready.frames, index: i }); continue; }
      this._calMsg('', (i + 1) + ' / ' + targets.length);
      const r = await this._dotWithRetry(T.sx, T.sy, { need, timeoutMs, apRef, tol, index: i, total: targets.length }, tok);
      if (r) pts.push(Object.assign(r, { index: i }));
    }
    if (pts.length < 2) await this._abort(tok, 'too-few-dots', 'Your eyes could not be detected reliably. Check the lighting (face evenly lit from the front) and the distance (about 50-70 cm), then try again, or choose a larger inset.');

    // 3. fit; with >= 6 dots (the 9-dot grid) a leave-one-out outlier is re-collected once. [v2.1] No held-out check of
    //    the 3rd 'tri' dot any more: on real data a 2-dot fit mispredicts a good 3rd dot by 130..1000 px (the rows of
    //    dots are twisted), so the check always failed and escalated
    let confidence = pts.length < targets.length ? 'low' : targets.length >= 5 ? 'high' : 'medium';
    let ok = pipe.calibrate(pts).ok;
    if (ok && pts.length >= 6) { const c2 = await this._recollectSuspect(pipe, pts, { need, apRef, tol }, tok); ok = c2 !== null; if (c2 === 'low') confidence = 'low'; }
    if (!ok) await this._abort(tok, 'fit-failed', 'Calibration failed: not enough stable fixations. Please try again (or use a larger inset).');
    if (tok.cancelled) throw CANCEL;
    this._commit(pipe, { w: W, h: H }, geom, { layout, confidence, validation: null, dots: pts.map((p) => ({ x: p.sx, y: p.sy, moved: !!p.moved, frames: p.feats.length })) });

    // 4. axis check (classic LIS keeps vertical eye movement; horizontal palsy pins X) + weak axes
    const q = this.quality(), warnings = [];
    if (q.axisX === false) warnings.push({ code: 'axis-x', message: 'No usable horizontal eye movement was detected: X is pinned at the calibration mean (vertical-only, 1-D use).' });
    if (q.axisY === false) warnings.push({ code: 'axis-y', message: 'No usable vertical eye movement was detected: Y is pinned at the calibration mean (horizontal-only, 1-D use).' });
    const weak = [q.axisX && q.weak[0] ? 'horizontal' : null, q.axisY && q.weak[1] ? 'vertical' : null].filter(Boolean);
    if (weak.length) warnings.push({ code: 'weak-axis', message: 'The ' + weak.join(' and ') + ' eye signal is weak or noisy: consider longer dots or a larger inset.' });
    if (confidence === 'low') warnings.push({ code: 'low-confidence', message: 'Calibration confidence is low (a dot was skipped or looked inconsistent). Consider calibrating again with the 9-dot layout.' });
    else if (confidence === 'medium') warnings.push({ code: 'few-dots', message: 'With ' + targets.length + ' dots the mapping is a straight-line fit: the corners are the least accurate. The 5-dot (default) or 9-dot layout fits better.' });
    this._emit('calibration', { phase: 'done', layout, confidence, validation: null, warnings, quality: q });
    this._recEvent('calibrated', { layout, confidence, model: q.model, kappa: q.kappa, kappaRatio: q.kappaRatio, warnings: warnings.map((w) => w.code), noisePx: q.noisePx, rmsePx: q.rmsePx, looRms: q.looRms });
    if (o.showQuality) {
      this._calMsg('Calibrated', q.points + ' dots, ' + q.model + ' fit, error at the dots about ' + Math.round(q.rmsePx) + ' px' + (warnings.length ? ' — ' + warnings[0].message : ''));
      await this._sleep(QUALITY_MSG_MS);
    }
    return Object.assign({ ok: true, confidence, validation: null, warnings }, q);
  },

  // the worst leave-one-out dot (quality().suspect) is re-collected ONCE. Returns 'high' | 'low' | null (fit failed).
  async _recollectSuspect(pipe, pts, dotOpts, tok) {
    let q = pipe.quality();
    if (q.suspect == null) return 'high';
    const row = pipe.exportState().rows.filter((r) => r.cal)[q.suspect];        // rows follow pts (minus failed dots)
    const k = row ? pts.findIndex((p) => Math.abs(p.sx - row.sx) < 1e-6 && Math.abs(p.sy - row.sy) < 1e-6) : -1;
    if (k < 0) return 'low';
    this._emit('calibration', { phase: 'recollect', index: pts[k].index, x: pts[k].sx, y: pts[k].sy, loo: q.loo });
    this._recEvent('recollect', { index: pts[k].index, x: pts[k].sx, y: pts[k].sy, loo: q.loo });
    this._calMsg('Once more', 'Look at the dot again');
    const r = await this._collectDot(pts[k].sx, pts[k].sy, Object.assign({ timeoutMs: this._timeoutFor(dotOpts.need), label: 'recollect', index: pts[k].index }, dotOpts));
    if (r.noFace) await this._abort(tok, 'no-face', NO_FACE_MSG);
    if (r.done) {
      await this._pop(tok);
      pts[k] = Object.assign({}, pts[k], { feats: r.frames });
      if (!pipe.calibrate(pts).ok) return null;
      q = pipe.quality();
    }
    return q.suspect == null ? 'high' : 'low';
  },

  // one dot with the adaptive retry (design-spec §3.4): timed out -> move 30 % toward the centre and retry once (the
  // moved position becomes the target), then skip. A timeout means "cannot hold the eye still there" (often lid
  // occlusion at the bottom edge), not "cannot reach": the collector checks stability, never position.
  async _dotWithRetry(x, y, opts, tok) {
    let r = await this._collectDot(x, y, opts);
    if (r.noFace) await this._abort(tok, 'no-face', NO_FACE_MSG);
    if (r.done) { await this._pop(tok); return { sx: x, sy: y, feats: r.frames }; }
    const v = this._sessView || this._view, x2 = x + 0.3 * (v.w / 2 - x), y2 = y + 0.3 * (v.h / 2 - y);
    this._emit('calibration', { phase: 'retry', index: opts.index, from: { x, y }, x: x2, y: y2, accepted: r.accepted });
    this._recEvent('retry', { index: opts.index, from: { x, y }, x: x2, y: y2, accepted: r.accepted });
    r = await this._collectDot(x2, y2, Object.assign({}, opts, { label: 'retry' }));
    if (r.noFace) await this._abort(tok, 'no-face', NO_FACE_MSG);
    if (r.done) { await this._pop(tok); return { sx: x2, sy: y2, feats: r.frames, moved: true }; }
    this._emit('calibration', { phase: 'skip', index: opts.index, x: x2, y: y2, accepted: r.accepted });
    this._recEvent('skip', { index: opts.index, x: x2, y: y2, accepted: r.accepted });
    return null;
  },

  // Show a dot + bubble at (x, y) (viewport px); resolves {done, timedOut, noFace?, frames, accepted} when the
  // collector is done or timed out. Fed by _onDotFrame. Rejects with CANCEL on cancel.
  _collectDot(x, y, opts) {
    const tok = this._sess && this._sess.tok;
    this._ensureCalUI();
    return new Promise((resolve, reject) => {
      if (!tok || tok.cancelled) { reject(CANCEL); return; }
      const mk = () => core.createDotCollector({ need: opts.need, timeoutMs: opts.timeoutMs || 4000, apRef: opts.apRef || null, tol: opts.tol || 0.025 });
      const d = { x, y, opts, mk, col: mk(), vt: 0, lastT: null, lastAcc: 0, lastAccVt: 0, progress: 0, safety: 0 };
      const end = () => { this._clearTimeout(d.safety); if (this._dot === d) this._dot = null; };
      d.resolve = (r) => { end(); resolve(r); };
      d.reject = (e) => { end(); reject(e); };
      // wall-clock safety net: frames stopped arriving altogether (camera hang)
      d.safety = this._timeout(() => { if (this._dot === d) d.resolve({ done: false, timedOut: true, stalled: true, frames: d.col.frames(), accepted: d.lastAcc }); }, (opts.timeoutMs || 4000) + FACE_WAIT_MS);
      this._dot = d;
      const info = { label: opts.label || 'dot', index: opts.index == null ? null : opts.index, total: opts.total || null, need: opts.need };
      this._uiCall('_calUI', 'showDot', x, y, info);
      this._uiCall('_calUI', 'setBubble', 0, { holding: false, faceMissing: false, accepted: 0, need: opts.need });
      this._recEvent('dot-start', Object.assign({ x, y }, info));
      this._emit('calibration', Object.assign({ phase: 'dot', x, y }, info));
    });
  },
  _onDotFrame(f, t, closed) {
    const d = this._dot;
    const dt = d.lastT == null ? 0 : Math.min(100, Math.max(0, t - d.lastT));
    d.lastT = t;
    if (f && closed) {   // [v2.1] a detected blink: the clock runs, the frame is not used, the bubble pauses
      d.vt += dt;
      this._uiCall('_calUI', 'setBubble', d.progress, { holding: true, faceMissing: false, accepted: d.lastAcc, need: d.opts.need });
      return;
    }
    if (!f) {   // no face: the dot's clock pauses
      this._uiCall('_calUI', 'setBubble', d.progress, { holding: true, faceMissing: t - this._lastFaceT > 300, accepted: d.lastAcc, need: d.opts.need });
      if (t - this._lastFaceT > FACE_WAIT_MS) d.resolve({ done: false, timedOut: false, noFace: true, frames: d.col.frames(), accepted: d.lastAcc });
      return;
    }
    d.vt += dt;
    const st = d.col.push(f, d.vt);
    if (st.accepted > d.lastAcc) { d.lastAcc = st.accepted; d.lastAccVt = d.vt; }
    d.progress = st.progress;
    // bubble radius = r0 * (1 - accepted / need): evidence collected, NOT wall time and NOT a cursor distance
    this._uiCall('_calUI', 'setBubble', st.progress, { holding: d.vt > 600 && d.vt - d.lastAccVt > 300, faceMissing: false, accepted: st.accepted, need: d.opts.need });
    if (st.done || st.timedOut) {
      this._recEvent('dot-end', { x: d.x, y: d.y, label: d.opts.label || 'dot', accepted: st.accepted, done: st.done });
      this._emit('calibration', { phase: 'dot-end', x: d.x, y: d.y, label: d.opts.label || 'dot', index: d.opts.index == null ? null : d.opts.index, accepted: st.accepted, done: st.done });
      d.resolve({ done: st.done, timedOut: st.timedOut, frames: d.col.frames(), accepted: st.accepted });
    }
  },
  _restartDot() { const d = this._dot; if (d) { d.col = d.mk(); d.vt = 0; d.lastT = null; d.lastAcc = 0; d.lastAccVt = 0; d.progress = 0; } },

  // 1-dot recentre (2 s at the viewport centre): offset update shrunk by its own noise (never makes a good model worse)
  async _recenterFlow(tok) {
    const v = this._vp(), x = v.w / 2, y = v.h / 2;
    const need = Math.max(20, Math.min(60, Math.round(RECENTER_SECONDS * this._fpsEstimate())));
    const r = await this._collectDot(x, y, { need, timeoutMs: this._timeoutFor(need), label: 'recenter' });
    if (r.noFace) await this._abort(tok, 'no-face', NO_FACE_MSG);
    if (r.done) await this._pop(tok);
    if (r.frames.length < 10) return null;
    const [sx, sy] = this._toCal(x, y);
    const res = this._pipe.recenter(r.frames, sx, sy);
    if (!res) return null;
    this._smoother = null; this._fixStartT = null;
    this._refreshNoise();
    this._saveCalibration();
    this._recEvent('recenter', Object.assign({ x, y, frames: r.frames.length }, res));
    this._emit('calibration', Object.assign({ phase: 'recenter', x, y, frames: r.frames.length }, res));
    return res;
  },

  async _pop(tok) {
    await Promise.resolve(this._uiCall('_calUI', 'pop'));
    await this._sleep(GAP_MS);
    if (tok.cancelled) throw CANCEL;
  },
  async _waitFace(tok) {
    const stable = () => this._faceSince != null && this._lastFrameT - this._faceSince >= 300;
    if (stable()) return;
    this._calMsg('Looking for your face…', 'Sit about 50-70 cm from the screen with your face evenly lit');
    const ok = await this._waitFor(stable, FACE_WAIT_MS);
    if (tok.cancelled) throw CANCEL;
    if (!ok) await this._abort(tok, 'no-face', NO_FACE_MSG);
    this._calMsg('Look at the dot', '');
  },
  async _stableViewport(tok) {
    const t0 = now();
    while (now() - this._lastResizeT < 250 && now() - t0 < 1500) { await new Promise((r) => this._timeout(r, 80)); if (tok.cancelled) throw CANCEL; }
    this._view = Object.assign({}, this._view, this._vp());   // (headless tests keep _view.x / y)
  },
  async _abort(tok, reason, message) {
    this._calMsg('Calibration stopped', message);
    await this._sleep(ABORT_MSG_MS);
    if (tok.cancelled) throw CANCEL;
    throw failure(reason, message);
  },
  _calMsg(text, detail) { this._uiCall('_calUI', 'showMessage', text || '', detail || ''); },
  _needFor(layout) {
    if (this._opts.dotSeconds) return Math.max(10, Math.round(this._opts.dotSeconds * this._fpsEstimate()));
    return Math.round((NEED[layout] || 30) * Math.max(1, this._fpsEstimate() / 30));   // [v2.1] same TIME at 60 fps
  },
  _fpsEstimate() { const f = this._stats.fps; return f > 5 ? Math.min(60, f) : 30; },
  // the spec's 4 s timeout, stretched for slow cameras (low light: 15 fps) so `need` frames remain reachable
  _timeoutFor(need) { return Math.max(4000, 300 + 1600 * need / this._fpsEstimate()); },

  // a calibrated pipeline becomes the live mapping: persisted, output stage reset. geom = the viewport's place on the
  // screen at calibration ([v2.1] _viewGeom: later window changes translate the calibration)
  _commit(pipe, view, geom, info) {
    this._pipe = pipe; this._pipeKey = this._pipeKeyNow(); this._calView = { w: view.w, h: view.h }; this._calGeom = geom || null;
    this._needsCheck = false; this._confidence = info.confidence || null; this._validation = info.validation || null;
    this._lastCalibration = Object.assign({ at: Date.now() }, info);
    this._afterModelChange(pipe);
    this._saveCalibration();
  },
  // pointer / head / camera / video size changed: the mapping no longer applies (a saved one for the new key may)
  _invalidateCalibration(reason) {
    this._cancelSession('stop');
    const had = this._isCalibrated();
    this._pipe = null; this._pipeKey = ''; this._calView = null; this._calGeom = null; this._needsCheck = false; this._confidence = null; this._validation = null;
    this._iodCal = null; this._mirroredFit = null; this._smoother = null; this._x = this._y = null; this._noisePx = 0;
    this._ensurePipe();
    const loaded = this._running && this._tryLoadSaved();
    if (had || loaded) this._emit('calibration', { phase: 'invalidated', reason, loaded });
    if (this._running && !this._sess && this._state !== 'settings') {
      this._setStatus(this._restingState(), loaded ? { code: 'calibration-loaded', message: 'Saved calibration loaded: a quick recentre is advised.' }
        : had ? { code: 'calibration-invalidated', reason, message: 'The calibration no longer applies (' + reason + '): please calibrate.' } : null);
    }
    this._checkQuality(true);
  },
});
const NO_FACE_MSG = 'No face was detected. Check that the camera sees your whole face and that the lighting is even, then try again.';
const median = core._util.median, madSd = core._util.madSd;


// =====================================================================================================================
// ===== UI: calibration =====
// Full-viewport WHITE overlay with 48 px 40 %-black dots (v1 look), shown in the TOP LAYER (<dialog>.showModal(): above
// any host z-index, host inert; fallback without <dialog>: position fixed + options.zIndex). The engine drives it
// through this._calUI (hooks: see ENGINE); the collector, the timing and the orchestration live in the API section.
//   bubble   an outline ring CENTRED ON THE DOT that closes onto the dot as the collector accepts frames:
//            ring radius = dot radius + r0 * (1 - accepted / need)  (r0 = (--ig-bubble-size - --ig-dot-size) / 2):
//            evidence collected, NOT wall time and NOT a cursor distance. It pauses (and fades, class ig-hold) on
//            blinks / wandering / a lost face. NO steering cursor: nothing has to be moved onto the dot.
//   pop      scale + fade of the dot (a plain fade under prefers-reduced-motion, in CSS), then the engine's 150 ms gap.
//   cancel   ESC (engine key handler / the dialog's cancel event), the Cancel button (shown while the pointer moves)
//            or leaving fullscreen cancel the session; the engine then reopens the settings dialog.
//   debug    while the debug drawer is open, a small HUD on the side OPPOSITE the current dot (the drawer and its
//            button hide during calibration so they never cover a dot).
// Shared DOM helpers of the three UI sections live here. Node / headless: a no-op renderer (no DOM access at all).
// =====================================================================================================================
let uiSeq = 0;
/** per-instance id prefix (several InkGaze instances may coexist on one page) */
function uiId(ig) { return ig._uiId || (ig._uiId = 'ig' + (++uiSeq)); }
/** tiny element builder: attrs {class, text, on<event>: fn, other: attribute (true = empty, false/null = omitted)} */
function dom(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
/** fullscreen on the document (needs a user gesture: called from the dialog's Start / Calibrate / Recenter clicks) */
function requestFullscreen() {
  if (!HAS_DOM || fsElement()) return;
  const d = document.documentElement, fn = d.requestFullscreen || d.webkitRequestFullscreen;
  if (typeof fn !== 'function' || document.fullscreenEnabled === false) return;
  try { const p = fn.call(d, { navigationUI: 'hide' }); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (e) { /* not allowed here */ }
}
// <dialog> helpers with a fallback for browsers without HTMLDialogElement (class ig-nodialog: fixed + z-index)
function showDialog(d, modal) {
  if (typeof d.showModal === 'function') {
    if (d.open) return;
    try { if (modal) d.showModal(); else d.show(); return; } catch (e) { reportError(e); }
  }
  d.setAttribute('open', ''); d.classList.add('ig-nodialog');
}
function closeDialog(d) {
  if (typeof d.close === 'function' && !d.classList.contains('ig-nodialog')) { if (d.open) { try { d.close(); } catch (e) { /* ignore */ } } return; }
  d.removeAttribute('open'); d.classList.remove('ig-nodialog');
}
const fmt = (v, k) => (v == null || (typeof v === 'number' && !isFinite(v)) ? '–' : typeof v === 'number' ? v.toFixed(k == null ? 1 : k) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
const fmtXY = (x, y, k) => (x == null || y == null ? '–' : fmt(x, k == null ? 0 : k) + ', ' + fmt(y, k == null ? 0 : k));

mixin({
  // UI hook: the last face's landmarks for the camera previews (the data packet carries no landmarks by contract).
  // Wraps the engine's face picker without changing its result.
  _pickFace: (function (base) {
    return function (r) {
      const one = base.call(this, r), lm = one && one.faceLandmarks[0];
      this._uiLm = lm && lm.length >= 478 ? lm : null;
      if (this._uiLm) this._uiLmT = now();
      return one;
    };
  })(InkGaze.prototype._pickFace),

  /** calibration renderer (replaces the ENGINE's minimal default). No-op in Node / headless mode. */
  _createCalUI() {
    if (!HAS_DOM || this._headlessMode) {
      return { show() {}, showDot() {}, setBubble() {}, pop() { return Promise.resolve(); }, hide() {}, showMessage() {}, destroy() {} };
    }
    return createCalUI(this);
  },
});

function createCalUI(ig) {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const title = dom('div', { class: 'ig-cal-title', hidden: true });
  const detail = dom('div', { class: 'ig-cal-detail', hidden: true });
  const alertEl = dom('div', { class: 'ig-cal-alert', role: 'alert', hidden: true });
  const cancel = dom('button', { type: 'button', class: 'ig-cal-cancel', text: 'Cancel (Esc)', onclick: () => { if (ig._sess) ig._cancelSession('user'); } });
  const msg = dom('div', { class: 'ig-cal-msg', 'aria-live': 'polite' }, title, detail, alertEl, cancel);
  const ring = dom('div', { class: 'ig-cal-bubble', 'aria-hidden': 'true' });
  const dot = dom('div', { class: 'ig-cal-dot', 'aria-hidden': 'true' });
  const target = dom('div', { class: 'ig-cal-target', hidden: true }, ring, dot);
  const hud = dom('pre', { class: 'ig-cal-hud', hidden: true, 'aria-hidden': 'true' });
  const root = dom('dialog', { class: 'ig-ui ig-cal', 'aria-label': 'Eye tracking calibration', autofocus: true, tabindex: '-1' }, target, msg, hud);

  let shown = false, wasFs = false, idleT = 0, info = null, hold = false, faceMissing = false;
  let dotD = 48, bubD = 144, lastD = -1, hudOn = false, hudT = 0, last = { accepted: 0, need: 0 };

  const setIdle = () => {
    root.classList.remove('ig-idle');
    ig._clearTimeout(idleT);
    idleT = ig._timeout(() => { idleT = 0; root.classList.add('ig-idle'); }, 1500);
  };
  // ESC on the modal: our own cancel path (the engine's window key handler usually got there first)
  root.addEventListener('cancel', (e) => { e.preventDefault(); if (shown && ig._sess) ig._cancelSession('user'); }, sig);
  // closed by the browser itself (e.g. Chrome closes a dialog on a repeated ESC without user activation). The event is
  // ASYNC: the 'close' of the previous hide() can arrive after the next session re-opened the dialog -> ignore it then.
  root.addEventListener('close', () => { if (shown && !root.open && ig._sess) ig._cancelSession('user'); }, sig);
  root.addEventListener('pointermove', setIdle, sig);
  root.addEventListener('pointerdown', setIdle, sig);
  // in fullscreen the browser takes ESC to exit fullscreen (the page may never see it): leaving fullscreen during a
  // session means the same as ESC, and the calibration viewport would be wrong anyway
  const onFs = () => {
    if (fsElement()) { if (shown) wasFs = true; return; }
    if (shown && wasFs && ig._sess) ig._cancelSession('user');
  };
  document.addEventListener('fullscreenchange', onFs, sig);
  document.addEventListener('webkitfullscreenchange', onFs, sig);

  const setAlert = (text) => { alertEl.textContent = text || ''; alertEl.hidden = !text; };
  const renderHud = (inf) => {
    const t = now();
    if (t - hudT < 100) return;   // ~10 Hz
    hudT = t;
    const p = ig.latest, e = p && p.eyes, i = info || {};
    const where = i.label === 'dot' || !i.label ? (i.index != null ? 'dot ' + (i.index + 1) + (i.total ? '/' + i.total : '') : 'dot') : i.label + (i.index != null && i.total ? ' ' + (i.index + 1) + '/' + i.total : '');
    hud.textContent = where + '   accepted ' + (inf ? inf.accepted : last.accepted) + '/' + (inf ? inf.need : last.need) + (hold ? '   PAUSED' : '') + (faceMissing ? '   NO FACE' : '') +
      '\nface ' + (e ? 'yes' : 'no') + '   aperture ' + fmt(e && e.aperture, 3) + '   h ' + fmt(e && e.h, 3) + '   v ' + fmt(e && e.v, 3) +
      '\nfps ' + fmt(p && p.fps, 1) + '   infer ' + fmt(p && p.inferMs, 1) + ' ms   ' + (ig._delegateUsed || '');
  };

  return {
    show() {
      if (!root.isConnected) (document.body || document.documentElement).appendChild(root);
      root.style.zIndex = String(ig._opts.zIndex);   // used only by the no-<dialog> fallback (top layer otherwise)
      shown = true; wasFs = !!fsElement(); info = null; hold = false; faceMissing = false;
      target.hidden = true; setAlert('');
      hudOn = !!ig._debugOpen; hud.hidden = !hudOn; hud.textContent = '';
      ig._uiCall('_debugUI', 'calibrating', true);
      showDialog(root, true);
      try { root.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      setIdle();
    },
    showDot(x, y, inf) {
      info = inf || null; hold = false;
      target.classList.remove('ig-pop', 'ig-hold');
      target.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      target.hidden = false;
      // themed sizes (CSS custom properties, any unit) measured once per dot: one layout
      ring.style.width = ring.style.height = '';
      // the bubble never starts beyond the viewport edge (bottom-centre dot on short screens): capped at twice the
      // dot's distance to the nearest edge
      const edge = 2 * Math.min(x, y, (window.innerWidth || x * 2) - x, (window.innerHeight || y * 2) - y);
      dotD = dot.offsetWidth || 48; bubD = Math.max(dotD, Math.min(ring.offsetWidth || 144, edge)); lastD = -1;
      hud.classList.toggle('ig-left', x > (window.innerWidth || 0) / 2);
    },
    setBubble(progress, inf) {
      const p = finite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      const d = dotD + (bubD - dotD) * (1 - p);
      if (Math.abs(d - lastD) >= 0.5) { ring.style.width = ring.style.height = d.toFixed(1) + 'px'; lastD = d; }
      const h = !!(inf && (inf.holding || inf.faceMissing));
      if (h !== hold) { hold = h; target.classList.toggle('ig-hold', h); }
      const fm = !!(inf && inf.faceMissing);
      if (fm !== faceMissing) { faceMissing = fm; setAlert(fm ? 'Your face is not visible to the camera: please move back into view.' : ''); }
      if (inf) last = { accepted: inf.accepted, need: inf.need };
      if (hudOn) renderHud(inf);
    },
    pop() {
      target.classList.add('ig-pop');            // CSS: scale + fade (fade only under prefers-reduced-motion)
      return ig._sleep(POP_MS).then(() => { target.hidden = true; target.classList.remove('ig-pop', 'ig-hold'); });
    },
    hide() {
      shown = false; wasFs = false;
      closeDialog(root);
      target.hidden = true; target.classList.remove('ig-pop', 'ig-hold');
      title.textContent = detail.textContent = ''; title.hidden = detail.hidden = true; setAlert('');
      ig._clearTimeout(idleT); idleT = 0; root.classList.remove('ig-idle');
      ig._uiCall('_debugUI', 'calibrating', false);
    },
    showMessage(text, det) {
      title.textContent = text || ''; title.hidden = !text;
      detail.textContent = det || ''; detail.hidden = !det;
    },
    destroy() {
      shown = false;
      ac.abort(); ig._clearTimeout(idleT);
      closeDialog(root); root.remove();
    },
  };
}


// =====================================================================================================================
// ===== UI: settings =====
// Native <dialog> + showModal() over the host app: top layer (no z-index war), host inert, ::backdrop, focus moved to
// Start / Resume and restored on close, ESC closes (cancel event -> ig.closeSettings()). THE ENGINE KEEPS RUNNING while
// it is open (live preview). Every control applies at once through ig.setOptions() (live where possible, persisted);
// Start / Calibrate / Recenter close the dialog themselves (engine). The GLOBAL ESC that opens this dialog is the
// engine's key handler (page AbortController: removed by destroy(); ignored while this dialog is open, while a
// calibration handles ESC, and while the host is typing in a field).
//   Basic     camera (or the mouse source) + small MIRRORED live preview (eye corners, irises, face box; face /
//             distance / light hints), pointer, data stream, calibration layout, smoothing, head influence, data rate
//             (Hz), reach gain X/Y + lock, debug drawer, fullscreen on Start (the click is the user gesture fullscreen
//             needs).
//   Advanced  inset, dot duration, head compensation on / off, camera mirrored (+ Detect from a head turn),
//             resolution, delegate, MediaPipe smoothing, legacy events, quality after calibration, auto start, and
//             Restore defaults / Forget calibration / Erase all InkGaze data (two-step confirmation).
// =====================================================================================================================
mixin({
  /** settings dialog (engine hook). Never called in Node / headless mode (_settingsAvailable() is false there). */
  _createSettingsUI() {
    if (!HAS_DOM || this._headlessMode) return null;
    return createSettingsUI(this);
  },
});

const MOUSE_VALUE = '#mouse';   // camera <select> value of the mouse source (never a MediaDeviceInfo.deviceId)
const CHOICES = {
  pointer: [['eyes', 'Eyes (gaze)'], ['head', 'Head (head-pose pointer)']],
  stream: [['eyes', 'Eyes only'], ['eyes+face', 'Eyes + face box'], ['full', 'Full: eyes + face + head pose + distance']],
  layout: [['5', '5 dots: centre + corners (default)'], ['9', '9 dots: 3 × 3 grid (most accurate)'], ['tri', '3 dots (quick)'], ['diag', '2 dots (quickest)']],
  smoothing: [['0', 'Off: raw positions'], ['250', '250 ms (responsive)'], ['350', '350 ms (default)'], ['500', '500 ms (steady)'], ['750', '750 ms (calm)'], ['1000', '1000 ms (very calm)']],
  dotSeconds: [['', 'Automatic'], ['1', '1 s'], ['1.5', '1.5 s'], ['2', '2 s'], ['3', '3 s'], ['4', '4 s']],
  longBlinkMs: [['250', '250 ms'], ['300', '300 ms'], ['400', '400 ms (default)'], ['500', '500 ms'], ['700', '700 ms'], ['1000', '1 s']],
  head: [['auto', 'Auto (eyes + head pose)'], ['off', 'Off (eyes only)']],
  mirror: [['auto', 'Auto (from the calibration)'], ['yes', 'Yes: the stream is mirrored'], ['no', 'No: normal webcam']],
  resolution: [['720p', '720p (1280 × 720)'], ['480p', '480p (640 × 480, lighter)']],
  delegate: [['GPU', 'GPU (CPU fallback)'], ['CPU', 'CPU']],
};
const LAYOUT_NAMES = { 5: '5-dot', 9: '9-dot', tri: '3-dot', diag: '2-dot', 'C+tri': '4-dot', 4: '4-dot' };
// status codes kept as a note in the dialog (warnings); live conditions (face lost, hidden page) are not notes
const NOTE_WARN = /^(axis-|weak-axis|low-confidence|calibration-failed|calibration-invalidated|calibration-cancelled|camera-substituted|camera-muted|camera-ended|viewport-changed|recording-limit|inference-failed)/;
const NOTE_SKIP = /^(face-lost|hidden|camera-permission)$/;
const DONE_TEXT = { 'calibrate-done': 'Calibration done.', 'recenter-done': 'Recentred.', 'quick-done': 'Quick check of the saved calibration passed.' };
const setText = (e, s) => { if (e.textContent !== s) e.textContent = s; };

// Camera preview painter (settings dialog + debug drawer): the engine's hidden <video> drawn into ONE canvas, MIRRORED
// like a selfie view (unless the stream itself is mirrored: options.cameraMirrored / calibration fit), with the eye
// corners, iris circles and the face box. Image and landmarks share one transform, so they always line up.
// paint() -> {video, face, cm (APPROXIMATE, iris 11.7 mm), offCentre, luma (face brightness 0..255, ~1 Hz)}
function createPainter(ig, cv) {
  let ctx = null;
  try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  let ar = '', lumaT = 0, luma = null;
  return {
    paint() {
      const v = ig._video, vw = v ? v.videoWidth : 0, vh = v ? v.videoHeight : 0;
      const ok = !!(ctx && ig._opts.source === 'camera' && v && v.srcObject && vw && vh && v.readyState >= 2);
      const res = { video: ok, face: false, cm: null, offCentre: false, luma: null };
      if (vw && vh) { const a = vw + ' / ' + vh; if (a !== ar) { ar = a; cv.style.aspectRatio = a; } }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round((cv.clientWidth || 160) * dpr)), H = Math.max(1, Math.round((cv.clientHeight || 90) * dpr));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      if (!ctx) return res;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!ok) return res;
      const flip = !ig._mirrored();
      ctx.save();
      if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      try { ctx.drawImage(v, 0, 0, W, H); } catch (e) { ctx.restore(); res.video = false; return res; }
      const lm = ig._uiLm && now() - (ig._uiLmT || 0) < 500 ? ig._uiLm : null;
      if (lm) {
        res.face = true;
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const i of FACE_BOX_LM) { const q = lm[i]; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
        res.offCentre = Math.abs((x0 + x1) / 2 - 0.5) > 0.2 || Math.abs((y0 + y1) / 2 - 0.5) > 0.25;
        // face brightness (Rec. 601 luma of the inner face box), at most once a second (a GPU read-back), before
        // the overlay is drawn. Canvas pixels ignore the transform: mirror the box by hand.
        const t = now();
        if (t - lumaT > 1000) {
          lumaT = t;
          const bw = (x1 - x0) * W, bh = (y1 - y0) * H, bx = (flip ? (1 - x1) : x0) * W;
          const sx = Math.max(0, Math.round(bx + 0.2 * bw)), sy = Math.max(0, Math.round(y0 * H + 0.2 * bh));
          const sw = Math.min(W - sx, Math.round(0.6 * bw)), sh = Math.min(H - sy, Math.round(0.6 * bh));
          if (sw > 2 && sh > 2) {
            try {
              const px = ctx.getImageData(sx, sy, sw, sh).data;
              let s = 0, n = 0;
              for (let i = 0; i < px.length; i += 16) { s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; n++; }
              luma = n ? s / n : null;
            } catch (e) { luma = null; }
          }
        }
        res.luma = luma;
        try { res.cm = ig._distance({ iod: 0 }, lm).cm; } catch (e) { res.cm = null; }
        const P = (i) => [lm[i].x * W, lm[i].y * H];
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd400';                                   // eye corners
        for (const i of [33, 133, 362, 263]) { const [x, y] = P(i); ctx.beginPath(); ctx.arc(x, y, 2.2 * dpr, 0, 2 * Math.PI); ctx.fill(); }
        ctx.strokeStyle = '#00e5ff'; ctx.fillStyle = '#00e5ff';        // irises: centre + mean rim radius
        for (const ring of [[468, 469, 470, 471, 472], [473, 474, 475, 476, 477]]) {
          const [cx, cy] = P(ring[0]);
          let r = 0;
          for (let k = 1; k < 5; k++) { const [x, y] = P(ring[k]); r += Math.hypot(x - cx, y - cy) / 4; }
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5 * dpr, r), 0, 2 * Math.PI); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, cy, 1.2 * dpr, 0, 2 * Math.PI); ctx.fill();
        }
      }
      ctx.restore();
      return res;
    },
  };
}

function createSettingsUI(ig) {
  const P = uiId(ig) + '-s-', id = (k) => P + k, set = (p) => ig.setOptions(p);
  const help = (k, text) => dom('small', { class: 'ig-help', id: id(k + '-help'), text });
  const select = (k, choices) => {
    const s = dom('select', { id: id(k), class: 'ig-input' });
    for (const [v, t] of choices) s.append(new Option(t, v));
    return s;
  };
  // label + control (+ an extra control on the same row) + help text, linked with for / aria-describedby
  const field = (k, label, control, helpText, extra) => {
    if (helpText) control.setAttribute('aria-describedby', id(k + '-help'));
    return dom('div', { class: 'ig-field' }, dom('label', { for: control.id, text: label }),
      extra ? dom('div', { class: 'ig-row' }, control, extra) : control, helpText ? help(k, helpText) : null);
  };
  const check = (k, label, helpText) => {
    const c = dom('input', { type: 'checkbox', id: id(k), 'aria-describedby': helpText ? id(k + '-help') : null });
    return { c, wrap: dom('div', { class: 'ig-field ig-field-check' }, dom('label', { class: 'ig-check', for: c.id }, c, dom('span', { text: label })), helpText ? help(k, helpText) : null) };
  };
  const confirmButton = (label, armedLabel, action) => {
    let t = 0;
    const b = dom('button', { type: 'button', class: 'ig-btn ig-small', text: label });
    const disarm = () => { ig._clearTimeout(t); t = 0; b.textContent = label; b.classList.remove('ig-armed'); };
    b.addEventListener('click', () => {
      if (!t) { b.textContent = armedLabel; b.classList.add('ig-armed'); t = ig._timeout(disarm, 4000); return; }
      disarm(); action();
    });
    return b;
  };

  // ------------------------------------------------------------------ header, status
  const titleEl = dom('h2', { id: id('title'), class: 'ig-s-title', text: 'InkGaze settings' });
  const xBtn = dom('button', { type: 'button', class: 'ig-icon-btn', 'aria-label': 'Close settings', title: 'Close (Esc)', text: '×' });
  const stLine = dom('p', { class: 'ig-status', id: id('status'), role: 'status' });
  const noteLine = dom('p', { class: 'ig-note', hidden: true });
  const qualLine = dom('p', { class: 'ig-qual', hidden: true });
  const warnLine = dom('p', { class: 'ig-note', 'data-kind': 'warn', hidden: true });
  const intro = dom('p', { class: 'ig-help ig-intro', text: 'Start opens the camera and shows a few dots: keep your head still and look at each dot until its circle closes. Afterwards InkGaze runs silently; Esc brings this dialog back.' });

  // ------------------------------------------------------------------ preview
  const cv = dom('canvas', { class: 'ig-preview', role: 'img', 'aria-label': 'Mirrored camera preview with the detected eye corners, irises and face box' });
  const pvMsg = dom('div', { class: 'ig-preview-msg' });
  const pvInfo = dom('p', { class: 'ig-preview-info', 'aria-live': 'polite' });
  const painter = createPainter(ig, cv);

  // ------------------------------------------------------------------ basic controls
  const C = {};
  const cam = dom('select', { id: id('camera'), class: 'ig-input' });
  const camBtn = dom('button', { type: 'button', class: 'ig-btn ig-small', text: 'Find', title: 'List the cameras again (may ask for camera permission)', 'aria-label': 'Find cameras' });
  for (const k of ['pointer', 'stream', 'layout', 'smoothing']) C[k] = select(k, CHOICES[k]);
  const rx = dom('input', { type: 'range', id: id('rx'), class: 'ig-range', min: '0.5', max: '3', step: '0.05', 'aria-describedby': id('gain-help') });
  const ry = dom('input', { type: 'range', id: id('ry'), class: 'ig-range', min: '0.5', max: '3', step: '0.05', 'aria-describedby': id('gain-help') });
  const ox = dom('output', { class: 'ig-out', for: rx.id }), oy = dom('output', { class: 'ig-out', for: ry.id });
  const lock = check('lock', 'Lock X = Y');
  const gainWarn = dom('small', { class: 'ig-help ig-warn-text', id: id('gain-help'), hidden: true });
  // [v2.1] data rate (Hz) and head influence (%): applied when the slider is released
  const rate = dom('input', { type: 'range', id: id('rate'), class: 'ig-range', min: String(RATE_MIN), max: String(RATE_MAX), step: '1' });
  const rateOut = dom('output', { class: 'ig-out', for: rate.id });
  const rateNow = dom('small', { class: 'ig-help ig-rate-now', 'aria-live': 'off' });
  const hw = dom('input', { type: 'range', id: id('hw'), class: 'ig-range', min: '0', max: '200', step: '5' });
  const hwOut = dom('output', { class: 'ig-out', for: hw.id });
  const dbg = check('debug', 'Debug drawer (live values, preview, recording)');
  const fs = check('fs', 'Fullscreen on Start (recommended: the calibration is tied to the window size)');
  const reach = dom('fieldset', { class: 'ig-field ig-reach' }, dom('legend', { text: 'Reach gain' }),
    dom('div', { class: 'ig-row' }, dom('label', { for: rx.id, class: 'ig-axis', text: 'X' }), rx, ox),
    dom('div', { class: 'ig-row' }, dom('label', { for: ry.id, class: 'ig-axis', text: 'Y' }), ry, oy),
    lock.wrap, gainWarn);

  // ------------------------------------------------------------------ advanced controls
  const inset = dom('input', { type: 'range', id: id('inset'), class: 'ig-range', min: '0.05', max: '0.25', step: '0.01' });
  const insetOut = dom('output', { class: 'ig-out', for: inset.id });
  for (const k of ['dotSeconds', 'head', 'mirror', 'resolution', 'delegate', 'longBlinkMs']) C[k] = select(k, CHOICES[k]);
  const esc = dom('input', { type: 'range', id: id('esc'), class: 'ig-range', min: '0.1', max: '0.6', step: '0.05' });
  const escOut = dom('output', { class: 'ig-out', for: esc.id });
  const detectBtn = dom('button', { type: 'button', class: 'ig-btn ig-small', text: 'Detect', 'aria-describedby': id('mirror-help') });
  const mp = check('mp', 'MediaPipe landmark smoothing', 'On (default): MediaPipe filters the landmarks over time. Off (EXPERIMENTAL): raw per-frame landmarks (a numFaces 2 setting bypasses its built-in filter), more jitter and less lag; InkGaze\'s own smoothing still applies. Reloads the face model.');
  const legacy = check('legacy', 'Also send v1 events (trk:data / trk:status)', 'For v1 host apps; this session only (a host option).');
  const sq = check('sq', 'Show a short quality summary after calibration');
  const auto = check('auto', 'Next time, skip this dialog when a saved calibration matches (quick check only)');
  const actNote = dom('p', { class: 'ig-note', 'aria-live': 'polite', hidden: true });
  const actMsg = (text) => { setText(actNote, text); actNote.hidden = !text; };
  const restoreBtn = confirmButton('Restore defaults', 'Click again to restore', () => {
    ig.setOptions(cloneOptions(pick(DEFAULT_OPTIONS, PERSIST_KEYS)));
    actMsg('Settings restored to the defaults.');
  });
  const forgetBtn = confirmButton('Forget calibration', 'Click again to forget', () => {
    ig.forgetCalibration();
    actMsg('Saved calibrations deleted. The current calibration stays active until you calibrate again or reload the page.');
  });
  const eraseBtn = confirmButton('Erase all InkGaze data', 'Click again to erase', () => {
    for (const k of store.keys(ig._opts.storageKey + ':')) store.del(k);
    store.del('inkgaze_config');   // v1's settings key
    actMsg('All InkGaze data stored in this browser was erased (settings and calibrations). This session keeps running.');
  });
  const mirrorField = dom('div', { class: 'ig-field' }, dom('label', { for: C.mirror.id, text: 'Camera image mirrored' }),
    dom('div', { class: 'ig-row' }, C.mirror, detectBtn),
    help('mirror', 'Affects the face box and head-pose outputs only (gaze learns the sign). Detect: turn your head to your right for 2 s.'));
  C.mirror.setAttribute('aria-describedby', id('mirror-help'));
  const rateField = field('rate', 'Data rate (Hz)', rate, 'How many data packets per second InkGaze sends to your app (1–250). '
    + 'The camera measures about 30 times a second: above that rate, positions are interpolated between camera frames (a smoother cursor, '
    + 'about one frame of extra delay, but no new eye information); below it, packets are thinned out, smoothing still uses every '
    + 'frame and a pen lift (saccade) is never lost. Applies at once.', rateOut);
  rateField.classList.add('ig-wide');
  rateField.append(rateNow);
  const hwField = field('hw', 'Head influence', hw, 'How much head movement moves the cursor, on top of the eyes. 100 % = tuned default; '
    + 'lower it if turning or nodding moves the cursor too much; 0 % = eyes only. Nods are weighted by your own vertical eye range '
    + '(measured when you calibrate). Applies at once, no new calibration.', hwOut);
  const adv = dom('details', { class: 'ig-adv' }, dom('summary', { text: 'Advanced' }),
    dom('div', { class: 'ig-grid' },
      field('inset', 'Dot inset from the edges', inset, 'Share of the screen, 5–25 %. Larger means less extreme eye positions (try 15 % for a limited range).', insetOut),
      field('dotSeconds', 'Dot duration', C.dotSeconds, 'Automatic: about 0.8 s of steady gaze per dot (5 and 9 dots), longer for 2–3 dots. Longer dots reduce noise; more dots fit the screen better.'),
      field('head', 'Head compensation', C.head, 'Auto: head movement is taken into account using the head pose (its strength is Head influence). Off: eyes only. Changing it needs a new calibration.'),
      mirrorField,
      field('longBlinkMs', 'Long blink from', C.longBlinkMs, "Blinks are sent to your app as 'blink' events with their duration; from this length on they are marked long (deliberate)."),
      field('esc', 'Escape saccade', esc, "A gaze jump of at least this share of the screen diagonal, made in one camera frame, is sent as an escape saccade (drawing apps: pen up / stop drawing).", escOut),
      field('resolution', 'Camera resolution', C.resolution),
      field('delegate', 'Face model runs on', C.delegate)),
    mp.wrap, legacy.wrap, sq.wrap, auto.wrap,
    dom('div', { class: 'ig-row ig-wrap' }, restoreBtn, forgetBtn, eraseBtn), actNote);

  // ------------------------------------------------------------------ actions + dialog
  const startBtn = dom('button', { type: 'button', class: 'ig-btn ig-primary', autofocus: true, text: 'Start' });
  const calBtn = dom('button', { type: 'button', class: 'ig-btn', text: 'Calibrate' });
  const recBtn = dom('button', { type: 'button', class: 'ig-btn', text: 'Recenter' });
  const closeBtn = dom('button', { type: 'button', class: 'ig-btn ig-ghost', text: 'Close' });
  const foot = dom('p', { class: 'ig-s-foot' });
  const basic = dom('section', { class: 'ig-s-basic', 'aria-label': 'Basic settings' },
    dom('div', { class: 'ig-preview-col' }, dom('div', { class: 'ig-preview-wrap' }, cv, pvMsg), pvInfo),
    dom('div', { class: 'ig-grid' },
      field('camera', 'Camera', cam, 'Or the mouse pointer, which simulates gaze (no camera).', camBtn),
      field('pointer', 'Pointer', C.pointer, 'Eyes: gaze pointer. Head: head-pose pointer (v1 face-only mode), calibrated with the same dots.'),
      field('stream', 'Data stream', C.stream, 'Gaze x, y and the raw eye features are always sent.'),
      field('layout', 'Calibration', C.layout, '5 dots by default (centre + corners). 9 dots fit the screen best; 2–3 dots are quicker but least accurate in the corners.'),
      field('smoothing', 'Smoothing', C.smoothing, 'Longer = steadier cursor, slower to follow. Fixation-aware: a saccade restarts it and is always flagged (pen lift).'),
      hwField, rateField,
      reach),
    dbg.wrap, fs.wrap);
  const dlg = dom('dialog', { class: 'ig-ui ig-settings', 'aria-labelledby': titleEl.id, 'aria-describedby': stLine.id },
    dom('header', { class: 'ig-s-head' }, titleEl, xBtn),
    dom('div', { class: 'ig-s-body' }, stLine, noteLine, qualLine, warnLine, intro, basic, adv),
    dom('footer', { class: 'ig-s-actions' }, startBtn, calBtn, recBtn, closeBtn, foot));

  // ------------------------------------------------------------------ state
  let isOpen = false, raf = 0, tDraw = 0, tInfo = 0, tRender = 0, lastFocus = null, camSig = '', devs = [];
  let lastError = null, lastLoading = '', note = null, rgPending = null, rgT = 0, det = null;

  function engineLine() {
    const o = ig._opts, mouse = o.source === 'mouse';
    if (lastError && !ig._running && !ig._enginePromise) return [lastError.message || 'Error.', 'error'];
    if (ig._enginePromise) return [lastLoading || 'Loading…', 'busy'];
    if (!ig._running) return [mouse ? 'Stopped. Start resumes the mouse source.' : 'Camera off. Start opens the camera and calibrates.', 'idle'];
    if (mouse) return ['Mouse source: the pointer simulates gaze (no camera, no calibration).', 'ok'];
    if (!ig._isCalibrated()) return ['Camera on. Start calibrates (' + (LAYOUT_NAMES[o.layout] || o.layout) + ').', 'idle'];
    if (ig._needsCheck) return ['Saved calibration loaded. Start runs a quick check (recentre + 1 dot).', 'info'];
    if (ig._lost) return ['Tracking, but your face is not visible to the camera.', 'warn'];
    return ['Tracking. It keeps running while this dialog is open.', 'ok'];
  }
  function qualityText(q) {
    if (!q.calibrated || q.synthetic) return '';
    const parts = [(q.points || 0) + ' dots' + (q.model ? ', ' + q.model + ' fit' : '')];
    if (q.learnedRows) parts.push(q.learnedRows + ' learned');
    if (q.confidence) parts.push(q.confidence + ' confidence');
    if (finite(q.rmsePx)) parts.push('error at the dots ≈ ' + Math.round(q.rmsePx) + ' px');
    if (q.validation && finite(q.validation.errPx)) parts.push('check error ' + Math.round(q.validation.errPx) + ' px');
    return 'Calibration: ' + parts.join(' · ');
  }
  function qualityWarnings(q) {
    if (!q.calibrated || q.synthetic) return '';
    const w = [];
    if (q.axisX === false) w.push('No usable horizontal eye movement: X is pinned (vertical-only use).');
    if (q.axisY === false) w.push('No usable vertical eye movement: Y is pinned (horizontal-only use).');
    const weak = [q.axisX && q.weak && q.weak[0] ? 'horizontal' : null, q.axisY && q.weak && q.weak[1] ? 'vertical' : null].filter(Boolean);
    if (weak.length) w.push('Weak ' + weak.join(' and ') + ' eye signal: try longer dots or a larger inset.');
    if (q.viewportChanged) w.push('The window size changed since calibration: Recenter (or calibrate again).');
    else if (q.recenterSuggested && !q.needsCheck) w.push('Your head moved since calibration: Recenter is suggested.');
    return w.join(' ');
  }
  function render() {
    const [text, kind] = engineLine();
    setText(stLine, text); stLine.setAttribute('data-kind', kind);
    if (note) { setText(noteLine, note.text); noteLine.setAttribute('data-kind', note.kind); }
    noteLine.hidden = !note;
    const q = ig.quality(), qt = qualityText(q), qw = qualityWarnings(q);
    setText(qualLine, qt); qualLine.hidden = !qt;
    setText(warnLine, qw); warnLine.hidden = !qw;
    const o = ig._opts, mouse = o.source === 'mouse', calibrated = ig._isCalibrated();
    setText(startBtn, ig._running && (mouse || (calibrated && !ig._needsCheck)) ? 'Resume' : 'Start');
    calBtn.disabled = mouse; recBtn.disabled = mouse || !calibrated;
    calBtn.title = mouse ? 'Not needed with the mouse source' : ''; recBtn.title = mouse ? 'Not needed with the mouse source' : calibrated ? '' : 'Calibrate first';
    dbg.c.checked = !!ig._debugOpen;
    const r = q.runtime || {};
    setText(rateNow, ig._running && r.fps ? 'Now: ' + (mouse ? 'pointer ' : 'camera ') + fmt(r.fps, 1) + ' fps · sending ' + fmt(r.sentHz, 1) + ' Hz'
      + (mouse ? '' : ' · inference ' + fmt(r.inferMs, 1) + ' ms' + (r.delegate ? ' (' + r.delegate + ')' : '') + (r.video ? ', ' + r.video.w + '×' + r.video.h : '')) : '');
    const noHead = o.head === 'off' || o.pointer === 'head' || mouse;
    hw.disabled = noHead;
    hw.title = noHead ? (mouse ? 'Not used with the mouse source' : o.pointer === 'head' ? 'The head IS the pointer (pointer: head)' : 'Head compensation is off (Advanced)') : '';
    setText(foot, 'InkGaze ' + VERSION + ' · MediaPipe ' + o.mpVersion + ' (pinned) · SiX research project, six.fba.up.pt · Esc closes this dialog and reopens it');
  }
  function previewHints(r) {
    if (!r.face) return 'No face found: sit in front of the camera with your face evenly lit.';
    const out = ['Face found'];
    if (r.cm) out.push('about ' + Math.round(r.cm) + ' cm' + (r.cm < 40 ? ' (a bit close)' : r.cm > 85 ? ' (a bit far)' : ''));
    if (r.offCentre) out.push('centre your face in the camera');
    if (r.luma != null) out.push(r.luma < 60 ? 'too dark: add light in front of you' : r.luma > 225 ? 'very bright' : 'light OK');
    return out.join(' · ');
  }
  function drawPreview() {
    const r = painter.paint(), mouse = ig._opts.source === 'mouse';
    const m = mouse ? 'Mouse source: no camera.' : r.video ? '' : ig._enginePromise ? (lastLoading || 'Starting the camera…')
      : lastError && !ig._running ? 'Camera unavailable.' : 'Camera off.';
    setText(pvMsg, m); pvMsg.hidden = !m;
    const t = now();
    if (t - tInfo >= 500) { tInfo = t; setText(pvInfo, r.video ? previewHints(r) : ''); }
  }
  function loop(t) {
    raf = 0;
    if (!isOpen) return;
    raf = requestAnimationFrame(loop);
    try {
      if (t - tDraw >= 45) { tDraw = t; drawPreview(); }       // ~20 fps preview
      if (t - tRender >= 1000) { tRender = t; render(); }      // live status / quality / fps
    } catch (e) { reportError(e); }
  }
  function rebuildCam() {
    const o = ig._opts, want = o.source === 'mouse' ? MOUSE_VALUE : (o.cameraId || '');
    const active = !o.cameraId && ig._deviceId ? devs.find((d) => d.deviceId === ig._deviceId) : null;
    const opts = [['', 'Default camera' + (active && active.label ? ' (' + active.label + ')' : '')]];
    for (const d of devs) if (d.deviceId) opts.push([d.deviceId, d.label || 'Camera']);
    if (want && want !== MOUSE_VALUE && !devs.some((d) => d.deviceId === want)) opts.push([want, 'Saved camera (not found)']);
    opts.push([MOUSE_VALUE, 'Mouse pointer (no camera: simulates gaze)']);
    const s = JSON.stringify(opts);
    if (s !== camSig) { camSig = s; cam.textContent = ''; for (const [v, t] of opts) cam.append(new Option(t, v)); }
    cam.value = want;
  }
  function setSelect(s, v, label) {
    if (!Array.prototype.some.call(s.options, (x) => x.value === v)) s.append(new Option(label || v, v));
    s.value = v;
  }
  function showGain(g) {
    ox.value = Number(g[0]).toFixed(2); oy.value = Number(g[1]).toFixed(2);
    const hi = Math.max(g[0], g[1]), lo = Math.min(g[0], g[1]);
    const t = hi > 1 ? 'Gain ×' + hi.toFixed(2) + ': the cursor travels further than your eyes. Jitter grows ×' + hi.toFixed(2) + ' and the cursor no longer sits where you look (gaze–cursor correspondence).' + (hi > 1.6 ? ' Above about ×1.6 it is rarely usable.' : '')
      : lo < 1 ? 'Gain below 1: the cursor travels less than your eyes and may not reach the screen edges.' : '';
    setText(gainWarn, t); gainWarn.hidden = !t;
  }
  // reach gain is live: applied while dragging at most 5x a second (each apply re-imports the model state), and on release
  function pushGain(final) {
    const g = [+rx.value, +ry.value];
    showGain(g);
    rgPending = g;
    if (final) { ig._clearTimeout(rgT); rgT = 0; rgPending = null; set({ reachGain: g }); return; }
    if (!rgT) rgT = ig._timeout(() => { rgT = 0; const p = rgPending; rgPending = null; if (p) set({ reachGain: p }); }, 200);
  }
  function stopDetect() { if (det) { ig._clearTimeout(det.timer); det = null; } detectBtn.disabled = false; }
  // camera mirror from a head turn: nose tip relative to the outer eye corners, in IMAGE x. Turning to the user's
  // right moves the nose image-LEFT in an un-mirrored frame (and image-right in a mirrored one).
  function detectMirror() {
    const msg = document.getElementById(id('mirror-help'));
    if (det) return;
    if (ig._opts.source !== 'camera' || !ig._running) { msg.textContent = 'Start the camera first (camera source), then Detect.'; return; }
    const t0 = now(), base = [], turn = [];
    let lastT = -1, turned = false;
    const sample = () => {
      const lm = ig._uiLm, t = ig._uiLmT || 0;
      if (!lm || t === lastT || now() - t > 300) return null;
      lastT = t;
      const span = Math.abs(lm[263].x - lm[33].x);
      return span > 1e-4 ? (lm[1].x - (lm[33].x + lm[263].x) / 2) / span : null;
    };
    det = { timer: 0 };
    detectBtn.disabled = true;
    msg.textContent = 'Look straight at the screen…';
    const step = () => {
      if (!det) return;
      const el = now() - t0, s = sample();
      if (el < 700) { if (s != null) base.push(s); } else {
        if (!turned) { turned = true; msg.textContent = 'Now turn your head to your RIGHT and hold it there…'; }
        if (el > 1500 && s != null) turn.push(s);
      }
      if (el < 2700) { det.timer = ig._timeout(step, 30); return; }
      stopDetect();
      if (base.length < 4 || turn.length < 4) { msg.textContent = 'No face was seen: check the preview and try again.'; return; }
      const d = median(turn) - median(base);
      if (Math.abs(d) < 0.05) { msg.textContent = 'No clear head turn was seen: try again and turn a little further.'; return; }
      set({ cameraMirrored: d > 0 });
      msg.textContent = d > 0 ? 'Detected: the camera image IS mirrored (set to Yes).' : 'Detected: a normal, un-mirrored camera image (set to No).';
    };
    step();
  }
  const fsMaybe = () => { if (ig._opts.fullscreen === 'ask') requestFullscreen(); };

  // ------------------------------------------------------------------ wiring (element listeners die with the dialog)
  xBtn.addEventListener('click', () => ig.closeSettings());
  closeBtn.addEventListener('click', () => ig.closeSettings());
  startBtn.addEventListener('click', () => { fsMaybe(); ig._dialogStart(); });
  calBtn.addEventListener('click', () => { fsMaybe(); ig.calibrate({ layout: C.layout.value }); });
  recBtn.addEventListener('click', () => { fsMaybe(); ig.recenter(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); ig.closeSettings(); });
  // closed by the browser itself (e.g. a repeated ESC without user activation is not cancelable): keep the engine in sync
  dlg.addEventListener('close', () => { if (isOpen && !dlg.open) ig.closeSettings(); });
  cam.addEventListener('change', () => { const v = cam.value; if (v === MOUSE_VALUE) set({ source: 'mouse' }); else set({ source: 'camera', cameraId: v || null }); });
  camBtn.addEventListener('click', () => { camBtn.disabled = true; Promise.resolve(ig._listCameras()).catch(() => {}).then(() => { camBtn.disabled = false; }); });
  for (const k of ['pointer', 'stream', 'layout', 'head', 'resolution', 'delegate']) C[k].addEventListener('change', () => set({ [k]: C[k].value }));
  C.smoothing.addEventListener('change', () => set({ smoothing: +C.smoothing.value }));
  C.dotSeconds.addEventListener('change', () => set({ dotSeconds: C.dotSeconds.value === '' ? null : +C.dotSeconds.value }));
  C.longBlinkMs.addEventListener('change', () => set({ longBlinkMs: +C.longBlinkMs.value }));
  esc.addEventListener('input', () => { escOut.value = Math.round(+esc.value * 100) + ' %'; });
  esc.addEventListener('change', () => set({ escapeAmplitude: +esc.value }));
  C.mirror.addEventListener('change', () => { const v = C.mirror.value; set({ cameraMirrored: v === 'yes' ? true : v === 'no' ? false : null }); });
  detectBtn.addEventListener('click', detectMirror);
  rx.addEventListener('input', () => { if (lock.c.checked) ry.value = rx.value; pushGain(false); });
  ry.addEventListener('input', () => { if (lock.c.checked) rx.value = ry.value; pushGain(false); });
  rx.addEventListener('change', () => pushGain(true));
  ry.addEventListener('change', () => pushGain(true));
  lock.c.addEventListener('change', () => { set({ reachLock: lock.c.checked }); if (lock.c.checked && rx.value !== ry.value) { ry.value = rx.value; pushGain(true); } });
  inset.addEventListener('input', () => { insetOut.value = Math.round(+inset.value * 100) + ' %'; });
  inset.addEventListener('change', () => set({ inset: +inset.value }));
  rate.addEventListener('input', () => { rateOut.value = rate.value + ' Hz'; });
  rate.addEventListener('change', () => set({ rate: +rate.value }));
  hw.addEventListener('input', () => { hwOut.value = hw.value + ' %'; });
  hw.addEventListener('change', () => set({ headWeight: +hw.value / 100 }));
  mp.c.addEventListener('change', () => set({ mpSmoothing: mp.c.checked }));
  legacy.c.addEventListener('change', () => set({ legacyEvents: legacy.c.checked }));
  sq.c.addEventListener('change', () => set({ showQuality: sq.c.checked }));
  auto.c.addEventListener('change', () => set({ autoStart: auto.c.checked }));
  dbg.c.addEventListener('change', () => ig.toggleDebug(dbg.c.checked));
  fs.c.addEventListener('change', () => set({ fullscreen: fs.c.checked ? 'ask' : 'never' }));

  const api = {
    open() {
      if (isOpen) return;
      isOpen = true;
      if (!dlg.isConnected) (document.body || document.documentElement).appendChild(dlg);
      dlg.style.zIndex = String(ig._opts.zIndex + 4);   // used only by the no-<dialog> fallback (top layer otherwise)
      const a = document.activeElement;
      lastFocus = a && a !== document.body ? a : null;
      actMsg('');
      showDialog(dlg, true);
      try { startBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      render();
      // camera list WITHOUT a permission prompt: labels appear once the camera runs (init() preloads it; the engine
      // refreshes the list then). The Find button opens a short probe stream on request.
      ig._refreshDevices();
      if (!raf) raf = requestAnimationFrame(loop);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      stopDetect();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (rgPending) pushGain(true);
      closeDialog(dlg);
      const f = lastFocus; lastFocus = null;   // the UA restores focus after showModal(); explicit for the fallback
      const a = document.activeElement;
      if (f && f.isConnected && typeof f.focus === 'function' && (!a || a === document.body || dlg.contains(a))) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    },
    isOpen() { return isOpen; },
    status(d) {
      if (!d) return;
      if (d.state === 'error') lastError = d;
      else if (d.state === 'loading' || d.state === 'warming' || ig._running) lastError = null;
      if (d.state === 'loading' || d.state === 'warming') lastLoading = d.message || lastLoading;
      if (d.code && d.message && d.state !== 'error' && !NOTE_SKIP.test(d.code)) note = { text: d.message, kind: NOTE_WARN.test(d.code) ? 'warn' : 'info' };
      else if (d.code && DONE_TEXT[d.code]) note = { text: DONE_TEXT[d.code], kind: 'ok' };
      if (isOpen) render();
    },
    sync(o) {
      if (!o) return;
      rebuildCam();
      for (const k of ['pointer', 'stream', 'layout', 'head', 'resolution', 'delegate']) setSelect(C[k], String(o[k]));
      setSelect(C.smoothing, String(o.smoothing), o.smoothing + ' ms');
      setSelect(C.dotSeconds, o.dotSeconds == null ? '' : String(o.dotSeconds), o.dotSeconds + ' s');
      setSelect(C.longBlinkMs, String(o.longBlinkMs), o.longBlinkMs + ' ms');
      if (document.activeElement !== esc) { esc.value = String(o.escapeAmplitude); escOut.value = Math.round(o.escapeAmplitude * 100) + ' %'; }
      setSelect(C.mirror, o.cameraMirrored === true ? 'yes' : o.cameraMirrored === false ? 'no' : 'auto');
      if (rgPending == null) { rx.value = String(o.reachGain[0]); ry.value = String(o.reachGain[1]); showGain(o.reachGain); }
      lock.c.checked = !!o.reachLock; dbg.c.checked = !!ig._debugOpen; fs.c.checked = o.fullscreen !== 'never';
      inset.value = String(o.inset); insetOut.value = Math.round(o.inset * 100) + ' %';
      if (document.activeElement !== rate) { rate.value = String(o.rate); rateOut.value = o.rate + ' Hz'; }
      if (document.activeElement !== hw) { hw.value = String(Math.round(o.headWeight * 100)); hwOut.value = Math.round(o.headWeight * 100) + ' %'; }
      mp.c.checked = !!o.mpSmoothing; legacy.c.checked = !!o.legacyEvents; sq.c.checked = !!o.showQuality; auto.c.checked = !!o.autoStart;
      if (isOpen) render();
    },
    devices(list) { devs = Array.isArray(list) ? list : []; rebuildCam(); },
    destroy() {
      isOpen = false;
      stopDetect();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      closeDialog(dlg); dlg.remove();
    },
  };
  // created late (e.g. the first ESC after a host-started session): start from the engine's last status (an error,
  // a cancelled / failed calibration note) instead of a blank status
  api.status(ig._statusDetail);
  return api;
}


// =====================================================================================================================
// ===== UI: debug =====
// Debug drawer (right side; full width on phones) + its toggle button (bottom-right, ALWAYS above the drawer, so the
// drawer never covers its own control; the drawer also has a close button) + two on-screen gaze markers (ring = raw,
// dot = smoothed: fixed elements moved with transform, at the frame rate). FIXED DOM: every node is built once; the
// text refresh runs at ~10 Hz from ig.latest / ig.quality() (frame() only keeps the markers moving). The drawer and
// the button hide during a calibration (the calibration HUD replaces them, so no dot is ever covered). Opened by
// options.debug, ig.toggleDebug() or the settings dialog; the button stays available once created.
// Shows: status; fps / inference ms / dropped; raw eye features; gaze raw vs smoothed + state; head pose; face box;
// distance; quality (noise, axes + snr, weak, mirrored, head mode, offset, rmse / loo, validation, moved,
// recenterSuggested, counters); calibration rows; small mirrored preview with landmarks; Record 10 / 30 / 60 s -> JSON
// download (landmarks only, NO images); Copy calibration JSON (clipboard, else a file).
// =====================================================================================================================
mixin({
  /** debug drawer (engine hook, created on the first toggleDebug()). Never called in Node / headless mode. */
  _createDebugUI() {
    if (!HAS_DOM || this._headlessMode) return null;
    return createDebugUI(this);
  },
});

const DEBUG_ROWS = [
  ['Status', [['state', 'state'], ['code', 'code'], ['msg', 'message'], ['source', 'source / pointer / stream']]],
  ['Runtime', [['fps', 'camera fps'], ['rate', 'data rate set / sent Hz'], ['infer', 'inference ms'], ['frames', 'frames / dropped'], ['errors', 'errors'], ['delegate', 'delegate / MediaPipe'], ['video', 'video / viewport']]],
  ['Eyes (raw, image axes)', [['eh', 'h'], ['ev', 'v'], ['ap', 'aperture'], ['iod', 'iod px']]],
  ['Gaze', [['gstate', 'state'], ['valid', 'valid / calibrated / fresh'], ['raw', 'raw x, y'], ['smooth', 'smoothed x, y'], ['norm', 'nx, ny'], ['sacc', 'saccade / fixation ms'],
    ['blink', 'eyes closed ms / last blink'], ['lsac', 'last saccade px (share) / escape']]],
  ['Head and face', [['head', 'yaw / pitch / roll °'], ['face', 'face box x, y, w, h'], ['dist', 'distance rel / cm']]],
  ['Quality', [['qcal', 'calibrated / layout'], ['qconf', 'confidence / needs check'], ['qpts', 'points / rows / learned'], ['qmodel', 'model'],
    ['qnoise', 'noise px (cal / viewport)'], ['qscale', 'error scale px'], ['qaxis', 'axis X / Y (snr)'], ['qweak', 'weak X / Y'], ['qmir', 'mirrored (fit / option)'],
    ['qhead', 'head mode / influence'], ['qkap', 'head term x / y (v/h ratio)'], ['qoff', 'offset px'],
    ['qfit', 'rmse / looRms px'], ['qloo', 'loo px'], ['qval', 'validation px (ratio)'], ['qmove', 'moved / recenter suggested'], ['qvp', 'viewport changed'],
    ['qcnt', 'learned / rejected / shifts / drifts / recenters']]],
];
const DEBUG_MAX_ROWS = 16;   // calibration rows shown (the most recent ones)
const ICON_DEBUG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M3 12h4l3-8 4 16 3-8h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = dom('a', { href: url, download: name, hidden: true });
  (document.body || document.documentElement).appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createDebugUI(ig) {
  const P = uiId(ig) + '-d-', V = {};
  const put = (k, s) => { const e = V[k]; if (e && e.textContent !== s) e.textContent = s; };
  const sections = DEBUG_ROWS.map(([name, rows]) => dom('section', { class: 'ig-d-sec' }, dom('h3', { text: name }),
    dom('dl', { class: 'ig-kv' }, rows.map(([k, label]) => [dom('dt', { text: label }), dom('dd', null, (V[k] = dom('span', { text: '–' })))]))));

  // calibration rows: a fixed table of DEBUG_MAX_ROWS rows, filled when quality() changes
  const trs = [];
  const tbody = dom('tbody');
  for (let i = 0; i < DEBUG_MAX_ROWS; i++) {
    const tds = [0, 1, 2, 3, 4, 5].map(() => dom('td'));
    const tr = dom('tr', { hidden: true }, tds);
    trs.push({ tr, tds }); tbody.append(tr);
  }
  const table = dom('table', { class: 'ig-d-table' },
    dom('thead', null, dom('tr', null, ['#', 'kind', 'target px', 'w', 'sd ×1000', 'loo px'].map((t) => dom('th', { scope: 'col', text: t })))), tbody);
  const rowsNote = dom('p', { class: 'ig-d-note', text: 'Not calibrated.' });

  const cv = dom('canvas', { class: 'ig-d-preview', role: 'img', 'aria-label': 'Mirrored camera preview with landmarks' });
  const painter = createPainter(ig, cv);

  const recBtns = [10, 30, 60].map((s) => dom('button', { type: 'button', class: 'ig-dbtn', text: 'Record ' + s + ' s', onclick: () => startRec(s) }));
  // [v2.1] the best tuning recording: a 9-dot calibration (ground truth at every dot) + whatever follows, up to 120 s
  const recCalBtn = dom('button', { type: 'button', class: 'ig-dbtn', text: 'Record a 9-dot calibration', title: 'Starts a 120 s recording and a 9-dot calibration: every dot is ground truth for tuning (dev/replay.js)', onclick: () => recordCalibration() });
  recBtns.push(recCalBtn);
  const stopBtn = dom('button', { type: 'button', class: 'ig-dbtn', text: 'Stop + download', disabled: true, onclick: () => stopRec() });
  const recMsg = dom('p', { class: 'ig-d-note', 'aria-live': 'polite', text: 'Landmark-only JSON (no images), bounded to 120 s. For tuning, record DURING a calibration (dots = ground truth).' });
  const copyBtn = dom('button', { type: 'button', class: 'ig-dbtn', text: 'Copy calibration JSON', onclick: () => copyCal() });
  const copyMsg = dom('p', { class: 'ig-d-note', 'aria-live': 'polite' });
  const markChk = dom('input', { type: 'checkbox', id: P + 'markers', checked: true });
  const closeX = dom('button', { type: 'button', class: 'ig-dbtn ig-d-x', 'aria-label': 'Close the debug drawer', title: 'Close', text: '×', onclick: () => ig.toggleDebug(false) });
  const setBtn = dom('button', { type: 'button', class: 'ig-dbtn', text: 'Settings', onclick: () => ig.openSettings() });

  const drawer = dom('aside', { class: 'ig-ui ig-debug', id: P + 'drawer', 'aria-label': 'InkGaze debug drawer' },
    dom('header', { class: 'ig-d-head' }, dom('strong', { text: 'InkGaze debug' }), dom('span', { class: 'ig-d-ver', text: 'v' + VERSION }), setBtn, closeX),
    dom('div', { class: 'ig-d-body' }, sections,
      dom('section', { class: 'ig-d-sec' }, dom('h3', { text: 'Camera (mirrored preview)' }), cv),
      dom('section', { class: 'ig-d-sec' }, dom('h3', { text: 'Calibration rows' }), rowsNote, table),
      dom('section', { class: 'ig-d-sec' }, dom('h3', { text: 'Tools' }),
        dom('div', { class: 'ig-d-tools' }, recBtns, stopBtn), recMsg,
        dom('div', { class: 'ig-d-tools' }, copyBtn), copyMsg,
        dom('label', { class: 'ig-d-check', for: markChk.id }, markChk, ' On-screen gaze markers (ring = raw, dot = smoothed)'))));
  const btn = dom('button', { type: 'button', class: 'ig-ui ig-debug-toggle', 'aria-controls': drawer.id, 'aria-expanded': 'false', 'aria-label': 'InkGaze debug drawer', title: 'InkGaze debug', onclick: () => ig.toggleDebug() });
  btn.innerHTML = ICON_DEBUG;
  const mRaw = dom('div', { class: 'ig-ui ig-marker ig-marker-raw', hidden: true, 'aria-hidden': 'true' });
  const mSm = dom('div', { class: 'ig-ui ig-marker ig-marker-smooth', hidden: true, 'aria-hidden': 'true' });
  const z = ig._opts.zIndex;
  mRaw.style.zIndex = mSm.style.zIndex = String(z + 1); drawer.style.zIndex = String(z + 2); btn.style.zIndex = String(z + 3);
  (document.body || document.documentElement).append(mRaw, mSm, drawer, btn);

  let open = false, cal = false, timer = 0, q = null, qT = 0, recWant = false, lastBlink = null, lastSac = null;
  ig.on('blink', (b) => { lastBlink = b; });
  ig.on('saccade', (e) => { lastSac = e; });

  const place = (m, x, y) => {
    if (!finite(x) || !finite(y)) { if (!m.hidden) m.hidden = true; return; }
    m.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
    if (m.hidden) m.hidden = false;
  };
  const hideMarkers = () => { mRaw.hidden = true; mSm.hidden = true; };
  markChk.addEventListener('change', () => { if (!markChk.checked) hideMarkers(); });

  function renderRows() {
    const st = ig._opts.source === 'camera' && ig._isCalibrated() && ig._pipe ? ig._pipe.exportState() : null;
    const rows = st && Array.isArray(st.rows) ? st.rows : [], loo = q && q.loo;
    let k = 0;
    const items = rows.map((r, i) => { const lo = r.cal && loo ? loo[k] : null; if (r.cal) k++; return { i, r, lo }; }).slice(-DEBUG_MAX_ROWS);
    trs.forEach((x, j) => {
      const it = items[j];
      x.tr.hidden = !it;
      if (!it) return;
      const r = it.r;
      const cells = [String(it.i + 1), r.cal ? 'cal' : 'learn', fmtXY(r.sx, r.sy), fmt(r.w, 2),
        r.sd ? fmt(r.sd[0] * 1000, 1) + ', ' + fmt(r.sd[1] * 1000, 1) : '–', fmt(it.lo, 0)];
      cells.forEach((c, n) => setText(x.tds[n], c));
    });
    setText(rowsNote, !rows.length ? (ig._opts.source === 'mouse' ? 'Mouse source: nothing to calibrate.' : 'Not calibrated.')
      : rows.length > DEBUG_MAX_ROWS ? 'The last ' + DEBUG_MAX_ROWS + ' of ' + rows.length + ' rows (targets in calibration px).' : rows.length + ' rows (targets in calibration px).');
  }
  function recTick() {
    const r = ig._rec;
    stopBtn.disabled = !r;
    for (const b of recBtns) b.disabled = !!r;
    if (r) {
      const el = r.t0 != null ? Math.max(0, (ig._lastFrameT - r.t0) / 1000) : 0;
      setText(recMsg, 'Recording… ' + el.toFixed(1) + ' / ' + Math.round(r.maxMs / 1000) + ' s, ' + r.frames.length + ' frames' + (recWant ? '' : ' (started by the host)'));
    } else if (recWant) {   // stopped at its time limit: download it now
      recWant = false;
      const rr = ig.downloadRecording();
      setText(recMsg, rr ? 'Saved ' + rr.frames.length + ' frames (' + (rr.durationMs / 1000).toFixed(1) + ' s) as JSON.' : '');
    }
  }
  function startRec(s) {
    if (ig._rec) return;
    if (ig.startRecording({ maxSeconds: s })) recWant = true;
    recTick();
  }
  function recordCalibration() {
    if (ig._rec || ig._sess) return;
    if (ig._opts.source !== 'camera') { setText(recMsg, 'Needs the camera source.'); return; }
    startRec(120);
    Promise.resolve(ig.calibrate({ layout: '9' })).then((r) => {
      setText(recMsg, r && r.ok ? 'Calibration recorded. Look around or draw for a while (head still, then moving), then press Stop + download.'
        : 'The calibration did not finish (' + ((r && r.reason) || 'error') + '); the recording continues: Stop + download.');
    });
  }
  function stopRec() {
    if (!ig._rec) return;
    recWant = false;
    const r = ig.downloadRecording();
    setText(recMsg, r ? 'Saved ' + r.frames.length + ' frames (' + (r.durationMs / 1000).toFixed(1) + ' s) as JSON.' : '');
    recTick();
  }
  function copyCal() {
    if (ig._opts.source !== 'camera' || !ig._isCalibrated() || !ig._pipe) { setText(copyMsg, 'Not calibrated (camera source): nothing to copy.'); return; }
    const data = { format: 'inkgaze-calibration', schema: CAL_SCHEMA, version: VERSION, mpVersion: ig._opts.mpVersion, exportedAt: new Date().toISOString(),
      calView: ig._calView, view: { w: ig._view.w, h: ig._view.h }, video: ig._videoSize(), options: ig.getOptions(),
      calibration: ig._lastCalibration, quality: ig.quality(), state: ig._pipe.exportState() };
    const text = JSON.stringify(data, null, 2), kb = Math.max(1, Math.round(text.length / 1024));
    const fallback = () => {
      const ta = dom('textarea', { class: 'ig-offscreen', readonly: true, 'aria-hidden': 'true' });
      ta.value = text; drawer.append(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) setText(copyMsg, 'Copied (' + kb + ' KB).');
      else { downloadText(text, 'inkgaze-calibration.json'); setText(copyMsg, 'No clipboard access: saved inkgaze-calibration.json instead.'); }
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') navigator.clipboard.writeText(text).then(() => setText(copyMsg, 'Copied to the clipboard (' + kb + ' KB).'), fallback);
    else fallback();
  }
  function render() {
    const p = ig.latest, st = ig._statusDetail || {}, o = ig._opts, t = now();
    if (!q || t - qT > 500) { q = ig.quality(); qT = t; }
    const r = q.runtime || {};
    put('state', fmt(st.state)); put('code', fmt(st.code)); put('msg', fmt(st.message)); put('source', o.source + ' / ' + o.pointer + ' / ' + o.stream);
    put('fps', fmt(r.fps, 1)); put('rate', fmt(o.rate, 0) + ' / ' + fmt(r.sentHz, 1)); put('infer', fmt(r.inferMs, 2)); put('frames', fmt(r.frames, 0) + ' / ' + fmt(r.dropped, 0));
    put('errors', fmt(r.errors, 0)); put('delegate', fmt(r.delegate) + ' / ' + fmt(r.mpVersion));
    put('video', (r.video ? r.video.w + '×' + r.video.h : '–') + ' / ' + (q.view ? q.view.w + '×' + q.view.h : '–'));
    const e = p && p.eyes, hd = p && p.head, fc = p && p.face, ds = p && p.distance;
    put('eh', fmt(e && e.h, 4)); put('ev', fmt(e && e.v, 4)); put('ap', fmt(e && e.aperture, 3)); put('iod', fmt(e && e.iod, 1));
    put('gstate', p ? p.state : '–'); put('valid', p ? fmt(p.valid) + ' / ' + fmt(p.calibrated) + ' / ' + fmt(p.fresh) : '–');
    put('raw', p ? fmtXY(p.rawX, p.rawY) : '–'); put('smooth', p ? fmtXY(p.x, p.y) : '–'); put('norm', p ? fmtXY(p.nx, p.ny, 3) : '–');
    put('sacc', p ? fmt(p.saccade) + ' / ' + fmt(p.fixationMs, 0) : '–');
    put('blink', (p ? fmt(p.blinkMs, 0) : '–') + ' / ' + (lastBlink ? lastBlink.durationMs + ' ms' + (lastBlink.long ? ' (long)' : '') : '–'));
    put('lsac', lastSac ? fmt(lastSac.amplitudePx, 0) + ' (' + fmt(lastSac.amplitude * 100, 0) + ' %) / ' + fmt(lastSac.escape) : '–');
    put('head', hd ? fmt(hd.yaw, 1) + ' / ' + fmt(hd.pitch, 1) + ' / ' + fmt(hd.roll, 1) : o.stream !== 'full' ? '(stream ' + o.stream + ')' : '–');
    put('face', fc ? [fc.x, fc.y, fc.w, fc.h].map((v) => fmt(v, 3)).join(', ') : o.stream === 'eyes' ? '(stream eyes)' : '–');
    put('dist', ds ? fmt(ds.rel, 3) + ' / ' + fmt(ds.cm, 1) : o.stream !== 'full' ? '(stream ' + o.stream + ')' : '–');
    const c = !!q.calibrated, v = q.validation;
    put('qcal', fmt(c) + ' / ' + fmt(q.layout)); put('qconf', fmt(q.confidence) + ' / ' + fmt(!!q.needsCheck));
    put('qpts', c ? fmt(q.points, 0) + ' / ' + fmt(q.rows, 0) + ' / ' + fmt(q.learnedRows, 0) : '–');
    put('qmodel', c ? fmt(q.model) : '–');
    put('qnoise', c ? fmt(q.noisePx, 1) + ' / ' + fmt(q.noisePxViewport, 1) : '–');
    put('qscale', c ? fmt(q.scalePx, 1) : '–');
    put('qaxis', c ? fmt(q.axisX) + ' (' + fmt(q.snr && q.snr[0], 1) + ') / ' + fmt(q.axisY) + ' (' + fmt(q.snr && q.snr[1], 1) + ')' : '–');
    put('qweak', q.weak ? fmt(q.weak[0]) + ' / ' + fmt(q.weak[1]) : '–');
    put('qmir', fmt(q.mirrored) + ' / ' + (o.cameraMirrored == null ? 'auto' : fmt(o.cameraMirrored)));
    put('qhead', fmt(q.head) + ' (option ' + o.head + ') / ' + Math.round(o.headWeight * 100) + ' %');
    put('qkap', c && q.kappa ? fmt(q.kappa[0], 3) + ' / ' + fmt(q.kappa[1], 3) + ' (' + fmt(q.kappaRatio, 2) + ')' : '–');
    put('qoff', q.offset ? fmtXY(q.offset[0], q.offset[1], 1) : '–');
    put('qfit', c ? fmt(q.rmsePx, 1) + ' / ' + fmt(q.looRms, 1) : '–');
    put('qloo', q.loo ? q.loo.map((x) => fmt(x, 0)).join(', ') + (q.suspect != null ? '  (suspect dot ' + (q.suspect + 1) + ')' : '') : '–');
    put('qval', v ? fmt(v.errPx, 1) + ' (' + fmt(v.ratio, 2) + ', ' + (v.ok ? 'ok' : 'FAILED') + ')' : '–');
    put('qmove', fmt(q.moved) + ' / ' + fmt(q.recenterSuggested));
    put('qvp', fmt(q.viewportChanged));
    put('qcnt', c ? [q.learned, q.rejected, q.shifts, q.drifts, q.recenters].map((x) => fmt(x, 0)).join(' / ') : '–');
    painter.paint();
    recTick();
  }
  const tick = () => {
    timer = 0;
    if (!open) return;
    try { render(); } catch (e) { reportError(e); }
    timer = ig._timeout(tick, 100);   // ~10 Hz
  };

  return {
    toggle(want) {
      open = !!want;
      drawer.classList.toggle('ig-open', open);
      btn.classList.toggle('ig-active', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) { q = null; renderRows(); if (!timer) tick(); } else { ig._clearTimeout(timer); timer = 0; hideMarkers(); }
      return open;
    },
    frame(p) {
      if (!open || cal || !markChk.checked || !p) return;
      place(mRaw, p.rawX, p.rawY); place(mSm, p.x, p.y);
    },
    quality(qq) { if (qq) { q = qq; qT = now(); } if (open) renderRows(); },
    // the calibration overlay hides the drawer, its button and the markers while a session runs (see UI: calibration)
    calibrating(on) {
      cal = !!on;
      drawer.classList.toggle('ig-cal-hidden', cal); btn.classList.toggle('ig-cal-hidden', cal);
      if (cal) hideMarkers();
    },
    destroy() {
      open = false;
      ig._clearTimeout(timer); timer = 0;
      for (const n of [mRaw, mSm, drawer, btn]) n.remove();
    },
  };
}


// =====================================================================================================================
// ===== EXPORT =====
// =====================================================================================================================
if (typeof window !== 'undefined') window.InkGaze = InkGaze;
if (typeof module !== 'undefined' && module.exports) module.exports = { InkGaze, core };
})();
