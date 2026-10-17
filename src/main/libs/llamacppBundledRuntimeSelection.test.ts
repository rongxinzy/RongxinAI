import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import {
  clearBundledVulkanGpuProbeCache,
  detectUsableBundledVulkanGpu,
  isVulkanBackendStartupFailure,
  resolveBundledEditionRuntime,
} from './llamacppBundledRuntimeSelection';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}));

function writeExecutable(root: string, relativePath: string) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, '#!/bin/sh\necho ok');
  if (process.platform !== 'win32') fs.chmodSync(fullPath, 0o755);
}

describe('llamacppBundledRuntimeSelection', () => {
  const vendorRoot = path.join(process.cwd(), 'vendor', 'llamacpp', 'cpu');
  let previousVariant: string | undefined;

  beforeEach(() => {
    previousVariant = process.env.ZHIYUAN_UPDATE_VARIANT;
    process.env.ZHIYUAN_USE_BUNDLED_LLAMACPP = '1';
    process.env.ZHIYUAN_UPDATE_VARIANT = 'cpu';
    fs.rmSync(vendorRoot, { recursive: true, force: true });
    fs.mkdirSync(vendorRoot, { recursive: true });
    clearBundledVulkanGpuProbeCache();
    execFileMock.mockImplementation((file, args, options, callback) => {
      const cb =
        typeof options === 'function'
          ? options
          : typeof callback === 'function'
            ? callback
            : undefined;
      if (!cb) return;
      if (Array.isArray(args) && args[0] === '--list-devices') {
        cb(null, 'CUDA0: NVIDIA Test GPU\n', '');
        return;
      }
      cb(new Error('unexpected execFile invocation'));
    });
  });

  afterEach(() => {
    execFileMock.mockReset();
    vi.restoreAllMocks();
    if (previousVariant === undefined) delete process.env.ZHIYUAN_UPDATE_VARIANT;
    else process.env.ZHIYUAN_UPDATE_VARIANT = previousVariant;
    delete process.env.ZHIYUAN_USE_BUNDLED_LLAMACPP;
  });

  test('prefers vulkan on win/linux when gpu probe succeeds', async () => {
    const vulkanRel = 'backends/b9244/linux-x64-vulkan/bin/llama-server';
    const cpuRel = 'backends/b9244/linux-x64/bin/llama-server';
    writeExecutable(vendorRoot, vulkanRel);
    writeExecutable(vendorRoot, cpuRel);
    const manifest = {
      schemaVersion: 2,
      backend: { version: 'b9244', backend: 'linux-x64-cpu-vulkan-bundle' },
      executable: vulkanRel,
      vulkanExecutable: vulkanRel,
      cpuFallbackExecutable: cpuRel,
    };
    fs.writeFileSync(path.join(vendorRoot, 'manifest.json'), JSON.stringify(manifest));

    const resolved = await resolveBundledEditionRuntime({ manifest, platform: 'linux' });
    expect(resolved.accelerator).toBe('vulkan');
  });

  test('falls back to cpu when gpu probe fails', async () => {
    const vulkanRel = 'backends/b9244/linux-x64-vulkan/bin/llama-server';
    const cpuRel = 'backends/b9244/linux-x64/bin/llama-server';
    writeExecutable(vendorRoot, vulkanRel);
    writeExecutable(vendorRoot, cpuRel);
    const manifest = {
      schemaVersion: 2,
      backend: { version: 'b9244', backend: 'linux-x64-cpu-vulkan-bundle' },
      executable: vulkanRel,
      vulkanExecutable: vulkanRel,
      cpuFallbackExecutable: cpuRel,
    };
    fs.writeFileSync(path.join(vendorRoot, 'manifest.json'), JSON.stringify(manifest));
    execFileMock.mockImplementation((file, args, options, callback) => {
      const cb =
        typeof options === 'function'
          ? options
          : typeof callback === 'function'
            ? callback
            : undefined;
      if (!cb) return;
      cb(new Error('vulkan probe failed'));
    });

    const resolved = await resolveBundledEditionRuntime({ manifest, platform: 'linux' });
    expect(resolved.accelerator).toBe('cpu');
    expect(resolved.executablePath).toContain('linux-x64/bin');
  });

  test('forceCpuPath selects cpu fallback', async () => {
    const vulkanRel = 'backends/b9244/win-x64-vulkan/bin/llama-server.exe';
    const cpuRel = 'backends/b9244/win-x64/bin/llama-server.exe';
    writeExecutable(vendorRoot, vulkanRel);
    writeExecutable(vendorRoot, cpuRel);
    const manifest = {
      schemaVersion: 2,
      backend: { version: 'b9244', backend: 'win-x64-cpu-vulkan-bundle' },
      executable: vulkanRel,
      vulkanExecutable: vulkanRel,
      cpuFallbackExecutable: cpuRel,
    };

    const resolved = await resolveBundledEditionRuntime({
      manifest,
      forceCpuPath: true,
      platform: 'win32',
    });
    expect(resolved.accelerator).toBe('cpu');
  });

  test('detectUsableBundledVulkanGpu returns false for missing binary', async () => {
    await expect(detectUsableBundledVulkanGpu('/does/not/exist')).resolves.toBe(false);
  });

  test('isVulkanBackendStartupFailure matches vulkan startup errors', () => {
    expect(isVulkanBackendStartupFailure('Vulkan device not available')).toBe(true);
    expect(isVulkanBackendStartupFailure('port in use')).toBe(false);
  });
});
