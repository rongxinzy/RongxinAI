import { expect, test } from 'vitest';

import { resolveWorkspaceMarkdownLink } from './workspaceFileLink';

test('resolves a Markdown relative link within its workspace', () => {
  expect(
    resolveWorkspaceMarkdownLink('src/renderer', String.raw`D:\work\project`, 'AGENTS.md'),
  ).toBe(
    'D:/work/project/src/renderer',
  );
});

test('resolves links relative to the Markdown file directory', () => {
  expect(
    resolveWorkspaceMarkdownLink('../shared', String.raw`D:\work\project`, 'docs/guides/README.md'),
  ).toBe('D:/work/project/docs/shared');
});

test('rejects links outside the workspace and absolute paths', () => {
  expect(
    resolveWorkspaceMarkdownLink('../../outside', String.raw`D:\work\project`, 'docs/README.md'),
  ).toBeNull();
  expect(
    resolveWorkspaceMarkdownLink(
      String.raw`C:\outside`,
      String.raw`D:\work\project`,
      'README.md',
    ),
  ).toBeNull();
  expect(
    resolveWorkspaceMarkdownLink(
      'https://example.com',
      String.raw`D:\work\project`,
      'README.md',
    ),
  ).toBeNull();
});
