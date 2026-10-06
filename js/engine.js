// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18 — drawing engine (shared by 18a / 18b / 18c)
//
//   Two levels of state (dossier §7.10: "arm, then act"):
//     Draw mode   the central menu button: Press to Draw ⇄ Press to Pause (the pencil on / off the desk)
//     The line    while Draw mode is on: starts with a DWELL on the canvas (or at once, if that toggle is off), stops
//                 with the ESCAPE SACCADE (default), a dwell (off by default), a long blink (18a, off by default), or by
//                 looking at the menu. No ink reservoir (v16): a line lasts until it is stopped.
//   The pen     gaze → (amplification, pan: 2D) → 1€ filter per line option (in degrees) → agents (boids, default 1)
//                or the direct pen (0 agents) → real-ink expression (speed → width, engorge, drips, splats; Rigid =
//                constant width). Grid mode (build 14): dwell dots of a lattice, plain segments (or agents).
//   Menu        dwell 0.8 s with exit grace; an activated target needs the gaze to leave before it can fire again;
//               Clear asks in a modal (1.2 s, cancelled the moment the gaze leaves).
// Coordinates: the runtime passes the gaze in HUD space (hud id from hud.hit) and on the SURFACE (surface px; the VR
// ring is unwrapped here, so strokes cross the 360° seam smoothly).
// Two scales (18.1): ppd = surface px per degree OF THE CANVAS (ink widths, drips, splats, the grid: they grow with a
// nearer canvas) · eyePpd = surface px per degree OF THE VIEW (the dwell radius, the 1€ filter: the eyes' own tolerances,
// the same whatever the canvas size). Equal unless the canvas is scaled (Configuration → View size).
// ═══════════════════════════════════════════════════════════════════════════
import {
  LINE_MODES, LINE_ORDER, THICKNESS, THICKNESS_ORDER, COLORS, COLOR_ORDER, GRID_ORDER, PRESETS, PRESET_KEYS,
  OneEuro, Boid, templateProps, randomizedProps, clamp, wrapDelta,
} from './core.js';
import { markBox, drawMark } from './marks.js';

const STEP_MS = 1000 / 60;

export class Engine {
  constructor({ cfg, surface, ppd, wrapW = 0, hooks = {} }) {
    this.cfg = cfg; this.surface = surface; this.ppd = ppd; this.eyePpd = ppd; this.wrapW = wrapW; this.hooks = hooks;
    this.S = {
      now: 0, drawMode: false, penDown: false, submenu: null, modal: null,
      dwell: { id: null, t: 0, lastIn: 0 }, needLeave: null, flashUntil: 0, hoverId: null,
      cdwell: { t: 0, anchor: null, lastIn: 0, armedMove: false }, autoArmT: null,
      target: null, tPrev: null, pen: { x: 0, y: 0, vx: 0, vy: 0, dvx: 0, dvy: 0, last: null }, boids: [],
      eng: 0, lastDrip: 0, lastSplat: 0, frozen: false,
      grid: { active: false, nodes: [], last: null, hoverKey: null, dot: null, flashes: new Map() },
      overHud: false, gazeOnSurface: false,
    };
    this.fx = new OneEuro(); this.fy = new OneEuro();
    this.applyLineMode();
  }

  // ---------------------------------------------------------------------------------------------- selections
  get lineMode() { return this.cfg.lineMode; }
  setLineMode(m) { if (!LINE_MODES[m]) return; this.cfg.lineMode = m; this.applyLineMode(); this._changed('line', m); }
  applyLineMode() {
    const m = LINE_MODES[this.cfg.lineMode] ? this.cfg.lineMode : 'dynamic', lp = this.cfg.lineParams && this.cfg.lineParams[m];
    const [mc, beta] = Array.isArray(lp) ? lp : [LINE_MODES[m].minCutoff, LINE_MODES[m].beta];
    this.fx.set(Math.max(0.01, mc), Math.max(0, beta)); this.fy.set(Math.max(0.01, mc), Math.max(0, beta));
  }
  setThickness(t) { if (!THICKNESS[t]) return; this.cfg.thickness = t; this._changed('thickness', t); }
  setColor(c) { if (!COLORS[c]) return; this.cfg.color = c; this._changed('color', c); }
  setGridMode(g) {
    if (!GRID_ORDER.includes(g)) return;
    this.endGridLine(); this.penUp('mode');
    this.cfg.gridMode = g; this.S.grid.flashes.clear(); this._changed('grid', g);
  }
  step(kind, dir) {   // the controller layer (build 15): cycle a selection
    const orders = { line: LINE_ORDER, thickness: THICKNESS_ORDER, color: COLOR_ORDER, grid: GRID_ORDER };
    const keys = { line: 'lineMode', thickness: 'thickness', color: 'color', grid: 'gridMode' };
    const o = orders[kind], cur = o.indexOf(this.cfg[keys[kind]]), next = o[(Math.max(0, cur) + dir + o.length) % o.length];
    ({ line: () => this.setLineMode(next), thickness: () => this.setThickness(next), color: () => this.setColor(next), grid: () => this.setGridMode(next) })[kind]();
    this.flash();
  }
  _changed(what, v) { if (this.hooks.onChange) this.hooks.onChange(what, v); }
  flash() { this.S.flashUntil = this.S.now + 400; }

