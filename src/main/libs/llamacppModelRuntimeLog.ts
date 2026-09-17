import fs from 'node:fs/promises';
import path from 'node:path';

const MODEL_LOG_DIR_SEGMENTS = ['logs', 'llamacpp', 'model-launch'] as const;
const MODEL_LOG_EXTENSION = '.txt';
const MODEL_LOG_SAFE_NAME_MAX_LENGTH = 80;

export function getLlamaCppModelRuntimeLogDir(userDataPath: string): string {
  return path.join(userDataPath, ...MODEL_LOG_DIR_SEGMENTS);
}

export function createLlamaCppModelRuntimeLogWriter(input: {
  userDataPath: string;
  modelName: string;
  startedAt?: Date;
}): { filePath: string; append: (text: string) => Promise<void> } {
  const startedAt = input.startedAt ?? new Date();
  const fileName = `${sanitizeModelName(input.modelName)}_${formatTimestamp(startedAt)}${MODEL_LOG_EXTENSION}`;
  const filePath = path.join(getLlamaCppModelRuntimeLogDir(input.userDataPath), fileName);
  let pendingWrite = Promise.resolve();

  return {
    filePath,
    append: async text => {
      if (!text) return;
      pendingWrite = pendingWrite.then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, text, 'utf8');
      });
      await pendingWrite;
    },
  };
}

function sanitizeModelName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MODEL_LOG_SAFE_NAME_MAX_LENGTH)
    .replace(/[.\s_]+$/g, '');
  return normalized || 'model';
}

function formatTimestamp(date: Date): string {
  const parts = [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ];
  const time = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];
  return `${parts.join('-')}_${time.join('-')}`;
}
