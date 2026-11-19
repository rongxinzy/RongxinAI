param(
  [Parameter(Mandatory = $true)][string]$RuntimeRoot
)

$ErrorActionPreference = 'Stop'
$statePath = Join-Path $RuntimeRoot 'component-switch-state.txt'
if (-not (Test-Path -LiteralPath $statePath)) {
  exit 0
}

$states = @(Get-Content -LiteralPath $statePath)
# An interrupted older CUDA installer can leave this retired component in the
# same journal as current components. Recover the current pointers only.
$retiredComponentKey = 'strata-bundled'
$statePattern = "^(?:channel-runtime|mcps|python|skill-python|skills|uv|llamacpp-bundled|$retiredComponentKey)\|(?:True|False)\z"
# Validate the entire journal before touching any pointer.
foreach ($state in $states) {
  if ($state -cnotmatch $statePattern) {
    throw "Unsupported component recovery state; preserving journal: $state"
  }
}
[array]::Reverse($states)

foreach ($state in $states) {
  $parts = $state.Split('|')
  if ($parts[0] -ceq $retiredComponentKey) { continue }
  $root = Join-Path $RuntimeRoot $parts[0]
  $current = Join-Path $root 'current'
  $next = Join-Path $root 'current.next'
  $previous = Join-Path $root 'current.previous'

  if ($parts[1] -eq 'True' -and (Test-Path -LiteralPath $previous)) {
    if (Test-Path -LiteralPath $current) { [IO.Directory]::Delete($current) }
    Rename-Item -LiteralPath $previous -NewName 'current' -ErrorAction Stop
  } elseif ($parts[1] -eq 'False' -and (Test-Path -LiteralPath $current)) {
    [IO.Directory]::Delete($current)
  }

  if (Test-Path -LiteralPath $next) { [IO.Directory]::Delete($next) }
}

Remove-Item -LiteralPath $statePath -Force -ErrorAction Stop
