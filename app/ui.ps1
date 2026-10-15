# Looks for start.bat: an animated banner, a short status panel, check marks and a scanner bar that
# wraps a long command. Purely cosmetic: start.bat works without this file (it
# falls back to plain text), so nothing here may be needed to start the app.
#   ui.ps1 banner
#   ui.ps1 kv   "File"            (the value is in $env:UI_VAL)
#   ui.ps1 step "Python 3.12.10"
#   ui.ps1 run  "Installing dependencies"      (the command is in $env:UI_CMD)
# Only characters every console font has (blocks, box lines, a square, the multiplication sign), so it looks the same in
# Windows Terminal and in the old console, started from a shortcut or from a window.
param([string]$Mode = 'step', [string]$Label = '')
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

# Turn on colour codes in older consoles (Windows Terminal already has them).
try {
  Add-Type -Name W -Namespace M -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n); [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out int m); [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, int m);'
  $h = [M.W]::GetStdHandle(-11); $m = 0
  [void][M.W]::GetConsoleMode($h, [ref]$m); [void][M.W]::SetConsoleMode($h, $m -bor 4)
} catch {}

$E = [char]27
$RST = "$E[0m"
$OK = [string][char]0x25A0; $BAD = [string][char]0xD7; $RULE = [string][char]0x2501
$RAIL = [string][char]0x2500; $FULL = [string][char]0x2588; $DK = [string][char]0x2593; $MD = [string][char]0x2592; $LT = [string][char]0x2591
function Rgb($r, $g, $b) { "$E[38;2;$([int]$r);$([int]$g);$([int]$b)m" }
function Mix($a, $b, $t) { [int]($a + ($b - $a) * $t) }
$AC = 13, 153, 255                     # the site's blue
$DIM = Rgb 110 110 110
$TXT = Rgb 225 225 228
$GREEN = Rgb 70 200 120
$cols = 78
try { $cols = [Console]::WindowWidth - 1 } catch {}
function Sleep-Ms($n) { Start-Sleep -Milliseconds $n }
function Hide { Write-Host -NoNewline "$E[?25l" }
function Show { Write-Host -NoNewline "$E[?25h" }

# A bar with a bright head that runs to and fro and leaves a tail of the blue behind it: the one sign of "working" for every step.
function Scan($i, $w) {
  $span = $w - 1; $cycle = 2 * $span
  $pos = $i % $cycle; $dir = 1
  if ($pos -gt $span) { $pos = $cycle - $pos; $dir = -1 }
  $s = ''
  for ($j = 0; $j -lt $w; $j++) {
    $d = ($pos - $j) * $dir
    if ($d -eq 0) { $s += (Rgb 170 220 255) + $FULL }
    elseif ($d -eq 1) { $s += (Rgb 90 185 255) + $DK }
    elseif ($d -eq 2) { $s += (Rgb 40 150 245) + $MD }
    elseif ($d -eq 3) { $s += (Rgb 25 100 190) + $LT }
    else { $s += (Rgb 52 52 58) + $RAIL }
  }
  $s + $RST
}

