// Чистые функции визуализаторов: без DOM, работают на странице (window.TapViz) и в Node.
(function (root) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // 32 полосы спектра → N столбиков линейной интерполяцией.
  function interp(arr, i, n) {
    if (!arr || !arr.length) return 0;
    if (n <= 1) return Number(arr[0]) || 0;
    var x = i * (arr.length - 1) / (n - 1);
    var a = Math.floor(x), b = Math.min(arr.length - 1, a + 1), f = x - a;
    return (Number(arr[a]) || 0) * (1 - f) + (Number(arr[b]) || 0) * f;
  }

  // Подтяжка к цели: вверх быстро, вниз медленно. rate (0…1) — общая плавность из настроек.
  function next(cur, target, rate) {
    cur = Number(cur) || 0; target = Number(target) || 0;
    if (typeof rate === 'number' && isFinite(rate)) return cur + (target - cur) * clamp(rate, 0, 1);
    return cur + (target - cur) * (target > cur ? 0.62 : 0.18);
  }

  // Сколько сегментов LED-столбика горит.
  function lit(v, rows) {
    rows = Math.max(1, Math.round(Number(rows) || 1));
    return Math.max(0, Math.min(rows, Math.round(clamp(Number(v) || 0, 0, 1) * rows)));
  }

  // Угол стрелки VU: −55° (тихо) … +55° (громко).
  function needleAngle(v) { return -55 + 110 * clamp(Number(v) || 0, 0, 1); }

  // Точка волны: v — полоса спектра 0…1, i — номер точки из pts.
  function waveY(v, i, pts, H) {
    var en = Math.sin(i / Math.max(1, pts) * Math.PI);
    return H * (0.92 - 0.82 * clamp(Number(v) || 0, 0, 1) * en);
  }

  // История громкости: сдвиг влево и новое значение справа.
  function historyPush(hist, v, min) {
    hist.shift();
    hist.push(Math.max(Number(min) || 0, clamp(Number(v) || 0, 0, 1)));
    return hist;
  }

  // Имитация звука, когда захвата нет: плавная «дышащая» волна без рывка.
  function imitation(t, r) {
    var x = Number(r) || 0.5;
    return Math.min(1, 0.15 + 0.85 * Math.abs(Math.sin(t * 1.7) * Math.cos(t * 0.9 + x * 0.6)));
  }

  var api = { clamp: clamp, interp: interp, next: next, lit: lit, needleAngle: needleAngle, waveY: waveY,
    historyPush: historyPush, imitation: imitation };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TapViz = api;
})(typeof window !== 'undefined' ? window : this);
