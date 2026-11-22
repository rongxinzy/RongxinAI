import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { classifyCoworkError, CoworkErrorKind, type CoworkError } from '../common/coworkError';
import { CoworkMessageType, CoworkSessionStatus } from '../shared/cowork/constants';
import { CoworkStore, type CoworkMessage } from './coworkStore';
import { PiRuntimeAdapter } from './libs/agentEngine/piRuntimeAdapter';

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
  store.messages.addMessage(sessionId, {
    type: CoworkMessageType.User,
    content: 'Create a presentation.',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

test('commits initialization errors before emitting and preserves them on history reload', () => {
  const runtime = new PiRuntimeAdapter({ coworkStore: store });
  const order: string[] = [];
  let emitted: CoworkMessage | undefined;
  runtime.on('message', (id, message) => {
    expect(id).toBe(sessionId);
    expect(db.inTransaction).toBe(false);
    expect(store.messages.getPagedSessionMessages(sessionId, 10, 0).at(-1)).toEqual(message);
    emitted = message;
    order.push('message');
  });
  runtime.on('error', (id, error) => {
    expect(id).toBe(sessionId);
    expect(error).toEqual(modelError);
    order.push('error');
  });
  runtime.recovery.reportSessionError(sessionId, modelError);
  expect(order).toEqual(['message', 'error']);

  const reloaded = new CoworkStore(db).messages.getPagedSessionMessages(sessionId, 10, 0);
  expect(reloaded).toHaveLength(2);
  expect(reloaded[1]).toEqual(emitted);
  expect(reloaded[1].metadata).toEqual({ error: modelError.message, errorKind: modelError.kind });
  expect(db.prepare('SELECT status FROM cowork_sessions WHERE id = ?').get(sessionId)).toEqual({
    status: CoworkSessionStatus.Error,
  });
});

test('does not write a repeated terminal error again', () => {
  const emit = vi.fn();
  store.recordTerminalError(sessionId, modelError, emit);
  const write = vi.spyOn(store, 'updateSession');
  store.recordTerminalError(sessionId, modelError, emit);
  expect(store.messages.countSessionMessages(sessionId)).toBe(2);
  expect(emit).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
});

test('a rejected submission uses the same durable error and publication path', () => {
  const runtime = new PiRuntimeAdapter({ coworkStore: store });
  const published = vi.fn();
  runtime.on('message', (_id, message) => published('message', message.metadata?.error));
  runtime.on('error', (_id, error) => published('error', error.message));
  const first = 'Request timed out';
  const next = 'No enabled provider found for model: qwen-local';

  runtime.recovery.reportSessionError(sessionId, classifyCoworkError(first));
  runtime.recovery.reportRejectedSubmission(sessionId, first);
  runtime.recovery.reportRejectedSubmission(sessionId, new Error(next));

  expect(published.mock.calls).toEqual([
    ['message', first],
    ['error', first],
    ['message', next],
    ['error', next],
  ]);
  expect(store.messages.countSessionMessages(sessionId)).toBe(3);
  expect(store.messages.getPagedSessionMessages(sessionId, 10, 0).at(-1)?.metadata?.errorKind).toBe(
    CoworkErrorKind.ProviderUnavailable,
  );
});

test('persists the same error again after a new user request', () => {
  const emit = vi.fn();
  store.recordTerminalError(sessionId, modelError, emit);
  store.messages.addMessage(sessionId, { type: CoworkMessageType.User, content: 'Retry.' });
  store.recordTerminalError(sessionId, modelError, emit);
  expect(store.messages.countSessionMessages(sessionId)).toBe(4);
  expect(emit).toHaveBeenCalledTimes(2);
  expect(emit.mock.calls[0][0].id).not.toBe(emit.mock.calls[1][0].id);
});

test('does not deduplicate errors with a different classified kind', () => {
  const emit = vi.fn();
  store.recordTerminalError(sessionId, modelError, emit);
  store.recordTerminalError(sessionId, { ...modelError, kind: CoworkErrorKind.NetworkError }, emit);
  expect(emit).toHaveBeenCalledTimes(2);
});

test('does not recreate messages for a deleted session', () => {
  db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run(sessionId);
  const emit = vi.fn();
  store.recordTerminalError(sessionId, modelError, emit);
  expect(store.messages.countSessionMessages(sessionId)).toBe(1);
  expect(emit).not.toHaveBeenCalled();
});

test('does not parse corrupt metadata when inspecting the latest message', () => {
  db.prepare('UPDATE cowork_messages SET type = ?, metadata = ?').run(
    CoworkMessageType.System,
    '{invalid json',
  );
  const emit = vi.fn();
  store.recordTerminalError(sessionId, modelError, emit);
  expect(emit).toHaveBeenCalledOnce();
});

test('rolls back a failed write without emitting an unpersisted message', () => {
  vi.spyOn(store.messages, 'addMessage').mockImplementation(() => {
    throw new Error('Write failed.');
  });
  const emit = vi.fn();
  expect(() => store.recordTerminalError(sessionId, modelError, emit)).toThrow('Write failed.');
  expect(store.messages.countSessionMessages(sessionId)).toBe(1);
  expect(db.prepare('SELECT status FROM cowork_sessions WHERE id = ?').get(sessionId)).toEqual({
    status: CoworkSessionStatus.Running,
  });
  expect(emit).not.toHaveBeenCalled();
});

test('updates status without creating an empty error bubble', () => {
  const emit = vi.fn();
  store.recordTerminalError(sessionId, { ...modelError, message: '' }, emit);
  expect(store.messages.countSessionMessages(sessionId)).toBe(1);
  expect(emit).not.toHaveBeenCalled();
  expect(db.prepare('SELECT status FROM cowork_sessions WHERE id = ?').get(sessionId)).toEqual({
    status: CoworkSessionStatus.Error,
  });
});
