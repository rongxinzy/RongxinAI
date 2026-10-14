# Bundled image-text extraction helper (Windows only).
#
# Cowork withholds images from models that cannot read them, so the agent needs a
# dependable way to still get the text out of an attached screenshot. This script
# is that path: Windows.Media.Ocr reached through a correct WinRT projection (the
# naive GetAwaiter()/AsRandomAccessStream() forms fail on Windows PowerShell).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ocr-image.ps1 -Path <image> [-Lang zh-Hans-CN]
#
# Prints one recognized line per line of text on stdout and exits non-zero with a
# single-line reason on stderr when the image cannot be read.

param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Lang = 'zh-Hans-CN'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($env:OS -ne 'Windows_NT') {
    [Console]::Error.WriteLine('ocr-image.ps1 requires Windows (Windows.Media.Ocr).')
    exit 2
}

try {
    $full = (Resolve-Path -LiteralPath $Path).Path
} catch {
    [Console]::Error.WriteLine("ocr-image.ps1: image not found: $Path")
    exit 3
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

    # WinRT IAsyncOperation -> Task, so the calls can be awaited from PowerShell.
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    if ($null -eq $asTaskGeneric) { throw 'AsTask projection not found' }

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

    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $language = New-Object Windows.Globalization.Language($Lang)
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if ($null -eq $engine) { throw "no OCR engine installed for $Lang (add the language pack)" }

    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    # Force an array: an empty WinRT list projects to $null, whose .Count would
    # not compare equal to 0 and would hide exactly the case this guards.
    $lines = @($result.Lines | ForEach-Object { $_.Text } | Where-Object { $_ })
    if ($lines.Count -eq 0) {
        # Silence would be indistinguishable from "the helper never ran", which
        # sends the agent hunting for a broken script instead of concluding that
        # this image has no machine-readable text (logos, icons, photos, charts).
        [Console]::Error.WriteLine("ocr-image.ps1: no machine-readable text recognized in $full ($($decoder.PixelWidth)x$($decoder.PixelHeight))")
        exit 0
    }
    $lines | ForEach-Object { $_ }
    exit 0
} catch {
    [Console]::Error.WriteLine("ocr-image.ps1: $($_.Exception.Message)")
    exit 1
}
