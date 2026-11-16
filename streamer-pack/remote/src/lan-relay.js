'use strict';
// Сервер режима Wi-Fi пульта: та же логика ящика, что у облачной функции
// (server/yc-remote/core.js в ядре), хранилище в памяти и раздача страницы телефона.
// Слушает только адрес домашнего адаптера (не 0.0.0.0 и не 127.0.0.1 в работе),
// порт 47660 или следующий свободный до 47679. Принимает только частные адреса.
// В лог — только вид действия, без sid, ключа и содержимого.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const netinfo = require('./netinfo');

const PORT_FIRST = 47660;
const PORT_LAST = 47679;
const MAX_BODY = 512 * 1024;

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_EVENTS = 30;
const MAX_CMDS = 50;
const MAX_S = 65536;
const MAX_EV_PIECE = 16384;
const MAX_EV = 10;
const MAX_C = 2048;
const CMD_WINDOW_MS = 10 * 1000;
const CMD_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const SID_RE = /^[A-Za-z0-9_-]{22}$/;
const HOST_RE = /^[A-Za-z0-9_-]{43}$/;
const PIECE_RE = /^[A-Za-z0-9_-]*$/;

const PAGE_FILES = {
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/remote.css': ['remote.css', 'text/css; charset=utf-8'],
  '/remote.js': ['remote.js', 'text/javascript; charset=utf-8'],
  '/crypto.js': ['crypto.js', 'text/javascript; charset=utf-8'],
  '/aes-gcm.js': ['aes-gcm.js', 'text/javascript; charset=utf-8'],
  '/render-dock.js': ['render-dock.js', 'text/javascript; charset=utf-8'],
  '/poll-plan.js': ['poll-plan.js', 'text/javascript; charset=utf-8'],
  '/phone-extras.js': ['phone-extras.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png']
};

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const ok = (body) => ({ status: 200, body, headers: {} });
const fail = (status, error, headers) => ({ status, body: { error }, headers: headers || {} });
const bad = () => fail(400, 'bad_request');
const slow = (sec) => fail(429, 'rate', { 'Retry-After': String(sec) });

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
}

// CORS нужен только странице телефона: poll и cmd.
function withCors(op, res) {
  if (op !== 'poll' && op !== 'cmd') return res;
  return { status: res.status, body: res.body, headers: Object.assign(corsHeaders(), res.headers || {}) };
}

function piece(v, max) { return typeof v === 'string' && v.length <= max && PIECE_RE.test(v); }

function qint(v) {
  if (v === undefined) return 0;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function qget(q, k) {
  return q && typeof q === 'object' && has(q, k) ? q[k] : undefined;
}

function hostHash(host) { return nodeCrypto.createHash('sha256').update(String(host), 'utf8').digest(); }

function hostMatches(row, host) {
  if (!row || typeof row.host_hash !== 'string' || !row.host_hash) return false;
  const want = Buffer.from(row.host_hash, 'hex');
  const got = hostHash(host);
  if (want.length !== got.length) return false;
  return nodeCrypto.timingSafeEqual(want, got);
}

function stale(row, now) {
  if (!row) return true;
  const at = Number(row.host_at) || 0;
  return !(at > now - SESSION_TTL_MS);
}

// Лимит частоты в памяти: скользящее окно, как в облаке (server/common/rate.js).
function createLimiter(limit, windowMs) {
  const hits = new Map();
  return {
    wait(key, now) {
      if (!key) return 0;
      const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
      const list = (hits.get(key) || []).filter((x) => x > t - windowMs);
      if (list.length >= limit) {
        hits.set(key, list);
        return Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000));
      }
      list.push(t);
      hits.set(key, list);
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (!v.length || v[v.length - 1] <= t - windowMs) hits.delete(k);
      }
      return 0;
    },
    reset() { hits.clear(); }
  };
}

function hostBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const sid = body.sid, host = body.host;
  if (typeof sid !== 'string' || !SID_RE.test(sid)) return null;
  if (typeof host !== 'string' || !HOST_RE.test(host)) return null;
  if (has(body, 's') && !piece(body.s, MAX_S)) return null;
  if (has(body, 'f') && !piece(body.f, MAX_S)) return null;
  let ev = [];
  if (has(body, 'ev')) {
    if (!Array.isArray(body.ev) || body.ev.length > MAX_EV) return null;
    for (const e of body.ev) if (!piece(e, MAX_EV_PIECE)) return null;
    ev = body.ev;
  }
  if (has(body, 'ack') && !Number.isInteger(body.ack)) return null;
  return { sid, host, ev };
}

