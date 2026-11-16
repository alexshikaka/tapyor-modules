'use strict';
// Шифрование куска пульта: JSON → deflate-raw → AES-256-GCM.
// Формат куска (docs/REMOTE.md, «Безопасность»):
//   base64url(iv 12 байт ‖ флаг 1 байт ‖ шифртекст ‖ тег 16 байт), aad = sid + '|' + вид.
// Флаг: 1 — сжато deflate-raw, 0 — без сжатия. Старый формат (без флага) читается.
// Виды: s — снимок, f — лента, e — событие, c — команда.
// Тот же формат собран в page/crypto.js (WebCrypto или AES-GCM на чистом JS) — совместимость проверяют тесты.

const nodeCrypto = require('node:crypto');
const zlib = require('node:zlib');

const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const FLAG_NONE = 0;
const FLAG_DEFLATE = 1;
const MAX_TEXT = 4 * 1024 * 1024;   // распакованный кусок больше не бывает: снимок ≤ 64 КБ в сжатом виде

function newKey() {
  return nodeCrypto.randomBytes(KEY_LEN);
}

// base64url без выравнивания. Обратная функция строгая: мусор и неканоническая запись — null.
function b64u(buf) {
  return Buffer.from(buf).toString('base64url');
}

function unb64u(str) {
  if (typeof str !== 'string' || !str.length || str.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(str)) return null;
  let buf;
  try { buf = Buffer.from(str, 'base64url'); } catch (e) { return null; }
  if (!buf.length || b64u(buf) !== str) return null;
  return buf;
}

// Ключ можно передать байтами или строкой base64url (так он стоит в адресе телефона).
function keyBytes(key) {
  if (Buffer.isBuffer(key)) return key.length === KEY_LEN ? key : null;
  if (key instanceof ArrayBuffer) return key.byteLength === KEY_LEN ? Buffer.from(key) : null;
  if (ArrayBuffer.isView(key)) {
    return key.byteLength === KEY_LEN ? Buffer.from(key.buffer, key.byteOffset, key.byteLength) : null;
  }
  if (typeof key === 'string') {
    const b = unb64u(key);
    if (b && b.length === KEY_LEN) return b;
    if (/^[0-9a-f]{64}$/i.test(key)) return Buffer.from(key, 'hex');
  }
  return null;
}

function aad(sid, kind) {
  return Buffer.from(String(sid) + '|' + String(kind), 'utf8');
}

function seal(key, sid, kind, obj) {
  const k = keyBytes(key);
  if (!k) throw new Error('ключ сессии неверный');
  if (typeof sid !== 'string' || !sid) throw new Error('нет номера сессии');
  if (typeof kind !== 'string' || !kind) throw new Error('нет вида куска');
  const text = JSON.stringify(obj);
  if (typeof text !== 'string') throw new Error('кусок не превращается в JSON');
  const plain = zlib.deflateRawSync(Buffer.from(text, 'utf8'), { level: 9 });
  if (plain.length > MAX_TEXT) throw new Error('кусок слишком большой');
  const iv = nodeCrypto.randomBytes(IV_LEN);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', k, iv);
  cipher.setAAD(aad(sid, kind));
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const flag = Buffer.from([FLAG_DEFLATE]);
  return b64u(Buffer.concat([iv, flag, enc]));
}

function openRaw(k, sid, kind, iv, body) {
  try {
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAAD(aad(sid, kind));
    decipher.setAuthTag(body.subarray(body.length - TAG_LEN));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_LEN)), decipher.final()]);
  } catch (e) {
    return null;
  }
}

function finish(plain, flag) {
  try {
    const bytes = flag === FLAG_DEFLATE ? zlib.inflateRawSync(plain, { maxOutputLength: MAX_TEXT }) : plain;
    return JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    return null;
  }
}

function open(key, sid, kind, piece) {
  const k = keyBytes(key);
  if (!k) return null;
  if (typeof sid !== 'string' || !sid) return null;
  if (typeof kind !== 'string' || !kind) return null;
  const raw = unb64u(piece);
  if (!raw || raw.length < IV_LEN + TAG_LEN) return null;
  const iv = raw.subarray(0, IV_LEN);

  // Новый формат: iv ‖ флаг ‖ шифртекст ‖ тег. Если не сошлось — возможно, кусок старый.
  if (raw.length >= IV_LEN + 1 + TAG_LEN) {
    const flag = raw[IV_LEN];
    if (flag === FLAG_NONE || flag === FLAG_DEFLATE) {
      const plain = openRaw(k, sid, kind, iv, raw.subarray(IV_LEN + 1));
      if (plain) {
        const out = finish(plain, flag);
        if (out !== null) return out;
      }
    }
  }

  // Старый формат (RM2): iv ‖ шифртекст ‖ тег, всегда deflate-raw.
  const old = openRaw(k, sid, kind, iv, raw.subarray(IV_LEN));
  return old ? finish(old, FLAG_DEFLATE) : null;
}

module.exports = {
  newKey, b64u, unb64u, keyBytes, seal, open,
  KEY_LEN, IV_LEN, TAG_LEN, FLAG_NONE, FLAG_DEFLATE
};
