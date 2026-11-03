'use strict';
// Что уходит странице оверлея: настройки + играющий трек + следующие песни.
// Снимок плеера приходит от ядра (core.player): { np, next, after }.
//   np    — { title, artist, cover, pos, dur, playing, at } или null (ничего не играет)
//   next  — следующие в очереди (заказы, свои треки), по порядку
//   after — что сыграет фон после очереди (волна или фоновый плейлист): для «добирать из волны»

const MAX_TEXT = 200;

function txt(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT); }
function num(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; }

// Обложку своего файла с компьютера страница сама не возьмёт (она только для окна Тапёра) —
// модуль отдаёт её по своему адресу. Чужие адреса — только https/http.
function coverFor(url) {
  const u = String(url || '');
  if (u.startsWith('/lcover/')) return '/overlay/cover?k=' + encodeURIComponent(u.slice(8, 80));
  if (/^https?:\/\//i.test(u)) return u.slice(0, 2000);
  return '';
}

function row(t) { return { title: txt(t && t.title), artist: txt(t && t.artist) }; }

function cleanSnap(s) {
  const snap = s && typeof s === 'object' ? s : {};
  const np = snap.np && typeof snap.np === 'object' && txt(snap.np.title) ? {
    title: txt(snap.np.title),
    artist: txt(snap.np.artist),
    cover: String(snap.np.cover || ''),
    pos: num(snap.np.pos),
    dur: num(snap.np.dur),
    playing: !!snap.np.playing,
    at: num(snap.np.at) || Date.now()
  } : null;
  const list = (a) => (Array.isArray(a) ? a : []).map(row).filter((r) => r.title).slice(0, 30);
  return { np, next: list(snap.next), after: list(snap.after) };
}

// Список «дальше»: сначала очередь, хвост — из фона, если так настроено. Не больше cfg.count.
function nextList(cfg, snap) {
  const out = snap.next.slice(0, cfg.count);
  if (cfg.fill && out.length < cfg.count) out.push(...snap.after.slice(0, cfg.count - out.length));
  return out;
}

function buildFeed(cfg, rawSnap) {
  const snap = cleanSnap(rawSnap);
  const np = snap.np ? { ...snap.np, cover: coverFor(snap.np.cover) } : null;
  return { cfg, np, next: nextList(cfg, snap) };
}

module.exports = { buildFeed, cleanSnap, nextList, coverFor };
