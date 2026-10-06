# Inkwell 18 — gaze drawing studio, drawing together

**Draw with your eyes** — or, in 18d, with your hand — **and draw together**: two windows of one browser, one per
screen and webcam, share one drawing. Inkwell is the gaze drawing studio of **[SiX — Drawing for Social Re-connectivity](https://six.fba.up.pt/)**
(FBAUP · FCT 2023.11224.PEX, PI Eliana Penedos-Santiago), a research project on drawing as expression and social
re-connection for people living with Locked-In Syndrome (LIS) or ALS, for whom the eyes may be the only reliable channel.
[Credits](#credits).

Build 18 is build 17.1 (16.1 + the hand-gesture variant, tuned on a real recording) plus **the shared drawing** —
**one app in four variants**, and any number of windows drawing together:

| Variant | Page | Input | Use it for |
|---|---|---|---|
| **18a · eye tracker** | `inkwell-18a-eyetracker.html` | webcam eye tracking with [InkGaze.js](lib/) (calibrated) | the main prototype |
| **18b · mouse cursor** | `inkwell-18b-mouse-cursor.html` | the mouse pointer as the "gaze" (same dwell, same escape) | quick tests, demos |
| **18c · cardboard** | `inkwell-18c-cardboard.html` | head orientation: a phone in a Cardboard viewer, a WebXR headset, or a desktop look-around preview | the 360° canvas in VR |
| **18d · hand gestures** | `inkwell-18d-hand-gestures.html` | **one hand through the webcam** (MediaPipe hands): the index fingertip is the cursor, finger poses choose the line, the thumb calls drawing agents | caregivers and able-bodied participants, drawing in the same studio with the same menu |

`index.html` lets you choose — and opens variants in separate windows for the two-screen setup. Every variant keeps its
**own** settings in the browser (separate from builds 16 and 17).

> **18.0 (6 October 2026) — drawing together.** Windows of the same browser in the same *room* share one drawing: each
> person draws in their own colour and layer, sees the others' cursors (a ring with their name) and drawings in real
> time, and anyone can open **another person's settings** in Configuration and change them live (a carer tuning the
> setup of the person who draws with the eyes). No network is used — it works where an institutional network blocks
> traffic between devices. Tested with two windows (18b + 18d) driven by scripted input in one browser; **not yet with
> two screens and two webcams**. See [Drawing together](#drawing-together-18).
>
> **Status (October 2026).** 18a–18c are build 16.1 renamed (same code and behaviour, plus one engine guard, below).
> 18b and the 18c preview were tested in a desktop browser (scripted gaze and head input). 18a runs on InkGaze 2.1,
> tuned on two real webcam recordings of one user; 18a in a real session, 18c on a phone and on a headset are **not
> yet tested on the devices**. **18d** was tested with synthetic hands (the pose classifier on 3D hand models at
> several angles, and the whole app driven by scripted hand frames) and the hand model loads and runs in the browser
> (GPU, ~7 ms a frame); it has **not yet been used with a real hand in front of a webcam**: the pose thresholds may need
> tuning in a first session (the camera preview shows how each finger reads). See [Status and limits](#status-and-limits).
>
> **17.1 (6 October 2026):** the fist pauses at once; the back of the hand pulled toward you undoes; the thumb ("L") and
> palm / back are read from rules **tuned on a real 2-minute recording of Pedro's hand** — see the [CHANGELOG](CHANGELOG.md).

---

## Contents

- [For users](#for-users): requirements · the first screens · the menu · drawing · **hand gestures (18d)** · **drawing together (18)** · options · configuration · cursor · languages · VR · helpers' keys · privacy
- [For developers and researchers](#for-developers-and-researchers): run · architecture · input · settings · sessions · languages · tests
- [Research defaults](#research-defaults) · [Status and limits](#status-and-limits) · [Credits](#credits)

---

## For users

### What you need

- **18a:** a computer with a webcam, **Chrome, Edge or Safari**, light on your face from the front, about 50–70 cm from
  the screen. The page must come from `https://` or `http://localhost` (browsers only allow the camera there).
- **18b:** any recent browser and a mouse or trackpad.
- **18c:** a phone (Android Chrome or iOS Safari) in a **Cardboard** viewer — or a WebXR headset — served over
  `https://` (motion sensors and WebXR need a secure page). On a computer, *Look-around preview* works with the mouse.
- **18d:** a computer with a webcam, Chrome, Edge or Safari, `https://` or `http://localhost`, and light on your hand.
  Sit about an arm's length from the camera; one hand in view (the other may rest).

### The first screens

1. **18a:** InkGaze's settings open first. Press **Start** (or **Resume** if you calibrated before) and look at each dot
   until its circle closes — 5 dots by default, 9 for the best fit. A saved calibration only needs a quick check.
   **18b / 18c:** press **Start**. **18d:** press **Start the camera** and allow it; show one hand and point with your
   index finger. Then **Calibrate reach** (the first time; see below) or **Continue**.
2. **Three dots** appear, centred vertically at the middle of the left third, the centre and the middle of the right
   third. Look at each one: it grows a little, a ring fills (0.8 s), it turns red and pops with a short chime.
3. The **welcome screen**: the *inkwell* logo, the **play** button, **About**, **Help** and **Configurations** at the
   bottom, and the **languages** at the top right. Everything works by looking (a dwell) or by a click (18d: by holding
   the fingertip still, by a finger tap, or by a click).

### The menu (bottom)

Seven buttons: three, a larger central one, three. Each label shows the current choice.

| Button | Choices |
|---|---|
| **Line** | *Rigid Line* (heavily smoothed, constant width) · *Dynamic Line* (default: balanced, slow = thick, fast = thin) · *Fluid Line* (closest to your gaze, alive; drips and splats) |
| **Thickness** | *Thin Line* 0.18° · *Medium Line* 0.40° (default) · *Thick Line* 0.90° — sizes in degrees of visual angle, each a clear visual step |
| **Colour** | *Black Color* (default) · *Red Color* (deep red) · *Blue Color* (navy) · *White Color* |
| **Press to Draw / Press to Pause** (centre, larger) | Draw mode on (▶) or off (❚❚): the pencil on or off the desk |
| **Grid** | *Freehand Mode* (default) · *Grid Mode (on)* · *Grid Mode (feedback)* · *Grid Mode (hidden)* |
| **Undo** | the last line (repeatable) |
| **Options** (⋮) | *Clear Drawing* · *Save Drawing* · *Open Drawing* · *Configuration* |

Look at a button for **0.8 s** to press it (a red ring fills); a quick glance away (< 0.2 s) does not reset it. A button
that has just fired waits until you look away. Submenus open above their button; look at an option to choose it.

### Drawing

1. **Press to Draw.**
2. Look where the line should start and keep your gaze still: the ring around the cursor fills (0.8 s) and the line
   starts. (Configuration can switch this dwell off: then the line starts as soon as your gaze settles.)
3. Draw by moving your eyes. One **agent** — a small pen with weight and inertia — follows your gaze and lays the ink.
4. **Stop** with the **escape saccade**: a quick, large look away (≥ 30 % of the screen diagonal within 0.2 s; in VR a
   head flick faster than 160°/s). The line ends and the studio returns to rest (*Press to Draw* again for the next
   line). Looking at the menu also lifts the pen.

There is no ink reservoir (since build 16): a line lasts until you stop it.

**Grid modes.** A lattice of dwell dots (3° apart). Dwell a dot to start, the next one to draw a straight segment;
to stop, look away and dwell the last dot again, or make an escape saccade. *On* shows all dots, *feedback* lights a
dot only while you look at it, *hidden* shows only the dot you aim at.

### Hand gestures (18d)

For a caregiver or an able-bodied participant: the same studio and menu, worked with **one hand** (right or left) in
front of the webcam. The **index fingertip** is always the cursor, whatever the other fingers do.

| Hand | What it does |
|---|---|
| **Index pointing** (the other fingers closed or half-closed, the thumb in) | **Draw mode on**, **thin line** (direct pen) |
| **Index + middle** (ring and little finger closed) | **medium line** |
| **Index + middle + ring** (little finger closed) | **thick line** |
| **Hold the fingertip still** (0.8 s) | on the canvas: **start the line**, and again to **pause** it · on a button: **press it** (as the eyes do) |
| **Finger tap** (curl the pointing finger and straighten it within ½ s) | a **click** on the button under the cursor (also *Clear* in the confirmation) |
| **Thumb out** (an "L" with 1, 2 or 3 fingers) | **agents**: 1 to 5 drawing agents with random (always stable) settings draw with you at the same thickness — a new random set every time the thumb comes out |
| **Thumb back in** | the line **pauses**, the agents go, the pen is direct again |
| **Fist** | **pause at once** (17.1: the line stops on the next frame, no dwell), then Draw mode off |
| **Open hand, palm to the camera, waved** (left → right → left) | **Clear Drawing?** opens; confirm by pointing at *Clear* and holding still (1.2 s) or tapping; *Cancel* keeps the drawing |
| **Back of the hand to the camera, pulled toward you twice** (fold the fingers toward yourself and open them again) | **Undo** (17.1): your last line; two more pulls, one more undo |

- **Only a pointing hand presses or inks**: a fist or an open hand moving over the menu never triggers it.
- **Reach.** The part of the camera view that covers the whole screen (the dashed box in the camera preview) is set by
  **Calibrate reach**: point and trace a large rectangle in the air for 5 seconds, as far as is comfortable — down to
  where the menu is. Every corner, the menu and the pan edges are then reachable with the whole hand in view. Key `c`.
- **The camera preview** (top left; key `h`, or Configuration) shows the hand, the reach box, five bars for how
  extended each finger reads (thumb … little finger; red = counted as out) and the pose. Beside the cursor, a short
  label confirms each new pose ("Medium Line · 3 agents", "fist · rest", "open hand · wave to clear").
- After a dwell has started or paused the line, the fingertip must move a little before the next dwell counts, so
  holding still never toggles the line on and off.
- The cursor stays visible while drawing (the reason it hides for the eyes — they drift after it — does not apply to a
  hand). There is no escape saccade in 18d.

### Drawing together (18)

**Two people, two screens, two webcams, one computer, one drawing.** For example: the person with LIS draws with the eyes
in **18a** (webcam 1, screen 1); a carer draws with the hand in **18d** (webcam 2, screen 2).

1. Open the first variant. Open a **second window of the same browser** (⌘N / Ctrl+N — or the *new window* buttons on
   the start page) with the second variant, and move it to the other screen.
2. Each window uses **its own camera**: in 18d choose it on the first screen (or Configuration → Hand gestures →
   Camera); in 18a choose it in the eye-tracker settings.
3. The windows **join by themselves** (a toast: "… joined the drawing"; the names appear at the top right of the
   studio). No network, no server: the windows talk inside the browser.

| | |
|---|---|
| **Colours** | each person draws in their own colour; a window that joins with a colour already in use takes the first free one (black, red, blue) — the menu still changes it |
| **Cursors** | the others' cursors show as a ring in their colour with their name (dashed at rest, a dot while drawing, faint when they use their menu). Configuration → Shared drawing → *Show the others' cursors* (for a person drawing with the eyes, a moving cursor can pull the eyes — switch it off in *their* window) |
| **Drawings** | each person's ink is a layer, stacked in the order people joined (the same in every window); it appears in the others' windows as it is drawn, sharp at any screen size |
| **Undo, Clear** | change only your own drawing; Configuration → Shared drawing → *Clear everyone's drawing* clears all (each person can still Undo their own) |
| **Settings of another person** | Configuration → *Settings of* → their name: the panel shows **their** settings, and every change applies in their window at once and is saved there (dwell times, line, filters, ink, agents, cursor, amplification, grid; the eye tracker's recentre and calibrations; the hand's reach). They see "… adjusted your settings". Language, name and room stay each person's own |
| **Proportions** | the first window sets the drawing's proportions; a window with other proportions shows the same drawing fitted, with a quiet band around it |
| **Save Drawing** | saves the drawing as everyone sees it (PNG); the session file keeps your own layer, which *Open Drawing* restores into your layer |
| **Rooms** | Configuration → Shared drawing → *Room*: windows in the same room draw together (default *studio*); *Your name*; switch sharing off there |
| **Same variant twice** | two windows of the same variant (two eye trackers, two mice) keep apart settings — and calibrations — with `?seat=2` at the end of the address |

A window that closes leaves the drawing (its layer goes from the others' windows; *Save Drawing* first to keep it).
18c (VR) does not take part yet. Sharing across computers (a LAN or the internet) is the next step: see
[`Inkwell-18-shared-drawing-research.md`](Inkwell-18-shared-drawing-research.md).

### Options

- **Clear Drawing** opens a confirmation (as in the HTC Vive app): **Cancel** or **Clear**. Clear needs a longer look
  (1.2 s; a brief wobble is tolerated, looking away cancels it). To leave without choosing, look well away from the box
  for about a second. Undo can still bring the drawing back.
- **Save Drawing** downloads a **PNG** of the canvas and a **JSON session** (the drawing, every setting, the agents and —
  in 18a — your InkGaze calibration; in 18d the reach). A copy stays in this browser (the last 12).
- **Open Drawing** shows your recent drawings (look at one to open it) and **Load a file…** for a session JSON. Browsers
  only open a file dialog after a click or a tap, so that button needs one.
- **Configuration** opens every setting (below).

### Configuration

Grouped in sections; every change is saved at once, for this variant only.

- **Language** — the app's language, load a language file, download a template.
- **Activation (the Midas touch)** — menu dwell (0.8 s), Clear dwell (1.2 s), exit grace (200 ms), target allowance
  (+50 % invisible hit area), **dwell on the canvas starts the line** (on / off) and its time, **dwell on the canvas stops
  the line** (off; 18d: on), **escape saccade stops the line** (on; not in 18d), **… and switches Draw mode off** (on),
  escape size (18a/18b) or head speed (18c), **long blink** starts / stops the line (18a, off), settle speed, dwell
  tolerance.
- **Cursor** — **show the cursor while drawing** (off), **show the cursor while paused** (on), cursor responsiveness.
- **Line** — line option, thickness, colour, pixels per degree (18a/18b/18d), the 1€-filter settings of each line option.
- **Ink behaviour** — engorge, widest / thinnest speeds, drips, splats.
- **Agents (boids)** — presets; add, remove, randomise or reset agents; each agent's speed, spring, damping, mass and
  jitter; the template for new agents. Default: one agent.
- **Gaze amplification & assistive pan** (18a/18b/18d) — amplification, edge-pan (off), comfort box, pan speed, canvas size.
- **Grid mode** — dot spacing, size, jitter padding.
- **VR** (18c) — stereo, head sensitivity, eye separation, lens distortion, field-of-view zoom, menu follow delay
  (350 ms) and time, menu height, inverted aim.
- **Eye tracker** (18a) — status, InkGaze settings, recentre, calibrate with 5 or 9 dots.
- **Hand gestures** (18d) — camera status, **Calibrate reach**, **Default reach**, fingertip smoothing (1€), pose hold
  (120 ms), finger tap on / off, wave size (10 % of the view) and time (1.6 s), pulls per undo (2) and their time (2.8 s),
  camera preview on / off.
- **Settings** — reset to defaults, clear the saved settings, About, Help, the start screen.

### The cursor

As in the HTC Vive app, the cursor **hides while you draw** (18a–18c; 18d keeps it) — a visible cursor invites the eyes to follow it and drift.
The ink shows where the pen is. While paused (Draw off, after an escape or a dwell stop) the cursor is a **dashed
light-grey circle**; when Draw is on and waiting for your dwell it has a small red centre dot. Both are switchable in
Configuration → Cursor.

### Languages

English (default) and **Portuguese** are included; choose on the welcome screen or in Configuration → Language. To
**add or correct** a language: Configuration → Language → *Download the current language (template)*, translate the
texts (keep the keys, the `{placeholders}` and the HTML tags), then *Load a language file…* — it stays in this browser.
Or add the file to `i18n/` and list it in `i18n/languages.json` so everyone gets it. The InkGaze window is in English.

### VR (18c)

- **Start (this phone)** asks for the motion sensors (iOS), goes full screen and to landscape. Put the phone in the
  viewer: your head aims at the centre of the view.
- The canvas is a **360° ring** around you, from 40° above to 35° below the horizon: turn around to draw anywhere.
- The **menu** floats below your eyes. When you turn, it waits **350 ms**, then glides (ease-in-out) to your new
  heading — never while you are looking at it. Look down at it to use it.
- **One tap** on the screen (the Cardboard button) selects what you aim at; a **double tap** recentres the view.
- **Enter VR** appears when the browser supports WebXR headsets.
- On a computer, **Look-around preview**: drag (or the arrow keys) to look around.

### Helpers' keys (keyboard / Wiimote controller layer of build 15)

`q` pen down / up · `w` `s` thickness · `a` `d` line option · `o` `l` colour · `k` (or `z`) undo · `ç` (or `y`) redo ·
`e` twice clear · `g` grid mode · `i` / `p` 3D view on / off (18a/18b/18d) · `r` recentre the canvas (18c: the view) ·
`c` recentre the eye tracker (18a) or calibrate the reach (18d) · `h` camera preview (18d) · `f` full screen · `Esc`
close (18a: otherwise the eye-tracker settings). In 18b and 18d a click on the canvas starts / stops the line; clicks on
the menu act at once.

### Privacy

The camera image never leaves the device (InkGaze runs the face model locally; 18d runs the hand model locally).
MediaPipe is pinned to 0.10.35, which sends no usage telemetry. Settings, calibrations and recent drawings stay in this
browser; files are only written when you press *Save Drawing*.

---

## For developers and researchers

### Run

No build step. Serve the folder (the hub folder works too) and open a page:

```bash
python3 -m http.server 8000
```

ES modules and the camera need `http://localhost` or `https://`; phones need `https://` (see `../serve-https.sh` in the
hub). 18c loads **three.js 0.160.0** from jsDelivr through an import map; 18a/18b load `lib/inkgaze.js` (InkGaze 2.1);
18d loads **MediaPipe Tasks Vision 0.10.35** (`vision_bundle.mjs` + WebAssembly, jsDelivr) and the *hand_landmarker*
float16 model (Google storage) when the camera starts.

### Architecture

| File | Role |
|---|---|
| `js/main.js` | bootstrap: loads the language, then the 2D app (18a/18b/18d) or the VR app (18c) |
| `js/core.js` | variants, design tokens, **defaults**, per-variant settings storage, maths, the 1€ filter, the agent (boid), the chime |
| `js/engine.js` | the shared drawing engine: Draw mode, line start / stop (dwell, escape, blink), the escape re-arm guard, 1€ smoothing per line option, agents in 60 Hz steps, real-ink expression, grid mode, menu dwell |
| `js/hud.js` | the 7-button menu: layout, hit-testing (hit areas grown by the target allowance, never overlapping), canvas rendering, submenus, the Clear / Open modals, the cursor |
| `js/surface.js` | the drawing surface (tiles; a ring that wraps for VR) with **cell-based undo** (128-px cells, 24 steps) and dirty rectangles |
| `js/ui.js` | DOM screens: gaze dwell for DOM elements (`GazeDom`), intro dots, gate, welcome screen, About, Help, Configuration, agents editor, language switcher, toasts |
| `js/app2d.js` | 18a/18b/18d runtime: InkGaze input or the hand input (poses → Draw mode, thickness, agents, rest, wave → Clear, tap → click; the reach), amplification / pan, rendering, clicks, keys, 3D analysis view, sessions; **18: the shared drawing** — the paper and the layers, the partners' ink, cursors and settings, Configuration for another person |
| `js/share.js` | **18:** `Share` — the room on a BroadcastChannel: presence (hello / here / beat / bye, 6-s timeout), cursors, ink marks (batched per frame), whole-layer images (ImageBitmap, else PNG; marks drawn meanwhile wait), settings (`cfg`), remote `set` and `cmd`, clear-all |
| `js/marks.js` | **18:** every mark of ink as data (segment, blot, drip, splat — random droplets chosen once by the author), painted by the engine and again, scaled, in the partners' windows |
| `js/hands.js` | 18d: `HandInput` (camera, MediaPipe HandLandmarker, one hand kept, the fingertip → screen through the reach box + 1€, the pose classifier with hysteresis and debounce, tap, wave, reach sweep, the camera preview) and `randomOrchestra()` (1–5 stable random agents) |
| `js/vr.js` | 18c runtime: three.js ring, following menu, 3D intro and welcome panels, head pose (sensors / WebXR / drag), stereo + normalised lens distortion, partial texture uploads |
| `js/sessions.js` | Save (PNG + JSON + IndexedDB copy) and Open |
| `js/i18n.js`, `i18n/*.json` | languages |
| `lib/inkgaze.js`, `lib/inkgaze.css` | InkGaze 2.1 (unchanged copy) |

### Input

**18a** creates `new InkGaze({ storageKey: 'inkwell18.inkgaze', escapeAmplitude })` and calls `init()`: InkGaze's own
dialog takes over (calibration or resume), and its status `tracking` hands the stage to the app. The app listens to
`data` (x, y, state, blinkMs → the cursor, the engine), `saccade` (`escape` → `engine.escape()`), `blink` (`long` →
`engine.blink()`, opt-in), `status` (gate messages, pause) and `quality` (recentre hint). Completed menu dwells call
`ig.learn(x, y)` at the target's centre, so the calibration improves where the menu is. During a saccade the pen target
is held for up to 100 ms, so an escape never leaves a streak.

**18b** runs InkGaze's **mouse source** (`source: 'mouse', ui: false, persist: false, smoothing: 0`): the pointer becomes
the gaze with the same states, saccades and escapes. **18c** reads the head direction (DeviceOrientation, WebXR pose or
drag) and computes the flick speed itself.

**18d** (`hands.js`) opens the camera (640 × 480, 30 fps), runs **HandLandmarker** in VIDEO mode on every new frame
(`requestVideoFrameCallback`; up to two hands, the one in use is kept; GPU with a CPU fallback; a warm-up inference while
"Loading the hand model…" is shown) and keeps:

- **the cursor**: the index fingertip (landmark 8), mirrored, mapped from the reach box `cfg.handBox` (default
  x 0.18–0.82, y 0.12–0.66 of the view) to the screen, 1€-filtered in pixels (`handSmooth`);
- **the pose**, from the 3D world landmarks (rotation- and distance-independent): each long finger's extension score
  (bend at the middle and end joints, straightness, tip beyond the middle joint seen from the wrist; extended above
  0.62, folded below 0.40, hysteresis in between) and the thumb's spread (tip ↔ index knuckle in palm lengths: out above
  0.80, in below 0.64 — **17.1:** the thumb is out when straight, CMC → tip over its length ≥ 0.965, and ≥ 0.50 palm
  lengths from the index knuckle; in when ≤ 0.945 or ≤ 0.45) → `point` 1/2/3 (+ thumb), `fist`, `palm` / `back` (17.1:
  the signed turn of the wrist–knuckle triangle in the image × the voted left / right; back above +0.22, off below
  +0.10), `other`; a new pose counts after `poseStableMs` (a thumb change 1.5 ×; pointing → open hand 0.3 s; a folding
  index first waits 0.42 s for a tap — but stops aiming at once);
- **tap**: while pointing, the index folds for ≥ 2 frames and straightens within 60–520 ms, the wrist still (< 5 % of
  the view): a click where the fold began (the cursor holds there meanwhile);
- **wave**: the open **palm**; a zig-zag on the palm's x — two swings of ≥ `waveMinSwing` within `waveWindowMs`;
- **pull** (17.1): the **back** of the open hand, then a fold (fingers folding, or the hand lost for a moment) and back
  open within 1.1 s; `undoPulls` of them within `pullWindowMs` → Undo.

The app maps poses to the engine: a pointing onset → `setDrawMode(true)`; fingers → `setThickness`; thumb out →
`spawnBoids(randomOrchestra())`, thumb in → `penUp` + no agents; fist → `penUp`, Draw off; wave → `openModal('clear')`;
tap → the menu / modal action or `GazeDom.press()` on the screens. Only a pointing hand aims (`aiming()`): a fist or an
open hand never dwells or inks. One engine change for all variants: after a canvas dwell fires, the cursor must move two
dwell radii before the next one counts (with dwell-start and dwell-stop both on, holding still no longer toggles).

The engine's per-frame input: `{ now, dt, hudId, overHud, surf: {x, y}, gazeDegS, blinkMs, lost }`.

### The shared drawing (18)

- **Layers.** The 2D surface is transparent (`Surface({ bg: null })`) over a paper `div`; each partner gets a canvas the
  size of this surface. All are stacked by join time (the oldest lowest) in every window, so overlaps look the same.
- **Ink.** The engine paints every mark through `engine.mark(m)` (`marks.js`) and hands it to `hooks.onInk`; the app
  queues it and `share.flush()` sends one `ink` message per frame `{ W: surface width, marks }`. A partner paints the
  marks scaled by its layer width / W (vector: sharp at any size).
- **Whole layers.** Undo, redo, clear and open send the layer as an ImageBitmap (PNG Blob if the browser cannot clone
  one); marks drawn meanwhile are held and sent after it, so they land on top. A newcomer asks everyone for their layer
  (`need`).
- **The world.** Coordinates are surface px; cursors travel in world units (px / surface width). The oldest window's
  proportions are adopted by the others (letterboxed with `body.letterbox`).
- **Settings.** Each window publishes its settings (and the eye tracker's / hand tracker's status) after every change;
  `set {k, v}` from a partner goes through the same `onCfgChange` as a local change (never the room or sharing itself);
  `cmd` runs presets, agents, reset, the tracker's recentre / calibrations, the reach and clear in the partner's window.
  Configuration shows a partner's settings by giving `openConfig` that partner's published settings, its variant, and
  callbacks that send instead of apply.

### Settings

`localStorage['inkwell18.<variant key>[.seatN].settings']` = `{ schema: 1, version, savedAt, cfg }`, where `cfg` holds **only the
values that differ from the defaults** (so a better default in a later build reaches returning users). The agents are
stored as `cfg.agents`; 18d's reach as `cfg.handBox` and its camera as `cfg.handCameraId`; the shared drawing as
`shareOn`, `shareRoom`, `shareName`, `showPartners`. A second seat (`?seat=2`) adds `.seat2` before `.settings` (and to
InkGaze's key). The language is global: `localStorage['inkwell18.lang']`; loaded language files: `inkwell18.lang.custom`.
InkGaze keeps its calibration under `inkwell18.inkgaze`. Build 18 never reads or changes the keys of builds 16 and 17
(`inkwell16.*`, `inkwell17.*`), so the builds can be compared side by side.

### Session file

`<variant key>_<timestamp>.json`:
`{ format: 'inkwell-session', schema: 1, build, version, variant, savedAt, settings, state: { lineMode, thickness, color,
gridMode, boids[] }, calibration (InkGaze exportCalibration(), 18a), drawing: { width, height, wrap, png }, credits }`.
Opening restores the settings (keeping hardware-specific ones when the variant differs), the agents, the drawing (fitted
to the canvas) and, in 18a, the calibration (`importCalibration`; a recentre is advised). The sessions database is
`inkwell-17` (IndexedDB).

### Languages

`i18n/en.json` is the reference (every key); other files may be partial (missing keys fall back to English).
`i18n/languages.json` lists the bundled ones. Keys are nested; long texts are arrays of HTML paragraphs.
`t('toast.saved', { png, json })` fills `{placeholders}`. The funding statement is not translated (used verbatim).

### Tests and debugging

`window.inkwell` exposes the state. In a hidden tab (no `requestAnimationFrame`), drive frames on a virtual clock:

```js
inkwell.goStudio(); inkwell.testMode();          // 18a/18b: stop live input
inkwell.inject(300, 200); inkwell.step(60);      // one second of gaze at (300, 200)
inkwell.engine.S.penDown                          // → true after a dwell, with Draw mode on
// 18c
await inkwell.goStudio(); inkwell.look(20, 10); inkwell.step(60); inkwell.hudTarget('btn:draw');
// 18d: no camera — the tracker as if running, then hand frames (every 33 ms of hand time) between app frames
const hands = await inkwell.handTest(); inkwell.goStudio();
hands.inject({ pose: 'point', n: 2, thumb: true, x: 500, y: 300 }, t);   // or hands.feed(handLandmarkerResult, t)
inkwell.step(2, 16.5);
// 18: open two pages (two tabs work too): inkwell.share.peers, inkwell.SH.layers (the partners' canvases),
// inkwell.share.set(peerId, 'menuDwellMs', 1100) / .cmd(peerId, 'preset', 'chorus'), inkwell.compose() (the PNG of Save)
```

`hands.js` exports the pure parts for unit tests: `classify(landmarks, prev, THRESH, { img, handed })`,
`fingerExtension`, `thumbSpread`, `thumbStraight`, `handFacing`, `poseOf`, `WaveDetector`, `PullDetector`, `boxFrom`,
`randomOrchestra`, `agentStable`. 17.1 was tuned by running MediaPipe over a real recording and replaying the landmarks
through `HandInput.feed()` (in Node, and through the whole app in the browser).

---

## Research defaults

From the project's *Research & Practice Dossier* (§7.7–§7.10) and the HTC Vive app; all adjustable.

| Setting | Default | Why |
|---|---|---|
| Menu dwell | 0.8 s | the S3 standard dwell |
| Clear confirmation | 1.2 s, cancelled on exit | a destructive action is visibly different and harder to trigger |
| Exit grace | 200 ms | a brief glance away does not reset a dwell (150–250 ms) |
| Target allowance | +50 % area | invisible hit areas larger than the buttons, never overlapping |
| Start a line | canvas dwell 0.8 s | "arm, then act": Draw mode, then a deliberate start |
| Stop a line | escape saccade → rest | a large, fast look-away separates a command from looking (Møllenbach et al. 2010, [10.1145/1743666.1743710](https://doi.org/10.1145/1743666.1743710); Drewes & Schmidt 2007, [10.1007/978-3-540-74800-7_43](https://doi.org/10.1007/978-3-540-74800-7_43)); dwell-to-stop is off |
| Line smoothing | 1€ filter per line option, in degrees | Casiez, Roussel & Vogel 2012, [10.1145/2207676.2208639](https://doi.org/10.1145/2207676.2208639) |
| Thickness | 0.18° / 0.40° / 0.90° | visual-angle steps inside sharp central vision (dossier §7.8) |
| Cursor | hidden while drawing; dashed when paused | the HTC Vive app: a visible cursor makes the eyes drift after it |
| Intro dots | 64 px (+ hit area ≥ 1.6°) | the top of the requested 48–64 px: webcam gaze is accurate to ~2–4° |
| Agents | 1 (18d: none until the thumb comes out) | the pen has weight and inertia; more in Configuration |
| 18d line toggle | dwell starts **and** pauses the line (0.8 s) | "pause to toggle" — the hand, unlike the eyes, can hold still without staring |
| 18d pose hold | 120 ms (thumb 180 ms) | no flicker between poses; agents are not re-randomised by a wobbling thumb |

## Status and limits

- **Tested:** 18b end to end and the 18c desktop preview (scripted input in a browser): dwell, menus, Clear modal,
  undo, escape, the re-arm guard, grid mode, languages, configuration, the ring, the seam, the following menu, stereo
  with and without lens distortion (no cropping), partial texture uploads.
- **18d, tested without a camera:** the pose classifier on synthetic 3D hands (11 poses × 4 hand angles, all correct);
  the whole app driven by scripted hand frames (pointing → Draw on + thin, 2 / 3 fingers → medium / thick while
  drawing, dwell start and pause, no re-toggle while still, thumb → 1–5 agents inking and a new set each time, thumb in
  → pause + direct, fist → rest, slow open-hand moves → no wave, a wave → Clear, confirmed by dwell, Cancel and menu
  buttons by tap, the reach sweep, the gate states, Configuration); 6 000 random agents, all stable; the hand model
  loads (GPU) and runs at ~7 ms a frame after a warm-up.
- **18, two windows** (18b + 18d as two tabs of one browser, scripted mouse and hand input): they meet by themselves;
  the newcomer takes a free colour; each one's ink appears in the other's layer (checked pixel by pixel, the same count
  in both windows at rest); cursors with names; an undo, a clear and *Clear everyone's drawing* follow; the carer's
  window changes the partner's dwell, line option and agents preset, which apply and are saved there; Configuration
  shows *Settings of* and the partner's own sections; a window that closes leaves after 6 s (at once when the browser
  sends its goodbye). **Not yet tried:** two physical screens and two webcams, two eye trackers at once, Safari.
- **18d on a real hand (17.1):** Pedro's 2-minute recording (one person, one camera, one room) was run through the
  classifier and the whole app: every pose and gesture read as performed, with one false tap (at a screen corner) and one
  0.25-s pause from a misread little finger with the hand held low and sideways. Other hands, lighting and cameras are
  still to be tried; the five bars in the camera preview show how each finger reads.
- **Not yet tested on devices:** 18a with a real webcam session in Inkwell (InkGaze itself was tuned on two recordings);
  18c on a phone in a Cardboard viewer and on a WebXR headset.
- The InkGaze window is English only. Phone performance of the 360° ring (8 textures of 675 × 1125 px) is untested.

## Credits

**[SiX — Drawing for Social Re-connectivity](https://six.fba.up.pt/)** (FBAUP · FCT 2023.11224.PEX). This prototype exists
within, and because of, the [SiX project](https://six.fba.up.pt/). **Principal Investigator:** Eliana Penedos-Santiago
(ID+ · FBAUP). **Team:** Andreia Pinto de Sousa, Bruno Giesteira, Cláudia Lima, Pedro Amado, Sílvia Simões, Viviane
Peçaibes. **Consultants:** Filipe Gonçalves (APELA), Miguel Alves-Ferreira (CGPP-IBMC / i3S). **Collaborators:** Lara
Portelinha, Manuel Silva, Vasco Praça. **Partners:** APELA · ADITGAMES · i3S / IBMC · Fraunhofer AICOS.

- **Concept and interaction design:** Eliana Penedos-Santiago, Andreia Pinto de Sousa, Manuel Silva and Pedro Amado
  ([SiX](https://six.fba.up.pt/) design prototyping, Task 3, led by Pedro Amado).
- **Interface design, the expressive line and the drawing agents:** Pedro Amado (FBAUP / i2ADS). This covers the rigid,
  dynamic and fluid line; variable thickness, drips and splats; and the agentic drawing mode (boids). Conceived and
  developed in this web prototype since May 2026.
- **Grid (dot) mode:** from the [SiX](https://six.fba.up.pt/) team's first prototypes and from Andreia Pinto de Sousa's and
  Eliana Penedos-Santiago's work with post-graduate students.
- **From the [SiX](https://six.fba.up.pt/) VR application:** settings and interaction decisions tested by Manuel Silva in the
  HTC Vive Focus Vision app (Unity) — for example, the hidden drawing cursor and the Clear confirmation.
- **Web prototype:** directed by Pedro Amado. Code written with AI models: Google Gemini 2.5 Pro and 3.1 Pro (first
  builds) and Anthropic Claude Opus 5.5 (the full code of Inkwell 16–18 and InkGaze.js).
- **InkGaze.js:** concept and design by Pedro Amado; development by Claude Opus 5.5 (October 2026).

On the welcome screen: *A prototype of the [SiX research project](https://six.fba.up.pt/) · PI Eliana Penedos and the SiX
team · Interface, expressive line and drawing agents by Pedro Amado · code written with Gemini and Claude.*

### AI development timeline (the whole web-prototype series)

| Builds | Period | Code written with |
|---|---|---|
| 0.1–0.9 and the WebGazer baselines | February – mid-May 2026 | Google Gemini 2.5 Pro and 3.1 Pro |
| 04–15 | May – August 2026 | Anthropic Claude Opus 4.8 and Claude Fable 5 |
| InkGaze.js 2 and Inkwell 16–18 | October 2026 | Anthropic Claude Opus 5.5 |

All directed by Pedro Amado. AI models are credited as tools: authorship stays with the people credited above.

### Authorship record

The concepts credited to Pedro Amado can be traced in the dated builds of the hub (`../SiX-EyeDraw-project.md` §4–§5, and
the catalogue `../index.html`): the drawing agent (boid) as the pen in build 05 (`boids-05/`, 17 May 2026); drips in build
07 and drips and splats as separate effects in build 08 (`single-inkwell-07/`, `full-demo-08/`, 18 May 2026); the
speed-dependent real-ink width at the latest in build 12 (`gaze-draw-12/`, 24 July 2026); the rigid / dynamic / fluid line
options from builds 11–12 (`webxr-eyegaze-11/`, `gaze-draw-12/`, July 2026).

### Third-party

three.js (MIT) · MediaPipe Tasks Vision and the hand landmarker model (Apache-2.0; through InkGaze, and directly in
18d) · fonts: JetBrains Mono, Hanken Grotesk, Bricolage
Grotesque (Google Fonts, OFL).

**Funding.** This work is financed by national funds through the Portuguese funding agency, FCT — Fundação para a
Ciência e a Tecnologia, within the project «2023.11224.PEX» [DOI 10.54499/2023.11224.PEX].
