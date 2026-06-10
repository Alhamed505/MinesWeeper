/* ============================================================
 * effects.js — animation timing engine.
 *
 * Holds all time-based visual state (tile reveal tweens, flag
 * bounces, particles, pulse rings, screen shake, flash, glitch
 * jitter). The renderer queries this each requestAnimationFrame
 * tick and draws accordingly; the Effects object itself never
 * touches the canvas.
 *
 * Positions/velocities are stored in TILE UNITS so everything
 * survives a window resize for free — the renderer multiplies
 * by the current tile size at draw time.
 * ============================================================ */
(function (RP) {
  'use strict';

  const { clamp, easeOutCubic, easeOutBack } = RP.utils;

  const REVEAL_MS = 260;       // single tile scale-in/fade
  const RIPPLE_STEP_MS = 34;   // stagger per BFS ring in a flood
  const FLAG_MS = 320;
  const PULSE_MS = 620;
  const SHAKE_MS = 520;
  const FLASH_MS = 380;

  class Effects {
    constructor() {
      this.now = 0;
      this.reset();
    }

    reset() {
      this.tileAnims = new Map();   // "r,c" -> {kind, t0, dur}
      this.flagAnims = new Map();   // "r,c" -> t0
      this.glitches = new Map();    // "r,c" -> {t0, dur}
      this.particles = [];
      this.pulses = [];             // expanding neon rings
      this.shake = null;
      this.flash = null;
    }

    key(r, c) { return r + ',' + c; }

    /** Advance internal clock, integrate particles, prune dead state. */
    update(t) {
      const dt = this.now ? Math.min(0.05, (t - this.now) / 1000) : 0;
      this.now = t;

      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.grav * dt;
      }
      this.particles = this.particles.filter((p) => t - p.t0 < p.life);
      this.pulses = this.pulses.filter((p) => t - p.t0 < p.dur + p.delay);
      for (const [key, g] of this.glitches)
        if (t - g.t0 > g.dur) this.glitches.delete(key);
      for (const [key, a] of this.tileAnims)
        if (t - a.t0 > a.dur + 50) this.tileAnims.delete(key);
      for (const [key, t0] of this.flagAnims)
        if (t - t0 > FLAG_MS + 50) this.flagAnims.delete(key);
      if (this.shake && t - this.shake.t0 > this.shake.dur) this.shake = null;
      if (this.flash && t - this.flash.t0 > this.flash.dur) this.flash = null;
    }

    /* -------------------- tile reveals -------------------- */

    /**
     * Queue reveal animations for a batch of cells coming out of
     * a flood fill. `depth` becomes the ripple-wave delay.
     */
    revealBatch(tiles) {
      for (const tile of tiles) {
        this.tileAnims.set(this.key(tile.r, tile.c), {
          kind: 'reveal',
          t0: this.now + (tile.depth || 0) * RIPPLE_STEP_MS,
          dur: REVEAL_MS
        });
      }
    }

    /**
     * Reveal progress for a cell:
     *   null            — no animation (draw fully revealed)
     *   {pending:true}  — ripple hasn't reached it (draw hidden)
     *   {p: 0..1}       — mid scale-in/fade
     */
    revealState(r, c) {
      const anim = this.tileAnims.get(this.key(r, c));
      if (!anim) return null;
      const dt = this.now - anim.t0;
      if (dt < 0) return { pending: true, p: 0 };
      if (dt >= anim.dur) return null;
      return { pending: false, p: easeOutCubic(dt / anim.dur) };
    }

    /* -------------------- flags -------------------- */

    flagBounce(r, c) {
      this.flagAnims.set(this.key(r, c), this.now);
      // tiny spark burst from the flag base
      this.spawnParticles(r, c, {
        count: 7, speed: 1.6, spread: Math.PI,
        angle: -Math.PI / 2, life: 420, size: 0.05,
        color: '#ffb02e', grav: 5
      });
    }

    flagScale(r, c) {
      const t0 = this.flagAnims.get(this.key(r, c));
      if (t0 === undefined) return 1;
      const p = clamp((this.now - t0) / FLAG_MS, 0, 1);
      return easeOutBack(p);
    }

    /* -------------------- particles -------------------- */

    /**
     * Spawn a particle burst centered on tile (r, c).
     * All distances are tile units; renderer scales at draw time.
     */
    spawnParticles(r, c, opts) {
      const count = opts.count || 10;
      for (let i = 0; i < count; i++) {
        const angle = (opts.angle !== undefined ? opts.angle : 0) +
          (Math.random() - 0.5) * (opts.spread !== undefined ? opts.spread : Math.PI * 2);
        const speed = (opts.speed || 2) * (0.4 + Math.random() * 0.8);
        this.particles.push({
          r, c,
          x: 0, y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          grav: opts.grav !== undefined ? opts.grav : 3,
          life: (opts.life || 600) * (0.6 + Math.random() * 0.6),
          size: (opts.size || 0.07) * (0.6 + Math.random() * 0.9),
          color: opts.color || '#2ee6d6',
          t0: this.now
        });
      }
    }

    /* -------------------- big moments -------------------- */

    /** Mine explosion: shake + flash + two-tone debris burst. */
    explode(r, c) {
      this.shake = { t0: this.now, dur: SHAKE_MS, mag: 0.35 };
      this.flash = { t0: this.now, dur: FLASH_MS, color: '255,80,60' };
      this.spawnParticles(r, c, {
        count: 26, speed: 5, life: 900, size: 0.09, color: '#ff5a3c', grav: 6
      });
      this.spawnParticles(r, c, {
        count: 14, speed: 3, life: 700, size: 0.06, color: '#ffd23e', grav: 4
      });
    }

    /** Shield block: cyan flash + ring, gentler than an explosion. */
    shieldBlock(r, c) {
      this.flash = { t0: this.now, dur: 280, color: '46,230,214' };
      this.pulseRing(r, c, '#2ee6d6', 0);
      this.spawnParticles(r, c, {
        count: 16, speed: 3, life: 650, size: 0.06, color: '#2ee6d6', grav: 0
      });
    }

    /** Neon pulse ring on a tile (power activations). */
    pulseRing(r, c, color, delay) {
      this.pulses.push({ r, c, color, t0: this.now, dur: PULSE_MS, delay: delay || 0 });
    }

    /** Ring state for renderer: list of {r,c,color,p} currently live. */
    livePulses() {
      const out = [];
      for (const ring of this.pulses) {
        const dt = this.now - ring.t0 - ring.delay;
        if (dt < 0 || dt > ring.dur) continue;
        out.push({ r: ring.r, c: ring.c, color: ring.color, p: dt / ring.dur });
      }
      return out;
    }

    /* -------------------- corruption glitch -------------------- */

    /** Visual-only jitter on a set of cells for `dur` ms. */
    glitch(cells, dur) {
      for (const cell of cells) {
        this.glitches.set(this.key(cell.r, cell.c), { t0: this.now, dur: dur || 400 });
      }
    }

    /** Per-frame jitter offset in tile units (0,0 when not glitching). */
    glitchOffset(r, c) {
      const g = this.glitches.get(this.key(r, c));
      if (!g) return null;
      const remain = 1 - (this.now - g.t0) / g.dur;
      const mag = 0.12 * remain;
      return {
        x: (Math.random() - 0.5) * 2 * mag,
        y: (Math.random() - 0.5) * 2 * mag
      };
    }

    /* -------------------- whole-canvas -------------------- */

    /** Screen shake offset in tile units. */
    shakeOffset() {
      if (!this.shake) return { x: 0, y: 0 };
      const p = (this.now - this.shake.t0) / this.shake.dur;
      const mag = this.shake.mag * (1 - p) * (1 - p);
      return {
        x: (Math.random() - 0.5) * 2 * mag,
        y: (Math.random() - 0.5) * 2 * mag
      };
    }

    /** Flash overlay {rgb, alpha} or null. */
    flashState() {
      if (!this.flash) return null;
      const p = (this.now - this.flash.t0) / this.flash.dur;
      return { color: this.flash.color, alpha: 0.55 * (1 - p) };
    }
  }

  RP.Effects = Effects;
})(window.RP = window.RP || {});
