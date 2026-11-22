/**
 * PiRuntimeAdapter unit tests: file-backed Pi session persistence.
 *
 * Covers the rebuild matrix of the persistent session store: eviction (and
 * any other rebuild) reopens the JSONL and sends only the new prompt; a
 * session without a file starts with empty context; session delete removes the
 * directory; a model-override change keeps history by reopening the file.
 *
 * The shared mocks live in piRuntimeAdapter.testHarness.ts (imported first
 * so the Pi SDK mocks are registered before any module under test loads).
 */

import fs from 'fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import {
  createTestPiRuntime,
  adapter,
  createTemporaryPiSessionRoot,
  createTemporaryWorkspace,
  mockCreateAgentSession,
  mockSession,
  mockSessionManagerCreate,
  mockSessionManagerInMemory,
  mockSessionManagerOpen,
  seedPersistedPiSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';
import { openPersistentPiSessionManager, piSessionDirFor } from './piSessionStore';
import type { CoworkStore } from '../../coworkStore';

/** SQLite transcript double used to test native history restores. */
const createStoreWithHistory = (
  messages: Array<{ id: string; type: string; content: string; metadata?: unknown }>,
): { store: CoworkStore; addMessage: ReturnType<typeof vi.fn> } => {
  const persisted = [...messages];
  const addMessage = vi.fn((_sessionId: string, message: { type: string }) => {
    persisted.push(message as (typeof persisted)[number]);
    return { ...message, id: `stored-${persisted.length}`, timestamp: 1 };
  });
  const store = {
    messages: {
      addMessage,
      getSessionMessageStats: () => ({
        messageCount: persisted.length,
        contentBytes: persisted.reduce((total, m) => total + m.content.length, 0),
        metadataBytes: 0,
      }),
    },
    getPiHistoryKey: () => null,
    getSession: () => ({ messages: persisted, experts: [] }),
    updateSession: vi.fn(),
  } as unknown as CoworkStore;
  return { store, addMessage };
};

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('file-backed Pi session persistence', () => {
    it('opens the latest JSONL file when history contains multiple candidates', async () => {
      const root = createTemporaryPiSessionRoot();
      const adapter = createTestPiRuntime({
        piSessionStoreRoot: root,
        coworkStore: createStoreWithHistory([]).store,
      });
      const previousFile = seedPersistedPiSession(root, 'persist-newest');
      const newerFile = path.join(path.dirname(previousFile), 'newer.jsonl');
      fs.copyFileSync(previousFile, newerFile);
      fs.utimesSync(previousFile, 1, 1);

      await adapter.startSession('persist-newest', 'Next prompt');

      expect(mockSessionManagerOpen).toHaveBeenCalledWith(
        newerFile,
        path.dirname(newerFile),
        expect.any(String),
      );
    });

    it('does not open or recreate native history when lookup is cancelled', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspace = createTemporaryWorkspace();
      seedPersistedPiSession(root, 'persist-cancelled');
      const abort = new AbortController();
      const opening = openPersistentPiSessionManager(
        { open: mockSessionManagerOpen, create: mockSessionManagerCreate },
        root,
        'persist-cancelled',
        workspace,
        abort.signal,
      );
      abort.abort();

      await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
      expect(mockSessionManagerOpen).not.toHaveBeenCalled();
      expect(mockSessionManagerCreate).not.toHaveBeenCalled();
    });

    it.each(['readdir', 'stat'] as const)(
      'does not start a new transcript when native history %s fails',
      async operation => {
        const root = createTemporaryPiSessionRoot();
        const sessionId = 'persist-unreadable';
        const previousFile = seedPersistedPiSession(root, sessionId);
        const adapter = createTestPiRuntime({
          piSessionStoreRoot: root,
          coworkStore: createStoreWithHistory([]).store,
        });
        const reportError = vi.fn();
        adapter.on('error', reportError);
        const target = operation === 'readdir' ? path.dirname(previousFile) : previousFile;
        const failure = Object.assign(new Error('Fixture history read failure'), { code: 'EIO' });
        const original = fs.promises[operation];
        const read = vi
          .spyOn(fs.promises, operation)
          .mockImplementation(((...args: Parameters<typeof original>) =>
            args[0] === target
              ? Promise.reject(failure)
              : Reflect.apply(original, fs.promises, args)) as typeof original);
        try {
          await expect(adapter.startSession(sessionId, 'Do not abandon history')).rejects.toBe(
            failure,
          );
          expect(mockSessionManagerCreate).not.toHaveBeenCalled();
          expect(mockSessionManagerOpen).not.toHaveBeenCalled();
          expect(mockSession.prompt).not.toHaveBeenCalled();
          expect(reportError).toHaveBeenCalledOnce();
        } finally {
          read.mockRestore();
        }

        await adapter.startSession(sessionId, 'Retry');
        expect(mockSessionManagerOpen).toHaveBeenCalledWith(
          previousFile,
          path.dirname(previousFile),
          expect.any(String),
        );
        expect(mockSession.prompt).toHaveBeenCalledOnce();
        expect(mockSession.prompt.mock.calls[0]?.[0]).toBe('Retry');
      },
    );

    it('creates a persistent session manager under the session store root', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspaceRoot = createTemporaryWorkspace();
      const adapter = createTestPiRuntime({
        piSessionStoreRoot: root,
        coworkStore: createStoreWithHistory([]).store,
      });

      await adapter.startSession('persist-new', 'First prompt', { workspaceRoot });

      expect(mockSessionManagerCreate).toHaveBeenCalledTimes(1);
      expect(mockSessionManagerInMemory).not.toHaveBeenCalled();
      const createArgs = mockSessionManagerCreate.mock.calls[0];
      expect(createArgs?.[0]).toBe(workspaceRoot);
      expect(createArgs?.[1]).toBe(piSessionDirFor(root, 'persist-new'));
      const launchOptions = mockCreateAgentSession.mock.calls[0]?.[0] as
        | { sessionManager?: unknown }
        | undefined;
      expect(launchOptions?.sessionManager).toBe(mockSessionManagerCreate.mock.results[0]?.value);
    });

    it('falls back to the in-memory manager without an injected root', async () => {
      await adapter.startSession('persist-none', 'First prompt');

      expect(mockSessionManagerInMemory).toHaveBeenCalledTimes(1);
      expect(mockSessionManagerCreate).not.toHaveBeenCalled();
      expect(mockSessionManagerOpen).not.toHaveBeenCalled();
    });

    it('reopens the session file on a rebuild and sends only the new prompt', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspaceRoot = createTemporaryWorkspace();
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Earlier turn' },
      ]);
      const adapter = createTestPiRuntime({ piSessionStoreRoot: root, coworkStore: store });
      const sessionFile = seedPersistedPiSession(root, 'persist-evict');

      await adapter.startSession('persist-evict', 'First prompt', { workspaceRoot });
      // The seeded file existed before the first launch, so that launch
      // already reopened it; stopping drops the live Pi session, exactly like
      // an idle eviction or an app restart, and the next turn rebuilds.
      adapter.stopSession('persist-evict');

      mockSession.prompt.mockClear();
      await adapter.continueSession('persist-evict', 'Follow-up');

      expect(mockSessionManagerOpen).toHaveBeenCalledTimes(2);
      expect(mockSessionManagerOpen).toHaveBeenLastCalledWith(
        sessionFile,
        piSessionDirFor(root, 'persist-evict'),
        expect.any(String),
      );
      // Only the new prompt: no flattened history block.
      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(mockSession.prompt.mock.calls[0]?.[0]).toBe('Follow-up');
      expect(String(mockSession.prompt.mock.calls[0]?.[0])).not.toContain('PREVIOUS CONVERSATION');
    });

    it('starts a clean session without flattened history when no persisted JSONL file exists', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspaceRoot = createTemporaryWorkspace();
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Legacy question' },
        { id: 'a1', type: 'assistant', content: 'Legacy answer' },
      ]);
      const adapter = createTestPiRuntime({ piSessionStoreRoot: root, coworkStore: store });

      // Without a seeded JSONL file, continuation creates a new persisted session
      // directly with the new prompt rather than synthesizing flat-text history.
      await adapter.continueSession('persist-legacy', 'Next question', { workspaceRoot });
      expect(mockSessionManagerOpen).not.toHaveBeenCalled();
      expect(mockSessionManagerCreate).toHaveBeenCalledTimes(1);
      const firstPrompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(firstPrompt).toBe('Next question');
      expect(firstPrompt).not.toContain('PREVIOUS CONVERSATION');
      expect(mockSessionManagerCreate).toHaveBeenCalledWith(
        workspaceRoot,
        piSessionDirFor(root, 'persist-legacy'),
      );

      // Once the file exists on disk, later rebuilds reopen it.
      seedPersistedPiSession(root, 'persist-legacy');
      adapter.stopSession('persist-legacy');
      mockSession.prompt.mockClear();
      await adapter.continueSession('persist-legacy', 'Later question');
      expect(mockSessionManagerOpen).toHaveBeenCalledTimes(1);
      const secondPrompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(secondPrompt).toBe('Later question');
    });

    it('invalidates a corrupted persisted directory and recreates it cleanly', async () => {
      const root = createTemporaryPiSessionRoot();
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Imported turn' },
      ]);
      const adapter = createTestPiRuntime({ piSessionStoreRoot: root, coworkStore: store });
      seedPersistedPiSession(root, 'persist-diverge');

      await adapter.invalidatePiSessionDir('persist-diverge');
      expect(fs.existsSync(piSessionDirFor(root, 'persist-diverge'))).toBe(false);

      await adapter.continueSession('persist-diverge', 'After import');
      expect(mockSessionManagerOpen).not.toHaveBeenCalled();
      const prompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(prompt).toBe('After import');
    });

    it('removes the directory when the cowork session is deleted', async () => {
      const root = createTemporaryPiSessionRoot();
      const adapter = createTestPiRuntime({
        piSessionStoreRoot: root,
        coworkStore: createStoreWithHistory([]).store,
      });
      seedPersistedPiSession(root, 'persist-delete');
      await adapter.startSession('persist-delete', 'Hello');

      await adapter.onSessionDeleted('persist-delete');

      expect(fs.existsSync(piSessionDirFor(root, 'persist-delete'))).toBe(false);
      expect(mockSession.abort).toHaveBeenCalled();
    });

    it('keeps history across a model-override change by reopening the file', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspaceRoot = createTemporaryWorkspace();
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Before model switch' },
      ]);
      const adapter = createTestPiRuntime({ piSessionStoreRoot: root, coworkStore: store });
      seedPersistedPiSession(root, 'persist-model');

      await adapter.startSession('persist-model', 'First', {
        workspaceRoot,
        modelOverride: 'llamacpp/qwen-local',
      });
      mockSession.prompt.mockClear();

      await adapter.continueSession('persist-model', 'After switch', {
        modelOverride: 'moonshot/kimi-k2.6',
      });

      // The rebuild recreated the Pi session…
      expect(mockCreateAgentSession.mock.calls.length).toBeGreaterThanOrEqual(2);
      // …by reopening the persisted file, not by flattening the transcript.
      expect(mockSessionManagerOpen).toHaveBeenCalledWith(
        path.join(piSessionDirFor(root, 'persist-model'), '2026-01-01T00-00-00-000Z_seed.jsonl'),
        piSessionDirFor(root, 'persist-model'),
        expect.any(String),
      );
      const prompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(prompt).toBe('After switch');
      expect(prompt).not.toContain('PREVIOUS CONVERSATION');
    });
  });
});
