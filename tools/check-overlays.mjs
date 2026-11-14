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
});

let total = 0, bad = 0, pageErrors = 0;
const failures = [];
const fontsByStyle = new Map();
const fontFailures = [];
const gridShots = new Map();          // id стиля → PNG (br, плейлист, средний трек) для общей сетки
let shotCount = 0;
const shotsDir = path.join(root, '.dsh', 'shots');
if (shots) fs.mkdirSync(shotsDir, { recursive: true });

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
