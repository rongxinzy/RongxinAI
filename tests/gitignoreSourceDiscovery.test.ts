import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '..');

function isIgnored(relativePath: string): boolean {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', relativePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  expect(result.error).toBeUndefined();
  expect([0, 1]).toContain(result.status);
  return result.status === 0;
}

describe('root runtime output ignore rules', () => {
  test('ignore runtime output without hiding same-named source directories', () => {
    expect(isIgnored('cowork/runtime.json')).toBe(true);
    expect(isIgnored('logs/app.log')).toBe(true);
    expect(isIgnored('src/renderer/components/cowork/CoworkPromptInput.tsx')).toBe(false);
    expect(isIgnored('src/renderer/components/cowork/PromptPlusMenu.tsx')).toBe(false);
  });
});
