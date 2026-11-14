#!/usr/bin/env node
'use strict';
// Скачивает шрифты для новых стилей оверлея в пак: streamer-pack/overlay/page/fonts/.
// Google Fonts отдаёт woff2 только современному браузеру, поэтому запрос идёт с User-Agent Chrome.
// Скрипт можно перезапускать: файлы и fonts.css перезаписываются.
// Если у семейства не оказалось кириллицы — скрипт падает, а не кладёт неполный набор.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'streamer-pack', 'overlay', 'page');
const FONT_DIR = path.join(PAGE, 'fonts');
const CSS_FILE = path.join(PAGE, 'fonts.css');
const OFL_FILE = path.join(FONT_DIR, 'OFL.txt');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FONT_FILE = /^[a-z0-9-]+\.woff2$/;

// Наборы идут в таком порядке и в fonts.css, и в файлах.
const FAMILIES = [
  { name: 'Lora', slug: 'lora', weights: [600], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'Unbounded', slug: 'unbounded', weights: [700], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'Golos Text', slug: 'golostext', weights: [700], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'Tektur', slug: 'tektur', weights: [600, 700], subsets: ['latin', 'latin-ext', 'cyrillic'] },
  { name: 'Fira Sans Condensed', slug: 'firasanscondensed', weights: [600, 700], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'Oswald', slug: 'oswald', weights: [500, 700], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'Tiny5', slug: 'tiny5', weights: [400], subsets: ['latin', 'latin-ext', 'cyrillic'] },
  { name: 'Russo One', slug: 'russoone', weights: [400], subsets: ['latin', 'latin-ext', 'cyrillic'] },
  { name: 'PT Mono', slug: 'ptmono', weights: [400], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'IBM Plex Mono', slug: 'ibmplexmono', weights: [500, 700], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'Dela Gothic One', slug: 'delagothicone', weights: [400], subsets: ['latin', 'latin-ext', 'cyrillic'] },
  { name: 'Playfair Display', slug: 'playfairdisplay', weights: [700], subsets: ['latin', 'latin-ext', 'cyrillic'] },
  { name: 'Caveat', slug: 'caveat', weights: [700], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] },
  { name: 'Pacifico', slug: 'pacifico', weights: [400], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'] }
];
const NOTO = { name: 'Noto Serif JP', slug: 'notoserifjp', weight: 700, file: 'noto-serif-jp-700-subset.woff2' };

const slug = (name) => name.toLowerCase().replace(/\s+/g, '-');

function cssUrl(name, weights) {
  return 'https://fonts.googleapis.com/css2?family=' + name.replace(/ /g, '+') +
    ':wght@' + weights.join(';') + '&display=swap';
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
  return r.text();
}

async function fetchBinary(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
  return Buffer.from(await r.arrayBuffer());
}

function prop(block, name) {
  const m = block.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'i'));
  return m ? m[1].trim() : '';
}

function parseFace(block) {
  const src = block.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
  const weight = Number(prop(block, 'font-weight'));
  const family = prop(block, 'font-family').replace(/^["']|["']$/g, '');
  const range = prop(block, 'unicode-range');
  return { family, weight, url: src && src[1], range };
}

// В ответе Google перед каждым @font-face стоит комментарий с именем набора.
function parseSubsetFaces(css) {
  const out = [];
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push({ subset: m[1], ...parseFace(m[2]) });
  return out;
}

function parseSingleFace(css) {
  const m = css.match(/@font-face\s*\{([^}]*)\}/);
  if (!m) throw new Error('в ответе Google нет @font-face');
  return parseFace(m[1]);
}

function rangeCovers(range, from, to) {
  for (const part of String(range).split(',')) {
    const t = part.trim().replace(/^U\+/i, '');
    const [a, b = a] = t.split('-');
    if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) continue;
    if (parseInt(a, 16) <= from && parseInt(b, 16) >= to) return true;
  }
  return false;
}

function notoText() {
  const chars = [];
  for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCharCode(c));       // печатная латиница
  for (let c = 0x410; c <= 0x44f; c++) chars.push(String.fromCharCode(c));     // кириллица А–я
  chars.push('Ё', 'ё', '再', '生', '中');
  return chars.join('');
}

