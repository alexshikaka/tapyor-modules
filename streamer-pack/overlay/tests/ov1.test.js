'use strict';
// OV1: 26 стилей, настройки, цвета, who, страницы, лимит 16.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { normalize, DEFAULTS, SCENES } = require('../src/settings');
const { STYLE_DEFS, STYLES } = require('../src/styles');
const { cleanSnap, buildFeed } = require('../src/feed');
const { Overlay, PAGE_FILES, MAX_CLIENTS } = require('../src/index');

const PAGE_DIR = path.join(__dirname, '..', 'page');

function fakeCore(stored) {
  const em = new EventEmitter();
  const core = {
    store: { overlay: stored }, wants: [], mounts: {},
    log() {},
    settings: { get: (k) => core.store[k], set: (k, v) => { core.store[k] = v; } },
    http: {
      mount(prefix, fn) { core.mounts[prefix] = fn; },
      unmount(prefix) { delete core.mounts[prefix]; },
      url: (p) => 'http://127.0.0.1:47654' + p
    },
    player: {
      on(ev, fn) { em.on(ev, fn); return () => em.off(ev, fn); },
      want(w) { core.wants.push(w); },
      coverImage: async () => null,
      emit: (ev, x) => em.emit(ev, x)
    }
  };
  return core;
}
function fakeRes(done) {
  return {
    head: null, chunks: [], ended: false,
    writeHead(c, h) { this.head = { c, h }; },
    write(x) { this.chunks.push(x); return true; },
    end(x) { if (x) this.chunks.push(String(x)); this.ended = true; if (done) done(this); }
  };
}
function fakeReq() { const r = new EventEmitter(); r.method = 'GET'; return r; }

test('OV1: стилей ровно 26, id уникальны, порядок макета', () => {
  assert.equal(STYLE_DEFS.length, 26);
  assert.equal(new Set(STYLES).size, 26);
  assert.deepEqual(STYLES.slice(0, 6), ['card', 'vinyl', 'bigtype', 'column', 'typography', 'tilt']);
  assert.deepEqual(STYLES.slice(-4), ['citypop', 'popart', 'blueprint', 'radar']);
  assert.ok(!STYLES.includes('ios'));
  assert.equal(STYLE_DEFS.find((s) => s.id === 'dos').num, 12);
  assert.equal(STYLE_DEFS.find((s) => s.id === 'typography').num, 5);
  for (const s of STYLE_DEFS) assert.ok(s.name && s.font);
});

test('OV1: новые поля настроек и старые сохранения читаются', () => {
  const c = normalize({});
  assert.equal(c.nick, true);
  assert.deepEqual(c.motion, DEFAULTS.motion);
  assert.equal(c.motion.style, 'dos'); assert.equal(c.motion.pos, 'bc');
  assert.equal(c.motion.scene, 'brand'); assert.equal(c.motion.hold, 5);
  const old = normalize({ style: 'typography', pos: 'tl', color: '#33ff66', count: 2 });
  assert.equal(old.style, 'typography'); assert.equal(old.pos, 'tl'); assert.equal(old.color, '#33FF66');
  assert.equal(old.nick, true); assert.ok(old.motion);
});

test('OV1: мусор в моушн-настройках заменяется, значения зажимаются', () => {
  const c = normalize({ nick: false, motion: { style: 'нет', pos: 'zz', dx: 'x', size: 999, color: 'red', vizColor: '#0f8', outline: 'да', scene: 'zz', hold: 99 } });
  assert.equal(c.nick, false);
  assert.equal(c.motion.style, 'dos'); assert.equal(c.motion.pos, 'bc');
  assert.equal(c.motion.dx, 0); assert.equal(c.motion.size, 150); assert.equal(c.motion.color, '#FFFFFF');
  assert.equal(c.motion.vizColor, '#00FF88'); assert.equal(c.motion.outline, true);
  assert.deepEqual(SCENES, ['brand', 'rush', 'mask', 'plate']); assert.equal(c.motion.scene, 'brand');
  assert.equal(c.motion.hold, 15);
  assert.equal(normalize({ motion: { scene: 'plate', style: 'card', pos: 'tl', hold: 3 } }).motion.scene, 'plate');
});

