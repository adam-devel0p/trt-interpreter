/* Offline app shell (Phase 00). Caches the chrome and the /offline page; journal content is
 * not cached yet. Cache name is versioned so a deploy invalidates the old shell. */
const CACHE = 'tarot-shell-v1';
const SHELL = ['/offline', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses or auth callbacks.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (req.mode === 'navigate') {
    // Network first for pages; offline shell as the fallback.
    event.respondWith(fetch(req).catch(() => caches.match('/offline')));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    // Immutable assets: cache first.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

/* Reminders (Phase 11). The payload is app-authored copy — dates and counts, never an entry's
 * words — plus a signed open link and a signed one-tap unsubscribe link. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  if (!data.title) return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || '',
      tag: data.tag || 'reminder',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url, unsubscribeUrl: data.unsubscribeUrl },
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'unsubscribe', title: 'Turn these off' },
      ],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  event.notification.close();
  if (event.action === 'unsubscribe' && data.unsubscribeUrl) {
    event.waitUntil(fetch(data.unsubscribeUrl, { credentials: 'omit' }).catch(() => undefined));
    return;
  }
  const url = data.url || '/home';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
