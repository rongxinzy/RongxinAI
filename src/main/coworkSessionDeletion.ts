import type { CoworkSessionDeletionSelection, CoworkStore } from './coworkStore';
import type { IMStore } from './im/imStore';
import type { ProjectMemoryService } from './memory/projectMemoryService';
import type { WorkbenchTask } from '../shared/workbenchTask';
import { lifecycleRuntime } from './appBootstrap/lifecycleRuntimeState';
import { observeWorkbench } from './workbenchTask/observe';
import type { WorkbenchTaskService } from './workbenchTask/taskService';

interface CoworkSessionDeletionDeps {
  getCoworkStore: () => CoworkStore;
  getProjectMemoryService: () => Pick<ProjectMemoryService, 'finalizeSessionsForDeletion'>;
  getIMStore: () => Pick<IMStore, 'deleteSessionMappingsByCoworkSessionIds'>;
  getWorkbenchTaskService: () => Pick<WorkbenchTaskService, 'repository' | 'emitChanged'>;
  forgetSession: (sessionId: string, piHistoryKey: string | null) => Promise<void>;
}

export function createCoworkSessionDeletion(deps: CoworkSessionDeletionDeps) {
  return async (
    selection: CoworkSessionDeletionSelection,
    deleteOwner?: () => boolean,
  ): Promise<string[] | null> => {
    if (lifecycleRuntime.isQuitting) throw new Error('The application is shutting down.');
    const store = deps.getCoworkStore();
    const im = deps.getIMStore();
    const workbench = deps.getWorkbenchTaskService();
    const piHistoryKeys = new Map<string, string | null>();
    let removedTasks: Array<Pick<WorkbenchTask, 'id' | 'sessionId'>> = [];
    const deleted = deps.getProjectMemoryService().finalizeSessionsForDeletion(() => {
      const sessions = store.getSessionFinalizationSnapshots(selection);
      if (deleteOwner && !deleteOwner()) return null;
      const ids = sessions.map(session => session.id);
      if (store.deleteSessions(ids) !== ids.length) {
        throw new Error('Could not delete every selected Cowork session');
      }
      im.deleteSessionMappingsByCoworkSessionIds(ids);
      removedTasks = workbench.repository.deleteSessionDomainData(ids);
      for (const session of sessions) {
        piHistoryKeys.set(session.id, session.piHistoryKey);
      }
      return sessions.map(session => ({
        sessionId: session.id,
        workingDirectory: session.cwd,
        summary: `## Goal\n${session.title}\n\n## Accomplished\n${(session.lastAssistantContent ?? '').slice(0, 1500)}`,
      }));
    });

    for (const task of removedTasks) {
      observeWorkbench(task.sessionId, () => workbench.emitChanged(task));
    }
    await Promise.all(
      (deleted ?? []).map(sessionId =>
        deps.forgetSession(sessionId, piHistoryKeys.get(sessionId) ?? null),
      ),
    );
    return deleted;
  };
}
