'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pipeline } = require('../src/logic/pipeline');
const { preset } = require('../src/logic/access');
const { track, fakeCore, clock, seeded, user } = require('./fakes');

const KINO = track('Кино', 'Группа крови');
const LYR = track('Сектор Газа', 'Лирика'), LYRC = track('Гаражный бэнд', 'Лирика (кавер)');
const CAT = {
  'кино группа крови': { level: 'exact', track: KINO },
  'лирика сектор': { level: 'doubt', track: LYR, alts: [LYRC] },
  'земфира искала': { level: 'exact', track: track('Земфира', 'Искала') },
  'сплин море': { level: 'exact', track: track('Сплин', 'Море') },
  'ария беспечный ангел': { level: 'exact', track: track('Ария', 'Беспечный ангел') },
  'upast': { level: 'exact', track: track('UPAST', 'UPAST') },
  'human': { level: 'doubt', track: track('Human', 'Human'), alts: [track('Human', 'Human (remix)')] },
  'human — song': { level: 'exact', track: track('Human', 'Song') }
};

function make(cfg = {}, coreOpts = {}) {
  const c = clock(); const said = []; const core = fakeCore(CAT, coreOpts);
  const p = new Pipeline({ access: preset('always'), triggers: ['!play', 'поставь'], ...cfg },
    { core, now: c.now, rnd: seeded(5), say: async (text, o) => { said.push({ text, replyTo: o.replyTo }); } });
  p.setOnline(true);
  let id = 0;
  const msg = (u, text, extra = {}) => p.handle({ id: 'm' + (++id), at: c.now(), text, user: u, own: true, ...extra });
  return { p, c, core, said, msg };
}

test('точно найдено — в очередь и ответ ответом на сообщение', async () => {
  const { core, said, msg } = make();
  assert.equal(await msg(user('vasya'), '!play кино группа крови'), 'queued');
  assert.equal(core.added[0].prov, 'twitch-cmd');
  assert.match(said[0].text, /@vasya поставил: Кино — Группа крови/);
  assert.equal(said[0].replyTo, 'm1');
});

test('сомнение — варианты; чужая «1» не считается, своя — да', async () => {
  const { core, said, msg } = make();
  assert.equal(await msg(user('petya'), '!play лирика сектор'), 'choose');
  assert.match(said[0].text, /1\) Сектор Газа — Лирика 2\) Гаражный бэнд — Лирика \(кавер\)/);
  assert.equal(await msg(user('troll'), '1'), 'ignore');
  assert.equal(await msg(user('petya'), '1'), 'queued');
  assert.equal(core.added[0].track.id, LYR.id);
});

test('вопрос сгорает через минуту', async () => {
  const { c, msg } = make();
  await msg(user('petya'), '!play лирика сектор');
  c.add(61000);
  assert.equal(await msg(user('petya'), '1'), 'ignore');
});

test('слово без «!»: не нашёл — молчит, нашёл — ставит', async () => {
  const { said, msg } = make();
  assert.equal(await msg(user('a'), 'поставь нормально уже'), 'notFound');
  assert.equal(said.length, 0);
  assert.equal(await msg(user('a'), 'поставь кино группа крови'), 'queued');
});

test('не нашёл — подсказка, как писать', async () => {
  const { said, msg } = make();
  await msg(user('nastya'), '!play ну ту песню с тиктока');
  assert.match(said[0].text, /исполнитель — название/);
});

test('одно слово с вариантами: просит уточнить, без команды', async () => {
  const { core, said, msg } = make();
  assert.equal(await msg(user('a'), '!play human'), 'clarify');
  assert.equal(core.added.length, 0);
  assert.match(said[0].text, /уточни: исполнитель — название/);
  assert.equal(await msg(user('a'), 'human — song'), 'queued');
  assert.equal(core.added.length, 1);
});

test('ручное одобрение без очереди занимает active и queueCap', async () => {
  const { core, msg } = make({ approval: 'manual', queueCap: 1, limitsFromQueue: 1 });
  assert.equal(await msg(user('a'), '!play кино группа крови'), 'queued');
  assert.equal(core.added[0].needsApproval, true, 'заказ ждёт одобрения и не встал в очередь');
  assert.equal(await msg(user('a'), '!play сплин море'), 'active');
  assert.equal(await msg(user('b'), '!play сплин море'), 'queueFull');
});
test('одно слово с единственным точным совпадением можно', async () => {
  const { core, msg } = make();
  assert.equal(await msg(user('a'), '!play upast'), 'queued');
  assert.equal(core.added.length, 1);
});

test('правила ядра: причина человеческим языком', async () => {
  const { said, msg } = make({}, { rules: () => ({ ok: false, reason: 'stopArtist' }) });
  assert.equal(await msg(user('a'), '!play кино группа крови'), 'rules');
  assert.match(said[0].text, /этого исполнителя здесь не ставят/);
});

test('офлайн и выключенный приём', async () => {
  const { p, msg } = make();
  p.setOnline(false);
  assert.equal(await msg(user('a'), '!play кино группа крови'), 'offline');
  p.setOnline(true); p.cfg.accepting = false;
  assert.equal(await msg(user('a'), '!play кино группа крови'), 'closed');
});

test('общий чат: чужие зрители по умолчанию не заказывают', async () => {
  const { msg } = make();
  assert.equal(await msg(user('a'), '!play кино группа крови', { own: false }), 'shared');
});

test('лимиты включаются только при длинной очереди', async () => {
  const { msg } = make({ limitsFromQueue: 2 });
  const a = user('a');
  assert.equal(await msg(a, '!play кино группа крови'), 'queued');
  assert.equal(await msg(a, '!play земфира искала'), 'queued');  // в очереди 1 < 2 — лимитов нет
  assert.equal(await msg(a, '!play сплин море'), 'active');      // 2 — лимиты включились
});

