'use strict';
// Событие заказов: короткий промежуток, когда заказывают категории с доступом «по событию».
// Scheduler решает, когда открыть; Round — одно событие: заявки, розыгрыш или «кто первый».

const MIN = 60000;

const DEFAULT_EVENT = {
  when: 'random',         // timer | random | afterEmpty | manual
  everyMin: 20,           // timer
  minMin: 15, maxMin: 25, // random
  afterEmptyMin: 3,       // afterEmpty: через сколько минут после того, как кончились заказы
  skipIfQueued: 5,        // не открывать само, если заказов «Твич» в очереди больше (0 — не проверять)
  durationSec: 60,
  method: 'raffle',       // raffle | first
  winners: 3,             // розыгрыш
  firstN: 10,             // кто первый
  noRepeatWin: true,      // не выигрывать два события подряд
  settleMs: 10000         // сколько ждать поиски, начатые до закрытия
};

class Scheduler {
  constructor(cfg = {}, rnd = Math.random) { this.cfg = { ...DEFAULT_EVENT, ...cfg }; this.rnd = rnd; this.nextAt = null; this.emptySince = null; this.skip = false; }

  // Запланировать следующее событие от момента now (после закрытия прошлого или при старте стрима).
  plan(now) {
    const c = this.cfg;
    if (c.when === 'timer') this.nextAt = now + c.everyMin * MIN;
    else if (c.when === 'random') this.nextAt = now + (c.minMin + this.rnd() * Math.max(0, c.maxMin - c.minMin)) * MIN;
    else this.nextAt = null;
    this.emptySince = null;
    return this.nextAt;
  }
  skipNext() { this.skip = true; }

  // Минут до следующего события (для ответа «следующее примерно через N мин»); null — неизвестно.
  minutesLeft(now) { return this.nextAt ? Math.max(1, Math.ceil((this.nextAt - now) / MIN)) : null; }

  // ctx: { online, accepting, twitchQueued, queueEmpty }. Возвращает true, если пора открыть.
  due(now, ctx) {
    const c = this.cfg;
    if (!ctx.online || !ctx.accepting || c.when === 'manual') return false;
    let due = false;
    if (c.when === 'afterEmpty') {
      if (!ctx.queueEmpty) { this.emptySince = null; return false; }
      if (this.emptySince == null) this.emptySince = now;
      due = now - this.emptySince >= c.afterEmptyMin * MIN;
    } else due = this.nextAt != null && now >= this.nextAt;
    if (!due) return false;
    if (this.skip || (c.skipIfQueued && ctx.twitchQueued > c.skipIfQueued)) { this.skip = false; this.plan(now); return false; }
    return true;
  }
}

// Ключ трека, чтобы двое с одной песней не выиграли оба.
function trackKey(t) {
  if (!t) return '';
  if (t.src && t.id) return t.src + ':' + t.id;
  return String((t.author || '') + '|' + (t.title || '')).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

class Round {
  constructor(cfg, now, seq) {
    this.cfg = { ...DEFAULT_EVENT, ...cfg };
    this.seq = seq;
    this.openedAt = now;
    this.endsAt = now + this.cfg.durationSec * 1000;
    this.state = 'open'; // open → settling → done
    this.closedAt = null;
    this.entries = [];   // { msgId, userId, login, at, status: 'pending'|'ok'|'fail', track, order }
    this.result = null;
  }
  isOpen(at) { return this.state === 'open' && at < this.endsAt; }
  hasAccepted(userId) { return this.entries.some((e) => e.userId === userId && e.status === 'ok'); }
  hasPending(userId) { return this.entries.some((e) => e.userId === userId && e.status === 'pending'); }
  get count() { return new Set(this.entries.map((e) => e.userId)).size; }
  get okCount() { return this.entries.filter((e) => e.status === 'ok').length; }

  // Заявка пришла. Время сообщения — at (по нему считается «кто первый»). false — не принимаем.
  submit(entry) {
    if (!this.isOpen(entry.at)) return { ok: false, why: 'closed' };
    if (this.hasAccepted(entry.userId)) return { ok: false, why: 'already' };   // принятую заявку не заменить
    if (this.hasPending(entry.userId)) return { ok: false, why: 'pending' };
    this.entries.push({ ...entry, status: 'pending', track: null });
    return { ok: true };
  }

  // Поиск по заявке закончился. ok — точно найдено и прошло правила.
  resolve(msgId, ok, track, order) {
    const e = this.entries.find((x) => x.msgId === msgId);
    if (!e || e.status !== 'pending') return;
    if (!ok) { e.status = 'fail'; return; }
    if (this.cfg.method === 'first') {
      const key = trackKey(track);
      if (this.entries.some((x) => x !== e && x.status === 'ok' && trackKey(x.track) === key && x.at < e.at)) { e.status = 'fail'; e.why = 'dupTrack'; return; }
    }
    e.status = 'ok'; e.track = track; e.order = order;
  }

  // «Кто первый»: победители по времени сообщения. final — можно закрыть досрочно.
  firstWinners() {
    const sorted = [...this.entries].sort((a, b) => a.at - b.at);
    const out = []; const keys = new Set();
    for (const e of sorted) {
      if (e.status === 'pending') return { winners: out, final: false };
      if (e.status !== 'ok' || keys.has(trackKey(e.track))) continue;
      keys.add(trackKey(e.track)); out.push(e);
      if (out.length >= this.cfg.firstN) return { winners: out, final: true };
    }
    return { winners: out, final: false };
  }

  close(now) { if (this.state === 'open') { this.state = 'settling'; this.closedAt = now; } }

  // Можно подводить итог: поиски досчитались или вышло время ожидания.
  ready(now) {
    if (this.state !== 'settling') return false;
    if (this.cfg.method === 'first' && this.firstWinners().final) return true; // десятка набрана — поздних не ждём
    return !this.entries.some((e) => e.status === 'pending') || now - this.closedAt >= this.cfg.settleMs;
  }

  // Итог события. excluded(userId) — нельзя выигрывать (выиграл прошлое). Шансы у всех равны.
  finish(rnd = Math.random, excluded = () => false) {
    for (const e of this.entries) if (e.status === 'pending') e.status = 'fail';
    let winners;
    if (this.cfg.method === 'first') winners = this.firstWinners().winners.filter((e) => !excluded(e.userId));
    else {
      const pool = this.entries.filter((e) => e.status === 'ok' && !excluded(e.userId));
      winners = []; const keys = new Set();
      while (pool.length && winners.length < this.cfg.winners) {
        const i = Math.floor(rnd() * pool.length);
        const [e] = pool.splice(i, 1);
        const k = trackKey(e.track);
        if (keys.has(k)) continue; // такой трек уже выиграл — тянем следующего
        keys.add(k); winners.push(e);
      }
    }
    this.state = 'done';
    this.result = { winners, total: this.count, ok: this.okCount };
    return this.result;
  }
}

module.exports = { DEFAULT_EVENT, Scheduler, Round, trackKey };
