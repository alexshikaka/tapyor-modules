'use strict';
// Сборка бота: входы Twitch + соединения + логика + мост ядра.
// Ядро вызывает activate(core) один раз, если привратник разрешил модуль (см. docs/ARCHITECTURE.md).

const { scopesFor } = require('./twitch/config');
const { startDevice, Identity, validate } = require('./twitch/auth');
const { Helix } = require('./twitch/helix');
const { EventSub } = require('./twitch/eventsub');
const { Pipeline, DEFAULT_CFG } = require('./logic/pipeline');
const { Points } = require('./logic/points');
const { Tracker } = require('./logic/access');
const replies = require('./logic/replies');

const DEFAULT_SETTINGS = {
  ...DEFAULT_CFG,
  identity: 'self',         // self — пишет от имени стримера (по умолчанию); bot — от отдельного аккаунта
  pointsOn: true,
  reward: { title: 'Заказать песню', cost: 1000, prompt: 'Исполнитель — название или ссылка', color: '#FFB547', perUserPerStream: 2, cooldownSec: 0 },
  rewardId: null,
  banMin: 10,               // ⛔ у заказа «Твич»: на сколько минут закрыть зрителю заказы
  minTrackSec: 60,          // самый короткий трек (проверяет ядро)
  minViews: 5000,           // ссылки YouTube: минимум просмотров (проверяет ядро)
  sendIntervalMs: 1100      // не чаще одного сообщения в ~секунду — лимиты Twitch
};

// Журнал — человеческим языком (для окна «Ответы и журнал»). Тексты чата живут только в журнале, не в логе Тапёра.
const OUTCOME = {
  queued: 'поставил в очередь', choose: 'переспросил: варианты', notFound: 'не нашёл — подсказал', rules: 'не прошёл правила',
  closed: 'приём закрыт', offline: 'стрим не идёт', blocked: 'заблокирован — молча', timeout: 'тайм-аут ⛔', active: 'уже ждёт заказ',
  pause: 'пауза', perStream: 'лимит за стрим', noAccess: 'нет доступа', outsideEvent: 'вне события', empty: 'пустой заказ',
  queueFull: 'очередь полна', repeatWin: 'выиграл прошлое событие', shared: 'общий чат — чужой зритель',
  'event-ok': 'событие: заявка принята', 'event-fail': 'событие: не нашёл — подсказал', 'event-already': 'событие: заявка уже есть',
  'event-pending': 'событие: заявка ищется', 'event-closed': 'событие: уже закрыто',
  'queued-doubt': 'в очередь с пометкой «сомнение»', 'refund-notFound': 'не нашёл — баллы вернул', 'refund-closed': 'приём закрыт — баллы вернул'
};
function outcomeText(o) { return OUTCOME[o] || (String(o).startsWith('refund-') ? 'баллы вернул (' + o.slice(7) + ')' : o); }

// Режим имитации зрителей — ТОЛЬКО для проверок (TAPYOR_BOT_SIM=1 при запуске из исходников).
// Стример пишет в свой чат «#sim ник [vip] [mod] [sub] [follower] текст» — бот обрабатывает это как сообщение зрителя.
// «#simpts ник текст» — как взятую награду за баллы (Twitch не трогается: «выполнено»/возврат — только в журнал).
// «#simshared ник текст» — зритель из чужого канала в общем чате. Без переменной не работает вовсе.
const SIM = typeof process !== 'undefined' && process.env && process.env.TAPYOR_BOT_SIM === '1';
function parseSim(text) {
  const m = /^#(sim|simpts|simshared)\s+@?([a-z0-9_]{2,25})((?:\s+(?:vip|mod|sub|follower))*)\s+([\s\S]+)$/i.exec(String(text || '').trim());
  if (!m) return null;
  const roles = new Set(m[3].toLowerCase().split(/\s+/).filter(Boolean));
  return { kind: m[1].toLowerCase(), login: m[2].toLowerCase(), roles, text: m[4].trim() };
}

class Bot {
  // deps (для тестов): fetch, WebSocket, now, rnd, setTimer, clearTimer, makeEventSub
  constructor(core, deps = {}) {
    this.core = core;
    this.deps = deps;
    this.now = deps.now || Date.now;
    this.log = (t) => { this.journalAdd('sys', t); core.log && core.log('бот: ' + t); };
    this.journal = (core.journal && core.journal.load && core.journal.load()) || [];
    this.fetch = deps.fetch || globalThis.fetch;
    this.helix = new Helix({ fetch: this.fetch, log: this.log });
    this.outbox = []; this.sending = false;
    this.subs = [];
    this.channel = null; // { id, login }
    this.timers = [];
  }

