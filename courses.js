// コースの一覧と、選んでいるコース。距離・標高・時間の目安は、ルートの座標と標高から自動で計算する(手で書かない)。
// 山を増やすときは、routes.js にルートを足し、下の COURSES に名前などを足す。
(function () {
  'use strict';
  function stats(route) {
    var pts = route.points, total = route.total, up = 0, down = 0, loop = route.type === 'loop';
    for (var i = 1; i < pts.length; i++) {
      var d = pts[i][3] - pts[i - 1][3];
      if (d > 0) up += d; else down -= d;
    }
    // 時間の目安: 水平 4km/h + 登り 600m/h を足す簡易式(休憩は含まない)。往復は行きと帰りの合計
    var legs = loop ? 1 : 2;
    var min = total / 4000 * 60 * legs + up / 600 * 60 + (loop ? 0 : down / 600 * 60);
    var top = Math.max.apply(null, pts.map(function (p) { return p[3]; }));
    return {
      kind: loop ? '周回' : '往復',
      distKm: Math.round(total * legs / 100) / 10,   // 往復・周回の全体の距離 km(小数1桁)
      eleStart: Math.round(pts[0][3]),                 // 登山口の標高 m
      eleTop: Math.round(top),                         // 最高点の標高 m
      up: Math.round(up / 10) * 10,                    // 登りの合計 m(往復は片道分)
      min: Math.round(min / 5) * 5                     // 全体の目安 分
    };
  }
  var META = [
    { id: 'ichinomine-ninomine', name: '一ノ峯・二ノ峯', area: '熊本県 阿蘇外輪山の麓' },
    { id: 'kusasenri-eboshidake', name: '草千里〜烏帽子岳', area: '熊本県 阿蘇 草千里',
      note: '周回の向きと、途中の分岐は下書きです。現地で確認してください。' },
    { id: 'taromaru', name: '太郎丸嶽', area: '熊本県 天草上島',
      note: '下書きでは、駐車場から登山道の入口まで約0.8kmが車道です。' },
    { id: 'jiromaru', name: '次郎丸嶽', area: '熊本県 天草上島',
      note: '下書きでは、駐車場から登山道の入口まで約0.8kmが車道です。太郎丸嶽とは別のコースとして登録しています。' }
  ];
  window.COURSES = META.filter(function (m) { return window.ROUTES[m.id]; }).map(function (m) {
    var r = window.ROUTES[m.id];
    return { id: m.id, name: m.name, area: m.area, note: m.note || '', kind: r.type === 'loop' ? '周回' : '往復', route: r, stats: stats(r) };
  });
  window.courseById = function (id) { return window.COURSES.filter(function (c) { return c.id === id; })[0] || null; };
  window.fmtMin = function (m) { return m < 60 ? m + '分' : Math.floor(m / 60) + '時間' + (m % 60 ? m % 60 + '分' : ''); };
  window.statLine = function (st) {
    return (st.kind || '往復') + ' ' + st.distKm.toFixed(1) + 'km ・ 標高 ' + st.eleStart + '→' + st.eleTop + 'm ・ 登り 約' + st.up + 'm ・ 目安 約' + window.fmtMin(st.min);
  };

  // ---- 選んでいるコース(地図タブに表示するもの)
  var listeners = [], cur = window.COURSES[0];
  try { cur = window.courseById(localStorage.getItem('yama-course')) || cur; } catch (e) {}
  window.Yama = {
    get course() { return cur; },
    select: function (id) {
      var c = window.courseById(id); if (!c) return;
      cur = c; try { localStorage.setItem('yama-course', id); } catch (e) {}
      listeners.forEach(function (f) { f(c); });
    },
    onCourse: function (f) { listeners.push(f); },
    // 予定(気になる / 計画中 と予定日)。いまはこの端末に保存
    plans: function () { try { return JSON.parse(localStorage.getItem('yama-plans') || '{}') || {}; } catch (e) { return {}; } },
    setPlan: function (id, p) { var a = this.plans(); if (p) a[id] = p; else delete a[id]; try { localStorage.setItem('yama-plans', JSON.stringify(a)); } catch (e) {} }
  };
})();
