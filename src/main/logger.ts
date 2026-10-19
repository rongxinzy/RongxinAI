/**
 * Robust, production-grade Logger module using electron-log.
 * Intercepts console.* methods and writes to file + console simultaneously.
 *
 * Log file locations:
 *   macOS:   ~/Library/Logs/ZhiYuanAgent/main[-dev]-YYYY-MM-DD.log
 *   Windows: %USERPROFILE%\AppData\Roaming\ZhiYuanAgent\logs\main[-dev]-YYYY-MM-DD.log
 *   Linux:   ~/.config/ZhiYuanAgent/logs/main[-dev]-YYYY-MM-DD.log
 *
 * Key Capabilities:
 *   - Production level defaults to 'info' to avoid log-volume explosion; configurable via ZHIYUAN_LOG_LEVEL.
 *   - Comprehensive environment & hardware banner on startup (CPU, RAM, OS build, App version).
 *   - Post-ready GPU hardware acceleration logging.
 *   - Cause-chain and network-error property extraction for Error objects.
 *   - Noise throttle / filter for repetitive high-frequency background worker jobs.
 *   - Daily log files with 7-day retention and automatic pruning.
 */

import { app } from 'electron';
import log from 'electron-log/main';
import fs from 'fs';
import path from 'path';

import { formatLogArguments } from './diagnostics/errorFormatting';
import {
  formatStartupLogBanner,
  getSynchronousSystemInfo,
  getSystemDiagnosticsSnapshot,
} from './diagnostics/systemDiagnostics';

const LOG_RETENTION_DAYS = 7;
const LOG_MAX_SIZE = 80 * 1024 * 1024; // 80 MB
const LOG_BASENAME = app.isPackaged ? 'main' : 'main-dev';
const LOG_FILE_RE = /^main(-dev)?-\d{4}-\d{2}-\d{2}(\.old)?\.log$/;

/** Captured on first resolvePathFn call; used for pruning and export. */
let _logDir: string | undefined;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logDir(): string {
  return _logDir ?? path.dirname(log.transports.file.getFile().path);
}

/** Check if a log entry matches high-frequency spam that should be suppressed in production. */
function isHighFrequencyNoise(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = String(args[0]);
  // Suppress high-frequency worker pool transform text completion in default production logs
  if (first.includes('[WorkbenchArtifacts] completed transform-text')) {
    return true;
  }
  return false;
}

/**
 * Initialize logging system.
 * Must be called early in main process, before any console output.
 */
export function initLogger(): void {
  // Daily rotation: one file per calendar day
  log.transports.file.resolvePathFn = vars => {
    _logDir = vars.libraryDefaultDir;
    return path.join(vars.libraryDefaultDir, `${LOG_BASENAME}-${todayStr()}.log`);
  };

  // Determine file transport log level
  const envLevel = process.env.ZHIYUAN_LOG_LEVEL?.toLowerCase();
  const validLevels = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'];
  const defaultFileLevel = app.isPackaged ? 'info' : 'debug';
  const activeFileLevel = envLevel && validLevels.includes(envLevel) ? envLevel : defaultFileLevel;

  // File transport config
  log.transports.file.level = activeFileLevel as unknown as false;
  log.transports.file.maxSize = LOG_MAX_SIZE;
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // Console transport config
  log.transports.console.level = 'debug';
  log.transports.console.format = '{text}';

  // Intercept console.* methods so all existing console calls are captured.
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args);
    log.info(...args);
  };
  console.error = (...args: unknown[]) => {
    const formattedArgs = formatLogArguments(args);
    originalError.apply(console, formattedArgs);
    log.error(...formattedArgs);
  };

  console.warn = (...args: unknown[]) => {
    const formattedArgs = formatLogArguments(args);
    originalWarn.apply(console, formattedArgs);
    log.warn(...formattedArgs);
  };

  console.info = (...args: unknown[]) => {
    originalInfo.apply(console, args);
    log.info(...args);
  };

  console.debug = (...args: unknown[]) => {
    originalDebug.apply(console, args);
    // Suppress spammy worker pool debug lines in production unless debug explicitly enabled
    if (app.isPackaged && activeFileLevel === 'info' && isHighFrequencyNoise(args)) {
      return;
    }
    log.debug(...args);
  };

  // Disable electron-log's own console transport to avoid double printing
  log.transports.console.level = false;

  // Remove log files older than retention window
  pruneOldLogs();

  // Log comprehensive environment & hardware header at startup
  const sysInfo = getSynchronousSystemInfo();
  const bannerLines = formatStartupLogBanner(sysInfo);
  for (const line of bannerLines) {
    log.info(line);
  }
}

/**
 * Log GPU hardware acceleration details once app is ready.
 * Non-blocking, safe to call from app.whenReady().
 */
export async function logGpuDiagnostics(): Promise<void> {
  try {
    const snapshot = await getSystemDiagnosticsSnapshot();
    if (snapshot.gpu?.devices && snapshot.gpu.devices.length > 0) {
      for (const dev of snapshot.gpu.devices) {
        const desc =
          dev.gpuDeviceString ||
          `Vendor 0x${(dev.vendorId || 0).toString(16)} Device 0x${(dev.deviceId || 0).toString(16)}`;
        const driver = dev.driverVersion ? ` (Driver: ${dev.driverVersion})` : '';
        log.info(`[Main] Hardware GPU: ${desc}${driver}`);
      }
    }
    if (snapshot.gpu?.featureStatus) {
      const features = Object.entries(snapshot.gpu.featureStatus)
        .slice(0, 4)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      log.info(`[Main] Hardware Acceleration: ${features}`);
    }
  } catch (error) {
    log.warn('[Main] Failed to query GPU diagnostics:', error);
  }
}

/** Delete daily main-*.log files whose mtime exceeds the retention window. */
function pruneOldLogs(): void {
  const dir = logDir();
  if (!fs.existsSync(dir)) return;

  const cutoffMs = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const file of fs.readdirSync(dir)) {
    if (!LOG_FILE_RE.test(file)) continue;
    const filePath = path.join(dir, file);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoffMs) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore individual failures
    }
  }
}

/**
 * Get today's log file path (for display / open-in-folder).
 */
export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}

/**
 * Return archive entries for all daily main log files within the last 7 days.
 * Suitable for passing directly to exportLogsZip.
 */
export function getRecentMainLogEntries(): Array<{ archiveName: string; filePath: string }> {
  const dir = logDir();
  if (!fs.existsSync(dir)) return [];

  const cutoffMs = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return fs
    .readdirSync(dir)
    .filter(f => LOG_FILE_RE.test(f))
    .map(f => ({ archiveName: f, filePath: path.join(dir, f) }))
    .filter(({ filePath }) => {
      try {
        return fs.statSync(filePath).mtimeMs >= cutoffMs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName));
}

/**
 * Log instance for direct usage if needed
 */
export { log };
