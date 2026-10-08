(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  // ---- 地図(国土地理院タイル)
  var gsi = 'https://cyberjapandata.gsi.go.jp/xyz/';
  var attr = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
  var layers = {
    std: L.tileLayer(gsi + 'std/{z}/{x}/{y}.png', { attribution: attr, maxZoom: 19, maxNativeZoom: 18 }),
    photo: L.tileLayer(gsi + 'seamlessphoto/{z}/{x}/{y}.jpg', { attribution: attr, maxZoom: 19, maxNativeZoom: 18 }),
    relief: L.tileLayer(gsi + 'relief/{z}/{x}/{y}.png', { attribution: attr, maxZoom: 19, maxNativeZoom: 15 })
  };
  var map = L.map('map', { zoomControl: true, layers: [layers.std] });
  window.yamaMap = map;
  var current = 'std';
  document.querySelectorAll('.layers button').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.layer;
      map.removeLayer(layers[current]); layers[k].addTo(map); current = k;
      document.querySelectorAll('.layers button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    });
  });

  // ---- 選んでいるコースの状態
  var C, R, pts, latlngs, total, lcum, routeLayer = L.layerGroup().addTo(map), line;
  var W = 400, H = 140, ml = 38, mr = 10, mt = 12, mb = 22, emin, emax;
  var X = function (m) { return ml + (m / total) * (W - ml - mr); };
  var Y = function (e) { return mt + (1 - (e - emin) / (emax - emin)) * (H - mt - mb); };
  var posMarker = null, accCircle = null, watchId = null, lastPos = null;

  function toXY(lat, lon) { return [(lon - 130.94) * 111320 * Math.cos(lat * Math.PI / 180), (lat - 32.81) * 110540]; }
  function eleAt(m) {
    var k = 0; while (k < pts.length - 2 && pts[k + 1][2] < m) k++;
    var t = (m - pts[k][2]) / ((pts[k + 1][2] - pts[k][2]) || 1); t = Math.max(0, Math.min(1, t));
    return pts[k][3] + (pts[k + 1][3] - pts[k][3]) * t;
  }
  function latlngAt(m) { // 細かい線の上で、スタートから m の位置
    var f = m / total * lcum[lcum.length - 1], i = 0;
    while (i < lcum.length - 2 && lcum[i + 1] < f) i++;
    var t = (f - lcum[i]) / ((lcum[i + 1] - lcum[i]) || 1); t = Math.max(0, Math.min(1, t));
    return [latlngs[i][0] + (latlngs[i + 1][0] - latlngs[i][0]) * t, latlngs[i][1] + (latlngs[i + 1][1] - latlngs[i][1]) * t];
  }

  function fit() { if (line) map.fitBounds(line.getBounds(), { padding: [40, 40] }); }
  $('fit').addEventListener('click', fit);

  function load(course) {
    C = course; R = course.route; pts = R.points; latlngs = R.line; total = R.total;
    lcum = [0];
    for (var q = 1; q < latlngs.length; q++) {
      var u = toXY(latlngs[q - 1][0], latlngs[q - 1][1]), w = toXY(latlngs[q][0], latlngs[q][1]);
      lcum.push(lcum[q - 1] + Math.hypot(w[0] - u[0], w[1] - u[1]));
    }
    // 画面の文字
    $('h-eyebrow').dataset.course = course.area + ' ・ ' + course.kind + 'コース';
    $('h-title').dataset.course = course.name;
    $('map').setAttribute('aria-label', course.name + 'の地図');
    var S = course.stats, loop = course.kind === '周回';
    $('s-dist').textContent = S.distKm.toFixed(1) + ' km';
    $('s-dist-l').textContent = loop ? '周回の距離' : '往復の距離';
    $('s-elev').textContent = S.eleStart + '→' + S.eleTop + 'm';
    $('s-elev-l').textContent = '標高(登山口→最高点)';
    $('s-up').textContent = '約' + S.up + 'm';
    $('s-up-l').textContent = loop ? '登りの合計' : '片道の登り';
    $('s-time').textContent = '約' + window.fmtMin(S.min);
    $('s-time-l').textContent = (loop ? '周回' : '往復') + 'の目安';
    $('prof-title').textContent = '標高の断面' + (loop ? '(周回)' : '(往路)');
    $('profile').setAttribute('aria-label', course.name + 'の標高の断面');
    window.dispatchEvent(new Event('yama:header'));

    // ルート(白い縁取り + 赤線)と目印
    routeLayer.clearLayers();
    L.polyline(latlngs, { color: '#fff', weight: 6, opacity: .5 }).addTo(routeLayer);
    line = L.polyline(latlngs, { color: '#d02a20', weight: 3, opacity: .7 }).addTo(routeLayer);
    R.marks.forEach(function (mk, i) {
      if (mk.end) return; // 周回のゴールは登山口と同じ場所
      var color = i === 0 ? '#2f5d46' : (i === R.marks.length - 1 ? '#c4352b' : '#e0a020');
      var m = L.circleMarker(latlngAt(mk.dist), { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(routeLayer);
      m.bindTooltip(mk.name + ' ' + Math.round(eleAt(mk.dist)) + 'm', { permanent: true, direction: 'top', offset: [0, -8], className: 'lbl' });
    });
    fit();

    // 標高の断面図
    var ele = pts.map(function (p) { return p[3]; });
    emin = Math.floor(Math.min.apply(null, ele) / 50) * 50; emax = Math.ceil(Math.max.apply(null, ele) / 50) * 50;
    if (emax - emin < 100) emax = emin + 100;
    var step = (emax - emin) > 600 ? 200 : 100, g = '';
    for (var e = emin; e <= emax; e += step) {
      g += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(e) + '" y2="' + Y(e) + '" stroke="var(--line)"/>' +
           '<text x="' + (ml - 4) + '" y="' + (Y(e) + 3) + '" text-anchor="end" font-size="9" fill="var(--mute)">' + e + 'm</text>';
    }
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[2]).toFixed(1) + ' ' + Y(p[3]).toFixed(1); }).join('');
    g += '<path d="' + d + 'L' + X(total) + ' ' + (H - mb) + 'L' + X(0) + ' ' + (H - mb) + 'Z" fill="var(--forest)" opacity=".18"/>';
    g += '<path d="' + d + '" fill="none" stroke="var(--forest)" stroke-width="2.2"/>';
    g += '<g font-size="10" fill="var(--mute)">';
    R.marks.forEach(function (mk, i) {
      var anchor = i === 0 ? 'start' : (mk.dist >= total ? 'end' : 'middle');
      var label = mk.name + (mk.dist >= total ? ' ' + (total / 1000).toFixed(1) + 'km' : '');
      g += '<text x="' + X(mk.dist) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + label + '</text>';
      if (i > 0 && mk.dist < total) g += '<line x1="' + X(mk.dist) + '" x2="' + X(mk.dist) + '" y1="' + mt + '" y2="' + (H - mb) + '" stroke="var(--mute)" stroke-dasharray="3 3"/>';
    });
    g += '</g>';
    g += '<g id="prof-pos" visibility="hidden"><line id="pp-l" y1="' + mt + '" y2="' + (H - mb) + '" stroke="var(--pos)" stroke-width="1.5"/><circle id="pp-c" r="5" fill="var(--pos)" stroke="#fff" stroke-width="2"/></g>';
    $('profile').innerHTML = g;

    $('sim').max = Math.round(total); $('sim').value = 0; $('sim-out').textContent = 0;
    $('status').className = 'status';
    $('status').textContent = '「現在地」を押すと、地図に自分の位置が出ます。';
    if (lastPos) showPos(lastPos[0], lastPos[1], lastPos[2], false);
  }

  // ---- 現在地
  function nearest(lat, lon) {
    var p = toXY(lat, lon), best = { d: 1e12, m: 0 };
    for (var i = 0; i < latlngs.length - 1; i++) {
      var a = toXY(latlngs[i][0], latlngs[i][1]), b = toXY(latlngs[i + 1][0], latlngs[i + 1][1]);
      var vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      var t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
      var dx = p[0] - (a[0] + vx * t), dy = p[1] - (a[1] + vy * t), dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < best.d) best = { d: dd, m: (lcum[i] + (lcum[i + 1] - lcum[i]) * t) * total / lcum[lcum.length - 1] };
    }
    return best;
  }
  function showPos(lat, lon, acc, pan) {
    lastPos = [lat, lon, acc];
    if (!posMarker) {
      posMarker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="pos-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 }).addTo(map);
      accCircle = L.circle([lat, lon], { radius: acc || 20, color: '#1f6fe0', weight: 1, fillOpacity: .12 }).addTo(map);
    } else { posMarker.setLatLng([lat, lon]); accCircle.setLatLng([lat, lon]).setRadius(acc || 20); }
    if (pan) map.setView([lat, lon], Math.max(map.getZoom(), 16));
    var n = nearest(lat, lon), st = $('status');
    $('prof-pos').setAttribute('visibility', 'visible');
    var x = X(n.m); $('pp-l').setAttribute('x1', x); $('pp-l').setAttribute('x2', x);
    $('pp-c').setAttribute('cx', x); $('pp-c').setAttribute('cy', Y(eleAt(n.m)));
    if (n.d <= 50) {
      var next = R.marks.filter(function (mk, i) { return i > 0 && mk.dist > n.m + 5; })[0];
      st.className = 'status ok';
      st.textContent = 'ルート上にいます。登山口から ' + Math.round(n.m) + 'm' +
        (next ? '、' + next.name + 'まであと ' + Math.round(next.dist - n.m) + 'm' : '。ゴール付近です') + '。';
    } else {
      st.className = 'status warn';
      st.textContent = 'ルートから約 ' + Math.round(n.d) + 'm 離れています。来た道を戻って、標識と地図を確認してください。';
    }
  }
  $('locate').addEventListener('click', function () {
    var st = $('status');
    if (!navigator.geolocation) { st.className = 'status warn'; st.textContent = 'この端末では位置情報を使えません。'; return; }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    st.className = 'status'; st.textContent = '現在地を取得しています…';
    var first = true;
    watchId = navigator.geolocation.watchPosition(function (p) {
      showPos(p.coords.latitude, p.coords.longitude, p.coords.accuracy, first); first = false;
    }, function (err) {
      st.className = 'status warn';
      st.textContent = err.code === 1 ? '位置情報が許可されていません。ブラウザの設定で許可してください。'
        : '現在地を取得できません。空の開けた場所で再度お試しください。';
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  });

  // ---- PCで試す(仮の現在地)
  $('sim').addEventListener('input', function () {
    var m = +this.value; $('sim-out').textContent = m;
    var ll = latlngAt(m); showPos(ll[0], ll[1], 15, false);
  });

  window.yamaShowPos = showPos;
  window.Yama.onCourse(load);
  load(window.Yama.course);
})();
