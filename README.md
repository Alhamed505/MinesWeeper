# Minesweeper: Reactor Protocol (Level 2)

A modern canvas-rendered Minesweeper with collectible power tiles, corrupted
tiles, a heuristic probability heatmap, and run objectives — wrapped in a
reactor-control-room aesthetic. Zero dependencies, zero build step.

## How to run

Open `index.html` in any modern browser. That's it.

The code intentionally uses plain `<script>` tags on a single `RP` namespace
(instead of ES modules) so it works over `file://` — Chrome blocks module
imports there. If you prefer a local server:

```bash
# any static server works, e.g.
npx serve .
# or
python -m http.server 8000
```

**Deterministic boards:** append `?seed=anything` to the URL
(e.g. `index.html?seed=test42`). The same seed reproduces the same mine
layout (for the same first click), power types, and objective draw — handy
for testing and sharing runs.

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Reveal tile | Left click | Tap |
| Flag tile | Right click | Long-press (≥ 350 ms) |
| Toggle heatmap | `H` or HUD button | HUD button |
| Restart | `R` or HUD button | HUD button |
| Cancel power targeting | `Esc` or right-click | Tap HUD button again |
| Risk percentage | Hover (heatmap on) | Long-press (heatmap on)* |

\* On mobile with the heatmap on, a long-press flashes the tile's risk
tooltip *and* toggles the flag — flagging stays the primary gesture.

## Mechanics

### Core

- 12×12 grid, 20 mines. First click is always safe (mines are placed lazily
  on the first click, excluding the clicked cell).
- Zero tiles flood-reveal via an iterative BFS (no recursion), and the
  renderer uses each tile's BFS depth to stagger a ripple-wave animation.
- Classic clear = all non-mine tiles revealed. Full **win** also requires
  both objectives (below); otherwise you get
  *"Grid cleared — complete objectives to stabilize reactor"*.

### Power tiles (2 per board, collected by revealing them)

Two of these three types spawn each run, placed on zero-number cells when
possible:

- **Scanner Pulse (S)** — aim at any *revealed* tile; reveals the safe hidden
  tiles in a plus shape around it, range 2. Never reveals a mine.
- **Shield (⛨)** — passive charge. Clicking a mine consumes it; the mine does
  **not** explode and stays unrevealed (marked with a small emblem).
- **Defuser (D)** — aim at any *hidden* tile. If it's a mine, it's neutralized
  into a safe tile and all numbers are recalculated; otherwise the charge is
  wasted.

### Corrupted tiles (4 per board, never mines)

Revealing one is safe (+25 score) but triggers a random side effect:
a **visual glitch** jittering 6 random hidden tiles (~400 ms, cosmetic only),
**+2 seconds** added to the run clock, or a **5-second heatmap jam**.

### Probability heatmap (non-cheaty hint)

Toggled with `H`. For every revealed number `N` with `F` flagged and `U`
unknown neighbors, each unknown neighbor receives a risk contribution of
`(N − F) / U`; contributions from all adjacent numbers are summed and
clamped to `[0, 1]`. Tiles with no numbered neighbor show the global density
(remaining mines ÷ hidden tiles) instead of a misleading 0%. It's a
deliberately simple heuristic — it shows estimates, never "safe"/"mine"
verdicts, and can be wrong.

### Objectives (2 random per run)

- Use Scanner Pulse at least once *(only drawn if the scanner spawned)*
- Reveal 3 corrupted tiles
- Finish with 0 wrong flags
- Finish under 180 seconds

### Scoring

| Component | Points |
| --- | --- |
| Safe reveal | +10 each |
| Corrupted reveal | +25 each |
| Objective completed | +50 each |
| Time bonus (on clear) | `max(0, 300 − seconds)` |
| Combo | +5 per consecutive reveal click within 1.5 s (resets on mine hits / idling) |

Best score is persisted in `localStorage`.

## Project structure

```
index.html          markup, HUD, modals, inline icon sprite, script order
styles/styles.css   theme, HUD, modals, atmosphere layers
src/utils.js        seeded RNG (mulberry32), easing, shared helpers
src/storage.js      localStorage wrapper (best score, first-run help)
src/board.js        pure grid state: generation, BFS flood, heatmap heuristic
src/game.js         rules engine: timer, scoring, powers, corruption, objectives
src/renderer.js     canvas drawing: 2.5D tiles, glyphs, overlays, particles
src/effects.js      rAF-driven animation state: tweens, particles, shake, glitch
src/ui.js           DOM layer: HUD, toasts, tooltip, modals
assets/icons.svg    SVG icon sprite (mirrored inline in index.html for file://)
```

The layering is strict: `board.js` knows nothing about scoring or rendering;
`game.js` talks to presentation only through hook callbacks; `renderer.js` and
`ui.js` are read-only over game state. `main.js` wires it all together.

## Extensibility notes

- **Skins** — all canvas colors live in the `PAL` object at the top of
  `renderer.js` and mirror the CSS custom properties in `styles.css`. A theme
  switcher only needs to swap those two palettes. Tile geometry (rounding,
  gaps, bevels) is parameterized on `this.tile`, so resolution-independent
  skins are straightforward; sprite-based skins could replace the vector
  glyph functions (`drawMine`, `drawFlag`, …) one-for-one.
- **Sound** — the `hooks` object in `main.js` is a ready-made event bus:
  every interesting moment (`onRevealBatch`, `onExplosion`, `onPowerUsed`,
  `onCorruption`, …) already fires there. An `audio.js` module can subscribe
  alongside the effects calls without touching game logic.
- **Levels** — board size, mine count, special counts, scanner range, combo
  window and corruption penalties are all in the `CONFIG` object in
  `game.js`. A level select means swapping CONFIG presets; new power types
  slot into `POWER_TYPES`/`POWER_INFO` plus one `use*` method; new objectives
  are single entries in `OBJECTIVE_POOL` (each defines its own live-progress
  text and end-of-run check).
- **Determinism** — all randomness flows through the seeded RNG in
  `utils.js`, so replays/daily-challenge modes (same seed for everyone) come
  for free.