  // ---------- настройки ----------
  settings() { return { ...DEFAULT_SETTINGS, ...(this.core.settings.get('bot') || {}) }; }
  async saveSettings(patch) {
    const s = { ...this.settings(), ...patch };
    this.core.settings.set('bot', s);
    if (this.pipeline) Object.assign(this.pipeline.cfg, s);
    if (this.points) Object.assign(this.points.cfg, { accepting: s.accepting, pointsOn: s.pointsOn, replies: s.replies });
    if ('accepting' in patch || 'pointsOn' in patch || 'reward' in patch) await this.syncReward().catch((e) => this.log('награда: ' + e.message));
    return s;
  }

  // ---------- журнал ----------
  journalAdd(kind, text) {
    this.journal.push({ at: this.now(), kind, text });
    if (this.journal.length > 300) this.journal.shift();
    if (this.core.journal && this.core.journal.append) this.core.journal.append(this.journal[this.journal.length - 1]);
  }

  // ---------- входы ----------
  ids() {
    const s = this.settings();
    const secure = this.core.secure, fetch = this.fetch, now = this.now, log = this.log;
    if (!this._ids || this._ids.mode !== s.identity) {
      const broadcaster = new Identity('broadcaster', { secure, fetch, now, log });
      const chat = s.identity === 'self' ? broadcaster : new Identity('bot', { secure, fetch, now, log });
      this._ids = { mode: s.identity, broadcaster, chat };
    }
    return this._ids;
  }

  // Начать вход: role — 'bot' или 'broadcaster'. Возвращает код и ссылку для окна; вход завершается сам.
  async login(role) {
    const s = this.settings(), { broadcaster, chat } = this.ids();
    const id = role === 'bot' ? chat : broadcaster;
    const roles = s.identity === 'self' ? ['chat', 'broadcaster'] : (role === 'bot' ? ['chat'] : ['broadcaster']);
    const flow = await startDevice({ scopes: scopesFor(roles), fetch: this.fetch, now: this.now, sleep: this.deps.sleep });
    this.core.openExternal(flow.verificationUri);
    flow.done = flow.wait().then(async (tokens) => { await id.signedIn(tokens); await this.restart(); return id.user; });
    flow.done.catch((e) => this.log('вход: ' + e.message));
    return flow;
  }
  async logout(role) {
    const { broadcaster, chat } = this.ids();
    await (role === 'bot' ? chat : broadcaster).clear();
    await this.restart();
  }

  // ---------- запуск ----------
  async start() {
    const s = this.settings();
    this.tracker = new Tracker(this.core.settings.get('botState') || undefined);
    const say = (text, o = {}) => this.say(text, o.replyTo);
    this.pipeline = new Pipeline(s, { core: this.core, say, now: this.now, rnd: this.deps.rnd, log: this.log, tracker: this.tracker });
    this.points = new Points({ accepting: s.accepting, pointsOn: s.pointsOn, replies: s.replies }, {
      core: this.core, say, log: this.log,
      twitch: { fulfill: (rid) => this.redemption(rid, 'FULFILLED'), cancel: (rid) => this.redemption(rid, 'CANCELED') }
    });
    this.core.on('order:played', (id) => { this.pipeline.orderPlayed(id); this.points.played(id); this.persist(); });
    // Заказ не прозвучал: стример убрал его из очереди или трек не включился. Пишем в журнал —
    // это видно во вкладке «Ответы и журнал», и лимит «активных» у зрителя освобождается.
    this.core.on('order:dropped', (id, why) => {
      const uid = this.pipeline.orders.get(id);
      const who = (uid != null && this.logins && this.logins.get(uid)) || '';
      this.pipeline.orderDropped(id);
      this.points.dropped(id, why);
      this.journalAdd('cmd', 'заказ' + (who ? ' ' + who : '') + ' не прозвучал — ' + (why === 'failed' ? 'трек не включился' : 'стример убрал'));
      this.persist();
    });
    // ⛔: у своего заказа (стримера) трек убирается, но тайм-аут не ставится.
    this.core.on('order:ban', (id, min) => {
      const uid = this.pipeline.orders.get(id);
      const user = { isBroadcaster: !!(this.channel && uid === this.channel.id) };
      if (this.pipeline.orderBan(id, min, user)) { this.journalAdd('ban', '⛔ тайм-аут ' + min + ' мин'); this.persist(); }
    });
    this.every(1000, () => this.pipeline.tick().catch((e) => this.log('событие: ' + e.message)));
    this.every(3600000, () => this.checkLogins());
    await this.connect();
  }

