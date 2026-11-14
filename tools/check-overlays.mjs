#!/usr/bin/env node
// Проверка оверлеев в Chromium на поддельном мосте Тапёра.
// Запуск: node tools/check-overlays.mjs [--styles=card,dos] [--positions=br,tl]
//        [--pages=playlist,motion] [--tracks=normal,medium,long] [--shots] [--core=<папка ядра>]
// Шрифты пака отдаёт сам модуль (/overlay/fonts/...), шрифты ядра (Manrope, Onest, Pixelify Sans,
// Press Start 2P, JetBrains Mono) берутся только на чтение из ядра и копируются во временную папку.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Overlay } = require(path.join(root, 'streamer-pack', 'overlay', 'src', 'index.js'));
const { STYLE_DEFS } = require(path.join(root, 'streamer-pack', 'overlay', 'src', 'styles.js'));

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] === undefined ? '1' : m[2]);
}
const styles = (args.get('styles') || 'card,vinyl,bigtype,column,typography,tilt,ribbon,vtitle,win95,sys7,winamp,dos,swiss,hud8,synth,paper,polaroid,code,cassette,vu,neon,film,citypop,popart,blueprint,radar').split(',');
const positions = (args.get('positions') || 'br,bc,bl,tr,tc,tl').split(',');
const pages = (args.get('pages') || 'playlist,motion').split(',');
const tracks = (args.get('tracks') || 'normal,medium,long').split(',');
const shots = args.get('shots') === '1';
const featuresMode = args.get('features') === '1';
const outlineMode = args.get('outline') === '1';
const alignMode = args.get('align') === '1';
const shiftMode = args.get('shift') === '1';
const queueMode = args.get('queue') === '1';
const shotDx = args.get('dx') || '0';
const shotDy = args.get('dy') || '0';
const shotSize = args.get('size') || '100';
const shotSuffix = (shotDx !== '0' || shotDy !== '0' || shotSize !== '100')
  ? `-d${shotDx}_${shotDy}-s${shotSize}` : '';
const coreDir = args.get('core') || process.env.TAPYOR_PLAYER || 'E:\\Tapyor\\Tapyor-player';

// ---------- шрифты ядра: только чтение, копия во временную папку проверки ----------
function prepareCoreFonts(dir) {
  const css = path.join(dir, 'src', 'fonts.css');
  const fonts = path.join(dir, 'src', 'assets', 'fonts');
  if (!fs.existsSync(css) || !fs.existsSync(fonts)) {
    throw new Error('не найдены шрифты ядра: ' + css + ' / ' + fonts + ' (укажи --core=<папка ядра>)');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-ov-fonts-'));
  fs.copyFileSync(css, path.join(tmp, 'fonts.css'));
  const dst = path.join(tmp, 'assets', 'fonts');
  fs.mkdirSync(dst, { recursive: true });
  const names = fs.readdirSync(fonts).filter((n) => /^[a-z0-9-]+\.woff2$/.test(n));
  for (const n of names) fs.copyFileSync(path.join(fonts, n), path.join(dst, n));
  return { tmp, names };
}
const coreFonts = prepareCoreFonts(coreDir);


const fake = {
  settings: { get: () => null, set: () => {} },
  http: { mount: (p, fn) => { fake.handle = fn; }, unmount: () => {}, url: (p) => `http://127.0.0.1:${port}${p}` },
  player: {
    on: () => () => {},
    want: () => {},
    coverImage: async () => null
  },
  log: (m) => { if (process.env.OVERLAY_DEBUG) console.log('[core]', m); }
};
let port = 0;
const overlay = new Overlay(fake);
overlay.start();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/fonts.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(coreFonts.tmp, 'fonts.css')));
    return;
  }
  if (u.pathname.startsWith('/assets/fonts/')) {
    // Только имена из скопированного списка: путь из запроса не становится путём к файлу.
    const name = u.pathname.slice('/assets/fonts/'.length);
    if (!coreFonts.names.includes(name)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(coreFonts.tmp, 'assets', 'fonts', name)));
    return;
  }
  if (u.pathname.startsWith('/overlay')) {
    fake.handle(req, res, u.pathname.slice('/overlay'.length), u.searchParams);
    return;
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
port = server.address().port;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => {
  if (/\/overlay\/events/.test(r.url())) return;   // поток закрывается при переходе на следующую страницу
  errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || ''));
});

