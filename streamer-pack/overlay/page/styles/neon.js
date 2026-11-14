// Стиль «Неоновая вывеска» (№21): каркас. Разметка строится через createElement.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'neon', num: 21, name: 'Неоновая вывеска', font: 'Pacifico',
    palette: { T: '#fff', V: '#fff', extras: {} },
    build: function (root) {
      var row = K.h('div', 'row'), cov = K.cover();
      var txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt);
      root.append(row, K.queue());
    }
  });
})();
