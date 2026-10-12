#!/usr/bin/env node

/*
 * Builds the 24-bit BMP assets required by the fully custom-drawn NSIS
 * installer UI from the same light product language as the application.
 * Keep this script with the source application mark so future brand changes
 * are deterministic rather than manual.
 *
 * Asset contract (consumed by scripts/installer-ui/zy-theme.nsh and staged
 * into $PLUGINSDIR by the ZY_StageUiAssets macro). Geometry is 3x (2x for
 * the strips) of the MUI2-faithful preview measurements: wizard client
 * 497x333, page content 450x210, header strip 497x63.
 *   zy-band.bmp         994x126 (2x of the 497x63 header strip). Painted by
 *                       ZY_HideMuiChrome over the hidden native header
 *                       controls so no stock chrome shows through.
 *   zy-bg.bmp           1350x630 (3x of the 450x210 MUI2 content area). Top
 *                       25% carries the gradient, dot lattice, brand glow and
 *                       app icon; the remainder is a flat #F5F9FF zone where
 *                       the wizard places text controls, so their solid
 *                       background brushes blend seamlessly.
 *   zy-wordmark.bmp     360x157 product wordmark on a #FFFFFF base, drawn
 *                       onto the top band of the hero page.
 *   zy-bar-fill.bmp     600x28 rounded brand bar, rounded LEFT end only; the
 *                       right end is a straight cut so the sliding mask can
 *                       abut it without corner artifacts.
 *   zy-bar-complete.bmp 600x28 rounded bar with BOTH ends rounded (100% state)
 *   zy-bar-track.bmp    600x28 track-color bar, straight LEFT cut and rounded
 *                       RIGHT end; used both as the full progress track and
 *                       as the mask that reveals the fill left-to-right.
 *   zy-done.bmp         192x192 success glyph (brand circle + white check)
 *   zy-side.bmp         436x772 (2x of the 109u x 193u MUI welcome/finish
 *                       side image) for the native uninstaller finish page.
 *   license.txt         verbatim copy of the repository LICENSE, shown by the
 *                       hero page license link.
 *
 * The legacy installerHeader/installerSidebar/uninstallerSidebar BMPs are
 * gone: the custom UI no longer uses any MUI chrome bitmaps.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const projectRoot = path.resolve(__dirname, '..');
const assetDir = path.join(projectRoot, 'build', 'installer-assets');
const wordmarkPath = path.join(projectRoot, 'public', 'zhiyuan-logo-light-1600.png');
const appIconPath = path.join(projectRoot, 'build', 'icons', 'png', '256x256.png');

const BRAND = '#0F6BF2';
const BG_TOP = '#FFFFFF';
const BG_BOTTOM = '#F5F9FF'; // must equal ZY_COLOR_BG in zy-theme.nsh
const TRACK = '#E5E7EB';
// Share the flat page tint with the NSIS theme: label background brushes must
// match this zone exactly or the text rows would show as patches. The header
// strip carries the main art; the page background keeps a shallow band so the
// white-based wordmark still blends at the top of the hero page.
const FLAT_ZONE_TOP = 0.25;

function drawDots(context, width, height, opacity = 0.055) {
  context.fillStyle = `rgba(92, 112, 145, ${opacity})`;
  for (let y = 12; y < height; y += 26) {
    for (let x = 12; x < width; x += 26) {
      context.beginPath();
      context.arc(x, y, 1.1, 0, Math.PI * 2);
      context.fill();
    }
  }
}

// Gradient, dot lattice, soft brand glow and app icon. The gradient ends on
// the flat zone color, so the band melts into whatever sits below without a
// seam line.
function paintBand(ctx, width, height, icon, iconSize, iconMargin) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, BG_TOP);
  gradient.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  drawDots(ctx, width, height);

  // A single soft brand glow anchors the upper area; restraint over decoration.
  const glow = ctx.createRadialGradient(
    width * 0.82,
    height * 0.3,
    0,
    width * 0.82,
    height * 0.3,
    height * 0.9,
  );
  glow.addColorStop(0, 'rgba(15, 107, 242, 0.10)');
  glow.addColorStop(1, 'rgba(15, 107, 242, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // App icon at the band's right end, kept clear of the wordmark. Skipped
  // when the caller asks for a pattern-only band (iconSize 0).
  if (iconSize > 0) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(icon, width - iconSize - iconMargin, (height - iconSize) / 2, iconSize, iconSize);
    ctx.restore();
  }
}

function drawBackground(width, height, icon) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const bandHeight = Math.round(height * FLAT_ZONE_TOP);

  // Flat brand tint over the whole surface first; the band below repaints the
  // art zone, leaving the flat zone a pure control surface.
  ctx.fillStyle = BG_BOTTOM;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, bandHeight);
  ctx.clip();
  // The header strip carries the app icon; the page band stays pattern-only.
  paintBand(ctx, width, bandHeight, icon, 0, 0);
  ctx.restore();

  return canvas;
}

// Header strip painted across the wizard header area (native header controls
// hidden) so the chrome carries the same brand language as the content.
function drawHeaderBand(width, height, icon) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  paintBand(ctx, width, height, icon, 80, 24);
  return canvas;
}

function drawBar(leftRounded, rightRounded, color = BRAND) {
  const width = 600;
  const height = 28;
  const radius = height / 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(leftRounded ? radius : 0, 0);
  ctx.lineTo(rightRounded ? width - radius : width, 0);
  if (rightRounded) ctx.arc(width - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
  else ctx.lineTo(width, height);
  ctx.lineTo(leftRounded ? radius : 0, height);
  if (leftRounded) ctx.arc(radius, radius, radius, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  ctx.fill();

  // Subtle top highlight keeps the bar from reading as a flat rectangle.
  const highlight = ctx.createLinearGradient(0, 0, 0, height);
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
  highlight.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.moveTo(leftRounded ? radius : 0, 0);
  ctx.lineTo(rightRounded ? width - radius : width, 0);
  if (rightRounded) ctx.arc(width - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
  else ctx.lineTo(width, height);
  ctx.lineTo(leftRounded ? radius : 0, height);
  if (leftRounded) ctx.arc(radius, radius, radius, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

function drawWordmark(wordmark) {
  // 360px wide on the exact top-of-page white so the static blends into the
  // background band (24-bit BMP has no alpha channel).
  const width = 360;
  const height = Math.round((width * wordmark.height) / wordmark.width);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG_TOP;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(wordmark, 0, 0, width, height);

  return canvas;
}

function drawDoneGlyph() {
  const size = 192;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Flatten onto the page tint: 24-bit BMP has no alpha, so transparent
  // canvas corners would otherwise read as black.
  ctx.fillStyle = '#F5F9FF';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = BRAND;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.3, size * 0.52);
  ctx.lineTo(size * 0.45, size * 0.67);
  ctx.lineTo(size * 0.72, size * 0.36);
  ctx.stroke();

  return canvas;
}

function drawSide(wordmark) {
  // 2x of the 109u x 193u MUI welcome/finish side image consumed by the
  // native uninstaller finish page (MUI_UNWELCOMEFINISHPAGE_BITMAP).
  const width = 436;
  const height = 772;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const bandHeight = Math.round(height * FLAT_ZONE_TOP);

  ctx.fillStyle = BG_BOTTOM;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, bandHeight);
  ctx.clip();
  const gradient = ctx.createLinearGradient(0, 0, 0, bandHeight);
  gradient.addColorStop(0, BG_TOP);
  gradient.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, bandHeight);
  drawDots(ctx, width, bandHeight);
  ctx.restore();

  // Success circle with the brand check, centered in the flat zone.
  const done = drawDoneGlyph();
  const doneSize = 232;
  ctx.drawImage(done, (width - doneSize) / 2, bandHeight + 90, doneSize, doneSize);

  // Product wordmark near the bottom, dark ink on the flat tint.
  const markWidth = 320;
  const markHeight = Math.round((markWidth * wordmark.height) / wordmark.width);
  ctx.drawImage(wordmark, (width - markWidth) / 2, height - markHeight - 72, markWidth, markHeight);

  return canvas;
}

function writeBmp(canvas, filename) {
  const output = path.join(assetDir, filename);
  const context = canvas.getContext('2d');
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const headerSize = 54;
  const bmp = Buffer.alloc(headerSize + pixelDataSize);

  // BITMAPFILEHEADER
  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(headerSize, 10);

  // BITMAPINFOHEADER. A positive height stores rows bottom-up, as expected by
  // NSIS' classic bitmap loader. Pixels are opaque 24-bit BGR with padded rows.
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(pixelDataSize, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);

  for (let outputRow = 0; outputRow < height; outputRow += 1) {
    const sourceRow = height - 1 - outputRow;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceRow * width + x) * 4;
      const target = headerSize + outputRow * rowSize + x * 3;
      bmp[target] = data[source + 2];
      bmp[target + 1] = data[source + 1];
      bmp[target + 2] = data[source];
    }
  }
  fs.writeFileSync(output, bmp);
  console.log(`[NSIS brand assets] wrote ${filename} (${bmp.length} bytes)`);
}

async function build() {
  fs.mkdirSync(assetDir, { recursive: true });
  const [wordmark, icon] = await Promise.all([loadImage(wordmarkPath), loadImage(appIconPath)]);

  writeBmp(drawHeaderBand(994, 126, icon), 'zy-band.bmp');
  writeBmp(drawBackground(1350, 630, icon), 'zy-bg.bmp');
  writeBmp(drawWordmark(wordmark), 'zy-wordmark.bmp');
  writeBmp(drawBar(true, false), 'zy-bar-fill.bmp');
  writeBmp(drawBar(true, true), 'zy-bar-complete.bmp');
  writeBmp(drawBar(false, true, TRACK), 'zy-bar-track.bmp');
  writeBmp(drawDoneGlyph(), 'zy-done.bmp');
  writeBmp(drawSide(wordmark), 'zy-side.bmp');

  // The hero page links the bundled license text; keep it next to the bitmaps
  // so the NSIS File command resolves it at compile time.
  const licenseSource = path.join(projectRoot, 'LICENSE');
  const licenseTarget = path.join(assetDir, 'license.txt');
  fs.copyFileSync(licenseSource, licenseTarget);
  console.log(`[NSIS brand assets] wrote license.txt (${fs.statSync(licenseTarget).size} bytes)`);
}

build().catch(error => {
  console.error('[NSIS brand assets] failed:', error);
  process.exitCode = 1;
});
