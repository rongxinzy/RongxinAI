import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import {
  addColumnIfMissing,
  runMigrations,
  SCHEMA_MIGRATIONS_TABLE,
  type Migration,
} from './sqliteMigrations';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

const createTempDb = (): Database.Database => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-sqlite-migrations-'));
  tempDirs.push(dir);
  return new Database(path.join(dir, 'test.sqlite'));
};

const scopeVersion = (db: Database.Database, scope: string): number | undefined => {
  const row = db
    .prepare(`SELECT version FROM ${SCHEMA_MIGRATIONS_TABLE} WHERE scope = ?`)
    .get(scope) as { version: number } | undefined;
  return row?.version;
};

test('applies pending migrations in order and records the final version', () => {
  const db = createTempDb();
  const applied: string[] = [];
  const migrations: Migration[] = [
    {
      version: 1,
      name: 'create-things',
      up: d => {
        d.exec('CREATE TABLE things (id TEXT PRIMARY KEY)');
        applied.push('create-things');
      },
    },
    {
      version: 2,
      name: 'seed-things',
      up: d => {
        d.prepare('INSERT INTO things (id) VALUES (?)').run('a');
        applied.push('seed-things');
      },
    },
  ];

  try {
    runMigrations(db, 'unit', migrations);
    expect(applied).toEqual(['create-things', 'seed-things']);
    expect(scopeVersion(db, 'unit')).toBe(2);
    expect(db.prepare('SELECT id FROM things').all()).toEqual([{ id: 'a' }]);

    // A second run with the same list is a no-op.
    runMigrations(db, 'unit', migrations);
    expect(applied).toEqual(['create-things', 'seed-things']);
  } finally {
    db.close();
  }
});

test('keeps scopes independent in one database', () => {
  const db = createTempDb();
  try {
    runMigrations(db, 'scope-a', [
      { version: 1, name: 'a1', up: () => {} },
      { version: 2, name: 'a2', up: () => {} },
    ]);
    runMigrations(db, 'scope-b', [{ version: 1, name: 'b1', up: () => {} }]);

    expect(scopeVersion(db, 'scope-a')).toBe(2);
    expect(scopeVersion(db, 'scope-b')).toBe(1);
  } finally {
    db.close();
  }
});

test('applies only versions newer than the recorded one', () => {
  const db = createTempDb();
  const applied: string[] = [];
  try {
    runMigrations(db, 'unit', [{ version: 1, name: 'first', up: () => applied.push('first') }]);
    runMigrations(db, 'unit', [
      { version: 1, name: 'first', up: () => applied.push('first-again') },
      { version: 2, name: 'second', up: () => applied.push('second') },
    ]);

    expect(applied).toEqual(['first', 'second']);
    expect(scopeVersion(db, 'unit')).toBe(2);
  } finally {
    db.close();
  }
});

test('rejects non-increasing version lists before touching the database', () => {
  const db = createTempDb();
  try {
    expect(() =>
      runMigrations(db, 'unit', [
        { version: 2, name: 'higher-first', up: () => {} },
        { version: 2, name: 'same-version', up: () => {} },
      ]),
    ).toThrow('strictly increasing');
    expect(() =>
      runMigrations(db, 'unit', [
        { version: 3, name: 'three', up: () => {} },
        { version: 2, name: 'two', up: () => {} },
      ]),
    ).toThrow('strictly increasing');

    // Validation happens before any migration body runs.
    expect(scopeVersion(db, 'unit')).toBeUndefined();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get(),
    ).toBeDefined();
  } finally {
    db.close();
  }
});

test('rolls back the failed migration and keeps the version un-advanced', () => {
  const db = createTempDb();
  try {
    runMigrations(db, 'unit', [
      {
        version: 1,
        name: 'create-and-seed',
        up: d => {
          d.exec('CREATE TABLE things (id TEXT PRIMARY KEY, value TEXT)');
          d.prepare("INSERT INTO things (id, value) VALUES ('a', 'kept')").run();
        },
      },
    ]);

    let error: unknown;
    try {
      runMigrations(db, 'unit', [
        { version: 1, name: 'create-and-seed', up: () => {} },
        {
          version: 2,
          name: 'partial-then-fail',
          up: d => {
            d.prepare("INSERT INTO things (id, value) VALUES ('b', 'rolled-back')").run();
            d.exec('ALTER TABLE things ADD COLUMN broken TEXT; SELECT no_such_column FROM things;');
          },
        },
      ]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    // The version bump rolled back with the body.
    expect(scopeVersion(db, 'unit')).toBe(1);
    // The DML inside the failed body rolled back too.
    expect(db.prepare('SELECT id FROM things ORDER BY id').all()).toEqual([{ id: 'a' }]);

    // The failure is rethrown with scope + version + name in the message.
    const message = String((error as Error).message);
    expect(message).toContain('no_such_column');
  } finally {
    db.close();
  }
});

test('addColumnIfMissing probes instead of throwing on existing columns', () => {
  const db = createTempDb();
  try {
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT 'x')");

    expect(addColumnIfMissing(db, 'items', 'note', 'TEXT')).toBe(false);
    expect(addColumnIfMissing(db, 'items', 'extra', "TEXT NOT NULL DEFAULT 'y'")).toBe(true);
    expect(addColumnIfMissing(db, 'items', 'extra', 'TEXT')).toBe(false);

    const columns = db.pragma('table_info(items)') as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toEqual(['id', 'note', 'extra']);
    const row = db.prepare("SELECT extra FROM items WHERE id = 'none'").get();
    expect(row).toBeUndefined(); // column exists; table is simply empty
  } finally {
    db.close();
  }
});
