'use strict';
// Демо-режим страниц: параметры ссылки, треки и очередь.
const test = require('node:test');
const assert = require('node:assert/strict');
const Demo = require('../page/demo');

test('demo: параметры ссылки, style/pos/nick/long/track/paused', () => {
  assert.deepEqual(Demo.options(''), { preview: false, demo: false, long: false, paused: false, track: 'normal', style: '', pos: '', nick: null, feat: {} });
  const o = Demo.options('?demo=1&preview=1&long=1&paused=1&style=vu&pos=tl&nick=1&track=medium');
  assert.equal(o.demo, true); assert.equal(o.preview, true); assert.equal(o.paused, true);
  assert.equal(o.track, 'medium'); assert.equal(o.style, 'vu'); assert.equal(o.pos, 'tl'); assert.equal(o.nick, '1');
  const long = Demo.options('?long=1');
  assert.equal(long.track, 'long'); assert.equal(long.long, true);
  assert.equal(Demo.options('?track=мусор').track, 'normal');
});

test('demo: треки, позиция, пауза и очередь с ником', () => {
  const n = Demo.np('long', 1000, false, 6000);
  assert.equal(n.title, Demo.TRACKS.long.title); assert.equal(n.pos, 97);
  assert.equal(n.playing, true); assert.equal(n.who, 'очень_длинный_ник_зрителя');
  const p = Demo.np('normal', 0, true, 6000);
  assert.equal(p.pos, 92); assert.equal(p.playing, false);
  assert.equal(Demo.queue()[0].who, 'lera_k');
  assert.equal('who' in Demo.queue()[3], false);
  assert.deepEqual(Demo.list('long').map((x) => x.title), [Demo.TRACKS.long.title, Demo.TRACKS.medium.title, Demo.TRACKS.normal.title]);
});
