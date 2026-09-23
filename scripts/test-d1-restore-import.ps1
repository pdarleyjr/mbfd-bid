#requires -Version 7
$ErrorActionPreference = 'Stop'

function Assert-True {
  param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Normalize-OutputText {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  return (($Text -replace "`r?`n", ' ') -replace '\s+', ' ').Trim()
}

$originalToken = $env:CLOUDFLARE_API_TOKEN
$originalAccount = $env:CLOUDFLARE_ACCOUNT_ID
$originalTemp = $env:TEMP
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "d1-restore-import-test-$([guid]::NewGuid().ToString('N'))"
$env:CLOUDFLARE_API_TOKEN = 'synthetic-private-token'
$env:CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
$env:TEMP = $testRoot
New-Item -ItemType Directory -Path $testRoot | Out-Null

foreach ($scenario in @('success', 'poll-legacy-complete', 'ingest-complete', 'ingest-legacy-complete', 'ingest-missing-state', 'ingest-error', 'ingest-structured-error', 'init-fails', 'temp-fallback', 'split-replace-batch', 'bound-replay-batched', 'bound-replay-multiple-values', 'bound-replay-explicit-columns', 'bound-replay-unicode', 'bound-replay-quotes-empty', 'bound-replay-parameter-limit', 'bound-replay-transport-failure', 'bound-replay-http-400', 'bound-replay-http-500-retry', 'json-whoami-account-id')) {
  $state = [pscustomobject]@{ Calls = [System.Collections.Generic.List[string]]::new(); RestoreText = $null; PollCount = 0; StagedReplayRequests = [System.Collections.Generic.List[object]]::new(); StagedChunks = [System.Collections.Generic.List[object]]::new(); ExpectedBoundValue = $null; NextRowId = 900000 }
  function global:pnpm {
    $commandText = $args -join ' '
    $state.Calls.Add($commandText)
    $global:LASTEXITCODE = 0
    if ($commandText -match 'whoami --json') {
      if ($scenario -eq 'json-whoami-account-id') {
        $json = @{ account = @{ id = 'fedcba9876543210fedcba9876543210'; name = 'synthetic account' } } | ConvertTo-Json -Compress
        $output = [System.Text.StringBuilder]::new()
        [void]$output.AppendLine($json)
        $output.ToString() | Write-Output
        return
      }
      return '{"account":{"id":"0123456789abcdef0123456789abcdef"}}'
    }
    if ($commandText -match 'r2 object get') {
      $filePath = ($args | Where-Object { $_ -like '--file=*' }).Substring(7)
      $largeRows = (1..1600 | ForEach-Object { "($_, 'synthetic-row-payload-0123456789abcdef0123456789abcdef', 'synthetic-row-payload-0123456789abcdef0123456789abcdef')" }) -join ','
      $replayScenarios = @('success', 'poll-legacy-complete', 'ingest-complete', 'ingest-legacy-complete', 'temp-fallback', 'split-replace-batch', 'bound-replay-batched', 'bound-replay-multiple-values', 'bound-replay-explicit-columns', 'bound-replay-unicode', 'bound-replay-quotes-empty', 'bound-replay-parameter-limit', 'bound-replay-transport-failure', 'bound-replay-http-400', 'bound-replay-http-500-retry', 'json-whoami-account-id')
      $deferredPayload = if ($scenario -eq 'bound-replay-unicode') { ('🙂' * 40000) -join '' } elseif ($scenario -eq 'bound-replay-quotes-empty') { ("O'Brien " * 14000) -join '' } elseif ($scenario -in $replayScenarios) { ('synthetic-bound-private-payload-' * 3000) -join '' } else { 'small' }
      $deferredSqlPayload = $deferredPayload.Replace("'", "''")
      if ($scenario -eq 'bound-replay-unicode') { $state.ExpectedBoundValue = $deferredPayload }
      if ($scenario -eq 'bound-replay-quotes-empty') { $state.ExpectedBoundValue = $deferredPayload }
      $deferredInserts = if ($scenario -eq 'bound-replay-batched') {
        (1..8 | ForEach-Object { "INSERT INTO synthetic VALUES ($(900000 + $_), '$deferredSqlPayload$_');" }) -join "`n"
      } elseif ($scenario -eq 'bound-replay-multiple-values') {
        "INSERT INTO synthetic VALUES (900001, '$deferredSqlPayload', '$deferredSqlPayload');"
      } elseif ($scenario -eq 'bound-replay-explicit-columns') {
        "INSERT INTO synthetic (note, id) VALUES ('$deferredSqlPayload', 900001);"
      } elseif ($scenario -eq 'bound-replay-parameter-limit') {
        "INSERT INTO synthetic VALUES (" + ((1..101 | ForEach-Object { "'$deferredSqlPayload'" }) -join ',') + ');'
      } else {
        "INSERT INTO synthetic VALUES (900001, '$deferredSqlPayload');"
      }
      $largeInsert = if ($scenario -eq 'split-replace-batch') { 'INSERT OR REPLACE INTO synthetic VALUES' } else { 'INSERT INTO synthetic VALUES' }
      [System.IO.File]::WriteAllText($filePath, "BEGIN TRANSACTION;`nCREATE TABLE _cf_KV (`n key TEXT PRIMARY KEY,`n value BLOB`n) WITHOUT ROWID;`nINSERT INTO _cf_KV VALUES ('synthetic-reserved');`nCREATE TABLE synthetic (id INTEGER PRIMARY KEY, note TEXT, note_two TEXT);`nINSERT INTO synthetic VALUES (1, 'small', 'small');`nINSERT INTO synthetic VALUES (2, '', '');`n$largeInsert $largeRows;`n$deferredInserts`nCREATE TABLE referenced_later (id INTEGER PRIMARY KEY);`nCOMMIT;`n")
      return
    }
    if ($commandText -match 'd1 info') { return '{"uuid":"01234567-89ab-cdef-0123-456789abcdef"}' }
    throw "Unexpected CLI command: $commandText"
  }
  function global:Invoke-RestMethod {
    param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$ContentType, [string]$Body)
    $payload = $Body | ConvertFrom-Json
    if ($null -ne $payload.batch -or ($null -ne $payload.sql -and $null -ne $payload.params)) {
      throw 'Staged replay must use a status-readable HTTP response.'
    }
    $action = $payload.action
    if ($action -eq 'init') {
      if ($scenario -eq 'init-fails') { return [pscustomobject]@{ success = $false; result = [pscustomobject]@{} } }
      return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ upload_url = 'https://synthetic.invalid/private-upload'; filename = 'private.sql' } }
    }
    if ($action -eq 'ingest') {
      if ($scenario -eq 'ingest-complete') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ status = 'complete' } } }
      if ($scenario -eq 'ingest-legacy-complete') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ success = $true; error = $null } } }
      if ($scenario -eq 'ingest-missing-state') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ safe_flag = 'synthetic-private-ingest-detail' } } }
      if ($scenario -eq 'ingest-error') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ status = 'error'; error = 'synthetic-private-error: cannot start a transaction within a transaction' } } }
      if ($scenario -eq 'ingest-structured-error') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ status = 'error'; error = [pscustomobject]@{ message = 'synthetic-private-error: unsupported SQL statement'; code = 777 } } } }
      return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ at_bookmark = '00000001-00000002-00000003-0123456789abcdef' } }
    }
    if ($action -eq 'poll') {
      $state.PollCount++
      if ($scenario -eq 'poll-legacy-complete') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ success = $true; error = $null } } }
      return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ status = 'complete' } }
    }
    throw "Unexpected REST action: $action"
  }
  function global:Invoke-WebRequest {
    param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$ContentType, [string]$Body, [string]$InFile, [switch]$SkipHttpErrorCheck)
    if (-not [string]::IsNullOrWhiteSpace($InFile)) {
      $state.RestoreText = [System.IO.File]::ReadAllText($InFile)
      return [pscustomobject]@{ StatusCode = 200 }
    }
    $payload = $Body | ConvertFrom-Json
    if ($null -ne $payload.batch -or $null -eq $payload.sql) {
      throw "Unexpected WebRequest payload: $Uri"
    }
    if (-not $SkipHttpErrorCheck) { throw 'Staged replay did not request a readable HTTP error response.' }
    $kind = if ($payload.sql -match '(?i)^CREATE TABLE IF NOT EXISTS "__mbfd_restore_chunks_[0-9a-f]+"') { 'stage_create' }
      elseif ($payload.sql -match '(?i)^INSERT OR REPLACE INTO "__mbfd_restore_chunks_[0-9a-f]+"') { 'stage_chunk' }
      elseif ($payload.sql -match '(?i)^DROP TABLE IF EXISTS "__mbfd_restore_chunks_[0-9a-f]+"') { 'stage_cleanup' }
      elseif ($payload.sql -match '(?i)^INSERT\b') { 'insert_atomic' }
      else { 'unexpected' }
    if ($kind -eq 'insert_atomic' -and ($null -eq $payload.params -or @($payload.params).Count -eq 0)) { throw 'Atomic insert omitted bound parameters.' }
    $params = if ($null -eq $payload.params) { @() } else { @($payload.params) }
    $state.StagedReplayRequests.Add([pscustomobject]@{ Kind = $kind; Uri = $Uri; Sql = "$($payload.sql)"; Params = $params; Bytes = [System.Text.Encoding]::UTF8.GetByteCount($Body) })
    if ($kind -eq 'stage_chunk') {
      if ($params.Count -ne 4) { throw 'Staged chunk request did not use the bounded four-parameter contract.' }
      $state.StagedChunks.Add([pscustomobject]@{ Statement = [int]$params[0]; Value = [int]$params[1]; Chunk = [int]$params[2]; Text = [string]$params[3] })
    }
    if ($kind -eq 'insert_atomic' -and $scenario -eq 'bound-replay-transport-failure') { throw 'synthetic-bound-replay-provider-detail' }
    if ($kind -eq 'insert_atomic' -and $scenario -eq 'bound-replay-http-400') {
      return [pscustomobject]@{ StatusCode = 400; Content = '{"errors":[{"code":9001,"message":"synthetic-bound-replay-provider-detail"}]}' }
    }
    if ($kind -eq 'stage_create' -and $scenario -eq 'bound-replay-http-500-retry' -and @($state.StagedReplayRequests | Where-Object { $_.Kind -eq 'stage_create' }).Count -eq 1) {
      return [pscustomobject]@{ StatusCode = 500; Content = '{"errors":[{"code":7500,"message":"synthetic-transient-provider-detail"}]}' }
    }
    $result = if ($kind -in @('stage_chunk', 'insert_atomic')) {
      $state.NextRowId++
      $meta = [ordered]@{ changes = 1 }
      [pscustomobject]@{ success = $true; results = [pscustomobject]@{ columns = @(); rows = @() }; meta = [pscustomobject]$meta }
    } elseif ($kind -in @('stage_create', 'stage_cleanup')) {
      [pscustomobject]@{ success = $true; results = [pscustomobject]@{ columns = @(); rows = @() }; meta = [pscustomobject]@{ changes = 0 } }
    } else {
      throw "Unexpected staged replay SQL: $($payload.sql)"
    }
    return [pscustomobject]@{ StatusCode = 200; Content = (@{ success = $true; result = @($result) } | ConvertTo-Json -Depth 5 -Compress) }
  }
  function global:Start-Sleep { param([int]$Seconds) }

  $caught = $null
  $captured = [System.Collections.Generic.List[string]]::new()
  try {
    if ($scenario -eq 'temp-fallback') {
      $env:TEMP = $null
    }
    if ($scenario -eq 'json-whoami-account-id') {
      Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
    }
    & (Join-Path $PSScriptRoot 'd1-restore.ps1') -Env rehearsal -DbName synthetic-db -BucketName synthetic-bucket -SnapshotKey synthetic.sql -PollAttempts 1 -PollIntervalSeconds 0 *>&1 | ForEach-Object { $captured.Add("$_") }
  } catch { $caught = $_ }
  $env:TEMP = $testRoot
  $outputText = ($captured -join "`n") + ($caught | Out-String)
  $normalizedOutput = Normalize-OutputText -Text $outputText
  $shouldPass = $scenario -in @('success', 'poll-legacy-complete', 'ingest-complete', 'ingest-legacy-complete', 'temp-fallback', 'split-replace-batch', 'bound-replay-batched', 'bound-replay-multiple-values', 'bound-replay-explicit-columns', 'bound-replay-unicode', 'bound-replay-quotes-empty', 'bound-replay-http-500-retry', 'json-whoami-account-id')
  $caughtMessage = if ($null -eq $caught) { 'none' } else { $caught.Exception.Message }
  Assert-True (($null -eq $caught) -eq $shouldPass) "$scenario returned the wrong success/failure outcome: $caughtMessage"
  if ($scenario -eq 'bound-replay-parameter-limit') {
    Assert-True ($caughtMessage -match 'bound-parameter limit') 'The parameter-limit case did not fail closed.'
    Assert-True ((Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) 'The parameter-limit case left snapshot material in the temporary directory.'
    continue
  }
  Assert-True (-not ($normalizedOutput -match 'synthetic-private-token|0123456789abcdef0123456789abcdef|synthetic\.invalid|private-upload|private\.sql|synthetic-bound-private-payload')) "$scenario leaked private restore material."
  if ($scenario -eq 'ingest-missing-state') {
    Assert-True ($normalizedOutput -match 'result=safe_flag' -and $normalizedOutput -notmatch 'synthetic-private-ingest-detail') 'The missing-state diagnostic did not expose only safe response shape.'
  }
  if ($scenario -eq 'ingest-error') {
    Assert-True ($normalizedOutput -match 'category=transaction_wrapper' -and $normalizedOutput -notmatch 'synthetic-private-error') 'The import-error diagnostic did not emit only a bounded category.'
  }
  if ($scenario -eq 'ingest-structured-error') {
    Assert-True ($normalizedOutput -match 'category=provider_unsupported_sql_statement' -and $normalizedOutput -notmatch 'synthetic-private-error') 'The structured import-error diagnostic did not emit only a bounded category.'
  }
  if ($scenario -eq 'bound-replay-transport-failure') {
    $observedCategory = @([regex]::Matches($normalizedOutput, 'operation=[a-z_]+ category=[a-z0-9_]+') | ForEach-Object { $_.Value }) -join ','
    Assert-True ($normalizedOutput -match 'D1 staged oversized-insert replay request failed .*operation=insert_atomic.*category=transport_failure' -and $normalizedOutput -notmatch 'synthetic-bound-replay-provider-detail') "The staged-replay transport failure did not emit a bounded category (observed=$observedCategory)."
    Assert-True ($normalizedOutput -match '\[d1-restore\] staged replay request failure operation=insert_atomic category=transport_failure request_bytes=\d+') 'The staged-replay transport failure did not record only its request size.'
  }
  if ($scenario -eq 'bound-replay-http-400') {
    Assert-True ($normalizedOutput -match '\[d1-restore\] staged replay request failure operation=insert_atomic category=provider_code_9001_http_status_400 request_bytes=\d+' -and $normalizedOutput -notmatch 'synthetic-bound-replay-provider-detail') 'The HTTP failure did not classify the safe provider code without exposing its response body.'
  }
  if ($scenario -eq 'bound-replay-http-500-retry') {
    Assert-True ($normalizedOutput -match '\[d1-restore\] staged replay transient retry operation=stage_create category=provider_code_7500_http_status_500 attempt=1 request_bytes=\d+' -and $normalizedOutput -notmatch 'synthetic-transient-provider-detail') 'The transient provider failure was not retried with a bounded diagnostic.'
  }
  Assert-True ((Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) "$scenario left snapshot material in the temporary directory."
  if ($shouldPass) {
    Assert-True ($normalizedOutput -match '\[d1-restore\] sanitized statements=\d+ max_chars=\d+ over_cap=\d+ inserts=\d+ creates=\d+ other=\d+') 'The restore output omitted content-free statement-size metrics.'
    Assert-True ($state.RestoreText.StartsWith("PRAGMA foreign_keys = OFF;`nPRAGMA defer_foreign_keys = TRUE;")) 'The restore file did not scope foreign-key suspension to the import.'
    Assert-True ($state.RestoreText.EndsWith("PRAGMA foreign_keys = ON;`n")) 'The restore file did not re-enable foreign-key enforcement.'
    Assert-True ($state.RestoreText -notmatch '(?m)^\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT)\s*;\s*$') 'The restore file retained outer transaction wrappers.'
    Assert-True ($state.RestoreText -notmatch '(?i)_cf_KV|synthetic-reserved') 'The restore file retained D1-reserved table SQL.'
    Assert-True ($state.RestoreText -notmatch 'synthetic-bound-private-payload') 'The restore import file retained an oversized text literal instead of parameterizing it.'
    Assert-True ($state.RestoreText -match 'CREATE TABLE synthetic' -and $state.RestoreText -match 'INSERT INTO synthetic') 'The restore file lost SQL while removing transaction wrappers.'
    Assert-True ($state.RestoreText -match "INSERT INTO synthetic VALUES \(2, '', ''\);") 'The restore file changed empty-string values.'
    Assert-True ($state.RestoreText.IndexOf('CREATE TABLE referenced_later') -lt $state.RestoreText.IndexOf('INSERT INTO synthetic VALUES (1,')) 'The restore file did not emit all table declarations before data INSERTs.'
    $syntheticInserts = [regex]::Matches($state.RestoreText, '(?ms)^\s*INSERT(?: OR (?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))? INTO synthetic VALUES .*?;\s*$')
    Assert-True ($syntheticInserts.Count -ge 3) 'The restore file did not split the oversized INSERT batch.'
    Assert-True ((($syntheticInserts | ForEach-Object { $_.Value.Length } | Measure-Object -Maximum).Maximum) -le 8000) 'The restore file emitted an INSERT batch above the safe statement-size cap.'
    Assert-True ([regex]::Matches($state.RestoreText, 'synthetic-row-payload-0123456789abcdef0123456789abcdef').Count -eq 3200) 'The restore file lost rows while splitting an oversized INSERT batch.'
    $expectedBoundStatementCount = if ($scenario -eq 'bound-replay-batched') { 8 } else { 1 }
    $expectedStagedValueCount = if ($scenario -eq 'bound-replay-multiple-values') { 2 } else { $expectedBoundStatementCount }
    $stagedRequests = @($state.StagedReplayRequests)
    $stageCreates = @($stagedRequests | Where-Object { $_.Kind -eq 'stage_create' })
    $stageChunks = @($stagedRequests | Where-Object { $_.Kind -eq 'stage_chunk' })
    $stageCleanups = @($stagedRequests | Where-Object { $_.Kind -eq 'stage_cleanup' })
    $atomicInserts = @($stagedRequests | Where-Object { $_.Kind -eq 'insert_atomic' })
    $expectedStageCreateRequests = if ($scenario -eq 'bound-replay-http-500-retry') { 2 } else { 1 }
    Assert-True ($stageCreates.Count -eq $expectedStageCreateRequests -and $stageCleanups.Count -eq 1) 'The staged replay did not create and remove exactly one disposable helper table with only bounded transient retries.'
    Assert-True ($stageChunks.Count -gt 0) 'The staged replay did not upload bounded text chunks before the atomic inserts.'
    Assert-True (@($stagedRequests | Where-Object { $_.Bytes -gt 90KB }).Count -eq 0) 'The staged replay emitted a request above the conservative control-plane body ceiling.'
    Assert-True ($atomicInserts.Count -eq $expectedBoundStatementCount) 'The staged oversized-insert replay did not perform one atomic insert per deferred statement.'
    Assert-True (@($atomicInserts | Where-Object { $_.Params.Count -lt 1 -or $_.Params.Count -gt 100 }).Count -eq 0) 'The atomic replay exceeded the provider bound-parameter limit.'
    Assert-True (@($atomicInserts | Where-Object { $_.Sql -match '(?i)\bUPDATE\b|CAST\(NULL AS TEXT\)|RETURNING' }).Count -eq 0) 'The atomic replay emitted a placeholder/update protocol.'
    Assert-True (@($atomicInserts | Where-Object { $_.Sql -notmatch '(?i)group_concat\("chunk",\s*\x27\x27\)' }).Count -eq 0) 'The atomic replay did not assemble each selected literal inside the final INSERT.'
    Assert-True (@($atomicInserts | Where-Object { $_.Sql -match '(?i)INSERT\s+INTO\s+"__mbfd_restore_chunks_|\browid\b|value_replace|value_append' }).Count -eq 0) 'The atomic target write reintroduced a prohibited replay protocol.'
    Assert-True (@($stagedRequests | Where-Object { $_.Sql -match '^\s|\s$' }).Count -eq 0) 'The staged oversized-insert replay did not canonicalize outer SQL whitespace before its raw requests.'
    Assert-True (@($stagedRequests | Where-Object { $_.Uri -notmatch '/query$' }).Count -eq 0) 'The staged oversized-insert replay did not use the documented D1 query endpoint.'
    Assert-True ($normalizedOutput -match "\[d1-restore\] staged oversized inserts replayed=$expectedBoundStatementCount values=$expectedStagedValueCount chunks=\d+ parameters=\d+ atomic_inserts=$expectedBoundStatementCount") 'The restore output did not record atomic oversized-insert replay metrics.'
    if ($scenario -eq 'bound-replay-unicode') {
      $expectedBytes = [System.Text.Encoding]::UTF8.GetByteCount($state.ExpectedBoundValue)
      $boundChunks = @($state.StagedChunks | Where-Object { $_.Statement -eq 0 -and $_.Value -eq 0 } | Sort-Object Chunk)
      $reassembled = ($boundChunks | ForEach-Object { $_.Text }) -join ''
      $actualBytes = [System.Text.Encoding]::UTF8.GetByteCount($reassembled)
      $actualChars = $reassembled.Length
      $expectedChars = $state.ExpectedBoundValue.Length
      Assert-True ($boundChunks.Count -gt 1 -and $actualBytes -eq $expectedBytes -and $reassembled -ceq $state.ExpectedBoundValue) "The staged replay changed Unicode text (chunks=$($boundChunks.Count) expected_chars=$expectedChars actual_chars=$actualChars expected_bytes=$expectedBytes actual_bytes=$actualBytes)."
    }
    if ($scenario -eq 'bound-replay-quotes-empty') {
      $quoteChunks = @($state.StagedChunks | Where-Object { $_.Statement -eq 0 -and $_.Value -eq 0 } | Sort-Object Chunk)
      Assert-True ((($quoteChunks | ForEach-Object { $_.Text }) -join '') -ceq $state.ExpectedBoundValue) 'The staged replay changed apostrophe-containing text.'
    }
    Assert-True (@($stagedRequests | Where-Object { $_.Kind -eq 'unexpected' }).Count -eq 0) 'The staged oversized-insert replay emitted an unexpected SQL shape.'
    if ($scenario -ne 'json-whoami-account-id') {
      Assert-True ($state.Calls.Count -eq 2 -and $state.Calls[0] -match '^--dir apps/worker exec wrangler r2 object get' -and $state.Calls[1] -match '^--dir apps/worker exec wrangler d1 info') 'The restore path did not use the Worker runtime to download then resolve the target database.'
    } else {
      Assert-True ($state.Calls.Count -ge 3 -and $state.Calls[0] -match '^--dir apps/worker exec wrangler whoami --json' -and $state.Calls[1] -match '^--dir apps/worker exec wrangler r2 object get' -and $state.Calls[2] -match '^--dir apps/worker exec wrangler d1 info') 'The restore path did not resolve the account ID from Wrangler JSON before importing.'
    }
    Assert-True ((($scenario -in @('ingest-complete', 'ingest-legacy-complete')) -and $state.PollCount -eq 0) -or (($scenario -in @('success', 'poll-legacy-complete', 'temp-fallback', 'split-replace-batch', 'bound-replay-batched', 'bound-replay-multiple-values', 'bound-replay-explicit-columns', 'bound-replay-unicode', 'bound-replay-quotes-empty', 'bound-replay-http-500-retry', 'json-whoami-account-id')) -and $state.PollCount -eq 1)) "$scenario did not use the expected D1 import completion path."
  }
}

Remove-Item Function:pnpm
Remove-Item Function:Invoke-RestMethod
Remove-Item Function:Invoke-WebRequest
Remove-Item Function:Start-Sleep
$env:CLOUDFLARE_API_TOKEN = $originalToken
$env:CLOUDFLARE_ACCOUNT_ID = $originalAccount
$env:TEMP = $originalTemp
Remove-Item -LiteralPath $testRoot -Recurse -Force
Write-Host '[PASS] D1 asynchronous import restore: scoped FK deferral, confidentiality, success/failure cleanup.'
