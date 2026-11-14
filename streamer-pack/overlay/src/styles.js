'use strict';
// Список стилей оверлея — порядок и номера как в утверждённом макете.
// Те же id используют страницы: page/styles/<id>.js.
// color/vizColor — цвета стиля по умолчанию (T и V из META макета): их ставит окно настроек ядра
// при выборе стиля. Верхний регистр #RRGGBB.

// Ключи «Что показывать» из договора OVERLAYS-FEATURES.md. У стиля в features только те,
// чьи элементы у него реально есть; ключей очереди у моушна нет никогда.
const FEATURE_KEYS = Object.freeze(['cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang', 'count', 'fade', 'fill', 'nums']);
const QUEUE_FEATURES = Object.freeze(['count', 'fade', 'fill', 'nums']);
const MOTION_FEATURE_KEYS = Object.freeze(['cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang', 'viz', 'smooth']);
const VIZ_KINDS = Object.freeze(['spectrum', 'level', null]);

// Короткая запись очереди: она есть у всех стилей плейлиста.
const Q = QUEUE_FEATURES;
const BASE = ['cover', 'osc', 'marq', ...Q];
const WITH_TIME = ['cover', 'time', 'osc', 'marq', ...Q];

const STYLE_DEFS = Object.freeze([
  { id: 'card', num: 1, name: 'Карточка', font: 'Manrope', have: false, color: '#FFFFFF', vizColor: '#F0654F',
    features: ['cover', 'osc', 'marq', ...Q], vizKind: 'spectrum' },
  { id: 'vinyl', num: 2, name: 'Винил', font: 'Lora', have: false, color: '#FFF4D6', vizColor: '#E9C46A',
    features: BASE, vizKind: 'spectrum' },
  { id: 'bigtype', num: 3, name: 'Крупный шрифт', font: 'Unbounded', have: false, color: '#FFFFFF', vizColor: '#FFE14D',
    features: BASE, vizKind: 'spectrum' },
  { id: 'column', num: 4, name: 'Колонка', font: 'Tektur', have: false, color: '#FFFFFF', vizColor: '#19E3FF',
    features: BASE, vizKind: 'spectrum' },
  { id: 'typography', num: 5, name: 'Типографика', font: 'Manrope', have: true, color: '#FFFFFF', vizColor: '#FFFFFF',
    features: BASE, vizKind: 'spectrum' },
  { id: 'tilt', num: 6, name: 'Наклонённая обложка', font: 'Manrope', have: false, color: '#FFFFFF', vizColor: '#FFB347',
    features: BASE, vizKind: 'spectrum' },
  { id: 'ribbon', num: 7, name: 'Нижняя лента', font: 'Fira Sans Condensed', have: false, color: '#FFFFFF', vizColor: '#4DD4AC',
    features: BASE, vizKind: 'spectrum' },
  { id: 'vtitle', num: 8, name: 'Вертикальный заголовок', font: 'Oswald', have: false, color: '#FFFFFF', vizColor: '#C8F542',
    features: BASE, vizKind: 'spectrum' },
  { id: 'win95', num: 9, name: 'Windows 95', font: 'Pixelify Sans', have: false, color: '#FFFFFF', vizColor: '#00FF00',
    features: WITH_TIME, vizKind: 'spectrum' },
  { id: 'sys7', num: 10, name: 'Mac System 7', font: 'Pixelify Sans', have: false, color: '#FFFFFF', vizColor: '#FFFFFF',
    features: WITH_TIME, vizKind: 'spectrum' },
  { id: 'winamp', num: 11, name: 'Winamp', font: 'Pixelify Sans', have: false, color: '#2CFF2C', vizColor: '#20E020',
    features: WITH_TIME, vizKind: 'spectrum' },
  { id: 'dos', num: 12, name: 'DOS-терминал', font: 'Pixelify Sans', have: true, color: '#FFB000', vizColor: '#FFB000',
    features: ['cover', 'time', 'spin', 'prog', 'osc', 'marq', 'lang', ...Q], vizKind: 'spectrum' },
  { id: 'swiss', num: 13, name: 'Швейцарский стиль', font: 'Golos Text', have: false, color: '#FFFFFF', vizColor: '#FF2D2D',
    features: ['cover', 'time', 'marq', ...Q], vizKind: null },
  { id: 'hud8', num: 14, name: '8-бит HUD', font: 'Tiny5', have: false, color: '#FFFFFF', vizColor: '#FFD23F',
    features: ['cover', 'time', 'prog', 'marq', ...Q], vizKind: null },
  { id: 'synth', num: 15, name: 'Синтвейв', font: 'Russo One', have: false, color: '#FFFFFF', vizColor: '#FF2BD6',
    features: BASE, vizKind: 'spectrum' },
  { id: 'paper', num: 16, name: 'Газета', font: 'Playfair Display', have: false, color: '#FFFFFF', vizColor: '#FFFFFF',
    features: BASE, vizKind: 'spectrum' },
  { id: 'polaroid', num: 17, name: 'Полароид', font: 'Caveat', have: false, color: '#FFFFFF', vizColor: '#FFD6A5',
    features: BASE, vizKind: 'spectrum' },
  { id: 'code', num: 18, name: 'Код (JSON)', font: 'JetBrains Mono', have: false, color: '#E6EDF3', vizColor: '#7EE787',
    features: WITH_TIME, vizKind: 'spectrum' },
  { id: 'cassette', num: 19, name: 'Кассета', font: 'PT Mono', have: false, color: '#FFFFFF', vizColor: '#E8D9B5',
    // У кассеты вместо обложки — сама кассета, поэтому переключателя обложки у неё нет.
    features: ['osc', 'marq', ...Q], vizKind: 'spectrum' },
  { id: 'vu', num: 20, name: 'VU-метр', font: 'IBM Plex Mono', have: false, color: '#FFFFFF', vizColor: '#FFCC00',
    features: BASE, vizKind: 'level' },
  { id: 'neon', num: 21, name: 'Неоновая вывеска', font: 'Pacifico', have: false, color: '#FF5FD2', vizColor: '#5FF3FF',
    features: BASE, vizKind: 'spectrum' },
  { id: 'film', num: 22, name: 'Киноплёнка', font: 'Oswald', have: false, color: '#FFFFFF', vizColor: '#FFFFFF',
    features: WITH_TIME, vizKind: 'spectrum' },
  { id: 'citypop', num: 23, name: 'Сити-поп', font: 'Noto Serif JP', have: false, color: '#FFFFFF', vizColor: '#FF6B6B',
    features: BASE, vizKind: 'spectrum' },
  { id: 'popart', num: 25, name: 'Поп-арт комикс', font: 'Dela Gothic One', have: false, color: '#FFFFFF', vizColor: '#FF3B6B',
    features: BASE, vizKind: 'spectrum' },
  { id: 'blueprint', num: 26, name: 'Чертёж', font: 'IBM Plex Mono', have: false, color: '#9FE3FF', vizColor: '#9FE3FF',
    features: ['cover', 'time', 'osc', 'marq', 'lang', ...Q], vizKind: 'spectrum' },
  { id: 'radar', num: 27, name: 'Радар HUD', font: 'Tektur', have: false, color: '#7DFFB2', vizColor: '#7DFFB2',
    features: WITH_TIME, vizKind: 'spectrum' }
].map((s) => Object.freeze({ ...s, features: Object.freeze(s.features.slice()) })));

const STYLES = Object.freeze(STYLE_DEFS.map((s) => s.id));

module.exports = { STYLE_DEFS, STYLES, FEATURE_KEYS, QUEUE_FEATURES, MOTION_FEATURE_KEYS, VIZ_KINDS };
