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

// ---------- OV6: два вида визуализатора у каждого типа ----------
const SPECTRUM = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

test('OV6: вид визуализатора берётся из настроек, мусор — волна', () => {
  assert.equal(V.viewOf('spectrum'), 'spectrum');
  assert.equal(V.viewOf('wave'), 'wave');
  assert.equal(V.viewOf('real'), 'wave');
  assert.equal(V.viewOf('fake'), 'wave');
  assert.equal(V.viewOf(undefined), 'wave');
  assert.equal(V.viewOf(null), 'wave');
});

test('OV6 волна: синусоида бежит по столбикам, высота от громкости', () => {
  const full = V.values('b', 'wave', { n: 12, lv: 1, phase: 0 });
  assert.equal(full.length, 12);
  full.forEach((v) => assert.ok(v >= 0 && v <= 1));
  assert.ok(new Set(full.map((v) => v.toFixed(3))).size > 4, 'волна двигается по столбикам');
  assert.deepEqual(V.values('b', 'wave', { n: 5, lv: 0, phase: 0 }), [0, 0, 0, 0, 0]);
  const loud = V.values('b', 'wave', { n: 8, lv: 1, phase: 0 });
  const half = V.values('b', 'wave', { n: 8, lv: 0.5, phase: 0 });
  for (let i = 0; i < 8; i++) assert.ok(Math.abs(half[i] - loud[i] * 0.5) < 1e-9, 'громкость масштабирует высоту');
  const moved = V.values('b', 'wave', { n: 12, lv: 1, phase: 0.25 });
  assert.notDeepEqual(moved, full, 'фаза двигает волну');
});

test('OV6 спектр: каждый столбик — своя полоса, без спектра — волна', () => {
  assert.deepEqual(V.values('b', 'spectrum', { n: 3, spec: [0, 0.5, 1], live: true }), [0, 0.5, 1]);
  assert.deepEqual(V.values('g', 'spectrum', { n: 3, spec: [0, 0.5, 1], live: true }), [0, 0.5, 1]);
  assert.deepEqual(V.values('bw', 'spectrum', { n: 3, spec: [0, 0.5, 1], live: true }), [0, 0.5, 1]);
  // Спектра нет > 1,5 с — плавный переход на волну (те же значения, что у волны).
  assert.deepEqual(V.values('b', 'spectrum', { n: 8, lv: 0.7 }),
    V.values('b', 'wave', { n: 8, lv: 0.7 }));
  assert.deepEqual(V.values('b', 'spectrum', { n: 8, lv: 0.7, spec: [], live: true }),
    V.values('b', 'wave', { n: 8, lv: 0.7 }));
});

test('OV6 кольцо: лучи по кругу, спектр зеркален по половинам', () => {
  const a = V.values('r', 'spectrum', { n: 8, spec: [0, 0.2, 0.4, 0.6, 0.8, 1], live: true });
  assert.equal(a[0], a[7]);
  assert.equal(a[1], a[6]);
  assert.equal(a[2], a[5]);
  assert.equal(a[3], a[4]);
  const w = V.values('r', 'wave', { n: 8, lv: 1, phase: 0 });
  assert.ok(new Set(w.map((v) => v.toFixed(3))).size > 4);
});

test('OV6 кривая: спектр — сглаженная кривая через полосы', () => {
  const sharp = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const v = V.values('w', 'spectrum', { n: 9, spec: sharp, live: true });
  assert.ok(v[4] < 1 && v[4] > 0.4, 'пик сглажен, но виден');
  assert.ok(v[3] > 0 && v[5] > 0, 'соседние точки подхватывают пик');
  const wave = V.values('w', 'wave', { n: 9, lv: 1, phase: 0 });
  assert.ok(wave.some((x) => x > 0.5) && wave.some((x) => x < 0.5));
});

test('OV6 стрелки: волна — громкость с задержкой, спектр — низы и верха', () => {
  assert.deepEqual(V.values('nd', 'wave', { lv: 0.8, prev: 0.5 }), [0.8, 0.5]);
  const spec = new Array(32).fill(0);
  for (let i = 0; i < 11; i++) spec[i] = 0.6;
  for (let i = 16; i < 32; i++) spec[i] = 0.2;
  const s = V.values('nd', 'spectrum', { spec, live: true });
  assert.ok(Math.abs(s[0] - 0.6) < 1e-9, 'левая — низы');
  assert.ok(Math.abs(s[1] - 0.2) < 1e-9, 'правая — верха');
  assert.deepEqual(V.values('nd', 'spectrum', { spec, live: false, lv: 0.3, prev: 0.1 }), [0.3, 0.1]);
});

test('OV6 лента: история громкости, спектр — полосы, без спектра — волна', () => {
  assert.deepEqual(V.ribbonStep([0, 0, 0], 'wave', { n: 3, lv: 0.6, rate: 1, min: 0.05 }), [0, 0, 0.6]);
  assert.deepEqual(V.ribbonStep([0, 0, 0], 'wave', { n: 3, lv: 0, rate: 1, min: 0.05 }), [0, 0, 0.05]);
  assert.deepEqual(V.ribbonStep([0, 0, 0], 'spectrum', { n: 3, spec: [0, 0.5, 1], live: true, rate: 1 }),
    [0, 0.5, 1]);
  // Нет живого спектра — лента снова бежит историей громкости.
  assert.deepEqual(V.ribbonStep([0, 0, 0], 'spectrum', { n: 3, spec: [0, 0.5, 1], live: false, lv: 0.4, rate: 1 }),
    [0, 0, 0.4]);
  // Плавность: медленный шаг не доходит до цели за один кадр.
  const slow = V.ribbonStep([0, 0, 0], 'spectrum', { n: 3, spec: [0, 0.5, 1], live: true, rate: 0.25 });
  assert.ok(slow[2] > 0 && slow[2] < 0.5);
});
