'use strict';
// Жизнь сессии пульта: новая сессия в облаке, ключ, QR, опрос, снимок/лента,
// отбор команд телефона и события док-панели. Всё, что делает сеть, — через relay.
// Ядро даёт мост core.remote (docs/REMOTE.md): dock, feed, qr.

const nodeCrypto = require('./crypto');
const { snapForPhone, feedForPhone, signature } = require('./filter');
const { DEFAULT_PAGE } = require('./relay');

const MISSING_BRIDGE = 'Обнови Тапёр — пульту нужен Тапёр новее';
const NO_CLOUD = 'облако пульта не настроено';
const ENDED = 'Сессия закончилась — подключи телефон заново';
const NETWORK = 'нет связи с облаком пульта';

const WANT_WINDOW = 60 * 1000;          // телефон был меньше минуты назад — собираем снимок и ленту
const PHONE_MISSING = 60 * 1000;        // столько ждём телефон после показа QR (подсказка «не подключился»)
const PHONE_FAST = 30 * 1000;           // телефон на связи — опрос раз в секунду
const PHONE_SLOW = 2 * 60 * 60 * 1000;  // телефона нет два часа — опрос раз в 30 секунд
const MSG_OLD = 120 * 1000;             // команда старше двух минут — не выполняем
const MSG_FUTURE = 60 * 1000;           // команда из будущего больше минуты — не выполняем
const NONCE_KEEP = 1000;
const EVENT_KEEP = 30;
const EVENT_SEND = 10;
const RETRY_MIN = 2000;
const RETRY_MAX = 30000;

const STATE_TEXT = {
  idle: 'выключен',
  starting: 'запуск',
  waiting: 'ждём телефон',
  connected: 'телефон на связи',
  lost: 'нет связи с облаком',
  error: 'ошибка'
};

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// relay обычно отвечает { ok, data }, но поддельный мост в тестах может вернуть тело сразу.
function replyOk(res) {
  if (!res) return false;
  if (res.ok === true) return true;
  if (res.ok === false) return false;
  return !res.error;
}

function replyData(res) {
  if (!isObject(res)) return {};
  return isObject(res.data) ? res.data : res;
}

function shortStr(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function indexNum(v) {
  return Number.isSafeInteger(v) && v >= 0 && v <= 10000000 ? v : null;
}

// Белый список команд docs/DOCK2.md. Лишние поля не передаём, неверную форму — отбрасываем.
function bridgeCommand(o) {
  const c = o && o.c;
  switch (c) {
    case 'focus':
      return { kind: 'dock', cmd: { c: 'focus' } };
    case 'play':
    case 'remove':
    case 'ban':
    case 'next': {
      const i = indexNum(o.i);
      const key = shortStr(o.key, 300);
      return i == null || !key ? null : { kind: 'dock', cmd: { c, i, key } };
    }
    case 'move': {
      const i = indexNum(o.i);
      const key = shortStr(o.key, 300);
      const to = indexNum(o.to);
      return i == null || !key || to == null ? null : { kind: 'dock', cmd: { c, i, key, to } };
    }
    case 'mode':
      return o.m === 'classic' || o.m === 'live' ? { kind: 'dock', cmd: { c, m: o.m } } : null;
    case 'wave':
      return o.a === 'play' || o.a === 'auto' ? { kind: 'dock', cmd: { c, a: o.a } } : null;
    case 'tr':
      return o.a === 'prev' || o.a === 'playpause' || o.a === 'next' ? { kind: 'dock', cmd: { c, a: o.a } } : null;
    case 'search': {
      const q = shortStr(o.q, 200);
      const id = shortStr(o.id, 40);
      return q && id ? { kind: 'dock', cmd: { c, q, id } } : null;
    }
    case 'add':
    case 'playnow': {
      const r = shortStr(o.r, 200);
      return r ? { kind: 'dock', cmd: { c, r } } : null;
    }
    case 'rq': {
      if (!isObject(o.dataset)) return null;
      const out = {};
      const keys = ['rq', 'ri', 'id', 'act', 'ix'];
      for (const k of Object.keys(o.dataset)) {
        if (keys.indexOf(k) < 0) continue;
        const v = o.dataset[k];
        if (typeof v !== 'string' || v.length > 80) return null;
        out[k] = v;
      }
      return out.rq ? { kind: 'rq', dataset: out } : null;
    }
    case 'setting':
      return o.key === 'reqAuto' && typeof o.value === 'boolean'
        ? { kind: 'setting', key: 'reqAuto', value: o.value }
        : null;
    default:
      return null;
  }
}

function defaultSchedule(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t.unref) t.unref();
  return () => clearTimeout(t);
}

