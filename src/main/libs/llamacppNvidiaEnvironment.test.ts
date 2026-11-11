import os from 'os';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_LLAMACPP_SERVICE_CONFIG } from '../../shared/llamacpp';
import { resolveLlamaCppHostServiceDefaults } from './llamacppNvidiaEnvironment';

vi.mock('./nvidiaSmi', () => ({ getNvidiaSmiSnapshot: async () => null }));

afterEach(() => vi.restoreAllMocks());

test('host service defaults use installed memory for both preflight and startup', async () => {
  vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 ** 3);
  const config = await resolveLlamaCppHostServiceDefaults({
    ...DEFAULT_LLAMACPP_SERVICE_CONFIG,
    ctxSize: '',
  });
  expect(config.ctxSize).toBe('32768');
});

test('host service defaults preserve an explicitly configured context', async () => {
  vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 ** 3);
  const config = await resolveLlamaCppHostServiceDefaults({
    ...DEFAULT_LLAMACPP_SERVICE_CONFIG,
    ctxSize: '65536',
  });
  expect(config.ctxSize).toBe('65536');
});
