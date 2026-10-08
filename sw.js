// アプリ本体と、保存した地図タイルを端末に持たせるための Service Worker
var APP = 'yama-app-v15';
var TILES = 'yama-tiles-v1';
var SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'index.html', 'style.css', 'app.js', 'offline.js', 'db.js', 'courses.js', 'log.js', 'routes.js', 'nav.js', 'track.js', 'plan.js', 'munis.js', 'emergency.js',
  'lib/leaflet.min.js', 'lib/leaflet.min.css',
  'lib/images/layers.png', 'lib/images/layers-2x.png', 'lib/images/marker-icon.png', 'lib/images/marker-icon-2x.png', 'lib/images/marker-shadow.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(APP).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== APP && k !== TILES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 地図タイル: 保存済みならそれを返し、なければ通信する(保存はしない。保存は「保存」ボタンのときだけ)
  if (url.hostname === 'cyberjapandata.gsi.go.jp') {
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(req.url).then(function (hit) {
        return hit || fetch(req).catch(function () { return Response.error(); });
      });
    }));
    return;
  }

  // アプリ本体: 通信できればそちら、だめなら保存分(更新が反映されやすい)
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      if (res.ok) caches.open(APP).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }); }));
  }
});
