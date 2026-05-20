/**
 * Structured logging wrapper with automatic sanitization, correlation ID,
 * and module prefix convention.
 *
 * Replaces bare console.log calls with consistently formatted, safe log output.
 *
 * Usage:
 *   import { createLogger } from './structuredLog';
 *   const log = createLogger('CoworkRouter');
 *   log.info('session started', { sessionId, agentId });
 *   log.error('start failed', { error: errorMessage });
 *
 * Output format:
 *   [13:42:05.123] [INFO] [CoworkRouter] [cid:a1b2c3d4] session started  sessionId=abc123 agentId=main
 */

import { formatCorrelationId } from './logCorrelation';
import { serializeForLog } from './sanitizeForLog';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogger {
  debug: (message: string, extra?: Record<string, unknown>) => void;
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
  /** Return a child logger with additional default context fields */
  withContext: (ctx: Record<string, unknown>) => StructuredLogger;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return '';
  return '  ' + Object.entries(extra)
    .map(([k, v]) => `${k}=${serializeForLog(v)}`)
    .join(' ');
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createLogger(module: string, baseContext?: Record<string, unknown>): StructuredLogger {
  const logFn = (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
    const time = formatTime();
    const cid = formatCorrelationId();
    const mergedExtra = baseContext ? { ...baseContext, ...extra } : extra;
    const parts = [
      `[${time}]`,
      `[${level}]`,
      `[${module}]`,
      cid || '',
      message,
      formatExtra(mergedExtra),
    ].filter(Boolean).join(' ');

    // Route to appropriate console method (which is intercepted by electron-log)
    const output = parts.trim();
    switch (level) {
      case 'ERROR':
        console.error(output);
        break;
      case 'WARN':
        console.warn(output);
        break;
      case 'DEBUG':
        console.debug(output);
        break;
      default:
        console.info(output);
    }
  };

  return {
    debug: (m, e) => logFn('DEBUG', m, e),
    info: (m, e) => logFn('INFO', m, e),
    warn: (m, e) => logFn('WARN', m, e),
    error: (m, e) => logFn('ERROR', m, e),
    withContext: (ctx) => createLogger(module, { ...baseContext, ...ctx }),
  };
}