  every(ms, fn) { const set = this.deps.setInterval || setInterval; this.timers.push(set(fn, ms)); }
  persist() { this.core.settings.set('botState', this.tracker.serialize()); }

  async restart() { this.disconnect(); await this.connect(); }

  async connect() {
    const s = this.settings(), { broadcaster, chat } = this.ids();
    await broadcaster.load(); if (chat !== broadcaster) await chat.load();
    if (!chat.connected) { this.health('login', 'warn', 'не подключён', 'login'); return false; }
    this.channel = broadcaster.connected ? broadcaster.user : (s.channelLogin ? await this.helix.userByLogin(chat, s.channelLogin) : null);
    if (!this.channel) { this.health('login', 'warn', 'войди как стример или укажи канал', 'login'); return false; }
    this.health('login', 'ok', chat === broadcaster ? chat.user.login : chat.user.login + ' · ' + this.channel.login);

    try { this.pipeline.setOnline(await this.helix.isLive(chat, this.channel.id)); } catch (e) { this.log('статус стрима: ' + e.message); }

    const pointsHere = chat === broadcaster;
    this.subs.push(this.openSub(chat, async (sid) => {
      await this.helix.subscribe(chat, sid, 'channel.chat.message', '1', { broadcaster_user_id: this.channel.id, user_id: chat.user.id });
      await this.helix.subscribe(chat, sid, 'stream.online', '1', { broadcaster_user_id: this.channel.id });
      await this.helix.subscribe(chat, sid, 'stream.offline', '1', { broadcaster_user_id: this.channel.id });
      if (pointsHere) await this.subPoints(broadcaster, sid);
    }, 'chat'));
    if (!pointsHere && broadcaster.connected && s.pointsOn) this.subs.push(this.openSub(broadcaster, (sid) => this.subPoints(broadcaster, sid), 'points'));
    else if (!broadcaster.connected && s.pointsOn) this.health('points', 'warn', 'нужен вход стримера', 'login-broadcaster');
    return true;
  }

