// Стиль «Код (JSON)» (№18). Разметка строится через createElement, стили — в code.css.
(function () {
  'use strict';
  var K = window.TapKit;
  K.register({
    id: 'code', num: 18, name: 'Код (JSON)', font: 'JetBrains Mono, monospace',
    pixel: false, mono: false,
    palette: { T: '#e6edf3', V: '#7ee787', extras: { '--a2': '#8b949e', '--a3': '#ff7b72', '--a4': '#d2a8ff', '--a5': '#79c0ff', '--a6': '#a5d6ff', '--a7': '#ffa657', '--bg': '#0d1117' } },
    build: function (root) {
      root.classList.add('code'); root.dataset.nr = '1';
      var head = K.h('div', 'code-head'), cov = K.cover('code-cover');
      head.append(cov, K.h('span', 'code-comment', '// now playing'));
      var body = K.h('div', 'code-body');
      var l1 = K.h('div', 'code-line'); l1.append(K.h('span', 'code-const', 'const'), K.h('span', 'code-var', ' now'), K.h('span', 'code-p', ' = {'));
      var l2 = K.h('div', 'code-indent'); l2.append(K.h('span', 'code-key', 'title'), K.h('span', 'code-p', ': '), K.text('title', 'code-value code-title'));
      var l3 = K.h('div', 'code-indent'); l3.append(K.h('span', 'code-key', 'artist'), K.h('span', 'code-p', ': '), K.text('artist', 'code-value'));
      var l4 = K.h('div', 'code-indent'); l4.append(K.h('span', 'code-key', 'time'), K.h('span', 'code-p', ': '), K.text('time', 'code-time'));
      var l5 = K.h('div', 'code-indent'); l5.append(K.h('span', 'code-key', 'who'), K.h('span', 'code-p', ': '), K.text('who', 'code-who'));
      var l6 = K.h('div', 'code-indent code-vu'); l6.append(K.h('span', 'code-key', 'vu'), K.h('span', 'code-p', ': '), K.viz('sp', 20, { cls: 'code-viz' }));
      var l7 = K.h('div', 'code-indent', 'next: [');
      body.append(l1, l2, l3, l4, l5, l6, l7, K.queue(), K.h('div', 'code-indent', ']'), K.h('div', 'code-line', '}'));
      root.append(head, body);
    }
  });
})();
