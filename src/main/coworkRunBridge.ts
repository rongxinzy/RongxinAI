import type Database from 'better-sqlite3';
import { BrowserWindow, ipcMain } from 'electron';
import { CoworkSessionIpc, CoworkStreamIpc } from '../shared/ipc/channels';
import { CoworkRunPhase, CoworkRunPolicy } from '../shared/cowork/runState';
import { PiRunStateTracker } from './libs/agentEngine/piRunState';
import type { PiRuntimeAdapter } from './libs/agentEngine/piRuntimeAdapter';
import { CoworkContentProjection } from './coworkContentProjection';

export function bindCoworkRunBridge(
  runtime: PiRuntimeAdapter,
  getDatabase: () => Database.Database,
): CoworkContentProjection {
  const projection = new CoworkContentProjection();
  const tracker = new PiRunStateTracker(snapshot => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      try {
        window.webContents.send(CoworkStreamIpc.RunState, snapshot);
      } catch (error) {
        console.debug('[CoworkRunBridge] window closed during status delivery:', error);
      }
    }
  });
  runtime.on('executionEvent', (sessionId, event) => tracker.observe(sessionId, event));
  runtime.on('permissionRequest', sessionId =>
    tracker.setPhase(sessionId, CoworkRunPhase.Approval),
  );
  runtime.on('complete', sessionId => tracker.finish(sessionId, CoworkRunPhase.Completed));
  runtime.on('error', sessionId => tracker.finish(sessionId, CoworkRunPhase.Error));
  runtime.on('sessionStopped', sessionId => tracker.finish(sessionId, CoworkRunPhase.Stopped));
  runtime.on('sessionInterrupted', event =>
    tracker.finish(event.sessionId, CoworkRunPhase.Stopped),
  );
  runtime.on('message', (sessionId, message) => {
    if (message.content.length <= CoworkRunPolicy.ContentChunkCharacters) return;
    // The canonical message must reach the renderer before its content patches.
    setImmediate(() => {
      void projection
        .project(sessionId, message.id, message.content, message.metadata, true)
        .then(patches => {
          for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed()) continue;
            for (const patch of patches)
              window.webContents.send(CoworkStreamIpc.ContentPatch, patch);
          }
        })
        .catch(error => console.error('[CoworkRunBridge] message projection failed:', error));
    });
  });
  ipcMain.handle(
    CoworkSessionIpc.RunSnapshot,
    async (event, sessionId: unknown, replayContent: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.length > 200) return { success: false };
      if (replayContent === true) {
        // SQLite lifecycle remains on main. Read only a bounded tail; transforms run in workers.
        const stored = getDatabase()
          .prepare(
            'SELECT id, substr(content, 1, ?) AS content FROM cowork_messages WHERE session_id = ? AND length(content) > 120000 ORDER BY sequence DESC, created_at DESC LIMIT 8',
          )
          .all(CoworkRunPolicy.MaximumContentCharacters + 1, sessionId) as {
          id: string;
          content: string;
        }[];
        for (const message of stored) {
          if (!projection.has(message.id))
            await projection.project(sessionId, message.id, message.content);
        }
        for (const patch of await projection.replay(sessionId)) {
          if (!event.sender.isDestroyed()) event.sender.send(CoworkStreamIpc.ContentPatch, patch);
        }
      }
      return {
        success: true,
        snapshot: tracker.snapshot(sessionId),
        running: runtime.isSessionRunning(sessionId),
      };
    },
  );
  return projection;
}
