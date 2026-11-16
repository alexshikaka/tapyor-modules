/* Плейлист из снимка пульта (docs/DOCK2.md) для страницы телефона.
   Вся разметка создаётся через createElement, тексты — только textContent.
   Команды уходят через api.send({ c: … }) — их отбирает модуль на ПК. */
(function (global) {
  'use strict';

  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function setAttr(el, name, value) {
    if (value != null) el.setAttribute(name, String(value));
  }

  function isHttps(value) {
    return typeof value === 'string' && /^https:\/\//i.test(value);
  }

  function cover(item) {
    var idx = item && Number.isFinite(Number(item.i)) ? Math.abs(Number(item.i)) : 0;
    var box = make('span', 'cov ph g' + (idx % 7), '♪');
    if (item && isHttps(item.thumb)) {
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = item.thumb;
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      box.textContent = '';
      box.classList.remove('ph');
      box.appendChild(img);
    }
    return box;
  }

  function subtitle(item) {
    var parts = [];
    if (item.req && item.req.who) {
      var mark = item.req.kind === 'don' ? '₽ ' : item.req.kind === 'pts' ? 'баллы ' : item.req.kind === 'sb' ? 'Streamer.bot · ' : 'Twitch · ';
      parts.push(mark + item.req.who);
    }
    if (item.artist) parts.push(item.artist);
    if (item.srcName) parts.push(item.srcName);
    if (item.dur) parts.push(item.dur);
    return parts.join(' · ');
  }

  function actionButton(cls, text, label, onClick) {
    var b = make('button', 'ib ' + cls, text);
    b.type = 'button';
    setAttr(b, 'aria-label', label);
    setAttr(b, 'title', label);
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function separator(text) {
    return make('div', 'sep', text);
  }

  function modeRow(snap, send) {
    var row = make('div', 'mode');
    var live = snap.mode === 'live';
    var classic = make('span', live ? '' : 'on', 'Классический');
    var toggle = make('button', 'tgl' + (live ? ' on' : ''));
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Режим очереди');
    toggle.setAttribute('aria-pressed', live ? 'true' : 'false');
    toggle.addEventListener('click', function () {
      send({ c: 'mode', m: live ? 'classic' : 'live' });
    });
    var liveLabel = make('span', live ? 'on' : '', 'Живая очередь');
    var count = make('span', 'c', String((snap.counts && snap.counts.pending != null ? snap.counts.pending : snap.items ? snap.items.length : 0)));
    row.appendChild(classic);
    row.appendChild(toggle);
    row.appendChild(liveLabel);
    row.appendChild(count);
    return row;
  }

  function waveCard(snap, send) {
    var wave = snap.wave || {};
    var card = make('div', 'wave');
    var head = make('div', 'wave-h');
    var play = make('button', 'pb', '▶ Волна');
    play.type = 'button';
    play.addEventListener('click', function () { send({ c: 'wave', a: 'play' }); });
    var auto = make('button', 'tgl wave-auto' + (wave.auto ? ' on' : ''));
    auto.type = 'button';
    auto.setAttribute('aria-label', 'Волна сама ставит треки');
    auto.setAttribute('aria-pressed', wave.auto ? 'true' : 'false');
    auto.addEventListener('click', function () { send({ c: 'wave', a: 'auto' }); });
    head.appendChild(play);
    head.appendChild(make('span', 'wave-t', wave.title || 'Волна'));
    head.appendChild(auto);
    card.appendChild(head);
    if (wave.sub) card.appendChild(make('div', 'wave-s', wave.sub));
    return card;
  }

  function startDrag(ev, row, item, list, total, send) {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    var sx = ev.clientX;
    var sy = ev.clientY;
    var dragging = false;
    var timer = setTimeout(function () {
      dragging = true;
      row.classList.add('drag');
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* не обязательно */ } }
    }, 350);

    function cleanup() {
      clearTimeout(timer);
      row.classList.remove('drag');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    }
    function cancel() { cleanup(); }
    function move(e) {
      if (!dragging) {
        if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cleanup();
        return;
      }
      if (e.cancelable) e.preventDefault();
    }
    function up(e) {
      clearTimeout(timer);
      if (!dragging) { cleanup(); return; }
      if (e.cancelable) e.preventDefault();
      // Долгое нажатие без движения — не перестановка.
      if (Math.abs(e.clientX - sx) < 12 && Math.abs(e.clientY - sy) < 12) { cleanup(); return; }
      var rows = list.querySelectorAll('.q[data-i]');
      var to = total;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var rect = r.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          to = Number(r.getAttribute('data-i')) || 0;
          break;
        }
      }
      to = Math.max(0, Math.min(total, to));
      send({ c: 'move', i: item.i, key: item.key, to: to });
      cleanup();
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  function queueRow(item, snap, group, list, total, send) {
    var row = make('div', 'q');
    var st = item.st === 'playing' || item.i === snap.cur ? 'playing' : item.st === 'done' ? 'done' : item.st === 'pend' ? 'pend' : '';
    if (st === 'playing') row.classList.add('playing');
    if (st === 'done') row.classList.add('done');
    if (item.req && (item.req.kind === 'don' || item.req.kind === 'cmd' || item.req.kind === 'pts' || item.req.kind === 'sb')) row.classList.add(item.req.kind);
    if (item.bg) row.classList.add('bg');
    row.setAttribute('data-i', String(item.i));
    row.setAttribute('data-key', item.key || '');

    var grip = make('span', 'grip', '⋮⋮');
    grip.setAttribute('aria-label', 'Держи и тяни, чтобы переставить');
    grip.addEventListener('pointerdown', function (e) { startDrag(e, row, item, list, total, send); });
    row.appendChild(grip);

    var cov = cover(item);
    cov.addEventListener('click', function () { send({ c: 'play', i: item.i, key: item.key }); });
    row.appendChild(cov);

    var main = make('div', 'm');
    var title = make('div', 't', item.title || 'Без названия');
    if (group && group.length > 1) title.appendChild(make('span', 'bk', group.length + ' глав'));
    var sub = make('div', 's', subtitle(item));
    main.appendChild(title);
    main.appendChild(sub);
    main.addEventListener('click', function () { send({ c: 'play', i: item.i, key: item.key }); });
    row.appendChild(main);

    if (item.ban) {
      row.appendChild(actionButton('ban', '⛔', 'Убрать и закрыть заказы зрителю', function () {
        send({ c: 'ban', i: item.i, key: item.key });
      }));
    }
    if (item.canNext) {
      row.appendChild(actionButton('nx', '↑', 'Играть следующим', function () {
        send({ c: 'next', i: item.i, key: item.key });
      }));
    }
    row.appendChild(actionButton('rm', '✕', 'Убрать', function () {
      send({ c: 'remove', i: item.i, key: item.key });
    }));
    return row;
  }

  function afterRow(item) {
    var row = make('div', 'q after');
    row.appendChild(cover(item));
    var main = make('div', 'm');
    main.appendChild(make('div', 't', item.title || ''));
    var sub = make('div', 's', item.artist || '');
    main.appendChild(sub);
    row.appendChild(main);
    return row;
  }

  function render(host, snap, api) {
    if (!host) return;
    var send = api && typeof api.send === 'function' ? api.send : function () {};
    host.replaceChildren();
    if (!snap || !Array.isArray(snap.items)) {
      host.appendChild(make('div', 'dock-empty', 'Плейлист пока не пришёл'));
      return;
    }
    host.appendChild(modeRow(snap, send));
    if (snap.wave) host.appendChild(waveCard(snap, send));

    var list = make('div', 'qlist');
    list.id = 'dockList';
    var items = snap.items;
    var firstReq = -1;
    var lastReq = -1;
    for (var q = 0; q < items.length; q++) {
      if (!items[q].req) continue;
      if (firstReq < 0) firstReq = q;
      lastReq = q;
    }

    if (!items.length) list.appendChild(make('div', 'dock-empty', 'Плейлист пуст'));
    var i = 0;
    var afterShown = false;
    while (i < items.length) {
      if (i === firstReq) list.appendChild(separator('Заказы'));
      var it = items[i];
      var j = i;
      if (it.book) {
        while (j + 1 < items.length && items[j + 1].book && items[j + 1].book === it.book) j++;
      }
      var group = j > i ? items.slice(i, j + 1) : null;
      list.appendChild(queueRow(it, snap, group, list, items.length, send));
      if (!afterShown && lastReq >= 0 && j >= lastReq && j < items.length - 1) {
        list.appendChild(separator('Дальше в плейлисте'));
        afterShown = true;
      }
      i = j + 1;
    }

    if (snap.mode === 'live' && Array.isArray(snap.after) && snap.after.length) {
      list.appendChild(separator('Дальше в волне'));
      for (var a = 0; a < snap.after.length; a++) list.appendChild(afterRow(snap.after[a]));
    }
    host.appendChild(list);
  }

  var api = { render: render };
  global.RemoteDock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
