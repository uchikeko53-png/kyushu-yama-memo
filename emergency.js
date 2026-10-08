// 緊急時の画面: 現在地(緯度経度・住所・コース上の位置)を出し、共有・コピーできるようにする
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cur = null, seq = 0;   // cur = 直近の位置の情報 / seq = 古い問い合わせの結果を捨てるための番号

  function dms(v, pos, neg) {
    var s = v >= 0 ? pos : neg; v = Math.abs(v);
    var d = Math.floor(v), m = Math.floor((v - d) * 60), x = ((v - d) * 60 - m) * 60;
    return d + '°' + String(m).padStart(2, '0') + "'" + x.toFixed(1) + '"' + s;
  }
  function two(n) { return String(n).padStart(2, '0'); }
  function stamp(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + two(d.getHours()) + ':' + two(d.getMinutes()); }
  function ago(ms) { var s = Math.round((Date.now() - ms) / 1000); return s < 90 ? s + '秒前' : Math.round(s / 60) + '分前'; }

  function build(p) { // 共有する文章
    var lat = p.lat.toFixed(5), lon = p.lon.toFixed(5), L = [];
    L.push('【現在地】山歩きメモ');
    L.push('日時: ' + stamp(p.t) + (p.stale ? '(' + ago(p.t) + 'に取得した位置)' : ''));
    L.push('緯度経度: ' + lat + ', ' + lon + '(誤差 約' + Math.round(p.acc) + 'm)');
    L.push('度分秒: ' + dms(p.lat, 'N', 'S') + ' ' + dms(p.lon, 'E', 'W'));
    if (p.alt != null) L.push('標高(GPS): 約' + Math.round(p.alt) + 'm');
    if (p.addr) L.push('住所の目安: ' + p.addr);
    if (p.route) L.push('コース: ' + p.route);
    L.push('地図: https://maps.google.com/?q=' + lat + ',' + lon);
    L.push('国土地理院: https://maps.gsi.go.jp/#17/' + lat + '/' + lon + '/');
    return L.join('\n');
  }
  function show() {
    var p = cur, box = $('em-pos');
    if (!p) return;
    box.className = 'posbox' + (p.stale ? ' stale' : '');
    box.innerHTML = '<div class="coord"></div><div class="kv" id="k1"></div><div class="kv" id="k2"></div><div class="kv" id="k3"></div><div class="kv" id="k4"></div><div class="kv" id="k5"></div>';
    function kv(id, k, v) { var e = $(id); e.innerHTML = '<b></b><span></span>'; e.firstChild.textContent = k; e.lastChild.textContent = v; e.hidden = !v; }
    box.querySelector('.coord').textContent = p.lat.toFixed(5) + ', ' + p.lon.toFixed(5);
    kv('k1', '度分秒', dms(p.lat, 'N', 'S') + ' ' + dms(p.lon, 'E', 'W'));
    kv('k2', '誤差', '約' + Math.round(p.acc) + 'm' + (p.alt != null ? ' ・ 標高(GPS) 約' + Math.round(p.alt) + 'm' : ''));
    kv('k3', '住所の目安', p.addr || (p.addrNote || ''));
    kv('k4', 'コース上', p.route || '');
    kv('k5', '取得', stamp(p.t) + (p.stale ? '(' + ago(p.t) + ')。いまの位置ではない可能性があります' : ''));
    $('em-text').value = build(p);
    var map = $('em-map'); map.href = 'https://maps.gsi.go.jp/#17/' + p.lat.toFixed(5) + '/' + p.lon.toFixed(5) + '/'; map.hidden = false;
  }

  function enrich(p, my) { // ルート上の位置と、住所を足す(通信できない場合は、住所なしで進む)
    try {
      if (window.yamaNearest) {
        var n = window.yamaNearest(p.lat, p.lon);
        if (n && n.d <= 200) p.route = n.course.name + '(登山口から約' + Math.round(n.m) + 'm の付近)';
      }
    } catch (e) {}
    show();
    if (!navigator.onLine) { p.addrNote = '通信できないため、住所は出ません。緯度経度を伝えてください'; show(); return; }
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 7000);
    fetch('https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=' + p.lat + '&lon=' + p.lon, { signal: ctl.signal })
      .then(function (r) { return r.json(); }).then(function (j) {
        clearTimeout(to); if (my !== seq) return;
        var r = j && j.results;
        if (r && r.muniCd) { p.addr = ((window.MUNI && window.MUNI[r.muniCd]) || '') + (r.lv01Nm ? ' ' + r.lv01Nm : ''); p.addr = p.addr.trim(); }
        else p.addrNote = '住所は取得できませんでした(山の中などの場所です)';
        show();
      }).catch(function () { clearTimeout(to); if (my !== seq) return; p.addrNote = '住所を取得できませんでした。緯度経度を伝えてください'; show(); });
  }

  function locate() {
    var my = ++seq, box = $('em-pos');
    $('em-msg').textContent = '';
    if (!cur) box.innerHTML = '<p class="small">現在地を調べています(最長20秒)…</p>';
    function fromLast() { // GPSが取れなかったときは、アプリが覚えている最後の位置を使う
      var l = window.yamaLast && window.yamaLast();
      if (l) { cur = { lat: l[0], lon: l[1], acc: l[2] || 30, alt: null, t: Date.now() - 1, stale: true }; enrich(cur, my); $('em-msg').textContent = '新しい位置を取得できませんでした。覚えていた位置を表示しています。'; }
      else { box.innerHTML = '<p class="small">位置を取得できませんでした。空の開けた場所で「もう一度調べる」を押してください。位置情報の許可も確認してください。</p>'; }
    }
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') { fromLast(); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (my !== seq) return;
      cur = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, alt: pos.coords.altitude, t: pos.timestamp || Date.now(), stale: false };
      enrich(cur, my);
    }, function () { if (my === seq) fromLast(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  $('em-again').addEventListener('click', locate);
  $('em-share').addEventListener('click', function () {
    var t = $('em-text').value; if (!t) { $('em-msg').textContent = 'まだ位置がありません。'; return; }
    if (navigator.share) {
      navigator.share({ title: '現在地(山歩きメモ)', text: t }).catch(function (e) { if (e && e.name !== 'AbortError') $('em-msg').textContent = '共有できませんでした。「コピー」を使ってください。'; });
    } else { copy(); }
  });
  function copy() {
    var t = $('em-text').value; if (!t) { $('em-msg').textContent = 'まだ位置がありません。'; return; }
    function fallback() { var a = $('em-text'); a.focus(); a.select(); try { document.execCommand('copy'); $('em-msg').textContent = 'コピーしました。'; } catch (e) { $('em-msg').textContent = '下の文章を、長押ししてコピーしてください。'; } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { $('em-msg').textContent = 'コピーしました。メッセージなどに貼り付けて送れます。'; }, fallback); else fallback();
  }
  $('em-copy').addEventListener('click', copy);

  window.addEventListener('yama:tab', function (e) { if (e.detail === 'emergency') locate(); });
  window.Yama && window.Yama.onCourse && window.Yama.onCourse(function () { /* コースが変わっても、位置は変えない */ });
})();
