/* Страница пульта с телефона: ключ из адреса (#sid.ключ), опрос облака,
   расшифровка снимка и ленты, команды обратно. Тексты снимка — только textContent;
   лента вставляется после вырезания script, on*, javascript: (CSP тоже не даст им сработать). */
(function () {
  'use strict';

  var cfg = window.REMOTE_CONFIG && typeof window.REMOTE_CONFIG === 'object' ? window.REMOTE_CONFIG : {};
  var RELAYS = relayList(cfg);
  var C = window.RemoteCrypto;
  var D = window.RemoteDock;
  var P = window.RemotePoll;
  var E = window.RemoteExtras;
  var ENDED = 'Пульт отключён в Тапёре. Отсканируй новый QR-код';
  var ENDED_SAVED = 'Отсканируй новый QR-код в Тапёре';
  var LOST = 'Нет связи с Тапёром';
  var LOST_MS = 10000;
  var PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l12 7-12 7z"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    dot: $('dot'), phoneAgo: $('phoneAgo'), search: $('search'),
    tabDock: $('tabDock'), tabFeed: $('tabFeed'), tabCount: $('tabCount'),
    banner: $('banner'), results: $('results'),
    panelDock: $('panelDock'), panelFeed: $('panelFeed'),
    dockHost: $('dockHost'), feed: $('feed'), flt: $('flt'), feedHead: $('feedHead'),
    prev: $('prev'), playpause: $('playpause'), next: $('next'),
    npTitle: $('npTitle'), npArtist: $('npArtist'), bar: $('bar'), time: $('time')
  };

  var parsed = parseHash(location.hash);
  var fromSaved = false;
  // Без # (страница открыта со значка) берём последнюю сессию этого телефона.
  // Новый # в адресе всегда важнее сохранённого.
  if (!parsed && /^#?$/.test(String(location.hash || '')) && E && typeof E.readSaved === 'function') {
    parsed = E.readSaved();
    fromSaved = !!parsed;
  }
  var savedOnce = false;
  var wake = null;
  var sid = parsed ? parsed.sid : '';
  var key = parsed ? parsed.key : '';
  var RELAY = parsed ? (RELAYS[parsed.cloud] || '') : '';
  var stopped = false;
  var visible = !document.hidden;
  var pollTimer = null;
  var pollBusy = false;
  var tappedAt = null;
  var lastOk = Date.now();
  var online = null;
  var sv = 0;
  var fv = 0;
  var es = 0;
  var dockSnap = null;
  var feedState = null;
  var lastFeedHtml = null;
  var searchId = '';
  var searchQ = '';
  var searchResult = null;
  var searchTimer = null;
  var bannerKind = '';
  var bannerTimer = null;
  var feedFilter = 'all';
  try {
    var saved = localStorage.getItem('remoteFeedSrc');
    if (/^(all|don|chat|pts)$/.test(saved || '')) feedFilter = saved;
  } catch (e) { /* приватный режим */ }

  // Список облаков из config.js; старое поле url читается как облако №0.
  function relayList(config) {
    var out = [];
    if (config && Array.isArray(config.relays)) {
      for (var i = 0; i < config.relays.length; i++) {
        var v = config.relays[i];
        if (typeof v !== 'string') continue;
        v = v.trim().replace(/\/+$/, '');
        if (v && out.indexOf(v) < 0) out.push(v);
      }
    }
    if (!out.length && config && typeof config.url === 'string') {
      var u = config.url.trim().replace(/\/+$/, '');
      if (u) out.push(u);
    }
    return out;
  }

  // #sid.ключ или #sid.ключ.номер облака (№0 — без номера).
  function parseHash(hash) {
    var m = /^#([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(?:\.(\d{1,4}))?$/.exec(String(hash || ''));
    if (!m) return null;
    var cloud = m[3] == null ? 0 : Number(m[3]);
    return { sid: m[1], key: m[2], cloud: cloud };
  }

  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function clear(node) { if (node) node.replaceChildren(); }

  function randomToken(bytes) {
    var n = bytes || 8;
    try { return C.b64u(C.newKey().slice(0, n)); }
    catch (e) {
      var s = '';
      for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36));
      return s;
    }
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showStatus(text, kind, ms) {
    if (!els.banner) return;
    bannerKind = kind || '';
    els.banner.textContent = String(text || '');
    els.banner.className = 'banner' + (kind ? ' ' + kind : '');
    els.banner.hidden = false;
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    if (ms) {
      bannerTimer = setTimeout(function () {
        bannerTimer = null;
        if (bannerKind === (kind || '')) { els.banner.hidden = true; bannerKind = ''; }
      }, ms);
    }
  }

  function hideStatus(kind) {
    if (!els.banner || els.banner.hidden) return;
    if (kind && bannerKind !== kind) return;
    els.banner.hidden = true;
    bannerKind = '';
  }

  function setOnline(on) {
    on = !!on;
    if (online === on) return;
    online = on;
    if (els.dot) els.dot.classList.toggle('off', !on);
    if (els.phoneAgo) els.phoneAgo.textContent = on ? 'на связи' : 'нет связи';
    if (wake) wake.setConnected(on);
    if (on) hideStatus('lost');
  }

  // Успешная связь: запоминаем адрес только на этом телефоне (ключ, sid, облако, режим).
  function rememberSession() {
    if (savedOnce || !parsed || !E || typeof E.saveSaved !== 'function') return;
    savedOnce = true;
    E.saveSaved({
      sid: parsed.sid, key: parsed.key, cloud: parsed.cloud,
      mode: RELAY.indexOf('http://') === 0 ? 'lan' : 'cloud'
    });
  }

  function setTab(which) {
    var dock = which !== 'feed';
    document.body.classList.toggle('tab-dock', dock);
    document.body.classList.toggle('tab-feed', !dock);
    if (els.tabDock) {
      els.tabDock.classList.toggle('on', dock);
      els.tabDock.setAttribute('aria-selected', dock ? 'true' : 'false');
    }
    if (els.tabFeed) {
      els.tabFeed.classList.toggle('on', !dock);
      els.tabFeed.setAttribute('aria-selected', dock ? 'false' : 'true');
    }
    hideResults();
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    var root = document.documentElement;
    if (theme.vars && typeof theme.vars === 'object') {
      for (var k in theme.vars) {
        if (!Object.prototype.hasOwnProperty.call(theme.vars, k)) continue;
        if (!/^--[A-Za-z0-9-]{1,40}$/.test(k)) continue;
        var v = theme.vars[k];
        if (typeof v !== 'string' || v.length > 120) continue;
        if (!/^[#A-Za-z0-9(),.%\s-]+$/.test(v)) continue;     // без url(), ; и { }
        root.style.setProperty(k, v);
      }
    }
    root.classList.toggle('theme-light', !!theme.light);
  }

  function applySnap(snap) {
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.items)) return;
    dockSnap = snap;
    applyTheme(snap.theme);
    if (D && els.dockHost) D.render(els.dockHost, snap, { send: sendCommand });
    updateNp();
  }

  function sanitizeFeed(html) {
    var src = typeof html === 'string' ? html : '';
    if (!src) return '';
    var doc = new DOMParser().parseFromString('<div id="__remote_feed">' + src + '</div>', 'text/html');
    var root = doc.getElementById('__remote_feed');
    if (!root) return '';
    var bad = root.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form');
    for (var i = 0; i < bad.length; i++) bad[i].parentNode.removeChild(bad[i]);
    var all = root.querySelectorAll('*');
    for (var n = 0; n < all.length; n++) {
      var attrs = Array.prototype.slice.call(all[n].attributes);
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name.toLowerCase();
        if (name.indexOf('on') === 0) { all[n].removeAttribute(attrs[a].name); continue; }
        if (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction') {
          var value = String(attrs[a].value || '').replace(/[\u0000-\u0020]/g, '').toLowerCase();
          if (value.indexOf('javascript:') === 0 || value.indexOf('vbscript:') === 0 || value.indexOf('data:text/html') === 0) {
            all[n].removeAttribute(attrs[a].name);
          }
        }
      }
    }
    return root.innerHTML;
  }

  function applyFeed(feed) {
    if (!feed || typeof feed !== 'object') return;
    feedState = feed;
    var count = Math.max(0, Math.trunc(Number(feed.msgCount) || 0));
    if (els.tabCount) els.tabCount.textContent = String(count);
    if (els.feedHead) els.feedHead.textContent = 'Сообщения · ' + count;
    var html = typeof feed.feedHtml === 'string' ? feed.feedHtml : '';
    if (html !== lastFeedHtml) {
      lastFeedHtml = html;
      var clean = sanitizeFeed(html);
      els.feed.innerHTML = clean;
      if (!clean) els.feed.replaceChildren(make('div', 'dock-empty', 'Сообщений пока нет'));
      applyFilter();
    }
    if (!dockSnap) updateNp();
  }

  function applyFilter() {
    if (!els.feed) return;
    var cards = els.feed.querySelectorAll('.rq[data-kind]');
    var n = { all: cards.length, don: 0, chat: 0, pts: 0 };
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var k = cards[i].getAttribute('data-kind');
      if (n[k] != null) n[k]++;
      var off = feedFilter !== 'all' && k !== feedFilter;
      cards[i].classList.toggle('flt-off', off);
      if (!off) shown++;
    }
    var buttons = els.flt ? els.flt.querySelectorAll('[data-f]') : [];
    for (var j = 0; j < buttons.length; j++) {
      var f = buttons[j].getAttribute('data-f');
      buttons[j].classList.toggle('on', f === feedFilter);
      buttons[j].setAttribute('aria-pressed', f === feedFilter ? 'true' : 'false');
      var sp = buttons[j].querySelector('i');
      if (sp) sp.textContent = String(n[f] || 0);
    }
    var empty = els.feed.querySelector('.rq-flt-empty');
    if (cards.length && !shown && !empty) {
      var em = make('div', 'rq-flt-empty', 'Таких сообщений нет');
      els.feed.appendChild(em);
    } else if (empty && (shown || !cards.length)) {
      empty.parentNode.removeChild(empty);
    }
  }

  function npNow() {
    if (dockSnap && dockSnap.np) return dockSnap.np;
    if (feedState && feedState.np) return feedState.np;
    return null;
  }

  function updateNp() {
    var np = npNow();
    var title = np && np.title ? np.title : 'ничего не играет';
    if (els.npTitle) els.npTitle.textContent = title;
    if (els.npArtist) els.npArtist.textContent = np && np.artist ? np.artist : '';
    if (els.playpause) els.playpause.innerHTML = np && np.playing ? PAUSE_SVG : PLAY_SVG;
    updateTime();
  }

  function updateTime() {
    var np = npNow();
    var pos = np ? Math.max(0, Number(np.pos) || 0) : 0;
    var dur = np ? Math.max(0, Number(np.dur) || 0) : 0;
    if (np && np.playing) {
      var at = dockSnap && Number(dockSnap.at) ? Number(dockSnap.at) : Date.now();
      pos += Math.max(0, (Date.now() - at) / 1000);
    }
    if (dur > 0) pos = Math.min(pos, dur);
    if (els.time) els.time.textContent = fmt(pos);
    if (els.bar) els.bar.style.width = dur > 0 ? Math.min(100, Math.round((pos / dur) * 1000) / 10) + '%' : '0%';
  }

  function pollUrl() {
    return RELAY + (RELAY.indexOf('?') >= 0 ? '&' : '?') +
      'op=poll&sid=' + encodeURIComponent(sid) + '&sv=' + sv + '&fv=' + fv + '&es=' + es;
  }

  function pollDelay(retry) {
    if (!visible) return null;
    if (P && typeof P.phoneDelay === 'function') {
      return P.phoneDelay({ now: Date.now(), tappedAt: tappedAt, visible: visible, retry: !!retry, lan: RELAY.indexOf('http://') === 0 });
    }
    return retry ? 2000 : 3000;
  }

  function schedulePoll(ms) {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (stopped || !visible) return;
    if (ms == null) ms = pollDelay(false);
    if (ms == null) return;
    pollTimer = setTimeout(function () { pollTimer = null; poll(); }, Math.max(0, ms));
  }

  // Любое нажатие: 20 с опрашиваем раз в секунду (и сразу ускоряем ближайший опрос).
  function noteTap() {
    tappedAt = Date.now();
    if (stopped || !visible || pollBusy || !pollTimer) return;
    schedulePoll(pollDelay(false));
  }

  async function poll() {
    if (stopped || pollBusy || !visible) return;
    pollBusy = true;
    try {
      var res = await fetch(pollUrl(), { method: 'GET', cache: 'no-store' });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (res.status === 404) { ended(); return; }
      if (!res.ok || !data || data.error) {
        if (data && data.error === 'no-session') { ended(); return; }
        throw new Error('bad reply');
      }
      lastOk = Date.now();
      rememberSession();
      var hostAgo = Number(data.hostAgo);
      if (Number.isFinite(hostAgo) && hostAgo > LOST_MS) {
        setOnline(false);
        showStatus(LOST, 'lost');
      } else {
        setOnline(true);
        hideStatus('lost');
      }
      if (data.sv != null && Number(data.sv) > sv && data.s) {
        var snap = await C.open(key, sid, 's', data.s);
        if (snap) { sv = Number(data.sv); applySnap(snap); }
      }
      if (data.fv != null && Number(data.fv) > fv && data.f) {
        var feed = await C.open(key, sid, 'f', data.f);
        if (feed) { fv = Number(data.fv); applyFeed(feed); }
      }
      if (Array.isArray(data.ev)) {
        for (var i = 0; i < data.ev.length; i++) {
          var item = data.ev[i];
          if (!item || !item.e) continue;
          var seq = Number(item.seq);
          if (Number.isFinite(seq) && seq > es) es = seq;
          var ev = await C.open(key, sid, 'e', item.e);
          if (ev) onEvent(ev);
        }
      }
      schedulePoll();
    } catch (e) {
      if (Date.now() - lastOk > LOST_MS) {
        setOnline(false);
        showStatus(LOST, 'lost');
      }
      schedulePoll(pollDelay(true));
    } finally {
      pollBusy = false;
    }
  }

  function ended() {
    stopped = true;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (E && typeof E.clearSaved === 'function') E.clearSaved();
    setOnline(false);
    showStatus(fromSaved ? ENDED_SAVED : ENDED, 'err');
  }

  function onEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.ev === 'toast') {
      if (typeof ev.text === 'string' && ev.text) showStatus(ev.text.slice(0, 300), 'ok', 3000);
      return;
    }
    if (ev.ev === 'search') {
      if (ev.id && searchId && ev.id !== searchId) return;
      if (ev.more && searchResult && searchResult.id === ev.id) {
        // следующая страница: дописываем, если это продолжение того, что уже показано
        if (Number(ev.from) === searchResult.items.length) {
          searchResult.items = searchResult.items.concat(Array.isArray(ev.items) ? ev.items : []);
          searchResult.total = ev.total;
          appendResults(ev.items || []);
        }
        moreAsked = false;
        return;
      }
      searchResult = ev;
      if (!Array.isArray(searchResult.items)) searchResult.items = [];
      if (typeof ev.q === 'string') searchQ = ev.q;
      moreAsked = false;
      renderResults();
    }
  }

  /* ── поиск ─────────────────────────────────────────────────────── */
  function closeResults() {
    if (els.results) { els.results.hidden = true; clear(els.results); }
    searchResult = null;
    searchQ = '';
    searchId = '';
  }

  // hideResults — только спрятать, не забывая выдачу (нужна, если поле ещё в фокусе)
  function hideResults() { if (els.results) els.results.hidden = true; }

  function doSearch(q) {
    if (stopped) return;
    q = String(q || '').trim().slice(0, 200);
    if (!q) { closeResults(); return; }
    searchId = randomToken(8);
    searchQ = q;
    searchResult = { ev: 'search', id: searchId, q: q, done: false, items: [] };
    renderResults();
    sendCommand({ c: 'search', q: q, id: searchId });
  }

  var moreAsked = false;
  var SRC_COLOR = { ym: '#FFD43B', yt: '#FF5A52', sc: '#FF7A1A', au: '#CC0FE0', bc: '#41A8C6', lc: '#4ADE9A', tap: '#9B87FF' };

  function renderResults() {
    if (!els.results) return;
    clear(els.results);
    els.results.hidden = false;
    var res = searchResult || { done: false, items: [], q: searchQ };
    var head = make('div', 'res-head');
    var count = Number(res.total) || (res.items ? res.items.length : 0);
    head.appendChild(make('div', 'res-title', res.done
      ? (count ? 'Найденные треки · ' + count : 'Ничего не нашлось')
      : 'Ищу…'));
    var x = make('button', 'res-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Закрыть поиск');
    x.addEventListener('click', function () { closeResults(); if (els.search) { els.search.value = ''; els.search.blur(); } });
    head.appendChild(x);
    els.results.appendChild(head);
    var list = make('div', 'res-list');
    list.addEventListener('scroll', function () {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - 160) askMore();
    }, { passive: true });
    els.results.appendChild(list);
    appendResults(res.items || []);
  }

  function appendResults(items) {
    var list = els.results && els.results.querySelector('.res-list');
    if (!list) return;
    var old = list.querySelector('.res-more'); if (old) old.parentNode.removeChild(old);
    for (var i = 0; i < items.length; i++) list.appendChild(resultRow(items[i]));
    var res = searchResult || {};
    if (res.items && res.total > res.items.length) {
      var tail = make('div', 'res-more', 'Ещё ' + (res.total - res.items.length) + '…');
      list.appendChild(tail);
      // «Ещё…» показалась на экране — просим следующую страницу (надёжнее одного события прокрутки)
      if (typeof IntersectionObserver === 'function') {
        var io = new IntersectionObserver(function (ents) {
          if (ents.some(function (en) { return en.isIntersecting; })) { io.disconnect(); askMore(); }
        }, { root: list, rootMargin: '0px 0px 160px 0px' });
        io.observe(tail);
      }
    }
    // выдача короче экрана — сразу просим следующую страницу
    if (list.scrollHeight <= list.clientHeight + 20) askMore();
  }

  function askMore() {
    var res = searchResult;
    if (moreAsked || !res || !res.id || !(res.total > res.items.length)) return;
    moreAsked = true;
    sendCommand({ c: 'more', id: res.id, from: res.items.length });
    setTimeout(function () { moreAsked = false; }, 4000);   // ответ потерялся — можно попросить снова
  }

  function resultRow(item) {
    var row = make('div', 'q');
    var cov = make('span', 'cov ph', '♪');
    if (item && typeof item.thumb === 'string' && /^https:\/\//i.test(item.thumb)) {
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = item.thumb;
      cov.textContent = '';
      cov.classList.remove('ph');
      cov.appendChild(img);
    }
    row.appendChild(cov);
    var m = make('div', 'm');
    m.appendChild(make('div', 't', item && item.title ? item.title : 'Без названия'));
    var parts = [];
    if (item && item.artist) parts.push(item.artist);
    if (item && item.srcName) parts.push(item.srcName);
    if (item && item.dur) parts.push(item.dur);
    var sub = make('div', 's');
    var dot = make('span', 'sd');
    dot.style.background = SRC_COLOR[item && item.src] || 'var(--tx4)';
    sub.appendChild(dot);
    sub.appendChild(document.createTextNode(parts.join(' · ')));
    m.appendChild(sub);
    row.appendChild(m);
    if (item && typeof item.r === 'string' && item.r) {
      var play = make('button', 'pb', '▶');
      play.type = 'button';
      play.setAttribute('aria-label', 'Включить');
      play.addEventListener('click', function () { sendCommand({ c: 'playnow', r: item.r }); closeResults(); });
      row.appendChild(play);
      var add = make('button', 'pb g', '+ В очередь');
      add.type = 'button';
      add.addEventListener('click', function () { sendCommand({ c: 'add', r: item.r }); });
      row.appendChild(add);
    }
    return row;
  }

  // Запрос для поиска из карточки: найденный трек (как его подобрал Тапёр) или текст сообщения
  function findFromCard(btn) {
    var it = btn.closest('.rq-it');
    var card = btn.closest('.rq');
    var tt = it && it.querySelector('.tt');
    var msg = card && card.querySelector('.rq-m');
    var q = (tt && tt.textContent) || (msg && msg.textContent) || '';
    q = q.replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!q || !els.search) return;
    els.search.value = q;
    try { els.search.focus({ preventScroll: true }); } catch (e) { /* старый браузер */ }
    doSearch(q);
  }

  /* ── команды ───────────────────────────────────────────────────── */
  async function sendCommand(cmd) {
    if (stopped || !cmd || typeof cmd.c !== 'string' || !C) return;
    noteTap();
    var body = {};
    for (var k in cmd) if (Object.prototype.hasOwnProperty.call(cmd, k)) body[k] = cmd[k];
    body.n = randomToken(8);
    body.t = Date.now();
    var piece;
    try { piece = await C.seal(key, sid, 'c', body); }
    catch (e) { showStatus('Нажатие не ушло. Проверь связь.', 'err', 4000); return; }
    try {
      var res = await fetch(RELAY + (RELAY.indexOf('?') >= 0 ? '&' : '?') + 'op=cmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: sid, c: piece })
      });
      if (res.status === 404) { ended(); return; }
      if (!res.ok) throw new Error('bad reply');
      schedulePoll(RELAY.indexOf('http://') === 0 ? 80 : 300);      // внеочередной опрос: ответ ПК — сразу
    } catch (e) {
      showStatus('Нажатие не ушло. Проверь связь.', 'err', 4000);
    }
  }

  /* ── запуск страницы ───────────────────────────────────────────── */
  function init() {
    // Новая ссылка пульта в той же вкладке меняет только часть после # — браузер страницу не перезагружает,
    // и она держала старую (закрытую) сессию. Новая сессия — новая загрузка (16.11).
    window.addEventListener('hashchange', function () { if (location.hash.length > 20) location.reload(); });
    if (els.tabDock) els.tabDock.addEventListener('click', function () { setTab('dock'); });
    if (els.tabFeed) els.tabFeed.addEventListener('click', function () { setTab('feed'); });
    if (els.prev) els.prev.addEventListener('click', function () { sendCommand({ c: 'tr', a: 'prev' }); });
    if (els.next) els.next.addEventListener('click', function () { sendCommand({ c: 'tr', a: 'next' }); });
    if (els.playpause) els.playpause.addEventListener('click', function () {
      var np = npNow();
      sendCommand({ c: 'tr', a: 'playpause' });
      if (np) els.playpause.setAttribute('aria-pressed', np.playing ? 'false' : 'true');
    });
    document.body.classList.add('tab-dock');
    document.addEventListener('pointerdown', noteTap, { passive: true });

    if (els.flt) els.flt.addEventListener('click', function (e) {
      var b = e.target.closest('[data-f]');
      if (!b) return;
      feedFilter = b.getAttribute('data-f');
      try { localStorage.setItem('remoteFeedSrc', feedFilter); } catch (er) { /* приватный режим */ }
      applyFilter();
    });

    if (els.feed) els.feed.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-rq]');
      if (!btn) return;
      e.preventDefault();
      var dataset = {};
      var keys = ['rq', 'ri', 'id', 'act', 'ix'];
      for (var i = 0; i < keys.length; i++) {
        var v = btn.dataset[keys[i]];
        if (v != null) dataset[keys[i]] = String(v).slice(0, 80);
      }
      if (!dataset.rq) return;
      // «Искать сам» / «Это заказ — искать»: в окне Тапёра они открывают поиск на ПК — с телефона это
      // бесполезно (и пульт такие кнопки не пропускает). Здесь — ищем в поиске самого пульта (16.11).
      if (dataset.rq === 'find' || dataset.rq === 'textfind') { findFromCard(btn); return; }
      sendCommand({ c: 'rq', dataset: dataset });
    });

    if (els.search) {
      els.search.addEventListener('input', function () {
        if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
        var q = els.search.value.trim();
        if (!q) { closeResults(); return; }
        searchTimer = setTimeout(function () { searchTimer = null; doSearch(q); }, 350);
      });
      els.search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
          doSearch(els.search.value);
        } else if (e.key === 'Escape') {
          closeResults();
        }
      });
    }
    document.addEventListener('pointerdown', function (e) {
      if (!els.results || els.results.hidden) return;
      if (els.results.contains(e.target) || e.target === els.search) return;
      hideResults();
    });

    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
      if (!visible) {
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        return;
      }
      lastOk = Date.now();
      poll();
    });

    setInterval(function () {
      if (stopped || !visible) return;
      if (Date.now() - lastOk > LOST_MS) {
        setOnline(false);
        showStatus(LOST, 'lost');
      }
    }, 2000);
    setInterval(updateTime, 500);

    if (!C || !D) {
      stopped = true;
      showStatus('Страница пульта не загрузилась. Обнови страницу.', 'err');
      return;
    }
    if (E && typeof E.createWakeLock === 'function') wake = E.createWakeLock(window);
    if (!parsed) {
      stopped = true;
      showStatus('Открой ссылку из Тапёра — по QR-коду из настроек.', 'err');
      return;
    }
    if (!RELAY) {
      stopped = true;
      showStatus(RELAYS.length ? 'Облако пульта не найдено — отсканируй код заново' : 'облако пульта не настроено', 'err');
      return;
    }
    setOnline(false);
    lastOk = Date.now();
    poll();
  }

  init();
})();
