import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import {
  buildLlamaServerArgs,
  chooseModelScopeInstallFile,
  extractModelScopeFilePaths,
  LlamaCppManager,
  mergeLocalModels,
  modelLaunchOptionsToPreset,
  scanLocalGgufModels,
} from './llamacppManager';

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

test('buildLlamaServerArgs keeps model launch fields out of llama-server CLI flags', () => {
  expect(buildLlamaServerArgs({
    host: '127.0.0.2',
    port: '18080',
    modelsMax: '1',
    modelsAutoload: false,
    ctxSize: '8192',
    batchSize: '512',
    ubatchSize: '128',
    gpuLayers: 'all',
    threads: '8',
    flashAttn: 'auto',
    reasoning: 'off',
    chatTemplate: 'chatml',
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
