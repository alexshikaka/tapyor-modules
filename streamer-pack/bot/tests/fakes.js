'use strict';
// Поддельное ядро и часы для тестов: без Electron, без сети.

function track(author, title, extra = {}) { return { src: 'ym', id: author + '/' + title, author, title, durSec: 200, ...extra }; }

function fakeCore(catalog = {}, opts = {}) {
  const added = [];
  let n = 0;
  return {
    added,
    calls: [],
    async findOrder(q, o) {
      this.calls.push({ q, o });
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay(q)));
      const key = q.toLowerCase();
      if (o && o.catalogsOnly && opts.ytOnly && opts.ytOnly.includes(key)) return { level: 'none' };
      return catalog[key] || { level: 'none' };
    },
    checkTrack(t) { return (opts.rules && opts.rules(t)) || { ok: true }; },
    orders: {
      add(o) { const id = 'o' + (++n); added.push({ id, ...o }); return { id, place: added.length, etaSec: added.length * 200 }; },
      count(prov) { return prov === 'any' ? added.length : added.filter((x) => x.prov === prov).length; },
      remove(id) { const i = added.findIndex((x) => x.id === id); if (i >= 0) added.splice(i, 1); }
    }
  };
}

function clock(start = 1_700_000_000_000) { const c = { t: start, now: () => c.t, add: (ms) => { c.t += ms; } }; return c; }

// Детерминированный «случайный» генератор.
function seeded(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function user(login, extra = {}) { return { id: 'u-' + login, login, ...extra }; }

module.exports = { track, fakeCore, clock, seeded, user };
