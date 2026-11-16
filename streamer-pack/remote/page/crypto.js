/* Шифрование пульта на телефоне: WebCrypto + CompressionStream, формат как в src/crypto.js.
   Кусок: base64url(iv 12 ‖ шифртекст ‖ тег 16), aad = sid + '|' + вид.
   Файл чистый (без DOM): тесты загружают его в Node и сверяют с серверной стороной. */
(function (global) {
  'use strict';

  var KEY_LEN = 32;
  var IV_LEN = 12;

  function webCrypto() {
    if (global.crypto && global.crypto.subtle && global.crypto.getRandomValues) return global.crypto;
    throw new Error('браузер не умеет WebCrypto');
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
    if (key instanceof ArrayBuffer) return key.byteLength === KEY_LEN ? new Uint8Array(key) : null;
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
    var k = new Uint8Array(KEY_LEN);
    webCrypto().getRandomValues(k);
    return k;
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

  function deflateRaw(bytes) { return pipe(new global.CompressionStream('deflate-raw'), bytes); }
  function inflateRaw(bytes) { return pipe(new global.DecompressionStream('deflate-raw'), bytes); }

  function aad(sid, kind) {
    return new TextEncoder().encode(String(sid) + '|' + String(kind));
  }

  async function importKey(k) {
    return webCrypto().subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function seal(key, sid, kind, obj) {
    var k = keyBytes(key);
    if (!k) throw new Error('ключ сессии неверный');
    if (typeof sid !== 'string' || !sid) throw new Error('нет номера сессии');
    if (typeof kind !== 'string' || !kind) throw new Error('нет вида куска');
    var text = JSON.stringify(obj);
    if (typeof text !== 'string') throw new Error('кусок не превращается в JSON');
    var plain = await deflateRaw(new TextEncoder().encode(text));
    var iv = new Uint8Array(IV_LEN);
    webCrypto().getRandomValues(iv);
    var ck = await importKey(k);
    var enc = new Uint8Array(await webCrypto().subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: aad(sid, kind), tagLength: 128 }, ck, plain
    ));
    var out = new Uint8Array(IV_LEN + enc.length);
    out.set(iv, 0);
    out.set(enc, IV_LEN);
    return b64u(out);
  }

  async function open(key, sid, kind, piece) {
    try {
      var k = keyBytes(key);
      if (!k || typeof sid !== 'string' || !sid || typeof kind !== 'string' || !kind) return null;
      var raw = unb64u(piece);
      if (!raw || raw.length < IV_LEN + 16) return null;
      var iv = raw.subarray(0, IV_LEN);
      var body = raw.subarray(IV_LEN);
      var ck = await importKey(k);
      var plain = new Uint8Array(await webCrypto().subtle.decrypt(
        { name: 'AES-GCM', iv: iv, additionalData: aad(sid, kind), tagLength: 128 }, ck, body
      ));
      var text = new TextDecoder().decode(await inflateRaw(plain));
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  var api = { newKey: newKey, b64u: b64u, unb64u: unb64u, keyBytes: keyBytes, seal: seal, open: open, KEY_LEN: KEY_LEN, IV_LEN: IV_LEN };
  global.RemoteCrypto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
