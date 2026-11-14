// Чистые расчёты текста и запаса под название для страниц оверлея.
// Работают на странице (window.TapTextFit) и в Node (тесты). Ничего не знают про экран:
// все числа — в координатах самого оверлея до transform: scale.
(function (root) {
  'use strict';

  var GAP = '      ';

  // Текст бегущей строки: два экземпляра с зазором, чтобы анимация -50% была бесшовной.
  function marqueeText(text, gap) {
    var t = String(text == null ? '' : text);
    var g = gap == null ? GAP : String(gap);
    return t + g + t + g;
  }

  // Бегущая строка: нужна, только если текст длиннее коробки.
  // Короткий текст остаётся как есть (ничего не дублируется).
  function marqueePlan(text, size, box, gap) {
    var t = String(text == null ? '' : text);
    var run = Number(size) > Number(box) + 1;
    return { run: run, text: run ? marqueeText(t, gap) : t };
  }

  // №8: вертикальное название не длиннее «правой колонки, но не меньше 300 px».
  // Короткому высоту не задаём вовсе — оно стоит как в образце.
  function verticalPlan(colHeight, textHeight, minHeight) {
    var min = Number(minHeight) || 300;
    var cap = Math.max(Number(colHeight) || 0, min);
    var run = Number(textHeight) > cap + 1;
    return { cap: cap, height: run ? cap : 0, run: run };
  }

  // Запас под название: до дальнего края оверлея плюс половина ширины оверлея
  // («полтора оверлея на вылет»). Только координаты оверлея, без окна и без сдвига.
  function titleReserve(side, elLeft, elRight, rootLeft, rootRight, overlayWidth, need) {
    var ow = Number(overlayWidth) || 0;
    var free = side === 'L' ? (Number(elLeft) - Number(rootLeft)) + ow * 0.5
      : side === 'R' ? (Number(rootRight) - Number(elRight)) + ow * 0.5
        : ow * 0.5;
    free = Math.max(0, free);
    return Math.max(0, Math.min(Number(need) || 0, free));
  }

  // Коробка названия: растёт в сторону side, домашний край остаётся на месте.
  function titleBox(base, extra, side) {
    var b = Number(base) || 0, e = Math.max(0, Number(extra) || 0);
    return {
      width: b + e,
      marginLeft: side === 'L' ? (e ? -e : 0) : side === 'B' ? (e ? -e / 2 : 0) : 0,
      marginRight: side === 'B' ? (e ? -e / 2 : 0) : 0
    };
  }

  // Моушн: коробка названия вдвое длиннее коробки плейлиста (без очереди).
  function motionExtra(base, playlistExtra) {
    var b = Number(base) || 0, e = Math.max(0, Number(playlistExtra) || 0);
    return e > 0 ? b + 2 * e : 0;
  }

  function z(n) { return (n < 10 ? '0' : '') + n; }
  // Крупное время Winamp — только текущая позиция (как в макете), без длительности.
  function winampClock(pos) {
    var s = Math.floor(Number(pos));
    if (!isFinite(s) || s < 0) return '--:--';
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + z(m) + ':' + z(r) : z(m) + ':' + z(r);
  }

  // Строка Winamp: «*** исполнитель - название ***», ник заказа — внутри строки.
  function winampText(np, nick, who) {
    if (!np) return '';
    var line = '*** ' + (np.artist || '—') + ' - ' + (np.title || '') + ' ***';
    if (nick && who) line = line.replace(/ \*\*\*$/, ' · заказ: ' + who + ' ***');
    return line;
  }

  // Очередь Winamp, как в макете: номер, исполнитель, название.
  function winampQueueRow(item, i, nums) {
    var t = item || {};
    return (nums ? (i + 1) + '. ' : '') + (t.artist ? t.artist + ' - ' : '') + (t.title || '');
  }

  var api = {
    GAP: GAP,
    marqueeText: marqueeText,
    marqueePlan: marqueePlan,
    verticalPlan: verticalPlan,
    titleReserve: titleReserve,
    titleBox: titleBox,
    motionExtra: motionExtra,
    winampClock: winampClock,
    winampText: winampText,
    winampQueueRow: winampQueueRow
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TapTextFit = api;
})(typeof window !== 'undefined' ? window : this);
