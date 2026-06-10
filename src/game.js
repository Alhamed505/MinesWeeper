/* ============================================================
 * game.js — rules engine and run state.
 *
 * Owns: game status, timer, scoring + combo, power inventory,
 * targeting modes, corruption effects, objectives, end-of-game
 * evaluation. Talks to the outside world only through `hooks`
 * callbacks supplied by main.js (which fan out to effects/ui),
 * so the rules stay testable and rendering-agnostic.
 * ============================================================ */
(function (RP) {
  'use strict';

  const { createRng, clamp } = RP.utils;

  const CONFIG = {
    rows: 12,
    cols: 12,
    mines: 20,
    powerCount: 2,
    corruptedCount: 4,
    comboWindow: 1.5,     // seconds between reveals to keep the combo
    scannerRange: 2,      // plus-shape radius
    heatmapJamSecs: 5,    // corruption: overlay outage duration
    corruptTimePenalty: 2 // corruption: seconds added
  };

  const POWER_TYPES = ['scanner', 'shield', 'defuser'];

  const POWER_INFO = {
    scanner: { name: 'Scanner Pulse', short: 'S' },
    shield: { name: 'Shield', short: '⛨' },
    defuser: { name: 'Defuser', short: 'D' }
  };

  /* ----------------------------------------------------------
   * Objective pool. Each run draws 2. `live` gives the HUD a
   * progress string; `check(game, finished)` decides completion
   * at game end (finish-gated objectives require `finished`).
   * -------------------------------------------------------- */
  const OBJECTIVE_POOL = [
    {
      id: 'scanner',
      label: 'Use Scanner Pulse at least once',
      needsPower: 'scanner',
      live: (g) => g.stats.scannerUses > 0 ? 'done' : '0/1',
      check: (g) => g.stats.scannerUses > 0
    },
    {
      id: 'corrupted3',
      label: 'Reveal 3 corrupted tiles',
      live: (g) => g.stats.corruptedRevealed >= 3 ? 'done'
        : Math.min(3, g.stats.corruptedRevealed) + '/3',
      check: (g) => g.stats.corruptedRevealed >= 3
    },
    {
      id: 'noWrongFlags',
      label: 'Finish with 0 wrong flags',
      live: () => 'checked at end',
      check: (g, finished) => finished && g.stats.wrongFlags === 0
    },
    {
      id: 'under180',
      label: 'Finish under 180 seconds',
      live: (g) => g.elapsed < 180 ? Math.floor(180 - g.elapsed) + 's left' : 'expired',
      check: (g, finished) => finished && g.elapsed < 180
    }
  ];

  class Game {
    /**
     * @param {object} hooks — presentation callbacks (all optional):
     *   onRevealBatch(tiles)             newly revealed cells (with depth)
     *   onFlag(r, c, flagged)
     *   onExplosion(r, c)
     *   onShieldBlock(r, c)
     *   onPowerCollected(type, r, c)
     *   onPowerUsed(type, info)
     *   onCorruption(effectId, r, c, payload)
     *   onTargeting(mode)                'scanner' | 'defuser' | null
     *   onGameEnd(result)
     *   onHud()                          any HUD-visible value changed
     *   onToast(message, tone)
     * @param {string} [seedText] — optional deterministic seed
     */
    constructor(hooks, seedText) {
      this.hooks = hooks || {};
      this.seedText = seedText || null;
      this.restart();
    }

    emit(name, ...args) {
      const fn = this.hooks[name];
      if (fn) fn(...args);
    }

    restart() {
      // A fixed seed reproduces the same board AND objective draw
      // every restart; otherwise each run gets a fresh random seed.
      this.rng = createRng(this.seedText || undefined);

      // Pick which 2 of the 3 power types spawn this run...
      this.powerTypes = this.rng.shuffle(POWER_TYPES.slice())
        .slice(0, CONFIG.powerCount);

      // ...then draw 2 objectives, never drawing an objective whose
      // power didn't spawn (e.g. "use Scanner" without a scanner).
      const pool = OBJECTIVE_POOL.filter((o) =>
        !o.needsPower || this.powerTypes.includes(o.needsPower));
      this.objectives = this.rng.shuffle(pool.slice()).slice(0, 2)
        .map((o) => ({ def: o, done: false }));

      this.board = new RP.Board({
        rows: CONFIG.rows,
        cols: CONFIG.cols,
        mines: CONFIG.mines,
        powerTypes: this.powerTypes,
        corruptedCount: CONFIG.corruptedCount,
        rng: this.rng
      });

      // 'ready' (pre first click) -> 'playing' -> 'won'|'cleared'|'lost'
      this.state = 'ready';
      this.elapsed = 0;
      this.targeting = null;       // 'scanner' | 'defuser' | null
      this.heatmapOn = false;
      this.heatmapJamUntil = -1;   // game-time when corruption jam ends

      this.inventory = { scanner: 0, shield: 0, defuser: 0 };

      this.score = {
        safeReveals: 0,    // count
        corrupted: 0,      // count
        safePts: 0,
        corruptedPts: 0,
        comboPts: 0,
        objectivePts: 0,
        timeBonus: 0
      };
      this.comboChain = 0;
      this.lastRevealAt = -Infinity;

      this.stats = {
        scannerUses: 0,
        corruptedRevealed: 0,
        defusedMines: 0,
        shieldBlocks: 0,
        wrongFlags: 0
      };

      this.explodedAt = null;
      this.result = null;
      this.emit('onTargeting', null);
      this.emit('onHud');
    }

    get isOver() { return this.state === 'won' || this.state === 'cleared' || this.state === 'lost'; }

    /** mines remaining indicator = current mine count - placed flags */
    minesRemaining() { return this.board.mineCount - this.board.flagCount(); }

    totalScore() {
      const s = this.score;
      return s.safePts + s.corruptedPts + s.comboPts + s.objectivePts + s.timeBonus;
    }

    heatmapVisible() {
      return this.heatmapOn && this.elapsed >= this.heatmapJamUntil;
    }

    heatmapJammed() {
      return this.heatmapOn && this.elapsed < this.heatmapJamUntil;
    }

    /** Called every frame by main.js with delta seconds. */
    tick(dt) {
      if (this.state === 'playing') this.elapsed += dt;
    }

    toggleHeatmap() {
      this.heatmapOn = !this.heatmapOn;
      this.emit('onHud');
    }

    /* ======================== input ======================== */

    /** Primary action (left click / tap). */
    reveal(r, c) {
      if (this.isOver) return;
      if (this.targeting) { this.handleTargetClick(r, c); return; }

      const cell = this.board.get(r, c);
      if (!cell || cell.revealed || cell.flagged) return;

      // Lazy generation = first click safety: mines are placed
      // only now, excluding this cell.
      if (!this.board.generated) {
        this.board.generateFor(r, c);
        this.state = 'playing';
      }

      if (cell.mine) {
        this.hitMine(cell);
        return;
      }

      const tiles = this.board.floodReveal(r, c);
      this.processReveals(tiles, true);
    }

    /** Secondary action (right click / long-press). */
    toggleFlag(r, c) {
      if (this.isOver) return;
      if (this.targeting) { this.cancelTargeting(); return; }
      const cell = this.board.get(r, c);
      if (!cell || cell.revealed) return;
      // Don't allow flag-spam before the board even exists.
      if (!this.board.generated) return;
      const flagged = this.board.toggleFlag(r, c);
      this.emit('onFlag', r, c, flagged);
      this.emit('onHud');
    }

    hitMine(cell) {
      this.comboChain = 0;
      this.lastRevealAt = -Infinity;

      if (this.inventory.shield > 0) {
        // Shield absorbs the hit: charge consumed, mine stays
        // unrevealed, play continues.
        this.inventory.shield--;
        this.stats.shieldBlocks++;
        // Mark the tile so the player can see which mine was blocked
        // (it stays unrevealed and still counts as a live mine).
        cell.shieldMarked = true;
        this.emit('onShieldBlock', cell.r, cell.c);
        this.emit('onToast', 'Shield absorbed the blast — mine still buried!', 'warn');
        this.emit('onHud');
        return;
      }

      cell.revealed = true;
      this.explodedAt = { r: cell.r, c: cell.c };
      this.state = 'lost';
      this.emit('onExplosion', cell.r, cell.c);
      this.finishGame(false);
    }

    /**
     * Shared post-reveal pipeline: scoring, combo, power pickup,
     * corruption triggers, win check.
     * @param {Array} tiles      newly revealed {r,c,depth}
     * @param {boolean} isAction true when caused by one player click
     *                           (combo counts player actions, not
     *                           every tile inside a flood).
     */
    processReveals(tiles, isAction) {
      if (!tiles.length) return;

      let safeCount = 0;
      let corruptedCount = 0;

      for (const pos of tiles) {
        const cell = this.board.get(pos.r, pos.c);

        if (cell.corrupted && !cell.corruptionSeen) {
          cell.corruptionSeen = true;
          corruptedCount++;
          this.stats.corruptedRevealed++;
          this.triggerCorruption(cell);
        } else {
          safeCount++;
        }

        if (cell.power && !cell.collected) {
          cell.collected = true;
          this.inventory[cell.power]++;
          this.emit('onPowerCollected', cell.power, cell.r, cell.c);
          this.emit('onToast',
            POWER_INFO[cell.power].name + ' acquired', 'good');
        }
      }

      this.score.safeReveals += safeCount;
      this.score.corrupted += corruptedCount;
      this.score.safePts += 10 * safeCount;
      this.score.corruptedPts += 25 * corruptedCount;

      // Combo: +5 per consecutive reveal ACTION within the window.
      // Resets on mine hit (see hitMine) or by simply falling
      // outside the window (covers the 2s-idle rule).
      if (isAction) {
        if (this.elapsed - this.lastRevealAt <= CONFIG.comboWindow) {
          this.comboChain++;
          this.score.comboPts += 5;
        } else {
          this.comboChain = 1;
        }
        this.lastRevealAt = this.elapsed;
      }

      this.emit('onRevealBatch', tiles);
      this.emit('onHud');

      if (this.board.isCleared()) this.finishGame(true);
    }

    /* ==================== corruption ==================== */

    triggerCorruption(cell) {
      // Random pick from the seeded stream so seeded runs replay
      // identically given the same click order.
      const roll = this.rng.int(3);
      if (roll === 0) {
        // a) Glitch swap — purely visual jitter on 6 random
        //    unrevealed tiles for ~400ms. No logic change.
        const hidden = [];
        this.board.eachCell((target) => {
          if (!target.revealed) hidden.push(target);
        });
        this.rng.shuffle(hidden);
        const victims = hidden.slice(0, 6).map((t) => ({ r: t.r, c: t.c }));
        this.emit('onCorruption', 'glitch', cell.r, cell.c, victims);
        this.emit('onToast', 'Corruption: grid signal glitched', 'bad');
      } else if (roll === 1) {
        // b) +2 seconds of temporal drag on the run clock.
        this.elapsed += CONFIG.corruptTimePenalty;
        this.emit('onCorruption', 'time', cell.r, cell.c, CONFIG.corruptTimePenalty);
        this.emit('onToast', 'Corruption: +' + CONFIG.corruptTimePenalty + 's temporal drag', 'bad');
      } else {
        // c) Heatmap sensors jammed for 5 seconds.
        this.heatmapJamUntil = this.elapsed + CONFIG.heatmapJamSecs;
        this.emit('onCorruption', 'jam', cell.r, cell.c, CONFIG.heatmapJamSecs);
        this.emit('onToast', 'Corruption: heatmap jammed for ' + CONFIG.heatmapJamSecs + 's', 'bad');
      }
      this.emit('onHud');
    }

    /* ====================== powers ====================== */

    /** HUD inventory button pressed. */
    activatePower(type) {
      if (this.isOver || this.state === 'ready') return;
      if (type === 'shield') {
        this.emit('onToast', 'Shield is passive — it auto-blocks one mine hit', 'info');
        return;
      }
      if (!this.inventory[type]) return;
      if (this.targeting === type) { this.cancelTargeting(); return; }
      this.targeting = type;
      this.emit('onTargeting', type);
      this.emit('onToast', type === 'scanner'
        ? 'Scanner armed: pick a REVEALED tile as the pulse center'
        : 'Defuser armed: pick a HIDDEN tile to probe', 'info');
    }

    cancelTargeting() {
      if (!this.targeting) return;
      this.targeting = null;
      this.emit('onTargeting', null);
    }

    handleTargetClick(r, c) {
      if (this.targeting === 'scanner') this.useScanner(r, c);
      else if (this.targeting === 'defuser') this.useDefuser(r, c);
    }

    /**
     * Scanner Pulse: plus shape centered on a chosen REVEALED tile,
     * range 2. Reveals only safe (non-mine) hidden tiles inside the
     * shape — mines and flags are untouched.
     */
    useScanner(r, c) {
      const center = this.board.get(r, c);
      if (!center || !center.revealed) {
        this.emit('onToast', 'Pulse center must be a revealed tile', 'warn');
        return;
      }
      this.inventory.scanner--;
      this.stats.scannerUses++;
      this.targeting = null;
      this.emit('onTargeting', null);

      const revealed = [];
      const shape = [{ r, c }];
      for (let d = 1; d <= CONFIG.scannerRange; d++) {
        shape.push({ r: r - d, c }, { r: r + d, c }, { r, c: c - d }, { r, c: c + d });
      }
      let depth = 0;
      for (const pos of shape) {
        const cell = this.board.get(pos.r, pos.c);
        if (!cell || cell.revealed || cell.flagged || cell.mine) continue;
        const tile = this.board.revealSingle(pos.r, pos.c);
        if (tile) { tile.depth = depth++; revealed.push(tile); }
      }

      this.emit('onPowerUsed', 'scanner', { center: { r, c }, shape, revealed });
      this.emit('onToast', revealed.length
        ? 'Scanner pulse revealed ' + revealed.length + ' tile' + (revealed.length > 1 ? 's' : '')
        : 'Scanner pulse found nothing new', 'good');
      // Scanner reveals are not a manual click — no combo credit.
      this.processReveals(revealed, false);
      this.emit('onHud');
    }

    /**
     * Defuser: probe one HIDDEN tile. A mine is neutralized into a
     * safe tile (numbers recalculated) and revealed; a non-mine just
     * burns the charge.
     */
    useDefuser(r, c) {
      const cell = this.board.get(r, c);
      if (!cell || cell.revealed || cell.flagged) {
        this.emit('onToast', 'Defuser needs a hidden, unflagged tile', 'warn');
        return;
      }
      this.inventory.defuser--;
      this.targeting = null;
      this.emit('onTargeting', null);

      if (cell.mine) {
        this.board.neutralizeMine(r, c);
        this.stats.defusedMines++;
        this.emit('onPowerUsed', 'defuser', { r, c, hit: true });
        this.emit('onToast', 'Mine neutralized — numbers recalibrated', 'good');
        // Now safe: reveal it through the normal pipeline (it may
        // flood if its recalculated number is 0).
        const tiles = this.board.floodReveal(r, c);
        this.processReveals(tiles, false);
      } else {
        this.emit('onPowerUsed', 'defuser', { r, c, hit: false });
        this.emit('onToast', 'No mine detected — defuser expended', 'warn');
      }
      this.emit('onHud');
      if (this.board.isCleared()) this.finishGame(true);
    }

    /* ==================== end of game ==================== */

    finishGame(cleared) {
      if (this.result) return; // already finished
      this.cancelTargeting();

      this.stats.wrongFlags = this.board.wrongFlagCount();

      // Objectives: progress-based ones (scanner, corrupted) count
      // even on a loss; "finish ..." ones require an actual clear.
      let completed = 0;
      for (const obj of this.objectives) {
        obj.done = obj.def.check(this, cleared);
        if (obj.done) completed++;
      }
      this.score.objectivePts = 50 * completed;
      this.score.timeBonus = cleared
        ? Math.max(0, 300 - Math.floor(this.elapsed))
        : 0;

      const allObjectives = completed === this.objectives.length;
      if (cleared) this.state = allObjectives ? 'won' : 'cleared';

      const total = this.totalScore();
      const isBest = (cleared) ? RP.storage.submitScore(total) : false;

      this.result = {
        state: this.state,
        cleared,
        allObjectives,
        total,
        isBest,
        best: RP.storage.getBestScore(),
        elapsed: this.elapsed,
        score: Object.assign({}, this.score),
        stats: Object.assign({}, this.stats),
        objectives: this.objectives.map((o) => ({
          label: o.def.label, done: o.done
        })),
        message: !cleared
          ? 'Reactor breach — containment failed'
          : (allObjectives
            ? 'Reactor stabilized — protocol complete'
            : 'Grid cleared — complete objectives to stabilize reactor')
      };
      this.emit('onHud');
      this.emit('onGameEnd', this.result);
    }
  }

  RP.Game = Game;
  RP.GameConfig = CONFIG;
  RP.PowerInfo = POWER_INFO;
})(window.RP = window.RP || {});
