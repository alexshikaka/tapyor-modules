'use strict';
// Не больше N поисков одновременно, каждый — не дольше timeoutMs (дальше считается «не нашёл»).
// Иначе на активном событии Тапёр задушит сам себя и площадки.

class Limiter {
  constructor(max = 3, timeoutMs = 8000) { this.max = max; this.timeoutMs = timeoutMs; this.running = 0; this.queue = []; }
  run(fn) {
    return new Promise((resolve) => {
      const job = () => {
        this.running++;
        let done = false;
        const finish = (v) => { if (done) return; done = true; clearTimeout(t); this.running--; resolve(v); const next = this.queue.shift(); if (next) next(); };
        const t = setTimeout(() => finish({ timeout: true }), this.timeoutMs);
        Promise.resolve().then(fn).then((v) => finish({ value: v }), (e) => finish({ error: e }));
      };
      if (this.running < this.max) job(); else this.queue.push(job);
    });
  }
}

module.exports = { Limiter };
