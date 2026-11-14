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
    const sig = JSON.stringify({
      style: root.dataset.style, visible, labels, queueRows: rows.length,
      first: rows[0] ? rows[0].textContent : '', second: secondOpacity,
      title: title ? title.textContent : '', artist: artist ? artist.textContent : '', who: who ? who.textContent : '',
      boxes: [box(root), box(root.querySelector('[data-role="cover"]')), box(title), box(artist), box(who), box(time),
        box(root.querySelector('[data-role="prog"]')), box(root.querySelector('[data-role="spin"]')), ...viz.map(box)]
    });
    return {
      visible, labels, queueRows: rows.length, firstText: rows[0] ? rows[0].textContent : '',
      secondOpacity, sig,
      titleInfo: title ? {
        cls: title.className, cw: title.clientWidth, sw: title.scrollWidth,
        w: title.style.width, flex: title.style.flex, overflow: getComputedStyle(title).overflow,
        mq: title.querySelectorAll('.mq,.mqv').length
      } : null
    };
  };
});

// ---------- режим --features: каждый ключ каждого стиля выкл/вкл ----------
if (featuresMode) {
  const ALL_FEATURES = ['cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang', 'count', 'fade', 'fill', 'nums'];
  const onVal = (k) => (k === 'count' ? '3' : k === 'lang' ? 'en' : '1');
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
      const off = await open(style, key + ':0');
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
  console.log(JSON.stringify({ mode: 'features', total: featureTotal, bad: featureBad, failures: featureFailures.slice(0, 40) }, null, 2));
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
  let oTotal = 0, oBad = 0;
  const oFailures = [];
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
      return {
        stroke: cs.webkitTextStrokeWidth, shadow: cs.textShadow,
        bg: getComputedStyle(root).backgroundColor,
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
    const fail = (msg, extra) => { oBad++; oFailures.push({ style, msg, ...extra }); };
    if (off.errs.length || on.errs.length) { fail('ошибки страницы', { off: off.errs, on: on.errs }); continue; }
    if (off.info.error || on.info.error) { fail('нет названия для проверки обводки', { off: off.info, on: on.info }); continue; }
    const so = parseFloat(off.info.stroke) || 0, sn = parseFloat(on.info.stroke) || 0;
    if (so !== 0) fail('при выключенной обводке осталась обводка букв', { off: off.info.stroke });
    if (!(sn > 0 || (on.info.shadow !== 'none' && on.info.shadow !== off.info.shadow))) fail('при включённой обводке нет ни обводки, ни тени', { on: on.info });
    if (on.info.stroke === off.info.stroke && on.info.shadow === off.info.shadow) fail('вкл/выкл не меняет text-shadow и -webkit-text-stroke', { off: off.info, on: on.info });
    if (off.png && on.png) await compose(def, on.info.clip, off.png, on.png);
  }
  console.log(JSON.stringify({ mode: 'outline', total: oTotal, bad: oBad, shots: oTotal, failures: oFailures.slice(0, 40) }, null, 2));
  await browser.close();
  server.close();
  fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
  process.exit(oBad ? 1 : 0);
}

for (const p of pages) {
  for (const style of styles) {
    for (const pos of positions) {
      for (const track of tracks) {
        const url = `http://127.0.0.1:${port}/overlay/${p}?demo=1&style=${encodeURIComponent(style)}&pos=${pos}&nick=1&track=${track}`;
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
          fs.writeFileSync(path.join(shotsDir, `${p}-${style}-${pos}-${track}.png`), png);
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
if (shots) await makeGrid(gridShots);

const fonts = [...fontsByStyle].map(([style, f]) => ({ style, ...f }));
const expected = new Map(STYLE_DEFS.map((s) => [s.id, s.font]));
console.log(JSON.stringify({ total, bad, pageErrors, fontFailures, fonts, expectedFonts: Object.fromEntries(expected), shots: shotCount, failures: failures.slice(0, 30) }, null, 2));
await browser.close();
server.close();
fs.rmSync(coreFonts.tmp, { recursive: true, force: true });
process.exit(bad || pageErrors || fontFailures.length ? 1 : 0);
