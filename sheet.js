// 登山計画書: 計画タブの内容(日付・出発時刻・持ち物)と、自分の情報から、1枚の計画書をつくる。
// 氏名・電話などは、この端末の中にだけ保存する。サーバーには送らない。
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = window.PlanApi, root = $('v-sheet');
  var PROF_KEY = 'yama-profile', TRIP_KEY = 'yama-sheet';
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function jpDate(s) { var p = s.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); return p[0] + '年' + +p[1] + '月' + +p[2] + '日(' + WD[d.getDay()] + ')'; }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---- 入力欄
  var FIELDS = [
    ['p', 'name', '氏名(代表者)', 'text', '例: 山田 太郎'],
    ['p', 'tel', '電話番号', 'tel', '例: 090-0000-0000'],
    ['p', 'eName', '緊急連絡先の氏名と続柄', 'text', '例: 山田 花子(妻)'],
    ['p', 'eTel', '緊急連絡先の電話番号', 'tel', ''],
    ['p', 'health', '持病・アレルギー(任意)', 'text', 'なければ空欄'],
    ['t', 'mates', '同行者(1人1行。氏名と電話)', 'area', '例: 佐藤 次郎 080-0000-0000'],
    ['t', 'transport', '交通手段・駐車場', 'text', '例: 自家用車(白いフィット)、草千里の駐車場'],
    ['t', 'deadline', '連絡がなければ、通報してほしい時刻', 'time', '']
  ];
  function build() {
    root.innerHTML = '';
    var sec = el('section', 'panel sheet');
    var back = el('button', 'mini', '← 計画にもどる'); back.type = 'button'; back.id = 'sh-back';
    sec.appendChild(back);
    sec.appendChild(el('p', 'small', '氏名や電話番号は、この端末の中にだけ保存されます(サーバーには送りません)。入力すると、下の計画書に反映されます。'));
    var form = el('div', 'logform'); form.id = 'sh-form';
    FIELDS.forEach(function (f) {
      var lab = el('label'); lab.appendChild(document.createTextNode(f[2]));
      var inp = f[3] === 'area' ? el('textarea') : el('input'); if (f[3] !== 'area') inp.type = f[3];
      inp.id = 'sh-' + f[1]; inp.placeholder = f[4]; if (f[3] === 'area') inp.rows = 3;
      inp.addEventListener('input', function () { saveField(f); render(); });
      lab.appendChild(inp); form.appendChild(lab);
    });
    sec.appendChild(form);
    var acts = el('div', 'row');
    [['sh-share', '計画書を共有する', 'btn'], ['sh-copy', 'コピー', 'btn ghost'], ['sh-print', '印刷・PDFで保存', 'btn ghost']].forEach(function (a) {
      var b = el('button', a[2], a[1]); b.type = 'button'; b.id = a[0]; acts.appendChild(b);
    });
    sec.appendChild(acts);
    sec.appendChild(el('p', 'small')).id = 'sh-msg';
    sec.lastChild.setAttribute('aria-live', 'polite');
    var doc = el('article', 'doc'); doc.id = 'sheet-doc'; sec.appendChild(doc);
    var note = el('p', 'small');
    note.innerHTML = '登山届の提出が必要な山や、提出先(警察署、自治体、山小屋、オンライン提出の<a href="https://www.mt-compass.com/" target="_blank" rel="noopener">コンパス</a>など)は、山によって違います。行き先ごとに、ご自分で確認してください。この計画書は、家族や友人に伝えるための控えです。';
    sec.appendChild(note);
    root.appendChild(sec);

    $('sh-back').addEventListener('click', function () { window.showTab('plan'); });
    $('sh-share').addEventListener('click', function () {
      var t = text();
      if (navigator.share) navigator.share({ title: '登山計画書', text: t }).catch(function (e) { if (e && e.name !== 'AbortError') copy(); });
      else copy();
    });
    $('sh-copy').addEventListener('click', copy);
    $('sh-print').addEventListener('click', function () { window.print(); });
  }
  function fieldVal(f) {
    return f[0] === 'p' ? (load(PROF_KEY, {})[f[1]] || '') : ((load(TRIP_KEY, {})[window.Yama.course.id] || {})[f[1]] || '');
  }
  function saveField(f) {
    var v = $('sh-' + f[1]).value;
    if (f[0] === 'p') { var p = load(PROF_KEY, {}); p[f[1]] = v; save(PROF_KEY, p); }
    else { var a = load(TRIP_KEY, {}), id = window.Yama.course.id; a[id] = a[id] || {}; a[id][f[1]] = v; save(TRIP_KEY, a); }
  }
  function fill() { FIELDS.forEach(function (f) { $('sh-' + f[1]).value = fieldVal(f); }); }

  // ---- 計画書の中身(画面と、共有する文章の、両方に使う)
  function sections() {
    var c = window.Yama.course, S = c.stats, st = P.cur, date = st.date, p0 = c.route.points[0];
    var sn = P.sun(date, p0[0], p0[1]), start = P.toMin(st.start), loop = c.kind === '周回';
    var dur = S.min * P.BEGINNER + P.REST_MIN, end = start + dur, goal = sn ? sn.set - P.SAFETY_MIN : NaN;
    var turn = goal - (S.min / 2) * P.BEGINNER;
    var prof = load(PROF_KEY, {}), trip = (load(TRIP_KEY, {})[c.id]) || {};
    var mates = (trip.mates || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var items = P.packItems(c, date), mine = (load('yama-pack', {})[c.id]) || {};
    var packed = items.filter(function (i) { return mine[i[1]]; }).map(function (i) { return i[2].replace(/\(.*?\)/g, ''); });
    var late = sn && end > goal;
    var deadline = trip.deadline || (sn ? P.hm(sn.set) : '');
    var S1 = [
      ['山名・コース', c.name + '(日帰り・' + c.kind + ')'],
      ['場所', c.area],
      ['日付', jpDate(date)],
      ['出発(登山口)', P.hm(start)],
      ['下山(終了)の予定', P.hm(end) + ' ごろ'],
      ['日没', sn ? P.hm(sn.set) : '-'],
      ['距離・標高', window.statLine(S)],
      ['登山口の位置', p0[0].toFixed(5) + ', ' + p0[1].toFixed(5) + ' ' + 'https://maps.gsi.go.jp/#17/' + p0[0].toFixed(5) + '/' + p0[1].toFixed(5) + '/']
    ];
    var S2 = [
      ['下山を終える目標', sn ? P.hm(goal) + '(日没の' + P.SAFETY_MIN + '分前)' : '-']
    ];
    if (!loop && sn) S2.push(['折り返す時刻の目安', P.hm(turn) + '(山頂に着いていなくても、この時刻で引き返す)']);
    S2.push(['引き返す条件', '雨・強い風・雷の気配、体調不良、日没に間に合わないとき']);
    if (late) S2.push(['注意', '予定が日没の目標より遅くなっています。出発を早めるか、日を変えることを考えてください']);
    var S3 = [['代表者', (prof.name || '(未入力)') + (prof.tel ? '  ' + prof.tel : '')]];
    if (mates.length) mates.forEach(function (m, i) { S3.push(['同行者' + (i + 1), m]); });
    S3.push(['人数', (1 + mates.length) + '人']);
    var S4 = [['緊急連絡先', prof.eName ? prof.eName + (prof.eTel ? '  ' + prof.eTel : '') : '(未入力)']];
    var S5 = [['交通・駐車', trip.transport || '(未入力)'],
              ['装備(準備ずみ)', packed.length ? packed.join('、') : '(持ち物チェックが未入力)']];
    if (prof.health) S5.push(['持病・アレルギー', prof.health]);
    var S6 = [['下山の連絡', '下山したら、緊急連絡先に連絡する'],
              ['通報の依頼', (deadline ? deadline + ' までに' : '日没までに') + '連絡がなければ、警察(110)または消防(119)に、この計画書を伝えてください']];
    return [['山行', S1], ['安全の基準', S2], ['参加者', S3], ['緊急連絡先', S4], ['交通・装備', S5], ['下山の連絡', S6]];
  }
  function text() {
    var out = ['【登山計画書】'];
    sections().forEach(function (s) { out.push('', '■' + s[0]); s[1].forEach(function (r) { out.push(r[0] + ': ' + r[1]); }); });
    out.push('', '作成: 山歩きメモ(' + new Date().getFullYear() + '年' + (new Date().getMonth() + 1) + '月' + new Date().getDate() + '日)');
    return out.join('\n');
  }
  function render() {
    var doc = $('sheet-doc'); doc.innerHTML = '';
    doc.appendChild(el('h2', 'dt', '登山計画書'));
    sections().forEach(function (s) {
      doc.appendChild(el('h3', 'ds', s[0]));
      var dl = el('dl', 'dl');
      s[1].forEach(function (r) {
        var dt = el('dt', null, r[0]), dd = el('dd', r[0] === '注意' ? 'warnrow' : null, r[1]);
        dl.appendChild(dt); dl.appendChild(dd);
      });
      doc.appendChild(dl);
    });
  }
  function copy() {
    var t = text(), msg = $('sh-msg');
    function fallback() {
      var a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); msg.textContent = 'コピーしました。メッセージに貼り付けて送れます。'; } catch (e) { msg.textContent = 'コピーできませんでした。'; }
      a.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { msg.textContent = 'コピーしました。メッセージに貼り付けて送れます。'; }, fallback); else fallback();
  }

  build();
  window.addEventListener('yama:tab', function (e) { if (e.detail === 'sheet') { fill(); render(); } });
  window.Yama.onCourse(function () { if (!root.hidden) { fill(); render(); } });
})();
