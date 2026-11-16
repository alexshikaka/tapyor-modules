'use strict';
// Шифрование куска пульта: свой формат и совместимость со страницей телефона.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const C = require('../src/crypto');

const PAGE_CRYPTO = path.join(__dirname, '..', 'page', 'crypto.js');

function loadPageCrypto() {
  const src = fs.readFileSync(PAGE_CRYPTO, 'utf8');
  const sandbox = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    CompressionStream,
    DecompressionStream,
    btoa,
    atob,
    console
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(src, context, { filename: PAGE_CRYPTO });
  assert.ok(context.RemoteCrypto, 'page/crypto.js должен выставить RemoteCrypto');
  return context.RemoteCrypto;
}

const SID = 'A'.repeat(22);

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
