# MinesWeeper — Reactor Protocol (Level 2)

A modern canvas-rendered Minesweeper with collectible power tiles, corrupted
tiles, a heuristic probability heatmap, run objectives, fully synthesized
sound design and a bilingual (English / العربية) interface — wrapped in a
reactor-control-room aesthetic. Zero dependencies, zero build step, zero
binary assets.

**Play online:** https://alhamed505.github.io/MinesWeeper/

## How to run locally

Open `index.html` in any modern browser. That's it.

The code intentionally uses plain `<script>` tags on a single `RP` namespace
(instead of ES modules) so it works over `file://` — Chrome blocks module
imports there. If you prefer a local server:

```bash
npx serve .          # or: python -m http.server 8000
```

**Deterministic boards:** append `?seed=anything` to the URL
(e.g. `index.html?seed=test42`). The same seed reproduces the same mine
layout (for the same first click), power types, and objective draw.

## Mission setup

Every session starts at the **Mission Setup** screen:

- **Operator name** — required; shown in the HUD during play.
- **Grid size** — 3×3, 6×6 or 12×12; the board and canvas scale dynamically.
- **Difficulty** — Easy / Medium / Hard (mine density 10% / 14% / 18%;
  12×12 Medium is the classic 20-mine board). Power and corrupted tile
  counts scale with board area.
- **Language** — English or Arabic. Arabic flips the whole UI to RTL with a
  proper Arabic font (Tajawal) and translates every label, toast, objective,
  result and the briefing.

All choices persist in `localStorage`.

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Reveal tile | Left click | Tap |
| Chord (smart reveal) | Left click a satisfied number | Tap it |
| Flag tile | Right click | Long-press (≥ 350 ms) |
| Toggle heatmap | `H` or HUD button | HUD button |
| Hint (2 per run) | `N` or HUD button | HUD button |
| Mute / unmute | `M` or HUD button | HUD button |
| Restart same mode | `R` or HUD button | HUD button |
| New game (setup) | Gear button | Gear button |
| Cancel power targeting | `Esc` or right-click | Tap HUD button again |
| Risk percentage | Hover (heatmap on) | Long-press (heatmap on)* |

\* On mobile with the heatmap on, a long-press flashes the tile's risk
tooltip *and* toggles the flag — flagging stays the primary gesture.

## Mechanics

### Core

- First click is always safe (mines are placed lazily on the first click,
  excluding the clicked cell).
- Zero tiles flood-reveal via an iterative BFS (no recursion); the renderer
  uses each tile's BFS depth to stagger a ripple-wave animation.
- **Chording:** clicking a revealed number whose surrounding flags equal it
  reveals all its remaining neighbors at once — wrong flags make this
  explosive, exactly like the classic game.
- Classic clear = all non-mine tiles revealed. Full **win** also requires
  both objectives; otherwise: *"Grid cleared — complete objectives to
  stabilize reactor"*.

### Power tiles (collected by revealing them)

- **Scanner Pulse (S)** — aim at any *revealed* tile; reveals the safe hidden
  tiles in a plus shape around it, range 2. Never reveals a mine.
- **Shield (⛨)** — passive charge. Clicking a mine consumes it; the mine does
  **not** explode and stays unrevealed (marked with a small emblem).
- **Defuser (D)** — aim at any *hidden* tile. If it's a mine, it's neutralized
  into a safe tile and all numbers are recalculated; otherwise the charge is
  wasted.

### Corrupted tiles (never mines)

Revealing one is safe (+25 score) but triggers a random side effect:
a **visual glitch** jittering 6 random hidden tiles (~400 ms, cosmetic only),
**+2 seconds** added to the run clock, or a **5-second heatmap jam**.

### Probability heatmap (non-cheaty hint)

For every revealed number `N` with `F` flagged and `U` unknown neighbors,
each unknown neighbor receives a risk contribution of `(N − F) / U`;
contributions are summed and clamped to `[0, 1]`. Tiles with no numbered
neighbor show the global density instead of a misleading 0%. It shows
estimates, never "safe"/"mine" verdicts.

### Hint system (2 per run)

A hint finds a **provably safe** tile — one next to a revealed number whose
flag count already satisfies it — and pulse-marks it with a dashed green
halo (it does not auto-reveal). If no tile is currently provable, the hint
is **not** consumed.

### Objectives (2 per run, always feasible for the chosen mode)

Use Scanner Pulse · Reveal 3 corrupted tiles · 0 wrong flags · Under 180s.

### Scoring & records

+10 per safe reveal · +25 per corrupted · +50 per objective ·
time bonus `max(0, 300 − seconds)` · +5 combo per consecutive reveal click
within 1.5 s. **Best score and best time are tracked per mode**
(size × difficulty) in `localStorage`.

## Sound design

All audio is synthesized live with WebAudio — no sound files. UI ticks,
rising reveal blips (pitch follows your combo), flag up/down chirps,
dissonant detuned-saw corruption, per-power timbres (sonar sweep, metallic
shield clang, defuser resolve chime), and layered explosions (sub-bass drop +
filtered blast + randomized debris crackle, three variants) so no two blasts
sound alike. Win/clear/loss each get a short jingle. Toggle with `M`.

## Project structure

```
index.html          markup, HUD, modals, inline icon sprite, script order
styles/styles.css   theme, HUD, modals, setup screen, RTL/Arabic rules
src/utils.js        seeded RNG (mulberry32), easing, shared helpers
src/storage.js      localStorage: profile, language, sound, per-mode records
src/i18n.js         EN/AR dictionaries, t(), RTL switching
src/audio.js        WebAudio synth engine (all SFX, no assets)
src/board.js        pure grid state: generation, BFS flood, heatmap heuristic
src/game.js         rules engine: modes, scoring, powers, chord, hints, objectives
src/renderer.js     canvas drawing: 2.5D tiles, glyphs, overlays, particles
src/effects.js      rAF-driven animation state: tweens, particles, shake, glitch
src/ui.js           DOM layer: HUD, setup/help/results modals, toasts, tooltip
assets/icons.svg    SVG icon sprite (mirrored inline in index.html for file://)
```

The layering is strict: `board.js` knows nothing about scoring or rendering;
`game.js` talks to presentation only through hook callbacks and emits all
text as i18n keys; `renderer.js`, `ui.js` and `audio.js` are read-only over
game state. `main.js` wires it all together.

## Extensibility notes

- **Skins** — canvas colors live in `PAL` (renderer.js) and mirror the CSS
  custom properties; swap both for a theme switcher.
- **Languages** — add a dictionary to `DICTS` in `i18n.js` and a button in
  the setup modal; everything else is key-driven.
- **Sound** — `audio.js` methods map 1:1 to game hooks in `main.js`; swap
  synthesis for samples without touching game logic.
- **Levels / modes** — sizes and densities live in `SIZES` / `DIFFICULTIES`
  (game.js); new powers slot into `POWER_TYPES` + one `use*` method; new
  objectives are single `OBJECTIVE_POOL` entries with their own feasibility,
  live-progress and end-check functions.
- **Determinism** — all randomness flows through the seeded RNG, so
  daily-challenge modes (same seed for everyone) come for free.
