import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

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
} from './llamacppManager';
import { MarketplaceService } from './marketplaceService';

test('buildLlamaCppExecutableCandidates orders managed and explicit runtime paths', () => {
  expect(buildLlamaCppExecutableCandidates({
    platform: 'win32',
    isPackaged: true,
    resourceRoot: 'C:/App/resources',
    appRoot: 'C:/App/resources/app.asar',
    cwd: 'C:/work/RongxinAI',
    userRuntimeRoot: 'C:/Users/tester/AppData/Roaming/RongxinAI/llamacpp-runtime',
    envPath: 'C:/custom/env/llama-server.exe',
    configuredExecutablePath: 'C:/custom/ui/llama-server.exe',
  }).slice(0, 5)).toEqual([
    'C:/custom/env/llama-server.exe',
    'C:/custom/ui/llama-server.exe',
    'C:/Users/tester/AppData/Roaming/RongxinAI/llamacpp-runtime/current/bin/llama-server.exe',
    'C:/App/resources/llamacpp/llama-server.exe',
    'C:/App/resources/llamacpp/bin/llama-server.exe',
  ]);
});

test('buildLlamaCppExecutableCandidates only includes dev vendor and system paths outside packaged app', () => {
  const candidates = buildLlamaCppExecutableCandidates({
    platform: 'darwin',
    isPackaged: false,
    resourceRoot: '/app/resources',
    appRoot: '/repo',
    cwd: '/repo',
    userRuntimeRoot: '/Users/tester/Library/Application Support/RongxinAI/llamacpp-runtime',
  });

  expect(candidates).toEqual(expect.arrayContaining([
    '/repo/vendor/llamacpp-runtime/current/llama-server',
    '/repo/vendor/llamacpp-runtime/current/bin/llama-server',
    '/opt/homebrew/bin/llama-server',
  ]));
});

test('buildLlamaCppExecutableCandidates omits dev vendor and system paths in packaged app', () => {
  const candidates = buildLlamaCppExecutableCandidates({
    platform: 'darwin',
    isPackaged: true,
    resourceRoot: '/Applications/RongxinAI.app/Contents/Resources',
    appRoot: '/Applications/RongxinAI.app/Contents/Resources/app.asar',
    cwd: '/repo',
    userRuntimeRoot: '/Users/tester/Library/Application Support/RongxinAI/llamacpp-runtime',
  });

  expect(candidates).not.toContain('/repo/vendor/llamacpp-runtime/current/bin/llama-server');
  expect(candidates).not.toContain('/opt/homebrew/bin/llama-server');
});

test('isPathInside matches only paths inside the managed runtime root', () => {
  expect(isPathInside(
    '/Users/tester/AppData/RongxinAI/llamacpp-runtime/current/bin/llama-server',
    '/Users/tester/AppData/RongxinAI/llamacpp-runtime',
  )).toBe(true);
  expect(isPathInside(
    '/Users/tester/AppData/RongxinAI/llamacpp-runtime-older/current/bin/llama-server',
    '/Users/tester/AppData/RongxinAI/llamacpp-runtime',
  )).toBe(false);
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
  ]);
});