  // ---------------------------------------------------------------------------------------------- geometry helpers
  degToPx(d) { return d * this.ppd; }
  get gridMode() { return this.cfg.gridMode !== 'off'; }
  widthRange() { const t = THICKNESS[this.cfg.thickness] || THICKNESS.medium; return { min: this.degToPx(t.min), nom: this.degToPx(t.nom), max: this.degToPx(t.max) }; }
  get color() { return (COLORS[this.cfg.color] || COLORS.black).hex; }
  pxScale() { return this.ppd / 40; }   // expression constants were tuned at ~40 px per degree (builds 12–15)

  // ---------------------------------------------------------------------------------------------- agents (CRUD)
  spawnBoids(saved) {
    const n = clamp(Math.round(this.cfg.boidCount), 0, 8);
    const c = this.S.target || { x: this.surface.width / 2, y: this.surface.height / 2 };
    this.S.boids = [];
    for (let i = 0; i < n; i++) {
      const p = saved && saved[i] ? Object.assign(templateProps(this.cfg), saved[i]) : i === 0 ? templateProps(this.cfg) : randomizedProps(this.cfg);
      const b = new Boid(c.x, c.y, p);
      if (n > 1) this._place(b, c);
      this.S.boids.push(b);
    }
    this.cfg.boidCount = this.S.boids.length;
    this._changed('boids');
  }
  _place(b, c) {
    const a = Math.random() * Math.PI * 2, r = (8 + Math.random() * 44) * this.pxScale();
    b.ox = Math.cos(a) * r; b.oy = Math.sin(a) * r; b.x = c.x; b.y = c.y; b.vx = b.vy = 0; b.last = null;
  }
  addBoid() { if (this.S.boids.length >= 8) return; const c = this.S.target || { x: this.surface.width / 2, y: this.surface.height / 2 }; const b = new Boid(c.x, c.y, randomizedProps(this.cfg)); this._place(b, c); this.S.boids.push(b); this.cfg.boidCount = this.S.boids.length; this._changed('boids'); }
  removeBoid(i) { this.S.boids.splice(i, 1); this.cfg.boidCount = this.S.boids.length; this._changed('boids'); }
  randomizeBoid(i) { const b = this.S.boids[i]; if (b) Object.assign(b, randomizedProps(this.cfg)); this._changed('boids'); }
  resetBoid(i) { const b = this.S.boids[i]; if (b) Object.assign(b, templateProps(this.cfg)); this._changed('boids'); }
  randomizeAll() { for (const b of this.S.boids) Object.assign(b, randomizedProps(this.cfg)); this._changed('boids'); }
  applyPreset(name) {
    const p = PRESETS[name]; if (!p) return;
    for (const k of PRESET_KEYS) if (k in p) this.cfg[k] = p[k];
    this.cfg.preset = name; this.spawnBoids(); this._changed('preset', name);
  }

