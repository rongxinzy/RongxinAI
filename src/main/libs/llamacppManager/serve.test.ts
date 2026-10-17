// Serve/runtime helper tests split from llamacppManager.test.ts (#1069).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { expect, test, vi } from 'vitest';

import { LlamaCppRuntimeBackend, LlamaCppRuntimeCudaMajor } from '../../../shared/llamacpp';
import type { MarketplaceModel } from '../../../shared/marketplace';
import {
  buildLlamaCppExecutableCandidates,
  buildLlamaCppServeEnv,
  buildLlamaServerModelArgs,
  buildLlamaServerArgs,
  chooseModelScopeInstallFile,
  extractModelScopeFilePaths,
  filterLlamaCppServiceConfigByRuntimeCapabilities,
  isPathInside,
  listLlamaCppRuntimeDevices,
  LlamaCppManager,
  mergeLocalModels,
  modelLaunchOptionsToPreset,
  parseLlamaCppHelpFlags,
  parseLlamaCppListDevicesOutput,
  resolveLlamaCppDeviceSelection,
  resolveLlamaCppRuntimeTargetPreference,
  scanLocalGgufModels,
  selectLlamaCppRuntimeTarget,
  shouldEnableLlamaCppModelsAutoload,
} from '../llamacppManager';
import { MarketplaceService } from '../marketplaceService';

test('initializes the configured model library directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-model-library-'));
  const modelsDir = path.join(root, 'models');

  try {
    const manager = new LlamaCppManager(() => ({ modelsDir }));

    expect(manager.initializeModelsDir()).toBe(modelsDir);
    expect(fs.statSync(modelsDir).isDirectory()).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildLlamaCppExecutableCandidates orders managed and explicit runtime paths', () => {
  expect(
    buildLlamaCppExecutableCandidates({
      platform: 'win32',
      isPackaged: true,
      resourceRoot: 'C:/App/resources',
      appRoot: 'C:/App/resources/app.asar',
      cwd: 'C:/work/ZhiYuanAgent',
      userRuntimeRoot: 'C:/Users/tester/AppData/Roaming/ZhiYuanAgent/llamacpp-runtime',
      envPath: 'C:/custom/env/llama-server.exe',
    }).slice(0, 4),
  ).toEqual([
    'C:/custom/env/llama-server.exe',
    'C:/Users/tester/AppData/Roaming/ZhiYuanAgent/llamacpp-runtime/current/build/bin/llama-server.exe',
    'C:/Users/tester/AppData/Roaming/ZhiYuanAgent/llamacpp-runtime/current/bin/llama-server.exe',
    'C:/Users/tester/AppData/Roaming/ZhiYuanAgent/llamacpp-runtime/current/llama-server.exe',
  ]);
});

test('buildLlamaCppExecutableCandidates only includes dev vendor and system paths outside packaged app', () => {
  const candidates = buildLlamaCppExecutableCandidates({
    platform: 'darwin',
    isPackaged: false,
    resourceRoot: '/app/resources',
    appRoot: '/repo',
    cwd: '/repo',
    userRuntimeRoot: '/Users/tester/Library/Application Support/ZhiYuanAgent/llamacpp-runtime',
  });

  expect(candidates).toEqual(
    expect.arrayContaining([
      '/repo/vendor/llamacpp-runtime/current/llama-server',
      '/repo/vendor/llamacpp-runtime/current/build/bin/llama-server',
      '/repo/vendor/llamacpp-runtime/current/bin/llama-server',
      '/opt/homebrew/bin/llama-server',
    ]),
  );
});

test('buildLlamaCppExecutableCandidates omits dev vendor and system paths in packaged app', () => {
  const candidates = buildLlamaCppExecutableCandidates({
    platform: 'darwin',
    isPackaged: true,
    resourceRoot: '/Applications/ZhiYuanAgent.app/Contents/Resources',
    appRoot: '/Applications/ZhiYuanAgent.app/Contents/Resources/app.asar',
    cwd: '/repo',
    userRuntimeRoot: '/Users/tester/Library/Application Support/ZhiYuanAgent/llamacpp-runtime',
  });

  expect(candidates).not.toContain('/repo/vendor/llamacpp-runtime/current/bin/llama-server');
  expect(candidates).not.toContain('/opt/homebrew/bin/llama-server');
});

