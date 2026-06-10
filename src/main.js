/* ============================================================
 * main.js — bootstrap and glue.
 *
 * Builds Game/Effects/Renderer/UI, fans game hooks out to the
 * presentation layers, owns the requestAnimationFrame loop and
 * translates raw input (mouse / touch / keyboard) into game
 * actions. Long-press (>= 350ms) is the mobile flag gesture.
 * ============================================================ */
(function (RP) {
  'use strict';

  const LONG_PRESS_MS = 350;
  const TOUCH_MOVE_CANCEL_PX = 12;

  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('board');
    const boardWrap = document.getElementById('board-wrap');

    // Optional deterministic seed: index.html?seed=anything
    const seedText = new URLSearchParams(window.location.search).get('seed');

    const effects = new RP.Effects();
    let game, renderer, ui;

    /* ---------------- game -> presentation hooks ---------------- */

    const hooks = {
      onRevealBatch(tiles) {
        effects.revealBatch(tiles);
      },
      onFlag(r, c, flagged) {
        if (flagged) effects.flagBounce(r, c);
      },
      onExplosion(r, c) {
        effects.explode(r, c);
      },
      onShieldBlock(r, c) {
        effects.shieldBlock(r, c);
      },
      onPowerCollected(type, r, c) {
        const colors = { scanner: '#4fd8ff', shield: '#2ee6d6', defuser: '#69e08b' };
        effects.pulseRing(r, c, colors[type] || '#2ee6d6', 0);
      },
      onPowerUsed(type, info) {
        if (type === 'scanner') {
          // neon pulse sweeping out from the center across the plus shape
          effects.pulseRing(info.center.r, info.center.c, '#4fd8ff', 0);
          info.shape.forEach((pos, i) => {
            if (game.board.inBounds(pos.r, pos.c)) {
              effects.pulseRing(pos.r, pos.c, '#4fd8ff', 40 + i * 28);
            }
          });
        } else if (type === 'defuser') {
          effects.pulseRing(info.r, info.c, info.hit ? '#69e08b' : '#ffb02e', 0);
          if (info.hit) {
            effects.spawnParticles(info.r, info.c, {
              count: 14, speed: 2.5, life: 700, size: 0.06,
              color: '#69e08b', grav: 2
            });
          }
        }
      },
      onCorruption(effectId, r, c, payload) {
        effects.pulseRing(r, c, '#ff4fd8', 0);
        if (effectId === 'glitch') effects.glitch(payload, 400);
      },
      onTargeting(mode) {
        document.body.classList.toggle('is-targeting', !!mode);
        if (ui) ui.updateHUD(game);
      },
      onGameEnd(result) {
        // let the explosion / final ripple play before the modal
        const delay = result.cleared ? 700 : 1100;
        setTimeout(() => ui.showResults(result), delay);
      },
      onHud() {
        if (ui) ui.updateHUD(game);
      },
      onToast(message, tone) {
        if (ui) ui.toast(message, tone);
      }
    };

    game = new RP.Game(hooks, seedText);
    renderer = new RP.Renderer(canvas, game, effects);
    ui = new RP.UI({
      onRestart: restart,
      onTogglePower: (type) => game.activatePower(type),
      onToggleHeatmap: () => game.toggleHeatmap()
    });

    function restart() {
      game.restart();
      effects.reset();
      ui.hideProbTip();
      ui.updateHUD(game);
    }

    /* ---------------------- main loop ---------------------- */

    let lastT = 0;
    let lastWholeSecond = -1;
    function frame(t) {
      const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
      lastT = t;

      game.tick(dt);
      effects.update(t);
      renderer.render();
      ui.updateTimer(game);

      // once a second: refresh objective countdowns / jam status
      const whole = Math.floor(game.elapsed);
      if (whole !== lastWholeSecond) {
        lastWholeSecond = whole;
        if (game.state === 'playing') ui.updateHUD(game);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    /* ---------------------- mouse input ---------------------- */

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
      const pos = renderer.tileAt(e.clientX, e.clientY);
      if (!pos) return;
      if (e.button === 0) game.reveal(pos.r, pos.c);
      else if (e.button === 2) game.toggleFlag(pos.r, pos.c);
    });

    canvas.addEventListener('mousemove', (e) => {
      const pos = renderer.tileAt(e.clientX, e.clientY);
      renderer.hover = pos;
      updateProbTip(pos);
    });

    canvas.addEventListener('mouseleave', () => {
      renderer.hover = null;
      ui.hideProbTip();
    });

    /** Desktop hover tooltip: percent label on hidden tiles when the
     *  heatmap overlay is visible. */
    function updateProbTip(pos) {
      if (!pos || !game.heatmapVisible() || game.isOver) { ui.hideProbTip(); return; }
      const cell = game.board.get(pos.r, pos.c);
      if (!cell || cell.revealed || cell.flagged) { ui.hideProbTip(); return; }
      const p = renderer.heatAt(pos.r, pos.c);
      if (p === null || p === undefined) { ui.hideProbTip(); return; }
      const center = renderer.tileCenter(pos.r, pos.c);
      ui.showProbTip(
        canvas.offsetLeft + center.x,
        canvas.offsetTop + center.y - renderer.tile * 0.75,
        Math.round(p * 100)
      );
    }

    /* ---------------------- touch input ---------------------- */
    // Tap = reveal. Long-press (>= 350ms, little movement) = flag;
    // while the heatmap is on, the long-press also flashes the
    // tile's risk tooltip (the "tap-hold tooltip" on mobile).

    let touch = null; // {x, y, pos, timer, longPressed}

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { cancelTouch(); return; }
      const t = e.touches[0];
      const pos = renderer.tileAt(t.clientX, t.clientY);
      if (!pos) return;
      e.preventDefault();
      touch = {
        x: t.clientX, y: t.clientY, pos, longPressed: false,
        timer: setTimeout(() => {
          touch.longPressed = true;
          // surface the probability before the flag hides it
          if (game.heatmapVisible()) {
            const cell = game.board.get(pos.r, pos.c);
            const p = renderer.heatAt(pos.r, pos.c);
            if (cell && !cell.revealed && !cell.flagged && p !== null) {
              const center = renderer.tileCenter(pos.r, pos.c);
              ui.showProbTip(
                canvas.offsetLeft + center.x,
                canvas.offsetTop + center.y - renderer.tile * 0.75,
                Math.round(p * 100)
              );
              setTimeout(() => ui.hideProbTip(), 1400);
            }
          }
          game.toggleFlag(pos.r, pos.c);
          if (navigator.vibrate) navigator.vibrate(30);
        }, LONG_PRESS_MS)
      };
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (!touch) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > TOUCH_MOVE_CANCEL_PX) {
        cancelTouch();
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (!touch) return;
      e.preventDefault();
      clearTimeout(touch.timer);
      if (!touch.longPressed) game.reveal(touch.pos.r, touch.pos.c);
      touch = null;
    }, { passive: false });

    canvas.addEventListener('touchcancel', cancelTouch);

    function cancelTouch() {
      if (touch) { clearTimeout(touch.timer); touch = null; }
    }

    /* ---------------------- keyboard ---------------------- */

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (key === 'h') game.toggleHeatmap();
      else if (key === 'r') restart();
      else if (key === 'escape') {
        game.cancelTargeting();
        document.querySelectorAll('.modal.open')
          .forEach((m) => m.classList.remove('open'));
      }
    });

    /* ---------------------- resize ---------------------- */

    let resizeRaf = 0;
    function onResize() {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => renderer.resize());
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    /* ---------------------- first run ---------------------- */

    // Exposed for debugging and for add-on modules (e.g. an audio
    // layer can read state here without touching game internals).
    RP.runtime = { game, renderer, effects, ui };

    ui.updateHUD(game);
    if (!RP.storage.hasSeenHelp()) {
      ui.showHelp();
      RP.storage.markHelpSeen();
    }
    if (seedText) {
      ui.toast('Deterministic seed active: "' + seedText + '"', 'info');
    }
  });
})(window.RP = window.RP || {});
