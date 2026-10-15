@echo off
rem Spicy Translate (browser version): double click -> the editor opens in the browser.
rem Close the editor tab when done - the server stops by itself. This window closes on its own.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul || goto :nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" || goto :oldnode

node scripts\launch.mjs || goto :fail
timeout /t 3 >nul
exit /b 0

:nonode
echo Node.js не найден. Ставлю Node.js LTS через winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements || goto :manual
echo.
echo Node.js установлен. Запусти "Spicy Translate.bat" ещё раз.
pause
exit /b 0

:oldnode
echo Нужен Node.js 22.18 или новее. Обновляю через winget...
winget upgrade -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements || goto :manual
echo Готово. Запусти "Spicy Translate.bat" ещё раз.
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
