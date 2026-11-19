import type { CoworkStore } from '../main/coworkStore';
import type {
  PiContinueOptions,
  PiRuntime,
  PiSubmissionResult,
} from '../main/libs/agentEngine/piRuntimeTypes';
import { getDefaultConversationWorkspacePath } from '../main/defaultConversationWorkspace';
import { parseManagedSessionKey } from '../main/libs/channelSessionKey';
import { buildScheduledSessionTitle, CoworkSessionSource } from '../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../shared/workbenchTask';

import { PayloadKind, SessionTarget } from './constants';
import type { ScheduledTask, ScheduledTaskRun } from './types';

/** Executes one canonical task through the embedded Pi runtime only. */
export class PiScheduledTaskExecutor {
  private readonly executionLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly runtime: PiRuntime,
    private readonly coworkStore: CoworkStore,
  ) {}

  async execute(
    task: ScheduledTask,
    _run: ScheduledTaskRun,
  ): Promise<{ sessionId: string; output: string | null }> {
    const sessionId = this.getBoundSessionId(task);
    const lockKey = sessionId ? `session:${sessionId}` : `task:${task.id}`;
    const previous = this.executionLocks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.executionLocks.set(lockKey, queued);
    await previous;
    try {
      return await this.executeUnlocked(task, sessionId);
    } finally {
      release();
      if (this.executionLocks.get(lockKey) === queued) this.executionLocks.delete(lockKey);
    }
  }

  private async executeUnlocked(
    task: ScheduledTask,
    sessionId: string | null,
  ): Promise<{ sessionId: string; output: string | null }> {
    const prompt =
      task.payload.kind === PayloadKind.SystemEvent ? task.payload.text : task.payload.message;
    if (!prompt.trim()) throw new Error(`Scheduled task ${task.id} has an empty prompt`);
    const session =
      (sessionId && this.coworkStore.getSession(sessionId, 0, { includeArtifacts: false })) ||
      this.createScheduledSession(
        task,
        task.sessionTarget === SessionTarget.Task ? (sessionId ?? undefined) : undefined,
      );
    if (this.runtime.isSessionRunning(session.id)) {
      throw new Error(`Scheduled task cannot start while its session is running: ${session.id}`);
    }
    const completion = waitForPiCompletion(
      this.runtime,
      session.id,
      task.payload.kind === PayloadKind.AgentTurn ? task.payload.timeoutSeconds : undefined,
    );
    const options: PiContinueOptions = {
      systemPrompt: session.systemPrompt,
      skillIds: session.activeSkillIds,
      workspaceRoot: session.cwd,
      sessionMode: session.mode,
      expertIds: session.experts.map(expert => expert.expertId),
      modelOverride: session.modelOverride || undefined,
      // Scheduled runs have no foreground permission UI. Their creator opted
      // into unattended execution, so tools must follow that run policy.
      approvalMode: WorkbenchApprovalMode.AllowAll,
      unattended: true,
      onSettled: completion.settle,
    };
    try {
      const execution = this.runtime.isSessionActive(session.id)
        ? this.runtime.continueSession(session.id, prompt, options)
        : this.runtime.startSession(session.id, prompt, options);
      const [, output] = await Promise.all([execution, completion.promise]);
      return { sessionId: session.id, output };
    } catch (error) {
      completion.cancel();
      throw error;
    }
  }

  private getBoundSessionId(task: ScheduledTask): string | null {
    if (task.sessionTarget === SessionTarget.Task) {
      return `scheduled-task:${task.id}`;
    }
    if (task.sessionTarget === SessionTarget.Main && task.sessionKey) {
      return parseManagedSessionKey(task.sessionKey)?.sessionId ?? task.sessionKey;
    }
    return null;
  }

  private createScheduledSession(task: ScheduledTask, id?: string) {
    const config = this.coworkStore.getConfig();
    const workspace = task.workspaceId ? this.coworkStore.getWorkspace(task.workspaceId) : null;
    return this.coworkStore.createSession(
      buildScheduledSessionTitle(task.name),
      workspace?.path || getDefaultConversationWorkspacePath(),
      config.systemPrompt,
      config.executionMode,
      [],
      'main',
      task.payload.kind === PayloadKind.AgentTurn ? (task.payload.model ?? '') : '',
      'work',
      id,
      workspace?.id,
      [],
      CoworkSessionSource.Scheduled,
    );
  }
}

function waitForPiCompletion(
  runtime: PiRuntime,
  sessionId: string,
  timeoutSeconds?: number,
): {
  promise: Promise<string | null>;
  settle: (result: PiSubmissionResult) => void;
  cancel: () => void;
} {
  const timeoutMs = Math.max(1, timeoutSeconds ?? 300) * 1000;
  const { promise, resolve, reject } = Promise.withResolvers<string | null>();
  const timer = setTimeout(() => {
    reject(new Error(`Scheduled task Pi run timed out after ${timeoutMs}ms`));
    runtime.stopSession(sessionId);
  }, timeoutMs);
  return {
    promise,
    settle: result => {
      clearTimeout(timer);
      if (result.ok === true) resolve(result.output);
      else reject(new Error(result.error));
    },
    cancel: () => clearTimeout(timer),
  };
}
