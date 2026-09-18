import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CoworkErrorKind, type CoworkError } from '../common/coworkError';
import { CoworkMessageType, CoworkSessionStatus } from '../shared/cowork/constants';
import { CoworkStore, type CoworkMessage } from './coworkStore';
import { persistCoworkTerminalError } from './coworkTerminalErrorPersistence';

vi.mock('electron', () => ({ app: { getAppPath: () => '/mock' } }));

let db: Database.Database;
let store: CoworkStore;
const sessionId = 'session-1';
const modelError: CoworkError = {
  kind: CoworkErrorKind.ModelNotFound,
  message: 'Selected model is unavailable.',
};

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY, status TEXT, updated_at INTEGER);
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY, session_id TEXT, type TEXT, content TEXT,
      metadata TEXT, created_at INTEGER, sequence INTEGER
    );
  `);
  db.prepare('INSERT INTO cowork_sessions VALUES (?, ?, 0)').run(
    sessionId,
    CoworkSessionStatus.Running,
  );
  store = new CoworkStore(db);
  store.addMessage(sessionId, { type: CoworkMessageType.User, content: 'Create a presentation.' });
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

test('commits initialization errors before emitting and preserves them on history reload', () => {
  let emitted: CoworkMessage | undefined;
  persistCoworkTerminalError(db, store, sessionId, modelError, message => {
    expect(db.inTransaction).toBe(false);
    expect(store.getPagedSessionMessages(sessionId, 10, 0).at(-1)).toEqual(message);
    emitted = message;
  });

  const reloaded = new CoworkStore(db).getPagedSessionMessages(sessionId, 10, 0);
  expect(reloaded).toHaveLength(2);
  expect(reloaded[1]).toEqual(emitted);
  expect(reloaded[1].metadata).toEqual({ error: modelError.message, errorKind: modelError.kind });
  expect(db.prepare('SELECT status FROM cowork_sessions WHERE id = ?').get(sessionId)).toEqual({
    status: CoworkSessionStatus.Error,
  });
});

test('does not duplicate a runtime-persisted terminal error or a repeated error event', () => {
  store.addMessage(sessionId, {
    type: CoworkMessageType.System,
    content: '',
    metadata: { error: modelError.message, errorKind: modelError.kind },
  });
  const emit = vi.fn();
  persistCoworkTerminalError(db, store, sessionId, modelError, emit);
  persistCoworkTerminalError(db, store, sessionId, modelError, emit);
  expect(store.countSessionMessages(sessionId)).toBe(2);
  expect(emit).not.toHaveBeenCalled();
});

test('persists the same error again after a new user request', () => {
  const emit = vi.fn();
  persistCoworkTerminalError(db, store, sessionId, modelError, emit);
  store.addMessage(sessionId, { type: CoworkMessageType.User, content: 'Retry.' });
  persistCoworkTerminalError(db, store, sessionId, modelError, emit);
  expect(store.countSessionMessages(sessionId)).toBe(4);
  expect(emit).toHaveBeenCalledTimes(2);
  expect(emit.mock.calls[0][0].id).not.toBe(emit.mock.calls[1][0].id);
});

test('does not deduplicate errors with a different classified kind', () => {
  const emit = vi.fn();
  persistCoworkTerminalError(db, store, sessionId, modelError, emit);
  persistCoworkTerminalError(
    db,
    store,
    sessionId,
    { ...modelError, kind: CoworkErrorKind.NetworkError },
    emit,
  );
  expect(emit).toHaveBeenCalledTimes(2);
});

test('does not recreate messages for a deleted session', () => {
  db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run(sessionId);
  const emit = vi.fn();
  persistCoworkTerminalError(db, store, sessionId, modelError, emit);
  expect(store.countSessionMessages(sessionId)).toBe(1);
  expect(emit).not.toHaveBeenCalled();
});

test('does not parse corrupt metadata when inspecting the latest message', () => {
  db.prepare('UPDATE cowork_messages SET type = ?, metadata = ?').run(
    CoworkMessageType.System,
    '{invalid json',
  );
  const emit = vi.fn();
  persistCoworkTerminalError(db, store, sessionId, modelError, emit);
  expect(emit).toHaveBeenCalledOnce();
});

test('rolls back a failed write without emitting an unpersisted message', () => {
  vi.spyOn(store, 'addMessage').mockImplementation(() => {
    throw new Error('Write failed.');
  });
  const emit = vi.fn();
  expect(() => persistCoworkTerminalError(db, store, sessionId, modelError, emit)).toThrow(
    'Write failed.',
  );
  expect(store.countSessionMessages(sessionId)).toBe(1);
  expect(db.prepare('SELECT status FROM cowork_sessions WHERE id = ?').get(sessionId)).toEqual({
    status: CoworkSessionStatus.Running,
  });
  expect(emit).not.toHaveBeenCalled();
});

test('updates status without creating an empty error bubble', () => {
  const emit = vi.fn();
  persistCoworkTerminalError(db, store, sessionId, { ...modelError, message: '' }, emit);
  expect(store.countSessionMessages(sessionId)).toBe(1);
  expect(emit).not.toHaveBeenCalled();
  expect(db.prepare('SELECT status FROM cowork_sessions WHERE id = ?').get(sessionId)).toEqual({
    status: CoworkSessionStatus.Error,
  });
});
