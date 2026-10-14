# MeshOptimiser installer for Windows: one file, one double-click.
#   Install MeshOptimiser.bat   (or: irm https://lukagrcar.com/apps/meshoptimiser/install.ps1 | iex)
# Downloads the current release, puts it in %LOCALAPPDATA%\MeshOptimiser, adds MeshOptimiser to the Desktop and the Start menu,
# and starts it. Running it again updates the files and keeps the Python environment (.venv), the inbox and the exports.
# Options (when run as a file):  -InstallDir <folder>   -Zip <a release zip already on this PC>   -NoLaunch   -NoShortcuts
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'MeshOptimiser'),
  [string]$Zip = '',
  [switch]$NoLaunch,
  [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Feed = 'https://lukagrcar.com/apps/meshoptimiser/latest.json'
$Repo = 'xpayn3/MeshOptimiser'
$Skip = @('.venv', 'inbox', 'exports', '__pycache__')      # belong to this PC: an update leaves them alone

# ── the window: colour codes (the console is switched to understand them), a title, no blinking cursor ──
$esc = [char]27
$vt = $false
try {
  Add-Type -Namespace MO -Name K -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n); [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out int m); [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, int m);' -ErrorAction Stop
  $h = [MO.K]::GetStdHandle(-11); $m = 0
  if ([MO.K]::GetConsoleMode($h, [ref]$m)) { $vt = [MO.K]::SetConsoleMode($h, $m -bor 4) }
} catch {}
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.WindowTitle = 'MeshOptimiser installer' } catch {}
function C($rgb) { if ($vt) { "$esc[38;2;$rgb`m" } else { '' } }
$R = if ($vt) { "$esc[0m" } else { '' }
$ACC = C '13;153;255'; $OK = C '88;214;141'; $DIM = C '110;110;118'; $TXT = C '230;230;235'; $ERR = C '255;99;99'; $BAR0 = C '52;52;58'
function Hide-Cursor { if ($vt) { [Console]::Write("$esc[?25l") } }
function Show-Cursor { if ($vt) { [Console]::Write("$esc[?25h") } }
function Out($s) { [Console]::Write($s) }
function Line($s = '') { [Console]::WriteLine($s) }

function Bar([double]$p, [string]$tail = '') {
  # one line, redrawn in place: ██████░░░░░░  52%  tail
  $w = 34; $p = [Math]::Max(0, [Math]::Min(1, $p)); $n = [int][Math]::Round($p * $w)
  $line = "    $ACC" + ([string][char]0x2588 * $n) + "$BAR0" + ([string][char]0x2591 * ($w - $n)) + "$R  $TXT" + ('{0,3}%' -f [int]($p * 100)) + "$R  $DIM$tail$R"
  Out("`r$line" + $(if ($vt) { "$esc[K" } else { '' }))
}
function Done-Bar([string]$tail = '') { Bar 1 $tail; Line '' }

function Step([int]$n, [string]$m) { Line ''; Line ("  $ACC$n/5$R  $TXT$m$R") }
function Good([string]$m) { Line ("    $OK$([char]0x2713)$R $DIM$m$R") }
function Note([string]$m) { Line ("    $DIM$m$R") }
function Fail([string]$m) {
  Show-Cursor; Line ''; Line ("  $ERR$([char]0x2717)  $m$R"); Line ''
  if (-not $NoLaunch) { [void](Read-Host '  Press Enter to close') }
  exit 1
}

# ── the logo: the part of a mesh, in the accent blue ──
function Logo {
  $a = $ACC; $d = $DIM
  Line ''
  Line ("      $a   ____$R")
  Line ("      $a  /\    \$R       $TXT MeshOptimiser$R")
  Line ("      $a /  \____\$R      $DIM installer for Windows$R")
  Line ("      $a \  /    /$R")
  Line ("      $a  \/____/$R")
  Line ''
}

Hide-Cursor
Clear-Host
Logo

