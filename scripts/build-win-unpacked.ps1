#requires -Version 7.0
<#
.SYNOPSIS
Build the Windows x64 application directory at dist/win-unpacked.
.EXAMPLE
pwsh -NoProfile -File .\scripts\build-win-unpacked.ps1 -SkipInstall
#>
[CmdletBinding()]
param([switch] $SkipInstall)

& (Join-Path $PSScriptRoot 'build-win-pwsh7.ps1') -Architecture x64 -Target unpacked -SkipInstall:$SkipInstall
exit $LASTEXITCODE
