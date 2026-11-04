'use strict';
// Модуль «Оверлей-плейлист»: страница для OBS (источник «Браузер»), что играет и что дальше.
// Ядро вызывает activate(core) — мост описан в docs/ARCHITECTURE.md.
// Модуль только ЧИТАЕТ состояние плеера: страница ничего не может нажать в Тапёре.

const fs = require('fs');
const path = require('path');
const { normalize, DEFAULTS } = require('./settings');
const { buildFeed, cleanSnap } = require('./feed');

const PAGE_DIR = path.join(__dirname, '..', 'page');
// Страница отдаёт только эти файлы — никаких путей из запроса
const PAGE_FILES = {
  '/playlist': ['playlist.html', 'text/html; charset=utf-8'],
  '/playlist.css': ['playlist.css', 'text/css; charset=utf-8'],
  '/playlist.js': ['playlist.js', 'text/javascript; charset=utf-8'],
  '/dos.js': ['dos.js', 'text/javascript; charset=utf-8']
};

class Overlay {
  constructor(core, deps = {}) {
    this.core = core;
    this.readFile = deps.readFile || fs.readFile;
    this.clients = new Set();           // { res, preview }
    this.snap = null;                   // последний снимок плеера от ядра (сырой)
    this.cfg = normalize(core.settings.get('overlay'));
    this.obsWas = 0;
    this.off = [];
    this.hb = null;
    this.spec = null;
    this.specAt = 0;
  }

  start() {
    const c = this.core;
    if (!c.http || !c.http.mount || !c.player || !c.player.on) throw new Error('нужен Тапёр новее: в ядре нет моста для оверлея');
    c.http.mount('/overlay', (req, res, sub, query) => this.handle(req, res, sub, query));
    this.off.push(c.player.on('state', (s) => { this.snap = s; this.broadcast(); }));
    this.off.push(c.player.on('level', (x) => this.level(x)));
    this.off.push(c.player.on('spectrum', (x) => this.spectrum(x)));
    this.hb = setInterval(() => this.ping(), 4000);
    if (this.hb.unref) this.hb.unref();
    this.want();
  }

  async stop() {
    clearInterval(this.hb);
    for (const f of this.off) { try { if (typeof f === 'function') f(); } catch (e) { /* уже отписан */ } }
    this.off = [];
    for (const cl of this.clients) { try { cl.res.end(); } catch (e) { /* закрыт */ } }
    this.clients.clear();
    try { if (this.core.http.unmount) this.core.http.unmount('/overlay'); } catch (e) { /* ядро уже закрыло сервер */ }
    try { this.core.player.want({ state: false, levels: false }); } catch (e) { /* ядро закрывается */ }
  }

  obsCount() { let n = 0; for (const cl of this.clients) if (!cl.preview) n++; return n; }

  // Ядро шлёт состояние плеера и уровни звука, только пока страницу кто-то смотрит
  want() {
    const any = this.clients.size > 0;
    this.core.player.want({ state: any, levels: any && this.cfg.osc });
    const obs = this.obsCount();
    if (obs !== this.obsWas) {
      this.core.log('оверлей: источников OBS — ' + obs);
      this.obsWas = obs;
    }
  }

  feed() { return { ...buildFeed(this.cfg, this.snap), obs: this.obsCount() }; }

  send(cl, chunk) {
    try { cl.res.write(chunk); }
    catch (e) { if (this.clients.delete(cl)) this.want(); }
  }

  broadcast() {
    if (!this.clients.size) return;
    const chunk = 'data: ' + JSON.stringify(this.feed()) + '\n\n';
    for (const cl of this.clients) this.send(cl, chunk);
  }

  level(x) {
    if (!this.clients.size) return;
    const v = Math.max(0, Math.min(1, Number(x) || 0));
    const chunk = 'event: lv\ndata: ' + v.toFixed(3) + '\n\n';
    for (const cl of this.clients) this.send(cl, chunk);
  }

  spectrum(x) {
    if (!this.clients.size || this.cfg.viz !== 'spectrum' || !Array.isArray(x)) return;
    const arr = x.slice(0, 32).map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
    this.spec = arr; this.specAt = Date.now();
    const chunk = 'event: spectrum\ndata: ' + JSON.stringify(arr) + '\n\n';
    for (const cl of this.clients) this.send(cl, chunk);
  }

  ping() { for (const cl of this.clients) this.send(cl, ': hb\n\n'); }

  handle(req, res, sub, query) {
    const q = query || new URLSearchParams();
    const page = PAGE_FILES[sub === '/' ? '/playlist' : sub];
    if (page) {
      this.readFile(path.join(PAGE_DIR, page[0]), (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': page[1], 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }
    if (sub === '/events') {
      if (this.clients.size >= 8) { res.writeHead(503); res.end('too many clients'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const cl = { res, preview: q.get('preview') === '1' };
      res.write('retry: 2000\n\n');
      this.clients.add(cl);
      if (typeof res.on === 'function') res.on('error', () => { if (this.clients.delete(cl)) this.want(); });
      this.send(cl, 'data: ' + JSON.stringify(this.feed()) + '\n\n');
      if (this.spec && Date.now() - this.specAt < 1500) this.send(cl, 'event: spectrum\ndata: ' + JSON.stringify(this.spec) + '\n\n');
      this.want();
      if (!cl.preview) this.broadcast();         // окно настроек видит «OBS подключён» сразу
      req.on('close', () => { this.clients.delete(cl); this.want(); this.broadcast(); });
      return;
    }
    if (sub === '/cover') { this.cover(res, q.get('k') || ''); return; }
    res.writeHead(404); res.end('not found');
  }

  // Обложка своего файла с компьютера — только та, что играет сейчас
  async cover(res, key) {
    const cur = this.snap && this.snap.np && String(this.snap.np.cover || '');
    if (!cur || !cur.startsWith('/lcover/') || cur.slice(8, 80) !== key || !this.core.player.coverImage) { res.writeHead(404); res.end(); return; }
    const img = await this.core.player.coverImage(cur).catch(() => null);
    if (!img) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'no-store' });
    res.end(img.data);
  }

  command(cmd, data = {}) {
    switch (cmd) {
      case 'settings': return { ...this.cfg };
      case 'defaults': return { ...DEFAULTS };
      case 'save': {
        this.cfg = normalize({ ...this.cfg, ...(data || {}) });
        this.core.settings.set('overlay', this.cfg);
        this.want();
        this.broadcast();
        return { ...this.cfg };
      }
      case 'reset': {
        this.cfg = normalize({});
        this.core.settings.set('overlay', this.cfg);
        this.want();
        this.broadcast();
        return { ...this.cfg };
      }
      case 'status': return { obs: this.obsCount(), clients: this.clients.size, url: this.core.http.url ? this.core.http.url('/overlay/playlist') : '' };
      default: throw new Error('неизвестная команда оверлея: ' + cmd);
    }
  }
}

async function activate(core, deps) { const o = new Overlay(core, deps); o.start(); return o; }

module.exports = { Overlay, activate, PAGE_FILES, cleanSnap };
