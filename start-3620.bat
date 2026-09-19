@echo off
REM Headless start of EC11 on port 3620 (no browser). Used for scripted runs.
cd /d "%~dp0"
setlocal
set PORT=3620
node.exe scripts\next.mjs dev
if errorlevel 1 (
  pause
  exit /b 1
)
endlocal
exit /b 0
