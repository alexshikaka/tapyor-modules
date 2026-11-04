'use strict';
// Постоянное соединение с Twitch (EventSub WebSocket): сообщения чата, взятые награды, начало и конец стрима.
// Одно соединение — один вход (бот или стример). Сам переподключается; переезд по session_reconnect — без потери подписок.

const { EventEmitter } = require('events');
const { EVENTSUB_URL } = require('./config');

class EventSub extends EventEmitter {
  // subscribe(sessionId) — вызывается после каждого нового приветствия, создаёт подписки.
  constructor({ subscribe, WebSocket = globalThis.WebSocket, url = EVENTSUB_URL, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    super();
    this.subscribeFn = subscribe; this.WS = WebSocket; this.url = url; this.log = log;
    this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.ws = null; this.sessionId = null; this.stopped = true; this.retry = 0; this.kaTimer = null; this.kaSec = 10;
    this.welcomeTimer = null; this.retryTimer = null;
    this.seen = new Set(); // id уведомлений: Twitch может прислать одно и то же дважды
  }

  start() { this.stopped = false; this.open(this.url, false); }
  stop() { this.stopped = true; this.clearTimer(this.kaTimer); this.clearTimer(this.welcomeTimer); this.clearTimer(this.retryTimer); if (this.ws) try { this.ws.close(); } catch (_) {} this.ws = null; this.setState('off'); }

  setState(s) { if (this.state !== s) { this.state = s; this.emit('state', s); } }

  open(url, isReconnect) {
    const ws = new this.WS(url);
    const prev = this.ws;
    this.ws = ws;
    this.setState(isReconnect ? 'reconnecting' : 'connecting');
    this.clearTimer(this.welcomeTimer);
    this.welcomeTimer = this.setTimer(() => { if (ws === this.ws) this.onDrop('welcome'); }, 15000);
    ws.onmessage = (ev) => this.onMessage(ws, ev.data, isReconnect, prev);
    ws.onclose = () => { if (ws === this.ws) this.onDrop('closed'); };
    ws.onerror = () => { if (ws === this.ws) this.log('Twitch: ошибка соединения'); };
  }

  armKeepalive() {
    this.clearTimer(this.kaTimer);
    // Тишина дольше keepalive + запас — соединение умерло.
    this.kaTimer = this.setTimer(() => this.onDrop('keepalive'), (this.kaSec + 5) * 1000);
  }

  onDrop(why) {
    if (this.stopped) return;
    this.clearTimer(this.kaTimer); this.clearTimer(this.welcomeTimer);
    try { this.ws && this.ws.close(); } catch (_) {}
    this.ws = null; this.sessionId = null;
    this.setState('down');
    const delay = Math.min(60000, 1000 * Math.pow(2, this.retry++));
    this.log('Twitch: соединение потеряно (' + why + '), переподключаюсь через ' + Math.round(delay / 1000) + ' с');
    this.clearTimer(this.retryTimer);
    this.retryTimer = this.setTimer(() => { if (!this.stopped) this.open(this.url, false); }, delay);
  }

  async onMessage(ws, raw, isReconnect, prev) {
    if (ws !== this.ws) return;
    this.clearTimer(this.welcomeTimer);
    let m; try { m = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch (_) { return; }
    const type = m.metadata && m.metadata.message_type;
    this.armKeepalive();
    if (type === 'session_welcome') {
      this.sessionId = m.payload.session.id;
      this.kaSec = m.payload.session.keepalive_timeout_seconds || 10;
      this.armKeepalive();
      if (isReconnect) { try { prev && prev.close(); } catch (_) {} this.retry = 0; this.setState('up'); return; } // подписки переехали сами
      try { await this.subscribeFn(this.sessionId); this.retry = 0; this.setState('up'); }
      catch (e) { this.log('Twitch: не удалось подписаться — ' + (e.message || e)); this.emit('subscribeError', e); this.onDrop('subscribe'); }
      return;
    }
    if (type === 'session_reconnect') { this.open(m.payload.session.reconnect_url, true); return; }
    if (type === 'notification') {
      const id = m.metadata.message_id;
      if (this.seen.has(id)) return;
      this.seen.add(id); if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
      this.emit('event', m.metadata.subscription_type, m.payload.event);
      return;
    }
    if (type === 'revocation') { this.log('Twitch: подписка отозвана — ' + (m.payload.subscription && m.payload.subscription.status)); this.emit('revoked', m.payload.subscription); }
  }
}

module.exports = { EventSub };
