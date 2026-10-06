// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18c — VR head-mount: Cardboard (phone, motion sensors) · WebXR headsets · desktop look-around preview
//   The canvas is a 360° ring around the viewer (yaw 0–360°, elevation +40° … −35°): turn your head to draw all
//   around. The head aims (the view centre), a dwell selects, a fast head flick is the escape.
//   The menu floats below the eyes (hudPitchDeg); after a head turn it waits followDelayMs (350 ms), then eases in
//   and out (followMs) to the new heading — never while you are looking at it (HTC Vive style).
//   Cardboard stereo: two eye views side by side; the optional lens distortion is NORMALISED so the corners stay at
//   the corners (the whole view always fits: no cropping), and the views are rebuilt on every resize / rotation
//   (the causes of build 15's cropping: no resize after rotating to landscape, distortion pushing the edges out, a UV
//   shift for the IPD — here the IPD is a real camera separation).
//   View size (18.1): the ring has no edge to grow, so the CANVAS size scales what is on it — the ink, the grid, the
//   agents (engine.ppd = ppd × size; the head's dwell tolerance stays in degrees: engine.eyePpd = ppd); the MENU size
//   scales the menu panel, the welcome panel and the intro dots (and the DOM pages, as in 2D).
//   three.js 0.160.0 (import map in the page). Same engine, menu, sessions and settings as 18a / 18b.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import {
  VERSION, TK, loadSettings, saveSettings, defaultsFor, settingsKey, storage, deepMerge, setPath, clamp, easeInOut, wrapDelta, unlockAudio, chime, withAlpha,
  viewScale, linkedScale,
} from './core.js';
import { Surface } from './surface.js';
import { Engine } from './engine.js';
import * as HUD from './hud.js';
import { GazeDom, toast, showGate, showAbout, showHelp, openConfig, agentsEditor, variantTitle, variantName, menuScaleDom } from './ui.js';
import { t, onLanguage, setLanguage, langMeta, languages, lang } from './i18n.js';
import { saveSession, recentSessions, pickSessionFile, parseSession, applySession } from './sessions.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const R = 2.6;                          // ring radius (m)
const ELEV_TOP = 40, ELEV_BOT = -35, SPAN = ELEV_TOP - ELEV_BOT;
const COLS = 8;                         // ring tiles (one GPU texture each)
const TEX_SCALE = 1.25;                 // texels per surface px (12 px/° → 15 texels/°)
const HUD_W = 1600, HUD_H = 1100, HUD_DIST = 1.25, HUD_ANG = 64;   // the menu panel: canvas px, metres, angular width
const FONT = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;
const plain = (html) => String(html).replace(/<[^>]*>/g, '');   // canvas text: the translations' links become plain words
const dirOf = (yaw, elev, v = new THREE.Vector3()) => v.set(Math.sin(yaw * D2R) * Math.cos(elev * D2R), Math.sin(elev * D2R), -Math.cos(yaw * D2R) * Math.cos(elev * D2R));

