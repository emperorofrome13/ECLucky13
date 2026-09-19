@echo off
setlocal
cd /d "%~dp0"
echo ECLucky13 Coder v1.21
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22.6 or newer and run this launcher again.
  pause
  exit /b 1
)
node scripts\launch.mjs
if errorlevel 1 pause
endlocal
