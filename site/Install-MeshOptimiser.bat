@echo off
title MeshOptimiser installer
REM One double-click: fetches the installer from the site and runs it. (install.ps1 sits beside this file on the site.)
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://lukagrcar.com/apps/meshoptimiser/install.ps1 | iex"
if errorlevel 1 pause
