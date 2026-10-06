# Inkwell — changelog

## 17.0.0 — 2026-10-06 · `inkwell-17` · 17d hand gestures

Build 17 is build 16.1 in four variants: **17a eye tracker**, **17b mouse cursor**, **17c cardboard** (the same code and
behaviour as 16a–16c, with the 16.1 Clear fix) and the new **17d hand gestures** — a mode for **caregivers and
able-bodied participants**, who draw in the same studio, with the same menu, using one hand in front of the webcam.

### 17d · hand gestures (new)
- **Input** (`js/hands.js`): MediaPipe **HandLandmarker** (Tasks Vision pinned to 0.10.35, as InkGaze: no usage
  telemetry; float16 hand model), VIDEO mode on every camera frame, up to two hands with the one in use kept, GPU with a
  CPU fallback, a warm-up inference while "Loading the hand model…" shows. The camera image never leaves the device.
- **The cursor is the index fingertip**, always (with one, two or three fingers up), mapped from a **reach box** in the
  mirrored camera view to the whole screen — the menu, the corners and the pan edges are reachable with the whole hand
  in view — and 1€-filtered.
- **Poses** (read from the 3D landmarks, so they hold at any hand angle and distance; hysteresis per finger; a pose
  counts after 120 ms): **index** → Draw mode on, **thin** line · **index + middle** → **medium** · **index + middle +
  ring** → **thick** (also while drawing) · **thumb out** ("L", with 1–3 fingers) → **1–5 agents with random settings**
  (always numerically stable), a new set each time the thumb comes out · **thumb back in** → the line pauses, the
  agents go, the pen is direct · **fist** → rest (Draw mode off) · **open hand waved** (left → right → left, two swings
  of ≥ 10 % of the view within 1.6 s) → **Clear Drawing?** (the confirmation still needs a point + dwell or a tap).
- **Pause to toggle:** holding the fingertip still (0.8 s) starts the line and, again, pauses it; on a button it
  presses it, as the eyes do. A **finger tap** (curl and straighten the pointing finger within ½ s) clicks the button
  under the cursor. Only a pointing hand presses or inks.
- **First screen:** *Start the camera* → the hand is found → **Calibrate reach** (trace a large rectangle in the air for
  5 s; the 2nd–98th percentiles of the fingertip become the box) or **Continue**. Key `c` recalibrates, `h` toggles the
  camera preview.
- **Camera preview** (top left): the hand (extended fingers in red), the reach box, five bars for how extended each
  finger reads, and the pose. A short label beside the cursor confirms each new pose ("Thick Line · 3 agents").
- **Configuration → Hand gestures:** camera status, Calibrate reach, Default reach, fingertip smoothing, pose hold,
  finger tap, wave size and time, camera preview. Amplification and the assistive pan are available in 17d too; the
  escape-saccade settings are hidden (no eyes). Defaults for 17d: dwell starts **and** stops the line, the cursor stays
  visible while drawing, no agents until the thumb comes out.

### All variants
- **The canvas dwell no longer re-fires in place:** after a dwell has started or stopped the line, the cursor must move
  two dwell radii before the next one counts (with dwell-start and dwell-stop both on, holding still toggled the line
  every 0.8 s).
- Build 17 keeps **its own settings** (`inkwell17.*` in the browser; sessions database `inkwell-17`), so builds 16 and 17
  can be compared side by side. Pages, titles, the PRD and all texts are renamed to 17; English and Portuguese texts for
  17d (About, Help with a gesture guide, Configuration).

## 16.1.0 — 2026-10-06 · Clear Drawing fix

**Clear Drawing could bring the studio to a halt.** Two causes, both fixed:

- **The undo copy of a Clear read the whole canvas back, cell by cell** (about 300 read-backs on a 5376 × 3360 canvas —
  a 1792 × 1120 window with the assistive pan on, at 2× pixel density). On GPU-backed canvases (Safari) each read-back
  stalls the page, so a Clear could freeze it for seconds. Clear and Open now keep a **copy of each tile made with
  drawImage** (no read-back), and only the newest such copy is kept (undo stops at the clear before it). In Chrome,
  whose canvases here are CPU-backed, Clear already took ~60 ms at that size and still does (~55 ms); the gain is on
  GPU-backed canvases, where every read-back stalls. VR uploads the cleared ring over a few frames instead of all at once.
- **The confirmation could trap the eyes.** Its buttons had no target allowance and the Clear dwell reset on the
  slightest exit, so with webcam gaze (± 2–4°) it rarely completed, and nothing but Esc closed it. Now the buttons get
  the menu's invisible allowance (never overlapping), the Clear dwell tolerates a 120-ms wobble (it still cancels when
  you look away), and **looking well away from the modal for 1.2 s dismisses it** (in VR: looking away from the menu).
- Safety: a failing step can no longer freeze the screen (input and drawing are guarded separately each frame), and a
  Clear that fails still blanks the paper.

## 16.0.0 — 2026-10-06 · `inkwell-16`

Build 16 continues *Gaze Draw 15* (`gaze-draw-15/`) under the name **Inkwell**, rewritten as ES modules and split into
three interaction / testing variants of one app: **16a eye tracker** (InkGaze.js), **16b mouse cursor**, **16c cardboard**.

