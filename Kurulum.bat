@echo off
title DubKanka - Kurulum
cd /d "%~dp0"
echo ==========================================================
echo   DubKanka kurulumu (ilk sefere ozel, internet gerekir)
echo ==========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kurulum.ps1"
if errorlevel 1 (
  echo.
  echo Kurulum tamamlanamadi. Yukaridaki hatayi kontrol et.
  pause
  exit /b 1
)
echo.
pause
