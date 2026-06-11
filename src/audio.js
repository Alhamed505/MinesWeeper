/* ============================================================
 * audio.js — WebAudio sound design, fully synthesized.
 *
 * No audio files: every effect is built from oscillators and
 * filtered noise at play time, which keeps the game a zero-asset
 * static page. The AudioContext is created lazily on the first
 * user gesture (browser autoplay policy) and the whole layer is
 * a no-op when muted or when WebAudio is unavailable.
 *
 * Design notes (game-audio practice):
 *  - UI ticks are short, quiet, high-passed — never fatiguing.
 *  - Reveal pitch rises with the combo chain (positive feedback).
 *  - Flood fills arpeggiate a few staggered blips, scaled by size.
 *  - Explosions layer a sub-drop + filtered noise + debris
 *    crackle, with randomized variation so no two sound alike.
 *  - Each power has its own timbre family (sine sweeps for the
 *    scanner, metallic ring for the shield, low chime for the
 *    defuser); corruption uses detuned saws (dissonance = danger).
 * ============================================================ */
(function (RP) {
  'use strict';

  class AudioEngine {
    constructor(enabled) {
      this.enabled = enabled !== false;
      this.ctx = null;
      this.master = null;
    }

    /** Lazily create / resume the context. Call from user gestures. */
    ensure() {
      if (!this.enabled) return false;
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) { this.enabled = false; return false; }
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.4;
          this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx.state !== 'closed';
      } catch (_) {
        this.enabled = false;
        return false;
      }
    }

    setEnabled(on) {
      this.enabled = on;
      if (on) this.ensure();
    }

    /* ------------------- synthesis primitives ------------------- */

    /**
     * One enveloped oscillator.
     * opts: freq, end (slide target), type, dur, vol, delay, attack
     */
    tone(opts) {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + (opts.delay || 0);
      const dur = opts.dur || 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(opts.freq, t0);
      if (opts.end) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.end), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(opts.vol || 0.3, t0 + (opts.attack || 0.005));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    /**
     * Filtered white-noise burst.
     * opts: dur, vol, delay, filter ('lowpass'|...), freq, end, q
     */
    noise(opts) {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + (opts.delay || 0);
      const dur = opts.dur || 0.3;
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = opts.filter || 'lowpass';
      filter.frequency.setValueAtTime(opts.freq || 1000, t0);
      if (opts.end) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.end), t0 + dur);
      filter.Q.value = opts.q || 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(opts.vol || 0.4, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t0);
    }

    /* ----------------------- game events ----------------------- */

    /** Quiet high tick for HUD buttons. */
    uiClick() {
      this.tone({ freq: 1500, type: 'square', dur: 0.035, vol: 0.06 });
    }

    /**
     * Tile reveal. Pitch climbs with the combo chain; large floods
     * add a rising two-blip flourish scaled by the wave size.
     */
    reveal(count, chain) {
      const base = 440 + Math.min(8, chain || 0) * 45;
      this.tone({ freq: base, dur: 0.07, vol: 0.18 });
      if (count > 3) {
        this.tone({ freq: base * 1.25, dur: 0.07, vol: 0.15, delay: 0.05 });
        this.tone({ freq: base * 1.5, dur: 0.09, vol: 0.13, delay: 0.1 });
      }
      if (count > 12) {
        this.tone({ freq: base * 2, dur: 0.12, vol: 0.1, delay: 0.16 });
      }
    }

    /** Flag pennant: up-blip to place, down-blip to remove. */
    flag(placed) {
      this.tone({
        freq: placed ? 700 : 540,
        end: placed ? 1050 : 380,
        type: 'triangle', dur: 0.09, vol: 0.22
      });
    }

    /** Detuned saw wobble — corruption is dissonant by design. */
    corrupted() {
      this.tone({ freq: 180, end: 95, type: 'sawtooth', dur: 0.35, vol: 0.16 });
      this.tone({ freq: 191, end: 101, type: 'sawtooth', dur: 0.35, vol: 0.16 });
      this.noise({ dur: 0.18, vol: 0.1, filter: 'bandpass', freq: 2400, q: 6 });
    }

    /** Ascending pickup arpeggio. */
    powerCollect() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => this.tone({ freq: f, dur: 0.1, vol: 0.2, delay: i * 0.07 }));
    }

    /** Sonar sweep + answering ping. */
    scanner() {
      this.tone({ freq: 600, end: 1500, dur: 0.4, vol: 0.18 });
      this.tone({ freq: 1700, dur: 0.18, vol: 0.14, delay: 0.32 });
      this.tone({ freq: 1700, dur: 0.12, vol: 0.07, delay: 0.5 });
    }

    /** Defuser: success = descending resolve chime; miss = dull thud. */
    defuser(hit) {
      if (hit) {
        [880, 660, 440].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.14, vol: 0.2, delay: i * 0.09 }));
        this.tone({ freq: 110, dur: 0.25, vol: 0.25, delay: 0.27, type: 'sine' });
      } else {
        this.tone({ freq: 130, end: 70, dur: 0.22, vol: 0.25 });
        this.noise({ dur: 0.1, vol: 0.08, freq: 500 });
      }
    }

    /** Metallic clang for a shield block. */
    shield() {
      this.noise({ dur: 0.12, vol: 0.25, filter: 'highpass', freq: 2500 });
      this.tone({ freq: 2200, dur: 0.4, vol: 0.12, type: 'triangle' });
      this.tone({ freq: 1466, dur: 0.5, vol: 0.1, type: 'triangle', delay: 0.02 });
      this.tone({ freq: 220, end: 140, dur: 0.3, vol: 0.2, delay: 0.04 });
    }

    /** Sonar double-ping for the hint marker. */
    hint() {
      this.tone({ freq: 980, dur: 0.22, vol: 0.16 });
      this.tone({ freq: 980, dur: 0.3, vol: 0.08, delay: 0.22 });
    }

    /**
     * Mine explosion — dramatic and varied. Three randomized
     * layers (sub drop, filtered blast, debris crackle) plus a
     * variant chosen per blast so repeats never sound identical.
     */
    explosion() {
      const r = Math.random;
      const variant = Math.floor(r() * 3);
      // 1) sub-bass drop
      this.tone({
        freq: 90 + r() * 30, end: 28, type: 'sine',
        dur: 0.55 + r() * 0.25, vol: 0.55
      });
      // 2) main blast: lowpassed noise sweeping shut
      this.noise({
        dur: 0.6 + r() * 0.3, vol: 0.5,
        freq: 2600 + r() * 1500, end: 120 + r() * 80
      });
      // 3) debris crackle: 2-4 small delayed bursts
      const crackles = 2 + Math.floor(r() * 3);
      for (let i = 0; i < crackles; i++) {
        this.noise({
          delay: 0.12 + i * (0.07 + r() * 0.06),
          dur: 0.07 + r() * 0.05, vol: 0.12 + r() * 0.08,
          filter: 'bandpass', freq: 700 + r() * 2200, q: 2
        });
      }
      // variant flavors
      if (variant === 1) { // double boom
        this.tone({ freq: 70, end: 24, dur: 0.5, vol: 0.4, delay: 0.18 });
        this.noise({ dur: 0.4, vol: 0.3, freq: 1400, end: 90, delay: 0.18 });
      } else if (variant === 2) { // metallic shrapnel ring
        this.tone({ freq: 1860 + r() * 600, dur: 0.5, vol: 0.07, type: 'triangle', delay: 0.1 });
      }
    }

    /** End-of-run jingles. */
    jingle(kind) {
      if (kind === 'won') {
        [523, 659, 784, 1046, 1318].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.16, vol: 0.2, delay: i * 0.11 }));
        this.tone({ freq: 1568, dur: 0.5, vol: 0.16, delay: 0.58 });
      } else if (kind === 'cleared') {
        [523, 587, 659].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.18, vol: 0.18, delay: i * 0.13 }));
      } else { // lost — slow descending drone under the blast tail
        [330, 247, 165].forEach((f, i) =>
          this.tone({ freq: f, type: 'sawtooth', dur: 0.5, vol: 0.1, delay: 0.35 + i * 0.3 }));
      }
    }
  }

  RP.AudioEngine = AudioEngine;
})(window.RP = window.RP || {});
