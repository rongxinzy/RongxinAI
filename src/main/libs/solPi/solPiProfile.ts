/**
 * SoL-Pi experiment profiles.
 *
 * The integration is opt-in and default-off. `ZHIYUAN_SOLPI_PROFILE` selects a
 * whole reviewed profile; there is no per-feature flag surface. The
 * conservative profile matches upstream's conservative configuration:
 * Action Fusion + ObservationPack only. The reducer (extra model calls) and
 * online context compaction (hidden continuations that conflict with the
 * app's terminal-state projection) stay disabled.
 */
import type { SolPiVendorConfig } from './solPiVendor';

export const SolPiProfile = {
  Off: 'off',
  Conservative: 'conservative',
} as const;
export type SolPiProfile = (typeof SolPiProfile)[keyof typeof SolPiProfile];

export const SOLPI_PROFILE_ENV = 'ZHIYUAN_SOLPI_PROFILE';

/** Upstream default reducer route; kept explicit so the config is complete. */
const REDUCER_MODEL_DEFAULT = 'gpt-5.6-luna';
const REDUCER_PROVIDER_DEFAULT = 'openai-codex';
/** Upstream DEFAULT_CACHE_WRITE_READ_RATIO (only read by disabled mechanisms). */
const CACHE_WRITE_READ_RATIO_DEFAULT = 12.5;

export const SOLPI_PROFILES: readonly SolPiProfile[] = [
  SolPiProfile.Off,
  SolPiProfile.Conservative,
];

export function resolveSolPiProfile(env: NodeJS.ProcessEnv): SolPiProfile {
  const raw = env[SOLPI_PROFILE_ENV]?.trim().toLowerCase();
  if (!raw) return SolPiProfile.Off;
  if (raw === SolPiProfile.Conservative) return SolPiProfile.Conservative;
  if (raw === SolPiProfile.Off) return SolPiProfile.Off;
  console.warn(`[SolPi] Unknown ${SOLPI_PROFILE_ENV} value "${raw}"; staying off`);
  return SolPiProfile.Off;
}

export function isSolPiEnabled(profile: SolPiProfile): boolean {
  return profile !== SolPiProfile.Off;
}

/** Effective vendored-extension config for the conservative profile. */
export function conservativeSolPiConfig(): SolPiVendorConfig {
  return {
    version: 1,
    actionFusion: true,
    observationPack: true,
    evidencePreservingReducer: false,
    evidencePreservingReducerModel: REDUCER_MODEL_DEFAULT,
    evidencePreservingReducerProvider: REDUCER_PROVIDER_DEFAULT,
    onlineContextCompact: false,
    cacheWriteReadRatio: CACHE_WRITE_READ_RATIO_DEFAULT,
  };
}
