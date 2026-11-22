import Database from 'better-sqlite3';
import { rmSync } from 'fs';
import { afterEach } from 'vitest';

import type { StartCodingSessionInput } from '../../shared/codingAgent';
import { CodingRoomService } from './codingRoomService';
import { persistCodingSessionRecord } from './codingSessionStartup';
import { initializeCodingAgentSchema } from './schema';
import { initializeArtifactLedgerSchema } from '../artifactLedger/schema';

let db: Database.Database | undefined;
const tempDirectories: string[] = [];
const services: CodingRoomService[] = [];

/**
 * Opens the per-test in-memory database with the coding agent schema applied.
 * The shared afterEach closes it after the test's services are disposed.
 */
export function openCodingRoomDatabase(): Database.Database {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  initializeArtifactLedgerSchema(db);
  return db;
}

/** Registers a temp directory created by a test for best-effort removal. */
export function trackTempDirectory<T extends string>(directory: T): T {
  tempDirectories.push(directory);
  return directory;
}

/**
 * Creates a CodingRoomService that the shared afterEach disposes before the
 * database is closed, so a late turn completion cannot touch a closed
 * connection.
 */
export function createService(...args: ConstructorParameters<typeof CodingRoomService>) {
  const service = new CodingRoomService(...args);
  services.push(service);
  const [repository, registry, runtime] = args;
  return Object.assign(service, {
    async seedSession(
      input: Pick<StartCodingSessionInput, 'profileId' | 'title'> &
        ({ workspaceRoot: string } | Pick<StartCodingSessionInput, 'workspaceId' | 'sourceRoot'>),
    ) {
      // Arrange persisted state without starting an agent or emitting a turn.
      const [room, sourceRoot] =
        'workspaceRoot' in input
          ? ([repository.getOrCreateRoom(input.workspaceRoot), input.workspaceRoot] as const)
          : ([repository.getRoomById(input.workspaceId), input.sourceRoot] as const);
      const profile = registry.get(input.profileId);
      if (!room || !profile) throw new Error('Invalid coding session fixture');
      persistCodingSessionRecord({
        repository,
        target: { room, profile, sourceRoot },
        title: input.title ?? '',
        gitBaseline: (await runtime.getWorkspaceBaseline?.(sourceRoot)) ?? null,
      });
      return service.bootstrap(room.workspaceRoot);
    },
  });
}

afterEach(async () => {
  // Dispose services (which awaits their in-flight turns) before closing the
  // database, otherwise a late turn completion touches a closed connection.
  for (const service of services.splice(0)) {
    await service.dispose();
  }
  db?.close();
  db = undefined;
  for (const directory of tempDirectories.splice(0)) {
    // Windows: a spawned fake-agent process can still hold the temp dir at teardown.
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
