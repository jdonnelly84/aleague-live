// Service worker: keeps the app shell and club crests on the phone so it opens instantly and offline.
// Live data is never cached here (the app keeps its own saved copy in localStorage).
const CACHE = 'aleague-live-v1';
const CODES = ['ADL', 'AKL', 'BRI', 'CBR', 'CCM', 'MAC', 'MCY', 'MVC', 'NEW', 'PER', 'SYD', 'WEL', 'WSW'];
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  ...CODES.map(c => `crests/${c}.svg`)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // data feeds go straight to the network
  // Crests never change: cache first. Everything else: network first so updates show up, cache when offline.
  if (url.pathname.includes('/crests/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
