// Отдельный service worker только для Firebase Cloud Messaging.
// Он не контролирует страницы CRM, поэтому загрузка Firebase не тормозит запуск приложения.
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAu_IiktVtl7VQRLowbdb0zJ_slOkVK_NA',
  authDomain: 'nashdom-crm.firebaseapp.com',
  projectId: 'nashdom-crm',
  storageBucket: 'nashdom-crm.firebasestorage.app',
  messagingSenderId: '412290588017',
  appId: '1:412290588017:web:2fc4d1cb4d47ffd52c2ad0'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const notification = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(
    notification.title || 'Новая заявка',
    {
      body: notification.body || '',
      icon: '../icon-192.png',
      badge: '../icon-192.png',
      tag: 'resident-' + (data.requestId || Date.now()),
      requireInteraction: data.emergency === '1',
      data: { url: new URL('../', self.registration.scope).href }
    }
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : new URL('../', self.registration.scope).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
