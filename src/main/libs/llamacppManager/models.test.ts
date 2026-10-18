// Manager model lifecycle tests split from llamacppManager.test.ts (#1069).
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

test('preset global GPU section is refreshed on service start and stale keys are removed', () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-preset-global-gpu-'));
  const presetPath = path.join(modelsDir, 'models-preset.ini');
  fs.writeFileSync(
    presetPath,
    [
      'version = 1',
      '',
      '[*]',
      'device = none',
      'n-gpu-layers = 99',
      '',
      '[smol]',
      'model = /models/smol.gguf',
      '',
    ].join('\n'),
  );

  class PresetWriterManager extends LlamaCppManager {
    writeGlobalGpuSection(config: ReturnType<LlamaCppManager['getServiceConfig']>): void {
      this.upsertPresetGlobalGpuSection(config);
    }
  }

  const manager = new PresetWriterManager(() => ({ modelsDir }));
  manager.getPresetPath = () => presetPath;
  manager.writeGlobalGpuSection({ gpuLayers: '999', tensorSplit: '3,1' });

  const preset = fs.readFileSync(presetPath, 'utf-8');
  expect(preset).toContain('[*]\nn-gpu-layers = 999\ntensor-split = 3,1');
  // Stale global device entry must not linger after the config stopped setting it.
  expect(preset).not.toContain('device = none');
  expect(preset).toContain('[smol]\nmodel = /models/smol.gguf');
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
