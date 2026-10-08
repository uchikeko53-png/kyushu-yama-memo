// 画面の切り替え(コース / 地図 / 記録)と、コース一覧
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = { courses: 'v-courses', plan: 'v-plan', map: 'v-map', log: 'v-log' };
  var tab = 'courses', filter = 'all';

  function header() {
    var map = tab === 'map';
    $('h-eyebrow').textContent = map ? $('h-eyebrow').dataset.course : (tab === 'log' ? '登った記録' : (tab === 'plan' ? '出発前の準備' : '計画と記録'));
    $('h-title').textContent = map ? $('h-title').dataset.course : '九州 山歩きメモ';
    document.querySelector('.layers').hidden = !map;
  }
  function showTab(name) {
    tab = name;
    Object.keys(VIEWS).forEach(function (k) {
      $(VIEWS[k]).hidden = k !== name;
      $('tab-' + k).setAttribute('aria-selected', k === name);
    });
    header();
    if (name === 'map' && window.yamaMap) { setTimeout(function () { window.yamaMap.invalidateSize(); $('fit').click(); }, 0); }
    if (name === 'courses') renderCourses();
    window.dispatchEvent(new CustomEvent('yama:tab', { detail: name }));
    window.scrollTo(0, 0);
  }
  window.showTab = showTab;
  Object.keys(VIEWS).forEach(function (k) { $('tab-' + k).addEventListener('click', function () { showTab(k); }); });
  window.addEventListener('yama:header', header);

  // ---- コース一覧
  function fmtDate(d) { var p = (d || '').split('-'); return p.length === 3 ? +p[1] + '月' + +p[2] + '日' : ''; }
  function fmtFull(d) { var p = (d || '').split('-'); return p.length === 3 ? p[0] + '年' + +p[1] + '月' + +p[2] + '日' : ''; }
  var recs = [];
  function renderCourses() {
    return window.LogDB.all().then(function (l) { recs = l; draw(); }).catch(function () { recs = []; draw(); });
  }
  function draw() {
    var plans = window.Yama.plans(), box = $('cs-list'); box.innerHTML = '';
    var rows = window.COURSES.map(function (c) {
      var mine = recs.filter(function (r) { return r.courseId === c.id; });
      return { c: c, plan: plans[c.id] || null, n: mine.length, last: mine.length ? mine[0].date : '' };
    }).filter(function (x) {
      return filter === 'all' || (filter === 'done' && x.n) || (filter === 'planned' && x.plan && x.plan.status === 'planned') || (filter === 'idea' && x.plan && x.plan.status === 'idea');
    });
    rows.sort(function (a, b) {
      var ra = a.plan && a.plan.status === 'planned' ? 0 : (a.plan ? 1 : 2), rb = b.plan && b.plan.status === 'planned' ? 0 : (b.plan ? 1 : 2);
      return ra - rb || ((a.plan && a.plan.date) || '9').localeCompare((b.plan && b.plan.date) || '9');
    });
    if (!rows.length) { box.innerHTML = '<p class="empty">該当するコースがありません。</p>'; return; }
    rows.forEach(function (x) {
      var c = x.c, el = document.createElement('article'); el.className = 'course';
      var chips = '';
      if (x.plan && x.plan.status === 'planned') chips += '<span class="chip plan">計画中' + (x.plan.date ? ' ' + fmtDate(x.plan.date) : '') + '</span>';
      if (x.plan && x.plan.status === 'idea') chips += '<span class="chip plan">気になる</span>';
      if (x.n) chips += '<span class="chip ok">登った ' + x.n + '回(前回 ' + fmtFull(x.last) + ')</span>';
      el.innerHTML = '<div><h3></h3><div class="area"></div></div><div class="stat"></div><div class="small cnote" hidden></div><div class="chips"></div>' +
        '<div class="cplan"><label>状態 <select aria-label="状態"><option value="">未設定</option><option value="idea">気になる</option><option value="planned">計画中</option></select></label>' +
        '<label class="pd" hidden>予定日 <input type="date" aria-label="予定日"></label></div>' +
        '<div class="row"><button type="button" class="btn pb">計画(天気・持ち物)</button><button type="button" class="btn ghost mb">地図を開く</button></div>';
      el.querySelector('h3').textContent = c.name;
      el.querySelector('.area').textContent = c.area + ' ・ ' + c.kind + 'コース';
      el.querySelector('.stat').textContent = window.statLine(c.stats);
      el.querySelector('.chips').innerHTML = chips;
      var nt = el.querySelector('.cnote'); if (c.note) { nt.textContent = c.note; nt.hidden = false; }
      var sel = el.querySelector('select'), pd = el.querySelector('.pd'), di = el.querySelector('input');
      sel.value = x.plan ? x.plan.status : ''; pd.hidden = sel.value !== 'planned'; di.value = (x.plan && x.plan.date) || '';
      function save() {
        pd.hidden = sel.value !== 'planned';
        window.Yama.setPlan(c.id, sel.value ? { status: sel.value, date: sel.value === 'planned' ? di.value : '' } : null);
      }
      sel.addEventListener('change', function () { save(); draw(); });
      di.addEventListener('change', function () { save(); draw(); });
      el.querySelector('.mb').addEventListener('click', function () { window.Yama.select(c.id); showTab('map'); });
      el.querySelector('.pb').addEventListener('click', function () { window.Yama.select(c.id); showTab('plan'); });
      box.appendChild(el);
    });
  }
  document.querySelectorAll('.filters button').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.f;
      document.querySelectorAll('.filters button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      draw();
    });
  });
  window.addEventListener('yama:records', renderCourses);

  showTab('courses');
})();
