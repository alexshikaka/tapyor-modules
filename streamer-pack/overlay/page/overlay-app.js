// Общая логика обеих страниц оверлея: плейлист и моушн.
// Данные — только из /overlay/events. Тексты ставятся через textContent.
(function () {
  'use strict';

  var K = window.TapKit, D = window.TapDos, C = window.TapColors, V = window.TapViz, M = window.TapMotionMath;
  var T = window.TapTextFit;
  var DEMO_LIB = window.TapDemo;
  var DOPT = DEMO_LIB.options(location.search);
  var PREVIEW = DOPT.preview;
  var DEMO = DOPT.demo;
  var DEMO_PAUSED = DOPT.paused;
  var TRACK = DOPT.track;
  var FORCE_STYLE = DOPT.style;
  var FORCE_POS = DOPT.pos;
  var FORCE_NICK = DOPT.nick;
  var MOTION = false;

  var ov = document.getElementById('ov');
  var idle = document.getElementById('idle');
  var DEFS = window.TapStyles || {};
  // Что у стиля реально есть (зеркало src/styles.js). Нет описания — работаем по-старому.
  var META = window.TapStyleMeta || {};
  var DEMO_FEATURE_KEYS = ['outline', 'nick', 'cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang',
    'count', 'fade', 'fadePct', 'fill', 'nums', 'viz', 'smooth'];

  function featuresOf(style) {
    var m = META[style];
    return m && Array.isArray(m.features) ? m.features : null;
  }
  // Ключ, которого у стиля нет, молча ничего не делает.
  function hasFeature(style, key) {
    var f = featuresOf(style);
    return !f || f.indexOf(key) >= 0;
  }
  function coverOn(cfg) {
    return hasFeature(cfg.style, 'cover') ? cfg.cover !== false : true;
  }
  function marqOn(cfg) {
    return hasFeature(cfg.style, 'marq') && cfg.marq !== false;
  }

  function pageDefaults() {
    return {
      style: 'dos', pos: 'br', dx: 0, dy: 0, size: 100,
      color: '#FFB000', vizColor: '#FFB000', outline: true, nick: true,
      count: 3, fade: true, fadePct: 100, nums: true, cover: true,
      time: true, osc: true, prog: true, marq: true, lang: 'en', viz: 'wave', smooth: 'mid',
      motion: {
        style: 'dos', pos: 'bc', dx: 0, dy: 0, size: 100,
        color: '#FFB000', vizColor: '#FFB000', outline: true, nick: true,
        scene: 'brand', hold: 5,
        cover: true, time: true, spin: true, prog: true, osc: true, marq: true,
        lang: 'en', viz: 'wave', smooth: 'mid'
      }
    };
  }

  var CFG = pageDefaults();
  var S = {
    np: null, next: [], lv: 0, lvAt: 0, spec: null, specAt: 0,
    lastSse: Date.now(), builtStyle: '', root: null, def: null, roles: {},
    coverSlot: null, coverUrl: null, queueSig: '', prog: -1, paused: false,
    trackKey: '', firstTrack: true, motionTimer: null, motionAnims: [], demoAt: Date.now(),
    demoIndex: 0, pausedLast: null, vizPausedAt: 0
  };

  var DEMO_QUEUE = DEMO_LIB.queue();

  function palette(id) {
    var d = DEFS[id] || DEFS.dos;
    return (d && d.palette) || { T: '#ffffff', V: '#ffb000' };
  }

  function currentCfg() {
    if (!MOTION) return CFG;
    var m = CFG.motion && typeof CFG.motion === 'object' ? CFG.motion : CFG;
    // У моушна свои «Что показывать»; ключей очереди у него нет никогда.
    return {
      style: m.style || 'dos', pos: m.pos || 'bc', dx: m.dx || 0, dy: m.dy || 0, size: m.size || 100,
      color: m.color || '#FFB000', vizColor: m.vizColor || '#FFB000', outline: m.outline !== false,
      nick: m.nick !== false, count: 0, fade: false, fadePct: 0, nums: false,
      cover: m.cover !== false, time: m.time !== false, spin: m.spin !== false,
      osc: m.osc !== false, prog: m.prog !== false, marq: m.marq !== false,
      lang: m.lang === 'ru' ? 'ru' : m.lang === 'en' ? 'en' : '', viz: m.viz === 'spectrum' ? 'spectrum' : 'wave',
      smooth: m.smooth || 'mid', scene: m.scene || 'brand', hold: m.hold || 5
    };
  }

  function applyOverrides(c) {
    if (DEFS[FORCE_STYLE]) c.style = FORCE_STYLE;
    if (/^[tb][lcr]$/.test(FORCE_POS)) c.pos = FORCE_POS;
    if (FORCE_NICK === '1') c.nick = true;
    if (FORCE_NICK === '0') c.nick = false;
    return c;
  }

  // Демо/проверка: ?feat=key:0,key:1 меняет только известные ключи настроек.
  function applyDemoFeatures() {
    var f = DOPT.feat;
    if (!f || !Object.keys(f).length) return;
    var o = MOTION ? (CFG.motion && typeof CFG.motion === 'object' ? CFG.motion : CFG) : CFG;
    Object.keys(f).forEach(function (k) {
      if (DEMO_FEATURE_KEYS.indexOf(k) >= 0) o[k] = f[k];
    });
  }

  function setDemoConfig() {
    var id = DEFS[FORCE_STYLE] ? FORCE_STYLE : (MOTION ? CFG.motion.style : CFG.style);
    var p = palette(id);
    CFG.color = p.T; CFG.vizColor = p.V;
    CFG.motion.color = p.T; CFG.motion.vizColor = p.V;
    CFG.motion.style = id;
    if (FORCE_POS) CFG.motion.pos = FORCE_POS;
    // ?dx=&dy=&size= — проверка сдвига и размера на настоящей странице.
    CFG.dx = DOPT.dx; CFG.dy = DOPT.dy; CFG.size = DOPT.size;
    CFG.motion.dx = DOPT.dx; CFG.motion.dy = DOPT.dy; CFG.motion.size = DOPT.size;
  }

  function applyConfig(raw) {
    var c = raw && typeof raw === 'object' ? raw : CFG;
    if (MOTION && (!c.motion || typeof c.motion !== 'object')) {
      var dm = pageDefaults().motion;
      c = Object.assign({}, c, {
        motion: Object.assign({}, dm, {
          style: c.style || dm.style,
          pos: /^[tb][lcr]$/.test(c.pos) ? c.pos : dm.pos,
          color: c.color || dm.color,
          vizColor: c.vizColor || c.color || dm.vizColor
        })
      });
    }
    CFG = c;
    ov.hidden = false;
    var a = applyOverrides(currentCfg());
    S.paused = !!(S.np && !S.np.playing);
    ensureStyle(a);
    applyLook(a);
    setTexts(a);
    renderQueue(a);
    updateTime(a);
    fitAll();
    if (MOTION) { fitPlate(); centerMotion(); }
  }

  function ensureStyle(cfg) {
    if (!cfg.style || !DEFS[cfg.style]) cfg.style = 'dos';
    if (S.builtStyle === cfg.style && S.root) return;
    S.builtStyle = cfg.style;
    S.def = DEFS[cfg.style] || DEFS.dos;
    while (ov.firstChild) ov.removeChild(ov.firstChild);
    var root = K.root(cfg.style);
    S.root = root;
    S.roles = {};
    ov.appendChild(root);
    try { S.def.build(root); }
    catch (e) { root.appendChild(K.h('div', 'style-error', 'стиль не загрузился')); }
    root.classList.toggle('pixel', !!S.def.pixel);
    root.classList.toggle('mono-cover', !!S.def.mono);
    S.coverSlot = root.querySelector('[data-role="cover"]');
    ['cover', 'title', 'artist', 'who', 'viz', 'time', 'queue', 'prog'].forEach(function (r) {
      S.roles[r] = root.querySelector('[data-role="' + r + '"]');
    });
    if (!S.roles.queue) {
      S.roles.queue = K.queue();
      root.appendChild(S.roles.queue);
    }
    if (MOTION) {
      var plate = K.h('div', 'motion-plate');
      root.prepend(plate);
      root.dataset.noqueue = '1';
      var q = root.querySelector('[data-role="queue"]');
      if (q) q.hidden = true;
      root.querySelectorAll('[data-pl]').forEach(function (e) { e.hidden = true; });
    }
    S.coverUrl = null;
    S.queueSig = '';
    S.prog = -1;
    vizReset();
  }

  function applyLook(cfg) {
    var pl = D.place(cfg.pos);
    ov.dataset.h = pl.h; ov.dataset.v = pl.v;
    S.root.dataset.h = pl.h; S.root.dataset.v = pl.v;
    var box = D.boxStyle(cfg);
    for (var k in box) ov.style[k] = box[k];
    var has = function (key) { return hasFeature(cfg.style, key); };
    ov.classList.toggle('outline', !!cfg.outline);
    ov.classList.toggle('no-cover', has('cover') && !coverOn(cfg));
    ov.classList.toggle('paused', !!S.paused);

    ov.style.setProperty('--c', cfg.color || '#fff');
    ov.style.setProperty('--c0', (cfg.color || '#fff') + '40');
    ov.style.setProperty('--v', cfg.vizColor || cfg.color || '#fff');
    var p = palette(cfg.style);
    var vars = C.variables(p, cfg.color || '#fff', cfg.vizColor || cfg.color || '#fff');
    Object.keys(vars).forEach(function (name) { ov.style.setProperty(name, vars[name]); });

    if (S.roles.time) S.roles.time.hidden = has('time') ? !cfg.time : false;
    if (S.roles.prog) S.roles.prog.hidden = has('prog') ? !cfg.prog : false;
    S.root.querySelectorAll('[data-role="viz"]').forEach(function (v) { v.hidden = has('osc') ? !cfg.osc : false; });
    S.root.querySelectorAll('[data-role="queue"]').forEach(function (q) { q.hidden = MOTION; });
    S.root.querySelectorAll('[data-role="spin"]').forEach(function (el) { el.hidden = has('spin') ? !cfg.spin : false; });
    if (S.coverSlot) S.coverSlot.hidden = has('cover') ? !cfg.cover : false;
    // Подписи TRACK/ARTIST: у стиля без ключа lang атрибут не ставится, CSS просто молчит.
    S.root.dataset.lang = has('lang') ? (cfg.lang === 'ru' ? 'ru' : cfg.lang === 'en' ? 'en' : 'off') : '';
  }

  function winampLine(cfg) {
    return T.winampText(S.np, cfg.nick, S.np && S.np.who);
  }

  function setTexts(cfg) {
    if (!S.roles.title) return;
    var np = S.np;
    bodyIdle(!np);
    if (!np) return;
    var title = S.roles.title, artist = S.roles.artist, who = S.roles.who;
    if (cfg.style === 'winamp') {
      title.textContent = winampLine(cfg);
      if (artist) { artist.textContent = ''; artist.hidden = true; }
      if (who) { who.textContent = ''; who.hidden = true; }
    } else {
      title.textContent = np.title || '';
      if (artist) { artist.textContent = np.artist || ''; artist.hidden = false; }
      if (who) {
        var nk = cfg.nick && np.who ? 'заказ: ' + np.who : '';
        who.textContent = nk;
        who.hidden = !nk;
      }
    }
  }

  function bodyIdle(on) {
    document.body.classList.toggle('idle', !!on);
    if (idle) idle.hidden = !on;
  }

  function renderQueue(cfg) {
    var q = S.roles.queue; if (!q) return;
    var cnt = hasFeature(cfg.style, 'count') ? cfg.count : (S.next || []).length;
    var numsOn = hasFeature(cfg.style, 'nums') ? cfg.nums : true;
    var fadeOn = hasFeature(cfg.style, 'fade') ? cfg.fade !== false : true;
    var list = (S.next || []).slice(0, cnt);
    var sig = JSON.stringify(list) + '|' + numsOn + '|' + fadeOn + '|' + cfg.fadePct + '|' + cfg.nick;
    if (sig === S.queueSig) return;
    S.queueSig = sig;
    q.textContent = '';
    list.forEach(function (it, i) {
      var d = document.createElement('div');
      if (cfg.style === 'winamp') {
        d.textContent = T.winampQueueRow(it, i, numsOn);
      } else {
        var pref = numsOn ? (i + 1) + '. ' : '';
        d.textContent = pref + it.title + (it.artist ? ' - ' + it.artist : '');
      }
      if (cfg.nick && it.who) {
        var w = document.createElement('span');
        w.className = 'q-who';
        w.textContent = ' · ' + it.who;
        d.appendChild(w);
      }
      d.style.opacity = D.fadeAt(i, fadeOn, cfg.fadePct);
      d.dataset.n = String(i + 1);
      q.appendChild(d);
    });
  }

  function updateTime(cfg) {
    var np = S.np;
    if (!S.roles.time || !np) return;
    var pos = D.posAt(np, Date.now()), paused = !np.playing;
    var t;
    if (cfg.style === 'winamp') {
      // Winamp: крупное время — только текущая позиция (в макете «01:32», без «/04:03»),
      // иначе 50-пиксельные цифры занимают всю строку и душат эквалайзер.
      t = T.winampClock(pos);
    } else {
      t = D.fmtTime(pos) + '/' + (np.dur > 0 ? D.fmtTime(np.dur) : '--:--');
      var ru = cfg.lang === 'ru' && hasFeature(cfg.style, 'lang');
      if (paused) t += ' · ' + (ru ? 'ПАУЗА' : 'PAUSED');
    }
    if (S.roles.time.textContent !== t) S.roles.time.textContent = t;
    if (S.roles.prog) {
      var p = S.roles.prog;
      if (!p.children.length) for (var i = 0; i < D.CELLS; i++) p.appendChild(document.createElement('i'));
      var n = D.progressCount(pos, np.dur, D.CELLS);
      if (n !== S.prog) {
        S.prog = n;
        for (var j = 0; j < p.children.length; j++) p.children[j].classList.toggle('on', j < n);
      }
    }
  }

  // ---------- обложка ----------
  function updateCover(cfg) {
    var slot = S.coverSlot;
    if (!slot) return;
    var url = coverOn(cfg) && S.np ? (S.np.cover || '') : '';
    var action = T.coverAction(url, S.coverUrl, !!slot.querySelector('.cover-img, canvas.cover-canvas'));
    if (action === 'clear') {
      slot.querySelectorAll('.cover-img, canvas.cover-canvas').forEach(function (e) { e.remove(); });
      slot.classList.remove('has-cover');
      S.coverUrl = '';
      return;
    }
    // Тот же файл: ничего не снимаем с экрана. Раньше обложка удалялась до этой проверки,
    // и любой следующий снимок плеера (время, пауза, уровень) оставлял пустую заглушку.
    if (action === 'keep') {
      var im0 = slot.querySelector('.cover-img');
      if (im0 && im0.complete) slot.classList.add('has-cover');
      return;
    }
    slot.querySelectorAll('.cover-img, canvas.cover-canvas').forEach(function (e) { e.remove(); });
    slot.classList.remove('has-cover');
    S.coverUrl = url;
    if (S.def && S.def.pixel) {
      var c = document.createElement('canvas');
      c.className = 'cover-canvas';
      c.width = 16; c.height = 16;
      var g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      var im = new Image();
      im.onload = function () {
        if (S.coverUrl !== url) return;
        var s = Math.min(im.naturalWidth, im.naturalHeight) || 1;
        g.clearRect(0, 0, 16, 16);
        g.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 16, 16);
        slot.classList.add('has-cover');
      };
      im.onerror = function () { if (S.coverUrl === url) { S.coverUrl = ''; } };
      im.src = url;
      slot.appendChild(c);
    } else {
      var img = document.createElement('img');
      img.className = 'cover-img';
      img.alt = '';
      img.onload = function () { if (S.coverUrl === url) slot.classList.add('has-cover'); };
      img.onerror = function () { if (S.coverUrl === url) { img.remove(); S.coverUrl = ''; } };
      img.src = url;
      slot.appendChild(img);
    }
  }

  // ---------- правило текста ----------
  var SCALE = 1;
  function scaleNow() {
    var w = ov.getBoundingClientRect().width, ow = ov.offsetWidth || 1;
    SCALE = w > 0 && ow > 0 ? w / ow : 1;
    return SCALE;
  }

  function coverBlockEl() {
    var c = S.roles.cover; if (!c) return null;
    var p = c.parentElement;
    while (p && p !== S.root) {
      if (/cover-shell|radar-scope|pop-star|cassette-body|polaroid-frame|bp-frame/.test(p.className)) return p;
      p = p.parentElement;
    }
    return c;
  }

  function awayDir(el) {
    var h = currentCfg().pos[1] || 'r';
    var cv = coverBlockEl();
    if (cv && !cv.hidden && cv.offsetParent) {
      var c = cv.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (c.right <= r.left + 2) return 'R';
      if (c.left >= r.right - 2) return 'L';
    }
    return h === 'r' ? 'L' : h === 'l' ? 'R' : 'B';
  }

  // Домашний край текста: справа — правый, слева — левый, по центру — середина.
  function homeAlign(cfg) {
    var h = (cfg.pos || 'br')[1];
    return h === 'l' ? 'left' : h === 'c' ? 'center' : 'right';
  }

  function rootBox() { return S.root.getBoundingClientRect(); }

  // Координаты элемента внутри оверлея, до transform: scale. Сдвиг и размер сюда не входят.
  function localBox(el) {
    var s = scaleNow() || 1, R = rootBox(), r = el.getBoundingClientRect();
    return { left: (r.left - R.left) / s, right: (r.right - R.left) / s };
  }

  function freeExtra(el, dir, need) {
    var b = localBox(el), ow = S.root.offsetWidth || 300;
    // Запас меряется только от края оверлея: положение на экране и сдвиг не участвуют.
    return T.titleReserve(dir, b.left, b.right, 0, ow, ow, need);
  }

  // По центру коробка названия растёт в обе стороны, но не залезает на обложку:
  // запас ограничен удвоенным зазором до блока обложки.
  function centerLimit(el, extra) {
    var cap = S.root.offsetWidth || 300;
    var cv = coverBlockEl();
    if (cv && !cv.hidden && cv.offsetParent) {
      var b = localBox(el), c = localBox(cv);
      if (c.right <= b.left + 1) cap = Math.min(cap, 2 * Math.max(0, b.left - c.right));
      else if (c.left >= b.right - 1) cap = Math.min(cap, 2 * Math.max(0, c.left - b.right));
    }
    return Math.min(extra, cap);
  }

  function resetText(el) {
    if (!el) return;
    el.textContent = '';
    el.style.width = '';
    el.style.height = '';
    el.style.marginLeft = '';
    el.style.marginRight = '';
    el.style.left = '';
    el.style.position = '';
    el.style.overflow = '';
    el.style.maxWidth = '';
    el.style.textAlign = '';
    el.style.whiteSpace = '';
    el.style.flex = '';
    el.classList.remove('mq', 'mqv');
  }

  function marquee(el, text, horizontal) {
    // Сначала убираем обычный текст: иначе он остаётся стоять перед бегущей копией
    // (так название резалось в №8, а Winamp показывал статичный хвост строки).
    el.textContent = '';
    var sp = document.createElement('span');
    sp.className = horizontal ? 'mq' : 'mqv';
    sp.textContent = T.marqueeText(text);
    el.appendChild(sp);
    var size = horizontal ? sp.scrollWidth : sp.scrollHeight;
    sp.style.animationDuration = Math.max(6, Math.round(size / 2 / 45)) + 's';
    // На правом крае текст по умолчанию прижат вправо: начало строки ушло бы за коробку.
    // Для бегущей строки важно видеть начало сразу, поэтому внутри коробки — слева.
    if (horizontal) el.style.textAlign = 'left';
  }

  function fitVerticalTitle(cfg) {
    var t = S.roles.title; if (!t) return;
    resetText(t);
    t.textContent = S.np ? S.np.title : '';
    var col = S.root.querySelector('[data-col="vertical"]');
    var was = t.style.display;
    t.style.display = 'none';                 // колонку мерим без названия, иначе она тянется за ним
    var colH = col ? col.offsetHeight : 0;
    t.style.display = was;
    var plan = T.verticalPlan(colH, t.scrollHeight, 300);
    // Буквы вертикального шрифта шире строки (боковые выносы) — коробку расширяем,
    // иначе владелец видит обрезанные сбоку буквы и обводку.
    var tw = Math.max(t.clientWidth, t.scrollWidth);
    if (tw > t.clientWidth) t.style.width = tw + 'px';
    if (!plan.run) return;                     // короткому высоту не задаём — стоит как в образце
    t.style.height = plan.height + 'px';
    t.style.overflow = 'hidden';
    if (marqOn(cfg)) marquee(t, S.np.title, false);
  }

  function fitTitle(cfg) {
    var t = S.roles.title; if (!t || !S.np) return;
    if (cfg.style === 'vtitle') { fitVerticalTitle(cfg); return; }
    resetText(t);
    t.textContent = S.np.title || '';
    t.style.overflow = 'hidden';
    t.style.whiteSpace = 'nowrap';
    if (cfg.style === 'code') {
      if (marqOn(cfg) && t.scrollWidth > t.clientWidth + 1) marquee(t, S.np.title, true);
      return;
    }
    if (cfg.style === 'winamp') {
      var wl = winampLine(cfg);
      t.textContent = wl;
      var box = t.parentElement;
      // Строка занимает всю ширину строки Winamp: так её край совпадает с краем оверлея,
      // а бегущая копия не растягивает коробку на всю длину текста.
      t.style.display = 'block';
      t.style.width = '100%';
      if (marqOn(cfg) && box && t.scrollWidth > box.clientWidth + 1) marquee(t, wl, true);
      return;
    }
    // №7 «Нижняя лента»: справа эквалайзер, запаса нет — длинное название сразу бежит в своей колонке.
    if (cfg.style === 'ribbon') {
      if (marqOn(cfg) && t.scrollWidth > t.clientWidth + 1) marquee(t, S.np.title, true);
      return;
    }
    var base = t.clientWidth;
    var need = Math.max(0, t.scrollWidth - base);
    if (need <= 0) return;
    var dir = awayDir(t), extra;
    if (homeAlign(cfg) === 'center') {
      // По центру запас открывается в обе стороны — иначе середина строки уезжает.
      dir = 'B';
      extra = centerLimit(t, freeExtra(t, dir, need));
    } else {
      extra = freeExtra(t, dir, need);
    }
    // Моушн: коробка названия вдвое длиннее, чем у плейлиста того же стиля и угла.
    if (MOTION) extra = T.motionExtra(base, extra);
    // По центру и в моушне коробка не должна залезть на обложку — режем запас после удвоения.
    if (homeAlign(cfg) === 'center') extra = centerLimit(t, extra);
    if (extra > 0) {
      var bx = T.titleBox(base, extra, dir);
      t.style.flex = '0 0 auto';
      t.style.width = bx.width + 'px';
      if (bx.marginLeft) t.style.marginLeft = bx.marginLeft + 'px';
      if (bx.marginRight) t.style.marginRight = bx.marginRight + 'px';
      // Домашний край не переставляем: коробка растёт в сторону от обложки,
      // а текст остаётся прижат к своему краю (справа/слева/по центру).
      t.style.textAlign = cfg.style === 'code' ? 'left' : homeAlign(cfg);
      S.root.querySelectorAll('.textcol, .title-line, .title-box').forEach(function (p) { p.style.overflow = 'visible'; });
    }
    if (marqOn(cfg) && t.scrollWidth > t.clientWidth + 1) {
      var tx = S.np.title;
      t.textContent = '';
      t.textContent = tx;
      marquee(t, tx, true);
    }
  }

  function compactStyle(cfg) { return cfg.style === 'ribbon' || cfg.style === 'vu'; }

  // Длинная строка не режется и не тащит за собой домашний край: коробка
  // расширяется на вылет, а домашний край остаётся на месте (отрицательное поле).
  function growLine(el, cfg) {
    var spill = Math.max(0, el.scrollWidth - el.clientWidth);
    if (!spill) return;
    var h = homeAlign(cfg);
    el.style.width = 'max-content';
    if (h === 'right') { el.style.marginLeft = (-spill) + 'px'; return; }
    if (h === 'left') return;
    // По центру: у обложки сбоку уходим в сторону от неё, иначе растём в обе стороны.
    var dir = awayDir(el);
    if (dir === 'L') el.style.marginLeft = (-spill) + 'px';
    else if (dir === 'B') el.style.marginLeft = (-spill / 2) + 'px';
  }

  function fitArtist(cfg) {
    var a = S.roles.artist; if (!a || !S.np || a.hidden) return;
    if (cfg.style === 'winamp' || cfg.style === 'code') return;
    resetText(a);
    a.textContent = S.np.artist || '';
    if (compactStyle(cfg)) {
      // №7 лента и №20 VU: рядом визуализатор — длинный исполнитель бежит в своём месте.
      a.style.overflow = 'hidden';
      a.style.whiteSpace = 'nowrap';
      if (marqOn(cfg) && a.scrollWidth > a.clientWidth + 1) marquee(a, S.np.artist || '', true);
      return;
    }
    // Обычные стили: текст целиком, длинный уходит к центру экрана и не режется.
    a.style.overflow = 'visible';
    a.style.whiteSpace = 'nowrap';
    a.style.textAlign = homeAlign(cfg);
    growLine(a, cfg);
  }

  function fitWho(cfg) {
    var w = S.roles.who; if (!w || w.hidden || !S.np) return;
    if (cfg.style === 'winamp' || cfg.style === 'code') return;
    resetText(w);
    if (!(cfg.nick && S.np.who)) return;
    w.textContent = 'заказ: ' + S.np.who;
    w.style.whiteSpace = 'nowrap';
    if (compactStyle(cfg)) {
      // Стиль сам обрезает ник многоточием (№7, №20).
      return;
    }
    w.style.overflow = 'visible';
    w.style.textAlign = homeAlign(cfg);
    growLine(w, cfg);
  }

  function fitAll() {
    if (!S.root || !S.np) return;
    var cfg = currentCfg();
    fitTitle(cfg);
    fitArtist(cfg);
    fitWho(cfg);
    if (MOTION) requestAnimationFrame(function () { centerMotion(); fitPlate(); });
  }

  // ---------- визуализаторы ----------
  var vizMap = new Map();
  function vizReset() { vizMap.clear(); }
  function getViz(z) {
    var st = vizMap.get(z);
    if (!st) {
      var n = Number(z.dataset.cols) || 0;
      st = { shown: new Array(n).fill(0), hist: new Array(n).fill(0), last: 0, lastSpec: 0 };
      vizMap.set(z, st);
    }
    return st;
  }
  function interp(arr, i, n) { return V.interp(arr, i, n); }
  function simulated(now, i) {
    return 0.18 + 0.82 * Math.abs(Math.sin(now / 360 + i * 0.55) * Math.cos(now / 610 + i * 0.17));
  }
  function specAt(i, n, now, live) {
    if (live) return interp(S.spec, i, n);
    var lv = S.lvAt && now - S.lvAt < 1500 ? S.lv : D.imitation(now / 300, (i % 7) / 7);
    return simulated(now, i) * (0.45 + 0.55 * lv);
  }
  function levelNow(now) {
    if (S.lvAt && now - S.lvAt < 1500) return S.lv;
    return D.imitation(now / 300, 0.4);
  }

  function drawViz(now) {
    if (!S.root) return;
    var cfg = currentCfg();
    var liveSpec = S.spec && S.specAt && now - S.specAt < 1500;
    var paused = !S.np || !S.np.playing || !cfg.osc;
    if (paused) {
      if (!S.vizPausedAt) S.vizPausedAt = now;
      // Плавно опустили и остановили рисование — экономия ЦП в OBS.
      if (now - S.vizPausedAt > 2600) return;
    } else S.vizPausedAt = 0;
    var lv = paused ? 0 : levelNow(now);
    var alpha = D.smoothAlpha(cfg.smooth);
    // DOS-лента умеет переключаться «волна/спектр»; остальные стили рисуют свой вид всегда.
    var specMode = cfg.style === 'dos' && cfg.viz === 'spectrum';
    S.root.querySelectorAll('[data-viz]').forEach(function (z) {
      if (z.closest('[hidden]')) return;
      var st = getViz(z), kind = z.dataset.viz, n = Number(z.dataset.cols) || z.children.length;
      var target = paused ? 0 : lv;
      if (kind === 'b' || kind === 'bw' || kind === 'r' || kind === 'g' || kind === 'w') {
        for (var i = 0; i < n; i++) {
          var t = paused ? 0 : specAt(i, n, now, liveSpec);
          var cur = st.shown[i] || 0;
          st.shown[i] = V.next(cur, t, alpha);
        }
      } else if (kind === 'sp') {
        if (!paused && (!st.last || now - st.last > 170)) {
          st.last = now;
          if (specMode && liveSpec) {
            for (var q = 0; q < n; q++) st.hist[q] = V.next(st.hist[q] || 0, interp(S.spec, q, n), alpha);
          } else {
            V.historyPush(st.hist, lv, 0.05);
          }
        }
        if (paused) for (var h = 0; h < n; h++) st.hist[h] *= 0.82;
      }
      if (kind === 'b') {
        for (var b = 0; b < z.children.length; b++) {
          var v = st.shown[b] || 0;
          z.children[b].style.height = Math.max(3, v * 100) + '%';
        }
      } else if (kind === 'bw') {
        for (var w = 0; w < z.children.length; w++) z.children[w].style.width = Math.max(3, (st.shown[w] || 0) * 100) + '%';
      } else if (kind === 'g') {
        var rows = Number(z.dataset.rows) || 4;
        for (var c = 0; c < z.children.length; c++) {
          var lit = V.lit(st.shown[c] || 0, rows);
          for (var r = 0; r < rows; r++) z.children[c].children[r].classList.toggle('on', r < lit);
        }
      } else if (kind === 'r') {
        var R = Number(z.dataset.h) || 46;
        for (var d = 0; d < z.children.length; d++) {
          z.children[d].firstChild.style.height = (6 + (st.shown[d] || 0) * R) + 'px';
        }
      } else if (kind === 'sp') {
        for (var p = 0; p < z.children.length; p++) z.children[p].style.height = Math.max(3, (st.hist[p] || 0) * 100) + '%';
      } else if (kind === 'nd') {
        var nd = z.querySelector('.needle');
        st.shown[0] = V.next(st.shown[0] || 0, target, alpha);
        var angle = V.needleAngle(st.shown[0]);
        if (nd) nd.style.transform = 'rotate(' + angle.toFixed(2) + 'deg)';
      } else if (kind === 'w') {
        drawWave(z, st, paused, now, liveSpec);
      }
    });
  }

  function drawWave(z, st, paused, now, live) {
    var c = z.querySelector('canvas'); if (!c) return;
    var g = c.getContext('2d'); if (!g) return;
    var W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    var pts = 60;
    g.beginPath();
    for (var i = 0; i <= pts; i++) {
      var v = paused ? 0 : specAt(i, pts + 1, now, live);
      var y = V.waveY(v, i, pts, H);
      var x = i * W / pts;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    var cs = getComputedStyle(z);
    g.strokeStyle = cs.getPropertyValue('--v').trim() || '#fff';
    g.lineWidth = Math.max(2, H / 12);
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(0,0,0,.85)';
    g.shadowBlur = 3;
    g.stroke();
    g.shadowBlur = 0;
  }

  function rafLoop() {
    drawViz(Date.now());
    requestAnimationFrame(rafLoop);
  }

  // ---------- моушн ----------
  function inkRect(el) {
    if (!el) return null;
    var r;
    if (el.classList.contains('mq') || el.classList.contains('mqv') || getComputedStyle(el).overflow === 'hidden') {
      r = el.getBoundingClientRect();
    } else {
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        r = range.getBoundingClientRect();
        if (!r || !r.width) r = el.getBoundingClientRect();
      } catch (e) { r = el.getBoundingClientRect(); }
    }
    var p = el.parentElement;
    while (p && p !== S.root) {
      if (getComputedStyle(p).overflow !== 'visible') {
        var q = p.getBoundingClientRect();
        r = Object.assign({}, r, {
          left: Math.max(r.left, q.left), top: Math.max(r.top, q.top),
          right: Math.min(r.right, q.right), bottom: Math.min(r.bottom, q.bottom)
        });
      }
      p = p.parentElement;
    }
    return r;
  }

  function seenBox() {
    var root = S.root; if (!root) return null;
    var R = root.getBoundingClientRect();
    var U = { l: R.left, t: R.top, r: R.right, b: R.bottom };
    var cover = coverBlockEl();
    if (cover && !cover.hidden && cover.offsetParent) {
      var cr = cover.getBoundingClientRect();
      U.l = Math.min(U.l, cr.left); U.t = Math.min(U.t, cr.top);
      U.r = Math.max(U.r, cr.right); U.b = Math.max(U.b, cr.bottom);
    }
    [S.roles.title, S.roles.artist, S.roles.who].forEach(function (el) {
      if (!el || el.hidden || !el.offsetParent) return;
      var r = inkRect(el);
      if (!r.width) return;
      U.l = Math.min(U.l, r.left); U.t = Math.min(U.t, r.top);
      U.r = Math.max(U.r, r.right); U.b = Math.max(U.b, r.bottom);
    });
    root.querySelectorAll('[data-role="viz"]').forEach(function (el) {
      if (el.hidden || !el.offsetParent) return;
      var r = el.getBoundingClientRect();
      if (!r.width) return;
      U.l = Math.min(U.l, r.left); U.t = Math.min(U.t, r.top);
      U.r = Math.max(U.r, r.right); U.b = Math.max(U.b, r.bottom);
    });
    return { R: R, U: U };
  }

  function centerMotion() {
    if (!MOTION || !S.root) return;
    var cfg = currentCfg();
    ov.style.translate = '';
    if (cfg.pos[1] !== 'c') return;
    var b = seenBox(); if (!b) return;
    // Центр не коробки, а всего видимого — прямо в координатах окна 1920.
    // Сдвиг dx переносит и центр: моушн не должен «съедать» сдвиг.
    var dx = Number(cfg.dx) || 0;
    var d = M.centerShift({ left: dx, right: window.innerWidth + dx }, b.U);
    if (Math.abs(d) > 0.5) ov.style.translate = d + 'px 0';
  }

  function fitPlate() {
    if (!MOTION || !S.root) return;
    var pl = S.root.querySelector('.motion-plate'); if (!pl) return;
    var b = seenBox(); if (!b) return;
    var s = scaleNow() || 1, R = b.R, U = b.U;
    var box = M.plateRect(R, U, s);
    pl.style.top = box.top + 'px';
    pl.style.left = box.left + 'px';
    pl.style.right = box.right + 'px';
    pl.style.bottom = box.bottom + 'px';
  }

  function cancelMotion() {
    S.motionAnims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    S.motionAnims = [];
    clearTimeout(S.motionTimer);
  }

  function showMotion() {
    if (!MOTION || !S.root || !S.np) return;
    cancelMotion();
    var cfg = currentCfg();
    var scene = cfg.scene || 'brand';
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    ov.classList.remove('motion-hidden');
    ov.classList.add('motion-in');
    ov.classList.toggle('motion-plate-on', scene === 'plate');
    S.root.style.visibility = 'visible';
    fitPlate();
    var root = S.root;
    var dur = 700;
    var ease = 'cubic-bezier(.16,1,.3,1)';
    var items = [S.roles.cover, S.roles.title, S.roles.artist, S.roles.who, S.roles.viz].filter(Boolean);
    function anim(el, frames, opt) {
      if (!el || !el.animate) return;
      try { S.motionAnims.push(el.animate(frames, opt)); } catch (e) {}
    }
    if (reduce) {
      anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, fill: 'both' });
      dur = 320;
    } else if (scene === 'rush') {
      var dir = cfg.pos[1] === 'r' ? 1 : -1;
      anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'both', easing: 'ease-out' });
      items.forEach(function (el, i) {
        anim(el, [{ opacity: 0, transform: 'translateX(' + (dir * 90) + 'px)' }, { opacity: 1, transform: 'translateX(0)' }],
          { duration: 620, delay: i * 80, easing: ease, fill: 'both' });
      });
    } else if (scene === 'mask') {
      anim(root, [{ clipPath: 'inset(0 0 100% 0)', opacity: 0 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }],
        { duration: 820, easing: ease, fill: 'both' });
      items.forEach(function (el, i) {
        anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 120 + i * 60, easing: 'ease-out', fill: 'both' });
      });
    } else if (scene === 'plate') {
      var pl = root.querySelector('.motion-plate');
      if (pl) anim(pl, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 620, easing: ease, fill: 'both' });
      anim(root, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 620, easing: ease, fill: 'both' });
    } else {
      var off = cfg.pos[1] === 'r' ? 70 : cfg.pos[1] === 'l' ? -70 : 0;
      anim(root, [{ opacity: 0, transform: 'translate(' + off + 'px,28px)' }, { opacity: 1, transform: 'translate(0,0)' }],
        { duration: 700, easing: ease, fill: 'both' });
      items.forEach(function (el, i) {
        anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 520, delay: 80 + i * 70, easing: 'ease-out', fill: 'both' });
      });
    }
    var hold = M.holdSeconds(cfg.hold);
    // Центровка по видимому — после того, как браузер разложил текст и шрифты.
    setTimeout(function () { centerMotion(); fitPlate(); }, 320);
    S.motionTimer = setTimeout(function () {
      var out = [{ opacity: 1 }, { opacity: 0 }];
      anim(root, out, { duration: reduce ? 260 : 420, easing: 'ease-in', fill: 'both' });
      S.motionTimer = setTimeout(function () {
        ov.classList.add('motion-hidden');
        ov.classList.remove('motion-plate-on');
      }, reduce ? 280 : 450);
    }, hold * 1000);
  }

  function noteTrack(np) {
    if (!np) { S.trackKey = ''; return; }
    var key = np.title + '|' + np.artist;
    if (key === S.trackKey) return;
    S.trackKey = key;
    if (!MOTION) return;
    if (S.firstTrack) { S.firstTrack = false; return; }
    showMotion();
  }

  // ---------- данные ----------
  function applyFeed(d) {
    if (!d || !d.cfg) return;
    // В демо-режиме настройки и трек заданы ссылкой, живой поток их не перебивает.
    if (DEMO) return;
    var cfg = d.cfg;
    CFG = cfg;
    S.np = d.np || null;
    S.next = d.next || [];
    if (S.np && S.np.cover != null) S.np.cover = S.np.cover || '';
    applyConfig(CFG);
    noteTrack(S.np);
    updateCover(currentCfg());
  }

  function connectEvents() {
    if (S.es) { try { S.es.close(); } catch (e) {} }
    var url = 'events?t=' + Date.now() + (PREVIEW ? '&preview=1' : '') + (MOTION ? '&page=motion' : '&page=playlist');
    var es = new EventSource(url);
    S.es = es;
    es.onopen = function () { S.lastSse = Date.now(); };
    es.onmessage = function (e) {
      S.lastSse = Date.now();
      var d; try { d = JSON.parse(e.data); } catch (x) { return; }
      applyFeed(d);
    };
    es.addEventListener('lv', function (e) {
      S.lastSse = Date.now();
      S.lv = Math.max(0, Math.min(1, Number(e.data) || 0)); S.lvAt = Date.now();
    });
    es.addEventListener('spectrum', function (e) {
      S.lastSse = Date.now();
      try {
        var a = JSON.parse(e.data);
        if (Array.isArray(a) && a.length) { S.spec = a.slice(0, 32).map(function (v) { return Math.max(0, Math.min(1, Number(v) || 0)); }); S.specAt = Date.now(); }
      } catch (x) {}
    });
    es.addEventListener('hb', function () { S.lastSse = Date.now(); });
    // «Показать сейчас» из окна настроек: проиграть появление с текущим треком.
    es.addEventListener('show', function () { if (MOTION) showMotion(); });
  }

  // ---------- демо ----------
  function demoNp() {
    return DEMO_LIB.np(TRACK, S.demoAt, DEMO_PAUSED, Date.now());
  }

  function startDemo() {
    S.np = demoNp();
    S.next = DEMO_QUEUE.slice();
    applyConfig(CFG);
    updateCover(currentCfg());
    if (!MOTION) return;
    var hold = M.holdSeconds(CFG.motion.hold);
    var list = DEMO_LIB.list(TRACK);
    S.demoIndex = 0;
    S.trackKey = S.np.title + '|' + S.np.artist;
    S.firstTrack = false;
    setTimeout(function () { showMotion(); }, 600);
    setInterval(function () {
      S.demoIndex = (S.demoIndex + 1) % list.length;
      var x = list[S.demoIndex];
      S.np = Object.assign({}, x, { pos: 0, at: Date.now() });
      applyConfig(CFG);
      noteTrack(S.np);
    }, (hold + 2.4) * 1000);
  }

  function init(opts) {
    MOTION = !!(opts && opts.motion);
    if (!DEFS[FORCE_STYLE]) FORCE_STYLE = '';
    if (MOTION) {
      CFG.motion.style = FORCE_STYLE || CFG.motion.style;
      if (FORCE_POS) CFG.motion.pos = FORCE_POS;
    } else {
      CFG.style = FORCE_STYLE || CFG.style;
      if (FORCE_POS) CFG.pos = FORCE_POS;
    }
    if (FORCE_NICK === '1') { CFG.nick = true; CFG.motion.nick = true; }
    if (FORCE_NICK === '0') { CFG.nick = false; CFG.motion.nick = false; }
    if (DEMO) { setDemoConfig(); applyDemoFeatures(); startDemo(); }
    else {
      // До первого снимка показываем пустую сцену без текста.
      applyConfig(CFG);
    }
    connectEvents();
    setInterval(function () {
      if (S.np) {
        updateTime(currentCfg());
        if (DEMO && !MOTION) {
          S.np = demoNp();
          applyConfig(CFG);
        }
      }
      if (Date.now() - S.lastSse > 15000) connectEvents();
    }, 1000);
    setInterval(function () { if (S.np) updateTime(currentCfg()); }, 250);
    if (MOTION) setInterval(function () {
      if (!ov.classList.contains('motion-hidden')) { centerMotion(); fitPlate(); }
    }, 250);
    requestAnimationFrame(rafLoop);
    window.addEventListener('resize', function () { fitAll(); if (MOTION) { fitPlate(); centerMotion(); } });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitAll(); if (MOTION) { fitPlate(); centerMotion(); } });
    // Только для проверок (?demo=1): меняет сдвиг/размер без перезагрузки страницы.
    // В OBS demo нет, поэтому хук не появляется.
    if (DEMO) {
      window.TapDemoSet = function (o) {
        o = o || {};
        ['dx', 'dy', 'size'].forEach(function (k) {
          if (o[k] == null) return;
          CFG[k] = o[k];
          if (CFG.motion && typeof CFG.motion === 'object') CFG.motion[k] = o[k];
        });
        applyConfig(CFG);
        updateCover(currentCfg());
      };
    }
  }

  window.TapOverlayApp = { start: init };
})();
