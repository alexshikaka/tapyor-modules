'use strict';
// Оверлей-плейлист: настройки, список «дальше», раскладка DOS и поток для страницы — без Electron и без сети.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { normalize, DEFAULTS } = require('../src/settings');
const { buildFeed, nextList, coverFor, cleanSnap } = require('../src/feed');
const { Overlay, PAGE_FILES } = require('../src/index');
const D = require('../page/dos');

// ---------- поддельное ядро ----------
function fakeCore(stored) {
  const em = new EventEmitter();
  const core = {
    store: { overlay: stored },
    logs: [], wants: [], mounts: {},
    log(t) { this.logs.push(t); },
    settings: { get: (k) => core.store[k], set: (k, v) => { core.store[k] = v; } },
    http: {
      mount(prefix, fn) { core.mounts[prefix] = fn; },
      unmount(prefix) { delete core.mounts[prefix]; },
      url: (p) => 'http://127.0.0.1:47654' + p
    },
    player: {
      on(ev, fn) { em.on(ev, fn); return () => em.off(ev, fn); },
      want(w) { core.wants.push(w); },
      coverImage: async (u) => (u === '/lcover/abc' ? { mime: 'image/jpeg', data: Buffer.from('jpg') } : null),
      emit: (ev, x) => em.emit(ev, x)
    }
  };
  return core;
}
function fakeRes() {
  return { head: null, chunks: [], ended: false, writeHead(c, h) { this.head = { c, h }; }, write(x) { this.chunks.push(x); return true; }, end(x) { if (x) this.chunks.push(String(x)); this.ended = true; } };
}
function fakeReq() { const r = new EventEmitter(); r.method = 'GET'; return r; }
const SNAP = {
  np: { title: 'Группа крови', artist: 'Кино', cover: 'https://avatars.example/c.jpg', pos: 92, dur: 243, playing: true, at: 1000 },
  next: [{ title: 'Хочешь?', artist: 'Земфира' }, { title: 'Midnight City', artist: 'M83' }],
  after: [{ title: 'Instant Crush', artist: 'Daft Punk' }, { title: 'Dreams', artist: 'Fleetwood Mac' }]
};
const lastData = (res) => JSON.parse(res.chunks.filter((c) => c.startsWith('data: ')).pop().slice(6));

// ---------- настройки ----------
test('настройки: пусто → значения по умолчанию', () => {
  assert.deepEqual(normalize(undefined), { ...DEFAULTS });
  assert.equal(normalize(null).pos, 'br');
});
test('настройки: мусор отбрасывается, числа зажимаются', () => {
  const c = normalize({ pos: 'zz', size: 999, count: 50, dx: 'abc', color: 'red', lang: 'de', viz: 'x', outline: 'да', evil: 1 });
  assert.equal(c.pos, 'br'); assert.equal(c.size, 150); assert.equal(c.count, 10); assert.equal(c.dx, 0);
  assert.equal(c.color, '#FFB000'); assert.equal(c.lang, 'en'); assert.equal(c.viz, 'real'); assert.equal(c.outline, true);
  assert.equal('evil' in c, false);
});
test('настройки: короткий цвет разворачивается, регистр — верхний', () => {
  assert.equal(normalize({ color: '#0f8' }).color, '#00FF88');
  assert.equal(normalize({ color: '#33ff66' }).color, '#33FF66');
});
test('настройки: стиль «Типографика» допустим, мусор — нет', () => {
  assert.equal(normalize({ style: 'typography' }).style, 'typography');
  assert.equal(normalize({ style: 'unknown' }).style, 'dos');
});
test('настройки: цвет текста и визуализатора независимы', () => {
  assert.equal(normalize({ color: '#33ff66' }).vizColor, '#33FF66');
  assert.equal(normalize({ color: '#33FF66', vizColor: '#0f8' }).vizColor, '#00FF88');
  assert.equal(normalize({ color: '#33FF66', vizColor: 'bad' }).vizColor, '#33FF66');
});
test('настройки: до 10 песен, 0 — только играющий', () => {
  assert.equal(normalize({ count: 0 }).count, 0);
  assert.equal(normalize({ count: 10 }).count, 10);
  assert.equal(normalize({ count: -3 }).count, 0);
});

