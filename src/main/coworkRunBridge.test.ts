import { EventEmitter } from 'node:events';
import { ipcMain } from 'electron';
import { expect, test, vi } from 'vitest';
import { CoworkSessionIpc } from '../shared/ipc/channels';
import type { PiRuntimeAdapter } from './libs/agentEngine/piRuntimeAdapter';
import { bindCoworkRunBridge } from './coworkRunBridge';
import { CoworkRunPhase, PiRunEvent } from '../shared/cowork/runState';

test('closes idle manual compaction but keeps pre-run automatic compaction busy', () => {
  const runtime = Object.assign(new EventEmitter(), { isSessionRunning: vi.fn(() => false) });
  const publish = vi.fn();
  bindCoworkRunBridge(runtime as unknown as PiRuntimeAdapter, vi.fn(), publish);
  runtime.emit('executionEvent', 'session', { type: PiRunEvent.CompactStart });
  expect(publish.mock.lastCall?.[0]).toMatchObject({
    running: true,
    phase: CoworkRunPhase.Compacting,
  });
  runtime.emit('executionEvent', 'session', { type: PiRunEvent.CompactEnd });
  expect(publish.mock.lastCall?.[0]).toMatchObject({ running: false });
  runtime.isSessionRunning.mockReturnValue(true);
  runtime.emit('executionEvent', 'session', { type: PiRunEvent.CompactStart });
  runtime.emit('executionEvent', 'session', { type: PiRunEvent.CompactEnd });
  expect(publish.mock.lastCall?.[0]).toMatchObject({
    running: true,
    phase: CoworkRunPhase.Waiting,
  });
});

test('run snapshot read returns tracker state without side-channel content pushes', async () => {
  const runtime = Object.assign(new EventEmitter(), { isSessionRunning: () => false });
  const handler = vi.spyOn(ipcMain, 'handle');
  const sends: Array<[string, unknown]> = [];
  try {
    bindCoworkRunBridge(runtime as unknown as PiRuntimeAdapter, vi.fn(), vi.fn());
    const snapshotHandler = handler.mock.calls.find(
      ([channel]) => channel === CoworkSessionIpc.RunSnapshot,
    )![1];
    const event = {
      sender: {
        isDestroyed: () => false,
        send: (channel: string, frame: unknown) => sends.push([channel, frame]),
      },
    };

    const result = await snapshotHandler(
      event as unknown as Electron.IpcMainInvokeEvent,
      'session',
    );
    expect(result).toMatchObject({ success: true, running: false, snapshot: null });
    // Oversized ids short-circuit with no snapshot fields.
    expect(
      await snapshotHandler(event as unknown as Electron.IpcMainInvokeEvent, 'x'.repeat(201)),
    ).toEqual({ success: false });

    // The content side channel is gone: no message content is pushed to the
    // requesting window; recovery reloads content through the session read.
    expect(sends).toHaveLength(0);
  } finally {
    handler.mockRestore();
  }
});