test('потолок очереди', async () => {
  const { msg } = make({ queueCap: 1, limitsFromQueue: 0, access: { ...preset('always'), viewer: { access: 'always', active: 5, pauseMin: 0 } } });
  await msg(user('a'), '!play кино группа крови');
  assert.equal(await msg(user('b'), '!play земфира искала'), 'queueFull');
});

test('⛔: трек убран, зритель в тайм-ауте, бот честно пишет сколько осталось', async () => {
  const { p, c, core, said, msg } = make();
  await msg(user('troll'), '!play кино группа крови');
  assert.equal(p.orderBan(core.added[0].id, 10), true);
  c.add(2 * 60000);
  assert.equal(await msg(user('troll'), '!play земфира искала'), 'timeout');
  assert.match(said.at(-1).text, /ещё на 8 мин/);
});

test('⛔ у своего заказа: трек убран, тайм-аута стримеру нет', async () => {
  const { p, c, core, msg } = make();
  const me = user('alex', { isBroadcaster: true });
  assert.equal(await msg(me, '!play кино группа крови'), 'queued');
  const key = core.added[0].id, uid = p.orders.get(key);
  assert.equal(p.orderBan(key, 10, { isBroadcaster: true }), false);
  assert.equal(p.tracker.timeoutLeftMin(uid, c.now()), 0); // тайм-аут не поставлен
  assert.equal(p.orders.has(key), false);                  // но заказ снят с учёта
  c.add(2 * 60000);
  assert.equal(await msg(me, '!play земфира искала'), 'queued'); // стример заказывает дальше
});

test('заблокированный — молча', async () => {
  const { p, said, msg } = make();
  p.tracker.block('u-spam', 'spam');
  assert.equal(await msg(user('spam'), '!play кино группа крови'), 'blocked');
  assert.equal(said.length, 0);
});

test('через подтверждение — «ждёт стримера»', async () => {
  const { core, said, msg } = make({ approval: 'manual' });
  await msg(user('a'), '!play кино группа крови');
  assert.equal(core.added[0].needsApproval, true);
  assert.match(said[0].text, /ждёт стримера/);
});

test('по событию: вне события — подсказка, когда следующее', async () => {
  const { said, msg } = make({ access: preset('event'), event: { when: 'timer', everyMin: 20 } });
  assert.equal(await msg(user('a'), '!play кино группа крови'), 'outsideEvent');
  assert.match(said[0].text, /примерно через 20 мин/);
});

test('событие-розыгрыш целиком: заявки, неудача с исправлением, итог, в очередь', async () => {
  const { p, c, core, said, msg } = make({ access: preset('event'), event: { when: 'manual', method: 'raffle', winners: 2, durationSec: 60 } });
  await p.openEvent();
  assert.match(said.at(-1).text, /Событие заказов! 60 секунд/);
  assert.equal(await msg(user('a'), '!play кино группа крови'), 'event-ok');
  assert.equal(await msg(user('b'), '!play та песня про море'), 'event-fail');
  assert.match(said.at(-1).text, /успеешь до конца события/);
  assert.equal(await msg(user('b'), '!play сплин море'), 'event-ok');
  assert.equal(await msg(user('a'), '!play земфира искала'), 'event-already'); // принятую не заменить — молча
  assert.equal(core.added.length, 0);                                           // до итога в очередь ничего
  c.add(61000);
  assert.equal(await p.tick(), 'finished');
  assert.equal(core.added.length, 2);
  assert.match(said.at(-1).text, /Событие закрыто — 2 заявок\. Победили: @/);
});

test('в событии по названию ищем только по официальным каталогам', async () => {
  const { p, core, msg } = make({ access: preset('event'), event: { when: 'manual' } });
  await p.openEvent();
  await msg(user('a'), '!play кино группа крови');
  assert.equal(core.calls[0].o.catalogsOnly, true);
});

test('не выигрывать два события подряд', async () => {
  const { p, c, msg } = make({ access: preset('event'), event: { when: 'manual', winners: 1 } });
  await p.openEvent(); await msg(user('a'), '!play кино группа крови'); c.add(61000); await p.tick();
  await p.openEvent();
  assert.equal(await msg(user('a'), '!play земфира искала'), 'repeatWin');
});

test('кто первый: закрывается досрочно, когда набралось', async () => {
  const { p, core, said, msg } = make({ access: preset('event'), event: { when: 'manual', method: 'first', firstN: 2 } });
  await p.openEvent();
  await msg(user('a'), '!play кино группа крови');
  await msg(user('b'), '!play земфира искала');
  assert.equal(p.round.state, 'done');
  assert.equal(core.added.length, 2);
  assert.match(said.at(-1).text, /Победили: @a — Кино — Группа крови, @b — Земфира — Искала/);
});

test('VIP заказывает и во время события обычным путём', async () => {
  const tbl = preset('event'); tbl.vip.access = 'always';
  const { p, core, msg } = make({ access: tbl, event: { when: 'manual' } });
  await p.openEvent();
  assert.equal(await msg(user('olga', { isVip: true }), '!play кино группа крови'), 'queued');
  assert.equal(core.added.length, 1);
});

test('cancelByUser убирает только заказ этого зрителя', async () => {
  const { p, core, msg } = make();
  await msg(user('a'), '!play кино группа крови');
  const id = core.added[0].id;
  assert.equal(p.cancelByUser('u-b'), null);
  assert.equal(p.cancelByUser('u-a'), id);
  assert.equal(core.added.length, 0);
});