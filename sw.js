// Offline shell. Code is cache-first with background refresh; CSV data is network-first.
const CACHE = 'astro-lab-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'vendor/astronomy.browser.min.js',
  'src/app.js', 'src/jyotish.js', 'src/aspects.js', 'src/sarvatobhadra.js', 'src/features.js', 'src/rules.js',
  'src/model.js', 'src/backtest.js', 'src/data.js', 'src/live.js', 'src/settings.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
