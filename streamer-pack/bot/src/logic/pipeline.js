'use strict';
// Путь заказа командой: сообщение чата → дешёвые проверки → поиск → правила → решение по режиму.
// Ни Twitch, ни Electron здесь нет: всё внешнее приходит через core (мост ядра) и say (ответ в чат).

const triggers = require('./triggers');
const replies = require('./replies');
const { DEFAULT_ACCESS, policyFor, Tracker } = require('./access');
const { DEFAULT_EVENT, Scheduler, Round } = require('./event');
const { Limiter } = require('./limiter');

const DEFAULT_CFG = {
  triggers: triggers.DEFAULT_TRIGGERS,
  accepting: true,          // главный выключатель приёма
  commandsOn: true,         // заказы командой включены
  onlyLive: true,           // только во время стрима
  sharedChat: 'own',        // own — только свои зрители в общем чате; all — все
  approval: 'auto',         // auto — сразу в очередь; manual — через подтверждение стримера
  access: DEFAULT_ACCESS,
  pauseFrom: 'played',      // played | ordered
  limitsFromQueue: 5,       // лимиты включаются, когда заказов «Твич» в очереди не меньше (0 — всегда)
  queueCap: 10,             // больше — «очередь полна»
  chatMaxQueue: 100,        // сколько сообщений чата максимум ждёт разбора
  chatMaxCommands: 60,      // глобальный лимит команд за окно
  chatWindowMs: 10000,      // окно глобального лимита
  chatUserCooldownMs: 3000, // один заказ зрителя не чаще
  choiceTtlSec: 60,         // сколько ждём ответ «1)/2)»
  maxChoices: 2,
  event: DEFAULT_EVENT,
  replies: {}               // свои тексты/выключатели ответов
};

function trackLabel(t) { return t ? (t.author ? t.author + ' — ' : '') + (t.title || '') : ''; }
// Одно слово: принимаем, только если в нём читаются и исполнитель, и название.
// «кино_мама_анархия» и «пикникегиптянин» — да; «Human» и «Upast» — нет.
function compactWord(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
}
function bothInOneWord(query, track) {
  if (!track || !track.author || !track.title) return false;
  const q = compactWord(query), a = compactWord(track.author), t = compactWord(track.title);
  if (!q || !a || !t) return false;
  // Нужны обе части: запрос начинается с исполнителя и заканчивается названием.
  return q.length >= a.length + t.length && q.startsWith(a) && q.endsWith(t);
}


class Pipeline {
  // deps: { core, say(text, { replyTo }), now(), rnd(), log(text), limiter }
  constructor(cfg = {}, deps = {}) {
    this.cfg = { ...DEFAULT_CFG, ...cfg, event: { ...DEFAULT_EVENT, ...(cfg.event || {}) } };
    this.core = deps.core;
    this.sayFn = deps.say || (async () => {});
    this.now = deps.now || Date.now;
    this.rnd = deps.rnd || Math.random;
    this.log = deps.log || (() => {});
    this.limiter = deps.limiter || new Limiter(3, 8000);
    this.tracker = deps.tracker || new Tracker();
    this.scheduler = new Scheduler(this.cfg.event, this.rnd);
    this.online = false;
    this.round = null;
    this.seq = 0;
    this.lastSeq = -1;       // номер последнего закрытого события (для «не выигрывать два подряд»)
    this.choices = new Map(); // userId → { options, expires, user, msgId, text }
    this.orders = new Map();  // orderId → userId
    this.clarify = new Map(); // userId → { expires, msgId } — ждём уточнение однословного заказа
  }

  reply(key, vars, replyTo) {
    const text = replies.make(key, vars, this.cfg.replies);
    if (text) return this.sayFn(text, { replyTo });
  }

  // ---------- стрим ----------
  setOnline(on) {
    const was = this.online; this.online = !!on;
    if (on && !was) { this.tracker.newStream(); this.scheduler.plan(this.now()); }
  }

  twitchQueued() { return this.core.orders.count('twitch-cmd'); }

  // Ранний отказ до followedAt и поиска: очередь уже полна, искать нечего.
  queueFullFor(u) {
    if (!u || u.isBroadcaster) return false;
    const policy = policyFor(u, this.cfg.access, this.now());
    return !policy.unlimited && this.cfg.queueCap && this.twitchQueued() >= this.cfg.queueCap;
  }

