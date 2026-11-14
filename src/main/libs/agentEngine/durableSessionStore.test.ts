import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  durableSessionFile,
  hasDurableSession,
  invalidateDurableSession,
  listDurableSessionFiles,
} from './durableSessionStore';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-session-store-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('uses stable collision-resistant paths even for identities containing traversal characters', () => {
  const identities = ['a/b', 'a_b', '../outside', 'session:with:colons', '会话/一'];
  const files = identities.map(id => durableSessionFile(root, id));
  expect(new Set(files).size).toBe(identities.length);
  for (const [index, file] of files.entries()) {
    expect(path.dirname(file)).toBe(path.join(root, 'agent-runtime'));
    expect(path.basename(file)).toMatch(/^[a-f0-9]{64}\.sqlite$/);
    expect(file).toBe(durableSessionFile(root, identities[index]));
  }
  expect(() => durableSessionFile(root, '')).toThrow('Invalid session identity');
  expect(() => durableSessionFile(root, 'x'.repeat(1025))).toThrow('Invalid session identity');
});

test('discovers only native session databases and leaves retired session data untouched', () => {
  const file = durableSessionFile(root, 'session-1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'native');
  fs.writeFileSync(`${file}-wal`, 'wal');
  fs.writeFileSync(path.join(path.dirname(file), 'unrelated.sqlite'), 'unrelated');
  const legacy = path.join(root, 'pi-sessions', 'session-1', 'history.jsonl');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, 'retired');
  expect(hasDurableSession(root, 'session-1')).toBe(true);
  expect(listDurableSessionFiles(root)).toEqual([file]);
  expect(fs.readFileSync(legacy, 'utf8')).toBe('retired');
});

test('explicit invalidation removes only the selected native database and its SQLite sidecars', async () => {
  const selected = durableSessionFile(root, 'a/b');
  const other = durableSessionFile(root, 'a_b');
  fs.mkdirSync(path.dirname(selected), { recursive: true });
  for (const file of [selected, `${selected}-wal`, `${selected}-shm`, other])
    fs.writeFileSync(file, 'content');
  await invalidateDurableSession(root, 'a/b');
  expect(hasDurableSession(root, 'a/b')).toBe(false);
  expect(fs.existsSync(`${selected}-wal`)).toBe(false);
  expect(fs.existsSync(`${selected}-shm`)).toBe(false);
  expect(fs.readFileSync(other, 'utf8')).toBe('content');
  await invalidateDurableSession(root, 'absent');
  expect(listDurableSessionFiles(root)).toEqual([other]);
});