  // ---------------------------------------------------------------------------------------------- draw mode + line
  toggleDraw() {
    this.S.drawMode = !this.S.drawMode;
    this.penUp('toggle'); this.endGridLine();
    this.S.cdwell.t = 0; this.S.cdwell.leaveAt = null; this.S.autoArmT = null; this.S.rearm = null;
    this.flash(); this._log(this.S.drawMode ? 'draw-on' : 'draw-off');
  }
  setDrawMode(on) { if (!!on !== this.S.drawMode) this.toggleDraw(); }
  penDown() {
    if (this.S.penDown || !this.S.drawMode) return;
    this.S.penDown = true; this.S.eng = 0;
    this.surface.begin();
    this._liftAll();
    this.S.cdwell.t = 0; this.S.cdwell.armedMove = false;
    this.flash(); this._log('line-start');
  }
  penUp(reason) {
    if (!this.S.penDown) return;
    this.S.penDown = false; this.S.eng = 0;
    this._liftAll(); this.surface.commit();
    this.S.cdwell.t = 0;
    this._log('line-stop', reason);
  }
  _liftAll() { for (const b of this.S.boids) b.last = null; this.S.pen.last = null; }
  // the escape saccade (18a / 18b: InkGaze events; 18c: head flick). Only while a line is being drawn (the jump from
  // the menu to the canvas after Press to Draw is also a large saccade). Default: the line ends AND Draw mode goes back
  // to rest ("escape the drawing mode off"); with escapePauses off, Draw mode stays armed but the escape's landing point
  // cannot start the next line (the gaze must travel on first: no Midas touch where the eyes happened to land).
  escape() {
    const S = this.S;
    if (!this.cfg.escapeStop || !S.drawMode) return false;
    if (this.gridMode ? !S.grid.active : !S.penDown) return false;
    if (this.gridMode) { this.endGridLine(); this._log('grid-stop', 'escape'); } else this.penUp('escape');
    if (this.cfg.escapePauses || (!this.gridMode && !this.cfg.dwellStart)) this.toggleDraw();
    else S.rearm = { t: S.now, at: null };
    this.flash();
    return true;
  }
  // a long (deliberate) blink toggles the line (18a, opt-in)
  blink(b) {
    if (!this.cfg.blinkToggle || !b || !b.long || !this.S.drawMode || this.S.overHud || this.gridMode) return false;
    if (this.S.penDown) { this.penUp('blink'); if (!this.cfg.dwellStart) this.toggleDraw(); } else this.penDown();
    return true;
  }
  undo() { this.penUp('undo'); this.endGridLine(); if (this.surface.undoStep()) { this._log('undo'); this._layer('undo'); } this.flash(); }
  redo() { if (this.surface.redoStep()) { this._log('redo'); this._layer('redo'); } this.flash(); }
  clear() {
    this.penUp('clear'); this.endGridLine();
    try { this.surface.clear(); }
    catch (e) {   // never leave the studio stuck: blank the paper without an undo step
      console.error('[inkwell] clear', e);
      const sf = this.surface; sf.action = null; sf.undo = []; sf.redo = []; sf.bytes = 0; sf.paint();
    }
    this._log('clear'); this._layer('clear'); this.flash();
  }
  // 18: one mark of ink — painted here and handed on (the shared drawing paints the same mark in the other windows)
  mark(m) {
    this.surface.draw(markBox(m), (c) => drawMark(c, m));
    if (this.hooks.onInk) this.hooks.onInk(m);
  }
  _layer(why) { if (this.hooks.onLayer) this.hooks.onLayer(why); }   // 18: the whole layer changed (undo, redo, clear)

  // ---------------------------------------------------------------------------------------------- menu actions
  activate(id) {
    const [kind, a, b] = id.split(':');
    if (kind === 'btn') {
      if (a === 'draw') this.toggleDraw();
      else if (a === 'undo') this.undo();
      else this.S.submenu = this.S.submenu === a ? null : a;
    } else if (kind === 'opt') {
      if (a === 'close') this.S.submenu = null;
      else if (a === 'line') this.setLineMode(b);
      else if (a === 'thickness') this.setThickness(b);
      else if (a === 'color') this.setColor(b);
      else if (a === 'grid') this.setGridMode(b);
      else if (a === 'options') {
        if (b === 'clear') this.S.modal = { type: 'clear' };
        else if (this.hooks.onOption) this.hooks.onOption(b);
      }
      if (a !== 'close') this.S.submenu = null;
    } else if (kind === 'modal') {
      const m = this.S.modal;
      if (a === 'cancel') this.S.modal = null;
      else if (a === 'confirm' && m && m.type === 'clear') { this.S.modal = null; this.clear(); }
      else if (a === 'item' && m && m.onItem) { this.S.modal = null; m.onItem(+b); }
      else if (a === 'file' && m && m.onFile) m.onFile();
    }
    this.flash();
    this._log('select', id);
  }
  openModal(m) { this.S.submenu = null; this.S.modal = m; this.S.dwell = { id: null, t: 0, lastIn: 0 }; }
  closeModal() { this.S.modal = null; }

