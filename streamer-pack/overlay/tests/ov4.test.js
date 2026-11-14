'use strict';
// OV4: тесты чистых расчётов страницы оверлея (textfit.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../page/textfit.js');

test('OV4 №8: вертикальное название короче колонки не получает высоту', () => {
  const p = T.verticalPlan(420, 260, 300);
  assert.equal(p.cap, 420);
  assert.equal(p.run, false);
  assert.equal(p.height, 0);
});

test('OV4 №8: колонка короче 300 px — предел ровно 300', () => {
  const p = T.verticalPlan(180, 240, 300);
  assert.equal(p.cap, 300);
  assert.equal(p.run, false, '240 px помещается в 300');
  assert.equal(p.height, 0);
});

test('OV4 №8: длинное название — вертикальная бегущая строка в пределах предела', () => {
  const p = T.verticalPlan(180, 612, 300);
  assert.equal(p.cap, 300);
  assert.equal(p.run, true);
  assert.equal(p.height, 300);
});

test('OV4: бегущая строка дублирует текст с зазором только когда не влезает', () => {
  assert.equal(T.marqueePlan('Кино', 80, 200).run, false);
  assert.equal(T.marqueePlan('Кино', 80, 200).text, 'Кино');
  const long = T.marqueePlan('Очень длинное название', 900, 200);
  assert.equal(long.run, true);
  assert.equal(long.text, T.marqueeText('Очень длинное название'));
  assert.ok(long.text.startsWith('Очень длинное название'));
  assert.equal(long.text, 'Очень длинное название      Очень длинное название      ');
});

test('OV4 №8: высоты хватает тексту — бегущая строка не включается', () => {
  // ровно в предел (допуск 1 px на округление шрифта)
  assert.equal(T.verticalPlan(300, 300, 300).run, false);
  assert.equal(T.verticalPlan(300, 301, 300).run, false);
  assert.equal(T.verticalPlan(300, 302, 300).run, true);
});

test('OV4 №11: крупное время Winamp — только текущая позиция', () => {
  assert.equal(T.winampClock(92), '01:32');
  assert.equal(T.winampClock(0), '00:00');
  assert.equal(T.winampClock(3723), '1:02:03');
  assert.equal(T.winampClock(-5), '--:--');
  assert.equal(T.winampClock(NaN), '--:--');
  assert.ok(!T.winampClock(92).includes('/'), 'длительности в крупном времени нет');
});

test('OV4 №11: строка «*** исполнитель - название ***»', () => {
  const np = { title: 'Midnight City', artist: 'M83' };
  assert.equal(T.winampText(np, false, ''), '*** M83 - Midnight City ***');
  assert.equal(T.winampText(np, true, 'dimon_play'), '*** M83 - Midnight City · заказ: dimon_play ***');
  assert.equal(T.winampText(np, true, ''), '*** M83 - Midnight City ***', 'без ника строка не меняется');
  assert.equal(T.winampText({ title: 'Без исполнителя', artist: '' }, false), '*** — - Без исполнителя ***');
  assert.equal(T.winampText(null, true, 'x'), '');
});

test('OV4 №11: очередь Winamp — исполнитель, затем название', () => {
  const it = { title: 'Хочешь?', artist: 'Земфира' };
  assert.equal(T.winampQueueRow(it, 0, true), '1. Земфира - Хочешь?');
  assert.equal(T.winampQueueRow(it, 2, false), 'Земфира - Хочешь?');
  assert.equal(T.winampQueueRow({ title: 'Своя' }, 0, false), 'Своя');
});
