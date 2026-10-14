@echo off
title MeshOptimiser installer
REM One double-click: runs install.ps1 from beside this file when it is there, otherwise fetches it from the site.
if exist "%~dp0install.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://lukagrcar.com/apps/meshoptimiser/install.ps1 | iex"
)
if errorlevel 1 pause