const measured = await page.addInitScript(() => {
  window.__ovCheck = () => {
    const root = document.querySelector('.style-root');
    if (!root) return { error: 'нет .style-root' };
    const rect = (el) => {
      if (!el || el.hidden || !el.offsetParent) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const ink = (el) => {
      if (!el || el.hidden || !el.offsetParent) return null;
      if (el.classList.contains('mq') || el.classList.contains('mqv')) {
        const own = rect(el);
        return own ? clipToParents(el, own) : null;
      }
      if (getComputedStyle(el).overflow === 'hidden') return clipToParents(el, rect(el));
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) return clipToParents(el, rect(el));
      return clipToParents(el, { l: r.left, t: r.top, r: r.right, b: r.bottom });
    };
    const clipToParents = (el, r) => {
      if (!r) return null;
      let p = el.parentElement;
      while (p && p !== root) {
        const cs = getComputedStyle(p);
        if (cs.overflow !== 'visible') {
          const q = p.getBoundingClientRect();
          r = { l: Math.max(r.l, q.left), t: Math.max(r.t, q.top), r: Math.min(r.r, q.right), b: Math.min(r.b, q.bottom) };
        }
        p = p.parentElement;
      }
      return r.r > r.l && r.b > r.t ? r : null;
    };
    const cover = root.querySelector('[data-role="cover"]');
    let coverBlock = cover;
    if (cover) {
      let p = cover.parentElement;
      while (p && p !== root) {
        if (/cover-shell|radar-scope|pop-star|cassette-body|polaroid-frame|bp-frame/.test(p.className)) { coverBlock = p; break; }
        p = p.parentElement;
      }
    }
    const texts = ['title', 'artist', 'who'].map((r) => ({ role: r, rect: ink(root.querySelector('[data-role="' + r + '"]')) })).filter((x) => x.rect);
    const viz = [...root.querySelectorAll('[data-role="viz"]')].map(rect).filter(Boolean);
    const vizUnion = viz.length ? viz.reduce((a, b) => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) })) : null;
    const hit = (a, b) => {
      if (!a || !b) return false;
      return a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1;
    };
    const coverRect = rect(coverBlock);
    const overlaps = [];
    for (const x of texts) {
      if (hit(x.rect, coverRect)) overlaps.push(x.role + '×cover');
      if (hit(x.rect, vizUnion)) overlaps.push(x.role + '×viz');
    }
    const R = rect(root);
    let U = R;
    if (coverRect) U = { l: Math.min(U.l, coverRect.l), t: Math.min(U.t, coverRect.t), r: Math.max(U.r, coverRect.r), b: Math.max(U.b, coverRect.b) };
    for (const x of texts) U = { l: Math.min(U.l, x.rect.l), t: Math.min(U.t, x.rect.t), r: Math.max(U.r, x.rect.r), b: Math.max(U.b, x.rect.b) };
    if (vizUnion) U = { l: Math.min(U.l, vizUnion.l), t: Math.min(U.t, vizUnion.t), r: Math.max(U.r, vizUnion.r), b: Math.max(U.b, vizUnion.b) };
    return {
      style: root.dataset.style, overlaps, center: (U.l + U.r) / 2, rootCenter: (R.l + R.r) / 2,
      visible: { l: U.l, t: U.t, r: U.r, b: U.b }, root: R,
      title: root.querySelector('[data-role="title"]')?.textContent || '',
      titleClass: root.querySelector('[data-role="title"]')?.className || '',
      whoHidden: !!root.querySelector('[data-role="who"]')?.hidden,
      translate: document.getElementById('ov').style.translate,
      queueRows: root.querySelectorAll('.queue>div').length,
      vizCount: root.querySelectorAll('[data-viz]').length,
      boxes: { cover: coverRect, viz: vizUnion, title: texts.find((x) => x.role === 'title')?.rect,
        artist: texts.find((x) => x.role === 'artist')?.rect, who: texts.find((x) => x.role === 'who')?.rect }
    };
  };
  // Состояние переключателей «Что показывать»: что видно, какие подписи, очередь и подпись вида.
  window.__ovFeature = () => {
    const root = document.querySelector('.style-root');
    if (!root) return { error: 'нет .style-root' };
    const vis = (el) => {
      if (!el || el.hidden) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    };
    const box = (el) => {
      if (!el || !vis(el)) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    };
    const pseudo = (el, pe) => {
      if (!el) return '';
      try { return getComputedStyle(el, pe).content || ''; } catch (e) { return ''; }
    };
    const title = root.querySelector('[data-role="title"]');
    const artist = root.querySelector('[data-role="artist"]');
    const who = root.querySelector('[data-role="who"]');
    const time = root.querySelector('[data-role="time"]');
    const rows = [...root.querySelectorAll('.queue > div')];
    const mq = root.querySelector('.mq, .mqv');
    const viz = [...root.querySelectorAll('[data-role="viz"]')];
    const visible = {
      cover: vis(root.querySelector('[data-role="cover"]')),
      time: vis(time),
      spin: vis(root.querySelector('[data-role="spin"]')),
      prog: vis(root.querySelector('[data-role="prog"]')),
      osc: viz.some(vis),
      marq: !!mq && vis(mq)
    };
    const labels = { title: pseudo(title, '::before'), artist: pseudo(artist, '::before'), time: pseudo(time, '::before') };
    const secondOpacity = rows[1] ? getComputedStyle(rows[1]).opacity : '';
    // OV6: какой вид визуализатора страница реально рисует (ставится при применении настроек).
    const views = [...root.querySelectorAll('[data-viz]')].map((z) => z.dataset.view || '');
    const sig = JSON.stringify({
      style: root.dataset.style, visible, labels, queueRows: rows.length, views,
      first: rows[0] ? rows[0].textContent : '', second: secondOpacity,
      title: title ? title.textContent : '', artist: artist ? artist.textContent : '', who: who ? who.textContent : '',
      // Кадр вертушки DOS крутится, его рамка не должна влиять на сравнение «ничего не изменилось».
      boxes: [box(root), box(root.querySelector('[data-role="cover"]')), box(title), box(artist), box(who), box(time),
        box(root.querySelector('[data-role="prog"]')), ...viz.map(box)]
    });
    return {
      visible, labels, views, queueRows: rows.length, firstText: rows[0] ? rows[0].textContent : '',
      secondOpacity, sig,
      titleInfo: title ? {
        cls: title.className, cw: title.clientWidth, sw: title.scrollWidth,
        w: title.style.width, flex: title.style.flex, overflow: getComputedStyle(title).overflow,
        mq: title.querySelectorAll('.mq,.mqv').length
      } : null
    };
  };
  // Раскладка в координатах оверлея (до transform: scale) — для матрицы сдвигов и размеров.
  window.__ovLayout = () => {
    const root = document.querySelector('.style-root');
    const ov = document.getElementById('ov');
    if (!root || !ov) return { error: 'нет .style-root' };
    const R = root.getBoundingClientRect();
    const s = R.width / (root.offsetWidth || 1) || 1;
    const loc = (r) => ({
      l: +((r.left - R.left) / s).toFixed(2), t: +((r.top - R.top) / s).toFixed(2),
      r: +((r.right - R.left) / s).toFixed(2), b: +((r.bottom - R.top) / s).toFixed(2)
    });
    const box = (el) => {
      if (!el || el.hidden || !el.offsetParent) return null;
      const r = el.getBoundingClientRect();
      return r.width || r.height ? loc(r) : null;
    };
    const total = {};
    for (const role of ['cover', 'title', 'artist', 'who', 'time', 'queue', 'prog']) {
      total[role] = box(root.querySelector('[data-role="' + role + '"]'));
    }
    const viz = [...root.querySelectorAll('[data-role="viz"]')].map(box).filter(Boolean);
    const q = root.querySelector('[data-role="queue"]');
    const rows = q ? [...q.children].map(box).filter(Boolean) : [];
    const qfd = q ? getComputedStyle(q).flexDirection : '';
    const t = root.querySelector('[data-role="title"]');
    const titleInfo = t ? {
      mq: !!t.querySelector('.mq, .mqv'),
      cw: t.clientWidth, sw: t.scrollWidth, ch: t.clientHeight, sh: t.scrollHeight
    } : null;
    // Наезды текста на обложку и визуализатор — тем же способом, что и в общем прогоне.
    let overlaps = [];
    try { overlaps = (window.__ovCheck() || {}).overlaps || []; } catch (e) { overlaps = ['check: ' + e.message]; }
    return { style: root.dataset.style, scale: s, boxes: total, viz, rows, qfd, titleInfo, overlaps };
  };
  // должен совпадать с краем своей колонки (±2 px): справа — правым, слева — левым,
  // по центру — серединами. №18 «Код» — исключение: строки не переворачиваются, всё влево.
  window.__ovAlign = () => {
    const root = document.querySelector('.style-root');
    const ov = document.getElementById('ov');
    if (!root || !ov) return { error: 'нет .style-root' };
    const h = ov.dataset.h || 'r';
    const style = root.dataset.style;
    // OV6: DOS, 8-бит HUD, Код и Радар в правых углах не зеркалят ленту и шкалу:
    // их край проверяем как у левого положения, текст — как обычно.
    const vizH = (style === 'dos' || style === 'hud8' || style === 'code' || style === 'radar') && h === 'r' ? 'l' : h;
    const EPS = 2.5;
    const vis = (el) => {
      if (!el || el.hidden || !el.offsetParent) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const content = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const l = r.left + (parseFloat(cs.paddingLeft) || 0);
      const rr = r.right - (parseFloat(cs.paddingRight) || 0);
      return { l, r: rr, mid: (l + rr) / 2 };
    };
    const ink = (el) => {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (!r.width) return null;
        return { l: r.left, r: r.right, mid: (r.left + r.right) / 2 };
      } catch (e) { return null; }
    };
    // У подписей-псевдоэлементов (TRACK:, [1], FIG.1) range их не видит:
    // тогда меряем коробку строки целиком.
    const hasPseudo = (el) => {
      for (const pe of ['::before', '::after']) {
        const c = getComputedStyle(el, pe).content;
        if (c && c !== 'none' && c !== 'normal') return true;
      }
      return false;
    };
    const textRect = (el) => {
      if (hasPseudo(el)) {
        const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, mid: (r.left + r.right) / 2 };
      }
      return ink(el);
    };
    const target = (c, dir) => ((dir || h) === 'r' ? c.r : (dir || h) === 'l' ? c.l : c.mid);
    const got = (ir, dir) => ((dir || h) === 'r' ? ir.r : (dir || h) === 'l' ? ir.l : ir.mid);
    const entry = (role, c, ir, extra, dir) => {
      const e = target(c, dir), g = got(ir, dir);
      return Object.assign({ role, delta: +(g - e).toFixed(2), ok: Math.abs(g - e) <= EPS }, extra || {});
    };
    // №18 «Код»: ни одна строка не перевёрнута, текст прижат влево. Визуализатор и шкалу
    // всё равно проверяем ниже (у него своё исключение по vizH).
    let code = null;
    if (style === 'code') {
      const ta = getComputedStyle(root).textAlign;
      const head = root.querySelector('.code-head');
      const dir = head ? getComputedStyle(head).flexDirection : '';
      code = { textAlign: ta, headDirection: dir, ok: ta === 'left' && dir !== 'row-reverse' };
    }
    const texts = [];
    // №13/№22/№27: исполнитель и время — одна строка, проверяем её край целиком.
    const artistEl = root.querySelector('[data-role="artist"]');
    const timeEl = root.querySelector('[data-role="time"]');
    const pair = new Set();
    if (artistEl && timeEl && artistEl.nextElementSibling === timeEl
      && artistEl.parentElement === timeEl.parentElement
      && /(^|\s)meta-line(\s|$)/.test(artistEl.parentElement.className)) {
      pair.add('artist').add('time');
    }
    // №18 «Код» проверяется отдельно (code.ok), у него строки не переворачиваются.
    for (const role of (style === 'code' ? [] : ['title', 'artist', 'who', 'time'])) {
      const el = root.querySelector('[data-role="' + role + '"]');
      if (!vis(el)) continue;
      if (el.querySelector('.mq, .mqv')) continue;   // бегущая строка: край гуляет по замыслу
      if (pair.has(role)) {
        if (role === 'artist') {
          let cont = null, p = el.parentElement;
          while (p && p !== root) {
            if (/(^|\s)(textcol|vu-text|city-body|vtitle-col)(\s|$)/.test(p.className)) { cont = p; break; }
            p = p.parentElement;
          }
          if (!cont) cont = root;
          const a = textRect(el), t = textRect(timeEl);
          if (a && t) texts.push(entry('artist+time', content(cont), { l: a.l, r: t.r, mid: (a.l + t.r) / 2 }));
        }
        continue;
      }
      // Время, стоящее в одной строке после исполнителя (№13, №22, №26, №27), — часть
      // строки исполнителя, а не отдельная колонка: его левый край не обязан быть крайним.
      const tcs = getComputedStyle(el);
      if (role === 'time' && el.previousElementSibling && tcs.display.indexOf('inline') === 0) continue;
      if (role === 'title' && style === 'vtitle') {
        // Вертикальное название: прижато к своему краю оверлея, по центру не проверяем.
        if (h === 'c') continue;
        const r = el.getBoundingClientRect();
        const e = h === 'r' ? root.getBoundingClientRect().right : root.getBoundingClientRect().left;
        const g = h === 'r' ? r.right : r.left;
        texts.push({ role, delta: +(g - e).toFixed(2), ok: Math.abs(g - e) <= 3, vertical: true });
        continue;
      }
      const ir = textRect(el);
      if (!ir) continue;
      let cont = null;
      const par = el.parentElement;
      const pcs = par ? getComputedStyle(par) : null;
      if (role === 'title' && /(^|\s)vu-title(\s|$)/.test(el.className)) cont = el;
      else if (pcs && pcs.display.indexOf('flex') >= 0 && pcs.flexDirection.indexOf('row') === 0) cont = el;
      else {
        let p = el.parentElement;
        while (p && p !== root) {
          if (/(^|\s)(textcol|vu-text|city-body|vtitle-col)(\s|$)/.test(p.className)) { cont = p; break; }
          p = p.parentElement;
        }
        if (!cont) cont = root;
      }
      texts.push(entry(role, content(cont), ir));
    }
    // Очередь: строки (снизу над треком, сверху под ним) и горизонтальная лента чипов.
    let queue = null;
    const q = root.querySelector('[data-role="queue"]');
    if (vis(q) && q.children.length) {
      const c = content(q);
      // №18 «Код» в любом углу: строки очереди не переворачиваются, прижаты влево.
      const qh = style === 'code' ? 'l' : h;
      const rows = [...q.children].filter(vis);
      const horizontal = /row/.test(getComputedStyle(q).flexDirection);
      if (horizontal) {
        const rs = rows.map((r) => r.getBoundingClientRect());
        const u = { l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)) };
        u.mid = (u.l + u.r) / 2;
        queue = entry('queue', c, u, { horizontal: true, rows: rows.length }, qh);
      } else {
        const list = rows.map((r, i) => {
          const ir0 = textRect(r);
          // Длинная строка обрезана своей коробкой (многоточие): край меряем по
          // видимому тексту, иначе range «вылезает» за колонку и ломает проверку.
          const rb = r.getBoundingClientRect();
          const ir = ir0 ? { l: Math.max(ir0.l, rb.left), r: Math.min(ir0.r, rb.right) } : null;
          if (ir) ir.mid = (ir.l + ir.r) / 2;
          return ir && ir.r > ir.l ? Object.assign(entry('queue' + (i + 1), c, ir, null, qh), { text: r.textContent.slice(0, 40) }) : null;
        }).filter(Boolean);
        queue = { rows: list.length, bad: list.filter((x) => !x.ok).length, list: list.filter((x) => !x.ok).slice(0, 4) };
      }
    }
    // Визуализатор: столбики/сегменты/полосы растут от нужного края.
    const viz = [];
    for (const box of [...root.querySelectorAll('[data-role="viz"]')]) {
      if (!vis(box)) continue;
      for (const z of [...box.querySelectorAll('[data-viz]')]) {
        if (!vis(z)) continue;
        const kind = z.dataset.viz;
        const c = content(z);
        const kids = [...z.children].filter((k) => k.getBoundingClientRect().width > 0);
        if (!kids.length) continue;
        if (kind === 'nd') {
          // Стрелки VU — у дальнего края: справа это левый край, слева — правый.
          const r = box.getBoundingClientRect();
          const rr = root.getBoundingClientRect();
          const e = vizH === 'r' ? rr.left : vizH === 'l' ? rr.right : null;
          if (e == null) continue;
          const g = vizH === 'r' ? r.left : r.right;
          viz.push({ kind, delta: +(g - e).toFixed(2), ok: Math.abs(g - e) <= 3, far: true });
          continue;
        }
        if (kind === 'w') continue;   // волна занимает всю ширину
        // Столбики и лента на всю ширину: по центру у них нет своего края,
        // центрируется сама коробка оверлея.
        if (vizH === 'c' && (kind === 'b' || kind === 'sp' || kind === 'g')) continue;
        const check = kind === 'bw' ? kids : [kids[0]];
        for (const k of check) {
          const r = k.getBoundingClientRect();
          const ir = { l: r.left, r: r.right, mid: (r.left + r.right) / 2 };
          viz.push(Object.assign(entry(kind, c, ir, { kind }, vizH), { kind }));
          if (kind !== 'bw') break;
        }
      }
    }
    // Шкала прогресса: ячейки заполняются от края.
    let prog = null;
    const p = root.querySelector('[data-role="prog"]');
    if (vis(p) && p.children.length && vizH !== 'c') {
      const r = p.children[0].getBoundingClientRect();
      prog = entry('prog', content(p), { l: r.left, r: r.right, mid: (r.left + r.right) / 2 }, null, vizH);
    }
    const bad = (code && !code.ok ? 1 : 0) + texts.filter((x) => !x.ok).length
      + (queue ? (queue.horizontal || queue.bad == null ? (queue.ok ? 0 : 1) : queue.bad) : 0)
      + viz.filter((x) => !x.ok).length + (prog && !prog.ok ? 1 : 0);
    return { style, h, vizH, code, bad, texts, queue, viz, prog };
  };
  // Режим --queue: каждая строка очереди — начало (номер, название) видно,
  // лишний конец обрезан (многоточием), домашний край строки — у края колонки.
  window.__ovQueue = () => {
    const root = document.querySelector('.style-root');
    const ov = document.getElementById('ov');
    if (!root || !ov) return { error: 'нет .style-root' };
    const style = root.dataset.style;
    const h = ov.dataset.h || 'r';
    // №18 «Код»: строки не переворачиваются, всё слева (как в --align).
    const edge = style === 'code' ? 'l' : h;
    const EPS = 2.5;
    const q = root.querySelector('[data-role="queue"]');
    if (!q || q.hidden || !q.offsetParent) return { error: 'нет очереди' };
    const qr = q.getBoundingClientRect();
    const qcs = getComputedStyle(q);
    const content = {
      l: qr.left + (parseFloat(qcs.paddingLeft) || 0),
      r: qr.right - (parseFloat(qcs.paddingRight) || 0)
    };
    content.mid = (content.l + content.r) / 2;
    const rows = [...q.children].filter((el) => el.offsetParent && el.getBoundingClientRect().width > 0);
    if (!rows.length) return { error: 'нет строк очереди' };
    const horizontal = /row/.test(getComputedStyle(q).flexDirection);
    const hasPseudo = (el) => {
      for (const pe of ['::before', '::after']) {
        const c = getComputedStyle(el, pe).content;
        if (c && c !== 'none' && c !== 'normal') return true;
      }
      return false;
    };
    // Левый/правый край текста строки. У подписей-псевдоэлементов range их не видит —
    // тогда меряем коробку (как в --align).
    const textEdge = (el) => {
      const r = el.getBoundingClientRect();
      if (hasPseudo(el)) return { l: r.left, r: r.right };
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const ir = range.getBoundingClientRect();
        if (ir.width) return { l: ir.left, r: ir.right };
      } catch (e) { /* ниже — коробка */ }
      return { l: r.left, r: r.right };
    };
    const target = (c) => (edge === 'r' ? c.r : edge === 'l' ? c.l : c.mid);
    const home = (r) => (edge === 'r' ? r.right : edge === 'l' ? r.left : (r.left + r.right) / 2);
    const columnW = content.r - content.l;
    const list = rows.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ir = textEdge(el);
      const pseudo = hasPseudo(el);
      const textW = ir.r - ir.l;
      // Строка не влезает в колонку очереди (вертикально) или в свою коробку (лента).
      const overColumn = textW > columnW + 1 || (r.right - r.left) > columnW + 1;
      const overOwn = el.scrollWidth > el.clientWidth + 1 || textW > (r.right - r.left) + 1;
      const overflow = overColumn || overOwn;
      // Коробка строки не вылезает за колонку: иначе начало съедает уже сама очередь.
      const inside = r.left >= content.l - EPS && r.right <= content.r + EPS;
      // Первый видимый символ — начало строки: левый край текста не левее
      // своей коробки и колонки очереди.
      const startOk = ir.l >= Math.max(r.left, content.l) - EPS;
      // Конец при обрезке уходит за видимый край и режется (у псевдоэлементов
      // правый край коробки уже обрезан, поэтому признак — scrollWidth).
      const endCut = pseudo ? el.scrollWidth > el.clientWidth + 1 : ir.r > Math.min(r.right, content.r) + EPS;
      return {
        text: el.textContent.slice(0, 40),
        overflow,
        inside,
        startOk,
        endCut,
        ellipsis: cs.textOverflow === 'ellipsis',
        startAtLeft: cs.textAlign === 'left' || cs.textAlign === 'start',
        delta: +(home(r) - target(content)).toFixed(2),
        aligned: Math.abs(home(r) - target(content)) <= EPS
      };
    });
    for (const x of list) {
      // Не влезает: начало видно, конец обрезан многоточием; коробка — в колонке.
      // Влезает: строка прижата к домашнему краю (вертикальная очередь).
      x.ok = x.inside
        && (x.overflow ? (x.startOk && x.endCut && x.startAtLeft && x.ellipsis) : (horizontal || x.aligned));
    }
    // Горизонтальная лента (№7): у края колонки стоит весь ряд чипов (как в --align).
    let aligned;
    let union = null;
    let unionDelta = null;
    if (horizontal) {
      const rs = rows.map((el) => el.getBoundingClientRect());
      union = { l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)) };
      union.mid = (union.l + union.r) / 2;
      const uHome = edge === 'r' ? union.r : edge === 'l' ? union.l : union.mid;
      unionDelta = +(uHome - target(content)).toFixed(2);
      aligned = Math.abs(unionDelta) <= EPS;
    } else {
      aligned = list.every((x) => x.aligned);
    }
    return {
      style, h: edge, horizontal, aligned,
      queue: { l: +content.l.toFixed(2), r: +content.r.toFixed(2) },
      union: union ? { l: +union.l.toFixed(2), r: +union.r.toFixed(2) } : null,
      unionDelta,
      overflow: list.filter((x) => x.overflow).length,
      rows: list
    };
  };
});

