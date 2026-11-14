import { expect, test, vi } from 'vitest';
import { adapter, mockSession, setupPiRuntimeAdapterSuite } from './piRuntimeAdapter.testHarness';

setupPiRuntimeAdapterSuite();

test.each([false, true])(
  'explicit automation deletion disposes artifact capture even when close fails: %s',
  async closeFails => {
    await adapter.startSession('automation:cleanup', 'Prepare the task.');
    const active = adapter.activeSessions.get('automation:cleanup')!;
    active.nativeInputProjection = true;
    const dispose = vi.fn();
    active.artifactRecorder = { dispose } as never;
    const close = vi.fn(async () => {
      if (closeFails) throw new Error('Native close failed.');
    });
    Object.assign(mockSession, { close });
    const pending = adapter.onSessionDeleted('automation:cleanup');
    if (closeFails) await expect(pending).rejects.toThrow('Native close failed.');
    else await pending;
    expect(dispose).toHaveBeenCalledOnce();
    expect(active.abortController.signal.aborted).toBe(true);
  },
);
