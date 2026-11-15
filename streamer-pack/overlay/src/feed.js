'use strict';
// Что уходит странице оверлея: настройки + играющий трек + следующие песни.
// Снимок плеера приходит от ядра (core.player): { np, next, after }.
//   np    — { title, artist, who, cover, pos, dur, playing, at } или null (ничего не играет)
//   next  — следующие в очереди (заказы, свои треки), по порядку, у строк может быть who
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

function row(t) {
  const r = { title: txt(t && t.title), artist: txt(t && t.artist) };
  const who = txt(t && t.who);
  if (who) r.who = who;
  return r;
}

function cleanSnap(s) {
  const snap = s && typeof s === 'object' ? s : {};
  const np = snap.np && typeof snap.np === 'object' && txt(snap.np.title) ? {
    title: txt(snap.np.title),
    artist: txt(snap.np.artist),
    who: txt(snap.np.who),
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

// Ничего не играет — вместо заглушки «ТИШИНА» оверлей показывает целиком «трек тишины» (решения владельца 15.11):
// выглядит как играющий — время идёт 0:00…4:33 по кругу, визуализатор работает в демо-режиме (страница без звука
// рисует имитацию), очередь — шуточные треки, если настоящей очереди нет.
// silence: true — для страницы: это не настоящий трек (моушн не считает его сменой трека для OBS).
const SILENCE_DUR = 273;
const SILENCE_NEXT = [
  ['Ещё один трек', 'Ещё один исполнитель'],
  ['Какой-то трек', 'Какой-то исполнитель'],
  ['Печальный трек', 'Печальный исполнитель'],
  ['Подозрительно весёлый трек', 'Подозрительно весёлый исполнитель'],
  ['Трек, который никто не заказывал', 'Никто'],
  ['Ещё один трек (ремикс)', 'Ещё один исполнитель feat. Ещё один'],
  ['Трек для фона', 'Фоновый ансамбль'],
  ['Почти хит', 'Почти знаменитый исполнитель'],
  ['Трек без названия', 'Исполнитель без имени'],
  ['Последний трек', 'Наконец-то исполнитель']
].map(([title, artist]) => ({ title, artist }));
let silenceSince = 0;   // когда началась тишина: время «трека» идёт от этой точки и не сбрасывается при каждом снимке

function silenceNp(now = Date.now()) {
  if (!silenceSince) silenceSince = now;
  const pos = ((now - silenceSince) / 1000) % SILENCE_DUR;
  return { title: 'Пьеса 4′33″', artist: 'Джон Кейдж', who: '', cover: '', pos, dur: SILENCE_DUR, playing: true, at: now, silence: true };
}

function buildFeed(cfg, rawSnap) {
  const snap = cleanSnap(rawSnap);
  if (snap.np) {
    silenceSince = 0;
    return { cfg, np: { ...snap.np, cover: coverFor(snap.np.cover) }, next: nextList(cfg, snap) };
  }
  const quiet = snap.next.length ? snap : { ...snap, next: SILENCE_NEXT, after: [] };
  return { cfg, np: silenceNp(), next: nextList(cfg, quiet) };
}

module.exports = { buildFeed, cleanSnap, nextList, coverFor, silenceNp, SILENCE_NEXT };
