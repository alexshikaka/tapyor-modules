// Стиль «Mac System 7» (№10): каркас. Разметка строится через createElement.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'sys7', num: 10, name: 'Mac System 7', font: 'Pixelify Sans',
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
