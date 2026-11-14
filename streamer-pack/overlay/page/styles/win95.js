// Стиль «Windows 95» (№9). Разметка строится через createElement, стили — в win95.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'win95', num: 9, name: 'Windows 95', font: 'Pixelify Sans, monospace',
    pixel: true, mono: false,
    palette: { T: '#fff', V: '#0f0', extras: { '--c2': '#c0c0c0', '--a2': '#ff5555', '--a3': '#ff0' } },
    build: function (root) {
      root.classList.add('win95');
      var row = K.h('div', 'row'), cov = K.cover('win95-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('time', 'time'));
      row.append(cov, txt); root.append(row, K.h('div', 'win95-sep'));
      root.append(K.viz('g', 34, { rows: 4, cls: 'win95-led' }), K.queue());
    }
  });
})();
