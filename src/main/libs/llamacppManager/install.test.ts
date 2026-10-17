// Model install tests split from llamacppManager.test.ts (#1069).
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

function verifiedMarketplaceModel(input: {
  repoId?: string;
  filePath?: string;
  downloadUrl?: string;
  sha256: string;
  mmproj?: { path: string; downloadUrl: string; sha256: string };
}): MarketplaceModel {
  const repoId = input.repoId ?? 'Qwen/Qwen3-8B-GGUF';
  const filePath = input.filePath ?? 'Qwen3-8B-Q4_K_M.gguf';
  const files = [
    {
      path: filePath,
      sizeBytes: 8,
      sha256: input.sha256,
      isRecommended: true,
      kind: 'model' as const,
      revision: 'commit-sha',
      downloadUrl: input.downloadUrl ?? 'https://download.test/model.gguf',
    },
    ...(input.mmproj
      ? [
          {
            path: input.mmproj.path,
            sizeBytes: 8,
            sha256: input.mmproj.sha256,
            kind: 'mmproj' as const,
            revision: 'commit-sha',
            downloadUrl: input.mmproj.downloadUrl,
          },
        ]
      : []),
  ];
  return {
    source: 'modelscope-gguf',
    id: repoId,
    repoId,
    name: repoId,
    description: 'verified cloud metadata',
    tags: ['chat', 'gguf'],
    sizes: ['desktop'],
    recommendedTag: 'Q4_K_M',
    capability: 'chat',
    capabilities: ['chat'],
    filePath,
    installed: false,
    files,
    mmprojFilePath: input.mmproj?.path,
    metadataStatus: 'verified',
    runtime: {
      format: 'gguf',
      status: 'candidate',
      ggufFilesVerified: true,
      sha256Verified: true,
      source: 'modelscope-file-api',
      observedAt: '2026-08-01T00:00:00.000Z',
      revision: 'commit-sha',
      reasons: ['端侧加载探针待执行。'],
    },
  };
}

test('installModel rejects a repository without cloud-verified GGUF metadata', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-unverified-'));
  const marketplaceService = {
    resolveModel: async () => null,
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  await expect(manager.installModel({ modelId: 'owner/unverified-GGUF' })).rejects.toThrow(
    'cloud catalogue has not verified',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test('installModel downloads and verifies the exact GGUF selected by the cloud catalogue', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-verified-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () => verifiedMarketplaceModel({ sha256 }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    expect(String(input)).toBe('https://download.test/model.gguf');
    return new Response(bytes, { status: 200, headers: { 'content-length': '8' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' });

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(result.path).toContain(path.join('Qwen', 'Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf'));
  expect(fs.readFileSync(result.path)).toEqual(Buffer.from(bytes));
});

test('installModel rejects checksum-valid bytes that are not a GGUF container', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-invalid-gguf-'));
  const bytes = new Uint8Array([0x4e, 0x4f, 0x54, 0x47, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () => verifiedMarketplaceModel({ sha256 }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes, { status: 200, headers: { 'content-length': '8' } })),
  );

  await expect(manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' })).rejects.toThrow(
    'invalid GGUF magic bytes',
  );
  expect(
    fs.existsSync(
      path.join(modelsDir, 'modelscope', 'Qwen', 'Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf.download'),
    ),
  ).toBe(false);
});

test('installModel keeps an interrupted partial file for a later Range resume', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-resume-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () =>
      verifiedMarketplaceModel({
        sha256,
        mmproj: {
          path: 'mmproj-F16.gguf',
          downloadUrl: 'https://download.test/mmproj.gguf',
          sha256,
        },
      }),
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/model.gguf')) {
        return new Response(bytes, { status: 200, headers: { 'content-length': '8' } });
      }
      return new Response(
        new ReadableStream({
          start(streamController) {
            streamController.enqueue(new Uint8Array([4]));
            streamController.close();
          },
        }),
        { status: 200, headers: { 'content-length': '3' } },
      );
    }),
  );

  const install = manager.installModel(
    { modelId: 'Qwen/Qwen3-8B-GGUF' },
    progress => {
      if (progress.targetPath?.endsWith('mmproj-F16.gguf') && progress.completed === 1) {
        controller.abort(new Error('Install cancelled'));
      }
    },
    { signal: controller.signal },
  );

  await expect(install).rejects.toThrow();
  const repoDir = path.join(modelsDir, 'modelscope', 'Qwen', 'Qwen3-8B-GGUF');
  expect(fs.existsSync(path.join(repoDir, 'Qwen3-8B-Q4_K_M.gguf'))).toBe(false);
  expect(fs.existsSync(path.join(repoDir, 'mmproj-F16.gguf.download'))).toBe(true);
});

test('installModel refreshes cloud metadata once after a stale download URL returns 404', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-refresh-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let resolveCount = 0;
  const marketplaceService = {
    resolveModel: async () => {
      resolveCount += 1;
      return verifiedMarketplaceModel({
        filePath: resolveCount === 1 ? 'stale.gguf' : 'fresh.gguf',
        downloadUrl:
          resolveCount === 1
            ? 'https://download.test/stale.gguf'
            : 'https://download.test/fresh.gguf',
        sha256,
      });
    },
  } as MarketplaceService;
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  manager.refreshModelsAfterInstall = async () => undefined as any;
  const fetchMock = vi.fn(async (input: string | URL | Request) =>
    String(input).endsWith('/stale.gguf')
      ? new Response('not found', { status: 404 })
      : new Response(bytes, { status: 200, headers: { 'content-length': '8' } }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const result = await manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' });

  expect(resolveCount).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.path).toContain('fresh.gguf');
});

test('listLocalModels reports a repeating router failure once', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-router-failure-'));
  fs.writeFileSync(path.join(modelsDir, 'qwen-local.gguf'), 'gguf');
  const manager = new LlamaCppManager(() => ({ modelsDir }));
  manager.client = async () =>
    ({
      listModelsSnapshot: async () => {
        throw new Error(
          'llama.cpp /models failed: HTTP 404 {"error":{"message":"Route not found."}}',
        );
      },
    }) as any;

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  try {
    await manager.listLocalModels();
    await manager.listLocalModels();

    const warnings = warn.mock.calls.filter(call => String(call[0]).includes('router model list'));
    const repeats = debug.mock.calls.filter(call => String(call[0]).includes('router model list'));
    // The documented GGUF fallback still runs; its explanation is not repeated
    // on every refresh, which is what buried the log in stack traces.
    expect(warnings).toHaveLength(1);
    expect(repeats).toHaveLength(1);
    await expect(manager.listLocalModels()).resolves.toHaveLength(1);
  } finally {
    warn.mockRestore();
    debug.mockRestore();
  }
});
