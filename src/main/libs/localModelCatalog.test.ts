import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

import { LocalModelCatalog } from './localModelCatalog';
import { MarketplaceService } from './marketplaceService';
import { prefillInstallInputFromMarketplace } from './llamacppModelInstallation';
import { syncModelCatalog } from './modelCatalogSync';
import { toCatalogUpsert } from './modelCatalogUpdateTypes';

const bundled = path.resolve('resources/model-catalog.sqlite');
const seedRepo = 'Qwen/Qwen3-0.6B-GGUF';

test('the bundled catalog searches, pages, and resolves an install with the remote catalog unavailable', async () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-catalog-'));
  try {
    const network = vi.fn(() => Promise.reject(new Error('Overseas catalog blocked')));
    const catalog = new LocalModelCatalog(bundled, data);
    const service = new MarketplaceService(() => '', { localCatalog: catalog, fetchImpl: network });
    const first = await service.search({ query: 'qwen', task: 'chat', limit: 1 });
    expect(first.source).toBe('local-sqlite');
    expect(first.totalCount).toBeGreaterThan(10);
    expect(first.nextCursor).toBeDefined();
    const next = await service.search({
      query: 'qwen',
      task: 'chat',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(next.models[0].repoId).not.toBe(first.models[0].repoId);
    const install = await prefillInstallInputFromMarketplace({ modelId: seedRepo }, service);
    expect(new URL(install.downloadUrl!).hostname).toBe('www.modelscope.cn');
    expect(install.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(install.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(network).not.toHaveBeenCalled();
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('a published delta leaves active pagination pinned and is read at the next launch', async () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-catalog-'));
  try {
    const catalog = new LocalModelCatalog(bundled, data);
    const model = catalog.find(seedRepo)!;
    const { revision: baseRevision, updatedAt } = catalog.getVersion();
    const revision = baseRevision + 1;
    const deletes = ['Qwen/Qwen3-4B-GGUF'];
    const payload = {
      baseRevision,
      revision,
      updatedAt,
      upserts: [{ position: 0, model: { ...model, name: 'Updated name' } }],
      deletes,
    };
    const body = JSON.stringify(payload);
    const artifact = {
      bytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex'),
    };
    const fetchImpl = vi.fn(async (url: string | Request) =>
      String(url).endsWith('/manifest.json')
        ? Response.json({
            schema: 1,
            revision,
            snapshot: artifact,
            delta: { ...artifact, baseRevision },
          })
        : new Response(body),
    );
    const verify = vi.fn(async () => ({
      ...payload,
      upserts: payload.upserts.map(({ position, model }) => toCatalogUpsert(position, model)),
    }));
    await syncModelCatalog(catalog, 'https://models.example.com/feed', fetchImpl, verify);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      `https://models.example.com/feed/delta-${baseRevision}-${revision}.json`,
    );
    expect(catalog.find(seedRepo)?.name).toBe(model.name);
    const restarted = new LocalModelCatalog(bundled, data);
    expect(restarted.find(seedRepo)?.name).toBe('Updated name');
    expect(restarted.find(deletes[0])).toBeNull();
    expect(restarted.getVersion().revision).toBe(revision);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('a mismatched delta cannot replace the last usable local catalog', async () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-catalog-'));
  try {
    const catalog = new LocalModelCatalog(bundled, data);
    const { revision, updatedAt } = catalog.getVersion();
    await expect(
      catalog.applyUpdate({
        baseRevision: revision - 1,
        revision: revision + 1,
        updatedAt,
        upserts: [],
        deletes: [seedRepo],
      }),
    ).rejects.toThrow('does not match');
    expect(new LocalModelCatalog(bundled, data).find(seedRepo)).not.toBeNull();
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
