'use strict';
// Список облаков: выбор первого ответившего, порядок перебора и маршрут запросов.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClouds } = require('../src/clouds');

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function sessionFor(host) {
  // sid и host нужной формы; разные для разных облаков, чтобы видеть, кто ответил.
  return {
    sid: (host[0] || 'A').toUpperCase().repeat(22),
    host: (host[0] || 'A').toUpperCase().repeat(43)
  };
}

test('CLOUDS: первое ответившее облако становится облаком сессии', async () => {
  const seen = [];
  const clouds = createClouds({
    urls: ['https://one.example', 'https://two.example', 'https://three.example'],
    fetch: async (url) => {
      const u = new URL(String(url));
      const host = u.hostname;
      if (u.searchParams.get('op') === 'new') {
        seen.push(host);
        if (host === 'one.example') throw new Error('не отвечает');
        if (host === 'two.example') return reply(200, { error: 'busy' });
        return reply(200, sessionFor(host));
      }
      return reply(200, { ok: true, cmds: [], phoneAgo: 7 });
    }
  });

  assert.equal(clouds.configured, true);
  assert.equal(clouds.count, 3);
  const res = await clouds.new();
  assert.equal(res.ok, true);
  assert.deepEqual(seen, ['one.example', 'two.example', 'three.example'], 'перебор по порядку');
  assert.equal(clouds.index, 2);
  assert.equal(clouds.url, 'https://three.example');
  const host = await clouds.host({ sid: 'S', host: 'H' });
  assert.equal(host.ok, true);
  assert.equal(host.data.phoneAgo, 7, 'host идёт на выбранное облако');
});

test('CLOUDS: кривой ответ и пустое тело не выбираются, запрос уходит дальше', async () => {
  const asked = [];
  const clouds = createClouds({
    urls: ['https://bad.example', 'https://empty.example', 'https://good.example'],
    fetch: async (url) => {
      const u = new URL(String(url));
      const host = u.hostname;
      if (u.searchParams.get('op') === 'new') {
        asked.push(host);
        if (host === 'bad.example') return reply(200, { sid: 'x', host: 'y' });
        if (host === 'empty.example') return reply(200, {});
        return reply(200, { sid: 'G'.repeat(22), host: 'H'.repeat(43) });
      }
      return reply(200, { ok: true });
    }
  });
  const res = await clouds.new();
  assert.equal(res.ok, true);
  assert.deepEqual(asked, ['bad.example', 'empty.example', 'good.example']);
  assert.equal(clouds.index, 2);
});

test('CLOUDS: все облака молчат — понятная ошибка, индекс не меняется', async () => {
  const clouds = createClouds({
    urls: ['https://a.example', 'https://b.example'],
    fetch: async () => { throw new Error('нет сети'); }
  });
  const res = await clouds.new();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'network');
  assert.match(res.error, /нет связи/);
  assert.equal(clouds.index, 0);
});

test('CLOUDS: start задаёт первое облако (переход на запасное), перебор по кругу', async () => {
  const asked = [];
  const clouds = createClouds({
    urls: ['https://a.example', 'https://b.example', 'https://c.example'],
    fetch: async (url) => {
      const u = new URL(String(url));
      const host = u.hostname;
      if (u.searchParams.get('op') === 'new') {
        asked.push(host);
        if (host !== 'c.example') return reply(500, { error: 'down' });
        return reply(200, { sid: 'C'.repeat(22), host: 'H'.repeat(43) });
      }
      return reply(200, { ok: true });
    }
  });
  const res = await clouds.new({ start: 1 });
  assert.equal(res.ok, true);
  assert.deepEqual(asked, ['b.example', 'c.example'], 'начинает со следующего и идёт по порядку');
  assert.equal(clouds.index, 2);
});

test('CLOUDS: без адресов — «облако не настроено», host и end не падают', async () => {
  const clouds = createClouds({ urls: [] });
  assert.equal(clouds.configured, false);
  assert.equal(clouds.count, 0);
  const res = await clouds.new();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'no-config');
  assert.match(res.error, /не настроено/);
  assert.equal((await clouds.host({})).ok, false);
  assert.equal((await clouds.end({})).ok, true);
});
