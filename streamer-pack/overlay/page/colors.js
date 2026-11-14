// Цвета стилей: sRGB ↔ OKLCH и перенос сдвигов из палитры образца на цвета стримера.
// Чистые функции: работают и на странице (window.TapColors), и в Node (тесты).
(function (root) {
  'use strict';

  function norm(h) {
    h = String(h || '').replace('#', '').toLowerCase();
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-f]{6}$/.test(h)) return '#000000';
    return '#' + h;
  }
  function hex2rgb(h) {
    var n = parseInt(norm(h).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(a) {
    return '#' + a.map(function (x) {
      var v = Math.max(0, Math.min(255, Math.round(x)));
      return v.toString(16).padStart(2, '0');
    }).join('');
  }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function gam(c) { return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }

  function lch(h) {
    var c = hex2rgb(h), r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { L: L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
  }

  function raw(c) {
    var a = c.C * Math.cos(c.h * Math.PI / 180), b = c.C * Math.sin(c.h * Math.PI / 180);
    var l = Math.pow(c.L + 0.3963377774 * a + 0.2158037573 * b, 3);
    var m = Math.pow(c.L - 0.1055613458 * a - 0.0638541728 * b, 3);
    var s = Math.pow(c.L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ];
  }

  function toHex(c) {
    c = { L: Math.max(0, Math.min(1, c.L)), C: Math.max(0, c.C), h: c.h };
    function ok(v) { return v.every(function (x) { return x >= -1e-4 && x <= 1 + 1e-4; }); }
    var rgb = raw(c);
    if (!ok(rgb)) {
      var lo = 0, hi = c.C;
      for (var i = 0; i < 22; i++) {
        var md = (lo + hi) / 2;
        if (ok(raw({ L: c.L, C: md, h: c.h }))) lo = md; else hi = md;
      }
      rgb = raw({ L: c.L, C: lo, h: c.h });
    }
    return rgb2hex(rgb.map(function (x) { return gam(Math.max(0, Math.min(1, x))); }));
  }

  // Один дополнительный цвет = цвет стримера + тот же сдвиг в OKLCH, что был в образце.
  // T0/V0 — исходные цвета стиля, T/V — выбранные стримером.
  function derive(e, T0, V0, T, V) {
    e = norm(e); T0 = norm(T0); V0 = norm(V0); T = norm(T); V = norm(V);
    if (e === T0 && e === V0) return T;
    if (e === T0) return T;
    if (e === V0) return V;
    if (T === T0 && V === V0) return e;
    var E = lch(e);
    if (E.L < 0.25) return e;                     // чёрные обводки и тени не трогаем
    var t0 = lch(T0), v0 = lch(V0), tu = lch(T), vu = lch(V);
    if (E.C < 0.03) return toHex({ L: E.L + (tu.L - t0.L), C: tu.C * 0.5, h: tu.h });
    var p = null, u = null;
    if (v0.C >= 0.03) { p = v0; u = vu; } else if (t0.C >= 0.03) { p = t0; u = tu; }
    if (p) {
      if (u.C < 0.03) return toHex({ L: E.L + (u.L - p.L), C: u.C, h: u.h });
      return toHex({ L: E.L + (u.L - p.L), C: E.C * u.C / p.C, h: u.h + E.h - p.h });
    }
    var q = vu.C >= 0.03 ? vu : tu.C >= 0.03 ? tu : null;
    return q ? toHex({ L: E.L, C: E.C, h: q.h }) : e;
  }

  // Все extras палитры, пересчитанные от двух выбранных цветов.
  function variables(palette, T, V) {
    var p = palette || {};
    var t0 = p.T || T, v0 = p.V || V, out = {};
    var ex = p.extras || {};
    for (var k in ex) out[k] = derive(ex[k], t0, v0, T, V);
    return out;
  }

  var api = { norm: norm, hex2rgb: hex2rgb, rgb2hex: rgb2hex, lch: lch, toHex: toHex, derive: derive, variables: variables };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TapColors = api;
})(typeof window !== 'undefined' ? window : this);
