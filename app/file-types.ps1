# Puts MeshOptimiser in Explorer's "Open with" list for the model files it reads (and takes it out again).
#   powershell -File file-types.ps1 -Register   -Launcher "<install folder>\app\start_hidden.vbs"
#   powershell -File file-types.ps1 -Unregister
# Only the current user's registry is touched (HKCU\Software\Classes, no administrator needed), and MeshOptimiser is added as a choice:
# it never becomes the default program for a file type. To make it the default, use Explorer: right-click a file > Open with > Choose
# another app > MeshOptimiser > Always. -Root is for tests (another registry key to write into).
param(
  [switch]$Register,
  [switch]$Unregister,
  [string]$Launcher = '',
  [string]$Root = 'HKCU:\Software\Classes'
)
$ErrorActionPreference = 'Stop'
$ProgId = 'MeshOptimiser.Model'
$Exts = '.glb', '.gltf', '.obj', '.fbx', '.stl', '.3mf', '.usd', '.usda', '.usdc', '.usdz', '.dae', '.step', '.stp', '.iges', '.igs', '.brep', '.brp'

function Test-Wsh {
  foreach ($k in 'HKCU:\Software\Microsoft\Windows Script Host\Settings', 'HKLM:\Software\Microsoft\Windows Script Host\Settings') {
    try { if ((Get-ItemProperty -Path $k -Name Enabled -ErrorAction Stop).Enabled -eq 0) { return $false } } catch {}
  }
  return [bool](Test-Path (Join-Path $env:WINDIR 'System32\wscript.exe'))
}

if ($Unregister) {
  foreach ($e in $Exts) { Remove-ItemProperty -Path (Join-Path $Root "$e\OpenWithProgids") -Name $ProgId -ErrorAction SilentlyContinue }
  Remove-Item -Path (Join-Path $Root $ProgId) -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output 'MeshOptimiser is no longer listed under Open with.'
  return
}
if (-not $Register) { Write-Output 'Use -Register -Launcher <start_hidden.vbs> or -Unregister.'; return }
if (-not $Launcher -or -not (Test-Path $Launcher)) { throw "The launcher was not found: $Launcher" }
$Launcher = (Resolve-Path $Launcher).Path
$dir = Split-Path $Launcher -Parent                      # (the app folder: its start_hidden.vbs takes the file, so the launchers of the install folder stay as they are)
$ico = Join-Path (Split-Path $dir -Parent) 'start.ico'
$ps1 = Join-Path $dir 'start_hidden.ps1'
if (Test-Wsh) { $cmd = '"' + (Join-Path $env:WINDIR 'System32\wscript.exe') + '" "' + $Launcher + '" "%1"' }
else { $cmd = '"' + (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ps1 + '" "%1"' }

$k = Join-Path $Root $ProgId
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name '(default)' -Value '3D model'
Set-ItemProperty -Path $k -Name 'FriendlyTypeName' -Value 'MeshOptimiser model'
if (Test-Path $ico) { New-Item -Path "$k\DefaultIcon" -Force | Out-Null; Set-ItemProperty -Path "$k\DefaultIcon" -Name '(default)' -Value ('"' + $ico + '"') }
New-Item -Path "$k\shell\open" -Force | Out-Null
Set-ItemProperty -Path "$k\shell\open" -Name '(default)' -Value 'Open with MeshOptimiser'
if (Test-Path $ico) { Set-ItemProperty -Path "$k\shell\open" -Name 'Icon' -Value ('"' + $ico + '"') }
New-Item -Path "$k\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$k\shell\open\command" -Name '(default)' -Value $cmd
foreach ($e in $Exts) {
  $p = Join-Path $Root "$e\OpenWithProgids"
  New-Item -Path $p -Force | Out-Null
  New-ItemProperty -Path $p -Name $ProgId -Value '' -PropertyType String -Force | Out-Null
}
Write-Output ("MeshOptimiser is listed under Open with for " + ($Exts -join ' ') + '.')
