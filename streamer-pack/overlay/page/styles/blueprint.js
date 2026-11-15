// Стиль «Чертёж» (№26). Разметка строится через createElement, стили — в blueprint.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'blueprint', num: 26, name: 'Чертёж', font: 'IBM Plex Mono, monospace',
    pixel: false, mono: false,
    palette: { T: '#9fe3ff', V: '#9fe3ff', extras: { '--a2': '#fff', '--bg': '#0b3a5b' } },
    build: function (root) {
      root.classList.add('blueprint');
      var row = K.h('div', 'row'), bframe = K.h('div', 'bp-frame');
      bframe.append(K.cover('bp-cover'));
      var txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('time', 'time'), K.text('who', 'who'));
      row.append(bframe, txt); root.append(row);
      root.append(K.viz('w', 0, { h: 26, cls: 'bp-wave', w2: '--a2' }), K.queue());
    }
  });
})();
