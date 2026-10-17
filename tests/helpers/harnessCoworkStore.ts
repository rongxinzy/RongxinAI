import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { CoworkStore } from '../../src/main/coworkStore';
import { SqliteStore } from '../../src/main/sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';

export interface HarnessCoworkStoreHandle {
  store: CoworkStore;
  cleanup: () => void;
}

/** SQLite-backed CoworkStore for streaming harness / adapter integration tests. */
export async function createHarnessCoworkStore(): Promise<HarnessCoworkStoreHandle> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'streaming-harness-cowork-'));
  const sqlite = await SqliteStore.create(userData);
  initializeWorkbenchTaskSchema(sqlite.getDatabase());
  const store = new CoworkStore(sqlite.getDatabase());
  return {
    store,
    cleanup: () => {
      sqlite.close();
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
}

export function ensureHarnessCoworkSession(
  store: CoworkStore,
  sessionId: string,
  mode: 'work' | 'chat' = 'chat',
): void {
  if (store.getSession(sessionId, 0, { includeArtifacts: false })) return;
  store.createSession(
    sessionId,
    process.cwd(),
    '',
    CoworkExecutionMode.Local,
    [],
    'main',
    '',
    mode,
    sessionId,
  );
}
