import {
  createTestPiRuntime,
  mockCreateAgentSession,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTick } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { ArtifactLedger } from '../../artifactLedger/artifactLedger';
import { ArtifactRecorder } from '../../artifactLedger/artifactRecorder';
import { CoworkStore } from '../../coworkStore';
import { SqliteStore } from '../../sqliteStore';
import { PiRuntimeAdapter } from './piRuntimeAdapter';

setupPiRuntimeAdapterSuite();

test('shutdown waits for Pi to become idle before disposing sessions already stopped', async () => {
  const adapter = createTestPiRuntime();
  await adapter.startSession('stopped', 'Start a command.');
  const abort = Promise.withResolvers<void>();
  mockSession.abort.mockReturnValueOnce(abort.promise);
  adapter.stopSession('stopped');
  const didDrain = vi.fn();
  const drained = adapter.shutdown().drained.then(didDrain);
  try {
    await Promise.resolve();
    expect(mockSession.dispose).not.toHaveBeenCalled();
    expect(didDrain).not.toHaveBeenCalled();
  } finally {
    abort.resolve();
    await drained;
  }
  expect(mockSession.dispose).toHaveBeenCalledOnce();
  expect(didDrain).toHaveBeenCalledOnce();
});

test('reopening a stopped session waits for its prior native writer', async () => {
  const adapter = createTestPiRuntime();
  await adapter.startSession('reopen', 'First turn.');
  const abort = Promise.withResolvers<void>();
  mockSession.abort.mockReturnValueOnce(abort.promise);
  adapter.stopSession('reopen');
  const reopen = adapter.continueSession('reopen', 'Next turn.');
  try {
    await nextTick();
    expect(mockCreateAgentSession).toHaveBeenCalledOnce();
  } finally {
    abort.resolve();
    await reopen;
  }
  expect(mockSession.dispose).toHaveBeenCalledOnce();
  expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
});

test('shutdown waits for an acquired Pi session still binding extensions', async () => {
  const adapter = createTestPiRuntime();
  const startedBinding = Promise.withResolvers<void>();
  const binding = Promise.withResolvers<void>();
  mockSession.bindExtensions.mockImplementationOnce(() => {
    startedBinding.resolve();
    return binding.promise;
  });
  const launch = adapter.startSession('binding', 'Start working.');
  await startedBinding.promise;
  const didDrain = vi.fn();
  const drained = adapter.shutdown().drained.then(didDrain);
  try {
    await nextTick();
    expect(didDrain).not.toHaveBeenCalled();
  } finally {
    binding.resolve();
    await Promise.all([launch, drained]);
  }
  expect(mockSession.dispose).toHaveBeenCalledOnce();
  expect(mockSession.prompt).not.toHaveBeenCalled();
});

test('a failed extension bind disposes the acquired Pi session', async () => {
  const adapter = createTestPiRuntime();
  adapter.on('error', vi.fn());
  mockSession.bindExtensions.mockRejectedValueOnce(new Error('extension binding failed'));
  await expect(adapter.startSession('binding', 'Start working.')).rejects.toThrow(
    'extension binding failed',
  );
  expect(mockSession.dispose).toHaveBeenCalledOnce();
  expect(adapter.isSessionActive('binding')).toBe(false);
});

test('a failed Work prompt releases its registered Pi session', async () => {
  const adapter = createTestPiRuntime();
  adapter.on('error', vi.fn());
  mockSession.prompt.mockRejectedValueOnce(new Error('prompt setup failed'));
  await expect(adapter.startSession('failed-prompt', 'Start working.')).rejects.toThrow(
    'prompt setup failed',
  );
  await adapter.waitForNativeSessionStop('failed-prompt');
  expect(mockSession.dispose).toHaveBeenCalledOnce();
  expect(adapter.isSessionActive('failed-prompt')).toBe(false);
});

