# DubKanka setup: Python venv + AI packages + ffmpeg. Safe to run again (it only fills in what is missing).
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

function Say($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

function Find-Python {
    foreach ($v in '3.14', '3.13', '3.12', '3.11', '3.10') {
        try {
            & py "-$v" -c "import sys" 2>$null
            if ($LASTEXITCODE -eq 0) { return @('py', "-$v") }
        } catch {}
    }
    try {
        $ver = & python -c "import sys; print(sys.version_info[0]*100+sys.version_info[1])" 2>$null
        if ([int]$ver -ge 310) { return @('python') }
    } catch {}
    return $null
}

if (-not (Test-Path $venvPy)) {
    Say 'Python araniyor...'
    $py = Find-Python
    if (-not $py) {
        Say 'Python bulunamadi, winget ile Python 3.13 kuruluyor...'
        winget install --id Python.Python.3.13 --exact --accept-source-agreements --accept-package-agreements --silent
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $py = Find-Python
        if (-not $py) { throw 'Python kurulamadi. https://www.python.org adresinden Python 3.13 kurup tekrar dene.' }
    }
    Say "Sanal ortam olusturuluyor ($($py -join ' '))..."
    if ($py.Count -gt 1) { & $py[0] $py[1] -m venv .venv } else { & $py[0] -m venv .venv }
}

Say 'pip guncelleniyor...'
& $venvPy -m pip install --upgrade pip --quiet --no-cache-dir

$hasTorch = $false
try { & $venvPy -c "import torch" 2>$null; $hasTorch = ($LASTEXITCODE -eq 0) } catch {}
if (-not $hasTorch) {
    $nvidia = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
    if ($nvidia) {
        Say 'NVIDIA ekran karti bulundu: PyTorch (CUDA) kuruluyor, ~3 GB indirilecek...'
        & $venvPy -m pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu128
    } else {
        Say 'Ekran karti yok: PyTorch (CPU) kuruluyor...'
        & $venvPy -m pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
    }
    if ($LASTEXITCODE -ne 0) { throw 'PyTorch kurulamadi.' }
}

Say 'Yapay zeka paketleri kuruluyor...'
& $venvPy -m pip install --no-cache-dir -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Paketler kurulamadi.' }

$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
$wingetFf = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
if (-not $ff -and -not (Test-Path $wingetFf) -and -not (Test-Path (Join-Path $PSScriptRoot 'bin\ffmpeg.exe'))) {
    Say 'ffmpeg kuruluyor (winget)...'
    winget install --id Gyan.FFmpeg.Essentials --exact --accept-source-agreements --accept-package-agreements --silent
}

Say 'Kurulum tamam! Baslat.bat ile DubKanka''yi acabilirsin.'
