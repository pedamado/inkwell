// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18 — DOM screens: intro dots · gate · welcome (splash) · About · Help · Configuration · toasts · languages ·
// the reach calibration (18d)
// Everything here is gaze-operable (GazeDom: dwell with a progress ring, exit grace, target allowance) and clickable
// (18d: also a finger tap).
// Every text comes from the language files (i18n/*.json) through t().
// ═══════════════════════════════════════════════════════════════════════════
import { VERSION, BUILD_NO, THICKNESS, THICKNESS_ORDER, LINE_ORDER, COLOR_ORDER, PRESETS, AGENT_RANGE, VIEW_SCALE, viewScale, chime, unlockAudio, clamp, getPath } from './core.js';
import { t, has, lang, langMeta, languages, setLanguage, addLanguageFile, removeLanguageFile, exportLanguage } from './i18n.js';

// The Help page's tutorial: paste a YouTube video id here (e.g. 'dQw4w9WgXcQ') and it replaces the placeholder.
export const HELP_VIDEO_ID = '';
// The funding statement is used verbatim in every language (project rule).
const FUNDING = 'This work is financed by national funds through the Portuguese funding agency, FCT — Fundação para a Ciência e a Tecnologia, within the project «2023.11224.PEX» [DOI 10.54499/2023.11224.PEX].';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SIX_LINK = '<a href="https://six.fba.up.pt/" target="_blank" rel="noopener">SiX</a>';
export const variantName = (v) => BUILD_NO + v.id + ' · ' + t('variant.' + v.id);
export const variantTitle = (v) => t('variant.title', { id: BUILD_NO + v.id, name: t('variant.' + v.id) });

export const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  about: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10.6v6.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.4" r="1.35" fill="currentColor"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.4 9.3a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.3 1-1.3 1.9v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.3" fill="currentColor"/></svg>',
  config: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="15" cy="7" r="2.4" fill="#fff" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="12" r="2.4" fill="#fff" stroke="currentColor" stroke-width="2"/><circle cx="13" cy="17" r="2.4" fill="#fff" stroke="currentColor" stroke-width="2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.8 12h18.4M12 2.8c2.6 2.6 3.9 5.6 3.9 9.2s-1.3 6.6-3.9 9.2c-2.6-2.6-3.9-5.6-3.9-9.2S9.4 5.4 12 2.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5 12 8.5l6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5l6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>',
  mouse: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="3" width="11" height="18" rx="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6.5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  hand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 12.5V4.6a1.6 1.6 0 0 1 3.2 0v6.2m0-.6a1.6 1.6 0 0 1 3.2 0v1.2m0-.4a1.6 1.6 0 0 1 3.1.4v4.1c0 3.3-2.5 5.9-5.8 5.9h-.9a5.6 5.6 0 0 1-4.5-2.3l-2.6-3.6a1.6 1.6 0 0 1 2.4-2.1l2 1.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  vr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5c0-1.4 1.1-2.5 2.5-2.5h13c1.4 0 2.5 1.1 2.5 2.5v6c0 1.4-1.1 2.5-2.5 2.5h-3.2l-2-2.4a1.7 1.7 0 0 0-2.6 0L8.7 17H5.5A2.5 2.5 0 0 1 3 14.5z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="11.3" r="1.8" fill="currentColor"/><circle cx="16" cy="11.3" r="1.8" fill="currentColor"/></svg>',
};

