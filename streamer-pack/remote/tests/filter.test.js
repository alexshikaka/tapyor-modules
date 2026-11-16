'use strict';
// Снимок и лента для телефона: без look и своих обложек, последние 30 карточек.
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapForPhone, feedForPhone, signature, topLevelCards, lastCards } = require('../src/filter');

function card(i, kind) {
  return '<div class="rq dock-card" data-kind="' + (kind || 'don') + '">' +
    '<div class="rq-h"><b>Ник' + i + '</b><span class="amt">' + i + ' ₽</span></div>' +
    '<div class="rq-m">заказ ' + i + '</div>' +
    '<div class="rq-it"><div class="rq-tr"><div class="tm"><div class="tt">Трек ' + i + '</div>' +
    '<div class="ts">Кино · Яндекс</div></div></div></div>' +
    '<button data-rq="add" data-id="' + i + ':0">＋ В очередь</button>' +
    '</div>';
}

test('FILTER: снимок без look, обложки только https, исходник не меняется', () => {
  const src = {
    v: 1,
    at: 1763300000000,
    mode: 'live',
    cur: 1,
    np: { title: 'Хочешь?', artist: 'Земфира', playing: true, pos: 12.5, dur: 220, cover: '/lcover/x' },
    items: [
      { i: 0, key: 'ym:1', title: 'A', thumb: 'https://img/a.jpg', st: 'done' },
      { i: 1, key: 'ym:2', title: 'B', thumb: 'http://img/b.jpg' },
      { i: 2, key: 'ym:3', title: 'C', thumb: '/lcover/abc' },
      { i: 3, key: 'ym:4', title: 'D', thumb: 'javascript:alert(1)' }
    ],
    after: [{ title: 'E', artist: 'F', thumb: 'https://img/e.jpg' }, { title: 'G', thumb: '/lcover/z' }],
    wave: { title: 'Волна', sub: 'по заказам', auto: true },
    counts: { pending: 2, played: 1 },
    opts: { ban: true, banMin: 10 },
    look: { cls: 'theme-dark', style: '--bg0:#000', scale: 100 },
    theme: { vars: { '--bg0': '#222222' }, light: false }
  };
  const copy = JSON.stringify(src);
  const out = snapForPhone(src);
  assert.equal(JSON.stringify(src), copy, 'исходный снимок не должен меняться');
  assert.equal(out.look, undefined);
  assert.deepEqual(out.theme, src.theme);
  assert.deepEqual(out.opts, src.opts);
  assert.equal(out.items[0].thumb, 'https://img/a.jpg');
  assert.equal(out.items[1].thumb, '');
  assert.equal(out.items[2].thumb, '');
  assert.equal(out.items[3].thumb, '');
  assert.equal(out.after[0].thumb, 'https://img/e.jpg');
  assert.equal(out.after[1].thumb, '');
  assert.equal(out.np.title, 'Хочешь?');
  assert.equal(out.np.cover, undefined);
  assert.equal(out.mode, 'live');
});

test('FILTER: снимок мусора не ломает', () => {
  assert.equal(snapForPhone(null), null);
  assert.equal(snapForPhone('нет'), null);
  const out = snapForPhone({ items: 'нет', np: 'нет' });
  assert.deepEqual(out.items, []);
  assert.equal(out.np, null);
});

test('FILTER: лента — последние 30 карточек верхнего уровня', () => {
  const all = [];
  for (let i = 0; i < 35; i++) all.push(card(i, i % 2 ? 'chat' : 'don'));
  const html = all.join('');
  const out = feedForPhone({ feedHtml: html, msgCount: '7', reqAuto: 1, np: { title: 'T', artist: 'A', pos: 4, dur: 10 } });
  assert.equal(out.msgCount, 7);
  assert.equal(out.reqAuto, true);
  assert.equal(out.np.title, 'T');
  const cards = topLevelCards(out.feedHtml);
  assert.equal(cards.length, 30);
  assert.ok(out.feedHtml.includes('Ник5'));
  assert.ok(!out.feedHtml.includes('Ник4'));
  assert.ok(out.feedHtml.includes('Трек 34'));
  assert.ok(out.feedHtml.includes('data-id="34:0"'));
});

test('FILTER: вложенные div не рвут карточку', () => {
  const html = '<div class="rq">' + '<div><div class="rq-h">x</div></div>' + '<div class="rq-it">y</div>' + '</div>';
  const cards = topLevelCards(html);
  assert.deepEqual(cards, [html]);
  assert.equal(lastCards(html, 30), html);
  assert.equal(lastCards(html + '<div class="rq">2</div>', 1), '<div class="rq">2</div>');
});

test('FILTER: подпись не замечает at и np.pos, но замечает смысл', () => {
  const a = { v: 1, at: 100, np: { title: 'A', pos: 1 }, items: [{ i: 0 }] };
  const b = { v: 1, at: 999, np: { title: 'A', pos: 44 }, items: [{ i: 0 }] };
  const c = { v: 1, at: 100, np: { title: 'B', pos: 1 }, items: [{ i: 0 }] };
  assert.equal(signature(a), signature(b));
  assert.notEqual(signature(a), signature(c));
});

test('FILTER: пустая лента и странные поля', () => {
  assert.deepEqual(feedForPhone(null), { feedHtml: '', msgCount: 0, reqAuto: false, np: null });
  const out = feedForPhone({ feedHtml: 12, msgCount: -5, reqAuto: 'да', np: { title: 42 } });
  assert.equal(out.feedHtml, '');
  assert.equal(out.msgCount, 0);
  assert.equal(out.reqAuto, true);
  assert.equal(out.np.title, '');
});
