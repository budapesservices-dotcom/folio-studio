@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [FOLIO] Node.js is not installed.
  echo Install Node.js 26 LTS (or Node.js 24.11+) for Windows x64 first.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<24 || (v[0]===24 && v[1]<11) || v[0]>=27){console.error('[FOLIO] Node.js 24.11 through 26.x is supported. Current: '+process.versions.node);process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist node_modules (
  echo [FOLIO] Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo [FOLIO] Dependency installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo [FOLIO] Starting Folio Studio...
call npm run dev
