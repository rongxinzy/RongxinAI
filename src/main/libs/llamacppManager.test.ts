import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import {
  buildLlamaServerArgs,
  buildLlamaCppExecutableCandidates,
  chooseModelScopeInstallFile,
  extractModelScopeFilePaths,
  extractModelScopeRepoFiles,
  isPathInside,
  LlamaCppManager,
  mergeLocalModels,
  modelLaunchOptionsToPreset,
  scanLocalGgufModels,
} from './llamacppManager';

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

test('extractModelScopeRepoFiles extracts download URLs from ModelScope response', () => {
  expect(extractModelScopeRepoFiles({
    Data: {
      Files: [
        { Path: 'README.md' },
        { Path: 'model-q4_k_m.gguf', DownloadUrl: 'https://oss.model-scope.cn/abc123.gguf' },
        { Name: 'model-q8_0.gguf', Url: 'https://oss.model-scope.cn/def456.gguf' },
      ],
    },
  })).toEqual([
    { path: 'README.md', downloadUrl: undefined },
    { path: 'model-q4_k_m.gguf', downloadUrl: 'https://oss.model-scope.cn/abc123.gguf' },
    { path: 'model-q8_0.gguf', downloadUrl: 'https://oss.model-scope.cn/def456.gguf' },
  ]);
});

function toRepoFile(p: string): { path: string; downloadUrl?: string } {
  return { path: p };
}

test('chooseModelScopeInstallFile prefers a normal Q4_K_M GGUF model file', () => {
  expect(chooseModelScopeInstallFile([
    toRepoFile('README.md'),
    toRepoFile('mmproj-model-f16.gguf'),
    toRepoFile('qwen3-8b-q8_0.gguf'),
    toRepoFile('qwen3-8b-q4_k_m.gguf'),
  ])).toEqual({ path: 'qwen3-8b-q4_k_m.gguf', downloadUrl: undefined });
});

test('chooseModelScopeInstallFile rejects repositories without GGUF model files', () => {
  expect(chooseModelScopeInstallFile([
    toRepoFile('config.json'),
    toRepoFile('model.safetensors'),
    toRepoFile('tokenizer.json'),
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

  let fetchCount = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      fetchCount += 1;
      if (fetchCount === 1) {
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
