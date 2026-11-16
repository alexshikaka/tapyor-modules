#!/usr/bin/env node
// Проверка страницы телефона в Chromium: 390×844 и 844×390, поддельная функция в памяти.
// Снимок — по docs/DOCK2.md, лента — с <script> внутри (не должен выполниться).
// Снимки кладутся в .dsh/remote-portrait.png и .dsh/remote-landscape.png.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGE_DIR = path.join(ROOT, 'streamer-pack', 'remote', 'page');
const C = require(path.join(ROOT, 'streamer-pack', 'remote', 'src', 'crypto.js'));
const { snapForPhone, feedForPhone } = require(path.join(ROOT, 'streamer-pack', 'remote', 'src', 'filter.js'));
const { createLanServer } = require(path.join(ROOT, 'streamer-pack', 'remote', 'src', 'lan-relay.js'));
const { RemoteSession } = require(path.join(ROOT, 'streamer-pack', 'remote', 'src', 'session.js'));

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255));
const SID = Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 11 + 5) & 255)).toString('base64url');

function snapshot() {
  const at = Date.now();
  const base = {
    src: 'ym', srcName: 'Яндекс', thumb: '', st: '', bg: false, req: null, ban: false, canNext: false, book: null
  };
  const items = [
    Object.assign({}, base, { i: 0, key: 'ym:1', title: 'Нервы — Самый дорогой человек', artist: 'Нервы', dur: '3:41', st: 'done' }),
    Object.assign({}, base, { i: 1, key: 'ym:2', title: 'Хочешь?', artist: 'Земфира', dur: '3:40', st: 'playing' }),
    Object.assign({}, base, { i: 2, key: 'ym:3', title: 'Кукушка', artist: 'Кино', dur: '4:44', req: { kind: 'don', who: 'Marina_K' }, ban: true, canNext: true }),
    Object.assign({}, base, { i: 3, key: 'ym:4', title: 'Перемен', artist: 'Кино', dur: '4:51', req: { kind: 'cmd', who: 'dimon_plays' }, canNext: true }),
    Object.assign({}, base, { i: 4, key: 'ym:5', title: 'Выхода нет', artist: 'Сплин', dur: '3:32', req: { kind: 'pts', who: 'lisa_tv' }, canNext: true }),
    Object.assign({}, base, { i: 5, key: 'ym:6', title: 'Зима', artist: 'Король и Шут', src: 'sc', srcName: 'SoundCloud', dur: '3:12' }),
    Object.assign({}, base, { i: 6, key: 'ym:7', title: 'Лесник', artist: 'Король и Шут', dur: '3:05' }),
    Object.assign({}, base, { i: 7, key: 'ym:8', title: 'Глава первая', artist: 'Книга', dur: '12:00', book: 'wid:1' }),
    Object.assign({}, base, { i: 8, key: 'ym:9', title: 'Глава вторая', artist: 'Книга', dur: '11:30', book: 'wid:1' })
  ];
  return snapForPhone({
    v: 1, at, mode: 'live', cur: 1,
    np: { title: 'Хочешь?', artist: 'Земфира', playing: true, pos: 42, dur: 221 },
    items,
    after: [{ title: 'Сплин — Выхода нет', artist: 'Сплин', thumb: '' }],
    wave: { title: 'Волна заказов', sub: '5 треков', auto: true },
    counts: { pending: 5, played: 2 },
    opts: { ban: true, banMin: 10 },
    look: { cls: 'theme-dark', style: '', scale: 100 },
    theme: {
      vars: {
        '--bg00': '#151515', '--bg0': '#222222', '--bg1': '#272727', '--bg2': '#2D2D2D',
        '--bg3': '#343434', '--bg4': '#414141', '--ln': '#454545', '--ln2': '#3A3A3A', '--ln3': '#555555',
        '--tx': '#E7F0F5', '--tx2': '#C7D2D8', '--tx3': '#A5B0B6', '--tx4': '#8C979D', '--tx5': '#859096',
        '--ac': '#D17834', '--ac2': '#E39A5D', '--acr': '209,120,52', '--acbg': 'rgba(209,120,52,.14)',
        '--req': '#4ADE9A', '--req-cmd': '#A970FF', '--req-pts': '#FFB547', '--ok': '#4ADE9A', '--warn': '#FFD43B'
      },
      light: false
    }
  });
}

