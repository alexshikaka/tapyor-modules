// Стиль «Наклонённая обложка» (№6). Разметка строится через createElement, стили — в tilt.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'tilt', num: 6, name: 'Наклонённая обложка', font: 'Manrope, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ffb347', extras: {} },
    build: function (root) {
      root.classList.add('tilt');
      var row = K.h('div', 'row'), cov = K.cover('tilt-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('w', 0, { h: 30, cls: 'tilt-wave', w2: '--c', fill: true }), K.queue());
    }
  });
})();
