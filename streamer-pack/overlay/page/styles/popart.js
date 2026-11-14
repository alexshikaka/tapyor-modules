// Стиль «Поп-арт комикс» (№25). Разметка строится через createElement, стили — в popart.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'popart', num: 25, name: 'Поп-арт комикс', font: 'Dela Gothic One, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ff3b6b', extras: { '--a2': '#ffe14d', '--a3': '#2ec4ff' } },
    build: function (root) {
      root.classList.add('popart');
      var row = K.h('div', 'row'), shell = K.h('div', 'pop-star'), cov = K.cover('pop-cover');
      var star = K.svg('svg', { viewBox: '0 0 100 100', class: 'pop-star-svg', 'aria-hidden': 'true' });
      star.appendChild(K.svg('polygon', { points: '50,0 61,18 82,10 80,32 100,40 84,56 94,78 72,76 64,98 50,82 36,98 28,76 6,78 16,56 0,40 20,32 18,10 39,18', fill: 'var(--a2)', stroke: '#000', 'stroke-width': '3' }));
      shell.append(star, cov);
      var txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(shell, txt); root.append(row);
      root.append(K.viz('b', 16, { cls: 'pop-viz' }), K.queue());
    }
  });
})();