# The name, drawn in a thin line font. It starts as a dense wire lattice (a mesh); the lattice thins out as if it were being decimated while
# each letter scrambles out of the noise and locks in, left to right, white-hot, cooling to its colour; a bright band then sweeps over the word.
# Frames follow the clock, so a slow console drops frames instead of running long. Sets $script:WordW to the width it took.
function Show-Word {
  $rows = 3
  $d = @{ tl = [string][char]0x2554; tr = [string][char]0x2557; bl = [string][char]0x255A; br = [string][char]0x255D; h = [string][char]0x2550; v = [string][char]0x2551
          td = [string][char]0x2566; tu = [string][char]0x2569; tv = [string][char]0x2560; tx = [string][char]0x2563 }
  $glyph = @{
    M = ($d.tl + $d.td + $d.tr), ($d.v + $d.v + $d.v), ($d.tu + ' ' + $d.tu)
    E = ($d.tl + $d.h + $d.tr), ($d.v + $d.tx + ' '), ($d.bl + $d.h + $d.br)
    S = ($d.tl + $d.h + $d.tr), ($d.bl + $d.h + $d.tr), ($d.bl + $d.h + $d.br)
    H = ($d.td + ' ' + $d.td), ($d.tv + $d.h + $d.tx), ($d.tu + ' ' + $d.tu)
    O = ($d.tl + $d.h + $d.tr), ($d.v + ' ' + $d.v), ($d.bl + $d.h + $d.br)
    P = ($d.tl + $d.h + $d.tr), ($d.tv + $d.h + $d.br), ($d.tu + '  ')
    T = ($d.tl + $d.td + $d.tr), (' ' + $d.v + ' '), (' ' + $d.tu + ' ')
    I = $d.td, $d.v, $d.tu
    R = ($d.td + $d.h + $d.tr), ($d.tv + $d.td + $d.br), ($d.tu + $d.bl + $d.h)
  }
  # how wide: MESH, three spaces, OPTIMISER; a space between letters
  $words = @('MESH', 'OPTIMISER'); $gapW = 3
  $Wd = 0; foreach ($wrd in $words) { foreach ($ch in $wrd.ToCharArray()) { $Wd += $glyph[[string]$ch][0].Length + 1 } }; $Wd += $gapW - 1
  $script:WordW = $Wd
  $N = $rows * $Wd
  $fch = New-Object 'string[]' $N; $frev = New-Object 'double[]' $N; $ld = New-Object 'double[]' $N
  $fr = New-Object 'int[]' $N; $fg = New-Object 'int[]' $N; $fb = New-Object 'int[]' $N
  $x = 0
  for ($wi = 0; $wi -lt $words.Count; $wi++) {
    $wrd = $words[$wi]; $n = $wrd.Length
    for ($li = 0; $li -lt $n; $li++) {
      $gl = $glyph[[string]$wrd[$li]]
      if ($wi -eq 0) { $cr = 245; $cg = 247; $cb = 250 } else { $t = $li / [math]::Max(1, $n - 1); $cr = Mix 150 13 $t; $cg = Mix 215 153 $t; $cb = 255 }
      for ($gy = 0; $gy -lt 3; $gy++) {
        for ($gx = 0; $gx -lt $gl[$gy].Length; $gx++) {
          $c = $gl[$gy][$gx]
          if ($c -ne ' ') {
            $k = $gy * $Wd + $x + $gx
            $fch[$k] = [string]$c; $frev[$k] = 16 + ($x + $gx) * 0.55 + $gy * 1.6
            $fr[$k] = $cr; $fg[$k] = $cg; $fb[$k] = $cb
          }
        }
      }
      $x += $gl[0].Length + 1
    }
    $x += $gapW - 1
  }
  # when each piece of the lattice goes (a fixed run of numbers, so the animation is the same every time)
  $seed = 20261015
  for ($k = 0; $k -lt $N; $k++) { $seed = [long](($seed * 1103515245 + 12345) % 2147483648); $ld[$k] = 4 + ($seed % 31) }
  $noise = 0x253C, 0x256C, 0x256A, 0x256B, 0x2573, 0x2571, 0x2572, 0x252C, 0x2534, 0x251C, 0x2524, 0x2592, 0x2591 | ForEach-Object { [string][char]$_ }
  $lattice = [string][char]0x253C
  $flick = @((Rgb 205 232 255), (Rgb 95 175 255), (Rgb 60 125 225), (Rgb 150 205 255), (Rgb 45 95 185))
  $latC = Rgb 30 64 112

  $total = 74; $shimmerAt = 50
  function Px($rev, $cr, $cg, $cb, $x, $f) {
    $w = [math]::Max(0, 1 - ($f - $rev) / 6)
    if ($f -ge $shimmerAt) {
      $s = [math]::Max(0, 1 - [math]::Abs($x - (($f - $shimmerAt) * 4 - 10)) / 8) * 0.8
      if ($s -gt $w) { $w = $s }
    }
    $r = [int]([math]::Round(($cr + (255 - $cr) * $w) / 8) * 8); $g = [int]([math]::Round(($cg + (255 - $cg) * $w) / 8) * 8); $b = [int]([math]::Round(($cb + (255 - $cb) * $w) / 8) * 8)
    if ($r -gt 255) { $r = 255 }; if ($g -gt 255) { $g = 255 }; if ($b -gt 255) { $b = 255 }
    "$r;$g;$b"
  }

  Write-Host ("`n" * $rows) -NoNewline
  $sw = [Diagnostics.Stopwatch]::StartNew(); $lastF = -1
  while ($true) {
    $f = [int]($sw.ElapsedMilliseconds / 24)
    if ($f -gt $total) { $f = $total }
    if ($f -ne $lastF) {
      $lastF = $f
      $sb = New-Object Text.StringBuilder
      [void]$sb.Append("$E[${rows}A")
      for ($r = 0; $r -lt $rows; $r++) {
        [void]$sb.Append("`r  ")
        $prev = ''
        for ($x = 0; $x -lt $Wd; $x++) {
          $k = $r * $Wd + $x
          $fc = $fch[$k]
          if ($fc -and $f -ge $frev[$k]) {
            $seq = "$E[38;2;$(Px $frev[$k] $fr[$k] $fg[$k] $fb[$k] $x $f)m"
            $ch = $fc
          } elseif ($fc -and $f -ge $frev[$k] - 14) {
            $seq = $flick[($f * 3 + $k * 7) % 5]
            $ch = $noise[($f * 5 + $k * 11) % $noise.Count]
          } elseif ($f -lt $ld[$k]) {
            $seq = $latC; $ch = $lattice
          } else {
            if ($prev -ne 'sp') { [void]$sb.Append("$E[0m"); $prev = 'sp' }
            [void]$sb.Append(' ')
            continue
          }
          if ($seq -ne $prev) { [void]$sb.Append($seq); $prev = $seq }
          [void]$sb.Append($ch)
        }
        [void]$sb.Append("$E[0m`n")
      }
      [Console]::Out.Write($sb.ToString())
    }
    if ($f -ge $total) { break }
    Sleep-Ms 4
  }
}

