'use strict';
// Список облаков пульта: сессия открывается по порядку — на первом, кто ответил.
// Номер выбранного облака уходит в адрес телефона (#sid.ключ.номер). При потере
// облака сессии сессия заново открывается на следующем облаке (session.js).
// Сеть передаётся снаружи — тесты работают без неё.

const { createRelay, safeUrl } = require('./relay');

const NO_CLOUD = 'облако пульта не настроено';
const SID_RE = /^[A-Za-z0-9_-]{10,128}$/;

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function replyData(res) {
  if (!isObject(res)) return {};
  return isObject(res.data) ? res.data : res;
}

// Ответ годится, если облако выдало sid и host нужной формы.
function goodSession(res) {
  if (!res || res.ok === false || res.error) return false;
  const data = replyData(res);
  return typeof data.sid === 'string' && SID_RE.test(data.sid) &&
    typeof data.host === 'string' && SID_RE.test(data.host);
}

function createClouds(opts = {}) {
  const urls = [];
  for (const raw of Array.isArray(opts.urls) ? opts.urls : []) {
    const url = safeUrl(raw, true);
    if (url && urls.indexOf(url) < 0) urls.push(url);
  }
  const relays = urls.map((url) => createRelay({
    url,
    page: opts.page,
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs
  }));
  let index = 0;

  function at(i) {
    return relays[i] || null;
  }

  function current() {
    return at(index);
  }

  function noConfig() {
    return { ok: false, status: 0, code: 'no-config', error: NO_CLOUD };
  }

  // start — с какого облака начинать перебор (0 — с первого в списке).
  async function open(options) {
    if (!relays.length) return noConfig();
    const count = relays.length;
    const asked = options && Number.isSafeInteger(options.start) && options.start >= 0 ? options.start : 0;
    const start = asked % count;
    let failure = null;
    for (let k = 0; k < count; k++) {
      const i = (start + k) % count;
      let res;
      try {
        res = await relays[i].new();
      } catch (e) {
        res = { ok: false, status: 0, code: 'network', error: 'нет связи с облаком пульта', retryable: true };
      }
      if (goodSession(res)) {
        index = i;
        return res;
      }
      failure = res;
    }
    return failure || { ok: false, status: 0, code: 'network', error: 'нет связи с облаком пульта', retryable: true };
  }

  function unavailable() {
    return { ok: false, status: 0, code: 'no-config', error: NO_CLOUD };
  }

  return {
    configured: relays.some((r) => r.configured),
    urls: urls.slice(),
    count: urls.length,
    at,
    new: open,
    get index() { return index; },
    get url() { return urls[index] || ''; },
    host(body) {
      const relay = current();
      return relay ? relay.host(body) : Promise.resolve(unavailable());
    },
    end(body) {
      const relay = current();
      return relay ? relay.end(body) : Promise.resolve({ ok: true });
    }
  };
}

module.exports = { createClouds, goodSession, NO_CLOUD };