  // Повторная проверка перед выбором «1)/2)»: пока зритель думал, приём могли закрыть,
  // стрим закончиться, а лимит — снова стать активным.
  choiceBlock(u, c, at) {
    if (!c.accepting || !c.commandsOn) return 'closed';
    if (c.onlyLive && !this.online && !u.isBroadcaster) return 'offline';
    const policy = policyFor(u, c.access, at);
    const limitsOn = !c.limitsFromQueue || this.twitchQueued() >= c.limitsFromQueue;
    const chk = this.tracker.check(u, policy, at, { pauseFrom: c.pauseFrom, limitsOn });
    if (!chk.ok) return chk.why;
    return '';
  }

  // ---------- сообщение чата ----------
  // msg: { id, at, text, own (из своего канала), user: { id, login, isBroadcaster, isMod, isVip, isSub, followedAt } }
  async handle(msg) {
    const c = this.cfg, u = msg.user, at = msg.at || this.now();
    if (msg.own === false && c.sharedChat !== 'all') return 'shared';

    // Ответ на «1)/2)»
    const pend = this.choices.get(u.id);
    if (pend) {
      if (pend.expires <= at) this.choices.delete(u.id);
      else {
        const n = triggers.parseChoice(msg.text, c.triggers, pend.options.length);
        if (n) {
          const block = this.choiceBlock(u, c, at);
          if (block) {
            const key = { timeout: 'timeout', active: 'active', pause: 'pause', perStream: 'perStream' }[block] || block;
            this.reply(key, { ник: u.login }, msg.id);
            return block;
          }
          this.choices.delete(u.id);
          return this.enqueue(u, pend.options[n - 1], pend.msgId, pend.text);
        }
      }
    }

    // Уточнение после однословного заказа: следующая строка того же зрителя —
    // это уже запрос, команду повторять не нужно. Ждём не дольше минуты.
    let p = null, fromClarify = false;
    const cl = this.clarify.get(u.id);
    if (cl) {
      if (cl.expires <= at) this.clarify.delete(u.id);
      else if (/^(отмена|cancel)$/i.test(String(msg.text || '').trim())) {
        this.clarify.delete(u.id); this.reply('clarifyCancel', { ник: u.login }, msg.id); return 'clarifyCancel';
      } else {
        this.clarify.delete(u.id);
        p = triggers.parse(msg.text, c.triggers);
        if (!p) { p = { kind: 'clarify', query: String(msg.text || '').trim(), trigger: '' }; fromClarify = true; }
      }
    }
    if (!p) p = triggers.parse(msg.text, c.triggers);
    if (!p) return 'ignore';
    const silent = p.kind === 'word'; // слова без «!» — ставим только точное, на ошибки молчим
    const r = (key, vars) => (silent ? null : this.reply(key, { ник: u.login, ...vars }, msg.id));

    if (!c.accepting || !c.commandsOn) { r('closed'); return 'closed'; }
    if (c.onlyLive && !this.online && !u.isBroadcaster) { r('offline'); return 'offline'; }

    const policy = policyFor(u, c.access, at);
    const limitsOn = !c.limitsFromQueue || this.twitchQueued() >= c.limitsFromQueue;
    const chk = this.tracker.check(u, policy, at, { pauseFrom: c.pauseFrom, limitsOn });
    if (!chk.ok) {
      if (chk.why === 'blocked') { if (!silent) this.reply('blocked', { ник: u.login }, msg.id); return 'blocked'; }
      const key = { timeout: 'timeout', active: 'active', pause: 'pause', perStream: 'perStream' }[chk.why];
      r(key, { мин: chk.min }); return chk.why;
    }
    if (policy.access === 'none') { r('noAccess'); return 'noAccess'; }

    const eventOpen = !!this.round && this.round.isOpen(at);
    if (policy.access === 'event' && !eventOpen) {
      const left = this.scheduler.minutesLeft(at);
      r(left ? 'outsideEvent' : 'outsideEventNoTime', { мин: left }); return 'outsideEvent';
    }
    if (!p.query) { r('notFound'); return 'empty'; }

    if (policy.access === 'event') return this.eventEntry(msg, u, p, silent, policy);
    return this.alwaysOrder(msg, u, p, silent, policy, fromClarify);
  }

