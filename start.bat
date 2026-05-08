@echo off
title STEP Optimizer
cd /d "%~dp0"

echo.
echo  ============================================================
echo    STEP Optimizer
echo  ============================================================
echo.
if "%~1"=="" (
  echo    No file dropped - starting viewer empty.
) else (
  echo    Dropped file:  "%~1"
)
echo    Working dir:   %CD%
echo.

REM --- Step 1: find a real Python -----------------------------
REM Probe each candidate by actually running --version. The Microsoft Store
REM stub at WindowsApps\python.exe is found by `where python` but exits
REM non-zero with "Python was not found", so we filter it out by exit code.
echo  [1/4] Checking Python...
call :find_python
if defined PY goto py_found

REM --- No Python: offer to install it ------------------------
echo.
echo    Python was not found on this PC.
echo.
choice /c YN /m "    Install Python 3.12 automatically now"
if errorlevel 2 (
  echo.
  echo    Skipped. Install Python 3.10 - 3.12 from https://www.python.org/downloads/
  echo    During install, CHECK "Add Python to PATH".
  echo    Then close this window and double-click start.bat again.
  echo.
  pause
  exit /b 1
)

call :install_python
if errorlevel 1 (
  echo.
  echo    Auto-install failed. Install Python manually from
  echo    https://www.python.org/downloads/ and re-run start.bat.
  echo.
  pause
  exit /b 1
)

REM Re-probe — installer adds `py` launcher under C:\Windows which is
REM already on PATH, so a new shell isn't required.
call :find_python
if not defined PY (
  echo.
  echo    Python was installed but is not yet visible on PATH.
  echo    Close this window, open a new terminal, and re-run start.bat.
  echo.
  pause
  exit /b 1
)

:py_found
%PY% --version
echo.

REM --- Step 2: virtualenv -------------------------------------
echo  [2/4] Checking local Python environment...
if exist ".venv\Scripts\python.exe" goto venv_ready

echo        First-time setup - creating .venv (takes ~30 seconds)...
%PY% -m venv .venv
if errorlevel 1 (
  echo.
  echo    ERROR: Failed to create virtual environment.
  echo    Make sure Python 3.10+ is installed and the venv module is available.
  echo.
  pause
  exit /b 1
)

echo        Installing dependencies (takes 1-3 minutes the first time)...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo    ERROR: pip install failed. Check your internet connection.
  echo.
  pause
  exit /b 1
)
echo        Setup complete.
goto venv_done

:venv_ready
echo        Found .venv - reusing it.
call .venv\Scripts\activate.bat

:venv_done
echo.

REM --- Step 3: launch -----------------------------------------
echo  [3/4] Starting local server on http://localhost:4242
echo.

if "%~1"=="" (
  python serve.py
) else (
  python serve.py --open "%~1"
)

set EXITCODE=%ERRORLEVEL%
echo.
echo  [4/4] Server stopped.
REM Only pause on error so a clean shutdown (Ctrl+C, /api/quit from the
REM File > Quit menu) closes the window automatically. On error we keep
REM the window open so the user can see the failure.
if not %EXITCODE%==0 (
  echo    Exit code: %EXITCODE%
  echo.
  pause
)
exit /b %EXITCODE%


REM ============================================================
REM Subroutines
REM ============================================================

:find_python
set "PY="
py -3 --version >nul 2>nul
if not errorlevel 1 (set "PY=py -3" & exit /b 0)
python --version >nul 2>nul
if not errorlevel 1 (
  REM Reject the Microsoft Store stub: it lives in WindowsApps and exits 9009
  REM on real use. `python --version` returns 0 on the stub in newer builds
  REM though, so check for the WindowsApps path explicitly.
  for /f "delims=" %%P in ('where python 2^>nul') do (
    echo %%P | findstr /i "WindowsApps" >nul
    if errorlevel 1 (set "PY=python" & exit /b 0)
  )
)
python3 --version >nul 2>nul
if not errorlevel 1 (set "PY=python3" & exit /b 0)
exit /b 1


:install_python
echo.
echo    Installing Python 3.12...
echo.

REM --- Attempt 1: winget (Windows 10 1709+ / Windows 11) ------
where winget >nul 2>nul
if not errorlevel 1 (
  echo    Using winget...
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent
  if not errorlevel 1 goto install_ok
  echo    winget install failed, falling back to direct download...
)

REM --- Attempt 2: download official installer + silent run ----
set "PYINST=%TEMP%\python-3.12-installer.exe"
set "PYURL=https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe"
echo    Downloading installer from python.org...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -Uri '%PYURL%' -OutFile '%PYINST%' } catch { exit 1 }"
if errorlevel 1 (
  echo    Download failed.
  exit /b 1
)
echo    Running installer (silent, per-user, adds to PATH)...
"%PYINST%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0 Include_doc=0
if errorlevel 1 (
  echo    Silent installer reported an error.
  del /q "%PYINST%" >nul 2>nul
  exit /b 1
)
del /q "%PYINST%" >nul 2>nul

:install_ok
echo    Python installed.
REM Refresh this shell's PATH so newly installed binaries are visible.
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul ^| findstr /i "REG_"') do set "USRPATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul ^| findstr /i "REG_"') do set "SYSPATH=%%B"
set "PATH=%SYSPATH%;%USRPATH%"
exit /b 0
