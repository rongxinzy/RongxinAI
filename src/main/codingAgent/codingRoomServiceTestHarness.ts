import Database from 'better-sqlite3';
import { rmSync } from 'fs';
import { afterEach } from 'vitest';

import { CodingRoomService } from './codingRoomService';
import { initializeCodingAgentSchema } from './schema';

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
export function createService(
  ...args: ConstructorParameters<typeof CodingRoomService>
): CodingRoomService {
  const service = new CodingRoomService(...args);
  services.push(service);
  return service;
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
