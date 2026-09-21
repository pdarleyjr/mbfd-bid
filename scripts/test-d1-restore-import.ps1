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

foreach ($scenario in @('success', 'poll-legacy-complete', 'ingest-complete', 'ingest-legacy-complete', 'ingest-missing-state', 'ingest-error', 'ingest-structured-error', 'init-fails', 'temp-fallback')) {
  $state = [pscustomobject]@{ Calls = [System.Collections.Generic.List[string]]::new(); RestoreText = $null; PollCount = 0 }
  function global:pnpm {
    $commandText = $args -join ' '
    $state.Calls.Add($commandText)
    $global:LASTEXITCODE = 0
    if ($commandText -match 'r2 object get') {
      $filePath = ($args | Where-Object { $_ -like '--file=*' }).Substring(7)
      $largeRows = (1..1600 | ForEach-Object { "($_, 'synthetic-row-payload-0123456789abcdef0123456789abcdef')" }) -join ','
      [System.IO.File]::WriteAllText($filePath, "BEGIN TRANSACTION;`nCREATE TABLE _cf_KV (`n key TEXT PRIMARY KEY,`n value BLOB`n) WITHOUT ROWID;`nINSERT INTO _cf_KV VALUES ('synthetic-reserved');`nCREATE TABLE synthetic (id INTEGER PRIMARY KEY);`nINSERT INTO synthetic VALUES (1);`nINSERT INTO synthetic VALUES $largeRows;`nCREATE TABLE referenced_later (id INTEGER PRIMARY KEY);`nCOMMIT;`n")
      return
    }
    if ($commandText -match 'd1 info') { return '{"uuid":"01234567-89ab-cdef-0123-456789abcdef"}' }
    throw "Unexpected CLI command: $commandText"
  }
  function global:Invoke-RestMethod {
    param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$ContentType, [string]$Body)
    $action = ($Body | ConvertFrom-Json).action
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
    param([string]$Method, [string]$Uri, [string]$InFile)
    $state.RestoreText = [System.IO.File]::ReadAllText($InFile)
    return [pscustomobject]@{ StatusCode = 200 }
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
  $shouldPass = $scenario -in @('success', 'poll-legacy-complete', 'ingest-complete', 'ingest-legacy-complete', 'temp-fallback')
  Assert-True (($null -eq $caught) -eq $shouldPass) "$scenario returned the wrong success/failure outcome."
  Assert-True (-not ($outputText -match 'synthetic-private-token|0123456789abcdef0123456789abcdef|synthetic\.invalid|private-upload|private\.sql')) "$scenario leaked private restore material."
  if ($scenario -eq 'ingest-missing-state') {
    Assert-True ($outputText -match 'result=safe_flag' -and $outputText -notmatch 'synthetic-private-ingest-detail') 'The missing-state diagnostic did not expose only safe response shape.'
  }
  if ($scenario -eq 'ingest-error') {
    Assert-True ($outputText -match 'category=transaction_wrapper' -and $outputText -notmatch 'synthetic-private-error') 'The import-error diagnostic did not emit only a bounded category.'
  }
  if ($scenario -eq 'ingest-structured-error') {
    Assert-True ($outputText -match 'category=provider_unsupported_sql_statement' -and $outputText -notmatch 'synthetic-private-error') 'The structured import-error diagnostic did not emit only a bounded category.'
  }
  Assert-True ((Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) "$scenario left snapshot material in the temporary directory."
  if ($shouldPass) {
    Assert-True ($outputText -match '\[d1-restore\] sanitized statements=\d+ max_chars=\d+ over_cap=\d+ inserts=\d+ creates=\d+ other=\d+') 'The restore output omitted content-free statement-size metrics.'
    Assert-True ($state.RestoreText.StartsWith("PRAGMA foreign_keys = OFF;`nPRAGMA defer_foreign_keys = TRUE;")) 'The restore file did not scope foreign-key suspension to the import.'
    Assert-True ($state.RestoreText.EndsWith("PRAGMA foreign_keys = ON;`n")) 'The restore file did not re-enable foreign-key enforcement.'
    Assert-True ($state.RestoreText -notmatch '(?m)^\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT)\s*;\s*$') 'The restore file retained outer transaction wrappers.'
    Assert-True ($state.RestoreText -notmatch '(?i)_cf_KV|synthetic-reserved') 'The restore file retained D1-reserved table SQL.'
    Assert-True ($state.RestoreText -match 'CREATE TABLE synthetic' -and $state.RestoreText -match 'INSERT INTO synthetic') 'The restore file lost SQL while removing transaction wrappers.'
    Assert-True ($state.RestoreText.IndexOf('CREATE TABLE referenced_later') -lt $state.RestoreText.IndexOf('INSERT INTO synthetic VALUES (1)')) 'The restore file did not emit all table declarations before data INSERTs.'
    $syntheticInserts = [regex]::Matches($state.RestoreText, '(?ms)^\s*INSERT INTO synthetic VALUES .*?;\s*$')
    Assert-True ($syntheticInserts.Count -ge 3) 'The restore file did not split the oversized INSERT batch.'
    Assert-True ((($syntheticInserts | ForEach-Object { $_.Value.Length } | Measure-Object -Maximum).Maximum) -le 8000) 'The restore file emitted an INSERT batch above the safe statement-size cap.'
    Assert-True ([regex]::Matches($state.RestoreText, 'synthetic-row-payload-0123456789abcdef0123456789abcdef').Count -eq 1600) 'The restore file lost rows while splitting an oversized INSERT batch.'
    Assert-True ($state.Calls.Count -eq 2 -and $state.Calls[0] -match '^--dir apps/worker exec wrangler r2 object get' -and $state.Calls[1] -match '^--dir apps/worker exec wrangler d1 info') 'The restore path did not use the Worker runtime to download then resolve the target database.'
    Assert-True ((($scenario -in @('ingest-complete', 'ingest-legacy-complete')) -and $state.PollCount -eq 0) -or (($scenario -in @('success', 'poll-legacy-complete', 'temp-fallback')) -and $state.PollCount -eq 1)) "$scenario did not use the expected D1 import completion path."
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
