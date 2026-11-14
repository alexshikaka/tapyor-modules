// Стиль «VU-метр» (№20). Разметка строится через createElement, стили — в vu.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'vu', num: 20, name: 'VU-метр', font: 'IBM Plex Mono, monospace',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ffcc00', extras: { '--a2': '#ff3b30', '--bg': '#222' } },
    build: function (root) {
      root.classList.add('vu');
      var head = K.h('div', 'vu-head'), cov = K.cover('vu-cover');
      head.append(cov, K.text('title', 'vu-title'));
      var line = K.h('div', 'vu-line'), txt = K.h('div', 'vu-text');
      txt.append(K.text('artist', 'vu-artist'), K.text('who', 'vu-who'));
      line.append(txt, K.needles([1, 3]));
      root.append(head, line, K.queue());
    }
  });
})();
