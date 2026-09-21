#requires -Version 7
<#
.SYNOPSIS
    Plan 09 Task 6 — Restore a D1 database from an R2 snapshot.

.DESCRIPTION
    Downloads a previously uploaded snapshot from R2 and restores it through
    Wrangler's D1 SQL-file executor. The restore normalizes the export before
    execution: it removes the export's outer transaction and reserved D1
    table, emits ordinary table declarations before data, and splits oversized
    INSERT ... VALUES batches. THIS WILL APPEND ROWS — for a true overwrite,
    use a freshly created throwaway database or an explicitly authorized D1
    restore.

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

function Get-SafeExecutorFailureCategory {
  param([object[]]$Output)

  # Wrangler can include the rejected SQL or data values in its diagnostic.
  # Hold the output in memory only long enough to emit one fixed-vocabulary
  # category; never write provider output to the job log.
  $detail = $Output | Out-String
  if ($detail -match '(?i)statement\s+too\s+long|sqlite_toobig') { return 'statement_too_long' }
  if ($detail -match '(?i)cannot\s+start\s+a\s+transaction|within\s+a\s+transaction') { return 'transaction_wrapper' }
  if ($detail -match '(?i)foreign\s+key') { return 'foreign_key' }
  if ($detail -match '(?i)no\s+such\s+(?:table|column)') { return 'schema_reference' }
  if ($detail -match '(?i)syntax\s+error|parse\s+error') { return 'sql_syntax' }
  if ($detail -match '(?i)too\s+many\s+sql\s+variables') { return 'sql_variable_limit' }
  if ($detail -match '(?i)not\s+authorized|forbidden|permission\s+denied') { return 'authorization' }
  if ($detail -match '(?i)database\s+(?:is\s+)?(?:locked|busy)') { return 'transient_busy' }
  return 'opaque'
}

function Get-SanitizedRestoreMetrics {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][int]$Cap)

  # Measure only SQL statement boundaries and character counts. The snapshot
  # content stays private: this function never returns a statement or value.
  $reader = [System.IO.StreamReader]::new($Path)
  try {
    $statementCount = 0
    $maxStatementChars = 0
    $overCapCount = 0
    $statementChars = 0
    $quote = [char]0
    while (($codePoint = $reader.Read()) -ne -1) {
      $character = [char]$codePoint
      $statementChars++
      if ($quote -ne [char]0) {
        if ($character -eq $quote) {
          if (($quote -eq [char]39 -or $quote -eq [char]34) -and $reader.Peek() -eq [int][char]$quote) {
            [void]$reader.Read()
            $statementChars++
            continue
          }
          $quote = [char]0
        }
        continue
      }
      if ($character -eq [char]39 -or $character -eq [char]34 -or $character -eq [char]96) {
        $quote = $character
        continue
      }
      if ($character -eq [char]91) {
        $quote = [char]93
        continue
      }
      if ($character -ne [char]59) { continue }
      $statementCount++
      if ($statementChars -gt $maxStatementChars) { $maxStatementChars = $statementChars }
      if ($statementChars -gt $Cap) { $overCapCount++ }
      $statementChars = 0
    }
    if ($statementChars -gt 0) {
      $statementCount++
      if ($statementChars -gt $maxStatementChars) { $maxStatementChars = $statementChars }
      if ($statementChars -gt $Cap) { $overCapCount++ }
    }
    return [pscustomobject]@{
      StatementCount = $statementCount
      MaxStatementChars = $maxStatementChars
      OverCapCount = $overCapCount
    }
  } finally {
    $reader.Dispose()
  }
}

