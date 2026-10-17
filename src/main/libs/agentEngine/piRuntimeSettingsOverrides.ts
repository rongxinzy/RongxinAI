/**
 * Pi SettingsManager and session model budget overrides.
 *
 * Extracted from PiRuntimeAdapter: pure helpers that build the in-memory Pi
 * settings manager, clamp model/output budgets to Cowork chat-mode limits,
 * and re-apply per-process overrides (compaction, bundled shell) that Pi's
 * own reload-from-disk behavior would otherwise drop.
 */

import type { ProviderModelPiCompaction } from '../../../shared/providers';
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

export function applyPiCompactionOverrides(
  settingsManager: PiSettingsManager | null,
  contextWindowTokens?: number,
  perModel?: { key: string; compaction: ProviderModelPiCompaction },
): void {
  if (!settingsManager) return;
  const contextWindow =
    Number.isFinite(contextWindowTokens) && (contextWindowTokens ?? 0) > 0
      ? Math.floor(contextWindowTokens!)
      : 32_768;
  // Keep compaction's summary request and retained conversation inside the
  // active model window. Pi's defaults (16K reserve, 20K recent) are tuned
  // for large hosted models and can exceed a local 16K/32K model's budget.
  const reserveTokens = Math.max(2_048, Math.min(16_384, Math.floor(contextWindow * 0.25)));
  const keepRecentTokens = Math.max(2_048, Math.min(20_000, Math.floor(contextWindow * 0.5)));
  settingsManager.applyOverrides({
    compaction: {
      enabled: true,
      reserveTokens,
      keepRecentTokens,
      // Per-model budgets ride pi's modelOverrides keyed by provider/modelId;
      // unconfigured fields fall back to the flat session budgets above. The
      // key is omitted entirely when unconfigured so the override payload
      // stays byte-identical to the pre-modelOverrides shape.
      ...(perModel
        ? {
            modelOverrides: {
              [perModel.key]: {
                ...(perModel.compaction.reserveTokens !== undefined
                  ? { reserveTokens: perModel.compaction.reserveTokens }
                  : {}),
                ...(perModel.compaction.keepRecentTokens !== undefined
                  ? { keepRecentTokens: perModel.compaction.keepRecentTokens }
                  : {}),
              },
            },
          }
        : {}),
    },
  });
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

export function applyPiShellOverride(settingsManager: PiSettingsManager | null): void {
  if (!settingsManager || process.platform !== 'win32') return;
  const bashPath = resolveGitBashPathForPi();
  if (bashPath) {
    settingsManager.applyOverrides({ shellPath: bashPath });
  }
}