### Input
- **16a runs on InkGaze.js 2.1** (the project's webcam eye tracker): the app's own calibration is removed. On opening,
  InkGaze takes over (settings → calibrate, or resume a saved calibration), then hands the stage back. The app listens
  to the gaze stream (`data`), escape saccades, long blinks, status and quality events; completed menu dwells teach the
  tracker (`learn()`) where the buttons are.
- **16b** drives the same app with the mouse through InkGaze's mouse source, so dwell, saccades and escapes behave as
  with the eyes.
- **16c** aims with the head: phone motion sensors (Cardboard), WebXR headsets, or a desktop look-around preview.

### Interface
- **The menu** (bottom, no cream band): seven buttons — **Line** (Rigid / Dynamic / Fluid Line), **Thickness** (Thin /
  Medium / Thick Line, 45° icons of three visibly different weights), **Colour** (Black, deep Red, navy Blue, and new
  **White**), the larger central **Press to Draw ▶ / Press to Pause ❚❚**, **Grid** (Freehand Mode, Grid Mode on /
  feedback / hidden), **Undo**, and **Options** (⋮). Labels and icons show the current choice.
- **Options:** **Clear Drawing** (confirmation modal, as in the HTC Vive app: Cancel / Clear; Clear needs 1.2 s and
  cancels on exit), **Save Drawing** (PNG + JSON session with the drawing, settings, agents and the InkGaze
  calibration; a copy kept in the browser), **Open Drawing** (recent drawings by gaze, or a JSON file by click),
  **Configuration**.
- **Removed:** the inkwell button, the ink reservoir, ink depletion and refill. A line lasts until it is stopped.
- **New first screens:** three intro dots (64 px, light grey; they grow when looked at, turn red and pop with a chime),
  then the **welcome screen** (*inkwell* in JetBrains Mono, **play**, and **About · Help · Configurations** with icons
  at text height). About tells the prototype's origin, purpose and credits; Help has a video placeholder and the full
  instructions.
- **Configuration modal** with everything from build 15 except the ink economy, regrouped: Language, Activation, Cursor,
  Line (incl. each line option's 1€ filter), Ink behaviour, Agents (CRUD + presets), Amplification & pan, Grid, VR,
  Eye tracker, Settings.
- **Languages:** English (default) and Portuguese; switch on the welcome screen or in Configuration. Languages are JSON
  files (`i18n/`); users can download a template and load new or corrected languages in the app.
- **Cursor (from the HTC Vive app):** hidden while drawing (a visible cursor makes the eyes drift after it); a dashed
  40 %-black circle while paused. Two toggles in Configuration → Cursor.

### Behaviour
- **Two-level activation kept** (Draw mode, then the line), with **visible toggles**: dwell on the canvas starts the line
  (on, 0.8 s), dwell on the canvas stops the line (**off**), the **escape saccade stops the line** (on) **and switches
  Draw mode off** (on, new default: "escape the drawing mode off"), long blink (16a, off).
- **Re-arm guard:** with Draw kept on after an escape, the escape's landing point cannot start the next line until the
  gaze moves on (no Midas touch where the eyes happened to land).
- **Grid dots** need the gaze to leave a dot before it can fire again (staring no longer toggles start / stop).
- **The pen is held during a saccade** (16a, ≤ 100 ms) so an escape never leaves a streak; eyes closed / brief dropouts
  freeze the pen.
- **Defaults from the research dossier:** menu dwell 0.8 s, exit grace 200 ms, +50 % target allowance, thickness in
  degrees (0.18° / 0.40° / 0.90°), 1€-filter presets per line option, **one agent** (CRUD for more).
- **Settings per variant** (`inkwell16.<variant>.settings`), stored as differences from the defaults.

### Engine
- Shared engine for the three variants; agents integrated in 60 Hz steps; real-ink expression (speed → width,
  engorge, drips, splats) scaled to pixels per degree; Rigid draws constant width.
- **Undo** stores the 128-px cells an action touches (24 steps, ≤ 192 MB) instead of 16 full-canvas snapshots; redo
  kept.

### VR (16c)
- **360° canvas:** a ring around the viewer (+40° … −35°) in 8 textures; only the changed rectangle is uploaded to the
  GPU each frame.
- **The menu follows the head:** after a turn it waits **350 ms**, then eases in and out (650 ms) to stay below the eyes
  (−26°); never while you look at it.
- **No more cropping in Cardboard view** (build 15's issue): the views are rebuilt on every resize and rotation, the eye
  separation is a real camera offset (no UV shift), and the optional lens distortion is normalised so the corners stay
  in view.
- 3D intro dots and welcome panel (with the language switcher); one tap selects, a double tap recentres; head flick =
  escape.

### Credits
- Restructured to put the [SiX](https://six.fba.up.pt/) project and its Principal Investigator first: a short credit on the
  welcome screen (2D and VR) and the full credits in About (English and Portuguese) and in the README, with the AI
  development timeline of the series. "SiX" links to six.fba.up.pt.

### Kept from build 15
Agents (boids) with presets and per-agent tuning · the 1€-filtered line options · gaze amplification and the assistive
edge-pan (off by default) · grid-assisted mode with its three visibility forks · the keyboard / Wiimote controller
layer · the 3D analysis view (`i` / `p`).
