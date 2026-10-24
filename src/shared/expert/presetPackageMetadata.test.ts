import { expect, test } from 'vitest';

import {
  buildPythonDependencyPromptBlock,
  DEFAULT_CN_NPM_REGISTRY_URL,
  DEFAULT_CN_PYPI_MIRROR_URLS,
  ExpertPypiMirrorId,
  mergeExpertCapabilityPolicy,
  parsePresetPythonRequirements,
  readPresetExpertPackageMetadata,
  resolvePresetPypiMirrors,
} from './presetPackageMetadata';

test('resolvePresetPypiMirrors uses documented default order when plugin omits overrides', () => {
  expect(resolvePresetPypiMirrors({})).toEqual([...DEFAULT_CN_PYPI_MIRROR_URLS]);
  expect(DEFAULT_CN_PYPI_MIRROR_URLS[0]).toContain('tuna.tsinghua');
  expect(DEFAULT_CN_NPM_REGISTRY_URL).toBe('https://registry.npmmirror.com');
  expect(ExpertPypiMirrorId.TsinghuaTuna).toBe('tsinghua-tuna');
});

test('parsePresetPythonRequirements rejects empty objects', () => {
  expect(parsePresetPythonRequirements({})).toBeUndefined();
  expect(parsePresetPythonRequirements({ pythonRequirements: { dependencies: ['httpx'] } })).toEqual({
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
});
