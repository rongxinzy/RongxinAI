import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { expect, test, vi } from 'vitest';

import { LlamaCppRuntimeBackend, LlamaCppRuntimeCudaMajor } from '../../shared/llamacpp';
import type { MarketplaceModel } from '../../shared/marketplace';
import {
  buildLlamaCppExecutableCandidates,
  buildLlamaCppServeEnv,
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
} from './llamacppManager';
import { MarketplaceService } from './marketplaceService';

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

test('modelLaunchOptionsToPreset writes model startup parameters for models-preset.ini', () => {
  expect(
    modelLaunchOptionsToPreset({
      ctxSize: 8192,
      gpuLayers: 32,
      threads: 8,
      batchSize: 512,
      ubatchSize: 128,
      mmap: false,
      flashAttn: 'on',
      reasoning: 'auto',
      reasoningFormat: 'deepseek',
      chatTemplate: 'chatml',
    }),
  ).toEqual({
    'ctx-size': 8192,
    'n-gpu-layers': 32,
    threads: 8,
    'batch-size': 512,
    'ubatch-size': 128,
    mmap: false,
    'flash-attn': 'on',
    reasoning: 'auto',
    'reasoning-format': 'deepseek',
    'chat-template': 'chatml',
  });
});

test('mergeLocalModels ignores router aliases and non-GGUF paths in the local file list', () => {
  const scannedModel = {
    name: 'qwen-local',
    id: 'qwen-local',
    model: 'qwen-local',
    path: '/models/qwen-local.gguf',
    size: 4,
    source: 'local' as const,
    status: 'unloaded' as const,
    details: { format: 'gguf' },
  };

  expect(
    mergeLocalModels(
      [
        {
          name: 'default',
          id: 'default',
          model: 'default',
          status: 'unloaded',
          details: { format: 'gguf' },
        },
        {
          name: 'readme',
          id: 'readme',
          model: 'readme',
          path: '/models/README.md',
          status: 'unloaded',
        },
        {
          name: 'external',
          id: 'external',
          model: 'external',
          path: '/external/manual.gguf',
          status: 'unloaded',
        },
        {
          name: 'qwen-local',
          id: 'qwen-local',
          model: 'qwen-local',
          path: '/models/qwen-local.gguf',
          size: 8,
          status: 'loaded',
        },
      ],
      [scannedModel],
    ),
  ).toEqual([
    expect.objectContaining({
      name: 'external',
      path: '/external/manual.gguf',
    }),
    expect.objectContaining({
      name: 'qwen-local',
      path: '/models/qwen-local.gguf',
      size: 8,
      status: 'loaded',
    }),
  ]);
});

test('listLocalModels keeps the current models directory as the source of truth', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-list-local-'));
  const currentModelPath = path.join(modelsDir, 'current-model.gguf');
  fs.writeFileSync(currentModelPath, 'gguf');

  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.client = async () =>
    ({
      listModels: async () => [
        {
          name: 'current-model',
          id: 'current-model',
          model: 'current-model',
          path: currentModelPath,
          size: 8,
          status: 'loaded',
        },
        {
          name: 'stale-model',
          id: 'stale-model',
          model: 'stale-model',
          path: path.join(os.tmpdir(), 'stale-model.gguf'),
          status: 'unloaded',
        },
      ],
    }) as any;

  await expect(manager.listLocalModels()).resolves.toEqual([
    expect.objectContaining({
      name: 'current-model',
      path: currentModelPath,
      size: 8,
      status: 'loaded',
    }),
  ]);
});

test('listRunningModels refreshes GGUF thinking capabilities when the cache is cold', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-running-thinking-'));
  fs.writeFileSync(path.join(modelsDir, 'qwen-local.gguf'), 'gguf');
  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.client = async () =>
    ({
      runningModels: async () => [{ name: 'qwen-local' }],
    }) as any;

  await expect(manager.listRunningModels()).resolves.toEqual([
    expect.objectContaining({
      name: 'qwen-local',
      supportsThinkingToggle: false,
    }),
  ]);
});

test('listRunningModels tolerates a transient router connection failure after startup', async () => {
  const manager = new LlamaCppManager(() => ({}));
  let attempts = 0;
  manager.client = async () =>
    ({
      runningModels: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('fetch failed');
        return [{ name: 'qwen-local' }];
      },
    }) as any;

  await expect(manager.listRunningModels()).resolves.toEqual([
    expect.objectContaining({ name: 'qwen-local' }),
  ]);
  expect(attempts).toBe(2);
});

