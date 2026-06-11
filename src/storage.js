/* ============================================================
 * storage.js — localStorage persistence.
 * Player profile (name, language, sound), per-mode best score
 * and best time, and the first-run help flag. Wrapped in
 * try/catch so the game still works when storage is blocked.
 * ============================================================ */
(function (RP) {
  'use strict';

  const PREFIX = 'rp2:';

  function read(key) {
    try { return window.localStorage.getItem(PREFIX + key); }
    catch (_) { return null; }
  }

  function write(key, value) {
    try { window.localStorage.setItem(PREFIX + key, value); return true; }
    catch (_) { return false; }
  }

  RP.storage = {
    /* ---------------- player profile ---------------- */

    getPlayerName() { return read('name') || ''; },
    setPlayerName(name) { write('name', String(name).slice(0, 20)); },

    getLang() { return read('lang') || 'en'; },
    setLang(lang) { write('lang', lang); },

    getSoundOn() { return read('sound') !== '0'; },
    setSoundOn(on) { write('sound', on ? '1' : '0'); },

    getSettings() {
      return {
        sizeId: read('sizeId') || '12',
        diffId: read('diffId') || 'medium'
      };
    },
    setSettings(s) {
      write('sizeId', s.sizeId);
      write('diffId', s.diffId);
    },

    /* ---------------- per-mode records ----------------
     * modeKey looks like "12x12:medium". Best score and best
     * (lowest) clear time are tracked independently. */

    getBest(modeKey) {
      const score = parseInt(read('best:' + modeKey), 10);
      const time = parseFloat(read('bestTime:' + modeKey));
      return {
        score: Number.isFinite(score) ? score : 0,
        time: Number.isFinite(time) ? time : null
      };
    },

    /**
     * Record a finished CLEARED run. Returns which records were
     * broken: {newScore, newTime}.
     */
    submitRun(modeKey, score, timeSecs) {
      const best = this.getBest(modeKey);
      const result = { newScore: false, newTime: false };
      if (score > best.score) {
        write('best:' + modeKey, String(score));
        result.newScore = true;
      }
      if (best.time === null || timeSecs < best.time) {
        write('bestTime:' + modeKey, timeSecs.toFixed(1));
        result.newTime = true;
      }
      return result;
    },

    hasSeenHelp() { return read('seenHelp') === '1'; },
    markHelpSeen() { write('seenHelp', '1'); }
  };
})(window.RP = window.RP || {});
