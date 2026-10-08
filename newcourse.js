// 新しいコースの仮登録: 地図で登山口と山頂を選び、道を自動でたどる(または手で線を引く)。
// 作ったコースは「仮」として、この端末の中に保存する。
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var root = $('v-newcourse');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var st = { th: null, top: null, draw: [], route: null, mode: 'th', source: '', run: 0 };
  var map = null, thM = null, topM = null, drawLine = null, routeLine = null, status, saveBtn;

  // ---- 座標の読み取り(Googleマップの「35.123, 139.456」や、度分秒の形)
  function parseCoord(s) {
    s = (s || '').replace(/[，、]/g, ',').trim();
    var m = s.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    var d = s.match(/(\d+)\s*°\s*(\d+)\s*['′’]\s*([\d.]+)\s*["″”]?\s*([NS])[\s,]*(\d+)\s*°\s*(\d+)\s*['′’]\s*([\d.]+)\s*["″”]?\s*([EW])/i);
    var lat, lon;
    if (d) {
      lat = (+d[1] + d[2] / 60 + d[3] / 3600) * (/s/i.test(d[4]) ? -1 : 1); lon = (+d[5] + d[6] / 60 + d[7] / 3600) * (/w/i.test(d[8]) ? -1 : 1);
    } else if (m) { lat = +m[1]; lon = +m[2]; } else return null;
    // 九州と、その周辺の範囲だけ受け付ける(入力ミスを防ぐ)
    if (lat < 28 || lat > 35 || lon < 127 || lon > 133) return null;
    return [lat, lon];
  }

  function build() {
    root.innerHTML = '';
    var sec = el('section', 'panel nc');
    var back = el('button', 'mini', '← コース一覧にもどる'); back.type = 'button'; back.id = 'nc-back'; sec.appendChild(back);
    sec.appendChild(el('p', 'small', '行きたい山の「仮のコース」を、スマホの中でつくります。地図で、登山口と山頂を選ぶと、OpenStreetMap の道をたどって、ルートの下書きができます。道がつながらない山は、手で線を引けます。仮のコースは、この端末だけに保存されます。'));

    var form = el('div', 'logform');
    function field(label, id, ph, type) { var l = el('label'); l.appendChild(document.createTextNode(label)); var i = el('input'); i.type = type || 'text'; i.id = id; i.placeholder = ph || ''; l.appendChild(i); form.appendChild(l); return i; }
    field('コース名', 'nc-name', '例: 由布岳 正面登山口');
    field('地域(任意)', 'nc-area', '例: 大分県 由布市');
    var kl = el('label'); kl.appendChild(document.createTextNode('コースの形'));
    var ks = el('select'); ks.id = 'nc-kind';
    [['roundtrip', '往復(登って、同じ道をもどる)'], ['loop', '周回(行きと帰りで、別の道を通る)']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; ks.appendChild(op); });
    kl.appendChild(ks); form.appendChild(kl);
    field('山頂・折り返し地点の名前', 'nc-top', '山頂');
    sec.appendChild(form);

    sec.appendChild(el('h2', null, '1. 場所を選ぶ'));
    var modes = el('div', 'row modes');
    [['th', '登山口を置く'], ['top', '山頂を置く'], ['draw', '手で線を引く']].forEach(function (m) {
      var b = el('button', 'mini', m[1]); b.type = 'button'; b.dataset.mode = m[0]; b.addEventListener('click', function () { setMode(m[0]); }); modes.appendChild(b);
    });
    sec.appendChild(modes);
    sec.appendChild(el('p', 'small')).id = 'nc-help';
    var mapbox = el('div', 'mapbox ncmap'); var m = el('div'); m.id = 'nc-map'; mapbox.appendChild(m); sec.appendChild(mapbox);

    var cr = el('div', 'row');
    var ci = el('input'); ci.id = 'nc-coord'; ci.placeholder = 'Googleマップの座標を貼り付け(例: 32.8146, 130.9390)'; ci.setAttribute('aria-label', '座標');
    ci.className = 'grow'; cr.appendChild(ci);
    var b1 = el('button', 'mini', '登山口にする'); b1.type = 'button'; var b2 = el('button', 'mini', '山頂にする'); b2.type = 'button';
    b1.addEventListener('click', function () { applyCoord('th'); }); b2.addEventListener('click', function () { applyCoord('top'); });
    cr.appendChild(b1); cr.appendChild(b2); sec.appendChild(cr);
    var tools = el('div', 'row');
    [['nc-here', 'いまの場所を登山口にする'], ['nc-undo', '手描きを1つ戻す'], ['nc-clear', 'すべてやり直す']].forEach(function (a) { var b = el('button', 'mini', a[1]); b.type = 'button'; b.id = a[0]; tools.appendChild(b); });
    sec.appendChild(tools);

    sec.appendChild(el('h2', null, '2. ルートをつくる'));
    var go = el('div', 'row');
    var auto = el('button', 'btn', '道を自動でたどる'); auto.type = 'button'; auto.id = 'nc-auto';
    var man = el('button', 'btn ghost', '手描きの線で、つくる'); man.type = 'button'; man.id = 'nc-manual';
    go.appendChild(auto); go.appendChild(man); sec.appendChild(go);
    status = el('div', 'status'); status.id = 'nc-status'; status.setAttribute('aria-live', 'polite'); status.textContent = '登山口と山頂を、地図で選んでください。'; sec.appendChild(status);

    sec.appendChild(el('h2', null, '3. 仮のコースとして保存'));
    saveBtn = el('button', 'btn', '仮のコースとして保存'); saveBtn.type = 'button'; saveBtn.id = 'nc-save'; saveBtn.disabled = true; sec.appendChild(saveBtn);
    sec.appendChild(el('p', 'small', '仮のコースには、「仮」の印が付きます。現地で歩いて確かめたら、コース一覧の「仮を外す」で、確定できます。ルートは自動で作った下書きです。登山道が通れるかどうかは、保証できません。必ず、現地の標識と公的な情報で確認してください。'));
    root.appendChild(sec);

    back.addEventListener('click', function () { window.showTab('courses'); });
    $('nc-auto').addEventListener('click', runAuto);
    $('nc-manual').addEventListener('click', runManual);
    $('nc-here').addEventListener('click', here);
    $('nc-undo').addEventListener('click', function () { st.draw.pop(); changed(); });
    $('nc-clear').addEventListener('click', function () { st.th = st.top = null; st.draw = []; st.route = null; setMode('th'); changed(); say('登山口と山頂を、地図で選んでください。'); });
    $('nc-kind').addEventListener('change', function () { changed(); });
    saveBtn.addEventListener('click', save);
  }

  function say(msg, cls) { status.className = 'status' + (cls ? ' ' + cls : ''); status.textContent = msg; }
  function setMode(m) {
    st.mode = m;
    root.querySelectorAll('.modes button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mode === m); });
    $('nc-help').textContent = { th: '地図をタップして、登山口の位置を置きます。', top: '地図をタップして、山頂(折り返す地点)を置きます。', draw: '登山口から順に、地図をタップして、歩く道を線でなぞります。曲がり角ごとにタップしてください。' }[m];
  }
  function initMap() {
    if (map) return;
    var c = window.Yama.course.route.points[0];
    map = L.map('nc-map', { zoomControl: true }).setView([c[0], c[1]], 12);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>' }).addTo(map);
    map.on('click', function (e) {
      var p = [e.latlng.lat, e.latlng.lng];
      if (st.mode === 'th') { st.th = p; setMode('top'); } else if (st.mode === 'top') { st.top = p; } else { st.draw.push(p); }
      changed();
    });
  }
  function dot(p, color, label, old) {
    if (old) { map.removeLayer(old); }
    var m = L.circleMarker(p, { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(map);
    m.bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8], className: 'lbl' }); return m;
  }
  function changed() { // 入力が変わったら、できたルートは無効にする
    st.route = null; st.run++; saveBtn.disabled = true;
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (thM) { map.removeLayer(thM); thM = null; } if (topM) { map.removeLayer(topM); topM = null; }
    if (st.th) thM = dot(st.th, '#2f5d46', '登山口');
    if (st.top) topM = dot(st.top, '#c4352b', $('nc-top').value.trim() || '山頂');
    if (drawLine) { map.removeLayer(drawLine); drawLine = null; }
    if (st.draw.length) drawLine = L.polyline(st.draw, { color: '#1f6fe0', weight: 4, dashArray: '2 8', opacity: .9 }).addTo(map);
  }
  function applyCoord(which) {
    var p = parseCoord($('nc-coord').value);
    if (!p) { say('座標を読み取れませんでした。Googleマップで長押しして出る数字(例: 32.8146, 130.9390)を貼り付けてください。九州の外の座標は受け付けません。', 'warn'); return; }
    if (which === 'th') { st.th = p; setMode('top'); } else st.top = p;
    changed(); map.setView(p, Math.max(map.getZoom(), 15)); $('nc-coord').value = '';
  }
  function here() {
    if (!navigator.geolocation) { say('この端末では位置情報を使えません。', 'warn'); return; }
    say('現在地を調べています…');
    navigator.geolocation.getCurrentPosition(function (p) { st.th = [p.coords.latitude, p.coords.longitude]; setMode('top'); changed(); map.setView(st.th, 16); say('いまの場所を、登山口にしました。山頂を、地図で選んでください。'); },
      function () { say('現在地を取得できませんでした。位置情報の許可を確認してください。', 'warn'); }, { enableHighAccuracy: true, timeout: 20000 });
  }

  var ERR = {
    far: '登山口と山頂が、離れすぎています(直線で7km以内にしてください)。',
    nodata: 'この付近に、道のデータがありません。「手で線を引く」で、つくってください。',
    'snap-th': '登山口の近く(200m以内)に、道のデータがありません。位置を少し動かすか、手で線を引いてください。',
    'snap-top': '山頂の近く(200m以内)に、道のデータがありません。位置を少し動かすか、手で線を引いてください。',
    gap: '登山口から山頂まで、道がつながっていませんでした(80m以上のすき間があります)。手で線を引いてください。',
    noroute: '登山口から山頂までの道が、見つかりませんでした。手で線を引いてください。',
    osm: '道のデータを取得できませんでした。通信を確認して、少し時間をおいてから、もう一度試してください。',
    elev: '標高を取得できませんでした。通信を確認して、もう一度試してください。'
  };
  function kind() { return $('nc-kind').value; }
  function topName() { return $('nc-top').value.trim() || '山頂'; }
  function finish(route, source, info) {
    st.route = route; st.source = source;
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(route.line, { color: '#d02a20', weight: 4, opacity: .8 }).addTo(map);
    if (drawLine) { map.removeLayer(drawLine); drawLine = null; }
    map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
    var s = window.courseStats(route);
    say('ルートができました。' + window.statLine(s) + (info || '') + ' 地図で、道に沿っているか、確かめてください。保存は、このあとです。', 'ok');
    saveBtn.disabled = false;
  }
  function runAuto() {
    if (!st.th || !st.top) { say('登山口と山頂を、地図で選んでください。', 'warn'); return; }
    var my = ++st.run; saveBtn.disabled = true; $('nc-auto').disabled = true;
    var k = kind(), name = topName();
    window.Routing.autoRoute(st.th, st.top, k, function (m) { if (my === st.run) say(m); }).then(function (r) {
      if (my !== st.run) throw new Error('stale');
      say('標高を取得しています…');
      return window.Routing.toRoute(r.line, k, name, r.topIdx, function (m) { if (my === st.run) say(m); }).then(function (route) {
        if (my !== st.run) throw new Error('stale');
        var info = r.gaps.length ? '(途切れた道を、直線でつないだ箇所が、' + r.gaps.length + 'あります)' : '';
        finish(route, 'auto', info);
      });
    }).catch(function (e) { if (e.message !== 'stale') say(ERR[e.message] || ('うまくいきませんでした(' + e.message + ')。もう一度試してください。'), 'warn'); })
      .then(function () { $('nc-auto').disabled = false; });
  }
  function runManual() {
    if (st.draw.length < 2) { say('「手で線を引く」を押して、登山口から順に、地図をタップしてください(2か所以上)。', 'warn'); return; }
    var my = ++st.run, k = kind(), name = topName(), line = window.Routing.densify(st.draw, 25), topIdx = line.length - 1;
    if (k === 'loop') {
      if (st.top) { var bd = 1e12; line.forEach(function (p, i) { var d = window.Routing.hav(p, st.top); if (d < bd) { bd = d; topIdx = i; } }); }
      else { var fd = -1; line.forEach(function (p, i) { var d = window.Routing.hav(p, line[0]); if (d > fd) { fd = d; topIdx = i; } }); }
    }
    saveBtn.disabled = true; $('nc-manual').disabled = true; say('標高を取得しています…');
    window.Routing.toRoute(line, k, name, topIdx, function (m) { if (my === st.run) say(m); }).then(function (route) {
      if (my !== st.run) return; finish(route, 'manual', '');
    }).catch(function (e) { say(ERR[e.message] || '標高を取得できませんでした。', 'warn'); }).then(function () { $('nc-manual').disabled = false; });
  }
  function save() {
    var name = $('nc-name').value.trim();
    if (!name) { say('コース名を入れてください。', 'warn'); $('nc-name').focus(); return; }
    if (!st.route) { say('先に、ルートをつくってください。', 'warn'); return; }
    var id = 'c' + Date.now().toString(36);
    var c = { id: id, name: name, area: $('nc-area').value.trim(), provisional: true, source: st.source, createdAt: Date.now(),
      note: (st.source === 'auto' ? 'OpenStreetMap の道から自動で作った、仮のルートです。' : '手で引いた、仮のルートです。') + '現地で確認してください。', route: st.route };
    if (!window.Custom.add(c)) { say('保存できませんでした。端末の空き容量や、ブラウザの設定を確認してください。', 'warn'); return; }
    try { localStorage.setItem('yama-course', id); } catch (e) {}
    say('仮のコースを保存しました。コース一覧に、追加します…', 'ok'); saveBtn.disabled = true;
    setTimeout(function () { location.reload(); }, 900);
  }

  // ---- コースの書き出し・読み込み(スマホの買い替え用)
  function exportCourses() {
    var l = window.Custom.list();
    if (!l.length) return false;
    var a = document.createElement('a'), u = URL.createObjectURL(new Blob([JSON.stringify({ app: 'yama-courses', version: 1, courses: l })], { type: 'application/json' }));
    a.href = u; a.download = 'yama-courses-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
    return l.length;
  }
  function importCourses(file, done) {
    file.text().then(function (t) {
      var d = JSON.parse(t); if (!d || d.app !== 'yama-courses' || !Array.isArray(d.courses)) throw new Error('format');
      var have = window.Custom.list(), ids = {}; have.forEach(function (c) { ids[c.id] = 1; });
      var add = d.courses.filter(function (c) { var r = c && c.route; return c && typeof c.id === 'string' && !ids[c.id] && r && Array.isArray(r.points) && Array.isArray(r.line) && Array.isArray(r.marks) && r.total > 0; });
      window.Custom.replaceAll(have.concat(add.map(function (c) { return { id: c.id, name: String(c.name || 'コース'), area: String(c.area || ''), note: String(c.note || ''), provisional: !!c.provisional, source: String(c.source || ''), createdAt: c.createdAt || Date.now(), route: c.route }; })));
      done(add.length);
    }).catch(function () { done(-1); });
  }
  window.CourseIO = { exportCourses: exportCourses, importCourses: importCourses };

  build();
  window.addEventListener('yama:tab', function (e) {
    if (e.detail !== 'newcourse') return;
    initMap(); setMode(st.mode); changed();
    setTimeout(function () { map.invalidateSize(); }, 50);
  });
})();
