// 歩いた軌跡の記録。軌跡は「ルートの線」とは別に保存し、ルートを自動では書き換えない(迷った道を含むことがあるため)。
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MIN_ACC = 60;      // これより精度が悪い位置は捨てる(m)
  var MIN_STEP = 4;      // これ未満しか動いていなければ追加しない(m)
  var GAP_S = 120;       // これ以上間があいたら「途切れ」とする(秒)
  var SAVE_EVERY = 8;    // 何点ごとに端末へ保存するか

  function hav(a, b) {
    var R = 6371000, p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dl = (b[1] - a[1]) * Math.PI / 180, dp = p2 - p1;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function segments(points) { // 途切れで分けた線のリスト
    var segs = [], cur = [];
    points.forEach(function (p, i) {
      if (i && (p[2] - points[i - 1][2]) / 1000 > GAP_S) { if (cur.length) segs.push(cur); cur = []; }
      cur.push(p);
    });
    if (cur.length) segs.push(cur);
    return segs;
  }
  function stats(t) {
    var segs = segments(t.points), m = 0;
    segs.forEach(function (s) { for (var i = 1; i < s.length; i++) m += hav(s[i - 1], s[i]); });
    var end = t.end || (t.points.length ? t.points[t.points.length - 1][2] : t.start);
    return { distKm: Math.round(m / 100) / 10, min: Math.max(0, Math.round((end - t.start) / 60000)), gaps: Math.max(0, segs.length - 1), n: t.points.length };
  }
  function fmtDT(ms) { var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); }; return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  window.Track = {
    stats: stats, fmtDT: fmtDT,
    summary: function (t) { var s = stats(t); return { distKm: s.distKm, min: s.min, gaps: s.gaps, start: t.start }; },
    forCourse: function (id) { return window.TrackDB.all().then(function (l) { return l.filter(function (t) { return t.courseId === id && t.status === 'done'; }); }); }
  };

  var map = window.yamaMap, layer = L.layerGroup().addTo(map);
  var shown = {};          // 地図に出している軌跡 id -> true
  var rec = null, watchId = null, wake = null, since = 0, liveLine = null, skipped = 0, timer = null;

  // ---- 地図に描く
  function draw(list) {
    layer.clearLayers();
    list.forEach(function (t) {
      if (!shown[t.id]) return;
      segments(t.points).forEach(function (s) {
        L.polyline(s.map(function (p) { return [p[0], p[1]]; }), { color: '#7a3fd0', weight: 4, opacity: .85, dashArray: t.status === 'recording' ? '2 6' : null }).addTo(layer);
      });
    });
  }
  function refresh() {
    return window.TrackDB.all().then(function (all) {
      var id = window.Yama.course.id, mine = all.filter(function (t) { return t.courseId === id; });
      draw(mine); renderList(mine);
      fillSelect(all.filter(function (t) { return t.courseId === $('lf-course').value; })); // 記録フォームで選んでいるコースの軌跡
      return mine;
    });
  }

  // ---- 一覧
  function gpx(t) {
    var pts = t.points.map(function (p) {
      return '<trkpt lat="' + p[0] + '" lon="' + p[1] + '">' + (p[4] != null ? '<ele>' + p[4] + '</ele>' : '') + '<time>' + new Date(p[2]).toISOString() + '</time></trkpt>';
    });
    var name = (window.Yama.course.name + ' ' + fmtDT(t.start)).replace(/[<>&]/g, '');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="九州 山歩きメモ" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' + name + '</name><trkseg>' + pts.join('') + '</trkseg></trk></gpx>';
  }
  function renderList(mine) {
    var box = $('trk-list'); box.innerHTML = '';
    mine.filter(function (t) { return t.status === 'done'; }).forEach(function (t) {
      var s = stats(t), el = document.createElement('div'); el.className = 'trk';
      el.innerHTML = '<div class="t"></div><div class="walk"></div><div class="row"></div>';
      el.querySelector('.t').textContent = fmtDT(t.start) + ' に歩いた軌跡';
      el.querySelector('.walk').textContent = '距離 ' + s.distKm.toFixed(1) + 'km ・ 時間 ' + window.fmtMin(s.min) + (s.gaps ? ' ・ 途切れ ' + s.gaps + '回' : '') + ' ・ ' + s.n + '点';
      var row = el.querySelector('.row');
      function btn(text, cls, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'mini' + (cls ? ' ' + cls : ''); b.textContent = text; b.addEventListener('click', fn); row.appendChild(b); return b; }
      btn(shown[t.id] ? '地図から隠す' : '地図に表示', '', function () { shown[t.id] = !shown[t.id]; refresh(); });
      btn('GPXで書き出し', '', function () {
        var a = document.createElement('a'), u = URL.createObjectURL(new Blob([gpx(t)], { type: 'application/gpx+xml' }));
        a.href = u; a.download = 'yama-' + new Date(t.start).toISOString().slice(0, 10) + '.gpx'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
      });
      var del = btn('削除', 'danger', function () {
        if (del.dataset.ok) { window.TrackDB.remove(t.id).then(refresh); return; }
        del.dataset.ok = '1'; del.textContent = 'もう一度押すと削除';
        setTimeout(function () { delete del.dataset.ok; del.textContent = '削除'; }, 4000);
      });
      box.appendChild(el);
    });
  }
  // 記録フォームの「歩いた軌跡を添付」の選択肢
  function fillSelect(mine) {
    var sel = $('lf-track'); if (!sel) return;
    var keep = sel.value;
    sel.innerHTML = '<option value="">添付しない</option>';
    mine.filter(function (t) { return t.status === 'done'; }).forEach(function (t) {
      var s = stats(t), o = document.createElement('option'); o.value = t.id;
      o.textContent = fmtDT(t.start) + '(' + s.distKm.toFixed(1) + 'km・' + window.fmtMin(s.min) + ')'; sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  }

  // ---- 記録の開始と終了
  function live() {
    if (!rec) { $('trk-live').textContent = ''; return; }
    var s = stats(rec);
    $('trk-live').textContent = '記録中 ' + s.distKm.toFixed(1) + 'km ・ ' + window.fmtMin(s.min) + ' ・ ' + s.n + '点' + (skipped ? ' ・ 精度が悪く除外 ' + skipped + '点' : '') + (wake ? '' : ' ・ 画面は消えることがあります');
  }
  function lockScreen() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; live(); }); live(); }).catch(function () { wake = null; });
  }
  document.addEventListener('visibilitychange', function () { if (rec && document.visibilityState === 'visible' && !wake) lockScreen(); });

  function onPos(p) {
    if (!rec) return;
    var acc = p.coords.accuracy, ll = [p.coords.latitude, p.coords.longitude];
    if (window.yamaShowPos) window.yamaShowPos(ll[0], ll[1], acc, false);
    if (acc > MIN_ACC) { skipped++; live(); return; }
    var last = rec.points[rec.points.length - 1], t = p.timestamp || Date.now();
    if (last && hav(last, ll) < MIN_STEP && (t - last[2]) < 30000) return;
    rec.points.push([+ll[0].toFixed(6), +ll[1].toFixed(6), t, Math.round(acc), p.coords.altitude != null ? Math.round(p.coords.altitude) : null]);
    shown[rec.id] = true; draw([rec]); live();
    if (++since >= SAVE_EVERY) { since = 0; window.TrackDB.put(rec); }
  }
  function onErr(err) {
    $('trk-live').textContent = err.code === 1 ? '位置情報が許可されていません。ブラウザの設定で許可してください。' : '位置を取得できません。空の開けた場所で試してください。';
  }
  function watch() {
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    lockScreen(); timer = setInterval(live, 15000);
    $('trk-btn').textContent = '記録を終了して保存'; $('trk-btn').classList.add('rec');
  }
  function start(existing) {
    if (!navigator.geolocation) { $('trk-live').textContent = 'この端末では位置情報を使えません。'; return; }
    rec = existing || { id: 't' + Date.now().toString(36), courseId: window.Yama.course.id, start: Date.now(), points: [], status: 'recording' };
    skipped = 0; since = 0; shown[rec.id] = true;
    window.TrackDB.put(rec).then(function () { watch(); live(); });
  }
  function stop(discard) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null;
    if (timer) clearInterval(timer); timer = null;
    if (wake) { try { wake.release(); } catch (e) {} wake = null; }
    var t = rec; rec = null;
    $('trk-btn').textContent = '軌跡の記録を始める'; $('trk-btn').classList.remove('rec'); $('trk-live').textContent = '';
    if (!t) return Promise.resolve();
    if (discard || t.points.length < 2) { return window.TrackDB.remove(t.id).then(refresh).then(function () { $('trk-live').textContent = t.points.length < 2 ? '点が少なかったため、保存しませんでした。' : ''; }); }
    t.status = 'done'; t.end = t.points[t.points.length - 1][2];
    return window.TrackDB.put(t).then(refresh).then(function () { $('trk-live').textContent = '軌跡を保存しました。記録を書くときに、添付できます。'; });
  }
  $('trk-btn').addEventListener('click', function () { if (rec) stop(false); else start(null); });

  // ---- 前回、終わらせずに閉じた記録があるとき
  function checkUnfinished() {
    return window.TrackDB.all().then(function (all) {
      var u = all.filter(function (t) { return t.status === 'recording'; })[0], box = $('trk-resume');
      if (!u || rec) { box.hidden = true; return; }
      var s = stats(u), c = window.courseById(u.courseId);
      box.hidden = false;
      box.innerHTML = '<div></div><div class="row"></div>';
      box.firstChild.textContent = '終わっていない軌跡があります(' + (c ? c.name : '') + '、' + fmtDT(u.start) + '、' + s.distKm.toFixed(1) + 'km)。';
      var row = box.lastChild;
      [['続けて記録する', function () { if (c) window.Yama.select(c.id); start(u); box.hidden = true; }],
       ['ここまでで保存する', function () { u.status = 'done'; u.end = u.points.length ? u.points[u.points.length - 1][2] : u.start; window.TrackDB.put(u).then(function () { box.hidden = true; refresh(); }); }],
       ['破棄する', function () { window.TrackDB.remove(u.id).then(function () { box.hidden = true; refresh(); }); }]].forEach(function (b) {
        var e = document.createElement('button'); e.type = 'button'; e.className = 'mini'; e.textContent = b[0]; e.addEventListener('click', b[1]); row.appendChild(e);
      });
    });
  }

  $('lf-course').addEventListener('change', function () { refresh(); });
  window.Yama.onCourse(function () { refresh(); });
  window.addEventListener('yama:tab', function (e) { if (e.detail === 'map' || e.detail === 'log') refresh(); });
  refresh().then(checkUnfinished);
})();
