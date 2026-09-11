import { describe, expect, test } from 'vitest';
import {
  conservativeSolPiConfig,
  isSolPiEnabled,
  resolveSolPiProfile,
  SOLPI_PROFILE_ENV,
  SolPiProfile,
} from './solPiProfile';

describe('resolveSolPiProfile', () => {
  test('defaults to off when the env var is unset', () => {
    expect(resolveSolPiProfile({})).toBe(SolPiProfile.Off);
    expect(resolveSolPiProfile({ [SOLPI_PROFILE_ENV]: '  ' })).toBe(SolPiProfile.Off);
  });

  test('accepts the conservative profile and normalizes case', () => {
    expect(resolveSolPiProfile({ [SOLPI_PROFILE_ENV]: 'conservative' })).toBe(
      SolPiProfile.Conservative,
    );
    expect(resolveSolPiProfile({ [SOLPI_PROFILE_ENV]: ' Conservative ' })).toBe(
      SolPiProfile.Conservative,
    );
    expect(resolveSolPiProfile({ [SOLPI_PROFILE_ENV]: 'off' })).toBe(SolPiProfile.Off);
  });

  test('rejects unknown values by staying off', () => {
    expect(resolveSolPiProfile({ [SOLPI_PROFILE_ENV]: 'full' })).toBe(SolPiProfile.Off);
    expect(resolveSolPiProfile({ [SOLPI_PROFILE_ENV]: 'actionFusion' })).toBe(SolPiProfile.Off);
  });

  test('isSolPiEnabled is false for off and true otherwise', () => {
    expect(isSolPiEnabled(SolPiProfile.Off)).toBe(false);
    expect(isSolPiEnabled(SolPiProfile.Conservative)).toBe(true);
  });
});

describe('conservativeSolPiConfig', () => {
  test('enables only Action Fusion and ObservationPack', () => {
    const config = conservativeSolPiConfig();
    expect(config.actionFusion).toBe(true);
    expect(config.observationPack).toBe(true);
    expect(config.evidencePreservingReducer).toBe(false);
    expect(config.onlineContextCompact).toBe(false);
    expect(config.version).toBe(1);
    expect(config.cacheWriteReadRatio).toBeGreaterThan(0);
  });
});
