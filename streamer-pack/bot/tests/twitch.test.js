'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { startDevice, Identity } = require('../src/twitch/auth');
const { EventSub } = require('../src/twitch/eventsub');
const { Bot } = require('../src/bot');
const { fakeCore, track } = require('./fakes');

// fetch по таблице: [метод путь] → (запрос) => { status, json }
function router(routes, log = []) {
  return async (url, opt = {}) => {
    const u = new URL(url); const key = (opt.method || 'GET') + ' ' + u.pathname;
    const body = opt.body ? (opt.headers && opt.headers['Content-Type'] === 'application/json' ? JSON.parse(opt.body) : Object.fromEntries(new URLSearchParams(opt.body))) : null;
    log.push({ key, query: Object.fromEntries(u.searchParams), body, auth: opt.headers && opt.headers.Authorization });
    const h = routes[key];
    if (!h) return { ok: false, status: 404, json: async () => ({ message: 'нет ' + key }) };
    const r = await h({ query: Object.fromEntries(u.searchParams), body });
    const status = r.status || 200;
    return { ok: status < 300, status, json: async () => r.json };
  };
}

test('вход по коду: ждёт подтверждения, токены не теряются', async () => {
  let polls = 0;
  const fetch = router({
    'POST /oauth2/device': () => ({ json: { device_code: 'dc', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD', expires_in: 1800, interval: 5 } }),
    'POST /oauth2/token': () => (++polls < 3 ? { status: 400, json: { message: 'authorization_pending' } } : { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 14000, scope: ['user:read:chat'] } })
  });
  const f = await startDevice({ scopes: ['user:read:chat'], fetch, sleep: async () => {}, now: () => 0 });
  assert.equal(f.userCode, 'ABCD-EFGH');
  const t = await f.wait();
  assert.equal(t.access, 'AT'); assert.equal(t.refresh, 'RT'); assert.equal(polls, 3);
});

test('вход сам обновляется, когда истекает; новый refresh сохраняется', async () => {
  const store = new Map(); const secure = { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) };
  const fetch = router({ 'POST /oauth2/token': ({ body }) => ({ json: { access_token: 'AT2', refresh_token: 'RT2-' + body.refresh_token, expires_in: 14000 } }) });
  let t = 1000;
  const id = new Identity('bot', { secure, fetch, now: () => t });
  id.tokens = { access: 'AT1', refresh: 'RT1', expiresAt: 1000 + 30000 }; id.user = { id: '1', login: 'b' };
  assert.equal(await id.token(), 'AT2');
  assert.match(store.get('twitch.bot'), /RT2-RT1/);
  assert.doesNotMatch(JSON.stringify(store.get('twitch.bot')), /AT1/);
});

class FakeWS {
  constructor(url) { this.url = url; this.closed = false; FakeWS.all.push(this); }
  close() { this.closed = true; }
  recv(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
}
FakeWS.all = [];
const welcome = (id) => ({ metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: 10 } } });
const note = (mid, type, event) => ({ metadata: { message_type: 'notification', message_id: mid, subscription_type: type }, payload: { event } });

