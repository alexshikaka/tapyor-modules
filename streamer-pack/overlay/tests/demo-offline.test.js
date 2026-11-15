'use strict';
// Демо-режим (?demo=1) показывают на сайте Тапёра, где нет локального сервера пака:
// страница не должна открывать EventSource к /events — иначе запрос с ошибкой каждые 15 секунд.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'page', 'overlay-app.js'), 'utf8');

test('демо не подключается к событиям ядра', () => {
  const calls = SRC.split('\n').filter((l) => /connectEvents\(\)/.test(l) && !/function connectEvents/.test(l));
  assert.ok(calls.length >= 2, 'вызовы connectEvents найдены');
  for (const l of calls) assert.match(l, /!DEMO/, 'каждый вызов закрыт проверкой демо: ' + l.trim());
});
