/* Плейлист из снимка пульта (docs/DOCK2.md) для страницы телефона.
   Очередь — как в окне Тапёра: строки подряд, без разделов, без режима и волны (решение владельца 16.11).
   Перестановка: долгое нажатие на строку → строка «поднимается» и едет за пальцем, остальные плавно
   расступаются; отпустил — строка встаёт на место, команда move уходит в Тапёр. Нажатия отзываются сразу
   (строка убирается / встаёт на место до ответа ПК), снимок с ПК потом подтверждает.
   Вся разметка — createElement, тексты — только textContent. Команды — api.send({ c: … }). */
(function (global) {
  'use strict';

  var HOLD_MS = 280;          // столько держать палец, чтобы строка поднялась
  var SLOP = 8;               // сдвиг пальца до подъёма — это прокрутка, а не перетаскивание
  var EDGE = 56;              // у края списка — автопрокрутка во время перетаскивания

  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function isHttps(value) { return typeof value === 'string' && /^https:\/\//i.test(value); }

  // Обложки прошлой отрисовки по адресу: новую строку собираем с ТОЙ ЖЕ картинкой, а не загружаем
  // заново — иначе при каждом снимке с ПК обложки мигали заглушкой и список «дёргался» (16.11).
  var IMGS = new Map();
  function cover(item) {
    var idx = item && Number.isFinite(Number(item.i)) ? Math.abs(Number(item.i)) : 0;
    var box = make('span', 'cov ph g' + (idx % 7), '♪');
    var old = item && isHttps(item.thumb) ? IMGS.get(item.thumb) : null;
    if (old && old.length) {
      box.textContent = '';
      box.classList.remove('ph');
      box.appendChild(old.shift());
      return box;
    }
    if (item && isHttps(item.thumb)) {
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.draggable = false;
      img.src = item.thumb;
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      box.textContent = '';
      box.classList.remove('ph');
      box.appendChild(img);
    }
    return box;
  }

  // Подпись — как в очереди окна: исполнитель · площадка · кто заказал
  function subtitle(item) {
    var parts = [];
    if (item.artist) parts.push(item.artist);
    if (item.srcName) parts.push(item.srcName);
    if (item.bg) parts.push('фон');
    if (item.req && item.req.who) {
      var mark = item.req.sb ? 'Streamer.bot ' : item.req.kind === 'cmd' ? 'Twitch ' : item.req.kind === 'pts' ? 'баллы ' : '₽ ';
      parts.push(mark + item.req.who);
    }
    return parts.join(' · ');
  }

  function actionButton(cls, text, label, onClick) {
    var b = make('button', 'ib ' + cls, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  // ── Состояние между отрисовками ──────────────────────────────────────────
  var S = { drag: null, pending: null, host: null, api: null, touchGuard: false };

  // Пока строка поднята, страница не должна прокручиваться пальцем (иначе браузер отберёт касание).
  function ensureTouchGuard() {
    if (S.touchGuard) return;
    S.touchGuard = true;
    document.addEventListener('touchmove', function (e) {
      if (S.drag && S.drag.lifted && e.cancelable) e.preventDefault();
    }, { passive: false });
  }

  // Кто прокручивает список: сам элемент или ближайший предок с прокруткой.
  // (16.11: раньше начинали с родителя и не замечали, что прокручивается сам #dockHost —
  // после каждого снимка с ПК список прыгал в начало.)
  function scroller(el) {
    var p = el;
    while (p && p !== document.body) {
      var oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll') return p;
      p = p.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function vibrate(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* не обязательно */ } } }

  // Плавно перенести строки на новые места: FLIP (запомнили — переставили — анимировали из старого места)
  function flip(list, mutate) {
    var rows = Array.prototype.slice.call(list.querySelectorAll('.q'));
    var before = new Map();
    rows.forEach(function (r) { before.set(r, r.getBoundingClientRect().top); });
    mutate();
    rows.forEach(function (r) {
      if (!r.isConnected) return;
      var dy = before.get(r) - r.getBoundingClientRect().top;
      if (!dy) return;
      r.style.transition = 'none';
      r.style.transform = 'translateY(' + dy + 'px)';
      void r.offsetHeight;
      r.style.transition = '';
      r.style.transform = '';
    });
  }

  function startPress(ev, row, item, list, send) {
    if (S.drag) return;
    if (ev.button != null && ev.button !== 0) return;
    if (ev.target.closest('button')) return;
    ensureTouchGuard();
    var d = S.drag = {
      row: row, item: item, list: list, send: send, id: ev.pointerId,
      sx: ev.clientX, sy: ev.clientY, y: ev.clientY, lifted: false, timer: 0, raf: 0,
      rows: null, mids: null, from: -1, to: -1, h: 0, scroll: scroller(list), scroll0: 0
    };
    d.timer = setTimeout(function () { lift(d); }, HOLD_MS);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function lift(d) {
    if (S.drag !== d) return;
    d.lifted = true;
    d.rows = Array.prototype.slice.call(d.list.querySelectorAll('.q[data-i]'));
    d.from = d.rows.indexOf(d.row);
    d.to = d.from;
    var r = d.row.getBoundingClientRect();
    d.h = r.height + (parseFloat(getComputedStyle(d.list).rowGap) || 0);
    d.scroll0 = d.scroll.scrollTop;
    d.mids = d.rows.map(function (x) { var b = x.getBoundingClientRect(); return b.top + b.height / 2 + d.scroll0; });
    d.list.classList.add('dragging');
    d.row.classList.add('lift');
    vibrate(12);
    tick(d);
  }

  function place(d) {
    var dy = d.y - d.sy + (d.scroll.scrollTop - d.scroll0);
    d.row.style.transform = 'translateY(' + dy + 'px) scale(1.03)';
    // куда встанет: середина поднятой строки относительно середин остальных
    var mid = d.mids[d.from] + dy;
    var to = d.from;
    for (var k = 0; k < d.rows.length; k++) {
      if (k < d.from && mid < d.mids[k]) { to = k; break; }
    }
    for (var m = d.rows.length - 1; m > d.from; m--) {
      if (mid > d.mids[m]) { to = m; break; }
    }
    if (to !== d.to) { d.to = to; vibrate(4); }
    for (var i = 0; i < d.rows.length; i++) {
      if (i === d.from) continue;
      var shift = 0;
      if (d.from < d.to && i > d.from && i <= d.to) shift = -d.h;
      if (d.from > d.to && i >= d.to && i < d.from) shift = d.h;
      d.rows[i].style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    }
  }

  // Автопрокрутка у краёв + перерисовка позиции раз в кадр
  function tick(d) {
    if (S.drag !== d || !d.lifted) return;
    var box = d.scroll === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : d.scroll.getBoundingClientRect();
    var v = 0;
    if (d.y < box.top + EDGE) v = -Math.ceil((box.top + EDGE - d.y) / 6);
    else if (d.y > box.bottom - EDGE) v = Math.ceil((d.y - (box.bottom - EDGE)) / 6);
    if (v) d.scroll.scrollTop += v;
    place(d);
    d.raf = requestAnimationFrame(function () { tick(d); });
  }

  function onMove(e) {
    var d = S.drag; if (!d || e.pointerId !== d.id) return;
    d.y = e.clientY;
    if (!d.lifted) {
      if (Math.abs(e.clientX - d.sx) > SLOP || Math.abs(e.clientY - d.sy) > SLOP) finish(false);
      return;
    }
    if (e.cancelable) e.preventDefault();
  }

  function onUp(e) { var d = S.drag; if (!d || e.pointerId !== d.id) return; finish(true); }
  function onCancel() { finish(false); }

  function finish(drop) {
    var d = S.drag; if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    S.drag = null;
    if (!d.lifted) { flushPending(); return; }
    var moved = drop && d.to !== d.from;
    // Переставляем строку в списке сразу (FLIP — без рывка), снимаем «подъём»
    flip(d.list, function () {
      d.rows.forEach(function (x) { x.style.transition = 'none'; x.style.transform = ''; });
      d.row.classList.remove('lift');
      d.list.classList.remove('dragging');
      if (moved) {
        var ref = d.to > d.from ? d.rows[d.to].nextSibling : d.rows[d.to];
        d.list.insertBefore(d.row, ref);
      }
    });
    d.rows.forEach(function (x) { void x.offsetHeight; x.style.transition = ''; });
    d.row.classList.add('settle');
    setTimeout(function () { d.row.classList.remove('settle'); }, 260);
    if (moved) {
      // moveItem(from, to) в окне: to — место вставки до удаления строки
      var fromI = Number(d.item.i);
      var target = d.rows[d.to];
      var targetI = Number(target.getAttribute('data-i'));
      var targetLen = Number(target.getAttribute('data-len')) || 1;
      var to = d.to > d.from ? targetI + targetLen : targetI;
      d.send({ c: 'move', i: fromI, key: d.item.key, to: to });
    }
    // свежий снимок, пришедший во время перетаскивания, — после того, как строка встала
    setTimeout(flushPending, moved ? 280 : 0);
  }

  function flushPending() {
    if (S.drag || !S.pending) return;
    var p = S.pending; S.pending = null;
    draw(p.host, p.snap, p.api);
  }

  function queueRow(item, snap, group, list, send) {
    var row = make('div', 'q');
    var st = item.st === 'playing' || item.i === snap.cur ? 'playing' : item.st;
    if (st === 'playing') row.classList.add('playing');
    if (st === 'done') row.classList.add('done');
    if (item.req && /^(don|cmd|pts|sb)$/.test(item.req.kind)) row.classList.add(item.req.kind);
    if (item.bg) row.classList.add('bg');
    row.setAttribute('data-i', String(item.i));
    row.setAttribute('data-key', item.key || '');
    row.setAttribute('data-len', String(group ? group.length : 1));
    row.addEventListener('pointerdown', function (e) { startPress(e, row, item, list, send); });
    row.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    var cov = cover(item);
    row.appendChild(cov);

    var main = make('div', 'm');
    var title = make('div', 't', item.title || 'Без названия');
    if (group && group.length > 1) title.appendChild(make('span', 'bk', group.length + ' глав'));
    main.appendChild(title);
    main.appendChild(make('div', 's', subtitle(item)));
    row.appendChild(main);

    function play() {
      if (row.classList.contains('playing')) return;
      var was = list.querySelector('.q.playing'); if (was) was.classList.remove('playing');
      row.classList.add('playing');
      send({ c: 'play', i: item.i, key: item.key });
    }
    cov.addEventListener('click', play);
    main.addEventListener('click', play);

    if (item.canNext) row.appendChild(actionButton('nx', '↑', 'Играть следующим', function () { send({ c: 'next', i: item.i, key: item.key }); }));
    if (item.ban) row.appendChild(actionButton('ban', '⛔', 'Убрать и закрыть заказы зрителю', function () { gone(row, list); send({ c: 'ban', i: item.i, key: item.key }); }));
    row.appendChild(actionButton('rm', '✕', 'Убрать', function () { gone(row, list); send({ c: 'remove', i: item.i, key: item.key }); }));
    if (item.dur) row.appendChild(make('span', 'qtime', item.dur));
    return row;
  }

  // «Убрать» отзывается сразу: строка схлопывается, остальные подтягиваются
  function gone(row, list) {
    row.style.height = row.offsetHeight + 'px';
    void row.offsetHeight;
    row.classList.add('gone');
    setTimeout(function () { flip(list, function () { if (row.parentNode) row.parentNode.removeChild(row); }); }, 180);
  }

  function afterRow(item, j, list, send) {
    var row = make('div', 'q after');
    row.setAttribute('role', 'button');
    row.title = 'Включить';
    row.addEventListener('click', function () {
      if (!item || typeof item.key !== 'string') return;
      gone(row, list);
      send({ c: 'waveat', j: j, key: item.key });
    });
    row.appendChild(cover(item));
    var main = make('div', 'm');
    main.appendChild(make('div', 't', item.title || ''));
    main.appendChild(make('div', 's', item.artist || ''));
    row.appendChild(main);
    return row;
  }

  function draw(host, snap, api) {
    var send = api && typeof api.send === 'function' ? api.send : function () {};
    var sc = scroller(host);
    var keepScroll = sc.scrollTop;
    // где стояла каждая строка (по ключу трека) — чтобы переезд показать движением, а не скачком
    var was = new Map();
    Array.prototype.forEach.call(host.querySelectorAll('.q[data-key]'), function (r) {
      var k = r.getAttribute('data-key'); if (k && !was.has(k)) was.set(k, r.getBoundingClientRect().top);
    });
    IMGS = new Map();
    Array.prototype.forEach.call(host.querySelectorAll('.cov img'), function (im) {
      var u = im.getAttribute('src');
      if (!u || !im.complete || !im.naturalWidth) return;
      if (!IMGS.has(u)) IMGS.set(u, []);
      IMGS.get(u).push(im);
    });
    host.replaceChildren();
    if (!snap || !Array.isArray(snap.items)) {
      host.appendChild(make('div', 'dock-empty', 'Плейлист пока не пришёл'));
      return;
    }
    var list = make('div', 'qlist');
    list.id = 'dockList';
    var items = snap.items;
    if (!items.length) list.appendChild(make('div', 'dock-empty', 'Плейлист пуст'));
    var i = 0;
    while (i < items.length) {
      var it = items[i];
      var j = i;
      if (it.book) while (j + 1 < items.length && items[j + 1].book && items[j + 1].book === it.book) j++;
      list.appendChild(queueRow(it, snap, j > i ? items.slice(i, j + 1) : null, list, send));
      i = j + 1;
    }
    // «Дальше в волне» — продолжение той же очереди, как в окне (одна прокрутка)
    if (snap.mode === 'live' && Array.isArray(snap.after) && snap.after.length) {
      list.appendChild(make('div', 'qn-h', 'Дальше в волне · ' + snap.after.length));
      for (var a = 0; a < snap.after.length; a++) list.appendChild(afterRow(snap.after[a], a, list, send));
    }
    host.appendChild(list);
    sc.scrollTop = keepScroll;
    if (!was.size) return;
    Array.prototype.forEach.call(list.querySelectorAll('.q[data-key]'), function (r) {
      var top0 = was.get(r.getAttribute('data-key'));
      if (top0 == null) { r.classList.add('enter'); return; }
      var dy = top0 - r.getBoundingClientRect().top;
      if (Math.abs(dy) < 2) return;
      r.style.transition = 'none';
      r.style.transform = 'translateY(' + dy + 'px)';
      void r.offsetHeight;
      r.style.transition = 'transform .3s cubic-bezier(.2, .8, .2, 1)';
      r.style.transform = '';
      setTimeout(function () { r.style.transition = ''; }, 320);
    });
  }

  function render(host, snap, api) {
    if (!host) return;
    // Пока строка поднята, список не перерисовываем — иначе она «выпадет» из пальца
    if (S.drag) { S.pending = { host: host, snap: snap, api: api }; return; }
    draw(host, snap, api);
  }

  var api = { render: render, _state: S };
  global.RemoteDock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