  // ---------------------------------------------------------------------------------------------- per frame
  // inp = { now, dt, hudId, overHud, surf: {x, y} | null (surface px, unwrapped near the previous target),
  //         gazeDegS, blinkMs, lost, hudPt }
  update(inp) {
    const S = this.S, cfg = this.cfg, dt = Math.min(100, Math.max(0, inp.dt));
    S.now = inp.now; S.overHud = !!inp.overHud;
    S.hoverId = inp.hudId || null;

    // 1. menu / submenu / modal dwell (always)
    this._hudDwell(inp.hudId, dt);

    // 2. the gaze on the surface
    const surf = inp.surf && !inp.overHud && !S.modal ? inp.surf : null;
    S.gazeOnSurface = !!surf;
    if (inp.lost) { this.penUp('lost'); }
    S.frozen = inp.blinkMs > 0;                       // eyes closed: the target holds, nothing is laid
    if (surf && !S.frozen) this._setTarget(surf);
    if (S.overHud || S.modal) { this.penUp('menu'); S.autoArmT = null; }

    // 3. activation on the canvas (after an escape: only once the gaze has left the landing point)
    if (S.rearm && surf && !S.frozen) this._rearm(inp.gazeDegS);
    if (S.drawMode && surf && !S.frozen && !S.rearm) {
      if (this.gridMode) this._gridDwell(dt, inp.gazeDegS);
      else this._canvasDwell(dt, inp.gazeDegS);
    } else { S.cdwell.t = 0; if (!surf) S.grid.hoverKey = null, S.grid.dot = null; }

    // 4. the pen / agents
    this._pen(dt);
  }

  // menu dwell: an exit shorter than graceMs does not reset (except the destructive confirm); a fired target needs the
  // gaze to leave it first
  _hudDwell(id, dt) {
    const S = this.S, D = S.dwell, now = S.now;
    if (id === 'zone' || id === 'modal:panel' || id === 'scrim') id = null;
    if (S.needLeave && id !== S.needLeave) S.needLeave = null;
    if (id && id === S.needLeave) { D.id = null; D.t = 0; return; }
    // the destructive confirm keeps only a short grace (≤ 120 ms: webcam wobble, not a glance away). During the grace a
    // brief excursion — onto nothing OR onto another target — only pauses the dwell: jitter never steals it (16.1)
    const grace = D.id === 'modal:confirm' ? Math.min(120, this.cfg.graceMs) : this.cfg.graceMs;
    if (id && id === D.id) { D.t += dt; D.lastIn = now; }
    else if (D.id && now - D.lastIn <= grace) { /* hold */ }
    else if (id) { D.id = id; D.t = 0; D.lastIn = now; }
    else { D.id = null; D.t = 0; }
    if (!D.id || D.id !== id) {
      // a submenu closes when the gaze wanders far from it (handled by the HUD hit: 'scrim-far')
      return;
    }
    const need = this._dwellNeed(D.id);
    if (D.t >= need) {
      const fired = D.id;
      D.id = null; D.t = 0; S.needLeave = fired;
      if (fired === 'scrim-far') { if (S.modal) { S.modal = null; this._log('select', 'modal:dismissed'); } else S.submenu = null; return; }
      if (fired.startsWith('modal:file')) { /* a file dialog needs a click (browsers): dwell only explains */ if (this.hooks.onFileDwell) this.hooks.onFileDwell(); return; }
      if (this.hooks.onDwellDone) this.hooks.onDwellDone(fired);   // before the action: the target's layout is still there
      this.activate(fired);
    }
  }
  _dwellNeed(id) { return id === 'modal:confirm' ? this.cfg.confirmDwellMs : id === 'scrim-far' && this.S.modal ? this.cfg.menuDwellMs * 1.5 : this.cfg.menuDwellMs; }
  dwellProgress(id) { const D = this.S.dwell; if (D.id !== id) return 0; return clamp(D.t / this._dwellNeed(id), 0, 1); }

