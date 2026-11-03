'use strict';
// Тексты ответов бота. Каждый можно переписать и выключить в настройках.
// Подстановки: {ник} {трек} {время} {место} {причина} {мин} {сек} {заявок} {победители} {варианты}

const DEFAULTS = {
  queued:       { on: true,  text: '@{ник} поставил: {трек}, через ~{время}' },
  awaiting:     { on: true,  text: '@{ник} принято: {трек} — ждёт стримера' },
  choose:       { on: true,  text: '@{ник} нашёл варианты: {варианты} — ответь цифрой или !play 1' },
  notFound:     { on: true,  text: '@{ник} не понял, что ставить. Пиши: исполнитель — название, или ссылкой' },
  notFoundEvent:{ on: true,  text: '@{ник} не понял, что ставить. Пиши: исполнитель — название — успеешь до конца события' },
  rules:        { on: true,  text: '@{ник} не могу поставить: {причина}' },
  queueFull:    { on: true,  text: '@{ник} очередь заказов полна, попробуй позже' },
  pause:        { on: true,  text: '@{ник} следующий заказ через {мин} мин' },
  active:       { on: true,  text: '@{ник} твой заказ уже ждёт в очереди' },
  perStream:    { on: true,  text: '@{ник} на этом стриме ты уже заказал всё, что можно' },
  timeout:      { on: true,  text: '@{ник} заказы для тебя закрыты ещё на {мин} мин' },
  blocked:      { on: false, text: '@{ник} заказы для тебя закрыты' },
  noAccess:     { on: true,  text: '@{ник} заказывать могут не все — подробности у стримера' },
  outsideEvent: { on: true,  text: '@{ник} сейчас заказы только в событие — следующее примерно через {мин} мин' },
  outsideEventNoTime: { on: true, text: '@{ник} сейчас заказы только в событие' },
  eventOpen:    { on: true,  text: 'Событие заказов! {сек} секунд — пишите !play исполнитель — песня или ссылку' },
  eventResult:  { on: true,  text: 'Событие закрыто — {заявок} заявок. Победили: {победители}' },
  eventEmpty:   { on: true,  text: 'Событие закрыто — подходящих заявок не было' },
  repeatWin:    { on: true,  text: '@{ник} ты выиграл прошлое событие — дай шанс другим' },
  offline:      { on: false, text: '@{ник} стрим не идёт — заказы закрыты' },
  closed:       { on: false, text: '@{ник} приём заказов сейчас закрыт' },
  pointsCancel: { on: true,  text: '@{ник} баллы вернул: {причина}' },
  pointsDoubt:  { on: false, text: '@{ник} не уверен, что нашёл ту песню — стример проверит' },
  acceptOpen:   { on: true,  text: 'Заказы песен открыты: !play исполнитель — песня' },
  acceptClosed: { on: true,  text: 'Заказы песен закрыты' }
};

// Причины отказа — человеческим языком (для {причина}).
const REASONS = {
  tooLong: 'трек слишком длинный',
  tooShort: 'трек слишком короткий',
  stopList: 'этот трек здесь не ставят',
  stopArtist: 'этого исполнителя здесь не ставят',
  explicit: 'трек с пометкой 18+',
  repeat: 'этот трек недавно звучал',
  inQueue: 'этот трек уже в очереди',
  fewViews: 'у ролика слишком мало просмотров',
  live: 'трансляции не ставятся',
  geo: 'ролик недоступен в стране стримера',
  notFound: 'не нашёл такую песню',
  doubt: 'не уверен, что нашёл ту песню',
  removed: 'стример убрал трек',
  failed: 'трек не заиграл',
  queueFull: 'очередь полна',
  closed: 'приём закрыт'
};

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return 'скоро';
  const m = Math.max(1, Math.round(sec / 60));
  return m + ' мин';
}

function render(template, vars = {}) {
  return String(template).replace(/\{([^{}]+)\}/g, (all, key) => (vars[key] != null ? String(vars[key]) : all));
}

// Текст ответа по ключу с учётом настроек стримера. Возвращает строку или null (ответ выключен).
function make(key, vars = {}, custom = {}) {
  const base = DEFAULTS[key];
  if (!base) throw new Error('нет ответа ' + key);
  const c = custom[key] || {};
  const on = c.on != null ? c.on : base.on;
  if (!on) return null;
  return render(c.text != null && c.text !== '' ? c.text : base.text, vars);
}

module.exports = { DEFAULTS, REASONS, make, render, fmtTime };
