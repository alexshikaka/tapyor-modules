// Оверлей «DOS-терминал» для OBS: получает от Тапёра настройки, играющий трек и список (поток /overlay/events)
// и рисует их. Только читает — ничего в Тапёре не нажимает.
// Адрес: /overlay/playlist  ·  ?preview=1 — превью в настройках (не считается источником OBS)
//                           ·  ?demo=1 — демо-трек вместо живого, &paused=1 — демо на паузе
(function () {
  'use strict';
  var D = window.TapDos;
  var qs = new URLSearchParams(location.search);
  var PREVIEW = qs.get('preview') === '1', DEMO = qs.get('demo') === '1', DEMO_PAUSED = qs.get('paused') === '1';
  var TICK = 90;                                         // шаг анимации, мс (~11 кадров/с — экономно для OBS)

  function $(id) { return document.getElementById(id); }
  var ov = $('ov'), head = $('head'), cv = $('cov'), tline = $('tline'), labT = $('labT'), tval = $('tval'), meas = $('meas'),
    aline = $('aline'), sline = $('sline'), osc = $('osc'), prog = $('prog'), queue = $('queue');

  var S = { cfg: null, np: null, next: [], lv: 0, lvAt: 0, smooth: 0.15, hist: [], tick: 0, title: null, artist: null,
    coverUrl: null, coverOk: false, status: null, prog: -1, queueSig: null, fitKey: null };

  var bars = [], cells = [];
  for (var i = 0; i < D.OSC; i++) { var b = document.createElement('i'); osc.appendChild(b); bars.push(b); S.hist.push(1); }
  for (var j = 0; j < D.CELLS; j++) { var c = document.createElement('i'); prog.appendChild(c); cells.push(c); }

  // ----- демо-трек (превью без живых данных) -----
  var DEMO_AT = Date.now();
  var DEMO_NEXT = [['Хочешь?', 'Земфира'], ['Midnight City', 'M83'], ['Выхода нет', 'Сплин'], ['Instant Crush', 'Daft Punk'],
    ['Владивосток 2000', 'Мумий Тролль'], ['Heat Waves', 'Glass Animals'], ['Последний герой', 'Кино'], ['Dreams', 'Fleetwood Mac'],
    ['Genesis', 'Grimes'], ['Знаешь ли ты', 'МакSим']].map(function (x) { return { title: x[0], artist: x[1] }; });
  function demoNp() {
    var dur = 243, p = (92 + (Date.now() - DEMO_AT) / 1000) % dur;
    return { title: 'Группа крови', artist: 'Кино', cover: '', pos: DEMO_PAUSED ? 92 : p, dur: dur, playing: !DEMO_PAUSED, at: Date.now() };
  }

  // ----- настройки: цвет, угол, что показывать -----
  function applyCfg(cfg) {
    var pl = D.place(cfg.pos), st = D.boxStyle(cfg);
    ov.dataset.v = pl.v; ov.dataset.h = pl.h;
    ov.style.setProperty('--c', cfg.color);
    ov.style.setProperty('--c0', cfg.color + '40');
    for (var k in st) ov.style[k] = st[k];
    ov.classList.toggle('outline', !!cfg.outline);
    ov.classList.toggle('nocov', !cfg.cover);
    ov.classList.toggle('no-osc', !cfg.osc);
    ov.classList.toggle('no-prog', !cfg.prog);
    S.status = null; S.queueSig = null; S.fitKey = null;
    if (!S.coverOk) drawDisc();
  }

  // ----- обложка: пикселизуем под стиль (16×16), нет обложки — пластинка в цвет терминала -----
  function drawDisc() {
    var g = cv.getContext('2d'), col = (S.cfg && S.cfg.color) || '#FFB000', dark = '#140C00';
    g.fillStyle = dark; g.fillRect(0, 0, 16, 16);
    g.fillStyle = col;
    [[5, 0, 6, 1], [3, 1, 10, 1], [2, 2, 12, 1], [1, 3, 14, 2], [0, 5, 16, 6], [1, 11, 14, 2], [2, 13, 12, 1], [3, 14, 10, 1], [5, 15, 6, 1]]
      .forEach(function (r) { g.fillRect(r[0], r[1], r[2], r[3]); });
    g.fillStyle = dark;
    [[6, 6, 4, 4], [7, 5, 2, 1], [7, 10, 2, 1], [5, 7, 1, 2], [10, 7, 1, 2]].forEach(function (r) { g.fillRect(r[0], r[1], r[2], r[3]); });
    g.globalAlpha = 0.6;
    [[3, 7, 1, 2], [12, 7, 1, 2], [7, 3, 2, 1], [7, 12, 2, 1]].forEach(function (r) { g.fillRect(r[0], r[1], r[2], r[3]); });
    g.globalAlpha = 1;
    g.fillStyle = col; g.fillRect(7, 7, 2, 2);
  }
  function setCover(url) {
    if (url === S.coverUrl) return;
    S.coverUrl = url; S.coverOk = false;
    if (!url) { drawDisc(); return; }
    var img = new Image();
    img.onload = function () {
      if (S.coverUrl !== url) return;
      var g = cv.getContext('2d');
      g.imageSmoothingEnabled = true;                     // уменьшаем со сглаживанием — цвета усредняются, как у пикселей
      var s = Math.min(img.naturalWidth, img.naturalHeight) || 1;
      g.clearRect(0, 0, 16, 16);
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 16, 16);
      S.coverOk = true;
    };
    img.onerror = function () { if (S.coverUrl === url) drawDisc(); };
    img.src = url;
    drawDisc();                                           // пока грузится — пластинка
  }

  // ----- название: бегущая строка, только если не влезает в длинную строку -----
  function fitTitle() {
    var t = S.title || '', key = t + '|' + (S.cfg && S.cfg.marq) + '|' + tline.clientWidth + '|' + labT.textContent;
    if (key === S.fitKey) return;
    S.fitKey = key;
    meas.textContent = t;
    var room = tline.clientWidth - labT.offsetWidth;
    var long = !!(S.cfg && S.cfg.marq) && room > 0 && meas.offsetWidth > room;
    var gap = '      ';
    tval.textContent = long ? t + gap + t + gap : t;
    tval.classList.toggle('mq', long);
    if (long) tval.style.setProperty('--mqs', Math.max(6, Math.round(meas.offsetWidth / 45)) + 's');
  }

  function setText(np) {
    var L = D.labels(S.cfg.lang);
    var changed = np.title !== S.title || np.artist !== S.artist;
    var apply = function () {
      S.title = np.title; S.artist = np.artist;
      labT.textContent = L.track;
      aline.textContent = L.artist + (np.artist || '—');
      S.fitKey = null; fitTitle();
    };
    if (changed && S.title !== null) {
      head.classList.add('swap');                         // плавная смена трека
      setTimeout(function () { apply(); head.classList.remove('swap'); }, 250);
    } else apply();
    if (labT.textContent !== L.track) { labT.textContent = L.track; aline.textContent = L.artist + (np.artist || '—'); S.fitKey = null; }
  }

  function renderQueue() {
    var cfg = S.cfg, list = (S.next || []).slice(0, cfg.count);
    var sig = JSON.stringify(list) + cfg.nums;
    if (sig === S.queueSig) return;
    S.queueSig = sig;
    queue.textContent = '';
    list.forEach(function (it, i) {
      var d = document.createElement('div');
      d.textContent = D.rowText(it, i, cfg.nums);
      d.style.opacity = D.fadeAt(i, cfg.fade !== false, cfg.fadePct);
      queue.appendChild(d);
    });
  }

  function current() { return DEMO ? demoNp() : S.np; }

  function render() {
    if (!S.cfg) return;
    var np = current();
    ov.hidden = !np;                                      // ничего не играет — оверлея нет; на паузе — остаётся
    if (!np) return;
    setText(np);
    if (S.cfg.cover) setCover(np.cover || '');
    renderQueue();
    frame(true);
  }

  // ----- каждые 90 мс: время, вертушка, прогресс, осциллограмма -----
  function frame(force) {
    var np = current(), cfg = S.cfg;
    if (!np || !cfg) return;
    var now = Date.now(), pos = D.posAt(np, now), paused = !np.playing;
    if (!force) S.tick++;
    var st = D.statusText({ lang: cfg.lang, paused: paused, spin: cfg.spin, time: cfg.time, pos: pos, dur: np.dur, tick: Math.floor(now / 150) });
    if (st !== S.status) {
      S.status = st;
      sline.textContent = '';
      D.cells(st).forEach(function (ch) { var s = document.createElement('span'); s.textContent = ch; sline.appendChild(s); });
      sline.classList.toggle('paused', paused);
      sline.hidden = !st;
    }
    var n = D.progressCount(pos, np.dur, D.CELLS);
    if (n !== S.prog) { S.prog = n; for (var i = 0; i < cells.length; i++) cells[i].classList.toggle('on', i < n); }
    if (cfg.osc && !paused && !force && S.tick % 2 === 0) {
      var real = cfg.viz === 'real' && now - S.lvAt < 1500;
      var lv = real ? S.lv : D.imitation(now / 300, Math.random());
      S.smooth += (lv - S.smooth) * D.smoothAlpha(cfg.smooth);
      S.hist.shift(); S.hist.push(D.barSteps(S.smooth));
      for (var k = 0; k < bars.length; k++) bars[k].style.height = (S.hist[k] * 12.5) + '%';
    }
  }

  // ----- связь с Тапёром -----
  var es = new EventSource('events' + (PREVIEW ? '?preview=1' : ''));
  es.onmessage = function (e) {
    var d; try { d = JSON.parse(e.data); } catch (x) { return; }
    if (!d || !d.cfg) return;
    var cfgChanged = JSON.stringify(d.cfg) !== JSON.stringify(S.cfg);
    S.cfg = d.cfg; S.np = d.np || null; S.next = DEMO ? DEMO_NEXT : (d.next || []);
    if (cfgChanged) applyCfg(S.cfg);
    render();
  };
  es.addEventListener('lv', function (e) { S.lv = Math.max(0, Math.min(1, Number(e.data) || 0)); S.lvAt = Date.now(); });

  setInterval(function () { frame(false); }, TICK);
  if (DEMO) setInterval(render, 1000);
  // Шрифт догрузился — ширины поменялись: перемерить название
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { S.fitKey = null; fitTitle(); });
  window.addEventListener('resize', function () { S.fitKey = null; fitTitle(); });
})();