  async subPoints(broadcaster, sid) {
    if (!this.settings().pointsOn) return;
    // Баллы — необязательная часть: у канала без партнёрства/компаньонства Twitch отвечает 403.
    // Это не должно рвать чат и уводить EventSub в бесконечное переподключение.
    try {
      const rid = await this.syncReward();
      if (!rid) return;
      await this.helix.subscribe(broadcaster, sid, 'channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: broadcaster.user.id, reward_id: rid });
    } catch (e) {
      const noPoints = e && e.status === 403;
      this.health('points', 'warn', noPoints ? 'баллы канала недоступны (нужен компаньон или партнёр)' : 'не подписался', 'login-broadcaster');
      this.log('награда: ' + (e && e.message || e) + ' — чат продолжает работать');
    }
  }

  openSub(identity, subscribe, line) {
    const make = this.deps.makeEventSub || ((o) => new EventSub(o));
    const es = make({ subscribe, WebSocket: this.deps.WebSocket, log: this.log, setTimer: this.deps.setTimer, clearTimer: this.deps.clearTimer });
    es.on('state', (st) => {
      if (line === 'chat') this.health('chat', st === 'up' ? 'ok' : (st === 'down' ? 'bad' : 'warn'), { up: 'подключён', down: 'нет связи', connecting: 'подключаюсь…', reconnecting: 'переподключаюсь…', off: 'выключен' }[st] || st);
      if (line === 'points' && st === 'up') this.health('points', 'ok', 'награда активна');
    });
    es.on('subscribeError', (e) => { if (line === 'points' || e.status === 403) this.health('points', 'warn', e.status === 403 ? 'баллы канала недоступны (нужен компаньон или партнёр)' : 'не подписался', 'login-broadcaster'); });
    es.on('event', (type, ev) => this.onEvent(type, ev).catch((e) => this.log(type + ': ' + e.message)));
    es.start();
    return es;
  }

  disconnect() { for (const es of this.subs) es.stop(); this.subs = []; }
  async stop() {
    for (const t of this.timers) (this.deps.clearInterval || clearInterval)(t);
    this.timers = [];
    await this.setRewardPaused(true).catch(() => {});
    this.disconnect();
    if (this.tracker) this.persist();
  }

  async checkLogins() {
    const { broadcaster, chat } = this.ids();
    for (const id of new Set([chat, broadcaster])) {
      if (!id.connected) continue;
      try { const t = await id.token(); const v = await validate(t, { fetch: this.fetch }); if (!v) await id.token(true); }
      catch (e) { this.health(id === chat ? 'login' : 'points', 'warn', 'вход устарел — войди заново', id === chat ? 'login' : 'login-broadcaster'); }
    }
  }

  health(line, state, text, action) {
    this.lastHealth = this.lastHealth || {};
    this.lastHealth['bot.' + line] = { id: 'bot.' + line, state, text, action };
    this.core.health && this.core.health.set('bot.' + line, state, text, action);
  }

  // ---------- события Twitch ----------
  async onEvent(type, ev) {
    if (type === 'stream.online') { this.pipeline.setOnline(true); this.journalAdd('sys', 'стрим начался'); return; }
    if (type === 'stream.offline') { this.pipeline.setOnline(false); this.journalAdd('sys', 'стрим закончился'); return; }
    if (type === 'channel.chat.message') return this.onChat(ev);
    if (type === 'channel.channel_points_custom_reward_redemption.add') {
      const r = { id: ev.id, at: Date.parse(ev.redeemed_at) || this.now(), input: ev.user_input || '', user: { id: ev.user_id, login: ev.user_login } };
      const out = await this.points.handle(r);
      this.journalAdd('points', ev.user_login + ' · ' + r.input + ' → ' + outcomeText(out));
    }
  }

  // Сообщения обрабатываем последовательно: два заказа одного зрителя не должны
  // проскочить проверку лимита «активных» одновременно.
  onChat(ev) {
    const prev = this.chatChain || Promise.resolve();
    this.chatChain = prev.catch(() => {}).then(() => this._onChat(ev));
    return this.chatChain;
  }

  async _onChat(ev) {
    const { chat } = this.ids();
    if (SIM && (ev.chatter_user_id === (this.channel && this.channel.id))) {
      const sim = parseSim(ev.message && ev.message.text);
      if (sim) return this.onSim(sim, ev);
    }
    if (chat.user && ev.chatter_user_id === chat.user.id && chat.user.id !== this.channel.id) return; // сам бот
    const badges = new Set((ev.badges || []).map((b) => b.set_id));
    const user = {
      id: ev.chatter_user_id, login: ev.chatter_user_login,
      isBroadcaster: badges.has('broadcaster') || ev.chatter_user_id === this.channel.id,
      isMod: badges.has('moderator'), isVip: badges.has('vip'), isSub: badges.has('subscriber') || badges.has('founder'),
      followedAt: await this.followedAt(ev.chatter_user_id)
    };
    this.logins = this.logins || new Map(); this.logins.set(user.id, user.login);
    if (this.logins.size > 2000) this.logins.delete(this.logins.keys().next().value);
    const own = !ev.source_broadcaster_user_id || ev.source_broadcaster_user_id === this.channel.id;
    const text = (ev.message && ev.message.text) || '';
    const out = await this.pipeline.handle({ id: ev.message_id, at: this.now(), text, user, own });
    if (out !== 'ignore') { this.journalAdd('cmd', user.login + ' · ' + text + ' → ' + outcomeText(out)); this.persist(); }
  }

  async onSim(sim, ev) {
    const id = 'sim-' + sim.login, r = sim.roles;
    if (sim.kind === 'simpts') {
      const out = await this.points.handle({ id: 'sim-' + ev.message_id, at: this.now(), input: sim.text, user: { id, login: sim.login } });
      this.journalAdd('points', '[имитация] ' + sim.login + ' · ' + sim.text + ' → ' + outcomeText(out));
      return out;
    }
    const user = { id, login: sim.login, isBroadcaster: false, isMod: r.has('mod'), isVip: r.has('vip'), isSub: r.has('sub'),
      followedAt: r.has('follower') ? this.now() - 365 * 86400000 : null };
    const out = await this.pipeline.handle({ id: ev.message_id, at: this.now(), text: sim.text, user, own: sim.kind !== 'simshared' });
    this.journalAdd('cmd', '[имитация] ' + sim.login + ' · ' + sim.text + ' → ' + outcomeText(out));
    this.persist();
    return out;
  }

  // Фолловинг нужен, только если категория «Фолловеры» настроена иначе, чем «Зрители».
  async followedAt(userId) {
    const a = this.settings().access;
    const f = { ...a.follower }; delete f.minDays;
    if (JSON.stringify(f) === JSON.stringify(a.viewer)) return null;
    this.followCache = this.followCache || new Map();
    const c = this.followCache.get(userId);
    if (c && this.now() - c.t < 3600000) return c.v;
    const { broadcaster, chat } = this.ids();
    let v = null;
    try { v = await this.helix.followedAt(broadcaster.connected ? broadcaster : chat, this.channel.id, userId); } catch (e) { this.log('фолловинг: ' + e.message); }
    this.followCache.set(userId, { t: this.now(), v });
    return v;
  }

  // ---------- отправка ----------
  say(text, replyTo) {
    this.outbox.push({ text, replyTo });
    if (this.outbox.length > 30) this.outbox.shift(); // чат завалило — старое не шлём
    this.pump();
  }
  async pump() {
    if (this.sending) return;
    this.sending = true;
    const wait = this.deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    try {
      while (this.outbox.length) {
        const m = this.outbox.shift();
        try { await this.helix.send(this.ids().chat, this.channel.id, m.text, m.replyTo); this.journalAdd('say', m.text); }
        catch (e) { this.log('не отправил в чат: ' + e.message); }
        if (this.outbox.length) await wait(this.settings().sendIntervalMs);
      }
    } finally { this.sending = false; }
  }

  // ---------- награда ----------
  async syncReward() {
    const s = this.settings(), { broadcaster } = this.ids();
    if (!broadcaster.connected) return null;
    let rid = s.rewardId;
    if (rid && !(await this.helix.rewardExists(broadcaster, rid))) rid = null;
    const want = { ...s.reward, paused: !(s.accepting && s.pointsOn) };
    if (!rid) {
      rid = await this.helix.createReward(broadcaster, want);
      this.core.settings.set('bot', { ...s, rewardId: rid });
      this.log('награда «' + s.reward.title + '» создана');
    } else await this.helix.updateReward(broadcaster, rid, want);
    return rid;
  }
  async setRewardPaused(paused) {
    const s = this.settings(), { broadcaster } = this.ids();
    if (!s.rewardId || !broadcaster.connected) return;
    await this.helix.updateReward(broadcaster, s.rewardId, { paused });
  }
  async redemption(redemptionId, status) {
    if (String(redemptionId).startsWith('sim-')) { this.journalAdd('points', '[имитация] награда ' + (status === 'FULFILLED' ? 'выполнена' : 'отменена — баллы вернулись')); return; }
    const s = this.settings(), { broadcaster } = this.ids();
    await this.helix.setRedemption(broadcaster, s.rewardId, redemptionId, status);
  }

  // ---------- команды из окна настроек ----------
  async command(cmd, data = {}) {
    switch (cmd) {
      case 'status': {
        const { broadcaster, chat } = this.ids();
        return { chat: chat.user, broadcaster: broadcaster.user, channel: this.channel, online: this.pipeline && this.pipeline.online,
          event: this.pipeline && this.pipeline.round && this.pipeline.round.state !== 'done' ? { endsAt: this.pipeline.round.endsAt, entries: this.pipeline.round.count } : null,
          nextEventMin: this.pipeline && this.pipeline.scheduler.minutesLeft(this.now()) };
      }
      case 'settings': return this.settings();
      case 'health': return Object.values(this.lastHealth || {});
      case 'replyDefaults': return replies.DEFAULTS;
      case 'reward:sync': return this.syncReward();
      case 'save': return this.saveSettings(data);
      case 'login': { const f = await this.login(data.role); return { userCode: f.userCode, verificationUri: f.verificationUri, expiresIn: f.expiresIn }; }
      case 'logout': return this.logout(data.role);
      case 'event:open': return this.pipeline.openEvent();
      case 'event:skip': this.pipeline.scheduler.skipNext(); return true;
      case 'journal': return this.journal.slice(-200);
      case 'blocked': return this.tracker.blockedList();
      case 'block': this.tracker.block(data.id, data.login); this.persist(); return true;
      case 'unblock': this.tracker.unblock(data.id); this.persist(); return true;
      case 'timeouts': return this.tracker.timeouts(this.now()).map((t) => ({ ...t, login: (this.logins && this.logins.get(t.id)) || '' }));
      case 'blockLogin': {
        if (SIM && String(data.login || '').startsWith('sim:')) { const l = String(data.login).slice(4); this.tracker.block('sim-' + l, l); this.persist(); return true; } // имитация: «sim:ник»
        const u = await this.helix.userByLogin(this.ids().chat, String(data.login || '').replace(/^@/, ''));
        if (!u) throw new Error('нет такого зрителя на Twitch');
        this.tracker.block(u.id, u.login); this.persist(); return true;
      }
      case 'untimeout': this.tracker.clearTimeout(data.id); this.persist(); return true;
      default: throw new Error('неизвестная команда ' + cmd);
    }
  }
}

async function activate(core, deps) { const bot = new Bot(core, deps); await bot.start(); return bot; }

module.exports = { Bot, activate, DEFAULT_SETTINGS, outcomeText, parseSim };
