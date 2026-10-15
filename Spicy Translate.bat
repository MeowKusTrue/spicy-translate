@echo off
rem Spicy Translate (browser version): checks Node, installs and builds on first run, starts the local server,
rem opens the editor in the browser. Close this window to stop the server.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PORT=8787"
if not "%SPICY_PORT%"=="" set "PORT=%SPICY_PORT%"
set "URL=http://127.0.0.1:%PORT%/"

rem A server already running here (MCP from Claude, the app, or another launch)? Just open the editor.
curl -s -o nul --max-time 2 "%URL%api/project" && (
  echo Сервер уже работает — открываю редактор.
  if not "%SPICY_NO_BROWSER%"=="1" start "" "%URL%"
  exit /b 0
)

where node >nul 2>nul || goto :nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" || goto :oldnode

if not exist node_modules (
  echo Первый запуск: ставлю зависимости ^(минута-две^)...
  call npm install || goto :fail
)
echo Собираю редактор...
call npm run build --silent || goto :fail

echo.
echo  Spicy Translate: %URL%
echo  Окно не закрывай — это сервер редактора. Закроешь окно — редактор остановится.
echo.
if not "%SPICY_NO_BROWSER%"=="1" start "" /b cmd /c "timeout /t 2 >nul & start "" "%URL%""
set "SPICY_PORT=%PORT%"
node server\index.ts --http
exit /b %errorlevel%

:nonode
echo Node.js не найден. Ставлю Node.js LTS через winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements || goto :manual
echo.
echo Node.js установлен. Закрой это окно и запусти "Spicy Translate.bat" ещё раз.
pause
exit /b 0

:oldnode
echo Нужен Node.js 22.18 или новее. Обновляю через winget...
winget upgrade -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements || goto :manual
echo Готово. Закрой это окно и запусти "Spicy Translate.bat" ещё раз.
pause
exit /b 0

:manual
echo Поставь Node.js 22.18+ вручную: https://nodejs.org — и запусти этот файл снова.
pause
exit /b 1

:fail
echo.
echo Что-то пошло не так (см. сообщения выше).
pause
exit /b 1