function Split-LargeInsertStatement {
  param([Parameter(Mandatory)][string]$Statement)

  # D1 rejects a single SQL statement that exceeds its statement-size limit.
  # Split only standard INSERT ... VALUES batches; unsupported statement forms
  # are returned unchanged rather than risking a semantic rewrite.
  # Keep batches materially below D1's statement ceiling. The file executor
  # may segment an import internally, so leave headroom for its SQL envelope.
  $maxChars = 8000
  if ($Statement.Length -le $maxChars) { return @($Statement) }
  if ($Statement -notmatch '(?is)^(?<header>\s*INSERT\s+INTO\b.*?\bVALUES\s*)(?<values>\(.*\))\s*;\s*$') {
    return @($Statement)
  }

  $header = $Matches.header
  $values = $Matches.values
  $tuples = [System.Collections.Generic.List[string]]::new()
  $quote = [char]0
  $depth = 0
  $tupleStart = -1
  for ($index = 0; $index -lt $values.Length; $index++) {
    $character = $values[$index]
    if ($quote -ne [char]0) {
      if ($character -eq $quote) {
        if (($quote -eq [char]39 -or $quote -eq [char]34) -and $index + 1 -lt $values.Length -and $values[$index + 1] -eq $quote) {
          $index++
          continue
        }
        $quote = [char]0
      }
      continue
    }
    if ($character -eq [char]39 -or $character -eq [char]34 -or $character -eq [char]96) {
      $quote = $character
      continue
    }
    if ($character -eq [char]91) {
      $quote = [char]93
      continue
    }
    if ($character -eq [char]40) {
      if ($depth -eq 0) { $tupleStart = $index }
      $depth++
      continue
    }
    if ($character -eq [char]41) {
      $depth--
      if ($depth -lt 0) { return @($Statement) }
      if ($depth -eq 0 -and $tupleStart -ge 0) {
        $tuples.Add($values.Substring($tupleStart, $index - $tupleStart + 1))
        $tupleStart = -1
      }
      continue
    }
    if ($depth -eq 0 -and $character -ne [char]44 -and -not [char]::IsWhiteSpace($character)) { return @($Statement) }
  }
  if ($quote -ne [char]0 -or $depth -ne 0 -or $tuples.Count -eq 0) { return @($Statement) }

  $chunks = [System.Collections.Generic.List[string]]::new()
  $current = [System.Text.StringBuilder]::new($header)
  foreach ($tuple in $tuples) {
    $separator = if ($current.Length -gt $header.Length) { ',' } else { '' }
    if ($current.Length -gt $header.Length -and $current.Length + $separator.Length + $tuple.Length + 2 -gt $maxChars) {
      [void]$current.Append(";`n")
      $chunks.Add($current.ToString())
      $current = [System.Text.StringBuilder]::new($header)
      $separator = ''
    }
    [void]$current.Append($separator)
    [void]$current.Append($tuple)
  }
  [void]$current.Append(";`n")
  $chunks.Add($current.ToString())
  return $chunks.ToArray()
}

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
  $tablePreambleFile = Join-Path $tmp 'tables.sql'
  $remainingSqlFile = Join-Path $tmp 'remaining.sql'

  Write-Host "[d1-restore] downloading r2://$BucketName/$SnapshotKey"
  $downloadOutput = & pnpm --dir apps/worker exec wrangler r2 object get "$BucketName/$SnapshotKey" --file=$file --remote *>&1
  if ($LASTEXITCODE -ne 0) { throw "wrangler r2 object get failed (exit $LASTEXITCODE)" }

  $size = (Get-Item $file).Length
  Write-Host "[d1-restore] downloaded $size bytes"

  # A D1 export can interleave data for an early table with the declarations
  # of tables it references. Emit all ordinary table declarations first, then
  # replay the remaining SQL in its original order. Foreign-key enforcement is
  # suspended only within the import file and is verified cleanly by the caller.
  $source = [System.IO.StreamReader]::new($file)
  try {
    $tablePreamble = [System.IO.StreamWriter]::new($tablePreambleFile, $false, [System.Text.UTF8Encoding]::new($false))
    $remainingSql = [System.IO.StreamWriter]::new($remainingSqlFile, $false, [System.Text.UTF8Encoding]::new($false))
    try {
      $skippingReservedD1TableStatement = $false
      $pendingTable = $null
      $pendingInsert = $null
      while (($line = $source.ReadLine()) -ne $null) {
        # The restore executor scopes the import transaction. Wrangler SQL
        # exports wrap the dump in an outer transaction, so omit that wrapper.
        if ($skippingReservedD1TableStatement) {
          if ($line -match ';\s*$') { $skippingReservedD1TableStatement = $false }
          continue
        }
        # _cf_KV is reserved by D1 and cannot be re-created or populated from
        # an export. Omit only its exact CREATE/INSERT statements; all other
        # SQL is copied byte-for-line into the private restore file.
        if ($line -match '(?i)^\s*(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO)\s+(?:"_cf_KV"|\[_cf_KV\]|`_cf_KV`|_cf_KV)(?:\s|\(|;|$)') {
          if ($line -notmatch ';\s*$') { $skippingReservedD1TableStatement = $true }
          continue
        }
        if ($line -match '^\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT)\s*;\s*$') { continue }
        if ($null -ne $pendingTable) {
          [void]$pendingTable.AppendLine($line)
          if ($line -match ';\s*$') {
            $tablePreamble.Write($pendingTable.ToString())
            $pendingTable = $null
          }
          continue
        }
        if ($line -match '(?i)^\s*CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\b') {
          $pendingTable = [System.Text.StringBuilder]::new()
          [void]$pendingTable.AppendLine($line)
          if ($line -match ';\s*$') {
            $tablePreamble.Write($pendingTable.ToString())
            $pendingTable = $null
          }
          continue
        }
        if ($null -ne $pendingInsert) {
          [void]$pendingInsert.AppendLine($line)
          if ($line -match ';\s*$') {
            foreach ($chunk in (Split-LargeInsertStatement $pendingInsert.ToString())) { $remainingSql.Write($chunk) }
            $pendingInsert = $null
          }
          continue
        }
        if ($line -match '(?i)^\s*INSERT\s+INTO\b') {
          $pendingInsert = [System.Text.StringBuilder]::new()
          [void]$pendingInsert.AppendLine($line)
          if ($line -match ';\s*$') {
            foreach ($chunk in (Split-LargeInsertStatement $pendingInsert.ToString())) { $remainingSql.Write($chunk) }
            $pendingInsert = $null
          }
          continue
        }
        $remainingSql.WriteLine($line)
      }
      if ($null -ne $pendingTable) { throw 'Restore snapshot ended inside a CREATE TABLE statement.' }
      if ($null -ne $pendingInsert) { throw 'Restore snapshot ended inside an INSERT statement.' }
    } finally {
      $remainingSql.Dispose()
      $tablePreamble.Dispose()
    }
  } finally {
    $source.Dispose()
  }
  [System.IO.File]::WriteAllText(
    $restoreFile,
    "PRAGMA foreign_keys = OFF;`nPRAGMA defer_foreign_keys = TRUE;`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  $restoreDestination = [System.IO.StreamWriter]::new($restoreFile, $true, [System.Text.UTF8Encoding]::new($false))
  try {
    foreach ($part in @($tablePreambleFile, $remainingSqlFile)) {
      $restoreDestination.Write([System.IO.File]::ReadAllText($part, [System.Text.UTF8Encoding]::new($false)))
    }
  } finally {
    $restoreDestination.Dispose()
  }
  [System.IO.File]::AppendAllText(
    $restoreFile,
    "PRAGMA foreign_keys = ON;`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  $metrics = Get-SanitizedRestoreMetrics -Path $restoreFile -Cap 8000
  Write-Host "[d1-restore] sanitized statements=$($metrics.StatementCount) max_chars=$($metrics.MaxStatementChars) over_cap=$($metrics.OverCapCount)"

  $executeOutput = & pnpm --dir apps/worker exec wrangler d1 execute $DbName --remote --file=$restoreFile *>&1
  if ($LASTEXITCODE -ne 0) {
    $category = Get-SafeExecutorFailureCategory $executeOutput
    throw "wrangler d1 execute import failed (category=$category; exit $LASTEXITCODE)."
  }

  Write-Host "[d1-restore] import complete into $DbName ($Env)"
} finally {
  if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}
