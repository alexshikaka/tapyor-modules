// Стиль «Киноплёнка» (№22). Разметка строится через createElement, стили — в film.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'film', num: 22, name: 'Киноплёнка', font: 'Oswald, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#fff', extras: { '--a2': '#f4d35e', '--bg': '#0b132b' } },
    build: function (root) {
      root.classList.add('film');
      var row = K.h('div', 'row'), cov = K.cover('film-cover'), txt = K.h('div', 'textcol');
      var meta = K.h('div', 'meta-line');
      meta.append(K.text('artist', 'artist'), K.text('time', 'time'));
      txt.append(K.text('title', 'title'), meta, K.text('who', 'who'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('b', 40, { cls: 'film-viz' }), K.queue());
    }
  });
})();
