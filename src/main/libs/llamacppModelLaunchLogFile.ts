import fs from 'fs';
import path from 'path';

import type {
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchLogSession,
} from '../../shared/llamacpp';
import {
  LlamaCppModelLaunchLogLevel,
  LlamaCppModelLaunchLogPhase,
  LlamaCppModelLaunchLogSessionStatus,
} from '../../shared/llamacpp';

const MODEL_LAUNCH_LOG_DIR_SEGMENTS = ['logs', 'llamacpp', 'model-launch'] as const;
const MODEL_LAUNCH_LOG_EXTENSION = '.txt';
const MODEL_LAUNCH_LOG_SAFE_NAME_MAX_LENGTH = 80;
const MODEL_LAUNCH_LOG_DETAIL_SEPARATOR = ' ';
const MODEL_LAUNCH_LOG_DISK_SESSION_ID_PREFIX = 'file:';
const MODEL_LAUNCH_LOG_ERROR_MARKER = ' - ERROR - ';
const MODEL_LAUNCH_LOG_LINE_BREAK_PATTERN = /\r?\n/;
const MODEL_LAUNCH_LOG_FILE_NAME_PATTERN =
  /^(.+)_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.txt$/;
const MODEL_LAUNCH_LOG_MODEL_NAME_DETAIL_PATTERN = /"modelName"\s*:\s*"((?:\\.|[^"\\])*)"/;

export type LlamaCppModelLaunchLogFileStore = ReturnType<typeof createLlamaCppModelLaunchLogFileStore>;

export function createLlamaCppModelLaunchLogFileStore(input: {
  userDataPath: string;
}) {
  const rootDir = path.join(input.userDataPath, ...MODEL_LAUNCH_LOG_DIR_SEGMENTS);
  const sessionsById = new Map<string, LlamaCppModelLaunchLogSession>();
  const clearedModelNames = new Set<string>();

  const ensureSession = (event: LlamaCppModelLaunchLogEvent): LlamaCppModelLaunchLogSession => {
    const existing = sessionsById.get(event.sessionId);
    if (existing) return existing;

    const createdAt = normalizeIsoDate(event.createdAt);
    const fileName = `${sanitizeLogFileName(event.modelName)}_${formatLogFileTimestamp(createdAt)}${MODEL_LAUNCH_LOG_EXTENSION}`;
    const session: LlamaCppModelLaunchLogSession = {
      sessionId: event.sessionId,
      modelName: event.modelName,
      fileName,
      filePath: path.join(rootDir, fileName),
      startedAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      status: getSessionStatus(event),
      sequence: event.sequence,
    };

    sessionsById.set(event.sessionId, session);
    return session;
  };

  const getDiskSession = (sessionId: string): LlamaCppModelLaunchLogSession | null => {
    const fileName = getDiskSessionFileName(sessionId);
    if (!fileName) return null;
    return createDiskSessionFromFile(rootDir, fileName);
  };

  const getAllSessions = (): LlamaCppModelLaunchLogSession[] => {
    const sessionsByFileName = new Map<string, LlamaCppModelLaunchLogSession>();
    for (const session of getDiskSessions(rootDir)) {
      sessionsByFileName.set(session.fileName, session);
    }
    for (const session of sessionsById.values()) {
      sessionsByFileName.set(session.fileName, session);
    }
    return Array.from(sessionsByFileName.values());
  };

  return {
    append(event: LlamaCppModelLaunchLogEvent): LlamaCppModelLaunchLogSession {
      fs.mkdirSync(rootDir, { recursive: true });
      clearedModelNames.delete(getLogModelKey(event.modelName));
      const session = ensureSession(event);
      const updatedAt = normalizeIsoDate(event.createdAt).toISOString();
      const nextSession: LlamaCppModelLaunchLogSession = {
        ...session,
        updatedAt,
        status: getSessionStatus(event, session.status),
        sequence: Math.max(session.sequence, event.sequence),
      };
      sessionsById.set(event.sessionId, nextSession);
      fs.appendFileSync(nextSession.filePath, formatModelLaunchLogEvent(event), 'utf8');
      return nextSession;
    },

    getSession(sessionId: string): LlamaCppModelLaunchLogSession | null {
      const session = sessionsById.get(sessionId) ?? getDiskSession(sessionId);
      if (!session || clearedModelNames.has(getLogModelKey(session.modelName))) return null;
      return session;
    },

    getLatestSession(modelName?: string): LlamaCppModelLaunchLogSession | null {
      if (modelName && clearedModelNames.has(getLogModelKey(modelName))) return null;
      const sessions = getAllSessions()
        .filter(session => !clearedModelNames.has(getLogModelKey(session.modelName)))
        .filter(session => !modelName || isSameLogModelName(session.modelName, modelName));
      if (sessions.length === 0) return null;
      return sessions.reduce((latest, session) => (
        new Date(session.updatedAt).getTime() > new Date(latest.updatedAt).getTime()
          ? session
          : latest
      ));
    },

    readSessionLog(sessionId: string): {
      session: LlamaCppModelLaunchLogSession;
      content: string;
    } | null {
      const session = sessionsById.get(sessionId) ?? getDiskSession(sessionId);
      if (!session || clearedModelNames.has(getLogModelKey(session.modelName))) return null;
      if (!fs.existsSync(session.filePath)) {
        return { session, content: '' };
      }
      try {
        return {
          session,
          content: fs.readFileSync(session.filePath, 'utf8'),
        };
      } catch {
        return { session, content: '' };
      }
    },

    clearModel(modelName: string): void {
      const normalizedModelName = modelName.trim();
      if (!normalizedModelName) return;
      clearedModelNames.add(getLogModelKey(normalizedModelName));

      const fileNamesToDelete = new Set<string>();
      for (const [sessionId, session] of sessionsById.entries()) {
        if (isSameLogModelName(session.modelName, normalizedModelName)) {
          fileNamesToDelete.add(session.fileName);
          sessionsById.delete(sessionId);
        }
      }
      for (const session of getDiskSessions(rootDir)) {
        if (isSameLogModelName(session.modelName, normalizedModelName)) {
          fileNamesToDelete.add(session.fileName);
        }
      }
      for (const fileName of fileNamesToDelete) {
        deleteModelLaunchLogFile(rootDir, fileName);
      }
    },
  };
}

