// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 16 — the 2D app: 16a (InkGaze webcam eye tracker) and 16b (mouse cursor)
//   Flow     16a: InkGaze takes over (its settings: Start / Resume → calibration or a saved one) · 16b: Start
//            → three dots (look until each pops) → splash (play · About · Help · Configurations) → the studio
//   Input    InkGaze's data stream. 16b runs InkGaze's MOUSE source: the pointer becomes the "gaze" with the same
//            states, saccades and escape saccades, so both variants share every interaction behaviour.
//   Studio   #paper (the surface canvas itself, panned with CSS) · #overlay (grid, agents, menu, reticle, on top of
//            everything, pointer-events: none) · #screens (DOM screens) · the Configuration layer
// ═══════════════════════════════════════════════════════════════════════════
import {
  VERSION, VARIANTS, TK, loadSettings, saveSettings, defaultsFor, settingsKey, storage, deepMerge, setPath, clamp, withAlpha, unlockAudio,
} from './core.js';
import { Surface } from './surface.js';
import { Engine } from './engine.js';
import * as HUD from './hud.js';
import { GazeDom, toast, showGate, showIntro, showSplash, showAbout, showHelp, openConfig, agentsEditor, variantTitle } from './ui.js';
import { t, has, onLanguage, setLanguage, langMeta } from './i18n.js';
import { saveSession, recentSessions, pickSessionFile, parseSession, applySession } from './sessions.js';

