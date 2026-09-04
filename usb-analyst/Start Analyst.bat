@echo off
cd /d "%~dp0"
title Local Analyst
echo Starting Local Analyst. Keep this window open.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Analyst.ps1"
if errorlevel 1 pause
