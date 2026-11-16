'use strict';
// Сеть ПК для режима Wi-Fi пульта: домашние IPv4-адреса и их сети, признаки VPN и
// виртуальных адаптеров, выбор адреса по умолчанию и профиль сети Windows.
// os.networkInterfaces() и запуск PowerShell передаются снаружи — функции чистые,
// тесты работают на образцах без Windows и без сети.

const os = require('node:os');
const { execFile } = require('node:child_process');

const PROFILE_CMD = 'Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory | ConvertTo-Json';
const PROFILE_TIMEOUT_MS = 5000;

// Имя адаптера, по которому видно туннель VPN (docs/REMOTE.md, «Режим Wi-Fi», п. 2).
const VPN_RE = /(wireguard|wintun|openvpn|vpn|tunnel)|(^|[^a-z])(tun|tap)([^a-z]|$)/i;
// Виртуальные адаптеры: их адреса телефону не предлагаем.
const VIRTUAL_RE = /(hyper-v|vethernet|virtualbox|vmware|wsl|virtual ethernet|loopback|pseudo)/i;
const HOME_NAME_RE = /(wi-?fi|wireless|беспровод|ethernet|локальная сеть)/i;

function ipv4Bytes(ip) {
  const s = String(ip || '');
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const out = [];
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function isIPv4(ip) {
  return !!ipv4Bytes(ip);
}

// Частные сети из задания: 10/8, 172.16/12, 192.168/16, 169.254/16.
function isPrivateIPv4(ip) {
  const b = ipv4Bytes(ip);
  if (!b) return false;
  if (b[0] === 10) return true;
  if (b[0] === 172 && b[1] >= 16 && b[1] <= 31) return true;
  if (b[0] === 192 && b[1] === 168) return true;
  if (b[0] === 169 && b[1] === 254) return true;
  return false;
}

function isLinkLocalIPv4(ip) {
  const b = ipv4Bytes(ip);
  return !!b && b[0] === 169 && b[1] === 254;
}

// Маска 255.255.255.0 → 24. Непрерывная маска обязательна, иначе -1.
function prefixOf(mask) {
  const b = ipv4Bytes(mask);
  if (!b) return -1;
  let bits = 0;
  let zero = false;
  for (const octet of b) {
    for (let i = 7; i >= 0; i--) {
      const one = (octet >> i) & 1;
      if (one) {
        if (zero) return -1;
        bits++;
      } else {
        zero = true;
      }
    }
  }
  return bits;
}

function netOf(ip, mask) {
  const a = ipv4Bytes(ip);
  const m = ipv4Bytes(mask);
  if (!a || !m) return '';
  const prefix = prefixOf(mask);
  if (prefix < 0) return '';
  const net = a.map((n, i) => n & m[i]);
  return net.join('.') + '/' + prefix;
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function scan(interfaces) {
  const ifaces = interfaces && typeof interfaces === 'object' ? interfaces : {};
  const all = [];
  const vpnNames = [];
  const virtualNames = [];

  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!Array.isArray(list)) continue;
    const vpnName = VPN_RE.test(name);
    const virtualName = VIRTUAL_RE.test(name);
    if (vpnName) vpnNames.push(name);
    if (virtualName) virtualNames.push(name);
    for (const rec of list) {
      if (!rec || rec.internal) continue;
      const family = rec.family;
      if (family !== 'IPv4' && family !== 4) continue;
      const ip = String(rec.address || '');
      if (!isIPv4(ip)) continue;
      all.push({
        ip,
        name,
        net: netOf(ip, rec.netmask),
        private: isPrivateIPv4(ip),
        linkLocal: isLinkLocalIPv4(ip),
        vpn: vpnName,
        virtual: virtualName
      });
    }
  }

  // Домашние адреса: частные, не link-local, не виртуальные и не туннели VPN.
  const addrs = all.filter((a) => a.private && !a.linkLocal && !a.virtual && !a.vpn);

  return {
    addrs,
    all,
    vpn: { pc: vpnNames.length > 0, names: unique(vpnNames) },
    virtual: unique(virtualNames)
  };
}

