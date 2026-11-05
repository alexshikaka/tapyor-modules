'use strict';
// Fuzz/property-тесты для лимитера и допуска в очередь.
// Без сети, Electron и реального Twitch: только чистые зависимости и фейковое ядро.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Limiter } = require('../src/logic/limiter');
const { Pipeline } = require('../src/logic/pipeline');
const { preset } = require('../src/logic/access');
const { track, fakeCore, clock, seeded, user } = require('./fakes');

function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('fuzz: Limiter не превышает max и не теряет задачи', async () => {
  const rnd = prng(42);
  const max = 4;
  const limiter = new Limiter(max, 120);
  let peak = 0, done = 0, timeouts = 0;

  const jobs = Array.from({ length: 80 }, () => limiter.run(async () => {
    // Смотрим внутренний счётчик Limiter, а не внешний счётчик промисов:
    // следующий job может стартовать до .finally предыдущего.
    peak = Math.max(peak, limiter.running);
    const wait = Math.floor(rnd() * 60);
    await new Promise((r) => setTimeout(r, wait));
    if (rnd() < 0.12) throw new Error('fuzz failure');
    return wait;
  }).then((r) => {
    done++;
    if (r && r.timeout) timeouts++;
    return r;
  }));

  const results = await Promise.all(jobs);
  assert.equal(results.length, 80, 'все задачи должны завершиться');
  assert.equal(done, 80, 'каждая задача должна получить результат');
  assert.ok(peak <= max, `одновременно выполнялось ${peak} > ${max}`);
  assert.equal(limiter.running, 0, 'счётчик running должен вернуться к 0');
  assert.equal(limiter.queue.length, 0, 'очередь лимитера должна опустеть');
  assert.ok(timeouts >= 0);
});

test('fuzz: Limiter возвращает timeout, а не зависает', async () => {
  const limiter = new Limiter(1, 30);
  const r = await limiter.run(() => new Promise((resolve) => setTimeout(() => resolve('late'), 120)));
  assert.equal(r.timeout, true);
  assert.equal(limiter.running, 0);
  assert.equal(limiter.queue.length, 0);
});

test('fuzz: Pipeline не пускает в очередь больше queueCap', async () => {
  const rnd = prng(7);
  const c = clock();
  const core = fakeCore({
    'кино группа крови': { level: 'exact', track: track('Кино', 'Группа крови') }
  });
  const p = new Pipeline({
    access: preset('always'),
    triggers: ['!play'],
    approval: 'auto',
    queueCap: 5,
    limitsFromQueue: 0,
    onlyLive: true
  }, { core, now: c.now, rnd: seeded(7), say: async () => {} });
  p.setOnline(true);

  const outcomes = [];
  for (let i = 0; i < 100; i++) {
    const u = user('u' + (i % 17));
    const text = rnd() < 0.75 ? '!play кино группа крови' : '!play неизвестный трек';
    outcomes.push(await p.handle({ id: 'm' + i, at: c.now(), text, own: true, user: u }));
    c.add(1000);
  }

  assert.ok(core.added.length <= 5, `в очередь попало ${core.added.length} > 5`);
  assert.ok(outcomes.includes('queued'), 'должен быть хотя бы один принятый заказ');
  assert.ok(outcomes.includes('queueFull'), 'после заполнения должен быть queueFull');
  const ids = core.added.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'id заказов не должны дублироваться');
  assert.ok(core.added.every((o) => o.prov === 'twitch-cmd'));
});

test('fuzz: exact без track не создаёт заказ', async () => {
  const c = clock();
  const core = fakeCore({});
  core.findOrder = async () => ({ level: 'exact', track: null });
  const p = new Pipeline({ access: preset('always'), triggers: ['!play'], queueCap: 5, limitsFromQueue: 0 },
    { core, now: c.now, rnd: seeded(1), say: async () => {} });
  p.setOnline(true);
  const out = await p.handle({ id: 'm1', at: c.now(), text: '!play кино', own: true, user: user('u') });
  assert.equal(out, 'clarify');
  assert.equal(core.added.length, 0);
});

test('fuzz: случайные команды не роняют Pipeline', async () => {
  const rnd = prng(99);
  const c = clock();
  const core = fakeCore({});
  const p = new Pipeline({ access: preset('always'), triggers: ['!play'], queueCap: 3, limitsFromQueue: 0 },
    { core, now: c.now, rnd: seeded(99), say: async () => {} });
  p.setOnline(true);
  const alphabet = ['!play ', 'кино ', 'группа ', 'крови ', '— ', '-', '!!!', '🎵', ' ', '\n', 'https://youtu.be/x', '1', '#sim'];
  for (let i = 0; i < 500; i++) {
    let text = '';
    const n = 1 + Math.floor(rnd() * 12);
    for (let j = 0; j < n; j++) text += alphabet[Math.floor(rnd() * alphabet.length)];
    await p.handle({ id: 'm' + i, at: c.now(), text, own: true, user: user('u' + (i % 5)) });
    c.add(50);
  }
  assert.ok(Array.isArray(core.added));
});