  // the landing point of an escape follows the gaze for 400 ms (the jump settles), then the block lifts once the gaze is
  // 3 dwell radii away from it
  _rearm(degS) {
    const S = this.S, R = this.cfg.dwellRadiusDeg * this.eyePpd, p = S.target, A = S.rearm;
    S.cdwell.t = 0; S.autoArmT = null;
    if (!A.at || S.now - A.t < 400 || (!A.fixed && degS >= this.cfg.settleDegS)) { A.at = { x: p.x, y: p.y }; return; }
    A.fixed = true;
    if (Math.hypot(p.x - A.at.x, p.y - A.at.y) > 3 * R) S.rearm = null;
  }
  // canvas: dwell (settled gaze inside a small radius) starts the line, or stops it (opt-in)
  _canvasDwell(dt, degS) {
    const S = this.S, cfg = this.cfg, C = S.cdwell, p = S.target, now = S.now;
    const settled = degS < cfg.settleDegS, R = cfg.dwellRadiusDeg * this.eyePpd;
    if (!S.penDown && !cfg.dwellStart) {          // no dwell to start: the pen goes down on the first settled gaze
      if (S.autoArmT == null) S.autoArmT = now;
      if (!settled) S.autoArmT = now;
      else if (now - S.autoArmT >= 120) { this.penDown(); S.autoArmT = null; }
      return;
    }
    const wantDwell = !S.penDown ? cfg.dwellStart : cfg.dwellStop;
    if (!wantDwell) { C.t = 0; return; }
    // 17: a canvas dwell that just fired needs the cursor to move away (2 radii) before the next one counts — with both
    // dwell-start and dwell-stop on (18d), holding still no longer toggles the line on and off every 0.8 s
    if (C.leaveAt) { if (Math.hypot(p.x - C.leaveAt.x, p.y - C.leaveAt.y) > 2 * R) C.leaveAt = null; else { C.t = 0; return; } }
    if (S.penDown && !C.armedMove) {              // stopping needs the gaze to have travelled since the line began
      if (C.anchor && Math.hypot(p.x - C.anchor.x, p.y - C.anchor.y) > 2 * R) C.armedMove = true;
      if (!C.anchor) C.anchor = { x: p.x, y: p.y };
      if (!C.armedMove) { C.t = 0; return; }
    }
    let inside = false;
    if (settled) { if (C.anchor && Math.hypot(p.x - C.anchor.x, p.y - C.anchor.y) <= R) inside = true; else C.anchor = { x: p.x, y: p.y }; }
    if (inside) { C.t += dt; C.lastIn = now; }
    else if (now - C.lastIn > cfg.graceMs) { C.t = 0; if (!settled) C.anchor = { x: p.x, y: p.y }; }
    const need = cfg.canvasDwellMs;
    if (C.t >= need) {
      C.t = 0; C.anchor = { x: p.x, y: p.y }; C.leaveAt = { x: p.x, y: p.y };
      if (!S.penDown) this.penDown();
      else { this.penUp('dwell'); if (!cfg.dwellStart) this.toggleDraw(); }
      if (this.hooks.onDwellDone) this.hooks.onDwellDone('canvas');
    }
  }
  canvasProgress() { const C = this.S.cdwell; return clamp(C.t / this.cfg.canvasDwellMs, 0, 1); }

  // the target: continuous (unwrapped) coordinates; rebased so the ring never drifts far from [0, W)
  _setTarget(p) {
    const S = this.S, W = this.wrapW;
    if (!S.target) { S.target = { x: p.x, y: p.y }; return; }
    const x = W ? S.target.x + wrapDelta(p.x - S.target.x, W) : p.x;
    S.target = { x, y: p.y };
    if (W && (x > 1.5 * W || x < -0.5 * W)) this._rebase(x > 0 ? -W : W);
  }
  _rebase(sh) {
    const S = this.S;
    S.target.x += sh; if (this.fx.x != null) this.fx.x += sh;
    S.pen.x += sh; if (S.pen.last) S.pen.last.x += sh;
    for (const b of S.boids) { b.x += sh; if (b.last) b.last.x += sh; }
  }

