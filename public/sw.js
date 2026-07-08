const DEFAULT_NOTIFICATION_URL = '/redeem';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (_error) {
    data = {
      title: 'WowLife',
      body: event.data ? event.data.text() : 'Новое уведомление'
    };
  }

  const title = data.title || 'WowLife';
  const options = {
    body: data.body || 'Новое уведомление',
    icon: data.icon || '/assets/pwa-icon-192.png',
    badge: data.badge || '/assets/pwa-badge-96.png',
    tag: data.tag || 'wakesurf-certificates',
    renotify: true,
    data: {
      url: data.url || DEFAULT_NOTIFICATION_URL
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || DEFAULT_NOTIFICATION_URL,
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }

        if ('navigate' in client && 'focus' in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
