#requires -Version 7.0
<#
.SYNOPSIS
Build the Windows x64 NSIS installer and dist/win-unpacked application.
.EXAMPLE
pwsh -NoProfile -File .\scripts\build-win-x64.ps1 -SkipInstall
#>
[CmdletBinding()]
param([switch] $SkipInstall)

& (Join-Path $PSScriptRoot 'build-win-pwsh7.ps1') -Architecture x64 -Target installer -SkipInstall:$SkipInstall
exit $LASTEXITCODE
