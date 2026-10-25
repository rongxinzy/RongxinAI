import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { expect, test } from 'vitest';
import { verifyMotionMask } from './verify-motion-mask.mjs';

test('independent PNG decoding rejects blank, clipped, fractional and misrecorded hit masks', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-motion-mask-'));
  const file = path.join(directory, 'mask.png');
  const canvas = createCanvas(512, 512),
    context = canvas.getContext('2d');
  const save = () => fs.writeFile(file, canvas.toBuffer('image/png'));
  try {
    await save();
    await expect(verifyMotionMask(file, 512)).rejects.toThrow('blank or touches');
    context.fillStyle = 'white';
    context.fillRect(100, 100, 200, 200);
    await save();
    expect(await verifyMotionMask(file, 512, [100, 100, 299, 299])).toEqual([100, 100, 299, 299]);
    await expect(verifyMotionMask(file, 512, [100, 100, 300, 300])).rejects.toThrow(
      'authored record',
    );
    await expect(verifyMotionMask(file, 256)).rejects.toThrow('dimensions');
    context.fillRect(0, 0, 10, 10);
    await save();
    await expect(verifyMotionMask(file, 512)).rejects.toThrow('touches the canvas edge');
    context.clearRect(0, 0, 512, 512);
    context.fillStyle = 'rgba(255,255,255,0.5)';
    context.fillRect(100, 100, 200, 200);
    await save();
    await expect(verifyMotionMask(file, 512)).rejects.toThrow('binary union');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
