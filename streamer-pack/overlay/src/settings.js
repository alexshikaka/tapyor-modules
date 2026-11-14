'use strict';
// Настройки оверлея: значения по умолчанию и проверка того, что пришло из окна настроек.
// Хранятся в ядре под ключом mod.overlay (core.settings.get('overlay')).
// Старые сохранённые настройки читаются: недостающие поля берутся из DEFAULTS.

const { STYLES } = require('./styles');

const POSITIONS = ['br', 'bc', 'bl', 'tr', 'tc', 'tl'];
const SCENES = ['brand', 'rush', 'mask', 'plate'];
const MAX_COUNT = 10;
const MOTION_DEFAULTS = Object.freeze({
  style: 'dos',
  pos: 'bc',
  dx: 0,
  dy: 0,
  size: 100,
  color: '#FFB000',
  vizColor: '#FFB000',
  outline: true,
  nick: true,
  scene: 'brand',
  hold: 5
});

const DEFAULTS = Object.freeze({
  style: 'dos',
  pos: 'br',          // первая буква — верх/низ (t/b), вторая — лево/центр/право (l/c/r)
  dx: 0,              // сдвиг от угла, px экрана 1920×1080
  dy: 0,
  size: 100,          // %, 80–150
  color: '#FFB000',   // цвет текста
  vizColor: '#FFB000', // цвет визуализатора
  outline: true,      // чёрная пиксельная обводка
  nick: true,         // показывать ник заказавшего (если ядро его прислало)
  count: 3,           // сколько песен «дальше», 0–10
  fade: true,         // затухание строк списка
  fadePct: 100,       // сила затухания, 0–100
  fill: true,         // добирать из волны / фонового плейлиста
  nums: true,
  cover: true,
  time: true,
  spin: true,
  osc: true,
  prog: true,
  marq: true,
  lang: 'en',         // подписи TRACK/ARTIST или ТРЕК/АРТИСТ
  viz: 'wave',        // wave — текущая волна; spectrum — реальные 32 полосы из Тапёра
  smooth: 'mid',      // fast | mid | slow
  motion: MOTION_DEFAULTS
});

const BOOL = ['outline', 'nick', 'fill', 'nums', 'cover', 'time', 'spin', 'osc', 'prog', 'marq', 'fade'];

function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function normColor(v, def) {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
  return def;
}

function normMotion(raw, base) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...MOTION_DEFAULTS };
  if (STYLES.includes(r.style)) out.style = r.style;
  if (POSITIONS.includes(r.pos)) out.pos = r.pos;
  out.dx = clampNum(r.dx, -900, 900, out.dx);
  out.dy = clampNum(r.dy, -500, 500, out.dy);
  out.size = clampNum(r.size, 80, 150, out.size);
  out.color = normColor(r.color, out.color);
  out.vizColor = normColor(r.vizColor, out.vizColor);
  out.outline = typeof r.outline === 'boolean' ? r.outline : out.outline;
  out.nick = typeof r.nick === 'boolean' ? r.nick : out.nick;
  if (SCENES.includes(r.scene)) out.scene = r.scene;
  out.hold = clampNum(r.hold, 3, 15, out.hold);
  if (base && base.scene && !SCENES.includes(r.scene)) out.scene = base.scene;
  return out;
}

// Любой мусор превращается в рабочие настройки: неизвестные ключи отбрасываются.
function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULTS };
  if (STYLES.includes(r.style)) out.style = r.style;
  if (POSITIONS.includes(r.pos)) out.pos = r.pos;
  out.dx = clampNum(r.dx, -900, 900, DEFAULTS.dx);
  out.dy = clampNum(r.dy, -500, 500, DEFAULTS.dy);
  out.size = clampNum(r.size, 80, 150, DEFAULTS.size);
  out.color = normColor(r.color, DEFAULTS.color);
  out.vizColor = normColor(r.vizColor, out.color);
  out.count = clampNum(r.count, 0, MAX_COUNT, DEFAULTS.count);
  out.fadePct = clampNum(r.fadePct, 0, 100, DEFAULTS.fadePct);
  for (const k of BOOL) if (typeof r[k] === 'boolean') out[k] = r[k];
  if (r.lang === 'ru' || r.lang === 'en') out.lang = r.lang;
  if (r.viz === 'spectrum') out.viz = 'spectrum';
  else if (r.viz === 'wave' || r.viz === 'real' || r.viz === 'fake') out.viz = 'wave';
  if (['fast', 'mid', 'slow'].includes(r.smooth)) out.smooth = r.smooth;
  out.motion = normMotion(r.motion, DEFAULTS.motion);
  return out;
}

module.exports = { DEFAULTS, POSITIONS, STYLES, SCENES, MAX_COUNT, MOTION_DEFAULTS, normalize };
