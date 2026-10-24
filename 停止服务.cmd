@echo off
title Stop service
cd /d "%~dp0"
node server/stop.ts
node server/status.ts
pause
