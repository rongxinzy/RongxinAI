import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import {
  createCoworkStoreHarness,
  type CoworkStoreTestHarness,
} from '../../src/main/coworkStore/coworkStore.testHarness';
import type { CoworkStore } from '../../src/main/coworkStore';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';

export interface HarnessCoworkStoreHandle {
  store: CoworkStore;
  cleanup: () => void;
}

/** In-memory SQLite CoworkStore for streaming harness / adapter integration tests. */
export function createHarnessCoworkStore(): HarnessCoworkStoreHandle {
  const harness: CoworkStoreTestHarness = createCoworkStoreHarness();
  initializeWorkbenchTaskSchema(harness.db);
  return {
    store: harness.store,
    cleanup: () => {
      harness.db.close();
    },
  };
}

export function ensureHarnessCoworkSession(
  store: CoworkStore,
  sessionId: string,
  mode: 'work' | 'chat' = 'chat',
): void {
  if (store.getSession(sessionId, null, { includeArtifacts: false })) return;
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
