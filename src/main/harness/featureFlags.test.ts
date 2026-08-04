import { expect, test } from 'vitest';

import { HarnessFeatureFlag } from '../../shared/harness';
import { resolveHarnessFeatureFlags } from './featureFlags';

test('keeps experimental mechanisms off unless a profile enables them', () => {
  const defaults = resolveHarnessFeatureFlags();
  expect(defaults.every(flag => !flag.enabled && flag.source === 'default')).toBe(true);

  const overridden = resolveHarnessFeatureFlags({
    [HarnessFeatureFlag.IndependentCritic]: true,
  });
  expect(overridden.find(flag => flag.flag === HarnessFeatureFlag.IndependentCritic)).toEqual({
    flag: HarnessFeatureFlag.IndependentCritic,
    enabled: true,
    source: 'profile',
  });
});