test('buildLlamaServerArgs maps llama.cpp server and router options from service config', () => {
  expect(buildLlamaServerArgs({
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
  }, '/models/custom', '/presets/custom.ini')).toEqual([
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
    '--ctx-size',
    '8192',
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

test('uses the configured timeout for connection and load operations', () => {
  const manager = new LlamaCppManager(() => ({
    timeout: '900',
  }));

  expect(manager.getConnectionAndLoadTimeoutMs()).toBe(900_000);
});

test('selectLlamaCppRuntimeTarget chooses fixed CUDA 12 on Windows NVIDIA auto mode', () => {
  expect(selectLlamaCppRuntimeTarget({
    platform: 'win32',
    arch: 'x64',
    runtimeBackend: LlamaCppRuntimeBackend.Auto,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    hasNvidiaGpu: true,
  })).toEqual({
    ok: true,
    targetId: 'win-x64-cuda-12',
  });
});

test('selectLlamaCppRuntimeTarget falls back to CPU on Windows auto mode without NVIDIA', () => {
  expect(selectLlamaCppRuntimeTarget({
    platform: 'win32',
    arch: 'x64',
    runtimeBackend: LlamaCppRuntimeBackend.Auto,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    hasNvidiaGpu: false,
  })).toEqual({
    ok: true,
    targetId: 'win-x64',
  });
});

test('selectLlamaCppRuntimeTarget keeps CPU when explicitly requested on Windows', () => {
  expect(selectLlamaCppRuntimeTarget({
    platform: 'win32',
    arch: 'x64',
    runtimeBackend: LlamaCppRuntimeBackend.Cpu,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    hasNvidiaGpu: true,
  })).toEqual({
    ok: true,
    targetId: 'win-x64',
  });
});

test('selectLlamaCppRuntimeTarget fails when CUDA is forced without NVIDIA', () => {
  expect(selectLlamaCppRuntimeTarget({
    platform: 'win32',
    arch: 'x64',
    runtimeBackend: LlamaCppRuntimeBackend.Cuda,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    hasNvidiaGpu: false,
  })).toEqual({
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
  expect(buildLlamaServerArgs({
    device: '0,1',
    splitMode: 'layer',
    tensorSplit: '3,2',
  }, '/models/custom', '/presets/custom.ini')).toContain('--device');
  expect(buildLlamaServerArgs({
    device: '0,1',
    splitMode: 'layer',
    tensorSplit: '3,2',
  }, '/models/custom', '/presets/custom.ini')).toEqual(expect.arrayContaining([
    '--device',
    '0,1',
    '--split-mode',
    'layer',
    '--tensor-split',
    '3,2',
  ]));
});

test('filterLlamaCppServiceConfigByRuntimeCapabilities drops unsupported and hidden runtime fields', () => {
  expect(filterLlamaCppServiceConfigByRuntimeCapabilities(
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
  )).toEqual({
    flashAttn: 'auto',
    cachePrompt: false,
  });
});

test('buildLlamaCppServeEnv prepends the resolved runtime bin directory to PATH on Windows', () => {
  expect(buildLlamaCppServeEnv(
    { PATH: 'C:\\Windows\\System32' },
    'C:\\Users\\tester\\AppData\\Roaming\\RongxinAI\\llamacpp-runtime\\current\\bin\\llama-server.exe',
    'win32',
  )).toEqual({
    PATH: 'C:\\Users\\tester\\AppData\\Roaming\\RongxinAI\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
  });
});

test('buildLlamaCppServeEnv does not duplicate PATH entries on Windows', () => {
  expect(buildLlamaCppServeEnv(
    {
      PATH: 'C:\\Users\\tester\\AppData\\Roaming\\RongxinAI\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
    },
    'C:\\Users\\tester\\AppData\\Roaming\\RongxinAI\\llamacpp-runtime\\current\\bin\\llama-server.exe',
    'win32',
  )).toEqual({
    PATH: 'C:\\Users\\tester\\AppData\\Roaming\\RongxinAI\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
  });
});

test('parseLlamaCppListDevicesOutput extracts backend and device names', () => {
  expect(parseLlamaCppListDevicesOutput([
    'Available devices:',
    '  CUDA0: NVIDIA GeForce RTX 4090 (24564 MiB, 0 MiB free)',
    '  CUDA1: NVIDIA GeForce RTX 3090',
    '  CPU: CPU',
  ].join('\n'))).toEqual([
    { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
    { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
    { id: 'CPU', name: 'CPU', backend: 'cpu' },
  ]);
});

test('parseLlamaCppHelpFlags extracts normalized long flags from help output', () => {
  expect(parseLlamaCppHelpFlags([
    'Usage: llama-server [options]',
    '  --models-max N           maximum concurrently loaded models',
    '  --flash-attn {on,off,auto}',
    '  --no-jinja, --jinja      toggle jinja support',
  ].join('\n'))).toEqual([
    '--flash-attn',
    '--jinja',
    '--models-max',
    '--no-jinja',
  ]);
});

test('resolveLlamaCppDeviceSelection maps numeric indexes to llama.cpp device ids', () => {
  expect(resolveLlamaCppDeviceSelection('0,1', [
    { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
    { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
    { id: 'CPU', name: 'CPU', backend: 'cpu' },
  ])).toBe('CUDA0,CUDA1');
});

test('resolveLlamaCppDeviceSelection preserves explicit llama.cpp device ids', () => {
  expect(resolveLlamaCppDeviceSelection('CUDA0,CUDA1', [
    { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
    { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
  ])).toBe('CUDA0,CUDA1');
});

test('resolveLlamaCppDeviceSelection falls back to the default visible-device behavior when an index cannot be resolved', () => {
  expect(resolveLlamaCppDeviceSelection('0,4', [
    { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
    { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
  ])).toBe('');
});

test('resolveLlamaCppDeviceSelection falls back to the default visible-device behavior for invalid free-form values', () => {
  expect(resolveLlamaCppDeviceSelection('bad-input', [
    { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' },
    { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3090', backend: 'cuda' },
  ])).toBe('');
});

test('listLlamaCppRuntimeDevices executes --list-devices with runtime env', async () => {
  const calls: Array<{ file: string; args: string[]; pathValue?: string }> = [];
  const result = await listLlamaCppRuntimeDevices({
    executablePath: 'C:\\RongxinAI\\llamacpp-runtime\\current\\bin\\llama-server.exe',
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

  expect(calls).toEqual([{
    file: 'C:\\RongxinAI\\llamacpp-runtime\\current\\bin\\llama-server.exe',
    args: ['--list-devices'],
    pathValue: 'C:\\RongxinAI\\llamacpp-runtime\\current\\bin;C:\\Windows\\System32',
  }]);
  expect(result).toEqual({
    success: true,
    executablePath: 'C:\\RongxinAI\\llamacpp-runtime\\current\\bin\\llama-server.exe',
    rawOutput: 'CUDA0: NVIDIA GeForce RTX 4090\n',
    devices: [{ id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', backend: 'cuda' }],
  });
});

test('modelLaunchOptionsToPreset writes model startup parameters for models-preset.ini', () => {
  expect(modelLaunchOptionsToPreset({
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
  })).toEqual({
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

  expect(mergeLocalModels([
    { name: 'default', id: 'default', model: 'default', status: 'unloaded', details: { format: 'gguf' } },
    { name: 'readme', id: 'readme', model: 'readme', path: '/models/README.md', status: 'unloaded' },
    { name: 'external', id: 'external', model: 'external', path: '/external/manual.gguf', status: 'unloaded' },
    { name: 'qwen-local', id: 'qwen-local', model: 'qwen-local', path: '/models/qwen-local.gguf', size: 8, status: 'loaded' },
  ], [scannedModel])).toEqual([
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

test('extractModelScopeFilePaths reads nested ModelScope repo file payloads', () => {
  expect(extractModelScopeFilePaths({
    Data: {
      Files: [
        { Path: 'README.md' },
        { Path: 'qwen3-8b-q4_k_m.gguf' },
        { FilePath: 'subdir/qwen3-8b-q8_0.gguf' },
      ],
    },
  })).toEqual([
    'README.md',
    'qwen3-8b-q4_k_m.gguf',
    'subdir/qwen3-8b-q8_0.gguf',
  ]);
});

test('chooseModelScopeInstallFile prefers a normal Q4_K_M GGUF model file', () => {
  expect(chooseModelScopeInstallFile([
    'README.md',
    'mmproj-model-f16.gguf',
    'qwen3-8b-q8_0.gguf',
    'qwen3-8b-q4_k_m.gguf',
  ])).toBe('qwen3-8b-q4_k_m.gguf');
});

test('chooseModelScopeInstallFile rejects repositories without GGUF model files', () => {
  expect(chooseModelScopeInstallFile([
    'config.json',
    'model.safetensors',
    'tokenizer.json',
  ])).toBeUndefined();
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

test('loadModel reloads the router catalog after writing a new model preset', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-load-'));
  const presetPath = path.join(modelsDir, 'models-preset.ini');
  const ggufPath = path.join(modelsDir, 'modelscope', 'unsloth', 'Qwen3.5-0.8B-GGUF', 'Qwen3.5-0.8B-Q4_0.gguf');
  fs.mkdirSync(path.dirname(ggufPath), { recursive: true });
  fs.writeFileSync(ggufPath, 'gguf');

  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.getPresetPath = () => presetPath;

  const calls: string[] = [];
  manager.client = async () => ({
    listModels: async () => {
      calls.push(fs.existsSync(presetPath) ? 'reload-after-preset' : 'reload-before-preset');
      return [];
    },
    loadModel: async () => {
      calls.push('load');
      return { success: true, runningModels: [] };
    },
  } as any);

  await manager.loadModel({
    model: 'Qwen3.5-0.8B-GGUF',
    options: { ctxSize: 4096 },
  });

  expect(calls).toEqual([
    'reload-before-preset',
    'reload-after-preset',
    'load',
  ]);
});

test('deleteModel removes empty parent directories after deleting a GGUF file', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-delete-'));
  const repoDir = path.join(modelsDir, 'modelscope', 'unsloth', 'Qwen3.5-0.8B-GGUF');
  const ggufPath = path.join(repoDir, 'Qwen3.5-0.8B-Q4_0.gguf');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(ggufPath, 'gguf');

  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.listLocalModels = async () => [{
    name: 'Qwen3.5-0.8B-GGUF',
    id: 'Qwen3.5-0.8B-GGUF',
    model: 'Qwen3.5-0.8B-GGUF',
    path: ggufPath,
    source: 'modelscope',
    status: 'unloaded',
    details: { format: 'gguf' },
  }];
  manager.client = async () => ({
    unloadModel: async () => undefined,
  } as any);

  const result = await manager.deleteModel('Qwen3.5-0.8B-GGUF');
  expect(result).toEqual(expect.objectContaining({
    success: true,
    deleted: true,
    removedModelName: 'Qwen3.5-0.8B-GGUF',
  }));
  expect(fs.existsSync(ggufPath)).toBe(false);
  expect(fs.existsSync(repoDir)).toBe(false);
});

test('installModel cleans already-downloaded files when a later stage is cancelled', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-install-cancel-'));
  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.refreshModelsAfterInstall = async () => undefined as any;

  const originalFetch = global.fetch;
  try {
    global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/repo/files?')) {
        return new Response(JSON.stringify({
          Data: {
            Files: [
              { Path: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf' },
              { Path: 'mmproj-F16.gguf' },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/resolve/master/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      }
      const controllerSignal = init?.signal;
      await new Promise((_, reject) => {
        controllerSignal?.addEventListener('abort', () => reject(new Error('Install cancelled')), { once: true });
      });
      throw new Error('Install cancelled');
    };

    const controller = new AbortController();
    const installPromise = manager.installModel({
      modelId: 'unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
      filePath: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
      mmprojFilePath: 'mmproj-F16.gguf',
      displayName: 'unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    }, undefined, { signal: controller.signal });

    controller.abort(new Error('Install cancelled'));

    await expect(installPromise).rejects.toThrow();

    const repoDir = path.join(modelsDir, 'modelscope', 'unsloth', 'DeepSeek-R1-Distill-Qwen-1.5B-GGUF');
    expect(fs.existsSync(path.join(repoDir, 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf'))).toBe(false);
    expect(fs.existsSync(path.join(repoDir, 'mmproj-F16.gguf'))).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('installModel retries once with refreshed marketplace metadata after HTTP 404', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-install-retry-'));
  const marketplaceService = {
    resolveModel: async (): Promise<MarketplaceModel> => ({
      source: 'modelscope-gguf',
      id: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      repoId: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      name: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      description: 'updated metadata',
      tags: ['chat'],
      sizes: ['7B'],
      recommendedTag: 'Q4_K_M',
      capability: 'chat',
      filePath: 'updated.gguf',
      installed: false,
    }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;

  let fetchCount = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = async (input: string | URL | Request) => {
      fetchCount += 1;
      const url = String(input);
      if (url.includes('/repo/files?')) {
        return new Response('repo files unavailable', { status: 503 });
      }
      if (fetchCount === 2) {
        expect(url).toContain('/resolve/master/original.gguf');
        return new Response('not found', { status: 404 });
      }
      expect(url).toContain('/resolve/master/updated.gguf');
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' },
      });
    };

    const result = await manager.installModel({
      modelId: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      filePath: 'original.gguf',
      displayName: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
    });

    expect(fetchCount).toBe(5);
    expect(result.path).toContain(path.join('Qwen', 'Qwen2.5-7B-Instruct-GGUF', 'updated.gguf'));
    expect(fs.existsSync(result.path)).toBe(true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('installModel retries with repo file listing after HTTP 404 and refreshes mmproj path', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-install-retry-repo-files-'));
  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.refreshModelsAfterInstall = async () => undefined as any;

  let fetchCount = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = async (input: string | URL | Request) => {
      fetchCount += 1;
      const url = String(input);
      if (fetchCount === 1) {
        expect(url).toContain('/repo/files?');
        return new Response(JSON.stringify({
          Data: {
            Files: [
              { Path: 'original.gguf' },
              { Path: 'old-mmproj.gguf' },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (fetchCount === 2) {
        expect(url).toContain('/resolve/master/original.gguf');
        return new Response('not found', { status: 404 });
      }
      if (url.includes('/repo/files?')) {
        return new Response(JSON.stringify({
          Data: {
            Files: [
              { Path: 'updated.gguf' },
              { Path: 'mmproj-F16.gguf' },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/resolve/master/updated.gguf')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      }
      if (url.includes('/resolve/master/mmproj-F16.gguf')) {
        return new Response(new Uint8Array([4, 5, 6]), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await manager.installModel({
      modelId: 'Qwen/Qwen2.5-VL-7B-Instruct-GGUF',
      filePath: 'original.gguf',
      mmprojFilePath: 'old-mmproj.gguf',
      displayName: 'Qwen/Qwen2.5-VL-7B-Instruct-GGUF',
    });

    expect(fetchCount).toBe(6);
    expect(result.path).toContain(path.join('Qwen', 'Qwen2.5-VL-7B-Instruct-GGUF', 'updated.gguf'));
    expect(fs.existsSync(result.path)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(result.path), 'mmproj-F16.gguf'))).toBe(true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('installModel retries when only the mmproj file path changes after HTTP 404', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-install-retry-mmproj-only-'));
  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.refreshModelsAfterInstall = async () => undefined as any;

  let fetchCount = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = async (input: string | URL | Request) => {
      fetchCount += 1;
      const url = String(input);
      if (fetchCount === 1) {
        expect(url).toContain('/repo/files?');
        return new Response(JSON.stringify({
          Data: {
            Files: [
              { Path: 'updated.gguf' },
              { Path: 'old-mmproj.gguf' },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/resolve/master/updated.gguf')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      }
      if (url.includes('/resolve/master/old-mmproj.gguf')) {
        return new Response('not found', { status: 404 });
      }
      if (url.includes('/repo/files?')) {
        return new Response(JSON.stringify({
          Data: {
            Files: [
              { Path: 'updated.gguf' },
              { Path: 'mmproj-F16.gguf' },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/resolve/master/mmproj-F16.gguf')) {
        return new Response(new Uint8Array([4, 5, 6]), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await manager.installModel({
      modelId: 'Qwen/Qwen2.5-VL-7B-Instruct-GGUF',
      filePath: 'updated.gguf',
      mmprojFilePath: 'old-mmproj.gguf',
      displayName: 'Qwen/Qwen2.5-VL-7B-Instruct-GGUF',
    });

    expect(fetchCount).toBe(7);
    expect(result.path).toContain(path.join('Qwen', 'Qwen2.5-VL-7B-Instruct-GGUF', 'updated.gguf'));
    expect(fs.existsSync(path.join(path.dirname(result.path), 'mmproj-F16.gguf'))).toBe(true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('installModel retries when curated file casing is stale for Qwen3-8B-GGUF', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-install-retry-qwen3-'));
  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.refreshModelsAfterInstall = async () => undefined as any;

  let fetchCount = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = async (input: string | URL | Request) => {
      fetchCount += 1;
      const url = String(input);
      if (url.includes('/repo/files?')) {
        return new Response(JSON.stringify({
          Data: {
            Files: [
              { Path: 'Qwen3-8B-Q4_K_M.gguf' },
              { Path: 'Qwen3-8B-Q5_0.gguf' },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/resolve/master/Qwen3-8B-Q4_K_M.gguf')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await manager.installModel({
      modelId: 'Qwen/Qwen3-8B-GGUF',
      filePath: 'qwen3-8b-q4_k_m.gguf',
      displayName: 'Qwen/Qwen3-8B-GGUF',
    });

    expect(fetchCount).toBe(2);
    expect(result.path).toContain(path.join('Qwen', 'Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf'));
    expect(fs.existsSync(result.path)).toBe(true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('installModel uses marketplace metadata when repo files are unavailable before the first download', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-install-marketplace-prefill-'));
  const marketplaceService = {
    resolveModel: async (): Promise<MarketplaceModel> => ({
      source: 'modelscope-gguf',
      id: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      repoId: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      name: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      description: 'prefilled metadata',
      tags: ['chat'],
      sizes: ['7B'],
      recommendedTag: 'Q4_K_M',
      capability: 'chat',
      filePath: 'updated.gguf',
      installed: false,
    }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;

  let fetchCount = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = async (input: string | URL | Request) => {
      fetchCount += 1;
      const url = String(input);
      if (url.includes('/repo/files?')) {
        return new Response('repo files unavailable', { status: 503 });
      }
      if (url.includes('/resolve/master/updated.gguf')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await manager.installModel({
      modelId: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      displayName: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
    });

    expect(fetchCount).toBe(2);
    expect(result.path).toContain(path.join('Qwen', 'Qwen2.5-7B-Instruct-GGUF', 'updated.gguf'));
    expect(fs.existsSync(result.path)).toBe(true);
  } finally {
    global.fetch = originalFetch;
  }
});