  // ---------------------------------------------------------------------------------------------- pen + ink
  _pen(dt) {
    const S = this.S;
    if (!S.target) return;
    const dtS = Math.max(0.001, dt / 1000);
    // line-option smoothing: 1€ filter in degrees (of the view: it smooths the eyes' signal)
    const e = this.eyePpd, fx = this.fx.filter(S.target.x / e, dtS) * e, fy = this.fy.filter(S.target.y / e, dtS) * e;
    S.filtered = { x: fx, y: fy };
    let seek = { x: fx, y: fy };
    if (this.gridMode && S.grid.active && S.grid.last) seek = { x: S.grid.last.x, y: S.grid.last.y };
    const steps = clamp(Math.round(dt / STEP_MS), 1, 6);
    const inking = S.drawMode && ((!this.gridMode && S.penDown) || (this.gridMode && S.grid.active)) && !S.frozen;
    if (S.boids.length) {
      for (let k = 0; k < steps; k++) {
        const tk = (k + 1) / steps, tx = S.pen.x + (seek.x - S.pen.x) * tk, ty = S.pen.y + (seek.y - S.pen.y) * tk;
        for (let i = 0; i < S.boids.length; i++) {
          const b = S.boids[i];
          b.step(tx, ty, (d) => d);
          if (inking) this._ink(b, i === 0, STEP_MS); else b.last = null;
        }
      }
      S.pen.x = seek.x; S.pen.y = seek.y;
    } else {
      const P = S.pen, ovx = P.vx, ovy = P.vy, k = STEP_MS / Math.max(1, dt);
      P.vx = (seek.x - P.x) * k; P.vy = (seek.y - P.y) * k; P.dvx = P.vx - ovx; P.dvy = P.vy - ovy;
      P.x = seek.x; P.y = seek.y;
      P.speedMag = () => Math.hypot(P.vx, P.vy); P.dvMag = () => Math.hypot(P.dvx, P.dvy);
      if (inking && !this.gridMode) this._ink(P, true, dt); else P.last = null;
    }
  }
  // one segment of real ink from p.last to p (surface px)
  _ink(p, primary, dtMs) {
    if (!p.last) { p.last = { x: p.x, y: p.y }; return; }
    const S = this.S, cfg = this.cfg, k = this.pxScale(), mode = LINE_MODES[cfg.lineMode] || LINE_MODES.dynamic, r = this.widthRange();
    const d = Math.hypot(p.x - p.last.x, p.y - p.last.y);
    const spd = p.speedMag(), degS = spd * 60 / this.ppd;
    let w;
    if (this.gridMode) w = r.nom;
    else if (!mode.expressive) w = r.nom;
    else {
      const t = clamp((degS - cfg.slowDegS) / Math.max(0.1, cfg.fastDegS - cfg.slowDegS), 0, 1);
      w = r.max - t * (r.max - r.min);
      if (primary) {
        if (degS < cfg.slowDegS) S.eng = Math.min(cfg.engorge, S.eng + dtMs / 700 * cfg.engorge);
        else S.eng = Math.max(0, S.eng - dtMs / 450 * cfg.engorge);
      }
      w *= 1 + S.eng;
    }
    const color = this.color;
    if (d >= 0.4) {
      this.mark({ t: 's', x0: p.last.x, y0: p.last.y, x1: p.x, y1: p.y, w, c: color });
      p.last = { x: p.x, y: p.y };
    } else if (primary && mode.expressive && !this.gridMode && S.eng > 0.05) {
      this.mark({ t: 'b', x: p.x, y: p.y, r: w / 2, c: color });   // engorging in place: a growing blot
    }
    if (primary && mode.expressive && !this.gridMode) { this._drip(p, w, k, color); this._splat(p, k, color); }
  }
  _drip(p, w, k, color) {
    const S = this.S, cfg = this.cfg;
    if (!cfg.drips || p.speedMag() >= cfg.dripSpeed * k || S.now - S.lastDrip < cfg.dripInt) return;
    const len = (8 + Math.random() * 16) * k * (1 + S.eng), x = p.x, y = p.y, ex = x + (Math.random() - 0.5) * 2 * k, ey = y + len;
    this.mark({ t: 'd', x, y, ex, ey, lw: Math.max(2 * k, w * 0.9), rr: Math.max(1.5 * k, w * 0.55), c: color });
    S.lastDrip = S.now;
  }
  _splat(p, k, color) {
    const S = this.S, cfg = this.cfg;
    const dv = p.dvMag();
    if (!cfg.splats || dv < cfg.splatThr * k || p.speedMag() < 0.6 * k || S.now - S.lastSplat < cfg.splatInt) return;
    const sp = p.speedMag() || 1, ux = p.vx / sp, uy = p.vy / sp, px = -uy, py = ux;
    const r = this.widthRange(), w = r.min + (r.max - r.min) * 0.5;
    const n = 3 + Math.floor(Math.random() * 4 * clamp(dv / (cfg.splatThr * k), 1, 3)), reach = w * 4.5, bx = p.x, by = p.y, dots = [];
    for (let i = 0; i < n; i++) {   // the droplets are chosen once, here: every window paints the same ones
      const along = -w + Math.random() * (reach + w), perp = (Math.random() - 0.5) * w * 1.5;
      const dx = ux * along + px * perp, dy = uy * along + py * perp;
      const fade = Math.max(0, 1 - Math.hypot(dx, dy) / reach), rr = w * (0.18 + Math.random() * 0.22) * fade;
      if (rr >= 0.25) dots.push([bx + dx, by + dy, rr, fade * 0.85]);
    }
    if (dots.length) this.mark({ t: 'p', dots, box: [bx - reach - w, by - reach - w, bx + reach + w, by + reach + w], c: color });
    S.lastSplat = S.now;
  }

