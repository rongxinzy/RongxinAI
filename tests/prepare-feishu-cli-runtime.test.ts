import path from 'node:path';

import { expect, test } from 'vitest';

import {
  getHostTarget,
  getRuntimeDirectory,
  validateRuntime,
} from '../scripts/prepare-feishu-cli-runtime.cjs';

const projectRoot = path.resolve(__dirname, '..');

test('ships a verified native Feishu CLI for the current package target', () => {
  const target = getHostTarget();

  expect(validateRuntime(projectRoot, target)).toBe(getRuntimeDirectory(projectRoot, target));
});