// ---------- режим --features: каждый ключ каждого стиля выкл/вкл ----------
if (featuresMode) {
  const ALL_FEATURES = ['cover', 'time', 'spin', 'prog', 'osc', 'viz', 'marq', 'lang', 'count', 'fade', 'fill', 'nums'];
  const onVal = (k) => (k === 'count' ? '3' : k === 'lang' ? 'en' : k === 'viz' ? 'spectrum' : '1');
  const offVal = (k) => (k === 'viz' ? 'wave' : '0');
  const labelText = (l) => Object.values(l)
    .filter((v) => v && v !== 'normal' && v !== 'none' && v !== '""').join(' ').trim();
  let featureTotal = 0, featureBad = 0;
  const featureFailures = [];
  async function open(style, feat) {
    errors.length = 0;
    const suffix = feat ? '&feat=' + encodeURIComponent(feat) : '';
    const url = `http://127.0.0.1:${port}/overlay/playlist?demo=1&style=${encodeURIComponent(style)}`
      + `&pos=br&nick=1&track=long${suffix}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(380);
    return { r: await page.evaluate(() => window.__ovFeature()), errs: [...new Set(errors)] };
  }
  for (const style of styles) {
    const def = STYLE_DEFS.find((s) => s.id === style);
    if (!def) continue;
    const declared = def.features;
    const base = await open(style, '');
    featureTotal++;
    if (base.errs.length) {
      featureBad++; featureFailures.push({ style, key: 'базовый', msg: 'ошибки страницы', errs: base.errs });
    }
    for (const key of ALL_FEATURES) {
      const off = await open(style, key + ':' + offVal(key));
      const on = await open(style, key + ':' + onVal(key));
      featureTotal += 2;
      const fail = (msg, extra) => { featureBad++; featureFailures.push({ style, key, msg, ...extra }); };
      if (off.errs.length || on.errs.length) { fail('ошибки страницы', { off: off.errs, on: on.errs }); continue; }
      if (!declared.includes(key)) {
        if (off.r.sig !== base.r.sig || on.r.sig !== base.r.sig) fail('чужой ключ изменил вид');
        continue;
      }
      if (key === 'fill') {
        // fill — ключ данных (добор из волны), разметка от него не зависит; проверяем в Node-тестах.
        if (off.r.sig !== on.r.sig) fail('fill не должен менять разметку');
        continue;
      }
      if (key === 'viz') {
        // Вид визуализатора: страница рисует именно выбранный вид (wave/spectrum).
        if (!off.r.views.length) { fail('у стиля нет визуализатора для вида', { views: off.r.views }); continue; }
        if (off.r.views.some((v) => v !== 'wave') || on.r.views.some((v) => v !== 'spectrum')) {
          fail('вид визуализатора не переключается', { off: off.r.views, on: on.r.views });
        }
        continue;
      }
      if (key === 'lang') {
        if (labelText(off.r.labels) || !labelText(on.r.labels)) fail('подписи не переключаются', { off: off.r.labels, on: on.r.labels });
        continue;
      }
      if (key === 'count') {
        if (off.r.queueRows !== 0 || on.r.queueRows !== 3) fail('строки очереди не переключаются', { off: off.r.queueRows, on: on.r.queueRows });
        continue;
      }
      if (key === 'fade') {
        if (!(Number(off.r.secondOpacity) === 1 && Number(on.r.secondOpacity) < 1)) fail('затухание не переключается', { off: off.r.secondOpacity, on: on.r.secondOpacity });
        continue;
      }
      if (key === 'nums') {
        if (/^1\.\s/.test(off.r.firstText) || !/^1\.\s/.test(on.r.firstText)) fail('номера не переключаются', { off: off.r.firstText, on: on.r.firstText });
        continue;
      }
      if (!off.r.visible[key] && on.r.visible[key]) continue;
      fail('элемент не переключается', { off: off.r.visible[key], on: on.r.visible[key], titleInfo: on.r.titleInfo });
    }
    if (styles.indexOf(style) % 5 === 0) console.log('… features:', style, 'ошибок', featureBad);
  }
  // Моушн: свой набор «Что показывать», очередь к нему не относится.
  const MOTION_SHOW = ['cover', 'time', 'spin', 'prog', 'osc', 'viz', 'marq', 'lang'];
  const QUEUE_KEYS = ['count', 'fade', 'fill', 'nums'];
  let motionTotal = 0;
  async function openMotion(style, feat) {
    errors.length = 0;
    const suffix = feat ? '&feat=' + encodeURIComponent(feat) : '';
    const url = `http://127.0.0.1:${port}/overlay/motion?demo=1&style=${encodeURIComponent(style)}`
      + `&pos=tc&nick=1&track=long&paused=1${suffix}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(240);
    // Показ по таймеру не ждём: снимаем класс видимости и завершаем анимации (без правок страницы).
    await page.evaluate(() => {
      const ov = document.getElementById('ov');
      if (!ov) return;
      ov.classList.remove('motion-hidden');
      ov.style.visibility = 'visible';
      ov.getAnimations({ subtree: true }).forEach((a) => { try { a.finish(); } catch (e) { /* бесконечные */ } });
    });
    await page.waitForTimeout(60);
    return { r: await page.evaluate(() => window.__ovFeature()), errs: [...new Set(errors)] };
  }
  for (const style of styles) {
    const def = STYLE_DEFS.find((s) => s.id === style);
    if (!def) continue;
    const declared = def.features.filter((k) => MOTION_SHOW.includes(k));
    const base = await openMotion(style, '');
    motionTotal++;
    if (base.errs.length) {
      featureBad++; featureFailures.push({ page: 'motion', style, key: 'базовый', msg: 'ошибки страницы', errs: base.errs });
    }
    for (const key of [...MOTION_SHOW, ...QUEUE_KEYS]) {
      const off = await openMotion(style, key + ':' + offVal(key));
      const on = await openMotion(style, key + ':' + onVal(key));
      motionTotal += 2;
      const fail = (msg, extra) => { featureBad++; featureFailures.push({ page: 'motion', style, key, msg, ...extra }); };
      if (off.errs.length || on.errs.length) { fail('ошибки страницы', { off: off.errs, on: on.errs }); continue; }
      if (QUEUE_KEYS.includes(key) || !declared.includes(key)) {
        if (off.r.sig !== base.r.sig || on.r.sig !== base.r.sig) fail('ключ не из набора моушна изменил вид');
        continue;
      }
      if (key === 'viz') {
        if (!off.r.views.length) { fail('у стиля нет визуализатора для вида', { views: off.r.views }); continue; }
        if (off.r.views.some((v) => v !== 'wave') || on.r.views.some((v) => v !== 'spectrum')) {
          fail('вид визуализатора не переключается', { off: off.r.views, on: on.r.views });
        }
        continue;
      }
      if (key === 'lang') {
        if (labelText(off.r.labels) || !labelText(on.r.labels)) fail('подписи не переключаются', { off: off.r.labels, on: on.r.labels });
        continue;
      }
      if (!off.r.visible[key] && on.r.visible[key]) continue;
      fail('элемент не переключается', { off: off.r.visible[key], on: on.r.visible[key], titleInfo: on.r.titleInfo });
    }
    if (styles.indexOf(style) % 5 === 0) console.log('… features motion:', style, 'ошибок', featureBad);
  }
  featureTotal += motionTotal;
  console.log(JSON.stringify({
    mode: 'features', total: featureTotal, playlist: featureTotal - motionTotal, motion: motionTotal,
    bad: featureBad, failures: featureFailures.slice(0, 40)
  }, null, 2));
  await browser.close();
  server.close();
  fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
  process.exit(featureBad ? 1 : 0);
}

let total = 0, bad = 0, pageErrors = 0;
const failures = [];
const fontsByStyle = new Map();
const fontFailures = [];
const gridShots = new Map();          // id стиля → PNG (br, плейлист, средний трек) для общей сетки
let shotCount = 0;
const shotsDir = path.join(root, '.dsh', 'shots');
if (shots || outlineMode) fs.mkdirSync(shotsDir, { recursive: true });

// ---------- режим --outline: обводка вкл/выкл у каждого стиля + снимки на светлом фоне ----------
if (outlineMode) {
  let oTotal = 0, oBad = 0, oViz = 0;
  const oFailures = [];
  const bgAlpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return 1;
    const p = m[1].split(',').map(Number);
    return p.length > 3 ? p[3] : 1;
  };
  async function grab(style, on) {
    errors.length = 0;
    const url = `http://127.0.0.1:${port}/overlay/playlist?demo=1&style=${encodeURIComponent(style)}`
      + `&pos=br&nick=1&track=medium&feat=outline:${on ? '1' : '0'}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(380);
    const info = await page.evaluate(() => {
      document.documentElement.style.background = '#f2eee6';
      document.body.style.background = '#f2eee6';
      const root = document.querySelector('.style-root');
      const title = root && root.querySelector('[data-role="title"]');
      if (!root || !title) return { error: 'нет названия' };
      const cs = getComputedStyle(title);
      const R = root.getBoundingClientRect();
      const x = Math.max(0, Math.floor(R.left - 420));
      const y = Math.max(0, Math.floor(R.top - 90));
      const r = Math.min(1920, Math.ceil(R.right + 90));
      const b = Math.min(1080, Math.ceil(R.bottom + 90));
      // OV6: у визуализатора не должно быть ни рамки, ни тени, ни штриха — даже при «Чёрной обводке».
      const vizBad = [];
      for (const el of root.querySelectorAll('[data-role="viz"], [data-role="viz"] *')) {
        const s = getComputedStyle(el);
        const border = ['Top', 'Right', 'Bottom', 'Left'].map((side) => ({
          w: s['border' + side + 'Width'], c: s['border' + side + 'Color']
        })).filter((bb) => (parseFloat(bb.w) || 0) > 0 && /rgba?\(0,\s*0,\s*0/.test(bb.c));
        const bad = s.boxShadow !== 'none' || s.textShadow !== 'none' || s.filter !== 'none'
          || (s.outlineStyle !== 'none' && (parseFloat(s.outlineWidth) || 0) > 0)
          || (parseFloat(s.webkitTextStrokeWidth) || 0) > 0 || border.length > 0;
        if (bad) {
          vizBad.push({
            cls: String(el.className || el.tagName), boxShadow: s.boxShadow, textShadow: s.textShadow,
            filter: s.filter, outline: s.outlineStyle + ' ' + s.outlineWidth,
            stroke: s.webkitTextStrokeWidth, border: border.map((bb) => bb.w + ' ' + bb.c)
          });
        }
      }
      return {
        stroke: cs.webkitTextStrokeWidth, shadow: cs.textShadow,
        bg: getComputedStyle(root).backgroundColor, vizBad, vizCount: root.querySelectorAll('[data-viz]').length,
        clip: { x, y, width: Math.max(1, r - x), height: Math.max(1, b - y) }
      };
    });
    const png = info.error ? null : await page.screenshot({ clip: info.clip });
    return { info, errs: [...new Set(errors)], png };
  }
  async function compose(def, clip, offPng, onPng) {
    const gap = 12, labelH = 26, headH = 30;
    const W = clip.width * 2 + gap * 3, H = headH + gap + clip.height + labelH + gap;
    const cp = await context.newPage();
    await cp.setViewportSize({ width: W, height: H });
    await cp.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    const dataUrl = await cp.evaluate(async (arg) => {
      const cv = document.createElement('canvas');
      cv.width = arg.W; cv.height = arg.H;
      document.body.append(cv);
      const ctx = cv.getContext('2d');
      const load = (b64) => new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = 'data:image/png;base64,' + b64;
      });
      const [a, b] = await Promise.all([load(arg.off), load(arg.on)]);
      ctx.fillStyle = '#f2eee6'; ctx.fillRect(0, 0, arg.W, arg.H);
      ctx.fillStyle = '#1b1b1b'; ctx.font = '700 19px sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(arg.title + ' · обводка', arg.gap, arg.headH / 2 + 2);
      const ty = arg.headH + arg.gap;
      if (a) ctx.drawImage(a, arg.gap, ty, arg.clip.width, arg.clip.height);
      if (b) ctx.drawImage(b, arg.gap * 2 + arg.clip.width, ty, arg.clip.width, arg.clip.height);
      ctx.font = '600 16px sans-serif';
      ctx.fillText('выкл', arg.gap, ty + arg.clip.height + arg.labelH / 2);
      ctx.fillText('вкл', arg.gap * 2 + arg.clip.width, ty + arg.clip.height + arg.labelH / 2);
      return cv.toDataURL('image/png');
    }, { W, H, gap, labelH, headH, clip, off: offPng.toString('base64'), on: onPng.toString('base64'), title: '№' + def.num + ' ' + def.name });
    fs.writeFileSync(path.join(shotsDir, 'outline-' + def.id + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    await cp.close();
  }
  for (const style of styles) {
    const def = STYLE_DEFS.find((s) => s.id === style);
    if (!def) continue;
    const off = await grab(style, false);
    const on = await grab(style, true);
    oTotal++;
    oViz += (off.info.vizCount || 0) + (on.info.vizCount || 0);
    const fail = (msg, extra) => { oBad++; oFailures.push({ style, msg, ...extra }); };
    if (off.errs.length || on.errs.length) { fail('ошибки страницы', { off: off.errs, on: on.errs }); continue; }
    if (off.info.error || on.info.error) { fail('нет названия для проверки обводки', { off: off.info, on: on.info }); continue; }
    // Все оверлеи без подложки: страница OBS должна быть прозрачной.
    if (bgAlpha(off.info.bg) !== 0) fail('у оверлея непрозрачный фон', { bg: off.info.bg });
    const so = parseFloat(off.info.stroke) || 0, sn = parseFloat(on.info.stroke) || 0;
    if (so !== 0) fail('при выключенной обводке осталась обводка букв', { off: off.info.stroke });
    if (!(sn > 0 || (on.info.shadow !== 'none' && on.info.shadow !== off.info.shadow))) fail('при включённой обводке нет ни обводки, ни тени', { on: on.info });
    if (on.info.stroke === off.info.stroke && on.info.shadow === off.info.shadow) fail('вкл/выкл не меняет text-shadow и -webkit-text-stroke', { off: off.info, on: on.info });
    // Визуализатор без обводки: проверяем и при выключенной, и при включённой «Чёрной обводке».
    if (off.info.vizBad.length || on.info.vizBad.length) {
      fail('у визуализатора осталась обводка/тень', { off: off.info.vizBad.slice(0, 4), on: on.info.vizBad.slice(0, 4) });
    }
    if (off.png && on.png) await compose(def, on.info.clip, off.png, on.png);
  }
  console.log(JSON.stringify({ mode: 'outline', total: oTotal, vizChecked: oViz, bad: oBad, shots: oTotal, failures: oFailures.slice(0, 40) }, null, 2));
  await browser.close();
  server.close();
  fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
  process.exit(oBad ? 1 : 0);
}

// ---------- режим --align: край текста/очереди/визуализатора у своего края колонки ----------
if (alignMode) {
  let combos = 0, checks = 0, badCombos = 0;
  const alignFailures = [];
  const addBad = (x) => (x.horizontal ? (x.ok ? 0 : 1) : x.bad || 0);
  for (const p of pages) {
    for (const style of styles) {
      for (const pos of positions) {
        errors.length = 0;
        const url = `http://127.0.0.1:${port}/overlay/${p}?demo=1&style=${encodeURIComponent(style)}`
          + `&pos=${pos}&nick=1&track=${args.get('track') || 'normal'}`;
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(p === 'motion' ? 700 : 260);
        if (p === 'motion') {
          await page.evaluate(() => {
            const ov = document.getElementById('ov');
            if (!ov) return;
            ov.classList.remove('motion-hidden');
            ov.classList.add('motion-in');
            ov.getAnimations({ subtree: true }).forEach((a) => { try { a.finish(); } catch (e) { /* бесконечные */ } });
          });
          await page.waitForTimeout(80);
        }
        const r = await page.evaluate(() => window.__ovAlign());
        combos++;
        if (r.error) { badCombos++; alignFailures.push({ p, style, pos, msg: r.error }); continue; }
        if (errors.length) { badCombos++; alignFailures.push({ p, style, pos, errors: [...new Set(errors)] }); continue; }
        const codeBad = !!(r.code && !r.code.ok);
        const textBad = r.texts.filter((x) => !x.ok);
        const vizBad = r.viz.filter((x) => !x.ok);
        const qBad = r.queue ? addBad(r.queue) : 0;
        checks += (r.code ? 1 : 0) + r.texts.length
          + (r.queue ? (r.queue.horizontal ? 1 : r.queue.rows) : 0) + r.viz.length + (r.prog ? 1 : 0);
        if (codeBad || textBad.length || vizBad.length || qBad || (r.prog && !r.prog.ok)) {
          badCombos++;
          alignFailures.push({
            p, style, pos, h: r.h, vizH: r.vizH, code: codeBad ? r.code : null, texts: textBad,
            queue: r.queue && (r.queue.horizontal ? (r.queue.ok ? null : r.queue) : r.queue.list),
            viz: vizBad, prog: r.prog && !r.prog.ok ? r.prog : null
          });
        }
        if (combos % 60 === 0) console.log('… align:', combos, 'сочетаний, плохих', badCombos);
      }
    }
  }
  console.log(JSON.stringify({
    mode: 'align', combos, checks, badCombos, styles: styles.length, positions: positions.length, pages,
    failures: alignFailures.slice(0, 80)
  }, null, 2));
  await browser.close(); server.close();
  fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
  process.exit(badCombos ? 1 : 0);
}

