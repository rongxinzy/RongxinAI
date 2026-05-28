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
  const model = result.find((item) => item.repoId === 'Qwen/Qwen2.5-7B-Instruct-GGUF');

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
      primary: Array<{ id: string; repoId: string; name: string; description: string; tags: string[]; sizes: string[]; recommendedTag: string; capability: 'chat'; installed: false; source: 'modelscope-gguf' }>,
      fallback: Array<{ id: string; repoId: string; name: string; description: string; tags: string[]; sizes: string[]; recommendedTag: string; capability: 'chat'; installed: false; source: 'modelscope-gguf' }>,
      limit: number,
    ) => Array<{ id: string; repoId: string; name: string }>;
  }).__test__mergeMarketplaceModels;

  expect(typeof mergeMarketplaceModels).toBe('function');
  if (!mergeMarketplaceModels) return;

  const result = mergeMarketplaceModels(
    [
      { id: 'a/one', repoId: 'a/one', name: 'one', description: 'one', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
      { id: 'b/two', repoId: 'b/two', name: 'two', description: 'two', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
    ],
    [
      { id: 'b/two', repoId: 'b/two', name: 'two', description: 'two', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
      { id: 'c/three', repoId: 'c/three', name: 'three', description: 'three', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
    ],
    10,
  );

  expect(result.map((item) => item.id)).toEqual(['a/one', 'b/two', 'c/three']);
});

test('MarketplaceService sorts featured models first for empty queries and applies filters', () => {
  const service = new MarketplaceService(() => createTempDir());
  const result = service.searchLocal({ task: 'reasoning', size: 'desktop', limit: 20 });

  expect(result.length).toBeGreaterThan(0);
  expect(result.every((item) => item.tags.includes('reasoning') || item.capability === 'reasoning')).toBe(true);
  expect(result[0]?.isFeatured).toBe(true);
});
