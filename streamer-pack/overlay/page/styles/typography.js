// Стиль «Типографика» (№5). Разметка строится через createElement, стили — в typography.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'typography', num: 5, name: 'Типографика', font: 'Manrope, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#fff', extras: {} },
    build: function (root) {
      root.classList.add('typography');
      var row = K.h('div', 'row'), cov = K.cover('typo-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('b', 46, { cls: 'typo-viz' }), K.queue());
    }
  });
})();
