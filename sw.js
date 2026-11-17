const CACHE = 'kakeibo-v9';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // 開いている画面を新しい版で開き直す
    const cs = await self.clients.matchAll({ type: 'window' });
    cs.forEach(c => c.navigate(c.url).catch(() => {}));
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isPage && url.searchParams.has('fresh')) {
    // 更新の確認：必ずネットから取り、取れたら保存し直す
    e.respondWith((async () => {
      const r = await fetch(url.pathname, { cache: 'no-store' });
      if (r.ok) (await caches.open(CACHE)).put('./index.html', r.clone());
      return r;
    })());
    return;
  }
  if (isPage) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      return (await c.match('./index.html')) || fetch(req, { cache: 'no-store' });
    })());
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
