import { afterEach, expect, test } from 'vitest';

import {
  resolveNsisOfflineComponentTargets,
  shouldIncludeLlamaCppBundledComponent,
} from './resolve-nsis-offline-components.cjs';

const previous = process.env.ZHIYUAN_UPDATE_VARIANT;

afterEach(() => {
  if (previous === undefined) delete process.env.ZHIYUAN_UPDATE_VARIANT;
  else process.env.ZHIYUAN_UPDATE_VARIANT = previous;
});

test('lite targets exclude llamacpp-bundled component', () => {
  process.env.ZHIYUAN_UPDATE_VARIANT = 'lite';
  expect(shouldIncludeLlamaCppBundledComponent()).toBe(false);
  expect(resolveNsisOfflineComponentTargets()).toHaveLength(7);
});

test('cpu and cuda targets include llamacpp-bundled component', () => {
  process.env.ZHIYUAN_UPDATE_VARIANT = 'cpu';
  expect(resolveNsisOfflineComponentTargets()).toHaveLength(8);
  process.env.ZHIYUAN_UPDATE_VARIANT = 'cuda';
  expect(resolveNsisOfflineComponentTargets()).toHaveLength(8);
});
