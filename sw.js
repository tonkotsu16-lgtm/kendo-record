// オフラインでもアプリ画面を開けるようにするための仕組み
// アプリを更新したときは VERSION の数字を1つ上げてください
const VERSION = 'v8';
const CACHE = 'kendo-record-' + VERSION;
const FILES = ['./', './index.html', './app.js', './config.js', './manifest.json',
               './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // 送受信はそのまま通す
  // ネット優先・つながらなければ保存済みの画面を使う
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
