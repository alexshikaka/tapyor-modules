// Стиль «Винил» (№2). Разметка строится через createElement, стили — в vinyl.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'vinyl', num: 2, name: 'Винил', font: 'Lora, serif',
    pixel: false, mono: false,
    palette: { T: '#fff4d6', V: '#e9c46a', extras: { '--cover-bg': '#2a9d8f' } },
    build: function (root) {
      root.classList.add('vinyl');
      var row = K.h('div', 'row'), shell = K.h('div', 'cover-shell'), txt = K.h('div', 'textcol');
      shell.append(K.cover('vinyl-cover'), K.viz('r', 32, { h: 16, cls: 'vinyl-ring' }));
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(shell, txt); root.append(row, K.queue());
    }
  });
})();
