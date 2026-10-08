import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

const appPath = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => appPath.userData } }));

import { AppUpdateInstallOutcome } from '../../shared/appUpdate/constants';
import {
  appUpdateInstallReceiptPath,
  readInstallResult,
  writePendingInstallReceipt,
} from './appUpdateInstallReceipt';

afterEach(async () => {
  if (appPath.userData) await fs.promises.rm(appPath.userData, { recursive: true, force: true });
});

test('reports an installer failure on the old version and success only after the target version boots', async () => {
  appPath.userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'update-receipt-'));
  const receipt = {
    schemaVersion: 1 as const,
    attemptId: 'attempt-1',
    targetVersion: '2026.7.2',
    status: 'pending' as const,
    detail: null,
    recordedAt: Date.now(),
  };
  await writePendingInstallReceipt(receipt);
  expect(readInstallResult('2026.7.1')?.outcome).toBe(AppUpdateInstallOutcome.Pending);
  await fs.promises.writeFile(
    appUpdateInstallReceiptPath(),
    JSON.stringify({
      ...receipt,
      status: 'failed',
      detail: 'Installer exited with code 1',
    }),
  );
  expect(readInstallResult('2026.7.1')).toMatchObject({
    outcome: AppUpdateInstallOutcome.Failed,
    detail: 'Installer exited with code 1',
  });
  expect(readInstallResult('2026.7.2')?.outcome).toBe(AppUpdateInstallOutcome.Succeeded);
});
