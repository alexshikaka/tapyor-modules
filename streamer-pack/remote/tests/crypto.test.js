'use strict';
// Шифрование куска пульта: свой формат и совместимость со страницей телефона.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const nodeCrypto = require('node:crypto');
const { webcrypto } = require('node:crypto');
const C = require('../src/crypto');

const PAGE_DIR = path.join(__dirname, '..', 'page');
const PAGE_CRYPTO = path.join(PAGE_DIR, 'crypto.js');
const PAGE_AES = path.join(PAGE_DIR, 'aes-gcm.js');

function loadPageCrypto(opts = {}) {
  const sandbox = {
    // Без https браузер не даёт crypto.subtle, но getRandomValues остаётся.
    crypto: opts.noSubtle ? { getRandomValues: (arr) => webcrypto.getRandomValues(arr) } : webcrypto,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    console
  };
  if (!opts.noCompression) {
    sandbox.CompressionStream = CompressionStream;
    sandbox.DecompressionStream = DecompressionStream;
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PAGE_AES, 'utf8'), context, { filename: PAGE_AES });
  vm.runInContext(fs.readFileSync(PAGE_CRYPTO, 'utf8'), context, { filename: PAGE_CRYPTO });
  assert.ok(context.RemoteCrypto, 'page/crypto.js должен выставить RemoteCrypto');
  return context.RemoteCrypto;
}

const SID = 'A'.repeat(22);

// Кусок старого формата (RM2, без байта сжатия): iv ‖ шифртекст ‖ тег.
function oldSeal(key, sid, kind, obj) {
  const iv = nodeCrypto.randomBytes(C.IV_LEN);
  const plain = zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(sid + '|' + kind, 'utf8'));
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return C.b64u(Buffer.concat([iv, enc]));
}

// Объект из песочницы vm живёт в другом «мире»: сравниваем данные, не прототипы.
function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

test('CRYPTO: ключ — 32 случайных байта, base64url без выравнивания', () => {
  const a = C.newKey();
  const b = C.newKey();
  assert.equal(a.length, 32);
  assert.equal(b.length, 32);
  assert.notEqual(a.toString('hex'), b.toString('hex'));
  const s = C.b64u(a);
  assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(C.unb64u(s), a);
  assert.equal(C.unb64u(s + '='), null);
  assert.equal(C.unb64u('не base64'), null);
  assert.equal(C.unb64u(''), null);
  assert.equal(C.b64u(C.unb64u(s)), s);
});

