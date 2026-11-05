'use strict';
// Кто и когда может заказывать командой: категории зрителей, доступ, лимиты, ⛔ и блокировки.
// Лимиты общие для любого режима (всегда / по событию), свои у каждой категории.

const DAY = 86400000, MIN = 60000;

const DEFAULT_ACCESS = {
  viewer:   { access: 'event',  pauseMin: 30, perStream: 0 },
  follower: { access: 'event',  pauseMin: 30, perStream: 0, minDays: 7 },
  sub:      { access: 'event',  pauseMin: 30, perStream: 0 },
  vip:      { access: 'always', pauseMin: 15, perStream: 0 },
  mod:      { access: 'always', unlimited: true }
};
const ACCESS_RANK = { none: 0, event: 1, always: 2 };

// Готовые варианты «Приём: Всегда / По событию» — заполняют доступ всем категориям.
function preset(kind, base = DEFAULT_ACCESS) {
  const out = JSON.parse(JSON.stringify(base));
  if (kind === 'always' || kind === 'event') for (const k of Object.keys(out)) out[k].access = kind;
  return out;
}

// user: { id, login, isBroadcaster, isMod, isVip, isSub, followedAt (мс или null) }
function categoriesOf(user, table, now) {
  const cats = ['viewer'];
  const f = table.follower;
  if (user.followedAt && f && now - user.followedAt >= (f.minDays || 0) * DAY) cats.push('follower');
  if (user.isSub) cats.push('sub');
  if (user.isVip) cats.push('vip');
  if (user.isMod) cats.push('mod');
  return cats;
}

// Самая щедрая политика из всех ролей зрителя.
function policyFor(user, table = DEFAULT_ACCESS, now = Date.now()) {
  if (user.isBroadcaster) return { access: 'always', unlimited: true, cats: ['broadcaster'] };
  const cats = categoriesOf(user, table, now);
  const p = { access: 'none', unlimited: false, pauseMin: Infinity, perStream: -1, cats };
  for (const c of cats) {
    const t = table[c]; if (!t) continue;
    if ((ACCESS_RANK[t.access] || 0) > ACCESS_RANK[p.access]) p.access = t.access;
    if (t.unlimited) p.unlimited = true;
    p.pauseMin = Math.min(p.pauseMin, t.pauseMin != null ? t.pauseMin : Infinity);
    const ps = t.perStream || 0; // 0 — без ограничения
    p.perStream = p.perStream === -1 ? ps : (p.perStream === 0 || ps === 0 ? 0 : Math.max(p.perStream, ps));
  }
  if (!isFinite(p.pauseMin)) p.pauseMin = 0;
  if (p.perStream < 0) p.perStream = 0;
  return p;
}

// Учёт заказов зрителей. Состояние сохраняется (serialize/restore), чтобы ⛔ и блоки пережили перезапуск.
class Tracker {
  constructor(state) {
    this.users = new Map();   // id → { active: [orderId], lastOrderAt, lastPlayedAt, streamCount, timeoutUntil, wonSeq }
    this.blocked = new Map(); // id → login
    if (state) this.restore(state);
  }
  u(id) { let x = this.users.get(id); if (!x) { x = { active: [], lastOrderAt: 0, lastPlayedAt: 0, streamCount: 0, timeoutUntil: 0, wonSeq: -1 }; this.users.set(id, x); } return x; }

  isBlocked(id) { return this.blocked.has(id); }
  block(id, login) { this.blocked.set(id, login || ''); }
  unblock(id) { this.blocked.delete(id); }
  blockedList() { return [...this.blocked].map(([id, login]) => ({ id, login })); }

  timeout(id, minutes, now) { this.u(id).timeoutUntil = now + minutes * MIN; }
  clearTimeout(id) { this.u(id).timeoutUntil = 0; }
  timeoutLeftMin(id, now) { const x = this.users.get(id); return x && x.timeoutUntil > now ? Math.ceil((x.timeoutUntil - now) / MIN) : 0; }
  timeouts(now) { return [...this.users].filter(([, x]) => x.timeoutUntil > now).map(([id, x]) => ({ id, leftMin: Math.ceil((x.timeoutUntil - now) / MIN) })); }

  // Блок и ⛔ действуют всегда; один активный заказ — тоже всегда.
  // Пауза и лимит за стрим — только если limitsOn.
  // opts: { pauseFrom: 'played'|'ordered', limitsOn: boolean }
  check(user, policy, now, opts = {}) {
    if (this.isBlocked(user.id)) return { ok: false, why: 'blocked' };
    const left = this.timeoutLeftMin(user.id, now);
    if (left) return { ok: false, why: 'timeout', min: left };
    if (policy.unlimited) return { ok: true };
    const x = this.users.get(user.id);
    if (!x) return { ok: true };
    if (x.active.length >= 1) return { ok: false, why: 'active' };
    // Лимит за стрим не зависит от очереди и паузы — действует всегда.
    if (policy.perStream && x.streamCount >= policy.perStream) return { ok: false, why: 'perStream' };
    if (opts.limitsOn === false) return { ok: true };
    const from = opts.pauseFrom === 'ordered' ? x.lastOrderAt : x.lastPlayedAt;
    if (policy.pauseMin && from) {
      const until = from + policy.pauseMin * MIN;
      if (until > now) return { ok: false, why: 'pause', min: Math.ceil((until - now) / MIN) };
    }
    return { ok: true };
  }

  onQueued(id, orderId, now) { const x = this.u(id); x.active.push(orderId); x.lastOrderAt = now; x.streamCount++; }
  onPlayed(id, orderId, now) { const x = this.u(id); x.active = x.active.filter((o) => o !== orderId); x.lastPlayedAt = now; }
  onDropped(id, orderId) { const x = this.u(id); x.active = x.active.filter((o) => o !== orderId); }
  // Чистим «активные» заказы, которых уже нет в pending у ядра (например, очередь очистили
  // старой версией окна, и событие dropped не дошло). Возвращаем number удалённых id.
  reconcile(hasPending) {
    if (typeof hasPending !== 'function') return 0;
    let n = 0;
    for (const x of this.users.values()) {
      const before = x.active.length;
      x.active = x.active.filter((id) => hasPending(id));
      n += before - x.active.length;
    }
    return n;
  }

  markWin(id, seq) { this.u(id).wonSeq = seq; }
  wonLast(id, seq) { const x = this.users.get(id); return !!x && x.wonSeq === seq; }

  newStream() { for (const x of this.users.values()) { x.streamCount = 0; x.wonSeq = -1; } }

  serialize() { return { users: [...this.users], blocked: [...this.blocked] }; }
  restore(s) { this.users = new Map(s.users || []); this.blocked = new Map(s.blocked || []); }
}

module.exports = { DEFAULT_ACCESS, ACCESS_RANK, preset, categoriesOf, policyFor, Tracker };