  async search(query, catalogsOnly) {
    const res = await this.limiter.run(() => this.core.findOrder(query, { catalogsOnly }));
    if (res.timeout) { this.log('поиск не уложился в 8 с'); return { level: 'none' }; } // текст зрителя в лог не пишем
    if (res.error) { this.log('бот: поиск — ' + (res.error.message || res.error)); return { level: 'none' }; }
    return res.value || { level: 'none' };
  }

  async alwaysOrder(msg, u, p, silent, policy, fromClarify) {
    const r = (key, vars) => (silent ? null : this.reply(key, { ник: u.login, ...vars }, msg.id));
    if (!policy.unlimited && this.cfg.queueCap && this.twitchQueued() >= this.cfg.queueCap) { r('queueFull'); return 'queueFull'; }
    const found = await this.search(p.query, false);
    // Ссылка — не «одно слово»: она идёт в прямой resolve, а не в уточнение.
    const isLink = !!(p.links && p.links.length) || /^https?:\/\//i.test(String(p.query || '').trim());
    const oneWord = !isLink && String(p.query || '').trim().split(/\s+/).filter(Boolean).length === 1;
    const allFound = [found.track, ...(found.alts || [])].filter(Boolean);
    const combined = oneWord ? allFound.filter((t) => bothInOneWord(p.query, t)) : [];
    if (oneWord && !combined.length) {
      // Одно слово без «исполнитель + название» не угадываем — просим пояснить.
      this.clarify.set(u.id, { expires: this.now() + 60000, msgId: msg.id });
      r('clarify', { ник: u.login });
      return 'clarify';
    }
    if (oneWord && found.level !== 'none' && (found.level !== 'exact' || (found.alts && found.alts.length))) {
      this.clarify.set(u.id, { expires: this.now() + 60000, msgId: msg.id });
      r('clarify', { ник: u.login });
      return 'clarify';
    }
    if (found.level === 'exact') {
      // Битый ответ источника не должен превращаться в заказ с track=null.
      if (!found.track) { r('notFound'); return 'notFound'; }
      const rule = this.core.checkTrack(found.track);
      if (!rule.ok) { r('rules', { причина: replies.REASONS[rule.reason] || rule.reason }); return 'rules'; }
      return this.enqueue(u, found.track, msg.id, msg.text);
    }
    if (found.level === 'doubt' && !silent) {
      const opts = [found.track, ...(found.alts || [])].filter(Boolean)
        .filter((t) => !oneWord || combined.includes(t))
        .filter((t) => this.core.checkTrack(t).ok).slice(0, this.cfg.maxChoices);
      if (opts.length === 1) return this.enqueue(u, opts[0], msg.id, msg.text);
      if (opts.length > 1) {
        this.choices.set(u.id, { options: opts, expires: msg.at + this.cfg.choiceTtlSec * 1000, msgId: msg.id, text: msg.text });
        const list = opts.map((t, i) => (i + 1) + ') ' + trackLabel(t)).join(' ');
        await this.reply('choose', { ник: u.login, варианты: list }, msg.id);
        return 'choose';
      }
    }
    r('notFound'); return 'notFound';
  }

  async enqueue(u, track, msgId, text) {
    const manual = this.cfg.approval === 'manual';
    let res;
    try {
      res = await this.core.orders.add({ prov: 'twitch-cmd', user: { id: u.id, login: u.login }, text, track, msgId, needsApproval: manual });
    } catch (e) {
      this.log('бот: заказ не создан — ' + (e && e.message || e));
      return 'error';
    }
    this.orders.set(res.id, u.id);
    this.tracker.onQueued(u.id, res.id, this.now());
    if (manual) await this.reply('awaiting', { ник: u.login, трек: trackLabel(track) }, msgId);
    else await this.reply('queued', { ник: u.login, трек: trackLabel(track), время: replies.fmtTime(res.etaSec), место: res.place }, msgId);
    return 'queued';
  }

