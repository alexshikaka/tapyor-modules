// Стиль «Радар HUD» (№27). Разметка строится через createElement, стили — в radar.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'radar', num: 27, name: 'Радар HUD', font: 'Tektur, sans-serif',
    pixel: false, mono: false,
    palette: { T: '#7dffb2', V: '#7dffb2', extras: { '--bg': '#06281a', '--a2': '#fff' } },
    build: function (root) {
      root.classList.add('radar');
      var row = K.h('div', 'row'), radar = K.h('div', 'radar-scope');
      radar.append(K.h('div', 'radar-ring'), K.h('div', 'radar-v'), K.h('div', 'radar-h'), K.h('div', 'radar-sweep'));
      var center = K.h('div', 'radar-center'); center.append(K.cover('radar-cover')); radar.append(center);
      radar.append(K.h('i', 'radar-dot radar-dot1'), K.h('i', 'radar-dot radar-dot2'));
      var txt = K.h('div', 'textcol');
      txt.append(K.text('title', 'title'), K.text('artist', 'artist'), K.text('time', 'time'), K.text('who', 'who'));
      txt.append(K.viz('sp', 24, { cls: 'radar-viz' }));
      row.append(radar, txt); root.append(row, K.queue());
    }
  });
})();
