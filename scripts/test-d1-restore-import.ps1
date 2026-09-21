#requires -Version 7
$ErrorActionPreference = 'Stop'

function Assert-True {
  param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
  if (-not $Condition) { throw $Message }
}

$originalToken = $env:CLOUDFLARE_API_TOKEN
$originalAccount = $env:CLOUDFLARE_ACCOUNT_ID
$originalTemp = $env:TEMP
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "d1-restore-import-test-$([guid]::NewGuid().ToString('N'))"
$env:CLOUDFLARE_API_TOKEN = 'synthetic-private-token'
$env:CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
$env:TEMP = $testRoot
New-Item -ItemType Directory -Path $testRoot | Out-Null

foreach ($scenario in @('success', 'poll-legacy-complete', 'ingest-complete', 'ingest-legacy-complete', 'ingest-missing-state', 'ingest-error', 'ingest-structured-error', 'init-fails', 'temp-fallback', 'split-replace-batch', 'bound-replay-batched', 'bound-replay-multiple-values', 'bound-replay-unicode', 'bound-replay-transport-failure', 'bound-replay-http-400')) {
  $state = [pscustomobject]@{ Calls = [System.Collections.Generic.List[string]]::new(); RestoreText = $null; PollCount = 0; StagedReplayRequests = [System.Collections.Generic.List[object]]::new(); ExpectedBoundValue = $null }
  function global:pnpm {
    $commandText = $args -join ' '
    $state.Calls.Add($commandText)
    $global:LASTEXITCODE = 0
    if ($commandText -match 'r2 object get') {
      $filePath = ($args | Where-Object { $_ -like '--file=*' }).Substring(7)
      $largeRows = (1..1600 | ForEach-Object { "($_, 'synthetic-row-payload-0123456789abcdef0123456789abcdef')" }) -join ','
      $deferredPayload = if ($scenario -eq 'bound-replay-unicode') { '🙂' * 40000 } else { 'synthetic-bound-private-payload-' * 4000 }
      if ($scenario -eq 'bound-replay-unicode') { $state.ExpectedBoundValue = $deferredPayload }
      $deferredInserts = if ($scenario -eq 'bound-replay-batched') {
        (1..40 | ForEach-Object { "INSERT INTO synthetic VALUES ($(900000 + $_), '$deferredPayload$_');" }) -join "`n"
      } elseif ($scenario -eq 'bound-replay-multiple-values') {
        "INSERT INTO synthetic VALUES (900001, '$deferredPayload', '$deferredPayload');"
      } else {
        "INSERT INTO synthetic VALUES (900001, '$deferredPayload');"
      }
      $largeInsert = if ($scenario -eq 'split-replace-batch') { 'INSERT OR REPLACE INTO synthetic VALUES' } else { 'INSERT INTO synthetic VALUES' }
      [System.IO.File]::WriteAllText($filePath, "BEGIN TRANSACTION;`nCREATE TABLE _cf_KV (`n key TEXT PRIMARY KEY,`n value BLOB`n) WITHOUT ROWID;`nINSERT INTO _cf_KV VALUES ('synthetic-reserved');`nCREATE TABLE synthetic (id INTEGER PRIMARY KEY, note TEXT);`nINSERT INTO synthetic VALUES (1, 'small');`n$largeInsert $largeRows;`n$deferredInserts`nCREATE TABLE referenced_later (id INTEGER PRIMARY KEY);`nCOMMIT;`n")
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
    $kind = if ($payload.sql -match '(?i)^CREATE TABLE "__mbfd_restore_chunks_') { 'helper_create' }
      elseif ($payload.sql -match '(?i)^INSERT INTO "__mbfd_restore_chunks_') { 'helper_chunk' }
      elseif ($payload.sql -match '(?i)^DROP TABLE IF EXISTS "__mbfd_restore_chunks_') { 'helper_cleanup' }
      else { 'insert_apply' }
    $params = if ($null -eq $payload.params) { @() } else { @($payload.params | ForEach-Object { "$_" }) }
    $state.StagedReplayRequests.Add([pscustomobject]@{ Kind = $kind; Uri = $Uri; Sql = "$($payload.sql)"; Params = $params; Bytes = [System.Text.Encoding]::UTF8.GetByteCount($Body) })
    if ($kind -eq 'insert_apply' -and $scenario -eq 'bound-replay-transport-failure') { throw 'synthetic-bound-replay-provider-detail' }
    if ($kind -eq 'insert_apply' -and $scenario -eq 'bound-replay-http-400') {
      return [pscustomobject]@{ StatusCode = 400; Content = '{"errors":[{"code":9001,"message":"synthetic-bound-replay-provider-detail"}]}' }
    }
    return [pscustomobject]@{ StatusCode = 200; Content = (@{ success = $true; result = @([pscustomobject]@{ success = $true }) } | ConvertTo-Json -Depth 5 -Compress) }
  }
  function global:Start-Sleep { param([int]$Seconds) }

  $caught = $null
  $captured = [System.Collections.Generic.List[string]]::new()
  try {
    if ($scenario -eq 'temp-fallback') {
      $env:TEMP = $null
    }
    & (Join-Path $PSScriptRoot 'd1-restore.ps1') -Env rehearsal -DbName synthetic-db -BucketName synthetic-bucket -SnapshotKey synthetic.sql -PollAttempts 1 -PollIntervalSeconds 0 *>&1 | ForEach-Object { $captured.Add("$_") }
  } catch { $caught = $_ }
  $env:TEMP = $testRoot
  $outputText = ($captured -join "`n") + ($caught | Out-String)
  $shouldPass = $scenario -in @('success', 'poll-legacy-complete', 'ingest-complete', 'ingest-legacy-complete', 'temp-fallback', 'split-replace-batch', 'bound-replay-batched', 'bound-replay-multiple-values', 'bound-replay-unicode')
  Assert-True (($null -eq $caught) -eq $shouldPass) "$scenario returned the wrong success/failure outcome."
  Assert-True (-not ($outputText -match 'synthetic-private-token|0123456789abcdef0123456789abcdef|synthetic\.invalid|private-upload|private\.sql|synthetic-bound-private-payload')) "$scenario leaked private restore material."
  if ($scenario -eq 'ingest-missing-state') {
    Assert-True ($outputText -match 'result=safe_flag' -and $outputText -notmatch 'synthetic-private-ingest-detail') 'The missing-state diagnostic did not expose only safe response shape.'
  }
  if ($scenario -eq 'ingest-error') {
    Assert-True ($outputText -match 'category=transaction_wrapper' -and $outputText -notmatch 'synthetic-private-error') 'The import-error diagnostic did not emit only a bounded category.'
  }
  if ($scenario -eq 'ingest-structured-error') {
    Assert-True ($outputText -match 'category=provider_unsupported_sql_statement' -and $outputText -notmatch 'synthetic-private-error') 'The structured import-error diagnostic did not emit only a bounded category.'
  }
  if ($scenario -eq 'bound-replay-transport-failure') {
    Assert-True ($outputText -match 'D1 staged oversized-insert replay request failed \(operation=insert_apply category=transport_failure\)\.' -and $outputText -notmatch 'synthetic-bound-replay-provider-detail') 'The staged-replay transport failure did not emit a bounded category.'
    Assert-True ($outputText -match '\[d1-restore\] staged replay request failure operation=insert_apply category=transport_failure request_bytes=\d+') 'The staged-replay transport failure did not record only its request size.'
  }
  if ($scenario -eq 'bound-replay-http-400') {
    Assert-True ($outputText -match '\[d1-restore\] staged replay request failure operation=insert_apply category=provider_code_9001_http_status_400 request_bytes=\d+' -and $outputText -notmatch 'synthetic-bound-replay-provider-detail') 'The HTTP failure did not classify the safe provider code without exposing its response body.'
  }
  Assert-True ((Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) "$scenario left snapshot material in the temporary directory."
  if ($shouldPass) {
    Assert-True ($outputText -match '\[d1-restore\] sanitized statements=\d+ max_chars=\d+ over_cap=\d+ inserts=\d+ creates=\d+ other=\d+') 'The restore output omitted content-free statement-size metrics.'
    Assert-True ($state.RestoreText.StartsWith("PRAGMA foreign_keys = OFF;`nPRAGMA defer_foreign_keys = TRUE;")) 'The restore file did not scope foreign-key suspension to the import.'
    Assert-True ($state.RestoreText.EndsWith("PRAGMA foreign_keys = ON;`n")) 'The restore file did not re-enable foreign-key enforcement.'
    Assert-True ($state.RestoreText -notmatch '(?m)^\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT)\s*;\s*$') 'The restore file retained outer transaction wrappers.'
    Assert-True ($state.RestoreText -notmatch '(?i)_cf_KV|synthetic-reserved') 'The restore file retained D1-reserved table SQL.'
    Assert-True ($state.RestoreText -notmatch 'synthetic-bound-private-payload') 'The restore import file retained an oversized text literal instead of parameterizing it.'
    Assert-True ($state.RestoreText -match 'CREATE TABLE synthetic' -and $state.RestoreText -match 'INSERT INTO synthetic') 'The restore file lost SQL while removing transaction wrappers.'
    Assert-True ($state.RestoreText.IndexOf('CREATE TABLE referenced_later') -lt $state.RestoreText.IndexOf('INSERT INTO synthetic VALUES (1,')) 'The restore file did not emit all table declarations before data INSERTs.'
    $syntheticInserts = [regex]::Matches($state.RestoreText, '(?ms)^\s*INSERT(?: OR (?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))? INTO synthetic VALUES .*?;\s*$')
    Assert-True ($syntheticInserts.Count -ge 3) 'The restore file did not split the oversized INSERT batch.'
    Assert-True ((($syntheticInserts | ForEach-Object { $_.Value.Length } | Measure-Object -Maximum).Maximum) -le 8000) 'The restore file emitted an INSERT batch above the safe statement-size cap.'
    Assert-True ([regex]::Matches($state.RestoreText, 'synthetic-row-payload-0123456789abcdef0123456789abcdef').Count -eq 1600) 'The restore file lost rows while splitting an oversized INSERT batch.'
    $expectedBoundStatementCount = if ($scenario -eq 'bound-replay-batched') { 40 } else { 1 }
    $expectedStagedValueCount = if ($scenario -eq 'bound-replay-multiple-values') { 2 } else { $expectedBoundStatementCount }
    $stagedRequests = @($state.StagedReplayRequests)
    $helperCreates = @($stagedRequests | Where-Object { $_.Kind -eq 'helper_create' })
    $helperChunks = @($stagedRequests | Where-Object { $_.Kind -eq 'helper_chunk' })
    $insertApplies = @($stagedRequests | Where-Object { $_.Kind -eq 'insert_apply' })
    $helperCleanups = @($stagedRequests | Where-Object { $_.Kind -eq 'helper_cleanup' })
    Assert-True ($helperCreates.Count -eq $expectedStagedValueCount -and $insertApplies.Count -eq $expectedBoundStatementCount -and $helperCleanups.Count -eq $expectedStagedValueCount) 'The staged oversized-insert replay did not create, apply, and remove one generated helper per deferred value.'
    $oversizedChunkRequests = @($helperChunks | Where-Object {
      if ($_.Params.Count -lt 2 -or $_.Params.Count -gt 6 -or ($_.Params.Count % 2) -ne 0 -or $_.Bytes -gt 48KB) { return $true }
      for ($index = 1; $index -lt $_.Params.Count; $index += 2) {
        if ([System.Text.Encoding]::UTF8.GetByteCount($_.Params[$index]) -gt 12KB) { return $true }
      }
      return $false
    })
    Assert-True ($helperChunks.Count -gt 0 -and $oversizedChunkRequests.Count -eq 0) 'The staged oversized-insert replay did not keep chunk requests safely small.'
    Assert-True (@($insertApplies | Where-Object { $_.Params.Count -ne 0 -or $_.Sql -match 'd1_restore_value' -or $_.Bytes -gt 92KB }).Count -eq 0) 'The staged oversized-insert replay did not replace every internal value marker within the safe final SQL budget.'
    Assert-True (@($stagedRequests | Where-Object { $_.Uri -notmatch '/raw$' }).Count -eq 0) 'The staged oversized-insert replay did not use the documented D1 raw-query endpoint.'
    Assert-True ($outputText -match "\[d1-restore\] staged oversized inserts replayed=$expectedBoundStatementCount values=$expectedStagedValueCount chunks=\d+ helpers=$expectedStagedValueCount") 'The restore output did not record staged oversized-insert replay metrics.'
    if ($scenario -eq 'bound-replay-unicode') {
      $unicodeChunks = @($helperChunks | ForEach-Object { for ($index = 1; $index -lt $_.Params.Count; $index += 2) { $_.Params[$index] } })
      Assert-True (($unicodeChunks -join '') -ceq $state.ExpectedBoundValue) 'The staged replay split a Unicode surrogate pair or changed the source text.'
    }
    Assert-True (@($stagedRequests | Where-Object { $_.Sql -match '(?i)^\s*PRAGMA\s+' }).Count -eq 0) 'The staged oversized-insert replay mixed connection-scoped pragma state with parameterized writes.'
    Assert-True ($state.Calls.Count -eq 2 -and $state.Calls[0] -match '^--dir apps/worker exec wrangler r2 object get' -and $state.Calls[1] -match '^--dir apps/worker exec wrangler d1 info') 'The restore path did not use the Worker runtime to download then resolve the target database.'
    Assert-True ((($scenario -in @('ingest-complete', 'ingest-legacy-complete')) -and $state.PollCount -eq 0) -or (($scenario -in @('success', 'poll-legacy-complete', 'temp-fallback', 'split-replace-batch', 'bound-replay-batched', 'bound-replay-multiple-values', 'bound-replay-unicode')) -and $state.PollCount -eq 1)) "$scenario did not use the expected D1 import completion path."
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
