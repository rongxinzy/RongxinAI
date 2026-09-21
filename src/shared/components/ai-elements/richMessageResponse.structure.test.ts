import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./richMessageResponse.tsx', import.meta.url)),
  'utf8',
);

test('merges caller components with AiPre instead of overwriting', () => {
  // 2026/09/20 lixiang  components.a 覆盖整个 components 会丢掉 pre:AiPre，代码块按钮掉栏
  expect(source).toContain('components={{ pre: AiPre, ...components }}');
  expect(source).not.toMatch(/components=\{\{\s*pre:\s*AiPre\s*\}\}/);
});
