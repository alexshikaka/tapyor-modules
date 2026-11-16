'use strict';
// Сервер режима Wi-Fi: полный сценарий протокола, раздача страницы, ping и отказ чужим.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require('../src/crypto');
const {
  createLanServer,
  isPrivateClient,
  PORT_FIRST,
  PORT_LAST,
  PAGE_FILES
} = require('../src/lan-relay');

const PAGE_DIR = path.join(__dirname, '..', 'page');

async function withServer(fn, options = {}) {
  const server = createLanServer(Object.assign({ address: '127.0.0.1', port: 0, pageDir: PAGE_DIR }, options));
  const info = await server.start();
  try {
    return await fn(server, info);
  } finally {
    await server.stop();
  }
}

async function op(base, name, body, method = 'POST') {
  const u = new URL(base);
  u.searchParams.set('op', name);
  const res = await fetch(u, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

test('LAN: полный сценарий ящика — new, host, poll, cmd, ack, end', async () => {
  await withServer(async (server, info) => {
    assert.equal(info.ip, '127.0.0.1');
    assert.ok(info.port > 0);
    assert.equal(info.selfOk, true, 'самопроверка /ping');
    assert.equal(info.base, 'http://127.0.0.1:' + info.port);

    const created = await op(info.base, 'new');
    assert.equal(created.status, 200);
    const sid = created.data.sid;
    const host = created.data.host;
    assert.match(sid, /^[A-Za-z0-9_-]{22}$/);
    assert.match(host, /^[A-Za-z0-9_-]{43}$/);

    const key = C.newKey();
    const snap = C.seal(key, sid, 's', { v: 1, items: [] });
    const feed = C.seal(key, sid, 'f', { feedHtml: '', msgCount: 0 });
    const ev = C.seal(key, sid, 'e', { ev: 'toast', text: 'привет' });

    const hosted = await op(info.base, 'host', { sid, host, s: snap, f: feed, ev: [ev] });
    assert.equal(hosted.status, 200);
    assert.equal(hosted.data.phoneAgo, null);
    assert.deepEqual(hosted.data.cmds, []);

    const u = new URL(info.base);
    u.search = '?op=poll&sid=' + encodeURIComponent(sid) + '&sv=0&fv=0&es=0';
    const got = await fetch(u);
    assert.equal(got.status, 200);
    const data = await got.json();
    assert.equal(data.sv, 1);
    assert.equal(data.fv, 1);
    assert.equal(data.ev.length, 1);
    assert.deepEqual(C.open(key, sid, 's', data.s), { v: 1, items: [] });
    assert.deepEqual(C.open(key, sid, 'f', data.f), { feedHtml: '', msgCount: 0 });
    assert.equal(C.open(key, sid, 'e', data.ev[0].e).text, 'привет');
    assert.ok(Number(data.hostAgo) >= 0);

    const cmd = { c: 'remove', i: 0, key: 'ym:1', n: 'abcdefgh', t: Date.now() };
    const piece = C.seal(key, sid, 'c', cmd);
    const sent = await op(info.base, 'cmd', { sid, c: piece });
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.data, { ok: true });

    const next = await op(info.base, 'host', { sid, host });
    assert.ok(Number(next.data.phoneAgo) < 5000, 'телефон только что опрашивал');
    assert.equal(next.data.cmds.length, 1);
    assert.equal(next.data.cmds[0].seq, 1);
    assert.deepEqual(C.open(key, sid, 'c', next.data.cmds[0].c), cmd);

    const acked = await op(info.base, 'host', { sid, host, ack: 1 });
    assert.deepEqual(acked.data.cmds, [], 'принятая команда удалена по ack');

    const ended = await op(info.base, 'end', { sid, host });
    assert.equal(ended.status, 200);
    const after = await op(info.base, 'host', { sid, host });
    assert.equal(after.status, 404);
    assert.equal(after.data.error, 'no-session');
  });
});

test('LAN: чужой host — 403, мусор в запросе — 400', async () => {
  await withServer(async (server, info) => {
    const created = await op(info.base, 'new');
    const sid = created.data.sid;
    const host = created.data.host;
    const other = await op(info.base, 'host', { sid, host: 'X'.repeat(43) });
    assert.equal(other.status, 403);
    assert.equal(other.data.error, 'forbidden');
    const junk = await op(info.base, 'host', { sid: 'плохой', host });
    assert.equal(junk.status, 400);
    const noCmd = await op(info.base, 'cmd', { sid, c: 'не кусок' });
    assert.equal(noCmd.status, 400);
    assert.equal((await op(info.base, 'unknown')).status, 400);
  });
});

test('LAN: страница по белому списку, config.js — сам сервер, пути вне списка закрыты', async () => {
  await withServer(async (server, info) => {
    const root = await fetch(info.base + '/');
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type') || '', /text\/html/);
    const html = await root.text();
    assert.match(html, /aes-gcm\.js/, 'страница подключает AES-GCM на чистом JS');
    assert.match((await fetch(info.base + '/index.html').then((r) => r.text())), /crypto\.js/);

    const cfg = await fetch(info.base + '/config.js');
    assert.equal(cfg.status, 200);
    assert.match(cfg.headers.get('content-type') || '', /javascript/);
    assert.match(await cfg.text(), new RegExp('url: "http://127\\.0\\.0\\.1:' + info.port + '"'));

    for (const name of ['remote.css', 'remote.js', 'crypto.js', 'aes-gcm.js', 'render-dock.js']) {
      const res = await fetch(info.base + '/' + name);
      assert.equal(res.status, 200, name);
      const body = await res.text();
      assert.ok(body.length > 100, name + ' должен отдаться целиком');
    }
    const css = await fetch(info.base + '/app.css');
    assert.equal(css.status, 200, 'app.css без файла отдаётся пустым');
    assert.equal(await css.text(), '');

    for (const bad of ['/relay.json', '/src/crypto.js', '/../src/crypto.js', '/secret.txt', '/%2e%2e/relay.json']) {
      assert.equal((await fetch(info.base + bad)).status, 404, bad);
    }
    assert.equal((await fetch(info.base + '/ping', { method: 'POST' })).status, 405);
    assert.ok(PAGE_FILES['/index.html']);
    assert.equal(PAGE_FILES['/../secret'], undefined);
  });
});

test('LAN: /ping отвечает ok, а не-частный клиент получает 403', async () => {
  await withServer(async (server, info) => {
    const res = await fetch(info.base + '/ping');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  // Подставной адрес клиента: настоящий сокет здесь 127.0.0.1.
  await withServer(async (server, info) => {
    const res = await fetch(info.base + '/ping');
    assert.equal(res.status, 403);
    const any = await op(info.base, 'new');
    assert.equal(any.status, 403);
    assert.deepEqual(any.data, { error: 'forbidden' });
  }, { clientIp: '8.8.8.8' });
});

test('LAN: только частные сети и локальный адрес', () => {
  for (const ip of ['10.1.2.3', '172.16.0.5', '172.31.9.9', '192.168.1.2', '169.254.1.1', '127.0.0.1', '::1', '::ffff:192.168.1.2', 'fd00::1', 'fd12:3456::1']) {
    assert.equal(isPrivateClient(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '2001:db8::1', 'fe80::1', '', null, '::ffff:8.8.8.8']) {
    assert.equal(isPrivateClient(ip), false, String(ip));
  }
});

test('LAN: порт 47660–47679 и остановка сервера', async () => {
  assert.equal(PORT_FIRST, 47660);
  assert.equal(PORT_LAST, 47679);

  const server = createLanServer({ address: '127.0.0.1', port: 0, pageDir: PAGE_DIR });
  const info = await server.start();
  assert.equal(server.isRunning(), true);
  assert.equal(info.selfOk, true);
  const again = await server.start();
  assert.equal(again.port, info.port, 'повторный start не поднимает второй сервер');
  await server.stop();
  assert.equal(server.isRunning(), false);
  assert.equal(server.getInfo(), null);
  // после остановки порт свободен: новый сервер поднимается
  const second = createLanServer({ address: '127.0.0.1', port: 0, pageDir: PAGE_DIR });
  const info2 = await second.start();
  assert.ok(info2.port > 0);
  await second.stop();
});

test('LAN: без домашнего адреса — понятная ошибка', async () => {
  const server = createLanServer({
    port: 0,
    pageDir: PAGE_DIR,
    interfaces: { 'Wi-Fi': [{ address: '169.254.1.1', netmask: '255.255.0.0', family: 'IPv4', internal: false }] }
  });
  await assert.rejects(server.start(), /не найден адрес в домашней сети/);
});

test('LAN: видео «экран не гаснет» отдаётся целиком и кусками (Range — для iPhone)', async () => {
  await withServer(async (server, info) => {
    const full = await fetch(info.base + '/keepawake.mp4');
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    const all = Buffer.from(await full.arrayBuffer());
    assert.ok(all.length > 500);
    const part = await fetch(info.base + '/keepawake.mp4', { headers: { Range: 'bytes=0-1' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 0-1/' + all.length);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), all.subarray(0, 2));
    const webm = await fetch(info.base + '/keepawake.webm');
    assert.equal(webm.status, 200);
    assert.equal(webm.headers.get('content-type'), 'video/webm');
    await webm.arrayBuffer();
  });
});
