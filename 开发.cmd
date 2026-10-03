@echo off
rem Development mode: stop the background service first (it holds port 5173),
rem then run the dev server (hot reload). Same port 5173 -> same data.
rem When done, close the dev window and run 启动服务.cmd to switch back.
setlocal
cd /d "%~dp0"
echo Stopping background service (if running) ...
node server/stop.js
call "%~dp0dev.cmd"
exit /b 0
