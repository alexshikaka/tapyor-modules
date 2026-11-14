// Стиль «Неоновая вывеска» (№21). Разметка строится через createElement, стили — в neon.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'neon', num: 21, name: 'Неоновая вывеска', font: 'Pacifico, cursive',
    pixel: false, mono: false,
    palette: { T: '#ff5fd2', V: '#5ff3ff', extras: { '--a2': '#ffe66d', '--bg': '#240046' } },
    build: function (root) {
      root.classList.add('neon');
      var row = K.h('div', 'row'), cov = K.cover('neon-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('w', 0, { h: 22, cls: 'neon-wave' }), K.queue());
    }
  });
})();
