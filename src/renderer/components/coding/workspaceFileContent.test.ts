import { expect, test } from 'vitest';

import {
  detectWorkspaceLineEnding,
  normalizeWorkspaceFileContent,
  serializeWorkspaceFileContent,
  WorkspaceLineEnding,
} from './workspaceFileContent';

test('normalizes mixed line endings for the textarea model', () => {
  expect(normalizeWorkspaceFileContent('one\r\ntwo\rthree\nfour')).toBe('one\ntwo\nthree\nfour');
});

test('round-trips edited content using the original line ending', () => {
  const original = 'one\r\ntwo\r\n';
  const normalized = normalizeWorkspaceFileContent(original);

  expect(detectWorkspaceLineEnding(original)).toBe(WorkspaceLineEnding.CrLf);
  expect(serializeWorkspaceFileContent(`${normalized}three\n`, WorkspaceLineEnding.CrLf)).toBe(
    'one\r\ntwo\r\nthree\r\n',
  );
});
