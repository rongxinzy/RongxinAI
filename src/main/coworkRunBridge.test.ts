import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { ipcMain } from 'electron';
import { expect, test, vi } from 'vitest';
import { CoworkSessionIpc, CoworkStreamIpc } from '../shared/ipc/channels';
import type { PiRuntimeAdapter } from './libs/agentEngine/piRuntimeAdapter';
import { bindCoworkRunBridge } from './coworkRunBridge';
import { runTextWorkerOperation, type TextWorkerInput } from './workbenchTask/textWorkerOperations';
import { CoworkContentBuffer } from '../renderer/services/coworkContentBuffer';
import type { CoworkContentPatch } from '../shared/cowork/runState';

vi.mock('./workbenchTask/artifactWorkerPool', () => ({
  transformCoworkTextAsync: async (input: TextWorkerInput) => runTextWorkerOperation(input),
}));

test('recovery queries persisted sequence and creation time and replays the complete long message', async () => {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE cowork_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
    metadata TEXT, created_at INTEGER NOT NULL, sequence INTEGER
  )`);
  const content = 'x'.repeat(190_000 - 4) + 'END!';
  database
    .prepare('INSERT INTO cowork_messages VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('message', 'session', 'assistant', content, null, 100, 1);
  const runtime = Object.assign(new EventEmitter(), { isSessionRunning: () => false });
  const handler = vi.spyOn(ipcMain, 'handle');
  try {
    bindCoworkRunBridge(runtime as unknown as PiRuntimeAdapter, () => database, vi.fn());
    const snapshotHandler = handler.mock.calls.find(
      ([channel]) => channel === CoworkSessionIpc.RunSnapshot,
    )![1];
    const frames: CoworkContentPatch[] = [];
    const event = {
      sender: {
        isDestroyed: () => false,
        send: (channel: string, frame: CoworkContentPatch) => {
          expect(channel).toBe(CoworkStreamIpc.ContentPatch);
          frames.push(frame);
        },
      },
    };
    const result = await snapshotHandler(
      event as unknown as Electron.IpcMainInvokeEvent,
      'session',
      true,
    );
    expect(result).toMatchObject({ success: true, running: false, snapshot: null });
    const gap = vi.fn();
    const buffer = new CoworkContentBuffer(gap);
    let update;
    for (const frame of frames) update = buffer.apply(frame) ?? update;
    expect(update?.content).toBe(content);
    expect(gap).not.toHaveBeenCalled();
  } finally {
    handler.mockRestore();
    database.close();
  }
});
