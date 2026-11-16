'use strict';
// Запросы к облаку пульта: адрес, тайм-аут, понятные ошибки.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, createRelay, DEFAULT_PAGE } = require('../src/relay');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-relay-'));
}

test('RELAY: relay.json читается, адрес страницы нормализуется', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'relay.json');
    fs.writeFileSync(file, JSON.stringify({ url: 'https://functions.example/id/', page: 'https://site.example/remote' }), 'utf8');
    const cfg = loadConfig(file);
    assert.equal(cfg.url, 'https://functions.example/id');
    assert.equal(cfg.page, 'https://site.example/remote/');

    fs.writeFileSync(file, JSON.stringify({ url: 'javascript:alert(1)', page: 'ftp://bad' }), 'utf8');
    const bad = loadConfig(file);
    assert.equal(bad.url, '');
    assert.equal(bad.page, DEFAULT_PAGE);

    fs.writeFileSync(file, 'не json', 'utf8');
    const broken = loadConfig(file);
    assert.equal(broken.url, '');
    assert.equal(broken.page, DEFAULT_PAGE);

    assert.deepEqual(loadConfig(path.join(dir, 'нет.json')), { url: '', page: DEFAULT_PAGE });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RELAY: пустой адрес — «облако пульта не настроено», сеть не зовётся', async () => {
  let called = 0;
  const r = createRelay({ url: '', fetch: async () => { called++; throw new Error('нельзя'); } });
  const res = await r.new();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'no-config');
  assert.match(res.error, /не настроено/);
  assert.equal(called, 0);
  assert.equal(r.configured, false);
});

test('RELAY: хост и тело запроса, понятный ответ', async () => {
  let seen = null;
  const r = createRelay({
    url: 'https://relay.test',
    fetch: async (url, opts) => {
      seen = { url, opts };
      return { ok: true, status: 200, json: async () => ({ cmds: [], phoneAgo: null }) };
    }
  });
  const res = await r.host({ sid: 'S', host: 'H' });
  assert.equal(res.ok, true);
  assert.equal(res.data.phoneAgo, null);
  const u = new URL(seen.url);
  assert.equal(u.searchParams.get('op'), 'host');
  assert.equal(seen.opts.method, 'POST');
  assert.deepEqual(JSON.parse(seen.opts.body), { sid: 'S', host: 'H' });
});

test('RELAY: 404 no-session — отдельный код и понятный текст', async () => {
  const r = createRelay({
    url: 'https://relay.test',
    fetch: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no-session' }) })
  });
  const res = await r.host({ sid: 'S', host: 'H' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'no-session');
  assert.equal(res.status, 404);
  assert.match(res.error, /Сессия закончилась/);
});

test('RELAY: тайм-аут 8 с (в тесте короче) — понятная ошибка', async () => {
  const r = createRelay({
    url: 'https://relay.test',
    timeoutMs: 30,
    fetch: (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('прервано')));
    })
  });
  const res = await r.new();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'timeout');
  assert.match(res.error, /не ответило вовремя/);
});

test('RELAY: сеть легла — понятная ошибка без исключения', async () => {
  const r = createRelay({ url: 'https://relay.test', fetch: async () => { throw new Error('нет сети'); } });
  const res = await r.end({ sid: 'S', host: 'H' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'network');
  assert.match(res.error, /нет связи/);
});

test('RELAY: ошибка функции превращается в текст, без тела целиком', async () => {
  const r = createRelay({
    url: 'https://relay.test',
    fetch: async () => ({ ok: false, status: 500, json: async () => ({ error: 'oops', tapyor_error: 'oops' }) })
  });
  const res = await r.host({});
  assert.equal(res.ok, false);
  assert.equal(res.code, 'oops');
  assert.match(res.error, /временно не отвечает/);
  assert.equal(res.retryable, true);
});
