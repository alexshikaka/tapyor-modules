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

  // ---------- OV6: два вида визуализатора у каждого типа ----------
  // Вид из настроек: «Волна» или «Спектр». Всё остальное — волна.
  function viewOf(v) { return v === 'spectrum' ? 'spectrum' : 'wave'; }

  // Бегущая синусоида по N точкам: 0…1. phase — в оборотах (доля фазы).
  function waveShape(i, n, phase) {
    var total = Math.max(1, Math.round(Number(n) || 1));
    var x = total > 1 ? clamp(Number(i) || 0, 0, total - 1) / (total - 1) : 0;
    var p = Number(phase) || 0;
    return 0.5 + 0.5 * Math.sin((p - x) * Math.PI * 2);
  }

  // Среднее по полосам спектра from…to: стрелки VU берут низы и верха.
  function bandAvg(spec, from, to) {
    var a = Array.isArray(spec) ? spec : [];
    var s = 0, c = 0;
    for (var i = Math.max(0, Number(from) || 0); i < Math.min(a.length, Number(to) || 0); i++) {
      s += Number(a[i]) || 0; c++;
    }
    return c ? s / c : 0;
  }

  // Сглаживание кривой: соседние точки с весом 1–2–1 (спектр «Колонки» и т. п.).
  function smoothSeries(arr) {
    var a = Array.isArray(arr) ? arr.map(function (v) { return Number(v) || 0; }) : [];
    if (a.length < 3) return a;
    var out = a.slice();
    for (var i = 0; i < a.length; i++) {
      var l = a[Math.max(0, i - 1)], r = a[Math.min(a.length - 1, i + 1)];
      out[i] = (l + a[i] * 2 + r) / 4;
    }
    return out;
  }

  function liveSpec(o) { return !!o && o.live === true && Array.isArray(o.spec) && o.spec.length > 0; }

  // Стрелки: волна — обе от громкости (правая чуть отстаёт), спектр — низы/верха.
  // prev — прошлое показание левой стрелки: правая повторяет его с задержкой.
  function needleValues(view, o) {
    o = o || {};
    if (viewOf(view) === 'spectrum' && liveSpec(o)) {
      return [bandAvg(o.spec, 0, 11), bandAvg(o.spec, 16, 32)];
    }
    var lv = clamp(Number(o.lv) || 0, 0, 1);
    var prev = o.prev == null ? lv : clamp(Number(o.prev) || 0, 0, 1);
    return [lv, prev];
  }

  // Значения визуализатора для вида. kind — тип из разметки стиля:
  // b столбики, g сегменты, bw полосы, r кольцо, w кривая, nd стрелки, sp лента (sp — см. ribbonStep).
  // o = { n, lv, spec, live, phase, prev }. Нет живого спектра — рисуем волну и плавно переходим.
  function values(kind, view, o) {
    o = o || {};
    if (kind === 'nd') return needleValues(view, o);
    var n = Math.max(1, Math.round(Number(o.n) || 1));
    var lv = clamp(Number(o.lv) || 0, 0, 1);
    var v = viewOf(view);
    var spectrum = v === 'spectrum' && liveSpec(o);
    var phase = Number(o.phase) || 0;
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      if (spectrum) {
        if (kind === 'r') {
          // Кольцо: лучи зеркальны по половинам — обе половины идут от низов к верхам.
          out[i] = interp(o.spec, Math.min(i, n - 1 - i), Math.ceil(n / 2));
        } else {
          out[i] = interp(o.spec, i, n);
        }
      } else {
        // Волна: синусоида бежит по столбикам/сегментам/полосам/кольцу, высота × громкость.
        // У горизонтальных полос (bw) — сдвиг фазы, чтобы качались волной.
        var shift = kind === 'bw' ? i * 0.12 : 0;
        out[i] = lv * (0.25 + 0.75 * waveShape(i, n, phase + shift));
      }
    }
    if (kind === 'w' && spectrum) out = smoothSeries(out);
    return out;
  }

  // Лента (sp): волна — история громкости (новое справа, как в DOS),
  // спектр — столбики полос. Нет живого спектра — снова история громкости.
  // rate — плавность из настроек; min — низкий порог, лента не пропадает.
  function ribbonStep(hist, view, o) {
    o = o || {};
    var n = Math.max(1, Math.round(Number(o.n) || (Array.isArray(hist) ? hist.length : 1)));
    var h = Array.isArray(hist) ? hist.slice(0, n).map(function (v) { return Number(v) || 0; }) : [];
    while (h.length < n) h.push(0);
    var rate = o.rate == null ? 0.5 : clamp(Number(o.rate) || 0, 0, 1);
    var i;
    if (viewOf(view) === 'spectrum' && liveSpec(o)) {
      for (i = 0; i < n; i++) h[i] = next(h[i], interp(o.spec, i, n), rate);
      return h;
    }
    var lv = clamp(Number(o.lv) || 0, 0, 1);
    var min = clamp(Number(o.min) || 0, 0, 1);
    var last = h[n - 1] || 0;
    h.shift();
    h.push(Math.max(min, next(last, lv, rate)));
    return h;
  }

  // Кривая (w) — две линии, как в образце владельца (15.11): точки 0…pts, y — доля высоты (0 — верх, 1 — низ).
  // a — простая синусоида (~3 волны на ширину), b — сложная с биением (~4 волны); к краям обе гаснут (en).
  // fill — вариант «Наклонённой обложки»: линии от низа вверх, под ними заливка.
  // Волна: обе дышат под громкость. Спектр: b — амплитуда по частотам вдоль ширины, a — громкость.
  // t — секунды; скорость как в образце (Date.now()/300).
  function waveLines(view, o) {
    o = o || {};
    var pts = Math.max(2, Math.round(Number(o.pts) || 60));
    var t = (Number(o.t) || 0) * 1000 / 300;
    var lv = clamp(Number(o.lv) || 0, 0, 1);
    var amp = 0.25 + 0.75 * lv;
    var spectrum = viewOf(view) === 'spectrum' && liveSpec(o);
    var fill = !!o.fill;
    var a = new Array(pts + 1), b = new Array(pts + 1);
    for (var i = 0; i <= pts; i++) {
      var en = Math.sin(i / pts * Math.PI);
      var s = spectrum ? interp(o.spec, i, pts + 1) : 0;
      if (fill) {
        a[i] = 0.98 - 0.55 * en * amp * Math.abs(Math.sin(t * 1.2 + i * 0.2 + 2));
        b[i] = spectrum ? 0.95 - 0.85 * en * s
          : 0.95 - 0.85 * en * amp * Math.abs(Math.sin(t + i * 0.5) * Math.cos(t * 0.7 + i * 0.21));
      } else {
        a[i] = 0.5 - 0.3 * en * amp * Math.sin(t * 1.3 + i * 0.3 + 1.5);
        b[i] = spectrum ? 0.5 - 0.45 * en * s * Math.sin(t + i * 0.45)
          : 0.5 - 0.42 * en * amp * Math.sin(t + i * 0.45) * Math.cos(t * 0.5 + i * 0.12);
      }
    }
    return { a: a, b: b };
  }

  var api = { waveLines: waveLines, clamp: clamp, interp: interp, next: next, lit: lit, needleAngle: needleAngle, waveY: waveY,
    historyPush: historyPush, imitation: imitation,
    viewOf: viewOf, waveShape: waveShape, bandAvg: bandAvg, smoothSeries: smoothSeries,
    needleValues: needleValues, values: values, ribbonStep: ribbonStep };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TapViz = api;
})(typeof window !== 'undefined' ? window : this);
