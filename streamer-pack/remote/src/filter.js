'use strict';
// Снимок и лента для телефона: без оформления окна, без обложек своих файлов,
// лента — только последние 30 карточек. Разбор feedHtml строкой, без DOM.

const CARD_LIMIT = 30;
const FEED_MAX = 64 * 1024;

function httpsOnly(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : '';
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanNp(np) {
  if (!plainObject(np)) return null;
  const out = {};
  for (const k of ['title', 'artist', 'playing', 'pos', 'dur', 'at']) {
    if (np[k] !== undefined && np[k] !== null) out[k] = np[k];
  }
  if (typeof out.title !== 'string') out.title = '';
  if (typeof out.artist !== 'string') out.artist = '';
  out.playing = !!out.playing;
  out.pos = Number.isFinite(Number(out.pos)) ? Math.max(0, Number(out.pos)) : 0;
  out.dur = Number.isFinite(Number(out.dur)) ? Math.max(0, Number(out.dur)) : 0;
  return out;
}

function cleanItem(item) {
  if (!plainObject(item)) return null;
  const out = Object.assign({}, item);
  out.thumb = httpsOnly(item.thumb);
  return out;
}

function cleanAfter(item) {
  if (!plainObject(item)) return null;
  return {
    key: typeof item.key === 'string' ? item.key.slice(0, 300) : '',   // для «включить трек волны» (waveat)
    title: typeof item.title === 'string' ? item.title : '',
    artist: typeof item.artist === 'string' ? item.artist : '',
    thumb: httpsOnly(item.thumb)
  };
}

// Снимок пульта (docs/DOCK2.md) без look: телефон рисует своей разметкой,
// оформление окна ему не нужно. Обложки /lcover/… телефону не отдаются.
function snapForPhone(snap) {
  if (!plainObject(snap)) return null;
  const out = {};
  for (const k of ['v', 'at', 'mode', 'cur', 'wave', 'counts', 'opts', 'theme']) {
    if (snap[k] !== undefined && snap[k] !== null) out[k] = snap[k];
  }
  out.np = cleanNp(snap.np);
  out.items = Array.isArray(snap.items) ? snap.items.map(cleanItem).filter(Boolean) : [];
  out.after = Array.isArray(snap.after) ? snap.after.map(cleanAfter).filter(Boolean) : [];
  return out;
}

function classOf(tag) {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  if (!m) return '';
  return m[1] != null ? m[1] : (m[2] != null ? m[2] : (m[3] || ''));
}

function isRequestCard(cls) {
  return cls.split(/\s+/).indexOf('rq') >= 0;
}

// Вырезает верхнеуровневые <div class="rq"> … </div> из строки ленты.
// Вложенные div (rq-it, rq-h) считаются глубиной и не рвут карточку.
function topLevelCards(html) {
  if (typeof html !== 'string' || !html) return [];
  const cards = [];
  const tagRe = /<\/?div\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let depth = 0;
  let start = -1;
  let cls = '';
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const closing = tag[1] === '/';
    if (closing) {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          if (isRequestCard(cls)) cards.push(html.slice(start, tagRe.lastIndex));
          start = -1;
          cls = '';
        }
      }
      continue;
    }
    if (depth === 0) {
      start = m.index;
      cls = classOf(tag);
    }
    if (/\/\s*>$/.test(tag)) {
      if (depth === 0) { start = -1; cls = ''; }
      continue;
    }
    depth++;
  }
  return cards;
}

function lastCards(html, limit = CARD_LIMIT) {
  const cards = topLevelCards(html);
  return cards.slice(-Math.max(0, limit)).join('');
}

function feedForPhone(state) {
  const src = plainObject(state) ? state : {};
  let html = typeof src.feedHtml === 'string' ? src.feedHtml : '';
  if (html.length > FEED_MAX) html = html.slice(-FEED_MAX);   // защита от случайно огромного HTML
  const msgCount = Math.max(0, Math.trunc(Number(src.msgCount) || 0));
  return {
    feedHtml: lastCards(html),
    msgCount,
    reqAuto: !!src.reqAuto,
    np: cleanNp(src.np)
  };
}

// Подпись «ничего не поменялось»: без at и np.pos (время и позиция идут всегда).
function signature(value) {
  if (!plainObject(value)) return JSON.stringify(value == null ? null : value);
  const copy = Object.assign({}, value);
  copy.at = 0;
  if (plainObject(copy.np)) copy.np = Object.assign({}, copy.np, { pos: 0 });
  return JSON.stringify(copy);
}

module.exports = { CARD_LIMIT, topLevelCards, lastCards, snapForPhone, feedForPhone, signature, httpsOnly };
