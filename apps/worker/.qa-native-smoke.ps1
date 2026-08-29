[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$StatePath,
  [int]$Port = 8791
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The caller must prepare a fresh, local-only D1 state first: apply the
# reviewed migrations and seed the synthetic admin member used by this smoke.
# This script never creates a remote database, uses real credentials, or seeds
# a staging/production identity.
$baseUrl = "http://127.0.0.1:$Port"
$runStartedAt = Get-Date
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Refusing native smoke: port $Port is already in use"
}

# These are disposable test-only values; they are never read from user, staging,
# or production configuration, and the token is held only in this process.
$jwtKey = 'a' * 64
$teleStaffKey = 'b' * 64
$env:QA_SMOKE_JWT_KEY = $jwtKey
$token = node --input-type=module -e "import { SignJWT } from 'jose'; const key=Buffer.from(process.env.QA_SMOKE_JWT_KEY,'hex'); const now=Math.floor(Date.now()/1000); const token=await new SignJWT({sub:1,emp:'QA-SYNTH-000001',role:'admin',rank:'CHIEF',first_name:'QA',last_name:'Operator',fresh_auth_at:now}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('8h').sign(key); process.stdout.write(token);"
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Failed to generate the ephemeral native-smoke JWT'
}

$stdout = Join-Path $StatePath 'wrangler-dev.stdout.log'
$stderr = Join-Path $StatePath 'wrangler-dev.stderr.log'
$fixturePath = Join-Path $StatePath 'synthetic-telestaff.html'
$responsePath = Join-Path $StatePath 'native-smoke-response.json'
$args = "pnpm@9.12.0 exec wrangler dev --env staging --local --persist-to `"$StatePath`" --ip 127.0.0.1 --port $Port --var `"JWT_SIGNING_KEY:$jwtKey`" --var `"TELESTAFF_HMAC_KEY:$teleStaffKey`""
$worker = $null
$client = $null
$workspaceRoot = (Resolve-Path (Join-Path (Get-Location) '..\..')).Path

