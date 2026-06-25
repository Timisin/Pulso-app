const CACHE_NAME = 'pulso-cache-v1';
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the html (so updates show up), cache-first for everything else
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});

/* ============================================================
   HABIT REMINDERS — best-effort background check
   ============================================================
   Real push (works with the app fully closed) needs a backend
   push service. Without one, this worker can only act:
   - when the OS/browser wakes it via Periodic Background Sync
     (Chrome/Android only, and only if the PWA is installed and
     used often enough for the browser to grant it), or
   - when the page itself asks the worker to check (visibility/
     focus/interval), via postMessage below.
   This means reminders fire reliably while the app or browser is
   open or recently backgrounded, but are not guaranteed if the
   app is fully closed or the device is asleep for a long time.
*/

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function checkHabitsAndNotify(habits) {
  if (!habits || !Array.isArray(habits)) return;
  const now = new Date();
  const nowHM = now.toTimeString().slice(0, 5);
  const today = todayISO();
  let changed = false;

  for (const h of habits) {
    if (!h.reminder) continue;
    if (h.log && h.log[today]) continue;
    if (h.lastNotified === today) continue;
    if (h.reminderTime && nowHM >= h.reminderTime) {
      try {
        await self.registration.showNotification('Pulso · Recordatorio de hábito', {
          body: `${h.emoji || ''} ${h.name} — aún no lo marcas hoy.`,
          icon: './icons/icon-192.png',
          badge: './icons/icon-96.png',
          tag: 'habit-' + h.id,
          renotify: false
        });
      } catch (e) { /* ignore */ }
      h.lastNotified = today;
      changed = true;
    }
  }

  if (changed) {
    const clientsList = await self.clients.matchAll();
    clientsList.forEach((client) => client.postMessage({ type: 'HABITS_UPDATED', habits }));
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_HABITS') {
    checkHabitsAndNotify(event.data.habits);
  }
});

// Periodic Background Sync (Chrome/Android, installed PWAs only — best effort)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'habit-reminder-check') {
    event.waitUntil(
      self.clients.matchAll().then((clientsList) => {
        if (clientsList.length > 0) {
          clientsList.forEach((c) => c.postMessage({ type: 'REQUEST_HABITS_FOR_CHECK' }));
        }
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