test('listRunningModels bounds each router readiness request to a short timeout', async () => {
  const manager = new LlamaCppManager(() => ({}));
  const runningModels = vi.fn(async () => []);
  manager.client = async () => ({ runningModels }) as any;

  await manager.listRunningModels();

  expect(runningModels).toHaveBeenCalledWith(2_000);
});

test('extractModelScopeFilePaths reads nested ModelScope repo file payloads', () => {
  expect(
    extractModelScopeFilePaths({
      Data: {
        Files: [
          { Path: 'README.md' },
          { Path: 'qwen3-8b-q4_k_m.gguf' },
          { FilePath: 'subdir/qwen3-8b-q8_0.gguf' },
        ],
      },
    }),
  ).toEqual(['README.md', 'qwen3-8b-q4_k_m.gguf', 'subdir/qwen3-8b-q8_0.gguf']);
});

test('chooseModelScopeInstallFile prefers a normal Q4_K_M GGUF model file', () => {
  expect(
    chooseModelScopeInstallFile([
      'README.md',
      'mmproj-model-f16.gguf',
      'qwen3-8b-q8_0.gguf',
      'qwen3-8b-q4_k_m.gguf',
    ]),
  ).toBe('qwen3-8b-q4_k_m.gguf');
});

test('chooseModelScopeInstallFile rejects repositories without GGUF model files', () => {
  expect(
    chooseModelScopeInstallFile(['config.json', 'model.safetensors', 'tokenizer.json']),
  ).toBeUndefined();
});

test('scanLocalGgufModels finds nested ModelScope downloads', () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-models-'));
  const repoDir = path.join(modelsDir, 'modelscope', 'unsloth', 'Qwen3.5-0.8B-GGUF');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'Qwen3.5-0.8B-Q4_0.gguf'), 'gguf');
  fs.writeFileSync(path.join(repoDir, 'mmproj-F16.gguf'), 'mmproj');

  expect(scanLocalGgufModels(modelsDir)).toEqual([
    expect.objectContaining({
      name: 'Qwen3.5-0.8B-GGUF',
      path: path.join(repoDir, 'Qwen3.5-0.8B-Q4_0.gguf'),
      source: 'modelscope',
      details: expect.objectContaining({ format: 'gguf', quantization_level: 'Q4_0' }),
    }),
  ]);
});

test('scanLocalGgufModels registers split-GGUF models once under their first part', () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-split-'));
  const repoDir = path.join(modelsDir, 'modelscope', 'Qwen', 'QwQ-32B-GGUF');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'qwq-32b-fp16-00001-of-00003.gguf'), 'gguf1');
  fs.writeFileSync(path.join(repoDir, 'qwq-32b-fp16-00002-of-00003.gguf'), 'gguf2');
  fs.writeFileSync(path.join(repoDir, 'qwq-32b-fp16-00003-of-00003.gguf'), 'gguf3');

  const models = scanLocalGgufModels(modelsDir);
  expect(models).toHaveLength(1);
  expect(models[0].name).toBe('QwQ-32B-GGUF');
  expect(path.basename(models[0].path)).toBe('qwq-32b-fp16-00001-of-00003.gguf');
});

test('loadModel reloads the router catalog after writing a new model preset', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-load-'));
  const presetPath = path.join(modelsDir, 'models-preset.ini');
  const ggufPath = path.join(
    modelsDir,
    'modelscope',
    'unsloth',
    'Qwen3.5-0.8B-GGUF',
    'Qwen3.5-0.8B-Q4_0.gguf',
  );
  fs.mkdirSync(path.dirname(ggufPath), { recursive: true });
  fs.writeFileSync(ggufPath, 'gguf');

  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.getPresetPath = () => presetPath;

  const calls: string[] = [];
  manager.client = async () =>
    ({
      listModels: async () => {
        calls.push(fs.existsSync(presetPath) ? 'reload-after-preset' : 'reload-before-preset');
        return [];
      },
      loadModel: async () => {
        calls.push('load');
        return { success: true, runningModels: [] };
      },
    }) as any;

  await manager.loadModel({
    model: 'Qwen3.5-0.8B-GGUF',
    options: { ctxSize: 4096 },
  });

  expect(calls).toEqual(['reload-before-preset', 'reload-after-preset', 'load']);
});

