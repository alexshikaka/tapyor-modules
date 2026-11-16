'use strict';
// Дополнения страницы телефона: чистая часть — разбор адреса, память последней
// сессии, признаки iPhone/значка и Wake Lock (на поддельных document/navigator).
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../page/phone-extras');

const SID = 'a'.repeat(22);
const KEY = 'b'.repeat(43);

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map)
  };
}

test('PHONE: адрес из # — sid, ключ и номер облака', () => {
  assert.deepEqual(X.parseAddress('#' + SID + '.' + KEY), { sid: SID, key: KEY, cloud: 0 });
  assert.deepEqual(X.parseAddress('#' + SID + '.' + KEY + '.2'), { sid: SID, key: KEY, cloud: 2 });
  for (const bad of ['', '#', '#short.key', '#' + SID + '.' + KEY + '.10000', '#' + SID + '.' + KEY + '.x']) {
    assert.equal(X.parseAddress(bad), null, bad);
  }
});

test('PHONE: последняя сессия сохраняется, читается и стирается', () => {
  const st = fakeStorage();
  assert.equal(X.readSaved(st), null, 'пусто — сохранённого нет');
  assert.equal(X.saveSaved({ sid: SID, key: KEY, cloud: 2, mode: 'cloud' }, st), true);
  assert.deepEqual(X.readSaved(st), { sid: SID, key: KEY, cloud: 2 });
  assert.equal(JSON.parse(st.getItem(X.SAVED_KEY)).mode, 'cloud');

  assert.equal(X.saveSaved({ sid: SID, key: KEY, cloud: 0, mode: 'lan' }, st), true);
  assert.deepEqual(X.readSaved(st), { sid: SID, key: KEY, cloud: 0 });
  assert.equal(JSON.parse(st.getItem(X.SAVED_KEY)).mode, 'lan');

  assert.equal(X.clearSaved(st), true);
  assert.equal(X.readSaved(st), null);
});

test('PHONE: мусор в сохранённой сессии не подхватывается', () => {
  for (const raw of [
    'не json',
    'null',
    '{}',
    JSON.stringify({ sid: 'плохо', key: KEY }),
    JSON.stringify({ sid: SID, key: 'short' }),
    JSON.stringify({ sid: SID, key: KEY, cloud: 10000 })
  ]) {
    assert.equal(X.readSaved(fakeStorage({ [X.SAVED_KEY]: raw })), null, raw);
  }
});

