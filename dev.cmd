@echo off
rem Double-click this file: it opens a terminal and runs `npm run dev` in this folder.
rem Kept ASCII-only on purpose: a `chcp 65001` inside a .cmd makes cmd.exe
rem mis-parse the rest of the file (Chinese text in comments/echo gets garbled).
setlocal
cd /d "%~dp0"

if not exist "package.json" (
  echo package.json not found - keep this file in the project folder.
  pause
  exit /b 1
)

rem Prefer Windows Terminal. It is often not on PATH (it lives under
rem %LOCALAPPDATA%\Microsoft\WindowsApps), so try the App Execution Alias too.
set "WT="
where wt.exe >nul 2>nul && set "WT=wt.exe"
if not defined WT if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe" set "WT=%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe"

rem `cmd /k` keeps the window open after the server exits, so a failure
rem (e.g. port 5173 already in use) stays readable instead of vanishing.
if defined WT (
  start "" "%WT%" -d "%~dp0" cmd /k "npm run dev"
) else (
  echo Windows Terminal not found - using a plain command window instead.
  start "" cmd /k "npm run dev"
)
exit /b 0