export function runVR(variant) {
  const cfg = loadSettings(variant);
  if (Array.isArray(cfg.agents)) cfg.boidCount = cfg.agents.length;
  const root = document.getElementById('screens'), host = document.getElementById('vr');
  const overlay = document.getElementById('overlay'); if (overlay) overlay.hidden = true;
  const gaze = new GazeDom(cfg);   // DOM screens (gate, pages, configuration) are used by touch / click in 18c
  const ppd = cfg.ppd || 12;
  const A = {
    phase: 'boot', mode: 'none',          // mode: 'sensors' (phone) · 'drag' (preview) · 'xr'
    yaw: 0, pitch: 0, yawOffset: 0, dragYaw: 0, dragPitch: 0, ori: null, sensors: false,
    degS: 0, rawDegS: 0, prevDir: null, lastEscape: -1e9, held: null, holdUntil: 0,
    cfgUI: null, page: null, pageKind: null, lastFrame: performance.now(), lastClearTap: -1e9,
    tap: { t: 0, timer: 0, x: 0, y: 0, down: null }, follow: { yaw: 0, since: null, anim: null },
  };
  document.body.classList.add('v-c');
  document.title = variantTitle(variant);

  // ---------------------------------------------------------------------------------------------- three.js
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (e) { toast(t('vr.webgl'), 10000); throw e; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9e5dc');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const stereo = new THREE.StereoCamera(); stereo.aspect = 0.5;
  let rt = null;   // distortion pass target (both eyes side by side)
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const barrel = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, k: { value: 0 }, aspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // barrel pre-distortion per eye, NORMALISED: r_src = r · (1 + k r²) / (1 + k r_max²) — the corners map to the
    // corners (nothing is pushed out of view), the centre is magnified, which the Cardboard lens undoes
    fragmentShader: `uniform sampler2D tDiffuse; uniform float k; uniform float aspect; varying vec2 vUv;
      void main(){
        float eye = step(0.5, vUv.x);
        vec2 p = vec2((vUv.x - 0.5 * eye) * 2.0, vUv.y) * 2.0 - 1.0;
        vec2 q = vec2(p.x * aspect, p.y);
        float rmax2 = aspect * aspect + 1.0;
        vec2 src = p * (1.0 + k * dot(q, q)) / (1.0 + k * rmax2);
        vec2 suv = src * 0.5 + 0.5;
        gl_FragColor = texture2D(tDiffuse, vec2((suv.x + eye) * 0.5, suv.y));
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), barrel));

  // ---------------------------------------------------------------------------------------------- the 360° ring
  const surface = new Surface({ width: Math.round(360 * ppd), height: Math.round(SPAN * ppd), scale: TEX_SCALE, tileW: Math.round(360 * ppd) / COLS, wrap: true });
  const ringGroup = new THREE.Group(); scene.add(ringGroup);
  function ringGeometry(a0, a1, segX = 12, segY = 30, radius = R) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= segY; j++) {
      const el = ELEV_TOP - (j / segY) * SPAN, y = radius * Math.tan(el * D2R);
      for (let i = 0; i <= segX; i++) {
        const yaw = (a0 + (i / segX) * (a1 - a0)) * D2R;
        pos.push(radius * Math.sin(yaw), y, -radius * Math.cos(yaw)); uv.push(i / segX, j / segY);   // v = 0 at the top (flipY off)
      }
    }
    for (let j = 0; j < segY; j++) for (let i = 0; i < segX; i++) { const a = j * (segX + 1) + i, b = a + 1, c = a + segX + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    return g;
  }
  const tiles = surface.tiles.map((st) => {
    const tex = new THREE.CanvasTexture(st.canvas);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const mesh = new THREE.Mesh(ringGeometry(st.x0 / ppd, (st.x0 + st.w) / ppd), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    ringGroup.add(mesh);
    st.dirtyRect = null;
    return { st, tex, mesh };
  });
  const scratch = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  const gl = renderer.getContext();
  const tmpV2 = new THREE.Vector2();
  function uploadTiles() {   // only the changed rectangle of each tile goes to the GPU (texSubImage2D)
    let fullNow = 0;   // 16.1: whole-tile uploads (Clear, Open, undo of a clear) are spread over frames, two per frame
    for (const tl of tiles) {
      const st = tl.st, r = st.dirtyRect;
      if (r) {
        st.dirtyRect = null;
        const w = r[2] - r[0], h = r[3] - r[1];
        if (w * h > 0.3 * st.canvas.width * st.canvas.height || !tl.ready) tl.pendingFull = true;
        else if (!tl.pendingFull) {
          const img = st.ctx.getImageData(r[0], r[1], w, h);
          scratch.image = { data: new Uint8Array(img.data.buffer), width: w, height: h };
          // three.js binds the tile to unit 0 only if its cache thinks it is not there yet, without selecting unit 0:
          // select it first, or the sub-image lands in whatever texture the active unit holds
          renderer.state.activeTexture(gl.TEXTURE0);
          renderer.copyTextureToTexture(tmpV2.set(r[0], r[1]), scratch, tl.tex);
        }
      }
      if (tl.pendingFull && fullNow < 2) { tl.tex.needsUpdate = true; tl.ready = true; tl.pendingFull = false; fullNow++; }
    }
  }
  // a faint horizon band under and over the ring, so the space reads as a room
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.004, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0xd6d3cc, side: THREE.DoubleSide }));
  band.position.y = R * Math.tan(ELEV_BOT * D2R) - 0.01; scene.add(band);
  const band2 = band.clone(); band2.position.y = R * Math.tan(ELEV_TOP * D2R) + 0.01; scene.add(band2);

  // ---------------------------------------------------------------------------------------------- canvas panels
  function makePanel(wpx, hpx, angW, dist) {
    const canvas = document.createElement('canvas'); canvas.width = wpx; canvas.height = hpx;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    const wm = 2 * dist * Math.tan((angW / 2) * D2R), hm = wm * hpx / wpx;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    mesh.renderOrder = 10;
    return { canvas, ctx, tex, mesh, wm, hm, wpx, hpx, sig: '' };
  }
  const raycaster = new THREE.Raycaster();
  function hitPanel(panel, origin, dir) {   // → px on the panel's canvas, or null
    if (!panel || !panel.mesh.visible || !panel.mesh.parent) return null;
    raycaster.set(origin, dir);
    const hit = raycaster.intersectObject(panel.mesh, false)[0];
    return hit && hit.uv ? { x: hit.uv.x * panel.wpx, y: (1 - hit.uv.y) * panel.hpx, dist: hit.distance } : null;
  }
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); };

  // the menu (same HUD as 18a / 18b, larger text for VR)
  const hud = makePanel(HUD_W, HUD_H, HUD_ANG, HUD_DIST);
  const hudPivot = new THREE.Object3D(); scene.add(hudPivot); hudPivot.add(hud.mesh);
  let L = null;
  function layoutHud() {   // 18.1: × the menu size (the panel grows about the bar's centre, which stays at hudPitchDeg)
    L = HUD.layout(HUD_W, HUD_H, cfg, { scale: 1.2, fontScale: 1.6 });
    const m = viewScale(cfg.menuScale);
    const p = cfg.hudPitchDeg * D2R, barC = new THREE.Vector3(0, Math.sin(p) * HUD_DIST, -Math.cos(p) * HUD_DIST);
    const up = new THREE.Vector3(0, Math.cos(p), Math.sin(p)), dyPx = (L.barY + L.barH / 2) - HUD_H / 2;
    hud.mesh.position.copy(barC).addScaledVector(up, (dyPx / HUD_H) * hud.hm * m);
    hud.mesh.rotation.set(p, 0, 0);
    hud.mesh.scale.setScalar(m);
    splash.panel.mesh.scale.setScalar(m);
    hud.sig = '';
  }
  // 18.1: the view size — the canvas (what is on the ring) and the menu
  function applyView() {
    engine.ppd = ppd * viewScale(cfg.canvasScale); engine.eyePpd = ppd;
    gridDirty = true; layoutHud(); menuScaleDom(cfg.menuScale);
  }
  function nudgeView(dir) {   // + / − (both sizes when linked) · 0 (both back to ×1)
    if (dir === 0) { onCfgChange('canvasScale', 1); if (cfg.menuScale !== 1) onCfgChange('menuScale', 1); }
    else onCfgChange('canvasScale', Math.round(viewScale(cfg.canvasScale + dir * 0.05) * 100) / 100);
    toast(t('toast.view', { canvas: viewScale(cfg.canvasScale).toFixed(2), menu: viewScale(cfg.menuScale).toFixed(2) }), 2200);
  }

  // ---------------------------------------------------------------------------------------------- the reticle
  // drawn on a small canvas with the same rules as 2D (HUD.reticle: hidden while drawing by default, dashed when paused),
  // placed at the depth of what is aimed at (no double image in stereo)
  const ret = makePanel(160, 160, 4.2, 1); ret.mesh.renderOrder = 20; scene.add(ret.mesh);
  function drawReticle(state) {
    const c = ret.ctx, sig = state.sig; if (sig === ret.sig) return; ret.sig = sig;
    c.clearRect(0, 0, 160, 160);
    if (state.studio) HUD.reticle(c, 80, 80, engine, { r: 40 });
    else if (cfg.cursorPaused !== false) { c.setLineDash([7, 8]); c.lineWidth = 3; c.strokeStyle = 'rgba(25,24,23,0.45)'; c.beginPath(); c.arc(80, 80, 40, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    if (state.progress > 0) HUD.arc(c, 80, 80, 50, state.progress, TK.red, 6);
    ret.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------- the engine
  let engine = null;
  let saveT = 0;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => saveSettings(variant, cfg), 250); };
  const agentsToCfg = () => { cfg.agents = engine.S.boids.map((b) => b.props()); cfg.boidCount = cfg.agents.length; };
  engine = new Engine({
    cfg, surface, ppd, wrapW: surface.width,
    hooks: {
      onChange: (what) => { if (what === 'boids' || what === 'preset') agentsToCfg(); persist(); if (what === 'grid') gridDirty = true; },
      onOption: (b) => { if (b === 'save') doSave(); else if (b === 'open') doOpen(); else if (b === 'config') openConfigUI(); },
      onFileDwell: () => toast(t('toast.fileDwell'), 5200),
    },
  });
  engine.spawnBoids(Array.isArray(cfg.agents) && cfg.agents.length === cfg.boidCount ? cfg.agents : null);
  agentsToCfg();
  engine.S.target = { x: 0, y: surface.height / 2 };

  // the agents' markers (only when the drawing cursor is shown)
  const nibs = [];
  function syncNibs() {
    const S = engine.S, show = HUD.cursorState(engine) === 'drawing' && cfg.cursorDrawing;
    while (nibs.length < S.boids.length + 1) { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0x191817, transparent: true, opacity: 0.9, depthTest: false })); m.renderOrder = 5; scene.add(m); nibs.push(m); }
    const pens = S.boids.length ? S.boids : (S.penDown ? [S.pen] : []);
    nibs.forEach((m, i) => {
      const p = pens[i]; m.visible = !!(show && p);
      if (!m.visible) return;
      const yaw = p.x / ppd, el = ELEV_TOP - p.y / ppd, d = dirOf(yaw, el), dist = R - 0.02, rr2 = Math.max(0.006, Math.tan(engine.widthRange().nom / ppd * 0.6 * D2R) * dist);
      m.position.copy(d.multiplyScalar(dist)); m.lookAt(0, m.position.y, 0); m.scale.setScalar(rr2);
      m.material.color.set(engine.color === '#ffffff' ? '#9e968a' : engine.color);
    });
  }

  // ---------------------------------------------------------------------------------------------- grid (instanced dots on the ring)
  let gridMesh = null, gridDirty = true, gridKey = '';
  const gridHi = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: 0xe63c22, transparent: true, opacity: 0.9, depthTest: false }));
  gridHi.renderOrder = 6; scene.add(gridHi); gridHi.visible = false;
  const nodeMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0x191817, transparent: true, opacity: 0.55, depthTest: false }), 512);
  nodeMesh.renderOrder = 6; nodeMesh.count = 0; scene.add(nodeMesh);
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
  const PAPER = new THREE.Color(TK.bgCanvas), INK = new THREE.Color(TK.ink);
  const placer = new THREE.Object3D();
  function placeOnRing(x, y, r, out) {   // surface px → a matrix on the ring (radius R, just inside) facing the axis
    const yaw = (x / ppd) * D2R, el = (ELEV_TOP - y / ppd) * D2R, rad = R - 0.012;
    placer.position.set(rad * Math.sin(yaw), rad * Math.tan(el), -rad * Math.cos(yaw));
    placer.lookAt(0, placer.position.y, 0); placer.scale.setScalar(r); placer.updateMatrix();
    out.copy(placer.matrix);
  }
  function rebuildGrid() {
    const { sp, dot } = engine.gridGeom(), cols = Math.round(surface.width / sp), rows = Math.floor(surface.height / sp) + 1;
    const key = sp + ':' + dot + ':' + cols + ':' + rows;
    if (key !== gridKey) {
      if (gridMesh) { scene.remove(gridMesh); gridMesh.geometry.dispose(); gridMesh.material.dispose(); }
      gridMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), cols * rows);
      gridMesh.renderOrder = 4; gridMesh.userData = { cols, rows, sp };
      const rm = Math.tan((dot / ppd / 2) * D2R) * R;
      let n = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { placeOnRing(i * sp, j * sp, rm, tmpM); gridMesh.setMatrixAt(n, tmpM); gridMesh.setColorAt(n, PAPER); n++; }
      gridMesh.instanceMatrix.needsUpdate = true; scene.add(gridMesh); gridKey = key;
    }
    gridDirty = false;
  }
  function updateGrid(now) {
    const on = engine.gridMode && A.phase === 'studio';
    if (!on) { if (gridMesh) gridMesh.visible = false; gridHi.visible = false; nodeMesh.count = 0; return; }
    if (gridDirty || !gridMesh) rebuildGrid();
    const vis = cfg.gridMode, { cols, rows, sp } = gridMesh.userData, flashes = engine.gridFlashes(now);
    gridMesh.visible = vis !== 'hidden';
    if (gridMesh.visible) {
      const U = gridMesh.userData;
      if (U.mode !== vis) {   // 'always': every dot at 16 %; 'feedback': only the flashing ones (below)
        for (let n = 0; n < cols * rows; n++) gridMesh.setColorAt(n, vis === 'always' ? tmpC.copy(PAPER).lerp(INK, 0.16) : PAPER);
        U.mode = vis; U.lit = new Set(); gridMesh.instanceColor.needsUpdate = true;
      }
      if (vis === 'feedback') {   // fast ease-in (150 ms), slow ease-out (450 ms)
        const lit = new Set();
        for (const [key, f] of flashes) {
          const [fx, fy] = key.split(',').map(Number), i = ((Math.round(fx / sp) % cols) + cols) % cols, j = Math.round(fy / sp);
          if (j < 0 || j >= rows) continue;
          const a = clamp((now - f.enter) / 150, 0, 1) * (f.exit == null ? 1 : 1 - clamp((now - f.exit) / 450, 0, 1)) * 0.65, n = j * cols + i;
          gridMesh.setColorAt(n, tmpC.copy(PAPER).lerp(INK, a)); lit.add(n);
        }
        for (const n of U.lit) if (!lit.has(n)) gridMesh.setColorAt(n, PAPER);
        if (lit.size || U.lit.size) gridMesh.instanceColor.needsUpdate = true;
        U.lit = lit;
      }
    }
    const G = engine.S.grid, d = G.dot;
    gridHi.visible = !!(d && engine.S.drawMode && vis !== 'hidden');
    if (gridHi.visible) { const { dot } = engine.gridGeom(); placeOnRing(((d.x % surface.width) + surface.width) % surface.width, d.y, Math.tan((dot / ppd / 2 + 0.25) * D2R) * R, tmpM); tmpM.decompose(gridHi.position, gridHi.quaternion, gridHi.scale); }
    nodeMesh.count = G.active ? Math.min(512, G.nodes.length) : 0;
    for (let i = 0; i < nodeMesh.count; i++) { const nd = G.nodes[i]; placeOnRing(((nd.x % surface.width) + surface.width) % surface.width, nd.y, Math.tan(0.18 * D2R) * R, tmpM); nodeMesh.setMatrixAt(i, tmpM); }
    if (nodeMesh.count) nodeMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------- intro dots (3D)
  const intro = { group: new THREE.Group(), dots: [], popped: 0, hint: null, dwell: { id: null, t: 0, lastIn: 0, needLeave: null } };
  scene.add(intro.group); intro.group.visible = false;
  function showIntro3D() {
    A.phase = 'intro';
    intro.group.clear(); intro.dots = []; intro.popped = 0; intro.group.visible = true;
    intro.group.rotation.y = -A.yaw * D2R;   // in front of the current heading
    const dist = 2.2, rad = Math.tan(1.6 * D2R) * dist * viewScale(cfg.menuScale);   // 3.2° dots (× the menu size, 18.1): head aiming wants larger targets than 64 px on a screen
    [-22, 0, 22].forEach((yaw, i) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(rad, 40), new THREE.MeshBasicMaterial({ color: 0xbdbab4, transparent: true, depthTest: false }));
      m.position.copy(dirOf(yaw, 0).multiplyScalar(dist)); m.lookAt(0, 0, 0); m.renderOrder = 8;
      const ring = new THREE.Mesh(new THREE.RingGeometry(rad * 1.25, rad * 1.42, 48, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0xe63c22, depthTest: false, transparent: true, side: THREE.DoubleSide }));
      ring.renderOrder = 9; m.add(ring); ring.position.z = 0.001;
      intro.group.add(m); intro.dots.push({ id: 'dot' + i, yaw, mesh: m, ring, popped: false, popT: 0, prog: -1 });
    });
    const hint = makePanel(1400, 160, 44, 2.2); intro.hint = hint;
    drawHint();
    hint.mesh.position.copy(dirOf(0, 11).multiplyScalar(2.2)); hint.mesh.lookAt(0, 0, 0); intro.group.add(hint.mesh);
  }
  function drawHint() {   // one line, shrunk to fit (translations differ in length)
    const h = intro.hint; if (!h) return;
    const c = h.ctx, text = t('intro.hintHead').toUpperCase();
    c.clearRect(0, 0, 1400, 160); c.font = `500 52px ${FONT}`;
    const w = c.measureText(text).width; if (w > 1340) c.font = `500 ${Math.floor(52 * 1340 / w)}px ${FONT}`;
    c.fillStyle = TK.muted; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 700, 80); h.tex.needsUpdate = true;
  }
  function tickIntro(now, dt, aimYaw, aimEl) {
    const D = intro.dwell; let hit = null;
    const localYaw = wrapDeg(aimYaw - (-intro.group.rotation.y * R2D));
    for (const d of intro.dots) if (!d.popped && Math.hypot(wrapDeg(localYaw - d.yaw), aimEl) <= 3.0 * viewScale(cfg.menuScale) * Math.sqrt(1 + cfg.hitPad) / Math.sqrt(1.5)) hit = d.id;
    const fired = idDwell(D, hit, dt, now, cfg.menuDwellMs);
    for (const d of intro.dots) {
      if (d.popped) {
        const k = clamp((now - d.popT) / 460, 0, 1); d.mesh.scale.setScalar(1.16 + k * 0.8); d.mesh.material.opacity = 1 - k; d.ring.visible = false;
        continue;
      }
      const on = D.id === d.id && hit === d.id, prog = D.id === d.id ? clamp(D.t / cfg.menuDwellMs, 0, 1) : 0;
      d.mesh.scale.setScalar(on ? 1.16 : 1); d.mesh.material.color.set(on ? '#b0ada6' : '#bdbab4');
      if (Math.abs(prog - d.prog) > 0.01) { d.prog = prog; const g = d.ring.geometry, p = g.parameters; d.ring.geometry = new THREE.RingGeometry(p.innerRadius, p.outerRadius, 48, 1, Math.PI / 2, -Math.max(0.001, prog * Math.PI * 2)); g.dispose(); }
    }
    if (fired) popDot(fired, now);
    return D.id && hit ? clamp(D.t / cfg.menuDwellMs, 0, 1) : 0;
  }
  function popDot(id, now) {
    const d = intro.dots.find((q) => q.id === id); if (!d || d.popped) return;
    d.popped = true; d.popT = now; d.mesh.material.color.set(TK.red); chime([0, 4, 7][intro.popped] || 0); intro.popped++;
    if (intro.popped === 3) setTimeout(() => { intro.group.visible = false; showSplash3D(); }, 900);
  }
  // a small dwell state machine for 3D targets (the same rules as the menu: grace, need-to-leave)
  function idDwell(D, id, dt, now, need) {
    if (D.needLeave && id !== D.needLeave) D.needLeave = null;
    if (id && id === D.needLeave) id = null;
    if (!id) { if (D.id && now - D.lastIn > cfg.graceMs) { D.id = null; D.t = 0; } return null; }
    if (id !== D.id) { D.id = id; D.t = 0; D.lastIn = now; return null; }
    D.t += dt; D.lastIn = now;
    if (D.t >= need) { D.id = null; D.t = 0; D.needLeave = id; return id; }
    return null;
  }

  // ---------------------------------------------------------------------------------------------- welcome panel (3D)
  const splash = { panel: makePanel(1400, 1000, 58, 2.0), targets: [], dwell: { id: null, t: 0, lastIn: 0, needLeave: null }, hover: null };
  splash.panel.mesh.visible = false; scene.add(splash.panel.mesh);
  applyView();   // 18.1 (after the panels exist): the engine's two scales, the menu, the welcome panel
  function showSplash3D() {
    A.phase = 'splash'; engine.setDrawMode(false); engine.S.submenu = null; engine.closeModal();
    const m = splash.panel.mesh; m.visible = true;
    m.position.copy(dirOf(A.yaw, 4).multiplyScalar(2.0)); m.lookAt(0, m.position.y * 0.2, 0);
    hudPivot.visible = false; splash.panel.sig = '';
  }
  function drawSplash() {
    const P = splash.panel, c = P.ctx, D = splash.dwell, prog = D.id ? clamp(D.t / cfg.menuDwellMs, 0, 1) : 0;
    const sig = [lang(), splash.hover, D.id, Math.round(prog * 30)].join('|'); if (sig === P.sig) return; P.sig = sig;
    c.clearRect(0, 0, P.wpx, P.hpx);
    c.fillStyle = 'rgba(250,249,247,0.96)'; rr(c, 0, 0, P.wpx, P.hpx, 60); c.fill();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = TK.ink; c.font = `700 210px ${FONT}`; c.fillText('inkwell', 700, 380);
    c.font = `500 30px ${FONT}`; c.fillStyle = TK.red; c.fillText(plain(t('splash.kicker', { variant: variantName(variant) })).toUpperCase(), 700, 450);
    // the short credit (the SiX project and its PI first), two small lines at the foot
    c.font = `500 25px ${FONT}`; c.fillStyle = TK.label;
    for (const [key, y] of [['splash.credit1', 925], ['splash.credit2', 962]]) {
      const line = plain(t(key)), w = c.measureText(line).width;
      if (w > 1320) { c.save(); c.font = `500 ${Math.floor(25 * 1320 / w)}px ${FONT}`; c.fillText(line, 700, y); c.restore(); } else c.fillText(line, 700, y);
    }
    splash.targets = [];
    const btn = (id, x, y, w, h, draw) => { splash.targets.push({ id, x, y, w, h }); const on = splash.hover === id; draw(on); if (D.id === id && prog > 0) { c.fillStyle = TK.red; c.fillRect(x + w * 0.12, y + h - 12, (w * 0.76) * prog, 6); } };
    btn('play', 470, 520, 460, 150, (on) => {
      c.fillStyle = on ? '#000' : TK.ink; rr(c, 470, 520, 460, 150, 75); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(590, 560); c.lineTo(640, 595); c.lineTo(590, 630); c.closePath(); c.fill();
      c.font = `700 64px ${FONT}`; c.textAlign = 'left'; c.fillText(t('splash.play'), 668, 618); c.textAlign = 'center';
    });
    const links = [['about', t('splash.about')], ['help', t('splash.help')], ['config', t('splash.config')]];
    c.font = `500 38px ${FONT}`;
    const widths = links.map(([, s]) => c.measureText(s).width + 120), total = widths.reduce((a, b) => a + b, 0) + 40 * 2;
    let x = 700 - total / 2;
    links.forEach(([id, s], i) => {
      const w = widths[i];
      btn(id, x, 760, w, 110, (on) => {
        if (on) { c.fillStyle = TK.panel; rr(c, x, 760, w, 110, 55); c.fill(); }
        c.strokeStyle = on ? TK.ink : TK.label; c.fillStyle = c.strokeStyle; c.lineWidth = 4;
        c.beginPath(); c.arc(x + 58, 815, 17, 0, Math.PI * 2); c.stroke();
        c.font = `700 24px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(id === 'about' ? 'i' : id === 'help' ? '?' : '≡', x + 58, 816);
        c.font = `500 38px ${FONT}`; c.textAlign = 'left'; c.fillText(s, x + 90, 816); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      });
      x += w + 40;
    });
    // languages (top right)
    c.font = `500 30px ${FONT}`;
    let lx = P.wpx - 40;
    for (const l of languages().slice().reverse()) {
      const w = c.measureText(l.nativeName).width + 60, on = l.code === lang(), id = 'lang:' + l.code;
      lx -= w;
      btn(id, lx, 40, w, 84, (hv) => {
        c.fillStyle = on ? TK.ink : hv ? TK.panel : '#fff'; rr(c, lx, 40, w, 84, 42); c.fill();
        if (!on) { c.strokeStyle = TK.divider; c.lineWidth = 2; rr(c, lx, 40, w, 84, 42); c.stroke(); }
        c.fillStyle = on ? '#fff' : TK.label; c.textBaseline = 'middle'; c.fillText(l.nativeName, lx + w / 2, 83); c.textBaseline = 'alphabetic';
      });
      lx -= 16;
    }
    P.tex.needsUpdate = true;
  }
  function tickSplash(now, dt, origin, dir) {
    const p = hitPanel(splash.panel, origin, dir);
    let id = null;
    if (p) for (const tg of splash.targets) { const pad = 14; if (p.x >= tg.x - pad && p.x <= tg.x + tg.w + pad && p.y >= tg.y - pad && p.y <= tg.y + tg.h + pad) { id = tg.id; break; } }
    splash.hover = id;
    const fired = idDwell(splash.dwell, id, dt, now, cfg.menuDwellMs);
    drawSplash();
    if (fired) splashAction(fired);
    return p;
  }
  function splashAction(id) {
    if (id === 'play') { splash.panel.mesh.visible = false; goStudio(); }
    else if (id === 'about' || id === 'help') openPage(id);
    else if (id === 'config') openConfigUI();
    else if (id.startsWith('lang:')) pickLanguage(id.slice(5));
  }
  function goStudio() {
    A.phase = 'studio'; hudPivot.visible = true;
    A.follow = { yaw: A.yaw, since: null, anim: null };
    engine.S.needLeave = null; engine.S.dwell = { id: null, t: 0, lastIn: 0 };
  }

  // ---------------------------------------------------------------------------------------------- the menu follows the head
  function followHud(now, onHud) {
    const F = A.follow, S = engine.S;
    if (onHud || S.submenu || S.modal) { F.since = null; }
    else if (!F.anim) {
      if (Math.abs(wrapDeg(A.yaw - F.yaw)) > 4) { if (F.since == null) F.since = now; if (now - F.since >= cfg.followDelayMs) F.anim = { from: F.yaw, to: A.yaw, t0: now }; }
      else F.since = null;
    }
    if (F.anim) {
      const k = clamp((now - F.anim.t0) / Math.max(50, cfg.followMs), 0, 1);
      F.yaw = F.anim.from + wrapDeg(F.anim.to - F.anim.from) * easeInOut(k);
      if (k >= 1) { F.anim = null; F.since = null; }
    }
    hudPivot.rotation.y = -F.yaw * D2R;
  }
  function drawHud(now) {
    const S = engine.S, D = S.dwell;
    const imgs = S.modal && S.modal.items ? S.modal.items.filter((i) => i.img && i.img.complete).length : 0;
    const sig = [lang(), S.hoverId, D.id, Math.round(engine.dwellProgress(D.id || '') * 40), S.submenu, S.modal && S.modal.type, imgs, cfg.lineMode, cfg.thickness, cfg.color, cfg.gridMode, S.drawMode, now < S.flashUntil].join('|');
    if (sig === hud.sig) return; hud.sig = sig;
    hud.ctx.clearRect(0, 0, HUD_W, HUD_H);
    HUD.render(hud.ctx, L, engine, now);
    hud.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------- head pose
  const zee = new THREE.Vector3(0, 0, 1), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), q0 = new THREE.Quaternion(), eul = new THREE.Euler(), qd = new THREE.Quaternion();
  function deviceAngles(e) {   // the phone's orientation → the view (as three.js DeviceOrientationControls did)
    const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * D2R;
    eul.set((e.beta || 0) * D2R, (e.alpha || 0) * D2R, -(e.gamma || 0) * D2R, 'YXZ');
    qd.setFromEuler(eul); qd.multiply(q1); qd.multiply(q0.setFromAxisAngle(zee, -orient));
    eul.setFromQuaternion(qd, 'YXZ');
    return { yaw: -eul.y * R2D, pitch: eul.x * R2D, roll: eul.z };
  }
  window.addEventListener('deviceorientation', (e) => { if (e.alpha == null && e.beta == null) return; A.ori = e; A.sensors = true; }, true);
  function headPose() {
    if (renderer.xr.isPresenting) {
      const xc = renderer.xr.getCamera(), d = new THREE.Vector3(); xc.getWorldDirection(d);
      A.yaw = Math.atan2(d.x, -d.z) * R2D; A.pitch = Math.asin(clamp(d.y, -1, 1)) * R2D;
      return { origin: new THREE.Vector3().setFromMatrixPosition(xc.matrixWorld), dir: d };
    }
    let yaw, pitch, roll = 0;
    if (A.mode === 'sensors' && A.ori) { const a = deviceAngles(A.ori); yaw = wrapDeg(a.yaw - A.yawOffset); pitch = a.pitch; roll = a.roll; }
    else { yaw = A.dragYaw; pitch = A.dragPitch; }
    const g = cfg.headGain || 1;
    yaw = wrapDeg(yaw * g); pitch = clamp(pitch * g, -89, 89);
    if (cfg.invertX) yaw = -yaw; if (cfg.invertY) pitch = -pitch;
    A.yaw = yaw; A.pitch = pitch; A.rawYaw = yaw;
    camera.rotation.set(pitch * D2R, -yaw * D2R, A.mode === 'sensors' ? roll : 0, 'YXZ');
    camera.updateMatrixWorld();
    return { origin: camera.position.clone(), dir: dirOf(yaw, pitch) };
  }
  function recentre() {
    if (A.mode === 'sensors' && A.ori) { A.yawOffset = deviceAngles(A.ori).yaw; }
    else { A.dragYaw = 0; A.dragPitch = 0; }
    A.follow = { yaw: 0, since: null, anim: null };
    toast(t('vr.recentred'));
  }

  // ---------------------------------------------------------------------------------------------- per frame
  function tickStudio(now, dt, aim) {
    const S = engine.S, hp = hitPanel(hud, aim.origin, aim.dir);
    let hudId = hp ? HUD.hit(L, S, hp) : null;
    if (!hudId && (S.submenu || S.modal)) hudId = 'scrim-far';   // looking away from the panel: a long dwell dismisses
    followHud(now, !!hp && !!hudId);
    let surf = null;
    const onRing = A.pitch <= ELEV_TOP && A.pitch >= ELEV_BOT;
    if (!hudId && onRing) {
      const x = (((A.yaw / 360) * surface.width) % surface.width + surface.width) % surface.width, y = (ELEV_TOP - A.pitch) * ppd;
      if (A.rawDegS > cfg.escapeDegS && now - A.lastEscape > 400) { if (engine.escape()) A.lastEscape = now; }   // the head flick
      if (A.rawDegS > cfg.escapeDegS * 0.5) A.holdUntil = now + 80;   // a flick in progress: hold the pen until it is judged
      if (now >= A.holdUntil || !A.held) A.held = { x, y };
      surf = A.held;
    }
    engine.update({ now, dt, hudId, overHud: !!hudId, surf, gazeDegS: A.degS, blinkMs: 0, lost: !hudId && !surf });
    drawHud(now);
    uploadTiles();
    updateGrid(now);
    syncNibs();
    return hp;
  }
  function tick(now) {
    const dt = Math.min(100, Math.max(0, now - A.lastFrame)); A.lastFrame = Math.max(A.lastFrame, now);
    if (A.phase === 'gate' || A.phase === 'boot') return;
    const aim = headPose();
    // head speed (°/s): settle (EMA) and flick (raw)
    if (A.prevDir && dt > 0) {   // sensors arrive unevenly (frames without a new reading): a short EMA for the flick, a longer one to settle
      const v = A.prevDir.angleTo(aim.dir) * R2D / dt * 1000;
      A.rawDegS += (v - A.rawDegS) * (1 - Math.exp(-dt / 35)); A.degS += (v - A.degS) * (1 - Math.exp(-dt / 70));
    }
    A.prevDir = (A.prevDir || new THREE.Vector3()).copy(aim.dir);
    const blocked = !!(A.cfgUI || A.page);
    let target = null, progress = 0;
    if (!blocked) {
      if (A.phase === 'intro') progress = tickIntro(now, dt, A.yaw, A.pitch);
      else if (A.phase === 'splash') { target = tickSplash(now, dt, aim.origin, aim.dir); progress = 0; }
      else if (A.phase === 'studio') { target = tickStudio(now, dt, aim); progress = 0; }
    }
    // the reticle at the depth of what is aimed at
    const dist = target && target.dist ? target.dist - 0.02 : A.phase === 'intro' ? 2.15 : R - 0.05;
    ret.mesh.position.copy(aim.origin).addScaledVector(aim.dir, dist);
    ret.mesh.quaternion.copy(renderer.xr.isPresenting ? renderer.xr.getCamera().quaternion : camera.quaternion);
    ret.mesh.scale.setScalar(dist);
    const studio = A.phase === 'studio';
    drawReticle({ studio, progress, sig: [studio, HUD.cursorState(engine), cfg.cursorDrawing, cfg.cursorPaused, Math.round(engine.canvasProgress() * 40), Math.round(progress * 40), engine.S.now < engine.S.flashUntil, engine.S.overHud].join('|') });
  }

  // ---------------------------------------------------------------------------------------------- rendering
  let vw = 0, vh = 0;
  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    menuScaleDom(cfg.menuScale);   // 18.1: the DOM pages, as far as the window holds them
    renderer.setSize(vw, vh, false);
    renderer.domElement.style.width = vw + 'px'; renderer.domElement.style.height = vh + 'px';
    const pr = renderer.getPixelRatio();
    if (rt) rt.setSize(Math.round(vw * pr), Math.round(vh * pr));
  }
  const stereoOn = () => cfg.stereo && A.mode === 'sensors' && vw > vh && !renderer.xr.isPresenting;
  function render() {
    if (renderer.xr.isPresenting) { renderer.render(scene, camera); return; }
    const pr = renderer.getPixelRatio();
    if (!stereoOn()) {
      camera.fov = 70 / (cfg.vrZoom || 1); camera.aspect = vw / vh; camera.updateProjectionMatrix();
      renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.setViewport(0, 0, vw, vh); renderer.render(scene, camera);
      return;
    }
    // two eyes side by side; the per-eye frustum comes from StereoCamera (a real eye separation, no UV shift)
    camera.fov = 80 / (cfg.vrZoom || 1); camera.aspect = vw / vh; camera.updateProjectionMatrix();
    stereo.eyeSep = (cfg.ipd || 64) / 1000; stereo.update(camera);
    const k = cfg.distort || 0, w = vw / 2;
    if (k > 0.001) {
      if (!rt) rt = new THREE.WebGLRenderTarget(Math.round(vw * pr), Math.round(vh * pr), { type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType });
      renderer.setRenderTarget(rt);
    } else renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, w, vh); renderer.setViewport(0, 0, w, vh); renderer.render(scene, stereo.cameraL);
    renderer.setScissor(w, 0, w, vh); renderer.setViewport(w, 0, w, vh); renderer.render(scene, stereo.cameraR);
    renderer.setScissorTest(false);
    if (k > 0.001) {
      barrel.uniforms.tDiffuse.value = rt.texture; barrel.uniforms.k.value = k; barrel.uniforms.aspect.value = w / vh;
      renderer.setRenderTarget(null); renderer.setViewport(0, 0, vw, vh); renderer.render(quadScene, quadCam);
    }
  }
  let lastErrT = 0;
  const report = (e) => { const t = performance.now(); if (t - lastErrT > 2000) { lastErrT = t; console.error('[inkwell]', e); } };
  renderer.setAnimationLoop((now) => {   // 16.1: one failing step never freezes the view
    if (host.hidden && !renderer.xr.isPresenting) return;
    try { tick(now); } catch (e) { report(e); }
    try { render(); } catch (e) { report(e); }
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));   // some phones report the new size late
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => setTimeout(resize, 250));
  resize();

  // ---------------------------------------------------------------------------------------------- input: drag, taps, keys
  const cv = renderer.domElement;
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => { unlockAudio(); A.tap.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    const d = A.tap.down; if (!d) return;
    d.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (A.mode !== 'sensors' && !renderer.xr.isPresenting) { A.dragYaw = wrapDeg(A.dragYaw - e.movementX * 0.25); A.dragPitch = clamp(A.dragPitch + e.movementY * 0.25, -85, 85); }
  });
  cv.addEventListener('pointerup', () => {
    const d = A.tap.down; A.tap.down = null; if (!d || d.moved > 12 || performance.now() - d.t > 500) return;
    const now = performance.now();
    if (now - A.tap.t < 320) { clearTimeout(A.tap.timer); A.tap.t = 0; recentre(); return; }   // double tap
    A.tap.t = now; A.tap.timer = setTimeout(() => { A.tap.t = 0; select(); }, 320);
  });
  function select() {   // one tap: activate what the head aims at (an accelerator for the dwell)
    if (A.cfgUI || A.page) return;
    if (A.phase === 'intro') { const id = intro.dwell.id; if (id) popDot(id, performance.now()); return; }
    if (A.phase === 'splash') { if (splash.hover) splashAction(splash.hover); return; }
    if (A.phase !== 'studio') return;
    const id = engine.S.hoverId;
    if (id && /^(btn|opt|modal):/.test(id) && id !== 'modal:panel') { engine.activate(id); engine.S.needLeave = id; engine.S.dwell = { id: null, t: 0, lastIn: 0 }; return; }
    if (id === 'scrim' || id === 'scrim-far') { if (engine.S.modal) engine.activate('modal:cancel'); else engine.S.submenu = null; return; }
    if (engine.S.drawMode) controllerDraw();
  }
  function controllerDraw() {
    if (!engine.S.drawMode) engine.setDrawMode(true);
    if (engine.gridMode) {
      const p = engine.S.target; if (!p) return;
      const d = engine.nearestDot(p.x, p.y), { hit } = engine.gridGeom();
      if (Math.hypot(p.x - d.x, p.y - d.y) <= hit) engine.commitGridNode(d); else if (engine.S.grid.active) engine.endGridLine();
    } else if (engine.S.penDown) engine.penUp('key'); else engine.penDown();
    engine.flash();
  }
  document.addEventListener('keydown', (e) => {
    const tg = e.target; if (tg && (tg.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(tg.tagName || ''))) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'escape') { if (closeTop()) e.preventDefault(); return; }
    if (A.cfgUI || A.page || A.phase === 'gate') return;
    if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') {   // preview: look with the arrows too
      if (A.mode === 'sensors') return;
      if (k === 'arrowleft') A.dragYaw = wrapDeg(A.dragYaw - 5); if (k === 'arrowright') A.dragYaw = wrapDeg(A.dragYaw + 5);
      if (k === 'arrowup') A.dragPitch = clamp(A.dragPitch + 4, -85, 85); if (k === 'arrowdown') A.dragPitch = clamp(A.dragPitch - 4, -85, 85);
      e.preventDefault(); return;
    }
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === 'r') { recentre(); return; }
    if (k === 'f') { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (er) { /* no */ } return; }
    if (A.phase !== 'studio') { if (k === ' ' || k === 'enter') select(); return; }
    switch (k) {
      case 'w': engine.step('thickness', +1); break; case 's': engine.step('thickness', -1); break;
      case 'd': engine.step('line', +1); break; case 'a': engine.step('line', -1); break;
      case 'o': engine.step('color', +1); break; case 'l': engine.step('color', -1); break;
      case 'k': case 'z': engine.undo(); break; case 'ç': case 'y': engine.redo(); break;
      case 'q': controllerDraw(); break; case 'g': engine.step('grid', +1); break;
      case ' ': case 'enter': select(); break;
      case '+': case '=': nudgeView(+1); break;   // 18.1: the view size
      case '-': nudgeView(-1); break;
      case '0': nudgeView(0); break;
      case 'e': { const now = performance.now(); if (now - A.lastClearTap < 550) { engine.clear(); A.lastClearTap = -1e9; toast(t('toast.cleared')); } else { A.lastClearTap = now; engine.flash(); } break; }
      default: return;
    }
    e.preventDefault();
  });
  function closeTop() {
    if (A.cfgUI) { A.cfgUI.close(); return true; }
    if (A.page) { const b = A.page.querySelector('.page-back'); if (b) b.click(); return true; }
    if (A.phase === 'studio' && engine.S.modal) { engine.activate('modal:cancel'); return true; }
    if (A.phase === 'studio' && engine.S.submenu) { engine.S.submenu = null; return true; }
    return false;
  }

  // ---------------------------------------------------------------------------------------------- DOM overlays: pages, configuration
  function openPage(which) {
    if (A.page) return;
    engine.penUp('page'); engine.endGridLine();
    A.pageKind = which;
    A.page = (which === 'about' ? showAbout : showHelp)({ root, gaze, onBack: () => { A.page = null; } });
  }
  function onCfgChange(k, v) {
    const linked = linkedScale(cfg, k, v);   // 18.1: the two view sizes move together
    if (v !== undefined && k !== 'boids' && k !== 'preset') setPath(cfg, k, v);
    if (linked) setPath(cfg, linked[0], linked[1]);
    if (k === 'lineMode') engine.setLineMode(v);
    else if (k === 'thickness') engine.setThickness(v);
    else if (k === 'color') engine.setColor(v);
    else if (k.startsWith('lineParams')) engine.applyLineMode();
    else if (k === 'hitPad' || k === 'hudPitchDeg') layoutHud();
    else if (k.startsWith('grid')) gridDirty = true;
    else if (k === 'canvasScale' || k === 'menuScale') applyView();
    if (k === 'boids' || k === 'preset') agentsToCfg();
    if (linked && A.cfgUI) A.cfgUI.sync();   // the other slider moves too
    persist();
  }
  function openConfigUI(scrollTop = 0) {
    if (A.cfgUI) return;
    engine.penUp('config'); engine.endGridLine(); engine.S.submenu = null;
    A.cfgUI = openConfig({
      variant, cfg, gaze, scrollTop, onChange: onCfgChange, onLanguage: pickLanguage,
      agents: () => agentsEditor({ engine, cfg, onChange: onCfgChange }), tracker: null,
      onReset: () => {
        const next = defaultsFor(variant); for (const kk of Object.keys(cfg)) delete cfg[kk]; Object.assign(cfg, next);
        engine.applyLineMode(); engine.spawnBoids(); agentsToCfg(); applyView(); persist(); toast(t('toast.defaults'));
        A.cfgUI.close(); openConfigUI();
      },
      onClearSaved: () => { storage.del(settingsKey(variant)); toast(t('toast.storageCleared', { key: variant.key }), 4200); },
      links: [
        { label: t('cfg.data.about'), fn: () => { A.cfgUI.close(); openPage('about'); } },
        { label: t('cfg.data.help'), fn: () => { A.cfgUI.close(); openPage('help'); } },
        A.phase === 'studio' ? { label: t('cfg.data.start'), fn: () => { A.cfgUI.close(); hudPivot.visible = false; showSplash3D(); } } : null,
      ].filter(Boolean),
      onClose: () => { A.cfgUI = null; },
    });
  }

  // ---------------------------------------------------------------------------------------------- sessions
  async function doSave() {
    toast(t('toast.saving'));
    try { const r = await saveSession({ variant, cfg, engine, surface, inkgaze: null }); toast(t('toast.saved', { png: r.png, json: r.json }), 5200); }
    catch (e) { toast(t('toast.saveFailed', { error: e && e.message ? e.message : e }), 5200); }
  }
  async function doOpen() {
    const items = await recentSessions(variant);
    engine.openModal({ type: 'open', items, onItem: (i) => openSession(items[i] && items[i].json), onFile: () => { pickSessionFile().then((s) => { if (s) openSession(s); }); } });
  }
  async function openSession(json) {
    engine.closeModal();
    const s = parseSession(json);
    if (!s || s.error) { toast(s && s.error ? t(s.error) : t('toast.nothingOpened'), 4200); return; }
    engine.penUp('open'); engine.endGridLine();
    await applySession(s, {
      variant, cfg, engine, getSurface: () => surface, inkgaze: null,
      applyCfg: (next, boids) => {
        const keep = { canvasScale: cfg.canvasScale, menuScale: cfg.menuScale, scaleLink: cfg.scaleLink };   // 18.1: the view size is this person's
        const merged = deepMerge(defaultsFor(variant), Object.assign({}, next, keep)); for (const kk of Object.keys(cfg)) delete cfg[kk]; Object.assign(cfg, merged);
        engine.applyLineMode();
        if (boids && boids.length) { cfg.boidCount = boids.length; engine.spawnBoids(boids); } else engine.spawnBoids();
        agentsToCfg(); applyView(); persist();
      },
    });
    toast(t('toast.restored', { date: new Date(s.savedAt).toLocaleString(lang()) }), 5600);
  }

  // ---------------------------------------------------------------------------------------------- languages
  function pickLanguage(code) { setLanguage(code).then(() => toast(t('toast.language', { name: langMeta().nativeName || code }))); }
  onLanguage(() => {
    document.title = variantTitle(variant);
    hud.sig = ''; splash.panel.sig = ''; ret.sig = '';
    if (A.phase === 'gate' && gate) renderGate();
    if (A.phase === 'intro') drawHint();
    if (A.page) { const kind = A.pageKind; gaze.removeWithin(A.page); A.page.remove(); A.page = null; openPage(kind); }
    if (A.cfgUI) { const st = A.cfgUI.scrollTop; A.cfgUI.close(); openConfigUI(st); }
  });

  // ---------------------------------------------------------------------------------------------- gate → start
  let gate = null, xrOk = false;
  function renderGate() {
    if (gate) gate.close(true);
    const buttons = [{ label: t('vr.start'), icon: 'vr', primary: true, click: true, fn: () => start('sensors') }];
    if (xrOk) buttons.push({ label: t('vr.enterXR'), icon: 'vr', click: true, fn: () => start('xr') });
    buttons.push({ label: t('vr.preview'), icon: 'mouse', click: true, fn: () => start('drag') });
    gate = showGate({ root, gaze, variant, message: t('vr.intro'), buttons, onLanguage: pickLanguage });
  }
  async function start(mode) {
    unlockAudio();
    if (mode === 'xr') {
      try {
        const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
        renderer.xr.setReferenceSpaceType('local');
        await renderer.xr.setSession(session);
        session.addEventListener('end', () => { A.mode = 'drag'; resize(); });
        A.mode = 'xr';
      } catch (e) { toast(t('vr.xrFailed', { reason: e && e.message ? e.message : e }), 6000); return; }
    } else if (mode === 'sensors') {
      try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch (e) { /* denied → preview */ }
      try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { /* not allowed */ }
      try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* not supported */ }
      A.mode = 'sensors';
      setTimeout(() => { if (!A.sensors && A.mode === 'sensors') { A.mode = 'drag'; toast(t('vr.sensorsDenied'), 6000); } else if (A.mode === 'sensors') { if (window.innerWidth < window.innerHeight) toast(t('vr.rotate'), 5000); else toast(t('vr.tapHint'), 4500); } }, 1200);
    } else A.mode = 'drag';
    if (gate) { gate.close(); gate = null; }
    host.hidden = false; resize();
    A.lastFrame = performance.now(); A.prevDir = null;
    setTimeout(() => { if (A.mode === 'sensors' && A.ori) A.yawOffset = deviceAngles(A.ori).yaw; showIntro3D(); }, A.mode === 'sensors' ? 350 : 0);
  }
  A.phase = 'gate';
  renderGate();
  if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then((ok) => { xrOk = !!ok; if (ok && A.phase === 'gate') renderGate(); }).catch(() => {});

  // tests / debugging
  window.inkwell = {
    version: VERSION, variant, cfg, A, engine, surface, renderer, scene, camera, hud, splash, intro, L: () => L,
    look(yaw, pitch) { A.mode = A.mode === 'sensors' ? 'sensors' : 'drag'; A.dragYaw = wrapDeg(yaw); A.dragPitch = clamp(pitch, -85, 85); },
    step(n = 1, dt = 1000 / 60) { for (let i = 0; i < n; i++) { tick(A.lastFrame + dt); } render(); },
    start,
    async goStudio() {
      if (A.phase === 'gate') { await start('drag'); await new Promise((r) => setTimeout(r, 30)); }
      intro.group.visible = false; splash.panel.mesh.visible = false; goStudio();
    },
    hudTarget(id) {   // the (yaw, pitch) at which the head aims at a menu target (tests)
      const it = id.startsWith('btn:') ? L.byKey[id.slice(4)] : null; if (!it) return null;
      const u = it.cx / HUD_W, v = it.cy / HUD_H, p = new THREE.Vector3((u - 0.5) * hud.wm, (0.5 - v) * hud.hm, 0);
      hud.mesh.updateMatrixWorld(); p.applyMatrix4(hud.mesh.matrixWorld);
      return { yaw: Math.atan2(p.x, -p.z) * R2D, pitch: Math.atan2(p.y, Math.hypot(p.x, p.z)) * R2D };
    },
  };
}
