import { CompanionTasks } from '../companion/tasks';
import { getMagpieModelService } from '../magpie/modelService';
import { getAgentManager, getCoworkStore, getStore } from './runtimeServices';
import { getPiRuntimeAdapter, getWorkbenchTaskService } from './sessionServices';
import { coworkImageRoot } from '../coworkImageAttachments';
import { app } from 'electron';
import { resolveSessionWorkingDirectory, resolveTaskWorkingDirectory } from './workspacePaths';

let tasks: CompanionTasks | undefined;
export function getCompanionTasks(): CompanionTasks {
  tasks ??= new CompanionTasks({
    db: getStore().getDatabase(),
    models: getMagpieModelService(),
    tasks: getWorkbenchTaskService(),
    sessions: {
      getCoworkImageRoot: () => coworkImageRoot(app.getPath('userData')),
      getCoworkStore,
      getAgentManager,
      getPiRuntimeAdapter,
      resolveSessionWorkingDirectory,
      resolveTaskWorkingDirectory,
    },
  });
  return tasks;
}
