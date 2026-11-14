// Стиль «Кассета» (№19). Разметка строится через createElement, стили — в cassette.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'cassette', num: 19, name: 'Кассета', font: 'PT Mono, monospace',
    pixel: false, mono: false,
    palette: { T: '#fff', V: '#e8d9b5', extras: { '--a2': '#c0392b' } },
    build: function (root) {
      root.classList.add('cassette');
      var row = K.h('div', 'row'), shell = K.h('div', 'cassette-body');
      var top = K.h('div', 'cassette-label', 'MIX TAPE');
      var win = K.h('div', 'cassette-window'); win.append(K.cover('cassette-cover'));
      var spool1 = K.h('div', 'cassette-spool'), spool2 = K.h('div', 'cassette-spool');
      shell.append(top, win, spool1, spool2);
      var txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(shell, txt); root.append(row, K.viz('b', 30, { cls: 'cassette-viz' }), K.queue());
    }
  });
})();
