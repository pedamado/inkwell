// ═══════════════════════════════════════════════════════════════════════════
// INKWELL 18 — the shared drawing: windows of the SAME browser on the same computer drawing together
//   e.g. 18a (a person drawing with the eyes, webcam 1, screen 1) and 18d (a carer drawing with the hand, webcam 2,
//   screen 2). No server and no network: a BroadcastChannel ('inkwell18:' + room) between the windows — so it works
//   where an institutional network blocks traffic between devices.
//   Each window = one person, drawing in its OWN layer and colour; the others paint that layer from its marks (vector
//   data, so lines stay sharp at any size) and replace it with an image after an undo, a redo, a clear or an open.
//   Presence: every window sends its cursor (~25 Hz) and its state; settings: every window publishes its settings, and
//   accepts changes and commands from the others — a carer can tune the person's settings live, from their window.
//
//   Messages { type, from, … } (to: one window; otherwise everyone):
//     hello · here (reply) · beat (every 1.5 s) · bye         presence: { info: {id, variant, seat, name, color,
//                                                            joinedAt, aspect} }
//     cur {x, y, st}                                         the cursor in WORLD units (surface px / surface width)
//     ink {W, marks}                                         marks in the author's surface px (W: its surface width)
//     layer {W, img} · need                                  a whole layer image (ImageBitmap, else PNG Blob) · ask
//     cfg {cfg, extra}                                       a window's settings (+ tracker / hands status)
//     set {to, k, v} · cmd {to, cmd, arg}                    change someone's setting · run a command in their window
//     clearall                                               every window clears its own layer (undoable)
// ═══════════════════════════════════════════════════════════════════════════
const BEAT_MS = 1500, AWAY_MS = 6000, CUR_MS = 40;

