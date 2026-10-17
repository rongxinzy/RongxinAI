import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const iconDirectory = path.resolve(__dirname, '../../assets/mcp-icons');

test('tavily and gitlab icons are small webp assets', () => {
  for (const name of ['tavily.webp', 'gitlab.webp']) {
    const filePath = path.join(iconDirectory, name);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.statSync(filePath).size).toBeLessThan(80_000);
  }
  expect(fs.existsSync(path.join(iconDirectory, 'tavily.png'))).toBe(false);
  expect(fs.existsSync(path.join(iconDirectory, 'gitlab.png'))).toBe(false);
});
