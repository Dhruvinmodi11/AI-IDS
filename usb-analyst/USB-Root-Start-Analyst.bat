@echo off
REM Put this file on the ROOT of the USB (F:\Start Analyst.bat)
cd /d "%~dp0gemma"
title Local Analyst
echo Starting Local Analyst from USB. Keep this window open.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0gemma\Start-Analyst.ps1"
if errorlevel 1 pause