function phoneUrl(page, sid, key) {
  const base = typeof page === 'string' && page ? page : DEFAULT_PAGE;
  return (base.slice(-1) === '/' ? base : base + '/') + '#' + sid + '.' + key;
}

class RemoteSession {
  constructor(core, deps = {}) {
    this.core = core || {};
    this.deps = deps;
    this.crypto = deps.crypto || nodeCrypto;
    this.relay = deps.relay || null;
    this.page = deps.page || DEFAULT_PAGE;
    this.now = typeof deps.now === 'function' ? deps.now : Date.now;
    this.schedule = typeof deps.schedule === 'function' ? deps.schedule : defaultSchedule;
    const remote = this.core.remote && typeof this.core.remote === 'object' ? this.core.remote : null;
    this.remote = remote;
    this.dock = deps.dock || (remote && remote.dock) || null;
    this.feed = deps.feed || (remote && remote.feed) || null;
    this.qr = deps.qr || (remote && typeof remote.qr === 'function' ? remote.qr.bind(remote) : null);

    this.state = this.dock && this.feed ? 'idle' : 'error';
    this.error = this.dock && this.feed ? null : MISSING_BRIDGE;
    this.running = false;
    this.busy = false;
    this.wanted = null;

    this.sid = '';
    this.host = '';
    this.key = null;
    this.url = '';
    this.qrSvg = '';
    this.phoneAt = null;
    this.shownAt = null;      // когда показали QR: через минуту без телефона — подсказка phone-missing

    this.ack = 0;
    this.seen = [];
    this.seenSet = new Set();
    this.events = [];

    this.snapRaw = null;
    this.feedRaw = null;
    this.lastSnapSig = '';
    this.lastFeedSig = '';

    this.timer = null;
    this.unsubs = [];
    this.retryMs = RETRY_MIN;
  }

  log(line) {
    if (typeof this.core.log !== 'function') return;
    try { this.core.log('пульт: ' + line); } catch (e) { /* лог не должен ломать пульт */ }
  }

  setState(state, error) {
    const changed = this.state !== state;
    this.state = state;
    if (error !== undefined) this.error = error;
    if (changed) this.log(STATE_TEXT[state] || state);
  }

  setWant(on) {
    on = !!on;
    if (this.wanted === on) return;
    this.wanted = on;
    for (const bridge of [this.dock, this.feed]) {
      if (bridge && typeof bridge.want === 'function') {
        try { bridge.want(on); } catch (e) { /* мост ядра мог закрыться */ }
      }
    }
  }

  wantNow() {
    return this.phoneAt != null && this.now() - this.phoneAt < WANT_WINDOW;
  }

  status() {
    const ago = this.phoneAt == null ? null : Math.max(0, Math.round(this.now() - this.phoneAt));
    const waiting = this.shownAt == null ? null : Math.max(0, Math.round(this.now() - this.shownAt));
    return {
      state: this.state,
      phoneAgo: ago,
      url: this.url || '',
      qrSvg: this.qrSvg || '',
      error: this.error || null,
      hint: this.phoneAt == null && waiting != null && waiting >= PHONE_MISSING ? 'phone-missing' : null
    };
  }

  subscribe() {
    this.unsubscribe();
    if (this.dock && typeof this.dock.on === 'function') {
      const off = this.dock.on((x) => this.onDock(x));
      if (typeof off === 'function') this.unsubs.push(off);
    }
    if (this.feed && typeof this.feed.on === 'function') {
      const off = this.feed.on((x) => this.onFeed(x));
      if (typeof off === 'function') this.unsubs.push(off);
    }
  }

  unsubscribe() {
    for (const off of this.unsubs) {
      try { off(); } catch (e) { /* уже отписан */ }
    }
    this.unsubs = [];
  }

  onDock(x) {
    if (!isObject(x)) return;
    if (x.v === 1) { this.snapRaw = x; return; }
    if (x.ev === 'search' || x.ev === 'toast') {
      this.events.push(x);
      if (this.events.length > EVENT_KEEP) this.events = this.events.slice(-EVENT_KEEP);
    }
  }

  onFeed(x) {
    if (isObject(x)) this.feedRaw = x;
  }

  phoneAddress() {
    return phoneUrl(this.page, this.sid, this.crypto.b64u(this.key));
  }

