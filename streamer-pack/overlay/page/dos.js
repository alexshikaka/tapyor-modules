// Оверлей «DOS-терминал»: чистые функции раскладки и текста.
// Работает и на странице (window.TapDos), и в Node (тесты модуля).
(function (root) {
  'use strict';

  var FADE = [1, 0.86, 0.74, 0.65, 0.58, 0.53, 0.49, 0.46, 0.43, 0.4];   // последняя строка всё равно читается
  var CELLS = 32;                                                          // ячеек в шкале прогресса
  var OSC = 34;                                                            // столбиков осциллограммы
  var SAFE_X = 96, SAFE_Y = 54;                                            // безопасная зона ТВ на 1920×1080
  var NBSP = ' ';

  function z(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(sec) {
    var s = Math.floor(Number(sec));
    if (!isFinite(s) || s < 0) return '--:--';
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + z(m) + ':' + z(r) : z(m) + ':' + z(r);
  }

  function labels(lang) {
    // Двойной пробел у «ТРЕК» — чтобы двоеточия стояли ровно под «АРТИСТ:»
    return lang === 'ru' ? { track: 'ТРЕК  : ', artist: 'АРТИСТ: ', paused: 'ПАУЗА' } : { track: 'TRACK : ', artist: 'ARTIST: ', paused: 'PAUSED' };
  }

  // Где сейчас трек: позиция из снимка + время, прошедшее с него (если играет)
  function posAt(np, now) {
    if (!np) return 0;
    var p = Number(np.pos) || 0;
    if (np.playing) p += Math.max(0, (now - (Number(np.at) || now)) / 1000);
    var d = Number(np.dur) || 0;
    return d > 0 ? Math.min(p, d) : p;
  }

  var SPIN = '|/-\\';
  // Строка под исполнителем: вертушка и время, на паузе — «‖ PAUSED 01:32» (короче, чтобы не упираться в обложку)
  function statusText(o) {
    var L = labels(o.lang);
    if (o.paused) return '‖ ' + L.paused + (o.time ? ' ' + fmtTime(o.pos) : '');
    var s = '';
    if (o.spin) s += SPIN[((o.tick || 0) % 4 + 4) % 4] + ' ';
    if (o.time) s += fmtTime(o.pos) + '/' + (o.dur > 0 ? fmtTime(o.dur) : '--:--');
    return s.replace(/ $/, '');
  }
  // Каждый знак — в своей клетке одной ширины: вертушка и цифры не двигают соседей
  function cells(str) { return String(str).split('').map(function (c) { return c === ' ' ? NBSP : c; }); }

  function progressCount(pos, dur, n) {
    n = n || CELLS;
    if (!(dur > 0)) return 0;
    return Math.max(0, Math.min(n, Math.round(n * pos / dur)));
  }

  function rowText(item, i, nums) { return (nums ? (i + 1) + '. ' : '') + item.title + (item.artist ? ' - ' + item.artist : ''); }
  function fadeAt(i, on, pct) {
    if (on === false || Number(pct) === 0) return 1;
    var k = Number(pct);
    if (!isFinite(k)) k = 100;
    var base = FADE[Math.min(i, FADE.length - 1)];
    return 1 - (1 - base) * Math.max(0, Math.min(100, k)) / 100;
  }

  // Плавность осциллограммы: доля нового значения в сглаживании
  function smoothAlpha(s) { return s === 'fast' ? 0.85 : s === 'slow' ? 0.25 : 0.5; }
  // Имитация звука — когда настоящих уровней нет (выключено или Тапёр не слышит свой звук)
  function imitation(t, rnd) {
    var r = typeof rnd === 'number' ? rnd : 0.5;
    return Math.min(1, 0.15 + 0.85 * Math.abs(Math.sin(t * 1.7) * Math.cos(t * 0.9 + r * 0.6)));
  }
  // Высота столбика: 8 ступенек, минимум одна — лента не пропадает на тихих местах
  function barSteps(level) { return Math.max(1, Math.min(8, Math.round((Number(level) || 0) * 8))); }

  function place(pos) {
    var p = String(pos || 'br');
    return { v: p[0] === 't' ? 't' : 'b', h: p[1] === 'l' ? 'l' : p[1] === 'c' ? 'c' : 'r' };
  }
  // Положение оверлея на экране 1920×1080: от угла с полями безопасной зоны, плюс сдвиг и размер
  function boxStyle(cfg) {
    var pl = place(cfg.pos), k = (Number(cfg.size) || 100) / 100, dx = Number(cfg.dx) || 0, dy = Number(cfg.dy) || 0;
    var st = { left: '', right: '', top: '', bottom: '', transform: '', transformOrigin: '' };
    if (pl.h === 'l') st.left = (SAFE_X + dx) + 'px';
    else if (pl.h === 'r') st.right = (SAFE_X - dx) + 'px';
    else st.left = 'calc(50% + ' + dx + 'px)';
    if (pl.v === 't') st.top = (SAFE_Y + dy) + 'px'; else st.bottom = (SAFE_Y - dy) + 'px';
    st.transformOrigin = (pl.v === 't' ? 'top' : 'bottom') + ' ' + (pl.h === 'l' ? 'left' : pl.h === 'r' ? 'right' : 'center');
    st.transform = (pl.h === 'c' ? 'translateX(-50%) ' : '') + 'scale(' + k + ')';
    return st;
  }

  var api = { FADE: FADE, CELLS: CELLS, OSC: OSC, SAFE_X: SAFE_X, SAFE_Y: SAFE_Y, fmtTime: fmtTime, labels: labels, posAt: posAt,
    statusText: statusText, cells: cells, progressCount: progressCount, rowText: rowText, fadeAt: fadeAt,
    smoothAlpha: smoothAlpha, imitation: imitation, barSteps: barSteps, place: place, boxStyle: boxStyle };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TapDos = api;
})(typeof window !== 'undefined' ? window : this);
