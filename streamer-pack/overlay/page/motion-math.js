// Чистая математика моушн-оверлея: центровка по видимому, подводка, запас названия.
// Работает на странице (window.TapMotionMath) и в Node (тесты).
(function (root) {
  'use strict';

  // Сдвиг, чтобы центр видимого совпал с центром коробки оверлея.
  function centerShift(R, U) {
    return Math.round(((R.left + R.right) - (U.l + U.r)) / 2);
  }

  // Подводка с полями 18/14 px вокруг всего видимого, в координатах внутри корня.
  function plateRect(R, U, scale, padX, padY) {
    var s = Number(scale) || 1;
    var px = padX == null ? 18 : padX, py = padY == null ? 14 : padY;
    return {
      top: ((U.t - R.top) / s - py),
      left: ((U.l - R.left) / s - px),
      right: ((R.right - U.r) / s - px),
      bottom: ((R.bottom - U.b) / s - py)
    };
  }

  // Плейлист: запас до free. Моушн: коробка названия вдвое длиннее плейлистовой.
  function reserveExtra(base, playlistExtra, isMotion, free) {
    var e = Math.max(0, Number(playlistExtra) || 0);
    if (isMotion && e > 0) e = Math.max(e, (Number(base) || 0) + 2 * e);
    return Math.max(0, Math.min(Number(free) || 0, e));
  }

  // Сколько секунд держится моушн: 3–15, по умолчанию 5.
  function holdSeconds(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = 5;
    return Math.max(3, Math.min(15, n));
  }

  var api = { centerShift: centerShift, plateRect: plateRect, reserveExtra: reserveExtra, holdSeconds: holdSeconds };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TapMotionMath = api;
})(typeof window !== 'undefined' ? window : this);
