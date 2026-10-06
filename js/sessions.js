// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 17 — drawing sessions: Save (PNG + JSON) and Open (recent drawings in this browser, or a JSON file)
//   Session JSON: the drawing (PNG data URL), every app setting, the line / colour / grid selections, the agents and
//   (17a) the user's InkGaze calibration — so a session can be resumed exactly.
//   Every save is also kept in IndexedDB (the last 12 per variant): "Open Drawing" lists them as gaze-dwell targets,
//   because browsers only open a file dialog on a real click / tap (never on a dwell).
// ═══════════════════════════════════════════════════════════════════════════
import { VERSION, BUILD } from './core.js';

const DB = 'inkwell-17', STORE = 'sessions', KEEP = 12;

function stamp(d = new Date()) { return d.toISOString().slice(0, 19).replace(/[:]/g, '-'); }
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const toBlob = (canvas, type = 'image/png') => new Promise((res) => canvas.toBlob((b) => res(b), type));

function idb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('no IndexedDB')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) { const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); s.createIndex('variant', 'variant'); } };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbAll(variant) {
  const db = await idb();
  return new Promise((res, rej) => {
    const out = [], tx = db.transaction(STORE, 'readonly'), ix = tx.objectStore(STORE).index('variant').openCursor(IDBKeyRange.only(variant));
    ix.onsuccess = () => { const c = ix.result; if (c) { out.push(c.value); c.continue(); } else res(out.sort((a, b) => b.id - a.id)); };
    ix.onerror = () => rej(ix.error);
  });
}
async function idbPut(rec) {
  const db = await idb();
  await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).add(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  const all = await idbAll(rec.variant);
  if (all.length > KEEP) {
    await new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); for (const r of all.slice(KEEP)) tx.objectStore(STORE).delete(r.id); tx.oncomplete = res; tx.onerror = res; });
  }
}

// ---------------------------------------------------------------------------------------------- save
export async function saveSession({ variant, cfg, engine, surface, inkgaze }) {
  const when = new Date(), base = variant.key + '_' + stamp(when);
  const full = surface.toCanvas(8192);
  const png = await toBlob(full);
  const pngUrl = full.toDataURL('image/png');
  const thumbC = surface.toCanvas(360);
  let calibration = null;
  try { calibration = inkgaze && inkgaze.exportCalibration ? inkgaze.exportCalibration() : null; } catch (e) { calibration = null; }
  const session = {
    format: 'inkwell-session', schema: 1, build: BUILD, version: VERSION, variant: variant.id, savedAt: when.toISOString(),
    settings: JSON.parse(JSON.stringify(cfg)), state: engine.serialize(), calibration,
    drawing: { width: surface.width, height: surface.height, wrap: surface.wrap, png: pngUrl },
    credits: 'Inkwell 17 — a prototype of the SiX research project (FBAUP · FCT 2023.11224.PEX, https://six.fba.up.pt/), PI Eliana Penedos-Santiago and the SiX team. Interface, expressive line and drawing agents: Pedro Amado (FBAUP / i2ADS). Code written with Google Gemini and Anthropic Claude (Inkwell 16–17: Claude Opus 5.5).',
  };
  const json = JSON.stringify(session);
  download(png, base + '.png');
  setTimeout(() => download(new Blob([json], { type: 'application/json' }), base + '.json'), 350);
  try {
    await idbPut({ variant: variant.id, savedAt: session.savedAt, label: when.toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'short', timeStyle: 'short' }), thumb: thumbC.toDataURL('image/png'), json });
  } catch (e) { /* private mode / blocked storage: the downloads are still there */ }
  return { png: base + '.png', json: base + '.json' };
}

// ---------------------------------------------------------------------------------------------- open
export async function recentSessions(variant) {
  try {
    const all = await idbAll(variant.id);
    return all.map((r) => { const img = new Image(); img.src = r.thumb; return { id: r.id, label: r.label, img, json: r.json }; });
  } catch (e) { return []; }
}
// a JSON file chosen by the user (must run inside a click / tap handler)
export function pickSessionFile() {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json'; inp.style.display = 'none';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) { res(null); return; }
      try { res(JSON.parse(await f.text())); } catch (e) { res({ error: 'toast.badFile' }); }   // errors are i18n keys
    }, { once: true });
    document.body.appendChild(inp); inp.click();
  });
}
export function parseSession(json) {
  let s = json;
  try { if (typeof json === 'string') s = JSON.parse(json); } catch (e) { return { error: 'toast.badFile' }; }
  if (!s || s.error) return s || { error: 'toast.badFile' };
  if (s.format !== 'inkwell-session' || !s.drawing || !s.drawing.png) return { error: 'toast.notSession' };
  return s;
}
// restore: settings (minus the variant's hardware-specific ones when the variant differs), selections, agents,
// the drawing (fitted to this surface), and the InkGaze calibration (17a)
export async function applySession(s, { variant, cfg, engine, surface, getSurface, inkgaze, applyCfg }) {
  const keepLocal = s.variant !== variant.id ? ['ppd', 'headGain', 'ipd', 'distort', 'vrZoom', 'invertX', 'invertY', 'flipH', 'flipV', 'escapeDegS', 'escapeAmplitude', 'cursorSmooth'] : [];
  const next = Object.assign({}, cfg, s.settings || {});
  for (const k of keepLocal) next[k] = cfg[k];
  if (s.state) Object.assign(next, { lineMode: s.state.lineMode, thickness: s.state.thickness, color: s.state.color, gridMode: s.state.gridMode });
  applyCfg(next, s.state && s.state.boids);
  const img = new Image();
  await new Promise((res) => { img.onload = res; img.onerror = res; img.src = s.drawing.png; });
  const surf = getSurface ? getSurface() : surface;   // applyCfg may have rebuilt the surface (another canvas size)
  if (img.naturalWidth && surf) surf.loadImage(img);
  let calibration = null;
  if (s.calibration && inkgaze && inkgaze.importCalibration) { try { calibration = inkgaze.importCalibration(s.calibration); } catch (e) { calibration = { ok: false, reason: 'error' }; } }
  return { calibration };
}
