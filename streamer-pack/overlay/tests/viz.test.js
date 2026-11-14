'use strict';
// Визуализаторы: спектр → столбики/сегменты/кольцо/волна, громкость → лента/стрелки.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../page/viz');

test('визуализатор: 32 полосы интерполируются на любое N', () => {
  assert.equal(V.interp([0, 1], 0, 28), 0);
  assert.equal(V.interp([0, 1], 27, 28), 1);
  assert.ok(Math.abs(V.interp([0, 1], 1, 31) - 1 / 30) < 1e-9);
  assert.equal(V.interp([], 5, 10), 0);
  assert.equal(V.interp([0.4, 0.8], 0, 1), 0.4);
});

test('визуализатор: вверх быстрее, вниз медленнее, цель достигается', () => {
  const up = V.next(0, 1), down = V.next(1, 0);
  assert.ok(up > 1 - down);
  let x = 0.2;
  for (let i = 0; i < 200; i++) x = V.next(x, 0.9);
  assert.ok(Math.abs(x - 0.9) < 1e-6);
  // Плавность из настроек: fast/mid/slow задают общую долю шага.
  assert.equal(V.next(0, 1, 0.5), 0.5);
  assert.equal(V.next(0, 1, 0), 0);
  assert.equal(V.next(0, 1, 1), 1);
  assert.equal(V.next(0, 1, 2), 1);
});

test('визуализатор: сегменты и стрелка не выходят за пределы', () => {
  assert.equal(V.lit(0, 4), 0); assert.equal(V.lit(1, 4), 4); assert.equal(V.lit(0.5, 4), 2);
  assert.equal(V.lit(-1, 4), 0); assert.equal(V.lit(2, 4), 4);
  assert.equal(V.needleAngle(0), -55); assert.equal(V.needleAngle(1), 55); assert.equal(V.needleAngle(0.5), 0);
});

test('визуализатор: волна, история и имитация', () => {
  assert.equal(V.waveY(0, 30, 60, 100), 92);
  assert.ok(V.waveY(1, 30, 60, 100) < 92);
  const h = [0, 0, 0];
  V.historyPush(h, 0.8, 0.05);
  assert.deepEqual(h, [0, 0, 0.8]);
  V.historyPush(h, 0, 0.05);
  assert.equal(h[2], 0.05);
  for (let t = 0; t < 20; t += 0.1) {
    const v = V.imitation(t, 0.3);
    assert.ok(v >= 0 && v <= 1);
  }
});
