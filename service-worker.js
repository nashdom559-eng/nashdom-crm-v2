const CACHE_NAME = 'nashdom-crm-v2.0.5';

// Оболочка PWA запускается из локального кеша. v2.0.5 сохраняет быстрый
// offline-first старт и добавляет длинную диктовку до ручной остановки.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './voice-patch.js',
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
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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

const FAST_DATA_PATCH = String.raw`
(function(){
  if (window.__nashdomFastDataV205) return;
  window.__nashdomFastDataV205 = true;

  function readCacheEntry(){
    try {
      var item = JSON.parse(localStorage.getItem('nashdom_app_data_cache_v1') || 'null');
      return item && item.data ? item : null;
    } catch(e) { return null; }
  }

  function ageText(savedAt){
    if (!savedAt) return '';
    var sec = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
    if (sec < 60) return 'только что';
    var min = Math.round(sec / 60);
    if (min < 60) return min + ' мин назад';
    var h = Math.round(min / 60);
    if (h < 24) return h + ' ч назад';
    return Math.round(h / 24) + ' дн назад';
  }

  function quietStatus(text, error){
    try { if (typeof showStatus === 'function') showStatus(text || '', !!error); } catch(e) {}
  }

  function applyCachedImmediately(){
    var entry = readCacheEntry();
    if (!entry) return null;
    try {
      if (typeof applyAppData === 'function') applyAppData(entry.data);
      if (typeof restoreNewRequestDraft === 'function') restoreNewRequestDraft();
    } catch(e) {}
    return entry;
  }

  function networkRefresh(silent, hadCache){
    var settled = false;
    var slowTimer = setTimeout(function(){
      if (!settled && hadCache && !silent) {
        quietStatus('⚡ Показаны сохранённые данные · сервер обновляется в фоне');
      }
    }, 2500);

    try {
      apiCall('getAppData', null, function(data){
        settled = true;
        clearTimeout(slowTimer);
        try {
          if (typeof applyAppData === 'function') applyAppData(data);
          if (typeof saveCachedAppData === 'function') saveCachedAppData(CRM.data);
          if (typeof restoreNewRequestDraft === 'function') restoreNewRequestDraft();
        } catch(e) {}
        if (!silent) quietStatus('');
      }, function(error){
        settled = true;
        clearTimeout(slowTimer);
        if (hadCache) {
          if (!silent) quietStatus('📴 Работаю по сохранённым данным · сервер временно недоступен');
        } else if (!silent) {
          quietStatus('Ошибка загрузки: ' + error, true);
        }
      });
    } catch(e) {
      settled = true;
      clearTimeout(slowTimer);
      if (!hadCache && !silent) quietStatus('Ошибка загрузки: ' + (e.message || e), true);
    }
  }

  loadData = function(options){
    var silent = !!(options && options.silent);
    var entry = applyCachedImmediately();
    var hadCache = !!entry;

    if (hadCache && !silent) {
      quietStatus('⚡ Последние данные: ' + ageText(entry.savedAt));
    }

    if (!navigator.onLine) {
      if (hadCache) {
        if (!silent) quietStatus('📴 Офлайн · показаны данные ' + ageText(entry.savedAt));
      } else if (!silent) {
        quietStatus('📴 Нет интернета. Новую заявку можно сохранить — она отправится позже.', true);
      }
      return;
    }

    setTimeout(function(){ networkRefresh(silent, hadCache); }, hadCache ? 120 : 0);
  };

  document.addEventListener('DOMContentLoaded', function(){
    var subtitle = document.querySelector('.subtitle');
    if (subtitle) {
      Array.from(subtitle.childNodes).forEach(function(node){
        if (node.nodeType === Node.TEXT_NODE) {
          node.nodeValue = node.nodeValue.replace(/v2\.0\.[0-9]+/,'v2.0.5');
        }
      });
    }
  });
})();
`;

async function injectRuntimePatches(response, requestUrl) {
  if (!response) return response;
  const url = new URL(requestUrl);
  if (url.pathname.endsWith('/resident.html')) return response;

  try {
    let html = await response.text();

    if (!html.includes('__nashdomFastDataV205')) {
      html = html.replace('</body>', '<script>' + FAST_DATA_PATCH + '<\/script></body>');
    }

    if (!html.includes('voice-patch.js')) {
      html = html.replace('</body>', '<script src="./voice-patch.js?v=2.0.5"></script></body>');
    }

    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (e) {
    return response;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isRemoteDataRequest(url)) return;

  if (request.mode === 'navigate') {
    event.waitUntil(updateNavigationInBackground(request));
    event.respondWith((async () => {
      const cached = await cachedShellForNavigation(request);
      if (cached) return injectRuntimePatches(cached, request.url);
      const network = await fetch(request);
      return injectRuntimePatches(network, request.url);
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then(response => {
              if (response && response.ok) {
                return caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
              }
            })
            .catch(() => null)
        );
        return cached;
      }

      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const clone = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, clone)));
        }
        return response;
      } catch (e) {
        return caches.match(request, { ignoreSearch: true });
      }
    })());
  }
});