function feed() {
  const card = (kind, who, extra, text, track, sub) =>
    '<div class="rq dock-card" data-kind="' + kind + '">' +
      '<div class="rq-h"><b>' + who + '</b>' + extra + '</div>' +
      '<div class="rq-m">' + text + '</div>' +
      '<div class="rq-it ex"><div class="rq-tr"><div class="tm"><div class="tt">' + track + '</div>' +
      '<div class="ts">' + sub + '</div></div></div></div>' +
      '<div class="rq-b"><button class="rq-sm" data-rq="add" data-id="0:0">＋ В очередь</button>' +
      '<button class="rq-sm" data-rq="now" data-id="0:0">▶ Сейчас</button></div>' +
    '</div>';
  const html = card('don', 'Marina_K', '<span class="amt">300 ₽</span>', 'Поставь Кино «Кукушка», пожалуйста!', 'Кукушка', 'Кино · точно') +
    '<script>window.__feedScript = "PWNED";</script>' +
    card('chat', 'dimon_plays', '<span class="tw">!sr</span>', '!sr кино перемен', 'Перемен', 'Кино · точно') +
    card('pts', 'lisa_tv', '<span class="amt">баллы</span>', 'Выхода нет', 'Выхода нет', 'Сплин · точно');
  return feedForPhone({ feedHtml: html, msgCount: 3, reqAuto: true, np: { title: 'Хочешь?', artist: 'Земфира', playing: true, pos: 42, dur: 221 } });
}

function fakeCore() {
  const core = {
    dockCalls: [],
    logs: [],
    remote: {
      qr: () => '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
      dock: {
        on(fn) { core.dockFn = fn; return () => { core.dockFn = null; }; },
        want() {},
        cmd(obj) { core.dockCalls.push(obj); return { ok: true }; },
        get() { return null; }
      },
      feed: {
        on(fn) { core.feedFn = fn; return () => { core.feedFn = null; }; },
        want() {},
        rq() {},
        setting() {}
      }
    },
    log(line) { core.logs.push(line); }
  };
  return core;
}

function waitUntil(fn, ms = 5000) {
  const started = Date.now();
  return new Promise((resolve) => {
    (function tick() {
      Promise.resolve(fn()).then((ok) => {
        if (ok) return resolve(true);
        if (Date.now() - started > ms) return resolve(false);
        setTimeout(tick, 50);
      }).catch(() => {
        if (Date.now() - started > ms) return resolve(false);
        setTimeout(tick, 50);
      });
    })();
  });
}

