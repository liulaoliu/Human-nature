@echo off
rem Start the local service in the background (detached). Safe to run again: it only
rem starts when not already running, then shows status and opens the browser.
setlocal
title Shadowing Reader Service
cd /d "%~dp0"

node server/status.js -q
if %errorlevel%==0 goto running

echo Service not running. Starting in background ...
node server/silent-start.js
for /l %%i in (1,1,15) do (
  node server/status.js -q >nul 2>&1 && goto up
  timeout /t 1 /nobreak >nul
)
echo.
echo Start FAILED: port 5173 has no response.
echo   - If you are developing, the dev server may be using 5173. Close it, or run 停止服务.cmd.
echo   - If dist\ is missing, run 构建.cmd first.
pause
exit /b 1

:up
node server/status.js
start "" "http://localhost:5173/"
exit /b 0

:running
echo Service already running.
node server/status.js
start "" "http://localhost:5173/"
exit /b 0
