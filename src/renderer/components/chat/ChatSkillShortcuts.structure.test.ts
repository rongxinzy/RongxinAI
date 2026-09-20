import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./ChatSkillShortcuts.tsx', import.meta.url)),
  'utf8',
);

test('keeps the typed prompt when activating a chat skill shortcut', () => {
  // 2026/09/16 lixiang  先写 prompt 再点 skill 时不应清空输入
  expect(source).toContain("detail: { clear: false }");
  expect(source).not.toContain("detail: { clear: true }");
});
