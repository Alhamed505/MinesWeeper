/* ============================================================
 * game.js — rules engine and run state.
 *
 * Owns: game status, timer, scoring + combo, power inventory,
 * targeting modes, corruption effects, objectives, chord
 * reveals, the hint system, difficulty/size presets and
 * end-of-game evaluation. Talks to the outside world only
 * through `hooks` callbacks supplied by main.js, and emits all
 * user-facing text as i18n KEYS so the UI layer can render in
 * the active language.
 * ============================================================ */
(function (RP) {
  'use strict';

  const { createRng, clamp } = RP.utils;

  /* ----------------------------------------------------------
   * Mode presets: board size x difficulty.
   * Mine count = cell count x difficulty density (12x12 medium
   * lands on the classic 20). Specials scale down with board
   * area so a 3x3 isn't wall-to-wall pickups.
   * -------------------------------------------------------- */
  const SIZES = {
    '3': { rows: 3, cols: 3 },
    '6': { rows: 6, cols: 6 },
    '12': { rows: 12, cols: 12 }
  };

  const DIFFICULTIES = {
    easy: { density: 0.10 },
    medium: { density: 0.14 },
    hard: { density: 0.18 }
  };

  /** Resolve a sizeId + diffId pair into concrete board numbers. */
  function computeMode(sizeId, diffId) {
    const size = SIZES[sizeId] || SIZES['12'];
    const diff = DIFFICULTIES[diffId] || DIFFICULTIES.medium;
    const cells = size.rows * size.cols;
    const mines = clamp(Math.round(cells * diff.density), 1, cells - 5);
    const powerCount = cells >= 36 ? 2 : 1;
    const corruptedCount = cells >= 100 ? 4 : (cells >= 36 ? 2 : 1);
    return {
      rows: size.rows, cols: size.cols, mines, powerCount, corruptedCount,
      modeKey: size.cols + 'x' + size.rows + ':' + (DIFFICULTIES[diffId] ? diffId : 'medium')
    };
  }

  const TUNING = {
    comboWindow: 1.5,     // seconds between reveal actions to keep the combo
    scannerRange: 2,      // plus-shape radius
    heatmapJamSecs: 5,    // corruption: overlay outage duration
    corruptTimePenalty: 2,// corruption: seconds added
    hintsPerRun: 2
  };

  const POWER_TYPES = ['scanner', 'shield', 'defuser'];

  /* ----------------------------------------------------------
   * Objective pool. Each run draws 2 feasible ones. `live`
   * returns a token array the UI translates ([kind, ...args]);
   * `check(game, finished)` decides completion at game end.
   * -------------------------------------------------------- */
  const OBJECTIVE_POOL = [
    {
      id: 'scanner',
      labelKey: 'obj.scanner',
      feasible: (g) => g.powerTypes.includes('scanner'),
      live: (g) => g.stats.scannerUses > 0 ? ['done'] : ['frac', 0, 1],
      check: (g) => g.stats.scannerUses > 0
    },
    {
      id: 'corrupted3',
      labelKey: 'obj.corrupted3',
      feasible: (g) => g.mode.corruptedCount >= 3,
      live: (g) => g.stats.corruptedRevealed >= 3 ? ['done']
        : ['frac', Math.min(3, g.stats.corruptedRevealed), 3],
      check: (g) => g.stats.corruptedRevealed >= 3
    },
    {
      id: 'noWrongFlags',
      labelKey: 'obj.noWrongFlags',
      feasible: () => true,
      live: () => ['end'],
      check: (g, finished) => finished && g.stats.wrongFlags === 0
    },
    {
      id: 'under180',
      labelKey: 'obj.under180',
      feasible: () => true,
      live: (g) => g.elapsed < 180 ? ['timeleft', Math.floor(180 - g.elapsed)] : ['expired'],
      check: (g, finished) => finished && g.elapsed < 180
    }
  ];

  class Game {
    /**
     * @param {object} hooks — presentation callbacks (all optional):
     *   onRevealBatch(tiles, meta)        newly revealed cells (+ {chain})
     *   onFlag(r, c, flagged)
     *   onExplosion(r, c)
     *   onShieldBlock(r, c)
     *   onPowerCollected(type, r, c)
     *   onPowerUsed(type, info)
     *   onCorruption(effectId, r, c, payload)
     *   onHint(r, c)
     *   onTargeting(mode)
     *   onGameEnd(result)
     *   onHud()
     *   onToast(key, tone, params)        i18n key + substitutions
     * @param {string} [seedText] — optional deterministic seed
     */
    constructor(hooks, seedText) {
      this.hooks = hooks || {};
      this.seedText = seedText || null;
      this.playerName = '';
      this.settings = RP.storage.getSettings();
      this.restart();
    }

    emit(name, ...args) {
      const fn = this.hooks[name];
      if (fn) fn(...args);
    }

    /** Change board size / difficulty, then start a fresh run. */
    applySettings(settings) {
      this.settings = {
        sizeId: SIZES[settings.sizeId] ? settings.sizeId : '12',
        diffId: DIFFICULTIES[settings.diffId] ? settings.diffId : 'medium'
      };
      RP.storage.setSettings(this.settings);
      this.restart();
    }

    restart() {
      // A fixed seed reproduces the same board AND objective draw
      // every restart; otherwise each run gets a fresh random seed.
      this.rng = createRng(this.seedText || undefined);
      this.mode = computeMode(this.settings.sizeId, this.settings.diffId);

      // Pick which power types spawn this run...
      this.powerTypes = this.rng.shuffle(POWER_TYPES.slice())
        .slice(0, this.mode.powerCount);

      // ...then draw 2 objectives that are actually achievable in
      // this mode (e.g. no scanner objective without a scanner,
      // no "3 corrupted" on a board that only spawns 1).
      const pool = OBJECTIVE_POOL.filter((o) => o.feasible(this));
      this.objectives = this.rng.shuffle(pool.slice()).slice(0, 2)
        .map((o) => ({ def: o, done: false }));

      this.board = new RP.Board({
        rows: this.mode.rows,
        cols: this.mode.cols,
        mines: this.mode.mines,
        powerTypes: this.powerTypes,
        corruptedCount: this.mode.corruptedCount,
        rng: this.rng
      });

      // 'ready' (pre first click) -> 'playing' -> 'won'|'cleared'|'lost'
      this.state = 'ready';
      this.elapsed = 0;
      this.targeting = null;       // 'scanner' | 'defuser' | null
      this.heatmapOn = false;
      this.heatmapJamUntil = -1;
      this.hintsLeft = TUNING.hintsPerRun;

      this.inventory = { scanner: 0, shield: 0, defuser: 0 };

      this.score = {
        safeReveals: 0,
        corrupted: 0,
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
      if (!cell) return;

      // Chord: clicking a satisfied revealed number pops all of
      // its remaining unflagged neighbors at once.
      if (cell.revealed) {
        if (cell.adj > 0) this.chordReveal(cell);
        return;
      }
      if (cell.flagged) return;

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

    /**
     * Smart reveal (chording): if the number of flags around a
     * revealed numbered tile equals its number, reveal every other
     * hidden neighbor. Wrong flags make this explosive — exactly
     * like classic Minesweeper (shield still applies, once per
     * buried mine encountered).
     */
    chordReveal(cell) {
      if (!this.board.generated) return;
      let flags = 0;
      const hidden = [];
      for (const nb of this.board.neighborsOf(cell.r, cell.c)) {
        if (nb.flagged) flags++;
        else if (!nb.revealed) hidden.push(nb);
      }
      if (flags !== cell.adj || hidden.length === 0) return;

      const batch = [];
      for (const nb of hidden) {
        if (this.isOver) return;
        if (nb.mine) {
          if (batch.length) { this.processReveals(batch.splice(0), true); }
          this.hitMine(nb);
          if (this.isOver) return; // exploded mid-chord
        } else if (!nb.revealed) {
          for (const t of this.board.floodReveal(nb.r, nb.c)) batch.push(t);
        }
      }
      if (batch.length) this.processReveals(batch, true);
    }

    /** Secondary action (right click / long-press). */
    toggleFlag(r, c) {
      if (this.isOver) return;
      if (this.targeting) { this.cancelTargeting(); return; }
      const cell = this.board.get(r, c);
      if (!cell || cell.revealed) return;
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
        cell.shieldMarked = true;
        this.emit('onShieldBlock', cell.r, cell.c);
        this.emit('onToast', 'toast.shield', 'warn');
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
          this.emit('onToast', 'toast.got.' + cell.power, 'good');
        }
      }

      this.score.safeReveals += safeCount;
      this.score.corrupted += corruptedCount;
      this.score.safePts += 10 * safeCount;
      this.score.corruptedPts += 25 * corruptedCount;

      // Combo: +5 per consecutive reveal ACTION within the window.
      // Resets on mine hit (see hitMine) or by simply falling
      // outside the window (covers the idle rule).
      if (isAction) {
        if (this.elapsed - this.lastRevealAt <= TUNING.comboWindow) {
          this.comboChain++;
          this.score.comboPts += 5;
        } else {
          this.comboChain = 1;
        }
        this.lastRevealAt = this.elapsed;
      }

      this.emit('onRevealBatch', tiles, { chain: this.comboChain });
      this.emit('onHud');

      if (this.board.isCleared()) this.finishGame(true);
    }

    /* ==================== corruption ==================== */

    triggerCorruption(cell) {
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
        this.emit('onToast', 'toast.corrGlitch', 'bad');
      } else if (roll === 1) {
        // b) +2 seconds of temporal drag on the run clock.
        this.elapsed += TUNING.corruptTimePenalty;
        this.emit('onCorruption', 'time', cell.r, cell.c, TUNING.corruptTimePenalty);
        this.emit('onToast', 'toast.corrTime', 'bad', { s: TUNING.corruptTimePenalty });
      } else {
        // c) Heatmap sensors jammed for 5 seconds.
        this.heatmapJamUntil = this.elapsed + TUNING.heatmapJamSecs;
        this.emit('onCorruption', 'jam', cell.r, cell.c, TUNING.heatmapJamSecs);
        this.emit('onToast', 'toast.corrJam', 'bad', { s: TUNING.heatmapJamSecs });
      }
      this.emit('onHud');
    }

    /* ====================== hints ====================== */

    /**
     * Hint system (limited uses): finds a PROVABLY safe hidden
     * tile using only visible information — a revealed number
     * whose flag count already satisfies it makes all its other
     * hidden neighbors logically safe. The candidate is verified
     * against the real board (never marks a mine, even if the
     * player's flags are wrong) and pulse-marked, not revealed.
     * A use is only consumed when a tile is actually found.
     */
    useHint() {
      if (this.isOver || this.state !== 'playing' || this.hintsLeft <= 0) return;

      const candidates = [];
      this.board.eachCell((cell) => {
        if (!cell.revealed || cell.adj === 0) return;
        let flags = 0;
        const hidden = [];
        for (const nb of this.board.neighborsOf(cell.r, cell.c)) {
          if (nb.flagged) flags++;
          else if (!nb.revealed) hidden.push(nb);
        }
        if (flags >= cell.adj) {
          for (const nb of hidden) {
            if (!nb.mine && !nb.hintMark) candidates.push(nb);
          }
        }
      });

      if (!candidates.length) {
        this.emit('onToast', 'toast.hintNone', 'warn');
        return;
      }
      const pick = this.rng.pick(candidates);
      pick.hintMark = true;
      this.hintsLeft--;
      this.emit('onHint', pick.r, pick.c);
      this.emit('onToast', 'toast.hintSafe', 'good');
      this.emit('onHud');
    }

    /* ====================== powers ====================== */

    activatePower(type) {
      if (this.isOver || this.state === 'ready') return;
      if (type === 'shield') {
        this.emit('onToast', 'toast.shieldPassive', 'info');
        return;
      }
      if (!this.inventory[type]) return;
      if (this.targeting === type) { this.cancelTargeting(); return; }
      this.targeting = type;
      this.emit('onTargeting', type);
      this.emit('onToast', type === 'scanner' ? 'status.scanner' : 'status.defuser', 'info');
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
        this.emit('onToast', 'toast.scanCenter', 'warn');
        return;
      }
      this.inventory.scanner--;
      this.stats.scannerUses++;
      this.targeting = null;
      this.emit('onTargeting', null);

      const revealed = [];
      const shape = [{ r, c }];
      for (let d = 1; d <= TUNING.scannerRange; d++) {
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
      if (revealed.length) this.emit('onToast', 'toast.scanHit', 'good', { n: revealed.length });
      else this.emit('onToast', 'toast.scanMiss', 'info');
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
        this.emit('onToast', 'toast.defuserTarget', 'warn');
        return;
      }
      this.inventory.defuser--;
      this.targeting = null;
      this.emit('onTargeting', null);

      if (cell.mine) {
        this.board.neutralizeMine(r, c);
        this.stats.defusedMines++;
        this.emit('onPowerUsed', 'defuser', { r, c, hit: true });
        this.emit('onToast', 'toast.defused', 'good');
        // Now safe: reveal it through the normal pipeline (it may
        // flood if its recalculated number is 0).
        const tiles = this.board.floodReveal(r, c);
        this.processReveals(tiles, false);
      } else {
        this.emit('onPowerUsed', 'defuser', { r, c, hit: false });
        this.emit('onToast', 'toast.defuserMiss', 'warn');
      }
      this.emit('onHud');
      if (this.board.isCleared()) this.finishGame(true);
    }

    /* ==================== end of game ==================== */

    finishGame(cleared) {
      if (this.result) return;
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
      const records = cleared
        ? RP.storage.submitRun(this.mode.modeKey, total, this.elapsed)
        : { newScore: false, newTime: false };
      const best = RP.storage.getBest(this.mode.modeKey);

      this.result = {
        state: this.state,
        cleared,
        allObjectives,
        total,
        records,
        best,
        modeKey: this.mode.modeKey,
        elapsed: this.elapsed,
        score: Object.assign({}, this.score),
        stats: Object.assign({}, this.stats),
        objectives: this.objectives.map((o) => ({
          labelKey: o.def.labelKey, done: o.done
        })),
        messageKey: !cleared
          ? 'result.msg.lost'
          : (allObjectives ? 'result.msg.won' : 'result.msg.cleared')
      };
      this.emit('onHud');
      this.emit('onGameEnd', this.result);
    }
  }

  RP.Game = Game;
  RP.GameModes = { SIZES, DIFFICULTIES, computeMode, TUNING };
  RP.GameConfig = TUNING; // renderer uses scannerRange
})(window.RP = window.RP || {});
