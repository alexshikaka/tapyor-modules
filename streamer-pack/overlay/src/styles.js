'use strict';
// Список стилей оверлея — порядок и номера как в утверждённом макете.
// Те же id используют страницы: page/styles/<id>.js.
// color/vizColor — цвета стиля по умолчанию (T и V из META макета): их ставит окно настроек ядра
// при выборе стиля. Верхний регистр #RRGGBB.

const STYLE_DEFS = Object.freeze([
  { id: 'card', num: 1, name: 'Карточка', font: 'Manrope', have: false, color: '#FFFFFF', vizColor: '#F0654F' },
  { id: 'vinyl', num: 2, name: 'Винил', font: 'Lora', have: false, color: '#FFF4D6', vizColor: '#E9C46A' },
  { id: 'bigtype', num: 3, name: 'Крупный шрифт', font: 'Unbounded', have: false, color: '#FFFFFF', vizColor: '#FFE14D' },
  { id: 'column', num: 4, name: 'Колонка', font: 'Tektur', have: false, color: '#FFFFFF', vizColor: '#19E3FF' },
  { id: 'typography', num: 5, name: 'Типографика', font: 'Manrope', have: true, color: '#FFFFFF', vizColor: '#FFFFFF' },
  { id: 'tilt', num: 6, name: 'Наклонённая обложка', font: 'Manrope', have: false, color: '#FFFFFF', vizColor: '#FFB347' },
  { id: 'ribbon', num: 7, name: 'Нижняя лента', font: 'Fira Sans Condensed', have: false, color: '#FFFFFF', vizColor: '#4DD4AC' },
  { id: 'vtitle', num: 8, name: 'Вертикальный заголовок', font: 'Oswald', have: false, color: '#FFFFFF', vizColor: '#C8F542' },
  { id: 'win95', num: 9, name: 'Windows 95', font: 'Pixelify Sans', have: false, color: '#FFFFFF', vizColor: '#00FF00' },
  { id: 'sys7', num: 10, name: 'Mac System 7', font: 'Pixelify Sans', have: false, color: '#FFFFFF', vizColor: '#FFFFFF' },
  { id: 'winamp', num: 11, name: 'Winamp', font: 'Pixelify Sans', have: false, color: '#2CFF2C', vizColor: '#20E020' },
  { id: 'dos', num: 12, name: 'DOS-терминал', font: 'Pixelify Sans', have: true, color: '#FFB000', vizColor: '#FFB000' },
  { id: 'swiss', num: 13, name: 'Швейцарский стиль', font: 'Golos Text', have: false, color: '#FFFFFF', vizColor: '#FF2D2D' },
  { id: 'hud8', num: 14, name: '8-бит HUD', font: 'Tiny5', have: false, color: '#FFFFFF', vizColor: '#FFD23F' },
  { id: 'synth', num: 15, name: 'Синтвейв', font: 'Russo One', have: false, color: '#FFFFFF', vizColor: '#FF2BD6' },
  { id: 'paper', num: 16, name: 'Газета', font: 'Playfair Display', have: false, color: '#FFFFFF', vizColor: '#FFFFFF' },
  { id: 'polaroid', num: 17, name: 'Полароид', font: 'Caveat', have: false, color: '#FFFFFF', vizColor: '#FFD6A5' },
  { id: 'code', num: 18, name: 'Код (JSON)', font: 'JetBrains Mono', have: false, color: '#E6EDF3', vizColor: '#7EE787' },
  { id: 'cassette', num: 19, name: 'Кассета', font: 'PT Mono', have: false, color: '#FFFFFF', vizColor: '#E8D9B5' },
  { id: 'vu', num: 20, name: 'VU-метр', font: 'IBM Plex Mono', have: false, color: '#FFFFFF', vizColor: '#FFCC00' },
  { id: 'neon', num: 21, name: 'Неоновая вывеска', font: 'Pacifico', have: false, color: '#FF5FD2', vizColor: '#5FF3FF' },
  { id: 'film', num: 22, name: 'Киноплёнка', font: 'Oswald', have: false, color: '#FFFFFF', vizColor: '#FFFFFF' },
  { id: 'citypop', num: 23, name: 'Сити-поп', font: 'Noto Serif JP', have: false, color: '#FFFFFF', vizColor: '#FF6B6B' },
  { id: 'popart', num: 25, name: 'Поп-арт комикс', font: 'Dela Gothic One', have: false, color: '#FFFFFF', vizColor: '#FF3B6B' },
  { id: 'blueprint', num: 26, name: 'Чертёж', font: 'IBM Plex Mono', have: false, color: '#9FE3FF', vizColor: '#9FE3FF' },
  { id: 'radar', num: 27, name: 'Радар HUD', font: 'Tektur', have: false, color: '#7DFFB2', vizColor: '#7DFFB2' }
]);

const STYLES = Object.freeze(STYLE_DEFS.map((s) => s.id));

module.exports = { STYLE_DEFS, STYLES };
