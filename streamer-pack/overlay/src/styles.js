'use strict';
// Список стилей оверлея — порядок и номера как в утверждённом макете.
// Те же id используют страницы: page/styles/<id>.js.

const STYLE_DEFS = Object.freeze([
  { id: 'card', num: 1, name: 'Карточка', font: 'Manrope', have: false },
  { id: 'vinyl', num: 2, name: 'Винил', font: 'Lora', have: false },
  { id: 'bigtype', num: 3, name: 'Крупный шрифт', font: 'Unbounded', have: false },
  { id: 'column', num: 4, name: 'Колонка', font: 'Tektur', have: false },
  { id: 'typography', num: 5, name: 'Типографика', font: 'Manrope', have: true },
  { id: 'tilt', num: 6, name: 'Наклонённая обложка', font: 'Manrope', have: false },
  { id: 'ribbon', num: 7, name: 'Нижняя лента', font: 'Fira Sans Condensed', have: false },
  { id: 'vtitle', num: 8, name: 'Вертикальный заголовок', font: 'Oswald', have: false },
  { id: 'win95', num: 9, name: 'Windows 95', font: 'Pixelify Sans', have: false },
  { id: 'sys7', num: 10, name: 'Mac System 7', font: 'Pixelify Sans', have: false },
  { id: 'winamp', num: 11, name: 'Winamp', font: 'Pixelify Sans', have: false },
  { id: 'dos', num: 12, name: 'DOS-терминал', font: 'Pixelify Sans', have: true },
  { id: 'swiss', num: 13, name: 'Швейцарский стиль', font: 'Golos Text', have: false },
  { id: 'hud8', num: 14, name: '8-бит HUD', font: 'Tiny5', have: false },
  { id: 'synth', num: 15, name: 'Синтвейв', font: 'Russo One', have: false },
  { id: 'paper', num: 16, name: 'Газета', font: 'Playfair Display', have: false },
  { id: 'polaroid', num: 17, name: 'Полароид', font: 'Caveat', have: false },
  { id: 'code', num: 18, name: 'Код (JSON)', font: 'JetBrains Mono', have: false },
  { id: 'cassette', num: 19, name: 'Кассета', font: 'PT Mono', have: false },
  { id: 'vu', num: 20, name: 'VU-метр', font: 'IBM Plex Mono', have: false },
  { id: 'neon', num: 21, name: 'Неоновая вывеска', font: 'Pacifico', have: false },
  { id: 'film', num: 22, name: 'Киноплёнка', font: 'Oswald', have: false },
  { id: 'citypop', num: 23, name: 'Сити-поп', font: 'Noto Serif JP', have: false },
  { id: 'popart', num: 25, name: 'Поп-арт комикс', font: 'Dela Gothic One', have: false },
  { id: 'blueprint', num: 26, name: 'Чертёж', font: 'IBM Plex Mono', have: false },
  { id: 'radar', num: 27, name: 'Радар HUD', font: 'Tektur', have: false }
]);

const STYLES = Object.freeze(STYLE_DEFS.map((s) => s.id));

module.exports = { STYLE_DEFS, STYLES };
