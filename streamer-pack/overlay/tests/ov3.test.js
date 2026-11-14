'use strict';
// OV3: что реально умеет каждый стиль — features и vizKind строго по договору OVERLAYS-FEATURES.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STYLE_DEFS, STYLES, FEATURE_KEYS, QUEUE_FEATURES, MOTION_FEATURE_KEYS, VIZ_KINDS
} = require('../src/styles');

const Q = ['count', 'fade', 'fill', 'nums'];
const BASE = ['cover', 'osc', 'marq', ...Q];
const WITH_TIME = ['cover', 'time', 'osc', 'marq', ...Q];

// Таблица «стиль → features → vizKind» из договора. Менять только вместе с договором.
const EXPECTED = {
  card: { features: ['cover', 'osc', 'marq', ...Q], vizKind: 'spectrum' },
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
  dos: { features: ['cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang', ...Q], vizKind: 'spectrum' },
  swiss: { features: ['cover', 'time', 'marq', ...Q], vizKind: null },
  hud8: { features: ['cover', 'time', 'prog', 'marq', ...Q], vizKind: null },
  synth: { features: BASE, vizKind: 'spectrum' },
  paper: { features: BASE, vizKind: 'spectrum' },
  polaroid: { features: BASE, vizKind: 'spectrum' },
  code: { features: WITH_TIME, vizKind: 'spectrum' },
  cassette: { features: ['osc', 'marq', ...Q], vizKind: 'spectrum' },
  vu: { features: BASE, vizKind: 'level' },
  neon: { features: BASE, vizKind: 'spectrum' },
  film: { features: WITH_TIME, vizKind: 'spectrum' },
  citypop: { features: BASE, vizKind: 'spectrum' },
  popart: { features: BASE, vizKind: 'spectrum' },
  blueprint: { features: ['cover', 'time', 'osc', 'marq', 'lang', ...Q], vizKind: 'spectrum' },
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
  for (const s of STYLE_DEFS) for (const k of Q) assert.ok(s.features.includes(k), s.id + ': нет ' + k);
  for (const k of Q) assert.equal(MOTION_FEATURE_KEYS.includes(k), false, 'моушн не должен знать ' + k);
  assert.deepEqual([...MOTION_FEATURE_KEYS], ['cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang', 'viz', 'smooth']);
});

test('OV3: особые ключи только там, где элементы реально есть', () => {
  const withKey = (k) => STYLE_DEFS.filter((s) => s.features.includes(k)).map((s) => s.id);
  assert.deepEqual(withKey('spin'), ['dos']);
  assert.deepEqual(withKey('lang'), ['dos', 'blueprint']);
  assert.deepEqual(withKey('prog'), ['dos', 'hud8']);
  assert.deepEqual(withKey('time'), ['win95', 'sys7', 'winamp', 'dos', 'swiss', 'hud8', 'code', 'film', 'blueprint', 'radar']);
  assert.deepEqual(withKey('cover'), STYLES.filter((id) => id !== 'cassette'));
  // Визуализатор: ключ osc есть ровно тогда, когда vizKind не null.
  for (const s of STYLE_DEFS) assert.equal(s.features.includes('osc'), s.vizKind !== null, s.id);
  assert.deepEqual(STYLE_DEFS.filter((s) => s.vizKind === null).map((s) => s.id), ['swiss', 'hud8']);
  assert.deepEqual(STYLE_DEFS.filter((s) => s.vizKind === 'level').map((s) => s.id), ['vu']);
});
