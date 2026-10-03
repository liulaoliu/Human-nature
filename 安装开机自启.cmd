@echo off
rem Register autostart at Windows logon (hidden, no console flash).
setlocal
title Install autostart
cd /d "%~dp0"
set "VBS=%cd%\server\silent-start.vbs"
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ShadowingReaderService /t REG_SZ /d "\"wscript.exe\" \"%VBS%\"" /f >nul
echo Autostart installed. It starts silently at logon (no window, no browser).
echo Run "启动服务.cmd" anytime to check status.
pause
