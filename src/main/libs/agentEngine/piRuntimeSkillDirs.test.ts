import { describe, expect, test } from 'vitest';

import { collectZhiyuanSkillRoots } from './piRuntimeSkillDirs';

const existing = new Set<string>();

function makeInput(overrides: Partial<Parameters<typeof collectZhiyuanSkillRoots>[0]> = {}) {
  return {
    isPackaged: true,
    userSkillsRoot: '/userData/SKILLs',
    userDataSkillsRoot: '/userData/SKILLs',
    bundledSkillsRoots: ['/resources/SKILLs', '/app/SKILLs'],
    feishuRoot: '/userData/MCPs/feishu/skills',
    exists: (dir: string) => existing.has(dir),
    ...overrides,
  };
}

describe('collectZhiyuanSkillRoots', () => {
  test('packaged: appends bundled resources roots after userData and feishu', () => {
    existing.clear();
    [
      '/userData/SKILLs',
      '/resources/SKILLs',
      '/app/SKILLs',
      '/userData/MCPs/feishu/skills',
    ].forEach(dir => existing.add(dir));

    expect(collectZhiyuanSkillRoots(makeInput())).toEqual([
      '/userData/SKILLs',
      '/userData/MCPs/feishu/skills',
      '/resources/SKILLs',
      '/app/SKILLs',
    ]);
  });

  test('packaged: falls back to bundled root when userData copy is missing', () => {
    existing.clear();
    ['/resources/SKILLs'].forEach(dir => existing.add(dir));

    expect(collectZhiyuanSkillRoots(makeInput())).toEqual(['/resources/SKILLs']);
  });

  test('packaged: skips bundled roots that do not exist', () => {
    existing.clear();
    ['/userData/SKILLs', '/app/SKILLs'].forEach(dir => existing.add(dir));

    expect(collectZhiyuanSkillRoots(makeInput())).toEqual(['/userData/SKILLs', '/app/SKILLs']);
  });

  test('development: keeps the userData/SKILLs root and ignores bundled roots', () => {
    existing.clear();
    ['/project/SKILLs', '/userData/SKILLs', '/resources/SKILLs'].forEach(dir => existing.add(dir));

    expect(
      collectZhiyuanSkillRoots(makeInput({ isPackaged: false, userSkillsRoot: '/project/SKILLs' })),
    ).toEqual(['/project/SKILLs', '/userData/SKILLs']);
  });

  test('deduplicates roots that resolve to the same path', () => {
    existing.clear();
    ['/userData/SKILLs', '/userData/MCPs/feishu/skills'].forEach(dir => existing.add(dir));

    expect(
      collectZhiyuanSkillRoots(
        makeInput({ bundledSkillsRoots: ['/userData/SKILLs', '/resources/SKILLs'] }),
      ),
    ).toEqual(['/userData/SKILLs', '/userData/MCPs/feishu/skills']);
  });
});
