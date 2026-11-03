'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { policyFor, preset, Tracker, DEFAULT_ACCESS } = require('../src/logic/access');
const { user } = require('./fakes');

const NOW = 1_700_000_000_000, DAY = 86400000, MIN = 60000;

test('несколько ролей — самая щедрая', () => {
  const p = policyFor(user('a', { isSub: true, isVip: true }), DEFAULT_ACCESS, NOW);
  assert.equal(p.access, 'always'); assert.equal(p.active, 2); assert.equal(p.pauseMin, 15);
});
test('фолловер считается только после N дней', () => {
  const tbl = preset('event'); tbl.follower.access = 'always';
  assert.equal(policyFor(user('a', { followedAt: NOW - 3 * DAY }), tbl, NOW).access, 'event');
  assert.equal(policyFor(user('a', { followedAt: NOW - 8 * DAY }), tbl, NOW).access, 'always');
});
test('стример — всегда и без лимитов', () => {
  const p = policyFor(user('s', { isBroadcaster: true }), preset('event'), NOW);
  assert.equal(p.access, 'always'); assert.equal(p.unlimited, true);
});
test('пауза считается после того, как трек сыграл', () => {
  const tr = new Tracker(); const u = user('a'); const p = policyFor(u, DEFAULT_ACCESS, NOW);
  tr.onQueued(u.id, 'o1', NOW);
  assert.equal(tr.check(u, p, NOW + MIN).why, 'active');
  tr.onPlayed(u.id, 'o1', NOW + 10 * MIN);
  const c = tr.check(u, p, NOW + 20 * MIN);
  assert.equal(c.why, 'pause'); assert.equal(c.min, 20);
  assert.equal(tr.check(u, p, NOW + 41 * MIN).ok, true);
});
test('лимиты выключены при короткой очереди, но блок и ⛔ действуют', () => {
  const tr = new Tracker(); const u = user('a'); const p = policyFor(u, DEFAULT_ACCESS, NOW);
  tr.onQueued(u.id, 'o1', NOW);
  assert.equal(tr.check(u, p, NOW, { limitsOn: false }).ok, true);
  tr.timeout(u.id, 10, NOW);
  assert.equal(tr.check(u, p, NOW + 2 * MIN, { limitsOn: false }).min, 8);
  tr.block(u.id, 'a');
  assert.equal(tr.check(u, p, NOW + 20 * MIN, { limitsOn: false }).why, 'blocked');
});
test('⛔ и блоки переживают перезапуск', () => {
  const tr = new Tracker(); tr.timeout('u-a', 10, NOW); tr.block('u-b', 'b');
  const again = new Tracker(JSON.parse(JSON.stringify(tr.serialize())));
  assert.equal(again.timeoutLeftMin('u-a', NOW + MIN), 9);
  assert.equal(again.isBlocked('u-b'), true);
});
