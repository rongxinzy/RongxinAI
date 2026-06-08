import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ZipFile } from 'yazl';

import {
  buildFallbackManifest,
  fetchLlamaCppBackendManifest,
  getLlamaCppBackendCompatibilityError,
  getLlamaCppBackendDir,
  getLlamaCppCurrentBackendDir,
  getLlamaCppCurrentExecutablePath,
  importLlamaCppBackendArchive,
  importLlamaCppBackendPath,
  installLlamaCppBackend,
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

async function createBackendZipArchive(zipPath: string, entries: Array<{ name: string; content: string }>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zip = new ZipFile();
    for (const entry of entries) {
      zip.addBuffer(Buffer.from(entry.content, 'utf8'), entry.name);
    }
    zip.end();
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', resolve)
      .on('error', reject);
  });
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

  test('does not auto-recommend HIP for Windows x64 without NVIDIA when CPU is available', () => {
    const manifest = {
      schemaVersion: 1 as const,
      defaultVersion: 'b9518',
      backends: [
        {
          version: 'b9518',
          backend: 'win-x64-hip',
          platform: 'win32' as const,
          arch: 'x64',
          accelerator: 'hip' as const,
          archive: { assetName: 'llama-b9518-bin-win-hip-radeon-x64.tar.gz' },
        },
        {
          version: 'b9518',
          backend: 'win-x64',
          platform: 'win32' as const,
          arch: 'x64',
          accelerator: 'cpu' as const,
          archive: { assetName: 'llama-b9518-bin-win-cpu-x64.tar.gz' },
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

    expect(ref?.versionBackend).toBe('b9518/win-x64');
  });

  test('does not auto-recommend Adreno for Windows ARM64 when generic CPU backend is available', () => {
    const manifest = {
      schemaVersion: 1 as const,
      defaultVersion: 'b9518',
      backends: [
        {
          version: 'b9518',
          backend: 'win-arm64-opencl-adreno',
          platform: 'win32' as const,
          arch: 'arm64',
          accelerator: 'cpu' as const,
          archive: { assetName: 'llama-b9518-bin-win-opencl-adreno-arm64.tar.gz' },
        },
        {
          version: 'b9518',
          backend: 'win-arm64',
          platform: 'win32' as const,
          arch: 'arm64',
          accelerator: 'cpu' as const,
          archive: { assetName: 'llama-b9518-bin-win-cpu-arm64.tar.gz' },
        },
      ],
    };

    const ref = recommendLlamaCppBackend({
      manifest,
      platform: 'win32',
      arch: 'arm64',
      hasNvidiaGpu: false,
      config: {},
    });

    expect(ref?.versionBackend).toBe('b9518/win-arm64');
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

  test('reports real download progress for backend installation', async () => {
    const runtimeRoot = createRuntimeRoot();
    const ref = toBackendRef('b9518', 'win-x64');
    const manifest = {
      schemaVersion: 1 as const,
      defaultVersion: 'b9518',
      releaseBaseUrl: 'https://example.com/llamacpp/b9518',
      backends: [
        {
          version: 'b9518',
          backend: 'win-x64',
          platform: 'win32' as const,
          arch: 'x64',
          accelerator: 'cpu' as const,
          archive: { assetName: 'llama-b9518-bin-win-cpu-x64.zip' },
        },
      ],
    };

    const archivePath = path.join(runtimeRoot, 'llama-b9518-bin-win-cpu-x64.zip');
    await createBackendZipArchive(archivePath, [
      { name: 'build/bin/llama-server.exe', content: 'binary' },
      { name: 'build/bin/ggml.dll', content: 'dll' },
    ]);
    const archiveBytes = fs.readFileSync(archivePath);
    fs.rmSync(archivePath, { force: true });

    const originalFetch = global.fetch;
    const originalDateNow = Date.now;
    const progressEvents: any[] = [];
    let now = 1_000;

    try {
      Date.now = () => now;
      global.fetch = vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const halfway = Math.max(1, Math.floor(archiveBytes.length / 2));
            controller.enqueue(archiveBytes.subarray(0, halfway));
            now += 500;
            controller.enqueue(archiveBytes.subarray(halfway));
            now += 500;
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-length': String(archiveBytes.length) },
        });
      }) as typeof fetch;

      const result = await installLlamaCppBackend({
        runtimeRoot,
        ref,
        platform: 'win32',
        arch: 'x64',
        hasNvidiaGpu: false,
        manifest,
        onProgress: progress => {
          progressEvents.push(progress);
        },
      });

      expect(result.success).toBe(true);
      const downloadEvents = progressEvents.filter(
        progress => progress.phase === 'downloading-progress',
      );
      expect(downloadEvents.length).toBeGreaterThan(0);
      expect(downloadEvents.some(progress => typeof progress.completed === 'number' && progress.completed > 0)).toBe(true);
      expect(downloadEvents.some(progress => typeof progress.total === 'number' && progress.total === archiveBytes.length)).toBe(true);
      expect(downloadEvents.some(progress => typeof progress.speed === 'number' && progress.speed > 0)).toBe(true);
      expect(progressEvents.some(progress => progress.phase === 'installing')).toBe(true);
      expect(progressEvents.some(progress => progress.phase === 'detecting')).toBe(true);
      expect(progressEvents.some(progress => progress.phase === 'done')).toBe(true);
    } finally {
      global.fetch = originalFetch;
      Date.now = originalDateNow;
    }
  });
});
