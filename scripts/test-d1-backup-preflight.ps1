#requires -Version 7
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'd1-backup-preflight.ps1')

function Assert-True {
  param(
    [Parameter(Mandatory)][bool]$Condition,
    [Parameter(Mandatory)][string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

$originalTemp = [System.Environment]::GetEnvironmentVariable('TEMP', 'Process')
$state = [pscustomobject]@{
  Directory = $null
  Ran = $false
  SuccessDirectory = $null
}

try {
  [System.Environment]::SetEnvironmentVariable('TEMP', $null, 'Process')
  Assert-True ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable('TEMP', 'Process'))) `
    'The regression setup must run with TEMP unset.'

  $caught = $null
  try {
    Invoke-D1BackupTempDirectory -Name "d1-backup-preflight-$([guid]::NewGuid().ToString('N'))" -Operation {
      param([string]$TemporaryDirectory)

      $state.Directory = $TemporaryDirectory
      $state.Ran = $true
      Assert-True (Test-Path -LiteralPath $TemporaryDirectory -PathType Container) `
        'The temporary directory was not created.'
      New-Item -ItemType File -Path (Join-Path $TemporaryDirectory 'partial.sql') | Out-Null
      throw [System.InvalidOperationException]::new('intentional preflight failure')
    }
  }
  catch {
    $caught = $_
  }

  Assert-True ($null -ne $caught) 'The operation should propagate its failure.'
  Assert-True $state.Ran 'The operation did not receive a temporary directory.'
  Assert-True (-not [string]::IsNullOrWhiteSpace($state.Directory)) 'No temporary directory was recorded.'
  Assert-True (-not (Test-Path -LiteralPath $state.Directory)) `
    'The temporary directory was not removed after the failure.'

  Invoke-D1BackupTempDirectory -Name "d1-backup-preflight-success-$([guid]::NewGuid().ToString('N'))" -Operation {
    param([string]$TemporaryDirectory)

    $state.SuccessDirectory = $TemporaryDirectory
    New-Item -ItemType File -Path (Join-Path $TemporaryDirectory 'complete.sql') | Out-Null
  }

  Assert-True (-not [string]::IsNullOrWhiteSpace($state.SuccessDirectory)) `
    'The successful operation did not receive a temporary directory.'
  Assert-True (-not (Test-Path -LiteralPath $state.SuccessDirectory)) `
    'The temporary directory was not removed after a successful operation.'
}
finally {
  [System.Environment]::SetEnvironmentVariable('TEMP', $originalTemp, 'Process')
}

Write-Host '[PASS] D1 backup temp-directory preflight is TEMP-independent and cleans up after failure and success.'

& (Join-Path $PSScriptRoot 'test-d1-backup-recovery.ps1')
