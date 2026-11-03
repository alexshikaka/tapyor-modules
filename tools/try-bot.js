'use strict';
// Проверка бота на живом Twitch БЕЗ Тапёра: вход, подключение к чату, ответы на !play.
// Тапёр не нужен — вместо ядра заглушка: «находит» любую песню и печатает заказ сюда, в окно.
// Токены живут только в памяти этого окна: закрыл — вход забыт.

const { Bot } = require('../streamer-pack/bot/src/bot');
const { EventEmitter } = require('events');
const { exec } = require('child_process');

if (typeof WebSocket === 'undefined') {
  console.log('Нужен Node.js 22 или новее (сейчас ' + process.version + '). Скачай LTS с nodejs.org.');
  process.exit(1);
}

const mem = new Map(); const settings = new Map(); const em = new EventEmitter();
let n = 0; const orders = [];
settings.set('bot', {
  identity: 'self', onlyLive: false, pointsOn: false, limitsFromQueue: 0,
  access: { viewer: { access: 'always', active: 3, pauseMin: 0 }, follower: { access: 'always', active: 3, pauseMin: 0 }, sub: { access: 'always', active: 3, pauseMin: 0 }, vip: { access: 'always', active: 3, pauseMin: 0 }, mod: { access: 'always', unlimited: true } }
});

const core = {
  log: (t) => console.log('  · ' + t),
  openExternal: (url) => { console.log('\n  Открываю: ' + url); exec(process.platform === 'win32' ? 'start "" "' + url + '"' : 'xdg-open "' + url + '"'); },
  settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
  secure: { get: async (k) => mem.get(k), set: async (k, v) => mem.set(k, v) },
  health: { set: (id, st, text) => console.log('  [' + (st === 'ok' ? 'OK' : st.toUpperCase()) + '] ' + id + ': ' + text) },
  on: (e, f) => em.on(e, f),
  async findOrder(q) {
    if (/нет|не найди/i.test(q)) return { level: 'none' };
    const [a, t] = q.includes('—') ? q.split('—').map((s) => s.trim()) : ['(тест)', q];
    return { level: 'exact', track: { src: 'test', id: q, author: a, title: t } };
  },
  checkTrack: () => ({ ok: true }),
  orders: {
    add(o) { const id = 'o' + (++n); orders.push({ id, ...o }); console.log('\n  >>> ЗАКАЗ от ' + o.user.login + ': ' + o.track.author + ' — ' + o.track.title + '\n'); return { id, place: orders.length, etaSec: orders.length * 200 }; },
    count: () => orders.length, remove: () => {}
  }
};

(async () => {
  console.log('\n  Проверка чат-бота Тапёра. Бот пишет от твоего имени, баллы выключены.');
  console.log('  Заглушка «находит» любую песню; напиши в запросе «нет», чтобы проверить «не нашёл».\n');
  const bot = new Bot(core, {});
  await bot.start();
  const flow = await bot.login('broadcaster');
  console.log('  Код для Twitch: ' + flow.userCode + '  (страница уже открыта — нажми «Активировать»)');
  await flow.done;
  console.log('\n  Готово. Напиши в своём чате:  !play кино — группа крови');
  console.log('  Закрыть — Ctrl+C или крестик окна.\n');
})().catch((e) => { console.log('\n  Ошибка: ' + e.message); process.exit(1); });
