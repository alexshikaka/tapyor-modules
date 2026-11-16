'use strict';
// Модуль «Пульт с телефона»: сессия (в облаке или по домашней сети), QR, снимок пульта
// и лента для страницы телефона. Ядро вызывает activate(core) — мост core.remote описан
// в docs/REMOTE.md. Режим Wi-Fi поднимает свой сервер только пока идёт сессия.
// Команды модуля: status, start, stop, renew, mode, lan-ip.

const os = require('node:os');
const relay = require('./relay');
const netinfo = require('./netinfo');
const lanRelay = require('./lan-relay');
const { RemoteSession } = require('./session');

const NO_ADDRESS = 'не найден адрес в домашней сети';

class Remote {
  constructor(core, deps = {}) {
    this.core = core || {};
    this.deps = deps;
    this.now = typeof deps.now === 'function' ? deps.now : Date.now;
    const config = deps.config || relay.loadConfig(deps.relayFile);
    this.page = deps.page || (config && config.page) || relay.DEFAULT_PAGE;
    this.cloudRelay = deps.relay || relay.createRelay({
      url: config.url,
      page: this.page,
      fetch: deps.fetch,
      timeoutMs: deps.timeoutMs
    });

    this.mode = deps.mode === 'lan' || deps.mode === 'cloud' ? deps.mode : null;
    this.lanIp = typeof deps.lanIp === 'string' ? deps.lanIp : '';
    this.settings = deps.settings || (this.core.settings && typeof this.core.settings.get === 'function' ? this.core.settings : null);
    if (this.settings) {
      let saved = null;
      try { saved = this.settings.get('remote'); } catch (e) { saved = null; }
      if (saved && typeof saved === 'object') {
        if (!this.mode && (saved.mode === 'lan' || saved.mode === 'cloud')) this.mode = saved.mode;
        if (typeof deps.lanIp !== 'string' && typeof saved.lanIp === 'string') this.lanIp = saved.lanIp;
      }
    }
    if (!this.mode) this.mode = 'cloud';
    this.lanRun = null;
    this.public = null;
    this.createLan = typeof deps.createLan === 'function'
      ? deps.createLan
      : (options) => lanRelay.createLanServer(options);
    this.interfaces = typeof deps.networkInterfaces === 'function'
      ? deps.networkInterfaces
      : () => os.networkInterfaces();
    this.readProfiles = typeof deps.readProfiles === 'function'
      ? deps.readProfiles
      : () => netinfo.readProfiles();

    this.session = new RemoteSession(this.core, Object.assign({}, deps, {
      relay: this.cloudRelay,
      page: this.page
    }));
  }

  log(line) {
    if (typeof this.core.log !== 'function') return;
    try { this.core.log('пульт: ' + line); } catch (e) { /* лог не должен ломать пульт */ }
  }

  saveSettings() {
    if (!this.settings || typeof this.settings.set !== 'function') return;
    try { this.settings.set('remote', { mode: this.mode, lanIp: this.lanIp }); } catch (e) { /* настройки могли закрыться */ }
  }

  scanNet() {
    try {
      return netinfo.scan(this.interfaces());
    } catch (e) {
      return { addrs: [], all: [], vpn: { pc: false, names: [] }, virtual: [] };
    }
  }

  chosenAddress(state) {
    return netinfo.findAddress(state.addrs, this.lanIp) || netinfo.pickDefault(state.addrs);
  }

  // Профиль сети Windows нужен для подсказки «сеть помечена Общедоступной».
  async refreshPublic() {
    let profiles = null;
    try { profiles = await this.readProfiles(); } catch (e) { profiles = null; }
    const chosen = this.chosenAddress(this.scanNet());
    this.public = netinfo.publicNet(profiles, chosen ? chosen.name : '');
    return this.public;
  }

