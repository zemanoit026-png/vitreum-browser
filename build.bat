@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===== Установка зависимостей =====
call npm install
if errorlevel 1 goto fail
echo ===== Сборка установщика =====
call npm run build
if errorlevel 1 goto fail
echo.
echo Готово! Установщик лежит в папке dist.
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo.
echo Ошибка. Прокрутите окно вверх и пришлите красные строки.
pause
exit /b 1
