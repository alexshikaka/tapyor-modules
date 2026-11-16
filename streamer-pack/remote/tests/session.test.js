'use strict';
// Сессия пульта на поддельном ядре и облачной функции в памяти (без сети).
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const C = require('../src/crypto');
const { createRelay } = require('../src/relay');
const { RemoteSession, MISSING_BRIDGE, ENDED, NETWORK } = require('../src/session');
const { activate, deactivate } = require('../src/index');

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Поддельная функция tapyor-remote: ящики сессий, номера версий и очереди команд.
function memoryFunction(clock) {
  const sessions = new Map();
  const fn = {
    sessions,
    async fetch(url, opts = {}) {
      const u = new URL(String(url));
      const op = u.searchParams.get('op');
      let body = {};
      if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { body = {}; } }
      if (op === 'new') {
        const sid = C.b64u(nodeCrypto.randomBytes(16));
        const host = C.b64u(nodeCrypto.randomBytes(32));
        sessions.set(sid, { sid, host, s: null, f: null, sv: 0, fv: 0, cmds: [], events: [], phoneAt: null, seq: 0 });
        return reply(200, { sid, host, ttl: 43200 });
      }
      const sid = body.sid || u.searchParams.get('sid');
      const s = sessions.get(sid);
      if (!s) return reply(404, { error: 'no-session' });
      if (op === 'host') {
        if (body.host !== s.host) return reply(403, { error: 'bad-host' });
        if (body.s) { s.s = body.s; s.sv++; }
        if (body.f) { s.f = body.f; s.fv++; }
        if (Array.isArray(body.ev)) s.events = s.events.concat(body.ev);
        if (body.ack) s.cmds = s.cmds.filter((c) => c.seq > body.ack);
        const phoneAgo = s.phoneAt == null ? null : Math.max(0, clock.now - s.phoneAt);
        return reply(200, { cmds: s.cmds.slice(), phoneAgo, hostAgo: 0 });
      }
      if (op === 'cmd') {
        if (typeof body.c !== 'string' || !body.c) return reply(400, { error: 'bad-command' });
        s.cmds.push({ seq: ++s.seq, c: body.c });
        s.phoneAt = clock.now;
        return reply(200, { ok: true });
      }
      if (op === 'end') {
        sessions.delete(sid);
        return reply(200, { ok: true });
      }
      if (op === 'poll') {
        return reply(200, { sv: s.sv, fv: s.fv, ev: [], hostAgo: 0 });
      }
      return reply(404, { error: 'no-op' });
    }
  };
  return fn;
}

function scheduler() {
  const items = [];
  return {
    items,
    schedule(fn, ms) {
      const item = { fn, ms, cancelled: false };
      items.push(item);
      return () => { item.cancelled = true; };
    },
    last() {
      for (let i = items.length - 1; i >= 0; i--) if (!items[i].cancelled) return items[i];
      return null;
    }
  };
}

function fakeCore() {
  const core = {
    logs: [],
    dockWants: [],
    feedWants: [],
    dockCalls: [],
    rqCalls: [],
    settingCalls: [],
    remote: {
      qr: () => '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
      dock: {
        on(fn) { core.dockFn = fn; return () => { core.dockFn = null; }; },
        want(v) { core.dockWants.push(v); },
        cmd(obj) { core.dockCalls.push(obj); return { ok: true }; },
        get() { return null; }
      },
      feed: {
        on(fn) { core.feedFn = fn; return () => { core.feedFn = null; }; },
        want(v) { core.feedWants.push(v); },
        rq(dataset) { core.rqCalls.push(dataset); },
        setting(key, value) { core.settingCalls.push([key, value]); }
      }
    },
    log(line) { core.logs.push(line); }
  };
  return core;
}

function snapshot(at) {
  return {
    v: 1,
    at,
    mode: 'live',
    cur: 1,
    np: { title: 'Хочешь?', artist: 'Земфира', playing: true, pos: 12, dur: 220 },
    items: [
      { i: 0, key: 'ym:1', title: 'Нервы', artist: 'Нервы', src: 'ym', srcName: 'Яндекс', dur: '3:00', thumb: 'https://img/a.jpg', st: 'done', bg: false, req: null, ban: false, canNext: false, book: null },
      { i: 1, key: 'ym:2', title: 'Хочешь?', artist: 'Земфира', src: 'ym', srcName: 'Яндекс', dur: '3:40', thumb: '/lcover/x', st: 'playing', bg: false, req: null, ban: false, canNext: false, book: null }
    ],
    after: [],
    wave: { title: 'Волна', sub: 'заказы', auto: true },
    counts: { pending: 2, played: 1 },
    opts: { ban: false, banMin: 10 },
    look: { cls: 'theme-dark', style: '', scale: 100 },
    theme: { vars: { '--bg0': '#222222', '--ac': '#D17834' }, light: false }
  };
}

