param(
    [switch]$SkipInstall,
    [switch]$SkipUiBuild,
    [switch]$Reload,
    [switch]$FreshSetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Ensure-Command {
    param([string]$Name, [string]$InstallHint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not available. $InstallHint"
    }
}

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $base64 = [Convert]::ToBase64String($bytes)
    return $base64.Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Upsert-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    $content = ""
    if (Test-Path $Path) {
        $content = Get-Content -Raw -Path $Path
    }

    $escapedKey = [Regex]::Escape($Key)
    $pattern = "(?m)^$escapedKey=.*$"
    $line = "$Key=$Value"

    if ($content -match $pattern) {
        $updated = [Regex]::Replace($content, $pattern, $line)
    }
    elseif ([string]::IsNullOrWhiteSpace($content)) {
        $updated = "$line`r`n"
    }
    else {
        $updated = $content.TrimEnd() + "`r`n" + $line + "`r`n"
    }

    Set-Content -Path $Path -Value $updated -Encoding UTF8
}

function Import-DotEnv {
    param([string]$Path)

    Get-Content -Path $Path | ForEach-Object {
        $line = $_.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            return
        }

        $parts = $line.Split("=", 2)
        if ($parts.Count -ne 2) {
            return
        }

        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Get-DbUserCount {
    param(
        [string]$PythonExe,
        [string]$DbPath
    )

    if (-not (Test-Path $DbPath)) {
        return 0
    }

    $script = @"
import sqlite3
import sys

db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
if cur.fetchone() is None:
    print(0)
else:
    cur.execute("SELECT COUNT(*) FROM users")
    print(cur.fetchone()[0])
conn.close()
"@

    try {
        $countRaw = & $PythonExe -c $script $DbPath
        return [int]($countRaw | Select-Object -Last 1)
    }
    catch {
        return 0
    }
}

function Invoke-PipFiltered {
    param(
        [string]$PythonExe,
        [string[]]$PipArgs
    )

    $output = & $PythonExe -m pip @PipArgs 2>&1
    $exitCode = $LASTEXITCODE

    foreach ($line in $output) {
        $text = [string]$line
        if ($text -match "^Requirement already satisfied:") {
            continue
        }
        Write-Host $text
    }

    if ($exitCode -ne 0) {
        throw "pip command failed with exit code $exitCode"
    }
}

$repoRoot = $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$venvDir = Join-Path $backendDir ".venv"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $backendDir "requirements.txt"
$uiSrcDir = Join-Path $repoRoot "ui-src"
$uiOutDir = Join-Path $repoRoot "ui"
$assetsDir = Join-Path $repoRoot "assets"
$dataDir = Join-Path $repoRoot "data"
$dbFile = Join-Path $dataDir "stowge.db"
$envFile = Join-Path $repoRoot ".env"
$envExample = Join-Path $repoRoot ".env.example"

Write-Step "Preparing environment"
if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $envExample)) {
        throw "Missing .env and .env.example in repository root."
    }
    Copy-Item -Path $envExample -Destination $envFile
    Write-Host "Created .env from .env.example"
}

$envRaw = Get-Content -Raw -Path $envFile
if ($envRaw -match "(?m)^JWT_SECRET=(.*)$") {
    $jwtValue = $Matches[1].Trim()
}
else {
    $jwtValue = ""
}

if ([string]::IsNullOrWhiteSpace($jwtValue) -or $jwtValue -eq "change_me" -or $jwtValue -eq "change_me_to_a_long_random_string") {
    Write-Step "Generating JWT secret in .env"
    Upsert-EnvValue -Path $envFile -Key "JWT_SECRET" -Value (New-RandomSecret)
}

Write-Step "Loading .env values"
Import-DotEnv -Path $envFile

Write-Step "Checking required tools"
Ensure-Command -Name "npm" -InstallHint "Install Node.js (includes npm) from https://nodejs.org/"
if (-not (Get-Command "py" -ErrorAction SilentlyContinue) -and -not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    throw "Python is required. Install Python 3.12+ and ensure 'py' or 'python' is on PATH."
}

if (-not (Test-Path $venvDir)) {
    Write-Step "Creating backend virtual environment"
    if (Get-Command "py" -ErrorAction SilentlyContinue) {
        & py -3 -m venv $venvDir
    }
    else {
        & python -m venv $venvDir
    }
}

if (-not $SkipInstall) {
    Write-Step "Installing backend dependencies"
    Invoke-PipFiltered -PythonExe $pythonExe -PipArgs @("install", "--upgrade", "pip")
    Invoke-PipFiltered -PythonExe $pythonExe -PipArgs @("install", "-r", $requirementsFile)
}

if (-not $SkipUiBuild) {
    Write-Step "Installing UI dependencies (if needed)"
    Push-Location $uiSrcDir
    try {
        if (-not (Test-Path (Join-Path $uiSrcDir "node_modules"))) {
            if (Test-Path (Join-Path $uiSrcDir "package-lock.json")) {
                & npm ci
            }
            else {
                & npm install
            }
        }

        Write-Step "Building UI"
        & npm run build
    }
    finally {
        Pop-Location
    }
}

Write-Step "Preparing local data folders"
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

if ($FreshSetup -and (Test-Path $dbFile)) {
    Write-Step "Fresh setup requested: removing local database"
    Remove-Item -Path $dbFile -Force
}

$uiDirUnix = $uiOutDir.Replace("\", "/")
$assetsDirUnix = $assetsDir.Replace("\", "/")
$dbFileUnix = $dbFile.Replace("\", "/")

[Environment]::SetEnvironmentVariable("UI_DIR", $uiDirUnix, "Process")
[Environment]::SetEnvironmentVariable("ASSETS_DIR", $assetsDirUnix, "Process")
if (-not $env:DATABASE_URL) {
    [Environment]::SetEnvironmentVariable("DATABASE_URL", "sqlite:///$dbFileUnix", "Process")
}
if (-not $env:JWT_ISSUER) {
    [Environment]::SetEnvironmentVariable("JWT_ISSUER", "stowge", "Process")
}

$existingUsers = Get-DbUserCount -PythonExe $pythonExe -DbPath $dbFile
if ($existingUsers -gt 0) {
    Write-Host "Found $existingUsers existing user(s) in local DB. Login mode will be shown." -ForegroundColor Yellow
    Write-Host "Use -FreshSetup to reset only the local SQLite DB and show first-run admin setup again." -ForegroundColor Yellow
}
else {
    Write-Host "No users found in local DB. First-run admin setup will be shown." -ForegroundColor Green
}

Write-Step "Starting Stowge at http://localhost:18090"
Push-Location $backendDir
try {
    $uvicornArgs = @("-m", "uvicorn", "stowge.main:app", "--host", "0.0.0.0", "--port", "18090")
    if ($Reload) {
        $uvicornArgs += "--reload"
    }

    & $pythonExe @uvicornArgs
}
finally {
    Pop-Location
}
