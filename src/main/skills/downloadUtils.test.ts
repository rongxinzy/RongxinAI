import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { session } from 'electron';
import JSZip from 'jszip';
import { expect, test, vi } from 'vitest';

import {
  downloadGithubArchive,
  downloadZipUrl,
  isNpmPackageSpec,
  isRemoteZipUrl,
} from './downloadUtils';

vi.mock('electron', () => ({ session: { defaultSession: { fetch: vi.fn() } } }));

test('GitHub ref fallback and remote ZIP downloads resolve the extracted skill root', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'skill-download-'));
  const archive = new JSZip();
  archive.file('example/SKILL.md', '# Example');
  const bytes = Uint8Array.from(await archive.generateAsync({ type: 'uint8array' }));
  const fetch = vi.mocked(session.defaultSession.fetch);
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  fetch.mockResolvedValueOnce(new Response(bytes));
  fetch.mockResolvedValueOnce(new Response(bytes));

  try {
    const githubRoot = await downloadGithubArchive(
      { owner: 'owner', repo: 'example' },
      tempRoot,
      'v1',
    );
    const zipRoot = await downloadZipUrl('https://example.com/example.zip', tempRoot);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://github.com/owner/example/archive/refs/heads/v1.zip',
      'https://github.com/owner/example/archive/refs/tags/v1.zip',
      'https://example.com/example.zip',
    ]);
    expect(githubRoot).toBe(path.join(tempRoot, 'github-archive', 'example'));
    expect(zipRoot).toBe(path.join(tempRoot, 'remote-skill', 'example'));
    expect(await readFile(path.join(githubRoot, 'SKILL.md'), 'utf8')).toBe('# Example');
    expect(await readFile(path.join(zipRoot, 'SKILL.md'), 'utf8')).toBe('# Example');
  } finally {
    fetch.mockReset();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

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
