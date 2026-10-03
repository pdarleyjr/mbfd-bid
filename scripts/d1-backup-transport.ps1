#requires -Version 7
# Shared backup transport only. SQL normalization/import remains in d1-restore.

function New-D1BackupTransport {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$SourcePath,
    [Parameter(Mandatory)][string]$DestinationPath,
    [long]$MaximumTransportBytes = 314572800
  )
  if ($MaximumTransportBytes -lt 1) { throw 'Invalid backup transport size limit.' }
  if ([IO.Path]::GetFullPath($SourcePath) -eq [IO.Path]::GetFullPath($DestinationPath)) { throw 'Backup transport requires a separate destination.' }
  $source=$null; $destination=$null; $gzip=$null; $hash=$null
  $rawBytes=[long]0; $rawSha256=$null
  try {
    $source=[IO.File]::OpenRead($SourcePath)
    $destination=[IO.File]::Open($DestinationPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $gzip=[IO.Compression.GZipStream]::new($destination, [IO.Compression.CompressionLevel]::Optimal, $true)
    $hash=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    $buffer=[byte[]]::new(1048576)
    while (($count=$source.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $gzip.Write($buffer, 0, $count)
      $hash.AppendData($buffer, 0, $count)
      $rawBytes += $count
    }
    $rawSha256=[Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant()
  } catch { throw 'D1 gzip compression failed; no backup success recorded.' }
  finally {
    if ($null -ne $gzip) { $gzip.Dispose() }
    if ($null -ne $destination) { $destination.Dispose() }
    if ($null -ne $source) { $source.Dispose() }
    if ($null -ne $hash) { $hash.Dispose() }
  }
  $transportBytes=(Get-Item -LiteralPath $DestinationPath).Length
  # This is the installed Wrangler REST-upload ceiling, not R2's object limit.
  if ($transportBytes -gt $MaximumTransportBytes) { throw "Compressed backup exceeds Wrangler's transport ceiling ($transportBytes bytes; maximum $MaximumTransportBytes); no upload started." }
  return [pscustomobject]@{
    Encoding='gzip'; RawBytes=$rawBytes; RawSha256=$rawSha256
    TransportBytes=$transportBytes
    TransportSha256=(Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Expand-D1BackupTransport {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$TransportPath,
    [Parameter(Mandatory)][string]$SqlPath,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$SnapshotKey,
    [Parameter(Mandatory)][string]$ExpectedEnvironment
  )
  $validSchema=($Receipt.schema_version -is [int] -or $Receipt.schema_version -is [long]) -and $Receipt.schema_version -in @(1,2)
  $validBytes=($Receipt.backup_bytes -is [int] -or $Receipt.backup_bytes -is [long]) -and $Receipt.backup_bytes -ge 1024
  if (-not $validSchema -or -not $validBytes -or
      $Receipt.backup_sha256 -isnot [string] -or $Receipt.backup_sha256 -cnotmatch '^[0-9a-f]{64}$' -or
      $Receipt.backup_key -cne $SnapshotKey -or $Receipt.environment -cne $ExpectedEnvironment -or
      $Receipt.database -isnot [string] -or [string]::IsNullOrWhiteSpace($Receipt.database)) {
    throw 'Backup recovery receipt is invalid or does not match the requested snapshot; import not started.'
  }
  $gzipEncoded=$Receipt.schema_version -eq 2
  if ($gzipEncoded) {
    $validTransportBytes=($Receipt.transport_bytes -is [int] -or $Receipt.transport_bytes -is [long]) -and $Receipt.transport_bytes -gt 0
    if ($Receipt.transport_encoding -cne 'gzip' -or -not $validTransportBytes -or
        $Receipt.transport_sha256 -isnot [string] -or $Receipt.transport_sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        -not $SnapshotKey.EndsWith('.sql.gz', [StringComparison]::Ordinal)) {
      throw 'Backup gzip transport receipt is invalid; import not started.'
    }
    if ((Get-Item -LiteralPath $TransportPath).Length -ne $Receipt.transport_bytes -or
        (Get-FileHash -LiteralPath $TransportPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Receipt.transport_sha256) {
      throw 'Backup compressed transport integrity failed; import not started.'
    }
  } else {
    $propertyNames=if ($Receipt -is [Collections.IDictionary]) { @($Receipt.Keys) } else { @($Receipt.PSObject.Properties.Name) }
    $ambiguousTransport=@($propertyNames | Where-Object { $_ -in @('transport_encoding','transport_bytes','transport_sha256') }).Count -gt 0
    if (-not $SnapshotKey.EndsWith('.sql', [StringComparison]::Ordinal) -or $ambiguousTransport) {
      throw 'Legacy backup receipt requires an unambiguous uncompressed SQL snapshot; import not started.'
    }
  }
  if ([IO.Path]::GetFullPath($TransportPath) -eq [IO.Path]::GetFullPath($SqlPath)) { throw 'Backup decoding requires a separate SQL destination.' }
  if ($gzipEncoded) {
    $source=$null; $destination=$null; $gzip=$null
    try {
      $source=[IO.File]::OpenRead($TransportPath)
      $gzip=[IO.Compression.GZipStream]::new($source, [IO.Compression.CompressionMode]::Decompress, $true)
      $destination=[IO.File]::Open($SqlPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $buffer=[byte[]]::new(1048576)
      $decodedBytes=[long]0
      while (($count=$gzip.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $decodedBytes += $count
        if ($decodedBytes -gt $Receipt.backup_bytes) { throw 'Decoded SQL exceeds its verified receipt size.' }
        $destination.Write($buffer, 0, $count)
      }
    } catch { throw 'Backup gzip decoding failed; import not started.' }
    finally {
      if ($null -ne $destination) { $destination.Dispose() }
      if ($null -ne $gzip) { $gzip.Dispose() }
      if ($null -ne $source) { $source.Dispose() }
    }
  } else {
    # Existing schema-1 receipts hash this exact, uncompressed .sql object.
    [IO.File]::Copy($TransportPath, $SqlPath, $false)
  }
  $rawBytes=(Get-Item -LiteralPath $SqlPath).Length
  $rawSha256=(Get-FileHash -LiteralPath $SqlPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($rawBytes -ne $Receipt.backup_bytes -or $rawSha256 -cne $Receipt.backup_sha256) {
    throw 'Backup original SQL integrity failed; import not started.'
  }
  return [pscustomobject]@{RawBytes=$rawBytes; RawSha256=$rawSha256; Encoding=$(if ($gzipEncoded) {'gzip'} else {'identity'})}
}
