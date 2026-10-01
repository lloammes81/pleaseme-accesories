@echo off
REM Pleaseme - inicia la base de datos local (Windows: doble clic)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js no esta instalado. Descargalo de https://nodejs.org (version LTS) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:3000/admin.html
node servidor\server.js
pause