test('EventSub: подписки после приветствия, повторы отбрасываются, переезд без новых подписок', async () => {
  FakeWS.all = [];
  const subs = []; const timers = [];
  const es = new EventSub({ subscribe: async (sid) => subs.push(sid), WebSocket: FakeWS, url: 'wss://x', setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  const events = []; es.on('event', (t, e) => events.push([t, e.n]));
  es.start();
  await FakeWS.all[0].onmessage({ data: JSON.stringify(welcome('s1')) });
  assert.deepEqual(subs, ['s1']); assert.equal(es.state, 'up');
  await FakeWS.all[0].onmessage({ data: JSON.stringify(note('n1', 'channel.chat.message', { n: 1 })) });
  await FakeWS.all[0].onmessage({ data: JSON.stringify(note('n1', 'channel.chat.message', { n: 1 })) });
  assert.equal(events.length, 1);
  await FakeWS.all[0].onmessage({ data: JSON.stringify({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://y' } } }) });
  assert.equal(FakeWS.all[1].url, 'wss://y');
  await FakeWS.all[1].onmessage({ data: JSON.stringify(welcome('s2')) });
  assert.equal(FakeWS.all[0].closed, true);
  assert.deepEqual(subs, ['s1']); // подписки переехали сами
});

test('EventSub: обрыв — переподключение с паузой', async () => {
  FakeWS.all = [];
  const timers = [];
  const es = new EventSub({ subscribe: async () => {}, WebSocket: FakeWS, url: 'wss://x', setTimer: (fn, ms) => { timers.push({ fn, ms }); return 0; }, clearTimer: () => {} });
  es.start();
  FakeWS.all[0].onclose();
  assert.equal(es.state, 'down');
  const re = timers.find((t) => t.ms === 1000);
  assert.ok(re); re.fn();
  assert.equal(FakeWS.all.length, 2);
});

// ---------- бот целиком: поддельный Twitch и поддельное ядро ----------
function botCore() {
  const core = fakeCore({ 'кино группа крови': { level: 'exact', track: track('Кино', 'Группа крови') } });
  const em = new EventEmitter(); const settings = new Map(); const store = new Map(); const health = {};
  Object.assign(core, {
    on: (e, f) => em.on(e, f), emit: (...a) => em.emit(...a), log: () => {}, openExternal: () => {},
    settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    secure: { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) },
    health: { set: (id, st, text) => { health[id] = { st, text }; } }, _health: health, _store: store, _settings: settings
  });
  return core;
}

test('бот: команда в чате → поиск ядром → ответ ответом на сообщение', async () => {
  const core = botCore();
  core._settings.set('bot', { identity: 'self', access: { viewer: { access: 'always', active: 1, pauseMin: 0 }, follower: { access: 'always', active: 1, pauseMin: 0 }, sub: { access: 'always' }, vip: { access: 'always' }, mod: { access: 'always', unlimited: true } } });
  core._store.set('twitch.broadcaster', JSON.stringify({ tokens: { access: 'AT', refresh: 'RT', expiresAt: 9e15 }, user: { id: '100', login: 'alexshikaka' } }));
  const log = [];
  const fetch = router({
    'GET /helix/streams': () => ({ json: { data: [{ id: 's' }] } }),
    'POST /helix/eventsub/subscriptions': () => ({ status: 202, json: { data: [{}] } }),
    'GET /helix/channel_points/custom_rewards': () => ({ json: { data: [] } }),
    'POST /helix/channel_points/custom_rewards': () => ({ json: { data: [{ id: 'rw1' }] } }),
    'PATCH /helix/channel_points/custom_rewards': () => ({ status: 204 }),
    'POST /helix/chat/messages': () => ({ json: { data: [{ is_sent: true }] } })
  }, log);
  let es;
  const makeEventSub = (o) => { es = new EventEmitter(); es.start = async () => { await o.subscribe('sess'); es.emit('state', 'up'); }; es.stop = () => {}; return es; };
  const bot = new Bot(core, { fetch, makeEventSub, sleep: async () => {}, setInterval: () => 0, clearInterval: () => {} });
  await bot.start();
  await new Promise((r) => setImmediate(r));
  const subTypes = log.filter((x) => x.key === 'POST /helix/eventsub/subscriptions').map((x) => x.body.type);
  assert.deepEqual(subTypes, ['channel.chat.message', 'stream.online', 'stream.offline', 'channel.channel_points_custom_reward_redemption.add']);
  assert.equal(core._health['bot.chat'].st, 'ok');
  assert.equal(bot.settings().rewardId, 'rw1');

  es.emit('event', 'channel.chat.message', { message_id: 'mm1', chatter_user_id: '7', chatter_user_login: 'vasya', badges: [], message: { text: '!play кино группа крови' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(core.added.length, 1);
  const sent = log.filter((x) => x.key === 'POST /helix/chat/messages');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.reply_parent_message_id, 'mm1');
  assert.match(sent[0].body.message, /@vasya поставил: Кино — Группа крови/);
  assert.ok(!JSON.stringify(bot.journal).includes('AT'), 'токен не попал в журнал');
});

test('бот: сохранение события обновляет планировщик', async () => {
  const bot = new Bot(botCore(), { fetch: async () => ({ ok: true, json: async () => ({}) }), setInterval: () => 0, clearInterval: () => {} });
  bot.pipeline = { cfg: {}, scheduler: { cfg: {}, planned: 0, plan() { this.planned++; } } };
  await bot.saveSettings({ event: { when: 'manual', durationSec: 90 } });
  assert.equal(bot.pipeline.scheduler.cfg.when, 'manual');
  assert.equal(bot.pipeline.scheduler.cfg.durationSec, 90);
  assert.equal(bot.pipeline.scheduler.planned, 1);
});

test('бот: две синхронизации награды не идут параллельно', async () => {
  const bot = new Bot(botCore(), { fetch: async () => ({ ok: true, json: async () => ({}) }), setInterval: () => 0, clearInterval: () => {} });
  let calls = 0;
  bot._syncReward = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return 'rw1'; };
  const [a, b] = await Promise.all([bot.syncReward(), bot.syncReward()]);
  assert.equal(a, 'rw1'); assert.equal(b, 'rw1'); assert.equal(calls, 1);
});

test('бот: 403 на награду за баллы не рвёт чат', async () => {
  const core = botCore();
  core._settings.set('bot', { identity: 'self', pointsOn: true, access: { viewer: { access: 'always', active: 1, pauseMin: 0 }, follower: { access: 'always' }, sub: { access: 'always' }, vip: { access: 'always' }, mod: { access: 'always', unlimited: true } } });
  core._store.set('twitch.broadcaster', JSON.stringify({ tokens: { access: 'AT', refresh: 'RT', expiresAt: 9e15 }, user: { id: '100', login: 'alexshikaka' } }));
  const log = [];
  const fetch = router({
    'GET /helix/streams': () => ({ json: { data: [{ id: 's' }] } }),
    'POST /helix/eventsub/subscriptions': ({ body }) => body.type === 'channel.channel_points_custom_reward_redemption.add'
      ? { status: 403, json: { message: 'The broadcaster does not have partner or affiliate status.' } }
      : { status: 202, json: { data: [{}] } },
    'GET /helix/channel_points/custom_rewards': () => ({ json: { data: [] } }),
    'POST /helix/channel_points/custom_rewards': () => ({ json: { data: [{ id: 'rw1' }] } }),
    'POST /helix/chat/messages': () => ({ json: { data: [{ is_sent: true }] } })
  }, log);
  let es;
  const makeEventSub = (o) => { es = new EventEmitter(); es.start = async () => { await o.subscribe('sess'); es.emit('state', 'up'); }; es.stop = () => {}; return es; };
  const bot = new Bot(core, { fetch, makeEventSub, sleep: async () => {}, setInterval: () => 0, clearInterval: () => {} });
  await bot.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(core._health['bot.chat'].st, 'ok');
  assert.equal(core._health['bot.points'].st, 'warn');
  assert.match(core._health['bot.points'].text, /компаньон|партнёр/);
  assert.equal(log.filter((x) => x.key === 'POST /helix/eventsub/subscriptions' && x.body.type === 'channel.chat.message').length, 1);
});

test('бот: баллы — заиграл → FULFILLED, убран → CANCELED', async () => {
  const core = botCore();
  core._settings.set('bot', { identity: 'self', rewardId: 'rw1' });
  core._store.set('twitch.broadcaster', JSON.stringify({ tokens: { access: 'AT', refresh: 'RT', expiresAt: 9e15 }, user: { id: '100', login: 'alexshikaka' } }));
  const log = [];
  const fetch = router({
    'GET /helix/streams': () => ({ json: { data: [] } }),
    'POST /helix/eventsub/subscriptions': () => ({ status: 202, json: {} }),
    'GET /helix/channel_points/custom_rewards': () => ({ json: { data: [{ id: 'rw1' }] } }),
    'PATCH /helix/channel_points/custom_rewards': () => ({ status: 204 }),
    'PATCH /helix/channel_points/custom_rewards/redemptions': () => ({ json: { data: [{}] } }),
    'POST /helix/chat/messages': () => ({ json: { data: [{ is_sent: true }] } })
  }, log);
  let es;
  const makeEventSub = (o) => { es = new EventEmitter(); es.start = async () => { await o.subscribe('sess'); }; es.stop = () => {}; return es; };
  const bot = new Bot(core, { fetch, makeEventSub, sleep: async () => {}, setInterval: () => 0, clearInterval: () => {} });
  await bot.start(); await new Promise((r) => setImmediate(r));
  es.emit('event', 'channel.channel_points_custom_reward_redemption.add', { id: 'red1', user_id: '7', user_login: 'olya', user_input: 'кино группа крови', redeemed_at: new Date().toISOString() });
  es.emit('event', 'channel.channel_points_custom_reward_redemption.add', { id: 'red2', user_id: '8', user_login: 'petya', user_input: 'кино группа крови', redeemed_at: new Date().toISOString() });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(core.added.length, 2);
  core.emit('order:played', core.added[0].id);
  core.emit('order:dropped', core.added[1].id, 'removed');
  await new Promise((r) => setTimeout(r, 10));
  const st = log.filter((x) => x.key === 'PATCH /helix/channel_points/custom_rewards/redemptions').map((x) => x.query.id + ':' + x.body.status);
  assert.deepEqual(st.sort(), ['red1:FULFILLED', 'red2:CANCELED']);
});

// Общая обвязка: бот целиком с поддельным Twitch
function botSetup(extraCfg = {}) {
  const core = botCore();
  const access = { viewer: { access: 'always', active: 1, pauseMin: 0 }, follower: { access: 'always' }, sub: { access: 'always' }, vip: { access: 'always' }, mod: { access: 'always', unlimited: true } };
  core._settings.set('bot', { identity: 'self', onlyLive: false, access, ...extraCfg });
  core._store.set('twitch.broadcaster', JSON.stringify({ tokens: { access: 'AT', refresh: 'RT', expiresAt: 9e15 }, user: { id: '100', login: 'alexshikaka' } }));
  const log = [];
  const fetch = router({
    'GET /helix/streams': () => ({ json: { data: [] } }),
    'POST /helix/eventsub/subscriptions': () => ({ status: 202, json: {} }),
    'GET /helix/channel_points/custom_rewards': () => ({ json: { data: [{ id: 'rw1' }] } }),
    'PATCH /helix/channel_points/custom_rewards': () => ({ status: 204 }),
    'POST /helix/chat/messages': () => ({ json: { data: [{ is_sent: true }] } })
  }, log);
  let es;
  const makeEventSub = (o) => { es = new EventEmitter(); es.start = async () => { await o.subscribe('sess'); }; es.stop = () => {}; return es; };
  const bot = new Bot(core, { fetch, makeEventSub, sleep: async () => {}, setInterval: () => 0, clearInterval: () => {} });
  return { core, bot, get es() { return es; }, log };
}

test('бот: ⛔ у своего заказа — трек убран, тайм-аута стримеру нет', async () => {
  const s = botSetup();
  await s.bot.start(); await new Promise((r) => setImmediate(r));
  s.es.emit('event', 'channel.chat.message', { message_id: 'b1', chatter_user_id: '100', chatter_user_login: 'alexshikaka', badges: [{ set_id: 'broadcaster' }], message: { text: '!play кино группа крови' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.core.added.length, 1);
  const key = s.core.added[0].id;
  s.core.emit('order:ban', key, 10);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.bot.pipeline.tracker.timeoutLeftMin('100', Date.now()), 0); // стример не в тайм-ауте
  assert.equal(s.bot.pipeline.orders.has(key), false);                       // заказ снят с учёта
  assert.ok(!s.bot.journal.some((x) => x.kind === 'ban'), 'в журнале нет ⛔');
});

test('бот: заказ убран из очереди — в журнале «не прозвучал»', async () => {
  const s = botSetup();
  await s.bot.start(); await new Promise((r) => setImmediate(r));
  s.es.emit('event', 'channel.chat.message', { message_id: 'v1', chatter_user_id: '7', chatter_user_login: 'vasya', badges: [], message: { text: '!play кино группа крови' } });
  await new Promise((r) => setTimeout(r, 10));
  s.core.emit('order:dropped', s.core.added[0].id, 'removed');
  await new Promise((r) => setTimeout(r, 10));
  const line = s.bot.journal.find((x) => /не прозвучал/.test(x.text));
  assert.ok(line, 'запись в журнале есть');
  assert.match(line.text, /vasya/);
  assert.match(line.text, /стример убрал/);
});
