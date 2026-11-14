// Стиль «Швейцарский стиль» (№13). Разметка строится через createElement, стили — в swiss.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'swiss', num: 13, name: 'Швейцарский стиль', font: 'Golos Text, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ff2d2d', extras: { '--c2': '#ff6b6b' } },
    build: function (root) {
      root.classList.add('swiss');
      var row = K.h('div', 'row'), cov = K.cover('swiss-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('time', 'time'), K.text('who', 'who'));
      row.append(cov, txt); root.append(row, K.queue());
    }
  });
})();