test('isPathInside matches only paths inside the managed runtime root', () => {
  expect(
    isPathInside(
      '/Users/tester/AppData/ZhiYuanAgent/llamacpp-runtime/current/bin/llama-server',
      '/Users/tester/AppData/ZhiYuanAgent/llamacpp-runtime',
    ),
  ).toBe(true);
  expect(
    isPathInside(
      '/Users/tester/AppData/ZhiYuanAgent/llamacpp-runtime-older/current/bin/llama-server',
      '/Users/tester/AppData/ZhiYuanAgent/llamacpp-runtime',
    ),
  ).toBe(false);
});

test('buildLlamaServerArgs uses the fixed local router defaults and model discovery flags', () => {
  expect(buildLlamaServerArgs({}, '/models/llamacpp', '/presets/models-preset.ini')).toEqual([
    '--host',
    '127.0.0.1',
    '--port',
    '8080',
    '--models-dir',
    '/models/llamacpp',
    '--models-preset',
    '/presets/models-preset.ini',
    '--props',
    '--slots',
    '--no-ui',
    '--no-models-autoload',
  ]);
});

test('buildLlamaServerArgs maps llama.cpp server and router options from service config', () => {
  expect(
    buildLlamaServerArgs(
      {
        host: '127.0.0.2',
        port: '18080',
        modelsMax: '1',
        modelsAutoload: false,
        timeout: '900',
        threadsHttp: '4',
        cachePrompt: false,
        cacheReuse: '256',
        cacheRam: '4096',
        ctxCheckpoints: '16',
        checkpointEveryNt: '4096',
        ctxSize: '8192',
        parallel: '2',
        batchSize: '512',
        ubatchSize: '128',
        gpuLayers: 'all',
        threads: '8',
        threadsBatch: '4',
        flashAttn: 'auto',
        reasoning: 'off',
        reasoningFormat: 'none',
        reasoningBudget: '0',
        jinja: 'on',
        chatTemplate: 'chatml',
        noMmap: true,
        mlock: true,
      },
      '/models/custom',
      '/presets/custom.ini',
    ),
  ).toEqual([
    '--host',
    '127.0.0.2',
    '--port',
    '18080',
    '--models-dir',
    '/models/custom',
    '--models-preset',
    '/presets/custom.ini',
    '--props',
    '--slots',
    '--no-ui',
    '--models-max',
    '1',
    '--no-models-autoload',
    '--timeout',
    '900',
    '--threads-http',
    '4',
    '--cache-reuse',
    '256',
    '--cache-ram',
    '4096',
    '--ctx-checkpoints',
    '16',
    '--checkpoint-every-n-tokens',
    '4096',
    '--no-cache-prompt',
    '--parallel',
    '2',
    '--batch-size',
    '512',
    '--ubatch-size',
    '128',
    '--gpu-layers',
    'all',
    '--threads',
    '8',
    '--threads-batch',
    '4',
    '--flash-attn',
    'auto',
    '--jinja',
    '--reasoning',
    'off',
    '--reasoning-format',
    'none',
    '--reasoning-budget',
    '0',
    '--chat-template',
    'chatml',
    '--no-mmap',
    '--mlock',
  ]);
});

test('buildLlamaServerArgs always disables router model autoload', () => {
  expect(
    buildLlamaServerArgs(
      {
        modelsAutoload: true,
      },
      '/models/custom',
      '/presets/custom.ini',
    ),
  ).toEqual(expect.arrayContaining(['--no-models-autoload']));

  expect(
    buildLlamaServerArgs(
      {
        modelsMax: '2',
        modelsAutoload: true,
      },
      '/models/custom',
      '/presets/custom.ini',
    ),
  ).toEqual(expect.arrayContaining(['--models-max', '2', '--no-models-autoload']));

  expect(
    buildLlamaServerArgs(
      {
        modelsMax: '1',
        modelsAutoload: true,
      },
      '/models/custom',
      '/presets/custom.ini',
    ),
  ).toEqual(expect.arrayContaining(['--models-max', '1', '--no-models-autoload']));
});

test('buildLlamaServerModelArgs starts one loopback model without router flags', () => {
  const args = buildLlamaServerModelArgs({
    config: { ctxSize: '4096', gpuLayers: 'all', modelsMax: '3' },
    modelPath: '/models/qwen.gguf',
    port: 18081,
    options: { ctxSize: 8192 },
  });

  expect(args).toEqual(
    expect.arrayContaining([
      '--host',
      '127.0.0.1',
      '--port',
      '18081',
      '--model',
      '/models/qwen.gguf',
      '--ctx-size',
      '8192',
      '--gpu-layers',
      'all',
    ]),
  );
  expect(args).not.toContain('--models-dir');
  expect(args).not.toContain('--models-preset');
  expect(args).not.toContain('--models-max');
});

