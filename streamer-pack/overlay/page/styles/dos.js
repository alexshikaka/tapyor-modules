// Стиль «DOS-терминал» (№12). Разметка строится через createElement, стили — в dos.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'dos', num: 12, name: 'DOS-терминал', font: 'Pixelify Sans, monospace',
    pixel: true, mono: false,
    palette: { T: '#ffb000', V: '#ffb000', extras: { '--bg': '#1a1000' } },
    build: function (root) {
      root.classList.add('dos');
      var row = K.h('div', 'row'), cov = K.cover('dos-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('time', 'time'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('sp', 34, { cls: 'dos-viz' }), K.prog('dos-prog'), K.queue());
    }
  });
})();
