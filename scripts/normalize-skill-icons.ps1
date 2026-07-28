param(
  [string]$SkillId
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$skillRoot = Join-Path $PSScriptRoot '..\SKILLs'

function Test-NearWhite([System.Drawing.Color]$color) {
  if ($color.A -eq 0) { return $false }
  $minimum = [Math]::Min($color.R, [Math]::Min($color.G, $color.B))
  $maximum = [Math]::Max($color.R, [Math]::Max($color.G, $color.B))
  return $minimum -ge 240 -and ($maximum - $minimum) -le 16
}

function Get-EdgeBackground([System.Drawing.Bitmap]$bitmap) {
  $width = $bitmap.Width
  $height = $bitmap.Height
  $visited = New-Object 'bool[]' ($width * $height)
  $queue = New-Object 'System.Collections.Generic.Queue[int]'

  function Add-Pixel([int]$x, [int]$y) {
    if ($x -lt 0 -or $y -lt 0 -or $x -ge $bitmap.Width -or $y -ge $bitmap.Height) { return }
    $index = $y * $bitmap.Width + $x
    if ($visited[$index] -or -not (Test-NearWhite ($bitmap.GetPixel($x, $y)))) { return }
    $visited[$index] = $true
    $queue.Enqueue($index)
  }

  for ($x = 0; $x -lt $width; $x++) {
    Add-Pixel $x 0
    Add-Pixel $x ($height - 1)
  }
  for ($y = 1; $y -lt ($height - 1); $y++) {
    Add-Pixel 0 $y
    Add-Pixel ($width - 1) $y
  }

  while ($queue.Count -gt 0) {
    $index = $queue.Dequeue()
    $x = $index % $width
    $y = [int]($index / $width)
    if ($x -gt 0) { Add-Pixel ($x - 1) $y }
    if ($x -lt ($width - 1)) { Add-Pixel ($x + 1) $y }
    if ($y -gt 0) { Add-Pixel $x ($y - 1) }
    if ($y -lt ($height - 1)) { Add-Pixel $x ($y + 1) }
  }

  return $visited
}

function Convert-Icon([System.IO.FileInfo]$sourceFile) {
  $iconDirectory = $sourceFile.DirectoryName
  $originalPath = Join-Path $iconDirectory 'icon-original.png'
  $iconPath = Join-Path $iconDirectory 'icon.png'
  if (-not (Test-Path $originalPath)) {
    Copy-Item -LiteralPath $iconPath -Destination $originalPath
  }

  $source = [System.Drawing.Bitmap]::new($originalPath)
  $work = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($work)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, 256, 256)
  } finally {
    $graphics.Dispose()
    $source.Dispose()
  }

  try {
    $edgeBackground = Get-EdgeBackground $work
    $minX = $work.Width
    $minY = $work.Height
    $maxX = -1
    $maxY = -1

    for ($y = 0; $y -lt $work.Height; $y++) {
      for ($x = 0; $x -lt $work.Width; $x++) {
        $index = $y * $work.Width + $x
        $color = $work.GetPixel($x, $y)
        if ($edgeBackground[$index]) {
          $work.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
          continue
        }
        if ($color.A -gt 0) {
          $minX = [Math]::Min($minX, $x)
          $minY = [Math]::Min($minY, $y)
          $maxX = [Math]::Max($maxX, $x)
          $maxY = [Math]::Max($maxY, $y)
        }
      }
    }

    if ($maxX -lt 0) { throw "Icon has no visible content: $originalPath" }

    $cropWidth = $maxX - $minX + 1
    $cropHeight = $maxY - $minY + 1
    $scale = [Math]::Min(64.0 / $cropWidth, 64.0 / $cropHeight)
    $drawWidth = [int][Math]::Max(1, [Math]::Round($cropWidth * $scale))
    $drawHeight = [int][Math]::Max(1, [Math]::Round($cropHeight * $scale))
    $destinationX = [int][Math]::Floor((72 - $drawWidth) / 2)
    $destinationY = [int][Math]::Floor((72 - $drawHeight) / 2)

    $output = [System.Drawing.Bitmap]::new(72, 72, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
    try {
      $outputGraphics.Clear([System.Drawing.Color]::Transparent)
      $outputGraphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $outputGraphics.DrawImage(
        $work,
        [System.Drawing.Rectangle]::new($destinationX, $destinationY, $drawWidth, $drawHeight),
        [System.Drawing.Rectangle]::new($minX, $minY, $cropWidth, $cropHeight),
        [System.Drawing.GraphicsUnit]::Pixel
      )
      $temporaryPath = "$iconPath.tmp.png"
      $output.Save($temporaryPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Copy-Item -LiteralPath $temporaryPath -Destination $iconPath -Force
      Remove-Item -LiteralPath $temporaryPath -Force
    } finally {
      $outputGraphics.Dispose()
      $output.Dispose()
    }
  } finally {
    $work.Dispose()
  }
}

$icons = Get-ChildItem $skillRoot -Recurse -Filter 'icon.png' -File |
  Where-Object { $_.FullName -match '\\zhiyuan\\icon\.png$' }
if ($SkillId) {
  $icons = $icons | Where-Object { $_.Directory.Parent.Name -eq $SkillId }
}

foreach ($icon in $icons) {
  Convert-Icon $icon
}

Write-Output "Normalized $($icons.Count) skill icon(s)."
