'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/logic/triggers');

const TR = ['!play', '!p', '!sr', 'поставь'];

test('команда с текстом', () => {
  assert.deepEqual(t.parse('!play кино группа крови', TR), { trigger: '!play', kind: 'cmd', query: 'кино группа крови' });
  assert.deepEqual(t.parse('!P земфира', TR), { trigger: '!p', kind: 'cmd', query: 'земфира' });
});
test('!playlist — не !play и не !p', () => { assert.equal(t.parse('!playlist', TR), null); });
test('команда без текста — заказ с пустым запросом', () => { assert.deepEqual(t.parse('!play', TR), { trigger: '!play', kind: 'cmd', query: '' }); });
test('слово только в начале и только с текстом', () => {
  assert.equal(t.parse('поставь кино звезда', TR).kind, 'word');
  assert.equal(t.parse('поставь', TR), null);
  assert.equal(t.parse('поставьте что-нибудь', TR), null);
  assert.equal(t.parse('ну поставь кино', TR), null);
});
test('ответ на варианты', () => {
  assert.equal(t.parseChoice('1', TR, 2), 1);
  assert.equal(t.parseChoice('!play 2', TR, 2), 2);
  assert.equal(t.parseChoice('3', TR, 2), null);
  assert.equal(t.parseChoice('поставь 1', TR, 2), null);
});
test('проверка списка триггеров', () => {
  const e = t.validateTriggers(['!play', '!PLAY', '!отмена', '', 'два слова']);
  assert.deepEqual(e.map((x) => x.why), ['duplicate', 'reserved', 'empty', 'space']);
});
