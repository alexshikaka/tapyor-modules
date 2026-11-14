'use strict';
// OV2: цвета стилей, глубокое слияние моушна, команда preview-motion и motionObs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { STYLE_DEFS, STYLES } = require('../src/styles');
const { Overlay } = require('../src/index');

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
function fakeRes() {
  return {
    head: null, chunks: [], ended: false,
    writeHead(c, h) { this.head = { c, h }; },
    write(x) { this.chunks.push(x); return true; },
    end(x) { if (x) this.chunks.push(String(x)); this.ended = true; }
  };
}
function fakeReq() { const r = new EventEmitter(); r.method = 'GET'; return r; }
function open(core, query) {
  const req = fakeReq(), res = fakeRes();
  core.mounts['/overlay'](req, res, '/events', new URLSearchParams(query));
  return { req, res };
}
const HEX = /^#[0-9A-F]{6}$/;

test('OV2: у каждой записи styles есть color и vizColor — T и V из META, верхний регистр', () => {
  assert.equal(STYLE_DEFS.length, 26);
  for (const s of STYLE_DEFS) {
    assert.match(s.color, HEX, s.id + ': color');
    assert.match(s.vizColor, HEX, s.id + ': vizColor');
  }
  const by = Object.fromEntries(STYLE_DEFS.map((s) => [s.id, s]));
  assert.equal(by.card.color, '#FFFFFF'); assert.equal(by.card.vizColor, '#F0654F');
  assert.equal(by.vinyl.color, '#FFF4D6'); assert.equal(by.vinyl.vizColor, '#E9C46A');
  assert.equal(by.bigtype.vizColor, '#FFE14D');
  assert.equal(by.column.vizColor, '#19E3FF');
  assert.equal(by.typography.color, '#FFFFFF'); assert.equal(by.typography.vizColor, '#FFFFFF');
  assert.equal(by.tilt.vizColor, '#FFB347');
  assert.equal(by.ribbon.vizColor, '#4DD4AC');
  assert.equal(by.vtitle.vizColor, '#C8F542');
  assert.equal(by.win95.vizColor, '#00FF00');
  assert.equal(by.sys7.vizColor, '#FFFFFF');
  assert.equal(by.winamp.color, '#2CFF2C'); assert.equal(by.winamp.vizColor, '#20E020');
  assert.equal(by.dos.color, '#FFB000'); assert.equal(by.dos.vizColor, '#FFB000');
  assert.equal(by.swiss.vizColor, '#FF2D2D');
  assert.equal(by.hud8.vizColor, '#FFD23F');
  assert.equal(by.synth.vizColor, '#FF2BD6');
  assert.equal(by.paper.vizColor, '#FFFFFF');
  assert.equal(by.polaroid.vizColor, '#FFD6A5');
  assert.equal(by.code.color, '#E6EDF3'); assert.equal(by.code.vizColor, '#7EE787');
  assert.equal(by.cassette.vizColor, '#E8D9B5');
  assert.equal(by.vu.vizColor, '#FFCC00');
  assert.equal(by.neon.color, '#FF5FD2'); assert.equal(by.neon.vizColor, '#5FF3FF');
  assert.equal(by.film.vizColor, '#FFFFFF');
  assert.equal(by.citypop.vizColor, '#FF6B6B');
  assert.equal(by.popart.vizColor, '#FF3B6B');
  assert.equal(by.blueprint.color, '#9FE3FF'); assert.equal(by.blueprint.vizColor, '#9FE3FF');
  assert.equal(by.radar.color, '#7DFFB2'); assert.equal(by.radar.vizColor, '#7DFFB2');
  assert.deepEqual(STYLE_DEFS.map((s) => s.id), [...STYLES]);
});

test('OV2: команда styles отдаёт цвета вместе с остальными полями', () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  const list = o.command('styles');
  assert.equal(list.length, 26);
  for (const s of list) {
    assert.deepEqual(Object.keys(s).sort(), ['color', 'font', 'have', 'id', 'name', 'num', 'vizColor']);
    assert.match(s.color, HEX); assert.match(s.vizColor, HEX);
  }
});

test('OV2: save сливает motion глубоко и не сбрасывает остальные поля моушна', () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  const full = o.command('save', {
    motion: { style: 'card', pos: 'tl', dx: 12, dy: -8, size: 120, color: '#33ff66', vizColor: '#0f8', outline: false, nick: false, scene: 'brand', hold: 9 }
  });
  assert.equal(full.motion.style, 'card'); assert.equal(full.motion.hold, 9);
  const patch = o.command('save', { motion: { scene: 'mask' } });
  assert.equal(patch.motion.scene, 'mask');
  assert.equal(patch.motion.style, 'card');
  assert.equal(patch.motion.pos, 'tl');
  assert.equal(patch.motion.dx, 12);
  assert.equal(patch.motion.dy, -8);
  assert.equal(patch.motion.size, 120);
  assert.equal(patch.motion.color, '#33FF66');
  assert.equal(patch.motion.vizColor, '#00FF88');
  assert.equal(patch.motion.outline, false);
  assert.equal(patch.motion.nick, false);
  assert.equal(patch.motion.hold, 9);
  assert.equal(core.store.overlay.motion.scene, 'mask');
  // Мусор в частичном патче тоже не сбрасывает остальное.
  const junk = o.command('save', { motion: { hold: 999 } });
  assert.equal(junk.motion.hold, 15);
  assert.equal(junk.motion.style, 'card');
});

test('OV2: preview-motion шлёт «показать сейчас» открытым моушн-страницам', () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  const motion = open(core, 'page=motion');
  const preview = open(core, 'page=motion&preview=1');
  const list = open(core, 'page=playlist');
  const r = o.command('preview-motion');
  assert.equal(r.sent, 2);
  for (const cl of [motion, preview]) {
    assert.ok(cl.res.chunks.includes('event: show\ndata: 1\n\n'), 'моушн-страница должна получить событие show');
  }
  assert.equal(list.res.chunks.some((c) => c.startsWith('event: show')), false);
  // Повторный вызов тоже работает; без моушн-страниц — ноль и без ошибки.
  assert.equal(o.command('preview-motion').sent, 2);
  motion.req.emit('close'); preview.req.emit('close');
  assert.equal(o.command('preview-motion').sent, 0);
});

test('OV2: status.motionObs считает только OBS-источники моушна, превью не считается', () => {
  const core = fakeCore(); const o = new Overlay(core); o.start();
  assert.equal(o.command('status').motionObs, 0);
  const list = open(core, 'page=playlist');
  assert.equal(o.command('status').motionObs, 0);
  const motion = open(core, 'page=motion');
  assert.equal(o.command('status').motionObs, 1);
  const preview = open(core, 'page=motion&preview=1');
  assert.equal(o.command('status').motionObs, 1);
  assert.equal(o.command('status').obs, 2);            // плейлист + моушн OBS
  assert.equal(o.command('status').clients, 3);        // вместе с превью
  list.req.emit('close');
  assert.equal(o.command('status').motionObs, 1);
  motion.req.emit('close');
  assert.equal(o.command('status').motionObs, 0);
  preview.req.emit('close');
  assert.equal(o.command('status').motionObs, 0);
});
