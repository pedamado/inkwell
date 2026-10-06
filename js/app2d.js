// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18 — the 2D app: 18a (InkGaze webcam eye tracker), 18b (mouse cursor) and 18d (hand gestures, webcam)
//   Flow     18a: InkGaze takes over (its settings: Start / Resume → calibration or a saved one) · 18b: Start ·
//            18d: Start the camera → the hand is found (→ calibrate the reach, the first time) → Continue
//            → three dots (look until each pops) → splash (play · About · Help · Configurations) → the studio
//   Input    InkGaze's data stream. 18b runs InkGaze's MOUSE source: the pointer becomes the "gaze" with the same
//            states, saccades and escape saccades, so both variants share every interaction behaviour.
//            18d (hands.js): the index fingertip is the cursor while a hand POINTS (a fist or an open hand never
//            presses or inks); finger poses arm Draw mode and set the thickness, the thumb calls 1–5 random agents,
//            a fist rests (17.1: the line stops the moment the finger folds), an open-palm wave opens Clear Drawing,
//            the back of the hand pulled toward you undoes (17.1), a finger tap clicks. Dwells work as with the eyes.
//   Studio   #paper (the paper, this person's layer — a transparent Surface — and the partners' layers, panned with
//            CSS) · #overlay (grid, agents, menu, reticle, the partners' cursors; on top of everything,
//            pointer-events: none) · #screens (DOM screens) · the Configuration layer
//   Shared   (18, share.js) the windows of this browser in the same room draw together: each person's ink goes to the
//            others as marks (and as a whole layer after undo / redo / clear / open); cursors and settings are shared;
//            the oldest window sets the drawing's proportions (the others fit it, letterboxed); Configuration can show
//            and change a partner's settings (a carer tuning the eye-tracking person's setup, live).
//   View     (18.1) the canvas size: the paper (its layers, the grid, the agents) shown × Z about the window's centre,
//            as if nearer / farther; the menu size: HUD.layout × menuScale, and the DOM screens (CSS zoom). Z = 1 and
//            menuScale = 1 leave every transform and layout exactly as in 18.0.
// ═══════════════════════════════════════════════════════════════════════════
import {
  VERSION, BUILD_NO, VARIANTS, TK, COLORS, SEAT, seatSuffix, loadSettings, saveSettings, defaultsFor, settingsKey, storage, deepMerge, setPath, clamp, withAlpha, unlockAudio,
  viewScale, linkedScale,
} from './core.js';
import { Share, shareSupported } from './share.js';
import { paintMarks } from './marks.js';
import { Surface } from './surface.js';
import { Engine } from './engine.js';
import * as HUD from './hud.js';
import { GazeDom, toast, showGate, showIntro, showSplash, showAbout, showHelp, openConfig, agentsEditor, variantTitle, showReach, menuScaleDom } from './ui.js';
import { t, has, onLanguage, setLanguage, langMeta } from './i18n.js';
import { saveSession, recentSessions, pickSessionFile, parseSession, applySession } from './sessions.js';

const THICK_BY_N = { 1: 'thin', 2: 'medium', 3: 'thick' };   // 18d: fingers pointing → line thickness

