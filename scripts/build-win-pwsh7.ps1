#requires -Version 7.0
<#
.SYNOPSIS
Build OneMail Next Windows installers and unpacked applications with PowerShell 7.
.DESCRIPTION
Uses the existing package version and electron-builder naming configuration.
The default builds x64 and ARM64. Logs are saved under dist/build-logs.
When HTTP_PROXY or HTTPS_PROXY is set, enables Electron's environment proxy
support and Node's built-in support when the runtime provides it.
Does not publish, launch the application, change versions, or clean dist.
.EXAMPLE
pwsh -NoProfile -File .\scripts\build-win-pwsh7.ps1
.EXAMPLE
pwsh -NoProfile -File .\scripts\build-win-pwsh7.ps1 -Architecture x64
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'x64', 'arm64')]
    [string] $Architecture = 'all',
    [ValidateSet('installer', 'unpacked')]
    [string] $Target = 'installer',
    [switch] $SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not $IsWindows) {
    throw 'Run this script in PowerShell 7 on Windows, not Linux, WSL, or macOS.'
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$distDirectory = Join-Path $projectRoot 'dist'
$logDirectory = Join-Path $distDirectory 'build-logs'
$null = New-Item -ItemType Directory -Path $logDirectory -Force
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$logPath = Join-Path $logDirectory "$($package.name)-$($package.version)-win-$Architecture-$Target-build-$stamp.log"
$transcriptStarted = $false
$locationPushed = $false
$failed = $false
$previousCI = $env:CI
$previousElectronUseProxy = $env:ELECTRON_GET_USE_PROXY
$previousNodeUseEnvProxy = $env:NODE_USE_ENV_PROXY
$previousConsoleOutputEncoding = [Console]::OutputEncoding
$previousPipelineOutputEncoding = $OutputEncoding

function Invoke-LoggedCommand {
    param(
        [Parameter(Mandatory)] [string] $FilePath,
        [Parameter(Mandatory)] [string[]] $ArgumentList
    )

    Write-Host "`n> $FilePath $($ArgumentList -join ' ')"
    $savedPreference = $ErrorActionPreference
    $nativeExitCode = $null
    try {
        # Some older PowerShell 7 releases turn redirected stderr into error
        # records. Log those records, then use the native exit code for success.
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = $null
        & $FilePath @ArgumentList 2>&1 | ForEach-Object { Write-Host ([string] $_) }
        $nativeExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $savedPreference
    }
    if ($null -eq $nativeExitCode -or $nativeExitCode -ne 0) {
        throw "Command failed (exit code: $nativeExitCode): $FilePath $($ArgumentList -join ' ')"
    }
}

try {
    Start-Transcript -Path $logPath -NoClobber | Out-Null
    $transcriptStarted = $true
    Push-Location -LiteralPath $projectRoot
    $locationPushed = $true
    $env:CI = 'true'
    # pnpm/Node emit UTF-8; decode redirected output consistently on Windows.
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8

    Write-Host "Project: $projectRoot"
    Write-Host "Package: $($package.name) $($package.version)"
    Write-Host "Architecture: $Architecture"
    Write-Host "Target: $Target"
    Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
    Write-Host "Started: $([DateTimeOffset]::Now.ToString('o'))"
    Write-Host "Log: $logPath"

    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $pnpm = (Get-Command pnpm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $nodeJson = & $node -p 'JSON.stringify({platform:process.platform,arch:process.arch,version:process.versions.node,execPath:process.execPath,envProxySupported:process.allowedNodeEnvironmentFlags.has("--use-env-proxy")})'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the installed Node.js runtime.' }
    $nodeInfo = $nodeJson | ConvertFrom-Json
    Write-Host "Node: $($nodeInfo.version), $($nodeInfo.platform)/$($nodeInfo.arch), $($nodeInfo.execPath)"
    if ($nodeInfo.platform -ne 'win32') { throw 'Node.js must be the native Windows build.' }
    if ([version] $nodeInfo.version -lt [version] '22.13.0') {
        throw 'Node.js 22.13.0 or newer is required. Use a supported Node.js LTS release.'
    }

    $hasProxy = -not (
        [string]::IsNullOrWhiteSpace($env:HTTP_PROXY) -and
        [string]::IsNullOrWhiteSpace($env:HTTPS_PROXY)
    )
    if ($hasProxy) {
        # Electron 42 uses @electron/get 5: this flag installs Undici's
        # EnvHttpProxyAgent. Proxy addresses alone do not enable it.
        $env:ELECTRON_GET_USE_PROXY = '1'
        Write-Host 'Proxy environment detected: ELECTRON_GET_USE_PROXY=1 (addresses are not logged).'
        # Feature detection keeps older supported Node releases compatible.
        if ($nodeInfo.envProxySupported) {
            $env:NODE_USE_ENV_PROXY = '1'
            Write-Host 'Node environment proxy support: NODE_USE_ENV_PROXY=1.'
        }
        Write-Host 'Existing NO_PROXY rules are preserved; bypassed hosts will still connect directly.'
    }

    $requiredPnpm = $package.packageManager -replace '^pnpm@', '' -replace '\+.*$', ''
    $pnpmVersion = (& $pnpm --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the installed pnpm version.' }
    Write-Host "pnpm: $pnpmVersion, $pnpm"
    if ($pnpmVersion -ne $requiredPnpm) {
        throw "Use pnpm@$requiredPnpm as pinned in package.json, then run this script again."
    }

    if (-not $SkipInstall) {
        Invoke-LoggedCommand -FilePath $pnpm -ArgumentList @('install', '--frozen-lockfile', '--prod=false')
    }
    else {
        Write-Host 'Skipping dependency installation; existing Windows dependencies must be complete.'
    }

    $buildScript = if ($Architecture -eq 'all') { 'build:win' } else { "build:win-$Architecture" }
    # This existing command runs both TypeScript checks, electron-vite, and
    # electron-builder. NSIS packaging also leaves the unpacked applications.
    if ($Target -eq 'unpacked') {
        Invoke-LoggedCommand -FilePath $pnpm -ArgumentList @('run', 'build')
        $builderArguments = @('exec', 'electron-builder', '--win', '--dir', '--publish', 'never')
        if ($Architecture -eq 'all') {
            $builderArguments += @('--x64', '--arm64')
        }
        else {
            $builderArguments += "--$Architecture"
        }
        Invoke-LoggedCommand -FilePath $pnpm -ArgumentList $builderArguments
    }
    else {
        Invoke-LoggedCommand -FilePath $pnpm -ArgumentList @('run', $buildScript)
    }

    $architectures = if ($Architecture -eq 'all') { @('x64', 'arm64') } else { @($Architecture) }
    Write-Host "`nBuild outputs:"
    foreach ($targetArchitecture in $architectures) {
        $unpackedName = if ($targetArchitecture -eq 'x64') { 'win-unpacked' } else { 'win-arm64-unpacked' }
        $unpackedPath = Join-Path $distDirectory $unpackedName
        $installerName = "$($package.name)-$($package.version)-win-$targetArchitecture-setup.exe"
        $installerPath = Join-Path $distDirectory $installerName
        $expectedFiles = @(
            (Join-Path $unpackedPath 'OneMailNext.exe')
            (Join-Path $unpackedPath 'resources/app.asar')
        )
        if ($Target -eq 'installer') {
            $expectedFiles += @($installerPath, "$installerPath.blockmap")
        }
        foreach ($path in $expectedFiles) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                throw "Build command exited successfully, but an expected output is missing: $path"
            }
            $item = Get-Item -LiteralPath $path
            if ($item.Length -le 0) { throw "An expected output is empty: $path" }
            Write-Host "$($item.FullName) | $($item.Length) bytes | $($item.LastWriteTimeUtc.ToString('o'))"
        }
        if ($Target -eq 'installer') {
            $hash = Get-FileHash -LiteralPath $installerPath -Algorithm SHA256
            Write-Host "SHA256 $installerName : $($hash.Hash)"
        }
        Write-Host "Keep the entire unpacked directory together: $unpackedPath"
    }
    $updateMetadata = Join-Path $distDirectory 'latest.yml'
    if ($Target -eq 'installer' -and (Test-Path -LiteralPath $updateMetadata -PathType Leaf)) {
        Write-Host "Update metadata: $updateMetadata"
    }
    Write-Host "Finished: $([DateTimeOffset]::Now.ToString('o'))"

}
catch {
    $failed = $true
    Write-Host 'BUILD FAILED. No successful build is being reported.' -ForegroundColor Red
    Write-Host ($_ | Out-String)
}
finally {
    $env:CI = $previousCI
    $env:ELECTRON_GET_USE_PROXY = $previousElectronUseProxy
    $env:NODE_USE_ENV_PROXY = $previousNodeUseEnvProxy
    $OutputEncoding = $previousPipelineOutputEncoding
    [Console]::OutputEncoding = $previousConsoleOutputEncoding
    if ($locationPushed) { Pop-Location }
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
}

if ($failed) { exit 1 }
Write-Host 'BUILD SUCCEEDED. Installation and application verification are left to you.' -ForegroundColor Green
if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    Write-Host "Build log: $logPath"
}
exit 0
