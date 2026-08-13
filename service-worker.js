const CACHE_NAME = 'nashdom-crm-v2.0.3';

// Главный service worker намеренно не зависит от Firebase/gstatic.
// Это позволяет запускать PWA из локального кеша даже при медленном или
// недоступном хостинге. Push обслуживается отдельным service worker.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-push.js',
  './firebase-messaging-sw.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './resident.html',
  './resident.css',
  './resident.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isRemoteDataRequest(url) {
  return (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('googleapis.com')
  );
}

function cachedShellForNavigation(request) {
  const url = new URL(request.url);
  const isResident = url.pathname.endsWith('/resident.html');
  const fallback = isResident ? './resident.html' : './index.html';

  return caches.match(request, { ignoreSearch: true })
    .then(hit => hit || caches.match(fallback, { ignoreSearch: true }));
}

function updateNavigationInBackground(request) {
  const url = new URL(request.url);
  const isResident = url.pathname.endsWith('/resident.html');
  const cacheKey = isResident ? './resident.html' : './index.html';

  return fetch(request)
    .then(response => {
      if (!response || !response.ok) return response;
      return caches.open(CACHE_NAME).then(cache => {
        cache.put(cacheKey, response.clone());
        return response;
      });
    })
    .catch(() => null);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Данные CRM и внешние библиотеки не кешируем этим worker'ом.
  if (isRemoteDataRequest(url)) return;

  // Навигация: мгновенно показываем локальную оболочку, сеть обновляет кеш в фоне.
  if (request.mode === 'navigate') {
    event.respondWith(
      cachedShellForNavigation(request).then(cached => {
        if (cached) {
          event.waitUntil(updateNavigationInBackground(request));
          return cached;
        }
        return fetch(request);
      })
    );
    return;
  }

  // Статика: cache-first. Сеть тихо обновляет копию для следующего запуска.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(cached => {
        const networkUpdate = fetch(request)
          .then(response => {
            if (response && response.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkUpdate);
          return cached;
        }

        return networkUpdate.then(response => {
          if (response) return response;
          return caches.match(request, { ignoreSearch: true });
        });
      })
    );
  }
});
