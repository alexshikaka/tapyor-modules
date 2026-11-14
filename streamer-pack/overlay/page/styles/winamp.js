// Стиль «Winamp» (№11). Разметка строится через createElement, стили — в winamp.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'winamp', num: 11, name: 'Winamp', font: 'Pixelify Sans, monospace',
    pixel: true, mono: false,
    palette: { T: '#2cff2c', V: '#20e020', extras: { '--a2': '#6a6a82', '--a3': '#e0c020', '--a4': '#e02020', '--bg': '#0a1a0a' } },
    build: function (root) {
      root.classList.add('winamp');
      var row = K.h('div', 'row'), cov = K.cover('winamp-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, K.time('winamp-time'), K.viz('g', 14, { rows: 6, cls: 'winamp-led' }));
      var line = K.h('div', 'winamp-line');
      line.append(txt.querySelector('[data-role="title"]'), txt.querySelector('[data-role="artist"]'), txt.querySelector('[data-role="who"]'));
      root.append(row, line, K.queue());
    }
  });
})();