test('PHONE: iPhone, значок на домашнем экране, поддержка полного экрана', () => {
  assert.equal(X.isIosBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
  assert.equal(X.isIosBrowser('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), true);
  assert.equal(X.isIosBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148', 5), true);
  assert.equal(X.isIosBrowser('Mozilla/5.0 (Linux; Android 14)'), false);
  assert.equal(X.isIosBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);

  assert.equal(X.isStandalone({ matchMedia: () => ({ matches: true }), navigator: {} }), true);
  assert.equal(X.isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
  assert.equal(X.isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} }), false);

  assert.equal(X.fullscreenSupported({ fullscreenEnabled: true, documentElement: { requestFullscreen() {} } }), true);
  assert.equal(X.fullscreenSupported({ fullscreenEnabled: false, documentElement: { requestFullscreen() {} } }), false);
  assert.equal(X.fullscreenSupported({ fullscreenEnabled: true, documentElement: {} }), false);
});

test('PHONE: Wake Lock просит экран, отпускает при скрытии и просит снова', async () => {
  const listeners = {};
  const doc = {
    hidden: false,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { for (const fn of listeners[type] || []) fn(); }
  };
  let requested = 0;
  const sentinel = {
    released: false,
    addEventListener(type, fn) { if (type === 'release') this.onrelease = fn; },
    release() { this.released = true; if (this.onrelease) this.onrelease(); return Promise.resolve(); }
  };
  const win = {
    document: doc,
    navigator: {
      wakeLock: {
        request(kind) { requested += 1; assert.equal(kind, 'screen'); return Promise.resolve(sentinel); }
      }
    }
  };
  const lock = X.createWakeLock(win);
  lock.setConnected(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requested, 1, 'связь и видимая страница — просим экран');
  assert.equal(lock.state().locked, true);

  doc.hidden = true;
  doc.fire('visibilitychange');
  assert.equal(lock.state().locked, false, 'скрыли — отпустили');
  assert.equal(sentinel.released, true);

  doc.hidden = false;
  doc.fire('visibilitychange');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requested, 2, 'вернулись — просим заново');
  assert.equal(lock.state().locked, true);

  lock.setConnected(false);
  assert.equal(lock.state().locked, false, 'связи нет — отпустили');
});

test('PHONE: без Wake Lock API — молча и без исключений', () => {
  const lock = X.createWakeLock({ document: { hidden: false }, navigator: {} });
  assert.doesNotThrow(() => lock.setConnected(true));
  assert.equal(lock.state().locked, false);
});

// 16.11: по http (режим «По Wi-Fi») Wake Lock нет — экран держит беззвучное видео по кругу
function fakeVideoDoc(playOk) {
  const listeners = {};
  const made = [];
  const doc = {
    hidden: false,
    body: { appendChild(el) { el.inDom = true; } },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    fire(t) { (listeners[t] || []).slice().forEach((fn) => fn()); },
    count(t) { return (listeners[t] || []).length; },
    createElement(tag) {
      const el = { tag, attrs: {}, kids: [], paused: true, currentTime: 0,
        setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.kids.push(c); },
        play() { if (doc.playOk) { this.paused = false; return Promise.resolve(); } return Promise.reject(new Error('NotAllowedError')); },
        pause() { this.paused = true; } };
      made.push(el);
      return el;
    },
    playOk,
    made
  };
  return doc;
}

test('PHONE: без Wake Lock — беззвучное видео по кругу, пауза при уходе со страницы', async () => {
  const doc = fakeVideoDoc(true);
  const lock = X.createWakeLock({ document: doc, navigator: {} });
  lock.setConnected(true);
  await Promise.resolve(); await Promise.resolve();
  const v = doc.made.find((e) => e.tag === 'video');
  assert.ok(v && v.inDom, 'видео добавлено на страницу');
  assert.equal(v.muted, true); assert.equal(v.loop, true); assert.equal(v.playsInline, true);
  assert.deepEqual(v.kids.map((k) => k.src), ['keepawake.webm', 'keepawake.mp4']);
  assert.equal(lock.state().video, true, 'видео играет');
  doc.hidden = true; doc.fire('visibilitychange');
  assert.equal(v.paused, true, 'страницу скрыли — видео на паузе');
  doc.hidden = false; doc.fire('visibilitychange');
  await Promise.resolve();
  assert.equal(lock.state().video, true, 'вернулись — снова играет');
  lock.setConnected(false);
  assert.equal(v.paused, true, 'связи нет — видео на паузе');
});

test('PHONE: видео без касания не запустилось — запуск при первом касании экрана', async () => {
  const doc = fakeVideoDoc(false);
  const lock = X.createWakeLock({ document: doc, navigator: {} });
  lock.setConnected(true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(lock.state().video, false);
  assert.equal(doc.count('touchend'), 1, 'ждём касания');
  doc.playOk = true;
  doc.fire('touchend');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(lock.state().video, true, 'после касания видео играет');
  assert.equal(doc.count('touchend'), 0, 'обработчик касания снят');
  lock.setConnected(false);
});

test('PHONE: Wake Lock отказал — тоже запасное видео', async () => {
  const doc = fakeVideoDoc(true);
  const lock = X.createWakeLock({ document: doc, navigator: { wakeLock: { request() { return Promise.reject(new Error('NotAllowedError')); } } } });
  lock.setConnected(true);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(lock.state().locked, false);
  assert.equal(lock.state().video, true);
  lock.setConnected(false);
});
