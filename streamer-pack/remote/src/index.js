'use strict';
// Модуль «Пульт с телефона»: сессия в облаке, QR, снимок пульта и лента для страницы телефона.
// Ядро вызывает activate(core) — мост core.remote описан в docs/REMOTE.md.
// Команды модуля: status, start, stop, renew.

const relay = require('./relay');
const { RemoteSession } = require('./session');

class Remote {
  constructor(core, deps = {}) {
    this.core = core || {};
    const config = deps.config || relay.loadConfig(deps.relayFile);
    const page = deps.page || (config && config.page) || relay.DEFAULT_PAGE;
    const channel = deps.relay || relay.createRelay({
      url: config.url,
      page,
      fetch: deps.fetch,
      timeoutMs: deps.timeoutMs
    });
    this.session = new RemoteSession(this.core, Object.assign({}, deps, { relay: channel, page }));
  }

  status() {
    return this.session.status();
  }

  start() {
    return this.session.start();
  }

  stop() {
    return this.session.stop();
  }

  renew() {
    return this.session.renew();
  }

  async command(cmd, data = {}) {
    switch (cmd) {
      case 'status': return this.status();
      case 'start': return this.start();
      case 'stop': return this.stop();
      case 'renew': return this.renew();
      default: throw new Error('неизвестная команда пульта: ' + cmd);
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

module.exports = { Remote, activate, deactivate };