test('OV1: feed пропускает who у np и строк очереди, без who ничего не ломает', () => {
  const s = cleanSnap({
    np: { title: 'A', artist: 'B', who: '  ник  ', cover: 'https://x/y.jpg' },
    next: [{ title: 'C', artist: 'D', who: 'z' }, { title: 'E', artist: 'F', who: '   ' }]
  });
  assert.equal(s.np.who, 'ник');
  assert.equal(s.next[0].who, 'z');
  assert.equal('who' in s.next[1], false);
  const f = buildFeed(normalize({ count: 2 }), {
    np: { title: 'A', who: 'ник' }, next: [{ title: 'C', who: 'z' }], after: []
  });
  assert.equal(f.np.who, 'ник'); assert.equal(f.next[0].who, 'z');
  const no = cleanSnap({ np: { title: 'A' }, next: [{ title: 'C' }] });
  assert.equal(no.np.who, ''); assert.deepEqual(no.next[0], { title: 'C', artist: '' });
});

test('OV1: все файлы страниц в белом списке существуют и отдаются', async () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  for (const [sub, meta] of Object.entries(PAGE_FILES)) {
    const file = path.join(PAGE_DIR, meta[0]);
    assert.ok(fs.existsSync(file), 'нет файла ' + meta[0]);
    const html = /text\/html/.test(meta[1]);
    const res = await new Promise((resolve) => {
      const r = fakeRes(resolve);
      core.mounts['/overlay'](fakeReq(), r, sub, new URLSearchParams());
    });
    assert.equal(res.head.c, 200, sub);
    assert.equal(res.head.h['Content-Type'], meta[1], sub);
    if (html) assert.match(res.chunks.join(''), /<html/i, sub);
  }
  const bad = await new Promise((resolve) => {
    const r = fakeRes(resolve);
    core.mounts['/overlay'](fakeReq(), r, '/settings.json', new URLSearchParams());
  });
  assert.equal(bad.head.c, 404);
  const bad2 = await new Promise((resolve) => {
    const r = fakeRes(resolve);
    core.mounts['/overlay'](fakeReq(), r, '/../manifest.json', new URLSearchParams());
  });
  assert.equal(bad2.head.c, 404);
  await o.stop();
});

test('OV1: моушн-страница по адресу, статус с motionUrl, команда styles', async () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  const page = await new Promise((resolve) => {
    const r = fakeRes(resolve); core.mounts['/overlay'](fakeReq(), r, '/motion', new URLSearchParams());
  });
  assert.equal(page.head.c, 200);
  const st = o.command('status');
  assert.match(st.url, /\/overlay\/playlist$/);
  assert.match(st.motionUrl, /\/overlay\/motion$/);
  const list = o.command('styles');
  assert.equal(list.length, 26); assert.deepEqual(list.map((s) => s.id), STYLES);
  assert.deepEqual(Object.keys(list[0]).sort(), ['color', 'font', 'have', 'id', 'name', 'num', 'vizColor']);
  await o.stop();
});

test('OV1: лимит одновременных подключений — 16', async () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  for (let i = 0; i < MAX_CLIENTS; i++) {
    core.mounts['/overlay'](fakeReq(), fakeRes(), '/events', new URLSearchParams());
  }
  assert.equal(o.command('status').clients, 16);
  const over = fakeRes();
  core.mounts['/overlay'](fakeReq(), over, '/events', new URLSearchParams());
  assert.equal(over.head.c, 503);
  // Уровни просим у ядра, пока смотрит хоть одна страница.
  assert.deepEqual(core.wants[core.wants.length - 1], { state: true, levels: true });
  await o.stop();
});
