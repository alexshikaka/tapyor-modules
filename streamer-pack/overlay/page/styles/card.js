// Стиль «Карточка» (№1). Разметка строится через createElement, стили — в card.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'card', num: 1, name: 'Карточка', font: 'Manrope, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#f0654f', extras: { '--c2': '#ffd1c7' } },
    build: function (root) {
      root.classList.add('card');
      var row = K.h('div', 'row'), cov = K.cover('card-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      txt.append(K.viz('b', 22, { cls: 'card-viz' }));
      row.append(cov, txt); root.append(row, K.queue());
    }
  });
})();
