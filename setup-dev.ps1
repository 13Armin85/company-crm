param([switch]$Watch = $true, [switch]$Build, [switch]$NoWatch)

$ErrorActionPreference = 'Stop'
$composeArgs = @('compose', '--project-name', 'plane-dev', '--env-file', '.env.dev', '-f', 'docker-compose-dev.yml')
# Hold one lock across startup and watch. Windows releases it even if the terminal closes.
$hash = [Security.Cryptography.SHA256]::Create()
try {
    $projectKey = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant()))).Replace('-', '')
} finally { $hash.Dispose() }
$mutex = New-Object Threading.Mutex($false, "Local\PlaneDev-$projectKey")
$ownsLock = $false
Push-Location $PSScriptRoot
try {
    try { $ownsLock = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsLock = $true }
    if (-not $ownsLock) {
        Write-Host 'Setup or watch is already running for this project. Keep its terminal open; a second watcher is unnecessary.'
        Write-Host 'To rebuild, stop watch in that terminal with Ctrl+C, then run .\setup-dev.ps1 -Build -Watch.'
        return
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker is required. Install and start Docker Desktop with Linux containers.'
    }
    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The Docker Compose plugin is required (docker compose).' }
    & docker info | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker is not available. Start Docker Desktop with Linux containers and retry.' }
    if (-not (Test-Path -LiteralPath '.env.dev')) {
        $randomBytes = New-Object byte[] 48
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
        $secret = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
        $envText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '.env.dev.example'))
        $envText = $envText.Replace('DEV_SECRET_KEY=', "DEV_SECRET_KEY=$secret")
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot '.env.dev'), $envText)
    }
    & docker @composeArgs config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Docker configuration is invalid. Check .env.dev and docker-compose-dev.yml.' }
    $upArgs = @('up', '-d', '--wait', '--wait-timeout', '900')
    if ($Build) { $upArgs += '--build' }
    & docker @composeArgs @upArgs
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker startup failed. Run: docker compose --env-file .env.dev -f docker-compose-dev.yml logs --tail 100 migrator api frontend'
    }
    # Validate the same API route used by the browser, not just the HTML server.
    $ready = $false
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $info = Invoke-RestMethod -Uri 'http://localhost:3000/api/instances/' -TimeoutSec 10
            $ready = ($info.instance.is_setup_done -eq $true -and $null -ne $info.config)
        } catch { $ready = $false }
        if (-not $ready) { Start-Sleep -Seconds 2 }
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if (-not $ready) { throw 'The browser API route is not ready: http://localhost:3000/api/instances/. Check api and frontend logs.' }
    Write-Host 'Ready. User: http://localhost:3000 | Admin: http://localhost:3001/god-mode/ | Database: http://localhost:5050'
    Write-Host 'Local login credentials: .env.dev and README.md. PostgreSQL: host=plane-db port=5432 database=plane user=plane password=plane'
    if ($Watch -and -not $NoWatch) {
        Write-Host 'Watching frontend sources. Keep this terminal open. Ctrl+C stops sync; containers keep running.'
        & docker @composeArgs watch --no-up --prune=false
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 130 -and $LASTEXITCODE -ne -1073741510) {
            throw 'Watch stopped. If Compose reports an exclusive lock, stop the earlier watch with Ctrl+C in its terminal and retry. Containers are still running.'
        }
    } else {
        Write-Warning 'Frontend source sync is OFF. Local edits will not reach Docker. Run .\setup-dev.ps1 and keep its terminal open to sync changes.'
    }
} finally {
    Pop-Location
    if ($ownsLock) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