// ---------- режим --shift: сдвиг и размер только переносят/масштабируют оверлей ----------
if (shiftMode) {
  const shifts = [[0, 0], [300, 200], [-300, -200], [900, 500], [-900, -500]];
  const sizes = [80, 100, 250];
  const shiftTrack = args.get('track') || 'normal';
  const TOL = 1.01;
  const same = (a, b) => {
    if (!a || !b) return !a && !b;
    return ['l', 't', 'r', 'b'].every((k) => Math.abs(a[k] - b[k]) <= TOL);
  };
  const diff = (ref, cur, path, out) => {
    if (!same(ref, cur)) out.push({ path, ref, cur });
  };
  let total = 0, bad = 0, pageErrors = 0, clipBad = 0;
  const failures = [];
  async function openShift(style, pos, p) {
    errors.length = 0;
    const url = `http://127.0.0.1:${port}/overlay/${p}?demo=1&style=${encodeURIComponent(style)}`
      + `&pos=${pos}&nick=1&track=${shiftTrack}&dx=0&dy=0&size=100`;
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
    await page.waitForTimeout(p === 'motion' ? 300 : 120);
    if (p === 'motion') {
      await page.evaluate(() => {
        const ov = document.getElementById('ov');
        if (!ov) return;
        ov.classList.remove('motion-hidden');
        ov.classList.add('motion-in');
        ov.getAnimations({ subtree: true }).forEach((a) => { try { a.finish(); } catch (e) { /* бесконечные */ } });
      });
      await page.waitForTimeout(70);
    }
    return { r: await page.evaluate(() => window.__ovLayout()), errs: [...new Set(errors)] };
  }
  // Сдвиг/размер меняются на уже открытой странице (демо-хук), без перезагрузки:
  // тот же путь applyConfig/boxStyle/раскладки, что и после сохранения настроек.
  async function applyShift(dx, dy, size) {
    errors.length = 0;
    const ok = await page.evaluate((o) => {
      if (!window.TapDemoSet) return false;
      window.TapDemoSet(o);
      return true;
    }, { dx, dy, size });
    await page.waitForTimeout(45);
    return { ok, r: await page.evaluate(() => window.__ovLayout()), errs: [...new Set(errors)] };
  }
  for (const p of pages) {
    for (const style of styles) {
      for (const pos of positions) {
        const ref = await openShift(style, pos, p);
        if (ref.r.error || ref.errs.length) {
          total++; bad++; pageErrors += ref.errs.length;
          failures.push({ p, style, pos, variant: 'ref', msg: ref.r.error, errs: ref.errs });
          continue;
        }
        for (const [dx, dy] of shifts) {
          for (const size of sizes) {
            if (dx === 0 && dy === 0 && size === 100) continue;
            const cur = await applyShift(dx, dy, size);
            total++;
            if (!cur.ok || cur.r.error || cur.errs.length) {
              bad++; pageErrors += cur.errs.length;
              failures.push({ p, style, pos, dx, dy, size, msg: cur.ok ? cur.r.error : 'нет демо-хука', errs: cur.errs });
              continue;
            }
            const d = [];
            for (const role of ['cover', 'title', 'artist', 'who', 'queue', 'prog']) {
              diff(ref.r.boxes[role], cur.r.boxes[role], role, d);
            }
            if (ref.r.viz.length !== cur.r.viz.length) d.push({ path: 'viz:len', ref: ref.r.viz.length, cur: cur.r.viz.length });
            ref.r.viz.forEach((b, i) => diff(b, cur.r.viz[i], 'viz' + i, d));
            if (ref.r.rows.length !== cur.r.rows.length) d.push({ path: 'rows:len', ref: ref.r.rows.length, cur: cur.r.rows.length });
            ref.r.rows.forEach((b, i) => diff(b, cur.r.rows[i], 'row' + i, d));
            if (ref.r.qfd !== cur.r.qfd) d.push({ path: 'queue:direction', ref: ref.r.qfd, cur: cur.r.qfd });
            // №8: текст не обрезан — коробка названия не меньше текста (кроме бегущей строки).
            let clip = null;
            if (style === 'vtitle' && cur.r.titleInfo && !cur.r.titleInfo.mq) {
              const ti = cur.r.titleInfo;
              if (ti.sw > ti.cw + 1 || ti.sh > ti.ch + 1) { clip = ti; clipBad++; }
            }
            if (d.length || cur.r.overlaps.length || clip) {
              bad++;
              failures.push({ p, style, pos, dx, dy, size, layout: d.slice(0, 6), overlaps: cur.r.overlaps, clip });
            }
          }
        }
        if (total && total % 300 < 20) console.log('… shift:', total, 'вариантов, плохих', bad);
      }
    }
  }
  console.log(JSON.stringify({
    mode: 'shift', track: shiftTrack, total, bad, pageErrors, clipBad,
    shifts, sizes, styles: styles.length, positions: positions.length, pages,
    failures: failures.slice(0, 60)
  }, null, 2));
  await browser.close(); server.close();
  fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}

