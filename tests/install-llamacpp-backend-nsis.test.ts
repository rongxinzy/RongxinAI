import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, test } from 'vitest';

import {
  ArchiveSource,
  BackendId,
  buildInstallPlan,
  ExitCode,
  installBackendFromPlan,
  RuntimeArch,
  RuntimeBuildInfoSource,
  RuntimePlatform,
  SelectionReason,
  selectRecommendedBackend,
  WindowsSignatureStatus,
} from '../scripts/install-llamacpp-backend-nsis.cjs';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Windows can keep short-lived handles open after downloader tests.
    }
  }
});

const HttpMethod = {
  Get: 'GET',
  Head: 'HEAD',
} as const;

const HttpStatus = {
  Ok: 200,
  PartialContent: 206,
  NotFound: 404,
  MethodNotAllowed: 405,
  InternalServerError: 500,
} as const;

const HttpHeader = {
  AcceptRanges: 'Accept-Ranges',
  Connection: 'Connection',
  ContentLength: 'Content-Length',
  ContentRange: 'Content-Range',
  ContentType: 'Content-Type',
} as const;

const manifest = {
  schemaVersion: 1,
  defaultVersion: 'b9244',
  releaseBaseUrl: 'https://example.test/llamacpp/b9244',
  backends: [
    {
      version: 'b9244',
      backend: BackendId.WinArm64,
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.Arm64,
      accelerator: 'cpu',
      archive: {
        assetName: 'llama-b9244-bin-win-cpu-arm64.zip',
        sha256: 'arm64',
      },
    },
    {
      version: 'b9244',
      backend: BackendId.WinX64,
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      accelerator: 'cpu',
      archive: {
        assetName: 'llama-b9244-bin-win-cpu-x64.zip',
        sha256: 'x64',
      },
    },
    {
      version: 'b9244',
      backend: BackendId.WinX64Cuda12,
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      accelerator: 'cuda',
      cudaMajor: '12',
      archive: {
        assetName: 'llama-b9244-bin-win-cuda-12.4-x64.zip',
        sha256: 'cuda12',
      },
    },
  ],
};

describe('install-llamacpp-backend-nsis backend selection', () => {
  test('selects arm64 CPU backend for Windows arm64', () => {
    const result = selectRecommendedBackend(manifest, {
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.Arm64,
      hasNvidiaGpu: true,
    });

    expect(result.reason).toBe(SelectionReason.WindowsArm64Cpu);
    expect(result.entry?.backend).toBe(BackendId.WinArm64);
  });

  test('selects x64 CPU backend when no NVIDIA GPU is detected', () => {
    const result = selectRecommendedBackend(manifest, {
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      hasNvidiaGpu: false,
    });

    expect(result.reason).toBe(SelectionReason.WindowsX64Cpu);
    expect(result.entry?.backend).toBe(BackendId.WinX64);
  });

  test('selects CUDA 12 backend when NVIDIA GPU is detected on Windows x64', () => {
    const result = selectRecommendedBackend(manifest, {
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      hasNvidiaGpu: true,
    });

    expect(result.reason).toBe(SelectionReason.WindowsX64Cuda);
    expect(result.entry?.backend).toBe(BackendId.WinX64Cuda12);
  });

  test('falls back to x64 CPU backend when manifest has no CUDA backend', () => {
    const cpuOnlyManifest = {
      ...manifest,
      backends: manifest.backends.filter(entry => entry.accelerator !== 'cuda'),
    };

    const result = selectRecommendedBackend(cpuOnlyManifest, {
      platform: 'win32',
      arch: RuntimeArch.X64,
      hasNvidiaGpu: true,
    });

    expect(result.reason).toBe(SelectionReason.WindowsX64Cpu);
    expect(result.entry?.backend).toBe(BackendId.WinX64);
  });

  test('rejects unsupported platform and architecture', () => {
    const result = selectRecommendedBackend(manifest, {
      platform: 'linux',
      arch: 'x64',
      hasNvidiaGpu: true,
    });

    expect(result.entry).toBeNull();
    expect(result.reason).toBe(SelectionReason.UnsupportedRuntime);
  });
});