  clearSession() {
    if (this.timer) {
      try { this.timer(); } catch (e) { /* уже снят */ }
    }
    this.timer = null;
    this.sid = '';
    this.host = '';
    this.key = null;
    this.url = '';
    this.qrSvg = '';
    this.phoneAt = null;
    this.shownAt = null;
    this.ack = 0;
    this.seen = [];
    this.seenSet = new Set();
    this.events = [];
    this.snapRaw = null;
    this.feedRaw = null;
    this.lastSnapSig = '';
    this.lastFeedSig = '';
  }

  async start() {
    if (this.running) return this.status();
    if (!this.dock || !this.feed) {
      this.setState('error', MISSING_BRIDGE);
      return this.status();
    }
    if (!this.relay || this.relay.configured === false) {
      this.setState('error', NO_CLOUD);
      return this.status();
    }

    this.running = true;
    this.busy = false;
    this.retryMs = RETRY_MIN;
    this.setState('starting', null);
    this.subscribe();
    this.setWant(false);

    let res;
    try { res = await this.relay.new(); }
    catch (e) { res = { ok: false, status: 0, code: 'network', error: NETWORK, retryable: true }; }

    if (!this.running) return this.status();
    if (!replyOk(res)) {
      this.running = false;
      this.unsubscribe();
      this.setWant(false);
      this.setState('error', (res && res.error) || NETWORK);
      return this.status();
    }

    const data = replyData(res);
    const sid = typeof data.sid === 'string' ? data.sid : '';
    const host = typeof data.host === 'string' ? data.host : '';
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(sid) || !/^[A-Za-z0-9_-]{10,128}$/.test(host)) {
      this.running = false;
      this.unsubscribe();
      this.setState('error', 'Облако пульта не выдало сессию');
      return this.status();
    }

