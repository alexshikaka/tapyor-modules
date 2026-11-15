'use strict';
// Демо-режим страниц: параметры ссылки, треки и очередь.
const test = require('node:test');
const assert = require('node:assert/strict');
const Demo = require('../page/demo');

test('demo: параметры ссылки, style/pos/nick/long/track/paused', () => {
  assert.deepEqual(Demo.options(''), { preview: false, demo: false, long: false, paused: false, track: 'normal', style: '', pos: '', nick: null, queue: '', dx: 0, dy: 0, size: 100, feat: {} });
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

test('demo: ?queue=long — длинная очередь для проверки обрезки', () => {
  const q = Demo.queue('long');
  assert.equal(q.length, 3);
  assert.equal(q[0].title, Demo.TRACKS.long.title, 'первая строка длиннее колонки в любом стиле');
  assert.equal(q[2].title, 'Ночь', 'короткая строка помещается и проверяет выравнивание');
  assert.equal(Demo.queue().length, 5, 'обычная очередь не изменилась');
  assert.equal(Demo.options('?queue=long').queue, 'long');
});

test('demo: обложки из TapDemoCovers — только если страница их дала', () => {
  assert.equal(Demo.np('normal', 0, true, 0).cover, '');
  assert.equal('cover' in Demo.queue()[0], false);
  globalThis.TapDemoCovers = { 'Группа крови': 'covers/a.jpg', 'Хочешь?': 'covers/b.jpg' };
  try {
    assert.equal(Demo.np('normal', 0, true, 0).cover, 'covers/a.jpg');
    assert.equal(Demo.queue()[0].cover, 'covers/b.jpg');
    assert.equal('cover' in Demo.queue()[1], false);
    assert.equal(Demo.list('normal')[0].cover, 'covers/a.jpg');
  } finally { delete globalThis.TapDemoCovers; }
});
