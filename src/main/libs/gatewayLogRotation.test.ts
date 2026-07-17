import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import {
  GATEWAY_LOG_RETENTION_DAYS,
  getGatewayLogPath,
  getRecentGatewayLogEntries,
  pruneGatewayLogs,
} from './gatewayLogRotation';

const tempDirs: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-gateway-log-'));
  tempDirs.push(dir);
  return dir;
}

function writeLogFile(dir: string, fileName: string, mtimeMs: number): void {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, `${fileName}\n`);
  const date = new Date(mtimeMs);
  fs.utimesSync(filePath, date, date);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGatewayLogPath uses the local calendar date', () => {
  const dir = makeTempDir();
  const date = new Date(2026, 4, 6, 10, 30, 0);

  expect(getGatewayLogPath(dir, date)).toBe(path.join(dir, 'gateway-2026-05-06.log'));
});

test('pruneGatewayLogs deletes the legacy gateway.log file', () => {
  const dir = makeTempDir();
  const now = new Date(2026, 4, 6, 10, 0, 0);
  writeLogFile(dir, 'gateway.log', now.getTime());
  writeLogFile(dir, 'gateway-2026-05-06.log', now.getTime());

  pruneGatewayLogs(dir, now);

  expect(fs.existsSync(path.join(dir, 'gateway.log'))).toBe(false);
  expect(fs.existsSync(path.join(dir, 'gateway-2026-05-06.log'))).toBe(true);
});

test('pruneGatewayLogs deletes daily gateway logs older than retention', () => {
  const dir = makeTempDir();
  const now = new Date(2026, 4, 6, 10, 0, 0);
  const cutoffMs = now.getTime() - GATEWAY_LOG_RETENTION_DAYS * DAY_MS;
  writeLogFile(dir, 'gateway-2026-05-03.log', cutoffMs);
  writeLogFile(dir, 'gateway-2026-05-02.log', cutoffMs - 1);
  writeLogFile(dir, 'main-2026-05-02.log', cutoffMs - 1);

  pruneGatewayLogs(dir, now);

  expect(fs.existsSync(path.join(dir, 'gateway-2026-05-03.log'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'gateway-2026-05-02.log'))).toBe(false);
  expect(fs.existsSync(path.join(dir, 'main-2026-05-02.log'))).toBe(true);
});

test('getRecentGatewayLogEntries returns retained daily logs in name order', () => {
  const dir = makeTempDir();
  const now = new Date(2026, 4, 6, 10, 0, 0);
  const cutoffMs = now.getTime() - GATEWAY_LOG_RETENTION_DAYS * DAY_MS;
  writeLogFile(dir, 'gateway-2026-05-06.log', now.getTime());
  writeLogFile(dir, 'gateway-2026-05-04.log', now.getTime() - 2 * DAY_MS);
  writeLogFile(dir, 'gateway-2026-05-02.log', cutoffMs - 1);
  writeLogFile(dir, 'gateway.log', now.getTime());

  expect(getRecentGatewayLogEntries(dir, now).map(entry => entry.archiveName)).toEqual([
    'gateway-2026-05-04.log',
    'gateway-2026-05-06.log',
  ]);
});
