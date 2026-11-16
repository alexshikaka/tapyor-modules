'use strict';
// Сеть ПК для режима Wi-Fi: образцы os.networkInterfaces() — обычный ПК, WireGuard, Hyper-V.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/netinfo');

function rec(address, netmask, family = 'IPv4', internal = false) {
  return { address, netmask, family, internal, mac: '00:00:00:00:00:00', cidr: null };
}

function loopback() {
  return [rec('127.0.0.1', '255.0.0.0', 'IPv4', true), rec('::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'IPv6', true)];
}

test('NETINFO: обычный ПК — один домашний адрес, loopback и link-local не предлагаются', () => {
  const interfaces = {
    'Loopback Pseudo-Interface 1': loopback(),
    'Wi-Fi': [rec('192.168.1.5', '255.255.255.0'), rec('fe80::1234', 'ffff:ffff:ffff:ffff::', 'IPv6')],
    'Ethernet': [rec('169.254.10.20', '255.255.0.0')]
  };
  const state = N.scan(interfaces);
  assert.equal(state.addrs.length, 1);
  assert.deepEqual(state.addrs[0], {
    ip: '192.168.1.5', name: 'Wi-Fi', net: '192.168.1.0/24',
    private: true, linkLocal: false, vpn: false, virtual: false
  });
  assert.equal(state.vpn.pc, false);
  assert.equal(N.pickDefault(state.addrs).ip, '192.168.1.5');
  assert.equal(N.describe(interfaces).net, '192.168.1.0/24');
});

test('NETINFO: ПК с WireGuard — туннель виден как VPN и не предлагается телефону', () => {
  const interfaces = {
    'Wi-Fi': [rec('192.168.1.5', '255.255.255.0')],
    'WireGuard Tunnel': [rec('10.8.0.2', '255.255.255.0')]
  };
  const state = N.scan(interfaces);
  assert.deepEqual(state.vpn, { pc: true, names: ['WireGuard Tunnel'] });
  assert.deepEqual(state.addrs.map((a) => a.ip), ['192.168.1.5']);
  assert.equal(state.all.find((a) => a.ip === '10.8.0.2').vpn, true);
});

test('NETINFO: Hyper-V рядом с Wi-Fi — виртуальные адаптеры не предлагаются', () => {
  const interfaces = {
    'vEthernet (Default Switch)': [rec('172.20.96.1', '255.255.240.0')],
    'Hyper-V Virtual Ethernet Adapter': [rec('192.168.56.1', '255.255.255.0')],
    'Wi-Fi': [rec('192.168.0.10', '255.255.255.0')]
  };
  const state = N.scan(interfaces);
  assert.deepEqual(state.addrs.map((a) => a.ip), ['192.168.0.10']);
  assert.equal(state.virtual.length, 2);
  assert.equal(state.vpn.pc, false);
});

test('NETINFO: Ethernet и Wi-Fi — выбирается домашний Wi-Fi с 192.168', () => {
  const interfaces = {
    'Ethernet': [rec('10.0.0.2', '255.255.255.0')],
    'Wi-Fi': [rec('192.168.1.7', '255.255.255.0')]
  };
  assert.equal(N.pickDefault(N.scan(interfaces).addrs).ip, '192.168.1.7');
  assert.equal(N.pickDefault([]), null);
  assert.equal(N.findAddress(N.scan(interfaces).addrs, '10.0.0.2').name, 'Ethernet');
  assert.equal(N.findAddress(N.scan(interfaces).addrs, '10.9.9.9'), null);
});

test('NETINFO: частные адреса и маски', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.1.1']) {
    assert.equal(N.isPrivateIPv4(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '11.0.0.1', '']) {
    assert.equal(N.isPrivateIPv4(ip), false, ip);
  }
  assert.equal(N.isLinkLocalIPv4('169.254.2.3'), true);
  assert.equal(N.prefixOf('255.255.255.0'), 24);
  assert.equal(N.prefixOf('255.255.0.0'), 16);
  assert.equal(N.prefixOf('255.255.255.192'), 26);
  assert.equal(N.prefixOf('255.255.0.255'), -1);
  assert.equal(N.prefixOf('мусор'), -1);
  assert.equal(N.netOf('192.168.1.5', '255.255.255.0'), '192.168.1.0/24');
  assert.equal(N.netOf('10.0.5.4', '255.255.0.0'), '10.0.0.0/16');
  assert.equal(N.netOf('192.168.1.5', '255.0.255.0'), '');
});

test('NETINFO: профиль сети Windows — разбор JSON, Public/Private, мусор → null', () => {
  assert.deepEqual(
    N.parseProfiles('{"InterfaceAlias":"Wi-Fi","NetworkCategory":"Public"}'),
    [{ alias: 'Wi-Fi', category: 'Public' }]
  );
  assert.deepEqual(
    N.parseProfiles('[{"InterfaceAlias":"Ethernet","NetworkCategory":"Private"},{"InterfaceAlias":"Wi-Fi","NetworkCategory":"Public"}]'),
    [{ alias: 'Ethernet', category: 'Private' }, { alias: 'Wi-Fi', category: 'Public' }]
  );
  assert.equal(N.parseProfiles('не json'), null);
  assert.equal(N.parseProfiles(''), null);
  // Windows PowerShell отдаёт NetworkCategory числом: 0 — Public, 1 — Private, 2 — Domain.
  assert.deepEqual(
    N.parseProfiles('[{"InterfaceAlias":"Wi-Fi","NetworkCategory":0},{"InterfaceAlias":"Ethernet","NetworkCategory":1},{"InterfaceAlias":"Домен","NetworkCategory":2}]'),
    [
      { alias: 'Wi-Fi', category: 'Public' },
      { alias: 'Ethernet', category: 'Private' },
      { alias: 'Домен', category: 'DomainAuthenticated' }
    ]
  );
  assert.deepEqual(N.parseProfiles('{"InterfaceAlias":"Wi-Fi","NetworkCategory":"0"}'), [{ alias: 'Wi-Fi', category: 'Public' }]);
  // UTF-16LE из Windows PowerShell через трубу.
  const utf16 = Buffer.from('{"InterfaceAlias":"Wi-Fi","NetworkCategory":"Public"}', 'utf16le');
  assert.deepEqual(N.parseProfiles(utf16), [{ alias: 'Wi-Fi', category: 'Public' }]);

  const profiles = [
    { alias: 'Ethernet', category: 'Private' },
    { alias: 'Wi-Fi', category: 'Public' }
  ];
  assert.equal(N.publicNet(profiles, 'Wi-Fi'), true);
  assert.equal(N.publicNet(profiles, 'Ethernet'), false);
  assert.equal(N.publicNet(profiles, 'Нет такого'), null);
  assert.equal(N.publicNet(profiles), true);
  assert.equal(N.publicNet(null), null);
  assert.equal(N.publicNet([]), null);
});

test('NETINFO: readProfiles — тайм-аут 5 с, ошибка → null', async () => {
  let seen = null;
  const good = await N.readProfiles({
    exec(file, args, options, cb) {
      seen = { file, args, options };
      cb(null, '[{"InterfaceAlias":"Wi-Fi","NetworkCategory":"Private"}]');
    }
  });
  assert.deepEqual(good, [{ alias: 'Wi-Fi', category: 'Private' }]);
  assert.equal(seen.file, 'powershell');
  assert.ok(seen.args.includes('-NoProfile'));
  assert.ok(seen.args.includes('-Command'));
  assert.equal(seen.options.timeout, 5000);

  assert.equal(await N.readProfiles({ exec: (f, a, o, cb) => cb(new Error('нет')) }), null);
  assert.equal(await N.readProfiles({ exec: () => { throw new Error('нет'); } }), null);
  assert.equal(await N.readProfiles({ exec: (f, a, o, cb) => cb(null, 'мусор') }), null);
});
