/* ============================================================
 * storage.js — localStorage persistence (best score, prefs)
 * Wrapped in try/catch so the game still works when storage
 * is unavailable (private mode, file:// quirks, etc.).
 * ============================================================ */
(function (RP) {
  'use strict';

  const KEY_BEST = 'rp2:bestScore';
  const KEY_SEEN_HELP = 'rp2:seenHelp';

  function read(key) {
    try { return window.localStorage.getItem(key); }
    catch (_) { return null; }
  }

  function write(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (_) { return false; }
  }

  RP.storage = {
    getBestScore() {
      const v = parseInt(read(KEY_BEST), 10);
      return Number.isFinite(v) ? v : 0;
    },

    /** Saves score if it beats the stored best. Returns true on a new record. */
    submitScore(score) {
      if (score > this.getBestScore()) {
        write(KEY_BEST, String(score));
        return true;
      }
      return false;
    },

    hasSeenHelp() { return read(KEY_SEEN_HELP) === '1'; },
    markHelpSeen() { write(KEY_SEEN_HELP, '1'); }
  };
})(window.RP = window.RP || {});
