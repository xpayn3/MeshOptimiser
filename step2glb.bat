@echo off
REM Drag-and-drop friendly: drop a STEP file on this .bat to convert it.
REM Or run from the command line: step2glb.bat input.step
cd /d "%~dp0"
if "%~1"=="" (
  echo.
  echo   Drag a .step file onto this script, or run:
  echo     step2glb.bat input.step
  echo.
  pause
  exit /b 1
)
python step2glb.py "%~1"
echo.
pause
