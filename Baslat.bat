@echo off
title DubKanka
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Ilk calistirma: once kurulum yapiliyor...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kurulum.ps1"
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -m dubkanka
if errorlevel 1 pause
