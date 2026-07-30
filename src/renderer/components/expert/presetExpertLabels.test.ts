import { expect, test } from 'vitest';

import { shouldShowPresetExpertProfession } from './presetExpertLabels';

test('hides a profession that duplicates the localized display name', () => {
  expect(shouldShowPresetExpertProfession('财务会计专家', '财务会计专家')).toBe(false);
  expect(shouldShowPresetExpertProfession('Equity Research Expert', 'Equity Research Expert')).toBe(
    false,
  );
});

test('ignores surrounding whitespace when comparing expert labels', () => {
  expect(shouldShowPresetExpertProfession('演示文稿制作专家', ' 演示文稿制作专家 ')).toBe(false);
});

test('shows a distinct non-empty profession', () => {
  expect(shouldShowPresetExpertProfession('售前技术顾问', '企业解决方案与技术评估顾问')).toBe(true);
  expect(shouldShowPresetExpertProfession('售前技术顾问', '   ')).toBe(false);
});
