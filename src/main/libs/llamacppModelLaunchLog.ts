import { randomUUID } from 'node:crypto';

import type { LlamaCppModelLaunchLogEvent } from '../../shared/llamacpp';
import {
  LlamaCppModelLaunchLogLevel,
  LlamaCppModelLaunchLogPhase,
  LlamaCppModelLaunchLogSource,
} from '../../shared/llamacpp';
import type { LlamaCppServiceStartupLogger } from './llamacppServiceStartup';

export type LlamaCppModelLaunchLogInput = {
  level: LlamaCppModelLaunchLogLevel;
  phase: LlamaCppModelLaunchLogPhase;
  message?: string;
  detail?: unknown;
};

export type LlamaCppModelLaunchLogReporter = (input: LlamaCppModelLaunchLogInput) => void;

export type LlamaCppModelLaunchLogger = {
  readonly sessionId: string;
  readonly modelName: string;
  report: LlamaCppModelLaunchLogReporter;
  debug: (phase: LlamaCppModelLaunchLogPhase, message?: string, detail?: unknown) => void;
  info: (phase: LlamaCppModelLaunchLogPhase, message?: string, detail?: unknown) => void;
  warn: (phase: LlamaCppModelLaunchLogPhase, message?: string, detail?: unknown) => void;
  error: (phase: LlamaCppModelLaunchLogPhase, message?: string, detail?: unknown) => void;
};

const MAX_LOG_TEXT_LENGTH = 1200;
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]'],
  [/(api[_-]?key\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]'],
  [/(access[_-]?token\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]'],
  [/(refresh[_-]?token\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]'],
  [/(password\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]'],
  [/(secret\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]'],
];

export function createLlamaCppModelLaunchLogger(input: {
  modelName: string;
  emit: (event: LlamaCppModelLaunchLogEvent) => void;
  sessionId?: string;
  now?: () => Date;
}): LlamaCppModelLaunchLogger {
  let sequence = 0;
  const emittedLogKeys = new Set<string>();
  const sessionId = input.sessionId ?? randomUUID();
  const now = input.now ?? (() => new Date());
  const modelName = input.modelName.trim();

  const report: LlamaCppModelLaunchLogReporter = eventInput => {
    const message = eventInput.message ? sanitizeLogText(eventInput.message) : undefined;
    const detail =
      eventInput.detail !== undefined
        ? sanitizeLogText(stringifyDetail(eventInput.detail))
        : undefined;
    const logKey = [eventInput.level, eventInput.phase, message ?? '', detail ?? ''].join('\u0000');
    if (emittedLogKeys.has(logKey)) return;
    emittedLogKeys.add(logKey);

    const event: LlamaCppModelLaunchLogEvent = {
      sessionId,
      modelName,
      sequence: ++sequence,
      createdAt: now().toISOString(),
      level: eventInput.level,
      phase: eventInput.phase,
      source: LlamaCppModelLaunchLogSource.LaunchFlow,
      ...(message ? { message } : {}),
      ...(detail !== undefined ? { detail } : {}),
    };
    input.emit(event);
  };

  return {
    sessionId,
    modelName,
    report,
    debug: (phase, message, detail) =>
      report({
        level: LlamaCppModelLaunchLogLevel.Debug,
        phase,
        message,
        detail,
      }),
    info: (phase, message, detail) =>
      report({
        level: LlamaCppModelLaunchLogLevel.Info,
        phase,
        message,
        detail,
      }),
    warn: (phase, message, detail) =>
      report({
        level: LlamaCppModelLaunchLogLevel.Warn,
        phase,
        message,
        detail,
      }),
    error: (phase, message, detail) =>
      report({
        level: LlamaCppModelLaunchLogLevel.Error,
        phase,
        message,
        detail,
      }),
  };
}

export function createLlamaCppServiceStartupLaunchLogger(
  logger: LlamaCppModelLaunchLogger,
): LlamaCppServiceStartupLogger {
  return {
    log: (...args: unknown[]) => {
      reportServiceStartupLog(logger, LlamaCppModelLaunchLogLevel.Info, args);
    },
    warn: (...args: unknown[]) => {
      reportServiceStartupLog(logger, LlamaCppModelLaunchLogLevel.Warn, args);
    },
  };
}

export async function withLlamaCppModelLaunchHeartbeat<T>(input: {
  logger: LlamaCppModelLaunchLogger;
  phase: LlamaCppModelLaunchLogPhase;
  message: string;
  intervalMs?: number;
  action: () => Promise<T>;
}): Promise<T> {
  const intervalMs = input.intervalMs ?? 10_000;
  const timer = setInterval(() => {
    input.logger.info(input.phase, input.message);
  }, intervalMs);
  try {
    return await input.action();
  } finally {
    clearInterval(timer);
  }
}

function reportServiceStartupLog(
  logger: LlamaCppModelLaunchLogger,
  level: LlamaCppModelLaunchLogLevel,
  args: unknown[],
): void {
  const phase = resolveServiceStartupPhase(args);
  if (phase !== LlamaCppModelLaunchLogPhase.StartingService) {
    return;
  }
  logger.report({
    level,
    phase,
    detail: stringifyDetail(args),
  });
}

function resolveServiceStartupPhase(args: unknown[]): LlamaCppModelLaunchLogPhase {
  const text = stringifyDetail(args).toLowerCase();
  if (text.includes('starting service')) {
    return LlamaCppModelLaunchLogPhase.StartingService;
  }
  if (text.includes('service is ready') || text.includes('already running')) {
    return LlamaCppModelLaunchLogPhase.ServiceReady;
  }
  if (text.includes('failed')) {
    return LlamaCppModelLaunchLogPhase.Failed;
  }
  return LlamaCppModelLaunchLogPhase.CheckingService;
}

function stringifyDetail(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => stringifyDetail(item)).join(' ');
  }
  if (value instanceof Error) {
    return [value.name, value.message].filter(Boolean).join(': ');
  }
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeLogText(value: string): string {
  const collapsed = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const redacted = SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    collapsed,
  );
  if (redacted.length <= MAX_LOG_TEXT_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_LOG_TEXT_LENGTH)}...`;
}

export const __test__sanitizeLlamaCppModelLaunchLogText = sanitizeLogText;
