// Стиль «Полароид» (№17). Разметка строится через createElement, стили — в polaroid.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'polaroid', num: 17, name: 'Полароид', font: 'Caveat, cursive',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ffd6a5', extras: { '--a2': '#e76f51', '--a3': '#f4a261' } },
    build: function (root) {
      root.classList.add('polaroid');
      var row = K.h('div', 'row'), frame = K.h('div', 'polaroid-frame');
      frame.append(K.cover('polaroid-cover'));
      var txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      txt.append(K.viz('b', 16, { cls: 'polaroid-viz' }));
      row.append(frame, txt); root.append(row, K.queue());
    }
  });
})();
