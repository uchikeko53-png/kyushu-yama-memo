// コースの下書きを、スマホの中で作るための部品。
// OpenStreetMap の道(Overpass API)から、登山口〜山頂のルートをたどり、国土地理院の標高APIで標高を付ける。
window.Routing = (function () {
  'use strict';
  var ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  var MAX_SPAN_M = 7000;       // 調べる範囲の、一辺の上限
  var PAD_M = 800;             // 登山口と山頂の外側に足す余白
  var SNAP_M = 200;            // 道に吸い付く距離の上限
  var GAP_M = 80;              // 途切れた道を、直線でつなぐ距離の上限
  var STEP_M = 40;             // 標高を調べる間隔

  function hav(a, b) {
    var R = 6371000, p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dl = (b[1] - a[1]) * Math.PI / 180, dp = p2 - p1;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function key(p) { return p[0].toFixed(6) + ',' + p[1].toFixed(6); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- 道のデータの取得
  function bbox(pts) {
    var la = pts.map(function (p) { return p[0]; }), lo = pts.map(function (p) { return p[1]; });
    var mLat = PAD_M / 110540, mLon = PAD_M / (111320 * Math.cos(la[0] * Math.PI / 180));
    return { s: Math.min.apply(null, la) - mLat, n: Math.max.apply(null, la) + mLat, w: Math.min.apply(null, lo) - mLon, e: Math.max.apply(null, lo) + mLon };
  }
  function spanM(b) { return Math.max(hav([b.s, b.w], [b.n, b.w]), hav([b.s, b.w], [b.s, b.e])); }
  function fetchOsm(b, onStatus) {
    var q = '[out:json][timeout:40];way["highway"]["highway"!~"motorway|trunk|motorway_link|trunk_link|cycleway|bus_guideway|raceway|construction|proposed|corridor|platform"](' +
      b.s.toFixed(5) + ',' + b.w.toFixed(5) + ',' + b.n.toFixed(5) + ',' + b.e.toFixed(5) + ');out geom;';
    var i = 0;
    function attempt() {
      if (i >= ENDPOINTS.length * 2) return Promise.reject(new Error('osm'));
      var url = ENDPOINTS[i % ENDPOINTS.length]; i++;
      var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 45000);
      if (onStatus && i > 1) onStatus('道のデータの取得を、やり直しています(' + (i - 1) + '回目)…');
      return fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal })
        .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) { if (!j || !j.elements) throw new Error('empty'); return j.elements; })
        .catch(function () { clearTimeout(t); return sleep(1500).then(attempt); });
    }
    return attempt();
  }

  // ---- 道のつながり(グラフ)
  function buildGraph(els) {
    var nodes = {}, adj = {};
    function add(a, b, w, hw) { (adj[a] = adj[a] || []).push({ to: b, w: w, hw: hw }); (adj[b] = adj[b] || []).push({ to: a, w: w, hw: hw }); }
    els.forEach(function (e) {
      if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) return;
      var hw = e.tags && e.tags.highway;
      for (var i = 0; i < e.geometry.length - 1; i++) {
        var a = [e.geometry[i].lat, e.geometry[i].lon], b = [e.geometry[i + 1].lat, e.geometry[i + 1].lon], ka = key(a), kb = key(b);
        if (ka === kb) continue;
        nodes[ka] = a; nodes[kb] = b; add(ka, kb, hav(a, b), hw);
      }
    });
    return { nodes: nodes, adj: adj, add: add };
  }
  function nearestNode(G, p) {
    var best = null, bd = 1e12;
    for (var k in G.nodes) { var d = hav(G.nodes[k], p); if (d < bd) { bd = d; best = k; } }
    return { k: best, d: bd };
  }
  function comps(G) {
    var id = {}, list = [];
    Object.keys(G.nodes).forEach(function (k) {
      if (id[k] != null) return;
      var st = [k], cur = []; id[k] = list.length;
      while (st.length) { var u = st.pop(); cur.push(u); (G.adj[u] || []).forEach(function (e) { if (id[e.to] == null) { id[e.to] = list.length; st.push(e.to); } }); }
      list.push(cur);
    });
    return { id: id, list: list };
  }
  function bridge(G, ka, kb) { // 別々につながった道を、近ければ、直線でつなぐ(つないだ長さを返す)
    var C = comps(G); if (C.id[ka] === C.id[kb]) return 0;
    var A = C.list[C.id[ka]], B = C.list[C.id[kb]], best = { d: 1e12 };
    for (var i = 0; i < A.length; i++) for (var j = 0; j < B.length; j++) {
      var d = hav(G.nodes[A[i]], G.nodes[B[j]]); if (d < best.d) best = { d: d, a: A[i], b: B[j] };
    }
    if (best.d > GAP_M) return -1;
    G.add(best.a, best.b, best.d, 'gap'); return best.d;
  }
  function cost(e, pen, u) {
    var hw = e.hw, m = (hw === 'path' || hw === 'footway' || hw === 'steps' || hw === 'bridleway' || hw === 'gap') ? 1 : (hw === 'track' ? 1.6 : 3);
    var c = e.w * m;
    if (pen && (pen[u + '>' + e.to] || pen[e.to + '>' + u])) c *= 8;
    return c;
  }
  function Heap() { this.a = []; }
  Heap.prototype.push = function (x) { var a = this.a; a.push(x); var i = a.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; } };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; var i = 0, n = a.length; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < n && a[l][0] < a[m][0]) m = l; if (r < n && a[r][0] < a[m][0]) m = r; if (m === i) break; var t = a[m]; a[m] = a[i]; a[i] = t; i = m; } }
    return top;
  };
  function dijkstra(G, s, t, pen) {
    var dist = {}, prev = {}, h = new Heap(); dist[s] = 0; h.push([0, s]);
    while (h.a.length) {
      var x = h.pop(), c = x[0], u = x[1];
      if (u === t) break; if (c > dist[u]) continue;
      (G.adj[u] || []).forEach(function (e) { var nc = c + cost(e, pen, u); if (nc < (dist[e.to] == null ? 1e18 : dist[e.to])) { dist[e.to] = nc; prev[e.to] = u; h.push([nc, e.to]); } });
    }
    if (dist[t] == null) return null;
    var p = [t]; while (p[p.length - 1] !== s) p.push(prev[p[p.length - 1]]);
    return p.reverse();
  }

  // ---- 自動で、道をたどる。kind: 'roundtrip' | 'loop'
  function autoRoute(th, top, kind, onStatus) {
    var b = bbox([th, top]);
    if (spanM(b) > MAX_SPAN_M) return Promise.reject(new Error('far'));
    onStatus('道のデータを取得しています(数十秒かかることがあります)…');
    return fetchOsm(b, onStatus).then(function (els) {
      onStatus('ルートを計算しています…');
      var G = buildGraph(els);
      if (!Object.keys(G.nodes).length) throw new Error('nodata');
      var a = nearestNode(G, th), c = nearestNode(G, top);
      if (a.d > SNAP_M) throw new Error('snap-th');
      if (c.d > SNAP_M) throw new Error('snap-top');
      var gaps = [], g = bridge(G, a.k, c.k);
      if (g < 0) throw new Error('gap'); if (g > 0) gaps.push(g);
      var out = dijkstra(G, a.k, c.k); if (!out) throw new Error('noroute');
      var path = out.slice(), topIdx = out.length - 1;
      if (kind === 'loop') {
        var pen = {}; for (var i = 0; i < out.length - 1; i++) pen[out[i] + '>' + out[i + 1]] = 1;
        var back = dijkstra(G, c.k, a.k, pen); if (!back) throw new Error('noroute');
        path = out.concat(back.slice(1));
      }
      var line = [th].concat(path.map(function (k) { return G.nodes[k]; }));
      if (kind === 'loop') line.push(th); // 登山口まで、実際の道から直線でもどる
      else line.push(top);
      return { line: line, topIdx: topIdx + 1, gaps: gaps, snapTh: a.d, snapTop: c.d };
    });
  }

  // ---- 線から、標高つきのルートを作る
  function densify(line, maxStep) {
    var out = [line[0]];
    for (var i = 1; i < line.length; i++) {
      var d = hav(line[i - 1], line[i]), n = Math.ceil(d / maxStep);
      for (var k = 1; k <= n; k++) out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k / n, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k / n]);
    }
    return out;
  }
  function elevations(pts, onStatus) {
    var out = new Array(pts.length), done = 0, next = 0, fails = 0;
    function one(i) {
      var u = 'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=' + pts[i][1] + '&lat=' + pts[i][0] + '&outtype=JSON';
      return fetch(u).then(function (r) { return r.json(); }).then(function (j) { var e = parseFloat(j.elevation); if (isNaN(e)) throw new Error('nan'); out[i] = e; })
        .catch(function () { return sleep(300).then(function () { return fetch(u).then(function (r) { return r.json(); }).then(function (j) { var e = parseFloat(j.elevation); if (isNaN(e)) throw new Error('nan'); out[i] = e; }); }); })
        .catch(function () { fails++; out[i] = null; });
    }
    function worker() {
      if (next >= pts.length) return Promise.resolve();
      var i = next++;
      return one(i).then(function () { done++; if (onStatus && done % 5 === 0) onStatus('標高を取得しています… ' + done + ' / ' + pts.length); return worker(); });
    }
    var ws = []; for (var w = 0; w < 6; w++) ws.push(worker());
    return Promise.all(ws).then(function () {
      if (fails > pts.length * 0.3) throw new Error('elev');
      // 取れなかった点は、前後の値で埋める
      for (var i = 0; i < out.length; i++) if (out[i] == null) {
        var l = i - 1; while (l >= 0 && out[l] == null) l--;
        var r = i + 1; while (r < out.length && out[r] == null) r++;
        out[i] = l >= 0 && r < out.length ? (out[l] + out[r]) / 2 : (l >= 0 ? out[l] : out[r]);
      }
      return out;
    });
  }
  // line: [[lat,lon]...] / kind / names / topIdx(山頂の線上の位置。周回で使う)
  function toRoute(line, kind, topName, topIdx, onStatus) {
    var cum = [0]; for (var i = 1; i < line.length; i++) cum.push(cum[i - 1] + hav(line[i - 1], line[i]));
    var total = cum[cum.length - 1], sel = [0];
    for (var j = 1; j < line.length; j++) if (cum[j] - cum[sel[sel.length - 1]] >= STEP_M || j === line.length - 1 || j === topIdx) sel.push(j);
    sel = sel.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (x, y) { return x - y; });
    var pts = sel.map(function (i) { return line[i]; });
    return elevations(pts, onStatus).then(function (el) {
      var points = sel.map(function (i, k) { return [+line[i][0].toFixed(6), +line[i][1].toFixed(6), Math.round(cum[i]), Math.round(el[k] * 10) / 10]; });
      var marks = [{ name: '登山口', dist: 0 }];
      if (kind === 'loop') {
        marks.push({ name: topName, dist: Math.round(cum[Math.min(topIdx, cum.length - 1)]) });
        marks.push({ name: '登山口(ゴール)', dist: Math.round(total), end: true });
      } else marks.push({ name: topName, dist: Math.round(total) });
      return { type: kind, points: points, line: line.map(function (p) { return [+p[0].toFixed(6), +p[1].toFixed(6)]; }), total: Math.round(total), marks: marks };
    });
  }

  return { hav: hav, autoRoute: autoRoute, toRoute: toRoute, densify: densify, spanM: spanM, bbox: bbox };
})();
