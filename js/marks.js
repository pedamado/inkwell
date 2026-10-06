// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18 — marks: every mark of ink as plain data, so it can be painted again elsewhere (18: in the partners'
// windows, at their scale). The engine paints its marks through here, and hands them to the shared drawing.
//   s  segment  { t:'s', x0, y0, x1, y1, w, c }           a piece of line (also the grid's straight segments)
//   b  blot     { t:'b', x, y, r, c }                      ink swelling in place (engorge)
//   d  drip     { t:'d', x, y, ex, ey, lw, rr, c }         a run of ink down from the pen, with a drop at its end
//   p  splat    { t:'p', dots: [[x, y, r, a], …], box, c } droplets thrown off at a sharp turn (random: drawn once,
//                                                          by the author — the partners paint the same dots)
// Coordinates are surface px of the author's surface; a partner paints them scaled by its layer width / the author's.
// ═══════════════════════════════════════════════════════════════════════════
import { withAlpha } from './core.js';

export function markBox(m) {
  if (m.t === 's') { const p = m.w / 2 + 2; return [Math.min(m.x0, m.x1) - p, Math.min(m.y0, m.y1) - p, Math.max(m.x0, m.x1) + p, Math.max(m.y0, m.y1) + p]; }
  if (m.t === 'b') return [m.x - m.r - 2, m.y - m.r - 2, m.x + m.r + 2, m.y + m.r + 2];
  if (m.t === 'd') return [Math.min(m.x, m.ex) - m.lw - m.rr, m.y - m.lw, Math.max(m.x, m.ex) + m.lw + m.rr, m.ey + m.rr + 2];
  if (m.t === 'p') return m.box;
  return [0, 0, 0, 0];
}
// draw one mark on a 2D context already set to the mark's coordinate space (line caps and joins round)
export function drawMark(c, m) {
  if (m.t === 's') {
    c.strokeStyle = m.c; c.lineWidth = m.w; c.beginPath(); c.moveTo(m.x0, m.y0); c.lineTo(m.x1, m.y1); c.stroke();
  } else if (m.t === 'b') {
    c.fillStyle = m.c; c.beginPath(); c.arc(m.x, m.y, m.r, 0, Math.PI * 2); c.fill();
  } else if (m.t === 'd') {
    const g = c.createLinearGradient(m.x, m.y, m.ex, m.ey);
    g.addColorStop(0, withAlpha(m.c, 1)); g.addColorStop(0.7, withAlpha(m.c, 0.8)); g.addColorStop(1, withAlpha(m.c, 0.3));
    c.strokeStyle = g; c.lineWidth = m.lw; c.beginPath(); c.moveTo(m.x, m.y); c.lineTo(m.ex, m.ey); c.stroke();
    c.beginPath(); c.arc(m.ex, m.ey, m.rr, 0, Math.PI * 2); c.fillStyle = withAlpha(m.c, 0.9); c.fill();
  } else if (m.t === 'p') {
    for (const [x, y, r, a] of m.dots) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = withAlpha(m.c, a); c.fill(); }
  }
}
// paint marks on a plain canvas that stands for another window's surface: k = this canvas's surface px per author px
export function paintMarks(ctx, marks, k, dpr) {
  ctx.save(); ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const m of marks) drawMark(ctx, m);
  ctx.restore();
}
