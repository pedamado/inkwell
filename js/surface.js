// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 17 — drawing surfaces + undo
//   Surface      a raster "paper" in surface px, split into tiles (2D: one tile; VR: one tile per GPU texture).
//                wrap: the surface is a ring (the 360° VR canvas): x wraps at `width`.
//   draw(bbox, fn) runs fn(ctx) in SURFACE coordinates on every tile the bbox touches (and on the wrapped copy at the
//                seam), records the touched cells for undo first, and marks the tiles dirty (VR texture uploads).
//   Undo         per ACTION (a stroke, a grid segment): the cells (128 px) an action touches are copied before
//                their first change; undo swaps them back (and keeps the newer pixels for redo). Memory follows the
//                area drawn, not the canvas size (build 15 kept 16 full-canvas snapshots: up to ~2 GB at 2× DPR).
//                Whole-surface actions (Clear, Open) keep a drawImage copy of each tile instead of reading every cell
//                back (16.1: reading a large canvas back cell by cell stalled GPU-backed canvases — Safari — for
//                seconds); only the newest such copy is kept (undo stops at the clear before it).
// ═══════════════════════════════════════════════════════════════════════════
import { TK } from './core.js';

const CELL = 128;              // undo cell, surface px
const UNDO_STEPS = 24;
const UNDO_BYTES = 192e6;      // drop the oldest actions beyond this

