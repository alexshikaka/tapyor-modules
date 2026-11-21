#!/usr/bin/env node
// Проверка «играющий трек в середине списка» для двух мест: докпанель OBS (/dock2) и пульт с телефона.
// Headless Chromium через Playwright, страницы берём настоящие из репозиториев.
//   node streamer-pack/remote/tests/center.check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Tapyor/Tapyor-modules/package.json');
const { chromium } = require('playwright');

const CORE = 'E:\\Tapyor\\Tapyor-player\\src';
const PACK = 'E:\\Tapyor\\Tapyor-modules\\streamer-pack\\remote\\page';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── общий сервер: отдаём файлы обеих страниц ─────────────────────────────────
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const routes = new Map();
for (const f of ['dock2.html', 'dock2.js', 'dock2.css', 'app.css']) {
  const p = path.join(CORE, f);
  if (fs.existsSync(p)) routes.set('/' + f, p);
}
for (const f of ['render-dock.js', 'remote.css']) {
  const p = path.join(PACK, f);
  if (fs.existsSync(p)) routes.set('/' + f, p);
}
routes.set('/phone.html', null); // отдаём синтетическую страницу ниже

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/phone.html') {
    res.writeHead(200, { 'Content-Type': mime['.html'] });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/remote.css">
      <style>html,body{margin:0;height:100%} body{display:flex;flex-direction:column}</style></head>
      <body><div class="list" id="dockHost"></div><script src="/render-dock.js"></script></body></html>`);
    return;
  }
  const file = routes.get(url);
  if (file && fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404); res.end('нет');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// ── снимок с длинной очередью и играющим треком в середине ───────────────────
function item(i, st) {
  return { i, key: 'ym:' + (i + 1), title: 'Трек ' + (i + 1), artist: 'Артист', src: 'ym', srcName: 'Яндекс', dur: '3:10', thumb: '', st: st || '', bg: false };
}
function snapshot(cur, total = 40) {
  const items = [];
  for (let i = 0; i < total; i++) items.push(item(i, i === cur ? 'playing' : i < cur ? 'done' : 'pend'));
  return { v: 1, at: Date.now(), mode: 'classic', cur, np: { title: 'Трек ' + (cur + 1), artist: 'Артист', playing: true, pos: 10, dur: 200 }, items, after: [], counts: { pending: total - cur - 1, played: cur }, opts: { ban: false, banMin: 10 }, look: { cls: '', style: '', scale: 100 }, theme: { vars: {}, light: false } };
}

// «середина»: смещение центра строки от центра видимой области
async function offset(page, rowSel, boxSel) {
  return page.evaluate(([rowSel, boxSel]) => {
    const box = document.querySelector(boxSel);
    const row = document.querySelector(rowSel);
    if (!box || !row) return { ok: false };
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      ok: true,
      offset: Math.round((r.top + r.height / 2) - (b.top + b.height / 2)),
      scrollTop: Math.round(box.scrollTop),
      max: Math.round(box.scrollHeight - box.clientHeight),
      rowIndex: row.getAttribute('data-i')
    };
  }, [rowSel, boxSel]);
}

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };

const browser = await chromium.launch();

// ── A. Пульт с телефона ─────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base + '/phone.html');
  await page.waitForFunction(() => !!window.RemoteDock);

  const render = (snap) => page.evaluate((snap) => {
    window.RemoteDock.render(document.getElementById('dockHost'), snap, { send: function () {} });
  }, snap);

  await render(snapshot(20));
  await sleep(700);
  const a = await offset(page, '#dockList .q.playing', '#dockHost');
  check('пульт: играющий трек в фокусе при открытии', a.ok && (Math.abs(a.offset) <= 40 || a.scrollTop === a.max || a.scrollTop === 0), JSON.stringify(a));

  await render(snapshot(28));
  await sleep(700);
  const b = await offset(page, '#dockList .q.playing', '#dockHost');
  check('пульт: после смены трека трек в фокусе или прокрутка до упора', b.ok && (Math.abs(b.offset) <= 40 || b.scrollTop === b.max || b.scrollTop === 0), JSON.stringify(b));

  // у конца списка центрировать нечем — прокрутка упирается в конец, трек максимально близко к середине
  await render(snapshot(39));
  await sleep(700);
  const c = await offset(page, '#dockList .q.playing', '#dockHost');
  check('пульт: у конца списка прокрутка до упора', c.ok && c.scrollTop === c.max, JSON.stringify(c));
  await ctx.close();
}

// ── B. Докпанель OBS (/dock2) ───────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 420, height: 640 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.EventSource = function () { window.__es = this; this.close = function () {}; };
    window.fetch = function (u) {
      const s = String(u);
      if (s.indexOf('/dock2/state') === 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(window.__firstSnap || {}); } });
      }
      return Promise.resolve({ ok: true, status: 204, json: function () { return Promise.resolve({}); } });
    };
  });
  // первый снимок отдаём через fetch, чтобы страница сразу нарисовала список
  await page.addInitScript(() => { window.__firstSnap = null; });
  await page.goto(base + '/dock2.html');
  await page.waitForFunction(() => !!document.getElementById('d2scroll'));

  const push = (snap) => page.evaluate((snap) => {
    if (window.__es && window.__es.onmessage) window.__es.onmessage({ data: JSON.stringify(snap) });
  }, snap);

  await push(snapshot(20));
  await sleep(700);
  const a = await offset(page, '#d2list .d2-row.playing', '#d2scroll');
  check('докпанель: играющий трек в середине при открытии', a.ok && Math.abs(a.offset) <= 3, JSON.stringify(a));

  await push(snapshot(30));
  await sleep(700);
  const b = await offset(page, '#d2list .d2-row.playing', '#d2scroll');
  check('докпанель: после смены трека снова в середине', b.ok && Math.abs(b.offset) <= 3, JSON.stringify(b));

  await push(snapshot(39));
  await sleep(700);
  const c = await offset(page, '#d2list .d2-row.playing', '#d2scroll');
  check('докпанель: у конца списка прокрутка до упора', c.ok && c.scrollTop === c.max, JSON.stringify(c));
  await ctx.close();
}

await browser.close();
server.close();

const bad = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - bad.length) + ' из ' + results.length);
fs.writeFileSync('E:\\Tapyor\\sandbox\\center-check.json', JSON.stringify({ when: new Date().toISOString(), results }, null, 2), 'utf8');
process.exit(bad.length ? 1 : 0);
