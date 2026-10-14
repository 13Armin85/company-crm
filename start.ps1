param([switch]$Watch, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
function Test-DockerAvailable {
    # Windows PowerShell treats redirected native stderr as a terminating error
    # under Stop. A stopped engine must reach the Desktop startup path instead.
    $ErrorActionPreference = 'Continue'
    & docker info *> $null
    return ($LASTEXITCODE -eq 0)
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Install Docker Desktop with Linux containers first, then run this command again.'
}
if (-not (Test-DockerAvailable)) {
    # Docker Desktop also supports installation under the current user's AppData.
    $dockerCommand = Get-Command docker
    $desktopCandidates = @(
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe')
        (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
    )
    if ($dockerCommand.Source) {
        $desktopRoot = Split-Path (Split-Path (Split-Path $dockerCommand.Source -Parent) -Parent) -Parent
        $desktopCandidates += Join-Path $desktopRoot 'Docker Desktop.exe'
    }
    $desktopPath = $desktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $desktopPath) { throw 'Docker Desktop was not found. Start your Docker engine and retry.' }
    Start-Process -FilePath $desktopPath -WindowStyle Hidden
    $deadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 2
        $ready = Test-DockerAvailable
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if (-not $ready) { throw 'Docker Desktop did not become ready. Check that its Linux engine is enabled.' }
}
$setupArgs = @{ Build = -not $NoBuild; NoWatch = -not $Watch }
& (Join-Path $PSScriptRoot 'setup-dev.ps1') @setupArgs
