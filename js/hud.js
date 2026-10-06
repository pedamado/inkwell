// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18 — the menu (HUD): layout, hit-testing and rendering on a 2D canvas.
// Used as the screen overlay (18a / 18b) and as the texture of the VR menu panel (18c).
//   7 buttons: Line · Thickness · Colour │ ▶ Draw / ❚❚ Pause (larger) │ Grid · Undo · Options
//   Hit areas are larger than the visible buttons (cfg.hitPad: +50 % area, S3) but never overlap (≤ half the gap).
//   Pull-up submenus, the Options submenu (Clear · Save · Open · Configuration), and canvas-drawn modals (Clear
//   confirmation, Open drawing) so every action works by gaze dwell, on screen and in VR.
// No cream band under the menu (v16): only the floating bar.
// ═══════════════════════════════════════════════════════════════════════════
import { TK, COLORS, COLOR_ORDER, LINE_ORDER, THICKNESS_ORDER, GRID_ORDER, clamp, withAlpha } from './core.js';
import { t } from './i18n.js';

const G = { MOD: 112, BIG: 148, GAP: 28, PADX: 40, PADY: 18, LBL: 50, RAD: 34 };
const ITEMS = ['line', 'thickness', 'color', 'draw', 'grid', 'undo', 'options'];
const FONT = "'JetBrains Mono', ui-monospace, Menlo, monospace";

export const OPTIONS_KEYS = ['clear', 'save', 'open', 'config'];

// ---------------------------------------------------------------------------------------------- layout
export function layout(W, H, cfg, opts = {}) {
  const base = ITEMS.reduce((s, k, i) => s + (k === 'draw' ? G.BIG : G.MOD) + (i ? G.GAP : 0), 0) + 2 * G.PADX;
  const scale = opts.scale || clamp((W - 24) / base, 0.45, 1.15), fs = opts.fontScale || 1;   // fontScale: VR (text ≈ 1° tall)
  const s = scale, MOD = G.MOD * s, BIG = G.BIG * s, GAP = G.GAP * s, PADX = G.PADX * s, PADY = G.PADY * s, LBL = G.LBL * s * fs;
  const barW = base * s, barH = PADY + BIG + LBL + PADY * 0.6;
  const barX = (W - barW) / 2, barY = opts.barY != null ? opts.barY : H - barH - Math.max(14, H * 0.025);
  const cy = barY + PADY + BIG / 2;
  const pad = (r) => Math.min(r * (Math.sqrt(1 + (cfg.hitPad || 0)) - 1), GAP / 2 - 1);
  let x = barX + PADX;
  const items = ITEMS.map((key) => {
    const w = key === 'draw' ? BIG : MOD, it = { key, cx: x + w / 2, cy, r: w / 2 };
    it.hit = it.r + pad(it.r);
    x += w + GAP;
    return it;
  });
  const dividers = [items[2].cx + items[2].r + GAP / 2, items[3].cx + items[3].r + GAP / 2];
  return { W, H, s, fs, hitPad: cfg.hitPad || 0, items, byKey: Object.fromEntries(items.map((i) => [i.key, i])), barX, barY, barW, barH, cy, dividers, labelY: cy + BIG / 2 + 12 * s, gap: GAP };
}

