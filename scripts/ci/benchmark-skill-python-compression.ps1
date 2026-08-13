param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$ComponentsDir = '',
  [string]$SevenZipPath = '',
  [int]$ExtractionRuns = 2,
  [int64]$MinimumSavingsBytes = 1MB,
  [double]$MaximumExtractionRatio = 1.25,
  [string]$ReportPath = '',
  [switch]$SkipPythonProbe,
  [switch]$RequireQualified
)

$ErrorActionPreference = 'Stop'

function Assert-Path {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing ${Label}: $Path"
  }
}

function Remove-DirectoryTree {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$BestEffort
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  try {
    $extendedPath = if ($Path.StartsWith('\\?\')) { $Path } else { "\\?\$Path" }
    [IO.Directory]::Delete($extendedPath, $true)
  } catch {
    if ($BestEffort) {
      Write-Warning "Could not remove benchmark directory ${Path}: $($_.Exception.Message)"
      return
    }
    throw
  }
}

function Invoke-SevenZip {
  param(
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label
  )
  & $SevenZipPath @ArgumentList | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Expand-ArchiveMeasured {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string]$Label
  )
  New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  Invoke-SevenZip @('x', '-bd', '-y', "-o$DestinationPath", $ArchivePath) $Label
  $stopwatch.Stop()
  return [int64]$stopwatch.ElapsedMilliseconds
}

function Get-ExtractedTreeManifest {
  param([Parameter(Mandatory = $true)][string]$Root)
  $manifest = @{}
  foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
    $relativePath = $item.FullName.Substring($Root.Length).TrimStart('\').Replace('\', '/')
    if ($item.PSIsContainer) {
      $manifest[$relativePath] = 'directory'
    } else {
      $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $manifest[$relativePath] = "file:$($item.Length):$hash"
    }
  }
  return $manifest
}

function Assert-TreesEqual {
  param(
    [Parameter(Mandatory = $true)][string]$BaselineRoot,
    [Parameter(Mandatory = $true)][string]$CandidateRoot
  )
  $baseline = Get-ExtractedTreeManifest $BaselineRoot
  $candidate = Get-ExtractedTreeManifest $CandidateRoot
  if ($baseline.Count -ne $candidate.Count) {
    throw "Skill Python archive entry count mismatch: baseline $($baseline.Count), solid $($candidate.Count)"
  }
  foreach ($entry in $baseline.GetEnumerator()) {
    if (-not $candidate.ContainsKey($entry.Key)) {
      throw "Skill Python solid archive is missing entry: $($entry.Key)"
    }
    if ($candidate[$entry.Key] -ne $entry.Value) {
      throw "Skill Python archive entry mismatch: $($entry.Key)"
    }
  }
}

function Invoke-PythonProbe {
  param([Parameter(Mandatory = $true)][string]$PythonPath, [Parameter(Mandatory = $true)][string]$Label)
  $modules = @(
    'PIL',
    'cnlunar',
    'colorama',
    'line_profiler',
    'lunardate',
    'matplotlib',
    'numpy',
    'openpyxl',
    'pandas',
    'pip_audit',
    'psycopg2',
    'pylint',
    'pypdf',
    'pypdfium2',
    'pytest',
    'reportlab',
    'scipy',
    'statsmodels'
  )
  $probe = 'import ' + ($modules -join ',') + '; print(1)'
  & $PythonPath -c $probe
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

if ($ExtractionRuns -lt 1) {
  throw 'ExtractionRuns must be at least 1'
}
if ($MaximumExtractionRatio -le 0) {
  throw 'MaximumExtractionRatio must be greater than 0'
}
if (-not $ComponentsDir) {
  $ComponentsDir = Join-Path $ProjectRoot 'build-tar\windows-components'
}
if (-not $SevenZipPath) {
  $SevenZipPath = Join-Path $ProjectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
}
if (-not $ReportPath) {
  $ReportPath = Join-Path $ComponentsDir 'skill-python-compression-benchmark.json'
}

$sourceRoot = Join-Path $ProjectRoot 'resources\skill-python'
$manifestPath = Join-Path $ComponentsDir 'manifest.json'
Assert-Path $sourceRoot 'shared Skill Python source layer'
Assert-Path $manifestPath 'Windows component manifest'
Assert-Path $SevenZipPath '7za.exe'

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$components = @($manifest.components | Where-Object { $_.key -eq 'skill-python' })
if ($components.Count -ne 1) {
  throw "Expected exactly one skill-python component; found $($components.Count)"
}
$component = $components[0]
if ($component.archiveCompression -ne 'lzma2-mx9-solid-v1') {
  throw "Skill Python component must use lzma2-mx9-solid-v1; found $($component.archiveCompression)"
}
$solidArchive = Join-Path $ComponentsDir $component.archive
Assert-Path $solidArchive 'solid Skill Python component archive'

$benchmarkRoot = Join-Path ([IO.Path]::GetTempPath()) ("zspb-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N').Substring(0, 8))
$baselineArchive = Join-Path $benchmarkRoot 'skill-python-nonsolid.7z'
$baselineTimes = @()
$solidTimes = @()
$baselineExtractedRoot = ''
$solidExtractedRoot = ''

try {
  New-Item -ItemType Directory -Path $benchmarkRoot -Force | Out-Null
  Push-Location (Join-Path $ProjectRoot 'resources')
  try {
    Invoke-SevenZip @(
      'a', '-t7z', '-mx=9', '-m0=lzma2', '-ms=off', '-mmt=on', $baselineArchive, 'skill-python'
    ) 'Skill Python non-solid baseline archive creation'
  } finally {
    Pop-Location
  }

  $solidListing = (& $SevenZipPath 'l' '-slt' $solidArchive 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "Skill Python solid archive listing failed with exit code $LASTEXITCODE"
  }
  if ($solidListing -notmatch '(?m)^Solid = \+$') {
    throw 'Skill Python candidate archive is not solid'
  }

  for ($run = 0; $run -lt $ExtractionRuns; $run++) {
    $order = if (($run % 2) -eq 0) { @('baseline', 'solid') } else { @('solid', 'baseline') }
    foreach ($profile in $order) {
      $destination = Join-Path $benchmarkRoot ("extract-{0}-{1}" -f $profile, $run)
      $archive = if ($profile -eq 'baseline') { $baselineArchive } else { $solidArchive }
      $elapsed = Expand-ArchiveMeasured $archive $destination "Skill Python $profile extraction run $($run + 1)"
      if ($profile -eq 'baseline') {
        $baselineTimes += $elapsed
        if ($run -eq 0) { $baselineExtractedRoot = $destination }
      } else {
        $solidTimes += $elapsed
        if ($run -eq 0) { $solidExtractedRoot = $destination }
      }
      if ($run -ne 0) {
        Remove-DirectoryTree $destination
      }
    }
  }

  Assert-TreesEqual $baselineExtractedRoot $solidExtractedRoot
  if (-not $SkipPythonProbe) {
    $relativePython = 'skill-python\layers\shared\Scripts\python.exe'
    $baselinePython = Join-Path $baselineExtractedRoot $relativePython
    $solidPython = Join-Path $solidExtractedRoot $relativePython
    Assert-Path $baselinePython 'non-solid shared Skill Python executable'
    Assert-Path $solidPython 'solid shared Skill Python executable'
    Invoke-PythonProbe $baselinePython 'Non-solid shared Skill Python dependency probe'
    Invoke-PythonProbe $solidPython 'Solid shared Skill Python dependency probe'
  }

  $baselineBytes = [int64](Get-Item -LiteralPath $baselineArchive).Length
  $solidBytes = [int64](Get-Item -LiteralPath $solidArchive).Length
  $savedBytes = $baselineBytes - $solidBytes
  $baselineAverageMs = [math]::Round(($baselineTimes | Measure-Object -Average).Average, 1)
  $solidAverageMs = [math]::Round(($solidTimes | Measure-Object -Average).Average, 1)
  $extractionRatio = if ($baselineAverageMs -gt 0) {
    [math]::Round($solidAverageMs / $baselineAverageMs, 3)
  } else {
    [double]::PositiveInfinity
  }
  $qualified = $savedBytes -ge $MinimumSavingsBytes -and $extractionRatio -le $MaximumExtractionRatio

  $report = [ordered]@{
    qualified = $qualified
    baselineBytes = $baselineBytes
    solidBytes = $solidBytes
    savedBytes = $savedBytes
    baselineExtractionMilliseconds = $baselineTimes
    solidExtractionMilliseconds = $solidTimes
    baselineAverageMilliseconds = $baselineAverageMs
    solidAverageMilliseconds = $solidAverageMs
    extractionRatio = $extractionRatio
    minimumSavingsBytes = $MinimumSavingsBytes
    maximumExtractionRatio = $MaximumExtractionRatio
    contentSha256Equal = $true
    pythonProbePassed = -not $SkipPythonProbe
  }
  $reportDirectory = Split-Path -Parent $ReportPath
  New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
  $reportJson = $report | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText($ReportPath, $reportJson, [Text.UTF8Encoding]::new($false))

  $summary = @(
    '### Shared Skill Python compression benchmark',
    '',
    "- qualified: $($qualified.ToString().ToLowerInvariant())",
    "- non-solid bytes: $baselineBytes",
    "- solid bytes: $solidBytes",
    "- saved bytes: $savedBytes",
    "- non-solid extraction milliseconds: $($baselineTimes -join ', ')",
    "- solid extraction milliseconds: $($solidTimes -join ', ')",
    "- extraction ratio: $extractionRatio (maximum $MaximumExtractionRatio)",
    '- extracted content SHA-256: identical',
    "- dependency probe: $(if ($SkipPythonProbe) { 'skipped' } else { 'passed' })"
  ) -join [Environment]::NewLine
  Write-Host $summary
  if ($env:GITHUB_STEP_SUMMARY) {
    Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summary -Encoding UTF8
  }
  if ($env:GITHUB_OUTPUT) {
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "qualified=$($qualified.ToString().ToLowerInvariant())" -Encoding UTF8
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "saved_bytes=$savedBytes" -Encoding UTF8
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "extraction_ratio=$extractionRatio" -Encoding UTF8
  }
  if ($RequireQualified -and -not $qualified) {
    throw "Shared Skill Python solid compression did not meet the required size and extraction thresholds"
  }
} finally {
  Remove-DirectoryTree $benchmarkRoot -BestEffort
}
