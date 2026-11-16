/* Дополнения страницы телефона: кнопка «На весь экран», одноразовая подсказка
   для iPhone, «экран не гаснет» (Wake Lock) и запоминание последней сессии.
   Чистые помощники проверяются в Node тестами, кнопки и пробуждение — check:remote.
   Ключ и sid хранятся только в localStorage этого телефона. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RemoteExtras = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  var SAVED_KEY = 'remoteLastSession';
  var IOS_HINT_KEY = 'remoteIosHint';
  var EXPAND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z"/></svg>';
  var COMPRESS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h4V4h2v6H4zM14 4h2v4h4v2h-6zM4 14h6v6H8v-4H4zM14 14h6v2h-4v4h-2z"/></svg>';

  function defaultStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
  }

  function storageOf(win) {
    try { return win && win.localStorage ? win.localStorage : defaultStorage(); } catch (e) { return defaultStorage(); }
  }

  // #sid.ключ или #sid.ключ.номер облака (№0 — без номера) — тот же вид, что в адресе.
  function parseAddress(hash) {
    var m = /^#([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(?:\.(\d{1,4}))?$/.exec(String(hash || ''));
    if (!m) return null;
    return { sid: m[1], key: m[2], cloud: m[3] == null ? 0 : Number(m[3]) };
  }

  function readSaved(storage) {
    storage = storage || defaultStorage();
    if (!storage) return null;
    try {
      var raw = storage.getItem(SAVED_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      var cloud = obj.cloud == null ? 0 : Number(obj.cloud);
      if (!Number.isInteger(cloud) || cloud < 0 || cloud > 9999) return null;
      return parseAddress('#' + String(obj.sid || '') + '.' + String(obj.key || '') + (cloud ? '.' + cloud : ''));
    } catch (e) {
      return null;
    }
  }

  function saveSaved(parsed, storage) {
    if (!parsed || !parsed.sid || !parsed.key) return false;
    storage = storage || defaultStorage();
    if (!storage) return false;
    try {
      storage.setItem(SAVED_KEY, JSON.stringify({
        sid: parsed.sid,
        key: parsed.key,
        cloud: Number(parsed.cloud) || 0,
        mode: parsed.mode === 'lan' || parsed.mode === 'cloud' ? parsed.mode : 'cloud'
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearSaved(storage) {
    storage = storage || defaultStorage();
    if (!storage) return false;
    try { storage.removeItem(SAVED_KEY); return true; } catch (e) { return false; }
  }

  // iPhone/iPad (в том числе iPadOS, который представляется Mac с сенсорным экраном).
  function isIosBrowser(ua, maxTouchPoints) {
    var s = String(ua || '');
    if (/iPhone|iPad|iPod/i.test(s)) return true;
    return /Macintosh/i.test(s) && Number(maxTouchPoints) > 1;
  }

  // Страница открыта со значка: без адресной строки, кнопка полного экрана не нужна.
  function isStandalone(win) {
    try {
      if (win && typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* нет matchMedia — смотрим navigator.standalone */ }
    return !!(win && win.navigator && win.navigator.standalone);
  }

  function fullscreenSupported(doc) {
    return !!(doc && doc.fullscreenEnabled && doc.documentElement &&
      typeof doc.documentElement.requestFullscreen === 'function');
  }

  function paintButton(btn, doc) {
    var fs = !!(doc && doc.fullscreenElement);
    var label = fs ? 'Выйти из полноэкранного режима' : 'На весь экран';
    btn.innerHTML = fs ? COMPRESS_SVG : EXPAND_SVG;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-pressed', fs ? 'true' : 'false');
  }

  function toggleFullscreen(doc) {
    try {
      if (doc.fullscreenElement) {
        if (typeof doc.exitFullscreen === 'function') return doc.exitFullscreen();
        return null;
      }
      if (doc.documentElement && typeof doc.documentElement.requestFullscreen === 'function') {
        return doc.documentElement.requestFullscreen();
      }
    } catch (e) { /* браузер отказал — молча */ }
    return null;
  }

  function initFullscreen(doc, win) {
    var btn = doc && doc.getElementById('fsBtn');
    if (!btn) return null;
    var ios = isIosBrowser(win.navigator && win.navigator.userAgent, win.navigator && win.navigator.maxTouchPoints);
    if (ios || isStandalone(win) || !fullscreenSupported(doc)) {
      btn.hidden = true;
      return btn;
    }
    btn.hidden = false;
    paintButton(btn, doc);
    btn.addEventListener('click', function () {
      var p = toggleFullscreen(doc);
      if (p && typeof p.catch === 'function') p.catch(function () { /* отказ — молча */ });
    });
    doc.addEventListener('fullscreenchange', function () { paintButton(btn, doc); });
    return btn;
  }

  function initIosHint(doc, win) {
    var hint = doc && doc.getElementById('iosHint');
    if (!hint) return null;
    var close = doc.getElementById('iosHintClose');
    var ios = isIosBrowser(win.navigator && win.navigator.userAgent, win.navigator && win.navigator.maxTouchPoints);
    var storage = storageOf(win);
    var seen = false;
    try { seen = !!storage && storage.getItem(IOS_HINT_KEY) === '1'; } catch (e) { seen = false; }
    if (!ios || isStandalone(win) || seen) {
      hint.hidden = true;
      return hint;
    }
    hint.hidden = false;
    try { if (storage) storage.setItem(IOS_HINT_KEY, '1'); } catch (e) { /* приватный режим */ }
    if (close) {
      close.addEventListener('click', function () { hint.hidden = true; });
    }
    return hint;
  }

  // Экран не гаснет, пока страница видна и есть связь. Нет API или отказ — молча.
  // Wake Lock браузер даёт только защищённой странице (https). В режиме «По Wi-Fi» пульт открыт по
  // http://192.168… — API нет, поэтому (16.11) запасной путь: крошечное беззвучное видео по кругу
  // (keepawake.webm / .mp4 рядом со страницей). Пока оно играет, телефон экран не гасит. Без касания
  // браузер может не дать запустить видео — тогда запускаем при первом касании экрана.
  function createVideoKeeper(doc) {
    if (!doc || typeof doc.createElement !== 'function') return null;
    var video = null, armed = false, want = false, tick = 0;
    function make() {
      if (video) return video;
      var v = doc.createElement('video');
      if (!v || typeof v.play !== 'function') return null;
      v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      v.setAttribute('aria-hidden', 'true'); v.setAttribute('tabindex', '-1');
      v.setAttribute('style', 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1');
      [['keepawake.webm', 'video/webm'], ['keepawake.mp4', 'video/mp4']].forEach(function (f) {
        var src = doc.createElement('source'); src.src = f[0]; src.type = f[1]; v.appendChild(src);
      });
      if (doc.body && typeof doc.body.appendChild === 'function') doc.body.appendChild(v);
      video = v;
      return v;
    }
    function onTouch() { disarm(); if (want) start(); }
    function arm() {
      if (armed || typeof doc.addEventListener !== 'function') return;
      armed = true;
      doc.addEventListener('touchend', onTouch, true);
      doc.addEventListener('click', onTouch, true);
    }
    function disarm() {
      if (!armed) return;
      armed = false;
      doc.removeEventListener('touchend', onTouch, true);
      doc.removeEventListener('click', onTouch, true);
    }
    function start() {
      want = true;
      var v = make(); if (!v) return;
      try {
        var p = v.play();
        if (p && typeof p.then === 'function') p.then(function () { disarm(); }).catch(function () { arm(); });
      } catch (e) { arm(); }
      // iPhone останавливает «пустое» зацикленное видео — время сдвигаем сами
      if (!tick && typeof setInterval === 'function') tick = setInterval(function () {
        if (video && want && !video.paused && video.currentTime > 1) video.currentTime = 0.1;
      }, 15000);
    }
    function stop() {
      want = false;
      disarm();
      if (tick && typeof clearInterval === 'function') { clearInterval(tick); tick = 0; }
      if (video) { try { video.pause(); } catch (e) { /* уже стоит */ } }
    }
    return { start: start, stop: stop, playing: function () { return !!(video && want && !video.paused); } };
  }

  function createWakeLock(win) {
    var doc = win && win.document;
    var nav = win && win.navigator;
    var sentinel = null;
    var connected = false;
    var hasApi = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
    var keeper = null;

    function canRequest() {
      return !!(doc && !doc.hidden && connected && hasApi);
    }
    function shouldKeep() { return !!(doc && !doc.hidden && connected); }
    function useVideo() {
      if (!keeper) keeper = createVideoKeeper(doc);
      if (keeper) keeper.start();
    }
    function stopVideo() { if (keeper) keeper.stop(); }

    function release() {
      var s = sentinel;
      sentinel = null;
      stopVideo();
      if (!s || typeof s.release !== 'function') return;
      try {
        var p = s.release();
        if (p && typeof p.catch === 'function') p.catch(function () { /* уже отпущен */ });
      } catch (e) { /* уже отпущен */ }
    }

    function request() {
      if (!shouldKeep()) return;
      if (!hasApi) { useVideo(); return; }
      if (sentinel) return;
      try {
        var p = nav.wakeLock.request('screen');
        if (!p || typeof p.then !== 'function') return;
        p.then(function (s) {
          sentinel = s || null;
          if (!canRequest()) { release(); return; }
          stopVideo();
          if (s && typeof s.addEventListener === 'function') {
            s.addEventListener('release', function () {
              if (sentinel === s) sentinel = null;
              if (canRequest()) request();
            });
          }
        }).catch(function () { sentinel = null; if (shouldKeep()) useVideo(); });
      } catch (e) { if (shouldKeep()) useVideo(); }
    }

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', function () {
        if (doc.hidden) release();
        else request();
      });
    }

    return {
      setConnected: function (on) {
        connected = !!on;
        if (connected) request();
        else release();
      },
      request: request,
      release: release,
      state: function () { return { connected: connected, locked: !!sentinel, video: !!(keeper && keeper.playing()) }; }
    };
  }

  function initPageExtras(doc, win) {
    initFullscreen(doc, win);
    initIosHint(doc, win);
  }

  if (root && root.document) initPageExtras(root.document, root);

  return {
    SAVED_KEY: SAVED_KEY,
    IOS_HINT_KEY: IOS_HINT_KEY,
    parseAddress: parseAddress,
    readSaved: readSaved,
    saveSaved: saveSaved,
    clearSaved: clearSaved,
    isIosBrowser: isIosBrowser,
    isStandalone: isStandalone,
    fullscreenSupported: fullscreenSupported,
    initFullscreen: initFullscreen,
    initIosHint: initIosHint,
    initPageExtras: initPageExtras,
    createWakeLock: createWakeLock
  };
});
