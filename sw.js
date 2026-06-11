/* ============================================================
 * sw.js — service worker for offline play + installability.
 *
 * Strategy:
 *  - Precache the full app shell on install (the game is a fixed
 *    set of static files, so it can run fully offline).
 *  - Same-origin GET: cache-first, falling back to network and
 *    then to the cached index.html for navigations.
 *  - Google Fonts (cross-origin): stale-while-revalidate so the
 *    UI keeps its fonts offline after the first visit.
 *
 * Bump CACHE_VERSION on any asset change to roll the cache.
 * ============================================================ */
'use strict';

const CACHE_VERSION = 'mw-v2-2026-06-11';
const CACHE = 'minesweeper-' + CACHE_VERSION;

// App shell — paths are relative to the SW scope (site root).
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/styles.css',
  './assets/icons.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './src/utils.js',
  './src/storage.js',
  './src/i18n.js',
  './src/audio.js',
  './src/effects.js',
  './src/board.js',
  './src/game.js',
  './src/renderer.js',
  './src/ui.js',
  './src/main.js'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // individual addAll entries shouldn't fail the whole install
      .then((cache) => Promise.all(SHELL.map((url) =>
        cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Cross-origin fonts: stale-while-revalidate.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Only manage our own origin beyond that.
  if (url.origin !== self.location.origin) return;

  // Navigations: cache-first on index, network fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) =>
        cached || fetch(req).catch(() => caches.match('./')))
    );
    return;
  }

  // Static assets: cache-first, then network (and cache it).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
}
