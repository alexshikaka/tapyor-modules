'use strict';
// Шрифты оверлея: файлы лежат в паке, fonts.css покрывает кириллицу, раздача идёт через белый список.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', 'page');
const FONT_DIR = path.join(PAGE, 'fonts');
const CSS = fs.readFileSync(path.join(PAGE, 'fonts.css'), 'utf8');

const EXPECTED = [
  ['Lora', [600], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Unbounded', [700], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Golos Text', [700], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Tektur', [600, 700], ['latin', 'latin-ext', 'cyrillic']],
  ['Fira Sans Condensed', [600, 700], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Oswald', [500, 700], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Tiny5', [400], ['latin', 'latin-ext', 'cyrillic']],
  ['Russo One', [400], ['latin', 'latin-ext', 'cyrillic']],
  ['PT Mono', [400], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['IBM Plex Mono', [500, 700], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Dela Gothic One', [400], ['latin', 'latin-ext', 'cyrillic']],
  ['Playfair Display', [700], ['latin', 'latin-ext', 'cyrillic']],
  ['Caveat', [700], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Pacifico', [400], ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']],
  ['Noto Serif JP', [700], ['subset']]
];

function value(block, name) {
  const m = block.match(new RegExp(name + '\\s*:\\s*([^;]+)', 'i'));
  return m ? m[1].trim() : '';
}

function parseFaces(css) {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const block = m[1];
    const src = block.match(/url\(["']fonts\/([^"']+\.woff2)["']\)/);
    return {
      family: value(block, 'font-family').replace(/^["']|["']$/g, ''),
      weight: Number(value(block, 'font-weight')),
      display: value(block, 'font-display'),
      range: value(block, 'unicode-range'),
      file: src ? src[1] : ''
    };
  });
}

function covers(range, from, to) {
  for (const part of String(range).split(',')) {
    const m = part.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f?]+))?$/i);
    if (!m) continue;
    const a = parseInt(m[1].replace(/\?/g, '0'), 16);
    const b = parseInt((m[2] || m[1]).replace(/\?/g, 'f'), 16);
    if (a <= from && b >= to) return true;
  }
  return false;
}

const FACES = parseFaces(CSS);

test('шрифты: fonts.css покрывает кириллицу для каждого семейства и начертания', () => {
  for (const [family, weights, subsets] of EXPECTED) {
    const own = FACES.filter((f) => f.family === family);
    assert.ok(own.length > 0, 'нет @font-face для ' + family);
    for (const weight of weights) {
      const cyr = own.filter((f) => f.weight === weight && covers(f.range, 0x0410, 0x044f));
      assert.ok(cyr.length > 0, family + ' ' + weight + ': нет набора с кириллицей U+0410–044F');
      for (const subset of subsets) {
        const file = family.toLowerCase().replace(/\s+/g, '-') + '-' + weight + '-' + subset + '.woff2';
        assert.ok(FACES.some((f) => f.family === family && f.file === file), 'нет файла ' + file);
      }
    }
  }
});

test('шрифты: все файлы из fonts.css существуют и все woff2 в папке описаны', () => {
  for (const f of FACES) {
    assert.ok(f.file, 'у @font-face нет пути к файлу');
    assert.equal(f.file.includes('..'), false);
    assert.equal(f.file.startsWith('/'), false);
    const p = path.join(FONT_DIR, f.file);
    assert.ok(fs.existsSync(p), 'нет файла ' + f.file);
    assert.ok(fs.statSync(p).size > 0, 'пустой файл ' + f.file);
  }

  const disk = fs.readdirSync(FONT_DIR).filter((n) => n.endsWith('.woff2')).sort();
  const used = [...new Set(FACES.map((f) => f.file))].sort();
  assert.equal(FACES.length, disk.length, 'в fonts.css должны быть описаны все файлы по одному разу');
  assert.deepEqual(disk, used);
});

test('шрифты: только локальные файлы, font-display: block', () => {
  assert.equal(/https?:\/\//i.test(CSS), false, 'fonts.css не должен ссылаться на интернет');
  for (const f of FACES) {
    assert.equal(f.display, 'block', f.file + ': font-display должен быть block');
    assert.match(f.range, /U\+/i, f.file + ': нет unicode-range');
  }
});

test('шрифты: Noto Serif JP — маленький набор с кириллицей и иероглифами 再生中', () => {
  const file = path.join(FONT_DIR, 'noto-serif-jp-700-subset.woff2');
  assert.ok(fs.existsSync(file), 'нет файла Noto Serif JP');
  assert.ok(fs.statSync(file).size < 120 * 1024, 'Noto Serif JP больше 120 КБ');
  const face = FACES.find((f) => f.family === 'Noto Serif JP' && f.weight === 700);
  assert.ok(face, 'нет @font-face Noto Serif JP 700');
  assert.ok(covers(face.range, 0x0410, 0x044f), 'Noto Serif JP: нет кириллицы');
  for (const cp of [0x518d, 0x751f, 0x4e2d]) assert.ok(covers(face.range, cp, cp), 'Noto Serif JP: нет U+' + cp.toString(16));
});
