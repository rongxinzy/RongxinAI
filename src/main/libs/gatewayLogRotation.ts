import fs from 'fs';
import path from 'path';

export const GATEWAY_LOG_RETENTION_DAYS = 3;
export const GATEWAY_LOG_PREFIX = 'gateway';
export const GATEWAY_LOG_SUFFIX = '.log';
export const LEGACY_GATEWAY_LOG_FILE_NAME = 'gateway.log';

const GATEWAY_DAILY_LOG_RE = /^gateway-\d{4}-\d{2}-\d{2}\.log$/;

export type GatewayLogEntry = {
  archiveName: string;
  filePath: string;
};

export function formatGatewayLogDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getGatewayLogPath(logsDir: string, date = new Date()): string {
  return path.join(
    logsDir,
    `${GATEWAY_LOG_PREFIX}-${formatGatewayLogDateKey(date)}${GATEWAY_LOG_SUFFIX}`,
  );
}

export function getRecentGatewayLogEntries(logsDir: string, now = new Date()): GatewayLogEntry[] {
  if (!fs.existsSync(logsDir)) return [];

  const cutoffMs = now.getTime() - GATEWAY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return fs
    .readdirSync(logsDir)
    .filter(fileName => GATEWAY_DAILY_LOG_RE.test(fileName))
    .map(fileName => ({ archiveName: fileName, filePath: path.join(logsDir, fileName) }))
    .filter(({ filePath }) => {
      try {
        return fs.statSync(filePath).mtimeMs >= cutoffMs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName));
}

export function pruneGatewayLogs(logsDir: string, now = new Date()): void {
  if (!fs.existsSync(logsDir)) return;

  const cutoffMs = now.getTime() - GATEWAY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const fileName of fs.readdirSync(logsDir)) {
    const isLegacyGatewayLog = fileName === LEGACY_GATEWAY_LOG_FILE_NAME;
    const isExpiredDailyGatewayLog =
      GATEWAY_DAILY_LOG_RE.test(fileName) &&
      isFileOlderThan(path.join(logsDir, fileName), cutoffMs);

    if (!isLegacyGatewayLog && !isExpiredDailyGatewayLog) continue;

    try {
      fs.unlinkSync(path.join(logsDir, fileName));
    } catch {
      // Best effort cleanup only.
    }
  }
}

function isFileOlderThan(filePath: string, cutoffMs: number): boolean {
  try {
    return fs.statSync(filePath).mtimeMs < cutoffMs;
  } catch {
    return false;
  }
}
