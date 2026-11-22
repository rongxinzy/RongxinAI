import path from 'path';

import { app, BrowserWindow } from 'electron';

import { lifecycleRuntime } from './lifecycleRuntimeState';
import { refreshMcpOAuthRecord } from './mcpOAuthHeaders';
import {
  getActivityService,
  getAgentManager,
  getCoworkStore,
  getArtifactLedger,
  getMcpStore,
  getIMStore,
  getSkillManager,
  getScheduledTaskStore,
  getStore,
} from './runtimeServices';
import { EngramManager } from '../memory/engramManager';
import { ProjectMemoryService } from '../memory/projectMemoryService';
import { MemoryRepository } from '../memory/repository';
import { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import {
  getCoworkImageRoot,
  resolveSessionWorkingDirectory,
  resolveTaskWorkingDirectory,
} from './workspacePaths';
import type { CoworkSessionIpcDeps } from '../coworkIpc/sessionStart';
import { ConversationHistoryService } from '../conversationHistory/service';
import { PiRuntimeAdapter, type PiRuntimeDependencies } from '../libs/agentEngine/piRuntimeAdapter';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import { promoteSettledWorkbenchRun } from '../memory/taskMemoryPromotion';
import { CanonicalScheduledTaskService } from '../../scheduledTask/canonicalScheduledTaskService';
import { SchedulerRuntime } from '../../scheduledTask/schedulerRuntime';
import {
  ScheduledTaskDeliveryDispatcher,
  type SchedulerDeliveryTransport,
} from '../../scheduledTask/deliveryDispatcher';
import { PiScheduledTaskExecutor } from '../../scheduledTask/piScheduledTaskExecutor';
import { IpcChannel as ScheduledTaskIpc } from '../../scheduledTask/constants';
import type { ScheduledTaskRunEvent, ScheduledTaskStatusEvent } from '../../scheduledTask/types';
import type { MagpieModelService } from '../magpie/modelService';

const pendingMemoryPromotions = new Set<Promise<unknown>>();
const pendingMemoryCompletions = new Set<Promise<string>>();
let sessionRuntime: ReturnType<typeof createSessionRuntime> | undefined;
let workbenchTaskService: WorkbenchTaskService | undefined;

export function drainSettledRunPromotions() {
  return {
    writes: Promise.all(pendingMemoryPromotions),
    modelCompletions: Promise.allSettled(pendingMemoryCompletions),
  };
}

export const getWorkbenchTaskService = (): WorkbenchTaskService => {
  if (!workbenchTaskService) {
    workbenchTaskService = new WorkbenchTaskService(getStore().getDatabase(), {
      onSettledRun: event => {
        const { artifactScopeId, artifactsReady, onArtifactsReady, memoryCompletion, ...settled } =
          event;
        if (lifecycleRuntime.isQuitting || (!memoryCompletion && !onArtifactsReady)) return;
        const promotion = Promise.resolve(artifactsReady)
          .then(async () => {
            const extractMemory = !lifecycleRuntime.isQuitting && memoryCompletion;
            if (!onArtifactsReady && !extractMemory) return;
            const artifacts = getArtifactLedger().listForRun(artifactScopeId, settled.run.id);
            const results = await Promise.allSettled([
              onArtifactsReady?.(artifacts),
              extractMemory &&
                promoteSettledWorkbenchRun(
                  getProjectMemoryService(),
                  { ...settled, artifacts },
                  messages => {
                    const completion = extractMemory(messages).finally(() => {
                      pendingMemoryCompletions.delete(completion);
                    });
                    pendingMemoryCompletions.add(completion);
                    return completion;
                  },
                ),
            ]);
            for (const result of results) {
              if (result.status === 'rejected') {
                console.warn(
                  `[Memory] failed to record settled run memory for session ${event.task.sessionId}:`,
                  result.reason,
                );
              }
            }
          })
          .catch(error => {
            console.warn(
              `[Memory] failed to extract settled run memory for session ${event.task.sessionId}:`,
              error,
            );
          })
          .finally(() => {
            pendingMemoryPromotions.delete(promotion);
          });
        pendingMemoryPromotions.add(promotion);
      },
    });
  }
  return workbenchTaskService;
};

let engramManager: EngramManager | undefined;
let projectMemoryService: ProjectMemoryService | undefined;

const getEngramManager = () =>
  (engramManager ??= new EngramManager({
    userDataPath: app.getPath('userData'),
    resourcesPath: process.resourcesPath,
    projectRoot: app.isPackaged ? undefined : process.cwd(),
  }));

export function startEngram(): Promise<boolean> {
  return getEngramManager()
    .start()
    .then(Boolean, (error: unknown) => {
      console.warn('[MemoryRuntime] Failed to start local memory service:', error);
      return false;
    });
}

export const getProjectMemoryService = (): ProjectMemoryService =>
  (projectMemoryService ??= new ProjectMemoryService(
    new MemoryRepository(getStore().getDatabase()),
    new ZhiYuanEngramAdapter(getEngramManager()),
    resolveProjectIdentity,
    path.join(app.getPath('userData'), 'memory'),
  ));

export function startMemoryOutbox(engramReady: Promise<boolean>): void {
  getProjectMemoryService().startOutboxScheduler();
  void engramReady
    .then(ready => {
      if (ready) resumeMemoryOutbox();
    })
    .catch(error => console.warn('[ProjectMemory] Failed to drain pending operations:', error));
}

export function resumeMemoryOutbox(): void {
  if (!lifecycleRuntime.isQuitting) projectMemoryService?.resumeOutboxDrain();
}

export function shutdownMemoryWrites(): Promise<void> | undefined {
  return projectMemoryService?.shutdown();
}

export function stopEngram(): Promise<void> | undefined {
  return engramManager?.stop();
}

function broadcastScheduledTaskEvent(
  channel: (typeof ScheduledTaskIpc)[keyof typeof ScheduledTaskIpc],
  data: Record<string, unknown>,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send(channel, data);
    } catch (error) {
      console.error('[Scheduler] Failed to broadcast a scheduled task event:', error);
    }
  }
}

