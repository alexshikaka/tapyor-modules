// Стиль «Синтвейв» (№15). Разметка строится через createElement, стили — в synth.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'synth', num: 15, name: 'Синтвейв', font: 'Russo One, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#ff2bd6', extras: { '--a2': '#19e3ff', '--c2': '#ff9bf0', '--bg': '#2a0f5c' } },
    build: function (root) {
      root.classList.add('synth');
      var row = K.h('div', 'row'), cov = K.cover('synth-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); root.append(row);
      root.append(K.viz('b', 26, { cls: 'synth-viz' }), K.queue());
    }
  });
})();
