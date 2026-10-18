/**
 * PiRuntimeAdapter unit tests: file-backed Pi session persistence.
 *
 * Covers the rebuild matrix of the persistent session store: eviction (and
 * any other rebuild) reopens the JSONL and sends only the new prompt; a
 * legacy session without a file uses the flattened text fallback exactly
 * once; transcript invalidation drops the file; session delete removes the
 * directory; a model-override change keeps history by reopening the file.
 *
 * The shared mocks live in piRuntimeAdapter.testHarness.ts (imported first
 * so the Pi SDK mocks are registered before any module under test loads).
 */

import fs from 'fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import {
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
import { hasPersistedPiSession, piSessionDirFor } from './piSessionStore';
import type { CoworkStore } from '../../coworkStore';

/** Store double with paged tail reads, the surface history restore relies on. */
const createStoreWithHistory = (
  messages: Array<{ id: string; type: string; content: string; metadata?: unknown }>,
): { store: CoworkStore; addMessage: ReturnType<typeof vi.fn> } => {
  const persisted = [...messages];
  const addMessage = vi.fn((_sessionId: string, message: { type: string }) => {
    persisted.push(message as (typeof persisted)[number]);
    return { ...message, id: `stored-${persisted.length}`, timestamp: 1 };
  });
  const store = {
    addMessage,
    getSessionMessagesDesc: (_sessionId: string, limit: number, offset: number) =>
      [...persisted].reverse().slice(offset, offset + limit),
    getSessionMessageStats: () => ({
      messageCount: persisted.length,
      contentBytes: persisted.reduce((total, m) => total + m.content.length, 0),
      metadataBytes: 0,
    }),
    getSession: () => ({ messages: persisted, experts: [] }),
    updateSession: vi.fn(),
  } as unknown as CoworkStore;
  return { store, addMessage };
};

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('file-backed Pi session persistence', () => {
    it('creates a persistent session manager under the session store root', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspaceRoot = createTemporaryWorkspace();
      adapter.setPiSessionStoreRoot(root);
      adapter.setCoworkStore(createStoreWithHistory([]).store);

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
      adapter.setPiSessionStoreRoot(root);
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Earlier turn' },
      ]);
      adapter.setCoworkStore(store);
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

    it('uses the text fallback exactly once for a legacy session, then the file', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspaceRoot = createTemporaryWorkspace();
      adapter.setPiSessionStoreRoot(root);
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Legacy question' },
        { id: 'a1', type: 'assistant', content: 'Legacy answer' },
      ]);
      adapter.setCoworkStore(store);

      // No seeded file: this session predates file persistence, so after an
      // app restart its follow-up arrives on a session that is not active.
      await adapter.continueSession('persist-legacy', 'Next question', { workspaceRoot });
      expect(mockSessionManagerOpen).not.toHaveBeenCalled();
      expect(mockSessionManagerCreate).toHaveBeenCalledTimes(1);
      const firstPrompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(firstPrompt).toContain('PREVIOUS CONVERSATION');
      expect(firstPrompt).toContain('Legacy answer');
      expect(firstPrompt).toContain('Next question');
      // The fallback turn itself runs on the persistent manager targeting
      // this session's directory, so the turn writes the file.
      expect(mockSessionManagerCreate).toHaveBeenCalledWith(
        workspaceRoot,
        piSessionDirFor(root, 'persist-legacy'),
      );

      // Next rebuild: the file exists, so only the new prompt travels. A
      // stopped session always rebuilds (the live Pi session is dropped), the
      // same path an idle eviction or app restart takes.
      seedPersistedPiSession(root, 'persist-legacy');
      adapter.stopSession('persist-legacy');
      mockSession.prompt.mockClear();
      await adapter.continueSession('persist-legacy', 'Later question');
      expect(mockSessionManagerOpen).toHaveBeenCalledTimes(1);
      const secondPrompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(secondPrompt).toBe('Later question');
    });

    it('invalidates the directory and returns to the fallback after a divergence', async () => {
      const root = createTemporaryPiSessionRoot();
      adapter.setPiSessionStoreRoot(root);
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Imported turn' },
      ]);
      adapter.setCoworkStore(store);
      seedPersistedPiSession(root, 'persist-diverge');

      adapter.invalidatePiSessionDir('persist-diverge');
      expect(hasPersistedPiSession(root, 'persist-diverge')).toBe(false);
      expect(fs.existsSync(piSessionDirFor(root, 'persist-diverge'))).toBe(false);

      await adapter.continueSession('persist-diverge', 'After import');
      expect(mockSessionManagerOpen).not.toHaveBeenCalled();
      const prompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(prompt).toContain('PREVIOUS CONVERSATION');
      expect(prompt).toContain('Imported turn');
    });

    it('removes the directory when the cowork session is deleted', async () => {
      const root = createTemporaryPiSessionRoot();
      adapter.setPiSessionStoreRoot(root);
      adapter.setCoworkStore(createStoreWithHistory([]).store);
      seedPersistedPiSession(root, 'persist-delete');
      await adapter.startSession('persist-delete', 'Hello');

      adapter.onSessionDeleted('persist-delete');

      expect(fs.existsSync(piSessionDirFor(root, 'persist-delete'))).toBe(false);
      expect(mockSession.abort).toHaveBeenCalled();
    });

    it('keeps history across a model-override change by reopening the file', async () => {
      const root = createTemporaryPiSessionRoot();
      const workspaceRoot = createTemporaryWorkspace();
      adapter.setPiSessionStoreRoot(root);
      const { store } = createStoreWithHistory([
        { id: 'u1', type: 'user', content: 'Before model switch' },
      ]);
      adapter.setCoworkStore(store);
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