// ═══ GazeDom: dwell activation of DOM elements ═══════════════════════════════
// targets: {el, fire, ms?, round?, radius?}; the hit area is the element grown by cfg.hitPad (area), circles for
// round targets. Feedback: class "gazed" + CSS var --dwell (0..1) for a progress ring; a fired target needs the gaze
// to leave first. onFire(el) (optional) runs before the target's own action (InkGaze learn(): the user WAS looking there).
export class GazeDom {
  constructor(cfg) { this.cfg = cfg; this.targets = []; this.cur = null; this.t = 0; this.lastIn = 0; this.needLeave = null; this.onFire = null; }
  add(el, fire, opts = {}) { const tg = Object.assign({ el, fire }, opts); this.targets.push(tg); return tg; }
  clear() { for (const tg of this.targets) this._paint(tg, 0, false); this.targets = []; this.cur = null; this.t = 0; }
  removeWithin(root) { this.targets = this.targets.filter((tg) => { const keep = !root.contains(tg.el); if (!keep) this._paint(tg, 0, false); return keep; }); if (this.cur && !this.targets.includes(this.cur)) { this.cur = null; this.t = 0; } }
  _visible(el) { if (!el.isConnected || el.disabled) return false; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; return !el.closest('[hidden], .hidden, [inert]'); }
  _hit(tg, p) {
    const r = tg.el.getBoundingClientRect(), k = Math.sqrt(1 + (this.cfg.hitPad || 0));
    if (tg.round || tg.radius) { const R = tg.radius || (r.width / 2) * k; return Math.hypot(p.x - (r.left + r.width / 2), p.y - (r.top + r.height / 2)) <= R; }
    const gx = r.width * (k - 1) / 2, gy = r.height * (k - 1) / 2;
    return p.x >= r.left - gx && p.x <= r.right + gx && p.y >= r.top - gy && p.y <= r.bottom + gy;
  }
  update(p, dt, now) {
    let hit = null;
    if (p) for (const tg of this.targets) if (this._visible(tg.el) && this._hit(tg, p)) { hit = tg; break; }
    if (this.needLeave && hit !== this.needLeave) this.needLeave = null;
    if (hit && hit === this.needLeave) hit = null;
    // a brief excursion (onto nothing or another target) within the grace only pauses the current dwell (16.1)
    if (hit && hit === this.cur) { this.t += dt; this.lastIn = now; }
    else if (this.cur && now - this.lastIn <= this.cfg.graceMs) { /* hold */ }
    else if (hit) { if (this.cur) this._paint(this.cur, 0, false); this.cur = hit; this.t = 0; this.lastIn = now; }
    else if (this.cur) { this._paint(this.cur, 0, false); this.cur = null; this.t = 0; }
    for (const tg of this.targets) if (tg !== this.cur) this._paint(tg, 0, false);
    if (this.cur) {
      const need = this.cur.ms || this.cfg.menuDwellMs, k = clamp(this.t / need, 0, 1);
      this._paint(this.cur, k, hit === this.cur);
      if (this.t >= need) {
        const f = this.cur; this._paint(f, 0, false); this.cur = null; this.t = 0; this.needLeave = f;
        if (this.onFire) { try { this.onFire(f.el); } catch (e) { /* learning is optional */ } }
        f.fire(f.el, 'gaze');
      }
    }
    return hit;
  }
  // a click at p (18d: a finger tap): the dwell target under it fires at once (then, as after a dwell, p must leave it)
  press(p) {
    const tg = this.targets.find((g) => this._visible(g.el) && this._hit(g, p));
    if (!tg) return false;
    if (this.cur) this._paint(this.cur, 0, false);
    this.cur = null; this.t = 0; this.needLeave = tg;
    if (this.onFire) { try { this.onFire(tg.el); } catch (e) { /* learning is optional */ } }
    tg.fire(tg.el, 'tap');
    return true;
  }
  _paint(tg, k, on) { tg.el.style.setProperty('--dwell', k.toFixed(3)); tg.el.classList.toggle('gazed', !!on); }
}

// ═══ 18.1: the menu size also scales the DOM screens (start, intro dots, welcome, About / Help) and the toasts (CSS) ═══
// The Configuration keeps its size, so the setting can always be undone. At ×1 nothing is set at all. Larger sizes stop
// at what the window holds (the welcome screen fits ×1.5 in 1024 × 768: W / 680, H / 510) → the size shown
export function menuScaleDom(m) {
  let z = viewScale(m);
  if (z > 1) z = Math.min(z, Math.max(1, Math.min(window.innerWidth / 680, window.innerHeight / 510)));
  const on = Math.abs(z - 1) > 0.001, b = document.body;
  b.classList.toggle('menu-scaled', on);
  if (on) b.style.setProperty('--menu-scale', z.toFixed(3)); else b.style.removeProperty('--menu-scale');
  return z;
}
const domScale = () => parseFloat(document.body.style.getPropertyValue('--menu-scale')) || 1;   // the screens' size now

// ═══ toasts ═══════════════════════════════════════════════════════════════════
let toastT = 0;
export function toast(text, ms = 2600) {
  let el = $('#toast'); if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
}

// ═══ language switcher (welcome screen, gate) ════════════════════════════════
// one chip per language (its own name), gaze-dwell or click; the current one is marked
export function languageSwitch({ gaze, onPick }) {
  const box = h('div', { class: 'langs', role: 'group', 'aria-label': t('common.language') }, h('span', { class: 'langs-icon', html: ICONS.globe }));
  for (const l of languages()) {
    const on = l.code === lang();
    const b = h('button', { class: 'lang-chip' + (on ? ' on' : ''), type: 'button', lang: l.code, 'aria-pressed': on ? 'true' : 'false', text: l.nativeName });
    const pick = () => { if (l.code !== lang()) onPick(l.code); };
    b.addEventListener('click', pick);
    gaze.add(b, pick);
    box.append(b);
  }
  return box;
}

