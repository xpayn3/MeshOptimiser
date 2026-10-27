# MeshOptimiser installer for Windows: one file, one double-click.
#   Install MeshOptimiser.bat   (or: irm https://xpayn3.github.io/MeshOptimiser/install.ps1 | iex)
# Downloads the current release, puts it in %LOCALAPPDATA%\MeshOptimiser, adds MeshOptimiser to the Desktop and the Start menu,
# and starts it. Running it again updates the files and keeps the Python environment (.venv), the inbox and the exports.
# The install folder holds thin launchers and an app\ folder with the program (and its .venv, inbox and exports). An install from
# before that layout (everything loose in the folder) is moved over: inbox and exports go into app\, the old loose files go to
# .update\backup-old-layout\ (nothing is deleted but the old .venv, which cannot be moved: start.bat builds a new one in app\).
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
$Feed = 'https://xpayn3.github.io/MeshOptimiser/latest.json'
$Repo = 'xpayn3/MeshOptimiser'
$Skip = @('.venv', 'inbox', 'exports', '__pycache__', '.update', 'server.log', 'server.log.1', '.show-console')      # belong to this PC: an update leaves them alone (in app\ too)
$NotShipped = @('tests', 'tools', 'docs', 'site', 'dist', '_archive', '.github', '.claude', 'CHANGELOG.md', 'UNRELEASED_FIXES.md', '.gitignore', '.gitattributes')      # in a source archive, not in the release zip
$Launchers = @('start.bat', 'start_hidden.vbs', 'start.command', 'start.ico', 'Install MeshOptimiser.bat', 'README.md', 'README.txt', 'LICENSE')      # the files of the install folder itself

