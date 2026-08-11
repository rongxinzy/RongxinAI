import type { CoworkStore } from '../main/coworkStore';
import type { CoworkError } from '../common/coworkError';
import type { PiRuntime } from '../main/libs/agentEngine/piRuntimeTypes';

import { PayloadKind, SessionTarget } from './constants';
import type { ScheduledTask, ScheduledTaskRun } from './types';

/** Executes one canonical task through the embedded Pi runtime only. */
export class PiScheduledTaskExecutor {
  constructor(private readonly runtime: PiRuntime, private readonly coworkStore: CoworkStore) {}

  async execute(task: ScheduledTask, _run: ScheduledTaskRun): Promise<{ sessionId: string; output: string | null }> {
    const prompt = task.payload.kind === PayloadKind.SystemEvent ? task.payload.text : task.payload.message;
    if (!prompt.trim()) throw new Error(`Scheduled task ${task.id} has an empty prompt`);
    const session = this.resolveSession(task);
    const completion = waitForPiCompletion(this.runtime, session.id, task.payload.kind === PayloadKind.AgentTurn ? task.payload.timeoutSeconds : undefined);
    const options = {
      systemPrompt: session.systemPrompt,
      skillIds: session.activeSkillIds,
      workspaceRoot: session.cwd,
      sessionMode: session.mode,
      agentId: session.agentId,
      expertIds: session.experts.map(expert => expert.expertId),
      modelOverride: session.modelOverride || undefined,
      confirmationMode: 'text' as const,
    };
    if (this.runtime.isSessionActive(session.id)) await this.runtime.continueSession(session.id, prompt, options);
    else await this.runtime.startSession(session.id, prompt, options);
    await completion;
    return { sessionId: session.id, output: this.finalAssistantOutput(session.id) };
  }

  private resolveSession(task: ScheduledTask) {
    if (task.sessionTarget === SessionTarget.Main && task.sessionKey) {
      const existing = this.coworkStore.getSession(task.sessionKey);
      if (existing) return existing;
    }
    const config = this.coworkStore.getConfig();
    return this.coworkStore.createSession(
      `Scheduled: ${task.name}`, config.workingDirectory, config.systemPrompt,
      config.executionMode, [], task.agentId, '', 'work',
    );
  }

  private finalAssistantOutput(sessionId: string): string | null {
    const session = this.coworkStore.getSession(sessionId, null);
    const message = [...(session?.messages ?? [])].reverse().find(candidate =>
      candidate.type === 'assistant' && candidate.content.trim() && !candidate.metadata?.isThinking,
    );
    return message?.content.trim() || null;
  }
}

function waitForPiCompletion(runtime: PiRuntime, sessionId: string, timeoutSeconds?: number): Promise<void> {
  const timeoutMs = Math.max(1, timeoutSeconds ?? 300) * 1000;
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { runtime.off('complete', onComplete); runtime.off('error', onError); clearTimeout(timer); };
    const onComplete = (id: string) => { if (id === sessionId) { cleanup(); resolve(); } };
    const onError = (id: string, error: CoworkError) => { if (id === sessionId) { cleanup(); reject(new Error(error.message)); } };
    const timer = setTimeout(() => { cleanup(); runtime.stopSession(sessionId); reject(new Error(`Scheduled task Pi run timed out after ${timeoutMs}ms`)); }, timeoutMs);
    runtime.on('complete', onComplete);
    runtime.on('error', onError);
  });
}