export function runApp2D(variant) {
  const isA = variant.id === 'a', isD = variant.id === 'd';
  const cfg = loadSettings(variant);
  if (Array.isArray(cfg.agents)) cfg.boidCount = cfg.agents.length;
  const paperHost = document.getElementById('paper'), overlay = document.getElementById('overlay'), root = document.getElementById('screens');
  const octx = overlay.getContext('2d');
  const gaze = new GazeDom(cfg);
  let W = 0, H = 0, DPR = 1, L = null, surface = null, engine = null, ig = null, gate = null;
  let Z = viewScale(cfg.canvasScale);   // 18.1: the canvas size (screen px per surface px)
  const A = {
    phase: 'boot',          // boot · gate · intro · splash · studio
    paused: true,           // the tracker is not delivering gaze (its dialog / calibration is open, or not started)
    trackerState: '', lost: false,
    raw: null, gaze: null, degS: 0, state: 'lost', blinkMs: 0, holdT: 0, held: null,
    ghost: { x: 0, y: 0 }, pan: { x: 0, y: 0 }, panKey: '', space: false, drag: false,
    cfgUI: null, page: null, orbit: null, reach: null, lastFrame: performance.now(), lastClearTap: -1e9, recentreHinted: false,
  };
  // 18d: the hand tracker (hands.js, loaded on Start) and what the app keeps of it
  let hands = null, HM = null, camEl = null;
  const HS = { status: 'idle', reason: '', present: false, pointing: false, thumb: false, chip: null, seenT: 0 };
  // 18: the shared drawing — the room, the paper under the layers, the partners' layers, the room's proportions
  let share = null;
  const SH = { aspect: null, world: null, layers: new Map(), noticeT: 0, cfgT: 0, cmdT: 0 };
  document.body.classList.add('v-' + variant.id);

  // ---------------------------------------------------------------------------------------------- canvases + surface
  function setupCanvases() {
    W = window.innerWidth; H = window.innerHeight; DPR = Math.min(2, window.devicePixelRatio || 1);
    overlay.width = Math.round(W * DPR); overlay.height = Math.round(H * DPR);
    overlay.style.width = W + 'px'; overlay.style.height = H + 'px';
    L = HUD.layout(W, H, cfg);
    menuScaleDom(cfg.menuScale);   // 18.1: the screens (nothing is set at ×1); what this window holds
  }
  // the drawing's size: the window — or, shared (18), the room's proportions fitted in the window (letterboxed)
  function worldSize() {
    const ws = cfg.panEnabled ? cfg.worldScale : 1;
    let w = W, h = H;
    if (SH.aspect) { if (W / H > SH.aspect) w = H * SH.aspect; else h = W / SH.aspect; }
    return { w: w * ws, h: h * ws };
  }
  function buildSurface(keep) {
    const { w, h } = worldSize();
    if (engine) { engine.penUp('resize'); engine.endGridLine(); }
    const s = new Surface({ width: w, height: h, scale: DPR, bg: null });   // 18: a transparent layer over the paper
    if (keep) s.copyFrom(keep);
    surface = s;
    const cv = s.tiles[0].canvas;
    cv.style.width = s.width + 'px'; cv.style.height = s.height + 'px'; cv.className = 'layer mine';
    if (!SH.world) { SH.world = document.createElement('div'); SH.world.className = 'world'; }
    SH.world.style.width = s.width + 'px'; SH.world.style.height = s.height + 'px';
    paperHost.replaceChildren(SH.world, cv);
    for (const ly of SH.layers.values()) { sizeLayer(ly); paperHost.append(ly.cv); }
    stackLayers();
    A.pan = { x: (s.width - W / Z) / 2, y: (s.height - H / Z) / 2 }; A.panKey = '';
    letterbox();
    if (engine) engine.surface = s;
    if (share && share.active && SH.layers.size) for (const id of SH.layers.keys()) share.need(id);   // their ink again, at the new size
  }
  function placePaper() {   // A.pan: the surface point at the window's top left; the paper is shown × Z (18.1)
    const px = Math.round(A.pan.x * Z), py = Math.round(A.pan.y * Z), key = px + ',' + py + ',' + Z;
    if (key === A.panKey) return;
    A.panKey = key;
    const tr = `translate(${-px}px, ${-py}px)` + (Z !== 1 ? ` scale(${Z})` : '');
    for (const el of paperHost.children) el.style.transform = tr;
  }
  function panBy(dx, dy) {   // screen px; a drawing smaller than the view (letterboxed, or the canvas scaled down) stays centred
    const vw = W / Z, vh = H / Z;
    A.pan.x = surface.width <= vw ? (surface.width - vw) / 2 : clamp(A.pan.x + dx / Z, 0, surface.width - vw);
    A.pan.y = surface.height <= vh ? (surface.height - vh) / 2 : clamp(A.pan.y + dy / Z, 0, surface.height - vh);
  }
  function letterbox() { document.body.classList.toggle('letterbox', surface.width * Z < W - 1 || surface.height * Z < H - 1); }
  // 18.1: the view size changed (Configuration → View size, the + / − / 0 keys, a partner's window, a reset): the canvas
  // zooms about the window's centre (the point there stays there), the menu is laid out again, the screens follow
  function applyView() {
    const z = viewScale(cfg.canvasScale);
    if (z !== Z && surface) {
      const cx = A.pan.x + W / 2 / Z, cy = A.pan.y + H / 2 / Z;
      Z = z; A.pan.x = cx - W / 2 / Z; A.pan.y = cy - H / 2 / Z; panBy(0, 0);
    } else Z = z;
    A.panKey = '';
    if (surface) letterbox();
    if (engine) engine.eyePpd = cfg.ppd / Z;   // the eyes' tolerances stay in degrees of the view
    L = HUD.layout(W, H, cfg);
    menuScaleDom(cfg.menuScale);
  }
  // + / − (both sizes when linked) · 0 (both back to ×1): quick tests by a carer or a developer
  function nudgeView(dir) {
    if (dir === 0) { onCfgChange('canvasScale', 1); if (cfg.menuScale !== 1) onCfgChange('menuScale', 1); }
    else onCfgChange('canvasScale', Math.round(viewScale(cfg.canvasScale + dir * 0.05) * 100) / 100);
    toast(t('toast.view', { canvas: viewScale(cfg.canvasScale).toFixed(2), menu: viewScale(cfg.menuScale).toFixed(2) }), 2200);
  }
  // the partners' layers: one canvas each, the size of this window's surface, stacked oldest first (as everywhere)
  function layerFor(p) {
    let ly = SH.layers.get(p.id);
    if (ly) return ly;
    const cv = document.createElement('canvas'); cv.className = 'layer'; cv.setAttribute('aria-hidden', 'true');
    ly = { cv, ctx: cv.getContext('2d'), wait: null, queue: [] };
    sizeLayer(ly); SH.layers.set(p.id, ly); paperHost.append(cv); stackLayers();
    return ly;
  }
  function sizeLayer(ly) {
    ly.cv.width = Math.round(surface.width * DPR); ly.cv.height = Math.round(surface.height * DPR);
    ly.cv.style.width = surface.width + 'px'; ly.cv.style.height = surface.height + 'px'; A.panKey = '';
  }
  function dropLayer(id) { const ly = SH.layers.get(id); if (ly) { ly.cv.remove(); SH.layers.delete(id); } }
  function stackLayers() {
    const order = share && share.active ? share.members().map((m) => m.id) : [];
    const z = (id) => 1 + Math.max(0, order.indexOf(id));
    if (surface) surface.tiles[0].canvas.style.zIndex = share ? z(share.id) : 1;
    for (const [id, ly] of SH.layers) ly.cv.style.zIndex = z(id);
    A.panKey = '';
  }
  const recentrePan = () => { A.pan = { x: (surface.width - W / Z) / 2, y: (surface.height - H / Z) / 2 }; };

  // ---------------------------------------------------------------------------------------------- settings
  let saveT = 0;
  function persist() { clearTimeout(saveT); saveT = setTimeout(() => saveSettings(variant, cfg), 250); publishCfg(); }
  function agentsToCfg() { cfg.agents = engine.S.boids.map((b) => b.props()); cfg.boidCount = cfg.agents.length; }
  function onCfgChange(k, v, remote = false) {
    const linked = remote ? null : linkedScale(cfg, k, v);   // 18.1: the two view sizes move together (a partner sends both)
    if (v !== undefined && k !== 'boids' && k !== 'preset') setPath(cfg, k, v);
    if (linked) setPath(cfg, linked[0], linked[1]);
    if (k === 'lineMode') engine.setLineMode(v);
    else if (k === 'thickness') engine.setThickness(v);
    else if (k === 'color') engine.setColor(v);
    else if (k === 'gridMode') engine.setGridMode(v);
    else if (k.startsWith('lineParams')) engine.applyLineMode();
    else if (k === 'escapeAmplitude') { if (ig) ig.setOptions({ escapeAmplitude: v }); }
    else if (k === 'panEnabled' || k === 'worldScale') buildSurface(surface);
    else if (k === 'hitPad') L = HUD.layout(W, H, cfg);
    else if (k === 'ppd') { engine.ppd = v; engine.eyePpd = v / Z; }
    else if (k === 'canvasScale' || k === 'menuScale') applyView();
    else if (k === 'shareOn') { if (v) startShare(); else stopShare(); }
    else if (k === 'shareRoom') { if (share) { stopShare(); startShare(); } }
    else if (k === 'shareName') { if (share) share.announce(); }
    else if (k === 'handCameraId') { if (hands && hands.running) hands.restart(); }
    if (k === 'color' && share) share.announce();
    if (k === 'boids' || k === 'preset') agentsToCfg();
    if (linked && A.cfgUI && !A.cfgTarget) A.cfgUI.sync();   // the other slider moves too
    persist();
  }
  function replaceCfg(next) { for (const k of Object.keys(cfg)) delete cfg[k]; Object.assign(cfg, next); }
  function afterCfgSwap(boids) {
    engine.applyLineMode(); engine.ppd = cfg.ppd; applyView();
    if (boids && boids.length) { cfg.boidCount = boids.length; engine.spawnBoids(boids); } else engine.spawnBoids(Array.isArray(cfg.agents) && cfg.agents.length === cfg.boidCount ? cfg.agents : null);
    agentsToCfg();
    if (isD) HS.thumb = engine.S.boids.length > 0;   // an opened drawing's agents stay until the thumb says otherwise
    if (ig) ig.setOptions({ escapeAmplitude: cfg.escapeAmplitude });
    persist();
  }

  // ---------------------------------------------------------------------------------------------- the shared drawing (18)
  const myName = () => (cfg.shareName || '').trim() || t('variant.' + variant.id);
  const shareInfo = () => ({ variant: variant.id, seat: SEAT, name: myName(), color: cfg.color, aspect: SH.aspect || W / H });
  const peerColour = (info) => { const hex = (COLORS[info && info.color] || COLORS.black).hex; return hex === '#ffffff' ? TK.muted : hex; };
  const peerLabel = (info) => (info.name || t('variant.' + info.variant)) + ' · ' + BUILD_NO + info.variant + (info.seat > 1 ? ' (' + info.seat + ')' : '');
  function startShare() {
    if (share || !cfg.shareOn || !shareSupported()) return;
    share = new Share({ room: (cfg.shareRoom || 'studio').trim() || 'studio', info: shareInfo, on: {
      peer: onPeer, ink: onPeerInk, layer: onPeerLayer, need: (p) => sendLayer(p.id), cfg: onPeerCfg, set: onRemoteSet, cmd: onRemoteCmd,
      clearall: () => engine.clear(),
    } });
    share.start();
  }
  function stopShare() {
    if (!share) return;
    share.stop(); share = null;
    for (const id of [...SH.layers.keys()]) dropLayer(id);
    stackLayers();
    if (A.cfgTarget) { A.cfgTarget = null; reopenConfig(); }
  }
  function onPeer(p, kind) {
    if (kind === 'join') {
      fixAspect();
      layerFor(p);
      share.need(p.id);   // its drawing so far
      publishCfg(true);   // my settings, for its configuration
      colourCheck();
      toast(t('toast.joined', { name: peerLabel(p.info) }), 3800);
      if (p.info.variant === variant.id && (p.info.seat || 1) === SEAT) toast(t('toast.sameSeat', { variant: BUILD_NO + variant.id, seat: SEAT + 1 }), 9000);
    } else if (kind === 'leave') {
      dropLayer(p.id);
      toast(t('toast.left', { name: peerLabel(p.info) }), 3800);
      if (A.cfgTarget === p.id) { A.cfgTarget = null; reopenConfig(); }
    }
    stackLayers();
    if (kind !== 'update' && A.cfgUI && !A.cfgTarget) refreshConfig();   // the people listed in Configuration
  }
  // the oldest window sets the drawing's proportions for the room; the others fit them (once set, kept)
  function fixAspect() {
    if (SH.aspect || !share) return;
    const oldest = share.members()[0];
    SH.aspect = oldest.id === share.id ? W / H : (oldest.aspect || W / H);
    share.announce();
    if (Math.abs(SH.aspect - surface.width / surface.height) > 0.004) { buildSurface(surface); sendLayer(); }
  }
  // two people, two colours: a newcomer whose colour an older window already uses takes the first free one
  function colourCheck() {
    if (!share) return;
    const mine = share.me(), taken = new Set(share.members().filter((m) => m.id !== mine.id && m.joinedAt <= mine.joinedAt).map((m) => m.color));
    if (!taken.has(cfg.color)) return;
    const free = ['black', 'red', 'blue'].find((c) => !taken.has(c));
    if (!free) return;
    onCfgChange('color', free);
    toast(t('toast.colour', { color: t('hud.color.' + free) }), 4200);
  }
  function onPeerInk(p, Wa, marks) {
    const ly = layerFor(p);
    if (ly.wait) { ly.queue.push([Wa, marks]); return; }   // a layer image is still being decoded: after it
    paintMarks(ly.ctx, marks, surface.width / (Wa || surface.width), DPR);
  }
  async function onPeerLayer(p, Wa, img) {
    const ly = layerFor(p);
    let bmp = img;
    if (!(img instanceof ImageBitmap)) {
      ly.wait = createImageBitmap(img);
      try { bmp = await ly.wait; } catch (e) { bmp = null; }
      ly.wait = null;
    }
    const c = ly.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ly.cv.width, ly.cv.height);
    if (bmp) { c.drawImage(bmp, 0, 0, ly.cv.width, ly.cv.height); try { bmp.close(); } catch (e) { /* done */ } }
    for (const [w, marks] of ly.queue.splice(0)) paintMarks(c, marks, surface.width / (w || surface.width), DPR);
  }
  function sendLayer(to = null) { if (share && share.active) share.layer(surface.tiles[0].canvas, surface.width, to); }
  // my settings for the others' Configuration (+ the eye tracker's or the hand tracker's status)
  function publishCfg(now = false) {
    if (!share || !share.active) return;
    clearTimeout(SH.cfgT);
    const send = () => {
      const extra = { key: variant.key + seatSuffix };
      if (isA && ig) { try { const q = ig.quality() || {}, rt = q.runtime || {}; extra.tracker = { calibrated: !!q.calibrated, points: q.points || 0, model: q.model || '', fps: Math.round(rt.fps || 0) }; } catch (e) { /* not ready */ } }
      if (isD) extra.hands = { running: !!(hands && hands.running), fps: hands ? Math.round(hands.fps || 0) : 0, delegate: hands ? hands.delegate : '', cameras: hands ? hands.cameras : [] };
      share.cfg(JSON.parse(JSON.stringify(cfg)), extra);
    };
    if (now) send(); else SH.cfgT = setTimeout(send, 100);
  }
  function onPeerCfg(p) {   // a partner's settings changed: refresh its Configuration if it is open here
    if (!A.cfgUI || A.cfgTarget !== p.id) return;
    const n = Array.isArray(p.cfg.agents) ? p.cfg.agents.length : 0;
    if (n !== A.cfgAgents || performance.now() - SH.cmdT < 1500) refreshConfig(); else A.cfgUI.sync();
  }
  // a partner changes one of my settings (never the room itself: that would end the shared drawing)
  const REMOTE_BLOCK = new Set(['shareOn', 'shareRoom', 'agents', 'handBox']);
  function onRemoteSet(k, v, p) {
    if (REMOTE_BLOCK.has(k) || typeof k !== 'string') return;
    onCfgChange(k, v, true);
    if (A.cfgUI && !A.cfgTarget) A.cfgUI.sync();
    remoteNotice(p);
  }
  function onRemoteCmd(cmd, arg, p) {
    const boids = () => { onCfgChange('boids'); if (A.cfgUI && !A.cfgTarget) refreshConfig(); };
    switch (cmd) {
      case 'preset': engine.applyPreset(arg); onCfgChange('preset', arg); if (A.cfgUI && !A.cfgTarget) refreshConfig(); break;
      case 'agents': if (Array.isArray(arg)) arg.forEach((pr, i) => { const b = engine.S.boids[i]; if (b && pr) Object.assign(b, pr); }); boids(); break;
      case 'addBoid': engine.addBoid(); boids(); break;
      case 'removeBoid': engine.removeBoid(arg); boids(); break;
      case 'randomizeBoid': engine.randomizeBoid(arg); boids(); break;
      case 'resetBoid': engine.resetBoid(arg); boids(); break;
      case 'randomizeAll': engine.randomizeAll(); boids(); break;
      case 'reset': resetCfg(); break;
      case 'clearSaved': storage.del(settingsKey(variant)); break;
      case 'tracker': if (isA && ig) { if (arg === 'recenter') ig.recenter(); else if (arg === 'cal5') ig.calibrate({ layout: '5' }); else if (arg === 'cal9') ig.calibrate({ layout: '9' }); else if (arg === 'settings') ig.openSettings(); } break;
      case 'reach': if (isD) openReach(); break;
      case 'reachReset': if (isD) { cfg.handBox = null; persist(); } break;
      case 'clear': engine.clear(); break;
      default: return;
    }
    publishCfg(); remoteNotice(p);
  }
  function remoteNotice(p) {   // the person sees that someone tuned their setup (at most every 6 s)
    const now = performance.now();
    if (now - SH.noticeT < 6000) return;
    SH.noticeT = now; toast(t('toast.remoteSet', { name: p.info.name || t('variant.' + p.info.variant) }), 3000);
  }
  function resetCfg() {   // defaults again — but the room, the name and this window's camera stay
    const keep = { shareOn: cfg.shareOn, shareRoom: cfg.shareRoom, shareName: cfg.shareName, handCameraId: cfg.handCameraId, handBox: cfg.handBox };
    replaceCfg(Object.assign(defaultsFor(variant), keep)); afterCfgSwap(null); buildSurface(surface); toast(t('toast.defaults'));
    if (A.cfgUI && !A.cfgTarget) refreshConfig();
  }

  // ---------------------------------------------------------------------------------------------- input (InkGaze)
  function startInput() {
    const IG = window.InkGaze;
    if (!IG) { toast(t('toast.libMissing'), 8000); return; }
    let devMouse = false; try { devMouse = new URLSearchParams(location.search).get('source') === 'mouse'; } catch (e) { /* no URL */ }
    ig = isA   // 18a?source=mouse: InkGaze's own flow without a camera (development; nothing is saved to its settings)
      ? new IG(Object.assign({ storageKey: 'inkwell18.inkgaze' + seatSuffix, escapeAmplitude: cfg.escapeAmplitude }, devMouse ? { source: 'mouse', persist: false } : {}))
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
    if (isA && s.state === 'tracking' && A.phase === 'gate') goIntro();   // 18b waits for its Start
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
  const aiming = () => live() && (!isD || HS.pointing);   // 18d: only a POINTING hand aims (dwells, inks)
  const onScreen = (p) => ({ x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) });
  function learn(x, y) { if (isA && ig) { try { ig.learn(x, y); } catch (e) { /* not calibrated */ } } }
  gaze.onFire = (el) => { const r = el.getBoundingClientRect(); learn(r.left + r.width / 2, r.top + r.height / 2); };

  // ---------------------------------------------------------------------------------------------- input (hands, 18d)
  async function ensureHands() {
    if (hands) return hands;
    HM = await import('./hands.js');
    hands = new HM.HandInput({ cfg, on: { status: onHandStatus, pose: onHandPose, wave: onHandWave, pull: onHandPull, tap: onHandTap, reach: onReachDone, frame: onHandFrame } });
    camEl = document.createElement('canvas'); camEl.id = 'handcam'; camEl.width = 320; camEl.height = 240; camEl.hidden = true;
    camEl.setAttribute('aria-hidden', 'true'); document.body.append(camEl);
    window.addEventListener('pagehide', () => { try { hands.destroy(); } catch (e) { /* closing */ } });
    return hands;
  }
  async function startHands() {
    unlockAudio();
    try { await ensureHands(); } catch (e) { onHandStatus({ state: 'error', reason: (e && e.message) || String(e) }); return; }
    hands.start();
  }
  function onHandStatus(s) {
    const prev = HS.status;
    HS.status = s.state; HS.reason = s.reason || '';
    A.paused = !['ready', 'tracking'].includes(s.state);
    if (A.phase === 'gate' && gate && prev !== s.state) renderGate();
  }
  function onHandFrame(h) {
    HS.present = h.present; HS.pointing = h.pointing;
    if (h.present) { HS.seenT = performance.now(); if (h.cursor) A.raw = { x: h.cursor.x, y: h.cursor.y }; }
    A.state = !h.present ? 'lost' : h.pointing ? 'fixation' : 'rest';
    drawHandCam(h);
  }
  // the stable pose changed: only the studio acts on it (screens and dialogs are worked by dwell and tap)
  function onHandPose(p, prev) { if (A.phase === 'studio' && !overlayOpen() && !A.orbit) applyHandPose(p, prev); }
  function applyHandPose(p, prev) {
    if (p && p.pose === 'point') {
      const was = prev && prev.pose === 'point';
      if (!was) engine.setDrawMode(true);   // pointing arms Draw mode (the menu's Press to Pause still works until the next pose)
      if (!was || prev.n !== p.n) engine.setThickness(THICK_BY_N[p.n]);
      if (p.thumb !== HS.thumb) {           // thumb out: a new random orchestra · thumb in: the line pauses, the pen is direct
        HS.thumb = p.thumb;
        if (p.thumb) orchestra(); else { engine.penUp('thumb'); direct(); }
      }
      chip(p);
    } else if (p && p.pose === 'fist') {    // a closed hand rests: the line stops, Draw mode off, the agents go
      engine.penUp('fist'); engine.endGridLine(); engine.setDrawMode(false);
      if (HS.thumb) { HS.thumb = false; direct(); }
      if (!prev || prev.pose !== 'back') chip(p);   // (folds inside an undo pull are not announced)
    } else {
      engine.penUp(p ? p.pose : 'lost');
      const undoShown = HS.chip && HS.chip.undo && performance.now() - HS.chip.t < 1500;   // keep "Undo" readable
      if (p && (p.pose === 'palm' || (p.pose === 'back' && !undoShown))) chip(p);
    }
  }
  function orchestra() { const ps = HM.randomOrchestra(); cfg.boidCount = ps.length; engine.spawnBoids(ps); }
  function direct() { cfg.boidCount = 0; engine.spawnBoids(null); }
  function chip(p) { HS.chip = { text: chipText(p), t: performance.now() }; }
  function chipText(p) {
    if (p.pose === 'fist') return t('hand.chip.rest');
    if (p.pose === 'palm') return t('hand.chip.palm');
    if (p.pose === 'back') return t('hand.chip.back');
    const th = t('hud.thickness.' + THICK_BY_N[p.n]), n = engine.S.boids.length;
    return !p.thumb ? t('hand.chip.direct', { thickness: th }) : t(n === 1 ? 'hand.chip.agent' : 'hand.chip.agents', { thickness: th, n });
  }
  // an open hand waved (left → right → left): Clear Drawing? (the confirmation still needs a point + dwell or a tap)
  function onHandWave() {
    if (A.phase !== 'studio' || overlayOpen() || A.orbit || engine.S.modal) return;
    engine.penUp('wave'); engine.endGridLine();
    engine.openModal({ type: 'clear' });
    toast(t('toast.waveClear'), 4600);
  }
  // 17.1: the back of the hand pulled toward you (undoPulls times, 2 by default) = Undo — your last line
  function onHandPull() {
    if (A.phase !== 'studio' || overlayOpen() || A.orbit || engine.S.modal) return;
    engine.S.submenu = null;
    engine.undo();
    HS.chip = { text: t('hand.chip.undo'), t: performance.now(), undo: true };
  }
  // a finger tap = a click where the tap began (as the mouse click in 18b)
  function onHandTap(pt) {
    if (!pt || A.orbit || A.reach) return;
    if (A.phase === 'studio' && !overlayOpen()) {
      const id = HUD.hit(L, engine.S, pt);
      if (id && /^(btn|opt|modal):/.test(id) && id !== 'modal:panel') {
        if (id === 'modal:file') { toast(t('toast.fileDwell'), 5200); return; }   // a file dialog needs a real click
        engine.activate(id);
        engine.S.needLeave = id; engine.S.dwell = { id: null, t: 0, lastIn: 0 };
      } else if (id === 'scrim' || id === 'scrim-far') { if (engine.S.modal) engine.activate('modal:cancel'); else engine.S.submenu = null; }
      return;
    }
    gaze.press(pt);   // the screens: the dwell target under the fingertip fires at once
  }
  // the camera preview (top left): always on the first screen, then as set in Configuration (h toggles it)
  function drawHandCam(h) {
    if (A.reach) { hands.drawPreview(A.reach.scr.canvas, { sweep: hands.reachSweep(), label: poseLabel(h) }); A.reach.scr.progress(hands.reachProgress); }
    if (!camEl) return;
    const show = (cfg.handPreview !== false || A.phase === 'gate') && !A.reach && !A.orbit && !A.page && HS.status !== 'idle';   // (a page's Back button sits there)
    if (camEl.hidden === show) camEl.hidden = !show;
    if (!show) return;
    const v = hands.video;
    if (v && v.videoWidth && !camEl.dataset.sized) { camEl.height = Math.round(camEl.width * v.videoHeight / v.videoWidth); camEl.dataset.sized = '1'; }
    hands.drawPreview(camEl, { label: poseLabel(h) });
  }
  function poseLabel(h) {
    const p = h.pose;
    if (!h.present || !p) return t('hand.pose.none');
    if (p.pose === 'point') return t('hand.pose.point' + p.n) + (p.thumb ? ' + ' + t('hand.pose.thumb') : '');
    return t('hand.pose.' + p.pose);
  }
  // the reach: a 5-s sweep with the pointing finger sets the part of the camera view that covers the screen
  function openReach() {
    if (!hands || A.reach || !hands.running) return;
    if (engine) { engine.penUp('reach'); engine.endGridLine(); }
    closeConfig();
    cover(true); if (gate) gate.el.inert = true;
    const scr = showReach({ root, onCancel: () => closeReach() });
    const v = hands.video;
    if (v && v.videoWidth) scr.canvas.height = Math.round(scr.canvas.width * v.videoHeight / v.videoWidth);
    A.reach = { scr };
    hands.startReach(5000);
  }
  function onReachDone(box) {
    if (box) { cfg.handBox = box; persist(); toast(t('reach.done'), 4200); } else toast(t('reach.tooSmall'), 5200);
    closeReach();
  }
  function closeReach() {
    if (!A.reach) return false;
    if (hands) hands.cancelReach();
    A.reach.scr.close(); A.reach = null;
    if (gate) gate.el.inert = false;
    cover(false);
    if (A.phase === 'gate') renderGate();   // Continue becomes the main button
    return true;
  }
  function handsPanel() {
    const box = document.createElement('div'); box.className = 'tracker-panel';
    const info = document.createElement('p'); info.className = 'hint';
    const on = hands && hands.running;
    info.textContent = !on ? t('cfg.hands.notRunning')
      : t('cfg.hands.status', { fps: Math.round(hands.fps || 0), delegate: hands.delegate || '—' }) + ' · ' + t(cfg.handBox ? 'cfg.hands.reachCustom' : 'cfg.hands.reachDefault');
    const row = document.createElement('div'); row.className = 'row wrap';
    const mk = (label, fn, enabled = true) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.disabled = !enabled; b.addEventListener('click', fn); return b; };
    row.append(
      mk(t('cfg.hands.calibrate'), () => { closeConfig(); openReach(); }, !!on),
      mk(t('cfg.hands.reset'), () => { cfg.handBox = null; persist(); toast(t('cfg.hands.resetDone')); reopenConfig(); }, !!cfg.handBox),
    );
    box.append(info, row);
    // 18: two windows, two webcams — this window's camera (the names appear once a camera has been allowed)
    const cams = hands && hands.cameras ? hands.cameras : [];
    if (cams.length) {
      const id = 'cfg-handCamera', sel = document.createElement('select'); sel.id = id;
      sel.append(new Option(t('cfg.hands.cameraDefault'), ''));
      cams.forEach((c, i) => sel.append(new Option(c.label || t('cfg.hands.cameraN', { n: i + 1 }), c.deviceId)));
      sel.value = cfg.handCameraId || '';
      sel.addEventListener('change', () => onCfgChange('handCameraId', sel.value));
      const lab = document.createElement('label'); lab.htmlFor = id; lab.append(Object.assign(document.createElement('span'), { textContent: t('cfg.hands.camera') }));
      const ctl = document.createElement('div'); ctl.className = 'ctl'; ctl.append(lab, sel);
      box.append(ctl);
    }
    box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: t('cfg.hands.help') }));
    return box;
  }

  // ---------------------------------------------------------------------------------------------- the engine
  function makeEngine() {
    engine = new Engine({
      cfg, surface, ppd: cfg.ppd,
      hooks: {
        onChange: (what) => { if (what === 'boids' || what === 'preset') agentsToCfg(); persist(); },
        onOption: (b) => { if (b === 'save') doSave(); else if (b === 'open') doOpen(); else if (b === 'config') openConfigUI(); },
        onFileDwell: () => toast(t('toast.fileDwell'), 5200),
        onDwellDone: (id) => { const c = HUD.targetCentre(L, engine.S, id); if (c) learn(c.x, c.y); },
        onInk: (m) => { if (share && share.active) share.ink(m, surface.width); },   // 18: my ink, to the others
        onLayer: () => sendLayer(),                                                     // 18: undo / redo / clear
      },
    });
    engine.eyePpd = cfg.ppd / Z;   // 18.1
    if (isD) cfg.boidCount = 0;   // 18d: the direct pen; the thumb calls the agents
    engine.spawnBoids(!isD && Array.isArray(cfg.agents) && cfg.agents.length === cfg.boidCount ? cfg.agents : null);
    agentsToCfg();
    engine.S.target = { x: surface.width / 2, y: surface.height / 2 };
  }

  // ---------------------------------------------------------------------------------------------- phases
  function goGate() {
    A.phase = 'gate';
    renderGate();
    if (isD) return;   // 18d: the camera starts with the Start button
    startInput();
    if (!ig) return;
    if (isA) ig.init().then((ok) => { if (!ok && A.phase === 'gate') gateMessage({ state: 'closed' }); });
    else ig.start();
  }
  function gateSpec() {
    if (isD) return handGateSpec();
    if (isA) return {
      message: gateText(A.gateStatus), kind: gateKind(A.gateStatus),
      buttons: [
        { label: t('gate.trackerSettings'), icon: 'eye', click: true, fn: () => { unlockAudio(); if (ig && !ig.openSettings()) ig.init(); } },
        { label: t('gate.useMouse'), icon: 'mouse', click: true, href: VARIANTS.b.page },
      ],
    };
    return { message: t('gate.mouseIntro'), buttons: [{ label: t('gate.start'), icon: 'play', primary: true, fn: () => { unlockAudio(); goIntro(); } }] };
  }
  // 18d: Start the camera (a click: browsers ask for the camera after a gesture) → loading → "show your hand" → once a
  // hand points: Calibrate reach · Continue (dwell or tap with the fingertip, or click)
  function handGateSpec() {
    const st = HS.status, mouse = { label: t('gate.useMouse'), icon: 'mouse', click: true, href: VARIANTS.b.page };
    if (st === 'tracking') return { message: t('gate.hands.status.tracking'), extra: cameraChooser(), buttons: [
      { label: t('gate.hands.calibrate'), icon: 'hand', primary: !cfg.handBox, fn: () => openReach() },
      { label: t('gate.hands.continue'), icon: 'play', primary: !!cfg.handBox, fn: () => goIntro() },
    ] };
    if (st === 'camera' || st === 'model' || st === 'ready') return { message: t('gate.hands.status.' + st), extra: st === 'ready' ? cameraChooser() : null, buttons: [mouse] };
    const failed = ['denied', 'nocamera', 'insecure', 'error'].includes(st);
    return {
      message: failed ? t('gate.hands.status.' + st, { reason: HS.reason }) : t('gate.hands.intro'), kind: failed ? 'error' : '',
      buttons: [{ label: t(failed ? 'gate.hands.retry' : 'gate.hands.start'), icon: 'hand', primary: true, click: true, fn: startHands }, mouse],
    };
  }
  // 18: two webcams on one computer — each window chooses its own (shown once a camera has been allowed)
  function cameraChooser() {
    const cams = hands && hands.cameras ? hands.cameras : [];
    if (cams.length < 2) return null;
    const sel = document.createElement('select'); sel.className = 'cam-select'; sel.setAttribute('aria-label', t('cfg.hands.camera'));
    sel.append(new Option(t('cfg.hands.cameraDefault'), ''));
    cams.forEach((c, i) => sel.append(new Option(c.label || t('cfg.hands.cameraN', { n: i + 1 }), c.deviceId)));
    sel.value = cfg.handCameraId || '';
    sel.addEventListener('change', () => onCfgChange('handCameraId', sel.value));
    const wrap = document.createElement('label'); wrap.className = 'cam-choice';
    wrap.append(Object.assign(document.createElement('span'), { textContent: t('cfg.hands.camera') }), sel);
    return wrap;
  }
  function renderGate() { if (gate) gate.close(true); gate = showGate(Object.assign({ root, gaze, variant, onLanguage: pickLanguage }, gateSpec())); }
  const gateText = (s) => (!s ? t('gate.status.invoked') : s.state === 'error' ? (s.message || t('gate.trackerFailed')) : t('gate.status.' + s.state));
  const gateKind = (s) => (!s ? '' : s.state === 'error' ? 'error' : s.state === 'closed' ? 'warn' : '');
  function gateMessage(s) {   // InkGaze's status while it has the stage (its own error texts are in English)
    if (!gate || (s.state !== 'error' && !has('gate.status.' + s.state))) return;
    A.gateStatus = s;
    gate.setMessage(gateText(s), gateKind(s));
  }
  const introHint = () => t(isA ? 'intro.hintEyes' : isD ? 'intro.hintHand' : 'intro.hintPointer');
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
    if (isD) {   // the hand already points: arm Draw mode now, but where play was cannot start a line (move first)
      HS.thumb = engine.S.boids.length > 0;
      if (hands && hands.pose) applyHandPose(hands.pose, null);
      engine.S.rearm = { t: engine.S.now, at: null };
    }
    unlockAudio();
  }
  const overlayOpen = () => !!(A.cfgUI || A.page || A.reach);
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
  // 18: with partners, Configuration shows "Settings of: this window · each partner" — a partner's settings are shown
  // from what it publishes, and every change is sent to it (applied and saved there, at once)
  function participants() {
    if (!share || !share.active || !share.peers.size) return [];
    return [{ id: null, label: t('cfg.target.me', { name: peerLabel(share.me()) }), color: peerColour(share.me()), on: !A.cfgTarget }]
      .concat([...share.peers.values()].map((p) => ({ id: p.id, label: peerLabel(p.info), color: peerColour(p.info), on: A.cfgTarget === p.id })));
  }
  function onTarget(id) { if ((id || null) === (A.cfgTarget || null)) return; A.cfgTarget = id || null; refreshConfig(0); }
  function openConfigLayer(scrollTop) {
    const peer = A.cfgTarget && share ? share.peers.get(A.cfgTarget) : null;
    if (A.cfgTarget && !peer) A.cfgTarget = null;
    const onClose = () => { A.cfgUI = null; cover(false); if (!A.cfgRefresh) A.cfgTarget = null; };
    if (peer) { openRemoteConfig(peer, scrollTop, onClose); return; }
    A.cfgUI = openConfig({
      variant, cfg, gaze, scrollTop, participants: participants(), onTarget,
      onChange: onCfgChange,
      notes: { menuScale: (v) => (L && v > L.menuMax + 0.004 ? t('cfg.view.capped', { k: L.menuMax.toFixed(2) }) : '') },
      onLanguage: pickLanguage,
      agents: () => agentsEditor({ engine, cfg, onChange: onCfgChange }),
      tracker: isA ? trackerPanel : null,
      hands: isD ? handsPanel : null,
      share: sharePanel,
      onReset: () => { resetCfg(); reopenConfig(); },
      onClearSaved: () => { storage.del(settingsKey(variant)); toast(t('toast.storageCleared', { key: variant.key + seatSuffix }), 4200); },
      links: [
        { label: t('cfg.data.about'), fn: () => { closeConfig(); openPage('about'); } },
        { label: t('cfg.data.help'), fn: () => { closeConfig(); openPage('help'); } },
        A.phase === 'studio' ? { label: t('cfg.data.start'), fn: () => { closeConfig(); goSplash(); } } : null,
      ].filter(Boolean),
      onClose,
    });
  }
  function openRemoteConfig(peer, scrollTop, onClose) {
    const pv = VARIANTS[peer.info.variant] || variant, pcfg = peer.cfg || deepMerge(defaultsFor(pv), {}), ex = peer.extra || {};
    const send = (k, v) => {
      if (k === 'boids' || k === 'preset') return;
      const linked = linkedScale(pcfg, k, v);   // 18.1: linked view sizes — both are sent
      setPath(pcfg, k, v); share.set(peer.id, k, v);
      if (linked) { setPath(pcfg, linked[0], linked[1]); share.set(peer.id, linked[0], linked[1]); if (A.cfgUI) A.cfgUI.sync(); }
    };
    const cmd = (c, a) => { SH.cmdT = performance.now(); share.cmd(peer.id, c, a); };
    const proxy = {   // the agents editor drives this stand-in for the partner's engine
      S: { boids: Array.isArray(pcfg.agents) ? pcfg.agents : [] },
      applyPreset: (k) => cmd('preset', k), addBoid: () => cmd('addBoid'), removeBoid: (i) => cmd('removeBoid', i),
      randomizeBoid: (i) => cmd('randomizeBoid', i), resetBoid: (i) => cmd('resetBoid', i), randomizeAll: () => cmd('randomizeAll'),
    };
    A.cfgAgents = proxy.S.boids.length;
    const btnPanel = (info, buttons, help) => () => {
      const box = document.createElement('div'); box.className = 'tracker-panel';
      box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: info }));
      const row = document.createElement('div'); row.className = 'row wrap';
      for (const [label, fn] of buttons) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.addEventListener('click', fn); row.append(b); }
      box.append(row);
      if (help) box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: help }));
      return box;
    };
    const trk = ex.tracker, hnd = ex.hands;
    A.cfgUI = openConfig({
      variant: pv, cfg: pcfg, gaze, scrollTop, participants: participants(), onTarget, remote: { name: peerLabel(peer.info), key: ex.key || pv.key },
      onChange: send, onLanguage: null,
      agents: () => agentsEditor({ engine: proxy, cfg: pcfg, onChange: (k, v) => { if (k === 'boids') cmd('agents', proxy.S.boids.map((b) => ({ speed: b.speed, spring: b.spring, damp: b.damp, mass: b.mass, jitter: b.jitter }))); else send(k, v); } }),
      tracker: pv.id === 'a' ? btnPanel(!trk ? t('cfg.tracker.notRunning') : trk.calibrated ? t('cfg.tracker.calibrated', { points: trk.points || '?', model: trk.model || '' }) + (trk.fps ? t('cfg.tracker.fps', { fps: trk.fps }) : '') : t('cfg.tracker.notCalibrated'),
        [[t('cfg.tracker.recentre'), () => cmd('tracker', 'recenter')], [t('cfg.tracker.cal5'), () => cmd('tracker', 'cal5')], [t('cfg.tracker.cal9'), () => cmd('tracker', 'cal9')], [t('cfg.tracker.settings'), () => cmd('tracker', 'settings')]],
        t('cfg.remote.trackerHelp')) : null,
      hands: pv.id === 'd' ? btnPanel(hnd && hnd.running ? t('cfg.hands.status', { fps: hnd.fps, delegate: hnd.delegate || '—' }) : t('cfg.hands.notRunning'),
        [[t('cfg.hands.calibrate'), () => cmd('reach')], [t('cfg.hands.reset'), () => cmd('reachReset')]], t('cfg.remote.handsHelp')) : null,
      share: null,
      onReset: () => cmd('reset'), onClearSaved: () => cmd('clearSaved'),
      links: [{ label: t('cfg.remote.clearTheirs'), fn: () => cmd('clear') }],
      onClose,
    });
  }
  function closeConfig() { if (!A.cfgUI) return false; A.cfgUI.close(); return true; }
  function reopenConfig() { closeConfig(); openConfigUI(); }
  function refreshConfig(scroll) {   // re-render in place (the same person, the same scroll)
    if (!A.cfgUI) return;
    const st = scroll != null ? scroll : A.cfgUI.scrollTop;
    A.cfgRefresh = true; closeConfig(); A.cfgRefresh = false;
    openConfigUI(st);
  }
  // Configuration → Shared drawing: who is in the room, their settings, clearing everyone's drawing
  function sharePanel() {
    const box = document.createElement('div'); box.className = 'share-panel';
    const people = share && share.active ? share.members() : [];
    if (!share || !share.active) box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: cfg.shareOn ? t('cfg.share.unsupported') : t('cfg.share.off') }));
    else if (people.length < 2) box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: t('cfg.share.none', { room: share.room }) }));
    else {
      box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: t('cfg.share.people', { room: share.room }) }));
      const list = document.createElement('div'); list.className = 'people';
      for (const m of people) {
        const row = document.createElement('div'); row.className = 'person';
        const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = peerColour(m);
        const name = document.createElement('span'); name.className = 'pname'; name.textContent = peerLabel(m) + (m.id === share.id ? ' — ' + t('cfg.share.you') : '');
        row.append(dot, name);
        if (m.id !== share.id) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = t('cfg.share.edit'); b.addEventListener('click', () => onTarget(m.id)); row.append(b); }
        list.append(row);
      }
      const clr = document.createElement('button'); clr.type = 'button'; clr.className = 'btn ghost'; clr.textContent = t('cfg.share.clearAll');
      clr.addEventListener('click', () => { engine.clear(); share.clearAll(); toast(t('cfg.share.clearAllDone'), 4200); });
      box.append(list, clr);
    }
    box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: t('cfg.share.help') }));
    return box;
  }
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
      const r = await saveSession({ variant, cfg, engine, surface, inkgaze: isA ? ig : null, compose });
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
  // the drawing as everyone sees it: the paper, then every layer in the room's order (18)
  function compose(maxW = 8192) {
    const k = Math.min(1, maxW / (surface.width * DPR)), cw = Math.max(1, Math.round(surface.width * DPR * k)), ch = Math.max(1, Math.round(surface.height * DPR * k));
    const out = document.createElement('canvas'); out.width = cw; out.height = ch;
    const g = out.getContext('2d'); g.fillStyle = TK.bgCanvas; g.fillRect(0, 0, cw, ch);
    const order = share && share.active ? share.members().map((m) => m.id) : [];
    const canvases = [{ id: share ? share.id : '', cv: surface.tiles[0].canvas }].concat([...SH.layers].map(([id, ly]) => ({ id, cv: ly.cv })));
    canvases.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    for (const l of canvases) g.drawImage(l.cv, 0, 0, cw, ch);
    return out;
  }
  // an opaque drawing (a saved composite, or a session of builds 16–17) into this transparent layer: the paper colour
  // becomes transparent, so the partners' ink below stays visible
  function keyOutPaper(img) {
    const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), a = d.data, [pr, pg, pb] = [250, 249, 247];
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - pr) <= 3 && Math.abs(a[i + 1] - pg) <= 3 && Math.abs(a[i + 2] - pb) <= 3) a[i + 3] = 0;
    g.putImageData(d, 0, 0);
    return c;
  }
  async function openSession(json) {
    engine.closeModal();
    const s = parseSession(json);
    if (!s || s.error) { toast(s && s.error ? t(s.error) : t('toast.nothingOpened'), 4200); return; }
    engine.penUp('open'); engine.endGridLine();
    const before = cfg.panEnabled + ':' + cfg.worldScale;
    const keep = { shareOn: cfg.shareOn, shareRoom: cfg.shareRoom, shareName: cfg.shareName, handCameraId: cfg.handCameraId, handBox: cfg.handBox,
      canvasScale: cfg.canvasScale, menuScale: cfg.menuScale, scaleLink: cfg.scaleLink };   // 18.1: the view size is this person's
    const r = await applySession(s, {
      variant, cfg, engine, getSurface: () => surface, inkgaze: isA ? ig : null, prepare: keyOutPaper,
      applyCfg: (next, boids) => {
        replaceCfg(deepMerge(defaultsFor(variant), Object.assign({}, next, keep)));   // the room and the camera stay
        afterCfgSwap(boids);
        if (before !== cfg.panEnabled + ':' + cfg.worldScale) buildSurface(null);
      },
    });
    sendLayer();   // 18: the opened drawing, to the others
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
    const ok = aiming(), g = ok ? onScreen(A.gaze) : null;
    const hudId = g ? HUD.hit(L, engine.S, g) : null;
    let surf = null;
    if (g && !hudId) {
      ghost(g, dt);
      const hold = A.holdT && now - A.holdT < 100;   // 18a: a saccade in flight: hold the pen until the escape check
      if (!hold || !A.held) A.held = { x: clamp(A.ghost.x / Z + A.pan.x, 0, surface.width), y: clamp(A.ghost.y / Z + A.pan.y, 0, surface.height) };
      surf = A.held;
    }
    engine.update({ now, dt, hudId, overHud: !!hudId, surf, gazeDegS: A.degS, blinkMs: A.blinkMs, lost: !ok });
    if (share && share.active) {   // 18: where I am, for the others (world units: surface px / surface width)
      if (!g) share.cursor(0, 0, 'off');
      else share.cursor(clamp(g.x / Z + A.pan.x, 0, surface.width) / surface.width, clamp(g.y / Z + A.pan.y, 0, surface.height) / surface.width,
        hudId ? 'menu' : HUD.cursorState(engine) === 'drawing' ? 'draw' : engine.S.drawMode ? 'armed' : 'rest');
    }
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
      else { gaze.update(aiming() && !A.reach ? onScreen(A.gaze) : null, dt, now); if (share && share.active) share.cursor(0, 0, 'off'); }
      if (share && share.active) share.flush();
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
      else if (isD && hands && hands.running && !HS.present && performance.now() - HS.seenT > 1000) badge(c, t('badge.handLost'));
      if (share && share.active && share.peers.size) { if (cfg.showPartners !== false) drawPartners(c); drawRoom(c); }
    }
    if (A.reach || !live()) return;
    const g = onScreen(A.gaze);
    if (isD && !HS.pointing) { handRest(c, g, studio); if (studio) drawChip(c, g); return; }   // seen, not pointing
    if (studio) { HUD.reticle(c, g.x, g.y, engine, { r: 30 }); if (isD) drawChip(c, g); }
    else if ((isA || isD) && cfg.cursorPaused !== false) {   // the screens: the paused cursor (a dashed 40 %-black circle)
      c.save(); c.setLineDash([5, 6]); c.lineWidth = 2; c.strokeStyle = 'rgba(25,24,23,0.4)'; c.beginPath(); c.arc(g.x, g.y, 24, 0, Math.PI * 2); c.stroke(); c.restore();
    }
  }
  // 18d: the hand is seen but does not point (a fist, an open hand): a small dotted ring — it neither presses nor inks.
  // In the studio an open palm shows the wave's progress (a dot per swing; two open Clear Drawing), the back of the
  // hand the pulls' progress (a dot per pull; undoPulls of them undo).
  function handRest(c, g, studio) {
    c.save(); c.setLineDash([2, 5]); c.lineWidth = 2; c.strokeStyle = 'rgba(25,24,23,0.32)';
    c.beginPath(); c.arc(g.x, g.y, 14, 0, Math.PI * 2); c.stroke(); c.restore();
    const p = hands && hands.pose;
    if (!studio || !p || (p.pose !== 'palm' && p.pose !== 'back')) return;
    const back = p.pose === 'back', n = back ? clamp(Math.round(cfg.undoPulls || 2), 1, 3) : 2, k = back ? hands.pull.progress : hands.wave.progress;
    for (let i = 0; i < n; i++) {
      const x = g.x - (n - 1) * 9 + i * 18;
      c.beginPath(); c.arc(x, g.y + 28, 5, 0, Math.PI * 2); c.fillStyle = i < k ? (back ? TK.ink : TK.red) : 'rgba(25,24,23,0.2)'; c.fill();
    }
  }
  // 18d: what a new pose did (thickness · direct or n agents · rest · wave to clear), beside the cursor for 1.8 s
  function drawChip(c, g) {
    const ch = HS.chip; if (!ch) return;
    const age = performance.now() - ch.t; if (age > 1800) { HS.chip = null; return; }
    c.save(); c.globalAlpha = age < 1400 ? 1 : 1 - (age - 1400) / 400;
    c.font = "700 13px 'JetBrains Mono', ui-monospace, monospace"; c.textBaseline = 'middle'; c.textAlign = 'left';
    const w = c.measureText(ch.text).width + 24, x = clamp(g.x + 24, 8, W - w - 8), y = clamp(g.y - 46, 8, H - 36);
    c.fillStyle = 'rgba(25,24,23,0.86)'; c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, 28, 14); else c.rect(x, y, w, 28); c.fill();
    c.fillStyle = '#fff'; c.fillText(ch.text, x + 12, y + 14.5); c.restore();
  }
  // 18: the partners' cursors — a ring in their ink colour with their name (dashed at rest, a dot while drawing, faint
  // over their menu); hidden after 1.2 s without news
  function drawPartners(c) {
    const now = performance.now();
    for (const p of share.peers.values()) {
      const q = p.cursor; if (!q || q.st === 'off' || now - q.t > 1200) continue;
      const x = (q.x * surface.width - A.pan.x) * Z, y = (q.y * surface.width - A.pan.y) * Z, col = peerColour(p.info);
      c.save(); c.globalAlpha = q.st === 'menu' ? 0.4 : 0.95;
      c.lineWidth = 3; c.strokeStyle = col; if (q.st === 'rest') c.setLineDash([5, 5]);
      c.beginPath(); c.arc(x, y, 17, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      if (q.st === 'draw' || q.st === 'armed') { c.beginPath(); c.arc(x, y, q.st === 'draw' ? 5 : 2.5, 0, Math.PI * 2); c.fillStyle = col; c.fill(); }
      const name = p.info.name || t('variant.' + p.info.variant);
      c.font = "700 12px 'JetBrains Mono', ui-monospace, monospace"; c.textBaseline = 'middle'; c.textAlign = 'left';
      const w = c.measureText(name).width + 16, lx = clamp(x + 20, 4, W - w - 4), ly = clamp(y + 16, 4, H - 26);
      c.fillStyle = col; c.beginPath(); if (c.roundRect) c.roundRect(lx, ly, w, 22, 11); else c.rect(lx, ly, w, 22); c.fill();
      c.fillStyle = '#fff'; c.fillText(name, lx + 8, ly + 11.5);
      c.restore();
    }
  }
  // 18: who is drawing here — a quiet line at the top right (each person's colour and variant)
  function drawRoom(c) {
    const people = share.members();
    c.save(); c.font = "600 12px 'JetBrains Mono', ui-monospace, monospace"; c.textBaseline = 'middle'; c.textAlign = 'left';
    let x = W - 14; const y = 22;
    for (let i = people.length - 1; i >= 0; i--) {
      const m = people[i], label = peerLabel(m), w = c.measureText(label).width;
      x -= w; c.globalAlpha = 0.85; c.fillStyle = TK.label; c.fillText(label, x, y);
      x -= 14; c.beginPath(); c.arc(x + 5, y, 5, 0, Math.PI * 2); c.fillStyle = peerColour(m); c.fill(); x -= 16;
    }
    c.restore();
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
      for (let wx = x0; wx <= A.pan.x + W / Z + sp; wx += sp) for (let wy = y0; wy <= A.pan.y + H / Z + sp; wy += sp) {
        let alpha = 0.16;
        if (vis === 'feedback') { const f = flashes.get(wx + ',' + wy); if (!f) continue; alpha = flashAlpha(f, now) * 0.65; if (alpha <= 0.01) continue; }
        c.beginPath(); c.arc((wx - A.pan.x) * Z, (wy - A.pan.y) * Z, rr * Z, 0, Math.PI * 2); c.fillStyle = withAlpha(TK.ink, alpha); c.fill();
      }
    }
    if (!S.drawMode) return;
    const col = engine.color === '#ffffff' ? TK.muted : engine.color;
    if (G.active) for (const n of G.nodes) { c.beginPath(); c.arc((n.x - A.pan.x) * Z, (n.y - A.pan.y) * Z, 4, 0, Math.PI * 2); c.fillStyle = withAlpha(col, 0.55); c.fill(); }
    const d = G.dot;
    if (!d) return;
    const sx = (d.x - A.pan.x) * Z, sy = (d.y - A.pan.y) * Z;
    if (vis !== 'hidden') { c.beginPath(); c.arc(sx, sy, rr * Z + 3, 0, Math.PI * 2); c.strokeStyle = withAlpha(col, 0.9); c.lineWidth = 2; c.stroke(); }
    if (G.active && G.last && !S.boids.length) {
      c.save(); c.setLineDash([4, 5]); c.strokeStyle = withAlpha(col, 0.35); c.lineWidth = 2;
      c.beginPath(); c.moveTo((G.last.x - A.pan.x) * Z, (G.last.y - A.pan.y) * Z); c.lineTo(sx, sy); c.stroke(); c.restore();
    }
    const pr = S.cdwell.key === d.key ? clamp(S.cdwell.t / cfg.canvasDwellMs, 0, 1) : 0;
    if (pr > 0) HUD.arc(c, sx, sy, rr * Z + 8, pr, TK.red, 3);
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
    const r = engine.widthRange(), rn = clamp(r.nom * (1 + S.eng), 3, 40) * Z / 2 + 2;
    if (S.boids.length) {
      for (const b of S.boids) {
        const x = (b.x - A.pan.x) * Z, y = (b.y - A.pan.y) * Z;
        if (!S.drawMode) continue;
        if (!inking) {
          c.save(); c.strokeStyle = 'rgba(158,150,138,0.22)'; c.lineWidth = 1; c.setLineDash([2, 4]);
          c.beginPath(); c.moveTo(gh.x, gh.y); c.lineTo(x, y); c.stroke(); c.restore();
          c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fillStyle = withAlpha(white ? TK.muted : col, 0.5); c.fill();
        } else nib(x, y, rn);
      }
    } else if (inking && !engine.gridMode && S.pen) nib((S.pen.x - A.pan.x) * Z, (S.pen.y - A.pan.y) * Z, rn);
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
    if (closeReach()) return true;
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
    if (k === 'escape') { if (closeTop()) e.preventDefault(); return; }   // otherwise InkGaze opens its settings (18a)
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
      case 'c': if (isA && ig) ig.recenter(); else if (isD) openReach(); break;
      case 'h': if (!isD) return; cfg.handPreview = !cfg.handPreview; persist(); break;
      case '+': case '=': nudgeView(+1); break;   // 18.1: the view size
      case '-': nudgeView(-1); break;
      case '0': nudgeView(0); break;
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
    if (!id && !isA && engine.S.drawMode) controllerDraw();   // 18b / 18d: a click on the canvas starts / stops the line
  });
  stage.addEventListener('pointerdown', (e) => { if (e.button === 2) A.drag = true; });
  window.addEventListener('pointerup', (e) => { if (e.button === 2) A.drag = false; });
  window.addEventListener('pointermove', (e) => { if ((A.drag || A.space) && A.phase === 'studio' && (cfg.panEnabled || Z > 1)) panBy(-e.movementX, -e.movementY); }, { passive: true });
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
  startShare();   // 18: join the room (no network: the other windows of this browser)
  window.inkwell = {
    version: VERSION, variant, cfg, A, get engine() { return engine; }, get surface() { return surface; }, get inkgaze() { return ig; },
    get hands() { return hands; }, HS, get share() { return share; }, SH, compose, get L() { return L; }, get Z() { return Z; },
    // 18d tests without a camera: the tracker as if running; then hands.inject({pose, n, thumb, x, y, …}, t)
    async handTest() { await ensureHands(); HS.status = 'tracking'; hands.state = 'tracking'; A.paused = false; return hands; },
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