function getDiskSessions(rootDir: string): LlamaCppModelLaunchLogSession[] {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(MODEL_LAUNCH_LOG_EXTENSION))
    .map(entry => createDiskSessionFromFile(rootDir, entry.name))
    .filter((session): session is LlamaCppModelLaunchLogSession => Boolean(session));
}

function deleteModelLaunchLogFile(rootDir: string, unsafeFileName: string): void {
  const fileName = path.basename(unsafeFileName);
  if (!fileName.endsWith(MODEL_LAUNCH_LOG_EXTENSION)) return;
  const filePath = path.join(rootDir, fileName);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Log cleanup is best-effort and should not block model unload.
  }
}

function createDiskSessionFromFile(
  rootDir: string,
  unsafeFileName: string,
): LlamaCppModelLaunchLogSession | null {
  const fileName = path.basename(unsafeFileName);
  if (!fileName.endsWith(MODEL_LAUNCH_LOG_EXTENSION)) return null;

  const filePath = path.join(rootDir, fileName);
  if (!fs.existsSync(filePath)) return null;

  let stats: fs.Stats;
  let content: string;
  try {
    stats = fs.statSync(filePath);
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseLogFileName(fileName);
  const startedAt = parsed?.startedAt ?? stats.birthtime.toISOString();
  const updatedAt = stats.mtime.toISOString();
  const modelName = extractModelNameFromLogContent(content)
    ?? parsed?.modelName
    ?? path.basename(fileName, MODEL_LAUNCH_LOG_EXTENSION);

  return {
    sessionId: `${MODEL_LAUNCH_LOG_DISK_SESSION_ID_PREFIX}${fileName}`,
    modelName,
    fileName,
    filePath,
    startedAt,
    updatedAt,
    status: getLogFileSessionStatus(content),
    sequence: getLogFileSequence(content),
  };
}

function getDiskSessionFileName(sessionId: string): string | null {
  if (!sessionId.startsWith(MODEL_LAUNCH_LOG_DISK_SESSION_ID_PREFIX)) return null;
  const fileName = path.basename(sessionId.slice(MODEL_LAUNCH_LOG_DISK_SESSION_ID_PREFIX.length));
  return fileName.endsWith(MODEL_LAUNCH_LOG_EXTENSION) ? fileName : null;
}

function parseLogFileName(fileName: string): {
  modelName: string;
  startedAt: string;
} | null {
  const match = MODEL_LAUNCH_LOG_FILE_NAME_PATTERN.exec(fileName);
  if (!match) return null;
  const [, modelName, year, month, day, hour, minute, second] = match;
  const startedAt = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return {
    modelName,
    startedAt: Number.isNaN(startedAt.getTime()) ? new Date().toISOString() : startedAt.toISOString(),
  };
}

function extractModelNameFromLogContent(content: string): string | null {
  const match = MODEL_LAUNCH_LOG_MODEL_NAME_DETAIL_PATTERN.exec(content);
  if (!match) return null;
  try {
    const value = JSON.parse(`"${match[1]}"`);
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return match[1].trim() || null;
  }
}

function getLogFileSessionStatus(content: string): LlamaCppModelLaunchLogSession['status'] {
  if (
    content.includes(MODEL_LAUNCH_LOG_ERROR_MARKER)
    || content.includes(getDefaultLogMessage(LlamaCppModelLaunchLogPhase.Failed))
  ) {
    return LlamaCppModelLaunchLogSessionStatus.Failed;
  }
  if (content.includes(getDefaultLogMessage(LlamaCppModelLaunchLogPhase.Succeeded))) {
    return LlamaCppModelLaunchLogSessionStatus.Succeeded;
  }
  return LlamaCppModelLaunchLogSessionStatus.Starting;
}

function getLogFileSequence(content: string): number {
  return content.split(MODEL_LAUNCH_LOG_LINE_BREAK_PATTERN)
    .filter(line => line.trim()).length;
}

function isSameLogModelName(left: string, right: string): boolean {
  return left === right || getLogModelKey(left) === getLogModelKey(right);
}

function getLogModelKey(modelName: string): string {
  return sanitizeLogFileName(modelName);
}

export function formatModelLaunchLogEvent(event: LlamaCppModelLaunchLogEvent): string {
  const date = normalizeIsoDate(event.createdAt);
  const moduleName = getLogModuleName(event.phase);
  const level = getLogLevelName(event.level);
  const message = event.message?.trim() || getDefaultLogMessage(event.phase);
  const detail = event.detail?.trim();
  const body = detail ? `${message}${MODEL_LAUNCH_LOG_DETAIL_SEPARATOR}${detail}` : message;
  return `${formatLogTimestamp(date)} - ${moduleName} - ${level} - ${body}\n`;
}

function normalizeIsoDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return new Date();
}

function sanitizeLogFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MODEL_LAUNCH_LOG_SAFE_NAME_MAX_LENGTH)
    .replace(/[.\s_]+$/g, '');
  return normalized || 'model';
}

function formatLogFileTimestamp(date: Date): string {
  const parts = getDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}

function formatLogTimestamp(date: Date): string {
  const parts = getDateParts(date);
  const millisecond = String(date.getMilliseconds()).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${millisecond}000${formatTimezoneOffset(date)}`;
}

function getDateParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
    hour: String(date.getHours()).padStart(2, '0'),
    minute: String(date.getMinutes()).padStart(2, '0'),
    second: String(date.getSeconds()).padStart(2, '0'),
  };
}

function formatTimezoneOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function getSessionStatus(
  event: Pick<LlamaCppModelLaunchLogEvent, 'phase'>,
  current: LlamaCppModelLaunchLogSession['status'] = LlamaCppModelLaunchLogSessionStatus.Starting,
): LlamaCppModelLaunchLogSession['status'] {
  if (event.phase === LlamaCppModelLaunchLogPhase.Succeeded) return LlamaCppModelLaunchLogSessionStatus.Succeeded;
  if (event.phase === LlamaCppModelLaunchLogPhase.Failed) return LlamaCppModelLaunchLogSessionStatus.Failed;
  return current;
}

function getLogLevelName(level: LlamaCppModelLaunchLogEvent['level']): string {
  switch (level) {
    case LlamaCppModelLaunchLogLevel.Error:
      return 'ERROR';
    case LlamaCppModelLaunchLogLevel.Warn:
      return 'WARNING';
    case LlamaCppModelLaunchLogLevel.Debug:
      return 'DEBUG';
    case LlamaCppModelLaunchLogLevel.Info:
      return 'INFO';
  }
}

function getLogModuleName(phase: LlamaCppModelLaunchLogEvent['phase']): string {
  switch (phase) {
    case LlamaCppModelLaunchLogPhase.CheckingService:
    case LlamaCppModelLaunchLogPhase.StartingService:
    case LlamaCppModelLaunchLogPhase.ServiceReady:
      return 'rongxinai.llamacpp.service';
    case LlamaCppModelLaunchLogPhase.CheckingRuntime:
      return 'rongxinai.llamacpp.runtime';
    case LlamaCppModelLaunchLogPhase.Requested:
      return 'rongxinai.llamacpp.launch';
    case LlamaCppModelLaunchLogPhase.PreparingModel:
    case LlamaCppModelLaunchLogPhase.LoadingModel:
    case LlamaCppModelLaunchLogPhase.WaitingReady:
    case LlamaCppModelLaunchLogPhase.ProbingModel:
    case LlamaCppModelLaunchLogPhase.Retrying:
    case LlamaCppModelLaunchLogPhase.Succeeded:
    case LlamaCppModelLaunchLogPhase.Failed:
      return 'rongxinai.llamacpp.model';
  }
}

function getDefaultLogMessage(phase: LlamaCppModelLaunchLogEvent['phase']): string {
  switch (phase) {
    case LlamaCppModelLaunchLogPhase.Requested:
      return 'Startup request received';
    case LlamaCppModelLaunchLogPhase.CheckingService:
      return 'Checking local inference service';
    case LlamaCppModelLaunchLogPhase.StartingService:
      return 'Starting local inference service';
    case LlamaCppModelLaunchLogPhase.ServiceReady:
      return 'Local inference service is ready';
    case LlamaCppModelLaunchLogPhase.PreparingModel:
      return 'Preparing model configuration';
    case LlamaCppModelLaunchLogPhase.CheckingRuntime:
      return 'Checking runtime environment';
    case LlamaCppModelLaunchLogPhase.LoadingModel:
      return 'Loading model';
    case LlamaCppModelLaunchLogPhase.WaitingReady:
      return 'Waiting for model readiness';
    case LlamaCppModelLaunchLogPhase.ProbingModel:
      return 'Testing model response';
    case LlamaCppModelLaunchLogPhase.Retrying:
      return 'Retrying model startup';
    case LlamaCppModelLaunchLogPhase.Succeeded:
      return 'Model started successfully';
    case LlamaCppModelLaunchLogPhase.Failed:
      return 'Model startup failed';
  }
}
