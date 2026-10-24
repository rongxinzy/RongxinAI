import { expect, test } from 'vitest';

import {
  buildPythonDependencyPromptBlock,
  buildSkillCatalogPromptBlock,
  DEFAULT_CN_NPM_REGISTRY_URL,
  DEFAULT_CN_PYPI_MIRROR_URLS,
  ExpertPypiMirrorId,
  mergeExpertCapabilityPolicy,
  parsePresetPythonRequirements,
  parseSkillCatalog,
  readPresetExpertPackageMetadata,
  resolvePresetPypiMirrors,
} from './presetPackageMetadata';

test('resolvePresetPypiMirrors uses documented default order when plugin omits overrides', () => {
  expect(resolvePresetPypiMirrors({})).toEqual([...DEFAULT_CN_PYPI_MIRROR_URLS]);
  expect(DEFAULT_CN_PYPI_MIRROR_URLS[0]).toContain('mirrors.tuna.tsinghua.edu.cn');
  expect(DEFAULT_CN_NPM_REGISTRY_URL).toBe('https://registry.npmmirror.com');
  expect(ExpertPypiMirrorId.TsinghuaTuna).toBe('tsinghua-tuna');
});

test('parsePresetPythonRequirements rejects empty objects', () => {
  expect(parsePresetPythonRequirements({})).toBeUndefined();
  expect(
    parsePresetPythonRequirements({ pythonRequirements: { dependencies: ['httpx'] } }),
  ).toEqual({
    dependencies: ['httpx'],
  });
});

test('readPresetExpertPackageMetadata normalizes mcpIds and python requirements', () => {
  const metadata = readPresetExpertPackageMetadata({
    mcpIds: ['context7', 'context7', ''],
    pythonRequirements: {
      requirementsPath: './requirements.txt',
      dependencies: ['pandas>=2.0'],
    },
  });

  expect(metadata.mcpIds).toEqual(['context7']);
  expect(metadata.pythonRequirements).toEqual({
    requirementsPath: './requirements.txt',
    dependencies: ['pandas>=2.0'],
  });
  expect(metadata.pypiMirrors.length).toBeGreaterThan(0);
});

test('parseSkillCatalog skips invalid entries and buildSkillCatalogPromptBlock formats installs', () => {
  const catalog = parseSkillCatalog({
    skillCatalog: [
      {
        id: 'guizang-ppt-skill',
        category: 'office',
        install: 'npx skills add op7418/guizang-ppt-skill',
      },
      { id: '', category: 'office', install: 'npx skills add bad' },
      { category: 'office', install: 'npx skills add missing-id' },
    ],
  });
  expect(catalog).toHaveLength(1);
  const block = buildSkillCatalogPromptBlock(catalog);
  expect(block).toContain('guizang-ppt-skill');
  expect(block).toContain('npx skills add');
});

test('buildPythonDependencyPromptBlock is empty without python requirements', () => {
  expect(buildPythonDependencyPromptBlock({ pythonRequirements: undefined, pypiMirrors: [] })).toBe(
    '',
  );
});

test('mergeExpertCapabilityPolicy only includes non-empty fields', () => {
  expect(
    mergeExpertCapabilityPolicy({
      mcpIds: [],
      pythonRequirements: { dependencies: ['httpx'] },
      pypiMirrors: ['https://pypi.tuna.tsinghua.edu.cn/simple'],
    }),
  ).toEqual({
    pythonRequirements: { dependencies: ['httpx'] },
    pypiMirrors: ['https://pypi.tuna.tsinghua.edu.cn/simple'],
  });
  expect(
    mergeExpertCapabilityPolicy({
      mcpIds: ['context7'],
      pypiMirrors: [],
      skillCatalog: [
        { id: 'vercel-skills', category: 'code', install: 'npx skills add vercel-labs/skills' },
      ],
    }),
  ).toEqual({
    mcpIds: ['context7'],
    skillCatalog: [
      { id: 'vercel-skills', category: 'code', install: 'npx skills add vercel-labs/skills' },
    ],
  });
});
