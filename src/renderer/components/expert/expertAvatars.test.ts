import { expect, test } from 'vitest';

import path from 'path';

import { listPresetExperts } from '../../../main/presetExpertCatalog';
import { PRESET_EXPERT_AVATARS } from './expertAvatars';

test('provides an avatar for every bundled preset expert', () => {
  const experts = listPresetExperts(path.resolve('SKILLs'));

  expect(experts.length).toBeGreaterThan(0);
  for (const expert of experts) {
    const avatar = PRESET_EXPERT_AVATARS[expert.name];
    expect(avatar, `missing avatar for preset "${expert.name}"`).toBeDefined();
    expect(avatar.icon).toBeDefined();
    expect(avatar.background.length).toBeGreaterThan(0);
  }
});

test('keeps avatar entries in sync with bundled presets', () => {
  const bundledNames = new Set(
    listPresetExperts(path.resolve('SKILLs')).map(expert => expert.name),
  );

  for (const name of Object.keys(PRESET_EXPERT_AVATARS)) {
    expect(bundledNames.has(name), `stale avatar entry for unknown preset "${name}"`).toBe(true);
  }
});
