import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../../tests/helpers/mockLlamaCppCatalogWorker';
import { scanLocalGgufModels } from '../llamacppModelCatalog';
import { LlamaCppManager } from './core';

let root: string;
let modelsDir: string;
let importDir: string;
let manager: LlamaCppManager;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(tmpdir(), 'gguf-import-'));
  modelsDir = path.join(root, 'models');
  importDir = path.join(modelsDir, 'imported');
  manager = new LlamaCppManager(() => ({ modelsDir }), { resolveModel: vi.fn() });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP request'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.promises.rm(root, { recursive: true, force: true });
});

async function createSource(directory: string, name: string, content: string): Promise<string> {
  const source = path.join(root, directory, name);
  await fs.promises.mkdir(path.dirname(source), { recursive: true });
  await fs.promises.writeFile(source, content);
  return source;
}

test('imports same-name models concurrently without exposing an incomplete file', async () => {
  const firstSource = await createSource('first', 'model.gguf', 'first');
  const secondSource = await createSource('second', 'model.gguf', 'second');
  const started = Promise.withResolvers<void>();
  const unblock = Promise.withResolvers<void>();
  const copyFile = fs.promises.copyFile.bind(fs.promises);
  const copy = vi.spyOn(fs.promises, 'copyFile').mockImplementationOnce(async (source, target) => {
    await fs.promises.writeFile(target, 'partial');
    started.resolve();
    await unblock.promise;
    await copyFile(source, target);
  });
  const first = manager.importModelFiles([firstSource]);
  try {
    await Promise.race([started.promise, first]);
    expect(copy).toHaveBeenCalledOnce();
    expect(scanLocalGgufModels(modelsDir)).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const [second] = await manager.importModelFiles([secondSource]);
    expect(second.path).toBe(path.join(importDir, 'model.gguf'));
    expect(await fs.promises.readFile(second.path!, 'utf8')).toBe('second');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    unblock.resolve();
    await first;
  }

  const [firstModel] = await first;
  expect(firstModel.path).toBe(path.join(importDir, 'model-2.gguf'));
  expect(await fs.promises.readFile(firstModel.path!, 'utf8')).toBe('first');
  expect((await fs.promises.readdir(importDir)).sort()).toEqual(['model-2.gguf', 'model.gguf']);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('a failed copy leaves no models or staging files from that batch', async () => {
  const source = await createSource('first', 'model.gguf', 'first');

  await expect(
    manager.importModelFiles([source, path.join(root, 'missing.gguf')]),
  ).rejects.toMatchObject({ code: 'ENOENT' });

  expect(await fs.promises.readdir(importDir)).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('a failed publication leaves existing files and rolls back the new batch', async () => {
  const first = await createSource('first', 'model.gguf', 'first');
  const second = await createSource('second', 'other.gguf', 'second');
  await fs.promises.mkdir(importDir, { recursive: true });
  const existing = path.join(importDir, 'model.gguf');
  await fs.promises.writeFile(existing, 'existing');
  const rename = fs.renameSync;
  const failure = new Error('publication failed');
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === path.join(importDir, 'other.gguf')) throw failure;
    rename(from, to);
  });

  await expect(manager.importModelFiles([first, second])).rejects.toBe(failure);

  expect(await fs.promises.readdir(importDir)).toEqual(['model.gguf']);
  expect(await fs.promises.readFile(existing, 'utf8')).toBe('existing');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.skipIf(process.platform === 'win32')(
  'a dangling symlink still occupies an import name',
  async () => {
    const source = await createSource('first', 'model.gguf', 'first');
    await fs.promises.mkdir(importDir, { recursive: true });
    const occupied = path.join(importDir, 'model.gguf');
    const missing = path.join(root, 'not-yet-present');
    await fs.promises.symlink(missing, occupied);

    const [model] = await manager.importModelFiles([source]);

    expect(model.path).toBe(path.join(importDir, 'model-2.gguf'));
    expect(await fs.promises.readlink(occupied)).toBe(missing);
    expect(await fs.promises.readFile(model.path!, 'utf8')).toBe('first');
  },
);
