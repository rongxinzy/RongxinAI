import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

import { LocalModelCatalog } from './localModelCatalog';
import { MarketplaceService } from './marketplaceService';
import { prefillInstallInputFromMarketplace } from './llamacppModelInstallation';
import { syncModelCatalog } from './modelCatalogSync';
import { toCatalogUpsert } from './modelCatalogUpdateTypes';

vi.mock('fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('fs/promises')>();
  return { ...fs, open: vi.fn(fs.open) };
});

const bundled = path.resolve('resources/model-catalog.sqlite');
const seedRepo = 'Qwen/Qwen3-0.6B-GGUF';

test('the bundled catalog searches, pages, and resolves verified installs offline', async () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-catalog-'));
  try {
    const catalog = new LocalModelCatalog(bundled, data);
    const modelsDir = path.join(data, 'models');
    const service = new MarketplaceService(() => modelsDir, catalog);
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
    const installedPath = path.join(modelsDir, 'modelscope', seedRepo, install.filePath!);
    mkdirSync(path.dirname(installedPath), { recursive: true });
    writeFileSync(installedPath, 'GGUF');
    const installed = await service.search({ query: seedRepo });
    expect(installed.models).toContainEqual(
      expect.objectContaining({ repoId: seedRepo, installed: true, installedPath }),
    );
    const signal = AbortSignal.abort(new Error('Cancelled'));
    await expect(service.search({ query: seedRepo }, signal)).rejects.toThrow('Cancelled');
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

test('a staged update stays unpublished if its asynchronous disk sync fails', async () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-catalog-'));
  try {
    const catalog = new LocalModelCatalog(bundled, data);
    const { revision, updatedAt } = catalog.getVersion();
    const model = catalog.find(seedRepo)!;
    await catalog.applyUpdate({
      baseRevision: revision,
      revision: revision + 1,
      updatedAt,
      upserts: [toCatalogUpsert(0, { ...model, name: 'Published revision' })],
      deletes: [],
    });

    const syncStarted = Promise.withResolvers<void>();
    const diskSync = Promise.withResolvers<void>();
    const { open: actualOpen } = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const file = await actualOpen(...args);
      vi.spyOn(file, 'sync').mockImplementation(() => {
        syncStarted.resolve();
        return diskSync.promise;
      });
      return file;
    });

    const updating = catalog.applyUpdate({
      baseRevision: revision + 1,
      revision: revision + 2,
      updatedAt,
      upserts: [toCatalogUpsert(0, { ...model, name: 'Unpublished revision' })],
      deletes: [],
    });
    const phase = await Promise.race([
      syncStarted.promise.then(() => 'sync'),
      updating.then(() => 'published'),
    ]);
    expect(phase).toBe('sync');
    try {
      expect(new LocalModelCatalog(bundled, data).find(seedRepo)?.name).toBe('Published revision');
      expect(readdirSync(data)).not.toContain(`model-catalog-${revision + 2}.sqlite`);
    } finally {
      diskSync.reject(new Error('Injected disk sync failure'));
      await expect(updating).rejects.toThrow('Injected disk sync failure');
    }
    expect(new LocalModelCatalog(bundled, data).getVersion().revision).toBe(revision + 1);
    expect(readdirSync(data).toSorted()).toEqual([
      `model-catalog-${revision + 1}.sqlite`,
      'model-catalog-current',
    ]);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
