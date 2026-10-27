# The same job as start_hidden.vbs, for a PC where Windows Script Host is switched off (a work PC, a locked-down one): wscript.exe cannot
# run the .vbs there, so the shortcut and the installer start this instead. Launches start.bat with no console window.
#  - the first run (no .venv yet), which asks questions and takes minutes, gets an ordinary window;
#  - a hidden run tells start.bat that it is hidden (MESHOPTIMISER_HIDDEN), so it never waits for a key press; a failure is reported from its exit code.
param([string]$File = '')      # a file handed over by "Open with" in Explorer: start.bat opens it
$dir = $PSScriptRoot
$bat = Join-Path $dir 'start.bat'
Set-Location $dir
if (-not ((Test-Path (Join-Path $dir '.venv\Scripts\python.exe')) -or (Test-Path (Join-Path $dir 'runtime\python.exe'))) -or (Test-Path (Join-Path $dir '.show-console'))) {
  if ($File) { Start-Process -FilePath $bat -ArgumentList ('"' + $File + '"') -WorkingDirectory $dir } else { Start-Process -FilePath $bat -WorkingDirectory $dir }
} else {
  $env:MESHOPTIMISER_HIDDEN = '1'
  $p = if ($File) { Start-Process -FilePath $bat -ArgumentList ('"' + $File + '"') -WorkingDirectory $dir -WindowStyle Hidden -PassThru -Wait } else { Start-Process -FilePath $bat -WorkingDirectory $dir -WindowStyle Hidden -PassThru -Wait }
  if ($p.ExitCode -ne 0) {
    try {
      Add-Type -AssemblyName PresentationFramework
      [void][System.Windows.MessageBox]::Show("MeshOptimiser stopped with an error (code $($p.ExitCode)).`n`nDouble-click start.bat to see what went wrong.", 'MeshOptimiser', 'OK', 'Warning')
    } catch {}
  }
}
