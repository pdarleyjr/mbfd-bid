#requires -Version 7
<#
.SYNOPSIS
    Plan 09 Task 6 — Restore a D1 database from an R2 snapshot.

.DESCRIPTION
    Downloads a previously uploaded snapshot from R2 and restores it through
    D1's asynchronous import API. The API avoids sending a production export
    through the synchronous statement executor, which rejects oversized
    statements. THIS WILL APPEND ROWS — for a true overwrite, use a freshly
    created throwaway database or an explicitly authorized D1 restore.

    Tested-restore-path target for Plan 09 Task 6 Step 4: create a throwaway
    D1, restore staging into it, count rows, drop the throwaway. The script
    accepts that flow without modification.

.PARAMETER Env
    Release-scope label recorded in the sanitized progress output.

.PARAMETER DbName
    Database name as declared in wrangler.toml.

.PARAMETER BucketName
    R2 bucket name containing the snapshot.

.PARAMETER SnapshotKey
    Object key of the snapshot inside the bucket. Example:
    `d1/2026-05-17/mbfd-bid-staging-2026-05-17-0600.sql`.

.PARAMETER PollAttempts
    Maximum asynchronous D1-import status checks before failing closed.

.PARAMETER PollIntervalSeconds
    Delay between asynchronous D1-import status checks.

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
  [Parameter(Mandatory)][string]$SnapshotKey,
  [ValidateRange(1, 720)][int]$PollAttempts = 120,
  [ValidateRange(0, 60)][int]$PollIntervalSeconds = 5
)
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN) -or [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_ACCOUNT_ID)) {
  throw 'D1 restore requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the execution environment.'
}

$tempRoot = [System.Environment]::GetEnvironmentVariable('TEMP', 'Process')
if ([string]::IsNullOrWhiteSpace($tempRoot)) {
  $tempRoot = [System.IO.Path]::GetTempPath()
}
if ([string]::IsNullOrWhiteSpace($tempRoot)) {
  throw 'No temporary directory is available for the D1 restore snapshot.'
}
$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot "d1-restore-$(Get-Random)")
try {
  $file = Join-Path $tmp 'snapshot.sql'
  $restoreFile = Join-Path $tmp 'restore.sql'
  $headers = @{ Authorization = "Bearer $($env:CLOUDFLARE_API_TOKEN)" }

  Write-Host "[d1-restore] downloading r2://$BucketName/$SnapshotKey"
  $downloadOutput = & pnpm exec wrangler r2 object get "$BucketName/$SnapshotKey" --file=$file --remote *>&1
  if ($LASTEXITCODE -ne 0) { throw "wrangler r2 object get failed (exit $LASTEXITCODE)" }

  $size = (Get-Item $file).Length
  Write-Host "[d1-restore] downloaded $size bytes"

  # A D1 export replays table data in table order. Defer relationship checks
  # only while the asynchronous import runs; its caller must still run a clean
  # foreign_key_check before accepting the restored database.
  [System.IO.File]::WriteAllText(
    $restoreFile,
    "PRAGMA defer_foreign_keys = TRUE;`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  $source = [System.IO.File]::OpenRead($file)
  try {
    $destination = [System.IO.File]::Open($restoreFile, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $source.CopyTo($destination)
    } finally {
      $destination.Dispose()
    }
  } finally {
    $source.Dispose()
  }

  $databaseInfoOutput = & pnpm exec wrangler d1 info $DbName --json *>&1
  if ($LASTEXITCODE -ne 0) { throw 'D1 database lookup failed; import not started.' }
  try {
    $databaseId = (($databaseInfoOutput | Out-String) | ConvertFrom-Json -ErrorAction Stop).uuid
  } catch {
    throw 'D1 database lookup returned invalid JSON; import not started.'
  }
  if ($databaseId -isnot [string] -or $databaseId -notmatch '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$') {
    throw 'D1 database lookup omitted a valid database identifier; import not started.'
  }

  $apiUri = "https://api.cloudflare.com/client/v4/accounts/$($env:CLOUDFLARE_ACCOUNT_ID)/d1/database/$databaseId/import"
  $etag = (Get-FileHash -LiteralPath $restoreFile -Algorithm MD5).Hash.ToLowerInvariant()
  try {
    $init = Invoke-RestMethod -Method Post -Uri $apiUri -Headers $headers -ContentType 'application/json' -Body (@{ action = 'init'; etag = $etag } | ConvertTo-Json -Compress) -ErrorAction Stop
  } catch {
    throw 'D1 import initialization failed.'
  }
  if ($init.success -ne $true -or $init.result.upload_url -isnot [string] -or [string]::IsNullOrWhiteSpace($init.result.filename)) {
    throw 'D1 import initialization returned no usable upload target.'
  }

  try {
    Invoke-WebRequest -Method Put -Uri $init.result.upload_url -InFile $restoreFile -ErrorAction Stop | Out-Null
  } catch {
    throw 'D1 import upload failed.'
  }
  try {
    $ingest = Invoke-RestMethod -Method Post -Uri $apiUri -Headers $headers -ContentType 'application/json' -Body (@{ action = 'ingest'; etag = $etag; filename = $init.result.filename } | ConvertTo-Json -Compress) -ErrorAction Stop
  } catch {
    throw 'D1 import ingest request failed.'
  }
  if ($ingest.success -ne $true -or $ingest.result.at_bookmark -isnot [string]) {
    throw 'D1 import ingest request returned no status bookmark.'
  }

  $completed = $false
  for ($attempt = 1; $attempt -le $PollAttempts; $attempt++) {
    if ($PollIntervalSeconds -gt 0) { Start-Sleep -Seconds $PollIntervalSeconds }
    try {
      $poll = Invoke-RestMethod -Method Post -Uri $apiUri -Headers $headers -ContentType 'application/json' -Body (@{ action = 'poll'; current_bookmark = $ingest.result.at_bookmark } | ConvertTo-Json -Compress) -ErrorAction Stop
    } catch {
      throw 'D1 import status poll failed.'
    }
    if ($poll.success -ne $true) { throw 'D1 import status poll reported failure.' }
    if ($poll.result.status -eq 'error') { throw 'D1 import reported failure.' }
    if ($poll.result.status -eq 'complete') {
      $completed = $true
      break
    }
  }
  if (-not $completed) { throw 'D1 import did not complete before the bounded polling window expired.' }

  Write-Host "[d1-restore] import complete into $DbName ($Env)"
} finally {
  if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}