// ---------- список «дальше» ----------
test('список: сначала очередь, хвост — из волны', () => {
  const snap = cleanSnap(SNAP);
  assert.deepEqual(nextList(normalize({ count: 3 }), snap).map((x) => x.title), ['Хочешь?', 'Midnight City', 'Instant Crush']);
  assert.deepEqual(nextList(normalize({ count: 3, fill: false }), snap).map((x) => x.title), ['Хочешь?', 'Midnight City']);
  assert.deepEqual(nextList(normalize({ count: 1 }), snap).map((x) => x.title), ['Хочешь?']);
  assert.equal(nextList(normalize({ count: 0 }), snap).length, 0);
});
test('список: пустые строки и мусор выкидываются', () => {
  const s = cleanSnap({ np: { title: '  ' }, next: [{ title: '' }, null, { title: 'A  b', artist: 'C' }] });
  assert.equal(s.np, null);
  assert.deepEqual(s.next, [{ title: 'A b', artist: 'C' }]);
});
test('обложка: свой файл — через адрес модуля, чужая — как есть, остальное — нет', () => {
  assert.equal(coverFor('/lcover/abc'), '/overlay/cover?k=abc');
  assert.equal(coverFor('https://x/y.jpg'), 'https://x/y.jpg');
  assert.equal(coverFor('javascript:alert(1)'), '');
  assert.equal(coverFor('file:///C:/a.jpg'), '');
});
test('поток: настройки, трек и список одним сообщением', () => {
  const f = buildFeed(normalize({ count: 2 }), SNAP);
  assert.equal(f.np.title, 'Группа крови'); assert.equal(f.next.length, 2); assert.equal(f.cfg.count, 2);
});

// ---------- раскладка DOS ----------
test('время: мм:сс, часы для книг, мусор — прочерки', () => {
  assert.equal(D.fmtTime(92), '01:32'); assert.equal(D.fmtTime(3723), '1:02:03'); assert.equal(D.fmtTime(NaN), '--:--');
});
test('вертушка не меняет длину строки — цифры стоят на месте', () => {
  const lens = [0, 1, 2, 3].map((t) => D.cells(D.statusText({ spin: true, time: true, pos: 92, dur: 243, tick: t })).length);
  assert.equal(new Set(lens).size, 1);
  assert.ok(D.cells('a b').includes('\u00A0'));
});
test('пауза: короче обычной строки, без общей длины трека', () => {
  const p = D.statusText({ paused: true, time: true, pos: 92, dur: 243 });
  assert.equal(p, '‖ PAUSED 01:32');
  assert.ok(p.length < D.statusText({ spin: true, time: true, pos: 92, dur: 243 }).length + 2);
  assert.equal(D.statusText({ paused: true, time: true, pos: 92, lang: 'ru' }), '‖ ПАУЗА 01:32');
});
test('подписи: у русских двоеточия на одной линии', () => {
  const L = D.labels('ru');
  assert.equal(L.track.indexOf(':'), L.artist.indexOf(':'));
  assert.ok(L.track.endsWith(' ') && D.labels('en').track.endsWith(' '));
});
test('прогресс: от 0 до 32, без длины — пусто', () => {
  assert.equal(D.progressCount(0, 243), 0); assert.equal(D.progressCount(243, 243), 32);
  assert.equal(D.progressCount(121.5, 243), 16); assert.equal(D.progressCount(50, 0), 0);
});
test('позиция идёт сама, пока играет, и стоит на паузе', () => {
  assert.equal(D.posAt({ pos: 10, dur: 100, playing: true, at: 1000 }, 6000), 15);
  assert.equal(D.posAt({ pos: 10, dur: 100, playing: false, at: 1000 }, 6000), 10);
  assert.equal(D.posAt({ pos: 99, dur: 100, playing: true, at: 1000 }, 9000), 100);
});
test('затухание: 10 строк, не светлеет вниз, последняя читается', () => {
  for (let i = 1; i < 10; i++) assert.ok(D.fadeAt(i) <= D.fadeAt(i - 1));
  assert.ok(D.fadeAt(9) >= 0.4);
  assert.equal(D.fadeAt(9, false, 100), 1);
  assert.equal(normalize({ fadePct: 999 }).fadePct, 100);
  assert.ok(D.fadeAt(9, true, 50) > D.fadeAt(9, true, 100));
});
test('угол экрана: поля безопасной зоны, сдвиг и размер', () => {
  const br = D.boxStyle({ pos: 'br', dx: 0, dy: 0, size: 100 });
  assert.equal(br.right, '96px'); assert.equal(br.bottom, '54px'); assert.equal(br.transformOrigin, 'bottom right');
  const tl = D.boxStyle({ pos: 'tl', dx: 10, dy: 20, size: 120 });
  assert.equal(tl.left, '106px'); assert.equal(tl.top, '74px'); assert.equal(tl.transform, 'scale(1.2)');
  assert.match(D.boxStyle({ pos: 'bc', size: 100 }).transform, /translateX\(-50%\)/);
});
test('столбики: всегда хотя бы одна ступенька', () => {
  assert.equal(D.barSteps(0), 1); assert.equal(D.barSteps(1), 8); assert.equal(D.barSteps(0.5), 4);
});

