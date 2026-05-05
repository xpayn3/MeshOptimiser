@echo off
REM Quick test: run step2glb.py directly so you can see the full Python output.
REM Drag any .step file onto this script to test the converter outside the browser.
title step2glb test
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo  ERROR: .venv missing. Run start.bat once first to install.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat

if "%~1"=="" (
  echo.
  echo  Usage: drag a .step file onto this script,
  echo  or run from a terminal:  test-converter.bat path\to\file.step
  echo.
  pause
  exit /b 0
)

echo.
echo  Running step2glb.py on: %~1
echo  =====================================================================
echo.
python step2glb.py "%~1" --force
set RC=%ERRORLEVEL%
echo.
echo  =====================================================================
echo  step2glb.py exit code: %RC%
echo.
pause
