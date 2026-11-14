/** Adapter routing to the native execution store; real reopen/replay lives in durableRuntime tests. */
import {
  adapter,
  createTemporaryPiSessionRoot,
  createTemporaryWorkspace,
  mockCreateAgentSession,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { durableSessionFile, hasDurableSession } from './durableSessionStore';

function seedRuntimeFile(root: string, sessionId: string): string {
  const file = durableSessionFile(root, sessionId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'The application factory owns opening this file.');
  return file;
}

function projectedHistory() {
  return {
    addMessage: vi.fn((_id: string, message: unknown) => message),
    getSession: () => ({
      messages: [{ id: 'old', type: 'user', content: 'Projected old turn' }],
      experts: [],
    }),
    updateSession: vi.fn(),
  };
}

describe('adapter native Durable persistence', () => {
  setupPiRuntimeAdapterSuite();

  it('routes every new session to a stable native SQLite file', async () => {
    const root = createTemporaryPiSessionRoot();
    const workspaceRoot = createTemporaryWorkspace();
    adapter.setPiSessionStoreRoot(root);
    await adapter.startSession('persist-new', 'First prompt', { workspaceRoot });
    const options = mockCreateAgentSession.mock.calls[0][0];
    expect(options).toEqual(
      expect.objectContaining({
        cwd: workspaceRoot,
        durableFile: durableSessionFile(root, 'persist-new'),
      }),
    );
    expect(options).not.toHaveProperty('sessionManager');
  });

  it('refuses execution when native persistence was not initialized', async () => {
    adapter.on('error', () => {});
    adapter.setPiSessionStoreRoot('');
    await expect(adapter.startSession('persist-none', 'First prompt')).rejects.toThrow(
      'Durable session persistence is not initialized.',
    );
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it('reuses the same native store after an idle session is recreated', async () => {
    const root = createTemporaryPiSessionRoot();
    adapter.setPiSessionStoreRoot(root);
    adapter.setCoworkStore(projectedHistory() as never);
    const file = seedRuntimeFile(root, 'persist-reopen');
    await adapter.startSession('persist-reopen', 'First prompt');
    adapter.stopSession('persist-reopen');
    mockSession.prompt.mockClear();
    await adapter.continueSession('persist-reopen', 'Follow-up');
    expect(mockCreateAgentSession.mock.calls.map(call => call[0].durableFile)).toEqual([
      file,
      file,
    ]);
    expect(mockSession.prompt).toHaveBeenCalledExactlyOnceWith('Follow-up');
  });

  it('keeps the application transcript as a projection instead of synthesizing model history', async () => {
    adapter.setCoworkStore(projectedHistory() as never);
    await adapter.continueSession('projection-only', 'New question');
    expect(mockSession.prompt).toHaveBeenCalledExactlyOnceWith('New question');
    expect(String(mockSession.prompt.mock.calls[0][0])).not.toContain('Projected old turn');
  });

  it('invalidates only the current execution store and its SQLite side files', async () => {
    const root = createTemporaryPiSessionRoot();
    adapter.setPiSessionStoreRoot(root);
    const file = seedRuntimeFile(root, 'invalidate');
    writeFileSync(file + '-wal', 'checkpoint');
    writeFileSync(file + '-shm', 'shared memory');
    const untouched = path.join(root, 'old-session-data.jsonl');
    writeFileSync(untouched, 'Retired user data remains untouched.');
    await adapter.invalidatePiSessionDir('invalidate');
    expect(hasDurableSession(root, 'invalidate')).toBe(false);
    expect(existsSync(file + '-wal')).toBe(false);
    expect(existsSync(file + '-shm')).toBe(false);
    expect(existsSync(untouched)).toBe(true);
  });

  it('deletes the native execution file when its owning application session is deleted', async () => {
    const root = createTemporaryPiSessionRoot();
    adapter.setPiSessionStoreRoot(root);
    adapter.setCoworkStore(projectedHistory() as never);
    const file = seedRuntimeFile(root, 'persist-delete');
    await adapter.startSession('persist-delete', 'Hello');
    await adapter.onSessionDeleted('persist-delete');
    expect(existsSync(file)).toBe(false);
    expect(mockSession.abort).toHaveBeenCalled();
  });

  it('keeps the native store identity across a model-override rebuild', async () => {
    const root = createTemporaryPiSessionRoot();
    adapter.setPiSessionStoreRoot(root);
    const file = seedRuntimeFile(root, 'persist-model');
    await adapter.startSession('persist-model', 'First', { modelOverride: 'llamacpp/qwen-local' });
    mockSession.prompt.mockClear();
    await adapter.continueSession('persist-model', 'After switch', {
      modelOverride: 'moonshot/kimi-k2.6',
    });
    expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
    expect(mockCreateAgentSession.mock.calls.map(call => call[0].durableFile)).toEqual([
      file,
      file,
    ]);
    expect(mockSession.prompt).toHaveBeenCalledExactlyOnceWith('After switch');
  });
});
