/* ============================================================
 * sw.js — service worker for offline play + installability.
 *
 * Strategy:
 *  - Precache the full app shell on install (the game is a fixed
 *    set of static files, so it can run fully offline).
 *  - Navigations: NETWORK-FIRST. A normal refresh always tries
 *    the network (so you never get a stale/broken page while
 *    online — same behaviour as a hard refresh); it falls back
 *    to the cached shell only when the network is unavailable.
 *  - Other same-origin GETs: cache-first, then network.
 *  - Google Fonts (cross-origin): stale-while-revalidate.
 *
 * Every branch that calls respondWith resolves to a real
 * Response (never undefined/reject), so the SW can't itself
 * produce an ERR_FAILED navigation error.
 *
 * Bump CACHE_VERSION on any asset change to roll the cache.
 * ============================================================ */
'use strict';

const CACHE_VERSION = 'mw-v3-2026-06-11';
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
      // individual entries shouldn't fail the whole install
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

// Let the page tell a waiting worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
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

  // Page navigations: network-first, cached shell as offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // Static assets: cache-first, then network (and cache the result).
  event.respondWith(cacheFirst(req));
});

/** Network-first for HTML navigations; always resolves to a Response. */
function networkFirstNavigation(req) {
  return fetch(req)
    .then((res) => {
      // refresh the cached shell copy for offline use
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
      }
      return res;
    })
    .catch(() =>
      caches.match('./index.html')
        .then((c) => c || caches.match('./'))
        .then((c) => c || new Response(
          '<h1>Offline</h1><p>Reconnect to load MinesWeeper.</p>',
          { headers: { 'Content-Type': 'text/html' }, status: 503 }))
    );
}

/** Cache-first for sub-resources; network fallback, caches new ok responses. */
function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    if (cached) return cached;
    return fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached || Response.error());
  });
}

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
