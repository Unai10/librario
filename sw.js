/**
 * Service Worker — Librario PWA
 * Estrategia: Cache-first para assets estáticos, Network-first para recursos externos
 */

const CACHE_VERSION = 'v1.1.4';
const CACHE_STATIC = `librario-static-${CACHE_VERSION}`;
const CACHE_CDN    = `librario-cdn-${CACHE_VERSION}`;

// Assets propios de la app que se cachean en instalación
const STATIC_ASSETS = [
  './index.html',
  './styles.css',
  './manifest.json',
  './js/app.js',
  './js/db.js',
  './js/library.js',
  './js/reader.js',
  './js/editor.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_CDN)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo manejar GET
  if (request.method !== 'GET') return;

  if(!url.protocol.startsWith('http')) return;

  // Recursos CDN (jsDelivr, unpkg, etc.) → cache-first
  if (url.hostname.includes('jsdelivr') || url.hostname.includes('unpkg') || url.hostname.includes('cdnjs')) {
    event.respondWith(cdnCacheFirst(request));
    return;
  }

  // Assets propios → cache-first con fallback a network
  if (url.origin === self.location.origin) {
    event.respondWith(staticCacheFirst(request));
    return;
  }
});

async function staticCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Solo devolver index.html para peticiones de navegación (páginas)
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Network error', { status: 408 });
  }
}

async function cdnCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_CDN);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.error('[SW] CDN fetch error:', err);
    return new Response('CDN resource unavailable offline', { status: 503 });
  }
}

// ─── Background sync (para futuros usos) ────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
