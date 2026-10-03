@echo off
rem Silent autostart entry (called at Windows logon via registry Run -> VBS).
rem No window, no browser popup; starts only if not already running.
cd /d "%~dp0"
node server/status.js -q
if %errorlevel%==0 exit /b 0
wscript.exe "%~dp0server\silent-start.vbs"
exit /b 0
