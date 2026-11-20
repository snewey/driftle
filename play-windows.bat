@echo off
cd /d "%~dp0"
title Driftle
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed yet.
  echo 1. Go to https://nodejs.org and download the LTS version
  echo 2. Install it with the default options
  echo 3. Double-click this file again
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing the game, this takes about a minute...
  call npm install
)
echo.
echo Starting Driftle. Your browser will open in a few seconds.
echo Keep this window open while you play. Close it to stop the game.
echo.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:5173"
call npm run dev -- --port 5173 --strictPort
pause
