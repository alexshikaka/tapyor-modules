// Стиль «Вертикальный заголовок» (№8). Разметка строится через createElement, стили — в vtitle.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'vtitle', num: 8, name: 'Вертикальный заголовок', font: 'Oswald, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#c8f542', extras: {} },
    build: function (root) {
      root.classList.add('vtitle');
      var main = K.h('div', 'vtitle-main'), title = K.text('title', 'vtitle-title');
      var col = K.h('div', 'vtitle-col'); col.dataset.col = 'vertical';
      var row = K.h('div', 'row'), cov = K.cover('vtitle-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); col.append(row, K.viz('bw', 5, { cls: 'vtitle-bars' }), K.queue());
      main.append(title, col); root.append(main);
    }
  });
})();
