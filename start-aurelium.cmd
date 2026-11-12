@echo off
rem Launches AURELIUM on Windows. Installs dependencies the first time.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org ^(LTS^) and run this again.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo First run: installing AURELIUM dependencies...
  call npm install
)
call npm start