function feed() {
  return {
    feedHtml: '<div class="rq dock-card" data-kind="don"><div class="rq-h"><b>Ник</b></div><button data-rq="add" data-id="0:0">＋</button></div>',
    msgCount: 1,
    reqAuto: false,
    np: { title: 'Хочешь?', artist: 'Земфира', playing: true, pos: 12, dur: 220 }
  };
}

function setup(extra = {}) {
  const clock = { now: 1763300000000 };
  const fn = memoryFunction(clock);
  const core = fakeCore();
  const schedule = scheduler();
  const relay = createRelay({ url: 'https://relay.test', fetch: extra.fetch || fn.fetch });
  const session = new RemoteSession(core, {
    relay,
    page: 'https://site.test/remote/',
    now: () => clock.now,
    schedule: schedule.schedule,
    ...(extra.deps || {})
  });
  return { clock, fn, core, schedule, session };
}

async function sendPhone(session, obj, override) {
  const body = Object.assign({
    n: C.b64u(nodeCrypto.randomBytes(8)),
    t: Math.round(session.now())
  }, obj, override || {});
  const piece = C.seal(session.key, session.sid, 'c', body);
  const r = await session.relay.call('cmd', { body: { sid: session.sid, c: piece } });
  assert.equal(r.ok, true, 'команда телефона должна лечь в ящик');
}

async function withData(h) {
  const st = await h.session.start();
  h.core.dockFn(snapshot(h.clock.now));
  h.core.feedFn(feed());
  await h.session.pollOnce();
  return st;
}

