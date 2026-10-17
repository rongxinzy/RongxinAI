/**
 * Launches the Pi runtime turn for an IM cowork session (start or continue),
 * keeping the stored system prompt in sync before dispatch.
 */

import type { Platform } from '../../../shared/platform';
import type { CoworkStore } from '../../coworkStore';
import type { PiRuntime } from '../../libs/agentEngine/types';
import type { PiContinueOptions } from '../../libs/agentEngine/piRuntimeTypes';
import { serializeForLog } from '../../libs/sanitizeForLog';

interface IMCoworkTurnLaunchDeps {
  coworkRuntime: PiRuntime;
  coworkStore: CoworkStore;
  buildSystemPrompt: () => Promise<string>;
}

interface IMCoworkTurnLaunchParams {
  sessionId: string;
  platform: Platform;
  conversationId: string;
  prompt: string;
  attachments: Pick<PiContinueOptions, 'imageAttachments' | 'fileAttachments'>;
  signal?: AbortSignal;
}

/**
 * Start or continue session. Setup errors after the Started projection
 * must close the same run instead of leaving the activity feed stuck:
 * synchronous failures reject the returned promise, while runtime dispatch
 * failures are routed to `onRuntimeError` (fire-and-forget, as before).
 */
export async function launchIMCoworkRuntimeTurn(
  deps: IMCoworkTurnLaunchDeps,
  params: IMCoworkTurnLaunchParams,
  onRuntimeError: (error: unknown) => void,
): Promise<void> {
  const { sessionId, platform, conversationId, prompt, attachments, signal } = params;
  const session = deps.coworkStore.getSession(sessionId);
  if (!session) {
    throw new Error(`Cowork session not found: ${sessionId}`);
  }
  const isActive = deps.coworkRuntime.isSessionActive(sessionId);
  const systemPrompt = await deps.buildSystemPrompt();
  if (signal?.aborted) throw new Error('Channel request was cancelled');
  const hasAvailableSkills = systemPrompt.includes('<available_skills>');
  if (session && session.systemPrompt !== systemPrompt) {
    deps.coworkStore.updateSession(sessionId, {
      systemPrompt,
    });
    console.log(
      `[IMCoworkHandler] Updated system prompt for channel session ${serializeForLog(sessionId)} platform=${serializeForLog(platform)}`,
    );
  }
  if (!hasAvailableSkills) {
    console.warn('[IMCoworkHandler] Skills auto-routing prompt missing for current IM turn');
  }

  // 打印完整的输入消息日志
  console.log(
    `[IMCoworkHandler] 处理消息: platform=${serializeForLog(platform)} conversationId=${serializeForLog(conversationId)} coworkSessionId=${serializeForLog(sessionId)} isActive=${isActive} hasAvailableSkills=${hasAvailableSkills}`,
  );

  if (isActive) {
    deps.coworkRuntime
      .continueSession(sessionId, prompt, {
        ...attachments,
        systemPrompt,
        skillIds: session.activeSkillIds,
        workspaceRoot: session.cwd,
        sessionMode: session.mode,
        modelOverride: session.modelOverride || undefined,
      })
      .catch(onRuntimeError);
  } else {
    deps.coworkRuntime
      .startSession(sessionId, prompt, {
        ...attachments,
        systemPrompt,
        skillIds: session.activeSkillIds,
        workspaceRoot: session.cwd,
        sessionMode: session.mode,
        modelOverride: session.modelOverride || undefined,
      })
      .catch(onRuntimeError);
  }
}
