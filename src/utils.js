/* ============================================================
 * utils.js — shared helpers + deterministic RNG
 *
 * All modules attach to the single `RP` (Reactor Protocol)
 * namespace so the game runs from file:// with plain <script>
 * tags (ES modules are blocked over file:// by CORS).
 * ============================================================ */
(function (RP) {
  'use strict';

  /**
   * mulberry32 — tiny, fast, seedable PRNG.
   * Given the same 32-bit seed it produces the same sequence,
   * which makes board generation deterministic (see README:
   * add ?seed=anything to the URL).
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Hash an arbitrary string into a 32-bit integer seed (xfnv1a). */
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  }

  /**
   * createRng(seed?) — returns a small RNG facade.
   * seed may be a string, a number, or undefined (random seed).
   */
  function createRng(seed) {
    let numericSeed;
    if (typeof seed === 'string' && seed.length) numericSeed = hashSeed(seed);
    else if (typeof seed === 'number') numericSeed = seed >>> 0;
    else numericSeed = (Math.random() * 0xFFFFFFFF) >>> 0;

    const next = mulberry32(numericSeed);
    return {
      seed: numericSeed,
      /** float in [0,1) */
      next,
      /** integer in [0, n) */
      int(n) { return Math.floor(next() * n); },
      /** random element of a non-empty array */
      pick(arr) { return arr[this.int(arr.length)]; },
      /** in-place Fisher–Yates shuffle, returns the array */
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = this.int(i + 1);
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      }
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /** ease-out cubic, the workhorse curve for reveal/pop animations */
  function easeOutCubic(t) { const u = 1 - t; return 1 - u * u * u; }

  /** ease-out back — slight overshoot, used for flag bounce */
  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /** "mm:ss" from a float seconds value */
  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  /** The 8 surrounding offsets, reused by board + game logic. */
  const NEIGHBOR_OFFSETS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  RP.utils = {
    mulberry32, hashSeed, createRng,
    clamp, lerp, easeOutCubic, easeOutBack, formatTime,
    NEIGHBOR_OFFSETS
  };
})(window.RP = window.RP || {});
