import {
  adapter,
  mockSession,
  mockStore,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { CoworkStore } from '../../coworkStore';
import { SqliteStore } from '../../sqliteStore';

setupPiRuntimeAdapterSuite();

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
  adapter.setCoworkStore(cowork);
  const session = cowork.createSession('Shutdown test', directory);
  try {
    await adapter.startSession(session.id, 'Respond once.');
    const active = adapter.activeSessions.get(session.id)!;
    mockSession.getContextUsage.mockReturnValue({ tokens: 1200, contextWindow: 65536 });
    const answer = cowork.addMessage(session.id, {
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
    expect(cowork.getMessage(session.id, answer.id)?.metadata?.usage).toEqual(
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
    else if (shutdown === ShutdownPath.Delete) adapter.onSessionDeleted(session.id);
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
    const readMessage = vi.spyOn(cowork, 'getMessage');
    const writeMessage = vi.spyOn(cowork, 'updateMessage');
    store.close();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    adapter.transcript.flushContextUsageSync(session.id);
    adapter.transcript.flushContextUsageSync('orphaned-projection');
    expect(readMessage).not.toHaveBeenCalled();
    expect(writeMessage).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    // Do not let the suite's generic mock cleanup retain a closed real store.
    adapter.setCoworkStore(mockStore);
    if (store.getDatabase().open) store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
