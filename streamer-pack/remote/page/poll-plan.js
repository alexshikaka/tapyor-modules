/* Расписание опроса облака со страницы телефона: видна — раз в 3 с,
   после любого нажатия 20 с — раз в 1 с, скрыта — не опрашивает.
   Чистые функции: проверяются в Node без браузера и таймеров. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RemotePoll = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var PHONE_POLL = 3000;
  var PHONE_POLL_TAP = 1000;
  var TAP_FAST = 20 * 1000;
  var RETRY = 2000;

  function age(now, at) {
    if (at == null) return null;
    var t = Number(at);
    return isFinite(t) ? now - t : null;
  }

  // null — не опрашивать (страница скрыта); иначе пауза до следующего опроса.
  function phoneDelay(opts) {
    opts = opts || {};
    if (opts.visible === false) return null;
    var now = Number(opts.now) || 0;
    var tapAge = age(now, opts.tappedAt);
    if (tapAge != null && tapAge < TAP_FAST) return PHONE_POLL_TAP;
    if (opts.retry) return RETRY;
    return PHONE_POLL;
  }

  return {
    PHONE_POLL: PHONE_POLL,
    PHONE_POLL_TAP: PHONE_POLL_TAP,
    TAP_FAST: TAP_FAST,
    RETRY: RETRY,
    phoneDelay: phoneDelay
  };
});
