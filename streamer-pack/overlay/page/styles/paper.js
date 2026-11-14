// Стиль «Газета» (№16). Разметка строится через createElement, стили — в paper.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'paper', num: 16, name: 'Газета', font: 'Playfair Display, serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#fff', extras: { '--c2': '#ccc' } },
    build: function (root) {
      root.classList.add('paper');
      var mast = K.h('div', 'paper-mast', 'Сейчас в эфире');
      var row = K.h('div', 'row'), cov = K.cover('paper-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); root.append(mast, row);
      root.append(K.viz('b', 60, { cls: 'paper-viz' }), K.queue());
    }
  });
})();
