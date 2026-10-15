[CmdletBinding()]
param (
    [string]$Repository = 'GPC-Shared/68d9d0fa1299230338c8563a',
    [string]$Branch = 'main',
    [string]$KeyPropertiesPath = 'android/key.properties',
    [string]$KeystorePath = 'android/rabate_ops_release.jks',
    [string]$AuthVolume = 'gpc-gh-auth',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
    throw 'Docker is not installed or not available in PATH.'
}
$helperPath = Join-Path $PSScriptRoot 'sync-android-signing-secrets.sh'
if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    throw "Signing sync helper not found: $helperPath"
}

& docker volume create $AuthVolume | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not create or access the Docker authentication volume.' }

$statusArgs = @(
    'run', '--rm',
    '-v', "${AuthVolume}:/root/.config/gh",
    'alpine:3.21', 'sh', '-lc',
    'apk add --no-cache github-cli >/dev/null && gh auth status --hostname github.com'
)
& docker @statusArgs *> $null
$authStatus = $LASTEXITCODE

if ($authStatus -ne 0) {
    Write-Host 'GitHub CLI is not logged in inside Docker. Complete the browser authorization when prompted.'
    try { Start-Process 'https://github.com/login/device' } catch { Write-Warning 'Open https://github.com/login/device manually.' }
    $loginArgs = @(
        'run', '--rm', '-it',
        '-v', "${AuthVolume}:/root/.config/gh",
        'alpine:3.21', 'sh', '-lc',
        'apk add --no-cache github-cli >/dev/null && gh auth login --hostname github.com --web --git-protocol https'
    )
    & docker @loginArgs
    if ($LASTEXITCODE -ne 0) { throw 'GitHub login did not complete. Keep the terminal open and finish device authorization.' }
}

$mode = if ($Apply) { '' } else { ' --dry-run' }
$containerCommand = 'apk add --no-cache github-cli bash grep coreutils >/dev/null && gh auth status --hostname github.com && bash ./sync-android-signing-secrets.sh "$SYNC_REPOSITORY" "$SYNC_BRANCH" "$SYNC_PROPERTIES_PATH" --keystore-path "$SYNC_KEYSTORE_PATH"' + $mode
$runArgs = @(
    'run', '--rm', '-it',
    '-v', "${AuthVolume}:/root/.config/gh",
    '-v', "${PSScriptRoot}:/work:ro",
    '-w', '/work',
    '-e', "SYNC_REPOSITORY=$Repository",
    '-e', "SYNC_BRANCH=$Branch",
    '-e', "SYNC_PROPERTIES_PATH=$KeyPropertiesPath",
    '-e', "SYNC_KEYSTORE_PATH=$KeystorePath",
    'alpine:3.21', 'sh', '-lc', $containerCommand
)

if ($Apply) {
    Write-Host "Will set Android signing secrets in $Repository after the helper's confirmation prompt."
} else {
    Write-Host "Running dry-run for $Repository; no secrets will be changed. Use -Apply only after reviewing a successful dry-run."
}
& docker @runArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Docker secret sync failed. No success is assumed; review the terminal error and retry.'
}
