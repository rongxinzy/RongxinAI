import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { MarketplaceService } from './marketplaceService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-marketplace-'));
  tempDirs.push(dir);
  return dir;
}

test('MarketplaceService marks installed models from the configured llama.cpp models directory', () => {
  const modelsDir = createTempDir();
  const installedPath = path.join(
    modelsDir,
    'modelscope',
    'Qwen',
    'Qwen2.5-7B-Instruct-GGUF',
    'qwen2.5-7b-instruct-q4_k_m.gguf',
  );
  fs.mkdirSync(path.dirname(installedPath), { recursive: true });
  fs.writeFileSync(installedPath, '');

  const service = new MarketplaceService(() => modelsDir);
  const result = service.searchLocal({ query: 'Qwen2.5 7B Instruct', limit: 10 });
  const model = result.find((item) => item.id === 'Qwen/Qwen2.5-7B-Instruct-GGUF');

  expect(model?.installed).toBe(true);
  expect(model?.installedPath).toBe(installedPath);
});

test('MarketplaceService searchLocal defaults to returning at most 100 models', () => {
  const service = new MarketplaceService(() => createTempDir());
  const result = service.searchLocal();

  expect(result.length).toBeLessThanOrEqual(100);
});

test('MarketplaceService GGUF library parser does not stop at 50 items', async () => {
  const module = await import('./marketplaceService');
  const parseModelScopeGgufLibraryHtml = (module as unknown as {
    __test__parseModelScopeGgufLibraryHtml?: (html: string) => string[];
  }).__test__parseModelScopeGgufLibraryHtml;

  expect(typeof parseModelScopeGgufLibraryHtml).toBe('function');
  if (!parseModelScopeGgufLibraryHtml) return;

  const html = Array.from({ length: 120 }, (_, index) =>
    `<a href="/models/owner/model-${index + 1}-GGUF">model ${index + 1}</a>`,
  ).join('\n');

  const result = parseModelScopeGgufLibraryHtml(html);
  expect(result).toHaveLength(120);
});

test('MarketplaceService merges online and curated results without duplicates', async () => {
  const module = await import('./marketplaceService');
  const mergeMarketplaceModels = (module as unknown as {
    __test__mergeMarketplaceModels?: (
      primary: Array<{ id: string; repoId?: string; name: string }>,
      fallback: Array<{ id: string; repoId?: string; name: string }>,
      limit: number,
    ) => Array<{ id: string; repoId?: string; name: string }>;
  }).__test__mergeMarketplaceModels;

  expect(typeof mergeMarketplaceModels).toBe('function');
  if (!mergeMarketplaceModels) return;

  const result = mergeMarketplaceModels(
    [
      { id: 'a/one', repoId: 'a/one', name: 'one' },
      { id: 'b/two', repoId: 'b/two', name: 'two' },
    ],
    [
      { id: 'b/two', repoId: 'b/two', name: 'two' },
      { id: 'c/three', repoId: 'c/three', name: 'three' },
    ],
    10,
  );

  expect(result.map((item) => item.id)).toEqual(['a/one', 'b/two', 'c/three']);
});
