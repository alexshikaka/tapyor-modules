// Стиль «Mac System 7» (№10). Разметка строится через createElement, стили — в sys7.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'sys7', num: 10, name: 'Mac System 7', font: 'Pixelify Sans, monospace',
    pixel: true, mono: true,
    palette: { T: '#fff', V: '#fff', extras: {} },
    build: function (root) {
      root.classList.add('sys7');
      var row = K.h('div', 'row'), cov = K.cover('sys7-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('time', 'time'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('b', 30, { cls: 'sys7-viz' }), K.queue());
    }
  });
})();
