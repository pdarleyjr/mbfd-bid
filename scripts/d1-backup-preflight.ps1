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
