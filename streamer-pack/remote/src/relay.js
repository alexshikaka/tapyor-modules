'use strict';
// Запросы к облачной функции пульта. Сеть и адрес передаются снаружи — тесты работают без сети.
// Адрес и адрес страницы лежат в streamer-pack/remote/relay.json.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PAGE = 'https://alexshikaka.github.io/tapyor-web/remote/';
const RELAY_FILE = path.join(__dirname, '..', 'relay.json');
const TIMEOUT_MS = 8000;

function safeUrl(value, allowHttp) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return '';
    if (!u.hostname || u.username || u.password) return '';
    return s.replace(/\/+$/, '');
  } catch (e) {
    return '';
  }
}

function loadConfig(file = RELAY_FILE, fsImpl = fs) {
  let raw = '';
  try { raw = fsImpl.readFileSync(file, 'utf8'); } catch (e) { return { url: '', page: DEFAULT_PAGE }; }
  let json = null;
  try { json = JSON.parse(raw); } catch (e) { return { url: '', page: DEFAULT_PAGE }; }
  if (!json || typeof json !== 'object') return { url: '', page: DEFAULT_PAGE };
  const url = safeUrl(json.url, true);
  let page = safeUrl(json.page, false);
  if (!page) page = DEFAULT_PAGE;
  if (page.slice(-1) !== '/') page += '/';
  return { url, page };
}

function friendly(code, status) {
  const c = String(code || '');
  if (c === 'no-session') return 'Сессия закончилась — подключи телефон заново';
  if (c === 'rate-limit' || status === 429) return 'Облако пульта просит подождать — повторю сам';
  if (c === 'too-big') return 'Кусок больше, чем принимает облако пульта';
  if (status >= 500) return 'Облако пульта временно не отвечает';
  if (c) return 'Облако пульта: ' + c.slice(0, 80);
  return 'Облако пульта ответило ошибкой' + (status ? ' (' + status + ')' : '');
}

function createRelay(opts = {}) {
  const url = safeUrl(opts.url, true);
  const fetchImpl = opts.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const timeoutMs = Math.max(100, Math.min(60000, Number(opts.timeoutMs) || TIMEOUT_MS));

  function noConfig() {
    return { ok: false, status: 0, code: 'no-config', error: 'облако пульта не настроено' };
  }

  async function call(op, options = {}) {
    if (!url) return noConfig();
    if (typeof fetchImpl !== 'function') return { ok: false, status: 0, code: 'network', error: 'нет доступа к сети', retryable: true };
    const method = options.method === 'GET' ? 'GET' : 'POST';
    const query = new URLSearchParams(Object.assign({ op }, options.query || {}));
    const target = url + (url.indexOf('?') >= 0 ? '&' : '?') + query.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (timer.unref) timer.unref();
    try {
      const res = await fetchImpl(target, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(options.body || {}),
        signal: controller.signal
      });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      const code = data && typeof data === 'object' ? (data.error || data.tapyor_error || '') : '';
      if (res.status === 404 && (code === 'no-session' || !code)) {
        return { ok: false, status: 404, code: 'no-session', error: friendly('no-session', 404) };
      }
      if (!res.ok || (data && typeof data === 'object' && data.error)) {
        return {
          ok: false,
          status: res.status,
          code: typeof code === 'string' && code ? code : 'http-' + res.status,
          error: friendly(code, res.status),
          retryable: res.status >= 500 || res.status === 429
        };
      }
      if (!data || typeof data !== 'object') {
        return { ok: false, status: res.status, code: 'bad-reply', error: 'Облако пульта ответило непонятно', retryable: true };
      }
      return { ok: true, status: res.status, data };
    } catch (e) {
      if (controller.signal.aborted) {
        return { ok: false, status: 0, code: 'timeout', error: 'Облако пульта не ответило вовремя', retryable: true };
      }
      return { ok: false, status: 0, code: 'network', error: 'нет связи с облаком пульта', retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    url,
    configured: !!url,
    timeoutMs,
    call,
    new: () => call('new', { method: 'POST', body: {} }),
    host: (body) => call('host', { method: 'POST', body: body || {} }),
    end: (body) => call('end', { method: 'POST', body: body || {} }),
    poll: (params) => call('poll', { method: 'GET', query: params || {} })
  };
}

module.exports = { DEFAULT_PAGE, RELAY_FILE, TIMEOUT_MS, loadConfig, createRelay, safeUrl };
