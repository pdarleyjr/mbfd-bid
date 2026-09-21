#requires -Version 7
<#
.SYNOPSIS
    Plan 09 Task 6 — Restore a D1 database from an R2 snapshot.

.DESCRIPTION
    Downloads a previously uploaded snapshot from R2 and restores it through
    D1's asynchronous import API. The restore normalizes the export before
    upload: it removes the export's outer transaction and reserved D1 table,
    emits ordinary table declarations before data, splits oversized
    INSERT ... VALUES batches, and replays a singleton oversized text literal
    through D1's bound-query API. THIS WILL APPEND ROWS — for a true overwrite,
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

function Get-SafePropertyNames {
  param([object]$Value)
  if ($null -eq $Value) { return 'none' }
  $names = @(
    $Value.PSObject.Properties.Name |
      ForEach-Object { if ($_ -match '^[A-Za-z0-9_]{1,64}$') { $_ } else { 'nonstandard' } } |
      Sort-Object -Unique
  )
  if ($names.Count -eq 0) { return 'none' }
  return ($names -join ',')
}

function Get-SafeImportFailureCategory {
  param([object]$ErrorValue)

  # Provider output can include SQL fragments or data values. Hold it only in
  # memory long enough to emit one fixed-vocabulary category.
  $detail = if ($ErrorValue -is [string]) { $ErrorValue } else { '' }
  if ([string]::IsNullOrWhiteSpace($detail) -and $null -ne $ErrorValue) {
    foreach ($propertyName in @('message', 'error', 'detail')) {
      $property = $ErrorValue.PSObject.Properties[$propertyName]
      if ($null -ne $property -and $property.Value -is [string]) {
        $detail = $property.Value
        break
      }
    }
  }
  if ([string]::IsNullOrWhiteSpace($detail)) { return 'opaque' }
  if ($detail -match '(?i)statement\s+too\s+long|sqlite_toobig') { return 'statement_too_long' }
  if ($detail -match '(?i)request\s+(?:body|entity|payload).{0,40}(?:too\s+large|exceed)|(?:body|entity|payload).{0,40}(?:too\s+large|exceed)') { return 'request_too_large' }
  if ($detail -match '(?i)invalid\s+(?:json|request|parameter)|malformed\s+(?:json|request)') { return 'invalid_request' }
  if ($detail -match '(?i)bind(?:ing)?\s+(?:parameter|value)|invalid\s+(?:parameter|binding)') { return 'parameter_binding' }
  if ($detail -match '(?i)cannot\s+start\s+a\s+transaction|within\s+a\s+transaction') { return 'transaction_wrapper' }
  if ($detail -match '(?i)foreign\s+key') { return 'foreign_key' }
  if ($detail -match '(?i)no\s+such\s+(?:table|column)') { return 'schema_reference' }
  if ($detail -match '(?i)syntax\s+error|parse\s+error') { return 'sql_syntax' }
  if ($detail -match '(?i)too\s+many\s+sql\s+variables') { return 'sql_variable_limit' }
  if ($detail -match '(?i)not\s+authorized|forbidden|permission\s+denied') { return 'authorization' }
  if ($detail -match '(?i)database\s+(?:is\s+)?(?:locked|busy)') { return 'transient_busy' }
  $safeTokens = @(
    [regex]::Matches($detail.ToLowerInvariant(), '[a-z0-9_]+') |
      ForEach-Object { $_.Value } |
      Where-Object { $_ -in @('authorization', 'busy', 'column', 'constraint', 'database', 'foreign', 'import', 'internal', 'invalid', 'key', 'limit', 'locked', 'malformed', 'memory', 'parse', 'permission', 'quota', 'schema', 'size', 'sql', 'statement', 'syntax', 'table', 'timeout', 'token', 'transaction', 'unicode', 'unsupported', 'utf8', 'variable') } |
      Select-Object -Unique -First 4
  )
  if ($safeTokens.Count -gt 0) { return "provider_$($safeTokens -join '_')" }
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
    $overCapInsertCount = 0
    $overCapCreateCount = 0
    $overCapOtherCount = 0
    $statementChars = 0
    $statementPrefix = [System.Text.StringBuilder]::new()
    $quote = [char]0
    while (($codePoint = $reader.Read()) -ne -1) {
      $character = [char]$codePoint
      $statementChars++
      if ($statementPrefix.Length -lt 64) { [void]$statementPrefix.Append($character) }
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
      if ($statementChars -gt $Cap) {
        $overCapCount++
        $prefix = $statementPrefix.ToString()
        if ($prefix -match '(?i)^\s*INSERT\b|^\s*REPLACE\b') { $overCapInsertCount++ }
        elseif ($prefix -match '(?i)^\s*CREATE\b') { $overCapCreateCount++ }
        else { $overCapOtherCount++ }
      }
      $statementChars = 0
      $statementPrefix.Clear() | Out-Null
    }
    if ($statementChars -gt 0) {
      $statementCount++
      if ($statementChars -gt $maxStatementChars) { $maxStatementChars = $statementChars }
      if ($statementChars -gt $Cap) {
        $overCapCount++
        $prefix = $statementPrefix.ToString()
        if ($prefix -match '(?i)^\s*INSERT\b|^\s*REPLACE\b') { $overCapInsertCount++ }
        elseif ($prefix -match '(?i)^\s*CREATE\b') { $overCapCreateCount++ }
        else { $overCapOtherCount++ }
      }
    }
    return [pscustomobject]@{
      StatementCount = $statementCount
      MaxStatementChars = $maxStatementChars
      OverCapCount = $overCapCount
      OverCapInsertCount = $overCapInsertCount
      OverCapCreateCount = $overCapCreateCount
      OverCapOtherCount = $overCapOtherCount
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
  if ($Statement -notmatch '(?is)^(?<header>\s*INSERT(?:\s+OR\s+(?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))?\s+INTO\b.*?\bVALUES\s*)(?<values>\(.*\))\s*;\s*$') {
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

function Get-Utf8ByteCount {
  param([Parameter(Mandatory)][string]$Value)

  return [System.Text.Encoding]::UTF8.GetByteCount($Value)
}

function Convert-OversizedInsertToBoundRequest {
  param(
    [Parameter(Mandatory)][string]$Statement,
    [Parameter(Mandatory)][int]$MaxSqlBytes
  )

  # D1 limits SQL text to 100 KB, but allows a text value/row up to 2 MB.
  # Preserve the original SQL spelling and types except for only the text
  # literals needed to bring this INSERT below the SQL-text limit. The values
  # stay in memory and the JSON request body; no SQL or values are logged.
  if ($Statement -notmatch '(?is)^\s*INSERT(?:\s+OR\s+(?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))?\s+INTO\b') {
    return $null
  }

  $literals = [System.Collections.Generic.List[object]]::new()
  $index = 0
  while ($index -lt $Statement.Length) {
    $character = $Statement[$index]
    if ($character -eq [char]39) {
      $start = $index
      $value = [System.Text.StringBuilder]::new()
      $index++
      $closed = $false
      while ($index -lt $Statement.Length) {
        $current = $Statement[$index]
        if ($current -eq [char]39) {
          if ($index + 1 -lt $Statement.Length -and $Statement[$index + 1] -eq [char]39) {
            [void]$value.Append([char]39)
            $index += 2
            continue
          }
          $index++
          $closed = $true
          break
        }
        [void]$value.Append($current)
        $index++
      }
      if (-not $closed) { return $null }
      $literals.Add([pscustomobject]@{
        Start = $start
        Length = $index - $start
        Value = $value.ToString()
      })
      continue
    }
    if ($character -eq [char]34 -or $character -eq [char]96 -or $character -eq [char]91) {
      $closing = if ($character -eq [char]91) { [char]93 } else { $character }
      $index++
      $closed = $false
      while ($index -lt $Statement.Length) {
        if ($Statement[$index] -eq $closing) {
          if ($closing -ne [char]93 -and $index + 1 -lt $Statement.Length -and $Statement[$index + 1] -eq $closing) {
            $index += 2
            continue
          }
          $index++
          $closed = $true
          break
        }
        $index++
      }
      if (-not $closed) { return $null }
      continue
    }
    $index++
  }

  $remainingBytes = Get-Utf8ByteCount $Statement
  $selected = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($literal in @($literals | Sort-Object -Property @{ Expression = { $_.Length }; Descending = $true }, @{ Expression = { $_.Start }; Descending = $false })) {
    if ($remainingBytes -le $MaxSqlBytes) { break }
    if ($literal.Length -le 2) { continue }
    [void]$selected.Add($literal.Start)
    $remainingBytes -= (Get-Utf8ByteCount ($Statement.Substring($literal.Start, $literal.Length))) - 1
  }
  if ($selected.Count -eq 0 -or $remainingBytes -gt $MaxSqlBytes -or $selected.Count -gt 100) {
    return $null
  }

  $sql = [System.Text.StringBuilder]::new()
  $params = [System.Collections.Generic.List[string]]::new()
  $cursor = 0
  foreach ($literal in @($literals | Sort-Object Start)) {
    [void]$sql.Append($Statement.Substring($cursor, $literal.Start - $cursor))
    if ($selected.Contains($literal.Start)) {
      [void]$sql.Append('?')
      $params.Add($literal.Value)
    } else {
      [void]$sql.Append($Statement.Substring($literal.Start, $literal.Length))
    }
    $cursor = $literal.Start + $literal.Length
  }
  [void]$sql.Append($Statement.Substring($cursor))
  if ((Get-Utf8ByteCount $sql.ToString()) -gt $MaxSqlBytes) { return $null }

  return [pscustomobject]@{
    Sql = $sql.ToString()
    Params = $params.ToArray()
  }
}

function Split-RestoreImportAndBoundInserts {
  param(
    [Parameter(Mandatory)][string]$SourcePath,
    [Parameter(Mandatory)][string]$ImportPath,
    [Parameter(Mandatory)][int]$MaxSqlBytes
  )

  $deferred = [System.Collections.Generic.List[object]]::new()
  $source = [System.IO.StreamReader]::new($SourcePath)
  $destination = [System.IO.StreamWriter]::new($ImportPath, $false, [System.Text.UTF8Encoding]::new($false))
  try {
    $statement = [System.Text.StringBuilder]::new()
    $quote = [char]0
    while (($codePoint = $source.Read()) -ne -1) {
      $character = [char]$codePoint
      [void]$statement.Append($character)
      if ($quote -ne [char]0) {
        if ($character -eq $quote) {
          if (($quote -eq [char]39 -or $quote -eq [char]34) -and $source.Peek() -eq [int][char]$quote) {
            [void]$statement.Append([char]$source.Read())
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

      $completedStatement = $statement.ToString()
      if ((Get-Utf8ByteCount $completedStatement) -gt $MaxSqlBytes) {
        $bound = Convert-OversizedInsertToBoundRequest -Statement $completedStatement -MaxSqlBytes $MaxSqlBytes
        if ($null -eq $bound) {
          throw 'Restore contains an oversized SQL statement that cannot be losslessly replayed with bound text parameters.'
        }
        $deferred.Add($bound)
      } else {
        $destination.Write($completedStatement)
      }
      $statement.Clear() | Out-Null
    }
    if ($statement.Length -gt 0) {
      if (-not [string]::IsNullOrWhiteSpace($statement.ToString())) {
        throw 'Restore snapshot ended before a SQL statement terminator.'
      }
      $destination.Write($statement.ToString())
    }
  } finally {
    $destination.Dispose()
    $source.Dispose()
  }
  return $deferred.ToArray()
}

function Invoke-BoundOversizedInsertReplay {
  param(
    [Parameter(Mandatory)][string]$ApiUri,
    [Parameter(Mandatory)][hashtable]$Headers,
    [Parameter(Mandatory)][object[]]$Statements
  )

  if ($Statements.Count -eq 0) { return }
  # D1 permits a 2 MB bound value, while REST API work must complete within a
  # bounded batch call. Keep aggregate JSON requests small and accept one
  # larger singleton only when the one value itself requires it.
  $maxReplayRequestBytes = 512KB
  function New-BoundReplayBatch([object[]]$ReplayStatements) {
    $batch = [System.Collections.Generic.List[object]]::new()
    foreach ($statement in $ReplayStatements) {
      $batch.Add(@{ sql = $statement.Sql; params = @($statement.Params) })
    }
    return @($batch)
  }
  function Get-BoundReplayBody([object[]]$ReplayStatements) {
    return @{ batch = @(New-BoundReplayBatch $ReplayStatements) } | ConvertTo-Json -Depth 5 -Compress
  }
  function Invoke-BoundReplayBatch([object[]]$ReplayStatements) {
    $batch = @(New-BoundReplayBatch $ReplayStatements)
    $body = Get-BoundReplayBody $ReplayStatements
    $requestBytes = Get-Utf8ByteCount $body
    try {
      $response = Invoke-RestMethod -Method Post -Uri ($ApiUri -replace '/import$', '/query') -Headers $Headers -ContentType 'application/json' -Body $body -ErrorAction Stop
    } catch {
      $category = 'transport_failure'
      $detail = $null
      try { $detail = $_.ErrorDetails.Message } catch {}
      if (-not [string]::IsNullOrWhiteSpace($detail)) {
        $category = Get-SafeImportFailureCategory $detail
      }
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
        if ($statusCode -ge 100 -and $statusCode -le 599) {
          $category = if ($category -eq 'transport_failure' -or $category -eq 'opaque') {
            "http_status_$statusCode"
          } else {
            "$category`_http_status_$statusCode"
          }
        }
      } catch {}
      Write-Host "[d1-restore] bound replay request failure category=$category request_bytes=$requestBytes batch_queries=$($batch.Count)"
      throw "D1 bound oversized-insert replay request failed (category=$category)."
    }
    if ($response.success -ne $true) {
      $category = Get-SafeImportFailureCategory $response.errors
      throw "D1 bound oversized-insert replay reported failure (category=$category)."
    }
    $results = @($response.result)
    if ($results.Count -ne $batch.Count -or @($results | Where-Object { $_.success -ne $true }).Count -gt 0) {
      throw 'D1 bound oversized-insert replay returned an incomplete result set.'
    }
  }

  $pending = [System.Collections.Generic.List[object]]::new()
  $replayBatches = [System.Collections.Generic.List[object[]]]::new()
  foreach ($statement in $Statements) {
    $candidate = @($pending.ToArray() + @($statement))
    $candidateBody = Get-BoundReplayBody $candidate
    if ($pending.Count -gt 0 -and (Get-Utf8ByteCount $candidateBody) -gt $maxReplayRequestBytes) {
      $replayBatches.Add($pending.ToArray())
      $pending = [System.Collections.Generic.List[object]]::new()
    }
    $pending.Add($statement)
  }
  if ($pending.Count -gt 0) { $replayBatches.Add($pending.ToArray()) }
  foreach ($replayBatch in $replayBatches) {
    Invoke-BoundReplayBatch $replayBatch
  }
  $paramCount = @($Statements | ForEach-Object { @($_.Params).Count } | Measure-Object -Sum).Sum
  Write-Host "[d1-restore] bound oversized inserts replayed=$($Statements.Count) params=$paramCount batches=$($replayBatches.Count)"
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
  $importFile = Join-Path $tmp 'import.sql'
  $tablePreambleFile = Join-Path $tmp 'tables.sql'
  $remainingSqlFile = Join-Path $tmp 'remaining.sql'
  $headers = @{ Authorization = "Bearer $($env:CLOUDFLARE_API_TOKEN)" }

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
        if ($line -match '(?i)^\s*INSERT(?:\s+OR\s+(?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))?\s+INTO\b') {
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
  Write-Host "[d1-restore] sanitized statements=$($metrics.StatementCount) max_chars=$($metrics.MaxStatementChars) over_cap=$($metrics.OverCapCount) inserts=$($metrics.OverCapInsertCount) creates=$($metrics.OverCapCreateCount) other=$($metrics.OverCapOtherCount)"
  # The D1 SQL text ceiling is 100 KB. Keep a 10 KB UTF-8 headroom for the
  # import transport and replay only necessary singleton text literals through
  # bound parameters after the normalized file import succeeds.
  $boundStatements = @(Split-RestoreImportAndBoundInserts -SourcePath $restoreFile -ImportPath $importFile -MaxSqlBytes 90000)

  $databaseInfoOutput = & pnpm --dir apps/worker exec wrangler d1 info $DbName --json *>&1
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
  $etag = (Get-FileHash -LiteralPath $importFile -Algorithm MD5).Hash.ToLowerInvariant()
  try {
    $init = Invoke-RestMethod -Method Post -Uri $apiUri -Headers $headers -ContentType 'application/json' -Body (@{ action = 'init'; etag = $etag } | ConvertTo-Json -Compress) -ErrorAction Stop
  } catch {
    throw 'D1 import initialization failed.'
  }
  if ($init.success -ne $true -or $init.result.upload_url -isnot [string] -or [string]::IsNullOrWhiteSpace($init.result.filename)) {
    throw 'D1 import initialization returned no usable upload target.'
  }
  try {
    Invoke-WebRequest -Method Put -Uri $init.result.upload_url -InFile $importFile -ErrorAction Stop | Out-Null
  } catch {
    throw 'D1 import upload failed.'
  }
  try {
    $ingest = Invoke-RestMethod -Method Post -Uri $apiUri -Headers $headers -ContentType 'application/json' -Body (@{ action = 'ingest'; etag = $etag; filename = $init.result.filename } | ConvertTo-Json -Compress) -ErrorAction Stop
  } catch {
    throw 'D1 import ingest request failed.'
  }
  if ($ingest.success -ne $true) { throw 'D1 import ingest request failed.' }

  $completed = $ingest.result.status -eq 'complete' -or $ingest.result.success -eq $true
  if (-not $completed) {
    if ($ingest.result.status -eq 'error' -or $ingest.result.success -eq $false) {
      $category = Get-SafeImportFailureCategory $ingest.result.error
      throw "D1 import reported failure (category=$category)."
    }
    $bookmark = $ingest.result.at_bookmark
    if ([string]::IsNullOrWhiteSpace($bookmark)) {
      $topShape = Get-SafePropertyNames $ingest
      $resultShape = Get-SafePropertyNames $ingest.result
      throw "D1 import ingest request returned neither completion nor a status bookmark (top=$topShape; result=$resultShape)."
    }
    for ($attempt = 1; $attempt -le $PollAttempts; $attempt++) {
      if ($PollIntervalSeconds -gt 0) { Start-Sleep -Seconds $PollIntervalSeconds }
      try {
        $poll = Invoke-RestMethod -Method Post -Uri $apiUri -Headers $headers -ContentType 'application/json' -Body (@{ action = 'poll'; current_bookmark = $bookmark } | ConvertTo-Json -Compress) -ErrorAction Stop
      } catch {
        throw 'D1 import status poll failed.'
      }
      if ($poll.success -ne $true) { throw 'D1 import status poll reported failure.' }
      if ($poll.result.status -eq 'error' -or $poll.result.success -eq $false) {
        $category = Get-SafeImportFailureCategory $poll.result.error
        throw "D1 import reported failure (category=$category)."
      }
      if ($poll.result.status -eq 'complete' -or $poll.result.success -eq $true) {
        $completed = $true
        break
      }
    }
  }
  if (-not $completed) { throw 'D1 import did not complete before the bounded polling window expired.' }

  Invoke-BoundOversizedInsertReplay -ApiUri $apiUri -Headers $headers -Statements $boundStatements

  Write-Host "[d1-restore] import complete into $DbName ($Env)"
} finally {
  if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}
