// Зеркало src/styles.js для страницы: какие ключи «Что показывать» и какой визуализатор
// реально есть у стиля. Обязано совпадать с src/styles.js — это проверяет тест ov3.
// У моушна ключей очереди нет: страница их просто не применяет.
// OV6: у всех стилей с визуализатором есть ключ viz («Волна / Спектр»).
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TapStyleMeta = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var Q = ['count', 'fade', 'fill', 'nums'];
  var BASE = ['cover', 'osc', 'viz', 'marq'].concat(Q);
  var WITH_TIME = ['cover', 'time', 'osc', 'viz', 'marq'].concat(Q);
  return {
    card: { features: ['cover', 'osc', 'viz', 'marq'].concat(Q), vizKind: 'spectrum' },
    vinyl: { features: BASE.slice(), vizKind: 'spectrum' },
    bigtype: { features: BASE.slice(), vizKind: 'spectrum' },
    column: { features: BASE.slice(), vizKind: 'spectrum' },
    typography: { features: BASE.slice(), vizKind: 'spectrum' },
    tilt: { features: BASE.slice(), vizKind: 'spectrum' },
    ribbon: { features: BASE.slice(), vizKind: 'spectrum' },
    vtitle: { features: BASE.slice(), vizKind: 'spectrum' },
    win95: { features: WITH_TIME.slice(), vizKind: 'spectrum' },
    sys7: { features: WITH_TIME.slice(), vizKind: 'spectrum' },
    winamp: { features: WITH_TIME.slice(), vizKind: 'spectrum' },
    dos: { features: ['cover', 'time', 'spin', 'prog', 'osc', 'viz', 'marq', 'lang'].concat(Q), vizKind: 'spectrum' },
    swiss: { features: ['cover', 'time', 'marq'].concat(Q), vizKind: null },
    hud8: { features: ['cover', 'time', 'osc', 'viz', 'prog', 'marq'].concat(Q), vizKind: 'spectrum' },
    synth: { features: BASE.slice(), vizKind: 'spectrum' },
    paper: { features: BASE.slice(), vizKind: 'spectrum' },
    polaroid: { features: BASE.slice(), vizKind: 'spectrum' },
    code: { features: WITH_TIME.filter(function (k) { return k !== 'nums'; }), vizKind: 'spectrum' }, // у кода номеров нет (как в образце)
    cassette: { features: ['osc', 'viz', 'marq'].concat(Q), vizKind: 'spectrum' },
    vu: { features: BASE.slice(), vizKind: 'level' },
    neon: { features: BASE.slice(), vizKind: 'spectrum' },
    film: { features: WITH_TIME.slice(), vizKind: 'spectrum' },
    citypop: { features: BASE.slice(), vizKind: 'spectrum' },
    popart: { features: BASE.slice(), vizKind: 'spectrum' },
    blueprint: { features: ['cover', 'time', 'osc', 'viz', 'marq', 'lang'].concat(Q), vizKind: 'spectrum' },
    radar: { features: WITH_TIME.slice(), vizKind: 'spectrum' }
  };
});
