// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18 — bootstrap: one app, three variants (18a eye tracker · 18b mouse cursor · 18c cardboard)
// ═══════════════════════════════════════════════════════════════════════════
import { VARIANTS } from './core.js';
import { initI18n } from './i18n.js';

export async function boot(id) {
  const variant = VARIANTS[id] || VARIANTS.a;
  document.documentElement.dataset.variant = variant.id;
  try {
    await initI18n();                      // i18n/en.json (+ the chosen language) before anything shows text
    if (variant.vr) { const { runVR } = await import('./vr.js'); runVR(variant); }
    else { const { runApp2D } = await import('./app2d.js'); runApp2D(variant); }
  } catch (e) {
    console.error(e);
    const p = document.createElement('p');
    p.style.cssText = 'position:fixed;inset:auto 16px 16px;z-index:99;padding:14px 18px;border-radius:14px;background:#fdeeeb;color:#b8261a;font:600 14px/1.45 ui-monospace,monospace';
    p.textContent = 'Inkwell could not start: ' + (e && e.message ? e.message : e) + ' — serve the folder over http(s) (e.g. python3 -m http.server) and use a recent Chrome, Edge or Safari.';
    document.body.append(p);
  }
}
