'use strict';
// Точка входа модуля «Чат-бот Twitch». Пока — только логика; связь с Twitch и мост ядра подключаются позже
// (см. docs/ARCHITECTURE.md).

module.exports = {
  triggers: require('./logic/triggers'),
  replies: require('./logic/replies'),
  access: require('./logic/access'),
  event: require('./logic/event'),
  ...require('./logic/pipeline'),
  ...require('./logic/points')
};
