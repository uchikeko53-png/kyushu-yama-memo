(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TILES = 'yama-tiles-v1';
  var GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';
  var MARGIN_M = 800;          // ルートの外側に足す余白
  var ZOOMS = [12, 13, 14, 15, 16, 17, 18];
  var MAX_TILES = 2000;        // 国土地理院への負荷を抑えるための上限

  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    $('off-msg').textContent = 'このブラウザでは地図の保存を使えません。';
    $('off-save').disabled = true;
    return;
  }
  navigator.serviceWorker.register('sw.js').catch(function () {
    $('off-msg').textContent = '地図の保存を準備できませんでした。http://localhost か https のページで開いてください。';
    $('off-save').disabled = true;
  });

  // ---- コースごとの、保存した印(どのコースの地図を保存したか)
  function savedIds() { try { return JSON.parse(localStorage.getItem('yama-saved') || '[]') || []; } catch (e) { return []; } }
  function setSavedIds(a) { try { localStorage.setItem('yama-saved', JSON.stringify(a)); } catch (e) {} }

  // ---- 保存する範囲(ルートの外接四角形 + 余白)のタイル一覧
  function bounds(course) {
    var line = course.route.line;
    var la = line.map(function (p) { return p[0]; }), lo = line.map(function (p) { return p[1]; });
    var mLat = MARGIN_M / 110540, mLon = MARGIN_M / (111320 * Math.cos(la[0] * Math.PI / 180));
    return { s: Math.min.apply(null, la) - mLat, n: Math.max.apply(null, la) + mLat,
             w: Math.min.apply(null, lo) - mLon, e: Math.max.apply(null, lo) + mLon };
  }
  function tx(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function ty(lat, z) {
    var r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  }
  function tileList(course, withPhoto) {
    var b = bounds(course), out = [];
    ZOOMS.forEach(function (z) {
      for (var x = tx(b.w, z); x <= tx(b.e, z); x++) {
        for (var y = ty(b.n, z); y <= ty(b.s, z); y++) {
          out.push(GSI + 'std/' + z + '/' + x + '/' + y + '.png');
          if (withPhoto && z >= 14) out.push(GSI + 'seamlessphoto/' + z + '/' + x + '/' + y + '.jpg');
        }
      }
    });
    return out;
  }
  function mb(n) { return (n / 1048576).toFixed(1) + 'MB'; }
  function estimate(course) {
    var list = tileList(course, $('off-photo').checked);
    var photo = list.filter(function (u) { return u.indexOf('/seamlessphoto/') > 0; }).length;
    return { n: list.length, bytes: (list.length - photo) * 20480 + photo * 30720 };
  }
  function refreshEstimate() {
    var c = window.Yama.course, e = estimate(c);
    $('off-title').textContent = '「' + c.name + '」の地図を端末に保存(圏外用)';
    $('off-est').textContent = '保存する枚数: ' + e.n + '枚(約' + mb(e.bytes) + ')。拡大は標準地図で最大の倍率まで、写真は14段階目以上で保存します。';
  }
  $('off-photo').addEventListener('change', function () { refreshEstimate(); });

  // ---- このコースの保存状況(保存済みの枚数を数える)
  function refreshSaved() {
    var c = window.Yama.course, list = tileList(c, false), badge = $('off-badge');
    return caches.open(TILES).then(function (cache) {
      return Promise.all(list.map(function (u) { return cache.match(u).then(function (h) { return h ? 1 : 0; }); }));
    }).then(function (r) {
      if (window.Yama.course !== c) return; // 数えている間に別のコースへ切り替わった
      var n = r.reduce(function (a, b) { return a + b; }, 0), ids = savedIds().filter(function (i) { return i !== c.id; });
      if (n === list.length) { badge.textContent = '保存済み'; badge.className = 'chip ok'; if (savedIds().indexOf(c.id) < 0) setSavedIds(ids.concat(c.id)); }
      else if (n > 0) { badge.textContent = '一部のみ保存(' + n + '/' + list.length + '枚)'; badge.className = 'chip'; }
      else { badge.textContent = '未保存'; badge.className = 'chip'; setSavedIds(ids); }
      $('off-del').hidden = n === 0;
      if (n && navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (s) { $('off-used').textContent = '端末の使用量(すべてのコース合計): 約' + mb(s.usage || 0); });
      } else $('off-used').textContent = '';
    }).catch(function () { badge.textContent = '保存状況を確認できません'; badge.className = 'chip'; });
  }

  // ---- 保存(同時4件まで)
  var running = false;
  $('off-save').addEventListener('click', function () {
    if (running) return;
    var c = window.Yama.course, list = tileList(c, $('off-photo').checked);
    if (list.length > MAX_TILES) { $('off-msg').textContent = '枚数が多すぎます(上限' + MAX_TILES + '枚)。'; return; }
    if (!navigator.onLine) { $('off-msg').textContent = '通信できません。Wi-Fi につないでから保存してください。'; return; }
    running = true; $('off-save').disabled = true;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    var done = 0, fail = 0, i = 0, total = list.length;
    $('off-msg').textContent = '保存しています…';
    caches.open(TILES).then(function (cache) {
      function worker() {
        if (i >= total) return Promise.resolve();
        var url = list[i++];
        return cache.match(url).then(function (hit) {
          if (hit) return;
          return fetch(url, { mode: 'cors' }).then(function (r) {
            if (r.ok) return cache.put(url, r); fail++;
          }).catch(function () { fail++; });
        }).then(function () {
          done++; $('off-bar').style.width = (done / total * 100) + '%';
          $('off-msg').textContent = '保存しています… ' + done + ' / ' + total;
          return worker();
        });
      }
      return Promise.all([worker(), worker(), worker(), worker()]);
    }).then(function () {
      running = false; $('off-save').disabled = false;
      $('off-msg').textContent = fail ? '保存しました(取得できなかった ' + fail + '枚あり。もう一度押すと続きを保存します)。'
        : '保存しました。圏外でも、この範囲の地図を見られます。';
      return refreshSaved();
    });
  });

  // ---- 削除(ほかの保存済みコースが使っているタイルは残す)
  $('off-del').addEventListener('click', function () {
    var c = window.Yama.course, keep = {};
    savedIds().filter(function (i) { return i !== c.id; }).forEach(function (id) {
      var o = window.courseById(id); if (o) tileList(o, true).forEach(function (u) { keep[u] = 1; });
    });
    var mine = tileList(c, true).filter(function (u) { return !keep[u]; });
    caches.open(TILES).then(function (cache) { return Promise.all(mine.map(function (u) { return cache.delete(u); })); })
      .then(function () {
        setSavedIds(savedIds().filter(function (i) { return i !== c.id; }));
        $('off-bar').style.width = '0'; $('off-msg').textContent = 'このコースの保存した地図を削除しました。';
        return refreshSaved();
      });
  });

  function net() { $('off-net').textContent = navigator.onLine ? '通信: あり' : '通信: なし(保存した地図を表示中)'; }
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  window.Yama.onCourse(function () { $('off-bar').style.width = '0'; $('off-msg').textContent = '出発前に、Wi-Fi につないだ状態で保存してください。'; refreshEstimate(); refreshSaved(); });
  refreshEstimate(); refreshSaved();
  window.addEventListener('yama:saved-refresh', refreshSaved);
})();
