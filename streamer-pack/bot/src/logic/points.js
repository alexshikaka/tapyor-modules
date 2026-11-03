'use strict';
// Заказы за баллы канала. Баллы Twitch списывает сразу, поэтому переспрашивать поздно:
// заказ висит «не выполнено», пока трек не заиграл; любой путь, где трек не прозвучал, — возврат баллов.

const replies = require('./replies');
const { Limiter } = require('./limiter');
const { trackLabel } = require('./pipeline');

class Points {
  // deps: { core, twitch: { fulfill(redemptionId), cancel(redemptionId) }, say, now, log, limiter, cfg: { accepting, pointsOn, replies } }
  constructor(cfg = {}, deps = {}) {
    this.cfg = { accepting: true, pointsOn: true, replies: {}, ...cfg };
    this.core = deps.core; this.twitch = deps.twitch;
    this.sayFn = deps.say || (async () => {});
    this.log = deps.log || (() => {});
    this.limiter = deps.limiter || new Limiter(3, 8000);
    this.byOrder = new Map(); // orderId → { redemptionId, user }
  }
  reply(key, vars) { const t = replies.make(key, vars, this.cfg.replies); if (t) return this.sayFn(t, {}); }

  async refund(r, reason) {
    try { await this.twitch.cancel(r.id); } catch (e) { this.log('бот: не вернул баллы — ' + (e.message || e)); }
    await this.reply('pointsCancel', { ник: r.user.login, причина: replies.REASONS[reason] || reason });
    return 'refund-' + reason;
  }

  // r: { id, at, input (текст зрителя), user: { id, login } }
  async handle(r) {
    if (!this.cfg.accepting || !this.cfg.pointsOn) return this.refund(r, 'closed');
    const res = await this.limiter.run(() => this.core.findOrder(r.input, { catalogsOnly: false }));
    const found = (res && res.value) || { level: 'none' };
    if (found.level === 'none' || !found.track) return this.refund(r, 'notFound');
    const rule = this.core.checkTrack(found.track);
    if (!rule.ok) return this.refund(r, rule.reason);
    const doubt = found.level !== 'exact'; // сомнение — ставим с пометкой стримеру, он решит
    const o = await this.core.orders.add({ prov: 'twitch-points', user: { id: r.user.id, login: r.user.login }, text: r.input, track: found.track, redemptionId: r.id, doubt, alts: found.alts || [] });
    this.byOrder.set(o.id, { redemptionId: r.id, user: r.user });
    if (doubt) await this.reply('pointsDoubt', { ник: r.user.login });
    return doubt ? 'queued-doubt' : 'queued';
  }

  // Трек заиграл — награда выполнена.
  async played(orderId) {
    const x = this.byOrder.get(orderId); if (!x) return false;
    this.byOrder.delete(orderId);
    try { await this.twitch.fulfill(x.redemptionId); } catch (e) { this.log('бот: не отметил награду — ' + (e.message || e)); }
    return true;
  }
  // Трек не прозвучал (убран, не заиграл) — вернуть баллы.
  async dropped(orderId, why = 'removed') {
    const x = this.byOrder.get(orderId); if (!x) return false;
    this.byOrder.delete(orderId);
    await this.refund({ id: x.redemptionId, user: x.user }, why);
    return true;
  }
}

module.exports = { Points, trackLabel };
