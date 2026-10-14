import { beforeEach, expect, test } from 'vitest';

import BetterSqlite3 from 'better-sqlite3';

import { WorkspaceFolderRepository } from './workspaceFolderRepository';

let db: BetterSqlite3.Database;
let repository: WorkspaceFolderRepository;

beforeEach(() => {
  db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE workspace_folders (
      workspace_id TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, path)
    );
  `);
  repository = new WorkspaceFolderRepository(db);
});

test('replaces folders in order and drops previous rows', () => {
  repository.replaceFolders('ws-1', ['/a', '/b']);
  repository.replaceFolders('ws-1', ['/c']);

  expect(repository.listFolders('ws-1')).toEqual(['/c']);
});

test('normalizes, dedupes and skips empty folders', () => {
  repository.replaceFolders('ws-1', ['  /a  ', '/a', '', '   ', '/b']);

  expect(repository.listFolders('ws-1')).toEqual(['/a', '/b']);
});

test('keeps folder lists isolated per workspace', () => {
  repository.replaceFolders('ws-1', ['/a']);
  repository.replaceFolders('ws-2', ['/b', '/c']);

  expect(repository.listFolders('ws-1')).toEqual(['/a']);
  expect(repository.listFolders('ws-2')).toEqual(['/b', '/c']);
});

test('clears folders when replacing with an empty list', () => {
  repository.replaceFolders('ws-1', ['/a']);
  repository.replaceFolders('ws-1', []);

  expect(repository.listFolders('ws-1')).toEqual([]);
});

test('transfers folders to a replacement workspace id', () => {
  repository.replaceFolders('ws-old', ['/a', '/b']);
  repository.transferFolders('ws-old', 'ws-new');

  expect(repository.listFolders('ws-old')).toEqual([]);
  expect(repository.listFolders('ws-new')).toEqual(['/a', '/b']);
});

test('transfer to the same id is a no-op', () => {
  repository.replaceFolders('ws-1', ['/a']);
  repository.transferFolders('ws-1', 'ws-1');

  expect(repository.listFolders('ws-1')).toEqual(['/a']);
});

test('deleteFolders removes only the target workspace rows', () => {
  repository.replaceFolders('ws-1', ['/a']);
  repository.replaceFolders('ws-2', ['/b']);
  repository.deleteFolders('ws-1');

  expect(repository.listFolders('ws-1')).toEqual([]);
  expect(repository.listFolders('ws-2')).toEqual(['/b']);
});

test('listAllByWorkspace groups folders by workspace', () => {
  repository.replaceFolders('ws-1', ['/a', '/b']);
  repository.replaceFolders('ws-2', ['/c']);

  const grouped = repository.listAllByWorkspace();
  expect(grouped.get('ws-1')).toEqual(['/a', '/b']);
  expect(grouped.get('ws-2')).toEqual(['/c']);
});
