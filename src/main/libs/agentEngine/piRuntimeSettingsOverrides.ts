/**
 * Pi SettingsManager and session model budget overrides.
 *
 * Extracted from PiRuntimeAdapter: pure helpers that build the in-memory Pi
 * settings manager, clamp model/output budgets to Cowork chat-mode limits,
 * and re-apply the bundled shell override that Pi's
 * own reload-from-disk behavior would otherwise drop.
 */

import { resolveGitBashPathForPi } from '../coworkUtil';
import { calculatePiConversationHistoryCharLimit } from './piConversationContext';
import { applyPiEmbeddedHttpIdleTimeout } from './piHttpIdleTimeout';
import {
  PiChatRuntimeLimit,
  type PiModules,
  type PiSettingsManager,
} from './piRuntimeSessionState';

export function createPiSettingsManager(pi: PiModules, cwd: string): PiSettingsManager | null {
  if (!pi.SettingsManager) return null;
  // Cowork owns its runtime configuration. Loading Pi's user/project settings here can
  // trigger package installation or third-party extensions that differ between machines.
  const settingsManager =
    pi.SettingsManager.inMemory?.() ?? pi.SettingsManager.create(cwd, pi.getAgentDir());
  applyPiEmbeddedHttpIdleTimeout(settingsManager);
  return settingsManager;
}

export function resolvePiSessionModel(
  model: Record<string, unknown>,
  chatMode: boolean,
): Record<string, unknown> {
  if (!chatMode) return model;
  return {
    ...model,
    ...(typeof model.maxTokens === 'number'
      ? { maxTokens: Math.min(model.maxTokens, PiChatRuntimeLimit.MaxOutputTokens) }
      : {}),
  };
}

export function resolveConversationHistoryCharLimit(
  contextWindowTokens: number | undefined,
  maxOutputTokens: number | undefined,
  chatMode: boolean,
): number {
  const calculated = calculatePiConversationHistoryCharLimit(contextWindowTokens, maxOutputTokens);
  return chatMode ? Math.min(calculated, PiChatRuntimeLimit.HistoryChars) : calculated;
}

export async function applyPiShellOverride(
  settingsManager: PiSettingsManager | null,
): Promise<void> {
  if (!settingsManager || process.platform !== 'win32') return;
  const bashPath = await resolveGitBashPathForPi();
  if (bashPath) {
    settingsManager.applyOverrides({ shellPath: bashPath });
  }
}
