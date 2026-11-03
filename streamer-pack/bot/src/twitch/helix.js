'use strict';
// Запросы к Twitch API (Helix). Токен берётся у Identity; на 401 — один раз обновляем вход и повторяем.

const { CLIENT_ID, API_URL } = require('./config');
const { TwitchError } = require('./auth');

class Helix {
  constructor({ fetch = globalThis.fetch, clientId = CLIENT_ID, log = () => {} } = {}) { this.fetch = fetch; this.clientId = clientId; this.log = log; }

  async call(identity, method, path, { query, body } = {}) {
    const url = API_URL + path + (query ? '?' + new URLSearchParams(query).toString() : '');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await identity.token(attempt > 0);
      const r = await this.fetch(url, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Client-Id': this.clientId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      if (r.status === 401 && attempt === 0) continue;
      if (r.status === 429 && attempt === 0) { // «слишком часто» — ждём, сколько просит Twitch, и пробуем ещё раз
        const reset = Number(r.headers && r.headers.get && r.headers.get('ratelimit-reset')) * 1000;
        const wait = Math.min(15000, Math.max(1000, reset ? reset - Date.now() : 2000));
        this.log('Twitch: слишком частые запросы, жду ' + Math.round(wait / 1000) + ' с');
        await new Promise((res) => setTimeout(res, wait)); continue;
      }
      let data = null; if (r.status !== 204) { try { data = await r.json(); } catch (_) { /* пусто */ } }
      if (!r.ok) throw new TwitchError((data && data.message) || ('Twitch ответил ' + r.status), r.status, data);
      return data;
    }
  }

  async userByLogin(identity, login) {
    const d = await this.call(identity, 'GET', '/users', { query: { login } });
    return d && d.data && d.data[0] ? { id: d.data[0].id, login: d.data[0].login, name: d.data[0].display_name } : null;
  }

  async isLive(identity, broadcasterId) {
    const d = await this.call(identity, 'GET', '/streams', { query: { user_id: broadcasterId } });
    return !!(d && d.data && d.data.length);
  }

  // Ответ в чат. replyTo — id сообщения зрителя (ответ «приклеен» к нему).
  async send(identity, broadcasterId, text, replyTo) {
    const body = { broadcaster_id: broadcasterId, sender_id: identity.user.id, message: String(text).slice(0, 500) };
    if (replyTo) body.reply_parent_message_id = replyTo;
    const d = await this.call(identity, 'POST', '/chat/messages', { body });
    const x = d && d.data && d.data[0];
    if (x && !x.is_sent) throw new TwitchError('Twitch не пропустил сообщение: ' + ((x.drop_reason && x.drop_reason.message) || 'без причины'), 200, x);
    return true;
  }

  // Когда зритель зафоловил канал; null — не фолловер.
  async followedAt(identity, broadcasterId, userId) {
    const d = await this.call(identity, 'GET', '/channels/followers', { query: { broadcaster_id: broadcasterId, user_id: userId } });
    const x = d && d.data && d.data[0];
    return x ? Date.parse(x.followed_at) : null;
  }

  // ---------- награда за баллы ----------
  rewardBody(r) {
    const b = {};
    if (r.title != null) b.title = r.title;
    if (r.cost != null) b.cost = r.cost;
    if (r.prompt != null) b.prompt = r.prompt;
    if (r.color != null) b.background_color = r.color;
    if (r.paused != null) b.is_paused = !!r.paused;
    if (r.perUserPerStream != null) { b.is_max_per_user_per_stream_enabled = r.perUserPerStream > 0; if (r.perUserPerStream > 0) b.max_per_user_per_stream = r.perUserPerStream; }
    if (r.cooldownSec != null) { b.is_global_cooldown_enabled = r.cooldownSec > 0; if (r.cooldownSec > 0) b.global_cooldown_seconds = r.cooldownSec; }
    return b;
  }
  async createReward(identity, r) {
    const body = { ...this.rewardBody(r), is_user_input_required: true };
    const d = await this.call(identity, 'POST', '/channel_points/custom_rewards', { query: { broadcaster_id: identity.user.id }, body });
    return d.data[0].id;
  }
  async updateReward(identity, rewardId, r) {
    await this.call(identity, 'PATCH', '/channel_points/custom_rewards', { query: { broadcaster_id: identity.user.id, id: rewardId }, body: this.rewardBody(r) });
  }
  // Есть ли ещё наша награда (стример мог удалить её на Twitch).
  async rewardExists(identity, rewardId) {
    const d = await this.call(identity, 'GET', '/channel_points/custom_rewards', { query: { broadcaster_id: identity.user.id, id: rewardId, only_manageable_rewards: 'true' } }).catch((e) => { if (e.status === 404) return null; throw e; });
    return !!(d && d.data && d.data.length);
  }
  // FULFILLED — «выполнено»; CANCELED — вернуть баллы.
  async setRedemption(identity, rewardId, redemptionId, status) {
    await this.call(identity, 'PATCH', '/channel_points/custom_rewards/redemptions', { query: { broadcaster_id: identity.user.id, reward_id: rewardId, id: redemptionId }, body: { status } });
  }

  // ---------- EventSub ----------
  async subscribe(identity, sessionId, type, version, condition) {
    return this.call(identity, 'POST', '/eventsub/subscriptions', { body: { type, version, condition, transport: { method: 'websocket', session_id: sessionId } } });
  }
}

module.exports = { Helix };