function rank(a) {
  let r = 0;
  if (a.linkLocal) r += 100;
  if (HOME_NAME_RE.test(a.name)) r -= 10;
  if (/^192\.168\./.test(a.ip)) r -= 3;
  else if (/^10\./.test(a.ip)) r -= 2;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.ip)) r -= 1;
  return r;
}

// Адрес по умолчанию: домашний адаптер, предпочтительно Wi-Fi/Ethernet и 192.168.x.x.
// Порядок одинаковых по весу адресов — как у os.networkInterfaces().
function pickDefault(addrs) {
  if (!Array.isArray(addrs) || !addrs.length) return null;
  return addrs.slice().sort((a, b) => rank(a) - rank(b))[0];
}

function findAddress(addrs, ip) {
  if (!Array.isArray(addrs) || typeof ip !== 'string' || !ip) return null;
  return addrs.find((a) => a.ip === ip) || null;
}

function describe(interfaces, chosenIp) {
  const state = scan(interfaces);
  const chosen = findAddress(state.addrs, chosenIp) || pickDefault(state.addrs);
  return {
    addrs: state.addrs,
    chosen,
    net: chosen ? chosen.net : '',
    vpn: state.vpn,
    virtual: state.virtual
  };
}

// Профиль сети Windows: только чтение, тайм-аут 5 с, ошибка → null.
// Windows PowerShell через трубу может отдать UTF-16LE — разбираем оба случая.
function decodeText(raw) {
  if (Buffer.isBuffer(raw)) {
    if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
      return raw.toString('utf16le').replace(/^\uFEFF/, '');
    }
    let zeros = 0;
    const limit = Math.min(raw.length, 200);
    for (let i = 1; i < limit; i += 2) if (raw[i] === 0) zeros++;
    if (raw.length > 8 && zeros >= Math.max(4, Math.floor(limit / 4))) {
      return raw.toString('utf16le').replace(/\u0000+$/, '');
    }
    return raw.toString('utf8');
  }
  const s = String(raw == null ? '' : raw).replace(/^\uFEFF/, '');
  return s.indexOf('\u0000') >= 0 ? s.replace(/\u0000/g, '') : s;
}

function parseProfiles(raw) {
  let json = null;
  try { json = JSON.parse(decodeText(raw)); } catch (e) { return null; }
  const list = Array.isArray(json) ? json : (json && typeof json === 'object' ? [json] : []);
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const alias = typeof p.InterfaceAlias === 'string' ? p.InterfaceAlias : '';
    const category = typeof p.NetworkCategory === 'string' ? p.NetworkCategory : '';
    if (alias || category) out.push({ alias, category });
  }
  return out;
}

function defaultExec(file, args, options, cb) {
  return execFile(file, args, options, cb);
}

function readProfiles(options = {}) {
  const run = typeof options.exec === 'function' ? options.exec : defaultExec;
  const timeout = Number(options.timeoutMs) || PROFILE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      run('powershell', ['-NoProfile', '-Command', PROFILE_CMD], { timeout, windowsHide: true, encoding: 'buffer' }, (err, stdout) => {
        if (err) return finish(null);
        finish(parseProfiles(stdout));
      });
    } catch (e) {
      finish(null);
    }
  });
}

// Сеть помечена «Общедоступная»? null — профиль неизвестен (не Windows или команда не ответила).
function publicNet(profiles, alias) {
  if (!Array.isArray(profiles)) return null;
  const want = String(alias || '').toLowerCase();
  let list = profiles;
  if (want) {
    list = profiles.filter((p) => {
      const a = String(p && p.alias || '').toLowerCase();
      return a && (a === want || want.indexOf(a) >= 0 || a.indexOf(want) >= 0);
    });
    if (!list.length) return null;
  }
  if (!list.length) return null;
  return list.some((p) => /^public$/i.test(String(p && p.category || '')));
}

module.exports = {
  PROFILE_CMD,
  PROFILE_TIMEOUT_MS,
  isIPv4,
  isPrivateIPv4,
  isLinkLocalIPv4,
  prefixOf,
  netOf,
  scan,
  pickDefault,
  findAddress,
  describe,
  parseProfiles,
  decodeText,
  readProfiles,
  publicNet
};
