import type { CoworkMessage, CoworkStore } from '../main/coworkStore';
import type { CoworkError } from '../common/coworkError';
import type { PiRuntime } from '../main/libs/agentEngine/piRuntimeTypes';
import { getDefaultConversationWorkspacePath } from '../main/defaultConversationWorkspace';
import { parseManagedSessionKey } from '../main/libs/channelSessionKey';
import { CoworkSessionSource } from '../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../shared/workbenchTask';

import { PayloadKind, ScheduledTaskMessageSource, SessionTarget } from './constants';
import type { ScheduledTask, ScheduledTaskRun } from './types';

/** Result of one scheduled execution, including the truncation contract. */
export interface ScheduledExecutionResult {
  sessionId: string;
  output: string | null;
  /** True when this run's final answer was truncated (terminal disclosure present). */
  answerTruncated: boolean;
  /** The localized disclosure text persisted by the runtime, when truncated. */
  truncationNotice: string | null;
}

/** Executes one canonical task through the embedded Pi runtime only. */
export class PiScheduledTaskExecutor {
  private readonly taskLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly runtime: PiRuntime,
    private readonly coworkStore: CoworkStore,
  ) {}

  async execute(task: ScheduledTask, _run: ScheduledTaskRun): Promise<ScheduledExecutionResult> {
    const previous = this.taskLocks.get(task.id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.taskLocks.set(task.id, queued);
    await previous;
    try {
      return await this.executeUnlocked(task);
    } finally {
      release();
      if (this.taskLocks.get(task.id) === queued) this.taskLocks.delete(task.id);
    }
  }

  private async executeUnlocked(task: ScheduledTask): Promise<ScheduledExecutionResult> {
    const prompt =
      task.payload.kind === PayloadKind.SystemEvent ? task.payload.text : task.payload.message;
    if (!prompt.trim()) throw new Error(`Scheduled task ${task.id} has an empty prompt`);
    const session = this.resolveSession(task);
    // Run boundary: only messages persisted from here on belong to this run.
    // The same session is continued across triggers, so without the boundary a
    // run with no new assistant output would re-pick an older turn's text (or
    // a scheduled_task_delivery write-back) as its output.
    const messagesAtStart = this.sessionMessages(session.id).length;
    const completion = waitForPiCompletion(
      this.runtime,
      session.id,
      task.payload.kind === PayloadKind.AgentTurn ? task.payload.timeoutSeconds : undefined,
    );
    const options = {
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
    };
    try {
      const execution = this.runtime.isSessionActive(session.id)
        ? this.runtime.continueSession(session.id, prompt, options)
        : this.runtime.startSession(session.id, prompt, options);
      await Promise.all([execution, completion.promise]);
    } catch (error) {
      completion.cancel();
      throw error;
    }
    const turnMessages = this.sessionMessages(session.id).slice(messagesAtStart);
    const final = finalAssistantOutput(turnMessages);
    return {
      sessionId: session.id,
      output: final?.text ?? null,
      answerTruncated: final?.truncated ?? false,
      truncationNotice: final?.notice ?? null,
    };
  }

  private resolveSession(task: ScheduledTask) {
    if (task.sessionTarget === SessionTarget.Task) {
      const taskSessionId = `scheduled-task:${task.id}`;
      const existing = this.coworkStore.getSession(taskSessionId);
      if (existing) return existing;
      return this.createScheduledSession(task, taskSessionId);
    }
    if (task.sessionTarget === SessionTarget.Main && task.sessionKey) {
      const sessionId = parseManagedSessionKey(task.sessionKey)?.sessionId ?? task.sessionKey;
      const existing = this.coworkStore.getSession(sessionId);
      if (existing) return existing;
    }
    return this.createScheduledSession(task);
  }

  private createScheduledSession(task: ScheduledTask, id?: string) {
    const config = this.coworkStore.getConfig();
    const workspace = task.workspaceId ? this.coworkStore.getWorkspace(task.workspaceId) : null;
    return this.coworkStore.createSession(
      `Scheduled: ${task.name}`,
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

  private sessionMessages(sessionId: string): CoworkMessage[] {
    return this.coworkStore.getSession(sessionId, null)?.messages ?? [];
  }
}

interface FinalAssistantOutput {
  text: string;
  truncated: boolean;
  notice: string | null;
}

/**
 * Last user-visible assistant answer inside one run's message boundary.
 *
 * Truncation is derived from the persisted contract, not from run-time flags:
 * the runtime marks a length-stopped answer with `metadata.truncated` and
 * persists an explicit `system` disclosure (`metadata.answerTruncated`) before
 * emitting `complete`. A disclosure only counts when it follows the selected
 * answer — an earlier disclosed truncation superseded by a later clean turn
 * (e.g. a drained queued follow-up) must not mark the run truncated.
 */
function finalAssistantOutput(turnMessages: readonly CoworkMessage[]): FinalAssistantOutput | null {
  const candidates = turnMessages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        message.type === 'assistant' &&
        message.content.trim() &&
        !message.metadata?.isThinking &&
        // Delivery write-backs are projections of earlier runs, never this
        // run's answer; without the filter they re-deliver as new output.
        message.metadata?.source !== ScheduledTaskMessageSource.Delivery,
    );
  const last = candidates[candidates.length - 1];
  if (!last) return null;
  const text = last.message.content.trim();
  const notice =
    turnMessages
      .slice(last.index + 1)
      .find(
        message =>
          message.type === 'system' &&
          message.metadata?.answerTruncated === true &&
          message.content.trim(),
      )?.content.trim() ?? null;
  return {
    text,
    truncated: last.message.metadata?.truncated === true || notice !== null,
    notice,
  };
}

function waitForPiCompletion(
  runtime: PiRuntime,
  sessionId: string,
  timeoutSeconds?: number,
): { promise: Promise<void>; cancel: () => void } {
  const timeoutMs = Math.max(1, timeoutSeconds ?? 300) * 1000;
  let timer: ReturnType<typeof setTimeout>;
  let cleanup = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    cleanup = () => {
      runtime.off('complete', onComplete);
      runtime.off('error', onError);
      runtime.off('sessionStopped', onSessionStopped);
      clearTimeout(timer);
    };
    const onComplete = (id: string) => {
      if (id !== sessionId) return;
      cleanup();
      resolve();
    };
    const onError = (id: string, error: CoworkError) => {
      if (id !== sessionId) return;
      cleanup();
      reject(new Error(error.message));
    };
    const onSessionStopped = (id: string) => {
      if (id !== sessionId) return;
      cleanup();
      reject(new Error(`Scheduled task Pi session stopped before completion: ${sessionId}`));
    };
    timer = setTimeout(() => {
      cleanup();
      runtime.stopSession(sessionId);
      reject(new Error(`Scheduled task Pi run timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    runtime.on('complete', onComplete);
    runtime.on('error', onError);
    runtime.on('sessionStopped', onSessionStopped);
  });
  return { promise, cancel: cleanup };
}