function createSessionRuntime(
  modelService: MagpieModelService,
  deliveryTransport: SchedulerDeliveryTransport,
) {
  const taskStore = getScheduledTaskStore();
  const coworkStore = getCoworkStore();
  const schedulerRuntime = new SchedulerRuntime(
    taskStore,
    undefined,
    (task, run, signal) => executor.execute(task, run, signal),
    new ScheduledTaskDeliveryDispatcher(taskStore, deliveryTransport),
    getActivityService(),
    {
      runUpdated: (run, taskName) =>
        broadcastScheduledTaskEvent(ScheduledTaskIpc.RunUpdate, {
          run: { ...run, taskName },
        } satisfies ScheduledTaskRunEvent),
      taskStateChanged: (taskId, state) =>
        broadcastScheduledTaskEvent(ScheduledTaskIpc.StatusUpdate, {
          taskId,
          state,
        } satisfies ScheduledTaskStatusEvent),
    },
  );

  const scheduledTaskService = new CanonicalScheduledTaskService(taskStore, schedulerRuntime);
  const userData = app.getPath('userData');
  const pi = new PiRuntimeAdapter({
    modelService,
    imageAttachmentRoot: getCoworkImageRoot(),
    piSessionStoreRoot: userData,
    coworkStore,
    workbenchTaskService: getWorkbenchTaskService(),
    artifactLedger: getArtifactLedger(),
    projectMemoryService: getProjectMemoryService(),
    conversationHistoryService: new ConversationHistoryService(getStore().getDatabase()),
    scheduledTaskService,
    getScheduledTaskDeliveryForSession: sessionId =>
      getIMStore().getScheduledTaskDelivery(sessionId),
    bundledSkillsRoot: getSkillManager().getBundledSkillsRoot(),
    mcpServerSource: {
      listEnabled: () => getMcpStore().getEnabledServers(),
      refreshOAuthRecord: refreshMcpOAuthRecord,
    },
  } satisfies Required<PiRuntimeDependencies>);
  // The clock can dispatch only after this graph is returned and armed.
  const executor = new PiScheduledTaskExecutor(pi, coworkStore);
  return {
    pi,
    scheduledTaskService,
    shutdown() {
      // Close Cron admission first. Its drain may need Pi to settle an interrupted run.
      const cronStopped = Promise.try(() => scheduledTaskService.stop());
      const { drained: piDrained, viewerStopped } = pi.shutdown();
      const drained = Promise.allSettled([cronStopped, piDrained]).then(results => {
        const failures = results.flatMap(result =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length) throw new AggregateError(failures, 'Session runtime shutdown failed.');
      });
      return { drained, viewerStopped };
    },
  };
}

export function initializeSessionRuntime(
  modelService: MagpieModelService,
  deliveryTransport: SchedulerDeliveryTransport,
): PiRuntimeAdapter {
  if (!sessionRuntime) {
    if (lifecycleRuntime.isQuitting) throw new Error('Session runtime is shutting down');
    sessionRuntime = createSessionRuntime(modelService, deliveryTransport);
  }
  return sessionRuntime.pi;
}

function getSessionRuntime() {
  if (!sessionRuntime) throw new Error('Session runtime is not initialized');
  return sessionRuntime;
}

export function getCanonicalScheduledTaskService(): CanonicalScheduledTaskService {
  return getSessionRuntime().scheduledTaskService;
}

export function getPiRuntimeAdapter(): PiRuntimeAdapter {
  return getSessionRuntime().pi;
}

export const coworkSessionDependencies = {
  getCoworkImageRoot,
  getAgentManager,
  getCoworkStore,
  getPiRuntimeAdapter,
  getWorkbenchTaskService,
  resolveSessionWorkingDirectory,
  resolveTaskWorkingDirectory,
} satisfies CoworkSessionIpcDeps;

export function hasRunningPiSessions(): boolean {
  return sessionRuntime?.pi.hasRunningSessions() ?? false;
}

export function markPiMcpConfigurationChanged(): void {
  sessionRuntime?.pi.markMcpConfigurationChanged();
}

export function shutdownSessionRuntime() {
  return sessionRuntime?.shutdown();
}
