@echo off
rem Build the app (tsc + vite). Run this after changing source code.
setlocal
cd /d "%~dp0"
call npm run build
if errorlevel 1 (
  echo.
  echo Build FAILED.
  pause
  exit /b 1
)
echo.
echo Build OK. dist\ is ready.
pause
