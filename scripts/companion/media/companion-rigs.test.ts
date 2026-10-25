import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test } from 'vitest';
import { COMPANION_RIGS, companionRigFrames } from './companion-rigs.mjs';

test('whole-part bounds exclude a neighboring foot that crosses the nominal grid edge', async () => {
  const canvas = createCanvas(256, 256);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  for (let index = 0; index < 14; index++) {
    const x = (index % 4) * 64,
      y = Math.floor(index / 4) * 64;
    if (index >= 8 && index <= 11) {
      context.fillRect(x + 16, y + 20, 8, 8);
      context.fillRect(x + 40, y + 20, 8, 8);
      context.fillRect(x + 26, y + 40, 12, 6);
    } else if (index === 4) context.fillRect(x + 20, y + 20, 24, 52);
    else context.fillRect(x + 16, y + 16, 32, 32);
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-rig-test-'));
  const file = path.join(directory, 'parts.png');
  try {
    await fs.writeFile(file, canvas.toBuffer('image/png'));
    const frames = await companionRigFrames(file, COMPANION_RIGS.youli);
    expect(frames.leftFoot).toEqual([20, 84, 24, 52]);
    expect(frames.face).toEqual([16, 148, 32, 26]);
    expect(frames.blink).toEqual([80, 148, 32, 26]);
    expect(frames.leftWing).toBeUndefined();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('all six original source atlases have complete joints and aligned expression crops', async () => {
  const root = fileURLToPath(
    new URL('../../../src/renderer/assets/desktop-pet/rigs/', import.meta.url),
  );
  for (const rig of Object.values(COMPANION_RIGS)) {
    const file = path.join(root, `${rig.id}-rig-v1.png`);
    const image = await loadImage(file);
    const frames = await companionRigFrames(file, rig);
    expect(Object.keys(frames), rig.id).toHaveLength(rig.wings ? 16 : 14);
    for (const rectangle of Object.values(frames)) {
      const [x, y, width, height] = rectangle;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x + width).toBeLessThanOrEqual(image.width);
      expect(y + height).toBeLessThanOrEqual(image.height);
    }
    for (const expression of [frames.blink, frames.happy, frames.worried])
      expect(expression.slice(1), rig.id).toEqual(frames.face.slice(1));
  }
});