async function main() {
  await mkdir(FONT_DIR, { recursive: true });
  const faces = [];

  for (const fam of FAMILIES) {
    const css = await fetchText(cssUrl(fam.name, fam.weights));
    const subsetFaces = parseSubsetFaces(css);
    const cyr = subsetFaces.filter((f) => f.subset === 'cyrillic' && rangeCovers(f.range, 0x0410, 0x044f));
    if (!cyr.length) throw new Error('у семейства ' + fam.name + ' нет кириллицы в ответе Google Fonts');

    for (const weight of fam.weights) {
      for (const subset of fam.subsets) {
        const face = subsetFaces.find((f) => f.subset === subset && f.weight === weight);
        if (!face || !face.url) throw new Error(fam.name + ' ' + weight + ': Google Fonts не отдал набор ' + subset);
        if (!face.range) throw new Error(fam.name + ' ' + weight + ': нет unicode-range для набора ' + subset);

        const file = slug(fam.name) + '-' + weight + '-' + subset + '.woff2';
        if (!FONT_FILE.test(file)) throw new Error('плохое имя файла: ' + file);
        const data = await fetchBinary(face.url);
        await writeFile(path.join(FONT_DIR, file), data);
        faces.push({ family: fam.name, weight, subset, file, range: face.range, bytes: data.length });
        process.stdout.write('  ' + file + '  ' + data.length + ' Б\n');
      }
    }
  }

  const notoCss = await fetchText('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@700&text=' +
    encodeURIComponent(notoText()));
  const noto = parseSingleFace(notoCss);
  if (!noto.url) throw new Error('Noto Serif JP: Google Fonts не отдал файл');
  if (!rangeCovers(noto.range, 0x0410, 0x044f)) throw new Error('Noto Serif JP: в наборе нет кириллицы');
  const notoData = await fetchBinary(noto.url);
  if (notoData.length >= 120 * 1024) throw new Error('Noto Serif JP получился больше 120 КБ');
  await writeFile(path.join(FONT_DIR, NOTO.file), notoData);
  faces.push({ family: NOTO.name, weight: NOTO.weight, subset: 'subset', file: NOTO.file, range: noto.range, bytes: notoData.length });
  process.stdout.write('  ' + NOTO.file + '  ' + notoData.length + ' Б\n');

  const css = [
    '/* Шрифты оверлея Тапёра. Сгенерировано tools/fetch-overlay-fonts.mjs; руками не править. */',
    '/* Все файлы лежат рядом в fonts/ — страница OBS не ходит в интернет. */',
    ''
  ];
  for (const f of faces) {
    css.push('@font-face {');
    css.push('  font-family: "' + f.family + '";');
    css.push('  font-style: normal;');
    css.push('  font-weight: ' + f.weight + ';');
    css.push('  font-display: block;');
    css.push('  src: url("fonts/' + f.file + '") format("woff2");');
    css.push('  unicode-range: ' + f.range + ';');
    css.push('}');
    css.push('');
  }
  await writeFile(CSS_FILE, css.join('\n'), 'utf8');

  // OFL требует приложить текст лицензии и уведомления об авторских правах.
  const parts = [
    'SIL Open Font License 1.1',
    'Шрифты в этой папке распространяются по SIL Open Font License 1.1.',
    'Ниже — тексты лицензии для каждого семейства (с уведомлениями об авторских правах).',
    ''
  ];
  for (const fam of [...FAMILIES, NOTO]) {
    const text = await fetchText('https://raw.githubusercontent.com/google/fonts/main/ofl/' + fam.slug + '/OFL.txt');
    parts.push('='.repeat(78));
    parts.push(fam.name);
    parts.push('='.repeat(78));
    parts.push(text.trim());
    parts.push('');
  }
  await writeFile(OFL_FILE, parts.join('\n') + '\n', 'utf8');

  const total = faces.reduce((n, f) => n + f.bytes, 0) + Buffer.byteLength(parts.join('\n'));
  process.stdout.write('\nГотово: ' + faces.length + ' файлов woff2, ' +
    (total / 1024 / 1024).toFixed(2) + ' МБ вместе с OFL.txt.\n');
}

main().catch((e) => {
  console.error('Ошибка: ' + e.message);
  process.exitCode = 1;
});
