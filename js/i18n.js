// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 16 — localisation (i18n)
//   Languages are JSON files in i18n/. en.json is the reference (every key the app uses); any other language may be
//   partial: a missing key falls back to English. i18n/languages.json lists the bundled languages.
//   Users can add or correct a language without touching the server: Configuration → Language → "Load a language
//   file…" keeps it in this browser, layered over a bundled language with the same code (corrections) or as a new one.
//   t('hud.line.dynamic') · t('toast.saved', { png, json }) — a {placeholder} without a value is left as it is.
//   The language is a person's preference: one choice for the three variants (localStorage 'inkwell16.lang').
// ═══════════════════════════════════════════════════════════════════════════
const LS_LANG = 'inkwell16.lang', LS_CUSTOM = 'inkwell16.lang.custom';
const DIR = new URL('../i18n/', import.meta.url);
let reg = { default: 'en', languages: [{ code: 'en', file: 'en.json', nativeName: 'English' }] };
let en = {}, cur = {}, code = 'en', meta = {};
const raw = new Map();            // code → the bundled file, as loaded (nested)
const listeners = new Set();

const ls = {
  get(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
function merge(base, over) {   // nested objects merged, everything else replaced
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], v);
    else base[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return base;
}
// nested → flat keys ('hud.line.dynamic'); arrays (long HTML, one item per paragraph) are joined
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (Array.isArray(v)) out[key] = v.join('\n');
    else if (v != null) out[key] = String(v);
  }
  return out;
}
async function fetchJSON(file) {
  const r = await fetch(new URL(file, DIR), { cache: 'no-cache' });
  if (!r.ok) throw new Error('i18n/' + file + ': HTTP ' + r.status);
  return r.json();
}
const customAll = () => ls.get(LS_CUSTOM) || {};

// ---------------------------------------------------------------------------------------------- set-up
export async function initI18n() {
  try { const r = await fetchJSON('languages.json'); if (r && Array.isArray(r.languages) && r.languages.length) reg = r; } catch (e) { console.warn(e); }
  const enRaw = await fetchJSON('en.json');            // the reference: required
  raw.set('en', enRaw); en = flatten(enRaw);
  let q = null; try { q = new URLSearchParams(location.search).get('lang'); } catch (e) { /* no URL */ }
  await setLanguage(q || ls.get(LS_LANG) || reg.default || 'en', { persist: false, quiet: true });
}

// ---------------------------------------------------------------------------------------------- lookup
export function t(key, vars) {
  let s = cur[key];
  if (s == null) s = en[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}
export const has = (key) => cur[key] != null || en[key] != null;
export const lang = () => code;
export const langMeta = () => meta;
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// static DOM text marked with data-i18n="key" (and data-i18n-attr="aria-label" etc.); data-i18n-html="key" for texts with links
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const v = t(el.dataset.i18n), attr = el.dataset.i18nAttr;
    if (attr) el.setAttribute(attr, v); else el.textContent = v;
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
}

// ---------------------------------------------------------------------------------------------- languages
export function languages() {
  const custom = customAll();
  const list = reg.languages.map((l) => ({ code: l.code, nativeName: l.nativeName || l.code, bundled: true, custom: !!custom[l.code] }));
  for (const [c, obj] of Object.entries(custom)) {
    if (!list.some((l) => l.code === c)) list.push({ code: c, nativeName: (obj.meta && (obj.meta.nativeName || obj.meta.name)) || c, bundled: false, custom: true });
  }
  return list;
}
export async function setLanguage(c, { persist = true, quiet = false } = {}) {
  if (!languages().some((l) => l.code === c)) c = 'en';
  const entry = reg.languages.find((l) => l.code === c);
  if (entry && !raw.has(c)) { try { raw.set(c, await fetchJSON(entry.file)); } catch (e) { console.warn(e); raw.set(c, {}); } }
  const custom = customAll()[c];
  const merged = custom ? merge(clone(raw.get(c) || {}), custom) : (raw.get(c) || {});
  cur = flatten(merged); code = c;
  meta = Object.assign({ code: c, nativeName: c, dir: 'ltr' }, (raw.get(c) || {}).meta || {}, (custom && custom.meta) || {});
  if (typeof document !== 'undefined') {
    document.documentElement.lang = c;
    document.documentElement.dir = meta.dir === 'rtl' ? 'rtl' : 'ltr';
    applyDom();
  }
  if (persist) ls.set(LS_LANG, c);
  if (!quiet) for (const fn of listeners) { try { fn(c); } catch (e) { console.error(e); } }
  return c;
}
// a language file chosen by the user (Configuration): validated, kept in this browser
export function addLanguageFile(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'not a JSON object' };
  const m = obj.meta || {}, c = String(m.code || '').trim();
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(c)) return { ok: false, reason: 'meta.code is missing or invalid (e.g. "es", "fr", "pt-BR")' };
  const flat = flatten(obj), count = Object.keys(flat).filter((k) => !k.startsWith('meta.') && en[k] != null).length;
  if (!count) return { ok: false, reason: 'no known texts (compare its keys with en.json)' };
  const all = customAll(); all[c] = obj;
  if (!ls.set(LS_CUSTOM, all)) return { ok: false, reason: 'this browser refused to store it' };
  return { ok: true, code: c, name: m.nativeName || m.name || c, count };
}
export function removeLanguageFile(c) { const all = customAll(); delete all[c]; ls.set(LS_CUSTOM, all); }
// the current language as a complete, nested file: every English key, filled with the current texts where they exist
export function exportLanguage() {
  const out = merge(clone(raw.get('en')), raw.get(code) || {});
  const custom = customAll()[code]; if (custom) merge(out, custom);
  out.meta = Object.assign({}, out.meta, code === 'en'
    ? { code: 'xx', name: 'New language', nativeName: 'New language', translators: '', notes: (raw.get('en').meta || {}).notes }
    : {});
  return JSON.stringify(out, null, 2);
}
