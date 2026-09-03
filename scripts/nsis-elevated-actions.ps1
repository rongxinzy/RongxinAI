[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install-vc-runtime')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$Target,

  [Parameter(Mandatory = $true)]
  [string]$ResultPath
)

$ErrorActionPreference = 'Stop'

function Write-ActionResult {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Status,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $normalizedMessage = $Message -replace '[\r\n]+', ' '
  [IO.File]::WriteAllText(
    $ResultPath,
    "$Status|$normalizedMessage",
    [Text.UTF8Encoding]::new($false)
  )
}

try {
  $exitCode = 0

  switch ($Action) {
    'install-vc-runtime' {
      if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
        throw "VC++ runtime installer is missing: $Target"
      }

      $process = Start-Process -FilePath $Target -ArgumentList @(
        '/install',
        '/quiet',
        '/norestart'
      ) -Wait -PassThru -ErrorAction Stop
      $exitCode = $process.ExitCode

      if ($exitCode -notin @(0, 1638, 3010)) {
        throw "VC++ runtime installer exited with code $exitCode"
      }
    }
  }

  Write-ActionResult -Status 'success' -Message "$Action completed"
  exit $exitCode
} catch {
  Write-ActionResult -Status 'error' -Message $_.Exception.Message
  exit 1
}