function Invoke-Upload([string]$Path) {
  $html = '<!doctype html><html><body><table><thead><tr><th>Name</th><th>Emp ID</th><th>Shift</th><th>Division</th><th>Station</th><th>Unit</th><th>Position</th><th>A/R Day</th></tr></thead><tbody><tr><td>QA Synthetic</td><td>QA-SYNTH-000001</td><td>A Shift</td><td>Suppression/Rescue</td><td>1</td><td>Engine 1</td><td>Firefighter</td><td>G1</td></tr></tbody></table></body></html>'
  [System.IO.File]::WriteAllText($fixturePath, $html, [Text.Encoding]::UTF8)
  $status = & curl.exe --silent --show-error --output $responsePath --write-out '%{http_code}' `
    --request POST --header "Authorization: Bearer $token" `
    --form "file=@$fixturePath;type=text/html" `
    --form 'source_snapshot_as_of=2026-08-28' `
    --form 'source_kind=synthetic_test' `
    "$baseUrl$Path"
  if ($LASTEXITCODE -ne 0) { throw "curl upload failed with exit $LASTEXITCODE" }
  return [pscustomobject]@{
    Status = [int]($status.Trim())
    Body = [System.IO.File]::ReadAllText($responsePath, [Text.Encoding]::UTF8)
  }
}

function Invoke-Json([System.Net.Http.HttpClient]$HttpClient, [string]$Method, [string]$Path, [object]$Payload) {
  $content = [System.Net.Http.StringContent]::new(
    ($Payload | ConvertTo-Json -Compress),
    [Text.Encoding]::UTF8,
    'application/json'
  )
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::new($Method.ToUpperInvariant()),
    "$baseUrl$Path"
  )
  $request.Content = $content
  $response = $HttpClient.SendAsync($request).GetAwaiter().GetResult()
  $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $body }
}

try {
  $worker = Start-Process -FilePath (Get-Command corepack -ErrorAction Stop).Source `
    -ArgumentList $args `
    -WorkingDirectory (Get-Location) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  $healthy = $false
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 1
      if ($health.ok -eq $true -and $health.env -eq 'staging') {
        $healthy = $true
        break
      }
    } catch {
      # The local Worker is still starting.
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $healthy) {
    $tail = @()
    if (Test-Path -LiteralPath $stderr) { $tail += Get-Content -LiteralPath $stderr -Tail 20 }
    if (Test-Path -LiteralPath $stdout) { $tail += Get-Content -LiteralPath $stdout -Tail 20 }
    throw ('Local Worker did not become healthy. ' + ($tail -join ' | '))
  }

  $client = [System.Net.Http.HttpClient]::new()
  $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)

  $preview = Invoke-Upload '/api/admin/telestaff/imports/preview'
  if ($preview.Status -ne 200) {
    throw "Preview expected 200, got $($preview.Status): $($preview.Body)"
  }

  $staged = Invoke-Upload '/api/admin/telestaff/imports'
  if ($staged.Status -ne 201) { throw "Stage expected 201, got $($staged.Status): $($staged.Body)" }
  $stagedJson = $staged.Body | ConvertFrom-Json
  $importId = [string]$stagedJson.import.id
  if ([string]::IsNullOrWhiteSpace($importId)) { throw 'Staged response lacked an import identifier' }

  $detailResponse = $client.GetAsync("$baseUrl/api/admin/telestaff/imports/$importId").GetAwaiter().GetResult()
  $detailBody = $detailResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if ([int]$detailResponse.StatusCode -ne 200) {
    throw "Detail expected 200, got $([int]$detailResponse.StatusCode)"
  }
  $detail = $detailBody | ConvertFrom-Json
  $rowId = [string]$detail.rows[0].id
  $revision = [int]$detail.import.reconciliationRevision
  if ([string]::IsNullOrWhiteSpace($rowId)) { throw 'Reconciliation did not yield a source row' }

  $review = Invoke-Json $client 'PATCH' "/api/admin/telestaff/imports/$importId/rows/$rowId/review" @{
    expected_reconciliation_revision = $revision
    decision = 'reject_source_row'
  }
  if ($review.Status -ne 200) {
    throw "Review expected 200, got $($review.Status) at revision ${revision}: $($review.Body)"
  }
  $reviewJson = $review.Body | ConvertFrom-Json
  $reviewRevision = [int]$reviewJson.import.reconciliationRevision

  $apply = Invoke-Json $client 'POST' "/api/admin/telestaff/imports/$importId/apply" @{
    expected_reconciliation_revision = $reviewRevision
  }
  if ($apply.Status -ne 409) { throw "Synthetic apply expected 409, got $($apply.Status)" }
  $applyJson = $apply.Body | ConvertFrom-Json
  if ($applyJson.error -ne 'synthetic_source_cannot_apply') {
    throw 'Synthetic apply returned an unexpected safety response'
  }

  [pscustomobject]@{
    health = '200 staging-local'
    preview = $preview.Status
    stage = $staged.Status
    detail = [int]$detailResponse.StatusCode
    review = $review.Status
    apply = "$($apply.Status) synthetic_source_cannot_apply"
  } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $client) { $client.Dispose() }
  $knownWorkerTreeIds = @()
  if ($null -ne $worker) {
    # On Windows Start-Process launches the corepack command shell, which owns
    # pnpm, Wrangler, esbuild, and workerd descendants. Capture only that
    # exact tree before stopping it; stopping just the root leaves descendants
    # alive even after port $Port is reclaimed.
    $processes = @(Get-CimInstance Win32_Process)
    $treeIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$treeIds.Add([int]$worker.Id)
    $treeChanged = $true
    while ($treeChanged) {
      $treeChanged = $false
      foreach ($process in $processes) {
        if ($treeIds.Contains([int]$process.ParentProcessId) -and $treeIds.Add([int]$process.ProcessId)) {
          $treeChanged = $true
        }
      }
    }
    $knownWorkerTreeIds = @($treeIds)
    if ($knownWorkerTreeIds.Count -gt 0) {
      Stop-Process -Id $knownWorkerTreeIds -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 500
  if ($knownWorkerTreeIds.Count -gt 0) {
    $remainingWorkerTree = @(
      Get-CimInstance Win32_Process | Where-Object { $knownWorkerTreeIds -contains [int]$_.ProcessId }
    )
    if ($remainingWorkerTree.Count -gt 0) {
      throw "Native-smoke local Worker process tree did not stop ($($remainingWorkerTree.Count) process(es) remain)"
    }
  }
  # Wrangler leaves a local workerd child on Windows. Only stop a listener
  # proven to be this run's workspace-local child, never an arbitrary process.
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $candidate = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if (
      $null -ne $candidate -and
      $candidate.ProcessName -eq 'workerd' -and
      $candidate.Path -like "$workspaceRoot\node_modules\*" -and
      # The test asserted the port was free first. Allow a small timestamp
      # tolerance because Windows can report the workerd child a fraction
      # before its corepack parent process's StartTime.
      $candidate.StartTime -ge $runStartedAt.AddSeconds(-5)
    ) {
      Stop-Process -Id $candidate.Id -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Native-smoke local Worker did not stop on port $Port"
  }
  Remove-Item Env:QA_SMOKE_JWT_KEY -ErrorAction SilentlyContinue
}
