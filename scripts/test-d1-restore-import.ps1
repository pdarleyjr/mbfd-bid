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

foreach ($scenario in @('success', 'init-fails')) {
  $state = [pscustomobject]@{ Calls = [System.Collections.Generic.List[string]]::new(); UploadText = $null }
  function global:pnpm {
    $commandText = $args -join ' '
    $state.Calls.Add($commandText)
    $global:LASTEXITCODE = 0
    if ($commandText -match 'r2 object get') {
      $filePath = ($args | Where-Object { $_ -like '--file=*' }).Substring(7)
      [System.IO.File]::WriteAllText($filePath, "CREATE TABLE synthetic (id INTEGER PRIMARY KEY);`nINSERT INTO synthetic VALUES (1);`n")
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
    if ($action -eq 'ingest') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ at_bookmark = '00000001-00000002-00000003-0123456789abcdef' } } }
    if ($action -eq 'poll') { return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ status = 'complete' } } }
    throw "Unexpected REST action: $action"
  }
  function global:Invoke-WebRequest {
    param([string]$Method, [string]$Uri, [string]$InFile)
    $state.UploadText = [System.IO.File]::ReadAllText($InFile)
    return [pscustomobject]@{ StatusCode = 200 }
  }
  function global:Start-Sleep { param([int]$Seconds) }

  $caught = $null
  $captured = [System.Collections.Generic.List[string]]::new()
  try {
    & (Join-Path $PSScriptRoot 'd1-restore.ps1') -Env rehearsal -DbName synthetic-db -BucketName synthetic-bucket -SnapshotKey synthetic.sql -PollAttempts 1 -PollIntervalSeconds 0 *>&1 | ForEach-Object { $captured.Add("$_") }
  } catch { $caught = $_ }
  $outputText = ($captured -join "`n") + ($caught | Out-String)
  $shouldPass = $scenario -eq 'success'
  Assert-True (($null -eq $caught) -eq $shouldPass) "$scenario returned the wrong success/failure outcome."
  Assert-True (-not ($outputText -match 'synthetic-private-token|0123456789abcdef0123456789abcdef|synthetic\.invalid|private-upload|private\.sql')) "$scenario leaked private restore material."
  Assert-True ((Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) "$scenario left snapshot material in the temporary directory."
  if ($shouldPass) {
    Assert-True ($state.UploadText.StartsWith("PRAGMA defer_foreign_keys = TRUE;")) 'The restore upload did not scope deferred foreign-key checks.'
    Assert-True ($state.Calls.Count -eq 2 -and $state.Calls[0] -match 'r2 object get' -and $state.Calls[1] -match 'd1 info') 'The restore path did not download then resolve the target database.'
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
