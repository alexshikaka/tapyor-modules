'use strict';
// Модуль пульта: режим облака и Wi-Fi, выбор адреса, selfOk и подсказка phone-missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Remote, activate, deactivate, NO_ADDRESS } = require('../src/index');

const IFACES = {
  'Wi-Fi': [{ address: '192.168.1.5', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
  'Ethernet': [{ address: '10.0.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
};
const PROFILES = [
  { alias: 'Wi-Fi', category: 'Private' },
  { alias: 'Ethernet', category: 'Public' }
];

function fakeCore() {
  return {
    logs: [],
    dockWants: [],
    feedWants: [],
    remote: {
      qr: () => '<svg viewBox="0 0 1 1"></svg>',
      dock: {
        on() { return () => {}; },
        want(v) { this.dockWants = v; },
        cmd() { return { ok: true }; },
        get() { return null; }
      },
      feed: {
        on() { return () => {}; },
        want() {},
        rq() {},
        setting() {}
      }
    },
    log(line) { this.logs.push(line); }
  };
}

function fakeCloud() {
  return {
    configured: true,
    started: 0,
    ended: 0,
    async new() { this.started++; return { sid: 'C'.repeat(22), host: 'D'.repeat(43), ttl: 1000 }; },
    async host() { return { ok: true, data: { cmds: [], phoneAgo: null } }; },
    async end() { this.ended++; return { ok: true }; }
  };
}

// Поддельный сервер Wi-Fi: тот же вид, что у lan-relay (start/stop/channel).
function fakeLan(clock, options = {}) {
  const box = { sid: 'L'.repeat(22), host: 'H'.repeat(43), cmds: [], seq: 0, phoneAt: null };
  let selected = '';
  const server = {
    started: 0,
    stopped: 0,
    info: null,
    async start() {
      this.started++;
      const address = selected || '192.168.1.5';
      const ip = address;
      const net = /^10\./.test(ip) ? '10.0.0.0/8' : '192.168.1.0/24';
      this.info = {
        ip,
        port: 47660,
        net,
        base: 'http://' + ip + ':47660',
        selfOk: options.selfOk === undefined ? true : options.selfOk
      };
      if (options.throwOnStart) throw new Error('порт занят');
      return this.info;
    },
    async stop() { this.stopped++; },
    channel() {
      return {
        configured: true,
        async new() { return { sid: box.sid, host: box.host, ttl: 1000 }; },
        async host(body) {
          if (body.host !== box.host) return { ok: false, status: 403, code: 'forbidden', error: 'нет' };
          return {
            ok: true,
            data: {
              cmds: box.cmds.filter((c) => c.seq > (Number(body.ack) || 0)),
              phoneAgo: box.phoneAt == null ? null : Math.max(0, clock.now - box.phoneAt)
            }
          };
        },
        async end() { box.ended = true; return { ok: true }; }
      };
    }
  };
  const create = (opts = {}) => {
    selected = opts.address || '';
    server.address = selected;
    return server;
  };
  return { server, box, create };
}

function make(core, cloud, lan, clock, extra = {}) {
  return new Remote(core, Object.assign({
    relay: cloud,
    createLan: lan.create,
    networkInterfaces: () => IFACES,
    readProfiles: async () => PROFILES,
    now: () => clock.now,
    page: 'https://site.test/remote/'
  }, extra));
}

test('ПУЛЬТ: по умолчанию Wi-Fi, в статусе есть список домашних адресов', async () => {
  const clock = { now: 1763300000000 };
  const core = fakeCore();
  const cloud = fakeCloud();
  const lan = fakeLan(clock);
  const mod = make(core, cloud, lan, clock);

  const st = mod.status();
  assert.equal(st.state, 'idle');
  assert.equal(st.lan.on, true, 'по умолчанию Wi-Fi (решение владельца 16.11)');
  assert.equal(st.lan.url, '');
  assert.equal(st.lan.ip, '192.168.1.5', 'адрес по умолчанию — Wi-Fi с 192.168');
  assert.equal(st.lan.net, '192.168.1.0/24');
  assert.equal(st.lan.port, 0);
  assert.equal(st.lan.selfOk, null);
  assert.equal(st.lan.publicNet, null, 'профиль ещё не спрашивали');
  assert.deepEqual(st.lan.addrs, [
    { ip: '192.168.1.5', name: 'Wi-Fi' },
    { ip: '10.0.0.2', name: 'Ethernet' }
  ]);
  assert.deepEqual(st.lan.vpn, { pc: false, names: [] });
  assert.equal(st.hint, null);

  const started = await mod.start();
  assert.equal(started.state, 'waiting');
  assert.match(started.url, /^http:\/\/192\.168\.1\.5:\d+\/#/, 'по умолчанию QR ведёт на ПК по Wi-Fi');
  assert.equal(cloud.started, 0, 'облако по умолчанию не трогается');
  assert.equal(lan.server.started, 1);
  await mod.stop();
});

test('ПУЛЬТ: режим Wi-Fi — выбор адреса, QR по http, selfOk и hint phone-missing', async () => {
  const clock = { now: 1763300000000 };
  const core = fakeCore();
  const cloud = fakeCloud();
  const lan = fakeLan(clock);
  const mod = make(core, cloud, lan, clock, { mode: 'cloud' });   // начинаем с облака, чтобы проверить переключение

  let st = await mod.command('mode', { mode: 'lan' });
  assert.equal(st.lan.on, true);
  assert.equal(st.lan.publicNet, false, 'Wi-Fi помечена частной');
  assert.equal(st.state, 'idle');

  st = await mod.command('lan-ip', { ip: '10.0.0.2' });
  assert.equal(st.lan.ip, '10.0.0.2');
  assert.equal(st.lan.net, '10.0.0.0/24');
  assert.equal(st.lan.publicNet, true, 'Ethernet помечена общедоступной');

  st = await mod.start();
  assert.equal(st.state, 'waiting');
  assert.equal(lan.server.started, 1);
  assert.equal(st.lan.url, 'http://10.0.0.2:47660', 'адрес своего сервера');
  assert.equal(st.lan.port, 47660);
  assert.equal(st.lan.selfOk, true);
  assert.match(st.url, /^http:\/\/10\.0\.0\.2:47660\/#L{22}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(st.lan.addrs.length, 2);

  clock.now += 61000;
  st = mod.status();
  assert.equal(st.hint, 'phone-missing', 'минуту телефон не приходил');
  assert.equal(st.state, 'waiting');

  // Телефон опросил сервер — подсказка снимается.
  lan.box.phoneAt = clock.now;
  await mod.session.pollOnce();
  st = mod.status();
  assert.equal(st.state, 'connected');
  assert.equal(st.hint, null);
  assert.equal(st.phoneAgo, 0);

  const stopped = await mod.stop();
  assert.equal(stopped.state, 'idle');
  assert.equal(lan.server.stopped, 1, 'stop гасит сервер Wi-Fi');
  assert.equal(stopped.lan.url, '', 'после остановки адреса сервера нет');
});

test('ПУЛЬТ: самопроверка не прошла — selfOk false в статусе', async () => {
  const clock = { now: 1763300000000 };
  const core = fakeCore();
  const lan = fakeLan(clock, { selfOk: false });
  const mod = make(core, fakeCloud(), lan, clock);
  await mod.command('mode', { mode: 'lan' });
  const st = await mod.start();
  assert.equal(st.state, 'waiting');
  assert.equal(st.lan.selfOk, false);
  await mod.stop();
});

test('ПУЛЬТ: переключение обратно в облако гасит сервер, renew работает в обоих режимах', async () => {
  const clock = { now: 1763300000000 };
  const core = fakeCore();
  const cloud = fakeCloud();
  const lan = fakeLan(clock);
  const mod = make(core, cloud, lan, clock);

  await mod.command('mode', { mode: 'lan' });
  await mod.start();
  assert.equal(lan.server.started, 1);

  let st = await mod.command('mode', { mode: 'cloud' });
  assert.equal(st.lan.on, false);
  assert.equal(st.state, 'idle');
  assert.equal(lan.server.stopped, 1, 'переключение режима гасит сервер');
  assert.equal(lan.box.ended, true, 'и закрывает локальную сессию');

  st = await mod.start();
  assert.match(st.url, /^https:\/\//);
  assert.equal(lan.server.started, 1, 'в облаке сервер Wi-Fi больше не поднимается');
  await mod.stop();

  // renew в Wi-Fi: старый сервер погашен, поднят новый.
  await mod.command('mode', { mode: 'lan' });
  await mod.start();
  const before = lan.server.started;
  st = await mod.renew();
  assert.equal(st.state, 'waiting');
  assert.equal(lan.server.stopped, 2);
  assert.equal(lan.server.started, before + 1);
  await mod.stop();
});

test('ПУЛЬТ: команды mode и lan-ip проверяют значения', async () => {
  const clock = { now: 1763300000000 };
  const mod = make(fakeCore(), fakeCloud(), fakeLan(clock), clock);
  await assert.rejects(mod.command('mode', { mode: 'что-то' }), /cloud или lan/);
  await assert.rejects(mod.command('lan-ip', { ip: '8.8.8.8' }), /такого домашнего адреса нет/);
  await assert.rejects(mod.command('lan-ip', {}), /такого домашнего адреса нет/);
  await assert.rejects(mod.command('нет-такой'), /неизвестная команда/);
});

test('ПУЛЬТ: в Wi-Fi без домашнего адреса — понятная ошибка, сервер не поднимается', async () => {
  const clock = { now: 1763300000000 };
  const lan = fakeLan(clock);
  let created = 0;
  const mod = make(fakeCore(), fakeCloud(), lan, clock, {
    networkInterfaces: () => ({ 'Ethernet': [{ address: '169.254.5.5', netmask: '255.255.0.0', family: 'IPv4', internal: false }] }),
    createLan: () => { created++; return lan.server; }
  });
  await mod.command('mode', { mode: 'lan' });
  const st = await mod.start();
  assert.equal(st.state, 'error');
  assert.equal(st.error, NO_ADDRESS);
  assert.equal(created, 0);
  assert.equal(st.lan.ip, '');
});

test('ПУЛЬТ: режим и выбранный адрес запоминаются в настройках ядра', async () => {
  const clock = { now: 1763300000000 };
  const saved = new Map();
  const settings = {
    get(key) { return saved.get(key); },
    set(key, value) { saved.set(key, value); }
  };
  const lan = fakeLan(clock);
  const options = { settings };

  let mod = make(fakeCore(), fakeCloud(), lan, clock, options);
  assert.equal(mod.mode, 'lan', 'по умолчанию Wi-Fi (решение владельца 16.11)');
  await mod.command('mode', { mode: 'lan' });
  await mod.command('lan-ip', { ip: '10.0.0.2' });
  assert.deepEqual(saved.get('remote'), { mode: 'lan', lanIp: '10.0.0.2' });

  mod = make(fakeCore(), fakeCloud(), lan, clock, options);
  assert.equal(mod.mode, 'lan', 'режим восстановлен');
  assert.equal(mod.lanIp, '10.0.0.2', 'адрес восстановлен');
  assert.equal(mod.status().lan.on, true);

  mod = make(fakeCore(), fakeCloud(), lan, clock, Object.assign({ mode: 'cloud' }, options));
  assert.equal(mod.mode, 'cloud', 'явный аргумент важнее сохранённого');
});

test('ПУЛЬТ: deactivate гасит сервер Wi-Fi', async () => {
  const clock = { now: 1763300000000 };
  const lan = fakeLan(clock);
  const mod = await activate(fakeCore(), {
    relay: fakeCloud(),
    createLan: lan.create,
    networkInterfaces: () => IFACES,
    readProfiles: async () => PROFILES,
    now: () => clock.now,
    page: 'https://site.test/remote/'
  });
  await mod.command('mode', { mode: 'lan' });
  await mod.start();
  await deactivate();
  assert.equal(lan.server.stopped, 1);
  assert.equal(mod.status().state, 'idle');
  assert.equal(mod.status().lan.url, '');
});

test('ПУЛЬТ: ссылка Wi-Fi постоянная — после перезапуска та же, меняется от «Новой ссылки» и смены сети (16.11)', async () => {
  const lanRelay = require('../src/lan-relay');
  const clock = { now: 1763300000000 };
  const shelf = {};
  const core = fakeCore();
  core.secure = { get: async (k) => shelf[k] || '', set: async (k, v) => { shelf[k] = v; return { ok: true }; } };
  let ip = '192.168.1.5';
  // каждый «запуск Тапёра» — новый сервер с пустой памятью, как в жизни
  const createLan = () => {
    const real = lanRelay.createLanServer({ now: () => clock.now });
    return {
      async start() { return { ip, port: 47660, net: /^10\./.test(ip) ? '10.0.0.0/24' : '192.168.1.0/24', base: 'http://' + ip + ':47660', selfOk: true }; },
      async stop() {},
      channel: () => real.channel()
    };
  };
  const mk = () => new Remote(core, {
    relay: fakeCloud(), createLan, networkInterfaces: () => IFACES, readProfiles: async () => PROFILES,
    now: () => clock.now, page: 'https://site.test/remote/'
  });

  const a = mk();
  const first = await a.start();
  assert.match(first.url, /^http:\/\/192\.168\.1\.5:47660\/#/);
  assert.ok(shelf.lanLink, 'ссылка сохранена на полке модуля');
  await a.stop();

  const b = mk();                       // «перезапуск Тапёра»
  await b.autoStart();
  const again = b.status();
  assert.equal(again.state, 'waiting', 'после перезапуска пульт поднялся сам');
  assert.equal(again.url, first.url, 'ссылка та же');

  const renewed = await b.renew();
  assert.notEqual(renewed.url, first.url, '«Новая ссылка» меняет ссылку');
  await b.stop();

  ip = '10.0.0.2';                      // другая сеть
  const c = mk();
  c.lanIp = '10.0.0.2';
  const moved = await c.start();
  assert.notEqual(moved.url, renewed.url, 'другая сеть — другая ссылка');
  assert.match(moved.url, /^http:\/\/10\.0\.0\.2:47660\/#/);
  await c.stop();
});
