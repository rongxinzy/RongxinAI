import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SESSION_DIRECTORY = 'agent-runtime';

export function durableSessionFile(root: string, sessionId: string): string {
  if (!sessionId || sessionId.length > 1024) throw new Error('Invalid session identity.');
  return path.join(
    root,
    SESSION_DIRECTORY,
    `${createHash('sha256').update(sessionId).digest('hex')}.sqlite`,
  );
}

export function hasDurableSession(root: string, sessionId: string): boolean {
  return fs.existsSync(durableSessionFile(root, sessionId));
}

/** User-requested invalidation applies only to the new native execution store. */
export function invalidateDurableSession(root: string, sessionId: string): void {
  const file = durableSessionFile(root, sessionId);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
}

export function listDurableSessionFiles(root: string): string[] {
  try {
    return fs
      .readdirSync(path.join(root, SESSION_DIRECTORY))
      .filter(file => /^[a-f0-9]{64}\.sqlite$/.test(file))
      .map(file => path.join(root, SESSION_DIRECTORY, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
