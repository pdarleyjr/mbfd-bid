#requires -Version 7
<#
.SYNOPSIS
    Plan 09 Task 6 — Restore a D1 database from an R2 snapshot.

.DESCRIPTION
    Downloads a previously uploaded snapshot from R2 and applies it to the
    named D1 database. THIS WILL APPEND ROWS — for a true overwrite, drop
    the tables (or recreate the D1 database) before running this script.

    Tested-restore-path target for Plan 09 Task 6 Step 4: create a throwaway
    D1, restore staging into it, count rows, drop the throwaway. The script
    accepts that flow without modification.

.PARAMETER Env
    Wrangler environment under which to apply the snapshot.

.PARAMETER DbName
    Database name as declared in wrangler.toml.

.PARAMETER BucketName
    R2 bucket name containing the snapshot.

.PARAMETER SnapshotKey
    Object key of the snapshot inside the bucket. Example:
    `d1/2026-05-17/mbfd-bid-staging-2026-05-17-0600.sql`.

.EXAMPLE
    ./scripts/d1-restore.ps1 `
      -Env restore_test `
      -DbName mbfd-bid-restore-test `
      -BucketName mbfd-bid-staging-backups `
      -SnapshotKey "d1/2026-05-19/mbfd-bid-staging-2026-05-19-0600.sql"
#>
param(
  [Parameter(Mandatory)][string]$Env,
  [Parameter(Mandatory)][string]$DbName,
  [Parameter(Mandatory)][string]$BucketName,
  [Parameter(Mandatory)][string]$SnapshotKey
)
$ErrorActionPreference = 'Stop'

$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP "d1-restore-$(Get-Random)")
$file = Join-Path $tmp 'snapshot.sql'

Write-Host "[d1-restore] downloading r2://$BucketName/$SnapshotKey"
& pnpm exec wrangler r2 object get "$BucketName/$SnapshotKey" --file=$file --remote
if ($LASTEXITCODE -ne 0) { throw "wrangler r2 object get failed (exit $LASTEXITCODE)" }

$size = (Get-Item $file).Length
Write-Host "[d1-restore] downloaded $size bytes"

Write-Host "[d1-restore] restoring into $DbName ($Env). This APPENDS — drop tables first if needed."
& pnpm exec wrangler d1 execute $DbName --env $Env --remote --file=$file
if ($LASTEXITCODE -ne 0) { throw "wrangler d1 execute failed (exit $LASTEXITCODE)" }

Remove-Item -Recurse -Force $tmp
Write-Host "[d1-restore] OK"
