@echo off
title Remove autostart
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ShadowingReaderService /f >nul 2>&1
echo Autostart removed.
pause
