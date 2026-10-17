import { expect, test } from 'vitest';

import { LlamaCppRuntimeCudaMajor } from './constants';
import {
  LLAMACPP_CUDA13_MIN_DRIVER_MAJOR,
  isLikelyCudaDriverMismatchError,
  parseNvidiaDriverMajor,
  resolvePreferredLlamaCppRuntimeCudaMajor,
} from './cudaRuntime';

test('parseNvidiaDriverMajor reads the leading version segment', () => {
  expect(parseNvidiaDriverMajor('580.65.06')).toBe(580);
  expect(parseNvidiaDriverMajor('550.54.15')).toBe(550);
  expect(parseNvidiaDriverMajor('')).toBeUndefined();
});

test('resolvePreferredLlamaCppRuntimeCudaMajor prefers configured major and driver capability', () => {
  expect(
    resolvePreferredLlamaCppRuntimeCudaMajor({
      configured: LlamaCppRuntimeCudaMajor.Cuda12,
      driverVersion: '590.00.00',
    }),
  ).toBe(LlamaCppRuntimeCudaMajor.Cuda12);
  expect(
    resolvePreferredLlamaCppRuntimeCudaMajor({
      driverVersion: `${LLAMACPP_CUDA13_MIN_DRIVER_MAJOR}.12.00`,
    }),
  ).toBe(LlamaCppRuntimeCudaMajor.Cuda13);
  expect(resolvePreferredLlamaCppRuntimeCudaMajor({ driverVersion: '550.54.15' })).toBe(
    LlamaCppRuntimeCudaMajor.Cuda12,
  );
});

test('isLikelyCudaDriverMismatchError detects common CUDA driver/runtime failures', () => {
  expect(
    isLikelyCudaDriverMismatchError('CUDA driver version is insufficient for CUDA runtime'),
  ).toBe(true);
  expect(isLikelyCudaDriverMismatchError('model file not found')).toBe(false);
});
