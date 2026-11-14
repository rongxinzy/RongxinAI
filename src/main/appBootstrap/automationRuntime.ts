import { app, BrowserWindow } from 'electron';
import { DurableAutomationService } from '../automations/durableAutomationService.mjs';
import type { ScheduledTask } from '../../scheduledTask/types';
import { PayloadKind, IpcChannel } from '../../scheduledTask/constants';
import {
  CoworkSessionSource,
  CoworkSessionMode,
  buildScheduledSessionTitle,
} from '../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { getDefaultConversationWorkspacePath } from '../defaultConversationWorkspace';
import {
  durableSessionFile,
  listDurableSessionFiles,
} from '../libs/agentEngine/durableSessionStore';
import { getActivityService, getCoworkStore } from './runtimeServices';
import { ActivitySource, ActivityStatus } from '../../shared/activity/constants';
import { TaskStatus } from '../../scheduledTask/constants';
import { getPiRuntimeAdapter } from './sessionServices';
import { agentRuntime } from './agentRuntimeState';

let service: DurableAutomationService | undefined;

async function openAutomationSession(task: ScheduledTask, file: string) {
  const sessionId = `automation:${task.id}`;
  if (file !== durableSessionFile(app.getPath('userData'), sessionId))
    throw new Error('Unexpected automation storage path.');
  const store = getCoworkStore();
  const workspace = task.workspaceId ? store.getWorkspace(task.workspaceId) : null;
  if (task.workspaceId && !workspace) throw new Error('Automation workspace is unavailable.');
  const config = store.getConfig();
  const cwd = workspace?.path ?? getDefaultConversationWorkspacePath();
  const selected = task.payload.kind === PayloadKind.AgentTurn ? task.payload.model : undefined;
  let session = store.getSession(sessionId);
  if (!session)
    session = store.createSession(
      buildScheduledSessionTitle(task.name),
      cwd,
      config.systemPrompt,
      config.executionMode,
      [],
      'main',
      selected ?? '',
      CoworkSessionMode.Work,
      sessionId,
      workspace?.id,
      [],
      CoworkSessionSource.Scheduled,
    );
  return getPiRuntimeAdapter().prepareSession(sessionId, {
    workspaceRoot: cwd,
    modelOverride: selected || undefined,
    sessionMode: CoworkSessionMode.Work,
    systemPrompt: config.systemPrompt,
    skillIds: session.activeSkillIds,
    expertIds: session.experts.map(expert => expert.expertId),
    unattended: true,
    approvalMode: WorkbenchApprovalMode.AllowAll,
    _automationId: task.id,
  });
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
}

export function getScheduledTaskService(): DurableAutomationService {
  service ??= new DurableAutomationService({
    listSessionFiles: async () => listDurableSessionFiles(app.getPath('userData')),
    fileForSession: sessionId => durableSessionFile(app.getPath('userData'), sessionId),
    openAutomationSession,
    onTaskState: (taskId, state) => broadcast(IpcChannel.StatusUpdate, { taskId, state }),
    onRun: run => {
      broadcast(IpcChannel.RunUpdate, { run });
      getActivityService().upsertBestEffort({
        id: `durable:${run.id}`,
        source: ActivitySource.ScheduledTask,
        status:
          run.status === TaskStatus.Running
            ? ActivityStatus.Running
            : run.status === TaskStatus.Success
              ? ActivityStatus.Completed
              : ActivityStatus.Failed,
        startedAt: Date.parse(run.startedAt),
        updatedAt: Date.parse(run.finishedAt ?? run.startedAt),
        sessionId: run.sessionId ?? undefined,
        taskName: run.taskName,
        inputPreview: run.taskPayload?.slice(0, 1000),
        errorMessage: run.error ?? undefined,
      });
    },
  });
  agentRuntime.piRuntimeAdapter?.setScheduledTaskService(service);
  return service;
}

export async function startAutomations(): Promise<void> {
  const current = getScheduledTaskService();
  getPiRuntimeAdapter().setScheduledTaskService(current);
  await current.start();
}

export async function stopAutomations(): Promise<void> {
  await service?.stop();
}