test('loadModel applies the default context size through model presets instead of router startup args', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-load-default-ctx-'));
  const presetPath = path.join(modelsDir, 'models-preset.ini');
  const ggufPath = path.join(modelsDir, 'Qwen3-0.6B', 'Qwen3-0.6B-Q4_K_M.gguf');
  fs.mkdirSync(path.dirname(ggufPath), { recursive: true });
  fs.writeFileSync(ggufPath, 'gguf');

  const manager = new LlamaCppManager(() => ({ modelsDir, ctxSize: '16384' }));
  manager.getPresetPath = () => presetPath;
  manager.client = async () =>
    ({
      listModels: async () => [],
      loadModel: async (input: any) => {
        expect(input.options?.ctxSize).toBe(16384);
        return { success: true, runningModels: [] };
      },
    }) as any;

  await manager.loadModel({
    model: 'Qwen3-0.6B',
  });

  expect(fs.readFileSync(presetPath, 'utf-8')).toContain('ctx-size = 16384');
});

test('deleteModel removes empty parent directories after deleting a GGUF file', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-delete-'));
  const repoDir = path.join(modelsDir, 'modelscope', 'unsloth', 'Qwen3.5-0.8B-GGUF');
  const ggufPath = path.join(repoDir, 'Qwen3.5-0.8B-Q4_0.gguf');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(ggufPath, 'gguf');

  const storage = new Map<string, unknown>([['llamacpp_last_loaded_model', 'Qwen3.5-0.8B-GGUF']]);
  const manager = new LlamaCppManager(() => ({ modelsDir }), undefined, {
    get: <T>(key: string) => storage.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      storage.set(key, value);
    },
    delete: (key: string) => {
      storage.delete(key);
    },
  });
  manager.listLocalModels = async () => [
    {
      name: 'Qwen3.5-0.8B-GGUF',
      id: 'Qwen3.5-0.8B-GGUF',
      model: 'Qwen3.5-0.8B-GGUF',
      path: ggufPath,
      source: 'modelscope',
      status: 'unloaded',
      details: { format: 'gguf' },
    },
  ];
  manager.client = async () =>
    ({
      unloadModel: async () => undefined,
    }) as any;

  const result = await manager.deleteModel('Qwen3.5-0.8B-GGUF');
  expect(result).toEqual(
    expect.objectContaining({
      success: true,
      deleted: true,
      removedModelName: 'Qwen3.5-0.8B-GGUF',
    }),
  );
  expect(fs.existsSync(ggufPath)).toBe(false);
  expect(fs.existsSync(repoDir)).toBe(false);
  expect(storage.has('llamacpp_last_loaded_model')).toBe(false);
});

test('clearLastLoadedModel prevents a service restart from restoring the old model', () => {
  const storage = new Map<string, unknown>([['llamacpp_last_loaded_model', 'old-model']]);
  const manager = new LlamaCppManager(() => ({}), undefined, {
    get: <T>(key: string) => storage.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      storage.set(key, value);
    },
    delete: (key: string) => {
      storage.delete(key);
    },
  });

  manager.clearPersistedLastLoadedModel();

  expect(storage.has('llamacpp_last_loaded_model')).toBe(false);
});

function verifiedMarketplaceModel(input: {
  repoId?: string;
  filePath?: string;
  downloadUrl?: string;
  sha256: string;
  mmproj?: { path: string; downloadUrl: string; sha256: string };
}): MarketplaceModel {
  const repoId = input.repoId ?? 'Qwen/Qwen3-8B-GGUF';
  const filePath = input.filePath ?? 'Qwen3-8B-Q4_K_M.gguf';
  const files = [
    {
      path: filePath,
      sizeBytes: 8,
      sha256: input.sha256,
      isRecommended: true,
      kind: 'model' as const,
      revision: 'commit-sha',
      downloadUrl: input.downloadUrl ?? 'https://download.test/model.gguf',
    },
    ...(input.mmproj
      ? [
          {
            path: input.mmproj.path,
            sizeBytes: 8,
            sha256: input.mmproj.sha256,
            kind: 'mmproj' as const,
            revision: 'commit-sha',
            downloadUrl: input.mmproj.downloadUrl,
          },
        ]
      : []),
  ];
  return {
    source: 'modelscope-gguf',
    id: repoId,
    repoId,
    name: repoId,
    description: 'verified cloud metadata',
    tags: ['chat', 'gguf'],
    sizes: ['desktop'],
    recommendedTag: 'Q4_K_M',
    capability: 'chat',
    capabilities: ['chat'],
    filePath,
    installed: false,
    files,
    mmprojFilePath: input.mmproj?.path,
    metadataStatus: 'verified',
    runtime: {
      format: 'gguf',
      status: 'candidate',
      ggufFilesVerified: true,
      sha256Verified: true,
      source: 'modelscope-file-api',
      observedAt: '2026-08-01T00:00:00.000Z',
      revision: 'commit-sha',
      reasons: ['端侧加载探针待执行。'],
    },
  };
}

