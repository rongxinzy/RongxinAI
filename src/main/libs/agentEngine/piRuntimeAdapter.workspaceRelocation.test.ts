import {
  createTestPiRuntime,
  createTemporaryPiSessionRoot,
  createTemporaryWorkspace,
  mockCreateAgentSession,
  mockDefaultResourceLoader,
  mockSession,
  mockSessionManagerOpen,
  seedPersistedPiSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import { afterEach, expect, test, vi } from 'vitest';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import type { CoworkStore } from '../../coworkStore';
import type { ProjectMemoryService } from '../../memory/projectMemoryService';
import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { piSessionDirFor } from './piSessionStore';

setupPiRuntimeAdapterSuite();
let adapter: PiRuntimeAdapter;
afterEach(() => adapter.stopAllSessions());

test.each(Object.values(CoworkSessionMode))(
  'recreates a %s session when its workspace changes',
  async sessionMode => {
    const workspaceA = createTemporaryWorkspace();
    const workspaceB = createTemporaryWorkspace();
    const root = createTemporaryPiSessionRoot();
    const sessionId = 'relocated-session';
    adapter = createTestPiRuntime({ piSessionStoreRoot: root });
    await adapter.startSession(sessionId, 'First prompt', {
      workspaceRoot: workspaceA,
      sessionMode,
    });
    const previous = adapter.activeSessions.get(sessionId)!;
    const unsubscribe = vi.fn();
    previous.unsubscribe = unsubscribe;
    const sessionFile = seedPersistedPiSession(root, sessionId);

    await adapter.continueSession(sessionId, 'Only the new prompt', {
      workspaceRoot: workspaceB,
      sessionMode,
    });

    expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
    expect(mockCreateAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: workspaceB }),
    );
    expect(mockDefaultResourceLoader).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: workspaceB }),
    );
    expect(adapter.activeSessions.get(sessionId)?.settingsManager).not.toBe(
      previous.settingsManager,
    );
    expect(mockSessionManagerOpen).toHaveBeenLastCalledWith(
      sessionFile,
      piSessionDirFor(root, sessionId),
      workspaceB,
    );
    expect(adapter.activeSessions.get(sessionId)?.workspaceRoot).toBe(workspaceB);
    expect(adapter.activeSessions.get(sessionId)).not.toBe(previous);
    expect(previous.abortController.signal.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(mockSession.dispose).toHaveBeenCalledOnce();
    expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    expect(mockSession.prompt).toHaveBeenLastCalledWith('Only the new prompt');
  },
);

test.each([false, true])(
  'keeps the live session when cwd is unchanged or omitted (%s)',
  async omit => {
    const workspaceRoot = createTemporaryWorkspace();
    adapter = createTestPiRuntime();
    await adapter.startSession('unchanged', 'First prompt', { workspaceRoot });
    const previous = adapter.activeSessions.get('unchanged');

    await adapter.continueSession('unchanged', 'Next prompt', omit ? {} : { workspaceRoot });

    expect(mockCreateAgentSession).toHaveBeenCalledOnce();
    expect(mockSession.dispose).not.toHaveBeenCalled();
    expect(adapter.activeSessions.get('unchanged')).toBe(previous);
    expect(mockSession.prompt).toHaveBeenLastCalledWith('Next prompt');
  },
);

test.each([false, true])('preserves skip-user-message semantics on relocation (%s)', async skip => {
  const addMessage = vi.fn((_id: string, message: Record<string, unknown>) => message);
  adapter = createTestPiRuntime({
    coworkStore: {
      messages: { addMessage },
      updateSession: vi.fn(),
      getSession: () => ({ experts: [], messages: [] }),
    } as unknown as CoworkStore,
  });
  await adapter.startSession('skip-user', 'First prompt', {
    workspaceRoot: createTemporaryWorkspace(),
  });
  addMessage.mockClear();

  await adapter.continueSession('skip-user', 'Next prompt', {
    workspaceRoot: createTemporaryWorkspace(),
    _skipUserMessage: skip,
  });

  expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
  expect(addMessage.mock.calls.filter(([, message]) => message.type === 'user')).toHaveLength(
    skip ? 0 : 1,
  );
  expect(mockSession.prompt).toHaveBeenLastCalledWith('Next prompt');
});

test('rebinds project memory to the new workspace', async () => {
  const workspaceA = createTemporaryWorkspace();
  const workspaceB = createTemporaryWorkspace();
  const registerSession = vi.fn().mockResolvedValue(undefined);
  const buildProjectContext = vi.fn().mockResolvedValue(null);
  adapter = createTestPiRuntime({
    projectMemoryService: {
      registerSession,
      buildProjectContext,
    } as unknown as ProjectMemoryService,
  });
  await adapter.startSession('memory-relocation', 'First prompt', { workspaceRoot: workspaceA });

  await adapter.continueSession('memory-relocation', 'Next prompt', { workspaceRoot: workspaceB });

  expect(registerSession).toHaveBeenNthCalledWith(1, 'memory-relocation', workspaceA);
  expect(registerSession).toHaveBeenNthCalledWith(2, 'memory-relocation', workspaceB);
  expect(buildProjectContext).toHaveBeenLastCalledWith({
    workingDirectory: workspaceB,
    sessionId: 'memory-relocation',
    query: 'Next prompt',
    signal: expect.any(AbortSignal),
  });
});
