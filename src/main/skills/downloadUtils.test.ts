import { expect, test } from 'vitest';

import { isNpmPackageSpec, isRemoteZipUrl } from './downloadUtils';

test('isNpmPackageSpec: accepts plain, scoped and versioned specs', () => {
  expect(isNpmPackageSpec('some-skill')).toBe(true);
  expect(isNpmPackageSpec('@scope/some-skill')).toBe(true);
  expect(isNpmPackageSpec('@scope/some-skill@1.2.3')).toBe(true);
  expect(isNpmPackageSpec('some-skill@^1.0.0')).toBe(true);
});

test('isNpmPackageSpec: rejects paths, URLs and owner/repo shorthand', () => {
  expect(isNpmPackageSpec('./local')).toBe(false);
  expect(isNpmPackageSpec('/abs/local')).toBe(false);
  expect(isNpmPackageSpec('~/skills/x')).toBe(false);
  expect(isNpmPackageSpec('https://example.com/skill.zip')).toBe(false);
  expect(isNpmPackageSpec('owner/repo')).toBe(false);
});

test('isRemoteZipUrl: accepts http(s) zip URLs and ModelScope skill archives', () => {
  expect(isRemoteZipUrl('https://example.com/skill.zip')).toBe(true);
  expect(isRemoteZipUrl('http://example.com/skill.ZIP')).toBe(true);
  expect(
    isRemoteZipUrl('https://www.modelscope.cn/skills/owner/skill/archive/zip/master?foo=bar'),
  ).toBe(true);
});

test('isRemoteZipUrl: rejects non-http schemes, plain paths and non-archive URLs', () => {
  expect(isRemoteZipUrl('file:///tmp/skill.zip')).toBe(false);
  expect(isRemoteZipUrl('/tmp/skill.zip')).toBe(false);
  expect(isRemoteZipUrl('https://example.com/skill.tgz')).toBe(false);
  expect(isRemoteZipUrl('https://www.modelscope.cn/models/owner/model')).toBe(false);
});
