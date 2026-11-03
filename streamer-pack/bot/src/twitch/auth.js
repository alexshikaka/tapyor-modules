'use strict';
// Вход через Twitch по коду устройства (Device Code Flow) — без секрета приложения и без локального сервера.
// Стример видит короткий код и ссылку, подтверждает на twitch.tv; Тапёр получает токены.
// Токены никогда не пишутся в лог и хранятся через core.secure (зашифрованно).

const { CLIENT_ID, ID_URL } = require('./config');

class TwitchError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

function form(obj) { return new URLSearchParams(obj).toString(); }

async function post(fetch, url, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(params) });
  let body = null; try { body = await r.json(); } catch (_) { /* пусто */ }
  return { status: r.status, ok: r.ok, body };
}

// Начать вход. Возвращает { userCode, verificationUri, expiresIn, wait() }.
// wait() ждёт подтверждения и возвращает токены { access, refresh, expiresAt, scopes }.
async function startDevice({ scopes, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, clientId = CLIENT_ID }) {
  const res = await post(fetch, ID_URL + '/device', { client_id: clientId, scopes: scopes.join(' ') });
  if (!res.ok) throw new TwitchError('Twitch не выдал код входа', res.status, res.body);
  const d = res.body;
  let cancelled = false;
  const wait = async () => {
    let interval = (d.interval || 5) * 1000;
    const deadline = now() + d.expires_in * 1000;
    while (!cancelled && now() < deadline) {
      await sleep(interval);
      if (cancelled) break;
      const t = await post(fetch, ID_URL + '/token', { client_id: clientId, scopes: scopes.join(' '), device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      if (t.ok) return toTokens(t.body, now);
      const msg = t.body && (t.body.message || t.body.error);
      if (msg === 'authorization_pending') continue;
      if (msg === 'slow_down') { interval += 5000; continue; }
      if (msg === 'invalid device code') throw new TwitchError('Код входа устарел — начни заново', t.status, t.body);
      throw new TwitchError('Twitch отклонил вход: ' + (msg || t.status), t.status, t.body);
    }
    throw new TwitchError(cancelled ? 'Вход отменён' : 'Код входа устарел — начни заново', 0);
  };
  return { userCode: d.user_code, verificationUri: d.verification_uri, expiresIn: d.expires_in, wait, cancel: () => { cancelled = true; } };
}

function toTokens(b, now = Date.now) {
  return { access: b.access_token, refresh: b.refresh_token, expiresAt: now() + (b.expires_in || 0) * 1000, scopes: b.scope || [] };
}

// Обновить вход. У общедоступного приложения refresh-токен одноразовый: сохранять новый.
async function refresh(tokens, { fetch = globalThis.fetch, now = Date.now, clientId = CLIENT_ID } = {}) {
  const res = await post(fetch, ID_URL + '/token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh });
  if (!res.ok) throw new TwitchError('Вход устарел — войди заново', res.status, res.body);
  return toTokens(res.body, now);
}

// Проверка токена (Twitch просит делать это раз в час). Возвращает { userId, login, scopes, expiresIn } или null.
async function validate(access, { fetch = globalThis.fetch } = {}) {
  const r = await fetch(ID_URL + '/validate', { headers: { Authorization: 'OAuth ' + access } });
  if (r.status === 401) return null;
  if (!r.ok) throw new TwitchError('Twitch не ответил на проверку входа', r.status);
  const b = await r.json();
  return { userId: b.user_id, login: b.login, scopes: b.scopes || [], expiresIn: b.expires_in };
}

// Хранилище одного входа (бот или стример) поверх core.secure. Само обновляет токен, когда он истекает.
class Identity {
  constructor(name, { secure, fetch = globalThis.fetch, now = Date.now, log = () => {} }) {
    this.name = name; this.secure = secure; this.fetch = fetch; this.now = now; this.log = log;
    this.tokens = null; this.user = null; this.refreshing = null;
  }
  key() { return 'twitch.' + this.name; }
  async load() {
    const raw = await this.secure.get(this.key());
    if (!raw) return false;
    try { const s = JSON.parse(raw); this.tokens = s.tokens; this.user = s.user; return true; } catch (_) { return false; }
  }
  async save() { await this.secure.set(this.key(), JSON.stringify({ tokens: this.tokens, user: this.user })); }
  async clear() { this.tokens = null; this.user = null; await this.secure.set(this.key(), ''); }
  get connected() { return !!(this.tokens && this.user); }

  async signedIn(tokens) {
    this.tokens = tokens;
    const v = await validate(tokens.access, { fetch: this.fetch });
    if (!v) throw new TwitchError('Twitch не принял вход', 401);
    this.user = { id: v.userId, login: v.login };
    await this.save();
    this.log('Twitch: вход ' + this.name + ' — ' + v.login);
    return this.user;
  }

  // Действующий токен; при необходимости обновляет. force — обновить сразу (получили 401).
  async token(force = false) {
    if (!this.tokens) throw new TwitchError('Нет входа (' + this.name + ')', 401);
    if (!force && this.tokens.expiresAt - this.now() > 60000) return this.tokens.access;
    if (!this.refreshing) {
      this.refreshing = refresh(this.tokens, { fetch: this.fetch, now: this.now })
        .then(async (t) => { this.tokens = t; await this.save(); return t.access; })
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
}

module.exports = { startDevice, refresh, validate, Identity, TwitchError };
