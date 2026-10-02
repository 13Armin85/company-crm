param([switch]$Watch, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Install Docker Desktop with Linux containers first, then run this command again.'
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $desktopPath = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktopPath)) { throw 'Docker Desktop was not found. Start your Docker engine and retry.' }
    Start-Process -FilePath $desktopPath -WindowStyle Hidden
    $deadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 2
        & docker info *> $null
        $ready = $LASTEXITCODE -eq 0
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if (-not $ready) { throw 'Docker Desktop did not become ready. Check that its Linux engine is enabled.' }
}
$setupArgs = @{ Build = -not $NoBuild; NoWatch = -not $Watch }
& (Join-Path $PSScriptRoot 'setup-dev.ps1') @setupArgs
