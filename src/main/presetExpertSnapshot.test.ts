import path from 'node:path';
import { expect, test } from 'vitest';

import { resolveBundledPresetExpertSnapshot } from './presetExpertSnapshot';

const skillsRoot = path.resolve('SKILLs');

test('reads a bundled expert preset live from disk', () => {
  const snapshot = resolveBundledPresetExpertSnapshot(skillsRoot, 'data-analyst');
  expect(snapshot).not.toBeNull();
  expect(snapshot?.promptSnapshot).toContain('工作流路由');
  expect(snapshot?.promptSnapshot).toContain('数据分析专家');
  expect(snapshot?.skillIds).toEqual(
    expect.arrayContaining(['data-quality-review', 'metric-diagnosis', 'analytics-report']),
  );
});

test('returns null for a missing preset', () => {
  expect(resolveBundledPresetExpertSnapshot(skillsRoot, 'no-such-preset')).toBeNull();
});

test('returns null for an unreadable preset directory', () => {
  expect(resolveBundledPresetExpertSnapshot(path.resolve('SKILLs', '..', 'no-such-root'), 'data-analyst')).toBeNull();
});
