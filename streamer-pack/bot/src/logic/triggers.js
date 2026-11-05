'use strict';
// Распознавание заказа в сообщении чата.
// Триггер — команда с «!» (!play) или слово без «!» (поставь). Список задаёт стример.
// Слово без «!» срабатывает только в начале сообщения и только если после него есть текст.

const DEFAULT_TRIGGERS = ['!play'];

// Служебные команды бота — триггер заказа не может совпадать с ними.
const RESERVED = ['!отмена', '!песня', '!место', '!событие', '!srpause', '!srон', '!cancel', '!skip'];

function norm(s) { return String(s || '').trim().toLowerCase().replace(/ё/g, 'е'); }

function isCommand(t) { return norm(t).startsWith('!'); }

// Проверка списка триггеров при вводе в настройках. Возвращает список ошибок (пустой — всё хорошо).
function validateTriggers(list, reserved = RESERVED) {
  const errors = [];
  const seen = new Set();
  const res = new Set(reserved.map(norm));
  for (const raw of list || []) {
    const t = norm(raw);
    if (!t || t === '!') { errors.push({ trigger: raw, why: 'empty' }); continue; }
    if (/\s/.test(t)) { errors.push({ trigger: raw, why: 'space' }); continue; }
    if (seen.has(t)) { errors.push({ trigger: raw, why: 'duplicate' }); continue; }
    if (res.has(t)) { errors.push({ trigger: raw, why: 'reserved' }); continue; }
    seen.add(t);
  }
  return errors;
}

// Разбор сообщения. Возвращает { trigger, kind: 'cmd'|'word', query } или null.
// Самый длинный триггер выигрывает (!play раньше !p).
function parse(text, triggers = DEFAULT_TRIGGERS) {
  const msg = String(text || '').trim();
  if (!msg) return null;
  const low = norm(msg);
  const list = [...new Set((triggers || []).map(norm).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const t of list) {
    if (!low.startsWith(t)) continue;
    const rest = msg.slice(t.length);
    // После триггера — конец сообщения или пробел; иначе это другое слово (!playlist, поставьте).
    if (rest && !/^\s/.test(rest)) continue;
    const query = rest.trim();
    const kind = isCommand(t) ? 'cmd' : 'word';
    if (kind === 'word' && !query) return null; // «поставь» без продолжения — не заказ
    return { trigger: t, kind, query };
  }
  return null;
}

// Ответ на вопрос «1) или 2)»: «1», «2», «!play 1». Возвращает номер варианта (1..max) или null.
function parseChoice(text, triggers = DEFAULT_TRIGGERS, max = 3) {
  const msg = String(text || '').trim();
  let m = /^(\d)$/.exec(msg);
  if (!m) {
    const p = parse(msg, triggers.filter(isCommand));
    if (p && /^\d$/.test(p.query)) m = [p.query, p.query];
  }
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n : null;
}

module.exports = { DEFAULT_TRIGGERS, RESERVED, parse, parseChoice, validateTriggers, norm };
