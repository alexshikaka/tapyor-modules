/* AES-256-GCM на чистом JS — для страницы пульта, открытой по обычному http://,
   где браузер не даёт crypto.subtle. Только шифрование блока AES (для GCM расшифровка
   тоже считается через него), GHASH по GF(2^128), CTR и тег. IV — 12 байт, тег — 16.
   Проверяется векторами NIST и сверкой с Node crypto (tests/aes-gcm.test.js). */
(function (global) {
  'use strict';

  var KEY_LEN = 32;
  var IV_LEN = 12;
  var TAG_LEN = 16;

  // S-бокс AES: обратный элемент в GF(2^8) + аффинное преобразование.
  var SBOX = (function () {
    function mul(a, b) {
      var p = 0;
      for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
      }
      return p;
    }
    var inv = new Uint8Array(256);
    for (var x = 1; x < 256; x++) {
      for (var y = 1; y < 256; y++) {
        if (mul(x, y) === 1) { inv[x] = y; break; }
      }
    }
    var s = new Uint8Array(256);
    for (var v = 0; v < 256; v++) {
      var b = inv[v];
      var r = b;
      for (var k = 1; k <= 4; k++) r ^= ((b << k) | (b >> (8 - k))) & 0xff;
      s[v] = r ^ 0x63;
    }
    return s;
  })();

  function xtime(a) {
    return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
  }

  function bytes(v) {
    if (v == null) return new Uint8Array(0);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (Array.isArray(v)) return Uint8Array.from(v);
    throw new Error('AES-GCM: ожидались байты');
  }

  function expandKey(key) {
    if (key.length !== KEY_LEN) throw new Error('AES-GCM: нужен ключ 32 байта');
    var w = new Uint8Array(240);
    w.set(key);
    var rcon = 1;
    for (var i = 32; i < 240; i += 4) {
      var a = w[i - 4];
      var b = w[i - 3];
      var c = w[i - 2];
      var d = w[i - 1];
      if (i % 32 === 0) {
        var t = a;
        a = SBOX[b] ^ rcon;
        b = SBOX[c];
        c = SBOX[d];
        d = SBOX[t];
        rcon = xtime(rcon);
      } else if (i % 32 === 16) {
        a = SBOX[a];
        b = SBOX[b];
        c = SBOX[c];
        d = SBOX[d];
      }
      w[i] = w[i - 32] ^ a;
      w[i + 1] = w[i - 31] ^ b;
      w[i + 2] = w[i - 30] ^ c;
      w[i + 3] = w[i - 29] ^ d;
    }
    return w;
  }

  function addKey(s, rk, off) {
    for (var i = 0; i < 16; i++) s[i] ^= rk[off + i];
  }

  // SubBytes + ShiftRows вместе: состояние — 16 байт по столбцам (индекс = 4*столбец + строка).
  function subShift(s) {
    var t = s.slice();
    s[0] = SBOX[t[0]]; s[4] = SBOX[t[4]]; s[8] = SBOX[t[8]]; s[12] = SBOX[t[12]];
    s[1] = SBOX[t[5]]; s[5] = SBOX[t[9]]; s[9] = SBOX[t[13]]; s[13] = SBOX[t[1]];
    s[2] = SBOX[t[10]]; s[6] = SBOX[t[14]]; s[10] = SBOX[t[2]]; s[14] = SBOX[t[6]];
    s[3] = SBOX[t[15]]; s[7] = SBOX[t[3]]; s[11] = SBOX[t[7]]; s[15] = SBOX[t[11]];
  }

  function mix(s) {
    for (var c = 0; c < 16; c += 4) {
      var a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
      s[c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
      s[c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
      s[c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
      s[c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
    }
  }

  function encryptBlock(rk, block) {
    var s = new Uint8Array(16);
    s.set(block);
    addKey(s, rk, 0);
    for (var round = 1; round <= 13; round++) {
      subShift(s);
      mix(s);
      addKey(s, rk, round * 16);
    }
    subShift(s);
    addKey(s, rk, 224);
    return s;
  }

  // Умножение в GF(2^128) по правилам GCM (старший бит первый, R = 11100001).
  function gfMul(x, y) {
    var z = new Uint8Array(16);
    var v = new Uint8Array(y);
    for (var i = 0; i < 128; i++) {
      if ((x[i >> 3] & (0x80 >> (i & 7))) !== 0) {
        for (var j = 0; j < 16; j++) z[j] ^= v[j];
      }
      var lsb = v[15] & 1;
      for (var k = 15; k > 0; k--) v[k] = ((v[k] >> 1) | ((v[k - 1] & 1) << 7)) & 0xff;
      v[0] = (v[0] >> 1) & 0xff;
      if (lsb) v[0] ^= 0xe1;
    }
    return z;
  }

  function pad16(src) {
    var out = new Uint8Array(Math.ceil(src.length / 16) * 16);
    out.set(src);
    return out;
  }

  function u64(n) {
    var out = new Uint8Array(8);
    var hi = Math.floor(n / 0x100000000);
    var lo = n >>> 0;
    out[0] = (hi >>> 24) & 0xff; out[1] = (hi >>> 16) & 0xff;
    out[2] = (hi >>> 8) & 0xff; out[3] = hi & 0xff;
    out[4] = (lo >>> 24) & 0xff; out[5] = (lo >>> 16) & 0xff;
    out[6] = (lo >>> 8) & 0xff; out[7] = lo & 0xff;
    return out;
  }

  // GHASH(H, A ‖ pad ‖ C ‖ pad ‖ len(A) ‖ len(C)); данные уже нарезаны по 16 байт.
  function ghash(H, blocks) {
    var y = new Uint8Array(16);
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      for (var i = 0; i < 16; i++) y[i] ^= block[i];
      y = gfMul(y, H);
    }
    return y;
  }

  function inc32(block) {
    for (var i = 15; i >= 12; i--) {
      block[i] = (block[i] + 1) & 0xff;
      if (block[i] !== 0) break;
    }
  }

  function ctr(rk, j0, input) {
    var out = new Uint8Array(input.length);
    var counter = new Uint8Array(j0);
    for (var off = 0; off < input.length; off += 16) {
      inc32(counter);
      var ks = encryptBlock(rk, counter);
      var n = Math.min(16, input.length - off);
      for (var i = 0; i < n; i++) out[off + i] = input[off + i] ^ ks[i];
    }
    return out;
  }

  function pushBlocks(list, src) {
    for (var off = 0; off < src.length; off += 16) list.push(src.subarray(off, off + 16));
  }

  function tagOf(rk, H, j0, aad, cipher) {
    var blocks = [];
    pushBlocks(blocks, pad16(aad));
    pushBlocks(blocks, pad16(cipher));
    var lens = new Uint8Array(16);
    lens.set(u64(aad.length * 8), 0);
    lens.set(u64(cipher.length * 8), 8);
    blocks.push(lens);
    var g = ghash(H, blocks);
    var e = encryptBlock(rk, j0);
    var tag = new Uint8Array(TAG_LEN);
    for (var i = 0; i < TAG_LEN; i++) tag[i] = g[i] ^ e[i];
    return tag;
  }

  function encrypt(key, iv, aad, plain) {
    var k = bytes(key);
    var ivb = bytes(iv);
    var a = bytes(aad);
    var p = bytes(plain);
    if (k.length !== KEY_LEN) throw new Error('AES-GCM: нужен ключ 32 байта');
    if (ivb.length !== IV_LEN) throw new Error('AES-GCM: нужен iv 12 байт');
    var rk = expandKey(k);
    var H = encryptBlock(rk, new Uint8Array(16));
    var j0 = new Uint8Array(16);
    j0.set(ivb);
    j0[15] = 1;
    var cipher = ctr(rk, j0, p);
    return { cipher: cipher, tag: tagOf(rk, H, j0, a, cipher) };
  }

  function decrypt(key, iv, aad, cipher, tag) {
    var k = bytes(key);
    var ivb = bytes(iv);
    var a = bytes(aad);
    var c = bytes(cipher);
    var t = bytes(tag);
    if (k.length !== KEY_LEN) throw new Error('AES-GCM: нужен ключ 32 байта');
    if (ivb.length !== IV_LEN) throw new Error('AES-GCM: нужен iv 12 байт');
    if (t.length !== TAG_LEN) return null;
    var rk = expandKey(k);
    var H = encryptBlock(rk, new Uint8Array(16));
    var j0 = new Uint8Array(16);
    j0.set(ivb);
    j0[15] = 1;
    var want = tagOf(rk, H, j0, a, c);
    var diff = 0;
    for (var i = 0; i < TAG_LEN; i++) diff |= want[i] ^ t[i];
    if (diff !== 0) return null;
    return ctr(rk, j0, c);
  }

  var api = {
    encrypt: encrypt,
    decrypt: decrypt,
    KEY_LEN: KEY_LEN,
    IV_LEN: IV_LEN,
    TAG_LEN: TAG_LEN
  };
  global.RemoteAesGcm = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