// ---------- модуль целиком на поддельном ядре ----------
test('модуль: страница и поток на адресе /overlay', async () => {
  const core = fakeCore();
  const o = new Overlay(core, { readFile: (f, cb) => cb(null, Buffer.from('<html>')) });
  o.start();
  assert.ok(core.mounts['/overlay']);
  assert.deepEqual(core.wants.pop(), { state: false, levels: false });   // никто не смотрит — ядро ничего не шлёт

  const page = fakeRes(); core.mounts['/overlay'](fakeReq(), page, '/playlist', new URLSearchParams());
  assert.equal(page.head.c, 200); assert.match(page.head.h['Content-Type'], /text\/html/);
  const bad = fakeRes(); core.mounts['/overlay'](fakeReq(), bad, '/../settings.json', new URLSearchParams());
  assert.equal(bad.head.c, 404);

  const req = fakeReq(), res = fakeRes();
  core.mounts['/overlay'](req, res, '/events', new URLSearchParams());
  assert.deepEqual(core.wants.pop(), { state: true, levels: true });
  assert.equal(o.command('status').obs, 1);
  core.player.emit('state', SNAP);
  assert.equal(lastData(res).np.artist, 'Кино');
  core.player.emit('level', 0.5);
  assert.ok(res.chunks.includes('event: lv\ndata: 0.500\n\n'));
  req.emit('close');
  assert.equal(o.command('status').obs, 0);
  assert.deepEqual(core.wants.pop(), { state: false, levels: false });
  await o.stop();
  assert.equal(core.mounts['/overlay'], undefined);
});
test('модуль: превью в настройках не считается источником OBS', () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  core.mounts['/overlay'](fakeReq(), fakeRes(), '/events', new URLSearchParams('preview=1'));
  assert.equal(o.command('status').obs, 0); assert.equal(o.command('status').clients, 1);
});
test('модуль: «имитация» — уровни звука не нужны и не шлются', () => {
  const core = fakeCore({ viz: 'fake' }); const o = new Overlay(core); o.start();
  const res = fakeRes(); core.mounts['/overlay'](fakeReq(), res, '/events', new URLSearchParams());
  assert.deepEqual(core.wants.pop(), { state: true, levels: false });
  core.player.emit('level', 0.7);
  assert.equal(res.chunks.some((c) => c.startsWith('event: lv')), false);
});
test('модуль: сохранение проверяет значения и сразу шлёт странице', () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  const res = fakeRes(); core.mounts['/overlay'](fakeReq(), res, '/events', new URLSearchParams());
  const c = o.command('save', { pos: 'tl', count: 99, color: '#33ff66' });
  assert.equal(c.pos, 'tl'); assert.equal(c.count, 10); assert.equal(core.store.overlay.color, '#33FF66');
  assert.equal(lastData(res).cfg.pos, 'tl');
  assert.equal(o.command('reset').pos, 'br');
  assert.throws(() => o.command('нет-такой'));
});
test('модуль: обложка своего файла — только играющего трека', async () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  core.player.emit('state', { ...SNAP, np: { ...SNAP.np, cover: '/lcover/abc' } });
  const ok = fakeRes(); await o.cover(ok, 'abc');
  assert.equal(ok.head.c, 200); assert.equal(ok.head.h['Content-Type'], 'image/jpeg');
  const no = fakeRes(); await o.cover(no, 'другая');
  assert.equal(no.head.c, 404);
});
test('модуль: на старом ядре без моста — понятная ошибка', () => {
  const core = fakeCore(); delete core.http;
  assert.throws(() => new Overlay(core).start(), /нужен Тапёр новее/);
});
test('страница отдаёт только свои файлы', () => {
  assert.deepEqual(Object.keys(PAGE_FILES).sort(), ['/dos.js', '/playlist', '/playlist.css', '/playlist.js']);
});
