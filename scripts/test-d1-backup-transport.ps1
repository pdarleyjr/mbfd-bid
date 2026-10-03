#requires -Version 7
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'd1-backup-transport.ps1')

function Assert-TransportTest([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) "d1-transport-test-$([guid]::NewGuid().ToString('N'))"
[void](New-Item -ItemType Directory -Path $testRoot)
try {
  $sourcePath = Join-Path $testRoot 'source.sql'
  $gzipPath = Join-Path $testRoot 'source.sql.gz'
  $text = "CREATE TABLE synthetic (value TEXT);`n" + ("INSERT INTO synthetic VALUES ('Synthetic O''Brien 🙂');`n" * 40000)
  [IO.File]::WriteAllText($sourcePath, $text, [Text.UTF8Encoding]::new($false))
  $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $sourceBytes = (Get-Item -LiteralPath $sourcePath).Length
  $scaledUploadCeiling=65536
  $transport = New-D1BackupTransport -SourcePath $sourcePath -DestinationPath $gzipPath -MaximumTransportBytes $scaledUploadCeiling
  Assert-TransportTest ($sourceBytes -gt $scaledUploadCeiling -and $transport.TransportBytes -le $scaledUploadCeiling) 'An export above the upload ceiling was not carried by a smaller gzip object.'
  Assert-TransportTest ($transport.Encoding -eq 'gzip' -and $transport.RawSha256 -eq $sourceHash -and $transport.RawBytes -eq $sourceBytes) 'Gzip transport lost raw SQL provenance.'
  Assert-TransportTest ($transport.TransportBytes -lt $sourceBytes -and $transport.TransportSha256 -eq (Get-FileHash -LiteralPath $gzipPath -Algorithm SHA256).Hash.ToLowerInvariant()) 'Gzip transport hash/size is not exact.'
  $receipt = [pscustomobject]@{
    schema_version=2; environment='production'; database='synthetic-source'; backup_key='d1/synthetic.sql.gz'
    backup_bytes=$sourceBytes; backup_sha256=$sourceHash
    transport_encoding='gzip'; transport_bytes=$transport.TransportBytes; transport_sha256=$transport.TransportSha256
  }
  $restored = Join-Path $testRoot 'restored.sql'
  $verified = Expand-D1BackupTransport -TransportPath $gzipPath -SqlPath $restored -Receipt $receipt -SnapshotKey 'd1/synthetic.sql.gz' -ExpectedEnvironment production
  Assert-TransportTest ($verified.RawSha256 -eq $sourceHash -and [IO.File]::ReadAllText($restored) -ceq $text) 'Gzip restore changed SQL bytes or text.'
  $legacyReceipt = [pscustomobject]@{schema_version=1;environment='production';database='synthetic-source';backup_key='d1/synthetic.sql';backup_bytes=$sourceBytes;backup_sha256=$sourceHash}
  $legacyPath = Join-Path $testRoot 'legacy.sql'
  $legacy = Expand-D1BackupTransport -TransportPath $sourcePath -SqlPath $legacyPath -Receipt $legacyReceipt -SnapshotKey 'd1/synthetic.sql' -ExpectedEnvironment production
  Assert-TransportTest ($legacy.RawSha256 -eq $sourceHash -and (Get-FileHash -LiteralPath $legacyPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sourceHash) 'Legacy schema-1 SQL receipt no longer restores exactly.'
  $ambiguousLegacy=$legacyReceipt | ConvertTo-Json | ConvertFrom-Json
  $ambiguousLegacy | Add-Member NoteProperty transport_encoding 'gzip'
  $failed=$false
  try { [void](Expand-D1BackupTransport -TransportPath $sourcePath -SqlPath (Join-Path $testRoot 'ambiguous-legacy.sql') -Receipt $ambiguousLegacy -SnapshotKey 'd1/synthetic.sql' -ExpectedEnvironment production) } catch { $failed=$true }
  Assert-TransportTest ($failed -and -not (Test-Path -LiteralPath (Join-Path $testRoot 'ambiguous-legacy.sql'))) 'Ambiguous schema-1 transport was not rejected before decoding.'
  foreach ($scenario in @('transport-hash','transport-size','raw-hash','raw-size','key','environment','encoding','schema','invalid-gzip')) {
    $changed = $receipt | ConvertTo-Json | ConvertFrom-Json
    $candidatePath = $gzipPath
    switch ($scenario) {
      'transport-hash' { $changed.transport_sha256='f' * 64 }
      'transport-size' { $changed.transport_bytes++ }
      'raw-hash' { $changed.backup_sha256='f' * 64 }
      'raw-size' { $changed.backup_bytes-- }
      'key' { $changed.backup_key='d1/other.sql.gz' }
      'environment' { $changed.environment='other' }
      'encoding' { $changed.transport_encoding='unknown' }
      'schema' { $changed.schema_version=3 }
      'invalid-gzip' {
        $candidatePath=Join-Path $testRoot 'invalid.gz'
        [IO.File]::WriteAllText($candidatePath, 'synthetic corrupt gzip')
        $changed.transport_bytes=(Get-Item -LiteralPath $candidatePath).Length
        $changed.transport_sha256=(Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
    $failed=$false
    try { [void](Expand-D1BackupTransport -TransportPath $candidatePath -SqlPath (Join-Path $testRoot "rejected-$scenario.sql") -Receipt $changed -SnapshotKey 'd1/synthetic.sql.gz' -ExpectedEnvironment production) } catch { $failed=$true }
    Assert-TransportTest $failed "$scenario transport incorrectly passed verification."
    if ($scenario -in @('transport-hash','transport-size','key','environment','encoding','schema')) {
      Assert-TransportTest (-not (Test-Path -LiteralPath (Join-Path $testRoot "rejected-$scenario.sql"))) "$scenario began decoding before validating its receipt and compressed object."
    }
  }
  $failed=$false
  try { [void](New-D1BackupTransport -SourcePath $sourcePath -DestinationPath (Join-Path $testRoot 'over-limit.gz') -MaximumTransportBytes 1) } catch { $failed=$true }
  Assert-TransportTest $failed 'An oversized compressed transport did not fail before upload.'
  Write-Host '[PASS] Streaming gzip transport: exact SQL bytes above a scaled upload ceiling, legacy schema-1 SQL, ten integrity failures, pre-decode validation and upload ceiling.'
} finally {
  $resolvedRoot=[IO.Path]::GetFullPath($testRoot)
  $expectedParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if ([IO.Path]::GetDirectoryName($resolvedRoot) -ne $expectedParent -or [IO.Path]::GetFileName($resolvedRoot) -notlike 'd1-transport-test-*') { throw 'Unexpected transport test cleanup target' }
  Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}
