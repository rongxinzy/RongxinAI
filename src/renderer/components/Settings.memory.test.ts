import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./Settings.tsx', import.meta.url)), 'utf8');

test('hides embedding controls until semantic recall is implemented', () => {
  const memorySettingsStart = source.indexOf("case 'coworkMemory':");
  const memorySettingsEnd = source.indexOf("case 'model':", memorySettingsStart);
  const memorySettingsSource = source.slice(memorySettingsStart, memorySettingsEnd);

  expect(memorySettingsStart).toBeGreaterThanOrEqual(0);
  expect(memorySettingsEnd).toBeGreaterThan(memorySettingsStart);
  expect(memorySettingsSource).toContain('<ManagedMemorySettings');
  expect(memorySettingsSource).not.toContain('<EmbeddingSettingsSection');
  expect(source).not.toContain(
    "import EmbeddingSettingsSection from './cowork/EmbeddingSettingsSection'",
  );
});
