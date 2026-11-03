'use strict';
// Точка входа модуля «Чат-бот Twitch». Ядро вызывает activate(core) — см. docs/ARCHITECTURE.md.

module.exports = {
  ...require('./bot'),
  triggers: require('./logic/triggers'),
  replies: require('./logic/replies'),
  access: require('./logic/access'),
  event: require('./logic/event'),
  ...require('./logic/pipeline'),
  ...require('./logic/points')
};
