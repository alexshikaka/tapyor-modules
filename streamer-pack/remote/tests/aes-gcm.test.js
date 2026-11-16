'use strict';
// AES-256-GCM на чистом JS: векторы NIST и сверка с Node crypto в обе стороны.
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const A = require('../page/aes-gcm');

function hex(s) { return Buffer.from(s, 'hex'); }

function nist(key, plain, iv, aad) {
  const out = A.encrypt(hex(key), hex(iv), hex(aad), hex(plain));
  return { cipher: Buffer.from(out.cipher).toString('hex'), tag: Buffer.from(out.tag).toString('hex') };
}

test('AES-GCM: векторы NIST (AES-256)', () => {
  // Test Case 13: пустой текст.
  assert.deepEqual(nist('00'.repeat(32), '', '00'.repeat(12), ''), {
    cipher: '',
    tag: '530f8afbc74536b9a963b4f1c4cb738b'
  });
  // Test Case 14: один блок нулей.
  assert.deepEqual(nist('00'.repeat(32), '00'.repeat(16), '00'.repeat(12), ''), {
    cipher: 'cea7403d4d606b6e074ec5d3baf39d18',
    tag: 'd0d1c8a799996bf0265b98b5d48ab919'
  });
  // Test Case 15: AAD и текст не кратны блоку.
  assert.deepEqual(
    nist(
      'feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308',
      'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
      'cafebabefacedbaddecaf888',
      'feedfacedeadbeeffeedfacedeadbeefabaddad2'
    ),
    {
      cipher: '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662',
      tag: '76fc6ece0f4e1768cddf8853bb2d551b'
    }
  );
});

test('AES-GCM: сверка с Node crypto в обе стороны (разные длины)', () => {
  for (const len of [0, 1, 15, 16, 17, 100, 4096]) {
    const key = nodeCrypto.randomBytes(32);
    const iv = nodeCrypto.randomBytes(12);
    const aad = nodeCrypto.randomBytes(len % 23);
    const plain = nodeCrypto.randomBytes(len);

    const mine = A.encrypt(key, iv, aad, plain);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const want = Buffer.concat([cipher.update(plain), cipher.final()]);
    assert.deepEqual(Buffer.from(mine.cipher), want, 'шифртекст, длина ' + len);
    assert.deepEqual(Buffer.from(mine.tag), cipher.getAuthTag(), 'тег, длина ' + len);

    // Node шифрует — чистый JS расшифровывает.
    const back = A.decrypt(key, iv, aad, want, cipher.getAuthTag());
    assert.deepEqual(Buffer.from(back || []), plain, 'расшифровка, длина ' + len);
  }
});

test('AES-GCM: испорченный тег или текст — null, без исключения', () => {
  const key = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(12);
  const aad = Buffer.from('A'.repeat(22) + '|c');
  const plain = Buffer.from('{"c":"remove","i":0}', 'utf8');
  const out = A.encrypt(key, iv, aad, plain);
  const tag = Buffer.from(out.tag);
  tag[0] ^= 0x01;
  assert.equal(A.decrypt(key, iv, aad, out.cipher, tag), null);
  const cipher = Buffer.from(out.cipher);
  cipher[0] ^= 0x01;
  assert.equal(A.decrypt(key, iv, aad, cipher, out.tag), null);
  assert.equal(A.decrypt(key, iv, Buffer.from('другой aad'), out.cipher, out.tag), null);
  assert.equal(A.decrypt(nodeCrypto.randomBytes(32), iv, aad, out.cipher, out.tag), null);
});

test('AES-GCM: неверная длина ключа и iv — понятная ошибка', () => {
  const plain = new Uint8Array(0);
  const aad = new Uint8Array(0);
  assert.throws(() => A.encrypt(new Uint8Array(16), new Uint8Array(12), aad, plain), /32 байта/);
  assert.throws(() => A.encrypt(new Uint8Array(32), new Uint8Array(16), aad, plain), /iv 12/);
  assert.throws(() => A.decrypt(new Uint8Array(16), new Uint8Array(12), aad, plain, new Uint8Array(16)), /32 байта/);
});

test('AES-GCM: ключ и данные можно передать Buffer и обычным массивом', () => {
  const key = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(12);
  const plain = Buffer.from('привет');
  const out = A.encrypt(Array.from(key), Array.from(iv), [], Array.from(plain));
  const back = A.decrypt(key, iv, new Uint8Array(0), out.cipher, out.tag);
  assert.equal(Buffer.from(back).toString('utf8'), 'привет');
});
