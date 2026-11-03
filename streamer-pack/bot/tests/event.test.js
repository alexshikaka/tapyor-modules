'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Round, Scheduler } = require('../src/logic/event');
const { track, seeded } = require('./fakes');

const T0 = 1_700_000_000_000, MIN = 60000;

test('розыгрыш: шансы у всех равны', () => {
  const wins = {}; const rnd = seeded(7);
  for (let k = 0; k < 3000; k++) {
    const r = new Round({ method: 'raffle', winners: 1 }, T0, k);
    for (const u of ['a', 'b', 'c']) { r.submit({ msgId: u, userId: u, at: T0 + 1 }); r.resolve(u, true, track(u, 'x')); }
    r.close(T0 + 61000);
    const w = r.finish(rnd).winners[0].userId; wins[w] = (wins[w] || 0) + 1;
  }
  for (const u of ['a', 'b', 'c']) assert.ok(wins[u] > 850 && wins[u] < 1150, u + ': ' + wins[u]);
});
test('розыгрыш: один трек не выигрывает дважды', () => {
  const r = new Round({ method: 'raffle', winners: 2 }, T0, 1);
  const same = track('Кино', 'Звезда');
  for (const u of ['a', 'b']) { r.submit({ msgId: u, userId: u, at: T0 + 1 }); r.resolve(u, true, same); }
  r.submit({ msgId: 'c', userId: 'c', at: T0 + 2 }); r.resolve('c', true, track('Сплин', 'Море'));
  r.close(T0 + 61000);
  const ws = r.finish(seeded(1)).winners;
  assert.equal(ws.length, 2);
  assert.notEqual(ws[0].track.id, ws[1].track.id);
});
test('принятую заявку не заменить; неудачную можно исправить', () => {
  const r = new Round({}, T0, 1);
  r.submit({ msgId: 'm1', userId: 'a', at: T0 + 1 }); r.resolve('m1', false);
  assert.equal(r.submit({ msgId: 'm2', userId: 'a', at: T0 + 2 }).ok, true);
  r.resolve('m2', true, track('A', 'B'));
  assert.equal(r.submit({ msgId: 'm3', userId: 'a', at: T0 + 3 }).why, 'already');
});
test('после закрытия заявки не принимаются', () => {
  const r = new Round({ durationSec: 60 }, T0, 1);
  assert.equal(r.submit({ msgId: 'm', userId: 'a', at: T0 + 61000 }).why, 'closed');
});
test('кто первый: место по времени сообщения, а не по скорости поиска', () => {
  const r = new Round({ method: 'first', firstN: 2 }, T0, 1);
  r.submit({ msgId: 'slow', userId: 'a', at: T0 + 1000 });
  r.submit({ msgId: 'fast', userId: 'b', at: T0 + 2000 });
  r.submit({ msgId: 'late', userId: 'c', at: T0 + 3000 });
  r.resolve('fast', true, track('B', 'b')); r.resolve('late', true, track('C', 'c'));
  assert.equal(r.firstWinners().final, false); // ранний ещё ищется — места не окончательные
  r.resolve('slow', true, track('A', 'a'));
  const f = r.firstWinners();
  assert.equal(f.final, true);
  assert.deepEqual(f.winners.map((e) => e.userId), ['a', 'b']);
});
test('случайное расписание — в заданном промежутке', () => {
  const s = new Scheduler({ when: 'random', minMin: 15, maxMin: 25 }, seeded(3));
  for (let i = 0; i < 50; i++) { const at = s.plan(T0); assert.ok(at >= T0 + 15 * MIN && at <= T0 + 25 * MIN); }
});
test('«когда кончились заказы» и пропуск при длинной очереди', () => {
  const s = new Scheduler({ when: 'afterEmpty', afterEmptyMin: 3, skipIfQueued: 5 });
  const ctx = { online: true, accepting: true, twitchQueued: 0, queueEmpty: true };
  assert.equal(s.due(T0, ctx), false);
  assert.equal(s.due(T0 + 2 * MIN, ctx), false);
  assert.equal(s.due(T0 + 3 * MIN, ctx), true);
  assert.equal(s.due(T0 + 4 * MIN, { ...ctx, online: false }), false);
  const t = new Scheduler({ when: 'timer', everyMin: 20, skipIfQueued: 5 }); t.plan(T0);
  assert.equal(t.due(T0 + 20 * MIN, { ...ctx, twitchQueued: 6 }), false);
  assert.equal(t.nextAt, T0 + 40 * MIN);
});