export class Surface {
  constructor({ width, height, scale = 1, tileW = width, wrap = false, bg = TK.bgCanvas }) {
    this.width = Math.round(width); this.height = Math.round(height); this.scale = scale;
    this.wrap = !!wrap; this.bg = bg;
    this.tiles = [];
    const tw = Math.max(1, Math.round(tileW));
    for (let x0 = 0; x0 < this.width; x0 += tw) {
      const w = Math.min(tw, this.width - x0);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale); canvas.height = Math.round(this.height * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });   // undo cells + VR uploads read pixels often
      this.tiles.push({ x0, w, canvas, ctx, dirty: true, version: 0, dirtyRect: [0, 0, canvas.width, canvas.height] });
    }
    this.undo = []; this.redo = []; this.action = null; this.bytes = 0; this.version = 0;
    this.paint();
  }

  // ---------------------------------------------------------------------------------------------- painting
  paint() {
    for (const t of this.tiles) {
      t.ctx.setTransform(1, 0, 0, 1, 0, 0);
      t.ctx.fillStyle = this.bg; t.ctx.fillRect(0, 0, t.canvas.width, t.canvas.height);
      this._markAll(t);
    }
    this.version++;
  }
  // the changed part of a tile, in its device px (VR uploads only that rectangle to the GPU)
  _mark(t, x0, y0, x1, y1) {
    const W = t.canvas.width, H = t.canvas.height;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const r = t.dirtyRect;
    t.dirtyRect = r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1), Math.max(r[3], y1)] : [x0, y0, x1, y1];
    t.dirty = true; t.version++;
  }
  _markAll(t) { t.dirtyRect = [0, 0, t.canvas.width, t.canvas.height]; t.dirty = true; t.version++; }
  // fn(ctx) draws in surface coordinates; bbox = [x0, y0, x1, y1] (surface px, unwrapped)
  draw(bbox, fn) {
    const shifts = this.wrap ? [0, -this.width, this.width] : [0];
    for (const sh of shifts) {
      const bx0 = bbox[0] + sh, bx1 = bbox[2] + sh;
      if (bx1 < 0 || bx0 > this.width) continue;
      const by0 = Math.max(0, bbox[1]), by1 = Math.min(this.height, bbox[3]);
      if (by1 < 0 || by0 > this.height) continue;
      this._touch(Math.max(0, bx0), by0, Math.min(this.width, bx1), by1);
      for (const t of this.tiles) {
        if (bx1 < t.x0 || bx0 > t.x0 + t.w) continue;
        const c = t.ctx;
        c.save();
        c.setTransform(this.scale, 0, 0, this.scale, (sh - t.x0) * this.scale, 0);
        c.lineCap = 'round'; c.lineJoin = 'round';
        fn(c);
        c.restore();
        const s = this.scale; this._mark(t, (bx0 - t.x0) * s - 2, by0 * s - 2, (bx1 - t.x0) * s + 2, by1 * s + 2);
      }
    }
    this.version++;
  }

  // ---------------------------------------------------------------------------------------------- undo / redo
  begin() { if (!this.action) this.action = { cells: new Map(), bytes: 0 }; }
  commit() {
    const a = this.action; this.action = null;
    if (!a || !a.cells.size) return false;
    this._push(a);
    return true;
  }
  _push(a) {
    this.undo.push(a); this.bytes += a.bytes;
    for (const r of this.redo) this.bytes -= r.bytes;
    this.redo = [];
    while (this.undo.length > UNDO_STEPS || (this.bytes > UNDO_BYTES && this.undo.length > 1)) this.bytes -= this.undo.shift().bytes;
  }
  // a copy of every tile (drawImage: no pixel read-back) for a whole-surface action
  _copyTiles() {
    const parts = this.tiles.map((t) => {
      const c = document.createElement('canvas'); c.width = t.canvas.width; c.height = t.canvas.height;
      c.getContext('2d', { willReadFrequently: true }).drawImage(t.canvas, 0, 0);
      return { t, c };
    });
    return { parts, bytes: parts.reduce((n, p) => n + p.c.width * p.c.height * 4, 0) };
  }
  _pushFull(full) {   // only the newest whole-surface copy is kept: the previous one and everything older go
    let last = -1;
    for (let i = this.undo.length - 1; i >= 0; i--) if (this.undo[i].full) { last = i; break; }
    if (last >= 0) for (const a of this.undo.splice(0, last + 1)) this.bytes -= a.bytes;
    this._push({ full, bytes: full.bytes });
  }
  _touch(x0, y0, x1, y1) {
    const a = this.action; if (!a) return;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(Math.min(this.width - 1, x1) / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(Math.min(this.height - 1, y1) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = cx + ',' + cy;
      if (a.cells.has(key)) continue;
      const img = this._read(cx * CELL, cy * CELL);
      a.cells.set(key, img); a.bytes += img.bytes;
    }
  }
  // cell pixels (device px), possibly spread over two tiles
  _read(x, y) {
    const w = Math.min(CELL, this.width - x), h = Math.min(CELL, this.height - y), s = this.scale, parts = [];
    let bytes = 0;
    for (const t of this.tiles) {
      const a = Math.max(x, t.x0), b = Math.min(x + w, t.x0 + t.w);
      if (b <= a) continue;
      const sx = Math.round((a - t.x0) * s), sy = Math.round(y * s), sw = Math.max(1, Math.round((b - a) * s)), sh = Math.max(1, Math.round(h * s));
      const data = t.ctx.getImageData(sx, sy, sw, sh);
      parts.push({ t, sx, sy, data }); bytes += data.data.length;
    }
    return { parts, bytes };
  }
  _swap(a) {   // write a's pixels back, return the current ones (for the opposite stack)
    if (a.full) {
      const now = this._copyTiles();
      for (const p of a.full.parts) {
        const g = p.t.ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.drawImage(p.c, 0, 0); g.restore();
        this._markAll(p.t);
      }
      this.version++;
      return { full: now, bytes: now.bytes };
    }
    const back = { cells: new Map(), bytes: 0 };
    for (const [key, img] of a.cells) {
      const cur = { parts: [], bytes: 0 };
      for (const p of img.parts) {
        const now = p.t.ctx.getImageData(p.sx, p.sy, p.data.width, p.data.height);
        cur.parts.push({ t: p.t, sx: p.sx, sy: p.sy, data: now }); cur.bytes += now.data.length;
        p.t.ctx.putImageData(p.data, p.sx, p.sy); this._mark(p.t, p.sx, p.sy, p.sx + p.data.width, p.sy + p.data.height);
      }
      back.cells.set(key, cur); back.bytes += cur.bytes;
    }
    this.version++;
    return back;
  }
  undoStep() {
    if (this.action) this.commit();
    const a = this.undo.pop(); if (!a) return false;
    this.bytes -= a.bytes;
    const r = this._swap(a); this.redo.push(r); this.bytes += r.bytes;
    return true;
  }
  redoStep() {
    const r = this.redo.pop(); if (!r) return false;
    this.bytes -= r.bytes;
    const a = this._swap(r); this.undo.push(a); this.bytes += a.bytes;
    return true;
  }
  clear() {   // an undoable clear (a tile copy, not a cell-by-cell read-back)
    if (this.action) this.commit();
    const full = this._copyTiles();
    this.paint();
    this._pushFull(full);
  }
  get canUndo() { return this.undo.length > 0 || !!(this.action && this.action.cells.size); }

  // ---------------------------------------------------------------------------------------------- export / import
  // the whole surface as one canvas (surface px × scale)
  toCanvas(maxW = Infinity) {
    const k = Math.min(1, maxW / (this.width * this.scale));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.width * this.scale * k)); c.height = Math.max(1, Math.round(this.height * this.scale * k));
    const g = c.getContext('2d');
    for (const t of this.tiles) g.drawImage(t.canvas, Math.round(t.x0 * this.scale * k), 0, Math.round(t.w * this.scale * k), c.height);
    return c;
  }
  // draw an image over the whole surface (fitted, centred), as one undoable action
  loadImage(img) {
    if (this.action) this.commit();
    const full = this._copyTiles();
    this.paint();
    const W = this.width, H = this.height, k = Math.min(W / img.width, H / img.height);
    const dw = img.width * k, dh = img.height * k, dx = (W - dw) / 2, dy = (H - dh) / 2;
    for (const t of this.tiles) {
      const c = t.ctx;
      c.save(); c.setTransform(this.scale, 0, 0, this.scale, -t.x0 * this.scale, 0);
      c.drawImage(img, dx, dy, dw, dh); c.restore();
      this._markAll(t);
    }
    this._pushFull(full); this.version++;
  }
  // a copy of the content into a new surface of another size (window resize / world scale change)
  copyFrom(other) {
    for (const t of this.tiles) {
      const c = t.ctx;
      c.save(); c.setTransform(this.scale, 0, 0, this.scale, -t.x0 * this.scale, 0);
      const dx = (this.width - other.width) / 2, dy = (this.height - other.height) / 2;
      for (const o of other.tiles) c.drawImage(o.canvas, dx + o.x0, dy, o.w, other.height);
      c.restore(); this._markAll(t);
    }
    this.version++;
  }
  // pixel colour at a surface point (tests / debugging)
  pixel(x, y) {
    const t = this.tiles.find((q) => x >= q.x0 && x < q.x0 + q.w); if (!t) return null;
    const d = t.ctx.getImageData(Math.round((x - t.x0) * this.scale), Math.round(y * this.scale), 1, 1).data;
    return [d[0], d[1], d[2]];
  }
}