test('SESSION: start выдаёт адрес с ключом, QR и просит ядро не собирать лишнее', async () => {
  const h = setup();
  const st = await h.session.start();
  assert.equal(st.state, 'waiting');
  assert.match(st.url, /^https:\/\/site\.test\/remote\/#[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.match(st.qrSvg, /^<svg/);
  assert.equal(st.phoneAgo, null);
  assert.equal(st.error, null);
  assert.deepEqual(h.core.dockWants, [false]);
  assert.deepEqual(h.core.feedWants, [false]);
  assert.ok(h.core.logs.includes('пульт: запуск'));
  assert.ok(h.core.logs.includes('пульт: ждём телефон'));
  const keyInUrl = st.url.slice(st.url.indexOf('#') + 1).split('.')[1];
  assert.ok(!h.core.logs.some((l) => l.includes(h.session.sid) || l.includes(keyInUrl)), 'ключ и sid не должны попадать в лог');
});

test('SESSION: снимок без look и ленты уходят один раз, при изменении — снова', async () => {
  const h = setup();
  await withData(h);
  const box = h.fn.sessions.get(h.session.sid);
  assert.ok(box.s, 'снимок должен уйти в облако');
  assert.ok(box.f, 'лента должна уйти в облако');
  const snap = C.open(h.session.key, h.session.sid, 's', box.s);
  assert.equal(snap.look, undefined);
  assert.equal(snap.items[0].thumb, 'https://img/a.jpg');
  assert.equal(snap.items[1].thumb, '');
  assert.equal(snap.theme.vars['--ac'], '#D17834');
  const feedOut = C.open(h.session.key, h.session.sid, 'f', box.f);
  assert.equal(feedOut.msgCount, 1);
  assert.ok(feedOut.feedHtml.includes('data-rq'));

  await h.session.pollOnce();
  assert.equal(box.sv, 1, 'без изменений снимок повторно не шлётся');
  assert.equal(box.fv, 1);

  h.core.dockFn(snapshot(h.clock.now + 1000));
  h.core.dockFn(Object.assign(snapshot(h.clock.now + 2000), { mode: 'classic' }));
  await h.session.pollOnce();
  assert.equal(box.sv, 2, 'изменившийся снимок уходит');
});

test('SESSION: команда телефона доходит до core.remote.dock.cmd, ack удаляет её', async () => {
  const h = setup();
  await withData(h);
  await sendPhone(h.session, { c: 'remove', i: 0, key: 'ym:1' });
  await h.session.pollOnce();
  assert.deepEqual(h.core.dockCalls, [{ c: 'remove', i: 0, key: 'ym:1' }]);
  const st = h.session.status();
  assert.equal(st.state, 'connected');
  assert.equal(st.phoneAgo, 0);
  assert.equal(h.core.dockWants.slice(-1)[0], true);
  assert.equal(h.core.feedWants.slice(-1)[0], true);

  await h.session.pollOnce();
  assert.equal(h.fn.sessions.get(h.session.sid).cmds.length, 0, 'принятая команда удалена по ack');
});

test('SESSION: повтор n, старое t, будущее t и чужая команда отброшены', async () => {
  const h = setup();
  await withData(h);
  const nonce = C.b64u(nodeCrypto.randomBytes(8));
  await sendPhone(h.session, { c: 'remove', i: 0, key: 'ym:1' }, { n: nonce });
  await h.session.pollOnce();
  assert.equal(h.core.dockCalls.length, 1);

  // тот же n, другая команда
  await sendPhone(h.session, { c: 'remove', i: 1, key: 'ym:2' }, { n: nonce });
  await h.session.pollOnce();
  assert.equal(h.core.dockCalls.length, 1, 'повтор n не выполняется');

  await sendPhone(h.session, { c: 'remove', i: 0, key: 'ym:1' }, { t: h.clock.now - 121000 });
  await h.session.pollOnce();
  assert.equal(h.core.dockCalls.length, 1, 'старая команда не выполняется');

  await sendPhone(h.session, { c: 'remove', i: 0, key: 'ym:1' }, { t: h.clock.now + 61000 });
  await h.session.pollOnce();
  assert.equal(h.core.dockCalls.length, 1, 'команда из будущего не выполняется');

  await sendPhone(h.session, { c: 'evil', i: 0, key: 'ym:1' });
  await h.session.pollOnce();
  assert.equal(h.core.dockCalls.length, 1, 'команда не из белого списка не выполняется');

  await sendPhone(h.session, { c: 'play', i: '0', key: 'ym:1' });
  await h.session.pollOnce();
  assert.equal(h.core.dockCalls.length, 1, 'неверные типы не выполняются');
});

test('SESSION: rq и настройка ленты — только разрешённые поля', async () => {
  const h = setup();
  await withData(h);

  await sendPhone(h.session, { c: 'rq', dataset: { rq: 'add', ri: '0', id: '0:0', act: 'x', ix: '1', evil: 'да' } });
  await h.session.pollOnce();
  assert.deepEqual(h.core.rqCalls, [{ rq: 'add', ri: '0', id: '0:0', act: 'x', ix: '1' }]);

  await sendPhone(h.session, { c: 'rq', dataset: { rq: 'add', id: 'x'.repeat(81) } });
  await h.session.pollOnce();
  assert.equal(h.core.rqCalls.length, 1, 'длинное значение не проходит');

  await sendPhone(h.session, { c: 'rq', dataset: { rq: 'add', id: 5 } });
  await h.session.pollOnce();
  assert.equal(h.core.rqCalls.length, 1, 'не строка не проходит');

  await sendPhone(h.session, { c: 'setting', key: 'reqAuto', value: true });
  await h.session.pollOnce();
  assert.deepEqual(h.core.settingCalls, [['reqAuto', true]]);

  await sendPhone(h.session, { c: 'setting', key: 'evil', value: true });
  await sendPhone(h.session, { c: 'setting', key: 'reqAuto', value: 'да' });
  await h.session.pollOnce();
  assert.equal(h.core.settingCalls.length, 1, 'другие настройки и не-bool не проходят');
});

test('SESSION: want включается с телефоном и выключается через 60 секунд', async () => {
  const h = setup();
  await withData(h);
  await sendPhone(h.session, { c: 'remove', i: 0, key: 'ym:1' });
  await h.session.pollOnce();
  assert.equal(h.session.status().phoneAgo, 0);
  assert.equal(h.core.dockWants.slice(-1)[0], true);
  assert.equal(h.core.feedWants.slice(-1)[0], true);

  h.clock.now += 61000;
  await h.session.pollOnce();
  assert.equal(h.session.status().phoneAgo, 61000);
  assert.equal(h.core.dockWants.slice(-1)[0], false);
  assert.equal(h.core.feedWants.slice(-1)[0], false);
  assert.equal(h.session.status().state, 'connected', 'телефон всё ещё подключён, просто давно молчит');
});

test('SESSION: после команды облако опрашивается раз в 0,4 с, через 20 с — раз в 1 с', async () => {
  const h = setup();
  await withData(h);
  h.clock.now += 5000;
  await sendPhone(h.session, { c: 'remove', i: 0, key: 'ym:1' });
  await h.session.pollOnce();
  assert.equal(h.session.delay(), 400, 'команда только что пришла');
  h.clock.now += 19999;
  assert.equal(h.session.delay(), 400);
  h.clock.now += 1;
  assert.equal(h.session.delay(), 1000, '20 с после команды прошли');
  h.session.lan = true;
  assert.equal(h.session.delay(), 120, 'Wi-Fi: ящик в самом Тапёре — почти без паузы');
});

test('SESSION: 404 no-session → idle и понятная ошибка', async () => {
  const h = setup();
  await withData(h);
  await sendPhone(h.session, { c: 'remove', i: 0, key: 'ym:1' });
  await h.session.pollOnce();
  assert.equal(h.session.status().state, 'connected');

  h.fn.sessions.clear();
  await h.session.pollOnce();
  const st = h.session.status();
  assert.equal(st.state, 'idle');
  assert.equal(st.error, ENDED);
  assert.equal(st.url, '');
  assert.equal(h.core.dockWants.slice(-1)[0], false);
});

test('SESSION: stop удаляет сессию, renew создаёт новую', async () => {
  const h = setup();
  const first = await h.session.start();
  const sid1 = h.session.sid;
  assert.ok(h.fn.sessions.has(sid1));
  const stopped = await h.session.stop();
  assert.equal(stopped.state, 'idle');
  assert.equal(stopped.url, '');
  assert.equal(stopped.error, null);
  assert.equal(h.fn.sessions.size, 0);

  const second = await h.session.start();
  assert.notEqual(h.session.sid, sid1);
  assert.notEqual(second.url, first.url);
  await h.session.stop();
});

test('SESSION: сеть пропала — lost и повтор 2→30 с, потом снова ждём телефон', async () => {
  const clock = { now: 1763300000000 };
  const fn = memoryFunction(clock);
  let fails = 2;
  const fetchImpl = async (url, opts) => {
    const op = new URL(String(url)).searchParams.get('op');
    if (op === 'host' && fails > 0) { fails--; throw new Error('сеть легла'); }
    return fn.fetch(url, opts);
  };
  const core = fakeCore();
  const schedule = scheduler();
  const relay = createRelay({ url: 'https://relay.test', fetch: fetchImpl });
  const session = new RemoteSession(core, {
    relay,
    page: 'https://site.test/remote/',
    now: () => clock.now,
    schedule: schedule.schedule
  });

  const st = await session.start();
  assert.equal(st.state, 'lost');
  assert.equal(st.error, NETWORK);
  assert.equal(schedule.last().ms, 2000);

  await session.pollOnce();
  assert.equal(session.status().state, 'lost');
  assert.equal(schedule.last().ms, 4000, 'пауза растёт');

  await session.pollOnce();
  assert.equal(session.status().state, 'waiting');
  assert.equal(session.status().error, null);
  assert.equal(schedule.last().ms, 10000, 'после успеха — опрос без телефона раз в 10 с');

  assert.equal(core.logs.filter((l) => l === 'пульт: нет связи с облаком').length, 1, 'лог только при смене состояния');
});

test('SESSION: нет core.remote — не падаем, статус с понятной ошибкой', async () => {
  const mod = await activate({ log() {} });
  const st = mod.status();
  assert.equal(st.state, 'error');
  assert.equal(st.error, MISSING_BRIDGE);
  const st2 = await mod.start();
  assert.equal(st2.state, 'error');
  assert.equal(st2.error, MISSING_BRIDGE);
  assert.equal(st2.url, '');
  await deactivate();
});

test('SESSION: поддельный relay может отвечать телом сразу, без обёртки ok/data', async () => {
  const core = fakeCore();
  const sid = 'S'.repeat(22);
  const host = 'H'.repeat(43);
  const relay = {
    configured: true,
    new: async () => ({ sid, host, ttl: 43200 }),
    host: async () => ({ cmds: [], phoneAgo: 0 }),
    end: async () => ({ ok: true })
  };
  const session = new RemoteSession(core, {
    relay,
    page: 'https://site.test/remote/',
    now: () => 1763300000000,
    schedule: scheduler().schedule
  });
  const st = await session.start();
  assert.equal(st.state, 'connected');
  assert.equal(st.phoneAgo, 0);
  assert.match(st.url, /#S{22}\./);
  await session.stop();
});

test('SESSION: нет адреса облака — понятная ошибка запуска', async () => {
  const core = fakeCore();
  const session = new RemoteSession(core, {
    relay: createRelay({ url: '', fetch: () => { throw new Error('сеть не должна зваться'); } }),
    page: 'https://site.test/remote/',
    now: () => 1763300000000,
    schedule: scheduler().schedule
  });
  const st = await session.start();
  assert.equal(st.state, 'error');
  assert.equal(st.error, 'облако пульта не настроено');
});
