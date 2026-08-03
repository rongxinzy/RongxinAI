import {
  HarnessFeatureFlagDefaults,
  type HarnessFeatureFlag,
  type HarnessFeatureFlagState,
} from '../../shared/harness';

export type HarnessFeatureFlagOverrides = Partial<Record<HarnessFeatureFlag, boolean>>;

export function resolveHarnessFeatureFlags(
  overrides: HarnessFeatureFlagOverrides = {},
): HarnessFeatureFlagState[] {
  return (Object.keys(HarnessFeatureFlagDefaults) as HarnessFeatureFlag[]).map(flag => ({
    flag,
    enabled: overrides[flag] ?? HarnessFeatureFlagDefaults[flag],
    source: overrides[flag] === undefined ? 'default' : 'profile',
  }));
}
