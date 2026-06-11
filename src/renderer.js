/* ============================================================
 * renderer.js — HTML5 Canvas presentation layer.
 *
 * Pure read-only over Board/Game/Effects: queries state every
 * requestAnimationFrame tick and paints. Owns DPI scaling,
 * responsive sizing, hit-testing (pixel -> cell), and the
 * heatmap overlay cache.
 * ============================================================ */
(function (RP) {
  'use strict';

  const { clamp } = RP.utils;

  // Reactor palette (mirrors the CSS custom properties).
  const PAL = {
    boardBg: '#06121a',
    hiddenTop: '#16303d',
    hiddenBottom: '#0c1f29',
    hiddenEdge: '#22414f',
    hiddenHover: '#1d4253',
    floor: '#0a1822',
    floorEdge: '#123040',
    corruptFloor: '#1d0f24',
    corrupt: '#ff4fd8',
    cyan: '#2ee6d6',
    amber: '#ffb02e',
    red: '#ff5a3c',
    flag: '#ffb02e',
    mine: '#dfeef2',
    defused: '#69e08b',
    numbers: [null, '#4fd8ff', '#69e08b', '#ffb02e', '#ff9d5c',
      '#ff5a3c', '#ff4fd8', '#b08cff', '#e8f4f8']
  };

  const POWER_GLYPH = { scanner: 'S', shield: '⛨', defuser: 'D' };
  const POWER_COLOR = { scanner: '#4fd8ff', shield: '#2ee6d6', defuser: '#69e08b' };

  class Renderer {
    constructor(canvas, game, effects) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.game = game;
      this.effects = effects;
      this.tile = 40;            // CSS pixels per tile
      this.hover = null;         // {r, c} under the pointer
      this.heatCache = { version: -1, data: null };
      this.resize();
    }

    /** Fit the square board into its parent, honoring devicePixelRatio. */
    resize() {
      const board = this.game.board;
      const parent = this.canvas.parentElement;
      const avail = Math.min(parent.clientWidth, 640);
      // cap tile size so tiny grids (3x3) don't become billboards
      this.tile = Math.min(84, Math.max(22, Math.floor(avail / board.cols)));
      const cssSize = this.tile * board.cols;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.style.width = cssSize + 'px';
      this.canvas.style.height = cssSize + 'px';
      this.canvas.width = Math.round(cssSize * dpr);
      this.canvas.height = Math.round(cssSize * dpr);
      this.dpr = dpr;
      this.cssSize = cssSize;
    }

    /** Pixel -> cell hit test. Returns {r,c} or null. */
    tileAt(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const c = Math.floor(x / this.tile);
      const r = Math.floor(y / this.tile);
      return this.game.board.inBounds(r, c) ? { r, c } : null;
    }

    /** Center of a cell in CSS pixels (used by main.js for tooltips). */
    tileCenter(r, c) {
      return { x: (c + 0.5) * this.tile, y: (r + 0.5) * this.tile };
    }

    heatmap() {
      const board = this.game.board;
      if (this.heatCache.version !== board.version) {
        this.heatCache = { version: board.version, data: board.computeHeatmap() };
      }
      return this.heatCache.data;
    }

    heatAt(r, c) {
      const data = this.heatmap();
      return data ? data[r * this.game.board.cols + c] : null;
    }

    /* ======================= frame ======================= */

    render() {
      const ctx = this.ctx;
      const game = this.game;
      const board = game.board;
      const fx = this.effects;
      const tile = this.tile;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssSize, this.cssSize);

      // screen shake (decaying random offset from effects)
      const shake = fx.shakeOffset();
      ctx.translate(shake.x * tile, shake.y * tile);

      // board backplate
      ctx.fillStyle = PAL.boardBg;
      this.roundRect(0, 0, this.cssSize, this.cssSize, 10);
      ctx.fill();

      const showHeat = game.heatmapVisible();
      const heat = showHeat ? this.heatmap() : null;

      for (let r = 0; r < board.rows; r++) {
        for (let c = 0; c < board.cols; c++) {
          this.drawCell(board.cells[r][c], heat);
        }
      }

      this.drawTargeting();
      this.drawPulses();
      this.drawParticles();

      // full-canvas flash (explosion / shield)
      const flash = fx.flashState();
      if (flash) {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = 'rgba(' + flash.color + ',' + flash.alpha.toFixed(3) + ')';
        ctx.fillRect(0, 0, this.cssSize, this.cssSize);
      }
    }

    /* ======================= cells ======================= */

    drawCell(cell, heat) {
      const fx = this.effects;
      const game = this.game;
      const tile = this.tile;
      let x = cell.c * tile;
      let y = cell.r * tile;

      // corruption glitch jitter (visual only)
      const jitter = fx.glitchOffset(cell.r, cell.c);
      if (jitter) { x += jitter.x * tile; y += jitter.y * tile; }

      const anim = cell.revealed ? fx.revealState(cell.r, cell.c) : null;
      const showAsHidden = !cell.revealed || (anim && anim.pending);

      if (showAsHidden) {
        this.drawHiddenTile(cell, x, y, !!jitter);
        // heatmap tint sits on top of hidden tiles only
        if (heat) {
          const p = heat[cell.r * game.board.cols + cell.c];
          if (p !== null && !cell.flagged) this.drawHeatTint(x, y, p);
        }
        if (cell.flagged) this.drawFlag(cell, x, y);
        else if (cell.shieldMarked && !game.isOver) this.drawShieldMark(x, y);
        // hint marker: provably-safe tile, dashed green halo
        if (cell.hintMark && !cell.flagged && !game.isOver) this.drawHintMark(x, y);
        // on loss, expose every unrevealed mine
        if (game.state === 'lost' && cell.mine) this.drawMine(x, y, false);
        // on loss, cross out wrong flags
        if (game.state === 'lost' && cell.flagged && !cell.mine) this.drawWrongFlagX(x, y);
      } else {
        const p = anim ? anim.p : 1;
        this.drawRevealedTile(cell, x, y, p);
      }
    }

    drawHiddenTile(cell, x, y, glitching) {
      const ctx = this.ctx;
      const tile = this.tile;
      const g = 2; // gap
      const hovered = this.hover && this.hover.r === cell.r && this.hover.c === cell.c
        && !this.game.isOver;

      // 2.5D raised cap: bottom shadow ledge + gradient face
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      this.roundRect(x + g, y + g + 2, tile - g * 2, tile - g * 2, 6);
      ctx.fill();

      const grad = ctx.createLinearGradient(x, y, x, y + tile);
      if (glitching) {
        grad.addColorStop(0, '#3a1840');
        grad.addColorStop(1, '#1d0f24');
      } else {
        grad.addColorStop(0, hovered ? PAL.hiddenHover : PAL.hiddenTop);
        grad.addColorStop(1, PAL.hiddenBottom);
      }
      ctx.fillStyle = grad;
      this.roundRect(x + g, y + g, tile - g * 2, tile - g * 2, 6);
      ctx.fill();

      // top highlight edge
      ctx.strokeStyle = glitching ? 'rgba(255,79,216,0.6)'
        : (hovered ? 'rgba(46,230,214,0.55)' : PAL.hiddenEdge);
      ctx.lineWidth = 1;
      this.roundRect(x + g + 0.5, y + g + 0.5, tile - g * 2 - 1, tile - g * 2 - 1, 6);
      ctx.stroke();
    }

    drawRevealedTile(cell, x, y, p) {
      const ctx = this.ctx;
      const tile = this.tile;
      const g = 2;

      // sunken floor (always full-size; only contents animate)
      ctx.fillStyle = cell.corruptionSeen ? PAL.corruptFloor : PAL.floor;
      this.roundRect(x + g, y + g, tile - g * 2, tile - g * 2, 5);
      ctx.fill();
      ctx.strokeStyle = cell.corruptionSeen ? 'rgba(255,79,216,0.35)' : PAL.floorEdge;
      ctx.lineWidth = 1;
      this.roundRect(x + g + 0.5, y + g + 0.5, tile - g * 2 - 1, tile - g * 2 - 1, 5);
      ctx.stroke();

      // contents scale-in / fade with reveal progress p
      ctx.save();
      ctx.globalAlpha = p;
      const cx = x + tile / 2;
      const cy = y + tile / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p);
      ctx.translate(-cx, -cy);

      if (cell.mine) {
        // only happens on the losing click
        ctx.fillStyle = 'rgba(255,90,60,0.25)';
        this.roundRect(x + g, y + g, tile - g * 2, tile - g * 2, 5);
        ctx.fill();
        this.drawMine(x, y, true);
      } else {
        // power watermark behind the number
        if (cell.power) this.drawPowerGlyph(cell.power, x, y);
        if (cell.corruptionSeen) this.drawCorruptSigil(x, y);
        if (cell.defused) this.drawDefusedMark(x, y);
        if (cell.adj > 0) {
          ctx.font = '700 ' + Math.round(tile * 0.46) + 'px "Chakra Petch", Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = PAL.numbers[cell.adj];
          ctx.shadowColor = PAL.numbers[cell.adj];
          ctx.shadowBlur = 6;
          ctx.fillText(String(cell.adj), cx, cy + tile * 0.02);
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();
    }

    /* ======================= glyphs ======================= */

    drawFlag(cell, x, y) {
      const ctx = this.ctx;
      const tile = this.tile;
      const s = this.effects.flagScale(cell.r, cell.c);
      const cx = x + tile / 2;
      const cy = y + tile / 2;
      ctx.save();
      ctx.translate(cx, cy + tile * 0.06);
      ctx.scale(s, s);
      // pole
      ctx.strokeStyle = '#cfe6ec';
      ctx.lineWidth = Math.max(1.5, tile * 0.05);
      ctx.beginPath();
      ctx.moveTo(0, tile * 0.28);
      ctx.lineTo(0, -tile * 0.3);
      ctx.stroke();
      // pennant
      ctx.fillStyle = PAL.flag;
      ctx.shadowColor = PAL.flag;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -tile * 0.3);
      ctx.lineTo(tile * 0.26, -tile * 0.18);
      ctx.lineTo(0, -tile * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      // base
      ctx.fillStyle = '#cfe6ec';
      ctx.fillRect(-tile * 0.12, tile * 0.26, tile * 0.24, tile * 0.06);
      ctx.restore();
    }

    drawMine(x, y, exploded) {
      const ctx = this.ctx;
      const tile = this.tile;
      const cx = x + tile / 2;
      const cy = y + tile / 2;
      const rad = tile * 0.22;
      ctx.save();
      ctx.fillStyle = exploded ? PAL.red : '#5a7681';
      ctx.strokeStyle = exploded ? PAL.red : '#5a7681';
      if (exploded) { ctx.shadowColor = PAL.red; ctx.shadowBlur = 12; }
      // spikes
      ctx.lineWidth = Math.max(1.5, tile * 0.05);
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rad * 0.6, cy + Math.sin(a) * rad * 0.6);
        ctx.lineTo(cx + Math.cos(a) * rad * 1.55, cy + Math.sin(a) * rad * 1.55);
        ctx.stroke();
      }
      // body + glint
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(cx - rad * 0.32, cy - rad * 0.32, rad * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawWrongFlagX(x, y) {
      const ctx = this.ctx;
      const tile = this.tile;
      ctx.save();
      ctx.strokeStyle = PAL.red;
      ctx.lineWidth = Math.max(2, tile * 0.07);
      ctx.lineCap = 'round';
      const m = tile * 0.24;
      ctx.beginPath();
      ctx.moveTo(x + m, y + m);
      ctx.lineTo(x + tile - m, y + tile - m);
      ctx.moveTo(x + tile - m, y + m);
      ctx.lineTo(x + m, y + tile - m);
      ctx.stroke();
      ctx.restore();
    }

    drawHintMark(x, y) {
      const ctx = this.ctx;
      const tile = this.tile;
      // gentle breathing pulse so it reads as "suggested", not revealed
      const breathe = 0.55 + 0.35 * Math.sin(this.effects.now / 280);
      ctx.save();
      ctx.globalAlpha = breathe;
      ctx.strokeStyle = PAL.defused;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.shadowColor = PAL.defused;
      ctx.shadowBlur = 8;
      this.roundRect(x + 4, y + 4, tile - 8, tile - 8, 5);
      ctx.stroke();
      ctx.restore();
    }

    drawShieldMark(x, y) {
      // small cyan emblem on a mine the shield already absorbed
      const ctx = this.ctx;
      const tile = this.tile;
      ctx.save();
      ctx.font = '700 ' + Math.round(tile * 0.4) + 'px "Segoe UI Symbol", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PAL.cyan;
      ctx.shadowColor = PAL.cyan;
      ctx.shadowBlur = 8;
      ctx.fillText('⛨', x + tile / 2, y + tile / 2 + tile * 0.02);
      ctx.restore();
    }

    drawPowerGlyph(type, x, y) {
      const ctx = this.ctx;
      const tile = this.tile;
      ctx.save();
      ctx.globalAlpha *= 0.4;
      ctx.font = '700 ' + Math.round(tile * 0.62) + 'px "Chakra Petch", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = POWER_COLOR[type];
      ctx.shadowColor = POWER_COLOR[type];
      ctx.shadowBlur = 10;
      ctx.fillText(POWER_GLYPH[type], x + tile / 2, y + tile / 2 + tile * 0.03);
      ctx.restore();
    }

    drawCorruptSigil(x, y) {
      const ctx = this.ctx;
      const tile = this.tile;
      ctx.save();
      ctx.globalAlpha *= 0.7;
      ctx.strokeStyle = PAL.corrupt;
      ctx.lineWidth = Math.max(1, tile * 0.035);
      const cx = x + tile * 0.78;
      const cy = y + tile * 0.78;
      const r = tile * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx - r * 0.3, cy - r);
      ctx.lineTo(cx + r * 0.3, cy);
      ctx.lineTo(cx + r, cy - r);
      ctx.stroke();
      ctx.restore();
    }

    drawDefusedMark(x, y) {
      const ctx = this.ctx;
      const tile = this.tile;
      ctx.save();
      ctx.strokeStyle = PAL.defused;
      ctx.lineWidth = Math.max(1.5, tile * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + tile * 0.3, y + tile * 0.52);
      ctx.lineTo(x + tile * 0.45, y + tile * 0.66);
      ctx.lineTo(x + tile * 0.72, y + tile * 0.34);
      ctx.stroke();
      ctx.restore();
    }

    drawHeatTint(x, y, p) {
      // Low-opacity tint: cyan (low risk) -> amber -> red (high risk).
      const ctx = this.ctx;
      const tile = this.tile;
      const hue = 185 - 185 * p;
      const alpha = 0.10 + 0.30 * p;
      ctx.fillStyle = 'hsla(' + hue.toFixed(0) + ', 95%, 55%, ' + alpha.toFixed(3) + ')';
      this.roundRect(x + 2, y + 2, tile - 4, tile - 4, 6);
      ctx.fill();
    }

    /* ================== overlays / fx ================== */

    /** Highlight the affected area while a power is being aimed. */
    drawTargeting() {
      const game = this.game;
      if (!game.targeting || !this.hover) return;
      const ctx = this.ctx;
      const tile = this.tile;
      const { r, c } = this.hover;
      const board = game.board;

      const paint = (tr, tc, color) => {
        if (!board.inBounds(tr, tc)) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        this.roundRect(tc * tile + 2, tr * tile + 2, tile - 4, tile - 4, 6);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (game.targeting === 'scanner') {
        const center = board.get(r, c);
        const ok = center && center.revealed;
        const color = ok ? 'rgba(79,216,255,0.9)' : 'rgba(255,90,60,0.7)';
        paint(r, c, color);
        if (ok) {
          for (let d = 1; d <= RP.GameConfig.scannerRange; d++) {
            paint(r - d, c, color); paint(r + d, c, color);
            paint(r, c - d, color); paint(r, c + d, color);
          }
        }
      } else if (game.targeting === 'defuser') {
        const cell = board.get(r, c);
        const ok = cell && !cell.revealed && !cell.flagged;
        paint(r, c, ok ? 'rgba(105,224,139,0.9)' : 'rgba(255,90,60,0.7)');
      }
    }

    drawPulses() {
      const ctx = this.ctx;
      const tile = this.tile;
      for (const ring of this.effects.livePulses()) {
        const cx = (ring.c + 0.5) * tile;
        const cy = (ring.r + 0.5) * tile;
        const rad = (0.25 + 1.6 * ring.p) * tile;
        ctx.save();
        ctx.globalAlpha = (1 - ring.p) * 0.85;
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = Math.max(2, tile * 0.07) * (1 - ring.p * 0.6);
        ctx.shadowColor = ring.color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawParticles() {
      const ctx = this.ctx;
      const tile = this.tile;
      const now = this.effects.now;
      for (const p of this.effects.particles) {
        const life = clamp(1 - (now - p.t0) / p.life, 0, 1);
        ctx.save();
        ctx.globalAlpha = life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        const px = (p.c + 0.5 + p.x) * tile;
        const py = (p.r + 0.5 + p.y) * tile;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, p.size * tile * life + 0.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    /** Path helper (canvas roundRect with broad support). */
    roundRect(x, y, w, h, r) {
      const ctx = this.ctx;
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  }

  RP.Renderer = Renderer;
})(window.RP = window.RP || {});
