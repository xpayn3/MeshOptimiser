@echo off
REM MeshOptimiser launcher. The program lives in the app folder; this file only
REM hands over to it, so the shortcuts and the habit of double-clicking
REM start.bat keep working. A file dropped on this one is passed on.
call "%~dp0app\start.bat" %*
exit /b %ERRORLEVEL%
