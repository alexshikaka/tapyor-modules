@echo off
chcp 65001 >nul
title Tapyor - проверка чат-бота
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
node -v
node tools\try-bot.js
pause
