import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { fetchMock, getPathMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getPathMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
}));

import { buildMacReplacementScript, downloadUpdate } from './appUpdateInstaller';

describe('downloadUpdate', () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-update-test-'));
    getPathMock.mockReturnValue(userDataDir);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('only returns a final installer after the manifest hash and size match', async () => {
    const body = Buffer.from('verified installer bytes');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    fetchMock.mockResolvedValue(
      new Response(null, {
        headers: {
          'content-length': String(body.length),
          'accept-ranges': 'bytes',
          etag: '"test-artifact"',
        },
      }),
    );

    const result = await downloadUpdate(
      'https://downloads.rongxzyai.com/releases/2026.7.31/test.exe',
      'auto',
      { size: body.length, sha256 },
      () => {},
      { createDownloader: createTestDownloader(body) },
    );

    expect(result.sha256).toBe(sha256);
    await expect(fs.promises.readFile(result.filePath)).resolves.toEqual(body);
    await expect(fs.promises.access(`${result.filePath}.download`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('removes the partial file and rejects when the manifest hash does not match', async () => {
    const body = Buffer.from('tampered installer bytes');
    fetchMock.mockResolvedValue(
      new Response(null, {
        headers: {
          'content-length': String(body.length),
          'accept-ranges': 'bytes',
          etag: '"test-artifact"',
        },
      }),
    );

    await expect(
      downloadUpdate(
        'https://downloads.rongxzyai.com/releases/2026.7.31/test.exe',
        'auto',
        { size: body.length, sha256: '0'.repeat(64) },
        () => {},
        { createDownloader: createTestDownloader(body) },
      ),
    ).rejects.toThrow('checksum verification failed');

    await expect(fs.promises.readdir(path.join(userDataDir, 'updates'))).resolves.toEqual([]);
  });
});

function createTestDownloader(body: Buffer) {
  return (_url: string, directory: string, options: { fileName: string }) => {
    const callbacks = new Map<string, ((value: any) => void)[]>();
    const outputPath = path.join(directory, options.fileName);
    return {
      on(event: string, callback: (value: any) => void) {
        callbacks.set(event, [...(callbacks.get(event) ?? []), callback]);
        return this;
      },
      getResumeState: () => ({ filePath: outputPath }),
      start: async () => {
        await fs.promises.writeFile(outputPath, body);
        for (const callback of callbacks.get('progress.throttled') ?? []) {
          callback({ downloaded: body.length, total: body.length, speed: body.length });
        }
        return true;
      },
      resumeFromFile: async () => true,
      pause: async () => true,
      resume: async () => true,
      stop: async () => true,
    };
  };
}

describe('unattended installation handoff', () => {
  test('macOS waits for exit, atomically swaps the staged bundle, and keeps a rollback path', () => {
    const script = buildMacReplacementScript({
      appPid: 1234,
      backupApp: '/Applications/.ZhiYuan.app.backup',
      failedApp: '/Applications/.ZhiYuan.app.failed',
      stagedApp: '/Applications/.ZhiYuan.app.update',
      targetApp: '/Applications/ZhiYuan.app',
    });

    expect(script.indexOf('while kill -0 1234')).toBeLessThan(
      script.indexOf('mv "$TARGET" "$BACKUP"'),
    );
    expect(script).toContain('if mv "$STAGED" "$TARGET"; then');
    expect(script).toContain('mv "$BACKUP" "$TARGET" || true');
    expect(script).not.toContain('rm -rf "$TARGET"');
  });

  test('Windows update launches the branded NSIS wizard instead of a silent installer', async () => {
    const updaterSource = await fs.promises.readFile(
      path.resolve(process.cwd(), 'src/main/libs/appUpdateInstaller.ts'),
      'utf8',
    );

    expect(updaterSource).toContain('Launching interactive installer: $installerPath');
    expect(updaterSource).toContain('Start-Process -FilePath $installerPath -Wait -PassThru');
    expect(updaterSource).not.toContain("-ArgumentList '/S'");
    expect(updaterSource).toContain(
      'Existing app relaunched after installer cancellation or failure',
    );
  });

  test('NSIS silent mode defers local signing without implicit approval', async () => {
    const nsisSource = await fs.promises.readFile(
      path.resolve(process.cwd(), 'scripts/nsis-installer.nsh'),
      'utf8',
    );

    expect(nsisSource).toContain('IfSilent LlamaCppBackendInstallDeferred 0');
    expect(nsisSource).toContain(
      'phase=llamacpp-backend-install-skipped reason=silent-no-local-signing-confirmation',
    );
    expect(nsisSource).not.toContain('IfSilent LlamaCppBackendLocalSigningConfirmed 0');
  });
});
