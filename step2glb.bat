@echo off
REM Drag-and-drop friendly: drop a STEP file on this .bat to convert it.
REM Or run from the command line: step2glb.bat input.step [options]
setlocal
if "%~1"=="" (
  echo.
  echo   Drag a .step file onto this script, or run:
  echo     step2glb.bat input.step
  echo.
  pause
  exit /b 1
)
REM The file as a full path, taken before the folder changes; the rest of the
REM arguments are passed on as they are.
set "SRC=%~f1"
set "REST="
:more
shift
if "%~1"=="" goto run
set "REST=%REST% %1"
goto more
:run
cd /d "%~dp0"
REM The converter needs the packages in the project's own environment.
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo   The Python environment is not set up yet. Run start.bat once first.
  echo.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" step2glb.py "%SRC%"%REST%
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
