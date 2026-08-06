#!/usr/bin/env node

/*
 * Builds the small, 24-bit BMP assets required by NSIS from the same light
 * product language as www.rongxzyai.com. Keep this script with the source
 * application mark so future brand changes are deterministic rather than manual.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const projectRoot = path.resolve(__dirname, '..');
const assetDir = path.join(projectRoot, 'build', 'installer-assets');
const logoPath = path.join(projectRoot, 'public', 'zhiyuan-logo-light-1600.png');

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.closePath();
}

function drawDots(context, width, height, opacity = 0.1) {
  context.fillStyle = `rgba(92, 112, 145, ${opacity})`;
  for (let y = 9; y < height; y += 18) {
    for (let x = 9; x < width; x += 18) {
      context.beginPath();
      context.arc(x, y, 0.8, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function drawAppMark(context, logo, x, y, size) {
  const radius = size * (220 / 1024);
  const logoWidth = size * (748 / 1024);
  const logoHeight = logoWidth * (logo.height / logo.width);

  context.save();
  roundedRect(context, x, y, size, size, radius);
  context.clip();

  const background = context.createLinearGradient(x, y, x, y + size);
  background.addColorStop(0, '#ffffff');
  background.addColorStop(1, '#edf5ff');
  context.fillStyle = background;
  context.fillRect(x, y, size, size);

  const glow = context.createRadialGradient(
    x + size * 0.74,
    y + size * 0.78,
    0,
    x + size * 0.74,
    y + size * 0.78,
    size * 0.53,
  );
  glow.addColorStop(0, 'rgba(108, 165, 255, 0.14)');
  glow.addColorStop(1, 'rgba(108, 165, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(x, y, size, size);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    logo,
    x + (size - logoWidth) / 2,
    y + (size - logoHeight) / 2 + size * 0.008,
    logoWidth,
    logoHeight,
  );
  context.restore();

  context.strokeStyle = 'rgba(208, 213, 221, 0.82)';
  context.lineWidth = Math.max(1, size * (12 / 1024));
  roundedRect(context, x, y, size, size, radius);
  context.stroke();
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
}

async function build() {
  const logo = await loadImage(logoPath);

  const sidebar = createCanvas(164, 314);
  const side = sidebar.getContext('2d');
  const background = side.createLinearGradient(0, 0, 0, 314);
  background.addColorStop(0, '#ffffff');
  background.addColorStop(0.56, '#fbfdff');
  background.addColorStop(1, '#edf5ff');
  side.fillStyle = background;
  side.fillRect(0, 0, 164, 314);
  drawDots(side, 164, 314);

  const glow = side.createRadialGradient(120, 42, 0, 120, 42, 88);
  glow.addColorStop(0, 'rgba(83, 147, 255, 0.21)');
  glow.addColorStop(1, 'rgba(83, 147, 255, 0)');
  side.fillStyle = glow;
  side.fillRect(0, 0, 164, 155);

  drawAppMark(side, logo, 14, 14, 58);
  side.fillStyle = '#397bff';
  side.fillRect(14, 71, 44, 2);

  side.strokeStyle = 'rgba(57, 123, 255, 0.3)';
  side.lineWidth = 1;
  for (const [x, y, width, height, radius] of [
    [14, 112, 136, 74, 9],
    [14, 204, 136, 46, 8],
  ]) {
    roundedRect(side, x, y, width, height, radius);
    side.stroke();
  }
  side.fillStyle = 'rgba(57, 123, 255, 0.08)';
  roundedRect(side, 23, 123, 118, 17, 4);
  side.fill();
  roundedRect(side, 23, 148, 76, 8, 4);
  side.fill();
  side.fillStyle = '#397bff';
  roundedRect(side, 107, 148, 34, 8, 4);
  side.fill();
  side.fillStyle = 'rgba(57, 123, 255, 0.12)';
  roundedRect(side, 23, 216, 86, 7, 3.5);
  side.fill();
  roundedRect(side, 23, 231, 112, 7, 3.5);
  side.fill();
  side.strokeStyle = 'rgba(57, 123, 255, 0.42)';
  side.beginPath();
  side.moveTo(14, 276);
  side.bezierCurveTo(45, 250, 85, 304, 150, 269);
  side.stroke();
  side.fillStyle = '#397bff';
  for (const [x, y, radius] of [
    [14, 276, 3],
    [76, 280, 2.5],
    [150, 269, 3],
  ]) {
    side.beginPath();
    side.arc(x, y, radius, 0, Math.PI * 2);
    side.fill();
  }
  writeBmp(sidebar, 'installerSidebar.bmp');
  writeBmp(sidebar, 'uninstallerSidebar.bmp');

  const header = createCanvas(150, 57);
  const head = header.getContext('2d');
  head.fillStyle = '#ffffff';
  head.fillRect(0, 0, 150, 57);
  drawDots(head, 150, 57, 0.08);
  const headerGlow = head.createRadialGradient(132, 10, 0, 132, 10, 62);
  headerGlow.addColorStop(0, 'rgba(83, 147, 255, 0.2)');
  headerGlow.addColorStop(1, 'rgba(83, 147, 255, 0)');
  head.fillStyle = headerGlow;
  head.fillRect(0, 0, 150, 57);
  drawAppMark(head, logo, 13, 12, 30);
  head.fillStyle = '#397bff';
  head.fillRect(13, 48, 124, 1);
  writeBmp(header, 'installerHeader.bmp');
}

build().catch(error => {
  console.error('[NSIS brand assets] failed:', error);
  process.exitCode = 1;
});
