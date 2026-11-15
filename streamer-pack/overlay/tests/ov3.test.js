'use strict';
// OV3: что реально умеет каждый стиль — features и vizKind строго по договору OVERLAYS-FEATURES.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STYLE_DEFS, STYLES, FEATURE_KEYS, QUEUE_FEATURES, MOTION_FEATURE_KEYS, VIZ_KINDS
} = require('../src/styles');
const META = require('../page/styles-meta');
const Demo = require('../page/demo');
const { PAGE_FILES } = require('../src/index');

const Q = ['count', 'fade', 'fill', 'nums'];
const BASE = ['cover', 'osc', 'viz', 'marq', ...Q];
const WITH_TIME = ['cover', 'time', 'osc', 'viz', 'marq', ...Q];

// Таблица «стиль → features → vizKind» из договора. Менять только вместе с договором.
const EXPECTED = {
  card: { features: ['cover', 'osc', 'viz', 'marq', ...Q], vizKind: 'spectrum' },
  vinyl: { features: BASE, vizKind: 'spectrum' },
  bigtype: { features: BASE, vizKind: 'spectrum' },
  column: { features: BASE, vizKind: 'spectrum' },
  typography: { features: BASE, vizKind: 'spectrum' },
  tilt: { features: BASE, vizKind: 'spectrum' },
  ribbon: { features: BASE, vizKind: 'spectrum' },
  vtitle: { features: BASE, vizKind: 'spectrum' },
  win95: { features: WITH_TIME, vizKind: 'spectrum' },
  sys7: { features: WITH_TIME, vizKind: 'spectrum' },
  winamp: { features: WITH_TIME, vizKind: 'spectrum' },
  dos: { features: ['cover', 'time', 'spin', 'prog', 'osc', 'viz', 'marq', 'lang', ...Q], vizKind: 'spectrum' },
  swiss: { features: ['cover', 'time', 'marq', ...Q], vizKind: null },
  hud8: { features: ['cover', 'time', 'osc', 'viz', 'prog', 'marq', ...Q], vizKind: 'spectrum' },
  synth: { features: BASE, vizKind: 'spectrum' },
  paper: { features: BASE, vizKind: 'spectrum' },
  polaroid: { features: BASE, vizKind: 'spectrum' },
  code: { features: WITH_TIME.filter((k) => k !== 'nums'), vizKind: 'spectrum' }, // 15.11: у кода номеров нет
  cassette: { features: ['osc', 'viz', 'marq', ...Q], vizKind: 'spectrum' },
  vu: { features: BASE, vizKind: 'level' },
  neon: { features: BASE, vizKind: 'spectrum' },
  film: { features: WITH_TIME, vizKind: 'spectrum' },
  citypop: { features: BASE, vizKind: 'spectrum' },
  popart: { features: BASE, vizKind: 'spectrum' },
  blueprint: { features: ['cover', 'time', 'osc', 'viz', 'marq', 'lang', ...Q], vizKind: 'spectrum' },
  radar: { features: WITH_TIME, vizKind: 'spectrum' }
};

test('OV3: у всех 26 стилей features и vizKind ровно по договору', () => {
  assert.equal(STYLE_DEFS.length, 26);
  assert.deepEqual(STYLE_DEFS.map((s) => s.id), [...STYLES]);
  assert.deepEqual(Object.keys(EXPECTED).sort(), [...STYLES].sort());
  for (const s of STYLE_DEFS) {
    const e = EXPECTED[s.id];
    assert.ok(e, 'нет ожиданий для ' + s.id);
    assert.ok(Array.isArray(s.features), s.id + ': features — массив');
    assert.deepEqual(s.features, e.features, s.id + ': features');
    assert.equal(s.vizKind, e.vizKind, s.id + ': vizKind');
  }
});

test('OV3: в features только ключи договора, без повторов', () => {
  for (const s of STYLE_DEFS) {
    for (const k of s.features) assert.ok(FEATURE_KEYS.includes(k), s.id + ': чужой ключ ' + k);
    assert.equal(new Set(s.features).size, s.features.length, s.id + ': повтор ключа');
    assert.ok(VIZ_KINDS.includes(s.vizKind), s.id + ': чужой vizKind');
  }
});

test('OV3: очередь есть у всех стилей плейлиста, а у моушна её ключей нет', () => {
  assert.deepEqual([...QUEUE_FEATURES], Q);
  // 15.11: у «Кода» номеров строк нет (как в образце) — остальные ключи очереди у всех
  for (const s of STYLE_DEFS) for (const k of Q) { if (s.id === 'code' && k === 'nums') continue; assert.ok(s.features.includes(k), s.id + ': нет ' + k); }
  assert.equal(STYLE_DEFS.find((s) => s.id === 'code').features.includes('nums'), false);
  for (const k of Q) assert.equal(MOTION_FEATURE_KEYS.includes(k), false, 'моушн не должен знать ' + k);
  assert.deepEqual([...MOTION_FEATURE_KEYS], ['cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang', 'viz', 'smooth']);
});