    this.sid = sid;
    this.host = host;
    this.key = this.crypto.newKey();
    this.url = this.phoneAddress();
    this.qrSvg = '';
    if (this.qr) {
      try {
        const svg = this.qr(this.url);
        this.qrSvg = typeof svg === 'string' ? svg : '';
      } catch (e) {
        this.qrSvg = '';
      }
    }
    this.setState('waiting', null);
    this.shownAt = this.now();
    await this.pollOnce();
    return this.status();
  }

  async stop() {
    const sid = this.sid;
    const host = this.host;
    const relay = this.relay;
    this.running = false;
    this.busy = false;
    this.unsubscribe();
    this.setWant(false);
    this.clearSession();
    this.setState('idle', null);
    if (sid && host && relay && typeof relay.end === 'function') {
      try { await relay.end({ sid, host }); } catch (e) { /* сессия и так забыта */ }
    }
    return this.status();
  }

  async renew() {
    await this.stop();
    return this.start();
  }

  delay() {
    if (this.phoneAt == null) return 5000;
    const ago = this.now() - this.phoneAt;
    if (ago < PHONE_FAST) return 1000;
    if (ago < PHONE_SLOW) return 5000;
    return 30000;
  }

  arm(ms) {
    if (this.timer) {
      try { this.timer(); } catch (e) { /* уже снят */ }
    }
    this.timer = null;
    if (!this.running) return;
    const cancel = this.schedule(() => {
      this.timer = null;
      this.pollOnce().catch(() => {});
    }, Math.max(0, ms));
    this.timer = typeof cancel === 'function' ? cancel : null;
  }

  seal(kind, obj) {
    try {
      const piece = this.crypto.seal(this.key, this.sid, kind, obj);
      return typeof piece === 'string' && piece ? piece : null;
    } catch (e) {
      return null;
    }
  }

  wire() {
    const body = { sid: this.sid, host: this.host };
    let snapSig = '';
    let feedSig = '';
    if (this.snapRaw) {
      const snap = snapForPhone(this.snapRaw);
      if (snap) {
        const sig = signature(snap);
        if (sig !== this.lastSnapSig) {
          const piece = this.seal('s', snap);
          if (piece) { body.s = piece; snapSig = sig; }
        }
      }
    }
    if (this.feedRaw) {
      const feed = feedForPhone(this.feedRaw);
      const sig = signature(feed);
      if (sig !== this.lastFeedSig) {
        const piece = this.seal('f', feed);
        if (piece) { body.f = piece; feedSig = sig; }
      }
    }
    let evCount = 0;
    if (this.events.length) {
      const batch = this.events.slice(0, EVENT_SEND);
      const pieces = [];
      for (const ev of batch) {
        const piece = this.seal('e', ev);
        if (piece) pieces.push(piece);
      }
      if (pieces.length) body.ev = pieces;
      evCount = batch.length;     // не ушедшие куски после успеха тоже снимаем: сами они не соберутся
    }
    if (this.ack > 0) body.ack = this.ack;
    return { body, snapSig, feedSig, evCount, ackBefore: this.ack };
  }

  async pollOnce() {
    if (!this.running || this.busy) return;
    this.busy = true;
    let sent;
    try { sent = this.wire(); } catch (e) { sent = { body: { sid: this.sid, host: this.host }, evCount: 0, ackBefore: 0 }; }
    let res;
    try { res = await this.relay.host(sent.body); }
    catch (e) { res = { ok: false, status: 0, code: 'network', error: NETWORK, retryable: true }; }
    if (!this.running) { this.busy = false; return; }
    this.busy = false;

    if (!replyOk(res)) {
      if (res && (res.code === 'no-session' || res.status === 404 || res.error === 'no-session')) {
        this.running = false;
        this.unsubscribe();
        this.setWant(false);
        this.clearSession();
        this.setState('idle', ENDED);
        return;
      }
      this.setState('lost', (res && res.error) || NETWORK);
      this.setWant(false);
      this.arm(this.retryMs);
      this.retryMs = Math.min(RETRY_MAX, this.retryMs * 2);
      return;
    }

    const data = replyData(res);
    const hasPhone = data.phoneAgo !== undefined && data.phoneAgo !== null && Number.isFinite(Number(data.phoneAgo));
    if (hasPhone) {
      this.phoneAt = this.now() - Math.max(0, Number(data.phoneAgo));
      if (this.state !== 'connected') this.setState('connected', null);
    } else if (this.state === 'lost' || this.state === 'starting') {
      this.setState('waiting', null);
    }
    this.error = null;
    this.setWant(this.wantNow());

    if (sent.snapSig) this.lastSnapSig = sent.snapSig;
    if (sent.feedSig) this.lastFeedSig = sent.feedSig;
    if (sent.evCount) this.events.splice(0, sent.evCount);

    this.commands(data.cmds);
    if (this.ack === sent.ackBefore) this.ack = 0;

    this.retryMs = RETRY_MIN;
    this.arm(this.delay());
  }

  freshCommand(obj) {
    if (!isObject(obj)) return false;
    if (typeof obj.t !== 'number' || !Number.isFinite(obj.t)) return false;
    const t = obj.t;
    const now = this.now();
    if (now - t > MSG_OLD) return false;
    if (t - now > MSG_FUTURE) return false;
    if (typeof obj.n !== 'string' || !obj.n || obj.n.length > 64) return false;
    if (this.seenSet.has(obj.n)) return false;
    this.seen.push(obj.n);
    this.seenSet.add(obj.n);
    if (this.seen.length > NONCE_KEEP) {
      const old = this.seen.shift();
      this.seenSet.delete(old);
    }
    return true;
  }

  commands(list) {
    if (!Array.isArray(list)) return;
    const items = list
      .filter((x) => isObject(x) && Number.isSafeInteger(Number(x.seq)) && Number(x.seq) >= 0)
      .sort((a, b) => Number(a.seq) - Number(b.seq));
    for (const item of items) {
      this.ack = Math.max(this.ack, Number(item.seq));
      let obj = null;
      try { obj = this.crypto.open(this.key, this.sid, 'c', item.c); } catch (e) { obj = null; }
      if (!obj || !this.freshCommand(obj)) continue;
      const out = bridgeCommand(obj);
      if (!out) continue;
      try {
        if (out.kind === 'dock' && this.dock && typeof this.dock.cmd === 'function') this.dock.cmd(out.cmd);
        else if (out.kind === 'rq' && this.feed && typeof this.feed.rq === 'function') this.feed.rq(out.dataset);
        else if (out.kind === 'setting' && this.feed && typeof this.feed.setting === 'function') this.feed.setting(out.key, out.value);
      } catch (e) {
        /* неверную команду ядро всё равно не выполнит */ }
    }
  }
}

module.exports = {
  RemoteSession,
  bridgeCommand,
  phoneUrl,
  MISSING_BRIDGE,
  NO_CLOUD,
  ENDED,
  NETWORK,
  WANT_WINDOW,
  PHONE_MISSING,
  RETRY_MIN,
  RETRY_MAX
};
