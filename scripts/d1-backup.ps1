#requires -Version 7
<#
.SYNOPSIS
    Plan 09 Task 6 — D1 backup to R2.

.DESCRIPTION
    Exports the named D1 database to a .sql snapshot, validates the dump is
    non-trivial, uploads it to R2 under `d1/<YYYY-MM-DD>/<dbname>-<HHMM>.sql`,
    and deletes the temp file. Designed to be invoked by the
    `.github/workflows/d1-backup.yml` GitHub Actions cron.

    DO NOT run this script against production D1 from a dev workstation
    without an approval ticket — Phase A is local + staging-code-only.

.PARAMETER Env
    `staging` or `production`. Selects the wrangler environment.

.PARAMETER DbName
    Database name as declared in wrangler.toml.

.PARAMETER BucketName
    R2 bucket name (e.g. `mbfd-bid-prod-backups`).

.EXAMPLE
    ./scripts/d1-backup.ps1 -Env staging -DbName mbfd-bid-staging -BucketName mbfd-bid-staging-backups
#>
param(
  [Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Env,
  [Parameter(Mandatory)][string]$DbName,
  [Parameter(Mandatory)][string]$BucketName
)
$ErrorActionPreference = 'Stop'

$now = Get-Date -Format 'yyyy-MM-dd-HHmm'
$day = Get-Date -Format 'yyyy-MM-dd'
$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP "d1-backup-$now")
$file = Join-Path $tmp "$DbName-$now.sql"

Write-Host "[d1-backup] exporting D1 $DbName ($Env) -> $file"
& pnpm exec wrangler d1 export $DbName --env $Env --remote --output $file
if ($LASTEXITCODE -ne 0) { throw "wrangler d1 export failed (exit $LASTEXITCODE)" }

$size = (Get-Item $file).Length
if ($size -lt 1024) {
  throw "Backup file suspiciously small: $size bytes (expected >= 1KB)"
}
Write-Host "[d1-backup] dump size: $size bytes"

$key = "d1/$day/$DbName-$now.sql"
Write-Host "[d1-backup] uploading -> r2://$BucketName/$key"
& pnpm exec wrangler r2 object put "$BucketName/$key" --file=$file --remote
if ($LASTEXITCODE -ne 0) { throw "wrangler r2 object put failed (exit $LASTEXITCODE)" }

Remove-Item -Recurse -Force $tmp
Write-Host "[d1-backup] OK -> $key"
