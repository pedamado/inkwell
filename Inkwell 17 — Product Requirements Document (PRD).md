# Inkwell 17 — Product Requirements Document (PRD)

**Product:** Inkwell — gaze drawing studio and its hand-gesture variant (build 17, `inkwell-17`) · **Version:** 17.0.0 · **Date:** 2026-10-06
**Project:** SiX — *Drawing for Social Re-connectivity* (FCT 2023.11224.PEX, PI Eliana Penedos-Santiago) · [six.fba.up.pt](https://six.fba.up.pt/)
**A prototype of the [SiX](https://six.fba.up.pt/) research project**, PI Eliana Penedos-Santiago · **Interface, expressive line & drawing agents, prototype direction:** Pedro Amado (FBAUP / i2ADS) · **Code:** Claude Opus 5.5 (Anthropic) · full credits in the README
**Predecessors:** Inkwell 16.1 (`inkwell-16/`; 17a–17c are its variants renamed) · Gaze Draw 12–15 (`gaze-draw-12/` …
`gaze-draw-15/`; behaviour specs `GazeDraw12-Behaviours.md`, `GazeDraw13-Behaviours.md`, `Inkwell14-15-Behaviours.md`) ·
the hand-gesture build 10 (`hands-gestures-10/`) · **Companion:** InkGaze.js 2.1 (`lib/`).

---

## 1. Purpose and context

SiX studies drawing as a non-verbal language for people with partial to complete Locked-In Syndrome (LIS). The first
evaluation of the Unity prototype (7 able-bodied participants, May 2026) found a **correspondence threshold**: below a
level of agreement between intention and trace, gaze drawing collapses into pointing. Participants also asked for more
precise / alternative ways to start and stop lines than dwell-to-toggle (dossier §7.10).

Inkwell 16–17 is the web test bench for the **interaction design** of gaze drawing. It must:

1. Run on a **calibrated webcam eye tracker** (InkGaze.js) — the precondition for correspondence.
2. Keep the expressive line of builds 12–15 (agents, line options, real-ink expression) while **simplifying the
   interface** (no ink economy) and making activation **configurable per user** (dwell / escape / blink).
3. Offer the same behaviours with a **mouse** (fast tests) and with the **head in VR** (a 360° canvas), so ideas can be
   tried anywhere before they move to the main prototype (HTC Vive Focus Vision, Unity — team led by Eliana
   Penedos-Santiago, developed by Manuel Silva).
4. **(17)** Offer a **caregiver / able-bodied mode** — the same studio and menu, drawn with **one hand** through the
   webcam (17d) — so a carer or a pilot participant can draw in the same space as the person who draws with the eyes.

**Users.** People with LIS / ALS (eye-only), their carers and helpers (setup, keyboard / controller layer; **17d: drawing
with the hand**), the SiX researchers (configuration, sessions, comparisons), able-bodied participants in pilot studies.

**Non-goals (17.0).** Multi-user / collaborative drawing (researched for build 18: two browsers sharing one drawing — see
the research note `Inkwell-18-shared-drawing-research.md` in this folder); cloud storage; a vertical-only mode for
horizontal gaze palsy (InkGaze reports `axisX === false`, the app does not yet adapt); translating InkGaze's own window;
two-handed gestures.

---

## 2. Variants (R-V)

| ID | Requirement | Status |
|---|---|---|
| R-V1 | One app, four pages: `inkwell-17a-eyetracker`, `inkwell-17b-mouse-cursor`, `inkwell-17c-cardboard`, `inkwell-17d-hand-gestures`; a chooser `index.html` | done |
| R-V2 | **17a** uses InkGaze.js and its calibration; the app's own calibration is removed | done |
| R-V3 | On opening 17a, InkGaze takes over (calibrate, or continue with a saved calibration) and then returns to the app | done (`init()`; status `tracking` → intro) |
| R-V4 | **17b** reproduces 17a's behaviours with the mouse (dwell, escape) | done (InkGaze mouse source) |
| R-V5 | **17c**: head orientation as the cursor in a VR environment on a phone (Cardboard); WebXR headsets | done; device test pending |
| R-V6 | Settings persist **per variant**, separately from build 16 | done (`inkwell17.<key>.settings`) |
| R-V7 | Interaction settings adapted per input (mouse: tighter dwell tolerance; VR: lower ppd, larger tolerance, head-speed escape, smaller target allowance; hands: dwell starts and stops, visible drawing cursor, no escape, no agents until the thumb) | done (`VARIANT_DEFAULTS`) |
| R-V8 | **17d**: the 17a–17c studio and features, driven by one hand (right or left) through the webcam — §5.6 | done; real-hand test pending |

## 3. First screens (R-S)

| ID | Requirement | Status |
|---|---|---|
| R-S1 | Three dots, vertically centred, at the centres of the left third, the middle and the right third; light grey (≤ 40 % black) | done: 64 px, `#bdbab4` (≈ 26 % black) |
| R-S2 | Dot size 48–64 px chosen from research | 64 px: webcam gaze accuracy is ~2–4° (InkGaze), so the largest asked size; hit area ≥ 1.6° radius |
| R-S3 | Looked-at dot grows slightly; on dwell it turns red and pops with a short, smooth chime | done (scale 1.16; Web Audio bell, rising pitch) |
| R-S4 | After three pops: welcome screen with *inkwell* (JetBrains Mono, generous h1), a **play** CTA, and **About · Help · Configurations** with icons at text height | done |
| R-S5 | About: project, prototype origin and purpose, and the full credits — the SiX project, its PI and the team first; concept and interaction design (Eliana Penedos-Santiago, Andreia Pinto de Sousa, Manuel Silva, Pedro Amado); interface, expressive line and drawing agents (Pedro Amado); grid mode origin; input from the SiX VR app (Manuel Silva); the web prototype directed by Pedro Amado, code written with Gemini and Claude; InkGaze.js | done (approved wording, EN / PT; "SiX" links to six.fba.up.pt) |
| R-S5b | A short credit on the welcome screen (2D and VR): the SiX project and its PI first, then Pedro Amado, then the AI models | done |
| R-S6 | Help: a YouTube placeholder on top + full instructions | done (`HELP_VIDEO_ID` in `ui.js`) |
| R-S7 | Configurations as a modal | done (a layer, so the gaze cursor stays visible over it) |
| R-S8 | **Language switcher** on the welcome screen and in Configuration; English default, Portuguese added; users can add / correct languages | done (§9) |

## 4. The menu (R-M)

Seven round buttons at the bottom (three · a larger centre · three), labels below, no cream band. Hit areas are the
buttons grown by the **target allowance** (default +50 % area) but never beyond half the gap (no overlap).

| ID | Button | Values (label) | Icon |
|---|---|---|---|
| R-M1 | Line | Rigid Line · **Dynamic Line** · Fluid Line | a wave: flat / medium / lively |
| R-M2 | Thickness | Thin Line 0.18° · **Medium Line** 0.40° · Thick Line 0.90° | a 45° line of 3 visibly different weights |
| R-M3 | Colour | **Black Color** #191817 · Red Color #b8261a (deep, between the brand red and crimson) · Blue Color #1d3a6e (navy) · White Color #ffffff | a disc of the colour (white with an outline) |
| R-M4 | Draw (centre, larger) | **Press to Draw** ▶ · Press to Pause ❚❚ (red when on) | triangle / two bars |
| R-M5 | Grid | **Freehand Mode** · Grid Mode (on) · Grid Mode (feedback) · Grid Mode (hidden) | squiggle / dot lattices |
| R-M6 | Undo | Undo (repeatable; redo by key) | a curved arrow |
| R-M7 | Options | Options → Clear Drawing · Save Drawing · Open Drawing · Configuration | three vertical dots |

- Submenus pop up above their button; the current value is red. Looking far away (dwell) or at ✕ closes them.
- **Clear Drawing** opens a modal (Cancel / Clear). *Clear* needs **1.2 s** of dwell and is undoable. 16.1: the modal
  buttons get the target allowance (never overlapping); the Clear dwell tolerates a 120-ms wobble (excursions onto
  nothing or another target pause it, they do not steal it); looking well away from the modal for 1.5× the menu dwell
  dismisses it; the undo copy of a clear is a tile copy (no pixel read-back).
- **Save Drawing**: PNG + JSON session (§8); **Open Drawing**: recent sessions (gaze) + *Load a file…* (click / tap —
  browsers only open file dialogs on a user gesture).

## 5. Activation and drawing (R-A) — behaviour specification

### 5.1 Two levels ("arm, then act", dossier §7.10)
- **Draw mode** (macro): the centre button. Off = rest (pencil off the desk); on = armed.
- **The line** (micro), while Draw mode is on:

| Event | Default | Setting |
|---|---|---|
| Start: **canvas dwell** — the gaze settled (speed < `settleDegS`) within `dwellRadiusDeg` for `canvasDwellMs` | on, 0.8 s | `dwellStart`, `canvasDwellMs` |
| Start without dwell: as soon as the gaze settles (120 ms) | — | `dwellStart` off |
| Stop: **escape saccade** (17a/17b: InkGaze escape, ≥ 30 % of the diagonal within 200 ms; 17c: head flick > 160°/s; not in 17d) | on (17d: off) | `escapeStop`, `escapeAmplitude`, `escapeDegS` |
| … the escape also switches Draw mode off | **on** | `escapePauses` |
| Stop: canvas dwell (after the gaze has travelled 2 tolerance radii since the start) | off (17d: **on**) | `dwellStop` |
| Start / stop: a **long blink** (InkGaze `long`, ≥ 0.4 s) | off (17a only) | `blinkToggle` |
| Looking at the menu, losing the face / pointer, leaving the VR ring | lifts the pen | — |

- The escape acts **only while a line is being drawn** (the jump from the menu to the canvas after *Press to Draw* is
  also a large saccade).
- **Re-arm guard** (when `escapePauses` is off): the escape's landing point follows the gaze for 400 ms, then the canvas
  dwell is blocked until the gaze is > 3 tolerance radii away from it.
- **Saccade hold** (17a): while InkGaze reports a saccade, the pen target holds (≤ 100 ms) so an escape leaves no streak.
  VR: the target holds while the head moves faster than half the escape speed.
- **Eyes closed / dropouts** (`blinkMs > 0`): the pen freezes (nothing is laid).

### 5.2 Menu dwell
`menuDwellMs` 0.8 s; exit grace `graceMs` 200 ms (except the Clear confirm); a fired target must be left before it can
fire again; completed dwells call InkGaze `learn()` at the target centre (17a).

### 5.3 The pen
gaze → amplification and assistive pan (2D; off by default) → **1€ filter in degrees** with per-option presets (Rigid
0.4 Hz / β 0.05, Dynamic 1.2 / 0.5, Fluid 5.0 / 1.0; all editable) → **agents** (mass-spring-damper boids, 60 Hz
substeps; default **one**; CRUD, presets) or the direct pen (0 agents) → **real ink**: width from the speed between the
thickness range (min / nominal / max in degrees × px/°), engorge when still, drips and splats (Fluid / Dynamic); Rigid is
constant width.

### 5.4 Grid-assisted mode (build 14)
Lattice every `gridSpacingDeg` (3°), dots `gridDotDeg` (0.8°), hit padding `gridPadDeg` (0.2°). Dwell a dot to start, the
next dot to draw a segment (agents follow, or a straight segment with 0 agents); the last dot again or an escape stops.
**New:** a dot that has just fired needs the gaze to leave it (no start/stop toggling while staring). Visibility forks:
on / feedback (ease-in 150 ms, ease-out 450 ms) / hidden.

### 5.6 Hand gestures (R-H) — 17d, the caregiver mode
| ID | Requirement (Pedro Amado's specification, 6 Oct 2026) | Implementation |
|---|---|---|
| R-H1 | Draw with the right or the left hand, through the webcam | MediaPipe HandLandmarker 0.10.35 (pinned), VIDEO mode, up to two hands — the one in use is kept (nearest to where it was, else the larger) |
| R-H2 | **Index pointing**, the rest closed (fully or partly) → Draw mode on, **thinnest line** | pose `point1` (the other long fingers folded, the thumb in) → `setDrawMode(true)` on the pose's onset + `thin` |
| R-H3 | **Index + middle** → medium line; **index + middle + ring** → thick line | `point2` → `medium`, `point3` → `thick` (also mid-line) |
| R-H4 | **Direct mode**: the index fingertip is the drawing cursor whatever the finger count | landmark 8, always |
| R-H5 | The camera view maps to the screen so every element is reachable (the canvas, the pan edges, the menu); the gesture range maps best to the screen | a **reach box** (default x 0.18–0.82, y 0.12–0.66 of the mirrored view — high, so the wrist stays in view when the fingertip reaches the menu) → the full screen; **Calibrate reach**: a 5-s sweep, the 2nd–98th percentiles mapped 5 % inside the edges; 1€ filter on the fingertip |
| R-H6 | The gestures must be reliably recognised | 3D (world) landmarks: per-finger extension score (joint bend, straightness, tip beyond the middle joint) with hysteresis (0.62 / 0.40); thumb spread in palm lengths (0.80 / 0.64); a pose counts after 120 ms (thumb 180 ms); the camera preview shows the five scores live |
| R-H7 | **Pause to toggle**: a dwell starts and pauses the line; dwelling on interactive targets works as with the cursor and the eyes | `dwellStart` + `dwellStop` on for 17d (0.8 s); the menu, submenus, modals and DOM screens use the same dwell; a fired canvas dwell needs the fingertip to move 2 radii first |
| R-H8 | **Thumb out** ("L") with 1–3 fingers → agentic mode at the same thickness, **1–5 agents with random settings** | `randomOrchestra()`: n ∈ 1…5, parameters drawn inside the numerically stable region of the agent's integrator (b < 1.4, k < 0.6 (4 − 2b), k > 0.006) |
| R-H9 | **Thumb back in** → the line pauses, the agents disappear, direct mode | `penUp('thumb')` + 0 agents (Draw mode stays armed) |
| R-H10 | Each new thumb-out **re-randomises** the number and the settings of the agents | a new `randomOrchestra()` on every in → out change |
| R-H11 | **Open hand, palm to the camera, waved** with ≥ 2 direction changes (left → right → left) → the **Clear** modal; confirm by pointing + dwell or click | two swings ≥ `waveMinSwing` (10 % of the view) within `waveWindowMs` (1.6 s) → `openModal('clear')`; confirm by the 1.2-s dwell or a **finger tap** (curl + straighten ≤ 0.5 s = a click) |
| R-H12 | (added) Only a pointing hand presses or inks; a fist rests | `aiming()`; fist → `penUp`, Draw mode off, no agents |

### 5.5 The cursor (R-C) — from the HTC Vive app
| ID | Requirement | Default |
|---|---|---|
| R-C1 | While a line is drawn the cursor (a circle with a centre dot) is hidden, with the agents' markers and the amplification ghost | hidden (`cursorDrawing` off); **17d: shown** (a hand does not drift after its cursor) |
| R-C2 | Paused (Draw off, after an escape or a dwell stop): a **dashed 40 %-black circle** | shown (`cursorPaused` on) |
| R-C3 | Armed (Draw on, pen up): the dashed circle + a small red centre dot | follows R-C2 |
| R-C4 | The canvas-dwell progress arc shows whenever a dwell fills (feedback, not a cursor) | — |

## 6. Configuration (R-K)
Everything from build 15 except the ink economy, in sections: Language · Activation · Cursor · Line · Ink behaviour ·
Agents · Amplification & pan (17a/17b/17d) · Grid · VR (17c) · Eye tracker (17a) · **Hand gestures (17d)**: camera status,
Calibrate reach, Default reach, fingertip smoothing, pose hold, finger tap, wave size and time, camera preview ·
Settings (reset, clear saved, About, Help, start screen). The close button and the scroll arrows are gaze targets; the
controls are for a helper (mouse / keys).

## 7. VR (R-VR) — 17c
| ID | Requirement | Implementation |
|---|---|---|
| R-VR1 | Turn the head (yaw) to look around and draw on a full 360° canvas | ring radius 2.6 m, +40° … −35°, 12 px/° (15 texels/°), 8 tiles; the engine unwraps the seam |
| R-VR2 | The menu waits 350 ms, then follows the head yaw with ease-in-out, always below the eyes | `followDelayMs` 350, `followMs` 650, pitch −26°; no follow while the gaze is on the menu or a submenu / modal is open |
| R-VR3 | Fix build 15's Cardboard viewport cropping | rebuild on resize / orientation change; IPD as camera separation; distortion normalised (corners map to corners); verified: no black corners at k = 0.25 |
| R-VR4 | VR environment on a phone | DeviceOrientation (iOS permission), full screen + landscape lock, stereo in landscape, mono in portrait |
| R-VR5 | Same activation rules with the head | head flick escape, settle speed in °/s, 3D intro dots (3.2°), 3D welcome panel, one tap = select, double tap = recentre |
| R-VR6 | Performance on phones | dirty-rectangle texture uploads (texSubImage2D), menu texture redrawn only on change |

## 8. Data (R-D)
- **Settings:** per variant, only differences from the defaults; agents included; the language is global.
- **Session JSON:** `format: 'inkwell-session'`, schema 1 — settings (17d: the reach), selections, agents, InkGaze
  calibration (17a), the drawing as a PNG data URL, credits. Opening adapts hardware-specific settings across variants
  and fits the drawing.
- **Recent sessions:** IndexedDB `inkwell-17` (12 per variant) with thumbnails.
- **Privacy:** nothing leaves the device; video stays in InkGaze (17a) or in the hand tracker (17d, MediaPipe pinned to
  0.10.35: no usage telemetry); files only on *Save Drawing*.

## 9. Localisation (R-L)
- `i18n/en.json` (reference, every key), `i18n/pt.json` (European Portuguese, to be reviewed), `i18n/languages.json`.
- `t(key, vars)`; missing keys fall back to English; long texts are arrays of HTML paragraphs.
- Users add / correct languages in the app (download the template, load a file — kept in the browser) or in the folder.
- Canvas texts (menu, modals, VR panels) shrink to fit longer translations; the funding statement stays verbatim.

## 10. Non-functional
- No build step; static files; ES modules; works from `http://localhost` / `https://`.
- Undo memory proportional to the area drawn (128-px cells, 24 steps, ≤ 192 MB).
- Keyboard / controller layer (build 15) for helpers; focus outlines; reduced motion respected for UI animations.

## 11. Validation (16.0.0 and 16.1 rows: build 16, whose code 17a–17c share)
| Check | Result |
|---|---|
| 16b: gate → dots → welcome → studio by dwell; dwell Draw; canvas dwell start; drawing; escape → rest | pass (browser, scripted pointer and injected gaze) |
| Re-arm guard, Clear modal (1.2 s, cancel on exit), Undo restores, grid segments + leave rule | pass |
| Languages: EN ↔ PT on every screen, Configuration re-render, a partial custom language with English fallback, template export | pass |
| Cursor: hidden while drawing (no agent markers), dashed when paused | pass |
| 16c preview: dots → welcome panel → studio; head dwell on the menu; drawing on the ring and across the 0°/360° seam; head flick → escape; the menu follows after 350 ms with easing; grid in VR; stereo with / without distortion, no cropping | pass (desktop preview; pixel checks) |
| 16.1: Clear on a 5376 × 3360 canvas (55 ms), undo / redo of a clear, Open (loadImage) undo, two clears keep one copy; modal allowance, wobble-tolerant confirm, look-away dismissal, menu dwell unchanged (0.8 s); VR clear 16 ms with spread uploads | pass |
| **17.0.0** — 17a–17c: the 16.1 pages renamed; load, gate, studio, Clear (17b) and undo; own storage keys (`inkwell17.*`) | pass (browser) |
| 17d classifier: 11 poses (point 1/2/3, with and without the thumb, fist, palm, other, a half-closed fist, the index pointing at the camera) × 4 hand angles on synthetic 3D hands | pass (44 / 44) |
| 17d app, scripted hand frames: pointing → Draw + thin; 2 / 3 fingers → medium / thick mid-line; dwell start / pause, no re-toggle while still; thumb → 1–5 agents inking, a new set each time; thumb in → pause + direct; fist → rest; slow open-hand move → no wave; wave → Clear, confirmed by dwell; tap on Cancel and on a menu button; dwell on a submenu option; gate states; the reach sweep (box saved); Configuration | pass |
| 17d agents: 6 000 random agents chasing a jumping, then circling target | pass (0 unstable) |
| 17d model: HandLandmarker 0.10.35 loads (GPU) and runs at 6–9 ms a frame after the warm-up (first inference ≈ 6 s, during "Loading the hand model…") | pass (browser, no camera) |
| 17a with a real webcam; 17c on a phone / headset; **17d with a real hand** (thresholds) | **pending** |

## 12. Open questions / next
- **17d with real hands:** tune `THRESH` (finger extension, thumb spread) from the preview's bars; decide whether "palm to
  the camera" must be checked (handedness) for the wave; the default reach box for a seated carer.
- **Build 18:** two browsers sharing one drawing (a carer in 17d and a person in 17a, side by side) — see
  `Inkwell-18-shared-drawing-research.md`.
- Validate 17a end to end with participants (S3b) and compare dwell-start vs settle-start, escape-to-rest vs keep-armed.
- Phone performance of the ring; Cardboard lens presets per viewer model.
- A vertical-only mode when InkGaze reports no usable horizontal eye movement.
- Translate InkGaze's window; review the Portuguese texts.
- Replace the logo text with the animated mark; add the tutorial video id.

## Sources
Research & Practice Dossier (Project Prototype Knowledgebase, rev. 7, §7.7–§7.10). Casiez, Roussel & Vogel (2012), 1€
Filter, CHI, [10.1145/2207676.2208639](https://doi.org/10.1145/2207676.2208639). Møllenbach, Lillholm, Gail & Hansen
(2010), single gaze gestures, ETRA, [10.1145/1743666.1743710](https://doi.org/10.1145/1743666.1743710). Drewes &
Schmidt (2007), gaze gestures, INTERACT, [10.1007/978-3-540-74800-7_43](https://doi.org/10.1007/978-3-540-74800-7_43).

**Funding.** This work is financed by national funds through the Portuguese funding agency, FCT — Fundação para a
Ciência e a Tecnologia, within the project «2023.11224.PEX» [DOI 10.54499/2023.11224.PEX].