export const shareSupported = () => typeof BroadcastChannel === 'function';
const newId = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : 'w' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export class Share {
  // info(): this window's presence ({variant, seat, name, color, aspect}); on: callbacks (all optional)
  //   peer(p, 'join' | 'update' | 'leave') · ink(p, W, marks) · layer(p, W, img) · need(p) · cursor(p) · cfg(p) ·
  //   set(k, v, p) · cmd(cmd, arg, p) · clearall(p)
  constructor({ room = 'studio', info, on = {} }) {
    this.room = room; this.info = info; this.on = on;
    this.id = newId(); this.joinedAt = Date.now();
    this.peers = new Map(); this.ch = null; this._beat = 0; this._sweep = 0;
    this._inkQ = []; this._inkW = 0; this._hold = 0; this._held = []; this._cur = { t: 0, st: '' };
  }
  get active() { return !!this.ch; }
  me() { return Object.assign({ id: this.id, joinedAt: this.joinedAt }, this.info()); }
  // everyone in the room, oldest first (the drawing's layers are stacked in this order; the oldest sets the world)
  members() { return [this.me()].concat([...this.peers.values()].map((p) => p.info)).sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1)); }

  start() {
    if (this.ch || !shareSupported()) return false;
    this.ch = new BroadcastChannel('inkwell18:' + this.room);
    this.ch.onmessage = (e) => this._receive(e.data);
    this._post({ type: 'hello', info: this.me() });
    this._beat = setInterval(() => this._post({ type: 'beat', info: this.me() }), BEAT_MS);
    this._sweep = setInterval(() => this._expire(), 1000);
    this._bye = () => this.stop();
    window.addEventListener('pagehide', this._bye);
    return true;
  }
  stop() {
    if (!this.ch) return;
    try { this._post({ type: 'bye' }); } catch (e) { /* closing */ }
    clearInterval(this._beat); clearInterval(this._sweep);
    window.removeEventListener('pagehide', this._bye);
    try { this.ch.close(); } catch (e) { /* closed */ }
    this.ch = null;
    for (const p of [...this.peers.values()]) this._leave(p);
  }
  restart(room) { this.stop(); if (room) this.room = room; this.joinedAt = Date.now(); return this.start(); }
  announce() { if (this.ch) this._post({ type: 'beat', info: this.me() }); }   // my name / colour / aspect changed

  _post(msg) {
    if (!this.ch) return;
    msg.from = this.id;
    try { this.ch.postMessage(msg); }
    catch (e) {   // a value that cannot be cloned (an ImageBitmap in some browsers): say so once, drop the message
      if (!this._warned) { this._warned = true; console.warn('[inkwell share]', e); }
    }
  }
  _emit(name, ...a) { const f = this.on[name]; if (f) { try { f(...a); } catch (e) { console.error('[inkwell share] ' + name, e); } } }

  // ------------------------------------------------------------------------------------------ receiving
  _receive(m) {
    if (!m || m.from === this.id || (m.to && m.to !== this.id)) return;
    let p = this.peers.get(m.from);
    if (m.type === 'bye') { if (p) this._leave(p); return; }
    if (m.info) {
      const fresh = !p;
      if (fresh) { p = { id: m.from, info: m.info, seen: Date.now(), cursor: null, cfg: null, extra: null }; this.peers.set(m.from, p); }
      else { p.info = m.info; p.seen = Date.now(); }
      if (fresh) {
        this._emit('peer', p, 'join');
        if (m.type !== 'here') this._post({ type: 'here', to: m.from, info: this.me() });   // so the newcomer meets me
      } else this._emit('peer', p, 'update');
      if (m.type === 'hello' || m.type === 'here') return;
    }
    if (!p) {   // a message from a window not met yet (e.g. this one reloaded): ask it to introduce itself
      this._post({ type: 'hello', info: this.me(), to: m.from });
      return;
    }
    p.seen = Date.now();
    switch (m.type) {
      case 'beat': break;
      case 'cur': p.cursor = { x: m.x, y: m.y, st: m.st, t: performance.now() }; this._emit('cursor', p); break;
      case 'ink': this._emit('ink', p, m.W, m.marks); break;
      case 'layer': this._emit('layer', p, m.W, m.img); break;
      case 'need': this._emit('need', p); break;
      case 'cfg': p.cfg = m.cfg; p.extra = m.extra || null; this._emit('cfg', p); break;
      case 'set': this._emit('set', m.k, m.v, p); break;
      case 'cmd': this._emit('cmd', m.cmd, m.arg, p); break;
      case 'clearall': this._emit('clearall', p); break;
    }
  }
  _leave(p) { this.peers.delete(p.id); this._emit('peer', p, 'leave'); }
  _expire() {   // a window that stopped talking (closed without a goodbye, or frozen) leaves after AWAY_MS
    const now = Date.now();
    for (const p of [...this.peers.values()]) if (now - p.seen > AWAY_MS) this._leave(p);
  }

  // ------------------------------------------------------------------------------------------ sending
  cursor(x, y, st) {   // world units; at most every CUR_MS, and at once when the state changes
    const now = performance.now(), c = this._cur;
    if (st === c.st && now - c.t < CUR_MS) return;
    if (st === 'off' && c.st === 'off') return;
    c.t = now; c.st = st;
    this._post({ type: 'cur', x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4, st });
  }
  ink(m, W) { this._inkQ.push(m); this._inkW = W; }
  flush() {   // once a frame: the marks of this frame in one message (held back while a layer image is on its way)
    if (!this._inkQ.length || !this.ch) { this._inkQ.length = 0; return; }
    const msg = { type: 'ink', W: this._inkW, marks: this._inkQ.splice(0) };
    if (this._hold) this._held.push(msg); else this._post(msg);
  }
  // the whole layer: an ImageBitmap of the canvas (taken now; sent when ready), else a PNG — marks drawn meanwhile wait,
  // so they land on top of it in the other windows, in order
  async layer(canvas, W, to = null) {
    if (!this.ch) return;
    this.flush();
    this._hold++;
    let img = null;
    try { img = await createImageBitmap(canvas); }
    catch (e) { img = await new Promise((ok) => canvas.toBlob(ok, 'image/png')); }
    try {
      const msg = { type: 'layer', W, img };
      if (to) msg.to = to;
      try { this._postStrict(msg); }
      catch (e) { msg.img = await new Promise((ok) => canvas.toBlob(ok, 'image/png')); this._post(msg); }   // ImageBitmap not cloneable here
    } finally {
      this._hold--;
      if (!this._hold) for (const h of this._held.splice(0)) this._post(h);
    }
  }
  _postStrict(msg) { msg.from = this.id; this.ch.postMessage(msg); }
  need(to) { this._post({ type: 'need', to }); }
  cfg(cfg, extra) { this._post({ type: 'cfg', cfg, extra }); }
  set(to, k, v) { this._post({ type: 'set', to, k, v }); }
  cmd(to, cmd, arg) { this._post({ type: 'cmd', to, cmd, arg }); }
  clearAll() { this._post({ type: 'clearall' }); }
}