describe('install-llamacpp-backend-nsis dry-run plan', () => {
  test('builds a remote download dry-run plan for win-lite resources', () => {
    const plan = buildInstallPlan({
      manifest,
      resourcesDir: path.resolve('build/win-lite'),
      appDataDir: path.resolve('tmp/test-appdata'),
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      hasNvidiaGpu: false,
    });

    expect(plan.success).toBe(true);
    expect(plan.exitCode).toBe(ExitCode.Success);
    expect(plan.backend.versionBackend).toBe('b9244/win-x64');
    expect(plan.archive.source).toBe(ArchiveSource.Remote);
    expect(plan.archive.requiresDownload).toBe(true);
    expect(plan.archive.url).toBe('https://example.test/llamacpp/b9244/llama-b9244-bin-win-cpu-x64.zip');
    expect(plan.runtimeRoot).toContain('llamacpp-runtime');
  });

  test('returns a non-zero plan for unsupported runtime', () => {
    const plan = buildInstallPlan({
      manifest,
      resourcesDir: path.resolve('build/win-lite'),
      appDataDir: path.resolve('tmp/test-appdata'),
      platform: RuntimePlatform.Windows,
      arch: 'ia32',
      hasNvidiaGpu: false,
    });

    expect(plan.success).toBe(false);
    expect(plan.exitCode).toBe(ExitCode.UnsupportedRuntime);
  });
});

