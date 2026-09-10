import { expect, test } from 'vitest';

import { buildGitHubComparisonUrl } from './codingGitUrl';

test('builds the GitHub comparison URL from main to the current branch', () => {
  expect(buildGitHubComparisonUrl('https://github.com/rongxinzy/zhiyuanAaaS', 'main')).toBe(
    'https://github.com/rongxinzy/zhiyuanAaaS/compare/main...main',
  );
});

test('encodes branch names that contain a slash', () => {
  expect(buildGitHubComparisonUrl('https://github.com/example/repository/', 'feature/git-panel')).toBe(
    'https://github.com/example/repository/compare/main...feature%2Fgit-panel',
  );
});
