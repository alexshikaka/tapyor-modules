'use strict';
// Выкладка страницы телефона во временную папку — без настоящего сайта и ядра.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..', '..');
const TOOL = path.join(ROOT, 'tools', 'sync-remote-page.mjs');
const PAGE = path.join(ROOT, 'streamer-pack', 'remote', 'page');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-sync-remote-'));
}

test('SYNC: страница, app.css и config.js с адресом из relay.json', async () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'site');
    const coreCss = path.join(dir, 'core', 'app.css');
    fs.mkdirSync(path.dirname(coreCss), { recursive: true });
    fs.writeFileSync(coreCss, '/* ядро */\n:root { --bg0: #222222; }\n', 'utf8');
    const relayFile = path.join(dir, 'relay.json');
    fs.writeFileSync(relayFile, JSON.stringify({ url: 'https://functions.example/relay' }), 'utf8');

    const { syncRemotePage } = await import(pathToFileURL(TOOL).href);
    const res = syncRemotePage({ out, coreCss, relayFile, pageDir: PAGE });
    const dst = path.join(out, 'remote');

    assert.equal(res.dst, dst);
    for (const name of ['index.html', 'remote.css', 'remote.js', 'crypto.js', 'aes-gcm.js', 'render-dock.js', 'config.js', 'app.css']) {
      assert.ok(fs.existsSync(path.join(dst, name)), 'должен быть ' + name);
      assert.ok(res.copied.includes(name), 'в списке должен быть ' + name);
    }
    assert.equal(
      fs.readFileSync(path.join(dst, 'index.html'), 'utf8'),
      fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8')
    );
    assert.equal(fs.readFileSync(path.join(dst, 'app.css'), 'utf8'), '/* ядро */\n:root { --bg0: #222222; }\n');
    const config = fs.readFileSync(path.join(dst, 'config.js'), 'utf8');
    assert.match(config, /window\.REMOTE_CONFIG = \{ url: "https:\/\/functions\.example\/relay" \};/);
    assert.match(fs.readFileSync(path.join(PAGE, 'config.js'), 'utf8'), /url: ''/, 'исходный config.js не переписывается');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SYNC: без app.css ядра — понятная ошибка, временная папка не остаётся мусором', async () => {
  const dir = tempDir();
  try {
    const { syncRemotePage } = await import(pathToFileURL(TOOL).href);
    assert.throws(
      () => syncRemotePage({ out: path.join(dir, 'site'), coreCss: path.join(dir, 'нет.css'), relayFile: path.join(dir, 'нет.json') }),
      /не найден app\.css ядра/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
