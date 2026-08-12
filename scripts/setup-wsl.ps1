# ============================================================
#  Step 1: Install WSL2 (requires Admin privileges)
#  Run this script as Administrator (right-click PowerShell -> Run as Administrator)
# ============================================================

# Do NOT use Stop — native commands writing to stderr would abort the script
$ErrorActionPreference = "Continue"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Install WSL2 for sandbox image building" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please right-click PowerShell and select 'Run as Administrator'," -ForegroundColor Yellow
    Write-Host "then run this script again." -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

# Check if WSL is already working
# Redirect stderr to $null to avoid PowerShell treating it as a terminating error
$wslCheck = $null
try {
    $wslCheck = & wsl --version 2>$null
} catch {
    $wslCheck = $null
}

$wslInstalled = ($LASTEXITCODE -eq 0) -and ($wslCheck -ne $null)

if ($wslInstalled) {
    Write-Host "WSL is already installed!" -ForegroundColor Green
    & wsl --version 2>$null

    # Check if Ubuntu is installed
    $distros = & wsl --list --quiet 2>$null
    $hasUbuntu = $false
    if ($distros) {
        foreach ($d in $distros) {
            if ($d -match "Ubuntu") { $hasUbuntu = $true; break }
        }
    }

    if ($hasUbuntu) {
        Write-Host ""
        Write-Host "Ubuntu is already installed. You can proceed to build." -ForegroundColor Green
        Write-Host "Run: scripts\build-sandbox-in-wsl.bat" -ForegroundColor Yellow
        pause
        exit 0
    } else {
        Write-Host ""
        Write-Host "Installing Ubuntu 22.04..." -ForegroundColor Yellow
        & wsl --install -d Ubuntu-22.04 --no-launch 2>&1
        Write-Host ""
        Write-Host "Ubuntu installed. Please restart your computer, then run:" -ForegroundColor Green
        Write-Host "  scripts\build-sandbox-in-wsl.bat" -ForegroundColor Yellow
        pause
        exit 0
    }
}

# WSL not installed — install it
Write-Host "WSL is not installed. Installing WSL2 with Ubuntu 22.04..." -ForegroundColor Yellow
Write-Host "This may take a few minutes." -ForegroundColor Gray
Write-Host ""

& wsl --install -d Ubuntu-22.04 2>&1

if ($LASTEXITCODE -ne 0) {
    # Try enabling the features manually
    Write-Host ""
    Write-Host "Automatic install did not succeed, trying manual feature enable..." -ForegroundColor Yellow
    Write-Host ""

    Write-Host "Enabling Windows Subsystem for Linux..." -ForegroundColor Gray
    & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart 2>&1

    Write-Host "Enabling Virtual Machine Platform..." -ForegroundColor Gray
    & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart 2>&1

    Write-Host ""
    Write-Host "WSL features enabled. After restart, open PowerShell (Admin) and run:" -ForegroundColor Yellow
    Write-Host "  wsl --install -d Ubuntu-22.04" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  WSL2 installation initiated!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: You must RESTART your computer for WSL2 to finish setup." -ForegroundColor Red
Write-Host ""
Write-Host "After restart:" -ForegroundColor Yellow
Write-Host "  1. Ubuntu may open automatically to finish setup" -ForegroundColor Yellow
Write-Host "     (create a username/password when prompted)" -ForegroundColor Yellow
Write-Host "  2. Then run: scripts\build-sandbox-in-wsl.bat" -ForegroundColor Yellow
Write-Host ""
pause
