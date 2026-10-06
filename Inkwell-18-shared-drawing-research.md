# Inkwell 18 — two browsers, one drawing (research note)

**Question (Pedro Amado, 6 Oct 2026).** Can two browsers share the same drawing — on one computer and, preferably, on two
computers on the same local network — with the tools we have: a plain LAMP stack online, this Mac, and no Node or other
installable server software? If extra server capability is needed, can the Mac act as the local server (e.g. with VS
Code port forwarding)?

**Status (updated 6 Oct 2026, build 18.0):** the **same-computer** part is built — §4.1 (the protocol of drawing
operations) and §4.2 (BroadcastChannel): windows of one browser, one per screen and webcam, share one drawing, cursors
and settings (see the README, *Drawing together*). Pedro's faculty network blocks traffic between devices, which made
this the first step. The **network** parts — §4.3 (the SSE / POST relay in PHP or Python) and §4.4 (WebRTC) — remain the
plan for sharing between computers; they reuse the same messages (`js/share.js`), so only the transport is new.

*Originally:* research only — nothing for build 18 had been built. Facts about browsers were checked against the sources
listed at the end (October 2026). The Mac's setup was read from this machine: macOS 14.7, **MAMP / MAMP PRO** (PHP
7.4–8.4 with `pdo_sqlite`), Python 3.9 (used by the hub's `serve-https.sh`), OpenSSL, sqlite3 — and Node 24 is in fact
installed at `/usr/local/bin/node`, though the plan below does not need it.

---

## 1. The short answer

**Yes, and without Node.** Browsers cannot open raw UDP or TCP sockets, but they don't need to: a drawing can be shared as
a stream of small **drawing operations** ("segment from A to B, this width, this colour"), and the web platform has
three ways to move them that fit our stack:

| Where the two browsers are | Best transport | Server | Latency (estimate, to measure in the spike) |
|---|---|---|---|
| Same computer, same browser (two windows, e.g. 17a and 17d side by side) | **BroadcastChannel** | none | < 1 ms |
| Two computers on the same network (or two different browsers on one computer) | **Server-Sent Events + POST** through a tiny **relay** on the Mac (Python, already used for `serve-https.sh`, or PHP in MAMP) | the Mac, over **HTTPS** | ~10–50 ms on a LAN |
| Anywhere (online) | the same relay as a **PHP file on the LAMP host** | the LAMP host | ~50–200 ms |
| Later, for live cursors at the lowest latency | **WebRTC DataChannel** (browser to browser, over UDP), set up through the relay | the relay only for the handshake | ~1–10 ms on a LAN |

**Recommendation.** Build v18 on **one drawing protocol** with **pluggable transports**: BroadcastChannel first (no server
— the fastest way to test the interaction), then the **SSE relay** — the same small endpoint in **PHP** (for the LAMP host
and MAMP) and in **Python** (an extension of `serve-https.sh`, zero installs) — so the identical app runs on one Mac, on
the LAN and online. Add WebRTC only if the relay's latency is felt (it should not be for drawing).

---

## 2. What the browser can and cannot do

| Technique | Same browser | Two browsers, one computer | Two computers (LAN) | Internet | Needs | Fit for us |
|---|---|---|---|---|---|---|
| Raw **UDP / TCP sockets** (Direct Sockets API) | — | — | — | — | Chrome **Isolated Web Apps** only — not ordinary pages | ✗ not available |
| **BroadcastChannel** | ✓ (same storage partition) | ✗ | ✗ | ✗ | nothing | ✓ phase 1 |
| `localStorage` "storage" events / SharedWorker | ✓ | ✗ | ✗ | ✗ | nothing | (older alternatives) |
| **Server-Sent Events** (server → browser) + **fetch POST** (browser → server) | ✓ | ✓ | ✓ | ✓ | any HTTP server that can stream (PHP, Python) | ✓ **the core** |
| Long polling / short polling | ✓ | ✓ | ✓ | ✓ | any PHP | ✓ fallback when a host buffers SSE |
| **WebSockets** | ✓ | ✓ | ✓ | ✓ | a **persistent** server process (Node, a PHP CLI daemon, Python with a library) | ✗ on shared LAMP; possible on the Mac but not needed |
| **WebRTC DataChannel** (peer to peer, SCTP over UDP) | ✓ | ✓ | ✓ | ✓ with STUN / TURN | a **signalling** channel (our relay) | ✓ phase 3 (optional) |
| WebTransport | | | | | an HTTP/3 server | ✗ not on LAMP |

Notes from the sources:

- **Raw sockets** exist only as Chrome's *Direct Sockets API*, which is "restricted to Isolated Web Apps (IWAs)" because it
  "grants low-level network access" — a normal web page cannot use UDP or TCP directly.
- **BroadcastChannel** connects pages "using the same storage partition" — the same browser and profile, same site. Chrome
  ↔ Safari on one Mac cannot talk through it (use the relay on `localhost` for that).
- **SSE** is one-way (server → browser; the browser sends with `fetch` POST). Without HTTP/2 a browser keeps **at most 6**
  open connections per domain across all tabs — fine for one stream per window. Reconnection is automatic: with an `id`
  on each event, the browser resumes with the `Last-Event-ID` header, so nothing is lost when a connection drops.
- **WebRTC**: `RTCPeerConnection` is widely available (since 2017). Data channels can be unordered and unreliable
  (`ordered: false`, `maxRetransmits: 0`) — UDP-like, ideal for live cursors — or reliable and ordered for strokes. On a
  LAN no STUN server is needed, but browsers hide local IP addresses behind random `….local` mDNS names (except on pages
  that already have camera / microphone permission, as 17a and 17d do); networks that block multicast can break those.

---

## 3. The four constraints that decide the design

1. **No raw sockets in a web page** (above): everything goes over HTTP(S), or WebRTC.
2. **The camera needs a secure context.** `https://…` and `http://localhost` are secure; **`http://192.168.x.x` is not**.
   The second computer reaching the Mac by its LAN address therefore needs **HTTPS**, or 17a / 17d cannot open the
   camera there. The hub already solves this for headsets: `serve-https.sh` serves the folder over HTTPS with a
   self-signed certificate (accept the warning once per device).
3. **The page and the relay on the same origin.** A page served over HTTPS cannot call an `http://` relay (mixed
   content), and since **Chrome 142** (28 Oct 2025) a page from a *public* site that calls a *local-network* address
   triggers a **Local Network Access** permission prompt. Serve the app and the relay from the same server and both
   problems disappear.
4. **LAMP is request / response.** PHP runs per request, with no long-lived process to hold WebSockets — but a PHP script
   *can* stream an SSE response for a while (each open stream holds one PHP worker — enough for a few clients), and
   EventSource reconnects by itself when the host ends the script. The PHP manual warns that `flush()` "may not be able
   to override the buffering scheme of the web server" (compression, FastCGI) — so the client must fall back to polling
   when a host buffers the stream.

A practical fifth: **Wi-Fi client isolation.** Many institutional and guest networks block device-to-device traffic. Test
the faculty network early; if it isolates clients, use the online relay, a phone hotspot, or a small travel router.

---

## 4. The recommended architecture

### 4.1 One protocol: drawing operations, not pixels

Each browser keeps drawing exactly as now (engine, agents, real ink). What it **sends** is what it **painted**:

```text
{ op: 'seg',   line, by, x0, y0, x1, y1, w, color }      // one stroke segment (also drips / splats as their primitives)
{ op: 'blot',  line, by, x, y, r, color, alpha }
{ op: 'line',  line, by, state: 'start' | 'end' }        // groups segments for undo
{ op: 'undo',  line, by }                                 // removes one of *your* lines everywhere
{ op: 'clear', by }                                       // after the Clear confirmation
{ op: 'cursor', by, x, y, state }                         // presence: ephemeral, ~20 Hz, never stored
{ op: 'hello' | 'bye', by, variant: '17a' | '17d' | …, name, colour }
```

- **Deterministic by construction:** the agents and the real-ink effects use randomness; sending the painted primitives
  (not the gaze or hand input) means every screen shows the same marks.
- **One shared world:** coordinates in a fixed drawing space (e.g. 2400 × 1500 units, or 0…1 with the aspect ratio),
  fitted to each screen — two laptops of different sizes show the same composition.
- **Total order:** the relay numbers every stored operation (`seq`); every client applies them in that order, so all
  copies converge. A latecomer loads the log from `seq 0` (or a PNG snapshot plus the operations after it).
- **Undo** affects only your own lines. The simplest correct rendering is **one layer per participant** (stacked
  canvases): undo repaints only your layer from your remaining operations; Clear clears all. (Interleaving two people's
  ink in one layer with independent undo needs a re-render of the affected area from the log — possible later.)
- **Small:** a segment is ~40–60 bytes of JSON; batched every 50–100 ms, an active drawer sends ~2–5 KB/s.

### 4.2 Transport 1 — BroadcastChannel (no server)

`new BroadcastChannel('inkwell-room-ABCD')`: every window of the same browser on the same computer receives the
operations at once. This is enough to **design and test the shared interaction now** — e.g. 17a (eyes) in one window and
17d (hand) in another, both pointed at one camera, or a second window on a projector as an audience view.

### 4.3 Transport 2 — the relay (SSE + POST): the core

Two endpoints, same origin as the app:

```text
POST  relay?room=ABCD             body: [ ops… ]           → { seq }          (store, numbered)
GET   relay?room=ABCD&since=N     Accept: text/event-stream → the ops after N, then new ones as they arrive
GET   relay?room=ABCD&since=N&poll=1                       → JSON of the ops after N (the polling fallback)
```

- **PHP version** (LAMP host, MAMP): ~60 lines. SQLite (`pdo_sqlite`, WAL mode) or one append-only file per room with
  `flock`. The SSE loop: send the ops after `since`, then check for new ones every 50–100 ms; `retry:` 500 ms; stop after
  ~25 s (shared hosts limit execution time) and let EventSource reconnect with `Last-Event-ID`. Headers:
  `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; empty the output buffers and
  `flush()` after each event; `session_write_close()` if sessions are used; switch compression off for the endpoint
  (`.htaccess`). If the stream arrives in bursts (a buffering host), the client switches to polling every 150–250 ms.
- **Python version** (the Mac, zero installs): the hub's `serve-https.sh` already runs Python's
  `ThreadingHTTPServer` over HTTPS for headsets; adding the two endpoints (an in-memory list per room, a `Condition` to
  wake the streams) makes it a LAN relay. Threads mean an open stream never blocks other requests.
- **Not** PHP's built-in server (`php -S`): it "runs only one single-threaded process", so one open stream would stall
  everything (unless started with `PHP_CLI_SERVER_WORKERS`); MAMP's Apache or the Python server are the right local
  hosts.

### 4.4 Transport 3 (optional, later) — WebRTC DataChannel

Use the relay only to exchange the WebRTC offer, answer and ICE candidates (signalling), then send operations directly
between the two browsers: an unordered, unreliable channel for cursors and a reliable one for strokes. Worth it for
*live presence* at the lowest latency, or to take load off a weak host. Costs: connection set-up code, mDNS / network
quirks, and STUN / TURN servers outside the LAN.

### 4.5 Where to run it — your setup

| Setting | How | Secure context (camera) | Remarks |
|---|---|---|---|
| **One Mac, one browser** | BroadcastChannel; any server, e.g. `python3 -m http.server`, open `http://localhost:…` | ✓ (localhost) | no relay |
| **One Mac, two browsers** (Chrome + Safari) | the Python relay on `localhost` | ✓ | |
| **Two computers, LAN** (recommended test) | `serve-https.sh` extended with the relay → both open `https://<mac-ip>:8443/inkwell-18/…` | ✓ (self-signed, accept once) | macOS may ask to allow incoming connections (once) |
| | or **MAMP PRO**: an HTTPS host on the SiX folder + `relay.php` | ✓ | the same PHP file as online; MAMP's Apache currently serves another project on :8888 |
| **Online** | `relay.php` (+ a writable folder or SQLite file) next to the app on the LAMP host | ✓ (the site's HTTPS) | check that the host streams SSE; the polling fallback covers it if not |
| **Remote testers, no shared network** | **VS Code port forwarding** of the Mac's server | ✓ (a public HTTPS URL) | built on Microsoft *dev tunnels*; needs a GitHub / Microsoft sign-in; private by default (the same account must sign in), *public* = anyone with the link; bandwidth limits; traffic goes through the internet |

VS Code port forwarding is therefore a **sharing tool, not a synchronisation technique**: it publishes a port of the
Mac, so it helps remote testers reach the Mac's relay — on a LAN it adds nothing but latency.

---

## 5. Interaction-design questions for v18 (to decide before building)

1. **Simultaneous or turn-taking?** Both can draw at once technically; for a person with LIS and a carer, a "my turn /
   your turn" gesture might be kinder (fewer surprises on the canvas).
2. **The partner's cursor.** For gaze users a moving cursor attracts the eyes (the reason the HTC Vive app hides one's
   own cursor while drawing). Options: hidden; a faint trace; visible only while the partner pauses. Configurable.
3. **Undo and Clear.** Undo = your own last line (proposed). Clear = everyone's drawing: ask both (a Clear request that
   the other confirms), or only the person who started the session?
