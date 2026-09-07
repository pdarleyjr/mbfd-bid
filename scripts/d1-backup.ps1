#requires -Version 7
<#
.SYNOPSIS
    Plan 09 Task 6 — D1 backup to R2.

.DESCRIPTION
    Exports the named D1 database to a .sql snapshot, validates the dump is
    non-trivial, uploads it to R2 under `d1/<YYYY-MM-DD>/<dbname>-<HHMM>.sql`,
    and deletes the temp file. Production also stores a private recovery
    receipt containing the pre-export Time Travel bookmark and SQL hash.
    Designed to be invoked by the
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

. (Join-Path $PSScriptRoot 'd1-backup-preflight.ps1')

$now = Get-Date -Format 'yyyy-MM-dd-HHmm'
$day = Get-Date -Format 'yyyy-MM-dd'

$result = [pscustomobject]@{ Key = $null; ReceiptKey = $null }
Invoke-D1BackupTempDirectory -Name "d1-backup-$now-$([guid]::NewGuid().ToString('N'))" -Operation {
  param([string]$TemporaryDirectory)

  $file = Join-Path $TemporaryDirectory "$DbName-$now.sql"

  $bookmark = $null
  $bookmarkCapturedAt = $null
  if ($Env -eq 'production') {
    # Capture output privately: neither recovery values nor raw CLI errors
    # belong in the public workflow log. This operation only reads D1.
    $bookmarkOutput = & pnpm --dir apps/worker exec wrangler d1 time-travel info $DbName --env $Env --json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Production Time Travel lookup failed (exit $LASTEXITCODE); no backup success recorded." }
    try {
      $bookmark = ($bookmarkOutput | Out-String | ConvertFrom-Json -ErrorAction Stop).bookmark
    }
    catch { throw 'Production Time Travel returned invalid JSON; no backup success recorded.' }
    if ($bookmark -isnot [string] -or $bookmark -notmatch '^[0-9a-f]+(?:-[0-9a-f]+)+$') {
      throw 'Production Time Travel omitted a valid bookmark; no backup success recorded.'
    }
    $bookmarkCapturedAt = [DateTimeOffset]::UtcNow.ToString('o')
  }

  Write-Host "[d1-backup] exporting D1 $DbName ($Env) -> $file"
  & pnpm --dir apps/worker exec wrangler d1 export $DbName --env $Env --remote --output $file
  if ($LASTEXITCODE -ne 0) { throw "wrangler d1 export failed (exit $LASTEXITCODE)" }

  $size = (Get-Item $file).Length
  if ($size -lt 1024) {
    throw "Backup file suspiciously small: $size bytes (expected >= 1KB)"
  }
  Write-Host "[d1-backup] dump size: $size bytes"

  $result.Key = "d1/$day/$DbName-$now.sql"
  Write-Host "[d1-backup] uploading -> r2://$BucketName/$($result.Key)"
  & pnpm --dir apps/worker exec wrangler r2 object put "$BucketName/$($result.Key)" --file=$file --remote
  if ($LASTEXITCODE -ne 0) { throw "wrangler r2 object put failed (exit $LASTEXITCODE)" }

  if ($Env -eq 'production') {
    $receiptFile = Join-Path $TemporaryDirectory 'recovery.json'
    $result.ReceiptKey = "$($result.Key).recovery.json"
    [ordered]@{
      schema_version = 1
      environment = $Env
      database = $DbName
      backup_key = $result.Key
      backup_bytes = $size
      backup_sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
      time_travel_bookmark = $bookmark
      bookmark_captured_at = $bookmarkCapturedAt
      source_commit = $env:GITHUB_SHA
    } | ConvertTo-Json | Set-Content -LiteralPath $receiptFile -Encoding utf8NoBOM
    & pnpm --dir apps/worker exec wrangler r2 object put "$BucketName/$($result.ReceiptKey)" --file=$receiptFile --remote
    if ($LASTEXITCODE -ne 0) { throw "Private recovery receipt upload failed (exit $LASTEXITCODE); no backup success recorded." }
    Write-Host "[d1-backup] private recovery receipt -> r2://$BucketName/$($result.ReceiptKey)"
  }
}

Write-Host "[d1-backup] OK -> $($result.Key)"
