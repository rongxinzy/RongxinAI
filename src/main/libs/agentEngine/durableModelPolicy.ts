import type { CompactionSettings } from '@earendil-works/pi-durable';

/** Configure native compaction so its keep/reserve defaults fit the selected model. */
export function durableCompactionPolicy(model: Record<string, unknown>): CompactionSettings {
  const window = Number(model.contextWindow);
  if (!Number.isFinite(window) || window <= 0) return {};
  return {
    reserveTokens: Math.min(16_384, Math.max(128, Math.floor(window * 0.2))),
    keepRecentTokens: Math.min(20_000, Math.max(128, Math.floor(window * 0.3))),
    backgroundTokens: Math.min(32_768, Math.max(128, Math.floor(window * 0.6))),
  };
}
