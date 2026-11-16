'use strict';
// Переход на запасное облако: молчание > 30 с, новая сессия на следующем облаке,
// номер облака в адресе телефона.
const test = require('node:test');
const assert = require('node:assert/strict');
const { RemoteSession, phoneUrl, FALLBACK, CLOUD_SILENT } = require('../src/session');

function fakeCore() {
  const core = {
    logs: [],
    remote: {
      qr: () => '<svg viewBox="0 0 1 1"></svg>',
      dock: {
        on(fn) { core.dockFn = fn; return () => { core.dockFn = null; }; },
        want() {},
        cmd() { return { ok: true }; },
        get() { return null; }
      },
      feed: {
        on(fn) { core.feedFn = fn; return () => { core.feedFn = null; }; },
        want() {},
        rq() {},
        setting() {}
      }
    },
    log(line) { core.logs.push(line); }
  };
  return core;
}

// Два облака: index 0 — «A», index 1 — «B». failIndex — облако, которое сейчас молчит.
function fakeClouds(clock) {
  const state = {
    index: 0,
    calls: [],
    ended: [],
    sids: [],
    failIndex: -1,
    phoneAgo: null
  };
  const relay = {
    configured: true,
    count: 2,
    get index() { return state.index; },
    async new(opts) {
      const start = opts && Number.isSafeInteger(opts.start) ? opts.start : 0;
      state.calls.push(start);
      state.index = start;
      const letter = start === 0 ? 'A' : 'B';
      const sid = letter.repeat(22);
      const host = letter.repeat(43);
      state.sids.push(sid);
      return { ok: true, data: { sid, host, ttl: 43200 } };
    },
    async host() {
      if (state.failIndex === state.index) throw new Error('облако молчит');
      return { ok: true, data: { cmds: [], phoneAgo: state.phoneAgo } };
    },
    async end(body) { state.ended.push(body); return { ok: true }; }
  };
  return { relay, state };
}

function setup() {
  const clock = { now: 1763300000000 };
  const core = fakeCore();
  const fake = fakeClouds(clock);
  const session = new RemoteSession(core, {
    relay: fake.relay,
    page: 'https://site.test/remote/',
    now: () => clock.now,
    schedule: () => () => {}
  });
  return { clock, core, state: fake.state, relay: fake.relay, session };
}

test('ОБЛАКО: номер 0 не пишется в адресе, номер 2 — пишется', () => {
  assert.equal(phoneUrl('https://site/x/', 'S', 'K', 0), 'https://site/x/#S.K');
  assert.equal(phoneUrl('https://site/x/', 'S', 'K'), 'https://site/x/#S.K');
  assert.equal(phoneUrl('https://site/x/', 'S', 'K', 2), 'https://site/x/#S.K.2');
  assert.equal(phoneUrl('https://site/x/', 'S', 'K', -1), 'https://site/x/#S.K', 'мусор — без номера');
  assert.equal(phoneUrl('https://site/x/', 'S', 'K', 1.5), 'https://site/x/#S.K', 'дробь — без номера');
});

test('ОБЛАКО: сессия на первом открывается без номера, статус показывает облако', async () => {
  const h = setup();
  const st = await h.session.start();
  assert.match(st.url, /#A{22}\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(st.cloud, { index: 0, count: 2 });
  assert.equal(st.notice, null);
  await h.session.stop();
});

test('ОБЛАКО: молчит 30 с — новая сессия на следующем и просьба отсканировать', async () => {
  const h = setup();
  await h.session.start();
  const oldSid = h.session.sid;
  assert.match(h.session.url, /#A{22}\./);

  h.state.failIndex = 0;                   // первое облако «пропало»
  h.clock.now += CLOUD_SILENT + 1000;
  await h.session.pollOnce();

  assert.deepEqual(h.state.calls, [0, 1], 'новая сессия — на следующем облаке');
  assert.equal(h.state.ended.length, 1, 'старая сессия закрыта');
  assert.equal(h.state.ended[0].sid, oldSid);
  assert.notEqual(h.session.sid, oldSid);
  const st = h.session.status();
  assert.equal(st.state, 'waiting');
  assert.equal(st.notice, FALLBACK);
  assert.match(st.url, /#B{22}\.[A-Za-z0-9_-]{43}\.1$/, 'номер облака в адресе');
  assert.deepEqual(st.cloud, { index: 1, count: 2 });
  assert.ok(!h.core.logs.some((l) => l.includes(oldSid) || l.includes(h.session.sid)), 'в лог не попадают sid');
  assert.ok(h.core.logs.includes('пульт: перехожу на запасное облако'));
});

test('ОБЛАКО: телефон пришёл на новое облако — просьба сканировать снимается', async () => {
  const h = setup();
  await h.session.start();
  h.state.failIndex = 0;
  h.clock.now += CLOUD_SILENT + 1000;
  await h.session.pollOnce();
  assert.equal(h.session.status().notice, FALLBACK);
  assert.equal(h.session.status().state, 'waiting');

  h.state.phoneAgo = 0;                    // телефон отсканировал новый QR
  await h.session.pollOnce();
  const st = h.session.status();
  assert.equal(st.notice, null);
  assert.equal(st.state, 'connected');
  assert.equal(st.phoneAgo, 0);
});

test('ОБЛАКО: выключение во время перехода не открывает новую сессию', async () => {
  const h = setup();
  await h.session.start();
  h.state.failIndex = 0;
  h.clock.now += CLOUD_SILENT + 1000;

  let first = true;
  h.relay.end = async (body) => {
    h.state.ended.push(body);
    if (first) {
      first = false;
      await h.session.stop();     // стример выключил пульт, пока закрывалась старая сессия
    }
    return { ok: true };
  };
  await h.session.pollOnce();

  const st = h.session.status();
  assert.equal(st.state, 'idle');
  assert.equal(st.url, '');
  assert.deepEqual(h.state.calls, [0], 'новую сессию не открываем');
});

test('ОБЛАКО: одно облако — перехода нет, остаётся «нет связи»', async () => {
  const clock = { now: 1763300000000 };
  const core = fakeCore();
  let news = 0;
  const relay = {
    configured: true,
    count: 1,
    async new() {
      news++;
      return { ok: true, data: { sid: 'A'.repeat(22), host: 'A'.repeat(43) } };
    },
    async host() { throw new Error('нет сети'); },
    async end() { return { ok: true }; }
  };
  const session = new RemoteSession(core, {
    relay,
    page: 'https://site.test/remote/',
    now: () => clock.now,
    schedule: () => () => {}
  });
  await session.start();                   // опрос уже упал, но облако одно
  const st = session.status();
  assert.equal(st.state, 'lost');
  assert.equal(st.notice, null);
  assert.equal(news, 1, 'новую сессию не создаём');
});
