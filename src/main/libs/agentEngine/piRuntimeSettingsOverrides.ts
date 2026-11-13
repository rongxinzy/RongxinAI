/**
 * Pi SettingsManager and session model budget overrides.
 *
 * Extracted from PiRuntimeAdapter: pure helpers that build the in-memory Pi
 * settings manager, select native platform tools (PowerShell on Windows), and
 * clamp model/output budgets to Cowork chat-mode limits.
 */

import { applyPiEmbeddedHttpIdleTimeout } from './piHttpIdleTimeout';
import {
  PiChatRuntimeLimit,
  type PiModules,
  type PiSettingsManager,
} from './piRuntimeSessionState';

export function applyPiPlatformToolOverrides(
  settingsManager: PiSettingsManager | null,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!settingsManager || platform !== 'win32') return;
  // Windows uses Pi's native PowerShell tool instead of Git Bash.
  settingsManager.applyOverrides({
    defaultTools: ['read', 'powershell', 'edit', 'write'],
  });
}

export function createPiSettingsManager(pi: PiModules, cwd: string): PiSettingsManager | null {
  if (!pi.SettingsManager) return null;
  // Cowork owns its runtime configuration. Loading Pi's user/project settings here can
  // trigger package installation or third-party extensions that differ between machines.
  const settingsManager =
    pi.SettingsManager.inMemory?.() ?? pi.SettingsManager.create(cwd, pi.getAgentDir());
  applyPiEmbeddedHttpIdleTimeout(settingsManager);
  applyPiPlatformToolOverrides(settingsManager);
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
