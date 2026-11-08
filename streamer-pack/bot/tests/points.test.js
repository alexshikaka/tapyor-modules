'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Points } = require('../src/logic/points');
const { track, fakeCore, user } = require('./fakes');

const CAT = { 'ария беспечный ангел': { level: 'exact', track: track('Ария', 'Беспечный ангел') }, 'лирика': { level: 'doubt', track: track('Сектор Газа', 'Лирика'), alts: [] } };

function make(cfg = {}, coreOpts = {}) {
  const core = fakeCore(CAT, coreOpts); const said = []; const tw = { done: [], back: [] };
  const twitch = { fulfill: async (id) => tw.done.push(id), cancel: async (id) => tw.back.push(id) };
  const p = new Points(cfg, { core, twitch, say: async (t) => said.push(t) });
  return { p, core, said, tw };
}
const R = (input, id = 'r1') => ({ id, at: 1, input, user: user('olya') });

test('нашёл — в очередь как платный; заиграл — «выполнено»', async () => {
  const { p, core, tw } = make();
  assert.equal(await p.handle(R('ария беспечный ангел')), 'queued');
  assert.equal(core.added[0].prov, 'twitch-points');
  assert.equal(tw.done.length, 0);
  await p.played(core.added[0].id);
  assert.deepEqual(tw.done, ['r1']);
});
test('стример убрал трек — баллы вернулись и бот сказал почему', async () => {
  const { p, core, said, tw } = make();
  await p.handle(R('ария беспечный ангел'));
  await p.dropped(core.added[0].id, 'removed');
  assert.deepEqual(tw.back, ['r1']);
  assert.match(said.at(-1), /баллы вернул: стример убрал трек/);
});
test('не нашёл — возврат', async () => {
  const { p, tw } = make();
  assert.equal(await p.handle(R('непонятно что')), 'refund-notFound');
  assert.deepEqual(tw.back, ['r1']);
});
test('сомнение — ставит с пометкой стримеру', async () => {
  const { p, core } = make();
  assert.equal(await p.handle(R('лирика')), 'queued-doubt');
  assert.equal(core.added[0].doubt, true);
});
test('приём выключен — возврат', async () => {
  const { p, tw } = make({ accepting: false });
  assert.equal(await p.handle(R('ария беспечный ангел')), 'refund-closed');
  assert.deepEqual(tw.back, ['r1']);
});
test('ошибка создания заказа — баллы возвращаются', async () => {
  const { p, core, tw } = make();
  core.orders.add = () => { throw new Error('очередь недоступна'); };
  const r = await p.handle(R('ария беспечный ангел'));
  assert.equal(r, 'refund-error');
  assert.deepEqual(tw.back, ['r1']);
});
test('правила ядра — возврат с причиной', async () => {
  const { p, said } = make({}, { rules: () => ({ ok: false, reason: 'tooLong' }) });
  await p.handle(R('ария беспечный ангел'));
  assert.match(said.at(-1), /трек слишком длинный/);
});
test('баллы — платный заказ: ядро получает paid, сомнительный канон уходит стримеру', async () => {
  const { p, core, said } = make();
  await p.handle(R('ария беспечный ангел'));
  assert.equal(core.calls.at(-1).o.paid, true);
  assert.equal(await p.handle(R('лирика', 'r2')), 'queued-doubt');
  assert.equal(core.added.at(-1).doubt, true);
});
