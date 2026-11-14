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

// Запас названия считается только в координатах оверлея: ширины/координаты элемента
// и корня. Никакого окна, сдвига или положения на экране в формуле нет.
test('OV4 №3: запас названия не зависит от сдвига и размера', () => {
  const need = 900;
  assert.equal(T.titleReserve('L', 100, 340, 0, 340, 340, need), 270);
  assert.equal(T.titleReserve('R', 0, 240, 0, 340, 340, need), 270);
  assert.equal(T.titleReserve('B', 0, 340, 0, 340, 340, need), 170);
  // те же локальные числа при любом сдвиге/масштабе дают тот же запас
  const a = T.titleReserve('L', 100, 340, 0, 340, 340, need);
  const b = T.titleReserve('L', 100, 340, 0, 340, 340, need);
  assert.equal(a, b);
});

test('OV4 №3: запас не больше нужного и не отрицательный', () => {
  assert.equal(T.titleReserve('L', 100, 340, 0, 340, 340, 50), 50);
  assert.equal(T.titleReserve('L', 0, 340, 0, 340, 340, 900), 170);
  assert.equal(T.titleReserve('B', 0, 340, 0, 340, 340, 900), 170);
});

test('OV4 №3: коробка названия растёт в сторону, домашний край на месте', () => {
  assert.deepEqual(T.titleBox(200, 100, 'L'), { width: 300, marginLeft: -100, marginRight: 0 });
  assert.deepEqual(T.titleBox(200, 100, 'R'), { width: 300, marginLeft: 0, marginRight: 0 });
  assert.deepEqual(T.titleBox(200, 100, 'B'), { width: 300, marginLeft: -50, marginRight: -50 });
  assert.deepEqual(T.titleBox(200, 0, 'L'), { width: 200, marginLeft: 0, marginRight: 0 });
});

test('OV4 №3: моушн — коробка названия ровно вдвое длиннее плейлиста', () => {
  assert.equal(T.motionExtra(200, 100), 400);     // 200 → 200+400 = 600 = 2×(200+100)
  assert.equal(T.motionExtra(340, 170), 680);     // 340 → 1020 = 2×(340+170)
  assert.equal(T.motionExtra(200, 0), 0);
});

test('OV4 №3: ?dx/?dy/?size читаются и зажимаются как настройки', () => {
  const Demo = require('../page/demo.js');
  const d = Demo.options('?demo=1&dx=-900&dy=500&size=250');
  assert.equal(d.dx, -900);
  assert.equal(d.dy, 500);
  assert.equal(d.size, 250);
  const o = Demo.options('?demo=1&dx=-5000&dy=9999&size=10');
  assert.equal(o.dx, -900, 'сдвиг зажат -900…900');
  assert.equal(o.dy, 500, 'сдвиг зажат -500…500');
  assert.equal(o.size, 80, 'размер зажат 80…250');
  const z = Demo.options('?demo=1');
  assert.equal(z.dx, 0);
  assert.equal(z.dy, 0);
  assert.equal(z.size, 100);
});