// ---------- режим --queue: начало строки очереди видно, конец обрезан, край у колонки ----------
if (queueMode) {
  let combos = 0, rowsTotal = 0, overflowRows = 0, badCombos = 0;
  const queueFailures = [];
  for (const style of styles) {
    for (const pos of positions) {
      errors.length = 0;
      const url = `http://127.0.0.1:${port}/overlay/playlist?demo=1&style=${encodeURIComponent(style)}`
        + `&pos=${pos}&nick=1&track=long&queue=long`;
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
      await page.waitForTimeout(180);
      const r = await page.evaluate(() => window.__ovQueue());
      combos++;
      if (r.error) { badCombos++; queueFailures.push({ style, pos, msg: r.error }); continue; }
      if (errors.length) { badCombos++; queueFailures.push({ style, pos, errors: [...new Set(errors)] }); continue; }
      const bad = r.rows.filter((x) => !x.ok);
      rowsTotal += r.rows.length;
      overflowRows += r.overflow;
      // Длинная очередь обязана реально не влезать в каждом стиле — иначе проверка пустая.
      if (!r.overflow) { badCombos++; queueFailures.push({ style, pos, msg: 'длинная строка не обрезалась', rows: r.rows.length }); continue; }
      if (!r.aligned || bad.length) {
        badCombos++;
        queueFailures.push({
          style, pos, h: r.h, aligned: r.aligned, horizontal: r.horizontal,
          queue: r.queue, union: r.union, unionDelta: r.unionDelta,
          rows: (bad.length ? bad : r.rows).slice(0, 4).map((x) => ({
            text: x.text, overflow: x.overflow, inside: x.inside, startOk: x.startOk, endCut: x.endCut,
            startAtLeft: x.startAtLeft, ellipsis: x.ellipsis, delta: x.delta
          }))
        });
      }
      if (combos % 30 === 0) console.log('… queue:', combos, 'сочетаний, плохих', badCombos);
    }
  }
  console.log(JSON.stringify({
    mode: 'queue', combos, rows: rowsTotal, overflow: overflowRows, bad: badCombos,
    styles: styles.length, positions, failures: queueFailures.slice(0, 80)
  }, null, 2));
  await browser.close(); server.close();
  fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
  process.exit(badCombos ? 1 : 0);
}