// Хранилище в памяти: update() атомарен на одну сессию (очередь промисов, как в core.js).
function memoryStore() {
  const rows = new Map();
  const locks = new Map();
  const clone = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);

  return {
    async get(sid) { return rows.has(sid) ? clone(rows.get(sid)) : null; },
    async put(row) { rows.set(row.sid, clone(row)); },
    async del(sid) { rows.delete(sid); },
    async update(sid, fn) {
      const prev = locks.get(sid) || Promise.resolve();
      let release;
      const mine = new Promise((r) => { release = r; });
      const chain = prev.then(() => mine);
      locks.set(sid, chain);
      await prev;
      try {
        const cur = rows.has(sid) ? clone(rows.get(sid)) : null;
        const next = await fn(cur);
        if (next) rows.set(sid, clone(next)); else rows.delete(sid);
        return next ? clone(next) : null;
      } finally {
        release();
        if (locks.get(sid) === chain) locks.delete(sid);
      }
    }
  };
}

// Логика ящика: op, method, query, body, ip, store, now → { status, body, headers }.
function createCore(store) {
  const rateNew = createLimiter(10, RATE_WINDOW_MS);
  // 16.11: опрос по Wi-Fi — до 7 раз в секунду (телефон 0,15–0,3 с, Тапёр 0,12 с); прежние 800 за 10 мин
  // кончались за 4 минуты — «Нет связи с Тапёром». Сервер только в домашней сети — запас щедрый.
  const ratePhone = createLimiter(12000, RATE_WINDOW_MS);
  const rateHost = createLimiter(12000, RATE_WINDOW_MS);
  const cmdHits = new Map();

  function cmdSlot(sid, now) {
    const win = now - CMD_WINDOW_MS;
    const list = (cmdHits.get(sid) || []).filter((t) => t > win);
    if (list.length >= CMD_LIMIT) { cmdHits.set(sid, list); return false; }
    list.push(now);
    cmdHits.set(sid, list);
    if (cmdHits.size > 5000) {
      for (const [k, v] of cmdHits) if (!v.length || v[v.length - 1] <= win) cmdHits.delete(k);
    }
    return true;
  }

  // Постоянная ссылка Wi-Fi (16.11): та же сессия после перезапуска Тапёра — с прежними sid и host.
  async function restoreSession(sid, host, now) {
    if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(sid)) return fail(400, 'bad_request');
    if (typeof host !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(host)) return fail(400, 'bad_request');
    const cur = await store.get(sid);
    if (cur && cur.host_hash !== hostHash(host).toString('hex')) return fail(403, 'forbidden');
    if (!cur) {
      await store.put({
        sid, host_hash: hostHash(host).toString('hex'),
        s: '', sv: 0, f: '', fv: 0, ev: [], es: 0, cmds: [], cs: 0,
        host_at: now, phone_at: 0, exp: now + SESSION_TTL_MS
      });
    }
    return ok({ sid, host, ttl: SESSION_TTL_MS });
  }

  async function opNew(now) {
    const sid = nodeCrypto.randomBytes(16).toString('base64url');
    const host = nodeCrypto.randomBytes(32).toString('base64url');
    await store.put({
      sid,
      host_hash: hostHash(host).toString('hex'),
      s: '', sv: 0,
      f: '', fv: 0,
      ev: [], es: 0,
      cmds: [], cs: 0,
      host_at: now,
      phone_at: 0,
      exp: now + SESSION_TTL_MS
    });
    return ok({ sid, host, ttl: SESSION_TTL_MS });
  }

  async function opHost(body, now) {
    const v = hostBody(body);
    if (!v) return bad();
    let notFound = false, forbidden = false;
    const row = await store.update(v.sid, (cur) => {
      if (stale(cur, now)) { notFound = true; return null; }
      if (!hostMatches(cur, v.host)) { forbidden = true; return cur; }
      if (has(body, 's')) { cur.s = body.s; cur.sv = (Number(cur.sv) || 0) + 1; }
      if (has(body, 'f')) { cur.f = body.f; cur.fv = (Number(cur.fv) || 0) + 1; }
      if (v.ev.length) {
        const list = Array.isArray(cur.ev) ? cur.ev : [];
        let seq = Number(cur.es) || 0;
        for (const e of v.ev) { seq += 1; list.push({ seq, e }); }
        cur.es = seq;
        cur.ev = list.slice(-MAX_EVENTS);
      }
      if (has(body, 'ack')) {
        cur.cmds = (Array.isArray(cur.cmds) ? cur.cmds : []).filter((c) => Number(c.seq) > body.ack);
      }
      cur.host_at = now;
      cur.exp = now + SESSION_TTL_MS;
      return cur;
    });
    if (notFound) return fail(404, 'no-session');
    if (forbidden) return fail(403, 'forbidden');
    const phoneAgo = Number(row.phone_at) ? now - Number(row.phone_at) : null;
    return ok({ cmds: Array.isArray(row.cmds) ? row.cmds : [], phoneAgo });
  }

  async function opPoll(query, now) {
    const sid = qget(query, 'sid');
    if (typeof sid !== 'string' || !SID_RE.test(sid)) return bad();
    const sv = qint(qget(query, 'sv'));
    const fv = qint(qget(query, 'fv'));
    const es = qint(qget(query, 'es'));
    if (sv === null || fv === null || es === null) return bad();

    let notFound = false;
    const row = await store.update(sid, (cur) => {
      if (stale(cur, now)) { notFound = true; return null; }
      cur.phone_at = now;
      return cur;
    });
    if (notFound) return fail(404, 'no-session');

    const out = {
      sv: Number(row.sv) || 0,
      fv: Number(row.fv) || 0,
      ev: (Array.isArray(row.ev) ? row.ev : []).filter((e) => Number(e.seq) > es),
      hostAgo: now - (Number(row.host_at) || 0)
    };
    if (out.sv > sv) out.s = typeof row.s === 'string' ? row.s : '';
    if (out.fv > fv) out.f = typeof row.f === 'string' ? row.f : '';
    return ok(out);
  }

  async function opCmd(body, now) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad();
    const sid = body.sid, c = body.c;
    if (typeof sid !== 'string' || !SID_RE.test(sid)) return bad();
    if (!piece(c, MAX_C)) return bad();
    if (!cmdSlot(sid, now)) return slow(Math.ceil(CMD_WINDOW_MS / 1000));

    let notFound = false;
    await store.update(sid, (cur) => {
      if (stale(cur, now)) { notFound = true; return null; }
      const seq = (Number(cur.cs) || 0) + 1;
      cur.cs = seq;
      const cmds = Array.isArray(cur.cmds) ? cur.cmds : [];
      cmds.push({ seq, c });
      cur.cmds = cmds.slice(-MAX_CMDS);
      return cur;
    });
    if (notFound) return fail(404, 'no-session');
    return ok({ ok: true });
  }

  async function opEnd(body, now) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad();
    const sid = body.sid, host = body.host;
    if (typeof sid !== 'string' || !SID_RE.test(sid)) return bad();
    if (typeof host !== 'string' || !HOST_RE.test(host)) return bad();

    let notFound = false, forbidden = false;
    await store.update(sid, (cur) => {
      if (stale(cur, now)) { notFound = true; return null; }
      if (!hostMatches(cur, host)) { forbidden = true; return cur; }
      return null;
    });
    if (notFound) return fail(404, 'no-session');
    if (forbidden) return fail(403, 'forbidden');
    return ok({ ok: true });
  }

  async function handle(op, method, query, body, ip, now) {
    const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const name = String(op || '');
    const how = String(method || '').toUpperCase();

    if (how === 'OPTIONS') return { status: 204, body: null, headers: corsHeaders() };

    if (name === 'new') {
      if (how !== 'POST') return fail(405, 'method');
      const wait = rateNew.wait(ip, at);
      if (wait) return slow(wait);
      return opNew(at);
    }
    if (name === 'host') {
      if (how !== 'POST') return fail(405, 'method');
      const wait = rateHost.wait(ip, at);
      if (wait) return slow(wait);
      return opHost(body, at);
    }
    if (name === 'poll') {
      if (how !== 'GET') return withCors('poll', fail(405, 'method'));
      const wait = ratePhone.wait(ip, at);
      if (wait) return withCors('poll', slow(wait));
      return withCors('poll', await opPoll(query, at));
    }
    if (name === 'cmd') {
      if (how !== 'POST') return withCors('cmd', fail(405, 'method'));
      const wait = ratePhone.wait(ip, at);
      if (wait) return withCors('cmd', slow(wait));
      return withCors('cmd', await opCmd(body, at));
    }
    if (name === 'end') {
      if (how !== 'POST') return fail(405, 'method');
      return opEnd(body, at);
    }
    return bad();
  }

  function resetRates() {
    rateNew.reset();
    ratePhone.reset();
    rateHost.reset();
    cmdHits.clear();
  }

  return { handle, store, resetRates, restore: restoreSession };
}

