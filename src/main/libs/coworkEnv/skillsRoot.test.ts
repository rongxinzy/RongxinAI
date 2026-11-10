import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

import { getSkillsRoot } from './skillsRoot';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/project',
    getPath: () => '/userData',
    getName: () => 'ZhiYuan Agent',
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

test('defense development never falls back to the regular repository Skills directory', () => {
  vi.stubEnv('APP_EDITION', 'defense');
  vi.stubEnv('ZHIYUAN_SKILLS_ROOT', '/project/SKILLs');
  expect(getSkillsRoot()).toBe('/project/build-tar/defense/SKILLs');
});

test('regular development retains the configured Skills directory', () => {
  const root = path.resolve('SKILLs');
  vi.stubEnv('APP_EDITION', 'zhiyuan');
  vi.stubEnv('ZHIYUAN_SKILLS_ROOT', root);
  expect(getSkillsRoot()).toBe(root);
});