// ═══ intro: three dots ════════════════════════════════════════════════════════
// centres of the left third, the middle and the right third (x = W/6, W/2, 5W/6), vertically centred. 64 px (the
// upper bound asked for: webcam gaze is ~2–4° accurate) + an invisible hit area of ≥ 1.6°.
export function showIntro({ root, gaze, cfg, ppd, hint, onDone }) {
  const sec = h('section', { class: 'screen intro', 'aria-label': t('intro.aria', { hint }) }, h('p', { class: 'intro-hint', text: hint }));
  const xs = [1 / 6, 1 / 2, 5 / 6];
  let popped = 0;
  xs.forEach((fx, i) => {
    const d = h('button', { class: 'idot', type: 'button', 'aria-label': t('intro.dot', { n: i + 1 }), style: `left:${fx * 100}%` });
    sec.append(d);
    const fire = () => {
      if (d.classList.contains('popped')) return;
      d.classList.add('popped'); chime([0, 4, 7][popped] || 0); popped++;
      if (popped === 3) setTimeout(() => { sec.classList.add('leaving'); setTimeout(() => { gaze.removeWithin(sec); sec.remove(); onDone(); }, 380); }, 520);
    };
    d.addEventListener('click', () => { unlockAudio(); fire(); });
    gaze.add(d, fire, { radius: Math.max(32 * domScale() * Math.sqrt(1 + cfg.hitPad), 1.6 * ppd) });   // 18.1: × the screens' size
  });
  root.append(sec);
  return sec;
}

// ═══ gate: the first screen of a variant (18a: while InkGaze has the stage; 18b / 18c: Start; 18d: the camera) ═══════
// buttons: {label, icon?, fn?, href?, primary?, click? (click only: not a gaze target — e.g. before calibration)}
export function showGate({ root, gaze, variant, message = '', kind = '', buttons = [], onLanguage, extra = null }) {
  const msg = h('p', { class: 'gate-msg' + (kind ? ' ' + kind : ''), role: 'status', 'aria-live': 'polite', text: message });
  const row = h('div', { class: 'gate-actions' });
  for (const b of buttons) {
    const el = b.href ? h('a', { class: 'btn' + (b.primary ? ' primary' : ''), href: b.href }) : h('button', { class: 'btn' + (b.primary ? ' primary' : ''), type: 'button' });
    el.innerHTML = (b.icon && ICONS[b.icon] ? ICONS[b.icon] : '') + '<span>' + esc(b.label) + '</span>';
    if (b.fn) el.addEventListener('click', () => b.fn());
    if (!b.click) gaze.add(el, () => (b.href ? (location.href = b.href) : b.fn && b.fn()));
    row.append(el);
  }
  const sec = h('section', { class: 'screen gate', 'aria-label': variantTitle(variant) },
    onLanguage ? languageSwitch({ gaze, onPick: onLanguage }) : null,
    h('div', { class: 'gate-main' }, h('h1', { class: 'logo', text: 'inkwell' }), h('p', { class: 'kicker', html: SIX_LINK + ' · ' + esc(variantName(variant)) }), msg, row, extra));
  root.append(sec);
  return {
    el: sec,
    setMessage(text, k = '') { msg.textContent = text; msg.className = 'gate-msg' + (k ? ' ' + k : ''); },
    close(now) { gaze.removeWithin(sec); if (now) { sec.remove(); return; } sec.classList.add('leaving'); setTimeout(() => sec.remove(), 320); },
  };
}

// ═══ welcome screen (splash) ══════════════════════════════════════════════════
export function showSplash({ root, gaze, variant, onPlay, onAbout, onHelp, onConfig, onLanguage }) {
  const play = h('button', { class: 'cta-play', type: 'button', html: ICONS.play + '<span>' + esc(t('splash.play')) + '</span>' });
  const link = (key, text, fn) => { const a = h('button', { class: 'link', type: 'button', html: ICONS[key] + '<span>' + esc(text) + '</span>' }); a.addEventListener('click', fn); gaze.add(a, fn); return a; };
  const sec = h('section', { class: 'screen splash' },
    languageSwitch({ gaze, onPick: onLanguage }),
    h('div', { class: 'splash-main' },
      h('h1', { class: 'logo', text: 'inkwell' }),
      h('p', { class: 'kicker', html: t('splash.kicker', { variant: esc(variantName(variant)) }) }),
      play),
    h('div', { class: 'splash-foot' },
      h('nav', { class: 'links', 'aria-label': t('splash.more') }, link('about', t('splash.about'), onAbout), link('help', t('splash.help'), onHelp), link('config', t('splash.config'), onConfig)),
      // the short credit: the SiX project and its PI first (the full credits are in About)
      h('p', { class: 'splash-credit', html: t('splash.credit1') + '<br>' + t('splash.credit2') })));
  play.addEventListener('click', () => { unlockAudio(); onPlay(); });
  gaze.add(play, () => onPlay());
  root.append(sec);
  return sec;
}