# ── the window: colour codes (the console is switched to understand them), a title, no blinking cursor ──
$esc = [char]27
$vt = $false
try {
  Add-Type -Namespace MO -Name K -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n); [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out int m); [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, int m);' -ErrorAction Stop
  $h = [MO.K]::GetStdHandle(-11); $m = 0
  if ([Environment]::OSVersion.Version.Build -ge 15063 -and [MO.K]::GetConsoleMode($h, [ref]$m)) { $vt = [MO.K]::SetConsoleMode($h, $m -bor 4) }      # (the full colour codes need Windows 10 1703 or newer; the console of an older build prints parts of them as text)
} catch {}
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.WindowTitle = 'MeshOptimiser installer' } catch {}
function C($rgb) { if ($vt) { "$esc[38;2;$rgb`m" } else { '' } }
$R = if ($vt) { "$esc[0m" } else { '' }
$ACC = C '13;153;255'; $OK = C '88;214;141'; $DIM = C '110;110;118'; $TXT = C '230;230;235'; $ERR = C '255;99;99'; $BAR0 = C '52;52;58'
# Windows Script Host can be switched off (a work or locked-down PC): then wscript.exe cannot run start_hidden.vbs, and the shortcut and the first start use
# app\start_hidden.ps1 instead, which does the same through PowerShell.
function Test-Wsh {
  foreach ($k in 'HKCU:\Software\Microsoft\Windows Script Host\Settings', 'HKLM:\Software\Microsoft\Windows Script Host\Settings') {
    try { if ((Get-ItemProperty -Path $k -Name Enabled -ErrorAction Stop).Enabled -eq 0) { return $false } } catch {}
  }
  return [bool](Test-Path (Join-Path $env:WINDIR 'System32\wscript.exe'))
}
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
    if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$') { Fail 'The update feed named a version this installer does not understand.' }
    $inst = $feed.stable.installer      # the full download's own address, SHA-256 and size (newer feeds carry it; tools/app/build-update.py --installer)
    Good "Version $version"
  } elseif (-not (Test-Path $zipPath)) { Fail "The zip was not found: $zipPath" }
  else { Good "Using $zipPath" }

  # 2. download, with a bar
  Step 2 'Downloading'
  if (-not $zipPath) {
    $zipPath = Join-Path $tmp 'app.zip'
    # the release zip first (the program and nothing else); the source archive of the tag when there is none
    $urls = @("https://github.com/$Repo/releases/download/v$version/MeshOptimiser-v$version.zip", "https://github.com/$Repo/archive/refs/tags/v$version.zip")
    # a feed that publishes the download's checksum: only that file is used, and it is checked before anything is unpacked
    $wantSha = ''
    if ($inst -and $inst.sha256 -and $inst.url -and ([string]$inst.url).StartsWith("https://github.com/$Repo/releases/download/")) { $urls = @([string]$inst.url); $wantSha = ([string]$inst.sha256).ToLower() }
    $fetched = $false
    foreach ($url in $urls) {
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
        $fetched = $true; break
      } catch { try { $out.Close() } catch {}; try { $cli.Dispose() } catch {} }
    }
    if (-not $fetched) { Line ''; Fail "The download failed. Check your internet connection and try again." }
    if ($wantSha) {
      $gotSha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower()
      if ($gotSha -ne $wantSha) { Line ''; Fail 'The download does not match its checksum, so it was not used. Nothing was changed. Try again, or download it from the website.' }
      Good 'Checksum matches'
    } else { Note 'This release has no published checksum, so the download could not be checked.' }
  } else { Note 'Skipped.' }

  # 3. unpack straight into place, with a bar (the folder named in the zip is dropped; the PC's own folders are left alone)
  Step 3 "Installing to $InstallDir"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $arc = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $norm = { param($e) $e.FullName.Replace('\', '/') }      # (some zip tools write backslashes)
    $entries = @($arc.Entries | Where-Object { (& $norm $_) -notmatch '/$' })
    $names = @($entries | ForEach-Object { & $norm $_ })
    # one folder around everything (a source archive: MeshOptimiser-0.30.0/...) is dropped; files at the root of the zip are taken as they are
    $tops = @($names | ForEach-Object { ($_ -split '/')[0] } | Select-Object -Unique)
    $prefix = if ($tops.Count -eq 1 -and $names[0] -match '/') { $tops[0] + '/' } else { '' }
    if (($names -notcontains ($prefix + 'start.bat')) -or ($names -notcontains ($prefix + 'app/serve.py'))) { Line ''; Fail 'The download does not look like MeshOptimiser (no start.bat or app\serve.py inside).' }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

    # MeshOptimiser still running from this folder holds its Python runtime open (python312.dll): the copy would stop half-way,
    # after an old .venv had already gone. Ask for it to be closed first, before anything is touched.
    $full = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and $_.Path.StartsWith($full, [StringComparison]::OrdinalIgnoreCase) } catch { $false } })
    if ($running.Count) { Line ''; Fail 'MeshOptimiser is running from this folder. Close its window (and the console, if it shows one), then run this again.' }

    # an install from before the app\ folder: everything loose in the folder. Move what belongs to this PC, put the rest aside.
    $oldLayout = (Test-Path (Join-Path $InstallDir 'serve.py')) -and -not (Test-Path (Join-Path $InstallDir 'app\serve.py'))
    if ($oldLayout) {
      Line ''; Note 'An older install was found: moving it into the new layout.'
      $appDir = Join-Path $InstallDir 'app'
      New-Item -ItemType Directory -Path $appDir -Force | Out-Null
      foreach ($keep in @('inbox', 'exports', '.show-console')) {
        $from = Join-Path $InstallDir $keep; $to = Join-Path $appDir $keep
        if (-not (Test-Path $from)) { continue }
        try {
          if ((Test-Path $to) -and (Get-Item $from).PSIsContainer) {
            Get-ChildItem $from -Force | ForEach-Object { if (-not (Test-Path (Join-Path $to $_.Name))) { Move-Item -LiteralPath $_.FullName -Destination $to } }
            Remove-Item $from -Force -ErrorAction SilentlyContinue
          } elseif (-not (Test-Path $to)) { Move-Item -LiteralPath $from -Destination $to }
        } catch { Line ''; Fail "Could not move $keep into app\ ($($_.Exception.Message)). Close MeshOptimiser and run this again." }
      }
      # a Python environment cannot be moved (its paths are written into it): the old one goes, start.bat builds a new one in app\
      $venv = Join-Path $InstallDir '.venv'
      if (Test-Path $venv) {
        try { Remove-Item -LiteralPath $venv -Recurse -Force } catch { Line ''; Fail 'Could not remove the old Python environment (.venv). Close MeshOptimiser and run this again.' }
      }
      # the loose files of the old layout are kept in .update\backup-old-layout (the launchers are replaced by the new ones)
      $bk = Join-Path $InstallDir '.update\backup-old-layout'
      if (Test-Path $bk) { $bk = $bk + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
      New-Item -ItemType Directory -Path $bk -Force | Out-Null
      $stay = @('app', '.update') + $Launchers
      $moved = 0
      foreach ($it in @(Get-ChildItem $InstallDir -Force | Where-Object { $stay -notcontains $_.Name })) {
        try { Move-Item -LiteralPath $it.FullName -Destination $bk; $moved++ } catch { Line ''; Fail "Could not move $($it.Name) aside ($($_.Exception.Message)). Close MeshOptimiser and run this again." }
      }
      Good "$moved old items put in .update\backup-old-layout"
      Note 'The Python environment is rebuilt in app\ on the first start (a few minutes, online).'
    }
    $i = 0; $last = [datetime]::MinValue; $root = [IO.Path]::GetFullPath($InstallDir); $rootSep = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($e in $entries) {
      $i++
      $nm = & $norm $e
      $rel = if ($prefix -and $nm.StartsWith($prefix)) { $nm.Substring($prefix.Length) } else { $nm }
      $parts = $rel -split '/'
      if (($NotShipped -contains $parts[0]) -or ($Skip -contains $parts[0])) { continue }
      if ($parts[0] -eq 'app' -and $parts.Count -gt 2 -and ($Skip -contains $parts[1])) { continue }
      $dest = [IO.Path]::GetFullPath((Join-Path $InstallDir $rel))
      if ($parts -contains '..') { continue }
      if (-not $dest.StartsWith($rootSep, [StringComparison]::OrdinalIgnoreCase)) { continue }      # nothing may land outside the install folder (the separator keeps a sibling like MeshOptimiser-x out)
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($dest)) -Force | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
      if (((Get-Date) - $last).TotalMilliseconds -gt 60) { $last = Get-Date; Bar ($i / $entries.Count) "$i of $($entries.Count) files" }
    }
    Done-Bar "$($entries.Count) files"
    # The in-app updater's backup and its unconfirmed-update marker belong to the version that was here before: kept, a later
    # "Restore the earlier version" (or a start that thinks an update failed) would copy those old files over this one.
    foreach ($stale in @('app\.update\backup', 'app\.update\pending.json')) {
      $p = Join-Path $InstallDir $stale
      if (Test-Path -LiteralPath $p) { try { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop } catch { Note "Could not clear $stale; the app refuses to use it anyway." } }
    }
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
          $sig = Get-AuthenticodeSignature -FilePath $cs      # only a file signed by Google is run
          if ($sig.Status -ne 'Valid' -or -not $sig.SignerCertificate -or $sig.SignerCertificate.Subject -notmatch 'O=Google LLC') { throw 'The Chrome installer is not signed by Google.' }
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
    $ps1 = Join-Path $InstallDir 'app\start_hidden.ps1'; $wsh = Test-Wsh; $psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $ico = Join-Path $InstallDir 'start.ico'
    foreach ($pair in @(@('Desktop', [Environment]::GetFolderPath('Desktop')), @('Start menu', [Environment]::GetFolderPath('Programs')))) {
      $dir = $pair[1]
      if (-not $dir -or -not (Test-Path $dir)) { continue }
      $lnk = $sh.CreateShortcut((Join-Path $dir 'MeshOptimiser.lnk'))
      if ($wsh) { $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'; $lnk.Arguments = '"' + $vbs + '"' }
      else { $lnk.TargetPath = $psExe; $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ps1 + '"'; $lnk.WindowStyle = 7 }
      $lnk.WorkingDirectory = $InstallDir
      if (Test-Path $ico) { $lnk.IconLocation = $ico }
      $lnk.Description = 'MeshOptimiser'
      $lnk.Save()
      Good $pair[0]
    }
    # "Open with" in Explorer: MeshOptimiser is added to the list for the model files it reads (a choice, never the default program)
    try {
      $ft = Join-Path $InstallDir 'app\file-types.ps1'
      if (Test-Path $ft) { [void](& $ft -Register -Launcher (Join-Path $InstallDir 'app\start_hidden.vbs')); Good 'Open with (model files)' }
    } catch { Note 'Could not add it to Explorer''s Open with list.' }
  } else { Note 'Skipped.' }

  Line ''
  Line ("  $OK$([char]0x2501)$([char]0x2501)$([char]0x2501)$R  $TXT MeshOptimiser is installed.$R")
  if (-not $NoLaunch) {
    Note 'Starting it now. The first start sets up Python and the CAD reader, which takes a few minutes'
    Note 'and shows its progress in a window. Every start after that takes a second or two, with no window.'
    # through start_hidden.vbs: with no .venv yet it shows the window (the setup is long and asks questions); once set up it shows none
    if (Test-Wsh) { Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $InstallDir 'start_hidden.vbs') + '"') -WorkingDirectory $InstallDir }
    else { Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $InstallDir 'app\start_hidden.ps1') + '"') -WorkingDirectory $InstallDir -WindowStyle Hidden }
    Start-Sleep -Seconds 4
  } else { Note "Start it with $InstallDir\start.bat" }
  Line ''
}
finally {
  Show-Cursor
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