async function disposeTranscriptFixture(
  adapter: PiRuntimeAdapter,
  store: SqliteStore,
  directory: string,
) {
  try {
    if (store.getDatabase().open) {
      try {
        adapter.stopAllSessions();
      } finally {
        store.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('shutdown aborts every Pi session when closing one tool result fails in SQLite', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-transcript-shutdown-'));
  const store = await SqliteStore.create(directory);
  const db = store.getDatabase();
  const cowork = new CoworkStore(db);
  const adapter = createTestPiRuntime({ coworkStore: cowork });
  const first = cowork.createSession('Fail the terminal result', directory);
  const second = cowork.createSession('Finish shutting down', directory);
  try {
    await adapter.startSession(first.id, 'Start a command.');
    await adapter.startSession(second.id, 'Keep this session active.');
    const firstRun = adapter.activeSessions.get(first.id)!;
    const secondRun = adapter.activeSessions.get(second.id)!;
    cowork.messages.addMessage(first.id, {
      id: 'shutdown-open-tool',
      type: 'tool_use',
      content: 'An open command.',
      timestamp: Date.now(),
      metadata: { toolUseId: 'unfinished-command' },
    });
    db.exec(`CREATE TEMP TRIGGER fail_interrupted_tool BEFORE INSERT ON cowork_messages
      WHEN NEW.session_id = '${first.id}' AND NEW.type = 'tool_result'
      BEGIN SELECT RAISE(ABORT, 'fixture terminal result failure'); END;`);

    await expect(adapter.shutdown().drained).rejects.toThrow();
    expect(firstRun.abortController.signal.aborted).toBe(true);
    expect(secondRun.abortController.signal.aborted).toBe(true);
    expect(adapter.activeSessions.size).toBe(0);
    expect(cowork.getSession(first.id)?.status).toBe('idle');
    expect(cowork.getSession(second.id)?.status).toBe('idle');
  } finally {
    await disposeTranscriptFixture(adapter, store, directory);
  }
});

test('shutdown stops Pi but leaves a settled artifact capture alive until it drains', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-artifact-shutdown-'));
  const store = await SqliteStore.create(directory);
  const db = store.getDatabase();
  const cowork = new CoworkStore(db);
  const adapter = createTestPiRuntime({ coworkStore: cowork });
  const session = cowork.createSession('Finish recording the artifact', directory);
  const capture = Promise.withResolvers<number>();
  const recorder = new ArtifactRecorder({
    sessionId: session.id,
    workspaceRoot: directory,
    ledger: new ArtifactLedger(db),
  });
  const dispose = vi.spyOn(recorder, 'dispose');
  vi.spyOn(recorder, 'pendingFinalCapture', 'get').mockReturnValue(capture.promise);
  try {
    await adapter.startSession(session.id, 'Create a file.');
    const active = adapter.activeSessions.get(session.id)!;
    mockSession.subscribe.mock.calls.at(-1)![0]({ type: 'agent_settled' });
    active.artifactRecorder = recorder;

    const didDrain = vi.fn();
    const drained = adapter.shutdown().drained.then(didDrain);
    await Promise.resolve();
    expect(active.abortController.signal.aborted).toBe(true);
    expect(adapter.activeSessions.size).toBe(0);
    expect(dispose).not.toHaveBeenCalled();
    expect(didDrain).not.toHaveBeenCalled();

    capture.resolve(1);
    await drained;
    expect(dispose).toHaveBeenCalledOnce();
    expect(didDrain).toHaveBeenCalledOnce();
  } finally {
    capture.resolve(1);
    await disposeTranscriptFixture(adapter, store, directory);
  }
});

test('deleting an active session discards buffered transcript text and stops Pi after SQL deletion', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-transcript-delete-'));
  const store = await SqliteStore.create(directory);
  const cowork = new CoworkStore(store.getDatabase());
  const adapter = createTestPiRuntime({ coworkStore: cowork });
  const session = cowork.createSession('Delete active session', directory);
  try {
    await adapter.startSession(session.id, 'Respond once.');
    const active = adapter.activeSessions.get(session.id)!;
    active.thinkingText = 'Uncommitted thought.';
    expect(active.thinkingMessageId).toBeNull();
    cowork.deleteSessions([session.id]);

    await expect(adapter.onSessionDeleted(session.id)).resolves.toBeUndefined();
    expect(active.abortController.signal.aborted).toBe(true);
    expect(adapter.isSessionActive(session.id)).toBe(false);
    expect(cowork.getSession(session.id)).toBeNull();
  } finally {
    await disposeTranscriptFixture(adapter, store, directory);
  }
});

const ShutdownPath = {
  Settled: 'settled',
  Stop: 'stop',
  Delete: 'delete',
  Recreate: 'recreate',
} as const;

test.each(Object.values(ShutdownPath))('does not access closed SQLite after %s', async shutdown => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-transcript-close-'));
  const store = await SqliteStore.create(directory);
  const cowork = new CoworkStore(store.getDatabase());
  const adapter = createTestPiRuntime({ coworkStore: cowork });
  const session = cowork.createSession('Shutdown test', directory);
  try {
    await adapter.startSession(session.id, 'Respond once.');
    const active = adapter.activeSessions.get(session.id)!;
    mockSession.getContextUsage.mockReturnValue({ tokens: 1200, contextWindow: 65536 });
    const answer = cowork.messages.addMessage(session.id, {
      id: 'shutdown-answer',
      type: 'assistant',
      content: 'Final response.',
      timestamp: Date.now(),
      metadata: { isStreaming: false, isFinal: true },
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    adapter.transcript.scheduleContextUsageSync(
      session.id,
      answer.id,
      { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110 },
      'test-model',
      Date.now(),
      Date.now(),
    );
    // This used to arm an untracked timer that survived every cleanup path.
    adapter.transcript.flushContextUsageSync(session.id);
    expect(cowork.messages.getMessage(session.id, answer.id)?.metadata?.usage).toEqual(
      expect.objectContaining({ inputTokens: 100 }),
    );
    adapter.transcript.scheduleContextUsageSync(
      session.id,
      answer.id,
      undefined,
      'pending-model',
      null,
      null,
    );
    if (shutdown === ShutdownPath.Settled) {
      const listener = mockSession.subscribe.mock.calls.at(-1)![0];
      listener({ type: 'turn_end' });
      listener({ type: 'agent_settled' });
    } else if (shutdown === ShutdownPath.Stop) adapter.stopSession(session.id);
    else if (shutdown === ShutdownPath.Delete) await adapter.onSessionDeleted(session.id);
    else adapter.disposeSessionForRecreation(session.id, active);
    adapter.transcript.scheduleContextUsageSync(
      'orphaned-projection',
      answer.id,
      undefined,
      'pending-model',
      Date.now(),
      null,
    );
    adapter.stopAllSessions();
    const readMessage = vi.spyOn(cowork.messages, 'getMessage');
    const writeMessage = vi.spyOn(cowork.messages, 'updateMessage');
    store.close();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    adapter.transcript.flushContextUsageSync(session.id);
    adapter.transcript.flushContextUsageSync('orphaned-projection');
    expect(readMessage).not.toHaveBeenCalled();
    expect(writeMessage).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await disposeTranscriptFixture(adapter, store, directory);
  }
});