test('CRYPTO: seal/open туда и обратно, ключ строкой и байтами', () => {
  const key = C.newKey();
  const obj = { v: 1, at: 1763300000000, items: [{ i: 0, title: 'Кино — Кукушка' }] };
  const piece = C.seal(key, SID, 's', obj);
  assert.match(piece, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(C.open(key, SID, 's', piece), obj);
  assert.deepEqual(C.open(C.b64u(key), SID, 's', piece), obj);
});

test('CRYPTO: чужой ключ, sid или вид — null', () => {
  const key = C.newKey();
  const piece = C.seal(key, SID, 's', { hello: 'мир' });
  assert.equal(C.open(C.newKey(), SID, 's', piece), null);
  assert.equal(C.open(key, 'B'.repeat(22), 's', piece), null);
  assert.equal(C.open(key, SID, 'f', piece), null);
  assert.equal(C.open(key, SID, 'c', piece), null);
});

test('CRYPTO: испорченный кусок — null, не исключение', () => {
  const key = C.newKey();
  const piece = C.seal(key, SID, 'c', { c: 'remove', i: 1, key: 'ym:1' });
  const bad = piece.slice(0, -2) + (piece.slice(-2) === 'AA' ? 'BB' : 'AA');
  assert.equal(C.open(key, SID, 'c', bad), null);
  assert.equal(C.open(key, SID, 'c', piece.slice(0, -5)), null);
  assert.equal(C.open(key, SID, 'c', piece + 'AAAA'), null);
  assert.equal(C.open(key, SID, 'c', 'не-кусок'), null);
  assert.equal(C.open(key, SID, 'c', null), null);
});

test('CRYPTO: страница открывает кусок модуля и наоборот', async () => {
  const P = loadPageCrypto();
  const key = C.newKey();
  const obj = { v: 1, mode: 'live', items: [{ i: 2, title: 'Земфира — Хочешь?' }] };

  const fromNode = C.seal(key, SID, 's', obj);
  assert.deepEqual(plain(await P.open(C.b64u(key), SID, 's', fromNode)), obj);

  const fromPage = await P.seal(C.b64u(key), SID, 's', obj);
  assert.deepEqual(C.open(key, SID, 's', fromPage), obj);

  const cmd = { c: 'remove', i: 0, key: 'ym:1', n: 'abcdefghijk', t: 1763300000000 };
  const pageCmd = await P.seal(C.b64u(key), SID, 'c', cmd);
  assert.deepEqual(C.open(key, SID, 'c', pageCmd), cmd);
});

test('CRYPTO: страница тоже не открывает чужой ключ и порчу', async () => {
  const P = loadPageCrypto();
  const key = C.newKey();
  const piece = C.seal(key, SID, 'f', { feedHtml: '<div class="rq">x</div>' });
  assert.equal(await P.open(C.b64u(C.newKey()), SID, 'f', piece), null);
  assert.equal(await P.open(C.b64u(key), SID, 's', piece), null);
  assert.equal(await P.open(C.b64u(key), SID, 'f', piece.slice(0, -3)), null);
});

test('CRYPTO: base64url страницы совпадает с Node', () => {
  const P = loadPageCrypto();
  const bytes = C.newKey();
  const s = P.b64u(bytes);
  assert.equal(s, C.b64u(bytes));
  assert.deepEqual(Buffer.from(P.unb64u(s)), bytes);
  const pageKey = P.newKey();
  assert.equal(pageKey.length, 32);
  assert.deepEqual(Buffer.from(pageKey), C.unb64u(C.b64u(Buffer.from(pageKey))));
});

test('CRYPTO: в куске есть флаг сжатия, старые куски без него читаются', async () => {
  const key = C.newKey();
  const obj = { v: 1, title: 'Кино — Кукушка' };
  const raw = C.unb64u(C.seal(key, SID, 's', obj));
  assert.equal(raw[C.IV_LEN], C.FLAG_DEFLATE, 'модуль сжимает и пишет флаг');

  const old = oldSeal(key, SID, 's', obj);
  assert.deepEqual(C.open(key, SID, 's', old), obj, 'модуль читает старый кусок');
  const P = loadPageCrypto();
  assert.deepEqual(plain(await P.open(C.b64u(key), SID, 's', old)), obj, 'страница читает старый кусок');

  // Кусок без сжатия (флаг 0) модуль тоже должен понимать.
  const iv = nodeCrypto.randomBytes(C.IV_LEN);
  const text = Buffer.from(JSON.stringify(obj), 'utf8');
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(SID + '|s', 'utf8'));
  const enc = Buffer.concat([cipher.update(text), cipher.final(), cipher.getAuthTag()]);
  const noZip = C.b64u(Buffer.concat([iv, Buffer.from([C.FLAG_NONE]), enc]));
  assert.deepEqual(C.open(key, SID, 's', noZip), obj);
  assert.deepEqual(plain(await P.open(C.b64u(key), SID, 's', noZip)), obj);
});

test('CRYPTO: без crypto.subtle страница шифрует и читает через AES-GCM на чистом JS', async () => {
  const P = loadPageCrypto({ noSubtle: true });
  assert.equal(P.hasSubtle(), false);
  const key = C.newKey();
  const obj = { v: 1, items: [{ i: 0, title: 'Земфира — Хочешь?' }], n: 42 };

  const fromPage = await P.seal(C.b64u(key), SID, 's', obj);
  assert.deepEqual(C.open(key, SID, 's', fromPage), obj, 'модуль читает кусок чистой страницы');

  const fromNode = C.seal(key, SID, 's', obj);
  assert.deepEqual(plain(await P.open(C.b64u(key), SID, 's', fromNode)), obj, 'страница читает кусок модуля');

  const cmd = { c: 'remove', i: 0, key: 'ym:1', n: 'abcdefghijk', t: 1763300000000 };
  const piece = await P.seal(C.b64u(key), SID, 'c', cmd);
  assert.deepEqual(C.open(key, SID, 'c', piece), cmd);
  const bad = await P.open(C.b64u(C.newKey()), SID, 'c', piece);
  assert.equal(bad, null, 'чужой ключ не читается');
});

test('CRYPTO: без CompressionStream кусок идёт без сжатия (флаг 0)', async () => {
  const P = loadPageCrypto({ noSubtle: true, noCompression: true });
  const key = C.newKey();
  const obj = { feedHtml: '<div class="rq">x</div>', msgCount: 1 };
  const piece = await P.seal(C.b64u(key), SID, 'f', obj);
  const raw = C.unb64u(piece);
  assert.equal(raw[C.IV_LEN], C.FLAG_NONE, 'флаг «без сжатия»');
  assert.deepEqual(C.open(key, SID, 'f', piece), obj);
  assert.deepEqual(plain(await loadPageCrypto().open(C.b64u(key), SID, 'f', piece)), obj);
  // Сжатый кусок модуля такая страница прочитать не может — честно возвращает null.
  assert.equal(await P.open(C.b64u(key), SID, 'f', C.seal(key, SID, 'f', obj)), null);
});
