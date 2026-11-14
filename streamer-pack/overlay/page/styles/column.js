// Стиль «Колонка» (№4). Разметка строится через createElement, стили — в column.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'column', num: 4, name: 'Колонка', font: 'Tektur, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#19e3ff', extras: { '--a2': '#ff3ea5' } },
    build: function (root) {
      root.classList.add('column');
      var cov = K.cover('column-cover');
      root.append(cov, K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      root.append(K.viz('w', 0, { h: 26, cls: 'column-wave' }), K.queue());
    }
  });
})();
