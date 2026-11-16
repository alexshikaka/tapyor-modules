/* Список облаков пульта. Этот файл перезаписывает tools/sync-remote-page.mjs из relay.json.
   Пусто — страница скажет «облако пульта не настроено». Старое поле url читается как облако №0. */
window.REMOTE_CONFIG = window.REMOTE_CONFIG || { relays: [], url: '' };