describe('install-llamacpp-backend-nsis local win-full install', () => {
  test('installs a local backend archive and points current to it', async () => {
    const tempDir = createTempDir();
    const resourcesDir = path.join(tempDir, 'resources');
    const appDataDir = path.join(tempDir, 'appdata');
    fs.mkdirSync(resourcesDir, { recursive: true });

    const archiveName = 'llama-b9244-bin-win-cpu-x64.zip';
    const archivePath = path.join(resourcesDir, archiveName);
    const sha256 = await writeTestBackendZip(archivePath);
    const localManifest = {
      ...manifest,
      backends: manifest.backends.map(entry =>
        entry.backend === BackendId.WinX64
          ? {
              ...entry,
              archive: {
                assetName: archiveName,
                sha256,
              },
            }
          : entry
      ),
    };
    fs.writeFileSync(
      path.join(resourcesDir, 'manifest.json'),
      `${JSON.stringify(localManifest, null, 2)}\n`,
      'utf8',
    );

    const plan = buildInstallPlan({
      resourcesDir,
      appDataDir,
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      hasNvidiaGpu: false,
    });
    expect(plan.archive.source).toBe(ArchiveSource.Local);

    const result = await installBackendFromPlan(plan, {
      localSigningStatusProvider: () => WindowsSignatureStatus.Valid,
      logPath: path.join(appDataDir, 'install-llamacpp.log'),
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(ExitCode.Success);
    const installedExe = path.join(
      appDataDir,
      'llamacpp-runtime',
      'backends',
      'b9244',
      BackendId.WinX64,
      'build',
      'bin',
      'llama-server.exe',
    );
    expect(fs.existsSync(installedExe)).toBe(true);
    expect(fs.readFileSync(installedExe, 'utf8')).toBe('test server');

    const buildInfoPath = path.join(
      path.dirname(path.dirname(path.dirname(installedExe))),
      'runtime-build-info.json',
    );
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    expect(buildInfo.source).toBe(RuntimeBuildInfoSource.NsisWinFull);
    expect(buildInfo.versionBackend).toBe(`b9244/${BackendId.WinX64}`);
    expect(buildInfo.archiveSha256).toBe(sha256);

    const currentPath = path.join(appDataDir, 'llamacpp-runtime', 'current');
    expect(fs.lstatSync(currentPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(currentPath, 'build', 'bin', 'llama-server.exe'))).toBe(true);
  });

  test('requires confirmation before signing unsigned Windows runtime files', async () => {
    const tempDir = createTempDir();
    const resourcesDir = path.join(tempDir, 'resources');
    const appDataDir = path.join(tempDir, 'appdata');
    fs.mkdirSync(resourcesDir, { recursive: true });

    const archiveName = 'llama-b9244-bin-win-cpu-x64.zip';
    const archivePath = path.join(resourcesDir, archiveName);
    const sha256 = await writeTestBackendZip(archivePath);
    writeManifest(resourcesDir, createLocalManifest(archiveName, sha256));

    const plan = buildInstallPlan({
      resourcesDir,
      appDataDir,
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      hasNvidiaGpu: false,
    });

    const result = await installBackendFromPlan(plan, {
      localSigningStatusProvider: () => WindowsSignatureStatus.NotSigned,
      logPath: path.join(appDataDir, 'install-llamacpp.log'),
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(ExitCode.LocalSigningConfirmationRequired);
    expect(fs.existsSync(path.join(appDataDir, 'llamacpp-runtime', 'current'))).toBe(false);
  });

  test('signs only unsigned Windows runtime files after confirmation', async () => {
    const tempDir = createTempDir();
    const resourcesDir = path.join(tempDir, 'resources');
    const appDataDir = path.join(tempDir, 'appdata');
    fs.mkdirSync(resourcesDir, { recursive: true });

    const archiveName = 'llama-b9244-bin-win-cpu-x64.zip';
    const archivePath = path.join(resourcesDir, archiveName);
    const sha256 = await writeTestBackendZip(archivePath);
    writeManifest(resourcesDir, createLocalManifest(archiveName, sha256));
    const signedFiles: string[] = [];

    const plan = buildInstallPlan({
      resourcesDir,
      appDataDir,
      platform: RuntimePlatform.Windows,
      arch: RuntimeArch.X64,
      hasNvidiaGpu: false,
    });

    const result = await installBackendFromPlan(plan, {
      localSigningCertificateProvider: () => 'test-thumbprint',
      localSigningConfirmed: true,
      localSigningFileSigner: (filePath: string, thumbprint: string) => {
        expect(thumbprint).toBe('test-thumbprint');
        signedFiles.push(path.basename(filePath));
        return WindowsSignatureStatus.Valid;
      },
      localSigningStatusProvider: () => WindowsSignatureStatus.NotSigned,
      logPath: path.join(appDataDir, 'install-llamacpp.log'),
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(signedFiles.sort()).toEqual(['ggml.dll', 'llama-server.exe']);
    expect(
      fs.existsSync(path.join(appDataDir, 'llamacpp-runtime', 'current', 'build', 'bin', 'llama-server.exe')),
    ).toBe(true);
  });
});

describe('install-llamacpp-backend-nsis remote win-lite install', () => {
  test('downloads and installs only the recommended remote backend archive', async () => {
    const tempDir = createTempDir();
    const resourcesDir = path.join(tempDir, 'resources');
    const appDataDir = path.join(tempDir, 'appdata');
    fs.mkdirSync(resourcesDir, { recursive: true });

    const archiveName = 'llama-b9244-bin-win-cpu-x64.zip';
    const archiveBytes = await createTestBackendZipBuffer();
    const sha256 = createSha256(archiveBytes);
    const server = await startArchiveServer({ archiveName, archiveBytes });

    try {
      writeManifest(resourcesDir, createRemoteManifest(server.baseUrl, archiveName, sha256));
      const plan = buildInstallPlan({
        resourcesDir,
        appDataDir,
        platform: RuntimePlatform.Windows,
        arch: RuntimeArch.X64,
        hasNvidiaGpu: false,
      });
      expect(plan.archive.source).toBe(ArchiveSource.Remote);
      expect(plan.archive.assetName).toBe(archiveName);

      const result = await installBackendFromPlan(plan, {
        localSigningStatusProvider: () => WindowsSignatureStatus.Valid,
        logPath: path.join(appDataDir, 'install-llamacpp.log'),
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(ExitCode.Success);
      const installedExe = path.join(
        appDataDir,
        'llamacpp-runtime',
        'current',
        'build',
        'bin',
        'llama-server.exe',
      );
      expect(fs.existsSync(installedExe)).toBe(true);

      const buildInfoPath = path.join(
        appDataDir,
        'llamacpp-runtime',
        'backends',
        'b9244',
        BackendId.WinX64,
        'runtime-build-info.json',
      );
      const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
      expect(buildInfo.source).toBe(RuntimeBuildInfoSource.NsisWinLite);
      expect(buildInfo.archiveSha256).toBe(sha256);
      expect(buildInfo.archiveUrl).toBe(`${server.baseUrl}/${archiveName}`);

      const downloadedArchivePath = path.join(appDataDir, 'llamacpp-runtime', 'downloads', archiveName);
      expect(fs.existsSync(downloadedArchivePath)).toBe(true);
      expect(createSha256(fs.readFileSync(downloadedArchivePath))).toBe(sha256);
      const archiveRequests = server.requests.filter(request => request.url?.endsWith(archiveName));
      expect(archiveRequests.length).toBeGreaterThan(0);
      expect(server.requests.every(request => request.url?.endsWith(archiveName))).toBe(true);
    } finally {
      await server.close();
    }
  });

  test('retries after an HTTP failure and resumes an existing partial archive', async () => {
    const tempDir = createTempDir();
    const resourcesDir = path.join(tempDir, 'resources');
    const appDataDir = path.join(tempDir, 'appdata');
    const downloadsDir = path.join(appDataDir, 'llamacpp-runtime', 'downloads');
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    const archiveName = 'llama-b9244-bin-win-cpu-x64.zip';
    const archiveBytes = await createTestBackendZipBuffer();
    const sha256 = createSha256(archiveBytes);
    const partialSize = Math.floor(archiveBytes.length / 2);
    fs.writeFileSync(path.join(downloadsDir, archiveName), archiveBytes.subarray(0, partialSize));
    const server = await startArchiveServer({ archiveName, archiveBytes, failFirstGet: true });

    try {
      writeManifest(resourcesDir, createRemoteManifest(server.baseUrl, archiveName, sha256));
      const plan = buildInstallPlan({
        resourcesDir,
        appDataDir,
        platform: RuntimePlatform.Windows,
        arch: RuntimeArch.X64,
        hasNvidiaGpu: false,
      });

      const result = await installBackendFromPlan(plan, {
        localSigningStatusProvider: () => WindowsSignatureStatus.Valid,
        logPath: path.join(appDataDir, 'install-llamacpp.log'),
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(server.requests.filter(request => request.method === HttpMethod.Get).length).toBeGreaterThanOrEqual(2);
      expect(server.requests.some(request => request.range === `bytes=${partialSize}-`)).toBe(true);
      expect(createSha256(fs.readFileSync(path.join(downloadsDir, archiveName)))).toBe(sha256);
    } finally {
      await server.close();
    }
  });

  test('returns a download failure after automatic retries are exhausted', async () => {
    const tempDir = createTempDir();
    const resourcesDir = path.join(tempDir, 'resources');
    const appDataDir = path.join(tempDir, 'appdata');
    fs.mkdirSync(resourcesDir, { recursive: true });

    const archiveName = 'llama-b9244-bin-win-cpu-x64.zip';
    const archiveBytes = await createTestBackendZipBuffer();
    const sha256 = createSha256(archiveBytes);
    const server = await startArchiveServer({ archiveName, archiveBytes, alwaysFail: true });

    try {
      writeManifest(resourcesDir, createRemoteManifest(server.baseUrl, archiveName, sha256));
      const plan = buildInstallPlan({
        resourcesDir,
        appDataDir,
        platform: RuntimePlatform.Windows,
        arch: RuntimeArch.X64,
        hasNvidiaGpu: false,
      });

      const result = await installBackendFromPlan(plan, {
        logPath: path.join(appDataDir, 'install-llamacpp.log'),
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(ExitCode.DownloadFailed);
      expect(result.error).toContain('Please check network, proxy, or firewall settings.');
      expect(server.requests.filter(request => request.method === HttpMethod.Get).length).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }
  });
});

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-nsis-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

async function writeTestBackendZip(archivePath: string): Promise<string> {
  const buffer = await createTestBackendZipBuffer();
  fs.writeFileSync(archivePath, buffer);
  return createSha256(buffer);
}

async function createTestBackendZipBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('llama-b9244-bin-win-cpu-x64/llama-server.exe', 'test server');
  zip.file('llama-b9244-bin-win-cpu-x64/ggml.dll', 'test dll');
  return zip.generateAsync({ type: 'nodebuffer' });
}

function createSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function writeManifest(resourcesDir: string, value: typeof manifest): void {
  fs.writeFileSync(
    path.join(resourcesDir, 'manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function createLocalManifest(archiveName: string, sha256: string): typeof manifest {
  return {
    ...manifest,
    backends: manifest.backends.map(entry =>
      entry.backend === BackendId.WinX64
        ? {
            ...entry,
            archive: {
              assetName: archiveName,
              sha256,
            },
          }
        : entry
    ),
  };
}

function createRemoteManifest(releaseBaseUrl: string, archiveName: string, sha256: string): typeof manifest {
  return {
    ...manifest,
    releaseBaseUrl,
    backends: manifest.backends.map(entry =>
      entry.backend === BackendId.WinX64
        ? {
            ...entry,
            archive: {
              assetName: archiveName,
              sha256,
            },
          }
        : entry
    ),
  };
}

type ArchiveServer = {
  baseUrl: string;
  requests: Array<{
    method: string | undefined;
    range: string | undefined;
    url: string | undefined;
  }>;
  close: () => Promise<void>;
};

async function startArchiveServer(input: {
  archiveName: string;
  archiveBytes: Buffer;
  failFirstGet?: boolean;
  alwaysFail?: boolean;
}): Promise<ArchiveServer> {
  const requests: ArchiveServer['requests'] = [];
  let getCount = 0;
  const server = http.createServer((request, response) => {
    const range = Array.isArray(request.headers.range) ? request.headers.range[0] : request.headers.range;
    requests.push({ method: request.method, range, url: request.url });

    if (!request.url?.endsWith(input.archiveName)) {
      response.statusCode = HttpStatus.NotFound;
      response.setHeader(HttpHeader.Connection, 'close');
      response.end();
      return;
    }

    if (request.method === HttpMethod.Head) {
      writeArchiveHeaders(response, input.archiveBytes.length);
      response.statusCode = HttpStatus.Ok;
      response.end();
      return;
    }

    if (request.method !== HttpMethod.Get) {
      response.statusCode = HttpStatus.MethodNotAllowed;
      response.setHeader(HttpHeader.Connection, 'close');
      response.end();
      return;
    }

    getCount += 1;
    if (input.alwaysFail || (input.failFirstGet && getCount === 1)) {
      response.statusCode = HttpStatus.InternalServerError;
      response.setHeader(HttpHeader.Connection, 'close');
      response.end('retry');
      return;
    }

    const rangeStart = parseRangeStart(range);
    if (typeof rangeStart === 'number') {
      const safeStart = Math.min(rangeStart, input.archiveBytes.length);
      const body = input.archiveBytes.subarray(safeStart);
      response.statusCode = HttpStatus.PartialContent;
      response.setHeader(HttpHeader.AcceptRanges, 'bytes');
      response.setHeader(HttpHeader.Connection, 'close');
      response.setHeader(HttpHeader.ContentLength, String(body.length));
      response.setHeader(
        HttpHeader.ContentRange,
        `bytes ${safeStart}-${input.archiveBytes.length - 1}/${input.archiveBytes.length}`,
      );
      response.end(body);
      return;
    }

    writeArchiveHeaders(response, input.archiveBytes.length);
    response.statusCode = HttpStatus.Ok;
    response.end(input.archiveBytes);
  });
  const sockets = new Set<Socket>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
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
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error('HTTP archive server did not expose a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close(error => (error ? reject(error) : resolve()));
    }),
  };
}

function writeArchiveHeaders(response: http.ServerResponse, length: number): void {
  response.setHeader(HttpHeader.AcceptRanges, 'bytes');
  response.setHeader(HttpHeader.Connection, 'close');
  response.setHeader(HttpHeader.ContentLength, String(length));
  response.setHeader(HttpHeader.ContentType, 'application/zip');
}

function parseRangeStart(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const match = /^bytes=(\d+)-$/.exec(range);
  return match ? Number(match[1]) : undefined;
}