test('shouldEnableLlamaCppModelsAutoload only allows single-model residency', () => {
  expect(shouldEnableLlamaCppModelsAutoload(undefined)).toBe(false);
  expect(shouldEnableLlamaCppModelsAutoload('')).toBe(false);
  expect(shouldEnableLlamaCppModelsAutoload('0')).toBe(false);
  expect(shouldEnableLlamaCppModelsAutoload('1')).toBe(true);
  expect(shouldEnableLlamaCppModelsAutoload('2')).toBe(false);
});

test('uses the configured timeout for connection and load operations', () => {
  const manager = new LlamaCppManager(() => ({
    timeout: '900',
  }));

  expect(manager.getConnectionAndLoadTimeoutMs()).toBe(900_000);
});

test('uses the default timeout for connection and load operations when config is empty', () => {
  const manager = new LlamaCppManager(() => ({}));

  expect(manager.getConnectionAndLoadTimeoutMs()).toBe(120_000);
});

test('selectLlamaCppRuntimeTarget chooses fixed CUDA 12 on Windows NVIDIA auto mode', () => {
  expect(
    selectLlamaCppRuntimeTarget({
      platform: 'win32',
      arch: 'x64',
      runtimeBackend: LlamaCppRuntimeBackend.Auto,
      runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
      hasNvidiaGpu: true,
    }),
  ).toEqual({
    ok: true,
    targetId: 'win-x64-cuda-12',
  });
});

test('selectLlamaCppRuntimeTarget falls back to CPU on Windows auto mode without NVIDIA', () => {
  expect(
    selectLlamaCppRuntimeTarget({
      platform: 'win32',
      arch: 'x64',
      runtimeBackend: LlamaCppRuntimeBackend.Auto,
      runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
      hasNvidiaGpu: false,
    }),
  ).toEqual({
    ok: true,
    targetId: 'win-x64',
  });
});

test('selectLlamaCppRuntimeTarget keeps CPU when explicitly requested on Windows', () => {
  expect(
    selectLlamaCppRuntimeTarget({
      platform: 'win32',
      arch: 'x64',
      runtimeBackend: LlamaCppRuntimeBackend.Cpu,
      runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
      hasNvidiaGpu: true,
    }),
  ).toEqual({
    ok: true,
    targetId: 'win-x64',
  });
});

test('selectLlamaCppRuntimeTarget fails when CUDA is forced without NVIDIA', () => {
  expect(
    selectLlamaCppRuntimeTarget({
      platform: 'win32',
      arch: 'x64',
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
      hasNvidiaGpu: false,
    }),
  ).toEqual({
    ok: false,
    error: 'CUDA runtime requires an NVIDIA GPU on Windows.',
  });
});

test('resolveLlamaCppRuntimeTargetPreference defaults to auto CUDA 12 preferences', () => {
  expect(resolveLlamaCppRuntimeTargetPreference({})).toEqual({
    runtimeBackend: LlamaCppRuntimeBackend.Auto,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
  });
});

test('buildLlamaServerArgs keeps advanced GPU routing settings as restart-only server flags', () => {
  expect(
    buildLlamaServerArgs(
      {
        device: '0,1',
        splitMode: 'layer',
        tensorSplit: '3,2',
      },
      '/models/custom',
      '/presets/custom.ini',
    ),
  ).toContain('--device');
  expect(
    buildLlamaServerArgs(
      {
        device: '0,1',
        splitMode: 'layer',
        tensorSplit: '3,2',
      },
      '/models/custom',
      '/presets/custom.ini',
    ),
  ).toEqual(
    expect.arrayContaining(['--device', '0,1', '--split-mode', 'layer', '--tensor-split', '3,2']),
  );
});

test('filterLlamaCppServiceConfigByRuntimeCapabilities drops unsupported and hidden runtime fields', () => {
  expect(
    filterLlamaCppServiceConfigByRuntimeCapabilities(
      {
        device: 'CUDA0',
        splitMode: 'layer',
        tensorSplit: '3,2',
        mainGpu: '0',
        flashAttn: 'auto',
        cachePrompt: false,
        cacheReuse: '256',
        cacheRam: '4096',
      },
      {
        success: true,
        flags: [],
        deviceProbeSucceeded: true,
        devices: [{ id: 'METAL0', name: 'Apple GPU', backend: 'metal' }],
        backendKinds: ['metal'],
        gpuDeviceCount: 1,
        supports: {
          device: true,
          splitMode: false,
          tensorSplit: false,
          mainGpu: false,
          flashAttn: true,
          cachePrompt: true,
          cacheReuse: true,
          cacheRam: true,
        },
      },
    ),
  ).toEqual({
    flashAttn: 'auto',
    cachePrompt: false,
  });
});

