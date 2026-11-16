'use strict';
// Расписание опроса облака со стороны Тапёра (бережём облако):
// телефон был < 30 с назад — раз в 3 с, после команды 20 с — раз в 1 с;
// телефона нет — раз в 10 с; нет телефона 2 ч — раз в 60 с.
// Чистые функции и подставное время: проверяются без таймеров.

const PHONE_RECENT = 30 * 1000;        // телефон считается на связи столько после последнего опроса
const COMMAND_ACTIVE = 20 * 1000;      // после пришедшей команды опрашиваем чаще
const PHONE_GONE = 2 * 60 * 60 * 1000; // столько без телефона — совсем редкий опрос

const HOST_PHONE = 3000;
const HOST_COMMAND = 1000;
const HOST_NONE = 10000;
const HOST_NONE_LONG = 60000;

function age(now, at) {
  if (at == null) return null;
  const t = Number(at);
  return Number.isFinite(t) ? now - t : null;
}

function hostDelay(opts = {}) {
  const now = Number(opts.now) || 0;
  const phoneAge = age(now, opts.phoneAt);
  if (phoneAge != null && phoneAge < PHONE_RECENT) {
    const commandAge = age(now, opts.commandAt);
    if (commandAge != null && commandAge < COMMAND_ACTIVE) return HOST_COMMAND;
    return HOST_PHONE;
  }
  // Телефона нет: счёт от последнего телефона, а если его ещё не было — от показа QR.
  const sinceAge = phoneAge != null ? phoneAge : age(now, opts.missingSince);
  if (sinceAge != null && sinceAge >= PHONE_GONE) return HOST_NONE_LONG;
  return HOST_NONE;
}

module.exports = {
  PHONE_RECENT,
  COMMAND_ACTIVE,
  PHONE_GONE,
  HOST_PHONE,
  HOST_COMMAND,
  HOST_NONE,
  HOST_NONE_LONG,
  hostDelay
};
