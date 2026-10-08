// 登山記録の保存先。いまは端末内(IndexedDB)。友人と共有するときは、このファイルの中身だけを
// ネット上のデータベースに差し替えれば、画面側(log.js)は変えずに済むようにしてある。
window.LogDB = (function () {
  'use strict';
  var NAME = 'yama-log', STORE = 'records', TRACKS = 'tracks', dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(NAME, 2);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: 'id' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function tx(mode, fn, store) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(store || STORE, mode), out = fn(t.objectStore(store || STORE));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  return {
    // 記録: {id, date, who, mountain, text, photos:[Blob], updated}
    all: function () {
      return tx('readonly', function (s) { return s.getAll(); }).then(function (a) {
        return (a || []).sort(function (x, y) { return (y.date + y.id).localeCompare(x.date + x.id); });
      });
    },
    put: function (rec) { rec.updated = Date.now(); return tx('readwrite', function (s) { s.put(rec); }); },
    remove: function (id) { return tx('readwrite', function (s) { s.delete(id); }); },
    get: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
    _tx: tx
  };
})();

// 歩いた軌跡の保存先(端末内)。points = [緯度, 経度, 時刻(ms), 精度m, 標高m または null]
window.TrackDB = (function () {
  'use strict';
  var S = 'tracks', T = window.LogDB;
  return {
    all: function () { return T._tx('readonly', function (s) { return s.getAll(); }, S).then(function (a) { return (a || []).sort(function (x, y) { return y.start - x.start; }); }); },
    put: function (t) { return T._tx('readwrite', function (s) { s.put(t); }, S); },
    get: function (id) { return T._tx('readonly', function (s) { return s.get(id); }, S); },
    remove: function (id) { return T._tx('readwrite', function (s) { s.delete(id); }, S); }
  };
})();