test('OV3: зеркало стилей на странице совпадает с src/styles.js', () => {
  assert.deepEqual(Object.keys(META).sort(), [...STYLES].sort());
  for (const s of STYLE_DEFS) {
    assert.deepEqual(META[s.id].features, s.features, s.id + ': features на странице');
    assert.equal(META[s.id].vizKind, s.vizKind, s.id + ': vizKind на странице');
  }
  assert.ok(PAGE_FILES['/styles-meta.js']);
  assert.equal(PAGE_FILES['/styles-meta.js'][1], 'text/javascript; charset=utf-8');
});

test('OV3: демо-переопределения feat понимают 0/1, числа и строки', () => {
  assert.deepEqual(Demo.parseFeat('cover:0,time:1,count:3,lang:en'), { cover: false, time: true, count: 3, lang: 'en' });
  assert.deepEqual(Demo.parseFeat('lang:off,osc:on'), { lang: false, osc: true });
  assert.deepEqual(Demo.parseFeat('bad, :1, x:'), {});
  assert.deepEqual(Demo.options('?demo=1&style=card&feat=prog:0').feat, { prog: false });
});

test('OV3: размер 80–250 у плейлиста и у моушна', () => {
  const { normalize, DEFAULTS } = require('../src/settings');
  assert.equal(DEFAULTS.size, 100);
  assert.equal(DEFAULTS.motion.size, 100);
  assert.equal(normalize({ size: 80 }).size, 80);
  assert.equal(normalize({ size: 250 }).size, 250);
  assert.equal(normalize({ size: 79 }).size, 80);
  assert.equal(normalize({ size: 251 }).size, 250);
  assert.equal(normalize({ size: '200' }).size, 200);
  assert.equal(normalize({ size: 'x' }).size, 100);
  assert.equal(normalize({ motion: { size: 80 } }).motion.size, 80);
  assert.equal(normalize({ motion: { size: 250 } }).motion.size, 250);
  assert.equal(normalize({ motion: { size: 79 } }).motion.size, 80);
  assert.equal(normalize({ motion: { size: 251 } }).motion.size, 250);
  assert.equal(normalize({ motion: { size: 300 } }).motion.size, 250);
});

test('OV3: моушн хранит свой набор «Что показывать» без ключей очереди', () => {
  const { normalize, MOTION_DEFAULTS } = require('../src/settings');
  for (const k of Q) assert.equal(k in MOTION_DEFAULTS, false, 'у моушна не должно быть ' + k);
  for (const k of ['cover', 'time', 'spin', 'prog', 'osc', 'marq']) assert.equal(MOTION_DEFAULTS[k], true, k);
  assert.equal(MOTION_DEFAULTS.lang, 'en');
  assert.equal(MOTION_DEFAULTS.viz, 'wave');
  assert.equal(MOTION_DEFAULTS.smooth, 'mid');
  const m = normalize({ motion: {
    cover: false, time: false, spin: false, prog: false, osc: false, marq: false,
    lang: 'ru', viz: 'spectrum', smooth: 'slow',
    count: 5, fade: false, fill: false, nums: false
  } }).motion;
  for (const k of ['cover', 'time', 'spin', 'prog', 'osc', 'marq']) assert.equal(m[k], false, k);
  assert.equal(m.lang, 'ru'); assert.equal(m.viz, 'spectrum'); assert.equal(m.smooth, 'slow');
  for (const k of Q) assert.equal(k in m, false, 'мусорный ключ очереди не сохраняется: ' + k);
  const junk = normalize({ motion: { cover: 'да', time: 1, spin: null, prog: 0, osc: 'x', marq: '1', lang: 'de', viz: 'x', smooth: 'zz' } }).motion;
  for (const k of ['cover', 'time', 'spin', 'prog', 'osc', 'marq']) assert.equal(junk[k], true, k + ': мусор → по умолчанию');
  assert.equal(junk.lang, 'en'); assert.equal(junk.viz, 'wave'); assert.equal(junk.smooth, 'mid');
});

test('OV3: особые ключи только там, где элементы реально есть', () => {
  const withKey = (k) => STYLE_DEFS.filter((s) => s.features.includes(k)).map((s) => s.id);
  assert.deepEqual(withKey('spin'), ['dos']);
  assert.deepEqual(withKey('lang'), ['dos', 'blueprint']);
  assert.deepEqual(withKey('prog'), ['dos', 'hud8']);
  assert.deepEqual(withKey('time'), ['win95', 'sys7', 'winamp', 'dos', 'swiss', 'hud8', 'code', 'film', 'blueprint', 'radar']);
  assert.deepEqual(withKey('cover'), STYLES.filter((id) => id !== 'cassette'));
  // Визуализатор: ключи osc и viz есть ровно тогда, когда vizKind не null (OV6 — «Волна / Спектр»).
  for (const s of STYLE_DEFS) {
    assert.equal(s.features.includes('osc'), s.vizKind !== null, s.id + ': osc');
    assert.equal(s.features.includes('viz'), s.vizKind !== null, s.id + ': viz');
  }
  assert.deepEqual(STYLE_DEFS.filter((s) => s.vizKind === null).map((s) => s.id), ['swiss']);
  assert.deepEqual(STYLE_DEFS.filter((s) => s.vizKind === 'level').map((s) => s.id), ['vu']);
});
