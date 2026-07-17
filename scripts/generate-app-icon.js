/**
 * Generate a multi-size .ico file from a source PNG.
 *
 * ICO format with embedded PNGs:
 *   ICONDIR  (6 bytes)  – reserved(2) + type(2)=1 + count(2)
 *   ICONDIRENTRY * N (16 bytes each)
 *   PNG data blobs
 *
 * We use System.Drawing via PowerShell to resize the source image into
 * several sizes, save them as temporary PNGs, then pack them into .ico
 * purely with Node buffers.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE = path.join(__dirname, '..', 'public', 'logo.png');
const OUT_DIR = path.join(__dirname, '..', 'build', 'icons', 'win');
const OUT_ICO = path.join(OUT_DIR, 'icon.ico');
const SIZES = [256, 128, 64, 48, 32, 16];

// Ensure output directory exists
fs.mkdirSync(OUT_DIR, { recursive: true });

// Step 1: Use PowerShell + System.Drawing to resize the source PNG
const tmpDir = path.join(__dirname, '..', 'build', 'icons', '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const psScript = `
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile("${SOURCE.replace(/\\/g, '\\\\')}")
$sizes = @(${SIZES.join(',')})

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()
    $outPath = "${tmpDir.replace(/\\/g, '\\\\')}\\\\icon_$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$src.Dispose()
`;

const psFile = path.join(tmpDir, 'resize.ps1');
fs.writeFileSync(psFile, psScript, 'utf8');
execSync(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, { stdio: 'inherit' });

// Step 2: Read resized PNGs and pack into ICO
const pngBuffers = SIZES.map(s => {
  const p = path.join(tmpDir, `icon_${s}.png`);
  return { size: s, data: fs.readFileSync(p) };
});

const count = pngBuffers.length;
const headerSize = 6;
const entrySize = 16;
const dataOffset0 = headerSize + entrySize * count;

// Calculate offsets
let currentOffset = dataOffset0;
const entries = pngBuffers.map(({ size, data }) => {
  const entry = {
    width: size >= 256 ? 0 : size, // 0 means 256 in ICO format
    height: size >= 256 ? 0 : size,
    dataSize: data.length,
    offset: currentOffset,
    data,
  };
  currentOffset += data.length;
  return entry;
});

// Build ICO buffer
const totalSize = currentOffset;
const ico = Buffer.alloc(totalSize);

// ICONDIR
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type = ICO
ico.writeUInt16LE(count, 4); // image count

// ICONDIRENTRY for each image
entries.forEach((e, i) => {
  const off = headerSize + i * entrySize;
  ico.writeUInt8(e.width, off + 0); // width
  ico.writeUInt8(e.height, off + 1); // height
  ico.writeUInt8(0, off + 2); // color palette
  ico.writeUInt8(0, off + 3); // reserved
  ico.writeUInt16LE(1, off + 4); // color planes
  ico.writeUInt16LE(32, off + 6); // bits per pixel
  ico.writeUInt32LE(e.dataSize, off + 8); // image data size
  ico.writeUInt32LE(e.offset, off + 12); // image data offset
});

// Image data
entries.forEach(e => {
  e.data.copy(ico, e.offset);
});

fs.writeFileSync(OUT_ICO, ico);
console.log(`Generated ${OUT_ICO} (${SIZES.join(', ')}px) — ${ico.length} bytes`);

// Cleanup temp files
fs.rmSync(tmpDir, { recursive: true, force: true });