test('buildLlamaCppServeEnv prepends the resolved runtime bin directory to PATH on Windows', () => {
  expect(
    buildLlamaCppServeEnv(
      { PATH: 'C:\\Windows\\System32' },
      'C:\\Users\\tester\\AppData\\Roaming\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin\\llama-server.exe',
      'win32',
    ),
  ).toEqual({
    PATH: 'C:\\Users\\tester\\AppData\\Roaming\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
  });
});

test('buildLlamaCppServeEnv does not duplicate PATH entries on Windows', () => {
  expect(
    buildLlamaCppServeEnv(
      {
        PATH: 'C:\\Users\\tester\\AppData\\Roaming\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
      },
      'C:\\Users\\tester\\AppData\\Roaming\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin\\llama-server.exe',
      'win32',
    ),
  ).toEqual({
    PATH: 'C:\\Users\\tester\\AppData\\Roaming\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
  });
});

test('parseLlamaCppListDevicesOutput extracts backend and device names', () => {
  expect(
    parseLlamaCppListDevicesOutput(
      [
        'Available devices:',
        '  CUDA0: NVIDIA GeForce RTX 4090 (24564 MiB, 0 MiB free)',
        '  CUDA1: NVIDIA GeForce RTX 3090',
        '  GPU0: Adreno X1-85 (OpenCL)',
        '  CPU: CPU',
      ].join('\n'),
    ),
  ).toEqual([
    { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
    { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
    { id: 'GPU0', name: 'Adreno X1-85', backend: 'opencl' },
    { id: 'CPU', name: 'CPU', backend: 'cpu' },
  ]);
});

test('parseLlamaCppHelpFlags extracts normalized long flags from help output', () => {
  expect(
    parseLlamaCppHelpFlags(
      [
        'Usage: llama-server [options]',
        '  --models-max N           maximum concurrently loaded models',
        '  --flash-attn {on,off,auto}',
        '  --no-jinja, --jinja      toggle jinja support',
      ].join('\n'),
    ),
  ).toEqual(['--flash-attn', '--jinja', '--models-max', '--no-jinja']);
});

test('resolveLlamaCppDeviceSelection maps numeric indexes to llama.cpp device ids', () => {
  expect(
    resolveLlamaCppDeviceSelection('0,1', [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
      { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
      { id: 'CPU', name: 'CPU', backend: 'cpu' },
    ]),
  ).toBe('CUDA0,CUDA1');
});

test('resolveLlamaCppDeviceSelection preserves explicit llama.cpp device ids', () => {
  expect(
    resolveLlamaCppDeviceSelection('CUDA0,CUDA1', [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
      { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
    ]),
  ).toBe('CUDA0,CUDA1');
});

test('resolveLlamaCppDeviceSelection falls back to the default visible-device behavior when an index cannot be resolved', () => {
  expect(
    resolveLlamaCppDeviceSelection('0,4', [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
      { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
    ]),
  ).toBe('');
});

test('resolveLlamaCppDeviceSelection falls back to the default visible-device behavior for invalid free-form values', () => {
  expect(
    resolveLlamaCppDeviceSelection('bad-input', [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
      { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
    ]),
  ).toBe('');
});

test('listLlamaCppRuntimeDevices executes --list-devices with runtime env', async () => {
  const calls: Array<{ file: string; args: string[]; pathValue?: string }> = [];
  const result = await listLlamaCppRuntimeDevices({
    executablePath: 'C:\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin\\llama-server.exe',
    platform: 'win32',
    baseEnv: { PATH: 'C:\\Windows\\System32' },
    runner: async (file, args, options) => {
      calls.push({ file, args, pathValue: options.env?.PATH });
      return {
        stdout: 'CUDA0: NVIDIA GeForce RTX 4090\n',
        stderr: '',
      };
    },
  });

  expect(calls).toEqual([
    {
      file: 'C:\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin\\llama-server.exe',
      args: ['--list-devices'],
      pathValue: 'C:\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
    },
  ]);
  expect(result).toEqual({
    success: true,
    executablePath: 'C:\\ZhiYuanAgent\\llamacpp-runtime\\current\\bin\\llama-server.exe',
    rawOutput: 'CUDA0: NVIDIA GeForce RTX 4090\n',
    devices: [{ id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' }],
  });
});
