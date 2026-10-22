# Bundled image-text extraction helper (Windows only).
#
# Cowork withholds images from models that cannot read them, so the agent needs a
# dependable way to still get the text out of an attached screenshot. This script
# is that path: Windows.Media.Ocr reached through a correct WinRT projection (the
# naive GetAwaiter()/AsRandomAccessStream() forms fail on Windows PowerShell).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ocr-image.ps1 -Path <image> [-Lang zh-Hans-CN]
#   powershell ... -Paths a.png,b.png -Json          # batch, structured output
#   powershell ... -Status -Json                     # engine + language availability
#
# Default output prints one recognized line per line of text on stdout and exits
# non-zero with a single-line reason on stderr when the image cannot be read.
# -Json writes one JSON document for the whole batch and never exits non-zero for
# a readable-but-textless image: callers must distinguish "no text" from "failed".

param(
    [string]$Path,
    [string[]]$Paths,
    [string]$PathsFile,
    [string]$Lang = 'zh-Hans-CN',
    [switch]$Json,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($env:OS -ne 'Windows_NT') {
    [Console]::Error.WriteLine('ocr-image.ps1 requires Windows (Windows.Media.Ocr).')
    exit 2
}

# WinRT IAsyncOperation -> Task, so the calls can be awaited from PowerShell.
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
if ($null -eq $asTaskGeneric) {
    [Console]::Error.WriteLine('ocr-image.ps1: AsTask projection not found')
    exit 1
}

function Await($operation, $resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

function Get-AvailableLanguages {
    $languages = @()
    foreach ($language in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
        $languages += $language.LanguageTag
    }
    return $languages
}

function New-OcrEngine([string]$LanguageTag) {
    if ($LanguageTag) {
        $language = New-Object Windows.Globalization.Language($LanguageTag)
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        if ($null -ne $engine) { return $engine }
    }
    return [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}

if ($Status) {
    $available = Get-AvailableLanguages
    $engine = New-OcrEngine $Lang
    $document = [ordered]@{
        ready     = ($null -ne $engine)
        languages = $available
        requested = $Lang
        engine    = if ($null -ne $engine) { 'windows-media-ocr' } else { $null }
    }
    if ($Json) {
        $document | ConvertTo-Json -Compress
    } else {
        "ready=$($document.ready) languages=$($available -join ',')"
    }
    exit 0
}

function Get-LineBox($line) {
    $words = @($line.Words)
    if ($words.Count -eq 0) { return $null }
    $left = $words[0].BoundingRect.X
    $top = $words[0].BoundingRect.Y
    $right = $left + $words[0].BoundingRect.Width
    $bottom = $top + $words[0].BoundingRect.Height
    foreach ($word in $words) {
        $rect = $word.BoundingRect
        if ($rect.X -lt $left) { $left = $rect.X }
        if ($rect.Y -lt $top) { $top = $rect.Y }
        if (($rect.X + $rect.Width) -gt $right) { $right = $rect.X + $rect.Width }
        if (($rect.Y + $rect.Height) -gt $bottom) { $bottom = $rect.Y + $rect.Height }
    }
    return [ordered]@{
        x = [math]::Round($left)
        y = [math]::Round($top)
        w = [math]::Round($right - $left)
        h = [math]::Round($bottom - $top)
    }
}

function Invoke-OcrImage([string]$ImagePath, $Engine) {
    $resolved = (Resolve-Path -LiteralPath $ImagePath).Path
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($Engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    foreach ($line in @($result.Lines)) {
        if (-not $line -or -not $line.Text) { continue }
        $entry = [ordered]@{ text = $line.Text }
        $box = Get-LineBox $line
        if ($null -ne $box) {
            $entry.x = $box.x
            $entry.y = $box.y
            $entry.w = $box.w
            $entry.h = $box.h
        }
        $lines += $entry
    }
    return [ordered]@{
        path   = $resolved
        width  = $decoder.PixelWidth
        height = $decoder.PixelHeight
        lines  = $lines
    }
}

$targets = @()
if ($PathsFile) {
    # The app writes a JSON array here so paths containing commas or semicolons
    # never have to be encoded into a command line.
    $fromFile = Get-Content -LiteralPath $PathsFile -Raw | ConvertFrom-Json
    foreach ($entry in @($fromFile)) {
        if ($entry) { $targets += [string]$entry }
    }
}
if ($Paths) {
    # `powershell -File` hands a comma-separated -Paths value over as one string,
    # so split each entry instead of trusting PowerShell's array binding.
    foreach ($entry in @($Paths)) {
        if (-not $entry) { continue }
        foreach ($part in ($entry -split '[,;]')) {
            if ($part) { $targets += $part.Trim() }
        }
    }
}
if ($Path) { $targets = @($Path) + $targets }
if ($targets.Count -eq 0) {
    [Console]::Error.WriteLine('ocr-image.ps1: pass -Path, -Paths or -Status')
    exit 1
}

$engine = New-OcrEngine $Lang
if ($null -eq $engine) {
    $message = "no OCR engine installed for $Lang (add the language pack)"
    if ($Json) {
        @{ results = @(); error = $message } | ConvertTo-Json -Depth 6 -Compress
    } else {
        [Console]::Error.WriteLine("ocr-image.ps1: $message")
    }
    exit 1
}

$results = @()
$failed = 0
foreach ($target in $targets) {
    try {
        $results += Invoke-OcrImage $target $engine
    } catch {
        $failed++
        $results += [ordered]@{
            path   = $target
            lines  = @()
            error  = $_.Exception.Message
        }
    }
}

if ($Json) {
    @{ results = $results } | ConvertTo-Json -Depth 8 -Compress
    exit 0
}

foreach ($result in $results) {
    if ($result.error) {
        [Console]::Error.WriteLine("ocr-image.ps1: $($result.error)")
        continue
    }
    if (@($result.lines).Count -eq 0) {
        # Silence would be indistinguishable from "the helper never ran", which
        # sends the agent hunting for a broken script instead of concluding that
        # this image has no machine-readable text (logos, icons, photos, charts).
        [Console]::Error.WriteLine("ocr-image.ps1: no machine-readable text recognized in $($result.path) ($($result.width)x$($result.height))")
        continue
    }
    foreach ($line in $result.lines) { $line.text }
}

if ($failed -eq $targets.Count) { exit 1 }
exit 0
