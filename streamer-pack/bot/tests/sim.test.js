'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSim } = require('../src/bot');

test('имитация: разбор «#sim ник роли текст»', () => {
  const s = parseSim('#sim vasya vip sub !play кино группа крови');
  assert.equal(s.kind, 'sim'); assert.equal(s.login, 'vasya');
  assert.ok(s.roles.has('vip') && s.roles.has('sub'));
  assert.equal(s.text, '!play кино группа крови');
  assert.equal(parseSim('#simpts @olya ария беспечный ангел').kind, 'simpts');
  assert.equal(parseSim('#simshared petya !play земфира').kind, 'simshared');
  assert.equal(parseSim('!play кино'), null);
  assert.equal(parseSim('#sim vasya'), null);
});
