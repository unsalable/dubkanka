# Publish a new DubKanka version: .\scripts\release.ps1 1.2.0 "Bu sürümde ne değişti"
# Sets the version in desktop/package.json, commits, tags v1.2.0 (the notes go into the tag) and pushes. GitHub
# Actions then builds DubKanka-Setup-1.2.0.exe and publishes the release; installed apps update themselves from it.
param([Parameter(Mandatory = $true)][string]$Version, [string]$Notes = "")
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Sürüm 1.2.0 biçiminde olmalı." }
if (git status --porcelain) { throw "Önce değişiklikleri commit et (git status temiz değil)." }
$tag = "v$Version"
if (git tag --list $tag) { throw "$tag zaten var." }

$branch = git rev-parse --abbrev-ref HEAD
Write-Host "Sürüm $Version → $tag, dal: $branch" -ForegroundColor Cyan
if ((Read-Host "Devam? (e/h)") -ne 'e') { exit 1 }

Push-Location desktop
npm version $Version --no-git-tag-version --allow-same-version | Out-Null
Pop-Location
git add desktop/package.json desktop/package-lock.json
git commit -m "Release $tag"
# the tag message becomes the release notes on GitHub
if (-not $Notes) { $Notes = Read-Host "Sürüm notu (bu sürümde ne değişti?)" }
git tag -a $tag -m "DubKanka $Version`n`n$Notes"
git push origin $branch
git push origin $tag
Write-Host "Gönderildi. Kurulum dosyası birkaç dakika içinde https://github.com/unsalable/dubkanka/releases adresinde." -ForegroundColor Green
