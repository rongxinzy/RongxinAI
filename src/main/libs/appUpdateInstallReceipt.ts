import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { lt, valid } from 'semver';

import {
  AppUpdateInstallOutcome,
  type AppUpdateInstallResult,
} from '../../shared/appUpdate/constants';

const RECEIPT_FILENAME = 'app-update-install-result.json';
const RECEIPT_MAX_BYTES = 4096;
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type AppUpdateInstallReceipt = {
  schemaVersion: 1;
  attemptId: string;
  targetVersion: string;
  status: 'pending' | 'succeeded' | 'failed';
  detail: string | null;
  recordedAt: number;
};

export function appUpdateInstallReceiptPath(): string {
  return path.join(app.getPath('userData'), RECEIPT_FILENAME);
}

export async function writePendingInstallReceipt(receipt: AppUpdateInstallReceipt): Promise<void> {
  const receiptPath = appUpdateInstallReceiptPath();
  const temporaryPath = `${receiptPath}.${receipt.attemptId}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  await fs.promises.rename(temporaryPath, receiptPath);
}

export function readInstallResult(currentVersion: string): AppUpdateInstallResult | null {
  try {
    const receiptPath = appUpdateInstallReceiptPath();
    const stat = fs.statSync(receiptPath);
    if (!stat.isFile() || stat.size > RECEIPT_MAX_BYTES) return null;
    const receipt: unknown = JSON.parse(
      fs.readFileSync(receiptPath, 'utf8').replace(/^\uFEFF/, ''),
    );
    if (!receipt || typeof receipt !== 'object') return null;
    const data = receipt as Partial<AppUpdateInstallReceipt>;
    if (
      data.schemaVersion !== 1 ||
      typeof data.attemptId !== 'string' ||
      typeof data.targetVersion !== 'string' ||
      !valid(data.targetVersion) ||
      typeof data.recordedAt !== 'number' ||
      !Number.isFinite(data.recordedAt) ||
      Date.now() - data.recordedAt > RECEIPT_MAX_AGE_MS ||
      data.recordedAt > Date.now() + 60_000
    )
      return null;
    if (
      data.status !== AppUpdateInstallOutcome.Pending &&
      data.status !== AppUpdateInstallOutcome.Succeeded &&
      data.status !== AppUpdateInstallOutcome.Failed
    )
      return null;
    const succeeded = valid(currentVersion) && !lt(currentVersion, data.targetVersion);
    const outcome = succeeded
      ? AppUpdateInstallOutcome.Succeeded
      : data.status === AppUpdateInstallOutcome.Failed ||
          data.status === AppUpdateInstallOutcome.Succeeded ||
          (data.status === AppUpdateInstallOutcome.Pending &&
            Date.now() - data.recordedAt > 5 * 60_000)
        ? AppUpdateInstallOutcome.Failed
        : AppUpdateInstallOutcome.Pending;
    return {
      outcome,
      targetVersion: data.targetVersion,
      detail:
        outcome === AppUpdateInstallOutcome.Failed
          ? typeof data.detail === 'string'
            ? data.detail.slice(0, 500)
            : 'The previous version is still running'
          : null,
      recordedAt: data.recordedAt,
    };
  } catch {
    return null;
  }
}
