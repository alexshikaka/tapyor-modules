// Проверка смены трека в оверлее-плейлисте (15.11): облегчённая «фирменная» анимация стиля.
// Настоящий модуль на поддельном мосте + Chromium. Для каждого стиля и угла:
//   swap вкл  — при смене трека у блока трека идут анимации, через ~0,9 с стоит новое название,
//               очередь сдвинулась, ничего не осталось прозрачным/сдвинутым, ошибок страницы нет;
//   swap выкл — новое название сразу, без анимаций.
// Запуск: node tools/check-swap.mjs [--styles=dos,card] [--positions=br,tl,bc]
import http from 'node:http';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { Overlay } = require('../streamer-pack/overlay/src/index.js');
const { STYLE_DEFS } = require('../streamer-pack/overlay/src/styles.js');

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const styles = args.get('styles') ? args.get('styles').split(',') : STYLE_DEFS.map((s) => s.id);
const positions = args.get('positions') ? args.get('positions').split(',') : ['br', 'tl', 'bc'];

const em = new EventEmitter();
let port = 0;
const fake = {
  store: null,
  settings: { get: () => fake.store, set: (k, v) => { fake.store = v; } },
  http: { mount: (p, fn) => { fake.handle = fn; }, unmount: () => {}, url: (p) => `http://127.0.0.1:${port}${p}` },
  player: { on: (ev, fn) => { em.on(ev, fn); return () => em.off(ev, fn); }, want: () => {}, coverImage: async () => null },
  log: () => {}
};
const overlay = new Overlay(fake);
overlay.start();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/fonts.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(''); return; }
  if (u.pathname.startsWith('/overlay')) { fake.handle(req, res, u.pathname.slice('/overlay'.length), u.searchParams); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;

const T = (title, artist, who) => ({ title, artist, who: who || '' });
const A = T('Группа крови', 'Кино', 'dimon_play'), B = T('Хочешь?', 'Земфира', 'lera_k');
const C = T('Выхода нет', 'Сплин'), D = T('Знаешь ли ты', 'МакSим'), E = T('Последний герой', 'Кино');
const snap = (np, next) => ({ np: { ...np, cover: '', pos: 10, dur: 240, playing: true, at: Date.now() }, next, after: [] });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
const failures = [];
let checks = 0;
const fail = (style, pos, msg, extra) => failures.push({ style, pos, msg, ...extra });

// Анимации блока трека (Web Animations), без бесконечных CSS-анимаций (бегущая строка, вертушка).
const PROBE = () => {
  const roles = ['cover', 'title', 'artist', 'who'];
  const ov = document.getElementById('ov');
  const anims = ov.getAnimations({ subtree: true }).filter((a) => !(window.CSSAnimation && a instanceof CSSAnimation)
    && !(window.CSSTransition && a instanceof CSSTransition) && a.effect && a.effect.target
    && roles.includes(a.effect.target.dataset && a.effect.target.dataset.role));
  const t = ov.querySelector('[data-role="title"]');
  const q = ov.querySelector('[data-role="queue"]');
  const look = {};
  roles.forEach((r) => { const e = ov.querySelector('[data-role="' + r + '"]'); if (e && !e.hidden && e.offsetParent) { const s = getComputedStyle(e); look[r] = { o: Number(s.opacity), clip: s.clipPath, tr: s.transform }; } });
  const bad = look;
  return { anims: anims.length, title: t ? t.textContent : '', q1: q && q.firstElementChild ? q.firstElementChild.textContent : '', bad };
};

for (const style of styles) {
  for (const pos of positions) {
    for (const swap of [true, false]) {
      checks++;
      errors.length = 0;
      overlay.command('save', { style, pos, swap, nick: true, count: 3 });
      await page.goto(`http://127.0.0.1:${port}/overlay/playlist?preview=1`, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      em.emit('state', snap(A, [B, C, D]));
      await page.waitForTimeout(1500);   // первая смена (тишина → трек) тоже анимируется — ждём её конца
      const before = await page.evaluate(PROBE);
      em.emit('state', snap(B, [C, D, E]));
      await page.waitForTimeout(90);
      const mid = await page.evaluate(PROBE);
      await page.waitForTimeout(1400);   // уход ~0,36 с + появление ~0,6 с
      const end = await page.evaluate(PROBE);
      if (errors.length) { fail(style, pos, 'ошибки страницы', { swap, errors: [...new Set(errors)] }); continue; }
      if (!end.title.includes(B.title)) fail(style, pos, 'не появилось новое название', { swap, title: end.title });
      if (end.q1 && !end.q1.includes(C.title)) fail(style, pos, 'очередь не сдвинулась', { swap, q1: end.q1 });
      if (end.anims) fail(style, pos, 'анимации не закончились', { swap, anims: end.anims });
      // После смены вид блока трека тот же, что до неё: прозрачность, обрезка, поворот (наклоны стилей сохраняются).
      const diff = Object.keys(end.bad).filter((r) => before.bad[r] && (Math.abs(end.bad[r].o - before.bad[r].o) > 0.01 || end.bad[r].clip !== before.bad[r].clip || end.bad[r].tr !== before.bad[r].tr));
      if (diff.length) fail(style, pos, 'после смены вид блока изменился', { swap, diff, before: diff.map((r) => before.bad[r]), after: diff.map((r) => end.bad[r]) });
      if (swap && !mid.anims) fail(style, pos, 'смена трека без анимации', { mid });
      if (!swap && (mid.anims || !mid.title.includes(B.title))) fail(style, pos, 'выключенная анимация всё равно идёт', { mid });
    }
  }
}
console.log(JSON.stringify({ checks, bad: failures.length, failures: failures.slice(0, 20) }, null, 2));
await browser.close();
server.close();
overlay.stop();
process.exit(failures.length ? 1 : 0);