  // ---------------------------------------------------------------------------------------------- grid assisted mode
  gridGeom() { const sp = Math.max(8, this.degToPx(this.cfg.gridSpacingDeg)); return { sp, dot: this.degToPx(this.cfg.gridDotDeg), hit: this.degToPx(this.cfg.gridDotDeg / 2 + this.cfg.gridPadDeg) }; }
  nearestDot(x, y) { const { sp } = this.gridGeom(); const gx = Math.round(x / sp) * sp, gy = Math.round(y / sp) * sp; return { x: gx, y: gy, key: gx + ',' + gy }; }
  _gridDwell(dt, degS) {
    const S = this.S, G = S.grid, p = S.target, { hit } = this.gridGeom();
    const d = this.nearestDot(p.x, p.y), within = Math.hypot(p.x - d.x, p.y - d.y) <= hit;
    const C = S.cdwell;
    if (!within) { G.hoverKey = null; G.dot = null; C.t = 0; C.key = null; C.leaveKey = null; return; }
    G.hoverKey = d.key; G.dot = d;
    if (C.leaveKey && C.leaveKey !== d.key) C.leaveKey = null;
    if (C.leaveKey === d.key) { C.t = 0; return; }   // a dot that just fired needs the gaze to leave it first (as menu buttons)
    if (C.key !== d.key) { C.key = d.key; C.t = 0; C.lastIn = S.now; }
    if (degS < this.cfg.settleDegS) { C.t += dt; C.lastIn = S.now; } else if (S.now - C.lastIn > this.cfg.graceMs) C.t = 0;
    if (C.t >= this.cfg.canvasDwellMs) { C.t = 0; C.leaveKey = d.key; this.commitGridNode(d); if (this.hooks.onDwellDone) this.hooks.onDwellDone('grid'); }
  }
  commitGridNode(d) {
    const G = this.S.grid, node = { x: d.x, y: d.y };
    this.flash();
    if (!G.active) {
      G.active = true; G.nodes = [node]; G.last = node; this.surface.begin(); this._liftAll();
      for (const b of this.S.boids) { b.x = d.x; b.y = d.y; b.vx = b.vy = 0; b.last = null; }
      this._log('grid-start'); return;
    }
    if (G.last && G.last.x === node.x && G.last.y === node.y) { this.endGridLine(); this._log('grid-stop', 'dwell'); return; }
    if (!this.S.boids.length) this.mark({ t: 's', x0: G.last.x, y0: G.last.y, x1: node.x, y1: node.y, w: this.widthRange().nom, c: this.color });
    G.nodes.push(node); G.last = node;
  }
  endGridLine() { const G = this.S.grid; if (!G.active) return; G.active = false; G.nodes = []; G.last = null; this._liftAll(); this.surface.commit(); }
  gridFlashes(now) {   // feedback fork: fast ease-in (≤150 ms), slow ease-out (≤450 ms)
    const m = this.S.grid.flashes, key = this.S.grid.hoverKey;
    if (key) { const f = m.get(key); if (!f || f.exit != null) m.set(key, { enter: now, exit: null }); }
    for (const [k, f] of m) { if (k !== key && f.exit == null) f.exit = now; if (f.exit != null && now - f.exit > 450) m.delete(k); }
    return m;
  }

  // ---------------------------------------------------------------------------------------------- state for saving
  serialize() {
    return { lineMode: this.cfg.lineMode, thickness: this.cfg.thickness, color: this.cfg.color, gridMode: this.cfg.gridMode, boids: this.S.boids.map((b) => b.props()) };
  }
  _log(type, detail) { if (this.hooks.onLog) this.hooks.onLog(type, detail); }
}
