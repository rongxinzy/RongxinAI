import { BrowserWindow } from 'electron';
import { CoworkStreamIpc } from '../shared/ipc/channels';
import {
  CoworkRunPhase,
  CoworkRunPolicy,
  type CoworkContentPatch,
} from '../shared/cowork/runState';
import { PiRunStateTracker } from './libs/agentEngine/piRunState';
import type { PiRuntimeAdapter } from './libs/agentEngine/piRuntimeAdapter';
import { CoworkContentProjection } from './coworkContentProjection';
import { handleIpcContract } from './ipc/handleIpcContract';
import { coworkRunSnapshotContract } from '../shared/ipc/coworkContract';

export function bindCoworkRunBridge(
  runtime: PiRuntimeAdapter,
  publishPatch: (patch: CoworkContentPatch) => void,
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
        .project(sessionId, message.id, message.content, message.metadata)
        .then(patches => {
          for (const patch of patches) publishPatch(patch);
        })
        .catch(error => console.error('[CoworkRunBridge] message projection failed:', error));
    });
  });
  handleIpcContract(coworkRunSnapshotContract, {
    getRunSnapshot: async (_event, sessionId) => {
      if (sessionId.length > 200) return { success: false };
      return {
        success: true,
        snapshot: tracker.snapshot(sessionId),
        running: runtime.isSessionRunning(sessionId),
      };
    },
  });
  return projection;
}
