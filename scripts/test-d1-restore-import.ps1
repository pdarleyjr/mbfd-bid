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

foreach ($scenario in @('success', 'executor-fails', 'temp-fallback')) {
  $state = [pscustomobject]@{ Calls = [System.Collections.Generic.List[string]]::new(); RestoreText = $null }
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
    if ($commandText -match 'd1 execute') {
      $filePath = ($args | Where-Object { $_ -like '--file=*' }).Substring(7)
      $state.RestoreText = [System.IO.File]::ReadAllText($filePath)
      if ($scenario -eq 'executor-fails') {
        $global:LASTEXITCODE = 1
        return 'synthetic-private-executor-detail'
      }
      return
    }
    throw "Unexpected CLI command: $commandText"
  }

  $caught = $null
  $captured = [System.Collections.Generic.List[string]]::new()
  try {
    if ($scenario -eq 'temp-fallback') {
      $env:TEMP = $null
    }
    & (Join-Path $PSScriptRoot 'd1-restore.ps1') -Env rehearsal -DbName synthetic-db -BucketName synthetic-bucket -SnapshotKey synthetic.sql *>&1 | ForEach-Object { $captured.Add("$_") }
  } catch { $caught = $_ }
  $env:TEMP = $testRoot
  $outputText = ($captured -join "`n") + ($caught | Out-String)
  $shouldPass = $scenario -in @('success', 'temp-fallback')
  Assert-True (($null -eq $caught) -eq $shouldPass) "$scenario returned the wrong success/failure outcome."
  Assert-True (-not ($outputText -match 'synthetic-private-token|0123456789abcdef0123456789abcdef|synthetic-private-executor-detail')) "$scenario leaked private restore material."
  if ($scenario -eq 'executor-fails') {
    Assert-True ($outputText -match 'category=opaque') 'The executor failure did not emit a bounded category.'
  }
  Assert-True ((Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) "$scenario left snapshot material in the temporary directory."
  if ($shouldPass) {
    Assert-True ($state.RestoreText.StartsWith("PRAGMA foreign_keys = OFF;`nPRAGMA defer_foreign_keys = TRUE;")) 'The restore file did not scope foreign-key suspension to the import.'
    Assert-True ($state.RestoreText.EndsWith("PRAGMA foreign_keys = ON;`n")) 'The restore file did not re-enable foreign-key enforcement.'
    Assert-True ($state.RestoreText -notmatch '(?m)^\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT)\s*;\s*$') 'The restore file retained outer transaction wrappers.'
    Assert-True ($state.RestoreText -notmatch '(?i)_cf_KV|synthetic-reserved') 'The restore file retained D1-reserved table SQL.'
    Assert-True ($state.RestoreText -match 'CREATE TABLE synthetic' -and $state.RestoreText -match 'INSERT INTO synthetic') 'The restore file lost SQL while removing transaction wrappers.'
    Assert-True ($state.RestoreText.IndexOf('CREATE TABLE referenced_later') -lt $state.RestoreText.IndexOf('INSERT INTO synthetic VALUES (1)')) 'The restore file did not emit all table declarations before data INSERTs.'
    $syntheticInserts = [regex]::Matches($state.RestoreText, '(?ms)^\s*INSERT INTO synthetic VALUES .*?;\s*$')
    Assert-True ($syntheticInserts.Count -ge 3) 'The restore file did not split the oversized INSERT batch.'
    Assert-True ((($syntheticInserts | ForEach-Object { $_.Value.Length } | Measure-Object -Maximum).Maximum) -le 48000) 'The restore upload emitted an INSERT batch above the safe statement-size cap.'
    Assert-True ([regex]::Matches($state.RestoreText, 'synthetic-row-payload-0123456789abcdef0123456789abcdef').Count -eq 1600) 'The restore file lost rows while splitting an oversized INSERT batch.'
    Assert-True ($state.Calls.Count -eq 2 -and $state.Calls[0] -match '^--dir apps/worker exec wrangler r2 object get' -and $state.Calls[1] -match '^--dir apps/worker exec wrangler d1 execute synthetic-db --remote --file=') 'The restore path did not use the Worker runtime to download then execute the sanitized restore file.'
  }
}

Remove-Item Function:pnpm
$env:CLOUDFLARE_API_TOKEN = $originalToken
$env:CLOUDFLARE_ACCOUNT_ID = $originalAccount
$env:TEMP = $originalTemp
Remove-Item -LiteralPath $testRoot -Recurse -Force
Write-Host '[PASS] D1 Wrangler-file restore: scoped FK deferral, confidentiality, success/failure cleanup.'