// ═══ pages: About · Help ══════════════════════════════════════════════════════
function page({ root, gaze, title, html, onBack }) {
  const body = h('div', { class: 'page-body', html });
  const back = h('button', { class: 'page-back', type: 'button', html: ICONS.back + '<span>' + esc(t('common.back')) + '</span>' });
  const up = h('button', { class: 'page-scroll up', type: 'button', 'aria-label': t('common.scrollUp'), html: ICONS.up });
  const down = h('button', { class: 'page-scroll down', type: 'button', 'aria-label': t('common.scrollDown'), html: ICONS.down });
  const sec = h('section', { class: 'screen page', 'aria-label': title }, h('header', { class: 'page-head' }, back, h('h2', { text: title })), body, up, down);
  const scroll = (dir) => body.scrollBy({ top: dir * body.clientHeight * 0.6, behavior: 'smooth' });
  const close = () => { gaze.removeWithin(sec); sec.remove(); onBack(); };
  back.addEventListener('click', close); up.addEventListener('click', () => scroll(-1)); down.addEventListener('click', () => scroll(1));
  gaze.add(back, close); gaze.add(up, () => scroll(-1), { ms: 600 }); gaze.add(down, () => scroll(1), { ms: 600 });
  root.append(sec);
  return sec;
}
export function showAbout(o) {
  const m = langMeta(), tr = m.translators && lang() !== 'en' ? `<p class="hint">${esc(t('about.translation', { translators: m.translators }))}</p>` : '';
  return page(Object.assign({ title: t('about.title'), html: t('about.html', { version: VERSION }) + tr + `<p class="funding" lang="en">${FUNDING}</p>` }, o));
}
export function showHelp(o) {
  const video = HELP_VIDEO_ID
    ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(HELP_VIDEO_ID)}" title="${esc(t('help.title'))}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`
    : `<div class="video"><div class="video-ph">${ICONS.play}<span>${esc(t('help.videoSoon'))}</span></div></div>`;
  return page(Object.assign({ title: t('help.title'), html: video + t('help.html') }, o));
}

// ═══ Configuration ════════════════════════════════════════════════════════════
// label = t('cfg.items.<key>.label'), help = t('cfg.items.<key>.help') when the language has one
const pct = (v) => Math.round(v * 100) + ' %';
// 18.1: a view size, and the distance it stands for (the design distance is 1 m: the 1 × 1 m canvas at 1 m, ≈ 53°)
const fmtScale = (v) => '×' + (+v).toFixed(2) + ' · ' + t('cfg.view.asIf', { m: (VIEW_SCALE.refM / viewScale(v)).toFixed(2) });
const SECTIONS = [
  { key: 'language', custom: 'language' },
  // 18.1: the view size — the canvas and the menu, as if nearer or farther (linked, or each on its own)
  { key: 'view', items: [
    { k: 'canvasScale', t: 'range', min: VIEW_SCALE.min, max: VIEW_SCALE.max, step: 0.05, fmt: fmtScale },
    { k: 'menuScale', t: 'range', min: VIEW_SCALE.min, max: VIEW_SCALE.max, step: 0.05, fmt: fmtScale },
    { k: 'scaleLink', t: 'check' },
  ] },
  // 18: the shared drawing (the 2D variants; the people in the room, their settings, clearing everyone's drawing)
  { key: 'share', variants: 'abd', custom: 'share', items: [
    { k: 'shareOn', t: 'check' },
    { k: 'shareName', t: 'text', max: 24 },
    { k: 'shareRoom', t: 'text', max: 24 },
    { k: 'showPartners', t: 'check' },
  ] },
  { key: 'activation', items: [
    { k: 'menuDwellMs', t: 'range', min: 300, max: 2000, step: 50, unit: 'ms' },
    { k: 'confirmDwellMs', t: 'range', min: 600, max: 3000, step: 50, unit: 'ms' },
    { k: 'graceMs', t: 'range', min: 0, max: 600, step: 10, unit: 'ms' },
    { k: 'hitPad', t: 'range', min: 0, max: 1.5, step: 0.05, fmt: (v) => '+' + Math.round(v * 100) + ' % ' + t('cfg.items.hitPad.unit') },
    { k: 'dwellStart', t: 'check' },
    { k: 'canvasDwellMs', t: 'range', min: 300, max: 3000, step: 50, unit: 'ms' },
    { k: 'dwellStop', t: 'check' },
    { k: 'escapeStop', t: 'check', variants: 'abc' },
    { k: 'escapePauses', t: 'check', variants: 'abc' },
    { k: 'escapeAmplitude', t: 'range', min: 0.1, max: 0.6, step: 0.05, fmt: pct, variants: 'ab' },
    { k: 'escapeDegS', t: 'range', min: 60, max: 400, step: 10, unit: '°/s', variants: 'c' },
    { k: 'blinkToggle', t: 'check', variants: 'a' },
    { k: 'settleDegS', t: 'range', min: 1, max: 30, step: 0.5, unit: '°/s' },
    { k: 'dwellRadiusDeg', t: 'range', min: 0.5, max: 5, step: 0.1, unit: '°' },
  ] },
  { key: 'cursor', items: [
    { k: 'cursorDrawing', t: 'check' },
    { k: 'cursorPaused', t: 'check' },
    { k: 'cursorSmooth', t: 'range', min: 0.05, max: 1, step: 0.01 },
  ] },
  { key: 'line', items: [
    { k: 'lineMode', t: 'select', options: () => LINE_ORDER.map((k) => [k, t('hud.line.' + k)]) },
    { k: 'thickness', t: 'select', options: () => THICKNESS_ORDER.map((k) => [k, t('hud.thickness.' + k) + ' — ' + THICKNESS[k].nom + '°']) },
    { k: 'color', t: 'select', options: () => COLOR_ORDER.map((k) => [k, t('hud.color.' + k)]) },
    { k: 'ppd', t: 'range', min: 20, max: 80, step: 1, unit: 'px/°', variants: 'abd' },
    { k: 'lineParams.rigid.0', t: 'range', min: 0.05, max: 10, step: 0.05, unit: 'Hz' },
    { k: 'lineParams.rigid.1', t: 'range', min: 0, max: 2, step: 0.01 },
    { k: 'lineParams.dynamic.0', t: 'range', min: 0.05, max: 10, step: 0.05, unit: 'Hz' },
    { k: 'lineParams.dynamic.1', t: 'range', min: 0, max: 2, step: 0.01 },
    { k: 'lineParams.fluid.0', t: 'range', min: 0.05, max: 10, step: 0.05, unit: 'Hz' },
    { k: 'lineParams.fluid.1', t: 'range', min: 0, max: 2, step: 0.01 },
  ] },
  { key: 'ink', items: [
    { k: 'engorge', t: 'range', min: 0, max: 2, step: 0.05, fmt: pct },
    { k: 'slowDegS', t: 'range', min: 0, max: 10, step: 0.1, unit: '°/s' },
    { k: 'fastDegS', t: 'range', min: 2, max: 60, step: 0.5, unit: '°/s' },
    { k: 'drips', t: 'check' },
    { k: 'dripSpeed', t: 'range', min: 0.1, max: 5, step: 0.1 },
    { k: 'dripInt', t: 'range', min: 50, max: 1000, step: 10, unit: 'ms' },
    { k: 'splats', t: 'check' },
    { k: 'splatThr', t: 'range', min: 0.3, max: 5, step: 0.1 },
    { k: 'splatInt', t: 'range', min: 20, max: 500, step: 10, unit: 'ms' },
  ] },
  { key: 'agents', custom: 'agents' },
  { key: 'amp', variants: 'abd', items: [
    { k: 'gazeAmp', t: 'range', min: 0.5, max: 10, step: 0.1, unit: '×' },
    { k: 'panEnabled', t: 'check' },
    { k: 'comfortFrac', t: 'range', min: 0.4, max: 1, step: 0.01 },
    { k: 'panRate', t: 'range', min: 0.05, max: 1.2, step: 0.05 },
    { k: 'worldScale', t: 'range', min: 1.2, max: 3, step: 0.1, unit: '×' },
  ] },
  { key: 'grid', items: [
    { k: 'gridSpacingDeg', t: 'range', min: 1, max: 8, step: 0.1, unit: '°' },
    { k: 'gridDotDeg', t: 'range', min: 0.3, max: 2, step: 0.05, unit: '°' },
    { k: 'gridPadDeg', t: 'range', min: 0, max: 1.5, step: 0.05, unit: '°' },
  ] },
  { key: 'vr', variants: 'c', items: [
    { k: 'stereo', t: 'check' },
    { k: 'headGain', t: 'range', min: 0.5, max: 2, step: 0.05, unit: '×' },
    { k: 'ipd', t: 'range', min: 50, max: 76, step: 1, unit: 'mm' },
    { k: 'distort', t: 'range', min: 0, max: 0.5, step: 0.01 },
    { k: 'vrZoom', t: 'range', min: 0.6, max: 1.6, step: 0.05, unit: '×' },
    { k: 'followDelayMs', t: 'range', min: 0, max: 1500, step: 25, unit: 'ms' },
    { k: 'followMs', t: 'range', min: 200, max: 2000, step: 50, unit: 'ms' },
    { k: 'hudPitchDeg', t: 'range', min: -45, max: -10, step: 1, unit: '°' },
    { k: 'invertX', t: 'check' },
    { k: 'invertY', t: 'check' },
  ] },
  { key: 'tracker', variants: 'a', custom: 'tracker' },
  { key: 'hands', variants: 'd', custom: 'hands', items: [
    { k: 'handSmooth', t: 'range', min: 0, max: 1, step: 0.05 },
    { k: 'poseStableMs', t: 'range', min: 40, max: 400, step: 10, unit: 'ms' },
    { k: 'handTap', t: 'check' },
    { k: 'waveMinSwing', t: 'range', min: 0.04, max: 0.3, step: 0.01, fmt: pct },
    { k: 'waveWindowMs', t: 'range', min: 600, max: 3000, step: 100, unit: 'ms' },
    { k: 'undoPulls', t: 'range', min: 1, max: 3, step: 1 },
    { k: 'pullWindowMs', t: 'range', min: 1200, max: 5000, step: 100, unit: 'ms' },
    { k: 'handPreview', t: 'check' },
  ] },
  { key: 'data', custom: 'data' },
];
const fmtVal = (it, v) => (it.fmt ? it.fmt(v) : (Math.abs(v) >= 100 || Number.isInteger(it.step) ? Math.round(v) : (+v).toFixed(it.step < 0.1 ? 2 : 1)) + (it.unit ? ' ' + it.unit : ''));
const itemText = (k, part) => { const key = 'cfg.items.' + k + '.' + part; return has(key) ? t(key) : ''; };

// the Language section: the choice, plus loading / downloading language files (adding or correcting a language)
function languagePanel({ onPick }) {
  const box = h('div', { class: 'lang-panel' });
  const id = 'cfg-language';
  const sel = h('select', { id });
  for (const l of languages()) sel.append(new Option(l.nativeName + (l.custom ? ' ✎' : ''), l.code, false, l.code === lang()));
  sel.addEventListener('change', () => onPick(sel.value));
  const load = h('button', { class: 'btn', type: 'button', text: t('cfg.language.load') });
  load.addEventListener('click', () => {
    const inp = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
      let obj = null; try { obj = JSON.parse(await f.text()); } catch (e) { toast(t('toast.languageBad', { reason: 'JSON' }), 5200); return; }
      const r = addLanguageFile(obj);
      if (!r.ok) { toast(t('toast.languageBad', { reason: r.reason }), 6000); return; }
      toast(t('toast.languageLoaded', { name: r.name, count: r.count }), 4200);
      onPick(r.code);
    }, { once: true });
    document.body.append(inp); inp.click();
  });
  const tpl = h('button', { class: 'btn', type: 'button', text: t('cfg.language.template') });
  tpl.addEventListener('click', () => {
    const blob = new Blob([exportLanguage()], { type: 'application/json' }), url = URL.createObjectURL(blob), a = h('a', { href: url, download: 'inkwell-language-' + lang() + '.json', style: 'display:none' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  const row = h('div', { class: 'row wrap' }, load, tpl);
  const cur = languages().find((l) => l.code === lang());
  if (cur && cur.custom) {
    const rm = h('button', { class: 'btn ghost', type: 'button', text: t('cfg.language.remove', { name: cur.nativeName }) });
    rm.addEventListener('click', () => { removeLanguageFile(cur.code); onPick(cur.bundled ? cur.code : 'en', true); });
    row.append(rm);
  }
  box.append(h('div', { class: 'ctl' }, h('label', { for: id }, h('span', { text: t('cfg.language.current') })), sel), row, h('p', { class: 'hint', text: t('cfg.language.help') }));
  return box;
}

// A layer (not a top-layer <dialog>) so the gaze reticle, drawn above everything, stays visible over it. The close
// button and the scroll arrows are gaze targets; the controls are for the mouse / keyboard (a helper or the researcher).
// 18: participants [{id, label, color, on}] add a "Settings of" switch (onTarget(id)); remote {name, key}: the panel shows
// a partner's settings — its language, room and links stay with that person
// notes {key: (v) → text}: a remark after a value (18.1: how far the menu can grow in this window)
export function openConfig({ variant, cfg, gaze, onChange, agents, tracker, hands, share, onReset, onClearSaved, onLanguage, links = [], onClose, scrollTop = 0, participants = [], onTarget = null, remote = null, notes = null }) {
  const old = $('#config'); if (old) old.remove();
  const prevFocus = document.activeElement;
  let layer = null;
  const close = () => { if (!layer) return; gaze.removeWithin(layer); layer.remove(); layer = null; if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* gone */ } if (onClose) onClose(); };
  const closeBtn = h('button', { class: 'cfg-close', type: 'button', 'aria-label': t('cfg.close'), html: ICONS.close });
  closeBtn.addEventListener('click', close);
  const body = h('div', { class: 'cfg-body' });
  const up = h('button', { class: 'page-scroll up', type: 'button', 'aria-label': t('common.scrollUp'), html: ICONS.up });
  const down = h('button', { class: 'page-scroll down', type: 'button', 'aria-label': t('common.scrollDown'), html: ICONS.down });
  const scroll = (dir) => body.scrollBy({ top: dir * body.clientHeight * 0.6, behavior: 'smooth' });
  up.addEventListener('click', () => scroll(-1)); down.addEventListener('click', () => scroll(1));
  const panel = h('div', { class: 'cfg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cfg-title' },
    h('header', { class: 'cfg-head' + (remote ? ' remote' : '') }, h('div', null, h('h2', { id: 'cfg-title', text: t('cfg.title') }),
      h('p', { class: 'cfg-sub', text: remote ? t('cfg.subRemote', { name: remote.name }) : t('cfg.sub', { variant: variantTitle(variant) }) })), closeBtn),
    body, up, down);
  if (participants.length > 1 && onTarget) {   // whose settings: this window, or a partner's
    const row = h('div', { class: 'targets', role: 'group', 'aria-label': t('cfg.target.label') }, h('span', { class: 'targets-label', text: t('cfg.target.label') }));
    for (const p of participants) {
      const b = h('button', { class: 'chip target' + (p.on ? ' on' : ''), type: 'button', 'aria-pressed': p.on ? 'true' : 'false' }, h('span', { class: 'dot', style: 'background:' + p.color }), p.label);
      b.addEventListener('click', () => onTarget(p.id));
      row.append(b);
    }
    body.append(row);
  }
  layer = h('div', { id: 'config', class: 'cfg-layer' }, panel);
  layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(); });
  const controls = [];
  const note = (k, v) => { const f = notes && notes[k], n = f ? f(v) : ''; return n ? ' — ' + n : ''; };
  for (const sec of SECTIONS) {
    if (sec.variants && !sec.variants.includes(variant.id)) continue;
    if (sec.custom === 'tracker' && !tracker) continue;
    if (sec.custom === 'hands' && !hands) continue;
    if (sec.custom === 'share' && !share) continue;
    if (remote && sec.custom === 'language') continue;   // the language is each person's own
    const box = h('section', { class: 'cfg-sec', 'data-sec': sec.key }, h('h3', { text: t('cfg.sections.' + sec.key) }));
    if (sec.custom === 'language') box.append(languagePanel({ onPick: onLanguage }));
    else if (sec.custom === 'agents') box.append(agents());
    else if (sec.custom === 'tracker') box.append(tracker());
    else if (sec.custom === 'hands') box.append(hands());
    else if (sec.custom === 'share') box.append(share());
    else if (sec.custom === 'data') {
      const r = h('button', { class: 'btn', type: 'button', text: t('cfg.data.reset') }), c = h('button', { class: 'btn', type: 'button', text: t('cfg.data.clearSaved') });
      r.addEventListener('click', () => onReset()); c.addEventListener('click', () => onClearSaved());
      box.append(h('div', { class: 'row wrap' }, r, c), h('p', { class: 'hint', text: remote ? t('cfg.remote.footer', { key: remote.key }) : t('cfg.data.footer', { version: VERSION, key: variant.key }) }));
      if (links.length) {
        const lr = h('div', { class: 'row wrap' });
        for (const l of links) { const b = h('button', { class: 'btn ghost', type: 'button', text: l.label }); b.addEventListener('click', () => l.fn()); lr.append(b); }
        box.append(lr);
      }
    }
    for (const it of sec.items || []) {
      if (it.variants && !it.variants.includes(variant.id)) continue;
      const id = 'cfg-' + it.k.replace(/\./g, '-'), label = itemText(it.k, 'label') || it.k, help = itemText(it.k, 'help');
      let input; const out = h('output', { for: id });
      if (it.t === 'range') {
        input = h('input', { type: 'range', id, min: it.min, max: it.max, step: it.step });
        input.addEventListener('input', () => { onChange(it.k, +input.value); out.textContent = fmtVal(it, +input.value) + note(it.k, +input.value); });
      } else if (it.t === 'check') {
        input = h('input', { type: 'checkbox', id });
        input.addEventListener('change', () => onChange(it.k, input.checked));
      } else if (it.t === 'select') {
        input = h('select', { id }); for (const [v, txt] of it.options()) input.append(new Option(txt, v));
        input.addEventListener('change', () => onChange(it.k, input.value));
      } else if (it.t === 'text') {
        input = h('input', { type: 'text', id, maxlength: it.max || 40, autocomplete: 'off', spellcheck: 'false' });
        input.addEventListener('change', () => onChange(it.k, input.value.trim()));
      }
      controls.push({ it, input, out });
      const row = it.t === 'check'
        ? h('div', { class: 'ctl check' }, h('label', { for: id }, input, h('span', { text: label })), help ? h('p', { class: 'hint', text: help }) : null)
        : h('div', { class: 'ctl' + (it.t === 'text' ? ' text' : '') }, h('label', { for: id }, h('span', { text: label }), it.t === 'text' ? null : out), input, help ? h('p', { class: 'hint', text: help }) : null);
      box.append(row);
    }
    body.append(box);
  }
  function sync() {
    for (const { it, input, out } of controls) {
      const v = getPath(cfg, it.k);
      if (it.t === 'check') input.checked = !!v;
      else if (it.t === 'text') { if (document.activeElement !== input) input.value = v == null ? '' : String(v); }
      else input.value = String(v);
      if (it.t === 'range') out.textContent = fmtVal(it, +v) + note(it.k, +v);
    }
  }
  sync();
  document.body.append(layer);
  if (scrollTop) body.scrollTop = scrollTop;
  gaze.add(closeBtn, close); gaze.add(up, () => scroll(-1), { ms: 600 }); gaze.add(down, () => scroll(1), { ms: 600 });
  try { closeBtn.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
  return { close, sync, el: layer, get scrollTop() { return body.scrollTop; } };
}

// ═══ 18d: calibrate the reach — a 5-s sweep with the pointing finger, the camera view shown large ════════════════
// (Cancel is click-only, and Esc: the cursor's mapping is what is being measured)
export function showReach({ root, onCancel }) {
  const cv = h('canvas', { class: 'reach-cam', width: 640, height: 480, 'aria-hidden': 'true' });
  const fill = h('span'), bar = h('div', { class: 'reach-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  const cancel = h('button', { class: 'btn', type: 'button', text: t('common.cancel') });
  cancel.addEventListener('click', () => onCancel());
  const sec = h('section', { class: 'screen reach', 'aria-label': t('reach.title') },
    h('h2', { text: t('reach.title') }), h('p', { class: 'reach-hint', text: t('reach.hint') }), cv, bar, cancel);
  root.append(sec);
  return {
    el: sec, canvas: cv,
    progress(k) { const v = Math.round(clamp(k, 0, 1) * 100); fill.style.width = v + '%'; bar.setAttribute('aria-valuenow', String(v)); },
    close() { sec.remove(); },
  };
}

// the agents (boids) editor: presets, one card per agent (CRUD + five live sliders), the template
export function agentsEditor({ engine, cfg, onChange }) {
  const wrap = h('div', { class: 'agents' });
  const AG = [['speed', 0.01], ['spring', 0.01], ['damp', 0.01], ['mass', 0.05], ['jitter', 0.01]];
  function render() {
    wrap.textContent = '';
    const presets = h('div', { class: 'row wrap' });
    for (const k of Object.keys(PRESETS)) {
      const b = h('button', { class: 'chip' + (cfg.preset === k ? ' on' : ''), type: 'button', text: t('cfg.presets.' + k) });
      b.addEventListener('click', () => { engine.applyPreset(k); onChange('preset', k); render(); });
      presets.append(b);
    }
    wrap.append(h('p', { class: 'hint', text: t('cfg.agents.presets') }), presets);
    const list = h('div', { class: 'agent-list' });
    if (!engine.S.boids.length) list.append(h('p', { class: 'hint', html: t('cfg.agents.none') }));
    engine.S.boids.forEach((b, i) => {
      const head = h('div', { class: 'agent-head' }, h('b', { text: t('cfg.agents.agent', { n: i + 1 }) }), h('span', { class: 'sp' }));
      const mk = (txt, title, fn) => { const x = h('button', { class: 'abtn', type: 'button', title, 'aria-label': title, text: txt }); x.addEventListener('click', () => { fn(); onChange('boids'); render(); }); return x; };
      head.append(mk('⟳', t('cfg.agents.randomise'), () => engine.randomizeBoid(i)), mk('↺', t('cfg.agents.reset'), () => engine.resetBoid(i)), mk('✕', t('cfg.agents.remove'), () => engine.removeBoid(i)));
      const card = h('div', { class: 'agent' }, head);
      for (const [key, step] of AG) {
        const [lo, hi] = AGENT_RANGE[key], inp = h('input', { type: 'range', min: lo, max: hi, step, value: b[key] }), v = h('output', { text: (+b[key]).toFixed(2) });
        inp.addEventListener('input', () => { b[key] = +inp.value; v.textContent = (+inp.value).toFixed(2); onChange('boids'); });
        card.append(h('label', { class: 'agent-row' }, h('span', { text: t('cfg.agents.' + key) }), inp, v));
      }
      list.append(card);
    });
    const add = h('button', { class: 'btn', type: 'button', text: t('cfg.agents.add') }), all = h('button', { class: 'btn', type: 'button', text: t('cfg.agents.randomiseAll') });
    add.disabled = engine.S.boids.length >= 8;
    add.addEventListener('click', () => { engine.addBoid(); onChange('boids'); render(); });
    all.addEventListener('click', () => { engine.randomizeAll(); onChange('boids'); render(); });
    wrap.append(list, h('div', { class: 'row' }, add, all), h('p', { class: 'hint', text: t('cfg.agents.template') }));
    for (const [key, step] of AG) {
      const ck = 'boid' + key[0].toUpperCase() + key.slice(1), [lo, hi] = AGENT_RANGE[key];
      const inp = h('input', { type: 'range', min: lo, max: hi, step, value: cfg[ck] }), v = h('output', { text: (+cfg[ck]).toFixed(2) });
      inp.addEventListener('input', () => { cfg[ck] = +inp.value; v.textContent = (+inp.value).toFixed(2); onChange(ck, +inp.value); });
      wrap.append(h('label', { class: 'agent-row' }, h('span', { text: t('cfg.agents.templatePrefix', { label: t('cfg.agents.' + key) }) }), inp, v));
    }
  }
  render();
  return wrap;
}
