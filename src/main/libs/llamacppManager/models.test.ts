import fs from 'fs';
import '../../../../tests/helpers/mockLlamaCppCatalogWorker';
import os from 'os';
import path from 'path';
import { expect, test, vi } from 'vitest';

import {
  LlamaCppManager,
  chooseModelScopeInstallFile,
  extractModelScopeFilePaths,
  modelLaunchOptionsToPreset,
  scanLocalGgufModels,
} from '../llamacppManager';

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

test('modelLaunchOptionsToPreset writes n-cpu-moe only when set (dense models stay fit-enabled)', () => {
  expect(modelLaunchOptionsToPreset({ ctxSize: 8192, gpuLayers: 'auto' })).toEqual({
    'ctx-size': 8192,
    'n-gpu-layers': 'auto',
  });
  // Writing n-cpu-moe intentionally disables llama.cpp --fit for this model.
  expect(
    modelLaunchOptionsToPreset({
      ctxSize: 8192,
      gpuLayers: 'auto',
      nCpuMoe: 12,
    }),
  ).toEqual({
    'ctx-size': 8192,
    'n-gpu-layers': 'auto',
    'n-cpu-moe': 12,
  });
  expect(modelLaunchOptionsToPreset({ nCpuMoe: 0 })).toEqual({
    'n-cpu-moe': 0,
  });
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

test('deleteModel removes empty parent directories after deleting a GGUF file', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-delete-'));
  const repoDir = path.join(modelsDir, 'modelscope', 'unsloth', 'Qwen3.5-0.8B-GGUF');
  const ggufPath = path.join(repoDir, 'Qwen3.5-0.8B-Q4_0.gguf');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(ggufPath, 'gguf');

  const manager = new LlamaCppManager(() => ({ modelsDir }), { resolveModel: vi.fn() });
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
  const deleteFile = vi.fn(async (_name: string, filePath: string) => {
    expect(fs.existsSync(filePath)).toBe(true);
    await fs.promises.unlink(filePath);
  });

  const result = await manager.deleteModel('Qwen3.5-0.8B-GGUF', deleteFile);
  expect(result).toEqual(
    expect.objectContaining({
      success: true,
      deleted: true,
      removedModelName: 'Qwen3.5-0.8B-GGUF',
    }),
  );
  expect(deleteFile).toHaveBeenCalledExactlyOnceWith('Qwen3.5-0.8B-GGUF', ggufPath);
  expect(fs.existsSync(ggufPath)).toBe(false);
  expect(fs.existsSync(repoDir)).toBe(false);
});

test('deleteModel refuses a model in a directory linked outside the library', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-linked-delete-'));
  const modelsDir = path.join(root, 'library');
  const externalDir = path.join(root, 'external');
  const externalModel = path.join(externalDir, 'shared.gguf');
  const manager = new LlamaCppManager(() => ({ modelsDir }), { resolveModel: vi.fn() });
  const deleteFile = vi.fn();
  try {
    fs.mkdirSync(modelsDir);
    fs.mkdirSync(externalDir);
    fs.writeFileSync(externalModel, 'gguf');
    fs.symlinkSync(externalDir, path.join(modelsDir, 'shared'), 'junction');
    vi.spyOn(manager, 'listLocalModels').mockResolvedValue(scanLocalGgufModels(modelsDir));

    await expect(manager.deleteModel('shared', deleteFile)).resolves.toMatchObject({
      success: false,
      reason: 'not-app-managed',
    });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(fs.existsSync(externalModel)).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lists the active model library without querying a server at the configured address', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-file-catalog-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  let modelsDir = first;
  const manager = new LlamaCppManager(() => ({ modelsDir, port: '8080' }), {
    resolveModel: vi.fn(),
  });
  using fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected HTTP request'));
  try {
    for (const [dir, name] of [
      [first, 'old'],
      [second, 'new'],
    ]) {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, name + '.gguf'), 'gguf');
    }
    expect((await manager.listLocalModels()).map(model => model.name)).toEqual(['old']);
    modelsDir = second;
    expect((await manager.listLocalModels()).map(model => model.name)).toEqual(['new']);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
