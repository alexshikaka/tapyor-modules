// Стиль «Сити-поп» (№23). Разметка строится через createElement, стили — в citypop.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'citypop', num: 23, name: 'Сити-поп', font: 'Noto Serif JP, serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ff6b6b', extras: { '--c2': '#ffd6c9', '--a2': '#ff9a8b', '--a3': '#4a4e69' } },
    build: function (root) {
      root.classList.add('citypop');
      var label = K.h('div', 'city-label', '再生中');
      var body = K.h('div', 'city-body'), row = K.h('div', 'row'), cov = K.cover('city-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt);
      body.append(row, K.viz('bw', 4, { cls: 'city-bars' }), K.queue());
      root.append(label, body);
    }
  });
})();
