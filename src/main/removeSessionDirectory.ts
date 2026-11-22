import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DETACHED_PREFIX = '.deleted-';
const DETACHED_SESSION_DIRECTORY =
  /^\.deleted-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const pendingRemovals = new Map<string, Promise<void>>();

export async function removeSessionDirectory(directory: string): Promise<void> {
  const detached = path.join(path.dirname(directory), DETACHED_PREFIX + randomUUID());
  try {
    // Detach in the same turn as deletion so a reused session ID can safely publish new files.
    fs.renameSync(directory, detached);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const removal = fs.promises.rm(detached, { recursive: true, force: true });
  pendingRemovals.set(detached, removal);
  try {
    await removal;
  } finally {
    pendingRemovals.delete(detached);
  }
}

export async function drainSessionDirectoryRemovals(): Promise<void> {
  await Promise.allSettled(pendingRemovals.values());
}

export async function recoverSessionDirectoryRemovals(root: string): Promise<void> {
  let entries: fs.Dir;
  try {
    entries = await fs.promises.opendir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for await (const entry of entries) {
    if (!entry.isDirectory() || !DETACHED_SESSION_DIRECTORY.test(entry.name)) continue;
    const detached = path.join(root, entry.name);
    if (pendingRemovals.has(detached)) continue;
    await fs.promises.rm(detached, { recursive: true, force: true }).catch(error => {
      console.warn('[Cowork] failed to recover a deleted session directory:', error);
    });
  }
}