4. **Identity.** A colour or a mark per participant, or the same ink for both (one drawing, one hand)?
5. **Agents across screens.** Agents are computed by their owner and arrive as ink — the other side sees the result, not
   the agents (they could be shown as small markers through the presence channel).
6. **17c (VR ring) with 2D variants.** The ring is 360°; a shared 2D world would occupy a sector of the ring (or the
   ring shows the shared drawing as a panorama). Later.
7. **Sessions.** Save the shared drawing as one session (all layers), with each participant's lines tagged.

## 6. Plan and effort (when we build it)

| Phase | Content | Effort (rough) |
|---|---|---|
| 0 · spike (1 hour) | Python relay + a test page drawing dots in two laptops over the faculty Wi-Fi and at home; the same with `relay.php` on the LAMP host — measures latency and catches client isolation or SSE buffering early | small |
| 1 · protocol + BroadcastChannel | `sync.js` (ops, batching, per-participant layers, presence, room code); 17a/17b/17d send what they paint; two windows on one Mac | medium |
| 2 · relay | `relay.php` and the Python relay (same API); reconnection; latecomer replay; the polling fallback; a room code / QR on the welcome screen | medium |
| 3 · WebRTC (optional) | signalling over the relay, data channels, fallback to the relay | medium–large |
| 4 · interaction | partner cursor modes, turn-taking, shared Clear, identity, session save | design + small code |

