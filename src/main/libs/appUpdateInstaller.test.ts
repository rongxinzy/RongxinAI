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
  session: { defaultSession: { fetch: fetchMock } },
}));

import { buildMacReplacementScript, downloadUpdate } from './appUpdateInstaller';

describe('downloadUpdate', () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-update-test-'));
    getPathMock.mockReturnValue(userDataDir);
  });

  afterEach(async () => {
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  test('only returns a final installer after the manifest hash and size match', async () => {
    const body = Buffer.from('verified installer bytes');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    fetchMock.mockResolvedValue(
      new Response(body, {
        headers: { 'content-length': String(body.length) },
      }),
    );

    const result = await downloadUpdate(
      'https://downloads.rongxzyai.com/releases/2026.7.31/test.exe',
      'auto',
      { size: body.length, sha256 },
      () => {},
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
      new Response(body, {
        headers: { 'content-length': String(body.length) },
      }),
    );

    await expect(
      downloadUpdate(
        'https://downloads.rongxzyai.com/releases/2026.7.31/test.exe',
        'auto',
        { size: body.length, sha256: '0'.repeat(64) },
        () => {},
      ),
    ).rejects.toThrow('checksum verification failed');

    await expect(fs.promises.readdir(path.join(userDataDir, 'updates'))).resolves.toEqual([]);
  });
});

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

  test('NSIS silent mode bypasses the local-signing confirmation dialog', async () => {
    const nsisSource = await fs.promises.readFile(
      path.resolve(process.cwd(), 'scripts/nsis-installer.nsh'),
      'utf8',
    );
    const confirmationBlock = nsisSource.slice(
      nsisSource.indexOf('LlamaCppBackendLocalSigningConfirmationRequired:'),
      nsisSource.indexOf('LlamaCppBackendLocalSigningConfirmed:'),
    );

    expect(confirmationBlock).toContain('IfSilent LlamaCppBackendLocalSigningConfirmed 0');
    expect(confirmationBlock.indexOf('IfSilent')).toBeLessThan(
      confirmationBlock.indexOf('    MessageBox'),
    );
  });
});
