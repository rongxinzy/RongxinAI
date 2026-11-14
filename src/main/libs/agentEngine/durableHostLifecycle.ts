import { readDurableRecovery } from './durableSessionMetadata.mjs';
import { listDurableSessionFiles } from './durableSessionStore';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import type { PiStartOptions } from './piRuntimeTypes';

/** Pause native execution on process shutdown; explicit user Stop remains abort(). */
export async function closeDurableHostSessions(host: PiRuntimeAdapterHost): Promise<void> {
  for (const initializing of host.initializingSessions.values())
    initializing.abortController.abort();
  host.initializingSessions.clear();
  await Promise.all(
    [...host.activeSessions.values()].map(async active => {
      active.aborted = true;
      active.unsubscribe();
      try {
        await active.piSession.close?.();
      } finally {
        active.abortController.abort();
        active.artifactRecorder?.dispose();
      }
    }),
  );
  host.activeSessions.clear();
  await host.cadViewerService.stop();
}

/** Rebuild host bindings, then resume the original native submission without adding user input. */
export async function recoverDurableHostSessions(host: PiRuntimeAdapterHost): Promise<void> {
  const root = host.getPiSessionStoreRoot();
  if (!root) return;
  for (const file of listDurableSessionFiles(root)) {
    try {
      const recovery = await readDurableRecovery(file);
      const sessionId = recovery.options.sessionId;
      if (recovery.options._automationId) continue;
      if (typeof sessionId !== 'string') continue;
      if (!recovery.pending) continue;
      if (host.activeSessions.has(sessionId) || host.initializingSessions.has(sessionId)) continue;
      const session = host.getStore()?.getSession(sessionId, 64, { includeArtifacts: false });
      if (!session) continue;
      const latestUser = session.messages.findLast(message => message.type === 'user');
      void host
        .startSession(sessionId, latestUser?.content ?? '', {
          ...(recovery.options as PiStartOptions),
          skipInitialUserMessage: true,
          _resumePending: true,
        })
        .catch(error =>
          console.warn(`[DurableRuntime] recovery parked for session ${sessionId}:`, error),
        );
    } catch (error) {
      console.error('[DurableRuntime] could not inspect execution storage:', error);
    }
  }
}
