// Стиль «Крупный шрифт» (№3). Разметка строится через createElement, стили — в bigtype.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'bigtype', num: 3, name: 'Крупный шрифт', font: 'Unbounded, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ffe14d', extras: { '--a2': '#ff4d2e' } },
    build: function (root) {
      root.classList.add('bigtype');
      var row = K.h('div', 'row'), cov = K.cover('square-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('g', 28, { rows: 3, cls: 'bigtype-led' }), K.queue());
    }
  });
})();
