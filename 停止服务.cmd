@echo off
title Stop service
cd /d "%~dp0"
node server/stop.js
node server/status.ts
pause