for (const p of pages) {
  for (const style of styles) {
    for (const pos of positions) {
      for (const track of tracks) {
        const url = `http://127.0.0.1:${port}/overlay/${p}?demo=1&style=${encodeURIComponent(style)}&pos=${pos}&nick=1&track=${track}&dx=${shotDx}&dy=${shotDy}&size=${shotSize}`;
        errors.length = 0;
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(p === 'motion' ? 1000 : 220);
        // Шрифт стиля: ждём document.fonts.ready и проверяем именно его семейство и вес.
        const font = await page.evaluate(async () => {
          await document.fonts.ready;
          const rootEl = document.querySelector('.style-root');
          const el = rootEl && (rootEl.querySelector('[data-role="title"]') || rootEl);
          if (!el) return { error: 'нет текста стиля' };
          const cs = getComputedStyle(el);
          const family = String(cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
          const weight = cs.fontWeight || '400';
          const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === family);
          return {
            family, weight,
            check: document.fonts.check(weight + ' 20px "' + family + '"', 'Ёж'),
            faceLoaded: faces.some((f) => f.status === 'loaded'),
            faces: faces.map((f) => f.status)
          };
        });
        const prev = fontsByStyle.get(style);
        if (!prev) fontsByStyle.set(style, font);
        if (font.error || !font.check || !font.faceLoaded) {
          if (!prev) fontFailures.push({ style, page: p, pos, track, font });
        }
        const r = await page.evaluate(() => window.__ovCheck());
        total++;
        if (errors.length) { pageErrors += errors.length; failures.push({ p, style, pos, track, errors: [...new Set(errors)].slice(0, 4) }); }
        if (r.overlaps && r.overlaps.length) { bad++; failures.push({ p, style, pos, track, overlaps: r.overlaps, boxes: r.boxes }); }
        if (p === 'motion' && (pos === 'tc' || pos === 'bc') && Math.abs(r.center - 960) > 2) {
          bad++; failures.push({ p, style, pos, track, center: r.center, translate: r.translate, visible: r.visible, root: r.root, boxes: r.boxes });
        }
        if (shots && (pos === 'br' || pos === 'tl')) {
          if (p === 'motion') await page.waitForTimeout(900);
          await page.evaluate(() => {
            document.documentElement.style.background = '#151a22';
            document.body.style.background = '#151a22';
          });
          const png = await page.screenshot();
          shotCount++;
          fs.writeFileSync(path.join(shotsDir, `${p}-${style}-${pos}-${track}${shotSuffix}.png`), png);
          if (p === 'playlist' && pos === 'br' && track === 'medium') gridShots.set(style, png);
        }
        if ((total % 100) === 0) console.log('…', total, 'сочетаний, ошибок', bad);
      }
    }
  }
}

