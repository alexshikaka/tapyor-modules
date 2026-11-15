// Общие строительные блоки стилей оверлея. Работают только в браузере страницы OBS.
// Никаких строк с разметкой и style="…": всё через createElement / CSSOM.
(function () {
  'use strict';

  var K = {};

  K.h = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  };

  K.svg = function (tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  K.root = function (id) {
    var r = K.h('div', 'style-root');
    r.dataset.style = id;
    return r;
  };

  // Место обложки: сюда страница кладёт настоящую обложку, пока грузится — заглушка стиля.
  K.cover = function (cls) {
    var slot = K.h('div', 'cover-slot' + (cls ? ' ' + cls : ''));
    slot.dataset.role = 'cover';
    slot.appendChild(K.h('div', 'cover-fallback'));
    return slot;
  };

  K.text = function (role, cls) {
    var e = K.h('div', cls || '', '');
    e.dataset.role = role;
    return e;
  };

  K.queue = function (cls) {
    var e = K.h('div', 'queue' + (cls ? ' ' + cls : ''));
    e.dataset.role = 'queue';
    return e;
  };

  K.time = function (cls) {
    var e = K.h('span', 'time' + (cls ? ' ' + cls : ''), '');
    e.dataset.role = 'time';
    return e;
  };

  K.prog = function (cls) {
    var e = K.h('div', 'prog' + (cls ? ' ' + cls : ''));
    e.dataset.role = 'prog';
    return e;
  };

  // Визуализатор: форма (b, bw, g, r, w) и число элементов. Движение — общий viz на странице.
  K.viz = function (kind, n, opts) {
    opts = opts || {};
    var box = K.h('div', 'viz viz-' + kind + (opts.cls ? ' ' + opts.cls : ''));
    box.dataset.role = 'viz';
    var z = K.h('div', 'vz vz-' + kind);
    z.dataset.viz = kind;
    z.dataset.cols = String(n || 0);
    if (opts.rows) z.dataset.rows = String(opts.rows);
    if (opts.h) z.dataset.h = String(opts.h);
    if (opts.m) z.dataset.m = String(opts.m);
    if (kind === 'w') {
      // Две линии, как в образце: вторая — цветом из переменной w2 (по умолчанию цвет текста); fill — с заливкой.
      z.dataset.w2 = opts.w2 || '--c';
      if (opts.fill) z.dataset.fill = '1';
      var c = K.h('canvas', 'viz-canvas');
      c.width = 600;
      c.height = opts.h || 30;
      z.appendChild(c);
    } else if (kind === 'g') {
      for (var i = 0; i < n; i++) {
        var col = K.h('div', 'led-col');
        for (var r = 0; r < (opts.rows || 4); r++) col.appendChild(K.h('i', 'led'));
        z.appendChild(col);
      }
    } else if (kind === 'r') {
      for (var j = 0; j < n; j++) {
        var arm = K.h('div', 'ring-arm');
        arm.style.transform = 'rotate(' + (j * 360 / n) + 'deg)';
        arm.appendChild(K.h('i', 'ring-bar'));
        z.appendChild(arm);
      }
    } else if (kind === 'nd') {
      var nd = K.h('div', 'needle');
      z.appendChild(nd);
    } else {
      for (var k = 0; k < n; k++) z.appendChild(K.h('i', 'vz-bar'));
    }
    box.appendChild(z);
    return box;
  };

  // Несколько стрелок VU (у №20 две) — data-m это номер стрелки: 0 — левая, 1 — правая.
  // Страница по нему выбирает, что показывать: громкость/низы слева, верха справа.
  K.needles = function (marks) {
    var box = K.h('div', 'viz viz-nd');
    box.dataset.role = 'viz';
    for (var i = 0; i < marks.length; i++) {
      var z = K.h('div', 'vz vz-nd');
      z.dataset.viz = 'nd';
      z.dataset.m = String(i);
      // Шкала как в образце (15.11): белая дуга и красный отрезок дуги на ней — не заливка сектором,
      // которая вылезала за циферблат. viewBox 64×40, центр дуги — (32, 38), радиус 26.
      var dial = K.svg('svg', { viewBox: '0 0 64 40', class: 'vu-dial', 'aria-hidden': 'true' });
      dial.appendChild(K.svg('path', { d: 'M6 38A26 26 0 0 1 58 38', fill: 'none', class: 'vu-arc' }));
      dial.appendChild(K.svg('path', { d: 'M48.4 17.8A26 26 0 0 1 58 38', fill: 'none', class: 'vu-red' }));
      z.appendChild(dial);
      z.appendChild(K.h('div', 'needle'));
      box.appendChild(z);
    }
    return box;
  };

  K.register = function (s) {
    if (!window.TapStyles) window.TapStyles = {};
    window.TapStyles[s.id] = s;
  };

  K.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  window.TapKit = K;
})();
