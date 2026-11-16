'use strict';
// Расписание экономичного опроса — на подставном времени, без таймеров.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hostDelay, HOST_PHONE, HOST_COMMAND, HOST_NONE, HOST_NONE_LONG
} = require('../src/poll');
const {
  phoneDelay, PHONE_POLL, PHONE_POLL_TAP, RETRY
} = require('../page/poll-plan');

const NOW = 1763300000000;
const SEC = 1000;
const MIN = 60 * SEC;

test('ОПРОС ТАПЁРА: телефон на связи — 3 с, после команды 20 с — 1 с', () => {
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW }), HOST_PHONE);
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 29999 }), HOST_PHONE, 'меньше 30 с — телефон есть');
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 5000, commandAt: NOW }), HOST_COMMAND);
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 5000, commandAt: NOW - 19999 }), HOST_COMMAND);
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 5000, commandAt: NOW - 20000 }), HOST_PHONE, '20 с прошло');
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 5000, commandAt: NOW - MIN }), HOST_PHONE);
});

test('ОПРОС ТАПЁРА: телефона нет — 10 с, два часа — 60 с', () => {
  assert.equal(hostDelay({ now: NOW, phoneAt: null, missingSince: NOW }), HOST_NONE);
  assert.equal(hostDelay({ now: NOW, phoneAt: null, missingSince: NOW - 2 * 60 * MIN + 1 }), HOST_NONE);
  assert.equal(hostDelay({ now: NOW, phoneAt: null, missingSince: NOW - 2 * 60 * MIN }), HOST_NONE_LONG);
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 30000 }), HOST_NONE, '30 с без телефона — уже «нет»');
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 2 * 60 * MIN }), HOST_NONE_LONG);
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - 5 * MIN, commandAt: NOW }), HOST_NONE, 'без телефона команды не ускоряют');
});

test('ОПРОС ТАПЁРА: свежий телефон важнее давнего показа QR', () => {
  assert.equal(hostDelay({ now: NOW, phoneAt: NOW - SEC, missingSince: NOW - 3 * 60 * MIN }), HOST_PHONE);
  assert.equal(hostDelay({ now: NOW }), HOST_NONE, 'без времени показа — как «телефона нет»');
});

test('ОПРОС ТЕЛЕФОНА: Wi-Fi — 0,3 с, после нажатия 0,15 с', () => {
  assert.equal(phoneDelay({ now: NOW, visible: true, lan: true }), 300);
  assert.equal(phoneDelay({ now: NOW, visible: true, lan: true, tappedAt: NOW }), 150);
  assert.equal(phoneDelay({ now: NOW, visible: false, lan: true }), null);
});

test('ОПРОС ТЕЛЕФОНА: облако — 1 с, нажатие — 0,35 с, скрыта — не опрашивает', () => {
  assert.equal(phoneDelay({ now: NOW, visible: true }), PHONE_POLL);
  assert.equal(phoneDelay({ now: NOW, visible: false, tappedAt: NOW }), null);
  assert.equal(phoneDelay({ now: NOW, visible: true, tappedAt: NOW }), PHONE_POLL_TAP);
  assert.equal(phoneDelay({ now: NOW, visible: true, tappedAt: NOW - 19999 }), PHONE_POLL_TAP);
  assert.equal(phoneDelay({ now: NOW, visible: true, tappedAt: NOW - 20000 }), PHONE_POLL, '20 с прошло');
  assert.equal(phoneDelay({ now: NOW, visible: true, retry: true }), RETRY);
  assert.equal(phoneDelay({ now: NOW, visible: true, retry: true, tappedAt: NOW }), PHONE_POLL_TAP, 'нажатие важнее повтора');
});