function submenuOptions(key) {
  if (key === 'line') return LINE_ORDER.map((k) => [k, t('hud.line.' + k)]);
  if (key === 'thickness') return THICKNESS_ORDER.map((k) => [k, t('hud.thickness.' + k)]);
  if (key === 'color') return COLOR_ORDER.map((k) => [k, t('hud.color.' + k)]);
  if (key === 'grid') return GRID_ORDER.map((k) => [k, t('hud.grid.' + k)]);
  if (key === 'options') return OPTIONS_KEYS.map((k) => [k, t('hud.opt.' + k)]);
  return [];
}
export function submenuLayout(L, key) {
  const it = L.byKey[key], s = L.s, opts = submenuOptions(key), f = Math.sqrt(L.fs || 1);
  const OW = (key === 'options' ? 214 : 176) * s * f, OH = 92 * s * f, CAP = 42 * s;
  const h = CAP + opts.length * OH;
  const x = clamp(it.cx - OW / 2, 8, L.W - OW - 8), bottom = L.barY - 14 * s, top = bottom - h;
  return { key, x, top, w: OW, h, cap: { x, y: top, w: OW, h: CAP }, rects: opts.map((o, i) => ({ id: 'opt:' + key + ':' + o[0], value: o[0], label: o[1], x, y: top + CAP + i * OH, w: OW, h: OH })) };
}
export function modalLayout(L, m) {
  const s = L.s * Math.sqrt(L.fs || 1), area = { x: 0, y: 0, w: L.W, h: L.barY };
  if (m.type === 'clear') {
    const w = 560 * s, h = 300 * s, x = (L.W - w) / 2, y = clamp(area.h / 2 - h / 2, 10, area.h - h - 10);
    const bw = 210 * s, bh = 96 * s, by = y + h - bh - 30 * s;
    return { x, y, w, h, buttons: [
      { id: 'modal:cancel', label: t('modal.cancel'), x: x + 40 * s, y: by, w: bw, h: bh },
      { id: 'modal:confirm', label: t('modal.clear'), x: x + w - 40 * s - bw, y: by, w: bw, h: bh, danger: true },
    ] };
  }
  if (m.type === 'open') {
    const n = Math.min(6, (m.items || []).length), cols = 3, tw = 220 * s, th = 150 * s, gx = 24 * s;
    const w = cols * tw + (cols + 1) * gx, rows = Math.max(1, Math.ceil(n / cols));
    const h = 92 * s + rows * (th + gx) + 118 * s, x = (L.W - w) / 2, y = clamp(area.h / 2 - h / 2, 10, Math.max(10, area.h - h - 10));
    const items = (m.items || []).slice(0, 6).map((it, i) => ({ id: 'modal:item:' + i, item: it, x: x + gx + (i % cols) * (tw + gx), y: y + 92 * s + Math.floor(i / cols) * (th + gx), w: tw, h: th }));
    const by = y + h - 96 * s, bw = 250 * s;
    return { x, y, w, h, items, buttons: [
      { id: 'modal:file', label: t('modal.loadFile'), x: x + gx, y: by, w: bw, h: 76 * s, note: t('modal.clickTap') },
      { id: 'modal:cancel', label: t('modal.cancel'), x: x + w - gx - 200 * s, y: by, w: 200 * s, h: 76 * s },
    ] };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- hit-testing
// returns: 'btn:<key>' · 'opt:<menu>:<value>' · 'opt:close' · 'modal:…' · 'modal:panel' · 'scrim' · 'scrim-far' ·
//          'zone' (on the menu bar but not a button) · null (the canvas)
export function hit(L, S, p) {
  if (!p) return null;
  const inR = (r, gx = 0, gy = 0) => p.x >= r.x - gx && p.x <= r.x + r.w + gx && p.y >= r.y - gy && p.y <= r.y + r.h + gy;
  if (S.modal) {
    const M = modalLayout(L, S.modal);
    if (M) {
      // 16.1: modal buttons get the same invisible allowance as the menu (webcam gaze wobbles 2–4°), never overlapping
      const k = Math.sqrt(1 + (L.hitPad || 0)) - 1, cap = 10 * L.s;
      for (const b of M.buttons) if (inR(b, Math.min(b.w * k / 2, cap), b.h * k / 2)) return b.id;
      for (const it of M.items || []) if (inR(it, Math.min(it.w * k / 2, cap), Math.min(it.h * k / 2, cap))) return it.id;
      if (inR(M)) return 'modal:panel';
      // looking well away from the modal (a dwell of 1.5× the menu dwell) dismisses it: the eyes are never trapped
      const far = 140 * L.s;
      if (p.x < M.x - far || p.x > M.x + M.w + far || p.y < M.y - far || p.y > M.y + M.h + far) return 'scrim-far';
    }
    return 'scrim';
  }
  if (S.submenu) {
    const sm = submenuLayout(L, S.submenu);
    for (const r of sm.rects) if (inR(r)) return r.id;
    if (inR(sm.cap)) return 'opt:close';
    const it = L.byKey[S.submenu];
    if (Math.hypot(p.x - it.cx, p.y - it.cy) <= it.hit) return 'btn:' + S.submenu;
    const far = p.x < sm.x - 260 * L.s || p.x > sm.x + sm.w + 260 * L.s || p.y < sm.top - 220 * L.s;
    return far ? 'scrim-far' : 'scrim';
  }
  for (const it of L.items) if (Math.hypot(p.x - it.cx, p.y - it.cy) <= it.hit) return 'btn:' + it.key;
  if (p.x >= L.barX - 10 && p.x <= L.barX + L.barW + 10 && p.y >= L.barY - 18 * L.s && p.y <= L.barY + L.barH + 10) return 'zone';
  return null;
}
// the screen centre of a dwell target (for InkGaze's learn(): the user WAS looking there)
export function targetCentre(L, S, id) {
  if (!id) return null;
  if (id.startsWith('btn:')) { const it = L.byKey[id.slice(4)]; return it ? { x: it.cx, y: it.cy } : null; }
  if (id.startsWith('opt:') && S.submenu) { const r = submenuLayout(L, S.submenu).rects.find((q) => q.id === id); return r ? { x: r.x + r.w / 2, y: r.y + r.h * 0.4 } : null; }
  if (id.startsWith('modal:') && S.modal) {
    const M = modalLayout(L, S.modal), r = M && M.buttons.concat(M.items || []).find((q) => q.id === id);
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- rendering
function rr(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
export function arc(c, x, y, r, frac, color, lw = 3.5) {
  frac = clamp(frac, 0, 1); if (frac <= 0) return;
  c.beginPath(); c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.stroke(); c.lineCap = 'butt';
}
function wave(c, cx, cy, s, amp, lw, color) {
  c.strokeStyle = color; c.lineWidth = lw * s; c.lineCap = 'round'; c.beginPath();
  for (let i = 0; i <= 26; i++) { const x = cx + (-13 + i) * s, y = cy + Math.sin(i / 26 * Math.PI * 2) * amp * s; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.stroke();
}
const LINE_ICON = { rigid: [2.2, 3.2], dynamic: [5, 2.4], fluid: [8, 1.6] };
const THICK_ICON = { thin: 2.4, medium: 5.2, thick: 9.5 };
export function icon(c, key, value, cx, cy, s, color, extra = {}) {
  c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
  if (key === 'line') { const [amp, lw] = LINE_ICON[value] || LINE_ICON.dynamic; wave(c, cx, cy, s, amp, lw, color); }
  else if (key === 'thickness') { c.lineWidth = (THICK_ICON[value] || 5) * s; c.beginPath(); c.moveTo(cx - 9 * s, cy + 9 * s); c.lineTo(cx + 9 * s, cy - 9 * s); c.stroke(); }
  else if (key === 'color') {
    const hex = (COLORS[value] || COLORS.black).hex;
    c.beginPath(); c.arc(cx, cy, 12 * s, 0, Math.PI * 2); c.fillStyle = hex; c.fill();
    if (value === 'white') { c.lineWidth = 1.5 * s; c.strokeStyle = TK.divider; c.stroke(); }
  } else if (key === 'draw') {
    if (extra.on) { c.fillRect(cx - 10 * s, cy - 13 * s, 7 * s, 26 * s); c.fillRect(cx + 3 * s, cy - 13 * s, 7 * s, 26 * s); }
    else { c.beginPath(); c.moveTo(cx - 8 * s, cy - 14 * s); c.lineTo(cx + 14 * s, cy); c.lineTo(cx - 8 * s, cy + 14 * s); c.closePath(); c.fill(); }
  } else if (key === 'grid') {
    if (value === 'off') { c.lineWidth = 2.4 * s; c.beginPath(); for (let i = 0; i <= 24; i++) { const x = cx + (-10 + i * 0.85) * s, y = cy + Math.sin(i / 3) * 5 * s; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
    else for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) {
      c.beginPath(); c.arc(cx + ix * 9 * s, cy + iy * 9 * s, 2.8 * s, 0, Math.PI * 2);
      if (value === 'always') c.fill();
      else if (value === 'feedback') { c.fillStyle = withAlpha(TK.ink, ix === 0 && iy === 0 ? 1 : 0.22); c.fill(); }
      else { c.lineWidth = 1.2 * s; c.stroke(); }
    }
  } else if (key === 'undo') {
    c.lineWidth = 2.4 * s;
    c.beginPath(); c.arc(cx + s, cy + s, 9 * s, Math.PI * 0.9, Math.PI * 2.15); c.stroke();
    c.beginPath(); c.moveTo(cx - 8 * s, cy - 6 * s); c.lineTo(cx - 9.5 * s, cy + 2.5 * s); c.lineTo(cx - 1 * s, cy + 1 * s); c.stroke();
  } else if (key === 'options') {
    for (const dy of [-9, 0, 9]) { c.beginPath(); c.arc(cx, cy + dy * s, 3 * s, 0, Math.PI * 2); c.fill(); }
  } else if (key === 'clear') {
    c.lineWidth = 2.2 * s;
    c.beginPath(); c.moveTo(cx - 10 * s, cy - 7 * s); c.lineTo(cx + 10 * s, cy - 7 * s); c.stroke();
    c.beginPath(); c.moveTo(cx - 4 * s, cy - 7 * s); c.lineTo(cx - 4 * s, cy - 10 * s); c.lineTo(cx + 4 * s, cy - 10 * s); c.lineTo(cx + 4 * s, cy - 7 * s); c.stroke();
    c.beginPath(); c.moveTo(cx - 8 * s, cy - 7 * s); c.lineTo(cx - 6.5 * s, cy + 10 * s); c.lineTo(cx + 6.5 * s, cy + 10 * s); c.lineTo(cx + 8 * s, cy - 7 * s); c.stroke();
  } else if (key === 'save' || key === 'open') {
    c.lineWidth = 2.4 * s;
    c.beginPath(); c.moveTo(cx - 11 * s, cy + 4 * s); c.lineTo(cx - 11 * s, cy + 11 * s); c.lineTo(cx + 11 * s, cy + 11 * s); c.lineTo(cx + 11 * s, cy + 4 * s); c.stroke();
    c.beginPath(); c.moveTo(cx, cy - 12 * s); c.lineTo(cx, cy + 5 * s); c.stroke();
    c.beginPath();
    if (key === 'save') { c.moveTo(cx - 6 * s, cy - 1 * s); c.lineTo(cx, cy + 5 * s); c.lineTo(cx + 6 * s, cy - 1 * s); }
    else { c.moveTo(cx - 6 * s, cy - 6 * s); c.lineTo(cx, cy - 12 * s); c.lineTo(cx + 6 * s, cy - 6 * s); }
    c.stroke();
  } else if (key === 'config') {
    c.lineWidth = 2.2 * s;
    for (const [y, k] of [[-7, 4], [0, -5], [7, 1]]) {
      c.beginPath(); c.moveTo(cx - 11 * s, cy + y * s); c.lineTo(cx + 11 * s, cy + y * s); c.stroke();
      c.beginPath(); c.arc(cx + k * s, cy + y * s, 3.2 * s, 0, Math.PI * 2); c.fillStyle = TK.button; c.fill(); c.stroke();
    }
  }
  c.restore();
}
function valueOf(eng, key) {
  const c = eng.cfg;
  return { line: c.lineMode, thickness: c.thickness, color: c.color, grid: c.gridMode }[key];
}
export function labelOf(eng, key) {
  const c = eng.cfg;
  switch (key) {
    case 'line': return t('hud.line.' + c.lineMode);
    case 'thickness': return t('hud.thickness.' + c.thickness);
    case 'color': return t('hud.color.' + c.color);
    case 'draw': return t(eng.S.drawMode ? 'hud.draw.on' : 'hud.draw.off');
    case 'grid': return t('hud.grid.' + c.gridMode);
    case 'undo': return t('hud.undo');
    case 'options': return t('hud.options');
    default: return '';
  }
}
// one line of text shrunk to fit maxW (translations differ in length)
function fitText(c, text, x, y, maxW) {
  const w = c.measureText(text).width;
  if (w <= maxW) { c.fillText(text, x, y); return; }
  const m = /(\d+(?:\.\d+)?)px/.exec(c.font), px = m ? +m[1] : 14;
  const f = c.font; c.font = f.replace(/\d+(?:\.\d+)?px/, Math.max(9, Math.floor(px * maxW / w)) + 'px'); c.fillText(text, x, y); c.font = f;
}
function wrapLabel(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return [text];
  const words = text.split(' '); let a = words[0];
  for (let i = 1; i < words.length; i++) { const t = a + ' ' + words[i]; if (c.measureText(t).width > maxW) return [a, words.slice(i).join(' ')]; a = t; }
  return [a];
}

export function render(c, L, eng, now) {
  const S = eng.S, s = L.s;
  // the floating bar (no band behind it)
  c.save(); c.shadowColor = 'rgba(25,24,23,0.14)'; c.shadowBlur = 36 * s; c.shadowOffsetY = 8 * s;
  c.fillStyle = TK.panel; rr(c, L.barX, L.barY, L.barW, L.barH, G.RAD * s); c.fill(); c.restore();
  c.fillStyle = TK.divider;
  for (const dx of L.dividers) c.fillRect(dx - 2 * s, L.cy - 40 * s, 4 * s, 80 * s);
  const hover = !S.submenu && !S.modal ? S.hoverId : null;
  for (const it of L.items) {
    const id = 'btn:' + it.key, isHover = hover === id || (S.submenu && S.hoverId === id);
    const active = (it.key === 'draw' && S.drawMode) || S.submenu === it.key;
    c.save(); c.shadowColor = 'rgba(25,24,23,0.10)'; c.shadowBlur = (isHover ? 22 : 8) * s; c.shadowOffsetY = (isHover ? 7 : 2) * s;
    c.fillStyle = it.key === 'draw' && S.drawMode ? TK.red : TK.button;
    c.beginPath(); c.arc(it.cx, it.cy, it.r, 0, Math.PI * 2); c.fill(); c.restore();
    const ic = it.key === 'draw' && S.drawMode ? '#ffffff' : TK.ink;
    icon(c, it.key, valueOf(eng, it.key), it.cx, it.cy, s * (it.key === 'draw' ? 1.25 : 1.05), ic, { on: S.drawMode });
    if (isHover || active) {
      c.beginPath(); c.arc(it.cx, it.cy, it.r * 0.6, 0, Math.PI * 2);
      c.strokeStyle = it.key === 'draw' && S.drawMode ? 'rgba(255,255,255,0.55)' : active ? TK.red : 'rgba(25,24,23,0.18)';
      c.lineWidth = (active ? 4 : 3) * s; c.stroke();
    }
    const pr = eng.dwellProgress(id);
    if (pr > 0) arc(c, it.cx, it.cy, it.r * 0.74, pr, it.key === 'draw' && S.drawMode ? '#ffffff' : TK.red, 4 * s);
    // label (one or two lines), the value of the control
    const fs = Math.max(10, Math.round(14.5 * s * (L.fs || 1)));
    c.font = `700 ${fs}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillStyle = active ? TK.red : TK.ink;
    const lines = wrapLabel(c, labelOf(eng, it.key), (it.key === 'draw' ? G.BIG : G.MOD) * s + L.gap - 6 * s);
    lines.forEach((t, i) => c.fillText(t, it.cx, L.labelY + i * (fs + 3 * s)));
  }
  if (S.submenu) renderSubmenu(c, L, eng);
  if (S.modal) renderModal(c, L, eng, now);
}

function renderSubmenu(c, L, eng) {
  const S = eng.S, s = L.s, sm = submenuLayout(L, S.submenu);
  c.save(); c.shadowColor = 'rgba(25,24,23,0.16)'; c.shadowBlur = 36 * s; c.shadowOffsetY = 8 * s;
  c.fillStyle = TK.panel; rr(c, sm.x, sm.top, sm.w, sm.h, 24 * s); c.fill(); c.restore();
  c.fillStyle = S.hoverId === 'opt:close' ? TK.red : TK.muted;
  c.font = `500 ${Math.round(17 * s)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('✕', sm.cap.x + sm.cap.w / 2, sm.cap.y + sm.cap.h / 2);
  const pc = eng.dwellProgress('opt:close'); if (pc > 0) arc(c, sm.cap.x + sm.cap.w / 2, sm.cap.y + sm.cap.h / 2, 14 * s, pc, TK.red, 3 * s);
  const cur = valueOf(eng, S.submenu);
  for (const r of sm.rects) {
    const gy = r.y + r.h * 0.36, selected = r.value === cur, isHover = S.hoverId === r.id;
    if (isHover) { c.fillStyle = TK.redSoft; rr(c, r.x + 8 * s, r.y + 5 * s, r.w - 16 * s, r.h - 10 * s, 16 * s); c.fill(); }
    icon(c, S.submenu === 'options' ? r.value : S.submenu, r.value, r.x + r.w / 2, gy, s, r.value === 'clear' ? TK.red : TK.ink);
    const fs = Math.max(10, Math.round(13.5 * s * (L.fs || 1)));
    c.font = `${selected ? 700 : 500} ${fs}px ${FONT}`; c.fillStyle = selected ? TK.red : r.value === 'clear' ? TK.red : TK.ink;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    fitText(c, r.label, r.x + r.w / 2, r.y + r.h - 22 * s, r.w - 14 * s);
    const p = eng.dwellProgress(r.id); if (p > 0) arc(c, r.x + r.w / 2, gy, 24 * s, p, TK.red, 3.5 * s);
  }
}

function renderModal(c, L, eng, now) {
  const S = eng.S, s = L.s * Math.sqrt(L.fs || 1), m = S.modal, M = modalLayout(L, m);
  if (!M) return;
  c.fillStyle = 'rgba(250,249,247,0.62)'; c.fillRect(0, 0, L.W, L.H);
  c.save(); c.shadowColor = m.type === 'clear' ? 'rgba(230,60,34,0.22)' : 'rgba(25,24,23,0.16)'; c.shadowBlur = 40 * s; c.shadowOffsetY = 8 * s;
  c.fillStyle = TK.button; rr(c, M.x, M.y, M.w, M.h, 26 * s); c.fill(); c.restore();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (m.type === 'clear') {
    c.strokeStyle = TK.red; c.lineWidth = 2 * s; rr(c, M.x, M.y, M.w, M.h, 26 * s); c.stroke();
    c.fillStyle = TK.ink; c.font = `700 ${Math.round(24 * s)}px ${FONT}`; fitText(c, t('modal.clearTitle'), M.x + M.w / 2, M.y + 58 * s, M.w - 40 * s);
    c.fillStyle = TK.label; c.font = `500 ${Math.round(15 * s)}px ${FONT}`;
    fitText(c, t('modal.clearBody1'), M.x + M.w / 2, M.y + 100 * s, M.w - 40 * s);
    fitText(c, t('modal.clearBody2'), M.x + M.w / 2, M.y + 124 * s, M.w - 40 * s);
  } else if (m.type === 'open') {
    c.fillStyle = TK.ink; c.font = `700 ${Math.round(22 * s)}px ${FONT}`; fitText(c, t('modal.openTitle'), M.x + M.w / 2, M.y + 46 * s, M.w - 40 * s);
    if (!M.items.length) { c.fillStyle = TK.label; c.font = `500 ${Math.round(15 * s)}px ${FONT}`; fitText(c, t('modal.openEmpty'), M.x + M.w / 2, M.y + 150 * s, M.w - 40 * s); }
    for (const it of M.items) {
      const isHover = S.hoverId === it.id;
      c.fillStyle = isHover ? TK.redSoft : TK.panel; rr(c, it.x, it.y, it.w, it.h, 14 * s); c.fill();
      const img = it.item.img;
      if (img && img.complete && img.naturalWidth) {
        const k = Math.min((it.w - 16 * s) / img.naturalWidth, (it.h - 44 * s) / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
        c.drawImage(img, it.x + (it.w - dw) / 2, it.y + 8 * s + (it.h - 44 * s - dh) / 2, dw, dh);
      }
      c.fillStyle = TK.ink; c.font = `500 ${Math.round(12 * s)}px ${FONT}`; c.fillText(it.item.label || '', it.x + it.w / 2, it.y + it.h - 18 * s);
      const p = eng.dwellProgress(it.id); if (p > 0) arc(c, it.x + it.w / 2, it.y + (it.h - 36 * s) / 2 + 4 * s, 28 * s, p, TK.red, 4 * s);
    }
  }
  for (const b of M.buttons) {
    const isHover = S.hoverId === b.id, pr = eng.dwellProgress(b.id);
    c.fillStyle = b.danger ? (isHover ? '#c8301a' : TK.red) : (isHover ? TK.redSoft : TK.panel);
    rr(c, b.x, b.y, b.w, b.h, 18 * s); c.fill();
    if (pr > 0) {   // a filling bar: the destructive confirm is visibly different (longer, red, cancels on exit)
      c.save(); rr(c, b.x, b.y, b.w, b.h, 18 * s); c.clip();
      c.fillStyle = b.danger ? 'rgba(255,255,255,0.28)' : 'rgba(230,60,34,0.18)'; c.fillRect(b.x, b.y, b.w * pr, b.h); c.restore();
    }
    c.fillStyle = b.danger ? '#ffffff' : TK.ink; c.font = `700 ${Math.round(19 * s)}px ${FONT}`;
    fitText(c, b.label, b.x + b.w / 2, b.y + b.h / 2 - (b.note ? 8 * s : 0), b.w - 16 * s);
    if (b.note) { c.font = `500 ${Math.round(11 * s)}px ${FONT}`; c.fillStyle = TK.muted; c.fillText(b.note, b.x + b.w / 2, b.y + b.h / 2 + 16 * s); }
  }
}

// ---------------------------------------------------------------------------------------------- the gaze cursor (2D)
// As in the HTC Vive app, the cursor HIDES while a line is drawn (cfg.cursorDrawing, default off): a visible cursor
// invites the eyes to follow it and drift. Paused (Draw off, after an escape or a dwell stop) it is a dashed 40 %-black
// circle (cfg.cursorPaused, default on); armed (Draw on, a dwell will start the line) it adds a small red centre dot.
// The canvas-dwell progress arc is feedback, not a cursor: it shows whenever a dwell is filling.
export function cursorState(eng) {
  const S = eng.S;
  if (S.drawMode && (S.penDown || (eng.gridMode && S.grid.active))) return 'drawing';
  return S.drawMode ? 'armed' : 'rest';
}
export function cursorVisible(eng, state = cursorState(eng)) { return state === 'drawing' ? !!eng.cfg.cursorDrawing : eng.cfg.cursorPaused !== false; }
export function reticle(c, x, y, eng, opts = {}) {
  const S = eng.S, R = opts.r || 30, st = cursorState(eng), flashing = S.now < S.flashUntil;
  if (cursorVisible(eng, st)) {
    c.save();
    if (st === 'drawing') {   // circle with a dot in the centre, in the pen colour
      const col = eng.color === '#ffffff' ? TK.muted : eng.color;
      c.globalAlpha = 0.5; c.strokeStyle = flashing ? TK.red : col; c.fillStyle = col; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
    } else {                  // dashed 40 %-black circle (+ red dot when armed)
      c.setLineDash([5, 6]); c.lineWidth = 2; c.strokeStyle = flashing ? TK.red : 'rgba(25,24,23,0.4)';
      c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      if (st === 'armed') { c.beginPath(); c.arc(x, y, 2.6, 0, Math.PI * 2); c.fillStyle = 'rgba(230,60,34,0.75)'; c.fill(); }
    }
    c.restore();
  }
  const p = eng.canvasProgress();
  if (p > 0 && !S.overHud) arc(c, x, y, R + 6, p, S.penDown ? 'rgba(25,24,23,0.55)' : TK.red, 4);
  if (opts.label) {
    c.save(); c.globalAlpha = 0.85; c.textAlign = 'center'; c.textBaseline = 'top';
    c.font = `500 12px ${FONT}`; c.fillStyle = TK.label; c.fillText(opts.label, x, y + R + 10); c.restore();
  }
}
