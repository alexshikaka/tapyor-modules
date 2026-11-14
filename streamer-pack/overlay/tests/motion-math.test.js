'use strict';
// Моушн: центровка по видимому, подводка, запас ×2 и время показа.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../page/motion-math');

test('моушн: центр по видимому, а не по коробке', () => {
  const R = { left: 100, right: 500 };            // центр 300
  assert.equal(M.centerShift(R, { l: 120, r: 520 }), -20);
  assert.equal(M.centerShift(R, { l: 80, r: 480 }), 20);
  assert.equal(M.centerShift(R, { l: 100, r: 500 }), 0);
  assert.equal(M.centerShift(R, { l: 200, r: 560 }), -80);
});

test('моушн: подводка с полями 18/14 вокруг текста и вылетов', () => {
  const R = { left: 100, top: 100, right: 500, bottom: 300 };
  const U = { l: 80, t: 90, r: 540, b: 310 };
  assert.deepEqual(M.plateRect(R, U, 1), { top: -24, left: -38, right: -58, bottom: -24 });
  const s = M.plateRect(R, U, 2);
  assert.equal(s.left, -28); assert.equal(s.top, -19); assert.equal(s.right, -38); assert.equal(s.bottom, -19);
});

test('моушн: запас названия вдвое длиннее плейлиста, с ограничением free', () => {
  assert.equal(M.reserveExtra(100, 200, false, 999), 200);
  assert.equal(M.reserveExtra(100, 200, true, 999), 500);      // 2 × (100+200) − 100
  assert.equal(M.reserveExtra(100, 200, true, 300), 300);
  assert.equal(M.reserveExtra(100, 0, true, 999), 0);
  assert.equal(M.holdSeconds(undefined), 5); assert.equal(M.holdSeconds(1), 3);
  assert.equal(M.holdSeconds(99), 15); assert.equal(M.holdSeconds(7), 7);
});
