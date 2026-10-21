// Service worker: la app funciona offline (caché de la interfaz).
// Sube VERSION en cada publicación para que los teléfonos tomen los cambios.
const VERSION = 'viaje-v3';
const FONTS = 'viaje-fonts';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/ui.js',
  'js/calc.js',
  'js/fx.js',
  'js/config.js',
  'js/sync.js',
  'js/sample.js',
  'js/views/budget.js',
  'js/views/register.js',
  'js/views/dashboard.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Mismo origen: responde desde caché y actualiza en segundo plano.
// Tipografía (Google Fonts): caché primero, para que se vea igual sin conexión.
// Otros orígenes (tasas de cambio): siempre red.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const host = new URL(req.url).hostname;
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit || cache.match('index.html'));
      return hit || net;
    }),
  );
});