test('installModel rejects a repository without cloud-verified GGUF metadata', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-unverified-'));
  const marketplaceService = {
    resolveModel: async () => null,
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    manager.installModel({ modelId: 'owner/unverified-GGUF' }),
  ).rejects.toThrow('cloud catalogue has not verified');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('installModel downloads and verifies the exact GGUF selected by the cloud catalogue', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-verified-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () => verifiedMarketplaceModel({ sha256 }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    expect(String(input)).toBe('https://download.test/model.gguf');
    return new Response(bytes, { status: 200, headers: { 'content-length': '8' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' });

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(result.path).toContain(path.join('Qwen', 'Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf'));
  expect(fs.readFileSync(result.path)).toEqual(Buffer.from(bytes));
});

test('installModel rejects checksum-valid bytes that are not a GGUF container', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-invalid-gguf-'));
  const bytes = new Uint8Array([0x4e, 0x4f, 0x54, 0x47, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () => verifiedMarketplaceModel({ sha256 }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(bytes, { status: 200, headers: { 'content-length': '8' } })),
  );

  await expect(manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' })).rejects.toThrow(
    'invalid GGUF magic bytes',
  );
  expect(
    fs.existsSync(
      path.join(
        modelsDir,
        'modelscope',
        'Qwen',
        'Qwen3-8B-GGUF',
        'Qwen3-8B-Q4_K_M.gguf.download',
      ),
    ),
  ).toBe(false);
});

test('installModel keeps an interrupted partial file for a later Range resume', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-resume-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () =>
      verifiedMarketplaceModel({
        sha256,
        mmproj: {
          path: 'mmproj-F16.gguf',
          downloadUrl: 'https://download.test/mmproj.gguf',
          sha256,
        },
      }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith('/model.gguf')) {
      return new Response(bytes, { status: 200, headers: { 'content-length': '8' } });
    }
    return new Response(
      new ReadableStream({
        start(streamController) {
          streamController.enqueue(new Uint8Array([4]));
          streamController.close();
        },
      }),
      { status: 200, headers: { 'content-length': '3' } },
    );
  }));

  const install = manager.installModel(
    { modelId: 'Qwen/Qwen3-8B-GGUF' },
    progress => {
      if (progress.targetPath?.endsWith('mmproj-F16.gguf') && progress.completed === 1) {
        controller.abort(new Error('Install cancelled'));
      }
    },
    { signal: controller.signal },
  );

  await expect(install).rejects.toThrow();
  const repoDir = path.join(modelsDir, 'modelscope', 'Qwen', 'Qwen3-8B-GGUF');
  expect(fs.existsSync(path.join(repoDir, 'Qwen3-8B-Q4_K_M.gguf'))).toBe(false);
  expect(fs.existsSync(path.join(repoDir, 'mmproj-F16.gguf.download'))).toBe(true);
});

test('installModel refreshes cloud metadata once after a stale download URL returns 404', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-refresh-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let resolveCount = 0;
  const marketplaceService = {
    resolveModel: async () => {
      resolveCount += 1;
      return verifiedMarketplaceModel({
        filePath: resolveCount === 1 ? 'stale.gguf' : 'fresh.gguf',
        downloadUrl:
          resolveCount === 1
            ? 'https://download.test/stale.gguf'
            : 'https://download.test/fresh.gguf',
        sha256,
      });
    },
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  const fetchMock = vi.fn(async (input: string | URL | Request) =>
    String(input).endsWith('/stale.gguf')
      ? new Response('not found', { status: 404 })
      : new Response(bytes, { status: 200, headers: { 'content-length': '8' } }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const result = await manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' });

  expect(resolveCount).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.path).toContain('fresh.gguf');
});
