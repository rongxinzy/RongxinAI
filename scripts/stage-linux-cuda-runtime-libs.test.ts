import { describe, expect, test } from 'vitest';

import {
  NVIDIA_DRIVER_CUDA_LIB,
  parseLddOutput,
  parseLddDependencies,
  resolveLibrarySource,
} from './stage-linux-cuda-runtime-libs.cjs';

describe('stageLinuxCudaRuntimeLibs', () => {
  test('parseLddDependencies extracts soname and resolved path', () => {
    const sample = [
      '\tlibggml-cuda.so.0 => /workspace/build/libggml-cuda.so.0 (0x00007f)',
      '\tlibcudart.so.12 => /usr/local/cuda/lib64/libcudart.so.12 (0x00007f)',
      '\tlibcuda.so.1 => /lib/x86_64-linux-gnu/libcuda.so.1 (0x00007f)',
      '\tlibm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0x00007f)',
    ].join('\n');

    expect(parseLddOutput(sample)).toEqual([
      {
        soname: 'libggml-cuda.so.0',
        resolvedPath: '/workspace/build/libggml-cuda.so.0',
      },
      {
        soname: 'libcudart.so.12',
        resolvedPath: '/usr/local/cuda/lib64/libcudart.so.12',
      },
      {
        soname: 'libcuda.so.1',
        resolvedPath: '/lib/x86_64-linux-gnu/libcuda.so.1',
      },
      {
        soname: 'libm.so.6',
        resolvedPath: '/lib/x86_64-linux-gnu/libm.so.6',
      },
    ]);
  });

  test('parseLddDependencies accepts a server path and uses ldd output', () => {
    if (process.platform !== 'linux') return;
    expect(() => parseLddDependencies('/bin/true')).not.toThrow();
  });

  test('resolveLibrarySource rejects missing libraries outside search dirs', () => {
    expect(() =>
      resolveLibrarySource('/nonexistent/libfoo.so.1', ['/also/missing']),
    ).toThrow('Could not resolve shared library path');
  });

  test('NVIDIA_DRIVER_CUDA_LIB matches driver sonames only', () => {
    expect(NVIDIA_DRIVER_CUDA_LIB.test('libcuda.so.1')).toBe(true);
    expect(NVIDIA_DRIVER_CUDA_LIB.test('libcudart.so.12')).toBe(false);
  });
});
