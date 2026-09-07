#requires -Version 7
$ErrorActionPreference = 'Stop'
$originalLastExitCode = $global:LASTEXITCODE

# Exercise the real backup orchestration with an in-process CLI double.
# No remote operation or runtime credential is used by this test.
foreach ($scenario in @('production', 'staging', 'lookup-fails', 'malformed-json', 'missing-bookmark', 'export-fails', 'small-export', 'sql-upload-fails', 'receipt-upload-fails')) {
  $state = [pscustomobject]@{
    Calls = [System.Collections.Generic.List[string]]::new()
    Receipt = $null
    SqlHash = $null
    Directory = $null
  }
  function pnpm {
    $commandText = $args -join ' '
    $state.Calls.Add($commandText)
    $global:LASTEXITCODE = 0
    if ($commandText -match 'd1 time-travel info') {
      if ($scenario -eq 'lookup-fails') { $global:LASTEXITCODE = 1; return 'private-cli-error' }
      if ($scenario -eq 'malformed-json') { return 'private-invalid-json' }
      if ($scenario -eq 'missing-bookmark') { return '{}' }
      return '{"bookmark":"00000001-00000002-00000003-0123456789abcdef"}'
    }
    if ($commandText -match 'd1 export') {
      $filePath = $args[[Array]::IndexOf($args, '--output') + 1]
      $state.Directory = Split-Path -Parent $filePath
      if ($scenario -eq 'export-fails') { $global:LASTEXITCODE = 1; return }
      $contents = if ($scenario -eq 'small-export') { 'small' } else { '-- synthetic backup fixture' * 100 }
      [System.IO.File]::WriteAllText($filePath, $contents)
      $state.SqlHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
      return
    }
    if ($commandText -match 'r2 object put') {
      $fileArgument = $args | Where-Object { $_ -like '--file=*' }
      $uploadedPath = $fileArgument.Substring(7)
      if ($uploadedPath -like '*recovery.json') {
        $state.Receipt = Get-Content -LiteralPath $uploadedPath -Raw | ConvertFrom-Json
        if ($scenario -eq 'receipt-upload-fails') { $global:LASTEXITCODE = 1 }
      } elseif ($scenario -eq 'sql-upload-fails') { $global:LASTEXITCODE = 1 }
      return
    }
    throw "Unexpected CLI command in recovery test: $commandText"
  }

  $caught = $null
  $captured = [System.Collections.Generic.List[string]]::new()
  try {
    $targetEnv = if ($scenario -eq 'staging') { 'staging' } else { 'production' }
    & (Join-Path $PSScriptRoot 'd1-backup.ps1') -Env $targetEnv -DbName 'synthetic-db' -BucketName 'synthetic-private-bucket' *>&1 | ForEach-Object { $captured.Add("$_") }
  } catch { $caught = $_ }
  $outputText = $captured -join "`n"
  if ($outputText -match '00000001-00000002|private-cli-error|private-invalid-json') { throw "$scenario leaked private recovery output." }
  if ($state.Directory -and (Test-Path -LiteralPath $state.Directory)) { throw "$scenario left temporary backup data behind." }
  $shouldPass = $scenario -in @('production', 'staging')
  if ($shouldPass -ne ($null -eq $caught)) { throw "$scenario returned the wrong success/failure outcome: $caught" }
  if (-not $shouldPass -and $outputText -match '\[d1-backup\] OK') { throw "$scenario falsely reported backup success." }
  if ($scenario -eq 'production') {
    if ($state.Calls.Count -ne 4 -or $state.Calls[0] -notmatch 'time-travel info') { throw 'Recovery bookmark must precede the export and both uploads.' }
    if ($state.Receipt.time_travel_bookmark -ne '00000001-00000002-00000003-0123456789abcdef' -or $state.Receipt.backup_sha256 -ne $state.SqlHash -or $state.Receipt.backup_bytes -lt 1024 -or $state.Receipt.environment -ne 'production' -or $state.Receipt.backup_key -notmatch '^d1/.+\.sql$' -or -not $state.Receipt.bookmark_captured_at) { throw 'Private recovery receipt did not match the exported snapshot and bookmark.' }
  }
  if ($scenario -eq 'staging' -and ($state.Calls.Count -ne 2 -or $null -ne $state.Receipt)) { throw 'Existing staging backup behavior changed.' }
  if ($scenario -in @('lookup-fails', 'malformed-json', 'missing-bookmark') -and $state.Calls.Count -ne 1) { throw 'Backup continued without valid recovery evidence.' }
  if ($scenario -in @('export-fails', 'small-export') -and $state.Calls.Count -ne 2) { throw 'Backup uploaded an invalid SQL export.' }
  if ($scenario -eq 'sql-upload-fails' -and $null -ne $state.Receipt) { throw 'Receipt published before successful SQL upload.' }
}
Remove-Item Function:pnpm
$global:LASTEXITCODE = $originalLastExitCode
Write-Host '[PASS] D1 private recovery receipt: success, confidentiality, cleanup, unchanged staging and seven failure paths.'
