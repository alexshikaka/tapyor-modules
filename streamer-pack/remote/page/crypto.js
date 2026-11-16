/* Шифрование пульта на телефоне: WebCrypto, а без crypto.subtle (обычный http://) —
   AES-256-GCM из page/aes-gcm.js. Формат как в src/crypto.js:
   base64url(iv 12 ‖ флаг сжатия 1 ‖ шифртекст ‖ тег 16), aad = sid + '|' + вид.
   Флаг: 1 — deflate-raw (CompressionStream), 0 — без сжатия. Старые куски без флага читаются.
   Файл чистый (без DOM): тесты загружают его в Node и сверяют с серверной стороной. */
(function (global) {
  'use strict';

  var KEY_LEN = 32;
  var IV_LEN = 12;
  var TAG_LEN = 16;
  var FLAG_NONE = 0;
  var FLAG_DEFLATE = 1;

  function hasSubtle() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues);
  }

  function randomBytes(n) {
    var out = new Uint8Array(n);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(out);
      return out;
    }
    throw new Error('браузер не умеет случайные числа');
  }

  function b64u(bytes) {
    var arr = ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes || []);
    var bin = '';
    var CH = 0x8000;
    for (var i = 0; i < arr.length; i += CH) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, Math.min(arr.length, i + CH)));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unb64u(str) {
    if (typeof str !== 'string' || !str.length || str.length % 4 === 1) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(str)) return null;
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin;
    try { bin = atob(s); } catch (e) { return null; }
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    if (!out.length || b64u(out) !== str) return null;
    return out;
  }

  function keyBytes(key) {
    if (ArrayBuffer.isView(key)) {
      return key.byteLength === KEY_LEN ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength) : null;
    }
    if (Object.prototype.toString.call(key) === '[object ArrayBuffer]') {
      return key.byteLength === KEY_LEN ? new Uint8Array(key) : null;
    }
    if (typeof key === 'string') {
      var b = unb64u(key);
      if (b && b.length === KEY_LEN) return b;
      if (/^[0-9a-f]{64}$/i.test(key)) {
        var h = new Uint8Array(KEY_LEN);
        for (var i = 0; i < KEY_LEN; i++) h[i] = parseInt(key.slice(i * 2, i * 2 + 2), 16);
        return h;
      }
    }
    return null;
  }

  function newKey() {
    return randomBytes(KEY_LEN);
  }

  // Streams: CompressionStream/DecompressionStream есть в браузере и в Node 18+.
  function pipe(stream, bytes) {
    return new Promise(function (resolve, reject) {
      var writer = stream.writable.getWriter();
      writer.write(bytes).then(function () { return writer.close(); }).catch(reject);
      var reader = stream.readable.getReader();
      var chunks = [];
      var total = 0;
      (function pump() {
        reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(total);
            var at = 0;
            for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], at); at += chunks[i].length; }
            resolve(out);
            return;
          }
          chunks.push(r.value);
          total += r.value.length;
          if (total > 4 * 1024 * 1024) { try { reader.cancel(); } catch (e) { /* уже закрыт */ } reject(new Error('кусок слишком большой')); return; }
          pump();
        }).catch(reject);
      })();
    });
  }

  function hasCompress() {
    return typeof global.CompressionStream === 'function';
  }

  function hasDecompress() {
    return typeof global.DecompressionStream === 'function';
  }

  function deflateRaw(bytes) { return pipe(new global.CompressionStream('deflate-raw'), bytes); }
  function inflateRaw(bytes) { return pipe(new global.DecompressionStream('deflate-raw'), bytes); }

  function aad(sid, kind) {
    return new TextEncoder().encode(String(sid) + '|' + String(kind));
  }

  async function importKey(k) {
    return global.crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function seal(key, sid, kind, obj) {
    var k = keyBytes(key);
    if (!k) throw new Error('ключ сессии неверный');
    if (typeof sid !== 'string' || !sid) throw new Error('нет номера сессии');
    if (typeof kind !== 'string' || !kind) throw new Error('нет вида куска');
    var text = JSON.stringify(obj);
    if (typeof text !== 'string') throw new Error('кусок не превращается в JSON');

    var plain = new TextEncoder().encode(text);
    var flag = FLAG_NONE;
    if (hasCompress()) {
      plain = await deflateRaw(plain);
      flag = FLAG_DEFLATE;
    }
    var iv = randomBytes(IV_LEN);
    var extra = aad(sid, kind);
    var enc;
    if (hasSubtle()) {
      var ck = await importKey(k);
      enc = new Uint8Array(await global.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv, additionalData: extra, tagLength: 128 }, ck, plain
      ));
    } else {
      var A = global.RemoteAesGcm;
      if (!A) throw new Error('нет AES-GCM');
      var r = A.encrypt(k, iv, extra, plain);
      enc = new Uint8Array(r.cipher.length + r.tag.length);
      enc.set(r.cipher, 0);
      enc.set(r.tag, r.cipher.length);
    }
    var out = new Uint8Array(IV_LEN + 1 + enc.length);
    out.set(iv, 0);
    out[IV_LEN] = flag;
    out.set(enc, IV_LEN + 1);
    return b64u(out);
  }

  async function decryptAt(k, sid, kind, raw, offset, flag) {
    var iv = raw.subarray(0, IV_LEN);
    var body = raw.subarray(offset);
    if (body.length < TAG_LEN) return null;
    var extra = aad(sid, kind);
    var plain;
    if (hasSubtle()) {
      try {
        var ck = await importKey(k);
        plain = new Uint8Array(await global.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv, additionalData: extra, tagLength: 128 }, ck, body
        ));
      } catch (e) {
        return null;
      }
    } else {
      var A = global.RemoteAesGcm;
      if (!A) return null;
      plain = A.decrypt(k, iv, extra, body.subarray(0, body.length - TAG_LEN), body.subarray(body.length - TAG_LEN));
      if (!plain) return null;
    }
    if (flag === FLAG_DEFLATE) {
      if (!hasDecompress()) return null;
      try { plain = await inflateRaw(plain); } catch (e) { return null; }
    }
    try { return JSON.parse(new TextDecoder().decode(plain)); } catch (e) { return null; }
  }

  async function open(key, sid, kind, piece) {
    try {
      var k = keyBytes(key);
      if (!k || typeof sid !== 'string' || !sid || typeof kind !== 'string' || !kind) return null;
      var raw = unb64u(piece);
      if (!raw || raw.length < IV_LEN + TAG_LEN) return null;

      // Новый формат: iv ‖ флаг ‖ шифртекст ‖ тег.
      if (raw.length >= IV_LEN + 1 + TAG_LEN) {
        var flag = raw[IV_LEN];
        if (flag === FLAG_NONE || flag === FLAG_DEFLATE) {
          var got = await decryptAt(k, sid, kind, raw, IV_LEN + 1, flag);
          if (got !== null) return got;
        }
      }

      // Старый формат (RM2): iv ‖ шифртекст ‖ тег, всегда deflate-raw.
      return await decryptAt(k, sid, kind, raw, IV_LEN, FLAG_DEFLATE);
    } catch (e) {
      return null;
    }
  }

  var api = {
    newKey: newKey,
    b64u: b64u,
    unb64u: unb64u,
    keyBytes: keyBytes,
    seal: seal,
    open: open,
    hasSubtle: hasSubtle,
    KEY_LEN: KEY_LEN,
    IV_LEN: IV_LEN,
    TAG_LEN: TAG_LEN,
    FLAG_NONE: FLAG_NONE,
    FLAG_DEFLATE: FLAG_DEFLATE
  };
  global.RemoteCrypto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
