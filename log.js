(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MAX_PHOTOS = 10, MAX_SIDE = 1200;
  var urls = [];            // 画面に出している写真のURL(作り直すときに解放する)
  var editing = null;       // 編集中の記録
  var picked = [];          // フォームで選んだ新しい写真(Blob)

  // ---- フォーム
  function today() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  $('lf-date').value = today();

  // ---- コース選択(距離・標高などは自動で入る)
  var sel = $('lf-course');
  window.COURSES.forEach(function (c) { var o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
  var other = document.createElement('option'); other.value = ''; other.textContent = 'その他の山(名前を自分で書く)'; sel.appendChild(other);
  var allRecs = [];
  var statLine = window.statLine;
  function courseChanged(keepName) {
    var c = window.courseById(sel.value), box = $('lf-stat');
    if (!c) { box.hidden = true; if (!keepName) $('lf-mt').value = ''; return; }
    if (!keepName) $('lf-mt').value = c.name;
    var mine = allRecs.filter(function (r) { return r.courseId === c.id && (!editing || r.id !== editing.id); });
    box.hidden = false;
    box.textContent = statLine(c.stats) + (mine.length ? '。これまで ' + mine.length + '回登っています(前回 ' + fmt(mine[0].date) + ')' : '。このコースは初めての記録です');
  }
  sel.addEventListener('change', function () { courseChanged(false); });
  function loadRecs() { return window.LogDB.all().then(function (l) { allRecs = l; courseChanged(true); }); }

  function resize(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); };
      img.src = u;
    });
  }
  function preview() {
    var box = $('lf-prev'); box.innerHTML = '';
    picked.forEach(function (b) { var i = document.createElement('img'); i.alt = '選んだ写真'; i.src = URL.createObjectURL(b); box.appendChild(i); });
  }
  $('lf-photos').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files, 0, MAX_PHOTOS);
    if (this.files.length > MAX_PHOTOS) $('lf-msg').textContent = '写真は' + MAX_PHOTOS + '枚までです。最初の' + MAX_PHOTOS + '枚を使います。';
    Promise.all(files.map(resize)).then(function (bs) { picked = bs; preview(); })
      .catch(function () { $('lf-msg').textContent = 'この写真は読み込めませんでした。'; });
  });

  function resetForm() {
    editing = null; picked = [];
    $('log-form').reset(); $('lf-date').value = today(); sel.value = window.Yama.course.id; courseChanged(false);
    delete $('lf-track').dataset.keep;
    $('lf-prev').innerHTML = ''; $('lf-title').textContent = '山行を記録する';
    $('lf-submit').textContent = '記録を保存'; $('lf-cancel').hidden = true;
  }
  $('lf-cancel').addEventListener('click', function () { resetForm(); $('lf-msg').textContent = ''; });

  $('log-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var rec = editing ? Object.assign({}, editing) : { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), photos: [] };
    rec.date = $('lf-date').value; rec.who = rec.who || ''; rec.mountain = $('lf-mt').value.trim(); rec.text = $('lf-text').value.trim();
    var c = window.courseById(sel.value);
    rec.courseId = c ? c.id : '';
    var tid = $('lf-track').value;
    var tp = tid ? window.TrackDB.get(tid) : Promise.resolve(null);
    // その時点の数値をそのまま残す(あとでルートを直しても、過去の記録は変わらない)。編集時は元の数値を保つ
    if (c) { if (!(editing && editing.courseId === c.id && editing.stats)) rec.stats = Object.assign({}, c.stats); } else { rec.stats = null; }
    if (picked.length) rec.photos = picked;
    tp.then(function (t) {
      if (t) { rec.trackId = t.id; rec.walk = window.Track.summary(t); }
      else if (!tid && !(editing && editing.walk && $('lf-track').dataset.keep)) { rec.trackId = ''; rec.walk = null; }
      return window.LogDB.put(rec);
    }).then(function () {
      $('lf-msg').textContent = editing ? '記録を更新しました。' : '記録を保存しました。';
      resetForm(); return render();
    }).catch(function () { $('lf-msg').textContent = '保存できませんでした。端末の空き容量やブラウザの設定を確認してください。'; });
  });

  // ---- 一覧
  function fmt(d) { var p = d.split('-'); return p.length === 3 ? p[0] + '年' + +p[1] + '月' + +p[2] + '日' : d; }
  function render() {
    urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
    return window.LogDB.all().then(function (list) {
      allRecs = list; courseChanged(true);
      var box = $('lg-list'); box.innerHTML = '';
      $('lg-count').textContent = list.length ? '(' + list.length + '件)' : '';
      if (!list.length) { box.innerHTML = '<p class="empty">まだ記録がありません。登ったら、上のフォームから書いてみましょう。</p>'; return; }
      list.forEach(function (r) {
        var el = document.createElement('article'); el.className = 'entry';
        var ph = document.createElement('div'); ph.className = 'ph'; ph.dataset.n = Math.min((r.photos || []).length, 3);
        var mine = [];
        (r.photos || []).forEach(function (b, i) {
          var u = URL.createObjectURL(b); urls.push(u); mine.push(u);
          var im = document.createElement('img'); im.src = u; im.alt = r.mountain + 'の写真' + (i + 1); im.loading = 'lazy';
          im.addEventListener('click', function () { openLB(mine, i); });
          ph.appendChild(im);
        });
        var body = document.createElement('div'); body.className = 'body';
        var meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = fmt(r.date) + (r.who ? ' ・ ' + r.who : '');
        var h = document.createElement('h3'); h.textContent = r.mountain;
        var st = document.createElement('div'); st.className = 'stat';
        if (r.stats && r.courseId) {
          var same = list.filter(function (x) { return x.courseId === r.courseId; }).sort(function (a, b) { return (a.date + a.id).localeCompare(b.date + b.id); });
          st.textContent = statLine(r.stats) + ' ・ このコース ' + (same.indexOf(r) + 1) + '回目';
        }
        var wk = document.createElement('div'); wk.className = 'walk';
        if (r.walk) wk.textContent = '実際に歩いた記録: ' + r.walk.distKm.toFixed(1) + 'km ・ ' + window.fmtMin(r.walk.min) + (r.walk.gaps ? '(GPSが途切れた箇所 ' + r.walk.gaps + '回)' : '');
        var p = document.createElement('p'); p.textContent = r.text;
        var act = document.createElement('div'); act.className = 'row';
        var be = document.createElement('button'); be.type = 'button'; be.className = 'mini'; be.textContent = '編集';
        var bd = document.createElement('button'); bd.type = 'button'; bd.className = 'mini danger'; bd.textContent = '削除';
        be.addEventListener('click', function () { edit(r); });
        bd.addEventListener('click', function () {
          if (bd.dataset.ok) { window.LogDB.remove(r.id).then(render); return; }
          bd.dataset.ok = '1'; bd.textContent = 'もう一度押すと削除';
          setTimeout(function () { delete bd.dataset.ok; bd.textContent = '削除'; }, 4000);
        });
        act.appendChild(be); act.appendChild(bd);
        body.appendChild(meta); body.appendChild(h); if (st.textContent) body.appendChild(st); if (wk.textContent) body.appendChild(wk); body.appendChild(p); body.appendChild(act);
        if (r.photos && r.photos.length) el.appendChild(ph);
        el.appendChild(body); box.appendChild(el);
      });
    });
  }
  function edit(r) {
    editing = r; picked = [];
    $('lf-date').value = r.date; sel.value = window.courseById(r.courseId) ? r.courseId : ''; $('lf-mt').value = r.mountain; $('lf-text').value = r.text; courseChanged(true);
    $('lf-prev').innerHTML = ''; $('lf-track').value = r.trackId || ''; if (r.walk && !$('lf-track').value) $('lf-track').dataset.keep = '1'; else delete $('lf-track').dataset.keep; $('lf-title').textContent = '記録を編集する';
    $('lf-submit').textContent = '更新する'; $('lf-cancel').hidden = false;
    $('lf-msg').textContent = r.photos && r.photos.length ? '写真は今のまま残ります。差し替えるときだけ、新しく選んでください。' : '';
    window.scrollTo(0, 0);
  }
  var lb = { list: [], i: 0 };
  function showLB() { $('lightbox').querySelector('img').src = lb.list[lb.i]; $('lb-n').textContent = (lb.i + 1) + ' / ' + lb.list.length; $('lb-prev').disabled = lb.i === 0; $('lb-next').disabled = lb.i === lb.list.length - 1; }
  function openLB(list, i) { lb = { list: list, i: i }; showLB(); $('lightbox').hidden = false; }
  $('lb-prev').addEventListener('click', function (e) { e.stopPropagation(); if (lb.i > 0) { lb.i--; showLB(); } });
  $('lb-next').addEventListener('click', function (e) { e.stopPropagation(); if (lb.i < lb.list.length - 1) { lb.i++; showLB(); } });
  $('lb-close').addEventListener('click', function () { $('lightbox').hidden = true; });
  $('lightbox').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });

  sel.value = window.Yama.course.id; courseChanged(false); loadRecs();

  // ---- 書き出し / 読み込み(友人と記録を交換する用)
  function b2d(b) { return new Promise(function (res) { var f = new FileReader(); f.onload = function () { res(f.result); }; f.readAsDataURL(b); }); }
  function d2b(d) { return fetch(d).then(function (r) { return r.blob(); }); }
  $('lg-export').addEventListener('click', function () {
    window.LogDB.all().then(function (list) {
      if (!list.length) { $('lg-msg').textContent = '書き出す記録がありません。'; return; }
      return Promise.all(list.map(function (r) {
        return Promise.all((r.photos || []).map(b2d)).then(function (ph) { return Object.assign({}, r, { photos: ph }); });
      })).then(function (out) {
        var blob = new Blob([JSON.stringify({ app: 'yama-log', version: 1, records: out })], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'yama-log-' + today() + '.json';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        $('lg-msg').textContent = list.length + '件を書き出しました。';
      });
    });
  });
  $('lg-import').addEventListener('change', function () {
    var f = this.files[0], inp = this; if (!f) return;
    f.text().then(function (t) {
      var d = JSON.parse(t);
      if (!d || d.app !== 'yama-log' || !Array.isArray(d.records)) throw new Error('format');
      return Promise.all(d.records.map(function (r) {
        if (!r || typeof r.id !== 'string' || typeof r.date !== 'string') return null;
        return Promise.all((r.photos || []).slice(0, MAX_PHOTOS).map(d2b)).then(function (bs) {
          return window.LogDB.put({ id: r.id, courseId: String(r.courseId || ''), stats: r.stats && typeof r.stats === 'object' ? r.stats : null, walk: r.walk && typeof r.walk === 'object' ? r.walk : null, date: r.date, who: String(r.who || ''), mountain: String(r.mountain || ''), text: String(r.text || ''), photos: bs });
        });
      }));
    }).then(function () { $('lg-msg').textContent = '読み込みました。同じ記録は上書きされます。'; return render(); })
      .catch(function () { $('lg-msg').textContent = 'このファイルは読み込めませんでした。このアプリで書き出したファイルを選んでください。'; })
      .then(function () { inp.value = ''; });
  });
  window.Yama.onCourse(function (c) { if (!editing) { sel.value = c.id; courseChanged(false); } });
  window.addEventListener('yama:tab', function (e) { if (e.detail === 'log') render(); });
})();