$tmp = Join-Path $env:TEMP ('meshoptimiser-install-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  # 1. which release
  Step 1 'Finding the current version'
  $zipPath = $Zip
  $version = ''
  if (-not $zipPath) {
    try { $feed = Invoke-RestMethod -UseBasicParsing -Uri $Feed } catch { Fail "Could not reach the update feed. Check your internet connection and try again." }
    $version = $feed.stable.version
    if (-not $version) { Fail 'The update feed did not name a version.' }
    Good "Version $version"
  } elseif (-not (Test-Path $zipPath)) { Fail "The zip was not found: $zipPath" }
  else { Good "Using $zipPath" }

  # 2. download, with a bar
  Step 2 'Downloading'
  if (-not $zipPath) {
    $url = "https://github.com/$Repo/archive/refs/tags/v$version.zip"
    $zipPath = Join-Path $tmp 'app.zip'
    try {
      Add-Type -AssemblyName System.Net.Http
      $cli = New-Object System.Net.Http.HttpClient
      $resp = $cli.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      [void]$resp.EnsureSuccessStatusCode()
      $total = $resp.Content.Headers.ContentLength
      $in = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      $out = [IO.File]::Create($zipPath)
      $buf = New-Object byte[] 262144; $got = 0; $t0 = Get-Date; $last = [datetime]::MinValue
      while (($r = $in.Read($buf, 0, $buf.Length)) -gt 0) {
        $out.Write($buf, 0, $r); $got += $r
        if (((Get-Date) - $last).TotalMilliseconds -gt 80) {
          $last = Get-Date
          $sec = [Math]::Max(0.2, ((Get-Date) - $t0).TotalSeconds)
          $tail = ('{0:N1}' -f ($got / 1MB)) + $(if ($total) { ' / ' + ('{0:N1}' -f ($total / 1MB)) } else { '' }) + (' MB   {0:N1} MB/s' -f (($got / 1MB) / $sec))
          Bar $(if ($total) { $got / $total } else { 0 }) $tail
        }
      }
      $out.Close(); $in.Close(); $cli.Dispose()
      Done-Bar (('{0:N1}' -f ($got / 1MB)) + ' MB')
    } catch { Line ''; Fail "The download failed. Check your internet connection and try again." }
  } else { Note 'Skipped.' }

  # 3. unpack straight into place, with a bar (the folder named in the zip is dropped; the PC's own folders are left alone)
  Step 3 "Installing to $InstallDir"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $arc = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $norm = { param($e) $e.FullName.Replace('\', '/') }      # (some zip tools write backslashes)
    $entries = @($arc.Entries | Where-Object { (& $norm $_) -notmatch '/$' })
    $first = & $norm ($arc.Entries | Select-Object -First 1)
    $prefix = if ($first -match '^([^/]+)/') { $Matches[1] + '/' } else { '' }
    if (-not ($entries | Where-Object { (& $norm $_) -eq ($prefix + 'start.bat') })) { Line ''; Fail 'The download does not look like MeshOptimiser (no start.bat inside).' }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $i = 0; $last = [datetime]::MinValue; $root = [IO.Path]::GetFullPath($InstallDir)
    foreach ($e in $entries) {
      $i++
      $nm = & $norm $e
      $rel = if ($prefix -and $nm.StartsWith($prefix)) { $nm.Substring($prefix.Length) } else { $nm }
      $top = ($rel -split '/')[0]
      if ($Skip -contains $top) { continue }
      $dest = [IO.Path]::GetFullPath((Join-Path $InstallDir $rel))
      if (-not $dest.StartsWith($root)) { continue }      # nothing may land outside the install folder
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($dest)) -Force | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
      if (((Get-Date) - $last).TotalMilliseconds -gt 60) { $last = Get-Date; Bar ($i / $entries.Count) "$i of $($entries.Count) files" }
    }
    Done-Bar "$($entries.Count) files"
  } finally { $arc.Dispose() }

  # 4. a browser for the app's own window (Chrome is the best: its graphics are what MeshOptimiser is made for)
  Step 4 'Checking for Chrome'
  function Find-Chrome {
    foreach ($p in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) { if ($p -and (Test-Path $p)) { return $p } }
    foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')) {
      try { $v = (Get-ItemProperty $k -ErrorAction Stop).'(default)'; if ($v -and (Test-Path $v)) { return $v } } catch {}
    }
    return $null
  }
  if (Find-Chrome) { Good 'Chrome is installed' }
  elseif ($NoLaunch) { Note 'Chrome is not installed. Edge or Brave will do; Chrome is the best.' }
  else {
    Note 'Chrome is not on this PC. MeshOptimiser opens in its own window through Chrome (Edge or Brave work too).'
    $ans = Read-Host '    Install Chrome now? It is free and takes about a minute [Y/n]'
    if ($ans -eq '' -or $ans -match '^[yY]') {
      $done = $false
      if (Get-Command winget -ErrorAction SilentlyContinue) {
        Note 'Installing Chrome (winget)...'
        & winget install -e --id Google.Chrome --silent --accept-source-agreements --accept-package-agreements | Out-Null
        $done = [bool](Find-Chrome)
      }
      if (-not $done) {
        try {
          Note 'Downloading Chrome from google.com...'
          $cs = Join-Path $tmp 'ChromeSetup.exe'
          Invoke-WebRequest -UseBasicParsing -Uri 'https://dl.google.com/chrome/install/ChromeStandaloneSetup64.exe' -OutFile $cs
          Start-Process -FilePath $cs -ArgumentList '/silent', '/install' -Wait
          $done = [bool](Find-Chrome)
        } catch {}
      }
      if ($done) { Good 'Chrome is installed' } else { Note 'Chrome could not be installed here. Get it from https://www.google.com/chrome and run this again, or carry on with Edge.' }
    } else { Note 'Skipped. MeshOptimiser will use Edge or Brave if one is there.' }
  }

  # 5. shortcuts
  Step 5 'Adding MeshOptimiser to the Desktop and the Start menu'
  if (-not $NoShortcuts) {
    $sh = New-Object -ComObject WScript.Shell
    $vbs = Join-Path $InstallDir 'start_hidden.vbs'
    $ico = Join-Path $InstallDir 'start.ico'
    foreach ($pair in @(@('Desktop', [Environment]::GetFolderPath('Desktop')), @('Start menu', [Environment]::GetFolderPath('Programs')))) {
      $dir = $pair[1]
      if (-not $dir -or -not (Test-Path $dir)) { continue }
      $lnk = $sh.CreateShortcut((Join-Path $dir 'MeshOptimiser.lnk'))
      $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
      $lnk.Arguments = '"' + $vbs + '"'
      $lnk.WorkingDirectory = $InstallDir
      if (Test-Path $ico) { $lnk.IconLocation = $ico }
      $lnk.Description = 'MeshOptimiser'
      $lnk.Save()
      Good $pair[0]
    }
  } else { Note 'Skipped.' }

  Line ''
  Line ("  $OK$([char]0x2501)$([char]0x2501)$([char]0x2501)$R  $TXT MeshOptimiser is installed.$R")
  if (-not $NoLaunch) {
    Note 'Starting it now. The first start sets up Python and the CAD reader, which takes a few minutes'
    Note 'and shows its progress in a window. Every start after that takes a second or two, with no window.'
    # through start_hidden.vbs: with no .venv yet it shows the window (the setup is long and asks questions); once set up it shows none
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $InstallDir 'start_hidden.vbs') + '"') -WorkingDirectory $InstallDir
    Start-Sleep -Seconds 4
  } else { Note "Start it with $InstallDir\start.bat" }
  Line ''
}
finally {
  Show-Cursor
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
