// Демо-данные страниц оверлея для превью без ядра: ?demo=1&style=&pos=&nick=&long=&track=&paused=1,
// ?dx=&dy=&size= — проверка сдвига и размера.
// Чистые функции: работают на странице (window.TapDemo) и в Node (тесты).
(function (root) {
  'use strict';

  var TRACKS = {
    normal: { title: 'Группа крови', artist: 'Кино', who: 'dimon_play' },
    medium: { title: 'Звезда по имени Солнце', artist: 'Кино', who: 'kot_v_sapogah' },
    long: {
      title: "Set My Heart On Fire (I'm Alive x And The Beat Goes On) [Majestic VIP Mix]",
      artist: 'Majestic, The Jammin Kid & Céline Dion', who: 'очень_длинный_ник_зрителя'
    }
  };
  var ORDER = {
    normal: ['normal', 'medium', 'long'],
    medium: ['medium', 'normal', 'long'],
    long: ['long', 'medium', 'normal']
  };
  var QUEUE = [
    { title: 'Хочешь?', artist: 'Земфира', who: 'lera_k' },
    { title: 'Выхода нет', artist: 'Сплин', who: 'nastya_s' },
    { title: 'Владивосток 2000', artist: 'Мумий Тролль', who: 'kot_v_sapogah' },
    { title: 'Instant Crush', artist: 'Daft Punk' },
    { title: 'Dreams', artist: 'Fleetwood Mac', who: 'dimon_play' }
  ];
  // ?queue=long: очередь для проверки обрезки — очень длинная, средняя и короткая строки.
  var LONG_QUEUE = [
    { title: TRACKS.long.title, artist: TRACKS.long.artist, who: TRACKS.long.who },
    QUEUE[2],
    { title: 'Ночь', artist: 'Кино' }
  ];

  // ?feat=key:0,key:1 — проверка переключателей в Chromium: off/on для любого ключа.
  // Значения 0/1 — булевы, числа — числом, остальное (en/ru) — строкой.
  function parseFeat(s) {
    var out = {};
    String(s || '').split(',').forEach(function (part) {
      var i = part.indexOf(':');
      if (i <= 0) return;
      var k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
      if (!k || !v) return;
      if (v === '0' || v === 'off' || v === 'false') out[k] = false;
      else if (v === '1' || v === 'on' || v === 'true') out[k] = true;
      else if (/^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v);
      else out[k] = v;
    });
    return out;
  }

  function num(v, def, lo, hi) {
    var n = Number(v);
    if (v == null || v === '' || !isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function options(search) {
    var q = new URLSearchParams(search || '');
    var long = q.get('long') === '1';
    var track = q.get('track');
    if (!TRACKS[track]) track = long ? 'long' : 'normal';
    return {
      preview: q.get('preview') === '1',
      demo: q.get('demo') === '1',
      long: long,
      paused: q.get('paused') === '1',
      track: track,
      style: q.get('style') || '',
      pos: q.get('pos') || '',
      nick: q.get('nick'),
      // ?queue=long — длинная очередь для проверок обрезки строк.
      queue: q.get('queue') || '',
      // Сдвиг и размер для проверок: те же границы, что в настройках модуля.
      dx: num(q.get('dx'), 0, -900, 900),
      dy: num(q.get('dy'), 0, -500, 500),
      size: num(q.get('size'), 100, 80, 250),
      feat: parseFeat(q.get('feat'))
    };
  }

  // Обложки демо: страница может положить карту «название → адрес картинки» в TapDemoCovers
  // (так делает сайт Тапёра). Сам пак обложек не везёт — без карты обложки пустые, как раньше.
  function coverFor(title) {
    var m = typeof globalThis !== 'undefined' ? globalThis.TapDemoCovers : null;
    return m && typeof m[title] === 'string' ? m[title] : '';
  }
  function withCover(x) {
    var o = Object.assign({}, x), c = coverFor(o.title);
    if (c) o.cover = c;
    return o;
  }

  function np(kind, at, paused, now) {
    var base = TRACKS[kind] || TRACKS.normal;
    var dur = 243;
    var elapsed = Math.max(0, ((Number(now) || Date.now()) - (Number(at) || Date.now())) / 1000);
    var pos = paused ? 92 : (92 + elapsed) % dur;
    return {
      title: base.title, artist: base.artist, who: base.who, cover: coverFor(base.title),
      pos: pos, dur: dur, playing: !paused, at: Number(now) || Date.now()
    };
  }

  function list(kind) { return (ORDER[kind] || ORDER.normal).map(function (k) { return withCover(TRACKS[k]); }); }
  function queue(kind) {
    var src = kind === 'long' ? LONG_QUEUE : QUEUE;
    return src.map(withCover);
  }

  var api = { TRACKS: TRACKS, coverFor: coverFor, options: options, parseFeat: parseFeat, np: np, list: list, queue: queue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TapDemo = api;
})(typeof window !== 'undefined' ? window : this);
