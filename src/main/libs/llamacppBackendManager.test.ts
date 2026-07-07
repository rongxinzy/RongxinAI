import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ZipFile } from 'yazl';

vi.mock('./llamacppManager', () => ({
  listLlamaCppRuntimeDevices: vi.fn(async (input: { executablePath: string }) => ({
    success: true,
    executablePath: input.executablePath,
    devices: [{ id: 'CPU', name: 'CPU', backend: 'cpu' }],
  })),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

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

async function createArchiveServer(input: {
  archiveBytes: Buffer;
  failFirstGet?: boolean;
  closeFirstFullGetAfterBytes?: number;
}): Promise<{
  baseUrl: string;
  requests: Array<{ method?: string; range?: string }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ method?: string; range?: string }> = [];
  let failedGet = false;
  let closedFullGet = false;

  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      range: typeof req.headers.range === 'string' ? req.headers.range : undefined,
    });
    const total = input.archiveBytes.length;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/zip');

    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.setHeader('Content-Length', String(total));
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }

    if (input.failFirstGet && !failedGet) {
      failedGet = true;
      res.statusCode = 500;
      res.end('retry');
      return;
    }

    const rangeHeader = req.headers.range;
    const range = typeof rangeHeader === 'string'
      ? /^bytes=(\d+)-$/.exec(rangeHeader)
      : null;
    if (range) {
      const start = Number(range[1]);
      const chunk = input.archiveBytes.subarray(start);
      res.statusCode = 206;
      res.setHeader('Content-Length', String(chunk.length));
      res.setHeader('Content-Range', `bytes ${start}-${total - 1}/${total}`);
      res.end(chunk);
      return;
    }

    if (input.closeFirstFullGetAfterBytes && !closedFullGet) {
      closedFullGet = true;
      res.statusCode = 200;
      res.setHeader('Content-Length', String(total));
      res.write(input.archiveBytes.subarray(0, input.closeFirstFullGetAfterBytes));
      res.destroy();
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(total));
    res.end(input.archiveBytes);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start archive server.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
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

  test('reads bundled backend manifest and injects local archive URLs when available', async () => {
    const originalCwd = process.cwd();
    const originalFetch = global.fetch;
    const originalPlatform = process.platform;
    const projectRoot = createRuntimeRoot();
    const manifestDir = path.join(projectRoot, 'build', 'win-lite');
    const archiveDir = path.join(projectRoot, 'build', 'win-full');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultVersion: 'b9244',
        releaseBaseUrl: 'https://example.com/llamacpp/b9244',
        backends: [
          {
            version: 'b9244',
            backend: 'win-x64',
            platform: 'win32',
            arch: 'x64',
            accelerator: 'cpu',
            archive: { assetName: 'llama-b9244-bin-win-cpu-x64.zip' },
          },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(path.join(archiveDir, 'llama-b9244-bin-win-cpu-x64.zip'), 'zip');
    vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch should not be called');
    }) as typeof fetch);

    try {
      const manifest = await fetchLlamaCppBackendManifest({});

      expect(manifest.defaultVersion).toBe('b9244');
      expect(manifest.backends[0]?.archive?.url).toMatch(/^file:\/\//);
      expect(manifest.backends[0]?.archive?.url).toContain('llama-b9244-bin-win-cpu-x64.zip');
    } finally {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
      process.chdir(originalCwd);
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
    const originalPlatform = process.platform;
    const runtimeRoot = createRuntimeRoot();
    const manifest = buildFallbackManifest('b9505');
    const ref = toBackendRef('b9505', 'win-x64');
    writeInstalledBackend(runtimeRoot, ref.version, ref.backend, 'win32');
    syncCurrentBackend(runtimeRoot, ref);
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });

    try {
      const result = await listLlamaCppBackends({
        runtimeRoot,
        manifest,
        platform: 'win32',
        arch: 'x64',
        hasNvidiaGpu: false,
      });

      expect(result.selection?.versionBackend).toBe('b9505/win-x64');
      expect(readCurrentBackendRef(runtimeRoot)?.versionBackend).toBe('b9505/win-x64');
      expect(result.backends.find(backend => backend.versionBackend === 'b9505/win-x64')).toMatchObject({
        installed: true,
        current: true,
      });
    } finally {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
    }
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

  test('imports an extracted Windows backend directory and infers version/backend', async () => {
    const runtimeRoot = createRuntimeRoot();
    const sourceDir = path.join(runtimeRoot, 'llama-b9518');
    fs.mkdirSync(path.join(sourceDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'bin', 'llama-server.exe'), '');
    fs.writeFileSync(path.join(sourceDir, 'bin', 'ggml.dll'), '');

    const result = await importLlamaCppBackendPath({
      runtimeRoot,
      sourcePath: sourceDir,
      platform: 'win32',
      arch: 'x64',
      hasNvidiaGpu: false,
    });

    expect(result.success).toBe(true);
    expect(result.backend?.versionBackend).toBe('b9518/win-x64');
    expect(readCurrentBackendRef(runtimeRoot)?.versionBackend).toBe('b9518/win-x64');
    expect(fs.existsSync(getLlamaCppCurrentExecutablePath(runtimeRoot, 'win32'))).toBe(true);
  });

  test('installs backend from a bundled file archive URL', async () => {
    const runtimeRoot = createRuntimeRoot();
    const ref = toBackendRef('b9518', 'win-x64');
    const archivePath = path.join(runtimeRoot, 'llama-b9518-bin-win-cpu-x64.zip');
    await createBackendZipArchive(archivePath, [
      { name: 'build/bin/llama-server.exe', content: 'binary' },
      { name: 'build/bin/ggml.dll', content: 'dll' },
    ]);
    const archiveBytes = fs.readFileSync(archivePath);
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
          archive: {
            assetName: path.basename(archivePath),
            url: pathToFileURL(archivePath).href,
          },
        },
      ],
    };
    const progressEvents: any[] = [];

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
    expect(fs.existsSync(getLlamaCppCurrentExecutablePath(runtimeRoot, 'win32'))).toBe(true);
    expect(progressEvents.some(progress =>
      progress.phase === 'downloading-progress' &&
      progress.total === archiveBytes.length
    )).toBe(true);
  });

  test('reports real download progress for backend installation', async () => {
    const runtimeRoot = createRuntimeRoot();
    const ref = toBackendRef('b9518', 'win-x64');

    const archivePath = path.join(runtimeRoot, 'llama-b9518-bin-win-cpu-x64.zip');
    await createBackendZipArchive(archivePath, [
      { name: 'build/bin/llama-server.exe', content: 'binary' },
      { name: 'build/bin/ggml.dll', content: 'dll' },
    ]);
    const archiveBytes = fs.readFileSync(archivePath);
    fs.rmSync(archivePath, { force: true });

    const partialSize = Math.max(1, Math.floor(archiveBytes.length / 2));
    const server = await createArchiveServer({
      archiveBytes,
      failFirstGet: true,
    });
    const manifest = {
      schemaVersion: 1 as const,
      defaultVersion: 'b9518',
      releaseBaseUrl: server.baseUrl,
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

    const progressEvents: any[] = [];

    try {
      const originalMkdtempSync = fs.mkdtempSync;
      const installTempDir = originalMkdtempSync(path.join(os.tmpdir(), 'llamacpp-backend-resume-'));
      tempDirs.push(installTempDir);
      fs.writeFileSync(
        path.join(installTempDir, 'llama-b9518-bin-win-cpu-x64.zip'),
        archiveBytes.subarray(0, partialSize),
      );
      const mkdtempSpy = vi.spyOn(fs, 'mkdtempSync').mockImplementation((prefix, options) => {
        if (String(prefix).includes('llamacpp-backend-')) return installTempDir;
        return originalMkdtempSync(prefix, options);
      });
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
      mkdtempSpy.mockRestore();

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
      expect(server.requests.some(request => request.method === 'GET')).toBe(true);
      expect(server.requests.some(request => request.range === `bytes=${partialSize}-`)).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await server.close();
    }
  });
});