function contentType(name) {
  if (name.endsWith('.html')) return 'text/html; charset=utf-8';
  if (name.endsWith('.css')) return 'text/css; charset=utf-8';
  if (name.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function main() {
  const commands = [];
  const sPiece = C.seal(KEY, SID, 's', snapshot());
  const fPiece = C.seal(KEY, SID, 'f', feed());

  const relay = async (url, opts = {}) => {
    const u = new URL(String(url));
    const op = u.searchParams.get('op');
    if (op === 'poll') {
      return { status: 200, body: { sv: 1, s: sPiece, fv: 1, f: fPiece, ev: [], hostAgo: 120 } };
    }
    if (op === 'cmd') {
      let body = {};
      try { body = JSON.parse(opts.body || '{}'); } catch (e) { body = {}; }
      const cmd = C.open(KEY, SID, 'c', body.c);
      if (cmd) commands.push(cmd);
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: 'no-session' } };
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/' || u.pathname === '/remote' || u.pathname === '/remote/') {
      res.writeHead(200, { 'Content-Type': contentType('index.html'), 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(PAGE_DIR, 'index.html')));
      return;
    }
    if (!u.pathname.startsWith('/remote/')) { res.writeHead(404); res.end('not found'); return; }
    const name = decodeURIComponent(u.pathname.slice('/remote/'.length));
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { res.writeHead(404); res.end('not found'); return; }
    if (name === 'app.css') {
      // В репозитории app.css ядра нет: страница проверяется своими стилями, как и на телефоне без темы.
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('');
      return;
    }
    const file = path.join(PAGE_DIR, name);
    if (!file.startsWith(PAGE_DIR) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType(name), 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
    if (process.env.REMOTE_DEBUG) {
      page.on('console', (m) => console.log('[page]', m.type(), m.text()));
      page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure() && r.failure().errorText));
    }
    await page.exposeFunction('__remoteRelay', relay);
    await page.addInitScript(() => {
      window.REMOTE_CONFIG = { url: 'https://relay.test' };
      window.fetch = async function (url, opts) {
        const r = await window.__remoteRelay(String(url), opts ? { method: opts.method, body: opts.body } : {});
        return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    const url = 'http://127.0.0.1:' + port + '/remote/#' + SID + '.' + C.b64u(KEY);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const rowsOk = await waitUntil(() => page.locator('#dockHost .q').count().then((n) => n >= 8));
    const feedOk = await waitUntil(() => page.locator('#feed .rq').count().then((n) => n >= 3));
    if (process.env.REMOTE_DEBUG && (!rowsOk || !feedOk)) {
      console.log('[debug] body:', await page.locator('body').innerText());
      console.log('[debug] state:', await page.evaluate(() => ({ hash: location.hash, cfg: window.REMOTE_CONFIG, dock: document.getElementById('dockHost').innerHTML.slice(0, 500), feed: document.getElementById('feed').innerHTML.slice(0, 500) })));
      console.log('[debug] errors:', errors);
    }
    assert.ok(rowsOk, 'плейлист должен нарисоваться');
    assert.ok(feedOk, 'лента должна нарисоваться');

    assert.equal(await page.locator('#tabDock').isVisible(), true, 'вкладка «Плейлист» видна');
    assert.equal(await page.locator('#tabFeed').isVisible(), true, 'вкладка «Сообщения» видна');
    assert.equal(await page.locator('#panelFeed').isVisible(), false, 'вертикально — одна вкладка');
    assert.equal(await page.locator('#panelDock').isVisible(), true);

    // Тексты из снимка — через textContent, без исполнения HTML.
    const title = await page.locator('#dockHost .q .t').first().textContent();
    assert.match(title || '', /Нервы/);
    // <script> из ленты не должен исполниться, а сама карточка нарисована.
    assert.equal(await page.evaluate(() => window.__feedScript), undefined, '<script> из feedHtml не исполняется');
    assert.equal(await page.locator('#feed script').count(), 0);
    assert.match(await page.locator('#feed').innerText(), /Marina_K/);
    assert.match(await page.locator('#feed').innerText(), /Кукушка/);

    const shots = path.join(ROOT, '.dsh');
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'remote-portrait.png') });

    // Крестик «Убрать» шлёт remove с индексом и ключом строки.
    await page.locator('#dockHost .q .rm').first().click();
    assert.ok(await waitUntil(() => commands.some((c) => c.c === 'remove')), 'крестик должен отправить remove');
    const rm = commands.filter((c) => c.c === 'remove')[0];
    assert.equal(rm.i, 0);
    assert.equal(rm.key, 'ym:1');
    assert.equal(typeof rm.n, 'string');
    assert.equal(typeof rm.t, 'number');

    // Лента: клик по [data-rq] уходит командой rq с dataset (лишние поля не нужны).
    await page.locator('#tabFeed').click();
    assert.equal(await page.locator('#panelFeed').isVisible(), true, 'вкладка «Сообщения» показывает ленту');
    await page.locator('#feed [data-rq="add"]').first().click();
    assert.ok(await waitUntil(() => commands.some((c) => c.c === 'rq')), 'кнопка ленты должна отправить rq');
    const rq = commands.filter((c) => c.c === 'rq')[0];
    assert.equal(rq.dataset.rq, 'add');
    assert.equal(rq.dataset.id, '0:0');

    // Горизонтально — две колонки рядом.
    await page.locator('#tabDock').click();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#panelDock').isVisible(), true);
    assert.equal(await page.locator('#panelFeed').isVisible(), true);
    const a = await page.locator('#panelDock').boundingBox();
    const b = await page.locator('#panelFeed').boundingBox();
    assert.ok(a && b, 'обе колонки должны иметь размер');
    assert.ok(a.x < b.x, 'плейлист слева, сообщения справа');
    assert.ok(Math.abs((a.x + a.width) - b.x) <= 2, 'колонки стоят рядом');
    assert.ok(a.width > 300 && b.width > 300, 'на горизонтальном телефоне колонки широкие');
    await page.screenshot({ path: path.join(shots, 'remote-landscape.png') });

    assert.deepEqual(errors, [], 'на странице не должно быть ошибок');

    console.log('OK: страница пульта — 390×844 и 844×390, команды remove/rq ушли, script не исполнился');
    console.log('Снимки: ' + path.join(shots, 'remote-portrait.png') + ', ' + path.join(shots, 'remote-landscape.png'));

    // Режим Wi-Fi: настоящий http://127.0.0.1, страница без crypto.subtle — AES-GCM на чистом JS.
    const lanCore = fakeCore();
    const lan = createLanServer({ address: '127.0.0.1', port: 0, pageDir: PAGE_DIR });
    const lanInfo = await lan.start();
    const lanErrors = [];
    let lanSession = null;
    try {
      assert.equal(lanInfo.selfOk, true, 'сервер Wi-Fi отвечает сам себе по /ping');
      lanSession = new RemoteSession(lanCore, {
        relay: lan.channel(),
        page: lanInfo.base + '/',
        now: () => Date.now()
      });
      const lanStarted = await lanSession.start();
      assert.equal(lanStarted.state, 'waiting');
      lanCore.dockFn(snapshot());
      lanCore.feedFn(feed());
      await lanSession.pollOnce();

      const lanContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true
      });
      // Как на обычном http://: crypto.subtle браузер не даёт.
      await lanContext.addInitScript(() => {
        Object.defineProperty(window.Crypto.prototype, 'subtle', {
          configurable: true,
          get() { return undefined; }
        });
      });
      const lanPage = await lanContext.newPage();
      lanPage.on('pageerror', (e) => lanErrors.push(String(e && e.message ? e.message : e)));
      const lanUrl = lanInfo.base + '/#' + lanSession.sid + '.' + C.b64u(lanSession.key);
      await lanPage.goto(lanUrl, { waitUntil: 'domcontentloaded' });
      assert.equal(await lanPage.evaluate(() => !window.crypto.subtle), true, 'crypto.subtle убран принудительно');

      const lanRows = await waitUntil(() => lanPage.locator('#dockHost .q').count().then((n) => n >= 8));
      const lanFeed = await waitUntil(() => lanPage.locator('#feed .rq').count().then((n) => n >= 3));
      assert.ok(lanRows, 'по http плейлист должен нарисоваться через чистый AES-GCM');
      assert.ok(lanFeed, 'по http лента должна нарисоваться через чистый AES-GCM');
      assert.match(await lanPage.locator('#dockHost .q .t').first().textContent() || '', /Нервы/);

      await lanPage.locator('#dockHost .q .rm').first().click();
      const lanGot = await waitUntil(async () => {
        await lanSession.pollOnce();
        return lanCore.dockCalls.length > 0;
      }, 5000);
      assert.ok(lanGot, 'команда с http-страницы доходит до ядра');
      assert.equal(lanCore.dockCalls[0].c, 'remove');
      assert.equal(lanCore.dockCalls[0].key, 'ym:1');
      assert.deepEqual(lanErrors, [], 'на http-странице не должно быть ошибок');
      console.log('OK: режим Wi-Fi — страница по http://127.0.0.1 без crypto.subtle, команда remove дошла');
    } finally {
      if (lanSession) await lanSession.stop();
      await lan.stop();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
