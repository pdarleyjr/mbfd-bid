#requires -Version 7

function Invoke-D1BackupTempDirectory {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][scriptblock]$Operation
  )

  $temporaryDirectory = $null
  try {
    $temporaryRoot = [System.IO.Path]::GetTempPath()
    # GitHub's Linux pwsh runner can expose no TEMP/TMPDIR process variable.
    # In that case GetTempPath() yields an unusable empty root and Join-Path
    # rejects the backup before the operation begins. Use the OS temporary
    # directory only as the final, local fallback; the generated child path is
    # still unique and is removed in this function's finally block.
    if ([string]::IsNullOrWhiteSpace($temporaryRoot)) {
      $temporaryRoot = if ($IsWindows) { [System.IO.Path]::Combine($env:SystemRoot, 'Temp') } else { '/tmp' }
    }
    $temporaryPath = Join-Path -Path $temporaryRoot -ChildPath $Name
    $temporaryDirectory = New-Item -ItemType Directory -Path $temporaryPath -ErrorAction Stop

    & $Operation $temporaryDirectory.FullName
  }
  finally {
    if ($null -ne $temporaryDirectory -and (Test-Path -LiteralPath $temporaryDirectory.FullName)) {
      Remove-Item -LiteralPath $temporaryDirectory.FullName -Recurse -Force -ErrorAction Stop
    }
  }
}
