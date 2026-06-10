/* ============================================================
 * board.js — pure grid state: mines, numbers, specials,
 * flood fill, and the probability heatmap heuristic.
 *
 * The Board knows nothing about scoring, timers, rendering or
 * input — that lives in game.js / renderer.js.
 * ============================================================ */
(function (RP) {
  'use strict';

  const { NEIGHBOR_OFFSETS, clamp } = RP.utils;

  class Board {
    /**
     * @param {object} opts
     *   rows, cols      — grid dimensions (12x12 for Level 2)
     *   mines           — mine count (20)
     *   powerTypes      — array of power ids to place, e.g. ['shield','defuser']
     *   corruptedCount  — corrupted tiles to place (4)
     *   rng             — seeded RNG from utils.createRng
     */
    constructor(opts) {
      this.rows = opts.rows;
      this.cols = opts.cols;
      this.mineCount = opts.mines;
      this.powerTypes = opts.powerTypes || [];
      this.corruptedCount = opts.corruptedCount || 0;
      this.rng = opts.rng;

      this.generated = false;
      // Bumped on every mutation; renderer uses it to cache the heatmap.
      this.version = 0;
      this.reset();
    }

    reset() {
      this.generated = false;
      this.version++;
      this.cells = [];
      for (let r = 0; r < this.rows; r++) {
        const row = [];
        for (let c = 0; c < this.cols; c++) {
          row.push({
            r, c,
            mine: false,
            adj: 0,            // adjacent mine count
            revealed: false,
            flagged: false,
            power: null,       // 'scanner' | 'shield' | 'defuser' | null
            collected: false,  // power picked up (drawn as faint watermark)
            corrupted: false,
            corruptionSeen: false, // effect already triggered
            defused: false     // was a mine, neutralized by Defuser
          });
        }
        this.cells.push(row);
      }
    }

    inBounds(r, c) { return r >= 0 && r < this.rows && c >= 0 && c < this.cols; }
    get(r, c) { return this.inBounds(r, c) ? this.cells[r][c] : null; }

    eachCell(fn) {
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++)
          fn(this.cells[r][c]);
    }

    neighborsOf(r, c) {
      const out = [];
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const cell = this.get(r + dr, c + dc);
        if (cell) out.push(cell);
      }
      return out;
    }

    /* ----------------------------------------------------------
     * Generation
     * ----------------------------------------------------------
     * First-click safety: the clicked cell is excluded from the
     * mine candidate list, which guarantees a safe first reveal
     * in a single deterministic pass (equivalent to the classic
     * "regenerate until safe" loop, without the looping).
     * -------------------------------------------------------- */
    generateFor(safeR, safeC) {
      const candidates = [];
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++)
          if (!(r === safeR && c === safeC)) candidates.push([r, c]);

      this.rng.shuffle(candidates);
      for (let i = 0; i < this.mineCount; i++) {
        const [r, c] = candidates[i];
        this.cells[r][c].mine = true;
      }

      this.recalcAdjacency();
      this.placeSpecials(safeR, safeC);
      this.generated = true;
      this.version++;
    }

    recalcAdjacency() {
      this.eachCell((cell) => {
        let n = 0;
        for (const nb of this.neighborsOf(cell.r, cell.c)) if (nb.mine) n++;
        cell.adj = n;
      });
    }

    /**
     * Power tiles: 2 per board, preferring cells NOT adjacent to any
     * mine (adj === 0) when enough exist; otherwise any safe cell.
     * Corrupted tiles: 4 per board, always safe, never on a power
     * tile and never on the first-click cell (so the very first
     * reveal can't instantly fire a corruption effect).
     */
    placeSpecials(safeR, safeC) {
      const safeCells = [];
      this.eachCell((cell) => { if (!cell.mine) safeCells.push(cell); });

      // --- powers ---
      const zeroCells = safeCells.filter((cell) => cell.adj === 0);
      const powerPool = zeroCells.length >= this.powerTypes.length
        ? zeroCells.slice()
        : safeCells.slice();
      this.rng.shuffle(powerPool);
      const powerCells = [];
      for (const type of this.powerTypes) {
        const cell = powerPool.pop();
        if (!cell) break;
        cell.power = type;
        powerCells.push(cell);
      }

      // --- corrupted ---
      const corruptPool = safeCells.filter((cell) =>
        !cell.power && !(cell.r === safeR && cell.c === safeC));
      this.rng.shuffle(corruptPool);
      for (let i = 0; i < this.corruptedCount && i < corruptPool.length; i++) {
        corruptPool[i].corrupted = true;
      }
    }

    /* ----------------------------------------------------------
     * Reveal flood fill — iterative BFS with an index head
     * pointer (no recursion, no Array.shift O(n) cost).
     * Returns newly revealed cells as {r, c, depth}; depth is the
     * BFS ring used by the renderer for the ripple stagger.
     * -------------------------------------------------------- */
    floodReveal(r, c) {
      const out = [];
      const start = this.get(r, c);
      if (!start || start.revealed || start.flagged || start.mine) return out;

      start.revealed = true;
      out.push({ r: start.r, c: start.c, depth: 0 });

      const queue = [[start.r, start.c, 0]];
      let head = 0;
      while (head < queue.length) {
        const [qr, qc, depth] = queue[head++];
        const cell = this.get(qr, qc);
        // Only zero-tiles expand the wave.
        if (cell.adj !== 0) continue;
        for (const nb of this.neighborsOf(qr, qc)) {
          if (nb.revealed || nb.flagged || nb.mine) continue;
          nb.revealed = true;
          out.push({ r: nb.r, c: nb.c, depth: depth + 1 });
          queue.push([nb.r, nb.c, depth + 1]);
        }
      }
      this.version++;
      return out;
    }

    /** Reveal exactly one cell (used by Scanner Pulse — no flood). */
    revealSingle(r, c) {
      const cell = this.get(r, c);
      if (!cell || cell.revealed || cell.flagged || cell.mine) return null;
      cell.revealed = true;
      this.version++;
      return { r, c, depth: 0 };
    }

    toggleFlag(r, c) {
      const cell = this.get(r, c);
      if (!cell || cell.revealed) return null;
      cell.flagged = !cell.flagged;
      this.version++;
      return cell.flagged;
    }

    /** Defuser hit: the mine becomes a safe tile, numbers recomputed. */
    neutralizeMine(r, c) {
      const cell = this.get(r, c);
      if (!cell || !cell.mine) return false;
      cell.mine = false;
      cell.defused = true;
      this.mineCount--;
      this.recalcAdjacency();
      this.version++;
      return true;
    }

    flagCount() {
      let n = 0;
      this.eachCell((cell) => { if (cell.flagged) n++; });
      return n;
    }

    wrongFlagCount() {
      let n = 0;
      this.eachCell((cell) => { if (cell.flagged && !cell.mine) n++; });
      return n;
    }

    hiddenUnflaggedCount() {
      let n = 0;
      this.eachCell((cell) => { if (!cell.revealed && !cell.flagged) n++; });
      return n;
    }

    /** Classic win: every non-mine cell revealed. */
    isCleared() {
      if (!this.generated) return false;
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          const cell = this.cells[r][c];
          if (!cell.mine && !cell.revealed) return false;
        }
      return true;
    }

    /* ----------------------------------------------------------
     * Probability heatmap (heuristic, intentionally non-exact)
     * ----------------------------------------------------------
     * For every revealed numbered tile with value N, F flagged
     * neighbors and U unknown (hidden, unflagged) neighbors, the
     * remaining mines (N - F) are assumed uniformly distributed:
     * each unknown neighbor receives a contribution of (N-F)/U.
     * A tile touching several numbers SUMS the contributions and
     * the result is clamped to [0, 1].
     *
     * Tiles with no revealed numbered neighbor get the global
     * baseline density (remaining mines / hidden unflagged tiles)
     * instead of a misleading 0% — the overlay shows estimates
     * only and never declares a tile "safe" or "mine".
     *
     * Returns a rows*cols array: probability in [0,1] for hidden
     * unflagged cells, or null for revealed / flagged cells.
     * -------------------------------------------------------- */
    computeHeatmap() {
      const size = this.rows * this.cols;
      const risk = new Float32Array(size);
      const informed = new Uint8Array(size);

      this.eachCell((cell) => {
        if (!cell.revealed || cell.adj === 0) return;
        let flags = 0;
        const unknowns = [];
        for (const nb of this.neighborsOf(cell.r, cell.c)) {
          if (nb.flagged) flags++;
          else if (!nb.revealed) unknowns.push(nb);
        }
        if (unknowns.length === 0) return;
        const remaining = Math.max(0, cell.adj - flags);
        const share = remaining / unknowns.length;
        for (const nb of unknowns) {
          const idx = nb.r * this.cols + nb.c;
          risk[idx] += share;
          informed[idx] = 1; // even share===0 counts as information
        }
      });

      const hidden = this.hiddenUnflaggedCount();
      const remainingMines = Math.max(0, this.mineCount - this.flagCount());
      const baseline = hidden > 0 ? remainingMines / hidden : 0;

      const result = new Array(size).fill(null);
      this.eachCell((cell) => {
        if (cell.revealed || cell.flagged) return;
        const idx = cell.r * this.cols + cell.c;
        result[idx] = clamp(informed[idx] ? risk[idx] : baseline, 0, 1);
      });
      return result;
    }
  }

  RP.Board = Board;
})(window.RP = window.RP || {});
