#Requires -Version 5.1
<#
.SYNOPSIS
    Mason Launcher - full build script
.DESCRIPTION
    Runs: typecheck -> lint -> test -> package/make
    Stops immediately on any failure.
.PARAMETER Configuration
    Release : full checks + Squirrel installer under out/make/   (default)
    Debug   : full checks + expanded build under out/            (faster, no installer)
    The Configuration selects a sensible default -Target; pass -Target to override.
.PARAMETER Target
    make     : generate Squirrel installer under out/make/
    package  : expand build under out/  (faster, no installer)
    check    : typecheck + lint + test only  (no build)
    Defaults to 'make' for Release and 'package' for Debug.
.PARAMETER SkipTests
    Skip the test step.
.PARAMETER SkipLint
    Skip the ESLint step.
.EXAMPLE
    .\build.ps1                              # Release (installer)
    .\build.ps1 -Configuration Debug         # Debug (expanded build)
    .\build.ps1 -Configuration Release -SkipTests
    .\build.ps1 -Target check                # checks only
#>
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',
    [ValidateSet('make', 'package', 'check')]
    [string]$Target,
    [switch]$SkipTests,
    [switch]$SkipLint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Configuration drives the default Target unless the caller set one explicitly.
if (-not $PSBoundParameters.ContainsKey('Target')) {
    $Target = if ($Configuration -eq 'Debug') { 'package' } else { 'make' }
}

# Surfaced to electron-forge / vite for any env-dependent behaviour.
$env:NODE_ENV = if ($Configuration -eq 'Debug') { 'development' } else { 'production' }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

$script:stepIndex = 0
$script:startTime = Get-Date

function Write-Step {
    param([string]$Label)
    $script:stepIndex++
    Write-Host ""
    Write-Host "[$script:stepIndex] $Label" -ForegroundColor Cyan
    Write-Host ("-" * 60) -ForegroundColor DarkGray
}

function Invoke-Step {
    param([string]$Label, [scriptblock]$Action)
    Write-Step $Label
    & $Action
    $code = $LASTEXITCODE
    if ($code -and $code -ne 0) {
        Write-Host ""
        Write-Host "FAILED: $Label (exit $code)" -ForegroundColor Red
        exit $code
    }
    Write-Host "OK" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Mason Launcher - Build" -ForegroundColor White
Write-Host "Configuration : $Configuration" -ForegroundColor DarkGray
Write-Host "Target        : $Target" -ForegroundColor DarkGray
Write-Host "Date          : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray

$nodeVerRaw = (node --version) 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: node not found." -ForegroundColor Red
    exit 1
}
$nodeVer = "$nodeVerRaw"
$nodeMajor = [int]($nodeVer -replace 'v(\d+).*', '$1')
if ($nodeMajor -lt 20) {
    Write-Host "ERROR: Node.js 20+ required (found: $nodeVer)" -ForegroundColor Red
    exit 1
}
Write-Host "Node          : $nodeVer" -ForegroundColor DarkGray

if (-not (Test-Path "node_modules")) {
    Write-Step "npm install"
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# ---------------------------------------------------------------------------
# Build steps
# ---------------------------------------------------------------------------

Invoke-Step "TypeScript typecheck" {
    npm run typecheck
}

if (-not $SkipLint) {
    Invoke-Step "ESLint" {
        npm run lint
    }
}

if (-not $SkipTests) {
    Invoke-Step "Tests (Node.js test runner)" {
        npm run test
    }
}

if ($Target -eq 'package') {
    Invoke-Step "electron-forge package  ->  out/" {
        npm run package
    }
}
elseif ($Target -eq 'make') {
    Invoke-Step "electron-forge make  ->  out/make/" {
        npm run make
    }
}
# 'check' skips the build step

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

$elapsed = [int](New-TimeSpan -Start $script:startTime -End (Get-Date)).TotalSeconds
Write-Host ""
Write-Host ("=" * 60) -ForegroundColor DarkGray

if ($Target -eq 'make') {
    $installer = Get-ChildItem "out\make\squirrel.windows\x64\*.exe" -ErrorAction SilentlyContinue |
                 Select-Object -First 1
    if ($installer) {
        $sizeMB = [math]::Round($installer.Length / 1MB, 1)
        Write-Host "Installer : $($installer.FullName)  ($sizeMB MB)" -ForegroundColor White
    }
}
elseif ($Target -eq 'package') {
    $exe = Get-ChildItem "out\*\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) {
        Write-Host "Executable: $($exe.FullName)" -ForegroundColor White
    }
}

Write-Host "BUILD OK  ($Configuration, ${elapsed}s)" -ForegroundColor Green
Write-Host ""