  // ---------- событие ----------
  async eventEntry(msg, u, p, silent) {
    const round = this.round;
    if (this.cfg.event.noRepeatWin && this.tracker.wonLast(u.id, this.lastSeq)) {
      if (!silent) await this.reply('repeatWin', { ник: u.login }, msg.id);
      return 'repeatWin';
    }
    const s = round.submit({ msgId: msg.id, userId: u.id, login: u.login, at: msg.at, text: msg.text });
    if (!s.ok) return 'event-' + s.why; // уже есть заявка — молча
    const found = await this.search(p.query, true);
    let ok = found.level === 'exact', why = 'notFound';
    if (ok) { const rule = this.core.checkTrack(found.track); if (!rule.ok) { ok = false; why = rule.reason; } }
    round.resolve(msg.id, ok, found.track, { user: u, text: msg.text, msgId: msg.id });
    if (!ok && !silent) {
      if (why === 'notFound') await this.reply('notFoundEvent', { ник: u.login }, msg.id);
      else await this.reply('rules', { ник: u.login, причина: replies.REASONS[why] || why }, msg.id);
    }
    // «Кто первый»: набралось — закрываем досрочно
    if (this.cfg.event.method === 'first' && round.state === 'open' && round.firstWinners().final) {
      round.close(this.now()); await this.tick();
    }
    return ok ? 'event-ok' : 'event-fail';
  }

  async openEvent() {
    if (this.round && this.round.state !== 'done') return false;
    const now = this.now();
    this.round = new Round(this.cfg.event, now, ++this.seq);
    this.scheduler.nextAt = null;
    await this.reply('eventOpen', { сек: this.cfg.event.durationSec });
    return true;
  }

  // Вызывать раз в секунду: открывает событие по расписанию, закрывает и подводит итог.
  async tick() {
    const now = this.now();
    const rd = this.round;
    if (rd && rd.state === 'open' && now >= rd.endsAt) rd.close(now);
    if (rd && rd.state === 'settling' && rd.ready(now)) {
      const res = rd.finish(this.rnd, (id) => this.cfg.event.noRepeatWin && this.tracker.wonLast(id, this.lastSeq));
      this.lastSeq = rd.seq;
      const names = [];
      for (const e of res.winners) {
        const o = e.order;
        await this.enqueueSilent(o.user, e.track, o.msgId, o.text);
        this.tracker.markWin(o.user.id, rd.seq);
        names.push('@' + o.user.login + ' — ' + trackLabel(e.track));
      }
      if (names.length) await this.reply('eventResult', { заявок: res.total, победители: names.join(', ') });
      else await this.reply('eventEmpty', {});
      this.scheduler.plan(now);
      return 'finished';
    }
    if ((!rd || rd.state === 'done') && this.scheduler.due(now, {
      online: this.online, accepting: this.cfg.accepting && this.cfg.commandsOn,
      twitchQueued: this.twitchQueued(), queueEmpty: this.core.orders.count('any') === 0
    })) { await this.openEvent(); return 'opened'; }
    return null;
  }

  async enqueueSilent(user, track, msgId, text) {
    let res;
    try {
      res = await this.core.orders.add({ prov: 'twitch-cmd', user: { id: user.id, login: user.login }, text, track, msgId, needsApproval: this.cfg.approval === 'manual' });
    } catch (e) {
      this.log('бот: заказ не создан — ' + (e && e.message || e));
      return null;
    }
    this.orders.set(res.id, user.id);
    this.tracker.onQueued(user.id, res.id, this.now());
    return res;
  }

  // Отмена своего заказа: только последний активный заказ этого зрителя.
  cancelByUser(userId) {
    const mine = [...this.orders].filter(([, uid]) => uid === userId);
    if (!mine.length) return null;
    const [id] = mine[mine.length - 1];
    try { if (this.core.orders && this.core.orders.remove) this.core.orders.remove(id); } catch (e) {}
    this.tracker.onDropped(id);
    this.orders.delete(id);
    return id;
  }

  // ---------- события очереди от ядра ----------
  orderPlayed(orderId) { const id = this.orders.get(orderId); if (id != null) { this.tracker.onPlayed(id, orderId, this.now()); this.orders.delete(orderId); } }
  orderDropped(orderId) { const id = this.orders.get(orderId); if (id != null) { this.tracker.onDropped(id, orderId); this.orders.delete(orderId); } }
  // ⛔ у заказа «Твич»: трек уже убран ядром, зритель — в тайм-аут. На стримера не действует:
  // его заказ просто уходит из учёта, без тайм-аута (иначе стример закрывал бы заказы сам себе).
  orderBan(orderId, minutes, user) {
    const id = this.orders.get(orderId);
    if (id == null) return false;
    this.tracker.onDropped(id, orderId); this.orders.delete(orderId);
    if (user && user.isBroadcaster) return false;
    this.tracker.timeout(id, minutes, this.now());
    return true;
  }
}

module.exports = { Pipeline, DEFAULT_CFG, trackLabel };
