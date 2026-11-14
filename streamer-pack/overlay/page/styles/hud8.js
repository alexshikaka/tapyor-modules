// Стиль «8-бит HUD» (№14). Разметка строится через createElement, стили — в hud8.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'hud8', num: 14, name: '8-бит HUD', font: 'Tiny5, monospace',
    pixel: true, mono: false,
    palette: { T: '#fff', V: '#ffd23f', extras: { '--a2': '#ff4d6d', '--a3': '#7bf1a8', '--bg': '#2b2d42' } },
    build: function (root) {
      root.classList.add('hud8');
      var row = K.h('div', 'row'), cov = K.cover('hud8-cover'), txt = K.h('div', 'textcol');
      txt.append(K.text('time', 'hud8-time'), K.text('title', 'title'), K.text('artist', 'artist'), K.text('who', 'who'));
      row.append(cov, txt); root.append(row, K.prog('hud8-prog'), K.queue());
    }
  });
})();