try {
  Hide
  switch ($Mode) {

    'banner' {
      if ($cols -ge 58) { Show-Word } else {
        # a narrow window: the name alone, drawn in grey to blue, with one bright band over it
        $letters = ('MESHOPTIMISER'.ToCharArray() | ForEach-Object { [string]$_ }) -join ' '
        $n = $letters.Length
        Write-Host ''
        for ($i = 0; $i -lt $n; $i++) {
          $s = '  '
          for ($j = 0; $j -le $i; $j++) {
            $t = $j / [math]::Max(1, $n - 1)
            if ($j -eq $i) { $c = Rgb 255 255 255 } else { $c = Rgb (Mix 150 $AC[0] $t) (Mix 150 $AC[1] $t) (Mix 150 $AC[2] $t) }
            $s += $c + $letters[$j]
          }
          Write-Host -NoNewline "`r$s$RST"
          Sleep-Ms 28
        }
        Write-Host ''
      }
      # A rule grows under it.
      $w = [math]::Min($(if ($cols -ge 58) { $script:WordW } else { 50 }), $cols - 4)
      Write-Host -NoNewline '  '
      for ($i = 0; $i -lt $w; $i++) {
        $t = $i / [math]::Max(1, $w - 1)
        Write-Host -NoNewline ((Rgb (Mix $AC[0] 40 $t) (Mix $AC[1] 40 $t) (Mix $AC[2] 40 $t)) + $RULE)
        Sleep-Ms 4
      }
      Write-Host $RST
      # The version, typed in under the rule, with what the app is.
      $ver = ''
      try { $ver = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version } catch {}
      $pre = if ($ver) { 'version ' } else { '' }
      $line = $pre + $ver
      $tail = '   runs on this computer'
      $full = $line + $tail
      for ($i = 1; $i -le $full.Length; $i++) {
        $a = [math]::Min($i, $pre.Length); $b = [math]::Max(0, [math]::Min($i, $line.Length) - $pre.Length); $c = [math]::Max(0, $i - $line.Length)
        Write-Host -NoNewline ("`r  " + $DIM + $pre.Substring(0, $a) + (Rgb $AC[0] $AC[1] $AC[2]) + $ver.Substring(0, $b) + (Rgb 80 80 86) + $tail.Substring(0, $c) + $RST)
        Sleep-Ms 9
      }
      Write-Host ''
      Write-Host ''
    }

    'kv' {
      # a label and its value, in two columns: what the launcher is going to do
      $val = $env:UI_VAL
      $room = [math]::Max(10, $cols - 12)
      if ($val.Length -gt $room) { $keep = $room - 1; $val = $val.Substring(0, [math]::Floor($keep / 2)) + [string][char]0x2026 + $val.Substring($val.Length - [math]::Ceiling($keep / 2)) }
      $vc = if ($val -like 'none*') { Rgb 120 120 126 } else { $TXT }
      Write-Host ("  " + (Rgb 90 90 96) + $Label.ToUpper().PadRight(7) + $RST + $vc + $val + $RST)
    }

    'step' {
      for ($i = 0; $i -lt 9; $i++) {
        Write-Host -NoNewline ("`r  " + (Scan ($i * 2) 16) + "  $Label")
        Sleep-Ms 22
      }
      Write-Host ("`r$E[2K  " + $GREEN + $OK + $RST + "  $TXT$Label$RST")
    }

    'run' {
      $cmd = $env:UI_CMD
      $log = Join-Path $env:TEMP ("mo-ui-$PID.log")
      $p = Start-Process cmd.exe -ArgumentList ('/d /s /c "(' + $cmd + ') > "' + $log + '" 2>&1"') -WindowStyle Hidden -PassThru
      $sw = [Diagnostics.Stopwatch]::StartNew()
      $i = 0; $last = ''
      while (-not $p.HasExited) {
        if ($i % 6 -eq 0) {
          try { $l = (Get-Content -LiteralPath $log -Tail 1 -ErrorAction Stop) } catch { $l = $null }
          if ($l) { $last = ($l -replace '[^\x20-\x7E]', '').Trim() }
        }
        $t = $sw.Elapsed
        $time = '{0}:{1:00}' -f [int][math]::Floor($t.TotalMinutes), $t.Seconds
        $room = [math]::Max(0, $cols - 30 - $Label.Length - $time.Length)
        $shown = $last; if ($shown.Length -gt $room) { $shown = $shown.Substring(0, $room) }
        Write-Host -NoNewline ("`r$E[2K  " + (Scan $i 16) + "  $TXT$Label$RST  " + $DIM + $time + "  " + (Rgb 80 80 86) + $shown + $RST)
        $i++
        Sleep-Ms 50
      }
      $p.WaitForExit()
      $code = $p.ExitCode
      $t = $sw.Elapsed
      $time = '{0}:{1:00}' -f [int][math]::Floor($t.TotalMinutes), $t.Seconds
      if ($code -eq 0) {
        Write-Host ("`r$E[2K  " + $GREEN + $OK + $RST + "  $TXT$Label$RST  " + $DIM + $time + $RST)
      } else {
        Write-Host ("`r$E[2K  " + (Rgb 240 90 90) + $BAD + $RST + "  $TXT$Label$RST  " + (Rgb 240 90 90) + 'failed' + $RST)
        Write-Host ''
        try { Get-Content -LiteralPath $log -Tail 15 | ForEach-Object { Write-Host ("    " + $DIM + $_ + $RST) } } catch {}
      }
      Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
      Show
      exit $code
    }
  }
} finally {
  Show
}
exit 0