// Общая картинка-сетка: все проверенные стили в br на тёмно-сером фоне, с подписями номеров.
async function makeGrid(shotsMap) {
  if (!shotsMap.size) return;
  const defs = new Map(STYLE_DEFS.map((s) => [s.id, s]));
  const items = styles.filter((id) => shotsMap.has(id)).map((id) => ({
    id, num: defs.get(id) ? defs.get(id).num : '', name: defs.get(id) ? defs.get(id).name : id,
    b64: shotsMap.get(id).toString('base64')
  }));
  const cols = 5, tileW = 384, tileH = 216, gap = 8, labelH = 26;
  const rows = Math.ceil(items.length / cols);
  const W = cols * tileW + (cols + 1) * gap;
  const H = rows * (tileH + labelH) + (rows + 1) * gap;
  const gp = await context.newPage();
  await gp.setViewportSize({ width: W, height: H });
  await gp.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  const dataUrl = await gp.evaluate(async (arg) => {
    const cv = document.createElement('canvas');
    cv.width = arg.W; cv.height = arg.H;
    cv.style.display = 'block';
    document.body.append(cv);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#151a22'; ctx.fillRect(0, 0, arg.W, arg.H);
    const imgs = await Promise.all(arg.items.map((x) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = 'data:image/png;base64,' + x.b64;
    })));
    arg.items.forEach((x, i) => {
      const col = i % arg.cols, row = Math.floor(i / arg.cols);
      const px = arg.gap + col * (arg.tileW + arg.gap);
      const py = arg.gap + row * (arg.tileH + arg.labelH + arg.gap);
      if (imgs[i]) ctx.drawImage(imgs[i], px, py, arg.tileW, arg.tileH);
      else { ctx.fillStyle = '#333'; ctx.fillRect(px, py, arg.tileW, arg.tileH); }
      ctx.fillStyle = '#e8edf3'; ctx.font = '600 16px sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText('№' + x.num + ' ' + x.name, px, py + arg.tileH + arg.labelH / 2 + 2);
    });
    return cv.toDataURL('image/png');
  }, { items, cols, tileW, tileH, gap, labelH, W, H });
  fs.writeFileSync(path.join(shotsDir, '_grid-playlist.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  await gp.close();
}
if (shots && gridShots.size > 5) await makeGrid(gridShots);

const fonts = [...fontsByStyle].map(([style, f]) => ({ style, ...f }));
const expected = new Map(STYLE_DEFS.map((s) => [s.id, s.font]));
console.log(JSON.stringify({ total, bad, pageErrors, fontFailures, fonts, expectedFonts: Object.fromEntries(expected), shots: shotCount, failures: failures.slice(0, 30) }, null, 2));
await browser.close();
server.close();
fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
process.exit(bad || pageErrors || fontFailures.length ? 1 : 0);
