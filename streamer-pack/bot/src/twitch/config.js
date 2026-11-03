'use strict';
// Приложение «Tapyor» на dev.twitch.tv: тип клиента «Общедоступный» (Public).
// Client ID — НЕ секрет: он виден любому, кто входит через Twitch. Секрета у приложения нет и не должно быть.
const CLIENT_ID = 'm23ihysdc8a18zniz4uhhz0hu4hbue';

const ID_URL = 'https://id.twitch.tv/oauth2';
const API_URL = 'https://api.twitch.tv/helix';
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

// Разрешения. Просим только то, что нужно, — список виден стримеру в окне Twitch.
const SCOPES = {
  // аккаунт, который пишет в чат (бот или сам стример)
  chat: ['user:read:chat', 'user:write:chat', 'moderator:read:followers'],
  // аккаунт стримера: награда за баллы и проверка фолловинга
  broadcaster: ['channel:manage:redemptions', 'moderator:read:followers']
};
function scopesFor(roles) { return [...new Set(roles.flatMap((r) => SCOPES[r] || []))]; }

module.exports = { CLIENT_ID, ID_URL, API_URL, EVENTSUB_URL, SCOPES, scopesFor };
