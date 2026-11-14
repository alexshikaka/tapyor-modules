// Стиль «Нижняя лента» (№7). Разметка строится через createElement, стили — в ribbon.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'ribbon', num: 7, name: 'Нижняя лента', font: 'Fira Sans Condensed, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#4dd4ac', extras: {} },
    build: function (root) {
      root.classList.add('ribbon');
      var row = K.h('div', 'row'), cov = K.cover('ribbon-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt, K.viz('b', 20, { cls: 'ribbon-viz' }));
      root.append(row, K.queue('ribbon-queue'));
    }
  });
})();
