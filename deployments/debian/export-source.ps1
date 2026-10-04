[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$exportDirectory = Join-Path $projectRoot 'tmp'
$archivePath = Join-Path $exportDirectory 'company-crm-source.tar.gz'
$tarCommand = (Get-Command tar.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $exportDirectory | Out-Null
$excludedPatterns = @(
    '.git', 'node_modules', '.pnpm-store', '.turbo', '.next', '.react-router',
    'build', 'dist', 'out', '.venv', 'venv', '__pycache__', '.pytest_cache',
    '.env', '.env.*', '.secrets', '.aws', '.codex', '.agents', 'security',
    'tmp', 'temp', 'backups', 'logs', '.docker', 'docker-data', 'docker-volumes',
    'pgdata', 'postgres-data', 'redis-data', 'rabbitmq-data', 'minio-data',
    'pgadmin-data', 'uploads', 'mediafiles', 'staticfiles', 'collected-static',
    '*.pem', '*.key', '*.sql', '*.dump', '*.rdb', '*.rdb.gz', '*.sqlite3'
)
$tarArguments = @('-czf', $archivePath)
foreach ($pattern in $excludedPatterns) {
    $tarArguments += "--exclude=$pattern"
}
$tarArguments += @('-C', $projectRoot, '.')
& $tarCommand @tarArguments
if ($LASTEXITCODE -ne 0) {
    throw 'Source archive creation failed. Do not transfer this archive.'
}
Write-Output "Created: $archivePath"
Write-Output 'Includes current source changes and Ubuntu/Debian deployment files; excludes local settings and runtime data.'
