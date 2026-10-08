@echo off
title MeshOptimiser
REM The file to open, as a full path, taken before the folder changes: a path
REM typed relative to wherever the launcher was called from would not be found
REM from the project folder.
set "SRC="
if not "%~1"=="" set "SRC=%~f1"
cd /d "%~dp0"

echo.
echo  ============================================================
echo    MeshOptimiser
echo  ============================================================
echo.
if not defined SRC (
  echo    No file dropped - starting viewer empty.
) else (
  echo    Dropped file:  "%SRC%"
)
echo    Working dir:   "%CD%"
echo.

REM --- Step 1: a Python that can run this ----------------------
REM MeshOptimiser needs Python 3.10, 3.11 or 3.12: the versions the CAD
REM library it depends on is built for. Any other version is turned down here,
REM with a message, instead of failing later in the middle of pip install.
echo  [1/4] Checking Python...

REM An environment that is already set up has a Python of its own. That is the
REM one that runs, so that is the one to check, and the PC is not searched.
if exist ".venv\Scripts\python.exe" goto venv_check

call :find_python
if defined PY goto py_found

REM --- No usable Python: say why, and offer to install one -----
echo.
if defined PYBAD (
  echo    Found Python %PYBAD%, but MeshOptimiser needs Python 3.10, 3.11 or 3.12.
  echo    Python 3.12 can be installed next to it; the one you have stays as it is.
) else (
  echo    Python was not found on this PC.
)
echo.
REM Started without a window there is nobody to answer the question below.
if defined MESHOPTIMISER_HIDDEN exit /b 1
choice /c YN /m "    Install Python 3.12 automatically now"
if errorlevel 2 (
  echo.
  echo    Skipped. Install Python 3.10 - 3.12 from https://www.python.org/downloads/
  echo    During install, CHECK "Add Python to PATH".
  echo    Then close this window and double-click start.bat again.
  echo.
  call :hold
  exit /b 1
)

call :install_python
if errorlevel 1 (
  echo.
  echo    Auto-install failed. Install Python 3.10 - 3.12 manually from
  echo    https://www.python.org/downloads/ and re-run start.bat.
  echo.
  call :hold
  exit /b 1
)

REM Look again: the installer's folders are on this window's PATH now.
call :find_python
if not defined PY (
  echo.
  echo    Python was installed but is not yet visible on PATH.
  echo    Close this window, open a new terminal, and re-run start.bat.
  echo.
  call :hold
  exit /b 1
)

:py_found
%PY% --version
echo.

REM --- Step 2: virtualenv -------------------------------------
echo  [2/4] Checking local Python environment...
echo        First-time setup - creating .venv (takes ~30 seconds)...
%PY% -m venv .venv
if errorlevel 1 (
  echo.
  echo    ERROR: Failed to create virtual environment.
  echo    Make sure Python 3.10 to 3.12 is installed and the venv module is available.
  echo.
  call :hold
  exit /b 1
)
goto venv_exists

:venv_check
REM The environment's own Python: does it still run, and is it a supported
REM version? (It stops running when the Python it was made from is removed.)
".venv\Scripts\python.exe" --version
if errorlevel 1 (
  echo.
  echo    The Python environment in the .venv folder no longer works: the
  echo    Python it was made with has probably been removed or replaced.
  echo    Delete the .venv folder and run start.bat again to rebuild it.
  echo.
  call :hold
  exit /b 1
)
".venv\Scripts\python.exe" -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)"
if errorlevel 1 (
  echo.
  echo    The environment in the .venv folder was made with the Python above.
  echo    MeshOptimiser needs Python 3.10, 3.11 or 3.12.
  echo    Delete the .venv folder and run start.bat again to rebuild it.
  echo.
  call :hold
  exit /b 1
)
echo.
echo  [2/4] Checking local Python environment...

:venv_exists
REM The packages are installed once per requirements.txt: a copy of the file is
REM kept in .venv after a successful install, and compared here. So a first
REM run that failed half-way, or an update that changed the requirements, is
REM put right on the next start instead of being skipped for good.
fc /b requirements.txt ".venv\.requirements.installed" >nul 2>&1
if not errorlevel 1 goto venv_ready

echo        Installing dependencies (takes 1-3 minutes the first time)...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo    ERROR: pip install failed.
  echo    Check your internet connection, and that Python is 3.10 to 3.12.
  echo.
  call :hold
  exit /b 1
)
copy /y requirements.txt ".venv\.requirements.installed" >nul
echo        Setup complete.
goto venv_done

:venv_ready
echo        Found .venv - reusing it.
call .venv\Scripts\activate.bat

:venv_done
echo.

REM --- Step 3: launch -----------------------------------------
REM (serve.py prints the address itself: the port is not always the same one)
echo  [3/4] Starting the local server...
echo.

if not defined SRC (
  python serve.py
) else (
  python serve.py --open "%SRC%"
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
  call :hold
)
exit /b %EXITCODE%


REM ============================================================
REM Subroutines
REM ============================================================

:hold
REM Keeps the window open so that a message can be read. Started without a
REM window (start_hidden.vbs sets MESHOPTIMISER_HIDDEN) nobody could press the
REM key, and the launcher would sit there for good: then it is skipped, and
REM start_hidden.vbs reports the failure from the exit code.
if not defined MESHOPTIMISER_HIDDEN pause
exit /b 0


:find_python
REM Sets PY to a command that starts a supported Python (3.10 to 3.12). When
REM the only Python found is some other version, PYBAD is that version.
set "PY="
set "PYBAD="
REM The py launcher starts a version by number. Newest supported one first,
REM so 3.12 is used even where a newer Python is installed as well.
for %%V in (3.12 3.11 3.10) do (
  if not defined PY (
    py -%%V --version >nul 2>nul
    if not errorlevel 1 set "PY=py -%%V"
  )
)
if defined PY exit /b 0
call :try_python py -3
if defined PY exit /b 0
REM `python` on PATH, unless all there is is the Microsoft Store stub: that
REM one lives in WindowsApps, is found by `where python`, and does not run
REM anything (newer builds even answer --version with exit code 0).
set "REALPY="
for /f "delims=" %%P in ('where python 2^>nul') do (
  echo "%%P" | findstr /i "WindowsApps" >nul
  if errorlevel 1 set "REALPY=1"
)
if defined REALPY call :try_python python
if defined PY exit /b 0
call :try_python python3
if defined PY exit /b 0
exit /b 1


:try_python
REM %* is a command that starts Python. PY becomes that command when it runs
REM a supported version; when it runs another version, PYBAD is that version.
%* --version >nul 2>nul
if errorlevel 1 exit /b 1
%* -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)" >nul 2>nul
if not errorlevel 1 (
  set "PY=%*"
  exit /b 0
)
for /f "tokens=2" %%v in ('%* --version 2^>nul') do set "PYBAD=%%v"
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
REM This window read its PATH before the installer ran, so the new Python is
REM not on it. The folders the installer uses are put in front of it here, the
REM way the installer does it for new windows (in front, so that `python` is
REM not the Microsoft Store stub). PATH used to be rebuilt from the registry at
REM this point: the value stored there names the Windows folder by a variable
REM that is not expanded when it is read back, so this window lost System32,
REM and with it where, findstr, fc and choice.
set "PATH=%LocalAppData%\Programs\Python\Launcher;%LocalAppData%\Programs\Python\Python312;%LocalAppData%\Programs\Python\Python312\Scripts;%ProgramFiles%\Python312;%ProgramFiles%\Python312\Scripts;%PATH%"
exit /b 0