function cleanIp(ip) {
  const s = String(ip || '');
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return m ? m[1] : s;
}

// Только частные сети (и локальный адрес — для самопроверки и тестов).
function isPrivateClient(remote) {
  const ip = cleanIp(remote);
  if (!ip) return false;
  if (ip === '::1' || /^127\./.test(ip)) return true;
  if (netinfo.isPrivateIPv4(ip)) return true;
  return /^fd[0-9a-f]{2}:/i.test(ip);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too big'), { code: 'too_big' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createLanServer(options = {}) {
  const pageDir = path.resolve(options.pageDir || path.join(__dirname, '..', 'page'));
  const nowFn = typeof options.now === 'function' ? options.now : Date.now;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const core = createCore(options.store || memoryStore());
  let appCss = null;   // стили окна Тапёра, взятые у его локального сервера (один раз)

  let server = null;
  let info = null;

  function sendJson(res, status, body, headers) {
    const data = body == null ? '' : JSON.stringify(body);
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }, headers || {}));
    res.end(data);
  }

  function sendText(res, status, text, type) {
    res.writeHead(status, {
      'Content-Type': type || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  }

  function sendFile(res, name, type) {
    const file = path.join(pageDir, name);
    fs.readFile(file, (err, data) => {
      if (err) {
        sendText(res, 404, 'not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }

  function configJs(target) {
    return '/* Адрес пульта: этот же сервер (режим Wi-Fi). */\n' +
      'window.REMOTE_CONFIG = { url: ' + JSON.stringify('http://' + target.ip + ':' + target.port) + ' };\n';
  }

  async function request(req, res) {
    // clientIp — только для теста отказа не-частному адресу (настоящий адрес даёт сокет).
    const remote = options.clientIp || (req.socket && req.socket.remoteAddress);
    if (!isPrivateClient(remote)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }

    let url;
    try {
      url = new URL(req.url || '/', 'http://lan.local');
    } catch (e) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }

    const op = String(url.searchParams.get('op') || '');
    if (op) {
      let body = {};
      if (req.method !== 'GET') {
        let raw;
        try {
          raw = await readBody(req, MAX_BODY);
        } catch (e) {
          sendJson(res, e && e.code === 'too_big' ? 413 : 400, { error: 'bad_request' });
          return;
        }
        if (raw) {
          try { body = JSON.parse(raw); } catch (e) { sendJson(res, 400, { error: 'bad_request' }); return; }
        }
      }
      const query = {};
      for (const [k, v] of url.searchParams) query[k] = v;
      const r = await core.handle(op, req.method, query, body, remote, nowFn());
      sendJson(res, r.status, r.body, r.headers);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'method');
      return;
    }
    if (url.pathname === '/ping') {
      sendText(res, 200, 'ok');
      return;
    }
    if (url.pathname === '/config.js') {
      sendText(res, 200, info ? configJs(info) : '', 'text/javascript; charset=utf-8');
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      sendFile(res, 'index.html', 'text/html; charset=utf-8');
      return;
    }
    if (url.pathname === '/app.css') {
      // Стили окна Тапёра в пак не входят: файл рядом (выкладка на сайт кладёт его) или берём у самого
      // Тапёра (его локальный сервер, тот же ПК) — без них карточки сообщений рисуются без оформления.
      const send = (data) => {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data || '');
      };
      fs.readFile(path.join(pageDir, 'app.css'), (err, data) => {
        if (!err && data && data.length) { send(data); return; }
        if (appCss != null) { send(appCss); return; }
        if (!options.appCssUrl || typeof fetch !== 'function') { send(''); return; }
        fetch(options.appCssUrl, { signal: AbortSignal.timeout(4000) })
          .then((r) => (r.ok ? r.text() : ''))
          .then((t) => { if (t) appCss = t; send(t); })
          .catch(() => send(''));
      });
      return;
    }
    if (PAGE_FILES[url.pathname]) {
      sendFile(res, PAGE_FILES[url.pathname][0], PAGE_FILES[url.pathname][1]);
      return;
    }
    sendText(res, 404, 'not found');
  }

  function listen(ip, port) {
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        request(req, res).catch(() => {
          if (!res.headersSent) sendJson(res, 500, { error: 'server' });
          else if (!res.writableEnded) res.end();
        });
      });
      const onError = (e) => { s.removeListener('listening', onOk); reject(e); };
      const onOk = () => { s.removeListener('error', onError); resolve(s); };
      s.once('error', onError);
      s.once('listening', onOk);
      s.listen(port, ip);
    });
  }

  function candidatePorts() {
    if (Number.isInteger(options.port) && options.port >= 0) return [options.port];
    const out = [];
    // порт прошлой ссылки — первым: тогда ссылка у телефона остаётся прежней (16.11)
    const pref = options.preferPort;
    if (Number.isInteger(pref) && pref >= PORT_FIRST && pref <= PORT_LAST) out.push(pref);
    for (let p = PORT_FIRST; p <= PORT_LAST; p++) if (p !== pref) out.push(p);
    return out;
  }

  function selfCheck(target) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const req = http.get({ host: target.ip, port: target.port, path: '/ping', timeout: 3000, family: 4 }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => finish(res.statusCode === 200 && text.trim() === 'ok'));
      });
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
    });
  }

  async function start() {
    if (info) return Object.assign({}, info);

    const state = netinfo.scan(typeof options.interfaces === 'function'
      ? options.interfaces()
      : options.interfaces || require('node:os').networkInterfaces());
    const picked = options.address || (netinfo.pickDefault(state.addrs) || {}).ip;
    if (!picked || !netinfo.isIPv4(picked)) {
      throw new Error('не найден адрес в домашней сети');
    }

    let lastErr = null;
    for (const port of candidatePorts()) {
      try {
        server = await listen(picked, port);
        lastErr = null;
        break;
      } catch (e) {
        if (e && e.code === 'EADDRINUSE' && !Number.isInteger(options.port)) { lastErr = e; continue; }
        throw e;
      }
    }
    if (!server) throw lastErr || new Error('нет свободного порта для пульта');

    const addr = server.address();
    const actual = typeof addr === 'object' && addr ? addr.port : 0;
    const own = netinfo.findAddress(state.addrs, picked);
    info = {
      ip: picked,
      port: actual,
      net: own ? own.net : (picked === '127.0.0.1' ? '127.0.0.0/8' : ''),
      base: 'http://' + picked + ':' + actual,
      selfOk: null
    };
    info.selfOk = await selfCheck(info);
    log('режим Wi-Fi: сервер на ' + picked + ':' + actual + (info.selfOk ? ' — отвечает' : ' — не отвечает'));
    return Object.assign({}, info);
  }

  async function stop() {
    const s = server;
    server = null;
    info = null;
    core.resetRates();
    if (!s) return { ok: true };
    await new Promise((resolve) => {
      s.close(() => resolve());
      if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    });
    return { ok: true };
  }

  function wrap(res) {
    const body = res && res.body;
    if (res && res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, data: body && typeof body === 'object' ? body : {} };
    }
    if (res && res.status === 404) {
      return { ok: false, status: 404, code: 'no-session', error: 'Сессия закончилась — подключи телефон заново' };
    }
    const code = body && typeof body === 'object' && body.error ? body.error : 'http-' + (res ? res.status : 0);
    return { ok: false, status: res ? res.status : 0, code, error: 'Локальный сервер пульта: ' + code };
  }

  // Тот же вид, что у relay.js: модуль не знает, облако это или свой сервер.
  function channel() {
    async function call(op, options2 = {}) {
      const method = options2.method === 'GET' ? 'GET' : 'POST';
      const res = await core.handle(op, method, options2.query || {}, options2.body || {}, '127.0.0.1', nowFn());
      return wrap(res);
    }
    return {
      configured: true,
      call,
      new: async (from) => {
        if (from && from.reuse) return wrap(await core.restore(from.reuse.sid, from.reuse.host, nowFn()));
        return call('new', { method: 'POST', body: {} });
      },
      host: (body) => call('host', { method: 'POST', body: body || {} }),
      end: (body) => call('end', { method: 'POST', body: body || {} }),
      poll: (params) => call('poll', { method: 'GET', query: params || {} })
    };
  }

  function getInfo() { return info ? Object.assign({}, info) : null; }
  function isRunning() { return !!server; }

  return { start, stop, channel, getInfo, isRunning, handle: core.handle, store: core.store };
}

module.exports = {
  PORT_FIRST,
  PORT_LAST,
  PAGE_FILES,
  SESSION_TTL_MS,
  MAX_S,
  MAX_C,
  isPrivateClient,
  cleanIp,
  memoryStore,
  createCore,
  createLanServer
};
