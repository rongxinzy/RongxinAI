import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import Database from 'better-sqlite3';

import { sha256FileStream } from '../fileHasher';
import { verifySqliteFile } from './sqliteVerify';

const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-verify-test-')));
// Compiled inside the source tree so the worker resolves better-sqlite3.
const compiled = fs.mkdtempSync(path.join(__dirname, '.verify-compiled-'));
const dbPath = path.join(fixture, 'demo.sqlite');

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ESNext',
      '--types',
      'node',
      '--skipLibCheck',
      '--esModuleInterop',
      '--rootDir',
      'src',
      '--outDir',
      compiled,
      'src/main/libs/sqliteBackup/sqliteVerifyWorker.ts',
      'src/main/libs/hashWorker.ts',
    ],
    { stdio: 'inherit' },
  );
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('ok');
  db.pragma('user_version = 7');
  db.close();
});
afterAll(() => {
  fs.rmSync(compiled, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
});

function workerFile(relative: string): string {
  return path.join(compiled, 'main/libs/sqliteBackup', relative);
}

test('the verify worker reports quick_check, pragmas, and rejects bad paths', async () => {
  const result = await verifySqliteFile(dbPath, 'quick_check', {
    workerPath: workerFile('sqliteVerifyWorker.js'),
  });
  expect(result.check).toBe('ok');
  expect(result.userVersion).toBe(7);
  expect(result.schemaVersion).toBeGreaterThan(0);

  await expect(verifySqliteFile('relative/path.sqlite', 'quick_check')).rejects.toThrow('absolute');
  await expect(
    verifySqliteFile(path.join(fixture, 'missing.sqlite'), 'quick_check'),
  ).rejects.toThrow();
});

test('the verify worker surfaces corruption instead of crashing', async () => {
  const corrupted = path.join(fixture, 'corrupted.sqlite');
  fs.copyFileSync(dbPath, corrupted);
  const fd = fs.openSync(corrupted, 'r+');
  fs.writeSync(fd, Buffer.from('garbage!garbage!'), 0, 15, 4096);
  fs.closeSync(fd);
  const outcome = await verifySqliteFile(corrupted, 'quick_check', {
    workerPath: workerFile('sqliteVerifyWorker.js'),
  }).then(
    result => result.check,
    error => (error as Error).message,
  );
  expect(outcome).not.toBe('ok');
});

test('the hash worker streams a file to the same digest as an in-process hash', async () => {
  const sample = path.join(fixture, 'sample.bin');
  fs.writeFileSync(sample, Buffer.alloc(1024 * 1024, 7));
  const expected = crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex');
  await expect(
    sha256FileStream(sample, {
      timeoutMs: 30_000,
      workerPath: path.join(compiled, 'main/libs/hashWorker.js'),
    }),
  ).resolves.toBe(expected);

  await expect(sha256FileStream(path.join(fixture, 'missing.bin'))).rejects.toThrow(
    'size is invalid',
  );
  await expect(sha256FileStream('relative.bin')).rejects.toThrow('absolute');
});
