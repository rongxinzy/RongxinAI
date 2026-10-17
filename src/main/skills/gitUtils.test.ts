import { expect, test } from 'vitest';

import { deriveRepoName, normalizeGitSource, parseGithubRepoSource } from './gitUtils';

test('normalizeGitSource: owner/repo shorthand maps to a GitHub repo URL', () => {
  expect(normalizeGitSource('anthropic/skills')).toEqual({
    repoUrl: 'https://github.com/anthropic/skills.git',
  });
});

test('normalizeGitSource: URLs, ssh remotes and .git paths pass through', () => {
  expect(normalizeGitSource('https://gitlab.com/a/b')).toEqual({
    repoUrl: 'https://gitlab.com/a/b',
  });
  expect(normalizeGitSource('git@github.com:a/b.git')).toEqual({
    repoUrl: 'git@github.com:a/b.git',
  });
  expect(normalizeGitSource('some/local/repo.git')).toEqual({ repoUrl: 'some/local/repo.git' });
});

test('normalizeGitSource: github tree/blob URLs normalize to repo + subpath + ref', () => {
  expect(normalizeGitSource('https://github.com/owner/repo/tree/main/docs/skills')).toEqual({
    repoUrl: 'https://github.com/owner/repo.git',
    sourceSubpath: 'docs/skills',
    ref: 'main',
    repoNameHint: 'repo',
  });
  expect(normalizeGitSource('https://github.com/owner/repo/blob/v1.0.0/pkg/SKILL.md')).toEqual({
    repoUrl: 'https://github.com/owner/repo.git',
    sourceSubpath: 'pkg/SKILL.md',
    ref: 'v1.0.0',
    repoNameHint: 'repo',
  });
});

test('normalizeGitSource: traversal subpaths fail tree parsing and fall back to the raw URL', () => {
  // The URL parser collapses "../", so the tree/blob parser sees too few
  // segments and the raw https URL passes through unchanged.
  expect(normalizeGitSource('https://github.com/owner/repo/tree/main/../etc')).toEqual({
    repoUrl: 'https://github.com/owner/repo/tree/main/../etc',
  });
  expect(normalizeGitSource('not a source')).toBeNull();
});

test('parseGithubRepoSource: extracts owner and repo from https and ssh remotes', () => {
  expect(parseGithubRepoSource('https://github.com/anthropic/skills')).toEqual({
    owner: 'anthropic',
    repo: 'skills',
  });
  // Trailing slash keeps the ".git" suffix in the repo name: the strip
  // regex only matches ".git" at the very end of the path.
  expect(parseGithubRepoSource('https://www.github.com/anthropic/skills.git/')).toEqual({
    owner: 'anthropic',
    repo: 'skills.git',
  });
  expect(parseGithubRepoSource('git@github.com:anthropic/skills.git')).toEqual({
    owner: 'anthropic',
    repo: 'skills',
  });
});

test('parseGithubRepoSource: rejects non-github hosts and short paths', () => {
  expect(parseGithubRepoSource('https://gitlab.com/anthropic/skills')).toBeNull();
  expect(parseGithubRepoSource('https://github.com/onlyowner')).toBeNull();
});

test('deriveRepoName: strips fragments, query and .git suffix', () => {
  expect(deriveRepoName('https://github.com/owner/my-skill.git#main?x=1')).toBe('my-skill');
  expect(deriveRepoName('https://example.com/a/b/')).toBe('b');
  expect(deriveRepoName('')).toBe('skill');
});