Risks: network client isolation (test in phase 0), hosts that buffer SSE (polling fallback), certificate warnings on
each device (one-time), the 6-connection limit (one stream per window), and the privacy of drawings on a public host
(room tokens; delete rooms after a few hours; the relay stores drawing operations only, never video).

---

## Sources (checked October 2026)

- Chrome for Developers — *Direct Sockets* (Isolated Web Apps only): <https://developer.chrome.com/docs/iwa/direct-sockets>
- Chrome for Developers — *New permission prompt for Local Network Access* (Chrome 142): <https://developer.chrome.com/blog/local-network-access>
- MDN — *Broadcast Channel API*: <https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API>
- MDN — *Using server-sent events* (6-connection limit, `retry`, `id`, one-way): <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>
- MDN — *Secure contexts* (localhost is trustworthy; a LAN IP over http is not): <https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts>
- MDN — *RTCPeerConnection* and *createDataChannel()* (`ordered`, `maxRetransmits`, `maxPacketLifeTime`): <https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection>, <https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel>
- discuss-webrtc — *PSA: Private IP addresses exposed by WebRTC changing to mDNS hostnames*: <https://groups.google.com/g/discuss-webrtc/c/6stQXi72BEU>
- PHP manual — `flush()`: <https://www.php.net/manual/en/function.flush.php>; *Built-in web server*: <https://www.php.net/manual/en/features.commandline.webserver.php>
- Visual Studio Code — *Port forwarding*: <https://code.visualstudio.com/docs/debugtest/port-forwarding>

**Funding.** This work is financed by national funds through the Portuguese funding agency, FCT — Fundação para a
Ciência e a Tecnologia, within the project «2023.11224.PEX» [DOI 10.54499/2023.11224.PEX].
