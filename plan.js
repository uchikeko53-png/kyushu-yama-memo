// 計画タブ: 日の出・日没(計算)、出発と下山の目安、天気(Open-Meteo)、持ち物チェックリスト
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var root = $('v-plan');
  var WX_KEY = 'yama-wx', PACK_KEY = 'yama-pack', PREF_KEY = 'yama-plan-pref';
  var BEGINNER = 1.3;     // 初心者は目安時間の約1.3倍かかると見る
  var REST_MIN = 30;      // 休憩・景色の時間
  var SAFETY_MIN = 30;    // 日没のこれだけ前に下山を終える

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(min) { min = Math.round(min); return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60); }
  function toMin(s) { var p = (s || '').split(':'); return p.length === 2 ? +p[0] * 60 + +p[1] : NaN; }
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---- 日の出・日没(アメリカ海洋大気庁の簡易式。通信なしで、日本時間の分で返す)
  function sun(dateStr, lat, lon) {
    var p = dateStr.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    var N = Math.round((d - Date.UTC(+p[0], 0, 0)) / 86400000), g = 2 * Math.PI / 365 * (N - 1);
    var eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var la = lat * Math.PI / 180, c = (Math.cos(90.833 * Math.PI / 180) / (Math.cos(la) * Math.cos(dec))) - Math.tan(la) * Math.tan(dec);
    if (c > 1 || c < -1) return null;
    var ha = Math.acos(c) * 180 / Math.PI;
    return { rise: 720 - 4 * (lon + ha) - eq + 540, set: 720 - 4 * (lon - ha) - eq + 540 };
  }

  // ---- 持ち物(コースの標高・時間と、月から、内容を変える)
  function packItems(c, dateStr) {
    var m = +dateStr.split('-')[1], top = c.stats.eleTop, hrs = c.stats.min / 60 * BEGINNER;
    var winter = m === 12 || m <= 2, cold = winter || ((m <= 4 || m >= 10) && top >= 900) || m === 11 || m === 3;
    var summer = m >= 6 && m <= 9, water = Math.max(0.5, Math.ceil((hrs * 0.5 + 0.3) * 2) / 2);
    var L = [
      ['歩く', 'shoes', '登山靴(なければ、底が厚く滑りにくい靴)', true, 'スニーカーは濡れた土や岩で滑りやすい'],
      ['歩く', 'socks', '厚手の靴下と、予備の靴下', false, 'マメを防ぎ、濡れたときに替えられる'],
      ['歩く', 'pole', 'ストック(あれば)', false, '下りで膝の負担が減る'],
      ['飲食', 'water', '水・お茶 ' + water.toFixed(1) + 'L ぐらい', true, 'めやす: 歩く時間×約0.5L + 予備。夏は多めに'],
      ['飲食', 'food', '行動食(チョコ・ナッツ・おにぎりなど)', true, '歩きながら、こまめに食べる。昼食は別に'],
      ['服装', 'rain', 'レインウェア(上下)', true, '雨だけでなく、風よけと防寒にもなる。傘は両手が塞がり不向き'],
      ['服装', 'hat', '帽子', true, '日差しと、枝・小さな落石から頭を守る'],
      ['服装', 'glove', '手袋(軍手でもよい)', false, '岩や鎖をつかむとき、転んだときに手を守る'],
      ['服装', 'towel', 'タオル', false, '汗ふきと、日焼け・寒さ対策の首巻きに'],
      ['道具', 'bag', 'リュック(両手が空くもの)', true, '手が空くと、転んだときに手をつける'],
      ['道具', 'phone', 'スマホ(このアプリ・地図は出発前に保存)', true, '圏外でも地図と現在地は使える。機内モードで電池を節約'],
      ['道具', 'bat', 'モバイルバッテリーと充電ケーブル', true, '寒いと電池の減りが早い'],
      ['道具', 'light', 'ヘッドライト(予備の電池も)', true, '予定が遅れて暗くなったときの命綱。スマホのライトは電池を使う'],
      ['道具', 'paper', '紙の地図とコンパス(または印刷した地図)', false, '電池切れ・故障の保険'],
      ['道具', 'whistle', '笛(ホイッスル)', false, '声より遠くまで届き、救助を呼べる'],
      ['衛生・安全', 'bag2', 'ゴミ袋・ティッシュ', true, 'ゴミは持ち帰る。トイレがないこともある'],
      ['衛生・安全', 'med', '常備薬、絆創膏、テーピング', false, 'マメ・靴ずれ・擦り傷用'],
      ['衛生・安全', 'cash', '現金(小銭)・保険証のコピー', false, '駐車場代、トイレの協力金、けがの受診に'],
      ['衛生・安全', 'plan', '家族や友人に、行き先と下山予定時刻を伝える', true, '下山が遅れたとき、気づいてもらえる']
    ];
    if (cold) L.push(['服装', 'warm', '防寒着(フリース・薄手のダウン)', true, '山頂は麓より気温が低い(標高100mで約0.6℃)。止まると体が冷える']);
    else L.push(['服装', 'warm', '羽織れる薄手の上着', false, '休憩で汗が冷えて、体が冷える']);
    if (winter || (top >= 900 && m <= 3)) L.push(['服装', 'glove2', '防寒用の手袋・ネックウォーマー', true, '冬の稜線は風で体感温度が大きく下がる'], ['道具', 'ice', '凍結や雪の情報の確認(滑り止めが必要な日は中止も)', true, '初心者向けの山でも、凍結すると難度が上がる']);
    if (summer) L.push(['服装', 'change', '着替え(特に下着・シャツ)', false, '汗で冷えるのを防ぐ。下山後の車での着替えにも'], ['衛生・安全', 'bug', '虫よけ・日焼け止め', false, '夏はブヨ・アブ・ヤマビルがいる山もある'], ['飲食', 'salt', '塩分(塩飴・タブレット)', true, '汗で塩分が出る。水だけだと体調を崩すことがある']);
    if (m >= 9 && m <= 11) L.push(['衛生・安全', 'bug', '虫よけ(ハチに注意)', false, '秋はスズメバチが活発']);
    return L;
  }

  // ---- 天気(Open-Meteo)。取得した結果は端末に残し、通信がないときも最後の分を見られる
  var WX = { 0: '快晴', 1: '晴れ', 2: '薄曇り', 3: '曇り', 45: '霧', 48: '霧', 51: '霧雨', 53: '霧雨', 55: '霧雨', 56: '凍る霧雨', 57: '凍る霧雨', 61: '雨', 63: '雨', 65: '強い雨', 66: '凍る雨', 67: '凍る雨', 71: '雪', 73: '雪', 75: '強い雪', 77: '雪', 80: 'にわか雨', 81: 'にわか雨', 82: '激しい雨', 85: 'にわか雪', 86: 'にわか雪', 95: '雷雨', 96: '雷雨', 99: '雷雨' };
  function fetchWx(c, dateStr) {
    var p0 = c.route.points[0], key = c.id + '|' + dateStr;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p0[0] + '&longitude=' + p0[1] + '&elevation=' + c.stats.eleTop +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=Asia%2FTokyo&start_date=' + dateStr + '&end_date=' + dateStr;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (j) {
      var all = load(WX_KEY, {}); all[key] = { t: Date.now(), j: j }; save(WX_KEY, all); return { t: Date.now(), j: j, fresh: true };
    }).catch(function () { var s = load(WX_KEY, {})[key]; if (s) { s.fresh = false; return s; } throw new Error('none'); });
  }
  function rows(j, fromH, toH) {
    var h = j.hourly, out = [];
    for (var i = 0; i < h.time.length; i++) {
      var hr = +h.time[i].slice(11, 13);
      if (hr >= fromH && hr <= toH) out.push({ hr: hr, t: h.temperature_2m[i], pop: h.precipitation_probability[i], rain: h.precipitation[i], code: h.weather_code[i], w: h.wind_speed_10m[i], g: h.wind_gusts_10m[i] });
    }
    return out;
  }
  function judge(r) { // 登山に向いているかの目安(3段階)
    var lv = 0, why = [];
    function up(l, s) { lv = Math.max(lv, l); why.push(s); }
    var maxPop = Math.max.apply(null, r.map(function (x) { return x.pop || 0; })), maxW = Math.max.apply(null, r.map(function (x) { return x.w; })),
        maxG = Math.max.apply(null, r.map(function (x) { return x.g; })), minT = Math.min.apply(null, r.map(function (x) { return x.t; })),
        rain = r.reduce(function (a, x) { return a + (x.rain || 0); }, 0);
    if (r.some(function (x) { return x.code >= 95; })) up(2, '雷雨の予報があります');
    if (maxPop >= 70 || rain >= 5) up(2, '雨の可能性が高い(降水確率 最大' + maxPop + '%)'); else if (maxPop >= 40) up(1, '雨が降る可能性があります(降水確率 最大' + maxPop + '%)');
    if (maxW >= 10 || maxG >= 15) up(2, '風が強い(平均 最大' + maxW.toFixed(0) + 'm/s、突風 最大' + maxG.toFixed(0) + 'm/s)'); else if (maxW >= 7 || maxG >= 10) up(1, 'やや風があります(平均 最大' + maxW.toFixed(0) + 'm/s)');
    if (minT <= 0) up(2, '気温が0℃以下(凍結の可能性)'); else if (minT <= 5) up(1, '気温が低い(最低' + minT.toFixed(0) + '℃)。防寒を');
    return { lv: lv, why: why };
  }

  // ---- 画面
  var cur = { c: null, date: '', start: '08:00' };
  function init() {
    var pref = load(PREF_KEY, {});
    cur.start = pref.start || '08:00';
    root.innerHTML = '<section class="panel" id="pl-body"></section>';
  }
  function render() {
    var c = window.Yama.course, plan = window.Yama.plans()[c.id];
    if (cur.c !== c) { cur.c = c; cur.date = (plan && plan.status === 'planned' && plan.date) || ymd(new Date()); }
    var p0 = c.route.points[0], sn = sun(cur.date, p0[0], p0[1]), S = c.stats;
    var body = $('pl-body');
    var sel = '<label class="small">コース <select id="pl-course" aria-label="コース">' +
      window.COURSES.map(function (x) { return '<option value="' + x.id + '"' + (x.id === c.id ? ' selected' : '') + '>' + x.name + '</option>'; }).join('') + '</select></label>';
    body.innerHTML =
      '<div class="row">' + sel + '<label class="small">日付 <input type="date" id="pl-date" value="' + cur.date + '"></label>' +
      '<label class="small">出発 <input type="time" id="pl-start" value="' + cur.start + '"></label></div>' +
      '<p class="small" style="margin:0">' + statLine(S) + '</p>' +
      '<h2>日の出・日没と、時間の目安</h2><div id="pl-sun"></div>' +
      '<h2>天気</h2><div id="pl-wx"><p class="small">読み込み中…</p></div>' +
      '<h2>持ち物</h2><div id="pl-pack"></div>' +
      '<h2>登山計画書</h2><p class="small" style="margin:0 0 8px">この日付・出発時刻・持ち物から、家族や友人に伝えるための計画書をつくります。</p><button type="button" class="btn" id="pl-sheet">計画書をつくる・見る</button>';
    $('pl-course').addEventListener('change', function () { window.Yama.select(this.value); });
    $('pl-date').addEventListener('change', function () { if (this.value) { cur.date = this.value; render(); } });
    $('pl-start').addEventListener('change', function () { if (this.value) { cur.start = this.value; save(PREF_KEY, { start: cur.start }); renderSun(); } });
    renderSun(); renderPack(); renderWx();
    $('pl-sheet').addEventListener('click', function () { window.showTab('sheet'); });
  }
  function renderSun() {
    var c = cur.c, p0 = c.route.points[0], sn = sun(cur.date, p0[0], p0[1]), S = c.stats, box = $('pl-sun');
    if (!sn) { box.textContent = '日の出・日没を計算できませんでした。'; return; }
    var st = toMin(cur.start), loop = c.kind === '周回';
    var dur = S.min * BEGINNER + REST_MIN, end = st + dur, goal = sn.set - SAFETY_MIN;
    var half = (S.min / 2) * BEGINNER, turn = goal - half;
    var ok = end <= goal, lv = ok ? (goal - end < 30 ? 1 : 0) : 2;
    var msg = ok ? (lv ? '日没に近い計画です。出発を早めると安心です。' : '日没まで余裕があります。') : '日没までに下山できない可能性があります。出発を早めるか、別の日にしましょう。';
    box.innerHTML =
      '<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><b>' + hm(sn.rise) + '</b><span>日の出</span></div><div><b>' + hm(sn.set) + '</b><span>日没</span></div><div><b>' + hm(goal) + '</b><span>下山を終える目標</span></div></div>' +
      '<div class="status ' + (lv === 0 ? 'ok' : (lv === 1 ? '' : 'warn')) + '" style="margin-top:10px">出発 ' + hm(st) + ' の場合、初心者の目安(時間×' + BEGINNER + '倍 + 休憩' + REST_MIN + '分)で、' + window.fmtMin(Math.round(dur / 5) * 5) + 'かかり、<b>' + hm(end) + '</b>ごろに終わります。' + msg +
      (loop ? '' : '<br>折り返す目安の時刻は <b>' + hm(turn) + '</b> です。山頂に着いていなくても、この時刻になったら引き返します。') + '</div>' +
      '<p class="small">日没は計算値です。谷や山の陰では、これより早く暗くなります。出発が日の出前だと、足元が見えにくくなります。</p>';
  }
  function renderPack() {
    var c = cur.c, items = packItems(c, cur.date), saved = load(PACK_KEY, {}), mine = saved[c.id] || {}, box = $('pl-pack'), last = '';
    var done = items.filter(function (i) { return mine[i[1]]; }).length;
    var html = '<div class="row" style="justify-content:space-between"><span class="chip' + (done === items.length ? ' ok' : '') + '">' + done + ' / ' + items.length + ' 準備ずみ</span><button type="button" class="mini" id="pk-reset">チェックを外す</button></div>';
    items.forEach(function (i) {
      if (i[0] !== last) { html += '<h3 class="grp">' + i[0] + '</h3>'; last = i[0]; }
      html += '<button type="button" class="check" role="checkbox" aria-checked="' + !!mine[i[1]] + '" data-id="' + i[1] + '"><span class="box">' + (mine[i[1]] ? '✓' : '') + '</span><span><span class="t">' + i[2] + (i[3] ? ' <i class="must">必須</i>' : '') + '</span><em>' + i[4] + '</em></span></button>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.check').forEach(function (b) {
      b.addEventListener('click', function () {
        var all = load(PACK_KEY, {}), m = all[c.id] || {}, id = b.dataset.id;
        if (m[id]) delete m[id]; else m[id] = 1;
        all[c.id] = m; save(PACK_KEY, all); renderPack();
      });
    });
    $('pk-reset').addEventListener('click', function () { var all = load(PACK_KEY, {}); delete all[c.id]; save(PACK_KEY, all); renderPack(); });
  }
  function renderWx() {
    var c = cur.c, box = $('pl-wx'), today = new Date(), d = new Date(cur.date + 'T00:00:00'), days = (d - new Date(ymd(today) + 'T00:00:00')) / 86400000;
    var links = '<p class="small">公式の予報も必ず確認してください: <a href="https://www.jma.go.jp/bosai/forecast/" target="_blank" rel="noopener">気象庁 天気予報</a> / <a href="https://tenki.jp/mountain/" target="_blank" rel="noopener">tenki.jp 登山天気</a></p>';
    if (days < 0) { box.innerHTML = '<p class="small">過去の日付です。</p>' + links; return; }
    if (days > 15) { box.innerHTML = '<p class="small">天気予報は、約2週間先まで表示できます。近くなったら確認してください。</p>' + links; return; }
    var p0 = c.route.points[0], sn = sun(cur.date, p0[0], p0[1]), toH = sn ? Math.floor((sn.set) / 60) : 17;
    var myC = c, myDate = cur.date;
    fetchWx(c, cur.date).then(function (w) {
      if (cur.c !== myC || cur.date !== myDate) return;
      var r = rows(w.j, 6, Math.min(toH, 19)), act = rows(w.j, Math.max(6, Math.floor(toMin(cur.start) / 60)), toH);
      if (!r.length) throw new Error('empty');
      var jd = judge(act.length ? act : r), names = ['登山に向いた天気です', '注意が必要です', '登山は避けるのが無難です'];
      var html = '<div class="status ' + (jd.lv === 0 ? 'ok' : (jd.lv === 1 ? '' : 'warn')) + '"><b>' + names[jd.lv] + '</b>(目安)' + (jd.why.length ? '<ul class="why">' + jd.why.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '<br>出発から日没までの、雨・風・気温に大きな問題は見えません。') + '</div>';
      html += '<div class="wxwrap"><table class="wx"><thead><tr><th>時刻</th><th>天気</th><th>気温</th><th>雨</th><th>風</th></tr></thead><tbody>';
      r.filter(function (x) { return x.hr % 2 === 0; }).forEach(function (x) {
        html += '<tr><td>' + x.hr + '時</td><td>' + (WX[x.code] || '-') + '</td><td>' + x.t.toFixed(0) + '℃</td><td>' + (x.pop == null ? '-' : x.pop + '%') + '</td><td>' + x.w.toFixed(0) + 'm/s</td></tr>';
      });
      html += '</tbody></table></div><p class="small">気温は山頂付近(標高' + c.stats.eleTop + 'm)に補正した値です。' + (w.fresh ? '' : '<b>通信できないため、前に取得した予報を表示しています。</b>') + ' 取得: ' + new Date(w.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' / データ: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p><p class="small">山の天気は急に変わります。雨雲や雷の気配がしたら、予定を変えて引き返します。</p>' + links;
      box.innerHTML = html;
    }).catch(function () { box.innerHTML = '<p class="small">天気を取得できませんでした。通信を確認してください。</p>' + links; });
  }

  init();
  window.Yama.onCourse(function () { if (!root.hidden) render(); });
  window.addEventListener('yama:tab', function (e) { if (e.detail === 'plan') render(); });
  window.PlanApi = { cur: cur, sun: sun, hm: hm, toMin: toMin, packItems: packItems, BEGINNER: BEGINNER, REST_MIN: REST_MIN, SAFETY_MIN: SAFETY_MIN };
})();