export function runApp2D(variant) {
  const isA = variant.id === 'a';
  const cfg = loadSettings(variant);
  if (Array.isArray(cfg.agents)) cfg.boidCount = cfg.agents.length;
  const paperHost = document.getElementById('paper'), overlay = document.getElementById('overlay'), root = document.getElementById('screens');
  const octx = overlay.getContext('2d');
  const gaze = new GazeDom(cfg);
  let W = 0, H = 0, DPR = 1, L = null, surface = null, engine = null, ig = null, gate = null;
  const A = {
    phase: 'boot',          // boot · gate · intro · splash · studio
    paused: true,           // the tracker is not delivering gaze (its dialog / calibration is open, or not started)
    trackerState: '', lost: false,
    raw: null, gaze: null, degS: 0, state: 'lost', blinkMs: 0, holdT: 0, held: null,
    ghost: { x: 0, y: 0 }, pan: { x: 0, y: 0 }, panKey: '', space: false, drag: false,
    cfgUI: null, page: null, orbit: null, lastFrame: performance.now(), lastClearTap: -1e9, recentreHinted: false,
  };
  document.body.classList.add('v-' + variant.id);

  // ---------------------------------------------------------------------------------------------- canvases + surface
  function setupCanvases() {
    W = window.innerWidth; H = window.innerHeight; DPR = Math.min(2, window.devicePixelRatio || 1);
    overlay.width = Math.round(W * DPR); overlay.height = Math.round(H * DPR);
    overlay.style.width = W + 'px'; overlay.style.height = H + 'px';
    L = HUD.layout(W, H, cfg);
  }
  function buildSurface(keep) {
    const ws = cfg.panEnabled ? cfg.worldScale : 1;
    if (engine) { engine.penUp('resize'); engine.endGridLine(); }
    const s = new Surface({ width: W * ws, height: H * ws, scale: DPR });
    if (keep) s.copyFrom(keep);
    surface = s;
    const cv = s.tiles[0].canvas;
    cv.style.width = s.width + 'px'; cv.style.height = s.height + 'px';
    paperHost.replaceChildren(cv);
    A.pan = { x: (s.width - W) / 2, y: (s.height - H) / 2 }; A.panKey = '';
    if (engine) engine.surface = s;
  }
  function placePaper() {
    const key = Math.round(A.pan.x) + ',' + Math.round(A.pan.y);
    if (key === A.panKey) return;
    A.panKey = key; paperHost.firstChild.style.transform = `translate(${-Math.round(A.pan.x)}px, ${-Math.round(A.pan.y)}px)`;
  }
  function panBy(dx, dy) {
    A.pan.x = clamp(A.pan.x + dx, 0, Math.max(0, surface.width - W));
    A.pan.y = clamp(A.pan.y + dy, 0, Math.max(0, surface.height - H));
  }
  const recentrePan = () => { A.pan = { x: (surface.width - W) / 2, y: (surface.height - H) / 2 }; };

  // ---------------------------------------------------------------------------------------------- settings
  let saveT = 0;
  function persist() { clearTimeout(saveT); saveT = setTimeout(() => saveSettings(variant, cfg), 250); }
  function agentsToCfg() { cfg.agents = engine.S.boids.map((b) => b.props()); cfg.boidCount = cfg.agents.length; }
  function onCfgChange(k, v) {
    if (v !== undefined && k !== 'boids' && k !== 'preset') setPath(cfg, k, v);
    if (k === 'lineMode') engine.setLineMode(v);
    else if (k === 'thickness') engine.setThickness(v);
    else if (k === 'color') engine.setColor(v);
    else if (k === 'gridMode') engine.setGridMode(v);
    else if (k.startsWith('lineParams')) engine.applyLineMode();
    else if (k === 'escapeAmplitude') { if (ig) ig.setOptions({ escapeAmplitude: v }); }
    else if (k === 'panEnabled' || k === 'worldScale') buildSurface(surface);
    else if (k === 'hitPad') L = HUD.layout(W, H, cfg);
    else if (k === 'ppd') engine.ppd = v;
    if (k === 'boids' || k === 'preset') agentsToCfg();
    persist();
  }
  function replaceCfg(next) { for (const k of Object.keys(cfg)) delete cfg[k]; Object.assign(cfg, next); }
  function afterCfgSwap(boids) {
    engine.applyLineMode(); engine.ppd = cfg.ppd;
    if (boids && boids.length) { cfg.boidCount = boids.length; engine.spawnBoids(boids); } else engine.spawnBoids(Array.isArray(cfg.agents) && cfg.agents.length === cfg.boidCount ? cfg.agents : null);
    agentsToCfg();
    L = HUD.layout(W, H, cfg);
    if (ig) ig.setOptions({ escapeAmplitude: cfg.escapeAmplitude });
    persist();
  }

  // ---------------------------------------------------------------------------------------------- input (InkGaze)
  function startInput() {
    const IG = window.InkGaze;
    if (!IG) { toast(t('toast.libMissing'), 8000); return; }
    let devMouse = false; try { devMouse = new URLSearchParams(location.search).get('source') === 'mouse'; } catch (e) { /* no URL */ }
    ig = isA   // 16a?source=mouse: InkGaze's own flow without a camera (development; nothing is saved to its settings)
      ? new IG(Object.assign({ storageKey: 'inkwell16.inkgaze', escapeAmplitude: cfg.escapeAmplitude }, devMouse ? { source: 'mouse', persist: false } : {}))
      : new IG({ source: 'mouse', ui: false, persist: false, smoothing: 0, rate: 60, escapeAmplitude: cfg.escapeAmplitude });
    ig.on('data', onData);
    ig.on('saccade', (s) => { if (s.escape && A.phase === 'studio' && !overlayOpen() && !A.paused) engine.escape(); });
    ig.on('blink', (b) => { if (A.phase === 'studio' && !overlayOpen() && !A.paused) engine.blink(b); });
    ig.on('status', onStatus);
    if (isA) ig.on('quality', (q) => {
      if (q.recenterSuggested && !A.recentreHinted && A.phase === 'studio') { A.recentreHinted = true; toast(t('toast.recentreHint'), 6000); }
    });
    window.addEventListener('pagehide', () => { try { ig.destroy(); } catch (e) { /* closing */ } });
  }
  function onData(p) {
    if (p.x == null || !p.calibrated) { A.state = p.state || 'lost'; return; }
    A.state = p.state;
    A.blinkMs = p.state === 'blink' ? Math.max(1, p.blinkMs || 0) : 0;   // eyes closed or a brief dropout: hold the pen
    if (isA && p.state === 'saccade') { if (!A.holdT) A.holdT = performance.now(); } else A.holdT = 0;
    A.raw = { x: p.x, y: p.y };
  }
  function onStatus(s) {
    A.trackerState = s.state;
    A.lost = s.state === 'lost';
    A.paused = !['tracking', 'lost'].includes(s.state);
    if (isA && A.phase === 'gate' && gate) gateMessage(s);
    if (isA && s.state === 'tracking' && A.phase === 'gate') goIntro();   // 16b waits for its Start
  }
  function updateGaze(dt) {
    const r = A.raw; if (!r) return;
    if (!A.gaze) A.gaze = { x: r.x, y: r.y };
    const k = cfg.cursorSmooth >= 0.999 ? 1 : 1 - Math.pow(1 - clamp(cfg.cursorSmooth, 0.01, 1), dt / 16.67);
    const px = A.gaze.x, py = A.gaze.y;
    A.gaze.x += (r.x - A.gaze.x) * k; A.gaze.y += (r.y - A.gaze.y) * k;
    const v = Math.hypot(A.gaze.x - px, A.gaze.y - py) / Math.max(1, dt) * 1000 / cfg.ppd;   // deg/s
    A.degS += (v - A.degS) * (1 - Math.exp(-dt / 70));
  }
  const live = () => !!A.gaze && !A.paused && A.state !== 'lost';
  const onScreen = (p) => ({ x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) });
  function learn(x, y) { if (isA && ig) { try { ig.learn(x, y); } catch (e) { /* not calibrated */ } } }
  gaze.onFire = (el) => { const r = el.getBoundingClientRect(); learn(r.left + r.width / 2, r.top + r.height / 2); };

  // ---------------------------------------------------------------------------------------------- the engine
  function makeEngine() {
    engine = new Engine({
      cfg, surface, ppd: cfg.ppd,
      hooks: {
        onChange: (what) => { if (what === 'boids' || what === 'preset') agentsToCfg(); persist(); },
        onOption: (b) => { if (b === 'save') doSave(); else if (b === 'open') doOpen(); else if (b === 'config') openConfigUI(); },
        onFileDwell: () => toast(t('toast.fileDwell'), 5200),
        onDwellDone: (id) => { const c = HUD.targetCentre(L, engine.S, id); if (c) learn(c.x, c.y); },
      },
    });
    engine.spawnBoids(Array.isArray(cfg.agents) && cfg.agents.length === cfg.boidCount ? cfg.agents : null);
    agentsToCfg();
    engine.S.target = { x: surface.width / 2, y: surface.height / 2 };
  }

  // ---------------------------------------------------------------------------------------------- phases
  function goGate() {
    A.phase = 'gate';
    renderGate();
    startInput();
    if (!ig) return;
    if (isA) ig.init().then((ok) => { if (!ok && A.phase === 'gate') gateMessage({ state: 'closed' }); });
    else ig.start();
  }
  function gateSpec() {
    if (isA) return {
      message: gateText(A.gateStatus), kind: gateKind(A.gateStatus),
      buttons: [
        { label: t('gate.trackerSettings'), icon: 'eye', click: true, fn: () => { unlockAudio(); if (ig && !ig.openSettings()) ig.init(); } },
        { label: t('gate.useMouse'), icon: 'mouse', click: true, href: VARIANTS.b.page },
      ],
    };
    return { message: t('gate.mouseIntro'), buttons: [{ label: t('gate.start'), icon: 'play', primary: true, fn: () => { unlockAudio(); goIntro(); } }] };
  }
  function renderGate() { if (gate) gate.close(true); gate = showGate(Object.assign({ root, gaze, variant, onLanguage: pickLanguage }, gateSpec())); }
  const gateText = (s) => (!s ? t('gate.status.invoked') : s.state === 'error' ? (s.message || t('gate.trackerFailed')) : t('gate.status.' + s.state));
  const gateKind = (s) => (!s ? '' : s.state === 'error' ? 'error' : s.state === 'closed' ? 'warn' : '');
  function gateMessage(s) {   // InkGaze's status while it has the stage (its own error texts are in English)
    if (!gate || (s.state !== 'error' && !has('gate.status.' + s.state))) return;
    A.gateStatus = s;
    gate.setMessage(gateText(s), gateKind(s));
  }
  const introHint = () => t(isA ? 'intro.hintEyes' : 'intro.hintPointer');
  function goIntro() {
    if (A.phase !== 'gate') return;
    if (gate) { gate.close(); gate = null; }
    A.phase = 'intro';
    showIntro({ root, gaze, cfg, ppd: cfg.ppd, hint: introHint(), onDone: goSplash });
  }
  let splashEl = null;
  function goSplash() {
    A.phase = 'splash'; document.body.classList.remove('studio');
    if (engine) { engine.setDrawMode(false); engine.S.submenu = null; engine.closeModal(); }
    renderSplash();
  }
  function renderSplash() {
    if (splashEl) { gaze.removeWithin(splashEl); splashEl.remove(); }
    splashEl = showSplash({
      root, gaze, variant, onLanguage: pickLanguage,
      onPlay: goStudio, onAbout: () => openPage('about'), onHelp: () => openPage('help'), onConfig: () => openConfigUI(),
    });
    if (overlayOpen()) cover(true);
  }
  function goStudio() {
    if (splashEl) { gaze.removeWithin(splashEl); splashEl.remove(); splashEl = null; }
    A.phase = 'studio'; document.body.classList.add('studio');
    engine.S.needLeave = null; engine.S.dwell = { id: null, t: 0, lastIn: 0 };
    unlockAudio();
  }
  const overlayOpen = () => !!(A.cfgUI || A.page);
  function cover(on) { if (splashEl) splashEl.inert = on; }
  function openPage(which) {
    if (A.page) return;
    if (engine) { engine.penUp('page'); engine.endGridLine(); }
    cover(true);
    const close = () => { A.page = null; cover(false); };
    A.pageKind = which;
    A.page = (which === 'about' ? showAbout : showHelp)({ root, gaze, onBack: close });
  }
  function closePage() { if (!A.page) return false; const back = A.page.querySelector('.page-back'); if (back) back.click(); return true; }

  // ---------------------------------------------------------------------------------------------- configuration
  function openConfigUI(scrollTop = 0) {
    if (A.cfgUI) return;
    if (engine) { engine.penUp('config'); engine.endGridLine(); engine.S.submenu = null; }
    cover(true);
    try { openConfigLayer(scrollTop); } catch (e) { cover(false); A.cfgUI = null; throw e; }
  }
  function openConfigLayer(scrollTop) {
    A.cfgUI = openConfig({
      variant, cfg, gaze, scrollTop,
      onChange: onCfgChange,
      onLanguage: pickLanguage,
      agents: () => agentsEditor({ engine, cfg, onChange: onCfgChange }),
      tracker: isA ? trackerPanel : null,
      onReset: () => { replaceCfg(defaultsFor(variant)); afterCfgSwap(null); buildSurface(surface); toast(t('toast.defaults')); reopenConfig(); },
      onClearSaved: () => { storage.del(settingsKey(variant)); toast(t('toast.storageCleared', { key: variant.key }), 4200); },
      links: [
        { label: t('cfg.data.about'), fn: () => { closeConfig(); openPage('about'); } },
        { label: t('cfg.data.help'), fn: () => { closeConfig(); openPage('help'); } },
        A.phase === 'studio' ? { label: t('cfg.data.start'), fn: () => { closeConfig(); goSplash(); } } : null,
      ].filter(Boolean),
      onClose: () => { A.cfgUI = null; cover(false); },
    });
  }
  function closeConfig() { if (!A.cfgUI) return false; A.cfgUI.close(); return true; }
  function reopenConfig() { closeConfig(); openConfigUI(); }
  function trackerPanel() {
    const box = document.createElement('div'); box.className = 'tracker-panel';
    const q = ig ? ig.quality() : null, rt = (q && q.runtime) || {};
    const info = document.createElement('p'); info.className = 'hint';
    info.textContent = !q ? t('cfg.tracker.notRunning')
      : (q.calibrated ? t('cfg.tracker.calibrated', { points: q.points || '?', model: q.model || '' }) : t('cfg.tracker.notCalibrated'))
        + (rt.fps ? t('cfg.tracker.fps', { fps: Math.round(rt.fps) }) : '') + (rt.sentHz ? t('cfg.tracker.hz', { hz: Math.round(rt.sentHz) }) : '');
    const row = document.createElement('div'); row.className = 'row wrap';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.addEventListener('click', () => { closeConfig(); fn(); }); return b; };
    row.append(
      mk(t('cfg.tracker.settings'), () => ig && ig.openSettings()),
      mk(t('cfg.tracker.recentre'), () => ig && ig.recenter()),
      mk(t('cfg.tracker.cal5'), () => ig && ig.calibrate({ layout: '5' })),
      mk(t('cfg.tracker.cal9'), () => ig && ig.calibrate({ layout: '9' })),
    );
    box.append(info, row, Object.assign(document.createElement('p'), { className: 'hint', textContent: t('cfg.tracker.help') }));
    return box;
  }

  // ---------------------------------------------------------------------------------------------- sessions
  async function doSave() {
    toast(t('toast.saving'));
    try {
      const r = await saveSession({ variant, cfg, engine, surface, inkgaze: isA ? ig : null });
      toast(t('toast.saved', { png: r.png, json: r.json }), 5200);
    } catch (e) { toast(t('toast.saveFailed', { error: e && e.message ? e.message : e }), 5200); }
  }
  async function doOpen() {
    const items = await recentSessions(variant);
    engine.openModal({
      type: 'open', items,
      onItem: (i) => openSession(items[i] && items[i].json),
      onFile: () => { pickSessionFile().then((s) => { if (s) openSession(s); }); },   // runs inside the click (file dialogs need one)
    });
  }
  async function openSession(json) {
    engine.closeModal();
    const s = parseSession(json);
    if (!s || s.error) { toast(s && s.error ? t(s.error) : t('toast.nothingOpened'), 4200); return; }
    engine.penUp('open'); engine.endGridLine();
    const before = cfg.panEnabled + ':' + cfg.worldScale;
    const r = await applySession(s, {
      variant, cfg, engine, getSurface: () => surface, inkgaze: isA ? ig : null,
      applyCfg: (next, boids) => {
        replaceCfg(deepMerge(defaultsFor(variant), next));
        afterCfgSwap(boids);
        if (before !== cfg.panEnabled + ':' + cfg.worldScale) buildSurface(null);
      },
    });
    let msg = t('toast.restored', { date: new Date(s.savedAt).toLocaleString(document.documentElement.lang || undefined) });
    if (r.calibration) msg += r.calibration.ok ? t('toast.calRestored') : t('toast.calNotLoaded', { reason: r.calibration.reason || t('toast.calOtherCamera') });
    toast(msg, 5600);
  }

  // ---------------------------------------------------------------------------------------------- per frame
  function ghost(g, dt) {
    const cx = W / 2, cy = H / 2;
    let ax = cx + (g.x - cx) * cfg.gazeAmp, ay = cy + (g.y - cy) * cfg.gazeAmp;
    if (cfg.panEnabled && !engine.S.penDown && !engine.S.grid.active) {   // assistive edge-pan (build 13), not while inking
      const hbx = cfg.comfortFrac * W / 2, hby = cfg.comfortFrac * H / 2, ox = ax - cx, oy = ay - cy, k = cfg.panRate * dt / 16.67;
      const overBar = ax >= L.barX && ax <= L.barX + L.barW;
      if (ox > hbx) { panBy((ox - hbx) * k, 0); ax = cx + hbx; } else if (ox < -hbx) { panBy((ox + hbx) * k, 0); ax = cx - hbx; }
      if (oy > hby) { if (!overBar) { panBy(0, (oy - hby) * k); ay = cy + hby; } } else if (oy < -hby) { panBy(0, (oy + hby) * k); ay = cy - hby; }
    }
    A.ghost = { x: clamp(ax, 0, W), y: clamp(ay, 0, H) };
  }
  function tickStudio(now, dt) {
    const ok = live(), g = ok ? onScreen(A.gaze) : null;
    const hudId = g ? HUD.hit(L, engine.S, g) : null;
    let surf = null;
    if (g && !hudId) {
      ghost(g, dt);
      const hold = A.holdT && now - A.holdT < 100;   // 16a: a saccade in flight: hold the pen until the escape check
      if (!hold || !A.held) A.held = { x: A.ghost.x + A.pan.x, y: A.ghost.y + A.pan.y };
      surf = A.held;
    }
    engine.update({ now, dt, hudId, overHud: !!hudId, surf, gazeDegS: A.degS, blinkMs: A.blinkMs, lost: !ok });
  }
  function frame(now) { requestAnimationFrame(frame); tick(now); }
  let lastErrT = 0;
  const report = (e) => { const t = performance.now(); if (t - lastErrT > 2000) { lastErrT = t; console.error('[inkwell]', e); } };
  function tick(now) {   // 16.1: one failing step never freezes the screen (input and drawing are guarded separately)
    const dt = Math.min(100, Math.max(0, now - A.lastFrame)); A.lastFrame = Math.max(A.lastFrame, now);
    if (A.orbit) { orbitStep(); return; }
    try {
      updateGaze(dt);
      if (A.phase === 'studio' && !overlayOpen()) tickStudio(now, dt);
      else gaze.update(live() ? onScreen(A.gaze) : null, dt, now);
    } catch (e) { report(e); }
    try { render(now); } catch (e) { report(e); }
  }

  // ---------------------------------------------------------------------------------------------- rendering
  function render(now) {
    const c = octx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, overlay.width, overlay.height); c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const studio = A.phase === 'studio' && !overlayOpen();
    if (A.phase === 'studio') placePaper();
    if (studio) {
      if (engine.gridMode) drawGrid(c, now);
      drawAgents(c);
      HUD.render(c, L, engine, now);
      if (isA && A.lost) badge(c, t('badge.faceLost'));
      else if (isA && A.paused && A.trackerState) badge(c, t('badge.tracker', { state: A.trackerState }));
    }
    if (!live()) return;
    const g = onScreen(A.gaze);
    if (studio) HUD.reticle(c, g.x, g.y, engine, { r: 30 });
    else if (isA && cfg.cursorPaused !== false) {   // the screens: the paused cursor (a dashed 40 %-black circle)
      c.save(); c.setLineDash([5, 6]); c.lineWidth = 2; c.strokeStyle = 'rgba(25,24,23,0.4)'; c.beginPath(); c.arc(g.x, g.y, 24, 0, Math.PI * 2); c.stroke(); c.restore();
    }
  }
  function badge(c, text) {
    c.save(); c.font = "600 13px 'JetBrains Mono', ui-monospace, monospace"; c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(text).width + 32, x = W / 2 - w / 2, y = 16;
    c.fillStyle = 'rgba(253,238,235,0.95)'; c.beginPath(); c.roundRect ? c.roundRect(x, y, w, 32, 16) : c.rect(x, y, w, 32); c.fill();
    c.fillStyle = TK.red; c.fillText(text, W / 2, y + 16.5); c.restore();
  }
  function flashAlpha(f, now) {   // feedback fork: fast ease-in (150 ms), slow ease-out (450 ms)
    const a = clamp((now - f.enter) / 150, 0, 1);
    return f.exit == null ? a : a * (1 - clamp((now - f.exit) / 450, 0, 1));
  }
  function drawGrid(c, now) {
    const S = engine.S, G = S.grid, { sp, dot } = engine.gridGeom(), vis = cfg.gridMode, rr = dot / 2;
    const flashes = engine.gridFlashes(now);
    if (vis !== 'hidden') {
      const x0 = Math.floor(A.pan.x / sp) * sp, y0 = Math.floor(A.pan.y / sp) * sp;
      for (let wx = x0; wx <= A.pan.x + W + sp; wx += sp) for (let wy = y0; wy <= A.pan.y + H + sp; wy += sp) {
        let alpha = 0.16;
        if (vis === 'feedback') { const f = flashes.get(wx + ',' + wy); if (!f) continue; alpha = flashAlpha(f, now) * 0.65; if (alpha <= 0.01) continue; }
        c.beginPath(); c.arc(wx - A.pan.x, wy - A.pan.y, rr, 0, Math.PI * 2); c.fillStyle = withAlpha(TK.ink, alpha); c.fill();
      }
    }
    if (!S.drawMode) return;
    const col = engine.color === '#ffffff' ? TK.muted : engine.color;
    if (G.active) for (const n of G.nodes) { c.beginPath(); c.arc(n.x - A.pan.x, n.y - A.pan.y, 4, 0, Math.PI * 2); c.fillStyle = withAlpha(col, 0.55); c.fill(); }
    const d = G.dot;
    if (!d) return;
    const sx = d.x - A.pan.x, sy = d.y - A.pan.y;
    if (vis !== 'hidden') { c.beginPath(); c.arc(sx, sy, rr + 3, 0, Math.PI * 2); c.strokeStyle = withAlpha(col, 0.9); c.lineWidth = 2; c.stroke(); }
    if (G.active && G.last && !S.boids.length) {
      c.save(); c.setLineDash([4, 5]); c.strokeStyle = withAlpha(col, 0.35); c.lineWidth = 2;
      c.beginPath(); c.moveTo(G.last.x - A.pan.x, G.last.y - A.pan.y); c.lineTo(sx, sy); c.stroke(); c.restore();
    }
    const pr = S.cdwell.key === d.key ? clamp(S.cdwell.t / cfg.canvasDwellMs, 0, 1) : 0;
    if (pr > 0) HUD.arc(c, sx, sy, rr + 8, pr, TK.red, 3);
  }
  function drawAgents(c) {
    const S = engine.S, white = engine.color === '#ffffff', col = white ? '#ffffff' : engine.color;
    const inking = S.drawMode && ((!engine.gridMode && S.penDown) || (engine.gridMode && S.grid.active));
    const amp = Math.abs(cfg.gazeAmp - 1) > 0.02, g = live() ? onScreen(A.gaze) : null, gh = A.ghost;
    if (!HUD.cursorVisible(engine)) return;   // drawing with the cursor hidden: no ghost, no agent markers either
    if (amp && S.drawMode && g) {   // the ghost: the amplified drawing origin
      c.save(); c.strokeStyle = 'rgba(158,150,138,0.30)'; c.lineWidth = 1; c.setLineDash([3, 4]);
      c.beginPath(); c.moveTo(g.x, g.y); c.lineTo(gh.x, gh.y); c.stroke(); c.restore();
      c.beginPath(); c.arc(gh.x, gh.y, 21, 0, Math.PI * 2); c.strokeStyle = withAlpha(white ? TK.muted : col, 0.35); c.lineWidth = 1.5; c.stroke();
    }
    const nib = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = withAlpha(col, 0.95); c.fill(); c.strokeStyle = white ? TK.muted : 'rgba(255,255,255,0.7)'; c.lineWidth = 1; c.stroke(); };
    const r = engine.widthRange(), rn = clamp(r.nom * (1 + S.eng), 3, 40) / 2 + 2;
    if (S.boids.length) {
      for (const b of S.boids) {
        const x = b.x - A.pan.x, y = b.y - A.pan.y;
        if (!S.drawMode) continue;
        if (!inking) {
          c.save(); c.strokeStyle = 'rgba(158,150,138,0.22)'; c.lineWidth = 1; c.setLineDash([2, 4]);
          c.beginPath(); c.moveTo(gh.x, gh.y); c.lineTo(x, y); c.stroke(); c.restore();
          c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fillStyle = withAlpha(white ? TK.muted : col, 0.5); c.fill();
        } else nib(x, y, rn);
      }
    } else if (inking && !engine.gridMode && S.pen) nib(S.pen.x - A.pan.x, S.pen.y - A.pan.y, rn);
  }

  // ---------------------------------------------------------------------------------------------- 3D view (build 15)
  // the drawing lifts onto a plane in CSS perspective; o/l pitch · k/ç yaw · a/d roll · w/s zoom · p (or Esc) back
  const orbitEl = document.getElementById('orbit');
  function enterOrbit() {
    if (A.orbit || A.phase !== 'studio' || overlayOpen() || !orbitEl) return;
    engine.penUp('orbit'); engine.endGridLine();
    const img = surface.toCanvas(2400), plane = orbitEl.querySelector('.orbit-plane'), aspect = img.width / img.height;
    plane.style.backgroundImage = `url(${img.toDataURL('image/png')})`;
    const pw = Math.min(W * 0.66, H * 0.66 * aspect);
    plane.style.width = pw + 'px'; plane.style.height = pw / aspect + 'px';
    A.orbit = { pitch: 18, yaw: -24, roll: 0, zoom: 1, keys: new Set() };
    orbitEl.hidden = false; document.body.classList.add('orbiting');
    orbitApply();
  }
  function exitOrbit() { if (!A.orbit) return false; A.orbit = null; orbitEl.hidden = true; document.body.classList.remove('orbiting'); A.lastFrame = performance.now(); return true; }
  function orbitApply() {
    const o = A.orbit, plane = orbitEl.querySelector('.orbit-plane'), rd = orbitEl.querySelector('.orbit-readout');
    plane.style.transform = `translateZ(${(o.zoom - 1) * 500}px) rotateX(${o.pitch}deg) rotateY(${o.yaw}deg) rotateZ(${o.roll}deg)`;
    if (rd) rd.textContent = `pitch ${o.pitch.toFixed(0)}°  yaw ${o.yaw.toFixed(0)}°  roll ${o.roll.toFixed(0)}°  zoom ${o.zoom.toFixed(2)}×`;
  }
  function orbitStep() {
    const o = A.orbit, k = o.keys, R = 1.7, Z = 0.02;
    if (k.has('o')) o.pitch -= R; if (k.has('l')) o.pitch += R; if (k.has('k')) o.yaw -= R; if (k.has('ç')) o.yaw += R;
    if (k.has('a')) o.roll -= R; if (k.has('d')) o.roll += R; if (k.has('w')) o.zoom = clamp(o.zoom + Z, 0.3, 2.6); if (k.has('s')) o.zoom = clamp(o.zoom - Z, 0.3, 2.6);
    if (k.size) orbitApply();
  }

  // ---------------------------------------------------------------------------------------------- helpers' controls
  // the controller layer of build 15 (Wiimote sticks emulate w/a/s/d · o/k/l/ç; buttons q/e/i/p) + a few extras
  function controllerDraw() {   // q: wake, then pen down / up (grid: place / stop at the aimed dot)
    if (!engine.S.drawMode) engine.setDrawMode(true);
    if (engine.gridMode) {
      const p = engine.S.target; if (!p) return;
      const d = engine.nearestDot(p.x, p.y), { hit } = engine.gridGeom();
      if (Math.hypot(p.x - d.x, p.y - d.y) <= hit) engine.commitGridNode(d); else if (engine.S.grid.active) engine.endGridLine();
    } else if (engine.S.penDown) engine.penUp('key'); else engine.penDown();
    engine.flash();
  }
  function clearTap() {   // e twice = clear (the HUD's deliberate two-step)
    const now = performance.now();
    if (now - A.lastClearTap < 550) { engine.clear(); A.lastClearTap = -1e9; toast(t('toast.cleared')); } else { A.lastClearTap = now; engine.flash(); }
  }
  function closeTop() {
    if (exitOrbit()) return true;
    if (closeConfig()) return true;
    if (closePage()) return true;
    if (A.phase === 'studio' && engine.S.modal) { engine.activate('modal:cancel'); return true; }
    if (A.phase === 'studio' && engine.S.submenu) { engine.S.submenu = null; return true; }
    return false;
  }
  function toggleFullscreen() {
    try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { /* not allowed */ }
  }
  document.addEventListener('keydown', (e) => {
    const tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(tg.tagName || ''))) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'escape') { if (closeTop()) e.preventDefault(); return; }   // otherwise InkGaze opens its settings (16a)
    if (A.orbit) { if ('oklçawsd'.includes(k) && k) { A.orbit.keys.add(k); e.preventDefault(); } else if (k === 'p') exitOrbit(); return; }
    if (k === 'f' && !e.repeat) { toggleFullscreen(); return; }
    if (A.phase !== 'studio' || overlayOpen()) return;
    if (k === ' ') { A.space = true; e.preventDefault(); return; }
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (k) {
      case 'w': engine.step('thickness', +1); break;
      case 's': engine.step('thickness', -1); break;
      case 'd': engine.step('line', +1); break;
      case 'a': engine.step('line', -1); break;
      case 'o': engine.step('color', +1); break;
      case 'l': engine.step('color', -1); break;
      case 'k': case 'z': engine.undo(); break;
      case 'ç': case 'y': engine.redo(); break;
      case 'q': controllerDraw(); break;
      case 'e': clearTap(); break;
      case 'g': engine.step('grid', +1); break;
      case 'i': enterOrbit(); break;
      case 'r': recentrePan(); toast(t('toast.recentred')); break;
      case 'c': if (isA && ig) ig.recenter(); break;
      default: return;
    }
    e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    const k = (e.key || '').toLowerCase();
    if (A.orbit) A.orbit.keys.delete(k);
    if (k === ' ') A.space = false;
  });
  // pointer: clicks act on the menu at once (helpers / quick tests); right-drag or space+move pans the canvas
  const stage = document.getElementById('stage');
  stage.addEventListener('click', (e) => {
    unlockAudio();
    if (A.phase !== 'studio' || overlayOpen() || A.orbit) return;
    const p = { x: e.clientX, y: e.clientY }, id = HUD.hit(L, engine.S, p);
    if (id && /^(btn|opt|modal):/.test(id) && id !== 'modal:panel') {
      engine.activate(id);
      engine.S.needLeave = id; engine.S.dwell = { id: null, t: 0, lastIn: 0 };
      return;
    }
    if (id === 'scrim' || id === 'scrim-far') { if (engine.S.modal) engine.activate('modal:cancel'); else engine.S.submenu = null; return; }
    if (!id && !isA && engine.S.drawMode) controllerDraw();   // 16b: a click on the canvas starts / stops the line
  });
  stage.addEventListener('pointerdown', (e) => { if (e.button === 2) A.drag = true; });
  window.addEventListener('pointerup', (e) => { if (e.button === 2) A.drag = false; });
  window.addEventListener('pointermove', (e) => { if ((A.drag || A.space) && A.phase === 'studio' && cfg.panEnabled) panBy(-e.movementX, -e.movementY); }, { passive: true });
  stage.addEventListener('contextmenu', (e) => { if (A.phase === 'studio') e.preventDefault(); });
  document.addEventListener('pointerdown', () => unlockAudio(), { passive: true });

  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { const old = surface; setupCanvases(); buildSurface(old); }, 120);
  });

  // ---------------------------------------------------------------------------------------------- languages
  // the canvas menu redraws every frame in the new language; the DOM screens are rebuilt in place
  function pickLanguage(code) { setLanguage(code).then(() => toast(t('toast.language', { name: langMeta().nativeName || code }))); }
  onLanguage(() => {
    document.title = variantTitle(variant);
    if (A.phase === 'gate' && gate) renderGate();
    const hint = root.querySelector('.intro-hint'); if (hint) hint.textContent = introHint();
    if (A.phase === 'splash' && splashEl) renderSplash();
    if (A.page) { const kind = A.pageKind; gaze.removeWithin(A.page); A.page.remove(); A.page = null; openPage(kind); }
    if (A.cfgUI) { const st = A.cfgUI.scrollTop; closeConfig(); openConfigUI(st); }
  });

  // ---------------------------------------------------------------------------------------------- boot
  document.title = variantTitle(variant);
  setupCanvases();
  buildSurface(null);
  makeEngine();
  window.inkwell = {
    version: VERSION, variant, cfg, A, get engine() { return engine; }, get surface() { return surface; }, get inkgaze() { return ig; },
    // tests: stop the live input, then inject gaze points (viewport px)
    testMode() { if (ig) ig.stop(); A.paused = false; A.state = 'fixation'; },
    inject(x, y, state = 'fixation') { onData({ x, y, calibrated: true, state, blinkMs: state === 'blink' ? 100 : 0 }); A.state = state; A.paused = false; },
    // tests in a hidden tab (no requestAnimationFrame): advance n frames of dt ms on a virtual clock
    step(n = 1, dt = 1000 / 60) { for (let i = 0; i < n; i++) tick(A.lastFrame + dt); },
    goStudio() { if (A.phase === 'gate') goIntro(); if (A.phase === 'intro') { root.querySelectorAll('.screen.intro').forEach((s) => { gaze.removeWithin(s); s.remove(); }); goSplash(); } if (A.phase === 'splash') goStudio(); },
  };
  goGate();
  requestAnimationFrame((t) => { A.lastFrame = t; frame(t); });
}
