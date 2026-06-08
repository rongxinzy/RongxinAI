import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  buildFallbackManifest,
  fetchLlamaCppBackendManifest,
  getLlamaCppBackendCompatibilityError,
  getLlamaCppBackendDir,
  getLlamaCppCurrentBackendDir,
  getLlamaCppCurrentExecutablePath,
  importLlamaCppBackendArchive,
  importLlamaCppBackendPath,
  listLlamaCppBackends,
  readCurrentBackendRef,
  recommendLlamaCppBackend,
  syncCurrentBackend,
  toBackendRef,
  uninstallLlamaCppBackend,
} from './llamacppBackendManager';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createRuntimeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-backend-manager-'));
  tempDirs.push(dir);
  return dir;
}

function writeInstalledBackend(runtimeRoot: string, version: string, backend: string, platform: NodeJS.Platform): void {
  const ref = toBackendRef(version, backend);
  const executableName = platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const backendDir = getLlamaCppBackendDir(runtimeRoot, ref);
  fs.mkdirSync(path.join(backendDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(backendDir, 'bin', executableName), '');
  fs.writeFileSync(
    path.join(backendDir, 'runtime-build-info.json'),
    JSON.stringify({
      version,
      backend,
      target: backend,
      source: 'test',
    }, null, 2),
    'utf8',
  );
}

describe('llamacpp backend manager', () => {
  test('recommends CUDA 13 for Windows x64 with NVIDIA when available', () => {
    const manifest = buildFallbackManifest('b9505');

    const ref = recommendLlamaCppBackend({
      manifest,
      platform: 'win32',
      arch: 'x64',
      hasNvidiaGpu: true,
      config: {},
    });

    expect(ref?.versionBackend).toBe('b9505/win-x64-cuda-13');
  });

  test('recommends CUDA 13 before CUDA 12 for Windows x64 with NVIDIA', () => {
    const manifest = {
      schemaVersion: 1 as const,
      defaultVersion: 'b9518',
      backends: [
        {
          version: 'b9518',
          backend: 'win-x64-cuda-12',
          platform: 'win32' as const,
          arch: 'x64',
          accelerator: 'cuda' as const,
          cudaMajor: '12' as const,
          archive: { assetName: 'llama-b9518-bin-win-cuda-12.4-x64.zip' },
        },
        {
          version: 'b9518',
          backend: 'win-x64-cuda-13',
          platform: 'win32' as const,
          arch: 'x64',
          accelerator: 'cuda' as const,
          cudaMajor: '13' as const,
          archive: { assetName: 'llama-b9518-bin-win-cuda-13.3-x64.zip' },
        },
      ],
    };

    const ref = recommendLlamaCppBackend({
      manifest,
      platform: 'win32',
      arch: 'x64',
      hasNvidiaGpu: true,
      config: {},
    });

    expect(ref?.versionBackend).toBe('b9518/win-x64-cuda-13');
  });

  test('recommends Vulkan for Windows x64 without NVIDIA when available', () => {
    const manifest = buildFallbackManifest('b9505');

    const ref = recommendLlamaCppBackend({
      manifest,
      platform: 'win32',
      arch: 'x64',
      hasNvidiaGpu: false,
      config: {},
    });

    expect(ref?.versionBackend).toBe('b9505/win-x64-vulkan');
  });

  test('recommends Vulkan before CPU for Windows x64 without NVIDIA when available', () => {
    const manifest = {
      schemaVersion: 1 as const,
      defaultVersion: 'b9518',
      backends: [
        {
          version: 'b9518',
          backend: 'win-x64',
          platform: 'win32' as const,
          arch: 'x64',
          accelerator: 'cpu' as const,
          archive: { assetName: 'llama-b9518-bin-win-cpu-x64.zip' },
        },
        {
          version: 'b9518',
          backend: 'win-x64-vulkan',
          platform: 'win32' as const,
          arch: 'x64',
          accelerator: 'vulkan' as const,
          archive: { assetName: 'llama-b9518-bin-win-vulkan-x64.zip' },
        },
      ],
    };

    const ref = recommendLlamaCppBackend({
      manifest,
      platform: 'win32',
      arch: 'x64',
      hasNvidiaGpu: false,
      config: {},
    });

    expect(ref?.versionBackend).toBe('b9518/win-x64-vulkan');
  });

  test('reads a root manifest and aggregates version manifests', async () => {
    const originalFetch = global.fetch;
    const responses = new Map<string, any>([
      ['https://example.com/llamacpp/manifest.json', {
        schemaVersion: 1,
        defaultVersion: 'b9518',
        versions: ['b9518', 'b9244'],
        publicBaseUrl: 'https://example.com/llamacpp',
      }],
      ['https://example.com/llamacpp/b9518/manifest.json', {
        schemaVersion: 1,
        defaultVersion: 'b9518',
        releaseBaseUrl: 'https://example.com/llamacpp/b9518',
        backends: [
          {
            version: 'b9518',
            backend: 'win-x64-cuda-13',
            platform: 'win32',
            arch: 'x64',
            accelerator: 'cuda',
            cudaMajor: '13',
            archive: { assetName: 'llama-b9518-bin-win-cuda-13.3-x64.zip' },
          },
        ],
      }],
      ['https://example.com/llamacpp/b9244/manifest.json', {
        schemaVersion: 1,
        defaultVersion: 'b9244',
        releaseBaseUrl: 'https://example.com/llamacpp/b9244',
        backends: [
          {
            version: 'b9244',
            backend: 'win-x64-cuda-12',
            platform: 'win32',
            arch: 'x64',
            accelerator: 'cuda',
            cudaMajor: '12',
            archive: { assetName: 'llama-b9244-bin-win-cuda-12.4-x64.zip' },
          },
        ],
      }],
    ]);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const payload = responses.get(url);
      if (!payload) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => payload,
      };
    }) as typeof fetch);

    try {
      const manifest = await fetchLlamaCppBackendManifest({
        LLAMACPP_BACKEND_MANIFEST_URL: 'https://example.com/llamacpp/manifest.json',
      });
      expect(manifest.defaultVersion).toBe('b9518');
      expect(manifest.backends.map(backend => backend.versionBackend ?? `${backend.version}/${backend.backend}`)).toEqual([
        'b9518/win-x64-cuda-13',
        'b9244/win-x64-cuda-12',
      ]);
      expect(manifest.backends[0]?.archive.url).toBe(
        'https://example.com/llamacpp/b9518/llama-b9518-bin-win-cuda-13.3-x64.zip',
      );
      expect(manifest.backends[1]?.archive.url).toBe(
        'https://example.com/llamacpp/b9244/llama-b9244-bin-win-cuda-12.4-x64.zip',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('rejects a locally installed backend when platform or architecture does not match', async () => {
    const runtimeRoot = createRuntimeRoot();
    const ref = toBackendRef('b9518', 'win-arm64');
    const backendDir = getLlamaCppBackendDir(runtimeRoot, ref);
    fs.mkdirSync(path.join(backendDir, 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(backendDir, 'runtime-build-info.json'),
      JSON.stringify({
        version: ref.version,
        backend: ref.backend,
        target: ref.backend,
        source: 'local',
        platform: 'win32',
        arch: 'arm64',
        accelerator: 'cpu',
      }, null, 2),
      'utf8',
    );

    const error = await getLlamaCppBackendCompatibilityError({
      runtimeRoot,
      ref,
      platform: 'darwin',
      arch: 'arm64',
      hasNvidiaGpu: false,
      manifest: {
        schemaVersion: 1,
        defaultVersion: 'b9518',
        releaseBaseUrl: 'https://example.com/llamacpp',
        backends: [],
      },
    });

    expect(error).toBe('Backend win-arm64 does not match current platform darwin.');
  });

  test('lists installed backend and current selection', async () => {
    const runtimeRoot = createRuntimeRoot();
    const manifest = buildFallbackManifest('b9505');
    const ref = toBackendRef('b9505', 'mac-arm64');
    writeInstalledBackend(runtimeRoot, ref.version, ref.backend, 'darwin');
    syncCurrentBackend(runtimeRoot, ref);

    const result = await listLlamaCppBackends({
      runtimeRoot,
      manifest,
      platform: 'darwin',
      arch: 'arm64',
      hasNvidiaGpu: false,
    });

    expect(result.selection?.versionBackend).toBe('b9505/mac-arm64');
    expect(readCurrentBackendRef(runtimeRoot)?.versionBackend).toBe('b9505/mac-arm64');
    expect(result.backends.find(backend => backend.versionBackend === 'b9505/mac-arm64')).toMatchObject({
      installed: true,
      current: true,
    });
  });

  test('uninstalls the selected backend and clears current', async () => {
    const runtimeRoot = createRuntimeRoot();
    const ref = toBackendRef('b9505', 'mac-arm64');
    writeInstalledBackend(runtimeRoot, ref.version, ref.backend, 'darwin');
    syncCurrentBackend(runtimeRoot, ref);

    const result = await uninstallLlamaCppBackend({
      runtimeRoot,
      ref,
      status: { status: 'installed', checkedAt: new Date().toISOString() },
      stopCurrent: async () => undefined,
    });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(fs.existsSync(getLlamaCppBackendDir(runtimeRoot, ref))).toBe(false);
    expect(fs.existsSync(getLlamaCppCurrentBackendDir(runtimeRoot))).toBe(false);
  });

  test('rejects CUDA companion-only archive import', async () => {
    const runtimeRoot = createRuntimeRoot();
    const archivePath = path.join(runtimeRoot, 'cudart-llama-bin-win-cuda-12.4-x64.tar.gz');
    fs.writeFileSync(archivePath, '');

    const result = await importLlamaCppBackendArchive({
      runtimeRoot,
      archivePath,
      platform: 'win32',
      arch: 'x64',
      hasNvidiaGpu: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('CUDA companion');
  });

  test('imports an extracted backend directory and infers version/backend', async () => {
    const runtimeRoot = createRuntimeRoot();
    const sourceDir = path.join(runtimeRoot, 'llama-b9518');
    fs.mkdirSync(path.join(sourceDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'bin', 'llama-server'), '');
    fs.writeFileSync(path.join(sourceDir, 'bin', 'libggml.dylib'), '');

    const result = await importLlamaCppBackendPath({
      runtimeRoot,
      sourcePath: sourceDir,
      platform: 'darwin',
      arch: 'arm64',
      hasNvidiaGpu: false,
    });

    expect(result.success).toBe(true);
    expect(result.backend?.versionBackend).toBe('b9518/mac-arm64');
    expect(readCurrentBackendRef(runtimeRoot)?.versionBackend).toBe('b9518/mac-arm64');
    expect(fs.existsSync(getLlamaCppCurrentExecutablePath(runtimeRoot, 'darwin'))).toBe(true);
  });
});
