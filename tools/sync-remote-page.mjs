#!/usr/bin/env node
// Копирует страницу телефона в сайт Тапёра и кладёт рядом app.css ядра.
// Запуск (по команде владельца, не автоматически):
//   node tools/sync-remote-page.mjs [путь-сайта] [путь-к-app.css]
// По умолчанию: ../tapyor-web и ../Tapyor-player/src/app.css.
// config.js пишется из streamer-pack/remote/relay.json — адрес функции в репозитории не хранится.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_DIR = path.join(ROOT, 'streamer-pack', 'remote', 'page');
const RELAY_FILE = path.join(ROOT, 'streamer-pack', 'remote', 'relay.json');

function readRelay(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    throw new Error('не найден relay.json: ' + file);
  }
  let json = null;
  try { json = JSON.parse(raw); } catch (e) {
    throw new Error('relay.json не разбирается: ' + file);
  }
  const relays = [];
  const push = (value) => {
    const url = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
    if (url && relays.indexOf(url) < 0) relays.push(url);
  };
  if (json && Array.isArray(json.relays)) for (const value of json.relays) push(value);
  if (!relays.length && json) push(json.url);
  return { relays, url: relays[0] || '' };
}

export function syncRemotePage(options = {}) {
  const out = path.resolve(options.out || path.resolve(process.cwd(), '..', 'tapyor-web'));
  const coreCss = path.resolve(options.coreCss || path.resolve(process.cwd(), '..', 'Tapyor-player', 'src', 'app.css'));
  const relayFile = path.resolve(options.relayFile || RELAY_FILE);
  const pageDir = path.resolve(options.pageDir || PAGE_DIR);

  if (!fs.existsSync(pageDir)) throw new Error('не найдена папка страницы: ' + pageDir);
  if (!fs.existsSync(coreCss)) throw new Error('не найден app.css ядра: ' + coreCss);
  const relay = readRelay(relayFile);

  const dst = path.join(out, 'remote');
  fs.mkdirSync(dst, { recursive: true });

  const copied = [];
  for (const ent of fs.readdirSync(pageDir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    fs.copyFileSync(path.join(pageDir, ent.name), path.join(dst, ent.name));
    copied.push(ent.name);
  }
  fs.copyFileSync(coreCss, path.join(dst, 'app.css'));

  const config = '/* Список облаков пульта. Файл создан tools/sync-remote-page.mjs из relay.json. */\n' +
    'window.REMOTE_CONFIG = { relays: ' + JSON.stringify(relay.relays) +
    ', url: ' + JSON.stringify(relay.url) + ' };\n';
  fs.writeFileSync(path.join(dst, 'config.js'), config, 'utf8');

  return { out, dst, copied: copied.concat(['app.css', 'config.js']).sort(), relays: relay.relays, url: relay.url };
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const args = process.argv.slice(2);
  try {
    const res = syncRemotePage({ out: args[0], coreCss: args[1] });
    console.log('Страница пульта: ' + res.dst + ' (файлов: ' + res.copied.length + ')');
  } catch (e) {
    console.error('Не удалось выложить страницу пульта: ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}