  async startLan() {
    if (this.lanRun) return this.lanRun;
    const state = this.scanNet();
    const chosen = this.chosenAddress(state);
    if (!chosen) {
      this.session.setState('error', NO_ADDRESS);
      return null;
    }
    this.lanIp = chosen.ip;
    const server = this.createLan({
      address: chosen.ip,
      interfaces: this.interfaces,
      pageDir: this.deps.pageDir,
      log: (line) => this.log(line)
    });
    let info = null;
    try {
      info = await server.start();
    } catch (e) {
      const text = e && e.message ? e.message : 'сервер не открылся';
      this.session.setState('error', text.indexOf(NO_ADDRESS) === 0 ? text : 'Не удалось открыть сервер по домашнему адресу: ' + text);
      return null;
    }
    const run = { server, info, channel: server.channel() };
    this.lanRun = run;
    this.lanIp = info.ip;
    await this.refreshPublic();
    return run;
  }

  async stopLan() {
    const run = this.lanRun;
    this.lanRun = null;
    this.session.relay = this.cloudRelay;
    this.session.page = this.page;
    if (!run) return;
    try { await run.server.stop(); } catch (e) { /* сервер уже закрыт */ }
  }

  status() {
    const base = this.session.status();
    const state = this.scanNet();
    const chosen = this.chosenAddress(state);
    const run = this.lanRun;
    return Object.assign(base, {
      lan: {
        on: this.mode === 'lan',
        url: run ? run.info.base : '',
        ip: run ? run.info.ip : (chosen ? chosen.ip : ''),
        net: run ? run.info.net : (chosen ? chosen.net : ''),
        port: run ? run.info.port : 0,
        vpn: { pc: !!state.vpn.pc, names: state.vpn.names.slice() },
        publicNet: this.public,
        selfOk: run && typeof run.info.selfOk === 'boolean' ? run.info.selfOk : null,
        addrs: state.addrs.map((a) => ({ ip: a.ip, name: a.name }))
      }
    });
  }

  async start() {
    if (this.mode === 'lan') {
      const run = await this.startLan();
      if (!run) return this.status();
      this.session.relay = run.channel;
      this.session.page = run.info.base + '/';
    } else {
      this.session.relay = this.cloudRelay;
      this.session.page = this.page;
    }
    await this.session.start();
    return this.status();
  }

  async stop() {
    await this.session.stop();
    await this.stopLan();
    return this.status();
  }

  async renew() {
    await this.stop();
    return this.start();
  }

  // Проверка адреса из списка домашних (телефону предлагаем только их).
  hasAddress(ip) {
    return !!netinfo.findAddress(this.scanNet().addrs, ip);
  }

  async command(cmd, data = {}) {
    switch (cmd) {
      case 'status': return this.status();
      case 'start': return this.start();
      case 'stop': return this.stop();
      case 'renew': return this.renew();
      case 'mode': {
        const mode = data && data.mode;
        if (mode !== 'cloud' && mode !== 'lan') throw new Error('режим пульта: cloud или lan');
        if (mode === this.mode) return this.status();
        await this.session.stop();
        await this.stopLan();
        this.mode = mode;
        this.saveSettings();
        if (mode === 'lan') await this.refreshPublic();
        return this.status();
      }
      case 'lan-ip': {
        const ip = data && data.ip;
        if (typeof ip !== 'string' || !this.hasAddress(ip)) throw new Error('такого домашнего адреса нет');
        if (ip === this.lanIp) return this.status();
        await this.stop();
        this.lanIp = ip;
        this.saveSettings();
        await this.refreshPublic();
        return this.status();
      }
      default:
        throw new Error('неизвестная команда пульта: ' + cmd);
    }
  }
}

let current = null;

async function activate(core, deps) {
  if (current) await current.stop();
  current = new Remote(core, deps);
  return current;
}

async function deactivate() {
  const r = current;
  current = null;
  if (r) await r.stop();
}

module.exports = { Remote, activate, deactivate, NO_ADDRESS };
