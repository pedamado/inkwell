# Inkwell 16 — gaze drawing studio

**Draw with your eyes.** Inkwell is the gaze drawing studio of **[SiX — Drawing for Social Re-connectivity](https://six.fba.up.pt/)**
(FBAUP · FCT 2023.11224.PEX, PI Eliana Penedos-Santiago), a research project on drawing as expression and social
re-connection for people living with Locked-In Syndrome (LIS) or ALS, for whom the eyes may be the only reliable channel.
[Credits](#credits).

Build 16 continues *Gaze Draw* 12–15 under its new name and is one app in **three variants**:

| Variant | Page | Input | Use it for |
|---|---|---|---|
| **16a · eye tracker** | `inkwell-16a-eyetracker.html` | webcam eye tracking with [InkGaze.js](lib/) (calibrated) | the main prototype |
| **16b · mouse cursor** | `inkwell-16b-mouse-cursor.html` | the mouse pointer as the "gaze" (same dwell, same escape) | quick tests, demos |
| **16c · cardboard** | `inkwell-16c-cardboard.html` | head orientation: a phone in a Cardboard viewer, a WebXR headset, or a desktop look-around preview | the 360° canvas in VR |

`index.html` lets you choose. Every variant keeps its **own** settings in the browser.

> **Status (October 2026).** 16b and the 16c preview were tested in a desktop browser (scripted gaze and head input).
> 16a runs on InkGaze 2.1, tuned on two real webcam recordings of one user; 16a in a real session, 16c on a phone
> (motion sensors, Cardboard lenses) and on a headset are **not yet tested on the devices**. See [Status and limits](#status-and-limits).
>
> **16.1 (6 October 2026):** Clear Drawing no longer stalls the page, and its confirmation can no longer trap the eyes
> (see the [CHANGELOG](CHANGELOG.md)).

---

## Contents

- [For users](#for-users): requirements · the first screens · the menu · drawing · options · configuration · cursor · languages · VR · helpers' keys · privacy
- [For developers and researchers](#for-developers-and-researchers): run · architecture · input · settings · sessions · languages · tests
- [Research defaults](#research-defaults) · [Status and limits](#status-and-limits) · [Credits](#credits)

---

## For users

### What you need

- **16a:** a computer with a webcam, **Chrome, Edge or Safari**, light on your face from the front, about 50–70 cm from
  the screen. The page must come from `https://` or `http://localhost` (browsers only allow the camera there).
- **16b:** any recent browser and a mouse or trackpad.
- **16c:** a phone (Android Chrome or iOS Safari) in a **Cardboard** viewer — or a WebXR headset — served over
  `https://` (motion sensors and WebXR need a secure page). On a computer, *Look-around preview* works with the mouse.

### The first screens

1. **16a:** InkGaze's settings open first. Press **Start** (or **Resume** if you calibrated before) and look at each dot
   until its circle closes — 5 dots by default, 9 for the best fit. A saved calibration only needs a quick check.
   **16b / 16c:** press **Start**.
2. **Three dots** appear, centred vertically at the middle of the left third, the centre and the middle of the right
   third. Look at each one: it grows a little, a ring fills (0.8 s), it turns red and pops with a short chime.
3. The **welcome screen**: the *inkwell* logo, the **play** button, **About**, **Help** and **Configurations** at the
   bottom, and the **languages** at the top right. Everything works by looking (a dwell) or by a click.

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

There is no ink reservoir in build 16: a line lasts until you stop it.

**Grid modes.** A lattice of dwell dots (3° apart). Dwell a dot to start, the next one to draw a straight segment;
to stop, look away and dwell the last dot again, or make an escape saccade. *On* shows all dots, *feedback* lights a
dot only while you look at it, *hidden* shows only the dot you aim at.

### Options

- **Clear Drawing** opens a confirmation (as in the HTC Vive app): **Cancel** or **Clear**. Clear needs a longer look
  (1.2 s; a brief wobble is tolerated, looking away cancels it). To leave without choosing, look well away from the box
  for about a second. Undo can still bring the drawing back.
- **Save Drawing** downloads a **PNG** of the canvas and a **JSON session** (the drawing, every setting, the agents and —
  in 16a — your InkGaze calibration). A copy stays in this browser (the last 12).
- **Open Drawing** shows your recent drawings (look at one to open it) and **Load a file…** for a session JSON. Browsers
  only open a file dialog after a click or a tap, so that button needs one.
- **Configuration** opens every setting (below).

### Configuration

Grouped in sections; every change is saved at once, for this variant only.

- **Language** — the app's language, load a language file, download a template.
- **Activation (the Midas touch)** — menu dwell (0.8 s), Clear dwell (1.2 s), exit grace (200 ms), target allowance
  (+50 % invisible hit area), **dwell on the canvas starts the line** (on / off) and its time, **dwell on the canvas stops
  the line** (off), **escape saccade stops the line** (on), **… and switches Draw mode off** (on), escape size (16a/16b)
  or head speed (16c), **long blink** starts / stops the line (16a, off), settle speed, dwell tolerance.
- **Cursor** — **show the cursor while drawing** (off), **show the cursor while paused** (on), cursor responsiveness.
- **Line** — line option, thickness, colour, pixels per degree (16a/16b), the 1€-filter settings of each line option.
- **Ink behaviour** — engorge, widest / thinnest speeds, drips, splats.
- **Agents (boids)** — presets; add, remove, randomise or reset agents; each agent's speed, spring, damping, mass and
  jitter; the template for new agents. Default: one agent.
- **Gaze amplification & assistive pan** (16a/16b) — amplification, edge-pan (off), comfort box, pan speed, canvas size.
- **Grid mode** — dot spacing, size, jitter padding.
- **VR** (16c) — stereo, head sensitivity, eye separation, lens distortion, field-of-view zoom, menu follow delay
  (350 ms) and time, menu height, inverted aim.
- **Eye tracker** (16a) — status, InkGaze settings, recentre, calibrate with 5 or 9 dots.
- **Settings** — reset to defaults, clear the saved settings, About, Help, the start screen.

### The cursor

As in the HTC Vive app, the cursor **hides while you draw** — a visible cursor invites the eyes to follow it and drift.
The ink shows where the pen is. While paused (Draw off, after an escape or a dwell stop) the cursor is a **dashed
light-grey circle**; when Draw is on and waiting for your dwell it has a small red centre dot. Both are switchable in
Configuration → Cursor.

### Languages

English (default) and **Portuguese** are included; choose on the welcome screen or in Configuration → Language. To
**add or correct** a language: Configuration → Language → *Download the current language (template)*, translate the
texts (keep the keys, the `{placeholders}` and the HTML tags), then *Load a language file…* — it stays in this browser.
Or add the file to `i18n/` and list it in `i18n/languages.json` so everyone gets it. The InkGaze window is in English.

### VR (16c)

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
`e` twice clear · `g` grid mode · `i` / `p` 3D view on / off (16a/16b) · `r` recentre the canvas (16c: the view) ·
`c` recentre the eye tracker (16a) · `f` full screen · `Esc` close (16a: otherwise the eye-tracker settings).
In 16b a click on the canvas starts / stops the line; clicks on the menu act at once.

### Privacy

The camera image never leaves the device (InkGaze runs the face model locally). Settings, calibrations and recent
drawings stay in this browser; files are only written when you press *Save Drawing*.

---

## For developers and researchers

### Run

No build step. Serve the folder (the hub folder works too) and open a page:

```bash
python3 -m http.server 8000
```

ES modules and the camera need `http://localhost` or `https://`; phones need `https://` (see `../serve-https.sh` in the
hub). 16c loads **three.js 0.160.0** from jsDelivr through an import map; 16a/16b load `lib/inkgaze.js` (InkGaze 2.1).

### Architecture

| File | Role |
|---|---|
| `js/main.js` | bootstrap: loads the language, then the 2D app (16a/16b) or the VR app (16c) |
| `js/core.js` | variants, design tokens, **defaults**, per-variant settings storage, maths, the 1€ filter, the agent (boid), the chime |
| `js/engine.js` | the shared drawing engine: Draw mode, line start / stop (dwell, escape, blink), the escape re-arm guard, 1€ smoothing per line option, agents in 60 Hz steps, real-ink expression, grid mode, menu dwell |
| `js/hud.js` | the 7-button menu: layout, hit-testing (hit areas grown by the target allowance, never overlapping), canvas rendering, submenus, the Clear / Open modals, the cursor |
| `js/surface.js` | the drawing surface (tiles; a ring that wraps for VR) with **cell-based undo** (128-px cells, 24 steps) and dirty rectangles |
| `js/ui.js` | DOM screens: gaze dwell for DOM elements (`GazeDom`), intro dots, gate, welcome screen, About, Help, Configuration, agents editor, language switcher, toasts |
| `js/app2d.js` | 16a/16b runtime: InkGaze input, amplification / pan, rendering, clicks, keys, 3D analysis view, sessions |
| `js/vr.js` | 16c runtime: three.js ring, following menu, 3D intro and welcome panels, head pose (sensors / WebXR / drag), stereo + normalised lens distortion, partial texture uploads |
| `js/sessions.js` | Save (PNG + JSON + IndexedDB copy) and Open |
| `js/i18n.js`, `i18n/*.json` | languages |
| `lib/inkgaze.js`, `lib/inkgaze.css` | InkGaze 2.1 (unchanged copy) |

### Input

**16a** creates `new InkGaze({ storageKey: 'inkwell16.inkgaze', escapeAmplitude })` and calls `init()`: InkGaze's own
dialog takes over (calibration or resume), and its status `tracking` hands the stage to the app. The app listens to
`data` (x, y, state, blinkMs → the cursor, the engine), `saccade` (`escape` → `engine.escape()`), `blink` (`long` →
`engine.blink()`, opt-in), `status` (gate messages, pause) and `quality` (recentre hint). Completed menu dwells call
`ig.learn(x, y)` at the target's centre, so the calibration improves where the menu is. During a saccade the pen target
is held for up to 100 ms, so an escape never leaves a streak.

**16b** runs InkGaze's **mouse source** (`source: 'mouse', ui: false, persist: false, smoothing: 0`): the pointer becomes
the gaze with the same states, saccades and escapes. **16c** reads the head direction (DeviceOrientation, WebXR pose or
drag) and computes the flick speed itself.

The engine's per-frame input: `{ now, dt, hudId, overHud, surf: {x, y}, gazeDegS, blinkMs, lost }`.

### Settings

`localStorage['inkwell16.<variant key>.settings']` = `{ schema: 1, version, savedAt, cfg }`, where `cfg` holds **only the
values that differ from the defaults** (so a better default in a later build reaches returning users). The agents are
stored as `cfg.agents`. The language is global: `localStorage['inkwell16.lang']`; loaded language files:
`inkwell16.lang.custom`. InkGaze keeps its calibration under `inkwell16.inkgaze`.

### Session file

`<variant key>_<timestamp>.json`:
`{ format: 'inkwell-session', schema: 1, build, version, variant, savedAt, settings, state: { lineMode, thickness, color,
gridMode, boids[] }, calibration (InkGaze exportCalibration(), 16a), drawing: { width, height, wrap, png }, credits }`.
Opening restores the settings (keeping hardware-specific ones when the variant differs), the agents, the drawing (fitted
to the canvas) and, in 16a, the calibration (`importCalibration`; a recentre is advised).

### Languages

`i18n/en.json` is the reference (every key); other files may be partial (missing keys fall back to English).
`i18n/languages.json` lists the bundled ones. Keys are nested; long texts are arrays of HTML paragraphs.
`t('toast.saved', { png, json })` fills `{placeholders}`. The funding statement is not translated (used verbatim).

### Tests and debugging

`window.inkwell` exposes the state. In a hidden tab (no `requestAnimationFrame`), drive frames on a virtual clock:

```js
inkwell.goStudio(); inkwell.testMode();          // 16a/16b: stop live input
inkwell.inject(300, 200); inkwell.step(60);      // one second of gaze at (300, 200)
inkwell.engine.S.penDown                          // → true after a dwell, with Draw mode on
// 16c
await inkwell.goStudio(); inkwell.look(20, 10); inkwell.step(60); inkwell.hudTarget('btn:draw');
```

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
| Agents | 1 | the pen has weight and inertia; more in Configuration |

## Status and limits

- **Tested:** 16b end to end and the 16c desktop preview (scripted input in a browser): dwell, menus, Clear modal,
  undo, escape, the re-arm guard, grid mode, languages, configuration, the ring, the seam, the following menu, stereo
  with and without lens distortion (no cropping), partial texture uploads.
- **Not yet tested on devices:** 16a with a real webcam session in Inkwell (InkGaze itself was tuned on two recordings);
  16c on a phone in a Cardboard viewer and on a WebXR headset.
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
  builds) and Anthropic Claude Opus 5.5 (the full code of Inkwell 16 and InkGaze.js).
- **InkGaze.js:** concept and design by Pedro Amado; development by Claude Opus 5.5 (October 2026).

On the welcome screen: *A prototype of the [SiX research project](https://six.fba.up.pt/) · PI Eliana Penedos and the SiX
team · Interface, expressive line and drawing agents by Pedro Amado · code written with Gemini and Claude.*

### AI development timeline (the whole web-prototype series)

| Builds | Period | Code written with |
|---|---|---|
| 0.1–0.9 and the WebGazer baselines | February – mid-May 2026 | Google Gemini 2.5 Pro and 3.1 Pro |
| 04–15 | May – August 2026 | Anthropic Claude Opus 4.8 and Claude Fable 5 |
| InkGaze.js 2 and Inkwell 16 | October 2026 | Anthropic Claude Opus 5.5 |

All directed by Pedro Amado. AI models are credited as tools: authorship stays with the people credited above.

### Authorship record

The concepts credited to Pedro Amado can be traced in the dated builds of the hub (`../SiX-EyeDraw-project.md` §4–§5, and
the catalogue `../index.html`): the drawing agent (boid) as the pen in build 05 (`boids-05/`, 17 May 2026); drips in build
07 and drips and splats as separate effects in build 08 (`single-inkwell-07/`, `full-demo-08/`, 18 May 2026); the
speed-dependent real-ink width at the latest in build 12 (`gaze-draw-12/`, 24 July 2026); the rigid / dynamic / fluid line
options from builds 11–12 (`webxr-eyegaze-11/`, `gaze-draw-12/`, July 2026).

### Third-party

three.js (MIT) · MediaPipe Tasks Vision (Apache-2.0, through InkGaze) · fonts: JetBrains Mono, Hanken Grotesk, Bricolage
Grotesque (Google Fonts, OFL).

**Funding.** This work is financed by national funds through the Portuguese funding agency, FCT — Fundação para a
Ciência e a Tecnologia, within the project «2023.11224.PEX» [DOI 10.54499/2023.11224.PEX].
