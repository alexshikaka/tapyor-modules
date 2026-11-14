'use strict';
// Цвета стилей: при исходных T/V каждый extra совпадает с образцом, чёрный не меняется.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../page/colors');

test('цвета: extras стиля совпадают с образцом ±1 по каналу', () => {
  const samples = [
    ['#ffd1c7', '#ffffff', '#f0654f'],
    ['#2a9d8f', '#fff4d6', '#e9c46a'],
    ['#ff4d2e', '#ffffff', '#ffe14d'],
    ['#ff3ea5', '#ffffff', '#19e3ff'],
    ['#ff5555', '#ffffff', '#00ff00'],
    ['#c0392b', '#ffffff', '#e8d9b5'],
    ['#ff7b72', '#e6edf3', '#7ee787'],
    ['#2ec4ff', '#ffffff', '#ff3b6b']
  ];
  const ch = (a, b) => {
    const x = C.hex2rgb(a), y = C.hex2rgb(b);
    return x.every((v, i) => Math.abs(v - y[i]) <= 1);
  };
  for (const [extra, T, V] of samples) {
    const got = C.derive(extra, T, V, T, V);
    assert.ok(ch(got, extra), extra + ' → ' + got);
    const changed = C.derive(extra, T, V, '#123456', '#abcdef');
    assert.match(changed, /^#[0-9a-f]{6}$/);
  }
});

test('цвета: чёрные обводки не меняются, T/V подставляются напрямую', () => {
  for (const black of ['#000', '#000000', '#0b0b0b', '#111111']) {
    assert.equal(C.derive(black, '#fff', '#ff0000', '#123456', '#abcdef'), C.norm(black));
  }
  assert.equal(C.derive('#ffd1c7', '#fff', '#f0654f', '#fff', '#f0654f'), '#ffd1c7');
  assert.equal(C.derive('#ffffff', '#fff', '#f0654f', '#123456', '#abcdef'), '#123456');
  assert.equal(C.derive('#f0654f', '#fff', '#f0654f', '#123456', '#abcdef'), '#abcdef');
});

test('цвета: все extras пересчитываются одной функцией', () => {
  const p = { T: '#fff', V: '#f0654f', extras: { '--c2': '#ffd1c7', '--bg': '#0b0b0b' } };
  const v = C.variables(p, '#33ff66', '#ff0000');
  assert.match(v['--c2'], /^#[0-9a-f]{6}$/);
  assert.equal(v['--bg'], '#0b0b0b');
  assert.deepEqual(C.variables(p, '#fff', '#f0654f'), { '--c2': '#ffd1c7', '--bg': '#0b0b0b' });
});
