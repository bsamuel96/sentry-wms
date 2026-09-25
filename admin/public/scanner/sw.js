const CACHE_NAME = 'sentry-wms-mobile-shell-v1';
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const scoped = (path) => `${BASE_PATH}${path}`;
const SHELL = [
  scoped('/offline.html'),
  scoped('/manifest.webmanifest'),
  scoped('/icons/sentry-192.png'),
  scoped('/icons/sentry-512.png'),
  scoped('/icons/sentry-maskable.svg'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isOperationalRequest(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/auth/')
    || url.pathname.includes('/login');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isOperationalRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(scoped('/offline.html'))),
    );
    return;
  }

  const isVersionedAsset = url.pathname.startsWith(scoped('/_expo/static/'))
    || url.pathname.startsWith(scoped('/icons/'))
    || url.pathname === scoped('/manifest.webmanifest');
  if (!isVersionedAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
